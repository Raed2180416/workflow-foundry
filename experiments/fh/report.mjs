// FH-1 report tables ($0, written after the freeze; reads only what analyse.mjs computes from the records, never changes them):
// the per-incident capability table, the pooled table with the headline capability number, the decision rules of PREREG-FH1 §5
// applied mechanically, gate precision, per-class recoveries and the session log. Markdown on stdout.
//   node experiments/fh/report.mjs [--json research/heal-20261021/fh1/analysis.json]
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyse, signTest } from './analyse.mjs';
import { RUN_DIR, INCIDENTS } from './heal.mjs';

const r1 = x => (x === null || x === undefined ? '—' : Math.round(x * 10) / 10);
const usd = x => (x === null || x === undefined ? '—' : `$${x.toFixed(3)}`);
const TOTAL_FAILING = 475;

export function decisions(a) {
  const row = inc => a.rows.find(r => r.incident === inc);
  const hc = inc => row(inc)?.heal['H-C']?.find(x => x.k === 1);
  const hn = inc => row(inc)?.heal['H-N']?.find(x => x.k === 1);
  const net = x => x?.kept?.net ?? 0;
  const have = INCIDENTS.filter(i => hc(i));
  // H1: H-C vs regenerate
  const better = have.filter(i => net(hc(i)) > row(i).regenerate.net).length, worse = have.filter(i => net(hc(i)) < row(i).regenerate.net).length;
  const regHC = have.reduce((s, i) => s + (hc(i).kept?.nRegressed ?? 0), 0), regG = have.reduce((s, i) => s + row(i).regenerate.regressed, 0);
  const costHC = have.reduce((s, i) => s + (hc(i).usd ?? 0), 0), costG = have.reduce((s, i) => s + row(i).regenerate.usd, 0);
  const H1 = have.length < 8 ? `incomplete (${have.length}/8 incidents)` : (better >= 6 && regHC <= regG && costHC <= costG) ? 'supported (dev)' : (worse >= 5 || regHC > regG) ? 'refuted' : 'inconclusive';
  // H1b: H-C vs retry
  const keptRecover = have.filter(i => hc(i).accepted && (hc(i).kept?.nRecovered ?? 0) >= 1).length;
  const recHC = have.reduce((s, i) => s + (hc(i).kept?.nRecovered ?? 0), 0);
  const H1b = have.length < 8 ? `incomplete (${have.length}/8)` : (keptRecover >= 5 && regHC < recHC) ? 'supported (dev)' : 'not supported';
  // H2: H-C vs H-N, and go-live
  const both = INCIDENTS.filter(i => hc(i) && hn(i));
  const cWins = both.filter(i => net(hc(i)) > net(hn(i))).length, nWins = both.filter(i => net(hn(i)) >= net(hc(i))).length;
  const goLiveInc = INCIDENTS.filter(i => i !== 'b1lh-e8-3');
  const hnNoGoLive = goLiveInc.filter(i => hn(i)).filter(i => !Object.keys(hn(i).kept?.recoveredByClass ?? {}).some(k => k.startsWith('gl-'))).length;
  const H2 = both.length < 8 ? `incomplete (${both.length}/8)` : (cWins >= 5 && hnNoGoLive >= 6) ? 'supported (dev)' : (nWins >= 5) ? 'refuted' : 'inconclusive';
  return { H1: { verdict: H1, better, worse, ties: have.length - better - worse, regHC, regG, costHC, costG, signP: signTest(better, worse) },
    H1b: { verdict: H1b, keptRecover, recHC, regHC }, H2: { verdict: H2, cWins, nWins, hnNoGoLive, goLiveIncidents: goLiveInc.length, signP: signTest(cWins, both.filter(i => net(hn(i)) > net(hc(i))).length) } };
}

export function tables(a) {
  const out = [];
  const arms = ['H-C', 'H-N', 'H-0'];
  out.push('| Incident | Failing | Retry (R) | Regenerate (G): E[+/−], E[net], E[$] | ' + arms.map(x => `${x} k1: gate, kept +/− (net), raw +/−, $`).join(' | ') + ' |');
  out.push('|---|---|---|---|' + arms.map(() => '---').join('|') + '|');
  for (const r of a.rows) {
    const cell = arm => { const x = r.heal[arm]?.find(y => y.k === 1); if (!x) return 'not run';
      if (x.noSignal) return 'no signal: no session, net 0, $0';
      return `${x.accepted ? 'ACCEPT' : 'reject'}; +${x.kept?.nRecovered ?? 0}/−${x.kept?.nRegressed ?? 0} (**${x.kept?.net ?? 0}**); raw ${x.raw ? `+${x.raw.nRecovered}/−${x.raw.nRegressed}` : '—'}; ${usd(x.usd)}`; };
    out.push(`| ${r.incident} | ${r.failing} | +${r.retry.recovered}/−${r.retry.regressed} ($0) | +${r1(r.regenerate.recovered)}/−${r1(r.regenerate.regressed)}, **${r1(r.regenerate.net)}**, ${usd(r.regenerate.usd)} | ${arms.map(cell).join(' | ')} |`);
  }
  out.push('');
  out.push('| Arm | Incidents | Recovered | Regressed | Net | Net ÷ 475 failing | Incidents at 1,022/1,022 | $ | $ per net case |', '|---|---|---|---|---|---|---|---|---|');
  const full = (arm, k, raw = false) => a.rows.filter(r => { const x = r.heal[arm]?.find(y => y.k === k); const c = raw ? x?.raw : x?.kept; return x && c && c.nRecovered === r.failing && c.nRegressed === 0; }).length;
  for (const [name, p] of Object.entries(a.pooled)) {
    const m = name.match(/^(H-[CN0]) k(\d) \((kept|raw)/);
    const nfull = name === 'retry' ? 0 : name.startsWith('regenerate') ? '— (expected)' : m ? full(m[1], Number(m[2]), m[3] === 'raw') : '—';
    out.push(`| ${name} | ${p.incidents} | ${r1(p.recovered)} | ${r1(p.regressed)} | **${r1(p.net)}** | ${(p.net / TOTAL_FAILING * 100).toFixed(1)}% | ${nfull} | ${usd(p.usd)} | ${p.net > 0 ? usd(p.usd / p.net) : '—'} |`);
  }
  out.push('');
  out.push('| Gate | Attempts (changed, loads) | Accepted | Accepted and good | Rejected but good | Precision | Recall |', '|---|---|---|---|---|---|---|');
  for (const [g, x] of Object.entries(a.gatePrecision)) out.push(`| ${g} | ${x.attempts} | ${x.accepted} | ${x.acceptedGood} | ${x.rejectedGood} | ${x.precision ?? '—'} | ${x.recall ?? '—'} |`);
  return out.join('\n');
}

export function sessionLog() {
  if (!existsSync(RUN_DIR)) return '';
  const out = ['| Attempt | Turns | $ | Session min | Smoke runs | Error | Changed | Loads | Module tests | Practice contracts before → after | N-version disagreements before → after | Gate |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const d of readdirSync(RUN_DIR).filter(d => !d.endsWith('.dry')).sort()) {
    const f = path.join(RUN_DIR, d, 'record.json');
    const faults = readdirSync(path.join(RUN_DIR, d)).filter(x => /^envfault-\d+\.json$/.test(x));
    if (!existsSync(f)) { out.push(`| ${d} | — | — | — | — | ${faults.length ? `environment fault ×${faults.length}` : 'no record'} | | | | | | |`); continue; }
    const r = JSON.parse(readFileSync(f, 'utf8'));
    const s = r.session, p = r.practice;
    const mt = r.moduleTests ? (r.moduleTests.error ? `error` : `${r.moduleTests.pass ?? '?'}${r.moduleTests.fail ? ` (${r.moduleTests.fail} fail)` : ''}`) : '—';
    out.push(`| ${d} | ${s.turns ?? '—'} | ${usd(s.costUsd ?? s.costUpperUsd)} | ${s.durationMs ? (s.durationMs / 60000).toFixed(1) : '—'} | ${s.smokeRuns ?? 0} | ${s.error?.code ?? (faults.length ? `(${faults.length} env fault before)` : '—')} | ${r.changed} | ${r.loads} | ${mt} | ${p.before ? `${p.before.contractsPassed}/${p.before.contractsN}` : '—'} → ${p.after ? `${p.after.contractsPassed}/${p.after.contractsN}` : '—'} | ${p.nvBefore ?? '—'} → ${p.nvAfter ?? '—'} | ${r.gate.accept ? 'ACCEPT' : 'reject'}: ${r.gate.reason} |`);
  }
  return out.join('\n');
}

/** Detection versus recovery per incident and failure class: did the verifier see the class on the practice worlds, and did the
 * arm's kept program recover it on the grading worlds? (The test of "verification precision is the bottleneck" at class level.) */
export function classTable() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const ver = JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/verifiers.json'), 'utf8')).perBuild;
  const rec = (inc, arm) => { const f = path.join(RUN_DIR, `${inc}.${arm}.k1`, 'record.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const out = ['| Incident | Failure class | Failing (grading) | Contracts see it (practice) | H-C k1 kept | N-version sees it (practice) | H-N k1 kept | H-0 k1 kept |', '|---|---|---|---|---|---|---|---|'];
  const tot = { n: 0, cSee: 0, hc: 0, nSee: 0, hn: 0, h0: 0, nClasses: 0, cSeeClasses: 0, nSeeClasses: 0, hcClasses: 0, hnClasses: 0, h0Classes: 0 };
  for (const inc of INCIDENTS) {
    const base = JSON.parse(readFileSync(path.join(ROOT, 'research/heal-20261021/fh1/baseline', `${inc}.json`), 'utf8'));
    const byClass = {};
    for (const w of base.grading.worlds) for (const c of w.cases) if (c.oracle === false) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
    const pv = ver[inc]?.byClass ?? {};
    const kept = arm => rec(inc, arm)?.grading?.kept?.recoveredByClass ?? null;
    const [hc, hn, h0] = ['H-C', 'H-N', 'H-0'].map(kept);
    for (const [cls, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
      const p = pv[cls];
      const see = k => (p ? `${p[k]}/${p.failing}` : '0 on practice');
      const got = x => (x === null ? 'not run' : `${x[cls] ?? 0}/${n}`);
      out.push(`| ${inc} | ${cls} | ${n} | ${see('contracts')} | ${got(hc)} | ${see('nversion')} | ${got(hn)} | ${got(h0)} |`);
      tot.n += n; tot.nClasses += 1;
      if (p?.contracts) { tot.cSee += n; tot.cSeeClasses += 1; }
      if (p?.nversion) { tot.nSee += n; tot.nSeeClasses += 1; }
      tot.hc += hc?.[cls] ?? 0; tot.hn += hn?.[cls] ?? 0; tot.h0 += h0?.[cls] ?? 0;
      if (hc?.[cls]) tot.hcClasses += 1; if (hn?.[cls]) tot.hnClasses += 1; if (h0?.[cls]) tot.h0Classes += 1;
    }
  }
  out.push(`| **all** | ${tot.nClasses} classes | **${tot.n}** | ${tot.cSeeClasses} classes (${tot.cSee} cases) | **${tot.hc}** (${tot.hcClasses} classes) | ${tot.nSeeClasses} classes (${tot.nSee} cases) | **${tot.hn}** (${tot.hnClasses} classes) | **${tot.h0}** (${tot.h0Classes} classes) |`);
  return out.join('\n');
}

/** H-C k1 versus its k2 replication, per incident where both ran (secondary measure of PREREG-FH1 §4). */
export function replicationTable() {
  const rec = (inc, k) => { const f = path.join(RUN_DIR, `${inc}.H-C.k${k}`, 'record.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const out = ['| Incident | k1: practice contracts after, kept net, $ | k2: practice contracts after, kept net, $ | Same outcome |', '|---|---|---|---|'];
  for (const inc of INCIDENTS) {
    const [a, b] = [rec(inc, 1), rec(inc, 2)];
    if (!a || !b) continue;
    const cell = r => `${r.practice.after ? `${r.practice.after.contractsPassed}/${r.practice.after.contractsN}` : '—'}, **${r.grading.kept.net}**, ${usd(r.session.costUsd)}`;
    out.push(`| ${inc} | ${cell(a)} | ${cell(b)} | ${a.grading.kept.net === b.grading.kept.net ? 'yes' : 'no'} |`);
  }
  return out.join('\n');
}

/** POST HOC (not a frozen rule; selection uses the practice verifier only, never grading): "heal until the verifier is clean, at most
 * two fresh sessions". Per incident: H-C k1; if its kept program still fails a contract on the practice worlds and a k2 session was
 * recorded, the policy also runs k2 and keeps whichever kept program passes more practice contracts (k1 on a tie). */
export function untilCleanPolicy() {
  const rec = (inc, k) => { const f = path.join(RUN_DIR, `${inc}.H-C.k${k}`, 'record.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const out = ['| Incident | k1 practice contracts after | Policy runs k2? | Kept | Net | Sessions | $ |', '|---|---|---|---|---|---|---|'];
  let net = 0, usdSum = 0, sessions = 0, full = 0, missing = 0;
  for (const inc of INCIDENTS) {
    const a = rec(inc, 1);
    if (!a) { out.push(`| ${inc} | k1 not run | | | | | |`); continue; }
    const after = r => (r.gate.accept && r.practice.after ? r.practice.after.contractsPassed : r.practice.before.contractsPassed);
    const clean = after(a) === a.practice.before.contractsN;
    const b = clean ? null : rec(inc, 2);
    const pick = b && after(b) > after(a) ? b : a;
    const n = pick.grading.kept.net, cost = (a.session.costUsd ?? 0) + (b ? b.session.costUsd ?? 0 : 0);
    if (!clean && !b) missing += 1;
    net += n; usdSum += cost; sessions += b ? 2 : 1; if (pick.grading.kept.nRecovered === pick.grading.kept.net && pick.grading.rawAfter && pick.gate.accept && pick.grading.rawAfter.oraclePassed === pick.grading.rawAfter.oracleN) full += 1;
    out.push(`| ${inc} | ${after(a)}/${a.practice.before.contractsN} | ${clean ? 'no (clean)' : b ? 'yes' : 'yes, but k2 not recorded'} | k${pick.k} | **${n}** | ${b ? 2 : 1} | ${usd(cost)} |`);
  }
  out.push(`| **all** | | | | **${net}** (${(net / TOTAL_FAILING * 100).toFixed(1)}% of ${TOTAL_FAILING}) | ${sessions} | ${usd(usdSum)} |`);
  out.push('', `Incidents brought to 1,022/1,022: ${full} of ${INCIDENTS.length}${missing ? `; ${missing} incident(s) needed a k2 that was not recorded` : ''}.`);
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = analyse();
  console.log(tables(a));
  console.log('');
  console.log(replicationTable());
  console.log('');
  console.log(untilCleanPolicy());
  console.log('');
  console.log(classTable());
  console.log('');
  console.log('```json');
  console.log(JSON.stringify(decisions(a), null, 1));
  console.log('```');
  console.log('');
  console.log(sessionLog());
}
