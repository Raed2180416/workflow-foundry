// Tests for the run-board prototype, revision 2 (experiments/memory/board.mjs; research/memory-20261021/MEMORY-MODEL.md). $0,
// no model calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileContext } from '../../../src/context.mjs';
import { canonical } from '../../../src/data.mjs';
import { Board, defineBoard, fairPage, flowsTo } from '../board.mjs';
import { prng } from '../battery.mjs';

const T = (reducer, writers, readers, more = {}) => ({ reducer, writers, readers, maxEvents: 100, ...more });
const node = { id: 'reader', instructions: 'Summarise the findings.', returns: { type: 'object' } };
const throwsCode = (fn, code) => assert.throws(fn, e => e.code === code, `expected ${code}`);

test('declarations are checked before any run', () => {
  throwsCode(() => defineBoard({ topics: { x: T('vote', ['a'], ['b']) } }), 'BOARD_DECL');
  throwsCode(() => defineBoard({ topics: { x: T('lww', ['a'], ['b']) } }), 'BOARD_DECL');                 // lww without key
  throwsCode(() => defineBoard({ topics: { x: { reducer: 'append', writers: ['a'], readers: ['b'] } } }), 'BOARD_DECL'); // no maxEvents
  throwsCode(() => defineBoard({ topics: { x: T('append', ['a'], ['ghost']) } }, { nodes: ['a', 'b'] }), 'BOARD_DECL');
  throwsCode(() => defineBoard({ topics: { x: T('append', ['a'], ['b'], { maxEventsPerWriter: 101 }) } }), 'BOARD_DECL');
  throwsCode(() => defineBoard({ topics: { x: T('append', ['a'], ['b'], { schema: { type: 'no-such-type' } }) } }), 'BOARD_DECL');
  throwsCode(() => defineBoard({ topics: { x: T('append', ['a'], ['b'], { label: 'semi-trusted' }) } }), 'CONTEXT_LABEL');
  // Every single event must fit one page of its view, or paging could not make progress.
  throwsCode(() => defineBoard({ topics: { x: T('append', ['a'], ['b'], { maxEventBytes: 8000, maxViewTokens: 2000 }) } }), 'BOARD_DECL');
  assert.ok(defineBoard({ topics: { x: T('counter', ['a'], ['b'], { maxEventBytes: 8000, maxViewTokens: 10 }) } }), 'a counter view is one number and is never paged');
  const a = defineBoard({ topics: { x: T('append', ['b', 'a'], ['c']) } }), b = defineBoard({ topics: { x: T('append', ['a', 'b'], ['c']) } });
  assert.equal(a.declHash, b.declHash, 'writer order does not change what the declaration means');
  assert.equal(a.topics.x.confidentiality, undefined, 'revision 2 has no confidentiality axis (deferred)');
});

test('every refusal is typed, changes no state and is kept for audit', () => {
  const decl = defineBoard({ topics: {
    log: T('append', ['w'], ['r'], { schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } }, maxEvents: 3, maxEventsPerWriter: 2, maxEventBytes: 64 }),
    kv: T('lww', ['w'], ['r'], { key: 'k' }), hi: T('max', ['w'], ['r']), n: T('counter', ['w'], ['r']), web: T('append', ['w'], ['r'], { label: 'untrusted:web' }) } });
  const b = new Board(decl, { runId: 'r' });
  assert.equal(b.write('w', 'log', { n: 1 }).ok, true);
  const head = b.head, seq = b.seq, root = b.root();
  const cases = [
    [['w', 'nope', { n: 1 }], 'BOARD_TOPIC'], [['w', 'toString', { n: 1 }], 'BOARD_TOPIC'], [['x', 'log', { n: 1 }], 'BOARD_WRITER'],
    [['w', 'log', { n: 'one' }], 'BOARD_SCHEMA'], [['w', 'log', { n: 1, pad: 'x'.repeat(80) }], 'BOARD_SIZE'],
    [['w', 'log', { n: 2 }, { label: 'untrusted:web' }], 'BOARD_LABEL'], [['w', 'web', {}, { label: 'untrusted:mail' }], 'BOARD_LABEL'],
    [['w', 'web', {}, { label: 'untrusted:mail+web' }], 'BOARD_LABEL'], [['w', 'log', { n: 2 }, { label: 'bogus' }], 'BOARD_LABEL'],
    [['w', 'hi', 'ten'], 'BOARD_VALUE'], [['w', 'n', 1.5], 'BOARD_VALUE'], [['w', 'log', { n: 2 }, { receipt: 'not a receipt' }], 'BOARD_VALUE'],
    [['w', 'log', { n: 2 }, { sources: 'event:1' }], 'BOARD_VALUE'],
    [['w', 'kv', { other: 1 }, { expectSeq: 0 }], 'BOARD_VALUE'], [['w', 'kv', { k: 'a' }], 'BOARD_STALE'], [['w', 'kv', { k: 'a' }, { expectSeq: 9 }], 'BOARD_STALE'],
  ];
  for (const [args, code] of cases) { const r = b.write(...args); assert.equal(r.ok, false, code); assert.equal(r.code, code, JSON.stringify(args)); }
  assert.equal(b.head, head); assert.equal(b.seq, seq); assert.equal(b.refusals.length, cases.length);
  assert.equal(b.root().statesHash, root.statesHash, 'a refusal leaves the fold state as it was');
  assert.equal(b.write('w', 'log', { n: 2 }).ok, true);
  assert.equal(b.write('w', 'log', { n: 3 }).code, 'BOARD_QUOTA');            // per-writer quota 2
  assert.equal(b.write('w', 'web', {}, { label: 'untrusted:web' }).ok, true);   // a topic admits its own sources
  assert.ok(b.verify());
  const full = new Board(defineBoard({ topics: { t: T('append', ['a', 'b'], ['r'], { maxEvents: 2 }) } }), { runId: 'r' });
  full.write('a', 't', 1); full.write('b', 't', 2);
  assert.equal(full.write('a', 't', 3).code, 'BOARD_FULL');
});

test('labels come from the kernel, never from the data, and a view joins every source', () => {
  const b = new Board(defineBoard({ topics: { p: T('lww', ['f'], ['payer'], { key: 'vendor', label: 'untrusted:web' }) } }), { runId: 'r' });
  b.write('f', 'p', { vendor: 'acme', iban: 'X', label: 'trusted', security_label: { integrity: 'trusted', confidentiality: 'public' } }, { label: 'untrusted:web', expectSeq: 0 });
  assert.equal(b.view('payer', 'p').label, 'untrusted:web');
  assert.ok(flowsTo('trusted', 'untrusted:a') && flowsTo('untrusted:a', 'untrusted:a+b') && !flowsTo('untrusted:a+b', 'untrusted:a') && !flowsTo('untrusted:a', 'trusted'));
  // The view label is the join of every write in the topic, so an untrusted write keeps tainting the view after it is overwritten.
  const c = new Board(defineBoard({ topics: { p: T('lww', ['f', 'g', 'h'], ['r'], { key: 'k', label: 'untrusted:mail+web' }) } }), { runId: 'r' });
  c.write('f', 'p', { k: 1, v: 'web' }, { label: 'untrusted:web', expectSeq: 0 });
  c.write('h', 'p', { k: 2, v: 'mail' }, { label: 'untrusted:mail', expectSeq: 0 });
  c.write('g', 'p', { k: 1, v: 'policy' }, { expectSeq: 1 });
  assert.deepEqual(c.view('r', 'p').value, { 1: { k: 1, v: 'policy' }, 2: { k: 2, v: 'mail' } });
  assert.equal(c.view('r', 'p').label, 'untrusted:mail+web', 'both untrusted sources, not only the last one');
});

test('reads are declared and pinned; an over-cap view is paged fairly and never silently cut', () => {
  const b = new Board(defineBoard({ topics: { f: T('setUnion', ['e1', 'e2', 'flood'], ['lead'], { maxViewTokens: 200, maxEventBytes: 400 }) } }), { runId: 'r' });
  b.write('e1', 'f', { bug: 'a' }); b.write('e2', 'f', { bug: 'b' }); b.write('e1', 'f', { bug: 'a' });
  throwsCode(() => b.view('stranger', 'f'), 'BOARD_READER');
  throwsCode(() => b.readsFor('stranger', [{ topic: 'f' }]), 'BOARD_READER');
  throwsCode(() => b.view('lead', 'f', { atSeq: 4 }), 'BOARD_SEQ');
  assert.deepEqual(b.view('lead', 'f', { atSeq: 1 }).value, [{ bug: 'a' }]);
  assert.deepEqual(b.readsFor('lead', [{ topic: 'f' }]).inputs[0].value, [{ bug: 'a' }, { bug: 'b' }], 'within the cap: the whole view');
  for (let i = 0; i < 60; i++) b.write('flood', 'f', { bug: `junk-${i}` });       // the flood comes AFTER the honest findings
  const at = b.seq, first = b.readsFor('lead', [{ topic: 'f' }]);
  const page = first.inputs[0].value;
  assert.ok(Array.isArray(page.page) && page.page.some(v => v.bug === 'a') && page.page.some(v => v.bug === 'b'), 'each writer gets its share of the first page');
  assert.ok(page.omitted.flood > 0 && page.omitted.e1 === undefined, 'the page says what it left out, per writer');
  assert.ok(compileContext({ node, inputs: first.inputs }).receipt.inputs[0].tokens <= 200, 'a page fits its cap');
  assert.match(first.inputs[0].sourceRef, new RegExp(`^board:f@${at}#`));
  // Following `next` reaches every item exactly once, at the same pinned seq, even while writes continue.
  const seen = [...page.page]; let next = page.next, reads = 1;
  b.write('e2', 'f', { bug: 'late' });
  while (next) { const p = b.readsFor('lead', [{ topic: 'f', cursor: next }], { atSeq: at }).inputs[0].value; seen.push(...p.page); next = p.next; reads++; }
  assert.equal(seen.length, 62); assert.equal(new Set(seen.map(canonical)).size, 62); assert.ok(!seen.some(v => v.bug === 'late'));
  assert.ok(reads > 1);
  throwsCode(() => b.readsFor('lead', [{ topic: 'f', cursor: { ghost: 1 } }]), 'BOARD_CURSOR');
  throwsCode(() => b.readsFor('lead', [{ topic: 'f', cursor: { flood: 999 } }]), 'BOARD_CURSOR');
  // The same flood written FIRST gives the same first page: fairness does not depend on write order.
  const c = new Board(defineBoard({ topics: { f: T('setUnion', ['e1', 'e2', 'flood'], ['lead'], { maxViewTokens: 200, maxEventBytes: 400 }) } }), { runId: 'r' });
  for (let i = 0; i < 60; i++) c.write('flood', 'f', { bug: `junk-${i}` });
  c.write('e1', 'f', { bug: 'a' }); c.write('e2', 'f', { bug: 'b' });
  const cp = c.readsFor('lead', [{ topic: 'f' }]).inputs[0].value.page;
  assert.ok(cp.some(v => v.bug === 'a') && cp.some(v => v.bug === 'b'));
  // A max or counter view cannot be paged; one over its cap is refused.
  const m = new Board(defineBoard({ topics: { hi: T('max', ['w'], ['r'], { maxViewTokens: 1, maxEventBytes: 16 }) } }), { runId: 'r' });
  m.write('w', 'hi', 123456789);
  throwsCode(() => m.readsFor('r', [{ topic: 'hi' }]), 'BOARD_VIEW_BUDGET');
});

test('fair paging: the per-writer share, then round-robin, with a stated bound', () => {
  const topic = defineBoard({ topics: { f: T('append', ['a', 'b', 'c'], ['r'], { maxViewTokens: 400, maxEventBytes: 1000 }) } }).topics.f;
  const state = { reducer: 'append', items: [] }; let seq = 0;
  for (let i = 0; i < 40; i++) state.items.push({ seq: ++seq, writer: 'a', value: { a: i, pad: 'x'.repeat(40) } });
  state.items.push({ seq: ++seq, writer: 'b', value: { b: 0 } }, { seq: ++seq, writer: 'c', value: { c: 0, pad: 'y'.repeat(200) } });
  const p = fairPage(state, topic, 400).value;
  assert.ok(p.page.some(v => v.b === 0) && p.page.some(v => v.c === 0), 'b and c are on the page although a wrote 40 items first');
  const used = p.page.reduce((n, v) => n + Math.ceil(Buffer.byteLength(canonical(v)) / 4) + 1, 0);
  assert.ok(used > 400 - topic.frameTokens - 20, `the unused share of b goes to the others in round-robin (page uses ${used} tokens)`);
  assert.deepEqual(Object.keys(p.omitted), ['a']);
});

test('a board read compiles to a byte-identical prompt on replay, and a tampered log does not replay', () => {
  const decl = defineBoard({ topics: { f: T('setUnion', ['e1', 'e2'], ['reader', 'e2']), c: T('lww', ['e1', 'e2'], ['reader'], { key: 'region' }) } });
  const b = new Board(decl, { runId: 'r' });
  b.write('e1', 'f', { bug: 'crash' }, { sources: ['env:t1'] }); b.view('e2', 'f'); b.write('e2', 'c', { region: 'f1', by: 'e2' }, { expectSeq: 0 });
  const at = b.seq; b.write('e2', 'f', { bug: 'softlock' });
  assert.deepEqual(b.events.at(-1).sources, [`board:f@1`], 'the kernel recorded what e2 had read');
  const compile = board => compileContext({ node, inputs: board.readsFor('reader', [{ topic: 'f' }, { topic: 'c', as: 'claims' }], { atSeq: at }).inputs });
  const first = compile(b), again = compile(Board.replay(decl, { runId: 'r', events: b.events }));
  assert.equal(first.prompt, again.prompt); assert.equal(first.receiptHash, again.receiptHash);
  assert.deepEqual(first.receipt.inputs.map(i => i.sourceRef), [`board:f@${at}`, `board:c@${at}`]);
  assert.ok(!first.prompt.includes('softlock'), 'a write after the pinned seq is invisible');
  const edited = b.events.map(e => e.seq === 1 ? { ...e, value: { bug: 'forged' } } : e);
  throwsCode(() => Board.replay(decl, { runId: 'r', events: edited }), 'REPLAY_DIVERGENCE');
  const unsourced = b.events.map(e => e.seq === 3 ? { ...e, sources: [] } : e);
  throwsCode(() => Board.replay(decl, { runId: 'r', events: unsourced }), 'REPLAY_DIVERGENCE');
  b.events[0].value = { bug: 'forged' };
  assert.equal(b.verify(), false, 'editing an event in place breaks the chain');
});

test('verify() re-derives the fold state and checks the checkpoint; root() binds the state', () => {
  const decl = defineBoard({ topics: { f: T('append', ['w'], ['r'], { label: 'untrusted:web' }), k: T('lww', ['w'], ['r'], { key: 'id' }) } });
  const fresh = () => { const b = new Board(decl, { runId: 'r' }); b.write('w', 'f', { a: 1 }, { label: 'untrusted:web' }); b.write('w', 'k', { id: 'x' }, { expectSeq: 0 }); return b; };
  const a = fresh(); assert.ok(a.verify());
  a.states.f.labels = [];                                                     // launder the view label in place
  assert.equal(a.view('r', 'f').label, 'trusted'); assert.equal(a.verify(), false);
  const q = fresh(); q.states.f.perWriter.w = 0; assert.equal(q.verify(), false, 'a reset quota counter is caught');
  const c = fresh(); c.compact(); c.write('w', 'f', { a: 2 }, { label: 'untrusted:web' }); assert.ok(c.verify());
  c.checkpoint.states.f.labels = []; assert.equal(c.verify(), false, 'an edited checkpoint is caught');
  const d = fresh(), e = fresh();
  assert.equal(canonical(d.root()), canonical(e.root()));
  assert.ok(d.root().statesHash && d.root().checkpoint === null);
  d.compact(); assert.equal(d.root().checkpoint.base, 2);
  const l = fresh(); l.lineage.set(1, { topic: 'f', writer: 'w', sources: ['env:other'] }); assert.equal(l.verify(), false, 'provenance must match the events');
});

test('fold compaction keeps every view, label, quota, version and ancestry (property test over random logs)', () => {
  const rand = prng(11);
  for (let trial = 0; trial < 40; trial++) {
    const decl = defineBoard({ topics: { a: T('append', ['w1', 'w2'], ['r'], { maxEventsPerWriter: 30, label: 'untrusted:web' }), l: T('lww', ['w1', 'w2'], ['r'], { key: 'k' }),
      s: T('setUnion', ['w1', 'w2'], ['r']), m: T('max', ['w1', 'w2'], ['r']), n: T('counter', ['w1', 'w2'], ['r']) } });
    const live = new Board(decl, { runId: 'r' }), compacted = new Board(decl, { runId: 'r' });
    const ops = [];
    for (let i = 0; i < 40; i++) {
      const w = rand() < 0.5 ? 'w1' : 'w2', t = ['a', 'l', 's', 'm', 'n'][Math.floor(rand() * 5)], k = Math.floor(rand() * 3);
      const value = t === 'a' ? { i } : t === 'l' ? { k: `k${k}`, i } : t === 's' ? { v: k } : t === 'm' ? Math.floor(rand() * 100) : Math.floor(rand() * 10) - 5;
      ops.push([w, t, value, t === 'a' && rand() < 0.3 ? 'untrusted:web' : 'trusted', rand() < 0.2 ? [`event:${1 + Math.floor(rand() * (i + 1))}`] : []]);
    }
    const cut = 1 + Math.floor(rand() * 39);
    ops.forEach(([w, t, value, label, sources], i) => {
      for (const b of [live, compacted]) b.write(w, t, value, { label, sources, ...(t === 'l' ? { expectSeq: b.version('l', value.k) } : {}) });
      if (i + 1 === cut) compacted.compact();
    });
    assert.equal(compacted.head, live.head); assert.ok(compacted.verify());
    for (const t of ['a', 'l', 's', 'm', 'n']) for (const atSeq of [compacted.base, live.seq]) {
      if (atSeq > live.seq) continue;
      assert.deepEqual(compacted.view('r', t, { atSeq }), live.view('r', t, { atSeq }), `trial ${trial} topic ${t} at ${atSeq}`);
    }
    if (compacted.base > 0) throwsCode(() => compacted.view('r', 'a', { atSeq: compacted.base - 1 }), 'BOARD_COMPACTED');
    for (const k of ['k0', 'k1', 'k2']) assert.equal(compacted.version('l', k), live.version('l', k));
    for (let s = 1; s <= live.seq; s++) assert.deepEqual(compacted.ancestry(s), live.ancestry(s), 'ancestry survives compaction');
  }
  // Quotas survive compaction: a writer cannot reset its quota by triggering one.
  const q = new Board(defineBoard({ topics: { f: T('append', ['m'], ['r'], { maxEventsPerWriter: 3 }) } }), { runId: 'r' });
  q.write('m', 'f', 1); q.write('m', 'f', 2); q.compact(); q.write('m', 'f', 3);
  assert.equal(q.write('m', 'f', 4).code, 'BOARD_QUOTA');
});

test('an echo is not a second source, however its provenance is stated; independent supporters are', () => {
  const decl = defineBoard({ topics: { f: T('setUnion', ['e1', 'e2', 'e3'], ['lead', 'e2', 'e3']), notes: T('append', ['e2'], ['lead', 'e3']) } });
  const claim = { bug: 'door_bypass' };
  // Declared provenance, transitive through another topic (v1 behaviour, kept).
  const b = new Board(decl, { runId: 'r' });
  const s1 = b.write('e1', 'f', claim, { sources: ['input:forum-17'] }).seq;
  const s2 = b.write('e2', 'notes', { saw: claim }, { sources: [`event:${s1}`] }).seq;
  b.write('e3', 'f', claim, { sources: [`event:${s2}`] });
  b.write('e1', 'f', claim, { sources: ['env:trace-2'] });                                 // the same writer again
  assert.deepEqual(b.independentSupport('lead', 'f', claim), { supporters: 3, independent: 1, echoes: 2 });
  b.write('e2', 'f', claim, { sources: ['env:trace-9'] });                                 // a genuinely independent reproduction
  assert.equal(b.independentSupport('lead', 'f', claim).independent, 2);
  // Omitted provenance: e2 READ the claim through the board, then posts it declaring nothing (review probe P2).
  const o = new Board(decl, { runId: 'r' });
  o.write('e1', 'f', claim, { sources: ['input:forum-17'] }); o.readsFor('e2', [{ topic: 'f' }]); o.write('e2', 'f', claim);
  assert.equal(o.independentSupport('lead', 'f', claim).independent, 1);
  // Transitive through a read of another topic: e3 read e2's note (which e2 wrote after reading the claim).
  const t = new Board(decl, { runId: 'r' });
  t.write('e1', 'f', claim); t.view('e2', 'f'); t.write('e2', 'notes', { saw: 'something' }); t.view('e3', 'notes'); t.write('e3', 'f', claim);
  assert.equal(t.independentSupport('lead', 'f', claim).independent, 1);
  // Receipt form, self-declared (review probe P2b) and from a context receipt the writer presents.
  const r = new Board(decl, { runId: 'r' });
  r.write('e1', 'f', claim); r.write('e2', 'f', claim, { sources: ['board:f@1'] });
  assert.equal(r.independentSupport('lead', 'f', claim).independent, 1);
  const rc = new Board(decl, { runId: 'r' });
  rc.write('e1', 'f', claim);
  const receipt = compileContext({ node, inputs: rc.readsFor('e3', [{ topic: 'f' }]).inputs }).receipt;
  rc.reads.length = 0;                                                                     // only the receipt is left to tell
  rc.write('e2', 'f', claim, { receipt });
  assert.deepEqual(rc.events.at(-1).sources, ['board:f@1']);
  assert.equal(rc.independentSupport('lead', 'f', claim).independent, 1);
  // A common external source: two posts of the same forum item are one source.
  const c = new Board(decl, { runId: 'r' });
  c.write('e1', 'f', claim, { sources: ['input:forum-17'] }); c.write('e2', 'f', claim, { sources: ['input:forum-17'] });
  assert.equal(c.independentSupport('lead', 'f', claim).independent, 1);
  // A read at seq 0 saw nothing and adds no ancestry; a declared source never removes a derived one.
  const z = new Board(decl, { runId: 'r' });
  z.view('e2', 'f'); z.write('e1', 'f', claim, { sources: ['env:a'] }); z.write('e2', 'f', claim, { sources: ['env:b'] });
  assert.equal(z.independentSupport('lead', 'f', claim).independent, 2);
  // The count is a read: an undeclared reader is refused.
  throwsCode(() => b.independentSupport('stranger', 'f', claim), 'BOARD_READER');
});

test('the prototype is not part of the engine identity (no engine hash change, no runtime wiring)', () => {
  const engine = readFileSync(new URL('../../../src/engine.mjs', import.meta.url), 'utf8'), runtime = readFileSync(new URL('../../../src/runtime.mjs', import.meta.url), 'utf8');
  assert.ok(!/memory|board\.mjs/.test(engine.match(/const paths = \[[^\]]*\]/s)[0]));
  assert.ok(!runtime.includes('experiments/memory'));
});
