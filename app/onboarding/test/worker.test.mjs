// The Mercury worker's plumbing (Preview), with a scripted child: the key travels only in the child's environment and never comes
// back. No model is called. nice -n 15 node --test app/onboarding/test/worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerBuilder } from '../builder-worker.mjs';
import { Keychain } from '../keychain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CANARY = 'CANARY-worker-0000-1111-2222';

test('the key goes to the child process only, the result never carries it, and a token cap is required', async () => {
  const keychain = new Keychain({ backend: 'ephemeral' });
  keychain.set('inception', CANARY);
  const w = new WorkerBuilder({ keychain, tokenCap: 200000, workspace: '/tmp/none', command: [process.execPath, path.join(here, 'fake-worker.mjs')], env: { PATH: process.env.PATH, SECRET_OTHER: 'x' } });
  const r = await w.build({ request: 'remind my late customers' });
  assert.equal(r.status, 'needs_answers');
  assert.equal(r.keySha, createHash('sha256').update(CANARY).digest('hex'), 'the child had the key');
  assert.equal(r.envNames.includes('SECRET_OTHER'), false, 'nothing else from the parent environment');
  assert.equal(JSON.stringify(r).includes(CANARY), false, 'the result does not carry the key');
  assert.throws(() => new WorkerBuilder({ keychain, workspace: '/tmp/none' }), { code: 'BUILDER_TOKEN_CAP' });
  const none = new WorkerBuilder({ keychain: new Keychain({ backend: 'none' }), tokenCap: 1000, workspace: '/tmp/none', env: { PATH: process.env.PATH } });
  await assert.rejects(none.build({ request: 'x' }), { code: 'KEY_MISSING' });
});
