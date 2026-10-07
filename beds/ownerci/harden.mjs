// Preload for every ownerci test process (the `node --test` parent and each test-file child),
// loaded with --import before any test file and therefore before the candidate module. It freezes
// the assertion objects the frozen tests use, so a candidate that reaches them cannot replace
// their methods. Code generation from strings (eval, Function) is disabled separately with
// --disallow-code-generation-from-strings. See AUDIT.md (F1, F2).
import assert from 'node:assert';
import strict from 'node:assert/strict';

for (const o of new Set([assert, strict, assert.strict, strict.strict])) Object.freeze(o);
