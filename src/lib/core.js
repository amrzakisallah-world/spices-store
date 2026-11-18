import { HttpError, json, randomHex, sha256Hex, verifyPassword, hashPassword, rateLimit, timingSafeEqual } from './util.js';

// ---------- Router ----------
const routes = [];
export function route(method, path, handler, auth = false) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler, auth });
}
export const get = (p, h, a) => route('GET', p, h, a);
export const post = (p, h, a) => route('POST', p, h, a);
export const put = (p, h, a) => route('PUT', p, h, a);
export const patch = (p, h, a) => route('PATCH', p, h, a);
export const del = (p, h, a) => route('DELETE', p, h, a);

export async function dispatch(request, env) {
  const url = new URL(request.url);
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  let matchedPath = false;
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    matchedPath = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const ctx = {
      request, env, db: env.DB, url, params,
      ip: request.headers.get('cf-connecting-ip') || 'local',
      user: null,
      async body() {
        const ct = request.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new HttpError(415, 'نوع المحتوى يجب أن يكون JSON');
        const text = await request.text();
        if (text.length > 200_000) throw new HttpError(413, 'حجم الطلب كبير جدًا');
        try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      },
    };
    if (r.auth) {
      ctx.user = await authenticate(ctx);
      if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
      if (r.auth === 'owner' && ctx.user.role !== 'owner') throw new HttpError(403, 'هذه الصلاحية للمالك فقط');
      if (method !== 'GET') checkCsrf(ctx);
    }
    return r.handler(ctx);
  }
  if (matchedPath) throw new HttpError(405, 'الطريقة غير مسموحة');
  throw new HttpError(404, 'غير موجود');
}

// ---------- Sessions ----------
const SESSION_DAYS = 7;
export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
export function sessionCookie(value, request, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
export async function authenticate(ctx) {
  const token = getCookie(ctx.request, 'sid');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const row = await ctx.db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`
    )
    .bind(hash)
    .first();
  return row || null;
}
// Defence in depth on top of SameSite=Strict: state-changing admin calls must come from our own origin.
function checkCsrf(ctx) {
  const origin = ctx.request.headers.get('origin');
  if (origin && new URL(origin).host !== ctx.url.host) throw new HttpError(403, 'طلب مرفوض (أصل غير موثوق)');
  if (ctx.request.headers.get('x-requested-with') !== 'spices') throw new HttpError(403, 'طلب مرفوض');
}
export async function createSession(ctx, userId) {
  const token = randomHex(32);
  const hash = await sha256Hex(token);
  await ctx.db
    .prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .bind(hash, userId, `+${SESSION_DAYS} days`)
    .run();
  await ctx.db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  return sessionCookie(token, ctx.request, SESSION_DAYS * 86400);
}
export async function login(ctx, email, password) {
  await rateLimit(ctx.db, `login-ip:${ctx.ip}`, 20, 900);
  await rateLimit(ctx.db, `login-email:${email.toLowerCase()}`, 8, 900);
  const user = await ctx.db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').bind(email).first();
  // Always hash, even for unknown emails, so response time does not reveal which emails exist.
  const ok = await verifyPassword(password, user ? user.password_hash : 'pbkdf2$100000$00000000000000000000000000000000$00');
  if (!user || !ok) throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  return user;
}
export { hashPassword, timingSafeEqual };

// ---------- Settings ----------
export const DEFAULT_SETTINGS = {
  store_name_ar: 'عمر و يونس',
  store_name_en: 'Omar & Younis',
  tagline_ar: 'أصالة .. جودة .. ثقة',
  whatsapp: '', // international digits only, e.g. 201012345678
  delivery_fee_pt: '5000',
  free_delivery_over_pt: '100000',
  min_order_pt: '0',
  delivery_info_ar: 'نوصّل طلبك لحد باب البيت. رسوم التوصيل تظهر قبل تأكيد الطلب، والدفع نقدًا عند الاستلام.',
  announcement_ar: '',
};
export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
  return s;
}
export const intSetting = (s, k) => {
  const n = parseInt(s[k], 10);
  return Number.isFinite(n) && n >= 0 ? n : parseInt(DEFAULT_SETTINGS[k], 10);
};
