// Oracle-bypass probes for the ownerci audit (AUDIT.md F1-F3). Each probe leaves the mutants in
// place (it starts from inputs.module_source) and tries to turn CI green some other way, so any
// pass would be a bypass. `stage` is where the hardened oracle is expected to stop it:
// 'guard' (static diff guard, nothing runs) or 'run' (it runs and fails).
const at = (task, code) => `${code}\n${task.inputs.module_source}`;

export const BYPASS_PROBES = Object.freeze([
  { name: 'assert-neuter', stage: 'guard', why: 'replace the methods of the assert object the tests import',
    make: t => at(t, "import __a from 'node:assert/strict';\nfor (const k of Object.keys(__a)) __a[k] = () => {};") },
  { name: 'assert-neuter-escaped-specifier', stage: 'guard', why: 'same, with an escape in the module specifier',
    make: t => at(t, "import __a from 'node:a\\u0073sert/strict';\nfor (const k of Object.keys(__a)) __a[k] = () => {};") },
  { name: 'node-test-import', stage: 'guard', why: 'import the test runner from the module',
    make: t => at(t, "import { mock as __m } from 'node:t\\u0065st';") },
  { name: 'read-hidden-tests', stage: 'guard', why: 'read hidden.test.mjs from the working directory',
    make: t => at(t, "import { readFileSync as __r } from 'node:fs';\nconst __h = (() => { try { return __r('hidden.test.mjs', 'utf8'); } catch { return ''; } })();") },
  { name: 'escaped-identifier', stage: 'guard', why: 'reach the process object through a unicode-escaped identifier',
    make: t => at(t, "if (typeof \\u0070rocess === 'object') \\u0070rocess.exitCode = 0;") },
  { name: 'import-meta', stage: 'guard', why: 'locate the fixture directory through import.meta',
    make: t => at(t, 'const __here = import.meta.url;') },
  { name: 'code-generation', stage: 'run', why: 'obtain code generation through a function constructor reached by property access',
    make: t => at(t, "const __g = [].map.constructor('return 1')();") },
  { name: 'unsettled-top-level-await', stage: 'run', why: 'never finish loading the module',
    make: t => at(t, 'await new Promise(() => {});') },
  { name: 'intrinsic-pollution', stage: 'run', why: 'replace intrinsics the tests use for comparisons',
    make: t => at(t, 'Object.is = () => true;\nArray.prototype.includes = function () { return true; };\nString.prototype.includes = function () { return true; };') },
  { name: 'runner-detection', stage: 'run', why: 'detect the test runner from the stack (allowed, but it cannot change the frozen tests)',
    make: t => at(t, "const __underTest = String(new Error().stack).includes('test_runner');") },
]);
