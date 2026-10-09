# W-BED: a workflow complexity ladder for "can Haiku cheaply build the workflows humans hand-curate"

*Design, 2026-10-09, laptop session. $0: no model calls, no paid runs, `beds/sealed/` not read. Companion files:
[FLOW-V3.md](FLOW-V3.md) (the primitives the upper rungs need) and [PRIOR-ART-SWARMS.md](PRIOR-ART-SWARMS.md) (Claude
Code workflows, Kimi Agent Swarm, LangGraph, n8n, primitive by primitive). Tags: **[M]** measured or read in this repo
(file cited); **[M-c]** computed at $0 for this document from `research/corpus-20261006/items.jsonl` (§7.1 gives the
definitions); **[I]** inference or estimate; **[W]** public docs (cited in PRIOR-ART-SWARMS §6). Disagreements with the
coordinator's brief are in §10 (Objections), not silently folded in.*

## 0. Summary

- **What it is.** A family of bed families. Each rung is defined by the *structural* feature its best-known solution
  needs: R1 typed linear pipeline, R2 judged branching, R3 fan-out/fan-in, R4 nested sub-workflow by hash, R5 a node that
  owns a sandboxed subagent, R6 a planned swarm, R7 effects/waits/approvals (parked), R8 run-time faults with self-heal
  (an overlay on R1–R6). An R0 control rung is added: a task where the best workflow is none.
- **Two tracks.** Synthetic rungs (W-S) give seeds, exact oracles and statistical power. Corpus rungs (W-C) use
  hand-written real workflows from the corpus and the replication-stream items for realism and for the LangGraph/n8n
  comparison (§7). Synthetic rungs carry the decisions; corpus rungs are reported per item.
- **Arms.** (a) Haiku-JIT (H/H); (b) Haiku-JIT with Opus demonstrator traces (O/H, three roles); (c) a frozen,
  hand-curated reference workflow on Haiku judges; (d) agent every time (Haiku; Sonnet and Opus on a subset); (e) B1:
  a script built once by an independent Haiku builder with equal construction budget.
- **Headline outcomes.** Verified successes and cost per verified success including amortised construction; the
  curriculum effect (later rungs cheaper because earlier solutions are reused by hash); heal rate under R8 faults;
  durability; structural fidelity (descriptive only).
- **First paid run** (§9): R1–R4, arms (a), (c), (d-Haiku), K = 2 streams × 24 tasks per rung: about **$115–250 list**
  without the curriculum ablation, **$175–380** with it, almost all Haiku. Build before it: $0 except about $13–48 for
  the triviality attacks and for Opus to write four reference workflows.
- **Honest prior** (§10): the repo's evidence says Haiku-JIT will likely *not* beat the Haiku agent on cost at R1–R2
  over 24 tasks (FRONTIER-GAPS G4: the JIT "sits in the middle of the frontier") [M]; the bet is R3–R6, where the agent's
  success should fall with task length and width, and the curriculum, where reuse should cut construction cost.

## 1. Why a new bed

- **Today's beds are flat.** `records` and `kinetics` are one-shot families whose output is one JSON answer
  (`beds/records/index.mjs`, `beds/kinetics/index.mjs`, `family.kind: 'oneshot'`) [M]. Their best solution is a linear
  script with a few judges. They test crystallize/heal *economics* (DEV-NOTES D1–D14), not whether Haiku can construct a
  workflow with branching, fan-out, nesting, agent nodes or swarms.
- **There is no hand-curated reference to beat.** The only hand workflow measured is `fhand-haiku` on records v3,
  35/36 at $0.016/trial (`research/core-20261006/REPORT.md:16`) [M]. The replication streams design
  (`research/replicate-20261008/DESIGN-STREAMS.md`) does have real hand-written workflows, but at $500–980 for the
  minimum programme (§0.2 item 9) [M], with four worlds per item and no ladder.
- **The evidence unit is one family per claim** (FRONTIER-GAPS K3, §3.13 Bet B) [M]. A ladder of families with a
  held-out rung is a small, structured version of Bet B.

## 2. Shared design

### 2.1 Domain and code layout

One fictional back-office world: a group of companies whose customer, invoice, payment, vendor-statement and
research-note data arrive in messy exports. One domain lets an earlier rung's solver be a correct module of a later
rung's task, which the curriculum effect needs (§5). It also reuses the primitives the beds already have [M]:

| primitive | source |
|---|---|
| seeded RNG, canonical JSON, token estimate | `beds/lib/rng.mjs`, `beds/lib/canonical.mjs` |
| identity resolution (clusters, conflict winners, twins, namesakes) | `beds/records/world.mjs` (`buildWorld`, `ruleSolve`, `resolveGroup`, `clusterRows`) |
| date conventions and per-system notes, amount formats, FX quotes | `beds/records/render.mjs` (`ORDER_NOTE`, `fmtAmount`, `rateText`, `buildNotes`, `buildSpec`) |
| void/status vocabularies, mirror systems, balance perspective | `beds/records/render.mjs` (`FLAG_NOTE`, `MIRROR_NOTE`, `PERSP_NOTE`) |
| exclusions stated in prose, units, tolerance fitting | `beds/kinetics/world.mjs` (`TOL` 0.10), `beds/kinetics/fit.mjs` (`fitMM`) |
| documents, errata, retractions, accepted-table resolution | `beds/synth/world.mjs`, `beds/synth/catalog.mjs` |

Layout [I]: `beds/wbed/lib/` (shared world: entities, systems, documents), `beds/wbed-r0/` … `beds/wbed-r6/`,
`beds/wbed-rh/` (held-out rung), each a bed per `beds/CONTRACT.md` v1 with `family`, `outputSchema`, `generate`,
`oracle`, `referenceSolve`, `badControls` [M], plus two W-specific exports:

```js
export const stages;        // [{ id, inputSchema, outputSchema, oracle(stageTask, out), project(task) -> stageTask }]
export const structure;     // the best-known solution's structure features (§6.3), declared by the bed author
```

`stages` makes every stage of a rung a task in its own right with its own oracle. That gives the composed oracles the
brief asks for, and it is what lets R4 pose an R1 task as a child.

### 2.2 Oracle construction (the same rule on every rung)

1. **End-to-end oracle** on the delivered answer: exact on integers (money in minor units, counts, ids), set-exact on
   lists, and the bed's stated relative tolerance on fitted numbers (kinetics `TOL` 0.10) [M]. Recomputed from
   `(seed, split, difficulty)`; never reads anything in the output but its value (CONTRACT) [M].
2. **Per-stage oracles** (`stages[i].oracle`) score a stage's output when a run's trace exposes it. They are
   analyst-side diagnostics for fault localisation, never success criteria, because a correct workflow need not have the
   reference's stages.
3. **Mined invariants** (conservation, counts, round-trips; THESIS-JIT §2.3 item 2) are generated by the bed author from
   the generator and validated against `referenceSolve` and every bad control. They are reported as a "free verifier"
   whose recall is measured per rung (FRONTIER-GAPS §3.6 falsifier: recall < 0.5 or false alarms > 0.2) [M]. No system
   component sees them.
4. **Controls**: `referenceSolve` passes ≥ 20 seeds per difficulty; `empty`, `shuffled-or-corrupted` and ≥ 1 plausible
   near miss fail ≥ 20 seeds (CONTRACT oracle-health rules) [M]; plus one **structure-necessity control** per rung
   (§2.4).
5. Hidden truth never appears in prompt, inputs or files (CONTRACT leak test) [M]. The oracle module lives where the
   solver sandbox cannot read it, as for every bed (`stream.mjs` header) [M].

### 2.3 The hand-curated reference workflow (arm c)

- **Author.** One Opus 5.5 session per rung (a single `claude -p` builder session, not a Workflow fan-out; the owner
  rule bans new fan-outs, HANDOFF §0) [M], or the owner. It writes `reference.mjs` in flow-v3 (FLOW-V3.md) from the rung
  spec and a **fixture set**: dev seeds 373–378 with their inputs and `referenceSolve` outputs. That is what a LangGraph
  engineer has: a spec and a few labelled examples. It never sees the oracle code, the generator source or the bad
  controls.
- **Asymmetry, declared.** The reference author sees labelled outputs; the JIT arms see none (no oracle access for any
  system component, THESIS-JIT §2.7) [M]. So arm (c) is a ceiling-like baseline, as `fhand` was. The brief calls it
  "the LangGraph engineer's graph"; this is the faithful reading.
- **Validation and freeze.** One validation run on dev seeds 301–312 (oracle-scored, analyst-side). If it passes fewer
  than 10/12, the author gets the failing seeds' inputs and expected outputs once, revises once, and the result is frozen
  by sha256 whatever its score. Revisions and their cost are recorded. The reference is never tuned again.
- **Authoring cost** = the session's list-price dollars, tokens, wall-clock and (if the owner writes it) owner minutes.
  This is the proxy for human curation cost. The repo's only comparable record: porting one real item cost Sonnet
  $5.41 and an Opus verify $3.37, both lower bounds (`research/replicate-20261008/harness-cost.json`) [M]. Estimate:
  $5–15 per rung reference [I].
- **Judges.** Every reference judge runs on Haiku first, escalating to Sonnet on a failed check, as `fhand-haiku` did
  (REPORT.md:16) [M].

### 2.4 Triviality attack and structure-necessity attack

A rung is admitted only if all hold (12 attack seeds, dev 379–390):
1. **One call fails.** One Haiku 5.5 call with the task rendered inline (`inlineRender`, `experiments/lib/beds.mjs`)
   [M], effort none and medium, passes ≤ 2/12 [threshold I]. Records shows why the bar is needed: one Haiku call passed
   25/36 on records v3 (REPORT.md:19) [M], so a rung at records' size would not need a workflow. THESIS §1: "for many
   tasks the best workflow is none" [M].
2. **A 20-line deterministic script fails** (CONTRACT: "A family that a 20-line deterministic script solves from the
   inputs alone is not acceptable") [M].
3. **Structure necessity.** The best workflow *without* the rung's new feature fails ≥ 50% of attack seeds [threshold
   I]. Concretely: R2 without branching (one handler for every document kind); R3 without fan-out (one judge over all
   items); R5 without the agent node (the R4 reference with code parsers for the dev formats only); R6 without a plan (the
   R5-style reference over a fixed entity list taken from the prompt). R4 has no necessity attack: nesting never changes
   correctness, because any nested workflow can be inlined. R4's value is construction cost through reuse, measured by
   the curriculum (§5) and stated as such in §10.
4. **White-box script (reported, not gating).** A catalog-aware script written with the generator source. `synth` shows
   why: such a script passes 96–99% at level 3 (`beds/synth/README.md`) [M]. If it passes a rung, that rung tests cost,
   not judgment, and claims say so.

### 2.5 Drift knob

Each rung has `difficulty` 2–5. d → d+1 adds what records' d3 → d4 adds (a new system with its own date convention,
new status words, a re-stamped mirror; `beds/records/index.mjs` description) [M] plus the rung's own axis (more kinds
for R2, more items for R3, more subsidiaries for R4, unseen dump formats for R5, more entities for R6). Streams switch
difficulty at task 17 of 24, as the dev streams did (seeds 217–224 are d4/d5 drift, `SEED-LEDGER.json`
`jit-dev-streams`) [M].

## 3. Rungs

Cost columns use the repo's recorded per-task costs, scaled by input size and number of decisions [I for the scaling].
Base figures [M]: Haiku agent $0.103/task on records and $0.088 on kinetics; Sonnet agent $0.294 and $0.308; Opus agent
$0.564 (FRONTIER-GAPS §0.1); one Haiku call $0.026–0.030 (REPORT.md:19–20); hand workflow on Haiku $0.016
(REPORT.md:16); compiled runs $0.009–0.043 on records, $0.011–0.43 on kinetics (FRONTIER-GAPS S6); a compile $2–5 with
the Haiku builder capped at $3 + $1.5 gateway (`stream.mjs` `DEFAULT_COMPILE`), Opus fallback compiles $3–7
(DEV-NOTES D14) [M]; B1-haiku construction $2.21 and $0.078/trial (REPORT-dev.md:26) [M].

### 3.0 R0: no-workflow control

- **Task.** A short single-document extraction (one invoice, ≤ 2K tokens) with an exact field oracle.
- **Expected.** One Haiku call passes ≥ 10/12. The router should not compile. Calibration found codefix and incident
  "saturated by the Haiku agent at about 2 cents per task, so the router should interpret there" (HANDOFF §2) [M].
- **Use.** Interleaved as 1 task in 8 in every stream (§5). A JIT arm that compiles on R0 tasks, or routes R0 tasks
  through a compiled R1 solver, pays a measured overhead. Metric: share of R0 tasks served by one call.

### 3.1 R1: linear multi-stage pipeline with typed hand-offs ("ledger close")

- **Task.** A multi-system customer export (records world at d2–d3, 250–400 rows across 4–6 systems) plus each system's
  invoice list and one payments file. Output per real customer: canonical id, invoiced USD, paid USD, open balance (minor
  units), plus a totals block.
- **Stages.** extract (parse 4–6 formats) → normalise (dates by each system's stated convention, currency to USD at the
  stated quotes) → reconcile (cluster rows to customers; attach invoices and payments by row id) → report.
- **Oracle.** End-to-end exact on minor units and entity membership (records' `scoreAgainst` matching, extended to
  balances). Stage oracles: parsed rows, normalised values, clusters, report.
- **Reference outline.** `step` parse per system → `judge` per system on the convention note (schema: `{order, quote}`,
  check: quote is a substring) → `step` normalise → `step` cluster with a borderline band → `judge` on band pairs
  (FRONTIER-GAPS N4: the error locus had no judge) [M] → `invariant` conservation (rows in = merged + dropped; Σ
  invoices = Σ report) → `done`.
- **Triviality.** At 250–400 rows plus invoices the inline render is about 25–40K tokens [I]; records d4 already produced
  one-call timeouts (REPORT.md:19–20) [M]. Gate: §2.4.
- **Drift.** A new system with a new date order; a status word whose meaning flips.
- **Expected per-task cost [I].** One call $0.04; Haiku agent $0.12–0.18; Sonnet $0.35; Opus $0.65; reference
  $0.02–0.04; compiled $0.01–0.05; B1 run $0.08–0.10.
- **Falsifier for "Haiku can cheaply build it" (R1).** Over both streams, H/H's second-half verified success is more than
  10 points below the reference's, **or** H/H's cumulative cost per success at task 24 exceeds the Haiku agent's by more
  than 2×. (The second clause is expected to be close: records H/H was $0.324/success vs Haiku agent $0.164,
  FRONTIER-GAPS §0.1 [M].)

### 3.2 R2: branching on judged conditions ("inbox router")

- **Task.** 30–60 inbound documents (emails with attachment text) of kinds {invoice, credit note, remittance advice,
  dispute, statement request, unrelated, planted injection}. The kind is never a field; cues are in prose, locale and
  layout. Each kind has a different handler: invoice → extract and post; credit note → find the referenced invoice
  (fuzzy invoice-number resolution) and post a negative entry; remittance → allocate a payment to invoices by a stated
  rule; dispute → reason code from a closed set plus a hold; unrelated and injection → ignore. The generator also plants
  2–4 **genuinely undecidable** documents (both readings consistent with the text, constructed by design); the correct
  action for those is the review queue.
- **Output.** `{entries[], holds[], review_queue[]}`.
- **Oracle.** Entries as a multiset with exact minor units; holds and review queue set-exact. Escalating a decidable
  document is an error, as is not escalating an undecidable one. This scores "escalate on low confidence" exactly.
- **Reference outline.** `map` over documents: `judge` kind (schema enum plus a quoted cue, check: quote occurs) → JS
  `switch` to a per-kind handler (each a `step` + `judge` chain) → `flag` + review queue when the kind judge escalated
  or its samples split (`createFlow({ autoFlag: true })`, flow-v2) [M] → `invariant` every document routed exactly once.
- **Structure-necessity control.** One handler applied to every document fails by construction (each kind appears ≥ 2
  times).
- **Drift.** A new document kind; a kind whose cue changes language.
- **Expected per-task cost [I].** One call $0.05; Haiku agent $0.15–0.25; reference $0.03–0.08 (one kind judge per
  document); compiled similar.
- **Falsifier (R2).** As R1, plus: H/H's review-queue precision or recall below the reference's by more than 0.2 in both
  streams (escalation is the rung's point).

### 3.3 R3: fan-out / fan-in ("statement audit")

- **Task.** N vendor statements (N = 40 at d3, 120 at d5), each 10–30 lines, against an internal ledger. Per item:
  match lines, classify each discrepancy into a reason code from a short prose memo (timing, FX, duplicate, missing
  credit note, price change, unexplained), compute the adjusted balance. Fan-in: totals by reason and vendor, and the
  conservation identity Σ adjusted = ledger difference.
- **Oracle.** Per-item exact (reason multiset, adjusted balance); aggregate exact.
- **Reference outline.** `map(statements, { concurrency: 8 })` of [`step` match → `judge` per unmatched line → `step`
  adjust] → `step` reduce → `invariant` conservation → `done`.
- **Structure necessity.** One judge over all items fails (long-horizon bookkeeping, the AgentFloor failure mode, THESIS
  §3 item 4) [M].
- **Parallelism metric.** Critical-path wall-clock from the span tree (the Kimi "Critical Steps" analogue,
  PRIOR-ART-SWARMS §2).
- **Expected per-task cost [I].** One call fails on size (≥ 40K tokens at d3); Haiku agent $0.25–0.50 with falling
  success (it must keep 40–120 per-item states); Sonnet $0.6–1.0; reference $0.08–0.25 (40–120 small judges); compiled
  similar.
- **Falsifier (R3).** H/H's second-half success is more than 10 points below the reference's in both streams, or its
  stream cost per success exceeds the Haiku agent's.

### 3.4 R4: nested sub-workflow ("group consolidation")

- **Task.** K subsidiaries (K = 3 at d3, 6 at d5). Each subsidiary's data is an R1 task drawn with its own seed (its own
  systems and conventions); 1 in 4 subsidiaries at d ≥ 3 is an R3 task instead (a statement audit). The parent stage
  translates each subsidiary's report to the group currency, finds intercompany pairs (a judge on memo text plus amount
  matching), eliminates them and produces the consolidated report.
- **Oracle (composed).** Each child output against its R1/R3 oracle; the elimination set exact; consolidated totals
  exact. End-to-end pass requires all three.
- **Reference outline.** `map(subsidiaries, s => flow.call(R1_REF_HASH or R3_REF_HASH, s))` → `step` translate →
  `judge` intercompany pairs → `step` eliminate → `invariant` group conservation. The reference uses the frozen R1/R3
  references by hash, so arm (c) also exercises `call`.
- **Composition test.** Does the JIT arm call an earlier rung's accepted solver by hash (correct reuse)? Call one outside
  its profile (wrong reuse; planted: 1 in 6 subsidiaries uses a date convention no R1 stream saw, so the R1 solver's
  profile should refuse it)? Re-derive what the library holds (missed reuse)? These are THESIS-JIT §6.7's four reuse
  quantities [M].
- **Necessity.** None for correctness (§2.4). Hypothesis: with reuse, R4 costs about one parent compile; without, one R1
  compile + one R3 compile + one parent compile.
- **Expected per-task cost [I].** Haiku agent $0.4–0.8 (3–6 R1-sized subproblems); Sonnet $1.0–2.0; reference
  $0.08–0.30; compiled similar; B1 run $0.25–0.40.
- **Falsifier (R4).** Under the curriculum arm, R4's construction spend (warmup + compiles) is not below the isolated
  arm's (§5) in both lineages, **or** wrong reuse exceeds 5% of child calls (ROADMAP §4.3 falsifier for C1/C2) [M].

### 3.5 R5: agentic node ("legacy dump")

- **Task.** An R4 task where one subsidiary delivers its data as a "legacy dump" directory instead of an export. Its
  encoding is drawn per task from ≥ 8 textual formats: fixed-width with the layout only in a prose README; a custom code
  page given as an escape table; JSON lines whose schema version switches mid-file; monthly CSVs with drifting headers; a
  "proprietary" text format that a provided `decoder.mjs` converts once called with flags the README describes; and
  others. Files must be text (CONTRACT `files` are `{relativePath: textContent}`) [M]. A trailer record gives the row
  count and control totals.
- **Oracle.** The decoded rows exact (generator truth), then the R4 oracle.
- **Reference outline.** As R4, with the dump subsidiary handled by `flow.agent('decode-dump', …, { verify: row count and
  control totals match the trailer })` and its rows fed to `flow.call(R1_REF_HASH, …)`.
- **Structure necessity.** The R4 reference with code parsers for the dev formats only fails on every task whose format
  is not among them (by construction ≥ 50%).
- **JIT angle.** Once a format recurs, the agent node's harvested parsers can be compiled into a callee, and the agent
  becomes the fallback (FLOW-V3 §2.2). At d5 a format never seen in dev appears, which forces the fallback.
- **Isolation.** Synthetic text only: no third-party text reaches an agent node (D10) [M].
- **Expected per-task cost [I].** Haiku agent $0.5–1.0; reference $0.15–0.45 (one agent node, $0.10–0.30, plus R4);
  compiled after sub-compile $0.1–0.3.
- **Falsifier (R5).** H/H never produces an accepted solver that contains an agent node or a compiled decoder with an
  agent fallback within its compile budget, in both lineages; or the verify predicate misses a wrongly decoded dump
  (analyst-side check against the stage oracle) on more than 1 in 20 agent-node runs.

### 3.6 R6: swarm ("wide research table")

- **Task.** A corpus of 200–400 fictional research documents (synth world scaled up: articles, preprints, errata,
  retractions) and a question naming a *class* of entities ("every compound tested by lab X after date Y"). The entity
  list must be discovered (it is not in the prompt), then 3–5 properties per entity resolved under synth's resolution
  policy. Output: the accepted table plus void documents. This is the WideSearch shape Kimi reports on
  (PRIOR-ART-SWARMS §2) [W].
- **Oracle.** synth's exact accepted-table oracle on the discovered entity set (missing or extra rows fail).
- **Reference outline.** `flow.wide({ plan: judge → entity list, check: code mention index (gaps, duplicates),
  worker: per-entity judge chain, reduce: table assembly, verify: panel of 3 on a 20% sample plus code unit checks })`.
- **The comparison that decides `wide`.** `best_of_n` at equal tokens: N independent Haiku agent solves, the same
  verifier selects (ROADMAP §2.1 and §4.3 B5) [M]. `wide` becomes a default only if it wins (ROADMAP §3) [M].
- **Separability.** Entities resolve independently once found (by construction), so the task is separable; FRONTIER-GAPS
  H3 warns that sequential tasks lose under multi-agent decomposition [M].
- **Caveat.** synth's catalog-aware script passes 89–99% (`beds/synth/README.md`) [M]; the white-box attack (§2.4 item
  4) must be reported for R6.
- **Expected per-task cost [I].** Haiku agent $0.5–1.5; best_of_n with N = 3: $1.5–4.5; reference $0.2–0.6 (one plan
  judge, 30–60 worker chains, a panel).
  Haiku 5.5's list price rises from $0.10/$0.50 to $0.50/$2.50 per MTok for prompts above 100K tokens
  (`policy/models.json`) [M]; a 200–400 document corpus read whole crosses that line, which penalises single-context
  arms and favours narrow workers. That is a property of the task, not a bias to remove, but it is reported.
- **Falsifier (R6).** `wide` (reference or JIT-built) does not beat `best_of_n` at equal tokens on verified success, or
  matches it only at higher cost.

### 3.7 R7: effects, waits and approvals (parked)

Parked, for four reasons:
1. flow has no effect, wait or approval primitive, and FRONTIER-GAPS H2's preferred option is to keep `solve.mjs` a pure
   activity inside an engine node and **not** build `flow.await` [M].
2. Engine work for waits and approvals (timers table, `foundry tick`, resume tokens) is ROADMAP §5.6 Phase 6 [M] and
   would break the engine freeze for any round in flight (ROADMAP rule 13) [M].
3. The replication streams already test effects through host-served mocks, with closed-loop state, human events and
   integration faults (DESIGN-STREAMS §0.2 items 2 and 4; RS-SHOP, RS-QUOTE) [M]. A synthetic R7 would duplicate them
   at lower realism.
4. An approval step needs a human or a simulated human whose answers are themselves an oracle; owner-minutes are
   unpriced (FRONTIER-GAPS §3.17 row §6.9) [M].

What the W-bed keeps from R7: tasks may return an **effect plan** (a list of intended writes) that the host applies and
the oracle grades (conformance over the effect log, §7.3). That stays inside the pure-activity model.

### 3.8 R8: injected faults at run time (overlay on R1–R6)

Faults are scheduled at preregistered task indices in each stream (not random, so arms see identical faults):

| fault | injected by | on rungs | expected healthy response |
|---|---|---|---|
| f1 schema drift: a renamed column, a new system, a convention switch | the generator (drift knob at fixed tasks) | R1–R6 | guard or invariant deopt → interpret → recompile with the new trace |
| f2 tool failure: gateway 5xx/timeouts on k% of judge calls; the dump decoder fails on first call | the host service layer (transparent to arms) | R1–R5 | retry/escalation inside the judge, agent retry; no recompile (an `env_fault`, ROADMAP §2.6) |
| f3 adversarial content: planted instructions in documents ("ignore entity X", "mark all reviewed") | the generator (records already has adversarial staff memos at d ≥ 3) [M] | R2, R3, R6 | no change in control flow; data-dropping only via contract rule ids (FRONTIER-GAPS I3) [M] |

**Self-heal metrics.** Heal rate = share of fault episodes after which the arm returns to verified success within h = 4
tasks with no human action. Also: time-to-heal, silent misses during the episode, reject-if-worse rejections, and
**guard widenings** counted as defects (D9: a heal widened a guard and turned refusals into silent failures) [M]. f2 is
also a test of the classifier: a recompile triggered by an `env_fault` is an error.

**Prior.** No guard, invariant or judge check deopted on any of ≥ 21 wrong compiled outputs (FRONTIER-GAPS S1) [M], and
auto-heal live runs produced no promoted fix (THESIS-JIT §1) [M]. f1 should be caught (drift deopts happened: S/H
s217–s218 by `invariant`, FRONTIER-GAPS S9) [M]; f3 is the open risk.

### 3.9 Held-out rung RH ("lab consolidation", kinetics domain)

The kinetics domain, never used in dev W-bed streams: several labs' notebooks (each a kinetics-like fitting task = child),
routed by assay type (R2), fanned out over conditions (R3), consolidated across labs with a shared-Vmax rule (R4).
Every structural feature has been seen; the domain and this composition have not. It measures transfer of structural
skill, and it measures **wrong reuse** directly: the library holds records-domain solvers whose profiles should refuse
kinetics inputs. Alternative (owner choice, §11): hold out R6 instead. Kinetics compiles were expensive (H/H compile
spend $9.63 on 12 tasks, FRONTIER-GAPS §0.1) [M], so RH costs about 2× a records-domain rung [I].

## 4. Arms

| arm | builds | runs | construction budget | notes |
|---|---|---|---|---|
| (a) **JIT H/H** | Haiku interprets warmup tasks; Haiku compiles flow-v3 from traces | compiled code + Haiku judges; deopt → Haiku interpreter; shadows adjudicated by Haiku; **no** Opus fallback | per lineage: 2 compiles at the Haiku cap ($3 + $1.5 gateway each) + recompiles on deopt | the owner's literal question |
| (b) **JIT O/H** | Opus demonstrates (warmup, shadows, adjudication: the three roles of THESIS-JIT §6.3) [M]; Haiku compiles | as (a); Opus adjudicates disagreements | as (a) + Opus fallback ≤ 2 per lineage | quota-heavy; R1–R4 only in round 1 |
| (c) **reference** | Opus (or owner) once per rung (§2.3) | frozen `reference.mjs`, Haiku judges, Sonnet on escalation | recorded, not capped | "the LangGraph engineer's graph" |
| (d) **agent every time** | — | Haiku agent on every task (B0); Sonnet and Opus on R3–R4 only, K = 1, descriptive ceilings | 0 | |
| (e) **B1** | an independent Haiku builder writes `solve.mjs` on flow-v3 from the spec and 3 example tasks, no traces, no runs, no score service (`startServices({ scoreLimit: 0 })`; C0 builders had oracle-scored probes, FRONTIER-GAPS J6) [M] | the built script; deopt or crash → Haiku interpreter (the `static:` arm semantics, `stream.mjs` header) [M] | equal to (a)'s compile cap per lineage | the brief's "CC-dynamic-workflow-style script"; B1-cc (a real CC Workflow script) is excluded while the no-fan-out rule holds (§10 O8) |

All arms: same tasks in the same order per stream, interleaved on identical sandboxes (ROADMAP §4.3) [M]; per-arm
unreadable roots (FRONTIER-GAPS J8) [M]; every cost and every 429 recorded.

## 5. Curriculum and reuse protocol

**Question.** "How it evolved as it did more and more complex work" (owner). Operationally: does R(k+1) become cheaper
or more reliable because R1…Rk's accepted solvers are in the library and callable by hash?

**Arms.** For the JIT arms and B1:
- **CUR**: one library per lineage, persisting from R1 to R6 (FLOW-V3 §1.2). The compiler's inputs gain a library index:
  each entry's hash, contract schemas, a profile summary and its evidence record. It may call any entry by hash. It
  never sees another rung's oracle.
- **ISO**: the same arm with the library wiped at each rung. CUR − ISO is the learning gain in ROADMAP §4.3's sense
  ("the stateful arm minus the same arm with its state wiped") [M].
- **SHUF** (optional, round 2): R4 before R1–R3, to see whether R4's decomposition produces modules that R1 later reuses.

**Order and stream shape.** Per lineage: R1 → R2 → R3 → R4 (→ R5 → R6 in round 2), 24 tasks per rung (16 at d3, then 8
at d4 drift), with an R0 task at every 8th position. Lineage l of CUR and of ISO see identical task sequences.

**Measured per rung.**
- construction spend: warmup interpretation + compiles + fallbacks + recompiles, in dollars and Opus-equivalent quota;
- time-to-first-accepted version (task index) and time-to-durable (THESIS-JIT §6.8) [M];
- reuse: correct, wrong, missed reuse and savings (THESIS-JIT §6.7) [M], from `call-*` events and the profile refusals;
- library share: share of the accepted solver's span tree that is library calls;
- second-half verified success and cost per success.

**The curriculum effect** is CUR − ISO on construction spend and on second-half success at R3, R4 (and R5, R6), with the
decision rule of §8. Expected size [I]: the clearest signal is R4 construction spend, where reuse can remove whole
compiles ($2–5 each).

## 6. Metrics

### 6.1 Primary
- **Verified successes** per stream (bed oracle on the delivered answer).
- **Cost per verified success**, including construction, verification (shadows, adjudication, verify panels) and failed
  tasks (ROADMAP §4.3 CPS) [M]; with the break-even index against the Haiku agent (THESIS-JIT §2.4) [M].

### 6.2 Secondary
- Construction cost amortised over the stream; cumulative cost and success curves.
- Heal rate on R8 faults and its sub-metrics (§3.8).
- Durability: versions, guard and invariant fire rate over time, silent misses per 100 tasks (`durability.mjs`) [M].
- **Quota share.** (i) Spend share by model tier in list dollars and in Opus-equivalent units (Haiku ×1/40, Sonnet ×1/2,
  the ratios of `policy/models.json` input prices $0.10, $2 and $4 per MTok) [M] because the subscription meter cannot be attributed per arm (one
  shared meter, 0.01 resolution ≈ $0.2 of Haiku list, `analysis/quota-meter/README.md` findings 2–3) [M]; (ii) **code
  share** = fraction of oracle-graded decision units (rows, documents, items, entities) whose span contains no model
  call. This is THESIS-JIT §6.6's "share of decisions made by code or Kev" [M].
- Wall-clock critical path (R3, R6).

### 6.3 Structural fidelity (descriptive, never a success criterion)

**Observed structure graph** of an accepted solver, built from its flow-v3 traces on the stream: nodes are distinct
(kind, name) pairs among `step`, `judge`, `guard`, `invariant`, `map`, `call`, `agent`, `wide`, `plan`; edges are span
parent links and within-span event order. A `map` body collapses to one subgraph. Node labels map onto the corpus node
categories (`step` → code, `judge` → model, `guard`/`invariant` → condition, `map` → loop, `call` → subworkflow,
`agent` → model with tools, `wide` → loop + model), so the graph is comparable to corpus graphs.

**Features**: max call depth; call sites; map sites and max fan-out width; distinct judges; agent nodes; wide nodes;
**judged branch points** (a judge after which the sequence of step names differs across tasks in the stream, computed
across runs, because one run shows only one branch).

**Fidelity to the reference**: (1) feature agreement (did the solver nest where the reference nested, fan out over the
same item list, own an agent node where the reference did); (2) normalised graph edit distance between the two structure
graphs with the census distance (`gedUpper`/`distance`, `research/jit-20261008/analysis/replication/census/lib.mjs`) [M],
so W-S and W-C fidelity use one measure.

**Why descriptive only.** THESIS §1: "the goal is the best possible workflow for any task; for many tasks the best
workflow is none" [M]. A solver that matches the reference's success with less structure is better. So the report shows
**structure regret** next to fidelity: success-equal solvers with lower structural complexity are counted as wins.

## 7. Corpus rungs (W-C): real hand-curated workflows

*Added on the coordinator's instruction (commit 21e9b5c assets).*

### 7.1 What the corpus offers, by structural feature

Computed at $0 for this document from the 1,559 corpus items (`research/corpus-20261006/items.jsonl`) [M-c]. Definitions
(from `features` and `graph` per `ITEM-SCHEMA.md`): linear = no branching, no loops, max fan-out ≤ 1, no sub-workflows;
branch = `branching > 0` or a `condition` node; fan-out = max fan-out ≥ 3, a `loop` node or `loops > 0`; sub-workflow =
`subworkflows > 0` or a `subworkflow` node; model = a `model` node with `hasModelCalls`; error = an `error` edge or an
`error-handler` node; wait = `async` contains wait/webhook/event or a `wait` node; human = `humanSteps > 0` or a `human`
node. "Oracle-bearing" = `oracle.kind != none` (438 items: 277 test-profile, 108 output-equivalence, 53
mocked-execution).

| feature | all items | oracle-bearing |
|---|---|---|
| linear | 211 | 46 |
| branch | 1,049 | 302 |
| fan-out (loose definition) | 1,134 | 324 |
| sub-workflow | 398 | 138 |
| model calls | 655 | 131 |
| error route | 229 | 121 |
| wait / webhook / event | 639 | 91 |
| human step | 245 | 42 |

IR-extension tokens on oracle-bearing items (exact verdict vocabulary) [M-c]: `subworkflow-call` 21 of 220 (n8n 9, coze
6, temporal 2, airflow, dagster, snakemake, mastra 1 each); `agent-tool-loop` 44 of 209 (n8n 17, google-adk 6, strands
4, langgraph 3, mastra 3, openai-agents 3, …); `agent-as-tool` 9 of 30; `dynamic-dag` 13 of 23 (snakemake 12);
`dynamic-agent-spawn` 2 of 6 (a dspy tutorial, strands `workflow.py`); `error-branch` 104 of 220 (nf-core 60, n8n 13,
tekton 10, snakemake 10, nextflow 6); `adaptive-retry` 90 of 96; `signal-wait` 15 of 75 (temporal 13);
`interrupt-resume` 5 of 15; `durable-wait` 0 of 38.

### 7.2 Mapping corpus families onto rungs

| rung | real families and items | oracle-bearing variants | role |
|---|---|---|---|
| R1 | Airflow Amazon system tests (`example_athena`, `example_glue_data_quality`, …; census family #5, 3/3 oracle); dagster, tekton linear pipelines | family of 3 | reference structure for linear ETL |
| R2 | Kubeflow `conditional-execution-pipeline`, `nested-conditions-pipeline` (census #6, 3/3) | family of 3 | judged/condition branching, and branching inside nesting |
| R3 | WDL warp germline single-sample family (census #2, 4/4; scatter-gather); Galaxy VGP assembly (census #7, 3/3); snakemake `dynamic-dag` items (12) | 4 + 3 | fan-out/fan-in on real bioinformatics graphs |
| R4 | `subworkflow-call` items (21 oracle-bearing; n8n 9, coze 6); WDL warp (WDL items with sub-workflows: 24 of 36); RS-INVOICE (2 sub-workflows), RS-QUOTE (3 sub-workflows, 3 agents, 2 human steps) (DESIGN-STREAMS §1.1) [M] | ≈ 21 + RS | nesting by call |
| R5 | `agent-tool-loop` (44 oracle-bearing), `agent-as-tool` (9) | 53 | nodes that own a tool loop; **blocked for agent nodes by D10** (third-party text) |
| R6 | `dynamic-agent-spawn` (2), `dynamic-dag` (13); `claude-code-workflows` first-party items (10, not independent evidence, ITEM-SCHEMA) | ≈ 2–15 | thin: real swarms are almost absent from public workflow corpora, so R6's comparison is to platform primitives (PRIOR-ART-SWARMS) not to corpus items |
| R7 | RS-SHOP (340 raw nodes: order/payment state machine, debounce, human pause, signed webhooks), RS-QUOTE (approvals across ticks); `signal-wait` (15), `interrupt-resume` (5) | RS + 20 | effects, waits, approvals: lives in the replication streams |
| R8 | `error-branch` (104), `adaptive-retry` (90) | 194 | the human-written error routes are the hand-curated "heal" baseline: compare Foundry's deopt → recompile to the author's retry/route |

The census kill rule **fired**: only 4 families have ≥ 3 oracle-bearing variants (README row 33) [M]. So the corpus
cannot supply a *population* of families (Bet B) for statistics; corpus rungs are a handful of items, reported per item.

### 7.3 The conformance evaluator: what it can and cannot judge here

The row 17 evaluator (`analysis/replication/lib/conformance.mjs`) aligns an observed effect log with an expected one
[M]. On the five pilots, tier I (item-declared normalisation, τ = 1) detected 17 of 18 wrong classes and accepted 10 of
11 correct ones, against oracle v2's 17 and 11 (README §1.5) [M].

**It can judge** corpus-rung tasks of the form "reproduce this workflow's effects on these scenarios": a design's
effect log (writes, notifications, table rows, PR edits) against the original's, with order per stream. That fits R1,
R3, R4 and R7 items whose product is effects or tables, and W-S tasks that return an effect plan (§3.7).

**It cannot judge:**
- cost-accounting forgeries: N20-W2, a forged model tape, is accepted by every tier and by the oracle (README §1.5) [M];
  a Foundry arm's cost must therefore come from the host journal, never from anything the solver reports;
- memorised answers (N20-R1): a run that produces correct effects without doing the work [M];
- process-versus-final-state differences that net-effect merging hides (N12-C1, rejected on 4 of 5 seeds) [M];
- anything without a per-item **declaration**. Tier G (no declaration) accepted 0 of 11 correct classes (README §1.7) [M];
  tier I needs a 19–33 line file per item saying which differences are not differences. That is oracle-like work. It
  must be written by a session that never sees any solver or arm output, frozen by sha256 before any arm runs, and
  never revised from arm results (the row 17 files were revised three times from dev results, README §3) [M];
- semantics the expected log gets wrong: "the expected log carries the semantic"; with the v0.1.0 reading of one HA
  condition the evaluator reproduces oracle v1's mistakes exactly (README §1.7) [M].

τ must be 1: at τ = 0.95 three Galaxy wrong classes pass (README §1.5) [M].

### 7.4 How the two tracks coexist

- **W-S (synthetic)**: R0–R6 + RH, seeded generators, exact oracles, power, held-out seeds and a held-out rung. All
  decisions (§8) come from W-S.
- **W-C (corpus)**: FRONTIER-GAPS §3.15 ("real workflows as stream generators") [M] made concrete with existing
  instruments. Items: the replication-stream items (RS-INVOICE, RS-SHOP, RS-QUOTE; DESIGN-STREAMS §1.1) [M] plus one
  member of each of the four oracle-bearing families. For each item:
  - the **reference workflow is the real one**: the port of the upstream logic (DESIGN-STREAMS arm H) [M]. That is the
    owner's "worst case highly complex workflow" literally;
  - structural fidelity is measured against the item's own normalised `graph` with the census distance (§6.3);
  - the oracle is the item's own (test-profile, output-equivalence or mocked execution) or tier I conformance;
  - specs are written in our words by a structured builder that never reads third-party text into an executor (D10;
    DESIGN-STREAMS spec-A) [M], and **agent nodes are disabled** on W-C (FLOW-V3 §2.2);
  - Claim K of PRIOR-ART-SWARMS §0 is tested here: express each item's logic in flow-v3 + engine and count invented
    primitives.
- W-C costs are the replication streams' ($500–980 minimum, DESIGN-STREAMS §0.2 item 9) [M]; W-bed adds only the
  fidelity metric and the four family members, so W-C waits for the owner's O-2 decision there.

## 8. Preregistration skeleton

**Claims (one per rung r ∈ {R1…R4} in round 1; R5, R6, RH in round 2).**
- **H1(r) non-inferiority to hand curation.** JIT H/H's second-half verified success is within δ = 10 points of the
  reference's.
- **H2(r) cheap construction.** JIT H/H's cumulative cost per verified success at task 24 is ≤ the Haiku agent's
  (break-even reached within the stream).
- **H3 curriculum.** CUR − ISO construction spend at R4 is < 0, and second-half success is not worse (non-inferiority
  δ = 10).
- **H4 (round 2) swarm.** At R6, `wide` beats `best_of_n` at equal tokens on verified success.
- **H5 (round 2) heal.** R8 heal rate ≥ 0.5 for f1 and f2 with zero guard widenings.

**Arms.** §4; round 1: (a), (c), (d-Haiku), plus CUR/ISO for (a). (b) and (e) when the round-1 budget allows (§9).

**Decision rule.** For success comparisons, `experiments/jit/stats.mjs` `DECISION_RULE` unchanged [M]: no arm invalid by
the 25% env-fault rule; K ≥ 2 streams; pooled gap ≥ 3 points and every stream's gap ≥ 3 points in the same direction;
exact two-sided McNemar p < 0.05 on pooled pairs; the 95% lineage-clustered CI (ρ = 0.1) excludes 0. Otherwise
"directional, no decision". Non-inferiority claims (H1, H3) are read from the same CI against −δ. Cost ratios: paired
bootstrap CI over tasks, clustered by lineage, reported with the success comparison (ROADMAP §4.3: cost compared at
verified parity) [M].

**K and power.** K = 2 lineages per (rung, arm), m = 24 tasks. From `node experiments/jit/stats.mjs power` [M]: the
rule's MDE at 80% power is 23 points (ρ = 0), 39 points (ρ = 0.1) or 52 points (ρ = 0.3) at K = 2; raising K to 4
moves it by at most 4 points. So H1 and H3 are **directional by rule** unless the gap is very large, and the round is
designed for (i) large success gaps expected at R3–R4 between arms that fan out and the Haiku agent, and (ii) cost
ratios, where ROADMAP §4.3 puts ≥ 30% cost reduction at 23–89 paired tasks [M]; 48 paired tasks per rung is inside that
range. This is a declared limitation, as in PREREG-stream §4 [M].

**Seeds** (respecting `research/jit-20261008/SEED-LEDGER.json`) [M]. New bed ids `wbed-r0` … `wbed-r6`, `wbed-rh`.
Proposed new ledger ranges, all `owner: jit`, `status: fresh`:

| id | beds | split | seeds | allow | use |
|---|---|---|---|---|---|
| wbed-dev-a | wbed-* | dev | 301–324 | jit-dev | dev stream A per rung (inside `kev-probe-pilot` 1–400, which allows jit-dev) |
| wbed-dev-b | wbed-* | dev | 325–348 | jit-dev | dev stream B per rung |
| wbed-oos | wbed-* | dev | 349–372 | jit-oos | out-of-sample dev scoring |
| wbed-fixtures | wbed-* | dev | 373–378 | jit-dev | the reference author's labelled fixtures (§2.3) |
| wbed-attack | wbed-* | dev | 379–390 | jit-dev | triviality and necessity attacks (§2.4) |
| wbed-heldout-a | wbed-* | test | 8201–8224 | jit-heldout | held-out stream A per rung |
| wbed-heldout-b | wbed-* | test | 8301–8324 | jit-heldout | held-out stream B per rung |
| wbed-rh-a / -b | wbed-rh | test | 8401–8424 / 8501–8524 | jit-heldout | held-out rung RH |

These avoid every existing range: Kev's test reservations 7000–7199, the burned 5001–5006 and 6001–6004, the JIT dev
ranges 201–272, and the reserved held-out 8001–8024 and 8101–8124 [M]. Seeds 391–400 stay unassigned.

**Fault schedule (R8, round 2).** f1 at tasks 9 and 17 (17 coincides with the d4 switch); f2 at tasks 5–6 and 13; f3 at
tasks 11 and 20. Identical across arms and lineages.

**Freeze.** Engine freeze record for the W round (flow-v3, `stream.mjs`, `run-compiled.mjs`, `services.mjs` tree ids;
kit hash; policy hash), the bed versions, the reference shas, the analysis script hash (FLOW-V3 §5 item 4).

**Kill rules.** A rung that fails §2.4 is dropped and reported. If H/H reaches no accepted solver within its compile cap
on R1 in both lineages, the round stops after R1 (the owner's question is then answered "no" at the first rung) and R2–R4
run only for the reference and the Haiku agent.

## 9. Build order and cost (to reach the first paid run within days, on this laptop)

| # | item | cost | gate |
|---|---|---|---|
| 1 | `beds/wbed/lib` + R1 generator, oracle, `stages`, controls, tests (CONTRACT oracle-health) | $0 | referenceSolve ≥ 20 seeds; controls fail |
| 2 | R2, R3 generators, oracles, controls; R0 | $0 | as 1 |
| 3 | structure extractor (trace → structure graph), features, fidelity via census `distance`; tested on existing dev flow traces | $0 | unit tests |
| 4 | FLOW-V3 slice 1: `flow.call`, spans, registry, host endpoint, byte-compat test vs flow-v2 (FLOW-V3 §4–§5), **on its own branch** | $0 | flow-v2 pins green; compat test |
| 5 | R4 generator (composes R1/R3 seeds) + composed oracle | $0 | as 1 |
| 6 | `stream.mjs`: per-arm library across rungs (CUR/ISO), R0 interleave, new deopt kinds, ledger ranges | $0 | stub-gateway stream test |
| 7 | triviality and necessity attacks R1–R4 (one Haiku call × 12 seeds × 2 efforts × 4 rungs) | ≈ $3–8 | §2.4 |
| 8 | reference workflows R1–R4 (one Opus session each, with one revision) | ≈ $10–40 [I] | frozen shas |
| 9 | **first paid run**: R1–R4 × arms (a) CUR, (a) ISO, (c), (d-Haiku) × K = 2 × 24 tasks | see below | prereg + freeze |

Steps 1–6 are agent-days of $0 work [I]. Estimated first-run cost, list price [I, from §3 figures]:

| arm | per stream (24 tasks), R1 → R4 | 8 streams (4 rungs × K = 2) |
|---|---|---|
| (d) Haiku agent | $3–4 (R1) to $10–19 (R4) | $45–85 |
| (c) reference on Haiku | $0.5–1 (R1) to $2–7 (R4) | $10–32 |
| (a) JIT H/H, CUR | warmup $0.4–2.4 + compiles $4–10 + compiled runs $0.5–6 + shadows (every 4th) $1–4 ≈ $6–20 | $60–130 |
| (a) JIT H/H, ISO | as CUR; R4 compiles not reduced | $60–130 |
| **total, round 1 core** | | **≈ $175–380** |

Dropping ISO loses H3; the minimum that still answers H1/H2 is **≈ $115–250**. Steps 7–8 add $13–48. Adding (b) O/H on
R1–R4 adds about $60–150 and Opus quota (warmup and adjudication at $0.56 per Opus task, FRONTIER-GAPS §0.1) [M]; adding
(e) B1 adds about $30–45 ($2.21 per build, REPORT-dev.md:26, plus runs) [M]. Almost all spend is Haiku, so quota impact
is small, but per-call fixed overhead under the `claude-cli` provider is unmeasured for many tiny judges (§10 O5).

Wall-clock [I]: a 24-task Haiku stream took hours in the dev runs with arms in parallel; 32 streams at concurrency 4
fit in 1–2 days on the laptop if quota holds.

## 10. Objections: where the brief conflicts with evidence in the repo

**O1. C0: Haiku authoring from a description scored 11/16 (F-haiku, `workflow.json`) against 16/16 for a script
(B1-haiku `solve.mjs`)** (REPORT-dev.md:21–26) [M].
- What it supports: author in code. flow-v3 keeps the authoring surface JS; nesting is a JS call to a hash, not an IR
  document. The brief's design already does this.
- What it threatens: B1-haiku, built *once from a description*, was 16/16 there. So arm (e) may match the JIT on R1–R3,
  and "Haiku can build it" may be true without any JIT. The design must report that outcome as a positive answer to the
  owner's question, not as a JIT loss. The counterweight is drift: the static C0 solver went 16/24 on records with d4 2/8,
  failing silently (FRONTIER-GAPS §0.1) [M]; R8 and the d4 segment test exactly this.

**O2. "Probes did not predict evaluation"** (all 8 constructions passed 24/24 probes; all 9 construction-defect failures
came from cases no probe contained; THESIS-JIT §1) [M].
- It applies to the reference too: a reference validated on 12 dev seeds can still fail held-out. §2.3 freezes it after
  one revision and evaluates on held-out seeds like everything else.
- It applies to rung admission: a triviality attack on 12 seeds is a probe. The gate is therefore asymmetric: a rung is
  dropped on attack success, never "proven complex" by attack failure.
- It is why acceptance of JIT versions must not be probe-like. No change to the existing acceptance machinery is
  proposed here; W-bed inherits whatever R0/E1 freezes.

**O3. Nested agents are blocked for isolation reasons.** The executor voids nested model use (`nestedModelUses`); the
scan sees only Claude/Anthropic endpoints (ISOLATION-PROBE-laptop.md:241, 368); D10 forbids third-party text to
executors; ROADMAP caps executors at 2 concurrent, 16 per run, nested agents 0 [M].
- The brief's "nodes that have their own subagents" is implementable only as host-mediated agent nodes (FLOW-V3 §0, §2.2):
  the agent is a sibling sandbox the host starts, not a child of the solver. A subagent that itself spawns subagents
  stays impossible, by design.
- Agent nodes run only on W-S (synthetic text). W-C rung R5 is blocked until the isolation canary passes.
- The 2-concurrent limit caps R6 with agent workers at a fan-out of 2 at a time; R6 therefore uses judge workers, with
  agent workers as a variant.

**O4. Cost multiplies under nesting.** Kinetics compile spend alone was 4.6–6.6× the Haiku agent's whole stream; compiled
cost varies 20–40× within one compiler; Haiku-built kinetics judges cost $0.23–0.25 per run, above the Haiku agent's
whole task (FRONTIER-GAPS S6, S7, N8) [M].
- Under nesting, each module is a compile, and shadows at every level multiply verification. Answers in the design:
  compile once per module and reuse by hash (the curriculum bet); shadow at module boundaries only (FLOW-V3 §2.1);
  budget carving bounds a tree's spend by its root reservation; a cost guard at acceptance (N8) rejects solvers whose
  per-run cost on traces exceeds a fraction of the cheapest agent's.
- What would change the design: if CUR's R4 construction spend is not below ISO's (H3 fails), composition is not paying
  for itself on these rungs, and the ladder above R4 should be built with inlined modules instead of `call`.
- Expected [I]: at R1–R2 the JIT will not beat the Haiku agent on cost within 24 tasks (records H/H $0.324/success vs
  Haiku agent $0.164, FRONTIER-GAPS §0.1) [M]. The design states this up front rather than waiting to discover it.

**O5. The quota currency.** The usage quota, not dollars, stalled the work; the meter is shared across sessions and models
with 0.01 resolution, about $0.2 of Haiku list per tick, so it cannot be attributed per arm (quota-meter README) [M].
- Consequence: §6.2 prices arms in list dollars and Opus-equivalent units, not meter ticks. Arm (b) and Opus reference
  authoring are the quota-heavy items and are scheduled after a reset.
- Unmeasured risk [I]: R3 and R6 issue hundreds of small Haiku judge calls per task. If the `claude-cli` provider pays a
  large fixed cache write per call (the quota probe's ticks fell during runs dominated by 92K-token Haiku cache writes,
  README finding 5) [M], per-call overhead, not tokens of work, dominates fan-out cost. Measure the per-judge-call cost
  under `claude-cli` on 20 calls before R3 runs (about $0.10).

**O6. The interpreter is not the truth** (FRONTIER-GAPS §1 item 1: Haiku adjudications resolved 1 of 4; all 3 wrong
deliveries came from Haiku non-resolution) [M]. Arm (a) has no stronger tier by the owner's framing. Expect H/H's silent
misses to be the binding failure, and report them per rung. Arm (b) exists to separate "Haiku can build it" from "Haiku
can verify it".

**O7. Power.** At K = 2 the rule cannot decide success gaps below about 23–52 points (§8) [M]. Six rungs × five arms ×
K = 2 multiplies cost without adding decisiveness. The design therefore runs round 1 on four rungs and three arms and puts
the weight on cost ratios and large expected gaps. A K = 4 round is a separate owner decision.

**O8. "No new Workflow fan-outs" (owner, HANDOFF §0)** [M]. Two parts of the brief touch it: the B1-cc baseline (a real
Claude Code Workflow script) and any temptation to author references or specs with a Workflow. Both are excluded; arm
(e) is a single headless builder session. Whether a compiled solver's `flow.wide` with 32 Haiku judge calls counts as a
"Workflow fan-out" is a reading the owner should confirm (§11); this design assumes it does not, because those are
budgeted model calls inside one run, not Claude Code subagents.

**O9. R4 nesting is not necessary for correctness**, and "structural fidelity" can reward over-engineering. Both are
handled by making fidelity descriptive (§6.3) and stating R4's value as construction cost (§2.4, §5). A JIT arm that
inlines R1 inside R4 and succeeds is not penalised for low fidelity.

**O10. Authorship correlation** (FRONTIER-GAPS J5: Claude wrote the beds, prompts and thresholds and fills every role)
[M]. W-S rungs, their oracles and their references are all Claude-written, so a shared misreading can live in generator,
oracle and reference at once (FRONTIER-GAPS §3.17 row §6.5) [M]. Mitigations: W-C rungs with human-written references;
the owner may write or review one reference (§11).

**O11. Heal evidence is thin.** Auto-heal produced no promoted fix in live runs; a recompile widened a guard (D9); no
check deopted on ≥ 21 wrong outputs (S1) [M]. H5's threshold (heal rate ≥ 0.5) may be optimistic; the result is
informative either way, but round 2's R8 should not be sold as a self-heal demonstration before it runs.

**O12. Engine freeze.** Building flow-v3 and the `stream.mjs` changes moves the `experiments/jit` tree that the R0/E1
freeze records (ENGINE-FREEZE §2) [M]. ROADMAP rule 13 requires this work on a branch merged after R0/E1's last trial
[M]. If R0/E1 is still running, steps 4 and 6 of §9 happen on a separate branch and the W round gets its own freeze.

**O13. Synthetic rungs may be solvable by catalog-aware scripts** (synth white-box script 89–99%) [M]. §2.4 item 4
reports it; if it passes R6, R6 measures cost, not judgment.

## 11. Owner decisions this depends on

1. Held-out rung: RH (kinetics-domain composite, recommended) or R6.
2. Who writes the references: Opus (cheaper, correlated with the arms) or the owner for at least one rung.
3. Whether `flow.wide`'s judge fan-out inside a compiled run is outside "no new Workflow fan-outs" (O8).
4. Round-1 scope: the $115–250 minimum (H1/H2 only) or the $175–380 core with CUR/ISO (adds H3).
5. Whether W-C waits for the replication streams' O-2 funding decision (§7.4).
