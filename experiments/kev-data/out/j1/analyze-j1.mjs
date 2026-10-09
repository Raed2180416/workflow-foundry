// J1 analysis, development evidence only (JUDGE-PROGRAM.md §6), rewritten 2026-10-09 for the owner's redirect: hosted Jev (TypeSafe
// System One, `jev-latest`) replaces stock Kev, read once (K = 1) on the three surviving dev-select files, against the $0 baselines
// (baselines-j1.mjs) and the small Haiku arm (haiku-j1.mjs). Everything here is DIAGNOSTIC: dev-select is in-family development data,
// no OOD axis, no calib-OOD prior or threshold exists (lost with the container), and no comparative claim is made before a J2
// pre-registration. Gaps under 3 points (accuracy, balanced accuracy, macro-F1) are flagged as noise.
//   node analyze-j1.mjs [out.json] [tables.md]
// Inputs (KEV_J1_WORK, default /var/tmp/foundry-work/kev/j1): jev/J1/<group>-dev-select{.jsonl,.reread.jsonl,.report.json},
// jev/smoke/runbook-10.jsonl, jev/requests.jsonl, baselines/baselines-{dev-select.json,rows.jsonl}, haiku/rows.jsonl.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WORK, J1_GROUPS, sources, loadDev, metricsWithCI, pairedDiffCI, priorOf } from './lib-j1.mjs';

const OUT = process.argv[2] ?? path.join(WORK, 'analysis', 'j1-jev-dev-analysis.json');
const MD = process.argv[3] ?? path.join(WORK, 'analysis', 'j1-jev-dev-tables.md');
const JEV = process.env.KEV_J1_JEV ?? path.join(WORK, 'jev');
const B = Number(process.env.KEV_J1_BOOT ?? 4000);
const NOISE = 0.03, PP = ['acc', 'bacc', 'macroF1'];
mkdirSync(path.dirname(OUT), { recursive: true });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const r4 = x => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const key = (id, q) => `${id}|${q}`;
const countOf = xs => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const maxOf = p => Math.max(...Object.values(p));

// ---- served Jev rows -> items ---------------------------------------------------------------------------------------------------
// p renormalised to sum 1 (Jev returns 2-decimal probabilities; some rows sum to 0.99); argmax ties go to Jev's own `choice`.
function jevItem(r, dev) {
  const s = r.p.reduce((a, b) => a + b, 0);
  const p = Object.fromEntries(r.keys.map((o, i) => [o, r.p[i] / s]));
  const top = maxOf(p), tied = r.keys.filter(o => p[o] === top);
  const pred = tied.length > 1 && tied.includes(r.choice) ? r.choice : tied[0];
  if (r.keys[r.label] !== dev.label) throw new Error(`label mismatch for ${r.id}|${r.question}: served row ${r.keys[r.label]}, dev file ${dev.label}`);
  return { ...dev, p, pred, conf: top, jevConfidence: r.confidence, jevChoice: r.choice, rawSum: s, tie: tied.length > 1, model: r.model };
}
// ---- diagnostics --------------------------------------------------------------------------------------------------------------------
function ece(items, { bins, equalMass }) {
  const xs = items.map(i => ({ c: i.conf, ok: i.pred === i.label ? 1 : 0 })).sort((a, b) => a.c - b.c), n = xs.length, k = Math.min(bins, n);
  const groups = Array.from({ length: k }, () => []);
  xs.forEach((x, i) => groups[equalMass ? Math.min(k - 1, Math.floor((i * k) / n)) : Math.min(bins - 1, Math.floor(x.c * bins))]?.push(x));
  let e = 0, rel = 0, res = 0; const acc = xs.reduce((a, x) => a + x.ok, 0) / n, diagram = [];
  for (const g of groups) if (g.length) {
    const c = g.reduce((a, x) => a + x.c, 0) / g.length, a = g.reduce((s, x) => s + x.ok, 0) / g.length;
    e += (g.length / n) * Math.abs(a - c); rel += (g.length / n) * (c - a) ** 2; res += (g.length / n) * (a - acc) ** 2;
    diagram.push({ n: g.length, conf: r4(c), acc: r4(a) });
  }
  return { ece: r4(e), reliability: r4(rel), resolution: r4(res), uncertainty: r4(acc * (1 - acc)), diagram };
}
// coverage at risk eps, threshold chosen on the same rows (in-sample, therefore optimistic); rows with equal confidence move together
function coverageAt(items, eps = 0.05) {
  const xs = items.map(i => ({ c: i.conf, err: i.pred === i.label ? 0 : 1 })).sort((a, b) => b.c - a.c);
  let best = { coverage: 0, risk: null, tau: null, accepted: 0 }, acc = 0, err = 0;
  for (let i = 0; i < xs.length; i++) {
    acc++; err += xs[i].err;
    if (i + 1 < xs.length && xs[i + 1].c === xs[i].c) continue;
    if (err / acc <= eps && acc / xs.length > best.coverage) best = { coverage: r4(acc / xs.length), risk: r4(err / acc), tau: xs[i].c, accepted: acc };
  }
  return best;
}
const pearson = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : null; };
function diagnostics(items) {
  const n = items.length, acc = items.filter(i => i.pred === i.label).length / n, meanMaxP = items.reduce((a, i) => a + i.conf, 0) / n;
  const hard = items.filter(i => i.conf === 1);
  return {
    meanMaxP: r4(meanMaxP), overconfidence: r4(meanMaxP - acc),
    ece15EqualMass: ece(items, { bins: 15, equalMass: true }), ece10EqualWidth: ece(items, { bins: 10, equalMass: false }),
    eceGate: n >= 500 ? 'n >= 500: the §6.2 gate would apply on an OOD axis; this is dev, so still diagnostic' : `diagnostic only: n = ${n} < 500`,
    hardOneShare: r4(hard.length / n), hardOneErrors: hard.filter(i => i.pred !== i.label).length,
    coverageAt5InSample: { ...coverageAt(items, 0.05), note: 'threshold fitted on these same rows: optimistic, not the §6.1 RISK (which needs a calib-OOD threshold)' },
    jevConfidenceVsMaxP: { meanAbsDiff: r4(items.reduce((a, i) => a + Math.abs(i.jevConfidence - i.conf), 0) / n), pearson: r4(pearson(items.map(i => i.jevConfidence), items.map(i => i.conf))) },
    confusion: items.reduce((m, i) => { (m[i.label] ??= {})[i.pred] = (m[i.label][i.pred] ?? 0) + 1; return m; }, {}),
  };
}
const flag = d => { if (!d) return d; for (const k of PP) if (d[k]) d[k].noise = Math.abs(d[k].est) < NOISE; return d; };
const compact = m => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v && typeof v === 'object' && 'est' in v ? [v.est, v.lo, v.hi] : v])) : m);

// ---- load ----------------------------------------------------------------------------------------------------------------------------
const src = sources();
const base = JSON.parse(readFileSync(path.join(WORK, 'baselines', 'baselines-dev-select.json'), 'utf8'));
const baseRows = readJsonl(path.join(WORK, 'baselines', 'baselines-rows.jsonl'));
const haikuAll = readJsonl(path.join(WORK, 'haiku', 'rows.jsonl'));
const haikuOk = new Map(haikuAll.filter(r => !r.error).map(r => [key(r.recId, r.qid), r]));
const out = { schema: 'kev-j1/jev-analysis@1', generatedAt: new Date().toISOString(),
  status: 'DEVELOPMENT EVIDENCE, DIAGNOSTIC ONLY: dev-select (in-family), one read (K = 1), stock hosted Jev with raw probabilities (no calib-OOD fit exists); no comparative claim before a J2 pre-registration',
  bootstrap: { B, note: 'kinetics: two-way form x world (verified rebuilt sidecar); interactive, runbook: one-way over records (no trustworthy sidecar), so their intervals are form-unclustered and likely too narrow' },
  noiseRule: `differences with |estimate| < ${NOISE} on ${PP.join(', ')} are flagged noise`, groups: {} };
const allJev = [], md = [];
const ci = v => (v ? `${v.est.toFixed(3)} [${v.lo.toFixed(3)}, ${v.hi.toFixed(3)}]` : '–');
const dci = v => (v ? `${v.est >= 0 ? '+' : ''}${v.est.toFixed(3)} [${v.lo.toFixed(3)}, ${v.hi.toFixed(3)}]${v.noise ? ' (noise)' : ''}` : '–');

for (const g of J1_GROUPS) {
  const s = src[g], dev = loadDev(s), devBy = new Map(dev.map(r => [key(r.recId, r.qid), r]));
  const rows = readJsonl(path.join(JEV, 'J1', `${g}-dev-select.jsonl`)), report = JSON.parse(readFileSync(path.join(JEV, 'J1', `${g}-dev-select.report.json`), 'utf8'));
  const reread = readJsonl(path.join(JEV, 'J1', `${g}-dev-select.reread.jsonl`));
  const items = rows.map(r => { const d = devBy.get(key(r.id, r.question)); if (!d) throw new Error(`served row ${r.id}|${r.question} not in ${g} dev-select`); return jevItem(r, d); });
  if (items.length !== dev.length) throw new Error(`${g}: ${items.length} served rows for ${dev.length} dev questions`);
  allJev.push(...items.map(i => ({ ...i, group: g })));
  const G = (out.groups[g] = { devSha256: s.devSha256, verified: s.verified, clusters: s.clusters, n: items.length, records: new Set(items.map(i => i.recId)).size,
    versions: countOf(items.map(i => i.model)), rawSumOff: items.filter(i => Math.abs(i.rawSum - 1) > 1e-9).map(i => r4(i.rawSum)), ties: items.filter(i => i.tie).length,
    choiceNotArgmax: rows.filter(r => r.keys[r.p.indexOf(Math.max(...r.p))] !== r.choice).length, report: { valid: report.valid, coverage: report.coverage, faults: report.faults?.n ?? null, usage: report.usage }, ports: {} });
  // re-read: every re-read row against its first read
  const first = new Map(rows.map(r => [key(r.id, r.question), r]));
  const dps = reread.map(r => { const a = first.get(key(r.id, r.question)); const d = Math.max(...r.p.map((x, i) => Math.abs(x - a.p[i]))); return { d, flip: r.keys[r.p.indexOf(Math.max(...r.p))] !== a.keys[a.p.indexOf(Math.max(...a.p))] }; });
  G.reread = { n: dps.length, argmaxFlips: dps.filter(x => x.flip).length, maxAbsDp: r4(Math.max(...dps.map(x => x.d))), meanMaxAbsDp: r4(dps.reduce((a, x) => a + x.d, 0) / dps.length),
    identical: dps.filter(x => x.d === 0).length, under001: dps.filter(x => x.d < 0.01).length, atLeast001: dps.filter(x => x.d >= 0.01).length,
    usage: reread.reduce((a, r) => ({ input_tokens: a.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: a.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 }),
    reportAgree: report.reread?.agree, reportStable: report.reread?.stable, rule: 'run validity needs every re-read |dp| < 0.01 (unchanged); Jev answers in 2-decimal steps' };
  G.diagnostics = diagnostics(items);
  // label position (the label's index in the option list), group level (§6.6)
  G.labelPosition = Object.fromEntries([...new Set(items.map(i => i.options.indexOf(i.label)))].sort().map(pos => { const xs = items.filter(i => i.options.indexOf(i.label) === pos); return [pos, { n: xs.length, acc: r4(xs.filter(i => i.pred === i.label).length / xs.length) }]; }));
  // the 20 most confident errors, kept raw (§6.6; negative results)
  G.mostConfidentErrors = items.filter(i => i.pred !== i.label).sort((a, b) => b.conf - a.conf || (a.recId < b.recId ? -1 : 1)).slice(0, 20)
    .map(i => ({ recId: i.recId, qid: i.qid, portKey: i.portKey, label: i.label, pred: i.pred, maxP: r4(i.conf), jevConfidence: i.jevConfidence, p: Object.fromEntries(Object.entries(i.p).map(([k, v]) => [k, r4(v)])) }));
  const ports = [...new Set(items.map(i => i.portKey))].sort();
  md.push(`\n### ${g} (${s.verified ? 'verified sidecar: form x world clusters, port = question:family' : 'fallback: port = question id, record clusters, CIs likely too narrow'})\n`,
    '| port | n | Jev acc | Jev bacc | Jev macro-F1 | Jev Brier | BSS vs uniform | chance bacc | best non-leaky baseline (bacc) | dev-majority acc (LEAKY) | Haiku correct |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const cmpMd = [];
  for (const pk of ports) {
    const it = items.filter(i => i.portKey === pk), pb = base.groups[g].ports[pk];
    const P = { n: it.length, labels: priorOf(it.map(i => i.label)) };
    P.jev = metricsWithCI(it, { B });
    P.bssReferences = { uniform: P.jev.bssUniform?.est ?? null,
      calibInPrior: pb.calibInPrior?.brier ? r4(1 - P.jev.brier.est / pb.calibInPrior.brier.est) : null,
      devPriorLEAKY: pb.devPrior?.brier ? r4(1 - P.jev.brier.est / pb.devPrior.brier.est) : null,
      calibOodPrior: 'unavailable (calib-ood lost with the held-out material)' };
    P.diagnostics = diagnostics(it);
    P.compare = {};
    for (const arm of ['trainMajority', 'trainPrior', 'calibInPrior', 'probe', 'devMajority', 'devPrior']) {
      const ar = baseRows.filter(r => r.group === g && r.arm === arm && r.portKey === pk);
      if (!ar.length) continue;
      const armItems = ar.map(r => ({ ...devBy.get(key(r.recId, r.qid)), p: r.p, pred: r.pred }));
      P.compare[arm] = { leaky: arm.startsWith('dev'), ...flag(pairedDiffCI(it, armItems, { B })) };
    }
    const hk = it.filter(i => haikuOk.has(key(i.recId, i.qid)));
    P.haiku = { n: hk.length, faults: haikuAll.filter(r => r.error && r.portKey === pk && r.group === g).length,
      items: hk.map(i => { const h = haikuOk.get(key(i.recId, i.qid)); return { recId: i.recId, qid: i.qid, label: i.label, haiku: h.chosen, haikuConfidence: h.confidence, jev: i.pred, jevMaxP: r4(i.conf) }; }),
      note: 'two items per port by design: anecdote, no per-port metric' };
    G.ports[pk] = P;
    const nonLeaky = ['probe', 'trainPrior', 'trainMajority', 'calibInPrior'].filter(a => pb[a]?.bacc).sort((a, b) => pb[b].bacc.est - pb[a].bacc.est)[0];
    md.push(`| ${pk} | ${it.length} | ${ci(P.jev.acc)} | ${ci(P.jev.bacc)} | ${P.jev.macroF1.est.toFixed(3)} | ${ci(P.jev.brier)} | ${P.jev.bssUniform.est.toFixed(3)} | ${pb.uniform.chanceBacc.toFixed(3)} | ${nonLeaky ? `${nonLeaky} ${ci(pb[nonLeaky].bacc)}` : 'none (no trustworthy train)'} | ${pb.devMajority.acc.est.toFixed(3)} | ${P.haiku.items.filter(h => h.haiku === h.label).length}/${P.haiku.n} (Jev ${P.haiku.items.filter(h => h.jev === h.label).length}/${P.haiku.n}) |`);
    for (const [arm, c] of Object.entries(P.compare)) cmpMd.push(`| ${pk} | ${arm}${c.leaky ? ' (LEAKY)' : ''} | ${dci(c.acc)} | ${dci(c.bacc)} | ${c.brier ? dci(c.brier) : '–'} |`);
  }
  md.push('', `Jev minus baseline, paired over the same rows (${g}); "(noise)" = |difference| under 3 points. Brier: negative favours Jev.`, '', '| port | arm | Δacc | Δbacc | ΔBrier |', '|---|---|---|---|---|', ...cmpMd);
  G.summary = { macroBacc: r4(ports.reduce((a, pk) => a + G.ports[pk].jev.bacc.est, 0) / ports.length), pooledAcc: r4(items.filter(i => i.pred === i.label).length / items.length),
    macroChanceBacc: r4(ports.reduce((a, pk) => a + base.groups[g].ports[pk].uniform.chanceBacc, 0) / ports.length),
    macroDevMajorityAccLEAKY: r4(ports.reduce((a, pk) => a + base.groups[g].ports[pk].devMajority.acc.est, 0) / ports.length) };
  console.log(g, JSON.stringify(G.summary), 'reread', JSON.stringify({ flips: G.reread.argmaxFlips, max: G.reread.maxAbsDp }));
}

// ---- Jev vs Haiku, pooled over every Haiku item (record bootstrap; acc and Brier only: pooled bacc across ports means nothing) ------
const pooledJ = allJev.filter(i => haikuOk.has(key(i.recId, i.qid))).map(i => ({ ...i, cluster: 'record' }));
const pooledH = pooledJ.map(i => { const h = haikuOk.get(key(i.recId, i.qid)); const raw = Array.isArray(h.probabilities) ? Object.fromEntries(i.options.map((o, k) => [o, h.probabilities[k]])) : (h.probabilities ?? null);
  const p = raw ? (() => { const z = i.options.reduce((a, o) => a + (raw[o] ?? 0), 0); return z ? Object.fromEntries(i.options.map(o => [o, (raw[o] ?? 0) / z])) : null; })() : null; return { ...i, p, pred: h.chosen }; });
const hasP = pooledH.every(i => i.p);
const strip = xs => xs.map(({ p, ...rest }) => rest);
out.haiku = { model: [...new Set(haikuAll.map(r => r.model).filter(Boolean))], rows: haikuAll.length, ok: haikuOk.size, faults: haikuAll.filter(r => r.error).length,
  faultCodes: countOf(haikuAll.filter(r => r.error).map(r => r.error.code ?? 'null')), costUsdListPrice: r4(haikuAll.reduce((a, r) => a + (r.costUsd ?? 0), 0)),
  pooled: pooledJ.length ? { n: pooledJ.length, jev: compact(metricsWithCI(hasP ? pooledJ : strip(pooledJ), { B })), haiku: compact(metricsWithCI(hasP ? pooledH : strip(pooledH), { B })),
    jevMinusHaiku: flag(pairedDiffCI(hasP ? pooledJ : strip(pooledJ), hasP ? pooledH : strip(pooledH), { B })), note: 'pooled across ports and groups, one-way record bootstrap; acc and Brier are the readable rows (bacc / macro-F1 mix label sets across ports)' } : null };

// ---- the smoke's 10 runbook records against their J1 reads (two independent reads of the same records) ----------------------------
const smoke = readJsonl(path.join(JEV, 'smoke', 'runbook-10.jsonl')), j1rb = new Map(readJsonl(path.join(JEV, 'J1', 'runbook-dev-select.jsonl')).map(r => [key(r.id, r.question), r]));
const sm = smoke.map(r => { const a = j1rb.get(key(r.id, r.question)); if (!a) return null; return { d: Math.max(...r.p.map((x, i) => Math.abs(x - a.p[i]))), flip: r.keys[r.p.indexOf(Math.max(...r.p))] !== a.keys[a.p.indexOf(Math.max(...a.p))], v: [r.model, a.model] }; }).filter(Boolean);
out.smokeVsJ1 = { n: sm.length, argmaxFlips: sm.filter(x => x.flip).length, maxAbsDp: r4(Math.max(...sm.map(x => x.d))), meanMaxAbsDp: r4(sm.reduce((a, x) => a + x.d, 0) / sm.length), identical: sm.filter(x => x.d === 0).length, versions: [...new Set(sm.flatMap(x => x.v))] };

// ---- usage, requests, versions ---------------------------------------------------------------------------------------------------
const ledger = readJsonl(path.join(JEV, 'requests.jsonl'));
const sumU = rs => rs.reduce((a, r) => ({ input_tokens: a.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: a.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 });
const firstRowPerRecord = rs => { const seen = new Set(); return rs.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))); };
const u = { smoke: sumU(firstRowPerRecord(smoke)) };
for (const g of J1_GROUPS) { u[`J1 ${g}`] = sumU(firstRowPerRecord(readJsonl(path.join(JEV, 'J1', `${g}-dev-select.jsonl`)))); u[`re-read ${g}`] = sumU(firstRowPerRecord(readJsonl(path.join(JEV, 'J1', `${g}-dev-select.reread.jsonl`)))); }
const total = Object.values(u).reduce((a, x) => ({ input_tokens: a.input_tokens + x.input_tokens, output_tokens: a.output_tokens + x.output_tokens }), { input_tokens: 0, output_tokens: 0 });
out.jev = { requested: 'jev-latest', versions: countOf(allJev.map(i => i.model)), requestsLedger: ledger.length, requestsByTag: countOf(ledger.map(l => String(l.tag ?? 'none'))), usage: { ...u, total },
  costEstimateUsd: { inputOnly: r4((total.input_tokens / 1e6) * 0.042), note: 'at the policy price inputPerMTok 0.042 (second-hand, unverified; output price unknown, so not included). The owner\'s TypeSafe account shows the billed figure' } };
out.validity = Object.fromEntries(J1_GROUPS.map(g => [g, { valid: out.groups[g].report.valid, why: out.groups[g].reread.atLeast001 ? `re-read |dp| reached ${out.groups[g].reread.maxAbsDp} (rule: every |dp| < 0.01); coverage complete, nothing rejected, one version` : 'see report' }]));
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
const head = [`# J1 Jev dev-select tables (generated ${out.generatedAt})`, '', out.status, '', `Bootstrap B = ${B}. ${out.bootstrap.note}. ${out.noiseRule}.`];
const hk = out.haiku.pooled;
const tail = ['', '### Jev vs Haiku, pooled', '', hk ? `n = ${hk.n} items (2 per port), ${out.haiku.faults} faults. Jev acc ${hk.jev.acc.join(' / ')}; Haiku acc ${hk.haiku.acc.join(' / ')} (est / lo / hi). Jev − Haiku Δacc ${dci(hk.jevMinusHaiku.acc)}${hk.jevMinusHaiku.brier ? `, ΔBrier ${dci(hk.jevMinusHaiku.brier)}` : ''}.` : 'no Haiku rows',
  '', '### Re-read stability (20 records per group, same version)', '', '| group | n | argmax flips | max |Δp| | mean max |Δp| | identical | ≥ 0.01 | run valid |', '|---|---|---|---|---|---|---|---|',
  ...J1_GROUPS.map(g => { const r = out.groups[g].reread; return `| ${g} | ${r.n} | ${r.argmaxFlips} | ${r.maxAbsDp} | ${r.meanMaxAbsDp} | ${r.identical} | ${r.atLeast001} | ${out.groups[g].report.valid} |`; }),
  `| smoke vs J1 (runbook) | ${out.smokeVsJ1.n} | ${out.smokeVsJ1.argmaxFlips} | ${out.smokeVsJ1.maxAbsDp} | ${out.smokeVsJ1.meanMaxAbsDp} | ${out.smokeVsJ1.identical} | – | – |`];
writeFileSync(MD, [...head, ...md, ...tail].join('\n') + '\n');
console.log('wrote', OUT, MD, 'versions', JSON.stringify(out.jev.versions), 'usage', JSON.stringify(total), 'ledger', ledger.length);
