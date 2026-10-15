import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { familyFeatures, taskFeatures, schemaLeaves, WHITELIST } from '../features.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('schemaLeaves counts output leaves through properties, items and combinators', () => {
  assert.equal(schemaLeaves({ type: 'string' }), 1);
  assert.equal(schemaLeaves({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', properties: { x: {}, y: {} } } } } }), 3);
  assert.equal(schemaLeaves({ anyOf: [{ type: 'string' }, { type: 'object', properties: { p: {}, q: {} } }] }), 3);
});

test('family features are whitelisted, deterministic and come from example seeds only', async () => {
  const a = await familyFeatures('wbed-r0', { seeds: [601, 602, 603] });
  const b = await familyFeatures('wbed-r0', { seeds: [601, 602, 603] });
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), [...WHITELIST].sort());
  assert.ok(Object.values(a).every(Number.isFinite));
  // The negative control is small; a long-document rung is larger.
  const r6 = await familyFeatures('wbed-r6', { seeds: [601] });
  assert.ok(r6.logInputTokens > a.logInputTokens + 1);
});

test('taskFeatures never carries identity: no family id, bed version or kind field', () => {
  const f = taskFeatures({ prompt: 'Sum the rows', inputs: { rows: [{ a: 1 }] }, family: 'records', version: '3.0.0', kind: 'oneshot' }, { type: 'object' });
  assert.deepEqual(Object.keys(f).sort(), [...WHITELIST].sort());
});

test('the router module imports no bed, oracle or result code (import-graph purity)', () => {
  const src = readFileSync(path.join(here, '..', 'router.mjs'), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1]);
  // metrics.mjs, and prereg-rules.mjs for the preregistered θ fit (PREREG §6), which itself imports nothing.
  assert.deepEqual(imports, ['./metrics.mjs', './prereg-rules.mjs']);
  const rules = readFileSync(path.join(here, '..', 'prereg-rules.mjs'), 'utf8');
  assert.equal([...rules.matchAll(/^\s*import\s/gm)].length, 0, 'prereg-rules.mjs must stay a leaf module');
});
