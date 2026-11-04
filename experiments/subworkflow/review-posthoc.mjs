#!/usr/bin/env node
// $0 post hoc analyses for the review of RESULT-SW-1 (analysis side; development evidence on eval-1's own data, never a
// new result). Every number is re-derived from the committed result rows, the bed and, where named, a local journal.
//   1. clustered tests (defect 12): per pair, the frozen McNemar p next to an exact sign-flip test with the task as the
//      unit (both backlog nodes of a task move together) and a task-level sign test;
//   2. gate probe (defect 5): of every one-pass backlog answer (A0, a deciding arm's direct answer, a fallback), how many
//      failing ones the code-owned contract gate would have flagged (only those could trigger an A0G retry), and how many
//      passing ones it would have flagged wrongly;
//   3. proposal provenance (defect 7): every "notCovered" proposal re-tagged with provenance.mjs; quarantined vs kept;
//   4. judge slips by node (defect 12): sub-workflow nodes with >= 1 wrong judge label (judge-audit-summary.json), template-
//      built vs free-form, one-sided Fisher at the node level (the row-level p = 0.023 treated clustered rows as independent);
//   5. the node's decision (defect 1/2): A0 vs the deciding arms, and how often each deciding arm chose a sub-workflow.
//   node experiments/subworkflow/review-posthoc.mjs --results <eval-1 results.jsonl>[,<sw1b results>] [--judge-audit <summary.json>] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';
import { gateProblems } from './bind.mjs';
import { compileDataSchema } from '../../src/validate.mjs';
import { provenanceOf } from './provenance.mjs';
import { lastCompleteRows } from './audit.mjs';
import { binom2, signFlip, fisherGreater } from './stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const files = (args.results ?? '').split(',').filter(Boolean);
if (!files.length) { console.error('--results is required'); process.exit(2); }
const rows = lastCompleteRows(files);
const r6 = x => Math.round(x * 1e6) / 1e6;
const taskOf = r => bed.generate({ seed: r.seed, split: r.split, difficulty: r.difficulty });
const enriched = rows.map(r => { const t = taskOf(r); return { ...r, t, key: `${r.layout ?? 'delimited'}:${r.split}:d${r.difficulty}:${r.seed}`, nodes: r.nodes.map(n => ({ ...n, pass: n.answer ? bed.nodeOracle(t, n.channel, n.answer).pass : false })) }; });
const out = {};

// 1. clustered tests
const PAIRS = [['A1F', 'A2F'], ['A1', 'A2'], ['A0', 'A1F'], ['A0', 'A2F'], ['A0', 'A1'], ['A0', 'A2'], ['A1TF', 'A2F'], ['A1TF', 'A1F'], ['A1', 'A1F'], ['A2', 'A2F']];
const STRATA = { P: [4, 5], d4: [4], d5: [5], d3: [3] };
out.clustered = {};
for (const [s, ds] of Object.entries(STRATA)) {
  out.clustered[s] = [];
  for (const [a, b] of PAIRS) {
    const ra = new Map(enriched.filter(r => r.arm === a && ds.includes(r.difficulty) && (r.layout ?? 'delimited') === 'delimited').map(r => [r.key, r]));
    const rb = new Map(enriched.filter(r => r.arm === b && ds.includes(r.difficulty) && (r.layout ?? 'delimited') === 'delimited').map(r => [r.key, r]));
    const keys = [...ra.keys()].filter(k => rb.has(k));
    if (!keys.length) continue;
    let onlyA = 0, onlyB = 0; const diffs = [];
    for (const k of keys) {
      const x = ra.get(k).nodes.filter(n => n.kind === 'backlog'), y = rb.get(k).nodes.filter(n => n.kind === 'backlog');
      let d = 0;
      for (const n of x) { const m = y.find(z => z.channel === n.channel); if (n.pass && !m.pass) { onlyA++; d++; } if (!n.pass && m.pass) { onlyB++; d--; } }
      diffs.push(d);
    }
    const sf = signFlip(diffs);
    out.clustered[s].push({ a, b, tasks: keys.length, passA: [...ra.values()].reduce((t, r) => t + r.nodes.filter(n => n.kind === 'backlog' && n.pass).length, 0),
      passB: [...rb.values()].reduce((t, r) => t + r.nodes.filter(n => n.kind === 'backlog' && n.pass).length, 0), onlyA, onlyB,
      mcnemarP: r6(binom2(onlyA, onlyA + onlyB)), clusteredP: r6(sf.p), tasksFavA: diffs.filter(d => d > 0).length, tasksFavB: diffs.filter(d => d < 0).length,
      taskSignP: r6(binom2(diffs.filter(d => d > 0).length, diffs.filter(d => d !== 0).length)) });
  }
}

// 2. gate probe on one-pass backlog answers
const validate = compileDataSchema(bed.nodeOutputSchema, { trustedSchema: true });
const shape = o => (validate(o) === true ? null : 'schema');
out.gateProbe = {};
for (const r of enriched) for (const n of r.nodes) {
  if (n.kind !== 'backlog' || !n.answer || !['direct', 'fallback'].includes(n.path)) continue;
  const c = r.t.inputs.channels.find(x => x.channel === n.channel);
  const flagged = gateProblems(n.answer, { channel: n.channel, exportText: c.export, validate: shape }).length > 0;
  const k = `${r.layout ?? 'delimited'} ${r.difficulty >= 4 ? 'P' : `d${r.difficulty}`}`;
  const cell = (out.gateProbe[k] ??= { oneShot: 0, failing: 0, failingFlagged: 0, passing: 0, passingFlagged: 0, byArm: {} });
  const arm = (cell.byArm[r.arm] ??= { failing: 0, flagged: 0 });
  cell.oneShot++;
  if (n.pass) { cell.passing++; if (flagged) cell.passingFlagged++; }
  else { cell.failing++; arm.failing++; if (flagged) { cell.failingFlagged++; arm.flagged++; } }
}

// 3. proposal provenance
out.provenance = {};
for (const r of enriched) for (const n of r.nodes) for (const p of n.proposals ?? []) {
  if (p.source !== 'notCovered') continue;
  const c = r.t.inputs.channels.find(x => x.channel === n.channel);
  const pv = provenanceOf(p.detail, { spec: r.t.inputs.spec, notes: c.notes, export: c.export });
  const a = (out.provenance[r.arm] ??= { notCovered: 0, export: 0, notes: 0, spec: 0, builder: 0, quarantined: 0, writeBackKept: 0, writeBackQuarantined: 0 });
  a.notCovered++; a[pv.origin]++; if (pv.quarantined) a.quarantined++;
  if (/writ\w* .*back|write-back/i.test(p.detail)) { if (pv.quarantined) a.writeBackQuarantined++; else a.writeBackKept++; }
}

// 4. judge slips at the node level (eval-1 only: the summary's rows carry the run id)
if (args['judge-audit']) {
  const ja = JSON.parse(readFileSync(args['judge-audit'], 'utf8'));
  const slipNodes = new Set(ja.rows_wrongOnly.map(x => `${x.run}|${x.node}`));
  const cell = { template: { nodes: 0, slip: 0 }, freeForm: { nodes: 0, slip: 0 } };
  for (const r of enriched.filter(x => (x.layout ?? 'delimited') === 'delimited' && x.runId?.includes(':eval-1:'))) for (const n of r.nodes) {
    if (!(n.specsRun ?? []).length) continue;
    const c = ['A1', 'A1F'].includes(r.arm) ? cell.freeForm : cell.template;
    c.nodes++; if (slipNodes.has(`${r.runId}|${n.channel}`)) c.slip++;
  }
  out.judgeSlipsByNode = { ...cell, fisherOneSided: r6(fisherGreater(cell.template.slip, cell.template.nodes - cell.template.slip, cell.freeForm.slip, cell.freeForm.nodes - cell.freeForm.slip)),
    note: 'node = a sub-workflow node whose spec ran; slip = >= 1 wrong judge label anywhere in its judge calls; template-built judges batch 15 rows, the free-form ones mostly 25 (confounded)' };
}

// 5. the node's decision
out.decisions = {};
for (const arm of ['A1', 'A2']) for (const r of enriched.filter(x => x.arm === arm && x.difficulty >= 4 && (x.layout ?? 'delimited') === 'delimited')) for (const n of r.nodes.filter(z => z.kind === 'backlog')) {
  const c = (out.decisions[arm] ??= { backlog: 0, chose: 0, chosePass: 0, answered: 0, answeredPass: 0, noToolReason: 0, noToolPass: 0, withoutCodeReason: 0, withoutCodePass: 0 });
  c.backlog++;
  if (n.decision === 'subworkflow') { c.chose++; c.chosePass += n.pass ? 1 : 0; continue; }
  c.answered++; c.answeredPass += n.pass ? 1 : 0;
  // "no code tool": the node says it has no code execution (the misread of the self-build offer); "without a code step":
  // it says it can do the job without one (the same frame: code is something it would run itself).
  if (/code[- ]execution|no code (tool|runner)|no code can be run|code tools? available|code runner available|StructuredOutput/i.test(n.reason ?? '')) { c.noToolReason++; c.noToolPass += n.pass ? 1 : 0; }
  else if (/without a code (tool|step)/i.test(n.reason ?? '')) { c.withoutCodeReason++; c.withoutCodePass += n.pass ? 1 : 0; }
}

if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
const md = [];
for (const [s, ps] of Object.entries(out.clustered)) {
  md.push(`\n### clustered tests, ${s}\n`, '| pair | pass a / b | discordant nodes a / b | McNemar p (nodes, frozen) | sign-flip p (task clusters) | tasks favouring a / b | sign p (tasks) |', '|---|---|---|---|---|---|---|');
  for (const p of ps) md.push(`| ${p.a} vs ${p.b} | ${p.passA} / ${p.passB} | ${p.onlyA} / ${p.onlyB} | ${p.mcnemarP} | ${p.clusteredP} | ${p.tasksFavA} / ${p.tasksFavB} | ${p.taskSignP} |`);
}
md.push('\n### gate probe (one-pass backlog answers)\n', '| cell | one-pass answers | failing | failing the gate flags | passing | passing the gate flags | by arm (flagged/failing) |', '|---|---|---|---|---|---|---|');
for (const [k, c] of Object.entries(out.gateProbe)) md.push(`| ${k} | ${c.oneShot} | ${c.failing} | ${c.failingFlagged} | ${c.passing} | ${c.passingFlagged} | ${Object.entries(c.byArm).map(([a, x]) => `${a} ${x.flagged}/${x.failing}`).join(', ')} |`);
md.push('\n### notCovered proposals by provenance\n', '| arm | notCovered | export (quarantined) | notes | spec | builder | write-back kept / quarantined |', '|---|---|---|---|---|---|---|');
for (const [a, c] of Object.entries(out.provenance)) md.push(`| ${a} | ${c.notCovered} | ${c.export} | ${c.notes} | ${c.spec} | ${c.builder} | ${c.writeBackKept} / ${c.writeBackQuarantined} |`);
if (out.judgeSlipsByNode) md.push(`\njudge slips by node: template-built ${out.judgeSlipsByNode.template.slip}/${out.judgeSlipsByNode.template.nodes}, free-form ${out.judgeSlipsByNode.freeForm.slip}/${out.judgeSlipsByNode.freeForm.nodes}, one-sided Fisher p = ${out.judgeSlipsByNode.fisherOneSided}`);
md.push('\n### decisions (P)\n', ...Object.entries(out.decisions).map(([a, c]) => `- ${a}: chose a sub-workflow on ${c.chose}/${c.backlog} backlog nodes (${c.chosePass} passed); answered ${c.answered} (${c.answeredPass} passed); reasons "no code tool" ${c.noToolReason} (${c.noToolPass} passed), "without a code tool/step" ${c.withoutCodeReason} (${c.withoutCodePass} passed)`));
console.log(md.join('\n'));
