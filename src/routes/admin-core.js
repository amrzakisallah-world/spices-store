import { get, post, put, patch, del, createSession, login, sessionCookie, getCookie, getSettings, DEFAULT_SETTINGS, hashPassword, timingSafeEqual } from '../lib/core.js';
import { HttpError, json, Validator, rateLimit, sha256Hex, verifyPassword } from '../lib/util.js';

const userCount = async (db) => (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n;

get('/api/admin/status', async (ctx) => json({ needs_setup: (await userCount(ctx.db)) === 0 }));

// One-time creation of the first owner. Requires the SETUP_TOKEN secret and is
// impossible once any user exists — there is no public registration.
post('/api/admin/setup', async (ctx) => {
  await rateLimit(ctx.db, `setup-ip:${ctx.ip}`, 10, 900);
  if (!ctx.env.SETUP_TOKEN || String(ctx.env.SETUP_TOKEN).length < 16) throw new HttpError(503, 'لم يتم ضبط SETUP_TOKEN على الخادم (16 حرفًا على الأقل)');
  if ((await userCount(ctx.db)) > 0) throw new HttpError(403, 'تم إعداد الحساب بالفعل');
  const b = await ctx.body();
  const v = new Validator(b).str('name', { min: 2, max: 60, label: 'الاسم' }).str('email', { max: 120, label: 'البريد' }).str('password', { min: 10, max: 200, label: 'كلمة المرور' }).str('token', { max: 200, label: 'رمز الإعداد' });
  const d = v.out;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || '')) v.fail('email', 'البريد غير صالح');
  v.done();
  if (!timingSafeEqual(d.token, ctx.env.SETUP_TOKEN)) throw new HttpError(403, 'رمز الإعداد غير صحيح');
  const hash = await hashPassword(d.password);
  {
    // Re-check inside the statement so two simultaneous setups cannot both succeed.
    const r = await ctx.db.prepare(`INSERT INTO users (email, name, role, password_hash) SELECT ?, ?, 'owner', ? WHERE NOT EXISTS (SELECT 1 FROM users)`).bind(d.email, d.name, hash).run();
    if (!r.meta.changes) throw new HttpError(403, 'تم إعداد الحساب بالفعل');
  }
  const user = await ctx.db.prepare('SELECT id FROM users WHERE email = ?').bind(d.email).first();
  await ctx.db.prepare(`INSERT OR IGNORE INTO suppliers (name, notes) VALUES ('حراز', 'مورد أساسي — الأسعار تُدخل يدويًا')`).run();
  return json({ ok: true }, 201, { 'Set-Cookie': await createSession(ctx, user.id) });
});

post('/api/admin/login', async (ctx) => {
  const b = await ctx.body();
  const d = new Validator(b).str('email', { max: 120, label: 'البريد' }).str('password', { max: 200, label: 'كلمة المرور' }).done();
  const user = await login(ctx, d.email, d.password);
  return json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 200, { 'Set-Cookie': await createSession(ctx, user.id) });
});

post('/api/admin/logout', async (ctx) => {
  const token = getCookie(ctx.request, 'sid');
  if (token && /^[a-f0-9]{64}$/.test(token)) await ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', ctx.request, 0) });
}, 'any');

get('/api/admin/me', async (ctx) => json({ user: ctx.user }), 'any');

post('/api/admin/password', async (ctx) => {
  const d = new Validator(await ctx.body()).str('current', { max: 200, label: 'كلمة المرور الحالية' }).str('next', { min: 10, max: 200, label: 'كلمة المرور الجديدة' }).done();
  const row = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.user.id).first();
  if (!(await verifyPassword(d.current, row.password_hash))) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
  await ctx.db.batch([
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(d.next), ctx.user.id),
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(ctx.user.id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', ctx.request, 0) });
}, 'any');

// ---------- Users (owner only) ----------
get('/api/admin/users', async (ctx) => {
  const { results } = await ctx.db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY id').all();
  return json({ users: results });
}, 'owner');

post('/api/admin/users', async (ctx) => {
  const v = new Validator(await ctx.body()).str('name', { min: 2, max: 60, label: 'الاسم' }).str('email', { max: 120, label: 'البريد' }).str('password', { min: 10, max: 200, label: 'كلمة المرور' }).oneOf('role', ['staff', 'owner'], { label: 'الصلاحية' });
  const d = v.out;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || '')) v.fail('email', 'البريد غير صالح');
  v.done();
  try {
    await ctx.db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)').bind(d.email, d.name, d.role, await hashPassword(d.password)).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'هذا البريد مسجل بالفعل');
    throw e;
  }
  return json({ ok: true }, 201);
}, 'owner');

patch('/api/admin/users/:id', async (ctx) => {
  const id = parseInt(ctx.params.id, 10);
  const d = new Validator(await ctx.body()).bool('active', true).done();
  if (id === ctx.user.id && !d.active) throw new HttpError(400, 'لا يمكنك تعطيل حسابك');
  await ctx.db.batch([
    ctx.db.prepare('UPDATE users SET active = ? WHERE id = ?').bind(d.active ? 1 : 0, id),
    ...(d.active ? [] : [ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]),
  ]);
  return json({ ok: true });
}, 'owner');

// ---------- Settings ----------
get('/api/admin/settings', async (ctx) => json({ settings: await getSettings(ctx.db) }), 'any');
put('/api/admin/settings', async (ctx) => {
  const b = await ctx.body();
  const v = new Validator(b)
    .str('store_name_ar', { max: 60, label: 'اسم المتجر' }).str('store_name_en', { max: 60, required: false })
    .str('tagline_ar', { max: 100, required: false }).str('delivery_info_ar', { max: 400, required: false }).str('announcement_ar', { max: 200, required: false })
    .int('delivery_fee_pt', { max: 10_000_000, label: 'رسوم التوصيل' }).int('free_delivery_over_pt', { max: 100_000_000, label: 'حد التوصيل المجاني' }).int('min_order_pt', { max: 100_000_000, label: 'الحد الأدنى' });
  const wRaw = String(b?.whatsapp ?? '').replace(/[\s+\-]/g, '');
  const w = wRaw;
  if (w && (!/^\d{10,15}$/.test(w))) v.fail('whatsapp', 'رقم واتساب يجب أن يكون بصيغة دولية بدون + (مثال 201012345678)');
  const d = v.done();
  const stmts = Object.entries({ ...d, whatsapp: w }).filter(([k]) => k in DEFAULT_SETTINGS).map(([k, val]) =>
    ctx.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(val)));
  await ctx.db.batch(stmts);
  return json({ ok: true });
}, 'owner');

// ---------- Categories ----------
get('/api/admin/categories', async (ctx) => {
  const { results } = await ctx.db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products FROM categories c ORDER BY sort, id').all();
  return json({ categories: results });
}, 'any');
const catSchema = async (ctx) => new Validator(await ctx.body()).str('name_ar', { max: 60, label: 'اسم القسم' }).str('name_en', { max: 60, required: false }).int('sort', { max: 9999, required: false }).bool('active', true).done();
post('/api/admin/categories', async (ctx) => {
  const d = await catSchema(ctx);
  const r = await ctx.db.prepare('INSERT INTO categories (name_ar, name_en, sort, active) VALUES (?, ?, ?, ?)').bind(d.name_ar, d.name_en, d.sort, d.active ? 1 : 0).run();
  return json({ ok: true, id: r.meta.last_row_id }, 201);
}, 'any');
put('/api/admin/categories/:id', async (ctx) => {
  const d = await catSchema(ctx);
  await ctx.db.prepare('UPDATE categories SET name_ar=?, name_en=?, sort=?, active=? WHERE id=?').bind(d.name_ar, d.name_en, d.sort, d.active ? 1 : 0, parseInt(ctx.params.id, 10)).run();
  return json({ ok: true });
}, 'any');
del('/api/admin/categories/:id', async (ctx) => {
  await ctx.db.prepare('DELETE FROM categories WHERE id = ?').bind(parseInt(ctx.params.id, 10)).run(); // products keep existing, become uncategorised
  return json({ ok: true });
}, 'owner');
