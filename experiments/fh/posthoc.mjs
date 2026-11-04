// FH-1 post-hoc analyses requested by the 2026-11-04 review ($0; written after the result and after unblinding; NOT frozen,
// none of it changes a frozen verdict). Reads only recorded data: the baseline gradings, the attempt records and their
// grading-after.json, the root-cause result and fh1/architect-cost.json.
//   M3  fair regeneration baselines: regenerate under the SAME H-C replay gate (practice contracts), its expectation over the
//       recorded same-arm peers, best-of-2 selected by the gate's own information (practice), and the oracle-selected upper bound;
//   M4  the headline split: go-live (one shared misreading, SPEC-E §3.5) against everything else; per failure class; per defect;
//       H-C vs regenerate on the non-go-live cases;
//   M5  H2 restricted to the incidents where both arms ran a session; H-N vs H-0 per incident;
//   M6  H1 with the verifier's authoring cost counted (bounds from architect-cost.json);
//   m6  every recorded comparison re-done with missing cases counted (compareStrict).
//   node experiments/fh/posthoc.mjs [--json research/heal-20261021/fh1/posthoc.json]      markdown tables on stdout
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, compare } from './grade.mjs';
import { BUILDS } from './baseline.mjs';
import { INCIDENTS } from './heal.mjs';
import { signTest } from './analyse.mjs';

const FH1 = path.join(ROOT, 'research/heal-20261021/fh1');
const RUN_DIR = path.join(FH1, 'runs');
export const TOTAL_FAILING = 475;
export const isGoLive = cls => cls.startsWith('gl-');
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const baseline = l => json(path.join(FH1, 'baseline', `${l}.json`));
const record = label => (existsSync(path.join(RUN_DIR, label, 'record.json')) ? json(path.join(RUN_DIR, label, 'record.json')) : null);

/** compare() with missing cases counted: a case graded before and absent after is a regression, never silently dropped (m6). */
export function compareStrict(before, after, opts = {}) {
  const c = compare(before, after, opts);
  const idx = g => new Set(g.worlds.flatMap(w => w.cases.map(x => `${w.world}/${x.case}`)));
  const A = idx(after), B = idx(before);
  const extra = [...A].filter(k => !B.has(k));
  return { ...c, nMissing: c.missing.length, nExtra: extra.length, nRegressedStrict: c.nRegressed + c.missing.length, netStrict: c.nRecovered - c.nRegressed - c.missing.length };
}

const restrict = (g, keep) => ({ worlds: g.worlds.map(w => ({ ...w, cases: w.cases.filter(keep) })) });
const tallyNet = c => ({ rec: c.nRecovered, reg: c.nRegressed, net: c.net });

/** The H-C replay gate (heal.mjs gateDecision 'H-C') applied to any candidate program's practice grading. */
export function hcGate(before, after) {
  const ae = g => g.worlds.reduce((s, w) => s + (w.armErrors ?? 0), 0);
  if (ae(after) > ae(before)) return { accept: false, reason: 'arm errors' };
  const c = compare(before, after, { by: 'contracts' });
  if (c.nRegressed > 0) return { accept: false, reason: `${c.nRegressed} practice orders newly fail`, rec: c.nRecovered, reg: c.nRegressed };
  if (c.nRecovered === 0) return { accept: false, reason: 'nothing recovered', rec: 0, reg: 0 };
  return { accept: true, reason: `${c.nRecovered} recovered, 0 regressed`, rec: c.nRecovered, reg: 0 };
}

const peersOf = inc => Object.keys(BUILDS).filter(l => l !== inc && !BUILDS[l].prior && BUILDS[l].arm === BUILDS[inc].arm);

/** M3: regenerate ungated, gated (H-C gate), best-of-2 by practice, best-of-2 by oracle (upper bound). */
export function regenerate() {
  const rows = [];
  for (const inc of INCIDENTS) {
    const b = baseline(inc);
    const peers = peersOf(inc).map(p => {
      const bp = baseline(p);
      const g = hcGate(b.practice, bp.practice);
      const all = compareStrict(b.grading, bp.grading);
      const gl = compare(restrict(b.grading, c => isGoLive(c.class)), restrict(bp.grading, c => isGoLive(c.class)));
      const other = compare(restrict(b.grading, c => !isGoLive(c.class)), restrict(bp.grading, c => !isGoLive(c.class)));
      return { peer: p, usd: BUILDS[p].buildUsd, gate: g, raw: tallyNet(all), missing: all.nMissing, goLive: tallyNet(gl), other: tallyNet(other) };
    });
    const mean = f => peers.reduce((s, p) => s + f(p), 0) / peers.length;
    const kept = p => (p.gate.accept ? p.raw.net : 0);
    const keptOther = p => (p.gate.accept ? p.other.net : 0);
    const accepted = peers.filter(p => p.gate.accept);
    const byPractice = accepted.length ? accepted.reduce((a, p) => (p.gate.rec > a.gate.rec ? p : a)) : null; // first on a tie (plan order)
    rows.push({ incident: inc, failing: b.grading.totals.oracleN - b.grading.totals.oraclePassed, peers,
      ungated: { net: mean(p => p.raw.net), rec: mean(p => p.raw.rec), reg: mean(p => p.raw.reg), other: mean(p => p.other.net), usd: mean(p => p.usd) },
      gated: { net: mean(kept), reg: 0, other: mean(keptOther), usd: mean(p => p.usd), acceptRate: accepted.length / peers.length },
      best2Practice: { net: byPractice ? byPractice.raw.net : 0, other: byPractice ? byPractice.other.net : 0, pick: byPractice?.peer ?? null, usd: peers.reduce((s, p) => s + p.usd, 0) },
      best2Oracle: { net: Math.max(0, ...peers.map(kept)), usd: peers.reduce((s, p) => s + p.usd, 0) } });
  }
  const sum = f => rows.reduce((s, r) => s + f(r), 0);
  return { rows, totals: {
    ungated: { net: sum(r => r.ungated.net), rec: sum(r => r.ungated.rec), reg: sum(r => r.ungated.reg), other: sum(r => r.ungated.other), usd: sum(r => r.ungated.usd) },
    gated: { net: sum(r => r.gated.net), reg: 0, other: sum(r => r.gated.other), usd: sum(r => r.gated.usd) },
    best2Practice: { net: sum(r => r.best2Practice.net), other: sum(r => r.best2Practice.other), usd: sum(r => r.best2Practice.usd) },
    best2Oracle: { net: sum(r => r.best2Oracle.net), usd: sum(r => r.best2Oracle.usd) } } };
}

/** Kept outcome of an attempt split by go-live / other, from its recorded per-class recoveries (kept = what the gate let through). */
export function split(rec) {
  if (!rec) return null;
  const k = rec.grading.kept, out = { gl: 0, other: 0, regGl: 0, regOther: 0 };
  for (const [cls, n] of Object.entries(k.recoveredByClass ?? {})) out[isGoLive(cls) ? 'gl' : 'other'] += n;
  for (const [cls, n] of Object.entries(k.regressedByClass ?? {})) out[isGoLive(cls) ? 'regGl' : 'regOther'] += n;
  return { ...out, net: k.net, usd: rec.session.costUsd ?? 0, noSignal: !!rec.noSignal };
}

/**
 * M4: defects. A post-hoc grouping of the 39 (incident, class) cells into the defects that cause them, by the analyst's reading of
 * PREREG-FH1 §1 ("one requirement family per build") and one confirmed root cause (ch-e8-3: the $0 counterfactual's one-token
 * fix recovers exactly its 15 non-go-live classes, +118/-0). Not frozen; a different grouping is possible for review timing and
 * the refund family (not root-caused here).
 */
export const DEFECTS = Object.freeze([
  ...['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3', 'b1lh-e8-2'].map(i => ({ incident: i, defect: 'go-live intake (§3.5)', match: isGoLive, confirmed: false })),
  { incident: 'ch-e8-2', defect: 'review timing (R2.2)', match: c => c.startsWith('review-'), confirmed: false },
  { incident: 'ch-e8-3', defect: 'error classifier reads code, not reason (d5 rename)', match: c => !isGoLive(c), confirmed: true },
  { incident: 'cht-e8-1', defect: 'refund after cancel during processing', match: c => c === 'cancel-processing', confirmed: false },
  { incident: 'cht-e8-3', defect: 'refunds after cancel (processing, amend)', match: c => c === 'cancel-processing' || c === 'amend-then-cancel', confirmed: false },
  { incident: 'b1lh-e8-3', defect: 'partial reserve (R4.2)', match: c => c === 'f4-reserve', confirmed: false },
]);

export function defects(arms = { 'H-C k1': 'H-C.k1', 'H-N k1': 'H-N.k1', 'H-0 k1': 'H-0.k1' }) {
  const out = [];
  for (const d of DEFECTS) {
    const b = baseline(d.incident);
    const failing = {};
    for (const w of b.grading.worlds) for (const c of w.cases) if (c.oracle === false && d.match(c.class)) failing[c.class] = (failing[c.class] ?? 0) + 1;
    const n = Object.values(failing).reduce((s, x) => s + x, 0);
    const row = { ...d, match: undefined, classes: Object.keys(failing).sort(), failing: n, arms: {} };
    for (const [name, suffix] of Object.entries(arms)) {
      const r = record(`${d.incident}.${suffix}`);
      const got = r ? Object.entries(r.grading.kept.recoveredByClass ?? {}).filter(([c]) => d.match(c)).reduce((s, [, x]) => s + x, 0) : 0;
      row.arms[name] = { recovered: got, fixed: got === n };
    }
    out.push(row);
  }
  // check: the defects partition every failing (incident, class) cell exactly once
  for (const inc of INCIDENTS) {
    const b = baseline(inc);
    for (const w of b.grading.worlds) for (const c of w.cases) if (c.oracle === false) {
      const hits = DEFECTS.filter(d => d.incident === inc && d.match(c.class)).length;
      if (hits !== 1) throw new Error(`defect grouping: ${inc} ${c.class} matched ${hits} defects`);
    }
  }
  return out;
}

/** m6 + record integrity: recompute every graded attempt's raw comparison from grading-after.json with missing cases counted. */
export function integrity() {
  const out = [];
  for (const d of readdirSync(RUN_DIR).sort()) {
    const f = path.join(RUN_DIR, d, 'grading-after.json');
    if (!existsSync(f)) continue;
    const r = record(d);
    const c = compareStrict(baseline(r.incident).grading, json(f));
    out.push({ label: d, missing: c.nMissing, extra: c.nExtra, rec: c.nRecovered, reg: c.nRegressed, recordRaw: [r.grading.raw.nRecovered, r.grading.raw.nRegressed],
      agrees: c.nRecovered === r.grading.raw.nRecovered && c.nRegressed === r.grading.raw.nRegressed && c.nMissing === 0 && c.nExtra === 0,
      keptRule: r.gate.accept ? r.grading.kept.net === r.grading.raw.net : r.grading.kept.net === 0 && r.grading.kept.nRecovered === 0 });
  }
  return out;
}

export function verifierCost() {
  const f = path.join(FH1, 'architect-cost.json');
  return existsSync(f) ? json(f).usd : null;
}

export function analysis() {
  const regen = regenerate();
  const arms = { 'H-C k1': 'H-C.k1', 'H-N k1': 'H-N.k1', 'H-0 k1': 'H-0.k1', 'H-C k2': 'H-C.k2' };
  const perIncident = INCIDENTS.map(inc => ({ incident: inc, ...Object.fromEntries(Object.entries(arms).map(([n, s]) => [n, split(record(`${inc}.${s}`))])) }));
  const pool = name => perIncident.reduce((a, r) => { const x = r[name]; if (!x) return a; return { gl: a.gl + x.gl, other: a.other + x.other, net: a.net + x.net, usd: a.usd + x.usd, n: a.n + 1 }; }, { gl: 0, other: 0, net: 0, usd: 0, n: 0 });
  const failingGl = INCIDENTS.reduce((s, inc) => s + baseline(inc).grading.worlds.flatMap(w => w.cases).filter(c => c.oracle === false && isGoLive(c.class)).length, 0);
  // M4: non-go-live, H-C k1 vs regenerate (ungated and gated) per incident
  const otherVs = INCIDENTS.map((inc, i) => ({ incident: inc, hc: perIncident[i]['H-C k1'].other, regen: regen.rows[i].ungated.other, gated: regen.rows[i].gated.other }));
  const w = (a, b) => otherVs.filter(x => x[a] > x[b]).length, l = (a, b) => otherVs.filter(x => x[a] < x[b]).length;
  // M5: H2 where both arms had a session
  const both = perIncident.filter(r => r['H-N k1'] && !r['H-N k1'].noSignal);
  const h2 = { incidents: both.map(r => r.incident), hcWins: both.filter(r => r['H-C k1'].net > r['H-N k1'].net).length, hnWins: both.filter(r => r['H-N k1'].net > r['H-C k1'].net).length };
  h2.p = signTest(h2.hcWins, h2.hnWins);
  const nVs0 = { hnWins: perIncident.filter(r => r['H-N k1'].net > r['H-0 k1'].net).map(r => r.incident), h0Wins: perIncident.filter(r => r['H-0 k1'].net > r['H-N k1'].net).map(r => r.incident) };
  nVs0.ties = INCIDENTS.length - nVs0.hnWins.length - nVs0.h0Wins.length;
  // M6: H1's cost conjunct with the verifier's authoring cost counted
  const vc = verifierCost();
  const hc = pool('H-C k1'), G = regen.totals.ungated;
  const h1Cost = vc ? Object.fromEntries(['lowerBound', 'allocated', 'upperBound'].map(k => [k, { verifierUsd: vc[k], hcTotal: hc.usd + vc[k], regenerate: G.usd, conjunctHolds: hc.usd + vc[k] <= G.usd, perProgram: (hc.usd + vc[k]) / INCIDENTS.length }])) : null;
  return { regen, perIncident, pooled: Object.fromEntries(Object.keys(arms).map(n => [n, pool(n)])), failingGl, failingOther: TOTAL_FAILING - failingGl,
    otherVs, otherSign: { hcVsRegen: { wins: w('hc', 'regen'), losses: l('hc', 'regen'), p: signTest(w('hc', 'regen'), l('hc', 'regen')) }, hcVsGated: { wins: w('hc', 'gated'), losses: l('hc', 'gated'), p: signTest(w('hc', 'gated'), l('hc', 'gated')) } },
    defects: defects(), h2, nVs0, verifierCost: vc, h1Cost, integrity: integrity() };
}

const pct = (x, n) => `${(100 * x / n).toFixed(1)}%`;
const r1 = x => Math.round(x * 10) / 10;
export function tables(a) {
  const L = [];
  const R = a.regen.totals, hc = a.pooled['H-C k1'], hn = a.pooled['H-N k1'], h0 = a.pooled['H-0 k1'];
  L.push('#### M3: regeneration under the same gate', '', '| Incident | Peers: H-C gate on practice (accept?), grading +/− | Ungated E[net] | Gated E[net] | Best-of-2 by practice (pick) | Best-of-2 by oracle (upper bound) | H-C k1 |', '|---|---|---|---|---|---|---|');
  a.regen.rows.forEach((r, i) => L.push(`| ${r.incident} | ${r.peers.map(p => `${p.peer}: ${p.gate.accept ? 'accept' : 'reject'} (${p.gate.reason}), +${p.raw.rec}/−${p.raw.reg}`).join('; ')} | ${r1(r.ungated.net)} | ${r1(r.gated.net)} | ${r.best2Practice.net} (${r.best2Practice.pick ?? 'none accepted'}) | ${r.best2Oracle.net} | ${a.perIncident[i]['H-C k1'].net} |`));
  L.push(`| **Σ** | | **${r1(R.ungated.net)}** (reg ${r1(R.ungated.reg)}), $${R.ungated.usd.toFixed(2)} | **${r1(R.gated.net)}** (reg 0), $${R.gated.usd.toFixed(2)} | **${R.best2Practice.net}** (reg 0), $${R.best2Practice.usd.toFixed(2)} | **${R.best2Oracle.net}**, $${R.best2Oracle.usd.toFixed(2)} | **${hc.net}**, $${hc.usd.toFixed(3)} |`, '');
  L.push('#### M4: go-live against everything else', '', `Failing cases: go-live ${a.failingGl}, other ${a.failingOther}.`, '', '| Arm | Net on go-live | Net on the other cases | Net, all |', '|---|---|---|---|');
  L.push(`| regenerate, ungated (E) | ${r1(R.ungated.net - R.ungated.other)} | ${r1(R.ungated.other)} (${pct(R.ungated.other, a.failingOther)}) | ${r1(R.ungated.net)} |`);
  L.push(`| regenerate, H-C gate (E) | ${r1(R.gated.net - R.gated.other)} | ${r1(R.gated.other)} (${pct(R.gated.other, a.failingOther)}) | ${r1(R.gated.net)} |`);
  L.push(`| regenerate, best-of-2 by practice | ${R.best2Practice.net - R.best2Practice.other} | ${R.best2Practice.other} (${pct(R.best2Practice.other, a.failingOther)}) | ${R.best2Practice.net} |`);
  for (const [n, p] of Object.entries(a.pooled)) if (n !== 'H-C k2') L.push(`| ${n} | ${p.gl} (${pct(p.gl, a.failingGl)}) | ${p.other} (${pct(p.other, a.failingOther)}) | ${p.net} (${pct(p.net, TOTAL_FAILING)}) |`);
  L.push('', `Non-go-live, per incident: H-C k1 beats ungated regenerate in ${a.otherSign.hcVsRegen.wins}, loses in ${a.otherSign.hcVsRegen.losses} (p = ${a.otherSign.hcVsRegen.p.toFixed(3)}); beats gated regenerate in ${a.otherSign.hcVsGated.wins}, loses in ${a.otherSign.hcVsGated.losses} (p = ${a.otherSign.hcVsGated.p.toFixed(3)}).`, '');
  L.push('| Defect (post hoc) | Incident | Failing | H-C k1 | H-N k1 | H-0 k1 |', '|---|---|---|---|---|---|');
  for (const d of a.defects) L.push(`| ${d.defect}${d.confirmed ? ' (root cause confirmed at $0)' : ''} | ${d.incident} | ${d.failing} | ${d.arms['H-C k1'].recovered}${d.arms['H-C k1'].fixed ? ' ✓' : ''} | ${d.arms['H-N k1'].recovered}${d.arms['H-N k1'].fixed ? ' ✓' : ''} | ${d.arms['H-0 k1'].recovered}${d.arms['H-0 k1'].fixed ? ' ✓' : ''} |`);
  const fixed = (arm, f = () => true) => a.defects.filter(f).filter(d => d.arms[arm].fixed).length;
  const ngl = d => !d.defect.startsWith('go-live');
  L.push(`| **defects fixed** | | ${a.defects.length} (${a.defects.filter(ngl).length} not go-live) | **${fixed('H-C k1')}** (${fixed('H-C k1', ngl)} not go-live) | **${fixed('H-N k1')}** (${fixed('H-N k1', ngl)}) | **${fixed('H-0 k1')}** (${fixed('H-0 k1', ngl)}) |`, '');
  L.push('#### M5: H2 where both arms had a session', '', `Incidents: ${a.h2.incidents.join(', ')}. H-C k1 > H-N k1 in ${a.h2.hcWins}, H-N > H-C in ${a.h2.hnWins}; exact sign test p = ${a.h2.p.toFixed(3)}.`,
    `H-N k1 vs H-0 k1 per incident: H-N ahead in ${a.nVs0.hnWins.length} (${a.nVs0.hnWins.join(', ') || '-'}), H-0 ahead in ${a.nVs0.h0Wins.length} (${a.nVs0.h0Wins.join(', ') || '-'}), ${a.nVs0.ties} ties.`, '');
  if (a.h1Cost) {
    L.push('#### M6: H1 cost conjunct with the verifier counted (Σ$ H-C k1 + contracts ≤ Σ E[$] regenerate)', '', '| Contracts cost | $ | H-C k1 + contracts | Regenerate | Conjunct | Per program |', '|---|---|---|---|---|---|');
    for (const [k, x] of Object.entries(a.h1Cost)) L.push(`| ${k} | ${x.verifierUsd.toFixed(2)} | ${x.hcTotal.toFixed(2)} | ${x.regenerate.toFixed(2)} | ${x.conjunctHolds ? 'holds' : 'fails'} | ${x.perProgram.toFixed(2)} |`);
    L.push('');
  }
  const bad = a.integrity.filter(x => !x.agrees || !x.keptRule);
  L.push(`#### m6: record integrity`, '', `${a.integrity.length} graded attempts re-compared from grading-after.json with missing cases counted: ${a.integrity.reduce((s, x) => s + x.missing, 0)} missing, ${a.integrity.reduce((s, x) => s + x.extra, 0)} extra; ${a.integrity.length - bad.length} of ${a.integrity.length} agree with their record and with the kept rule (rejected → net 0, accepted → kept = raw)${bad.length ? `; DISAGREE: ${bad.map(x => x.label).join(', ')}` : ''}.`);
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = analysis();
  console.log(tables(a));
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ at: new Date().toISOString(), note: 'post hoc (2026-11-04 review), $0, not frozen', ...a, defects: a.defects }, null, 1) + '\n');
}
