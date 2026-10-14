// World model for W-bed R3' "planted-defect sweep" (PROOF-LEDGER J5; PRIOR-ART-MANAGED-AGENTS-DW §3.H, §4). One task is a
// fictional JavaScript repository (src/ with 8/16/32/48 source files by difficulty, two of them src/lib helper modules,
// plus tests, docs/CONVENTIONS.md, README.md and package.json) with planted defects of the in-scope classes and decoys
// (correct code that looks like a defect). The hidden manifest is the list of defects: (file, function, class). Every
// manifest entry is proved by execution here: the planted function differs from the correct one on a valid input (the
// bed's witness), every decoy equals the correct function on every probe, and the callers of a defective helper are
// classified affected (they inherit the wrong behaviour; the root-cause rule says not to report them) or unaffected.
// The oracle, the reference solver and every control derive from buildSweep(seed, split, difficulty).
//
// v1.1 (review 2026-10-14, NOTES §17): no two functions of a repository share a contract template (family, semantic
// knobs and wording; families.mjs); a slot is converted to another family only inside its file's area pool; the
// repository's tests pick their inputs from a shuffled probe list for every role; an execution that times out during
// generation is a generator error, never an observation; the manifest lists the accepted classes of each defect; at
// most LOUD_SHARE of a task's defects are "loud" (a crash, NaN, a changed argument, a wrong error type, or a shared
// helper that a hand-written spec checks: families.mjs `loud`), so generic property checks without the contracts'
// semantics cannot reach the pass threshold; INPUT_MUTATION, whose defects are all loud, keeps its quota minimum only.
import { taskRng } from '../lib/prng.mjs';
import { hooks } from '../lib/faults.mjs';
import { FAMILIES, acceptedClasses } from './families.mjs';
import { LEVELS, MIN_D, MAX_D, CLASS_MIN, AREAS, LIB, NOUNS, PACKAGES, ORGS, TODOS, NOTES } from './vocab.mjs';
import { makeContext, observe, sameObs, argsOk, GEN_TIMEOUT_MS } from './exec.mjs';
import { renderRepo, domainText } from './render.mjs';

export const VERSION = '1.1.0';
export { MIN_D, MAX_D, LEVELS };
const TESTED_P = 0.4, TESTED_DEFECT_SHARE = 0.3, TODO_P = 0.08, NOTE_P = 0.12, TEMPLATE_TRIES = 24;
export const LOUD_SHARE = 0.4;

const worldCache = new Map();
let verifier = null;
export function setVerifier(fn) { verifier = fn; }
export const redrawStats = { attempts: 0, rejects: {}, templateRedraws: 0, templateClashes: 0, quietRedraws: 0 };

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

/** Observation used while generating: a timeout is a generator error (never part of the truth). */
export function obsGen(ctx, name, args) {
  const o = observe(ctx, name, args, GEN_TIMEOUT_MS);
  if (o.throws === 'Timeout') throw new Error(`wbed-r3p: ${name} timed out on ${JSON.stringify(args).slice(0, 200)} during generation`);
  return o;
}

/** The contract template of an instance: its family, contract text, parameter domains and parameter order, with the
 *  parameter names and quoted literals abstracted (what a script grouping "the same contract" would key on). */
export function templateKey(F, p) {
  const d = F.doc(p), dom = F.domain(p), names = F.sig(p);
  let text = [...d.lines, ...d.params, d.returns, ...dom.params.map(domainText)].join(' | ');
  names.forEach((n, i) => { text = text.replace(new RegExp(`\\b${n}\\b`, 'g'), `$${i}`); });
  return `${F.id}|${text.replace(/'[^']*'/g, "'$L'")}|${(p.order ?? []).join(',')}`;
}
const hostsSomething = F => F.can.defect.length > 0 || F.can.decoy.length > 0 || F.kind !== 'fn';

function attemptSweep(spec, attempt) {
  const L = LEVELS[spec.difficulty];
  const r = taskRng('r3p', 'repo', spec, attempt);
  const reject = reason => ({ reject: reason });
  const house = { rounding: r.pick(['HALF_AWAY', 'HALF_EVEN']), band: r.pick(['incl', 'excl']), pageBase: r.pick([1, 0]) };
  const pkg = { org: r.pick(ORGS), name: r.pick(PACKAGES), version: `${r.int(1, 4)}.${r.int(0, 12)}.${r.int(0, 9)}` };

  // ---- files: the helpers' callers need a home inside their own area pools (billing/payments for the money callers,
  // calendar for add-months), so one file of each is drawn first; the rest are drawn from all area files.
  const pairs = AREAS.flatMap(a => a.files.map(f => ({ area: a, path: `src/${a.dir}/${f}.js` })));
  const first = [r.pick(pairs.filter(x => ['billing', 'payments'].includes(x.area.dir))), r.pick(pairs.filter(x => x.area.dir === 'calendar'))];
  const chosen = [...first, ...r.sample(pairs.filter(x => !first.includes(x)), L.files - LIB.length - first.length)].sort((a, b) => a.path.localeCompare(b.path));
  const files = [...LIB.map(l => ({ path: l.path, lib: l, pool: l.families })), ...chosen.map(c => ({ path: c.path, area: c.area, pool: c.area.families }))]
    .sort((a, b) => a.path.localeCompare(b.path));
  const slots = [];
  const callerCap = Math.ceil(L.files / 12) + 1; // instances per caller family: the root-cause trap stays a minority
  for (const f of files) {
    const n = Math.min(r.int(L.fns[0], L.fns[1]), f.pool.length + (f.lib ? 1 : 0));
    const fams = [];
    if (f.lib) fams.push(f.lib.helper);
    while (fams.length < n) {
      const eligible = f.pool.filter(id => !fams.includes(id) && !(FAMILIES[id].kind === 'caller' && slots.filter(s => s.family === id).length >= callerCap));
      if (!eligible.length) break;
      fams.push(r.pick(eligible));
    }
    fams.forEach((id, i) => slots.push({ file: f, idx: i, family: id, role: { kind: 'clean' } }));
  }
  // A clean self-contained slot of an area file may be converted to family `id` only when `id` is in that file's pool
  // and not already in the file (so a converted function is never "out of its area").
  const convertible = id => slots.filter(s => !s.file.lib && s.role.kind === 'clean' && FAMILIES[s.family].kind === 'fn' && s.file.pool.includes(id)
    && !slots.some(o => o.file === s.file && o.family === id));
  for (const need of ['line-amount', 'sum-lines', 'add-months', 'month-end']) { // every helper has callers
    if (slots.some(s => s.family === need)) continue;
    const free = convertible(need);
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
  // enough callers that inherit each helper defect for the root-cause rule to matter: more than the false positives the
  // pass rule tolerates (one, or a ninth of the defects; score.mjs PASS)
  const AFFECTING = { 'round-minor': ['line-amount'], 'days-in-month': ['add-months', 'month-end'] };
  const needAffected = Math.max(2, Math.ceil((L.defects + 1) / 9));
  for (const h of defectiveHelpers) {
    while (slots.filter(s => AFFECTING[h].includes(s.family)).length < needAffected) {
      const options = AFFECTING[h].flatMap(id => convertible(id).map(s => [s, id]));
      if (!options.length) return reject('no-caller-slot');
      const [s, id] = r.pick(options);
      s.family = id;
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
    if (!cands.length) { // convert a free self-contained slot into a host of this class from its own file's pool
      const options = Object.values(FAMILIES).filter(f => f.kind === 'fn' && f.can[kind].includes(cls)).flatMap(f => convertible(f.id).map(s => [s, f.id]));
      if (!options.length) return false;
      const [s, id] = r.pick(options);
      s.family = id; cands = [s];
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
  const fill = L.classes.filter(c => c !== 'INPUT_MUTATION'); // every INPUT_MUTATION defect is loud: quota minimum only
  while (plan.length + Object.values(count).reduce((a, b) => a + b, 0) < L.defects) plan.push(r.pick(fill));
  for (const c of r.shuffle(plan)) { if (!place('defect', c)) return reject(`no-host:${c}`); count[c]++; }
  const decoyClasses = L.classes.filter(c => Object.values(FAMILIES).some(f => f.can.decoy.includes(c)));
  const dplan = [...decoyClasses];
  while (dplan.length < L.decoys) dplan.push(r.pick(decoyClasses));
  for (const c of r.shuffle(dplan.slice(0, L.decoys))) if (!place('decoy', c)) return reject(`no-decoy-host:${c}`);

  // ---- instances (helpers first, so callers know their names; then the always-loud INPUT_MUTATION defects). No two
  // instances share a contract template, and a defect whose variant is loud once the task's loud budget is spent is
  // re-drawn: a forked stream, same role, up to TEMPLATE_TRIES times.
  const name = namer(r);
  const fns = [];
  const isHelper = s => FAMILIES[s.family].kind === 'helper', isIM = s => s.role.kind === 'defect' && s.role.cls === 'INPUT_MUTATION';
  const ordered = [...slots.filter(isHelper), ...slots.filter(s => !isHelper(s) && isIM(s)), ...slots.filter(s => !isHelper(s) && !isIM(s))];
  const helperName = {};
  const templates = new Set();
  const loudCap = Math.floor(LOUD_SHARE * L.defects);
  let loud = 0;
  for (const s of ordered) {
    const F = FAMILIES[s.family];
    const base = r.fork(`${s.file.path}#${s.idx}`);
    let p = null, fr = base, key = null;
    for (let k = 0; ; k++) {
      fr = k ? base.fork(`again-${k}`) : base;
      p = F.draw(fr, { house, name, split: spec.split }, s.role);
      if (F.kind === 'caller') p.helper = helperName[F.helper];
      const tooLoud = s.role.kind === 'defect' && F.loud.includes(p.variant) && loud >= loudCap;
      key = hostsSomething(F) ? templateKey(F, p) : null;
      const clash = key !== null && templates.has(key);
      if ((!tooLoud && !clash) || k === TEMPLATE_TRIES) { if (clash) redrawStats.templateClashes++; break; }
      if (clash) redrawStats.templateRedraws++; else redrawStats.quietRedraws++;
    }
    if (key) templates.add(key);
    if (s.role.kind === 'defect' && F.loud.includes(p.variant)) loud++;
    if (F.kind === 'helper') helperName[F.id] = p.name;
    fns.push({ path: s.file.path, idx: s.idx, family: F.id, kind: F.kind, helperFamily: F.helper ?? null, role: s.role.kind, cls: s.role.cls ?? null, p,
      smell: s.role.kind === 'clean' ? null : F.smell(p), loud: s.role.kind === 'defect' && F.loud.includes(p.variant), rng: fr, template: key });
  }
  if (loud > loudCap) return reject('too-many-loud');
  fns.sort((a, b) => a.path.localeCompare(b.path) || a.idx - b.idx);
  for (const f of fns) finishFn(f, house);

  // ---- proof by execution
  const planted = makeContext(fns.map(f => f.plantedSource));
  const correct = makeContext(fns.map(f => f.correctSource));
  for (const f of fns) {
    for (const args of f.probes) if (!argsOk(f, args)) throw new Error(`wbed-r3p: family ${f.family} probe outside its own domain: ${JSON.stringify(args)}`);
    if (f.role === 'clean' && !(f.kind === 'caller' && defectiveHelpers.has(f.helperFamily))) { f.differs = []; continue; }
    f.differs = f.probes.filter(a => !sameObs(obsGen(planted, f.name, a), obsGen(correct, f.name, a)));
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

  // ---- repository extras: tests (non-separating probes only, taken from a shuffled probe list whatever the role), TODO
  // and note comments (independent of the roles)
  const testCases = f => {
    const out = [];
    for (const a of r.shuffle(f.probes)) {
      const o = obsGen(planted, f.name, a);
      if (o.throws || o.negZero || o.returns.includes('"$') || o.argsAfter !== JSON.stringify(a)) continue; // a -0 result would need Object.is in the test
      if ((f.role !== 'clean' || f.differs.length) && !sameObs(o, obsGen(correct, f.name, a))) continue;
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
  world.manifest = defects.map(f => ({ id: `${f.path}#${f.name}`, file: f.path, function: f.name, class: f.cls, accepted: acceptedClasses(f.family, f.p.variant, f.cls),
    family: f.family, variant: f.p.variant, smell: f.smell, loud: f.loud, witness: f.witness }));
  world = hooks.schemaDrift(world); // R8 f1 hook point (no-op in v1)
  world.render = renderRepo(world);
  if (verifier) {
    const bad = verifier(world);
    if (bad) return reject(`control-passes:${bad}`);
  }
  return world;
}

/** Sources and metadata of one function instance. A family's `p.order` permutes the parameters: the signature, the
 *  JSDoc @param lines, the domain specs (and the cross-argument condition) and the probes follow it. */
function finishFn(f, house) {
  const F = FAMILIES[f.family], p = f.p;
  const perm = p.order ?? null, P = xs => (perm ? perm.map(i => xs[i]) : xs);
  const unP = a => { if (!perm) return a; const out = []; perm.forEach((i, j) => { out[i] = a[j]; }); return out; };
  f.name = p.name;
  f.params = P(F.sig(p));
  const c = F.doc(p);
  f.contract = { ...c, params: P(c.params) };
  const dom = F.domain(p);
  f.domain = { params: P(dom.params), ...(dom.where ? { where: a => dom.where(unP(a)) } : {}) };
  f.plantedBody = F.body(p, 'planted');
  f.correctBody = F.body(p, 'correct');
  const src = body => `function ${f.name}(${f.params.join(', ')}) {\n${body.split('\n').map(l => `  ${l}`).join('\n')}\n}`;
  f.plantedSource = src(f.plantedBody);
  f.correctSource = src(f.correctBody);
  f.probes = F.probes(p, f.rng).map(P);
  f.calls = F.kind === 'caller' ? p.helper : null;
  f.house = house;
  delete f.rng;
}
