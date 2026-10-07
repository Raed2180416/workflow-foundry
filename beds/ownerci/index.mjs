// ownerci bed: repair a workflow-foundry module that a pull request broke, from a CI job
// summary, the frozen visible tests and the read-only modules it imports (see README.md).
import { readFileSync } from 'node:fs';
import { MODULES, MODULE_IDS } from './modules.mjs';
import { classify, fixtureFiles, runSync, sandboxAvailable, GUARD_TEST } from './runner.mjs';
import { applyEdits, tokenize } from './mutate.mjs';
import { renderPrompt, renderReport } from './render.mjs';
import { rng } from '../lib/rng.mjs';

export const VERSION = '1.0.0';
const CATALOG = JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('./fixtures/MANIFEST.json', import.meta.url), 'utf8'));
export const FROZEN_COMMIT = MANIFEST.commit;

export const family = {
  id: 'ownerci',
  domain: 'CI-failure repair on the owner repository',
  version: VERSION,
  description: 'Repair a frozen workflow-foundry module (6 modules, 40-140 lines) broken by 1-3 injected token-level mutants, from a realistic CI job '
    + 'summary, the frozen node:test suite and read-only imports; scored by the visible plus hidden node:test suites in a no-network child process '
    + 'and an export/arity/size/anti-hack diff guard.',
  kind: 'oneshot',
};

export const outputSchema = {
  type: 'object',
  required: ['patched_source'],
  additionalProperties: false,
  properties: {
    patched_source: { type: 'string', description: 'The complete corrected contents of the module at inputs.module_path.' },
  },
};

// Operators that count as "easy" for difficulty 1 (a single token whose fault the failing
// assertion points at). Difficulty 2 draws from every other visible-killed single mutant.
const EASY = new Set(['cmp-flip', 'logic-swap', 'negation-removal', 'bool-swap', 'off-by-one']);
export const KNOBS = Object.freeze({
  1: Object.freeze({ mutants: 1, pool: 'single visible-killed mutant, easy operator, <= 3 failing visible tests', frames: 6, noise: false, hiddenOnly: 0 }),
  2: Object.freeze({ mutants: 1, pool: 'single visible-killed mutant not in the d1 pool', frames: 2, noise: false, hiddenOnly: 0 }),
  3: Object.freeze({ mutants: 2, pool: 'validated pair, both visible-killed, different failing sets', frames: 4, noise: true, hiddenOnly: 0 }),
  4: Object.freeze({ mutants: 3, pool: 'validated triple: two visible-killed + one hidden-only', frames: 4, noise: true, hiddenOnly: 1 }),
  5: Object.freeze({ mutants: 3, pool: 'validated triple: one visible-killed + two hidden-only', frames: 4, noise: true, hiddenOnly: 2 }),
});

const MUTANTS = new Map(CATALOG.mutants.map(m => [m.id, m]));
const POOLS = (() => {
  const pools = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
  for (const id of MODULE_IDS) {
    if (!CATALOG.modules[id]) continue;
    const singles = CATALOG.mutants.filter(m => m.module === id && m.visibleFailing.length);
    const easy = singles.filter(m => EASY.has(m.operator) && m.visibleFailing.length <= 3);
    pools[1][id] = easy.map(m => ({ mutants: [m.id] }));
    pools[2][id] = singles.filter(m => !easy.includes(m)).map(m => ({ mutants: [m.id] }));
    for (const d of [3, 4, 5]) pools[d][id] = CATALOG.combos[d].filter(c => c.module === id);
  }
  for (const d of [1, 2, 3, 4, 5]) for (const id of Object.keys(pools[d])) if (!pools[d][id].length) delete pools[d][id];
  return pools;
})();
export const POOL_SIZES = Object.freeze(Object.fromEntries(Object.entries(POOLS).map(([d, p]) => [d, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.length]))])));

// Module choice: at d1-d2 proportional to the pool (capped at 20, so a module with 3 instances is
// rarely repeated); from d3 the two larger modules (context, schema-subset: ~100-140 lines plus
// larger tests and imports) count double, which raises reading load with difficulty.
const LARGE = new Set(['context', 'schema-subset']);
export function moduleWeight(difficulty, id) {
  if (difficulty <= 2) return Math.min(20, POOLS[difficulty][id]?.length ?? 0);
  return LARGE.has(id) ? 2 : 1;
}
const taskKey = task => ({ seed: task.seed, split: task.split, difficulty: task.difficulty });
const originalOf = id => fixtureFiles(id)[MODULES[id].modulePath];

/** Rebuild the hidden instance for (seed, split, difficulty). Trusted host code only. */
export function instance({ seed, split, difficulty }) {
  if (split !== 'dev' && split !== 'test') throw new Error(`ownerci: split must be dev or test, got ${split}`);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`ownerci: difficulty must be 1..5, got ${difficulty}`);
  if (!Number.isSafeInteger(seed)) throw new Error(`ownerci: seed must be an integer, got ${seed}`);
  const r = rng('ownerci', VERSION, split, difficulty, seed);
  const modules = Object.keys(POOLS[difficulty]).sort();
  if (!modules.length) throw new Error(`ownerci: no instances for difficulty ${difficulty}`);
  const weights = modules.map(id => moduleWeight(difficulty, id));
  let x = r.next() * weights.reduce((a, b) => a + b, 0), k = 0;
  while (k < modules.length - 1 && x >= weights[k]) { x -= weights[k]; k++; }
  const module = modules[k];
  const entry = r.pick(POOLS[difficulty][module]);
  const mutants = entry.mutants.map(id => MUTANTS.get(id));
  const original = originalOf(module);
  const mutated = applyEdits(original, mutants.map(m => m.edit));
  const observed = entry.failures ? entry : mutants[0];
  return { module, mutants, combo: entry.failures ? entry : null, original, mutated, failures: observed.failures,
    visibleFailing: observed.visibleFailing, hiddenFailing: observed.hiddenFailing, r: r.fork('render') };
}

export function generate({ seed, split, difficulty }) {
  const inst = instance({ seed, split, difficulty });
  const m = MODULES[inst.module];
  const info = CATALOG.modules[inst.module];
  const files = fixtureFiles(inst.module);
  // Unrelated passing suites: other frozen modules' visible tests from the same job (src/ modules
  // run under `npm test`, experiments/lib modules under the experiments job).
  const sameJob = p => p.startsWith('experiments/') === m.testPath.startsWith('experiments/');
  const others = inst.r.shuffle(MODULE_IDS.filter(id => id !== inst.module && CATALOG.modules[id] && MODULES[id].testPath !== m.testPath && sameJob(MODULES[id].testPath)))
    .map(id => ({ testPath: MODULES[id].testPath, visibleTests: CATALOG.modules[id].visibleTests }));
  const report = renderReport({
    r: inst.r, difficulty,
    module: { id: inst.module, modulePath: m.modulePath, testPath: m.testPath, visibleTests: info.visibleTests },
    failures: inst.failures, hiddenFailCount: inst.hiddenFailing.length, others,
  });
  const related = Object.fromEntries(m.related.map(rel => [rel, files[rel]]));
  const inputs = { module_path: m.modulePath, module_source: inst.mutated, test_path: m.testPath, test_source: files[m.testPath], related_sources: related };
  return {
    id: `ownerci-${split}-d${difficulty}-s${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: renderPrompt({ module: m, report, difficulty }),
    inputs,
    files: { [m.modulePath]: inst.mutated, [m.testPath]: files[m.testPath], ...related, 'ci/job-summary.txt': report },
    budget: { suggestedOutputTokens: Math.ceil(inst.mutated.length / 3) + 500 },
  };
}

// Read the answer once, as an own data property of a plain JSON value (an inherited property,
// a getter or a non-JSON object is schema-invalid).
function readOutput(output) {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return null;
  let plain;
  try { plain = JSON.parse(JSON.stringify(output)); } catch { return null; }
  if (plain === null || typeof plain !== 'object' || Array.isArray(plain)) return null;
  const keys = Object.keys(plain);
  if (keys.length !== 1 || keys[0] !== 'patched_source' || !Object.hasOwn(output, 'patched_source')) return null;
  const desc = Object.getOwnPropertyDescriptor(output, 'patched_source');
  if (!desc || !('value' in desc) || typeof desc.value !== 'string' || desc.value !== plain.patched_source) return null;
  return plain.patched_source;
}

// Diff guard (static part). Strings from the task specification, plus a few equivalents that
// reach the same capabilities; each is allowed only if the original module already contains it.
export const BANNED = Object.freeze([
  ['node:test', /node:test/], ['process.env', /process\s*\.\s*env/], ['process.argv', /process\s*\.\s*argv/], ['process.exit', /process\s*\.\s*exit/],
  ['require.cache', /require\s*\.\s*cache/], ['globalThis', /globalThis/],
  ['process (any use)', /\bprocess\b/], ['global object', /\bglobal\s*[.[]/], ['child_process', /child_process/], ['node:fs', /['"](?:node:)?fs(?:\/promises)?['"]/],
  ['worker_threads', /worker_threads/], ['node:vm', /['"](?:node:)?vm['"]/], ['dynamic import()', /\bimport\s*\(/], ['eval', /\beval\s*\(/],
  ['Function constructor', /\bFunction\s*\(/], ['require()', /\brequire\s*\(/], ['test-runner detection', /NODE_TEST|node:test|--test/],
  ['timers', /\bset(?:Interval|Timeout|Immediate)\b/], ['import.meta', /\bimport\s*\.\s*meta\b/],
]);
// Free identifiers that reach the host (the global object, the process, code generation). A
// property name after `.` (`row.global`) is not a free identifier and is allowed.
export const BANNED_IDENTIFIERS = Object.freeze(['process', 'globalThis', 'global', 'eval', 'Function', 'require', 'module', 'exports',
  '__dirname', '__filename', 'Deno', 'Bun']);
const exportRe = name => new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${name}\\b|\\bexport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);

// Module specifiers of static `import ... from 'x'`, `import 'x'` and `export ... from 'x'`
// (a string token right after `from` or `import`), as cooked values.
function moduleSpecifiers(toks) {
  const out = [];
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    if (t.type === 'string' && prev?.type === 'ident' && (prev.value === 'from' || prev.value === 'import') && toks[k - 2]?.value !== '.') out.push(t.value.slice(1, -1));
  });
  return out;
}
const originalTokens = new Map();
function tokensOfOriginal(moduleId) {
  if (!originalTokens.has(moduleId)) originalTokens.set(moduleId, tokenize(originalOf(moduleId)));
  return originalTokens.get(moduleId);
}

export function staticGuard(moduleId, src) {
  const original = originalOf(moduleId);
  const v = [];
  if (src.length < original.length / 2 || src.length > original.length * 2) v.push(`size ${src.length} outside [0.5x, 2x] of the original ${original.length}`);
  // The guard reads code through the bed's tokenizer (comments, strings, templates and regex
  // literals are separated from code). A source it cannot tokenize, for example one with a
  // unicode escape in an identifier (\u0070rocess), is rejected rather than read as raw text.
  let toks;
  try { toks = tokenize(src); } catch (e) { v.push(`source could not be tokenized by the guard (${String(e.message).slice(0, 80)}); escapes in identifiers are not allowed`); return v; }
  const origToks = tokensOfOriginal(moduleId);
  const code = toks.map(t => t.value).join(' '), originalCode = origToks.map(t => t.value).join(' ');
  for (const [label, re] of BANNED) if (re.test(code) && !re.test(originalCode)) v.push(`contains ${label}`);
  const freeIdents = ts => new Set(ts.filter((t, k) => t.type === 'ident' && ts[k - 1]?.value !== '.' && ts[k - 1]?.value !== '?.').map(t => t.value));
  const used = freeIdents(toks), originalUsed = freeIdents(origToks);
  for (const name of BANNED_IDENTIFIERS) if (used.has(name) && !originalUsed.has(name)) v.push(`uses the identifier ${name}`);
  // Imports: only the module specifiers the original module imports (same modules, any quotes).
  const allowed = new Set(moduleSpecifiers(origToks));
  for (const spec of moduleSpecifiers(toks)) {
    if (spec.includes('\\')) v.push(`import specifier with an escape sequence: ${spec.slice(0, 60)}`);
    else if (!allowed.has(spec)) v.push(`imports ${spec.slice(0, 60)}, which the original module does not import`);
  }
  for (const e of CATALOG.modules[moduleId].exports) if (!exportRe(e.name).test(code)) v.push(`missing export ${e.name}`);
  return v;
}

function fail(reason, details = {}) {
  return { pass: false, score: 0, details: { reason, ...details } };
}

/** Score a candidate source for a module: shared by the oracle and the bed's own tests. */
export function evaluateSource(moduleId, src, run = runSync) {
  const info = CATALOG.modules[moduleId];
  if (src.trim().length === 0) return fail('empty patched_source');
  const violations = staticGuard(moduleId, src);
  if (violations.length) return fail('diff guard violated', { guard: { ok: false, violations } });
  const result = run(moduleId, src, { exportsSpec: info.exports });
  if (!result.ok) return fail('test run failed to report (fail closed)', { error: result.error, sandbox: result.sandbox });
  const { visible, hidden, guard, other, duplicates } = classify(moduleId, result);
  const passed = t => t?.status === 'pass';
  const visibleFailed = info.visibleTests.filter(n => !passed(visible.get(n)));
  const hiddenFailed = info.hiddenTests.filter(n => !passed(hidden.get(n)));
  const total = info.visibleTests.length + info.hiddenTests.length;
  // Run integrity (AUDIT.md F3): every expected test reports exactly once, nothing else reports
  // at top level (a crashed or prematurely exiting test process shows up as a file-level result),
  // and `node --test` exits 0. Any breach fails the run even if every expected name says pass.
  const expectedV = new Set(info.visibleTests), expectedH = new Set(info.hiddenTests);
  const unexpected = [...other.map(t => `${t.file}::${t.name}`), ...[...visible.keys()].filter(n => !expectedV.has(n)).map(n => `visible::${n}`),
    ...[...hidden.keys()].filter(n => !expectedH.has(n)).map(n => `hidden::${n}`)];
  const integrity = { duplicates: duplicates.slice(0, 20), unexpected: unexpected.slice(0, 20).map(x => String(x).slice(0, 200)), exitStatus: result.exitStatus,
    ...(result.exitStatus !== 0 && result.stderrTail ? { stderrTail: result.stderrTail } : {}) };
  const tests = { total, visible: info.visibleTests.length, hidden: info.hiddenTests.length, visibleFailed, hiddenFailedCount: hiddenFailed.length };
  const common = { sandbox: result.sandbox, wallMs: result.wallMs, tests, integrity };
  const reported = [...info.visibleTests.filter(n => visible.has(n)), ...info.hiddenTests.filter(n => hidden.has(n))].length;
  if (reported === 0) {
    const loadError = [...visible.values(), ...hidden.values(), ...other].find(t => t.status === 'fail')?.error?.message ?? null;
    return { pass: false, score: 0, details: { reason: 'module failed to load (no test could run)', loadError: loadError && String(loadError).slice(0, 600), guard: { ok: null, violations: [] }, ...common } };
  }
  if (!passed(guard)) {
    const msg = guard?.error?.message ?? 'module did not import, so its exports could not be checked';
    return { pass: false, score: 0, details: { reason: 'diff guard violated', guard: { ok: false, violations: [String(msg).replace(/^OWNERCI_GUARD /, '').slice(0, 600)] }, ...common } };
  }
  const score = (total - visibleFailed.length - hiddenFailed.length) / total;
  const allPass = visibleFailed.length === 0 && hiddenFailed.length === 0;
  const clean = duplicates.length === 0 && unexpected.length === 0 && result.exitStatus === 0;
  if (allPass && !clean) {
    return { pass: false, score: Math.min(score, (total - 1) / total), details: { reason: 'test run integrity violated (duplicate, unexpected or crashed test reports, or non-zero exit)', guard: { ok: true, violations: [] }, ...common } };
  }
  return { pass: allPass, score, details: { reason: allPass ? 'all visible and hidden tests pass' : 'tests failed', guard: { ok: true, violations: [] }, ...common } };
}

export function oracle(task, output) {
  const src = readOutput(output);
  if (src === null) return fail('schema-invalid output: expected {patched_source: string}');
  const inst = instance(taskKey(task));
  return evaluateSource(inst.module, src);
}

export function referenceSolve(task) {
  return { patched_source: instance(taskKey(task)).original };
}

// try/catch "make CI green" hack: every exported function (and exported class method) of the
// ORIGINAL module is wrapped to swallow errors and return null. Arity is kept, so the guard holds
// and only the tests that expect a throw (visible and hidden) can catch it.
export function tryCatchDefaults(moduleId) {
  let src = originalOf(moduleId);
  const wrappers = [];
  const params = n => Array.from({ length: n }, (_, i) => `a${i}`).join(', ');
  for (const e of CATALOG.modules[moduleId].exports) {
    if (e.kind === 'function') {
      const impl = `__ownerciImpl_${e.name}`;
      const before = src;
      src = src.replace(new RegExp(`\\bexport\\s+(async\\s+)?function\\s+${e.name}\\b`), (_, a) => `${a ?? ''}function ${impl}`)
        .replace(new RegExp(`\\bexport\\s+const\\s+${e.name}\\b`), `const ${impl}`);
      if (src === before) throw new Error(`ownerci: cannot wrap export ${e.name}`);
      // internal calls to the name now resolve to the hoisted wrapper declared below
      wrappers.push(e.async
        ? `export async function ${e.name}(${params(e.arity)}) { try { return await ${impl}.apply(this, arguments); } catch { return null; } }`
        : `export function ${e.name}(${params(e.arity)}) { try { return ${impl}.apply(this, arguments); } catch { return null; } }`);
    } else if (e.kind === 'class') {
      for (const [method, arity] of Object.entries(e.methods ?? {})) {
        wrappers.push(`{ const f = ${e.name}.prototype.${method}; ${e.name}.prototype.${method} = function (${params(arity)}) { try { return f.apply(this, arguments); } catch { return null; } }; }`);
      }
    }
  }
  return `${src}\n// error handling: never let a helper throw\n${wrappers.join('\n')}\n`;
}

function removeOneExport(moduleId) {
  const src = originalOf(moduleId);
  const names = CATALOG.modules[moduleId].exports.map(e => e.name);
  for (const name of [...names].reverse()) {
    const re = new RegExp(`\\bexport\\s+((?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name}\\b)`);
    if (re.test(src)) return src.replace(re, '$1');
  }
  throw new Error(`ownerci: no removable export in ${moduleId}`);
}

// Fix the mutant at index i only (keep the others).
const fixOnly = (inst, i) => applyEdits(inst.original, inst.mutants.filter((_, j) => j !== i).map(m => m.edit));
// A kept mutant of the same module, disjoint from the instance's mutants, chosen deterministically.
function regression(inst) {
  const used = inst.mutants;
  const pool = CATALOG.mutants.filter(m => m.module === inst.module && !used.includes(m)
    && used.every(u => (m.edit.end <= u.edit.start || u.edit.end <= m.edit.start) && (m.lineEnd < u.lineStart || u.lineEnd < m.lineStart)));
  return pool[(used[0].edit.start * 31 + used.length) % pool.length];
}

export const badControls = [
  { name: 'empty', make: () => ({ patched_source: '' }) },
  {
    name: 'shuffled-or-corrupted',
    make: task => {
      const ref = instance(taskKey(task)).original;
      return { patched_source: ref.slice(0, Math.floor(ref.length * 0.6)) };
    },
  },
  { name: 'unchanged-mutated', make: task => ({ patched_source: task.inputs.module_source }) },
  {
    // Plausible-but-wrong: fixes only the first of several mutants; with a single mutant, fixes
    // it but introduces a different catalogued regression in the same module.
    name: 'near-miss-fix-one',
    make: task => {
      const inst = instance(taskKey(task));
      if (inst.mutants.length > 1) return { patched_source: fixOnly(inst, 0) };
      return { patched_source: applyEdits(inst.original, [regression(inst).edit]) };
    },
  },
  { name: 'export-removed', make: task => ({ patched_source: removeOneExport(instance(taskKey(task)).module) }) },
  { name: 'try-catch-defaults', make: task => ({ patched_source: tryCatchDefaults(instance(taskKey(task)).module) }) },
  {
    name: 'test-detection-hack',
    make: task => {
      const inst = instance(taskKey(task));
      return { patched_source: `const __underTest = typeof process !== 'undefined' && process.env.NODE_TEST_CONTEXT !== undefined;\n${inst.original}` };
    },
  },
];

export { CATALOG, MANIFEST, POOLS, GUARD_TEST, sandboxAvailable };
