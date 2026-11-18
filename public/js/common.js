// Shared helpers for storefront and admin. No dependencies.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class ApiError extends Error {
  constructor(message, status, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

export async function api(path, { method = 'GET', body, raw, type } = {}) {
  const headers = { 'X-Requested-With': 'spices' };
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = type; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError('تعذر الاتصال بالإنترنت، حاول مرة أخرى', 0); }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/csv')) return res;
  const data = ct.includes('json') ? await res.json() : {};
  if (!res.ok) throw new ApiError(data.error || 'حدث خطأ، حاول مرة أخرى', res.status, data.fields);
  return data;
}

// ---------- Money: server stores integer piasters ----------
export function egp(pt, { sign = false } = {}) {
  const n = Math.round(Number(pt) || 0);
  const a = Math.abs(n);
  const whole = Math.trunc(a / 100).toLocaleString('en-US');
  const frac = a % 100;
  const txt = frac ? `${whole}.${String(frac).padStart(2, '0')}` : whole;
  // Isolate the signed number so the minus sign stays attached to the digits in RTL text.
  return `\u2066${n < 0 ? '-' : sign && n > 0 ? '+' : ''}${txt}\u2069 ج.م`;
}
export function toPt(input) {
  const s = String(input ?? '')
    .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[٫,]/g, '.').replace(/\s/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return parseInt(w, 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
}
export const ptToInput = (pt) => (pt % 100 === 0 ? String(pt / 100) : (pt / 100).toFixed(2));

export const STATUS_AR = { pending: 'جديد', confirmed: 'تم التأكيد', preparing: 'قيد التجهيز', out_for_delivery: 'في الطريق', delivered: 'تم التسليم', cancelled: 'ملغي' };
export const PAY_AR = { unpaid: 'غير مدفوع', partial: 'مدفوع جزئيًا', paid: 'مدفوع' };
export const METHOD_AR = { cash: 'نقدًا', vodafone_cash: 'فودافون كاش', instapay: 'إنستاباي', bank: 'تحويل بنكي', other: 'أخرى' };

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' });
}

// ---------- Arabic-friendly search ----------
export const norm = (s) =>
  String(s || '').toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

// ---------- Placeholder art (shown until a real photo is uploaded) ----------
const SPICE_COLORS = ['#b8461b', '#d9a21b', '#8a5a2b', '#6f7d2f', '#4a3220', '#c96a1a', '#9b2f1f', '#a88a3d'];
export function spiceArt(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = SPICE_COLORS[h % SPICE_COLORS.length];
  const c2 = SPICE_COLORS[(h >> 3) % SPICE_COLORS.length];
  return `<svg viewBox="0 0 200 150" role="img" aria-hidden="true" class="art">
    <ellipse cx="100" cy="132" rx="70" ry="9" fill="#4e2606" opacity=".12"/>
    <path d="M30 78h140c0 34-26 54-70 54S30 112 30 78z" fill="#8a5428"/>
    <path d="M30 78h140c0 6-1 11-3 16-20 8-44 10-67 10s-47-2-67-10c-2-5-3-10-3-16z" fill="#6b3a16"/>
    <ellipse cx="100" cy="78" rx="70" ry="13" fill="#a8703a"/>
    <path d="M42 78c8-30 34-50 58-50s50 20 58 50z" fill="${c}"/>
    <path d="M66 74c6-18 20-30 34-30 10 0 20 8 26 30z" fill="${c2}" opacity=".35"/>
    <circle cx="80" cy="60" r="2.2" fill="#fff" opacity=".25"/><circle cx="112" cy="54" r="2" fill="#fff" opacity=".25"/><circle cx="96" cy="68" r="1.8" fill="#000" opacity=".15"/>
    <path d="M160 52c14-14 28-12 30-12-1 14-10 28-30 26 4-8 2-14 0-14z" fill="#71721e"/>
    <path d="M162 62c8-8 14-12 22-16" stroke="#4d4f14" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`;
}
export const imgUrl = (key) => '/media/' + key.split('/').map(encodeURIComponent).join('/');
export function productVisual(p, alt = '') {
  return p.image_key
    ? `<img src="${esc(imgUrl(p.image_key))}" alt="${esc(alt || p.name_ar)}" loading="lazy" decoding="async">`
    : spiceArt(p.name_ar);
}

// ---------- Toasts ----------
export function toast(message, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function todayCairo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}
