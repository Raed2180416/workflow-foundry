// FH-1 analysis ($0): the capability table of research/heal-20261021/PREREG-FH1.md §6 from the baseline gradings and the heal
// records. Never reads anything the arms could not have produced; the oracle is used here only to score.
//   node experiments/fh/analyse.mjs [--out research/heal-20261021/fh1/analysis.json]
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compare, ROOT } from './grade.mjs';
import { BUILDS } from './baseline.mjs';
import { INCIDENTS, ARMS, RUN_DIR, spent } from './heal.mjs';

const BASE = path.join(ROOT, 'research/heal-20261021/fh1/baseline');
const load = l => JSON.parse(readFileSync(path.join(BASE, `${l}.json`), 'utf8'));
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r3 = x => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

// Exact two-sided sign test (ties dropped).
export function signTest(wins, losses) {
  const n = wins + losses; if (!n) return 1;
  const k = Math.min(wins, losses); let p = 0;
  const C = (n, r) => { let c = 1; for (let i = 1; i <= r; i++) c = c * (n - r + i) / i; return c; };
  for (let i = 0; i <= k; i++) p += C(n, i);
  return Math.min(1, 2 * p / 2 ** n);
}

export function analyse() {
  const base = Object.fromEntries(Object.keys(BUILDS).filter(l => existsSync(path.join(BASE, `${l}.json`))).map(l => [l, load(l)]));
  const rows = [];
  for (const inc of INCIDENTS) {
    const b = base[inc]; if (!b) continue;
    const failing = b.grading.totals.oracleN - b.grading.totals.oraclePassed;
    // RETRY: the second execution of the unchanged program (baseline pass 2).
    const retry = { recovered: b.retry?.grading?.nRecovered ?? null, regressed: b.retry?.grading?.nRegressed ?? null, usd: 0, identical: b.retry?.identicalJournals ?? null };
    // REGENERATE: a fresh build of the same arm = each other recorded build of that arm (leave-one-out), scored case by case.
    const peers = Object.keys(BUILDS).filter(l => l !== inc && !BUILDS[l].prior && BUILDS[l].arm === BUILDS[inc].arm && base[l]);
    const regen = peers.map(p => ({ peer: p, ...(({ nRecovered, nRegressed, net }) => ({ nRecovered, nRegressed, net }))(compare(b.grading, base[p].grading)) }));
    const anyPeers = Object.keys(BUILDS).filter(l => l !== inc && !BUILDS[l].prior && base[l]);
    const regenAny = anyPeers.map(p => compare(b.grading, base[p].grading));
    const regenerate = { peers: regen, recovered: mean(regen.map(x => x.nRecovered)), regressed: mean(regen.map(x => x.nRegressed)), net: mean(regen.map(x => x.net)),
      usd: mean(peers.map(p => BUILDS[p].buildUsd)), pAllFixed: regen.length ? regen.filter(x => x.nRecovered === failing).length / regen.length : null,
      anyArm: { n: regenAny.length, recovered: mean(regenAny.map(x => x.nRecovered)), regressed: mean(regenAny.map(x => x.nRegressed)), net: mean(regenAny.map(x => x.net)) } };
    // HEAL arms: every record of every attempt.
    const heal = {};
    for (const arm of ARMS) {
      const recs = existsSync(RUN_DIR) ? readdirSync(RUN_DIR).filter(d => d.startsWith(`${inc}.${arm}.k`) && !d.endsWith('.dry') && existsSync(path.join(RUN_DIR, d, 'record.json')))
        .map(d => JSON.parse(readFileSync(path.join(RUN_DIR, d, 'record.json'), 'utf8'))).sort((a, b) => a.k - b.k) : [];
      if (!recs.length) continue;
      heal[arm] = recs.map(r => ({ k: r.k, usd: r.session.costUsd ?? r.session.costUpperUsd, accepted: r.gate.accept, gateReason: r.gate.reason,
        kept: r.grading.kept, raw: r.grading.raw, gates: Object.fromEntries(Object.entries(r.gates ?? {}).map(([a, g]) => [a, g.accept])), loads: r.loads, changed: r.changed,
        practice: r.practice, turns: r.session.turns, error: r.session.error?.code ?? null, noSignal: !!r.noSignal }));
    }
    rows.push({ incident: inc, arm: BUILDS[inc].arm, completed: b.grading.totals.oracleN, failing, retry, regenerate, heal });
  }
  // Pooled per arm (first attempt k = 1 is the primary; all attempts are reported).
  const pooled = {};
  const add = (name, recs) => { pooled[name] = { incidents: recs.length, recovered: recs.reduce((s, x) => s + (x.recovered ?? 0), 0), regressed: recs.reduce((s, x) => s + (x.regressed ?? 0), 0), usd: recs.reduce((s, x) => s + (x.usd ?? 0), 0) }; pooled[name].net = pooled[name].recovered - pooled[name].regressed; pooled[name].netPerUsd = pooled[name].usd ? r3(pooled[name].net / pooled[name].usd) : null; };
  add('retry', rows.map(r => r.retry));
  add('regenerate (expected, same arm)', rows.map(r => ({ recovered: r.regenerate.recovered, regressed: r.regenerate.regressed, usd: r.regenerate.usd })));
  for (const arm of ARMS) for (const k of [1, 2]) {
    const recs = rows.map(r => r.heal[arm]?.find(x => x.k === k)).filter(Boolean);
    if (recs.length) add(`${arm} k${k} (kept after gate)`, recs.map(x => ({ recovered: x.kept?.nRecovered ?? 0, regressed: x.kept?.nRegressed ?? 0, usd: x.usd })));
    if (recs.length) add(`${arm} k${k} (raw patch, no gate)`, recs.map(x => ({ recovered: x.raw?.nRecovered ?? 0, regressed: x.raw?.nRegressed ?? 0, usd: x.usd })));
  }
  // Gate precision: over every attempt that changed and loaded, each gate's decision against the grading truth
  // ("good" = the raw patch recovers at least one grading case and regresses none).
  const attempts = rows.flatMap(r => Object.values(r.heal).flat()).filter(x => x.changed && x.loads && x.raw);
  const gatePrecision = Object.fromEntries(ARMS.map(g => {
    const acc = attempts.filter(x => x.gates[g]), rej = attempts.filter(x => !x.gates[g]);
    const good = x => x.raw.nRecovered > 0 && x.raw.nRegressed === 0;
    return [g, { attempts: attempts.length, accepted: acc.length, acceptedGood: acc.filter(good).length, rejectedGood: rej.filter(good).length,
      precision: acc.length ? r3(acc.filter(good).length / acc.length) : null, recall: attempts.filter(good).length ? r3(acc.filter(good).length / attempts.filter(good).length) : null }];
  }));
  // Primary paired comparison (prereg §5): per incident, H-C k1 kept net vs regenerate expected net.
  const paired = rows.filter(r => r.heal['H-C']?.[0]).map(r => ({ incident: r.incident, hc: r.heal['H-C'][0].kept?.net ?? 0, regen: r.regenerate.net, hcUsd: r.heal['H-C'][0].usd, regenUsd: r.regenerate.usd }));
  const wins = paired.filter(p => p.hc > p.regen).length, losses = paired.filter(p => p.hc < p.regen).length;
  const pairedN = rows.filter(r => r.heal['H-C']?.[0] && r.heal['H-N']?.[0]).map(r => ({ incident: r.incident, hc: r.heal['H-C'][0].kept?.net ?? 0, hn: r.heal['H-N'][0].kept?.net ?? 0 }));
  return { rows, pooled, gatePrecision, primary: { paired, wins, losses, ties: paired.length - wins - losses, signTestP: r3(signTest(wins, losses)) },
    verifier: { paired: pairedN, wins: pairedN.filter(p => p.hc > p.hn).length, losses: pairedN.filter(p => p.hc < p.hn).length, signTestP: r3(signTest(pairedN.filter(p => p.hc > p.hn).length, pairedN.filter(p => p.hc < p.hn).length)) },
    spend: spent() };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const a = analyse();
  const out = arg('--out', path.join(ROOT, 'research/heal-20261021/fh1/analysis.json'));
  writeFileSync(out, JSON.stringify(a, null, 1));
  for (const r of a.rows) console.log(`${r.incident.padEnd(10)} failing ${String(r.failing).padStart(4)} | retry +${r.retry.recovered}/-${r.retry.regressed} | regen E[+${r3(r.regenerate.recovered)}/-${r3(r.regenerate.regressed)}] $${r3(r.regenerate.usd)} | ${Object.entries(r.heal).map(([arm, xs]) => `${arm} ${xs.map(x => `k${x.k}:${x.accepted ? 'A' : 'r'} +${x.kept?.nRecovered ?? 0}/-${x.kept?.nRegressed ?? 0} (raw +${x.raw?.nRecovered ?? '-'}/-${x.raw?.nRegressed ?? '-'}) $${r3(x.usd)}`).join(' ')}`).join(' | ')}`);
  console.log(JSON.stringify({ pooled: a.pooled, gatePrecision: a.gatePrecision, primary: a.primary, verifier: a.verifier, spend: a.spend }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
