# Auto-heal: detect, localise, propose, verify, promote, learn (design, 2026-10-08)

*Written 2026-10-08 (about 15:00–16:00 UTC) on HEAD `13f7664`, while a concurrent workflow was changing `src/` (engine stage-1
lanes). Design plus one zero-cost feasibility probe. Nothing in `src/`, `web/`, `bin/`, `schemas/`, `policy/`, `skills/`, `beds/`,
`experiments/{c0,p1,lib,workflows}` was changed, and git state was not touched. New files: this document,
[`experiments/heal/probe/feasibility.mjs`](../../experiments/heal/probe/feasibility.mjs) and its output
[`probe/feasibility.json`](probe/feasibility.json). Status: **development and diagnostic evidence**. The probe re-executed only
recorded runs on test seeds that are already INSPECTED (C0 records/codefix 6001–6004 d3; P1 records 5002 d3). It printed ids, enum
values, scores, counts and costs, never task text, prompts or replies.*

**Evidence tags.** **[M]** measured here (command in appendix A). **[D]** documented: a path with line numbers, or a report in this
repository. **[I]** inferred: reasoning from [M] and [D] that nothing has tested yet.

**The owner's ask (2026-10-08, verbatim),** about the run-history summariser of
[lane 6b](../review-20261007/06b-run-history.md), which explains a failure and stops at a `suggested_fix` that "is text for a person"
[D: `06b-run-history.md:112`]:

> "like no it should autoheal and figure out whats missing and what needs to be made so  it doesnt run into that issue"

So the summariser's output becomes the input of a loop that (a) finds what is missing in a workflow, on failures and on passes that
only got lucky, (b) makes it as a typed patch, (c) proves the patch by replay and fresh tasks, (d) promotes it without a person in
the loop when every code gate holds, and (e) feeds the pattern back to the constructor so the next workflow does not need healing.

---

## 0. Short answers

1. **What it is.** An offline loop over recorded runs: **DETECT → CLASSIFY → LOCALISE → PROPOSE → VERIFY → PROMOTE → LEARN**.
   Models do one narrow thing in it: the proposer turns typed facts into typed patch operations. Everything that decides
   (detection thresholds, localisation, applying a patch, every gate, promotion, rollback) is code. It is ROADMAP §2.6's L3 rung
   ("an offline proposer may suggest L3 patches from pooled failures") and §2.5 step 8 ("Edit", R-16), built as experiment code under
   `experiments/heal/` until EX1 shows it pays.
2. **Detection covers lucky passes, not only failures.** Besides check, oracle and verdict-vs-oracle signals, two oracle-free
   signals found the latent defects on runs that *passed* [M]:
   - *fragility*: flipping one field of the `records` global read changes 8.5–48% of the answer on every trial, and every such
     flip on the 6 passing trials fails the oracle, while flips of an irrelevant field change 0%;
   - *check vacuity*: 59 of 90 Haiku status judgments in P1 went through the `relation: "none"` branch, where the check never
     looks at `meaning`;
   - *cost outlier*: all 4 `codefix` trials that ran the Opus repair (one of them a pass) cost 2–4× the others, and each carries
     the false flag of `check1`.
3. **Localisation is replay plus counterfactual substitution, and it costs $0.** On the frozen runtime, 16/16 recorded C0
   F-haiku trials and the P1 failure replay exactly (task hash, oracle score, run verdict, call count), in 2–9 s each [M]. One
   substituted node output, with downstream code re-run deterministically, then named the defect in all three cases [M]:
   - `records`: of 24 single-field flips of `conf`, exactly one (BRIGHTDESK `numeric_order` MDY→DMY) turns 0.789 into a pass;
   - `codefix`: flipping `check1.ok` passes all 3 failed trials and saves the Opus call on the lucky pass;
   - P1: flipping one map item's `meaning` passes.
4. **Two replay pitfalls found and designed around.**
   - A pinned node must keep the refs the original read, or the taint label of its output changes the downstream prompt
     (4/4 `REPLAY_MISS` [M]).
   - Replay keys do not include the node id, so naive k-sample siblings would replay one sample twice in verification
     [I from `port.mjs:45`].
5. **Patches are a closed set of typed operations** on the workflow IR, for example: add evidence field + check, k-sample
   agreement, escalate class, add/tighten/relax a check (relax only with a cited justification and mutant proof), patch a code node
   from a failing assertion, add a probe, and mechanical lint-debt repairs. There is no delete-check, delete-node, weaken-acceptance
   or declassify operation. Each proposal is version-bound (base hash, kit hash, lint pin, policy hash, brief hash) with lineage.
6. **Verification is code, cheapest first:**
   - V0 static rules, the literal-leak scan and V1 strict lint;
   - V2 an acceptance-weakening rule;
   - V3 the failing case passes K = 3 replays, with changed nodes live;
   - V4 every previously passing recorded run still passes, with unchanged nodes replayed from the journal;
   - V5 the acceptance still rejects the bed's bad controls;
   - V6 cost and latency within bound;
   - V7 a paired, stratified run on fresh dev seeds no workflow has used;
   - V8 grader hashes unchanged.
7. **Promotion is a pure function of the verification record.** It writes the new version with compare-and-swap, records
   lineage, runs the new head in shadow, and rolls back by circuit breaker. A promoted heal never touches frozen research
   artifacts or a pre-registered arm. Relaxing a check, raising a class to F, or adding more than 25% cost goes to owner review
   instead of auto-promotion.
8. **Learn.** Each heal yields a *lesson*: a lint rule, template change or probe requirement, with a reference implementation
   scored on the existing workflow population. It is stored as a reviewed proposal for `skills/micro-harness` and the lint, and
   reaches the constructor only through a new kit hash. Three lessons fall out of the three cases (§10).
9. **Limits.**
   - Nothing heals without a detection signal.
   - With no oracle, a heal may only add guards, never relax them, and its runs stay `unverified`.
   - Healing must not delete checks or special-case task literals, enforced by code (§11).
   - These three cases are inspected development data: they build the loop, and say nothing about how well it works. The
     capability number comes from EX1 on injected faults and fresh failures (§12).
10. **Cost.** About $10–14 to heal the three dev incidents end to end, dominated by the fresh-task gate [I, §11.4]. This is within
    EX1's $15–30 budget. The build is about 1,500–2,000 lines plus tests (§14).

---

## 1. Inputs and constraints

### 1.1 The three incidents (development data; all test seeds INSPECTED)

| id | workflow (hash pinned) | failed trials | oracle | run verdict | diagnosed cause | diagnosis |
|---|---|---|---|---|---|---|
| H-rec | C0 `F-haiku-records-k1/workflow.json` (sha256 `eaa901a4…784a9`) | s6001 t0, t1 | 0.789197 (fail) | `pass` | the one unchecked global read `conf` (Haiku, `reasoning: low`) read BRIGHTDESK's numeric date order as MDY. The truth is DMY, stated only by example; `merge` applies it to every row | [F-haiku-records.md](../construction-20261006/diagnosis/F-haiku-records.md) |
| H-cfx | C0 `F-haiku-codefix-k1/workflow.json` (sha256 `16f88439…c6c6b`) | s6001 t0, s6004 t0, t1 | 0, 0.957, 0.957 | `pass` | `check1` (Python AST signature check, cloned as `check2`) flags a correct default-value fix. The Opus `repair`, told to keep "defaults", reverts or hides the fix, and `answer` takes the first candidate whose check is ok | [F-haiku-codefix.md](../construction-20261006/diagnosis/F-haiku-codefix.md) |
| H-p1 | P1 `records-v3.mjs` `fhand-haiku` (built at 880c6b9) | d3/s5002 t1 | 0.945946 (fail) | `pass` | in map item `statuses:1/judge`, Haiku said `meaning: live, relation: none` for a void token. `STATUS_CHECKS` accept any meaning when the relation is "none" [D: `experiments/workflows/records-v3.mjs:1027-1038`] | [diagnosis-workflow-agent.md §(a)](../core-20261006/diagnosis-workflow-agent.md) |

What the records hold [M]:
- **C0 dev:** 16 F-haiku trials (8 per family), 768 journal rows for 96 runs.
- **Run stores:** only the 5 failed F-haiku trials kept theirs, because the runner deletes a passing trial's work dir
  [D: `experiments/lib/runner.mjs:86`].
- **P1:** 72 fhand trials, 1,863 journal rows; one kept store, the failure.

### 1.2 Engine pins

**Runtime: the frozen construction kit, verified [M].**
- Path: `/opt/foundry-kit/7e8f0f83153c5efb`.
- All 87 files under `src/ schemas/ policy/ skills/ bin/` have exactly the git blob ids of commit `880c6b9` (0 mismatches).
- `policy/models.json` is byte-identical to the repository's.
- When the probe started (14:59 UTC), the live tree already differed in 11 of those files (`engine`, `runtime`, `store`, `journal`, `validate`,
  `verdict`, `http`, `mcp`, `foundry`, the schema, the CLI) and had 4 files the kit lacks (`acceptance`, `audit`, `lint`,
  `verify-run`).
- Replay, counterfactuals and every verification run therefore import the kit, never `src/`.

**Gate closure: the strict lint and verdict rules, pinned [M].**
- The kit predates the strict lint. The heal gate pins three files by their blob ids at `13f7664`:
  `src/lint.mjs` `91ff528c`, `src/acceptance.mjs` `ac38bbdf`, `src/verdict.mjs` `91024959`.
- They are copied into `experiments/heal/pinned/src/` next to their only dependencies (`data.mjs` `ed35a490`, `dataflow.mjs`
  `21b708d0`, `models/policy.mjs` `fe2b4b91`). Those three are byte-identical in the kit and at HEAD, so the import paths stay
  untouched and every hash matches git.
- Tested in scratch: the pinned lint reproduces the retro-audit codes exactly on F-haiku records, F-haiku codefix and records-v3
  ([`research/lint-20261008/retro-audit.json`](../lint-20261008/retro-audit.json)). The pinned `verdictOf` re-derives `unverified` /
  `ACCEPTANCE_EXISTENCE_ONLY` for a succeeded run of each.

**One schema mismatch to carry.**
- The frozen schema has no `defaultClass`, `oracle` or `model.justification`. So `CLASS_ABOVE_DEFAULT_UNJUSTIFIED` cannot be cleared
  inside the IR of a frozen-schema workflow.
- The gate waives exactly that one warning when the proposal record carries the justification (§8, V1).
- At the E1 freeze both pins collapse into one engine, and the waiver ends.

### 1.3 Rules inherited, and where the design applies them

| Rule | Source | Applied in |
|---|---|---|
| Execution authority stays outside the model; edits are version-bound proposals applied by code, never inside a running run | AGENTS.md, ROADMAP §2.5 step 8, §3 last item | §7, §9 |
| Model ids only from the policy; no silent fallback, every escalation logged | ROADMAP §6.3 | §7.5 |
| Graders locked, held-out sealed, never weaken an oracle | ROADMAP §6.4, §2.6 anti-gaming | §8 V8, §11 |
| Run and task text is data, never instructions | ROADMAP §6.10 | §7.5 (untrusted excerpts) |
| No new subsystem without a pre-registered experiment; engine freeze for comparisons | ROADMAP §6.12, §6.13 | §12, §14 |
| Inspected seeds are development evidence | AGENTS.md | §1.1, §8 V7, §12 |

---

## 2. Feasibility probe ($0, measured)

`node experiments/heal/probe/feasibility.mjs --out research/heal-20261008/probe/feasibility.json` (10 min wall at load average about
8, $0).

How it ran:
- **Journals.** It copies each recorded journal with `VACUUM INTO` (originals opened read-only) to
  `/var/tmp/foundry-work/heal-probe/`.
- **Runtime.** It builds a `ModelPort` from the kit in mode `replay` with **no providers**, so any call missing from the journal
  fails with `REPLAY_MISS` instead of spending.
- **Re-execution.** It re-executes each trial with the C0/P1 session policy subset, the same workflow, the task regenerated from
  its seed (the task hash must match) and the arm's `sampleSalt` `${armId}:t${trial}`
  [D: `experiments/lib/arms/foundry-workflow.mjs:22`].

| Probe | Result [M] |
|---|---|
| Replay fidelity, C0 | 16/16 F-haiku trials (8 records, 8 codefix; 11 of them passing trials with deleted work dirs) reproduce task hash, oracle score, run verdict and model-call count exactly. 2.0–4.2 s per trial |
| Replay fidelity, P1 | d3/s5002 t1 reproduces score 0.945946, verdict `pass`, 18 calls; 8.8 s |
| Counterfactual, H-rec | `conf` pinned to its own output reproduces 0.789197 (identity control). 24 single-field flips (6 systems × {3 other date orders, sign}): **exactly one passes**, BRIGHTDESK `numeric_order` MDY→DMY, scoring 1.0. The rest score 0.577–0.789 |
| Counterfactual, H-cfx | Pin of `check1` with its reads dropped: `REPLAY_MISS` 4/4. With its reads kept: identity reproduced 4/4. Flip `check1.ok` false→true: **pass 1.0 on all 3 failed trials and on the lucky pass s6001 t1**, with 1 model call instead of 2 (the Opus `repair` is skipped) |
| Counterfactual, H-p1 | Injection of the recorded value reproduces 0.945946 (identity). `meaning` live→void: **pass 1.0**. `relation`-only flips stop with `REPLAY_MISS` after 9 calls (run verdict `harness_fault`). The substituted value fails `STATUS_CHECKS`, so the runtime asks for a class-L escalation the journal does not hold [I]: an *escalation-dependent* candidate |
| Fragility (oracle-free), H-rec | Each records trial × each MDY↔DMY or sign flip of `conf` (64 runs). Share of answer records that change: BRIGHTDESK 16–35%, ATLAS 22–48%, VENDEX 8.5–21% numeric-order flips; **on the 6 passing trials all 18 of these flips fail the oracle**. LEDGR flips change 0% (8/8) and still pass (6/6). Sign flips change 0–36% (10 of 48 change nothing) |
| Check vacuity, H-p1 | Status judgments taking `relation: "none"` (where `meaning` is unchecked): fhand-haiku **59/90** (28 live, 31 void), fhand-sonnet 54/90 |
| Cost profile, H-cfx | One-call trials: $0.082–0.093 and 20.6–22.9 s (4). Two-call trials: $0.179–0.355 and 58.0–69.3 s (4). All four two-call trials carry the `check1` false flag; one passed. Records: s6004 t1 $0.1018 (an id-echo check escalation that worked) vs $0.029–0.032 |

**Pitfalls the probe exposed, and what the design does about them.**
- **P-1, taint labels on pins [M].**
  - What happens: a pinned node that reads nothing produces a `trusted` output. The original read `untrusted:repo` data, and the
    `repair` prompt renders that label with the untrusted preamble [D: kit `src/context.mjs:34-40, 64`]. So the downstream prompt
    hash changes and replay misses.
  - Rule: a pin keeps every ref the original read (code `args`, or agent `context.inputs`), and every node's identity pin must
    reproduce the original run before any of its counterfactuals count.
- **P-2, the replay key omits the node id [I].**
  - What happens: the key is `digest({promptHash, modelId, modelDigest, decoding, sampleIndex, salt})`
    [D: kit `src/models/port.mjs:45, 176`], and `lookup` takes the newest row for a key [D: kit `src/journal.mjs:56`].
  - Consequence: two sibling agents with identical prompts would share a key. In `replay-or-live` verification the second sibling
    replays the first's sample, so the agreement is vacuous. In live mode they are distinct calls.
  - Rule: the k-sample operation gives each reader a distinct reader tag in its instructions, and V3 counts distinct journal rows
    per sibling.
- **P-3, escalation-dependent candidates [M].**
  - What happens: a substitution that fails the node's own checks triggers an escalation whose call is not journaled.
  - Rule: localisation marks the candidate `needsLive` and evaluates it only within the live budget (§6.7).
- **P-4, replay writes rows [D].**
  - What happens: replay records a row per call [D: kit `port.mjs:187-193`], and injection inserts rows.
  - Rule: all of it happens on copies. Each verification replica gets its own fresh copy (§8), so changed nodes miss and go live
    while unchanged nodes hit.

---

## 3. The loop at a glance

```
 run index (06b) ─┐   results.jsonl, journals, stores, lint, probes
                  ▼
  DETECT ── typed signals ──► CLASSIFY ── workflow defect ──► LOCALISE (replay + counterfactuals, $0)
    │  refuse sealed            │ flake / env / variance             │ ranked suspects, defect class
    │                           ▼                                    ▼
    │                     allocator ops only               PROPOSE  (mechanical lint-debt ops by code;
    │                                                          model ops by the proposer node, M → L → F)
    │                                                                │ typed ops + lineage
    │                                                                ▼
    │                                                      VERIFY  V0…V8 (code; replay, fresh tasks)
    │                                                                │ verification record
    │                                                                ▼
    │                                                      PROMOTE (pure gate, CAS, shadow, rollback)
    │                                                                │
    └──────────────── LEARN ◄────────────────────────────────────────┘
                       lesson proposals → owner/frontier review → next kit hash → constructor
```

| Step | Who decides | Model involvement |
|---|---|---|
| Detect, classify, localise | code | resampling the top suspect (K = 8, budgeted) is the only model spend |
| Propose | proposer node outputs typed ops; code compiles them | Haiku 5.5, then Sonnet 5.5, then Opus 5.5 by policy class; every escalation is an event |
| Verify, promote, rollback | code (pure gate function) | changed nodes run live inside verification replays and fresh tasks, as the workflow itself defines them |
| Learn | code drafts the lesson and scores it; a reviewer accepts | optional proposer call to draft template prose |

---

## 4. DETECT

A signal is a typed record (`heal-signal/1`):
`{kind, workflow:{id, hash}, run?:{runId, taskKey, trial, armId, fidelity}, node?, split, oracle: present|absent, evidence:[refs], at}`.
Signals from `sealed-*` families or sealed splits are **refused at intake** and logged, never stored. Signals are grouped into
*incidents* by `(workflow hash, suspected locus)`, so one defect seen in 3 trials becomes one incident.

| Signal | Source | Needs an oracle? | Threshold (frozen per pre-registration) | Fired here |
|---|---|---|---|---|
| `CHECK_FAILED` / `ESCALATED` | run events, journal `model_id` changes | no | any | H-rec s6004 t1 (true positive, see §5) |
| `ORACLE_FAILED` | results line `pass: false` | yes (beds, dev) | any | all 6 failed trials |
| `VERDICT_ORACLE_MISMATCH` | results `meta.verdict` vs `pass`, both directions | yes | any. Run-history survey: 19 of 448 verdict-`pass` trials failed their oracle [D: 06b §0.3] | all 6 failed trials |
| `UNVERIFIED_VERDICT` | pinned `verdictOf` re-derived on the stored workflow | no | `unverified` or `inconclusive` | every run of all three workflows (acceptance is existence-only) |
| `LINT_FINDING` | pinned strict lint | no | any error. These warnings trigger a fragility probe: `GLOBAL_READ_UNGUARDED`, `ESCALATION_WITHOUT_CHECKS` | H-rec (3 errors, 2 warnings), H-cfx (1 error, 1 warning), H-p1 (11 errors) |
| `FRAGILE_READ` | counterfactual flip on a *passing* run (replay, $0) | no | a single enum flip of a root-level model read changes ≥ 5% of answer items and the node has no guard | H-rec: BRIGHTDESK, ATLAS, VENDEX orders on all 6 passing trials |
| `CHECK_VACUOUS` | check-trace over journaled outputs: for each output, did any check constrain the field downstream reads? | no | the decisive field is unconstrained in > 25% of outputs | H-p1: 59/90 |
| `CHECK_MODEL_DISAGREEMENT` | a check flagged a candidate, and the repair or escalation returned it unchanged or argued against the check | no | any | H-cfx s6001 t1 (the Opus repair is byte-identical to the flagged fix) |
| `COST_OUTLIER` / `LATENCY_OUTLIER` | per-run cost or latency vs the same workflow hash, n ≥ 6 | no | > 1.5 × the 25th percentile | H-cfx: all 4 two-call trials ($0.179–0.355 vs p25 ≈ $0.087); H-rec s6004 t1 |
| `BUDGET_BREACH` | `maxCost`/`maxDurationMs` hit, `costUnknown` calls | no | any | none |
| `PROBE_REGRESSION` | re-running the version's construction probes after a kit, model or engine fingerprint change, or after a promotion | probe oracle | any probe that passed before fails | none (24/24 probes passed in C0 dev) |

Detection precision matters as much as recall. A signal is a reason to look, not a reason to patch. The classifier (§5) separates
the escalation that worked (H-rec s6004 t1: Haiku dropped a row, the exact id-echo check fired, Sonnet redid the batch) from the
check that was wrong (H-cfx).

---

## 5. CLASSIFY

ROADMAP §2.6's classifier, with two changes: localisation runs before resampling, because it is free and tells which node to
resample, and replay fidelity comes first.

1. **Replay fidelity.** Strict replay on a journal copy must reproduce the record: full fidelity means node outputs equal to the
   kept store; score-only fidelity means answer and oracle score equal. Otherwise `REPLAY_INFIDELITY`: blocked, never healed.
   Causes are a changed engine, policy or bed, a missing journal, or non-deterministic code.
2. **Environment.** The run met an environment fault (`MODEL_RATE_LIMIT`, `MODEL_UNAVAILABLE`, `SANDBOX_UNAVAILABLE`, executor
   faults; [D: `experiments/lib/runner.mjs:19`]), or the environment fingerprint differs from the last passing run → `env`. No heal.
3. **Contract.** The bed's reference answer fails the workflow's own acceptance or checks → `contract-unsatisfiable`, to the owner.
4. **Working as designed.** The signal is a check failure whose escalation produced output that differs exactly in the checked
   property and then passed (H-rec s6004 t1). Logged as allocator data, with no patch.
5. **Localise** (§6). If no suspect is found, the class is `unknown` and the incident goes to the owner with the localisation
   record.
6. **Variance or bias.** Resample the top suspect node K = 8 at the same upstream state, live for that node only (everything else
   is replayed). Compute the Wilson lower bound of the rate at which samples take the counterfactual-passing value.
   - If it is above τ = 0.2, the class is `model-variance`: only allocator operations are allowed (k-sample agreement, escalate
     class), no prompt or check edit.
   - Otherwise the class is `workflow-defect`: any operation.
   - Cost: about $0.03 for `conf` on Haiku, under $0.01 for one P1 status item [I from the journaled per-call costs].
7. **Regression of an earlier heal.** If the lineage has a parent version, run the parent on the same task. A failure that is new
   on version N but absent on N−1 opens a rollback candidate for the last heal (§9).

---

## 6. LOCALISE

### 6.1 Replay harness

`experiments/heal/replay.mjs` re-creates a recorded run on the kit with:
- the same workflow body, regenerated task input, `sampleSalt` and session policy subset;
- a `ModelPort` over a fresh `VACUUM INTO` copy of the journal.

Modes:
- `replay` for localisation, which can never spend;
- `replay-or-live` for verification, where changed nodes miss and are called live and journaled into the copy.

All workspaces are under `/var/tmp/foundry-work/heal/`, outside the repository.

### 6.2 Substitution mechanisms

| Mechanism | How | Use when | Control |
|---|---|---|---|
| **Pin** | Replace node `n` by a JS code node with the same id and `needs`, whose `args` are every ref `n` read, returning a constant. For a node inside a map body, the constant is a table keyed by item index (recorded value for every item but the substituted one) | code nodes; agent nodes at root level | identity pin reproduces the run (P-1) |
| **Inject** | Insert a newer journal row with the same replay key and a substituted `response.value`, tagged `heal.counterfactualOf` (copy only) | agent nodes, especially inside maps (H-p1) and nodes with checks or escalation that must still run on the substituted value | identity injection reproduces the run |

Injection keeps the node's own checks live, which is how the probe found that H-p1's `relation` flips need an escalation (P-3).

### 6.3 Candidate generators (no oracle truth is used to generate candidates)

1. **Enum and boolean flips.** Every enum or boolean leaf of the node's `returns` schema takes each other value, one at a time.
   Fields read by downstream refs come first; code nodes read whole objects, so all fields are kept. Cap: 64 per node.
2. **Recorded alternatives.** The same node's output in sibling trials of the same task (another salt), and earlier samples or
   escalations of the same call in the journal.
3. **Pass-through.** A type-compatible upstream value replaces a downstream one (`repair.patched_source := fix.patched_source`).
   Used for localisation only, never as a root.
4. **Stronger class** (`needsLive`). The same prompt on the next class up. Spent only if 1–3 find no flip.
5. **Resample** (`needsLive`). K samples at the same class. This is the variance test of §5 step 6.

### 6.4 Scoring each candidate run
- **Oracle** (dev beds only, through the locked bed module): pass, score, and the typed details the bed already returns in
  `oracleDetails`.
- **Oracle-free:**
  - run status and pinned verdict;
  - which checks fired;
  - escalations needed;
  - share of answer items that change against the base answer (canonical JSON per item);
  - model calls and cost.
- **Intermediates of answer type** (dev only): any node whose output has the answer's schema is scored by the oracle too. This is
  how the codefix diagnosis saw that `fix` was already correct.

### 6.5 Ranking and the root
1. A *flipper* is a candidate whose single substitution turns oracle-fail into pass (dev), or the run verdict or acceptance from
   pass to fail (oracle-free: a guard would have caught it).
2. The **root** is the earliest flipper in topological order whose candidate is type-plausible: an enum or boolean flip, a
   recorded alternative, or a stronger-class output. Pass-through flips and the sink (`answer`) never count as roots.
3. Confidence:
   - **high**: exactly one node has flippers (H-rec: 1 of 24; H-p1);
   - **medium**: several nodes flip but one is upstream of all the others (H-cfx: `check1` is upstream of `repair` and `answer`);
   - **low**: anything else.
4. **Low confidence** runs delta-debugging over pairs of candidates (at most 64 runs, ROADMAP §2.6 step 6). If that is
   inconclusive, the class is `unknown`.

### 6.6 Defect classes (decided by rules over the localisation record)

| Class | Rule | Here |
|---|---|---|
| `UNGUARDED_GLOBAL_READ` | root is a root-level model read that conditions every item; no check reads the flipped field | H-rec `conf` |
| `CHECK_ESCAPE_HATCH` | root is a model node with checks. The checks held on the recorded output through a disjunct that does not read the flipped field (check-trace) | H-p1 `statuses/judge` (`relation == "none"`) |
| `OVERSTRICT_CHECK` | root is a code check whose boolean flip passes, and (dev) the candidate it flagged passes the oracle, or (oracle-free) `CHECK_MODEL_DISAGREEMENT` | H-cfx `check1` (clone group with `check2`) |
| `CHECK_VETO_ROUTING` | `OVERSTRICT_CHECK`, and the false flag routes through `when` to a node whose output replaces the candidate | H-cfx (`repair`, `answer` first-ok rule) |
| `CODE_NODE_DEFECT` | no upstream flip fixes it; the code node's inputs score as correct (intermediates) and its output does not | none |
| `ACCEPTANCE_NOT_GATING` | lint errors `ACCEPTANCE_EXISTENCE_ONLY`, `VERIFY_NOT_GATING`, `ERROR_COLLECTION`, `ERROR_CONTINUATION` | all three (lint debt) |
| `MODEL_VARIANCE`, `MODEL_CAPABILITY` | §5 step 6; or no class within `maxClass` produces the passing value | to be measured |
| `UNKNOWN` | no root | none |

### 6.7 Output and budget

The localisation record is `heal-localization/1`:
- base hash and replay fidelity;
- every candidate with its outcome;
- ranked suspects with class, confidence and evidence ids.

Budget:
- replay-only candidates are $0, about 2–9 s each, run in parallel workers with one journal copy each;
- `needsLive` candidates and resampling have a $0.10 cap per incident;
- wall time is capped at 10 min.

---

## 7. PROPOSE

### 7.1 Patch operations (closed set; code compiles each to an IR edit on the frozen schema)

| Op | Fields | Compiles to | Fixes | Auto-promotable |
|---|---|---|---|---|
| `add_evidence_field` | node, field name, max length, appended instruction text, check kind (`quote_in_input` / `mention_in_quote`), input ref | a required string field in `returns`; instruction appended; checks `contains <input> output.<field>` (+ mention) | unguarded reads | yes |
| `k_sample_agreement` | node, k ∈ {2, 3}, compared fields, `onDisagree` ∈ {escalate, fail} | k sibling agents (same role, schema, inputs; distinct reader tag, P-2) plus a code `agree` node; downstream refs move to `agree`; a failed agreement escalates the node class through a `when` branch or fails the run | unguarded reads, variance, escape hatches | yes |
| `escalate_class` | node, class, maxClass | `model.class`/`maxClass` from the policy order; justification kept in the proposal record (frozen schema, §1.2) | capability, global reads | yes up to L; F needs owner review |
| `add_check` | node, structured condition, `onCheckFail` | appends to `checks`, or adds an `assert` node | escape hatches, missing guards | yes |
| `tighten_check` | node, check index, new condition | replaces a check. Code verifies that the new check implies the old on the typed domain (enumerated enum space plus all recorded outputs) and rejects ≥ 1 recorded wrong output | escape hatches | yes |
| `relax_check` | node or clone group, new condition or source, justification `{excerpt id, quoted span}`, false-positive run ids | replaces a check or code source | over-strict checks | **only** with an oracle (dev): V2b's mutant proof, the quoted span verified as a substring of the task's own contract input, and every false-positive candidate accepted by the oracle. Otherwise owner review |
| `patch_code_node` | node or clone group, failing assertion `{fixture, property}`, new source | replaces `source`. The new source must satisfy the assertion and agree with the old source on every recorded input except those listed | code defects, over-strict code checks, selector rules | yes, if no check is weakened (V2) |
| `edit_instructions` | node, `append` or `replace_sentence` (the quoted old sentence must exist verbatim), text | prompt delta | contradictory prompts (H-cfx "same … defaults") | yes |
| `add_probe` | probe kind (`fragility`, `value_coverage`, `documented_legal_edit`), spec | the workflow's probe suite, not the IR. Used by V4 and re-qualification | all | yes |
| `gate_verify`, `gate_failed_count`, `strengthen_acceptance`, `gate_continuation` | from the lint finding's `repair.action` | `gate: true`; acceptance `eq nodes.M.failed 0`; acceptance on a gating verify or assert | lint debt | yes (mechanical, §7.4) |

**Forbidden: no operation exists for them, and V2 rejects them in any form:**
- deleting a node or a check, or removing or weakening an acceptance predicate;
- `gate: true → false`, `failure: fail → collect`, `onError → continue`;
- lowering `maxEscalations`/`maxClass`;
- declaring `oracle: none`, declassifying labels, changing `inputSchema`;
- adding tools, capabilities or effects;
- raising budgets beyond the bound in V6.

### 7.2 Locus and version binding
- **One defect locus per proposal (R-16's "a patch to one node").** A locus is one node, or a *clone group*: nodes with
  byte-identical source or instructions, such as `check1`/`check2` [M: identical 4,710-byte sources]. Treating a clone group as
  one node is an interpretation of R-16 that the owner should confirm (§14). Lint debt goes in its own proposals.
- **Each proposal (`heal-proposal/1`) binds:**
  - `base: {workflowId, hash, kitHash: 7e8f0f83153c5efb, lintPin: {13f7664, blob ids}, policyHash}`;
  - `incidentId`, `parentId`, `lineageId`, `depth`;
  - `ops`, `candidateHash`;
  - `proposer: {modelId, class, journalIds, briefHash}` or `{mechanical: ruleCode}`;
  - `rationale` (≤ 1,200 chars), `citations` (fact and excerpt ids), `status`.
- **Lineage limits:** depth at most 3, as in the existing repair lifecycle [D: `docs/REPAIR-LIFECYCLE.md`], and one open proposal
  per lineage at a time (compare-and-swap on the lineage head).

### 7.3 Order within an incident
1. **Lint-debt proposals first.** They are mechanical, and V1 cannot pass while lint errors remain: all three base workflows have
   `ACCEPTANCE_EXISTENCE_ONLY` [M].
2. **Then the defect proposal on the localised root.**

A lint-debt proposal is verified like any other. Gating `failed == 0` can turn an oracle-pass run into a failed run, and V4 counts
that as a false alarm.

### 7.4 Mechanical proposals

The lint's `repair.action` codes are stable [D: `docs/LINT.md`], so these proposals come from code with no model:

| `repair.action` | Proposal |
|---|---|
| `gate-verify` | `gate_verify` |
| `gate-failed-count` | `gate_failed_count` |
| `gate-continuation` | `gate_continuation` |
| `strengthen-acceptance` | add `eq nodes.<verify>.pass true` when a gating, independent verify exists; otherwise the proposer must supply a check that a wrong answer can fail |

### 7.5 The proposer node

The proposer is itself a Foundry workflow run on the kit (`experiments/heal/proposer.workflow.mjs`): one `agent` node with a
schema-constrained `returns` (the op table as a flat object with an `op` enum, validated again by code). Its node checks are:
- every `op.node` is in the allowed locus;
- every citation id exists in the brief;
- `replace_sentence` quotes text that exists verbatim.

On a check failure the runtime escalates (E1/E2).

**Model ladder** (ids resolved by class from `policy/models.json`, journaled through the kit's `ModelPort` and claude-cli
provider, journal at `experiments/heal/runs/<round>/journal.sqlite`):
- rounds 1–2: class M, Haiku 5.5;
- round 3: class L, Sonnet 5.5;
- round 4: class F, Opus 5.5.

A gate rejection moves the next round up one rung only after two M rounds. Each move is a `heal.proposer_escalated` event. There is
no silent fallback.

**The brief (`heal-brief/1`)** is what the proposer sees. Typed facts, trusted because heal code computed them:
- incident signals (codes and counts);
- the defect class and the localisation table (node, field, from → to, Δscore, answer-changed share, `needsLive`);
- the check trace;
- lint codes, paths and `repair.action`;
- the allowed ops for this class;
- the locus;
- prior rejected attempts as gate codes only;
- the budget.

Workflow text, labelled `constructed` (a builder model wrote it):
- the full IR of the locus and its one-hop neighbours;
- id, kind, role and `needs` of every other node.

At most 6 **quoted untrusted excerpts**, each ≤ 600 chars, JSON-encoded, labelled `untrusted:run-data`:
- the input span the localised node read, for example the BRIGHTDESK paragraph;
- its recorded output;
- the check result.

The kit's context compiler wraps them in its untrusted preamble [D: kit `src/context.mjs:64`]. The cookbook of op examples comes
only from **other families** (a synthetic toy family written for this purpose; R-14's source firewall), with provenance labels.

**It never sees:**
- oracle code, hidden truth or bad controls;
- fresh-task inputs or results (only the gate's reject code reaches it);
- other incidents' excerpts;
- anything from a sealed family.

The proposer has no tools. Its output is data that code compiles; its rationale is never executed.

---

## 8. VERIFY (all code; cheapest first; the first failure stops the run and returns a reject code)

| Stage | What | Pass rule | Cost |
|---|---|---|---|
| **V0 static** | op schemas; compile on the kit (`validateWorkflow`, frozen schema); locus rule; forbidden-op scan; literal-leak scan (§11.3); declared budget ≤ 1.25 × base | all hold | $0, < 1 s |
| **V1 strict lint** | pinned `lintWorkflow` | zero errors. No new warning compared with the base, except `CLASS_ABOVE_DEFAULT_UNJUSTIFIED` when the proposal carries its justification (frozen schema). A heal of a node named by `GLOBAL_READ_UNGUARDED` or `ESCALATION_WITHOUT_CHECKS` must clear that finding | $0 |
| **V2 no weakening** | rule `HEAL_ACCEPTANCE_WEAKENED` over canonical forms of base and candidate. See V2a and V2b below | all hold | $0, plus about 1 s per mutant |
| **V3 failing case** | each failing run re-executed `replay-or-live` on its **own fresh journal copy per replica**, K = 3 replicas: unchanged nodes replay, changed nodes and anything downstream whose prompt changed go live | dev: oracle passes 3/3. Without an oracle: the run verdict is no longer `pass` (the failure is now *caught*) | H-rec about $0.04, H-cfx about $0.5, H-p1 about $0.01 [I] |
| **V4 regression slice** | every previously passing recorded run of the base version (test-inspected trials and construction probes: H-rec 6 + 3, H-cfx 5 + 3, H-p1 35), K = 1, `replay-or-live` | zero oracle regressions. A regression is re-run K = 3 and counts unless 3/3 pass. Verdict false alarms (new verdict fails where the oracle passes) ≤ max(1, 5%) | H-rec about $0.1, H-cfx about $1, H-p1 about $0.1 [I] |
| **V5 acceptance discrimination** | the bed's `badControls` and `referenceSolve` outputs are pinned at the `answer` node; acceptance, gating verifies and asserts downstream are re-run | the reference is accepted. The candidate rejects every control the base rejected, and at least one | $0 (code), or the live calls of an agent verify |
| **V6 cost and latency** | from V3, V4 and V7 | mean cost ≤ 1.25 × base (or the increase the proposal declared, at most 1.5 ×), and p95 latency ≤ 1.25 × base | none |
| **V7 fresh tasks** | 12 fresh dev seeds per family and difficulty, K = 2, **paired**: base and candidate on the same tasks, same salts, live. Seeds come from the seed ledger (§8.1). Stratified oracle-side, so that the localised field takes each of its values on at least 3 tasks (for H-rec: BRIGHTDESK DMY and MDY) | candidate passes ≥ base passes. No task where the base passes 2/2 and the candidate 0/2. The localised stratum does not get worse. Only an accept/reject code returns to the proposer | H-rec about $2, H-cfx about $6.5, H-p1 about $0.8 [I] |
| **V8 locked graders** | sha256 of each bed module the oracle loads (`beds/<family>/*.mjs`, `harness.py`) before and after; of the pinned lint and verdict files; of the kit | unchanged | $0 |

**V2 in detail.**
- **V2a, nothing is loosened.** The set of acceptance predicates and gating checks is a superset of the base's, or each changed
  item is proven to imply the old one. Verify `gate` is never true → false, `failure` never fail → collect, `onError` never
  stricter → `continue`, escalation is never reduced, and labels are never declassified. Any `relax_check` must carry V2b.
- **V2b, mutant proof for a relaxed check.** The relaxed check still kills every mutant in the check's mutant battery except the
  justified class. The battery is generated by code from the old check's own failure modes; for an API check: renamed, reordered,
  removed and added required parameters, and a changed number of defaults.

**Thresholds.** The thresholds above are starting values. They are frozen in the EX1 pre-registration before any proposer output
is scored.

### 8.1 Fresh seeds and the seed ledger
`research/heal-20261008/seed-ledger.json` records, per family, split and difficulty, every seed ever consumed and by what:
- C0 probes: dev 1–3 d3;
- records-v3 development: dev 101–160 [D: `experiments/workflows/records-v3-dev.mjs:36`];
- Kev data worlds: 3 distinct records dev seeds referenced, between 101 and 401 [M];
- the bed audits;
- C0 test 6001–6004, P1 test 5001–5006;
- each heal lineage's fresh draws.

| Use | Pool |
|---|---|
| heal development (this design's three incidents) | records dev d3/d4 seeds 1001–1100; codefix dev d3 1001–1100 |
| EX1 | 2001+ |

Codefix fresh tasks are also deduplicated by `build().reference` hash against every task already used, because of the
dev/test overlap at d1–d3 (AUDIT F2, [D: `beds/codefix/README.md:255-258`]). A seed that reached any gate is never fresh again.

---

## 9. PROMOTE and ROLLBACK

**Gate.** `gate.mjs` exports a pure function `decide(verification, policy) → {decision, reasons[]}`. It is deterministic and
unit-tested on fixtures. The decisions are:
- `promote` (every stage passed and the ops are auto-promotable);
- `owner-review` (every stage passed, but an op needs review: `relax_check` without an oracle, `escalate_class` to F, cost
  increase > 25%, any change to acceptance beyond the mechanical lint-debt forms);
- `reject` (a stage code);
- `exhausted` (round or budget limit reached).

**Write.** On `promote`, code saves the candidate with `Store.saveWorkflow(workflow, {expectedHash: lineageHead})` on the kit
(compare-and-swap [D: kit `src/store.mjs:75-82`]) in the heal workspace store, and appends one line to
`research/heal-20261008/lineage.jsonl`. The line records the proposal, the verification digest, the decision, the parent hash and
the new head. A lost compare-and-swap (`STALE_WORKFLOW`) means another heal moved the head: the proposal is re-verified on the new
head or dropped.

**Scope of a promotion.**
- Frozen artifacts (`research/construction-20261006/artifacts/`, P1's builder at 880c6b9) are never edited.
- A promoted head is the version future heal-scoped runs use.
- A comparative experiment uses it only if a new pre-registration names its hash (ROADMAP §6.13). Healing never changes a running
  run or a pre-registered arm.

**Shadow and circuit breaker.**
- For the next M = 10 dev tasks (or real uses), the new head runs alongside its parent. The cost is counted under the heal budget.
- Rollback to the parent hash (compare-and-swap) is automatic when any of these holds:
  - 3 consecutive failures;
  - success ≤ 0.5 after ≥ 5 uses;
  - verdict-vs-oracle mismatches above the parent's;
  - a probe regression;
  - a canary (V5 control) newly accepted.
- These are ROADMAP §2.7's demotion rules applied to one lineage.
- The owner can roll back by hand at any time: `node experiments/heal/cli.mjs rollback <lineage> --to <hash>`.
- A rolled-back proposal's pattern stays in the lesson queue, marked `rolled_back`.

**Re-qualification.** A change in kit, model policy or engine fingerprint (for example the E1 freeze) re-runs V4 and the probes on
every promoted head before it serves again (ROADMAP §2.7).

---

## 10. LEARN

Every promoted heal, and every incident localised with confidence high or medium even if unhealed, yields a lesson record
(`heal-lesson/1`) in `research/heal-20261008/lessons/<id>.json`. It holds:
- the pattern: defect class plus a structural signature;
- a **lint rule spec**, with a reference implementation in `experiments/heal/lessons/rules/<code>.mjs` (a pure function over the IR,
  the pinned lint's finding shape);
- a **template or cookbook diff** for `skills/micro-harness` (text, not applied);
- a **probe requirement**;
- measured **firing**:
  - it must fire on the base;
  - it must not fire on the healed head;
  - its count over the workflow population: the 4 C0 F artifacts, records-v3 and the test-suite workflows (393, the population
    the control-taint check counted [D: README Layers table]). A rule that fires
    widely on workflows that work is downgraded to a warning or dropped.

Status moves `proposed → accepted | rejected` by an owner or frontier reviewer. An accepted lesson reaches the constructor only
through a **new kit hash** built by `experiments/lib/kit.mjs`, never by editing a frozen kit or `skills/` in place. A lesson used
in a sealed round is frozen before that round.

| Lesson | From | Lint rule (proposed) | Template / probe |
|---|---|---|---|
| L-1 conventions-once | H-rec | Exists as warnings (`GLOBAL_READ_UNGUARDED`, `ESCALATION_WITHOUT_CHECKS`). Proposed: `FRAGILE_GLOBAL_READ`, an error when a construction-time fragility probe measures ≥ 5% answer change for an unguarded read | Global reads get evidence quote + check, an explicit "a worked example decides" rule, and k = 2 agreement or class L. Probe rule `PROBE_VALUE_COVERAGE`: across the construction probes each enum field of a global read takes ≥ 2 values, or the construction record lists it as an untested branch. The C0 probes all had BRIGHTDESK = MDY [D: F-haiku-records.md "Why nothing caught it"] |
| L-2 checks encode the contract | H-cfx | `CHECK_VETO_UNGATED`: a heuristic code check whose `false` routes by `when` to a node that produces a replacement candidate, while the selector takes the first ok candidate and no gate compares the two | Each code check ships a self-test: a documented-legal change, cited from the task's own contract text, must pass. Selectors prefer the earliest candidate that passes the *gating* checks. Repair prompts may not forbid what a named defect class requires. The probe set should cover each defect operator the task family names |
| L-3 no self-exemption | H-p1 | `CHECK_SELF_EXEMPTION`: an `any` in a node's checks has a branch that reads only model-chosen fields and not the decisive field downstream reads | Decisive fields get an unconditional check or a second independent read. The check-vacuity rate becomes a construction metric (59/90 here) |

L-1's existing warnings came from the same artifacts, so firing on them describes those artifacts and predicts nothing
[D: `docs/LINT.md`, last paragraph of Rules]. The same caveat applies to L-2 and L-3 until they fire on artifacts built after
they were frozen.

---

## 11. Limits, anti-gaming and budgets

### 11.1 What cannot be healed
- **No signal, no heal.** A wrong answer that trips no check, has no oracle and no verdict mismatch, costs nothing unusual and
  hangs on no fragile read is invisible. One example is a single mis-extracted row that nothing reads twice. Fragility and vacuity
  probes shrink this set, but they measure sensitivity, not wrongness.
- **Oracle-less overfitting.** Without an oracle, "the failing case now passes" can only mean that the workflow's own guards now
  hold, which is teaching to the test. So, when no oracle exists:
  - heals may only add guards (`add_*`, `tighten_check`, `k_sample_agreement`, `escalate_class`), never relax;
  - V3 requires the failure to be *caught*, not fixed;
  - the head is marked `healedWithoutOracle`, and its runs keep the `unverified` ceiling.
- **Capability.** If no class within `maxClass` produces the passing value, the outcome is `MODEL_CAPABILITY`: escalate to the
  owner, or hand the task back to selection ("no workflow").
- **Missing evidence or a broken contract.** Information absent from the inputs, or a contradictory task contract, goes to the
  owner.
- **Faults that are not workflow defects.** Harness, environment and oracle faults belong to their own owners.
- **Interacting defects.** Defects that only show in combination beyond pairs stay `unknown` (§6.5).
- **Replay infidelity.** A changed engine, policy or bed blocks healing. After E1, if E1 changes replay identity, the C0/P1
  lineages stay healable on the frozen kit only.
- **Small samples.** V7's 12 × 2 paired tasks are directional. A promoted heal is *development-qualified*; it supports no
  capability claim.
- **These three cases.** They are inspected and were diagnosed by hand. Healing them proves the plumbing, not the rate.

### 11.2 Anti-gaming (all code; each violation is a reject code)

| Code | Rule |
|---|---|
| `HEAL_CHECK_REMOVED`, `HEAL_ACCEPTANCE_WEAKENED`, `HEAL_GATE_LOOSENED` | V2a; there are no ops for these, and the canonical diff is checked anyway |
| `HEAL_RELAX_UNPROVEN` | `relax_check` without its quoted contract span, mutant proof or oracle evidence |
| `HEAL_LITERAL_LEAK` | §11.3 |
| `HEAL_LOCUS_EXCEEDED` | ops touch nodes outside the locus or clone group |
| `HEAL_FORBIDDEN_FIELD` | `oracle`, `labels`, `inputSchema`, tools or capabilities, budgets beyond the bound |
| `HEAL_GRADER_CHANGED` | V8 |
| `HEAL_CANARY_ACCEPTED` | V5 regression; quarantines the lineage |
| `HEAL_CODE_UNSAFE` | a proposed code source imports outside the allowlist (`node:` built-ins needed for pure computation), touches the file system or network, or uses dunder or `eval`-like escapes. It runs only in the kit sandbox |

Information limits:
- The proposer gets accept/reject codes from V7, never details (ROADMAP §2.6: "send back only an accept/reject bit").
- A rejected round consumes its fresh seeds.
- At most 4 rounds per incident and one open proposal per lineage.

### 11.3 Literal-leak scanner (`experiments/heal/scan.mjs`)

**Index.** The scanner (never the proposer) builds an index from:
- the failing tasks' prompts, inputs and files;
- their recorded node outputs;
- the bed's hidden truth and reference for those tasks.

**What is scanned.** Every string the patch *adds*: instructions, code sources, check constants, enum lists.

**Rules.** An added string is a leak when any of these holds:
1. a normalised substring of ≥ 12 characters occurs in the index but not in the base workflow or in the family's public
   description and input schema;
2. a numeric literal of ≥ 3 digits equals a row id, seed, amount or date component of a failing task;
3. an (identifier, value) pair within 40 characters matches a hidden-truth assignment of a failing task, for example
   `BRIGHTDESK … DMY`, unless the same pair holds on all of 50 dev seeds of the family (a family constant, not a task variable);
4. a code literal table has more than 8 entries drawn from the index.

**Backstop.** V7's stratified fresh tasks catch what the scanner misses: a hard-coded convention fails the other stratum.

### 11.4 Budgets

| Item | Cap | Estimate for the three dev incidents [I] |
|---|---|---|
| Localisation (live candidates, resampling) | $0.10 per incident; 10 min | about $0.05 total |
| Proposer | per round: M $0.02, L $0.15, F $0.60; 4 rounds | about $0.02–0.3 (Haiku at about $0.003 per brief of 6–8K tokens) |
| V3 + V4 replays | $2 per proposal | about $1.8 |
| V7 fresh tasks | $10 per proposal | about $9.3 (H-rec $2, H-cfx $6.5, H-p1 $0.8; 48 runs each) |
| Shadow (M = 10) | $3 per promotion | about $2–3 |
| Per incident, total | $12 | about $10–14 for all three |
| Heal development, total | $30 | within EX1's $15–30 (synthesis §3.5) |

Spend goes to the heal journals and a results file, with `costUnknown` calls charged at their bound (the P1 lesson
[D: diagnosis-workflow-agent.md (d)]).

---

## 12. Mapping to the roadmap

| Roadmap item | How heal satisfies it |
|---|---|
| **C3** repair (ROADMAP §4.1): "classify → intervene → patch → replay recovers more failures than retry or regeneration at equal budget, with no more regressions" | Heal *is* that pipeline: §5 classify, §6 localise and intervene, §7 patch, §8 replay. Its falsifier (§4.3: does not beat retry or regeneration, or adds regressions) is EX1's kill rule below. Primary evidence: natural failures. Secondary: injected faults (ROADMAP §5.4 exit) |
| **R-16** (§2.5 step 8): "version-bound proposals: a patch to one node, proven by replay of the failing run plus a regression slice, applied by code, never inside a running run. Smoke runs replay unchanged nodes" | §7.2 version binding and locus; §8 V3 and V4 (`replay-or-live`, unchanged nodes replayed); §9 code-only apply; no op exists for a running run. The clone-group reading of "one node" is flagged for the owner |
| §2.6 classifier | §5, re-ordered (fidelity first, localise before resample) |
| §2.6 L3 gates: "failing case passes K replays; regression slice non-inferior; held-out at least as good; oracle hashes untouched; canaries do not improve" | V3 (K = 3); V4; V7 (fresh, paired); V8; V5 (bad controls as canaries) |
| §2.6 "no global evolution step; an offline proposer may suggest L3 patches from pooled failures" | One lineage at a time; incidents pool trials of one workflow hash only |
| §2.6 anti-gaming (locked graders, oracle-string scans, accept/reject bit, canaries, LLM auditors never feed fitness) | §11.2–11.3; the proposer's rationale never feeds a gate |
| §3: no runtime self-modification by small models | Haiku proposes offline; code applies after replay |
| §2.7 promotion, demotion, re-qualification | §9 shadow, circuit breaker, re-qualification |
| §6.12: no new subsystem without a pre-registered experiment | Heal stays in `experiments/heal/` as EX1's harness. It moves to `src/` only after EX1 passes its kill rule and E1 is frozen |
| §6.13 engine freeze | Heal runs on the frozen kit; E1 re-pins it |
| THESIS D9: "Haiku 5.5 … edits by replay-proven proposals" | The model ladder in §7.5 |
| Lane 6b run history | Heal reads the run index and its fidelity tiers. The summary card's `suggested_fix` becomes a link to the incident and lineage, and the viewer shows heal state read-only (it never approves, ROADMAP §3) |

**EX1, extended (week 3 of the plan).**
- **Inputs:**
  - the 5 F-haiku failures and the P1 failure: development, already inspected;
  - ≥ 20 faults injected by code into the C0 F-opus artifacts, from a catalog frozen by hash before any proposer runs: non-gating
    check, over-strict check, check escape hatch, dropped batch, wrong class, misread convention, contradictory prompt;
  - ≥ 10 *latent* injected faults on runs that still pass, to measure detection;
  - natural failures from CX3, as they arrive.
- **Arms at equal budget:**
  - heal with the Haiku proposer;
  - heal with the Opus proposer;
  - Haiku rebuild from scratch, with the failing record;
  - retry unchanged (new salt).
- **Metrics:**
  - fix rate and dollars per fix (V3 + V7);
  - regressions (V4, V7);
  - detection recall on the latent faults (§4 oracle-free signals);
  - verdict precision after heal;
  - lessons accepted.
- **Kill rules:**
  - heal does not beat both retry and rebuild on fix rate at equal budget, or adds regressions → C3 falsified in this envelope;
  - Haiku's fix rate is not non-inferior to Opus's at δ = 20 points → the proposer starts at Opus.
- **Power:** under-powered results read "directional, no decision".
- **Pre-registration:** written before the first proposer call that is scored.

---

## 13. The three incidents through the loop

Localisation outcomes are measured. Everything after them is what the loop would produce: illustrative, not run, and not a
pre-commitment.

| | H-rec | H-cfx | H-p1 |
|---|---|---|---|
| Signals | `ORACLE_FAILED`, `VERDICT_ORACLE_MISMATCH` (2); `FRAGILE_READ` on 6 passing trials; lint `GLOBAL_READ_UNGUARDED`, `ESCALATION_WITHOUT_CHECKS` | `ORACLE_FAILED`, `VERDICT_ORACLE_MISMATCH` (3); `COST_OUTLIER` (4, including the lucky pass); `CHECK_MODEL_DISAGREEMENT` (s6001 t1) | `ORACLE_FAILED`, `VERDICT_ORACLE_MISMATCH` (1); `CHECK_VACUOUS` (59/90) |
| Localisation [M] | root `conf`; 1 of 24 flips passes; high | root `check1` (+ clone `check2`); flip passes 4/4; medium (`repair`, `answer` downstream) | root `statuses:1/judge`; `meaning` flip passes; `relation` flips need live escalation; high |
| Class | `UNGUARDED_GLOBAL_READ` (variance test decides whether only allocator ops are allowed) | `OVERSTRICT_CHECK` + `CHECK_VETO_ROUTING` | `CHECK_ESCAPE_HATCH` |
| Lint-debt proposals | `strengthen_acceptance`, `gate_verify` (the `verify` node), `gate_failed_count` (`extract`) | `strengthen_acceptance` (needs a gating check of the answer, such as visible tests on `answer`; a proposer op) | `gate_failed_count` (8 maps), `gate_continuation`, `gate_verify`, `strengthen_acceptance` |
| Likely defect ops | `add_evidence_field` + `edit_instructions` (worked-example rule) + `k_sample_agreement` (k = 2, escalate on disagreement), or `escalate_class` to L | `patch_code_node` on the clone group (compare names, order, kinds and the *count* of defaults), justified by the bed contract's "Default *values* may change, since a wrong-default fix needs that" [D: `beds/codefix/README.md:64-67`]; `edit_instructions` removing "and defaults" from `fix` and `repair`; selector rule | `tighten_check` (the `none` branch must still constrain `meaning`), or `k_sample_agreement` on `meaning` |
| What the gate tests hardest | V7 strata: BRIGHTDESK DMY *and* MDY by example (a hard-coded mapping fails half) | V2b mutant battery (renamed, reordered, removed parameters still flagged); V5 controls (`unchanged-buggy`, `near-miss-*`); V6 should *fall* (no Opus repair: the diagnosis' counterfactual is about $0.088 vs $0.1735 per trial) | V4 over 35 passing trials: a tighter check fires on recorded outputs and escalates. The false-alarm and cost bounds decide |
| Lesson | L-1 | L-2 | L-3 |

---

## 14. Build plan and open decisions

**Files (all under `experiments/heal/`; node:test, no new dependencies):**

| File | Does |
|---|---|
| `kit.mjs` | Load the frozen kit after the blob check; build the session policy subset; create journal copies |
| `pin-gate.mjs` | Write `pinned/src/{lint,acceptance,verdict}.mjs` from `git show 13f7664:<path>` plus the kit dependencies; record the hashes in `pins.json` |
| `index.mjs` | Run-index adapter: reads 06b's index when it exists, and results, journals and stores until then |
| `detect.mjs`, `classify.mjs` | §4, §5 |
| `replay.mjs`, `localise.mjs` | §6. The probe in `probe/feasibility.mjs` is the seed of these |
| `ops.mjs` | Op schemas and the compiler to the frozen IR |
| `brief.mjs`, `proposer.workflow.mjs`, `propose.mjs` | §7 |
| `scan.mjs` | Literal leaks and V2 |
| `verify.mjs`, `seeds.mjs` | §8 |
| `gate.mjs`, `ledger.mjs` | §9 (lineage with compare-and-swap) |
| `learn.mjs`, `lessons/rules/*.mjs` | §10 |
| `cli.mjs` | `detect`, `localise`, `propose`, `verify`, `promote`, `rollback`, `learn`, each with `--dry` |

**Tests.**
- A scripted `ModelPort`; fixtures copied from the probe.
- Op-compiler round trips and forbidden-op rejection.
- Gate decisions on synthetic verification records.
- A scanner that catches planted literals.
- The pin identity control, including the P-1 regression (reads dropped must miss).
- The k-sample distinct-key check (P-2).

**Order.**
1. `kit`, `pin-gate`, `replay`, `localise`: free; turns the probe into a module.
2. `detect`, `classify`, `ops`, `scan`, `gate`: free.
3. Mechanical lint-debt heals end to end on the three incidents: costs only V3–V7.
4. The proposer: Haiku rounds on the three incidents, as development.
5. `learn`.
6. The EX1 pre-registration.

**Size.** About 1,500–2,000 lines plus tests [I].

**Open decisions for the owner** (defaults in brackets; none blocks steps 1–3):
1. Auto-promotion scope: guard-adding ops auto-promote, while relaxations, class F and cost increases over 25% go to review.
   [default: as in §9]
2. R-16's "one node" read as "one locus, clone groups allowed". [default: yes, reported per proposal]
3. Shadow length M = 10 and its cost under the heal budget. [default: yes]
4. Whether accepted lessons are folded into the structured builder v0 kit before CX3, or held until after EX1.
   [default: after EX1, so CX3 and EX1 do not share a moving kit]

---

## Appendix A. Reproduce

```sh
# Zero-cost feasibility probe (strict replay on the frozen kit; writes only to --scratch and --out)
node experiments/heal/probe/feasibility.mjs --scratch /var/tmp/foundry-work/heal-probe \
  --out research/heal-20261008/probe/feasibility.json

# Fields used in §2:
#   kit.mismatchedWithCommit (must be empty), kit.liveDiffers, kit.liveOnly, kit.policyIdentical
#   c0.fidelity[].identical, c0.recordsConfFlips.passing, c0.codefixCheckFlips[], c0.fragility[], c0.costProfile[]
#   p1.fidelity.identical, p1.identity, p1.flips[], p1.escapeHatch
```

The gate-closure check (§1.2) was run in scratch:
1. `git show 13f7664:src/{lint,acceptance,verdict}.mjs` next to the kit's `data.mjs`, `dataflow.mjs` and `models/policy.mjs`.
2. `lintWorkflow` and `verdictOf` over the two F-haiku artifacts and `buildRecordsV3Workflow(...)` with P1's arguments.
3. The output matched `research/lint-20261008/retro-audit.json`.

`pin-gate.mjs` (§14) makes this reproducible.

The probe ran at load average about 8 on a 4-vCPU machine shared with other agents, so its timings carry that caveat. Every other
number is deterministic replay.

---

## Appendix B. Implementation status (prototype built the same day, 2026-10-08)

*Development and diagnostic evidence. Built under `experiments/heal/` (about 2,500 lines of code, 1,300 of tests; the §14 estimate was
1,500-2,000 for the code). Nothing outside `experiments/heal/` and `research/heal-20261008/` was written, and git state was not touched.
Every test runs on recorded data and scripted providers; no test makes a live call. Evidence tags as above; **[M]** here means measured
by the test or run named.*

### B.1 What was built, against §14

| §14 file | Built as | Notes |
|---|---|---|
| `kit.mjs`, `pin-gate.mjs` | `kit.mjs`, `pin-gate.mjs`, `pins.json`, `pinned/src/*` | `pins.json` holds the 87 kit blob ids (from `git ls-tree 880c6b9`) and the six gate blob ids (13f7664); `loadKit()` refuses a kit that differs. `loadGate()` uses the pinned copy and falls back to the live `src/lint.mjs` only if every live gate file has its pinned blob id (it does today: `live.sameBlobAsPin` is true) |
| `index.mjs`, `replay.mjs` | `replay.mjs` | trial index over `results.jsonl` + `probes.jsonl` (116 Foundry-workflow trials: 22 C0 F-haiku, 36 P1 fhand-haiku, others), run id or `ARM/TASKKEY/TRIAL` lookup, journal copies, `pin`, `inject`, strict and `replay-or-live` execution |
| `detect.mjs`, `classify.mjs` | `detect.mjs` | signals of §4 except `PROBE_REGRESSION`; classification before and after localisation |
| `localise.mjs` | `localise.mjs` | enum/boolean flips (`inject`), recorded alternatives, boolean flips of code nodes (`pin`), intermediates scored by the oracle, ranking, defect classes, offline and live variance |
| `ops.mjs`, `scan.mjs` | `ops.mjs`, `scan.mjs`, `proofs.mjs`, `ir.mjs` | 13 ops, compiled on the frozen schema; V2 weakening scan; literal-leak scanner; tighten and relax proofs with a Python signature mutant battery |
| `brief.mjs`, `proposer.workflow.mjs`, `propose.mjs` | `propose.mjs` | brief, flat op schema (portable subset), proposer workflow, one round, the M-M-L-F ladder, mechanical lint-debt proposals, scripted and live provider tables |
| `verify.mjs`, `seeds.mjs` | `verify.mjs`, `seeds.mjs`, `budget.mjs` | V0-V8, seed ledger with reference-hash dedupe, spend ledger |
| `gate.mjs`, `ledger.mjs` | `promote.mjs` | pure `decide`, circuit breaker, `Lineage` (kit `Store` compare-and-swap, `lineage.jsonl`, rollback, owner-review queue) |
| `learn.mjs`, `lessons/rules/*.mjs` | same | three reference rules, population measurement, lesson records |
| `cli.mjs` | `heal.mjs` (+ `incidents.mjs`, `smoke-proposer.mjs`) | `heal --run RUN --workflow PATH --budget-usd N`, plus `approve` and `rollback` subcommands |

### B.2 What the tests show [M]

- **Kit and gate.** All 87 kit files match `880c6b9`; a tampered pin is refused. The pinned lint reproduces
  `research/lint-20261008/retro-audit.json` exactly (codes, counts, paths) on both F-haiku artifacts, and gives 11 errors on records-v3.
- **Replay.** All 22 recorded F-haiku trials (16 test, 6 construction probes) and the P1 failure replay identically: task hash, oracle
  score, verdict, call count, and the recorded cost recovered from the replayed rows. A pin that keeps its reads reproduces the run; one
  that drops them misses (P-1). A call missing from the journal is `REPLAY_MISS` and costs $0.
- **Localisation.** H-rec: of 24 flips of `conf` exactly one fixes the run (BRIGHTDESK MDY->DMY), confidence high, class
  `UNGUARDED_GLOBAL_READ`. H-cfx: `check1.ok` false->true is the only fixing single-node change, locus `check1`+`check2` (identical
  sources), classes `OVERSTRICT_CHECK` + `CHECK_VETO_ROUTING` (routed to `repair`, `check2`), and the output of `fix` alone already passes
  the oracle. H-p1: the `meaning` flip fixes it, `relation` flips are escalation-dependent (`needsLive`), class `CHECK_ESCAPE_HATCH`. On a
  passing run (s6002 t0) the latent mode finds the answer-changing date-order flips and LEDGR flips change nothing.
- **Detection.** The signals of §4 fire as listed there for H-cfx (including `CHECK_MODEL_DISAGREEMENT` on the lucky pass and the cost
  outliers), H-rec s6004 t1 is classified `working-as-designed`, and the check-vacuity trace finds 59 of 90 P1 status judgments with
  `meaning` unconstrained.
- **Verification on recorded runs with a scripted model.** A `k_sample_agreement` patch to `conf` passes V0-V8 (3 replicas each on 2
  failing trials, 9 regression runs, fresh-task hook): reader 1 replays from the journal, reader 2 and the escalated read go live
  (Haiku and Sonnet, from the owner policy), and the decision is `blocked` because lint debt is open. Wrong live answers fail V3; a
  broken passing run fails V4 as a regression; no provider leaves V3 `pending`.
- **The designed H-cfx sequence, at $0.** Lint debt (a proposer-supplied acceptance on the visible tests, owner-reviewed) then
  `relax_check` on the clone group with the task's own words and the mutant battery: V0-V8 pass, all three failed trials pass without
  the Opus repair, no false alarms, cost ratio below 1, decision `owner-review`, then an explicit approval moves the head. An
  over-relaxed check, an unquoted justification and a patch to an over-strict check are each refused in V2.
- **Gates.** Literal leaks (all four rules), unsafe code additions, every loosening in §7.1's forbidden list, the stage-subset rule, the
  paired fresh-task rules (worse, lost task, worse stratum) and the ladder are each exercised by a test.

### B.3 Offline runs on the three incidents ($0, replay only) [M]

`node experiments/heal/incidents.mjs` writes `research/heal-20261008/runs/H-*.json` (ids, scores, counts and codes; no task text) and the
lessons in `research/heal-20261008/lessons/`.

### B.4 Resume check, 2026-10-08 19:13-21:15 UTC (two fixes found by running the prototype again)

*Development/diagnostic evidence. Written after the session restart (resume of the paused build). Changed: `experiments/heal/kit.mjs`,
`verify.mjs`, `heal.mjs`, the tests `kit-gate`, `verify` and `p1`, the regenerated `runs/H-p1.json` and this appendix. `src/`, `policy/`
and the other read-only paths were not touched, and neither was git state (concurrent workflows committed snapshots meanwhile, which
include these edits).*

**Fix 1: policy drift.**

**Finding [M].** The first full run of the suite after the restart gave 76 tests, 27 pass, 49 fail, and 45 of the failures were one
error: `HEAL_POLICY_DRIFT: policy/models.json differs from the frozen kit policy`. Cause: a concurrent workflow (engine stage-1
lanes, `research/review-20261007/cli-flags-20261008/`) has an **uncommitted** edit of the live `policy/models.json`: `policyVersion`
2026-10-07.1 to 2026-10-08.1, one new note, and a new `providers.claude-cli.childEnv` key (two `claude -p` child environment
variables). The loader compared the owner file with the kit's policy by git blob id, so any edit blocked every replay, although the
edit changes nothing the frozen kit does: no file of the kit mentions `childEnv`, and the kit's `ClaudeCliProvider` builds the child
environment from `process.env` only [D: kit `src/models/providers/claude-cli.mjs:33,102`].

**Fix (`kit.mjs`).** `policyDrift(live, frozen, {kitSources})` replaces the byte comparison:
- ignored and *reported* (`kit.policyDrift.ignored`): `policyVersion`, `notes`, and a provider key that no kit source mentions
  (`childEnv` today). The key exemption lapses as soon as any kit source mentions the key;
- blocking (`HEAL_POLICY_DRIFT`, with the differing paths in the message): everything else, i.e. any model id, class, price, digest,
  decoding, provider invocation, class order or escalation setting.

The run itself still uses the kit's own policy of record, so `ownerPolicyHash` stays `fe63f99b...` (the value in every committed
`runs/H-*.json`), replay keys are untouched, and heal's live calls keep the pre-2026-10-08 pricing basis. That matters for V6: the new
flags "lower the reported cost per call" and make costs from before and after incomparable (synthesis rule R3), so a candidate priced
under the new flags would be compared with baselines priced without them. Model ids still come only from the owner file: the check
fails if the live file would choose a different model. This is a reading of "policy identical" that the owner may want to confirm. The
stricter reading (byte identity) is one line in `loadKit` and would block heal again whenever any lane edits the policy.

**Tests.** Three new tests in `test/kit-gate.test.mjs` (prose and unread key reported not blocking; six kinds of blocking drift, and
the lapse when the kit reads the key; the loaded kit reports its drift and carries no `childEnv`). They use synthetic policies, so
they do not depend on the state of the live file. The `loadKit` refusal itself is not exercised end to end because that would need an
edit of the live policy.

**How to run the suite.** Node 24's runner does not accept a directory, so use the glob (this is the form `npm test` uses for
`tests/`):

```sh
node --test --test-concurrency=2 experiments/heal/test/*.test.mjs     # 81 tests, all pass; 14m57s wall on 4 vCPUs shared with other agents (load 10-17)
node experiments/heal/incidents.mjs --out /var/tmp/foundry-work/heal-scratch/incidents   # $0, replay only; 14 min for all three at that load
```

**Fix 2: V5 control harness (found by running `incidents.mjs` again; the unit tests had not exercised V5 on P1).** The refreshed
P1 run rejected the mechanical lint-debt proposal at V5 with `HEAL_NO_DISCRIMINATION` ("the gating acceptance rejects none of the
bed's 14 bad controls"), where the previously committed `H-p1.json` still showed an older `HEAL_OP_INVALID` at V0 (stale record, now
refreshed). Looking at the per-control table showed that the reject was an artifact of two defects in my V5 harness, not a property of
P1 [M, scratch scripts in the session scratchpad]:
1. *The controls never reached the gate.* `pinChain` recognised a carrier of the answer only when the recorded output held the
   answer keys at its root. In records-v3 the sink `answer` is `return input.answer`, and the gating verify `check` reads `merge`,
   whose `answer` property holds `{records}`. So only `answer` was pinned, `check` judged the real recorded merge, and even the
   string `"GARBAGE"` was accepted. Now a node also carries the answer when one nested object property equals the recorded answer
   key by key (a look-alike object with other values is left alone; the new parameter is optional, so old callers are unchanged).
2. *The host run's evidence disagreed with the truth.* With the first fix the candidate rejected all 14 bad controls **and the bed's
   reference**: the controls were pinned into the failing run, whose `merge` evidence (voided tokens, conventions) comes from the run
   that mis-judged a status, so a consistency check rightly refused the reference. The controls are now made from the task of a
   recorded *passing* run (first by key) and pinned into that run; the failing run hosts them only when nothing passed.

Result on P1 [M]: the reference is accepted; the gated `check` rejects 4 of the 14 bad controls (`empty`, `ignore-void-markers`,
`status-meaning-flipped`, `unknown-status-live`) and accepts the other 10 (`shuffled-or-corrupted`, `no-dedup`, `birthdate-key`,
`oldest-row-wins`, `atlas-order-flipped`, `brightdesk-order-flipped`, `vendex-order-flipped`, `unconverted-amounts`,
`mirror-ignored`, `perspective-ignored`). So the lint-debt heal gives records-v3 a gating acceptance that is a *partial* contract:
its structural verify cannot see a wrong date order or a missing dedup. V5 passes under the design's rule (at least one rejected, and
none of the base's rejections lost), and the proposal stays `pending` only because V7 needs a live provider. It also sharpens lesson L-3:
a verify node that checks structure is not evidence of correctness, and the share of bad controls it rejects (4/14) is a
construction metric that is cheap to compute.

**Offline results after both fixes [M]** (`node experiments/heal/incidents.mjs`, $0, regenerated `runs/H-*.json`): all three runs
replay with identical fidelity; roots and classes are unchanged (H-rec `conf`, `UNGUARDED_GLOBAL_READ`; H-cfx `check1`,
`OVERSTRICT_CHECK` + `CHECK_VETO_ROUTING`; H-p1 `statuses`, `CHECK_ESCAPE_HATCH`). The mechanical lint-debt proposals of H-rec and
H-p1 pass V0-V6 offline and wait at V7 (`pending`, needs `--live`); H-cfx's lint debt needs a proposer-supplied check (no gating
verify to strengthen), so it makes no lint-debt proposal offline. Nothing was spent and nothing was promoted.

**Still not done.** Nothing in this appendix has made a live call. The live path (proposer through `claude -p`, V3/V4 changed nodes,
V7 fresh tasks) is exercised only against scripted providers, so the design's $10-14 end-to-end cost estimate, and any fix rate,
remain unmeasured.

### B.5 First live runs, 2026-10-08 21:19-22:30 UTC (`claude -p` route, journaled, $6.41 of the $8 cap) [M]

*An adversarial review (B.6) recomputed these results from the raw data and corrects four statements below: the H-p1 promotion was
**not** sampling luck (V3 held the recorded wrong read fixed and the new readers outvoted it); one of the three H-cfx candidates fails a
completed mutant proof; the H-rec round tally is 3 invalid / 3 leak / 8 V3 / 1 V1 / 1 pending; and `approve` could promote any proposal
file, blocked or not. B.6 also lists the defects fixed.*

*Development/diagnostic evidence.* All three incidents are already-inspected test seeds; the fresh-task gate drew its seeds from the dev
pool 1001+ through the seed ledger (`seed-ledger.json`), 4 per family and run, K = 1, paired. Raw data: `experiments/heal/runs/live-20261008*/`
(`<incident>.json` records, `spend-global.jsonl` = every charge of every process, `*/proposer/round-N/journal.sqlite` = every proposer call,
`archive/` = full verification records and the fresh-task journals, `lessons/`). The driver is `experiments/heal/live.mjs`
(`retry-control.mjs` = the "retry unchanged" control; `summarise-live.mjs` prints a text-free digest). The recorded failing runs replay
exactly (same fidelity as B.3). Run 1 used the code as built in B.4; runs 2-4 used the fixes listed below, so they are separate samples.

| run | incident | outcome | $ | wall |
|---|---|---|---|---|
| 1 | H-rec | lint-debt **promoted** (v2); defect: 4 rounds, `HEAL_OP_INVALID` x3 and `HEAL_LITERAL_LEAK` (false positive, below) | 0.21 | 506 s |
| 1 | H-cfx | 4 rounds: `HEAL_OP_INVALID` x2, then `add_probe` (a no-op) twice: `HEAL_FAILING_CASE_STILL_FAILS` | 0.12 | 95 s |
| 1 | H-p1 | lint-debt **promoted** (v2); defect: 3 `k_sample_agreement` patches passed V0-V4 and failed V5 `HEAL_NO_DISCRIMINATION` (false reject, below) | 0.45 | 1,808 s |
| 2 | H-rec | 4 rounds: V3 2 of 3 replicas pass; leak (false positive) x2; V3 0/3 | 0.16 | 306 s |
| 2 | H-cfx | Sonnet `relax_check`: V0-V8 all pass, `blocked` by open lint debt | 0.63 | 282 s |
| 2 | H-p1 | Haiku round 2 `k_sample_agreement` (k = 3): V0-V8 pass, **promoted** (v3) | 0.16 | 1,052 s |
| 3 | H-rec | 4 rounds fail V3; round 4 pending: two cancelled in-flight calls charged at the $1 per-call bound | 2.44 | 385 s |
| 3 | H-cfx | Haiku `relax_check`: V0-V8 pass, `blocked` by lint debt | 0.36 | 242 s |
| 4 | H-rec | 4 rounds: 3 fail V3, 1 `HEAL_LINT_NOT_CLEARED`; no patch | 0.30 | 313 s |
| 4 | H-cfx | Opus `relax_check` (rounds 1-3 invalid): V0-V8 pass with a stratified V7, `blocked` by lint debt | 0.92 | 265 s |
| - | controls | P1 retry unchanged 8/8 vs healed v3 8/8; H-rec retry 0/4 vs `conf` on class L 0/4 | 0.58 | - |

**Defects the live runs exposed, all fixed (tests in `test/live-fixes.test.mjs`, `test/verify.test.mjs`; 86/86 pass):**
1. *Code-node roots got an empty brief.* A check has no journaled prompt, so the proposer saw no evidence and fell back to `add_probe`.
   Now the brief carries the task statement, the task inputs (windows around the identifiers the check's failure report names) and the
   check's recorded output (`codeRootEvidence`).
2. *The brief gave field names but not their grammar.* 6 of 8 early proposer rounds died at compile (a `source` that is not a context
   ref, an invented `conditionJson`, `compare` with dotted paths). `brief.guide` now states the grammar with the valid values at the locus.
3. *Scanner false positives.* (a) A k-sample clone was scanned as new content (rule 3 fired on the schema's own enum values): a clone is
   now compared with the node it copies. (b) Rule 1 flagged "the system's name" and "source notes": text that recurs in other tasks of
   the family (6 dev tasks, full text) is a template constant. (c) Rule 2 flagged `maxLength: 600`: schema bounds are structure. A
   planted task-only sentence and a task-only constant are still caught (tests).
4. *V5 read an indeterminate outcome as "not rejected".* A candidate with new reader nodes cannot replay the bed controls strictly
   (`REPLAY_MISS`), so all 14 controls came back unknown and counted as accepted. The candidate's controls now share one journal copy
   with a provider (changed nodes run live once); without a provider the stage is pending.
5. *V7 for codefix drew tasks at random.* Only 1 of 4 seeds had a wrong-default bug, so the healed check was untested. The fresh set is
   now stratified by "has a wrong-default bug" (oracle side).
6. *The variance test was not in the brief.* Added as a typed fact (bias vs noise).
7. *Spend control.* `--call-cap-usd` bounds an unobservable call; the V3 first replica is still not reserved (a run can overshoot its
   cap: run 3 of H-rec reached $2.44 against $2.0).

**What the numbers say.**
- *Localisation matched the human diagnoses on all three incidents* (root node, mechanism, clone group, the downstream routing) at $0
  and 32-292 s.
- *H-cfx is the one patch that is demonstrably a fix:* three independent proposers (Sonnet, Haiku, Opus) wrote a 1-9 line change to
  `check1` that compares names, kinds and the number of defaults and lets default values change; all pass the 13-mutant battery, the
  3 failing runs, 8 regressions and cost ratio 0.588. On stratified fresh tasks the original fails 0/2 wrong-default tasks and the
  healed workflow passes 2/2; the other stratum is 2/2 vs 2/2 (run 4). It is `blocked`, not promoted: the base has
  `ACCEPTANCE_EXISTENCE_ONLY`, no op can build a gating verifier, and `needsProposer` lint debt is never sent to the proposer.
- *H-p1's promotion is not evidence of a fix.* The failure is sampling noise (resamples 8/8 right); the original passes the failing task
  8/8 on a fresh salt, as does the healed head. V3 cannot tell a patch from a re-roll on a variance incident; the +15% cost is the
  measurable effect.
- *The two promoted lint-debt versions (H-rec v2, H-p1 v2) do not catch the incident.* The failing H-rec run is still a `pass` verdict
  after the heal; the gating acceptance rejects 2 of 14 (H-rec) and 4 of 14 (H-p1) bad controls, none of them the date-order ones.
- *H-rec was not healed in 4 runs x 4 rounds.* Six of the 16 candidates had V3 replicas that ended `failed` (a node check, not a wrong answer); the one
  probed (run 4, round 4: evidence field + check) failed `NODE_CHECK_FAILED` on Haiku and then on Sonnet, but which of its two checks
  (the verbatim quote or the proposer's own) was not isolated [I]. The others pass V3 at most 2 of 3 replicas; `escalate_class` alone is refused by V1 (`ESCALATION_WITHOUT_CHECKS`) and
  would not have worked (conf on class L: 0/4 pass, as the original). The closed condition grammar cannot iterate over array items,
  so no per-row guard can be written for a root array.
- V7 at 4 seeds x K = 1 is directional only; V5 on codefix is vacuous (existence-only acceptance).

### B.6 Adversarial review of the live runs, 2026-10-08 22:35-23:30 UTC [M]

*Development/diagnostic evidence; every seed involved is INSPECTED or a heal-pool dev seed. Changed: `experiments/heal/{seeds,scan,heal,
verify,replay,proofs,promote,retry-control}.mjs`; new `audit-live.mjs` (recomputes everything below from raw data, $0), `p1-mechanism.mjs`
(the one live re-run), `test/review-fixes.test.mjs` (6 tests); data in `experiments/heal/runs/review-20261008/`; this appendix and the
pointer at the top of B.5. Read-only paths and git state were not touched. Live spend of the review: $0.083 (journaled, scope
`review-p1-mechanism` in `spend-global.jsonl`); campaign total $6.50.*

**Recomputed from the raw data** (`node experiments/heal/audit-live.mjs` -> `runs/review-20261008/audit.json`, `audit-relax.json`):
- *Spend.* 399 ledger lines = $6.414775 (H-rec 3.1079, H-cfx 2.0252, H-p1 0.6095, retry controls 0.5836, diagnosis probes 0.0886, which
  B.5's per-case figures leave out). Each incident's `spend.jsonl` equals its run record; the 35 proposer journals sum to the recorded
  round costs; the six archived fresh-task journals sum to the six V7 stage costs. One cap overrun: H-rec run 3, $2.44 of $2.00 (two
  calls charged at the $1 per-call bound; their journal copies were deleted, so "cancelled" cannot be checked any more).
- *H-cfx.* The three candidates recompile from their ops on the frozen kit to the verified hashes. Strict replay: the base fails all 3
  failing runs, each candidate passes 3/3, the 8 regression runs pass 8/8, 0 live calls, cost ratio 0.588. All as recorded.
- *V7.* All 24 fresh rows of the six verifications replay strictly from their archived journal with 0 live calls and give the recorded
  base/candidate pass. Recomputed strata: run 2's set held one wrong-default task (1004: base pass, healed pass), run 3's none, run 4's
  two (base 0/2, healed 2/2); over runs 2-4 the wrong-default stratum is base 1/3, healed 3/3, the other 9/9 vs 9/9.
- *Decisions.* `decide()` re-run on every archived verification gives the recorded decision. The only waiver in a promotion
  (`CLASS_ABOVE_DEFAULT_UNJUSTIFIED` on `judge__esc`) carries text written by the op compiler, not by the proposer.
- *Literals and contamination.* No proposer output names a system or a convention value (the two that mention MDY say "a US-labelled
  system is not automatically MDY"). No relaxed check contains a task literal; the quote `min_count is inclusive (default 2).` is only
  the justification. The codefix fresh seeds 1001-1012 have no reference in common with the inspected test tasks or the C0 probes, and no
  other repository file uses the heal-pool seeds.
- *Localisation* matches the three hand diagnoses as B.5 says (node, field, value, clone group, routing). Wall times were 69-97 s
  (H-rec) and 15-41 s (H-cfx), not 69-89 and 32-41.

**Corrections to B.5.**
1. *H-p1 was a demonstrated fix of its error class, not sampling luck.* `k_sample_agreement` keeps reader 1's prompt, so in V3 reader 1
   REPLAYS the recorded wrong read (`statuses:1`, meaning live, relation none) and only readers 2 and 3 are live. Re-run live with the
   calls kept (`p1-mechanism.mjs` part A): 3/3 pass, reader 1 replayed the wrong read in all 3, and the two new reads outvoted it. The
   "retry unchanged" control (8/8 vs 8/8) only shows the error is rare; it cannot test the mechanism. Part B injected the incident's
   error class (meaning flipped, relation "none", the check's escape hatch) into each of the 88 recorded status reads of all 35 passing
   P1 runs: the parent v2 silently returned a `succeeded` run that fails the oracle 88/88; the healed v3 passed 88/88, with no
   escalation ($0.08). The effect on the natural pass rate is still unmeasured (the base error is about 1 in 36 trials), and the cost
   is +15%.
2. *H-cfx: two of the three verified candidates, not three.* The Sonnet candidate (run 2) compares `_shape(cand_api[key])`, which
   raises on the string `"class"`: when a public function becomes a class it crashes where the old check flagged a signature change.
   The battery had no such mutant. With the `kind_changed` mutant and "a crash is a violation", run 2 fails V2; runs 3 (Haiku) and 4
   (Opus) still pass (16 mutants each). Also: the added code is 5-13 lines plus a 1-2-line change, not 1-9.
3. *H-rec rounds:* 16 = 3 invalid ops, 3 leak rejects, 8 V3 failures, 1 V1 reject (`ESCALATION_WITHOUT_CHECKS`, an
   `edit_instructions` + `escalate_class` pair, not a pure escalation), 1 pending (budget). Five, not six, candidates had a V3 replica
   end `failed`. The evidence-field check itself works: an exact quote of the notes passes and a non-quote fails after the Haiku -> Sonnet
   escalation ($0, scripted model). So those failures are model quoting, not a harness fault.
4. *Leak rejects.* The two in run 2 are confirmed false positives ("the system's name" and "source notes the" occur in 6/6 other tasks;
   `maxLength: 600`). The run-1 rule-3 hit on `conf__s1.returns` does not reproduce with the scanner as committed at 16:17 or 20:55 UTC
   (the clone's schema puts BRIGHTDESK 44 characters from DMY); the content was the base node's own schema, so it was very likely a false
   positive, but its cause is unconfirmed.
5. *The owner path for H-cfx.* `approve` did not only handle `owner-review`: it promoted any proposal file it was pointed at, including a
   `blocked` one, a `pending` one (H-rec run 3, V3 not finished) or a rejected lint-debt proposal (tried on a copy of the state, $0).
   And `decide()` sends every `relax_check` to owner review, so the codefix fix needs the owner even after the lint debt is cleared.

**Defects found and fixed (all tested in `test/review-fixes.test.mjs`; 92 tests pass).**
- *Fresh-seed dedupe (seeds.mjs).* A codefix draw was deduplicated only against earlier fresh draws, never against the inspected test
  tasks or the probes (§8.1 says "every task already used"). Used tasks are now hashed into the ledger first. A stratum-vetoed seed was
  cached and then skipped forever as a duplicate of itself; only used tasks count now. No contamination happened (checked above).
- *Scanner (scan.mjs, heal.mjs).* The live-run fix exempted any phrase found in ANY of six other tasks; 26 BRIGHTDESK trigrams recur in
  only 2 or 3 of them, so a copied convention sentence would have passed rule 1. A template constant must now occur in EVERY other task
  (`familyTasks`). `minimum`/`maximum` are value bounds and are scanned again (a year or amount there is a leak). Re-scanning all 22
  compiled proposals changes no outcome (one extra rule-1 hit, on a proposal V1 had already rejected).
- *Relax proof (proofs.mjs).* `kind_changed` mutant; a relaxed check that crashes where the old one judged is a violation.
- *Evidence (replay.mjs, verify.mjs, heal.mjs, retry-control.mjs).* V3/V4/V5 replicas and the retry control journaled their live calls
  only into throwaway copies that `close()` deletes; the raw outputs behind "2 of 3 replicas", the node-check failures and the $1 bound
  charges are gone. Live rows are now copied to `<runs>/verify-live/<proposal>.sqlite` (and `<out>.journal.sqlite` for the control)
  before the copy is deleted; the V7 journal is written under the run directory and its handle closed.
- *Budget (verify.mjs).* The first V3 replica is reserved like the others.
- *Approval (promote.mjs, heal.mjs).* `approve` refuses a candidate whose verification did not pass V0-V8 (`HEAL_NOT_VERIFIED`) or whose
  decision is not `owner-review`/`blocked`, and records an approval over a block in the lineage line.

**Not changed (reported).** V4 counts a run stopped by `MODEL_ESCALATION_EXHAUSTED` after a failed node check as an oracle regression,
not a false alarm (conservative). The brief gives the proposer the localised flip (BRIGHTDESK MDY -> DMY), i.e. the dev oracle's answer
for that field, by design (§7.5); rule 3 only matches the literal enum value, so "BRIGHTDESK is day-first" would pass the scanner and
only V7's stratum would catch it. The H-p1 v3 head stays promoted; the H-rec and H-p1 lint-debt heads stay promoted (they fix nothing).
