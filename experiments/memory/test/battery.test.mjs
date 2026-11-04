// Tests for the MEM-0b battery (revision 2) and the MEM-0c context measurement (research/memory-20261021/MEMORY-MODEL.md §6).
// $0, no model calls. The first test is a REGRESSION LOCK on the reported numbers, not evidence for them; the evidence that the
// battery measures something is in the teeth tests (a disabled defence flips its attack) and the uniformity tests.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { canonical } from '../../../src/data.mjs';
import { ATTACKS, HONEST, PAYLOAD_SEEDS, realFindings, replayDivergence, RESIDUAL, runBattery } from '../battery.mjs';
import { DESIGNS, FoundryBoard, PlainEdges } from '../baselines.mjs';
import { fairPage } from '../board.mjs';
import { measure } from '../context-bytes.mjs';

const status = (r, design, attack) => r.designs[design].attacks[attack].status;
const won = (r, design) => Object.entries(r.designs[design].attacks).filter(([, a]) => a.succeeded).map(([n]) => n.split(' ')[0]);

test('regression lock: the battery result the design doc reports', () => {
  const r = runBattery({ trials: 30 });
  assert.deepEqual(won(r, 'F-board'), ['A10', 'A11', 'A13c']);
  assert.deepEqual(won(r, 'E0-edges+state'), ['A10', 'A11', 'A12a', 'A12b', 'A12c']);
  assert.equal(status(r, 'E0-edges+state', 'A13c sybil flood with many declared writers (bound exceeded)'), 'lost-without-attack');
  assert.equal(r.designs['N0-shared-notes'].summary.attacksSucceeded, '17/17');
  assert.equal(r.designs['N1-shared-dict'].summary.attacksSucceeded, '14/17');
  assert.equal(r.designs['N2-labelled-store'].summary.attacksSucceeded, '12/17');
  for (const d of Object.values(r.designs)) { assert.equal(d.summary.residualSucceeded, 1, 'A14 beats every design'); assert.equal(d.summary.honestFalseRefusals, '0/173'); }
  assert.deepEqual(Object.fromEntries(Object.entries(r.designs).map(([id, d]) => [id, d.summary.honestWorkloadsCorrect])),
    { 'N0-shared-notes': '9/10', 'N1-shared-dict': '2/10', 'N2-labelled-store': '9/10', 'E0-edges+state': '9/10', 'F-board': '9/10' });
  assert.equal(r.designs['F-board'].honest['H10 honest reproduction after reading the claim'].correct, false, 'the price of the conservative echo rule');
  assert.equal(r.designs['E0-edges+state'].honest['H2 four explorers, ten real findings each (over the cap)'].correct, false, 'edges have no continuation');
  for (const d of Object.values(r.designs)) assert.equal(d.replay.journalDiffers, 0, 'every design replays from its journal');
  assert.equal(r.designs['E0-edges+state'].replay.reexecDiffers, 0, 'edges read after their writers complete');
  assert.ok(r.designs['F-board'].replay.reexecDiffers > 0, 'without its journal the board is as nondeterministic as the notes');
  assert.ok(r.designs['F-board'].replay.journalBytesPerRead < r.designs['N0-shared-notes'].replay.journalBytesPerRead);
  assert.deepEqual(r.cost, { usd: 0, modelCalls: 0 });
});

// Teeth: each mutant disables one defence through the public interface; the battery must notice.
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
  constructor({ decl, runId, carry } = {}) { super({ decl, runId }); for (const e of carry ?? []) this.board.write(e.writer, e.topic, e.value, { label: e.label, sources: e.sources }); }
  carry() { return this.board.events; }
}
// Reads the whole view and lets the context compiler cut it (the head survives): a silent cut instead of a fair page.
class CutNotPaged extends FoundryBoard {
  static id = 'mutant-cut-not-paged';
  read(reader, topic, { budgetTokens } = {}) {
    const v = this.board.view(reader, topic);
    return { ok: true, inputs: [{ name: topic, value: v.value, label: v.label, render: 'json', maxTokens: budgetTokens, sourceRef: `board:${topic}@${v.atSeq}` }], next: null, confidentiality: 'public' };
  }
}
// Strips the kernel-derived provenance: only what the writer declares is kept.
class DeclaredSourcesOnly extends FoundryBoard {
  static id = 'mutant-declared-sources-only';
  write(writer, topic, value, meta = {}) { this.board.reads = this.board.reads.filter(r => r.reader !== writer); return super.write(writer, topic, value, meta); }
}
// Journals the read but replays at the latest sequence number instead of the recorded one.
class ReplaysLatest extends FoundryBoard {
  static id = 'mutant-replays-latest';
  journal(r) { return { bytes: 0, replay: () => this.board.readsFor(r.request.reader, [r.request.spec]).inputs }; }
}
test('the battery has teeth: each disabled defence flips its attack', () => {
  const A = ATTACKS;
  assert.equal(A['A4 undeclared writer (confused deputy)'](NoWriterCheck).succeeded, true);
  assert.equal(A['A4 undeclared writer (confused deputy)'](FoundryBoard).succeeded, false);
  assert.equal(A['A3 label forging inside the data'](SelfDescribedLabels).succeeded, true);
  assert.equal(A['A5 lost update under concurrent writers'](NoCas).succeeded, true);
  assert.equal(A['A8 cross-run persistence of a poisoned lesson'](BoardOutlivesRun).succeeded, true);
  assert.equal(A['A8 cross-run persistence of a poisoned lesson'](FoundryBoard).succeeded, false);
  assert.equal(A['A13 sybil flood within quotas'](CutNotPaged).succeeded, true, 'without fair paging the sybil flood wins');
  assert.equal(A['A13 sybil flood within quotas'](FoundryBoard).succeeded, false);
  assert.equal(A['A12b echo with omitted provenance (after a read)'](DeclaredSourcesOnly).succeeded, true, 'without derived provenance an echo passes');
  assert.equal(A['A12b echo with omitted provenance (after a read)'](FoundryBoard).succeeded, false);
  assert.ok(replayDivergence(ReplaysLatest, { trials: 20 }).journalDiffers > 0, 'the replay row compares content, not a flag');
  assert.equal(replayDivergence(FoundryBoard, { trials: 20 }).journalDiffers, 0);
});

test('scoring is uniform: no scenario branches on the design, every read has the same budget', () => {
  const src = readFileSync(new URL('../battery.mjs', import.meta.url), 'utf8');
  const scenarios = src.slice(src.indexOf('export const ATTACKS'), src.indexOf('// ------------------------------------------------------------------ the battery'));
  assert.ok(!/isBoard|instanceof|FoundryBoard|PlainEdges|SharedNotes|SharedDict|LabelledStore|F-board|E0-edges|\.id\b|pinnedReads/.test(scenarios), 'scenario code names no design');
  assert.ok(!/budgetTokens/.test(scenarios.replace(/observe\(/g, '')), 'no scenario sets its own read budget');
  // Every design gets the same budget, and none exceeds it in any scenario read.
  for (const D of DESIGNS) for (const run of [...Object.values(ATTACKS), ...Object.values(HONEST)]) {
    const r = run(D);
    for (const o of Object.values(r.orders ?? {})) assert.equal(o.overBudget, false, `${D.id} over budget`);
    if (r.overBudget !== undefined) assert.equal(r.overBudget, 0, `${D.id} over budget`);
  }
  assert.equal(Object.keys(RESIDUAL).length, 1, 'the residual control is reported apart, outside the denominator');
});

test('payloads are real gameqa dev findings outside every seed reserve; MEM-0c reads the dev split only', (t) => {
  const f = realFindings();
  assert.ok(f.length >= 200 && f.every(x => typeof x.bug_class === 'string' && Array.isArray(x.repro_actions)));
  assert.equal(PAYLOAD_SEEDS.split, 'dev');
  const a = measure({ seeds: 2, difficulties: [3] }), b = measure({ seeds: 2, difficulties: [3] });
  assert.deepEqual(a, b);
  assert.deepEqual(a.tasks, ['gameqa:dev:d3:s2001', 'gameqa:dev:d3:s2002'], 'task ids carry the split the generator used');
  const d3 = a.byDifficulty.d3;
  assert.ok(d3.boardTokensPerRead.mean > 0 && d3.poolTokensPerRead.mean > 10 * d3.boardTokensPerRead.mean);
  assert.ok(d3.boardOverVsEdges.shareOfSession > 0 && d3.boardOverVsEdges.shareOfSession < 0.05);
  assert.deepEqual(a.cost, { usd: 0, modelCalls: 0 });
  // The seed ledger lives in research/jit-20261008/ (not in every sparse checkout): when present, no range covering gameqa may
  // overlap the payload or MEM-0c seeds.
  const ledger = new URL('../../../research/jit-20261008/SEED-LEDGER.json', import.meta.url);
  if (!existsSync(ledger)) { t.diagnostic('seed ledger not in this checkout; overlap check skipped'); return; }
  const ranges = JSON.parse(readFileSync(ledger, 'utf8')).ranges.filter(r => r.split === 'dev' && (r.beds.includes('*') || r.beds.includes('gameqa')));
  for (const [lo, hi] of [[PAYLOAD_SEEDS.from, PAYLOAD_SEEDS.to], [a.seeds.from, a.seeds.to]])
    assert.ok(!ranges.some(r => r.from <= hi && (r.to === null || r.to >= lo)), `dev ${lo}-${hi} overlaps a reserved range`);
});

test('fair paging over real findings reaches every item exactly once', () => {
  const items = realFindings().slice(0, 30);
  const state = { reducer: 'append', items: items.map((value, i) => ({ seq: i + 1, writer: `e${i % 3}`, value })) };
  const topic = { reducer: 'append', writers: ['e0', 'e1', 'e2'], frameTokens: 40 };
  const seen = []; let cursor;
  do { const p = fairPage(state, topic, 1500, cursor).value; seen.push(...p.page); cursor = p.next ?? undefined; } while (cursor);
  assert.equal(seen.length, 30); assert.equal(new Set(seen.map(canonical)).size, 30);
  assert.equal(PlainEdges.midFlightReads, false);
});
