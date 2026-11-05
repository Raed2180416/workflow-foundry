// Check semantics v2 (deviation D2 of research/tracker-20261021/PREREG-TRACKER.md §8). Each rule answers one root cause of a false
// alarm in the frozen run (RESULT-TRACKER.md §5), and each is a general rule about the person's words, never a per-case patch:
//
//  R-wording   A text requirement ("contains") is about content unless the person's words mark it as exact wording. Free text that
//              misses the literal words may still say the same thing ("Finished:" for "what's done", "Monday to Saturday, 9am to 6pm"
//              for "mon-sat 9-6"), so: an exact or token-level match holds; a miss on SOFT wording is undecided ("may say it in other
//              words"), never unmet. HARD wording (digits, @, symbols, quoted text, or a capitalised name that is not a sentence start,
//              as in "Sign it Nimbus Support") still fails.
//  R-closed    "scope" adds a closed-world half (no other item is ever named). It applies only when the person's words carry an
//              exclusive cue (only, just, never, don't, not, except ...). "New leads from the website form need to go to the right
//              person" is a when-then, not a promise that no other lead is ever mailed.
//  R-overlap   Two of the person's own rules can both claim one item ("big companies go straight to Raj" and "referrals go to Sofia"
//              for a big referral; "if a ticket asks about shipping" for a site-down report that mentions the shipping page). When the
//              build implements rule A elsewhere, followed another rule B for this item, A and B require different values of the same
//              field, and the item's place is ambiguous in the words (it is under B's filter too, or under A's only by a keyword in free
//              text), A's failure on that item is a question for the person (which rule is meant?), not a violation.
//  R-it        "Sign it X" applies to the messages the person means. A field rule over every message of a channel that holds for one
//              group of recipients and fails only for another group (the person's own address vs their customers; one chat channel vs
//              another; one sheet vs another) is a question (does it apply to those too?), not a violation.
//  R-names     A row's extra naming values must be distinctive (a digit or @, two or more words, or 8+ characters): a ticket whose body
//              is "Thanks!" is not named by every reply that says "Thanks for getting in touch".
//  R-objects   A check that selects a sheet by a name no run wrote to and no practice sheet has ("mailing list" when the sheet is
//              "newsletter") is suspect: names of system objects come from the system, not from the person's paraphrase.
//  R-order     An app run's record (outbox files, chat posts, appended rows) keeps no order across effects, so `order` and `forbidBefore`
//              are undecided on it (./practice.mjs marks those views ordered: false; E8 traces are time-ordered).
//  R-chimera   No synthesized practice row for a keyword filter on free text (./scenarios.mjs): appending "password" to a shipping
//              question makes a row whose category is ambiguous by construction.
//  R-state     "Make sure the list has everyone" is a state, not a count of new rows: for "at least N rows" the rows already on a
//              sheet the flow writes to count too (./checks.mjs stateRows).
//
// v3 = v2 + deviation D3 (designed on the remaining false alarms of the s1, s2 and rule bindings under v2 on BUILDER-1, and of the
// E8 bindings under v2; PREREG-TRACKER §8 D3). Development evidence; tested held-out only on the fresh set of PREREG-TRACKER-H:
//  R-state+    The same state rule for when-then and scope on rows: a contact already on the list answers "sync them to the list".
//  R-objects+  Columns too: the vocabulary's row columns are a union over every sheet, so a check can require "row.assignTo" of rows
//              that only another sheet has. Some one sheet (among those the check names) must have every row column the check uses,
//              by the person's data catalog, their sheets and the rows runs wrote; otherwise the check is suspect.
//  R-contra    A check that fixes one effect field twice (to = the lead's own address through its link, and to = raj@ through its
//              requirement) cannot pass for any ordinary item: suspect, never unmet.
//  R-deadline  "Within 60 min of p" is a deadline: a window that opens at 0 bounds lateness only. An answer emitted in the trigger's
//              own tick (before the trigger's commit time) is in time; for an inbound item, an answer given before it arrived (a
//              re-delivered order already recorded) answers it. A window that opens later than 0 still forbids being early.
//  R-commit    "Within 120 min of the commit of its charge": an effect used as a trigger is an event only if it happened (applied,
//              and its result did not fail); a declined charge is no charge to ship after. Unless the filter reads the outcome.
//  R-outcome   What the system answered (result.*) is not the flow's choice: a response that asked for the right thing in time but
//              got "declined" is undecided, never unmet (the flow is judged on what it asked; its handling of the failure is another
//              condition).
//  R-discharge An obligation that followed from an effect lapses when the platform-declared reversal of that effect follows (a refund
//              of the charge after the customer cancelled: no shipment is owed). Symboleo's discharge, not a violation.
//  (R-universal, gating per-item counts without a universal cue, was tried and dropped before the held-out freeze: "list whats done
//              and whats blocked" says every one without saying "every", and the rule hid a real omission; RESULT-TRACKER.md §5.)
//  R-qualifier Failures that fall exactly on the items with one value of a categorical column the person's words never mention
//              (unsubscribed = true, status = paid, receipt = false), while the check holds for the other items, are a question to the
//              person, not a verdict: a sound flow keeps qualifiers the person did not think to state.
//
// v4 = v3 + deviation D4 (2026-11-04, after the held-out scoring; two evaluator bugs the held-out adjudication found, RESULT-TRACKER
// §5 and §11). Both are bugs in how the tracker reads a practice run, not rules about the person's words, and each has a test where it
// must not fire (app/test/tracker/semantics.test.mjs). Development evidence until a fresh held-out set:
//  R-copy-names A condition-targeted copy of a row gets names that neither contain the original's nor are contained in them
//              (./scenarios.mjs): v1-v3 named the copy of "P-1" "P-1 S2", so an e-mail about the copy also named P-1.
//  R-per-run   A count with no source item ("at most 1 digest e-mail", rendered "in one run") is counted per run on the repeat view,
//              which joins two runs (./checks.mjs evalCount); v1-v3 counted the two runs' digests together. Per-item counts ("each
//              ticket at most once") still read both runs: "once" is about the next run.
//
// v1 is the frozen semantics (tracker-checks/1); v3 is the preregistered product (PREREG-TRACKER-H); v4 is the product default from
// 2026-11-04. `evaluate(check, view)` without options is v1.
import { normText, valuesAt, containsText, evaluate, matchesAll, isFreeText, semanticsLevel } from './checks.mjs';
import { locate } from './words.mjs';

export const SEMANTICS = Object.freeze({ v1: 'tracker-checks/1', v2: 'tracker-checks/2', v3: 'tracker-checks/3', v4: 'tracker-checks/4' });
export const DEFAULT_SEMANTICS = 'v4';

const EXCLUSIVE = /\b(only|just|solely|exclusively|never|not|no|none|nobody|nothing|except|excluding|exclude|skip|ignore|without|instead|dont|cannot|cant)\b|n['’]t\b|\bleave out\b|\bleft out\b/i;
/** Does the person's quote carry a closed-world cue? */
export const exclusiveCue = text => EXCLUSIVE.test(String(text ?? ''));

const QUOTES = new Set(['"', '\'', '“', '”', '‘', '’', '`', '«', '»']);
/** 'hard' when the person's words mark the literal as exact wording; 'soft' when it reads as content. */
export function wordingOf(value, words = []) {
  const v = String(value ?? '');
  if (/[0-9@#/<>$%&|:=]/.test(v)) return 'hard';
  const at = locate(words, v);
  if (!at) return 'hard';                                   // not the person's words (a data value): compared exactly
  const text = words.find(w => w.turn === at.turn)?.text ?? '';
  if (QUOTES.has(text[at.start - 1]) || QUOTES.has(text[at.end])) return 'hard';
  // A capitalised word inside the span that does not start a sentence is a name ("Nimbus Support", "Verdant Studio").
  for (const m of text.slice(at.start, at.end).matchAll(/[A-Za-z][\w'’-]*/g)) {
    if (!/^[A-Z]/.test(m[0])) continue;
    const before = text.slice(0, at.start + m.index).replace(/\s+$/, '');
    if (before.length && !/[.!?:\n(]$/.test(before)) return 'hard';
  }
  return 'soft';
}

const annotate = (conds, words) => (Array.isArray(conds) ? conds.map(c => (c && c.op === 'contains' ? { ...c, wording: wordingOf(c.value, words) } : c)) : conds);
/** The check as v2 evaluates it: scope without an exclusive cue becomes when-then; text requirements carry their wording strength. */
export function prepareCheck(check, { quote = '', words = [], semantics = DEFAULT_SEMANTICS } = {}) {
  if (!check || semanticsLevel(semantics) < 2) return check;
  const out = { ...check, where: annotate(check.where, words), require: annotate(check.require, words) };
  if (check.template === 'scope' && !exclusiveCue(quote)) { out.template = 'when-then'; out.closedWorld = 'dropped: no exclusive cue in the words'; }
  if (check.first) out.first = { ...check.first, where: annotate(check.first.where, words) };
  if (check.then) out.then = { ...check.then, where: annotate(check.then.where, words) };
  if (check.forbidBefore) out.forbidBefore = { ...check.forbidBefore, where: annotate(check.forbidBefore.where, words) };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Cross-condition rules over one build's results. results: Map(conditionId -> [result per view]) from checks.evaluate; mutated in place
// (an instance turned undecided keeps its old verdict in `was`).
const EQ_OPS = new Set(['eq', 'in']);
/** Effect fields a check fixes for one item: literals (eq / in) and structured links (to = the item's e-mail). */
function fixedFor(check, item) {
  const out = new Map();
  const add = (p, vals) => { const v = vals.filter(x => x !== null && x !== undefined && typeof x !== 'object').map(x => normText(x)); if (v.length) out.set(p, new Set([...(out.get(p) ?? []), ...v])); };
  for (const c of [...(check.where ?? []), ...(check.require ?? [])]) if (c && EQ_OPS.has(c.op)) add(c.path, c.op === 'in' ? c.values ?? [] : [c.value]);
  const l = check.link;
  if (l && ['eq', 'id'].includes(l.op) && l.effect && !['*', '@subject'].includes(l.effect)) add(l.effect, l.item === '@subject' ? [item.subject] : valuesAt(item.fields, l.item));
  return out;
}
/** Two checks conflict for an item when they fix the same effect field to disjoint values on the same channel. */
function conflicts(a, b, item) {
  if (a.channel !== b.channel) return false;
  const fa = fixedFor(a, item), fb = fixedFor(b, item);
  for (const [p, sa] of fa) { const sb = fb.get(p); if (sb && ![...sa].some(v => sb.has(v))) return true; }
  return false;
}
/** The item is in the check's filter only by a keyword in free text (a body that contains, or lacks, a word). */
const byKeyword = (filter, item) => (filter ?? []).some(c => ['contains', 'notContains'].includes(c.op) && valuesAt(item.fields, c.path).some(isFreeText));
const ITEM_TEMPLATES = new Set(['when-then', 'scope', 'count']);
const RESPONSE_TEMPLATES = new Set(['when-then', 'scope']);
function undecide(inst, why, extra = {}) { if (inst.ok === null) return; Object.assign(inst, { was: inst.ok, ok: null, why, ...extra }); }
function recount(r) {
  const decided = r.instances.filter(i => i.ok !== null);
  r.decided = decided.length; r.violated = decided.filter(i => i.ok === false).length;
  r.notActedOn = r.instances.filter(i => i.ok === null && i.why === 'not acted on').length;
}
/** The check's response with its filter dropped: does the build give this response to `itemId` (or, without one, to any item)? */
function responds(check, view, itemId, semantics) {
  const open = { ...check, template: 'when-then', filter: [] };
  return evaluate(open, view, { semantics }).instances.some(i => i.ok === true && (!itemId || i.item?.id === itemId));
}

/**
 * R-overlap. A's failure on item X becomes a question when (1) the build implements A (it gives A's response to some item, in some
 * view), (2) for X it gave the response of another of the person's rules B on the same source, and A and B fix the same field to
 * different values for X, and (3) X's place under A is ambiguous in the person's words: X is also under B's filter (the rules overlap),
 * or X is under A's filter only by a keyword in free text (a ticket that mentions "shipping" may not ask about shipping).
 */
export function overlapRule(conditions, results, views, { semantics = DEFAULT_SEMANTICS } = {}) {
  const items = conditions.filter(c => c.check && ITEM_TEMPLATES.has(c.check.template) && c.check.source);
  const others = items.filter(c => RESPONSE_TEMPLATES.has(c.check.template));
  const memo = new Map();
  const did = (b, k, id) => { const key = `${b.id}\u0000${k}`; if (!memo.has(key)) memo.set(key, new Set(evaluate({ ...b.check, template: 'when-then', filter: [] }, views[k], { semantics }).instances.filter(i => i.ok === true).map(i => i.item?.id))); return memo.get(key).has(id); };
  for (const a of items) {
    const ra = results.get(a.id) ?? [];
    if (!ra.some(r => r.instances.some(i => i.ok === false))) continue;
    if (!views.some(v => responds(a.check, v, null, semantics))) continue;          // (1) the build never gives A's response: A stands
    for (const [k, r] of ra.entries()) {
      for (const inst of r.instances) {
        if (inst.ok !== false || !inst.item?.id) continue;
        const item = (views[k].sources?.[a.check.source] ?? []).find(it => it.id === inst.item.id);
        if (!item) continue;
        const keyword = byKeyword(a.check.filter, item);
        const b = others.find(b => b !== a && b.check.source === a.check.source && conflicts(a.check, b.check, item)
          && (keyword || matchesAll(item.fields, b.check.filter ?? [], { view: views[k] })) && did(b, k, item.id));
        if (!b) continue;
        const how = keyword && !matchesAll(item.fields, b.check.filter ?? [], { view: views[k] }) ? 'the words do not say which rule this item falls under' : 'two of your rules apply to this item';
        undecide(inst, `${how}; the build followed ${b.id} ("${b.quote ?? ''}")`, { question: `"${a.quote ?? a.id}" or "${b.quote ?? b.id}": which one is meant for ${item.id}?`, overlap: b.id });
      }
      recount(r);
    }
  }
}

const RECIPIENT = { email: 'to', chat: 'channel', row: 'sheet' };
function recipientGroup(effect, words) {
  const path = RECIPIENT[effect?.channel];
  if (!path) return null;
  const v = valuesAt(effect.fields, path)[0];
  if (typeof v !== 'string') return null;
  if (effect.channel === 'email') return words.some(w => ` ${normText(w.text)} `.includes(` ${normText(v)} `)) ? { key: `your address ${v}`, own: v } : { key: 'other recipients', own: null };
  return { key: `${path} ${v}`, own: null };
}
/**
 * R-it. A field rule over every message of a channel ("sign it X") is a question, not a violation, for the messages it fails on when
 * (a) it holds for another group of recipients and fails only outside that group, or (b) it fails only on messages to addresses the
 * person gave for something else (their own inbox for "everything else goes to support@..."), which this rule's own words do not name.
 */
export function selectorRule(conditions, results, views, { words = [] } = {}) {
  for (const c of conditions) {
    const ch = c.check;
    if (!ch || ch.template !== 'field' || !RECIPIENT[ch.channel]) continue;
    if ((ch.where ?? []).some(w => w?.path === RECIPIENT[ch.channel])) continue;      // the person named whose messages it is about
    const rs = results.get(c.id) ?? [];
    const pass = new Set(), fail = [];
    rs.forEach((r, k) => {
      for (const inst of r.instances) {
        if (inst.ok === null) continue;
        const g = recipientGroup(views[k]?.effects.find(e => e.id === inst.item?.id), words);
        if (inst.ok) pass.add(g?.key ?? null); else fail.push({ inst, g });
      }
    });
    if (!fail.length || fail.some(f => !f.g)) continue;
    const split = pass.size > 0 && !pass.has(null) && fail.every(f => !pass.has(f.g.key));
    const ownOnly = fail.every(f => f.g.own && !` ${normText(c.quote ?? '')} `.includes(` ${normText(f.g.own)} `));
    if (!split && !ownOnly) continue;
    const failG = [...new Set(fail.map(f => f.g.key))];
    for (const f of fail) undecide(f.inst, split ? `holds for ${[...pass].join(', ')} but not for ${f.g.key}` : `fails only on messages to ${f.g.key}, which these words do not name`,
      { question: `"${c.quote ?? c.id}": does it apply to ${failG.join(' and ')} too?` });
    rs.forEach(recount);
  }
}

/**
 * The columns each sheet can have: the person's data catalog and sheets (`schemas`, from the vocabulary: { <sheet>: [column] }), the
 * rows a view starts with, and the rows any run wrote to it. Map(normalised sheet name -> { name, columns: Set }).
 */
export function sheetSchemas(gateViews, schemas = {}) {
  const out = new Map();
  const add = (name, cols) => { const k = normText(name); if (!out.has(k)) out.set(k, { name, columns: new Set() }); for (const c of cols) out.get(k).columns.add(c); };
  for (const [name, cols] of Object.entries(schemas ?? {})) add(name, cols);
  for (const v of gateViews) {
    for (const [name, items] of Object.entries(v.sources ?? {})) add(name, items.flatMap(it => Object.keys(it.fields ?? {})));
    for (const e of v.effects ?? []) if (e.channel === 'row' && typeof e.fields?.sheet === 'string') add(e.fields.sheet, Object.keys(e.fields.row ?? {}));
  }
  return out;
}
const rowColumn = p => (typeof p === 'string' && p.startsWith('row.') ? p.slice(4).split('.')[0].replace(/\[\*\]$/, '') : null);

/** R-objects: sheet names a check selects by that no view knows. Returns Map(conditionId -> why). */
export function unknownObjects(conditions, gateViews, { semantics = DEFAULT_SEMANTICS, schemas = {} } = {}) {
  const known = new Set();
  for (const v of gateViews) {
    for (const name of Object.keys(v.sources ?? {})) known.add(normText(name));
    for (const e of v.effects ?? []) if (e.channel === 'row' && typeof e.fields?.sheet === 'string') known.add(normText(e.fields.sheet));
  }
  const sheets = semanticsLevel(semantics) >= 3 ? sheetSchemas(gateViews, schemas) : null;
  const out = new Map();
  for (const c of conditions) {
    const ch = c.check;
    if (!ch) continue;
    const lists = [[ch.channel, ch.where], [ch.channel, ch.require], [ch.first?.channel, ch.first?.where], [ch.then?.channel, ch.then?.where], [ch.forbidBefore?.channel, ch.forbidBefore?.where]];
    // v3 (R-objects+, columns): the vocabulary's row columns are a union over every sheet, so a check can mix columns of two sheets
    // ("row.decision" of expense-decisions with "row.assignTo" of lead-log). Some one sheet, among those the check names (or any sheet
    // when it names none), must have every row column the check uses; otherwise the check selects nothing a flow could write.
    if (sheets && ch.channel === 'row') {
      const cols = new Set([...(ch.where ?? []), ...(ch.require ?? [])].map(k => rowColumn(k?.path)).filter(Boolean));
      if (ch.link?.effect) { const lc = rowColumn(ch.link.effect); if (lc) cols.add(lc); }
      const named = (ch.where ?? []).filter(k => k?.path === 'sheet' && ['eq', 'in', 'contains'].includes(k.op)).flatMap(k => (k.op === 'in' ? k.values ?? [] : [k.value]));
      const pool = named.length ? [...sheets.values()].filter(s => named.some(n => (normText(n) === normText(s.name) || containsText(s.name, n)))) : [...sheets.values()];
      if (cols.size && pool.length && !pool.some(s => [...cols].every(col => s.columns.has(col))))
        out.set(c.id, `no sheet${named.length ? ` called ${named.map(n => `"${n}"`).join(' or ')}` : ''} has every column this check uses (${[...cols].join(', ')})`);
    }
    for (const [channel, conds] of lists) {
      if (channel !== 'row') continue;
      for (const k of conds ?? []) {
        if (k?.path !== 'sheet' || !['eq', 'contains', 'in'].includes(k.op)) continue;
        const vals = k.op === 'in' ? k.values ?? [] : [k.value];
        const miss = vals.filter(v => ![...known].some(s => (k.op === 'contains' ? containsText(s, v) : s === normText(v))));
        if (miss.length === vals.length) out.set(c.id, `no practice sheet and no run's row is called ${vals.map(v => `"${v}"`).join(' or ')}`);
      }
    }
  }
  return out;
}

/**
 * v3 (R-qualifier). People rarely state every qualifier ("everyone from the CRM", not "everyone who has not unsubscribed"), and a sound
 * flow keeps qualifiers the person would want. When the items a check fails on are exactly the items with one value of a categorical
 * column (unsubscribed = true, status = paid, receipt = false) that the items it holds for never have, and neither that column nor that
 * value is in the check or anywhere in the person's words, the failures are a question for the person ("should items with
 * unsubscribed true be included?"), not a verdict. A failure the person's own words name (the column or the value) stays a violation.
 */
const CATEGORICAL_MAX = 6;
const scalar = v => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null);
function checkColumns(check) {
  const out = new Set();
  for (const c of check.filter ?? []) { if (c?.path) out.add(String(c.path).split('.')[0]); for (const f of c?.filter ?? []) if (f?.path) out.add(String(f.path).split('.')[0]); }
  for (const c of check.require ?? []) { if (c?.itemPath) out.add(String(c.itemPath).split('.')[0]); if (c?.column) out.add(String(c.column).split('.')[0]); }
  if (check.link?.item) out.add(String(check.link.item).split('.')[0]);
  if (check.within?.anchor) out.add(String(check.within.anchor).split('.')[0]);
  return out;
}
export function qualifierRule(conditions, results, views, { words = [] } = {}) {
  const said = ` ${words.map(w => normText(w.text)).join(' ')} `;
  const inWords = v => { const t = normText(v); return t.length > 0 && (said.includes(` ${t} `) || t.split(' ').filter(x => x.length >= 4).some(x => said.includes(` ${x} `) || said.includes(` ${x.replace(/s$/, '')} `))); };
  for (const c of conditions) {
    const ch = c.check;
    if (!ch || !ch.source || !ITEM_TEMPLATES.has(ch.template)) continue;
    const used = checkColumns(ch);
    const rs = results.get(c.id) ?? [];
    rs.forEach((r, k) => {
      const items = new Map((views[k]?.sources?.[ch.source] ?? []).map(it => [it.id, it]));
      const fail = r.instances.filter(i => i.ok === false && items.has(i.item?.id)), pass = r.instances.filter(i => i.ok === true && items.has(i.item?.id));
      if (!fail.length || !pass.length) return;
      const all = [...items.values()];
      const cols = new Set(all.flatMap(it => Object.keys(it.fields ?? {})));
      for (const col of cols) {
        if (used.has(col) || inWords(col.replace(/([a-z])([A-Z])/g, '$1 $2'))) continue;
        const vals = all.map(it => scalar(it.fields?.[col])).filter(v => v !== null);
        const distinct = new Set(vals.map(v => normText(v)));
        if (!vals.length || distinct.size > CATEGORICAL_MAX || distinct.size >= vals.length) continue;    // a naming or free column
        const fv = new Set(fail.map(i => normText(scalar(items.get(i.item.id).fields?.[col]))));
        const pv = new Set(pass.map(i => normText(scalar(items.get(i.item.id).fields?.[col]))));
        if (fv.size !== 1 || [...fv].some(v => pv.has(v))) continue;
        const v = [...fv][0];
        if (typeof scalar(items.get(fail[0].item.id).fields?.[col]) === 'string' && inWords(v)) continue;
        for (const i of fail) undecide(i, `qualifier: it fails only where ${col} is ${v}, which your words do not mention`, { question: `"${c.quote ?? c.id}": the flow did not do it for the items where ${col} is ${v}, and did for the others. Should items where ${col} is ${v} be included?`, qualifier: { column: col, value: v } });
        recount(r);
        return;
      }
    });
  }
}

/**
 * v3 (R-contradiction): a check that fixes one effect field twice, to the item's own value through its link and to a literal through
 * where / require ("an e-mail whose to is the lead's address, with to = raj@"), can only pass for an item whose value is that literal:
 * it cannot say anything about the others. Returns Map(conditionId -> why).
 */
export function contradictions(conditions) {
  const out = new Map();
  for (const c of conditions) {
    const ch = c.check, l = ch?.link;
    if (!ch || !l || !['eq', 'id'].includes(l.op) || !l.effect || ['*', '@subject'].includes(l.effect)) continue;
    const fixed = [...(ch.where ?? []), ...(ch.require ?? [])].find(k => k && k.path === l.effect && ['eq', 'in'].includes(k.op));
    if (fixed) out.set(c.id, `"${l.effect}" must equal the item's ${l.item} and ${JSON.stringify(fixed.value ?? fixed.values)} at once`);
  }
  return out;
}
