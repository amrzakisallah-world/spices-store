import { get, post, del } from '../lib/core.js';
import { HttpError, json, Validator, cairoDay, isDay, fmtMoney, SECURITY_HEADERS } from '../lib/util.js';
import { summary, series, periodRange, previousRange, alerts } from '../lib/reports.js';

export const EXPENSE_CATEGORIES = ['إيجار', 'مرتبات', 'تغليف', 'توصيل', 'كهرباء ومياه', 'تسويق وإعلانات', 'صيانة', 'مواصلات', 'أخرى'];

function range(ctx) {
  const p = ctx.url.searchParams;
  const today = cairoDay();
  const from = p.get('from') || today.slice(0, 8) + '01';
  const to = p.get('to') || today;
  if (!isDay(from) || !isDay(to) || from > to) throw new HttpError(400, 'نطاق التاريخ غير صالح');
  if ((new Date(to) - new Date(from)) / 86400000 > 366 * 15) throw new HttpError(400, 'نطاق التاريخ كبير جدًا');
  return { from, to };
}

get('/api/admin/dashboard', async (ctx) => {
  const today = cairoDay();
  const out = {};
  for (const period of ['day', 'week', 'month', 'year']) {
    const r = periodRange(period, today);
    const prev = previousRange(r.from, r.to);
    out[period] = { current: await summary(ctx.db, r.from, r.to), previous: await summary(ctx.db, prev.from, prev.to) };
  }
  const m = periodRange('month', today);
  const open = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('delivered','cancelled')`).first();
  const recv = await ctx.db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN status='delivered' THEN total_pt - paid_pt END),0) AS delivered_unpaid,
                     COALESCE(SUM(CASE WHEN status NOT IN ('delivered','cancelled') THEN total_pt - paid_pt END),0) AS open_unpaid
              FROM orders WHERE status <> 'cancelled' AND total_pt > paid_pt`)
    .first();
  const pay = await ctx.db.prepare('SELECT COALESCE(SUM(total_pt - paid_pt),0) AS s FROM supplier_purchases WHERE total_pt > paid_pt').first();
  const cash = await ctx.db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_pt ELSE -amount_pt END),0) AS balance FROM cash_ledger`).first();
  return json({
    periods: out,
    daily_series: await series(ctx.db, cairoDayAdd(today, -29), today, 'day'),
    monthly_series: await series(ctx.db, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`, 'month'),
    open_orders: open.n,
    outstanding: { delivered_unpaid_pt: recv.delivered_unpaid, open_unpaid_pt: recv.open_unpaid, supplier_payable_pt: pay.s },
    cash_balance_pt: cash.balance,
    alerts: await alerts(ctx.db),
    month_range: m,
  });
}, 'owner');
function cairoDayAdd(day, n) {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

get('/api/admin/reports/pnl', async (ctx) => {
  const { from, to } = range(ctx);
  const group = ['day', 'month', 'year'].includes(ctx.url.searchParams.get('group')) ? ctx.url.searchParams.get('group') : 'month';
  const { results: cats } = await ctx.db.prepare('SELECT category, SUM(amount_pt) AS total_pt FROM expenses WHERE day BETWEEN ? AND ? GROUP BY category ORDER BY total_pt DESC').bind(from, to).all();
  const { results: top } = await ctx.db
    .prepare(`SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total_pt) AS sales_pt, SUM(oi.line_total_pt - oi.unit_cost_pt * oi.qty) AS profit_pt
              FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status='delivered' AND o.completed_day BETWEEN ? AND ?
              GROUP BY oi.name_snapshot ORDER BY profit_pt DESC LIMIT 15`)
    .bind(from, to).all();
  return json({ summary: await summary(ctx.db, from, to), series: await series(ctx.db, from, to, group), expenses_by_category: cats, top_products: top });
}, 'owner');

// ---------- Expenses ----------
get('/api/admin/expenses', async (ctx) => {
  const { from, to } = range(ctx);
  const { results } = await ctx.db.prepare('SELECT * FROM expenses WHERE day BETWEEN ? AND ? ORDER BY day DESC, id DESC LIMIT 1000').bind(from, to).all();
  return json({ expenses: results, categories: EXPENSE_CATEGORIES, total_pt: results.reduce((s, r) => s + r.amount_pt, 0) });
}, 'owner');

post('/api/admin/expenses', async (ctx) => {
  const d = new Validator(await ctx.body()).str('category', { max: 40, label: 'التصنيف' }).int('amount_pt', { min: 1, max: 1_000_000_000, label: 'المبلغ' }).str('note', { max: 300, required: false }).day('day', { label: 'التاريخ' }).done();
  const batch = await ctx.db.batch([
    ctx.db.prepare('INSERT INTO expenses (category, amount_pt, note, day, user_id) VALUES (?,?,?,?,?)').bind(d.category, d.amount_pt, d.note, d.day, ctx.user.id),
    ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, ref_id, note, user_id) VALUES (?, 'out', ?, 'expense', 'expense', (SELECT last_insert_rowid()), ?, ?)`).bind(d.day, d.amount_pt, `${d.category}${d.note ? ' — ' + d.note : ''}`, ctx.user.id),
  ]);
  return json({ ok: true, id: batch[0].meta.last_row_id }, 201);
}, 'owner');

del('/api/admin/expenses/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  await ctx.db.batch([
    ctx.db.prepare(`DELETE FROM cash_ledger WHERE ref_type='expense' AND ref_id = ?`).bind(id),
    ctx.db.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}, 'owner');

// ---------- Cash ledger ----------
get('/api/admin/ledger', async (ctx) => {
  const { from, to } = range(ctx);
  const { results } = await ctx.db.prepare('SELECT * FROM cash_ledger WHERE day BETWEEN ? AND ? ORDER BY day DESC, id DESC LIMIT 2000').bind(from, to).all();
  const bal = await ctx.db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_pt ELSE -amount_pt END),0) AS b FROM cash_ledger`).first();
  return json({ entries: results, balance_pt: bal.b });
}, 'owner');

// Manual income or other cash-out that is not an order payment or a standard expense.
post('/api/admin/ledger', async (ctx) => {
  const d = new Validator(await ctx.body()).oneOf('direction', ['in', 'out'], { label: 'النوع' }).int('amount_pt', { min: 1, max: 1_000_000_000, label: 'المبلغ' }).str('note', { min: 2, max: 300, label: 'البيان' }).day('day', { label: 'التاريخ' }).done();
  const r = await ctx.db.prepare(`INSERT INTO cash_ledger (day, direction, amount_pt, category, ref_type, note, user_id) VALUES (?,?,?,?, 'manual', ?, ?)`)
    .bind(d.day, d.direction, d.amount_pt, d.direction === 'in' ? 'other_income' : 'other_out', d.note, ctx.user.id).run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}, 'owner');

del('/api/admin/ledger/:id', async (ctx) => {
  const row = await ctx.db.prepare('SELECT ref_type FROM cash_ledger WHERE id = ?').bind(parseInt(ctx.params.id, 10)).first();
  if (!row) throw new HttpError(404, 'القيد غير موجود');
  if (row.ref_type !== 'manual') throw new HttpError(400, 'احذف القيد من مصدره (الطلب أو المصروف أو فاتورة المورد)');
  await ctx.db.prepare('DELETE FROM cash_ledger WHERE id = ?').bind(parseInt(ctx.params.id, 10)).run();
  return json({ ok: true });
}, 'owner');

// ---------- CSV export ----------
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const STATUS_AR = { pending: 'جديد', confirmed: 'مؤكد', preparing: 'قيد التجهيز', out_for_delivery: 'في الطريق', delivered: 'تم التسليم', cancelled: 'ملغي' };

get('/api/admin/export/:type', async (ctx) => {
  const { from, to } = range(ctx);
  const t = ctx.params.type;
  let rows;
  if (t === 'orders') {
    const { results } = await ctx.db.prepare('SELECT * FROM orders WHERE created_day BETWEEN ? AND ? ORDER BY id').bind(from, to).all();
    rows = [['الكود', 'التاريخ', 'العميل', 'الهاتف', 'العنوان', 'الحالة', 'المنتجات', 'رسوم التوصيل', 'الخصم', 'الإجمالي', 'المدفوع', 'تكلفة التوصيل'],
      ...results.map((o) => [o.code, o.created_day, o.customer_name, o.phone, o.address, STATUS_AR[o.status], fmtMoney(o.subtotal_pt), fmtMoney(o.delivery_fee_pt), fmtMoney(o.discount_pt), fmtMoney(o.total_pt), fmtMoney(o.paid_pt), fmtMoney(o.delivery_cost_pt)])];
  } else if (t === 'expenses') {
    const { results } = await ctx.db.prepare('SELECT * FROM expenses WHERE day BETWEEN ? AND ? ORDER BY day, id').bind(from, to).all();
    rows = [['التاريخ', 'التصنيف', 'المبلغ', 'ملاحظة'], ...results.map((e) => [e.day, e.category, fmtMoney(e.amount_pt), e.note])];
  } else if (t === 'ledger') {
    const { results } = await ctx.db.prepare('SELECT * FROM cash_ledger WHERE day BETWEEN ? AND ? ORDER BY day, id').bind(from, to).all();
    rows = [['التاريخ', 'الاتجاه', 'المبلغ', 'النوع', 'البيان'], ...results.map((e) => [e.day, e.direction === 'in' ? 'داخل' : 'خارج', fmtMoney(e.amount_pt), e.category, e.note])];
  } else if (t === 'pnl') {
    const group = ['day', 'month', 'year'].includes(ctx.url.searchParams.get('group')) ? ctx.url.searchParams.get('group') : 'month';
    const s = await series(ctx.db, from, to, group);
    rows = [['الفترة', 'عدد الطلبات', 'الإيراد', 'مبيعات المنتجات', 'تكلفة البضاعة', 'هامش التوصيل', 'المصروفات', 'صافي الربح', 'نقد داخل', 'نقد خارج'],
      ...s.map((r) => [r.period, r.orders, ...[r.revenue_pt, r.product_sales_pt, r.cogs_pt, r.delivery_margin_pt, r.expenses_pt, r.net_profit_pt, r.cash_in_pt, r.cash_out_pt].map(fmtMoney)])];
  } else throw new HttpError(404, 'نوع التصدير غير معروف');
  return new Response(toCsv(rows), { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${t}-${from}_${to}.csv"` } });
}, 'owner');
