# Kev decision inventory: every quick semantic decision in Foundry (2026-10-07)

*Development/diagnostic research note. HEAD `bbe4762` plus a working tree in which other agents
were editing `beds/records/`, `beds/kinetics/` and `beds/ownerci/` while this was written; line
numbers are as of 2026-10-07 ≈ 16:30 UTC. Companion to [01-kev-dossier.md](01-kev-dossier.md)
(what Kev is and how well it is documented to work). This file answers a different question:
**where in Foundry is a quick, bounded, semantic decision made today or required by the plan,
and which of those could Kev take.***

Evidence tags: **[M]** measured in this session (command and n given); **[D]** documented in a
repo file or in Kev's own docs (a claim by its author, not re-verified); **[I]** inferred.
Corpus text, bed task text and the Kev repository were read as data. No sealed bed was opened;
bed generators were called on the `dev` split only (seeds 1–3, difficulty 3).

## 0. What this means for the owner's question

The relayed request asks three things: can Foundry do without local models, can it avoid Haiku,
and what can Kev (the open Jev re-implementation, fine-tunable) do for quick semantic decisions.
This inventory does not decide; it gives the facts each answer depends on.

1. **Local generative models are already parked** on this VM: 268 s per extraction call and
   0.38–0.80 leaf agreement [D `docs/RESEARCH.md:114`]. Nothing in this inventory needs them back.
2. **Kev is a different kind of local model.** It runs one prefill pass and returns a probability
   over the options the caller offers; it never generates text. On this 4-core CPU it is quick only
   when the state is short [M, §1.1]:

   | State size (Kev-counted input tokens) | Questions | Wall time | n |
   |---|---|---|---|
   | ~150–190 (two `records` rows) | 1 | 1.2–2.1 s | 5 |
   | ~400–600 (six rows) | 1 | 2.5–14 s | 3 |
   | ~500–600 (six rows) | 4 | 6.8–42.6 s | 3 |
   | ~2,300–3,350 | 1–4 | 54–88 s | 2 |
   | ~8,300 (notes + whole d3 export) | 1 | 74 s | 1 |
   | same state again (cached prefix) | 1 / 4 | 0.63 s / 2.9 s | 2 |

   On a GPU the same model answers six short questions in ≈ 23 ms [D
   `/home/user/jaredpalmer/kev/README.md:385`]; this VM has no GPU.
3. **Stock Kev-0.8B is weak as a gate.** Its author reports 0.648/0.697 accuracy on new sources
   and only 14% of decisions automatable at a 5% error budget, against 52–69% for Kev-4B/9B/27B
   and 70% for Jev [D Kev `README.md:42-46`, `:216`]. The sibling dossier's development-suite
   runs put 0.8B near chance on injection detection and at 0.578 on grounding [D
   `01-kev-dossier.md:795-796`, `:828-829`]. So most decisions below would, untuned, mostly
   abstain to a hosted model.
4. **What Kev offers that a hosted call does not:** zero marginal dollars and no draw on the plan
   allowance that ran out on 2026-10-06 [D `README.md:62-66`]; output that cannot carry injected
   text (a distribution over offered options); many questions answered from one cached state; and
   a fine-tune path whose labels Foundry gets almost free from bed generators, oracles and replay.
   Fine-tuning wants a GPU (none here; no Modal credentials [D `README.md:126`]).
5. **On Haiku.** The non-Kev mechanism for every model decision below is a narrow structured call
   to a policy model. Measured on `records`, a single Haiku call fails where a single Sonnet call
   succeeds [D `README.md:51-52`]. The owner policy prices Sonnet 5.5 at **2×** Haiku per token
   ($2/$10 against $1/$5 per MTok [D `policy/models.json:44-47`]), not the "3–4×" stated in
   `research/distill-20261007/DESIGN.md:96`. Replacing Haiku by Sonnet in the narrow-call role
   therefore roughly doubles the token price of those calls [I]. Kev's case rests on the
   high-volume, short-state decisions in the shortlist (§5.2), not on replacing a generative executor.

## 1. Measured and documented context

### 1.1 Kev-0.8B latency probe [M]

- Server: `http://127.0.0.1:8008`, `/v1/models` reports `jaredpalmer/kev-0.8b@v1.0`, torch, CPU,
  fp32, temperature 2.351.
- Scripts (scratchpad, not committed): `kev-latency.mjs` (7 requests, `records` dev seed 1 d3)
  and `kev-latency2.mjs` (9 requests, dev seed 2 d3). Questions were `choice` yes/no.
- **Caveat.** The 1-minute load average was 3–4 on 4 cores throughout (16:16–16:25 UTC),
  because other agents were running. The spread (2.5 vs 14 s for similar six-row states) is mostly
  contention, so treat these as loaded-machine numbers. This probe also put 16 requests on the
  shared server during another agent's latency study; that study should discount this window. Its
  figures supersede these.
- Prior record: "≈ 1.4 s per question" [D `docs/RESEARCH.md:114`]. That matches only the
  short-state row.

### 1.2 Hosted-call cost and latency from existing journals [M]

Queried read-only from the experiment journals (`model_calls`, grouped by model):

| Journal | Call shape | Model | n | Mean latency | Mean $ / call |
|---|---|---|---|---|---|
| `experiments/runs/records-hand-pilot/journal.sqlite` | 6-row extraction node (≈2.8K in, ≈2.1K out) | Haiku 4.5 | 121 | 17.9 s (min 3.3 s) | 0.0152 |
| same | same node, escalations and Sonnet arms | Sonnet 5.5 | 20 | 6.2 s | 0.0211 |
| `experiments/runs/calibration/records.journal.sqlite` | whole `records` task, one call | Sonnet 5.5 | 6 | 50.5 s | 0.126 |
| same | same | Haiku 4.5 | 4 ok + 2 timeouts | 224 s | 0.150 |
| `experiments/runs/distill-pilot/journal.sqlite` | extraction replay | Qwen3.5-2B (local) | 4 | 125.9 s | 0 (imputed CPU) |

A minimal narrow structured Haiku call costs about $0.001–0.003 [D `README.md:71-73`]. Three
parallel Haiku agent nodes plus a code node and a verifier ran in 6.4 s for $0.009 [D
`README.md:47-48`]. The minimal Sonnet equivalent is unmeasured; at the policy's 2× it would be
about $0.002–0.006 [I].

### 1.3 Typical state sizes (bed generators, `dev` seed 1, difficulty 3) [M]

`scratchpad/bed-shapes.mjs`, tokens = UTF-8 bytes / 4 (the context compiler's heuristic):

| Bed | What a per-item judgment would read |
|---|---|
| records | 85 rows at 37.6 tok/row; notes 1,617; spec 1,880 |
| incident | 459 log lines at 26.2 tok/line (12,016 total); service map 903; ticket 95 |
| synth | 52 documents, mean 110 tok (max 212); prompt rules 1,745 |
| kinetics | 10 documents, mean 613 tok (max 839); register 200 |
| codefix | module 1,477 tok in ~37 `def` blocks (~40 tok each); bug thread 308; design notes 260; service log 2,935 |
| ownerci | module 1,873; test file 4,306; related sources 3,946; CI summary 1,034 |
| runbook | ticket 1,439; runbook 3,252; inventory 1,371; one observation ≈ 52 |
| gridquest | one room observation ≈ 166; journal 169 |
| gameqa | design doc 1,527; 20 reports ≈ 74 each; observation ≈ 315 |

n = 1 seed per bed, so these are indicative.

### 1.4 What exists in code for typed judgments [D]

- `JudgmentPort` with engines `rule | model | systemone` (`src/ports.mjs:57-112`). The `model`
  engine returns **self-reported, uncalibrated** confidence (`src/ports.mjs:93-94`).
- `SystemOneClient`, `JudgmentLedger` and `calibrationReport` (`src/judgment.mjs:13-131`).
- **Not wired into workflows.** The IR has no node kind that calls a `JudgmentPort`
  (`schemas/workflow.schema.json:99`; `src/validate.mjs:89-97`). Nothing outside tests constructs
  one (`grep JudgmentPort src` finds only `src/ports.mjs`). The ledger has no producer outside
  `tests/judgment.test.mjs`.
- Kev has no entry in `policy/models.json`, the declared "ONLY source of model ids" (line 5);
  `SystemOneClient` defaults to `kev-latest` (`src/judgment.mjs:15`). See H1.

## 2. Fit rubric

Kev may only **rank** (order candidates or checks), **gate** (accept, abstain or escalate) or
supply a **node value** that code consumes and an oracle later checks. It never promotes, completes
or grants (`docs/ROADMAP.md:368-369`; `docs/THESIS.md:220-227`). A port gates only after it beats
the rule and embedding baselines on held-out labels (`docs/ROADMAP.md:362-363`; C4 at `:643`).

| Fit | Meaning |
|---|---|
| **high** | Bounded options (2–64), short state (≲ 600 tok, so ≈ 1–3 s here), many instances, free labels, little world knowledge or arithmetic, bounded damage when wrong. A good first port. |
| **medium** | Right shape, but one of: long state (tens of seconds here), knowledge or arithmetic needed, weak documented 0.8B skill, scarce labels, or low volume. Worth it only after fine-tuning or on a larger Kev. |
| **low** | A code rule or an exact check does better, the volume is too small to matter, or the needed skill (code reading, spatial or temporal reasoning) is far beyond 0.8B. |
| **none** | Authority-bearing, deterministic by contract, or not a bounded choice (generation). |

"Labels" names the cheapest honest ground truth. **Generator truth** is unlimited on the `dev`
split but carries a contamination risk: the bed prose comes from finite templates
(`beds/gridquest/README.md:266`, `beds/kinetics/README.md:278`, `beds/records/README.md:337-342`, where a
57-line program written from the generator source passes 17/30 d3 test tasks), so a Kev fine-tuned
on it learns the templates. Any such gain is development evidence for that bed only. Claim-bearing numbers need
sealed families or held-out templates.

## 3. Summary table

Authority: **R** = rank, **G** = gate/abstain, **V** = node value checked downstream, **A** =
authority-bearing (Kev must not decide), **C** = consumes Kev's output. "Now" is the current
mechanism: code, LLM, human, or "—" (nothing built).

| ID | Decision | Where | Options | Auth. | Now | Volume | Labels | Fit |
|---|---|---|---|---|---|---|---|---|
| A0 | Serve an enum-output agent node by Kev, escalating below threshold | ROADMAP §2.1; operators.md §3 | any 2–64 | G/V | LLM node | per enum node × item | oracle, reference replay | high (shape) |
| A1 | Pairwise same-entity (blocked pairs) | operators.md §4; records-hand.mjs:91 | same/diff | V | code rule | 10²/task | generator | low (records), medium (elsewhere) |
| A2 | records: date order per system | records README:225-229 | dmy/mdy/ymd | V/G | hard-coded table (stale) | 3/task | generator | high |
| A3 | records: meaning of an extra status value | README:230-231 | void/live | V/G | Haiku `void` field | 2–6/task | generator | high |
| A4 | records: balance sign convention per system | README:234 | owed-to-us/by-us | V/G | none | ≤4/task | generator | high |
| A5 | records: are a system's update dates re-stamps? | README:232-233 | reliable/re-stamp | V/G | none | 1–2/task | generator | medium |
| A6 | records: country of a row | README:251-252 | ISO codes | V | Haiku field | ≤85/task | generator | medium (alias), low (city) |
| A7 | incident: fault class | incident README:22-32, 122-125 | 9 classes | V | model arm | 1–3/task | generator | medium |
| A8 | incident: error line origin vs relay | README:118-121 | origin/relay/unrelated | R | none | 50–300/task | generator tags | medium |
| A9 | incident: caller impacted vs fell back | README:129-131 | impacted/fallback/none | V | none | 6–18/task | generator | medium |
| A10 | synth: document status and target | synth README:46-52, 134-138 | retraction/erratum/supersedes/EoC/none | V | model arm | 30–70/task | generator | high (status) |
| A11 | synth: is this value a claim? | README:53-56, 143-145 | claim/quote/prediction/target/variant/off-condition | V | model arm | 50–150/task | generator | high |
| A12 | synth: condition equivalent to standard? | README:139-142 | yes/no | V | model arm | per claim | generator | medium |
| A13 | synth: entity identity (codes, near-names) | README:146-148 | entity ids | V | model arm | per mention | generator | medium |
| A14 | synth: venue/article type peer-reviewed? | README:59-66, 149-150 | yes/no (+tier) | V | model arm | per doc | generator | medium |
| A15 | kinetics: note type for SOP exclusion | kinetics README:169-173 | note-type enum | V | model arm | 20–100/task | generator | medium |
| A16 | kinetics: authority of a message | README:178-181 | author-correction/confirm/suggestion/withdrawal/none | V | model arm | 10–40/task | generator | medium |
| A17 | kinetics: condition description → register id | README:182-183 | 2–8 ids | V | model arm | per reference | generator | medium |
| A18 | kinetics: authoritative record | README:184-187 | current/superseded/pilot/blank/std | V | model arm | 2–7 docs/task | generator | medium |
| A19 | kinetics: units of a column | README:31-35, 167-168 | unit enums | V | model arm | per doc | generator | medium |
| A20 | codefix/ownerci: suspect-function ranking | codefix README:158-171; ownerci:191-209 | buggy/not (+ operator) | R | model arm | 20–40/task | generator mutation sites | low |
| A21 | codefix: bug-thread comment triage | codefix README:162-166, 184-197 | symptom/red-herring/injection/noise | R | model arm | 3–10/task | generator | medium |
| A22 | runbook: ticket-comment classification | runbook README:220-228 | change kinds / non-authoritative / noise | V | model arm | 5–20/task | generator plan | high |
| A23 | runbook: document precedence | README:229-233 | binding/stale/hearsay/tip | V | model arm | 10–30/task | generator | medium |
| A24 | runbook: observation classification | README:237-244, 128-141 | rejected/invalid/degraded/ok/… | V | model arm | 95–260/task | simulator | low |
| A25 | runbook: safety-rule applicability | README:101-127 | allowed/violates rule | A | model arm | per change | oracle | none |
| A26 | gridquest: which exits does this room have? | gridquest README:176-194 | 4 directions | R | model arm | 10–80/episode | generator world | medium |
| A27 | gridquest: is a container worth examining? | README:196 | yes/no | R | model arm | per container | generator | high |
| A28 | gridquest: is a note true? | README:199-200 | true/false | R | model arm | few | generator | low |
| A29 | gameqa: designed behaviour or bug? | gameqa README:155-172 | designed/bug | G | model arm | per anomaly | control build | medium |
| A30 | gameqa: evidence-pack report triage | README:173-184, 222-235 | hint/dup/stale/designed/wrong-detail/noise/injection | R | model arm | ~20/task | generator | medium |
| A31 | gameqa: bug class of a confirmed repro | README:66-80, 185-191 | 10 classes | V | model arm | ≤5/task | generator catalog | medium |
| A32 | gameqa/R08: are two findings the same bug? | R08:250, :298; gameqa README:227 | same/diff | R | — | O(findings²) | generator, replay | medium |
| B1 | E1: retry or escalate on schema failure | runtime.mjs:623-631 | retry/escalate | G | code | per failed call | — | none |
| B2 | E2: resample or escalate on check failure | runtime.mjs:633-641 | resample/escalate/fail | G | author-set | per failed check | replay | low |
| B3 | Cascade gate: is this output consistent with its input? | distill DESIGN:47-52 | yes/no | G | planned | per agent call | reference agreement | low (here) |
| B4 | Route this item: code-only, cheap or strong model | ROADMAP:533-534 | routes | G | fixed per node | per item | replay agreement | medium |
| B5 | Verify node, agent method | runtime.mjs:729-754 | pass/fail, score | G | LLM, other family | per verify | oracle | medium |
| B6 | Drift: is the observed state what step k expects? | THESIS:213; ROADMAP:440 | expected/drift | G | — | per step | replay, control | medium |
| B7 | Stuck or softlocked? | ROADMAP:320-321; R08:247 | progress/stuck/softlock | G | code rule (plan) | per K steps | branch test | low |
| B8 | Step gate: which action, and is the margin enough? | ROADMAP:463; R04:236 | legal actions | R/G | model arm | per step | replay, oracle | medium |
| B9 | Allocator: how many samples, or abstain? | ROADMAP:458-466 | N, abstain | C | — | per slice | oracle | low |
| B10 | Fork at uncertainty or continue? | ROADMAP:929; R04:236 | fork/continue/restart | G | — | per step | episode outcome | low |
| B11 | Abstain route: executor, stronger check or human | ROADMAP:351-352 | routes | C | — | per abstention | outcome | low |
| C1 | Failure class (sets check order) | THESIS:215; ROADMAP:421-434 | flake/variance/defect/env/impossible/finding | R | code map (partial) | per failed run | replay | medium |
| C2 | Failing test: flaky or real? | ROADMAP:654; ownerci README:211-216 | flaky/real | R | — | per failing test | rerun | low |
| C3 | Discovery anomaly: finding, harness fault or env | ROADMAP:84-85, 410-419 | 3 classes | R | verify + codes | per anomaly | control replay | medium |
| C4 | Which node to substitute first | ROADMAP:431-434 | node ranking | R | — | per defect | substitution replay | medium |
| C5 | L3 patch kind | ROADMAP:442 | 6 kinds | R | frontier | per defect | replay | low |
| C6 | Error code → verdict | verdict.mjs:25-38 | 6 verdicts | V | code | per run | — | none |
| C7 | Provider error class | claude-cli.mjs:46-49; port.mjs:69 | codes | V | regex | per error | — | none |
| C8 | Contract unsatisfiable → owner | ROADMAP:430 | yes/no | A | code (plan) | rare | — | none |
| C9 | Agent repair diagnostic | outcome-repair.mjs:317-342 | — | A | untrusted text | per repair | — | none |
| D1 | Applicability of a kept workflow | THESIS:212; RESEARCH:98 | yes/no per precondition | G | — | per candidate × task | oracle after reuse | medium (shape high) |
| D2 | Choice among candidates (propensity) | THESIS:214; ROADMAP:522-527 | candidates | R | — | per task | outcome (OPE) | medium |
| D3 | Rerank retrieved candidates | ROADMAP:504-505, 522 | ranking | R | — (kNN plan) | per task | outcome | low |
| D4 | Task features from trusted fields | ROADMAP:520, 527 | feature enums | V | — | per task | human, outcome | medium |
| D5 | Is this task an instance of a recurring family? | ROADMAP:474 | yes/no | R | — | per task | recurrence | medium |
| D6 | Reuse, construct, delegate or cascade | ROADMAP:509-513 | 4 actions | R | — | per task | outcome | medium |
| D7 | Deopt during reuse: is this instance outside W's envelope? | ROADMAP:490; THESIS:189-191 | in/out | G | — | per reuse | oracle | medium |
| D8 | Admission to the library | ROADMAP:473-478 | admit/reject | A | — | per workflow | evidence | none |
| D9 | Promotion ladder and demotion breaker | ROADMAP:494-499 | stage | A | — (code plan) | per workflow | counts | none |
| D10 | Re-qualify after a fingerprint change | ROADMAP:501-502 | yes/no | A | code (plan) | per change | — | none |
| D11 | Merge or retire near-duplicate workflows | ROADMAP:443 | merge/keep | R | — | rare | outcome | low |
| D12 | Domain skill pack for construction | foundry.mjs:127-143 | skill domains | V | caller-given | per design | construction outcome | medium |
| E1 | Context selection: which items a node needs | THESIS:218; ROADMAP:220 | per item yes/no | R | — (deferred) | per call × items | ablation replay | medium |
| E2 | Which input to truncate first on overflow | context.mjs:109-121 | ranking | R | author priority | per overflow | ablation replay | low |
| E3 | Quarantined read of untrusted content | ROADMAP:271-274, 548 | bool/enum | V | LLM node | per untrusted branch | oracle | high (structure) |
| E4 | Is this span an instruction aimed at the agent? | bed READMEs; ROADMAP:452 | yes/no | R (alarm) | none | per line/doc | generator tags | medium |
| E5 | Integrity label of an input | core DESIGN:89 | trusted/untrusted | A | declared | per input | — | none |
| E6 | Endorse a sink-policy violation | ROADMAP:546-547 | refuse/endorse | A | human | rare | — | none |
| F1 | Requirements named by an objective | construction-objective.mjs:21-34, 103-112 | 12 noul | V | regex | per objective | hand labels | high |
| F2 | Is the objective ungrounded? | construction-objective.mjs:36-39 | yes/no | G | regex | per objective | hand labels | medium |
| F3 | Is an ambiguity consequential (ask the owner)? | ROADMAP:376-378, 400-406 | yes/no | G | frontier builder | per contract | owner answers | low |
| F4 | Computable or judgment, per requirement | SKILL.md:17-21 | code/judge/agent | R | frontier builder | per requirement | construction outcome | low |
| F5 | Which standard operator fits a sub-problem | ROADMAP:382-389; operators.md | 9+ operators | R | frontier builder | per sub-problem | construction outcome | low |
| F6 | Engine and class per node (Kev, Sonnet, Opus) | SKILL.md:41-46; policy:51-56 | engines | R | builder + distill | per node | screening | medium |
| F7 | Probe-failure cause | SKILL.md:48-51 | format/instruction/batch/other | R | frontier builder | per failure | next score | low |
| F8 | Foundry workflow, script or direct agent for this family | construction DESIGN:8-22 | F/B1/B0 | R | experiment | per family | C0 results | low |
| F9 | Spend a /score check now? | services.mjs:45-55 | yes/no | R | builder | ≤12/construction | score | none |
| F10 | Leakage of probe or held-out literals | construction.mjs:240-258; kit.mjs:48-56 | leak/clean | A | literal scan | per build | — | low |
| F11 | Motif closeness | construction.mjs:282-320 | present/absent | V | code | per candidate | — | none |
| F12 | Is a generated check non-vacuous? | ROADMAP:393-394 | yes/no | A | mutation controls | per oracle | — | none |
| G1 | Corpus domain tags | orchestration-common.py:72-90; COVERAGE:549 | ~10 noul | V | regex | 1,342 items | hand sample | high |
| G2 | Corpus node category | science-common.py:102-111; orchestration-gha.py:59-80 | 13 categories | V | rules | 78,278 nodes | hand sample | medium |
| G3 | Motif semantics (pairwise vs map-reduce; best-of-N vs sectioning) | COVERAGE:430, 432 | 2-way | V | none | ~237 items | hand sample | medium |
| G4 | Oracle tier | coverage-report.mjs:260-264 | T0–T3 | V | rule | 1,342 | — | none |
| G5 | Licence of a source | orchestration-common.py:224-250 | SPDX ids | A | string match | 148 unknown | human | low |
| G6 | Description quality for the pilot | COVERAGE:505-507 | ordered score | R | heuristic | 131 eligible | human | medium |
| G7 | Transcript: oracle-access or gaming attempt? | construct.mjs:77; construction DESIGN:86-87 | yes/no | R (alarm) | regex | 100s of tool calls/build | human review | medium |
| G8 | B0+N notes: general lessons or task answers? | b0-call.mjs:19-27; b0-agent.mjs:58-72 | general/leaky | R (alarm) | instruction only | per notes update | human | medium |
| G9 | Bed audit: ambiguous prose or shortcut? | bed AUDIT.md files | yes/no | R | human auditors | per bed | auditors | low |
| G10 | Cost or latency anomaly | README cost ledger; services.mjs Ledger | anomaly/normal | R | none | per call | — | none |
| G11 | Node agreement in distillation | distill.mjs:39-60 | agree/disagree | V | exact leaf match | per replay | — | none |
| H1 | Which Kev weights a ledger row came from | policy/models.json:5; judgment.mjs:15 | — | — | server name | per row | — | n/a |
| H2 | Human answers and approvals | ROADMAP:188; human nodes | — | A | human | — | — | none |
| H3 | Decision-card explanation | ROADMAP:570-572 | — | — | UI (plan) | — | — | none |
| H4 | Reports and regression tests (generation) | R08:252-253 | — | — | LLM | — | — | none |
| H5 | Visual pass on frames | R08:196-209 | — | G | VLM (plan) | — | — | none |
| H6 | Persona or curriculum choice for explorers | R08:242-243, 263-284 | personas | R | — | per stall | coverage gain | low |

Counts: 100 decision points. By the first word of the fit column: high 11, medium 43, low 24,
none 21, n/a 1. A0 counts as high (shape), A1 and B3 as low, D1 as medium.

## 4. Decision points

Every entry uses the same fields. **Q:** the question. **Opt:** options or scale. **State:**
what Kev would read and its size. **Use:** who consumes the answer and with what authority.
**Now:** the current mechanism, its cost and latency. **Err:** what a false accept and a false
abstain cost. **Vol:** volume. **Lab:** the label source. **Fit:** Kev fit with one reason.

### A. Node-level judgments inside workflows

Workflow authors could use these as typed `judge` nodes. Most come from what the bed tasks
themselves demand of a solver. Every bed task decision below is currently made by whatever arm
solves the task: a single model call (B0), an agent (B0 agent), a builder-written script (B1) or a
builder-designed workflow (F). The C0 development round that would show the F arm's choices has
not run: the `experiments/runs/c0-dev/journal.sqlite` journal is empty [M].

#### A0. Serve an enum-output agent node by Kev, with escalation
- **Where:** agent node `ROADMAP.md:122-133`. Operator "classify with an enum (cascade)" in
  `skills/micro-harness/references/operators.md:14-17`. `JudgmentPort` in `src/ports.mjs:57-112`
  exists, but no IR node calls it (`schemas/workflow.schema.json:99`).
- **Q:** For an agent node whose `returns` is a bounded enum or boolean, can Kev answer instead of
  a generative model, escalating to Sonnet (or Opus) below a calibrated threshold?
- **Opt:** the node's enum (2–64 values). Kev's `choice` takes 1–255 [D Kev `README.md:261`];
  Foundry's port takes 2–64 (`src/ports.mjs:51`).
- **State:** the node's compiled inputs (S class budget ≈ 4K tokens, `policy/models.json:57`).
- **Use:** the node value, consumed by code and checked by node checks and the oracle (V/G).
- **Now:** ModelPort on Haiku or Sonnet; ≈ $0.001–0.003 and a few seconds per minimal Haiku
  call [D `README.md:47-48`, `:71-73`].
- **Err:** a confidently wrong enum flows into code; it is caught only if a node check or the
  oracle catches it. A false abstain costs one hosted call.
- **Vol:** each enum node × each map item.
- **Lab:** oracle outcome (end to end), plus reference-replay agreement (`experiments/lib/distill.mjs:39-60`).
- **Fit:** **high in shape.** It needs a `judge` node kind (or an `agent` engine field) with
  `threshold` and `onAbstain`, journaled like model calls. Value depends on the node: see A2–A32.

#### A1. Pairwise same-entity judgment
- **Where:** operator §4 (`operators.md:18-21`). In `records` the code rule is
  `experiments/workflows/records-hand.mjs:91` (name distance ≤ 1 after nickname and transliteration
  folding) and `:152-159` (link by DOB, else phone).
- **Q:** Do these two records describe the same real entity?
- **Opt:** same / different (`noul`).
- **State:** two normalised rows, ≈ 80–120 tokens (37.6 tok/row [M]).
- **Use:** union-find in code (V).
- **Now:** code rule, ≈ 0 cost.
- **Err:** a false merge drops an entity, and `extra`/`missing` must be 0 at d1–d3
  (`beds/records/README.md:157-160`). A false abstain sends the pair to a hosted call.
- **Vol:** O(pairs after blocking), roughly 10² per d3 task [I].
- **Lab:** generator truth (world clusters).
- **Fit:** **low for `records`.** The truth there is defined as the spec's own rule applied to
  parsed fields (`beds/records/README.md:167-175`, "Truth = the spec's rules applied to the structured world"), so exact code beats
  any learned judge once the fields are parsed. The ablation table shows the danger of tolerance
  changes (`lenient-names` 3–23% pass at d3–d5, `README.md:285`). **Medium** for families without a
  stated identity rule (operator §4 in general).

#### A2. `records`: numeric date order per system
- **Where:** `beds/records/README.md:225-229`. The P1 hand workflow hard-codes
  `DATE_ORDER = { BRIGHTDESK: 'mdy', LEDGR: 'dmy', VERITAS: 'iso' }`
  (`experiments/workflows/records-hand.mjs:121`). That is stale for bed v3, where the order is
  drawn per task at d ≥ 3; the records audit already notes this (`beds/records/AUDIT.md:97-98`).
- **Q:** In this task, which numeric date order does system S use?
- **Opt:** `dmy` / `mdy` / `ymd`.
- **State:** S's paragraph of the source notes (a slice of the 1,617-token notes [M]). The order
  may be given explicitly, by example, by reference to another system, by locale, by the servers'
  country or the team's city, or by negation (`README.md:225-228`).
- **Use:** the code date parser (V).
- **Now:** a hard-coded table, or the model's reading inside the extraction call.
- **Err:** a false accept misreads every date of S. The `atlas-flipped`/`bd-flipped` ablations
  pass 0–3% (`README.md:265-267`). A false abstain costs one Sonnet call.
- **Vol:** 3 per task (d ≥ 3).
- **Lab:** generator truth.
- **Fit:** **high.** Three options, a short state, few but decisive decisions, and a
  natural-language reading Kev was trained for. "By city" and "by the servers' country" need world
  knowledge 0.8B lacks [D Kev `README.md:212`]; expect abstains there. "By reference to another
  system" needs two paragraphs in the state.

#### A3. `records`: meaning of an extra status value
- **Where:** `beds/records/README.md:230-231` (eight paraphrases per meaning, some only by
  comparison); traps at `:328-331` (`gesperrt` blocked but live; labels that suggest the opposite
  meaning).
- **Q:** Does status value X mean the row is void (not migrated) or live?
- **Opt:** void / live.
- **State:** the notes sentence(s) about X, ≈ 50–200 tokens.
- **Use:** a code filter over rows (V).
- **Now:** the `void` field of the Haiku extraction (`records-hand.mjs:235`), read per row rather
  than per status value.
- **Err:** both directions fail the task. `flags-flipped` passes 0%, `unknown-flags-live` 0%,
  `blocked-is-void` 40–80% (`README.md:268-269`, `:277`).
- **Vol:** 2–6 status values per task. Deciding once per value, not once per row, is itself the
  win.
- **Lab:** generator truth.
- **Fit:** **high.** Binary, short, decisive, with paraphrase variety that suits a reader rather
  than a regex.

#### A4. `records`: balance sign convention per system
- **Where:** `beds/records/README.md:234` ("print balances from the other side", in paraphrase).
- **Q:** Does system S print positive balances as owed to us or owed by us?
- **Opt:** owed-to-us / owed-by-us.
- **State:** S's notes paragraph, ≈ 100–300 tokens.
- **Use:** code amount parser (V).
- **Now:** nothing. `parseAmount` only reads credit markers (`records-hand.mjs:133-143`).
- **Err:** `perspective-ignored` passes 0% at d3–d5 (`README.md:271`).
- **Vol:** ≤ 4 per task.
- **Lab:** generator truth.
- **Fit:** **high.** Same shape as A2 and A3.

#### A5. `records`: are a system's update dates re-stamp dates?
- **Where:** `beds/records/README.md:232-233` (one system re-stamps; another has a red-herring
  sentence about reliable dates).
- **Q:** Are system S's update timestamps reliable for conflict order, or re-stamps?
- **Opt:** reliable / re-stamp.
- **State:** S's notes paragraph.
- **Use:** code conflict ordering (V).
- **Now:** nothing. The hand workflow orders by `updated` as given (`records-hand.mjs:150`, `:182`).
- **Err:** `mirror-ignored` passes 0% at d3–d5 (`README.md:270`).
- **Vol:** 1–2 per task.
- **Lab:** generator truth.
- **Fit:** **medium.** The red-herring sentence reuses the same vocabulary, which is the
  minimal-pair case where 0.8B is weakest [D `01-kev-dossier.md` §2.3–2.4].

#### A6. `records`: country of a row
- **Where:** `beds/records/README.md:251-252`. English or German names, aliases, confusable codes
  (AUS/AUT, Schweiz/Schweden), typos, and from d3 one of 342 cities.
- **Q:** Which country does this row's country token (or city) mean?
- **Opt:** ISO alpha-2 codes of the pool (tens), plus "none".
- **State:** one token or short phrase plus its system, ≈ 20–40 tokens.
- **Use:** a field value (V).
- **Now:** Haiku extraction field (`records-hand.mjs:238`).
- **Err:** one wrong field is tolerated (`README.md:157`). `country-from-phone` passes 40% at d3
  (`README.md:290`).
- **Vol:** up to one per row (85 at d3), fewer after code maps exact ISO tokens.
- **Lab:** generator truth.
- **Fit:** **medium** for aliases, German names and typos; **low** for cities, which are
  world-knowledge questions [D Kev `README.md:212`, `:414`]. A code alias table plus edit distance
  is the baseline to beat.

#### A7. `incident`: fault class
- **Where:** `beds/incident/README.md:22-32` (the 9 classes) and `:122-125` (paraphrased; siblings
  confusable; chronic decoy vocabulary).
- **Q:** Given the root service's own log lines, which fault class is this?
- **Opt:** 9 classes.
- **State:** the root's lines, after code has filtered the 459-line log (26.2 tok/line [M]) to one
  service: ≈ 20–100 lines, 0.5–2.6K tokens.
- **Use:** an answer field, oracle-graded (V).
- **Now:** a model arm. Script baselines reach ≤ 4/60 at d ≥ 3 (`README.md:139-145`).
- **Err:** a wrong class fails the task. A false abstain costs one Sonnet call.
- **Vol:** 1 per task, or 1 per candidate root (2–4) if used to rank roots.
- **Lab:** generator truth.
- **Fit:** **medium.** A small choice and decisive, but the state is long for this CPU (tens of
  seconds), and sibling-class pairs are minimal pairs.

#### A8. `incident`: is an error line an origin or a relay?
- **Where:** `beds/incident/README.md:118-121` (callers blame their callee; relayed text carries
  the root's vocabulary; DNS and pool roots name healthy services).
- **Q:** Does this line report a failure originating in the emitting service, one relayed from a
  callee, or nothing relevant?
- **Opt:** origin / relay / unrelated.
- **State:** one line plus the alias row for its service, ≈ 40–80 tokens.
- **Use:** ranks candidate roots for a code blame-graph traversal (R).
- **Now:** nothing (no workflow); baselines count ERROR lines (0/60 at every level,
  `README.md:139-145`).
- **Err:** mis-ranked roots cost search time, not correctness, if code checks the graph.
- **Vol:** 50–300 error and warning lines per task [I from 459 lines].
- **Lab:** generator line tags (`beds/incident/gen.mjs:798-799`, `idsByTag`).
- **Fit:** **medium.** Short state and high volume suit Kev. With a single cached system map in
  the state, many line questions are cheap. But origin versus relay sometimes needs cross-line
  context.

#### A9. `incident`: is a caller impacted, or did it fall back?
- **Where:** `beds/incident/README.md:129-131` (optional dependencies log fallbacks and are not
  impacted).
- **Q:** Is service X impacted by the fault, or did it fall back?
- **Opt:** impacted / fell back / unrelated.
- **State:** X's lines after T, ≈ 0.3–1K tokens.
- **Use:** answer list (V).
- **Now:** a model arm.
- **Err:** a wrong member fails the impacted-set check (`README.md:73-76`).
- **Vol:** 6–18 per task.
- **Lab:** generator truth.
- **Fit:** **medium.** The fallback lines are lexical, so a code rule may suffice. That rule is
  the baseline.

#### A10. `synth`: document status and target
- **Where:** `beds/synth/README.md:46-52` (void rules: retraction, later version, expression of
  concern voids nothing) and `:134-138` (status only in other documents' prose; targets by quoted
  title from level 3).
- **Q1:** What is this document (retraction notice / erratum / supersession / expression of
  concern / ordinary)?
- **Q2:** Which candidate document does it target?
- **Opt:** 5 statuses; Q2 is a choice over code-proposed candidates (by title and author overlap),
  plus "not in corpus".
- **State:** one document, ≈ 110 tokens (max 212) [M], plus candidate titles for Q2.
- **Use:** the code void set and `excluded_doc_ids` (V).
- **Now:** a model arm.
- **Err:** `retracted-claims-used` and `superseded-kept` controls fail every task
  (`README.md:164-165`).
- **Vol:** 30–70 documents per task.
- **Lab:** generator truth.
- **Fit:** **high** for Q1 (short, classification-shaped, high volume). **Medium** for Q2: the
  candidate list grows, and "a retraction of an article not in the corpus" needs a reliable
  none-of-these. Per the dossier, prefer a separate `noul` [D `01-kev-dossier.md:856-857`].

#### A11. `synth`: is this value a claim?
- **Where:** `beds/synth/README.md:53-56` (definition) and `:143-145` (quotes, predictions,
  design targets, salts and mutants).
- **Q:** Is this value one the document measured itself, on the entity itself, under the standard
  condition?
- **Opt:** claim / quote / prediction / design target / variant entity / non-standard condition.
- **State:** one sentence with its value plus the entity's standard condition, ≈ 60–150 tokens.
- **Use:** filters the table candidates (V).
- **Now:** a model arm.
- **Err:** `quotes-counted`, `variants-counted` and `conditions-ignored` each fail tasks
  (`README.md:166`, `:171`, `:173`).
- **Vol:** 50–150 value mentions per task [I from 52 documents].
- **Lab:** generator truth.
- **Fit:** **high.** This is the clearest Kev shape in the beds: short, high-volume, a reading of
  attribution and modality rather than knowledge. Split the condition test into A12 so that
  arithmetic stays in code.

#### A12. `synth`: is a condition equivalent to the standard condition?
- **Where:** `beds/synth/README.md:139-142` ("pure water at 298.15 K" vs "phosphate buffer
  (pH 7.4) at 25 °C").
- **Q:** Does the stated condition match the property's standard condition?
- **Opt:** yes / no.
- **State:** two short phrases, ≈ 30–60 tokens, after code converts temperatures and units.
- **Use:** claim filter (V).
- **Now:** a model arm.
- **Err:** `conditions-ignored` scores 0.65–0.77 and fails (`README.md:166`).
- **Vol:** per claim.
- **Lab:** generator truth.
- **Fit:** **medium.** It is fine once code has done the unit arithmetic. Kev's documented weakness
  is arithmetic [D Kev `README.md:212`, `:369`].

#### A13. `synth`: entity identity
- **Where:** `beds/synth/README.md:146-148` (codes mapped in documents; near-name distractors one
  vowel and two digits apart).
- **Q:** Which requested entity, if any, does this mention refer to?
- **Opt:** requested entities plus "other".
- **State:** mention plus the code-mapping sentence, ≈ 50–150 tokens.
- **Use:** V.
- **Now:** a model arm.
- **Err:** `near-name-merged` fails (`README.md:172`).
- **Vol:** per mention.
- **Lab:** generator truth.
- **Fit:** **medium.** Near-names one vowel apart are a character-level comparison, better done by
  code edit distance; Kev helps for the "code X stands for Y" mapping sentences.

#### A14. `synth`: venue or article type peer-reviewed?
- **Where:** `beds/synth/README.md:59-66` (journal "Letters", "Full papers" are peer reviewed)
  and `:149-150`.
- **Q:** Is this document peer-reviewed, and at which ranking tier?
- **Opt:** yes / no (P4 needs 3 tiers).
- **State:** venue and type fields, ≈ 20 tokens.
- **Use:** ranking key in code (V).
- **Now:** a model arm.
- **Err:** a wrong winner per cell.
- **Vol:** per document.
- **Lab:** generator truth.
- **Fit:** **medium.** A code table covers known types. Kev covers only unseen type names, and its
  value is small.

#### A15. `kinetics`: note type for the SOP exclusion
- **Where:** `beds/kinetics/README.md:169-173` (bubble timing, OVR/SAT flags, re-reads,
  temperature offsets, possibly in Kelvin).
- **Q:** What kind of event does this note report?
- **Opt:** bubble / reader flag / clean re-read / temperature deviation / withdrawal / not an
  exclusion event.
- **State:** one note, ≈ 30–120 tokens.
- **Use:** code applies the SOP criterion (times, thresholds) per well (V).
- **Now:** a model arm.
- **Err:** one wrong load-bearing well fails the task (`README.md:195-196`).
- **Vol:** 20–100 notes per task [I from 10 documents at ≈ 613 tok each].
- **Lab:** generator truth.
- **Fit:** **medium.** Type classification is Kev-shaped. Whether the criterion *holds* depends on
  clock times and temperature deltas, which must stay in code; Kev is weak at both [D Kev
  `README.md:369`].

#### A16. `kinetics`: authority of a message
- **Where:** `beds/kinetics/README.md:178-181` (only the author corrects; a colleague's suggestion
  counts only once the author confirms; mentions are not corrections).
- **Q:** What role does this message play for the entry it mentions?
- **Opt:** author correction / author confirmation / colleague suggestion / withdrawal /
  unrelated mention.
- **State:** the message plus the entry author's name, ≈ 50–150 tokens.
- **Use:** code applies corrections (V).
- **Now:** a model arm.
- **Err:** honouring a rejected suggestion moves a well (`README.md:137-145`).
- **Vol:** 10–40 messages per task [I].
- **Lab:** generator truth.
- **Fit:** **medium.** Short state, but "structural red herrings" are minimal pairs by design
  (`README.md:141`).

#### A17. `kinetics`: condition description → register id
- **Where:** `beds/kinetics/README.md:182-183` (Kelvin, bench colours, "vehicle only", "the coldest
  condition").
- **Q:** Which register condition does this description name?
- **Opt:** 2–8 register ids.
- **State:** the description plus the register (≈ 200 tokens [M]).
- **Use:** V.
- **Now:** a model arm.
- **Err:** data assigned to the wrong condition.
- **Vol:** per reference.
- **Lab:** generator truth.
- **Fit:** **medium.** Superlatives and Kelvin need numeric comparison. Code should normalise first
  and leave Kev only the colour codes and names.

#### A18. `kinetics`: authoritative record
- **Where:** `beds/kinetics/README.md:184-187` (current SOP not superseded; raw export over
  transcription; study wells, not `PLT-`/`BLK-`/`STD-`).
- **Q:** Is this document authoritative for the study?
- **Opt:** current SOP / superseded SOP / raw export / transcription / pilot / other.
- **State:** a document's header lines, ≈ 50–150 tokens.
- **Use:** V.
- **Now:** a model arm.
- **Err:** the superseded SOP excludes LOW and edge wells (`README.md:211-215`).
- **Vol:** 2–7 per task.
- **Lab:** generator truth.
- **Fit:** **medium.** Low volume. Well prefixes are regex-able.

#### A19. `kinetics`: units of a column
- **Where:** `beds/kinetics/README.md:31-35` (units in headers, comments, sentences, after values,
  or by reference) and `:167-168`.
- **Q:** What unit is this column in?
- **Opt:** concentration and rate unit enums.
- **State:** the header or preamble, ≈ 30–150 tokens; a by-reference case needs the other sheet.
- **Use:** code conversion (V).
- **Now:** a model arm.
- **Err:** every value of the column is wrong by 10³.
- **Vol:** per document.
- **Lab:** generator truth.
- **Fit:** **medium.** Easy when local. Cross-document references ("same template as X's sheet")
  are multi-hop reading.

#### A20. `codefix` / `ownerci`: suspect-function ranking
- **Where:** `beds/codefix/README.md:158-171` (symptoms, not lines; uncovered bugs; decoys on
  correct lines); operators at `:26-27`. `beds/ownerci/README.md:191-209` (hidden-only mutants at
  d4+).
- **Q:** Does this function violate its docstring and the design notes? If so, which mutation
  operator?
- **Opt:** buggy / not; operator among 6.
- **State:** one function (≈ 40 tok per `def` block [M]) plus its doc paragraph, ≈ 150–500
  tokens.
- **Use:** orders functions for a Sonnet fixer (R). Tests and oracle decide.
- **Now:** a model arm.
- **Err:** a missed bug fails the hidden suite. A false flag costs one fixer call.
- **Vol:** 20–40 functions per task.
- **Lab:** generator mutation sites.
- **Fit:** **low** for 0.8B. Finding an off-by-one or a swapped comparator by reading code is far
  beyond its documented skill. Ownerci modules are real Foundry code at 1.9K tokens. Revisit with
  Kev-4B or larger.

#### A21. `codefix`: bug-thread comment triage
- **Where:** `beds/codefix/README.md:162-166` (red-herring requests contradict the docstring),
  `:184-197` (bot injections, decoys).
- **Q:** Is this comment a genuine symptom, a red herring contrary to documented behaviour, an
  instruction aimed at the agent, or noise?
- **Opt:** 4 classes.
- **State:** the comment plus the relevant docstring, ≈ 100–300 tokens.
- **Use:** the fixer's context (R).
- **Now:** a model arm.
- **Err:** following the red herring fails the hidden suite (`README.md:165-166`).
- **Vol:** 3–10 comments per task.
- **Lab:** generator truth.
- **Fit:** **medium.** Short, but detecting the contradiction with the docstring is entailment
  over code semantics.

#### A22. `runbook`: ticket-comment classification
- **Where:** `beds/runbook/README.md:220-228` (scope from prose and authority; legacy host names;
  only exact owner or approver handles count; the latest authorised comment wins; plausible
  non-authoritative proposals).
- **Q:** What does this comment do to the change parameters?
- **Opt:** re-include node / reserve node / set version / set value / skip step / retract earlier
  amendment / proposal without authority / no change.
- **State:** one comment, ≈ 40–150 tokens. The handle check stays in code (exact match, including
  the look-alike `@<owner>-cab` at d5, `README.md:266`).
- **Use:** code settles parameters (V).
- **Now:** a model arm.
- **Err:** a scope or version error breaks `SCOPE` or end-state checks (`README.md:101-127`).
- **Vol:** 5–20 comments per task [I from a 1,439-token ticket].
- **Lab:** generator (hidden plan).
- **Fit:** **high.** Short and classification-shaped. Authority (who) stays in code; Kev reads
  only what the comment says.

#### A23. `runbook`: document precedence
- **Where:** `beds/runbook/README.md:229-233` (stale CMDB roles, release notes vs ticket, handover
  hearsay, legacy notes and field tips labelled as such).
- **Q:** Is this statement binding, stale, hearsay or an informal tip?
- **Opt:** 4 classes.
- **State:** one statement plus its document type, ≈ 30–100 tokens.
- **Use:** V.
- **Now:** a model arm.
- **Err:** "skip the second reading" or "restart the primary first" breaks safety rules
  (`README.md:260-270`).
- **Vol:** 10–30 per task.
- **Lab:** generator truth.
- **Fit:** **medium.** The source document type mostly decides it. A code rule ("only the runbook
  and authorised ticket parameters bind", `README.md:268-269`) is a strong baseline.

#### A24. `runbook`: observation classification
- **Where:** `beds/runbook/README.md:237-244` (REJECTED by policy vs INVALID VALUE; degraded
  readings; lag) and `:128-141` (paging conditions).
- **Q:** What does this tool observation report?
- **Opt:** rejected-by-policy / invalid value / degraded / healthy / lag high / permanent failure /
  transient failure.
- **State:** one observation, ≈ 50 tokens [M].
- **Use:** code state machine (V).
- **Now:** a model arm.
- **Err:** a missed page or a `NOISE_PAGE`.
- **Vol:** 95–260 actions per task at d3+ (`README.md:245-250`).
- **Lab:** simulator truth.
- **Fit:** **low.** Simulator messages are templated, so regex in code is exact. The exception is
  injected log tails (E4).

#### A25. `runbook`: safety-rule applicability before a change
- **Where:** `beds/runbook/README.md:101-127` (16 rules checked at every replayed step).
- **Q:** Does this action, in the current state, violate a safety rule?
- **Opt:** allowed / violates rule X.
- **Use:** blocks or permits an effect. **Authority-bearing.**
- **Now:** a model arm.
- **Fit:** **none.** Once the parameters are settled (A22, A23) the rules are deterministic
  predicates and belong in code. A probabilistic judge must not authorise an effect.

#### A26. `gridquest`: which exits does this room have?
- **Where:** `beds/gridquest/README.md:176-194` (landmark-relative exits, bricked-up versus
  reopened archways, direction words everywhere, described state).
- **Q:** For each direction, is there a usable exit?
- **Opt:** 4 `noul`s, or a choice over directions.
- **State:** one room observation, ≈ 166 tokens [M].
- **Use:** an action prior for a code explorer (R). The environment is the truth.
- **Now:** a model arm.
- **Err:** a false exit wastes a move (budget 2–3× optimal); a missed exit can strand the explorer.
- **Vol:** 10–80 room visits per episode.
- **Lab:** generator world.
- **Fit:** **medium.** Short state and many decisions favour Kev. But resolving "across the room
  from the sand timer" needs two-hop spatial reading, and clause order decides
  bricked-up/reopened. These are the minimal pairs 0.8B is weakest at. The grammar is finite
  (`README.md:266`), so a fine-tune would likely learn it and the gain would not transfer.

#### A27. `gridquest`: is a container worth examining?
- **Where:** `beds/gridquest/README.md:196` (only cued containers hide anything; some cued ones are
  empty).
- **Q:** Is this container described with a cue?
- **Opt:** yes / no.
- **State:** one sentence, ≈ 20–40 tokens.
- **Use:** R.
- **Now:** a model arm.
- **Err:** a wasted `examine`, or a missed key.
- **Vol:** a few per room.
- **Lab:** generator truth.
- **Fit:** **high.** Short and lexical-semantic. Empty decoys are acceptable, because the
  environment answers.

#### A28. `gridquest`: is a journal note or graffito true?
- **Where:** `beds/gridquest/README.md:199-200` (every true wording also occurs as a false note).
- **Fit:** **low.** By construction the wording carries no signal; only checking against the keep
  does. Kev can only rank which note to check first.

#### A29. `gameqa`: designed behaviour or bug?
- **Where:** `beds/gameqa/README.md:155-172` (ten designed quirks; errata supersede the main text).
- **Q:** Given the specification, is this observed behaviour a bug?
- **Opt:** designed / bug.
- **State:** the behaviour description plus the spec with errata (1,527 tokens [M]), ≈ 1.6–2K
  tokens. The spec can be the shared cached state across questions.
- **Use:** whether to pursue and report (G). The oracle replays on the control build.
- **Now:** a model arm.
- **Err:** a false report, or a missed bug.
- **Vol:** per candidate anomaly, ≈ 5–30 per task [I].
- **Lab:** control-build replay; generator catalog.
- **Fit:** **medium.** The cached-spec pattern makes repeated questions cheap (≈ 0.7 s each after
  the first read [M]). Errata precedence is rule composition, a documented 0.8B weakness [D
  `01-kev-dossier.md:788`].

#### A30. `gameqa`: evidence-pack report triage
- **Where:** `beds/gameqa/README.md:173-184` and `:222-235`.
- **Q:** What kind of report is this?
- **Opt:** true hint / duplicate / stale ticket / designed behaviour filed as bug / real with wrong
  detail / wish or noise / injection.
- **State:** one report, ≈ 74 tokens [M], or all 20 as one cached state.
- **Use:** orders the exploration (R).
- **Now:** a model arm.
- **Err:** time spent on decoys, or a skipped real lead.
- **Vol:** ≈ 20 per task.
- **Lab:** generator truth.
- **Fit:** **medium.** Short and plentiful. "Designed behaviour" needs the spec (A29), and
  "duplicate" needs the other reports.

#### A31. `gameqa`: bug class of a confirmed repro
- **Where:** `beds/gameqa/README.md:66-80` (10 classes over 13 templates) and `:185-191`
  (confusable pairs).
- **Q:** Which class is this bug?
- **Opt:** 10 classes.
- **State:** repro summary plus the observed effect, ≈ 100–300 tokens.
- **Use:** an answer field (V).
- **Now:** a model arm.
- **Err:** the oracle requires the class (`README.md:190-191`).
- **Vol:** ≤ 5 per task.
- **Lab:** generator catalog.
- **Fit:** **medium.** It is a classification, but the confusable pairs ("a door that eats its
  key") need the effect described precisely. Volume is small.

#### A32. Finding deduplication
- **Where:** R08 node 12 (deterministic signature + embeddings + LLM,
  `research/landscape-20261006/08-worked-example-ai-game-qa.md:250`); findings deduplicated as they
  arrive (`:298`); duplicates in the gameqa pack (`beds/gameqa/README.md:227`).
- **Q:** Are these two findings the same bug?
- **Opt:** same / different.
- **State:** two finding summaries, ≈ 100–200 tokens.
- **Use:** ledger merge (R). Wrong merges become split proposals (R08:250).
- **Now:** nothing built.
- **Err:** a lost distinct bug, or a duplicate report.
- **Vol:** O(findings²) after signature blocking.
- **Lab:** generator bug ids; repro replay.
- **Fit:** **medium.** Pairwise and short, with natural blocking by signature first.

### B. Runtime control

#### B1. E1: retry or escalate after a schema failure
- **Where:** `src/runtime.mjs:623-631`; `docs/ROADMAP.md:319`.
- **Now:** code over error codes (`MODEL_SCHEMA`, `MODEL_TRUNCATED`), zero cost.
- **Fit:** **none.** Deterministic and correct by contract.

#### B2. E2: resample or escalate after a node-check failure
- **Where:** `src/runtime.mjs:633-641`. Policy set per node by the author
  (`research/core-20261006/DESIGN.md:33`).
- **Q:** Is this failure sampling variance (resample) or a capacity gap (escalate)?
- **Opt:** resample / escalate / fail.
- **State:** input, failed output and the failed check, ≈ 1–5K tokens.
- **Use:** G.
- **Now:** a static author choice.
- **Err:** a wasted resample, or a needless escalation.
- **Vol:** per failed check, low.
- **Lab:** resample outcomes from replay.
- **Fit:** **low.** Long state, low volume. A per-node statistic (resample success rate) is the
  obvious baseline.

#### B3. Cascade gate: is this output consistent with its input?
- **Where:** `research/distill-20261007/DESIGN.md:47-52` (planned Kev gate, admissible only if it
  flags ≥ 90% of disagreeing outputs).
- **Q:** Is the cheap model's typed output consistent with the input?
- **Opt:** consistent / not.
- **State:** input plus output. For the records extraction node that is ≈ 2.8K in plus 2.1K out
  [M, journal], about 5K tokens.
- **Use:** escalate below threshold (G).
- **Now:** E1/E2 only.
- **Err:** a false accept passes a wrong extraction downstream. A false abstain costs the strong
  call anyway.
- **Vol:** per agent call (14 chunks for a d3 task [I]).
- **Lab:** reference agreement (`experiments/lib/distill.mjs:39-60`).
- **Fit:** **low on this VM.** A 5K-token state takes ≈ 60–75 s here [M], longer than the
  17.9 s mean Haiku call it gates. Field-level disagreements are exact-string comparisons 0.8B
  does badly. Grounding is 0.578 at 0.8B [D `01-kev-dossier.md:795-796`]. **Medium** with
  Kev-4B on a GPU.

#### B4. Item-level routing before the call
- **Where:** `docs/ROADMAP.md:533-534` ("node-level class downgrades are a separate decision
  trained on node-level verified labels"); `research/distill-20261007/DESIGN.md` §3.
- **Q:** Is this item easy enough for the cheap path?
- **Opt:** code-only / cheapest model / strong model (with Haiku dropped: code-only / Sonnet /
  Opus; or Kev judge / Sonnet for enum nodes).
- **State:** the item alone, ≈ 50–600 tokens (a 6-row chunk is ≈ 250 [M]).
- **Use:** G. The routed path is still checked.
- **Now:** one class per node for all items.
- **Err:** a false "easy" yields a wrong item (caught by checks or the oracle). A false "hard"
  costs a strong call.
- **Vol:** per item: rows, lines, documents.
- **Lab:** replay agreement per item from distillation references.
- **Fit:** **medium.** Short state and high volume, and the labels come from replay. It has value
  only when the routes differ a lot in cost. If Haiku is dropped, the Sonnet/Opus gap is 2× per
  token (`policy/models.json:46-49`). The code-only vs model gap stays large.

#### B5. Verify node, agent method
- **Where:** `src/runtime.mjs:729-754` (fixed `{pass, score, reasons}` returns; the
  different-model family check at `:697-707`); `research/core-20261006/DESIGN.md:66-80`; THESIS
  verifier port (`docs/THESIS.md:216`).
- **Q:** Does the subject meet the contract, and how well?
- **Opt:** an ordered score (`score` type) or pass/fail.
- **State:** the subject plus the contract, often several thousand tokens.
- **Use:** a gate within the run (`VERIFY_FAILED` → inconclusive). It never establishes
  completion.
- **Now:** an LLM of another family. The Claude-only policy cannot satisfy `different-model` for
  Claude producers [I from `policy/models.json:44-49`, one family].
- **Err:** a false pass lets a wrong answer through (the oracle still grades). A false fail makes
  the run inconclusive.
- **Vol:** per verify node.
- **Lab:** the oracle.
- **Fit:** **medium.** Kev (Qwen family) is the only non-Claude model left once local generative
  models are parked, so it is the only engine that can satisfy `different-model` today [I]. It
  cannot return `reasons`. Its judging skill at 0.8B is 0.66 [D `01-kev-dossier.md:817`]. As a
  gate it may block; it must never be the evidence for promotion.

#### B6. Drift or expectation check
- **Where:** `docs/THESIS.md:213`; adaptation ladder L2 (`docs/ROADMAP.md:440`); R08 node 6
  ("divergence before the check point → drift, not a verdict",
  `research/landscape-20261006/08-worked-example-ai-game-qa.md:244`).
- **Q:** Is the observed state what step k expects?
- **Opt:** expected / drifted.
- **State:** expectation plus observation, ≈ 100–500 tokens.
- **Use:** triggers L2 adaptation (G).
- **Now:** nothing built.
- **Err:** a missed drift lets a stale workflow run on. A false drift wastes adaptation budget.
- **Vol:** per step in interactive or reused workflows.
- **Lab:** replay; control build.
- **Fit:** **medium.** Short and high-volume, but it is a grounding question, where 0.8B is weak.
  Per-expectation `noul`s, combined in code, are the documented-safer form [D
  `01-kev-dossier.md:797-798`].

#### B7. Stuck or softlocked?
- **Where:** rule E (same action 3×, or 80% of the step budget) at `docs/ROADMAP.md:320-321`;
  R08 node 9, decided by a branch test (`08-…:247`).
- **Fit:** **low.** The code rule plus a branch test decides. Kev could only rank which escape to
  try.

#### B8. Step gate: action choice and its margin
- **Where:** `docs/ROADMAP.md:463` ("gate per step by vote margin (CATTS)");
  `research/landscape-20261006/04-routing-allocation-verification-security.md:236`.
- **Q:** Which legal action, and is the distribution peaked enough to act without arbitration?
- **Opt:** legal actions (13 in gridquest, 15 in gameqa, 9 kinds in runbook [M]).
- **State:** observation plus a short memory, ≈ 200–600 tokens.
- **Use:** R/G.
- **Now:** a model arm.
- **Err:** a wasted move, or a needless arbitration call.
- **Vol:** per step: tens to hundreds.
- **Lab:** episode outcome; replay.
- **Fit:** **medium.** Kev's README demos exactly this (legal moves as choice options) [D Kev
  `README.md:236`]. Option order moves answers [D Kev `README.md:416`].

#### B9. Allocator: how many samples, or abstain
- **Where:** `docs/ROADMAP.md:458-466` (α, β, p per slice; N = 0 when πV ≤ (1−π)C_fp).
- **Fit:** **low.** The allocator consumes calibrated rates per slice. Kev can supply a per-item p̂
  but does not make the decision.

#### B10. Fork at uncertainty or continue
- **Where:** `docs/ROADMAP.md:929` (frontier bet H9); `04-…:236`.
- **Fit:** **low.** Kev's confidence could trigger the fork, but the bet is unmeasured and its
  value depends on snapshot cost.

#### B11. Route after an abstention
- **Where:** `docs/ROADMAP.md:351-352` (below threshold: route to an executor, a stronger check or
  a human).
- **Fit:** **low.** It consumes Kev's abstention. The route is a policy choice per port.

### C. Failure handling

#### C1. Failure class, used to order checks
- **Where:** `docs/THESIS.md:215`; classifier order `docs/ROADMAP.md:421-434`. Today
  `src/verdict.mjs:25-38` maps error codes to verdicts; the classifier itself is not built
  (Phase 4, `docs/ROADMAP.md:879-889`).
- **Q:** Which cause is most likely: flake, model variance, workflow defect, environment,
  impossible, or finding?
- **Opt:** 6 classes.
- **State:** a compact failure record (verdict, error code, failing node, last events,
  environment-fingerprint diff), ≈ 200–800 tokens.
- **Use:** orders replay checks (R); replay decides (`docs/ROADMAP.md:421-422`).
- **Now:** deterministic codes give a partial answer; nothing orders the checks.
- **Err:** a bad order costs extra replays, never a wrong verdict.
- **Vol:** per failed run (tens per experiment).
- **Lab:** replay outcomes.
- **Fit:** **medium.** Low risk because replay decides. Kev never trained on this taxonomy, so the
  zero-shot lift is likely small; it is the dossier's best fine-tune candidate [D
  `01-kev-dossier.md:809-815`]. Labels accumulate slowly (one per failed run).

#### C2. Failing test: flaky or real?
- **Where:** IDoFT flaky-test bed (`docs/ROADMAP.md:654`); the flaky-retry noise line in `ownerci`
  (`beds/ownerci/README.md:211-216`).
- **Fit:** **low.** Reruns decide cheaply. Kev only orders which test to rerun first, at small
  volume.

#### C3. Discovery anomaly: finding, harness fault or environment
- **Where:** `docs/ROADMAP.md:84-85` (a game crash is a finding; a broken selector is a harness
  fault) and `:410-419`. `src/verdict.mjs:29-32` counts confirmed findings.
- **Q:** Is this anomaly a product bug, a harness defect or an environment fault?
- **Opt:** 3 classes.
- **State:** the anomaly record, ≈ 200–500 tokens.
- **Use:** R; control-build replay confirms.
- **Now:** verify nodes and error codes.
- **Err:** a mis-ordered investigation.
- **Vol:** per anomaly.
- **Lab:** control-build replay.
- **Fit:** **medium.**

#### C4. Which node to substitute first
- **Where:** `docs/ROADMAP.md:431-434` (substitute outputs "following the judged order", then
  delta-debug).
- **Q:** Which node's output is most likely wrong?
- **Opt:** a ranking over nodes (one `noul` per node on its input/output pair).
- **State:** per node, its input and output summary, ≈ 200–1K tokens.
- **Use:** R.
- **Now:** nothing.
- **Err:** extra substitutions only.
- **Vol:** per defect × nodes.
- **Lab:** substitution replay.
- **Fit:** **medium.**

#### C5. L3 patch kind
- **Where:** `docs/ROADMAP.md:442` (prompt delta, tighter schema, added verify node, guard,
  strategy swap, class change).
- **Fit:** **low.** Low volume. A frontier proposer writes the patch anyway, and the replay gates
  decide.

#### C6. Error code → verdict
- **Where:** `src/verdict.mjs:8-38`; `src/runtime.mjs:42-50`.
- **Fit:** **none.** A deterministic mapping by design.

#### C7. Provider error class
- **Where:** `src/models/providers/claude-cli.mjs:46-49`; `src/models/port.mjs:69` (regex on rate-limit
  text).
- **Fit:** **none.**

#### C8. Contract unsatisfiable on a known-good example → owner
- **Where:** `docs/ROADMAP.md:430`.
- **Fit:** **none.** Authority-bearing escalation, decided by an executed check.

#### C9. Agent repair diagnostic
- **Where:** `src/outcome-repair.mjs:317-342` (diagnostic text is "untrusted commentary; not a new
  requirement, consent, policy or success oracle").
- **Fit:** **none.** It is deliberately not a decision input.

### D. Library and selection

None of this layer is built yet (Phase 5, `docs/ROADMAP.md:892-898`).

#### D1. Applicability of a kept workflow
- **Where:** `docs/THESIS.md:212` and `:205-207`. The motivating failure is the 0/21 skills arm
  with 21 false successes (`docs/RESEARCH.md:98`).
- **Q:** Does task T satisfy workflow W's semantic preconditions?
- **Opt:** one `noul` per precondition, combined in code [D `01-kev-dossier.md:789-791`].
- **State:** task text (trusted fields) plus one precondition, ≈ 300–2K tokens.
- **Use:** G (abstain → construct or delegate).
- **Now:** nothing.
- **Err:** a false accept is wrong reuse: the headline metric, with a 2% target and a 5%
  falsifier (`docs/ROADMAP.md:641`, `:728`). A false abstain costs a construction or
  delegation.
- **Vol:** per candidate workflow × task, capped by the utility guard (`docs/ROADMAP.md:504-505`).
- **Lab:** oracle outcome after reuse; with/without comparisons.
- **Fit:** **medium.** The shape is ideal, but the accuracy bar is the strictest in the inventory,
  and stock 0.8B automates 14% at a 5% error budget [D Kev `README.md:216`]. Expect near-total
  abstention until fine-tuned. Ledger-labelled data arrives only with Phase 5 reuse.

#### D2. Choice among candidates, with logged propensity
- **Where:** `docs/THESIS.md:214`; `docs/ROADMAP.md:522-527`.
- **Q:** Which candidate workflow, strategy or executor?
- **Opt:** candidates.
- **State:** task features plus candidate summaries, ≈ 300–1.5K tokens.
- **Use:** R. The logged propensity feeds off-policy evaluation.
- **Now:** nothing.
- **Err:** off-policy estimates are biased if the propensity is wrong. Kev's p is a valid
  propensity only if actions are sampled from it [D `01-kev-dossier.md:801-803`].
- **Vol:** per task.
- **Lab:** outcomes.
- **Fit:** **medium.**

#### D3. Rerank retrieved candidates
- **Where:** kNN in `docs/ROADMAP.md:522`; candidate cap at `:504-505`.
- **Fit:** **low.** Retrieval-style choices are weak at 0.8B [D `01-kev-dossier.md:807-808`]. The
  embedding kNN is the baseline.

#### D4. Task features from trusted fields
- **Where:** `docs/ROADMAP.md:520` (features from trusted fields only), `:527` (decision schema
  v1), taint rules at `:544-546`.
- **Q:** Typed facts about the task: domain, interactive or one-shot, has files, needs an env,
  output kind.
- **Opt:** several small enums in one request.
- **State:** the task prompt, ≈ 200–1.8K tokens (bed prompts are 203–1,745 tokens [M]).
- **Use:** V (features for kNN and Thompson sampling).
- **Now:** nothing.
- **Err:** noisy features dilute selection.
- **Vol:** per task.
- **Lab:** human labels; outcome attribution.
- **Fit:** **medium.** Many questions per prefill is exactly Kev's design. Kev's low-capacity output
  is also the declassification route if a feature has to read untrusted text
  (`docs/ROADMAP.md:271-274`).

#### D5. Is this task an instance of a recurring family?
- **Where:** recurrence evidence for admission (`docs/ROADMAP.md:474`).
- **Fit:** **medium.** A pairwise "same family?" over task summaries (short), labelled by later
  reuse outcomes. Volume is small until a library exists.

#### D6. Reuse, construct, delegate or cascade
- **Where:** `docs/ROADMAP.md:509-513`.
- **Fit:** **medium.** It is the action-level form of D1 plus D2. Kev can rank; the hard guards
  and the risk bound decide.

#### D7. Deopt during reuse
- **Where:** deopt and fallback rate (`docs/ROADMAP.md:490`); false reuse (`docs/THESIS.md:189-191`).
- **Q:** Does this instance contain a feature none of W's verified runs had?
- **Opt:** inside / outside the envelope.
- **State:** the instance plus W's envelope summary.
- **Use:** G (deopt to construction or an executor).
- **Now:** nothing.
- **Err:** a missed deopt is wrong reuse.
- **Vol:** per reuse.
- **Lab:** oracle.
- **Fit:** **medium.**

#### D8–D10. Admission, promotion and demotion, re-qualification
- **Where:** `docs/ROADMAP.md:473-478`, `:494-499`, `:501-502`.
- **Fit:** **none.** These are authority-bearing and evidence-counted (runs, CIs, fingerprints).
  Judgments never promote (`docs/ROADMAP.md:368-369`).

#### D11. Merge or retire near-duplicate workflows
- **Where:** `docs/ROADMAP.md:443`.
- **Fit:** **low.** Rare. A structural hash and diff do most of it.

#### D12. Domain skill pack for construction
- **Where:** `src/foundry.mjs:127-143`. It loads `domain-${domain}`, taken from the caller or the
  base workflow, default `general`.
- **Q:** Which domain skill pack fits this task?
- **Opt:** installed domain packs (`skills/domain-*`).
- **State:** the task text.
- **Use:** V (builder context).
- **Now:** caller-given.
- **Err:** a wrong or missing domain skill in the builder context.
- **Vol:** per design request.
- **Lab:** construction outcome (weak, confounded).
- **Fit:** **medium.** Cheap and short. The labels are weak.

### E. Context system

#### E1. Context selection: which shared items a node needs
- **Where:** `docs/THESIS.md:218` (AMP already uses Jev this way); `reads` in
  `docs/ROADMAP.md:220`; deferred to Phase 6 (`research/core-20261006/DESIGN.md:237-239`).
- **Q:** Does node N need item i?
- **Opt:** one `noul` per item, sharing one state.
- **State:** N's instructions plus the item list, ≈ 1–8K tokens.
- **Use:** R (the context compiler includes the top items within budget).
- **Now:** nothing.
- **Err:** a dropped needed item degrades the node; an extra item costs tokens.
- **Vol:** per call × items.
- **Lab:** ablation replay (expensive).
- **Fit:** **medium.** Mechanically ideal, but retrieval quality at 0.8B is weak [D
  `01-kev-dossier.md:832-836`], and labels are costly.

#### E2. Which input to truncate first on overflow
- **Where:** `src/context.mjs:109-121` (lowest author-set `priority` first).
- **Fit:** **low.** Author priorities are explicit and replay-stable. A learned order would make
  the prompt depend on a model (receipt stability, `docs/ROADMAP.md:249-252`).

#### E3. Quarantined read of untrusted content
- **Where:** `docs/ROADMAP.md:271-274` and `:548`; `research/core-20261006/DESIGN.md:157-166`
  (≤ 64 bits of output; integer percent confidences); `src/context.mjs:128` (declassification);
  `src/validate.mjs:200-201`.
- **Q:** Any bool or enum question about untrusted content that must drive control flow.
- **Opt:** bool, enum, bounded number.
- **State:** the untrusted span plus the question.
- **Use:** V. Declassified to `trusted`.
- **Now:** an LLM agent node with an enum schema, whose text channel the compiler must constrain.
- **Err:** a steered answer flips one enum; the damage is bounded by design.
- **Vol:** wherever untrusted data chooses a branch.
- **Lab:** oracle.
- **Fit:** **high on structure.** A Kev answer is a distribution over offered options and cannot
  carry text [D `01-kev-dossier.md:826-827`], so it satisfies the 64-bit rule without schema
  gymnastics. Whether injected text sways its probabilities is unmeasured [D `01-kev-dossier.md:830`].
  Use it only where one wrong enum is bounded damage.

#### E4. Is this span an instruction aimed at the agent?
- **Where:** injected content in every bed. Records memos (`beds/records/README.md:306-319`),
  incident `inject`/`mislead` lines (`beds/incident/README.md:150-162`), codefix bot comments
  (`beds/codefix/README.md:184-192`), kinetics chat (`beds/kinetics/README.md:207-215`), runbook bot
  and log tails (`beds/runbook/README.md:260-270`), synth level-5 note
  (`beds/synth/README.md:189`), gameqa injections (`beds/gameqa/README.md:222`). The plan's
  related check is a literal scan for oracle strings (`docs/ROADMAP.md:452`).
- **Q:** Is this line instruction-like text addressed to an automated agent?
- **Opt:** yes / no.
- **State:** one line or comment, ≈ 20–80 tokens.
- **Use:** an alarm and annotation (R). Removal only where the task contract says data never
  instructs. Structural defences stay primary (P9, `docs/THESIS.md:127`; the untrusted preamble in
  `src/context.mjs:8`).
- **Now:** none.
- **Err:** a missed injection matters only if the structural defence fails. A false flag can hide
  evidence if used for removal.
- **Vol:** every line of untrusted data (hundreds per task).
- **Lab:** generator tags (`beds/incident/gen.mjs:798-799`; fixed template lists such as
  `beds/records/README.md:308-316`).
- **Fit:** **medium.** Zero-shot 0.8B is near chance on held-out injection carriers (0.41–0.46)
  [D `01-kev-dossier.md:828-829`]. Fine-tuned on bed templates it would likely learn them, but
  that does not transfer (§2). Never a security boundary.

#### E5. Integrity label of an input
- **Where:** workflow `labels` (`research/core-20261006/DESIGN.md:89`).
- **Fit:** **none.** Labels must be declared. A model choosing trust labels defeats the label
  system.

#### E6. Endorse a sink-policy violation
- **Where:** `docs/ROADMAP.md:546-547` (refuse, or a human endorses).
- **Fit:** **none.** Authority-bearing.

### F. Construction

#### F1. Which requirements does an objective name?
- **Where:** `src/construction-objective.mjs:21-34` (12 regex cues) and `:103-112`
  (`extractRequirements`). It feeds `requiredMotifsFor` (`:506-521`).
- **Q:** Does this objective require human gates, high-risk handling, durable waits,
  compensation, branching, recovery, isolation, a pre/post LLM gate, fan-out, loops, research
  grounding, verification?
- **Opt:** 12 `noul`s in one request.
- **State:** the objective text, ≈ 30–300 tokens.
- **Use:** V. It sets which motifs the candidate must show, and is checked by structural closeness.
- **Now:** regex. Examples: `\bif\b` → branching, `each|every` → map-fanout, `statements?` →
  high-risk (`:23`, `:26`, `:30`). Cost 0, latency ≈ 0.
- **Err:** a false requirement over-constrains the build; a missed one under-checks it.
- **Vol:** per objective (bundled programs and C0 objectives).
- **Lab:** hand labels on a frozen objective set.
- **Fit:** **high.** Short, multi-question, low-stakes, and the current regexes are visibly over-
  and under-triggering. Kev answers all 12 from one prefill in ≈ 2–5 s here [I from §1.1]. The
  regex is the baseline it must beat.

#### F2. Is the objective ungrounded?
- **Where:** `src/construction-objective.mjs:36-39` and `:106-108` (only "telepathy" and "magic"
  cues).
- **Fit:** **medium.** "Does this need a capability no registered tool provides?" is a better
  question than two regexes. It needs the capability list in state (≈ 1–2K tokens), and labels are
  hand-made.

#### F3. Is an ambiguity consequential enough to ask the owner?
- **Where:** `docs/ROADMAP.md:376-378` and `:400-406`.
- **Fit:** **low.** Rare. The frontier builder is already reading the task, and the owner's answers
  are the only labels.

#### F4. Computable or judgment, per requirement
- **Where:** `skills/micro-harness/SKILL.md:17-21`.
- **Fit:** **low.** Part of the builder's design reasoning. Kev could pre-tag, but it adds little.

#### F5. Which operator fits a sub-problem
- **Where:** `docs/ROADMAP.md:382-389`; `skills/micro-harness/references/operators.md` (9
  operators); corpus candidates (`research/corpus-20261006/COVERAGE.md:420-460`).
- **Fit:** **low.** It is a ranking aid for an Opus builder that reads the operator list anyway.
  Labels are construction outcomes, confounded.

#### F6. Engine and class per node
- **Where:** `skills/micro-harness/SKILL.md:41-46`; `policy/models.json:51-56`; the C0 builder may
  assign Haiku, Sonnet or Opus (`research/construction-20261006/PREREG-dev.md:112`); distillation
  screening (`research/distill-20261007/DESIGN.md` §3).
- **Q:** Should this node be a Kev judge, a Sonnet call or an Opus call?
- **Opt:** engines and classes.
- **State:** node spec plus sample inputs.
- **Use:** R. Screening and end-to-end confirmation decide.
- **Now:** the builder's choice, then measurement.
- **Err:** a bad prior only costs screening time.
- **Vol:** per node.
- **Lab:** screening agreement.
- **Fit:** **medium**, as a prior for which nodes to screen on Kev at all. Volume is small.

#### F7. Cause of a probe failure
- **Where:** `skills/micro-harness/SKILL.md:48-51` (format code should own, instruction gap, batch
  too large).
- **Fit:** **low.** The builder reads the failing nodes directly. Few decisions per build.

#### F8. Foundry workflow, script or direct agent for this family
- **Where:** `research/construction-20261006/DESIGN.md:8-22`.
- **Fit:** **low.** This is what C0 measures. A per-family choice with a handful of families gives
  nothing to learn from.

#### F9. Spend a /score check now?
- **Where:** `experiments/lib/services.mjs:45-55` (≤ 12 per construction).
- **Fit:** **none.** The builder decides inside its own reasoning. Gating it would change the
  experiment.

#### F10. Leakage of probe or held-out literals
- **Where:** `src/construction.mjs:240-258`; `experiments/lib/kit.mjs:48-56`;
  `research/construction-20261006/DESIGN.md:80-81`.
- **Fit:** **low.** Literal and digest scans are exact. Paraphrased leakage is a possible Kev alarm,
  but it is not a gate.

#### F11. Motif closeness
- **Where:** `src/construction.mjs:282-320`.
- **Fit:** **none.** Structural inspection plus scenario replay.

#### F12. Is a generated check non-vacuous?
- **Where:** `docs/ROADMAP.md:393-394` (known-good, known-bad, mutant and double-mutant controls).
- **Fit:** **none.** Executed controls decide. A judge here would weaken a locked grader.

### G. Experiments and infrastructure

#### G1. Corpus domain tags
- **Where:** `research/corpus-20261006/scripts/orchestration-common.py:72-90`, and per-cluster
  `domains_of` functions. "Domain tags are keyword heuristics and over-tag"
  (`research/corpus-20261006/COVERAGE.md:549`).
- **Q:** Does this workflow belong to domain d?
- **Opt:** ≈ 10 `noul`s per item.
- **State:** title, description and node-type summary, ≈ 100–500 tokens.
- **Use:** V (coverage statistics and pilot quotas).
- **Now:** regex.
- **Err:** skewed coverage tables.
- **Vol:** 1,342 items, about 1–2 h of CPU in one run here [I from §1.1].
- **Lab:** a hand-labelled sample.
- **Fit:** **high.** An offline batch with no latency constraint, a known-noisy baseline, and short
  states.

#### G2. Corpus node category
- **Where:** `research/corpus-20261006/scripts/science-common.py:102-111`;
  `orchestration-gha.py:59-80`; category table `COVERAGE.md:264-280`.
- **Q:** Which of 13 categories is this node?
- **Opt:** trigger, action, transform, … (13).
- **State:** node type, label and parameters, ≈ 20–100 tokens.
- **Use:** V.
- **Now:** per-platform rules.
- **Err:** wrong motif statistics.
- **Vol:** 78,278 nodes. At ≈ 1.5 s each that is ≈ 33 h on this CPU [I], so it is only viable for
  rule-ambiguous nodes.
- **Lab:** a hand sample.
- **Fit:** **medium.**

#### G3. Motif semantics
- **Where:** `research/corpus-20261006/COVERAGE.md:430` (pairwise judgment "not separable from §1
  by structure alone (needs node semantics)") and `:432` (best-of-N vs sectioning look the same).
- **Q:** Is this map body a pairwise comparison or an extraction? Are these parallel model calls
  samples of one prompt or different prompts?
- **Opt:** 2-way choices.
- **State:** the node prompts, ≈ 200–1K tokens.
- **Use:** V (operator mining, `docs/ROADMAP.md:777-778`).
- **Now:** nothing.
- **Vol:** ≈ 237 items (the 109 and 128 shape matches).
- **Lab:** a hand sample.
- **Fit:** **medium.**

#### G4. Oracle tier
- **Where:** `research/corpus-20261006/scripts/coverage-report.mjs:260-264`.
- **Fit:** **none.** A four-line rule over declared fields.

#### G5. Licence of a source
- **Where:** `research/corpus-20261006/scripts/orchestration-common.py:224-250`; 148 unknown
  (`COVERAGE.md:58`).
- **Fit:** **low.** Redistribution is a legal decision. The conservative rule plus a human decides.
  Kev may only flag which unknown licence texts look like a known SPDX licence.

#### G6. Description quality for the pilot shortlist
- **Where:** `research/corpus-20261006/COVERAGE.md:505-507` (ranking by description quality;
  descriptions are the binding constraint).
- **Q:** Is this description specific enough to construct the workflow from?
- **Opt:** an ordered score (3–5 levels).
- **State:** the description, ≈ 20–200 tokens.
- **Use:** R (shortlist ranking, then a human freezes it).
- **Now:** a length heuristic.
- **Vol:** 131 eligible items.
- **Lab:** a hand sample.
- **Fit:** **medium.**

#### G7. Builder transcript: oracle access or gaming attempt?
- **Where:** `experiments/c0/construct.mjs:77` (regex over tool inputs for repository, bed and
  corpus paths); `research/construction-20261006/DESIGN.md:86-87`; "LLM auditors raise alarms only"
  (`docs/ROADMAP.md:456`).
- **Q:** Does this tool call try to reach hidden paths, probe the scorer adversarially, or
  hard-code probe answers?
- **Opt:** yes / no (or an attempt type).
- **State:** one tool call, ≈ 50–300 tokens.
- **Use:** an alarm (R). It never feeds fitness.
- **Now:** regex, cost 0.
- **Err:** a missed gaming attempt can invalidate a C0 result. A false alarm costs a human look.
- **Vol:** hundreds of tool calls per construction.
- **Lab:** human review of flagged calls.
- **Fit:** **medium.** It catches non-literal attempts the regex misses, but stays an alarm only.

#### G8. B0+N notes: general lessons or task answers?
- **Where:** notes rewrite prompts (`experiments/lib/arms/b0-call.mjs:19-27`;
  `experiments/lib/arms/b0-agent.mjs:58-72`) say "general lessons only".
- **Q:** Do these notes contain instance-specific answers?
- **Opt:** general / leaky.
- **State:** the notes, ≤ 200 words.
- **Use:** an alarm on the B0+N baseline's validity (R).
- **Now:** the instruction only.
- **Vol:** one per task per stream.
- **Lab:** a human sample.
- **Fit:** **medium.**

#### G9. Bed audit aids
- **Where:** independent audits (`beds/*/AUDIT.md`); hand-checked prose
  (`beds/records/README.md:335-350`).
- **Fit:** **low.** One possible use: Kev's answer instability under option permutation
  (`/v1/systemone/permute`, Kev `README.md:271`) as a smell for ambiguous prose rules. Auditors
  decide.

#### G10. Cost or latency anomaly
- **Fit:** **none.** These are numeric outliers; statistics in code.

#### G11. Node agreement in distillation
- **Where:** `experiments/lib/distill.mjs:39-60`.
- **Fit:** **none.** An exact leaf comparison is the declared screen. A semantic-equivalence judge
  would loosen a measurement.

### H. Other

- **H1. Model identity for Kev ledger rows.** Kev has no entry in `policy/models.json` (line 5:
  "the ONLY source of model ids"). The port records `systemOneModel ?? body.model`
  (`src/ports.mjs:80`), and the client defaults to `kev-latest` (`src/judgment.mjs:15`). The ledger
  must name the exact weights for calibration and fine-tuning to mean anything. This is a
  governance gap, not a decision point. It is also listed in `01-kev-dossier.md:888-891`.
- **H2. Human answers and approvals.** `human` nodes, single-use resume tokens
  (`docs/ROADMAP.md:188`). Fit: **none**.
- **H3. Decision-card explanations.** `docs/ROADMAP.md:570-572`. Fit: **none** (explanations
  come from logged evidence).
- **H4. Reports and regression tests.** R08 nodes 13–14 (`08-…:252-253`). These are generative.
  Fit: **none**.
- **H5. Visual pass on frames.** R08 check ladder (`08-…:196-209`). Kev is text-only. Fit:
  **none**.
- **H6. Explorer persona or curriculum choice.** R08 nodes 4–5 (`08-…:242-243`) and personas
  (`:263-284`). Fit: **low**. Coverage-gain bandits in code are the natural mechanism.

## 5. Cross-cutting findings

### 5.1 What the inventory shows

1. **Most good Kev decisions are inside workflows (layer A), and none of them can use Kev today.**
   There is no `judge` node, the `JudgmentPort` is not wired into the runtime, and the ledger has
   no producer (§1.4). Using Kev anywhere in A or B first needs one IR addition, journaled like
   `agent` calls: a judge node (port, question, options, state refs, `threshold`, `onAbstain`).
2. **Kev's best pattern here is "one state, many questions".** Cached follow-ups cost
   ≈ 0.6–0.7 s each, against 54–88 s for a fresh 2–3K-token state [M].
   - Per-item judgments that share a context should be asked against one cached state: all synth
     documents' statuses, all gameqa reports, all F1 requirements.
   - The current port sends one question per request (`src/ports.mjs:78`;
     `01-kev-dossier.md:892-893`).
   - Long per-item states (B3, B5, D1 with long tasks) are slow here regardless.
3. **The decisive, few-per-task notes readings are the cleanest first target.** These are A2–A5
   in `records`, plus the similar ones in `kinetics` (A18, A19) and `runbook` (A22).
   - Each is a 2–8-way choice over a 50–300-token paragraph.
   - Each ablation shows a single wrong reading failing nearly every task
     (`beds/records/README.md:264-271`).
   - The labels are free from the generator.
   - Being few, they also tolerate a Sonnet fallback on every abstention at negligible cost.
4. **Free generator labels make fine-tuning feasible but contaminating.** A Kev fine-tuned on
   `dev`-split generator truth will learn the bed's finite templates
   (`beds/gridquest/README.md:266`; `beds/kinetics/README.md:278`).
   - Such gains are development evidence (AGENTS.md "Evidence and evaluation").
   - Claim-bearing evidence needs the sealed families or held-out template pools.
   - Oracle and replay labels from real runs (C1, C3, C4, D1) transfer better, but accumulate
     slowly.
5. **Code rules beat Kev wherever the task defines truth as a rule.** Examples: records identity
   (A1), runbook safety (A25), verdict mapping (C6). Kev's role there is parsing the inputs to the
   rule, never applying it (P1, `docs/THESIS.md:119`).
6. **Authority stays clean.** Every decision that grants, admits, promotes or authorises an effect
   (A25, C8, D8–D10, E5, E6, F12, H2) is out of scope for Kev by the THESIS rule, and none of them
   needs a semantic judgment that could not be made by code or a human.

### 5.2 First-pass shortlist

These have the best ratio of fit to effort. All are development evidence until a sealed or
held-out-template test exists.

| Rank | ID | Why first | Kev time per task here [I from §1.1] |
|---|---|---|---|
| 1 | A2–A5 records notes readings | decisive, few, short, free labels | ≈ 5–15 s (≈ 10 short questions) |
| 2 | A11 + A10(Q1) synth claim-ness and document status | high volume, short, classification-shaped | ≈ 1–3 min (one cached state of all 52 docs ≈ 6K tokens, then ≈ 0.7 s per question) |
| 3 | A22 runbook comment classification | short, authority split cleanly into code | ≈ 10–30 s |
| 4 | F1 objective requirements | regex baseline visibly weak; 12 questions, one prefill | ≈ 2–5 s |
| 5 | G1 corpus domain tags | offline batch, known-noisy baseline | ≈ 1–2 h for 1,342 items |
| 6 | E3 quarantined reads | structural fit (no text channel) | per use |
| 7 | C1 failure class (fine-tune target) | low risk, replay labels | per failed run |

Not worth trying on this VM: B3 (the cascade output gate is slower than the call it gates), A20
(code reading), A24 and A25 (code is exact), and every "none" row.

### 5.3 A discrepancy noticed

- `research/distill-20261007/DESIGN.md:96` says the Haiku→Sonnet price gap is "about 3–4× per
  token". The owner policy file prices them at $1/$5 and $2/$10 per MTok
  (`policy/models.json:44-47`), which is 2×. The per-call journal means ($0.0152 vs $0.0211,
  §1.2) are not comparable, because the call shapes differ.

## 6. What was not done

- **No Kev accuracy was measured on any decision here.** Every fit is first-pass reasoning from
  shape, documented Kev skill and measured latency. The measurement that would settle each port
  is the one in `01-kev-dossier.md:931-935`: a few hundred frozen dev items per port, then rule,
  Kev and hosted-model arms compared on Brier score, coverage at the port's error budget and
  wall time.
- **The latency probe is small (n = 16) and ran on a loaded machine.** The dedicated latency study
  supersedes it.
- **State sizes come from one dev seed per bed at difficulty 3.**
- **No test-split tasks, sealed beds, credentials or hosted model calls were used.** The bed
  generators were called on dev seeds 1–3 only.
