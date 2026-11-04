// DUR-1 $0 worst-case stages end to end at toy budgets (BUILD-PLAN rows 14-15; prereg §8.2-8.3): a WC-1 t0 pass with
// confirmation and transfer, the frozen ADV-SET cross-run on every t0 code arm, and the A-H red-team windows with a stub
// agent on the metered ledger. Everything is written under a scratch DUR1_RUNS, never the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runs = mkdtempSync(path.join(tmpdir(), 'dur1-runs-'));
process.env.DUR1_RUNS = runs;
process.env.DUR1_WORK ??= '/var/tmp/foundry-work/dur1-test';
const { wc1Stage, advSetStage, rtWindowsStage, ledgerMeter } = await import('../paid.mjs');
const { loadSealed } = await import('../changes.mjs');
const { stubAgentRunner } = await import('../run.mjs');
const sealed = loadSealed(path.join(here, '../fixtures/sealed-stub.json'));

test.after(() => rmSync(runs, { recursive: true, force: true }));

test('WC-1 t0 pass at a toy budget: per-target records, the budget is respected, the pass resumes from its files', async () => {
  const r = await wc1Stage({ when: 't0', sealed, budgets: { groupA: 2, groupB: 2 }, only: ['b1lh-e8-1', 'ch-e8-2'], poolSize: 8, maxSize: 14, salts: 1 });
  assert.deepEqual(Object.keys(r.targets).sort(), ['b1lh-e8-1', 'ch-e8-2']);
  for (const t of Object.values(r.targets)) { assert.ok(t.used <= 2, `used ${t.used}`); assert.ok(t.ht && Number.isFinite(t.ht.failure.estimate)); }
  assert.equal(r.targets['b1lh-e8-1'].group, 'A'); assert.equal(r.targets['ch-e8-2'].group, 'B');
  const again = await wc1Stage({ when: 't0', sealed, budgets: { groupA: 0, groupB: 0 }, only: ['b1lh-e8-1', 'ch-e8-2'] });
  assert.equal(again.targets['b1lh-e8-1'].used, r.targets['b1lh-e8-1'].used, 'resumed from the file, not re-searched');
});

test('ADV-SET cross-run and A-H red-team windows: every t0 code arm meets the frozen worlds; the agent window is metered and writes a record', async () => {
  // An R1 overlay: valid for the reference (it knows the rule), failed by the static starting versions (they do not).
  // (MR11 on 1302 d4 salt 5 is a bed finding: the bed's own injectFailures makes the earliest reference emit an
  // inventory.reserve outside the allowed set on o0014; WC-1 classes it as such, BUILD-NOTES §5.)
  // Salt 12 since the B1 fix (2026-11-04): a vector is one world for every target, so the world of salt 11 changed (it no
  // longer holds an R1 case the static versions fail); on salt 12 every starting version fails one R1 case silently.
  const vector = { base: 1301, salt: 12, difficulty: 3, mix: 'tail', size: 14, transforms: [], fault: 'none', overlays: ['R1'] };
  writeFileSync(path.join(runs, 'ADV-SET.json'), JSON.stringify({ frozenAt: 'test', set: [{ source: 'test', vector }] }));
  const a = await advSetStage({ sealed });
  assert.equal(a.set.length, 1);
  assert.equal(a.cross.length, 9 + 3, 'nine starting versions and S1-S3');
  assert.ok(a.cross.every(x => x.valid && Number.isInteger(x.silent)));
  const w = await rtWindowsStage({ sealed, runner: stubAgentRunner, meterOf: label => ledgerMeter({ scope: label, row: 'P7' }) });
  assert.ok(a.cross.filter(x => x.arm === 'S-H*').some(x => x.failing > 0), 'the static starting versions fail R1 cases');
  assert.equal(w.length, 1);
  assert.ok(w[0].n >= 1 && w[0].n <= 8, `routed ${w[0].n} cases`);
  assert.equal(w[0].agentPass, 0, 'the do-nothing stub agent passes none of them');
  assert.ok(existsSync(path.join(runs, 'rtwindows', `${w[0].label}.window.json`)));
  const ledger = existsSync(path.join(runs, 'spend.jsonl')) ? readFileSync(path.join(runs, 'spend.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  assert.ok(ledger.every(l => l.scope.startsWith('A-H-RT')), 'every agent tick is on the ledger under its window');
  assert.equal(ledger.filter(l => l.phase === 'start').length, ledger.filter(l => l.phase === 'end').length, 'every reservation is settled');
});
