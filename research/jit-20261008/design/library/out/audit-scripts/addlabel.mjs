// addlabel.mjs: append hand labels (JSON per line on stdin) to ../L1-audit-labels.jsonl with a timestamp. Verifies id against the draw.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-audit-draw.json'), 'utf8'));
const f = path.join(OUT, 'L1-audit-labels.jsonl');
const have = fs.existsSync(f) ? new Set(fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).drawOrder)) : new Set();
for (const line of fs.readFileSync(0, 'utf8').split('\n').filter(l => l.trim())) {
  const r = JSON.parse(line); const d = draw.items.find(x => x.drawOrder === r.drawOrder);
  if (!d) throw new Error('bad drawOrder ' + r.drawOrder); if (have.has(r.drawOrder)) throw new Error('duplicate label ' + r.drawOrder);
  for (const k of ['patterns', 'l0', 'explained', 'refusal', 'gaps']) if (!(k in r)) throw new Error(`missing ${k} in ${r.drawOrder}`);
  const row = { drawOrder: d.drawOrder, id: d.id, cluster: d.cluster, stratum: d.stratum, seed: draw.seed, ...r, labelledAt: new Date().toISOString() };
  row.id = d.id; fs.appendFileSync(f, JSON.stringify(row) + '\n'); have.add(r.drawOrder);
}
console.log('labels so far:', have.size);
