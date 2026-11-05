#!/usr/bin/env node
// v1 replay equivalence (deviation D2): two BUILDER-1 judge files must give every (build, condition) the same status, reason, decided and
// violated counts, with and without G3. Evidence ids may differ (the outbox is read in file order, which is not send order).
//   node experiments/tracker-v2/same-statuses.mjs <judge-a.json> <judge-b.json>
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
let n = 0, diff = 0;
for (const [id, x] of Object.entries(a.builds)) for (const k of ['t2', 't2NoG3']) for (const [c, s] of Object.entries(x[k])) {
  const t = b.builds[id]?.[k]?.[c];
  n++;
  if (!t || t.status !== s.status || t.reason !== s.reason || t.decided !== s.decided || t.violated !== s.violated) { diff++; console.log(`DIFF ${id} ${k} ${c}: ${s.status}/${s.reason} ${s.decided}/${s.violated} vs ${t?.status}/${t?.reason} ${t?.decided}/${t?.violated}`); }
}
const builds = [Object.keys(a.builds).length, Object.keys(b.builds).length];
console.log(`${n} (build, condition, G3 view) statuses compared over ${builds[0]} / ${builds[1]} builds: ${diff} differ`);
process.exitCode = diff || builds[0] !== builds[1] ? 1 : 0;
