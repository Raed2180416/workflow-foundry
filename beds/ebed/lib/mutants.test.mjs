// Keeps the mutation list of mutants.mjs applicable as the libraries evolve: every pattern occurs exactly once and
// changes its file. The mutation run itself (node beds/ebed/lib/mutants.mjs, about a minute) is not part of this
// suite; README.md records its last result. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUTANTS, applyMutant } from './mutants.mjs';

test('every mutant applies exactly once and changes its file; ids are unique', () => {
  const ids = new Set();
  for (const [id, file, op, find, replace] of MUTANTS) {
    assert.ok(!ids.has(id), id);
    ids.add(id);
    assert.ok(op && find !== replace, id);
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.notEqual(applyMutant(text, find, replace), text, id);
  }
  assert.ok(MUTANTS.length >= 60);
  assert.throws(() => applyMutant('a a', 'a', 'b'), /occurs 2 times/);
});
