// Bad controls and structure-necessity controls for W-bed R3'. Four kinds of control:
//   text      computed from the rendered repository files only (lint.mjs, attack.mjs): what a script without the
//             generator does (grep-for-TODO, linter-only, report-everything, the contract-fuzz script). No trace.
//   stage     the bed's pipeline with one option reproducing one plausible mistake, visible to a stage oracle.
//   relation  every stage oracle and the reduce stage's local checks pass on the control's own trace; only a cross-stage
//             relation (V1-V4) and the end-to-end oracle catch it.
//   necessity (NECESSITY_DEFS, W-BED §2.4 item 3): the best workflow without one of the rung's features: without
//             fan-out (one sequential context that skims past a token budget, size-gated d >= 4), without
//             verify-before-report (every suspect reported, decoys included) and without root-cause fan-in (callers
//             that inherit a helper defect reported too).
//
// BY CONSTRUCTION (review 2026-10-14, finding 4): every stage, relation and necessity control is the bed's own pipeline,
// which reads the manifest's roles, with one mistake injected. It shows that the oracle penalises that mistake; it does
// NOT show that a real solver needs the feature. "Verify is necessary" and "fan-out is necessary" are conditional
// claims until measured by paid arms (the one-call attack and a Haiku per-file no-verify arm; NOTES §9, §17).
// The text controls are measured: they read the files and nothing else.
//
// The generator re-draws a repository until every applicable fast control fails the oracle (world.mjs setVerifier). The
// contract-fuzz controls are `slow` (seconds per task): they are gated by tests and by the CLI measurement in
// attack.mjs's header, not by the per-task re-draw.
export const SEQUENTIAL_BUDGET_TOKENS = 24000;
export const STREAM_CORPUS = 24; // earlier tasks a stream arm has seen at its last task (W-BED §5: 24 tasks per stream)

export const CONTROL_DEFS = [
  { name: 'empty', kind: 'text', make: () => ({ findings: [] }) },
  { name: 'shuffled-or-corrupted', kind: 'text', corrupt: true, byConstruction: true,
    why: 'the reference findings with their (file, function) locations rotated by one: right classes and counts, wrong places' },
  { name: 'grep-for-TODO', kind: 'text', text: 'todo',
    why: 'every function whose text contains TODO, FIXME, XXX or HACK, reported once (the comments are placed independently of the defects)' },
  { name: 'linter-only', kind: 'text', text: 'lint',
    why: 'a rule-based linter (eslint-style rules plus a money plugin): flags code patterns, cannot compare code with a contract' },
  { name: 'report-everything', kind: 'text', text: 'everything',
    why: 'every function once per class in scope: recall 1, precision near the defect rate' },
  { name: 'contract-fuzz-script', kind: 'text', script: 'fuzz', slow: true,
    why: 'the review\'s $0 script (attack.mjs): runs every function on inputs drawn from its @param domains, checks generic contract properties (no argument change unless "in place", "Throws X" throws X, no crash or NaN, the house rounding rule, Gregorian month lengths) and votes among functions with the same contract text; root cause by one regex' },
  { name: 'contract-fuzz-stream', kind: 'text', script: 'fuzz', corpus: STREAM_CORPUS, slow: true,
    why: `the same script with the files of the ${STREAM_CORPUS} preceding seeds (same split and difficulty) as an unlabelled corpus for the vote, as a stream or library arm would have them` },
  { name: 'single-pass-no-verify', kind: 'stage', stage: 'candidates', opts: { smellOnly: true, assumeAll: true }, byConstruction: true,
    why: 'one reading pass that reports every site that looks wrong (the visible half of the defects and every decoy) and verifies nothing' },
  { name: 'class-confused', kind: 'stage', stage: 'candidates', opts: { classSwap: true }, byConstruction: true,
    why: 'every defect found and verified, but boundary (OFF_BY_ONE) and condition (LOGIC_ERROR) mistakes classified as each other' },
  { name: 'file-level-only', kind: 'stage', stage: 'candidates', opts: { fileLevel: true }, byConstruction: true,
    why: 'right files and classes, each finding pinned to the first function of its file' },
  { name: 'budget-half-files', kind: 'stage', stage: 'candidates', opts: { half: true }, byConstruction: true,
    why: 'the sweep stops after the first half of the source files (budget exhausted), and reports what it has' },
  { name: 'tested-means-clean', kind: 'stage', stage: 'candidates', opts: { testedClean: true }, byConstruction: true,
    why: 'functions with green tests are skipped as known-good (the tests use inputs that miss the defects)' },
  { name: 'report-ignores-verdict', kind: 'relation', opts: { ignoreVerdict: true }, byConstruction: true,
    why: 'verification ran and was right, but the report lists every suspect; breaks V2' },
  { name: 'verified-dropped-at-fan-in', kind: 'relation', opts: { lostMiddle: true }, byConstruction: true,
    why: 'per-file results right; the fan-in loses the middle third of the files\' findings; breaks V4' },
];

export const NECESSITY_DEFS = [
  { name: 'sequential-single-context', kind: 'necessity', minDifficulty: 4, sequential: true, byConstruction: true,
    why: `one context reads the repository in order; past ${SEQUENTIAL_BUDGET_TOKENS} tokens it skims (finds nothing in the files it skims). A size stand-in for a one-call sweep, by construction; the measured test is the paid one-call attack` },
  { name: 'fan-out-no-verify', kind: 'necessity', opts: { assumeAll: true }, byConstruction: true,
    why: 'per-file fan-out that finds every suspect, then reports without verifying: every decoy is reported (precision about 1/2), by construction; the measured test is a paid Haiku per-file no-verify arm' },
  { name: 'fan-out-no-root-cause', kind: 'necessity', opts: { noRootCause: true }, byConstruction: true,
    why: 'per-file fan-out with verification, no root-cause fan-in: the callers that inherit a helper defect are reported as well; breaks V3 (by construction)' },
];

export const appliesAt = (def, difficulty) => difficulty >= (def.minDifficulty ?? 0);
