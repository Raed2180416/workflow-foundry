#!/usr/bin/env node
// Tier-down analysis (PREREG-TIERDOWN.json): node tables, the C-slice selection (AMENDMENT-1), the H-slice promotion
// test, the provisional (exploratory) policy, the baselines, and the capability number. Pure over the answers files
// (tier-replay.mjs) and injection files (inject.mjs); no model calls.
//
//   node experiments/tierdown/analyze.mjs select   --prereg P.json --answers a,b --inject C.json --classes classes-C.json --out sel.json
//   node experiments/tierdown/analyze.mjs evaluate --prereg P.json --selection sel.json --answers a,b --inject H.json --out eval.json [--md eval.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { readJsonl } from './archive.mjs';
import { bound1, bound2, fixedSequence, nonInferior, costSaved, LEVERAGE_CLASSES } from './policy.mjs';
import { clopperPearson } from '../lib/stats-ebed.mjs';

// Listed price order (cheapest first) for ties and "cheapest tier": rule and memo are code; mercury-3 lists $0 a token;
// claude-haiku-5-5 is the cheapest Claude tier.
export const TIER_ORDER = Object.freeze(['rule', 'memo', 'mercury-3', 'claude-haiku-5-5']);
export const GLOBAL_READERS = Object.freeze(['records/rules', 'records/source-rules', 'kinetics/well-events', 'kinetics/prose-events-a']);
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const sum = xs => xs.reduce((s, x) => s + (x ?? 0), 0);

// Node table: per (site, tier): answered, usable (ok), mean agreement over usable, exact rate, tier USD per decision (a
// model tier in a k-sample judge charged k times), reference USD per decision, latency p50 / p95 (tier, reference).
export function nodeTable(answers) {
  const by = new Map();
  for (const a of answers) {
    const k = `${a.site}\0${a.tier}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(a);
  }
  return [...by].map(([k, list]) => {
    const [site, tier] = k.split('\0'), ok = list.filter(a => a.ok), mult = a => (['rule', 'memo'].includes(tier) ? 1 : (a.samples ?? 1));
    return { site, tier, answered: list.length, usable: ok.length, usableRate: list.length ? ok.length / list.length : null,
      agreement: ok.length ? sum(ok.map(a => a.agreement)) / ok.length : null, disagreement: ok.length ? 1 - sum(ok.map(a => a.agreement)) / ok.length : null,
      exactRate: ok.length ? ok.filter(a => a.exact).length / ok.length : null,
      tierUsdPerDecision: sum(list.map(a => (a.costUsd ?? 0) * mult(a))) / list.length, refUsdPerDecision: sum(list.map(a => a.refCostUsd)) / list.length,
      tierLatencyP50: quantile(list.map(a => a.latencyMs ?? 0), 0.5), tierLatencyP95: quantile(list.map(a => a.latencyMs ?? 0), 0.95),
      refLatencyP50: quantile(list.map(a => a.refLatencyMs ?? 0), 0.5), refLatencyP95: quantile(list.map(a => a.refLatencyMs ?? 0), 0.95),
      errors: Object.entries(list.filter(a => !a.ok).reduce((m, a) => { const e = a.abstain ? 'abstain' : (a.error?.code ?? a.error ?? 'error'); m[e] = (m[e] ?? 0) + 1; return m; }, {})) };
  }).sort((a, b) => a.site.localeCompare(b.site) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

// Injection table: per assignment: measured units, outcomes, flips both ways, judge USD (with fallbacks and deopt
// charges) and reference USD over the units it applies to.
export function injectTable(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.assignment)) by.set(r.assignment, []); by.get(r.assignment).push(r); }
  return Object.fromEntries([...by].map(([name, list]) => {
    const m = list.filter(r => r.status === 'measured'), measured = m.filter(r => r.outcome !== 'unmeasured');
    const outcomes = m.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] ?? 0) + 1 }), {});
    return [name, { units: measured.length, unmeasured: m.length - measured.length, incomplete: list.filter(r => r.status === 'incomplete').length, outcomes,
      passFail: measured.filter(r => r.direction === 'pass->fail').length, failPass: measured.filter(r => r.direction === 'fail->pass').length,
      deopts: measured.filter(r => r.outcome === 'deopt' || r.outcome === 'crash').length,
      judgeUsd: sum(measured.map(r => r.judgeUsd + r.deoptUsd)), refUsd: sum(measured.map(r => r.refUsd)),
      basePass: measured.filter(r => r.basePass).length, pass: measured.filter(r => r.pass).length,
      latencyP50: quantile(measured.map(r => r.latencyMs), 0.5), latencyP95: quantile(measured.map(r => r.latencyMs), 0.95),
      refLatencyP50: quantile(measured.map(r => r.refLatencyMs), 0.5), refLatencyP95: quantile(measured.map(r => r.refLatencyMs), 0.95) }];
  }));
}
export const singleName = (site, tier) => `${site}@${tier}`;

// AMENDMENT-1 selection on C (PREREG "selection"): per site, the cheapest tier (TIER_ORDER, ties by agreement) that
// passes Bound 2 on C and has zero pass->fail injected flips on C; order by descending C saving per unit.
export function selectOnC({ prereg, nodes, inj, classes }) {
  const out = [];
  for (const s of prereg.sites) {
    const cands = [];
    for (const tier of s.tiers) {
      const n = nodes.find(x => x.site === s.site && x.tier === tier), j = inj[singleName(s.site, tier)];
      if (!n || !j) { cands.push({ tier, eligible: false, reason: !n ? 'no C answers' : 'no C injection' }); continue; }
      const b2 = bound2({ disagreement: n.disagreement, usable: n.usable, answered: n.answered, rule: tier === 'rule' || tier === 'memo' });
      const savingPerUnit = j.units ? (j.refUsd - j.judgeUsd) / j.units : null;
      const eligible = b2.holds && j.units > 0 && j.passFail === 0;
      cands.push({ tier, eligible, reason: eligible ? null : !b2.holds ? `Bound 2 on C fails (disagreement ${n.disagreement?.toFixed(3)}, usable ${b2.usableRate.toFixed(3)})` : j.units === 0 ? 'no measured C units' : `${j.passFail} pass->fail flips on C`,
        disagreement: n.disagreement, usableRate: b2.usableRate, units: j.units, passFail: j.passFail, failPass: j.failPass, savingPerUnit });
    }
    const ok = cands.filter(c => c.eligible).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || (a.disagreement ?? 1) - (b.disagreement ?? 1));
    const cls = classes[s.site] ?? { class: 'high', delta: 0.02, unmeasured: true };
    out.push({ site: s.site, class: cls.class, delta: cls.delta, selected: ok[0]?.tier ?? null, savingPerUnitC: ok[0]?.savingPerUnit ?? null, candidates: cands });
  }
  const order = out.filter(x => x.selected).sort((a, b) => (b.savingPerUnitC ?? 0) - (a.savingPerUnitC ?? 0)).map(x => ({ site: x.site, tier: x.selected, class: x.class, delta: x.delta }));
  // B-screen: the existing tierdown.mjs rule without leverage or flips: the cheapest tier with C mean agreement >= 0.98.
  const screen = Object.fromEntries(prereg.sites.flatMap(s => {
    const t = [...s.tiers].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)).find(tier => { const n = nodes.find(x => x.site === s.site && x.tier === tier); return n && n.usable > 0 && n.agreement >= 0.98; });
    return t ? [[s.site, t]] : [];
  }));
  return { sites: out, order, screen };
}

// The baselines' assignments (frozen with AMENDMENT-1).
// B-sink's "cheapest measured tier" is the cheapest tier with at least one usable C answer (AMENDMENT-1 reading: memo,
// which never answered at delivery time, is not a measured tier, so it cannot stand in for a cheap model).
export function baselineAssignments({ prereg, selection, nodes = null }) {
  const has = tier => Object.fromEntries(prereg.sites.filter(s => s.tiers.includes(tier)).map(s => [s.site, tier]));
  const measured = (site, tier) => !nodes || nodes.some(n => n.site === site && n.tier === tier && n.usable > 0);
  const cheapest = s => [...s.tiers].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)).find(t => measured(s.site, t));
  return {
    'B-screen': selection.screen,
    'B-all-haiku': has('claude-haiku-5-5'),
    'B-all-mercury': has('mercury-3'),
    'B-sink': Object.fromEntries(prereg.sites.filter(s => !GLOBAL_READERS.includes(s.site)).map(s => [s.site, cheapest(s)]).filter(([, t]) => t)),
    'B-memo': has('memo'),
  };
}
export const assignSpec = (name, map) => `${name}=${Object.entries(map).map(([s, t]) => `${s}:${t}`).join(',')}`;

// H evaluation: the primary fixed-sequence promotion, the provisional policy, the baselines, equal accuracy, the
// capability number.
export function evaluateOnH({ selection, nodes, inj, unitsAll }) {
  const primary = fixedSequence(selection.order.map(o => ({ ...o, id: o.site })), o => {
    const n = nodes.find(x => x.site === o.site && x.tier === o.tier), j = inj[singleName(o.site, o.tier)] ?? { units: 0, passFail: 0 };
    const b1 = bound1({ flips: j.passFail, units: j.units, delta: o.delta });
    const b2 = n ? bound2({ disagreement: n.disagreement, usable: n.usable, answered: n.answered, rule: o.tier === 'rule' || o.tier === 'memo' }) : { holds: false };
    return { holds: b1.holds && b2.holds, bound1: b1, bound2: b2, units: j.units, passFail: j.passFail, failPass: j.failPass };
  });
  const provisional = selection.order.map(o => {
    const n = nodes.find(x => x.site === o.site && x.tier === o.tier), j = inj[singleName(o.site, o.tier)] ?? { units: 0, passFail: 0, failPass: 0 };
    const b2 = n ? bound2({ disagreement: n.disagreement, usable: n.usable, answered: n.answered, rule: o.tier === 'rule' || o.tier === 'memo' }) : { holds: false };
    const keep = j.units > 0 && j.passFail === 0 && b2.holds;
    return { ...o, keep, units: j.units, passFail: j.passFail, failPass: j.failPass, bound2: b2, bound1Upper: j.units ? clopperPearson(j.passFail, j.units, 'upper').upper : 1 };
  });
  return { primary, provisional };
}

// Capability row for one combined assignment over ALL H units (units the assignment does not touch keep their
// reference cost and outcome): accuracy, cost saved, flips, NI and McNemar, latency.
export function capabilityRow(name, rows, allUnits) {
  const byRow = new Map(rows.filter(r => r.assignment === name).map(r => [r.row, r]));
  let pass = 0, refPass = 0, cost = 0, refCost = 0, b = 0, c = 0, n = 0, unmeasured = 0, deopts = 0, incomplete = 0;
  const lat = [], refLat = [];
  for (const u of allUnits) {
    const r = byRow.get(u.row);
    if (r?.status === 'measured' && r.outcome === 'unmeasured') { unmeasured++; continue; }
    // A unit whose assigned tier has no answer for some decision (a token cap, never asked) is not a reference unit:
    // it is left out of the comparison and counted, so an incomplete baseline is never scored as the reference.
    if (r?.status === 'incomplete') { incomplete++; continue; }
    n++; refPass += u.basePass ? 1 : 0; refCost += u.refUsd;
    if (r?.status === 'measured') {
      pass += r.pass ? 1 : 0; cost += r.judgeUsd + r.deoptUsd; lat.push(r.latencyMs); refLat.push(r.refLatencyMs);
      if (r.direction === 'pass->fail') b++; if (r.direction === 'fail->pass') c++; if (r.outcome === 'deopt' || r.outcome === 'crash') deopts++;
    } else { pass += u.basePass ? 1 : 0; cost += u.refUsd; lat.push(u.refLatencyMs); refLat.push(u.refLatencyMs); }
  }
  return { name, units: n, unmeasured, incomplete, pass, refPass, accuracy: n ? pass / n : null, refAccuracy: n ? refPass / n : null, passFail: b, failPass: c, deopts,
    judgeUsdPerUnit: n ? cost / n : null, refUsdPerUnit: n ? refCost / n : null, costSaved: costSaved(cost, refCost), ni: nonInferior({ b, c, n }),
    latencyP50: quantile(lat, 0.5), latencyP95: quantile(lat, 0.95), refLatencyP50: quantile(refLat, 0.5), refLatencyP95: quantile(refLat, 0.95) };
}

// Spearman rank correlation with average ranks for ties (null under fewer than 3 pairs or a constant side).
export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rank = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length, mx = sum(rx) / n, my = sum(ry) / n;
  const cov = sum(rx.map((x, i) => (x - mx) * (ry[i] - my))), vx = sum(rx.map(x => (x - mx) ** 2)), vy = sum(ry.map(y => (y - my) ** 2));
  return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}

// Dossier §5 kill rule: does the synthetic perturbation screen (C-slice flip rate per site) rank sites the way real
// cheaper-tier answers injected end to end do? Per site, pooled over every model and rule tier and both slices: the rate
// of measured units whose outcome moved (a flip either way, a deopt or a crash). Below 0.5 the screen is dropped and
// only injection is used to rank.
export function leverageCheck(classes, injRows) {
  const by = new Map();
  for (const r of injRows) {
    if (!r.assignment.includes('@') || r.assignment.endsWith('@memo') || r.status !== 'measured' || r.outcome === 'unmeasured') continue;
    const site = r.assignment.slice(0, r.assignment.lastIndexOf('@')), s = by.get(site) ?? { units: 0, moved: 0, flips: 0 };
    s.units++; if (r.outcome === 'flip' || r.outcome === 'deopt' || r.outcome === 'crash') s.moved++; if (r.outcome === 'flip') s.flips++;
    by.set(site, s);
  }
  const rows = [...by].filter(([site]) => classes[site]?.flipRate != null).map(([site, s]) => ({ site, screen: classes[site].flipRate, injectedMoved: s.moved / s.units, units: s.units, moved: s.moved, flips: s.flips }));
  const rho = spearman(rows.map(r => r.screen), rows.map(r => r.injectedMoved));
  return { rows: rows.sort((a, b) => b.screen - a.screen), rho, keepScreen: rho != null && rho >= 0.5 };
}

export function mergeInject(files) {
  if (new Set(files.map(f => f.slice)).size > 1) throw new Error('mergeInject: files of different slices');
  const seen = new Set(files[0].rows.filter(r => r.assignment !== 'B-ref').map(r => r.assignment)), rows = [...files[0].rows];
  for (const f of files.slice(1)) {
    const names = new Set(f.rows.filter(r => r.assignment !== 'B-ref').map(r => r.assignment));
    for (const n of names) if (seen.has(n)) throw new Error(`mergeInject: assignment ${n} is in two files`);
    for (const n of names) seen.add(n);
    rows.push(...f.rows.filter(r => r.assignment !== 'B-ref'));
  }
  return { ...files[0], rows };
}

function main() {
  const [cmd, ...args] = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const prereg = JSON.parse(readFileSync(opt('--prereg'), 'utf8'));
  const answers = (opt('--answers') ?? '').split(',').filter(Boolean).flatMap(f => readJsonl(f));
  // --inject may name several files (a second $0 pass, e.g. the provisional policy): their rows are merged, and the B-ref
  // rows (the reference units) come from the first file only, so no unit is counted twice.
  const injFile = cmd === 'check' ? null : mergeInject(opt('--inject').split(',').map(f => JSON.parse(readFileSync(f, 'utf8'))));
  const nodes = nodeTable(answers), inj = injFile ? injectTable(injFile.rows) : null;
  if (cmd === 'select') {
    const classes = JSON.parse(readFileSync(opt('--classes'), 'utf8'));
    const selection = selectOnC({ prereg, nodes, inj, classes });
    const baselines = baselineAssignments({ prereg, selection, nodes });
    const res = { slice: 'C', evidence: 'development (calibration slice)', nodes, inject: inj, selection, baselines,
      assignSpecs: { policy: assignSpec('policy', Object.fromEntries(selection.order.map(o => [o.site, o.tier]))), ...Object.fromEntries(Object.entries(baselines).map(([k, v]) => [k, assignSpec(k, v)])) } };
    writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify({ order: selection.order, screen: selection.screen, baselines }, null, 1));
  } else if (cmd === 'evaluate') {
    const sel = JSON.parse(readFileSync(opt('--selection'), 'utf8'));
    const { primary, provisional } = evaluateOnH({ selection: sel.selection, nodes, inj });
    // All H units with their reference outcome and cost: the B-ref rows of the injection file.
    const ref = injFile.rows.filter(r => r.assignment === 'B-ref');
    const allUnits = ref.map(r => ({ row: r.row, basePass: r.basePass, refUsd: r.rowRefUsd, refLatencyMs: r.refLatencyMs ?? 0 }));
    const names = [...new Set(injFile.rows.map(r => r.assignment))].filter(n => !n.includes('@'));
    const capability = names.map(n => capabilityRow(n, injFile.rows, allUnits));
    const res = { slice: 'H', evidence: 'development (archived dev runs held out from every choice; not sealed)', nodes, inject: inj, primary, provisional, capability };
    writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify({ primary: primary.map(p => ({ site: p.site, tier: p.tier, verdict: p.verdict, units: p.units, passFail: p.passFail, upper: p.bound1?.upper })),
      provisional: provisional.map(p => ({ site: p.site, tier: p.tier, keep: p.keep, units: p.units, passFail: p.passFail, failPass: p.failPass })),
      capability: capability.map(c => ({ name: c.name, units: c.units, acc: c.accuracy, ref: c.refAccuracy, saved: c.costSaved, pf: c.passFail, fp: c.failPass, ni: c.ni.holds })) }, null, 1));
  } else if (cmd === 'check') {
    // node analyze.mjs check --prereg P --answers a --inject C.json,H.json --classes classes-C.json
    const classes = JSON.parse(readFileSync(opt('--classes'), 'utf8'));
    const rows = opt('--inject').split(',').flatMap(f => JSON.parse(readFileSync(f, 'utf8')).rows);
    console.log(JSON.stringify(leverageCheck(classes, rows), null, 1));
  } else throw new Error('usage: analyze.mjs select|evaluate|check ...');
}
if (import.meta.url === `file://${process.argv[1]}`) main();
