import { get, post, getSettings, intSetting } from '../lib/core.js';
import { HttpError, json, Validator, normalizePhone, isPhone, rateLimit, makeOrderCode, cairoDay, lineTotal } from '../lib/util.js';

const IMG = `(SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_key`;
const PUBLIC_COLS = `p.id, p.name_ar, p.name_en, p.description_ar, p.unit_label, p.price_pt, p.category_id, p.stock_qty, p.low_stock_threshold, ${IMG}`;

function publicProduct(p) {
  const status = p.stock_qty <= 0 ? 'out' : p.stock_qty <= p.low_stock_threshold ? 'low' : 'in';
  const { stock_qty, low_stock_threshold, ...rest } = p;
  return { ...rest, stock_status: status, max_qty: Math.min(stock_qty, 50) };
}

get('/api/store/settings', async (ctx) => {
  const s = await getSettings(ctx.db);
  return json({
    store_name_ar: s.store_name_ar, store_name_en: s.store_name_en, tagline_ar: s.tagline_ar,
    whatsapp: s.whatsapp, delivery_info_ar: s.delivery_info_ar, announcement_ar: s.announcement_ar,
    delivery_fee_pt: intSetting(s, 'delivery_fee_pt'),
    free_delivery_over_pt: intSetting(s, 'free_delivery_over_pt'),
    min_order_pt: intSetting(s, 'min_order_pt'),
  });
});

get('/api/store/categories', async (ctx) => {
  const { results } = await ctx.db
    .prepare(
      `SELECT c.id, c.name_ar, c.name_en FROM categories c WHERE c.active = 1
       AND EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.active = 1)
       ORDER BY c.sort, c.id`
    )
    .all();
  return json({ categories: results });
});

get('/api/store/products', async (ctx) => {
  const cat = parseInt(ctx.url.searchParams.get('category') || '', 10);
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 60);
  const where = ['p.active = 1'];
  const args = [];
  if (Number.isInteger(cat)) { where.push('p.category_id = ?'); args.push(cat); }
  if (q) {
    where.push(`(p.name_ar LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\')`);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const { results } = await ctx.db
    .prepare(`SELECT ${PUBLIC_COLS} FROM products p WHERE ${where.join(' AND ')} ORDER BY (p.stock_qty > 0) DESC, p.id DESC LIMIT 500`)
    .bind(...args)
    .all();
  return json({ products: results.map(publicProduct) });
});

get('/api/store/products/:id', async (ctx) => {
  const p = await ctx.db.prepare(`SELECT ${PUBLIC_COLS} FROM products p WHERE p.id = ? AND p.active = 1`).bind(parseInt(ctx.params.id, 10)).first();
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  const { results } = await ctx.db.prepare('SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY sort, id').bind(p.id).all();
  return json({ product: { ...publicProduct(p), images: results.map((r) => r.r2_key) } });
});

post('/api/store/orders', async (ctx) => {
  await rateLimit(ctx.db, `order-ip:${ctx.ip}`, 6, 600);
  const raw = await ctx.body();
  // Honeypot: real customers never see this field; bots fill it in.
  if (raw && raw.website) throw new HttpError(400, 'تعذر إرسال الطلب');
  const v = new Validator(raw)
    .str('name', { min: 2, max: 80, label: 'الاسم' })
    .str('area', { max: 80, required: false, label: 'المنطقة' })
    .str('address', { min: 8, max: 300, label: 'العنوان' })
    .str('notes', { max: 500, required: false, label: 'الملاحظات' });
  const out = v.out;
  const phone = normalizePhone(raw?.phone);
  if (!isPhone(phone)) v.fail('phone', 'رقم الهاتف غير صحيح');
  const items = Array.isArray(raw?.items) ? raw.items : null;
  if (!items || items.length === 0) v.fail('items', 'السلة فارغة');
  else if (items.length > 40) v.fail('items', 'عدد الأصناف كبير جدًا');
  v.done();

  // Merge duplicate product lines, validate quantities.
  const wanted = new Map();
  for (const it of items) {
    const pid = it?.product_id, qty = it?.qty;
    if (!Number.isInteger(pid) || !Number.isInteger(qty) || qty < 1 || qty > 50) throw new HttpError(400, 'بيانات الأصناف غير صالحة');
    wanted.set(pid, (wanted.get(pid) || 0) + qty);
  }
  const ids = [...wanted.keys()];
  const { results: prods } = await ctx.db
    .prepare(`SELECT id, name_ar, unit_label, price_pt, cost_pt, stock_qty, active FROM products WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all();
  const byId = new Map(prods.map((p) => [p.id, p]));
  const lines = [];
  let subtotal = 0;
  for (const [pid, qty] of wanted) {
    const p = byId.get(pid);
    if (!p || !p.active) throw new HttpError(409, 'أحد المنتجات لم يعد متاحًا، حدّث السلة وحاول مرة أخرى');
    if (p.stock_qty < qty) throw new HttpError(409, `الكمية المتاحة من «${p.name_ar}» هي ${p.stock_qty} فقط`);
    const total = lineTotal(qty, p.price_pt);
    subtotal += total;
    lines.push({ p, qty, total });
  }
  const s = await getSettings(ctx.db);
  const minOrder = intSetting(s, 'min_order_pt');
  if (subtotal < minOrder) throw new HttpError(400, 'قيمة الطلب أقل من الحد الأدنى للطلب');
  const free = intSetting(s, 'free_delivery_over_pt');
  const fee = free > 0 && subtotal >= free ? 0 : intSetting(s, 'delivery_fee_pt');
  const total = subtotal + fee;
  const code = makeOrderCode();
  const day = cairoDay();

  const stmts = [
    ctx.db
      .prepare(`INSERT INTO customers (name, phone, last_address) VALUES (?, ?, ?)
                ON CONFLICT(phone) DO UPDATE SET name = excluded.name, last_address = excluded.last_address`)
      .bind(out.name, phone, out.address),
    ctx.db
      .prepare(`INSERT INTO orders (code, customer_id, customer_name, phone, area, address, notes, subtotal_pt, delivery_fee_pt, total_pt, created_day)
                VALUES (?, (SELECT id FROM customers WHERE phone = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(code, phone, out.name, phone, out.area, out.address, out.notes, subtotal, fee, total, day),
  ];
  for (const { p, qty, total: lt } of lines) {
    stmts.push(
      ctx.db
        .prepare(`INSERT INTO order_items (order_id, product_id, name_snapshot, unit_label_snapshot, unit_price_pt, unit_cost_pt, qty, line_total_pt)
                  VALUES ((SELECT id FROM orders WHERE code = ?), ?, ?, ?, ?, ?, ?, ?)`)
        .bind(code, p.id, p.name_ar, p.unit_label, p.price_pt, p.cost_pt, qty, lt),
      // CHECK (stock_qty >= 0) makes the whole batch roll back if stock ran out meanwhile.
      ctx.db.prepare('UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime(\'now\') WHERE id = ?').bind(qty, p.id),
      ctx.db.prepare(`INSERT INTO inventory_movements (product_id, delta, reason, ref) VALUES (?, ?, 'sale', ?)`).bind(p.id, -qty, code)
    );
  }
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    if (String(e.message).includes('CHECK')) throw new HttpError(409, 'نفدت كمية أحد المنتجات للتو، حدّث السلة وحاول مرة أخرى');
    throw e;
  }
  return json({ ok: true, code, total_pt: total, delivery_fee_pt: fee }, 201);
});

get('/api/store/orders/:code', async (ctx) => {
  await rateLimit(ctx.db, `track-ip:${ctx.ip}`, 20, 600);
  const phone = normalizePhone(ctx.url.searchParams.get('phone') || '');
  const order = await ctx.db
    .prepare(`SELECT id, code, status, customer_name, phone, area, address, subtotal_pt, delivery_fee_pt, discount_pt, total_pt, paid_pt, payment_status, created_at, completed_at
              FROM orders WHERE code = ?`)
    .bind(ctx.params.code.toUpperCase())
    .first();
  // Same message for "no such code" and "wrong phone" so codes cannot be probed.
  if (!order || !phone || order.phone !== phone) throw new HttpError(404, 'لم نجد طلبًا بهذا الكود ورقم الهاتف');
  const { results } = await ctx.db
    .prepare('SELECT name_snapshot AS name, unit_label_snapshot AS unit_label, unit_price_pt, qty, line_total_pt FROM order_items WHERE order_id = ?')
    .bind(order.id)
    .all();
  const { id, phone: _p, ...safe } = order;
  return json({ order: { ...safe, items: results } });
});
