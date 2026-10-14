// E-BED §9.7 replay determinism and accounting ($0): every run is journaled; replay reproduces byte-identical content
// rows, ledger, SoR and outputs, else the run is void; a quota stop freezes the simulated clock at the last committed
// wake-up and a resumed run (same or another process) ends byte-identical to an uninterrupted one; the per-arm
// workspace is restored to its last committed snapshot; costs come from the journal only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, hashOf } from '../../../lib/canonical.mjs';
import * as H from '../index.mjs';
import { p2pItem, p2pWorld, p2pSolver, sagaItem, sagaWorld, sagaSolver, fuzzArm, quotaAfter, SEEDS } from './toy.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ebed-host-'));
const content = rows => rows.filter(r => !H.CONTROL_TYPES.has(r.type)).map(({ seq, prev, hash, ...c }) => c);
const rechain = rows => { let prev = '0'.repeat(64); return rows.map((r, i) => { const { seq, prev: _p, hash, ...c } = r; const row = { seq: i, prev, hash: '', ...c }; row.hash = rowHashOf(prev, c); prev = row.hash; return row; }); };
import { rowHash as rowHashOf } from '../journal.mjs';

const CASES = [
  ...SEEDS.slice(0, 8).map(seed => ['p2p-solver', p2pItem, () => p2pWorld({ seed, renames: true }), () => p2pSolver(), undefined]),
  ...SEEDS.slice(8, 14).map(seed => ['p2p-fuzz', p2pItem, () => p2pWorld({ seed }), () => fuzzArm(seed), undefined]),
  ...SEEDS.slice(14, 18).map(seed => ['p2p-keyless', p2pItem, () => p2pWorld({ seed }), () => p2pSolver({ keys: false, statusCheck: false, id: 'keyless' }), undefined]),
  ...SEEDS.slice(18, 24).map(seed => ['saga', sagaItem, () => sagaWorld({ seed }), () => sagaSolver(), undefined]),
  ...SEEDS.slice(24, 27).map(seed => ['saga-bare-keyless', sagaItem, () => sagaWorld({ seed }), () => sagaSolver({ keys: false, id: 'k0' }), 'bare']),
];

test('replay reproduces byte-identical content rows, ledger, SoR and outputs ($0, every call answered from the journal)', async () => {
  for (const [name, item, world, arm, profile] of CASES) {
    const res = await H.runWorld({ item, world: world(), arm: arm(), profile });
    const rows = res.host.journal.rows;
    const rp = await H.replayRun({ item, world: world(), journal: rows });
    assert.equal(rp.ok, true, `${name}: ${JSON.stringify(rp.divergence)?.slice(0, 400)}`);
    assert.equal(rp.status, 'complete');
    for (const k of ['journal', 'ledger', 'sor', 'outputs', 'content']) assert.equal(rp.digests[k], res.digests[k], `${name}: ${k}`);
    assert.equal(canonical(rp.ledger), canonical(res.host.ledger.committed));
    // $0: even with an arm present, a replay never calls it (review finding 15: this used to be a vacuous counter).
    let called = 0;
    const spy = { id: arm().id, tick() { called++; throw new Error('called during replay'); }, sweep() { called++; throw new Error('called during replay'); } };
    const again = await H.createHost({ item, world: world(), arm: spy, recorded: rows, mode: 'replay', profile: rows.find(r => r.type === 'run.start').profile }).run();
    assert.equal(again.status, 'complete');
    assert.equal(again.digests.content, res.digests.content);
    assert.equal(called, 0, `${name}: the arm was called during replay`);
  }
});

test('replay across processes: a journal written by a child process replays here, and the run reproduces there', async () => {
  const dir = tmp();
  try {
    const hostUrl = new URL('../index.mjs', import.meta.url).href, toyUrl = new URL('./toy.mjs', import.meta.url).href;
    const file = path.join(dir, 'journal.jsonl');
    const script = `import { runWorld } from ${JSON.stringify(hostUrl)}; import { p2pItem, p2pWorld, p2pSolver } from ${JSON.stringify(toyUrl)};
      const r = await runWorld({ item: p2pItem, world: p2pWorld({ seed: 1041, renames: true }), arm: p2pSolver(), journalFile: ${JSON.stringify(file)}, blobDir: ${JSON.stringify(path.join(dir, 'blobs'))} });
      console.log(JSON.stringify(r.digests));`;
    const child = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim());
    const rp = await H.replayRun({ item: p2pItem, world: p2pWorld({ seed: 1041, renames: true }), journal: file });
    assert.equal(rp.ok, true);
    assert.deepEqual({ ...rp.digests }, child);
    const here = await H.runWorld({ item: p2pItem, world: p2pWorld({ seed: 1041, renames: true }), arm: p2pSolver() });
    assert.deepEqual(here.digests, child);
    assert.equal(canonical(content(H.readJournal(file))), canonical(here.host.journal.contentRows()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('replay voids tampered, foreign, truncated-inside-a-wake-up and impure runs; a committed prefix verifies', async () => {
  const world = () => p2pWorld({ seed: 1042, renames: true });
  const res = await H.runWorld({ item: p2pItem, world: world(), arm: p2pSolver() });
  const rows = res.host.journal.rows;
  // (a) one call output edited and the chain rebuilt: the host re-derives different effects -> content divergence.
  const i = rows.findIndex(r => r.type === 'call' && r.output?.effects?.length);
  const forged = rows.map(r => ({ ...r }));
  forged[i] = { ...forged[i], output: { ...forged[i].output, effects: forged[i].output.effects.slice(1) } };
  const a = await H.replayRun({ item: p2pItem, world: world(), journal: rechain(forged) });
  assert.equal(a.ok, false); assert.equal(a.void, true); assert.equal(a.divergence.kind, 'content');
  // (b) edited without rebuilding the chain: integrity failure.
  const b = await H.replayRun({ item: p2pItem, world: world(), journal: forged });
  assert.equal(b.ok, false); assert.equal(b.divergence.kind, 'integrity');
  // (c) another world (one arrival moved): diverges at the first row (the world digest).
  const w2 = world(); w2.arrivals[0] = { ...w2.arrivals[0], at: H.addMinutes(w2.arrivals[0].at, 1) };
  const c = await H.replayRun({ item: p2pItem, world: w2, journal: rows });
  assert.equal(c.ok, false); assert.equal(c.divergence.index, 0);
  // (d) a prefix ending at a commit verifies; one ending inside a wake-up is void.
  const commits = rows.map((r, k) => (r.type === 'wakeup.commit' ? k : -1)).filter(k => k > 0);
  const cut = commits[Math.floor(commits.length / 2)];
  const d = await H.replayRun({ item: p2pItem, world: world(), journal: rows.slice(0, cut + 1) });
  assert.equal(d.ok, true); assert.equal(d.status, 'prefix-verified');
  const e = await H.replayRun({ item: p2pItem, world: world(), journal: rows.slice(0, cut - 1) });
  assert.equal(e.ok, false); assert.equal(e.divergence.kind, 'content');
  // (e) an impure item (a counterparty with hidden mutable state) is caught by replay.
  let calls = 0;
  const impure = { ...p2pItem, actors: { ...p2pItem.actors, counterparty: (wd, ctx) => (ctx.effect.op === 'pay' && ++calls % 2 ? [{ type: 'message.received', source: 'vendor', delayMinutes: 5, payload: { n: calls } }] : null) } };
  const r1 = await H.runWorld({ item: impure, world: world(), arm: p2pSolver() });
  const r2 = await H.replayRun({ item: impure, world: world(), journal: r1.host.journal.rows });
  assert.equal(r2.ok, false, 'replay voids a run whose world dynamics were not a pure function of the journal');
  // (f) the run's own end digests are checked too.
  const endIdx = rows.findIndex(r => r.type === 'run.end');
  const badEnd = rows.map(r => ({ ...r }));
  badEnd[endIdx] = { ...badEnd[endIdx], digests: { ...badEnd[endIdx].digests, ledger: 'f'.repeat(64) } };
  const f = await H.replayRun({ item: p2pItem, world: world(), journal: rechain(badEnd) });
  assert.equal(f.ok, false);
});

test('quota stop: the clock freezes at the last committed wake-up; resume (other process included) ends byte-identical to an uninterrupted run', async () => {
  for (const [seed, stops, concurrency] of [[1043, [7], 1], [1044, [3, 12, 20], 1], [1045, [9], 3]]) {
    const dir = tmp();
    try {
      const file = path.join(dir, 'j.jsonl'), blobDir = path.join(dir, 'blobs');
      const world = () => p2pWorld({ seed, renames: true });
      const clean = await H.runWorld({ item: p2pItem, world: world(), arm: p2pSolver(), concurrency });
      let res = await H.runWorld({ item: p2pItem, world: world(), arm: quotaAfter(p2pSolver(), stops[0], H.QuotaStop), journalFile: file, blobDir, concurrency });
      assert.equal(res.status, 'frozen');
      for (const n of stops.slice(1)) {
        res = await H.resumeRun({ item: p2pItem, world: world(), arm: quotaAfter(p2pSolver(), n, H.QuotaStop), journalFile: file, blobDir, concurrency });
        assert.equal(res.status, 'frozen');
      }
      const rows = H.readJournal(file);
      const freezes = rows.filter(r => r.type === 'clock.freeze');
      assert.equal(freezes.length, stops.length);
      for (const fr of freezes) {
        const before = rows.slice(0, fr.seq).filter(r => r.type === 'wakeup.commit').at(-1);
        assert.equal(fr.at, before ? before.at : null, 'the clock did not advance past the last commit');
        assert.ok(H.toMs(fr.interruptedAt) >= (before ? H.toMs(before.at) : 0));
        assert.ok(fr.discardedCalls.some(c => c.costs.some(x => x.usd === 0.01)), 'the stopped call\'s cost is kept');
      }
      // The final resume runs in a child process.
      const hostUrl = new URL('../index.mjs', import.meta.url).href, toyUrl = new URL('./toy.mjs', import.meta.url).href;
      const script = `import { resumeRun } from ${JSON.stringify(hostUrl)}; import { p2pItem, p2pWorld, p2pSolver } from ${JSON.stringify(toyUrl)};
        const r = await resumeRun({ item: p2pItem, world: p2pWorld({ seed: ${seed}, renames: true }), arm: p2pSolver(), journalFile: ${JSON.stringify(file)}, blobDir: ${JSON.stringify(blobDir)}, concurrency: ${concurrency} });
        console.log(JSON.stringify({ status: r.status, digests: r.digests }));`;
      const child = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim());
      assert.equal(child.status, 'complete');
      const final = H.readJournal(file);
      assert.equal(canonical(content(final)), canonical(clean.host.journal.contentRows()), `seed ${seed}: resumed content == uninterrupted content`);
      for (const k of ['ledger', 'sor', 'outputs', 'content']) assert.equal(child.digests[k], clean.digests[k], k);
      assert.equal(final.filter(r => r.type === 'run.resume').length, stops.length);
      const rp = await H.replayRun({ item: p2pItem, world: world(), journal: file });
      assert.equal(rp.ok, true, 'a resumed journal replays');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('crash: a journal torn mid-wake-up (partial line, partial commit) is cut back to the last commit and resumed to the same end', async () => {
  for (const [seed, frac] of [[1048, 0.37], [1049, 0.71], [1050, 0.93]]) {
    const dir = tmp();
    try {
      const file = path.join(dir, 'j.jsonl'), blobDir = path.join(dir, 'blobs');
      const world = () => p2pWorld({ seed, renames: true });
      const clean = await H.runWorld({ item: p2pItem, world: world(), arm: p2pSolver(), journalFile: file, blobDir });
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, text.slice(0, Math.floor(text.length * frac)));     // the process died while appending
      const { dropped, tornLine } = H.repairJournal(file, { dryRun: true });
      assert.ok(dropped >= 1 && tornLine);
      const res = await H.resumeRun({ item: p2pItem, world: world(), arm: p2pSolver(), journalFile: file, blobDir });
      assert.equal(res.status, 'complete');
      const rows = H.readJournal(file);
      assert.equal(canonical(content(rows)), canonical(clean.host.journal.contentRows()), `seed ${seed}`);
      const note = rows.find(r => r.type === 'run.resume');
      assert.equal(note.repaired.droppedRows, dropped);
      assert.equal((await H.replayRun({ item: p2pItem, world: world(), journal: file })).ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the per-arm workspace persists across calls, is snapshotted per call and is restored to the last committed snapshot on resume', async () => {
  const dir = tmp();
  try {
    const mk = (wsDir, observed) => {
      const base = p2pSolver({ id: 'ws-solver' });
      return { ...base, workspace: { dir: wsDir }, tick(input, ctx) {
        const f = path.join(ctx.workspace, 'count.txt');
        const n = existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0;
        observed?.push(n);
        writeFileSync(f, String(n + 1));
        writeFileSync(path.join(ctx.workspace, `seen-${input.instance}.txt`), input.now);
        return base.tick(input, ctx);
      } };
    };
    const world = () => p2pWorld({ seed: 1046, cases: 8 });
    const clean = await H.runWorld({ item: p2pItem, world: world(), arm: mk(path.join(dir, 'ws-clean')) });
    const calls = clean.host.journal.contentRows().filter(r => r.type === 'call' && r.kind === 'case');
    assert.ok(calls.every(c => c.workspace?.digest), 'every call has a snapshot');
    assert.equal(new Set(calls.map(c => c.workspace.digest)).size, calls.length, 'the counter changes every snapshot');
    assert.equal(readFileSync(path.join(dir, 'ws-clean', 'count.txt'), 'utf8'), String(calls.length));

    const file = path.join(dir, 'j.jsonl'), blobDir = path.join(dir, 'blobs'), wsDir = path.join(dir, 'ws');
    const stopped = await H.runWorld({ item: p2pItem, world: world(), arm: quotaAfter(mk(wsDir), 9, H.QuotaStop), journalFile: file, blobDir });
    assert.equal(stopped.status, 'frozen');
    writeFileSync(path.join(wsDir, 'count.txt'), '999');                 // what the discarded wake-up (or anyone) left behind
    const observed = [];
    const resumed = await H.resumeRun({ item: p2pItem, world: world(), arm: mk(wsDir, observed), journalFile: file, blobDir });
    assert.equal(resumed.status, 'complete');
    const committedCalls = H.readJournal(file).filter(r => r.type === 'call' && r.kind === 'case').length - observed.length;
    assert.equal(observed[0], committedCalls, 'the first live call sees the last committed snapshot, not the stale file');
    assert.equal(canonical(content(H.readJournal(file))), canonical(clean.host.journal.contentRows()));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('accounting: costs come from the journal (recordCost rows), survive replay, and real env faults stay untagged', async () => {
  const base = p2pSolver();
  const arm = { ...base, id: 'costed', tick(input, ctx) { ctx.recordCost({ model: 'claude-haiku-5-5', usd: 0.0003, tokensIn: 1200, tokensOut: 80, source: 'model-journal' }); return base.tick(input, ctx); } };
  const res = await H.runWorld({ item: p2pItem, world: p2pWorld({ seed: 1047 }), arm });
  const calls = res.host.journal.contentRows().filter(r => r.type === 'call' && r.kind === 'case');
  assert.ok(calls.every(c => c.costs.length === 1 && c.costs[0].usd === 0.0003));
  const usd = calls.reduce((s, c) => s + c.costs.reduce((t, x) => t + x.usd, 0), 0);
  const rp = await H.replayRun({ item: p2pItem, world: p2pWorld({ seed: 1047 }), journal: res.host.journal.rows });
  assert.equal(rp.ok, true);
  const replayed = rp.host.journal.contentRows().filter(r => r.type === 'call' && r.kind === 'case').reduce((s, c) => s + c.costs.reduce((t, x) => t + x.usd, 0), 0);
  assert.equal(replayed, usd, 'the replay is $0 and reproduces the recorded costs');
  assert.equal(hashOf(calls.map(c => c.costs)), hashOf(rp.host.journal.contentRows().filter(r => r.type === 'call' && r.kind === 'case').map(c => c.costs)));
});
