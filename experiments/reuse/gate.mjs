// The applicability gate of a registry entry (research/reuse-20261021/PREREG-C2-1.md §2). Two checks, both generic (no
// rule names a supplier, a field or a drift), both built on the JIT input profiles (experiments/jit/profile.mjs, unchanged):
//
//   G2 input profile  (before the run, $0): the new task's inputs against the profile learned from the inputs the entry
//                      was proven on. Catches input drift (new id formats, text styles, missing fields).
//   G3 trace profile  (after the run, $0 for a code-only workflow, before its answer is used): what the run SAW and DID,
//                      as one JSON document (the tool results it received, the sections it ran in order, the flags it
//                      raised, the answer it gave), against the profile of the same documents from the proving runs.
//                      Catches environment drift the inputs cannot show (a scoring service that now answers on another
//                      scale, a new response field, an error the proof never met) and unproven branches (a section path
//                      or an answer the workflow never produced while it was being proven).
//
// G3 is only sound for workflows whose tool calls have no effects (here: read-only scoring lookups), because the run
// happens before the gate decides. For an effectful workflow G3 would need a dry-run world; that is out of scope here.
// Profiles see shape, not meaning: a supplier whose scores mean the opposite on the same scale passes both checks.
import { checkProfile, learnProfile, PARAMS_V2, TOLERANT_CHECK } from '../jit/profile.mjs';

export const GATE_VERSION = 'c2-gate/1';
/** Check options per gate (frozen in the preregistration; chosen on the dev set only). */
export const GATE_OPTIONS = Object.freeze({ input: TOLERANT_CHECK, trace: Object.freeze({ ignore: Object.freeze(['new-path']) }) });
/** The variants every item is gated with ($0, offline); the primary is GATE_OPTIONS. */
export const GATE_VARIANTS = Object.freeze({
  g2: { gate: 'input', opts: TOLERANT_CHECK },
  g2strict: { gate: 'input', opts: Object.freeze({}) },
  g3: { gate: 'trace', opts: GATE_OPTIONS.trace },
  g3strict: { gate: 'trace', opts: Object.freeze({}) },
});
/** PARAMS_V2: the slice-2 observations (needed by TOLERANT_CHECK's tolerant line formats); v1 observations unchanged. */
export const LEARN_PARAMS = PARAMS_V2;

export const inputDoc = task => ({ prompt: '', inputs: task.inputs ?? {} });

/** Parse a tool result text as the workflow sees it: JSON, or { error } for an "Error: ..." text. */
export function toolResultOf(content) {
  const text = String(content ?? '');
  if (text.startsWith('Error: ')) return { error: text.slice(7) };
  try { return JSON.parse(text); } catch { return { text }; }
}

/**
 * The trace document of one run: { tools: { <tool>: [result, ...] }, path: [section, ...], flags: [{ name, detail }],
 * answer, status }. calls: the host's call log ({ name, content }); events: the workflow's trace.jsonl events.
 */
export function traceDoc({ calls = [], events = [], answer = null, status = 'done' }) {
  const tools = {};
  for (const c of calls) {
    if (!c?.name) continue;
    (tools[c.name] ??= []).push(toolResultOf(c.content));
  }
  const path = events.filter(e => e.kind === 'phase-start').map(e => e.name);
  const flags = events.filter(e => e.kind === 'flag').map(e => ({ name: e.name, detail: e.detail ?? null }));
  return { prompt: '', inputs: { tools, path, flags, answer, status } };
}

export const learnInputProfile = tasks => learnProfile(tasks.map(inputDoc), LEARN_PARAMS);
export const learnTraceProfile = runs => learnProfile(runs.map(traceDoc), LEARN_PARAMS);

const verdict = r => ({ accept: !r.novel, score: r.score, reasons: (r.reasons ?? []).slice(0, 4).map(x => ({ path: x.path, feature: x.feature, ratio: x.ratio, detail: x.examples ?? x.unseen ?? x.observed ?? x.types ?? null })) });
export const gateInput = (profile, task, opts = GATE_OPTIONS.input) => verdict(checkProfile(profile, inputDoc(task), opts));
export const gateTrace = (profile, run, opts = GATE_OPTIONS.trace) => verdict(checkProfile(profile, traceDoc(run), opts));
/** Gate a stored trace document (offline re-gating of a recorded run). */
export const gateTraceDoc = (profile, doc, opts = GATE_OPTIONS.trace) => verdict(checkProfile(profile, doc, opts));
/** Every variant's verdict for one item: { g2, g2strict, g3, g3strict }. */
export function gateAll(profiles, task, doc) {
  const out = {};
  for (const [k, v] of Object.entries(GATE_VARIANTS)) out[k] = v.gate === 'input' ? verdict(checkProfile(profiles.input, inputDoc(task), v.opts)) : verdict(checkProfile(profiles.trace, doc, v.opts));
  return out;
}
