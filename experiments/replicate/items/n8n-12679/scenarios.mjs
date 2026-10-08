// Scenario scripts and the intent model that produces the expected state after every step.
// Everything here is a pure function of (seed, split, difficulty) and is HIDDEN from solvers (host code).
//
// The intent model (Model, below) is the oracle's statement of what the job means, written from the author's
// description and the observable behaviour of the definition. It is deliberately a small state machine over
// abstract persons, not an API-level re-implementation, so it does not share code with any solver.
import { readFileSync } from 'node:fs';
import { rng } from '../../../../beds/lib/rng.mjs';

const here = new URL('./', import.meta.url);
export const readJson = rel => JSON.parse(readFileSync(new URL(rel, here), 'utf8'));
export const CONFIG = readJson('fixtures/config.json');
export const POOLS = readJson('fixtures/pools.json');

// ------------------------------------------------------------------------------------------------------ people
const ascii = s => s.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();
const digits = (R, n) => Array.from({ length: n }, () => R.int(0, 9)).join('');
const isoDate = R => `${R.int(1950, 2003)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`;

export function personFactory(R, difficulty, domain = 'mail.example') {
  const used = new Set();
  let n = 0;
  return function person(over = {}) {
    n++;
    const accent = difficulty >= 4 && R.chance(0.25);
    const first = R.pick(accent ? POOLS.firstAccent : POOLS.first);
    let last = R.pick(POOLS.last);
    if (difficulty >= 4 && over.injection) last = `${last} (${R.pick(POOLS.injection)})`;
    let email;
    do { email = `${ascii(first) || 'x'}.${ascii(last.split(' ')[0])}${R.int(10, 99)}@${domain}`; } while (used.has(email));
    used.add(email);
    return {
      email, first, last, phone: `+49 30 ${digits(R, 7)}`, mobile: `+49 151 ${digits(R, 7)}`,
      homePhone: R.chance(0.7) ? `+49 30 ${digits(R, 7)}` : '', fax: R.chance(0.4) ? `+49 30 ${digits(R, 7)}` : '',
      dob: isoDate(R), street: `${R.pick(POOLS.street)} ${R.int(1, 99)}`, city: R.pick(POOLS.city), state: R.pick(POOLS.state), zip: digits(R, 5), country: R.pick(POOLS.country),
      ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'injection')),
    };
  };
}
// Every mapped field except the email (the join key).
export const EDITABLE = ['first', 'last', 'phone', 'mobile', 'homePhone', 'fax', 'dob', 'street', 'city', 'state', 'zip', 'country'];
// A few field changes for an edit step.
function change(R, person, keys) {
  const pickers = {
    phone: () => `+49 40 ${digits(R, 7)}`, mobile: () => `+49 160 ${digits(R, 7)}`, last: () => R.pick(POOLS.last), first: () => R.pick(POOLS.first), city: () => R.pick(POOLS.city),
    street: () => `${R.pick(POOLS.street)} ${R.int(1, 99)}`, zip: () => digits(R, 5), fax: () => `+49 40 ${digits(R, 7)}`, state: () => R.pick(POOLS.state), country: () => R.pick(POOLS.country),
    homePhone: () => `+49 40 ${digits(R, 7)}`, dob: () => isoDate(R),
  };
  const out = {};
  for (const k of keys) { let v; do { v = pickers[k](); } while (v === person[k]); out[k] = v; }
  return out;
}

// ------------------------------------------------------------------------------------------------------ intent model
const set = xs => new Set(xs ?? []);
const copy = f => ({ ...f });
export class Model {
  constructor() { this.p = {}; }
  get(ref) { return (this.p[ref] ??= { z: null, k: null, linked: false }); }
  apply(a) {
    const p = a.ref ? this.get(a.ref) : null;
    switch (`${a.sys}.${a.op}`) {
      case 'zoho.seed': p.z = { f: copy(a.person), segs: set(a.segs) }; break;
      case 'kt.seed': p.k = { f: copy(a.person), status: a.status ?? 'Subscribed', list: a.list ?? 'soi', segs: set(a.tags), tags: new Set() }; break;
      case 'zoho.create': p.z = { f: copy(a.person), segs: set(a.segs) }; this.zEvent(p, 'update'); break;
      case 'zoho.form': p.z = { f: copy(a.person), segs: set(a.segs) }; this.zEvent(p, 'form'); break;
      case 'zoho.edit': p.z.f = { ...p.z.f, ...a.set }; for (const s of a.addSegs ?? []) p.z.segs.add(s); this.zEvent(p, 'update'); break;
      case 'zoho.delete': if (p.linked && p.k) p.k = null; p.z = null; p.linked = false; break;
      case 'kt.create': p.k = { f: copy(a.person), status: a.status ?? 'Subscribed', list: a.list ?? 'soi', segs: set(a.tags), tags: new Set() }; if (a.activate) this.kEvent(p); break;
      case 'kt.edit': p.k.f = { ...p.k.f, ...a.set }; for (const s of a.tags ?? []) p.k.segs.add(s); if (a.activate !== false) this.kEvent(p); break;
      case 'kt.unsubscribe': p.k.status = 'Unsubscribed'; this.kEvent(p); break;
      case 'kt.confirm': p.k.status = 'Subscribed'; this.kEvent(p); break;
      case 'kt.activate': this.kEvent(p); break;
      case 'kt.delete': if (p.linked && p.z) p.z = null; p.k = null; p.linked = false; break;
      case 'sys.redeliver': break;                       // at-least-once delivery must not change the outcome
      default: throw new Error(`model: unknown action ${a.sys}.${a.op}`);
    }
  }
  // A Zoho create/edit/form event with an email reaches KlickTipp.
  zEvent(p, kind) {
    if (!p.z.f.email) return;
    if (kind === 'form') { p.k = { f: copy(p.z.f), status: 'Pending', list: 'doi', segs: new Set(), tags: set(['createdViaForm']) }; p.linked = true; return; }
    if (p.k) { p.k.f = copy(p.z.f); for (const s of p.z.segs) p.k.segs.add(s); p.linked = true; return; }   // existing subscriber is updated/linked (upsert by email)
    p.k = { f: copy(p.z.f), status: 'Subscribed', list: 'soi', segs: new Set(p.z.segs), tags: set(['created']) }; p.linked = true;
  }
  // A KlickTipp "contact tagged" event with a last name reaches Zoho.
  kEvent(p) {
    if (!p.k.f.last) return;
    if (p.z) { p.z.f = copy(p.k.f); for (const s of p.k.segs) p.z.segs.add(s); p.linked = true; return; }
    p.z = { f: copy(p.k.f), segs: new Set(p.k.segs) }; p.linked = true;
  }
  snapshot() {
    const out = {};
    for (const [ref, p] of Object.entries(this.p)) {
      out[ref] = {
        z: p.z && { f: copy(p.z.f), segs: [...p.z.segs].sort() },
        k: p.k && { f: copy(p.k.f), status: p.k.status, list: p.k.list, segs: [...p.k.segs].sort(), tags: [...p.k.tags].sort() },
        linked: p.linked,
      };
    }
    return { people: out };
  }
}

// ------------------------------------------------------------------------------------------------------ builders
// A scenario is { id, title, kind, setup:[actions], steps:[{label, actions, expect}] }. `expect` is the model snapshot after the step.
function build(id, title, kind, { setup = [], steps }) {
  const m = new Model();
  for (const a of setup) m.apply(a);
  const out = steps.map(s => {
    const concurrent = s.concurrent;
    const before = concurrent ? JSON.parse(JSON.stringify(m.snapshot())) : null;
    for (const a of s.actions) m.apply(a);
    const expect = m.snapshot();
    if (concurrent) {
      // Both sides edited before either event was processed: any conflict rule is acceptable as long as the systems converge and
      // every field holds the old value or one of the two edits.
      for (const ref of concurrent) {
        const b = before.people[ref], e = expect.people[ref];
        const allowed = {};
        for (const k of Object.keys(e.z.f)) allowed[k] = [...new Set([b.z.f[k], ...s.actions.filter(a => a.ref === ref && a.set && k in a.set).map(a => a.set[k])])];
        e.converge = allowed;
      }
    }
    return { label: s.label, actions: s.actions, expect };
  });
  return { id, title, kind, setup, steps: out };
}
const A = {
  zCreate: (ref, person, segs, segCase) => ({ sys: 'zoho', op: 'create', ref, person, segs, ...(segCase ? { segCase } : {}) }),
  zForm: (ref, person) => ({ sys: 'zoho', op: 'form', ref, person }),
  zEdit: (ref, set, addSegs, segCase) => ({ sys: 'zoho', op: 'edit', ref, set, addSegs, ...(segCase ? { segCase } : {}) }),
  zDelete: ref => ({ sys: 'zoho', op: 'delete', ref }),
  zSeed: (ref, person, segs) => ({ sys: 'zoho', op: 'seed', ref, person, segs }),
  kCreate: (ref, person, o = {}) => ({ sys: 'kt', op: 'create', ref, person, activate: true, ...o }),
  kEdit: (ref, set, o = {}) => ({ sys: 'kt', op: 'edit', ref, set, ...o }),
  kUnsub: ref => ({ sys: 'kt', op: 'unsubscribe', ref }),
  kConfirm: ref => ({ sys: 'kt', op: 'confirm', ref }),
  kDelete: ref => ({ sys: 'kt', op: 'delete', ref }),
  kActivate: ref => ({ sys: 'kt', op: 'activate', ref }),
  kSeed: (ref, person, o = {}) => ({ sys: 'kt', op: 'seed', ref, person, ...o }),
  redeliver: trigger => ({ sys: 'sys', op: 'redeliver', trigger }),
};
const step = (label, ...actions) => ({ label, actions });

export function coreScenarios({ seed, split, difficulty }) {
  const R = id => rng('rbench-n8n-12679', split, seed, difficulty, id);
  const domain = seed === 'examples' ? 'sample.example' : 'mail.example';   // the worked examples never share an email with a graded seed
  const mk = id => { const r = R(id); return { r, P: personFactory(r, difficulty, domain) }; };
  const out = [];
  const add = (id, title, f) => { const { r, P } = mk(id); out.push(build(id, title, 'core', f(r, P))); };

  add('S01', 'a contact created in Zoho appears in KlickTipp on the single opt-in list, cross-linked', (r, P) => {
    const a = P();
    return { steps: [step('zoho: create', A.zCreate('a', a))] };
  });
  // S02/S06 change EVERY mapped field and clear one (v0.2.0): with only a few fields changing, a solution whose update path forgets
  // fields, or never propagates an emptied field, passed (adversarial verification 2026-10-08).
  add('S02', 'an edit in Zoho (every mapped field, an email change and a cleared field) updates the same KlickTipp subscriber', (r, P) => {
    const a = P(), ch = change(r, a, EDITABLE.filter(k => k !== 'mobile'));
    return { steps: [step('zoho: create', A.zCreate('a', a)), step('zoho: edit', A.zEdit('a', { ...ch, mobile: '', email: P().email }))] };
  });
  add('S03', 'a Zoho web-form submission creates a Pending subscriber on the double opt-in list', (r, P) => ({ steps: [step('zoho: form', A.zForm('a', P()))] }));
  add('S04', 'confirming the double opt-in in KlickTipp flips the opt-out in Zoho without duplicating anything', (r, P) => ({
    steps: [step('zoho: form', A.zForm('a', P())), step('klicktipp: confirm', A.kConfirm('a'))],
  }));
  add('S05', 'a subscriber tagged for sync in KlickTipp becomes a cross-linked Zoho contact', (r, P) => ({ steps: [step('klicktipp: create+activate', A.kCreate('a', P()))] }));
  add('S06', 'an edit in KlickTipp (every mapped field, an email change and a cleared field) updates the same Zoho contact', (r, P) => {
    const a = P(), ch = change(r, a, EDITABLE.filter(k => k !== 'state'));
    return { steps: [step('klicktipp: create+activate', A.kCreate('a', a)), step('klicktipp: edit+activate', A.kEdit('a', { ...ch, state: '', email: P().email }))] };
  });
  add('S07', 'unsubscribing in KlickTipp sets the Zoho opt-out and keeps both records', (r, P) => ({
    steps: [step('zoho: create', A.zCreate('a', P())), step('klicktipp: unsubscribe', A.kUnsub('a'))],
  }));
  add('S08', 'an edit in Zoho does not undo an opt-out that KlickTipp holds', (r, P) => {
    const a = P();
    return { steps: [step('zoho: create', A.zCreate('a', a)), step('klicktipp: unsubscribe', A.kUnsub('a')), step('zoho: edit', A.zEdit('a', change(r, a, ['phone', 'city'])))] };
  });
  add('S09', 'deleting a contact in Zoho deletes its KlickTipp subscriber and nothing else', (r, P) => {
    const by = P();
    return { setup: [A.zSeed('by', by), A.kSeed('by', by)], steps: [step('zoho: create a,b', A.zCreate('a', P()), A.zCreate('b', P())), step('zoho: delete a', A.zDelete('a'))] };
  });
  add('S10', 'deleting a subscriber in KlickTipp deletes its Zoho contact and nothing else', (r, P) => {
    const by = P();
    return { setup: [A.zSeed('by', by), A.kSeed('by', by)], steps: [step('klicktipp: create a,b', A.kCreate('a', P()), A.kCreate('b', P())), step('klicktipp: delete a', A.kDelete('a'))] };
  });
  add('S11', 'a Zoho contact without an email address is not sent to KlickTipp', (r, P) => ({
    steps: [step('zoho: create a (no email), b', A.zCreate('a', P({ email: '' })), A.zCreate('b', P()))],
  }));
  add('S12', 'a KlickTipp subscriber without a last name is not sent to Zoho', (r, P) => ({
    steps: [step('klicktipp: create+activate a (no last name), b', A.kCreate('a', P({ last: '' })), A.kCreate('b', P()))],
  }));
  // v0.2.0: the people in the Zoho UI type the tag names in varying case (the title always claimed case-insensitive matching, but every
  // tag used the configured spelling, so an exact-case matcher passed), and S14 gains an edit step (KlickTipp -> Zoho tags on edit were
  // only covered by the soak's random walk).
  add('S13', 'Zoho segment tags carry over to KlickTipp segment tags (case-insensitive, on create and on edit)', (r, P) => ({
    steps: [
      step('zoho: create c1..c4', A.zCreate('c1', P(), ['online'], 'lower'), A.zCreate('c2', P(), ['abc']), A.zCreate('c3', P(), ['online', 'abc'], 'upper'), A.zCreate('c4', P())),
      step('zoho: tag c4 abc and edit', A.zEdit('c4', change(r, P(), ['phone']), ['abc'], 'lower')),
    ],
  }));
  add('S14', 'KlickTipp segment tags carry over to Zoho tags (on create and on edit)', (r, P) => {
    const d4 = P();
    return { steps: [
      step('klicktipp: create+activate d1..d4', A.kCreate('d1', P(), { tags: ['online'] }), A.kCreate('d2', P(), { tags: ['abc'] }), A.kCreate('d3', P(), { tags: ['online', 'abc'] }), A.kCreate('d4', d4)),
      step('klicktipp: tag d4 ABC and edit+activate', A.kEdit('d4', change(r, d4, ['phone']), { tags: ['abc'] })),
    ] };
  });
  add('S15', 'a mixed run of creates, edits, opt-outs, deletions and re-creations from both sides stays consistent', (r, P) => soak(r, P, difficulty));
  return out;
}

// Random walk over valid operations; the model gives the expected state after every step.
function soak(r, P, difficulty) {
  const L = [8, 12, 18, 26, 36][difficulty - 1];
  const m = new Model(), steps = [], gone = [];
  let n = 0;
  const live = pred => Object.entries(m.p).filter(([, p]) => pred(p)).map(([ref]) => ref);
  const newRef = () => `p${++n}`;
  const segs = () => r.pick([[], [], ['online'], ['abc'], ['online', 'abc']]);
  const fresh = (forceGone = false) => (gone.length && (forceGone || r.chance(0.5)) ? P({ email: gone.splice(r.int(0, gone.length - 1), 1)[0] }) : P({ injection: n === 3 }));
  const ops = {
    newZ: () => { const ref = newRef(); return [A.zCreate(ref, fresh(), segs())]; },
    newK: () => { const ref = newRef(); return [A.kCreate(ref, fresh(), { tags: segs() })]; },
    newZgone: () => { const ref = newRef(); return [A.zCreate(ref, fresh(true), segs())]; },   // a person comes back under an email that was deleted earlier
    newKgone: () => { const ref = newRef(); return [A.kCreate(ref, fresh(true), { tags: segs() })]; },
    zEdit: () => { const ref = r.pick(live(p => p.z && p.z.f.email && p.linked)); const cur = m.p[ref].z.f; return [A.zEdit(ref, { ...change(r, cur, r.sample(['phone', 'city', 'last', 'zip', 'fax'], 2)), ...(r.chance(0.2) ? { email: P().email } : {}) }, r.chance(0.3) ? ['abc'] : [])]; },
    kEdit: () => { const ref = r.pick(live(p => p.k && p.k.f.last && p.linked)); const cur = m.p[ref].k.f; return [A.kEdit(ref, { ...change(r, cur, r.sample(['phone', 'first', 'street', 'mobile'], 2)), ...(r.chance(0.2) ? { email: P().email } : {}) }, { tags: r.chance(0.3) ? ['online'] : [] })]; },
    unsub: () => [A.kUnsub(r.pick(live(p => p.k && p.linked && p.k.status === 'Subscribed')))],
    confirm: () => [A.kConfirm(r.pick(live(p => p.k && p.linked && p.k.status === 'Pending')))],
    zDel: () => { const ref = r.pick(live(p => p.z && p.linked)); gone.push(m.p[ref].z.f.email); return [A.zDelete(ref)]; },
    kDel: () => { const ref = r.pick(live(p => p.k && p.linked)); gone.push(m.p[ref].k.f.email); return [A.kDelete(ref)]; },
    form: () => { const ref = newRef(); return [A.zForm(ref, fresh())]; },
  };
  const valid = {
    newZ: () => true, newK: () => true, form: () => true, newZgone: () => gone.length > 0, newKgone: () => gone.length > 0,
    zEdit: () => live(p => p.z && p.z.f.email && p.linked).length > 0, kEdit: () => live(p => p.k && p.k.f.last && p.linked).length > 0,
    unsub: () => live(p => p.k && p.linked && p.k.status === 'Subscribed').length > 0, confirm: () => live(p => p.k && p.linked && p.k.status === 'Pending').length > 0,
    zDel: () => live(p => p.z && p.linked).length > 1, kDel: () => live(p => p.k && p.linked).length > 1,
  };
  const weights = { newZ: 3, newK: 3, form: 1, zEdit: 4, kEdit: 4, unsub: 2, confirm: 2, zDel: 2, kDel: 2 };
  // The first steps follow a fixed plan so every operation appears in every seed (form+confirm, edits both ways, opt-out, deletions, re-creation under a
  // deleted email); the rest is a seeded random walk over whatever is valid at that point.
  const plan = ['form', 'zEdit', 'kEdit', 'unsub', 'confirm', 'zDel', 'newZgone', 'kDel', 'newKgone', 'zEdit', 'kEdit'];
  let planned = 0;
  const random = () => { const names = Object.keys(weights).filter(k => valid[k]()); const total = names.reduce((s, k) => s + weights[k], 0); let x = r.next() * total; for (const k of names) { x -= weights[k]; if (x < 0) return k; } return names[0]; };
  const choose = () => { const p = plan[planned++]; return p && valid[p]() ? p : random(); };
  // Start with two fresh persons so edits and deletions have something to act on.
  const first = [ops.newZ()[0], ops.newK()[0]];
  for (const a of first) m.apply(a);
  steps.push({ label: 'soak: start', actions: first });
  for (let i = 1; i < L; i++) {
    const acts = ops[choose()]();
    // Sometimes a second, independent operation lands in the same step (both events queue before either is processed).
    if (r.chance(0.2)) { const b = random(); if (['newZ', 'newK'].includes(b)) acts.push(...ops[b]()); }
    for (const a of acts) m.apply(a);
    steps.push({ label: `soak: ${acts.map(a => `${a.sys}.${a.op}`).join(' + ')}`, actions: acts });
  }
  // `build` re-derives the model snapshots from the action lists, so hand it only the lists.
  return { steps };
}

export function probeScenarios({ seed, split, difficulty }) {
  const R = id => rng('rbench-n8n-12679', split, seed, difficulty, id);
  const domain = seed === 'examples' ? 'sample.example' : 'mail.example';
  const mk = id => { const r = R(id); return { r, P: personFactory(r, difficulty, domain) }; };
  const out = [];
  const add = (id, title, f) => { const { r, P } = mk(id); out.push(build(id, title, 'probe', f(r, P))); };

  add('P1', 'both sides edited before either change is synced: the systems must converge (no swapped values)', (r, P) => {
    const a = P();
    return { steps: [
      step('zoho: create', A.zCreate('a', a)),
      { label: 'concurrent edits', concurrent: ['a'], actions: [A.zEdit('a', { phone: `+49 40 ${digits(r, 7)}`, city: r.pick(POOLS.city) }), A.kEdit('a', { phone: `+49 89 ${digits(r, 7)}`, fax: `+49 89 ${digits(r, 7)}` })] },
    ] };
  });
  add('P2', 'a person who already exists on both sides under the same email is linked, not duplicated', (r, P) => {
    const a = P(), b = P();
    return { setup: [A.zSeed('a', a), A.kSeed('a', a), A.zSeed('b', b), A.kSeed('b', b)], steps: [
      step('klicktipp: activate a', A.kActivate('a')),
      step('zoho: edit b', A.zEdit('b', change(r, b, ['phone']))),
    ] };
  });
  add('P3', 'a missing birthday stays missing (no invented date) in either direction', (r, P) => ({
    steps: [
      step('klicktipp: create+activate a without birthday', A.kCreate('a', P({ dob: '' }))),
      step('zoho: create b without birthday', A.zCreate('b', P({ dob: '' }))),
      step('klicktipp: unsubscribe b', A.kUnsub('b')),
    ],
  }));
  add('P4', 'a webhook delivered twice (at-least-once delivery) changes nothing the second time', (r, P) => ({
    steps: [
      step('klicktipp: create+activate a, delivered twice', A.kCreate('a', P()), A.redeliver('kt-tagged')),
      step('zoho: create b, delivered twice', A.zCreate('b', P()), A.redeliver('zoho-created-or-updated')),
    ],
  }));
  return out;
}

export const scenariosFor = args => ({ core: coreScenarios(args), probes: probeScenarios(args) });
