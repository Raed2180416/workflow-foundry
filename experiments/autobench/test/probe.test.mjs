// Tool-effect cards (probe.py): the probe runs in AutomationBench's venv on a scratch world (no task, no rubric) and its
// cards record what each write route really stores. Needs the venv (corpus/AutomationBench/.venv), skipped without it.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/probe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { VENV_PY, HERE } from '../lib.mjs';

const HAVE_VENV = existsSync(VENV_PY);
const PROBE = path.join(HERE, 'probe.py');

test('probe: write routes only, most of them probed, cards carry the stored names an agent cannot see in the API', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  try {
    const r = spawnSync(VENV_PY, ['-I', PROBE, '--out', out], { cwd: out, encoding: 'utf8', timeout: 540_000 });
    assert.equal(r.status, 0, r.stderr.slice(-2000));
    const doc = JSON.parse(readFileSync(path.join(out, 'cards.json'), 'utf8'));
    const { summary, cards } = doc;
    assert.ok(cards.every(c => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method)), 'reads are not probed');
    assert.ok(summary.routes >= 300 && summary.ok >= 200, JSON.stringify(summary));
    assert.ok(summary.withActions >= 50 && summary.renamedBeyondCase >= 20, JSON.stringify(summary));
    const card = route => cards.find(c => c.route === route && c.ok);
    // Trello stores a created card as action "card" and renames idList/idBoard to list/board (verified by hand in the impl)
    const t = card('trello.cards_create');
    assert.deepEqual(t.effect.actions.map(a => a.action_key), ['card']);
    assert.deepEqual(t.effect.verbatim.idList, ['list']);
    assert.deepEqual(t.effect.verbatim.idBoard, ['board']);
    // Asana's due_on is stored as dueDate; Slack's username as bot_name
    assert.deepEqual(card('asana.tasks_create').effect.verbatim.due_on, ['dueDate']);
    assert.ok(card('slack.chat_post_message').effect.verbatim.username.includes('bot_name'));
    // nothing from the task registry or the rubric was imported
    assert.ok(!/rubric|domains/.test(JSON.stringify(cards.map(c => c.impl))));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
