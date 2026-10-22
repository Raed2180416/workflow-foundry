// $0: the legacy-export-intake template, filled with the true slots and judged with the true labels, reproduces the
// golive oracle's truth exactly on every backlog channel (so a template-arm failure is the builder's or the judge's,
// never the template's); its practice smoke passes; wrong slots are caught by its own verify steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateById, instantiate, slotProblems } from '../templates.mjs';
import { practiceRun, createNodeBinding, gateProblems, checkSpec } from '../bind.mjs';
import { PURE_OPS } from '../dsl.mjs';
import { bed, backlogChannels, nodeInput, trueSlots, truthJudgePort } from './fixtures.mjs';

const T = templateById('legacy-export-intake');
const validateNode = o => { const r = bed.nodeOracle; void r; return null; };
void validateNode;
const shapeOf = o => (o && Array.isArray(o.import) && Array.isArray(o.quarantine) && o.totals ? null : 'bad shape');
const ENV = { inputs: ['channel', 'spec', 'notes', 'export'], ops: [...PURE_OPS], models: ['claude-haiku-5-5'], maxDepth: 2, budgetUsd: 0.1 };

test('true slots + true labels reproduce the truth on every backlog channel (d1-d3, 8 seeds each)', async () => {
  let n = 0;
  for (const d of [1, 2, 3]) for (let seed = 501; seed <= 508; seed++) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    for (const ch of backlogChannels(task)) {
      const slots = trueSlots(task, ch);
      assert.deepEqual(slotProblems(T, slots), []);
      const spec = instantiate(T, slots, 0.05);
      assert.equal(checkSpec(spec, ENV).ok, true, JSON.stringify(checkSpec(spec, ENV)));
      const input = nodeInput(task, ch.name);
      const practice = await practiceRun(spec, input);
      assert.equal(practice.ok, true, `practice ${task.id} ${ch.name}: ${JSON.stringify(practice.error)}`);
      const port = truthJudgePort(task);
      const b = createNodeBinding({ port, budgetUsd: 0.1, maxDepth: 2, taskKey: task.id, runId: 'test', outputSchema: bed.nodeOutputSchema });
      const r = await b.call(spec, input, { name: 'intake' });
      assert.equal(r.value.status, 'ok', JSON.stringify(r.value).slice(0, 600));
      assert.deepEqual(gateProblems(r.value.output, { channel: ch.name, exportText: input.export, validate: shapeOf }), []);
      const o = bed.nodeOracle(task, ch.name, r.value.output);
      assert.equal(o.pass, true, `${task.id} ${ch.name}: ${JSON.stringify(o.details).slice(0, 600)}`);
      n++;
    }
  }
  assert.equal(n, 48);
});

test('wrong slots are caught by the template\'s own verify at practice time', async () => {
  const task = bed.generate({ seed: 777, split: 'dev', difficulty: 3 });
  const [ch] = backlogChannels(task), input = nodeInput(task, ch.name), good = trueSlots(task, ch);
  const swapOrder = { 'D/M/Y': 'M/D/Y', 'M/D/Y': 'D/M/Y', 'Y-M-D': 'D/M/Y', 'D.M.Y': 'D/M/Y', 'D Mon Y': 'D/M/Y' };
  const bad = {
    delimiter: { ...good, delimiter: good.delimiter === ';' ? '|' : ';' },
    dateOrder: { ...good, date_order: swapOrder[good.date_order] },
    decimal: { ...good, decimal_mark: good.decimal_mark === 'dot' ? 'comma' : 'dot' },
    letterO: { ...good, letter_o_is_zero: false },
    column: { ...good, col_note: 'Status' },
  };
  for (const [name, slots] of Object.entries(bad)) {
    const p = await practiceRun(instantiate(T, slots, 0.05), input);
    assert.equal(p.ok, false, `${name} should fail practice`);
  }
});

test('a wrong label from the judge fails the oracle but passes the gate (the gate cannot see judgments)', async () => {
  const task = bed.generate({ seed: 778, split: 'dev', difficulty: 2 });
  const [ch] = backlogChannels(task), input = nodeInput(task, ch.name);
  const truth = bed.nodeTruth(task, ch.name);
  const port = truthJudgePort(task, { wrong: new Set([truth.import[0].ref]) });
  const b = createNodeBinding({ port, budgetUsd: 0.1, taskKey: task.id, runId: 'test', outputSchema: bed.nodeOutputSchema });
  const r = await b.call(instantiate(T, trueSlots(task, ch), 0.05), input);
  assert.equal(r.value.status, 'ok');
  assert.equal(bed.nodeOracle(task, ch.name, r.value.output).pass, false);
});
