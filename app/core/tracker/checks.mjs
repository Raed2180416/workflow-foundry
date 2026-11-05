// Check templates for the condition tracker (task #60, research/tracker-20261021/DOSSIER.md §5). A check is one of a CLOSED set of
// templates whose semantics live here, in code. A model (or a person) only chooses a template and points into an enumerated
// vocabulary (./vocab.mjs): channels, sources, field paths and literals copied from the person's own words. Nothing here runs
// model-written code, and nothing here may invent a field: a path that names nothing simply matches nothing.
//
// A check is evaluated over a RunView (what one practice or live run did, as the person's own platform would show it):
//   { id, now, horizon, sources: { <name>: [Item] }, effects: [Effect], ordered?, reverses?: { <channel>: <channel it undoes> } }
//   Item   = { id, at, subject?, names: [string], fields }          a row of a sheet, an inbound message, or an effect used as a trigger
//   Effect = { id, seq, at, channel, status: 'applied'|'refused', subject?, fields, text }   what the flow did or tried to do
// and returns instances: { item, ok: true | false | null, why, refs }. ok null means undecided (censored, not acted on, not uniquely
// named). Statuses (./status.mjs) never read `null` as success: a check with no decided instance is "not exercised".
//
// Semantics that are fixed here, not chosen by a binder:
//  - Only APPLIED effects satisfy an obligation or count; REFUSED proposals (what the platform refused, nothing applied) count as
//    attempts: they make an item "acted on" and they are checked by `field` (what the flow tried to do must have the right shape).
//  - `when-then` and `scope` are gated: an item the flow never acted on (no effect names it after the trigger) is undecided, never a
//    violation, because the person's words rarely state every qualifier (a "new" lead, an "open" ticket). `count` is the strict form:
//    "every X gets at least / at most / exactly N".
//  - An item whose link value is shared with another item of the same source cannot be told apart by naming: undecided.
//  - Windows are inclusive on both ends (minutes). A window that closes after the run's horizon with no response is censored (null).
export const CHECKS_VERSION = 'tracker-checks/1';
/** Semantics levels: v1 (frozen, tracker-checks/1), v2 (deviation D2), v3 (D2 + D3); ./semantics.mjs. Each level keeps every rule below it. */
export const semanticsLevel = s => ({ v1: 1, v2: 2, v3: 3, v4: 4 }[s] ?? 1);

export const TEMPLATES = Object.freeze({
  present: 'at least one applied effect on `channel` matches `where` (one instance per run)',
  absent: 'no applied effect on `channel` matches `where` (one instance per run)',
  field: 'every effect on `channel` matching `where`, applied or refused, satisfies every `require` condition (one instance per effect)',
  count: 'per item of `source` matching `filter` (or once per run without a source): the applied effects on `channel` matching `where` and linked by `link` number at most / at least / exactly n',
  'when-then': 'per item of `source` matching `filter` that the flow acted on: an applied effect on `channel` linked by `link` satisfies `require`, inside `within` when given, with no `forbidBefore` effect first',
  scope: 'per item of `source`: an item matching `filter` that the flow acted on gets a linked applied effect on `channel` (matching `where`); an item not matching `filter` is never named by such an effect',
  order: 'per pair of applied effects linked by `link`: the `first` effect comes before the `then` effect',
});
export const TEMPLATE_NAMES = Object.freeze(Object.keys(TEMPLATES));

export const OPS = Object.freeze({
  eq: 'equals the value (text: case and spacing ignored; e-mail addresses compared exactly, case ignored)',
  ne: 'does not equal the value',
  contains: 'text contains the value (case, spacing and punctuation ignored)',
  notContains: 'text does not contain the value',
  in: 'equals one of the values',
  notIn: 'equals none of the values',
  lt: 'number less than', lte: 'number at most', gt: 'number more than', gte: 'number at least',
  exists: 'has a value', absent: 'has no value', nonEmpty: 'is a non-empty text or list',
  isTrue: 'is true', isFalse: 'is false (or missing)',
  ageDaysGte: 'a date at least n days before the run time', ageDaysLte: 'a date at most n days before the run time',
  ageHoursGte: 'a date-time at least n hours before the run time', ageHoursLte: 'a date-time at most n hours before the run time',
  inColumn: 'equals a value of `column` in source `source` (rows matching the condition\'s `filter` only)',
  notInColumn: 'equals no value of `column` in source `source`',
  subsetOf: 'every value is one of the trigger item\'s values at `itemPath` (when-then require only)',
});
export const OP_NAMES = Object.freeze(Object.keys(OPS));
export const LINK_OPS = Object.freeze({ eq: 'the effect field equals the item field', id: 'normalised ids are equal', mentions: 'the effect\'s field (or whole text, path "*") names the item: its value in the chosen column, or any other value unique to it (id, title, name, e-mail)' });

// ---------------------------------------------------------------------------------------------------------------------------------
// Values and text.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
/** Text normalisation for contains / mentions: lower case; runs of other characters than letters, digits and @ . - _ + become one space;
 *  those marks are then trimmed from each word's ends ("lena@x.de." -> "lena@x.de", a lone "@" goes). */
export const normText = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9@.\-_+]+/g, ' ').split(' ')
  .map(t => t.replace(/^[.\-_+@]+|[.\-_+@]+$/g, '')).filter(Boolean).join(' ');
/** Ids (E8 order ids and the like): trimmed, leading '#' dropped, upper case. */
export const normId = v => (typeof v === 'string' && v.trim() ? v.trim().replace(/^#/, '').toUpperCase() : typeof v === 'number' ? String(v) : null);
const scalarText = v => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
export const containsText = (hay, needle) => {
  const h = ` ${normText(hay)} `, n = normText(needle);
  if (!n) return false;
  // Word-boundary match so "paid" does not match "unpaid" and "1" does not match "10"; e-mail-like needles match as a whole token.
  return h.includes(` ${n} `) || (isEmail(needle) ? false : h.includes(` ${n}`) && /^[a-z0-9]/.test(n) && n.length >= 6);
};
// v2 (./semantics.mjs R-wording): free text, and a token-level match that tolerates inflection, abbreviation and number formats.
const tokens = s => normText(s).split(/[\s.\-_+]+/).filter(Boolean);
const stem = t => (t.length > 4 ? t.replace(/(ies|es|s|ed|ing)$/, '') : t);
/** Text a person writes in (a body, a post): a line break or four or more words. Ids, addresses and names are not free text. */
export const isFreeText = v => typeof v === 'string' && (v.includes('\n') || tokens(v).length >= 4);
/** Every word of the needle appears in the text: equal, as a prefix ("mon" in "monday", "9" in "9am"), or with the same stem. A
 *  24-hour clock time also reads as its 12-hour hour ("18:00" answers "6"). */
export function softContains(hay, needle) {
  const clock = [...String(hay ?? '').matchAll(/\b(1[3-9]|2[0-3]):[0-5]\d\b/g)].map(m => String(Number(m[1]) - 12));
  const h = [...tokens(hay), ...clock], n = tokens(needle);
  if (!n.length) return false;
  return n.every(t => h.some(x => x === t || (/^\d+$/.test(t) ? new RegExp(`^${t}(?!\\d)`).test(x) : (t.length >= 3 && x.startsWith(t)) || (t.length >= 4 && stem(x) === stem(t)))));
}
const textEq = (a, b) => {
  const x = scalarText(a), y = scalarText(b);
  if (x === null || y === null) return x === y && a === b;
  if (isEmail(x) || isEmail(y)) return x.trim().toLowerCase() === y.trim().toLowerCase();
  return normText(x) === normText(y);
};
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const ms = iso => { if (typeof iso !== 'string') return null; const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso); return Number.isFinite(t) ? t : null; };

/** All values at a dotted path; `[*]` expands an array ('args.items[*].key'). The path '*' is the effect's whole text. */
export function valuesAt(obj, path) {
  if (path === '*' || path == null) return [];
  let cur = [obj];
  for (const raw of String(path).split('.')) {
    const star = raw.endsWith('[*]'), key = star ? raw.slice(0, -3) : raw;
    const next = [];
    for (const c of cur) {
      if (!isObj(c) || !Object.hasOwn(c, key)) continue;
      const v = c[key];
      if (star) { if (Array.isArray(v)) next.push(...v); } else next.push(v);
    }
    cur = next;
  }
  return cur;
}
const hasPath = (obj, path) => valuesAt(obj, path).length > 0;

// ---------------------------------------------------------------------------------------------------------------------------------
// Conditions: { path, op, value?, values?, n?, source?, column?, filter?, itemPath? }. `ctx` carries the view (for inColumn and ages)
// and, inside when-then, the trigger item (for subsetOf).
function columnValues(view, source, column, filter) {
  const items = (view.sources?.[source] ?? []).filter(it => matchesAll(it.fields, filter ?? [], { view }));
  return items.flatMap(it => valuesAt(it.fields, column));
}
export function holds(target, cond, ctx = {}) {
  const { view = {}, item = null, whole = null } = ctx;
  const vals = cond.path === '*' ? [whole ?? ''] : valuesAt(target, cond.path);
  const op = cond.op;
  const v = cond.value ?? null, list = Array.isArray(cond.values) ? cond.values : (Array.isArray(v) ? v : null);
  const n = num(cond.n ?? cond.value);
  const now = ms(view.now);
  const ageOk = (x, unit, cmp) => { const t = ms(x); if (t === null || now === null) return false; const age = (now - t) / (unit === 'd' ? 86_400_000 : 3_600_000); return cmp(age); };
  switch (op) {
    case 'exists': return vals.some(x => x !== null && x !== undefined && x !== '');
    case 'absent': return !vals.some(x => x !== null && x !== undefined && x !== '');
    case 'nonEmpty': return vals.length > 0 && vals.every(x => (typeof x === 'string' && x.trim().length > 0) || (Array.isArray(x) && x.length > 0));
    case 'isTrue': return vals.some(x => x === true || x === 'true');
    case 'isFalse': return !vals.some(x => x === true || x === 'true');
    case 'eq': return vals.some(x => textEq(x, v));
    case 'ne': return vals.length > 0 && vals.every(x => !textEq(x, v));
    case 'contains': {
      const texts = vals.map(x => (Array.isArray(x) ? x.join(' ') : x));
      if (texts.some(x => containsText(x, v))) return true;
      if (!cond.wording) return false;                                    // v1: exact words only
      const free = texts.filter(x => cond.path === '*' || isFreeText(x));
      if (free.some(x => softContains(x, v))) return true;
      return cond.wording === 'soft' && free.length ? null : false;      // soft wording missed in free text: undecided
    }
    case 'notContains': return !vals.some(x => containsText(Array.isArray(x) ? x.join(' ') : x, v));
    case 'in': return !!list && vals.some(x => list.some(y => textEq(x, y)));
    case 'notIn': return !!list && vals.length > 0 && vals.every(x => !list.some(y => textEq(x, y)));
    case 'lt': return n !== null && vals.some(x => num(x) !== null && num(x) < n);
    case 'lte': return n !== null && vals.some(x => num(x) !== null && num(x) <= n);
    case 'gt': return n !== null && vals.some(x => num(x) !== null && num(x) > n);
    case 'gte': return n !== null && vals.some(x => num(x) !== null && num(x) >= n);
    case 'ageDaysGte': return n !== null && vals.some(x => ageOk(x, 'd', a => a >= n));
    case 'ageDaysLte': return n !== null && vals.some(x => ageOk(x, 'd', a => a <= n));
    case 'ageHoursGte': return n !== null && vals.some(x => ageOk(x, 'h', a => a >= n));
    case 'ageHoursLte': return n !== null && vals.some(x => ageOk(x, 'h', a => a <= n));
    case 'inColumn': { const col = columnValues(view, cond.source, cond.column, cond.filter); return vals.some(x => col.some(y => textEq(x, y))); }
    case 'notInColumn': { const col = columnValues(view, cond.source, cond.column, cond.filter); return vals.length > 0 && vals.every(x => !col.some(y => textEq(x, y))); }
    case 'subsetOf': {
      if (!item || !cond.itemPath) return false;
      const allowed = valuesAt(item.fields, cond.itemPath);
      return vals.length > 0 && vals.every(x => allowed.some(y => x === y || textEq(x, y)));
    }
    default: return false;
  }
}
export const matchesAll = (target, conds, ctx) => (conds ?? []).every(c => holds(target, c, ctx) === true);
/** Three-valued: false if any condition fails, null if none fails and one is undecided (v2 soft wording), else true. */
export function matches3(target, conds, ctx) {
  let r = true;
  for (const c of conds ?? []) { const h = holds(target, c, ctx); if (h === false) return false; if (h === null) r = null; }
  return r;
}
const effectMatches = (e, conds, ctx = {}) => matchesAll(e.fields, conds, { ...ctx, whole: e.text });
const effectMatches3 = (e, conds, ctx = {}) => matches3(e.fields, conds, { ...ctx, whole: e.text });
const and3 = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);

// ---------------------------------------------------------------------------------------------------------------------------------
// Links between an item and an effect.
function linkValues(item, link) { return link?.item === '@subject' ? [item.subject] : valuesAt(item.fields, link?.item).filter(x => scalarText(x) !== null); }
/**
 * The values an effect may use to name an item under a `mentions` link: the chosen column's value, plus every naming value code found
 * for the item (columns whose values tell the rows apart: an id, a title, a name, an e-mail). A binder that picks a column the flow
 * does not print (an alert id where the post prints the message) therefore cannot turn a correct effect into a violation. Values shared
 * with another item of the same source are dropped (`shared`), so an effect never answers for an item it cannot tell apart.
 */
/** v2 (./semantics.mjs R-names): an extra naming value must be distinctive to name a row on its own. */
export const informativeName = v => { const t = normText(v); return /[0-9@]/.test(t) || t.split(' ').length >= 2 || t.length >= 8; };
const extraNames = (item, informative) => (item.names ?? []).filter(n => !informative || (scalarText(n) !== null && informativeName(n)));
function namesFor(item, link, shared = null, informative = false) {
  const vals = [...linkValues(item, link), ...extraNames(item, informative)].map(v => scalarText(v)).filter(v => v !== null && normText(v).length >= 3);
  return [...new Set(vals)].filter(v => !shared || !shared.has(normText(v)));
}
/** Does effect e answer item `item` under `link`? */
export function linked(item, e, link, shared = null, informative = false) {
  if (!link) return true;
  const evals = link.effect === '*' ? [e.text] : link.effect === '@subject' ? [e.subject] : valuesAt(e.fields, link.effect);
  if (link.op === 'mentions') return namesFor(item, link, shared, informative).some(a => evals.some(b => containsText(Array.isArray(b) ? b.join(' ') : b, a)));
  const ivals = linkValues(item, link);
  if (!ivals.length) return false;
  if (link.op === 'id') return ivals.some(a => evals.some(b => normId(scalarText(a)) !== null && normId(scalarText(a)) === normId(scalarText(b))));
  return ivals.some(a => evals.some(b => textEq(a, b)));
}
/** Naming values shared by two or more items of a source (a `mentions` link cannot use them). Empty for eq / id links. */
function sharedNames(items, link, informative = false) {
  const out = new Set();
  if (!link || link.op !== 'mentions') return out;   // eq / id links are structured: one effect may answer several items
  const seen = new Map();
  for (const it of items) for (const v of new Set(namesFor(it, link, null, informative).map(normText))) seen.set(v, (seen.get(v) ?? 0) + 1);
  for (const [v, n] of seen) if (n > 1) out.add(v);
  return out;
}
/** Items left with no name of their own cannot be told apart by an effect that names them. */
function ambiguous(items, link, shared, informative = false) {
  if (!link || link.op !== 'mentions') return new Set();
  return new Set(items.filter(it => namesFor(it, link, shared, informative).length === 0));
}
/** The flow acted on an item: some effect (applied or refused) other than the trigger itself names it, after the trigger. Names shared
 *  with another item of the source (`shared`) do not count: an effect naming them cannot say which item it is about. */
export function actedOn(item, view, { after = -Infinity, except = null, shared = null, informative = false } = {}) {
  const names = extraNames(item, informative).filter(n => normText(n).length >= 3 && !(shared && shared.has(normText(n))));
  return view.effects.some(e => e !== except && e.seq > after && (
    (item.subject && e.subject && item.subject === e.subject) || names.some(n => containsText(e.text, n))));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Evaluation.
const applied = e => e.status === 'applied';
const ref = e => e?.id ?? null;
const inst = (item, ok, why, refs = []) => ({ item: item ? { id: item.id, subject: item.subject ?? null, at: item.at ?? null } : null, ok, why, refs: refs.filter(Boolean) });
const sourceItems = (view, source, filter) => (view.sources?.[source] ?? []).filter(it => matchesAll(it.fields, filter ?? [], { view }));
const describeEffect = e => `${e.channel}${e.fields?.to ? ` to ${e.fields.to}` : e.fields?.channel ? ` in ${e.fields.channel}` : e.fields?.sheet ? ` on ${e.fields.sheet}` : ''}`;

function windowOf(item, within, view, { deadline = false } = {}) {
  if (!within) return null;
  const anchor = within.anchor === '@at' ? item.at : valuesAt(item.fields, within.anchor)[0] ?? null;
  const t = ms(anchor);
  if (t === null) return { bad: true };
  // v3 (./semantics.mjs R-deadline): "within 60 min of p" is a deadline. A window that opens at 0 bounds lateness only; an answer before
  // the anchor (one emitted in the trigger's own tick, before the trigger's commit time; one already given before a re-delivered
  // message) is in time. Only a window that opens later than 0 ("3 days after the due date") also forbids being early.
  const lo = deadline && !(within.min > 0) ? -Infinity : t + (within.min ?? 0) * 60_000;
  return { lo, hi: t + (within.max ?? 0) * 60_000, censored: view.horizon ? ms(view.horizon) < t + (within.max ?? 0) * 60_000 : false };
}

/** v3 (./semantics.mjs R-outcome): a path in what the system answered (`result.*`), which the flow does not choose. */
export const isOutcomePath = p => typeof p === 'string' && /^result(\.|\[|$)/.test(p);
/** v3 (R-commit): an effect that was refused, or whose result failed, did not happen as an event. */
export const failedEffect = e => !!e && (e.status !== 'applied' || ['error', 'failed', 'refused'].includes(String(e.fields?.result?.status ?? '').toLowerCase()) || !!e.fields?.result?.error);
/** Does the check's filter read the trigger's outcome (the person's words name the failure, as in "if a batch comes back partial")? */
const filterReadsOutcome = check => (check.filter ?? []).some(c => isOutcomePath(c?.path));

function evalWhenThen(check, view, { scope = false, informative = false, unordered = false, state = false, deadline = false, commit = false, outcome = false, discharge = false } = {}) {
  const all = view.sources?.[check.source] ?? [];
  const shared = sharedNames(all, check.link, informative), amb = ambiguous(all, check.link, shared, informative);
  const ctx = { view };
  const out = [];
  // v3 (./semantics.mjs R-state): a row already on a sheet the flow writes to can answer the item ("sync them to the list" when one is
  // there already); it only ever satisfies, never violates.
  const before = state && check.channel === 'row' ? stateRows(check, view) : [];
  // v3 (R-outcome): requirements on what the system answered are kept apart from what the flow asked for.
  const flowReq = outcome ? (check.require ?? []).filter(c => !isOutcomePath(c?.path)) : (check.require ?? []);
  const outcomeReq = outcome ? (check.require ?? []).filter(c => isOutcomePath(c?.path)) : [];
  for (const item of all) {
    const trig = view.effects.find(e => e.id === item.id && item.isEffect) ?? null;
    // v3 (R-commit): "after the charge" means after a charge that happened; a refused or failed attempt is no trigger, unless the
    // person's words are about the outcome itself (the filter reads result.*).
    if (commit && item.isEffect && failedEffect(trig ?? { status: 'refused' }) && !filterReadsOutcome(check)) continue;
    const matches = matchesAll(item.fields, check.filter ?? [], ctx);
    const after = trig ? trig.seq : -Infinity;
    if (!matches) {
      if (!scope) continue;
      if (amb.has(item)) continue;
      const named = view.effects.filter(e => applied(e) && e.channel === check.channel && e.seq > after && effectMatches(e, check.where, ctx) && linked(item, e, check.link, shared, informative));
      out.push(inst(item, named.length === 0, named.length ? `not in scope, yet ${describeEffect(named[0])} names it` : 'not in scope and not named', named.map(ref)));
      continue;
    }
    if (amb.has(item)) { out.push(inst(item, null, 'its name is shared with another item, so effects cannot be told apart')); continue; }
    const win = windowOf(item, check.within, view, { deadline });
    if (win?.bad) { out.push(inst(item, null, 'the window anchor has no time')); continue; }
    const inWin = e => !win || (ms(e.at) >= win.lo && ms(e.at) <= win.hi);
    // Each linked effect on the channel, with its three-valued fit (v1 never yields undecided: no wording annotations). v3 (R-deadline):
    // with a deadline window on an inbound item (a message, a row), an answer given before the item arrived counts too (a re-delivered
    // order already recorded). After an effect trigger ("after the charge, ship") the answer must still come after it.
    const early = deadline && win && !(check.within.min > 0) && !item.isEffect;
    const linkedOnChannel = view.effects.filter(e => applied(e) && e.channel === check.channel && (e.seq > after || early) && e !== trig && linked(item, e, check.link, shared, informative));
    const cands = linkedOnChannel.filter(e => effectMatches3(e, check.where, ctx) === true);
    const good = cands.filter(e => matchesAll(e.fields, flowReq, { view, item, whole: e.text }) && matchesAll(e.fields, outcomeReq, { view, item, whole: e.text }) && inWin(e));
    const maybe = linkedOnChannel.filter(e => !good.includes(e) && inWin(e) && and3(effectMatches3(e, check.where, ctx), matches3(e.fields, flowReq, { view, item, whole: e.text })) === null);
    // v3 (R-outcome): the flow asked for the right thing in time and the system said no (a declined card): not the flow's verdict.
    const askedRight = outcomeReq.length ? cands.filter(e => !good.includes(e) && inWin(e) && matchesAll(e.fields, flowReq, { view, item, whole: e.text })) : [];
    const firstGood = good[0] ?? null;
    if (check.forbidBefore) {
      const fb = check.forbidBefore;
      // v2: a record that does not keep the order of effects cannot show what came first (any forbidden effect leaves it open).
      const bad = view.effects.find(e => applied(e) && e.channel === fb.channel && e.seq > after && (unordered || !firstGood || e.seq < firstGood.seq)
        && effectMatches(e, fb.where, ctx) && (fb.link ? linked(item, e, fb.link, shared, informative) : linked(item, e, check.link, shared, informative)));
      if (bad && unordered) { out.push(inst(item, null, `order unknown: ${describeEffect(bad)} also happened and this record does not keep the order of effects`, [item.id, ref(bad)])); continue; }
      if (bad && (firstGood || actedOn(item, view, { after, except: trig, shared, informative }))) { out.push(inst(item, false, `${describeEffect(bad)} came first`, [item.id, ref(bad), ref(firstGood)])); continue; }
    }
    if (firstGood) { out.push(inst(item, true, `${describeEffect(firstGood)} answers it`, [item.id, ref(firstGood)])); continue; }
    const already = before.find(e => linked(item, e, check.link, shared, informative) && matchesAll(e.fields, check.require ?? [], { view, item, whole: e.text }));
    if (already) { out.push(inst(item, true, `already on ${already.fields.sheet} before the run`, [item.id])); continue; }
    if (maybe.length) { out.push(inst(item, null, `wording: ${describeEffect(maybe[0])} names it and may say it in other words`, [item.id, ref(maybe[0])])); continue; }
    if (askedRight.length) { out.push(inst(item, null, `outcome: ${describeEffect(askedRight[0])} asked for it and the system answered ${JSON.stringify(askedRight[0].fields?.result?.status ?? null)}`, [item.id, ref(askedRight[0])])); continue; }
    // v3 (./semantics.mjs R-discharge): the trigger was undone later by the op the platform declares as its reversal (a refund of the
    // charge after a cancellation): the obligation that followed from it lapsed; it was not broken.
    const undone = discharge && trig ? view.effects.find(e => applied(e) && view.reverses?.[e.channel] === trig.channel && e.seq > trig.seq
      && linked(item, e, check.link ? { ...check.link, effect: check.link.item } : null, shared, informative)) : null;
    if (undone) { out.push(inst(item, null, `discharged: ${describeEffect(undone)} reversed it`, [item.id, ref(undone)])); continue; }
    if (win?.censored) { out.push(inst(item, null, 'censored: the window closes after the run ended', [item.id])); continue; }
    // A linked candidate is itself the flow acting on the item; otherwise any effect naming the item counts.
    if (!cands.length && !actedOn(item, view, { after, except: trig, shared, informative })) { out.push(inst(item, null, 'not acted on', [item.id])); continue; }
    const why = cands.length ? `${describeEffect(cands[0])} names it but ${win && !inWin(cands[0]) ? 'falls outside the window' : 'does not meet the requirement'}`
      : `acted on, but no ${check.channel} effect names it`;
    out.push(inst(item, false, why, [item.id, ref(cands[0])]));
  }
  return out;
}

/** A count verdict when `maybe` more effects may also match (v2 soft wording): decided only if every possible count agrees. */
function countVerdict(check, sure, maybe) {
  const cmp = c => (check.op === 'atMost' ? c <= check.n : check.op === 'atLeast' ? c >= check.n : c === check.n);
  const seen = new Set();
  for (let k = 0; k <= maybe; k++) seen.add(cmp(sure + k));
  return seen.size === 1 ? [...seen][0] : null;
}
/**
 * v2 (./semantics.mjs R-state): rows already on a sheet the flow writes to, as pseudo-effects. "Make sure the list has everyone" is a
 * state: a contact already on the list needs no new row, so for "at least" on the row channel the sheet's rows before the run count too.
 */
function stateRows(check, view) {
  const sheets = new Set(view.effects.filter(e => e.channel === 'row' && typeof e.fields?.sheet === 'string').map(e => e.fields.sheet));
  const out = [];
  for (const s of sheets) for (const it of view.sources?.[s] ?? []) {
    const fields = { sheet: s, row: it.fields };
    out.push({ id: `${it.id}@before`, seq: 0, at: null, channel: 'row', status: 'applied', fields, text: `${s}\n${Object.values(it.fields).map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join('\n')}`, before: true });
  }
  return out.filter(e => effectMatches3(e, check.where, { view }) === true);
}
function evalCount(check, view, { informative = false, state = false, commit = false, perRun = false } = {}) {
  const ctx = { view };
  const onChannel = view.effects.filter(e => applied(e) && e.channel === check.channel);
  const matching = onChannel.filter(e => effectMatches3(e, check.where, ctx) === true);
  const maybeM = onChannel.filter(e => effectMatches3(e, check.where, ctx) === null);
  // v4 (./semantics.mjs R-per-run): a count with no source item is "N such effects in one run" (renderCheck says so). On a view that
  // joins two runs (the repeat view, ./practice.mjs joinViews tags each effect with its run), each run is counted on its own.
  if (!check.source && perRun && Array.isArray(view.runs) && view.runs.length > 1) {
    return view.runs.map((_, r) => {
      const c = matching.filter(e => (e.run ?? 0) === r), m = maybeM.filter(e => (e.run ?? 0) === r);
      return inst(null, countVerdict(check, c.length, m.length), `run ${r + 1}: ${c.length} matching ${check.channel} effect(s)${m.length ? ` (${m.length} more may match in other words)` : ''}; want ${check.op} ${check.n}`, c.slice(0, 3).map(ref));
    });
  }
  if (!check.source) {
    const c = matching.length;
    return [inst(null, countVerdict(check, c, maybeM.length), `${c} matching ${check.channel} effect(s)${maybeM.length ? ` (${maybeM.length} more may match in other words)` : ''}; want ${check.op} ${check.n}`, matching.slice(0, 3).map(ref))];
  }
  const all = view.sources?.[check.source] ?? [];
  const shared = sharedNames(all, check.link, informative), amb = ambiguous(all, check.link, shared, informative);
  const before = state && check.channel === 'row' && check.op === 'atLeast' ? stateRows(check, view) : [];
  // v3 (R-commit): a refused or failed effect is no item to count for, unless the filter reads its outcome.
  const happened = item => !commit || !item.isEffect || filterReadsOutcome(check) || !failedEffect(view.effects.find(e => e.id === item.id) ?? { status: 'refused' });
  return sourceItems(view, check.source, check.filter).filter(happened).map(item => {
    if (amb.has(item)) return inst(item, null, 'its name is shared with another item, so effects cannot be told apart');
    const mine = matching.filter(e => linked(item, e, check.link, shared, informative));
    const mineMaybe = maybeM.filter(e => linked(item, e, check.link, shared, informative));
    const already = before.filter(e => linked(item, e, check.link, shared, informative));
    return inst(item, countVerdict(check, mine.length + already.length, mineMaybe.length), `${mine.length} ${check.channel} effect(s) name it${already.length ? ` (${already.length} already on the sheet)` : ''}${mineMaybe.length ? ` (${mineMaybe.length} more may, in other words)` : ''}; want ${check.op} ${check.n}`, [item.id, ...mine.slice(0, 3).map(ref)]);
  });
}

function evalOrder(check, view) {
  const ctx = { view };
  const firsts = view.effects.filter(e => applied(e) && e.channel === check.first.channel && effectMatches(e, check.first.where, ctx));
  const thens = view.effects.filter(e => applied(e) && e.channel === check.then.channel && effectMatches(e, check.then.where, ctx));
  const out = [];
  for (const b of thens) {
    const as = firsts.filter(a => {
      const av = valuesAt(a.fields, check.link.first), bv = valuesAt(b.fields, check.link.then);
      return av.some(x => bv.some(y => (check.link.op === 'id' ? normId(scalarText(x)) === normId(scalarText(y)) && normId(scalarText(x)) !== null : textEq(x, y))));
    });
    if (!as.length) continue;
    const ok = as.some(a => a.seq < b.seq);
    out.push(inst({ id: b.id, subject: b.subject, at: b.at }, ok, ok ? `${check.first.channel} came first` : `${check.then.channel} came before any ${check.first.channel}`, [ref(as[0]), ref(b)]));
  }
  return out;
}

/**
 * evaluate(check, view, { semantics }) → { instances, activated, decided, violated }. semantics 'v1' (the default here: the frozen
 * tracker-checks/1), 'v2' (deviation D2), 'v3' (D2 + D3) or 'v4' (v3 + D4), ./semantics.mjs. Wording rules come from the check's own annotations, which only
 * semantics.prepareCheck adds.
 */
export function evaluate(check, view, { semantics = 'v1' } = {}) {
  if (!check || !TEMPLATE_NAMES.includes(check.template)) throw Object.assign(new Error(`not a check template: ${check?.template}`), { code: 'TRACKER_TEMPLATE' });
  const ctx = { view };
  const lvl = semanticsLevel(semantics);
  const informative = lvl >= 2;
  const unordered = lvl >= 2 && view.ordered === false;   // v2: an app run's record (outbox, chat, sheets) keeps no order across effects
  let instances;
  switch (check.template) {
    case 'present': {
      const on = view.effects.filter(e => applied(e) && e.channel === check.channel);
      const hit = on.filter(e => effectMatches3(e, check.where, ctx) === true);
      const maybe = hit.length ? [] : on.filter(e => effectMatches3(e, check.where, ctx) === null);
      instances = [inst(null, hit.length ? true : maybe.length ? null : false,
        hit.length ? `${describeEffect(hit[0])} matches` : maybe.length ? `wording: ${describeEffect(maybe[0])} may say it in other words` : `no ${check.channel} effect matches`, (hit.length ? hit : maybe).slice(0, 3).map(ref))];
      break;
    }
    case 'absent': {
      const hit = view.effects.filter(e => applied(e) && e.channel === check.channel && effectMatches(e, check.where, ctx));
      instances = [inst(null, hit.length === 0, hit.length ? `${describeEffect(hit[0])} happened` : `no matching ${check.channel} effect`, hit.slice(0, 3).map(ref))];
      break;
    }
    case 'field': {
      const sel = view.effects.filter(e => e.channel === check.channel && effectMatches(e, check.where, ctx));
      instances = sel.map(e => {
        // v3 (R-outcome): what the system answered (result.*) is not the flow's to choose; a failed outcome is undecided.
        const verdicts = (check.require ?? []).map(c => { const h = holds(e.fields, c, { view, whole: e.text }); return [c, lvl >= 3 && h === false && isOutcomePath(c.path) ? null : h]; });
        const failed = verdicts.filter(([, h]) => h === false).map(([c]) => c), maybe = verdicts.filter(([, h]) => h === null).map(([c]) => c);
        return inst({ id: e.id, subject: e.subject ?? null, at: e.at }, failed.length ? false : maybe.length ? null : true,
          failed.length ? `${describeEffect(e)}${e.status === 'refused' ? ' (refused)' : ''}: ${failed[0].path} ${failed[0].op}${failed[0].value !== undefined ? ` ${JSON.stringify(failed[0].value)}` : ''} does not hold`
            : maybe.length ? `wording: ${describeEffect(e)} may say ${JSON.stringify(maybe[0].value)} in other words` : 'holds', [ref(e)]);
      });
      break;
    }
    case 'count': instances = evalCount(check, view, { informative, state: lvl >= 2, commit: lvl >= 3, perRun: lvl >= 4 }); break;
    case 'when-then': instances = evalWhenThen(check, view, { informative, unordered, state: lvl >= 3, deadline: lvl >= 3, commit: lvl >= 3, outcome: lvl >= 3, discharge: lvl >= 3 }); break;
    case 'scope': instances = evalWhenThen(check, view, { scope: true, informative, unordered, state: lvl >= 3, deadline: lvl >= 3, commit: lvl >= 3, outcome: lvl >= 3, discharge: lvl >= 3 }); break;
    case 'order': instances = evalOrder(check, view).map(i => (unordered ? { ...i, ok: null, why: `order unknown: this record does not keep the order of effects (${i.why})` } : i)); break;
  }
  const decided = instances.filter(i => i.ok !== null);
  return { view: view.id ?? null, instances, activated: instances.length, decided: decided.length, violated: decided.filter(i => i.ok === false).length,
    notActedOn: instances.filter(i => i.ok === null && i.why === 'not acted on').length };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plain words for a check (read back to the person before they confirm it; EARS-like: "When …, …").
const CHANNEL_WORDS = { email: 'an e-mail', chat: 'a chat post', row: 'a sheet row' };
const condWords = c => {
  const what = c.path === '*' ? 'its text' : c.path;
  const val = c.values ? c.values.map(x => `“${x}”`).join(' or ') : c.value !== undefined && c.value !== null ? `“${c.value}”` : c.n !== undefined ? String(c.n) : '';
  const words = { eq: 'is', ne: 'is not', contains: 'contains', notContains: 'does not contain', in: 'is', notIn: 'is not', lt: 'is under', lte: 'is at most', gt: 'is over', gte: 'is at least',
    exists: 'is set', absent: 'is not set', nonEmpty: 'is not empty', isTrue: 'is true', isFalse: 'is false', ageDaysGte: 'is at least', ageDaysLte: 'is at most', ageHoursGte: 'is at least', ageHoursLte: 'is at most',
    inColumn: 'is one of the', notInColumn: 'is none of the', subsetOf: 'is among the trigger\'s' };
  const unit = /^ageDays/.test(c.op) ? ' days old' : /^ageHours/.test(c.op) ? ' hours old' : '';
  if (c.op === 'inColumn' || c.op === 'notInColumn') return `${what} ${words[c.op]} ${c.column} values of ${c.source}${c.filter?.length ? ` (where ${c.filter.map(condWords).join(' and ')})` : ''}`;
  if (c.op === 'subsetOf') return `${what} ${words[c.op]} ${c.itemPath}`;
  return `${what} ${words[c.op] ?? c.op}${val ? ` ${val}` : ''}${unit}`;
};
const chan = c => CHANNEL_WORDS[c] ?? `a ${c} effect`;
const whereWords = w => (w?.length ? ` where ${w.map(condWords).join(' and ')}` : '');
const linkWords = l => (!l ? '' : l.op === 'mentions' ? ` naming its ${l.item}` : ` whose ${l.effect} matches its ${l.item}`);
export function renderCheck(check) {
  if (!check) return 'no check';
  switch (check.template) {
    case 'present': return `${chan(check.channel)}${whereWords(check.where)} happens.`;
    case 'absent': return `No ${chan(check.channel).replace(/^an? /, '')}${whereWords(check.where)} happens.`;
    case 'field': return `Every ${chan(check.channel).replace(/^an? /, '')}${whereWords(check.where)} has ${check.require.map(condWords).join(' and ')}.`;
    case 'count': return check.source ? `Each ${check.source} item${whereWords(check.filter)} gets ${check.op === 'atMost' ? 'at most' : check.op === 'atLeast' ? 'at least' : 'exactly'} ${check.n} ${check.channel}${whereWords(check.where)}${linkWords(check.link)}.`
      : `${check.op === 'atMost' ? 'At most' : check.op === 'atLeast' ? 'At least' : 'Exactly'} ${check.n} ${check.channel}${whereWords(check.where)} in one run.`;
    case 'when-then': case 'scope': {
      const req = check.require?.length ? ` with ${check.require.map(condWords).join(' and ')}` : '';
      const win = check.within ? ` within ${check.within.min}–${check.within.max} min of its ${check.within.anchor}` : '';
      const fb = check.forbidBefore ? `, and no ${check.forbidBefore.channel} before it` : '';
      const base = `When the flow handles a ${check.source} item${whereWords(check.filter)}, it sends ${chan(check.channel)}${whereWords(check.where)}${linkWords(check.link)}${req}${win}${fb}.`;
      return check.template === 'scope' ? `${base} Other ${check.source} items are never named in ${chan(check.channel)}.` : base;
    }
    case 'order': return `${check.first.channel}${whereWords(check.first.where)} comes before ${check.then.channel}${whereWords(check.then.where)} for the same ${check.link.first}.`;
    default: return 'unknown check';
  }
}
