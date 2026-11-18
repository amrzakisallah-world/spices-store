import { get, post, put, del } from '../lib/core.js';
import { HttpError, json, Validator, lineTotal, randomHex } from '../lib/util.js';
import { priceChanges } from '../lib/reports.js';

// NOTE: no live market-price feed exists for Harraz or any other supplier.
// Every price below is entered by the owner (manually or through a purchase invoice)
// and is stored append-only, so the full history is preserved.

get('/api/admin/suppliers', async (ctx) => {
  const { results } = await ctx.db
    .prepare(`SELECT s.*, COALESCE((SELECT SUM(total_pt - paid_pt) FROM supplier_purchases p WHERE p.supplier_id = s.id),0) AS balance_pt,
                     COALESCE((SELECT SUM(total_pt) FROM supplier_purchases p WHERE p.supplier_id = s.id),0) AS purchased_pt
              FROM suppliers s ORDER BY s.active DESC, s.name`)
    .all();
  return json({ suppliers: results });
}, 'owner');

const supSchema = async (ctx) => new Validator(await ctx.body()).str('name', { min: 2, max: 80, label: 'اسم المورد' }).str('phone', { max: 30, required: false }).str('notes', { max: 500, required: false }).bool('active', true).done();
post('/api/admin/suppliers', async (ctx) => {
  const d = await supSchema(ctx);
  try {
    const r = await ctx.db.prepare('INSERT INTO suppliers (name, phone, notes, active) VALUES (?,?,?,?)').bind(d.name, d.phone, d.notes, d.active ? 1 : 0).run();
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'يوجد مورد بنفس الاسم'); throw e; }
}, 'owner');
put('/api/admin/suppliers/:id', async (ctx) => {
  const d = await supSchema(ctx);
  await ctx.db.prepare('UPDATE suppliers SET name=?, phone=?, notes=?, active=? WHERE id=?').bind(d.name, d.phone, d.notes, d.active ? 1 : 0, parseInt(ctx.params.id, 10)).run();
  return json({ ok: true });
}, 'owner');

// ---------- Price points ----------
async function resolveItem(ctx, productId, itemName) {
  if (productId) {
    const p = await ctx.db.prepare('SELECT id, name_ar FROM products WHERE id = ?').bind(productId).first();
    if (!p) throw new HttpError(400, 'المنتج غير موجود');
    return { key: `p${p.id}`, name: p.name_ar, product_id: p.id };
  }
  if (!itemName) throw new HttpError(400, 'اسم الصنف أو المنتج مطلوب');
  return { key: `n:${itemName.toLowerCase()}`, name: itemName, product_id: null };
}

post('/api/admin/supplier-prices', async (ctx) => {
  const d = new Validator(await ctx.body())
    .int('supplier_id', { min: 1, label: 'المورد' }).int('product_id', { required: false, def: null, min: 1 }).str('item_name', { max: 100, required: false, label: 'اسم الصنف' })
    .int('price_pt', { max: 100_000_000, label: 'السعر' }).str('unit', { max: 30, required: false, label: 'الوحدة' }).str('note', { max: 200, required: false }).day('day', { label: 'التاريخ' })
    .bool('update_product_cost').done();
  const sup = await ctx.db.prepare('SELECT id FROM suppliers WHERE id = ?').bind(d.supplier_id).first();
  if (!sup) throw new HttpError(400, 'المورد غير موجود');
  const item = await resolveItem(ctx, d.product_id, d.item_name);
  const stmts = [ctx.db.prepare(`INSERT INTO supplier_prices (supplier_id, product_id, item_key, item_name, unit, price_pt, day, source, note, user_id) VALUES (?,?,?,?,?,?,?, 'manual', ?, ?)`)
    .bind(d.supplier_id, item.product_id, item.key, item.name, d.unit, d.price_pt, d.day, d.note, ctx.user.id)];
  if (d.update_product_cost && item.product_id) stmts.push(...costUpdate(ctx, item.product_id, d.price_pt));
  await ctx.db.batch(stmts);
  return json({ ok: true }, 201);
}, 'owner');

function costUpdate(ctx, productId, newCost) {
  return [
    ctx.db.prepare(`INSERT INTO price_history (product_id, old_price_pt, new_price_pt, old_cost_pt, new_cost_pt, user_id)
                    SELECT id, price_pt, price_pt, cost_pt, ?, ? FROM products WHERE id = ? AND cost_pt <> ?`).bind(newCost, ctx.user.id, productId, newCost),
    ctx.db.prepare(`UPDATE products SET cost_pt = ?, updated_at = datetime('now') WHERE id = ?`).bind(newCost, productId),
  ];
}

get('/api/admin/supplier-prices', async (ctx) => {
  const p = ctx.url.searchParams;
  const where = [];
  const args = [];
  if (p.get('supplier_id')) { where.push('sp.supplier_id = ?'); args.push(parseInt(p.get('supplier_id'), 10)); }
  if (p.get('item_key')) { where.push('sp.item_key = ?'); args.push(p.get('item_key')); }
  if (p.get('product_id')) { where.push('sp.product_id = ?'); args.push(parseInt(p.get('product_id'), 10)); }
  const { results } = await ctx.db
    .prepare(`SELECT sp.*, s.name AS supplier_name FROM supplier_prices sp JOIN suppliers s ON s.id = sp.supplier_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sp.day DESC, sp.id DESC LIMIT 500`)
    .bind(...args).all();
  return json({ prices: results });
}, 'owner');

// Latest price per supplier+item, with change vs the previous recorded price.
get('/api/admin/supplier-prices/latest', async (ctx) => json({ items: await priceChanges(ctx.db) }), 'owner');

// Cost vs selling price comparison per product, across suppliers.
get('/api/admin/supplier-prices/compare', async (ctx) => {
  const latest = await priceChanges(ctx.db);
  const { results: prods } = await ctx.db.prepare('SELECT id, name_ar, unit_label, price_pt, cost_pt FROM products WHERE active = 1 ORDER BY name_ar').all();
  const rows = prods.map((p) => {
    const offers = latest.filter((l) => l.product_id === p.id).sort((a, b) => a.price_pt - b.price_pt);
    const best = offers[0] || null;
    const basis = best ? best.price_pt : p.cost_pt;
    return {
      product_id: p.id, name: p.name_ar, unit_label: p.unit_label, selling_price_pt: p.price_pt, current_cost_pt: p.cost_pt,
      offers, best_offer_pt: best ? best.price_pt : null,
      margin_pt: p.price_pt - basis, margin_pct: p.price_pt > 0 ? Math.round(((p.price_pt - basis) / p.price_pt) * 1000) / 10 : null,
      cost_differs_from_best: best ? best.price_pt !== p.cost_pt : false,
    };
  });
  return json({ products: rows });
}, 'owner');

// ---------- Purchases / invoices ----------
get('/api/admin/purchases', async (ctx) => {
  const sid = parseInt(ctx.url.searchParams.get('supplier_id') || '', 10);
  const { results } = await ctx.db
    .prepare(`SELECT p.*, s.name AS supplier_name FROM supplier_purchases p JOIN suppliers s ON s.id = p.supplier_id ${Number.isInteger(sid) ? 'WHERE p.supplier_id = ?' : ''} ORDER BY p.day DESC, p.id DESC LIMIT 500`)
    .bind(...(Number.isInteger(sid) ? [sid] : [])).all();
  return json({ purchases: results });
}, 'owner');

get('/api/admin/purchases/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const p = await ctx.db.prepare('SELECT p.*, s.name AS supplier_name FROM supplier_purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'الفاتورة غير موجودة');
  const items = (await ctx.db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').bind(id).all()).results;
  return json({ purchase: p, items });
}, 'owner');

post('/api/admin/purchases', async (ctx) => {
  const b = await ctx.body();
  const d = new Validator(b).int('supplier_id', { min: 1, label: 'المورد' }).str('invoice_no', { max: 40, required: false }).day('day', { label: 'التاريخ' })
    .int('paid_pt', { max: 1_000_000_000, required: false, label: 'المدفوع' }).str('note', { max: 300, required: false }).done();
  const sup = await ctx.db.prepare('SELECT id FROM suppliers WHERE id = ?').bind(d.supplier_id).first();
  if (!sup) throw new HttpError(400, 'المورد غير موجود');
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 100) throw new HttpError(400, 'أضف صنفًا واحدًا على الأقل (حتى 100)');
  const lines = [];
  let total = 0;
  for (const [i, raw] of b.items.entries()) {
    const it = new Validator(raw).int('product_id', { required: false, def: null, min: 1 }).str('item_name', { max: 100, required: false }).str('unit', { max: 30, required: false })
      .num('qty', { min: 0.001, max: 1_000_000, label: `كمية الصنف ${i + 1}` }).int('unit_price_pt', { max: 100_000_000, label: `سعر الصنف ${i + 1}` }).bool('add_to_stock').bool('update_cost').done();
    const item = await resolveItem(ctx, it.product_id, it.item_name);
    if (it.add_to_stock) {
      if (!item.product_id) throw new HttpError(400, 'إضافة المخزون تتطلب اختيار منتج');
      if (!Number.isInteger(it.qty)) throw new HttpError(400, `كمية المخزون للصنف ${i + 1} يجب أن تكون عددًا صحيحًا`);
    }
    const lt = lineTotal(it.qty, it.unit_price_pt);
    total += lt;
    lines.push({ ...it, item, lt });
  }
  if (d.paid_pt > total) throw new HttpError(400, 'المدفوع أكبر من إجمالي الفاتورة');
  const ref = `PUR-${randomHex(8)}`;
  const stmts = [
    ctx.db.prepare('INSERT INTO supplier_purchases (ref, supplier_id, invoice_no, day, total_pt, paid_pt, note, user_id) VALUES (?,?,?,?,?,?,?,?)').bind(ref, d.supplier_id, d.invoice_no, d.day, total, d.paid_pt, d.note, ctx.user.id),
  ];
  const pid = () => `(SELECT id FROM supplier_purchases WHERE ref = ?)`;
  const pidArgs = [ref];
  for (const l of lines) {
    stmts.push(ctx.db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, item_name, unit, qty, unit_price_pt, line_total_pt) VALUES (${pid()},?,?,?,?,?,?)`)
      .bind(...pidArgs, l.item.product_id, l.item.name, l.unit, l.qty, l.unit_price_pt, l.lt));
    stmts.push(ctx.db.prepare(`INSERT INTO supplier_prices (supplier_id, product_id, item_key, item_name, unit, price_pt, day, source, note, user_id) VALUES (?,?,?,?,?,?,?, 'purchase', ?, ?)`)
      .bind(d.supplier_id, l.item.product_id, l.item.key, l.item.name, l.unit, l.unit_price_pt, d.day, d.invoice_no ? `فاتورة ${d.invoice_no}` : 'فاتورة شراء', ctx.user.id));
    if (l.add_to_stock) {
      stmts.push(ctx.db.prepare(`UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?`).bind(l.qty, l.item.product_id));
      stmts.push(ctx.db.prepare(`INSERT INTO inventory_movements (product_id, delta, reason, ref, user_id) VALUES (?,?,'purchase',?,?)`).bind(l.item.product_id, l.qty, d.invoice_no || ref, ctx.user.id));
    }
    if (l.update_cost && l.item.product_id) stmts.push(...costUpdate(ctx, l.item.product_id, l.unit_price_pt));
  }
  if (d.paid_pt > 0)
    stmts.push(ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, ref_id, note, user_id) VALUES (?, 'out', ?, 'supplier_payment', 'purchase', ${pid()}, ?, ?)`)
      .bind(d.day, d.paid_pt, ...pidArgs, `دفعة للمورد${d.invoice_no ? ' — فاتورة ' + d.invoice_no : ''}`, ctx.user.id));
  const res = await ctx.db.batch(stmts);
  return json({ ok: true, id: res[0].meta.last_row_id, total_pt: total }, 201);
}, 'owner');

post('/api/admin/purchases/:id/payments', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const p = await ctx.db.prepare('SELECT * FROM supplier_purchases WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'الفاتورة غير موجودة');
  const d = new Validator(await ctx.body()).int('amount_pt', { min: 1, max: 1_000_000_000, label: 'المبلغ' }).day('day', { label: 'التاريخ' }).done();
  if (p.paid_pt + d.amount_pt > p.total_pt) throw new HttpError(400, 'المبلغ أكبر من المتبقي على الفاتورة');
  await ctx.db.batch([
    ctx.db.prepare('UPDATE supplier_purchases SET paid_pt = paid_pt + ? WHERE id = ?').bind(d.amount_pt, id),
    ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, ref_id, note, user_id) VALUES (?, 'out', ?, 'supplier_payment', 'purchase', ?, ?, ?)`).bind(d.day, d.amount_pt, id, `دفعة للمورد${p.invoice_no ? ' — فاتورة ' + p.invoice_no : ''}`, ctx.user.id),
  ]);
  return json({ ok: true }, 201);
}, 'owner');
