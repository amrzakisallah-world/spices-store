// Shared helpers (no external dependencies — runs on Cloudflare Workers and Node 22).

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

// ---------- Money (piasters, integers) ----------
export function fmtMoney(pt) {
  const n = Math.round(pt);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
export const lineTotal = (qty, unitPt) => Math.round(qty * unitPt);

// ---------- Dates (Egypt local day) ----------
const cairoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
export function cairoDay(date = new Date()) {
  return cairoFmt.format(date); // YYYY-MM-DD
}
export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---------- Validation ----------
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function latinDigits(s) {
  return String(s).replace(/[٠-٩]/g, (c) => AR_DIGITS.indexOf(c)).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0);
}
export function normalizePhone(raw) {
  let p = latinDigits(String(raw ?? '')).replace(/[\s\-().]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^\+20(1[0125]\d{8})$/.test(p)) p = '0' + p.slice(3);
  else if (/^20(1[0125]\d{8})$/.test(p)) p = '0' + p.slice(2);
  else if (/^1[0125]\d{8}$/.test(p)) p = '0' + p;
  return p;
}
export const isPhone = (p) => /^(01[0125]\d{8}|\+?\d{8,15})$/.test(p);

export class Validator {
  constructor(obj) {
    this.o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    this.errors = {};
    this.out = {};
  }
  fail(key, msg) {
    if (!this.errors[key]) this.errors[key] = msg;
  }
  str(key, { min = 0, max = 200, required = true, label = key, def = '' } = {}) {
    let v = this.o[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, `${label} مطلوب`);
      this.out[key] = def;
      return this;
    }
    if (typeof v !== 'string') { this.fail(key, `${label} غير صالح`); return this; }
    v = v.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    if (v.length < min) this.fail(key, `${label} قصير جدًا`);
    else if (v.length > max) this.fail(key, `${label} طويل جدًا (الحد الأقصى ${max} حرفًا)`);
    else if (required && v.length === 0) this.fail(key, `${label} مطلوب`);
    this.out[key] = v;
    return this;
  }
  int(key, { min = 0, max = 1_000_000_000, required = true, label = key, def = 0 } = {}) {
    const v = this.o[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, `${label} مطلوب`);
      this.out[key] = def;
      return this;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) { this.fail(key, `${label} يجب أن يكون رقمًا صحيحًا`); return this; }
    if (v < min || v > max) { this.fail(key, `${label} خارج النطاق المسموح`); return this; }
    this.out[key] = v;
    return this;
  }
  num(key, { min = 0, max = 1_000_000, required = true, label = key, def = 0 } = {}) {
    const v = this.o[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, `${label} مطلوب`);
      this.out[key] = def;
      return this;
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { this.fail(key, `${label} غير صالح`); return this; }
    this.out[key] = v;
    return this;
  }
  bool(key, def = false) {
    const v = this.o[key];
    this.out[key] = v === undefined || v === null ? def : v === true || v === 1;
    return this;
  }
  oneOf(key, values, { required = true, label = key, def = values[0] } = {}) {
    const v = this.o[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, `${label} مطلوب`);
      this.out[key] = def;
      return this;
    }
    if (!values.includes(v)) { this.fail(key, `${label} غير صالح`); return this; }
    this.out[key] = v;
    return this;
  }
  day(key, { required = false, label = key, def = null } = {}) {
    const v = this.o[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, `${label} مطلوب`);
      this.out[key] = def ?? cairoDay();
      return this;
    }
    if (!isDay(v)) { this.fail(key, `${label} يجب أن يكون بصيغة YYYY-MM-DD`); return this; }
    this.out[key] = v;
    return this;
  }
  done() {
    if (Object.keys(this.errors).length) throw new HttpError(400, 'بيانات غير صالحة، راجع الحقول المحددة', this.errors);
    return this.out;
  }
}

// ---------- Crypto ----------
const enc = new TextEncoder();
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
export function randomHex(bytes = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITER = 100000;
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITER)}`;
}
export async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !iter || !saltHex || !hashHex) return false;
  return timingSafeEqual(await pbkdf2(password, fromHex(saltHex), parseInt(iter, 10)), hashHex);
}

// ---------- Rate limiting (fixed window, stored in D1) ----------
export async function rateLimit(db, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`
    )
    .bind(key, now, now - windowSec, now - windowSec, now)
    .run();
  const row = await db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 86400).run();
  if (row.count > max) {
    const wait = Math.max(1, row.window_start + windowSec - now);
    throw new HttpError(429, `محاولات كثيرة، حاول مرة أخرى بعد ${Math.ceil(wait / 60)} دقيقة`);
  }
}

export function makeOrderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'SP' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
