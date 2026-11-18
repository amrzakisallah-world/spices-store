import { addDays, cairoDay } from './util.js';

/*
 * DEFINITIONS (all amounts in piasters)
 *  Revenue (sales)   = total of orders with status "delivered", by delivery day.
 *  Product sales     = Σ(subtotal − discount)   (what customers paid for goods)
 *  COGS              = Σ(unit_cost snapshot × qty) of those orders
 *  Gross profit      = product sales − COGS
 *  Delivery margin   = delivery fees charged − actual delivery cost
 *  Net profit        = gross profit + delivery margin − operating expenses
 *  Cash in / out     = real money movements from cash_ledger (payments, refunds,
 *                      expenses, supplier payments), independent of order status.
 */
export async function summary(db, from, to) {
  const o = await db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal_pt - discount_pt),0) AS product_sales,
              COALESCE(SUM(delivery_fee_pt),0) AS delivery_fees, COALESCE(SUM(delivery_cost_pt),0) AS delivery_cost,
              COALESCE(SUM(total_pt),0) AS revenue
       FROM orders WHERE status = 'delivered' AND completed_day BETWEEN ? AND ?`
    )
    .bind(from, to)
    .first();
  const c = await db
    .prepare(
      `SELECT COALESCE(SUM(oi.unit_cost_pt * oi.qty),0) AS cogs
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'delivered' AND o.completed_day BETWEEN ? AND ?`
    )
    .bind(from, to)
    .first();
  const e = await db.prepare('SELECT COALESCE(SUM(amount_pt),0) AS expenses FROM expenses WHERE day BETWEEN ? AND ?').bind(from, to).first();
  const l = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_pt END),0) AS cash_in,
              COALESCE(SUM(CASE WHEN direction='out' THEN amount_pt END),0) AS cash_out
       FROM cash_ledger WHERE day BETWEEN ? AND ?`
    )
    .bind(from, to)
    .first();
  const x = await db
    .prepare(`SELECT COUNT(*) AS cancelled FROM orders WHERE status = 'cancelled' AND created_day BETWEEN ? AND ?`)
    .bind(from, to)
    .first();
  const n = await db.prepare(`SELECT COUNT(*) AS received FROM orders WHERE created_day BETWEEN ? AND ?`).bind(from, to).first();
  const gross = o.product_sales - c.cogs;
  const deliveryMargin = o.delivery_fees - o.delivery_cost;
  const net = gross + deliveryMargin - e.expenses;
  return {
    from, to,
    orders_completed: o.orders, orders_received: n.received, orders_cancelled: x.cancelled,
    revenue_pt: o.revenue, product_sales_pt: o.product_sales, delivery_fees_pt: o.delivery_fees, delivery_cost_pt: o.delivery_cost,
    cogs_pt: c.cogs, gross_profit_pt: gross, delivery_margin_pt: deliveryMargin,
    expenses_pt: e.expenses, net_profit_pt: net,
    gross_margin_pct: o.product_sales > 0 ? Math.round((gross / o.product_sales) * 1000) / 10 : null,
    cash_in_pt: l.cash_in, cash_out_pt: l.cash_out, net_cash_pt: l.cash_in - l.cash_out,
  };
}

export async function series(db, from, to, group) {
  const len = group === 'year' ? 4 : group === 'month' ? 7 : 10;
  const map = new Map();
  const row = (k) => {
    if (!map.has(k)) map.set(k, { period: k, orders: 0, revenue_pt: 0, product_sales_pt: 0, cogs_pt: 0, delivery_margin_pt: 0, expenses_pt: 0, net_profit_pt: 0, cash_in_pt: 0, cash_out_pt: 0 });
    return map.get(k);
  };
  const { results: a } = await db
    .prepare(
      `SELECT substr(completed_day,1,${len}) AS k, COUNT(*) AS n, SUM(total_pt) AS revenue, SUM(subtotal_pt - discount_pt) AS ps, SUM(delivery_fee_pt - delivery_cost_pt) AS dm
       FROM orders WHERE status='delivered' AND completed_day BETWEEN ? AND ? GROUP BY k`
    )
    .bind(from, to)
    .all();
  for (const r of a) Object.assign(row(r.k), { orders: r.n, revenue_pt: r.revenue, product_sales_pt: r.ps, delivery_margin_pt: r.dm });
  const { results: b } = await db
    .prepare(
      `SELECT substr(o.completed_day,1,${len}) AS k, SUM(oi.unit_cost_pt * oi.qty) AS cogs
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status='delivered' AND o.completed_day BETWEEN ? AND ? GROUP BY k`
    )
    .bind(from, to)
    .all();
  for (const r of b) row(r.k).cogs_pt = r.cogs;
  const { results: c } = await db
    .prepare(`SELECT substr(day,1,${len}) AS k, SUM(amount_pt) AS s FROM expenses WHERE day BETWEEN ? AND ? GROUP BY k`)
    .bind(from, to)
    .all();
  for (const r of c) row(r.k).expenses_pt = r.s;
  const { results: d } = await db
    .prepare(
      `SELECT substr(day,1,${len}) AS k, SUM(CASE WHEN direction='in' THEN amount_pt ELSE 0 END) AS i, SUM(CASE WHEN direction='out' THEN amount_pt ELSE 0 END) AS o
       FROM cash_ledger WHERE day BETWEEN ? AND ? GROUP BY k`
    )
    .bind(from, to)
    .all();
  for (const r of d) Object.assign(row(r.k), { cash_in_pt: r.i, cash_out_pt: r.o });
  const rows = [...map.values()].sort((x, y) => (x.period < y.period ? -1 : 1));
  for (const r of rows) r.net_profit_pt = r.product_sales_pt - r.cogs_pt + r.delivery_margin_pt - r.expenses_pt;
  return rows;
}

export function periodRange(period, today = cairoDay()) {
  const [y, m] = today.split('-');
  let from = today, to = today;
  if (period === 'week') {
    // Egypt's week starts on Saturday.
    const dow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
    from = addDays(today, -((dow + 1) % 7));
    to = addDays(from, 6);
  } else if (period === 'month') {
    from = `${y}-${m}-01`;
    to = addDays(`${+m === 12 ? +y + 1 : y}-${String(+m === 12 ? 1 : +m + 1).padStart(2, '0')}-01`, -1);
  } else if (period === 'year') {
    from = `${y}-01-01`;
    to = `${y}-12-31`;
  }
  return { from, to };
}
export function previousRange(from, to) {
  const days = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
  // Calendar-aware for months/years, otherwise the same length immediately before.
  if (from.endsWith('-01-01') && to.endsWith('-12-31')) {
    const y = +from.slice(0, 4) - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (from.endsWith('-01') && days >= 28 && days <= 31) {
    const pe = addDays(from, -1);
    return { from: pe.slice(0, 8) + '01', to: pe };
  }
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export async function alerts(db) {
  const out = [];
  const low = await db
    .prepare(`SELECT id, name_ar, stock_qty FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold ORDER BY stock_qty LIMIT 50`)
    .all();
  for (const p of low.results)
    out.push({ type: p.stock_qty === 0 ? 'out_of_stock' : 'low_stock', level: p.stock_qty === 0 ? 'danger' : 'warn', text: p.stock_qty === 0 ? `نفد من المخزون: ${p.name_ar}` : `مخزون منخفض: ${p.name_ar} (${p.stock_qty})`, product_id: p.id });
  const pend = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'`).first();
  if (pend.n) out.push({ type: 'pending_orders', level: 'info', text: `${pend.n} طلب جديد في انتظار التأكيد` });
  const unpaid = await db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_pt - paid_pt),0) AS s FROM orders WHERE status = 'delivered' AND paid_pt < total_pt`)
    .first();
  if (unpaid.n) out.push({ type: 'unpaid_delivered', level: 'warn', text: `${unpaid.n} طلب تم تسليمه ولم يُسدَّد بالكامل`, amount_pt: unpaid.s });
  const loss = await db.prepare(`SELECT id, name_ar FROM products WHERE active = 1 AND cost_pt > 0 AND price_pt <= cost_pt LIMIT 20`).all();
  for (const p of loss.results) out.push({ type: 'no_margin', level: 'danger', text: `سعر البيع أقل من أو يساوي التكلفة: ${p.name_ar}`, product_id: p.id });
  const ch = await priceChanges(db);
  for (const c of ch.filter((c) => c.change_pct !== null && c.change_pct >= 10).slice(0, 10))
    out.push({ type: 'supplier_increase', level: 'warn', text: `ارتفع سعر ${c.item_name} عند ${c.supplier_name} ${c.change_pct}%` });
  const pay = await db.prepare('SELECT COALESCE(SUM(total_pt - paid_pt),0) AS s FROM supplier_purchases WHERE total_pt > paid_pt').first();
  if (pay.s > 0) out.push({ type: 'supplier_payable', level: 'info', text: 'مستحقات للموردين لم تُسدَّد بعد', amount_pt: pay.s });
  return out;
}

// Latest vs previous recorded price for every (supplier, item).
export async function priceChanges(db, productId = null) {
  const { results } = await db
    .prepare(
      `WITH ranked AS (
         SELECT sp.*, ROW_NUMBER() OVER (PARTITION BY supplier_id, item_key ORDER BY day DESC, id DESC) AS rn FROM supplier_prices sp
       )
       SELECT a.supplier_id, s.name AS supplier_name, a.product_id, a.item_key, a.item_name, a.unit, a.price_pt, a.day, a.source,
              b.price_pt AS prev_price_pt, b.day AS prev_day
       FROM ranked a JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN ranked b ON b.supplier_id = a.supplier_id AND b.item_key = a.item_key AND b.rn = 2
       WHERE a.rn = 1 ${productId ? 'AND a.product_id = ?' : ''}
       ORDER BY a.day DESC, a.id DESC`
    )
    .bind(...(productId ? [productId] : []))
    .all();
  return results.map((r) => ({
    ...r,
    change_pt: r.prev_price_pt === null ? null : r.price_pt - r.prev_price_pt,
    change_pct: r.prev_price_pt ? Math.round(((r.price_pt - r.prev_price_pt) / r.prev_price_pt) * 1000) / 10 : null,
  }));
}
