// requirement-ledger-v2: compile grounded requirements into checks, and merge K readers.
//
// Each requirement becomes code checks where a check type of the grammar below fits and its targets and values are
// grounded; otherwise it becomes a judged check (a clean-context model call decides it from the candidate's changes).
//
//   msg_to {email}               a new outbound message (or record) addressed to the email
//   msg_none {email}             no new message addressed to the email
//   post_in {channel}            a new message in the channel
//   post_none {channel}          no new message in the channel
//   msg_has {target, lit}        a new message to the email / in the channel / on the record carries the literal
//   msg_lacks {target, lit}      no new message to that target (or none at all) carries the literal
//   rec_changed {ptr, scope}     the record was changed (scope 'reply': a new entry in one of its message lists)
//   rec_unchanged {ptr, scope}   the record was not changed (scope 'reply': no new message entry)
//   rec_field {ptr, field, value} after the work the record's field holds the value (lists: contains it)
//   rec_deleted / rec_kept {ptr} the record is gone / still there
//   created_in {app, container, label}        a new record in the app (inside the container; naming the item)
//   created_has {app, container, label, lit}  such a new record carries the literal
//   created_none {app, container, lit}        no new record in the app (inside the container) carries the literal
//   rec_field_not {ptr, field, value}         after the work the record's field does not hold the value
//   no_dup {target}              no two new messages to the target with the same text (a side-effect guess: always soft)
//
// Merging: checks from K readers are keyed; a check's support is the number of readers that produced it. A check is
// hard when its support reaches the majority and nothing weakens it (a negative without a verbatim rule quote, a computed
// value only one reader found, a side-effect guess); otherwise it is soft (scored, never a veto). Contradicting checks
// (must vs must_not on the same target) keep the better-supported side; a tie makes both soft.
// Generic by construction (PREREG-AB-v1 H7/H8): no task names, grader strings or hidden assertions.
import { norm } from './lib.mjs';

export const COMPILE_VERSION = 'rl2-compile-v1';
const MESSAGE_EFFECTS = new Set(['send_email', 'reply']);
const CREATE_EFFECTS = new Set(['create_record', 'add_row', 'schedule_event']);
const UPDATE_EFFECTS = new Set(['update_record', 'update_row']);

const tgtKey = t => (t.email ? `@${t.email}` : t.channel ? `#${t.channel.id ?? norm(t.channel.name)}` : t.ptr ? `>${t.ptr}` : '*');

/** Compile one grounded requirement of one reader -> {checks: [...], judged: null | {statement, why}}. */
export function compileRequirement(req, { itemLabels = new Map() } = {}) {
  const checks = [];
  const pol = req.kind;
  const add = (type, params, extra = {}) => checks.push({ type, polarity: pol, cat: req.type, params, key: '', statement: req.statement, reqId: req.id,
    weak: Boolean(extra.weak), computed: Boolean(extra.computed) });
  const lits = req.include.filter(l => l.grounded || l.computed);
  const loose = req.include.filter(l => !l.grounded && !l.computed);
  const excl = req.exclude.filter(l => l.text.trim().length >= 2);
  const negWeak = pol === 'must_not' && !req.quoteOk;
  const sideWeak = req.type === 'side_effect';
  let effect = req.effect;
  if (effect === 'other') effect = req.recipients.length ? 'send_email' : req.channel ? 'post_message' : req.record ? 'update_record' : 'other';
  const label = req.item ? itemLabels.get(req.item) ?? '' : '';
  const dupGuess = pol === 'must_not' && /duplicat|twice|more than once|repeat|again/i.test(req.statement);

  if (dupGuess && (req.recipients.length || req.channel)) {
    for (const t of req.recipients.length ? req.recipients.map(email => ({ email })) : [{ channel: req.channel }]) add('no_dup', { target: t }, { weak: true });
    for (const c of checks) c.key = checkKey(c);
    return { checks, judged: null };
  }

  if (MESSAGE_EFFECTS.has(effect) && req.recipients.length) {
    for (const email of req.recipients) {
      const t = { email };
      if (pol === 'must') {
        add('msg_to', { target: t });
        for (const l of lits) add('msg_has', { target: t, lit: l.text }, { computed: l.computed && !l.grounded });
        for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: !req.quoteOk });
      } else if (excl.length) for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: negWeak || sideWeak });
      else add('msg_none', { target: t }, { weak: negWeak || sideWeak });
    }
  } else if (effect === 'reply' && req.record) {
    const t = { ptr: req.record };
    if (pol === 'must') {
      add('rec_changed', { ptr: req.record, scope: 'reply' });
      for (const l of lits) add('msg_has', { target: t, lit: l.text }, { computed: l.computed && !l.grounded });
      for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: !req.quoteOk });
    } else if (excl.length) for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: negWeak || sideWeak });
    else add('rec_unchanged', { ptr: req.record, scope: 'reply' }, { weak: negWeak || sideWeak });
  } else if (effect === 'post_message' && req.channel) {
    const t = { channel: req.channel };
    if (pol === 'must') {
      add('post_in', { target: t });
      for (const l of lits) add('msg_has', { target: t, lit: l.text }, { computed: l.computed && !l.grounded });
      for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: !req.quoteOk });
    } else if (excl.length) for (const l of excl) add('msg_lacks', { target: t, lit: l.text }, { weak: negWeak || sideWeak });
    else add('post_none', { target: t }, { weak: negWeak || sideWeak });
  } else if (UPDATE_EFFECTS.has(effect) && req.record) {
    if (pol === 'must') {
      if (req.field && req.value && (req.valueGrounded || req.computed)) add('rec_field', { ptr: req.record, field: req.field, value: req.value }, { computed: !req.valueGrounded });
      else add('rec_changed', { ptr: req.record, scope: 'any' });
      for (const l of lits) add('msg_has', { target: { ptr: req.record }, lit: l.text }, { computed: l.computed && !l.grounded });
    } else if (req.field && req.value) add('rec_field_not', { ptr: req.record, field: req.field, value: req.value }, { weak: negWeak || sideWeak });
    // "do not process X" rarely means "do not touch X's record at all": without a field it is a soft guess
    else add('rec_unchanged', { ptr: req.record, scope: 'any' }, { weak: true });
  } else if (effect === 'delete_record' && req.record) {
    if (pol === 'must') add('rec_deleted', { ptr: req.record });
    else add('rec_kept', { ptr: req.record }, { weak: negWeak || sideWeak });
  } else if (CREATE_EFFECTS.has(effect) && (req.app || req.container)) {
    const base = { app: req.app || req.container?.ptr.split('.')[0] || '', container: req.container?.id ?? null, label: label || null };
    if (pol === 'must') {
      add('created_in', base);
      for (const l of lits) add('created_has', { ...base, lit: l.text }, { computed: l.computed && !l.grounded });
    } else {
      const dist = excl.length ? excl.map(l => l.text) : lits.length ? lits.map(l => l.text) : label ? [label] : [];
      for (const lit of dist) add('created_none', { app: base.app, container: base.container, lit }, { weak: negWeak || sideWeak });
    }
  }
  const judged = !checks.length ? { statement: req.statement, why: 'no code check fits' }
    : loose.length && pol === 'must' ? { statement: `${req.statement} (must include: ${loose.map(l => JSON.stringify(l.text)).join(', ')})`, why: 'values not found verbatim in the sources' } : null;
  for (const c of checks) c.key = checkKey(c);
  return { checks, judged };
}

export function checkKey(c) {
  const P = c.params;
  switch (c.type) {
    case 'msg_to': case 'msg_none': case 'post_in': case 'post_none': case 'no_dup': return `${c.type}|${tgtKey(P.target)}`;
    case 'msg_has': case 'msg_lacks': return `${c.type}|${tgtKey(P.target)}|${norm(P.lit)}`;
    case 'rec_changed': case 'rec_unchanged': return `${c.type}|${P.ptr}|${P.scope}`;
    case 'rec_field': case 'rec_field_not': return `${c.type}|${P.ptr}|${norm(P.field).replace(/^cells\./, '')}|${norm(P.value)}`;
    case 'rec_deleted': case 'rec_kept': return `${c.type}|${P.ptr}`;
    case 'created_in': return `${c.type}|${P.app}|${P.container ?? ''}|${norm(P.label ?? '')}`;
    case 'created_has': return `${c.type}|${P.app}|${P.container ?? ''}|${norm(P.label ?? '')}|${norm(P.lit)}`;
    case 'created_none': return `${c.type}|${P.app}|${P.container ?? ''}|${norm(P.lit)}`;
    default: return `${c.type}|${JSON.stringify(P)}`;
  }
}
// The check that contradicts a key, if any.
function opposite(key) {
  const [t, ...rest] = key.split('|');
  const map = { msg_to: 'msg_none', msg_none: 'msg_to', post_in: 'post_none', post_none: 'post_in', msg_has: 'msg_lacks', msg_lacks: 'msg_has', rec_changed: 'rec_unchanged', rec_unchanged: 'rec_changed', rec_deleted: 'rec_kept', rec_kept: 'rec_deleted', rec_field: 'rec_field_not', rec_field_not: 'rec_field' };
  return map[t] ? [map[t], ...rest].join('|') : null;
}

const WORD = /[a-z0-9@$.%_-]{3,}/g;
const STOP = new Set(['the', 'and', 'for', 'must', 'not', 'with', 'that', 'this', 'from', 'each', 'all', 'any', 'are', 'its', 'their', 'should', 'into', 'per', 'has', 'have', 'been', 'was', 'were', 'will', 'only', 'when', 'than', 'then', 'they', 'them']);
const words = s => new Set((norm(s).match(WORD) ?? []).filter(w => !STOP.has(w)));
const jaccard = (a, b) => { if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

/**
 * Merge K grounded ledgers (one per reader) into the task's check list.
 * ledgers: [{reader, ok, requirements, items}] -> {checks: [{key, type, polarity, cat, params, support, readers, hard, why}], judged: [...], stats}
 */
export function mergeLedgers(ledgers, { hardSupport = null, maxJudged = 24 } = {}) {
  const valid = ledgers.filter(l => l.ok);
  const n = valid.length;
  const need = hardSupport ?? (n >= 3 ? 2 : 1);
  const byKey = new Map(), judgedAll = [];
  for (const L of valid) {
    const itemLabels = new Map(L.items.filter(i => i.resolved && i.label).map(i => [i.ptr, i.label]));
    for (const req of L.requirements) {
      const { checks, judged } = compileRequirement(req, { itemLabels });
      for (const c of checks) {
        if (!byKey.has(c.key)) byKey.set(c.key, { ...c, readers: new Set(), weakReaders: new Set(), computedReaders: new Set(), statements: [] });
        const m = byKey.get(c.key);
        if (!m.readers.has(L.reader)) { m.readers.add(L.reader); if (c.weak) m.weakReaders.add(L.reader); if (c.computed) m.computedReaders.add(L.reader); }
        if (m.statements.length < 3) m.statements.push(c.statement);
      }
      if (judged) judgedAll.push({ ...judged, reader: L.reader, kind: req.kind, cat: req.type, weak: req.kind === 'must_not' && !req.quoteOk, words: words(judged.statement) });
    }
  }
  // A reader that asks for an effect and also forbids it (a qualified negative, e.g. "not about X") keeps the positive.
  for (const [key, m] of byKey) {
    if (m.polarity !== 'must_not') continue;
    const pos = byKey.get(opposite(key));
    if (pos) for (const r of [...m.readers]) if (pos.readers.has(r)) m.readers.delete(r);
  }
  const checks = [];
  for (const [key, m] of byKey) {
    if (!m.readers.size) continue;
    const support = m.readers.size;
    let hard = support >= need, why = hard ? 'majority' : `support ${support}/${n}`;
    const weak = [...m.readers].filter(r => m.weakReaders.has(r)).length, computed = [...m.readers].filter(r => m.computedReaders.has(r)).length;
    if (hard && (weak >= support || m.type === 'no_dup')) { hard = false; why = m.cat === 'side_effect' || m.type === 'no_dup' ? 'side-effect guess' : 'negative without a verbatim rule quote'; }
    if (hard && computed >= support && support < 2) { hard = false; why = 'computed value from one reader'; }
    if (hard && m.cat === 'side_effect' && support < 2) { hard = false; why = 'side-effect guess'; }
    checks.push({ key, type: m.type, polarity: m.polarity, cat: m.cat, params: m.params, statement: m.statements[0], support, readers: [...m.readers], hard, why, conflict: false });
  }
  // contradictions
  const index = new Map(checks.map(c => [c.key, c]));
  for (const c of checks) {
    const o = index.get(opposite(c.key));
    if (!o || c.conflict) continue;
    c.conflict = o.conflict = true;
    if (c.support > o.support) { o.dropped = true; } else if (o.support > c.support) { c.dropped = true; } else { c.hard = o.hard = false; c.why = o.why = 'contradiction (tie)'; }
  }
  // judged: cluster near-duplicate statements across readers
  const clusters = [];
  for (const j of judgedAll) {
    const hit = clusters.find(c => c.kind === j.kind && jaccard(c.words, j.words) >= 0.45);
    if (hit) { hit.readers.add(j.reader); if (j.weak) hit.weakVotes++; }
    else clusters.push({ statement: j.statement, kind: j.kind, cat: j.cat, why: j.why, words: j.words, readers: new Set([j.reader]), weakVotes: j.weak ? 1 : 0 });
  }
  clusters.sort((a, b) => b.readers.size - a.readers.size);
  const judged = clusters.slice(0, maxJudged).map((c, i) => {
    const support = c.readers.size;
    let hard = support >= need && c.weakVotes < support && c.cat !== 'side_effect';
    return { id: `J${i + 1}`, statement: c.statement, kind: c.kind, cat: c.cat, support, readers: [...c.readers], hard, why: c.why };
  });
  const kept = checks.filter(c => !c.dropped);
  return { readers: n, need, checks: kept, judged,
    stats: { codeChecks: kept.length, hardCode: kept.filter(c => c.hard).length, judged: judged.length, hardJudged: judged.filter(j => j.hard).length, droppedByConflict: checks.length - kept.length, judgedClustersCut: Math.max(0, clusters.length - maxJudged) } };
}
