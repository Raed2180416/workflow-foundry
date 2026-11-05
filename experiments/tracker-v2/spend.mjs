#!/usr/bin/env node
// Spend of the tracker program (PREREG-TRACKER §7, PREREG-TRACKER-H §6) from the model-call journals, read-only: every journaled call,
// including calls whose step later stopped on an environment fault (their output was never scored, their cost was paid).
//   node experiments/tracker-v2/spend.mjs [research/tracker-20261021]
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'research/tracker-20261021');
const rows = [];
for (const dir of ['builder1', 'e8', 'heldout']) {
  const j = path.join(root, dir, 'journal');
  if (!existsSync(j)) continue;
  for (const f of readdirSync(j).filter(f => f.endsWith('.sqlite'))) {
    const db = new DatabaseSync(path.join(j, f), { readOnly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
        const cost = cols.find(c => /cost/i.test(c) && /usd/i.test(c)) ?? cols.find(c => /cost/i.test(c));
        const tok = cols.filter(c => /token/i.test(c));
        if (!cost && !tok.length) continue;
        const sel = [cost ? `SUM("${cost}") AS usd` : '0 AS usd', ...tok.map(c => `SUM("${c}") AS "${c}"`), 'COUNT(*) AS calls'].join(', ');
        rows.push({ file: `${dir}/journal/${f}`, table: t, ...db.prepare(`SELECT ${sel} FROM "${t}"`).get() });
      }
    } finally { db.close(); }
  }
}
for (const r of rows) console.log(JSON.stringify(r));
