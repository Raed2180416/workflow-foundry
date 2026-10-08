// R-bench item n8n:12679. node --test experiments/replicate/items/n8n-12679/item.test.mjs
// Oracle health per beds/CONTRACT.md: determinism, references pass (>=20 seeds), every bad control fails (>=20 seeds), schema-invalid output
// rejected, no hidden-truth leak, runtime limits. Plus: the mocks' semantics, the env, an alternative valid solution, the T3 cost cap, and the
// controls built on the ORIGINAL definition (skipped when /opt/corpus is absent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as bed from './index.mjs';
import { CONFIG, scenariosFor } from './scenarios.mjs';
import { ZOHO_OF, KT_OF } from './spec.mjs';
import { World, API_OPS } from './world.mjs';
import { createEnv, driveSync, drive, policyHandler, policyFromHandler, replay } from './env.mjs';
import { makeFaithful, makeImproved } from './controls/reference.mjs';
import { ORIGINAL, originalAvailable, loadOriginal, rebind, makeOriginalHandler, expressionsOf, classifyExpression, evalExpression, UnreviewedExpression, MUTANTS } from './controls/original.mjs';
import { buildAll, NODE_KIND_TO_CALL } from './build-fixtures.mjs';
import { canonical, estimateTokens } from '../../../../beds/lib/canonical.mjs';
import { solverView, inlineRender } from '../../../lib/beds.mjs';

const here = new URL('./', import.meta.url);
const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const gen = (seed, difficulty = 3, variant = 'T2', split = 'dev') => bed.generate({ seed, split, difficulty, variant });
const codesOf = r => new Set(r.details.scenarios?.flatMap(s => s.codes) ?? []);
const haveCorpus = originalAvailable();
const skipOriginal = haveCorpus ? false : `corpus file ${ORIGINAL.rawPath} not present`;

test('interface shape (beds/CONTRACT.md v1, interactive)', () => {
  assert.equal(bed.family.kind, 'interactive');
  for (const k of ['id', 'domain', 'version', 'description']) assert.ok(bed.family[k], k);
  for (const fn of ['generate', 'oracle', 'referenceSolve', 'createEnv']) assert.equal(typeof bed[fn], 'function', fn);
  assert.ok(Array.isArray(bed.badControls) && bed.badControls.length >= 3);
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'plausible-but-wrong']) assert.ok(names.includes(n), n);
  for (const c of bed.badControls) assert.equal(typeof c.make, 'function');
  const forbidden = ['pattern', 'oneOf', 'anyOf', 'allOf', 'uniqueItems', '$ref', 'format', 'patternProperties'];
  assert.ok(!forbidden.some(k => JSON.stringify(bed.outputSchema).includes(`"${k}"`)), 'portable schema subset');
  const env = bed.createEnv(gen(0));
  for (const fn of ['reset', 'step', 'observe', 'snapshot', 'restore', 'actions', 'record']) assert.equal(typeof env[fn], 'function', fn);
  assert.equal(env.determinism, 'D0');
});

test('determinism: identical calls give byte-identical tasks; seed, split, variant matter', () => {
  for (const variant of bed.VARIANTS) for (const d of [1, 3, 5]) {
    const a = gen(7, d, variant), b = gen(7, d, variant);
    assert.equal(canonical(a), canonical(b));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
  assert.notEqual(canonical(gen(3)), canonical(gen(4)));
  assert.notEqual(canonical(gen(3)), canonical(gen(3, 3, 'T2', 'test')));
  assert.notEqual(canonical(gen(3, 3, 'T1')), canonical(gen(3, 3, 'T2')));
  assert.equal(gen(3, 3, 'T2').id, 'rbench:n8n-12679:T2:dev:d3:s3');
  assert.deepEqual(Object.keys(gen(3, 3, 'T2')).sort(), ['budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split', 'variant']);
  assert.deepEqual(Object.keys(gen(3, 3, 'T3')).sort(), ['attachments', 'budget', 'difficulty', 'family', 'files', 'id', 'inputs', 'prompt', 'seed', 'split', 'variant']);
});

test('generate rejects bad arguments', () => {
  assert.throws(() => bed.generate({ seed: 1, split: 'train', difficulty: 1, variant: 'T2' }), /split/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 0, variant: 'T2' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 6, variant: 'T2' }), /difficulty/);
  assert.throws(() => bed.generate({ seed: 1.5, split: 'dev', difficulty: 3, variant: 'T2' }), /seed/);
  assert.throws(() => bed.generate({ seed: 1, split: 'dev', difficulty: 3, variant: 'T4' }), /variant/);
  assert.throws(() => bed.generate({ seed: 'examples', split: 'dev', difficulty: 3, variant: 'T2' }), /reserved/);
});

test('what each variant gives the solver (README table)', () => {
  const t1 = gen(1, 3, 'T1'), t2 = gen(1, 3, 'T2'), t3 = gen(1, 3, 'T3');
  assert.ok(t1.attachments?.[0]?.sha256 === ORIGINAL.sha256 && t3.attachments?.[0]?.sha256 === ORIGINAL.sha256);
  assert.equal(t2.attachments, undefined, 'T2 never sees the original definition');
  assert.ok(t2.inputs.description && t2.inputs.fieldMap && t2.inputs.examples.scenarios.length >= 3 && t2.inputs.eventSamples);
  assert.equal(t1.inputs.description, undefined, 'T1 gets the definition, not the description');
  assert.equal(t1.inputs.examples, undefined);
  assert.ok(t3.inputs.description && t3.budget.externalCalls > 100, 'T3 gets description + definition + a cost target');
  assert.equal(t1.budget.externalCalls, undefined);
  for (const t of [t1, t2, t3]) { assert.match(t.prompt, /TASK T[123]/); assert.ok(t.files['handler.mjs']); }
  // The n8n definition is not redistributable: the task carries a pointer and a hash, never the content.
  for (const t of [t1, t2, t3]) assert.ok(!JSON.stringify(t).includes('n8n-nodes-klicktipp'), 'no definition content in the task');
});

test('task sizes (tokens, bytes/4) are recorded for the README', () => {
  const size = t => estimateTokens(t.prompt) + estimateTokens(t.inputs) + estimateTokens(t.files);
  const s = Object.fromEntries(bed.VARIANTS.map(v => [v, size(gen(1, 3, v))]));
  assert.ok(s.T2 > s.T1 && s.T2 < 15000, JSON.stringify(s));
});

// ------------------------------------------------------------------------------------------------ the mocks
test('Zoho mock: validation, ids, tags, events carry the actor, bulk results are per record', () => {
  const w = new World({ cfg: CONFIG, seed: 1, scenarioId: 'unit' });
  const z = (n, a) => w.call(`zoho.${n}`, a);
  assert.equal(z('createContact', { fields: { First_Name: 'No last name' } }).response.status, 400);
  assert.equal(z('createContact', { fields: { Last_Name: 'X', Bogus: 1 } }).response.status, 400, 'unknown field');
  assert.equal(z('createContact', { fields: { Last_Name: 'X', Email: 'not an email' } }).response.status, 400);
  assert.equal(z('createContact', { fields: { Last_Name: 'X', Date_of_Birth: 'Invalid Date' } }).response.status, 400);
  const c = z('createContact', { fields: { Last_Name: 'Ng', Email: 'a@b.example' } });
  assert.equal(c.response.status, 201); assert.ok(c.effective && c.emitted === 1);
  const id = c.response.body.data[0].details.id;
  assert.match(id, /^\d{18}$/);
  assert.equal(w.queue[0].data.body.modifiedBy, CONFIG.apiUserName, 'API writes are attributed to the integration user');
  assert.equal(w.queue[0].data.body.klicktippId, '', 'empty values are empty strings in the webhook');
  const u = z('updateContact', { id, fields: { Phone: '1' } }); assert.equal(u.response.status, 200);
  const same = z('updateContact', { id, fields: { Phone: '1' } }); assert.equal(same.effective, false, 'a same-value write changes no state');
  assert.equal(same.emitted, 1, 'but it still fires the workflow rule');
  const t = z('addTags', { ids: [id], tags: [{ name: 'ABC' }] }); assert.equal(t.response.status, 200);
  assert.deepEqual(z('getContact', { id }).response.body.data[0].Tag.map(x => x.name), ['ABC']);
  assert.equal(z('addTags', { ids: [id], tags: [{ name: 'ABC' }] }).emitted, 0, 'tags already there: nothing fires');
  const b = z('bulkUpdate', { records: [{ id, Email_Opt_Out: true }, { id: '0', Email_Opt_Out: true }] });
  assert.equal(b.response.status, 200); assert.deepEqual(b.response.body.data.map(r => r.status), ['success', 'error']);
  assert.equal(z('searchContacts', { email: 'A@B.example' }).response.status, 200, 'search is case-insensitive');
  assert.equal(z('searchContacts', { email: 'none@b.example' }).response.status, 204);
  assert.equal(z('deleteContact', { id }).response.status, 200); assert.equal(z('deleteContact', { id }).response.status, 404);
  assert.equal(w.queue.at(-1).trigger, 'zoho-deleted');
  assert.equal(w.call('zoho.nope', {}).response.status, 400); assert.equal(w.call('constructor', {}).response.status, 400);
});

test('KlickTipp mock: upsert by email, status follows the list, dates are unix seconds, activation tags fire the trigger', () => {
  const w = new World({ cfg: CONFIG, seed: 1, scenarioId: 'unit' });
  const K = CONFIG.klicktipp, kt = (n, a) => w.call(`klicktipp.${n}`, a);
  assert.equal(kt('subscribe', { email: '', listId: K.lists.soi.id }).response.status, 400);
  assert.equal(kt('subscribe', { email: 'a@b.example', listId: 'nope' }).response.status, 400);
  const s = kt('subscribe', { email: 'a@b.example', listId: K.lists.soi.id, tagId: K.tags.created.id, fields: { fieldBirthday: '1990-05-17', [K.fields.zohoContactId]: '77' } }).response.body;
  assert.equal(s.status, 'Subscribed'); assert.equal(s.fieldBirthday, String(Date.UTC(1990, 4, 17) / 1000)); assert.equal(s[K.fields.zohoContactId], '77'); assert.equal(s.fieldPhone, '', 'unset fields are empty strings');
  assert.equal(w.queue.length, 0, 'an ordinary tag fires nothing');
  const d = kt('subscribe', { email: 'D@b.example', listId: K.lists.doi.id }).response.body; assert.equal(d.status, 'Pending');
  const again = kt('subscribe', { email: 'A@B.example', listId: K.lists.doi.id, fields: { fieldPhone: '5' } }).response.body;
  assert.equal(again.id, s.id, 'upsert by email, case-insensitive'); assert.equal(again.status, 'Subscribed', 'an existing subscriber keeps its status'); assert.equal(again.listId, K.lists.soi.id);
  assert.equal(kt('updateSubscriber', { id: d.id, email: 'a@b.example' }).response.status, 409);
  assert.equal(kt('updateSubscriber', { lookupEmail: 'a@b.example', fields: { fieldPhone: '6' } }).response.body.fieldPhone, '6');
  assert.equal(kt('tag', { email: 'a@b.example', tagIds: [K.tags.activationSend.id] }).response.status, 200);
  assert.equal(w.queue.length, 1); assert.equal(w.queue[0].trigger, 'kt-tagged'); assert.equal(w.queue[0].actor, 'api', 'the actor is recorded for the oracle');
  assert.equal(kt('deleteSubscriber', { id: s.id }).response.status, 200); assert.equal(kt('deleteSubscriber', { id: s.id }).response.status, 404);
  assert.equal(w.queue.length, 1, 'an API delete fires no trigger');
});

test('state store: compare-and-swap', () => {
  const w = new World({ cfg: CONFIG, seed: 1, scenarioId: 'unit' });
  assert.equal(w.call('state.get', { key: 'k' }).response.status, 404);
  assert.equal(w.call('state.put', { key: 'k', value: 1, ifVersion: 0 }).response.body.version, 1);
  assert.equal(w.call('state.put', { key: 'k', value: 2, ifVersion: 0 }).response.status, 409);
  assert.equal(w.call('state.put', { key: 'k', value: 2, ifVersion: 1 }).response.body.version, 2);
  assert.deepEqual(w.call('state.get', { key: 'k' }).response.body, { value: 2, version: 2 });
});

// ------------------------------------------------------------------------------------------------ the env
test('env: snapshot/restore continues identically; replay of a record equals the live episode', () => {
  const task = gen(2, 2, 'T3');
  const ref = makeImproved(CONFIG);
  const run = (env, from) => { // drive the improved handler through env, optionally stopping at action count `from`
    let obs = env.observe(), n = 0;
    const api = {};
    for (const name of API_OPS) { const [s, o] = name.split('.'); (api[s] ??= {})[o] = args => env.step({ call: name, args }).observation.response; }
    while (!obs.done && (from === undefined || n < from)) { ref(JSON.parse(JSON.stringify(obs.event)), api); obs = env.step({ call: 'done' }).observation; n++; }
    return obs;
  };
  const full = createEnv(task); full.reset(); run(full);
  const half = createEnv(task); half.reset(); run(half, 25);
  const snap = half.snapshot();
  const resumed = createEnv(task); resumed.reset(); resumed.restore(snap); run(resumed);
  assert.equal(canonical(resumed._records()), canonical(full._records()), 'restore resumes exactly');
  assert.equal(canonical(resumed.record()), canonical(full.record()));
  const out = driveSync(task, ref);
  assert.equal(canonical(replay(task, out.actions).env._records()), canonical(full._records()), 'replaying the record reproduces the episode');
  assert.deepEqual(full.actions(), []); assert.deepEqual(createEnv(task).actions().slice(0, 2), [...createEnv(task).actions()].sort().slice(0, 2));
});

test('env: bad actions are answered, never thrown; a run is capped; the solver never sees the actor or the expectation', () => {
  const env = createEnv(gen(1)); const first = env.reset();
  assert.deepEqual(Object.keys(first).sort(), ['done', 'event', 'response']);
  assert.deepEqual(Object.keys(first.event).sort(), ['data', 'seq', 'trigger']);
  assert.equal(env.step({ call: 'zoho.nope' }).observation.response.status, 400);
  assert.equal(env.step(null).observation.response.status, 400);
  assert.equal(env.step({ call: 5 }).observation.response.status, 400);
  let last; for (let i = 0; i < 160; i++) last = env.step({ call: 'zoho.getContact', args: { id: '1' } });
  assert.equal(last.observation.response.status, 429, 'more than callsPerRun calls in one run');
  assert.ok(!JSON.stringify(first).includes('actor') && !JSON.stringify(first).includes('origin'));
});

test('a handler that throws still lets the episode finish (drive records the error)', async () => {
  const out = driveSync(gen(1, 1), () => { throw new Error('boom'); });
  assert.ok(out.meta.handlerErrorCount > 0);
  assert.equal(bed.oracle(gen(1, 1), out).pass, false);
  const outA = await drive(gen(1, 1), async () => { throw new Error('boom'); });
  assert.equal(outA.meta.handlerErrorCount, out.meta.handlerErrorCount);
  assert.match(driveSync(gen(1, 1), async () => {}).meta.handlerErrors[0], /promise/, 'a sync driver refuses a handler that returns a promise');
});

test('drive() runs async handlers and records the same episode as driveSync', async () => {
  const t = gen(2, 2, 'T2'), h = makeFaithful(CONFIG);
  const a = await drive(t, async (e, api) => { await Promise.resolve(); return h(e, api); });
  assert.equal(canonical(a.actions), canonical(driveSync(t, h).actions));
  assert.equal(a.meta.handlerErrorCount, 0);
});

test('run-handler.mjs scores a handler module from the command line (exit 0 on pass)', () => {
  const run = (file, ...args) => { try { return { code: 0, out: JSON.parse(execFileSync('node', [fileURLToPath(new URL('./run-handler.mjs', here)), fileURLToPath(new URL(file, here)), ...args], { encoding: 'utf8' })) }; } catch (e) { return { code: e.status, out: JSON.parse(e.stdout) }; } };
  const good = run('./controls/improved-handler.mjs', '--variant', 'T3', '--seed', '2');
  assert.equal(good.code, 0); assert.equal(good.out.pass, true); assert.equal(good.out.task, 'rbench:n8n-12679:T3:dev:d3:s2');
  const orig = run('./controls/faithful-handler.mjs', '--variant', 'T3', '--seed', '2');
  assert.equal(orig.code, 1); assert.deepEqual(orig.out.probesFailed, ['P1', 'P2', 'P3', 'P4']); assert.deepEqual(orig.out.coreFailed, []);
});

test('a pure step policy (what a Foundry code node can express today) can express the whole job', () => {
  // The adapter replays history: a policy that makes one read per event, then stops.
  const seen = [];
  policyHandler(({ history }) => { seen.push(history.length); return history.length < 2 ? { call: 'state.get', args: { key: 'x' } } : { done: true }; })({ trigger: 'x', data: {} }, { state: { get: () => ({ status: 404, body: {} }) } });
  assert.deepEqual(seen, [0, 1, 2]);
  // Any deterministic sync handler becomes a pure {event, history} -> {call}|{done} function; driving it gives the same episode and verdict.
  for (const [variant, h] of [['T2', makeFaithful(CONFIG)], ['T3', makeImproved(CONFIG)]]) {
    const t = gen(3, 2, variant);
    const direct = driveSync(t, h), viaPolicy = driveSync(t, policyHandler(policyFromHandler(h)));
    assert.equal(canonical(viaPolicy.actions), canonical(direct.actions));
    assert.ok(bed.oracle(t, viaPolicy).pass);
  }
  assert.throws(() => policyFromHandler((e, api) => { api.state.get({ key: Math.random().toString() }); })({ event: { trigger: 'x', data: {} }, history: [{ call: 'state.get', args: { key: 'fixed' }, response: { status: 404, body: {} } }] }), /not deterministic/);
});

// ------------------------------------------------------------------------------------------------ oracle health
test('oracle rejects schema-invalid output', () => {
  const t = gen(1);
  const bad = [null, undefined, 5, 'x', [], {}, { actions: 'x' }, { actions: [null] }, { actions: [{}] }, { actions: [{ call: 5 }] }, { actions: [{ call: 'x'.repeat(65) }] },
    { actions: [{ call: 'done', args: [] }] }, { actions: [{ call: 'done', extra: 1 }] }, { actions: [], extra: 1 }, { actions: Array(10001).fill({ call: 'done' }) }, { actions: [{ call: 'done', args: { a: 'y'.repeat(4e6) } }] }];
  for (const o of bad) { const r = bed.oracle(t, o); assert.equal(r.pass, false); assert.equal(r.score, 0); assert.match(r.details.reason, /^schema:/); }
  const circular = { actions: [] }; circular.self = circular;
  assert.equal(bed.oracle(t, circular).pass, false);
  assert.equal(bed.oracle(t, { actions: [], meta: { pass: true, score: 1 } }).pass, false, 'meta is not trusted');
});

test('oracle is deterministic and ignores everything but the actions', () => {
  const t = gen(5, 3, 'T3'), out = bed.referenceSolve(t);
  const a = bed.oracle(t, out), b = bed.oracle(t, { ...out, meta: { whatever: true } });
  assert.equal(canonical(a), canonical(b));
  assert.equal(a.pass, true);
});

test('referenceSolve passes: faithful transcription (T1/T2) and improved (T3) on 20 seeds at d3, and on 3 seeds at every other difficulty', () => {
  for (const variant of ['T1', 'T2', 'T3']) for (const seed of SEEDS) {
    const t = gen(seed, 3, variant), r = bed.oracle(t, bed.referenceSolve(t));
    assert.ok(r.pass && r.score === 1, `${variant} seed ${seed}: ${JSON.stringify(r.details.scenarios?.filter(s => !s.pass))}`);
  }
  for (const d of [1, 2, 4, 5]) for (const seed of [0, 1, 2]) for (const variant of ['T2', 'T3']) {
    const t = gen(seed, d, variant), r = bed.oracle(t, bed.referenceSolve(t));
    assert.ok(r.pass, `${variant} d${d} seed ${seed}: ${JSON.stringify(r.details.scenarios?.filter(s => !s.pass).slice(0, 2))}`);
  }
});

test('every bad control fails on every one of 20 seeds, for the stated reason', () => {
  for (const c of bed.badControls) for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T2'), r = bed.oracle(t, c.make(t));
    assert.equal(r.pass, false, `${c.name} seed ${seed} passed the oracle`);
    for (const code of c.expect) assert.ok(codesOf(r).has(code), `${c.name} seed ${seed}: expected ${code}, got ${[...codesOf(r)].slice(0, 8)}`);
  }
});

test('near misses are close: they fail only the scenarios their one defect touches (the oracle is not just rejecting everything)', () => {
  const t = gen(3, 3, 'T2');
  const score = name => bed.oracle(t, bed.badControls.find(c => c.name === name).make(t)).score;
  for (const n of ['plausible-but-wrong', 'zoho-delete-not-propagated', 'klicktipp-delete-not-propagated', 'segments-not-synced']) assert.ok(score(n) >= 0.6, `${n} scored ${score(n)}`);
  const failed = bed.oracle(t, bed.badControls.find(c => c.name === 'plausible-but-wrong').make(t)).details.coreFailed;
  assert.ok(failed.includes('S08') && failed.every(id => ['S08', 'S15'].includes(id)), `only the scenarios where an unsubscribed person is edited in Zoho: ${failed}`);
});

test('oracle sensitivity: dropping any one mapped field, in either direction or both, is caught', () => {
  const wrap = (api, f) => {
    const out = { state: api.state };
    for (const svc of ['zoho', 'klicktipp']) out[svc] = Object.fromEntries(Object.entries(api[svc]).map(([k, fn]) => [k, a => fn(f(`${svc}.${k}`, structuredClone(a)))]));
    return out;
  };
  const base = makeFaithful(CONFIG);
  for (const [key, zohoName] of Object.entries(ZOHO_OF)) {
    if (key === 'email') continue;                                    // the email is the join key: without it nothing is synced at all
    const ktName = KT_OF[key];
    const drop = (toKt, toZoho) => (e, api) => base(e, wrap(api, (name, a) => {
      if (toKt && ['klicktipp.subscribe', 'klicktipp.updateSubscriber'].includes(name) && a.fields) delete a.fields[ktName];
      if (toZoho && ['zoho.createContact', 'zoho.updateContact'].includes(name) && a.fields) delete a.fields[zohoName];
      return a;
    }));
    for (const [label, h] of [['to KlickTipp', drop(true, false)], ['to Zoho', drop(false, true)], ['both', drop(true, true)]]) for (const seed of [0, 1, 2]) {
      const t = gen(seed, 3, 'T2'), r = bed.oracle(t, driveSync(t, h));
      assert.equal(r.pass, false, `dropping ${key} ${label} (seed ${seed}) was not noticed`);
      if (key !== 'last') assert.ok([...codesOf(r)].some(c => c.startsWith('FIELD_MISMATCH:') && c.endsWith(`.${key}`)), `dropping ${key} ${label}: ${[...codesOf(r)].slice(0, 5)}`);   // Last_Name is mandatory in Zoho, so dropping it breaks creation instead
    }
  }
});

test('the soak scenario exercises every operation in every seed from difficulty 3 up, and the plan scales with difficulty', () => {
  const want = ['zoho.create', 'kt.create', 'zoho.form', 'zoho.edit', 'kt.edit', 'kt.unsubscribe', 'kt.confirm', 'zoho.delete', 'kt.delete'];
  const sizes = [];
  for (const d of [1, 3, 5]) {
    let n = 0;
    for (const seed of SEEDS) {
      const { core } = scenariosFor({ seed, split: 'dev', difficulty: d }), s15 = core.find(s => s.id === 'S15');
      n += s15.steps.length;
      const ops = new Set(s15.steps.flatMap(st => st.actions.map(a => `${a.sys}.${a.op}`)));
      if (d >= 3) for (const o of want) assert.ok(ops.has(o), `d${d} seed ${seed} lacks ${o}`);
      // re-creation under an email deleted earlier
      if (d >= 3) {
        const email = {}, gone = new Set(); let again = false;
        for (const st of s15.steps) for (const a of st.actions) {
          if (a.person) { again ||= gone.has(a.person.email); email[a.ref] = a.person.email; }
          if (a.set?.email) email[a.ref] = a.set.email;
          if (a.op === 'delete') gone.add(email[a.ref]);
        }
        assert.ok(again, `d${d} seed ${seed}: no person comes back under a deleted email`);
      }
    }
    sizes.push(n / SEEDS.length);
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `soak length by difficulty: ${sizes}`);
});

test('a do-nothing solution fails, however it says so', () => {
  for (const t of [gen(1, 3, 'T1'), gen(1, 3, 'T2'), gen(1, 3, 'T3')]) {
    for (const out of [{ actions: [] }, { actions: Array(400).fill({ call: 'done' }) }, { actions: [{ call: 'state.put', args: { key: 'a', value: 1 } }] }]) {
      const r = bed.oracle(t, out);
      assert.equal(r.pass, false); assert.ok(r.score < 0.5);
    }
  }
});

test('an alternative valid design (always read live, write unconditionally) passes core: the oracle does not prescribe a call pattern', () => {
  const K = CONFIG.klicktipp, zf = K.fields.zohoContactId, ok = r => r.status < 300;
  const nz = v => v ?? '';
  const iso = u => (u === '' ? null : new Date(Number(u) * 1000).toISOString().slice(0, 10));
  const toKt = z => ({ [zf]: z.id, fieldFirstName: nz(z.First_Name), fieldLastName: nz(z.Last_Name), fieldPhone: nz(z.Phone), fieldMobilePhone: nz(z.Mobile), fieldPrivatePhone: nz(z.Home_Phone), fieldFax: nz(z.Fax), fieldBirthday: nz(z.Date_of_Birth), fieldCountry: nz(z.Mailing_Country), fieldState: nz(z.Mailing_State), fieldCity: nz(z.Mailing_City), fieldStreet1: nz(z.Mailing_Street), fieldZip: nz(z.Mailing_Zip) });
  const toZoho = s => ({ Email: s.email, First_Name: s.fieldFirstName, Last_Name: s.fieldLastName, Phone: s.fieldPhone, Mobile: s.fieldMobilePhone, Home_Phone: s.fieldPrivatePhone, Fax: s.fieldFax, Date_of_Birth: iso(s.fieldBirthday), Mailing_Country: s.fieldCountry, Mailing_State: s.fieldState, Mailing_City: s.fieldCity, Mailing_Street: s.fieldStreet1, Mailing_Zip: s.fieldZip });
  const alt = (e, api) => {
    if (e.trigger.startsWith('zoho')) {
      const b = e.data.body; if (b.modifiedBy === CONFIG.apiUserName) return;
      if (e.trigger === 'zoho-deleted') { if (b.klicktippId) api.klicktipp.deleteSubscriber({ id: b.klicktippId }); return; }
      const g = api.zoho.getContact({ id: b.id }); if (!ok(g)) return; const z = g.body.data[0]; if (!z.Email) return;
      const form = e.trigger === 'zoho-form';
      const r = z.KlickTipp_ID ? api.klicktipp.updateSubscriber({ id: z.KlickTipp_ID, email: z.Email, fields: toKt(z) })
        : api.klicktipp.subscribe({ email: z.Email, listId: form ? K.lists.doi.id : K.lists.soi.id, tagId: form ? K.tags.createdViaForm.id : K.tags.created.id, fields: toKt(z) });
      if (!ok(r)) return;
      api.zoho.updateContact({ id: z.id, fields: { KlickTipp_ID: r.body.id, Email_Opt_Out: r.body.status !== 'Subscribed' } });          // unconditional
      if (!form) for (const sg of CONFIG.segments) if (z.Tag.some(t => t.name.toLowerCase() === sg.zohoTag.toLowerCase())) api.klicktipp.tag({ email: z.Email, tagIds: [K.tags[sg.klicktippTag].id] });
      return;
    }
    if (e.trigger === 'kt-deleted') { if (e.data[zf]) api.zoho.deleteContact({ id: e.data[zf] }); return; }
    const g = api.klicktipp.getSubscriber({ id: e.data.id }); if (!ok(g)) return; const s = g.body; if (!s.fieldLastName) return;
    const fields = { ...toZoho(s), KlickTipp_ID: s.id, Email_Opt_Out: s.status !== 'Subscribed' };
    let zid = s[zf];
    if (zid) { if (!ok(api.zoho.updateContact({ id: zid, fields }))) zid = null; }
    if (!zid) { const c = api.zoho.createContact({ fields }); if (!ok(c)) return; zid = c.body.data[0].details.id; api.klicktipp.updateSubscriber({ id: s.id, fields: { [zf]: zid } }); }
    const tags = CONFIG.segments.filter(sg => s.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
    if (tags.length) api.zoho.addTags({ ids: [zid], tags });
  };
  for (const seed of SEEDS) { const t = gen(seed, 3, 'T2'); const r = bed.oracle(t, driveSync(t, alt)); assert.ok(r.pass, `seed ${seed}: ${JSON.stringify(r.details.scenarios.filter(s => !s.pass).slice(0, 2))}`); }
});

test('a chatty but correct solution (every idempotent write sent twice) is not mistaken for an echo loop', () => {
  const base = makeFaithful(CONFIG), twice = new Set(['updateContact', 'bulkUpdate', 'addTags', 'updateSubscriber', 'tag']);
  const chatty = (e, api) => base(e, Object.fromEntries(['zoho', 'klicktipp', 'state'].map(svc => [svc, Object.fromEntries(Object.entries(api[svc]).map(([k, fn]) => [k, a => { const r = fn(a); if (twice.has(k)) fn(a); return r; }]))])));
  for (const seed of [0, 1, 2]) { const t = gen(seed, 3, 'T2'), r = bed.oracle(t, driveSync(t, chatty)); assert.ok(r.pass, `seed ${seed}: ${JSON.stringify(r.details.scenarios.filter(s => !s.pass).slice(0, 2))}`); assert.ok(r.details.cost.externalCalls > 250); }
});

test('hidden truth does not leak: nothing the oracle expects for a graded seed appears in any task text', () => {
  for (const variant of bed.VARIANTS) for (const seed of SEEDS) {
    const t = gen(seed, 3, variant), text = `${t.prompt}\n${canonical(t.inputs)}\n${canonical(t.files)}`;
    const { env } = replay(gen(seed, 3, 'T3'), []);
    const secrets = new Set();
    for (const sc of env._scenarios()) for (const st of sc.steps) for (const p of Object.values(st.expect.people)) for (const side of [p.z, p.k]) if (side) for (const k of ['email', 'phone', 'mobile', 'zip']) if (side.f[k] && String(side.f[k]).length > 5) secrets.add(String(side.f[k]));
    assert.ok(secrets.size > 30);
    for (const s of secrets) assert.ok(!text.includes(s), `${variant} seed ${seed}: task text contains ${s}`);
  }
});

test('runtime limits at difficulty 5: generate and oracle each under 2 s', () => {
  for (const variant of bed.VARIANTS) {
    let t0 = Date.now(); const t = gen(4, 5, variant); const g = Date.now() - t0;
    const out = bed.referenceSolve(t); t0 = Date.now(); bed.oracle(t, out); const o = Date.now() - t0;
    assert.ok(g < 2000 && o < 2000, `${variant}: generate ${g} ms, oracle ${o} ms`);
  }
  const t = gen(4, 5, 'T2'); const t0 = Date.now(); bed.oracle(t, bed.badControls.find(c => c.name === 'no-ui-user-guard').make(t));
  assert.ok(Date.now() - t0 < 2000, 'the echo-loop control is bounded by the run cap');
});

// ------------------------------------------------------------------------------------------------ adversarial verification (v0.2.0)
// Each wrong solution below passed the v0.1.0 oracle on 20/20 seeds (12/20 for the edit-only KlickTipp segment case); each correct
// alternative below must keep passing. Raw numbers before/after: README "Adversarial verification".
const wrapApi = (api, f) => {
  const out = { state: api.state };
  for (const svc of ['zoho', 'klicktipp']) out[svc] = Object.fromEntries(Object.entries(api[svc]).map(([k, fn]) => [k, a => f(`${svc}.${k}`, structuredClone(a ?? {}), fn, api)]));
  return out;
};
const via = f => { const base = makeFaithful(CONFIG); return (e, api) => base(e, wrapApi(api, (n, a, fn, raw) => f(n, a, fn, raw, e))); };
const ADV_SEEDS = [0, 1, 2, 3, 4];

test('adversarial: wrong solutions that passed v0.1.0 are rejected, for the named reason', () => {
  const K = CONFIG.klicktipp;
  const wrong = {
    'every new subscriber also gets the created-via-form tag': [via((n, a, fn) => { if (n === 'klicktipp.subscribe') a.tagId = [K.tags.created.id, K.tags.createdViaForm.id]; return fn(a); }), 'TAG_UNEXPECTED:createdViaForm'],
    'a bookkeeping tag on every Zoho contact it touches': [via((n, a, fn, raw) => { const r = fn(a); if (n === 'zoho.bulkUpdate' && r.status === 200) for (const x of r.body.data) if (x.status === 'success') raw.zoho.addTags({ ids: [x.details.id], tags: [{ name: 'Synced by bot' }] }); return r; }), 'TAG_UNEXPECTED:zoho'],
    'Zoho segment tags matched case-sensitively': [via((n, a, fn) => { const r = fn(a); if (n === 'zoho.getContact' && r.status === 200) for (const rec of r.body.data) rec.Tag = rec.Tag.filter(t => CONFIG.segments.some(s => s.zohoTag === t.name)); return r; }), 'SEGMENT_MISMATCH:klicktipp'],
    'KlickTipp segment tags carried to Zoho on create only': [via((n, a, fn, raw, e) => (n === 'zoho.addTags' && e.trigger === 'kt-tagged' && e.data[K.fields.zohoContactId] ? { status: 200, body: { data: [] } } : fn(a))), 'SEGMENT_MISMATCH:zoho'],
    'empty values never written (a cleared field is not propagated)': [via((n, a, fn) => { if (a.fields) for (const k of Object.keys(a.fields)) if (a.fields[k] === '' || a.fields[k] === null) delete a.fields[k]; return fn(a); }), 'FIELD_MISMATCH:'],
  };
  for (const [key, zohoName] of Object.entries(ZOHO_OF)) {
    if (key === 'email') continue;
    wrong[`KlickTipp->Zoho update path forgets ${key}`] = [via((n, a, fn) => { if (n === 'zoho.updateContact' && a.fields) delete a.fields[zohoName]; return fn(a); }), `FIELD_MISMATCH:zoho.${key}`];
    if (key !== 'last') wrong[`Zoho->KlickTipp update path forgets ${key}`] = [via((n, a, fn) => { if (n === 'klicktipp.updateSubscriber' && a.fields && Object.keys(a.fields).length > 1) delete a.fields[KT_OF[key]]; return fn(a); }), `FIELD_MISMATCH:klicktipp.${key}`];
  }
  for (const [name, [h, code]] of Object.entries(wrong)) for (const seed of ADV_SEEDS) {
    const t = gen(seed, 3, 'T2'), r = bed.oracle(t, driveSync(t, h));
    assert.equal(r.pass, false, `${name} (seed ${seed}) passed`);
    assert.ok([...codesOf(r)].some(c => c.startsWith(code)), `${name} (seed ${seed}): expected ${code}, got ${[...codesOf(r)].slice(0, 6)}`);
  }
});

test('adversarial: correct alternatives the oracle must not reject (incidental conventions)', () => {
  const K = CONFIG.klicktipp, zf = K.fields.zohoContactId, ok = r => r.status < 300, nz = v => (v == null ? '' : String(v));
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const berlinMidnight = iso => { const [y, m, d] = iso.split('-').map(Number); for (const off of [1, 2]) { const t = Date.UTC(y, m - 1, d, -off); if (berlin.format(new Date(t)).endsWith('00')) return String(t / 1000); } throw new Error('no Berlin midnight'); };
  const berlinIso = u => (u === '' ? null : berlin.format(new Date(Number(u) * 1000)).slice(0, 10));
  // Live reads, compare-before-write, KlickTipp dates written as unix seconds of Berlin midnight, segments unioned both ways, Zoho deletions
  // resolved by email lookup instead of the stored link.
  const alt = (e, api) => {
    if (e.trigger.startsWith('zoho')) {
      const b = e.data.body; if (b.modifiedBy === CONFIG.apiUserName) return;
      if (e.trigger === 'zoho-deleted') { if (b.email) { const g = api.klicktipp.getSubscriber({ email: b.email }); if (ok(g)) api.klicktipp.deleteSubscriber({ id: g.body.id }); } return; }
      const g = api.zoho.getContact({ id: b.id }); if (!ok(g)) return; const z = g.body.data[0]; if (!z.Email) return;
      const form = e.trigger === 'zoho-form';
      const fields = { [zf]: z.id, fieldFirstName: nz(z.First_Name), fieldLastName: nz(z.Last_Name), fieldPhone: nz(z.Phone), fieldMobilePhone: nz(z.Mobile), fieldPrivatePhone: nz(z.Home_Phone), fieldFax: nz(z.Fax),
        fieldBirthday: z.Date_of_Birth ? berlinMidnight(z.Date_of_Birth) : '', fieldCountry: nz(z.Mailing_Country), fieldState: nz(z.Mailing_State), fieldCity: nz(z.Mailing_City), fieldStreet1: nz(z.Mailing_Street), fieldZip: nz(z.Mailing_Zip) };
      let r = z.KlickTipp_ID ? api.klicktipp.updateSubscriber({ id: z.KlickTipp_ID, email: z.Email, fields }) : null;
      if (!r || !ok(r)) r = api.klicktipp.subscribe({ email: z.Email, listId: form ? K.lists.doi.id : K.lists.soi.id, tagId: form ? K.tags.createdViaForm.id : K.tags.created.id, fields });
      if (!ok(r)) return;
      const optOut = r.body.status !== 'Subscribed';
      if (z.KlickTipp_ID !== r.body.id || z.Email_Opt_Out !== optOut) api.zoho.updateContact({ id: z.id, fields: { KlickTipp_ID: r.body.id, Email_Opt_Out: optOut } });
      const has = name => z.Tag.some(t => t.name.toLowerCase() === name.toLowerCase());
      const toKt = CONFIG.segments.filter(sg => has(sg.zohoTag) && !r.body.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => K.tags[sg.klicktippTag].id);
      if (toKt.length) api.klicktipp.tag({ email: z.Email, tagIds: toKt });
      const toZoho = CONFIG.segments.filter(sg => !has(sg.zohoTag) && r.body.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
      if (toZoho.length) api.zoho.addTags({ ids: [z.id], tags: toZoho });
      return;
    }
    if (e.trigger === 'kt-deleted') { if (e.data[zf]) api.zoho.deleteContact({ id: e.data[zf] }); return; }
    const g = api.klicktipp.getSubscriber({ id: e.data.id }); if (!ok(g)) return; const s = g.body; if (!s.fieldLastName) return;
    const fields = { Email: s.email, First_Name: s.fieldFirstName, Last_Name: s.fieldLastName, Phone: s.fieldPhone, Mobile: s.fieldMobilePhone, Home_Phone: s.fieldPrivatePhone, Fax: s.fieldFax, Date_of_Birth: berlinIso(s.fieldBirthday),
      Mailing_Country: s.fieldCountry, Mailing_State: s.fieldState, Mailing_City: s.fieldCity, Mailing_Street: s.fieldStreet1, Mailing_Zip: s.fieldZip, KlickTipp_ID: s.id, Email_Opt_Out: s.status !== 'Subscribed' };
    let zid = s[zf];
    if (zid && !ok(api.zoho.updateContact({ id: zid, fields }))) zid = null;
    if (!zid) { const c = api.zoho.createContact({ fields }); if (!ok(c)) return; zid = c.body.data[0].details.id; api.klicktipp.updateSubscriber({ id: s.id, fields: { [zf]: zid } }); }
    const tags = CONFIG.segments.filter(sg => s.tags.includes(K.tags[sg.klicktippTag].id)).map(sg => ({ name: sg.zohoTag }));
    if (tags.length) api.zoho.addTags({ ids: [zid], tags });
  };
  for (const seed of ADV_SEEDS) for (const d of [3, 5]) { const t = gen(seed, d, 'T2'), r = bed.oracle(t, driveSync(t, alt)); assert.ok(r.pass, `d${d} seed ${seed}: ${JSON.stringify(r.details.scenarios.filter(s => !s.pass).slice(0, 2))}`); }
});

test('adversarial: hostile values get an answer, never an exception (mocks and oracle)', () => {
  const t = gen(0, 3, 'T2'), K = CONFIG.klicktipp;
  const env = createEnv(t); env.reset();
  assert.equal(env.step({ call: 'klicktipp.subscribe', args: { email: 'x.y@mail.example', listId: 'toString' } }).observation.response.status, 400, 'a prototype key is not a list');
  assert.equal(env.step({ call: 'klicktipp.subscribe', args: { email: 'x.y@mail.example', listId: K.lists.soi.id, fields: { fieldBirthday: '99999999999999999999' } } }).observation.response.status, 400, 'an out-of-range date is refused');
  // A solution whose subscribe sends an out-of-range birthday used to make oracle() throw RangeError; now it is judged.
  const base = makeFaithful(CONFIG);
  const out = driveSync(t, (e, api) => base(e, { ...api, klicktipp: { ...api.klicktipp, subscribe: a => api.klicktipp.subscribe({ ...a, fields: { ...a.fields, fieldBirthday: '99999999999999999999' } }) } }));
  const r = bed.oracle(t, out); assert.equal(r.pass, false);
});

test('a T3 solver sees its cost target through the generic renderers; T1/T3 definition files come from solverFiles()', () => {
  const t3 = gen(1, 3, 'T3'), t1 = gen(1, 3, 'T1'), t2 = gen(1, 3, 'T2');
  assert.equal(t3.inputs.costTarget.externalCalls, t3.budget.externalCalls);
  assert.ok(inlineRender(t3).includes(`"externalCalls": ${t3.budget.externalCalls}`), 'the number is in what an arm renders');
  assert.match(t3.prompt, /inputs\.costTarget\.externalCalls/);
  assert.equal(t1.inputs.costTarget, undefined); assert.equal(t2.inputs.costTarget, undefined);
  assert.ok(!('files/original/workflow.json' in solverView(t1).files), 'documented limit: the generic solverView does not carry attachments');
  assert.deepEqual(bed.solverFiles(t2), {});
});

test('original: solverFiles() returns the definition for T1/T3 (in memory; never persisted)', { skip: skipOriginal }, () => {
  const f = bed.solverFiles(gen(1, 3, 'T3'));
  assert.deepEqual(Object.keys(f), ['original/workflow.json']);
  assert.ok(JSON.parse(f['original/workflow.json']).nodes.length >= 38);
});

// ------------------------------------------------------------------------------------------------ T3
test('T3: the transcription of the original passes core and the cost cap but fails all four probes; the improved reference passes everything cheaper', () => {
  for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T3');
    const r = bed.oracle(t, driveSync(t, makeFaithful(CONFIG)));
    assert.equal(r.details.coreFailed.length, 0);
    assert.deepEqual(r.details.probesFailed, ['P1', 'P2', 'P3', 'P4'], `seed ${seed}`);
    assert.equal(r.details.cost.withinTarget, true); assert.equal(r.details.cost.externalCalls, t.budget.externalCalls, 'the cap is exactly what the original pattern uses');
    assert.equal(r.pass, false);
    const i = bed.oracle(t, bed.referenceSolve(t));
    assert.ok(i.pass && i.details.cost.ratioToReference < 0.9, `seed ${seed}: ratio ${i.details.cost.ratioToReference}`);
  }
});

test('T3: reliability alone is not enough, and cost alone is not enough', () => {
  const t = gen(2, 3, 'T3'), improved = makeImproved(CONFIG);
  // Same behaviour as the improved handler plus two wasted reads per event: probes pass, core passes, the cap fails.
  const padded = (e, api) => { api.zoho.searchContacts({ email: 'pad@mail.example' }); api.klicktipp.getSubscriber({ email: 'pad@mail.example' }); api.zoho.searchContacts({ email: 'pad@mail.example' }); return improved(e, api); };
  const r = bed.oracle(t, driveSync(t, padded));
  assert.equal(r.details.coreFailed.length + r.details.probesFailed.length, 0);
  assert.equal(r.details.cost.withinTarget, false); assert.equal(r.pass, false);
  // A lean solution that skips the probes' protections is cheap but fails them.
  const lean = bed.oracle(t, driveSync(t, (e, api) => { if (e.trigger === 'zoho-deleted' && e.data.body.klicktippId) api.klicktipp.deleteSubscriber({ id: e.data.body.klicktippId }); }));
  assert.equal(lean.pass, false);
  assert.ok(lean.details.cost.externalCalls < t.budget.externalCalls);
});

// ------------------------------------------------------------------------------------------------ fixtures
test('committed fixtures match a fresh build and cover every API call', () => {
  for (const [rel, data] of Object.entries(buildAll())) assert.equal(readFileSync(new URL(rel, here), 'utf8'), JSON.stringify(data, null, 1) + '\n', `${rel} is stale: run node build-fixtures.mjs`);
  const rec = JSON.parse(readFileSync(new URL('fixtures/recorded-calls.json', here), 'utf8'));
  const names = new Set(rec.calls.map(c => c.call));
  for (const op of API_OPS) assert.ok(names.has(op), op);
  for (const op of Object.values(NODE_KIND_TO_CALL)) assert.ok(names.has(op), `catalogue lacks ${op}`);
  for (const c of rec.calls) assert.ok(typeof c.response.status === 'number');
  assert.ok(rec.calls.some(c => c.response.status >= 400) && rec.calls.some(c => c.response.status === 204));
  assert.ok(JSON.parse(readFileSync(new URL('fixtures/config.json', here), 'utf8')).apiUserName);
});

test('no vendor data or credentials in the fixtures or the item; only the pin of the original', () => {
  const dirScan = ['fixtures/config.json', 'fixtures/pools.json', 'fixtures/examples.json', 'fixtures/recorded-calls.json', 'item.json'];
  for (const f of dirScan) {
    const text = readFileSync(new URL(f, here), 'utf8');
    assert.ok(!/api[_-]?key|secret|password|bearer |token/i.test(text.replace(/"note"[^\n]*/g, '')), `${f}: credential-like text`);
    assert.ok(!/@(?!mail\.example|sample\.example)[a-z0-9-]+\.[a-z]{2,}/i.test(text.replace(/"@/g, '')) || f === 'item.json', `${f}: non-synthetic email domain`);
  }
});

test('experiments/lib can render these tasks for a solver', () => {
  const t = gen(1, 3, 'T2');
  const v = solverView(t); assert.ok(v.prompt.includes('TASK T2') && v.files['inputs.json'] && v.files['files/handler.mjs']);
  assert.ok(inlineRender(t).includes('## inputs.json'));
});

test('experiments/lib/beds.mjs loadFamily can load a replicate item', { todo: 'loadFamily resolves beds/<id> or sealed-N only; experiments/lib is frozen for this task (see README, obstacle O1)' }, async () => {
  const { loadFamily } = await import('../../../lib/beds.mjs');
  await loadFamily('rbench-n8n-12679');
});

// ------------------------------------------------------------------------------------------------ the ORIGINAL definition
test('original: corpus file matches the pinned sha256, binds to the mock account, and every expression is on the reviewed allowlist', { skip: skipOriginal }, () => {
  assert.throws(() => loadOriginal({ sha256: '0'.repeat(64) }), /sha256/);
  const wf = rebind(loadOriginal(), CONFIG);
  assert.equal(wf.__binding.count, 8); assert.ok(wf.__binding.usage.every(n => n > 0));
  const ex = expressionsOf(wf);
  assert.ok(ex.length >= 100);
  assert.deepEqual(ex.filter(e => !classifyExpression(e.expr)), [], 'unreviewed expressions');
  const text = JSON.stringify(wf.nodes.map(n => n.parameters));
  for (const authorValue of [loadOriginal().nodes.find(n => n.name === 'Create Contact with SOI').parameters.listId, loadOriginal().nodes.find(n => n.name === 'Create Contact with SOI').parameters.fields.dataFields[0].fieldId]) assert.ok(!text.includes(authorValue), 'the author\'s account ids are gone after rebinding');
});

test('original: an expression that is not on the allowlist is refused, never evaluated', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  const evil = structuredClone(wf); evil.nodes.find(n => n.name === 'Check for email address').parameters.conditions.conditions[0].leftValue = "={{ process.mainModule.require('fs').readFileSync('/etc/passwd') }}";
  const h = makeOriginalHandler(evil, CONFIG);
  const out = driveSync(gen(1, 1), h);
  assert.ok(out.meta.handlerErrors.some(m => /reviewed allowlist/.test(m)), 'the doctored node threw UnreviewedExpression instead of evaluating');
  assert.equal(out.actions.filter(a => a.call === 'klicktipp.subscribe' && a.args.listId === CONFIG.klicktipp.lists.soi.id).length, 0, 'the subscribe that sits behind the doctored node was never reached');
  assert.ok(out.actions.some(a => a.call === 'klicktipp.subscribe' && a.args.listId === CONFIG.klicktipp.lists.doi.id), 'while the untouched web-form path still ran');
  assert.throws(() => evalExpression('$json.a.b.constructor.constructor("return 1")()', { json: {}, node: () => ({}) }), UnreviewedExpression);
});

test('original: executed against the mocks it passes the oracle on all 20 seeds (15/15 core), as the control requires', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T2'), h = makeOriginalHandler(wf, CONFIG), r = bed.oracle(t, driveSync(t, h));
    assert.ok(r.pass, `seed ${seed}: ${JSON.stringify(r.details.scenarios.filter(s => !s.pass).slice(0, 3))}`);
    assert.ok(h.runs.length > 50);
  }
  for (const d of [1, 2, 4, 5]) { const t = gen(0, d, 'T2'); assert.ok(bed.oracle(t, driveSync(t, makeOriginalHandler(wf, CONFIG))).pass, `d${d}`); }
});

test('original: its call trace is identical to the committed transcription (so the benchmark runs without the corpus)', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  for (const d of [1, 3, 5]) for (const seed of [0, 1, 2, 3]) {
    const t = gen(seed, d, 'T3');
    assert.equal(canonical(driveSync(t, makeOriginalHandler(wf, CONFIG)).actions), canonical(driveSync(t, makeFaithful(CONFIG)).actions), `d${d} seed ${seed}`);
  }
});

test('original: documented defects. It fails the four T3 probes on every seed (P1 swapped values, P2/P4 duplicate Zoho contacts, P3 invented 1970-01-01 birthday)', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T3'), r = bed.oracle(t, driveSync(t, makeOriginalHandler(wf, CONFIG)));
    assert.deepEqual(r.details.probesFailed, ['P1', 'P2', 'P3', 'P4'], `seed ${seed}`);
    const by = Object.fromEntries(r.details.scenarios.map(s => [s.id, s.codes]));
    assert.ok(by.P1.some(c => c.startsWith('CONVERGENCE')));
    assert.ok(by.P2.includes('DUP_ZOHO') && by.P2.includes('DUP_CREATE'));
    assert.ok(by.P3.includes('FIELD_MISMATCH:zoho.dob'));
    assert.ok(by.P4.includes('DUP_ZOHO'));
    assert.equal(r.details.cost.failedCalls >= 3, true, 'wasted failing calls: delete echoes, empty email, missing last name');
  }
});

test('original: under the strict reading (the Zoho node returns only the raw Zoho record) its Zoho->KlickTipp segment tagging never happens', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  for (const seed of [0, 1, 2]) {
    const t = gen(seed, 3, 'T2'), r = bed.oracle(t, driveSync(t, makeOriginalHandler(wf, CONFIG, { zohoGetShape: 'raw' })));
    assert.deepEqual(r.details.coreFailed, ['S13', 'S15']);
    assert.ok(codesOf(r).has('SEGMENT_MISMATCH:klicktipp'));
  }
});

test('original: broken variants of the definition itself fail for the reason named', { skip: skipOriginal }, () => {
  const wf = rebind(loadOriginal(), CONFIG);
  const want = { 'no-ui-user-guard': 'ECHO_LOOP', 'single-and-double-opt-in-swapped': 'LIST_WRONG', 'zoho-delete-not-propagated': 'EXTRA_KT', 'klicktipp-delete-not-propagated': 'EXTRA_ZOHO', 'zoho-id-not-saved-in-klicktipp': 'LINK_BROKEN' };
  assert.deepEqual(Object.keys(MUTANTS).sort(), Object.keys(want).sort());
  for (const [name, code] of Object.entries(want)) for (const seed of SEEDS) {
    const t = gen(seed, 3, 'T2'), r = bed.oracle(t, driveSync(t, makeOriginalHandler(MUTANTS[name].apply(structuredClone(wf)), CONFIG)));
    assert.equal(r.pass, false, `${name} seed ${seed}`); assert.ok(codesOf(r).has(code), `${name} seed ${seed}: ${[...codesOf(r)].slice(0, 6)}`);
  }
});

test('original: materialize() writes the definition for T1/T3 into a workspace outside the repository', { skip: skipOriginal }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rbench-'));
  try {
    const files = bed.materialize(gen(1, 3, 'T1'), dir);
    assert.equal(files.length, 1); assert.ok(existsSync(files[0]));
    const wf = JSON.parse(readFileSync(files[0], 'utf8')); assert.ok(wf.nodes.length >= 38 && wf.connections);
    assert.deepEqual(bed.materialize(gen(1, 3, 'T2'), dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
