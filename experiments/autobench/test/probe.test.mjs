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
    // hand review (MOVE2-COMP.md §5.2): an update is a change inside one record matched by id, not a remove plus an add
    const hs = card('helpscout.conversations_update').effect.collections['helpscout.conversations'];
    assert.deepEqual(hs, { add: 0, remove: 0, change: 1 });
    assert.ok(cards.filter(c => c.ok && Object.values(c.effect.collections).some(v => v.add > 0 && v.remove > 0)).length <= 5);
    // a synthetic value outside a Literal fails pydantic validation; the probe drops that field and keeps the others,
    // so the card maps the arguments instead of recording an empty body (Freshdesk stores `type` as ticket_type)
    const fd = card('freshdesk.tickets_create');
    assert.deepEqual(fd.effect.verbatim.subject, ['subject']);
    assert.deepEqual(fd.effect.verbatim.type, ['ticket_type']);
    assert.deepEqual(card('mailchimp.members_create').effect.verbatim.first_name, ['FNAME']);
    // nothing from the task registry or the rubric was imported
    assert.ok(!/rubric|domains/.test(JSON.stringify(cards.map(c => c.impl))));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
