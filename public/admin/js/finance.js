import { api, esc, egp, toast, $, $$, todayCairo } from '/js/common.js';
import { formSheet, confirmBox, barChart, tabsBar, downloadCsv, monthStart, money } from './ui.js';

const GROUPS = [['day', 'يومي'], ['month', 'شهري'], ['year', 'سنوي']];
const CAT_AR = { order_payment: 'دفعة طلب', order_refund: 'رد مبلغ', expense: 'مصروف', supplier_payment: 'دفعة مورد', other_income: 'إيراد آخر', other_out: 'مصروف نقدي آخر' };

export default async function render(main) {
  const st = { tab: 'pnl', from: monthStart(), to: todayCairo(), group: 'month' };
  async function draw() {
    main.innerHTML = `<div class="head"><h1>المالية</h1>${tabsBar([['pnl', 'الأرباح والخسائر'], ['expenses', 'المصروفات'], ['ledger', 'حركة النقدية']], st.tab)}</div>
      <div class="tools" style="margin-block-end:1rem"><label>من <input type="date" id="from" value="${st.from}"></label><label>إلى <input type="date" id="to" value="${st.to}"></label>
        ${st.tab === 'pnl' ? tabsBar(GROUPS, st.group).replace('class="seg"', 'class="seg" id="grp"') : ''}</div><div id="body"><div class="spinner"></div></div>`;
    $$('[data-seg]', main).forEach((b) => (b.onclick = () => { if (['pnl', 'expenses', 'ledger'].includes(b.dataset.seg)) st.tab = b.dataset.seg; else st.group = b.dataset.seg; draw(); }));
    $('#from', main).onchange = (e) => { st.from = e.target.value; draw(); };
    $('#to', main).onchange = (e) => { st.to = e.target.value; draw(); };
    const qs = `from=${st.from}&to=${st.to}`;
    try {
      if (st.tab === 'pnl') await pnl(qs); else if (st.tab === 'expenses') await expenses(qs); else await ledger(qs);
    } catch (e) { $('#body', main).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  const csvBtn = (type, extra = '') => `<button class="btn ghost small" data-csv="${type}">⬇ تصدير CSV</button>`;
  const bindCsv = () => $$('[data-csv]', main).forEach((b) => (b.onclick = () => downloadCsv(`/api/admin/export/${b.dataset.csv}?from=${st.from}&to=${st.to}&group=${st.group}`, `${b.dataset.csv}-${st.from}_${st.to}.csv`).catch((e) => toast(e.message, 'err'))));

  async function pnl(qs) {
    const r = await api(`/api/admin/reports/pnl?${qs}&group=${st.group}`);
    const s = r.summary;
    const row = (l, v, strong) => `<tr><td>${l}</td><td style="text-align:end">${strong ? '<b>' : ''}${money(v)}${strong ? '</b>' : ''}</td></tr>`;
    $('#body', main).innerHTML = `<div class="split"><section><h2>قائمة الدخل</h2><div class="tbl-wrap"><table><tbody>
        ${row('مبيعات المنتجات (بعد الخصم)', s.product_sales_pt)}${row('− تكلفة البضاعة المباعة', -s.cogs_pt)}${row('= إجمالي ربح المنتجات', s.gross_profit_pt, true)}
        ${row('+ رسوم التوصيل المحصّلة', s.delivery_fees_pt)}${row('− تكلفة التوصيل الفعلية', -s.delivery_cost_pt)}${row('− المصروفات التشغيلية', -s.expenses_pt)}${row('= صافي الربح', s.net_profit_pt, true)}</tbody></table></div>
        <p class="muted" style="font-size:.85rem">${s.orders_completed} طلب مُسلَّم · هامش ربح المنتجات ${s.gross_margin_pct === null ? '—' : s.gross_margin_pct + '%'} · الإيراد الإجمالي ${egp(s.revenue_pt)}. مشتريات المخزون لا تُحسب مصروفًا؛ تدخل في الربح عبر تكلفة ما بِيع.</p></section>
      <section><h2>التدفق النقدي</h2><div class="tbl-wrap"><table><tbody>${row('نقد داخل', s.cash_in_pt)}${row('نقد خارج', -s.cash_out_pt)}${row('صافي النقدية', s.net_cash_pt, true)}</tbody></table></div>
        <h2 style="margin-top:1rem">المصروفات حسب التصنيف</h2>${r.expenses_by_category.length ? `<div class="tbl-wrap"><table><tbody>${r.expenses_by_category.map((c) => `<tr><td>${esc(c.category)}</td><td style="text-align:end">${money(c.total_pt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:1rem">لا مصروفات.</div>'}</section></div>
      <h2 style="margin-top:1rem">الأداء عبر الفترات ${csvBtn('pnl')}</h2>${barChart(r.series)}
      ${r.series.length ? `<div class="tbl-wrap"><table><thead><tr><th>الفترة</th><th>طلبات</th><th>الإيراد</th><th>تكلفة البضاعة</th><th>المصروفات</th><th>صافي الربح</th></tr></thead><tbody>${r.series.map((x) => `<tr><td class="num">${x.period}</td><td>${x.orders}</td><td>${money(x.revenue_pt)}</td><td>${money(x.cogs_pt)}</td><td>${money(x.expenses_pt)}</td><td><b>${money(x.net_profit_pt)}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2 style="margin-top:1rem">أفضل المنتجات ربحًا</h2>${r.top_products.length ? `<div class="tbl-wrap"><table><thead><tr><th>المنتج</th><th>الكمية</th><th>المبيعات</th><th>الربح</th></tr></thead><tbody>${r.top_products.map((t) => `<tr><td class="wrap">${esc(t.name)}</td><td>${t.qty}</td><td>${money(t.sales_pt)}</td><td>${money(t.profit_pt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty" style="padding:1rem">لا مبيعات مكتملة في هذه الفترة.</div>'}
      <p style="margin-top:1rem"><button class="btn ghost small" id="print">🖨 طباعة / حفظ PDF</button></p>`;
    $('#print', main).onclick = () => window.print();
    bindCsv();
  }

  async function expenses(qs) {
    const r = await api('/api/admin/expenses?' + qs);
    $('#body', main).innerHTML = `<div class="head"><h2 style="margin:0">إجمالي المصروفات: ${money(r.total_pt)}</h2><div class="tools"><button class="btn gold" id="addx">+ مصروف جديد</button>${csvBtn('expenses')}</div></div>
      ${r.expenses.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>التصنيف</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead><tbody>${r.expenses.map((e) => `<tr><td class="num">${esc(e.day)}</td><td>${esc(e.category)}</td><td>${money(e.amount_pt)}</td><td class="wrap">${esc(e.note)}</td><td><button class="btn small danger" data-del="${e.id}" aria-label="حذف">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد مصروفات في هذه الفترة.</div>'}`;
    $('#addx', main).onclick = () => formSheet({ title: 'مصروف جديد', fields: [
      { name: 'category', label: 'التصنيف', type: 'select', options: r.categories.map((c) => [c, c]) }, { name: 'amount_pt', label: 'المبلغ', type: 'money' }, { name: 'day', label: 'التاريخ', type: 'date' }, { name: 'note', label: 'ملاحظة', type: 'text', required: false }],
      values: { day: todayCairo() }, onSubmit: async (v, close) => { await api('/api/admin/expenses', { method: 'POST', body: v }); toast('تم تسجيل المصروف'); close(); draw(); } });
    $$('[data-del]', main).forEach((b) => (b.onclick = async () => { if (await confirmBox('حذف المصروف', 'سيُحذف المصروف وقيده من حركة النقدية.')) { await api('/api/admin/expenses/' + b.dataset.del, { method: 'DELETE' }); draw(); } }));
    bindCsv();
  }

  async function ledger(qs) {
    const r = await api('/api/admin/ledger?' + qs);
    $('#body', main).innerHTML = `<div class="head"><h2 style="margin:0">رصيد النقدية الكلي: ${money(r.balance_pt)}</h2><div class="tools"><button class="btn gold" id="addl">+ حركة يدوية</button>${csvBtn('ledger')}</div></div>
      ${r.entries.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>داخل</th><th>خارج</th><th>البيان</th><th></th></tr></thead><tbody>${r.entries.map((e) => `<tr><td class="num">${esc(e.day)}</td><td><span class="badge">${CAT_AR[e.category]}</span></td><td class="pos">${e.direction === 'in' ? `<span class="num">${egp(e.amount_pt)}</span>` : ''}</td><td class="neg">${e.direction === 'out' ? `<span class="num">${egp(e.amount_pt)}</span>` : ''}</td><td class="wrap">${esc(e.note)}</td><td>${e.ref_type === 'manual' ? `<button class="btn small danger" data-del="${e.id}" aria-label="حذف">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد حركات في هذه الفترة.</div>'}`;
    $('#addl', main).onclick = () => formSheet({ title: 'حركة نقدية يدوية', fields: [
      { name: 'direction', label: 'النوع', type: 'select', options: [['in', 'داخل (إيراد آخر)'], ['out', 'خارج (مصروف نقدي آخر)']] }, { name: 'amount_pt', label: 'المبلغ', type: 'money' }, { name: 'day', label: 'التاريخ', type: 'date' }, { name: 'note', label: 'البيان', type: 'text', required: true }],
      values: { day: todayCairo() }, extra: '<p class="muted">لتسجيل مصروف تشغيلي استخدم تبويب «المصروفات» حتى يدخل في حساب الربح.</p>', onSubmit: async (v, close) => { await api('/api/admin/ledger', { method: 'POST', body: v }); toast('تم التسجيل'); close(); draw(); } });
    $$('[data-del]', main).forEach((b) => (b.onclick = async () => { if (await confirmBox('حذف الحركة', 'متأكد؟')) { await api('/api/admin/ledger/' + b.dataset.del, { method: 'DELETE' }); draw(); } }));
    bindCsv();
  }
  draw();
}
