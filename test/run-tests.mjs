// End-to-end tests of the Worker API against an in-memory SQLite database.
// Run: npm test
import worker from '../src/worker.js';
import { createD1, createR2 } from './d1-shim.mjs';
import { hashPassword, verifyPassword, normalizePhone, cairoDay } from '../src/lib/util.js';
import { periodRange, previousRange } from '../src/lib/reports.js';

const SETUP = 'test-setup-token-1234567890';
const env = { DB: createD1(), IMAGES: createR2(), SETUP_TOKEN: SETUP, ASSETS: { fetch: async () => new Response('asset') } };
let n = 0, failed = 0;
const results = [];
function ok(cond, name, extra) {
  n++;
  if (cond) results.push(`  ✓ ${name}`);
  else { failed++; results.push(`  ✗ ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });

let ipCounter = 0;
async function call(method, path, { body, cookie, ip, raw, type, noCsrf } = {}) {
  const headers = { 'cf-connecting-ip': ip || `10.0.0.${++ipCounter}` };
  if (cookie) headers.cookie = cookie;
  if (!noCsrf) headers['x-requested-with'] = 'spices';
  let payload;
  if (raw) { payload = raw; headers['content-type'] = type; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await worker.fetch(new Request('https://shop.test' + path, { method, headers, body: payload }), env, {});
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

console.log('\n== Unit: passwords, phones, dates ==');
{
  const h = await hashPassword('correct horse battery');
  ok(h.startsWith('pbkdf2$100000$') && !h.includes('correct'), 'password hash is salted PBKDF2, not plaintext');
  ok(await verifyPassword('correct horse battery', h), 'correct password verifies');
  ok(!(await verifyPassword('wrong password', h)), 'wrong password rejected');
  eq(normalizePhone('+20 101 234 5678'), '01012345678', 'phone +20 normalised');
  eq(normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '01012345678', 'Arabic-Indic digits normalised');
  const w = periodRange('week', '2026-11-17'); // Tuesday
  eq(w.from, '2026-11-14', 'week starts Saturday'); eq(w.to, '2026-11-20', 'week ends Friday');
  const m = periodRange('month', '2026-02-10'); eq(m.to, '2026-02-28', 'month end Feb');
  eq(previousRange('2026-01-01', '2026-01-31').from, '2025-12-01', 'previous month range');
}

console.log('\n== Setup & authentication ==');
let owner, staff;
{
  eq((await call('GET', '/api/admin/status')).data.needs_setup, true, 'fresh DB needs setup');
  eq((await call('GET', '/api/admin/products')).status, 401, 'admin API blocked without login');
  eq((await call('POST', '/api/admin/setup', { body: { name: 'Owner', email: 'o@x.com', password: 'longpassword123', token: 'wrong-token-wrong-token' } })).status, 403, 'setup rejects wrong token');
  eq((await call('POST', '/api/admin/setup', { body: { name: 'Owner', email: 'o@x.com', password: 'short', token: SETUP } })).status, 400, 'setup rejects weak password');
  const r = await call('POST', '/api/admin/setup', { body: { name: 'المالك', email: 'o@x.com', password: 'longpassword123', token: SETUP } });
  eq(r.status, 201, 'setup creates owner with correct token');
  owner = cookieOf(r);
  const sc = r.headers.get('set-cookie');
  ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Secure/.test(sc), 'session cookie is HttpOnly + SameSite=Strict + Secure', sc);
  eq((await call('POST', '/api/admin/setup', { body: { name: 'Hacker', email: 'h@x.com', password: 'longpassword123', token: SETUP } })).status, 403, 'second setup blocked (no public registration)');
  eq((await call('GET', '/api/admin/status')).data.needs_setup, false, 'setup closed afterwards');
  const row = env.DB.raw.prepare('SELECT password_hash FROM users').get();
  ok(row.password_hash.startsWith('pbkdf2$'), 'DB stores hash only');
  const s = env.DB.raw.prepare('SELECT token_hash FROM sessions').get();
  ok(s.token_hash.length === 64 && s.token_hash !== owner.split('=')[1], 'DB stores only hash of session token');
  eq((await call('GET', '/api/admin/me', { cookie: owner })).data.user.role, 'owner', 'session works');
  eq((await call('POST', '/api/admin/products', { cookie: owner, noCsrf: true, body: { name_ar: 'x', price_pt: 1 } })).status, 403, 'CSRF header required on writes');
  const evil = await worker.fetch(new Request('https://shop.test/api/admin/categories', { method: 'POST', headers: { cookie: owner, origin: 'https://evil.test', 'x-requested-with': 'spices', 'content-type': 'application/json' }, body: JSON.stringify({ name_ar: 'x' }) }), env, {});
  eq(evil.status, 403, 'cross-origin write rejected');
  eq((await call('POST', '/api/admin/login', { body: { email: 'o@x.com', password: 'bad-password-123' } })).status, 401, 'wrong login rejected');
  eq((await call('POST', '/api/admin/users', { cookie: owner, body: { name: 'موظف', email: 's@x.com', password: 'staffpassword1', role: 'staff' } })).status, 201, 'owner creates staff');
  const l = await call('POST', '/api/admin/login', { body: { email: 's@x.com', password: 'staffpassword1' } });
  eq(l.status, 200, 'staff logs in'); staff = cookieOf(l);
  eq((await call('GET', '/api/admin/dashboard', { cookie: staff })).status, 403, 'staff cannot open dashboard');
  eq((await call('GET', '/api/admin/expenses', { cookie: staff })).status, 403, 'staff cannot open expenses');
  eq((await call('GET', '/api/admin/suppliers', { cookie: staff })).status, 403, 'staff cannot open suppliers');
  eq((await call('GET', '/api/admin/orders', { cookie: staff })).status, 200, 'staff can open orders');
  const bf = [];
  for (let i = 0; i < 10; i++) bf.push((await call('POST', '/api/admin/login', { ip: '9.9.9.9', body: { email: 'victim@x.com', password: 'guess-guess-' + i } })).status);
  ok(bf.includes(429), 'brute-force login is rate limited', bf);
  const lo = await call('POST', '/api/admin/logout', { cookie: staff });
  eq((await call('GET', '/api/admin/me', { cookie: staff })).status, 401, 'logout invalidates session');
  const l2 = await call('POST', '/api/admin/login', { body: { email: 's@x.com', password: 'staffpassword1' } }); staff = cookieOf(l2);
}

console.log('\n== Catalogue ==');
let catId, p1, p2;
{
  const c = await call('POST', '/api/admin/categories', { cookie: owner, body: { name_ar: 'بهارات', sort: 1 } });
  eq(c.status, 201, 'create category'); catId = c.data.id;
  eq((await call('POST', '/api/admin/products', { cookie: owner, body: { name_ar: 'كمون', price_pt: -5 } })).status, 400, 'negative price rejected');
  eq((await call('POST', '/api/admin/products', { cookie: owner, body: { name_ar: 'كمون', price_pt: 12.5 } })).status, 400, 'fractional piasters rejected');
  eq((await call('POST', '/api/admin/products', { cookie: owner, body: { price_pt: 100 } })).status, 400, 'missing name rejected');
  const a = await call('POST', '/api/admin/products', { cookie: owner, body: { name_ar: 'كمون حب بلدي', unit_label: '250 جم', category_id: catId, price_pt: 4500, cost_pt: 3000, stock_qty: 10, low_stock_threshold: 3 } });
  eq(a.status, 201, 'create product 1'); p1 = a.data.id;
  const b = await call('POST', '/api/admin/products', { cookie: owner, body: { name_ar: 'فلفل أحمر ناعم', unit_label: '250 جم', category_id: catId, price_pt: 4000, cost_pt: 2500, stock_qty: 2, low_stock_threshold: 3 } });
  p2 = b.data.id;
  const hidden = await call('POST', '/api/admin/products', { cookie: owner, body: { name_ar: 'منتج مخفي', price_pt: 100, stock_qty: 5, active: false } });
  const list = (await call('GET', '/api/store/products')).data.products;
  eq(list.length, 2, 'storefront lists only active products');
  ok(list.every((p) => !('cost_pt' in p) && !('stock_qty' in p)), 'storefront never exposes cost or exact stock');
  eq(list.find((p) => p.id === p1).price_pt, 4500, 'price comes from database');
  eq(list.find((p) => p.id === p2).stock_status, 'low', 'low-stock status shown');
  eq((await call('GET', '/api/store/products/' + hidden.data.id)).status, 404, 'inactive product hidden');
  eq((await call('GET', '/api/store/products?q=' + encodeURIComponent('كمون'))).data.products.length, 1, 'search works');
  eq((await call('GET', '/api/store/categories')).data.categories.length, 1, 'categories list');
  const st = await call('POST', `/api/admin/products/${p1}/stock`, { cookie: staff, body: { delta: -1, note: 'عينة' } });
  eq(st.status, 200, 'stock adjust'); 
  eq((await call('POST', `/api/admin/products/${p1}/stock`, { cookie: staff, body: { delta: -999 } })).status, 400, 'stock cannot go negative');
  await call('POST', `/api/admin/products/${p1}/stock`, { cookie: staff, body: { delta: 1, note: 'تصحيح' } });
  eq((await call('DELETE', `/api/admin/products/${p2}`, { cookie: staff })).status, 403, 'staff cannot delete products');
  const sv = (await call('GET', '/api/admin/products', { cookie: staff })).data.products;
  ok(sv.length > 0 && sv.every((x) => !('cost_pt' in x)), 'staff never receives purchase cost');
  const sd = (await call('GET', '/api/admin/products/' + p1, { cookie: staff })).data;
  ok(!('cost_pt' in sd.product) && sd.price_history.length === 0, 'staff product detail hides cost + price history');
  eq((await call('PUT', `/api/admin/products/${p2}`, { cookie: staff, body: { name_ar: 'فلفل أحمر ناعم', unit_label: '250 جم', category_id: catId, price_pt: 4000, low_stock_threshold: 3 } })).status, 200, 'staff can edit product');
  eq(env.DB.raw.prepare('SELECT cost_pt FROM products WHERE id=?').get(p2).cost_pt, 2500, 'staff edit does not overwrite cost');
  // image upload
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const up = await call('POST', `/api/admin/products/${p1}/images`, { cookie: owner, raw: png, type: 'image/png' });
  eq(up.status, 201, 'image upload (R2)');
  eq((await call('POST', `/api/admin/products/${p1}/images`, { cookie: owner, raw: new Uint8Array([1, 2, 3, 4]), type: 'image/png' })).status, 400, 'fake image rejected by magic bytes');
  eq((await call('POST', `/api/admin/products/${p1}/images`, { cookie: owner, raw: png, type: 'text/html' })).status, 415, 'non-image type rejected');
  const img = await worker.fetch(new Request('https://shop.test/media/' + up.data.key), env, {});
  eq(img.status, 200, 'image served publicly');
  eq((await call('GET', '/api/store/products/' + p1)).data.product.images.length, 1, 'product detail lists images');
  eq((await worker.fetch(new Request('https://shop.test/media/products/1/../../etc'), env, {})).status, 404, 'image path traversal blocked');
}

console.log('\n== Orders (customer) ==');
let order1, order2;
{
  const good = { name: 'أحمد علي', phone: '٠١٠١٢٣٤٥٦٧٨', area: 'مدينة نصر', address: '12 شارع التحرير، الدور الثالث', notes: 'اتصل قبل الوصول', items: [{ product_id: p1, qty: 3 }] };
  eq((await call('POST', '/api/store/orders', { body: { ...good, website: 'spam' } })).status, 400, 'honeypot rejects bots');
  eq((await call('POST', '/api/store/orders', { body: { ...good, phone: '123' } })).status, 400, 'invalid phone rejected');
  eq((await call('POST', '/api/store/orders', { body: { ...good, items: [] } })).status, 400, 'empty cart rejected');
  eq((await call('POST', '/api/store/orders', { body: { ...good, items: [{ product_id: p1, qty: 0 }] } })).status, 400, 'qty 0 rejected');
  eq((await call('POST', '/api/store/orders', { body: { ...good, items: [{ product_id: p1, qty: 500 }] } })).status, 400, 'huge qty rejected');
  eq((await call('POST', '/api/store/orders', { body: { ...good, items: [{ product_id: p2, qty: 5 }] } })).status, 409, 'over-stock rejected');
  eq((await call('POST', '/api/store/orders', { body: { ...good, address: 'x' } })).status, 400, 'short address rejected');
  const r = await call('POST', '/api/store/orders', { body: good });
  eq(r.status, 201, 'order created'); order1 = r.data;
  eq(r.data.total_pt, 3 * 4500 + 5000, 'total = items + delivery fee (13500 + 5000)');
  const adm = await call('GET', '/api/admin/orders?q=' + r.data.code, { cookie: staff });
  eq(adm.data.orders.length, 1, 'admin finds order by code'); order1.id = adm.data.orders[0].id;
  eq(adm.data.orders[0].phone, '01012345678', 'stored phone is normalised');
  eq(env.DB.raw.prepare('SELECT stock_qty FROM products WHERE id=?').get(p1).stock_qty, 7, 'stock reduced by sale');
  // price change must not rewrite history
  await call('PUT', `/api/admin/products/${p1}`, { cookie: owner, body: { name_ar: 'كمون حب بلدي', unit_label: '250 جم', category_id: catId, price_pt: 5000, cost_pt: 3200, low_stock_threshold: 3 } });
  const d = await call('GET', '/api/admin/orders/' + order1.id, { cookie: owner });
  ok(!('unit_cost_pt' in (await call('GET', '/api/admin/orders/' + order1.id, { cookie: staff })).data.items[0]), 'staff cannot see item cost in orders');
  eq(d.data.items[0].unit_price_pt, 4500, 'old order keeps original price after price change');
  eq(d.data.order.total_pt, 18500, 'old order total unchanged');
  eq(d.data.items[0].unit_cost_pt, 3000, 'old order keeps original cost snapshot');
  const ph = (await call('GET', '/api/admin/products/' + p1, { cookie: owner })).data.price_history;
  ok(ph.length >= 2 && ph[0].old_price_pt === 4500 && ph[0].new_price_pt === 5000, 'price history recorded', ph[0]);
  const r2 = await call('POST', '/api/store/orders', { body: { ...good, items: [{ product_id: p1, qty: 2 }, { product_id: p2, qty: 1 }] } });
  eq(r2.data.total_pt, 2 * 5000 + 4000 + 5000, 'new order uses new price (19000)'); order2 = r2.data;
  order2.id = (await call('GET', '/api/admin/orders?q=' + r2.data.code, { cookie: staff })).data.orders[0].id;
  eq((await call('GET', `/api/store/orders/${order1.code}?phone=01012345678`)).data.order.status, 'pending', 'customer can track order');
  eq((await call('GET', `/api/store/orders/${order1.code}?phone=01099999999`)).status, 404, 'tracking needs matching phone');
  ok(!('id' in (await call('GET', `/api/store/orders/${order1.code}?phone=01012345678`)).data.order), 'tracking hides internal id');
  const big = await call('POST', '/api/store/orders', { body: { ...good, items: [{ product_id: p1, qty: 30 }] }, ip: '5.5.5.5' });
  eq(big.status, 409, 'insufficient stock after sales');
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call('POST', '/api/store/orders', { ip: '7.7.7.7', body: { ...good, items: [{ product_id: p1, qty: 100 }] } })).status);
  ok(codes.includes(429), 'order endpoint is rate limited per IP', codes);
}

console.log('\n== Order lifecycle & money ==');
{
  const S = (id, status, extra = {}) => call('POST', `/api/admin/orders/${id}/status`, { cookie: staff, body: { status, ...extra } });
  eq((await S(order1.id, 'confirmed')).status, 200, 'confirm');
  eq((await call('PATCH', '/api/admin/orders/' + order1.id, { cookie: staff, body: { delivery_cost_pt: 3000 } })).status, 200, 'record delivery cost');
  eq((await S(order1.id, 'out_for_delivery')).status, 200, 'out for delivery');
  eq((await S(order1.id, 'delivered')).status, 200, 'delivered');
  eq((await call('POST', `/api/admin/orders/${order1.id}/payments`, { cookie: staff, body: { amount_pt: 99999999, method: 'cash' } })).status, 400, 'overpayment rejected');
  const pay = await call('POST', `/api/admin/orders/${order1.id}/payments`, { cookie: staff, body: { amount_pt: 10000, method: 'cash' } });
  eq(pay.status, 201, 'partial payment'); 
  eq((await call('GET', '/api/admin/orders/' + order1.id, { cookie: staff })).data.order.payment_status, 'partial', 'status partial');
  await call('POST', `/api/admin/orders/${order1.id}/payments`, { cookie: staff, body: { amount_pt: 8500, method: 'vodafone_cash' } });
  const o = (await call('GET', '/api/admin/orders/' + order1.id, { cookie: owner })).data;
  eq(o.order.payment_status, 'paid', 'status paid'); eq(o.order.paid_pt, 18500, 'paid total');
  eq(o.profit_pt, 13500 - 9000 + 5000 - 3000, 'order profit = 4500 gross + 2000 delivery margin = 6500');
  eq((await S(order1.id, 'cancelled')).status, 400, 'cannot cancel delivered order');
  eq((await call('POST', '/api/admin/expenses', { cookie: owner, body: { category: 'تغليف', amount_pt: 1000, note: 'أكياس' } })).status, 201, 'record expense');
  eq((await call('POST', '/api/admin/expenses', { cookie: owner, body: { category: 'x', amount_pt: 0 } })).status, 400, 'zero expense rejected');
  const s = (await call('GET', '/api/admin/reports/pnl', { cookie: owner })).data.summary;
  eq(s.revenue_pt, 18500, 'revenue = 18500');
  eq(s.product_sales_pt, 13500, 'product sales = 13500');
  eq(s.cogs_pt, 9000, 'COGS uses cost snapshot (3×3000)');
  eq(s.gross_profit_pt, 4500, 'gross profit = 4500 (not revenue!)');
  eq(s.delivery_margin_pt, 2000, 'delivery margin = 5000 fee − 3000 cost');
  eq(s.expenses_pt, 1000, 'expenses = 1000');
  eq(s.net_profit_pt, 5500, 'net profit = 4500 + 2000 − 1000 = 5500');
  eq(s.cash_in_pt, 18500, 'cash in = payments'); eq(s.cash_out_pt, 1000, 'cash out = expense'); eq(s.net_cash_pt, 17500, 'net cash');
  eq(s.gross_margin_pct, 33.3, 'gross margin %');
  // cancellation of order2 restores stock
  const before = env.DB.raw.prepare('SELECT stock_qty FROM products WHERE id=?').get(p2).stock_qty;
  await call('POST', `/api/admin/orders/${order2.id}/payments`, { cookie: staff, body: { amount_pt: 5000, method: 'cash' } });
  const need = await S(order2.id, 'cancelled', { reason: 'العميل ألغى' });
  eq(need.status, 409, 'cancel with payments asks for refund decision');
  const canc = await S(order2.id, 'cancelled', { reason: 'العميل ألغى', refund: true });
  eq(canc.status, 200, 'cancel with refund');
  eq(env.DB.raw.prepare('SELECT stock_qty FROM products WHERE id=?').get(p2).stock_qty, before + 1, 'cancel returns stock');
  eq((await call('GET', '/api/admin/orders/' + order2.id, { cookie: staff })).data.order.paid_pt, 0, 'refund zeroes paid');
  const s2 = (await call('GET', '/api/admin/reports/pnl', { cookie: owner })).data.summary;
  eq(s2.revenue_pt, 18500, 'cancelled order excluded from revenue');
  eq(s2.cash_in_pt, 23500, 'refund recorded in cash in (payment)'); eq(s2.cash_out_pt, 6000, 'refund recorded in cash out (5000 + 1000)');
  eq(s2.orders_cancelled, 1, 'cancelled counted');
  eq((await S(order2.id, 'confirmed')).status, 400, 'cancelled order is final');
  const dash = await call('GET', '/api/admin/dashboard', { cookie: owner });
  eq(dash.status, 200, 'dashboard loads');
  eq(dash.data.periods.day.current.revenue_pt, 18500, 'dashboard daily revenue');
  eq(dash.data.periods.year.current.net_profit_pt, 5500, 'dashboard yearly net profit');
  ok(Array.isArray(dash.data.alerts) && dash.data.alerts.some((a) => a.type === 'low_stock' || a.type === 'out_of_stock'), 'dashboard shows stock alerts', dash.data.alerts);
  const delOne = await call('DELETE', '/api/admin/expenses/1', { cookie: owner });
  eq(delOne.status, 200, 'delete expense');
  eq((await call('GET', '/api/admin/reports/pnl', { cookie: owner })).data.summary.cash_out_pt, 5000, 'deleting expense removes ledger entry');
  await call('POST', '/api/admin/expenses', { cookie: owner, body: { category: 'تغليف', amount_pt: 1000 } });
  const csv = await call('GET', '/api/admin/export/orders', { cookie: owner });
  const rawCsv = new Uint8Array(await (await worker.fetch(new Request('https://shop.test/api/admin/export/orders', { headers: { cookie: owner } }), env, {})).arrayBuffer());
  ok(csv.status === 200 && rawCsv[0] === 0xef && rawCsv[1] === 0xbb && rawCsv[2] === 0xbf && csv.data.includes(order1.code), 'CSV export works with UTF-8 BOM');
  await call('POST', '/api/admin/ledger', { cookie: owner, body: { direction: 'in', amount_pt: 500, note: '=HYPERLINK("http://evil")' } });
  const lcsv = await call('GET', '/api/admin/export/ledger', { cookie: owner });
  ok(lcsv.data.includes("'=HYPERLINK") , 'CSV formula injection neutralised', lcsv.data.slice(0, 300));
}

console.log('\n== Suppliers & Harraz price tracking ==');
{
  const sups = (await call('GET', '/api/admin/suppliers', { cookie: owner })).data.suppliers;
  ok(sups.some((s) => s.name === 'حراز'), 'Harraz supplier seeded (no fake prices)');
  eq((await call('GET', '/api/admin/supplier-prices', { cookie: owner })).data.prices.length, 0, 'no invented prices exist');
  const hid = sups.find((s) => s.name === 'حراز').id;
  const P = (price, day, extra = {}) => call('POST', '/api/admin/supplier-prices', { cookie: owner, body: { supplier_id: hid, product_id: p1, price_pt: price, unit: 'عبوة 250 جم', day, ...extra } });
  eq((await P(3000, '2026-10-01')).status, 201, 'record Harraz price (manual)');
  eq((await P(3300, '2026-11-01')).status, 201, 'record newer price');
  eq((await P(3600, '2026-11-10', { update_product_cost: true })).status, 201, 'record newest + update product cost');
  eq(env.DB.raw.prepare('SELECT cost_pt FROM products WHERE id=?').get(p1).cost_pt, 3600, 'product cost updated from supplier price');
  const hist = (await call('GET', `/api/admin/supplier-prices?supplier_id=${hid}&product_id=${p1}`, { cookie: owner })).data.prices;
  eq(hist.length, 3, 'full price history preserved'); 
  const latest = (await call('GET', '/api/admin/supplier-prices/latest', { cookie: owner })).data.items[0];
  eq(latest.price_pt, 3600, 'latest price'); eq(latest.prev_price_pt, 3300, 'previous price'); eq(latest.change_pct, 9.1, 'change % = +9.1');
  const cmp = (await call('GET', '/api/admin/supplier-prices/compare', { cookie: owner })).data.products.find((x) => x.product_id === p1);
  eq(cmp.selling_price_pt, 5000, 'compare: selling price'); eq(cmp.best_offer_pt, 3600, 'compare: best supplier offer'); eq(cmp.margin_pt, 1400, 'compare: margin = 5000 − 3600');
  eq((await call('POST', '/api/admin/supplier-prices', { cookie: owner, body: { supplier_id: hid, price_pt: 100 } })).status, 400, 'price needs item name or product');
  // purchase invoice
  const stockBefore = env.DB.raw.prepare('SELECT stock_qty FROM products WHERE id=?').get(p1).stock_qty;
  const pu = await call('POST', '/api/admin/purchases', { cookie: owner, body: { supplier_id: hid, invoice_no: 'H-100', day: '2026-11-15', paid_pt: 20000, items: [
    { product_id: p1, qty: 20, unit_price_pt: 3800, add_to_stock: true, update_cost: true },
    { item_name: 'كمون خام', unit: 'كجم', qty: 2.5, unit_price_pt: 24000 } ] } });
  eq(pu.status, 201, 'create purchase invoice');
  eq(pu.data.total_pt, 20 * 3800 + 60000, 'invoice total = 76000 + 60000');
  eq(env.DB.raw.prepare('SELECT stock_qty FROM products WHERE id=?').get(p1).stock_qty, stockBefore + 20, 'purchase adds stock');
  eq(env.DB.raw.prepare('SELECT cost_pt FROM products WHERE id=?').get(p1).cost_pt, 3800, 'purchase updates cost');
  const bal = (await call('GET', '/api/admin/suppliers', { cookie: owner })).data.suppliers.find((s) => s.id === hid);
  eq(bal.balance_pt, 136000 - 20000, 'supplier balance = total − paid'); 
  eq((await call('POST', `/api/admin/purchases/${pu.data.id}/payments`, { cookie: owner, body: { amount_pt: 999999999 } })).status, 400, 'cannot overpay invoice');
  eq((await call('POST', `/api/admin/purchases/${pu.data.id}/payments`, { cookie: owner, body: { amount_pt: 16000 } })).status, 201, 'pay supplier later');
  const items = (await call('GET', '/api/admin/purchases/' + pu.data.id, { cookie: owner })).data.items;
  eq(items.length, 2, 'purchase items stored');
  const ledgerOut = env.DB.raw.prepare(`SELECT SUM(amount_pt) s FROM cash_ledger WHERE category='supplier_payment'`).get().s;
  eq(ledgerOut, 36000, 'supplier payments hit cash ledger');
  const lat2 = (await call('GET', '/api/admin/supplier-prices/latest', { cookie: owner })).data.items;
  ok(lat2.some((x) => x.item_name === 'كمون خام' && x.price_pt === 24000), 'free-text item tracked by name');
  const sp = await call('POST', '/api/admin/purchases', { cookie: owner, body: { supplier_id: hid, day: '2026-11-15', items: [{ item_name: 'x', qty: 1.5, unit_price_pt: 100, add_to_stock: true }] } });
  eq(sp.status, 400, 'stock add requires product + whole qty');
  const alerts = (await call('GET', '/api/admin/dashboard', { cookie: owner })).data.alerts;
  ok(alerts.some((a) => a.type === 'supplier_payable'), 'supplier payable alert', alerts.map((a) => a.type));
}

console.log('\n== Settings & misc ==');
{
  eq((await call('PUT', '/api/admin/settings', { cookie: owner, body: { store_name_ar: 'عمر و يونس', delivery_fee_pt: 3000, free_delivery_over_pt: 20000, min_order_pt: 0, whatsapp: '201012345678' } })).status, 200, 'update settings');
  const s = (await call('GET', '/api/store/settings')).data;
  eq(s.delivery_fee_pt, 3000, 'storefront reads delivery fee'); eq(s.whatsapp, '201012345678', 'whatsapp configured');
  eq((await call('PUT', '/api/admin/settings', { cookie: owner, body: { store_name_ar: 'x', delivery_fee_pt: 1, free_delivery_over_pt: 1, min_order_pt: 0, whatsapp: 'abc' } })).status, 400, 'invalid whatsapp rejected');
  eq((await call('PUT', '/api/admin/settings', { cookie: staff, body: {} })).status, 403, 'staff cannot change settings');
  const o = await call('POST', '/api/store/orders', { body: { name: 'منى', phone: '01112345678', address: 'عنوان تجريبي طويل', items: [{ product_id: p1, qty: 4 }] } });
  eq(o.data.delivery_fee_pt, 0, 'free delivery above threshold (4×5000 ≥ 20000)');
  eq((await call('GET', '/api/nope')).status, 404, 'unknown route 404');
  eq((await call('DELETE', '/api/store/products')).status, 405, 'wrong method 405');
  eq((await call('POST', '/api/store/orders', { raw: 'x', type: 'text/plain' })).status, 415, 'non-JSON body rejected');
  const xss = await call('POST', '/api/store/orders', { body: { name: '<script>alert(1)</script>', phone: '01112345678', address: 'عنوان تجريبي طويل', items: [{ product_id: p1, qty: 1 }] } });
  eq(xss.status, 201, 'script text is stored as inert text (escaped on display)');
  const root = await worker.fetch(new Request('https://shop.test/'), env, {});
  eq(await root.text(), 'asset', 'non-API paths are served by static assets');
}

console.log(results.join('\n'));
console.log(`\n${n - failed}/${n} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
