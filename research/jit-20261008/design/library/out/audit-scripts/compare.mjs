// compare.mjs: L1-a analysis. Inputs (all under out/): L1-audit-draw.json, L1-audit-labels.jsonl (blind labels), audit-scripts/adj/*.txt (adjudication
// lines drawOrder|pattern|verdict|reason), audit-scripts/adj-hits/hits.txt (hit verdicts pattern|k|verdict|reason), L1-detector-hits-draw.json,
// audit-scripts/census-nodes.out.jsonl (per-node census dump). Outputs: L1-audit.json, L1-audit-adjudication.jsonl, L1-detector-hits-verdicts.jsonl.
// Verdict codes. Pairs the detector assigned: y yes, p partly, n no. Patterns the blind label has but the detector lacks: m (detector gave a
// different owner or an unrecognised shape for that part) and M (detector has no rule or no node for it at all).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.resolve(HERE, '..'); const ROOT = path.resolve(HERE, '../../../../../..');
const readJsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-audit-draw.json'), 'utf8'));
const labels = readJsonl(path.join(OUT, 'L1-audit-labels.jsonl'));
const cen = new Map(readJsonl(path.join(HERE, 'census-nodes.out.jsonl')).map(o => [o.id, o]));
const pub = new Map(readJsonl(path.join(OUT, 'pattern-census-items.jsonl')).map(o => [o.id, o]));
const corpus = new Map(readJsonl(path.join(ROOT, 'research/corpus-20261006/items.jsonl')).map(o => [o.id, o]));
const hitsDraw = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-detector-hits-draw.json'), 'utf8'));
const SUPPORT_ONLY_L1 = ['P01', 'P02', 'P16', 'P17', 'P18', 'P30', 'P49', 'P50', 'P51'];   // L1-PATTERNS 1.3
const SEED_BOOT = 20261011;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r3 = x => Math.round(x * 1000) / 1000;
function wilson(s, n, z = 1.96) { if (!n) return [null, null]; const p = s / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)]; }
const W = (s, n) => { const [a, b] = wilson(s, n); return a === null ? null : [r3(a), r3(b)]; };
const SCORE = { y: 1, p: 0.5, n: 0 };

// ---------------------------------------------------------------- load adjudication
const adj = [];
for (const f of fs.readdirSync(path.join(HERE, 'adj')).sort()) for (const line of fs.readFileSync(path.join(HERE, 'adj', f), 'utf8').split('\n')) {
  if (!line.trim()) continue; const [d, p, v, ...rest] = line.split('|'); adj.push({ drawOrder: Number(d), pattern: p, verdict: v, reason: rest.join('|').trim() });
}
const byOrder = new Map(labels.map(l => [l.drawOrder, l]));
const weightOf = new Map(draw.items.map(it => [it.drawOrder, it.stratumSize / it.stratumSample]));
const stratumKey = new Map(draw.items.map(it => [it.drawOrder, it.cluster + '|' + it.stratum]));
const problems = [];
// consistency: draw vs labels
for (const it of draw.items) { const l = byOrder.get(it.drawOrder); if (!l || l.id !== it.id) problems.push(`label/draw mismatch at ${it.drawOrder}`); }
if (labels.length !== 60) problems.push(`labels=${labels.length}`);
// detector set per item and source of each pair
const detSet = o => new Set([...Object.keys(o.needs).filter(p => !p.startsWith('L0')), ...o.plumbing]);
const sourceOf = (o, p) => { const s = []; if (o.nodeAssign.some(x => x.p === p)) s.push('node-rule'); if (o.tokens.some(t => t.p === p)) s.push('token'); if (o.plumbing.includes(p) && !s.length) s.push('plumbing'); else if (o.plumbing.includes(p)) s.push('plumbing'); return s; };
const pairs = [];   // detector-assigned pairs
const misses = [];  // blind-only patterns
const refusedSkipped = [];  // census-refused items: the census assigns no patterns to them by design, so they are outside pattern recall
const adjIdx = new Map(); for (const a of adj) { const k = a.drawOrder + '|' + a.pattern; if (adjIdx.has(k)) problems.push('duplicate adj ' + k); adjIdx.set(k, a); }
for (const l of labels) {
  const o = cen.get(l.id); const D = detSet(o), M = new Set(l.patterns);
  for (const p of D) { const a = adjIdx.get(l.drawOrder + '|' + p); if (!a) { problems.push(`no adjudication for detector pair #${l.drawOrder} ${p}`); continue; } if (!'ypn'.includes(a.verdict)) problems.push(`bad verdict for detector pair #${l.drawOrder} ${p}: ${a.verdict}`);
    pairs.push({ drawOrder: l.drawOrder, id: l.id, cluster: l.cluster, stratum: l.stratum, pattern: p, verdict: a.verdict, inBlind: M.has(p), sources: sourceOf(o, p), supportOnly: sourceOf(o, p).every(s => s === 'plumbing'), reason: a.reason }); }
  const refusedItem = pub.get(l.id).status === 'refused'; if (refusedItem) { refusedSkipped.push({ drawOrder: l.drawOrder, id: l.id, blindPatterns: [...M] }); continue; }
  for (const p of M) if (!D.has(p)) { const a = adjIdx.get(l.drawOrder + '|' + p); if (!a) { problems.push(`no adjudication for blind-only #${l.drawOrder} ${p}`); continue; } if (!'mM'.includes(a.verdict)) problems.push(`bad verdict for blind-only #${l.drawOrder} ${p}: ${a.verdict}`);
    misses.push({ drawOrder: l.drawOrder, id: l.id, cluster: l.cluster, stratum: l.stratum, pattern: p, verdict: a.verdict, reason: a.reason }); }
}
for (const a of adj) { if (a.pattern === 'none') continue; const l = byOrder.get(a.drawOrder); if (!l) { problems.push('adj for unknown item ' + a.drawOrder); continue; } const D = detSet(cen.get(l.id)), M = new Set(l.patterns); if (!D.has(a.pattern) && !M.has(a.pattern)) problems.push(`adj line for pattern in neither set: #${a.drawOrder} ${a.pattern}`); }
// items with no refused-in-sample consistency
const refusedInPub = id => pub.get(id).status === 'refused';

// ---------------------------------------------------------------- per-pattern tables
const allPat = [...new Set([...pairs.map(p => p.pattern), ...misses.map(m => m.pattern)])].sort();
const perPattern = allPat.map(p => {
  const ps = pairs.filter(x => x.pattern === p), ms = misses.filter(x => x.pattern === p);
  const y = ps.filter(x => x.verdict === 'y').length, pp = ps.filter(x => x.verdict === 'p').length, n = ps.filter(x => x.verdict === 'n').length;
  const blindAgree = ps.filter(x => x.inBlind).length;   // detector and blind label both have it
  const blindOnly = ms.length;
  const blindM = blindAgree + blindOnly;                 // pairs in blind labels
  const truthPos = y + pp / 2 + blindOnly;               // adjudicated true instances (partly = 1/2) among all pairs seen
  const detPos = y + pp / 2;
  return { pattern: p, detectorPairs: ps.length, yes: y, partly: pp, no: n, precisionAdjudicated: ps.length ? r3(detPos / ps.length) : null, precisionBlind: ps.length ? r3(blindAgree / ps.length) : null,
    blindLabelPairs: blindM, detectorMissedOfBlind: blindOnly, missedSubstituted: ms.filter(x => x.verdict === 'm').length, missedNoRule: ms.filter(x => x.verdict === 'M').length,
    recallBlind: blindM ? r3(blindAgree / blindM) : null, recallAdjudicated: truthPos ? r3(detPos / truthPos) : null };
});
const agg = (set) => { const y = set.filter(x => x.verdict === 'y').length, p = set.filter(x => x.verdict === 'p').length, n = set.filter(x => x.verdict === 'n').length, N = set.length; const s = y + p / 2;
  // item-clustered bootstrap for the lower bound
  const byItem = new Map(); for (const x of set) (byItem.get(x.drawOrder) ?? byItem.set(x.drawOrder, []).get(x.drawOrder)).push(x);
  const items = [...byItem.values()]; const rnd = mulberry32(SEED_BOOT); const reps = [];
  for (let b = 0; b < 5000; b++) { let ss = 0, nn = 0; for (let i = 0; i < items.length; i++) { const it = items[Math.floor(rnd() * items.length)]; for (const x of it) { ss += SCORE[x.verdict]; nn++; } } reps.push(ss / nn); }
  reps.sort((a, b) => a - b);
  // weighted (post-stratification weights of the owning item)
  let ws = 0, wn = 0; for (const x of set) { const w = weightOf.get(x.drawOrder); ws += w * SCORE[x.verdict]; wn += w; }
  return { pairs: N, yes: y, partly: p, no: n, items: items.length, precision: r3(s / N), wilson95: W(s, N), clusterBootstrap95: [r3(reps[Math.floor(0.025 * reps.length)]), r3(reps[Math.floor(0.975 * reps.length)])], weightedPrecision: r3(ws / wn) }; };
const rulePairs = pairs.filter(p => !p.supportOnly), supPairs = pairs.filter(p => p.supportOnly);
const precision = { all: agg(pairs), nodeRuleAndToken: agg(rulePairs), supportOnlyPlumbing: agg(supPairs) };
const l1aPass = (a) => a.precision >= 0.85 && a.wilson95[0] >= 0.75;
const decisionL1a = { rule: 'rule precision (yes + partly/2) >= 0.85 with Wilson lower bound >= 0.75; detector with precision < 0.5 removed; falsifier precision < 0.75',
  allPairs: { ...precision.all, pass: l1aPass(precision.all) }, nodeRuleAndToken: { ...precision.nodeRuleAndToken, pass: l1aPass(precision.nodeRuleAndToken) }, supportOnly: { ...precision.supportOnlyPlumbing, pass: l1aPass(precision.supportOnlyPlumbing) } };
// recall of the detector vs blind labels and adjudicated truth
const recall = (() => { const inBoth = pairs.filter(x => x.inBlind).length, blindTot = inBoth + misses.length; const truth = pairs.reduce((s, x) => s + (SCORE[x.verdict]), 0) + misses.length; const det = pairs.reduce((s, x) => s + SCORE[x.verdict], 0);
  return { blindPairs: blindTot, detectedOfBlind: inBoth, recallVsBlind: r3(inBoth / blindTot), recallVsBlindWilson95: W(inBoth, blindTot), adjudicatedTruth: truth, recallAdjudicated: r3(det / truth), missedSubstituted: misses.filter(m => m.verdict === 'm').length, missedNoRule: misses.filter(m => m.verdict === 'M').length }; })();
// set agreement per item
const jacc = labels.map(l => { const D = detSet(cen.get(l.id)), M = new Set(l.patterns); const i = [...D].filter(p => M.has(p)).length, u = new Set([...D, ...M]).size; return u ? i / u : 1; });
const exactSet = labels.filter(l => { const D = detSet(cen.get(l.id)), M = new Set(l.patterns); return D.size === M.size && [...D].every(p => M.has(p)); }).length;

// ---------------------------------------------------------------- L0 agreement (if / guard / judge / input)
const l0agree = {};
for (const c of ['if', 'guard', 'judge', 'input']) { let a = 0, b = 0, cc = 0, d = 0; for (const l of labels) { const mine = l.l0.includes(c), det = cen.get(l.id).needs['L0:' + c] !== undefined; if (mine && det) a++; else if (mine && !det) b++; else if (!mine && det) cc++; else d++; }
  const n = a + b + cc + d, po = (a + d) / n, pe = ((a + b) * (a + cc) + (cc + d) * (b + d)) / (n * n); l0agree[c] = { bothYes: a, blindOnly: b, detectorOnly: cc, bothNo: d, agreement: r3(po), kappa: pe === 1 ? null : r3((po - pe) / (1 - pe)) }; }

// ---------------------------------------------------------------- item-level "explained"
const exTab = { bothExplained: 0, bothUnexplained: 0, censusExplainedBlindNot: 0, censusRefusedBlindExplained: 0 };
const exRows = labels.map(l => { const censusExpl = !refusedInPub(l.id); const strict = l.explained === 'yes', lenient = l.explained !== 'no'; return { drawOrder: l.drawOrder, id: l.id, cluster: l.cluster, stratum: l.stratum, censusExplained: censusExpl, blind: l.explained, strict, lenient, refusal: l.refusal, refusalConfidence: l.refusalConfidence ?? null }; });
for (const r of exRows) { if (r.censusExplained && r.strict) exTab.bothExplained++; else if (!r.censusExplained && !r.lenient) exTab.bothUnexplained++; else if (r.censusExplained && !r.strict) exTab.censusExplainedBlindNot++; else exTab.censusRefusedBlindExplained++; }
const itemAgreementStrict = exRows.filter(r => r.censusExplained === r.strict).length, itemAgreementLenient = exRows.filter(r => r.censusExplained === r.lenient).length;

// ---------------------------------------------------------------- corrected coverage
const N = [...new Set(draw.items.map(i => i.cluster + '|' + i.stratum))].reduce((s, k) => s + draw.frameSizes[k], 0);
function estimate(vals, sel = null, label = '') {   // vals: drawOrder -> 0/1 ; sel: subset of drawOrders ; weights from the draw (unless overridden)
  const ids = sel ?? draw.items.map(i => i.drawOrder); const w = ids.map(d => weightOf.get(d)); const sw = w.reduce((a, b) => a + b, 0); const p = ids.reduce((s, d, i) => s + w[i] * vals.get(d), 0) / sw;
  const neff = sw * sw / w.reduce((a, b) => a + b * b, 0); const [lo, hi] = wilson(p * neff, neff);
  // stratified bootstrap
  const strata = new Map(); for (const d of ids) (strata.get(stratumKey.get(d)) ?? strata.set(stratumKey.get(d), []).get(stratumKey.get(d))).push(d);
  const rnd = mulberry32(SEED_BOOT); const reps = []; for (let b = 0; b < 5000; b++) { let s = 0, t = 0; for (const [, ds] of strata) { const Nh = weightOf.get(ds[0]) * ds.length; let m = 0; for (let i = 0; i < ds.length; i++) m += vals.get(ds[Math.floor(rnd() * ds.length)]); s += Nh * m / ds.length; t += Nh; } reps.push(s / t); }
  reps.sort((a, b) => a - b);
  const pu = ids.reduce((s, d) => s + vals.get(d), 0) / ids.length; const [ulo, uhi] = wilson(pu * ids.length, ids.length);
  return { label, n: ids.length, postStratified: r3(p), kishNeff: Math.round(neff * 10) / 10, wilson95KishNeff: [r3(lo), r3(hi)], stratifiedBootstrap95: [r3(reps[Math.floor(0.025 * reps.length)]), r3(reps[Math.floor(0.975 * reps.length)])], unweighted: r3(pu), unweightedWilson95: [r3(ulo), r3(uhi)] };
}
const vStrict = new Map(exRows.map(r => [r.drawOrder, r.strict ? 1 : 0])), vLenient = new Map(exRows.map(r => [r.drawOrder, r.lenient ? 1 : 0]));
const dashboardOrders = labels.filter(l => l.refusal === 'interactive-dashboard-state').map(l => l.drawOrder);
const vDash = new Map(vStrict); for (const d of dashboardOrders) vDash.set(d, 1);   // sensitivity: dashboards counted as explained, as the census has them
const coverage = {
  censusClaim: { explained: 1524, of: 1559, share: r3(1524 / 1559), note: 'census: every non-refused item is explained (tautology, L1-PATTERNS 1.4); only the 35 refusals are unexplained' },
  headlineStrict: estimate(vStrict, null, 'explained = yes only (partly counts 0), the 60 labels as recorded'),
  lenient: estimate(vLenient, null, 'explained = yes or partly'),
  sensitivityDashboardsExplained: estimate(vDash, null, 'the labelled dashboard-state refusals (medium confidence) counted as explained'),
};
// population-level dashboard check (no sample): Node-RED items with >= T ui_* widget nodes
const nr = [...corpus.values()].filter(i => i.id.startsWith('node-red:')).map(i => ({ id: i.id, nodes: i.graph.nodes.length, ui: i.graph.nodes.filter(n => /^ui_/.test(n.type)).length, status: pub.get(i.id).status }));
const dashPop = {}; for (const T of [10, 20, 30]) dashPop['ui>=' + T] = { nodeRedItems: nr.length, withWidgets: nr.filter(x => x.ui >= T).length, censusRefused: nr.filter(x => x.ui >= T && x.status === 'refused').length, explainedByCensus: nr.filter(x => x.ui >= T && x.status !== 'refused').length };
const dashItemsInSample = dashboardOrders.map(d => { const l = byOrder.get(d); const x = nr.find(y => y.id === l.id); return { drawOrder: d, id: l.id, widgets: x.ui, nodes: x.nodes, censusStatus: x.status }; });
// stratum automation|C population composition
const stratC = draw.items.filter(i => i.cluster === 'automation' && i.stratum === 'C');
const rowsAll = [...pub.values()];
// population-calibrated variant: apply D = node-red with >= 20 widgets and not refused at population level, estimate the rest from the sample
const Dpop = nr.filter(x => x.ui >= 20 && x.status !== 'refused').map(x => x.id);
const Dset = new Set(Dpop);
const sampleD = new Set(labels.filter(l => Dset.has(l.id)).map(l => l.drawOrder));
const sampleNonD = draw.items.filter(i => !sampleD.has(i.drawOrder)).map(i => i.drawOrder);
// reweight: strata shrink by D members of the frame; frame membership of D by stratum (using draw.mjs stratum rules)
const CL = { automation: ['activepieces', 'coze', 'dify', 'flowise', 'langflow', 'n8n', 'node-red', 'zapier'] };
const stratumOfRow = r => { const cl = r.plat === 'claude-code-workflows' ? 'first-party' : (CL.automation.includes(r.plat) ? 'automation' : null); return cl; };
const Dcounts = {}; for (const id of Dpop) { const r = pub.get(id); const n = Object.keys(r.needs).filter(p => !p.startsWith('L0')).length; const s = n <= 1 ? 'A' : n <= 4 ? 'B' : 'C'; const k = 'automation|' + s; Dcounts[k] = (Dcounts[k] ?? 0) + 1; }
const wAdj = new Map(draw.items.map(i => { const k = i.cluster + '|' + i.stratum; const nonD = draw.frameSizes[k] - (Dcounts[k] ?? 0); const nSampNonD = draw.items.filter(j => j.cluster === i.cluster && j.stratum === i.stratum && !sampleD.has(j.drawOrder)).length; return [i.drawOrder, nSampNonD ? nonD / nSampNonD : 0]; }));
function estimateWith(vals, ids, wmap) { const w = ids.map(d => wmap.get(d)); const sw = w.reduce((a, b) => a + b, 0); const p = ids.reduce((s, d, i) => s + w[i] * vals.get(d), 0) / sw; const neff = sw * sw / w.reduce((a, b) => a + b * b, 0); const [lo, hi] = wilson(p * neff, neff);
  const strata = new Map(); for (const d of ids) (strata.get(stratumKey.get(d)) ?? strata.set(stratumKey.get(d), []).get(stratumKey.get(d))).push(d); const rnd = mulberry32(SEED_BOOT); const reps = [];
  for (let b = 0; b < 5000; b++) { let s = 0, t = 0; for (const [, ds] of strata) { const Nh = wmap.get(ds[0]) * ds.length; let m = 0; for (let i = 0; i < ds.length; i++) m += vals.get(ds[Math.floor(rnd() * ds.length)]); s += Nh * m / ds.length; t += Nh; } reps.push(s / t); } reps.sort((a, b) => a - b);
  return { sw: Math.round(sw), p, neff, lo, hi, bl: reps[Math.floor(0.025 * reps.length)], bh: reps[Math.floor(0.975 * reps.length)] }; }
const eD = estimateWith(vStrict, sampleNonD, wAdj);
const nonDPop = eD.sw;   // population of items that are not D-flagged
const frac = nonDPop / N;
coverage.populationCalibratedDashboards = { label: 'dashboard rule applied at population level: every unrefused Node-RED item with >= 20 UI widgets counted as unexplained, the rest estimated from the sample (strict)',
  dashboardItemsExtra: Dpop.length, nonDashboardPopulation: nonDPop, sampleItemsUsed: sampleNonD.length, postStratifiedWithinNonD: r3(eD.p), kishNeff: Math.round(eD.neff * 10) / 10,
  coverage: r3(eD.p * frac), wilson95KishNeff: [r3(eD.lo * frac), r3(eD.hi * frac)], stratifiedBootstrap95: [r3(eD.bl * frac), r3(eD.bh * frac)] };
coverage.dashboardEvidence = { sampleItems: dashItemsInSample, populationNodeRed: dashPop, automationCSampleSize: stratC.length, automationCPopulation: draw.frameSizes['automation|C'],
  nodeRedItemsInAutomationC: rowsAll.filter(r => r.plat === 'node-red' && Object.keys(r.needs).filter(p => !p.startsWith('L0')).length >= 5 && r.status !== 'refused').length };
// per-item "partly" entry
const partlyItems = exRows.filter(r => r.blind === 'partly').map(r => r.drawOrder);

// ---------------------------------------------------------------- hit tables
const hits = [];
const rawHits = fs.readFileSync(path.join(HERE, 'adj-hits', 'hits.txt'), 'utf8').split('\n').filter(x => x.trim());
for (const line of rawHits) { const [p, k, v, ...rest] = line.split('|'); const id = hitsDraw.draw[p]?.ids[Number(k) - 1]; if (!id) { problems.push('hit without id ' + line); continue; } if (!'ypn'.includes(v)) problems.push('bad hit verdict ' + line); hits.push({ pattern: p, k: Number(k), id, verdict: v, reason: rest.join('|').trim() }); }
for (const [p, d] of Object.entries(hitsDraw.draw)) { const got = hits.filter(h => h.pattern === p).length; if (got !== d.ids.length) problems.push(`hit verdict count ${p}: ${got}/${d.ids.length}`); }
const hitStats = (set) => { const y = set.filter(h => h.verdict === 'y').length, p = set.filter(h => h.verdict === 'p').length, n = set.filter(h => h.verdict === 'n').length; const s = y + p / 2; return { judged: set.length, yes: y, partly: p, no: n, precision: set.length ? r3(s / set.length) : null, wilson95: W(s, set.length), strictPrecision: set.length ? r3(y / set.length) : null }; };
const TOP5 = ['P01', 'P02', 'P37', 'P38', 'P08'], RARE5 = ['P48', 'P30', 'P49', 'P31', 'P22'], SUP = ['P01', 'P02', 'P16', 'P17', 'P18', 'P49'];
const hitTable = {};
for (const p of [...new Set([...TOP5, ...RARE5, ...SUP])]) { const set = hits.filter(h => h.pattern === p); hitTable[p] = { population: hitsDraw.draw[p].population, groups: [TOP5.includes(p) && 'five-most-frequent', RARE5.includes(p) && 'five-rarest-nonzero', SUP.includes(p) && 'support-only-20'].filter(Boolean), all: hitStats(set), first10: hitStats(set.slice(0, 10)), exhaustive: hitsDraw.draw[p].population <= set.length }; }
const below50 = Object.entries(hitTable).filter(([, v]) => v.all.precision < 0.5).map(([p, v]) => ({ pattern: p, precision: v.all.precision, judged: v.all.judged }));
// effect of removing a detector on coverage figures: census statuses and distance buckets use needs, plumbing never enters
const removalCheck = (() => { const rem = new Set(below50.map(x => x.pattern)); let itemsWithRemovedInNeeds = 0; const detail = {}; for (const r of pub.values()) { const hit = Object.keys(r.needs).filter(p => rem.has(p)); if (hit.length) { itemsWithRemovedInNeeds++; for (const p of hit) detail[p] = (detail[p] ?? 0) + 1; } } return { removedDetectors: [...rem], itemsWithRemovedPatternInNeeds: itemsWithRemovedInNeeds, byPattern: detail, note: 'census status (flat/hier/refused) and the 5-pattern budget are computed from needs; patterns in needs that are removed would change the budget bucket' }; })();
// zero-hit patterns
const patCounts = {}; for (const r of cen.values()) for (const p of detSet(r)) patCounts[p] = (patCounts[p] ?? 0) + 1;
const zero = []; for (let i = 1; i <= 57; i++) { const p = 'P' + String(i).padStart(2, '0'); if (!patCounts[p]) zero.push(p); }

// ---------------------------------------------------------------- disagreements
const disagreements = [];
for (const x of pairs) if (!x.inBlind) disagreements.push({ type: 'detector-only', drawOrder: x.drawOrder, id: x.id, pattern: x.pattern, adjudicated: x.verdict, reason: x.reason });
for (const x of pairs) if (x.inBlind && x.verdict !== 'y') disagreements.push({ type: 'both-assigned-but-adjudicated-' + (x.verdict === 'p' ? 'partly' : 'no'), drawOrder: x.drawOrder, id: x.id, pattern: x.pattern, adjudicated: x.verdict, reason: x.reason });
for (const x of misses) disagreements.push({ type: x.verdict === 'm' ? 'blind-only-detector-substituted' : 'blind-only-detector-no-rule', drawOrder: x.drawOrder, id: x.id, pattern: x.pattern, adjudicated: x.verdict, reason: x.reason });
for (const r of exRows) if (r.censusExplained !== r.strict) disagreements.push({ type: 'item-explained', drawOrder: r.drawOrder, id: r.id, pattern: null, adjudicated: r.blind, reason: byOrder.get(r.drawOrder).note });

// ---------------------------------------------------------------- write
const labelHash = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(path.join(OUT, 'L1-audit-labels.jsonl'))).digest('hex');
const result = {
  meta: { task: 'L1-a hand audit + detector precision', drawSeed: draw.seed, hitSeed: hitsDraw.seed, bootstrapSeed: SEED_BOOT, prng: 'mulberry32', labelsSha256: labelHash, items: labels.length, drawOrderRecorded: true, blindProtocol: 'labels were written and timestamped (labelledAt) from the corpus item summary with ir hidden before the census rows for these items were opened; four rows were revised before the census was opened (revisedAt, revisionNote); strata were built from the census pattern count by design (draw.mjs)', consistencyProblems: problems },
  coverage, itemLevel: { explainedAgreementStrict: { agree: itemAgreementStrict, of: 60, share: r3(itemAgreementStrict / 60) }, explainedAgreementLenient: { agree: itemAgreementLenient, of: 60, share: r3(itemAgreementLenient / 60) }, table: exTab, partlyItems, patternSetExactMatch: exactSet, meanJaccardDetectorVsBlind: r3(jacc.reduce((a, b) => a + b, 0) / jacc.length), itemsWithAnyDetectorPairAdjudicatedNo: new Set(pairs.filter(p => p.verdict === 'n').map(p => p.drawOrder)).size, itemsWithAnyBlindOnlyPattern: new Set(misses.map(m => m.drawOrder)).size },
  l0Agreement: l0agree, rulePrecision: { ...precision, decisionL1a }, recall, perPattern,
  refusedItemsOutsidePatternRecall: refusedSkipped, detectorHits: { table: hitTable, patternsBelow50: below50, removalCheck, zeroHitPatterns: zero, populationCounts: Object.fromEntries(Object.entries(patCounts).sort((a, b) => b[1] - a[1]).slice(0, 12)) },
  disagreementCounts: disagreements.reduce((o, d) => (o[d.type] = (o[d.type] ?? 0) + 1, o), {}), disagreements,
  perItem: exRows,
};
fs.writeFileSync(path.join(OUT, 'L1-audit.json'), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(OUT, 'L1-audit-adjudication.jsonl'), adj.map(a => { const l = byOrder.get(a.drawOrder); return JSON.stringify({ drawOrder: a.drawOrder, id: l?.id, pattern: a.pattern, verdict: a.verdict, meaning: { y: 'detector pair, yes', p: 'detector pair, partly', n: 'detector pair, no', m: 'blind-only, detector substituted another owner', M: 'blind-only, detector has no rule' }[a.verdict], reason: a.reason }); }).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'L1-detector-hits-verdicts.jsonl'), hits.map(h => JSON.stringify(h)).join('\n') + '\n');
console.log('problems:', problems);
console.log(JSON.stringify({ coverage, itemLevel: result.itemLevel, l0agree, precision: { all: precision.all, rule: precision.nodeRuleAndToken, sup: precision.supportOnlyPlumbing }, recall }, null, 1));
console.log(JSON.stringify(hitTable, null, 0)); console.log(JSON.stringify(below50), JSON.stringify(removalCheck), zero.join(','));
console.log(result.disagreementCounts);
