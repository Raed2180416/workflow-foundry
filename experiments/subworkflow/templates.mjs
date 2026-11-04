// Sub-workflow templates for the governing builder (research/subworkflow-20261021/DESIGN.md §4). Frontier-written: the
// author is the session's Opus 5.5 orchestrator agent (recorded per template), the same author as the golive bed, which
// RESULT-SW-1.md declares as a threat (fit by construction, as BUILDER-1 §6). A template is a fixed procedure in
// subworkflow/1 with typed slots; the builder model only fills slots. Slot values reach code steps as a JSON constant
// (data, never code). Each template carries its own invariants as verify steps.
import { SPEC_KIND } from './dsl.mjs';

export const TEMPLATE_AUTHOR = 'claude-opus-5-5 (orchestrator worktree agent, 2026-10-22)';
export const TEMPLATE_MODEL = 'claude-haiku-5-5';
const json = v => JSON.stringify(v);

// Shared code: date and amount readers (inlined into each code step: steps cannot import).
const READERS = String.raw`
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function readDate(s, order) {
  s = String(s ?? '').trim();
  let y, m, d, x;
  if (order === 'Y-M-D') { x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (!x) return null; y = +x[1]; m = +x[2]; d = +x[3]; }
  else if (order === 'D Mon Y') { x = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s); if (!x || !MON[x[2]]) return null; d = +x[1]; m = MON[x[2]]; y = +x[3]; }
  else {
    const sep = order === 'D.M.Y' ? '\\.' : '/';
    x = new RegExp('^(\\d{1,2})' + sep + '(\\d{1,2})' + sep + '(\\d{4})$').exec(s); if (!x) return null;
    y = +x[3]; if (order === 'M/D/Y') { m = +x[1]; d = +x[2]; } else { d = +x[1]; m = +x[2]; }
  }
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return { valid: false };
  return { valid: true, iso: y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), key: y * 10000 + m * 100 + d };
}
function readStamp(s, order) {
  const x = /^(.*\S)\s+(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!x) return null;
  const dt = readDate(x[1], order);
  if (!dt || !dt.valid) return null;
  return dt.key * 10000 + (+x[2]) * 100 + (+x[3]);
}
function readAmount(s, decimal, letterO) {
  let t = String(s ?? '').trim();
  if (letterO) t = t.replace(/[Oo]/g, '0');
  t = decimal === 'comma' ? t.replace(/[.\s]/g, '').replace(',', '.') : t.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const neg = t.startsWith('-'), [w, f = ''] = t.replace('-', '').split('.');
  const c = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return neg ? -c : c;
}
const toUsd = (cents, rate) => Math.floor((cents * Math.round(rate * 10000) + 5000) / 10000);
`;

// ---------------------------------------------------------------------------------------------------------------------
const intakeSlots = [
  { name: 'channel', type: 'string', description: 'the channel name to put in the answer, exactly as given' },
  { name: 'labels', type: 'string[]', description: 'the closed list of status labels, exactly as given' },
  { name: 'label_meanings', type: 'string', description: 'what each label means, copied from the rules, for the model that judges each row' },
  { name: 'exclude_labels', type: 'string[]', description: 'labels whose orders are not imported (for example a cancelled label)' },
  { name: 'cutoff_date', type: 'string', description: 'YYYY-MM-DD: import only orders placed on or before this date' },
  { name: 'rate_EUR', type: 'number', description: 'closing rate EUR to USD' },
  { name: 'rate_GBP', type: 'number', description: 'closing rate GBP to USD' },
  { name: 'rate_USD', type: 'number', description: 'closing rate USD to USD (normally 1)' },
];
export const TEMPLATES = Object.freeze([
  {
    id: 'legacy-export-intake', author: TEMPLATE_AUTHOR,
    title: 'Legacy delimited export to an order intake answer',
    whenToUse: 'A legacy system hands over orders as delimited text (a header line, one row per order version, maybe a control trailer): read its dialect, keep the newest version of each order, repair known typos, quarantine impossible dates, judge each order\'s free-text status, apply the import rules, convert to USD cents and total.',
    notFor: 'Clean JSON lists; anything that sends messages or writes back to another system.',
    slots: [
      ...intakeSlots,
      { name: 'delimiter', type: 'enum', enum: [';', '|', 'tab', ','], description: 'the field separator of the export' },
      { name: 'col_ref', type: 'string', description: 'header name of the order reference column, exactly as in the header line' },
      { name: 'col_placed', type: 'string', description: 'header name of the order date column' },
      { name: 'col_updated', type: 'string', description: 'header name of the last-change date-time column' },
      { name: 'col_amount', type: 'string', description: 'header name of the amount column' },
      { name: 'col_currency', type: 'string', description: 'header name of the currency column' },
      { name: 'col_note', type: 'string', description: 'header name of the free-text status note column' },
      { name: 'date_order', type: 'enum', enum: ['D/M/Y', 'M/D/Y', 'Y-M-D', 'D.M.Y', 'D Mon Y'], description: 'how dates are written' },
      { name: 'decimal_mark', type: 'enum', enum: ['dot', 'comma'], description: 'the decimal separator of amounts' },
      { name: 'letter_o_is_zero', type: 'boolean', description: 'true if a letter O inside an amount must be read as the digit 0' },
      { name: 'blank_currency', type: 'string', description: 'the currency code a blank currency field means' },
      { name: 'trailer_prefix', type: 'string', description: 'the text the control trailer line starts with (for example #END), or empty if none' },
    ],
    instantiate: s => ({
      kind: SPEC_KIND, name: 'legacy-export-intake', purpose: `intake of the ${s.channel} export`, models: [TEMPLATE_MODEL], budgetUsd: s.budgetUsd,
      steps: [
        { id: 'table', op: 'parse_table', args: [{ name: 'text', ref: '$in.export' }], delimiter: s.delimiter },
        { id: 'norm', op: 'code', args: [{ name: 'table', ref: '$table' }], fn: `const CFG = ${json(s)};\n${READERS}
export default ({ table }) => {
  const cols = ['col_ref', 'col_placed', 'col_updated', 'col_amount', 'col_currency', 'col_note'].map(k => CFG[k]);
  const missing = cols.filter(c => !table.header.includes(c));
  if (missing.length) return { error: 'columns not in the header: ' + missing.join(', ') + '; header: ' + table.header.join(' | ') };
  const rows = table.rows.map((r, i) => {
    const placed = readDate(r[CFG.col_placed], CFG.date_order);
    const stamp = readStamp(r[CFG.col_updated], CFG.date_order);
    const cents = readAmount(r[CFG.col_amount], CFG.decimal_mark, CFG.letter_o_is_zero);
    const currency = (r[CFG.col_currency] || '').trim() || CFG.blank_currency;
    return { i, ref: String(r[CFG.col_ref]).trim(), placedRaw: r[CFG.col_placed], placed, stamp, stampRaw: r[CFG.col_updated], amountRaw: r[CFG.col_amount], cents, currency, note: r[CFG.col_note] };
  });
  let trailer = null;
  if (CFG.trailer_prefix) {
    const line = table.comments.find(c => c.startsWith(CFG.trailer_prefix));
    if (line) {
      const n = /rows=(\\d+)/.exec(line);
      const sums = {};
      for (const m of line.matchAll(/([A-Z]{3})=(.+?)(?=\\s+[A-Z]{3}=|$)/g)) sums[m[1]] = readAmount(m[2], CFG.decimal_mark, false);
      trailer = { rows: n ? Number(n[1]) : null, sums, line };
    }
  }
  return { rows, trailer };
};` },
        { id: 'check_read', op: 'verify', args: [{ name: 'norm', ref: '$norm' }], fn: `const CFG = ${json({ trailer_prefix: s.trailer_prefix, rates: { EUR: s.rate_EUR, GBP: s.rate_GBP, USD: s.rate_USD } })};
export default ({ norm }) => {
  const problems = [];
  if (norm.error) return { ok: false, problems: [norm.error] };
  const bad = (k, why) => norm.rows.filter(r => r[k] === null || r[k] === undefined).slice(0, 3).map(r => why + ' ' + JSON.stringify(r[k === 'stamp' ? 'stampRaw' : k === 'placed' ? 'placedRaw' : 'amountRaw']));
  problems.push(...bad('stamp', 'last-change time not readable or not a real date:'), ...bad('cents', 'amount not readable:'), ...bad('placed', 'order date in an unexpected format:'));
  for (const r of norm.rows) if (!(r.currency in CFG.rates)) { problems.push('currency without a rate: ' + r.currency); break; }
  if (CFG.trailer_prefix) {
    if (!norm.trailer) problems.push('no trailer line starting with ' + CFG.trailer_prefix);
    else {
      if (norm.trailer.rows !== null && norm.trailer.rows !== norm.rows.length) problems.push('trailer says ' + norm.trailer.rows + ' rows, read ' + norm.rows.length);
      const sums = {};
      for (const r of norm.rows) if (r.cents !== null) sums[r.currency] = (sums[r.currency] || 0) + r.cents;
      for (const [c, v] of Object.entries(norm.trailer.sums)) if (v !== (sums[c] || 0)) problems.push('trailer ' + c + ' sum ' + v + ' cents, read ' + (sums[c] || 0));
      for (const c of Object.keys(sums)) if (!(c in norm.trailer.sums) && sums[c] !== 0) problems.push('read amounts in ' + c + ' that the trailer does not list');
    }
  }
  return { ok: problems.length === 0, problems };
};` },
        { id: 'current', op: 'code', args: [{ name: 'norm', ref: '$norm' }], fn: `const CFG = ${json({ cutoff_date: s.cutoff_date })};
export default ({ norm }) => {
  const newest = new Map();
  for (const r of norm.rows) { const p = newest.get(r.ref); if (!p || r.stamp > p.stamp) newest.set(r.ref, r); }
  const cut = Number(CFG.cutoff_date.replaceAll('-', ''));
  const all = [...newest.values()];
  return { all, toJudge: all.filter(r => r.placed && r.placed.valid && r.placed.key <= cut).map(r => ({ ref: r.ref, note: r.note })) };
};` },
        { id: 'judged', op: 'judge_rows', args: [{ name: 'rows', ref: '$current.toJudge' }], show: ['ref', 'note'], labels: s.labels, field: 'status', batch: 15, model: TEMPLATE_MODEL,
          instructions: `Each row is one order with its staff note. Give the order's current status, judged from the whole note (not from single words).\n${s.label_meanings}` },
        { id: 'answer', op: 'code', args: [{ name: 'current', ref: '$current' }, { name: 'judged', ref: '$judged' }], fn: `const CFG = ${json({ channel: s.channel, exclude: s.exclude_labels, cutoff_date: s.cutoff_date, rates: { EUR: s.rate_EUR, GBP: s.rate_GBP, USD: s.rate_USD } })};
const toUsd = (cents, rate) => Math.floor((cents * Math.round(rate * 10000) + 5000) / 10000);
export default ({ current, judged }) => {
  const label = new Map(judged.map(j => [j.ref, j.status]));
  const cut = Number(CFG.cutoff_date.replaceAll('-', ''));
  const imp = [], quarantine = [];
  for (const r of current.all) {
    if (!r.placed || !r.placed.valid) { quarantine.push(r.ref); continue; }
    if (r.placed.key > cut) continue;
    const status = label.get(r.ref);
    if (CFG.exclude.includes(status)) continue;
    imp.push({ ref: r.ref, placed: r.placed.iso, status, usd_cents: toUsd(r.cents, CFG.rates[r.currency]) });
  }
  imp.sort((a, b) => (a.ref < b.ref ? -1 : 1)); quarantine.sort();
  return { channel: CFG.channel, import: imp, quarantine, totals: { orders: imp.length, usd_cents: imp.reduce((t, o) => t + o.usd_cents, 0) } };
};` },
        { id: 'check_answer', op: 'verify', args: [{ name: 'answer', ref: '$answer' }], fn: `const LABELS = ${json(s.labels.filter(l => !s.exclude_labels.includes(l)))};
export default ({ answer }) => {
  const problems = [], refs = new Set();
  for (const o of answer.import) { if (!LABELS.includes(o.status)) problems.push('status ' + o.status + ' for ' + o.ref); if (refs.has(o.ref)) problems.push('duplicate ' + o.ref); refs.add(o.ref); if (!Number.isInteger(o.usd_cents)) problems.push('cents not an integer for ' + o.ref); }
  return { ok: problems.length === 0, problems };
};` },
      ],
      output: '$answer',
    }),
  },
  {
    id: 'json-list-intake', author: TEMPLATE_AUTHOR,
    title: 'Clean JSON order list to an order intake answer',
    whenToUse: 'A channel hands over a clean JSON list of orders (ref, ISO date, amount, note): judge each order\'s status from its note, apply the import rules, convert to USD cents and total.',
    notFor: 'Delimited legacy exports, re-sent rows or typos; anything that sends messages or writes elsewhere.',
    slots: [...intakeSlots,
      { name: 'field_ref', type: 'string', description: 'the JSON field holding the order reference' },
      { name: 'field_placed', type: 'string', description: 'the JSON field holding the order date (YYYY-MM-DD)' },
      { name: 'field_amount', type: 'string', description: 'the JSON field holding the amount (dot decimals)' },
      { name: 'field_note', type: 'string', description: 'the JSON field holding the status note' },
      { name: 'currency', type: 'string', description: 'the currency of every amount in the list' }],
    instantiate: s => ({
      kind: SPEC_KIND, name: 'json-list-intake', purpose: `intake of the ${s.channel} list`, models: [TEMPLATE_MODEL], budgetUsd: s.budgetUsd,
      steps: [
        { id: 'rows', op: 'code', args: [{ name: 'text', ref: '$in.export' }], fn: `const CFG = ${json(s)};
export default ({ text }) => {
  const list = JSON.parse(text);
  return list.map(o => ({ ref: String(o[CFG.field_ref]), placed: String(o[CFG.field_placed]), cents: Math.round(Number(o[CFG.field_amount]) * 100), note: o[CFG.field_note] }));
};` },
        { id: 'judged', op: 'judge_rows', args: [{ name: 'rows', ref: '$rows' }], show: ['ref', 'note'], labels: s.labels, field: 'status', batch: 15, model: TEMPLATE_MODEL,
          instructions: `Each row is one order with its staff note. Give the order's current status, judged from the whole note (not from single words).\n${s.label_meanings}` },
        { id: 'answer', op: 'code', args: [{ name: 'judged', ref: '$judged' }], fn: `const CFG = ${json({ channel: s.channel, exclude: s.exclude_labels, cutoff: s.cutoff_date, rate: { EUR: s.rate_EUR, GBP: s.rate_GBP, USD: s.rate_USD }[s.currency] ?? null })};
export default ({ judged }) => {
  const imp = judged.filter(o => o.placed <= CFG.cutoff && !CFG.exclude.includes(o.status))
    .map(o => ({ ref: o.ref, placed: o.placed, status: o.status, usd_cents: Math.floor((o.cents * Math.round(CFG.rate * 10000) + 5000) / 10000) }))
    .sort((a, b) => (a.ref < b.ref ? -1 : 1));
  return { channel: CFG.channel, import: imp, quarantine: [], totals: { orders: imp.length, usd_cents: imp.reduce((t, o) => t + o.usd_cents, 0) } };
};` },
      ],
      output: '$answer',
    }),
  },
  {
    id: 'batch-classify', author: TEMPLATE_AUTHOR,
    title: 'Label every item of a list',
    whenToUse: 'Give each item of a JSON list one label from a closed set, judged from one text field; returns [{id, label}].',
    notFor: 'Jobs that also need parsing of delimited text, arithmetic, totals or an intake answer.',
    slots: [{ name: 'field_id', type: 'string', description: 'the item field that identifies it' }, { name: 'field_text', type: 'string', description: 'the item field to judge' },
      { name: 'labels', type: 'string[]', description: 'the closed list of labels' }, { name: 'instructions', type: 'string', description: 'what each label means' }],
    instantiate: s => ({
      kind: SPEC_KIND, name: 'batch-classify', models: [TEMPLATE_MODEL], budgetUsd: s.budgetUsd,
      steps: [
        { id: 'items', op: 'code', args: [{ name: 'text', ref: '$in.export' }], fn: `const CFG = ${json({ id: s.field_id, text: s.field_text })};\nexport default ({ text }) => JSON.parse(text).map(o => ({ id: String(o[CFG.id]), text: o[CFG.text] }));` },
        { id: 'judged', op: 'judge_rows', args: [{ name: 'rows', ref: '$items' }], show: ['id', 'text'], labels: s.labels, field: 'label', batch: 15, model: TEMPLATE_MODEL, instructions: s.instructions },
        { id: 'out', op: 'code', args: [{ name: 'judged', ref: '$judged' }], fn: 'export default ({ judged }) => judged.map(j => ({ id: j.id, label: j.label }));' },
      ],
      output: '$out',
    }),
  },
  {
    id: 'two-list-reconcile', author: TEMPLATE_AUTHOR,
    title: 'Match two lists by key and amount',
    whenToUse: 'Two JSON lists (for example invoices and payments) are matched by a key field and an amount field; returns matched pairs and the unmatched items of each side.',
    notFor: 'A single list; status judgments; intake answers.',
    slots: [{ name: 'field_key', type: 'string', description: 'the key field in both lists' }, { name: 'field_amount', type: 'string', description: 'the amount field in both lists' }],
    instantiate: s => ({
      kind: SPEC_KIND, name: 'two-list-reconcile', models: [], budgetUsd: s.budgetUsd,
      steps: [{ id: 'out', op: 'code', args: [{ name: 'a', ref: '$in.export' }, { name: 'b', ref: '$in.notes' }], fn: `const CFG = ${json({ k: s.field_key, a: s.field_amount })};
export default ({ a, b }) => { const A = JSON.parse(a), B = JSON.parse(b); const key = o => o[CFG.k] + '|' + o[CFG.a];
  const bk = new Map(B.map(o => [key(o), o])); const matched = [], onlyA = [];
  for (const o of A) { if (bk.has(key(o))) { matched.push([o, bk.get(key(o))]); bk.delete(key(o)); } else onlyA.push(o); }
  return { matched, onlyA, onlyB: [...bk.values()] }; };` }],
      output: '$out',
    }),
  },
]);

export const templateById = id => TEMPLATES.find(t => t.id === id) ?? null;
export const catalogText = () => TEMPLATES.map(t => `- ${t.id}: ${t.title}\n  Use when: ${t.whenToUse}\n  Not for: ${t.notFor}`).join('\n');
export const slotText = t => t.slots.map(s => `- ${s.name} (${s.type === 'enum' ? `one of ${s.enum.map(x => JSON.stringify(x)).join(', ')}` : s.type}): ${s.description}`).join('\n');

/** The model-facing fill schema of a template (portable subset). */
export function fillSchema(t) {
  const prop = s => (s.type === 'enum' ? { type: 'string', enum: s.enum } : s.type === 'string[]' ? { type: 'array', items: { type: 'string' } } : { type: s.type });
  return { type: 'object', additionalProperties: false, required: ['slots', 'assumptions'], properties: {
    slots: { type: 'object', additionalProperties: false, required: t.slots.map(s => s.name), properties: Object.fromEntries(t.slots.map(s => [s.name, { ...prop(s), description: s.description }])) },
    assumptions: { type: 'array', items: { type: 'string' } } } };
}
/** Type-check filled slots; returns problems (strings). */
export function slotProblems(t, slots) {
  const out = [];
  for (const s of t.slots) {
    const v = slots?.[s.name];
    if (v === undefined || v === null) { out.push(`slot ${s.name} is missing`); continue; }
    if (s.type === 'enum' && !s.enum.includes(v)) out.push(`slot ${s.name} must be one of ${s.enum.join(', ')}`);
    if (s.type === 'string' && typeof v !== 'string') out.push(`slot ${s.name} must be a string`);
    if (s.type === 'number' && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) out.push(`slot ${s.name} must be a positive number`);
    if (s.type === 'boolean' && typeof v !== 'boolean') out.push(`slot ${s.name} must be true or false`);
    if (s.type === 'string[]' && !(Array.isArray(v) && v.every(x => typeof x === 'string'))) out.push(`slot ${s.name} must be a list of strings`);
  }
  if (typeof slots?.cutoff_date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(slots.cutoff_date)) out.push('slot cutoff_date must be YYYY-MM-DD');
  if (Array.isArray(slots?.labels) && Array.isArray(slots?.exclude_labels)) for (const l of slots.exclude_labels) if (!slots.labels.includes(l)) out.push(`exclude label ${l} is not in labels`);
  return out;
}
/** Slots given as [{name, value}] strings (the in-node template arm, which has no per-template schema) -> typed values. */
export function coerceSlots(t, pairs) {
  const raw = Object.fromEntries((pairs ?? []).filter(p => p && typeof p.name === 'string').map(p => [p.name, p.value]));
  return Object.fromEntries(t.slots.filter(s => s.name in raw).map(s => {
    const v = raw[s.name];
    if (s.type === 'number') return [s.name, Number(v)];
    if (s.type === 'boolean') return [s.name, v === true || String(v).trim().toLowerCase() === 'true'];
    if (s.type === 'string[]') { try { const a = JSON.parse(v); if (Array.isArray(a)) return [s.name, a.map(String)]; } catch {} return [s.name, String(v).split(',').map(x => x.trim()).filter(Boolean)]; }
    return [s.name, String(v)];
  }));
}
export function instantiate(t, slots, budgetUsd) { return t.instantiate({ ...slots, budgetUsd }); }
