// Recorded changes to AutomationBench harness-manifest files since e6a23ca (PREREG-AB-v1 §5, §6.1). Shared by the
// manifest test in sequential.test.mjs and the "v1 untouched" test (20) in codeowned-v2.test.mjs. Test data only: no
// harness imports this file, so it is outside both manifests.
//
// Why changes on this tree are allowed at all: every frozen look-2 candidate runs from the pinned checkout (tag
// a1c-v1-look2 on a1c-v1), and the manifest test checks that pin strictly, with no allowance: there, every manifest file
// is e6a23ca's. A launch from this tree computes a different manifest hash, so it cannot pass for a frozen candidate.
//
// Each entry: `before` is the file's sha256 at e6a23ca (null: the file did not exist there); `after` is the sha256 of the
// bytes this tree must hold; `commits` (oldest first) are the commits that made the change; `merge`, when present, says
// that `after` is the clean three-way merge of the file at `ours` and `theirs` over `base` (a branch merged into main);
// `recordedIn` lists the documents that record the change, each of which must contain `mention`. Any other change to a
// manifest file, or any further change to one of these, fails the tests until it is recorded here and in a document.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MANIFEST_BASE = 'e6a23ca';
const ALLOWANCES_DOC = 'research/automationbench-20261014/MANIFEST-ALLOWANCES.md';
const ENGINE = 'Engine work that landed on main after the look-2 freeze (2026-10-21; decisions D29-D33 integration). ';

const entry = (o) => Object.freeze({ ...o, commits: Object.freeze(o.commits), recordedIn: Object.freeze(o.recordedIn ?? [ALLOWANCES_DOC]), mention: o.mention ?? o.after.slice(0, 12) });

export const ALLOWED_MANIFEST_CHANGES = Object.freeze({
  'experiments/autobench/bridge.py': entry({
    commits: ['2f02281b0bceb9c964a7347de763b8a341a10667'],
    before: '285be4f5ba32f569c904897d512524535f6b50c11c05d54e419e5e272f97641a',
    after: 'caf3ddd6d1dc653b63d76a297225f762234b3cf050f2d40312cc6ef10e2c75f7',
    reason: 'pin_timezone (the AutomationBench families workflow): the serve/replay process takes its time zone from the input row\'s info.tz before the shim is installed. Only abr-* family rows carry info.tz; no official task does, so official tasks are served as before. The A1-C arms (and a0-look2, a1s-look2) run from the pinned checkout (tag a1c-v1-look2 on a1c-v1, aada200), whose bridge.py is still e6a23ca\'s.',
    recordedIn: ['research/automationbench-20261014/PREREG-VL1.md', 'research/mercury-20261021/A1C-MERCURY-PARTIAL.md'],
    mention: 'pin_timezone',
  }),
  'experiments/autobench/harness/foundry.mjs': entry({
    commits: ['2f40700da704be655383ff274aae1cebb734263f'],
    before: '5b5a7bb653d67683a1350e5d0ffeff763e63ccaa6ed85a4bc64e2d6ab59b62de',
    after: 'a31d66719778f105c18ca1ac49f8540d1f5950caabfe6ad72822ddd16b8370a6',
    reason: ENGINE + 'Compromise C2: the launch records the Claude CLI {version, sha256, pinned}, and a resume on other CLI bytes is refused.',
  }),
  'experiments/autobench/run.mjs': entry({
    commits: ['2f40700da704be655383ff274aae1cebb734263f', '5a59cbb9ccaabe4b656bb0437a9ddd82ac684bd8', '6e7bba756e0e871844a5cd61a9284c995a765baf'],
    before: 'ea1dca70628a80262430b0d693d013fab456aebccefaac9e48db9713d4c87c5f',
    after: '6705073d2fc70fad60dbd755f2011fc59f0430eff82d06d45bc700ac4ff9e17c',
    merge: Object.freeze({ base: 'e6a23ca', ours: '2f40700da704be655383ff274aae1cebb734263f', theirs: '6e7bba756e0e871844a5cd61a9284c995a765baf' }),
    reason: ENGINE + 'Compromise C2 (2f40700d): the launch records the Claude CLI {version, sha256, pinned}, and a resume on other CLI bytes is refused. ' +
      'Merged with the A1-C v2 registration (5a59cbb9, 6e7bba75 on worktree-wf_3674d3bc-0a7-12): --harness codeowned-v2 and EXECUTOR_PIPELINES; ' +
      'for --harness codeowned every guard decides as before (codeowned-v2.test.mjs test 20 checks the registration lines).',
  }),
  'experiments/lib/results.mjs': entry({
    commits: ['8b00b4a400d2cb033284ed3da9ed43e8ca693df2'],
    before: 'e9cb94d14c3be1d52e22fc36da9b261252b80be0266874197f8d75bb20910957',
    after: '645c7800b0f83fd27e0f0edd30bf28d73cf740b885e26ddc99168429a9556b04',
    reason: ENGINE + 'Orchestration patches 01-09 (research/orch-20261021).',
  }),
  'experiments/lib/runner.mjs': entry({
    commits: ['8b00b4a400d2cb033284ed3da9ed43e8ca693df2', 'ebc81908eef01a2840c188f2a5306a6e897a9e03'],
    before: 'cbc4b19741f809f766ed2765302bc4b0e0a52931007b7e6b001cbecdb4ff1f29',
    after: 'ea84709699cb572193f3d5904f8e49697919b94e5f278b293a89f42e56a16bc2',
    reason: ENGINE + 'Orchestration patches 01-09, then one runner per workdir (an exclusive lock; gap rank 12, chaos F1).',
  }),
  'src/children.mjs': entry({
    commits: ['8b00b4a400d2cb033284ed3da9ed43e8ca693df2', '6203fb69c4e8ff01b363b09cba5d323981d2b27b'],
    before: '68a763b3e9f948cda0286e12381bb6bbda19f360fa29fbf76e9ebee9c715d6c5',
    after: 'f81dc903571105b4f5448d45fb76c095ac39753f55050e2fcf61fa4e905ea34e',
    reason: ENGINE + 'Orchestration patches 01-09 and their follow-ups (patches 05 and 09). The A1-C v1 manifest lists it since the executor imports it; at a1c-v1 it was not imported.',
  }),
  'src/cli-pin.mjs': entry({
    commits: ['83d9e7133e3e0db75152bf74bac4ed95adfe638d'],
    before: null,
    after: '18967fd060898e43b7670889fc98de12710e40531eaf906ae38b1a7dc514ba77',
    reason: ENGINE + 'New file. Compromise C2: the Claude CLI is pinned by its bytes and its version is recorded per call (gap rank 16, chaos D4).',
  }),
  'src/executors/claude-code.mjs': entry({
    commits: ['8b00b4a400d2cb033284ed3da9ed43e8ca693df2', '03c19e2b1f894f65eab092ff4755f8e620a37c7f', '83d9e7133e3e0db75152bf74bac4ed95adfe638d'],
    before: 'f363c80418bf9bb91e6e8d42adc1345eba24274a56f6d870759ea2eebbe35afc',
    after: 'd50b93d9c2039dd2238eafe45b1a2fc14bc026e0297647c396e6bf9e82b871de',
    reason: ENGINE + 'Orchestration patches 01-09; a session the caller aborts ends CANCELLED, not EXECUTOR_PROTOCOL (gap rank 21); the CLI pin (C2).',
  }),
  'src/models/policy.mjs': entry({
    commits: ['83d9e7133e3e0db75152bf74bac4ed95adfe638d', 'a81447eb584beec18e7f13203fd7708cf2eab51c'],
    before: '95390dec17adbfa0c68dc0e05314e7a95192e79e303b006412a1bedb4500b572',
    after: 'd8ecfb841107630f4096f8eb4ed8b83fa4cdd441e2a0ffe87ff15917815d0760',
    reason: ENGINE + 'The CLI pin (C2), then Mercury-only session subsets: an empty models[] beside executorModels (PORT-PROBE finding 1).',
  }),
});

/**
 * Check one allowance against git history and the bytes on disk. `git(...args)` returns spawnSync output with a Buffer
 * stdout; `blob(rev, file)` the sha256 of a file at a revision (null: absent); `hasRev(rev)`; `current` the sha256 on disk.
 * Returns a list of problems (empty: the change is exactly the recorded one).
 */
export function allowanceProblems(file, a, { git, blob, hasRev, current, readDoc }) {
  const problems = [];
  const short = c => c.slice(0, 8);
  if (blob(MANIFEST_BASE, file) !== a.before) problems.push(`${file} at ${MANIFEST_BASE} is not the recorded "before"`);
  if (current !== a.after) problems.push(`${file} changed after its recorded change (${a.commits.map(short).join(', ')}): that change is not recorded`);
  if (!(a.commits.length > 0)) problems.push(`${file}: no commit recorded`);
  if (!(a.reason.length > 40)) problems.push(`${file}: the reason is too short`);
  for (const r of a.recordedIn) { const t = readDoc(r); if (t === null || !t.includes(a.mention)) problems.push(`${r} does not record the ${file} change (expected "${a.mention}")`); }
  const known = a.commits.filter(hasRev);
  for (const c of known) {
    if (git('merge-base', '--is-ancestor', c, 'HEAD').status !== 0) problems.push(`${short(c)} is not in this tree's history`);
    if (blob(`${c}^`, file) === blob(c, file)) problems.push(`${short(c)} did not change ${file}`);
  }
  if (known.length === a.commits.length) {
    if (blob(`${a.commits[0]}^`, file) !== a.before) problems.push(`${short(a.commits[0])}'s parent does not hold the "before" bytes of ${file}`);
    if (!a.merge && blob(a.commits.at(-1), file) !== a.after) problems.push(`${short(a.commits.at(-1))} does not hold the "after" bytes of ${file}`);
  }
  if (a.merge && [a.merge.base, a.merge.ours, a.merge.theirs].every(hasRev)) {
    const sides = ['ours', 'base', 'theirs'].map(k => git('show', `${a.merge[k]}:${file}`).stdout);
    const merged = mergeFile(sides);
    if (merged === null) problems.push(`${file}: ${short(a.merge.ours)} and ${short(a.merge.theirs)} do not merge cleanly over ${short(a.merge.base)}`);
    else if (merged !== a.after) problems.push(`${file} is not the clean merge of ${short(a.merge.ours)} and ${short(a.merge.theirs)} over ${short(a.merge.base)}`);
  }
  return problems;
}

// git merge-file on three byte buffers; the sha256 of the clean result, or null on a conflict.
function mergeFile([ours, base, theirs]) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'ab-merge-'));
  try {
    const f = ['ours', 'base', 'theirs'].map((n, i) => { const p = path.join(d, n); writeFileSync(p, [ours, base, theirs][i]); return p; });
    const r = spawnSync('git', ['merge-file', '-p', ...f], { encoding: 'buffer', maxBuffer: 64 << 20 });
    return r.status === 0 ? createHash('sha256').update(r.stdout).digest('hex') : null;
  } finally { rmSync(d, { recursive: true, force: true }); }
}
