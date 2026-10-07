// Offline: build the ownerci mutant catalog (fixtures/catalog.json).
//
//   node beds/ownerci/build-catalog.mjs [--concurrency=3] [--modules=verdict,stats]
//
// For every frozen module it enumerates token-level mutants (mutate.mjs), runs the frozen visible
// tests plus the hidden tests against each mutant in a child process (runner.mjs, 60 s wall
// timeout), and KEEPS a mutant only if (a) at least one test fails, (b) the module still parses
// and imports (every expected test reports), (c) not every visible test and not every hidden test
// fails, and (d) for a deleted guard clause, the throw it removed can be restored from visible
// material (see `guardInferable`). It then assembles and validates multi-mutant combinations for
// difficulty 3 (two visible-killed mutants), 4 (two visible + one hidden-only) and 5 (one visible
// + two hidden-only), running each combination and its near-miss variant once so that the CI
// report and the controls rest on observed results. Mutants are trusted host-generated code; the
// runner still isolates them like candidates. Nothing here runs at generate()/oracle() time.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODULES, MODULE_IDS } from './modules.mjs';
import { FIXTURES, classify, fixtureFiles, runAsync, sandboxAvailable } from './runner.mjs';
import { applyEdits, enumerateMutations, lineDiff, tokenize } from './mutate.mjs';
import { rng } from '../lib/rng.mjs';
import { sha256 } from '../lib/canonical.mjs';

const argv = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const CONCURRENCY = Number(argv.concurrency ?? 3);
const ONLY = argv.modules ? argv.modules.split(',') : MODULE_IDS;
// --reuse-mutants keeps the kept mutants (and their observed results) of the committed catalog and
// rebuilds only the combinations of --difficulties (default 3,4,5). A full build gives the same
// mutants (the runs are deterministic), so this is a shortcut, not a different catalog.
const REUSE = 'reuse-mutants' in argv;
const DIFFS = argv.difficulties ? argv.difficulties.split(',').map(Number) : [3, 4, 5];
const OUT = path.join(FIXTURES, 'catalog.json');
export const CATALOG_VERSION = 2; // 2: masked d3 pairs (AUDIT.md F5)
const SLOW_MS = 15000;
const TARGETS = { 3: 40, 4: 30, 5: 30 };
// Operators allowed for a hidden-only (visible-silent) mutant: the mutated token must look
// locally wrong to a careful reader; constants whose correct value nothing in the inputs reveals
// (limits, defaults) and deleted guards are never silent.
// An argument swap is only silent-eligible when exactly one of the two arguments is a literal
// (`f('CODE', message)`, `subarray(0, end)`): swapping two variables (`rng(seed, armA, armB)`)
// can be indistinguishable from the original order without the tests.
const SILENT_OK = new Set(['cmp-flip', 'logic-swap', 'negation-removal', 'bool-swap']);
const isLiteral = s => /^(?:['"`]|-?\d|true\b|false\b|null\b|undefined\b)/.test(s.trim());
function silentEligible(m) {
  if (SILENT_OK.has(m.operator)) return true;
  if (m.operator === 'off-by-one') return /length/.test(m.note) || /^[01] -> /.test(m.note);
  if (m.operator === 'arg-swap') {
    const [a, b] = m.note.replace(/^swap /, '').split(' <-> ');
    return b !== undefined && isLiteral(a) !== isLiteral(b);
  }
  return false;
}
// Difficulty 3 (catalog v2, AUDIT.md F5): MASKED pairs. Both mutants are visible-killed, alone
// each fails exactly the same visible tests, and together they fail that same set, so fixing either
// one alone turns no visible test green (a solver that fixes the first symptom and re-runs, or a
// search that keeps any single edit that turns a test green, makes no progress). Their hidden
// failing sets differ. Because one member may have no symptom of its own in the CI report, both
// must be silent-eligible (the mutated token looks locally wrong to a careful reader).
const sameVisible = (a, b) => a.visibleFailing.join('\u0001') === b.visibleFailing.join('\u0001');
// In a combination at d4-d5 every visible-killed mutant must leave its own trace in the CI report (a
// failing test the other visible mutants do not cause) and must not turn most of the suite red.
const ownTrace = (m, others) => m.visibleFailing.some(n => others.every(o => !o.visibleFailing.includes(n)));
const notMostlyRed = (m, total) => m.visibleFailing.length <= Math.max(1, Math.floor(total * 0.75));

async function pool(items, worker, n = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
      if (++done % 50 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }));
  return out;
}

const kindOf = v => typeof v === 'function' ? (/^class[\s{]/.test(Function.prototype.toString.call(v)) ? 'class' : 'function')
  : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
async function exportsSpecOf(id) {
  const mod = await import(pathToFileURL(path.join(FIXTURES, id, MODULES[id].modulePath)).href);
  return Object.keys(mod).sort().map(name => {
    const v = mod[name], kind = kindOf(v);
    const spec = { name, kind };
    if (kind === 'function' || kind === 'class') spec.arity = v.length;
    if (kind === 'function' && v.constructor?.name === 'AsyncFunction') spec.async = true;
    if (kind === 'class') {
      spec.methods = Object.fromEntries(Object.getOwnPropertyNames(v.prototype).filter(k => k !== 'constructor' && typeof v.prototype[k] === 'function')
        .sort().map(k => [k, v.prototype[k].length]));
    }
    return spec;
  });
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TMP_RE = new RegExp(`(?:file://)?${escapeRe(tmpdir())}/ownerci-[a-z-]+-[A-Za-z0-9]{6}/`, 'g');
const norm = s => String(s ?? '').replace(TMP_RE, '{ROOT}/');
function failureRecord(t) {
  const e = t.error ?? {};
  const stack = norm(e.stack);
  const at = stack.indexOf('\n    at ');
  let head = at >= 0 ? stack.slice(0, at) : (stack || `${e.name ?? 'Error'}: ${norm(e.message)}`);
  if (head.length > 1200) head = `${head.slice(0, 1200)}\n... (message truncated)`;
  const frames = at >= 0 ? stack.slice(at + 1).split('\n').map(l => l.trim()).filter(l => l.startsWith('at ')).slice(0, 8) : [];
  return { name: t.name, line: t.line, column: t.column, error: { name: e.name ?? null, code: e.causeCode ?? null, head, frames } };
}

function summarize(id, run, expected) {
  if (!run.ok) return { ok: false, reason: `runner: ${run.error}` };
  const { visible, hidden } = classify(id, run);
  const missingV = expected.visible.filter(n => !visible.has(n)), missingH = expected.hidden.filter(n => !hidden.has(n));
  if (missingV.length || missingH.length) return { ok: false, reason: 'does not import or parse (expected tests missing)' };
  const visibleFailing = expected.visible.filter(n => visible.get(n).status !== 'pass');
  const hiddenFailing = expected.hidden.filter(n => hidden.get(n).status !== 'pass');
  return { ok: true, visibleFailing, hiddenFailing, failures: visibleFailing.map(n => failureRecord(visible.get(n))), wallMs: run.wallMs };
}

const lineRange = (src, m) => [src.slice(0, m.start).split('\n').length, src.slice(0, Math.max(m.start, m.end - 1)).split('\n').length];

// A deleted guard is restorable when every string it removed already appears in the visible
// material, or when restoring it with a generic message passes every test.
function guardLiterals(snippet) {
  const toks = tokenize(snippet), out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'string') out.push({ tok: { type: 'string', start: t.start, end: t.end }, parts: [t.value.slice(1, -1)] });
    if (t.type !== 'template' || !t.value.startsWith('`')) continue;
    // a template literal with substitutions is several template tokens: `head${ ... }mid${ ... }tail`
    let j = i;
    while (!(toks[j].type === 'template' && toks[j].value.endsWith('`') && (j > i || t.value.length > 1))) j++;
    const parts = toks.slice(i, j + 1).filter(x => x.type === 'template').map(x => x.value.slice(1, x.value.endsWith('${') ? -2 : -1)).filter(p => p.length >= 4);
    out.push({ tok: { type: 'template', start: t.start, end: toks[j].end }, parts });
    i = j;
  }
  return out;
}
async function guardInferable(id, original, m, mutated, expected) {
  const files = fixtureFiles(id), mod = MODULES[id];
  const visibleText = [mutated, files[mod.testPath], ...mod.related.map(r => files[r])].join('\n');
  const deleted = original.slice(m.start, m.end);
  const lits = guardLiterals(deleted);
  const missing = lits.filter(l => !l.parts.every(p => visibleText.includes(p)));
  if (!missing.length) return { ok: true, how: 'literals visible' };
  let generic = deleted;
  for (const l of missing.sort((a, b) => b.tok.start - a.tok.start)) {
    generic = generic.slice(0, l.tok.start) + (l.tok.type === 'string' ? '\'invalid input\'' : '`invalid input`') + generic.slice(l.tok.end);
  }
  const variant = original.slice(0, m.start) + generic + original.slice(m.end);
  const s = summarize(id, await runAsync(id, variant), expected);
  return s.ok && !s.visibleFailing.length && !s.hiddenFailing.length ? { ok: true, how: 'generic message passes' } : { ok: false };
}

async function buildModule(id) {
  const mod = MODULES[id];
  const original = fixtureFiles(id)[mod.modulePath];
  const exportsSpec = await exportsSpecOf(id);
  const base = await runAsync(id, original, { exportsSpec });
  const { visible, hidden, guard } = classify(id, base);
  if (!base.ok || guard?.status !== 'pass') throw new Error(`${id}: original failed to run: ${base.error ?? JSON.stringify(guard)}`);
  const expected = { visible: [...visible.keys()], hidden: [...hidden.keys()] };
  const bad = [...visible.values(), ...hidden.values()].filter(t => t.status !== 'pass');
  if (bad.length) throw new Error(`${id}: original fails ${bad.map(t => t.name).join(', ')}`);
  if (new Set(expected.visible).size !== expected.visible.length || new Set(expected.hidden).size !== expected.hidden.length) throw new Error(`${id}: duplicate test names`);
  process.stderr.write(`${id}: ${expected.visible.length} visible, ${expected.hidden.length} hidden tests; original ${base.wallMs} ms\n`);

  const candidates = enumerateMutations(original);
  const seen = new Map();
  const unique = [];
  for (const c of candidates) {
    const src = applyEdits(original, [c]);
    if (seen.has(src)) continue;
    seen.set(src, true);
    unique.push({ ...c, src });
  }
  const stats = { enumerated: candidates.length, unique: unique.length, kept: 0, discarded: {} };
  const discard = why => { stats.discarded[why] = (stats.discarded[why] ?? 0) + 1; return null; };
  const results = await pool(unique, async c => {
    const s = summarize(id, await runAsync(id, c.src), expected);
    if (!s.ok) return discard(s.reason.startsWith('runner') ? 'runner error or timeout' : 'does not import');
    if (s.wallMs > SLOW_MS) return discard('slow (> 15 s)');
    if (!s.visibleFailing.length && !s.hiddenFailing.length) return discard('no test fails (equivalent or untested)');
    if (s.visibleFailing.length === expected.visible.length) return discard('every visible test fails');
    if (s.hiddenFailing.length === expected.hidden.length) return discard('every hidden test fails');
    if (c.operator === 'guard-delete') {
      const g = await guardInferable(id, original, c, c.src, expected);
      if (!g.ok) return discard('deleted guard not restorable from visible material');
      c.guard = g.how;
    }
    return { c, s };
  });
  const mutants = [];
  for (const r of results) {
    if (!r) continue;
    const { c, s } = r;
    const [lineStart, lineEnd] = lineRange(original, c);
    mutants.push({
      id: `${id}-m${String(mutants.length + 1).padStart(3, '0')}`, module: id, operator: c.operator, note: c.note, line: c.line, lineStart, lineEnd,
      edit: { start: c.start, end: c.end, replacement: c.replacement }, from: original.slice(c.start, c.end),
      diff: lineDiff(original, c.src, mod.modulePath), visibleFailing: s.visibleFailing, hiddenFailing: s.hiddenFailing,
      silentEligible: silentEligible(c), ...(c.guard ? { guardRestorable: c.guard } : {}), failures: s.failures,
    });
  }
  stats.kept = mutants.length;
  return { info: { modulePath: mod.modulePath, testPath: mod.testPath, related: mod.related, visibleTests: expected.visible, hiddenTests: expected.hidden,
    exports: exportsSpec, originalSha256: sha256(original), originalLines: original.split('\n').length, stats }, mutants, expected, original };
}

const disjoint = (a, b) => (a.edit.end <= b.edit.start || b.edit.end <= a.edit.start) && (a.lineEnd < b.lineStart || b.lineEnd < a.lineStart);
const sig = m => `${m.visibleFailing.join('\u0001')}\u0002${m.hiddenFailing.join('\u0001')}`;

async function buildCombos(id, built) {
  const { mutants, expected, original } = built;
  const visibleK = mutants.filter(m => m.visibleFailing.length && notMostlyRed(m, expected.visible.length));
  const silent = mutants.filter(m => !m.visibleFailing.length && m.silentEligible);
  const r = rng('ownerci-combos', id);
  const maskedPairs = [];
  for (let i = 0; i < visibleK.length; i++) for (let j = i + 1; j < visibleK.length; j++) {
    const [a, b] = [visibleK[i], visibleK[j]];
    if (a.silentEligible && b.silentEligible && sameVisible(a, b) && disjoint(a, b) && sig(a) !== sig(b)) maskedPairs.push([a, b]);
  }
  const maskedOrder = r.shuffle(maskedPairs);
  let maskedNext = 0;
  const shapes = {
    3: () => maskedOrder[maskedNext++] ?? [null],
    4: () => [r.pick(visibleK), r.pick(visibleK), r.pick(silent)],
    5: () => [r.pick(visibleK), r.pick(silent), r.pick(silent)],
  };
  const combos = { 3: [], 4: [], 5: [] };
  for (const d of DIFFS) {
    if (!visibleK.length || (d >= 4 && silent.length < d - 3)) continue;
    const proposals = [], keys = new Set();
    for (let attempt = 0; attempt < 4000 && proposals.length < TARGETS[d] * 2; attempt++) {
      const ms = shapes[d]();
      if (!ms.every(m => m)) break;
      let ok = true;
      for (let i = 0; i < ms.length && ok; i++) for (let j = i + 1; j < ms.length && ok; j++) {
        if (ms[i] === ms[j] || !disjoint(ms[i], ms[j]) || sig(ms[i]) === sig(ms[j])) ok = false;
      }
      const vis = ms.filter(m => m.visibleFailing.length);
      if (ok && d >= 4 && vis.length > 1 && !vis.every(m => ownTrace(m, vis.filter(o => o !== m)))) ok = false;
      if (!ok) continue;
      const key = ms.map(m => m.id).sort().join('+');
      if (keys.has(key)) continue;
      keys.add(key); proposals.push(ms);
    }
    const validated = await pool(proposals, async ms => {
      const src = applyEdits(original, ms.map(m => m.edit));
      const s = summarize(id, await runAsync(id, src), expected);
      if (!s.ok || !s.visibleFailing.length || s.visibleFailing.length === expected.visible.length || s.wallMs > SLOW_MS) return null;
      // d3: the masking must hold in the combination itself (same failing set as each member)
      if (d === 3 && !ms.every(m => sameVisible(m, s))) return null;
      const rest = ms.slice(1);
      let nearMiss;
      if (rest.length === 1) nearMiss = { visibleFailing: rest[0].visibleFailing, hiddenFailing: rest[0].hiddenFailing };
      else {
        const n = summarize(id, await runAsync(id, applyEdits(original, rest.map(m => m.edit))), expected);
        if (!n.ok) return null;
        nearMiss = { visibleFailing: n.visibleFailing, hiddenFailing: n.hiddenFailing };
      }
      if (!nearMiss.visibleFailing.length && !nearMiss.hiddenFailing.length) return null;
      const silentOnes = ms.filter(m => !m.visibleFailing.length);
      let visibleOnlyFix = null;
      if (silentOnes.length) {
        const v = silentOnes.length === 1 ? silentOnes[0] : summarize(id, await runAsync(id, applyEdits(original, silentOnes.map(m => m.edit))), expected);
        if (v.ok === false || !v.hiddenFailing.length) return null;
        visibleOnlyFix = { visibleFailing: v.visibleFailing, hiddenFailing: v.hiddenFailing };
      }
      return { mutants: ms.map(m => m.id), ...(d === 3 ? { masked: true } : {}), visibleFailing: s.visibleFailing, hiddenFailing: s.hiddenFailing, failures: s.failures, nearMiss, visibleOnlyFix };
    });
    combos[d] = validated.filter(Boolean).slice(0, TARGETS[d]).map((c, i) => ({ id: `${id}-d${d}-c${String(i + 1).padStart(2, '0')}`, module: id, ...c }));
    process.stderr.write(`${id}: d${d} ${combos[d].length} combos from ${proposals.length} proposals\n`);
  }
  return combos;
}

async function reuseMain() {
  const started = performance.now();
  const catalog = JSON.parse(readFileSync(OUT, 'utf8'));
  catalog.version = CATALOG_VERSION;
  catalog.node = process.version;
  for (const d of DIFFS) catalog.combos[d] = catalog.combos[d].filter(c => !ONLY.includes(c.module));
  for (const id of ONLY) {
    const info = catalog.modules[id];
    const original = fixtureFiles(id)[MODULES[id].modulePath];
    if (sha256(original) !== info.originalSha256) throw new Error(`${id}: catalog was built from a different module`);
    const built = { mutants: catalog.mutants.filter(m => m.module === id), expected: { visible: info.visibleTests, hidden: info.hiddenTests }, original };
    const combos = await buildCombos(id, built);
    for (const d of DIFFS) catalog.combos[d].push(...combos[d]);
  }
  for (const d of DIFFS) catalog.combos[d].sort((a, b) => MODULE_IDS.indexOf(a.module) - MODULE_IDS.indexOf(b.module) || (a.id < b.id ? -1 : 1));
  catalog.combosRebuiltSeconds = Math.round((performance.now() - started) / 1000);
  writeFileSync(OUT, `${JSON.stringify(catalog)}\n`);
  process.stderr.write(`rewrote combos d${DIFFS.join(',d')} in ${OUT}: d3 ${catalog.combos[3].length} d4 ${catalog.combos[4].length} d5 ${catalog.combos[5].length}\n`);
}

async function main() {
  if (REUSE) return reuseMain();
  const started = performance.now();
  process.stderr.write(`sandbox: ${sandboxAvailable() ? 'unshare user+net namespace' : 'plain child process'}; concurrency ${CONCURRENCY}\n`);
  const catalog = { version: CATALOG_VERSION, generatedBy: 'beds/ownerci/build-catalog.mjs', node: process.version,
    note: 'Kept mutants of frozen workflow-foundry modules. Edits are offsets into the frozen module (fixtures/<module>/<modulePath>). Failure records are '
      + 'the observed node:test results of the visible suite with temp paths replaced by {ROOT}.', modules: {}, mutants: [], combos: { 3: [], 4: [], 5: [] } };
  for (const id of ONLY) {
    const built = await buildModule(id);
    catalog.modules[id] = built.info;
    catalog.mutants.push(...built.mutants);
    const combos = await buildCombos(id, built);
    for (const d of [3, 4, 5]) catalog.combos[d].push(...combos[d]);
    const st = built.info.stats;
    process.stderr.write(`${id}: kept ${st.kept}/${st.unique} unique (${st.enumerated} enumerated) ${JSON.stringify(st.discarded)}\n`);
  }
  catalog.buildSeconds = Math.round((performance.now() - started) / 1000);
  writeFileSync(OUT, `${JSON.stringify(catalog)}\n`);
  process.stderr.write(`wrote ${OUT}: ${catalog.mutants.length} mutants, combos d3 ${catalog.combos[3].length} d4 ${catalog.combos[4].length} d5 ${catalog.combos[5].length} in ${catalog.buildSeconds}s\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
