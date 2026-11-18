import { get, post, put, del } from '../lib/core.js';
import { HttpError, json, Validator, randomHex } from '../lib/util.js';

const IMG = `(SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS image_key`;

const schema = async (ctx) =>
  new Validator(await ctx.body())
    .str('name_ar', { min: 2, max: 100, label: 'اسم المنتج' })
    .str('name_en', { max: 100, required: false })
    .str('description_ar', { max: 1000, required: false })
    .str('unit_label', { max: 40, required: false, label: 'الوحدة' })
    .int('category_id', { required: false, def: null, label: 'القسم' })
    .int('price_pt', { max: 100_000_000, label: 'سعر البيع' })
    .int('cost_pt', { max: 100_000_000, required: false, label: 'التكلفة' })
    .int('stock_qty', { max: 1_000_000, required: false, label: 'المخزون' })
    .int('low_stock_threshold', { max: 100_000, required: false, def: 5, label: 'حد التنبيه' })
    .bool('active', true)
    .done();

get('/api/admin/products', async (ctx) => {
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 60);
  const low = ctx.url.searchParams.get('low') === '1';
  const where = [];
  const args = [];
  if (q) { where.push(`p.name_ar LIKE ? ESCAPE '\\'`); args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); }
  if (low) where.push('p.stock_qty <= p.low_stock_threshold');
  const { results } = await ctx.db
    .prepare(`SELECT p.*, c.name_ar AS category_name, ${IMG} FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 1000`)
    .bind(...args)
    .all();
  return json({ products: ctx.user.role === 'owner' ? results : results.map(({ cost_pt, ...r }) => r) });
}, 'any');

get('/api/admin/products/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const p = await ctx.db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  const images = (await ctx.db.prepare('SELECT id, r2_key FROM product_images WHERE product_id = ? ORDER BY sort, id').bind(id).all()).results;
  const history = (await ctx.db.prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT 50').bind(id).all()).results;
  const moves = (await ctx.db.prepare('SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT 50').bind(id).all()).results;
  if (ctx.user.role !== 'owner') { delete p.cost_pt; return json({ product: p, images, price_history: [], movements: moves }); }
  return json({ product: p, images, price_history: history, movements: moves });
}, 'any');

async function checkCategory(ctx, id) {
  if (id === null) return;
  const c = await ctx.db.prepare('SELECT id FROM categories WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(400, 'القسم غير موجود', { category_id: 'القسم غير موجود' });
}

post('/api/admin/products', async (ctx) => {
  const d = await schema(ctx);
  await checkCategory(ctx, d.category_id);
  if (ctx.user.role !== 'owner') d.cost_pt = 0; // only the owner may set purchase cost
  const r = await ctx.db
    .prepare(`INSERT INTO products (category_id, name_ar, name_en, description_ar, unit_label, price_pt, cost_pt, stock_qty, low_stock_threshold, active) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(d.category_id, d.name_ar, d.name_en, d.description_ar, d.unit_label, d.price_pt, d.cost_pt, d.stock_qty, d.low_stock_threshold, d.active ? 1 : 0)
    .run();
  const id = r.meta.last_row_id;
  const extra = [ctx.db.prepare(`INSERT INTO price_history (product_id, old_price_pt, new_price_pt, old_cost_pt, new_cost_pt, user_id) VALUES (?,?,?,?,?,?)`).bind(id, d.price_pt, d.price_pt, d.cost_pt, d.cost_pt, ctx.user.id)];
  if (d.stock_qty > 0) extra.push(ctx.db.prepare(`INSERT INTO inventory_movements (product_id, delta, reason, note, user_id) VALUES (?,?,'initial','رصيد افتتاحي',?)`).bind(id, d.stock_qty, ctx.user.id));
  await ctx.db.batch(extra);
  return json({ ok: true, id }, 201);
}, 'any');

put('/api/admin/products/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const d = await schema(ctx);
  await checkCategory(ctx, d.category_id);
  const old = await ctx.db.prepare('SELECT price_pt, cost_pt, stock_qty FROM products WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'المنتج غير موجود');
  if (ctx.user.role !== 'owner') d.cost_pt = old.cost_pt; // staff edits never touch cost
  const stmts = [
    // Stock is changed only through the adjust endpoint / orders / purchases so every change leaves a movement record.
    ctx.db.prepare(`UPDATE products SET category_id=?, name_ar=?, name_en=?, description_ar=?, unit_label=?, price_pt=?, cost_pt=?, low_stock_threshold=?, active=?, updated_at=datetime('now') WHERE id=?`)
      .bind(d.category_id, d.name_ar, d.name_en, d.description_ar, d.unit_label, d.price_pt, d.cost_pt, d.low_stock_threshold, d.active ? 1 : 0, id),
  ];
  if (old.price_pt !== d.price_pt || old.cost_pt !== d.cost_pt)
    stmts.push(ctx.db.prepare(`INSERT INTO price_history (product_id, old_price_pt, new_price_pt, old_cost_pt, new_cost_pt, user_id) VALUES (?,?,?,?,?,?)`).bind(id, old.price_pt, d.price_pt, old.cost_pt, d.cost_pt, ctx.user.id));
  await ctx.db.batch(stmts);
  return json({ ok: true });
}, 'any');

post('/api/admin/products/:id/stock', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const d = new Validator(await ctx.body()).int('delta', { min: -1_000_000, max: 1_000_000, label: 'التغيير' }).str('note', { max: 200, required: false }).done();
  if (d.delta === 0) throw new HttpError(400, 'التغيير لا يمكن أن يكون صفرًا');
  const p = await ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  if (p.stock_qty + d.delta < 0) throw new HttpError(400, 'لا يمكن أن يصبح المخزون سالبًا');
  await ctx.db.batch([
    ctx.db.prepare(`UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?`).bind(d.delta, id),
    ctx.db.prepare(`INSERT INTO inventory_movements (product_id, delta, reason, note, user_id) VALUES (?,?,'adjustment',?,?)`).bind(id, d.delta, d.note, ctx.user.id),
  ]);
  return json({ ok: true });
}, 'any');

del('/api/admin/products/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const imgs = (await ctx.db.prepare('SELECT r2_key FROM product_images WHERE product_id = ?').bind(id).all()).results;
  const r = await ctx.db.prepare('DELETE FROM products WHERE id = ?').bind(id).run(); // past orders keep their name/price snapshot
  if (!r.meta.changes) throw new HttpError(404, 'المنتج غير موجود');
  if (ctx.env.IMAGES) await Promise.all(imgs.map((i) => ctx.env.IMAGES.delete(i.r2_key).catch(() => {})));
  return json({ ok: true });
}, 'owner');

// ---------- Images (R2) ----------
const TYPES = { 'image/jpeg': ['jpg', [0xff, 0xd8, 0xff]], 'image/png': ['png', [0x89, 0x50, 0x4e, 0x47]], 'image/webp': ['webp', null] };
const MAX_IMG = 3 * 1024 * 1024;

post('/api/admin/products/:id/images', async (ctx) => {
  if (!ctx.env.IMAGES) throw new HttpError(501, 'تخزين الصور (R2) غير مفعّل بعد، راجع README');
  const id = parseInt(ctx.params.id, 10);
  const p = await ctx.db.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'المنتج غير موجود');
  const count = (await ctx.db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').bind(id).first()).n;
  if (count >= 6) throw new HttpError(400, 'الحد الأقصى 6 صور لكل منتج');
  const type = (ctx.request.headers.get('content-type') || '').split(';')[0].trim();
  const spec = TYPES[type];
  if (!spec) throw new HttpError(415, 'نوع الصورة غير مدعوم (JPG أو PNG أو WebP)');
  const buf = new Uint8Array(await ctx.request.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_IMG) throw new HttpError(413, 'حجم الصورة يجب ألا يتجاوز 3 ميجابايت');
  const magicOk = spec[1] ? spec[1].every((b, i) => buf[i] === b) : String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' && String.fromCharCode(...buf.slice(8, 12)) === 'WEBP';
  if (!magicOk) throw new HttpError(400, 'الملف ليس صورة صالحة');
  const key = `products/${id}/${randomHex(8)}.${spec[0]}`;
  await ctx.env.IMAGES.put(key, buf, { httpMetadata: { contentType: type } });
  const r = await ctx.db.prepare('INSERT INTO product_images (product_id, r2_key, sort) VALUES (?, ?, ?)').bind(id, key, count).run();
  return json({ ok: true, id: r.meta.last_row_id, key }, 201);
}, 'any');

del('/api/admin/images/:id', async (ctx) => {
  const img = await ctx.db.prepare('SELECT id, r2_key FROM product_images WHERE id = ?').bind(parseInt(ctx.params.id, 10)).first();
  if (!img) throw new HttpError(404, 'الصورة غير موجودة');
  await ctx.db.prepare('DELETE FROM product_images WHERE id = ?').bind(img.id).run();
  if (ctx.env.IMAGES) await ctx.env.IMAGES.delete(img.r2_key).catch(() => {});
  return json({ ok: true });
}, 'any');

// Public image serving.
get('/media/:a/:b/:c', async (ctx) => {
  const key = `${ctx.params.a}/${ctx.params.b}/${ctx.params.c}`;
  if (!ctx.env.IMAGES || !/^products\/\d+\/[a-f0-9]{16}\.(jpg|png|webp)$/.test(key)) throw new HttpError(404, 'غير موجود');
  const obj = await ctx.env.IMAGES.get(key);
  if (!obj) throw new HttpError(404, 'غير موجود');
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
});
