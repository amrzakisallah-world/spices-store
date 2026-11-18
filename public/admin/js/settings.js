import { api, esc, toast, $, $$ } from '/js/common.js';
import { formSheet, money } from './ui.js';

export default async function render(main, { user }) {
  const isOwner = user.role === 'owner';
  const { settings: s } = await api('/api/admin/settings');
  const users = isOwner ? (await api('/api/admin/users')).users : [];
  main.innerHTML = `<div class="head"><h1>الإعدادات</h1></div><div class="split">
    <section class="card"><h2>المتجر والتوصيل</h2>${isOwner ? '<div id="store-form"></div>' : '<p class="muted">إعدادات المتجر متاحة للمالك فقط.</p>'}</section>
    <section><div class="card"><h2>حسابي</h2><p>${esc(user.name)} · <span class="muted">${esc(user.email)}</span> · ${user.role === 'owner' ? 'مالك' : 'موظف'}</p><button class="btn ghost" id="pw">تغيير كلمة المرور</button></div>
      ${isOwner ? `<div class="card" style="margin-top:1rem"><h2>المستخدمون</h2><div class="list">${users.map((u) => `<div class="alert" style="background:var(--sand)"><span>${esc(u.name)} <span class="muted">${esc(u.email)}</span> — ${u.role === 'owner' ? 'مالك' : 'موظف'} ${u.active ? '' : '<span class="badge danger">معطّل</span>'}</span>${u.id !== user.id ? `<button class="btn small ghost" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}</div>`).join('')}</div><button class="btn gold" id="adduser" style="margin-top:.6rem">+ مستخدم جديد</button><p class="muted" style="font-size:.85rem">لا يوجد تسجيل عام: الحسابات تُنشأ من هنا فقط. الموظف يرى الطلبات والمنتجات ولا يرى المالية.</p></div>` : ''}</section></div>`;
  $('#pw', main).onclick = () => formSheet({ title: 'تغيير كلمة المرور', submit: 'تغيير', fields: [{ name: 'current', label: 'كلمة المرور الحالية', type: 'password', required: true }, { name: 'next', label: 'كلمة المرور الجديدة (10 أحرف على الأقل)', type: 'password', required: true }],
    onSubmit: async (v, close) => { await api('/api/admin/password', { method: 'POST', body: v }); toast('تم التغيير، سجّل الدخول مرة أخرى'); close(); setTimeout(() => location.reload(), 800); } });
  if (!isOwner) return;
  const holder = $('#store-form', main);
  holder.innerHTML = '<form id="sf" novalidate></form>';
  const F = [['store_name_ar', 'اسم المتجر', 'text'], ['tagline_ar', 'الشعار', 'text'], ['whatsapp', 'رقم واتساب (بصيغة دولية بدون +)', 'text', '201012345678'], ['delivery_fee_pt', 'رسوم التوصيل (ج.م)', 'money'], ['free_delivery_over_pt', 'توصيل مجاني للطلبات من (ج.م) — 0 لإلغائه', 'money'], ['min_order_pt', 'الحد الأدنى للطلب (ج.م)', 'money'], ['delivery_info_ar', 'نص معلومات التوصيل', 'textarea'], ['announcement_ar', 'شريط إعلان أعلى المتجر (اختياري)', 'text']];
  const { toPt, ptToInput } = await import('/js/common.js');
  const form = $('#sf', main);
  form.innerHTML = F.map(([k, l, t, ph]) => `<div class="field"><label for="s_${k}">${l}</label>${t === 'textarea' ? `<textarea id="s_${k}" name="${k}">${esc(s[k])}</textarea>` : `<input id="s_${k}" name="${k}" type="text" ${t === 'money' ? 'inputmode="decimal"' : ''} value="${esc(t === 'money' ? ptToInput(parseInt(s[k], 10)) : s[k])}" ${ph ? `placeholder="${ph}" dir="ltr"` : ''}>`}<div class="err" data-err="${k}"></div></div>`).join('') + '<div class="err" id="s_err"></div><button class="btn gold" type="submit">حفظ الإعدادات</button>';
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); $$('[data-err]', form).forEach((x) => (x.textContent = ''));
    const body = {}; let bad = false;
    for (const [k, , t] of F) { const v = form.elements[k].value.trim(); if (t === 'money') { const pt = toPt(v === '' ? '0' : v); if (pt === null) { $(`[data-err="${k}"]`, form).textContent = 'مبلغ غير صحيح'; bad = true; } body[k] = pt; } else body[k] = v; }
    if (bad) return;
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('تم حفظ الإعدادات'); } catch (err) { for (const [k, m] of Object.entries(err.fields || {})) { const el = $(`[data-err="${k}"]`, form); if (el) el.textContent = m; } toast(err.message, 'err'); }
  });
  $('#adduser', main)?.addEventListener('click', () => formSheet({ title: 'مستخدم جديد', submit: 'إنشاء', fields: [{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'email', label: 'البريد الإلكتروني', type: 'email', required: true }, { name: 'password', label: 'كلمة المرور (10 أحرف على الأقل)', type: 'password', required: true }, { name: 'role', label: 'الصلاحية', type: 'select', options: [['staff', 'موظف (طلبات ومنتجات)'], ['owner', 'مالك (كل شيء)']] }],
    onSubmit: async (v, close) => { await api('/api/admin/users', { method: 'POST', body: v }); toast('تم إنشاء المستخدم'); close(); location.reload(); } }));
  $$('[data-toggle]', main).forEach((b) => (b.onclick = async () => { await api('/api/admin/users/' + b.dataset.toggle, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }); location.reload(); }));
}
