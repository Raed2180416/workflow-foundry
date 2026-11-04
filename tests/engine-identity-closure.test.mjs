// The engine identity (src/engine.mjs) must hash every module whose code decides a run's semantics. If the runtime
// imports a module the identity leaves out, that module can change without changing engineHash, and a run bound to
// one behaviour silently resumes under another. Found 2026-11-04: src/ledger.mjs (verify method "ledger") was
// imported by the runtime but not hashed, which the engine-binding test showed only indirectly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const IMPORT = /(?:import|export)[^;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
function closure(roots) {
  const seen = new Set(), stack = [...roots];
  while (stack.length) {
    const file = stack.pop(); if (seen.has(file)) continue; seen.add(file);
    for (const m of readFileSync(path.join(src, file), 'utf8').matchAll(IMPORT)) {
      const rel = path.relative(src, path.resolve(path.dirname(path.join(src, file)), m[1] ?? m[2]));
      if (!rel.startsWith('..')) stack.push(rel);
    }
  }
  return seen;
}

test('every src module the runtime, validator, store and engine import is part of the engine identity', () => {
  const engine = readFileSync(path.join(src, 'engine.mjs'), 'utf8');
  const listed = new Set([...engine.slice(engine.indexOf('const paths'), engine.indexOf('];', engine.indexOf('const paths'))).matchAll(/'([^']+)'/g)].map(m => m[1]));
  const reached = closure(['runtime.mjs', 'validate.mjs', 'store.mjs', 'engine.mjs']);
  assert.ok(reached.size >= 20, `the import scan found only ${reached.size} modules; the pattern is likely broken`);
  assert.deepEqual([...reached].filter(f => !listed.has(f)).sort(), [], 'modules the engine runs but does not hash');
});
