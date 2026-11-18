import { dispatch } from './lib/core.js';
import { HttpError, json, SECURITY_HEADERS } from './lib/util.js';
import './routes/store.js';
import './routes/admin-core.js';
import './routes/admin-catalog.js';
import './routes/admin-orders.js';
import './routes/admin-finance.js';
import './routes/admin-suppliers.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/');
    if (!isApi) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    if (!env.DB) return json({ error: 'قاعدة البيانات غير مربوطة (DB binding)' }, 503);
    try {
      return await dispatch(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, fields: e.fields }, e.status);
      console.error('Unhandled error', e && e.stack ? e.stack : e);
      return json({ error: 'حدث خطأ غير متوقع في الخادم' }, 500);
    }
  },
};
