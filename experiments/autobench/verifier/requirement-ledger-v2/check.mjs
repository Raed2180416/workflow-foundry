// requirement-ledger-v2: evaluate compiled code checks on one candidate (its initial world, its diff, its final world).
//
// The candidate's diff is flattened into effects: created records (with their recipients, channel and text), updated
// records (meaningful fields only; entries appended to message-like lists count as replies) and deleted records. Record
// pointers in checks come from the task's canonical initial world; each is mapped to this candidate's initial world by
// content (prepares draw fresh setup ids), then looked up in its diff and final world.
// Generic by construction (PREREG-AB-v1 H7/H8): no task names, grader strings or hidden assertions.
import { TOUCH_FIELD, containsLiteral, contentText, emailsIn, isObj, leaves, norm, numbersIn, numericLiteral, remapRecord } from './lib.mjs';

export const CHECK_VERSION = 'rl2-check-v1';
const RECIPIENT_KEY = /^(to|cc|bcc|recipient|recipients|to_email|to_emails|emails?|attendees|guests|signers|invitees|participants|assignee_email|contact_email|customer_email|requester_email)$/i;
const SENDER_KEY = /^(from_?|sender|from_email|reply_to|author_email|organizer|creator|host_email|owner_email)$/i;
const MSG_LIST = /(^|\.)(conversation_parts|messages|notes|replies|comments|parts|thread|responses|internal_notes|posts|activities|events)$/;
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function recipientsOf(rec, depth = 0, out = new Set()) {
  if (!isObj(rec) || depth > 3) return out;
  for (const [k, v] of Object.entries(rec)) {
    if (SENDER_KEY.test(k)) continue;
    if (RECIPIENT_KEY.test(k)) for (const e of emailsIn(JSON.stringify(v))) out.add(e);
    else if (Array.isArray(v)) v.forEach(x => recipientsOf(x, depth + 1, out));
    else if (isObj(v)) recipientsOf(v, depth + 1, out);
  }
  return out;
}
const channelOf = rec => {
  const v = rec.channel_id ?? rec.channel ?? rec.channel_name ?? rec.params?.channel ?? rec.params?.channel_id ?? null;
  return v === null || v === undefined ? null : String(v).replace(/^#/, '');
};
const idLeaves = rec => new Set(leaves(rec).map(l => l.value).filter(v => v.length <= 120));

/** Effects of a diff. */
export function effectsOf(diff, world0) {
  const created = [], updated = [], deleted = [];
  for (const c of diff?.changes ?? []) {
    if (c.op === 'created') {
      const rec = c.record ?? {};
      created.push({ app: c.app, coll: c.coll, id: c.id === null || c.id === undefined ? null : String(c.id), rec, recipients: recipientsOf(rec), channel: channelOf(rec),
        text: contentText(rec), ids: idLeaves(rec) });
    } else if (c.op === 'updated') {
      const fields = Object.entries(c.fields ?? {}).filter(([p]) => !TOUCH_FIELD.test(p));
      if (!fields.length) continue;
      const added = [], afterTexts = [];
      let reply = false;
      for (const [p, [before, after]] of fields) {
        if (Array.isArray(after)) {
          const prior = Array.isArray(before) ? before : [];
          const add = after.filter(x => !prior.some(y => deepEq(x, y)));
          added.push(...add);
          if (add.length && MSG_LIST.test(p)) reply = true;
          afterTexts.push(contentText(add));
        } else afterTexts.push(typeof after === 'object' ? contentText(after) : String(after ?? ''));
      }
      const before = (world0?.[c.app]?.[c.coll] ?? []).find?.(r => isObj(r) && String(r.id ?? r.row_id) === String(c.id)) ?? null;
      updated.push({ app: c.app, coll: c.coll, id: String(c.id), fields: Object.fromEntries(fields), added, reply, text: afterTexts.join('\n'),
        beforeEmails: new Set(emailsIn(JSON.stringify(before ?? c.ref ?? {}))) });
    } else if (c.op === 'deleted') deleted.push({ app: c.app, coll: c.coll, id: String(c.id) });
  }
  return { created, updated, deleted, n: created.length + updated.length + deleted.length };
}

// Messages "to" a target: created records addressed to it, replies on records that belong to it, posts in a channel.
function messagesTo(target, eff, ctx) {
  if (target.email) {
    const e = target.email;
    return [...eff.created.filter(c => c.recipients.has(e)).map(c => ({ where: `${c.app}.${c.coll}:${c.id}`, text: c.text })),
      ...eff.updated.filter(u => u.reply && u.beforeEmails.has(e)).map(u => ({ where: `${u.app}.${u.coll}:${u.id}`, text: u.text }))];
  }
  if (target.channel) {
    const ids = new Set([target.channel.id, target.channel.name].filter(Boolean).map(x => norm(x)));
    return eff.created.filter(c => c.channel && ids.has(norm(c.channel))).map(c => ({ where: `${c.app}.${c.coll}:${c.id}`, text: c.text }));
  }
  if (target.ptr) {
    const r = ctx.mapPtr(target.ptr);
    if (!r) return [];
    return [...eff.updated.filter(u => u.app === r.app && u.coll === r.coll && u.id === r.id).map(u => ({ where: `${u.app}.${u.coll}:${u.id}`, text: u.text })),
      ...eff.created.filter(c => c.ids.has(r.id)).map(c => ({ where: `${c.app}.${c.coll}:${c.id}`, text: c.text }))];
  }
  return [...eff.created.map(c => ({ where: `${c.app}.${c.coll}:${c.id}`, text: c.text })), ...eff.updated.map(u => ({ where: `${u.app}.${u.coll}:${u.id}`, text: u.text }))];
}
const tname = t => (t.email ? t.email : t.channel ? `#${t.channel.name ?? t.channel.id}` : t.ptr ? t.ptr : 'any output');

function fieldValue(rec, field) {
  const want = norm(field).replace(/^cells\./, '').replace(/[^a-z0-9]/g, '');
  const hits = [];
  const walk = (o, depth) => {
    if (!isObj(o) || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === want) hits.push(v);
      else if (isObj(v)) walk(v, depth + 1);
    }
  };
  walk(rec, 0);
  return hits.length ? hits[0] : undefined;
}
function sameValue(actual, want) {
  if (Array.isArray(actual)) return actual.some(x => sameValue(x, want));
  if (actual === null || actual === undefined) return false;
  if (isObj(actual)) return norm(contentText(actual)).includes(norm(want));
  const a = String(actual), na = numericLiteral(a), nw = numericLiteral(want);
  if (na !== null && nw !== null) return Math.abs(na - nw) < 1e-9;
  return norm(a) === norm(want);
}
function createdMatching(P, eff) {
  return eff.created.filter(c => (!P.app || c.app === P.app) && (!P.container || c.ids.has(P.container) || norm(c.text).includes(norm(P.container)))
    && (!P.label || containsLiteral(c.text, P.label)));
}

/** Evaluate one check. ctx: {mapPtr(ptr) -> {app, coll, id} | null, final: final world}. -> {pass, evidence} */
export function evaluateCheck(check, eff, ctx) {
  const P = check.params;
  switch (check.type) {
    case 'msg_to': { const m = messagesTo(P.target, eff, ctx); return m.length ? { pass: true, evidence: m[0].where } : { pass: false, evidence: `no new message to ${tname(P.target)}` }; }
    case 'msg_none': { const m = messagesTo(P.target, eff, ctx); return m.length ? { pass: false, evidence: `message to ${tname(P.target)}: ${m[0].where}` } : { pass: true, evidence: 'none' }; }
    case 'post_in': { const m = messagesTo(P.target, eff, ctx); return m.length ? { pass: true, evidence: m[0].where } : { pass: false, evidence: `no new message in ${tname(P.target)}` }; }
    case 'post_none': { const m = messagesTo(P.target, eff, ctx); return m.length ? { pass: false, evidence: `message in ${tname(P.target)}: ${m[0].where}` } : { pass: true, evidence: 'none' }; }
    case 'msg_has': {
      const m = messagesTo(P.target, eff, ctx);
      if (!m.length) return { pass: false, evidence: `no message to ${tname(P.target)} to carry ${JSON.stringify(P.lit)}` };
      const hit = m.find(x => containsLiteral(x.text, P.lit));
      return hit ? { pass: true, evidence: hit.where } : { pass: false, evidence: `${m.length} message(s) to ${tname(P.target)} lack ${JSON.stringify(P.lit)}` };
    }
    case 'msg_lacks': {
      const m = messagesTo(P.target, eff, ctx);
      const hit = m.find(x => containsLiteral(x.text, P.lit) === 'exact');
      return hit ? { pass: false, evidence: `${hit.where} carries ${JSON.stringify(P.lit)}` } : { pass: true, evidence: 'absent' };
    }
    case 'rec_changed': case 'rec_unchanged': {
      const r = ctx.mapPtr(P.ptr);
      if (!r) return { pass: null, evidence: `record ${P.ptr} not found in this candidate's world` };
      const u = eff.updated.find(x => x.app === r.app && x.coll === r.coll && x.id === r.id);
      const del = eff.deleted.some(x => x.app === r.app && x.coll === r.coll && x.id === r.id);
      let changed;
      if (P.scope === 'reply') changed = Boolean(u?.reply) || eff.created.some(c => c.app === r.app && c.ids.has(r.id));
      else changed = Boolean(u) || del;
      const ok = check.type === 'rec_changed' ? changed : !changed;
      return { pass: ok, evidence: changed ? `changed: ${u ? Object.keys(u.fields).slice(0, 4).join(', ') : del ? 'deleted' : 'reply record'}` : 'not changed' };
    }
    case 'rec_field': {
      const r = ctx.mapPtr(P.ptr);
      if (!r) return { pass: null, evidence: `record ${P.ptr} not found in this candidate's world` };
      const fin = (ctx.final?.[r.app]?.[r.coll] ?? []).find?.(x => isObj(x) && String(x.id ?? x.row_id) === r.id);
      if (!fin) return { pass: false, evidence: `${P.ptr} absent after the work` };
      const v = fieldValue(fin, P.field);
      return sameValue(v, P.value) ? { pass: true, evidence: `${P.field} = ${JSON.stringify(v)}`.slice(0, 200) } : { pass: false, evidence: `${P.field} = ${JSON.stringify(v ?? null)}, expected ${JSON.stringify(P.value)}`.slice(0, 240) };
    }
    case 'rec_deleted': case 'rec_kept': {
      const r = ctx.mapPtr(P.ptr);
      if (!r) return { pass: null, evidence: `record ${P.ptr} not found in this candidate's world` };
      const del = eff.deleted.some(x => x.app === r.app && x.coll === r.coll && x.id === r.id);
      return { pass: check.type === 'rec_deleted' ? del : !del, evidence: del ? 'deleted' : 'present' };
    }
    case 'created_in': { const m = createdMatching(P, eff); return m.length ? { pass: true, evidence: `${m[0].app}.${m[0].coll}:${m[0].id}` } : { pass: false, evidence: `no new ${P.app || ''} record${P.container ? ` in ${P.container}` : ''}${P.label ? ` naming ${JSON.stringify(P.label)}` : ''}` }; }
    case 'created_has': {
      const m = createdMatching(P, eff);
      if (!m.length) return { pass: false, evidence: `no new ${P.app || ''} record${P.container ? ` in ${P.container}` : ''}${P.label ? ` naming ${JSON.stringify(P.label)}` : ''}` };
      const hit = m.find(c => containsLiteral(c.text, P.lit));
      return hit ? { pass: true, evidence: `${hit.app}.${hit.coll}:${hit.id}` } : { pass: false, evidence: `${m.length} new record(s) lack ${JSON.stringify(P.lit)}` };
    }
    case 'created_none': {
      const m = createdMatching({ app: P.app, container: P.container }, eff).filter(c => containsLiteral(c.text, P.lit) === 'exact');
      return m.length ? { pass: false, evidence: `${m[0].app}.${m[0].coll}:${m[0].id} carries ${JSON.stringify(P.lit)}` } : { pass: true, evidence: 'none' };
    }
    default: return { pass: null, evidence: `unknown check type ${check.type}` };
  }
}

/** A pointer mapper from the task's canonical initial world to this candidate's initial world. */
export function ptrMapper(canonIdx, rowIdx) {
  const cache = new Map();
  return ptr => {
    if (cache.has(ptr)) return cache.get(ptr);
    const src = canonIdx.byPtr.get(ptr);
    const dst = src ? remapRecord(src, rowIdx) : rowIdx.byPtr.get(ptr) ?? null;
    const out = dst ? { app: dst.app, coll: dst.coll, id: dst.id } : null;
    cache.set(ptr, out);
    return out;
  };
}

/** Evaluate every code check of a task on one candidate. -> [{key, type, polarity, cat, hard, pass, evidence}] */
export function runCodeChecks(merged, { diff, world0, final, canonIdx, rowIdx }) {
  const eff = effectsOf(diff, world0);
  const ctx = { mapPtr: ptrMapper(canonIdx, rowIdx), final };
  const out = [{ key: 'effect_any', type: 'effect_any', polarity: 'must', cat: 'positive', hard: true, support: merged.readers, pass: eff.n > 0, evidence: `${eff.n} effect(s)` }];
  for (const c of merged.checks) {
    const r = evaluateCheck(c, eff, ctx);
    out.push({ key: c.key, type: c.type, polarity: c.polarity, cat: c.cat, hard: c.hard, support: c.support, pass: r.pass, evidence: r.evidence, statement: c.statement });
  }
  return { results: out, effects: eff.n };
}

export { numbersIn };
