import { api, esc, toast, $, $$ } from '/js/common.js';

const root = $('#root');
const ALL = [
  ['dashboard', 'الرئيسية', '📊', ['owner']],
  ['orders', 'الطلبات', '🧾', ['owner', 'staff']],
  ['products', 'المنتجات', '🫙', ['owner', 'staff']],
  ['finance', 'المالية', '💰', ['owner']],
  ['suppliers', 'الموردون', '🚚', ['owner']],
  ['settings', 'الإعدادات', '⚙️', ['owner', 'staff']],
];
const MODULES = {
  dashboard: () => import('./dashboard.js'), orders: () => import('./orders.js'), products: () => import('./products.js'),
  finance: () => import('./finance.js'), suppliers: () => import('./suppliers.js'), settings: () => import('./settings.js'),
};
let user = null;

function loginView(needsSetup) {
  root.innerHTML = `<div class="login"><div class="card"><img src="/img/logo-192.png" alt="">
    <h1>${needsSetup ? 'إعداد حساب المالك' : 'تسجيل الدخول'}</h1>
    ${needsSetup ? '<p class="muted">أول مرة؟ أنشئ حساب المالك باستخدام رمز الإعداد (SETUP_TOKEN) الذي ضبطته على الخادم.</p>' : ''}
    <form id="auth" novalidate>
      ${needsSetup ? '<div class="field"><label for="name">الاسم</label><input id="name" name="name" type="text" autocomplete="name" required></div>' : ''}
      <div class="field"><label for="email">البريد الإلكتروني</label><input id="email" name="email" type="email" dir="ltr" autocomplete="username" required></div>
      <div class="field"><label for="password">كلمة المرور${needsSetup ? ' (10 أحرف على الأقل)' : ''}</label><input id="password" name="password" type="password" dir="ltr" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" required></div>
      ${needsSetup ? '<div class="field"><label for="token">رمز الإعداد</label><input id="token" name="token" type="password" dir="ltr" autocomplete="off" required></div>' : ''}
      <div class="err" id="auth-err" role="alert"></div>
      <button class="btn gold block" type="submit">${needsSetup ? 'إنشاء الحساب' : 'دخول'}</button></form></div></div>`;
  $('#auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const btn = $('button', e.target); btn.disabled = true; $('#auth-err').textContent = '';
    try {
      await api(needsSetup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: fd });
      await start();
    } catch (err) { $('#auth-err').textContent = err.fields && Object.values(err.fields)[0] ? Object.values(err.fields)[0] : err.message; btn.disabled = false; }
  });
}

function shell() {
  const items = ALL.filter(([, , , roles]) => roles.includes(user.role));
  const cur = currentKey(items);
  root.innerHTML = `<div class="app"><header class="bar"><img src="/img/logo-64.png" alt=""><b>لوحة التحكم</b><span class="who">${esc(user.name)}</span><button class="btn small" id="logout">خروج</button></header>
    <nav class="side" aria-label="الأقسام">${items.map(([k, l, ic]) => `<a href="#/${k}" ${k === cur ? 'aria-current="page"' : ''}>${ic} ${l}</a>`).join('')}</nav>
    <main class="main" id="main" tabindex="-1"><div class="spinner"></div></main>
    <nav class="tabs" aria-label="الأقسام">${items.map(([k, l, ic]) => `<a href="#/${k}" ${k === cur ? 'aria-current="page"' : ''}><span class="ic">${ic}</span>${l}</a>`).join('')}</nav></div>`;
  $('#logout').onclick = async () => { try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } location.hash = ''; user = null; start(); };
}
const currentKey = (items) => { const k = location.hash.replace(/^#\/?/, '').split('/')[0]; return items.some(([x]) => x === k) ? k : items[0][0]; };

async function route() {
  if (!user) return;
  const items = ALL.filter(([, , , roles]) => roles.includes(user.role));
  const key = currentKey(items);
  shell();
  const main = $('#main');
  try {
    const mod = await MODULES[key]();
    await mod.default(main, { user, reload: route });
  } catch (e) {
    if (e.status === 401) { user = null; return start(); }
    main.innerHTML = `<div class="empty">${esc(e.message || 'حدث خطأ')}<br><br><button class="btn" id="retry">إعادة المحاولة</button></div>`;
    $('#retry').onclick = route;
  }
}
window.addEventListener('hashchange', route);

async function start() {
  try {
    const { user: u } = await api('/api/admin/me');
    user = u;
    return route();
  } catch (e) {
    if (e.status !== 401) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  const st = await api('/api/admin/status').catch(() => ({ needs_setup: false }));
  loginView(st.needs_setup);
}
start();
