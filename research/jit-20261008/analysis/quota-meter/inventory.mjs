#!/usr/bin/env node
// Field inventory: every key path seen in the saved raw streams, per event type, with the number of files it appears in, plus a
// meter-like filter (key names matching rate/limit/quota/utiliz/reset/window/overage/remaining/budget/usage/cost). Writes inventory.json
// and prints the meter-like paths. Also scans every raw file for credential-looking keys or values.
//   node inventory.mjs [raw-dir ...]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { HERE, secretScan } from './lib.mjs';

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['raw', 'raw/ladder', 'raw/ladder2', 'raw/ladder3', 'raw/poll'];
const METERISH = /(rate|limit|quota|utiliz|reset|window|overage|remaining|budget|usage|cost|status|claim|threshold)/i;
const paths = new Map(); // "type/subtype :: path" -> { files:Set, example }
let files = 0, hits = [];
const walk = (v, p, key, file) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, key, file); return; }
  if (Array.isArray(v)) { if (!v.length) note(`${p}[]`, key, file, v); else v.forEach(x => walk(x, `${p}[]`, key, file)); return; }
  note(p, key, file, v);
};
const note = (p, key, file, v) => { const id = `${key} :: ${p}`; const e = paths.get(id) ?? { files: new Set(), example: v }; e.files.add(file); paths.set(id, e); };
for (const d of dirs) {
  const dir = path.resolve(HERE, d);
  let names; try { names = readdirSync(dir).filter(n => n.endsWith('.jsonl') && n !== 'ledger.jsonl' && n !== 'ladder.jsonl'); } catch { continue; }
  for (const n of names) {
    const f = path.join(dir, n); if (!statSync(f).isFile()) continue; files++;
    for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      hits.push(...secretScan(o, n));
      walk(o, '', `${o.type ?? 'result?'}${o.subtype ? '/' + o.subtype : ''}`, n);
    }
  }
}
const rows = [...paths].map(([id, e]) => ({ id, files: e.files.size, example: typeof e.example === 'string' ? e.example.slice(0, 60) : e.example })).sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(path.join(HERE, 'inventory.json'), JSON.stringify({ filesScanned: files, secretHits: hits, fields: rows }, null, 1));
console.log(`files ${files}, distinct (event :: path) ${rows.length}, credential-looking hits ${hits.length}`);
for (const r of rows) if (METERISH.test(r.id.split('::')[1]) && !/^system/.test(r.id)) console.log(`${String(r.files).padStart(3)}  ${r.id}  = ${JSON.stringify(r.example)}`);
