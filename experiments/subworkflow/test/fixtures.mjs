// $0 fixtures: the true slots of a golive backlog channel, and fake ModelPorts (a truth-label judge and scripted replies).
import { buildWorld, LABELS, LABEL_MEANING } from '../../../beds/golive/world.mjs';
import * as bed from '../../../beds/golive/index.mjs';

export const worldOf = task => buildWorld(task.seed, task.split, task.difficulty);
export function backlogChannels(task) { return worldOf(task).channels.filter(c => c.kind === 'backlog'); }
export function nodeInput(task, channel) {
  const c = task.inputs.channels.find(x => x.channel === channel);
  return { channel: c.channel, spec: task.inputs.spec, notes: c.notes, export: c.export };
}
/** The slots a perfect builder would fill for the legacy-export-intake template. */
export function trueSlots(task, ch) {
  const w = worldOf(task);
  return { channel: ch.name, labels: [...LABELS], label_meanings: LABELS.map(l => `- ${l}: ${LABEL_MEANING[l]}`).join('\n'), exclude_labels: ['cancelled'],
    cutoff_date: w.cutoverIso, rate_EUR: w.rates.EUR / 10000, rate_GBP: w.rates.GBP / 10000, rate_USD: 1,
    delimiter: ch.delimiter === '\t' ? 'tab' : ch.delimiter, col_ref: ch.header.ref, col_placed: ch.header.placed, col_updated: ch.header.updated,
    col_amount: ch.header.amount, col_currency: ch.header.currency, col_note: ch.header.note, date_order: ch.dateStyle,
    decimal_mark: ch.amountStyle.startsWith('comma') ? 'comma' : 'dot', letter_o_is_zero: true, blank_currency: ch.home, trailer_prefix: '#END' };
}
/** Truth label of every newest row, by ref, over all channels of the task. */
export function truthLabels(task) {
  const w = worldOf(task), m = new Map();
  for (const ch of w.channels) {
    const newest = new Map();
    for (const v of ch.versions) { const p = newest.get(v.ref); if (!p || (v.updatedMin ?? 0) > (p.updatedMin ?? 0)) newest.set(v.ref, v); }
    for (const v of newest.values()) m.set(v.ref, v.label);
  }
  return m;
}
/** A fake ModelPort answering judge_rows prompts with the true labels (or a wrong label for refs in `wrong`). */
export function truthJudgePort(task, { wrong = new Set(), costUsd = 0.0003 } = {}) {
  const labels = truthLabels(task), calls = [];
  return {
    calls,
    async call(req) {
      calls.push(req);
      const items = req.prompt.split('\n').filter(l => l.startsWith('{"i":')).map(l => JSON.parse(l));
      return { ok: true, costUsd, value: { items: items.map(x => ({ i: x.i, label: wrong.has(x.ref) ? LABELS[(LABELS.indexOf(labels.get(x.ref)) + 1) % 4] : labels.get(x.ref) })) } };
    },
  };
}
/** A fake ModelPort that answers by nodeKey prefix from a script: { prefix: value | (req) => value }. */
export function scriptedPort(script, { costUsd = 0.001 } = {}) {
  const calls = [];
  return {
    calls,
    async call(req) {
      calls.push(req);
      const key = Object.keys(script).find(k => req.nodeKey.includes(k));
      if (!key) return { ok: false, error: { code: 'MODEL_SCHEMA', message: `no script for ${req.nodeKey}` }, costUsd };
      const v = typeof script[key] === 'function' ? script[key](req) : script[key];
      return v && v.__error ? { ok: false, error: v.__error, costUsd } : { ok: true, value: structuredClone(v), costUsd };
    },
  };
}
export { bed };
