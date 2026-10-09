import fs from 'node:fs';
const labels = fs.readFileSync('../L1-audit-labels.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
const cen = new Map(fs.readFileSync('census-nodes.out.jsonl', 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.id, o]; }));
for (const L of labels) {
  const c = cen.get(L.id);
  const det = new Set([...Object.keys(c.needs).filter(p => !p.startsWith('L0')), ...c.plumbing]);
  const mine = new Set(L.patterns);
  const fp = [...det].filter(p => !mine.has(p)), fn = [...mine].filter(p => !det.has(p));
  console.log(`#${L.drawOrder} ${c.plat} status=${c.status} expl=${L.explained} | mine=${[...mine].join(',')} | det=${[...det].join(',')} | FP(det-only)=${fp.join(',')} FN(mine-only)=${fn.join(',')}`);
}
