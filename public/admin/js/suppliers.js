import { api, esc, egp, toast, toPt, $, $$, todayCairo } from '/js/common.js';
import { sheet, formSheet, tabsBar, money } from './ui.js';

const chg = (c) => (c.change_pct === null ? '<span class="muted">—</span>' : `<span class="${c.change_pt > 0 ? 'neg' : c.change_pt < 0 ? 'pos' : 'muted'} num">${c.change_pt > 0 ? '▲' : c.change_pt < 0 ? '▼' : ''} ${Math.abs(c.change_pct)}%</span>`);

export default async function render(main) {
  let tab = 'prices';
  const [{ suppliers }, { products }] = await Promise.all([api('/api/admin/suppliers'), api('/api/admin/products')]);
  let sups = suppliers;
  const supOpts = () => sups.filter((s) => s.active).map((s) => [s.id, s.name]);
  const prodOpts = [['', 'صنف آخر (اكتب الاسم)'], ...products.map((p) => [p.id, `${p.name_ar} ${p.unit_label}`])];

  async function draw() {
    main.innerHTML = `<div class="head"><h1>الموردون والأسعار</h1>${tabsBar([['prices', 'أسعار الموردين'], ['invoices', 'فواتير الشراء'], ['suppliers', 'الموردون']], tab)}</div><div id="body"><div class="spinner"></div></div>`;
    $$('[data-seg]', main).forEach((b) => (b.onclick = () => { tab = b.dataset.seg; draw(); }));
    try { await ({ prices, invoices, suppliers: supList })[tab](); } catch (e) { $('#body', main).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function prices() {
    const [{ items }, { products: cmp }] = await Promise.all([api('/api/admin/supplier-prices/latest'), api('/api/admin/supplier-prices/compare')]);
    $('#body', main).innerHTML = `<div class="notice" style="background:#fbf0d6;border:1px solid #ecd49b;border-radius:12px;padding:.6rem .9rem;margin-block-end:1rem">أسعار حراز وباقي الموردين <b>تُدخَل يدويًا</b> (أو من فواتير الشراء) وتُحفظ كل مرة للمقارنة التاريخية. لا يوجد ربط مباشر بأسعار السوق.</div>
      <div class="head"><h2 style="margin:0">آخر سعر لكل صنف</h2><button class="btn gold" id="addp">+ تسجيل سعر</button></div>
      ${items.length ? `<div class="tbl-wrap"><table><thead><tr><th>المورد</th><th>الصنف</th><th>الوحدة</th><th>آخر سعر</th><th>السعر السابق</th><th>التغيّر</th><th>التاريخ</th></tr></thead><tbody>${items.map((i) => `<tr data-hist="${esc(i.item_key)}" data-sup="${i.supplier_id}" data-open><td>${esc(i.supplier_name)}</td><td class="wrap">${esc(i.item_name)}</td><td>${esc(i.unit)}</td><td>${money(i.price_pt)}</td><td>${i.prev_price_pt === null ? '—' : money(i.prev_price_pt)}</td><td>${chg(i)}</td><td class="num">${esc(i.day)}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:.85rem">اضغط على أي صف لعرض تاريخ الأسعار.</p>` : '<div class="empty">لم تُسجَّل أسعار بعد. اضغط «تسجيل سعر» لإدخال سعر حراز أو أي مورد.</div>'}
      <h2 style="margin-top:1.4rem">مقارنة التكلفة بسعر البيع</h2>
      <div class="tbl-wrap"><table><thead><tr><th>المنتج</th><th>سعر البيع</th><th>التكلفة المسجلة</th><th>أفضل سعر مورد</th><th>هامش الربح</th></tr></thead><tbody>${cmp.map((c) => `<tr><td class="wrap">${esc(c.name)} <span class="muted">${esc(c.unit_label)}</span></td><td>${money(c.selling_price_pt)}</td><td>${money(c.current_cost_pt)}${c.cost_differs_from_best ? ' <span class="badge warn" title="التكلفة المسجلة تختلف عن أفضل سعر مورد">راجع</span>' : ''}</td>
        <td>${c.best_offer_pt === null ? '<span class="muted">—</span>' : `${money(c.best_offer_pt)} <span class="muted">(${esc(c.offers[0].supplier_name)})</span>`}</td><td><span class="${c.margin_pt <= 0 ? 'neg' : 'pos'} num">${egp(c.margin_pt)}${c.margin_pct === null ? '' : ` · ${c.margin_pct}%`}</span></td></tr>`).join('')}</tbody></table></div>`;
    $('#addp', main).onclick = () => priceForm();
    $$('[data-hist]', main).forEach((r) => (r.onclick = async () => {
      const { prices: h } = await api(`/api/admin/supplier-prices?supplier_id=${r.dataset.sup}&item_key=${encodeURIComponent(r.dataset.hist)}`);
      sheet('تاريخ الأسعار', `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>السعر</th><th>المصدر</th><th>ملاحظة</th></tr></thead><tbody>${h.map((x) => `<tr><td class="num">${esc(x.day)}</td><td>${money(x.price_pt)}</td><td>${x.source === 'purchase' ? 'فاتورة' : 'يدوي'}</td><td class="wrap">${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>`);
    }));
  }
  function priceForm() {
    formSheet({ title: 'تسجيل سعر مورد', submit: 'حفظ السعر', values: { day: todayCairo(), supplier_id: (sups.find((s) => s.name === 'حراز') || sups[0])?.id },
      fields: [{ name: 'supplier_id', label: 'المورد', type: 'select', options: supOpts(), numeric: true }, { name: 'product_id', label: 'المنتج في متجرك', type: 'select', options: prodOpts, numeric: true, hint: 'السعر هنا = سعر وحدة المنتج المعروضة (مثلًا عبوة 250 جم)' },
        { name: 'item_name', label: 'اسم الصنف (لو غير مرتبط بمنتج)', type: 'text', required: false }, { name: 'price_pt', label: 'السعر', type: 'money' }, { name: 'unit', label: 'الوحدة', type: 'text', required: false, placeholder: 'كجم / عبوة 250 جم' }, { name: 'day', label: 'تاريخ السعر', type: 'date' }, { name: 'note', label: 'ملاحظة', type: 'text', required: false },
        { name: 'update_product_cost', label: 'اجعله تكلفة المنتج في متجري', type: 'checkbox' }],
      onSubmit: async (v, close) => { await api('/api/admin/supplier-prices', { method: 'POST', body: { ...v, product_id: v.product_id || null } }); toast('تم حفظ السعر'); close(); draw(); } });
  }

  async function invoices() {
    const { purchases } = await api('/api/admin/purchases');
    $('#body', main).innerHTML = `<div class="head"><h2 style="margin:0">فواتير الشراء</h2><button class="btn gold" id="addi">+ فاتورة شراء</button></div>
      ${purchases.length ? `<div class="tbl-wrap"><table><thead><tr><th>التاريخ</th><th>المورد</th><th>رقم الفاتورة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead><tbody>${purchases.map((p) => `<tr data-open="${p.id}"><td class="num">${esc(p.day)}</td><td>${esc(p.supplier_name)}</td><td>${esc(p.invoice_no) || '—'}</td><td>${money(p.total_pt)}</td><td>${money(p.paid_pt)}</td><td>${p.total_pt > p.paid_pt ? `<b class="neg num">${egp(p.total_pt - p.paid_pt)}</b>` : '<span class="badge ok">مسدّدة</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد فواتير شراء بعد.</div>'}`;
    $('#addi', main).onclick = invoiceForm;
    $$('[data-open]', main).forEach((r) => (r.onclick = async () => {
      const { purchase: p, items } = await api('/api/admin/purchases/' + r.dataset.open);
      const rem = p.total_pt - p.paid_pt;
      const s = sheet(`فاتورة ${p.invoice_no || '#' + p.id}`, `<p>${esc(p.supplier_name)} · <span class="num">${esc(p.day)}</span></p><div class="tbl-wrap"><table><tbody>${items.map((i) => `<tr><td class="wrap">${esc(i.item_name)}</td><td>${i.qty} ${esc(i.unit)} × ${money(i.unit_price_pt)}</td><td>${money(i.line_total_pt)}</td></tr>`).join('')}</tbody></table></div>
        <dl class="kv" style="margin-top:.8rem"><dt>الإجمالي</dt><dd>${money(p.total_pt)}</dd><dt>المدفوع</dt><dd>${money(p.paid_pt)}</dd><dt>المتبقي</dt><dd>${money(rem)}</dd></dl>${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}
        ${rem > 0 ? '<div class="actions"><button class="btn gold" id="payp">تسجيل دفعة للمورد</button></div>' : ''}`);
      $('#payp', s.el)?.addEventListener('click', () => formSheet({ title: 'دفعة للمورد', fields: [{ name: 'amount_pt', label: 'المبلغ', type: 'money' }, { name: 'day', label: 'التاريخ', type: 'date' }], values: { amount_pt: rem, day: todayCairo() },
        onSubmit: async (v, close) => { await api(`/api/admin/purchases/${p.id}/payments`, { method: 'POST', body: v }); toast('تم تسجيل الدفعة'); close(); s.close(); draw(); } }));
    }));
  }

  function invoiceForm() {
    const rowHtml = (i) => `<div class="card" data-row style="margin-block-end:.6rem"><div class="field"><label>المنتج</label><select data-f="product_id">${prodOpts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>اسم الصنف (لو غير مرتبط بمنتج)</label><input data-f="item_name" type="text" maxlength="100"></div>
      <div class="grid2"><div class="field"><label>الكمية</label><input data-f="qty" type="text" inputmode="decimal" value="1"></div><div class="field"><label>سعر الوحدة (ج.م)</label><input data-f="price" type="text" inputmode="decimal"></div></div>
      <label class="check"><input type="checkbox" data-f="add_to_stock"> أضف الكمية للمخزون</label><label class="check" style="margin-top:.3rem"><input type="checkbox" data-f="update_cost"> حدّث تكلفة المنتج</label>
      <button type="button" class="btn small ghost" data-rm style="margin-top:.5rem;color:var(--danger)">حذف الصنف</button></div>`;
    const s = sheet('فاتورة شراء جديدة', `<form novalidate><div class="field"><label for="p_sup">المورد</label><select id="p_sup">${supOpts().map(([k, l]) => `<option value="${k}" ${l === 'حراز' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="grid2"><div class="field"><label for="p_inv">رقم الفاتورة</label><input id="p_inv" type="text" maxlength="40"></div><div class="field"><label for="p_day">التاريخ</label><input id="p_day" type="date" value="${todayCairo()}"></div></div>
      <div id="rows">${rowHtml()}</div><button type="button" class="btn ghost small" id="more">+ صنف آخر</button>
      <div class="field" style="margin-top:1rem"><label for="p_paid">المدفوع الآن (ج.م)</label><input id="p_paid" type="text" inputmode="decimal" value="0"></div><div class="field"><label for="p_note">ملاحظة</label><input id="p_note" type="text" maxlength="300"></div>
      <div class="err" id="p_err" role="alert"></div><div class="actions"><button class="btn gold" type="submit">حفظ الفاتورة</button><button class="btn ghost" type="button" id="p_cancel">إلغاء</button></div></form>`);
    const el = s.el;
    $('#p_cancel', el).onclick = s.close;
    const wire = () => $$('[data-rm]', el).forEach((b) => (b.onclick = () => { if ($$('[data-row]', el).length > 1) b.closest('[data-row]').remove(); }));
    $('#more', el).onclick = () => { $('#rows', el).insertAdjacentHTML('beforeend', rowHtml()); wire(); };
    wire();
    $('form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#p_err', el); err.textContent = '';
      const items = [];
      for (const [i, r] of $$('[data-row]', el).entries()) {
        const g = (k) => $(`[data-f="${k}"]`, r);
        const price = toPt(g('price').value); const qty = parseFloat(g('qty').value.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(',', '.'));
        if (price === null || !(qty > 0)) { err.textContent = `راجع الكمية والسعر في الصنف ${i + 1}`; return; }
        items.push({ product_id: g('product_id').value ? +g('product_id').value : null, item_name: g('item_name').value.trim(), qty, unit_price_pt: price, add_to_stock: g('add_to_stock').checked, update_cost: g('update_cost').checked });
      }
      const paid = toPt($('#p_paid', el).value || '0');
      if (paid === null) { err.textContent = 'المبلغ المدفوع غير صحيح'; return; }
      try {
        await api('/api/admin/purchases', { method: 'POST', body: { supplier_id: +$('#p_sup', el).value, invoice_no: $('#p_inv', el).value.trim(), day: $('#p_day', el).value, paid_pt: paid, note: $('#p_note', el).value.trim(), items } });
        toast('تم حفظ الفاتورة'); s.close(); draw();
      } catch (ex) { err.textContent = ex.message; }
    });
  }

  async function supList() {
    const r = await api('/api/admin/suppliers'); sups = r.suppliers;
    $('#body', main).innerHTML = `<div class="head"><h2 style="margin:0">الموردون</h2><button class="btn gold" id="adds">+ مورد جديد</button></div>
      <div class="list">${sups.map((s) => `<div class="row-card" data-edit="${s.id}"><div class="grow"><b>${esc(s.name)} ${s.active ? '' : '<span class="badge">موقوف</span>'}</b><span class="muted">${esc(s.phone)} ${esc(s.notes)}</span></div><div style="text-align:end"><div class="muted">مشتريات: ${egp(s.purchased_pt)}</div>${s.balance_pt > 0 ? `<b class="neg num">مستحق ${egp(s.balance_pt)}</b>` : ''}</div></div>`).join('')}</div>`;
    const form = (s) => formSheet({ title: s ? 'تعديل المورد' : 'مورد جديد', values: s || { active: true }, fields: [{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف', type: 'text', required: false }, { name: 'notes', label: 'ملاحظات', type: 'textarea', required: false }, { name: 'active', label: 'نشط', type: 'checkbox' }],
      onSubmit: async (v, close) => { await api(s ? '/api/admin/suppliers/' + s.id : '/api/admin/suppliers', { method: s ? 'PUT' : 'POST', body: v }); toast('تم الحفظ'); close(); draw(); } });
    $('#adds', main).onclick = () => form(null);
    $$('[data-edit]', main).forEach((r2) => (r2.onclick = () => form(sups.find((x) => x.id === +r2.dataset.edit))));
  }
  draw();
}
