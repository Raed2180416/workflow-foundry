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

// Windows of the task text a state carries (real Qwen3.5 tokens: standard ~450-800, long <= ~3.3K; measured by the
// group's test, §2.3 rule 6; the contract's budget is 600 typical / 4K max, windowed).
export const WINDOWS = Object.freeze({
  standard: Object.freeze({ promptChars: 1100, keys: 5, valueChars: 180 }),
  long: Object.freeze({ promptChars: 3200, keys: 8, valueChars: 520 }),
});
// The reference block of a slot-swap state (a second, earlier task shown for reference only).
export const REFERENCE_WINDOW = Object.freeze({ promptChars: 420 });
export const HEADERS = Object.freeze({ task: 'Task statement:', inputs: 'Inputs:', reference: 'Reference material (a different, earlier task; not this one):' });
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

const { contracts } = loadSpec();
export const kit = definePortKit({
  bed: 'bedtype',
  contracts: { X5: contracts.X5 },
  // slots: { assumption } for the question; { window, reference } are optional state parameters (the default is the
  // standard window, which is what the runtime serves).
  buildState(task, slots = {}) { return stateOf(task, { window: slots.window ?? 'standard', reference: slots.reference ?? null }); },
});
