import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL(`./out/rows-${process.argv[2]}.json`, import.meta.url)));
const by = {};
for (const r of d.rows) { if (r.row !== 'candidate') continue; (by[r.id] ??= []).push(r); }
const n = d.seeds.length;
console.log('oracle-expected-vs-original:', d.rows.filter(r => r.row === 'oracle-expected-vs-original').map(r => `${r.fitness.toFixed(3)}/${r.precision.toFixed(3)}`).join(' '));
for (const [id, rs] of Object.entries(by)) {
  if (rs[0].error) { console.log(id, 'ERROR', rs[0].error); continue; }
  const m = f => (rs.reduce((a, r) => a + f(r), 0) / rs.length);
  const acc = t => rs.filter(r => r[t].accept).length;
  const op = rs.filter(r => r.oracle?.pass).length, os = rs[0].oracle ? m(r => r.oracle?.score ?? 0).toFixed(2) : '-';
  console.log(id.padEnd(46), `G acc ${acc('G')}/${rs.length} F=${m(r => r.G.fitness).toFixed(3)} P=${m(r => r.G.precision).toFixed(3)} | I acc ${acc('I')}/${rs.length} F=${m(r => r.I.fitness).toFixed(3)} P=${m(r => r.I.precision).toFixed(3)} | oracle pass ${rs[0].oracle ? op : '-'}/${rs.length} score ${os}`);
}
