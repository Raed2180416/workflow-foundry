#!/usr/bin/env node
// Markdown tables from a C2 summary (analyze.mjs) and the post-hoc file, for RESULT-C2-1.md.
//   node experiments/reuse/report.mjs --run-id c2-1 --set test
import { existsSync } from 'node:fs';
import path from 'node:path';
import { RESEARCH, readJson } from './lib.mjs';
import { SOURCES } from './program-b.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]]] : acc), []));
const dir = path.join(RESEARCH, 'runs', a['run-id']);
const s = readJson(path.join(dir, `summary-${a.set}.json`));
const ph = existsSync(path.join(dir, `posthoc-${a.set}.json`)) ? readJson(path.join(dir, `posthoc-${a.set}.json`)) : null;
const p = x => (x === null || x === undefined ? '–' : `${(100 * x).toFixed(1)}%`);
const d = x => (x === null || x === undefined ? '–' : `$${x.toFixed(4)}`);
const sec = ms => (ms === null || ms === undefined ? '–' : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const L = [];
L.push(`### Arms (${s.items} items, ${s.shipments} shipments; lineages ${s.completeLineages.join(', ') || 'none'}; agent reps ${s.completeKs.join(', ') || 'none'})`, '');
L.push('| Arm | Item acc | Pinned acc | Ship acc | Wrong bookings | Holds | Reuse | Wrong reuse | Deopt | False deopt | Builds paid | USD total | USD/item | Mean ms/item (no builds) | Mean/item incl. builds |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const m of s.metrics) L.push(`| ${m.arm} | ${m.correct}/${m.items} = ${p(m.itemAcc)} | ${p(m.itemAccPinned)} | ${p(m.shipAcc)} | ${m.wrongBookings} | ${m.holds} | ${m.reuseRate === undefined ? '–' : p(m.reuseRate)} | ${m.wrongReuse === undefined ? '–' : `${m.wrongReuse} (${p(m.wrongReuseRate)})`} | ${m.deoptRate === undefined ? '–' : p(m.deoptRate)} | ${m.falseDeopt === undefined ? '–' : `${m.falseDeopt} (${p(m.falseDeoptRate)})`} | ${m.buildsPaid} | ${d(m.totalUsd)} | ${d(m.usdPerItem)} | ${sec(m.meanItemMs)} | ${sec(m.meanItemMsWithBuilds)} |`);
L.push('', '### Projected cost and time per item at N items per supplier (projection from measured unit costs)', '');
L.push('| Arm | N=20 USD | N=100 USD | N=1000 USD | N=20 time | N=100 time | N=1000 time |', '|---|---|---|---|---|---|---|');
for (const m of s.metrics.filter(m => !/b0|b1|b2|oracle|sticky/.test(m.arm))) L.push(`| ${m.arm} | ${d(m.projected[20].usdPerItem)} | ${d(m.projected[100].usdPerItem)} | ${d(m.projected[1000].usdPerItem)} | ${sec(m.projected[20].msPerItem)} | ${sec(m.projected[100].msPerItem)} | ${sec(m.projected[1000].msPerItem)} |`);
L.push('', '### Per supplier: items correct (REUSE route reuse/deopt; wrong reuse)', '');
const arms = s.metrics.filter(m => /^(REUSE|SCRATCH|AGENT)@/.test(m.arm));
L.push(`| Supplier | Kind | ${arms.map(m => m.arm).join(' | ')} |`, `|---|---|${arms.map(() => '---').join('|')}|`);
for (const src of s.sources) L.push(`| ${src} | ${SOURCES[src].label} | ${arms.map(m => { const b = m.bySource[src]; return b ? `${b.correct}/${b.items}${b.reused !== undefined ? ` (r${b.reused}${b.wrongReuse ? `, w${b.wrongReuse}` : ''})` : ''}` : '–'; }).join(' | ')} |`);
L.push('', '### Gate view on the proven entry (all items, $0)', '');
L.push('| Gate | Accepted | Wrong accepted | Wrong-reuse rate | Deopt | False deopt | Catch rate | dev-known: acc / wrong / false deopt | held-out: acc / wrong / false deopt |', '|---|---|---|---|---|---|---|---|---|');
for (const [g, v] of Object.entries(s.gateView)) L.push(`| ${g}${g === s.primaryGate ? ' (primary)' : ''} | ${v.accepted} | ${v.wrongReuse} | ${p(v.wrongReuseRate)} | ${v.deopt} | ${v.falseDeopt} | ${p(v.catchRate)} | ${v.devKnown.accepted} / ${v.devKnown.wrongAccepted} / ${v.devKnown.falseDeopt} | ${v.heldOut.accepted} / ${v.heldOut.wrongAccepted} / ${v.heldOut.falseDeopt} |`);
if (s.m3) {
  L.push('', `### M3 rule on the primary gate's ${s.m3.admitted} admitted decisions (${s.m3.wrong} wrong)`, '');
  L.push(`- parent-clustered exact (aE): **${s.m3.parentExact.decision}**, upper ${s.m3.parentExact.upper.toFixed(3)}, n_eff ${s.m3.parentExact.nEff.toFixed(1)}, Deff ${s.m3.parentExact.deff.toFixed(2)}`);
  L.push(`- parent × entry crossed exact (M3b): **${s.m3.crossedExact.decision}**, upper ${s.m3.crossedExact.upper.toFixed(3)}, n_eff ${s.m3.crossedExact.nEff.toFixed(1)}, Deff ${s.m3.crossedExact.deff.toFixed(2)}, entries ${s.m3.crossedExact.entries}`);
}
L.push('', '### Paired differences in item accuracy (shipment-cluster bootstrap, 95%)', '', '| A − B | point | 95% interval |', '|---|---|---|');
for (const c of s.comparisons) L.push(`| ${c.a} − ${c.b} | ${(100 * c.point).toFixed(1)} pts | [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}] |`);
L.push('', '### Builds', '', '| Build | USD | Wall | Rounds | Best round | Labelled pass | Judge calls/run |', '|---|---|---|---|---|---|---|');
for (const b of s.builds) L.push(`| ${b.label} | ${d(b.costUsd)} | ${b.wallMin ?? '–'} min | ${b.rounds} | ${b.bestRound ?? '–'} | ${b.devPass}/${b.devRows ?? 15}${b.failedBuild ? ' (failed)' : ''}${b.envFault ? ` (env ${b.envFault})` : ''} | ${b.judgeCallsPerRun ?? '–'} |`);
if (ph) {
  L.push('', '### POST-HOC (not preregistered): consumer conformance on B\'s labelled history before reuse', '');
  L.push(`Per supplier, the proven entry on its 15 labelled products: ${Object.entries(ph.perSource).map(([k, v]) => `${k} ${v.pass}/${v.of}`).join(', ')}.`, '');
  L.push('| Gate | Accepted | Wrong accepted | False deopt | Catch rate | M3 parent (aE) | M3 crossed (M3b) |', '|---|---|---|---|---|---|---|');
  for (const [g, v] of Object.entries(ph.view)) L.push(`| ${g} | ${v.accepted} | ${v.wrongReuse} | ${v.falseDeopt} | ${p(v.catchRate)} | ${v.m3?.parentExact.decision} (${v.m3?.parentExact.upper.toFixed(3)}) | ${v.m3?.crossedExact.decision} (${v.m3?.crossedExact.upper.toFixed(3)}) |`);
}
L.push('', `Spend: builds ${d(s.spend.buildsUsd)}, agent ${d(s.spend.agentUsd)} over ${s.spend.agentItems} sessions (${s.spend.agentSessionErrors} session errors, ${s.spend.agentNoAnswer} without an answer, ${s.spend.agentViolations} with audit flags).`);
console.log(L.join('\n'));
