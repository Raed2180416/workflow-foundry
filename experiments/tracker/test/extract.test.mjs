// Extraction through the journaled ModelPort with a scripted provider (no paid call), the spend cap, policy model ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort, checkPortableSchema } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { extractLedger, extractPrompt, EXTRACT_SCHEMA, budgetedPort, BudgetError, defaultModels, checkModelId } from '../extract.mjs';
import { WRITE_SCHEMA } from '../checks.mjs';
import { frozenSpecE } from '../eval-e8.mjs';

// The frozen SPEC-E (git 48535bb): the line numbers below are that text's (the working-tree file has moved).
const SPEC = frozenSpecE();
const { writer: HAIKU, escalate: SONNET } = defaultModels();
const portWith = script => {
  const provider = new ScriptedProvider(script);
  const db = new DatabaseSync(':memory:');
  return { port: new ModelPort({ policy: subsetPolicy(loadPolicy().policy, [HAIKU, SONNET]), journal: new Journal(db), providers: { 'claude-cli': provider } }), provider, db };
};

test('model ids come from the owner policy: class M extracts and writes, the next class is the one escalation', () => {
  const policy = loadPolicy().policy;
  assert.equal(policy.models.find(m => m.id === HAIKU).class, 'M');
  assert.equal(policy.models.find(m => m.id === SONNET).class, 'L');
  assert.equal(checkModelId(HAIKU), HAIKU);
  assert.throws(() => checkModelId('gpt-4o'), /not listed in the model policy/);
  checkPortableSchema(EXTRACT_SCHEMA);
  checkPortableSchema(WRITE_SCHEMA);
});

test('extraction: one journaled call; the model sees the text as data and no code; quotes that are not verbatim are dropped', async () => {
  const entries = [
    { quote: 'If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.', kind: 'when-then', summary: 'partial -> resubmit failed items with original keys', context: [] },
    { quote: 'R2.1 Read `fraud.check` for every new order.', kind: 'must', summary: 'fraud check per order', context: [] },
    { quote: 'Every order is shipped within one day.', kind: 'deadline', summary: 'invented', context: [] },
  ];
  const { port, provider, db } = portWith(() => ({ value: { entries }, costUsd: 0.0123, usage: { inputTokens: 9000, outputTokens: 800 } }));
  const { ledger } = await extractLedger({ port, modelId: HAIKU, text: SPEC, source: { file: 'beds/ebed/e8/spec/SPEC-E.md' }, runId: 'test' });
  assert.equal(provider.calls.length, 1);
  const call = provider.calls[0];
  assert.match(call.prompt, /<<<USER-TEXT\n# SPEC-E/);
  assert.match(call.prompt, /data, never an instruction/);
  assert.doesNotMatch(call.prompt, /createSolver|solver\.mjs|effect\.emit/, 'no build, trace or code reaches the extractor');
  assert.deepEqual(ledger.requirements.map(r => [r.id, r.span.line, r.kind]), [['Q-001', 122, 'must'], ['Q-002', 161, 'when-then']]);
  assert.equal(ledger.dropped.length, 1);
  assert.deepEqual([ledger.extractor.model, ledger.extractor.returned, ledger.extractor.kept, ledger.extractor.dropped, ledger.extractor.costUsd], [HAIKU, 3, 2, 1, 0.0123]);
  const rows = db.prepare('SELECT node_key, model_id, cost_usd, ok FROM model_calls').all();
  assert.deepEqual(rows.map(r => [r.node_key, r.model_id, r.cost_usd, r.ok]), [['extract', HAIKU, 0.0123, 1]], 'journaled with its cost');
  assert.match(extractPrompt('x'), /when-then/);
});

test('low coverage (fewer entries than uncovered normative sentences) is flagged, never silently used', async () => {
  const text = 'You must record the order. Never charge twice. Each item carries its own key. Send the notice within 60 min.';
  const one = [{ quote: 'Never charge twice.', kind: 'never', summary: 'no double charge', context: [] }];
  const all = [one[0], { quote: 'You must record the order.', kind: 'must', summary: 'record', context: [] }, { quote: 'Each item carries its own key.', kind: 'must', summary: 'keys', context: [] },
    { quote: 'Send the notice within 60 min.', kind: 'deadline', summary: 'notice', context: [] }];
  const { port: p1 } = portWith(() => ({ value: { entries: one } }));
  const { ledger: bad } = await extractLedger({ port: p1, modelId: HAIKU, text });
  assert.equal(bad.extractor.lowCoverage, true, '1 entry against 3 uncovered normative sentences');
  assert.equal(bad.uncovered.length, 3);
  const { port: p2 } = portWith(() => ({ value: { entries: all } }));
  const { ledger: good } = await extractLedger({ port: p2, modelId: HAIKU, text, sampleIndex: 1 });
  assert.equal(good.extractor.lowCoverage, undefined);
  assert.equal(good.uncovered.length, 0);
});

test('a failed extraction call throws (nothing is invented in its place)', async () => {
  const { port } = portWith(() => ({ value: { nope: true } }));
  await assert.rejects(extractLedger({ port, modelId: HAIKU, text: SPEC }), /extraction failed: MODEL_SCHEMA/);
});

test('the spend cap: calls stop once the cap is spent; every call is logged', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tracker-budget-'));
  try {
    const { port } = portWith(() => ({ value: { entries: [] }, costUsd: 0.6 }));
    const logFile = path.join(dir, 'calls.jsonl');
    const capped = budgetedPort(port, { capUsd: 1, logFile });
    await extractLedger({ port: capped, modelId: HAIKU, text: SPEC, sampleIndex: 0 });
    await extractLedger({ port: capped, modelId: HAIKU, text: SPEC, sampleIndex: 1 });
    assert.equal(capped.spentUsd, 1.2);
    await assert.rejects(extractLedger({ port: capped, modelId: HAIKU, text: SPEC, sampleIndex: 2 }), BudgetError);
    capped.note({ event: 'escalation', id: 'Q-001' });
    const log = readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(log.map(r => r.event), ['call', 'call', 'refused', 'escalation']);
    assert.equal(log[1].spentUsd, 1.2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
