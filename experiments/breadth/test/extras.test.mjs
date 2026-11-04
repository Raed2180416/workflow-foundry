// WorkBench extras and BG-6 tests ($0, no model): the wb-extras-v1 rule (streams, fault units), the scripted reaction
// policies, and, with the pinned bed installed, faults and drift through the full facade (each fault has teeth and a
// robust scripted agent passes it) and the BG-6 comparator on synthetic tasks (valid variants the official comparator
// rejects; mutants it still kills).
//   nice -n 15 node --test --test-concurrency=1 experiments/breadth/test/extras.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXTRAS_RULE, FAULT_KINDS, RENAME, faultUnits, pickExtrasSalt, pickStream, streamQuota, streamTemplates, toolOfAction } from '../workbench/extras.mjs';
import { POLICIES } from '../workbench/extras-parity.mjs';
import { CLONE, VENV_PY } from '../workbench/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPLIT = JSON.parse(readFileSync(path.resolve(HERE, '../../../research/breadth-20261021/workbench/SPLIT.json'), 'utf8'));
const BED_READY = existsSync(VENV_PY) && existsSync(path.join(CLONE, 'src/evals/evaluation.py'));
const SALT = 'f'.repeat(40);
const res = (text, isError = true) => ({ content: [{ type: 'text', text }], isError });

test('extras rule: stream quota, template pick, salt, stream selection and fault units', () => {
  assert.deepEqual(streamQuota(SPLIT.heldOutTemplates), { analytics: 4, calendar: 3, customer_relationship_manager: 3, email: 2, multi_domain: 6, project_management: 2 });
  const st = streamTemplates(SPLIT.heldOutTemplates, SALT);
  assert.equal(st.length, 20); assert.equal(new Set(st).size, 20);
  assert.ok(st.every(t => SPLIT.heldOutTemplates.includes(t)));
  assert.deepEqual(streamTemplates(SPLIT.heldOutTemplates, SALT), st);
  assert.notDeepEqual(streamTemplates(SPLIT.heldOutTemplates, 'e'.repeat(40)), st);
  assert.throws(() => streamTemplates(SPLIT.heldOutTemplates, 'nope'), /40-hex/);
  const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
  assert.equal(pickExtrasSalt([`${a} 300 WIP: later`, `${b} 200 WIP: first`, `${c} 150 Docs: x`], 100).sha, b);
  assert.equal(pickExtrasSalt([`${a} 50 WIP: before`], 100), null);
  // a stream: skips shipped/duplicate texts and unclean gold, tops up from the next seed, reports reuse exposure
  const row = (id, task, outcome) => ({ id, template_id: 't/1', task, outcome });
  const rows8860 = [row('x1', 'shipped text', ['a']), row('x2', 'new 1', ['a']), row('x3', 'new 1', ['b']), row('x4', 'new 2', ['b']), row('x5', 'new 3', ['c'])];
  const rows8861 = [row('y1', 'new 4', ['a'])];
  const s = pickStream('t/1', [[8860, rows8860], [8861, rows8861]], new Set(['shipped text']), new Set(['x2', 'x3', 'x4', 'y1']), 3);
  assert.deepEqual(s.taken.map(t => t.id), ['x2', 'x4', 'y1']);
  assert.deepEqual(s.skipped, { textDuplicate: 2, goldNotClean: 1 });
  assert.equal(s.distinctGold, 2); assert.equal(s.differFromFirst, 1);
  // fault units: state-changing population, hash order, kinds in rotation, specs from the first write
  const writes = new Set(Object.keys(RENAME));
  assert.equal(writes.size, 14);
  const inst = Array.from({ length: 30 }, (_, i) => ({ id: `s-${i}`, template_id: 'email/x', domain: 'email',
    outcome: i % 3 === 0 ? [] : ['email.search_emails.func(query="q")', `email.send_email.func(recipient="a${i}@atlas.com", subject="s", body="b")`] }));
  const u = faultUnits(inst, SALT, writes, 8);
  assert.equal(u.length, 8);
  assert.ok(u.every(x => !x.id.endsWith('-0') && Number(x.id.split('-')[1]) % 3 !== 0));
  assert.deepEqual(u.map(x => x.fault.kind), [...FAULT_KINDS, ...FAULT_KINDS]);
  assert.deepEqual(u[2].fault, { kind: 'rename_param', tool: 'email.send_email', from: 'recipient', to: 'to' });
  assert.deepEqual(u[3].fault, { kind: 'distractor', like: 'email.send_email' });
  assert.equal(toolOfAction('email.send_email.func(recipient="a")'), 'email.send_email');
  assert.equal(EXTRAS_RULE.streams.perStream, 10);
});

test('scripted reaction policies: what each one repeats', () => {
  const step = { name: 'email_send_email', arguments: { recipient: 'a@b.co' } };
  const tools = [{ name: 'email_send_email', inputSchema: { properties: { to: {}, subject: {} } } }];
  assert.equal(POLICIES.naive, null);
  assert.deepEqual(POLICIES.blind_retry({ step, result: res('x'), attempt: 1 }), step);
  assert.equal(POLICIES.blind_retry({ step, result: res('x'), attempt: 2 }), null);
  assert.equal(POLICIES.blind_retry({ step, result: res('ok', false), attempt: 1 }), null);
  assert.deepEqual(POLICIES.robust({ step, tools, attempt: 1, result: res("Invalid arguments: unknown parameter 'recipient'.") }), { name: 'email_send_email', arguments: { to: 'a@b.co' } });
  assert.deepEqual(POLICIES.robust({ step, tools, attempt: 1, result: res('503 Service Unavailable: retry') }), step);
  assert.equal(POLICIES.robust({ step, tools, attempt: 1, result: res('Request timed out after 30 s ... The outcome is unknown.') }), null);
  assert.deepEqual(POLICIES.robust({ step: { ...step, name: 'email_send_email_v2' }, tools, attempt: 1, result: res('This endpoint (email_send_email_v2) is retired') }), step);
});

test('faults through the facade (pinned bed): each fault has teeth and the robust agent passes it', { skip: BED_READY ? false : 'pinned WorkBench bed not installed' }, async () => {
  const { runScriptedBatch, cleanup } = await import('../workbench/scripted.mjs');
  const { HOST_ONLY, writeJsonl } = await import('../workbench/lib.mjs');
  // a synthetic task in the shipped world (no benchmark item is used): one e-mail to a directory address
  const send = 'email.send_email.func(recipient="sofia.santos@atlas.com", subject="Fault probe", body="Checking the facade.")';
  const t = { id: 'syn-fault-1', domain: 'email', template_id: 'email/syn', task: 'synthetic', outcome: [send] };
  const tasksFile = path.join(HOST_ONLY, 'test', `faults-${process.pid}.jsonl`);
  writeJsonl(tasksFile, [t]);
  const item = (key, fault, policy, extra = {}) => ({ key, task: t, actions: t.outcome, fault, policy: POLICIES[policy], ...extra });
  const rename = { kind: 'rename_param', tool: 'email.send_email', from: 'recipient', to: 'to' };
  const items = [
    item('transient-naive', { kind: 'transient' }, 'naive'), item('transient-robust', { kind: 'transient' }, 'robust'),
    item('lost-naive', { kind: 'lost_ack' }, 'naive'), item('lost-blind', { kind: 'lost_ack' }, 'blind_retry'), item('lost-robust', { kind: 'lost_ack' }, 'robust'),
    item('rename-naive', rename, 'naive'), item('rename-robust', rename, 'robust'),
    item('distract-naive', { kind: 'distractor', like: 'email.send_email' }, 'naive', { rewriteSteps: s => s.map(x => ({ ...x, name: `${x.name}_v2` })) }),
    item('distract-robust', { kind: 'distractor', like: 'email.send_email' }, 'robust', { rewriteSteps: s => s.map(x => ({ ...x, name: `${x.name}_v2` })) }),
  ];
  const r = await runScriptedBatch({ items, tasksFile, label: 'test-faults', concurrency: 1 });
  try {
    const v = Object.fromEntries(r.verdicts.map(x => [x.key, x.correct]));
    assert.deepEqual(v, { 'transient-naive': false, 'transient-robust': true, 'lost-naive': true, 'lost-blind': false, 'lost-robust': true,
      'rename-naive': false, 'rename-robust': true, 'distract-naive': false, 'distract-robust': true });
    const row = k => r.rows.find(x => x.key === k);
    assert.deepEqual(row('lost-blind').actions, [send, send]); // the duplicate the blind retry caused
    assert.deepEqual(row('rename-robust').actions, [send]); // the host mapped `to` back: the world saw the official action
    assert.ok(r.rows.every(x => x.facade.envFault === null));
  } finally { cleanup(r.liveRoot); rmSync(tasksFile, { force: true }); }
});

test('BG-6 comparator (pinned bed): valid variants it accepts and is_correct rejects; mutants both kill', { skip: BED_READY ? false : 'pinned WorkBench bed not installed' }, async () => {
  const { bedJson, HOST_ONLY, writeJsonl, readJsonl } = await import('../workbench/lib.mjs');
  const dir = path.join(HOST_ONLY, 'test');
  const s1 = 'email.send_email.func(recipient="sofia.santos@atlas.com", subject="One", body="First.")';
  const s2 = 'email.send_email.func(recipient="nia.johnson@atlas.com", subject="Two", body="Second.")';
  const ev = 'calendar.create_event.func(event_name="Sync", participant_email="nia.johnson@atlas.com", event_start="2023-12-01 13:00:00", duration="30")';
  const tasks = [{ id: 'syn-bg6-1', domain: 'email', template_id: 'email/syn', task: 'synthetic', domains: ['email'], outcome: [s1, s2] },
    { id: 'syn-bg6-2', domain: 'calendar', template_id: 'calendar/syn', task: 'synthetic', domains: ['calendar'], outcome: [ev] }];
  const tasksFile = path.join(dir, `bg6-tasks-${process.pid}.jsonl`), vFile = path.join(dir, `bg6-variants-${process.pid}.jsonl`);
  const inFile = path.join(dir, `bg6-in-${process.pid}.jsonl`), outFile = path.join(dir, `bg6-out-${process.pid}.jsonl`);
  try {
    writeJsonl(tasksFile, tasks);
    await bedJson(['variants', '--tasks', tasksFile, '--out', vFile], { cwd: dir });
    const vs = readJsonl(vFile);
    const ops = new Set(vs.map(v => v.op));
    for (const op of ['reorder_same_table_creates', 'datetime_iso_t', 'datetime_minutes', 'number_decimal', 'email_upper', 'reads_interleaved']) assert.ok(ops.has(op), op);
    const extra = [{ id: 'syn-bg6-2', key: 'wrong', op: 'mutant', actions: [ev.replace('13:00:00', '14:00:00')] }, { id: 'syn-bg6-1', key: 'dup', op: 'mutant', actions: [s1, s1, s2] }];
    writeJsonl(inFile, [...vs, ...extra]);
    await bedJson(['replay', '--tasks', tasksFile, '--in', inFile, '--out', outFile], { cwd: dir });
    const r = Object.fromEntries(readJsonl(outFile).map(x => [x.key, x]));
    const k = (id, op) => r[`${id}:${op}`];
    assert.deepEqual([k('syn-bg6-1', 'reorder_same_table_creates').correct, k('syn-bg6-1', 'reorder_same_table_creates').equivalent_sem], [false, true]);
    assert.deepEqual([k('syn-bg6-2', 'datetime_iso_t').correct, k('syn-bg6-2', 'datetime_iso_t').equivalent_sem], [false, true]);
    assert.deepEqual([k('syn-bg6-2', 'number_decimal').correct, k('syn-bg6-2', 'number_decimal').equivalent_sem], [false, true]);
    assert.deepEqual([k('syn-bg6-2', 'email_upper').correct, k('syn-bg6-2', 'email_upper').equivalent_sem], [true, true]);
    assert.deepEqual([k('syn-bg6-1', 'reads_interleaved').correct, k('syn-bg6-1', 'reads_interleaved').equivalent_sem], [true, true]);
    assert.deepEqual([r.wrong.correct, r.wrong.equivalent_sem], [false, false]); // a wrong time is a different outcome
    assert.deepEqual([r.dup.correct, r.dup.equivalent_sem], [false, false]); // a duplicate send is too
  } finally { for (const f of [tasksFile, vFile, inFile, outFile]) rmSync(f, { force: true }); }
});
