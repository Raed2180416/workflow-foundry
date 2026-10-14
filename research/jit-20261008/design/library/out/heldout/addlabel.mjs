// addlabel.mjs: append one label row (JSON on stdin) to labels.jsonl with a labelledAt stamp; refuses a second row for the same id
// (a revision is a separate row written with --revise, which stamps revisedAt and requires revisionNote). $0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'labels.jsonl');
const revise = process.argv.includes('--revise');
const rows = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
let s = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const batch = s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const r of batch) {
    for (const k of ['platform', 'id', 'explained', 'l0', 'patterns', 'gaps', 'note']) if (r[k] === undefined) throw new Error(`row ${r.id}: missing ${k}`);
    if (!['yes', 'partly', 'no'].includes(r.explained)) throw new Error(`row ${r.id}: bad explained`);
    for (const g of r.gaps) for (const k of ['fragment', 'why', 'class', 'kind', 'lacks']) if (g[k] === undefined) throw new Error(`row ${r.id}: gap missing ${k}`);
    const dup = rows.find((x) => x.id === r.id);
    if (dup && !revise) throw new Error(`row ${r.id} exists; use --revise with revisionNote`);
    if (revise && !r.revisionNote) throw new Error(`row ${r.id}: revisionNote required`);
    const stamp = new Date().toISOString();
    const row = revise ? { ...r, revisedAt: stamp } : { ...r, labelledAt: stamp };
    fs.appendFileSync(FILE, JSON.stringify(row) + '\n'); rows.push(row);
  }
  console.log('appended', batch.length, 'total', rows.length);
});
