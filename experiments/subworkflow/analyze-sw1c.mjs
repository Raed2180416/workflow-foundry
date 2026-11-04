#!/usr/bin/env node
// SW-1c analysis (frozen with PREREG-SW-1c.md): arms x strata from results.jsonl files, every verdict re-derived from the
// stored answers and the bed. Per arm: backlog-node and task pass, $ per task and per passing backlog node, backlog paths,
// the node's decision on backlog nodes (deciding arms) with its "no code tool" reasons, gate retries (A0G), code-tool turns
// (A0C), returned requests (A2FC), quarantined proposals, and the independent audit (audit.mjs). Per preregistered pair:
// discordant backlog nodes, the exact McNemar p and the task-clustered sign-flip p (the decision statistic, defect 12).
//   node experiments/subworkflow/analyze-sw1c.mjs --results <file>[,<file>...] [--json out.json]
import { writeFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';
import { auditNode, lastCompleteRows } from './audit.mjs';
import { binom2, signFlip } from './stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const files = (args.results ?? '').split(',').filter(Boolean);
if (!files.length) { console.error('--results is required'); process.exit(2); }
export const PAIRS = {
  P: [['A1H', 'A1'], ['A1T', 'A2'], ['A1H', 'A2'], ['A0', 'A1'], ['A0', 'A1H'], ['A0', 'A1T'], ['A0', 'A2'], ['A0', 'A0G'], ['A0', 'A0C'], ['A0C', 'A1F'], ['A2FC', 'A1F'], ['A0', 'A1F']],
  B: [['A1FO', 'A1F'], ['A1H', 'A1FO'], ['A1H', 'A1F'], ['A0', 'A1FO'], ['A0', 'A1F'], ['A0', 'A1H']],
};
const r6 = x => Math.round(x * 1e6) / 1e6;
const rows = lastCompleteRows(files).map(r => {
  const t = bed.generate({ seed: r.seed, split: r.split, difficulty: r.difficulty });
  const nodes = r.nodes.map(n => ({ ...n, pass: n.answer ? bed.nodeOracle(t, n.channel, n.answer).pass : false, audit: auditNode(n) }));
  const answers = nodes.map(n => n.answer).filter(Boolean);
  const out = { channels: answers, group: { orders: answers.reduce((s, a) => s + a.totals.orders, 0), usd_cents: answers.reduce((s, a) => s + a.totals.usd_cents, 0) } };
  return { ...r, nodes, pass: bed.oracle(t, out).pass, stratum: r.difficulty >= 4 ? 'P' : 'B', key: `${r.split}:d${r.difficulty}:${r.seed}` };
});
const NO_TOOL = /code[- ]execution|no code (tool|runner)|no code can be run|code tools? available|code runner available|StructuredOutput|without a code (tool|step)/i;
const result = { files, strata: {} };
for (const s of ['P', 'B']) {
  const rs = rows.filter(r => r.stratum === s);
  if (!rs.length) continue;
  const arms = [...new Set(rs.map(r => r.arm))];
  const summary = arms.map(arm => {
    const a = rs.filter(r => r.arm === arm), nodes = a.flatMap(r => r.nodes), back = nodes.filter(n => n.kind === 'backlog');
    const cost = a.reduce((t, r) => t + r.costUsd, 0), backCost = back.reduce((t, n) => t + n.costUsd, 0), passBack = back.filter(n => n.pass).length;
    const count = f => Object.entries(back.reduce((m, n) => { const k = f(n); m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(', ');
    return { arm, tasks: a.length, taskPass: a.filter(r => r.pass).length, backlog: back.length, backlogPass: passBack, simplePass: `${nodes.filter(n => n.kind === 'simple' && n.pass).length}/${nodes.filter(n => n.kind === 'simple').length}`,
      perTask: r6(cost / a.length), perPassingBacklog: passBack ? r6(backCost / passBack) : null, paths: count(n => n.path ?? 'error'),
      decided: back.some(n => ['answer', 'subworkflow'].includes(n.decision)) ? { subworkflow: back.filter(n => n.decision === 'subworkflow').length, answered: back.filter(n => n.decision === 'answer').length,
        noToolReasons: back.filter(n => n.decision === 'answer' && NO_TOOL.test(n.reason ?? '')).length } : null,
      directedByTrigger: back.filter(n => n.directive === 'subworkflow').length, gateRetries: nodes.reduce((t, n) => t + Math.max(0, (n.gate?.length ?? 1) - 1), 0),
      toolTurns: nodes.reduce((t, n) => t + (n.tool?.length ?? 0), 0), returnedRequests: nodes.filter(n => n.returned).length,
      quarantinedProposals: nodes.reduce((t, n) => t + (n.proposals ?? []).filter(p => p.quarantined).length, 0), auditProblems: nodes.reduce((t, n) => t + n.audit.length, 0),
      maxNodeUsd: r6(Math.max(0, ...nodes.map(n => n.costUsd))) };
  });
  const pairs = PAIRS[s].filter(([a, b]) => arms.includes(a) && arms.includes(b)).map(([a, b]) => {
    const ra = new Map(rs.filter(r => r.arm === a).map(r => [r.key, r])), rb = new Map(rs.filter(r => r.arm === b).map(r => [r.key, r]));
    const keys = [...ra.keys()].filter(k => rb.has(k)); let onlyA = 0, onlyB = 0; const diffs = [];
    for (const k of keys) { let d = 0; for (const n of ra.get(k).nodes.filter(z => z.kind === 'backlog')) { const m = rb.get(k).nodes.find(z => z.channel === n.channel); if (n.pass && !m.pass) { onlyA++; d++; } if (!n.pass && m.pass) { onlyB++; d--; } } diffs.push(d); }
    return { a, b, tasks: keys.length, onlyA, onlyB, mcnemarP: r6(binom2(onlyA, onlyA + onlyB)), clusteredP: r6(signFlip(diffs).p) };
  });
  result.strata[s] = { arms: summary, pairs };
}
if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 1));
const md = [];
for (const [s, x] of Object.entries(result.strata)) {
  md.push(`\n### stratum ${s}\n`, '| arm | backlog pass | task pass | simple pass | $/task | $/passing backlog | backlog paths | decided: sub / answered (no-tool reasons) | gate retries | tool turns | returned requests | quarantined proposals | audit problems | max node $ |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of x.arms) md.push(`| ${a.arm} | ${a.backlogPass}/${a.backlog} | ${a.taskPass}/${a.tasks} | ${a.simplePass} | ${a.perTask} | ${a.perPassingBacklog ?? '-'} | ${a.paths} | ${a.decided ? `${a.decided.subworkflow} / ${a.decided.answered} (${a.decided.noToolReasons})` : '-'} | ${a.gateRetries} | ${a.toolTurns} | ${a.returnedRequests} | ${a.quarantinedProposals} | ${a.auditProblems} | ${a.maxNodeUsd} |`);
  md.push('', '| pair | tasks | discordant a / b | McNemar p (nodes) | sign-flip p (tasks; decision statistic) |', '|---|---|---|---|---|');
  for (const p of x.pairs) md.push(`| ${p.a} vs ${p.b} | ${p.tasks} | ${p.onlyA} / ${p.onlyB} | ${p.mcnemarP} | ${p.clusteredP} |`);
}
console.log(md.join('\n'));
