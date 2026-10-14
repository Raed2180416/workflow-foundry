// T5 (LIBRARY-TESTS §2; BUILD-ORDER step 8): the retroactive sweep finds exactly the outputs a latent defect changed
// (LIBRARY §7.5). A P16 dedupe component built from the card's skeleton, called two levels down a flow.call tree
// (root P54 solver -> stub child C -> the dedupe solver), is journaled on 24 dev fixture tasks through the real flow-v3
// SDK, gateway and call host in stub mode. Its v1 has a latent defect in the BAND slot (the borderline band starts at 0.6,
// so pairs at similarity 0.3-0.6 are never judged); an independent check on one task discovers it; v2 restores the band;
// the sweep replays every past input through v2 (journal first, a $0 stub for the judge sites v1 never asked) and must mark
// exactly the runs a brute-force v2 re-run changes, mark their callers, relabel the ledger rows and spend $0. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCard } from '../cards.mjs';
import { assemble } from '../assemble.mjs';
import { openLibrary } from '../store.mjs';
import { runSolver, solverStub, journalKeyOf } from '../run.mjs';
import { registerSolver } from '../construct.mjs';
import { recordRun, recordChildRun, loadRuns, loadChildJournal, invocationsOf, solverReexec, sweep, latentDefectSignal, loadSweeps, runsFromCallLog } from '../sweep.mjs';
import { outDigestOf } from '../../jit/call-host.mjs';
import { learnProfile } from '../../jit/profile.mjs';
import { prng } from '../retrieve.mjs';
import { tmp, clock } from './helpers.mjs';

const P16 = loadCard('P16'), P54 = loadCard('P54');
const HAIKU = 'claude-haiku-5-5';
const SAME = { tiers: [HAIKU], system: 'Are records A and B the same customer? Answer same, different or unsure, with a verbatim quote from A or B that decides it.',
  prompt: "(p) => 'A: ' + p.a.name + ' <' + p.a.email + '>\\nB: ' + p.b.name + ' <' + p.b.email + '>'",
  schema: { type: 'object', required: ['same', 'quote'], additionalProperties: false, properties: { same: { enum: ['same', 'different', 'unsure'] }, quote: { type: 'string' } } },
  check: "(v, p) => v.same === 'unsure' || (v.quote && [p.a.name, p.a.email, p.b.name, p.b.email].join(' ').includes(v.quote)) ? null : 'quote not in pair'" };
const dedupe = band => assemble({ parts: [{ card: P16, slots: { ROWS: 'inputs.rows', BLOCK: "(r) => String(r.name).toLowerCase().split(/\\s+/).filter(w => w.length > 2)",
  SIM: "(a, b) => { const A = new Set(a.name.toLowerCase().split(/\\s+/)), B = new Set(b.name.toLowerCase().split(/\\s+/)); const i = [...A].filter(w => B.has(w)).length; return i / (A.size + B.size - i); }",
  BAND: band, SAME, CONCURRENCY: 2 } }], budgetUsd: 0.02 }).source;
const V1 = dedupe([0.6, 0.95]), V2 = dedupe([0.3, 0.95]);   // the latent defect: the band misses 0.3-0.6
const ARG = { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object', required: ['id', 'name', 'email'] } } } };
const OUT = { type: 'object', required: ['clusters'], properties: { clusters: { type: 'array' } } };

// 24 dev fixture tasks (seeded). Kinds of pairs: exact twins (code merges), close variants at 2/3 (judged by both versions),
// wide variants at 1/2 (judged by v2 only: the defect's footprint), and different people sharing a word at 1/3 (v2 asks,
// the answer is different).
const FIRST = ['Anna', 'Jonas', 'Mira', 'Pavel', 'Lena', 'Omar', 'Sofia', 'Tomas', 'Ines', 'Karl'], LAST = ['Berg', 'Lind', 'Novak', 'Haddad', 'Moreau', 'Silva', 'Keller', 'Dahl'];
function fixtureTask(i) {
  const rand = prng(20261014 + i), pick = xs => xs[Math.floor(rand() * xs.length)];
  const rows = [], same = [];
  const person = k => { const f = FIRST[(i + k * 3) % FIRST.length], l = LAST[(i * 5 + k) % LAST.length]; return { f, l, email: `${f}.${l}.${i}${k}@example.com`.toLowerCase() }; };
  const add = (name, email) => { const r = { id: `c${rows.length + 1}`, name, email }; rows.push(r); return r; };
  for (let k = 0; k < 4; k++) { const p = person(k); add(`${p.f} ${p.l}`, p.email); }
  const p0 = person(0), p1 = person(1), p2 = person(2);
  add(`${p0.f} ${p0.l}`, p0.email);                                             // exact twin of row 1 (similarity 1)
  if (i % 2 === 0) same.push([rows[1], add(`${p1.f} M. ${p1.l}`, p1.email)]);   // close variant (2/3): both versions judge it
  if (i % 3 === 0) same.push([rows[2], add(`${p2.f} ${pick(['Sofie', 'Maria', 'Elin'])} ${pick(['K.', 'J.', 'R.'])} ${p2.l}`, p2.email)]);   // wide variant (1/2): v2 only
  if (i % 4 === 1) add(`${p0.f} Quist Varga`, `${p0.f}.qv.${i}@example.com`.toLowerCase());   // shares a word with row 1 at 1/3: v2 asks, 'different'
  return { prompt: 'Deduplicate the customer rows.', inputs: { rows } , same };
}
const pairPrompt = (a, b) => `A: ${a.name} <${a.email}>\nB: ${b.name} <${b.email}>`;
// The stub judge table both the journaled runs and the brute-force re-runs use: true pairs 'same', anything else 'different'.
const answersFor = tasks => ({ 'same-entity': [
  ...tasks.flatMap(t => t.same.flatMap(([a, b]) => [{ when: pairPrompt(a, b), value: { same: 'same', quote: a.email } }, { when: pairPrompt(b, a), value: { same: 'same', quote: a.email } }])),
  { value: { same: 'different', quote: '@' } }] });

test('the journal key is the request\'s identity (model, system, prompt, schema); a trace\'s sha256 of a long text keys like the text', () => {
  const a = { model: HAIKU, system: 's', prompt: 'p', schema: { type: 'object', properties: { x: {}, y: {} } } };
  assert.equal(journalKeyOf(a), journalKeyOf({ ...a, schema: { properties: { y: {}, x: {} }, type: 'object' } }), 'canonical schema');
  for (const k of ['model', 'system', 'prompt']) assert.notEqual(journalKeyOf(a), journalKeyOf({ ...a, [k]: 'other' }), k);
  assert.notEqual(journalKeyOf(a), journalKeyOf({ ...a, schema: { type: 'string' } }));
  const sha = s => createHash('sha256').update(s).digest('hex');
  assert.equal(journalKeyOf(a), journalKeyOf({ model: HAIKU, schema: a.schema, systemSha256: sha('s'), promptSha256: sha('p') }));
});

test('T5: the retroactive sweep marks exactly the runs a brute-force v2 re-run changes, marks their callers, relabels the ledger; $0', async t => {
  const lib = openLibrary(tmp(t, 'lib-t5-'), { now: clock() });
  const tasks = Array.from({ length: 24 }, (_, i) => fixtureTask(i)), answers = answersFor(tasks);
  // The component h1 (v1) with a profile learned from the 24 accepted inputs; the stub child C that calls it; the root.
  const h1 = registerSolver(lib, { source: V1, contract: { input: ARG, output: OUT, taskTemplate: 'dedupe rows' }, patterns: ['P16'], name: 'dedupe-v1', profile: learnProfile(tasks.map(x => ({ prompt: 'dedupe rows', inputs: { rows: x.inputs.rows } }))) });
  lib.bindStub(h1.hash, solverStub(V1, { answers, taskTemplate: 'dedupe rows', onRun: ({ input, result }) => recordChildRun(lib, { callee: h1.hash, version: 1, input, result }) }));
  const C = lib.register({ layer: 'L2', name: 'region-dedupe', contract: { input: ARG, output: { type: 'object', required: ['clusters', 'n'] }, taskTemplate: 'dedupe a region' },
    stub: async (input, ctx) => { const r = await ctx.call({ v: 1, op: 'call', callee: h1.hash, input, name: 'dedupe', budgetUsd: 0.02 }); return r.status === 'ok' ? { output: { clusters: r.output.clusters, n: r.output.clusters.length } } : { status: 'deopt', deopt: { kind: 'call', name: 'dedupe', detail: r.refused ?? r.deopt?.kind ?? null } }; },
    tags: ['compose', 'P54'], patterns: ['P54'], provenance: { source: 'maintainer', ref: 'T5', licence: 'internal', redistributable: false } });
  const root = assemble({ parts: [{ card: P54, slots: { PARTS: "(task, x) => [{ key: 'all', input: { rows: x.rows } }]", REF: C.hash, CHILD_BUDGET: 0.1, ON_REFUSE: 'value',
    COMBINE: '(kids, parts) => kids[0] && !kids[0].refused && !kids[0].deopt ? { clusters: kids[0].clusters, n: kids[0].n } : { clusters: [], n: 0, review: true }',
    ARG, READS: { type: 'object', required: ['clusters', 'n'], properties: { clusters: { type: 'array' }, n: { type: 'integer' } } }, CONCURRENCY: 1 } }], budgetUsd: 0.5 }).source;
  const ROOT = registerSolver(lib, { source: root, contract: { input: null, output: { type: 'object' }, taskTemplate: 'Deduplicate the customer rows.' }, patterns: ['P54'], name: 'root' });
  // Journal 24 runs (and 2 runs of another solver that never calls h1); one admitting judgment and run/reuse evidence per h1 call.
  for (const [i, task] of tasks.entries()) {
    const r = await runSolver({ source: root, task, library: lib, budgetUsd: 0.5 });
    assert.equal(r.status, 'ok', `task ${i}: ${r.stderr}`); assert.equal(r.liveModelCalls, 0);
    const run = recordRun(lib, { runId: `t${i}`, hash: ROOT.hash, task, result: r });
    const hc = run.calls.find(e => e.callee === h1.hash);
    assert.equal(hc.kind, 'call-end'); assert.equal(hc.depth, 2, 'h1 runs two levels down');
    lib.recordJudgment({ port: 'applicability', engine: 'code', request: { options: ['false', 'true'] }, result: { probabilities: { false: 0, true: 1 }, chosen: 'true', confidence: 1 },
      meta: { item: { layer: 'L2', id: h1.hash, version: 1 }, task: { key: `t${i}`, path: hc.path }, decision: { taken: 'reuse', by: 'code' } } });
    lib.addEvidence(h1.hash, { kind: 'run', ok: true, oracle: 'pass', runId: `t${i}:${hc.path}` });
    lib.addEvidence(h1.hash, { kind: 'reuse', class: 'correct', runId: `t${i}:${hc.path}` });
  }
  const other = assemble({ parts: [{ card: loadCard('P12'), slots: { ITEMS: 'inputs.rows', BODY: '(r) => ({ n: r.name.length })', REDUCE: '(rs) => ({ total: rs.reduce((a, r) => a + r.n, 0) })', MAX_ITEMS: 50, CONCURRENCY: 2 } }] }).source;
  for (const i of [0, 1]) recordRun(lib, { runId: `o${i}`, hash: 'sha256:' + 'ee'.repeat(32), task: tasks[i], result: await runSolver({ source: other, task: tasks[i] }) });
  // Tolerance: slice-2 / unknown event kinds in a run's call log are ignored and counted.
  const runs = loadRuns(lib.dir);
  runs[3].calls.push({ kind: 'interpret-child', callee: h1.hash, path: 'root/call:x#0' }, { kind: 'profile-warn', callee: h1.hash }, { kind: 'phase-start', span: 'phase:a#0' });

  // Discover: an independent check (the fixture's truth, computed by code) disagrees with v1's output on task 0, whose
  // input is inside h1's profile, and the v1 replay reproduces the output: a latent defect, not drift.
  const truthClusters = t0 => { const n = t0.inputs.rows.length; return n - t0.same.length - 1; };
  const v1out = (await runSolver({ source: V1, task: { prompt: 'dedupe rows', inputs: { rows: tasks[0].inputs.rows } }, answers })).output;
  assert.notEqual(v1out.clusters.length, truthClusters(tasks[0]), 'v1 under-merges task 0');
  const signal = latentDefectSignal({ kind: 'oracle-disagreement', profile: lib.get(h1.hash).profile, prompt: 'dedupe rows', input: { rows: tasks[0].inputs.rows }, replay: 'same-failure' });
  assert.deepEqual(signal, { latent: true, why: 'oracle-disagreement on an input inside the profile', failureClass: 'defect' });
  // Fix as v2 (a new hash that supersedes v1), and a sibling built from the same pattern (for step 6).
  const h2 = registerSolver(lib, { source: V2, contract: { input: ARG, output: OUT, taskTemplate: 'dedupe rows' }, patterns: ['P16'], name: 'dedupe-v2' });
  const sib = lib.register({ layer: 'L2', name: 'other-dedupe', contract: { input: ARG, output: OUT }, stub: async () => ({ output: { clusters: [] } }), tags: ['fan', 'P16'], patterns: ['P16'],
    provenance: { source: 'own-trace', ref: 'T5', licence: 'internal', redistributable: false } });

  // Brute force: v2 on every past h1 input, with the full stub table; the changed set by (run, path).
  const childJournal = loadChildJournal(lib.dir);
  const { invocations } = invocationsOf(runs, { hash: h1.hash, version: 1 }, { childJournal });
  assert.equal(invocations.length, 24, 'scope: one h1 invocation per journaled run, none from the other solver');
  const brute = new Set();
  for (const inv of invocations) { const r = await runSolver({ source: V2, task: { prompt: 'dedupe rows', inputs: inv.input }, answers }); assert.equal(r.status, 'ok'); if (outDigestOf(r.output) !== inv.outDigest) brute.add(`${inv.runId} ${inv.path}`); }
  assert.ok(brute.size > 0 && brute.size < 24, `brute force changes ${brute.size} of 24`);

  // The sweep.
  const s = await sweep({ library: lib, runs, childJournal, defect: { hash: h1.hash, version: 1, class: 'pattern-slot', pattern: 'P16', slot: 'BAND', fixedBy: h2.hash,
    text: 'The borderline band reaches down to where true duplicates still occur (verify on a labelled sample); pairs below it are never judged.' },
  reexec: solverReexec(V2, { fallback: answers, taskTemplate: 'dedupe rows' }) });
  assert.deepEqual(new Set(s.suspect.map(x => `${x.runId} ${x.path}`)), brute, 'suspect set = brute-force set');
  assert.equal(s.runsScanned, 24); assert.equal(s.unresolved.length, 0); assert.equal(s.stands, 24 - brute.size);
  assert.equal(s.costUsd, 0); assert.equal(s.liveModelCalls, 0);
  assert.ok(s.journalHits > 0, 'unchanged judge calls were served from the journal'); assert.ok(s.reasked > 0, 'changed judge sites went to the $0 stand-in');
  assert.deepEqual(s.ignoredEventKinds, { 'interpret-child': 1, 'profile-warn': 1, 'phase-start': 1 });
  // Callers: the stub child's call span and the root run of every suspect.
  for (const x of s.suspect) {
    const anc = s.ancestors.filter(a => a.runId === x.runId).map(a => a.path).sort();
    assert.deepEqual(anc, [x.path.split('/').slice(0, 2).join('/'), 'root'].sort(), `${x.runId}: the C span and the root are marked`);
    assert.ok(s.ancestors.some(a => a.runId === x.runId && a.callee === C.hash));
  }
  // Ledger rows relabelled for exactly the suspect runs; evidence moved.
  const rows = lib.judgmentRows().filter(j => j.meta?.item?.id === h1.hash);
  for (const j of rows) {
    const sus = brute.has(`${j.meta.task.key} ${j.meta.task.path}`);
    assert.equal(j.truth, sus ? 'false' : null, `${j.meta.task.key}`); if (sus) assert.equal(j.labelSource, 'retro-sweep');
  }
  assert.equal(s.relabelled.length, brute.size);
  const ev = lib.get(h1.hash).evidence;
  assert.equal(ev.reuse.wrong, brute.size); assert.equal(ev.reuse.correct, 24 - brute.size);
  assert.equal(ev.oraclePass, 24 - brute.size); assert.equal(ev.suspect.runs, brute.size); assert.deepEqual(ev.suspect.sweepIds, [s.sweepId]);
  // Generalise: a proposed checklist line, and the other P16 component (not v1, not its fix) to sweep next.
  assert.deepEqual(s.generalise.toSweep, [sib.hash]); assert.equal(s.generalise.proposal.slot, 'BAND');
  // Reported, nothing deleted.
  assert.equal(loadSweeps(lib.dir).length, 1); assert.equal(loadRuns(lib.dir).length, 26);
  assert.ok(readFileSync(lib.files.evidence, 'utf8').includes('"class":"correct"'), 'the original reuse rows are still there');
  t.diagnostic(`T5: ${brute.size}/24 runs suspect (brute force agrees); journal hits ${s.journalHits}, $0 re-asks ${s.reasked}, live $${s.costUsd}`);

  // Without a $0 stand-in for the changed judge sites, the sweep counts them unresolved; it never passes them silently.
  const s2 = await sweep({ library: lib, runs, childJournal, defect: { hash: h1.hash, version: 1 }, reexec: solverReexec(V2, { taskTemplate: 'dedupe rows' }), write: false });
  assert.ok(s2.unresolved.length > 0);
  assert.ok(s2.suspect.every(x => brute.has(`${x.runId} ${x.path}`)), 'what it does mark is in the brute-force set');
  assert.equal(s2.suspect.length + s2.unresolved.length + s2.stands, 24);
  assert.throws(() => solverReexec(V2, { liveUsdCap: 1 }), /paid step/);
});

test('sweep: a suspect root run with applied effects gets a remediation item (compensate if the binding declares one, else a human queue); a kept item drops to suspect', async t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const e = lib.register({ layer: 'L2', name: 'adder', contract: { input: null, output: { type: 'object' } }, stub: async () => ({ output: {} }), tags: ['fan'], provenance: { source: 'own-trace', ref: 't', licence: 'internal', redistributable: false } });
  lib.addEvidence(e.hash, { kind: 'admission', checks: { fixturesPass: true, probesPass: true, resetEnv: true, verifiedBy: 'independent-oracle', manifestWithinProbes: true, profileFromAccepted: true } });
  lib.transition(e.hash, 'shadow');
  for (let i = 0; i < 10; i++) lib.addEvidence(e.hash, { kind: 'run', ok: true, oracle: 'pass', runId: `r${i}` });
  for (let i = 0; i < 4; i++) lib.addEvidence(e.hash, { kind: 'shadow', agree: true, runId: `r${i}` });
  lib.transition(e.hash, 'kept');
  const runs = [0, 1, 2].map(i => ({ runId: `r${i}`, root: { hash: e.hash, version: 1 }, task: { prompt: 'add', inputs: { a: i, b: 2 } }, status: 'ok', outDigest: outDigestOf({ sum: i + 2 }), calls: [], trace: [],
    effects: i === 0 ? [{ binding: 'B:sheets.append', target: 'row 7' }] : i === 1 ? [{ binding: 'B:mail.send', target: 'ops@example.com' }] : [] }));
  // The fixed version adds 1 to inputs with a > 0: runs 1 and 2 change.
  const reexec = async inv => ({ status: 'ok', output: { sum: inv.input.a + inv.input.b + (inv.input.a > 0 ? 1 : 0) } });
  const s = await sweep({ library: lib, runs, defect: { hash: e.hash, version: 1 }, reexec, bindings: [{ tool: 'sheets.append', effect: { kind: 'write', compensate: 'sheets.deleteRow' } }, { tool: 'mail.send', effect: { kind: 'send' } }] });
  assert.deepEqual(s.suspectRuns, ['r1', 'r2']);
  assert.deepEqual(s.effectsRemediated.map(x => [x.runId, x.action]), [['r1', 'human-queue']]);
  assert.equal(s.effectsRemediated[0].diff.before, runs[1].outDigest);
  assert.equal(lib.get(e.hash).status, 'suspect');
  const ev = lib.get(e.hash).evidence;
  assert.equal(ev.oraclePass, 8); assert.equal(ev.shadowAgree, 2, 'the suspect runs leave shadow agreement too');
  // A run whose effect binding declares a compensating tool is compensated, not queued.
  const s3 = await sweep({ library: null, runs, defect: { hash: e.hash }, reexec: async inv => ({ status: 'ok', output: { sum: -1 } }), bindings: [{ tool: 'sheets.append', effect: { kind: 'write', compensate: 'sheets.deleteRow' } }], write: false });
  assert.deepEqual(s3.effectsRemediated.map(x => [x.runId, x.action, x.tool ?? null]), [['r0', 'compensate', 'sheets.deleteRow'], ['r1', 'human-queue', null]]);
});

test('sweep: call-host events from a stream calls.jsonl group into runs; latent-defect signals: drift, report and env are not latent defects', t => {
  const dir = tmp(t), file = `${dir}/calls.jsonl`;
  const ev = (idx, kind, extra = {}) => JSON.stringify({ experiment: 'x', idx, version: 1, attempt: 0, childId: 'c', kind, callee: 'sha256:' + 'aa'.repeat(32), calleeVersion: 1, path: 'root/call:c#0', depth: 1, input: { a: idx }, outDigest: 'abc', ...extra });
  writeFileSync(file, [ev(1, 'call-end'), ev(1, 'interpret-child'), ev(2, 'call-deopt'), ev(3, 'call-refused')].join('\n') + '\n');
  const runs = runsFromCallLog(file);
  assert.deepEqual(runs.map(r => r.runId), ['x:1:0', 'x:2:0', 'x:3:0']);
  const { invocations, ignored } = invocationsOf(runs, { hash: 'sha256:' + 'aa'.repeat(32), version: 1 });
  assert.deepEqual(invocations.map(i => [i.runId, i.status]), [['x:1:0', 'ok'], ['x:2:0', 'deopt']]);
  assert.deepEqual(ignored, { 'interpret-child': 1 });
  const profile = learnProfile([{ prompt: 'p', inputs: { a: 1, b: 'x' } }, { prompt: 'p', inputs: { a: 2, b: 'y' } }]);
  assert.equal(latentDefectSignal({ kind: 'shadow-disagreement', profile, prompt: 'p', input: { a: 1, b: 'x', c: [1, 2, 3] } }).latent, false, 'outside the profile: drift');
  assert.equal(latentDefectSignal({ kind: 'report', profile, prompt: 'p', input: { a: 1, b: 'x' } }).latent, false, 'a report needs a reproducing replay');
  assert.equal(latentDefectSignal({ kind: 'report', profile, prompt: 'p', input: { a: 1, b: 'x' }, replay: 'same-failure' }).latent, true);
  assert.equal(latentDefectSignal({ kind: 'oracle-disagreement', envCodes: ['MODEL_QUOTA'] }).latent, false, 'an environment fault');
  assert.equal(latentDefectSignal({ kind: 'oracle-disagreement', replay: 'passed' }).latent, false, 'a flake');
  assert.equal(latentDefectSignal({ kind: 'checklist-static' }).latent, true);
});
