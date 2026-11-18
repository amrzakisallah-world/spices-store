import { get, post, patch, del } from '../lib/core.js';
import { HttpError, json, Validator, cairoDay } from '../lib/util.js';

export const STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const payStatus = (paid, total) => (paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial');

async function loadOrder(ctx, id) {
  const o = await ctx.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'الطلب غير موجود');
  return o;
}

get('/api/admin/orders', async (ctx) => {
  const p = ctx.url.searchParams;
  const where = [];
  const args = [];
  const status = p.get('status');
  if (status) {
    if (!STATUSES.includes(status) && status !== 'open') throw new HttpError(400, 'حالة غير صالحة');
    if (status === 'open') where.push(`status NOT IN ('delivered','cancelled')`);
    else { where.push('status = ?'); args.push(status); }
  }
  if (p.get('payment') && ['unpaid', 'partial', 'paid'].includes(p.get('payment'))) { where.push('payment_status = ?'); args.push(p.get('payment')); }
  const q = (p.get('q') || '').trim().slice(0, 60);
  if (q) {
    where.push(`(code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\')`);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like, like);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '')) { where.push('created_day >= ?'); args.push(p.get('from')); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '')) { where.push('created_day <= ?'); args.push(p.get('to')); }
  const limit = Math.min(parseInt(p.get('limit') || '100', 10) || 100, 500);
  const offset = Math.max(parseInt(p.get('offset') || '0', 10) || 0, 0);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { results } = await ctx.db
    .prepare(`SELECT id, code, customer_name, phone, area, status, total_pt, paid_pt, payment_status, created_at, created_day FROM orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all();
  const total = (await ctx.db.prepare(`SELECT COUNT(*) AS n FROM orders ${w}`).bind(...args).first()).n;
  return json({ orders: results, total });
}, 'any');

get('/api/admin/orders/:id', async (ctx) => {
  const o = await loadOrder(ctx, parseInt(ctx.params.id, 10));
  const items = (await ctx.db.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(o.id).all()).results;
  const payments = (await ctx.db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').bind(o.id).all()).results;
  const cogs = items.reduce((s, i) => s + i.unit_cost_pt * i.qty, 0);
  if (ctx.user.role !== 'owner') return json({ order: o, items: items.map(({ unit_cost_pt, ...i }) => i), payments });
  return json({ order: o, items, payments, profit_pt: o.subtotal_pt - o.discount_pt - cogs + o.delivery_fee_pt - o.delivery_cost_pt });
}, 'any');

// Edit fees / discount / delivery cost / internal notes.
patch('/api/admin/orders/:id', async (ctx) => {
  const o = await loadOrder(ctx, parseInt(ctx.params.id, 10));
  if (o.status === 'cancelled') throw new HttpError(400, 'لا يمكن تعديل طلب ملغي');
  const d = new Validator(await ctx.body())
    .int('delivery_cost_pt', { max: 10_000_000, required: false, def: o.delivery_cost_pt, label: 'تكلفة التوصيل' })
    .int('delivery_fee_pt', { max: 10_000_000, required: false, def: o.delivery_fee_pt, label: 'رسوم التوصيل' })
    .int('discount_pt', { max: 100_000_000, required: false, def: o.discount_pt, label: 'الخصم' })
    .str('admin_notes', { max: 500, required: false, def: o.admin_notes }).done();
  if (d.discount_pt > o.subtotal_pt) throw new HttpError(400, 'الخصم أكبر من قيمة المنتجات');
  const total = o.subtotal_pt + d.delivery_fee_pt - d.discount_pt;
  await ctx.db.prepare(`UPDATE orders SET delivery_cost_pt=?, delivery_fee_pt=?, discount_pt=?, admin_notes=?, total_pt=?, payment_status=?, updated_at=datetime('now') WHERE id=?`)
    .bind(d.delivery_cost_pt, d.delivery_fee_pt, d.discount_pt, d.admin_notes, total, payStatus(o.paid_pt, total), o.id).run();
  return json({ ok: true, total_pt: total });
}, 'any');

post('/api/admin/orders/:id/status', async (ctx) => {
  const o = await loadOrder(ctx, parseInt(ctx.params.id, 10));
  const b = await ctx.body();
  const d = new Validator(b).oneOf('status', STATUSES, { label: 'الحالة' }).str('reason', { max: 200, required: false }).bool('refund').done();
  if (o.status === 'cancelled') throw new HttpError(400, 'الطلب ملغي ولا يمكن تغيير حالته');
  if (d.status === o.status) return json({ ok: true });
  const now = new Date();
  const stmts = [];
  if (d.status === 'cancelled') {
    if (o.status === 'delivered') throw new HttpError(400, 'لا يمكن إلغاء طلب تم تسليمه');
    if (o.paid_pt > 0 && typeof b.refund !== 'boolean') throw new HttpError(409, 'الطلب عليه مدفوعات. حدد هل سيتم رد المبلغ.', { needs_refund_decision: true });
    const items = (await ctx.db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').bind(o.id).all()).results;
    for (const it of items) {
      if (!it.product_id) continue;
      stmts.push(
        ctx.db.prepare(`UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?`).bind(it.qty, it.product_id),
        ctx.db.prepare(`INSERT INTO inventory_movements (product_id, delta, reason, ref, user_id) VALUES (?,?,'cancel_return',?,?)`).bind(it.product_id, it.qty, o.code, ctx.user.id)
      );
    }
    if (o.paid_pt > 0 && d.refund) {
      stmts.push(
        ctx.db.prepare(`INSERT INTO payments (order_id, amount_pt, method, note, day, user_id) VALUES (?, ?, 'cash', 'رد مبلغ بسبب الإلغاء', ?, ?)`).bind(o.id, -o.paid_pt, cairoDay(), ctx.user.id),
        ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, ref_id, note, user_id) VALUES (?, 'out', ?, 'order_refund', 'order', ?, ?, ?)`).bind(cairoDay(), o.paid_pt, o.id, `رد مبلغ طلب ${o.code}`, ctx.user.id)
      );
    }
    stmts.push(ctx.db.prepare(`UPDATE orders SET status='cancelled', cancel_reason=?, paid_pt=?, payment_status=?, updated_at=datetime('now') WHERE id=?`)
      .bind(d.reason, d.refund ? 0 : o.paid_pt, d.refund ? 'unpaid' : o.payment_status, o.id));
  } else if (d.status === 'delivered') {
    stmts.push(ctx.db.prepare(`UPDATE orders SET status='delivered', completed_at=?, completed_day=?, updated_at=datetime('now') WHERE id=?`).bind(now.toISOString(), cairoDay(now), o.id));
  } else {
    stmts.push(ctx.db.prepare(`UPDATE orders SET status=?, completed_at=NULL, completed_day=NULL, updated_at=datetime('now') WHERE id=?`).bind(d.status, o.id));
  }
  await ctx.db.batch(stmts);
  return json({ ok: true });
}, 'any');

post('/api/admin/orders/:id/payments', async (ctx) => {
  const o = await loadOrder(ctx, parseInt(ctx.params.id, 10));
  if (o.status === 'cancelled') throw new HttpError(400, 'لا يمكن تسجيل دفعة على طلب ملغي');
  const d = new Validator(await ctx.body())
    .int('amount_pt', { min: 1, max: 100_000_000, label: 'المبلغ' })
    .oneOf('method', ['cash', 'vodafone_cash', 'instapay', 'bank', 'other'], { label: 'طريقة الدفع' })
    .str('note', { max: 200, required: false }).day('day', { label: 'التاريخ' }).done();
  if (o.paid_pt + d.amount_pt > o.total_pt) throw new HttpError(400, 'المبلغ أكبر من المتبقي على الطلب');
  const paid = o.paid_pt + d.amount_pt;
  await ctx.db.batch([
    ctx.db.prepare('INSERT INTO payments (order_id, amount_pt, method, note, day, user_id) VALUES (?,?,?,?,?,?)').bind(o.id, d.amount_pt, d.method, d.note, d.day, ctx.user.id),
    ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, ref_id, note, user_id) VALUES (?, 'in', ?, 'order_payment', 'order', ?, ?, ?)`).bind(d.day, d.amount_pt, o.id, `دفعة طلب ${o.code}`, ctx.user.id),
    ctx.db.prepare(`UPDATE orders SET paid_pt=?, payment_status=?, updated_at=datetime('now') WHERE id=?`).bind(paid, payStatus(paid, o.total_pt), o.id),
  ]);
  return json({ ok: true, paid_pt: paid }, 201);
}, 'any');

// Owner can remove a mistaken payment: the ledger entry is removed too.
del('/api/admin/payments/:id', async (ctx) => {
  const p = await ctx.db.prepare('SELECT * FROM payments WHERE id = ?').bind(parseInt(ctx.params.id, 10)).first();
  if (!p) throw new HttpError(404, 'الدفعة غير موجودة');
  const o = await loadOrder(ctx, p.order_id);
  if (o.status === 'cancelled') throw new HttpError(400, 'لا يمكن تعديل مدفوعات طلب ملغي');
  const paid = o.paid_pt - p.amount_pt;
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM payments WHERE id = ?').bind(p.id),
    ctx.db.prepare(`DELETE FROM cash_ledger WHERE id = (SELECT id FROM cash_ledger WHERE ref_type='order' AND ref_id=? AND amount_pt=? AND day=? AND category IN ('order_payment','order_refund') ORDER BY id DESC LIMIT 1)`).bind(o.id, Math.abs(p.amount_pt), p.day),
    ctx.db.prepare(`UPDATE orders SET paid_pt=?, payment_status=?, updated_at=datetime('now') WHERE id=?`).bind(paid, payStatus(paid, o.total_pt), o.id),
  ]);
  return json({ ok: true });
}, 'owner');
