// Oracle health for W-bed R2 "inbox router" (beds/CONTRACT.md rules; W-BED §2.2, §2.4, §3.2). Loaded by path; the
// registration shim beds/wbed-r2/index.mjs makes it loadable as family 'wbed-r2'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as bed from './index.mjs';
import { buildInbox } from './world.mjs';
import { keywordRoute } from './keyword.mjs';
import { canonical, sha256, estimateTokens } from '../lib/prng.mjs';
import { inlineRender, loadFamily } from '../../../experiments/lib/beds.mjs';
import { portableSchemaViolations } from '../../../src/schema-subset.mjs';
import { plan, runStub } from '../attacks/triviality.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => 301 + i);
const DS = [2, 3, 4, 5];
const applies = (c, d) => d >= (c.minDifficulty ?? 0);
const hashOf = t => sha256(canonical(t));
const task = (seed, d, split = 'dev') => bed.generate({ seed, split, difficulty: d });

test('exports the bed interface plus the W-specific exports', async () => {
  for (const k of ['family', 'outputSchema', 'generate', 'oracle', 'referenceSolve', 'badControls', 'necessityControls', 'version', 'difficulty', 'stages', 'structure', 'relations', 'composedOracle']) assert.ok(k in bed, k);
  assert.equal(bed.family.id, 'wbed-r2');
  assert.equal(bed.version, '1.0.0');
  assert.equal(bed.family.kind, 'oneshot');
  assert.deepEqual(bed.stages.map(s => s.id), ['split', 'route', 'read', 'post']);
  for (const s of bed.stages) for (const k of ['inputSchema', 'outputSchema', 'oracle', 'project']) assert.ok(s[k], `${s.id}.${k}`);
  assert.equal(bed.structure.shape, 'judged-branch');
  assert.ok(bed.structure.outline.length >= 5);
  const viaShim = await loadFamily('wbed-r2');
  assert.equal(viaShim.family.id, 'wbed-r2');
});

test('output schema and stage contracts are in the portable subset', () => {
  assert.deepEqual(portableSchemaViolations(bed.outputSchema), []);
  for (const s of bed.stages) assert.deepEqual(portableSchemaViolations(s.outputSchema), [], s.id);
});

test('generator is deterministic: same seed -> same task hash, also in a fresh process', () => {
  for (const d of DS) for (const seed of [301, 302, 350]) {
    const a = task(seed, d), b = task(seed, d);
    assert.equal(hashOf(a), hashOf(b));
    assert.notEqual(a.inputs, b.inputs);
  }
  const here = fileURLToPath(new URL('./index.mjs', import.meta.url));
  const code = `const m = await import(${JSON.stringify(here)}); const { canonical, sha256 } = await import(${JSON.stringify(fileURLToPath(new URL('../lib/prng.mjs', import.meta.url)))});`
    + `console.log(JSON.stringify([[301,3],[302,5],[303,2]].map(([s,d]) => sha256(canonical(m.generate({ seed: s, split: 'dev', difficulty: d }))))));`;
  const fresh = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(fresh, [[301, 3], [302, 5], [303, 2]].map(([s, d]) => hashOf(task(s, d))));
  assert.notEqual(hashOf(task(301, 3)), hashOf(task(301, 3, 'test')));
  assert.notEqual(hashOf(task(301, 3)), hashOf(task(302, 3)));
});

for (const d of DS) {
  test(`d${d}: referenceSolve passes; every bad and every necessity control fails on ${SEEDS.length} seeds`, () => {
    const controls = [...bed.badControls, ...bed.necessityControls].filter(c => applies(c, d));
    for (const seed of SEEDS) {
      const t = task(seed, d);
      const ref = bed.oracle(t, bed.referenceSolve(t));
      assert.ok(ref.pass, `reference fails seed ${seed}: ${JSON.stringify(ref.details).slice(0, 300)}`);
      assert.equal(ref.score, 1);
      for (const c of controls) {
        const r = bed.oracle(t, c.make(t));
        assert.equal(r.pass, false, `control ${c.name} passes seed ${seed} d${d}`);
        assert.ok(r.score < 1);
      }
    }
  });
}

test('controls: CONTRACT minimums, >= 12 plausible per difficulty, several relation controls; necessity controls drop the branch', () => {
  const names = bed.badControls.map(c => c.name);
  for (const n of ['empty', 'shuffled-or-corrupted', 'keyword-router']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
  for (const d of DS) assert.ok(bed.badControls.filter(c => applies(c, d)).length >= 12, `d${d}`);
  assert.ok(bed.badControls.filter(c => c.kind === 'relation').length >= 6);
  const nec = bed.necessityControls.map(c => c.name);
  for (const n of ['one-handler:invoice', 'one-handler:remittance', 'one-handler:dispute', 'one-handler:ignore', 'no-escalation', 'review-everything']) assert.ok(nec.includes(n), n);
  // A one-handler solver routes every document to one kind: no branch at all.
  const t = task(301, 3);
  for (const c of bed.necessityControls.filter(x => x.name.startsWith('one-handler:'))) assert.equal(new Set(c.make(t).routing.map(x => x.kind)).size, 1, c.name);
});

test('relation controls pass every stage oracle and the post stage\'s local checks but fail a cross-stage relation', () => {
  const rel = bed.badControls.filter(c => c.kind === 'relation');
  for (const d of DS) for (const seed of SEEDS.slice(0, 6)) {
    const t = task(seed, d);
    for (const c of rel.filter(x => applies(x, d))) {
      const co = bed.composedOracle(t, c.trace(t));
      for (const [id, r] of Object.entries(co.stages)) assert.ok(r.pass, `${c.name} d${d} s${seed}: stage ${id} fails ${JSON.stringify(r.details).slice(0, 200)}`);
      assert.ok(Object.values(co.relations).some(r => !r.pass), `${c.name} d${d} s${seed}: no relation fails`);
      assert.equal(co.pass, false);
    }
  }
});

test('composed oracle (stage oracles AND relations) agrees with the end-to-end oracle on every trace', () => {
  for (const d of DS) for (const seed of SEEDS.slice(0, 5)) {
    const t = task(seed, d);
    const ref = bed.composedOracle(t, bed.referenceTrace(t));
    assert.ok(ref.pass, JSON.stringify(ref).slice(0, 400));
    for (const c of [...bed.badControls, ...bed.necessityControls].filter(x => x.trace && applies(x, d))) {
      const tr = c.trace(t);
      const co = bed.composedOracle(t, tr);
      assert.equal(co.pass, bed.oracle(t, tr.post).pass, `${c.name} d${d} s${seed}`);
      if (c.kind === 'stage') assert.ok(Object.values(co.stages).some(r => !r.pass), `${c.name}: some stage oracle must see a stage mistake`);
    }
  }
});

test('stage hand-offs of the reference trace satisfy their typed contracts; stage oracles pass on the truth', () => {
  for (const d of DS) {
    const t = task(311, d);
    const tr = bed.referenceTrace(t);
    for (const s of ['split', 'route', 'read', 'post']) assert.deepEqual(bed.CONTRACTS[s].check(tr[s]), [], `${s} d${d}`);
    assert.deepEqual(bed.CONTRACTS.input.check(t.inputs), []);
    for (const s of bed.stages) {
      assert.ok(s.oracle(s.project(t), tr[s.id]).pass, `${s.id} d${d}`);
      assert.equal(s.oracle(s.project(t), {}).pass, false, `${s.id} rejects an empty hand-off`);
    }
  }
});

test('oracle: schema-invalid and hostile outputs fail; exact on routing, entries, holds and review queue', () => {
  const t = task(305, 3);
  const ref = bed.referenceSolve(t);
  const bad = [null, 42, 'x', {}, { ...ref, routing: undefined }, { ...ref, entries: 'none' },
    { ...ref, entries: ref.entries.map((e, i) => (i ? e : { ...e, amount_minor: e.amount_minor + 0.5 })) },
    { ...ref, routing: ref.routing.map((x, i) => (i ? x : { ...x, kind: 'spam' })) }, new Proxy(ref, {})];
  for (const out of bad) assert.equal(bed.oracle(t, out).pass, false);
  // Order and reference spelling do not matter.
  const shuffled = structuredClone(ref);
  shuffled.routing.reverse(); shuffled.entries.reverse(); shuffled.holds.reverse(); shuffled.review_queue.reverse();
  for (const e of shuffled.entries) e.ref = e.ref.toLowerCase().replace(/-/g, ' ');
  assert.ok(bed.oracle(t, shuffled).pass);
  // One cent off, a document routed twice, a decidable document escalated, an undecidable one handled: all fail.
  const cent = structuredClone(ref); cent.entries[0].amount_minor += 1;
  assert.equal(bed.oracle(t, cent).pass, false);
  const twice = structuredClone(ref); twice.routing.push(twice.routing[0]);
  assert.equal(bed.oracle(t, twice).pass, false);
  const w = buildInbox(305, 'dev', 3);
  const decidable = w.docs.find(d => d.kind === 'unrelated');
  const esc = structuredClone(ref);
  esc.routing = esc.routing.map(x => (x.doc === decidable.id ? { ...x, kind: 'review' } : x)); esc.review_queue.push(decidable.id);
  assert.equal(bed.oracle(t, esc).pass, false);
  const und = w.docs.find(d => d.kind === 'review');
  const handled = structuredClone(ref);
  handled.routing = handled.routing.map(x => (x.doc === und.id ? { ...x, kind: 'unrelated' } : x)); handled.review_queue = handled.review_queue.filter(x => x !== und.id);
  assert.equal(bed.oracle(t, handled).pass, false);
});

test('hidden truth does not leak: no route labels, template ids or answers in prompt and inputs', () => {
  for (const d of DS) for (const seed of SEEDS) {
    const t = task(seed, d);
    const inbox = t.inputs.inbox;
    for (const s of ['credit_note', 'statement_request', 'bank_change', 'undecidable', 'decoy', 'hedged', 'firstReading', 'U1', 'U2', 'U3']) assert.ok(!inbox.includes(s), `d${d} s${seed}: ${s} in inbox`);
    const ref = bed.referenceSolve(t);
    assert.ok(!canonical(t).includes(canonical(ref.routing).slice(1, 60)), 'routing answer appears in the task');
    // Credit entries name OUR bill ids; a document never states the bill id it resolves to (except injections, which are not handled).
    const w = buildInbox(seed, 'dev', d);
    for (const e of ref.entries.filter(x => x.action === 'post_credit')) assert.ok(!w.docs.find(x => x.id === e.doc).body.includes(e.ref), `bill id ${e.ref} in its credit note`);
  }
});

test('judged conditions: the keyword rule misroutes a measured share of documents at every difficulty', t => {
  const shares = {};
  for (const d of DS) {
    let sum = 0, dec = 0;
    for (const seed of SEEDS) { const k = bed.keywordMisroute(task(seed, d)); sum += k.share; dec += k.decidableShare; }
    shares[d] = { all: +(sum / SEEDS.length).toFixed(3), decidable: +(dec / SEEDS.length).toFixed(3) };
    assert.ok(shares[d].all >= 0.3, `d${d}: keyword rule misroutes only ${shares[d].all}`);
    assert.ok(shares[d].decidable >= 0.25, `d${d}: on decidable documents only ${shares[d].decidable}`);
  }
  for (let d = 2; d < 5; d++) assert.ok(shares[d + 1].all > shares[d].all, 'drift raises the keyword failure share');
  t.diagnostic(`keyword-rule misroute share by difficulty: ${JSON.stringify(shares)}`);
  // Plain templates do carry the obvious cue: the rule is a fair baseline, not a straw man.
  let plainRight = 0, plain = 0;
  for (const seed of SEEDS) for (const doc of buildInbox(seed, 'dev', 3).docs.filter(x => x.variant === 'plain')) { plain++; if (keywordRoute(`${doc.subject}\n${doc.body}`) === doc.kind) plainRight++; }
  assert.ok(plainRight / plain >= 0.95, `plain documents routed right by keywords: ${plainRight}/${plain}`);
});

test('drift knob changes the task distribution measurably', () => {
  const feat = (seed, d) => {
    const w = buildInbox(seed, 'dev', d);
    return { docs: w.docs.length, bank: w.docs.filter(x => x.kind === 'bank_change').length, foreign: w.docs.filter(x => x.foreign).length,
      typo: w.docs.filter(x => x.refStyle === 'typo').length, review: w.docs.filter(x => x.kind === 'review').length,
      decoy: w.docs.filter(x => x.variant === 'decoy').length / w.docs.length, tokens: estimateTokens(inlineRender(task(seed, d))) };
  };
  const by = Object.fromEntries(DS.map(d => [d, SEEDS.map(s => feat(s, d))]));
  const mean = (d, k) => by[d].reduce((s, x) => s + x[k], 0) / by[d].length;
  for (const k of ['docs', 'tokens', 'review']) for (let d = 2; d < 5; d++) assert.ok(mean(d + 1, k) >= mean(d, k), `${k}: d${d + 1} >= d${d}`);
  assert.ok(mean(5, 'decoy') > mean(2, 'decoy'));
  assert.ok(by[2].every(x => x.bank === 0 && x.foreign === 0 && x.typo === 0));
  assert.ok(by[3].every(x => x.bank === 0 && x.foreign === 0 && x.typo >= 1), 'd3: mistyped references, no new kind');
  assert.ok(by[4].every(x => x.bank >= 1 && x.typo >= 1) && by[4].some(x => x.foreign > 0), 'd4: the bank_change kind and foreign-language suppliers');
  assert.ok(by[5].every(x => x.bank >= 1) && mean(5, 'foreign') > mean(4, 'foreign'));
});

test('token sizes: the inline task stays within records-like sizes (R2 is a judgment rung, not a size rung)', t => {
  const sizes = {};
  for (const d of DS) {
    const toks = SEEDS.map(s => estimateTokens(inlineRender(task(s, d))));
    sizes[d] = { min: Math.min(...toks), mean: Math.round(toks.reduce((a, b) => a + b, 0) / toks.length), max: Math.max(...toks) };
  }
  assert.ok(sizes[2].mean > 4000 && sizes[5].mean < 12000, JSON.stringify(sizes));
  assert.ok(sizes[3].mean >= 6000 && sizes[3].mean <= 15000, 'CONTRACT: level 3 about 6-15K tokens');
  t.diagnostic(`inline tokens (utf8/4) by difficulty: ${JSON.stringify(sizes)}`);
});

test('triviality driver plans R2 dry (no model call) and scores stubs through the oracle', async () => {
  const p = await plan({ rungs: ['r2'], seeds: [379, 380] });
  assert.equal(p[0].calls, 4);
  assert.match(p[0].necessity, /judged branch/);
  for (const x of await runStub(p, 'reference')) assert.equal(x.pass, x.n);
  for (const x of await runStub(p, 'one-handler:invoice')) assert.equal(x.pass, 0);
});

test('fault overlay: default generation is fault-free and requesting a fault throws in v1', () => {
  assert.equal(hashOf(bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: {} })), hashOf(task(301, 3)));
  assert.throws(() => bed.generate({ seed: 301, split: 'dev', difficulty: 3, faults: { f3: { at: 11 } } }), /not implemented/);
});

test('runtime: generate and oracle well under 2 s at difficulty 5', () => {
  const t0 = performance.now();
  const t = bed.generate({ seed: 389, split: 'test', difficulty: 5 });
  const t1 = performance.now();
  bed.oracle(t, bed.referenceSolve(t));
  assert.ok(t1 - t0 < 2000, `generate ${t1 - t0} ms`);
  assert.ok(performance.now() - t1 < 2000);
});
