// Code mutants of app/core/run-graph.mjs: each is one plausible defect. The evaluation must "kill" each one (score it below the real
// module on at least one question); a mutant that survives means the oracle or the scenarios cannot see that defect.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, '../../core/run-graph.mjs');
export const MUTANTS = [
  ['m1-verify-disagreement-hidden', "inst.status === 'completed' && inst.verifyFalse ? 'checkdisagreed'\n  : ", ''],
  ['m2-no-stall-detection', "if (runStatus === 'running' && executing === false && WORKING_DETAILS.has(detail) && !STILL.has(detail)) return 'stalled';", ''],
  ['m3-cause-is-outermost', 'const leaves = failed.filter(f => !failed.some(g => g !== f && isAncestor(f, g)));', 'const leaves = failed.filter(f => !failed.some(g => g !== f && isAncestor(g, f)));'],
  ['m4-cost-own-key-only', "for (const [key, c] of index) if (key === self || key.startsWith(`${self}:`) || key.startsWith(`${self}/`)) addCost(out, c);", 'for (const [key, c] of index) if (key === self) addCost(out, c);'],
  ['m5-waiting-top-level-only', "const waiting = [...m.insts.values()].filter(i => ['awaiting_human', 'awaiting_approval'].includes(i.status) && !STOPPED.has(status))", "const waiting = [...m.insts.values()].filter(i => ['awaiting_human', 'awaiting_approval'].includes(i.status) && !STOPPED.has(status) && i.segs.length === 1)"],
  ['m11-stopped-run-keeps-waiting-steps', "  if (STOPPED.has(runStatus) && (detail === 'needsyou' || WORKING_DETAILS.has(detail))) return 'cancelled';\n", ''],
  ['m12-refusal-attribution-missing', "if (ev.type === 'approval.decided' && !ev.nodeKey && approvals.has(ev.approvalId))", 'if (false)'],
  ['m6-ready-while-executing-not-mapped', "if (status === 'ready' && executing === true) status = 'running';", ''],
  ['m7-cancelled-shown-as-problem', "idle: 'idle', skipped: 'idle', cancelled: 'idle',", "idle: 'idle', skipped: 'idle', cancelled: 'problem',"],
  ['m8-cancelled-siblings-count-as-cause', "!(i.status === 'failed' && C.classifyError(i.error?.code) === 'cancelled')", 'true'],
  ['m9-one-line-without-step', "const where = failing.label ? ` at “${failing.label}”` : '';", "const where = '';"],
  ['m10-waiting-after-the-end', "&& !STOPPED.has(status))\n    .map(i => ({ nodeKey: i.key, kind:", ")\n    .map(i => ({ nodeKey: i.key, kind:"]
];

// Mutants shown equivalent under the current runtime (they cannot change any answer), with the reason. Reported, not hidden.
export const EQUIVALENT = Object.freeze({
  'm8-cancelled-siblings-count-as-cause': 'A step stopped with CANCELLED always ends after the step whose failure stopped the run, and the cause is the earliest-ended leaf, so the filter never changes the answer (213 development runs, 0 differences).'
});

/** Write each mutant next to nothing in the repo (into `dir`), with its imports made absolute, and import it. */
export async function loadMutants(dir) {
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(SOURCE, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, (_, p) => `from '${pathToFileURL(path.resolve(path.dirname(SOURCE), p)).href}'`)
    .replace(/import '(\.\.?\/[^']+)'/g, (_, p) => `import '${pathToFileURL(path.resolve(path.dirname(SOURCE), p)).href}'`);
  const out = {};
  for (const [name, from, to] of MUTANTS) {
    if (!src.includes(from)) throw new Error(`mutant ${name}: its target text is not in run-graph.mjs (the module changed; update the mutant)`);
    const file = path.join(dir, `${name}.mjs`);
    writeFileSync(file, src.replace(from, to));
    out[name] = await import(pathToFileURL(file).href);
  }
  return out;
}
