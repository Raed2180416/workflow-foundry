// Bed-side M1 (ATTACK-20261014 §3; PROOF-LEDGER K3, K4): the metamorphic relations and witness tags declared beside the
// oracles of records, kinetics and W-bed R1-R5. $0, no model calls. What is pinned:
//   - the contract (ids, kinds, distributions, make/check) and determinism (same seed, same variant);
//   - every variant is the task re-rendered (same lines in another order, one line copied or removed, prompt counts kept
//     true) and never reads the hidden world;
//   - each relation holds for a correct solver where an input-only correct solver exists (records' text solver, every
//     relation; the kinetics white-box parser, the in-distribution relations), and the measured blind spots stay measured
//     (records ablations invisible; kinetics shuffle-samples flags an ordinal shortcut in a right answer);
//   - each witness check passes the reference answer and fires on what it is built to see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WITNESS_TAGS, permute, shuffleRuns, rngOf, compareKeyed, numClose } from './metamorphic.mjs';
import * as records from '../records/index.mjs';
import * as kinetics from '../kinetics/index.mjs';
import * as r1 from '../wbed/r1/index.mjs';
import * as r2 from '../wbed/r2/index.mjs';
import * as r3 from '../wbed/r3/index.mjs';
import * as r4 from '../wbed/r4/index.mjs';
import * as r5 from '../wbed/r5/index.mjs';
import { solveText, ABLATIONS } from '../records/solve-text.mjs';
import { rowClassOf } from '../kinetics/invariance.mjs';
import { heuristicSolve as whitebox } from '../kinetics/attacks/whitebox-v4.mjs';

const BEDS = { records, kinetics, 'wbed-r1': r1, 'wbed-r2': r2, 'wbed-r3': r3, 'wbed-r4': r4, 'wbed-r5': r5 };
const sortedLines = text => String(text).split('\n').filter(l => l.trim()).sort();
const rel = (bed, id) => bed.invariance.find(r => r.id === id);

test('helpers: permute never returns the identity for distinct items; shuffleRuns keeps classes and non-rows in place; compareKeyed and numClose', () => {
  const r = rngOf('s');
  for (let i = 0; i < 50; i++) { const p = permute([1, 2], r); assert.deepEqual(p, [2, 1]); }
  assert.deepEqual(permute([7], r), [7]);
  const lines = ['h', 'a1', 'a2', 'a3', 'x', 'b1', 'b2', 'c1'];
  const cls = l => (/^a/.test(l) ? 'a' : /^[bc]/.test(l) ? l[0] : null);
  const s = shuffleRuns(lines, cls, rngOf('t'));
  assert.deepEqual([s.lines[0], s.lines[4], s.lines[7]], ['h', 'x', 'c1'], 'non-rows and runs of one stay');
  assert.deepEqual(s.lines.slice(1, 4).sort(), ['a1', 'a2', 'a3']); assert.deepEqual(s.lines.slice(5, 7).sort(), ['b1', 'b2']);
  assert.equal(s.runs, 2);
  const v = compareKeyed([{ id: 1, x: 1 }, { id: 2, x: 2 }], [{ id: 1, x: 9 }, { id: 3, x: 3 }], 'id', (e, g) => (e.x === g.x ? [] : [{ level: 'fields' }]));
  assert.deepEqual(v.map(x => x.level), ['entity-set', 'fields']);
  assert.ok(numClose(1, 1 + 1e-9, 1e-6) && !numClose(1, 1.001, 1e-6) && numClose(0, 1e-13, 0, 1e-12));
});

test('every bed declares a valid relation list and witness tag (records, kinetics, W-bed R1-R5)', () => {
  for (const [id, bed] of Object.entries(BEDS)) {
    assert.ok(Array.isArray(bed.invariance), `${id}: invariance list`);
    for (const r of bed.invariance) {
      assert.ok(typeof r.id === 'string' && typeof r.make === 'function' && typeof r.check === 'function', `${id}.${r.id}`);
      assert.ok(['invariant', 'transform'].includes(r.kind) && ['in', 'out'].includes(r.distribution), `${id}.${r.id} kind/distribution`);
    }
    assert.ok(WITNESS_TAGS.includes(bed.witness.primary), `${id}: primary tag`);
    assert.ok(bed.witness.tags.every(t => WITNESS_TAGS.includes(t)));
    assert.equal(typeof bed.witnessOf, 'function'); assert.equal(typeof bed.witnessCheck, 'function');
  }
  assert.deepEqual(Object.fromEntries(Object.entries(BEDS).map(([id, b]) => [id, b.witness.primary])),
    { records: 'none', kinetics: 'exclusion-set', 'wbed-r1': 'conservation', 'wbed-r2': 'count', 'wbed-r3': 'conservation', 'wbed-r4': 'conservation', 'wbed-r5': 'hash-total' });
  assert.deepEqual(records.invariance.map(r => r.id), ['shuffle-rows', 'duplicate-row', 'drop-singleton']);
  assert.deepEqual(kinetics.invariance.map(r => r.id), ['shuffle-samples', 'shuffle-series', 'shuffle-documents']);
  assert.deepEqual(r1.invariance.map(r => r.id), ['shuffle-customer-rows', 'shuffle-invoice-lines', 'shuffle-bank-feed', 'duplicate-row', 'drop-idle-singleton']);
  assert.deepEqual(r3.invariance.map(r => r.id), ['shuffle-statement-files', 'shuffle-ledger-lines', 'drop-clean-supplier']);
  for (const b of [r2, r4, r5]) assert.deepEqual(b.invariance, []);
});

test('records: variants are re-renderings (permutation, one copied line, one removed line), deterministic, with the prompt kept true', () => {
  const t = records.generate({ seed: 204, split: 'dev', difficulty: 3 }), o = solveText(t), n = sortedLines(t.inputs.export).length;
  const sh = rel(records, 'shuffle-rows').make(t, { seed: 'a' });
  assert.deepEqual(sortedLines(sh.task.inputs.export), sortedLines(t.inputs.export));
  assert.notEqual(sh.task.inputs.export, t.inputs.export);
  assert.match(sh.task.prompt, /in no particular order/); assert.doesNotMatch(sh.task.prompt, /ordered by row id/);
  assert.deepEqual(rel(records, 'shuffle-rows').make(t, { seed: 'a' }), sh, 'same seed, same variant');
  assert.equal(sh.task.seed, t.seed); assert.equal(sh.task.id, t.id);
  const dup = rel(records, 'duplicate-row').make(t, { seed: 'a', output: o });
  const lines = dup.task.inputs.export.split('\n'), ids = lines.map(l => Number(l.match(/\d+/)[0]));
  assert.equal(lines.length, n + 1); assert.match(dup.task.prompt, new RegExp(`holds ${n + 1} rows`));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'the copy sits in row-id order');
  assert.equal(new Set(ids).size, ids.length, 'the new id is unused');
  assert.equal(String(dup.info.newId).length, String(Math.max(...ids.filter(x => x !== dup.info.newId))).length);
  const owner = o.records.find(r => r.source_rows.includes(dup.info.rowId));
  assert.ok(!owner || owner.source_rows.length >= 2, 'only rows of multi-row people or void rows are copied');
  if (owner) assert.ok(dup.info.newId > owner.entity_id);
  const drop = rel(records, 'drop-singleton').make(t, { seed: 'a', output: o });
  assert.equal(drop.task.inputs.export.split('\n').length, n - 1); assert.match(drop.task.prompt, new RegExp(`holds ${n - 1} rows`));
  assert.equal(o.records.find(r => r.entity_id === drop.info.entity).source_rows.length, 1);
  assert.deepEqual(rel(records, 'drop-singleton').make(t, { seed: 'a', output: { records: [] } }), { skip: 'the original answer has no single-row person' });
});

test('records: every relation holds for the input-only text solver (d3-d5); the checks see planted differences; single-judgment ablations stay invisible (the M1 kill mode)', () => {
  let n = 0;
  for (const d of [3, 4, 5]) for (const seed of [201, 207, 214, 218]) {
    const t = records.generate({ seed, split: 'dev', difficulty: d }), o = solveText(t);
    assert.ok(records.oracle(t, o).pass);
    for (const r of records.invariance) for (const k of [0, 1]) {
      const m = r.make(t, { seed: `t${k}`, output: o });
      if (m.skip) continue;
      assert.deepEqual(r.check(o, solveText(m.task), m.info), [], `${r.id} d${d} s${seed} k${k}`); n++;
    }
  }
  assert.ok(n >= 70);
  const t = records.generate({ seed: 204, split: 'dev', difficulty: 3 }), o = solveText(t), sh = rel(records, 'shuffle-rows');
  const bad = structuredClone(o); bad.records[0].amount_usd += 1; bad.records.pop();
  assert.deepEqual([...new Set(sh.check(o, bad, {}).map(v => v.level))].sort(), ['entity-set', 'fields']);
  assert.deepEqual(sh.check(o, { nope: 1 }, {}), [{ level: 'shape', which: 'variant', why: 'no records list' }]);
  // Measured negative (eval-invariance part B): a convention misread is the same on every variant.
  for (const a of ['bd-flipped', 'atlas-flipped', 'perspective-ignored', 'no-phone-link', 'keep-void']) {
    assert.ok(ABLATIONS.includes(a));
    const w = solveText(t, { ablate: a });
    assert.equal(records.oracle(t, w).pass, false, a);
    for (const r of records.invariance) { const m = r.make(t, { seed: 'k', output: w }); if (!m.skip) assert.deepEqual(r.check(w, solveText(m.task, { ablate: a }), m.info), [], `${a} ${r.id}`); }
  }
});

test('kinetics: row classes, shuffles move only table rows, shuffle-series keeps every plate row in order; the white-box parser pins the in/out distinction', () => {
  assert.equal(rowClassOf('| TV-0630 | A04 | 0.25 | 24.47 |  |'), 'pipe');
  assert.equal(rowClassOf('|---|---|---|---|---|'), null);
  assert.equal(rowClassOf('A02   TV-0573    2000000 nM    298.6           36.9   '), 'reader');
  assert.equal(rowClassOf('11     D02   TV-0827    0.7130        0.9942  21   '), 'raw');
  assert.equal(rowClassOf('  [S] = 12000: r4 1.175E-01 (TV-0868; corner well)'), 'grouped');
  assert.equal(rowClassOf('TV-0844,11,E04,pH 9.0 / 25 °C,2,12,0.02309,13:56:11,'), 'delim');
  assert.equal(rowClassOf('[2031-03-04 08:13] Ana Okafor: Nadia, about TV-0844'), null);
  const t = kinetics.generate({ seed: 204, split: 'dev', difficulty: 4 });
  for (const id of ['shuffle-samples', 'shuffle-series']) {
    const m = rel(kinetics, id).make(t, { seed: 'a' });
    assert.ok(!m.skip, id);
    t.inputs.documents.forEach((d, i) => assert.deepEqual(sortedLines(m.task.inputs.documents[i].text), sortedLines(d.text), `${id} ${d.doc_id}: same lines`));
    assert.ok(m.task.inputs.documents.some((d, i) => d.text !== t.inputs.documents[i].text), `${id} changes something`);
  }
  // shuffle-series: each plate row's study wells keep their relative order in every document.
  const m = rel(kinetics, 'shuffle-series').make(t, { seed: 'b' });
  const order = text => { const by = new Map(); for (const l of text.split('\n')) { const id = l.match(/\b[A-Z]{2}-\d{4}\b/)?.[0], c = rowClassOf(l); if (id && c) { const k = `${c}`; if (!by.has(k)) by.set(k, []); by.get(k).push(id); } } return by; };
  t.inputs.documents.forEach((d, i) => {
    const before = order(d.text), after = order(m.task.inputs.documents[i].text);
    for (const [c, ids] of before) { const pos = new Map(after.get(c).map((x, j) => [x, j])); for (let j = 1; j < ids.length; j++) if (Number(ids[j].slice(3)) === Number(ids[j - 1].slice(3)) + 1) assert.ok(pos.get(ids[j]) > pos.get(ids[j - 1]), `${d.doc_id} ${ids[j - 1]} before ${ids[j]}`); }
  });
  const docs = rel(kinetics, 'shuffle-documents').make(t, { seed: 'a' });
  assert.deepEqual(docs.task.inputs.documents.map(d => d.doc_id).sort(), t.inputs.documents.map(d => d.doc_id).sort());
  // The white-box parser (input-only, right on most d3 tasks): the in-distribution series shuffle never moves a right answer;
  // the row shuffle flags d3 s201, whose chat names "the first study well (counting from the left) of plate 5, row A".
  let right = 0;
  for (const seed of [201, 202, 203, 206, 210]) {
    const tk = kinetics.generate({ seed, split: 'dev', difficulty: 3 }), o = whitebox(structuredClone(tk));
    if (!kinetics.oracle(tk, o).pass) continue;
    right++;
    const ms = rel(kinetics, 'shuffle-series').make(tk, { seed: 'k' });
    if (!ms.skip) assert.deepEqual(rel(kinetics, 'shuffle-series').check(o, whitebox(structuredClone(ms.task)), ms.info), [], `series s${seed}`);
  }
  assert.ok(right >= 3);
  const t201 = kinetics.generate({ seed: 201, split: 'dev', difficulty: 3 }), o201 = whitebox(structuredClone(t201));
  assert.ok(kinetics.oracle(t201, o201).pass);
  const ms = rel(kinetics, 'shuffle-samples').make(t201, { seed: 'k201:0' });
  const v = rel(kinetics, 'shuffle-samples').check(o201, whitebox(structuredClone(ms.task)), ms.info);
  assert.ok(v.some(x => x.level === 'exclusion-set'), 'an ordinal well reference read as a table position');
  // compare: exact exclusion set, fits within relTol.
  const c = rel(kinetics, 'shuffle-series').check;
  const near = structuredClone(o201); near.conditions[0].vmax *= 1 + 1e-9;
  assert.deepEqual(c(o201, near, {}), []);
  near.conditions[0].vmax *= 1.01; near.excluded_samples = near.excluded_samples.slice(1);
  assert.deepEqual(c(o201, near, {}).map(x => x.level), ['exclusion-set', 'fit']);
  assert.deepEqual(c(o201, near, {}, { relTol: 0.05 }).map(x => x.level), ['exclusion-set']);
});

test('W-bed R1 and R3: variants are re-renderings; transforms agree with themselves on the reference; checks see planted differences', () => {
  const t = r1.generate({ seed: 301, split: 'dev', difficulty: 3 }), ref = r1.referenceSolve(t);
  const cust = rel(r1, 'shuffle-customer-rows').make(t, { seed: 'a' });
  assert.deepEqual(sortedLines(cust.task.inputs.customer_export), sortedLines(t.inputs.customer_export));
  const inv = rel(r1, 'shuffle-invoice-lines').make(t, { seed: 'a' });
  for (const [sys, text] of Object.entries(t.inputs.invoices)) {
    assert.deepEqual(sortedLines(inv.task.inputs.invoices[sys]), sortedLines(text), sys);
    if (!/\d/.test(text.split('\n')[0])) assert.equal(inv.task.inputs.invoices[sys].split('\n')[0], text.split('\n')[0], `${sys} header kept`);
  }
  const feed = rel(r1, 'shuffle-bank-feed').make(t, { seed: 'a' });
  assert.equal(feed.task.inputs.payments.split('\n')[0], t.inputs.payments.split('\n')[0]);
  assert.deepEqual(sortedLines(feed.task.inputs.payments), sortedLines(t.inputs.payments));
  const dup = rel(r1, 'duplicate-row').make(t, { seed: 'a', output: ref });
  assert.ok(!JSON.stringify(t.inputs.invoices).includes(String(dup.info.newId)) && !t.inputs.payments.includes(String(dup.info.newId)), 'no list mentions the new id');
  assert.match(dup.task.prompt, new RegExp(`holds ${sortedLines(t.inputs.customer_export).length + 1} customer rows`));
  const expectDup = structuredClone(ref); const c = expectDup.customers.find(x => x.source_rows.includes(dup.info.rowId)); if (c) c.source_rows.push(dup.info.newId);
  assert.deepEqual(rel(r1, 'duplicate-row').check(ref, expectDup, dup.info), []);
  assert.ok(rel(r1, 'duplicate-row').check(ref, ref, dup.info).length > 0 || !c, 'the copied row must join its customer');
  const drop = rel(r1, 'drop-idle-singleton').make(t, { seed: 'a', output: ref });
  assert.ok(!drop.skip);
  const gone = structuredClone(ref); gone.customers = gone.customers.filter(x => x.customer_id !== drop.info.customer); gone.totals.customers--;
  assert.deepEqual(rel(r1, 'drop-idle-singleton').check(ref, gone, drop.info), []);
  assert.deepEqual(rel(r1, 'shuffle-bank-feed').check(ref, gone, {}).map(x => x.level).sort(), ['entity-set', 'totals']);
  const t3 = r3.generate({ seed: 301, split: 'dev', difficulty: 3 }), a3 = r3.referenceSolve(t3);
  const files = rel(r3, 'shuffle-statement-files').make(t3, { seed: 'a' });
  assert.deepEqual(Object.keys(files.task.inputs.statements).sort(), Object.keys(t3.inputs.statements).sort());
  assert.notDeepEqual(Object.keys(files.task.inputs.statements), Object.keys(t3.inputs.statements));
  const led = rel(r3, 'shuffle-ledger-lines').make(t3, { seed: 'a' });
  assert.equal(led.task.inputs.ledger.split('\n')[0], t3.inputs.ledger.split('\n')[0]);
  assert.deepEqual(sortedLines(led.task.inputs.ledger), sortedLines(t3.inputs.ledger));
  const clean = rel(r3, 'drop-clean-supplier').make(t3, { seed: 'a', output: a3 });
  if (!clean.skip) {
    assert.equal(Object.keys(clean.task.inputs.statements).length, Object.keys(t3.inputs.statements).length - 1);
    assert.ok(!clean.task.inputs.vendors.includes(`${clean.info.vendor} |`));
    const exp = structuredClone(a3); exp.statements = exp.statements.filter(s => s.vendor_id !== clean.info.vendor); exp.totals.statements--;
    assert.deepEqual(rel(r3, 'drop-clean-supplier').check(a3, exp, clean.info), []);
  }
  const shuffled = structuredClone(a3); shuffled.statements.reverse(); shuffled.by_reason.reverse(); for (const s of shuffled.statements) s.discrepancies.reverse();
  assert.deepEqual(rel(r3, 'shuffle-ledger-lines').check(a3, shuffled, {}), [], 'order inside the answer does not matter');
  shuffled.statements[0].adjusted_balance_minor++;
  assert.deepEqual(rel(r3, 'shuffle-ledger-lines').check(a3, shuffled, {}).map(x => x.level), ['balances']);
});

test('witness checks: the reference answer passes on every bed; each check fires on what it is built to see (eval-invariance part C)', () => {
  for (const [id, bed] of Object.entries(BEDS)) for (const seed of [301, 302]) {
    const t = bed.generate({ seed, split: 'dev', difficulty: id === 'kinetics' ? 4 : 3 }), ctx = id === 'wbed-r5' ? { trailer: bed.dumpOf(t).trailer } : {};
    assert.deepEqual(bed.witnessCheck(t, bed.referenceSolve(t), ctx), [], `${id} s${seed}`);
  }
  const t1 = r1.generate({ seed: 301, split: 'dev', difficulty: 3 }), a1 = r1.referenceSolve(t1);
  const b1 = structuredClone(a1); b1.customers[0].open_usd_cents += 1;
  assert.ok(r1.witnessCheck(t1, b1).some(v => v.tag === 'conservation'));
  const t2 = r2.generate({ seed: 301, split: 'dev', difficulty: 3 }), a2 = r2.referenceSolve(t2);
  assert.ok(r2.witnessCheck(t2, { ...a2, routing: a2.routing.slice(1) }).some(v => v.tag === 'count'));
  const t3 = r3.generate({ seed: 301, split: 'dev', difficulty: 3 }), a3 = r3.referenceSolve(t3);
  const b3 = structuredClone(a3); b3.statements[0].ledger_balance_minor += 5;
  assert.ok(r3.witnessCheck(t3, b3).some(v => v.tag === 'conservation'));
  const t5 = r5.generate({ seed: 301, split: 'dev', difficulty: 3 }), a5 = r5.referenceSolve(t5), trailer = r5.dumpOf(t5).trailer;
  const b5 = structuredClone(a5); b5.dump.rows[0].amount_minor += 1;
  assert.ok(r5.witnessCheck(t5, b5, { trailer }).some(v => v.tag === 'hash-total'));
  assert.deepEqual(r5.witnessCheck(t5, b5), [], 'without a trailer the hash-total check is skipped');
  const tk = kinetics.generate({ seed: 301, split: 'dev', difficulty: 4 }), ak = kinetics.referenceSolve(tk);
  assert.ok(kinetics.witnessCheck(tk, { ...ak, conditions: ak.conditions.slice(1) }).length > 0);
  assert.deepEqual(records.witnessCheck(), []);
});
