// Edits of an incident task's text (JUDGE-PROGRAM.md §2.5 variants): an injection insert, an unknowable, a flipped note, a
// removed note. A counterfactual is an edit of the TASK; the state is then the port kit's, on the edited task, so a served
// state (kit on the real task) and a factory state (kit on the edited task) are one function. Edits are pure.
import { parseLog, parseSystem, renderBody, serviceOfSource } from '../judges/incident.mjs';

const LINE = /^(L\d+) (\S+) (\S+) (.*)$/s;
const withInputs = (task, patch) => ({ ...task, inputs: { ...task.inputs, ...patch }, files: undefined });

// Insert a line into the log in timestamp order (after every line at the same or an earlier time). The new line has the id
// `L9<nnnn>` (the bed's ids are `L0001`...: never reused). spec: { ts, source, body } -> { task, id }
export function insertLine(task, { ts, source, body }, nth = 0) {
  const lines = task.inputs.log.split('\n').filter(Boolean);
  const id = `L9${String(nth + 1).padStart(4, '0')}`;
  const t = Date.parse(ts);
  let at = lines.length;
  while (at > 0 && Date.parse(LINE.exec(lines[at - 1])[2]) > t) at--;
  lines.splice(at, 0, `${id} ${ts} ${source} ${body}`);
  return { task: withInputs(task, { log: `${lines.join('\n')}\n` }), id };
}
// Replace the body of lines by id: { id: newBody }
export function replaceBodies(task, bodies) {
  const lines = task.inputs.log.split('\n').filter(Boolean).map(l => {
    const m = LINE.exec(l);
    return bodies[m[1]] !== undefined ? `${m[1]} ${m[2]} ${m[3]} ${bodies[m[1]]}` : l;
  });
  return withInputs(task, { log: `${lines.join('\n')}\n` });
}
// The notes of the system document replaced by `notes` (the section keeps its heading and place)
export function withNotes(task, notes) {
  const lines = task.inputs.system.split('\n');
  const at = lines.findIndex(l => l.trim() === '## Notes and recent changes');
  if (at < 0) throw new Error('incident edit: the system document has no notes section');
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  const section = ['## Notes and recent changes', '', ...notes.map(n => `- ${n}`), ''];
  return withInputs(task, { system: [...lines.slice(0, at), ...section, ...lines.slice(end)].join('\n') });
}
// A message in the style of a service: its other lines tell the style (plain, bracket, kv, json, short)
export function styleOfService(task, service) {
  const sys = parseSystem(task.inputs.system), log = parseLog(task.inputs.log);
  for (const l of log.lines) if (serviceOfSource(sys, l.source) === service && l.style) return { style: l.style, keys: l.keys, source: l.source };
  return { style: 'plain', keys: undefined, source: service };
}
export const bodyIn = (style, level, message) => renderBody({ style: style.style, level, message, keys: style.keys });
// the pods of a service seen in the log (the sources of its lines)
export function podsOf(task, service) {
  const sys = parseSystem(task.inputs.system), log = parseLog(task.inputs.log);
  return [...new Set(log.lines.filter(l => serviceOfSource(sys, l.source) === service && !sys.shadowPods.includes(l.source)).map(l => l.source))].sort();
}
