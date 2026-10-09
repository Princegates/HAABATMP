// Applies db/migrations/*.sql in order, once each, inside a transaction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/api/package.json'));
const { Client } = require('pg');

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL (or DATABASE_URL_DIRECT) is required');
  process.exit(1);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const client = new Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
await client.connect();
await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
const { rows } = await client.query('select name from schema_migrations');
const done = new Set(rows.map((r) => r.name));

for (const f of files) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  console.log('applying', f);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations(name) values ($1)', [f]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    console.error('failed', f, e.message);
    process.exit(1);
  }
}
console.log('migrations up to date');
await client.end();
