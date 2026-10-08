// The world one scenario runs in: both mocks, the event bus, the UI actor, and a small durable key-value store for
// candidates that want cross-run state (compare-and-swap, AGENTS.md "State changes use compare-and-swap").
// Trusted host code: candidates only ever reach `call()`; `ui()` is the scenario script.
import { hashSeed } from '../../../../beds/lib/rng.mjs';
import { ZohoMock } from './mocks/zoho.mjs';
import { KlickTippMock } from './mocks/klicktipp.mjs';
import { normEmail, clone, res } from './mocks/common.mjs';
import { toZoho, toKtFields } from './spec.mjs';

export const API_OPS = Object.freeze([
  'zoho.getContact', 'zoho.createContact', 'zoho.updateContact', 'zoho.bulkUpdate', 'zoho.deleteContact', 'zoho.addTags', 'zoho.searchContacts',
  'klicktipp.getSubscriber', 'klicktipp.subscribe', 'klicktipp.updateSubscriber', 'klicktipp.deleteSubscriber', 'klicktipp.tag',
  'state.get', 'state.put',
]);
// Calls that mutate an external system (state.* is local to the integration and not an external effect).
export const WRITE_OPS = Object.freeze(new Set(['zoho.createContact', 'zoho.updateContact', 'zoho.bulkUpdate', 'zoho.deleteContact', 'zoho.addTags', 'klicktipp.subscribe', 'klicktipp.updateSubscriber', 'klicktipp.deleteSubscriber', 'klicktipp.tag']));
const cap = s => s[0].toUpperCase() + s.slice(1);

export class World {
  constructor({ cfg, seed, scenarioId }) {
    this.cfg = cfg;
    const h = hashSeed('rbench-n8n-12679', seed, scenarioId);
    this.queue = []; this.history = []; this.seq = 0; this.muted = false; this.uiTurn = 0; this.refs = {}; this.store = new Map();
    const emit = ev => { if (this.muted) return; const e = { seq: ++this.seq, ...ev }; this.queue.push(e); this.history.push(e); };
    this.zoho = new ZohoMock({ cfg, idSeed: h, emit });
    this.kt = new KlickTippMock({ cfg, idSeed: (h >>> 7) + 3, emit });
  }

  // ---------------------------------------------------------------- candidate API
  digest() { return this.zoho.digest() + '|' + this.kt.digest(); }
  call(name, args) {
    if (!API_OPS.includes(name)) return { response: res(400, { error: 'UNKNOWN_CALL', message: `no such call ${String(name).slice(0, 60)}` }), effective: false, emitted: 0 };
    const [svc, op] = name.split('.');
    if (svc === 'state') return { response: this.stateCall(op, args), effective: false, emitted: 0 };
    const mock = svc === 'zoho' ? this.zoho : this.kt;
    const before = this.digest(), seq0 = this.seq;
    let response;
    try { response = mock[`api${cap(op)}`](clone(args ?? {})); }
    catch (e) { response = res(500, { error: 'MOCK_ERROR', message: String(e?.message ?? e).slice(0, 120) }); }
    return { response: clone(response), effective: this.digest() !== before, emitted: this.seq - seq0 };
  }
  stateCall(op, a = {}) {
    if (typeof a.key !== 'string' || !a.key) return res(400, { error: 'KEY_REQUIRED' });
    const cur = this.store.get(a.key);
    if (op === 'get') return cur ? res(200, { value: clone(cur.value), version: cur.version }) : res(404, { error: 'NOT_FOUND' });
    const wanted = a.ifVersion === undefined ? undefined : Number(a.ifVersion);
    if (wanted !== undefined && (cur ? cur.version : 0) !== wanted) return res(409, { error: 'VERSION_CONFLICT', version: cur ? cur.version : 0 });
    const next = { value: clone(a.value), version: (cur ? cur.version : 0) + 1 };
    this.store.set(a.key, next);
    return res(200, { version: next.version });
  }

  // ---------------------------------------------------------------- scenario script (host side)
  actor() { return this.cfg.uiUsers[this.uiTurn++ % this.cfg.uiUsers.length]; }
  zohoIdOf(ref) {
    const r = this.refs[ref]; if (!r) return null;
    if (r.zohoId && this.zoho.contacts.has(r.zohoId)) return r.zohoId;
    const want = normEmail(r.email);
    if (want) for (const c of this.zoho.contacts.values()) if (normEmail(c.Email) === want) return (r.zohoId = c.id);
    return null;
  }
  ktIdOf(ref) {
    const r = this.refs[ref]; if (!r) return null;
    if (r.ktId && this.kt.subs.has(r.ktId)) return r.ktId;
    const s = this.kt.byEmail(r.email);
    return s ? (r.ktId = s.id) : null;
  }
  tagIds(keys) { return (keys ?? []).map(k => this.cfg.klicktipp.tags[k].id); }
  segTagIds(keys) { return (keys ?? []).map(k => this.cfg.klicktipp.tags[this.cfg.segments.find(s => s.key === k).klicktippTag].id); }
  // Zoho tag names as a person types them: the configured spelling, or (segCase) all lower / upper case.
  segNames(keys, segCase) {
    const typed = n => (segCase === 'lower' ? n.toLowerCase() : segCase === 'upper' ? n.toUpperCase() : n);
    return (keys ?? []).map(k => typed(this.cfg.segments.find(s => s.key === k).zohoTag));
  }
  // Returns { skipped: reason } when the target record is not there (the candidate failed to create it), else {}.
  ui(a) {
    const out = {};
    const need = (id, what) => { if (!id) { out.skipped = `${a.sys}.${a.op} ${a.ref}: ${what} not found`; return false; } return true; };
    switch (`${a.sys}.${a.op}`) {
      case 'zoho.seed': case 'zoho.create': case 'zoho.form': {
        const muted = this.muted; this.muted = a.op === 'seed';
        const r = this.zoho.create(toZoho(a.person), this.actor(), { trigger: a.op === 'form' ? 'zoho-form' : 'zoho-created-or-updated', tags: this.segNames(a.segs, a.segCase) });
        this.muted = muted;
        if (r.status !== 201) throw new Error(`scenario error: ${a.op} ${a.ref} -> ${JSON.stringify(r.body)}`);
        this.refs[a.ref] = { ...(this.refs[a.ref] ?? {}), zohoId: r.body.data[0].details.id, email: a.person.email };
        break;
      }
      case 'zoho.edit': {
        const id = this.zohoIdOf(a.ref); if (!need(id, 'Zoho contact')) break;
        const r = this.zoho.update(id, toZoho(a.set ?? {}), this.actor(), { addTags: this.segNames(a.addSegs, a.segCase) });
        if (r.status !== 200) throw new Error(`scenario error: edit ${a.ref} -> ${JSON.stringify(r.body)}`);
        if (a.set?.email) this.refs[a.ref].email = a.set.email;
        break;
      }
      case 'zoho.delete': { const id = this.zohoIdOf(a.ref); if (need(id, 'Zoho contact')) this.zoho.remove(id, this.actor()); break; }
      case 'kt.seed': case 'kt.create': {
        const muted = this.muted; this.muted = a.op === 'seed';
        const { email, ...rest } = a.person;
        const id = this.kt.uiCreate({ email, fields: toKtFields(rest), status: a.status ?? 'Subscribed', listId: this.cfg.klicktipp.lists[a.list ?? 'soi'].id, tags: this.segTagIds(a.tags), activate: !!a.activate, actor: this.actor() });
        this.muted = muted;
        this.refs[a.ref] = { ...(this.refs[a.ref] ?? {}), ktId: id, email };
        break;
      }
      case 'kt.edit': case 'kt.unsubscribe': case 'kt.confirm': case 'kt.activate': {
        const id = this.ktIdOf(a.ref); if (!need(id, 'KlickTipp subscriber')) break;
        const { email, ...rest } = a.set ?? {};
        this.kt.uiEdit(id, {
          email, fields: toKtFields(rest), addTags: this.segTagIds(a.tags),
          status: a.op === 'unsubscribe' ? 'Unsubscribed' : a.op === 'confirm' ? 'Subscribed' : undefined,
          activate: a.activate !== false, actor: this.actor(),
        });
        if (email) this.refs[a.ref].email = email;
        break;
      }
      case 'kt.delete': { const id = this.ktIdOf(a.ref); if (need(id, 'KlickTipp subscriber')) this.kt.uiDelete(id, this.actor()); break; }
      case 'sys.redeliver': {
        const last = [...this.history].reverse().find(e => e.trigger === a.trigger && e.actor !== 'api');
        if (!last) { out.skipped = `redeliver ${a.trigger}: no such event`; break; }
        const e = { seq: ++this.seq, system: last.system, trigger: last.trigger, actor: last.actor, data: clone(last.data) };
        this.queue.push(e); this.history.push(e);
        break;
      }
      default: throw new Error(`scenario error: unknown UI action ${a.sys}.${a.op}`);
    }
    return out;
  }

  // ---------------------------------------------------------------- inspection / snapshot
  dump() { return { zoho: this.zoho.dump(), kt: this.kt.dump() }; }
  snapshot() {
    return clone({ zoho: this.zoho.state(), kt: this.kt.state(), queue: this.queue, history: this.history, seq: this.seq, uiTurn: this.uiTurn, refs: this.refs, store: [...this.store.entries()] });
  }
  restore(s) {
    const c = clone(s);
    this.zoho.load(c.zoho); this.kt.load(c.kt); this.queue = c.queue; this.history = c.history; this.seq = c.seq; this.uiTurn = c.uiTurn; this.refs = c.refs; this.store = new Map(c.store);
  }
}
