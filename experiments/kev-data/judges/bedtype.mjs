// Port kit for X5 `precondition_holds`, family bedtype (JUDGE-PROGRAM.md §1.2 X5 "bedtype: cross-family type
// applicability", §8.4 W2; plan group "construction-crossfamily"). Relocated from src/judges/bedtype.mjs until the
// C0 and P1 experiments finish (experiments/kev-data/README.md, "Relocation").
//
// The assumption of the kept workflow ("the task belongs to the family of tasks described as: <its family description>")
// is TRUSTED text and travels in the question (the contract's `assumption` slot). The state is the other, untrusted
// side: the head of the task the workflow would be reused for, built from the task's prompt and inputs alone:
//
//   { source_text: "Task statement:\n<prompt head>\n\nInputs:\n- <key>: <value head>\n- ..." }
//
// This file imports no bed (the runtime has no frozen copy): it works on the task it is given, and never reads the
// task's family id, seed, split, difficulty or id. The same function builds the state the factory trained on and the
// state the runtime serves (W2).
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 'bedtype@1';

// Windows of the task text a state carries (real Qwen3.5 tokens: standard p50 ~600 and max ~1K, long up to ~3.6K; measured by
// the group's test, §2.3 rule 6; the contract's budget is 600 typical / 4K max, windowed). The standard window reaches past the
// first 1,100 characters on purpose: shorter heads of ownerci and gridquest tasks are identical across seeds (six ownerci heads in
// all), so states would repeat across slices; with 2,600 characters and six inputs every bed's head is unique per seed.
export const WINDOWS = Object.freeze({
  standard: Object.freeze({ promptChars: 2600, keys: 6, valueChars: 200 }),
  long: Object.freeze({ promptChars: 8000, keys: 9, valueChars: 1100 }),
});
// The reference block of a slot-swap state (a second, earlier task shown for reference only).
export const REFERENCE_WINDOW = Object.freeze({ promptChars: 420 });
// A filed task of a filed-task state (the prompt head only).
export const FILED_WINDOW = Object.freeze({ promptChars: 1400 });
export const HEADERS = Object.freeze({ task: 'Task statement:', inputs: 'Inputs:', reference: 'Reference material (a different, earlier task; not this one):', filed: 'Filed task' });
// the id of a filed task: W- and four consonants (W-KQZT)
export const FILED_ID = /\bW-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/;
const CUT = ' […]';

const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// Cut `text` to at most `n` characters at a word boundary, marking the cut.
export function headOf(text, n) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n), at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).trimEnd()}${CUT}`;
}
const oneLine = text => String(text).replace(/\s+/g, ' ').trim();
const valueText = v => (typeof v === 'string' ? v : JSON.stringify(v ?? null));

// The head of a task: its prompt head and an excerpt of each of the first inputs (a window).
export function taskHead(task, windowName = 'standard') {
  const w = typeof windowName === 'string' ? WINDOWS[windowName] : windowName;
  if (!w) throw fail('KIT_WINDOW', `unknown window ${windowName}`);
  if (!task || typeof task.prompt !== 'string' || !task.prompt.trim()) throw fail('KIT_TASK', 'a task needs a prompt (and optionally inputs)');
  const lines = [HEADERS.task, headOf(task.prompt, w.promptChars)];
  const entries = task.inputs && typeof task.inputs === 'object' ? Object.entries(task.inputs) : [];
  if (w.keys > 0 && entries.length) {
    lines.push('', HEADERS.inputs);
    for (const [k, v] of entries.slice(0, w.keys)) lines.push(`- ${k}: ${headOf(oneLine(valueText(v)), w.valueChars)}`);
  }
  return lines.join('\n');
}

// {source_text}: the task head, optionally followed by a reference block (slot-swap states).
export function stateOf(task, { window = 'standard', reference = null } = {}) {
  let text = taskHead(task, window);
  if (reference) text += `\n\n${HEADERS.reference}\n${taskHead(reference, REFERENCE_WINDOW).replace(`${HEADERS.task}\n`, '')}`;
  return { source_text: text };
}

// A filed-task state (factory only; the runtime serves stateOf): the request's statement is a pointer sentence that names a
// filed task by id, followed by the filed tasks, each under "Filed task <id>:" with its prompt head. When the pointer names a
// listed task the state settles the request's type (that task's); when it names a task that is not on file, the state holds
// task text of the same register but does not settle it (the presence-matched unknowable of JUDGE-PROGRAM.md §2.5).
//   { source_text: "Task statement:\n<pointer>\n\nFiled task W-KQZT:\n<prompt head>\n\nFiled task W-BRDM:\n<prompt head>" }
export function filedState(pointer, filed) {
  if (typeof pointer !== 'string' || !FILED_ID.test(pointer)) throw fail('KIT_TASK', 'a filed-task state needs a pointer sentence with a task id');
  if (!Array.isArray(filed) || filed.length < 2) throw fail('KIT_TASK', 'a filed-task state lists at least two tasks');
  const blocks = filed.map(f => {
    if (!FILED_ID.test(f?.id ?? '') || f.id !== f.id.match(FILED_ID)[0]) throw fail('KIT_TASK', `a filed task needs an id like W-KQZT (got ${JSON.stringify(f?.id)})`);
    if (!f.task || typeof f.task.prompt !== 'string' || !f.task.prompt.trim()) throw fail('KIT_TASK', 'a filed task needs a prompt');
    return `${HEADERS.filed} ${f.id}:\n${headOf(f.task.prompt, FILED_WINDOW.promptChars)}`;
  });
  if (new Set(filed.map(f => f.id)).size !== filed.length) throw fail('KIT_TASK', 'filed task ids must differ');
  return { source_text: `${HEADERS.task}\n${pointer.trim()}\n\n${blocks.join('\n\n')}` };
}

const { contracts } = loadSpec();
export const kit = definePortKit({
  bed: 'bedtype',
  contracts: { X5: contracts.X5 },
  // slots: { assumption } for the question; { window, reference } are optional state parameters (the default is the
  // standard window, which is what the runtime serves).
  buildState(task, slots = {}) { return stateOf(task, { window: slots.window ?? 'standard', reference: slots.reference ?? null }); },
});
