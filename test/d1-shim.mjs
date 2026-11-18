// Minimal Cloudflare D1 + R2 stand-ins backed by node:sqlite / memory, used by tests and the local dev server.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createD1(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE name='users'`).get();
  if (!exists) for (const f of readdirSync(join(root, 'migrations')).sort()) db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  const meta = (r) => ({ changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) });
  const prepare = (sql) => {
    let args = [];
    const st = {
      bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return st; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args), success: true, meta: {} }; },
      async run() { return { success: true, meta: meta(db.prepare(sql).run(...args)), results: [] }; },
      _exec() { return { success: true, meta: meta(db.prepare(sql).run(...args)), results: [] }; },
    };
    return st;
  };
  return {
    prepare,
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    raw: db,
  };
}

export function createR2() {
  const store = new Map();
  return {
    store,
    async put(key, body, opts) { store.set(key, { body: new Uint8Array(body), httpMetadata: opts?.httpMetadata }); },
    async get(key) { const o = store.get(key); return o ? { body: o.body, httpMetadata: o.httpMetadata } : null; },
    async delete(key) { store.delete(key); },
  };
}
