// Port kits for group failures-code (JUDGE-PROGRAM.md §1.2 group F, X1/X6/Q6 codefix families, §8.4 W2).
// RELOCATED from src/judges/failures.mjs until the frozen C0 and P1 experiments finish (any file added under src/
// changes their construction-kit hash); it moves to src/judges/ afterwards, unchanged.
//
// Two kits, both pure and importing no bed (the runtime has no frozen copy of the beds):
//
//   kit        bed `failures`: F1 failure_class. A "task" is the failure descriptor a healer holds when it asks, built from
//              the journal of the failed run and of the earlier runs of the same node:
//                { node: { kind, attempts, error: { code, message } },
//                  events?:    [{ type, node, kind?, code? }]   the last journal events up to the failure
//                  priorRuns:  [{ ok, code? }]                  earlier journaled runs of the same node, oldest first
//                  envDiff?:   ['service api: up -> down', ...] the environment-fingerprint diff taken before the failure }
//              State: { node_kind, attempt, error_code, message, prior_runs: { passes, failures, distinct_error_codes },
//              [last_events], [env_diff] } (the last two only when the descriptor carries them: the exec-injected family).
//              A descriptor that carries the outcome of a check the port is meant to order (a replay, a resample, a
//              control-build run, a fingerprint verdict, a "history" string) is refused (F1_CHECK_OUTCOME): time-of-decision
//              provenance (§1.0, crit S8) is enforced here, once, for the factory and the runtime.
//
//   codefixKit bed `codefix`: X1, X6, Q6, F2 states from a codefix task ({ inputs: { source, bug_report, design_notes,
//              service_log, changelog } }), with the parsers the codefix tap (taps/codefix.mjs) labels spans with:
//                X1  { source_kind, text }                    slots: { span: 'thread:N' | 'log:N' | 'code:N' }
//                X6  { report, known_reports, build_info }    slots: { span: 'thread:N' }
//                Q6  { spec_excerpt, behaviour }              slots: { span: 'thread:N', section: N }
//                F2  { bug_report, module_outline }           slots: { span: 'thread:N' | 'all' }
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

const { contracts: ALL } = loadSpec();
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// ---- F1 -------------------------------------------------------------------------------------------------------------------
export const F1_OPTIONS = Object.freeze(['flake', 'variance', 'defect', 'env', 'impossible', 'finding']);
// Decided by code before F1 is asked (JUDGE-PROGRAM.md §1.2 F1 "Taxonomy"): schema-invalid, truncated or refused model
// output (D:B1 retry on schema failure, D:C7 provider error class) and the runtime's budget stops. They are never F1 rows.
export const MODEL_OUTPUT_CODES = Object.freeze(['MODEL_SCHEMA', 'MODEL_TRUNCATED', 'MODEL_REFUSAL', 'MODEL_PROTOCOL', 'MODEL_ESCALATION_EXHAUSTED']);
export const BUDGET_CODES = Object.freeze(['COST_BUDGET', 'STEP_BUDGET', 'STATE_BUDGET', 'DEADLINE', 'MODEL_BUDGET', 'RESUME_BUDGET', 'RETRY_EXHAUSTED', 'LOOP_EXHAUSTED', 'MAP_BOUND']);
export function routeByCode(code) {
  if (MODEL_OUTPUT_CODES.includes(code)) return 'model_output';
  if (BUDGET_CODES.includes(code)) return 'budget';
  return null;
}

export const F1_STATE_KEYS = Object.freeze(['node_kind', 'attempt', 'error_code', 'message', 'prior_runs', 'last_events', 'env_diff']);
export const F1_DESCRIPTOR_KEYS = Object.freeze(['node', 'events', 'priorRuns', 'envDiff']);
export const MAX_MESSAGE_CHARS = 1200;
export const MAX_EVENTS = 5;
// names of things a healer's checks produce; none of them may appear in a descriptor (any depth, any case)
const CHECK_OUTCOME_KEY = /replay|resampl|control|known_?good|fingerprint_?(verdict|result)|flip|wilson|rerun|history|retry_?result|passed_?on/i;

function scanKeys(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    if (typeof k === 'string' && CHECK_OUTCOME_KEY.test(k)) throw fail('F1_CHECK_OUTCOME', `${path}${k}: a failure descriptor carries no check outcome (replay, resample, control build, history)`);
    scanKeys(v, `${path}${k}.`);
  }
}
export function priorRunsOf(runs) {
  if (!Array.isArray(runs)) throw fail('F1_DESCRIPTOR', 'priorRuns is a list of earlier runs of the same node');
  const failures = runs.filter(r => r && r.ok === false);
  return { passes: runs.filter(r => r && r.ok === true).length, failures: failures.length, distinct_error_codes: new Set(failures.map(r => r.code ?? 'ERROR')).size };
}
export function renderEvent(e) {
  if (!e || typeof e.type !== 'string') throw fail('F1_DESCRIPTOR', 'an event has a type');
  return `${e.type}${e.node ? ` ${e.node}` : ''}${e.kind ? ` (${e.kind})` : ''}${e.code ? ` [${e.code}]` : ''}`;
}
// the last events up to the failure, consecutive repeats of one event collapsed
export function lastEvents(events, n = MAX_EVENTS) {
  const out = [];
  for (const line of (events ?? []).map(renderEvent)) if (out.at(-1) !== line) out.push(line);
  return out.slice(-n);
}
export function f1State(failure) {
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) throw fail('F1_DESCRIPTOR', 'a failure descriptor is an object');
  const extra = Object.keys(failure).filter(k => !F1_DESCRIPTOR_KEYS.includes(k));
  if (extra.length) throw fail('F1_DESCRIPTOR', `unexpected descriptor field(s) ${extra.join(', ')}`);
  scanKeys(failure);
  const n = failure.node;
  if (!n || typeof n.kind !== 'string' || !Number.isInteger(n.attempts) || n.attempts < 0 || typeof n.error?.code !== 'string' || typeof n.error?.message !== 'string') throw fail('F1_DESCRIPTOR', 'node needs kind, attempts and error {code, message}');
  const state = { node_kind: n.kind, attempt: n.attempts, error_code: n.error.code, message: n.error.message.length > MAX_MESSAGE_CHARS ? `${n.error.message.slice(0, MAX_MESSAGE_CHARS - 3)}...` : n.error.message,
    prior_runs: priorRunsOf(failure.priorRuns ?? []) };
  if (failure.events !== undefined) state.last_events = lastEvents(failure.events);
  if (failure.envDiff !== undefined) state.env_diff = failure.envDiff.map(String);
  return state;
}
export const kit = definePortKit({ bed: 'failures', contracts: { F1: ALL.F1 }, buildState: (task, slots) => f1State(task, slots) });

// ---- codefix --------------------------------------------------------------------------------------------------------------
const str = (v, what) => { if (typeof v !== 'string') throw fail('CODEFIX_TASK', `task.inputs.${what} must be a string`); return v; };

// The issue thread: segment 0 holds the header (reporter, component, version) and the first report; every other segment
// is "### Comment by <author>" and a body. Comment bodies are what a reader triages; the author line is not part of one.
export function threadSegments(report) {
  const parts = str(report, 'bug_report').split('\n\n---\n\n');
  return parts.map((raw, index) => {
    if (index === 0) {
      const m = /^# Issue #(\d+): (.+)\n\n\*\*Reporter:\*\* (.+?)  \n\*\*Component:\*\* (.+?)  \n\*\*Version:\*\* (.+?)\n\n([\s\S]*)$/.exec(raw.trim());
      if (!m) return { index, kind: 'issue', title: null, body: raw.trim(), author: null, component: null, version: null };
      return { index, kind: 'issue', issue: Number(m[1]), title: m[2], author: m[3], component: m[4], version: m[5], body: m[6].trim() };
    }
    const m = /^### Comment by ([^\n]+)\n\n([\s\S]*)$/.exec(raw.trim());
    return m ? { index, kind: 'comment', author: m[1], body: m[2].trim() } : { index, kind: 'comment', author: null, body: raw.trim() };
  });
}
export function logLines(serviceLog) {
  const lines = str(serviceLog, 'service_log').split('\n');
  return lines.map((text, index) => ({ index, text })).filter(l => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \w+ +\[/.test(l.text));
}
// maximal runs of full-line comments in the module (a decoy sits on one line, an injected header on two or three)
export function codeComments(source) {
  const lines = str(source, 'source').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#/.test(lines[i])) continue;
    let j = i;
    while (j + 1 < lines.length && /^\s*#/.test(lines[j + 1])) j++;
    out.push({ index: out.length, line: i + 1, text: lines.slice(i, j + 1).map(l => l.trim()).join('\n') });
    i = j;
  }
  return out;
}
// the module outline of the F2 probe (experiments/kev-probe/datasets.mjs outline): class headers and def lines
export function moduleOutline(source) {
  const out = [], names = [], defs = [];
  let cls = null;
  for (const line of str(source, 'source').split('\n')) {
    const c = line.match(/^class (\w+)/);
    if (c) { cls = c[1]; out.push(line.trimEnd()); continue; }
    const f = line.match(/^(\s*)def (\w+)\(/);
    if (f) {
      const name = f[1].length && cls ? `${cls}.${f[2]}` : f[2];
      if (!f[1].length) cls = null;
      names.push(name); defs.push({ name, line: line.trim() }); out.push(line.trimEnd());
    }
  }
  return { outline: out.join('\n'), names, defs };
}
// "## heading" blocks of the design notes, in order
export function designSections(notes) {
  const text = str(notes, 'design_notes'), parts = text.split(/\n(?=## )/);
  return parts.slice(1).map((raw, index) => ({ index, heading: raw.split('\n')[0].replace(/^## /, ''), text: raw.trim() }));
}
const spanOf = (slots, kinds) => {
  const m = /^(\w+):(\d+)$/.exec(String(slots.span ?? ''));
  if (!m || !kinds.includes(m[1])) throw fail('CODEFIX_SLOTS', `slots.span must be one of ${kinds.map(k => `${k}:N`).join(', ')} (got ${JSON.stringify(slots.span)})`);
  return { kind: m[1], n: Number(m[2]) };
};
export const SOURCE_KIND = Object.freeze({ thread: 'issue comment', log: 'service log line', code: 'code comment', document: 'issue thread' });
export const MAX_SPAN_CHARS = 1500;

export function codefixState(task, slots = {}, port = slots.port) {
  const inp = task?.inputs;
  if (!inp) throw fail('CODEFIX_TASK', 'a codefix task has inputs');
  switch (port) {
    case 'X1': {
      if (slots.span === 'thread:all') return { source_kind: SOURCE_KIND.document, text: str(inp.bug_report, 'bug_report') };       // the long variant: the span in its document
      const { kind, n } = spanOf(slots, ['thread', 'log', 'code']);
      if (kind === 'thread') { const seg = threadSegments(inp.bug_report)[n]; if (!seg) throw fail('CODEFIX_SLOTS', `no thread segment ${n}`); return { source_kind: SOURCE_KIND.thread, text: seg.body }; }
      if (kind === 'log') { const l = logLines(inp.service_log ?? '').find(x => x.index === n); if (!l) throw fail('CODEFIX_SLOTS', `no log line ${n}`); return { source_kind: SOURCE_KIND.log, text: l.text }; }
      const c = codeComments(inp.source)[n]; if (!c) throw fail('CODEFIX_SLOTS', `no code comment ${n}`);
      return { source_kind: SOURCE_KIND.code, text: c.text };
    }
    case 'X6': {
      const { n } = spanOf(slots, ['thread']), segs = threadSegments(inp.bug_report), seg = segs[n];
      if (!seg) throw fail('CODEFIX_SLOTS', `no thread segment ${n}`);
      const head = segs[0], changelog = typeof inp.changelog === 'string' ? inp.changelog.split('\n').filter(Boolean).slice(1, 4).join(' ') : null;
      return { report: seg.body, known_reports: head.title ? [head.title] : [], build_info: { component: head.component, version: head.version, changelog } };
    }
    case 'Q6': {
      const { n } = spanOf(slots, ['thread']), seg = threadSegments(inp.bug_report)[n], sec = designSections(inp.design_notes)[slots.section];
      if (!seg || !sec) throw fail('CODEFIX_SLOTS', `no thread segment ${n} or design section ${slots.section}`);
      return { spec_excerpt: sec.text, behaviour: seg.body };
    }
    case 'F2': {
      const o = moduleOutline(inp.source);
      if (slots.span === undefined || slots.span === 'all') return { bug_report: str(inp.bug_report, 'bug_report'), module_outline: o.outline };
      const { n } = spanOf(slots, ['thread']), seg = threadSegments(inp.bug_report)[n];
      if (!seg) throw fail('CODEFIX_SLOTS', `no thread segment ${n}`);
      return { bug_report: seg.body, module_outline: o.outline };
    }
    default: throw fail('CODEFIX_PORT', `codefix kit has no state for port ${port}`);
  }
}
const cfBase = definePortKit({ bed: 'codefix', contracts: Object.fromEntries(['X1', 'X6', 'Q6', 'F2'].map(p => [p, ALL[p]])), buildState: (task, slots) => codefixState(task, slots) });
export const codefixKit = Object.freeze({
  ...cfBase,
  buildState: (task, slots = {}, port = slots.port) => cfBase.buildState(task, { ...slots, port }),
  request: (port, task, slots = {}, opts = {}) => cfBase.request(port, task, { ...slots, port }, opts),
});
