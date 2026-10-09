// Tables, bootstrap CIs and the kill-rule verdict from out/rows.json. No model calls.
// usage: node --max-old-space-size=1024 analyze.mjs [rows.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { bootstrap } from './lib.mjs';

const inPath = process.argv[2] || new URL('./out/rows.json', import.meta.url).pathname;
const tag = process.argv[3] || '';
const { meta, rows } = JSON.parse(readFileSync(inPath, 'utf8'));
const DIFFS = meta.diffs;
const pct = x => (100 * x).toFixed(1);
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const get = (r, key) => key.startsWith('h') ? r.sweep[key] : r.res[key];
const rateCI = (rs, key) => {
  const v = rs.map(r => get(r, key).pass ? 1 : 0);
  const [lo, hi] = bootstrap(v.length, idx => mean(idx.map(i => v[i])));
  return { k: v.reduce((a, b) => a + b, 0), n: v.length, rate: mean(v), lo, hi };
};
const diffCI = (rs, k1, k0) => {
  const v = rs.map(r => (get(r, k1).pass ? 1 : 0) - (get(r, k0).pass ? 1 : 0));
  const [lo, hi] = bootstrap(v.length, idx => mean(idx.map(i => v[i])));
  return { d: mean(v), lo, hi, wins: v.filter(x => x > 0).length, losses: v.filter(x => x < 0).length };
};
const fmt = c => `${c.k}/${c.n} = ${pct(c.rate)}% [${pct(c.lo)}, ${pct(c.hi)}]`;
const fmtD = c => `${c.d >= 0 ? '+' : ''}${pct(c.d)} pts [${pct(c.lo)}, ${pct(c.hi)}] (+${c.wins}/-${c.losses})`;
const groups = [...DIFFS.map(d => ({ name: `d${d}`, rs: rows.filter(r => r.d === d) })), { name: 'd3-d5 pooled', rs: rows }];
const L = [];
const summary = { kill: {}, tables: {} };

const PROTO = [
  ['P0', 'P0 no fallback (controller only)'],
  ['P1', 'P1 whole-task restart, fresh env (counterfactual)'],
  ['P2', 'P2 restart, same env, residual ledger'],
  ['P3', 'P3 hold-and-resume at first refuted expectation (snapshot + mem)'],
  ['P4', 'P4 = P3 + nonblocking permissive (oracle reachability check)'],
  ['P4c', 'P4c = P3 + conservative permissive (veto every one-way / coupled action)'],
];
const key = (R, P) => P === 'P0' ? 'P0' : `${R}.${P}`;

for (const R of ['ii', 'i']) {
  const title = R === 'ii' ? 'Resumer (ii): explorer-from-current-state (oracle-side upper bound)' : 'Resumer (i): templateAwareAgent (white-box regex, amnesiac, env-driven)';
  L.push(`### ${title}`, '', 'Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).', '');
  L.push(`| protocol | ${groups.map(g => g.name).join(' | ')} |`, `|---|${groups.map(() => '---').join('|')}|`);
  for (const [P, label] of PROTO) {
    L.push(`| ${label} | ${groups.map(g => fmt(rateCI(g.rs, key(R, P)))).join(' | ')} |`);
    if (P !== 'P0') summary.tables[`${R}.${P}`] = Object.fromEntries(groups.map(g => [g.name, rateCI(g.rs, key(R, P))]));
  }
  if (R === 'ii') for (const [P, label] of [['P3lossy', 'P3-lossy: mem = visited rooms only'], ['P3amn', 'P3-amn: snapshot only, mem dropped']]) {
    L.push(`| ${label} | ${groups.map(g => fmt(rateCI(g.rs, `ii.${P}`))).join(' | ')} |`);
    summary.tables[`ii.${P}`] = Object.fromEntries(groups.map(g => [g.name, rateCI(g.rs, `ii.${P}`)]));
  }
  L.push('', `Paired differences against P2 (${R}), same tasks; (+wins/-losses) in tasks.`, '');
  L.push(`| contrast | ${groups.map(g => g.name).join(' | ')} |`, `|---|${groups.map(() => '---').join('|')}|`);
  const contrasts = R === 'ii' ? ['P3', 'P4', 'P4c', 'P3lossy', 'P3amn', 'P1'] : ['P3', 'P4', 'P4c', 'P1'];
  for (const P of contrasts) L.push(`| ${P} - P2 | ${groups.map(g => fmtD(diffCI(g.rs, `${R}.${P}`, `${R}.P2`))).join(' | ')} |`);
  L.push('');

  // cost columns
  L.push(`Cost per task (${R}); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.`, '');
  L.push('| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |', '|---|---|---|---|---|---|');
  const ks = ['P0', 'P1', 'P2', 'P3', 'P4', 'P4c'].map(P => key(R, P));
  for (const g of groups) for (const k of ks) {
    const v = g.rs.map(r => get(r, k)), pv = v.filter(x => x.pass);
    L.push(`| ${k} | ${g.name} | ${mean(v.map(x => x.steps)).toFixed(1)} | ${pv.length ? mean(pv.map(x => x.steps)).toFixed(1) : '-'} | ${mean(v.map(x => x.failures)).toFixed(1)} | ${mean(v.map(x => x.ms)).toFixed(2)} |`);
  }
  L.push('');
}

// kill rule (dossier: resumer ii, P3 and P4 vs P2, every level; task: best hold-and-resume vs P2)
L.push('### Kill rule (resumer (ii))', '', 'Kill if the best hold-and-resume protocol (max of P3, P4) is within 3 percentage points of P2.', '');
L.push('| group | P2 | P3 | P4 | best(P3,P4) - P2 | within 3 pts? | CI of (P3 - P2) | CI of (P4 - P2) |', '|---|---|---|---|---|---|---|---|');
let allWithin = true;
for (const g of groups) {
  const p2 = rateCI(g.rs, 'ii.P2'), p3 = rateCI(g.rs, 'ii.P3'), p4 = rateCI(g.rs, 'ii.P4');
  const best = Math.max(p3.rate, p4.rate) - p2.rate;
  const within = best <= 0.03 + 1e-9;
  if (g.name !== 'd3-d5 pooled' && !within) allWithin = false;
  summary.kill[g.name] = { p2: p2.rate, p3: p3.rate, p4: p4.rate, bestMinusP2: best, within3: within };
  L.push(`| ${g.name} | ${pct(p2.rate)}% | ${pct(p3.rate)}% | ${pct(p4.rate)}% | ${best >= 0 ? '+' : ''}${pct(best)} pts | ${within ? 'yes' : 'no'} | ${fmtD(diffCI(g.rs, 'ii.P3', 'ii.P2'))} | ${fmtD(diffCI(g.rs, 'ii.P4', 'ii.P2'))} |`);
}
summary.kill.everyLevelWithin3 = allWithin;
summary.kill.pooledWithin3 = summary.kill['d3-d5 pooled'].within3;
L.push('', `Per-level rule (dossier wording, "at every level"): ${allWithin ? 'KILL fires' : 'KILL does not fire'}. Pooled over d3-d5: ${summary.kill.pooledWithin3 ? 'KILL fires' : 'KILL does not fire'}.`, '');

// handoff timing and strandedness
L.push('### Where the handoff falls (controller = regexAgentV2)', '');
L.push('| group | controller wins | mean controller actions | median first refuted expectation (step) | mean B | mean optimal | median prefix / B | controller stranded itself (treasure unreachable at end) | P4 permissive vetoes earlier than refutation | median lead time P3 (last recoverable - handoff) | strands at handoff under P3 |', '|---|---|---|---|---|---|---|---|---|---|---|');
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
for (const g of groups) {
  const rs = g.rs, ho = rs.filter(r => !r.trig.none);
  const prefixes = ho.map(r => r.trig.P3);
  const lead = ho.map(r => r.ctrl.lastRec - r.trig.P3);
  L.push(`| ${g.name} | ${rs.filter(r => r.ctrl.won).length}/${rs.length} | ${mean(rs.map(r => r.ctrl.n)).toFixed(1)} | ${med(ho.filter(r => r.ctrl.firstBad !== null).map(r => r.ctrl.firstBad))} | ${mean(rs.map(r => r.B)).toFixed(1)} | ${mean(rs.map(r => r.optimal)).toFixed(1)} | ${(med(ho.map(r => r.trig.P3 / r.B))).toFixed(2)} | ${rs.filter(r => r.ctrl.stranded).length}/${rs.length} | ${ho.filter(r => r.trig.P4 < r.trig.P3).length}/${rs.length} (cons. ${ho.filter(r => r.trig.P4c < r.trig.P3).length}) | ${med(lead)} | ${lead.filter(x => x < 0).length}/${rs.length} |`);
}
L.push('');

// sweep
L.push('### Handoff-time sweep (hand off after h controller actions instead of at the first refutation)', '', 'Pass rate (levels/n) for P2 and P3 at each h; resumer (ii) then (i). Tasks the controller already won before h count as passes under both. "stranded" = treasure already unreachable at the handoff point.', '');
for (const R of ['ii', 'i']) {
  L.push(`Resumer (${R})`, '', `| h | ${groups.map(g => g.name + ' P2').join(' | ')} | ${groups.map(g => g.name + ' P3').join(' | ')} | P3 - P2, pooled | stranded at h (pooled) |`, `|---|${groups.map(() => '---|---').join('|')}|---|---|`);
  for (const h of meta.sweep) {
    const c2 = groups.map(g => rateCI(g.rs, `h${h}.${R}.P2`)), c3 = groups.map(g => rateCI(g.rs, `h${h}.${R}.P3`));
    const str = rows.filter(r => r.sweep[`h${h}.${R}.P3`].strandedAtHandoff).length;
    L.push(`| ${h} | ${c2.map(c => `${c.k}/${c.n}`).join(' | ')} | ${c3.map(c => `${c.k}/${c.n}`).join(' | ')} | ${fmtD(diffCI(rows, `h${h}.${R}.P3`, `h${h}.${R}.P2`))} | ${str}/${rows.length} |`);
  }
  L.push('');
}
summary.sweep = Object.fromEntries(meta.sweep.map(h => [h, { P2: rateCI(rows, `h${h}.ii.P2`), P3: rateCI(rows, `h${h}.ii.P3`) }]));

writeFileSync(new URL(`./out/tables${tag}.md`, import.meta.url).pathname, L.join('\n') + '\n');
writeFileSync(new URL(`./out/summary${tag}.json`, import.meta.url).pathname, JSON.stringify(summary, null, 1));
console.log(L.join('\n'));
