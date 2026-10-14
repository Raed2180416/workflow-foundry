// Bad controls and structure-necessity controls for W-bed R3'. Three kinds of control:
//   text      computed from the rendered repository files only (lint.mjs): what a script without the generator does
//             (grep-for-TODO, linter-only, report-everything). No trace.
//   stage     the bed's pipeline with one option reproducing one plausible mistake, visible to a stage oracle.
//   relation  every stage oracle and the reduce stage's local checks pass on the control's own trace; only a cross-stage
//             relation (V1-V4) and the end-to-end oracle catch it.
// NECESSITY_DEFS (W-BED §2.4 item 3): the best workflow without one of the rung's features: without fan-out (one
// sequential context that skims past a token budget, size-gated d >= 4), without verify-before-report (every suspect
// reported, decoys included) and without root-cause fan-in (callers that inherit a helper defect reported too).
// The generator re-draws a repository until every applicable control fails the oracle (world.mjs setVerifier).
export const SEQUENTIAL_BUDGET_TOKENS = 24000;

export const CONTROL_DEFS = [
  { name: 'empty', kind: 'text', make: () => ({ findings: [] }) },
  { name: 'shuffled-or-corrupted', kind: 'text', corrupt: true,
    why: 'the reference findings with their (file, function) locations rotated by one: right classes and counts, wrong places' },
  { name: 'grep-for-TODO', kind: 'text', text: 'todo',
    why: 'every function whose text contains TODO, FIXME, XXX or HACK, reported once (the comments are placed independently of the defects)' },
  { name: 'linter-only', kind: 'text', text: 'lint',
    why: 'a rule-based linter (eslint-style rules plus a money plugin): flags code patterns, cannot compare code with a contract' },
  { name: 'report-everything', kind: 'text', text: 'everything',
    why: 'every function once per class in scope: recall 1, precision near the defect rate' },
  { name: 'single-pass-no-verify', kind: 'stage', stage: 'candidates', opts: { smellOnly: true, assumeAll: true },
    why: 'one reading pass that reports every site that looks wrong (the visible half of the defects and every decoy) and verifies nothing' },
  { name: 'class-confused', kind: 'stage', stage: 'candidates', opts: { classSwap: true },
    why: 'every defect found and verified, but boundary (OFF_BY_ONE) and condition (LOGIC_ERROR) mistakes classified as each other' },
  { name: 'file-level-only', kind: 'stage', stage: 'candidates', opts: { fileLevel: true },
    why: 'right files and classes, each finding pinned to the first function of its file' },
  { name: 'budget-half-files', kind: 'stage', stage: 'candidates', opts: { half: true },
    why: 'the sweep stops after the first half of the source files (budget exhausted), and reports what it has' },
  { name: 'tested-means-clean', kind: 'stage', stage: 'candidates', opts: { testedClean: true },
    why: 'functions with green tests are skipped as known-good (the tests use inputs that miss the defects)' },
  { name: 'report-ignores-verdict', kind: 'relation', opts: { ignoreVerdict: true },
    why: 'verification ran and was right, but the report lists every suspect; breaks V2' },
  { name: 'verified-dropped-at-fan-in', kind: 'relation', opts: { lostMiddle: true },
    why: 'per-file results right; the fan-in loses the middle third of the files\' findings; breaks V4' },
];

export const NECESSITY_DEFS = [
  { name: 'sequential-single-context', kind: 'necessity', minDifficulty: 4, sequential: true,
    why: `one context reads the repository in order; past ${SEQUENTIAL_BUDGET_TOKENS} tokens it skims (finds nothing in the files it skims). Stand-in for the size failure of a one-call sweep; measured sizes in the notes` },
  { name: 'fan-out-no-verify', kind: 'necessity', opts: { assumeAll: true },
    why: 'per-file fan-out that finds every suspect, then reports without verifying: every decoy is reported (precision about 1/2)' },
  { name: 'fan-out-no-root-cause', kind: 'necessity', opts: { noRootCause: true },
    why: 'per-file fan-out with verification, no root-cause fan-in: the callers that inherit a helper defect are reported as well; breaks V3' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
