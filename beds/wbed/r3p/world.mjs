// World model for W-bed R3' "planted-defect sweep" (PROOF-LEDGER J5; PRIOR-ART-MANAGED-AGENTS-DW §3.H, §4). One task is a
// fictional JavaScript repository (src/ with 8/16/32/48 source files by difficulty, two of them src/lib helper modules,
// plus tests, docs/CONVENTIONS.md, README.md and package.json) with planted defects of the in-scope classes and decoys
// (correct code that looks like a defect). The hidden manifest is the list of defects: (file, function, class). Every
// manifest entry is proved by execution here: the planted function differs from the correct one on a valid input (the
// bed's witness), every decoy equals the correct function on every probe, and the callers of a defective helper are
// classified affected (they inherit the wrong behaviour; the root-cause rule says not to report them) or unaffected.
// The oracle, the reference solver and every control derive from buildSweep(seed, split, difficulty).
import { taskRng } from '../lib/prng.mjs';
import { hooks } from '../lib/faults.mjs';
import { FAMILIES } from './families.mjs';
import { LEVELS, MIN_D, MAX_D, CLASS_MIN, AREAS, LIB, NOUNS, PACKAGES, ORGS, TODOS, NOTES } from './vocab.mjs';
import { makeContext, observe, sameObs, argsOk } from './exec.mjs';
import { renderRepo } from './render.mjs';

export const VERSION = '1.0.0';
export { MIN_D, MAX_D, LEVELS };
const TESTED_P = 0.4, TESTED_DEFECT_SHARE = 0.3, TODO_P = 0.08, NOTE_P = 0.12;

const worldCache = new Map();
let verifier = null;
export function setVerifier(fn) { verifier = fn; }
export const redrawStats = { attempts: 0, rejects: {} };

export function buildSweep(seed, split = 'dev', difficulty = 3) {
  const key = JSON.stringify([seed, split, difficulty]);
  if (worldCache.has(key)) return worldCache.get(key);
  if (!LEVELS[difficulty]) throw new Error(`wbed-r3p: difficulty must be ${MIN_D}..${MAX_D}, got ${difficulty}`);
  if (split !== 'dev' && split !== 'test') throw new Error(`wbed-r3p: split must be 'dev' or 'test', got ${split}`);
  let world = null, last = null;
  for (let attempt = 0; attempt < 40 && !world; attempt++) {
    redrawStats.attempts++;
    const w = attemptSweep({ seed, split, difficulty }, attempt);
    if (w.reject) { last = w.reject; redrawStats.rejects[w.reject] = (redrawStats.rejects[w.reject] ?? 0) + 1; continue; }
    world = w;
  }
  if (!world) throw new Error(`wbed-r3p: no valid repository for seed ${seed} d${difficulty} (${last})`);
  worldCache.set(key, world);
  if (worldCache.size > 12) worldCache.delete(worldCache.keys().next().value);
  return world;
}

const lcFirst = s => s[0].toLowerCase() + s.slice(1);
function namer(r) {
  const used = new Set();
  return templates => {
    for (let i = 0; i < 200; i++) {
      const t = r.pick(templates), N = r.pick(NOUNS);
      const name = t.replace('{N}', N).replace('{n}', lcFirst(N));
      const words = name.replace(/([A-Z])/g, ' $1').toLowerCase().split(' ').filter(Boolean);
      if (new Set(words).size !== words.length) continue; // no "chargeCharge", "lineLineAmount"
      if (!used.has(name)) { used.add(name); return name; }
    }
    throw new Error('wbed-r3p: names exhausted');
  };
}

function attemptSweep(spec, attempt) {
  const L = LEVELS[spec.difficulty];
  const r = taskRng('r3p', 'repo', spec, attempt);
  const reject = reason => ({ reject: reason });
  const house = { rounding: r.pick(['HALF_AWAY', 'HALF_EVEN']), band: r.pick(['incl', 'excl']), pageBase: r.pick([1, 0]) };
  const pkg = { org: r.pick(ORGS), name: r.pick(PACKAGES), version: `${r.int(1, 4)}.${r.int(0, 12)}.${r.int(0, 9)}` };

  // ---- files and function slots
  const pairs = AREAS.flatMap(a => a.files.map(f => ({ area: a, path: `src/${a.dir}/${f}.js` })));
  const chosen = r.sample(pairs, L.files - LIB.length).sort((a, b) => a.path.localeCompare(b.path));
  const files = [...LIB.map(l => ({ path: l.path, lib: l, pool: l.families })), ...chosen.map(c => ({ path: c.path, area: c.area, pool: c.area.families }))]
    .sort((a, b) => a.path.localeCompare(b.path));
  const slots = [];
  const callerCap = Math.ceil(L.files / 12) + 1; // instances per caller family: the root-cause trap stays a minority
  for (const f of files) {
    const n = Math.min(r.int(L.fns[0], L.fns[1]), f.pool.length + (f.lib ? 1 : 0));
    const fams = [];
    if (f.lib) fams.push(f.lib.helper);
    while (fams.length < n) {
      const id = r.pick(f.pool);
      if (fams.includes(id)) continue;
      if (FAMILIES[id].kind === 'caller' && slots.filter(s => s.family === id).length + fams.filter(x => x === id).length >= callerCap) continue;
      fams.push(id);
    }
    fams.forEach((id, i) => slots.push({ file: f, idx: i, family: id, role: { kind: 'clean' } }));
  }
  const areaSlots = () => slots.filter(s => !s.file.lib && s.role.kind === 'clean' && FAMILIES[s.family].kind === 'fn');
  // every helper has callers: at least one line-amount and one sum-lines (money), one add-months and one month-end (dates)
  for (const need of ['line-amount', 'sum-lines', 'add-months', 'month-end']) {
    if (slots.some(s => s.family === need)) continue;
    const free = areaSlots();
    if (!free.length) return reject('no-caller-slot');
    r.pick(free).family = need;
  }

  // ---- roles: defective helpers, defects per class (quotas), decoys
  const helperSlot = id => slots.find(s => s.file.lib && s.family === id);
  const eligibleHelpers = [['round-minor', 'ROUNDING'], ['days-in-month', 'DATE_ARITH']].filter(([, c]) => L.classes.includes(c));
  const nH = Math.min(r.int(L.helperDefects[0], L.helperDefects[1]), eligibleHelpers.length);
  const defectiveHelpers = new Set();
  const count = Object.fromEntries(L.classes.map(c => [c, 0]));
  for (const [id, cls] of r.sample(eligibleHelpers, nH)) { helperSlot(id).role = { kind: 'defect', cls }; defectiveHelpers.add(id); count[cls]++; }
  // enough callers that inherit each helper defect for the root-cause rule to matter (> D/9 of them: see controls.mjs)
  const AFFECTING = { 'round-minor': ['line-amount'], 'days-in-month': ['add-months', 'month-end'] };
  const needAffected = Math.ceil((L.defects + 1) / 9);
  for (const h of defectiveHelpers) {
    while (slots.filter(s => AFFECTING[h].includes(s.family)).length < needAffected) {
      const free = areaSlots();
      if (!free.length) return reject('no-caller-slot');
      r.pick(free).family = r.pick(AFFECTING[h]);
    }
  }
  const callerOfDefective = s => FAMILIES[s.family].kind === 'caller' && defectiveHelpers.has(FAMILIES[s.family].helper);
  const defectsIn = new Map(files.map(f => [f.path, 0]));
  for (const s of slots) if (s.role.kind === 'defect') defectsIn.set(s.file.path, defectsIn.get(s.file.path) + 1);
  const fileIndex = new Map(files.map((f, i) => [f.path, i]));
  const third = path => Math.min(2, Math.floor((3 * fileIndex.get(path)) / files.length));
  const perThird = [0, 0, 0];
  for (const s of slots) if (s.role.kind === 'defect') perThird[third(s.file.path)]++;

  const freeFor = (kind, cls) => slots.filter(s => s.role.kind === 'clean' && !s.file.lib && !callerOfDefective(s) && FAMILIES[s.family].can[kind].includes(cls));
  function place(kind, cls) {
    let cands = freeFor(kind, cls);
    if (!cands.length) { // convert a free self-contained slot into a host of this class
      const hosts = Object.values(FAMILIES).filter(f => f.kind === 'fn' && f.can[kind].includes(cls)).map(f => f.id);
      const free = areaSlots();
      if (!hosts.length || !free.length) return false;
      const s = r.pick(free); s.family = r.pick(hosts); cands = [s];
    }
    let best = cands;
    if (kind === 'defect') { // spread defects: the emptiest third of the files first, then the emptiest file
      const minT = Math.min(...cands.map(s => perThird[third(s.file.path)]));
      best = cands.filter(s => perThird[third(s.file.path)] === minT);
      const minF = Math.min(...best.map(s => defectsIn.get(s.file.path)));
      best = best.filter(s => defectsIn.get(s.file.path) === minF);
    }
    const s = r.pick(best);
    s.role = { kind, cls };
    if (kind === 'defect') { defectsIn.set(s.file.path, defectsIn.get(s.file.path) + 1); perThird[third(s.file.path)]++; }
    return true;
  }
  const plan = [];
  for (const c of L.classes) for (let i = count[c]; i < CLASS_MIN[spec.difficulty]; i++) plan.push(c);
  while (plan.length + Object.values(count).reduce((a, b) => a + b, 0) < L.defects) plan.push(r.pick(L.classes));
  for (const c of r.shuffle(plan)) { if (!place('defect', c)) return reject(`no-host:${c}`); count[c]++; }
  const decoyClasses = L.classes.filter(c => Object.values(FAMILIES).some(f => f.can.decoy.includes(c)));
  const dplan = [...decoyClasses];
  while (dplan.length < L.decoys) dplan.push(r.pick(decoyClasses));
  for (const c of r.shuffle(dplan.slice(0, L.decoys))) if (!place('decoy', c)) return reject(`no-decoy-host:${c}`);

  // ---- instances (helpers first, so callers know their names)
  const name = namer(r);
  const fns = [];
  const ordered = [...slots.filter(s => FAMILIES[s.family].kind === 'helper'), ...slots.filter(s => FAMILIES[s.family].kind !== 'helper')];
  const helperName = {};
  for (const s of ordered) {
    const F = FAMILIES[s.family];
    const fr = r.fork(`${s.file.path}#${s.idx}`);
    const p = F.draw(fr, { house, name }, s.role);
    if (F.kind === 'caller') p.helper = helperName[F.helper];
    if (F.kind === 'helper') helperName[F.id] = p.name;
    fns.push({ path: s.file.path, idx: s.idx, family: F.id, kind: F.kind, helperFamily: F.helper ?? null, role: s.role.kind, cls: s.role.cls ?? null, p,
      smell: s.role.kind === 'clean' ? null : F.smell(p), rng: fr });
  }
  fns.sort((a, b) => a.path.localeCompare(b.path) || a.idx - b.idx);
  for (const f of fns) finishFn(f, house);

  // ---- proof by execution
  const planted = makeContext(fns.map(f => f.plantedSource));
  const correct = makeContext(fns.map(f => f.correctSource));
  for (const f of fns) {
    for (const args of f.probes) if (!argsOk(f, args)) throw new Error(`wbed-r3p: family ${f.family} probe outside its own domain: ${JSON.stringify(args)}`);
    if (f.role === 'clean' && !(f.kind === 'caller' && defectiveHelpers.has(f.helperFamily))) { f.differs = []; continue; }
    f.differs = f.probes.filter(a => !sameObs(observe(planted, f.name, a), observe(correct, f.name, a)));
    if (f.role === 'decoy' && f.differs.length) throw new Error(`wbed-r3p: decoy ${f.family}/${f.p.variant} differs from the correct code on ${JSON.stringify(f.differs[0])}`);
    if (f.role === 'defect') {
      if (!f.differs.length) return reject(`defect-silent:${f.family}/${f.p.variant}`);
      f.witness = f.differs[0];
    }
  }
  for (const f of fns) {
    if (f.kind !== 'caller' || !defectiveHelpers.has(f.helperFamily)) continue;
    f.affected = f.differs.length > 0;
    f.witness = f.affected ? f.differs[0] : null;
  }
  if (fns.filter(f => f.affected).length < needAffected) return reject('too-few-affected-callers');
  const unaffectedExpected = fns.filter(f => f.family === 'sum-lines' && defectiveHelpers.has('round-minor'));
  if (unaffectedExpected.some(f => f.affected)) throw new Error('wbed-r3p: sum-lines must be unaffected by a rounding helper defect');

  // ---- repository extras: tests (non-separating probes only), TODO and note comments (independent of the roles)
  const testCases = f => {
    const out = [];
    for (const a of f.probes) {
      const o = observe(planted, f.name, a);
      if (o.throws || o.returns.includes('"$') || o.argsAfter !== JSON.stringify(a)) continue;
      if ((f.role !== 'clean' || f.differs.length) && !sameObs(o, observe(correct, f.name, a))) continue;
      out.push({ args: a, expected: JSON.parse(o.returns) });
      if (out.length === 2) break;
    }
    return out;
  };
  for (const f of fns) {
    f.tested = r.chance(TESTED_P);
    f.todo = r.chance(TODO_P) ? r.pick(TODOS) : null;
    f.note = r.chance(NOTE_P) ? r.pick(NOTES) : null;
  }
  const defects = fns.filter(f => f.role === 'defect');
  const wantTested = Math.ceil(TESTED_DEFECT_SHARE * defects.length);
  for (const f of fns) { f.testable = f.tested ? testCases(f) : []; if (!f.testable.length) f.tested = false; }
  for (const f of r.shuffle(defects.filter(x => !x.tested))) { // real test suites miss bugs: >= 30% of the defects have green tests
    if (defects.filter(x => x.tested).length >= wantTested) break;
    f.testable = testCases(f);
    f.tested = f.testable.length > 0;
  }
  if (defects.filter(x => x.tested).length < wantTested) return reject('too-few-tested-defects');

  let world = { spec, attempt, L, house, pkg, files: files.map(f => ({ path: f.path, lib: Boolean(f.lib), area: f.area?.dir ?? 'lib' })), fns, planted, correct, defectiveHelpers: [...defectiveHelpers] };
  world.byName = new Map(fns.map(f => [f.name, f]));
  world.manifest = defects.map(f => ({ id: `${f.path}#${f.name}`, file: f.path, function: f.name, class: f.cls, family: f.family, variant: f.p.variant, smell: f.smell, witness: f.witness }));
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  world.render = renderRepo(world);
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

/** Sources and metadata of one function instance. */
function finishFn(f, house) {
  const F = FAMILIES[f.family], p = f.p;
  f.name = p.name;
  f.params = F.sig(p);
  f.contract = F.doc(p);
  f.domain = F.domain(p);
  f.plantedBody = F.body(p, 'planted');
  f.correctBody = F.body(p, 'correct');
  const src = body => `function ${f.name}(${f.params.join(', ')}) {\n${body.split('\n').map(l => `  ${l}`).join('\n')}\n}`;
  f.plantedSource = src(f.plantedBody);
  f.correctSource = src(f.correctBody);
  f.probes = F.probes(p, f.rng);
  f.calls = F.kind === 'caller' ? p.helper : null;
  f.house = house;
  delete f.rng;
}
