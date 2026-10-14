// `need-codefix-noverifier` bed: the codefix bed with every visible test or checker taken away. Routing anchor for the need
// router (experiments/need-router), not a Tier-A bed. The task is codefix's own task for the same (seed, split, difficulty),
// post-processed: the visible pytest file, its path and the CI log of running it are removed from `inputs` and `files`, and
// the one prompt sentence that talks about the visible tests is replaced. Everything else (module, bug thread, design notes,
// changelog, service log, injections, hidden oracle, reference, bad controls) is codefix's, read-only. See README.md for the
// knob, what stays visible, the pairing with codefix and the class HYPOTHESIS. Trusted host code: solvers never see the
// oracle, the reference solver or the hidden tests.
import * as codefix from '../codefix/index.mjs';
import { build } from '../codefix/build.mjs';
import { sha256 } from '../lib/canonical.mjs';

export const VERSION = '1.0.0';
/** The codefix instance space this bed is bound to. Task content is codefix's content: a codefix bump changes this bed. */
export const UPSTREAM = Object.freeze({ bed: 'codefix', version: codefix.family.version });

/** `inputs` keys that carry the visible verifier (all removed). */
export const REMOVED_INPUT_KEYS = Object.freeze(['tests_path', 'visible_tests', 'ci_log']);

// The codefix prompt sentence about the visible tests, and what replaces it. generate() throws if codefix's prompt stops
// containing the sentence, so a silent change upstream cannot leave a reference to tests that no longer exist here.
export const PROMPT_EDIT = Object.freeze({
  from: 'The visible tests do not exercise\nevery behaviour, and passing them does not mean the module is correct.',
  to: 'No test suite or runnable checker is\nincluded with this task, so the repair has to come from reading the code against the documented behaviour.',
});

export const family = {
  id: 'need-codefix-noverifier',
  domain: 'routing anchor: software repair from a bug report with no runnable test or checker (beds/codefix minus its visible tests and CI log)',
  version: VERSION,
  kind: 'oneshot',
  role: 'need-anchor',
  description: 'The codefix task (fix 1-3 injected bugs in a generated 80-400 line Python module from a bug-report thread, docstrings and '
    + 'design notes, scored by codefix\'s hidden tests behind a diff guard) with the visible pytest file and the CI log of running it removed. '
    + 'Paired with codefix by (seed, split, difficulty): same module, thread, notes, logs, injections and oracle; only the visible verifier '
    + 'and one prompt sentence differ. HYPOTHESIS, not a fact: one model call (or a plain agent) should suffice, because the extra a '
    + 'workflow or an agent loop would add on codefix, a test-edit-rerun cycle and a per-function audit fan-out, has no visible check to '
    + 'iterate against here; a router keyed on the code-fix surface (long module, bug thread, multiple bugs) would call it a workflow. '
    + 'Not a claim that any mode solves it: at higher difficulty every mode may fail. Difficulty is codefix\'s (1..5).',
};

/** Output schema (portable subset): codefix's, unchanged. */
export const outputSchema = structuredClone(codefix.outputSchema);

function checkArgs({ seed, split, difficulty } = {}) {
  if (!Number.isSafeInteger(seed) && typeof seed !== 'string') throw new Error('need-codefix-noverifier: seed must be an integer or string');
  if (split !== 'dev' && split !== 'test') throw new Error("need-codefix-noverifier: split must be 'dev' or 'test'");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error('need-codefix-noverifier: difficulty must be an integer 1..5');
}
const keyOf = ({ seed, split, difficulty }) => ({ seed, split, difficulty });

// Structural and textual markers of a visible verifier. generate() fails loudly if any survives the removal, so an upstream
// change that adds a test file, a CI file or a test command cannot make this bed silently ship a verifier.
const TEST_PATH = /(^|\/)(tests?|ci)(\/|$)|(^|\/)test_[^/]*$|_test\.py$|(^|\/)conftest\.py$|last_run/i;
const TEST_TEXT = [
  /^\s*def test_\w+\(/m, /^\s*import pytest\b/m, /^\s*\$ .*\bpytest\b/m, /\bpython3? -m (pytest|unittest)\b/,
  /^tests\/\S+::\w+ (PASSED|FAILED)/m, /^FAILED tests\//m,
];

function assertNoVerifier(task) {
  for (const path of Object.keys(task.files)) {
    if (TEST_PATH.test(path)) throw new Error(`need-codefix-noverifier: a test or CI file survived: ${path}`);
  }
  for (const key of REMOVED_INPUT_KEYS) {
    if (key in task.inputs) throw new Error(`need-codefix-noverifier: input ${key} survived`);
  }
  for (const [where, text] of [['prompt', task.prompt], ...Object.entries(task.inputs).map(([k, v]) => [`inputs.${k}`, String(v)]),
    ...Object.entries(task.files).map(([k, v]) => [`files.${k}`, v])]) {
    for (const re of TEST_TEXT) if (re.test(text)) throw new Error(`need-codefix-noverifier: test marker ${re} in ${where}`);
  }
}

export function generate({ seed, split, difficulty }) {
  checkArgs({ seed, split, difficulty });
  const base = codefix.generate({ seed, split, difficulty });
  if (!base.prompt.includes(PROMPT_EDIT.from)) throw new Error('need-codefix-noverifier: codefix prompt changed; re-review this bed');
  const inputs = { ...base.inputs };
  const files = { ...base.files };
  // The visible test file, and the CI file (the log of running those tests; present from d3). Matched by content, not by name.
  delete files[base.inputs.tests_path];
  if (base.inputs.ci_log !== undefined) {
    const ci = Object.keys(files).filter(path => files[path] === base.inputs.ci_log);
    if (ci.length !== 1) throw new Error(`need-codefix-noverifier: expected exactly one CI log file, found ${ci.length}`);
    delete files[ci[0]];
  }
  for (const key of REMOVED_INPUT_KEYS) delete inputs[key];
  const task = {
    id: `${family.id}-${split}-d${difficulty}-s${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: base.prompt.replace(PROMPT_EDIT.from, PROMPT_EDIT.to),
    inputs,
    files,
    budget: base.budget,
  };
  assertNoVerifier(task);
  return task;
}

/** The verdict is codefix's own verdict for the same (seed, split, difficulty): same diff guard, same sandbox, same hidden suite. */
export function oracle(task, output) {
  checkArgs(task);
  return codefix.oracle(keyOf(task), output);
}

export function referenceSolve(task) {
  checkArgs(task);
  return codefix.referenceSolve(keyOf(task));
}

/** codefix's controls, unchanged: they depend on the task only through (seed, split, difficulty) and `inputs.source`, both kept. */
export const badControls = codefix.badControls.map(({ name, make }) => ({ name, make: task => { checkArgs(task); return make(task); } }));

/**
 * Trusted host code (it builds the hidden truth). Digests of the buggy module and of the correct module for one instance.
 * Two tasks with the same `source` digest are the same code-fix problem; the same `reference` digest means the same answer.
 * Use it to drop test tasks that repeat a dev task (codefix AUDIT F2; see README, Known limits).
 */
export function instanceFingerprint({ seed, split, difficulty }) {
  checkArgs({ seed, split, difficulty });
  const b = build({ seed, split, difficulty });
  return { source: sha256(b.buggySource), reference: sha256(b.reference) };
}
