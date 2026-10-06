import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { startServices, Ledger } from './services.mjs';
import { makeTasks, loadFamily } from './beds.mjs';

const { policy } = loadPolicy();
const port = () => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { text: 'hi' }, costUsd: 0.5 })), 'llama-server': new ScriptedProvider(() => ({ value: { text: 'local' } })) } });

const call = async (svc, path, body, token = svc.token) => {
  const res = await fetch(svc.url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('model gateway enforces token, policy, and the session budget', async t => {
  const ledger = new Ledger({ capUsd: 0.9 });
  const svc = await startServices({ modelPort: port(), ledger });
  t.after(() => svc.close());
  assert.equal((await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'x' }, 'wrong')).status, 401);
  const bad = await call(svc, '/model', { model: 'gpt-unlisted', prompt: 'x' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'MODEL_NOT_IN_POLICY');
  const ok = await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'x' });
  assert.equal(ok.body.ok, true); assert.deepEqual(ok.body.value, { text: 'hi' });
  await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'y' });
  const over = await call(svc, '/model', { model: 'claude-haiku-4-5-20251001', prompt: 'z' });
  assert.equal(over.status, 402); assert.equal(ledger.calls, 2); assert.equal(ledger.spentUsd, 1.0);
});

test('score service returns only pass/score for probe tasks and enforces its call limit', async t => {
  const fams = ['records'];
  let fam; try { fam = await loadFamily(fams[0]); } catch { return t.skip('records bed not built yet'); }
  const probes = (await makeTasks('records', { split: 'dev', seeds: [1, 2], difficulty: 1 })).map(x => x.task);
  const svc = await startServices({ modelPort: port(), ledger: new Ledger({ capUsd: 1 }), familyId: 'records', probes, scoreLimit: 2 });
  t.after(() => svc.close());
  const good = await call(svc, '/score', { probe: 0, output: fam.referenceSolve(probes[0]) });
  assert.deepEqual(Object.keys(good.body).sort(), ['pass', 'score', 'scoreCallsLeft']);
  assert.equal(good.body.pass, true);
  const bad = await call(svc, '/score', { probe: 1, output: {} });
  assert.equal(bad.body.pass, false);
  assert.equal((await call(svc, '/score', { probe: 0, output: {} })).status, 429);
});
