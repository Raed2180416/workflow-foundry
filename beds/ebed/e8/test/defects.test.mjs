// E8 latent defects (E-BED §2.10, §9.5; defects.mjs, tools/defects-mine.mjs, ledger/latent-defects/). $0.
//   node --test beds/ebed/e8/test/defects.test.mjs        (about 20-40 s: re-executes one E0 rejection and one manifest)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitionMutants, HAND_CANDIDATES, armItemOf, mineOnWorld, prepareWorld, planReveal, defectManifest, scratchDir, removeDir, baseDigests, e0Cases, failing, PARAMS, TRANSITION_FILE } from '../defects.mjs';
import { generateWorld, oracleItem } from '../index.mjs';
import { gradeCase } from '../../oracle/grade.mjs';
import { canonical } from '../../../lib/canonical.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(here, '..', 'ledger', 'latent-defects');
const EVIDENCE = path.join(here, '..', 'ledger', 'mutants-20261015');
const index = existsSync(path.join(LEDGER, 'index.json')) ? JSON.parse(readFileSync(path.join(LEDGER, 'index.json'), 'utf8')) : null;
const manifests = existsSync(LEDGER) ? readdirSync(LEDGER).filter(f => /^ld-.*\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(path.join(LEDGER, f), 'utf8'))) : [];
const fresh = index && index.base.transition === baseDigests().transition && index.base.mutate === baseDigests().mutate && index.base.policy === baseDigests().policy;
const allMutants = () => [...transitionMutants(), ...HAND_CANDIDATES];
const parseWorld = id => { const m = /^ebed-e8-dev-(\d+)-d(\d)-tail$/.exec(id); return { seed: Number(m[1]), difficulty: Number(m[2]) }; };

test('defects: the transition mutants are tools/mutate.mjs\'s, numbered as the oracle mutants of ledger/MUTANTS.md', () => {
  const ms = transitionMutants();
  assert.ok(ms.length > 0);
  assert.ok(ms.every(m => m.operator !== 'other'), 'every edit maps to an E-BED §9.5 operator');
  assert.ok(ms.every(m => m.source !== readFileSync(TRANSITION_FILE, 'utf8')), 'every mutant changes the source');
  const readme = readFileSync(path.join(EVIDENCE, 'README.md'), 'utf8');
  if (readme.includes(`\`transition.mjs\` ${baseDigests().transition.slice(0, 12)}`)) {
    const man = JSON.parse(readFileSync(path.join(EVIDENCE, 'data', 'manifest.json'), 'utf8'));
    assert.equal(ms.length, man.length);
    for (const m of ms) assert.deepEqual([m.line, m.from, m.to], [man[m.k].line, man[m.k].from, man[m.k].to], `k${m.k}`);
  }
});

test('defects: the unmutated reference is E0-silent and fails no later case (graded, not short-cut by its digest)', async () => {
  const p = await prepareWorld({ seed: 1101, difficulty: 2 });
  const src = readFileSync(TRANSITION_FILE, 'utf8');
  const identity = { id: 'ref-identity', kind: 'transition', operator: 'none', source: src };
  const dir = scratchDir();
  try {
    const r = await mineOnWorld({ mutant: identity, item: await armItemOf(identity, dir), prepared: { ...p, refDigest: null, refDigest0: p.refDigest } });
    assert.equal(r.digest, p.refDigest, 'the identity run is the reference run');
    assert.equal(r.e0.checked.length, e0Cases(p.world).length);
    assert.ok(r.e0.checked.length >= 10);
    assert.deepEqual(r.e0.failed, []);
    assert.deepEqual(r.affected, []);
  } finally { removeDir(dir); }
});

test('defects: an E0-visible mutant is rejected by the executed check, at the recorded first E0 failure', { skip: !fresh && 'ledger/latent-defects is stale or missing' }, async () => {
  const rejected = index.mutants.filter(m => m.status === 'e0-visible' && /-d2-/.test(m.e0First.world));
  assert.ok(rejected.length > 0);
  const pick = rejected.find(m => m.id.startsWith('ref-')) ?? rejected[0];
  const mutant = allMutants().find(m => m.id === pick.id);
  const p = await prepareWorld(parseWorld(pick.e0First.world));
  const dir = scratchDir();
  try {
    const r = await mineOnWorld({ mutant, item: await armItemOf(mutant, dir), prepared: p });
    assert.ok(r.e0.failed.length > 0, `${pick.id} must fail an E0 case`);
    assert.equal(r.e0.failed[0].case, pick.e0First.case);
    assert.equal(r.e0.failed[0].code ?? null, pick.e0First.code);
    assert.deepEqual(r.affected, [], 'later epochs are not graded once E0 fails');
  } finally { removeDir(dir); }
});

test('defects: every manifest is complete; true and false revealing events are paired and well-formed (§2.10)', { skip: !index && 'no ledger' }, () => {
  assert.equal(manifests.length, index.counts.admitted);
  assert.equal(index.counts.trueRevealingEvents, index.counts.falseRevealingEvents, 'false revealing events at the same rate as true ones');
  for (const m of manifests) {
    assert.equal(m.schema, 'ebed-e8-latent-defect/1');
    assert.equal(m.e0Silence.executed, true);
    assert.equal(m.e0Silence.failed, 0);
    assert.ok(m.members.includes(m.mutant.id));
    assert.ok(m.contradicts.length > 0, `${m.id}: a latent defect contradicts a rule (E-BED §2.5)`);
    assert.ok(m.worlds.length >= 8, `${m.id}: every mining world is checked`);
    let revealed = 0;
    for (const w of m.worlds) {
      assert.ok(w.seed >= 1001 && w.seed <= 1199, 'dev block only');
      assert.ok(w.e0.checked.length > 0 && w.e0.failed === 0 && w.e0.graded === true, `${m.id} ${w.world}: E0 silent, every E0 case graded`);
      const world = generateWorld({ seed: w.seed, difficulty: w.difficulty, mix: 'tail' });
      assert.equal(world.id, w.world);
      assert.deepEqual([...w.e0.checked].sort(), e0Cases(world).sort(), 'every E0 case is checked');
      const ep = c => world.truth.cases[c].epoch;
      assert.ok(w.affected.every(a => !PARAMS.e0Epochs.includes(ep(a.case))), 'no affected case is an E0 case');
      if (!w.reveal) continue;
      revealed += 1;
      const affected = new Set(w.affected.map(a => a.case));
      assert.ok(affected.has(w.reveal.case));
      assert.ok(w.sweep.before.includes(w.reveal.case));
      assert.deepEqual([...w.sweep.before, ...w.sweep.after].sort(), [...affected].filter(c => w.affected.find(a => a.case === c).at).sort(), 'the sweep sets partition the observable failures');
      if (!w.reveal.event) continue;
      const [lo, hi] = [Date.parse(world.epochBounds[2]), Date.parse(world.epochBounds[4])];
      const at = Date.parse(w.reveal.event.at);
      assert.ok(at >= lo && at < hi, `${m.id} ${w.world}: revealed in E2 or E3`);
      assert.equal(w.reveal.truth.valid, true);
      assert.ok(w.falseReveal, `${m.id} ${w.world}: a false twin`);
      const f = w.falseReveal;
      assert.equal(f.truth.valid, false);
      assert.ok(!affected.has(f.case), 'the false claim is about a case the defect does not affect');
      assert.ok(Date.parse(f.event.at) >= lo && Date.parse(f.event.at) < hi);
      for (const k of ['assert', 'subject']) assert.equal(f.event.payload[k], w.reveal.event.payload[k], `${k}: the same claim form`);
      assert.equal(f.event.type, w.reveal.event.type);
      assert.equal(world.truth.cases[f.case].subject, f.event.payload.orderRef);
    }
    assert.ok(revealed > 0, `${m.id}: revealed on some world`);
  }
});

test('defects: a mined defect re-executes to its manifest on its smallest revealing world; its false claim\'s case passes', { skip: !fresh && 'ledger/latent-defects is stale or missing' }, async () => {
  const cands = manifests.flatMap(m => m.worlds.filter(w => w.reveal?.event).map(w => ({ m, w }))).sort((a, b) => a.w.difficulty - b.w.difficulty || (a.m.id < b.m.id ? -1 : 1));
  assert.ok(cands.length > 0);
  const { m, w } = cands[0];
  const mutant = allMutants().find(x => x.id === m.mutant.id);
  const p = await prepareWorld({ seed: w.seed, difficulty: w.difficulty });
  const dir = scratchDir();
  try {
    const r = await mineOnWorld({ mutant, item: await armItemOf(mutant, dir), prepared: { ...p, refDigest: null, refDigest0: p.refDigest }, keep: true });
    const plan = planReveal({ world: p.world, mined: r, defectId: m.id });
    const again = defectManifest({ id: m.id, mutant, members: m.members, results: [{ ...r, plan }] }).worlds[0];
    for (const k of ['world', 'journal', 'e0', 'affected', 'reveal', 'falseReveal', 'sweep']) assert.equal(canonical(again[k]), canonical(w[k]), `${m.id} ${w.world}: ${k}`);
    const v = gradeCase({ item: oracleItem, world: p.world, idx: r.idx, c: w.falseReveal.case, pool: p.pools[w.falseReveal.case] });
    assert.ok(v.pass && !failing(v), 'the falsely accused case passes the oracle on the defect\'s trajectory');
    const t = gradeCase({ item: oracleItem, world: p.world, idx: r.idx, c: w.reveal.case, pool: p.pools[w.reveal.case] });
    assert.ok(failing(t) && t.firstDivergence.code === w.reveal.divergence.code, 'the revealing case fails with the recorded divergence');
  } finally { removeDir(dir); }
});
