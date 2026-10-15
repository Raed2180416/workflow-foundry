// E7 through the item-generic B1 wiring (build.mjs, smoke-service.mjs): the arm-facing files, the practice worlds and a
// solver run out of process and graded by E7's oracle. $0; worlds are dev seeds (1001-1199) with a small size.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as e7 from '../../../beds/ebed/e7/index.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { ITEMS, buildFiles, grade } from '../build.mjs';
import { smokeReport, practiceFor, PRACTICE, PRACTICE_BY_ITEM, CLIENT } from '../smoke-service.mjs';

const DEV = { seeds: [1101], difficulties: [2], size: 12 };
const IDLE = `export function createSolver() { return { id: 'idle', tick() { return { decisions: { subject: null, priority: null }, effects: [], close: true, carry: {} }; } }; }`;

test('ITEMS: --item e7 and e8 resolve to the item modules', () => {
  assert.equal(ITEMS.e7, e7);
  assert.equal(ITEMS.e8, e8);
});

test('E7 arm-facing files: task, spec, contract and the API schemas of its three systems, nothing else', () => {
  const f = buildFiles(e7);
  assert.deepEqual(Object.keys(f).sort(), ['CONTRACT.md', 'SPEC-E.md', 'TASK.md', 'api/itsm.schema.json', 'api/notify.schema.json', 'api/sla.schema.json']);
  assert.equal(f['SPEC-E.md'], e7.specE.text);
  assert.match(f['TASK.md'], /incident number or null/);
  assert.match(f['TASK.md'], /decisions\.priority/);
  assert.match(f['TASK.md'], /calendar\/<id>\.json/);
  assert.doesNotMatch(f['TASK.md'], /order/);
  assert.match(f['TASK.md'], /You cannot run the real systems here/);
  for (const s of ['itsm', 'sla', 'notify']) assert.equal(JSON.parse(f[`api/${s}.schema.json`]).system, s);
  // No bed internals reach the arm: the spec and the schemas only.
  for (const [p, text] of Object.entries(f)) assert.doesNotMatch(text, /referenceTransition|world\.mjs|golden|beds\/ebed/, p);
  const loop = buildFiles(e7, { loop: 'smoke' });
  assert.equal(loop['smoke.mjs'], CLIENT);
  assert.match(loop['TASK.md'], /build loop: smoke/);
  assert.doesNotMatch(loop['TASK.md'], /You cannot/);
});

test('practice worlds per item: E7 and E8 1235-1237, disjoint from the B1 grading worlds and the specificity block', () => {
  assert.equal(practiceFor(e8), PRACTICE);
  assert.deepEqual(Object.keys(PRACTICE_BY_ITEM).sort(), ['ebed-e7', 'ebed-e8']);
  for (const item of [e7, e8]) {
    const p = practiceFor(item);
    for (const s of p.seeds) {
      assert.ok(s >= 1235 && s <= 1240, `${item.family.id} ${s}`);
      assert.ok(![1232, 1233, 1234].includes(s) && !(s >= 1241 && s <= 1249), `${item.family.id} ${s}`);
    }
  }
  assert.throws(() => practiceFor({ family: { id: 'ebed-e1' } }), /no practice worlds/);
});

test('E7 smoke report: effect results without grading (smoke), the practice pass count and first divergences (graded)', async () => {
  const smoke = await smokeReport(e7, IDLE, { mode: 'smoke', practice: DEV });
  assert.match(smoke.text, /0 effects emitted/);
  assert.match(smoke.text, /\(none\)/);
  assert.doesNotMatch(smoke.text, /business rules/);
  const graded = await smokeReport(e7, IDLE, { mode: 'graded', practice: DEV, show: 2 });
  assert.match(graded.text, /business rules: 0\/\d+ completed cases pass/);
  assert.match(graded.text, /rule R\d/);
});

test('E7 grade: a solver runs out of process and is graded by E7\'s oracle', async () => {
  const [row] = await grade(e7, IDLE, { seeds: DEV.seeds, difficulties: DEV.difficulties, label: 'idle', size: DEV.size });
  assert.equal(row.status, 'complete');
  assert.ok(row.completed > 0);
  assert.equal(row.passed, 0);
  assert.equal(row.armErrors, 0);
});
