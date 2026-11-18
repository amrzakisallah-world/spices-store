import { api, esc, egp, norm, productVisual, spiceArt, toast, STATUS_AR, PAY_AR, fmtDateTime, $, $$, imgUrl } from './common.js';

const I = {
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2zM13 9h4l3 3v4h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.8 2.1 1.2 1 2.2 1.4 2.5 1.5.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l2 .9c.3.1.5.2.5.3 0 .1 0 .7-.2 1.2z"/></svg>',
};

const S = { settings: null, categories: [], products: [], loaded: false, q: '', cat: null };
const CART_KEY = 'spices_cart_v1';
const loadCart = () => { try { const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c.filter((x) => Number.isInteger(x.id) && Number.isInteger(x.qty) && x.qty > 0) : []; } catch { return []; } };
let cart = loadCart();
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode: cart lives in memory only */ } };
const prod = (id) => S.products.find((p) => p.id === id);
const qtyOf = (id) => cart.find((c) => c.id === id)?.qty || 0;
const cartCount = () => cart.reduce((s, c) => s + c.qty, 0);
const maxQty = (p) => (p ? Math.min(p.max_qty, 50) : 0);
function setQty(id, qty) {
  const p = prod(id);
  if (!p) return;
  qty = Math.max(0, Math.min(qty, maxQty(p)));
  cart = cart.filter((c) => c.id !== id);
  if (qty > 0) cart.push({ id, qty });
  saveCart();
  updateBadges();
}
function cartLines() {
  return cart.map((c) => ({ p: prod(c.id), qty: c.qty })).filter((l) => l.p && l.p.stock_status !== 'out').map((l) => ({ ...l, qty: Math.min(l.qty, maxQty(l.p)), total: Math.min(l.qty, maxQty(l.p)) * l.p.price_pt }));
}
function totals() {
  const lines = cartLines();
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const st = S.settings;
  const free = st.free_delivery_over_pt > 0 && subtotal >= st.free_delivery_over_pt;
  const fee = lines.length === 0 ? 0 : free ? 0 : st.delivery_fee_pt;
  return { lines, subtotal, fee, total: subtotal + fee, free };
}

const root = $('#root');
const stepper = (id, qty, max) => `<div class="stepper" role="group" aria-label="الكمية">
  <button type="button" data-act="dec" data-id="${id}" aria-label="تقليل الكمية">−</button><output aria-live="polite">${qty}</output>
  <button type="button" data-act="inc" data-id="${id}" aria-label="زيادة الكمية" ${qty >= max ? 'disabled' : ''}>+</button></div>`;
const stockTag = (p) => (p.stock_status === 'out' ? '<span class="badge danger tag">نفد المخزون</span>' : p.stock_status === 'low' ? '<span class="badge warn tag">كمية محدودة</span>' : '');

function card(p) {
  const q = qtyOf(p.id);
  const action = p.stock_status === 'out'
    ? '<button class="btn block" disabled>غير متاح حاليًا</button>'
    : q > 0 ? stepper(p.id, q, maxQty(p)) : `<button class="btn gold block" data-act="add" data-id="${p.id}">أضف للسلة</button>`;
  return `<article class="pcard ${p.stock_status === 'out' ? 'out' : ''}" data-card="${p.id}">
    <a class="vis" href="#/p/${p.id}" aria-label="${esc(p.name_ar)}">${productVisual(p)}${stockTag(p)}</a>
    <div class="body"><h3><a href="#/p/${p.id}">${esc(p.name_ar)}</a></h3>
      <span class="unit">${esc(p.unit_label)}</span><span class="price num">${egp(p.price_pt)}</span>
      <div class="row">${action}</div></div></article>`;
}

function shell(inner, active) {
  const st = S.settings;
  const wa = st.whatsapp ? `<a href="https://wa.me/${esc(st.whatsapp)}" target="_blank" rel="noopener">${I.wa} تواصل واتساب</a>` : '';
  const nav = (href, key, label, icon, extra = '') => `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${icon}<span>${label}</span>${extra}</a>`;
  const badge = `<span class="cart-count" data-cart-count ${cartCount() ? '' : 'hidden'}>${cartCount()}</span>`;
  root.innerHTML = `${st.announcement_ar ? `<div class="announce">${esc(st.announcement_ar)}</div>` : ''}
  <header class="top"><div class="wrap">
    <a class="brand" href="#/" aria-label="${esc(st.store_name_ar)} — الرئيسية"><img src="/img/logo-192.png" alt="" width="44" height="44"><span><b>${esc(st.store_name_ar)}</b><small>${esc(st.store_name_en)}</small></span></a>
    <nav class="desk-nav" aria-label="التنقل">${nav('#/', 'home', 'الرئيسية', '')}${nav('#/categories', 'cats', 'الأقسام', '')}${nav('#/track', 'track', 'تتبع طلبك', '')}</nav>
    <a class="cart-link" href="#/cart" aria-label="السلة">${I.cart}${badge}</a>
  </div></header>
  <main class="wrap" id="main" tabindex="-1">${inner}</main>
  <footer class="foot"><div class="wrap"><div><h3>${esc(st.store_name_ar)}</h3><p>${esc(st.tagline_ar)}</p>${wa}</div><div><h3>التوصيل والدفع</h3><p>${esc(st.delivery_info_ar)}</p></div></div></footer>
  <nav class="bottom" aria-label="التنقل السريع">${nav('#/', 'home', 'الرئيسية', I.home)}${nav('#/categories', 'cats', 'الأقسام', I.grid)}${nav('#/track', 'track', 'طلباتي', I.box)}${nav('#/cart', 'cart', 'السلة', I.cart, badge)}</nav>`;
}
function updateBadges() {
  const n = cartCount();
  $$('[data-cart-count]').forEach((b) => { b.textContent = n; b.hidden = n === 0; });
}

// ---------- Views ----------
function heroArt() {
  return `<svg class="hero-art" viewBox="0 0 440 200" aria-hidden="true"><ellipse cx="220" cy="190" rx="200" ry="9" fill="#000" opacity=".2"/>
  <path d="M30 120h190c0 42-34 68-95 68S30 162 30 120z" fill="#8a5428"/><ellipse cx="125" cy="120" rx="95" ry="15" fill="#a8703a"/><path d="M45 120c10-44 46-72 80-72s70 28 80 72z" fill="#d9a21b"/><path d="M80 114c8-26 26-44 45-44 14 0 28 12 36 44z" fill="#e8c14f" opacity=".5"/>
  <path d="M250 135h170c0 36-30 55-85 55s-85-19-85-55z" fill="#6b3a16"/><ellipse cx="335" cy="135" rx="85" ry="12" fill="#8a5428"/><path d="M262 135c8-30 34-48 73-48s65 18 73 48z" fill="#b8461b"/>
  <path d="M395 70c26-22 46-20 50-20-2 24-18 46-50 42 6-12 3-22 0-22z" fill="#71721e"/><path d="M215 60c-6-22-20-34-38-36 0 22 12 34 38 36z" fill="#71721e" opacity=".8"/></svg>`;
}
function catChips() {
  return `<div class="chips" role="tablist" aria-label="الأقسام"><a class="chip" href="#/" ${S.cat === null ? 'aria-current="true"' : ''}>الكل</a>${S.categories.map((c) => `<a class="chip" href="#/c/${c.id}" ${S.cat === c.id ? 'aria-current="true"' : ''}>${esc(c.name_ar)}</a>`).join('')}</div>`;
}
function productList() {
  const q = norm(S.q.trim());
  const list = S.products.filter((p) => (S.cat === null || p.category_id === S.cat) && (!q || norm(p.name_ar).includes(q) || norm(p.name_en).includes(q) || norm(p.description_ar).includes(q)));
  if (!list.length) return `<div class="empty">${S.products.length ? 'لا توجد منتجات مطابقة. جرّب كلمة بحث أخرى أو قسمًا مختلفًا.' : 'لا توجد منتجات معروضة حاليًا. تابعنا قريبًا.'}</div>`;
  return `<div class="grid">${list.map(card).join('')}</div>`;
}
function viewHome(catId = null) {
  S.cat = catId;
  const st = S.settings;
  const hero = catId === null && !S.q ? `<section class="hero"><div class="hero-in"><h1>طعم أصيل في كل بيت</h1><p>${esc(st.tagline_ar)} — توابل وبهارات وأعشاب بتوصلك لحد الباب.</p><a class="btn gold" href="#products">تسوق الآن</a></div>${heroArt()}</section>
    <div class="trust"><div>${I.shield}دفع آمن عند الاستلام</div><div>${I.truck}توصيل لحد البيت</div><div>${I.leaf}جودة وأصالة</div></div>` : '';
  shell(`<div class="searchbar"><label class="sr-only" for="q">ابحث عن منتج</label><input id="q" type="search" placeholder="ابحث عن منتج..." value="${esc(S.q)}" autocomplete="off" enterkeyhint="search"></div>
  ${hero}${catChips()}<div id="products">${productList()}</div>`, 'home');
  document.title = `${st.store_name_ar} — توابل وعطارة أصلية`;
}
function viewCategories() {
  shell(`<h1>الأقسام</h1><div class="cats-grid">${S.categories.map((c) => `<a href="#/c/${c.id}">${esc(c.name_ar)}</a>`).join('') || '<div class="empty">لا توجد أقسام بعد.</div>'}</div>`, 'cats');
  document.title = 'الأقسام — ' + S.settings.store_name_ar;
}
async function viewProduct(id) {
  const base = prod(id);
  if (!base) { shell('<div class="empty">المنتج غير موجود أو لم يعد متاحًا. <a href="#/">العودة للمتجر</a></div>', 'home'); return; }
  shell('<div class="spinner"></div>', 'home');
  let p = base, images = [];
  try { const r = await api('/api/store/products/' + id); p = r.product; images = p.images || []; } catch { /* fall back to list data */ }
  if (!images.length && p.image_key) images = [p.image_key];
  const q = qtyOf(id);
  const cat = S.categories.find((c) => c.id === p.category_id);
  const gallery = images.length ? `<img id="main-img" src="${esc(imgUrl(images[0]))}" alt="${esc(p.name_ar)}">${images.length > 1 ? `<div class="thumbs">${images.map((k, i) => `<img src="${esc(imgUrl(k))}" alt="صورة ${i + 1}" data-act="thumb" data-src="${esc(imgUrl(k))}" ${i === 0 ? 'aria-current="true"' : ''}>`).join('')}</div>` : ''}` : spiceArt(p.name_ar);
  shell(`<p class="crumb"><a href="#/">المتجر</a>${cat ? ` / <a href="#/c/${cat.id}">${esc(cat.name_ar)}</a>` : ''}</p>
    <section class="detail"><div class="gallery">${gallery}</div><div>
      <h1>${esc(p.name_ar)}</h1><p class="muted">${esc(p.unit_label)}</p><div class="price num">${egp(p.price_pt)}</div>
      <p>${p.stock_status === 'out' ? '<span class="badge danger">نفد المخزون</span>' : p.stock_status === 'low' ? '<span class="badge warn">كمية محدودة</span>' : '<span class="badge ok">متوفر</span>'}</p>
      ${p.description_ar ? `<p style="white-space:pre-line">${esc(p.description_ar)}</p>` : ''}
      <div id="buy" style="margin-block:1rem">${p.stock_status === 'out' ? '<button class="btn" disabled>غير متاح حاليًا</button>' : q > 0 ? `${stepper(id, q, maxQty(base))} <a class="btn gold" href="#/cart">إتمام الطلب</a>` : `<button class="btn gold block" data-act="add" data-id="${id}">أضف للسلة</button>`}</div>
      <div class="notice">${esc(S.settings.delivery_info_ar)}</div></div></section>`, 'home');
  document.title = `${p.name_ar} — ${S.settings.store_name_ar}`;
}
function viewCart() {
  const t = totals();
  const st = S.settings;
  if (!t.lines.length) { shell(`<h1>السلة</h1><div class="empty">سلتك فاضية حاليًا.<br><br><a class="btn gold" href="#/">ابدأ التسوق</a></div>`, 'cart'); return; }
  const need = st.free_delivery_over_pt > 0 && !t.free ? st.free_delivery_over_pt - t.subtotal : 0;
  shell(`<h1>السلة</h1><div class="two"><div class="lines">${t.lines.map((l) => `<div class="line" data-line="${l.p.id}"><div class="vis">${productVisual(l.p)}</div>
      <div><div class="nm">${esc(l.p.name_ar)}</div><div class="muted">${esc(l.p.unit_label)} · <span class="num">${egp(l.p.price_pt)}</span></div><button class="rm" data-act="rm" data-id="${l.p.id}">حذف</button></div>
      <div style="text-align:center">${stepper(l.p.id, l.qty, maxQty(l.p))}<div class="num" style="font-weight:700;margin-top:.2rem">${egp(l.total)}</div></div></div>`).join('')}</div>
    <aside class="card sum"><h2>ملخص الطلب</h2>
      <div class="r"><span>المنتجات</span><span class="num">${egp(t.subtotal)}</span></div>
      <div class="r"><span>التوصيل</span><span class="num">${t.fee ? egp(t.fee) : 'مجاني'}</span></div>
      ${need > 0 ? `<div class="notice">أضف منتجات بـ <b class="num">${egp(need)}</b> وخد التوصيل مجانًا.</div>` : ''}
      <div class="r tot"><span>الإجمالي</span><span class="num">${egp(t.total)}</span></div>
      ${st.min_order_pt > t.subtotal ? `<div class="notice">الحد الأدنى للطلب <b class="num">${egp(st.min_order_pt)}</b></div><button class="btn block" disabled>إتمام الطلب</button>` : '<a class="btn gold block" href="#/checkout">إتمام الطلب</a>'}
      <p class="muted" style="margin-top:.8rem;font-size:.85rem">الدفع نقدًا عند الاستلام. السعر النهائي يُؤكَّد من المتجر.</p></aside></div>`, 'cart');
  document.title = 'السلة — ' + st.store_name_ar;
}
function viewCheckout() {
  const t = totals();
  if (!t.lines.length) { location.hash = '#/cart'; return; }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('spices_customer') || '{}'); } catch { /* ignore */ }
  const f = (id, label, input, hint = '') => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err" data-err="${id}"></div></div>`;
  shell(`<h1>بيانات التوصيل</h1><div class="two"><form id="checkout" novalidate>
    ${f('name', 'الاسم', `<input id="name" name="name" type="text" autocomplete="name" required maxlength="80" value="${esc(saved.name || '')}">`)}
    ${f('phone', 'رقم الموبايل', `<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="01xxxxxxxxx" value="${esc(saved.phone || '')}">`, 'هنتصل بيك على الرقم ده لتأكيد الطلب')}
    ${f('area', 'المنطقة / المدينة', `<input id="area" name="area" type="text" autocomplete="address-level2" maxlength="80" value="${esc(saved.area || '')}">`)}
    ${f('address', 'العنوان بالتفصيل', `<textarea id="address" name="address" autocomplete="street-address" required maxlength="300" placeholder="الشارع، رقم العمارة، الدور، الشقة، علامة مميزة">${esc(saved.address || '')}</textarea>`)}
    ${f('notes', 'ملاحظات للتوصيل (اختياري)', `<textarea id="notes" name="notes" maxlength="500" placeholder="مثال: اتصل قبل الوصول"></textarea>`)}
    <div class="hp" aria-hidden="true"><label>لا تملأ هذا الحقل<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="err" id="form-err" role="alert"></div>
    <button class="btn gold block" type="submit" id="submit">تأكيد الطلب — <span class="num">${egp(t.total)}</span></button></form>
    <aside class="card sum"><h2>طلبك</h2>${t.lines.map((l) => `<div class="r"><span>${esc(l.p.name_ar)} × ${l.qty}</span><span class="num">${egp(l.total)}</span></div>`).join('')}
      <div class="r"><span>التوصيل</span><span class="num">${t.fee ? egp(t.fee) : 'مجاني'}</span></div><div class="r tot"><span>الإجمالي</span><span class="num">${egp(t.total)}</span></div>
      <p class="muted" style="font-size:.85rem">الدفع نقدًا عند الاستلام.</p></aside></div>`, 'cart');
  document.title = 'إتمام الطلب — ' + S.settings.store_name_ar;
}
async function submitOrder(form) {
  const btn = $('#submit'); const fd = new FormData(form);
  $$('[data-err]').forEach((e) => (e.textContent = '')); $$('.invalid').forEach((e) => e.classList.remove('invalid')); $('#form-err').textContent = '';
  const data = { name: fd.get('name').trim(), phone: fd.get('phone').trim(), area: fd.get('area').trim(), address: fd.get('address').trim(), notes: fd.get('notes').trim(), website: fd.get('website'),
    items: cartLines().map((l) => ({ product_id: l.p.id, qty: l.qty })) };
  const errs = {};
  if (data.name.length < 2) errs.name = 'اكتب اسمك';
  if (!/^[+\d٠-٩\s\-]{8,18}$/.test(data.phone)) errs.phone = 'اكتب رقم موبايل صحيح';
  if (data.address.length < 8) errs.address = 'اكتب العنوان بالتفصيل (8 حروف على الأقل)';
  if (Object.keys(errs).length) { showErrs(errs); return; }
  btn.disabled = true; btn.textContent = 'جارٍ إرسال الطلب...';
  try {
    const r = await api('/api/store/orders', { method: 'POST', body: data });
    try { localStorage.setItem('spices_customer', JSON.stringify({ name: data.name, phone: data.phone, area: data.area, address: data.address })); } catch { /* ignore */ }
    sessionStorage.setItem('last_order', JSON.stringify({ code: r.code, phone: data.phone, total: r.total_pt }));
    cart = []; saveCart();
    location.hash = '#/done/' + r.code;
  } catch (e) {
    if (e.fields && Object.keys(e.fields).length) showErrs(e.fields); else $('#form-err').textContent = e.message;
    if (e.status === 409) await loadCatalog();
    btn.disabled = false; btn.innerHTML = `تأكيد الطلب — <span class="num">${egp(totals().total)}</span>`;
  }
}
function showErrs(errs) {
  for (const [k, m] of Object.entries(errs)) { const el = $(`[data-err="${k}"]`); if (el) el.textContent = m; const inp = $('#' + k); if (inp) inp.classList.add('invalid'); }
  const first = $('.invalid'); if (first) first.focus();
}
function viewDone(code) {
  let last = {}; try { last = JSON.parse(sessionStorage.getItem('last_order') || '{}'); } catch { /* ignore */ }
  const st = S.settings;
  const wa = st.whatsapp ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${esc(st.whatsapp)}?text=${encodeURIComponent('أهلًا، أنا صاحب الطلب رقم ' + code)}">${I.wa} كلّمنا على واتساب</a>` : '';
  shell(`<section class="done"><h1>تم استلام طلبك ✓</h1><p>شكرًا لك! هنتصل بيك قريبًا لتأكيد الطلب.</p><div class="code" id="code">${esc(code)}</div>
    <p class="muted">احتفظ بالكود ده لمتابعة طلبك${last.total ? ` · الإجمالي <b class="num">${egp(last.total)}</b>` : ''}</p>
    <p><button class="btn ghost" data-act="copy" data-code="${esc(code)}">نسخ الكود</button> <a class="btn gold" href="#/track/${esc(code)}">تتبع الطلب</a> ${wa}</p></section>`, 'track');
  document.title = 'تم استلام الطلب — ' + st.store_name_ar;
}
const FLOW = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
async function viewTrack(code = '') {
  let last = {}; try { last = JSON.parse(sessionStorage.getItem('last_order') || '{}'); } catch { /* ignore */ }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('spices_customer') || '{}'); } catch { /* ignore */ }
  const phone = last.phone || saved.phone || '';
  shell(`<h1>تتبع طلبك</h1><form id="track" class="card" novalidate><div class="field"><label for="tcode">كود الطلب</label><input id="tcode" type="text" value="${esc(code || last.code || '')}" dir="ltr" autocapitalize="characters" autocomplete="off" placeholder="SPXXXXXXXX"></div>
    <div class="field"><label for="tphone">رقم الموبايل المستخدم في الطلب</label><input id="tphone" type="tel" inputmode="tel" value="${esc(phone)}" placeholder="01xxxxxxxxx"></div>
    <div class="err" id="track-err" role="alert"></div><button class="btn block" type="submit">عرض حالة الطلب</button></form><div id="track-result"></div>`, 'track');
  document.title = 'تتبع الطلب — ' + S.settings.store_name_ar;
  if (code && phone) lookup(code, phone);
}
async function lookup(code, phone) {
  const out = $('#track-result'); const err = $('#track-err'); err.textContent = ''; out.innerHTML = '<div class="spinner"></div>';
  try {
    const { order: o } = await api(`/api/store/orders/${encodeURIComponent(code.trim())}?phone=${encodeURIComponent(phone.trim())}`);
    const idx = FLOW.indexOf(o.status);
    const steps = o.status === 'cancelled' ? '<p><span class="badge danger">تم إلغاء الطلب</span></p>' : `<ol class="timeline">${FLOW.map((s, i) => `<li class="${i <= idx ? 'on' : ''} ${i === idx ? 'now' : ''}">${STATUS_AR[s]}</li>`).join('')}</ol>`;
    out.innerHTML = `<section class="card" style="margin-top:1rem"><h2>طلب <span class="num">${esc(o.code)}</span></h2><p class="muted">${fmtDateTime(o.created_at)} · ${esc(o.customer_name)}</p>${steps}
      <h3>الأصناف</h3>${o.items.map((i) => `<div class="sum"><div class="r" style="padding:.15rem 0"><span>${esc(i.name)} ${esc(i.unit_label)} × ${i.qty}</span><span class="num">${egp(i.line_total_pt)}</span></div></div>`).join('')}
      <div class="sum"><div class="r"><span>التوصيل</span><span class="num">${o.delivery_fee_pt ? egp(o.delivery_fee_pt) : 'مجاني'}</span></div>${o.discount_pt ? `<div class="r"><span>خصم</span><span class="num">-${egp(o.discount_pt)}</span></div>` : ''}
      <div class="r tot"><span>الإجمالي</span><span class="num">${egp(o.total_pt)}</span></div><div class="r"><span>حالة الدفع</span><span>${PAY_AR[o.payment_status]}</span></div></div></section>`;
  } catch (e) { out.innerHTML = ''; err.textContent = e.message; }
}

// ---------- Router ----------
async function loadCatalog() {
  const [s, c, p] = await Promise.all([api('/api/store/settings'), api('/api/store/categories'), api('/api/store/products')]);
  S.settings = s; S.categories = c.categories; S.products = p.products; S.loaded = true;
  cart = cart.filter((x) => prod(x.id));
}
async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'products') { $('#products')?.scrollIntoView(); return; }
  if (!S.loaded) { try { await loadCatalog(); } catch (e) { root.innerHTML = `<div class="empty" style="padding-block:4rem">${esc(e.message)}<br><br><button class="btn" id="retry">إعادة المحاولة</button></div>`; $('#retry').onclick = () => location.reload(); return; } }
  const [a, b] = h.split('/');
  window.scrollTo(0, 0);
  if (a === 'p' && b) await viewProduct(parseInt(b, 10));
  else if (a === 'c' && b) viewHome(parseInt(b, 10));
  else if (a === 'categories') viewCategories();
  else if (a === 'cart') viewCart();
  else if (a === 'checkout') viewCheckout();
  else if (a === 'done' && b) viewDone(b);
  else if (a === 'track') await viewTrack(b ? decodeURIComponent(b) : '');
  else viewHome(null);
}
window.addEventListener('hashchange', route);

// ---------- Events (delegated; no inline handlers so CSP can block inline script) ----------
function refreshCards(id) {
  const p = prod(id);
  const c = $(`[data-card="${id}"] .row`);
  if (c && p) c.innerHTML = qtyOf(id) > 0 ? stepper(id, qtyOf(id), maxQty(p)) : `<button class="btn gold block" data-act="add" data-id="${id}">أضف للسلة</button>`;
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act; const id = parseInt(el.dataset.id, 10);
  const view = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (act === 'add') { setQty(id, 1); toast('تمت الإضافة للسلة'); }
  else if (act === 'inc') setQty(id, qtyOf(id) + 1);
  else if (act === 'dec') setQty(id, qtyOf(id) - 1);
  else if (act === 'rm') setQty(id, 0);
  else if (act === 'thumb') { $('#main-img').src = el.dataset.src; $$('.thumbs img').forEach((t) => t.removeAttribute('aria-current')); el.setAttribute('aria-current', 'true'); return; }
  else if (act === 'copy') { navigator.clipboard?.writeText(el.dataset.code).then(() => toast('تم نسخ الكود')).catch(() => toast('انسخ الكود يدويًا', 'err')); return; }
  else return;
  if (view === 'cart') viewCart();
  else if (view === 'p') { const b = $('#buy'); if (b) { const q = qtyOf(id), p = prod(id); b.innerHTML = q > 0 ? `${stepper(id, q, maxQty(p))} <a class="btn gold" href="#/cart">إتمام الطلب</a>` : `<button class="btn gold block" data-act="add" data-id="${id}">أضف للسلة</button>`; } }
  else refreshCards(id);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') {
    S.q = e.target.value;
    const box = $('#products'); if (box) box.innerHTML = productList();
    $$('.hero, .trust').forEach((x) => (x.hidden = !!S.q.trim()));
  }
  if (e.target.classList?.contains('invalid')) e.target.classList.remove('invalid');
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'checkout') { e.preventDefault(); submitOrder(e.target); }
  if (e.target.id === 'track') { e.preventDefault(); lookup($('#tcode').value, $('#tphone').value); }
});
route();
