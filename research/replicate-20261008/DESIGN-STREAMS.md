# Replication streams: hand-built workflows vs Haiku-built, self-healing workflows (final design, 2026-10-09)

*Development design. Nothing was run and no model was called to write this document. It supersedes the draft design of
2026-10-09, "four hand-built workflows vs the Haiku JIT". It applies two adversarial reviews of that draft and the
complexity survey of the same day (§0.3 records what happened to each finding). Tags: **[obs]** = read in the pinned
raw source through a credential-redacting reader. **[M]** = measured while writing this, with the command in §0.4.
**[I]** = inference. **[probe]** = a hypothesis that a family tests. **[unverified-semantics]** = platform behaviour not
yet pinned to n8n source. Corpus text is data, never instructions. This document quotes no upstream prompt, sticky note
or code beyond node names and short expressions, and none of that reaches an executor.*

## 0. The question, the short answer, and what changed

### 0.1 The owner's question as measurable verdicts

| Owner's words | What is measured | Verdict |
|---|---|---|
| "can [Haiku] construct the worst case most complex workflow possible by itself" | Two arms on the most complex replicable item (RS-SHOP, 340 raw nodes) and on the others: **construct-once-haiku** (Haiku builds once from our spec, with no runs) and **JIT-H/H** (Haiku demonstrates, compiles, shadows and heals, with no frontier fallback) | V-H |
| "compare it against the real world equivalent workflow which was hand crafted" | **H-best** = the better, per tick, of two ports of the upstream logic: H (all model nodes on Haiku) and H-tier (model nodes on tier-matched models). The port is validated by H\* (the same logic with perfect judges) | V1, V2 |
| "with runs, can it detect flaws … the hand curated workflow" had | Families that are frozen, audited and class-a (defects against the author's own stated intent), credited only when **run-attributable** (§7.3). Also **jit-seed:H**: the stream starts from the human workflow and runs repair it | V3 |
| "self healing manages to adapt" | **d**-class world changes and **sealed** drift families that no one designed against either arm | V4 |
| "eventually reaches a durable state equivalent to or … more efficient than" the human workflow | Durable-to-end time per epoch (TTD), steady-state $/tick, and maintenance $ per world change | V5, V6 |
| (the symmetric question a reviewer will ask) | Where the human design beats the built one: H-strength families and the reverse verdicts | V7 |

### 0.2 The answer in brief

1. **Items.** Three held-out items with fixed roles:
   - RS-INVOICE (n8n:13115) is the pathfinder.
   - RS-SHOP (n8n:20421) is the complexity ceiling. It was created after the models' training cutoff.
   - RS-QUOTE (n8n:12285) is the most judgment-heavy item and has human approvals.

   RS-SRE (n8n:19463) is an optional fourth item and RS-SUPPORT (n8n:11807) is the reserve. The corpus's highest-scoring
   items cannot be graded by an executable oracle (§1.2).
2. **Streams.** One stream is one fictional business over 80 ticks in five epochs: base, flaw families, sealed format
   drift, world change (then world change plus integration faults), and a revert to base. The primary mode is **closed
   loop**: each arm carries its own persistent store from tick to tick, so its mistakes compound, as they would in a
   real deployment.
3. **Spec.** Every arm gets **spec-A**: the author's stated intent, re-expressed in our words at the author's own level
   of generality. It is written by an agent that has never seen the flaw list. A pre-freeze test labels every family
   that the spec alone already solves.
4. **Effects.** Effects go through **host-served mocks**. The oracle grades the host's effect ledger, not the solver's
   claims. Integration faults (429, 5xx, timeout after commit, API field drift) start in epoch E3b.
5. **The human arm.** It is the port with template placeholders filled ("H-configured"). It runs both on Haiku and on
   tier-matched models. The comparator is the better of the two on each tick.
6. **Arms.** The arms fall into three tiers: Haiku only, Haiku with rare frontier help, and the frontier ceiling. The
   owner-facing sentence names the tier that met each verdict.
7. **Flaw credit.** A flaw counts only when it is run-attributable, checked by an offline matrix that runs every
   compiled version against every instance of the flaw. Spec-evident, demonstrator-given and seed-repaired wins are
   reported separately. Families that test the human design's strengths are scored symmetrically.
8. **Statistics.** The unit is the world. Core arms run K = 4 worlds per item. The primary hypotheses use one pooled
   exact Wilcoxon test with Holm correction.
9. **Cost.** The minimum viable programme (RS-INVOICE + RS-SHOP) costs about **$500–980** list-equivalent. The full
   3-item programme costs about **$970–1,910**. Both cross the $500 pause, so the owner decides (O-2).
10. **Training a small composer.** Not now. The corpus has no execution outcomes. These streams produce the triples
    that training would need, and §14 gives the rule for when to revisit.

### 0.3 What happened to each review finding

R1-n is the first review (25 findings plus one "checked, no finding"). R2-n is the second review (23 items).

| Finding | Disposition | Where |
|---|---|---|
| R1-1 H fails intent verdicts by construction | Adopted: the bed's `pass` is core only. Intent is core plus a-class checks only. u-class flaws are reported outside every verdict. At most 50% of flaw-epoch ticks probe H's flaws | §4.1, §4.2, §2.2 |
| R1-2 the spec gives the JIT the fixes | Adopted: author-statement registry, intent parity, blind author, spec-explicitness test at the Haiku and Opus tiers | §3 |
| R1-3 mutations probe only H's weaknesses | Adopted: an equal number of H-strength (s) families, scored symmetrically | §4.2, §7.3 |
| R1-4 teacher-forced state is asymmetric | Adopted, and superseded by R2-2. Closed loop is primary. Teacher-forced state is a neutral export only | §2.3, §2.4 |
| R1-5 base worlds trigger a-flaws | Adopted: `triggers(task)` plus generator constraints, asserted on E0 and E4 | §4.3 |
| R1-6 the primary arm is not "Haiku by itself" | Adopted: construct-once and JIT-H/H are mandatory on every world, and each version records its author model | §6 |
| R1-7 heals are not causally attributed | Adopted: offline version matrix, frozen ablation mandatory, discovery only from localised code signals, one counted family per tick, ≥ 4 instances | §7.2, §7.3 |
| R1-8 TTD can be gamed | Adopted, with W = 6 (R2-13): durable-to-end, every counted family inside the window, cost bound tied to H | §7.4 |
| R1-9 false shadow disagreements | Adopted: declared compare spec per family (ignored paths, tolerance, `primary_reason`) | §2.7 |
| R1-10 the model mapping handicaps H | Adopted: H-tier mandatory where it differs from H; H-best comparator | §5.1 |
| R1-11 H pays for prose the JIT skips | Adapted: every arm now produces the sent prose (R2-16). H$-graded is computed from the journal by node, with no `PROSE=0` rerun | §2.7, §5.6 |
| R1-12 adapters add judgment to H | Adopted: graded fields come deterministically from H's native effects | §5.5 |
| R1-13 template placeholders counted as flaws | Adopted: class `cfg`, with H-configured as the primary H | §4.2, §5.1 |
| R1-14 some class-a labels are weak | Adopted: F1 → d, Q4 → b, S3 and A3 → b until resolved, F6 → b provisionally. **Disagreement on one point:** the multi-invoice bundle *does* have an author label (the analyzer's skip rule [obs, survey T1]), so it stays as an s-candidate pending the class audit. Credit notes are dropped | §9 |
| R1-15 mutations that do not preserve labels | Adopted: twins, per-family assertions, no allowed date set that crosses a month | §4.3 |
| R1-16 tuning on the same items before the freeze | Adopted: hashed freeze order F0–F7 | §11 |
| R1-17 selection bias | Adopted: item set and substitution triggers pre-registered, excluded items reported, scoped claim, optional random draw (O-8) | §1.3 |
| R1-18 D10 / ROADMAP §2.9 taint | Adopted: O-6 declassification, stricter overlap gates, our own enums | §3.5 |
| R1-19 / R2-19 contamination | Merged: a dev-only canary per model per item, with pre- and post-cutoff results reported separately | §3.6 |
| R1-20 retrieval stand-in | Adopted for RS-SUPPORT (reserve) | §9.5 |
| R1-21 H under JIT limits | Adopted: caps at 2× dev p99, with cap hits, timeouts and 429s treated as environment faults | §5.6 |
| R1-22 shortcut leakage in RS-SRE | Adopted | §9.4 |
| R1-23 incomplete provenance pins | Adopted. **Finding:** none of the five acquired records has an `updatedAt` field [M], so the pre-registration records "absent" plus the raw-byte hash | §1.1, §10 P15 |
| R1-24 noise band too narrow | Adopted: H runs twice; δ = max of three sources | §8.3 |
| R1-25 construct-once examples could leak flaws | Adopted: three E0 ticks from dev world 8 only | §6.1 |
| R1 "checked, no finding" | Kept, plus a sandbox test that the ports cannot be read | §10 P14 |
| R2-1 every task is a separate world | Adopted: world-stream mode | §2.1 |
| R2-2 teacher forcing removes compounding | Adopted, **with one change:** the carry travels as a workdir file, not inside `task.inputs`, so task hashes and pairing by (world, tick) stay exact. The carry schema is defined by each arm | §2.3 |
| R2-3 nothing is long-running | Adopted for RS-QUOTE and RS-SHOP. **Rejected for RS-SRE** (re-page on no acknowledgement): there is no author statement, so it cannot be graded under intent parity | §2.5, §9 |
| R2-4 the oracle grades claims | Adopted: host-served mocks, provisional per-run ledgers, commit on delivery, bed contract v1.1 | §2.6 |
| R2-5 the items are not the most complex | Adopted: RS-SHOP is the mandatory ceiling item. **Correction:** upstream has an admin API, pending admin answers and a pause-bot path, but no node name contains "refund" [M], so refunds stay out of scope until the port reads otherwise | §1.1, §9.2 |
| R2-6 composition is never asked of the JIT | Adopted in part: entrypoints contract and `heal_propagation`. The manifest is recorded but is not an acceptance gate, so it cannot confound compile acceptance | §2.5, §6.3, §7.3 |
| R2-7 spec pre-solves flaws | Adopted: spec-A is primary; spec-B (contract-level) is a dev-only diagnostic | §3.2 |
| R2-8 no counterfactual for runs | Adopted: `run_attributable` defined on the version matrix | §7.3 |
| R2-9 the primary arm is not Haiku by itself | Adopted: three co-primary tiers | §6.2 |
| R2-10 seed the JIT with the human workflow | Adopted: jit-seed:H (needs O-6b) and jit-seed:construct-once | §6.1 |
| R2-11 H comparator handicapped | Same as R1-10 | §5.1 |
| R2-12 validate the port against the real engine | Adapted: semantics pinned to n8n source are mandatory. Running the engine depends on O-7 (no Docker daemon here; R-bench R-3 defaults to no). The claim wording changes with the choice | §5.3 |
| R2-13 one 12-task drift step cannot show durability | Adopted: 80 ticks, five epochs, W = 6. **Change:** agent-opus cannot be subsampled in closed loop, so it runs teacher-forced | §2.2, §6.1 |
| R2-14 the statistics cannot carry the claim | Adopted, **with one change:** ticks inside a closed-loop world are dependent, so the world is the unit (exact Wilcoxon, cluster bootstrap). The GLMM is dropped (no pinned statistics dependency). McNemar is used only on teacher-forced ticks | §8.2 |
| R2-15 the mutation designer knows the flaws | Adopted: a sealed drift author | §4.4 |
| R2-16 prose excluded | Adopted: prose is produced, ignored in shadow comparison, and graded by deterministic claim checks | §2.7 |
| R2-17 concurrency races serialised away | Adopted as families F9 and SH2: class a only with an author no-duplicates statement plus pinned batching semantics | §9 |
| R2-18 the JIT version must be frozen | Adopted: v2.2 is a hard prerequisite; running both versions is owner option O-9 | §6.3 |
| R2-20 efficiency should include maintenance and latency | Adopted | §7.5 |
| R2-21 what convinces a reviewer | Adopted as the headline restrictions | §8.4 |
| R2-22 budget | Re-estimated arm by arm. My figures are higher than the review's | §13 |
| R2-23 the composer-training condition | Adopted | §14 |

### 0.4 Checked while writing this design [M]

- **Pins.** `sha256sum /opt/corpus/n8n/workflows/{13115,11807,12285,19463,20421}.json.gz` gives:
  - `31b8fcaa…2314`, `7822a7ab…bbd`, `e97c60fa…db8e`, `46d6d34e…15c3`;
  - for 20421: `3a29fdca559c6a1f605709d62a80552358e93c173be0284752f0b119029b71aa`.

  None of the five records contains `updatedAt`.
- **Raw node counts.** 13115: 126; 11807: 91; 12285: 68; 19463: 42; 20421: 340. The 20421 node types include 104
  `dataTable`, 64 `code`, 31 `if`, 19 `httpRequest`, 16 `respondToWebhook`, 10 `webhook`, 8 `dataTableTool` and 6
  `googleDrive`.
- **Corpus features** (`items.jsonl`):

  | item | normalised nodes | sub-workflows | human steps | created |
  |---|---|---|---|---|
  | 13115 | 88 | 2 | 1 | 2026-01-30 |
  | 12285 | 58 | 3 | 2 | 2025-12-29 |
  | 11807 | 77 | 0 | 0 | 2025-12-15 |
  | 19463 | 36 | 0 | 0 | 2026-09-11 |
  | 20421 | 306 | 6 | 0 | 2026-10-05 |

- **Upstream model ids.**
  - 13115: `openai/gpt-4o` × 2.
  - 12285: `x-ai/grok-4`, `anthropic/claude-sonnet-4.5`, `openai/gpt-4-turbo` (×2, plus one default), `anthropic/claude-opus-4.5`.
  - 19463: `gpt-4.1`.
  - 20421: `models/gemini-2.5-flash` × 3.
  - 11807: an expression that reads a configuration node.
- **[obs] spot checks** (redacting reader; node names are upstream's):
  - 13115 `CalcSummary` (code) adds the raw `amount` (F1). It sets a category's `budget` only when the category is first
    created in the month summary (F4).
  - 13115 `SummaryInput` computes `needs_alert` with a literal 80 (F2).
  - 13115 `StorageInput` derives the storage month from the model-extracted date (F5).
  - 12285 `details` (httpRequest 4.3) calls a document URL with a fixed 22-character id (Q1).
  - 12285 `Match Meeting by Title` (filter 2.2) sets `ignoreCase: true` and compares equality on `name.split(" -")[0]`
    (Q3). Base titles must therefore differ by more than letter case to trigger it.
  - 19463 `recentAlertCountFromSource` occurs twice in the file (A1).
  - 19463 `Postgres - Close Resolved Incident` updates only `fingerprint, status, resolved_at` (A8).
  - 19463 `IF - Duplicate Within Cooldown` compares only `last_notified_at` (A4).
  - 19463 `Set - Parse Agent Output` (set 3.4) computes `isOutputValid` from `$json.parsedOutput` in the same node (A3,
    semantics pending).
  - 20421 has webhooks for Meta chat, Stripe (with a `Verify Stripe signature` node), an admin API (POST), the payment
    return page and the admin UI pages. It also has a nightly 03:00 schedule, an error trigger, and nodes named
    `Find Open Cart`, `Pause Bot For Customer`, `Mark Drafts Abandoned`, `Expire Old Payment Link`,
    `Read Inventory For Stock → Calculate New Stock → Reduce Inventory Stock`.
- **Harness facts that shape the prerequisites (§10):**
  - `normalizeConfig` uses `raw.staticFallback ?? STATIC_FALLBACK` (`experiments/jit/stream.mjs:72`). An explicit
    `"staticFallback": null` therefore silently becomes Haiku today.
  - Result rows store no output, and `oracleDetails` is cut to 2,000 characters (`stream.mjs:301`).
  - Agent and static arms run as an unordered pool (`stream.mjs:617`).
  - The row field `stateAfter` is the JIT's internal state, so the per-arm business state here is called **carry**.
  - `b0Agent` starts host services only for `kind: 'interactive'` families (`experiments/lib/arms/b0-agent.mjs:43-44`).
  - `runCompiled` starts them with no task or family context (`experiments/jit/run-compiled.mjs:46`).
  - `durability.mjs` already defines a windowed time-to-durable (default W = 6, S = 0.8).

## 1. Items

### 1.1 Set and roles (pre-registered)

| Item | Upstream | Role | Raw / normalised nodes | Sub-workflows / human steps | Upstream models → H-tier | Created vs cutoff | Licence handling |
|---|---|---|---|---|---|---|---|
| **RS-INVOICE** | n8n:13115 invoice → budget ledger | Pathfinder: exact arithmetic oracle; document judgments on cross-run state, schedules and authorisation | 126 / 88 | 2 / 1 | gpt-4o ×2 → sonnet | 2026-01-30, before cutoff | n8n ToS: port local |
| **RS-SHOP** | n8n:20421 Messenger clothing shop + Stripe | **Ceiling**: order/payment/inventory state machine, debounce, human pause, signed webhooks | 340 / 306 | 6 / 0 (admin actions are human events in the world) | gemini-2.5-flash ×3 → haiku, so **H-tier ≡ H** | 2026-10-05, after cutoff | n8n ToS: port local; a credential-shaped token is read only redacted |
| **RS-QUOTE** | n8n:12285 transcript → quote → approval → e-sign | Most judgment: 3 agents, sub-workflow router, poll loop, approvals across ticks | 68 / 58 | 3 / 2 | grok-4, sonnet-4.5, gpt-4-turbo → sonnet; opus-4.5 → opus | 2025-12-29, before cutoff | n8n ToS: port local; API-key-shaped headers are read only redacted |
| RS-SRE (optional 4th) | n8n:19463 Alertmanager RCA router | Ops; after cutoff | 42 / 36 | 0 / 0 | gpt-4.1 → sonnet | 2026-09-11, after cutoff | n8n ToS |
| RS-SUPPORT (reserve) | n8n:11807 five-channel support with guards | Substitute for RS-QUOTE | 91 / 77 | 0 / 0 | from the config node → by class | 2025-12-15, before cutoff | n8n ToS |

The cutoff is the June 2026 cutoff stated for the frontier models. Haiku 5.5's cutoff is [unk] and assumed to be no
later.

### 1.2 Why not the corpus's top-scoring items

The survey's complexity score ranks n8n:14080 (#1), the "Pro AI" shortcut (#2), the gitlab-org/gitlab CI (#6) and
n8n:6158 (#7) highest. None has an executable oracle: their product is prose or chat, or the YAML itself is the job, so
`r3 = 0` under D10. A stream must grade every tick. RS-SHOP is therefore the most complex item that *can be graded*,
and claims say so. The HA "Automatic Gate" (J = 0, GPL) stays out (O-3).

### 1.3 Substitution, exclusion and scope (frozen at F0)

- An item that fails K1, K2 or K4 (§12) is excluded and listed in every results table as "excluded: reason".
  - RS-QUOTE excluded → RS-SUPPORT substitutes, if O-2 funds it.
  - RS-SHOP excluded → no substitute. The ceiling is reported missing.
  - RS-INVOICE excluded → the programme pauses for the owner.
- An item that hits K3 (no headroom) still runs H vs JIT-O/H plus the Haiku tier, labelled "no headroom".
- Optional O-8: one item drawn with a seed from the survey's top 100 by complexity, with J > 0 and r2 ≥ 0.75. It is
  dev-only unless funded, and is a check on selection bias.
- **Claim scope:**
  - "Published templates selected for documented defects and complexity, replicated as logic against mocks." Not
    production workflows, and no claim of commercial parity or worst-case correctness.
  - These streams measure script-form construction (JIT and B1). Typed-IR construction is R-bench's job
    (`DESIGN.md` §4).

## 2. The stream: one business over time

### 2.1 Ticks, worlds and seeds

- **World-stream mode.** `generate({seed, split, difficulty})` decodes `seed = world*1000 + tick`. It replays the
  world's history from tick 0 to `tick` (cost O(tick), well under the 2 s limit at 80 ticks). It returns that tick's
  events plus the true state before the tick.
  - Config segments are written `{difficulty, world, ticks:"a..b"}`, and `normalizeConfig` expands them into the
    existing seed list. Seed-list configs keep their arm hashes.
- **One tick is one unit of business time.** It contains every event of that period: files, messages, webhooks,
  approval answers, admin actions, crossed schedule boundaries. The tick length is per item (§9).
  - H replays the platform's own execution granularity *inside* the tick (for example, hourly polls), because n8n's
    item-batch semantics depend on it.
- **Worlds.**

  | Worlds | Split | Use |
  |---|---|---|
  | 71–74 | test | held-out; seeds 71001–74080, all ≥ 7001 as `stream.mjs` requires |
  | 1 | dev | "free world": takes any difficulty, for bed health at d1–d5 |
  | 2–3 | dev | dev streams |
  | 4 | dev | calibration |
  | 8 | dev | construct-once worked examples, ticks 1–3 |
  | 9 | dev | spec-explicitness and canary instances |
  | 10–29 | dev | 20-world bed-health and trigger assertions |

  Every world except world 1 follows the canonical epoch schedule; `generate` throws if the passed difficulty differs
  from the schedule. Worlds 0, 5 and 6 are unused, which avoids the burned single seeds 0–27, 5001–5006 and 6001–6004.

### 2.2 Epochs (canonical schedule, identical across items)

| Epoch | Ticks | Level | Content | Graded in |
|---|---|---|---|---|
| E0 base | 1–16 | 3 | The world the human design was built for. `triggers()` is empty (asserted); no faults; about 6–15K tokens per tick | core: V1 |
| E1 families | 17–40 | 4 | E0 plus **exactly one counted family instance per tick**. ≤ 12 ticks carry an a-family (≤ 3 families, ≥ 4 instances each). ≥ 12 ticks carry an s-family (equal count) or a neutral label-preserving probe. Each family's first instance falls in 17–28; instances of a family are ≥ 2 ticks apart | core: V2; per family: V3, V7 |
| E2 format drift | 41–56 | 5 | Sealed format families (§4.4), inputs 1.5–2.5× larger, ≤ 40K tokens | core: V2; sealed: V4 |
| E3a world change | 57–64 | 5 | A persistent d-class change plus sealed world families; volume up to 2× | core: V2; d: V4 |
| E3b change + faults | 65–72 | 5 | E3a plus a host-call fault ramp from 0 to 15% (sealed schedule) | fault metrics; d (reported); V5 |
| E4 revert | 73–80 | 3 | The E0 distribution again: no change, no faults | core: V1 (regression check) |

Base ticks are E0 + E4 (24). Drift ticks for the primary test are E1 + E2 + E3a (48). The epoch boundaries and family
schedule are frozen with the world generator. No arm sees epoch labels.

### 2.3 Closed loop: the carry (primary mode)

- Every arm owns a persistent store, its **carry**: the database a deployed workflow would keep.
- **Mechanics.**
  - At tick t the host writes the arm's last committed `carry_out` into the workdir as `state.json`. `task.json` is
    unchanged, so `taskHash` stays identical across arms and pairing by (world, tick) stays exact.
  - Every output carries `carry_out`: JSON of at most 64 KB, opaque to the host. If it is too large or not JSON, the
    output is `invalid`.
  - The host commits carry and ledger with a compare-and-swap on the arm's tick index (one writer per arm).
- **Schema.** The schema is defined by the arm. spec-A tells every solver that `state.json` is the store left by
  earlier runs, and that it must return it updated, keeping its structure unless it is empty.
  - Warmup interpreters create the schema at tick 1. Compiled code and later interpreters follow it.
  - A recompile that changes the schema must migrate what it receives.
  - A crash or invalid output on the tick after a schema change is logged as a `carry-schema-break` event and counted
    as a failure of that arm, never as a fault.
- **Tick 1 is a migration.** Tick 1's inputs carry the neutral export (§2.4) of the business's prior history, the
  same for all arms. There is never a design-shaped table.
- **Grading uses the true world, not the arm's store.** A duplicate recorded at tick 5 costs points at every later
  month summary.
- **No delivered output.** If a tick delivers no output, the arm's previous carry is kept: the tick's events are lost,
  as in a failed execution, and a `carry-lost` event is recorded. An `ENV_FAULT` is retried as `stream.mjs` already
  does.
- **The carry is not a Foundry store.** It is explicit input and output data held by the harness, which is consistent
  with THESIS D11.

### 2.4 Teacher-forced mode (secondary diagnostic)

- Every tick is a fresh deployment migrated from the **neutral export**, so no carry exists. The neutral export
  contains only:
  - (a) raw events as received, within the item's lookback window;
  - (b) records held by external systems of record (the mock SaaS tables) as the world holds them.
- It never contains a field that exists only because one design persisted it. For example: no `amount_eur`, no
  derived category, no `occurrences_since_open`.
- Each item README lists its export fields, and the checker in P13 audits them.
- Teacher-forced runs give "per-tick defect". "Compounding defect" is closed-loop minus teacher-forced on the same
  ticks.

### 2.5 Entrypoints and episodes

- Each family declares its entrypoints (for example: inbox, chat, weekly and monthly for RS-INVOICE). A tick may hold
  events for several of them. The output has one section per entrypoint, and the oracle grades per entrypoint, which
  makes `heal_propagation` (§7.3) measurable.
- Long-running interactions span ticks:
  - In RS-QUOTE, a deal runs 6–20 ticks with 3–8 deals in flight. Approval answers arrive k ticks after the request,
    with k drawn from {0: 0.3, 1–3: 0.5, never: 0.2}. Rejection, feedback and revision cycle 1–3 times. There are stale
    signature webhooks (for v1 after v2 was sent) and duplicate deliveries.
  - In RS-SHOP, conversations span ticks, admin answers arrive later, and payment events arrive out of order.
- A waiting n8n execution is represented in H's carry as a pending record.
- A stream-level invariant enters core only if the author's design implies it (for example: "no send of version v
  without an approval of v"). Reminders and expiry policies have no author statement and are not graded.

### 2.6 Effects through host services; faults

- **Routes.** `/svc/<integration>/<op>` routes sit next to `/env/*` in `experiments/lib/services.mjs`. They are
  reached by compiled solvers through `tools/gateway.json` and by agent sessions through a `svc.mjs` client.
  - A simulated clock (`/svc/clock`) replaces wall time. "Sleep" advances simulated time only.
- **Ledgers.** Each run (compiled, interpreter, shadow, adjudicator) writes to its own *provisional* ledger. Only the
  delivered run's ledger is committed.
  - A deopt therefore rolls back its partial effects. Real n8n would not, so this is a stated harness abstraction. It
    does not affect H, which never deopts.
- **The oracle** reads the committed ledger through bed contract v1.1, `oracle(task, output, ctx)` with `ctx.ledger`.
  `output` still carries decisions that have no external effect.
  - A claimed effect with no ledger entry fails.
  - Effects must happen exactly once per world event, and no event may be lost.
- **Faults in E3b** follow a sealed schedule, keyed by (world, tick, integration, op, ordinal of that op within the
  tick):
  - 429 with Retry-After;
  - 5xx;
  - timeout after commit (an ambiguous write);
  - a renamed response field (API drift);
  - a Drive move that fails after the rename has succeeded.

  Duplicate webhook delivery is a world *event*, generated in any epoch where the item's world has it.
- **H reproduces n8n's node-error semantics:** stop the execution and keep the effects already done; per-node
  `onError`/`continueOnFail`, `retryOnFail`, `maxTries` and `waitBetweenTries` are read from the JSON (semantics
  ledger, §5.3).

### 2.7 Output contract, prose, and shadow comparison

- **Structured fields** carry only exactly comparable values: cents, integer percentages, enums and ids. They use *our*
  vocabularies (§3.4).
- **Prose is part of the output.** This covers what the workflow sends to a person: alerts, replies, quote emails and
  report text. Deterministic claim checks grade it:
  - every number, price, size, date and id mentioned equals the structured value;
  - the planted fact token is present where one is required;
  - no fact from an undecided document or a product outside the catalogue appears;
  - no promise falls outside the stated policy.
  - The result is reported as `succ_intent+prose` (secondary). Prose that reaches no graded field or effect is not
    produced by the built arms.
- **Compare spec, declared per family** in the README and exported as `compare`, never derived from oracle code:
  - `ignore` paths: prose fields, `carry_out`, fields whose truth is an allowed set;
  - numeric tolerance (0.01 EUR for money);
  - unordered array paths;
  - a scalar `primary_reason` wherever a reason set exists.

  It is used by shadows, adjudication, `check-traces` and tier-down (JIT v2.1, DEV-NOTES D7). A disagreement only on an
  ignored field is never "discovered".

### 2.8 Size budget

E0 and E4 run about 6–15K tokens per tick plus carry (≤ 64 KB, about 16K tokens); E2 and E3 run up to 40K plus carry.
Every prompt stays under Haiku's 100K-token price step (`policy/models.json`).

## 3. Specs, D10 and declassification

### 3.1 Author-statement registry

- A builder agent working under provenance taint (D15: no effects, no egress, mocks only) lists every statement of
  intent the author made: node notes, prompts, sticky notes, the template description, schema fields.
- Each entry has an RFC 6901 JSON pointer into the raw file, the node name, and a one-line paraphrase in our words.
- The registry is the *only* source for intent rules. Every intent rule behind an a-, d- or s-check cites at least one
  entry (**intent parity**).

### 3.2 spec-A (primary) and spec-B (dev only)

- **spec-A** is written by a **blind author**: an agent that has not seen this design's §9 family tables, the family
  list, the port or the upstream file. It receives only the registry paraphrases, the entrypoint list and the output
  schema.
- It states goals and data contracts at the author's own level of generality, plus the carry rule (§2.3). It adds no
  handling for a variant the author did not write.
  - Example: "budgets and spend are tracked in euros" is allowed, because the author shows € and defaults to EUR.
    "Convert foreign amounts with the rates table" is not.
- It never names families, frequencies, upstream mechanisms, template titles or node names. Length: 600–1,200 words.
- spec-A is the `prompt` for every built arm and every interpreter. H ignores it, and its rule cards carry the same
  intent (§5.2).
- **spec-B** (contract level: every input variant handled explicitly) is run only on dev world 2, as a diagnostic of
  how much a contract helps.

### 3.3 Spec-explicitness test (before the freeze, F4)

- For each a-, d- and s-family, give a model spec-A plus one minimal instance: a tick containing only the mutated
  record, with the neutral export as state. Use direct calls with structured output.
- Two tiers:
  - `claude-haiku-5-5`, 5 samples: ≥ 4/5 correct means "spec-evident (Haiku)";
  - `claude-opus-5-5`, 3 samples: 3/3 correct means "spec-evident (Opus)".
- A spec-evident family is never credited as run-discovered at that tier. The spec is **not** edited to hide a family:
  that would rig the other way.
- Cost: under $2 per item.

### 3.4 Our own vocabulary

The committed schema and generator use our enums (categories, reasons, statuses, codes). Upstream literals are never
used: not the 8 upstream default categories, the 7-reason vocabulary, the small-talk list or `acompte`. The port maps
upstream labels to ours inside `port/`, which is gitignored.

### 3.5 Gates and declassification (O-6)

- Text derived from a tainted builder's reading needs owner approval before it is used with egress
  (`docs/ROADMAP.md:661-667`). Gateway model calls are egress.
- **O-6(a)** declassifies spec-A, the rule cards, the port (so that H's Haiku nodes may run) and the canary prompts
  (§3.6). It is signed only after all of these pass:
  - 5-gram overlap with any upstream string ≤ 2%;
  - no shared run of 40 or more characters;
  - the "no family named" checker passes;
  - the secret scan passes;
  - the independent class audit (§4.3) passes.
- **O-6(b)** additionally lets the port be *compiler input* for jit-seed:H.
- **No executor runs before O-6(a)**, including the spec-explicitness test and H calibration.

### 3.6 Contamination canary (dev only)

- Per item and per model (Haiku, Sonnet, Opus): given the template id and title, the model lists the node names and
  known defects.
- Scores: Jaccard similarity with the upstream node names, and a count of family mechanisms named.
- An item that scores high is labelled "contamination-suspect". Headline narratives report pre-cutoff items (INVOICE,
  QUOTE, SUPPORT) and post-cutoff items (SHOP, SRE) separately.

## 4. Oracle, families and classes

### 4.1 Layers

- **core**: every check not owned by a flaw family. s-checks are part of core.
- **family checks**: one per frozen family, with a class.
- The bed's `pass` = core. This is declared in `index.mjs`, because `stream.mjs` `finish` and `oracle-controls.mjs`
  record `verdict.pass`.
- **intent** = core ∧ every applicable a-check. `score` = the fraction of graded checks passed.
- Every layer is recomputed from (seed, split, difficulty) plus the committed ledger, and never trusts the solver.

### 4.2 Classes

| Class | Meaning | Admission evidence | Counts in |
|---|---|---|---|
| core | everything not listed below | H\* passes ≥ 95% of E0 dev ticks (closed loop) | V1, V2, V5 |
| **s** (H-strength) | a defence the author built and documented, exercised by a family that E0 never triggers | registry pointer; H\* passes 100% of instances | core, plus `exceeds(H over arm)` (V7) |
| **a** | a defect against the author's own stated intent | registry pointer + platform semantics pinned (§5.3) + H\* fails 100% of instances and passes core elsewhere + independent class audit | intent; V3 |
| **d** | the world changes beyond what the design anticipated, while the author's statements still fix the right answer | registry pointer fixing the answer + H\* fails 100% | V4 only |
| u | design-level defect hitting every event of one kind | as a | its own table; outside every verdict |
| cfg | a template placeholder (constant id, empty required parameter) | pointer | filled in H-configured; reported as "template incompleteness"; excluded |
| b | contested policy, or a/d evidence incomplete | — | dev and report only |
| j | judgment-coupled (H fails, H\* passes) | — | the H − H\* gap |
| tags | `state` (compounds through the carry), `seal` (sealed family), `fault` (E3b) | | |

### 4.3 Family admission (all checked by code before the freeze)

- **Triggers.** `oracle.triggers(task) -> familyId[]` is computed from the truth. The bed test asserts, on dev worlds
  10–29:
  - it is empty on every E0 and E4 tick;
  - it equals exactly the assigned family on every E1 tick;
  - it contains the d-family on every E3 tick;
  - it contains nothing outside the schedule.

  Generator constraints that make E0 clean are listed per item (§9).
- **Twins.** For each family, generate a mutated and an unmutated twin from the same (world, tick). Over 20 worlds,
  assert that the truth differs only on the mutated record, plus the family's own assertions (for example, F5's "same
  vendor, number, amount and date"; a unique tolerant match for Q3).
  - Allowed date sets never cross a month boundary.
  - Precedence rules are written down wherever two families could fire on the same record, although E1 never
    schedules two.
- **H\* gates:** a and d families fail 100%; s families pass 100%; core ≥ 95% on E0.
- **Class audit.** An independent agent sees only the registry entry, the semantics-ledger entry and one failing
  instance, and re-assigns the class. A disagreement demotes the family to b.
- **Probes.** Label-preserving probes (for example, an injection line inside a document) are never families, and the
  twin assertion shows they leave the truth unchanged. Families with no author-defined label (for example, credit
  notes) are not graded.
- **Selection.** At most 3 a-families per item enter E1, in a priority order frozen at F1. The rest go to dev/report.
  b-families run only on dev worlds.

### 4.4 Sealed drift (E2, E3)

- A separate agent session authors the E2 format families, the E3 sealed world families and the E3b fault schedule as
  a sealed generator plug-in, loaded the way `beds/sealed/` is.
- It has no access to `experiments/jit/` prompts or traces, the port, upstream files or the family list. It works from
  spec-A, the generator API and the output schema only, within declared bounds (size ≤ 2.5×, fault rate ≤ 15%).
- Each sealed family must pass the oracle controls. Its sha256 goes into the pre-registration at F2, and code unseals
  it at F7.
- Only sealed families support "adapts to the unknown". Families known to the designer are reported separately.

### 4.5 Details and stored artifacts

- `details` ≤ 1,500 characters, in the form
  `{c:0|1, f:{<fam>:[ok,n]}, cls:{<fam>:'a'}, it:[[i,'<fam>','fail']], tr:['<fam>'], ff:'…'}`.
- Because rows store no output (§0.4), each row also writes `<armDir>/outputs/<idx>.json`: the delivered output, the
  committed ledger, and `carry_in`/`carry_out` with their sha256. Every metric is recomputed offline from these files.

## 5. The human arms

### 5.1 Variants

| Variant | Definition | Role |
|---|---|---|
| H-literal | Line-for-line port, cfg placeholders included | reported only |
| **H** (primary) = H-configured | H-literal + listed minimal cfg fills (for example, Q1: the document id comes from the webhook). It includes listed H-patches only where a u-defect disables more than 50% of core (candidate: A3 if confirmed). All model nodes run on `claude-haiku-5-5` | the human workflow as a deployer would run it, at Haiku cost |
| H-tier | H with each model node mapped by class (below) | the human workflow on models like the author's |
| **H-best** | per tick, max(H run 1, H-tier) | comparator for every success verdict |
| H\* | H with every model node replaced by the hidden-truth judgment; in-process, $0 | logic ceiling; family gates |
| H run 2 | H again with fresh run ids (the journal never replays across run ids) | noise band |

Tier map (ids from `policy/models.json` only):

| Upstream model | Policy id |
|---|---|
| Opus 4.5 | `claude-opus-5-5` |
| Sonnet 4.5, GPT-4o, GPT-4.1, GPT-4-turbo, Grok-4, Gemini Pro-class | `claude-sonnet-5-5` |
| mini, Flash or Haiku-class (for example, gemini-2.5-flash) | `claude-haiku-5-5` |
| configuration-driven (11807) | resolved from the configuration node when the port is built |

For RS-SHOP, H-tier ≡ H; it is not run twice and H-best = H.

### 5.2 Port provenance (D15) and deliverables

A builder agent reads `/opt/corpus` under taint, with no effects and no egress, through the committed redacting reader
(§10 P15). It delivers to `experiments/replicate/streams/<item>/port/`, which is gitignored and sha-pinned:

- `solve.mjs` and `solve-tier.mjs`, one self-contained file each (`runCompiled` writes only `solve.mjs` and the tools).
  - Code nodes are re-implemented line for line.
  - Set, If, Switch, Filter and Merge nodes become one function per node, named after the node, in upstream order.
  - n8n item-batch execution (node at a time over all items) is reproduced where the semantics ledger says so.
  - Agent nodes become JSON tool loops; the maximum iteration count is a ledger entry.
  - autoFix parsers get one repair call.
  - The port never uses `flow.guard`, `flow.invariant` or `flow.judge`. It always exits 0 with schema-valid output,
    and upstream error paths become effects.
- `rule-cards.md`: every upstream prompt rewritten as numbered rules in our words, each citing its node, within the
  §3.5 overlap gates.
- `coverage.md`: every upstream node marked ported, stand-in or dropped, with the reason.
- `semantics-ledger.md` (§5.3).
- `adapters.mjs` (§5.5) and unit tests: one per [obs] defect and one per s-defence, each on a minimal case.

### 5.3 Semantics ledger and the engine lane

- Each platform assumption is tagged:
  - **engine**: observed in a run of the real engine;
  - **source**: n8n source at a pinned release, with path:line for the node's `typeVersion`;
  - **documented**: docs URL plus date;
  - **recalled**.

  No assumption on a graded path may stay `recalled`.
- Assumptions to pin:
  - Set-node reads of fields assigned in the same node (A3);
  - node-at-a-time item batching (F9, SH2);
  - the agent node's default maximum iterations;
  - send-and-wait semantics and limits;
  - node error, retry and `onError` semantics;
  - Wait-node resume;
  - Filter with no else branch;
  - `removeDuplicates` history;
  - schedule-trigger timezone;
  - `$now` / `Date.now()` mapped to the simulated clock.
- A contested assumption gets a **flip run**: H with the alternative semantics, reported alongside.
- **The engine lane (O-7)** runs the upstream JSON in a pinned n8n build:
  - credentials point at the same `/svc` mocks;
  - LLM nodes are served by a recorded-response stub;
  - on 10 dev ticks per item, every node's output is diffed against the port's per-node function output;
  - acceptance is 100% equality on non-LLM nodes.

  This container has no Docker daemon (R-bench R-3, default no), so the default is source-pinned semantics only.
  Claims then read "port validated against pinned n8n source semantics, not the engine".

### 5.4 Port acceptance

All of the following must hold:

1. H\* core ≥ 95% on E0 ticks of dev worlds 2–3 in closed loop.
2. An independent agent audits `coverage.md` against the upstream JSON.
3. The unit tests pass.
4. The semantics ledger has no `recalled` entry on a graded path.
5. The engine diff passes, if O-7 is approved.
6. The adapters reproduce H\* outputs 100%.
7. The secret scan passes.
8. The sandbox test passes (§10 P14).

### 5.5 Adapters

- Graded fields are extracted deterministically from H's native effects in the ledger and its native node outputs.
  Examples:
  - quote lines come from `Build Pricing Payload`'s payload;
  - a file's decision comes from its rename or move effects.
- H's rule cards are never changed in order to emit a graded field.

### 5.6 Limits and cost accounting

- H's per-tick cap and timeout = 2× its dev p99 (pre-registered). A cap hit, timeout or 429 on H is an `ENV_FAULT`,
  retried once with a fresh run id and counted.
- `staticFallback: null` (§10 P2) means a crash is an H failure, never rescued by an agent.
- Costs:
  - **H$** = every journaled call.
  - **H$-graded** = the calls of nodes whose output reaches a graded field or effect. Node attribution comes from the
    journal's `gateway/<node>/<seq>` keys.

  The efficiency verdicts use H$-graded and also report H$.

## 6. Built arms and tiers

### 6.1 Arms

| Arm | Spec string (configs in §6.4) | Tier | Mode | Worlds | Who builds / who runs / human help |
|---|---|---|---|---|---|
| H, H run 2 | `static:experiments/replicate/streams/<item>/port/solve.mjs` | human | closed | 4 + 4 | upstream author (ported) / Haiku nodes / none |
| H-tier | `static:…/port/solve-tier.mjs` | human | closed | 2 (none for SHOP) | upstream author / tier-matched nodes / none |
| H\* | in-process in oracle-controls | — | closed + TF | all, $0 | — |
| **construct-once** | `static:…/construct-haiku/w<k>/solve.mjs` | **Haiku only** | closed | 4 | Haiku builds once with the C0 B1 builder from spec-A + 3 E0 examples (dev world 8, ticks 1–3), $1.5 cap, no probes, no stream runs / Haiku-written code / none |
| **JIT-H/H** | `jit:claude-haiku-5-5/claude-haiku-5-5`, `compilerFallback: null` | **Haiku only** | closed | 4 | Haiku demonstrates, compiles, shadows, adjudicates / compiled code / none |
| **JIT-O/H** | `jit:claude-opus-5-5/claude-haiku-5-5` | Haiku + rare frontier | closed | 4 | Opus demonstrates and shadows; Haiku compiles (Opus fallback ≤ 2) / compiled code / none |
| JIT-O/H-frozen | same, `recompileOnDeopts: 999, shadowEvery: 0, shadowOnFlags: false` | Haiku + rare frontier | closed | 2 | heal ablation: one compile, never recompiled |
| jit-seed:H | `jit-seed:…/port/solve.mjs/claude-opus-5-5/claude-haiku-5-5` | human + JIT | closed | 2 | version 1 = the port; no warmup; shadows and recompiles as usual (needs O-6b) |
| jit-seed:construct-once | `jit-seed:…/construct-haiku/w<k>/solve.mjs/claude-opus-5-5/claude-haiku-5-5` | Haiku + rare frontier | closed | 1 | the owner's literal story: Haiku builds alone, then runs repair it |
| agent-haiku | `agent:claude-haiku-5-5` | Haiku only, no artifact | closed | 2 | B0 |
| agent-opus | `agent:claude-opus-5-5` | frontier ceiling | **TF**, every 4th tick | 1 | per-tick ceiling (cannot be subsampled in closed loop) |
| JIT-O/H-TF, H-TF | as above | — | TF | 1 | per-tick vs compounding decomposition |
| JIT-S/H | `jit:claude-sonnet-5-5/claude-haiku-5-5` | — | closed | dev world 2 only | demonstrator-choice diagnostic (DEV-NOTES D10) |

Each world is an independent lineage: construct-once is built once per world. The interpreters, shadows, compilers and
construct-once builder read only spec-A, the carry and the synthetic inputs. The compiler for jit-seed:H also reads the
port (O-6b).

### 6.2 Tiers and attribution

| Tier | Arms |
|---|---|
| Haiku only | construct-once, JIT-H/H, agent-haiku |
| Haiku + rare frontier | JIT-O/H, JIT-O/H-frozen, jit-seed:construct-once |
| Frontier ceiling | agent-opus |

- Every adopted version already records `builderModel` (`stream.mjs:470`). Every row records $ and tokens by model
  (from `costBreakdown` and the journal).
- In JIT-O/H, results are split by who delivered the answer: a Haiku-written version, an Opus-fallback version, or the
  interpreter.
- The owner-facing answer to "can Haiku do it by itself" cites only Haiku-only arms and Haiku-written versions, and
  names the tier for every verdict.

### 6.3 JIT freeze (one hash for all items, before any agent or JIT run on an RS item)

- **v2.2** (task #41): a recompile replays every earlier deopt and guard input, and each must still deopt or match the
  interpreter (DEV-NOTES D9). It is a hard prerequisite. O-9 offers running v2.1 and v2.2 as two pre-registered arms
  instead of waiting.
- **v2.1 tolerant compare**, driven by the family's declared compare spec (`"compare": "family"`).
- **Prompt v3**, plus an addendum: produce one named export per entrypoint and declare
  `export const manifest = {entrypoints, subflows, calls}`. The manifest is recorded and scored descriptively; it is
  **not** an acceptance gate.
- **Chain support:** traces store `carry_in`, and `check-traces` and recompiles replay with it.
- `maxFallbacks: 2` for the O/H arms; `compilerFallback: null` for the Haiku-only arms. Every fallback is logged.

### 6.4 Configs per world (example: RS-INVOICE, test world 71)

- `rs-invoice-w71-main`: agent-haiku, JIT-O/H, jit-seed:H, jit-seed:construct-once.
- `-static`: H, H-tier, construct-once.
- `-static-r2`: H.
- `-haiku`: JIT-H/H.
- `-frozen`: JIT-O/H-frozen.
- `-tf`: chain off, H-TF, agent-opus every 4th tick, JIT-O/H-TF.

```json
{"experiment":"rs-invoice-w71-main","familyId":"rs-invoice","split":"test","chain":true,
 "segments":[{"difficulty":3,"world":71,"ticks":"1..16"},{"difficulty":4,"world":71,"ticks":"17..40"},
             {"difficulty":5,"world":71,"ticks":"41..72"},{"difficulty":3,"world":71,"ticks":"73..80"}],
 "arms":["agent:claude-haiku-5-5","jit:claude-opus-5-5/claude-haiku-5-5",
         "jit-seed:experiments/replicate/streams/invoice/port/solve.mjs/claude-opus-5-5/claude-haiku-5-5"],
 "jit":{"warmup":3,"shadowEvery":4,"shadowOnFlags":true,"recompileOnDeopts":2,"maxTraces":8,
        "compilerFallback":"claude-opus-5-5","maxFallbacks":2,"compare":"family"},
 "compile":{"promptVersion":3,"builderEffort":"high","builderBudgetUsd":3,"gatewayUsd":1.5,"checkUsd":1.5,"minutes":30},
 "perTaskUsd":1,"agentBudgetUsd":2,"agentMinutes":15,"compiledMinutes":20,"staticFallback":null,
 "concurrency":1,"spendStopUsd":90}
```

## 7. Metrics

### 7.1 Success

- Per arm and epoch: `succ_core`, `succ_intent` and `succ_intent+prose` (n/N, with a Wilson interval), and the mean
  `score`.
- Per family f: `handled_a(f)`, the share of f's instances where arm a's *delivered* answer passes check f.

### 7.2 Version matrix (offline, after each stream)

- Every accepted version v of every lineage, including each static arm's single version, is run on:
  - every held-out instance of every counted family;
  - 8 random E0/E4 ticks;

  each time with the carry the arm actually held at that tick (from §4.5).
- Compiled path only, with no shadows; a deopt counts as not handled. Cost is about $0.005–0.03 per run (Haiku
  judges).
- Output: `handled_v(f)` and core on the matrix ticks.

### 7.3 Flaw and composition metrics

- **exceeds(a, f)**: `handled_a(f) − handled_Hbest(f) ≥ 0.5`, pooled over the item's worlds, with ≥ 4 instances per
  world, and positive in ≥ 3 of 4 worlds.
- **discovered(f)** (JIT): the first compiled-path instance of f raised a code signal (a guard, invariant or judge
  deopt, a flag, or a flag-triggered shadow), and its trace event names the mutated record (`file_id`, event index or
  fingerprint). Scheduled-shadow catches are reported separately as `caught-by-schedule`.
- **healed(f)**: there is an accepted recompile whose trigger set includes an f instance, the predecessor version
  fails f on ≥ 75% of its matrix instances, and the successor passes ≥ 75%.
- **durable(f)**: healed, and no later delivered instance fails f.
- **run_attributable(f)**, all four required:
  1. f is not spec-evident at the arm's demonstrator tier (§3.3);
  2. construct-once fails f on ≥ 75% of instances;
  3. healed(f) holds in the arm;
  4. the frozen arm's compiled version fails f on ≥ 50% of its matrix instances.
- **Other credit, never counted as run-attributable:**
  - **demonstrator-given**: the interpreter handles the first instance;
  - **spec-evident**;
  - **seed-repaired(f)** (jit-seed:H): H fails f, and some jit-seed:H version passes ≥ 75% with no core regression on
    its E0/E4 matrix ticks.
- **flaws-found(a)** = #{a-class f : exceeds(a, f) ∧ run_attributable(f)}.
- **exceeds(H over a, f)** for every s-family (V7).
- **heal_propagation(f)**: the share of f's affected entrypoints that pass within 2 ticks after the healing recompile.
- **forgetting(f)**: after f is healed, the share of its instances that fail following a later heal for a different
  family.
- **Composition (descriptive):** the manifest declares a subflow used by ≥ 2 entrypoints, and a d-change that hits
  shared logic (RS-INVOICE FX in E3a) is fixed at every entrypoint by one recompile.

### 7.4 Durability (oracle view, per epoch e, W = 6)

- **Steady tick:** delivered by compiled code; no deopt, crash, invalid, recompile or adjudication event at that
  index; same version as the previous tick.
- **Durable-to-end at t:** all of the following hold:
  - t ≤ end_e − W + 1;
  - ticks t..end_e are steady, with at most 1 exception;
  - they all pass core;
  - they contain ≥ 1 instance of every counted family active in e (E1) or of the change (E3);
  - each costs ≤ 3× H's median per-tick $ on e.
- **TTD_e** = t − start_e (∞ if there is no such t). **$TTD_e** = spend from start_e through end_e.
- **Held rate** = the share of ticks after t that pass intent.
- `durability.mjs`'s existing episode metric (W 6, S 0.8) is also reported, for continuity. Static arms are steady by
  construction and are reported as they are.

### 7.5 Cost, latency and maintenance

- $ per tick.
- **ss$_e**: the mean over the second half of each epoch.
- Amortised $/success over all 80 ticks, compiles included.
- **maintenance$_e** = epoch $ − n_e · ss$_E0.
- Break-even tick against agent-haiku and against H.
- Wall time per tick (p50, p95) and model calls per tick.
- $ and tokens by model.
- H$ and H$-graded.
- *Human-equivalent maintenance* (diagnostic proxy, optional): the number of H-patch diff lines needed for H to reach
  the JIT's E3a intent rate. Never stated in dollars.

### 7.6 Diagnostics

- Silent rate (compiled deliveries that fail intent with no signal).
- `carry-schema-break` and `carry-lost` counts.
- Fidelity (core fields equal to H\*'s; fixing a flaw lowers fidelity by design).
- The H − H\* gap.
- Unlisted divergences (dev only, never claimed).
- Compile- vs interpret-attributable failures (§14).

## 8. Verdicts and statistics

### 8.1 Verdicts

| Id | Verdict | Rule |
|---|---|---|
| V1 | equivalent on base | P-H2 holds (JIT-O/H core on E0 + E4 non-inferior to H-best within δ) |
| V2 | more robust under drift | P-H1 holds (JIT-O/H core on E1 + E2 + E3a > H-best) |
| V3 | finds flaws the human design has | flaws-found ≥ 1 for an item, with durable(f), in ≥ 3 of 4 worlds |
| V4 | adapts to world change | d-family handled ≥ 0.75 over E3a in ≥ 3 of 4 worlds. "Adapts to the unknown" may be claimed only from the sealed set; E3b is reported |
| V5 | durable-equivalent (owner's words) | post-drift TTD (E3) < ∞ in ≥ 3 of 4 worlds, and over the last W ticks of E3: core ≥ H-best on the same ticks, and intent ≥ 5 of 6 in absolute terms |
| V6 | almost / more efficient | ss$ ratio, JIT-O/H vs H$-graded, on E0 and on E4: ≤ 1.25 is "almost", ≤ 1.0 is "more efficient", in ≥ 3 of 4 worlds. Amortised $/success and maintenance$ are reported; repeated against H-tier |
| V7 | where the human design is better | exceeds(H-best over arm, f) for each s-family; P-H1 and P-H2 read in reverse |
| V-H | Haiku by itself | V1–V6 recomputed for JIT-H/H and for construct-once; P-H3 |

### 8.2 Primary hypotheses and tests (Holm; family-wise one-sided α = 0.05)

- **P-H1:** JIT-O/H core success > H-best on drift ticks (E1 + E2 + E3a, 48 per world).
- **P-H2:** JIT-O/H is non-inferior to H-best on base ticks (E0 + E4, 24 per world), with margin δ.
- **P-H3:** JIT-H/H core success > H-best on drift ticks.

**Unit and test.**
- The unit is the world, because ticks inside a closed-loop world are dependent.
- Δ_w is the paired difference in core pass rates on the same ticks.
- Test: exact one-sided Wilcoxon signed-rank over {Δ_w} pooled across every built item (n = 8 in the minimum viable
  programme, 12 in the full one). Zero differences are dropped and ties get average ranks. For P-H2 the test is on
  Δ_w + δ.
- Attainable significance:
  - n = 8, first Holm step (α = 0.0167): at most one negative world, of rank ≤ 2.
  - n = 12: W⁻ ≤ 11, i.e. 2–3 negative worlds if their differences are small.

**Sensitivity** (reported, not decisive):
- a world-cluster bootstrap (B = 10,000) of each Δ and of TTD;
- a stratified exact McNemar test on teacher-forced ticks only.

A GLMM is not used because it would need an unpinned statistics dependency. Everything else is directional.

### 8.3 Noise band δ (frozen at F6)

δ = max of three quantities:
- 1 tick in 24 (4.2 points);
- the H run 1 vs run 2 paired disagreement on E0 + E4 of dev worlds 2–3;
- the JIT-O/H lineage spread between dev worlds 2 and 3.

### 8.4 Headline restrictions

A headline sentence may use only results that meet all of these conditions:
- closed loop, one world per stream, spec-A;
- H-best as the comparator;
- the port validated (engine lane, or source-pinned and labelled as such);
- sealed drift families for "unknown" claims;
- K = 4 worlds and the pre-registered pooled tests.

In addition:
- Every win is split into spec-evident, demonstrator-given, run-attributable and seed-repaired.
- The Haiku-only tier is its own sentence.
- Before any claim, an independent agent re-classifies each claimed a-family from only the registry entry and one
  failing instance.
- All negatives are kept.
- Wording is "published template", with the scope from §1.3.

## 9. Items in detail

Family classes are **provisional** until the F1 audit. For every candidate, the pointer, H\* count and twin assertions
are filled in at F1.

### 9.1 RS-INVOICE (n8n:13115)

- **Pin.** gz sha256 `31b8fcaac51d0e1d939061ef1fd1d626b49da92a5af87245003134cbb3cf2314`; revision "template 13115;
  createdAt 2026-01-30; sha256:b83b291bb1a5bbce"; 126 raw / 88 normalised nodes.
- **World.** One fictional company over about 16 weeks:
  - one tick = one business day; files carry arrival times, and H replays its hourly 08:00–21:00 polls inside the tick;
  - our own list of 8 categories;
  - 30–60 vendors, each with 2–4 aliases, a category, an amount range and a number format;
  - budgets for 3–6 categories, an owner chat id, a budget-change log, a threshold of 0.8.
  - The world crosses 3–4 month boundaries, 3–4 monthly reports (the 10th, 09:00) and about 16 weekly reports
    (Friday 17:00).
- **Entrypoints.** inbox, chat, weekly, monthly.
- **Outputs.**
  - `files[]{file_id, decision: record|duplicate|review|skipped, invoice{vendor, amount, currency, amount_eur, date, number, category}|null}`;
  - `months[]`;
  - `alerts[]{category, period, pct}`;
  - `chat[]{chat_id, outcome}`;
  - `budgets_after[]`, `threshold_after`;
  - `reports[]`;
  - prose: alert, report and chat text (claim checks).
- **Generator constraints for a clean E0** (from R1-5): EUR only; chat budget changes only for categories with no
  invoice this month; no category at or above the threshold; threshold fixed at 0.8; exact-byte duplicates (about
  15%) only *across* ticks, never twice within one poll; OCR always succeeds; every chat comes from the owner.
- **Families:**

  | Id | Class | Evidence | Instance | H\* | Intent |
  |---|---|---|---|---|---|
  | F4 stale budget | a (`state`) | `CalcSummary` sets `budget` only on the category's first creation in the month [obs] | a budget is raised mid-month for a category already seen | % against the old budget | the current budget |
  | F5 re-scan / re-export | a, pending audit (author dedupe statement) | `Crypto` byte hash, then `StorageInput` key from the model's date [obs] | the same invoice with different bytes and identical fields | recorded twice | duplicate |
  | F9 duplicate within one poll | a, pending audit plus `source` semantics (item batching) [unverified-semantics] | `CheckInvoiceExists → SaveInvoice` over a batch | two copies in the same hourly poll | recorded twice [probe] | duplicate |
  | F6 informational copy | b (provisional) | the analyzer rule says to count informational copies | a copy of a recorded invoice | — | dev only |
  | F1 foreign currency | **d** (E3a, shared logic) | `CalcSummary` adds the raw `amount`; € in alerts; EUR default [obs] | US and UK vendors appear with an FX feed in the inputs | foreign amount summed as EUR | EUR at fx(date) at every entrypoint |
  | F2 repeat alerts, F3 stored threshold ignored | b | `SummaryInput` literal 80 [obs] | — | — | dev only |
  | F7 model call before dedupe | cost | edge order | E0 duplicates | — | shows in H$ |
  | F8 | j | — | — | — | H − H\* |

- **s-candidates** (none occurs in E0):
  - an unauthorised chat is refused;
  - first-run `/start`;
  - a multi-invoice bundle, contract, quote or bank statement is skipped per the analyzer's rules (the bundle keeps
    its author label; §0.3, R1-14);
  - OCR failure → review;
  - an off-list category → our "Other".

  Credit notes are dropped from grading. Probe: an injection line in the OCR text.
- **Port.** Inbox path `IfNotForReviewOrDuplicate → … → CalcSummary → SummaryInput → IfNeedsAlert …`; chat path
  `BudgetTrigger → IfFirstRun/IfAuthorized/IfStartMessage → BudgetAgent` (a Haiku tool loop); weekly and monthly paths.
  `ManualResetTrigger` is dropped. OCR and the ainoflow storage service become stand-ins whose semantics we author
  (circularity stated).
- **Tier.** gpt-4o ×2 → `claude-sonnet-5-5`.
- **Harness effort.** 6–9 agent-h, $60–95.

### 9.2 RS-SHOP (n8n:20421), the ceiling item

- **Pin.** gz sha256 `3a29fdca559c6a1f605709d62a80552358e93c173be0284752f0b119029b71aa`; revision "template 20421;
  createdAt 2026-10-05; sha256:0e52b46e3f6eff59"; 340 raw / 306 normalised nodes; 6 sub-workflow nodes; created after
  the cutoff. A credential-shaped token in a data-table node is never copied.
- **World.** A fictional clothing shop in one currency:
  - one tick = 3 hours of shop time, so 80 ticks = 10 days, with the nightly 03:00 job every 8th tick and drafts that
    age past 7 days inside the stream;
  - 30–80 products × sizes × colours, with stock;
  - 50–300 customers;
  - scripted conversations: browse, ask, add, change size or colour, remove, checkout, delivery details, ask for a
    human;
  - admin answers and admin takeovers;
  - Stripe events: completed, expired, redelivered, out of order.
- **Entrypoints.** message batch, Stripe event, admin action, nightly.
- **Port scope.**
  - Ported: the sales core, checkout, the Stripe path, nightly abandonment, pending admin answers, human pause.
  - Dropped (listed in `coverage.md`): the admin UI pages, FB OAuth callback, setup/first login, the preview assistant,
    the payment-return page (no graded effect), refunds (no node found [M]).
  - Stand-ins (stated): image analysis → text descriptions; product vector search → a lexical stand-in.
  - Estimated size: 150–200 ported nodes.
- **Core:**
  - the cart equals the scripted truth (sizes, colour synonyms, quantities, removals);
  - prices come from the live table;
  - stock is never negative or oversold;
  - at most one live payment link per cart;
  - paid exactly once;
  - a paused customer gets no bot reply;
  - drafts older than 7 days are abandoned at the nightly tick;
  - forged Stripe events are rejected;
  - reply claim checks (price, size, availability, total).
- **E0 constraints:** one conversation per customer in flight per tick; no two payments for the same unit in one
  batch; no bursts across the debounce window; prices fixed; no redeliveries.
- **Families:**

  | Id | Class | Evidence | Instance |
  |---|---|---|---|
  | SH1 open-cart selection | a, pending (`state`) | `Find Open Cart` takes the last open row in returned order [obs, survey] | interleaved messages and checkout leave two open rows |
  | SH2 inventory read-modify-write | a, pending plus `source` semantics [unverified-semantics] | `Read Inventory For Stock → Calculate New Stock → Reduce Inventory Stock` [obs, node names] | two paid events for the last unit in one batch |
  | SH3 debounce burst | a, pending [probe] | the 4 s wait plus `isLatest` [survey] | a burst spanning the window |
  | d: a second Meta channel shape | d [I] | — | E3a: Instagram-style payloads on the same webhook |

- **s-candidates** (author defences, all [obs] by node name):
  - Stripe redelivery is handled idempotently;
  - a forged signature is rejected;
  - a price change between cart and checkout is re-priced;
  - sold out at checkout is validated;
  - a second checkout expires the old link;
  - an admin takeover pauses the bot;
  - a duplicate message id is ignored.
- **Tier.** gemini-2.5-flash ×3 → Haiku, so H-tier ≡ H.
- **Harness effort.** 10–14 agent-h, $80–130.

### 9.3 RS-QUOTE (n8n:12285)

- **Pin.** gz sha256 `e97c60fa4e91dfccbc3331937755721e2d6757c4ace22110b76370453190db8e`; revision "template 12285;
  createdAt 2025-12-29; sha256:e742437573fd50d8"; 68 raw / 58 normalised nodes. Read only through the redacting
  reader. The original is in French and the synthetic world is in English (stated).
- **World.**
  - A fictional agency with 12–25 SKUs `{sku, title, internal_cost, unit, market_low ≥ 5×cost, market_high}`.
  - CRM rows; calendar meetings with attendees and an organiser flag.
  - One tick = one business day. Deals are episodes (§2.5).
  - A transcript (VTT, 40–150 cues) plants 1–3 needs paraphrased away from SKU names, plus quantities, retractions
    and a timeline.
- **Entrypoints.** transcript, approval answer, document status, signature webhook.
- **Core:**
  - meeting match;
  - SKU multiset and quantities exact;
  - `unit_price ∈ [cost/0.2, market_high]`;
  - ≤ 3 lines (the author's cap);
  - `deposit_pct ∈ [20, 70]`;
  - `end_date` correct;
  - no send of version v without an approval of v;
  - approvals routed correctly;
  - a signature updates the signing deal's CRM row (H-configured);
  - email claim checks.
- **E0 constraints:** the external attendee listed first; meeting titles differ from the file name only in case; the
  document service always ready within 3 polls; no stale or duplicate signatures.
- **Families:**

  | Id | Class | Evidence |
  |---|---|---|
  | Q1 fixed document id in `details` | **cfg** | [obs]; H-configured fills it from the webhook |
  | Q2 organiser listed first | a, pending (needs an author statement about who the client is) | `client_email = attendees[0]` [survey obs] |
  | Q3 title variants | a, pending | equality on `split(" -")[0]` with `ignoreCase` [obs]; en dash, a "Call:" prefix, extra spaces; unique tolerant match asserted |
  | Q4 deposit as discount | b, unless pinned PandaDoc API docs confirm | — |
  | Q8 unbounded status poll | b (`fault`, E3b, reported) | `Status ? ↔ Wait for completion` |
  | Q5 constant memory keys, Q9 | j | — |

- **s-candidates:**
  - nothing is sent before approval;
  - the 3-line cap holds when more needs are mentioned;
  - prices come only from the catalogue, with the margin rule;
  - rejection → feedback logged → revision.
- **Not graded:** idempotency under redelivery (b unless the author states it), reminders and expiry.
- **Tier.** grok-4, sonnet-4.5, gpt-4-turbo → sonnet; opus-4.5 → opus.
- **Harness effort.** 8–11 agent-h, $70–105.

### 9.4 RS-SRE (n8n:19463), optional

Built only if O-2 funds it **and** A1, A2, A4 and A8 pass the H\* gate on dev.

- **Pin.** gz sha256 `46d6d34e4cabe60a741f6786059b8de3bd61d818d018ccec9a5678a1a28915c3`; revision "template 19463;
  createdAt 2026-09-11; sha256:d46ed9693b8bc624".
- **Families:**

  | Id | Class |
  |---|---|
  | A1 storm detection never fires | a |
  | A2 only the first alert of a group | a (E0: one alert per payload) |
  | A4 refire after resolve suppressed | a, `state` (E0: no resolve → refire for the same fingerprint) |
  | A8 count never reset | a, `state` |
  | A7 flapping config unread | a, pending |
  | A5 comment without task id | cfg |
  | A6 response only on the ticket path | u |
  | A3 same-node validity flag | decided from `source` semantics; if confirmed, H-patched (1 line) becomes the primary H and A3 joins the u table |

- **Leakage control (R1-22).** Postmortems state causes in prose. Root-cause codes appear only in spec-A and the
  schema. A leak test asserts that no current-truth code appears next to the current service or fingerprint.
- No page-acknowledgement policy is added (§0.3, R2-3).

### 9.5 RS-SUPPORT (n8n:11807), reserve

- Families: S1, S2, S5, S6 and S7 are class a, pending; S3, S1b and S4 are b.
- Retrieval (R1-20): either pin a small CPU embedding model under D5 (HF repo plus revision sha), or add a
  retrieval-perfect H variant. S2 knowledge-base gaps must hold under both lexical and embedding retrieval.
- Reuse n8n:20281's fixtures and label protocol, with two annotators (one agent, plus the owner on 20 items).

## 10. Prerequisites (harness changes)

| Id | Change | Anchor |
|---|---|---|
| P1 | `beds/rs-<item>/index.mjs` re-exports `experiments/replicate/streams/<item>/index.mjs` | `experiments/lib/beds.mjs:18` loads only `beds/<id>/` |
| P2 | Honour an explicit `staticFallback: null` (`'staticFallback' in raw`). On a non-ok status, finish with `delivered: 'none'`, output null and `compiledStatus` recorded; drop null from `arm.models`. The default is unchanged, so arm hashes stay the same | `stream.mjs:72`, `:356-370` |
| P3 | World-stream segments `{difficulty, world, ticks}` expanded to seeds; schedule check in `generate` | `normalizeConfig`, `streamTasks` (`:219`) |
| P4 | `config.chain`: a `state.json` carry file, `carry_out`, per-arm sequential order in chain mode, `carry_in`/`carry_out` sha in rows, traces holding `carry_in`, carry excluded from comparison, `carry-lost` and `carry-schema-break` events | `driveArms` (`:603`, `:617`), `JitRun`, `check-traces.mjs` |
| P5 | `/svc/*` with provisional ledgers, commit on delivery, simulated clock and sealed fault schedule. Services started for oneshot families that declare `services`, in `b0Agent` and `runCompiled`. Bed contract v1.1 `oracle(task, output, ctx)` | `services.mjs`, `b0-agent.mjs:43-44`, `run-compiled.mjs:46`, `beds/CONTRACT.md` |
| P6 | Per-row artifacts `outputs/<idx>.json` (output, ledger, carry) | `finish` (`:289-305`) |
| P7 | Shared stream helpers: world replay, epoch schedule, `triggers()`, twins, layered oracle, details compactor | `experiments/replicate/streams/lib/` |
| P8 | oracle-controls extension: reference chain, bad controls (empty, shuffled, plus near misses per item), H\*/H-literal/H-configured chains, trigger and twin assertions, family gates; counts only on test worlds | `oracle-controls.mjs` |
| P9 | `analyze-streams.mjs` plus a `durability.mjs` extension: epochs, family metrics, durable-to-end, verdicts, Wilcoxon, bootstrap | `experiments/jit/durability.mjs` |
| P10 | Version-matrix runner (offline, compiled only, archived carry) | new |
| P11 | `jit-seed:<script>/<interpreter>/<compiler>` arm: `JitRun.initialVersion`, warmup 0, script sha in the arm hash | `parseArm`, `JitRun` |
| P12 | JIT freeze per §6.3: v2.2 (#41), v2.1 family compare, prompt v3 plus addendum | tasks #36, #41 |
| P13 | Gates: overlap checker (5-gram ≤ 2%, no shared run ≥ 40 characters), secret scan, "no family named" checker, intent-parity and class audits, spec-explicitness runner, canary | new |
| P14 | Sandbox test: agents and compiled solvers cannot read `experiments/replicate/streams/*/port/` (`DEFAULT_HIDDEN` hides `/home/user`, `src/executors/claude-code.mjs:18`). Add the port path to `.gitignore` **before** any port file is written | — |
| P15 | Commit the redacting reader as `research/replicate-20261008/tools/rs-read.mjs`, with its sha. Shallow-clone n8n source at a pinned release as a research import (URL, SHA, date, licence; no install hooks). Record per item: URL/API endpoint, timestamped `retrievedAt`, raw and gz sha256, `updatedAt` = absent. The owner holds an archive of the raw bytes | AGENTS.md "Dependencies must be pinned" |
| P16 | Sealed drift author session plus a sealed plug-in loader | like `beds/sealed/loader.mjs` |

Estimate: 8–12 agent-h, $50–90. P2, P3 and P6 are each a few dozen lines. P4, P5 and P10 are the substantial ones.

## 11. Freeze order, build order, programme gate

**Freeze order** (every step hashed into the pre-registration; any later change is a dated amendment followed by a
dev re-run):

| Step | What is frozen |
|---|---|
| F0 | Item set and substitution triggers (§1.3) |
| F1 | Author-statement registry, family list with classes (after the audit), intent rules, s-families, E1 schedule. This happens before spec-A exists |
| F2 | Sealed drift authored and sealed (hash) |
| F3 | O-6(a) signed (O-6(b) if jit-seed:H runs) |
| F4 | spec-A by the blind author → gates → spec-explicitness labels → H\*/H calibration on dev worlds 2–3 (no agent or JIT run) → spec-A frozen |
| F5 | JIT version and configs frozen, identical for all items, before any agent or JIT run on any RS item |
| F6 | Calibration (K3) on dev world 4; dev streams for every arm on dev worlds 2–3; δ, H caps and spend stops set; pre-registration committed |
| F7 | Test worlds generated (counts only); sealed families unsealed; held-out runs |

**Build order.**
1. P1–P16. P12 waits for #41 and #36.
2. RS-INVOICE: build, port, gates, dev streams. Then the **programme gate**: continue only if, on dev world 2, JIT-O/H
   core on E0 ≥ H-best − δ, **or** there is ≥ 1 effective heal in E1 or E3 confirmed by the version matrix. Otherwise
   stop and diagnose from the traces before building more (THESIS-JIT kill/pivot rule).
3. RS-SHOP build, while RS-INVOICE held-out runs.
4. RS-QUOTE if O-2 funds it. RS-SRE is optional; RS-SUPPORT is the substitute.

## 12. Kill and stop rules

| Level | Rule |
|---|---|
| Item K1 | Oracle health fails, or an alternative design written from spec-A with truth-injected judgments fails → exclude |
| Item K2 | H\* core < 95% on E0 after 2 spec-A revisions (both before F4) → the spec is misaligned; exclude or rescope |
| Item K3 | Calibration (dev world 4, TF, n = 4 per cell): agent-haiku ≥ 90% on both E0 and E1 → "no headroom" label; the item still runs H, JIT-O/H and the Haiku tier. Agent-opus ≤ 25% on E0 → the spec or generator is broken; fix before F6 |
| Item K4 | Harness spend > 2× estimate (INVOICE $190, SHOP $260, QUOTE $210) → stop; report partial |
| Run | Any oracle control fails → stop all. An arm over 2× its estimate → stop that arm. Environment faults > 25% of an arm's ticks → that arm is invalid. A harness error twice → exclude that arm. Per-config `spendStopUsd` (§13) |
| Programme | The §11 gate. A global stop at the total approved under O-2. A one-line notice to the owner before each item's held-out runs start |

## 13. Cost, quota and wall time

List-price lower bounds [I], scaled from DEV-NOTES D10/D12 (JIT-O/H: $7.53 for 24 tasks), CALIBRATION.md (Haiku agent
$0.014–0.056 per task) and the policy prices (Haiku $0.10/$0.50, Sonnet $2/$10, Opus $4/$20 per MTok). The weekly
subscription allowance, not dollars, is what binds (THESIS-JIT §6.6).

**Per world (80 ticks):**

| Arm | Basis | $ |
|---|---|---|
| H (each run) | 2–12 Haiku node calls × 3–6K tokens per tick | 0.5–3 |
| H-tier | the same calls at Sonnet/Opus prices | INVOICE 6–15; QUOTE 20–45; SHOP 0 |
| construct-once | $1.5 build + 80 compiled runs | 2–4 |
| agent-haiku | 80 × $0.05–0.10 (the carry adds tokens) | 4–8 |
| JIT-O/H | about 13 Opus interpretations, 5–7 compiles, about 20 shadows, about 6 adjudications, about 65 compiled runs | 20–35 |
| JIT-H/H | Haiku interpretations and compiles | 6–14 |
| JIT-O/H-frozen | warmup + 1 compile + deopt interpretations | 6–12 |
| jit-seed:H / jit-seed:construct-once | shadows + recompiles | 15–30 / 15–28 |
| TF: agent-opus every 4th tick; JIT-O/H-TF | 20 × $0.4–0.8; as JIT-O/H | 8–16; 20–35 |
| Version matrix (per item) | about 50 versions × about 40 instances | 10–40 |

**Per item, held-out:**
- core ×4 worlds: $116–236;
- secondary ×2 worlds: INVOICE $62–130, SHOP $50–100, QUOTE $90–190;
- teacher-forced world: $29–52;
- jit-seed:construct-once: $15–28;
- matrix: $10–40.

Totals: **INVOICE $232–486, SHOP $220–456, QUOTE $260–546.**

**Programmes:**

| Programme | Contents | Total |
|---|---|---|
| **Minimum viable (default recommendation)** | RS-INVOICE + RS-SHOP. Core ×4, secondary ×1, matrix; no TF JIT, no agent-opus, no jit-seed:construct-once | prerequisites $50–90 + harness $140–225 + held-out $308–667 = **≈ $500–980** |
| Full | 3 items with all arms | $50–90 + $210–330 + $712–1,488 = **≈ $970–1,910** |
| RS-SRE (add-on) | harness + held-out | ≈ $55–85 + $200–420 |

**Spend stops per world config:** main $90, static $40, haiku $25, frozen $20, tf $70.

**Agent-hours:** prerequisites 8–12, INVOICE 6–9, SHOP 10–14, QUOTE 8–11.

**Wall time:** closed loop makes each arm sequential. agent-haiku takes about 80 × 4.5 min ≈ 6 h per world; JIT arms
5–8 h; H 2–3 h. With 2 worlds in parallel on the 4-vCPU VM, one item takes about 20–30 h. Opus interpreter sessions
dominate allowance use, so schedule held-out runs after an allowance reset.

## 14. Should we train a small composer instead of using Haiku?

**Not now.**

- The 1,559-item corpus is static definitions with no execution outcomes. It can teach syntax, not which composition
  works.
- Dev evidence points at the demonstrator, not at Haiku as compiler:
  - Sonnet → Haiku scored 22/24 (DEV-NOTES D10);
  - Opus → Haiku scored 18/24 because of a judge check that was too strict and a heal that widened a guard (D3, D9,
    D12);
  - Haiku → Haiku learned its interpreter's errors (D2).
- THESIS D9 parks local generative models.

These streams log, for every compile: the builder model, acceptance, fallback use, agreement with the traces, and
whether each failure is compile-attributable (the interpreter was right and the code wrong) or interpret-attributable.

**Train or tune a composer only if all four hold:**
1. Compile-attributable failures are ≥ 50% of JIT-O/H failures on ≥ 2 items.
2. Opus fallback compiles fix them, so the gap is compiler skill, not missing information.
3. Cheaper levers do not close the gap on dev: a Sonnet compiler, prompt v3, more traces (task #40).
4. construct-once-haiku and JIT-H/H fail on composition and heal propagation (§7.3) where JIT-O/H succeeds.

The training data would then be these streams' (trace, compiled code, oracle verdict, effect ledger) records, not the
corpus.

## 15. Owner decisions (defaults in brackets)

| # | Question | Default |
|---|---|---|
| O-1 | Commit the ports of n8n-ToS items? | No: local and sha-pinned. Generators, oracles, spec-A and fixtures are ours and are committed |
| O-2 | Programme size: minimum viable (≈ $500–980), full (≈ $970–1,910), or with RS-SRE | Minimum viable first, decide RS-QUOTE after RS-SHOP's dev streams; each item's held-out run is its own experiment |
| O-3 | Build the HA gate (J = 0, GPL)? | No; RS-SHOP is the ceiling |
| O-4 | b-class families reported but never counted? | Yes |
| O-5 | The ops slot is optional (RS-SRE), not a CI pipeline? | Yes |
| **O-6** | (a) Declassify spec-A, the rule cards, the port (for H's Haiku nodes) and the canary prompts after the §3.5 gates. (b) Allow the port as compiler input for jit-seed:H | Required before any executor runs; (b) only if jit-seed:H runs |
| O-7 | Engine lane: run pinned n8n (Docker host, or an isolated npm install) to diff the port node by node? | No; source-pinned semantics, labelled as such |
| O-8 | Add one item drawn at random (selection-bias check)? | Dev only |
| O-9 | If v2.2 is late: wait, or run v2.1 and v2.2 as two pre-registered arms? | Wait |

## 16. Threats to validity

- **Spec rigging.** Mitigated by intent parity, the blind author, spec-explicitness labels and s-families. The intent
  rules are ours and are published.
- **Port fidelity.** Mitigated by H\*, the coverage audit, the semantics ledger and the optional engine diff. The
  ports are model-written.
- **Circular mocks.** OCR, storage, PandaDoc, Stripe and Meta semantics are authored by us from documentation and
  observation, and the ledger marks each source.
- **H on Haiku.** Mitigated by H-tier and H-best.
- **Teacher forcing.** Now secondary. Closed loop has its own risk (carry schema drift), which is measured.
- **Deopt rollback** is a harness abstraction (§2.6).
- **Prose** is graded only by claim checks.
- **Single annotator** for allowed-set labels. A second annotator applies to RS-SUPPORT.
- **D15 provenance.** All port and registry text is tainted until O-6.
- **Contamination.** Three items were created before the cutoff.
- **Selection.** Items were chosen for documented defects. The claims are scoped accordingly.
- **Compile-lineage variance.** K = 4, world-level tests.
- **Simulated time and execution granularity** (hourly polls inside daily ticks).
- **Only script-form construction** is measured; the typed IR is not.
- **The CLI's 1-hour prompt cache** makes trial costs non-independent (PREREG-stream §8).
- **The harness and the arms come from the same agent pool**, so the evidence class is development-class harness.

## 17. Sources

- `research/replicate-20261008/SELECTION.md`, `DESIGN.md` (§0, §7, §9–11), `harness-cost.json`.
- `experiments/replicate/{build-selection.mjs,selection.json,items/*,mocks/}`.
- `research/corpus-20261006/items.jsonl` (features, verdicts, revisions), `COVERAGE.md`, `AGENTIC-CONVENTIONS.md`.
- `/opt/corpus/n8n/workflows/{13115,11807,12285,19463,20421}.json.gz`, at the pins in §0.4.
- `docs/THESIS.md` §10 (D9, D10, D11, D14, D15); `docs/ROADMAP.md` §2.9 (lines 661–667).
- `research/jit-20261008/{THESIS-JIT.md,SPEC.md,DEV-NOTES.md (D1–D12),PREREG-stream.md,CALIBRATION.md}`.
- `experiments/jit/{stream.mjs,run-compiled.mjs,oracle-controls.mjs,durability.mjs,compile.mjs,interpret.mjs}`.
- `experiments/lib/{beds.mjs,services.mjs,arms/b0-agent.mjs}`; `src/executors/claude-code.mjs`.
- `beds/CONTRACT.md`, `beds/sealed/`; `policy/models.json`.
- The complexity survey and draft design of 2026-10-09, and their two reviews (scratchpad: `score.mjs`, `final.mjs`,
  `rs-read.mjs`; to be committed under P15).
