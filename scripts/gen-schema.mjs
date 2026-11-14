/**
 * Generates db/schema.sql from the tables and fields the feature modules actually
 * write (captured by IntrospectingRepo during the test run).
 *   SCC_SCHEMA_OUT=/tmp/schema.jsonl npx vitest run
 *   node scripts/gen-schema.mjs /tmp/schema.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] || '/tmp/schema.jsonl';
const PREFIX = process.env.SCC_TABLE_PREFIX || 'chess_';
const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const tables = new Map();
for (const { table, fields } of rows) {
  if (!tables.has(table)) tables.set(table, new Map());
  const t = tables.get(table);
  for (const f of fields || []) {
    if (!t.has(f)) t.set(f, new Set());
    t.get(f); // presence only; types inferred from a later pass if provided
  }
}

// type hints captured alongside field names
const types = new Map();
for (const { table, fields, values } of rows) {
  if (!values) continue;
  if (!types.has(table)) types.set(table, new Map());
  const t = types.get(table);
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    if (!t.has(k)) t.set(k, new Set());
    t.get(k).add(typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : Array.isArray(v) || typeof v === 'object' ? 'json' : 'string');
  }
}

const sqlType = (table, field) => {
  const seen = [...(types.get(table)?.get(field) || [])];
  if (field === 'id') return 'text';
  if (/(At|Date)$/.test(field) && seen.every((s) => s === 'string')) return 'timestamptz';
  if (seen.length === 1 && seen[0] === 'boolean') return 'boolean';
  if (seen.length === 1 && seen[0] === 'number') return 'numeric';
  if (seen.length === 1 && seen[0] === 'json') return 'jsonb';
  return 'text';
};

const out = [
  '-- SaiU Chess Club — PostgreSQL schema',
  '-- Generated from the tables and fields the feature modules write.',
  `-- Tables are prefixed "${PREFIX}" so they never collide with other applications in the same project.`,
  '-- Every table: id text primary key, "createdAt"/"updatedAt" timestamptz.',
  '',
];

for (const table of [...tables.keys()].sort()) {
  const fields = [...tables.get(table).keys()].filter((f) => f !== 'id');
  out.push(`create table if not exists "${PREFIX}${table}" (`);
  out.push('  id text primary key');
  for (const f of fields) out.push(`,  "${f}" ${sqlType(table, f)}`);
  out.push(');');
  out.push(`create index if not exists "${PREFIX}${table}_created_idx" on "${PREFIX}${table}" ("createdAt" desc);`);
  out.push('');
}

// columns discovered later in the run (patch-only fields) are added defensively
out.push('-- Idempotent column additions for fields first seen in an update patch');
for (const table of [...tables.keys()].sort()) {
  for (const f of [...tables.get(table).keys()].filter((x) => x !== 'id')) {
    out.push(`alter table "${PREFIX}${table}" add column if not exists "${f}" ${sqlType(table, f)};`);
  }
}
out.push('');
writeFileSync('db/schema.sql', out.join('\n'));
console.log(`wrote db/schema.sql — ${tables.size} tables, ${[...tables.values()].reduce((a, m) => a + m.size, 0)} columns`);
