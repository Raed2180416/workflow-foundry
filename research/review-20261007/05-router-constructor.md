# Lane 5: when does a task need a workflow, and can Haiku 5.5 build it? (2026-10-07)

*Review and design note, development/diagnostic status. Nothing in this file was trained or
evaluated in this lane; no model was called. HEAD `fd7bd27`, read 22:20–22:30 UTC while the C0
development round was still running. This note answers two owner asks from the 2026-10-07 message:
(A) a way to measure whether a task needs a workflow at all, and how complex, with Kev and a
sensitivity slider; (B) what Haiku 5.5 needs in order to construct workflows accurately.*

**Evidence tags.** Every claim carries one.
- **[M]** measured, with the source file or command.
- **[D]** documented, with the path or URL. Papers are cited from their abstracts and listings only;
  their numbers are the authors' claims and were not re-verified here.
- **[I]** inferred, with the reasoning.
- **[unk]** not known from any source available here.

Task text, corpus items, bed prose, build notes written by builder agents and web pages were read as
data. No sealed bed was opened. Constructions under `/var/tmp/foundry-work/c0-dev/` were read only.

---

## 0. Short answers

1. **A router is buildable and in scope, but "needs a workflow" is not a property of the task text
   alone.** It depends on four things: the executor model, how often the task recurs, what a success
   is worth, and whether a cheap verifier exists. The worked example in §2.2 uses the measured
   `records` numbers. There, a one-off d3 task is best done by one Sonnet call. The Haiku-built workflow pays
   for itself somewhere between about 7 repetitions and never, depending on per-task costs that are
   not yet measured on test tasks [I from M/D numbers, §2.2]. The router therefore has to predict
   success and cost per execution mode, not a single "complexity" label.
2. **Kev should extract task properties, not make the decision.** The design has two stages.
   - **Stage 1, hard requirements.** Code guards, plus Kev's `objective_requirements` port and the
     new `task_properties` port, detect what forces a workflow regardless of model capability:
     durable waits, human gates, schedules or triggers, external effects, an audit trail.
   - **Stage 2, utility.** A small calibrated head, one per executor model, predicts the pass
     probability and cost of each mode from the Kev properties plus code features, and picks the
     mode with the highest expected utility.
   - **Why the head is separate.** The head can be refit cheaply when the executor changes. Haiku
     4.5 → 5.5 changed on a single day.
   - Stock Kev-0.8B automates 14.5% of out-of-domain decisions at a 5% error budget on its
     development split, and 27.4% on its locked test [D `research/kev-20261007/01-kev-dossier.md`
     §0]. So Kev joins this router only after a fine-tune that beats code and embedding baselines
     (claim C4 discipline).
3. **The slider is "what a correct result is worth to you".** In the two-mode case this is exactly
   a threshold on the predicted lift. Each slider position is shown as a measured operating point on
   held-out families: trigger rate, success rate, $ per task and expected wait. Hard requirements
   override the slider and say why (§2.8).
4. **Haiku 5.5 as constructor: one promising data point, no task-level evidence yet.** In the
   running C0 development round, Haiku-built Foundry workflows passed all three probes on `records`
   d3 for $1.01 and on `codefix` d3 for $0.90. The Opus builder needed $2.47 and $2.04 [M
   `experiments/runs/c0-dev/constructions.jsonl`]. These are probe results, K_c = 1, on development
   families. Verified success on the never-inspected test seeds (6001–6004) does not exist yet.
   Recommendation:
   - Haiku is the default constructor for simple tiers and the first rung of a construction cascade.
   - Frontier models author the library (operators, worked examples, repair cookbook) that Haiku
     instantiates.
5. **What Haiku needs is mostly context and structure, not weights.** We cannot fine-tune Haiku 5.5
   ourselves; whether Anthropic offers it is [unk]. The levers, all cheap:
   - construction run as a Foundry workflow of narrow typed steps (§3.2);
   - executable operator skeletons with typed slots (§3.3);
   - retrieved worked examples from other families (§3.4);
   - per-node schema-constrained generation (§3.5);
   - a strict construction lint whose errors feed repair (§3.6);
   - a measured model card and a capability catalog (§3.9).

   Kev is fine-tuned where the label is cheap and executable: task properties, objective
   requirements, and probe-failure cause from injected faults (§3.7–3.8).
6. **Biggest gaps found in the artifacts** [M, §1.2]:
   - **Acceptance is near-vacuous.** All seven Foundry workflows built so far (four in C0-dev, three
     gate smokes) accept on "the answer exists". Six have a non-gating verify node and one has none.
   - **Silent drops.** The Haiku-built `records` workflow drops failed batches silently (its own
     notes say so), and the validator only warns.
   - **Cheap constructor, expensive executor.** The Haiku-built `codefix` workflow runs on Sonnet
     and Opus, not Haiku.
   - **Testing dominates cost.** Testing the artifact, not the builder's tokens, is 45–76% of a
     Haiku construction's cost.
7. **Every claim maps to an experiment in §4.** Two experiments come first:
   - the headroom sweep RX1: if per-instance routing cannot beat the best fixed mode by a useful
     margin, do not build the router;
   - the free strict-lint retro-audit CX2.

   Staged total about $450–480 list price across separate experiments, each under the $500 pause
   rule.

---

## 1. What exists today

### 1.1 C0 development constructions (records and codefix, difficulty 3)

All rows are [M] from `experiments/runs/c0-dev/constructions.jsonl`, read at 22:25 UTC. The cost is
list price: builder tokens as reported by the CLI, plus gateway model calls the builder made while
testing. "Checks" counts `/score` calls, out of at most 12. Every construction ended with all three
probes passing. **There are no test-split results yet.** Construction success is not task success.

| Label | Builder | Builder $ | Gateway $ | Total $ | Minutes | Turns | Checks | Last probe scores |
|---|---|---|---|---|---|---|---|---|
| F-opus-records | Opus 5.5 xhigh | 2.27 | 0.21 | **2.47** | 9.6 | 29 | 3 | 1, 1, 1 |
| F-haiku-records | Haiku 5.5 xhigh | 0.56 | 0.45 | **1.01** | 13.2 | 42 | 5 | first p0 0.968, then 1, 1, 1 |
| B1-opus-records | Opus 5.5 | 2.10 | 1.36 | 3.46 | 11.0 | 28 | 3 | 1, 1, 1 |
| B1-haiku-records | Haiku 5.5 | 0.57 | 0.80 | 1.37 | 16.5 | 42 | 8 | p1 0.963 → 1 → **0.961** (same code) |
| F-opus-codefix | Opus 5.5 | 1.34 | 0.70 | **2.04** | 6.9 | 30 | 4 | 1, 1, 1 |
| F-haiku-codefix | Haiku 5.5 | 0.21 | 0.68 | **0.90** | 7.3 | 41 | 3 | 1, 1, 1 |
| B1-opus-codefix | Opus 5.5 | 1.32 | 1.45 | 2.78 | 10.8 | 24 | 3 | 1, 1, 1 |
| B1-haiku-codefix | Haiku 5.5 | 0.06 | 0.77 | 0.84 | 5.8 | 28 | 5 | 1, 1, 1 |

Earlier gate smokes on codefix at d2, with Haiku 4.5 as builder [M
`/var/tmp/foundry-work/gate-g2{,b}/F/construct/gate-F/construction.json`]:
- Haiku built a **4-node** workflow: `prepare → one code_edit agent (class M) → verify → answer`.
  It passed 3/3 probes for $0.28–0.36.
- Opus built an 8-node two-attempt generate-and-test workflow for $0.70.

### 1.2 What the constructed workflows look like

[M] from `research/construction-20261006/artifacts/*/workflow.json` and `BUILD-NOTES.md`.

| Artifact | Shape | Agent models | Code size (chars) | Acceptance | Verify |
|---|---|---|---|---|---|
| F-opus-records | parse (code) → config from notes (one call) → countries (M) → map extract free text (M→L, id echo) → resolve (code) → check → answer | config on **F** (Opus) per task | 22.5K + 33.1K | `exists answer.records` | code, `gate:false` |
| F-haiku-records | config (M, low reasoning) → split → map extract **every row** (M→L, id echo) → merge (code) → verify → answer | M with L escalation | 0.8K + 11.9K | `exists answer.records` | code, `gate:false` |
| F-opus-codefix | prep → audit (L→F) → apply and test (code) → independent review (L→F) → apply → pick → check → answer | L, F | 8.5K ×2 | `exists answer.patched_source` | code, `gate:false` |
| F-haiku-codefix | bundle → fix (**L**) → check1 (tests) → repair (**F**, if check1 fails) → check2 → answer | L, F, no Haiku node | 4.7K ×2 | `exists answer.patched_source` | none |

Observations:
- **O1. Cost of a Haiku construction.**
  - For F, a Haiku construction cost 0.41× (records) and 0.44× (codefix) of the Opus one, with
    similar check use (5 vs 3, 3 vs 4) [M].
  - The builder's own tokens were $0.21–0.56 for F ($0.06–0.57 across all Haiku builders). Testing
    its artifact through the gateway was 45% (records) and 76% (codefix) of the F total [M].
  - The cheap part is the thinking; the expensive part is running the workflow on probes [I].
- **O2. Both builders converged on the same shapes.**
  - On records: read the per-task conventions once, run a batched map extraction with id echo,
    apply rules and merge in code, verify, answer.
  - On codefix: generate, test, repair.
  - These are operators §1, §2, §5, §6 and §9 of `skills/micro-harness/references/operators.md`.
  - "Read conventions once, then apply them in code" is not a named operator yet. It is a
    candidate for the library (§3.3) [M shapes; I attribution to the skill].
- **O3. Opus wrote the parsers; Haiku delegated reading to the model.**
  - Opus moved per-system parsing into 55K characters of code. Haiku left per-row reading to the
    model and wrote 12K characters of merge code.
  - On unseen layouts and harder difficulties this cuts both ways: model reading is more tolerant,
    code parsing is more exact. CX1 measures which holds up [I].
- **O4. Acceptance is vacuous in every F artifact.**
  - Every F artifact's acceptance is existence of the answer: 7 of 7, counting the three gate
    smokes. Every verify node present is non-gating, and F-haiku-codefix has none. A run
    "succeeds" whenever an answer object exists.
  - The runtime verdict therefore carries almost no information about task success, which is the
    checkpoint's oldest failure ("succeeded with a wrong artifact", `docs/RESEARCH.md:104`) [M
    artifacts; D].
- **O5. The Haiku records workflow drops failed batches without failing.**
  - It uses `failure:"collect"` and its merge drops failed batches. Its own notes say "a batch that
    fails after escalation drops its rows silently … the run still answers. `verify` does not gate."
  - The validator emits only the warning `ERROR_COLLECTION` (`src/validate.mjs:214`) [M; D].
- **O6. A cheap constructor does not imply cheap execution.**
  - The Haiku builder put the codefix judgment on Sonnet and the repair on Opus. Its notes say
    "Haiku was not tested as a cheaper first pass".
  - Opus put the records config node on Opus, which is charged on every task.
  - The C1 assignment search (`research/distill-20261007/DESIGN.md`) is still needed after
    construction, whoever constructs [M; I].
- **O7. Construction takes 6–17 minutes of wall time** [M]. For a one-off interactive request that
  latency is a cost in itself (§2.8).
- **O8. At low difficulty, construction collapses to one call.** The d2 Haiku 4.5 workflow is a
  single `code_edit` call wrapped in plumbing [M]. A router that sees an easy task should not pay
  for construction to get the same one call back [I].

### 1.3 Other anchors

- **records, single calls.** One Sonnet 5.5 call solves d1–d3 6/6 at $0.08–0.18 per task. One
  Haiku 4.5 call solves 0/6 (K = 1) [D `docs/RESEARCH.md:111`].
- **records, hand workflow.** A hand workflow on Haiku 4.5 passed 3/3 d2 dev tasks at $0.086 per
  task and failed at d3 [D `docs/RESEARCH.md:113`].
- **Haiku 5.5 single call: unmeasured.** P1 (`research/core-20261006/PREREG.md`) would measure it
  but has not run: `experiments/runs/p1/` holds only journals [M `ls`].
- **Haiku 5.5 pricing.** $0.10/$0.50 per MTok for prompts up to 100K tokens and $0.50/$2.50
  beyond [D `policy/models.json`, model `claude-haiku-5-5`]. Long builder sessions can cross that
  tier; calls of a structured builder would not (§3.10) [I].
- **What the inventory says about these decisions.**
  - The Kev inventory rates F8 ("workflow, script or agent per family") as *low* fit: "a handful of
    families gives nothing to learn".
  - It defers D:D6 ("reuse, construct, delegate or cascade") to Phase 5 and freezes only a
    ledger-only contract `L3 reuse_route`.
  - Sources: [D `research/kev-20261007/02-decision-inventory.md` F8, D6;
    `research/kev-20261007/JUDGE-PROGRAM.md` §1.3]. §2.7 answers the label-scarcity objection with
    within-family difficulty variation and corpus items as extra families.
- **Routing baselines are hard to beat.** In LLMRouterBench, several routers, OpenRouter's
  included, do not reliably beat the single best model. Most of the 15–20% gap to the oracle comes
  from missing the rare right choice. "Giving the router information helps more than making it
  clever" (+15.3% relative from per-dimension performance statistics) [D
  `research/landscape-20261006/04-routing-allocation-verification-security.md:16,30`].
- **Kev is not wired into workflows yet.** The IR has no judge node, and nothing outside tests
  constructs a JudgmentPort [D `02-decision-inventory.md` §1.4; `JUDGE-PROGRAM.md` §8.2].
- **"Templates" in the repository are not what C0 uses.**
  - `src/construction-objective.mjs` maps 12 regex cues (`REQUIREMENT_LIBRARY`, lines 21–34) to
    hard-coded IR templates. Under AGENTS.md that is a template demo, not task success.
  - The C0 builders instead read the operator *text* in `skills/micro-harness` and write the IR
    themselves.
  - §3.3 proposes a third thing: executable operator skeletons with typed slots [D].

---

## 2. Part A: the workflow-need router

### 2.1 Scope check (ROADMAP §3)

**In scope.**
- ROADMAP §3 excludes "a model gateway or provider router". It does not exclude selection.
- ROADMAP §2.8 defines selection's actions as reuse, construct, delegate to an executor, and
  cascade, and says "Selection chooses *workflows and executors*".
- The router proposed here is that selection decision, plus one extra action, "direct" (a single
  typed call).
- Model ids still come only from the policy file.
- The slider is a control on the decision card that ROADMAP §2.10 already plans for. It is not a
  visual builder.

### 2.2 Why "need" is relative

**When a workflow pays.** A constructed workflow pays for one of four reasons:
1. **Capability.** The cheap executor cannot do the task in one call or one agent loop, and the
   decomposition lets it.
2. **Reliability.** pass^k matters, and a workflow with checks and escalation is steadier. The B1
   rows in §1.1 show the opposite case: B1-haiku-records scored 0.961 on probe 1 with identical
   code after scoring 1.0.
3. **Amortisation.** The task recurs, so construction is paid once.
4. **Non-capability requirements.** Durable waits, schedules or triggers, human approval, external
   effects that need idempotency or compensation, and an audit trail.

**What the corpus captures.** Reason 4 dominates human-built workflows in the corpus [I from
`research/corpus-20261006/COVERAGE.md` §3]:
- 51% of items have an async construct;
- 56% have external effects;
- 13% have human steps;
- only 33% have any model call.

The corpus therefore teaches *when people need orchestration*. It does not teach *when a workflow
beats a capable agent*.

**Utility per mode.** For each mode m:

```
U_m = N · ( V · p_m  −  c_m  −  λ_t · t_m )  −  C_m
```

| Symbol | Meaning |
|---|---|
| N | expected number of instances (1 for a one-off) |
| V | value of one verified success in $ (the slider, §2.8) |
| p_m | probability that mode m passes the task's contract, for this executor |
| c_m | execution $ per instance |
| t_m | wall time per instance, in minutes |
| λ_t | $ per minute of waiting (owner setting, default 0) |
| C_m | construction $, including the chance that construction fails and falls back |

**Worked example (records d3, [I] from [M]/[D] numbers).**
- Direct (Sonnet single call): c_D ≈ $0.08–0.18 and p_D ≈ 1 at d1–d3 (n = 6, K = 1)
  [D RESEARCH.md:111].
- Haiku-built F: C_F = $1.01 [M]. Its notes give c_F ≈ $0.03–0.11 [D BUILD-NOTES, not measured on
  test]; p_F is unknown.
- If p_F ≈ p_D, F wins once N > C_F / (c_D − c_F):
  - **≈ 7** at the favourable ends ($0.18 vs $0.03);
  - **≈ 17** at midpoints;
  - **never** when c_F ≥ c_D.
- If the direct option must be Haiku because Sonnet is not allowed, Haiku 4.5 passed 0/6. The
  workflow is then needed for capability, at any N.

The same task text therefore gets different answers under different executors, recurrence and
values. A router that predicts a "complexity tier" from text alone will be wrong whenever any of
those change.

### 2.3 Two stages

1. **Hard requirements (code first, Kev second).**
   - The workflow is mandatory, regardless of the slider, if the task needs any of:
     - a durable wait longer than a call;
     - a schedule or trigger;
     - a human approval;
     - an external effect with authority implications;
     - a recorded audit.
   - **Source of the requirements.**
     - Code: declared metadata such as effects in the capability catalog and the recurrence field.
     - The existing `REQUIREMENT_LIBRARY` regexes as the baseline.
     - Kev's `objective_requirements` port (JUDGE-PROGRAM C1) and the `task_properties` port of
       §2.6.
   - **What the guard may do.** It can only *add* structure or checking, never remove it. That
     bounds the damage an injected input can do (§5).
2. **Utility routing over modes (§2.4).** The router picks argmax U_m with calibrated p_m and
   c_m, or abstains (§2.9).

### 2.4 Modes (the "tiers")

The modes are ordered by construction effort. The choice between them is made by utility, not by
ordinal regression.

| Mode | What runs | Construction | Typical $ / time | Status |
|---|---|---|---|---|
| `direct` | One typed call on the cheapest adequate model. `direct+` is the same call on Sonnet. | none | Haiku 5.5 typed call ≈ $0.0005, 1.5 s [D README]; Sonnet records call $0.08–0.18 [D] | exists (B0-call) |
| `agent` | Delegate to an executor (Claude Code, Codex). The natural default for open-ended agentic coding, unless measured otherwise. | none | ≤ $1–2 per task cap in C0 [D PREREG-dev] | exists (B0-agent) |
| `reuse` | A kept workflow whose hard guards and applicability gate (X5) pass | none | exec only | Phase 5 |
| `template` | One executable operator skeleton, slots filled by Haiku (§3.3), ≤ about 6 nodes, at most one smoke probe | ≈ cents [I] | exec | proposed |
| `construct` | A bespoke workflow from the Haiku constructor with probes | $0.9–1.0 measured [M §1.1] | 6–17 min [M] | C0 |
| `construct+` | Multi-stage or composed: sub-workflows, async, human gates, interactive exploration. Frontier constructor, or Haiku with decomposition. | $2–10 (Opus $2.0–2.5 at d3 [M]; cap $10) | 10–45 min | partly (composition is Phase 6) |

Two more things sit outside the mode list:
- **`cascade` is a policy, not a mode.** Run a cheaper mode first, and move up only on a
  *verified* failure. It is the default when the router abstains and a cheap verifier exists
  (§2.9).
- **B1 scripts are not a production mode.** B1 is C0's competitor arm. If C0 finds B1 ≥ F, the
  `construct` mode should build whichever substrate wins.

### 2.5 State the router reads

ROADMAP §2.8 and P9 say task features come from **trusted fields only**. The router reads the
instruction part of the task. Attached data (files, issue bodies, exports) reaches it only as
computed numbers or through quarantined Kev outputs, whose low-capacity form cannot carry injected
text (THESIS §7).

| Feature | Source | Cost |
|---|---|---|
| input size in tokens, item count, number of files, longest item | code | $0 |
| output schema size: fields, arrays, nesting | code | $0 |
| executor ids available, budget caps | policy and session | $0 |
| interactive environment handle present; tools needed (capability catalog) | code | $0 |
| verifier available (tests, score service, invariants with controls) and its independence | code plus construction brief | $0 |
| declared recurrence N; detected recurrence (D:D5, same-family kNN in the ledger) | user field, ledger | $0 |
| outcomes of past tasks in the nearest family: per-mode success and cost | ledger kNN | $0 (the "information" LLMRouterBench rewards) |
| task properties p1–p10 (§2.6) | Kev, one prefill | about 25 ms–0.5 s on the laptop GPU [D JUDGE-PROGRAM §6.5 owner smoke] |
| a cheap model's typed self-assessment ("can you do this in one call?") | Haiku 5.5, about $0.001 [I] | baseline only, never sole input |

The rendered state is at most 1K real Qwen3.5 tokens: instruction head and tail plus `key: value`
lines. Raw inputs are not included (JUDGE-PROGRAM §1.0 budgeting rules).

### 2.6 Kev ports

**T1 `task_properties`** (new port, wave 2, multi-`noul`, one record per task). The questions are
executor-independent facts about the task, which is why they can be learned once and reused across
model changes.

| Id | Q0 | Label source | Within-family variation? |
|---|---|---|---|
| p1 many_items | "Does the task require processing many separate items (records, files, documents, cases) in the same way?" | bed metadata (item counts by difficulty); corpus graph (runtime fan-out > 0) | yes (difficulty) |
| p2 stated_rules | "Does the task state explicit rules that must be applied exactly (thresholds, precedence, formats, conversions)?" | bed READMEs per family; objective composer | partly |
| p3 prose_conventions | "Are some conventions stated only in prose and different from task to task?" | generator truth (records d ≥ 3: conventions drawn per task) | yes |
| p4 environment | "Must the solver act in an environment (run code, call tools, take actions) rather than only read inputs?" | bed `kind`; corpus graph (external or read effects) | no (family-level) |
| p5 executable_check | "Is there an executable way for the solver to check an answer?" | bed metadata (visible tests in codefix and ownerci; none in records) | no |
| p6 long_horizon | "Does success need many dependent steps where an early error spoils later ones?" | interactive beds (soft); hand labels | weak |
| p7 open_ended | "Is the output open-ended or subjective?" | hand labels only (owner decision O5) | n/a |
| p8 durable | "Must the work wait for external events, schedules or approvals over time?" | corpus graph (async kinds) | across items |
| p9 effects | "Does the task change external systems (send, write, deploy, pay)?" | corpus graph (write or external effects) | across items |
| p10 recurring | "Does the request say the task will repeat (every build, daily, for each new X)?" | corpus graph (schedule, webhook or event trigger); composer | across items |

Rules carried over from the Kev program:
- Fixed options `yes` / `no` with descriptions, and no "none of these" option.
- Labels from code, generator or graph truth only; **no LLM labels**.
- At least 30 independent forms per label before any gate.
- Held-out families are the gating axis.
- Baselines: regexes (`REQUIREMENT_LIBRARY` style), a bag-of-words probe and embedding logistic
  regression (JUDGE-PROGRAM §5).

Two corpus traps, both [M] over `research/corpus-20261006/items.jsonl`:
- **Label leakage in written descriptions.** 461 of the 829 descriptions with provenance `written`
  contain graph-derived phrasing ("N nodes", "N edges", "trigger:"). That is a direct leak of p1,
  p8 and p10 labels. Use only the 449 `original` items for corpus-labelled questions. Treat the 64
  `recovered-by-model` items as a separate stratum, because WorkflowLLM generated those descriptions
  with a model.
- **Family-level questions.** p4–p6 are constant within most beds, so a tuned Kev can learn family
  identity. Only questions with within-family variation, or enough corpus items, can gate.

**T2 `execution_mode`** (a candidate engine, never the default).
- **Question:** "Which execution mode will meet this task's contract most cheaply for executor
  {executor}?"
- **Options:** direct, agent, template, construct, construct_plus.
- **Labels:** the per-instance oracle mode from RX1, a few hundred rows.
- **Status:** that is far too few to fine-tune 0.8B without memorising families [I from
  JUDGE-PROGRAM §0, §4]. T2 is read zero-shot as a baseline and promoted only if it beats the
  head over T1 plus code features (RX2).

### 2.7 Labels

The cheapest honest label for a task is **the cheapest mode that passed its oracle**, estimated
over K trials. This is the procedure Adaptive-RAG used: a small T5-large classifier, trained on
which retrieval strategy actually succeeded, picks no retrieval, single-step or multi-step per query
[D [ACL 2024.naacl-long.389](https://aclanthology.org/2024.naacl-long.389),
[code](https://github.com/starsuzi/adaptive-rag)].

| Source | Label | Volume | Cost | Bias and leakage | Use |
|---|---|---|---|---|---|
| **Bed sweep RX1**: 5 one-shot dev families × d1–d5 × 12 dev seeds × modes, K = 2 | per-instance p_m, c_m, oracle mode | about 300 instances | about $210 (§4) | dev families only; construction variance (K_c = 1) inside p_F | train and calibrate the head (LOFO) |
| **C0 rounds** (dev, then sealed) | per-family B0, B1, F success and CPS | 5 dev and 4 sealed families | already budgeted | too few to train | anchor and sanity check of the head's family-level predictions |
| **P1** (records d3–d4, 8 arms) | per-instance direct vs hand workflow, with Haiku 4.5 and 5.5 single calls | 12 tasks × K = 3 | about $25–40, pre-registered | one family; hand workflow, not constructed | executor-shift test RX5 |
| **Corpus, original descriptions** | properties p1, p8, p9, p10 from the graph | 449 items | $0 | selection: these are automations people chose to build; graph features ≠ what the description implies | T1 training and evaluation; hard-requirement recall (RX6) |
| **Corpus pilot items with fixtures** (corpus §8, 131 eligible, 30 shortlisted) | per-item oracle mode (direct vs construct) | up to 30, each its own "family" | about $1–3 per item plus fixture authoring | T3 fixtures are authored, not shipped | adds families to the held-out evaluation (RX4) |
| **Agentic-coding negatives** (codefix, ownerci) | measured, **not assumed** (B0-agent vs F) | per family | inside RX1 and C0 | R03: generic harness lift for *frontier* agents on coding is about 2–5 points; for Haiku executors the answer may differ (THESIS §3.4) | head |
| **Trivial Q&A anchors** | `direct` | about 100 | about $0.1 | almost no information; risk of a topic shortcut | only to stop the router triggering on trivia |
| **Synthetic contrasts** | same family at d1 and d4; padded variants (same task plus irrelevant length); composed objectives | thousands | $0 for properties; modes need runs | generator templates (JUDGE-PROGRAM §0) | T1 properties; shortcut tests |
| **Production ledger** | (features, mode, propensity, outcome) with ε-exploration 5–10% on low-stakes tasks (ROADMAP §2.8) | grows | — | needs off-policy correction (IPS or doubly robust) | the long-run source |

Label scarcity is the binding constraint, as the Kev inventory warned. The answer is to route at the
instance level, using within-family difficulty contrast as the main signal (records: one Sonnet
call suffices at d1–d3, and P1 targets d3–d4 where one model call is expected to fail). Corpus pilot
items add families. The router is never trained on family identity.

### 2.8 Decision rule and the slider

**Rule.** Choose argmax over m of U_m (§2.2), using calibrated estimates of p_m and c_m from the
head. With two modes, direct (D) and construct (F), this reduces to

```
trigger construction  ⇔  Δp̂ = p̂_F − p̂_D  ≥  τ(V) = (ĉ_F − ĉ_D + λ_t·Δt + Ĉ_F / N) / V
```

So a single slider over V is exactly a threshold on predicted lift: raising V lowers τ, and the
router triggers construction more readily. That is the "sensitivity" the owner asked for, made
explicit in dollars.

**Slider positions.** Log scale, with a default set by the owner:

| Position | V (value of one success) | Behaviour |
|---|---|---|
| Cost first | V → 0 | always the cheapest mode; construction only when hard-required |
| Frugal | $0.10 | |
| **Balanced** (proposed default) | $1 | |
| Careful | $10 | |
| Reliability first | V → ∞ | the mode with the highest p̂ regardless of $ |

**What the card shows at each position.** Each position is a **measured operating point** on the
held-out curve from RX2 and RX4:
- the share of tasks that trigger construction;
- verified success;
- $ per task;
- expected wait;
- regret against the oracle;

each with a family-clustered CI. A position not yet backed by held-out data says so in the UI
("uncalibrated"). This is the same move RouteLLM makes when it calibrates its threshold to a target
share of strong-model calls [D [arXiv 2406.18665](https://arxiv.org/abs/2406.18665),
[repo](https://github.com/lm-sys/RouteLLM)]. Hybrid LLM tunes its quality target at test time and
reports up to 40% fewer large-model calls with no drop in quality [D
[arXiv 2404.14618](https://arxiv.org/abs/2404.14618)].

**Budget mode (optional).** The slider instead targets a *share* of tasks that may trigger
construction, and τ is fitted to that share on the owner's recent tasks, as in RouteLLM. This is
useful when the owner thinks in spend envelopes rather than value per task.

**Second input: N.** The value of a workflow scales with recurrence, so the card asks or infers
"how many times will this run?". It is pre-filled from a declared recurrence ("every build") or
from same-family history in the ledger.

**Overrides.**
- A hard requirement (§2.3) forces at least `template`, and the card names the requirement.
- A `reuse` hit with a passing applicability gate is always offered first.

### 2.9 Calibration and abstention

**Calibration.**
- The head is a logistic (or monotone GBM) model per mode, one per executor model id.
- It is fitted with family-clustered cross-validation.
- Its probabilities are temperature- or Platt-scaled on a calibration split of *held-out
  families*, never in-family (JUDGE-PROGRAM §7.5 explains why in-family calibration sharpens
  without bound).
- Report Brier score and reliability diagrams with a family-clustered bootstrap. Report ECE only
  where there are ≥ 500 items (JUDGE-PROGRAM §6.2).
- **Re-fit trigger.** Re-fit when the executor model, its engine or the constructor changes. Old
  head rows are invalid evidence for the new model (ROADMAP §2.7 "re-qualify on any change").

**Abstain** when any one of these holds:
- the family is unseen and the nearest-neighbour distance exceeds its calibration-set 95th
  percentile;
- the bootstrap interval of U_F − U_D straddles 0 by more than the slider's tolerance;
- Kev or the code features return "cannot tell", for example missing size facts.

**On abstention:**
- If a cheap verifier exists, run the cascade: direct first, construct on a verified failure.
  Expected cost is c_D + (1 − p_D)(C_F + c_F). The router must beat this policy where verifiers
  exist (RX2 baseline).
- If no verifier exists (records: the oracle is hidden and only structure can be checked), the
  cascade cannot see failures. The card then asks the owner, showing both options with their
  numbers, or follows the slider's side. Either way the decision is logged with its propensity.

### 2.10 How to evaluate the router

- **Split.** Leave one family out (LOFO) over the dev families during development. Read the sealed
  families once, together with the C0 sealed constructions, plus the corpus pilot items as extra
  families.
- **Regret against the oracle choice.**
  - For each instance i and mode m: u_im = V·p̂_im − c_im − C_m / N, with K-trial pass estimates.
  - The oracle picks m*_i = argmax_m u_im. The regret of the router's choice r_i is
    u_{i,m*} − u_{i,r_i}.
  - Report mean regret at V ∈ {$0.10, $1, $10} and N ∈ {1, 20}.
  - Report **headroom captured**, HC = (U_router − U_bestfixed) / (U_oracle − U_bestfixed), the
    analogue of RouteLLM's "performance gap recovered".
- **Baselines**, all on the same instances:
  - always each mode;
  - the best fixed mode chosen on the training families;
  - a size heuristic (tokens or item count > k → construct);
  - try-direct-first cascade (where a verifier exists);
  - Haiku 5.5 zero-shot typed choice of mode;
  - stock Kev zero-shot on T2;
  - random at the router's trigger rate;
  - family majority *with* history of the held-out family, reported separately as the "with
    history" ceiling.
- **Unit and power.**
  - The family is the unit. About 5–9 bed families plus about 30 corpus items is thin. Report
    per-family strip plots and family-clustered CIs.
  - No claim with fewer than 30 held-out families. Below that, results are diagnostic.
  - Gaps under 3 points are noise (ROADMAP §4.3).
- **Kill rules.**
  - If the oracle's headroom over the best fixed mode is under 3 points of success and under 20%
    of cost at every tested V and N, do not build the router. Ship the fixed policy plus the hard
    guards (RX1).
  - If router v0's HC has a lower CI bound ≤ 0 on held-out families, it stays advisory: logged,
    shown on the card, never deciding (RX2).

---

## 3. Part B: Haiku 5.5 as the workflow constructor

### 3.1 Is Haiku the constructor?

**Today.** In C0, the "constructor" is Claude Code at effort `xhigh` with:
- the `skills/micro-harness` text (SKILL.md, `ir.md`, nine operators in `operators.md`);
- three probes and up to 12 `/score` checks;
- a model gateway.

It writes `workflow.json` freely, usually through a generator script of its own (`solver/build.mjs`,
`src/build.py`, `src/gen.py` in the notes) [M BUILD-NOTES]. It is an agent loop, not the "builder
workflow" of ROADMAP §2.5.

**Evidence so far.** Haiku 5.5 produced probe-passing workflows on both development families, at
0.4× Opus's construction cost [M §1.1]. Whether these workflows pass unseen test tasks is the next
C0 readout (CX1).

**Precedents for weak constructors** [D, abstracts only]:
- **W4S** trains a 7B "weak meta-agent", in about one GPU-hour of RL with execution feedback, to
  design workflows that improve GPT-4o-class executors by 2.9–24.6% over the strongest baseline
  across eleven benchmarks [arXiv 2504.04785](https://arxiv.org/abs/2504.04785).
- **FlowReasoner** distils and then RL-trains a 7B query-level meta-agent
  [arXiv 2504.15257](https://arxiv.org/abs/2504.15257).
- **MAS-GPT** fine-tunes an open model to emit a query-adaptive multi-agent system as code in one
  inference [arXiv 2503.03686](https://arxiv.org/abs/2503.03686).
- **WorkflowLlama**, an 8B model fine-tuned on about 106K workflow samples, beats GPT-4o on
  WorkflowBench [arXiv 2411.05451](https://arxiv.org/abs/2411.05451).

All of these **train** the weak constructor. We cannot train Haiku, so the substitute is structure
and context.

**Counter-evidence to respect** [D, from THESIS §3.4 and R01 in the landscape reports]:
- small models collapse when asked to modify themselves (44 → 14);
- self-written skills add about 0 on average (SkillsBench).

So the library must be curated or verified by stronger models, and Haiku's repairs must be local
patches proven by replay.

**Recommendation.** Haiku constructs the `template` and `construct` tiers and is the first rung of a
construction cascade. On no probe pass within its budget, construction escalates to Sonnet or Opus,
logged as an escalation event. Opus constructs `construct+` and authors the library. That keeps the
thesis ("cheap models execute what frontier models author") and moves construction itself down a
class.

### 3.2 Construction as a Foundry workflow

Each step has a typed output, an owner (code, Haiku or Kev) and a check. Code owns the loop, the
budget and termination. This is P1 (code owns procedure) applied to construction itself.

| Step | Typed output | Who | Check or feedback |
|---|---|---|---|
| 1 intake | `TaskSpec`: output-schema summary; input inventory (name, kind, tokens, item estimate); `rules[]` as {verbatim span, kind enum}; `conventionsInProse` with spans; effects; N | code for sizes and schema; Haiku `extract` (reasoning none) for rules, with raw spans (operator §2 applied to construction) | each span must occur verbatim in the task text, or it is rejected (no invented rules) |
| 2 oracle discovery | `OracleSpec`: available checks (score service, tests, schema, invariants); invariants as code (ids preserved, counts, uniqueness, totals); subjective parts | Haiku `generate` (code), with code-run controls | each invariant passes on a known-good probe answer, if one exists, and fails on mutated answers (ROADMAP §2.5 controls). Fixes O4. |
| 3 shape | enum over shapes: map-extract-assemble, conventions-then-map, diagnose-from-evidence, generate-test-repair, explore-interactive, transform-pipeline, research-synthesis, approval-effect, poll-until, **single-call** | Kev or Haiku `classify`, plus code features | `single-call` returns the task to the router: construction may conclude "no workflow" (O8) |
| 4 skeleton | 1–2 skeletons from the library (§3.3), composed by code | code retrieval (top 3 by shape and features); Haiku `choose` | the composed skeleton validates before any slot is filled |
| 5 slots | the slot values of each skeleton (batch size, item schema, rule list, classes from the model card, reasoning levels) | Haiku, one slot group per call, schema-constrained (§3.5) | slot schemas; class must exist in the session policy |
| 6 nodes | one node per call: agent instructions, `returns`, checks; code-node source with generated unit tests | Haiku `generate` | **dual derivation for parsers**: Haiku reads 5 sample items; the code parses them; disagreements become test failures |
| 7 assemble and lint | `workflow.json` | code | `foundry validate` plus the strict construction lint (§3.6); errors carry a code and a path |
| 8 smoke | per-node diagnostics on probes: schema failures, check failures, escalations, $ | code runs probes in `replay-or-live` mode, so unchanged nodes cost $0 (§3.10) | `/score` when available |
| 9 diagnose | failure cause from a closed set: format code should own, instruction gap, batch too large, missing check, wrong class, other | Kev F7 port (advisory) or Haiku `classify` | the next score or probe result is the label |
| 10 repair | a JSON patch to **one node** | Haiku | re-validate, replay the probes; reject patches that lower any probe score |
| 11 escalate | event: rule, model ids, $ | code rule: no probe pass after R rounds or spend > B_h | none (logged) |
| 12 hand-off | construction record; build notes generated from the typed records | code | construction qualification kept separate from outcome qualification |

The current free agent builder (C0 F-haiku) is the baseline this must beat (CX3). Precedent for
search over code-represented workflows with predefined operators: AFlow reports that operators speed
up the search and that optimised workflows do not transfer perfectly across executor models [D
[arXiv 2410.10762](https://arxiv.org/abs/2410.10762)]. That supports per-executor assignment after
construction (O6).

### 3.3 The operator library as executable skeletons

**Format of each entry:**
- an IR fragment with typed slots;
- a slot schema (portable JSON Schema subset);
- a signature for retrieval: shape, task properties, size band;
- a fixture-based self-test that runs offline;
- known failure modes;
- performance records once used.

**Admission.** Through the same verify-before-store rules as kept workflows (ROADMAP §2.7). An
operator is admitted because it passes its own executable check, not because it is frequent
(corpus §6).

| Candidate | Source | Support |
|---|---|---|
| §1–§9 of `operators.md` (split → batched extract → assemble; raw-and-reading; enum cascade; pairwise blocking; rules in code; generate → verify → retry; best-of-N; evidence → hypothesis → check; structural verify) | existing text | corpus detectors: §1 109 items, §2/§5 204, §3 80, §6 51, §7 128 (best-of-N and sectioning are indistinguishable), §8 16, §9 68 [D COVERAGE §6] |
| **conventions-once**: read per-task conventions once (with a second independent read or a consistency check), then apply them in code | C0: both records builders [M]; both name the single config read as their top weakness [M BUILD-NOTES] | 2 of 2 records constructions |
| scatter → parallel → gather with a verify over the aggregate | corpus | 787 items, 26 platforms [D] |
| poll-until (bounded loop over wait plus check, with a timeout) | corpus | 101 items [D] |
| approval gate before an effect (typed `human` answer, timeout routing) | corpus | 81 items [D] |
| filter → act (guard in code, effect with an idempotency key) | corpus | 44 items [D] |
| notify on failure | corpus | 88 items; needs the failure-handling bundle [D] |
| retrieve → generate (retrieved text as an untrusted input) | corpus | 181 items [D] |

**Mining from passing constructions.**
- **When.** Only after a C0 round's artifacts pass the *test* split. A probe pass is not enough
  (O4).
- **How.** Strip literals, abstract the slots, and add the result as a candidate skeleton with its
  family recorded.
- **Leakage control.**
  - Candidates mined from dev families are allowed in sealed rounds only after the literal and
    digest scan (`src/construction.mjs:240-258`, `experiments/lib/kit.mjs`).
  - Each new skeleton counts as a protocol change: a pre-registration amendment.

### 3.4 Retrieval of similar workflows and worked examples

- **What to retrieve.**
  - The 1–3 nearest kept or passing workflows, with their build notes and per-node model
    assignments.
  - Retrieval is **leave-family-out**: never the task's own family, since that leaks answers and
    probe literals.
  - Retrieved by a task embedding (`bge-small`, the Kev program's baseline embedder) plus shape and
    properties.
- **Why it should work** [D, abstracts]:
  - A small retriever lets a smaller generator emit valid workflow JSON with fewer hallucinated
    steps and tables (ServiceNow, NAACL 2024 industry track,
    [arXiv 2404.08189](https://arxiv.org/abs/2404.08189)).
  - An optimised retrieval-augmented setup matched a fine-tuned model on code similarity for a
    workflow DSL over about 700 APIs, and did better on unseen APIs (Microsoft,
    [arXiv 2407.02742](https://arxiv.org/abs/2407.02742)).
- **Prediction** [I]: a worked example from a *different* family helps Haiku more than any
  additional skill text. CX4 tests this.

### 3.5 Schema-guided generation

- **No whole-workflow schema in one call.** The IR is recursive (map and loop bodies), and the
  portable schema subset forbids `$ref`, `oneOf` and `pattern` (`references/ir.md`; ROADMAP §2.3
  engine conformance). One schema for a whole workflow is therefore not expressible in a single
  constrained call.
- **Per-node and per-slot instead.** Generate per node kind and per slot group under constrained
  decoding: agent node, code node, verify node, slot group. The CLI route supports JSON schema
  output (`policy/models.json` provider features, `jsonSchema: true`).
- **Code assembles the tree** from the skeleton. Haiku never emits structure it could get wrong,
  such as `needs`, `$ref` scoping, or `join` and `default` on skipped branches. These are the IR
  rules `ir.md` spends most of its words on.

### 3.6 Strict construction lint (static checks as feedback)

The validator already emits about 40 codes, for example `MODEL_CLASS_EMPTY`, `VACUOUS_ACCEPTANCE`,
`CONSTANT_ASSERTION`, `ERROR_COLLECTION`, `UNTRUSTED_EFFECT_ARGS` and `SCHEMA_NOT_PORTABLE` [M
`grep` of `src/validate.mjs`]. A construction profile would promote some warnings to errors and add
rules that the C0 artifacts show are needed. The new rules are proposals; field names are to be
settled.

| Rule | Exists? | Evidence it is needed |
|---|---|---|
| `ACCEPTANCE_EXISTENCE_ONLY`: acceptance must reference a gating verify node or an invariant beyond existence | new | O4: 7 of 7 F artifacts [M] |
| `VERIFY_NOT_GATING`: the only verify node has `gate:false` and no stated reason | new | O4 [M] |
| `ERROR_COLLECTION` → error unless a downstream node reads `failed` and gates or retries | warning today (`src/validate.mjs:214`) | O5 [M] |
| `CONTEXT_OVER_CLASS_BUDGET`: estimated agent input from probe sizes > class budget (S ≤ 4K, M ≤ 8K tokens per SKILL.md) | new | SKILL.md rule; no artifact check yet |
| `MAP_NO_ECHO_CHECK`: an agent in a map body has no id-echo check | new | SKILL.md step 3; both records builders added it unprompted [M] |
| `REASONING_ON_EXTRACTION`: extract or classify role with reasoning ≠ none | new | thinking made Haiku worse and 3–4× more expensive on extraction [D RESEARCH.md:112] |
| `UNSCREENED_CLASS`: a node at class F or L with no recorded cheaper attempt | new, warning | O6 [M] |
| `SMALL_BUDGET`, `MODEL_CLASS_*`, `LABEL_POLICY`, `UNTRUSTED_EFFECT_ARGS` | exist | keep |

Lint is useful only if its violations predict test failures. CX2 checks that for free on the 10 C0-dev
F artifacts (once all five families are built) and the 3 gate smokes, before anyone builds on it.

### 3.7 Kev during construction

Every Kev use here is **advisory**: it ranks or orders, and never accepts. Each needs C4-style
baselines before it can gate (JUDGE-PROGRAM §8.1).
- **C1 `objective_requirements`** (existing design): which motifs the task requires; feeds step 3
  and the hard-requirement guard.
- **T1 `task_properties`** (§2.6): feeds the shape and skeleton retrieval.
- **F7 probe-failure cause** (inventory D:F7, rated *low* for an Opus builder that reads failures
  itself). With a Haiku builder the case changes [I]: a closed-set cause picks a repair action from
  a closed set.
  - **Label source:** inject known defects into known-good workflows and record the failure
    signature. Defects include a batch too large, parsing moved to the model, a dropped check, and
    reasoning on for extraction.
  - The label is the injected cause, which is execution truth, not an LLM label.
- **F5 operator fit**: a shortlist prior. Its labels are confounded construction outcomes, so wave
  3.
- **C7 `transcript_gaming`**: an alarm only.

### 3.8 What to fine-tune or few-shot, and with what data

| Target | Can we train it? | Data | When |
|---|---|---|---|
| Haiku 5.5 weights | no; vendor fine-tuning for Haiku 5.5 is [unk] | if it ever exists: the triples below | not planned |
| Haiku 5.5 context (few-shot and library) | yes | (a) worked examples: Opus-built workflows that **pass the test split**, literals stripped, leave-family-out; (b) the skeleton library (§3.3); (c) a repair cookbook of (lint code or runtime failure, before, after) pairs mined from C0 transcripts (`.executor-transcript.jsonl` is kept per construction [M]); (d) the model card (§3.9) | after CX1 |
| Kev T1 `task_properties` | yes (laptop, bridge) | bed metadata, corpus graph (original descriptions), composer; thousands of rows | wave 2 of the Kev program |
| Kev C1, F7 | yes | composer truth; injected-fault runs | wave 2 or 3 |
| Router head (per executor) | yes (trivial; CPU) | RX1 instance labels | after RX1 |
| An open-weight constructor (7–8B) | only with a GPU; local generative models are parked | (brief → skeleton choice plus slots) pairs, *not* whole IR; the W4S, MAS-GPT and WorkflowLlama recipes | frontier bet with a kill criterion; not now |

### 3.9 The construction brief: information still missing

This is what the builder sees today, and what it would need to construct accurately.

| Item | C0 today | Gap | Fix |
|---|---|---|---|
| Task, probes, output schema | yes: 3 probes at d3 | — | — |
| Size and difficulty envelope | one sentence: "including harder ones" | builders tested only probe sizes ("tested only on 85-row inputs" [M B1-haiku notes]) | state the family's size range and max; for beds, one probe per difficulty |
| Oracle access | `/score` bit and score, ≤ 12 checks | no executable check *inside* the workflow (O4) | step 2 oracle discovery with mutation controls |
| Capability and tool catalog | none beyond code and agent nodes | owner tasks need tools: MCP, CLIs, APIs | typed catalog per tool: args schema, effect class (none / read / write / external), idempotency, $ and latency, auth scope, determinism. The built-in registry is in `src/capabilities.mjs`. |
| Effect declarations | n/a (pure tasks) | required for any owner task with effects | from the catalog; sink policy (ROADMAP §2.9) |
| Model card per class | prices, plus one sentence on thinking | builders guessed (O6: Opus put config on F; the Haiku builder never tried Haiku on codefix) | measured per-role tables (accuracy by batch size, schema adherence, reasoning effect, $ and latency per call, context and price tiers) from P1 and C1 screening |
| Budgets | per-task $1 cap; construction $8 + $2 | no target $ per task, latency or **N** | the brief carries the target $ and latency and expected recurrence N, which set how much construction to buy |
| Environment facts | in the B1 prompt; code-node rules in `ir.md` | — | keep |
| Similar workflows and worked examples | none | §3.4 | retrieval |
| Failure and repair knowledge | SKILL.md step 6, one paragraph | §3.8(c) | cookbook |
| Router context | none | why this task was sent to construction (predicted lift, hard requirements) | pass the decision card |
| Executor nodes | IR has no `executor` node; `agent-tool-loop` appears in 99 corpus items [D COVERAGE §4] | a tool-using node inside a workflow | ROADMAP §2.1 executor node (Phase 2 build item) |

### 3.10 Construction efficiency

- **Cost is dominated by testing.** For Haiku builders, gateway testing is 45–76% of construction
  $ [M].
- **Every edit re-runs the whole workflow.** A builder must use a fresh workspace after each edit
  (`experiments/c0/prompts.mjs`), so every smoke run re-executes every node. Directories `ws0`,
  `ws1`, `ws1b` and `ws1`, `ws1-1`, `ws1-2`, `ws2-2` show 3–4 full runs per construction [M].
- **Replay could make unchanged nodes free.** The journal already supports `replay-or-live`
  (`src/models/port.mjs:12`). Replaying unchanged nodes' calls would make them free. Whether the C0
  gateway's run-id salt prevents replay across a builder's runs is [unk]; check
  `experiments/lib/services.mjs`. CX8 measures the saving.
- **Small calls stay in the cheap price tier.** A structured builder keeps each Haiku call small,
  below the 100K-token price tier [D policy], while a long agent session's context grows every
  turn [I].

---

## 4. Experiments (one per claim)

All are **development evidence** unless marked sealed. Each is pre-registered with
`research/PREREGISTRATION-TEMPLATE.md`, with dev seeds disjoint from Kev training ranges and from C0
probe and test seeds. Model ids come from the policy subset. Costs are list price.

| ID | Claim tested | Design | n | Est. $ | Metric vs baseline | Kill or stop |
|---|---|---|---|---|---|---|
| **RX1** headroom sweep | The cheapest passing mode varies within families by difficulty, enough that per-instance routing beats any fixed mode | 5 one-shot dev families × d1–d5 × 12 dev seeds; modes direct-Haiku 5.5 (none), direct-Sonnet (medium), F-haiku and F-opus (the C0-dev artifacts, built at d3), K = 2; agent-Haiku on 4 seeds per cell, K = 1. **Pilot records + codefix first (≈ $85).** | 300 instances, about 2,500 trials | ≈ 210 | oracle headroom over the best fixed mode at V ∈ {0.1, 1, 10}, N ∈ {1, 20}; mode-win matrix per (family, difficulty) | headroom < 3 pts and < 20% cost everywhere → no router; fixed policy plus hard guards |
| **RX2** router v0 | A features-only calibrated head captures ≥ 30% of the headroom on held-out families | LOFO on RX1 data; head = logistic per mode; baselines of §2.10 including the cascade and Haiku zero-shot | as RX1 | ≈ 1 (zero-shot calls) | HC, regret, Brier | HC lower CI ≤ 0 → advisory only |
| **RX3** Kev T1 | Fine-tuned Kev properties beat regex and embedding baselines and add to RX2's head | Kev program wave 2: laptop fine-tune; gates of JUDGE-PROGRAM §6; then ablation in RX2 | thousands of rows; held-out families | laptop nights (owner decision O7) | per-question gates; ΔHC with vs without T1 | port stays advisory if it fails its gates; drop it if ΔHC ≤ 0 |
| **RX4** slider fidelity (**sealed**) | Each slider position's displayed operating point predicts realised trigger rate, success and $ on new families | fit on dev; read once on the 4 sealed families (C0 sealed artifacts) plus corpus pilot items with fixtures | ≥ 30 families including corpus items | ≈ 60 plus fixture work | realised vs predicted within 90% intervals at each of 5 positions | more than 1 position misses → the slider shows "uncalibrated" and its positions become qualitative |
| **RX5** executor shift | Re-fitting only the head with ≤ 100 labels restores calibration after an executor change | natural experiment: Haiku 4.5 vs 5.5 direct arms (P1), plus an RX1 subset with Haiku 4.5 | 100–200 tasks | ≈ 5–10 | Brier before and after refit; labels needed | needing > 300 labels → re-qualify the router per model release, at RX1 cost |
| **RX6** hard-requirement guard | Code guards plus C1/T1 detect mandatory-workflow requirements with recall ≥ 0.95 | 449 original corpus descriptions; labels from graph features (async, human, trigger, effects); hand-checked subsample of 100 for description–graph agreement (owner decision O5) | 449 | 0 (code), laptop for Kev | recall and precision vs the `REQUIREMENT_LIBRARY` regex | recall < 0.9 → the guard asks the user instead of deciding |
| **CX1** C0-dev readout (running, pre-registered) | Haiku-built F workflows reach test success comparable to Opus-built ones at lower construction cost | `PREREG-dev.md` as frozen; add a structural lint audit | 5 families × 4 tasks × K = 2 | in the C0 budget | F-haiku vs F-opus, B1-haiku, B0-haiku: success and CPS | directional only (pre-registered) |
| **CX2** lint retro-audit | Strict-lint violations predict test failures | run the §3.6 profile over the 10 C0-dev F artifacts and the 3 gate smokes; correlate with CX1 outcomes | 13 | 0 | failure rate with vs without violations | no association → lint is hygiene, not feedback; don't build repair on it |
| **CX3** structured vs free builder | Construction as a Foundry workflow (§3.2) beats the free Haiku agent builder on test success or cost, with lower builder variance | Haiku 5.5 in both arms, same caps; K_c = 3 per family and arm; dev families | 30 constructions; 240 test trials | ≈ 55 | test success, construction $, SD across K_c | ≤ free builder on success and not cheaper → drop the structured builder |
| **CX4** context ladder | Adding skeletons, a worked example from another family, a model card and lint feedback each helps a Haiku builder; the worked example helps most | one-at-a-time additions to the CX3 winner; K_c = 2 | 40 constructions | ≈ 75 | Δ test success and Δ$ per addition | an addition with no ≥ 1-family gain is removed (context tokens cost money) |
| **CX5** construction cascade | Haiku-first with escalation to Opus on no probe pass within $1.5 or 2 repair rounds costs less per qualified workflow than Opus-always, at equal test success | offline from CX1 and CX3 data; then live in the C0 sealed round as an extra arm | sealed families | ≈ 0 offline; sealed-round cost | cost per qualified workflow; test success | worse success than Opus-always beyond 3 pts → Opus stays the default constructor |
| **CX6** corpus pilot construction | The structured Haiku builder constructs corpus workflows that pass their mock-execution oracles | T1-tier pilot items first (shipped tests ported to mocks), then T3 with frozen fixtures; vs the Opus free builder | 5–14 items | ≈ 30–60 | oracle pass; IR expressiveness failures by construct | report only; no claim (development corpus) |
| **CX7** Kev F7 | Kev's ranked failure cause cuts Haiku repair rounds vs no hint and vs a rule baseline | injected-fault dataset from passing workflows; then in CX3's repair step | ≥ 300 faults | laptop plus ≈ 10 | repair rounds to pass; final success | F7 gates fail → no hint |
| **CX8** smoke efficiency | `replay-or-live` smoke runs cut gateway $ per construction by ≥ 30% with no change in outcome | rerun two CX3 constructions' smoke sequences with and without replay | 2 × 2 | ≈ 3 | gateway $; probe scores identical | < 10% saving → not worth the protocol change |

**Order and dependencies.**
1. CX2 is free and can run now.
2. CX1 (running).
3. RX1 pilot (records + codefix) after CX1's execution phase, so its F artifacts have test
   results; RX2 offline on the pilot data.
4. CX3 and CX8.
5. CX4.
6. RX1 full and RX6.
7. RX3 (laptop).
8. RX4 and CX5 in the sealed round.
9. CX6 and CX7 last.

**Budget.** Staged total about $450–480 list price (RX1 ≈ 210, RX4 ≈ 60, CX3 ≈ 55, CX4 ≈ 75,
CX6 ≈ 30–60, RX5, CX7 and CX8 ≈ 20 together). Each
experiment is under the $500 pause rule. All runs draw on the shared plan allowance that was
exhausted on 2026-10-06, so runs are staged with small fan-out.

**Phase gates (ROADMAP §6).**
- RX produces "utility and regret against the best fixed mode".
- CX produces "test success and CPS against the free builder and Opus".

---

## 5. Risks, unknowns, owner decisions

**Risks.**
- **Topic shortcut.** "Coding-looking text → agent" and "data-looking text → construct" are
  shortcuts. Mitigations:
  - within-family difficulty contrasts;
  - padded variants;
  - LOFO evaluation;
  - measured, not assumed, negatives (§2.7).
- **Labels inherit construction variance.** p_F for a family is a draw over constructions, and
  K_c = 1 in C0-dev. Use K_c ≥ 2 for any label used in training, or treat the C0-dev rows as
  noisy.
- **Injection against the router.** Attached data could try to push the router to a costly or an
  unverified mode. Mitigations:
  - the router reads trusted fields, plus quarantined Kev outputs only;
  - the hard guard can only add checks;
  - budgets cap the damage;
  - every decision is logged.
- **The boundary moves with models.** A router trained under Haiku 4.5 was stale on the day Haiku
  5.5 arrived. That is why the design keeps the executor-specific part in a cheap head (RX5).
- **Vacuous acceptance (O4) poisons production labels.** Production-ledger labels are worthless
  while workflows "pass" on existence. Ledger labels need independent oracles or human
  confirmation, never the workflow's own verdict.
- **Utility guard.** Router and retrieval costs must stay small relative to a $0.0005 direct call.
  The Kev path is fine. A Haiku zero-shot router call already costs as much as the task it routes.

**Unknowns.**
- Haiku 5.5 single-call success on any bed (P1 pending).
- Test-split success of the Haiku-built workflows (CX1 pending).
- Whether Haiku 5.5 can be fine-tuned.
- Whether C0 smoke runs can replay.
- Kev T1 learnability on non-template text.

**Owner decisions.**
- **R-D1. Default slider position and V.** Recommend "Balanced", V = $1, λ_t = 0.
- **R-D2. Exploration on low-stakes tasks.** Allow ε-exploration (5–10%) so the ledger yields
  unbiased labels.
- **R-D3. Annotators.** Name annotators for p7 and the RX6 subsample (Kev program decision O5).
- **R-D4. Constructor cascade.** Confirm Haiku-first construction with escalation to Opus as the
  default for `construct`, pending CX1 and CX5.

---

## Sources

**Repository** (paths as cited above):
- Owner request and plan: `docs/THESIS.md`, `docs/ROADMAP.md`, `docs/RESEARCH.md`, `README.md`.
- C0 design, protocol and data:
  - `research/construction-20261006/DESIGN.md`, `PREREG-dev.md`, `artifacts/`;
  - `experiments/c0/prompts.mjs`, `construct.mjs`, `run-dev.mjs`;
  - `experiments/runs/c0-dev/constructions.jsonl`;
  - `/var/tmp/foundry-work/c0-dev/construct/*`;
  - `/var/tmp/foundry-work/gate-g2{,b}/`.
- Construction skill: `skills/micro-harness/SKILL.md`, `references/ir.md`, `references/operators.md`.
- Source code: `src/construction*.mjs`, `src/validate.mjs`, `src/models/port.mjs`.
- Kev program:
  - `research/kev-20261007/JUDGE-PROGRAM.md`;
  - `02-decision-inventory.md`;
  - `01-kev-dossier.md`.
- Corpus: `research/corpus-20261006/COVERAGE.md`, `items.jsonl`.
- Landscape reports: `research/landscape-20261006/04-routing-allocation-verification-security.md`,
  `07-red-team.md`.

**External** (abstract and listing level; numbers are the authors' claims):
- Adaptive-RAG, NAACL 2024: <https://aclanthology.org/2024.naacl-long.389>;
  code <https://github.com/starsuzi/adaptive-rag>
- RouteLLM, ICLR 2025: <https://arxiv.org/abs/2406.18665>; <https://github.com/lm-sys/RouteLLM>
- Hybrid LLM, ICLR 2024: <https://arxiv.org/abs/2404.14618>
- MaAS (agentic supernet, query-dependent early exit; 6–45% of baseline inference cost), ICML 2025:
  <https://arxiv.org/abs/2502.04180>
- DAAO (difficulty-aware depth, operators and LLM assignment): <https://arxiv.org/abs/2509.11079>
- AFlow, ICLR 2025: <https://arxiv.org/abs/2410.10762>
- Weak-for-Strong (W4S): <https://arxiv.org/abs/2504.04785>
- FlowReasoner: <https://arxiv.org/abs/2504.15257>
- MAS-GPT, ICML 2025: <https://arxiv.org/abs/2503.03686>
- WorkflowLLM / WorkflowBench, ICLR 2025: <https://arxiv.org/abs/2411.05451>
- Reducing hallucination in structured outputs via RAG (ServiceNow), NAACL 2024 industry track:
  <https://arxiv.org/abs/2404.08189>
- DSL code generation, fine-tuning vs optimised RAG (Microsoft): <https://arxiv.org/abs/2407.02742>
- LLMRouterBench: <https://arxiv.org/abs/2601.07206> (via R04)
