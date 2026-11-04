// Tests for the MEM-0b battery and the MEM-0c context measurement (research/memory-20261021/MEMORY-MODEL.md §6). $0, no model calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACKS, HONEST, replayDivergence, runBattery } from '../battery.mjs';
import { FoundryBoard, LabelledStore, SharedDict, SharedNotes } from '../baselines.mjs';
import { measure } from '../context-bytes.mjs';

const RESIDUAL = 'A14 injection steers a quarantined judgment within its enum (residual)';

test('the battery result the design doc reports (regression lock)', () => {
  const r = runBattery({ trials: 60 });
  const f = r.designs['F-board'];
  assert.deepEqual(Object.entries(f.attacks).filter(([, a]) => a.succeeded).map(([n]) => n), [RESIDUAL], 'the board holds every attack except the residual control');
  assert.equal(f.summary.honestFalseRefusals, '0/83'); assert.equal(f.summary.honestWorkloadsCorrect, '6/6'); assert.equal(f.replay.differ, 0);
  assert.equal(f.attacks['A13 sybil flood within quotas'].denialOfService, true, 'a sybil flood is refused loudly, not absorbed');
  assert.equal(r.designs['N0-shared-notes'].summary.attacksSucceeded, '14/14');
  assert.equal(r.designs['N1-shared-dict'].summary.attacksSucceeded, '13/14');
  assert.equal(r.designs['N2-labelled-store'].summary.attacksSucceeded, '9/14');
  assert.equal(r.designs['N2-labelled-store'].attacks['A3 label forging inside the data'].succeeded, true, 'self-describing labels are forgeable');
  assert.equal(r.designs['N2-labelled-store'].attacks['A2 injection-to-sink, topic admits web data'].succeeded, false, 'labels alone stop plain injection');
  for (const id of ['N0-shared-notes', 'N1-shared-dict', 'N2-labelled-store']) assert.ok(r.designs[id].replay.differ > 0, `${id} reads latest, so a replay can see other state`);
  assert.deepEqual(r.cost, { usd: 0, modelCalls: 0 });
});

// Teeth: each mutant disables one board defence through the public interface; the battery must notice.
class NoWriterCheck extends FoundryBoard {
  static id = 'mutant-no-writer-check';
  write(writer, topic, value, meta = {}) { const t = this.decl.topics[topic]; return super.write(t ? t.writers[0] : writer, topic, value, meta); }
}
class SelfDescribedLabels extends FoundryBoard {
  static id = 'mutant-self-labels';
  write(writer, topic, value, meta = {}) { return super.write(writer, topic, value, value?.security_label?.integrity === 'trusted' ? { ...meta, label: 'trusted' } : meta); }
}
class NoCas extends FoundryBoard {
  static id = 'mutant-no-cas';
  writeKey(writer, topic, value, meta = {}) { const k = this.decl.topics[topic].key; return super.writeKey(writer, topic, value, { ...meta, version: this.board.version(topic, value[k]) }); }
}
class BoardOutlivesRun extends FoundryBoard {
  static id = 'mutant-board-outlives-run';
  constructor({ decl, runId, carry } = {}) { super({ decl, runId }); for (const e of carry ?? []) this.board.write(e.writer, e.topic, e.value, { label: e.label, confidentiality: e.confidentiality, sources: e.sources }); }
  carry() { return this.board.events; }
}
test('the battery has teeth: each disabled defence flips its attack', () => {
  assert.equal(ATTACKS['A4 undeclared writer (confused deputy)'](NoWriterCheck).succeeded, true);
  assert.equal(ATTACKS['A4 undeclared writer (confused deputy)'](FoundryBoard).succeeded, false);
  assert.equal(ATTACKS['A3 label forging inside the data'](SelfDescribedLabels).succeeded, true);
  assert.equal(ATTACKS['A5 lost update under concurrent writers'](NoCas).succeeded, true);
  assert.equal(ATTACKS['A8 cross-run persistence of a poisoned lesson'](BoardOutlivesRun).succeeded, true);
  assert.equal(ATTACKS['A8 cross-run persistence of a poisoned lesson'](FoundryBoard).succeeded, false);
  // A reader that does not read at its recorded sequence diverges on replay.
  class ReadsLatest extends FoundryBoard { static id = 'mutant-reads-latest'; static pinnedReads = false; }
  assert.ok(replayDivergence(ReadsLatest, { trials: 40 }).differ > 0);
  assert.equal(replayDivergence(FoundryBoard, { trials: 40 }).differ, 0);
});

test('honest workloads are judged the same way for every design (no design-specific scoring)', () => {
  for (const D of [SharedNotes, LabelledStore, FoundryBoard]) assert.equal(HONEST['H2 four explorers, ten findings each'](D).correct, true, D.id);
  assert.equal(HONEST['H2 four explorers, ten findings each'](SharedDict).correct, false, 'a last-write-wins dict loses concurrent findings');
});

test('MEM-0c reads the dev split only, is deterministic, and the board view is smaller than the transcript pool', () => {
  const a = measure({ seeds: 2, difficulties: [3] }), b = measure({ seeds: 2, difficulties: [3] });
  assert.deepEqual(a, b);
  const d3 = a.byDifficulty.d3;
  assert.equal(d3.tasks, 2); assert.equal(d3.explorersK, 3);
  assert.ok(d3.boardTokensPerRead.mean > 0 && d3.poolTokensPerRead.mean > 10 * d3.boardTokensPerRead.mean);
  assert.match(a.bed, /dev split/); assert.deepEqual(a.cost, { usd: 0, modelCalls: 0 });
});
