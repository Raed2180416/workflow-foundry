// requirement-ledger-v3: Δ* v1, the expected-diff contract (ATTACK §3 RC1, Move 1).
//
// Δ* for a request R, the rule-bearing records and the initial world W0 is a typed, closed-world description of the
// admissible diff:
//   O obligations   diff assertions (diff_type, entity, where, expected_count, content literals);
//   P prohibitions  mostly the COMPLEMENT of each selection inside its code-enumerated universe ("each active project"
//                   means all-and-only), compiled as hard negatives when the disposition is executed or quoted;
//   U unknowns      labelled nulls: an unestablished today, a member no predicate disposes of, a figure that depends on a
//                   null, a target no pointer resolves;
//   K identity      the entity key of every effect (harness/v3/registry.mjs keys effects the same way).
//
// Division of labour (RC4): readers write predicates, SELECTs, pointers and quotes; CODE enumerates the universes
// (universe.mjs), resolves pointers (pointers.mjs), evaluates predicates and figures on node:sqlite behind the sandbox
// (sqlsafe.mjs), derives today (clock.mjs), disposes EVERY member (include | exclude | unknown, each with its basis),
// takes the readers' consensus, compiles both directions into the check grammar (check.mjs) and emits the object in the
// Agent-Diff state-diff-contract shape (diff_type / entity / where / expected_count / strict).
//
// Disposition rules (fixed in code, before any replay was scored):
//   - a member is `exclude` only with an EXECUTED predicate (code ran the reader's test on the member's own attributes
//     and it held) or a VERBATIM rule quote (code found the quote in the request or a record); a reader's bare say-so is
//     recorded but never compiles to a hard check;
//   - a predicate that reads :today is evaluated on every day of the clock domain; a member whose disposition changes
//     inside the domain is UNKNOWN (a certain answer or nothing);
//   - members no reader disposes and no executed predicate covers are UNKNOWN;
//   - a predicate that reads an IDENTIFYING column (the member number, rowid, the label column or an id column), or no
//     column of its universe at all, is a list posing as a rule: its members are reader claims, never executed votes
//     (ATTACK (a): "predicates over attributes, not lists");
//   - a rule that CODE induces from a reader's listed claims (induceTest) is not a reader rule: its votes carry the basis
//     kind 'induced', never count as verified and never compile to a hard check (review of 2026-11-04, finding 7);
//   - consensus: with three or more readers, a hard disposition needs two agreeing verified votes and no more verified
//     votes against than for; with one or two readers, one verified vote and none against. An unverified include
//     majority needs no exclude vote of any kind;
//   - (c) and (d) of ATTACK Move 1: an obligation's recipient, channel or record is GROUNDED when the request or a record
//     shows it (an address, an enumerated channel, a resolved pointer), and each of its content literals when the request
//     or a record carries it verbatim; only grounded targets and literals compile to hard positives (msg_to, post_in,
//     msg_has, created_has); an ungrounded one is soft and listed as UNKNOWN.
// Generic by construction (PREREG-AB-v1 H7/H8): nothing here names a task, a grader check or a hidden assertion. The
// request, the records and every reader output are untrusted data; only SQL runs, and only inside sqlsafe.
import { createHash } from 'node:crypto';
import { emailsIn, grounded, norm } from './lib.mjs';
import { sqlTables } from './universe.mjs';
import { pointerIndex, normalizePointer } from './pointers.mjs';
import { runSelect, checkSqlText, checkPredicateText } from './sqlsafe.mjs';
import { deriveToday, domainDays, parseDate, requestDate } from './clock.mjs';
import { checkKey } from './compile.mjs';

export const DSTAR_VERSION = 'dstar-v1.1';   // v1.1: review of 2026-11-04 (findings 4-7, 13, 14)
export const EFFECT_CLASS = Object.freeze({ send_email: 'message', reply: 'message', post_message: 'message', create_record: 'create', add_row: 'create', schedule_event: 'create', update_record: 'update', update_row: 'update', delete_record: 'delete', other: 'other' });

const str = v => (v === null || v === undefined ? '' : String(v));
const uniq = xs => [...new Set(xs)];
const sha = s => createHash('sha256').update(String(s)).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// Targets

/** Normalise an obligation's target: {emails[], channel: {id, name} | null, container, ptr} with pointers resolved. */
function resolveTarget(t, pidx, channels) {
  const out = { emails: uniq((t?.emails ?? []).flatMap(e => emailsIn(e))), channel: null, container: null, ptr: null };
  const ch = str(t?.channel?.id ?? t?.channel?.name ?? t?.channel).replace(/^#/, '').trim();
  if (ch) {
    const c = channels.find(x => norm(x.id) === norm(ch) || norm(x.name) === norm(ch));
    out.channel = c ? { id: c.id, name: c.name } : { id: null, name: ch };
  }
  // the most specific id of a container: the last segment of a pointer or path (a worksheet, not its spreadsheet)
  if (t?.container) out.container = str(t.container).trim().replace(/^\[|\]$/g, '').split(/[:/]/).filter(Boolean).pop() ?? null;
  if (t?.ptr) { const h = normalizePointer(t.ptr, pidx); out.ptr = h.m ? h.m.key : null; out.ptrMember = h.m ?? null; }
  return out;
}
const targetKey = t => (t.emails.length ? `@${[...t.emails].sort().join(',')}` : t.channel ? `#${norm(t.channel.id ?? t.channel.name)}` : t.ptr ? `>${t.ptr}` : t.container ? `[${norm(t.container)}]` : '*');

// ---------------------------------------------------------------------------------------------------------------
// Verification of a reader's basis

/** A quote is verified when it occurs verbatim in the request or in one record (the source when given). */
export function verifyQuote(quote, { requestText, records }) {
  const q = str(quote?.text ?? quote).trim();
  if (q.length < 4) return false;
  if (grounded(q, requestText)) return 'request';
  for (const r of records) if (grounded(q, r.text)) return r.ptr;
  return false;
}
/** The attribute key of a member that a reader's field name means (case, spaces and punctuation ignored), or undefined. */
export const fieldKey = (member, field) => { const want = norm(field).replace(/[^a-z0-9]/g, ''); return want ? Object.keys(member.attrs ?? {}).find(k => norm(k).replace(/[^a-z0-9]/g, '') === want) : undefined; };
// A claimed value that states absence ("no note", "(none)", "empty", "n/a", "-"): it holds on an empty or missing field.
export const ABSENT_CLAIM = /^\(?\s*(no\b.*|none|empty|blank|missing|n\/?a|not set|null|nil|[-–—]|)\s*\)?$/i;
const isEmpty = v => v === null || v === undefined || String(v).trim() === '';

/** A reader's deciding test {field, value} executed on the member's own attributes: true | false | null (no such field
 *  and no absence claim). An absence claim holds on an empty or missing field and fails on a filled one. */
export function holdsTest(test, member) {
  if (!test?.field) return null;
  const key = fieldKey(member, test.field);
  const claimedAbsent = ABSENT_CLAIM.test(str(test.value).trim());
  if (key === undefined) return claimedAbsent ? true : null;
  const a = member.attrs[key];
  if (claimedAbsent) return isEmpty(a);
  const n1 = Number(str(a).replace(/[$,%\s]/g, '')), n2 = Number(str(test.value).replace(/[$,%\s]/g, ''));
  if (str(a).trim() !== '' && str(test.value).trim() !== '' && Number.isFinite(n1) && Number.isFinite(n2)) return Math.abs(n1 - n2) < 1e-9;
  return norm(a) === norm(test.value);
}

// ---------------------------------------------------------------------------------------------------------------
// Predicates and figures on the sandbox

const usesToday = sql => /:today\b/i.test(sql);
/** Columns that name a member rather than describe it: reading one makes a predicate a list. */
export const ID_COLUMN = /^(_mid|_label|rowid|_rowid_|oid|id|uuid|key|ptr)$|[ ._-]id$|[a-z]Id$/i;

/** Evaluate predicates (boolean expressions over one universe table, evaluated once per member as a projected column)
 *  and figures (full SELECTs) for every day of the clock domain that they need. Returns per item {status:
 *  'ok'|'error'|'unknown', byDay: Map(day -> rows), reads}. One sandbox call per build; a failed batch is retried per
 *  item (all its day-variants together) inside the build's time budget. */
function evaluateSql(items, { tables, clock, timeoutMs, budgetMs }) {
  const days = clock?.domain ? domainDays(clock.domain) : [];
  const queries = [], owners = [];
  for (const [i, it] of items.entries()) {
    let sql, trace;
    if (it.kind === 'where') {
      const pc = checkPredicateText(it.where);
      if (!pc.ok) { it.result = { status: 'error', error: `refused: ${pc.reason}` }; continue; }
      // the predicate is projected, never spliced into a WHERE clause: it cannot end the expression or add rows
      sql = `SELECT _mid, CASE WHEN (\n${it.where}\n) THEN 1 ELSE 0 END AS _hit FROM "${it.table}"`;
      trace = `SELECT CASE WHEN (\n${it.where}\n) THEN 1 ELSE 0 END FROM "${it.table}"`;
    } else sql = it.select;
    const st = checkSqlText(sql);
    if (!st.ok) { it.result = { status: 'error', error: `refused: ${st.reason}` }; continue; }
    const q = trace === undefined ? {} : { trace };
    if (usesToday(sql)) {
      if (!days.length) { it.result = { status: 'unknown', error: 'reads :today, which is a labelled null' }; continue; }
      for (const d of days) { queries.push({ sql, params: { today: d }, ...q }); owners.push([i, d]); }
    } else { queries.push({ sql, params: {}, ...q }); owners.push([i, null]); }
  }
  const res = queries.length ? runSelect({ tables, queries, timeoutMs, budgetMs, groupOf: (_, k) => owners[k][0] }) : [];
  res.forEach((r, k) => {
    const [i, d] = owners[k];
    const it = items[i];
    if (it.result?.status === 'error') return;
    if (!r.ok) { it.result = { status: 'error', error: `${r.error.code}: ${r.error.message}` }; return; }
    it.result ??= { status: 'ok', byDay: new Map(), reads: new Set() };
    for (const c of r.reads ?? []) it.result.reads.add(c);
    it.result.byDay.set(d, it.kind === 'where' ? r.rows.filter(x => Number(x._hit) === 1) : r.rows);
  });
  return items;
}

/** Is a predicate a list? It reads an identifying column of its own table, or no column of its own table at all. */
export function listLike(reads, table, labelColumn) {
  const own = [...(reads ?? [])].filter(c => c.startsWith(`${table}.`)).map(c => c.slice(table.length + 1));
  if (!own.length) return { list: true, why: 'it reads no attribute of the members' };
  const ids = own.filter(c => ID_COLUMN.test(c) || (labelColumn && c === labelColumn));
  return ids.length ? { list: true, why: `it reads ${ids.map(c => `"${c}"`).join(', ')}, which names members` } : { list: false, why: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Inducing an executable test from a reader's listed claims

const numOf = v => { const s = str(v).trim(); const d = parseDate(s); if (d) return Date.parse(`${d}T00:00:00Z`) / 86_400_000; const n = Number(s.replace(/[$€£,%\s]/g, '').replace('−', '-')); return s && Number.isFinite(n) ? n : null; };

/** Claims per side an induced rule needs (review of 2026-11-04, finding 7: one claim per side was enough before). */
export const INDUCE_MIN_PER_SIDE = 2;

/** From claims [{m, want, field, value}] (each verified on its member), induce one test over the universe or null:
 *  categorical (F IN include-values, with at least one value shared by two or more members of the universe) or threshold
 *  (numeric or date F, the include side and the exclude side separated). Both dispositions must occur with at least
 *  INDUCE_MIN_PER_SIDE claims each, and the rule never extrapolates: a categorical rule places only the values the claims
 *  show, a threshold rule only values inside one side's observed range. Its votes are CODE's induction, not a reader's
 *  rule: buildDstar records them with the basis kind 'induced', which is never verified and never hard. */
export function induceTest(claims, u) {
  if (claims.length < 2 * INDUCE_MIN_PER_SIDE) return null;
  const byField = new Map();
  for (const c of claims) { const f = norm(c.field); if (!byField.has(f)) byField.set(f, []); byField.get(f).push(c); }
  const [, cs] = [...byField].sort((a, b) => b[1].length - a[1].length)[0];
  if (cs.filter(c => c.want === 'include').length < INDUCE_MIN_PER_SIDE || cs.filter(c => c.want === 'exclude').length < INDUCE_MIN_PER_SIDE) return null;
  const field = cs[0].field;
  const valOf = m => { const k = fieldKey(m, field); return k === undefined ? undefined : m.attrs[k]; };
  const map = new Map();
  for (const c of cs) { const v = norm(valOf(c.m)); if (!map.has(v)) map.set(v, new Set()); map.get(v).add(c.want); }
  if ([...map.values()].some(s => s.size > 1)) return null;   // not a function of the value
  const ins = [...map].filter(([, s]) => s.has('include')).map(([v]) => v), outs = [...map].filter(([, s]) => s.has('exclude')).map(([v]) => v);
  if (!ins.length || !outs.length) return null;   // not discriminating: no rule tells the two sides apart
  const counts = new Map();
  for (const m of u.members) { const v = norm(valOf(m)); counts.set(v, (counts.get(v) ?? 0) + 1); }
  if ([...map.keys()].some(v => (counts.get(v) ?? 0) >= 2)) {
    const q = xs => xs.map(x => `'${x.replace(/'/g, "''")}'`).join(', ');
    return { kind: 'categorical', where: `"${field}" IN (${q(ins)}) /* else NOT IN (${q(outs)}) */`, apply: m => { const v = norm(valOf(m)); return ins.includes(v) ? 'include' : outs.includes(v) ? 'exclude' : null; } };
  }
  const nIn = cs.filter(c => c.want === 'include').map(c => numOf(valOf(c.m))), nOut = cs.filter(c => c.want === 'exclude').map(c => numOf(valOf(c.m)));
  if (nIn.some(x => x === null) || nOut.some(x => x === null)) return null;
  const [inLo, inHi, outLo, outHi] = [Math.min(...nIn), Math.max(...nIn), Math.min(...nOut), Math.max(...nOut)];
  if (!(inHi < outLo || outHi < inLo)) return null;
  const side = x => (x === null ? null : x >= inLo && x <= inHi ? 'include' : x >= outLo && x <= outHi ? 'exclude' : null);
  return { kind: 'threshold', where: `"${field}" in [${inLo}, ${inHi}] (include) / in [${outLo}, ${outHi}] (exclude); no extrapolation`, apply: m => side(numOf(valOf(m))) };
}

// ---------------------------------------------------------------------------------------------------------------
// The build

/**
 * buildDstar({request: {system, user}, universes, readers, hostNow, horizonDays, timeoutMs}) -> Δ*
 * readers: [{reader, today?, obligations: [{id, effect, app, target, literals, quote, source, selections: [{universe,
 *   where, members: [{ptr, in, test, quote}], perItem}], figures: [{id, select, format}]}], exclusions: [{universe,
 *   effect, app, where, members: [{ptr, quote, test}], quote}]}]
 */
export function buildDstar({ request = {}, universes = [], readers = [], hostNow = null, horizonDays, timeoutMs = 3000, budgetMs = 20_000, channels = null } = {}) {
  const requestText = `${str(request.user)}\n${str(request.system)}`;
  const pidx = pointerIndex(universes);
  const records = universes.flatMap(u => u.members);
  const chans = channels ?? universes.filter(u => u.app === 'slack' && /channel/.test(u.kind)).flatMap(u => u.members.map(m => ({ id: str(m.attrs.id ?? m.id), name: str(m.attrs.name ?? m.label) })));
  const ground = grounding({ requestText, records });
  const { tables, catalog } = sqlTables(universes);
  const tableOf = new Map(catalog.map(c => [c.uid, c.table]));
  const labelOf = new Map(catalog.map(c => [c.table, c.labelColumn]));
  const uByUid = new Map(universes.map(u => [u.uid, u]));
  const unknowns = [];
  const ledger = [];   // the disposition log: one row per (obligation, member, reader) vote

  // --- today (D28): the request's own date, else a reader's date stated by a quote OF THE REQUEST (a "today" or "as of"
  // in a record, such as an old e-mail, is that record's date, not the work's), else business dates
  let clock = deriveToday({ request: requestText, members: records, hostNow, horizonDays });
  if (clock.status !== 'explicit') {
    for (const R of readers) {
      const v = parseDate(R.today?.value);
      const said = requestDate(R.today?.quote);
      if (v && said && said.value === v && grounded(str(R.today.quote), requestText)) {
        clock = { status: 'explicit', value: v, domain: [v, v], basis: { quote: R.today.quote, reader: R.reader } };
        break;
      }
    }
  }
  if (clock.status === 'unknown') unknowns.push({ id: 'U-today', kind: 'today', about: 'today', why: clock.basis.why });

  // --- per reader: obligations, selections, dispositions
  const resolveUniverse = (sel) => {
    if (sel.universe && uByUid.has(sel.universe)) return uByUid.get(sel.universe);
    if (sel.universe) { const c = catalog.find(x => x.table === sel.universe || norm(x.title) === norm(sel.universe)); if (c) return uByUid.get(c.uid); }
    const counts = new Map();
    for (const x of sel.members ?? []) { const h = normalizePointer(x.ptr, pidx); if (h.u) counts.set(h.u, (counts.get(h.u) ?? 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const sqlItems = [];
  const obls = [];
  for (const R of readers) {
    for (const o of R.obligations ?? []) {
      const effect = EFFECT_CLASS[o.effect] ? o.effect : 'other';
      const target = resolveTarget(o.target, pidx, chans);
      const ob = { reader: R.reader, id: o.id, effect, eclass: EFFECT_CLASS[effect], app: str(o.app).toLowerCase(), target, literals: (o.literals ?? []).map(str).filter(Boolean), quote: o.quote ?? null, source: o.source ?? null, set: o.set?.field ? { field: str(o.set.field), value: str(o.set.value) } : null, selections: [], figures: [] };
      for (const s of o.selections ?? []) {
        const u = resolveUniverse(s);
        if (!u) { unknowns.push({ id: `U-sel-${R.reader}-${o.id}`, kind: 'universe', about: o.id, why: 'the selection names no enumerated universe' }); continue; }
        const sel = { u, where: s.where ?? null, members: s.members ?? [], perItem: s.perItem ?? null, partial: Boolean(s.partial), votes: new Map() };
        if (sel.where) { const it = { kind: 'where', table: tableOf.get(u.uid), where: sel.where, owner: sel }; sqlItems.push(it); sel.sql = it; }
        ob.selections.push(sel);
      }
      for (const f of o.figures ?? []) { const it = { kind: 'select', select: f.select, owner: f }; sqlItems.push(it); ob.figures.push({ id: f.id, select: f.select, format: f.format ?? null, sql: it }); }
      obls.push(ob);
    }
    for (const x of R.exclusions ?? []) {
      const u = resolveUniverse(x);
      if (!u) continue;
      const effect = EFFECT_CLASS[x.effect] ? x.effect : 'send_email';
      const ob = { reader: R.reader, id: x.id ?? `X${obls.length + 1}`, effect, eclass: EFFECT_CLASS[effect], app: str(x.app).toLowerCase(), target: resolveTarget(x.target ?? {}, pidx, chans), literals: [], quote: x.quote ?? null, source: x.source ?? null, exclusionOnly: true,
        selections: [{ u, where: x.where ? `NOT (${x.where})` : null, members: (x.members ?? []).map(m => ({ ...m, in: false })), perItem: x.perItem ?? true, partial: !x.where, exclusionOnly: true, votes: new Map() }], figures: [] };
      if (x.where) { const it = { kind: 'where', table: tableOf.get(u.uid), where: `NOT (${x.where})`, owner: ob.selections[0] }; sqlItems.push(it); ob.selections[0].sql = it; }
      obls.push(ob);
    }
  }
  evaluateSql(sqlItems, { tables, clock, timeoutMs, budgetMs });

  // dispositions of each selection (one reader)
  for (const ob of obls) {
    for (const sel of ob.selections) {
      const u = sel.u;
      const vote = (m, d, basis) => { sel.votes.set(m.mid, { d, basis }); ledger.push({ reader: ob.reader, obligation: ob.id, uid: u.uid, mid: m.mid, ptr: m.key, label: m.label, disposition: d, basis }); };
      if (sel.sql) {
        const r = sel.sql.result;
        if (!r || r.status !== 'ok') {
          for (const m of u.members) vote(m, 'unknown', { kind: 'null', why: r?.error ?? 'predicate not evaluated' });
        } else {
          const inSets = [...r.byDay.values()].map(rows => new Set(rows.map(x => Number(x._mid))));
          const where = sel.where;
          const L = listLike(r.reads, sel.sql.table, labelOf.get(sel.sql.table));
          if (L.list) {
            // a list posing as a predicate: its members are the reader's claims (an include stays a soft include); the
            // rest are undisposed, exactly as for a list-style selection
            for (const m of u.members) {
              const ins = inSets.map(s => s.has(m.mid));
              if (ins.every(Boolean) && !sel.exclusionOnly) vote(m, 'include', { kind: 'reader', verified: false, listed: true, where, why: `a list, not a rule: ${L.why}` });
              else if (ins.every(x => !x) && sel.exclusionOnly) vote(m, 'unknown', { kind: 'null', why: `excluded by a list, not a rule: ${L.why}`, claimed: 'exclude', where });
            }
            if (!sel.partial) for (const m of u.members) if (!sel.votes.has(m.mid)) vote(m, 'unknown', { kind: 'null', why: 'no reader disposed this member' });
            continue;
          }
          for (const m of u.members) {
            const ins = inSets.map(s => s.has(m.mid));
            if (ins.every(Boolean)) vote(m, 'include', { kind: 'predicate', where, executed: true });
            else if (ins.every(x => !x)) vote(m, 'exclude', { kind: 'predicate', where, executed: true, complement: true });
            else {
              const days = [...r.byDay.keys()];
              vote(m, 'unknown', { kind: 'null', clock: true, why: 'the predicate reads today and the member flips inside the clock domain', flipsAt: days.find((d, i) => i > 0 && ins[i] !== ins[i - 1]) ?? null });
            }
          }
        }
        continue;
      }
      // list-style selections (stored v1 readers). A listed claim "member m is in/out because field F holds V" is checked on
      // m's own record, but a claim alone is a lookup, not a rule: code only EXECUTES a predicate it can induce from the
      // claims (induceTest): one deciding field, a function from values to dispositions, both dispositions present, and a
      // real rule (a value shared by two or more members, or a threshold that separates the two sides). The induced test
      // then disposes EVERY member of the universe (listed or not); members it cannot place are unknown.
      const listed = new Map();
      for (const x of sel.members) {
        const h = normalizePointer(x.ptr, pidx);
        if (!h.m || h.u !== u) continue;
        listed.set(h.m.mid, { x, m: h.m, how: h.how });
      }
      const claims = [];
      for (const { x, m, how } of listed.values()) {
        const want = x.in ? 'include' : 'exclude';
        const holds = holdsTest(x.test, m);
        if (holds === false) { vote(m, 'unknown', { kind: 'null', why: 'the reader\'s deciding value does not hold on the record (refuted)', claimed: want, pointer: how }); continue; }
        if (holds === true) claims.push({ m, want, field: x.test.field, value: x.test.value, how });
        const q = x.quote ? verifyQuote(x.quote, { requestText, records }) : false;
        if (q) vote(m, want, { kind: 'quote', source: q, quote: str(x.quote?.text ?? x.quote).slice(0, 300), pointer: how });
      }
      const test = sel.partial ? null : induceTest(claims, u);
      if (test) {
        for (const m of u.members) {
          if (sel.votes.has(m.mid) && sel.votes.get(m.mid).basis.kind !== 'null') continue;
          const d = test.apply(m);
          if (d) vote(m, d, { kind: 'induced', where: test.where, executed: true, induced: test.kind, listed: listed.has(m.mid), why: 'a rule code induced from listed claims, not a reader rule' });
        }
      }
      // whatever stays undecided keeps the reader's claim as an unverified vote (an include stays a soft include)
      for (const { m, want, how } of [...listed.values()].map(v => ({ m: v.m, want: v.x.in ? 'include' : 'exclude', how: v.how }))) {
        if (sel.votes.has(m.mid)) continue;
        vote(m, want === 'include' ? 'include' : 'unknown', want === 'include' ? { kind: 'reader', verified: false, pointer: how } : { kind: 'null', why: 'excluded by the reader, but no executed rule or verbatim quote supports it', claimed: 'exclude', pointer: how });
      }
      if (sel.partial) continue;
      for (const m of u.members) if (!sel.votes.has(m.mid)) vote(m, 'unknown', { kind: 'null', why: 'no reader disposed this member' });
    }
  }

  // --- per-item or aggregate (code decides when the reader did not say)
  for (const ob of obls) for (const sel of ob.selections) {
    if (sel.perItem === null || sel.perItem === undefined) {
      const memberEmails = new Set(sel.u.members.flatMap(m => m.emails));
      sel.perItem = ob.target.emails.length ? ob.target.emails.every(e => memberEmails.has(e)) : ob.target.ptrMember ? sel.u.members.includes(ob.target.ptrMember) : ob.eclass === 'update';
    }
  }

  // --- consensus across readers: group obligations by (effect class, target or per-item universe)
  const groups = new Map();
  for (const ob of obls) for (const sel of ob.selections) {
    const k = sel.perItem ? `${ob.eclass}|per-item|${ob.app}|${sel.u.uid}` : `${ob.eclass}|${ob.app}|${targetKey(ob.target)}|${sel.u.uid}`;
    if (!groups.has(k)) groups.set(k, { key: k, eclass: ob.eclass, app: ob.app, perItem: sel.perItem, u: sel.u, target: ob.target, set: null, sels: [], obligations: [] });
    const g = groups.get(k);
    g.sels.push({ reader: ob.reader, sel, ob });
    g.obligations.push(`${ob.reader}:${ob.id}`);
    if (!g.target.emails.length && ob.target.emails.length) g.target = ob.target;
    if (!g.set && ob.set) g.set = ob.set;
  }
  const nReaders = new Set(readers.map(r => r.reader)).size;
  const need = nReaders >= 3 ? 2 : 1;
  const dispositions = [];
  for (const g of groups.values()) {
    for (const m of g.u.members) {
      const vs = g.sels.map(s => s.sel.votes.get(m.mid)).filter(Boolean);
      if (!vs.length) continue;
      const verified = d => vs.filter(v => v.d === d && ['predicate', 'quote'].includes(v.basis.kind));
      const inc = verified('include'), exc = verified('exclude');
      const incAny = vs.filter(v => v.d === 'include');
      let d = 'unknown', basis = { kind: 'null', why: vs.length ? 'no verified majority' : 'no reader disposed this member' };
      if (exc.length >= need && exc.length > incAny.length) { d = 'exclude'; basis = exc[0].basis; }
      else if (inc.length >= need && inc.length >= exc.length) { d = 'include'; basis = inc[0].basis; }
      else if (incAny.length >= need && !vs.some(v => v.d === 'exclude')) { d = 'include'; basis = { kind: 'reader', verified: false }; }
      // a labelled null keeps its label: when every vote is a null, the member carries the first vote's reason
      if (d === 'unknown' && vs.every(v => v.d === 'unknown' && v.basis?.kind === 'null')) basis = vs[0].basis;
      dispositions.push({ group: g.key, uid: g.u.uid, mid: m.mid, ptr: m.key, label: m.label, disposition: d, basis, votes: vs.map(v => v.d), hard: d !== 'unknown' && ['predicate', 'quote'].includes(basis.kind) });
      // the UNKNOWN list: members some reader would exclude without support, and members whose disposition depends on today
      if (d === 'unknown' && vs.some(v => v.d === 'exclude' || v.basis?.claimed === 'exclude' || v.basis?.clock)) unknowns.push({ id: `U-${sha(`${g.key}|${m.key}`).slice(0, 10)}`, kind: 'member', about: g.key, member: m.key, label: m.label, why: basis.why, ...(vs.some(v => v.basis?.clock) ? { clock: true } : {}) });
    }
  }

  // --- figures: certain over the clock domain, else UNKNOWN with the anchor's value
  const figures = [];
  for (const ob of obls) for (const f of ob.figures) {
    const r = f.sql.result;
    if (!r || r.status !== 'ok') { figures.push({ obligation: `${ob.reader}:${ob.id}`, id: f.id, status: 'unknown', why: r?.error ?? 'not evaluated', select: f.select }); unknowns.push({ id: `U-fig-${ob.reader}-${f.id}`, kind: 'value', about: f.id, why: r?.error ?? 'not evaluated' }); continue; }
    const vals = [...r.byDay.entries()].map(([d, rows]) => [d, JSON.stringify(rows)]);
    const distinct = uniq(vals.map(v => v[1]));
    const atAnchor = r.byDay.get(clock.value ?? null) ?? r.byDay.get(null) ?? [...r.byDay.values()][0];
    const certain = distinct.length === 1;
    figures.push({ obligation: `${ob.reader}:${ob.id}`, target: ob.target, id: f.id, select: f.select, format: f.format, status: certain ? 'certain' : 'unknown', rows: certain ? JSON.parse(distinct[0]) : atAnchor, anchorRows: atAnchor, readsToday: usesToday(f.select), distinctOverDomain: distinct.length });
    if (!certain) unknowns.push({ id: `U-fig-${ob.reader}-${f.id}`, kind: 'value', about: f.id, why: 'the figure changes inside the clock domain', anchor: clock.value });
  }

  // --- compile both directions; then the readers' direct prohibitions (hard with a verified quote and the consensus)
  const assertions = compileDstar({ groups: [...groups.values()], dispositions, figures, ground });
  for (const a of assertions) a.origin = a.group.startsWith('figure|') ? 'figure' : 'closure';
  assertions.push(...compileObligations(obls, { need, ground, unknowns }));
  assertions.push(...compileProhibitions(readers, { pidx, chans, requestText, records, need, assertions }));
  const dstar = {
    version: DSTAR_VERSION,
    today: { status: clock.status, value: clock.value, domain: clock.domain },
    universes: universes.map(u => ({ uid: u.uid, title: u.title, members: u.members.length, labelColumn: u.labelColumn, table: tableOf.get(u.uid) })),
    groups: [...groups.values()].map(g => ({ key: g.key, eclass: g.eclass, app: g.app, perItem: g.perItem, uid: g.u.uid, target: { emails: g.target.emails, channel: g.target.channel, container: g.target.container, ptr: g.target.ptr }, obligations: g.obligations })),
    dispositions, figures, assertions, unknowns, ledger,
    stats: {
      readers: nReaders, groups: groups.size, members: dispositions.length,
      include: dispositions.filter(d => d.disposition === 'include').length, exclude: dispositions.filter(d => d.disposition === 'exclude').length,
      unknown: dispositions.filter(d => d.disposition === 'unknown').length, hardExclude: dispositions.filter(d => d.disposition === 'exclude' && d.hard).length,
      hardChecks: assertions.filter(a => a.status === 'hard').length, unknowns: unknowns.length,
    },
  };
  return dstar;
}

// ---------------------------------------------------------------------------------------------------------------
// Grounding (ATTACK Move 1 (c)): what the request or a record shows

/** {email(e), channel(ch), target(t), literal(l)} -> true | false ('request' | 'record' | false for a literal). An address is grounded when the request or a record
 *  carries it; a channel when it resolved to an enumerated channel or the request names it; a record pointer when it
 *  resolved to a member; a literal when the request or one record carries it verbatim (normalised text). */
export function grounding({ requestText = '', records = [] }) {
  const req = norm(requestText);
  const texts = records.map(r => norm(r.text ?? ''));
  const reqEmails = new Set(emailsIn(requestText));
  const worldEmails = new Set(records.flatMap(r => r.emails ?? emailsIn(r.text ?? '')));
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const g = {
    email: e => reqEmails.has(String(e).toLowerCase()) || worldEmails.has(String(e).toLowerCase()),
    channel: ch => Boolean(ch && (ch.id || (ch.name && new RegExp(`(?<![a-z0-9_-])#?${esc(norm(ch.name))}(?![a-z0-9_-])`).test(req)))),
    literal: l => { const n = norm(l); return n.length < 2 ? false : req.includes(n) ? 'request' : texts.some(t => t.includes(n)) ? 'record' : false; },
  };
  g.target = t => (t?.email ? g.email(t.email) : t?.channel ? g.channel(t.channel) : t?.ptr ? true : false);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Compilation: dispositions and figures -> Agent-Diff-shaped assertions, each with its executable check

const ENTITY = { gmail: 'gmail.messages', slack: 'slack.messages' };
const NOTE_FIELD = /(^|[^a-z])(notes?|comments?|repl(y|ies)|messages?|parts?|conversation_parts)([^a-z]|$)/i;
// v2's conditional-prohibition rule: an ordered or conditional ban is not a plain absence
const CONDITIONAL = /\b(before|until|after|unless|only if|except|prior to|without|instead)\b/i;
function messageTarget(g) {
  if (g.target.emails.length) return g.target.emails.map(email => ({ email }));
  if (g.target.channel) return [{ channel: g.target.channel }];
  if (g.target.ptr) return [{ ptr: g.target.ptr }];
  return [];
}
const mk = (a) => { a.check.key = checkKey(a.check); a.id = `A-${sha(`${a.check.key}|${a.group}|${a.member ?? ''}`).slice(0, 12)}`; return a; };

/** Compile one group's dispositions (and figures) into assertions with checks in the v2/v3 grammar. */
export function compileDstar({ groups, dispositions, figures = [], ground = null }) {
  const out = [];
  for (const g of groups) {
    const ds = dispositions.filter(d => d.group === g.key);
    for (const d of ds) {
      const m = g.u.members.find(x => x.mid === d.mid);
      if (!m || d.disposition === 'unknown') continue;
      const hard = d.hard;
      const pol = d.disposition === 'include' ? 'must' : 'must_not';
      const base = { group: g.key, member: m.key, label: m.label, polarity: pol, basis: d.basis, status: hard ? 'hard' : 'soft' };
      if (g.eclass === 'message') {
        if (g.perItem) {
          for (const email of m.emails.slice(0, 3)) {
            const check = { type: pol === 'must' ? 'msg_to' : 'msg_none', polarity: pol, cat: pol === 'must' ? 'positive' : 'scope', params: { target: { email } }, hard };
            out.push(mk({ ...base, diff_type: 'added', entity: ENTITY[g.app] ?? `${g.app || '*'}.messages`, where: { to: { contains: email } }, expected_count: pol === 'must' ? { min: 1 } : 0, strict: hard, check }));
          }
        } else {
          for (const target of messageTarget(g)) {
            if (pol === 'must_not') {
              const check = { type: 'msg_lacks_any', polarity: 'must_not', cat: 'scope', params: { target, lits: m.forms }, hard };
              out.push(mk({ ...base, diff_type: 'added', entity: ENTITY[g.app] ?? `${g.app || '*'}.messages`, where: { ...(target.email ? { to: { contains: target.email } } : target.channel ? { channel: { eq: target.channel.id ?? target.channel.name } } : { parent: { eq: target.ptr } }), body: { contains_any: m.forms } }, expected_count: 0, strict: hard, check }));
            } else {
              // mentioning each included member is expected, but an aggregate message may name members its own way: soft
              const check = { type: 'msg_has_any', polarity: 'must', cat: 'value', params: { target, lits: m.forms }, hard: false };
              out.push(mk({ ...base, status: 'soft', diff_type: 'added', entity: ENTITY[g.app] ?? `${g.app || '*'}.messages`, where: { ...(target.email ? { to: { contains: target.email } } : target.channel ? { channel: { eq: target.channel.id ?? target.channel.name } } : { parent: { eq: target.ptr } }), body: { contains_any: m.forms } }, expected_count: { min: 1 }, strict: false, check }));
            }
          }
        }
      } else if (g.eclass === 'create') {
        const container = g.target.container ?? null;
        const check = pol === 'must' ? { type: 'created_has_any', polarity: 'must', cat: 'positive', params: { app: g.app, container, lits: m.forms }, hard: hard && g.perItem }
          : { type: 'created_none_any', polarity: 'must_not', cat: 'scope', params: { app: g.app, container, lits: m.forms }, hard };
        out.push(mk({ ...base, status: check.hard ? 'hard' : 'soft', diff_type: 'added', entity: `${g.app || '*'}.*`, where: { ...(container ? { container: { eq: container } } : {}), text: { contains_any: m.forms } }, expected_count: pol === 'must' ? { min: 1 } : 0, strict: check.hard, check }));
      } else if (g.eclass === 'update' || g.eclass === 'delete') {
        if (g.perItem) {
          // an excluded member must not get THIS obligation's change: its value when the obligation sets one, a new entry
          // when it appends a note or reply, its deletion when it deletes; "leave the record untouched" without a field is
          // only a guess (the v2 rule) and stays soft
          let check;
          if (g.eclass === 'delete') check = { type: pol === 'must' ? 'rec_deleted' : 'rec_kept', params: { ptr: m.key }, hard };
          else if (g.set && NOTE_FIELD.test(g.set.field)) check = { type: pol === 'must' ? 'rec_changed' : 'rec_unchanged', params: { ptr: m.key, scope: 'reply' }, hard };
          else if (g.set && g.set.value) check = { type: pol === 'must' ? 'rec_field' : 'rec_field_not', params: { ptr: m.key, field: g.set.field, value: g.set.value }, hard };
          else check = { type: pol === 'must' ? 'rec_changed' : 'rec_unchanged', params: { ptr: m.key, scope: 'any' }, hard: false };
          check.polarity = pol; check.cat = pol === 'must' ? 'positive' : 'scope';
          out.push(mk({ ...base, status: check.hard ? 'hard' : 'soft', diff_type: g.eclass === 'delete' ? 'removed' : 'changed', entity: `${m.app}.${m.kind}`, where: { id: { eq: m.id }, ...(check.params.field ? { [check.params.field]: { [pol === 'must' ? 'eq' : 'ne']: check.params.value } } : {}) }, expected_count: pol === 'must' ? { min: 1 } : 0, strict: check.hard, check }));
        } else if (g.target.ptr && pol === 'must_not') {
          const check = { type: 'msg_lacks_any', polarity: 'must_not', cat: 'scope', params: { target: { ptr: g.target.ptr }, lits: m.forms }, hard };
          out.push(mk({ ...base, diff_type: 'changed', entity: 'record', where: { id: { eq: g.target.ptr }, text: { contains_any: m.forms } }, expected_count: 0, strict: hard, check }));
        }
      }
    }
  }
  for (const f of figures) {
    if (f.status !== 'certain' || !f.format || !f.target) continue;
    const lit = formatFigure(f.rows, f.format);
    if (lit === null) continue;
    for (const target of messageTarget({ target: f.target })) {
      // a certain figure is hard only on a grounded target (an invented recipient would turn a right run into FAILED)
      const hard = ground ? ground.target(target) : true;
      const check = { type: 'msg_has', polarity: 'must', cat: 'value', params: { target, lit }, hard };
      out.push(mk({ group: `figure|${f.obligation}`, member: null, label: f.id, polarity: 'must', basis: { kind: 'figure', select: f.select, targetGrounded: hard }, status: hard ? 'hard' : 'soft', diff_type: 'added', entity: target.email ? 'gmail.messages' : 'slack.messages', where: { body: { contains: lit } }, expected_count: { min: 1 }, strict: hard, check }));
    }
  }
  return out;
}

/** Format a figure's single value: format 'money' ($12,600), 'integer', 'number', 'date', 'text', or a template with {v}. */
export function formatFigure(rows, format) {
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const v = Object.values(rows[0])[0];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  switch (format) {
    case 'money': return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}` : null;
    case 'grouped': return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : null;
    case 'integer': return Number.isFinite(n) ? String(Math.round(n)) : null;
    case 'number': return Number.isFinite(n) ? String(n) : null;
    case 'date': return parseDate(v) ?? null;
    case 'text': return String(v);
    default: return typeof format === 'string' && format.includes('{v}') ? format.replace('{v}', String(v)) : String(v);
  }
}

/** Content literals longer than this are drafted prose, not a value the run must carry (v2's rule, tighter). */
export const LITERAL_MAX = 200;

/** O: each obligation's effect, keyed by (effect class, app, target) across readers, and each of its content literals
 *  (ATTACK Move 1 (d)): a message to an address or a channel, a reply on a record, a record created in an app (and
 *  container), a record set to a value, and "the message / the new record carries L". A check is hard when its support
 *  reaches the consensus AND its target and literal are grounded (grounding()); an ungrounded target or literal compiles
 *  soft and is listed as UNKNOWN (pushed onto `unknowns`). */
export function compileObligations(obls, { need, ground = null, unknowns = null }) {
  const byKey = new Map();
  const listed = new Set();
  const unknown = (u) => { if (!unknowns || listed.has(u.id)) return; listed.add(u.id); unknowns.push(u); };
  for (const ob of obls) {
    if (ob.exclusionOnly) continue;
    const t = ob.target, checks = [];
    const msgTargets = [];
    if (ob.eclass === 'message') {
      for (const email of t.emails) { checks.push({ type: 'msg_to', params: { target: { email } } }); msgTargets.push({ email }); }
      if (!t.emails.length && t.channel) { checks.push({ type: 'post_in', params: { target: { channel: t.channel } } }); msgTargets.push({ channel: t.channel }); }
      if (!t.emails.length && !t.channel && t.ptr) { checks.push({ type: 'rec_changed', params: { ptr: t.ptr, scope: 'reply' } }); msgTargets.push({ ptr: t.ptr }); }
    } else if (ob.eclass === 'create' && ob.app) checks.push({ type: 'created_in', params: { app: ob.app, container: t.container ?? null, label: null } });
    else if (ob.eclass === 'update' && t.ptr) { checks.push(ob.set?.value && !NOTE_FIELD.test(ob.set.field) ? { type: 'rec_field', params: { ptr: t.ptr, field: ob.set.field, value: ob.set.value } } : { type: 'rec_changed', params: { ptr: t.ptr, scope: ob.set && NOTE_FIELD.test(ob.set.field) ? 'reply' : 'any' } }); msgTargets.push({ ptr: t.ptr }); }
    // content literals: on each message target (or the updated record), or inside the created record
    for (const lit of uniq((ob.literals ?? []).map(x => str(x).trim()).filter(x => x.length >= 2 && x.length <= LITERAL_MAX))) {
      if (ob.eclass === 'create' && ob.app) checks.push({ type: 'created_has', params: { app: ob.app, container: t.container ?? null, label: null, lit } });
      else for (const target of msgTargets) checks.push({ type: 'msg_has', params: { target, lit } });
    }
    for (const c of checks) {
      const check = { ...c, polarity: 'must', cat: c.type === 'msg_has' || c.type === 'created_has' ? 'value' : 'positive' };
      const k = checkKey(check);
      if (!byKey.has(k)) byKey.set(k, { check, readers: new Set(), ids: [] });
      byKey.get(k).readers.add(ob.reader); byKey.get(k).ids.push(`${ob.reader}:${ob.id}`);
    }
  }
  return [...byKey].map(([k, e]) => {
    const P = e.check.params;
    const target = P.target ?? (e.check.type === 'rec_changed' || e.check.type === 'rec_field' ? { ptr: P.ptr } : null);
    const targetOk = !ground || !target || ground.target(target);
    const litOk = !ground || P.lit === undefined || ground.literal(P.lit);
    if (!targetOk) unknown({ id: `U-tgt-${sha(JSON.stringify(target)).slice(0, 10)}`, kind: 'target', about: target.email ?? target.channel?.name ?? target.channel?.id ?? target.ptr, why: 'no request text or record shows this recipient or channel' });
    if (!litOk) unknown({ id: `U-lit-${sha(norm(P.lit)).slice(0, 10)}`, kind: 'value', about: String(P.lit).slice(0, 120), why: 'no request text or record carries this content literal verbatim' });
    const hard = e.readers.size >= need && targetOk && litOk;
    e.check.hard = hard; e.check.key = k;
    return { id: `A-${sha(k).slice(0, 12)}`, group: 'obligation', member: null, label: e.ids.slice(0, 3).join(' '), polarity: 'must', origin: 'obligation', basis: { kind: 'consensus', support: e.readers.size, targetGrounded: targetOk, literalGrounded: P.lit === undefined ? null : litOk }, status: hard ? 'hard' : 'soft',
      diff_type: e.check.type === 'rec_field' || e.check.type === 'rec_changed' ? 'changed' : 'added', entity: P?.target?.channel ? 'slack.messages' : P?.target?.email ? 'gmail.messages' : P.app ? `${P.app}.*` : 'record',
      where: P, expected_count: { min: 1 }, strict: hard, check: e.check };
  });
}

/** Direct prohibitions a reader wrote (no universe): "do not message X", "the post must not contain Y", "leave record Z".
 *  Compiled per check key across readers; hard when the support reaches the consensus and at least one supporting reader's
 *  rule quote verifies verbatim, and no positive assertion of Δ* asks for the opposite on the same target. */
export function compileProhibitions(readers, { pidx, chans, requestText, records, need, assertions = [] }) {
  const byKey = new Map();
  for (const R of readers) for (const p of R.prohibitions ?? []) {
    const eclass = EFFECT_CLASS[p.effect] ?? 'other';
    const t = resolveTarget(p.target ?? {}, pidx, chans);
    // a literal that is a member's label stands for the member: its mention forms are banned with it
    const lits = uniq((p.literals ?? []).map(str).map(x => x.trim()).filter(x => x.length >= 2 && x.length <= 80 && x.split(/\s+/).length <= 8).flatMap(x => {
      const m = records.find(r => r.label && norm(r.label) === norm(x));
      return m?.forms?.length ? [x, ...m.forms] : [x];
    }));
    const checks = [];
    if (eclass === 'message' || eclass === 'other') {
      const targets = t.emails.length ? t.emails.map(email => ({ email })) : t.channel ? [{ channel: t.channel }] : t.ptr ? [{ ptr: t.ptr }] : [];
      for (const target of targets) checks.push(lits.length ? { type: 'msg_lacks_any', params: { target, lits } } : target.email ? { type: 'msg_none', params: { target } } : target.channel ? { type: 'post_none', params: { target } } : { type: 'rec_unchanged', params: { ptr: target.ptr, scope: 'reply' } });
    } else if (eclass === 'create' && lits.length) checks.push({ type: 'created_none_any', params: { app: str(p.app).toLowerCase(), container: t.container, lits } });
    else if ((eclass === 'update' || eclass === 'delete') && t.ptr) checks.push({ type: 'rec_unchanged', params: { ptr: t.ptr, scope: 'any' } });
    const quoteOk = p.quote ? verifyQuote(p.quote, { requestText, records }) : false;
    for (const c of checks) {
      const check = { ...c, polarity: 'must_not', cat: 'negative' };
      const k = checkKey(check);
      if (!byKey.has(k)) byKey.set(k, { check, readers: new Set(), quoted: new Set(), conditional: new Set(), statements: [] });
      const e = byKey.get(k);
      e.readers.add(R.reader); if (quoteOk) e.quoted.add(R.reader);
      if (CONDITIONAL.test(str(p.statement))) e.conditional.add(R.reader);
      if (e.statements.length < 2) e.statements.push(str(p.statement).slice(0, 200));
    }
  }
  // a blanket ban on a target that an obligation of Δ* writes to is contradicted (the reader meant a narrower ban)
  const tk = t => (t?.email ? `@${t.email}` : t?.channel ? `#${norm(t.channel.id ?? t.channel.name)}` : t?.ptr ? `>${t.ptr}` : null);
  const positiveTargets = new Set(assertions.filter(a => a.polarity === 'must').map(a => tk(a.check.params.target)).filter(Boolean));
  const out = [];
  for (const [k, e] of byKey) {
    const blanket = ['msg_none', 'post_none', 'rec_unchanged'].includes(e.check.type);
    const contradicted = blanket && positiveTargets.has(tk(e.check.params.target ?? (e.check.params.ptr ? { ptr: e.check.params.ptr } : null)));
    const conditional = e.conditional.size > 0 && e.conditional.size * 2 >= e.readers.size;
    const hard = e.readers.size >= need && e.quoted.size > 0 && !contradicted && !conditional;
    e.check.hard = hard; e.check.key = k;
    out.push({ id: `A-${sha(k).slice(0, 12)}`, group: 'direct', member: null, label: e.statements[0] ?? '', polarity: 'must_not', origin: 'direct',
      basis: { kind: e.quoted.size ? 'quote' : 'reader', support: e.readers.size, quoted: e.quoted.size, contradicted, conditional }, status: hard ? 'hard' : 'soft',
      diff_type: e.check.type === 'rec_unchanged' ? 'changed' : 'added', entity: e.check.params?.target?.channel ? 'slack.messages' : e.check.params?.target?.email ? 'gmail.messages' : 'record',
      where: e.check.params, expected_count: 0, strict: hard, check: e.check });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The three-valued verdict over a candidate (ATTACK Move 3's semantics; D28 (1))

/** Per assertion: SUPPORTED (its check ran and passed), FAILED (a HARD check ran and failed) or UNKNOWN (no result, a
 *  check that could not decide, or a SOFT check that failed: a guess that the run contradicts is an assumption to show,
 *  never a pass and never a veto). The run releases only with no FAILED; every UNKNOWN row joins Δ*'s own labelled nulls
 *  on the assumption list (ATTACK §8.2: "stop mapping null or soft to pass"). A soft check that passes is SUPPORTED: the
 *  world already satisfies it, so nothing is assumed. (The replays score dispositions and checks directly; this
 *  function is the release semantics for a live run and for Move 3's risk-coverage replay.) */
export function verdict(dstar, results) {
  const by = new Map(results.map(r => [r.key, r]));
  const rows = dstar.assertions.map(a => {
    const r = by.get(a.check.key);
    const pass = r ? r.pass : null;
    const v = pass === true ? 'SUPPORTED' : pass === false && a.status === 'hard' ? 'FAILED' : 'UNKNOWN';
    const why = v !== 'UNKNOWN' ? null : !r ? 'no result' : pass === false ? 'a soft check failed' : 'the check could not decide';
    return { id: a.id, status: a.status, polarity: a.polarity, verdict: v, why, evidence: r?.evidence ?? null };
  });
  const failed = rows.filter(r => r.verdict === 'FAILED');
  const unknownRows = rows.filter(r => r.verdict === 'UNKNOWN');
  const assumptions = [...dstar.unknowns, ...unknownRows.map(r => ({ id: `U-${r.id}`, kind: 'check', about: r.id, why: r.why, evidence: r.evidence }))];
  return { release: failed.length === 0, failed: failed.length, failedHard: failed.length, supported: rows.filter(r => r.verdict === 'SUPPORTED').length, unknown: unknownRows.length + dstar.unknowns.length, assumptions, rows };
}

/** The Agent-Diff-shaped contract alone (what the actor's read-back brief, the gate and the selector consume). */
export function agentDiffContract(dstar) {
  return {
    version: dstar.version, strict: true,
    today: dstar.today,
    assertions: dstar.assertions.map(a => ({ id: a.id, diff_type: a.diff_type, entity: a.entity, where: a.where, expected_count: a.expected_count, strict: a.strict, polarity: a.polarity, status: a.status })),
    unknowns: dstar.unknowns.map(u => ({ id: u.id, kind: u.kind, about: u.about, member: u.member ?? null, why: u.why })),
  };
}
