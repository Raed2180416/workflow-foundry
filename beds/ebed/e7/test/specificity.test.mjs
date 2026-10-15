// E7 specificity adjudication (2026-10-15, README E7-B11; $0, no model calls, no host runs). The blind solvers'
// specificity run (tools/specificity-run.mjs, seeds 1242-1245 x d2-d5) found one spec gap: SPEC-E never named the id
// field of master records, and all three solvers guessed it wrong. S17 states it; these tests keep the spec and the world
// in step and pin the diagnostic shim and the seed guard of the tool.
//   node --test beds/ebed/e7/test/specificity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateWorld, specE } from '../index.mjs';
import { MASTER_ID_FIELDS, masterIdShim, specificitySeedAllowed } from '../tools/specificity-run.mjs';

const flat = specE.text.replace(/\s+/g, ' ');
const FILE = { cis: 'master/cis.json', services: 'master/services.json', groups: 'master/groups.json', users: 'master/users.json' };
// The record shapes §4 Files states, in its words: "a CI `{ ... }`", "a service `{ ... }`", "a group `{ ... }`", "a user `{ ... }`".
const stated = kind => {
  const m = new RegExp(`a ${kind} \`\\{ ([^}]*) \\}\``).exec(flat);
  assert.ok(m, `SPEC §4 Files states no record shape for a ${kind}`);
  return m[1].split(',').map(s => s.trim());
};

test('S17: the spec names each master record\'s id field and its fields exactly as the world writes them (d1-d5)', () => {
  assert.ok(specE.text.includes('- S17 '), 'S17 missing from the spec');
  assert.ok(flat.includes("A master record's id is the field named after its kind, never a field `id`"));
  const shapes = { cis: stated('CI'), services: stated('service'), groups: stated('group'), users: stated('user') };
  for (const [kind, f] of Object.entries(FILE)) {
    const idField = MASTER_ID_FIELDS[f];
    assert.equal(shapes[kind][0], idField, `${kind}: the stated shape does not start with its id field`);
    assert.ok(flat.includes(`\`${idField}\` in \`${f.slice('master/'.length)}\``), `S17 does not name ${idField} for ${f}`);
  }
  for (const d of [1, 2, 3, 4, 5]) {
    const w = generateWorld({ seed: 1001, difficulty: d });
    for (const [kind, rows] of Object.entries(w.master)) {
      assert.ok(rows.length > 0, `d${d} ${kind} empty`);
      const idField = MASTER_ID_FIELDS[FILE[kind]];
      const ids = new Set();
      for (const r of rows) {
        assert.deepEqual(Object.keys(r), shapes[kind], `d${d} ${kind} ${r[idField]}: fields differ from SPEC §4 Files`);
        assert.equal(r.id, undefined);
        assert.ok(!ids.has(r[idField]), `d${d} ${kind}: duplicate id ${r[idField]}`);
        ids.add(r[idField]);
      }
    }
    // The ids the rules cross-reference resolve under S17: a CI's service and supportGroup, a group's schedule.
    const svc = new Set(w.master.services.map(s => s.service)), grp = new Set(w.master.groups.map(g => g.group));
    for (const c of w.master.cis) { assert.ok(svc.has(c.service), c.ci); assert.ok(grp.has(c.supportGroup), c.ci); }
    for (const e of w.rulebook.editions) {
      const au = JSON.parse(e.files['alert-urgency.json']);
      assert.ok(!Array.isArray(au) && typeof au === 'object', 'alert-urgency.json is a severity map');
      for (const [sev, u] of Object.entries(au)) assert.ok(u === null || [1, 2, 3].includes(u), `${sev} -> ${u}`);
      for (const r of JSON.parse(e.files['assignment.json'])) if (r.group !== 'ciSupportGroup') assert.ok(grp.has(r.group), `assignment row ${r.order}: ${r.group}`);
    }
  }
  assert.ok(flat.includes('`alert-urgency.json` maps each `severity` to an urgency or `null`'));
});

test('--shim master-ids is a wrapper only: the solver code is kept, ctx.files gains `id`, other files and ctx calls pass through', async () => {
  const src = [
    'export function createSolver() { return { id: "probe", tick(input, ctx) {',
    '  const cis = JSON.parse(ctx.files["master/cis.json"]); const users = JSON.parse(ctx.files["master/users.json"]);',
    '  return { seen: [cis[0].id, cis[0].ci, users[0].id, ctx.files["rulebook/x/policy.json"], ctx.status("itsm", "k")] }; } }; }',
    'export default createSolver;',
  ].join('\n');
  const shimmed = masterIdShim(src);
  assert.ok(shimmed.startsWith(src.replace('export function createSolver()', 'function __shimmedCreateSolver()').replace('export default createSolver;', '')), 'the solver body changed');
  assert.equal((shimmed.match(/^export default /gm) ?? []).length, 1);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'e7-shim-'));
  try {
    writeFileSync(path.join(dir, 'solver.mjs'), shimmed);
    const { createSolver } = await import(pathToFileURL(path.join(dir, 'solver.mjs')).href);
    const files = { 'master/cis.json': JSON.stringify([{ ci: 'CI-1', name: 'n' }]), 'master/users.json': JSON.stringify([{ userId: 'u-1' }]), 'rulebook/x/policy.json': '{"a":1}' };
    const out = createSolver().tick({}, { files, status: (s, k) => `${s}:${k}` });
    assert.deepEqual(out.seen, ['CI-1', 'CI-1', 'u-1', '{"a":1}', 'itsm:k']);
    assert.equal(JSON.parse(files['master/cis.json'])[0].id, undefined, 'the shim mutated the host files');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => masterIdShim('export const createSolver = () => ({})'), /must declare `export function createSolver\(\)`/);
});

test('specificity seeds: the specificity block 1241-1249 and dev 1001-1199 only (DESIGN §13)', () => {
  for (const s of [1241, 1242, 1245, 1249, 1001, 1199]) assert.ok(specificitySeedAllowed(s), String(s));
  for (const s of [1200, 1201, 1211, 1231, 1232, 1234, 1235, 1237, 1240, 1250, 9101, 9201, 9301, 1242.5]) assert.ok(!specificitySeedAllowed(s), String(s));
});
