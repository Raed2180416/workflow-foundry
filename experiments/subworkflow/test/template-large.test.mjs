// $0: the legacy-export-intake template, with true slots and true labels, reproduces the truth at d4 and d5 too (backlogs of
// 110-290 rows), and its practice smoke passes there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateById, instantiate } from '../templates.mjs';
import { practiceRun, createNodeBinding } from '../bind.mjs';
import { bed, backlogChannels, nodeInput, trueSlots, truthJudgePort } from './fixtures.mjs';

test('true slots + true labels reproduce the truth on every backlog channel at d4-d5 (3 seeds each)', async () => {
  const T = templateById('legacy-export-intake');
  for (const d of [4, 5]) for (const seed of [601, 602, 603]) {
    const task = bed.generate({ seed, split: 'dev', difficulty: d });
    for (const ch of backlogChannels(task)) {
      const spec = instantiate(T, trueSlots(task, ch), 0.05), input = nodeInput(task, ch.name);
      const practice = await practiceRun(spec, input);
      assert.equal(practice.ok, true, JSON.stringify(practice.error));
      const b = createNodeBinding({ port: truthJudgePort(task), budgetUsd: 0.1, taskKey: task.id, runId: 'test', outputSchema: bed.nodeOutputSchema });
      const r = await b.call(spec, input);
      assert.equal(r.value.status, 'ok', JSON.stringify(r.value).slice(0, 400));
      const o = bed.nodeOracle(task, ch.name, r.value.output);
      assert.equal(o.pass, true, `${task.id} ${ch.name}: ${JSON.stringify(o.details).slice(0, 400)}`);
    }
  }
});
