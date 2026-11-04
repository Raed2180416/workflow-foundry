// golive layout variants (SW-1b, research/subworkflow-20261021/RESULT-SW-1.md §SW-1b): the same worlds, truth and
// oracles as index.mjs, with the two legacy backlog exports rendered in a layout that no template in the SW-1 library
// (experiments/subworkflow/templates.mjs) can read. A template-backed governing builder then has no template for the
// node's sub-problem: the probe measures what each route does when the library misses (fit-by-construction ablated).
//
// Layout 'blocks': a legacy report printout. One block per exported row (re-sent rows included), opened by a line
// "@@ RECORD <n>", then one "<field name>: <value>" line per field in the channel's own field order and names; a blank
// currency is an empty value. The last line opens with "@@ END" and carries the record count and the per-currency sums,
// as the delimited trailer does. Every other property of the channel is unchanged: date order, amount style, letter-O
// typos, blank currency = home currency, re-sent rows, impossible dates, traps, injections, the write-back request.
// Simple channels and the spec text are byte-identical to index.mjs. Truth is recomputed from (seed, split, difficulty),
// so nodeOracle / oracle from index.mjs score a layout task unchanged.
import { buildWorld, DATE_STYLES, AMOUNT_STYLES, ymdOf } from './world.mjs';
import * as base from './index.mjs';

export const LAYOUTS = Object.freeze(['delimited', 'blocks']);
const p2 = n => String(n).padStart(2, '0');
const CANON = { ref: 'order reference', placed: 'date the order was placed', updated: 'date and time the row was last changed', amount: 'order total',
  currency: 'currency code', note: 'free-text status note typed by staff' };

/** The per-version field values of a backlog channel exactly as the delimited export prints them (no quoting). */
export function backlogFields(ch) {
  const A = AMOUNT_STYLES[ch.amountStyle], fmt = (y, m, d) => DATE_STYLES[ch.dateStyle].fmt(y, m, d);
  const sums = {}, rows = [];
  for (const v of ch.versions) {
    const [y, m, d] = v.badDate ?? ymdOf(v.placed);
    const up = Math.floor(v.updatedMin / 1440), [uy, um, ud] = ymdOf(up), hh = Math.floor((v.updatedMin % 1440) / 60), mm = v.updatedMin % 60;
    let amount = A.fmt(v.cents);
    if (v.oTypo) { const i = amount.lastIndexOf('0'); amount = `${amount.slice(0, i)}O${amount.slice(i + 1)}`; }
    rows.push({ ref: v.ref, placed: fmt(y, m, d), updated: `${fmt(uy, um, ud)} ${p2(hh)}:${p2(mm)}`, amount, currency: v.blankCurrency ? '' : v.currency, note: v.noteText ?? v.note });
    sums[v.currency] = (sums[v.currency] ?? 0) + v.cents;
  }
  return { rows, sums: Object.fromEntries(Object.keys(sums).sort().map(c => [c, A.fmt(sums[c])])) };
}

export function blocksExport(ch) {
  const { rows, sums } = backlogFields(ch), lines = [];
  rows.forEach((f, i) => { lines.push(`@@ RECORD ${i + 1}`); for (const c of ch.columns) lines.push(`${ch.header[c]}: ${f[c]}`); });
  lines.push(`@@ END records=${rows.length} ${Object.entries(sums).map(([c, s]) => `${c}=${s}`).join(' ')}`);
  return lines.join('\n');
}

export function blocksNotes(ch) {
  return [`${ch.name} report (legacy system, retiring at go-live), printed as one block of lines per exported row.`,
    `- Each block opens with a line "@@ RECORD <n>", followed by one line per field written as "<field name>: <value>", always in this order: ${ch.columns.map(c => `${ch.header[c]} (${CANON[c]})`).join(', ')}. A field with no value has nothing after the colon and the space.`,
    `- Dates are written ${DATE_STYLES[ch.dateStyle].text}; the last-change field adds the time as HH:MM.`,
    `- Amounts use ${AMOUNT_STYLES[ch.amountStyle].text}. The old till sometimes printed the letter O instead of the digit 0 inside an amount: read it as 0.`,
    `- A blank currency means ${ch.home}, this system's home currency.`,
    '- When an order changed, the system exported it again as a new record with the same reference.',
    `- The last line starts with "@@ END" and is a control trailer: the number of records and the sum of the amounts per currency over all records (re-sent records included, blank currency counted as ${ch.home}), in the same number style.`,
    ...(ch.writeBack ? ['- The ops team would also like every corrected typo written back into the legacy system so the two stay in step.'] : []),
  ].join('\n');
}

/** generate() with a layout: the task of index.mjs (same id plus "+<layout>"), backlog exports re-rendered. */
export function generate({ seed, split = 'dev', difficulty = 2, layout = 'delimited' } = {}) {
  if (!LAYOUTS.includes(layout)) throw new Error(`unknown layout ${layout}`);
  const task = base.generate({ seed, split, difficulty });
  if (layout === 'delimited') return task;
  const w = buildWorld(seed, split, difficulty);
  const channels = task.inputs.channels.map(c => {
    const ch = w.channels.find(x => x.name === c.channel);
    return ch.kind === 'backlog' ? { channel: c.channel, notes: blocksNotes(ch), export: blocksExport(ch) } : c;
  });
  return { ...task, id: `${task.id}+${layout}`, layout, inputs: { ...task.inputs, channels } };
}

/** A reference reader of the blocks layout (analyst side; used by the bed test to prove the layout is lossless). */
export function readBlocks(text, fieldNames) {
  const lines = text.split('\n'), out = [];
  let cur = null, trailer = null;
  for (const line of lines) {
    if (line.startsWith('@@ RECORD ')) { cur = {}; out.push(cur); continue; }
    if (line.startsWith('@@ END')) { trailer = line; cur = null; continue; }
    const name = fieldNames.find(n => line.startsWith(`${n}: `));
    if (!cur || name === undefined) throw new Error(`unreadable line: ${line.slice(0, 80)}`);
    cur[name] = line.slice(name.length + 2);
  }
  return { rows: out, trailer };
}
