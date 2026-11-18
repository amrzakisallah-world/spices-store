import { api, esc, egp, toast, productVisual, imgUrl, fmtDateTime, $, $$ } from '/js/common.js';
import { sheet, formSheet, confirmBox, money } from './ui.js';

// Shrinks phone photos in the browser before upload (max 1200px, JPEG) so uploads are fast on mobile data.
async function shrink(file) {
  if (file.size < 350_000 && /image\/(jpeg|webp)/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
}

export default async function render(main, { user }) {
  const isOwner = user.role === 'owner';
  let cats = (await api('/api/admin/categories')).categories;
  const f = { q: '', low: false };
  async function load() {
    const { products } = await api(`/api/admin/products?q=${encodeURIComponent(f.q)}${f.low ? '&low=1' : ''}`);
    $('#list', main).innerHTML = products.length ? `<div class="list">${products.map((p) => {
      const low = p.stock_qty <= p.low_stock_threshold;
      return `<div class="row-card" data-open="${p.id}" tabindex="0" role="button"><div class="thumb">${productVisual(p)}</div><div class="grow"><b>${esc(p.name_ar)} <span class="muted">${esc(p.unit_label)}</span></b>
        <span class="muted">${esc(p.category_name || 'بدون قسم')}</span></div><div style="text-align:end"><div class="num"><b>${egp(p.price_pt)}</b></div>${isOwner ? `<div class="muted num" style="font-size:.8rem">تكلفة ${egp(p.cost_pt)}</div>` : ''}
        <span class="badge ${p.stock_qty === 0 ? 'danger' : low ? 'warn' : 'ok'}">المخزون ${p.stock_qty}</span> ${p.active ? '' : '<span class="badge">مخفي</span>'}</div></div>`;
    }).join('')}</div>` : '<div class="empty">لا توجد منتجات. اضغط «منتج جديد» للبدء.</div>';
    $$('[data-open]', main).forEach((r) => { r.onclick = () => openProduct(+r.dataset.open); r.onkeydown = (e) => { if (e.key === 'Enter') r.click(); }; });
  }
  main.innerHTML = `<div class="head"><h1>المنتجات</h1><div class="tools"><button class="btn gold" id="add">+ منتج جديد</button><button class="btn ghost" id="cats">الأقسام</button></div></div>
    <div class="tools" style="margin-block-end:1rem"><input id="q" type="search" placeholder="بحث باسم المنتج" aria-label="بحث"><label class="check"><input type="checkbox" id="low"> مخزون منخفض فقط</label></div><div id="list"><div class="spinner"></div></div>`;
  let t; $('#q', main).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 300); });
  $('#low', main).addEventListener('change', (e) => { f.low = e.target.checked; load(); });
  $('#add', main).onclick = () => openProduct(null);
  $('#cats', main).onclick = manageCats;
  await load();

  const catOptions = () => [['', 'بدون قسم'], ...cats.map((c) => [c.id, c.name_ar])];
  const fields = () => [
    { name: 'name_ar', label: 'اسم المنتج', type: 'text', required: true },
    { name: 'unit_label', label: 'الوحدة / الوزن', type: 'text', required: false, placeholder: 'مثال: 250 جم' },
    { name: 'category_id', label: 'القسم', type: 'select', options: catOptions(), numeric: true },
    { name: 'price_pt', label: 'سعر البيع', type: 'money' },
    ...(isOwner ? [{ name: 'cost_pt', label: 'سعر التكلفة (الشراء)', type: 'money', required: false, hint: 'يُستخدم لحساب الربح وقت البيع' }] : []),
    { name: 'description_ar', label: 'الوصف', type: 'textarea', required: false },
    { name: 'low_stock_threshold', label: 'تنبيه عند وصول المخزون إلى', type: 'int' },
    { name: 'active', label: 'ظاهر في المتجر', type: 'checkbox' },
  ];

  async function openProduct(id) {
    let data = null;
    if (id) data = await api('/api/admin/products/' + id);
    const p = data?.product;
    const values = p ? { ...p } : { active: true, low_stock_threshold: 5, stock_qty: 0 };
    const fl = fields();
    if (!p) fl.splice(isOwner ? 5 : 4, 0, { name: 'stock_qty', label: 'المخزون الافتتاحي (عدد الوحدات)', type: 'int' });
    const extra = p ? `<div class="field"><label>الصور</label><div class="imgs" id="imgs">${data.images.map((i) => `<div class="im"><img src="${esc(imgUrl(i.r2_key))}" alt="" loading="lazy"><button type="button" data-delimg="${i.id}" aria-label="حذف الصورة">✕</button></div>`).join('')}</div>
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple><div class="hint">حتى 6 صور. تُصغَّر تلقائيًا قبل الرفع.</div></div>
      <div class="card" style="margin-block:.5rem 1rem"><b>المخزون الحالي: ${p.stock_qty}</b><div class="grid2" style="margin-top:.5rem"><input id="delta" type="text" inputmode="numeric" placeholder="+10 أو -2" aria-label="تعديل المخزون"><input id="snote" type="text" placeholder="السبب (اختياري)" aria-label="السبب"></div>
        <button type="button" class="btn small" id="adjust" style="margin-top:.5rem">تعديل المخزون</button></div>
      ${isOwner && data.price_history.length > 1 ? `<details><summary>سجل الأسعار</summary>${data.price_history.map((h) => `<div class="muted" style="font-size:.85rem">${fmtDateTime(h.changed_at)}: بيع ${egp(h.old_price_pt)} ← ${egp(h.new_price_pt)} · تكلفة ${egp(h.old_cost_pt)} ← ${egp(h.new_cost_pt)}</div>`).join('')}</details>` : ''}
      ${data.movements.length ? `<details><summary>حركة المخزون</summary>${data.movements.map((m) => `<div class="muted" style="font-size:.85rem">${fmtDateTime(m.created_at)}: ${m.delta > 0 ? '+' : ''}${m.delta} (${esc({ sale: 'بيع', purchase: 'شراء', adjustment: 'تعديل', cancel_return: 'إلغاء طلب', initial: 'افتتاحي' }[m.reason])}) ${esc(m.note || m.ref || '')}</div>`).join('')}</details>` : ''}
      ${isOwner ? '<button type="button" class="btn small danger" id="del" style="margin-top:1rem">حذف المنتج</button>' : ''}` : '<p class="muted">يمكنك إضافة الصور بعد حفظ المنتج.</p>';
    formSheet({ title: p ? 'تعديل المنتج' : 'منتج جديد', fields: fl, values, extra, submit: p ? 'حفظ التعديلات' : 'إضافة المنتج',
      onMount: (el, close) => {
        if (!p) return;
        const refresh = () => { close(); load(); openProduct(id); };
        $('#file', el).onchange = async (e) => {
          for (const file of e.target.files) {
            try { const blob = await shrink(file); await api(`/api/admin/products/${id}/images`, { method: 'POST', raw: blob, type: blob.type || file.type }); toast('تم رفع الصورة'); }
            catch (err) { toast(err.message, 'err'); }
          }
          refresh();
        };
        $$('[data-delimg]', el).forEach((b) => (b.onclick = async () => { await api('/api/admin/images/' + b.dataset.delimg, { method: 'DELETE' }); refresh(); }));
        $('#adjust', el).onclick = async () => {
          const delta = parseInt($('#delta', el).value.replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)), 10);
          if (!Number.isInteger(delta) || delta === 0) return toast('اكتب رقمًا مثل +10 أو -2', 'err');
          try { await api(`/api/admin/products/${id}/stock`, { method: 'POST', body: { delta, note: $('#snote', el).value } }); toast('تم تعديل المخزون'); refresh(); } catch (err) { toast(err.message, 'err'); }
        };
        $('#del', el)?.addEventListener('click', async () => { if (await confirmBox('حذف المنتج', 'سيُحذف المنتج وصوره. الطلبات القديمة تحتفظ ببياناتها. متأكد؟')) { try { await api('/api/admin/products/' + id, { method: 'DELETE' }); toast('تم الحذف'); close(); load(); } catch (err) { toast(err.message, 'err'); } } });
      },
      onSubmit: async (v, close) => {
        const body = { ...v, cost_pt: v.cost_pt ?? p?.cost_pt ?? 0, stock_qty: v.stock_qty ?? 0 };
        await api(p ? '/api/admin/products/' + id : '/api/admin/products', { method: p ? 'PUT' : 'POST', body });
        toast('تم الحفظ'); close(); await load();
        if (!p) toast('أضف الصور من تعديل المنتج');
      } });
  }

  function manageCats() {
    const draw = (s) => {
      s.el.innerHTML = `${cats.map((c) => `<div class="alert" style="background:var(--sand)"><span>${esc(c.name_ar)} <span class="muted">(${c.products})</span> ${c.active ? '' : '<span class="badge">مخفي</span>'}</span><span><button class="btn small ghost" data-ec="${c.id}">تعديل</button>${isOwner ? ` <button class="btn small danger" data-dc="${c.id}">حذف</button>` : ''}</span></div>`).join('') || '<div class="empty">لا توجد أقسام.</div>'}
        <div class="actions"><button class="btn gold" id="nc">+ قسم جديد</button><button class="btn ghost" id="cl">إغلاق</button></div>`;
      $('#cl', s.el).onclick = () => { s.close(); load(); };
      const edit = (c) => formSheet({ title: c ? 'تعديل القسم' : 'قسم جديد', fields: [{ name: 'name_ar', label: 'اسم القسم', type: 'text', required: true }, { name: 'sort', label: 'الترتيب', type: 'int', required: false }, { name: 'active', label: 'ظاهر في المتجر', type: 'checkbox' }], values: c || { active: true, sort: cats.length + 1 },
        onSubmit: async (v, close) => { await api(c ? '/api/admin/categories/' + c.id : '/api/admin/categories', { method: c ? 'PUT' : 'POST', body: v }); cats = (await api('/api/admin/categories')).categories; close(); draw(s); } });
      $('#nc', s.el).onclick = () => edit(null);
      $$('[data-ec]', s.el).forEach((b) => (b.onclick = () => edit(cats.find((c) => c.id === +b.dataset.ec))));
      $$('[data-dc]', s.el).forEach((b) => (b.onclick = async () => { if (await confirmBox('حذف القسم', 'المنتجات داخل القسم ستبقى بدون قسم. متأكد؟')) { await api('/api/admin/categories/' + b.dataset.dc, { method: 'DELETE' }); cats = (await api('/api/admin/categories')).categories; draw(s); } }));
    };
    const s = sheet('الأقسام', '');
    draw(s);
  }
}
