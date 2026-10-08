// Deterministic in-memory mock of the part of the Zoho CRM v3 REST API (Contacts module) that the n8n:12679
// workflow uses: get / create / update / bulk update / delete / add_tags (+ search by email for improved solutions).
// Shapes follow the public Zoho CRM API conventions as the author's workflow uses them (see README assumptions
// A1-A6); nothing here is captured from the real service.
//
// Two faces on the same store:
//   * the candidate-facing API (api* methods, always actor 'api' = the integration user), and
//   * host-side "UI" operations used by the scenarios (a person working in the Zoho UI).
// Every successful write emits a webhook event (Zoho workflow rule, A2), tagged with the actor, which the harness
// delivers to the candidate. The candidate never sees the actor except through body.modifiedBy, as in the original.
import { normEmail, isEmail, isIsoDate, res } from './common.mjs';

export const ZOHO_TEXT_FIELDS = ['First_Name', 'Last_Name', 'Email', 'Phone', 'Mobile', 'Home_Phone', 'Fax', 'Mailing_Street', 'Mailing_City', 'Mailing_State', 'Mailing_Zip', 'Mailing_Country'];
const ALLOWED = new Set([...ZOHO_TEXT_FIELDS, 'Date_of_Birth', 'KlickTipp_ID', 'Email_Opt_Out', 'Full_Name']);

export class ZohoMock {
  constructor({ cfg, idSeed, emit }) {
    this.cfg = cfg; this.emit = emit;
    this.contacts = new Map(); this.counter = 0; this.clock = 0;
    this.idBase = 570000000000000000n + BigInt(idSeed % 90000) * 1000000n;
  }

  // ---------------------------------------------------------------- internals
  nextId() { return String(this.idBase + BigInt(++this.counter)); }
  tick() { return `2026-01-01T00:00:${String(this.clock++).padStart(6, '0')}Z`; }
  // Webhook body as configured by the author's Zoho workflow rules: key-value pairs built from the record.
  bodyOf(r) {
    const s = v => (v === null || v === undefined ? '' : String(v));
    return {
      id: r.id, email: s(r.Email), firstName: s(r.First_Name), lastName: s(r.Last_Name), phone: s(r.Phone), mobile: s(r.Mobile),
      homePhone: s(r.Home_Phone), fax: s(r.Fax), dateOfBirth: s(r.Date_of_Birth), mailingCountry: s(r.Mailing_Country), mailingState: s(r.Mailing_State),
      mailingCity: s(r.Mailing_City), mailingStreet: s(r.Mailing_Street), mailingZip: s(r.Mailing_Zip), klicktippId: s(r.KlickTipp_ID), modifiedBy: r.Modified_By.name,
    };
  }
  fire(trigger, actor, rec) { this.emit({ system: 'zoho', trigger, actor, data: { headers: { 'content-type': 'application/json' }, params: {}, query: {}, body: this.bodyOf(rec) } }); }
  actorName(actor) { return actor === 'api' ? this.cfg.apiUserName : actor; }

  // Validation shared by create and update. Returns an error entry or null.
  validate(fields, creating) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { code: 'INVALID_DATA', details: { reason: 'fields must be an object' } };
    for (const k of Object.keys(fields)) if (!ALLOWED.has(k)) return { code: 'INVALID_DATA', details: { api_name: k, reason: 'unknown field' } };
    if (creating && !(typeof fields.Last_Name === 'string' && fields.Last_Name.trim())) return { code: 'MANDATORY_NOT_FOUND', details: { api_name: 'Last_Name' } };
    if ('Last_Name' in fields && !(typeof fields.Last_Name === 'string' && fields.Last_Name.trim())) return { code: 'MANDATORY_NOT_FOUND', details: { api_name: 'Last_Name' } };
    if (fields.Email && !isEmail(fields.Email)) return { code: 'INVALID_DATA', details: { api_name: 'Email', reason: 'not an email address' } };
    const dob = fields.Date_of_Birth;
    if (dob !== undefined && dob !== null && dob !== '' && !isIsoDate(dob)) return { code: 'INVALID_DATA', details: { api_name: 'Date_of_Birth', reason: 'expected YYYY-MM-DD' } };
    if ('Email_Opt_Out' in fields && typeof fields.Email_Opt_Out !== 'boolean') return { code: 'INVALID_DATA', details: { api_name: 'Email_Opt_Out', reason: 'expected boolean' } };
    for (const k of ZOHO_TEXT_FIELDS) if (k in fields && fields[k] !== null && typeof fields[k] !== 'string') return { code: 'INVALID_DATA', details: { api_name: k, reason: 'expected string' } };
    return null;
  }
  clean(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'Full_Name') continue;                                // computed by Zoho, ignored on input (A3)
      if (k === 'KlickTipp_ID') out[k] = v === '' || v === null ? null : String(v);
      else if (k === 'Email_Opt_Out') out[k] = v;
      else out[k] = v === '' || v === undefined ? null : v;
    }
    return out;
  }
  blank() {
    const r = {};
    for (const k of ZOHO_TEXT_FIELDS) r[k] = null;
    return { ...r, Date_of_Birth: null, KlickTipp_ID: null, Email_Opt_Out: false };
  }
  err(status, entry) { return res(status, { data: [{ code: entry.code, message: entry.code, status: 'error', details: entry.details ?? {} }] }); }
  ok(status, id, extra = {}) { return res(status, { data: [{ code: 'SUCCESS', message: 'record added', status: 'success', details: { id, ...extra } }] }); }
  view(r) { return { ...r, Full_Name: [r.First_Name, r.Last_Name].filter(Boolean).join(' '), Tag: r.Tag.map(t => ({ ...t })), Modified_By: { ...r.Modified_By } }; }

  // ---------------------------------------------------------------- core operations (actor: 'api' or a UI user name)
  create(fields, actor, { trigger = 'zoho-created-or-updated', tags = [] } = {}) {
    const bad = this.validate(fields, true);
    if (bad) return this.err(400, bad);
    const id = this.nextId(), t = this.tick();
    const rec = { id, ...this.blank(), ...this.clean(fields), Tag: tags.map((name, i) => ({ id: `${id}-t${i}`, name })), Created_Time: t, Modified_Time: t, Modified_By: { name: this.actorName(actor) } };
    this.contacts.set(id, rec);
    this.fire(trigger, actor, rec);
    return this.ok(201, id, { Created_Time: t, Modified_Time: t });
  }
  update(id, fields, actor, { addTags = [] } = {}) {
    const rec = this.contacts.get(String(id));
    if (!rec) return this.err(404, { code: 'INVALID_DATA', details: { api_name: 'id', reason: 'record not found' } });
    const bad = this.validate(fields, false);
    if (bad) return this.err(400, bad);
    Object.assign(rec, this.clean(fields));
    for (const name of addTags) if (!rec.Tag.some(t => t.name === name)) rec.Tag.push({ id: `${rec.id}-t${rec.Tag.length}`, name });
    rec.Modified_Time = this.tick(); rec.Modified_By = { name: this.actorName(actor) };
    this.fire('zoho-created-or-updated', actor, rec);
    return this.ok(200, rec.id, { Modified_Time: rec.Modified_Time });
  }
  remove(id, actor) {
    const rec = this.contacts.get(String(id));
    if (!rec) return this.err(404, { code: 'INVALID_DATA', details: { api_name: 'id', reason: 'record not found' } });
    this.contacts.delete(rec.id);
    rec.Modified_By = { name: this.actorName(actor) };
    this.fire('zoho-deleted', actor, rec);
    return this.ok(200, rec.id);
  }

  // ---------------------------------------------------------------- candidate-facing API (actor = integration user)
  apiGetContact({ id }) {
    const rec = this.contacts.get(String(id));
    return rec ? res(200, { data: [this.view(rec)] }) : this.err(404, { code: 'INVALID_DATA', details: { api_name: 'id', reason: 'record not found' } });
  }
  apiCreateContact({ fields }) { return this.create(fields, 'api'); }
  apiUpdateContact({ id, fields }) { return this.update(id, fields, 'api'); }
  // PUT /Contacts {data:[{id, ...fields}]}: per-record results, HTTP 200 (A4).
  apiBulkUpdate({ records }) {
    if (!Array.isArray(records) || !records.length) return res(400, { code: 'INVALID_DATA', message: 'data must be a non-empty array' });
    const data = records.map(r => {
      const { id, ...fields } = r ?? {};
      const out = this.update(id, fields, 'api');
      return out.body.data[0];
    });
    return res(200, { data });
  }
  apiDeleteContact({ id }) { return this.remove(id, 'api'); }
  // POST /Contacts/actions/add_tags {ids:[...], tags:[{name}]}
  apiAddTags({ ids, tags }) {
    if (!Array.isArray(ids) || !ids.length || !Array.isArray(tags) || !tags.length || tags.some(t => !t || typeof t.name !== 'string' || !t.name)) return res(400, { code: 'INVALID_DATA', message: 'ids and tags[{name}] required' });
    const data = ids.map(id => {
      const rec = this.contacts.get(String(id));
      if (!rec) return { code: 'INVALID_DATA', status: 'error', message: 'record not found', details: { id: String(id) } };
      const names = tags.map(t => t.name).filter(n => !rec.Tag.some(x => x.name === n));
      if (names.length) { // Modifying the tag set counts as a record edit and fires the workflow rule (A2).
        for (const name of names) rec.Tag.push({ id: `${rec.id}-t${rec.Tag.length}`, name });
        rec.Modified_Time = this.tick(); rec.Modified_By = { name: this.actorName('api') };
        this.fire('zoho-created-or-updated', 'api', rec);
      }
      return { code: 'SUCCESS', status: 'success', message: 'tags added', details: { id: rec.id, tags: rec.Tag.map(t => t.name) } };
    });
    return res(200, { data });
  }
  // GET /Contacts/search?email=...: 204 with no body when nothing matches (the Zoho convention).
  apiSearchContacts({ email }) {
    const want = normEmail(email);
    if (!want) return res(400, { code: 'INVALID_QUERY', message: 'email required' });
    const hits = [...this.contacts.values()].filter(r => normEmail(r.Email) === want).map(r => this.view(r));
    return hits.length ? res(200, { data: hits }) : res(204, null);
  }

  // ---------------------------------------------------------------- host-side
  dump() { return [...this.contacts.values()].map(r => ({ ...r, Tag: r.Tag.map(t => ({ ...t })), Modified_By: { ...r.Modified_By } })); }
  // Stable projection used to decide whether a call changed state (volatile metadata excluded).
  digest() { return JSON.stringify([...this.contacts.values()].map(({ Modified_Time, Modified_By, ...r }) => r)); }
  state() { return { contacts: [...this.contacts.entries()], counter: this.counter, clock: this.clock }; }
  load(s) { this.contacts = new Map(s.contacts); this.counter = s.counter; this.clock = s.clock; }
}
