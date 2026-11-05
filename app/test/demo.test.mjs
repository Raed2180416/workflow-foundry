// The front-door demo runs headless, at $0, in one command (node app/demo/front-door.mjs; npm run demo), and shows what it says it shows.
// node --test app/test/demo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('npm run demo: four free-form workflows practised, one turned on by the person and run with its audit, two refused by name; nothing left behind', () => {
  assert.equal(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.demo, 'node app/demo/front-door.mjs');
  // A minimal environment: no model key, no provider variable, nothing to call out with.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'app', 'demo', 'front-door.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 240000, env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', HOME: process.env.HOME ?? '/tmp' } });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find(l => l.startsWith('DEMO_SUMMARY '));
  const s = JSON.parse(line.slice('DEMO_SUMMARY '.length));
  assert.equal(s.built.length, 4); assert.ok(s.built.every(b => b.status === 'proposed' && b.passed === true && /^[a-f0-9]{64}$/.test(b.digest)), JSON.stringify(s.built));
  assert.deepEqual(s.built.map(b => b.flowId), ['bank-ledger-reconciliation', 'supplier-certificates', 'purchase-approval-chain', 'sev1-escalation']);
  assert.equal(s.live.status, 'succeeded'); assert.equal(s.live.chainVerified, true); assert.ok(s.live.checks.every(Boolean));
  assert.deepEqual(s.live.outbox, ['finance@acme.example']); assert.equal(s.live.approvals, 1, 'the send waited for the person');
  assert.equal(s.dialogs, 2, 'the person decided twice, in the client dialog: turning it on, and the one send');
  assert.deepEqual(s.refused, [{ status: 'refused', codes: ['MISSING_CAPABILITY'] }, { status: 'refused', codes: ['UNGROUNDED_TARGET'] }]);
  assert.deepEqual([s.flows, s.drafts], [1, 3], 'the refusals created nothing');
  assert.equal(existsSync(s.workspace), false, 'the temporary workspace is removed');
  for (const words of ['construction guide', 'Practice passed in all 2 cases', 'stand-in answer', 'hash chain verified', 'Turned on: version hash', 'Two honest refusals', '$0, no model'])
    assert.ok(r.stdout.includes(words), words);
  // (core.template is a capability's name: it fills {{name}} markers into text.)
  assert.doesNotMatch(r.stdout.replace(/core\.template/g, ''), /\b(templates?|cards?)\b/i, 'the demo speaks of examples and workflows, not templates or cards');
});
