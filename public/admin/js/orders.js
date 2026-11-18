import { api, esc, egp, toast, STATUS_AR, PAY_AR, METHOD_AR, fmtDateTime, $, $$, toPt, ptToInput, todayCairo } from '/js/common.js';
import { sheet, formSheet, confirmBox, money } from './ui.js';

const STATUS_BADGE = { pending: 'info', confirmed: '', preparing: 'warn', out_for_delivery: 'warn', delivered: 'ok', cancelled: 'danger' };
const PAY_BADGE = { unpaid: 'danger', partial: 'warn', paid: 'ok' };
const NEXT = { pending: 'confirmed', confirmed: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' };
const NEXT_LABEL = { confirmed: 'تأكيد الطلب', preparing: 'بدء التجهيز', out_for_delivery: 'خرج للتوصيل', delivered: 'تم التسليم' };
const waLink = (phone) => { const d = phone.replace(/\D/g, ''); return 'https://wa.me/' + (d.startsWith('0') ? '2' + d : d); };

export default async function render(main, { user }) {
  const f = { status: 'open', payment: '', q: '', from: '', to: '' };
  async function load() {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const { orders, total } = await api('/api/admin/orders?' + qs);
    $('#list', main).innerHTML = orders.length
      ? `<div class="tbl-wrap"><table><thead><tr><th>الكود</th><th>التاريخ</th><th>العميل</th><th>المنطقة</th><th>الحالة</th><th>الدفع</th><th>الإجمالي</th><th>المتبقي</th></tr></thead><tbody>${orders.map((o) => `<tr data-open="${o.id}">
        <td class="num"><b>${esc(o.code)}</b></td><td>${esc(o.created_day)}</td><td>${esc(o.customer_name)}<br><span class="muted num">${esc(o.phone)}</span></td><td>${esc(o.area)}</td>
        <td><span class="badge ${STATUS_BADGE[o.status]}">${STATUS_AR[o.status]}</span></td><td><span class="badge ${PAY_BADGE[o.payment_status]}">${PAY_AR[o.payment_status]}</span></td>
        <td>${money(o.total_pt)}</td><td>${o.status === 'cancelled' ? '—' : money(o.total_pt - o.paid_pt)}</td></tr>`).join('')}</tbody></table></div><p class="muted">${orders.length} من ${total} طلب</p>`
      : '<div class="empty">لا توجد طلبات مطابقة.</div>';
    $$('[data-open]', main).forEach((r) => (r.onclick = () => openOrder(+r.dataset.open)));
  }
  main.innerHTML = `<div class="head"><h1>الطلبات</h1></div>
    <div class="tools" style="margin-block-end:1rem"><select id="fs" aria-label="الحالة"><option value="open">المفتوحة</option><option value="">كل الحالات</option>${Object.entries(STATUS_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="fp" aria-label="الدفع"><option value="">كل المدفوعات</option>${Object.entries(PAY_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="fq" type="search" placeholder="بحث: كود / اسم / هاتف" aria-label="بحث"><input id="ff" type="date" aria-label="من تاريخ"><input id="ft" type="date" aria-label="إلى تاريخ"></div><div id="list"><div class="spinner"></div></div>`;
  const bind = (id, key, ev = 'change') => $(id, main).addEventListener(ev, (e) => { f[key] = e.target.value; load(); });
  bind('#fs', 'status'); bind('#fp', 'payment'); bind('#ff', 'from'); bind('#ft', 'to');
  let t; $('#fq', main).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 300); });
  await load();

  async function openOrder(id) {
    const r = await api('/api/admin/orders/' + id);
    const o = r.order;
    const isOwner = user.role === 'owner';
    const open = o.status !== 'cancelled';
    const s = sheet(`طلب ${o.code}`, `
      <p><span class="badge ${STATUS_BADGE[o.status]}">${STATUS_AR[o.status]}</span> <span class="badge ${PAY_BADGE[o.payment_status]}">${PAY_AR[o.payment_status]}</span> <span class="muted">${fmtDateTime(o.created_at)}</span></p>
      <dl class="kv"><dt>العميل</dt><dd>${esc(o.customer_name)}</dd><dt>الهاتف</dt><dd><a class="num" href="tel:${esc(o.phone)}">${esc(o.phone)}</a> · <a href="${esc(waLink(o.phone))}" target="_blank" rel="noopener">واتساب</a></dd>
        <dt>المنطقة</dt><dd>${esc(o.area) || '—'}</dd><dt>العنوان</dt><dd style="white-space:pre-line">${esc(o.address)}</dd>${o.notes ? `<dt>ملاحظات العميل</dt><dd style="white-space:pre-line">${esc(o.notes)}</dd>` : ''}
        ${o.cancel_reason ? `<dt>سبب الإلغاء</dt><dd>${esc(o.cancel_reason)}</dd>` : ''}</dl>
      <h3 style="margin-top:1rem">الأصناف</h3><div class="tbl-wrap"><table><tbody>${r.items.map((i) => `<tr><td class="wrap">${esc(i.name_snapshot)} ${esc(i.unit_label_snapshot)}</td><td>${i.qty} × ${money(i.unit_price_pt)}</td><td>${money(i.line_total_pt)}</td></tr>`).join('')}</tbody></table></div>
      <dl class="kv" style="margin-top:.8rem"><dt>المنتجات</dt><dd>${money(o.subtotal_pt)}</dd><dt>رسوم التوصيل (على العميل)</dt><dd>${money(o.delivery_fee_pt)}</dd><dt>الخصم</dt><dd>${money(-o.discount_pt)}</dd>
        <dt>الإجمالي</dt><dd>${money(o.total_pt)}</dd><dt>المدفوع</dt><dd>${money(o.paid_pt)}</dd><dt>المتبقي</dt><dd>${money(open ? o.total_pt - o.paid_pt : 0)}</dd>
        <dt>تكلفة التوصيل الفعلية</dt><dd>${money(o.delivery_cost_pt)}</dd>${isOwner ? `<dt>ربح الطلب</dt><dd>${money(r.profit_pt)}</dd>` : ''}</dl>
      ${r.payments.length ? `<h3 style="margin-top:1rem">المدفوعات</h3>${r.payments.map((p) => `<div class="alert" style="background:var(--sand)"><span>${esc(p.day)} · ${METHOD_AR[p.method]}${p.note ? ' · ' + esc(p.note) : ''}</span><b>${money(p.amount_pt)}${isOwner && open ? ` <button class="btn small danger" data-delpay="${p.id}" aria-label="حذف الدفعة">✕</button>` : ''}</b></div>`).join('')}` : ''}
      ${o.admin_notes ? `<p class="muted">ملاحظات داخلية: ${esc(o.admin_notes)}</p>` : ''}
      <div class="actions" style="flex-wrap:wrap">${open && NEXT[o.status] ? `<button class="btn gold" data-next="${NEXT[o.status]}">${NEXT_LABEL[NEXT[o.status]]}</button>` : ''}
        ${open && o.paid_pt < o.total_pt ? '<button class="btn" data-pay>تسجيل دفعة</button>' : ''}${open ? '<button class="btn ghost" data-edit>تعديل التوصيل/الخصم</button>' : ''}
        ${open && o.status !== 'delivered' ? '<button class="btn ghost danger-text" data-cancel-order style="color:var(--danger)">إلغاء الطلب</button>' : ''}</div>`);
    const again = () => { s.close(); openOrder(id); load(); };
    const setStatus = async (status, extra = {}) => { await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: { status, ...extra } }); toast('تم تحديث الحالة'); again(); };
    $('[data-next]', s.el)?.addEventListener('click', (e) => setStatus(e.target.dataset.next).catch((err) => toast(err.message, 'err')));
    $$('[data-delpay]', s.el).forEach((b) => (b.onclick = async () => { if (await confirmBox('حذف الدفعة', 'سيتم حذف الدفعة وقيدها من حركة النقدية. متأكد؟')) { await api('/api/admin/payments/' + b.dataset.delpay, { method: 'DELETE' }).then(again).catch((err) => toast(err.message, 'err')); } }));
    $('[data-pay]', s.el)?.addEventListener('click', () => formSheet({ title: 'تسجيل دفعة', submit: 'حفظ الدفعة',
      fields: [{ name: 'amount_pt', label: 'المبلغ', type: 'money', hint: `المتبقي ${egp(o.total_pt - o.paid_pt)}` }, { name: 'method', label: 'طريقة الدفع', type: 'select', options: Object.entries(METHOD_AR) }, { name: 'day', label: 'التاريخ', type: 'date' }, { name: 'note', label: 'ملاحظة', type: 'text', required: false }],
      values: { amount_pt: o.total_pt - o.paid_pt, day: todayCairo() },
      onSubmit: async (v, close) => { await api(`/api/admin/orders/${id}/payments`, { method: 'POST', body: v }); toast('تم تسجيل الدفعة'); close(); again(); } }));
    $('[data-edit]', s.el)?.addEventListener('click', () => formSheet({ title: 'تعديل التوصيل والخصم',
      fields: [{ name: 'delivery_fee_pt', label: 'رسوم التوصيل على العميل', type: 'money' }, { name: 'delivery_cost_pt', label: 'تكلفة التوصيل الفعلية (علينا)', type: 'money', required: false, hint: 'تدخل في حساب الربح' }, { name: 'discount_pt', label: 'خصم', type: 'money', required: false }, { name: 'admin_notes', label: 'ملاحظات داخلية', type: 'textarea', required: false }],
      values: o,
      onSubmit: async (v, close) => { await api('/api/admin/orders/' + id, { method: 'PATCH', body: v }); toast('تم الحفظ'); close(); again(); } }));
    $('[data-cancel-order]', s.el)?.addEventListener('click', async () => {
      const hasPaid = o.paid_pt > 0;
      formSheet({ title: 'إلغاء الطلب', submit: 'تأكيد الإلغاء', fields: [{ name: 'reason', label: 'سبب الإلغاء', type: 'text', required: false }, ...(hasPaid ? [{ name: 'refund', label: `رد المبلغ المدفوع (${egp(o.paid_pt)}) للعميل`, type: 'checkbox' }] : [])],
        extra: '<p class="muted">سيرجع المخزون تلقائيًا. لا يمكن التراجع عن الإلغاء.</p>',
        onSubmit: async (v, close) => { await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: { status: 'cancelled', reason: v.reason, refund: !!v.refund } }); toast('تم إلغاء الطلب وإرجاع المخزون'); close(); again(); } });
    });
  }
}
