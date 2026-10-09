# LIBRARY: the universal workflow library (design)

*Library design, 2026-10-09. $0: no model or Jev calls were made for this file. Companion files: `L0-VOCABULARY.md`
(the closed vocabulary), `L1-PATTERNS.md` (the corpus-derived pattern catalog), `JEV-PORTS.md` (the judgment requests),
`LIBRARY-TESTS.md` (how each claim here is tested), `BUILD-ORDER.md` (what is built first). Tags: **[M]** measured or
read in this repo (file cited); **[M-c]** computed at $0 in this directory (`out/`); **[I]** inference or design
choice; **[W]** public documentation (URL cited). Disagreements with the coordinator's architecture are in §11, not
folded in silently.*

## 0. Summary

- **What the library is for.** A cheap model (Haiku 5.5, class M) builds the workflows that people hand-curate in n8n,
  LangGraph or LangChain, by *choosing* from a small closed vocabulary and a catalog of idioms and *filling typed
  slots*, never by authoring a graph from a blank page. Owner requirement (memory, 2026-10-09): "allow the cheap haiku
  agent to not be overburdened and understand natively how to construct stuff as needed".
- **Five layers.** L0 vocabulary (30 constructs, closed, always in the prompt); L1 patterns (54 catalogued idioms,
  90% of corpus items explained by 37 of them [M-c]); L2 components (open; solvers by contract and hash, admitted only
  on evidence); L3 bindings (typed effect contracts over host tools and MCP; Foundry owns no connectors); L4 instances
  (whole kept workflows per project).
- **Progressive disclosure is a hard budget, not advice.** No constructor call sees more than 8,000 input tokens
  (policy class M, `policy/models.json` `inputBudgetTokensByClass.M`) [M]. The whole library is never in context: a
  call sees at most the L0 card, ≤ 20 one-line index entries, and ≤ 5 expanded items (§5).
- **Retrieval is code first, Jev second.** Code builds a candidate set of ≤ 20 from shape features, tags, BM25 and
  pattern companions; Jev ranks and gates it through typed ports (applicability, pattern choice, slot completeness,
  risk, quarantined read) only once each port has beaten its baseline (JEV-PORTS). Until then Jev reads are logged in
  shadow and code decides. Jev never holds authority (THESIS §7) [M].
- **Lifecycle.** construct → shadow → keep → reuse → heal → retire. Heal covers drift **and** latent defects found on
  later runs; a confirmed latent defect triggers a **retroactive sweep** that replays every past output of the defective
  version, marks the affected ones, propagates the mark to every caller, and relabels the judgments that led to them
  (§7.5).
- **Headline metric: wrong-reuse rate**, with a kill threshold (§9). The repo's sharpest failure was a reuse judgment
  (a skills arm at 0/21, all false successes; THESIS §6) [M].
- **Honest scope.** The library *explains* 97.8% of corpus items structurally, but only 48.4% are *buildable* on
  today's engine, 65.6% if the host owns triggers (L1-PATTERNS §7) [M-c]. Universality depends on engine nodes the
  library does not build (cross-run state first).

## 1. Placement and modes

Foundry runs inside a host harness (HARNESS-INTEGRATION §1) [M]. The host asks `route(task)`, `run(hash, input,
budget)` and `construct(traces, spec?)`. The library is what `route` searches and what `construct` composes from.

**Four answers to `route(task)`** (ROADMAP §2.8 actions, reduced to what the library decides):

| answer | when | library role |
|---|---|---|
| `none` | a single call or the host agent alone is enough (W-bed R0) | none; the router must say this often (THESIS §6) |
| `reuse(hash)` | an L2 or L4 entry's contract matches and its profile admits the input | applicability gate (§4.4) |
| `template(patterns, slots)` | no stored entry applies, but L1 patterns plus L2 components cover the structure | **library-first construction** (§5) |
| `construct` | the structure is not recognisable up front; do the work, then crystallise | **trace-first** compile (`experiments/jit/compile.mjs`); the library supplies the L0 card and the index as compiler inputs (W-BED §5) |

Library-first was never tested: C0 tested only from-scratch authoring by Haiku (11/16 against 16/16 for a script;
W-BED §10 O1) [M]. Library-first is therefore untested, not refuted (owner memory, addendum 2).

**What "replaces n8n / LangGraph" means here.** The hand-curated graph is replaced by a constructed solver plus an
envelope, assembled from L1 skeletons whose control flow is code (THESIS P1) and whose model calls are narrow typed
judges (P2). What is *not* replaced: connectors (L3 delegates to host tools and MCP; ROADMAP §3 "no connector
catalog"), visual editing, and durable distributed execution (ROADMAP §3). The structural claim is measured
(L1-PATTERNS §2); the "build it as well as a person" claim is W-bed's H1 and is open.

## 2. The five layers

| layer | what an item is | open / closed | who writes items | where it lives | in the prompt |
|---|---|---|---|---|---|
| **L0 vocabulary** | one construct of flow-v3 or of the engine envelope (30) | **closed**; a change is a versioned release with a prereg amendment | the Foundry maintainers | `L0-VOCABULARY.md` → compiler prompt | always, verbatim (≤ 3,000 tokens) |
| **L1 patterns** | an idiom: a flow-v3 skeleton with typed slots, when-to-use questions, an edge-case checklist, fixtures, an evidence record | curated, slow-growing (54 now; cap 60, §7.7) | maintainers, from corpus evidence (L1-PATTERNS) | shipped with Foundry, global | index line always; card on expansion |
| **L2 components** | a solver by contract: `solve.mjs` + input/output schema + input profile + evidence + version, addressed by hash | **open**, per project | crystallised from own verified runs; wrapped skills; oracle-bearing corpus conversions (§3.6) | per-project store (`createRegistry` generalised) | index line when retrieved; contract on expansion |
| **L3 bindings** | a typed effect contract over one host tool or MCP tool | open, per host | the host adapter, generated from the tool's schema plus a reviewed effect declaration | per host | index line when a slot needs an effect |
| **L4 instances** | a kept whole workflow (envelope + solver tree) for one project or team | open, per project | `construct` + admission | per-project store | index line when retrieved; contract on expansion |

**Why idioms, not templates.** Whole-workflow structure does not recur across platforms: at θ = 0.35, 19 families of
3+ items, of which 3 span 3+ platforms (L1-PATTERNS §2.6) [M-c]. Idioms do: the 24 grade-A patterns each recur on 10+
platforms (L1-PATTERNS §8) [M-c]. So L1 is global and curated; whole workflows are local (L4) and reused only inside
their profile.

## 3. Entry schemas

JSON-schema-like tables. Every layer shares the envelope of §3.1; layer-specific fields follow. Field names are
proposals except where marked as existing code.

### 3.1 Common envelope (every L1–L4 item)

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | L1 `P07`; L2/L4 `sha256:…` = `libraryHashOf(solveSource, contract)` (existing, `call-host.mjs`); L3 `B:<tool>` |
| `layer` | enum {L1, L2, L3, L4} | yes | |
| `version` | int ≥ 1 | yes | per id; a new profile or evidence for the same bytes is a new version (existing `createRegistry.get`) |
| `status` | enum {candidate, shadow, kept, suspect, demoted, revoked, retired} | yes | §7 |
| `index` | string ≤ 30 tokens | yes | the one line the constructor sees (§4.1); generated by code, never by the item's author |
| `tags` | enum[] from a closed tag list (pattern families, domains, effect classes) | yes | |
| `provenance` | {source: enum {own-trace, skill, corpus, maintainer}, ref, licence, redistributable: bool, author} | yes | corpus items carry `source.redistributable` already (census reads it) [M] |
| `untrusted` | string[] | yes | names of fields that hold third-party text (descriptions, SKILL.md bodies, corpus summaries); §8.2 |
| `evidence` | §3.7 | yes | append-only; never edited by the item |
| `supersedes` / `parent` | hash \| null | no | lineage |
| `createdAt`, `lastUsedAt` | ISO time | yes | retirement clock (§7.7) |

### 3.2 L1 pattern card

| field | type | notes |
|---|---|---|
| `family` | enum {spine, branch, fan, loop, compose, failure, trigger, state, human, agentic} | as the census `FAMILY` |
| `tier` | enum {S, IR, HOST, D, N} | what must exist to run it (L1-PATTERNS §7) |
| `constructs` | int[] | L0 rows composed |
| `skeleton` | flow-v3 source with `$SLOT` holes | the card's code block; compiled by code, not edited by the constructor |
| `slots[]` | {name, type ∈ {enum[], schema, path, fn:pure, judge, hash, int[a,b], tiers}, required, default?, lint[]} | slot types as L1-PATTERNS §3 |
| `when[]` | {id: J1/J2/J3, type ∈ {noul, choice, score}, instructions, criteria?} | Jev-ready (JEV-PORTS §3); every choice has a no-match option |
| `checklist[]` | {text, code?, minedFrom: corpus ids, kw?: {class, n}} | edge cases; the code is a composition-checker code where one exists |
| `fixtures[]` | {name ∈ {positive, no-match, drift, …}, task, stubAnswers, expect} | run at $0 through the replay override hook (`tools/flow-override.mjs` beside the solver, or `createFlow({ override })`; `experiments/jit/flow-v2.mjs`, `flow-v3.mjs` headers; tested in `experiments/jit/test/flow-override.test.mjs`) [M] |
| `companions[]` | {id, lift, n} | from `out/pattern-evidence.md` (§4.3) |
| `support` | {items, viaNode, viaToken, viaPlumbing, oracle, platforms, grade ∈ A–D} | census numbers |

### 3.3 L2 component

| field | type | notes |
|---|---|---|
| `hash` | `sha256:…` | existing: over solver bytes + NUL + canonical contract |
| `solvePath`, `flowVersion` | string, {2, 3} | existing registry fields |
| `contract` | {input: schema, output: schema, taskTemplate: string} | existing; `taskTemplate` is what local deopt interprets (FLOW-V3 §1.5) |
| `profile` | `jit-profile/1` (`experiments/jit/profile.mjs` `learnProfile`) | existing; the domain the component is proven on |
| `preconditions[]` | {text, kind ∈ {shape, semantic}, check?: fn:pure} | semantic preconditions are what the applicability port reads (JEV-PORTS §2); shape ones are code |
| `patterns[]` | L1 ids the solver was built from | lets a pattern-level defect find its components (§7.5) |
| `effects` | `'none'` | existing; components are pure. Effects live in L3/L4 envelopes |
| `bindingsUsed[]` | L3 ids | for envelopes only (L4) |
| `models` | tiers per judge site | from `policy/models.json` only |
| `minBudgetUsd` | number | existing optional field |
| `revoked` | bool + reason | existing (`registry.revoke`) |

### 3.4 L3 binding (typed effect contract)

| field | type | notes |
|---|---|---|
| `tool` | host tool or MCP `server/tool` name | Foundry never implements the connector |
| `argsSchema`, `resultSchema` | schema | from the tool's own schema |
| `effect` | {kind ∈ {read, write, send, delete, pay}, reversible: bool, external: bool, compensate?: tool} | **declared by a reviewed manifest, never inferred by a model**; the risk port may only raise it (JEV-PORTS §5) |
| `idempotency` | {key: path \| null} | P02 checklist |
| `rateLimit`, `retry`, `timeoutMs` | literals | P08 checklist: batching and delays belong here, not in the filter |
| `pagination` | {cursorPath, maxPages} \| null | replaces P23 (L0 changes note) |
| `credential` | env-var name | never a value (owner rule; L0 refusals) |
| `labels` | {output: enum {trusted, untrusted}} | every result of a `read` from outside is untrusted by default (P9) |

### 3.5 L4 instance

| field | type | notes |
|---|---|---|
| `envelope` | engine IR JSON | the IR the engine runs (`schemas/workflow.schema.json`) |
| `solver` | L2 hash | the pure part (L0 "two layers, one rule") |
| `calls[]` | L2 hashes reachable by `flow.call` | the composed tree, checked (§6) |
| `trigger`, `state`, `admission` | L0 rows 24–28 | mostly **N** today (L1-PATTERNS §7) |
| `owner`, `scope` | {project, team} | reuse never crosses scope without an explicit export |
| `effectPlan` | bool | true while effects are returned as a plan for the host to apply (W-BED §3.7) |

### 3.6 Wrapping outside material

| source | becomes | admission rule | what the constructor sees |
|---|---|---|---|
| **Own verified run** (trace-first compile accepted by `acceptance.mjs`) | L2 candidate | §7.2: verify-before-store from a reset environment with an independent oracle or an agreeing shadow | code-generated index line |
| **Agent Skill** (`SKILL.md` + `scripts/`; spec: https://agentskills.io/specification [W]) | L2 candidate wrapping a `flow.agent` node (row 12, **D**) whose instructions are the SKILL body, or a `step` that runs a bundled script | needs a contract (input/output schema) written by a maintainer or by the constructor *and* verified runs; the skill's own description never counts as evidence | an index line generated by code from `name` (≤ 64 chars) and the first 120 chars of `description`, labelled `untrusted`; the body reaches only the sandboxed agent node, never the constructor prompt |
| **Corpus item** (`research/corpus-20261006/items.jsonl`) | L1 evidence (checklist lines, support counts); optionally an L4 *reference* entry | reference entry only if `redistributable` and oracle-bearing; never runnable as-is (other platform) | nothing directly; corpus text enters only through the quarantined-read port (JEV-PORTS §6) |
| **Foundry library → Agent Skill (export)** | a `SKILL.md` whose script runs `foundry run <hash>` | kept L2/L4 only | — (this is how hosts that speak Agent Skills reuse Foundry's output; progressive disclosure is the spec's own: ~100 tokens of metadata at startup, body < 5,000 tokens on activation [W]) |

Why a skill is not admitted on its description: self-generated skills add about nothing on average (SkillsBench:
−1.3 pp text, −1.8 pp Table 3 in v1; curated +16.2 pp; https://arxiv.org/abs/2602.12670) and the repo's own skills arm
went 0/21 on a wrong-type follow-on (docs/RESEARCH.md:98) [M]. Grounded, execution-gated skills are what work
(landscape R01 §1.6) [M].

### 3.7 Evidence record (append-only, per item and version)

| field | meaning | source |
|---|---|---|
| `runs`, `oraclePass`, `oracleFail` | executions and oracle outcomes where an oracle exists | stream rows |
| `shadowed`, `shadowAgree` | runs re-done by an independent arm and their agreement | shadow adjudication (THESIS-JIT §6.3) |
| `silentMissesPer100` | wrong outputs with no deopt | `durability.mjs` [M] |
| `deopts` | count by kind {guard, invariant, judge, budget, call, agent, wide, plan} | FLOW-V3 §1.4 |
| `reuse` | {correct, wrong, missed, refusedCorrectly, refusedOther, deopted} | `classifyReuse` (`call-host.mjs`) [M] |
| `suspect` | {runs: n, sweepIds[]} | §7.5 |
| `profileN`, `durableSince` | profile size; task index of durability | registry / THESIS-JIT §6.8 |
| `verifierIndependence` | enum {code, different-family, same-family, none} | ROADMAP §2.7; independence README: Jev and Claude share errors (φ 0.61) [M] |
| `costPerRunUsd`, `p50Ms` | mean cost and latency | spans |
| `envFingerprint` | engine, model ids, policy hash | re-qualify on change (ROADMAP §2.7) |

## 4. Index and retrieval

### 4.1 The index line (the only form in which a non-expanded item reaches a model)

One line, ≤ 30 tokens, generated by code from the item's fields (never free text by an author):

```
P07 router-by-kind | branch | judged classify each item -> per-kind handler; unknown -> review | slots 6 | ev A 193/32p | v1
C:3f9a1c ledger-close | in {systems[],invoices[],payments} out {customers[],totals} | prof n=16 | reuse 31 ok/0 bad | smiss 1.0 | v3
B:sheets.append | write, reversible=no, external | idem key row.id | 60/min | cred SHEETS_TOKEN
I:9c2e77 acme-month-end | sched 0 6 1 * * | solver C:3f9a1c | kept 2026-10-09 | runs 12 | v1
```

The evidence fragment is code-computed. No line carries a description an outsider wrote; for wrapped skills the
description excerpt is marked `‹untrusted›` in the line (§3.6).

### 4.2 Shape features (code, $0, from the task alone)

Computed from the host's task text, the input files and, for trace-first, the first trace. Each is a field in a
`shape/1` record; every L1 card's tags map onto these.

| feature | how computed | patterns it points to |
|---|---|---|
| item lists and sizes | JSON walk (as `profile.mjs`), array lengths, files count | P12, P13, P53 |
| free-text fields | `profile.mjs` prose detection (≥ `proseMinWords`) | P03, P07, P13, P06 |
| number of sources describing the same entities | repeated key sets across inputs | P16, P17 |
| conventions stated in prose | date/unit/currency tokens in prose fields | P03 |
| output shape | requested schema: per-item rows, totals block, report | P12, P15 |
| effect verbs in the request | closed verb list (send, post, write, delete, pay, notify) | P02, P04, P08, P32 |
| time words | closed list (every, daily, cron, when, after, until) | P36, P34, P21, P33 |
| human involvement | closed list (approve, ask, confirm, review) | P32, P55, P09 |
| verifiability | output has a schema / tests named / a checker exists | P20, P47 |
| size band | tokens of inputs | P51 (above one read), P19 |

TaskSpec intake (review-05 §3.2 step 1) adds `rules[]` and `conventionsInProse` as verbatim spans, each checked to occur
in the task text [M: design].

### 4.3 Candidate generation (code; at most 20 candidates; $0)

1. **Hard filters.** Tier available on this host (§L1 §7), scope (L4 only from the same project), status ∈ {kept,
   shadow} for L2/L4, not revoked, effect classes allowed by the host's capability policy (ROADMAP §2.8 filters).
2. **Feature rules.** Each card's tags against `shape/1`: a pattern enters if any tag fires.
3. **BM25** over index lines + card `when[].instructions` + (L2/L4) `taskTemplate`, against the TaskSpec. Embedding
   similarity (`bge-small`, the Kev program's baseline embedder, review-05 §3.4) is an *arm* in LIBRARY-TESTS L2, not
   a dependency.
4. **Companions.** For every pattern already in the set, its top companion by lift (`out/pattern-evidence.md`) is
   added if absent (P10 → P55, P27 → P29, P45 → P46, P03 → P05, P07 → P09) [M-c].
5. **Profile pre-check for L2/L4.** `checkProfile(profile, task)` runs at $0; a `novel` result does not drop the
   candidate (that is the applicability port's decision) but is recorded beside it.
6. **Cut to 20** by a fixed score: rules hit ×2 + BM25 rank-normalised + companion bonus 0.5. The order of the 20 is
   logged; it is the code baseline every Jev port must beat.

### 4.4 Ranking and gating (Jev ports, with fallbacks)

| decision | port (JEV-PORTS) | until the port is promoted | after promotion |
|---|---|---|---|
| reuse this L2/L4 entry? | **applicability** (noul per precondition) | code: contract input-schema match **and** `checkProfile` not novel | reuse iff p ≥ τ_app (fitted on calibration split) **and** code guards pass; Jev can veto a code pass, never admit a code refusal |
| which patterns, for which role? | **pattern choice** (noul per candidate J1, then choice per role with `none`) | code order of §4.3; Haiku choose step (§5 S5) sees the top 8 | Jev's order replaces the code order for what Haiku sees; Haiku still chooses |
| are the slots complete? | **slot completeness** (score + noul per rule) | code lint (required slots, schema) | low score sends that slot group back to repair before smoke |
| how risky is this workflow? | **risk class** (choice) | code rule over L3 `effect` declarations | may only raise the class (more shadow, approval gate, `samples > 1`) |
| is this outside text safe to index / does it carry instructions? | **quarantined read** (noul / choice) | regex + Haiku classify | gates ingestion of skills and corpus text into the index |

"Promoted" means: on held-out labelled data the port beats every baseline in JEV-PORTS §1.4 under the stats rule in
LIBRARY-TESTS L8; promotion is recorded per port with the model version Jev reported (`jev-1.13.0` in J1) [M]. A
version change re-opens promotion (ROADMAP §2.7: re-qualify on model change).

**The k shown to the constructor** (ranked candidates expanded into full cards): default 3, hard maximum 5. LIBRARY-TESTS
L3 and L5 measure k ∈ {0, 1, 3, 5, 8} to set it.

### 4.5 The utility guard

The library is the classic utility problem (Minton; APC "persistently low" hit rates; Muscle-Mem 50–67% misses;
landscape R01 §1.5) [M]. Guards, all code:
- the candidate set is capped at 20 regardless of library size;
- matching cost (ms and $ per `route`) is logged per call; a `route` that costs more than 5% of the median construction it
  saves is a utility alarm [I: threshold];
- retirement (§7.7) and a per-project cap on kept L2/L4 entries (default 500) [I];
- L1 grows only through §7.8, cap 60.

## 5. The constructor loop (Haiku, with progressive disclosure)

The constructor is itself a Foundry workflow: code owns the loop, budget and termination; each Haiku call has one
typed output and one check (review-05 §3.2) [M: design]. The model never sees the whole library and never writes a
whole workflow in one call.

### 5.1 Steps

| step | who | sees (≤ tokens) | typed output | check |
|---|---|---|---|---|
| S1 intake | Haiku, class S, reasoning none | task text (≤ 3,000, code-truncated) | `TaskSpec` {outputSchemaSummary, inputs[], rules[{span, kind}], conventionsInProse[], effects[]} | every span occurs verbatim in the task (else rejected) |
| S2 shape | code | task + TaskSpec | `shape/1` | — |
| S3 route | code + applicability port | TaskSpec + ≤ 5 L2/L4 candidates (contracts) | `none` \| `reuse(hash)` \| `template` \| `construct` | §4.4 gate; R0 tasks must come out `none` |
| S4 candidates | code | — | ≤ 20 ranked candidates (§4.3–4.4) | logged order |
| S5 choose | Haiku, class S | TaskSpec (≤ 1,000) + ≤ 20 index lines (≤ 600) + J1 question of each (≤ 600) | **pattern plan**: ≤ 5 {role, patternId} + `decompose[]` if more are needed, or `none-fits` | ids exist in the shown set; ≤ 5; a role named twice is refused |
| S5b decompose | code | pattern plan | parent plan + child plans (each ≤ 5 patterns), joined by P54 `flow.call` | each child has an input and output schema slot |
| S6 fill | Haiku, class M, one call per slot group | L0 card (≤ 3,000) + one expanded card (≤ 1,200) + TaskSpec (≤ 1,000) + input sample (≤ 1,500) + slot-group schema (≤ 500) + L2/L3 index lines for `hash`/effect slots (≤ 600) | slot values (schema-constrained; per-slot `fn:pure` bodies by constrained generation) | slot schema; per-slot lint |
| S7 assemble | code | skeletons + slots | `solve.mjs` (+ proposed envelope for IR/HOST/N tiers) | composition checker (§6) + L1 §9 codes + `foundry validate` for envelopes |
| S8 repair | Haiku, class S | one error code + its path + the one slot (≤ 2,000) | a replacement slot value | re-run S7; ≤ 2 rounds per slot, ≤ 6 in total |
| S9 smoke | code | — | fixture results (stub answers, $0) then 1–3 live probe tasks | fixtures pass; probes within budget; no deopt |
| S10 register | code | — | L2 candidate (status `shadow`) | §7.2 |
| S11 escalate | code rule | — | event | no S9 pass after 6 repairs, or spend > cap → trace-first `construct` or the host agent |

S5 alternative when nothing fits (`none-fits`): fall back to trace-first construction (§1). The constructor never
improvises structure outside L0 + L1; L0 is the closed fallback, not a blank page.

### 5.2 The context budget (hard; enforced by code before each call)

| call | L0 card | index lines | expanded items | task material | other | **cap** |
|---|---|---|---|---|---|---|
| S1 intake | — | — | — | 3,000 | 300 instructions | **4,000** (class S) |
| S5 choose | — | ≤ 20 × 30 = 600 | J1 per candidate ≤ 600 | 1,000 | 500 | **4,000** (class S) |
| S6 fill | 3,000 | ≤ 20 × 30 = 600 | **1** card ≤ 1,200 | 2,500 | 500 | **8,000** (class M) |
| S8 repair | — | — | the slot only | 1,000 | 500 | **4,000** |

The "≤ 5 expanded items" of the coordinator's architecture is met *across* the loop (one card per fill call, at most five
cards per construction), not inside one call [I: stricter than the brief, because a fill call needs only the card it
fills]. A budget overrun is refused by code (`CONTEXT_OVER_CLASS_BUDGET`, review-05 §3.6), not truncated silently.

**Cost of one library-first construction** [I, from measured unit prices]: at most 1 + 1 + 15 (five patterns × three slot
groups) + 6 repairs = 23 Haiku calls, each ≤ 8K tokens in and ≤ 1K out at $0.10 / $0.50 per MTok (`policy/models.json`)
[M], is ≤ $0.03 of tokens, plus the CLI's own per-call overhead (a tiny judge call measured $0.00011 total and 1.4 s,
DEV-NOTES D22) [M]. Wall time ≈ 23 × 1.4–5 s. Every call is far below Haiku's 100K-token price step (5× above it,
`policy/models.json`) [M]. Compare: a trace-first compile $2–5 at the Haiku cap (W-BED §3) [M]. The prediction that
library-first is ≥ 30× cheaper to *construct* is LIBRARY-TESTS L3's cost claim; whether what it builds is as good is
its success claim.

### 5.3 What Haiku is never asked to do

Write control flow outside a skeleton; pick a model id outside `policy/models.json`; choose a tool outside the L3 set
the host exposes; decide reuse alone; read corpus or skill text in the constructor prompt; write an effect inside a
solver; see an oracle (W-BED §2.2) [M].

## 6. Composition: `flow.call` and the composition checker

Items needing more than 5 patterns (15.6% of the corpus, mostly n8n and Apple Shortcuts mega-flows; L1-PATTERNS §2.1)
[M-c] are built as a parent solver plus called children (P54), each child within the budget. `flow.call` exists (flow-v3
slice 1, `experiments/jit/call-host.mjs`) [M], with refusals `unknown-hash, revoked, recursion, depth, tree-size,
effects, input-schema, outside-profile, BUDGET_TOO_SMALL, budget-exceeds-parent` [M].

**The composition checker** (code, at S7 and before every registration) adds static checks over the composed tree that
the call host only checks at run time:

| check | rule | code |
|---|---|---|
| types | each call site's argument conforms to the callee's `contract.input`; the callee's `contract.output` conforms to what the caller's next stage reads (schema subsumption over the portable subset) | `CALL_TYPE` |
| effects | every node in a solver tree is `effects: 'none'`; effects appear only in the L4 envelope, each through a declared L3 binding | `EFFECT_IN_SOLVER` |
| budgets | Σ child `budgetUsd` reservations along any path < parent budget; every child ≥ its `minBudgetUsd` and the floor (FLOW-V3 §1.3) | `BUDGET_TREE` |
| one writer | each state key, file path and effect target has exactly one writer in the tree (THESIS P8) | `ONE_WRITER` |
| depth and recursion | depth ≤ 3 (hard 8); no hash on its own ancestor chain; call targets are literals | `DEPTH`, `RECURSION`, `MUTABLE_TARGET` |
| profiles | for each call site with a known input sample, `checkProfile` of the callee admits it, else the site must set `onDeopt: 'interpret-child'` | `PROFILE_UNREACHABLE` |
| L1 universal codes | L1-PATTERNS §9 (`JUDGE_NO_CHECK`, `ENUM_NO_NONE`, `BRANCH_ON_TEXT`, `UNBOUNDED`, `VERIFY_NOT_GATING`, …) | as listed |

Local deopt (`onDeopt: 'interpret-child'`, FLOW-V3 §1.5) is the default the constructor emits for reused children, so a
wrong reuse costs one child's interpretation rather than the whole task [I].

## 7. Lifecycle and governance

### 7.1 States

```
candidate --verify-before-store--> shadow --evidence thresholds--> kept --reuse--> kept
    ^                                 |                               |  \
    | recompile / heal patch          | fails                         |   \-- defect confirmed --> suspect --sweep--> kept(v+1) | revoked
    +---------------------------------+------------- demoted <--------+-- circuit breaker
kept --unused N days / out-competed--> retired          (revocation list blocks a hash everywhere)
```

Maps onto ROADMAP §2.7's `draft → shadow → canary → served` (candidate = draft; kept = served; canary is the first m
reuses after keep, counted separately in the evidence) [M].

### 7.2 Construct → store: verify before store

Admission to `shadow` needs all of (ROADMAP §2.7 admission, THESIS P4) [M]:
1. S9 fixtures pass and 1–3 live probe tasks pass **from a reset environment** (fresh sandbox, no workdir carry-over);
2. an independent oracle, or, where none exists, an agreeing shadow by a different arm (agent or reference);
3. a capability manifest no wider than the probe runs used;
4. a profile learned only from accepted tasks (`learnProfile`; widening only on recompile or an agreeing shadow,
   `profile.mjs` header) [M].

PreAct found verify-before-store to be the dominant mechanism and the selector not to matter (landscape R01 §1.6) [M];
this is why the gate sits here and not in retrieval.

### 7.3 Shadow → keep

Thresholds (starting values, ROADMAP §2.7 following Progressive Crystallization) [M]: ≥ 10 runs; ≥ 90% stable action
shape; shadow agreement ≥ 0.9 on ≥ 4 shadowed runs; zero silent misses where an oracle exists; wrong-reuse upper bound
within budget (§9). Keep records `durableSince`.

### 7.4 Reuse

Reuse is refused outside the profile (`outside-profile`, existing) and, once promoted, below the applicability
threshold. Every reuse decision is a ledger row (JEV-PORTS §8) and later classified by `classifyReuse` into correct,
wrong, missed, refused-correctly [M]. Shadowing continues at a decaying rate (every 4th run in W-BED; every 10th once
`durableSince` ≥ 20 runs) [I].

### 7.5 Heal: drift and latent defects, with a retroactive sweep

Two triggers, one pipeline. The heal pipeline that exists (`experiments/heal/`: detect → classify → localise → propose →
verify V0–V8 → promote / rollback, HEAL DESIGN §3–§9) [M] is reused for both; the library adds the trigger for latent
defects and the sweep.

**Drift** (the input changed). Signals: profile novelty, guard or invariant deopt, shadow disagreement on new-shaped
input. Classify first (THESIS §6 "diagnosis before repair": flake, variance, defect, env, impossible), then: env fault →
retry, no recompile (W-BED R8 f2: a recompile on an env fault is an error); drift → recompile from the new trace or a
heal patch; never widen a guard without proof (D9: a heal widened a guard and turned refusals into silent failures;
`HEAL_GATE_LOOSENED` reject code exists in `scan.mjs`) [M].

**Latent defect** (the input did not change; the component was wrong all along). Signals, any of:
- a later oracle or shadow disagreement on an input **inside** the profile (the D1 under-merge class: 0 of those silent
  misses was flagged by the profile; handoff wf_6a40a4a8 finding 4) [M];
- a new checklist line or composition-checker code, added after the component was kept, that the component fails
  statically;
- a defect confirmed in a sibling built from the same L1 pattern slot (via `patterns[]`, §3.3);
- a user or host report, labelled untrusted until reproduced by replay.

**Retroactive sweep** (on any confirmed latent defect in version v of hash h):
1. **Scope.** From the journal and the call-host events, list every run whose span tree contains h@v, directly or as a
   called child (`call-end` events carry the callee hash), with run id, input digest and output digest.
2. **Re-execute.** Run each past input through the fixed version v+1 in replay mode: unchanged judge calls hit the
   journal at $0 (`replay.mjs` `replay-or-live`) [M]; changed judge sites are re-asked live under a sweep budget cap
   (default $1 per sweep, then owner approval) [I].
3. **Diff.** Compare output digests (`outDigestOf`) [M]. Equal → the past output stands. Different → the run is
   **suspect**.
4. **Propagate.** Mark every ancestor run (the callers in the span tree) and every L4 instance whose output consumed a
   suspect child as suspect too; for runs whose envelope applied effects, emit a remediation item per effect: compensate
   if the L3 binding declares a compensating tool (L0 row 23, **N**), else a human queue with the before/after diff.
5. **Relabel.** Every reuse decision that admitted h@v for a now-suspect run is relabelled `wrong` in the judgment ledger
   (source `retro-sweep`), so the applicability port's calibration sees its own false admits; evidence of h@v loses
   those runs from `oraclePass`/`shadowAgree` and gains `suspect`.
6. **Generalise.** If the defect class is a pattern-slot defect (for example a missing borderline band in P16), a new
   checklist line and, where possible, a checker code are proposed for the L1 card (a versioned L1 change, §7.8), and
   step 1 is repeated for every L2 component listing that pattern.
7. **Report.** A sweep record `{defect, h, v, runsScanned, suspect, effectsRemediated, costUsd}` is appended; nothing is
   deleted.

Sweep cost is bounded by replay: a code-only fix re-executes at $0. The sweep is the answer to the silent-miss problem
the repo keeps meeting: misses that were invisible when produced become visible, counted and attributed once one is
found [I].

**Authority.** A heal patch is promoted only by the heal pipeline's code `decide` (`promote.mjs`) after V0–V8; small
models never self-modify the library (ROADMAP §3) [M]. Proposals the owner has reserved for review are never
self-approved (CLAUDE.md owner rule on heal proposal `p-a3336190-r4`; the library inherits the rule for every
proposal flagged for review).

### 7.6 Versioning, revocation

- Identity is the hash of bytes + contract (existing). A changed byte is a new item; versions of the same hash carry new
  profile or evidence only.
- `revocations.jsonl` (append-only) blocks a hash everywhere; the call host already refuses `revoked` [M]. Revocation
  reasons: confirmed unfixable defect, licence withdrawal, security finding.
- Re-qualify on any change of model id, engine tree id or policy hash (ROADMAP §2.7; the heal kit's `policyDrift` gate
  is the precedent, J1-JEV-DEV §9) [M]: a kept item drops to `shadow` until re-verified.

### 7.7 Retire (disposable by default)

THESIS P5 [M]. An L2/L4 item is retired when: unused for N days (default 30) [I]; or out-competed (another item with the
same contract has higher success at lower cost on the same profile for ≥ 10 paired runs); or circuit-broken (ROADMAP
§2.7: fallback rate rises, success ≤ 0.5 after ≥ 5 uses, or 3 consecutive failures) [M]. Retired items keep their
evidence (negatives kept) but leave the index.

### 7.8 L1 governance

L1 changes are releases: a new card needs grade ≥ B corpus support or a W-bed rung that needs it, three fixtures that
pass, and a prereg amendment if a pre-registered round is in flight (review-05 §3.3: "each new skeleton counts as a
protocol change") [M]. Cap 60 cards; a new card past the cap retires the card with the least retrieval use over the
last release.

## 8. Privacy, provenance, security

### 8.1 What is shared

Decisions and artefacts are shared, transcripts never (THESIS P8) [M]. Concretely: L1 is global; L2/L4 entries leave a
project only by explicit export, and an export carries the solver, contract, profile summary (`describeProfile`) and
evidence counts, never journals, traces or input samples. Judgment ledgers stay per project; a pooled training set for
a fine-tuned judge (THESIS §7) needs the owner's opt-in and strips state to code features.

### 8.2 Untrusted text

Corpus summaries, skill descriptions and bodies, retrieved documents and human answers are data (P9). They enter the
index only after the quarantined-read port (or its baseline) passes them, they appear to the constructor only as
code-generated index lines marked `‹untrusted›`, and they can choose control flow only through an enum.

### 8.3 Provenance and licence

Every corpus-derived checklist line cites item ids; the census reads graphs and summaries only, never licence-restricted
source text (L1-PATTERNS §1 item 1) [M]. An L4 reference entry built from a corpus item requires `redistributable`.

## 9. Metrics

| metric | definition | target / kill |
|---|---|---|
| **wrong-reuse rate** (headline) | wrong / (correct + wrong) over reuse decisions, `classifyReuse` with the oracle | **kill**: if the 95% Wilson upper bound exceeds 0.05 after ≥ 60 reuse decisions, or the point estimate exceeds 0.10 after ≥ 20, the reuse mode is switched off for that gate configuration and every reuse falls back to `template`/`construct` until a new configuration passes LIBRARY-TESTS L4 [I: thresholds; the 0.05 bound is ROADMAP §2.7's GAC-style default] |
| missed-reuse rate | missed / (missed + refused-correctly) | reported beside wrong reuse (a gate that refuses everything is not a win) |
| coverage | share of corpus items explained by L0 + L1 within the expansion budget; buildable share by tier | 82.2% flat at b = 5; 48.4% buildable today [M-c] |
| construction success | share of library-first constructions whose output passes the oracle on held tasks | LIBRARY-TESTS L3 |
| construction cost | $ and Haiku calls per construction | §5.2 prediction ≤ $0.05 |
| overburden curve | success vs items expanded / index size | LIBRARY-TESTS L5 |
| latent-defect yield | suspect outputs found per sweep; time from defect to sweep | §7.5 |
| port calibration | per-port ECE, Brier, selective risk at budget | JEV-PORTS §8 |

## 10. Deliberately refused

- Group chat, full-history handoff, interactive dashboard state (35 corpus items, L1-PATTERNS §2.5) [M-c].
- Whole-workflow templates as a global layer (§2: they do not recur).
- Admitting any item on its description, frequency or a model's say-so (§3.6, §7.2).
- A model choosing reuse, effects, tools or model ids (§5.3).
- Self-modification of the library by small models (ROADMAP §3).
- A connector catalog (ROADMAP §3); L3 only describes host tools.
- Unbounded loops, waits without timeouts, effects inside solvers, recursion by hash, credentials in literals (L0).
- A shared mutable board between agents (rewritten as P19 `wide` with a typed reduce; PRINCIPLES A11) [M].

## 11. Objections to the coordinator's architecture (kept visible)

1. **"Jev ranks relevant stuff" is not yet supported by evidence, and the design must work without it.** On J1 dev,
   a $0 bag-of-words probe beat stock Jev in-family on kinetics X3 and X4 (bacc 0.930 / 0.979 against 0.609 / 0.742)
   (J1-JEV-DEV §8 item 4) [M]; PreAct found the selector does not matter once verify-before-store is in place [M]. So
   every Jev port starts in shadow, and the code ranker (§4.3) is the production default until LIBRARY-TESTS L2/L4/L8
   say otherwise.
2. **Jev is not an independent voter.** Its errors are strongly associated with Claude's (φ 0.61 with Haiku, design
   weighted; 36 of 40 shared errors on the same wrong option) (independence README) [M]. Jev can rank and veto; it
   cannot serve as the "different family" verifier that P49 or §7.3's shadow needs.
3. **"~40–60 patterns cover everything" is true structurally and false operationally.** 90% at 37 patterns [M-c], but
   only 48.4% of items are buildable on today's engine; the gap is engine nodes (state, wait.signal, session), not
   library content. The universality claim should be stated with the tier.
4. **L2 "corpus conversions" are low value.** Corpus workflows are on other platforms, mostly without oracles (438 of
   1,559 oracle-bearing; COVERAGE §7) [M], and whole structures do not recur. The corpus feeds L1 evidence; L2 grows
   from own verified runs.
5. **Self-crystallised L2 components are the SkillsBench "self-generated" case** unless verification is real. The design
   therefore gates L2 on oracle or independent-shadow evidence, and measures it (LIBRARY-TESTS L3 library type
   "components").
6. **The ≤ 5-item budget can hide a decomposition error.** 15.6% of items need decomposition (S5b); a wrong split is a
   construction error Haiku may make, and C0 shows Haiku authoring from description is weak (11/16) [M]. Decomposition
   is therefore code-assisted (S5b) and measured separately on R4.

## 12. Mapping to existing code (what is a path change, what is new)

| design element | existing code | change |
|---|---|---|
| L2 registry, hash, revoke, list | `experiments/jit/call-host.mjs` `createRegistry`, `libraryHashOf` | per-project directory instead of per-arm; add `status`, `index`, `tags`, `provenance` fields |
| reuse classification | `call-host.mjs` `classifyReuse` | none |
| input profile | `experiments/jit/profile.mjs` `learnProfile` / `checkProfile` / `describeProfile` | none |
| judgment ledger, calibration | `src/judgment.mjs` `SystemOneClient`, `JudgmentLedger`, `calibrationReport` | noul/score answers (today `fromSystemOneAnswer` reads choice only); meta fields of JEV-PORTS §8 |
| heal | `experiments/heal/*` | a latent-defect signal source and the sweep (§7.5) over flow-v3 journals (today IR workflows) |
| decision rule | `experiments/jit/stats.mjs` `DECISION_RULE` | none |
| L1 census | `tools/pattern-census.mjs`, `tools/render-evidence.mjs` (this directory) | none |
| index builder, ranker, constructor loop, composition checker | — | new (BUILD-ORDER) |
