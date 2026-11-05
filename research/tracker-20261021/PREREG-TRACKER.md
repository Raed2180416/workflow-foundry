# PREREG-TRACKER: the condition tracker against no tracker and a prose checklist (A7, task #60)

*Written 2026-10-21 before any paid call of this plan. Development evidence only, by construction (§6). Frozen by the commit that
adds this file; the code, prompts and inputs below are hashed in [freeze.json](freeze.json) written by
`experiments/tracker-v2/freeze.mjs` in the same commit. Owner's ask (2026-10-14, [67]): "log the conditions specified by user ... and
check against logic and stuff demanded ... we shouldn't over engineer here". Design and sources: [DOSSIER.md](DOSSIER.md).*

## 1. Question

Does a tracker that logs the person's conditions from their own words, binds each to a code-owned check template, and checks a build
on practice data, catch builds that do not do what the person asked **before the live run**, more often than (T0) no tracker and
(T1) a cheap-model prose checklist, **without raising alarms on builds that are fine**? At what cost per build?

## 2. Beds, builds and labels (frozen inputs)

**BUILDER-1** (`research/surface-20261021/eval/cases.json`): 24 requests (21 fit, 3 no-fit), answer key, hidden worlds and an
executable oracle. Builds: every archived build that exists and is strictly valid in the five recorded arms (`b-h-1`, `b-m-1`,
`b0-h-1`, `b-h-fix-1`, `b-m-fix-1`): **101 builds**. Label: the run record's `judgement.verified` from the hidden world
(recorded 2026-10-21 by BUILDER-1; not recomputed here): **83 verified, 18 not** (b-h-1 L3, b-m-1 L3, and 16 of b0-h-1). The hidden
worlds are never run or read by the tracker or by T1; checks run only on the practice workspace (every template's practice sheets,
dates aligned to 2026-10-20T09:00Z) plus the tracker's own condition-targeted rows.

**E8** (frozen SPEC-E `48535bb`, sha256 `c013c04c…f8cf1`): practice worlds 1235 (d2), 1236 (d3), 1237 (d5) only. Builds: the seven
archived B1 solvers and the three specificity solvers (run as black boxes). Label (analyst-side, `run-e8.mjs prepare` →
`e8/labels.json`): the bed oracle on the same practice runs; a build is **known-good** if every completed case passes on all three
worlds, otherwise **defective**.

**Gold condition lists, written before any capture or bind call:**
- BUILDER-1: [gold-builder1.json](gold-builder1.json), 80 conditions (commit `84c06e4`, sha256 `c62f1d1f…3b2c4`).
- E8: `research/need-router-20261014/tracker-e8/gold.json` (30 ids, 15 U, 76 clauses; frozen 2026-10-14).

## 3. Arms

| arm | what flags a build | model calls |
|---|---|---|
| **T0** no tracker | BUILDER-1: the build's own practice run does not pass (status or its own checks). E8: run health (any refused tick output or an incomplete run). | none |
| **T1** prose checklist | a Haiku reviewer ticks any condition `unmet`, given the person's words, the SAME condition list as T2, the build (workflow JSON / solver source) and its base practice run (BUILDER-1: effects + sample data; E8: run health). Prompt `tracker-prose-checklist/1`. | 1 per build |
| **T2** tracker | any condition `unmet` (grounded template check, not flagged suspect by the real-shape gate or G3). Capture `tracker-capture/1` (Haiku), bind `tracker-bind/1` (Haiku), checks over base + targeted + repeat practice runs. | capture 1 + bind 1 (+1 lint retry) per request; $0 per build |
| T2noG3 | as T2 without the cross-build G3 flag (the product with one build in hand) | same |
| T0+T2 | either | same |
| T2-rule | as T2 with the $0 capture rule (every clause is a condition) | bind only |
| T2-M | as T2 with Mercury 3 as the binder | Mercury bind |

**Samples.** BUILDER-1: Haiku capture K = 3 samples (s0, s1, s2); each sample bound once by Haiku (T2 × 3); T2-rule and T2-M K = 1;
T1 K = 1 per build on capture s0's list. E8: conditions = the stored 2026-10-14 Haiku extraction s0 plus the $0 coverage rule (no new
capture call; the earlier branch measured this method at 28/30 ids); Haiku bind K = 1 (K = 2 if budget allows); T1 K = 1 per build.

## 4. Measures and decision rules (fixed now)

**Primary capability number (BUILDER-1):** defective builds caught before the live run, at zero false alarms on the 83 verified
builds, for T0, T1, T2 and T0+T2 (T2 per sample; mean and range over the three samples).

**Decision rules:**
- **R1 (tracker adds catches):** T0+T2 catches ≥ 3 more of the 18 defective builds than T0 alone, in every T2 sample.
- **R2 (precision):** T2 raises 0 false alarms on the 83 verified builds in every sample (bar from the dossier: alarm precision ≥ 0.95
  and zero false alarms on known-good builds). One false alarm in any sample fails R2.
- **R3 (vs prose checklist):** T2's alarm precision ≥ T1's, and T2's false alarms ≤ T1's.
- **R4 (capture):** Haiku capture recall vs the gold ≥ 0.90 in every sample. Also reported: the $0 rule's recall (71/80 = 0.8875,
  computed at freeze time) and recall on testable gold conditions only.
- **E8:** T2 raises no `unmet` on a known-good build (R2-E8); T2 flags lineage 3 and B1-O (R1-E8); T1 reported alongside.

**Also reported, no threshold:** condition-level check precision after adjudication (§5); abstention (share of statuses `unknown`, by
reason); the share of testable conditions the binder could not express (inspection / no-check / needs-answer: the template set's
expressiveness; the dossier's risk 2 says > 20% means the set is wrong); the real-shape gate and G3 flags; cost per build (capture +
bind per request divided by the builds checked, and T1 per call); Mercury tokens.

## 5. Adjudication after scoring

Every `unmet` (build, condition) is labelled by the analyst after scoring, from the evidence excerpt and the build's practice
effects: **true** (the build does not do what the person's words say), **false** with a cause (binding error, evaluator bug, scenario
artefact, vacuous or over-literal reading), or **oracle gap** (true per the words, not checked by the hidden-world oracle). The
build-level numbers in §4 do not change with these labels; they are reported beside them. Every false alarm is root-caused.

## 6. Known threats (why this is development evidence)

- **In-sample.** I read the 24 BUILDER-1 requests while writing the prompts and the evaluator; I checked the evaluator on hand-written
  checks for six cases (L3, I2, E1, C3, O2, W3) against archived builds before this freeze, and changed it (mentions by any unique
  name, boundary IN points, the same-store repeat run). SPEC-E was read by an earlier gleaning prompt. The gold lists were written by
  the same author. A fresh request set by another author is needed before any claim.
- **Correlated builds.** The five BUILDER-1 arms share templates; 83 verified builds are not 83 independent trials.
- **Label noise.** The hidden-world oracle judges effects, not each condition; it misses some violations of the person's words and
  flags some template expectations the person never stated.
- **Practice ≠ live.** Only practice data is used before the run; a condition met on practice data can fail live.

## 7. Budget and faults

Haiku ≤ $3 in total (capture ≤ $0.30, BUILDER-1 bind ≤ $0.60, T1 ≤ $0.80, E8 bind ≤ $0.40, E8 T1 ≤ $0.40, rest reserve). Mercury
≤ 300,000 tokens (D18 per-item cap 0.5M). Paid steps run detached from a script file. Rate or usage limits and provider outages are
environment faults: the step stops, nothing from it is scored, it resumes after 30 minutes from the files already written.

## 8. Deviations

Any change to frozen code, prompts, gold or inputs after this commit is a deviation: recorded here with its reason, both versions
re-scored at $0 where possible, and both reported.

**D1 (2026-10-21 23:25Z, E8 environment faults; before any E8 judge or score).** `run-e8.mjs prepare` ran under a load average of
about 20 on this shared 4-CPU machine. Two (build, world) runs hit environment limits rather than solver behaviour: s3-saga-engine on
world 1235 had 68 tick outputs refused with `timeout: "call timeout"` (the bed's 25 s per-call limit), and b1h-e8-1 stopped on all three
worlds at the 240 s world limit with no effect emitted. By the owner's rule these are environment faults, never scored. Change, in
`run-e8.mjs` judge and score only (no tracker code, prompt, gold or label changed): a (build, world) whose run in `prepare` or in
`judge` hit a call timeout or did not complete is excluded from the tracker's views and from the labels; a build with every world
excluded is not scored; the judge file records its own run health and the exclusions. `freeze.json` is not regenerated: this file's
hash differs from it, and this note is the record of why.


**Paid steps, 2026-10-21/22.** Both paid scripts hit `MODEL_RATE_LIMIT` (HTTP 429) at 23:29Z / 23:31Z (environment faults, not scored)
and were waiting when the container restarted. `freeze.mjs --check` now accepts a drifted file only when `deviations.json` records its
exact hash (D1's `run-e8.mjs`). Resumed 2026-10-22 02:14Z (`paid-resume.sh`): the E8 T1 step finished at 02:26Z; the BUILDER-1 part
then stopped at the freeze check because D2 below was being written (the check did its job), and resumed after D2 was recorded.

**D2 (2026-10-22 02:50Z, check semantics v2; after the frozen s0 judge was read, before any judge of s1, s2, the rule capture, Mercury or
E8, and before the BUILDER-1 T1 run).** The frozen s0 judge raised 23 false alarms on 83 verified builds (R2 fails). Each was
root-caused (RESULT-TRACKER.md §5); every cause is a rule of evaluation, not a binding the model could fix by itself. Change: a second,
selectable semantics `v2` in `app/core/tracker/semantics.mjs` (R-wording, R-closed, R-overlap, R-it, R-names, R-objects, R-order,
R-chimera, R-state), threaded through `checks.mjs`, `gates.mjs`, `status.mjs`, `index.mjs`, `scenarios.mjs` and `practice.mjs`
(`ordered: false` on app views); the judge steps of `run-builder1.mjs` and `run-e8.mjs` write the frozen `v1` file
(`judge-<bind>.json`) and the `v2` file (`judge-v2-<bind>.json`) from the same practice runs. Guarantees, both checked before this note:
(a) `v1` is unchanged: re-judging s0 under `v1` with the new code gives the same status, reason, decided and violated counts for all 954
(build, condition, G3 view) entries (`same-statuses.mjs`; only evidence ids differ, because the outbox is read in file order);
(b) nothing a model is asked changes: `verify-prompts.mjs` rebuilds all 125 journaled first-attempt capture and bind requests from the
new tree byte for byte (prompt, system prompt, schema). Reporting: `v1` stays the primary result for R1–R4; `v2` is reported beside it as
a post-hoc deviation. `v2` was designed on s0's builds and bindings (in-sample, development); on s1, s2, the rule capture, Mercury and E8
it meets bindings and checks it was not designed on, but the same requests and builds, so it is development evidence too. The product
default is `v2`.

**Paid steps, 2026-10-22 (continued).** The BUILDER-1 part resumed after D2 (02:50Z): the s1, s2 and rule binds and the T1 prose step ran;
the container restarted at about 03:11Z during T1 (89 of 101 builds reviewed; nothing scored from the interrupted call). The Mercury bind
had not started. The weekly usage limit then held all work until 2026-10-28.

**D3 (2026-10-28, check semantics v3; after reading the v2 judges of s0, s1, s2, the rule capture and E8; before the 12 remaining T1
reviews, the Mercury bind, a second E8 bind sample and any call on the held-out set).** Under v2 the BUILDER-1 judges still raised 4, 11
and 4 false alarms (s1, s2, rule; [RESULT-TRACKER.md](RESULT-TRACKER.md) §5), and E8 raised false alarms on all 6 known-good builds
through three checks (C-066, C-068, C-069) whose failures were timing, outcome and trigger artefacts, not defects. Each was root-caused;
the causes are rules of evaluation. Change: a third selectable semantics `v3` (`app/core/tracker/semantics.mjs`, `checks.mjs`, `index.mjs`):
R-state+, R-objects+ (by each sheet's schema), R-contra, R-deadline, R-commit, R-outcome, R-discharge (the platform's declared reversal
ops, `experiments/tracker-v2/e8.mjs` REVERSES) and R-qualifier (a tenth rule, R-universal, was tried and dropped: it hid a real
omission in the product test). The judge steps write `judge-v3-<bind>.json` beside the v1
and v2 files, and every v2/v3 file also carries `t2Solo`: the product with one build in hand (the real-shape gate on that build's own
runs, no G3). `run-e8.mjs judge` no longer re-runs a build whose every world faulted in `prepare` (it stalled a world for 240 s and ran
the judge out of heap on 2026-10-22 03:20Z). Guarantees, checked before this note: v1 and v2 give the same status, reason, decided and
violated counts as before for every (build, condition, G3 view) on E8 and on BUILDER-1 s0 (`same-statuses.mjs`); nothing a model is asked
changes (`verify-prompts.mjs`). Reporting: v1 stays the primary result for R1-R4, v2 and v3 are post-hoc deviations reported beside it.
v3 was designed on BUILDER-1 (all four bindings) and E8: it is development evidence on both beds. Its held-out test is a fresh request
set by another author, preregistered separately before any call on it: [PREREG-TRACKER-H.md](PREREG-TRACKER-H.md). The product default
is `v3`.
