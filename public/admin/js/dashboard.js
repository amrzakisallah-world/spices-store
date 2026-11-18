import { api, egp, esc, $, $$ } from '/js/common.js';
import { barChart, delta, tabsBar, money } from './ui.js';

const PERIODS = [['day', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['year', 'السنة']];
const FULL = { day: 'اليوم', week: 'هذا الأسبوع (من السبت)', month: 'هذا الشهر', year: 'هذه السنة' };

export default async function render(main) {
  const d = await api('/api/admin/dashboard');
  let period = 'day';
  const kpi = (label, cur, prev, cls = '') => `<div class="kpi ${cls}"><small>${label}</small><div class="v num">${egp(cur)}</div>${delta(cur, prev)}</div>`;
  function draw() {
    const { current: c, previous: p } = d.periods[period];
    main.innerHTML = `<div class="head"><h1>لوحة التحكم</h1>${tabsBar(PERIODS, period)}</div>
      <p class="muted" style="margin-top:-.5rem">${FULL[period]}: ${c.from === c.to ? c.from : `${c.from} ← ${c.to}`}</p>
      <div class="kpis">
        ${kpi('الإيراد (طلبات مُسلَّمة)', c.revenue_pt, p.revenue_pt)}
        ${kpi('تكلفة البضاعة المباعة', c.cogs_pt, p.cogs_pt)}
        ${kpi('إجمالي ربح المنتجات', c.gross_profit_pt, p.gross_profit_pt)}
        ${kpi('المصروفات', c.expenses_pt, p.expenses_pt)}
        ${kpi('صافي الربح', c.net_profit_pt, p.net_profit_pt, 'profit')}
        <div class="kpi"><small>طلبات مكتملة / ملغاة</small><div class="v num">${c.orders_completed} / ${c.orders_cancelled}</div><span class="d flat">${c.orders_received} طلب وارد</span></div>
        ${kpi('نقد داخل', c.cash_in_pt, p.cash_in_pt)}
        ${kpi('نقد خارج', c.cash_out_pt, p.cash_out_pt)}
      </div>
      <p class="muted" style="font-size:.85rem">صافي الربح = ربح المنتجات (المبيعات − تكلفة البضاعة) + هامش التوصيل − المصروفات. الإيراد ليس ربحًا.</p>
      <div class="split" style="margin-block:1rem">
        <section class="card"><h2>المستحقات والنقدية</h2><dl class="kv">
          <dt>رصيد النقدية (إجمالي)</dt><dd>${money(d.cash_balance_pt)}</dd>
          <dt>طلبات مُسلَّمة غير مسدّدة</dt><dd>${money(d.outstanding.delivered_unpaid_pt)}</dd>
          <dt>طلبات جارية غير مسدّدة</dt><dd>${money(d.outstanding.open_unpaid_pt)}</dd>
          <dt>مستحقات للموردين</dt><dd>${money(d.outstanding.supplier_payable_pt)}</dd>
          <dt>طلبات مفتوحة الآن</dt><dd><a href="#/orders">${d.open_orders}</a></dd></dl></section>
        <section class="card"><h2>تنبيهات</h2><div class="alerts">${d.alerts.length ? d.alerts.map((a) => `<div class="alert ${a.level === 'info' ? '' : a.level}"><span>${esc(a.text)}</span>${a.amount_pt ? `<b class="num">${egp(a.amount_pt)}</b>` : ''}</div>`).join('') : '<div class="empty" style="padding:1rem">لا توجد تنبيهات ✓</div>'}</div></section>
      </div>
      <h2>آخر 30 يومًا</h2>${barChart(d.daily_series, (r) => r.period.slice(5))}
      <h2>شهور السنة</h2>${barChart(d.monthly_series, (r) => r.period.slice(5))}`;
    $$('[data-seg]', main).forEach((b) => (b.onclick = () => { period = b.dataset.seg; draw(); }));
  }
  draw();
}
