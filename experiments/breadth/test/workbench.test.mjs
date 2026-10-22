// WorkBench adapter tests ($0, no model): the frozen split, baseline builders, identity audit, runner selection hygiene
// and, when the pinned bed is installed (/var/tmp/foundry-work/benches/workbench), a scripted end-to-end check through
// the full facade (gold passes, do-nothing fails a state-changing task, a fatal tool error mirrors the official loop).
//   nice -n 15 node --test --test-concurrency=1 experiments/breadth/test/workbench.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPERATOR_ADDRESS, constantItems, modalGold, replayItems, violationItems } from '../workbench/baselines.mjs';
import { emailsIn, foreignAddresses, identityVerdict } from '../workbench/audit.mjs';
import { choosePrimary, pickRegenerated } from '../workbench/freeze-split.mjs';
import { anchorInstances, parseCsv } from '../workbench/prescreen.mjs';
import { DEFAULT_BUDGET, SEALED_ACK, initExpectation, isEnvFault, selectTasks } from '../workbench/run.mjs';
import { SPLIT_RULE, pickSalt, sealedQuota, shippedSealedPick, splitTemplates, templateIdsSha256 } from '../workbench/split.mjs';
import { OFFICIAL_SYSTEM_PROMPT, VENV_PY, CLONE, systemPrompt } from '../workbench/lib.mjs';
import { ARMS, armModel } from '../workbench/arms.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.resolve(HERE, '../../../research/breadth-20261021/workbench');
const SPLIT = JSON.parse(readFileSync(path.join(RES, 'SPLIT.json'), 'utf8'));
const PRESCREEN = JSON.parse(readFileSync(path.join(RES, 'PRESCREEN.json'), 'utf8'));
const ALL_IDS = [...SPLIT.devTemplates, ...SPLIT.heldOutTemplates];

test('split: the frozen record reproduces from the rule, the pinned population and the recorded salt', () => {
  assert.equal(ALL_IDS.length, 69);
  assert.equal(templateIdsSha256(ALL_IDS), SPLIT_RULE.population.templateIdsSha256);
  const s = splitTemplates(ALL_IDS, SPLIT.salt.sha);
  assert.deepEqual(s.dev, SPLIT.devTemplates);
  assert.deepEqual(s.heldOut, SPLIT.heldOutTemplates);
  assert.equal(s.dev.length, 29); assert.equal(s.heldOut.length, 40);
  assert.deepEqual(Object.fromEntries(Object.entries(SPLIT.counts.perDomain).map(([d, c]) => [d, c.dev])), { analytics: 5, calendar: 5, customer_relationship_manager: 3, email: 4, multi_domain: 9, project_management: 3 });
  assert.ok(SPLIT.salt.epoch > SPLIT.ruleCommitEpoch, 'salt is later than the rule');
  assert.throws(() => splitTemplates(ALL_IDS, 'not-a-sha'), /40-hex/);
  assert.throws(() => splitTemplates(ALL_IDS.slice(1), SPLIT.salt.sha), /expected 69/);
  // a different salt gives a different split (the salt matters)
  assert.notDeepEqual(splitTemplates(ALL_IDS, 'f'.repeat(40)).dev, SPLIT.devTemplates);
});

test('split: salt picking, quotas, H4 pick and the primary-set rule', () => {
  const lines = [`${'c'.repeat(40)} 300 WIP: running agents' changes`, `${'b'.repeat(40)} 250 Decision D99`, `${'a'.repeat(40)} 200 WIP: running agents' changes (x)`, `${'9'.repeat(40)} 100 WIP: running agents' changes`];
  assert.equal(pickSalt(lines, 150).sha, 'a'.repeat(40));
  assert.equal(pickSalt(lines, 200).sha, 'c'.repeat(40)); // strictly later
  assert.equal(pickSalt(lines, 300), null);
  assert.equal(sealedQuota('multi_domain/x'), 4); assert.equal(sealedQuota('email/x'), 3);
  assert.equal(SPLIT.sealed.n, 132);
  assert.equal(shippedSealedPick(['a', 'b', 'c', 'd', 'e'], 'email/x', SPLIT.salt.sha).length, 3);
  assert.equal(choosePrimary({ seedControl: true, regenerated: { bedLabel: 'H4', short: [] } }), false);
  assert.equal(choosePrimary({ seedControl: true, regenerated: { bedLabel: 'H2-ext', short: [] } }), true);
  assert.equal(choosePrimary({ seedControl: false, regenerated: { bedLabel: 'H2-ext', short: [] } }), false);
  assert.equal(SPLIT.sealed.bedLabel, 'H4');
  assert.equal(SPLIT.regeneratedSelection.answerChangedShare < SPLIT_RULE.sealed.h2ExtBedShare, true);
  const rows = [{ id: 'r1', template_id: 't', task: 'shipped text' }, { id: 'r2', template_id: 't', task: 'new 1' }, { id: 'r3', template_id: 't', task: 'new 2' }, { id: 'r4', template_id: 't', task: 'new 3' }];
  const p = pickRegenerated('t', [[8850, rows]], new Set(['shipped text']), new Set(['r2', 'r4']), 2);
  assert.deepEqual(p.taken.map(x => x.id), ['r2', 'r4']);
  assert.deepEqual(p.skipped, { textDuplicate: 1, goldNotClean: 1 });
});

const T = (id, domain, template, outcome, task = `task ${id}`) => ({ id, domain, template_id: `${domain}/${template}`, outcome, task });
test('baselines: modal gold (dev only), constant agents, sibling replay, violation probes', () => {
  const dev = [T('e-1', 'email', 'a', ['x()']), T('e-2', 'email', 'a', ['x()']), T('e-3', 'email', 'b', ['y()']), T('c-1', 'calendar', 'c', ['z()']), T('c-2', 'calendar', 'c', [])];
  assert.deepEqual(modalGold(dev).actions, ['x()']);
  assert.deepEqual(modalGold([]).actions, []);
  const { items, fitted } = constantItems(dev, dev);
  assert.deepEqual(fitted.perDomain.calendar.actions, ['z()']);
  assert.equal(items.filter(i => i.kind === 'constant').every(i => i.actions[0] === 'x()'), true);
  const rep = replayItems(dev);
  const e1 = rep.find(r => r.task.id === 'e-1');
  assert.equal(e1.sibling, 'e-2'); assert.deepEqual(e1.actions, ['x()']);
  assert.equal(rep.find(r => r.task.id === 'e-3').sibling, null); // no sibling: empty replay
  const v = violationItems([T('p-1', 'email', 'a', ['email.send_email.func(recipient="a@atlas.com", subject="s", body="hello")'])], { untouched: { taskId: '00000001', board: 'Design', otherBoard: 'Front end' } });
  const kinds = v.map(i => i.kind).sort();
  assert.deepEqual(kinds, ['case_only', 'extra_plot', 'extra_reads', 'operator_send', 'transient_write']);
  assert.match(v.find(i => i.kind === 'operator_send').actions.at(-1), new RegExp(OPERATOR_ADDRESS.replace('.', '\\.')));
  assert.match(v.find(i => i.kind === 'case_only').actions[0], /body="HELLO"/);
});

test('identity audit: foreign addresses are counted, world and task addresses are not', () => {
  const world = new Set(['jane@atlas.com']);
  assert.deepEqual(emailsIn('Mail Jane@Atlas.com and x@y.org'), ['jane@atlas.com', 'x@y.org']);
  const calls = [{ kind: 'world', args: { recipient: 'jane@atlas.com' }, text: 'ok' }, { kind: 'world', args: { recipient: 'owner@corp.example' }, text: '' }, { kind: 'world', args: { recipient: 'client@shop.io' }, text: '' }];
  const f = foreignAddresses({ calls, taskText: 'reply to client@shop.io', world });
  assert.equal(f.argAddresses, 3); assert.equal(f.foreign, 1); assert.deepEqual(f.foreignDomains, ['corp.example']);
  assert.equal(identityVerdict({ reply: 'unknown', calls: [], world }).pass, true);
  assert.equal(identityVerdict({ reply: 'someone@corp.example', calls: [], world }).pass, false);
  assert.equal(identityVerdict({ reply: 'jane@atlas.com', calls: [], world }).pass, true);
});

test('runner: split hygiene, sealed ack, anchor hash, environment faults, init expectation', () => {
  const shipped = SPLIT.devTemplates.slice(0, 3).flatMap((t, i) => [0, 1].map(j => ({ id: `d${i}${j}`, template_id: t, task: 'x', outcome: [] })))
    .concat(SPLIT.heldOutTemplates.slice(0, 2).map((t, i) => ({ id: `h${i}`, template_id: t, task: 'x', outcome: [] })));
  assert.throws(() => selectTasks({ pool: 'dev', ids: ['h0'], shipped, split: SPLIT, prescreen: PRESCREEN, runKey: 'k' }), /refused/);
  assert.equal(selectTasks({ pool: 'dev', ids: ['d00'], shipped, split: SPLIT, prescreen: PRESCREEN, runKey: 'k' }).tasks[0].id, 'd00');
  const dev = selectTasks({ pool: 'dev', n: 4, shipped, split: SPLIT, prescreen: PRESCREEN, runKey: 'k' });
  assert.equal(dev.tasks.length, 4); assert.ok(dev.tasks.every(t => t.id.startsWith('d')));
  assert.equal(new Set(dev.tasks.slice(0, 3).map(t => t.template_id)).size, 3); // spread: one per template first
  assert.throws(() => selectTasks({ pool: 'sealed', shipped, split: SPLIT, prescreen: PRESCREEN, runKey: 'k' }), /sealed-ack/);
  assert.throws(() => selectTasks({ pool: 'anchor', shipped, split: SPLIT, prescreen: { anchor: { ids: ['d00'], idsSha256: 'x' } }, runKey: 'k' }), /anchor list hash/);
  assert.equal(SEALED_ACK, 'wb-sealed-v1');
  assert.equal(isEnvFault({ sessionError: 'MODEL_RATE_LIMIT' }), true);
  assert.equal(isEnvFault({ sessionError: 'CONFIG_MISMATCH' }), true);
  assert.equal(isEnvFault({ facadeEnvFault: 'bed: exited' }), true);
  assert.equal(isEnvFault({ hostError: 'Error: ENOSPC: no space left' }), true);
  assert.equal(isEnvFault({ sessionError: 'MAX_TURNS' }), false);
  assert.equal(isEnvFault({ sessionError: 'EXECUTOR_TIMEOUT' }), false);
  const probe = { arms: { 'A-H': { ok: true, fingerprint: { cliVersion: '2.1.307', model: 'm', permissionMode: 'p', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], agents: [], outputStyle: 'default', apiKeySource: 'none' } } } };
  assert.equal('apiKeySource' in initExpectation('A-H', probe), false);
  assert.equal(initExpectation('A-S', probe), null);
  for (const a of Object.keys(ARMS)) { assert.ok(DEFAULT_BUDGET[a] > 0, a); assert.ok(armModel(a).price.inputPerMTok > 0, a); }
});

test('context declaration: official prompt first, then date note and synthetic identity, identical for every arm', () => {
  const sp = systemPrompt();
  assert.ok(sp.startsWith(OFFICIAL_SYSTEM_PROMPT));
  assert.match(sp, /2023-11-30/); assert.match(sp, /synthetic/); assert.match(sp, /belongs to the machine/);
  assert.ok(systemPrompt({ card: 'CARD' }).endsWith('CARD'));
});

test('prescreen: CSV parsing and the anchor spread', () => {
  const rows = parseCsv('a,b\n1,"x, ""y"""\n2,z\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"' }, { a: '2', b: 'z' }]);
  const dev = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, template_id: `t${i % 3}` }));
  const a = anchorInstances(dev, 'salt', 5);
  assert.equal(a.length, 5); assert.equal(new Set(a.slice(0, 3).map(id => dev.find(d => d.id === id).template_id)).size, 3);
  assert.equal(PRESCREEN.anchor.ids.length, 40);
  assert.equal(createHash('sha256').update(PRESCREEN.anchor.ids.join('\n')).digest('hex'), PRESCREEN.anchor.idsSha256);
  assert.equal(PRESCREEN.anchor.salt, SPLIT.salt.sha);
});

const BED_READY = existsSync(VENV_PY) && existsSync(path.join(CLONE, 'src/evals/evaluation.py'));
test('end to end through the facade (pinned bed): gold, do-nothing, a fatal tool error', { skip: BED_READY ? false : 'pinned WorkBench bed not installed' }, async () => {
  const { runScriptedBatch, cleanup } = await import('../workbench/scripted.mjs');
  const { shippedTasks, HOST_ONLY, writeJsonl } = await import('../workbench/lib.mjs');
  const tasks = await shippedTasks();
  const tasksFile = path.join(HOST_ONLY, 'test', `tasks-${process.pid}.jsonl`);
  writeJsonl(tasksFile, tasks);
  const t = tasks.find(x => x.domain === 'email' && x.outcome.length === 1 && x.outcome[0].startsWith('email.'));
  const items = [{ key: 'g', task: t, actions: t.outcome }, { key: 'n', task: t, actions: [] },
    { key: 'f', task: t, actions: ['email.search_emails.func(query="x", not_an_argument="1")', ...t.outcome] }];
  const r = await runScriptedBatch({ items, tasksFile, label: 'test-e2e', concurrency: 1 });
  try {
    const v = Object.fromEntries(r.verdicts.map(x => [x.key, x]));
    assert.equal(v.g.correct, true); assert.equal(v.g.native_correct, true); assert.equal(v.g.live_matches_replay, true);
    assert.equal(v.n.correct, false);
    assert.equal(v.f.correct, false); assert.equal(v.f.fatal, true); assert.equal(v.f.n_actions, 0); // official: function_calls lost on an exception
    const fRow = r.rows.find(x => x.key === 'f');
    assert.equal(fRow.facade.refused, 1); // the gold write after the fatal call never reached the world
  } finally { cleanup(r.liveRoot); rmSync(tasksFile, { force: true }); }
});

test('contamination probes: continuation and slot prompts, scoring, one-sided Fisher test', async () => {
  const { continuationProbe, slotProbe, score, fisherOneSided, firstValue } = await import('../workbench/contam-probe.mjs');
  const t = { id: 'email-000', domain: 'email', task: 'Delete my last email from nadia', outcome: ['email.delete_email.func(email_id="00000479")'],
    base_template: 'Delete my last email from {name}', chosen_template: 'Delete my last email from {name}' };
  const c = continuationProbe(t);
  assert.equal(c.target, '00000479');
  assert.ok(c.prompt.endsWith(`"Delete my last email from nadia","['email.delete_email.func(email_id=""`));
  assert.ok(!c.prompt.includes('00000479'));
  assert.equal(score('continuation', c.target, '00000479"")\']","Delete my'), true);
  assert.equal(firstValue('"00000480""'), '00000480');
  assert.equal(score('continuation', c.target, '00000480'), false);
  const s = slotProbe(t);
  assert.equal(s.target, 'nadia'); assert.match(s.prompt, /from \[MASK\]/); assert.ok(!s.prompt.includes('nadia'));
  assert.equal(score('slot', s.target, 'Nadia.'), true);
  assert.equal(continuationProbe({ ...t, outcome: [] }), null);
  assert.equal(slotProbe({ ...t, chosen_template: 'no slots' }), null);
  assert.ok(Math.abs(fisherOneSided(5, 10, 0, 10) - 0.01625) < 1e-4);
  assert.equal(fisherOneSided(0, 10, 0, 10), 1);
});

test('bed card: numbered pack and the citation filter', async () => {
  const { buildPack, filterCard } = await import('../workbench/card.mjs');
  const pack = buildPack({ readme: '# WorkBench\n\nTasks are graded by final state.', evaluation: 'def is_correct():\n    pass', tools: [{ bedName: 'email.send_email', write: true, description: 'Sends an email.', inputSchema: { properties: { recipient: {} } } }],
    devExamples: [{ id: 'email-001', task: 'Send x', outcome: ['email.send_email.func(recipient="a@atlas.com")'] }], officialPrompt: 'P' });
  assert.ok(pack.sources.has('README.md:3')); assert.ok(pack.sources.has('tool:email.send_email')); assert.ok(pack.sources.has('dev:email-001'));
  const card = ['## Scoring', '- The final world state is compared [README.md:3]', '- Made-up fact', '- Wrong cite [README.md:99]', 'stray prose', '- Sends mail [tool:email.send_email] [prompt]'].join('\n');
  const f = filterCard(card, pack.sources);
  assert.equal(f.card.trim().split('\n').length, 3);
  assert.deepEqual(f.removed.map(r => r.why), ['no citation', 'unknown source README.md:99', 'not a bullet']);
});
