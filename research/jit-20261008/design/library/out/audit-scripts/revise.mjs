// revise.mjs <drawOrder> '<json patch>': patch one label row before the census is opened; keeps labelledAt, adds revisedAt and revisionNote.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const f = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../L1-audit-labels.jsonl');
const rows = fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const r = rows.find(x => x.drawOrder === Number(process.argv[2])); Object.assign(r, JSON.parse(process.argv[3]), { revisedAt: new Date().toISOString() });
fs.writeFileSync(f, rows.map(x => JSON.stringify(x)).join('\n') + '\n'); console.log('revised', r.drawOrder);
