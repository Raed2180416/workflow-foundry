// Deterministic in-memory mock of the KlickTipp subscriber API as the n8n:12679 workflow uses it (through the
// community node): get / subscribe (upsert by email) / update / delete / tag. Authored from the node parameters in the
// definition and the author's setup notes; not captured from the real service (README assumptions A7-A12).
//
// KlickTipp has no per-change webhook. The author's integration fires on ACTIVATION TAGS: a KlickTipp automation
// applies the tag "send contact" (or "send deleted contact") and KlickTipp posts the subscriber to the trigger URL.
// The mock reproduces exactly that: an event is emitted whenever an activation tag is applied, by anyone. The host-side
// UI operations model the KlickTipp automation (a person edits a subscriber, the automation applies the tag).
import { normEmail, isEmail, isIsoDate, isoToUnix, res } from './common.mjs';

export const KT_STD_FIELDS = ['fieldFirstName', 'fieldLastName', 'fieldPhone', 'fieldMobilePhone', 'fieldPrivatePhone', 'fieldFax', 'fieldBirthday', 'fieldCountry', 'fieldState', 'fieldCity', 'fieldStreet1', 'fieldZip'];

export class KlickTippMock {
  constructor({ cfg, idSeed, emit }) {
    this.cfg = cfg; this.emit = emit;
    this.subs = new Map(); this.counter = 0;
    this.idBase = 400000 + (idSeed % 9000) * 100;
    this.zohoField = cfg.klicktipp.fields.zohoContactId;
    this.fieldKeys = new Set([...KT_STD_FIELDS, this.zohoField]);
    this.tagIds = new Set(Object.values(cfg.klicktipp.tags).map(t => t.id));
    this.listById = Object.fromEntries(Object.values(cfg.klicktipp.lists).map(l => [l.id, l]));
  }

  nextId() { return String(this.idBase + ++this.counter); }
  // Subscriber as returned by get/subscribe/update and as posted to the trigger: all account fields present, "" when unset (A8).
  snap(s) {
    const o = { id: s.id, email: s.email, status: s.status, listId: s.listId, tags: [...s.tags].sort(), fullname: [s.fields.fieldFirstName, s.fields.fieldLastName].filter(Boolean).join(' ') };
    for (const k of this.fieldKeys) o[k] = s.fields[k] ?? '';
    return o;
  }
  byEmail(email) { const w = normEmail(email); for (const s of this.subs.values()) if (normEmail(s.email) === w) return s; return null; }
  find({ id, email, lookupEmail }) { return id !== undefined && id !== null && id !== '' ? this.subs.get(String(id)) ?? null : this.byEmail(email ?? lookupEmail); }
  err(status, code, message) { return res(status, { error: code, message }); }

  checkFields(fields) {
    if (fields === undefined) return null;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'fields must be an object';
    for (const [k, v] of Object.entries(fields)) {
      if (!this.fieldKeys.has(k)) return `unknown field ${k}`;
      if (v !== null && v !== undefined && !['string', 'number'].includes(typeof v)) return `field ${k} must be a string`;
      if (k === 'fieldBirthday' && v !== '' && v !== null && v !== undefined && !(isIsoDate(String(v)) || /^-?\d+$/.test(String(v)))) return 'fieldBirthday must be a date or unix seconds';
    }
    return null;
  }
  setFields(s, fields = {}) {
    for (const [k, v] of Object.entries(fields)) {
      const str = v === null || v === undefined ? '' : String(v);
      s.fields[k] = k === 'fieldBirthday' && isIsoDate(str) ? isoToUnix(str) : str;   // A9: dates are stored as unix seconds
    }
  }
  // Applying a tag; the two activation tags fire the corresponding trigger (the actor is who applied the tag).
  applyTag(s, tagId, actor) {
    s.tags.add(String(tagId));
    const t = this.cfg.klicktipp.tags;
    if (String(tagId) === t.activationSend.id) this.emit({ system: 'klicktipp', trigger: 'kt-tagged', actor, data: this.snap(s) });
    else if (String(tagId) === t.activationDeleted.id) this.emit({ system: 'klicktipp', trigger: 'kt-deleted', actor, data: this.snap(s) });
  }
  tagList(tagId) { return tagId === undefined || tagId === null || tagId === '' ? [] : (Array.isArray(tagId) ? tagId : [tagId]).map(String); }

  // ---------------------------------------------------------------- candidate-facing API
  apiGetSubscriber(a) {
    const s = this.find(a ?? {});
    return s ? res(200, this.snap(s)) : this.err(404, 'SUBSCRIBER_NOT_FOUND', 'no such subscriber');
  }
  // POST subscribe: upsert by email. A new subscriber's status follows the list's opt-in mode; an existing subscriber keeps
  // its status and list, receives the given field values, and gets the tag (A7).
  apiSubscribe({ email, listId, tagId, fields }) {
    if (!isEmail(email)) return this.err(400, 'INVALID_EMAIL', 'a valid email address is required');
    const list = this.listById[String(listId)];
    if (!list) return this.err(400, 'INVALID_LIST', 'unknown list');
    const tags = this.tagList(tagId);
    if (tags.some(t => !this.tagIds.has(t))) return this.err(400, 'INVALID_TAG', 'unknown tag');
    const bad = this.checkFields(fields);
    if (bad) return this.err(400, 'INVALID_FIELD', bad);
    let s = this.byEmail(email);
    if (s) { s.email = email; }
    else {
      s = { id: this.nextId(), email, status: list.optIn === 'single' ? 'Subscribed' : 'Pending', listId: list.id, tags: new Set(), fields: {} };
      this.subs.set(s.id, s);
    }
    this.setFields(s, fields);
    for (const t of tags) this.applyTag(s, t, 'api');
    return res(200, this.snap(s));
  }
  // Update by id or by lookupEmail; email and custom fields may change, status never does through this call (A10).
  apiUpdateSubscriber({ id, lookupEmail, email, fields }) {
    const s = this.find({ id, lookupEmail });
    if (!s) return this.err(404, 'SUBSCRIBER_NOT_FOUND', 'no such subscriber');
    if (email !== undefined && email !== null && email !== '') {
      if (!isEmail(email)) return this.err(400, 'INVALID_EMAIL', 'a valid email address is required');
      const other = this.byEmail(email);
      if (other && other.id !== s.id) return this.err(409, 'EMAIL_IN_USE', 'another subscriber has this email');
    }
    const bad = this.checkFields(fields);
    if (bad) return this.err(400, 'INVALID_FIELD', bad);
    if (email) s.email = email;
    this.setFields(s, fields);
    return res(200, this.snap(s));
  }
  apiDeleteSubscriber({ id }) {
    const s = this.subs.get(String(id));
    if (!s) return this.err(404, 'SUBSCRIBER_NOT_FOUND', 'no such subscriber');
    this.subs.delete(s.id);
    return res(200, { id: s.id, deleted: true });
  }
  // Tag a subscriber identified by email.
  apiTag({ email, tagIds }) {
    const s = this.byEmail(email);
    if (!s) return this.err(404, 'SUBSCRIBER_NOT_FOUND', 'no such subscriber');
    const tags = this.tagList(tagIds);
    if (!tags.length || tags.some(t => !this.tagIds.has(t))) return this.err(400, 'INVALID_TAG', 'unknown or missing tag');
    for (const t of tags) this.applyTag(s, t, 'api');
    return res(200, this.snap(s));
  }

  // ---------------------------------------------------------------- host-side: a person (or KlickTipp automation) at work
  uiCreate({ email, fields = {}, status = 'Subscribed', listId, tags = [], activate = false, actor = 'ui' }) {
    const s = { id: this.nextId(), email, status, listId: String(listId), tags: new Set(), fields: {} };
    this.subs.set(s.id, s); this.setFields(s, fields);
    for (const t of tags) s.tags.add(String(t));
    if (activate) this.applyTag(s, this.cfg.klicktipp.tags.activationSend.id, actor);
    return s.id;
  }
  uiEdit(id, { email, fields = {}, addTags = [], status, activate = false, actor = 'ui' }) {
    const s = this.subs.get(String(id)); if (!s) return false;
    if (email) s.email = email;
    this.setFields(s, fields);
    for (const t of addTags) s.tags.add(String(t));
    if (status) s.status = status;
    if (activate) this.applyTag(s, this.cfg.klicktipp.tags.activationSend.id, actor);
    return true;
  }
  uiDelete(id, actor = 'ui') {
    const s = this.subs.get(String(id)); if (!s) return false;
    this.applyTag(s, this.cfg.klicktipp.tags.activationDeleted.id, actor);   // the deletion automation tags first, then deletes
    this.subs.delete(s.id);
    return true;
  }

  // ---------------------------------------------------------------- host-side bookkeeping
  dump() { return [...this.subs.values()].map(s => this.snap(s)); }
  digest() { return JSON.stringify([...this.subs.values()].map(s => this.snap(s))); }
  state() { return { subs: [...this.subs.entries()].map(([k, s]) => [k, { ...s, tags: [...s.tags], fields: { ...s.fields } }]), counter: this.counter }; }
  load(st) { this.subs = new Map(st.subs.map(([k, s]) => [k, { ...s, tags: new Set(s.tags), fields: { ...s.fields } }])); this.counter = st.counter; }
}
