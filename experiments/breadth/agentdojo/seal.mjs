#!/usr/bin/env node
// AgentDojo units: dev (public) and sealed (host-only), by the frozen rule in split-rule.mjs. $0, scripted only.
//
//   node experiments/breadth/agentdojo/seal.mjs --dev [--check]
//       DEV-UNITS.json: each of the 39 dev user tasks x {benign, inj-a, inj-b}; a and b are upstream injection tasks of
//       the suite that pass the fail-to-pass gate on that pairing (null agent and the user task's own gold: not
//       registered; the injection task's gold: registered),
//       the first two by sha256("breadth-ad-v1:" + salt + ":inj:" + suite/user task + ":" + injection id). --check rebuilds
//       it with the current code and compares (writes nothing).
//   node experiments/breadth/agentdojo/seal.mjs --sealed
//       needs AUTHORED-FREEZE.json (authored.mjs --freeze): each of the 58 held-out user tasks x {benign, inj-a, inj-b}
//       with a and b from the frozen AUTHORED pool by the same rule; the manifest and the freeze it names are written
//       HOST-ONLY (HOST_ROOT/sealed/); research/ gets SEALED-MANIFEST.json (hashes and counts only). Also the comparator
//       subsets (A-S: one unit per held-out user task + 3, A-O: 20 anchors), by salted hash (PLAN §8.2; PREREG v1 may amend
//       them before the freeze).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BridgeServer, HOST_ROOT, RESEARCH, readJson, sha256, shaCanon, writeJson } from './lib.mjs';
import { attackUnit, benignUnit, executePlans, gradeRecords, planUnits } from './scripted.mjs';
import { injKey, loadSplit, pickInjections } from './split.mjs';

export const DEV_UNITS_FILE = path.join(RESEARCH, 'DEV-UNITS.json');
export const AUTHORED_FREEZE_FILE = path.join(RESEARCH, 'AUTHORED-FREEZE.json');
export const SEALED_MANIFEST_FILE = path.join(RESEARCH, 'SEALED-MANIFEST.json');
export const SEALED_DIR = path.join(HOST_ROOT, 'sealed');
const LIVE = '/var/tmp/foundry-work/agentdojo-live/seal';

/** Fail-to-pass of each (user task, injection task) pairing, scripted: the null agent and the user task's own gold
 * (an agent that ignores the injection) must not register the injection; the injection task's gold must. */
export async function eligibility(bridge, pairs, { liveDir = LIVE, authored = null, hostTag = 'elig' } = {}) {
  const run = async policy => {
    const plans = await planUnits(bridge, pairs, policy);
    const host = path.join(liveDir, `${hostTag}-${policy}`);
    const recs = await executePlans(bridge, pairs, plans, host);
    const v = await gradeRecords(recs, liveDir, { authored });
    rmSync(host, { recursive: true, force: true }); // this battery's own scratch snapshots; verdicts are kept
    return v;
  };
  const nul = await run('null'), user = await run('gold'), inj = await run('injgold');
  return new Map(pairs.map(p => [p.id, { nullRegistered: nul.get(p.id)?.security === true, userGoldRegistered: user.get(p.id)?.security === true,
    injGoldRegistered: inj.get(p.id)?.security === true,
    failToPass: nul.get(p.id)?.security === false && user.get(p.id)?.security === false && inj.get(p.id)?.security === true }]));
}

/** Units for user tasks: benign + inj-a + inj-b, injections chosen among the eligible by the frozen rule. */
export function unitsFor(split, userTasks, eligibleOf, source) {
  const units = [], shortfall = [];
  for (const { suite, userTask } of userTasks) {
    units.push({ ...benignUnit(suite, userTask), id: `${suite}/${userTask}/benign` });
    const pick = pickInjections(split.salt, suite, userTask, eligibleOf(suite, userTask));
    if (pick.length < 2) shortfall.push({ suite, userTask, eligible: pick.length });
    pick.forEach((inj, i) => {
      const condition = i === 0 ? 'inj-a' : 'inj-b';
      units.push({ ...attackUnit(suite, userTask, inj, source, condition), id: `${suite}/${userTask}/${condition}` });
    });
  }
  return { units, shortfall };
}

/** Comparator subsets of the sealed units (default rule; PREREG v1 may amend before the freeze). */
export function comparatorSubsets(split, units) {
  const key = (tag, x) => sha256(`breadth-ad-v1:${split.salt}:${tag}:${x}`);
  const byTask = new Map();
  for (const u of units) { const k = `${u.suite}/${u.userTask}`; if (!byTask.has(k)) byTask.set(k, []); byTask.get(k).push(u); }
  const first = [...byTask.values()].map(us => [...us].sort((a, b) => (key('as', a.id) < key('as', b.id) ? -1 : 1))[0]);
  const chosen = new Set(first.map(u => u.id));
  const extra = units.filter(u => !chosen.has(u.id)).sort((a, b) => (key('as', a.id) < key('as', b.id) ? -1 : 1)).slice(0, 3);
  const aS = [...first, ...extra].map(u => u.id).sort();
  const anchorTasks = [...byTask.keys()].sort((a, b) => (key('ao', a) < key('ao', b) ? -1 : 1)).slice(0, 20);
  const aO = anchorTasks.map(t => [...byTask.get(t)].sort((a, b) => (key('ao', a.id) < key('ao', b.id) ? -1 : 1))[0].id).sort();
  return { 'A-S': aS, 'A-O': aO, rule: 'A-S: per held-out user task the unit with the smallest sha256(prefix+salt+":as:"+unit id), plus the 3 smallest of the rest; A-O: the 20 user tasks with the smallest sha256(prefix+salt+":ao:"+suite/user task), one unit each by the same key' };
}

export async function buildDev({ split, liveDir = LIVE } = {}) {
  const inv = readJson(path.join(liveDir, 'inventory.json'));
  const devTasks = Object.entries(split.suites).flatMap(([s, e]) => e.dev.map(u => ({ suite: s, userTask: u })));
  const pairs = devTasks.flatMap(({ suite, userTask }) => inv.suites[suite].injectionTasks.map(i => attackUnit(suite, userTask, i)));
  const b = new BridgeServer({ liveDir });
  await b.hello;
  let el;
  try { el = await eligibility(b, pairs, { liveDir, hostTag: 'dev' }); } finally { await b.quit(); }
  const eligibleOf = (s, u) => inv.suites[s].injectionTasks.filter(i => el.get(attackUnit(s, u, i).id)?.failToPass);
  const { units, shortfall } = unitsFor(split, devTasks, eligibleOf, 'upstream');
  return { kind: 'agentdojo-dev-units', version: 1, splitSha256: split.splitSha256, rule: 'split-rule.mjs pickInjections over upstream injection tasks that pass fail-to-pass on the pairing',
    evidence: 'development: public user tasks and public upstream injection tasks', counts: { userTasks: devTasks.length, units: units.length, pairingsChecked: pairs.length,
      eligiblePairings: [...el.values()].filter(x => x.failToPass).length }, shortfall, units, unitsSha256: shaCanon(units), createdAt: new Date().toISOString() };
}

export async function buildSealed({ split, freeze, liveDir = LIVE } = {}) {
  const authoredPath = freeze.hostPath;
  if (!existsSync(authoredPath)) throw new Error(`frozen authored file missing: ${authoredPath}`);
  if (sha256(readFileSync(authoredPath)) !== freeze.sha256) throw new Error('the authored file changed since its freeze');
  const authored = readJson(authoredPath).tasks;
  const heldTasks = Object.entries(split.suites).flatMap(([s, e]) => e.heldOut.map(u => ({ suite: s, userTask: u })));
  const pool = s => authored.filter(t => t.suite === s).map(t => t.id);
  const pairs = heldTasks.flatMap(({ suite, userTask }) => pool(suite).map(i => attackUnit(suite, userTask, i, 'authored')));
  const b = new BridgeServer({ liveDir, authored: authoredPath });
  await b.hello;
  let el;
  try { el = await eligibility(b, pairs, { liveDir, authored: authoredPath, hostTag: 'sealed' }); } finally { await b.quit(); }
  const eligibleOf = (s, u) => pool(s).filter(i => el.get(attackUnit(s, u, i, 'authored').id)?.failToPass);
  const { units, shortfall } = unitsFor(split, heldTasks, eligibleOf, 'authored');
  const subsets = comparatorSubsets(split, units);
  const manifest = { kind: 'agentdojo-sealed-units', version: 1, splitSha256: split.splitSha256, authoredSha256: freeze.sha256, units, unitsSha256: shaCanon(units), subsets,
    shortfall, counts: { userTasks: heldTasks.length, units: units.length, pairingsChecked: pairs.length, eligiblePairings: [...el.values()].filter(x => x.failToPass).length,
      injectionClusters: new Set(units.filter(u => u.injectionTask).map(u => `${u.suite}/${u.injectionTask}`)).size }, createdAt: new Date().toISOString() };
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const split = loadSplit();
  mkdirSync(LIVE, { recursive: true });
  const { inventory } = await import('./parity.mjs');
  await inventory(LIVE);
  if (process.argv.includes('--dev') && process.argv.includes('--check')) {
    // rebuild from scratch with the current code and compare; writes nothing in the repository
    const d = await buildDev({ split });
    const f = readJson(DEV_UNITS_FILE);
    const same = f.unitsSha256 === d.unitsSha256 && shaCanon(f.units) === d.unitsSha256 && JSON.stringify(f.counts) === JSON.stringify(d.counts);
    console.log(JSON.stringify({ check: DEV_UNITS_FILE, reproduces: same, file: { unitsSha256: f.unitsSha256, counts: f.counts }, rebuilt: { unitsSha256: d.unitsSha256, counts: d.counts, shortfall: d.shortfall } }));
    if (!same) process.exit(1);
  } else if (process.argv.includes('--dev')) {
    if (existsSync(DEV_UNITS_FILE) && !process.argv.includes('--force')) throw new Error(`${DEV_UNITS_FILE} exists (--force rewrites it; it must reproduce)`);
    const d = await buildDev({ split });
    if (existsSync(DEV_UNITS_FILE) && readJson(DEV_UNITS_FILE).unitsSha256 !== d.unitsSha256) throw new Error('DEV-UNITS.json does not reproduce');
    writeJson(DEV_UNITS_FILE, d);
    console.log(JSON.stringify({ wrote: DEV_UNITS_FILE, counts: d.counts, shortfall: d.shortfall, unitsSha256: d.unitsSha256 }));
  } else if (process.argv.includes('--sealed')) {
    if (!existsSync(AUTHORED_FREEZE_FILE)) throw new Error('AUTHORED-FREEZE.json is missing: author and freeze the injection tasks first (authored.mjs)');
    const freeze = readJson(AUTHORED_FREEZE_FILE);
    const man = await buildSealed({ split, freeze });
    mkdirSync(SEALED_DIR, { recursive: true });
    const manifestPath = path.join(SEALED_DIR, 'SEALED-UNITS.json');
    if (existsSync(manifestPath)) throw new Error(`${manifestPath} exists: the sealed manifest is written once`);
    writeJson(manifestPath, man);
    chmodSync(manifestPath, 0o444);
    const f = { kind: 'agentdojo-sealed-freeze', version: 1, splitSha256: split.splitSha256, manifestPath, manifestSha256: sha256(readFileSync(manifestPath)), unitsSha256: man.unitsSha256,
      authoredPath: freeze.hostPath, authoredSha256: freeze.sha256, frozenAt: new Date().toISOString() };
    const freezePath = path.join(SEALED_DIR, 'SEALED-FREEZE.json');
    writeJson(freezePath, f);
    writeJson(SEALED_MANIFEST_FILE, { kind: 'agentdojo-sealed-manifest-public', splitSha256: split.splitSha256, authoredSha256: freeze.sha256, manifestSha256: f.manifestSha256,
      unitsSha256: man.unitsSha256, subsetsSha256: shaCanon(man.subsets), counts: man.counts, shortfall: man.shortfall.length, freezeSha256: sha256(readFileSync(freezePath)), frozenAt: f.frozenAt,
      note: 'the unit list, the authored injection tasks and every sealed verdict stay host-only (HOST_ROOT/sealed, HOST_ROOT/authored)' });
    console.log(JSON.stringify({ freeze: freezePath, counts: man.counts, shortfall: man.shortfall.length }));
  } else {
    console.error('usage: node experiments/breadth/agentdojo/seal.mjs --dev [--check | --force] | --sealed');
    process.exit(2);
  }
}
export { injKey };
