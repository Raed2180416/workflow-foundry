// Shared test helpers (no model calls, no network).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { learnProfile } from '../../jit/profile.mjs';

export const tmp = (t, prefix = 'lib-') => { const d = mkdtempSync(path.join(tmpdir(), prefix)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
// A controllable clock.
export function clock(start = '2026-10-09T12:00:00.000Z') { let ms = Date.parse(start); const now = () => new Date(ms); now.advanceDays = d => { ms += d * 86400000; }; return now; }

export const OUT = { type: 'object', required: ['total'], properties: { total: { type: 'integer' } }, additionalProperties: false };
export const IN = { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } } } } };
export const sampleTasks = n => Array.from({ length: n }, (_, i) => ({ prompt: 'Sum the rows.', inputs: { rows: [{ amount: 10 + i }, { amount: 5 }] } }));

// An own-trace L2 stub component (stub mode, as call-host tests use).
export function registerSum(lib, extra = {}) {
  return lib.register({ layer: 'L2', name: 'sum-rows', contract: { input: IN, output: OUT, taskTemplate: 'Sum the rows.' },
    stub: async input => ({ output: { total: input.rows.reduce((s, r) => s + r.amount, 0) } }), profile: learnProfile(sampleTasks(6)),
    tags: ['fan', 'finance', 'effect:none', 'P12'], patterns: ['P12'], provenance: { source: 'own-trace', ref: 'test', licence: 'internal', redistributable: false, author: 'test' }, ...extra });
}
// Evidence that passes verify-before-store and the keep thresholds.
export function makeKept(lib, hash) {
  lib.addEvidence(hash, { kind: 'admission', checks: { fixturesPass: true, probesPass: true, resetEnv: true, verifiedBy: 'independent-oracle', manifestWithinProbes: true, profileFromAccepted: true } });
  lib.transition(hash, 'shadow');
  for (let i = 0; i < 10; i++) lib.addEvidence(hash, { kind: 'run', ok: true, oracle: 'pass', costUsd: 0.01, ms: 100 + i, shape: 'A' });
  for (let i = 0; i < 4; i++) lib.addEvidence(hash, { kind: 'shadow', agree: true });
  return lib.transition(hash, 'kept');
}
