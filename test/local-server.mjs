// Local preview server: runs the real Worker code against a SQLite file and serves /public.
// Usage: npm run local   (then open http://localhost:8787)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1, createR2 } from './d1-shim.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const port = parseInt(process.env.PORT || '8787', 10);
let dbPath = process.env.LOCAL_DB || join(root, 'local-data', 'dev.sqlite');
if (dbPath !== ':memory:') await mkdir(dirname(dbPath), { recursive: true });
const env = { DB: createD1(dbPath), IMAGES: createR2(), SETUP_TOKEN: process.env.SETUP_TOKEN || 'local-dev-setup-token-123' };
const csp = (await readFile(join(pub, '_headers'), 'utf8')).match(/Content-Security-Policy: (.+)/)[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

async function staticFile(pathname) {
  let p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/') || p === '') p = join(p, 'index.html');
  const file = join(pub, p);
  if (!file.startsWith(pub)) return new Response('Forbidden', { status: 403 });
  try { return new Response(await readFile(file), { headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp } }); }
  catch { return new Response('Not found', { status: 404 }); }
}
env.ASSETS = { fetch: (req) => staticFile(new URL(req.url).pathname) };

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(',') : v);
  headers.set('cf-connecting-ip', process.env.FAKE_IP || req.socket.remoteAddress || 'local');
  const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const r = await worker.fetch(request, env, {});
  const out = {}; r.headers.forEach((v, k) => (out[k] = v));
  const sc = r.headers.getSetCookie?.(); if (sc?.length) out['set-cookie'] = sc;
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`Spices Store (local) → http://localhost:${port}   admin → /admin/   setup token: ${env.SETUP_TOKEN}`));
