// Port kits for the construction ports C1, C2, C7, C8 and C9 (JUDGE-PROGRAM.md §1.2 group C, §8.4 W2; plan group
// "construction-crossfamily"). Relocated from src/judges/ until the C0 and P1 experiments finish (experiments/kev-data/README.md).
// A construction kit turns a construction artefact into the state the port reads; the factory and the runtime import the same
// function, so a trained state and a served state are byte-identical (W2).
//
//   C1 objective_requirements  {objective}                        task: { objective }
//   C2 objective_ungrounded    {objective, capabilities}          task: { objective, capabilities: [string] }
//   C7 transcript_gaming       {tool, input}                      task: { tool, input }     (one builder tool call)
//   C8 notes_leak              {notes}                            task: { notes }
//   C9 same_task_family        {task_a, task_b}                   task: { a, b }            (two bed tasks: their prompt heads)
//
// No bed is imported here; C9 works on the two tasks it is given and never reads their family ids.
import { definePortKit } from './kit.mjs';
import { headOf } from './bedtype.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 'construction@1';
export const LIMITS = Object.freeze({ objectiveChars: 1200, capabilities: 24, capabilityChars: 200, notesWords: 200, promptChars: 1400, inputChars: 1500 });
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
const text = (v, name, max) => { if (typeof v !== 'string' || !v.trim()) throw fail('KIT_TASK', `${name} must be a non-empty string`); if (v.length > max) throw fail('KIT_TASK', `${name} exceeds ${max} characters`); return v.trim(); };

export const objectiveState = task => ({ objective: text(task?.objective, 'objective', LIMITS.objectiveChars) });
export function capabilityState(task) {
  const caps = task?.capabilities;
  if (!Array.isArray(caps) || !caps.length || caps.length > LIMITS.capabilities) throw fail('KIT_TASK', `capabilities must list 1-${LIMITS.capabilities} entries`);
  return { objective: text(task.objective, 'objective', LIMITS.objectiveChars), capabilities: caps.map((c, i) => text(c, `capabilities[${i}]`, LIMITS.capabilityChars)) };
}
// One builder tool call: its name and its input as the transcript recorded it (strings capped; nothing else is added).
export function callState(task) {
  const input = task?.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('KIT_TASK', 'input must be the tool input object');
  const cut = (v) => (typeof v === 'string' ? headOf(v, LIMITS.inputChars) : v);
  return { tool: text(task.tool, 'tool', 40), input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, cut(v)])) };
}
export function notesState(task) {
  const notes = text(task?.notes, 'notes', 2400);
  if (notes.split(/\s+/).length > LIMITS.notesWords) throw fail('KIT_TASK', `notes are at most ${LIMITS.notesWords} words`);
  return { notes };
}
export const pairState = task => ({ task_a: headOf(text(task?.a?.prompt, 'a.prompt', 60000), LIMITS.promptChars), task_b: headOf(text(task?.b?.prompt, 'b.prompt', 60000), LIMITS.promptChars) });

const { contracts } = loadSpec();
const mk = (bed, port, buildState) => definePortKit({ bed, contracts: { [port]: contracts[port] }, buildState: (task) => buildState(task) });
export const kits = Object.freeze({
  C1: mk('construction-objective', 'C1', objectiveState),
  C2: mk('construction-grounding', 'C2', capabilityState),
  C7: mk('construction-transcript', 'C7', callState),
  C8: mk('construction-notes', 'C8', notesState),
  C9: mk('construction-bedprompts', 'C9', pairState),
});
