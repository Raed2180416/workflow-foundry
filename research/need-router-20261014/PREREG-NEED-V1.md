# Preregistration: need router v1 (claims C7a and C7b)

Status: **DRAFT, not frozen.** Filled 2026-10-14 from [PREREG-SKELETON.md](PREREG-SKELETON.md) (DESIGN §7 M0 item 1),
with every skeleton TBD resolved from [DESIGN.md](DESIGN.md) and [DECISIONS-ADOPTED.md](DECISIONS-ADOPTED.md) where those
files decide it. The orchestrator freezes this file: it changes the status line to `FROZEN`, sets `"status": "frozen"` in
`prereg/stages.json`, fills the engine stamp (§4.4) and commits both before any NL0 label is paid for. A dated addendum
fixing the router artefact (§6) is committed at Freeze, before any held-out label exists. Nothing here is evidence.

**Revised 2026-10-14, still DRAFT,** after an adversarial review of the first draft (committed 21:55 in 6244e91). The
revision records M1, which had already run, and M1-d5, which is running (§0.1, §12, §13). It also fixes the reading rules
the review found broken: C7a's interval and its power precondition (§7, §8), the sign-flip floor (§7, §11), G1's bound
(§8), θ fitting (§6), stamps (§4.4), the cap meter (§12), the decisions envelope (§12) and the checker (§15). Every
change was made before any need-router label exists.

**Revised again 2026-10-15, still DRAFT.** M1-d5 ended at 00:02 on 10-15. M1-R, which re-ran M1's 54 timeouts at a 600 s
wall, ran from 00:43 to 06:20. Both are recorded from their committed rows as development results (§0.1, §1.1, §3.2, §12,
§13 D7–D8), with J-NEED-2. The checker now also refuses: a freeze while a recorded run is unfinished; a recorded run that
§0.1 does not name; an overrun that §13 does not record; a stage outside the totals with no budget; and, once the Freeze
addendum pins the analysis, an analysis that does not import the preregistered rules (§15). No need-router label exists.

**Revised a third time 2026-10-15, still DRAFT,** after a second adversarial review (§13 D9 lists every change). C7a reads
REFUTED only when its upper bound excludes a useful balanced accuracy, and its power precondition is now a chance, not a
best case (§7, §8, F12). The power gate is computed without r3p as well (§11). The decisions envelope is a launch gate in
code, ordered by git commit time and compared with the A-Freeze row (§6, §12). The meter-gate rule, the cache-write rate
billed and budget overshoot are stated (§5, §12). Committed spend counts recorded overruns (§12). The owner tasks have
their own capped stage, NL0-owner (§12). A `--dry` run may not generate held-out tasks before Freeze (§3.3). The Jev
feature decision excludes r3p (§6). Voided lineages score as failures (§5). No need-router label exists.

Machine-readable half: [prereg/stages.json](prereg/stages.json) (jobs, clusters, arms with settings hashes, seeds, price
table, grid, RNG seeds, stages with caps, the reading rules under `analysis`, the cap meter, the engine-stamp lists).
Checked by `node experiments/need-router/prereg-check.mjs` (§15). Where this text and `stages.json` differ, the run is
blocked until they agree. The checker enforces the parts it can: status; every job id, stage id (as a whole token) and
arm hash named here; ledger refusals; seed and freeze rules; envelopes; caps; policy prices; placeholders at freeze. The
reading rules of §5–§8 and §11–§12 are also code: `experiments/need-router/prereg-rules.mjs`, with tests.
`evaluate.mjs` must read them from there (§14).

Tags: [D] from DESIGN.md, [A] an adopted owner decision (DECISIONS-ADOPTED.md), [M] measured or read in a repository file
today, [P] a choice made in this preregistration because DESIGN leaves it open (listed in §14 for review before freeze).

Evaluation grades: **development** (TRAIN jobs, M0 diagnostics, M1 with its tags `m1` and `m1-d5`, M1-R (tag `m1-r`),
M1e, NL0, NL0-owner, NL1, judge-H on TRAIN, archived LEGACY rows; used to build and tune), **held-out** (NL2p, NL2, NL2bp, NL2b,
E2E; families never used for tuning), **sealed** (NL3; run once by a session that tuned nothing). Tests used to improve the router or
the builders are development evidence, never held-out.

---

## 0. What the author had seen before writing

No need-router label exists (no five-mode paired row on any job). Before writing the hypotheses (§1.1) the author had
read: DESIGN.md including its Appendix B dev numbers (records, kinetics, codefix and P1 rows; C0 dev; E8 B1-H, B1L-H and
B1-O results, all dev, mostly K = 1), the bed READMEs and pass rules, and the $0 example-input census of §3.2 (computed
today, no model). No held-out task was shown to a model, no oracle was run on any evaluation seed of this program, and
beds/sealed/ was not read. Held-out evaluation tasks were generated only to hash them for the L4 pre-check (§3.3); their
contents were not inspected. The hypotheses therefore encode prior dev evidence; they are a record of expectations, not a
test of them.

That paragraph describes the first draft (21:55). It was stale when written: M1 had started at 21:31, 24 minutes before
that commit, and the draft still listed M1 as a future stage.

### 0.1 Development results observed after the first draft (recorded before freeze)

All of the following is **development evidence** (dev attack seeds, K = 1, one mode). None of it is a need-router label:
no five-mode paired row exists. The 2026-10-14 revision's author read the M1 report, tallied its 192 rows ($0), read the
Jev-need report, and recomputed the reviewer's set-1 feature medians at $0; that author did not read any M1-d5 row. The
2026-10-15 revision's author tallied the M1-d5 and M1-R rows at $0, including M1-R's set-aside attempts in its live
directory outside the repository, and read the M1, M1-R, Jev-need and J-NEED-2 reports. The band rule of §3.2 was fixed
before either read.

- **M1** (tag `m1`; DESIGN §7; decision 14). Ran from 21:31:36 to 22:59:47 (first and last row), committed in f1552d4.
  Command: `node experiments/need-router/m1-run.mjs --cap 15`; `m1-run.mjs` sha256 `478744664b95accf016fe7ea628ee856b3ab7bdb559081a0b7ac261d4c8a58e7` (commit
  e5defed). One Haiku call per task: 8 rungs × 12 dev attack seeds × 2 efforts = 192 calls at d3.
  - Results (pass per effort, none and medium). R0 12/12 and 12/12, so K2 passes. R1 0/12 and 0/12 (18 of the 24 calls
    timed out). R2 4/12 and 3/12. R3 8/12 and 9/12. R3′ (`r3p`) 12/12 and 11/12. R4 and R5 0/12. R6 2/12 and 6/12.
  - Gates. The W-bed one-call admission gate (W-BED §2.4 item 1, ≤ 2/12) failed at d3 for R2, R3, R3′ and R6.
  - Spend. Reported: $2.9957. The runner booked 26 `MODEL_TIMEOUT` calls at $0. On the §12 meter, which charges a row
    with no observed cost at its $1 bound, M1 is **$28.9957** against its $5 share and M1's $15 cap. The provider's
    actual billing for those 26 timed-out calls is unknown.
  - Stamp. No launch stamp was taken; S-M1 was still "TBD at M1 launch". A record reconstructed after the fact from
    e5defed, the runner's commit at 21:32:46, is in `stages.json` (M1 `observed.m1.engine`). Whether the working tree
    differed at launch is unknown.
- **M1-d5** (tag `m1-d5`; not in the first draft, so an unregistered run, deviation D2). Ran from 23:01:42 to 00:02:45
  (first and last row), committed in 5f75f17. Command: `node experiments/need-router/m1-run.mjs --rungs r2,r3,r3p,r6
  --difficulty 5 --cap 10`; `m1-run.mjs` sha256 `7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692` (commit 56c0a82). 4 rungs × 12 seeds × 2 efforts = 96 calls
  at d5, on the same dev attack seeds. It kept its own spend counter (reported dollars, no reservation) and its own
  --cap 10.
  - Results (pass per effort, none and medium). R2 2/12 and 2/12. R3 0/12 and 0/12 (17 of the 24 calls timed out, 4
    were schema-invalid). R3′ (`r3p`) 10/12 and 11/12. R6 0/12 and 0/12 (11 timed out).
  - Gates. At d5 the W-bed one-call admission gate passes for R2, R3 and R6 and fails for R3′.
  - Spend. Reported: $5.9199. The runner booked 28 `MODEL_TIMEOUT` calls at $0. On the §12 meter the tag is
    **$33.9199** against its $10 share. With tag `m1`, M1 is $62.9156 on the meter (reported $8.9156) against its $15
    cap.
  - Reading. The need flips with difficulty on R3 (8–9/12 at d3, 0/12 at d5) and R6 (2–6/12, then 0/12). One call
    still solves R3′ at d5.
- **M1-R** (stage M1-R, tag `m1-r`; an unregistered run after D2 had closed M1, deviation D7). It re-ran every
  `MODEL_TIMEOUT` trial of tags `m1` (26) and `m1-d5` (28) at a 600 s wall, with the same arm definitions (the runner
  checks the arm hashes against the source rows). It is a plan item of
  `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §5 row 4 (cap $25). Command:
  `node experiments/need-router/m1-rerun.mjs`; `m1-rerun.mjs` sha256 `662ae4407990fc5a5178d28d64fe1a948a0a58dda63a4e7892bda1e2d7508a49` (commit 4e2e8fe).
  - Attempts. Attempt 1 (about 00:38–00:43) is invalid: the ModelPort's own 300 s deadline overrode the 600 s wall
    (fixed in 29c6c48). Its 4 rows, all timeouts at $0, are kept outside the repository. Attempt 2's first row is at
    00:55:11. At 02:09 four trials hit `MODEL_RATE_LIMIT` (the subscription session limit, an environment fault). They
    were set aside outside the repository and re-run by a resume that ended at 06:20:22. Committed in 8f72e17.
  - Results (54 trials). 4 pass: R1 at d3, effort medium (s383, s390); R6 at d5, effort none (s383, s389). 34 fail
    with an answer, 10 still time out at 600 s, 6 are schema-invalid. Merged into the M1 rows (`runs/m1-r/merged.jsonl`,
    labelling `m1r`), the tasks one call solves at either effort go from 61/144 to 65/144. No `r3p` trial timed out, so
    M1-R ran no `r3p` task. The W-bed gate readings do not change (R1 at d3 and R6 at d5 stay within 2/12).
  - Spend. Reported: $7.8934 ($6.6318 in attempt 2, $1.2616 in its resume; attempt 1's rows were $0). On the §12
    meter: $17.8934 over the 54 final rows, with the 10 timeouts at their $1 bound. Counting the 8 set-aside attempts
    at their bound as well (§12): **$25.8934** against the $25 plan cap.
  - Stamp. None taken. A record reconstructed from 29c6c48, the last engine change before attempt 2, is in
    `stages.json` (M1-R `observed.m1-r.engine`). It ran on policy version `2026-10-09.1` (D6).
- **Jev-need** (commit 8ef7fa2). Hosted Jev read the 96 M1 tasks, including the 12 `r3p` tasks, and predicted whether
  one call suffices. Task-level AUROC 0.53, against 0.71 for a one-line size rule. It cost a fraction of a cent.
  Development evidence for decision 12 only. Its d3 + d5 update (144 tasks, including the 24 `r3p` tasks): AUROC 0.46
  against 0.65 for the size rule under labels `m1`; 0.44 against 0.63 under `m1r` (M1-R report).
- **J-NEED-2** (commit 93a0913; re-analysed under `m1r` in 8f72e17). Six property questions to hosted Jev and a Haiku
  typed arm on all 144 M1 tasks, including `r3p`'s 24; leave-one-family-out heads over 8 families. Its own preregistered
  rule put code features + Jev in the NR-knn branch (AUROC 0.707 [0.46, 0.98] under `m1`, 0.697 [0.48, 0.97] under
  `m1r`). Jev's increment over code features alone is not above noise (0.202 [−0.00, 0.49]; 0.134 [−0.01, 0.36]).
  Development evidence for decision 12 only. Whether those features enter NR-knn is open for the Freeze addendum (§14).
- **The --hashes pre-check of the first draft** generated the held-out evaluation tasks (8801–8812) and E2E tasks
  (8825–8836) of six held-out jobs in-process, without a ledger check per task, to hash them. Their contents were not
  inspected. The pre-check now checks every seed against the ledger and hashes held-out families only in a child process
  that prints counts and task ids (§3.3, deviation D4).
- **Set-1 feature medians** (the reviewer's, recomputed here at $0 with `features.mjs taskFeatures` at the preregistered
  per-seed difficulties; log10). `wbed-r3-hi`: tokens 4.60, fan-out 2.98. `wbed-r6`: 4.78, 1.51. `wbed-r1-hi`: 4.26,
  2.27. `incident`: 4.48, 0.00. `r3p`: 4.63, 1.52. These are router inputs, not labels.

**What M1 changes in this file** (each change is logged as informed by M1):
- `r3p` is flagged **dev-observed** as well as near (§3.1). Its N = 1 hypothesis gets a logged revision; the original row
  stays the record (§1.1). The r3p-dropped reading becomes mandatory for any C7a or C7b claim (§8).
- The bands of `wbed-r2-hi`, `wbed-r6` and `r3p` were checked against the W-BED §2.4 gate. They are **kept**, for the
  reasons in §3.2.
- Every other hypothesis row whose family ran in M1 (`wbed-r0`, `wbed-r1-hi`, `wbed-r2-hi`, `wbed-r3-hi`, `wbed-r6`) was
  checked against M1 and is unchanged.
- M1's spend under the §12 meter, the missing stamp and the M1-d5 run are deviations D1–D3 (§13).

**What M1-d5 and M1-R change** (2026-10-15; each logged as informed by them):
- `r3p` gets a second logged hypothesis revision at N = 1 and N = 10 (§1.1). The earlier rows stay the record.
- The `r3p` reading printed beside every C7a and C7b reading now drops both observed levels, d3 and d5, leaving d4
  (§3.2, §8). It is still not a gate.
- No band changes (the §3.2 rule). The rows of `wbed-r2-hi`, `wbed-r3-hi` and `wbed-r6` were checked against M1-d5 and
  M1-R and are unchanged.
- M1-R, its spend and its missing stamp are deviation D7 (§13). The §12 meter now says that set-aside attempts count.

## 1. Claims and hypotheses

- **C7a (need detection).** Whether a job needs a workflow can be read before execution from its structure (input size,
  fan-out) and its declared hard requirements. [D]
- **C7b (routing value).** A need router beats the best fixed mode (chosen on TRAIN) on held-out families in utility per
  task, with calibrated slider positions (ROADMAP:805, restated). [D]
- **H0 (structural rule, primary for C7a).** `intrinsic(x) = logInputTokens(x) ≥ θ_tok OR maxListLength(x) ≥ θ_fan`,
  plus the hard guard. Everything else about need is declared economics (N, V, W, executor strength). [D]
- **H-test (workflow self-testing).** A built workflow's own check rejects most of its wrong answers. Falsified per
  lineage by F11. [D]
- **Co-primary policies for C7b:** NR-static (guard, rule, leaf calculator; no model call before the work) and NR-probe
  (the same plus a value-of-information probe on one example). Holm over the two. NR-probe is co-primary because the
  owner allowed a few cents of probing before deciding (decision 7). [A]
- **What "testing" means:** both the router test and each workflow's own test (decision 6). [A]
- **An Opus agent with no workflow is "no workflow"** (decision 4). On flat families the label is then set by model
  strength, not structure (DESIGN §0). [A]

### 1.1 Hypotheses table (written before any label)

Expected best class and mode in the headline economics (V = $1, W = V), at N = 1 (the intrinsic-need reading) and
N = 10 (the headline). "Workflow" = guided (agent-H+proc) or built (construct-H). A job whose row says `pending` gets its
row at admission, before its labels are viewed, committed with the admission record. Copied into `stages.json`
(`jobs[].hypothesis`).

| Job | Split | N = 1: class / mode | N = 10: class / mode | Note |
|---|---|---|---|---|
| `records-lo` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | small flat extraction |
| `records-hi` | TRAIN | no-workflow / agent-H | no-workflow / agent-H | slider-sensitive: agent-O expected to lead at V = $10 |
| `wbed-r0` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | the negative control (K2) |
| `r0-pad` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | breaks the length shortcut; must route as `wbed-r0` |
| `wbed-r1-hi` | TRAIN | no-workflow / agent-H | workflow / construct-H | agent at N = 1, workflow at large N |
| `wbed-r2-hi` | TRAIN | no-workflow / agent-H | no-workflow / agent-H | looks like branching, not worth a workflow |
| `wbed-r3-hi` | TRAIN | workflow / construct-H | workflow / construct-H | strongest built-in positive; agent-H+proc the likely alternative in A at N = 1 |
| `r3-mini` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | breaks the fan-out shortcut; must route unlike `wbed-r3-hi` |
| `wbed-stage` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | a workflow-looking surface, one stage |
| `wbed-r6` | TRAIN | no-workflow / agent-H | workflow / construct-H | open, low confidence |
| `kinetics-lo` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | break-even near $5 per success |
| `kinetics-hi` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | slider-sensitive |
| `codefix` | TRAIN | no-workflow / agent-H | no-workflow / agent-H | visible tests are a deployable verifier |
| `codefix-notests` | TRAIN | no-workflow / agent-H | no-workflow / agent-H | the no-verifier toggle |
| `need-qa` | TRAIN | no-workflow / direct-H | no-workflow / direct-H | trivia and arithmetic anchors |
| `incident` | HELD-OUT | no-workflow / agent-H | no-workflow / agent-H | d4 inputs exceed 100K tokens |
| `synth-lo` | HELD-OUT | no-workflow / direct-H | no-workflow / direct-H | |
| `synth-hi` | HELD-OUT | no-workflow / direct-H | no-workflow / direct-H | workflow expected only at N = 100 |
| `ownerci` | HELD-OUT | no-workflow / agent-H | no-workflow / agent-H | wrong-reuse trap |
| `r3p` | HELD-OUT (near, dev-observed) | workflow / construct-H | workflow / construct-H | workflow at d4–5; revised for N = 1 after M1 (below) |
| `need-constraint` | HELD-OUT | no-workflow / direct-H | no-workflow / direct-H | |
| `far-1`, `far-2` | HELD-OUT | pending | pending | written after Freeze; row at admission |
| `gameqa` | HELD-OUT (conditional) | no-workflow / agent-H | workflow / construct-H | agent at low d, workflow at high d; direct-H masked |
| `runbook` | FORCED | workflow / construct-H | workflow / construct-H | forced by typed requirements; guard recall only |
| `e8` | FORCED (diagnostic) | workflow / construct-H | workflow / construct-H | read from #58 at M1e |
| `owner-dev`, `owner-sealed` | OWNER / SEALED | pending | pending | one row per owner task, before its labels |
| `sealed-1` … `sealed-4` | SEALED | pending | pending | written by the NL3 session before its labels |

**Revisions informed by M1** (logged; `stages.json jobs[].hypothesis.revisions`). The rows above are the record written
before M1 was read, and they stay. One revision:

| Job | Informed by | N = 1: class / mode (revised) | Note |
|---|---|---|---|
| `r3p` | M1 tag `m1`: one call passed 12/12 and 11/12 at d3 (dev attack seeds 479–490) | either / direct-H | One call solves the d3 third of the band. d4–5 was untested at this revision. The band is unchanged (§3.2). |

The rows of `wbed-r0`, `wbed-r1-hi`, `wbed-r2-hi`, `wbed-r3-hi` (whose band excludes d3) and `wbed-r6` agree with M1 and
are unchanged. M1-d5's results may add revisions before Freeze, logged the same way. They cannot change a band.

A second revision, informed by M1-d5 (2026-10-15):

| Job | Informed by | N = 1 (revised) | N = 10 (revised) | Note |
|---|---|---|---|---|
| `r3p` | M1 tag `m1-d5`: one call passed 10/12 and 11/12 at d5 (the same seeds) | no-workflow / direct-H | either / direct-H | One call solves both observed levels; d4 is untested. At N = 10 a built workflow could tie one call's ~0.9 only with a cheap build, so one call is expected to lead. The band is unchanged. |

The rows of `wbed-r2-hi` (R2 2/12 at d5 at each effort), `wbed-r3-hi` (R3 0/12 at d5, still 0/12 after M1-R) and
`wbed-r6` (d5 is outside its d3–4 band) were checked against M1-d5 and M1-R and are unchanged.

Implied H0 expectations (for the record, not a test): the workflow class is expected only where inputs are large
(`wbed-r3-hi` up to 65K tokens, `r3p` up to 64K, `wbed-r6` up to 75K) or fan-out is wide (`wbed-r1-hi`), and **not** on
`r0-pad` (23K tokens of padding), `r3-mini` or `wbed-stage`. `incident` (up to 107K tokens at d4) is the planned
counterexample to a pure size rule: expected no-workflow despite its size.

The set-1 medians (§0.1) make two consequences explicit:
- **H0 is expected not to be fitted.** The only TRAIN job hypothesised to need a workflow at N = 1 is `wbed-r3-hi`, in
  cluster W, which is below §6's fitting minimum (2 confident positives in 2 clusters).
- **No fitted rule could call `r3p` intrinsic.** Even with a fit, its tokens (4.63) sit below a hypothesised TRAIN
  negative (`wbed-r6`, 4.78), and its fan-out (1.52) is far below `wbed-r3-hi`'s (2.98).
- **No held-out positive is hypothesised** after the second `r3p` revision. Until `far-1`, `far-2`, `gameqa` or the
  owner tasks get their rows, the confident held-out N = 1 labels are expected to hold one class.

Under these hypotheses C7a is therefore expected to read INCONCLUSIVE (§8).

## 2. Unit and populations

- **Unit:** a job = (family, difficulty band, N, V, W, verifier, typed hard requirements). One decision per job, before
  the work; pinned. A single request is a job with N = 1; a recurring family has a declared N (decision 5). [A]
- **Primary population:** non-forced held-out jobs (split HELD-OUT and, once admitted, HELD-OUT conditional), L_today
  labels. [D]
- **Forced stratum:** jobs with a typed hard requirement (`runbook`, `e8`). Reported separately; guard recall only. [D]
- **Owner and sealed jobs:** `owner-dev` (up to 5 owner tasks, in their own stage NL0-owner, §12) is development evidence
  only. `owner-sealed` and
  `sealed-1` … `sealed-4` form the sealed stratum (NL3). The owner tasks are independent tasks, so the dev/sealed split of
  owner tasks does not break the one-family-one-split rule. [D]
- **Weights:** each held-out cluster weighs 1; jobs within a cluster weigh equally. [D]

## 3. Families, clusters, splits, bands, seeds

### 3.1 Clusters

Families that share a world, generator or library (by import graph) form one cluster and stay in one split [D]:
cluster **W** = {records, wbed-r0, need-r0pad, wbed-r1, wbed-r2, wbed-r3, need-r3mini, need-stage, wbed-r6}, in TRAIN (r2
imports `beds/records/pools.mjs`; r3 imports `r1/world.mjs`; r6 imports `wbed/lib/domain.mjs` and `parties.mjs`; the three
anchors wrap R0, R3 and the rungs). r3p imports only `wbed/lib/{contracts,faults,prng}.mjs`: its own cluster, held out,
flagged **near** [D]. It is also flagged **dev-observed** [M]: M1 ran one Haiku call on it at d3 (12/12 and 11/12) and
M1-d5 at d5 (10/12 and 11/12), and Jev-need and J-NEED-2 read its 24 M1 tasks (§0.1). Cut from v1: r4, r5, gridquest,
the `ask` mode. [D]

| Split | Cluster | Jobs |
|---|---|---|
| TRAIN | W | `records-lo`, `records-hi`, `wbed-r0`, `r0-pad`, `wbed-r1-hi`, `wbed-r2-hi`, `wbed-r3-hi`, `r3-mini`, `wbed-stage`, `wbed-r6` |
| TRAIN | kinetics | `kinetics-lo`, `kinetics-hi` |
| TRAIN | codefix | `codefix`, `codefix-notests` |
| TRAIN | need-qa | `need-qa` |
| HELD-OUT | incident, synth, ownerci, r3p (near), need-constraint, far-1, far-2 | `incident`; `synth-lo`, `synth-hi`; `ownerci`; `r3p`; `need-constraint`; `far-1`; `far-2` |
| HELD-OUT (conditional) | gameqa | `gameqa` |
| FORCED | runbook, e8 | `runbook`; `e8` |
| OWNER (dev) | owner-dev | `owner-dev` |
| SEALED | owner-sealed, sealed-1 … sealed-4 | `owner-sealed`; `sealed-1`, `sealed-2`, `sealed-3`, `sealed-4` |

Counts: TRAIN 4 clusters, 15 jobs. Held-out primary: 7 clusters if both far families are admitted (5 if not), 8 with
gameqa. [D]

**Admission.** A held-out family enters only after an audit by a session that did not write it, completed before its
labels are viewed (`far-1`, `far-2`, `gameqa`, `runbook`; the last two lack AUDIT.md). The far families are funded
(decision 11): 2–4 families written after Freeze by an author who has not seen the router code. [A, D]

### 3.2 Jobs: band, verifier, requirements, budget

Bands are frozen here, before labels. [D for the bands DESIGN names; P for `r0-pad`, `r3-mini`, `wbed-stage`,
`codefix-notests`, `need-qa`, `need-constraint`.] Max example tokens: the largest estimated input (ceil(bytes / 4) of
prompt, inputs and files, the `features.mjs` measure) over the nine example seeds at their preregistered difficulties
(§3.3), measured today at $0 [M]. agent-O gets `budgetUsd: 8` when that maximum exceeds 30K tokens, else 4. [D rule, P
"maximum over the nine examples"]

| Job | Family (bed) | Band | Deployable verifier | Max example tokens | agent-O $ | Est. $ |
|---|---|---|---|---|---|---|
| `records-lo` | records | d1–2 | schema | 4,938 | 4 | 12 |
| `records-hi` | records | d3–5 | schema | 10,010 | 4 | 18 |
| `wbed-r0` | wbed-r0 | d2–5 | schema | 436 | 4 | 7 |
| `r0-pad` | need-r0pad | d2–5 (as wbed-r0, so the metamorph pairs seed by seed) | schema | 23,491 | 4 | 8 |
| `wbed-r1-hi` | wbed-r1 | d3–5 | schema | 25,072 | 4 | 30 |
| `wbed-r2-hi` | wbed-r2 | d3–5 | schema | 8,936 | 4 | 20 |
| `wbed-r3-hi` | wbed-r3 | d4–5 | schema | 64,952 | 8 | 45 |
| `r3-mini` | need-r3mini | d3–5 (all on rung-d3 worlds, < 3K tokens) | schema | 2,844 | 4 | 6 |
| `wbed-stage` | need-stage | d3–5; kinds r1-normalise, r2-route, r3-classify, r6-worker, 3 tasks each | schema | 7,575 | 4 | 8 |
| `wbed-r6` | wbed-r6 | d3–4 | schema | 75,249 | 8 | 60 |
| `kinetics-lo` | kinetics | d1–3 | schema | 7,373 | 4 | 10 |
| `kinetics-hi` | kinetics | d4–5 | schema | 12,095 | 4 | 17 |
| `codefix` | codefix | d3–5 | visible tests (`tests/test_<module>.py`) | 20,577 | 4 | 14 |
| `codefix-notests` | codefix-notests (M0 generator, not yet written) | d3–5 | schema (visible tests removed) | ≤ 20,577 (codefix bound; re-measured when the generator lands) | 4 | 14 |
| `need-qa` | need-qa | d2–5 | schema | 869 | 4 | 4 |
| `incident` | incident | d2–4 (d5 about 248K tokens, cut) | schema | 107,229 | 8 | 30 |
| `synth-lo` | synth | d1–2 | schema | 5,510 | 4 | 10 |
| `synth-hi` | synth | d3–5 | schema | 13,421 | 4 | 22 |
| `ownerci` | ownerci | d3–5 | visible tests (the frozen test file) | 25,435 | 4 | 15 |
| `r3p` | wbed-r3p | d3–5 | schema | 64,375 | 8 | 40 |
| `need-constraint` | need-constraint | d3–5 (subtype = seed mod 4: each subtype once per difficulty) | schema | 1,059 | 4 | 4 |
| `far-1`, `far-2` | written after Freeze | frozen at admission | at admission | at admission | rule | 15 each |
| `gameqa` | gameqa (interactive) | TBD-NL2b, set by the audit before labels | schema | – | rule | 40 |
| `runbook` | runbook (interactive) | TBD-NL2b, set by the audit before labels | schema | – | rule | 40 |
| `e8` | ebed-e8 | as run by #58 | the E8 smoke host | – | – | 0 here |
| `owner-dev` | owner tasks | one task per job unless the owner declares N | the owner's acceptance check | – | rule, on the task's own size at admission (the bound assumes 8) | 3 per task, at most 5 tasks (NL0-owner); bound 19.50 per task |
| `owner-sealed` | owner tasks | as `owner-dev` | the owner's acceptance check | – | rule | in NL3 |
| `sealed-1` … `sealed-4` | chosen by the NL3 session | NL3 | NL3 | – | rule | in NL3 |

**Bands after M1** [P, informed by M1 and logged]. At d3, one call solved more than the W-BED §2.4 one-call gate allows
(≤ 2/12 at each effort) on three rungs: R2 (4/12 and 3/12), R6 (6/12 at medium effort) and R3′ (12/12 and 11/12). The
bands of `wbed-r2-hi` (d3–5), `wbed-r6` (d3–4) and `r3p` (d3–5) all include d3. All three bands are **kept**, for three
reasons:
- The §2.4 gate admits a rung for **W-bed claims**: a rung there must need structure. It does not admit need-router labels.
- The need router needs both classes. A band in which one call suffices on its lower part is a valid negative region,
  and the labels then show where the need starts, which is what C7a is about.
- Dropping a level after seeing one-call outcomes on it would choose bands to produce labels (DESIGN §6, "bands frozen
  before labels").

What M1 does change: labels are reported per difficulty for these three jobs. For `r3p`, which is held out, the reading
with its d3 tasks dropped is printed beside every C7a and C7b reading. M1-d5's results cannot change any band (this rule
was fixed before they were read).

M1-d5, read after this rule was fixed (2026-10-15): at d5 the W-bed gate passes for R2 (2/12 and 2/12), R3 (0/12 and
0/12) and R6 (0/12 and 0/12; 2/12 at effort none once M1-R re-ran its timeouts), and fails for R3′ (10/12 and 11/12). No
band changes. Because `r3p`'s d5 third is now observed as well, the printed `r3p` reading drops both observed levels (d3
and d5), leaving d4's 4 tasks.

Typed hard requirements: none on every non-forced job. Candidates, confirmed before D5 uses them: `runbook` = effects
with authority, human approval (bed README; confirmed by the NL2b audit); `e8` = durable wait, schedule, effects with
authority (E-BED; confirmed from spec-E at M1e). [P]

Declared router fields per job: N ∈ {1, 10, 100} (headline 10), V ∈ {0.10, 1, 10}, W ∈ {V, 0, 10V}, the verifier above
(none | schema | executable tests), and the requirements above. Banned router inputs: family id, bed version, bed `kind`,
any oracle, reference, label or result file (L5). [D]

### 3.3 Seeds and per-seed difficulty

New ledger purposes, added to `research/jit-20261008/SEED-LEDGER.json` by decision 8 (ranges `need-example`,
`need-label`, `need-heldout`, owner `need-router`, beds `*`) [A, M]:

| Role (`stages.json`) | Purpose | Split | Seeds | Use |
|---|---|---|---|---|
| `examples` | need-example | dev | 601–609: set 1 = 601–603, set 2 = 604–606, set 3 = 607–609 | features (set 1), builders and procedure writers (set k for lineage k), never scored |
| `probe` | need-example | dev | 601, at the band's median level | NR-probe and judge-H's probe task |
| `trainEval` | need-label | dev | 610–621 | TRAIN evaluation tasks |
| `trainReserve` | need-label | dev | 622–650 | TRAIN collision replacements |
| `heldoutEval` | need-heldout | test | 8801–8812 | held-out and forced evaluation tasks |
| `heldoutReserve` | need-heldout | test | 8813–8824 | held-out replacements |
| `e2e` | need-heldout | test | 8825–8836 | E2E lane (fresh tasks) |
| `drift` | need-heldout | test | 8837–8848 | monthly drift re-check |

M1 uses the W-bed's own attack seeds under purpose `jit-dev`: dev 379–390 for wbed-r0 … r6, dev 479–490 for wbed-r3p,
already in the ledger as `wbed-dev` and `wbed-r3p-dev`. [D, M] Every runner calls `assertSeedsAllowed` for every task (L4).

**Per-seed difficulty** (resolves the skeleton's "per-seed difficulty for banded probeSeeds") [P]:
- Evaluation task i (i = seed − first seed of the role, 0..11) runs at `band[floor(i · |band| / 12)]`: contiguous equal
  blocks (6, 4 or 3 tasks per level for bands of 2, 3 or 4 levels). Seed-parity halves (used by VBS\*, §5) then hold
  equal counts per level for bands of 2 and 3 levels; for 4-level bands they hold 2/1/2/1 and 1/2/1/2.
- Example seed s runs at `band[(s − 601) mod |band|]`, so every example set covers a band of up to 3 levels (a 4-level
  band shows 3 of its 4 levels per set). Example 601 is therefore the band's lowest level.
- **The probe task** (NR-probe and judge-H) is seed 601 at `band[floor(|band| / 2)]`, the band's median level (the upper
  middle of an even band), with stage kind `kinds[0]`. The first draft used example 601 itself, which would have shown
  the probe and judge-H only the band's easiest level and biased both towards direct-H. For a band of more than one level
  the probe task differs from example 601. It is never scored and is hashed against the evaluation tasks like an example
  (`prereg-check.mjs probeDifficulty`).
- `wbed-stage` fixes the stage kind by position: `kinds[i mod 4]` for evaluation index i, `kinds[(s − 601) mod 4]` for
  examples (`generate({stage})` override), so each kind appears once per difficulty.
- A collided or replaced seed is replaced by the lowest unused seed of the same split's reserve range and takes the
  replaced task's difficulty and kind. Racing top-ups reuse the same tasks; a lineage k > 3 reuses example set
  ((k − 1) mod 3) + 1 with a fresh builder session.
- `prereg-check.mjs` exports `planTasks`, `evalDifficulty`, `exampleDifficulty`, `probeDifficulty` and `exampleSet` so
  `label-run.mjs` reads this rule instead of restating it.

**Checks run today** [M]:
- The ledger accepts all 1,058 planned (bed, split, seed, purpose) combinations.
- `prereg-check.mjs --hashes` generated the 512 planned example, probe and evaluation tasks of the 20 jobs with an
  existing non-interactive bed: TRAIN examples, probe tasks and 610–621; held-out examples, probe tasks, 8801–8812 and
  8825–8836. It found no taskHash collision between an example or probe task and an evaluation task of one family, and
  no repeated evaluation task within a job. The ledger refused nothing.
- The pre-check now works as follows. Every seed is checked against the ledger (`seedRefusals`) before its task is
  generated. Held-out families are generated and hashed only inside a child process, whose only output is counts and
  task ids (`job:role:seed:difficulty`), never task content or hashes. This is the only use of held-out seeds before
  Freeze, it is recorded here and in §13 (D4), and no model sees the tasks.
- **Enforced since D9** (2026-10-15, second review). Two paths had generated held-out tasks in-process before Freeze:
  - `label-run.mjs --stage NL2|E2E|DRIFT --dry` skipped every paid-run check. It generated tasks 8801–8812, 8825–8836 or
    8837–8848, wrote their workdirs under `/var/tmp`, and scored stub outputs with the bed oracles.
  - The test suite hashed `need-constraint`'s held-out evaluation and E2E tasks in-process (`hashCollisions(..., { child:
    false })`) on every run.

  Now `label-run.mjs --dry` refuses any unit on a test-split evaluation role (`heldoutEval`, `e2e`, `drift`; replacements
  come from `heldoutReserve`) until the §4.4 A-Freeze row is filled. The only way past is `--allow-heldout-dry D<n>`, naming
  a deviation that §13 records (`prereg-check.mjs heldoutDryRefusal`). `hashCollisions` refuses `child: false` for any
  held-out, conditional or forced job, and the tests compare the child's counts with an in-process run on a TRAIN anchor
  only. On 2026-10-15 `/var/tmp/foundry-work/need/` held no `nl2-dry`, `e2e-dry` or `drift-dry` work root, so no such
  --dry run left files there [M]. The test suite's in-process hashing ran on every suite run, counts only. No model saw
  those tasks.
- The ledger's `need-heldout` range admits every bed (`beds: ['*']`). So only `stages.json` and the checker keep TRAIN
  jobs off it. The owner is asked to narrow it to the held-out families (§14).

Known caveat: the anchor-bed authors exercised dev 601–640 with $0 controls (no model; READMEs of need-qa, need-stage,
need-constraint). Those seeds stay admissible as dev examples and TRAIN tasks; held-out evaluation uses test seeds.

## 4. Arms, replication, engine

### 4.1 Arms (frozen settings; hash = first 16 hex of sha256 of the canonical arm definition in `stages.json`)

| Arm | Class | Definition | Replicates | Settings hash |
|---|---|---|---|---|
| direct-H | no workflow | `b0Call({id:'direct-H', model:'claude-haiku-5-5', reasoning:'none', maxTokens:16000})`; per-call timeout 600 s (provider setting, M0 code); `maxBudgetUsdPerCall` 1; a timeout is charged at the $1 bound, never $0; masked on interactive families | 2 draws | `2f585e2ca931a758` |
| agent-H | no workflow | `b0Agent({id:'agent-H', model:'claude-haiku-5-5', budgetUsd:2, timeoutMs:900000})` | 2 draws | `692b1ee40db6b8fc` |
| agent-O | no workflow (decision 4) | `b0Agent({id:'agent-O', model:'claude-opus-5-5', budgetUsd:4, timeoutMs:1200000})`; `budgetUsd:8` on jobs whose max example input exceeds 30K tokens (§3.2) | 1 draw + racing top-up | `d3ac6f262b2852d4` |
| agent-H+proc | workflow (guided) | build: one Haiku call (`reasoning:'medium'`) reads example set k (prompts, inputs truncated to 30K tokens, the output schema; no answers, no oracle, no scores) and returns `{procedure (≤ 1,500 words), checks[]}`; run: agent-H settings plus `PROCEDURE.md` in the workdir and one prompt line telling the agent to follow it and write `checks.json` | K = 2 lineages (sets 1, 2), each runs all 12 tasks once | `2778eacb045fa1b5` |
| construct-H | workflow (built) | `construct({arm:'B1', familyId, probeSeeds:<set k at per-seed difficulty>, builderModel:'claude-haiku-5-5', builderEffort:'high', builderBudgetUsd:3, constructionModelUsd:1.5, perTaskUsd:1, minutes:30, scoreChecks:0, models:['claude-haiku-5-5'], selfCheck:true})`, then `b1Script({perTaskUsd:1})`; the builder may run its solver on the example inputs (`tools/run-solver`), never sees an oracle score, and must deliver `check.mjs task.json answer.json` (exit 0 pass, 1 fail, no model calls), recorded as `selfVerdict` | K = 3 lineages (sets 1–3) | `103ffe5ba56b570d` |
| build-O (ceiling) | L_ceiling only | construct-H with `builderModel:'claude-opus-5-5'`, `builderBudgetUsd:8`; runtime model stays Haiku; on `wbed-r3-hi`, `wbed-r1-hi`, `kinetics-hi`, `synth-hi`, `r3p` | K = 1 (set 1) | `7eb484a07b3228d8` |
| ref-R1 (ceiling) | L_ceiling only | `static@v3:beds/wbed/references/r1-reference.mjs` (sha256 `b267498f7aae…4d73d`, FROZEN.json), live judges Haiku then Sonnet on a failed check; only if the engine stamp carries `static@v3:`; on `wbed-r1-hi` | 1 draw | `2a0de67dec1761a3` |
| ref-R3 (ceiling) | L_ceiling only | as ref-R1 with `r3-reference.mjs` (sha256 `61e6e6236d1c…f020`); on `wbed-r3-hi` | 1 draw | `a82541dae8f6f563` |
| judge-H (baseline) | secondary | one typed Haiku call per (job, V) with `reasoning:'medium'`: reads the probe task's prompt (seed 601 at the band's median level, §3.3), its inputs truncated to 8K tokens, N, V, W and the five-mode menu; returns `{choice: <mode>, needsWorkflow: boolean}`; 3 draws, majority on `choice`; a three-way split goes to the first of the three in the fixed order direct-H, agent-H, agent-H+proc, construct-H, agent-O (no label data, so judge-H's TRAIN score is not in-sample); asked at V ∈ {0.10, 1, 10}, N = 10, W = V | 3 draws | `faa0b937417f83f9` |
| m1-call-none | M1 | `b0Call({id:'b0-call-haiku-none', model:'claude-haiku-5-5', reasoning:'none'})` as committed in `m1-run.mjs` (port default timeout 300 s, $1 per call bound) | 1 | `04c4c925502938bd` |
| m1-call-medium | M1 | the same with `reasoning:'medium'` | 1 | `d32e71c4b1f17c09` |

judge-H's reasoning effort, truncation, schema, tie rule and cells are [P]. Model ids come only from
`policy/models.json` (checked) [D].

**Derived at $0 from paired rows** (no extra runs) [D]: `construct-H→agent-H` (on null, crash, schema-invalid output,
or a failed self-check), `direct-H→agent-H` (null, crash, schema-invalid), `agent-H→agent-O` (null).

**Classes** [D]: no workflow = {direct-H, agent-H, agent-O and their cascades}; workflow = guided {agent-H+proc} plus
built {construct-H, its cascade, build-O, references}. The binary NEED label uses these two classes; the three-way split
(none, guided, built) is reported beside it. Not in v1: JIT compile timing, library reuse, `template`, `construct+`,
`direct-S`, `ask` (logged flag only); archived JIT and C0 rows are LEGACY labels only.

### 4.2 Build rows

A build row holds `{usd, minutes, artifactSha, failed, runSolverCalls, hiddenPathAttempts, nestedModelAttempts}`. A
failed build fails every task of that lineage in the pure mode and is charged in B. For agent-H+proc, B is the procedure
writer's call. [D]

### 4.3 Replication and racing

Start at the replicates of §4.1. After a stage's first pass, compute P(best class) per job (§5); where it is under 0.8,
add one draw or lineage to each mode in the job's acceptable set, up to 4 per mode. agent-O gets a second draw on every
task where it is in the draw-1 per-task acceptable set (the modes within δ of the task's best draw-1 utility). Top-ups
use no new tasks and are charged to the stage that triggers them. [D; per-task acceptable set wording P]

### 4.4 Engine stamps (ROADMAP §6 rule 13)

No paid label runs on an engine that is still changing. The first draft had one stamp, S1, covering NL0, NL1 and judge-H
on TRAIN. It included the whole `experiments/need-router` tree, which keeps changing until Freeze (router, evaluation,
card). It also had no rule for the code §14 schedules between NL0 and NL1. The stamp is now split in two [P], with the
lists in `stages.json engineStamp`, printed read-only by `prereg-check.mjs --stamp --stage <ID>`:

- **Label-engine stamp** `L-<stage>`: everything that makes a label.
  - Files: `label-run.mjs`, `prereg-check.mjs` (the task plan), `prereg-rules.mjs` (the cap meter), `metrics.mjs` (racing
    top-ups) and `m1-run.mjs`; `experiments/jit/{seeds,stats}.mjs`; `policy/models.json`.
  - Trees: `experiments/lib` (runner, arms, model layer), `experiments/c0` (construct, the selfCheck paragraph),
    `src`, `beds/lib`.
  - Canonical hashes of `stages.json`'s arms, price table, seeds, grid, derived cascades and spend meter, and of the
    `need-*` ledger purposes and ranges.
  - The tree of every bed directory in the transitive bed-import closure of the stage's jobs (`beds/wbed-r2` reaches
    `beds/wbed` and `beds/records`).
  - Node. The coordinator adds the claude CLI version and whether `stream.mjs`'s `static@v3:` arm parser is reachable
    (decides ref-R1 and ref-R3).
  - It is **taken at every paid stage's launch** from the launch commit and written to `runs/<id>/STAMP.json` before the
    first paid call. `prereg-check.mjs stampDiff` compares it with the previous paid stage's stamp.
- **Analysis stamp** `A-Freeze`: `features.mjs`, `router.mjs`, `voi.mjs`, `metrics.mjs`, `evaluate.mjs`, `card.mjs`,
  `prereg-rules.mjs`. These may change freely until the Freeze addendum pins them (§6), because they touch no label.

**Allowed differences** between a paid stage's label-engine stamp and the earlier paid stages' stamps: a bed directory
that no earlier stamp holds, which means its first paid use. No earlier label depends on it. Examples: the TRAIN families
first run in NL1, the `codefix-notests` generator, the held-out families in NL2p and NL2. **Any other difference** is a
§13 deviation, recorded before the later stage starts:
- against the latest earlier stamp: a file, a tree, the preregistered arms, prices, seeds, grid or meter, the need
  ledger, Node, the CLI;
- against every earlier stamp that used it: a bed.

NL0 rows are never re-run or pooled differently because of a deviation; the deviation says which rows each engine
produced.

| Item | Value |
|---|---|
| S-M1 (M1, tags `m1` and `m1-d5`) | not taken: M1 launched at 21:31, before this row was filled. Reconstructed after the fact (not a launch stamp) in `stages.json` M1 `observed.*.engine`. `m1` ran on `m1-run.mjs` sha256 `478744664b95accf016fe7ea628ee856b3ab7bdb559081a0b7ac261d4c8a58e7` (e5defed); `m1-d5` on `7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692` (56c0a82). Deviation D1. |
| M1-R (tag `m1-r`) | not taken. Reconstructed from 29c6c48 in `stages.json` M1-R `observed.m1-r.engine`: `m1-rerun.mjs` sha256 `662ae4407990fc5a5178d28d64fe1a948a0a58dda63a4e7892bda1e2d7508a49` (4e2e8fe), policy `2026-10-09.1`. Deviation D7. |
| L-NL0 (label engine at NL0 launch; pasted here at freeze) | TBD at NL0 launch |
| L-NL0-owner, L-NL1, L-judge-H, L-NL2p, L-NL2, L-NL2bp, L-E2E, L-NL2b, L-NL3, L-DRIFT | taken at each stage's launch into `runs/<id>/STAMP.json` (with `LAUNCH.json`: launch time and the envelopes checked, D9) and compared with the previous paid stage by `stampDiff` |
| A-Freeze (analysis stamp) | TBD-FREEZE (the Freeze addendum, §6) |

## 5. Label protocol

- **Matrix:** `M[job][mode][task][replicate] = {pass, score, delivered, schemaValid, selfVerdict, deployableVerdict,
  usdReported, usdRepriced, usdImputed, ms, tokens, error}`; build rows as §4.2. [D]
- **Utility per task, in success-equivalents** [D]:
  `u_m = p_m − c_m/V − B_m/(N·V) − (W/V)·q_m − r/(N·V)`. p = oracle pass rate (mean over tasks of the mean over
  replicates or lineages); c = mean per-task cost (re-priced; for a meterUnverified session the reported figure, below);
  B = mean build cost per lineage, failed builds included;
  q = rate of delivered, schema-valid, wrong answers; r = routing cost per job (probe and judge calls), charged to router
  policies only. An abstention (null, or a self-check failure that is not delivered) costs nothing beyond its dollars.
- **Grid:** V ∈ {0.10, 1, 10}; N ∈ {1, 10, 100} (100 labelled "extrapolated, stationarity assumed"); W ∈ {V (headline), 0,
  10V} (decision 3); λ_t = 0. The owner declared no λ_t, so no latency sensitivity runs in v1; median latency per mode
  is reported. **Headline cell: V = $1, W = V, N = 10.** [A, D]
- **One cost meter:** every row is re-priced from recorded token usage with the pinned table `need-v1-prices@2026-10-14`
  (`stages.json priceTable`), cache reads and writes included; both the reported and the re-priced figure are shown;
  utility uses the re-priced one, except under the meter-gate rule below. Timeouts and killed sessions are charged at
  their bound. Measured and imputed dollars are split; a cell with more than 30% of its dollars imputed is left
  unlabelled. [D]
- **The meter-gate rule** [P, informed by D6 (§13 D9); `stages.json analysis.meterGate`; `label-run.mjs` with
  `meter-gate.mjs guardMeter`; `metrics.mjs`].
  - *Why.* D6 found that a re-priced Opus agent session lands 2.11 to 2.96 times below the CLI's own figure. The
    per-message usage lines miss the output tokens (`analysis/m0/REPORT.md`, D6 checks 1 and 2).
  - *The check.* `label-run.mjs` checks every priced agent or builder session.
    - Its per-message output tokens must be within 5% of the CLI's final usage.
    - If they are not, the missing output is priced from the final usage. The session is accepted as measured only if
      that lands within 10% of the CLI figure (`outputFromFinal`).
    - Otherwise it is booked **meterUnverified**, at the CLI-reported figure. The re-price stays in `usdRepriced`, and the
      shortfall goes into `usdImputed` and is also recorded as `usdMeterGap`.
  - *Utility* for a meterUnverified session uses the **reported** figure (re-priced plus the gap), never the re-price
    alone.
  - *The 30%-imputed rule does not count the gap.* The gap is the CLI's observed figure, not a bound charged for an
    unobserved cost, so `metrics.mjs` reads `usdMeterGap` as observed dollars. Gap dollars are counted and printed per cell.
    A sensitivity marked "not primary" applies the 30% rule with the gap counted as imputed. Without this rule, an Opus
    session's gap (53% to 66% of its figure at D6's ratios of 2.11 and 2.96) would leave agent-O cells unlabelled across
    the board.
  - *The cache-write rate billed.* The table prices cache writes at the 5-minute rate (1.25 × input). The CLI bills the
    rate the launch environment sets. D6 found the cache writes it could check billed at the 1-hour rate (2 × input). The 4
    Opus builder sessions reproduce the CLI figure exactly at that rate. Its launch-environment check (`analysis/m0/
    launch-env.json`, from a WIP autosave, not reviewed) found 1-hour writes in all 336 post-flag CLI transcripts that
    had cache writes, and found that no command in DESIGN §7 sets the switch.
    - The paid launch shape (§12) therefore sets `FORCE_PROMPT_CACHING_5M=1`.
    - The meter-verification record that clears the gate (`meter-gate-cli.mjs --verify`) must come from at least 2
      transcripts of that launch shape. It reports `cacheWrite1hShare`.
    - If those transcripts still show 1-hour writes, the table gains the 1-hour rate by a §13 deviation before the stage
      starts. Otherwise most agent sessions would miss the 10% band and be booked meterUnverified (D6: a 5-minute
      re-price lands at a median 0.83 to 0.85 of the CLI figure).
  - *The waiver.* The gate fails closed. A paid agent stage launched under the owner's meter-gate waiver
    (`analysis/m0/meter-gate-waiver.json`, recorded in the run's `report.deviations`) is a §13 deviation, recorded before
    any of its labels is used.
- **Price table** (USD per million tokens) [P, sources in `stages.json`]:

  | Model | Tier (prompt tokens = input + cache read + cache write) | Input | Output | Cache read | Cache write (5 min) |
  |---|---|---|---|---|---|
  | claude-haiku-5-5 | ≤ 100K | 0.10 | 0.50 | 0.01 | 0.125 |
  | claude-haiku-5-5 | > 100K | 0.50 | 2.50 | 0.05 | 0.625 |
  | claude-opus-5-5 | all | 4.00 | 20.00 | 0.20 | 5.00 |
  | claude-sonnet-5-5 (reference judges only) | all | 2.00 | 10.00 | 0.20 | 2.50 |

  Base input and output equal `policy/models.json` (checked). The Haiku cache-read rate is the generic 0.1× multiplier;
  no Haiku-5.5-specific figure was found, so D6 (cost-meter delta on archived agent rows) reports how far the re-priced
  figure sits from the CLI's own.
- **VBS\* (no optimistic bias)** [D]: select each task's mode on replicate 1 and score it on replicate 2; for construct-H
  select on two lineages and score on the third, rotating. Task halves are fixed by seed parity. Where a mode has only one
  replicate on a task, it is selected on that replicate and scored by its mean on the other parity half of the job [P].
  Two-direction averaging is a sensitivity. VBS\* ≤ VBS is a unit test.
- **Acceptable set:** δ = 0.03 (`FLOOR_POINTS = 3`); A = {m : u_m ≥ u_max − δ}; ties go to the cheaper mode (lower
  c + B/N). [D]
- **NEED label:** `workflow` or `no-workflow` only when every member of A is in one class; otherwise `either`. Labels are
  computed per (V, N, W) cell; the binary label at N = 1 feeds C7a, at N = 10 the secondaries. [D]
- **Confidence:** per job, a bootstrap over its tasks, then over replicates or lineages (2,000 reps, seed 20261014; the
  modes share each task draw). It has no cluster level: one job's P(best class) has a single cluster, so the first
  draft's "cluster → task → replicate" was degenerate. This is what `metrics.mjs needLabels` computes. A label is
  confident when P(best class) ≥ 0.8. Need accuracy uses confident labels only, with **coverage** printed beside it;
  utility statistics use every cell. More than 50% of held-out jobs `either` or unconfident → "the benchmark cannot
  separate routers". [D, seed P]
- **Missing data** [P]. A job missing any primary mode of its menu, for any reason, leaves Δ and C7a and is counted.
  - The menu is the L_today modes minus the masked ones (direct-H on interactive families).
  - Missing means: a mode with no row on some evaluation task, or without its first-pass replicates or lineages.
  - Reasons include: a stage stopped at its cap (K5), an arm invalidated by K4, a run condition not met.
  - **A voided lineage or draw is not missing** [P, D9]. It scores as a failure on every task in the primary analysis
    (`metrics.mjs needTable` with `voidPolicy: 'fail'`, the default; `stages.json analysis.voidPolicy`). This holds even
    when every lineage of a mode is voided, so the job stays in Δ and C7a. The voids are listed. Dropping voided
    lineages (`voidPolicy: 'drop'`) is a sensitivity marked "not primary". The first draft listed "every lineage voided"
    as a missing-data reason. That would have removed from Δ exactly the jobs where the builder cheated, the cases where
    construct-H is bad.
  - Dropped jobs are printed on a "dropped" line with the missing modes. Their rows are kept and reported. If a whole
    cluster drops, the cluster count and the floor (§7) are recomputed.
  - A sensitivity printed as "not primary" keeps those jobs, with the missing mode removed from both menus.
  - A conditional TRAIN job that does not run (`codefix-notests`, if its generator is not admitted) leaves TRAIN, which
    becomes 14 jobs in 4 clusters. TRAIN counts, the θ minimum (§6), G1 and the power gate are then computed on what ran.
    This is a preregistered outcome, not a deviation. Code: `prereg-rules.mjs missingDataRule`.
- **Fragility** ($0) [D; values read from each bed today, M]: labels are recomputed with each numeric tolerance halved
  and doubled (for a "≥ t" threshold the allowed error 1 − t is halved and doubled; count allowances are halved rounding
  down and doubled). Jobs whose label flips are "fragile": excluded from need accuracy, kept in utility, counted.

  | Family | Pass rule (source) | Halved | Doubled |
  |---|---|---|---|
  | records | field accuracy ≥ 0.97, pair F1 ≥ 0.95, entity slack 2% (`beds/records/score.mjs:82`) | 0.985, 0.975, 1% | 0.94, 0.90, 4% |
  | kinetics | relative error ≤ 0.10 on Vmax and Km (`beds/kinetics/world.mjs:13`) | 0.05 | 0.20 |
  | incident | onset within 60 s, impacted-services Jaccard ≥ 0.8 (`beds/incident/index.mjs:28-29`) | 30 s, 0.9 | 120 s, 0.6 |
  | synth | value within 1% of truth per cell (`beds/synth/index.mjs:279`) | 0.5% | 2% |
  | wbed-r3p | recall ≥ 0.80 and (fp ≤ 1 or precision ≥ 0.90) (`beds/wbed/r3p/score.mjs:9-10`) | 0.90, fp ≤ 0 or 0.95 | 0.60, fp ≤ 2 or 0.80 |
  | gameqa | recall ≥ 0.8, false reports ≤ 1 (`beds/gameqa/index.mjs:138`) | 0.9, 0 | 0.6, 2 |
  | all other families | exact match, test pass or rule satisfaction: no numeric tolerance; fragility does not apply | – | – |
- **Descriptive label:** the break-even V\*(job, N) at which the best mode changes class. [D]
- **Label sets:** L_today (workflow modes construct-H and agent-H+proc) is primary and trains the router; L_ceiling also
  admits build-O, ref-R1 and ref-R3. A "workflow" route that only L_ceiling supports is a builder gap, not a routing
  error. [D]
- **Self-test** [D]: per construct-H and agent-H+proc lineage, false-pass P(self pass | oracle fail) and false-fail
  P(self fail | oracle pass) among delivered answers, with Clopper–Pearson intervals; `runSolverCalls`, build minutes and
  dollars. For agent-H+proc the self-verdict is the agent's `checks.json` (all checks true = pass).
- **Validity gates** (each blocks claims until fixed) [D]: direct-H on `wbed-r0` passes ≥ 10/12 (M1 per effort, NL0 per
  draw) [per-draw P]; an arm with more than 25% environment faults is invalid (`ENV_FAULT_LIMIT`); `taskHash` pairing is
  asserted across modes; example and evaluation tasks are disjoint by hash; `hiddenPathAttempts > 0` or
  `nestedModelAttempts > 0` voids a lineage automatically; ownerci construct-H solvers are scanned for module text copied
  from the examples (AUDIT F10), a hit voids the lineage.
- **LEGACY:** archived P1, C0, JIT and Stage B rows are tagged LEGACY and never pooled with new labels. [D]

## 6. The router as a frozen artefact (addendum at Freeze)

| Item | Value |
|---|---|
| Feature whitelist | `logInputTokens, logSchemaLeaves, itemLists, maxListLength, freeText, multiSource, conventionsInProse, verifiable`, median over example set 1 at the job's per-seed difficulties; for N = 1 owner tasks, the task itself. The four prose-count keys stay inputs to the keyword baseline only. [D] |
| Banned inputs | family id, bed version, `kind`, oracle, reference, label or result files (L5) [D] |
| Guard | typed requirements → workflow class, flagged "engine support missing" when `state`, `wait.signal`, human-task or compensation constructs are absent; `REQUIREMENT_LIBRARY` and `shapeOf` word cues only raise "ask the user"; guard recall under 0.9 in D5 → the guard asks instead of inferring [D] |
| θ_tok, θ_fan | **TBD-FREEZE**, fitted on the confident N = 1 TRAIN labels to maximise balanced accuracy [D]. The fitting rules are [P] and are spelled out below the table. |
| Leaf modes per (V, N, W) cell | **TBD-FREEZE**: best mean TRAIN utility within each leaf [D] |
| NR-probe | `voi.mjs bestProbe`; probeable {direct-H, agent-H}; kMax 2 (two direct-H draws, one agent-H run); the probe task (seed 601 at the band's median level, §3.3); Beta(1 + s, 1 + n − s) priors from TRAIN jobs in the leaf; deployable signals only (schema validity, agreement of the two direct-H answers, agent-H turns and cost, family-handed tests), never the oracle; probe iff net EVSI > 0, its cost charged as r; mapping from deployable pass to success **TBD-FREEZE** [D] |
| NR-knn (secondary) | k ∈ {3, 5} by LOCO on TRAIN, **TBD-FREEZE**; demoted to the family-majority baseline if L8 trips [D]. Whether Jev property features enter it is decided at Freeze from J-NEED-2 **recomputed without `wbed-r3p`**: no r3p fold, and r3p's 24 tasks and their one-call outcomes in no training fold (leave-one-family-out over the 7 TRAIN-side W rungs). J-NEED-2's published numbers include r3p, whose one-call outcomes are part of its held-out direct-H label, and are never read for this decision [P, D9; `stages.json analysis.jevFeatureDecision`, checked] |
| judge-H (secondary) | settings §4.1; prompt text pinned in the label-engine stamp (§4.4) [P] |
| Shas | the analysis stamp A-Freeze (§4.4: `features.mjs`, `router.mjs`, `voi.mjs`, `metrics.mjs`, `evaluate.mjs`, `card.mjs`, `prereg-rules.mjs`) and the price table: **TBD-FREEZE** [D]. The addendum fills the §4.4 A-Freeze row with one "`<file>` `<sha256>`" pair per file, the form `prereg-check.mjs aFreezeShas` reads [P, D9] |
| Envelope | `evaluate.mjs --commit-decisions` writes every held-out decision card (`need-decision/1`); its hash is committed before the held-out matrix is joined (L6) [D]. The probe and judge-H rows that feed those cards run in their own envelope stage (NL2p, NL2bp), and the matrix stage (NL2, NL2b, E2E) is gated on the committed envelope (§12) [P]. Each envelope is written to its stage's `envelopeFile` (`research/need-router-20261014/envelopes/<stage>.json`) and sealed router shas for all seven A-Freeze files (`evaluate.mjs ROUTER_FILES`) [P, D9] |

**Fitting θ** [P; `prereg-rules.mjs thetaFitStatus, locoFolds, fitOrRule`; the review found the first draft's rule
degenerate under the §1.1 hypotheses]:
- **Minimum.** θ is fitted only with at least 2 confident N = 1 positives (workflow) from at least 2 TRAIN clusters and at
  least 2 confident negatives from at least 2 clusters.
- **Below the minimum, H0 is "not fitted".** C7a reads INCONCLUSIVE (not fitted). NR-static, and the tuned size rule,
  which uses the same fitting rules, have a single leaf whose mode is SBS-train's. NR-static's Δ is then 0 on every
  non-forced job, and its C7b reading is INCONCLUSIVE. NR-probe still runs on that single leaf.
- **This outcome is expected** under §1.1: the only hypothesised TRAIN positive is `wbed-r3-hi`, in W.
- **Candidates.** For each key, the candidate thresholds are the midpoints between adjacent distinct values among the
  confident TRAIN jobs, plus +∞ (the key unused). The pair with the highest balanced accuracy wins. Ties go to the larger
  thresholds, key by key (θ_tok first).
- **Midpoints, not edges.** A fitted θ therefore always sits between a confident negative and a confident positive, never
  at a job's own value. The first draft's "ties → larger θ" could put θ_fan at `wbed-r3-hi`'s own median (2.98). The
  midpoint rule puts it at 2.625, halfway to `wbed-r1-hi`'s 2.27.
- **Leave-one-cluster-out folds.** A fold whose training part has no confident positive or no confident negative is
  **undefined**: balanced accuracy is undefined there. It is excluded from every LOCO statistic (C7a dev numbers, σ for
  the power gate, NR-static's LOCO Δ) and counted in the report. It is never given θ = +∞. With every TRAIN positive in W,
  the W-held-out fold is undefined.

## 7. Metrics

**Headline cell:** V = $1, W = V, N = 10, L_today, non-forced held-out jobs. Results are never pooled across V. [D]

**Primary for C7b:** Δ = the mean over held-out clusters, each weighted 1, of (u_policy − u_SBS-train), in
success-equivalents per task, where SBS-train is the single best fixed mode on TRAIN jobs for that cell; computed for
NR-static and NR-probe. A policy's utility on a job is the utility of the mode its pinned decision chose (plus r/(N·V) for
NR-probe); a cluster's value is the mean over its jobs. [D] Jobs missing a primary mode are dropped and counted (§5).
**Masked modes** [P]: on a job whose menu lacks a mode (direct-H on interactive families), SBS-train and every router take
the next mode of their own TRAIN ranking for that cell (SBS-train: its ranking over all TRAIN jobs; a router: its leaf's
ranking). This is what `evaluate.mjs` does (rank fallback). Every fallback decision is counted and printed per policy.

**Inference** [D]: an exact one-sided sign-flip permutation test over the cluster-level Δ values (all 2^n patterns for
n ≤ 20 clusters; Monte Carlo with 100,000 patterns, seed 20261020, above that). Holm over the two co-primaries at
one-sided α = 0.05: the policy with the smaller p is tested at 0.025, the other at 0.05 if the first is rejected. Bounds
by test inversion at the same level: the lower bound is the smallest δ₀ for which H: Δ ≤ δ₀ is not rejected, the upper
bound the largest δ₀ for which H: Δ ≥ δ₀ is not rejected (shifted values d_c − δ₀, sign flips) [P wording]. The seeded
cluster bootstrap (10,000 reps, seed 20261015) is a sensitivity.

**Floors** [P, corrected]. The first draft gave the smallest p as 2^−n for n clusters, which assumes every Δ_c differs
from 0. That assumption fails in a common case: where the policy's pinned mode equals SBS-train's on every job of a
cluster, Δ_c is exactly 0, because both sides read the same matrix rows. A sign flip of 0 changes nothing, so
**p ≥ 2^−(n − z)**, where z is the number of zero clusters.
- The leaf calculator picks one mode per leaf, so every non-intrinsic job gets SBS's mode whenever that leaf's mode equals
  SBS-train's. Zero clusters will therefore be common.
- Example (`metrics.mjs signFlipTest`): Δ = (0.1, 0.1, 0.1, 0.1, 0, 0, 0) gives p = 8/128 = 0.0625 and a lower bound of 0.
  SUPPORTED is impossible, even though all 4 informative clusters show +0.10.
- The floor is therefore 2^−(informative clusters), where an informative cluster is one with Δ_c ≠ 0 (the policy chose
  differently from SBS-train on some job of it). That count and the floor are **printed with every reading**
  (`prereg-rules.mjs signFlipFloor`).
- Holm's first step (0.025) needs at least 6 informative clusters; its second step (0.05) needs at least 5. With 5
  informative clusters or fewer, the first-step policy cannot be SUPPORTED.

**Levels of every interval** [P]:
- **SUPPORTED:** Δ bounds one-sided at the policy's Holm level (0.025, then 0.05).
- **Paired comparisons** with the tuned size rule and judge-H: one-sided 95% each, conjunctive, no further correction.
- **REFUTED:** a one-sided 95% upper bound at each V. It is an intersection–union rule (all three V must hold), so it
  needs no correction.
- **HARMFUL:** Holm over the 6 tests of H: Δ ≥ 0 (3 V × 2 co-primaries) at familywise 0.05 (§8).
- **C7a:** two-sided 95% (0.025 per side).
- **G1:** exact one-sided 95% per cell (§8).

**Primary for C7a:** balanced accuracy of H0's need call against confident N = 1 labels on held-out non-forced jobs [D].
Coverage is printed. It is compared with the majority class (balanced accuracy 0.5) and the tuned size rule. If the
confident labels hold one class only, balanced accuracy is undefined and C7a reads INCONCLUSIVE. [D]

- **One joint interval** [P, replaces the first draft's mean of two Wilson bounds].
  - Method: a two-sided 95% exact interval for BA = (TPR + TNR)/2. The lower bound inverts the exact unconditional
    one-sided test of H: BA ≤ b (0.025), taking the sup of the tail over every (TPR, TNR) whose mean is b; the upper
    bound mirrors it (`prereg-rules.mjs balancedAccuracyInterval`).
  - Each confident job is one Bernoulli trial of its class. Jobs are treated as independent [assumption; jobs of one
    cluster share a family].
  - Coverage is at least 95% by construction. The mean of two marginal lower bounds has no such guarantee.
- **Power precondition** [P; revised in D9; `prereg-rules.mjs c7aPower`]. Before C7a is read, compute the **chance that
  the exact interval excludes a null classifier**: pExclude = P(lower bound > 0.5) for a classifier with TPR = TNR = 0.9
  (`C7A_POWER_ALT`), at the realised confident class counts, by exact enumeration. C7a is powered when pExclude ≥ 0.8
  (`C7A_POWER_MIN`). Unpowered, C7a reads **INCONCLUSIVE (not powered)**. No decisive reading is read, F12 included.
  - 0.9 is the alternative because D1 found a one-threshold size rule reproducing the hypotheses table at a balanced
    accuracy of 0.947 (`analysis/m0/REPORT.md` D1): a structural rule worth having is about that good.
  - The first draft's precondition was the bound a *perfect* classifier would reach. That is a best case, not a chance. At
    2 positives and 8 negatives a perfect H0 reaches 0.570, so the counts passed. But a single error on a positive gives
    [0.320, 0.994] (point 0.75), and the first draft then read REFUTED for a good classifier. Under the chance-based
    precondition those counts are not powered (pExclude 0.659).
  - The perfect classifier's bound is still printed. So is pRefuteAtChance, the probability that a coin-flip classifier
    (TPR = TNR = 0.5) reads REFUTED.
  - Planned counts (pExclude): 1 + 7: 0.000; 2 + 8: 0.659; 4 + 6: 0.736; 4 + 8: 0.757; 4 + 12: 0.845; 6 + 10: 0.953;
    10 + 10: 0.989.
- **Minimum confident counts** for C7a to be powered (positives + negatives; symmetric; `c7aMinimumCounts`): 4 + 9,
  5 + 7, 6 + 6, 7 + 5, 9 + 4. With 3 or fewer confident jobs of a class, C7a is not powered at up to 24 of the other. In
  practice that means at least 4 confident jobs in each class and 12 in all.

**Secondaries, fixed order, all marked "not primary"** [D]:
1. The same Δ at V = $0.10 and $10; at W = 0 and 10V; at N = 1 and 100; on L_ceiling. (The r3p-dropped reading and the
   reading with r3p's observed levels dropped (d3 and d5) are no longer secondaries: they are printed beside every C7a
   and C7b reading, and the first one decides whether a claim stands, §8.)
2. Value decomposition: always-agent-H → SBS-global → SBS(V, N) → router → VBS\*.
3. Closed gap and regret against VBS\*.
4. C7a at N = 10; precision and recall of the workflow class; precision at assumed no-workflow base rates of 50, 80 and
   95%.
5. Mode accuracy within the acceptable set; the three-way class split.
6. Slider calibration at N = 10: predicted against realised success (±0.10) and $ per task (±30%) per position (Frugal
   $0.10, Balanced $1, Careful $10).
7. Routing cost as a share of task cost (the 2% figure is reported, not a gate).
8. NR-knn, judge-H, NR-probe-oracle (a one-example acceptance check, allowed by decision 9 but never primary in v1),
   checkpoint re-route after task 4, online block-pinned replay (100 task orders, seed 20261019, stream lengths 1, 10, 100):
   Holm within this family.
9. Self-test false-pass and false-fail rates per arm and lineage.
10. Co-failure of direct-H and construct-H against independence (portfolio-by-disagreement).
11. E2E: realised against predicted success and $; override count and direction.

## 8. Decision rules

**Gate G1 (TRAIN, after NL1)** [D]: cross-fitted VBS\* − SBS headroom per (V, N) cell at W = V (9 cells).
- REFUTED-PREMISE: the upper bound is below 0.03 and below 20% of the SBS's per-task cost in success-equivalents
  (c_SBS/V), in every cell. Then stop paid labelling and ship the fixed policy, the guards and a V-threshold ladder (the
  calculator).
- CONTINUE: the lower bound is above 0 in some cell at V = $1.
- OWNER-DECIDES: anything else.

This replaces ROADMAP:632–634 (decision 1). [A]

**Which bound G1 reads** [P, corrected; `prereg-rules.mjs g1Reading`]. The first draft read both bounds from a
hierarchical cluster bootstrap over the 4 TRAIN clusters. That bootstrap has only C(7, 4) = 35 distinct cluster
multisets, and with this few clusters a percentile interval undercovers (§7 says so itself). An interval that is too
narrow makes a false REFUTED-PREMISE, and so a false stop (K1), more likely. Now:
- **REFUTED-PREMISE** reads the exact one-sided 95% cluster-level sign-flip upper bound in each cell. That bound is
  finite only with at least 5 TRAIN clusters: with 4, the smallest p is 1/16 > 0.05. **With 4 TRAIN clusters G1 can only
  read CONTINUE or OWNER-DECIDES**; it cannot stop the program on its own.
- **CONTINUE** reads a lower bound above 0 at V = $1: the exact cluster-level one, or a job-level bootstrap (jobs pooled,
  task → replicate or lineage; 2,000 reps, seed 20261021) printed as **diagnostic**. The asymmetry is deliberate. A false
  CONTINUE costs at most the next gated stage, which still needs the owner's gate. A false REFUTED-PREMISE ends paid
  labelling, with no reruns.
- Until `evaluate.mjs gateG1` adds the diagnostic CONTINUE path, it reads OWNER-DECIDES at 4 clusters, which is the
  conservative direction (§14).

**Readings for C7b, per co-primary policy** [D, A decision 1]:

| Reading | Condition |
|---|---|
| SUPPORTED | lower bound of Δ > 0 (one-sided, at the policy's Holm level); point ≥ 0.03; beats the tuned size rule and judge-H (paired cluster-level difference, the same sign-flip inversion, one-sided 95%, lower bound > 0; conjunctive conditions, no further correction); slider calibrated (at most 1 of 3 positions misses; realised success and $ per task non-decreasing in V); the same reading with r3p dropped (below). "Useful size shown" only if the lower bound ≥ 0.03. |
| SUPERIOR, BELOW USEFUL EFFECT | lower bound > 0 (Holm level); point < 0.03; the same reading with r3p dropped |
| REFUTED | one-sided 95% upper bound < 0.03 at each of the three V (intersection–union, no correction), or G1 refuted; the same reading with r3p dropped |
| HARMFUL | at a V, the exact one-sided p of H: Δ ≥ 0 is ≤ 0.05 after Holm over the 6 (policy, V) tests (3 V × 2 co-primaries); that policy's slider position is disabled. A safety rule: it stands on the full set |
| INCONCLUSIVE | anything else; the owner decides, with the achieved power printed (the informative-cluster count and the floor, §7) |

**r3p must not carry a claim** [P; `prereg-rules.mjs withDropAgreement`]. `r3p` is near (same author and library as W)
and dev-observed (M1, Jev-need).
- Every C7a and C7b reading is printed twice, with and without the `r3p` cluster.
- SUPPORTED, SUPERIOR-BELOW-USEFUL, REFUTED, and C7a's SUPPORTED-DIAGNOSTIC and ABOVE-CHANCE-BELOW-USEFUL stand only when
  the reading without `r3p` is the same. Otherwise the reading is INCONCLUSIVE, with both printed.
- The reading with r3p's dev-observed levels dropped (d3 since M1, d5 since M1-d5; d4 remains) is printed beside them;
  it is not a gate.
- Dropping `r3p` removes one cluster, so the floor of §7 is recomputed for that reading.

**C7a reading** [D, A; power precondition, the upper-bound rule and the r3p rule P (revised in D9); `prereg-rules.mjs
c7aReading`]. The cases, in order:
1. **INCONCLUSIVE** when H0 is not fitted (§6), when the confident labels hold one class, or when the counts are not
   powered (§7: pExclude < 0.8). Neither decisive reading, and not F12, is evaluated in any of these cases.
2. Otherwise, when H0's exact balanced-accuracy **upper bound is below 0.7** (`C7A_USEFUL`, the smallest balanced accuracy
   called useful [P]), a useful accuracy is excluded:
   - **REFUTED** (F12) when the lower bound is ≤ 0.5;
   - **ABOVE-CHANCE-BELOW-USEFUL** when the lower bound exceeds 0.5. Need is detectable from structure, but not usefully.
   Either stands only when the reading without `r3p` is the same.
3. Otherwise **SUPPORTED-DIAGNOSTIC** when all of these hold: the lower bound exceeds 0.5 (the majority class); the point
   estimate exceeds the tuned size rule's; coverage is at least 50%; and the reading without `r3p` is the same.
4. Otherwise INCONCLUSIVE. In particular an interval with **lower bound ≤ 0.5 < 0.7 ≤ upper bound** holds both chance and a
   useful accuracy. It is uninformative and is never read as REFUTED. The first draft read REFUTED whenever the lower
   bound was ≤ 0.5, so tp 1, fn 1, tn 8, fp 0 (point 0.75, interval [0.320, 0.994]) refuted a good classifier. That case
   is now unpowered, and powered or not it would read INCONCLUSIVE.

Claim grade needs at least 10 held-out clusters including the owner-task set, with at least 50% confident labels
(decision 16).

**C7b claim grade** needs ≥ 30 held-out families (decision 16, lane 05); v1 reads C7b at diagnostic grade only. Until the
owner tasks arrive, no reading goes above diagnostic (decision 10). [A]

**Partial readings** [D; the C7a one revised in D9]: NR-static fails but NR-probe SUPPORTED → "need cannot be read from
the spec; a one-example probe is required". C7a reads REFUTED (powered, and the interval excludes every useful balanced
accuracy) → "the router cannot detect need from structure". An interval that only covers the majority-class baseline
(lower bound ≤ 0.5 < 0.7 ≤ upper) supports no partial reading.
C7a holds, C7b does not → "need is detectable, but routing on it does not pay at these values; ship the rule as advice
plus the calculator". More than 50% of held-out jobs unconfident → "the benchmark cannot separate routers".

**Which reading is primary** [P]: the C7b reading over all admitted non-forced held-out clusters once NL2 and, if it runs
by 2026-11-04, NL2b are complete. The NL2-only reading (about 10-29) is printed as "interim" and never upgraded by a later
look. NL3 (sealed families and owner tasks) gives a separate sealed reading; the pooled reading (held-out plus sealed) is a
secondary. C7a pools held-out and sealed clusters, because its claim threshold counts the owner-task set.

**Expectation, stated in advance** [D]: with 5–8 held-out clusters, only a refutation or a large effect (about 0.15
success-equivalents per task) is likely to be detected; a good but moderate router will probably read SUPERIOR-BELOW-USEFUL
or INCONCLUSIVE. The firm outputs are the label matrix, the self-test measurements, C7a at diagnostic grade, and the
calculator.

Two more expectations follow from M1 and the corrected rules [P]:
- **C7a.** C7a is expected to read INCONCLUSIVE until more positives arrive. The held-out set has no hypothesised
  N = 1 positive: `r3p`, the only one in the first draft, was revised to either after M1 and to no-workflow after M1-d5
  (§1.1). `far-1`, `far-2`, `gameqa` and the owner tasks are pending. H0 is expected not to be fitted (§6).
- **C7b.** NR-static is expected to share SBS-train's mode on many jobs, so fewer clusters than admitted will be
  informative (§7).

## 9. Falsifiers (proposed for ROADMAP §4.3)

F1 G1 refuted (possible only with at least 5 TRAIN clusters, §8). F2 held-out Δ upper bound < 0.03 at every V. F3 no win over the tuned size rule or judge-H (ship the rule
instead). F4 the gain vanishes once guard-forced jobs are excluded (it belongs to the guards). F5 padding, keyword, gadget
or paraphrase metamorphs flip more than 20% of routes where the labels do not flip. F6 any leak test L1–L8 fails (the
evaluator is invalid; every claim is blocked). F7 the slider is uncalibrated or not monotone. F8 in a mixed-stream
replay, no slider setting dominates both always-no-workflow and always-construct. F9 on owner tasks, regret is worse than
SBS (upper bound < 0). F10 the gain appears on near held-out families (r3p) but not far ones (the claim is limited to
near families). F11 a build path's self-check false-pass rate > 0.2 with ≥ 10 oracle failures (that path is not
deployable, whatever the router says). F12 at N = 1, H0's held-out balanced accuracy is shown not to be useful: its
exact joint interval's upper bound is below 0.7 and its lower bound is ≤ 0.5 [P, D9]. It is read only when the power
precondition holds (§7: pExclude ≥ 0.8) and H0 was fitted (§6); otherwise F12 is not evaluated and C7a reads
INCONCLUSIVE. DESIGN §5 words F12 as "lower bound ≤ 0.5". That reading turns an uninformative interval into a refutation
(§8, §14), so this file departs from it.

## 10. Controls, baselines, leak tests, attacks

**Baselines** (from the matrix at $0, except judge-H) [D]: each fixed mode and cascade; SBS-train per cell and
SBS-global; SBS chosen on the test set (optimistic reference only); random routing at the router's mode mix (1,000 draws,
seed 20261016); the fixed size rule (under 2K tokens direct-H, 2–30K agent-H, over 30K construct-H); the tuned size rule
(one token threshold fitted by LOCO on TRAIN); `NONE_RULE` (`experiments/library/construct.mjs:58`); the keyword router
(`REQUIREMENT_LIBRARY` → construct-H, `src/construction-objective.mjs:21`); a `kind`-only router; family-majority by
nearest TRAIN cluster; judge-H; NR-probe-oracle.

**Leak tests** (`experiments/need-router/test/`; any failure trips F6 and K3) [D]:

| Test | Expectation |
|---|---|
| L1 label-peek router | closed gap ≥ 0.95 (positive control for the scorer) |
| L2 shuffled-label null (1,000 permutations, seed 20261017) | centred at or below 0; the real router must exceed its 95th percentile |
| L3 family-identity router under leave-one-cluster-out | closed gap ≤ 0 |
| L4 seed and `taskHash` disjointness | `assertSeedsAllowed` called by label-run for every task; example and evaluation hashes disjoint (pre-checked today, §3.3) |
| L5 feature purity | import-graph test: `features.mjs`, `router.mjs`, `voi.mjs` never import a bed `score`, `oracle` or `referenceSolve`, or any result file; whitelist assertion |
| L6 sealed envelope | `evaluate.mjs --commit-decisions` writes held-out decisions; their hash is committed before the held-out matrix is joined |
| L7 build isolation | `scoreChecks:0`; builders and procedure writers never see held-out seeds or answers |
| L8 nearest-cluster test | share of NR-knn's k neighbours from one TRAIN cluster per held-out job; ≥ 80% of jobs single-cluster → NR-knn is the family-majority baseline under another name |

**Metamorphic attacks** ($0 at the decision level) [D]: `wbed-r0` against `r0-pad` must route the same (seed by seed: both
use the same R0 task); `r3-mini` against wbed-r3 d5 must route differently; held-out examples padded with up to 20K
tokens of irrelevant documents; keyword and gadget injection ("this is simple", "build a workflow", "pipeline"); spec
paraphrase; N off by 10× (regret reported); monotonicity (once a workflow is chosen at N, it stays chosen at every larger
N). F5 reads them.

**False-confidence guards** (DESIGN §6 table, adopted whole) [D]: cross-fitted VBS\*; SBS on TRAIN only; clusters by
import graph with r3p dropped in a mandatory sensitivity that a claim must survive; utility primary and coverage beside accuracy; drop-one-cluster influence on
the lower bound printed; L_today against L_ceiling; W = V headline with q charged and self-checks measured; one re-priced
meter; timeouts at the bound and > 30%-imputed cells unlabelled; fragility recompute; bands frozen here; prose features
removed, r0-pad and r3-mini in TRAIN, tuned size rule, L8; paraphrase-pool sharing stated as an unknown; N = 10 headline;
fresh 6xx and 88xx seeds only; later additions form a separate stratum; the oracle is never a runtime verifier; families
audited before their labels are viewed; owner tasks and far families flagged; precision at assumed base rates; pinned
model ids and the monthly drift re-check (stage DRIFT); the live E2E lane.

## 11. Power

- **Exact floor.** One-sided sign-flip test: the smallest p is 2^−m, where m is the number of **informative** clusters
  (Δ_c ≠ 0, §7), not the number of clusters [D, corrected P]. Holm's first step needs p ≤ 0.025: m = 5 → 0.031 (cannot
  pass); m = 6 → 0.016; m = 7 → 0.0078; m = 8 → 0.0039. A cluster where the policy picks SBS-train's mode on every job
  adds nothing. The informative count and the floor are printed with every reading.
- **Interval width.** A t-type interval over 7 clusters has half-width about t(0.975, 6)·σ/√7 ≈ 0.93σ (σ = the
  between-cluster SD of Δ). A half-width of 0.03 needs σ ≤ 0.032; at σ = 0.10 only effects above about 0.09 are
  detectable [I, D].
- **Power gate (after NL1)** [D; agreement share P; `prereg-rules.mjs powerGate`]. Two quantities are estimated by
  leave-one-cluster-out on TRAIN, over defined folds only (§6):
  - σ, from NR-static's cluster-level Δ under LOCO;
  - the agreement share a, the fraction of TRAIN clusters where NR-static's LOCO choice equals SBS-train's on every job.

  At the planned held-out cluster count n, the gate reports three things: the expected number of informative clusters
  n·(1 − a); the floor 2^−floor(n·(1 − a)) that count allows; and the projected half-width. If that floor exceeds 0.025
  or the half-width exceeds 0.03, the program either adds clusters (far families, gameqa, owner tasks) or accepts an
  expected INCONCLUSIVE, recorded in §13 before NL2. Example: 8 clusters at a = 0.5 give 4 informative clusters, so the
  floor is 1/16 and NR-static cannot be SUPPORTED. **TBD-NL1.**
- **The gate is also computed without r3p** [P, D9; `powerGate` `nearClusters`, default 1]. SUPPORTED needs the same
  reading with r3p dropped (§8), and that reading has n − 1 clusters. So the gate computes the three quantities at n and
  at n − (number of near or dev-observed held-out clusters: 1, r3p). It passes only when both pass, and it names the set
  that binds.
  - Example: 8 clusters at a = 0.25. The full set gives 6 informative clusters, floor 1/64, which passes. Without r3p,
    7 × 0.75 = 5.25 gives 5 informative clusters, floor 1/32 > 0.025, so the reading is expected INCONCLUSIVE.
  - The first draft's gate would have approved NL2 (cap $266) in that configuration, although the first Holm step could
    not then be SUPPORTED.
- **Simulation (M0).** Synthetic matrices with planted optima at the planned sizes (15 TRAIN jobs in 4 clusters; 5, 7 and
  8 held-out clusters; 12 tasks; the §4.1 replicates), seed 20261018: false SUPPORTED ≤ 5% under the null; P(SUPPORTED) at
  planted Δ = 0.03, 0.08 and 0.15. The simulation must also **plant router = SBS agreement** at cluster shares a ∈ {0,
  0.3, 0.5, 0.7}, the clusters where the router copies SBS having Δ_c = 0 exactly. Continuous Δ alone overstates the
  power. **TBD-M0**: `evaluate.mjs` produces it, and freezing this file requires its numbers in this section.
- **C7a.** Under the chance-based precondition (§7) C7a needs at least 4 confident jobs per class and 12 in all. At the
  planned held-out counts it is not powered and reads INCONCLUSIVE: there has been no hypothesised positive since M1-d5,
  and there was one in the first draft.
  - With 2 positives and 8 negatives, a perfect H0 reaches a lower bound of 0.570. One error on a negative brings it to
    0.505, and one error on a positive to 0.320. A good classifier at those counts excludes 0.5 with probability 0.659.
  - Under the first draft's rules that single positive error read REFUTED. Under these rules the counts are not powered,
    and the interval [0.320, 0.994] would be uninformative even if they were.
  - C7a needs the owner tasks and the far families to reach a decisive reading. At this size it is diagnostic at best.

## 12. Stages, caps, kill and stop rules

Launch shape (coordinator) [D; `FORCE_PROMPT_CACHING_5M=1` added in D9 (§5 meter-gate rule: the table prices cache
writes at the 5-minute rate, and D6 found the launch environment otherwise bills the 1-hour rate)]:

```
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" LANG="$LANG" TERM="$TERM" FORCE_PROMPT_CACHING_5M=1 CLAUDE_CODE_OAUTH_TOKEN=... \
  node experiments/need-router/label-run.mjs --stage <ID> \
    --prereg research/need-router-20261014/PREREG-NEED-V1.md \
    --work-root /var/tmp/foundry-work/need/<id> \
    --out research/need-router-20261014/runs/<id> [--dry]
```

Agent concurrency at most 4. A stage stops at its cap and is analysed as it stands, with no reruns. Approved now: M1 and
NL0 (decision 14); later stages at their gates, each under the $500 pause. [A]

| Stage | When | Grade | What | Est. $ | Cap $ | Approved | Gate |
|---|---|---|---|---|---|---|---|
| M0 | 10-15 → 10-17 | development | code, this preregistration, tests, D0–D6 on LEGACY rows | 0 | 0 | yes | – |
| M1 | ran 10-14 → 10-15; closed | development | one Haiku call per W-rung task, two efforts, one approved $15 cap shared by tag. Tag `m1` (share $5, done): `m1-run.mjs --cap 15`, 8 rungs (wbed-r0 … r6, wbed-r3p) × 12 seeds × 2 efforts = 192 calls at d3, also the W-bed one-call admission gate. Tag `m1-d5` (share $10, done): `m1-run.mjs --rungs r2,r3,r3p,r6 --difficulty 5 --cap 10`, 96 calls at d5. Results in §0.1. On the meter: $62.92 (D3) | 10 | 15 | yes | ran without stamp S-M1 (D1); K2 passed |
| M1-R | ran 10-15, outside the totals below | development | re-ran M1's 54 `MODEL_TIMEOUT` trials at a 600 s wall (`m1-rerun.mjs`, tag `m1-r`); results in §0.1. Its budget is held by `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §5 row 4, whose totals add this program's. On the meter: $25.89 with its set-aside attempts (D7) | 15 | 25 | plan item (D7) | none: unregistered (D7) |
| M1e | when #58 commits | diagnostic | read the in-flight E8 runs (agent-H paired with B1L-H lineages 1–3, B1-H, B1-O; same 9 dev worlds) | 0 | 0 | yes | – |
| NL0 | 10-18/19 | development | `records-hi`, `wbed-r0`, `wbed-r3-hi` × five modes; build-O and (if stamped) ref-R3 on `wbed-r3-hi` (the owner tasks moved to NL0-owner, D9) | 110 | 140 | yes | freeze of this file; stamp L-NL0; K2 |
| NL0-owner | with NL0 if the owner's tasks have arrived, else when they arrive and before Freeze (later ones go to `owner-sealed`) | development | up to 5 owner tasks (`owner-dev`): every L_today mode once per task, i.e. one draw each of direct-H, agent-H and agent-O, and one lineage each of agent-H+proc and construct-H (K = 1, DESIGN's "one replicate"), whose procedure writer and builder read the task itself, never its acceptance check; no racing top-ups. $3 per task (§3.2), bound $19.50 per task | 15 | 40 | at gate | owner: the $40 is new money beside NL0's approved $140 (decision 14), so it needs the owner's gate; stamp L-NL0-owner |
| NL1 | 10-20 → 10-23 | development | the other 12 TRAIN jobs; build-O on `wbed-r1-hi` and `kinetics-hi`; ref-R1 if stamped; NR-probe rows on all 15 TRAIN jobs; then G1, the power gate, LOCO dev numbers | 272 | 340 | at gate | K7; owner; stamp L-NL1 compared with L-NL0 |
| judge-H | with NL1 | development | the "just ask a model" baseline on TRAIN: 3 draws × 3 V on each of the 15 TRAIN jobs (about 135 typed calls); its held-out calls run in NL2p | 3 | 6 | at gate | NL1 owner gate |
| Freeze | 10-24 | development | fit θ (§6 rules), leaf modes, k, probe mapping; hash the router (stamp A-Freeze); addendum | 0 | 0 | yes | K1 |
| NL2p | 10-25, before any NL2 matrix row | held-out | NR-probe rows and judge-H calls on the held-out jobs (probe task only, no evaluation seed); then `evaluate.mjs --commit-decisions` writes every held-out decision card and the envelope hash is committed (L6) | 4 | 8 | at gate | Freeze addendum; G1 not refuted (K1); owner |
| NL2 | 10-25 → 10-28 | held-out | `incident`, `synth-lo`, `synth-hi`, `ownerci`, `r3p`, `need-constraint`, `far-1`, `far-2` × five modes; build-O on `synth-hi` and `r3p`; no probe or judge rows | 204 | 266 | at gate | NL2p envelope committed with the A-Freeze router shas (checked at launch, below); owner |
| NL2bp | after the gameqa and runbook audits, before NL2b and before E2E if gameqa is eligible | held-out | NR-probe on `gameqa` (agent-H only) and the guard decision on `runbook`; commit their decision cards (L6) | 1 | 2 | at gate | independent audit and agent smoke per family; owner |
| E2E | 10-29 → 11-02 | held-out | 6 held-out non-forced jobs by the seeded draw (below); the committed decision card → owner override (48 h, logged) → build with self-check → 12 fresh tasks (8825–8836) → delivery gated by the deployable verifier; oracle scored offline | 60 | 80 | at gate | NL2 interim reading written; envelope NL2p, and NL2bp only when `gameqa` is in the drawn set (`conditionalEnvelopes`), both checked at launch |
| NL2b | 10-29 → 11-04 | held-out | `gameqa` (held-out) and `runbook` (forced stratum), four modes (direct-H masked) | 97 | 138 | at gate | NL2bp envelope committed with the A-Freeze router shas (checked at launch); audit and smoke |
| NL3 | owner tasks arrive (target 10-28) | sealed | `sealed-1` … `sealed-4` and `owner-sealed` (20–30 owner tasks), run once by a session that tuned nothing; it commits its own decisions before its matrix | 190 | 240 | at gate | – |
| **Total** | | | | **966** | **1,275** | | committed $1,322.92 (each stage at max(cap, recorded meter): M1 at $62.92); with DRIFT's $24 and M1-R's $25.89, $1,372.81 against the $1,500 session soft cap |
| DRIFT (recurring, outside the stage totals) | monthly after NL2, at most 3 runs | diagnostic | agent-H on `incident` and direct-H on `synth-lo`, seeds 8837–8848, one draw (the same 24 tasks each run); drift flagged when the Wilson intervals of the NL2 and the re-check pass rates do not overlap | 5 per run | 8 per run, 24 in all | at each run | owner |

Core (M1, NL0, NL1, judge-H, NL2p, NL2, E2E): est. $663, caps $855 [D]. In the 2026-10-14 revision the money moved
between stages but the totals did not change (D9 then added NL0-owner, below):
- The first draft's NL2 ($206 est. / $270 cap) and judge-H ($5 / $10) are now three stages: judge-H on TRAIN ($3 / $6);
  NL2p ($4 / $8, made of NL2's $2 / $4 of probe rows plus judge-H's $2 / $4 of held-out calls); and NL2 ($204 / $266).
- NL2b ($98 / $140) is now NL2bp ($1 / $2) plus NL2b ($97 / $138). NR-probe rows are charged to NL1 (TRAIN) and NL2p (held-out) [P].
DRIFT's jobs, its 3-run limit and its cumulative $24 cap are [P]. The checker adds the $24 to the soft-cap check.
M1-R is outside these totals because another plan holds its $25 cap (`externalBudget`). The checker requires that file to
name the stage.

**Committed spend, not caps** [P, D9; `prereg-check.mjs checkStages`, `stages.json totals`].
- *The defect.* The first soft-cap check summed the preregistered caps ($1,235 + DRIFT's $24 = $1,259). It counted M1 at
  its $15 cap, although M1 is $62.92 on the §12 meter, and M1-R's $25.89 sat outside every total. Spend already committed
  was $73.81 above what the check counted ($47.92 of M1's overrun plus M1-R's $25.89), and nothing refused as overruns
  accumulated.
- *Now.* Each stage counts at max(its cap, the sum of its recorded runs on the meter, set-aside attempts included):
  `totals.committedUsd`, $1,322.92 with NL0-owner. The soft-cap check adds DRIFT's cumulative cap and every
  externally budgeted stage at the same max (M1-R, $25.89): $1,372.81 against $1,500. A recorded run that pushes the sum
  over the soft cap is refused.
- *Across plans.* `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §5 states its own totals with this
  program's: about $1,260 estimated, and about $1,680 if every cap of both plans is hit, over the soft cap. Those figures
  use this program's earlier $1,235 at caps; D9's figures are higher. That plan names what to drop first. This file's
  check covers its own stages and the stage it shares (M1-R). The other plan's own items are outside it: the cross-plan
  total is that plan's to keep, and at caps it is already over the soft cap.
- *Owner tasks* left NL0 for their own stage, NL0-owner (est. $15, cap $40), which adds $15 and $40 to the totals:
  $966 estimated, $1,275 at caps. The core totals do not change.

**The split envelope stages** [P, review fix]. The first draft ran NR-probe rows and the five-mode matrix in one stage
(NL2, and likewise NL2b) and said decisions are "committed before the matrix is joined". Nothing made the commit come
before the evaluation runs, so oracle scores could exist, and be viewed, before NR-probe's held-out decisions were
committed. Now:
- NL2p and NL2bp run only probe-task rows, then commit every held-out decision card.
- NL2, NL2b and E2E name the envelope stages they need (`requiresEnvelope`), and their launch is gated on the committed
  hash.
- The checker refuses a held-out probe or judge row outside an envelope stage, and a matrix stage whose jobs no earlier
  envelope covers.

**L6 is a launch gate in code** [P, D9; `prereg-check.mjs envelopeLaunchCheck`, called by `label-run.mjs paidRunChecks`].
- *The defect.* `requiresEnvelope` had been only a static structural check. `paidRunChecks` never read an envelope, and
  `evaluate.mjs verifyEnvelope` ordered the envelope by its self-reported `createdAt`, skipping the order check when that
  was absent. It compared router shas with the current files, not with the A-Freeze stamp. A router edited after the
  held-out matrix was seen, then re-enveloped with an earlier `createdAt`, would have passed.
- *At launch,* a stage with `requiresEnvelope` is refused unless every envelope it needs passes four checks. Each is the
  `envelopeFile` of its envelope stage (`research/need-router-20261014/envelopes/NL2p.json`, `NL2bp.json`). The file:
  - is in a commit whose git commit time is earlier than the launch, and in no later commit (an envelope is never
    rewritten: a new one needs a new file and a §13 deviation);
  - equals its committed text, with a payload that matches its sha256;
  - seals router shas equal to the §4.4 A-Freeze row of the committed Freeze addendum, which must pin all seven analysis
    files;
  - holds a sealed decision for every launched job it decides.
- *E2E* needs NL2bp only when `gameqa` is in the drawn set (`stages.json E2E.conditionalEnvelopes`). The draw is
  `e2eDraw` over the eligible jobs that are admitted, meaning a bed and a frozen band. NL2 always needs NL2p, and NL2b
  always needs NL2bp.
- *The launch record.* `label-run.mjs` writes `LAUNCH.json` (launch time and the envelopes checked) beside `STAMP.json`
  before the first paid call.
- *At evaluation,* `evaluate.mjs --split heldout --decisions <envelope>` always supplies the envelope's provenance. Its
  git commit time is required and must precede the first held-out launch (`LAUNCH.json`). A missing time, a rewritten
  file, router shas other than A-Freeze's, or a held-out stage launched against another envelope fails L6 (F6, K3).
  `createdAt` is never used for the order.
- *Runners outside label-run.* `label-run.mjs` does not run the E2E lane (`router-choice`). Its runner must call
  `envelopeLaunchCheck` and write `LAUNCH.json` the same way (§14).

**The one cap meter** (K5) [P, review fix; `stages.json spendMeter`; `prereg-rules.mjs capMeter, mayStart`]. It applies
to every paid runner: `label-run.mjs`, `m1-run.mjs`, `m1-rerun.mjs`, judge-H, probes and DRIFT.
- **Meter.** Per stage, and per tag where a stage's cap is shared (M1), the meter is the sum of three parts:
  - every row with an observed cost, at max(reported, re-priced);
  - every row with no observed cost (a timeout or killed session, `costUnknown`, or no dollars and no tokens recorded),
    at its bound;
  - every start in flight, at its bound, **reserved before launch**.
- **Starts.** A start is refused when the meter plus its bound would exceed the cap.
- **Timeouts.** A timed-out call is never $0 on the meter, whatever the provider later bills.
- **Concurrency.** Up to 4 starts may be in flight; their reservations count.
- **Set-aside attempts** (2026-10-15). An attempt kept out of the results counts like a row: an invalid attempt, or an
  environment-fault row that is re-run later. It is charged at max(reported, re-priced) when its cost was observed, and
  at its bound when it was not. M1-R had 8 such attempts.
- **M1 under this meter.** M1's runner booked timeouts at $0 and reserved nothing (§13 D3):
  - tag `m1` is $28.9957 against its $5 share;
  - tag `m1-d5` is $33.9199 against its $10 share;
  - together $62.9156 against M1's $15 cap (reported $8.9156).
- **M1-R** used a copy of that runner. It is $17.8934 over its final rows and $25.8934 with its set-aside attempts,
  against its $25 plan cap (reported $7.8934; §13 D7).
- **Overshoot: the bound is not a hard ceiling** [P, D9; `stages.json spendMeter.overshoot`].
  - *Why.* Reservation treats each start's bound as its ceiling. But the CLI enforces `--max-budget-usd` only between
    turns (the flag: `src/executors/claude-code.mjs:304`), so an agent session or a construct build can end above its
    bound. The meter books max(reported, re-priced) after the fact.
  - *Worst case.* A stage can end above its cap by the overshoot of the starts in flight when the cap binds: at most 4
    starts, each by up to one model turn. This file pins no per-turn limit, so the overrun is measured, not bounded in
    advance.
  - *Measured at $0 on archived rows* (§13 D9). Of 273 JIT agent and interpreter sessions with a known budget, none
    reported above it. The largest is 1.00× (one `costUnknown` session booked at its bound), and the next largest 0.37×.
    The 8 C0 builds reached at most 0.28× of their $8 builder budget, with gateway overshoot $0. No archived session came
    near its budget with a reported cost, so overshoot at the budget is unmeasured.
  - *Reporting.* Every start's reserved bound and its charge are in the stage's spend ledger (`spend.jsonl`), so each
    overshoot can be recovered. A listing in the stage report is open (§14). The overshoot counts on the meter (K5) and
    in committed spend (above).
  - *Rule.* A stage whose total overshoot exceeds 10% of its cap is a §13 record before the next paid stage. That record
    raises the later stages' reservation bounds by the largest charge-to-bound ratio observed.

**E2E draw** [P]: the eligible set is the admitted held-out non-forced jobs at E2E launch, sorted by id, shuffled by a
seeded Fisher–Yates (mulberry32, seed 20261029; `prereg-check.mjs e2eDraw`), first 6 taken. Computed today for the
possible eligible sets: all nine → `ownerci, r3p, need-constraint, far-1, gameqa, synth-lo`; no gameqa →
`ownerci, synth-lo, far-1, r3p, incident, far-2`; no far families → `ownerci, r3p, incident, synth-lo, gameqa,
need-constraint`; neither → all six of `incident, synth-lo, synth-hi, ownerci, r3p, need-constraint`.

**Kill and stop rules** [D]:
- **K1** G1 refuted → stop paid labelling after NL1; report C7a on TRAIN as development evidence.
- **K2** direct-H on `wbed-r0` below 10/12 at either effort (M1) or in either draw (NL0) → stop; fix the anchor or the
  harness.
- **K3** any leak test fails → the evaluator is invalid; no claim until fixed and re-run at $0.
- **K4** an arm over 25% environment faults → that arm is invalid for the stage.
- **K5** a stage (or an M1 tag) reaches its cap on the one meter above → stop and analyse as it stands; no reruns. The
  owner tasks have their own stage (NL0-owner), so a cap stop there drops owner tasks only, never an NL0 row.
- **K6** any single experiment estimated over $500 → pause for the owner (`policy/models.json:21`).
- **K7** NL0 cost per job over 1.5× the estimate → re-plan before NL1. For owner tasks (NL0-owner), each task is read
  against `estPerTaskUsd` ($3):
  - a task charged over $4.50 on the meter is flagged in the report;
  - a stage mean over $4.50 per task re-plans the `owner-sealed` budget before NL3 [P, D9].
- **K8** every construct-H lineage fails on every NL0 job while build-O passes → continue, but no "no need" reading may
  be drawn from L_today alone.
- **K9** F11 trips on a build path → that path is scored with its self-check gate removed (every schema-valid answer
  delivered and charged as delivered) in all later utility [wording P].

## 13. Deviations

Any change after the freeze is recorded here with its date, reason and whether any label had been viewed. Jobs,
families or analyses added after freeze form a separate stratum and never enter the headline. Raw failures and negative
results are kept. An owner overturn of an adopted decision is applied before the next paid stage, never retroactively to
a frozen reading (DECISIONS-ADOPTED). [D, A]

After freeze: none yet.

**Recorded before freeze** (2026-10-14, this revision; no need-router label had been viewed, because none exists):
- **D1. M1 ran without its launch stamp.** S-M1 was "TBD at M1 launch" when M1 started at 21:31. A reconstructed record
  is in `stages.json` (M1 `observed.*.engine`): trees, file shas and the runner's sha per tag. It is not a launch stamp.
  Whether the working tree differed from e5defed (tag `m1`) or 56c0a82 (tag `m1-d5`) at launch is unknown.
- **D2. M1-d5 was an unregistered run.** It was launched at 23:00 with its own `--cap 10` counter, after the first draft
  and outside it. It is folded into M1's one approved $15 cap as tag `m1-d5` with a $10 share (tag `m1` $5). The tag is
  development evidence, and its results enter §0.1 when it ends. It changes no band; any hypothesis revision it informs
  is logged in §1.1. The M1 stage is closed when it ends: any further one-call run needs a new, approved stage.
  *Update 2026-10-15:* it ended at 00:02:45 (96 rows, committed in 5f75f17); its results are in §0.1, and it informed
  one hypothesis revision (`r3p`, §1.1). M1 is closed. M1-R ran after this (D7).
- **D3. M1's spend, re-metered.** Tag `m1` reported $2.9957, with 26 `MODEL_TIMEOUT` calls booked at $0 and nothing
  reserved for calls in flight (concurrency 4).
  - On the §12 meter, tag `m1` is $28.9957 against its $5 share and M1's $15 cap: an overrun of an approved cap, recorded
    here and not re-approved. The provider's billing for the 26 timed-out calls is unknown. The report cites both
    figures.
  - On this meter, M1 was over its cap before tag `m1-d5` started, so K5 would have stopped it. This revision does not
    stop a run in flight; the coordinator decides. Tag `m1-d5` is re-metered the same way when it ends.
    *Update 2026-10-15:* tag `m1-d5` reported $5.9199, with 28 `MODEL_TIMEOUT` calls booked at $0. On the §12 meter it
    is $33.9199 against its $10 share. M1 in all is $62.9156 against its $15 cap (reported $8.9156). Both are overruns of
    an approved cap, recorded here and not re-approved.
  - From the next paid stage on, every runner meters by §12. `m1-run.mjs`'s own counter does not meet §12, so it may not
    be used again as it stands.
- **D4. The first draft's --hashes pre-check generated held-out tasks before Freeze, outside the ledger.** That was 492
  tasks, including held-out evaluation tasks 8801–8812 and E2E tasks 8825–8836 for 6 jobs, generated in-process and
  hashed. No content was inspected, and no model saw them. The pre-check now checks every seed against the ledger and
  generates held-out families only in a child process that prints counts and task ids. It was re-run that way for this
  revision (512 tasks, 0 collisions, 0 refusals).
- **D5. Edits to the first draft.** This revision fixed blockers and major and minor defects that an adversarial review
  found. The changes are listed in §14, each marked [P]. The probe and judge-H task moved to the band's median level
  (§3.3). judge-H's tie rule changed to a fixed order, which changed its settings hash from `6504fc674944022d`. The
  stages were restructured: judge-H is now TRAIN-only; NL2p and NL2bp are new; DRIFT is recurring. No label existed when
  any of this changed.

**Recorded before freeze on 2026-10-15** (the M1 and M1-d5 labels had been viewed: §0.1 and `runs/jev-need`; no NL0
label exists):
- **D6. The P0 policy batch, landed before the NL0 stamp** (`research/architecture-20261014/MEMORY-ROUTING-RECURSION.md`
  §2 changes 1 and 6, §5 row 1). One deviation against M1's reconstructed stamp (D1). There `policy/models.json` is sha256
  `96d5586281a0e8e43c73db63118189aaf18e8da5a492bb0dddfd43ab676cb4cf` (version `2026-10-09.1`, policy hash `cfe79728…`);
  it is now sha256 `9a5a467a3782d98beaa50c4e869d566d6a2ee3cbb6dfd699128971902200f0bc` (version `2026-10-15.1`, policy
  hash `a52ac399…`). Tags `m1` and `m1-d5` ran under `2026-10-09.1`. M1-R (`m1-rerun.mjs`, launched 00:49 UTC on 10-15,
  before this change) loaded `2026-10-09.1` when it started and holds it in memory. NL0 and every later stage run under
  `2026-10-15.2` (below).
  - **Addendum, policy `2026-10-15.2` (same deviation, before the NL0 stamp).**
    - The change: `judgmentModels[1]` lists `jev-1.14.0` beside the pinned `jev-1.13.0`, so that the planned J0 re-read (design §5 row 3) can name it explicitly. The first entry stays the default pin, so nothing selects 1.14.0 unless a caller names it.
    - Nothing else changed.
    - The file is now sha256 `3364011cae3741fb4409386d16cfa2439aaa340181382ce1694a8f7778fd3793`, policy hash `3618a12c…`.
    - `tests/models-policy.test.mjs` now expects the two served ids, and every Jev id must be a served version, never an alias.
    - Tests: core suite 1,145 pass, 0 fail; heal 32 pass, 66 skipped (the recorded D6 skip; the gate does not block on `judgmentModels`). No other label-engine file or tree changed in this batch. The files and why:
  - `policy/models.json` (stamped):
    - `judgmentModels[0].id` is `jev-1.13.0`, was `jev-latest`. J1 and jev-need were served `jev-1.13.0`; the alias
      moves (`jev-1.14.0` shipped on 10-14 behind `jev-preview`), and `jev-latest` is now refused as an id.
    - `inputBudgetTokensByClass` M, L and F are 100,000, were 8,000, 16,000 and 32,000. S stays 4,000; XL (not in
      `classOrder`, read by nothing) is unchanged. The class-M budget reached `compileContext` (`src/runtime.mjs`) and
      refused or truncated any Haiku node over 8,000 tokens; the design cites M1's one-call Haiku successes at 45–64K
      tokens. 100,000 is the Haiku price-tier boundary in the policy's price source.
    - `defaultsByRole` is deleted. No code read it (the whole repository searched, except `beds/sealed/`, `corpus/` and
      `.foundry/`), and wiring a role-based automatic assignment is on the design's do-not-build list (§4).
    - `policyVersion` and a dated note. `src/models/policy.mjs validatePolicy` needed no change: it accepts any positive
      integer budget, and no rule names `defaultsByRole`.
  - `experiments/kev-data/score-served.mjs`: `JEV_MODEL` is `jev-1.13.0`. `--jev-model <id>` stays as the explicit
    override for a deliberate re-read; that id must be listed in the policy.
  - `experiments/need-router/jev-need.mjs`: requests `JEV_MODEL` (it had inherited `jev-latest`), with a new
    `--jev-model <id>` override.
  - `experiments/library/jev.mjs`: the request builders name `jev-1.13.0`.
  - Tests. `tests/runtime-agent.test.mjs` (new): a Haiku `agent` node with a 60K-token input succeeds under the
    committed policy, with one call, the whole input in the prompt and `truncated: false`, under both `onOverflow`
    values; the same node at 8,000 is refused with `CONTEXT_OVERFLOW`. `tests/models-policy.test.mjs`: Jev by the pinned
    id, the alias refused, the class budgets, no `defaultsByRole`. `experiments/kev-data/test/served-scorer-jobs.test.mjs`
    and `experiments/library/test/jev.test.mjs`: the pinned id in the config, request bodies and rows.
    `experiments/library/test/context.test.mjs`: the library's S6 cap stays 8,000 as a deliberate per-step cap, now
    within the class-M budget instead of equal to it.
  - **Effect on labels: none expected.** No need-router arm (`direct-H`, `agent-H`, `agent-O`, `construct-H`, `build-O`,
    `judge-H`, `m1-call-*`) compiles a node through `compileContext`, the only reader of the class budget (design §1). No
    generative model id, price, class order or escalation rule changed. Jev rows still name the version each response
    reports.
  - **Not changed on purpose: the construction skills.** `skills/micro-harness/SKILL.md:57` still advises "S ≤ 4K
    tokens, M ≤ 8K" and `skills/script-harness/SKILL.md:55` "cheapest model ≤ 8K tokens". Both are in the construct kit
    (`experiments/lib/kit.mjs` `KIT_ALLOW` includes `skills`; `experiments/c0/prompts.mjs`), so construct-H builders in
    NL0 still read the old 8K cap as guidance, now stricter than the class-M budget. They are unchanged because the design
    asks for no skill edit and they are part of the stamped kit. If the owner wants them aligned, the edit lands before
    the 10-18 stamp and is listed here.
  - **The budget is an estimate.** The 100,000 class budget is checked against `compileContext`'s estimate (bytes/4,
    `src/context.mjs:115`), not provider tokens, and the claude-cli route adds its own system prompt. A node accepted near
    the cap can therefore pass Haiku's real 100K-token price boundary and be billed at the higher tier ($0.50/$2.50
    instead of $0.10/$0.50 per MTok, the price source at `policy/models.json:138`). This follows the design's choice of
    that boundary as the budget; no code change.
  - `experiments/need-router/jev-need2.mjs` (review fix): the dry-plan default and the fallback when the policy lists no
    pinned id are `JEV_MODEL`, no longer `jev-latest`. No behaviour change under this policy.
  - **A side effect this record does not resolve: the heal kit is blocked, and the heal suite went red.** The heal kit's
    `policyDrift` gate (`experiments/heal/kit.mjs`, frozen kit 880c6b9) now reports blocking drift on `defaultsByRole` and
    `inputBudgetTokensByClass.{F,L,M}`, so `loadKit` refuses with `HEAL_POLICY_DRIFT` and every heal replay is blocked.
    The e8d7a53 exemption covers the Jev pin only (`judgmentModels`, which the kit never reads). The frozen kit and the
    C0/P1 journals are on this machine, so the heal tests ran rather than skipped: 66 of 95 failed, 29 passed (a review
    measured 86 pass, 0 fail on the same tree with the `2026-10-09.1` policy). Those 66 tests now skip with the reason
    "HEAL_POLICY_DRIFT pending owner choice (D6)" (`experiments/heal/test/helpers.mjs`), only while every blocking path is
    one of these four; any other drift still fails them, and `kit-gate.test.mjs` checks that `loadKit` still refuses.
    The owner chooses (README "Heal-kit drift"): (a) re-freeze the kit's policy of record, which clears the budgets
    (they cannot take a proved exemption, because the frozen `src/runtime.mjs` reads them); or (b) a proved exemption
    for `defaultsByRole`, which no frozen-kit file names; that clears this path only. Heal replays are not need-router
    labels.
  - `prereg-check.mjs` warns that the policy version differs from `stages.json` `policy.policyVersion`
    (`2026-10-09.1`). This item is the deviation that warning asks for; `stages.json` is not edited here. *Update (D9):*
    `stages.json` now pins `2026-10-15.2`, the version in force for NL0. Once the file is frozen, any other version is an
    error, not a warning.
- **D7. M1-R, an unregistered one-call run after M1 was closed.** D2 said any further one-call run needs a new, approved
  stage. M1-R re-ran M1's 54 timeouts (§0.1). It is a plan item of
  `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §5 row 4 (cap $25), run under the owner's standing
  authority. No decision in DECISIONS-ADOPTED.md names it, and this file did not register it. It is now recorded as
  stage M1-R (tag `m1-r`), development grade, outside this program's totals (§12).
  - **Runner.** `m1-rerun.mjs` (sha256 `662ae440…`, 4e2e8fe) copies `m1-run.mjs`'s counter: reported dollars only,
    timeouts at $0, no reservation. D3 said that counter may not be used again.
  - **Attempts.** Attempt 1 is invalid (the port's 300 s deadline; fixed in 29c6c48). Attempt 2 had 4 `MODEL_RATE_LIMIT`
    environment faults, which were re-run at 06:20. Both sets of rows are kept outside the repository.
  - **Spend.** Reported $7.8934. On the §12 meter, $17.8934 over the 54 final rows, and $25.8934 with the 8 set-aside
    attempts at their bound (§12): $0.89 over the $25 plan cap. The overrun is made entirely of bound charges for rows
    with no observed cost (4 timeouts of the invalid attempt, 4 rate-limit refusals). The provider's billing for them is
    unknown; a rate-limit refusal is probably not billed.
  - **Stamp.** None. The record in `stages.json` is reconstructed from 29c6c48. It ran on policy `2026-10-09.1` (D6).
  - **Effect.** The merged labelling `m1r` turns 4 one-call failures into passes (61 → 65 of 144 tasks). It ran no
    `r3p` task. It changes no band and no hypothesis row. J-NEED-2 and Jev-need report both labellings (§0.1).
- **D8. Edits of the 2026-10-15 revision.** `r3p`'s second hypothesis revision (§1.1). The printed `r3p` reading now
  drops d3 and d5 instead of d3 alone; it is still not a gate. The §12 meter counts set-aside attempts. The checker has
  new refusals for recorded runs, external budgets and the analysis' rule imports (§15). §14 is refreshed: `label-run.mjs` now meters by §12, and the `evaluate.mjs` wiring status is
  updated. No need-router label existed when any of this changed.
- **D9. Edits after the second adversarial review** (2026-10-15, still before freeze). The M1, M1-d5 and M1-R rows had
  been viewed; no NL0 or later label exists, and no held-out task was shown to a model or read. Each change has a
  regression test (§14).
  - *C7a reading* (§7, §8, F12). REFUTED needs the upper bound below 0.7. An interval with lower bound ≤ 0.5 < 0.7 ≤ upper
    reads INCONCLUSIVE. The power precondition is P(lower bound > 0.5) ≥ 0.8 for a TPR = TNR = 0.9 classifier, no longer
    a perfect classifier's bound. A new reading, ABOVE-CHANCE-BELOW-USEFUL, covers lower > 0.5 with upper < 0.7. The
    minimum confident counts are now 4 + 9 to 9 + 4.
  - *Power gate* (§11). It is computed with r3p dropped as well, and passes only when both sets pass.
  - *L6* (§6, §12). It is a launch gate in code (`envelopeLaunchCheck` in `paidRunChecks`), with `envelopeFile` per
    envelope stage and `LAUNCH.json` per paid stage. `verifyEnvelope` orders by git commit time, fails when the time is
    missing, and compares with the A-Freeze row. The envelope seals all seven A-Freeze files (`ROUTER_FILES`). E2E needs
    NL2bp only when `gameqa` is drawn.
  - *Meter* (§5, §12). The meter-gate rule: utility uses the reported figure, and the gap (`usdMeterGap`, written by
    `label-run.mjs`, read by `metrics.mjs`) is not imputed. Also the cache-write rate billed, `FORCE_PROMPT_CACHING_5M=1`
    in the launch shape, and the waiver as a deviation. **Informed by D6** (`analysis/m0/REPORT.md` D6; its launch-env
    check is a WIP autosave, not reviewed).
  - *Overshoot* (§12). Measured at $0 on archived rows: 273 JIT agent and interpreter sessions with a known budget
    (`research/jit-20261008/runs/*/<arm>/arm.json` `agentBudgetUsd` against each session's `costUsd`), none above 1.00×;
    8 C0 builds at most 0.28× of their builder budget, gateway overshoot $0 (`archive/c0-dev/constructions.jsonl`). The
    worst case is stated, with a 10% rule.
  - *Spend* (§12). `totals.committedUsd` counts each stage at max(cap, recorded meter). The soft-cap check adds the
    externally budgeted M1-R ($1,372.81 in all).
  - *Owner tasks* (§3.2, §12, K5, K7). They moved from NL0 to NL0-owner (est. $15, cap $40, not yet approved), at $3 per
    task with a $19.50 bound, K = 1 lineage per lineage mode, and K7 read per task. NL0's cap and approval are unchanged.
  - *Held-out seeds before Freeze* (§3.3). `label-run --dry` refuses test-split roles until A-Freeze is filled.
    `hashCollisions` refuses in-process hashing of held-out jobs, and the test no longer does it.
  - *Jev features* (§6). The NR-knn decision reads J-NEED-2 recomputed without `wbed-r3p` (`analysis.jevFeatureDecision`,
    checked).
  - *Policy version* (§13 D6 update). Pinned to `2026-10-15.2`, with the price-table source note updated. A mismatch is
    an error once frozen.
  - *Voided lineages* (§5). They score as failures (`voidPolicy: 'fail'`) and are no longer a missing-data reason; 'drop'
    is a sensitivity.
  - *Probe purposes* (`stages.json` NL1). They name the probe task (§3.3) instead of example 601 (DESIGN §3 departure,
    §14).

## 14. What this file resolved, what stays open

**Resolved here from DESIGN and the adopted decisions:** hypotheses table (§1.1); jobs, clusters, splits and bands
(§3.1–3.2); seeds and per-seed difficulty (§3.3); arm settings and hashes (§4.1); utility, grid, W = V, λ_t = 0
(decision 3), price table (§5); agent-O $8 threshold per job (§3.2, census today); per-family deployable verifier and
numeric tolerances (§3.2, §5); bootstrap, permutation, simulation and draw seeds (`stages.json rng`); NR-probe co-primary
(decision 7); seed-ledger purposes (decision 8, in the ledger); claim thresholds (decision 16); far families funded
(decision 11; identity open); sealed families spent here (decision 15).

**Choices this file makes that DESIGN leaves open [P]** (review before freeze): bands of `r0-pad`, `r3-mini`,
`wbed-stage`, `codefix-notests`, `need-qa`, `need-constraint`; the per-seed difficulty, stage-kind, replacement and racing
lineage rules; agent-O's "maximum over the nine examples"; K2 per draw in NL0; judge-H's effort, truncation, schema, tie
rule and cells; the Haiku cache-read rate; RNG seed values; the VBS\* single-replicate fallback; the test-inversion and
C7a interval wording; the primary-reading timing (§8); probe rows charged to NL1 and NL2p; the E2E draw procedure; the
DRIFT jobs and $8 cap; K9 wording; the forced jobs' requirement candidates.

**Added by the review revision [P]** (2026-10-14; each item has a test in
`experiments/need-router/test/prereg-rules.test.mjs` or `prereg-check.test.mjs`):
- **C7a:** the exact joint balanced-accuracy interval and its power precondition; the minimum confident counts (§7, §8,
  F12).
- **Sign-flip floor:** counts informative clusters only. The power gate's agreement share, and the M0 simulation's planted
  agreement (§7, §11).
- **G1:** REFUTED-PREMISE only on exact cluster-level bounds, so not at 4 TRAIN clusters; CONTINUE also on a diagnostic
  job-level bound. Label confidence has no cluster level (§5, §8).
- **θ:** the fitting minimum; undefined LOCO folds; midpoint candidates with ties to the larger (§6).
- **Stamps:** label-engine stamps per paid stage, the analysis stamp at Freeze, and the allowed-difference list (§4.4).
- **Spend:** the one cap meter, with reservation; M1's tag shares; DRIFT's 3-run limit and the $24 in the soft-cap check
  (§12).
- **Envelopes:** NL2p and NL2bp as envelope stages ahead of their matrices (§12).
- **Readings:** the level of every reading; Holm over the 6 HARMFUL tests; the masked-mode fallback (§7, §8).
- **Missing data:** the missing-data rule and the conditional-job rule (§5).
- **Probe and judge-H:** the probe task at the band's median level; judge-H's fixed tie order (§3.3, §4.1).
- **M1 and r3p:** r3p flagged dev-observed, and the r3p-dropped agreement rule for every claim (§3.1, §8); the M1-informed
  band decision (§3.2).
- **Checker:** refusals for test seeds before Freeze for every role, forced jobs on TRAIN seeds, placeholders at freeze,
  and stage ids as whole tokens (§15).

**Added by the 2026-10-15 revision [P]** (tests in `experiments/need-router/test/prereg-check.test.mjs` and
`prereg-records.test.mjs`):
- **Records:** M1-d5's results and M1-R as its own stage. Their figures are recomputed from the committed rows by a test
  (§0.1, §12, §13 D7).
- **r3p:** the second hypothesis revision; the printed reading drops d3 and d5 (§1.1, §3.2, §8).
- **Meter:** set-aside attempts count (§12).
- **Checker:** freeze guards for recorded runs (complete, named in §0.1, overruns named in §13); external budgets for
  stages outside the totals; the analysis' imports of the preregistered rules (§15).

**Added by the second-review revision [P]** (2026-10-15, §13 D9; tests in `prereg-rules.test.mjs`,
`prereg-check.test.mjs`, `prereg-review2.test.mjs`):
- **C7a:** REFUTED only when the upper bound is below 0.7; ABOVE-CHANCE-BELOW-USEFUL; the chance-based power
  precondition and the new minimum counts (§7, §8, F12).
- **Power gate:** with r3p dropped as well (§11).
- **L6:** the launch gate, envelope files, `LAUNCH.json`, ordering by git commit time, the A-Freeze comparison and the
  conditional NL2bp (§6, §12).
- **Meter:** the meter-gate rule, the cache-write rate billed, `FORCE_PROMPT_CACHING_5M=1`, the waiver as a deviation,
  overshoot (§5, §12).
- **Spend:** committed spend and externally budgeted stages in the soft-cap check (§12).
- **Owner tasks:** NL0-owner, the per-task estimate and bound, K = 1, K7 per task (§3.2, §12).
- **Held-out seeds:** `--dry` and the test suite never generate held-out tasks in-process before Freeze (§3.3).
- **Jev features:** the decision excludes r3p (§6).
- **Policy version:** pinned, and an error once frozen (§13 D6).
- **Voids:** voided lineages score as failures; 'drop' is a sensitivity (§5).

**Departures from DESIGN, recorded here** (each [P], D9):
- **F12 (DESIGN §5)** reads "lower bound ≤ 0.5". Here F12 needs the upper bound below 0.7. The DESIGN wording turns an
  uninformative interval into a refutation (§8).
- **The probe task (DESIGN §3, "on example 601 only")** is seed 601 at the band's median level (§3.3, first changed in the
  2026-10-14 revision without a pointer to DESIGN). `stages.json` NL1's probe rows now say so.
- **Owner tasks (DESIGN §7, "up to 5 owner tasks" inside NL0)** run in their own stage, NL0-owner. They are costed, and
  K = 1 (DESIGN's "one replicate").

**Still open, with who resolves it and when:**

| Open item | Resolved by | When |
|---|---|---|
| Label-engine stamp L-NL0 (§4.4), incl. `static@v3:` reachability, the claude CLI version and prompt shas | coordinator, from the launch commit | at freeze, before NL0 |
| selfCheck prompt paragraph; procedure-writer prompt; judge-H prompt (contracts fixed in §4.1) | M0 code, pinned in the label-engine stamp | before NL0 |
| **600 s per-call timeout for direct-H.** Since 29c6c48 `createModelPort` passes `timeoutMs` to the provider and to the ModelPort (M1-R's attempt 1 was cut at 300 s by the port's own deadline), and `label-run.mjs` passes direct-H's `providerTimeoutMs` per call. Still missing: a $0 test that a direct-H call through label-run's metered port is not cut at 300 s | label-run owner | before NL0 |
| **Every paid runner meters by §12** (max of reported and re-priced; bounds for rows without an observed cost; set-aside attempts; reservation before launch). `label-run.mjs` does, at 71d3f4f: `meterOf` charges max(reported, re-priced + imputed) and at least the bound when the spend was not observed, and `StageBudget` reserves before launch. `m1-run.mjs` and `m1-rerun.mjs` do not (reported dollars, timeouts at $0, no reservation), and neither may run a paid stage again as it stands (D3, D7) | label-run owner (`prereg-rules.mjs capMeter, mayStart`) | before NL0 |
| **The analysis reads the rules from `prereg-rules.mjs`** (`stages.json analysis.requiredRules`; the checker warns until the Freeze addendum pins the analysis, then refuses). At this revision `evaluate.mjs` imports `balancedAccuracyInterval`, `c7aReading`, `thetaFitStatus` and `missingDataRule`, and `router.mjs` imports `thetaFitStatus`, `locoFolds` and `fitOrRule`. Still missing: `g1Reading` (`gateG1` has no diagnostic CONTINUE path), `harmfulPositions` and `withDropAgreement` (`readingOf` flags HARMFUL without Holm, and with r3p dropped checks only the sign of Δ), `signFlipFloor` and `powerGate`. `evaluate.fitRule` still adds the smallest TRAIN value as a candidate and breaks ties by fewest workflow calls. `powerSimulation` plants no router = SBS agreement | evaluate owner | before freeze (the simulation) and before Freeze (the rest) |
| **Whether Jev property features enter NR-knn.** J-NEED-2's own rule put code + Jev in the NR-knn branch, but Jev's increment over code features is not above noise (§0.1). The decision reads J-NEED-2 **recomputed without `wbed-r3p`** (§6, D9); `jev-need2.mjs` has no family filter yet, so the recompute is a $0 code item. If they enter, the §6 feature list for NR-knn names them, and the pinned Jev version (`jev-1.13.0`) joins the analysis stamp. Jev is never the mode picker (decision 12) | the recompute: jev-need2 owner; the decision: Freeze addendum | before 10-24 |
| **A runner for NL0-owner.** `label-run.mjs` plans no `seedsFrom` run, so the owner tasks need a runner. It must meter by §12, take a stamp and a `LAUNCH.json`, and read each task's size for agent-O's budget at admission | label-run owner | before the owner tasks run |
| **The E2E runner calls `envelopeLaunchCheck`** with the drawn set and writes `LAUNCH.json`; `label-run.mjs` does not run `router-choice` | E2E runner owner | before E2E |
| **The meter-gap sensitivity and overshoot listing.** `evaluate.mjs` prints the not-primary sensitivity that counts `usdMeterGap` as imputed (§5), and `label-run.mjs`'s report lists starts charged above their bound (§12) | evaluate owner; label-run owner | before freeze |
| **Voided lineages in `evaluate.mjs`.** Its validity block reads "voided lineage(s): claims blocked until rerun", but no stage is rerun (§12), and under §5 a voided lineage scores as a failure and keeps its job. The analysis must read voids as failures without blocking every claim, or this file must say why it blocks | evaluate owner | before Freeze |
| **`powerGate` in the analysis.** `evaluate.mjs` must call it with `nearClusters` from `stages.json analysis.powerGate` (1, r3p) | evaluate owner | after NL1 |
| `codefix-notests` generator and its example census. A generator is present as `beds/need-codefix-noverifier` (WIP autosave, unreviewed at this revision); the job's family id, `bedStatus` and census are updated, with a §13 note, when it is admitted | M0 item 8 | before NL1 |
| Null-simulation numbers (§11), with planted router = SBS agreement | `evaluate.mjs` | before freeze |
| σ, the agreement share and the power gate outcome | NL1 leave-one-cluster-out (defined folds only) | after NL1 |
| **TRAIN N = 1 positives outside W.** Under §1.1 every hypothesised TRAIN positive is in W, so H0 is expected not to be fitted (§6). The owner may add a TRAIN job outside W expected to need a workflow at N = 1 before NL1 (for example an E-bed item once admitted), or accept "H0 not fitted" | owner | before NL1 |
| **Narrow the ledger's `need-heldout` beds** (today `['*']`) to the held-out families, so the ledger itself keeps TRAIN families off held-out seeds | owner (the ledger is the owner's file) | before NL2 |
| θ_tok, θ_fan, leaf modes, k, probe mapping, analysis stamp A-Freeze | Freeze addendum | 10-24 |
| far-1, far-2 identity, author, band, verifier, hypothesis rows | owner (decision 11) and the admission audit | before NL2 |
| gameqa and runbook bands, audits, runbook requirements | an independent audit session | before NL2b |
| E8's requirements and role beyond the forced stratum | M1e, after #58 commits | M1e |
| Owner tasks, acceptance checks, recurrence list, hypothesis rows | owner (decision 10) | target 10-28 |
| Sealed families' identity, seeds and hypothesis rows | a session that tuned nothing | NL3 |

## 15. How to check this file

```
node experiments/need-router/prereg-check.mjs                       # ledger, policy, caps, seeds, envelopes, text; exit 0 = OK
node experiments/need-router/prereg-check.mjs --hashes              # also the $0 taskHash pre-check (about 40 s; held-out in a child process)
node experiments/need-router/prereg-check.mjs --stamp --stage NL1   # print the label-engine, analysis and document stamps
node --test experiments/need-router/test/prereg-check.test.mjs experiments/need-router/test/prereg-rules.test.mjs \
  experiments/need-router/test/prereg-records.test.mjs experiments/need-router/test/prereg-review2.test.mjs
```

The checker refuses the following.
- **Seeds:**
  - a seed the ledger refuses for its purpose;
  - **any test-split seed role (heldoutEval, heldoutReserve, e2e, drift) in a stage at or before Freeze, for any job**;
  - a TRAIN job on any test-split role;
  - a held-out, conditional, **forced** or sealed job on TRAIN evaluation seeds (trainEval, trainReserve);
  - a non-held-out job in the E2E lane;
  - overlapping seed roles.
- **Envelopes:**
  - a held-out probe or judge row outside an envelope stage;
  - an envelope stage before Freeze or with evaluation seeds;
  - an envelope stage without its own `envelopeFile` under `research/need-router-20261014/envelopes/` (D9);
  - a `conditionalEnvelopes` entry that `requiresEnvelope` does not list, or that names a job its envelope does not decide
    (D9);
  - a matrix stage whose held-out jobs no earlier envelope covers.
- **Jobs and arms:**
  - a family in two clusters;
  - a band that 12 tasks cannot spread over evenly;
  - an arm whose settings hash differs from its definition;
  - a model id or base price not in `policy/models.json`;
  - a near or dev-observed held-out job without a mandatory C7a and C7b drop sensitivity;
  - a hypothesis revision without a date and what informed it.
- **Spend:**
  - a stage cap over the $500 pause;
  - tagged runs without cap shares, or shares over the stage cap;
  - a stage outside the totals with neither a recurring run limit and cumulative cap nor an `externalBudget` whose plan
    file names the stage and whose cap equals the stage's;
  - committed spend (each stage at max(cap, its recorded runs on the meter)) plus recurring cumulative caps plus
    externally budgeted stages over the $1,500 soft cap (D9; before D9, caps alone);
  - a development owner-task run without its replicates and lineages, or an owner job without a per-task estimate,
    bound and task limit, or a stage estimate below them (D9);
  - totals that differ from the stage sums.
- **Policy:** once frozen, a policy version other than `stages.json policy.policyVersion` (a warning before; D9).
- **Jev features:** a held-out family read by J-NEED-2 that `analysis.jevFeatureDecision.excludeFamilies` does not name
  (D9).
- **Recorded runs** (`observed`, 2026-10-15):
  - a record keyed by anything but a run tag of its stage, or with a status other than complete or in-flight;
  - a complete record without its calls, reported dollars, meter figure (never below the reported one) and runner sha;
  - **when frozen, a record that is not complete** (its results go into §0.1 first);
  - a recorded run, or its stage, that §0.1 does not name;
  - a record over its cap share on the meter that §13 does not name.
- **Analysis:**
  - a rule in `analysis.requiredRules` that `prereg-rules.mjs` does not export;
  - **once the §4.4 A-Freeze row is filled, a required rule that `evaluate.mjs` and `router.mjs` do not import** (a
    warning before that).
- **Text:**
  - a preregistration text that does not carry the status, every job id, every stage id **as a whole token** ("NL2"
    inside "NL2b" does not count) and every arm hash;
  - no "dev-observed" flag when a job is dev-observed;
  - **when frozen, any `TBD-M0` or "TBD at … launch" left in §4.4 or §11.**

`--hashes` also refuses (as errors) any planned task seed the ledger refuses.

At launch, `label-run.mjs` refuses (D9):
- a paid stage with `requiresEnvelope` whose needed envelopes fail `envelopeLaunchCheck` (§12);
- a `--dry` run on a test-split evaluation role before the A-Freeze row is filled, unless `--allow-heldout-dry` names a
  §13 deviation (`heldoutDryRefusal`, §3.3).

`hashCollisions` refuses `child: false` for any held-out, conditional or forced job.
