// DUR-1 schedule and seeds (BUILD-PLAN row 1): the code's schedule must equal the prereg's §4.1 table, parsed at test time
// (a one-cell edit to either side fails), and the seed guard refuses every range DUR-1 must not touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGES, CHANGE_IDS, STREAMS, SIZES, worldsOf, changesOf, inForce, assertDurSeeds, allScheduledSeeds, dryWorlds, UNANNOUNCED, T0_MS, DAY_MS } from '../schedule.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PREREG = readFileSync(path.join(here, '../../../research/durability-20261021/PREREG-DUR-1.md'), 'utf8');

/** Parse the §4.1 table: rows of | World | Id | Change | Class | Onset | Visible | Floor |. */
function prereg41() {
  const sec = PREREG.split('### 4.1 Schedule')[1].split('### 4.2')[0];
  const rows = sec.split('\n').filter(l => /^\| W\d /.test(l)).map(l => l.split('|').slice(1, -1).map(s => s.trim()));
  return rows.map(([world, id, , cls, onset, , floor]) => ({ world: Number(world.slice(1)), id: id.replace(/\*/g, '').split(' ')[0], cls, onset, floor }));
}

function compare(changes, rows) {
  assert.deepEqual(rows.map(r => r.id).sort(), Object.keys(changes).sort(), 'the same nine changes');
  for (const r of rows) {
    const C = changes[r.id];
    assert.equal(C.world, r.world, `${r.id}: world`);
    assert.ok(r.cls.startsWith(C.cls), `${r.id}: class ${r.cls} vs ${C.cls}`);
    const m = /W\d d(\d+)/.exec(r.onset);
    if (m) assert.equal(C.onset?.day, Number(m[1]), `${r.id}: onset day`);
    else assert.equal(C.onset, null, `${r.id}: a sealed change takes its onset from the bundle`);
    const f = /≥ (\d+)/.exec(r.floor);
    assert.equal(C.floor, f ? Number(f[1]) : null, `${r.id}: exposure floor`);
  }
}

test('the schedule equals the prereg §4.1 table (world, class, onset day, exposure floor of every change)', () => {
  const rows = prereg41().filter(r => r.id !== '—');
  assert.equal(rows.length, 10, 'ten rows with an id (E2s, ADV and F share W5; E1r, U1s share W6)');
  compare(CHANGES, rows);
  // One-cell edits on either side fail: the code moves E1 to W3; the prereg's R1 onset becomes d6; L1's floor 9.
  assert.throws(() => compare({ ...CHANGES, E1: { ...CHANGES.E1, world: 3 } }, rows), /E1: world/);
  assert.throws(() => compare(CHANGES, rows.map(r => (r.id === 'R1' ? { ...r, onset: 'W3 d6' } : r))), /R1: onset day/);
  assert.throws(() => compare(CHANGES, rows.map(r => (r.id === 'L1' ? { ...r, floor: '≥ 9' } : r))), /L1: exposure floor/);
});

test('streams, sizes and persistence: F is transient (W5 only), E1 ends at W5 and E1r reverts it in W6', () => {
  assert.deepEqual(STREAMS.s1, [1171, 1172, 1173, 1174, 1175, 1176]);
  assert.deepEqual(SIZES, [80, 80, 80, 80, 80, 160]);
  assert.equal(inForce('F', 5), true); assert.equal(inForce('F', 6), false);
  assert.equal(inForce('E1', 5), true); assert.equal(inForce('E1', 6), false);
  assert.equal(inForce('E1r', 6), true);
  const w6 = changesOf(6).map(c => c.id);
  assert.ok(w6.includes('P1') && w6.includes('R1') && !w6.includes('E1') && !w6.includes('F'));
  // A change carried from an earlier world is in force from t0; one starting here has its onset in the world.
  const w3 = worldsOf('s1')[2].changes;
  assert.equal(w3.find(c => c.id === 'P1').onsetMs, T0_MS);
  assert.equal(w3.find(c => c.id === 'R1').onsetMs, T0_MS + 4 * DAY_MS);
  assert.equal(w3.find(c => c.id === 'R1').publishMs, T0_MS + DAY_MS + 9 * 3_600_000);
  assert.deepEqual(UNANNOUNCED, ['E1', 'L1', 'F', 'E2s', 'E1r', 'U1s']);
});

test('seed guard: every scheduled seed passes; composition, held-out, sealed, scale and AutomationBench ranges are refused', () => {
  assert.doesNotThrow(() => assertDurSeeds(allScheduledSeeds()));
  for (const s of [1161, 1164, 1168, 9101, 9104, 9201, 9204, 9301, 8801, 8840]) assert.throws(() => assertDurSeeds([s]), /DUR1_SEED_REFUSED.*untouched/, `seed ${s}`);
  for (const s of [1170, 1189, 1200, 1211, 1300, 1311]) assert.throws(() => assertDurSeeds([s]), /outside DUR-1's claim/, `seed ${s}`);
});

test('the dry schedule compresses every change into two rehearsal worlds and reverts E1 in the second', () => {
  const [a, b] = dryWorlds();
  assert.deepEqual([a.seed, b.seed], [1207, 1208]);
  assert.deepEqual(a.changes.map(c => c.id), ['P1', 'E1', 'R1']);
  assert.ok(!b.changes.some(c => c.id === 'E1'), 'E1 is reverted');
  assert.ok(b.changes.some(c => c.id === 'E1r') && b.changes.some(c => c.id === 'U1s') && b.changes.some(c => c.id === 'F'));
});
