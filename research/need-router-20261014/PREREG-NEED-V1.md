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

Machine-readable half: [prereg/stages.json](prereg/stages.json) (jobs, clusters, arms with settings hashes, seeds, price
table, grid, RNG seeds, stages with caps, the reading rules under `analysis`, the cap meter, the engine-stamp lists).
Checked by `node experiments/need-router/prereg-check.mjs` (§15). Where this text and `stages.json` differ, the run is
blocked until they agree. The checker enforces the parts it can: status; every job id, stage id (as a whole token) and
arm hash named here; ledger refusals; seed and freeze rules; envelopes; caps; policy prices; placeholders at freeze. The
reading rules of §5–§8 and §11–§12 are also code: `experiments/need-router/prereg-rules.mjs`, with tests.
`evaluate.mjs` must read them from there (§14).

Tags: [D] from DESIGN.md, [A] an adopted owner decision (DECISIONS-ADOPTED.md), [M] measured or read in a repository file
today, [P] a choice made in this preregistration because DESIGN leaves it open (listed in §14 for review before freeze).

Evaluation grades: **development** (TRAIN jobs, M0 diagnostics, M1, M1e, NL0, NL1, archived LEGACY rows; used to build
and tune), **held-out** (NL2, NL2b, E2E; families never used for tuning), **sealed** (NL3; run once by a session that
tuned nothing). Tests used to improve the router or the builders are development evidence, never held-out.

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
no five-mode paired row exists. This revision's author read the M1 report, tallied its 192 rows ($0), read the Jev-need
report, and recomputed the reviewer's set-1 feature medians at $0. The author did **not** read any M1-d5 row.

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
- **M1-d5** (tag `m1-d5`; not in the first draft, so an unregistered run, deviation D2). Started at 23:00 and in flight
  at this revision. Command: `node experiments/need-router/m1-run.mjs --rungs r2,r3,r3p,r6 --difficulty 5 --cap 10`;
  `m1-run.mjs` sha256 `7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692` (commit 56c0a82). Plan: 4 rungs × 12 seeds × 2 efforts = 96 calls at d5,
  on the same dev attack seeds. It keeps its own spend counter (reported dollars, no reservation) and its own --cap 10.
  Its results are added to this section when it ends, before Freeze. The band rule below was fixed before they are read.
- **Jev-need** (commit 8ef7fa2). Hosted Jev read the 96 M1 tasks, including the 12 `r3p` tasks, and predicted whether
  one call suffices. Task-level AUROC 0.53, against 0.71 for a one-line size rule. It cost a fraction of a cent.
  Development evidence for decision 12 only.
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

Implied H0 expectations (for the record, not a test): the workflow class is expected only where inputs are large
(`wbed-r3-hi` up to 65K tokens, `r3p` up to 64K, `wbed-r6` up to 75K) or fan-out is wide (`wbed-r1-hi`), and **not** on
`r0-pad` (23K tokens of padding), `r3-mini` or `wbed-stage`. `incident` (up to 107K tokens at d4) is the planned
counterexample to a pure size rule: expected no-workflow despite its size.

The set-1 medians (§0.1) make two consequences explicit:
- **H0 is expected not to be fitted.** The only TRAIN job hypothesised to need a workflow at N = 1 is `wbed-r3-hi`, in
  cluster W, which is below §6's fitting minimum (2 confident positives in 2 clusters).
- **No fitted rule could call `r3p` intrinsic.** Even with a fit, its tokens (4.63) sit below a hypothesised TRAIN
  negative (`wbed-r6`, 4.78), and its fan-out (1.52) is far below `wbed-r3-hi`'s (2.98).

Under these hypotheses C7a is therefore expected to read INCONCLUSIVE (§8).

## 2. Unit and populations

- **Unit:** a job = (family, difficulty band, N, V, W, verifier, typed hard requirements). One decision per job, before
  the work; pinned. A single request is a job with N = 1; a recurring family has a declared N (decision 5). [A]
- **Primary population:** non-forced held-out jobs (split HELD-OUT and, once admitted, HELD-OUT conditional), L_today
  labels. [D]
- **Forced stratum:** jobs with a typed hard requirement (`runbook`, `e8`). Reported separately; guard recall only. [D]
- **Owner and sealed jobs:** `owner-dev` (up to 5 owner tasks in NL0) is development evidence only. `owner-sealed` and
  `sealed-1` … `sealed-4` form the sealed stratum (NL3). The owner tasks are independent tasks, so the dev/sealed split of
  owner tasks does not break the one-family-one-split rule. [D]
- **Weights:** each held-out cluster weighs 1; jobs within a cluster weigh equally. [D]

## 3. Families, clusters, splits, bands, seeds

### 3.1 Clusters

Families that share a world, generator or library (by import graph) form one cluster and stay in one split [D]:
cluster **W** = {records, wbed-r0, need-r0pad, wbed-r1, wbed-r2, wbed-r3, need-r3mini, need-stage, wbed-r6}, in TRAIN (r2
imports `beds/records/pools.mjs`; r3 imports `r1/world.mjs`; r6 imports `wbed/lib/domain.mjs` and `parties.mjs`; the three
anchors wrap R0, R3 and the rungs). r3p imports only `wbed/lib/{contracts,faults,prng}.mjs`: its own cluster, held out,
flagged **near** [D]. It is also flagged **dev-observed** [M]: M1 ran one Haiku call on it at d3 (12/12 and 11/12), M1-d5
is running it at d5, and Jev-need read its 12 M1 tasks (§0.1). Cut from v1: r4, r5, gridquest, the `ask` mode. [D]

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
| `owner-dev`, `owner-sealed` | owner tasks | one task per job unless the owner declares N | the owner's acceptance check | – | rule | in NL0 / NL3 |
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

**Allowed differences between two paid stages' label-engine stamps:** one bed directory first used by a job whose first
paid rows are in the later stage. Example: the `codefix-notests` generator before NL1. **Any other difference** (a file,
a tree, a bed used by both stages, the preregistered arms, prices, seeds, grid or meter, the need ledger, Node, the CLI)
is a §13 deviation, recorded before the later stage starts. NL0 rows are never re-run or pooled differently because of
it; the deviation says which rows each engine produced.

| Item | Value |
|---|---|
| S-M1 (M1, tags `m1` and `m1-d5`) | not taken: M1 launched at 21:31, before this row was filled. Reconstructed after the fact (not a launch stamp) in `stages.json` M1 `observed.*.engine`. `m1` ran on `m1-run.mjs` sha256 `478744664b95accf016fe7ea628ee856b3ab7bdb559081a0b7ac261d4c8a58e7` (e5defed); `m1-d5` on `7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692` (56c0a82). Deviation D1. |
| L-NL0 (label engine at NL0 launch; pasted here at freeze) | TBD at NL0 launch |
| L-NL1, L-judge-H, L-NL2p, L-NL2, L-NL2bp, L-E2E, L-NL2b, L-NL3, L-DRIFT | taken at each stage's launch into `runs/<id>/STAMP.json` and compared with the previous paid stage by `stampDiff` |
| A-Freeze (analysis stamp) | TBD-FREEZE (the Freeze addendum, §6) |

## 5. Label protocol

- **Matrix:** `M[job][mode][task][replicate] = {pass, score, delivered, schemaValid, selfVerdict, deployableVerdict,
  usdReported, usdRepriced, usdImputed, ms, tokens, error}`; build rows as §4.2. [D]
- **Utility per task, in success-equivalents** [D]:
  `u_m = p_m − c_m/V − B_m/(N·V) − (W/V)·q_m − r/(N·V)`. p = oracle pass rate (mean over tasks of the mean over
  replicates or lineages); c = mean per-task cost (re-priced); B = mean build cost per lineage, failed builds included;
  q = rate of delivered, schema-valid, wrong answers; r = routing cost per job (probe and judge calls), charged to router
  policies only. An abstention (null, or a self-check failure that is not delivered) costs nothing beyond its dollars.
- **Grid:** V ∈ {0.10, 1, 10}; N ∈ {1, 10, 100} (100 labelled "extrapolated, stationarity assumed"); W ∈ {V (headline), 0,
  10V} (decision 3); λ_t = 0. The owner declared no λ_t, so no latency sensitivity runs in v1; median latency per mode
  is reported. **Headline cell: V = $1, W = V, N = 10.** [A, D]
- **One cost meter:** every row is re-priced from recorded token usage with the pinned table `need-v1-prices@2026-10-14`
  (`stages.json priceTable`), cache reads and writes included; both the reported and the re-priced figure are shown;
  utility uses the re-priced one. Timeouts and killed sessions are charged at their bound. Measured and imputed dollars are
  split; a cell with more than 30% of its dollars imputed is left unlabelled. [D] Price table (USD per million tokens) [P,
  sources in `stages.json`]:

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
  - Reasons include: a stage stopped at its cap (K5), an arm invalidated by K4, a run condition not met, every lineage
    voided.
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
| NR-knn (secondary) | k ∈ {3, 5} by LOCO on TRAIN, **TBD-FREEZE**; demoted to the family-majority baseline if L8 trips [D] |
| judge-H (secondary) | settings §4.1; prompt text pinned by sha in stamp S1 [P] |
| Shas | the analysis stamp A-Freeze (§4.4: `features.mjs`, `router.mjs`, `voi.mjs`, `metrics.mjs`, `evaluate.mjs`, `card.mjs`, `prereg-rules.mjs`) and the price table: **TBD-FREEZE** [D] |
| Envelope | `evaluate.mjs --commit-decisions` writes every held-out decision card (`need-decision/1`); its hash is committed before the held-out matrix is joined (L6) [D]. The probe and judge-H rows that feed those cards run in their own envelope stage (NL2p, NL2bp), and the matrix stage (NL2, NL2b, E2E) is gated on the committed hash (§12) [P] |

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
NR-probe); a cluster's value is the mean over its jobs. [D]

**Inference** [D]: an exact one-sided sign-flip permutation test over the cluster-level Δ values (all 2^n patterns for
n ≤ 20 clusters; Monte Carlo with 100,000 patterns, seed 20261020, above that). Holm over the two co-primaries at
one-sided α = 0.05: the policy with the smaller p is tested at 0.025, the other at 0.05 if the first is rejected. Bounds
by test inversion at the same level: the lower bound is the smallest δ₀ for which H: Δ ≤ δ₀ is not rejected, the upper
bound the largest δ₀ for which H: Δ ≥ δ₀ is not rejected (shifted values d_c − δ₀, sign flips) [P wording]. The seeded
cluster bootstrap (10,000 reps, seed 20261015) is a sensitivity. Floors: smallest p = 2^−n; with 5 clusters 1/32 = 0.031
> 0.025, so **with 5 clusters no reading can be SUPPORTED**; 6 → 1/64; 7 → 1/128.

**Primary for C7a:** balanced accuracy of H0's need call against confident N = 1 labels on held-out non-forced jobs.
Intervals: Wilson intervals on the workflow-class recall and the no-workflow-class recall, the balanced-accuracy bounds
being the mean of the two lower (upper) bounds [P]; coverage printed; compared with the majority class (balanced
accuracy 0.5) and the tuned size rule. If the confident labels hold one class only, balanced accuracy is undefined and C7a
reads INCONCLUSIVE. [D]

**Secondaries, fixed order, all marked "not primary"** [D]:
1. The same Δ at V = $0.10 and $10; at W = 0 and 10V; at N = 1 and 100; on L_ceiling; with r3p dropped.
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

**Gate G1 (TRAIN, after NL1)** [D]: cross-fitted VBS\* − SBS headroom per (V, N) cell at W = V (9 cells), hierarchical
bootstrap 2,000 reps, seed 20261021, two-sided 95%:
- upper bound below 0.03 and below 20% of the SBS's per-task cost in success-equivalents (c_SBS/V) in every cell →
  REFUTED-PREMISE: stop paid labelling; ship the fixed policy, the guards and a V-threshold ladder (the calculator);
- lower bound above 0 in some cell at V = $1 → continue;
- anything else → the owner decides.
This replaces ROADMAP:632–634 (decision 1). [A]

**Readings for C7b, per co-primary policy** [D, A decision 1]:

| Reading | Condition |
|---|---|
| SUPPORTED | lower bound of Δ > 0; point ≥ 0.03; beats the tuned size rule and judge-H (paired cluster-level difference, the same sign-flip inversion, one-sided 95%, lower bound > 0; conjunctive conditions, no further correction); slider calibrated (at most 1 of 3 positions misses; realised success and $ per task non-decreasing in V); the sign of Δ holds with r3p dropped. "Useful size shown" only if the lower bound ≥ 0.03. |
| SUPERIOR, BELOW USEFUL EFFECT | lower bound > 0; point < 0.03 |
| REFUTED | upper bound < 0.03 at all three V, or G1 refuted |
| HARMFUL | upper bound < 0 at any V; that slider position is disabled |
| INCONCLUSIVE | anything else; the owner decides, with the achieved power printed |

**C7a reading:** SUPPORTED-DIAGNOSTIC if H0's balanced-accuracy lower bound exceeds 0.5 (the majority class) and the
tuned size rule's point estimate, with coverage ≥ 50%. Claim grade only at ≥ 10 held-out clusters including the owner-task
set, with ≥ 50% confident labels (decision 16). REFUTED if F12 trips. Otherwise INCONCLUSIVE. [D, A]

**C7b claim grade** needs ≥ 30 held-out families (decision 16, lane 05); v1 reads C7b at diagnostic grade only. Until the
owner tasks arrive, no reading goes above diagnostic (decision 10). [A]

**Partial readings** [D]: NR-static fails but NR-probe SUPPORTED → "need cannot be read from the spec; a one-example
probe is required". C7a intervals cover the majority-class baseline → "the router cannot detect need from structure".
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

## 9. Falsifiers (proposed for ROADMAP §4.3)

F1 G1 refuted. F2 held-out Δ upper bound < 0.03 at every V. F3 no win over the tuned size rule or judge-H (ship the rule
instead). F4 the gain vanishes once guard-forced jobs are excluded (it belongs to the guards). F5 padding, keyword, gadget
or paraphrase metamorphs flip more than 20% of routes where the labels do not flip. F6 any leak test L1–L8 fails (the
evaluator is invalid; every claim is blocked). F7 the slider is uncalibrated or not monotone. F8 in a mixed-stream
replay, no slider setting dominates both always-no-workflow and always-construct. F9 on owner tasks, regret is worse than
SBS (upper bound < 0). F10 the gain appears on near held-out families (r3p) but not far ones (the claim is limited to
near families). F11 a build path's self-check false-pass rate > 0.2 with ≥ 10 oracle failures (that path is not
deployable, whatever the router says). F12 at N = 1, H0's held-out balanced-accuracy lower bound ≤ 0.5. [D]

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
import graph with r3p dropped in a sensitivity; utility primary and coverage beside accuracy; drop-one-cluster influence on
the lower bound printed; L_today against L_ceiling; W = V headline with q charged and self-checks measured; one re-priced
meter; timeouts at the bound and > 30%-imputed cells unlabelled; fragility recompute; bands frozen here; prose features
removed, r0-pad and r3-mini in TRAIN, tuned size rule, L8; paraphrase-pool sharing stated as an unknown; N = 10 headline;
fresh 6xx and 88xx seeds only; later additions form a separate stratum; the oracle is never a runtime verifier; families
audited before their labels are viewed; owner tasks and far families flagged; precision at assumed base rates; pinned
model ids and the monthly drift re-check (stage DRIFT); the live E2E lane.

## 11. Power

- **Exact floor.** One-sided sign-flip test over n clusters: smallest p = 2^−n. Holm's first step needs p ≤ 0.025:
  n = 5 → 0.031 (cannot pass); n = 6 → 0.016; n = 7 → 0.0078; n = 8 → 0.0039. [D]
- **Interval width.** A t-type interval over 7 clusters has half-width about t(0.975, 6)·σ/√7 ≈ 0.93σ (σ = the
  between-cluster SD of Δ). A half-width of 0.03 needs σ ≤ 0.032; at σ = 0.10 only effects above about 0.09 are
  detectable [I, D].
- **Power gate (after NL1).** σ is estimated by leave-one-cluster-out on TRAIN (cluster-level Δ of NR-static under LOCO).
  If the projected half-width at the planned held-out cluster count exceeds 0.03, either add clusters (far families,
  gameqa, owner tasks) or accept an expected INCONCLUSIVE, recorded in §13 before NL2. **TBD-NL1.**
- **Simulation (M0).** Synthetic matrices with planted optima at the planned sizes (15 TRAIN jobs in 4 clusters; 5, 7 and
  8 held-out clusters; 12 tasks; the §4.1 replicates), seed 20261018: false SUPPORTED ≤ 5% under the null; P(SUPPORTED) at
  planted Δ = 0.03, 0.08 and 0.15. **TBD-M0**: `evaluate.mjs` produces it, and freezing this file requires its numbers
  in this section.
- **C7a.** With 8–12 confident held-out jobs, a Wilson interval on balanced accuracy is about ±0.25 wide [I]; C7a at this
  size is diagnostic.

## 12. Stages, caps, kill and stop rules

Launch shape (coordinator) [D]:

```
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" LANG="$LANG" TERM="$TERM" CLAUDE_CODE_OAUTH_TOKEN=... \
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
| M1 | 10-15/16 | development | `node experiments/need-router/m1-run.mjs --cap 15`: 8 rungs (wbed-r0 … r6, wbed-r3p) × 12 seeds × 2 efforts = 192 Haiku calls at d3; also the W-bed one-call admission gate (R0 ≥ 10/12 per effort, other rungs ≤ 2/12) | 10 | 15 | yes | stamp S-M1 |
| M1e | when #58 commits | diagnostic | read the in-flight E8 runs (agent-H paired with B1L-H lineages 1–3, B1-H, B1-O; same 9 dev worlds) | 0 | 0 | yes | – |
| NL0 | 10-18/19 | development | `records-hi`, `wbed-r0`, `wbed-r3-hi` × five modes; build-O and (if stamped) ref-R3 on `wbed-r3-hi`; up to 5 owner tasks (`owner-dev`, all modes, one replicate) | 110 | 140 | yes | freeze of this file; stamp S1; K2 |
| NL1 | 10-20 → 10-23 | development | the other 12 TRAIN jobs; build-O on `wbed-r1-hi` and `kinetics-hi`; ref-R1 if stamped; NR-probe rows on all 15 TRAIN jobs; then G1, the power gate, LOCO dev numbers | 272 | 340 | at gate | K7; owner |
| Freeze | 10-24 | development | fit θ, leaf modes, k, probe mapping; hash the router; addendum; commit the decisions envelope (L6) | 0 | 0 | yes | K1 |
| NL2 | 10-25 → 10-28 | held-out | `incident`, `synth-lo`, `synth-hi`, `ownerci`, `r3p`, `need-constraint`, `far-1`, `far-2` × five modes; build-O on `synth-hi` and `r3p`; NR-probe rows (decisions committed before the matrix is joined) | 206 | 270 | at gate | Freeze addendum; owner |
| E2E | 10-29 → 11-02 | held-out | 6 held-out non-forced jobs by the seeded draw (below); decision card → owner override (48 h, logged) → build with self-check → 12 fresh tasks (8825–8836) → delivery gated by the deployable verifier; oracle scored offline | 60 | 80 | at gate | NL2 interim reading written |
| NL2b | 10-29 → 11-04 | held-out | `gameqa` (held-out) and `runbook` (forced stratum), four modes (direct-H masked) | 98 | 140 | at gate | independent audit and agent smoke per family |
| NL3 | owner tasks arrive (target 10-28) | sealed | `sealed-1` … `sealed-4` and `owner-sealed` (20–30 owner tasks), run once by a session that tuned nothing | 190 | 240 | at gate | – |
| judge-H | with NL1 and NL2 | development / held-out | 3 draws × 3 V per job, about 180 typed calls | 5 | 10 | at gate | – |
| **Total** | | | | **951** | **1,235** | | under the $1,500 session soft cap |
| DRIFT (outside the totals) | monthly after NL2 | diagnostic | agent-H on `incident` and direct-H on `synth-lo`, seeds 8837–8848, one draw (24 tasks); drift flagged when the Wilson intervals of the NL2 and the re-check pass rates do not overlap | 5 | 8 | at each run | owner |

Core (M1, NL0, NL1, NL2, E2E, judge-H): est. $663, caps $855. [D] NR-probe rows are charged to NL1 (TRAIN) and NL2
(held-out) [P]. DRIFT's jobs and cap are [P].

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
- **K5** a stage reaches its cap → stop and analyse as it stands; no reruns.
- **K6** any single experiment estimated over $500 → pause for the owner (`policy/models.json:21`).
- **K7** NL0 cost per job over 1.5× the estimate → re-plan before NL1.
- **K8** every construct-H lineage fails on every NL0 job while build-O passes → continue, but no "no need" reading may
  be drawn from L_today alone.
- **K9** F11 trips on a build path → that path is scored with its self-check gate removed (every schema-valid answer
  delivered and charged as delivered) in all later utility [wording P].

## 13. Deviations

Any change after the freeze is recorded here with its date, reason and whether any label had been viewed. Jobs,
families or analyses added after freeze form a separate stratum and never enter the headline. Raw failures and negative
results are kept. An owner overturn of an adopted decision is applied before the next paid stage, never retroactively to
a frozen reading (DECISIONS-ADOPTED). [D, A]

(none yet)

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
C7a interval wording; the primary-reading timing (§8); probe rows charged to NL1 and NL2; the E2E draw procedure; the
DRIFT jobs and $8 cap; K9 wording; the forced jobs' requirement candidates.

**Still open, with who resolves it and when:**

| Open item | Resolved by | When |
|---|---|---|
| Engine stamps S-M1, S1, S2 (§4.4), incl. `static@v3:` reachability and prompt shas | coordinator, from the launch commit | before M1 / NL0 / at Freeze |
| selfCheck prompt paragraph; procedure-writer prompt; judge-H prompt (contracts fixed in §4.1) | M0 code, pinned by sha in S1 | before NL0 |
| 600 s per-call timeout option for direct-H (createModelPort has none today; M1 uses the 300 s default) | M0 code | before NL0 |
| `codefix-notests` generator and its example census | M0 item 8 | before NL1 |
| Null-simulation numbers (§11) | `evaluate.mjs` | before freeze |
| σ and the power gate outcome | NL1 leave-one-cluster-out | after NL1 |
| θ_tok, θ_fan, leaf modes, k, probe mapping, router shas | Freeze addendum | 10-24 |
| far-1, far-2 identity, author, band, verifier, hypothesis rows | owner (decision 11) and the admission audit | before NL2 |
| gameqa and runbook bands, audits, runbook requirements | an independent audit session | before NL2b |
| E8's requirements and role beyond the forced stratum | M1e, after #58 commits | M1e |
| Owner tasks, acceptance checks, recurrence list, hypothesis rows | owner (decision 10) | target 10-28 |
| Sealed families' identity, seeds and hypothesis rows | a session that tuned nothing | NL3 |

## 15. How to check this file

```
node experiments/need-router/prereg-check.mjs            # ledger, policy, caps, text consistency; exit 0 = OK
node experiments/need-router/prereg-check.mjs --hashes   # also the $0 taskHash disjointness pre-check (about 20 s)
node experiments/need-router/prereg-check.mjs --stamp    # print the engine-stamp record of the working tree
node --test experiments/need-router/test/prereg-check.test.mjs
```

The checker refuses: a seed the ledger refuses for its purpose; a held-out job on TRAIN seeds or evaluated before
Freeze; a TRAIN job on held-out seeds; overlapping seed roles; a family in two clusters; a band that 12 tasks cannot
spread over evenly; an arm whose settings hash differs from its definition; a model id or base price not in
`policy/models.json`; a stage cap over the $500 pause or caps summing over the $1,500 soft cap; totals that differ from
the stage sums; and a preregistration text that does not carry the status, every job id, every stage id and every arm
hash.
