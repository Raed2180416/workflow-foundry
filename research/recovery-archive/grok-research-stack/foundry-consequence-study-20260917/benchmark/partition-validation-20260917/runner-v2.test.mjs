import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestPath, processingDiagnostic } from './runner-replay.mjs';

test('workspace root resolves the supplied artifact inside .foundry rather than the decoy path', () => {
  const workspace = fileURLToPath(new URL('./runner-path-fixture/workspace/', import.meta.url));
  const correct = JSON.parse(readFileSync(manifestPath(workspace, 'supplied-run'), 'utf8'));
  const oldPath = JSON.parse(readFileSync(path.join(workspace, 'artifacts', 'supplied-run', 'manifest.json'), 'utf8'));
  assert.deepEqual(correct, { samples: [{ sampleId: 'supplied-path-fixture', disposition: 'clear' }] });
  assert.notDeepEqual(correct, oldPath);
});

const required = [{ sampleId: 'supplied-event-fixture', instrument: 'screen' }, { sampleId: 'supplied-event-fixture', instrument: 'reproduce' }];
const attempts = [
  { ...required[0], valid: true, intentSequence: 1, completedSequence: 2 },
  { ...required[1], valid: true, intentSequence: 3, completedSequence: 5 },
];

test('public v2 interval fields require completion strictly before publication start', () => {
  const complete = processingDiagnostic(required, { attempts, publications: [{ startedSequence: 6, completedSequence: 7 }] });
  assert.deepEqual(complete, { passed: true, enforced: false, requiredAttempts: 2, incompleteAtPublication: 0 });
  const equalFence = processingDiagnostic(required, { attempts, publications: [{ startedSequence: 5, completedSequence: 7 }] });
  assert.equal(equalFence.passed, false);
  assert.equal(equalFence.incompleteAtPublication, 1);
  const overlap = processingDiagnostic(required, { attempts, publications: [{ startedSequence: 4, completedSequence: 7 }] });
  assert.equal(overlap.incompleteAtPublication, 1);
});

test('missing, duplicate, and invalid attempt completions remain incomplete', () => {
  const publications = [{ startedSequence: 6, completedSequence: 7 }];
  assert.equal(processingDiagnostic(required, { attempts: attempts.slice(0, 1), publications }).incompleteAtPublication, 1);
  assert.equal(processingDiagnostic(required, { attempts: [...attempts, attempts[1]], publications }).incompleteAtPublication, 1);
  assert.equal(processingDiagnostic(required, { attempts: [attempts[0], { ...attempts[1], valid: false, completedSequence: null }], publications }).incompleteAtPublication, 1);
  assert.equal(processingDiagnostic(required, { attempts: [], publications }).incompleteAtPublication, 2);
});

test('empty batches still require a publication; no publication is not a successful diagnostic', () => {
  assert.equal(processingDiagnostic([], { attempts: [], publications: [] }).passed, false);
  assert.equal(processingDiagnostic([], { attempts: [], publications: [{ startedSequence: 1, completedSequence: 2 }] }).passed, true);
  assert.equal(processingDiagnostic(required, { attempts, publications: [] }).passed, false);
});
