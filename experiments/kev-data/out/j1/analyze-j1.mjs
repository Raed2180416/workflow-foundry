// J1 analysis (development): stock Kev rows (kev.benchmark rows.json and served rows) + the $0 baselines + the Haiku arm,
// per port on dev-select. Raw stock probabilities (T = 1; no calib-OOD refit yet, so RISK is not computed).
//   node analyze-j1.mjs <run dir> <out json>
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { manifest, loadSlice, metricsWithCI } from './lib-j1.mjs';

const RUN = process.argv[2] ?? '/var/tmp/foundry-work/kev/j1/run-dev-select', OUT = process.argv[3] ?? '/var/tmp/foundry-work/kev/j1/j1-dev-select-analysis.json';
const base = JSON.parse(readFileSync('/var/tmp/foundry-work/kev/j1/baselines-dev-select.json', 'utf8'));
const haikuRows = existsSync('/var/tmp/foundry-work/kev/j1/haiku/rows.jsonl') ? readFileSync('/var/tmp/foundry-work/kev/j1/haiku/rows.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error) : [];
const haiku = new Map(haikuRows.map(r => [`${r.recId}|${r.qid}`, r]));
const state = existsSync(path.join(RUN, 'state.json')) ? JSON.parse(readFileSync(path.join(RUN, 'state.json'), 'utf8')) : { stages: {} };
const readJsonl = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const m = manifest(), out = { schema: 'kev-j1/analysis@1', slice: 'dev-select', status: 'DEVELOPMENT (dev-select, in-family; raw stock probabilities, T=1)', groups: {} };
const portOf = pk => pk.split(':')[0].split('~')[0];
for (const [g, G] of Object.entries(m.groups)) {
  const id = `${g}-dev-select`;
  const benchRows = path.join(RUN, 'results', `J1-bench-${id}`, 'rows.json'), servedRows = path.join(RUN, 'results', 'rows', 'J1', `${id}.jsonl`);
  const companionRows = path.join(RUN, 'results', 'rows', 'J1', `${id}.companion.jsonl`);
  let rows = null, route = null;
  if (existsSync(benchRows)) { rows = JSON.parse(readFileSync(benchRows, 'utf8')).filter(r => (r.variant ?? 'clean') === 'clean'); route = 'kev.benchmark (fp32)'; }
  else if (existsSync(servedRows)) { rows = readJsonl(servedRows).filter(r => r.p); route = 'served (bf16)'; }
  const kev = new Map((rows ?? []).map(r => [`${r.id}|${r.question}`, r]));
  const dev = loadSlice(G.dir, 'dev-select');
  const G2 = (out.groups[g] = { buildId: G.buildId, route, jobs: {}, ports: {} });
  for (const [sid, st] of Object.entries(state.stages)) if (sid.includes(id) || (route?.startsWith('served') && sid === 'J1-serve')) G2.jobs[sid] = { status: st.status, jobId: st.jobId ?? null, verdict: st.verdict ?? null };
  // companion: served vs benchmark on the same 300-row sample
  if (existsSync(companionRows) && rows && route.startsWith('kev.benchmark')) {
    const comp = readJsonl(companionRows).filter(r => r.p); let flips = 0, maxd = 0, sumd = 0, n = 0;
    for (const c of comp) { const b = kev.get(`${c.id}|${c.question}`); if (!b) continue; n++; const am = a => a.indexOf(Math.max(...a)); if (am(c.p) !== am(b.p)) flips++; const d = Math.max(...c.p.map((x, i) => Math.abs(x - b.p[i]))); maxd = Math.max(maxd, d); sumd += d; }
    G2.companion = { n, argmaxFlips: flips, meanMaxAbsDp: n ? Math.round((sumd / n) * 10000) / 10000 : null, maxAbsDp: maxd, servedAcc: comp.length ? comp.filter(c => c.p.indexOf(Math.max(...c.p)) === c.label).length / comp.length : null };
  }
  const ports = [...new Set(dev.map(r => portOf(r.portKey) + ':' + r.family))];
  for (const key of [...new Set([...ports, ...dev.map(r => r.portKey)])].sort()) {
    const sel = key.includes('~') || dev.some(r => r.portKey === key) ? dev.filter(r => r.portKey === key) : [];
    const items = sel.length ? sel : dev.filter(r => `${portOf(r.portKey)}:${r.family}` === key);
    if (!items.length) continue;
    const pb = base.groups[g].ports[items[0].portKey] ?? {};
    const prior = pb.prior ?? null;
    const P = { n: items.length };
    const ki = items.map(r => { const k = kev.get(`${r.recId}|${r.qid}`); if (!k) return null; const p = Object.fromEntries(k.keys.map((o, i) => [o, k.p[i]])); const pred = k.keys[k.p.indexOf(Math.max(...k.p))]; return { ...r, p, pred }; }).filter(Boolean);
    P.kevN = ki.length;
    if (ki.length) P.stockKev = metricsWithCI(ki, { prior: key.includes('~') || !items.every(r => r.portKey === items[0].portKey) ? null : prior, B: 2000 });
    const hi = items.map(r => { const h = haiku.get(`${r.recId}|${r.qid}`); return h ? { ...r, p: h.probabilities, pred: h.chosen } : null; }).filter(Boolean);
    P.haikuN = hi.length;
    if (hi.length) { P.haiku = metricsWithCI(hi, { prior: items.every(r => r.portKey === items[0].portKey) ? prior : null, B: 2000 }); P.haikuCostUsd = Math.round(hi.reduce((a, r) => a + (haiku.get(`${r.recId}|${r.qid}`).costUsd ?? 0), 0) * 10000) / 10000; }
    G2.ports[key] = P;
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);
