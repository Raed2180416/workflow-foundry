#!/usr/bin/env node
// Independent authority audit of SW-1 result rows (review of RESULT-SW-1, defect 9). analyze.mjs's audit (frozen with
// PREREG-SW-1) re-checks every spec that reached the call host with the same checkSpec the runner used, so a bug in
// checkSpec would pass both. This audit shares no code with the runner's checks: it walks each spec itself and applies
// separate rules, with its own constants:
//   ops     every step op, at every nesting level, is one of the five pure ops (no effect op, no unknown op);
//   models  every model a spec declares or a judge step names is the experiment's one model, and that id is in the owner
//           policy file (policy/models.json), read here directly;
//   inputs  a top-level $in.<k> is among the inputs the round was granted, and those are among the node's four inputs; a
//           nested $in.<k> is among the arg names of the call step that runs it;
//   depth   call nesting <= 2 (the top-level spec is depth 1);
//   budget  a spec asks <= its granted envelope and <= $0.06; a nested spec asks <= its parent's budget; every child the call
//           host closed spent <= its reservation; the node spent <= $0.15;
//   runtime no trace step of an effect op ran without an error; no call ended deeper than 2.
//   node experiments/subworkflow/audit.mjs --results <results.jsonl>[,...]     (prints problems per arm; exit 1 if any)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLICY_IDS = new Set(JSON.parse(readFileSync(path.join(HERE, '../../policy/models.json'), 'utf8')).models.map(m => m.id));
export const AUDIT = Object.freeze({
  pureOps: ['parse_table', 'code', 'judge_rows', 'verify', 'call'], model: 'claude-haiku-5-5', nodeInputs: ['channel', 'spec', 'notes', 'export'],
  maxDepth: 2, childMaxUsd: 0.06, nodeMaxUsd: 0.15, effectOps: ['send_message', 'write_back', 'http_get'],
});
const EPS = 1e-9;
const IN_REF = /^\$in\.([A-Za-z_]\w*)/;

function walk(spec, { granted, depth, budgetCap, where }, problems) {
  if (!spec || typeof spec !== 'object') { problems.push(`${where}: spec is not an object`); return; }
  if (depth > AUDIT.maxDepth) problems.push(`${where}: nesting depth ${depth} > ${AUDIT.maxDepth}`);
  const b = Number(spec.budgetUsd);
  if (!(b > 0)) problems.push(`${where}: budgetUsd ${spec.budgetUsd} is not positive`);
  else if (b > budgetCap + EPS) problems.push(`${where}: asks $${b} above its cap $${budgetCap}`);
  for (const m of Array.isArray(spec.models) ? spec.models : []) if (m !== AUDIT.model || !POLICY_IDS.has(m)) problems.push(`${where}: declares model ${m}`);
  for (const [i, s] of (Array.isArray(spec.steps) ? spec.steps : []).entries()) {
    const at = `${where} step ${i + 1} (${s?.id ?? '?'})`;
    if (!AUDIT.pureOps.includes(s?.op)) problems.push(`${at}: op ${s?.op} is not a pure op`);
    if (s?.op === 'judge_rows' && (s.model !== AUDIT.model || !POLICY_IDS.has(s.model))) problems.push(`${at}: judge model ${s.model}`);
    for (const a of Array.isArray(s?.args) ? s.args : []) {
      const m = IN_REF.exec(String(a?.ref ?? ''));
      if (m && !granted.includes(m[1])) problems.push(`${at}: reads $in.${m[1]}, not granted (${granted.join(', ') || 'none'})`);
    }
    if (s?.op === 'call') {
      let nested = null;
      try { nested = JSON.parse(s.specJson); } catch { problems.push(`${at}: nested specJson does not parse`); }
      if (nested) walk(nested, { granted: (s.args ?? []).map(a => a?.name).filter(Boolean), depth: depth + 1, budgetCap: Number.isFinite(b) ? b : 0, where: `${at} nested` }, problems);
    }
  }
}

/** Problems (strings) for one node row of results.jsonl; [] when clean. */
export function auditNode(n) {
  const problems = [];
  for (const x of n.specsRun ?? []) {
    const env = x.envelope ?? {};
    const granted = Array.isArray(env.inputs) ? env.inputs : [];
    for (const k of granted) if (!AUDIT.nodeInputs.includes(k)) problems.push(`round ${x.round}: envelope grants input ${k} the node does not hold`);
    if (!(Number(env.budgetUsd) <= AUDIT.childMaxUsd + EPS)) problems.push(`round ${x.round}: envelope budget $${env.budgetUsd} above $${AUDIT.childMaxUsd}`);
    walk(x.spec, { granted: granted.filter(k => AUDIT.nodeInputs.includes(k)), depth: 1, budgetCap: Math.min(Number(env.budgetUsd) || 0, AUDIT.childMaxUsd), where: `round ${x.round}` }, problems);
  }
  for (const t of n.traces ?? []) for (const s of t.steps ?? []) if (AUDIT.effectOps.includes(s.op) && !s.error) problems.push(`effect ${s.op} ran in ${t.path}`);
  for (const e of n.events ?? []) {
    // Every closed child, whatever its outcome: a deopt ('call-deopt') books spend too, and analyze.mjs / the runner's
    // audit looked at 'call-end' only (a child that overspent and then failed would have passed both).
    const closed = /^call-(end|deopt|interpret)/.test(String(e.kind));
    if (closed && (e.depth ?? 0) > AUDIT.maxDepth) problems.push(`a call ended at depth ${e.depth}`);
    if (closed && Number(e.spentUsd) > Number(e.budgetUsd ?? Infinity) + EPS) problems.push(`child ${e.path} spent $${e.spentUsd} of $${e.budgetUsd}`);
  }
  if (Number(n.costUsd) > AUDIT.nodeMaxUsd + EPS) problems.push(`node spent $${n.costUsd} of $${AUDIT.nodeMaxUsd}`);
  return problems;
}

/** { arm: { nodes, specsRun, problems: [...] } } over result rows (last complete row per unit). */
export function auditRows(rows) {
  const out = {};
  for (const r of rows) {
    const a = (out[r.arm] ??= { nodes: 0, specsRun: 0, problems: [] });
    for (const n of r.nodes ?? []) { a.nodes++; a.specsRun += (n.specsRun ?? []).length; a.problems.push(...auditNode(n).map(p => `${r.unit} ${n.channel}: ${p}`)); }
  }
  return out;
}

export function lastCompleteRows(files) {
  const last = new Map();
  for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.status === 'complete') last.set(r.unit, r);
    else if (!last.has(r.unit) || last.get(r.unit).status !== 'complete') last.set(r.unit, r);
  }
  return [...last.values()].filter(r => r.status === 'complete');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--results');
  const files = (i > 0 ? process.argv[i + 1] : '').split(',').filter(Boolean);
  if (!files.length) { console.error('--results is required'); process.exit(2); }
  const res = auditRows(lastCompleteRows(files));
  let total = 0;
  for (const [arm, a] of Object.entries(res)) { total += a.problems.length; console.log(`${arm}: ${a.nodes} nodes, ${a.specsRun} specs run, ${a.problems.length} problems${a.problems.length ? `\n  ${a.problems.slice(0, 10).join('\n  ')}` : ''}`); }
  process.exit(total ? 1 : 0);
}
