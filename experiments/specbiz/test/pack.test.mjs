// SPEC-0: SPEC-E units, carrier assignment, the renderer, the leak gates and the coverage gate. $0, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSpec, specUnits, platformDoc, loadGold, GOLD_IDS, EXTRA_IDS, PLATFORM_EDITS } from '../spec-units.mjs';
import { assignCarriers, QUOTAS, PINNED } from '../carriers.mjs';
import { UNITS, ELIGIBLE, UNAUTHORISED } from '../content.mjs';
import { renderPack } from '../render.mjs';
import { leakTest, shingles, unitShingles } from '../leak.mjs';
import { coverageTest } from '../coverage.mjs';
import { PRECEDENTS, discriminates } from '../precedent.mjs';
import { rng } from '../../../beds/lib/rng.mjs';

const units = specUnits(loadSpec().text);
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

test('SPEC-E splits into the 30 gold ids and the extra units, each starting at its marker', () => {
  assert.deepEqual([...GOLD_IDS].sort(), Object.keys(loadGold().ids).sort());
  for (const id of GOLD_IDS.filter(x => x.startsWith('R'))) assert.ok(units[id].text.startsWith(`${id} `), id);
  for (const id of [...GOLD_IDS, ...EXTRA_IDS].filter(x => /^S\d/.test(x))) assert.ok(units[id].text.startsWith(`- ${id} `), id);
  assert.ok(units.NTF.text.startsWith('### 4.8'));
  assert.ok(units.REF.text.startsWith('## 6.'));
  for (const id of [...GOLD_IDS, ...EXTRA_IDS]) assert.ok(UNITS[id], `content for ${id}`);
});

test('PLATFORM.md is the exact platform zone, every edit applied once, with no rule-id cross-reference left', () => {
  const doc = platformDoc(units);
  for (const [, to] of PLATFORM_EDITS) assert.ok(doc.includes(to));
  assert.doesNotMatch(doc, /\bR\d\.\d\b|§4|§5|\(S\d+\)/);
  const body = units.PLATFORM.text.split('\n').filter(l => !PLATFORM_EDITS.some(([from]) => l.includes(from.trim().split(' ')[0])));
  for (const line of body.slice(0, 20)) assert.ok(doc.includes(line), line);
});

test('content: every anchor sits in its core and in no other unit\'s core; stale variants only where an override is eligible', () => {
  for (const [id, u] of Object.entries(UNITS)) {
    assert.ok(u.core.includes(u.anchor), id);
    for (const [j, v] of Object.entries(UNITS)) if (j !== id) assert.ok(!v.core.includes(u.anchor), `${id} anchor in ${j}`);
    assert.equal(!!u.stale, ELIGIBLE.override.includes(id), id);
    if (u.stale) assert.ok(u.stale.text.includes(u.stale.anchor) && !u.stale.text.includes(u.anchor), id);
  }
});

test('carrier assignment: fixed quotas, eligibility respected, deterministic, varied across seeds', () => {
  const digests = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const a = assignCarriers(seed);
    assert.deepEqual(a.counts, QUOTAS, `seed ${seed}`);
    for (const [id, u] of Object.entries(a.units)) {
      if (u.gold && u.carrier !== 'sop') assert.ok(ELIGIBLE[u.carrier].includes(id), `${seed} ${id} ${u.carrier}`);
      if (!u.gold) assert.ok(PINNED[id] ? u.carrier === PINNED[id] : ['sop', 'email'].includes(u.carrier));
    }
    assert.equal(assignCarriers(seed).digest, a.digest);
    digests.add(a.digest);
  }
  assert.ok(digests.size > 150, `only ${digests.size} distinct assignments in 200 seeds`);
});

test('the renderer is deterministic and the builder\'s files carry no truth marker', () => {
  for (const seed of [1, 7]) {
    const a = renderPack({ seed }), b = renderPack({ seed });
    assert.equal(a.digest, b.digest);
    assert.ok(a.meta.bytes < 60_000, `${a.meta.bytes} bytes`);
    for (const [f, t] of Object.entries(a.files)) {
      if (f === 'PLATFORM.md') continue;
      assert.doesNotMatch(t, /SPEC-E|\bR\d\.\d\b|\bS1[0-5]\b|gold|carrier assignment/, f);
    }
    assert.equal(Object.values(a.fileCarrier).filter(c => c === 'unauthorised').length, 1);
    assert.ok(UNAUTHORISED.some(u => a.files[Object.keys(a.files).find(f => a.fileCarrier[f] === 'unauthorised')].includes(u.subject)));
    for (const id of Object.keys(a.assignment.units).filter(x => a.assignment.units[x].carrier === 'override')) {
      assert.ok(a.files['wiki/SOP-order-handling-v3.md'].includes(UNITS[id].stale.text), `stale ${id} in SOP v3`);
      assert.ok(!a.files['wiki/SOP-order-handling-v3.md'].includes(UNITS[id].anchor), `current ${id} not in SOP v3`);
    }
    assert.ok(a.owner.records.length >= Object.keys(UNITS).length);
  }
  assert.notEqual(renderPack({ seed: 1 }).digest, renderPack({ seed: 2 }).digest);
  const ret = SEEDS.flatMap(s => renderPack({ seed: s }).owner.records.map(r => r.reticent));
  const share = ret.filter(Boolean).length / ret.length;
  assert.ok(share > 0.4 && share < 0.6, `reticent share ${share}`);
});

test('leak gates pass on seeds 1-20 (8-word shingles, placements, anchors), verbatim share at most 0.10', () => {
  for (const seed of SEEDS) {
    const t = leakTest(renderPack({ seed }));
    assert.ok(t.pass, `seed ${seed}: ${JSON.stringify(t.leaks).slice(0, 400)}`);
    assert.ok(t.stats.verbatimShareMax <= 0.10, `seed ${seed}: verbatim ${t.stats.verbatimShareMax}`);
  }
});

test('leak gates catch planted leaks: SPEC-E text of an owner-only rule in the SOP, a records rule paraphrased in an e-mail, a misplaced fragment', () => {
  const pack = renderPack({ seed: 3 });
  const owner = Object.keys(pack.assignment.units).find(id => pack.assignment.units[id].carrier === 'owner');
  const p1 = structuredClone(pack);
  p1.files['wiki/SOP-order-handling-v3.md'] += `\n${units[owner].text}\n`;
  const t1 = leakTest(p1);
  assert.ok(!t1.pass && t1.leaks.L1.some(l => l.unit === owner), 'L1 catches SPEC-E text');
  const rec = Object.keys(pack.assignment.units).find(id => pack.assignment.units[id].carrier === 'records');
  const p2 = structuredClone(pack);
  const mail = Object.keys(p2.files).find(f => p2.fileCarrier[f] === 'email');
  p2.files[mail] += `\nAlso: ${UNITS[rec].core}\n`;
  const t2 = leakTest(p2);
  assert.ok(!t2.pass && t2.leaks.L3.some(l => l.unit === rec), 'L3 catches a paraphrase in the wrong carrier');
  const p3 = structuredClone(pack);
  p3.fragments.push({ file: mail, unit: owner, role: 'current' });
  assert.ok(leakTest(p3).leaks.L2.length === 1, 'L2 catches a misplaced fragment');
});

test('shingles: specific shingles belong to one unit and never to the platform zone', () => {
  const { specific } = unitShingles(units);
  const platform = shingles(units.PLATFORM.text);
  const seen = new Map();
  for (const [id, set] of Object.entries(specific)) for (const s of set) { assert.ok(!platform.has(s)); assert.ok(!seen.has(s), `${s} in ${id} and ${seen.get(s)}`); seen.set(s, id); }
  assert.ok(seen.size > 2000);
});

test('coverage: every gold id recoverable on seeds 1-20; 27 of 30 without asking; U01-U11 in PLATFORM.md', async () => {
  for (const seed of SEEDS) {
    const c = await coverageTest(renderPack({ seed }));
    assert.ok(c.pass, `seed ${seed}: ${JSON.stringify(c.gold)} ${JSON.stringify(c.platformU)}`);
    assert.equal(c.gold.recoverable, 30);
    assert.equal(c.gold.withoutAsking, 27);
    assert.ok(Object.values(c.rows).every(r => r.owner), `seed ${seed}: an owner route failed`);
    assert.ok(Object.values(c.extras).every(Boolean));
  }
});

test('coverage fails when a carrier is broken: the correction e-mail removed, or a precedent row flipped', async () => {
  const pack = renderPack({ seed: 1 });
  const ov = Object.keys(pack.assignment.units).find(id => pack.assignment.units[id].carrier === 'override');
  const p1 = structuredClone(pack);
  for (const f of Object.keys(p1.files)) if (p1.fileCarrier[f] === 'email' && p1.files[f].includes(UNITS[ov].anchor)) p1.files[f] = p1.files[f].replace(UNITS[ov].anchor, '(see attachment)');
  const c1 = await coverageTest(p1);
  assert.equal(c1.rows[ov].documents, false);
  const rec = Object.keys(pack.precedents)[0];
  const p2 = structuredClone(pack);
  const row = p2.precedents[rec][0];
  const k = PRECEDENTS[rec].columns.at(-1);
  row[k] = typeof row[k] === 'number' ? row[k] + 1 : `${row[k]} (manual)`;
  const c2 = await coverageTest(p2);
  assert.equal(c2.rows[rec].documents, false);
});

test('precedents: all six templates discriminate on seeds 1-50, and a flipped outcome breaks the proof', () => {
  for (const id of Object.keys(PRECEDENTS)) for (let seed = 1; seed <= 50; seed++) {
    const rows = PRECEDENTS[id].rows(rng('test/precedent', id, seed));
    const d = discriminates(id, rows);
    assert.ok(d.ok, `${id} seed ${seed}: ${JSON.stringify(d)}`);
  }
  const rows = PRECEDENTS['R4.5'].rows(rng('x', 1));
  rows[0].order_status = rows[0].order_status === 'completed' ? 'failed' : 'completed';
  assert.equal(discriminates('R4.5', rows).fitsRule, false);
});
