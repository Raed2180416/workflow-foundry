# SPEC-1 / INTENT-1 preregistration (intent recovery from a messy business, E8)

**Status: DRAFT (2026-10-21).** Written by the build agent with the $0 runner; nothing paid has run and no model was called.
The orchestrator freezes it: re-run `node experiments/specbiz/spec1-freeze.mjs`, paste its output over §9, change this line
to `**Status: FROZEN (date, commit)**`, and commit. Until then `experiments/specbiz/spec1.mjs` refuses every paid row
(`spec1-freeze.mjs preregCheck`: the status line, every frozen file listed, every sha256 matching).

Design: [DESIGN.md](DESIGN.md) §1 (metrics), §3 (arms), §4 (predictions I-1 to I-7), §8 (limits), §9 (build items);
FIRST-CLASS-PROGRAMS §4.4 (SPEC-1, F4). Truth: [truth-e8-seed1.json](truth-e8-seed1.json); second rater:
[RATER2.md](RATER2.md), [rater2-labels.json](rater2-labels.json). Evidence class: **development** (our generator, dev
worlds, K = 2). No result here supports a claim beyond E8 (§0.3 of FIRST-CLASS-PROGRAMS).

```prereg-banner
SPEC-1 / INTENT-1 (F4; development evidence; E8, pack seed 1, K = 2 lineages per arm)
ARMS        SPEC-1: derive, derive-ledger, none-agent. INTENT-1: derive-prior, no-ask, always-ask. S-perfect = existing B1L-H rows.
PRIMARY     recall over the 23 attributable unstated gold ids (L2 u L3; R4.3 excluded: nothing can implicate it), upper bound
            (attribution) with the lower bound (demonstrated by a passing case) beside it.
MDE         primary: 23 ids x K 2 = 46 id-observations per arm; a difference of about 25 points at p ~ 0.75 (alpha 0.05,
            power 0.8), larger with lineage clustering. Pass rate: lineage spread dominates (B1L-H: 95.3-100% at K = 3).
PREDICTION  H1 derive spec recovery in [0.60, 0.85]; H3 derive L3 recall 0.45-0.75; H4 ledger +10 points primary; H8 none-agent <= 10/14.
REFUTED     H1 below 0.60 (and, the other way, >= 0.95: derivation is not the bottleneck); H4 below +3 points with the
            interval excluding +10; H8 when both derive arms score below none-agent on the 14 shared cases.
CAP         $25 total; per-arm caps (section 7); every lineage reserves all its bounds before it starts.
```

## 1. Question

Given only a messy business (an outdated and a current SOP, correcting e-mails, an unauthorised sender, precedent
exports, distractors) and an owner who answers only what is asked, how much of "what would be needed and what could be
needed" does a cheap builder recover, at what over-reach and at how many questions? Layers (DESIGN §1): L1 stated, L2
implied, L3 latent, L4 not wanted.

## 2. Arms

| Arm | Run | What it gets (everything else is B1L-H: `experiments/ebed/build.mjs` conditions) | Code |
|---|---|---|---|
| S-perfect | existing | B1L-H with SPEC-E, K = 3 (`b1lh-e8-1..3`), graded on oracle 2: 1,022 + 974 + 1,015 of 3 × 1,022 = **3011/3066 (0.9821)**; regraded at $0 in the same record format by `spec1.mjs perfect` | — |
| derive | SPEC-1 | B1L-H with SPEC-E.md replaced by the pack under `business/` (26 files, digest `5d133cda…`), TASK.md with the three audited edits of `spec1-arms.mjs` TASK_EDITS plus "The shop" and "Asking the owner"; `ask.mjs` (20 questions) | `spec1-arms.mjs`, `ask-service.mjs` |
| derive-ledger | SPEC-1 | derive + LEDGER.md: the tracker's extraction (`experiments/tracker/extract.mjs`, one Haiku call over the pack, quotes located verbatim) reviewed by the simulated owner from her records: stale wording corrected with her pre-rendered answer, unauthorised and distractor quotes struck, the rest confirmed; she adds nothing | `ledger-review.mjs` |
| none-agent | SPEC-1 | AGENTV-E8's agent-H + validator (12/14 there, the better agent arm), one fresh Haiku session per tick, with the pack instead of SPEC-E, `ask.mjs` with one owner and 20 questions for the whole run (earlier answers in `owner-answers.md`), no build; world 1232 d2 size 12 only | `pack-agent.mjs` |
| derive-prior | INTENT-1 | derive + PRIOR.md (P(feature \| automation/event, orchestration/event) from `corpus-prior.json`) and the rule "a feature the documents don't state and whose prior is below 0.5: ask, don't add" | `spec1-arms.mjs priorCard` |
| no-ask | INTENT-1 | derive with no `ask.mjs`; TASK.md says the owner is not reachable | — |
| always-ask | INTENT-1 | derive + "before you write solver.mjs, ask her all 20"; compliance (questions asked) is recorded, not enforced | — |

**Fixed conditions** (`spec1.mjs CONDITIONS`): model `claude-haiku-5-5` (policy/models.json; any other id is refused),
effort high, one sandboxed session, $3 and 40 min per build, 400K session tokens, smoke loop on practice worlds 1235–1237
× d2, d3, d5 (B1L-H's); owner budget 20 questions; the owner's match is one Haiku typed judgment per question (closed list
of record ids and titles plus no-match, `owner-sim.mjs MATCH_JUDGMENT`), journaled by ModelPort, $0.05 per call and $0.30
per lineage; extraction $0.25 per call, $0.50 per lineage; agent ticks $0.40 and 6 min each, 1 retry, concurrency 4,
$3.00 per lineage on the §12 meter.

**No SPEC-E at run time (build item 1).** Every host a derived solver or agent runs under (smoke loop, grading, agent
run) is bound with `specE: ''` (`NO_SPEC_BINDING`), so `beds/ebed/host/host.mjs:435` writes no `spec/SPEC-E.md` into
`ctx.files`. `spec1.test.mjs` proves it in-process, through the sandboxed smoke loop and grading, and in agent sessions,
each with a control (E8's own binding) that must and does expose SPEC-E. **Never grade a derived solver with
`build.mjs --grade-only`** (DESIGN §9's planned command): that binds SPEC-E. Use `spec1.mjs grade`.

**Decision to confirm at freeze.** DESIGN §3's none-agent row does not mention asking; §9's command passes `--budget 20`
to all three SPEC-1 arms. This draft gives none-agent the owner with a run-wide budget of 20. Removing it is one line
(`ARMS['none-agent'].ask`).

## 3. Seeds, worlds, lineages

- **Pack:** seed 1 only, `renderPack({ seed: 1 })`, digest `5d133cdaf1fd43e6f5541b71ccf14b6a9d9d0d1c2077eb61a3296ffbfb276f3d`,
  byte-equal to `specbiz-pack-seed1/files/` (tested). UA1 (book before charging), override ids R2.1, R4.4, R5.1,
  owner-only R2.2, S2, S9, records-only R1.2, R1.4, S1, S6.
- **K = 2 lineages per arm** (labels `spec1-<arm>-p1-l1`, `-l2`), run in order l1, l2. Independent builds on the same pack.
- **Grading worlds** (build arms, $0): E8 dev rehearsals 1232–1234 × d2, d3, d5, mix tail, full size (the B1 worlds).
- **Shared world** (all arms): 1232 d2 size 12 (14 completed cases; world digest `56971c9b…`, checked by the runner).
- **Practice worlds** (smoke loop only): 1235–1237 × d2, d3, d5. Disjoint from both.
- **Set-aside rule.** A lineage whose build session or agent run ends in an environment fault (MODEL_RATE_LIMIT,
  MODEL_UNAVAILABLE, SANDBOX_UNAVAILABLE) is kept and reported as set aside; the agent arm resumes from its journal with the
  same command (exit code 3); a build arm is re-run once as `-l<k>r` after the set-aside directories are moved, and the
  re-run is reported as such. No other substitution. A build that writes no `solver.mjs` for any other reason is a
  result: it is graded as the null solver (`spec1.mjs NULL_SOLVER`: no effect, every case fails), never dropped.

## 4. Outputs

Per lineage, `research/intent-20261021/runs/<label>/`: `result.json` (conditions, prereg sha, engine stamps, build or
agent summary, owner journal with byte-identical replay check, ask metrics, ledger review, one verdict record per graded
world: completed cases with first divergences and the ids the reference run exercises per case, predicates over the whole
journal, critical violations, acts), `solver.mjs`, `transcript.jsonl`, `smoke.jsonl`, `ask.jsonl`, `match.jsonl`,
`model-calls.jsonl`, `LEDGER.md` and `ledger.json` (derive-ledger), `ticks.jsonl` and `validator.jsonl` (none-agent).
`runs/spend.jsonl` is the spend ledger. The ModelPort SQLite journals stay in `/var/tmp/foundry-work/spec1/<label>/`.

## 5. Metrics (exact; `experiments/specbiz/score.mjs`)

Notation: a lineage's **evidence set** E is its 9 grading worlds (build arms) or the shared world (none-agent); S is the
shared world. For a completed case c: pass(c); implicated(c) = `attribute.mjs implicated` (the ids of its first
divergence, plus the readings of its class); ex(c) = the ids a divergence on any of c's reference effects or tasks could
name, plus records/decision/over-escalation ids and c's class readings (`spec1.mjs exercisesByCase`).

1. **Pass rate** p = Σ passed / Σ completed over the lineages and worlds of the set.
2. **Spec recovery ratio** R = p_arm(grading) / p_S-perfect, p_S-perfect = 3011/3066 = 0.98206 (frozen oracle-2 regrades).
   Reported pooled (Σ over K lineages) and per lineage.
3. **Recall, upper bound** (DESIGN §1) of an id set I on a case set C: |{i ∈ I : no failing c ∈ C has i ∈ implicated(c)}| / |I|.
4. **Recall, lower bound** on I_ex = {i ∈ I : ∃ c ∈ C, i ∈ ex(c)}: |{i ∈ I_ex : not implicated by a failing case ∧ ∃ passing
   c, i ∈ ex(c)}| / |I_ex|. A lineage is **masked** when upper(I_ex) − lower > 0.25 (the oracle stops at a case's first
   divergence, so an arm that fails early is credited with every rule it never reached).
5. **Layers** R1, R2, R3: upper recall on E of the 6 / 8 / 16 gold ids of rater 1 (the truth); also under rater 2
   (6 / 9 / 15; κ = 0.57 on L2/L3) and the lower bound.
6. **PRIMARY: unstated recall** = upper recall on E of U* = (L2 ∪ L3) ∩ attributable = 23 ids (R4.3 excluded: no lid, rule
   label or class names it, so it is "implemented" for every arm). Identical under both raters (the unstated set is the
   same). Pooled over K: Σ implemented / Σ |U*|. Reported with its lower bound, with the DESIGN definition over all 24, and
   on S (also over the ids S exercises).
7. **Over-reach** (23 L4 items, truth checks): predicate items are violated when the predicate fires anywhere in E;
   NW-STALE-SOP when a failing case's first divergence is early/late/order/outside-allowed/duplicate and implicates an
   override id (approximate); NW-NEW-AFTER-CANCEL when a first divergence is outside-allowed on reserve/charge/carrier
   create (approximate); NW-OLD-APP on an orphan-charge critical or early-timeout; NW-EGRESS held by the sandbox;
   NW-INJECTION (MR12) **unchecked**. v = items violated; V = violating acts (distinct predicates' counts + approximate
   oracle acts + orphan charges); A = attempted ledger rows + human tasks; precision = (A − V) / max(A, V).
8. **Goldilocks** = 100 · sqrt(((R2 + R3) / 2) · (1 − v / 23)), upper and lower.
9. **MOI** = 1[v = 0] · (R1 + R2 + R3) / 3; comparisons lexicographic on (1[v = 0], 1[R1 = 1], R1 + R2 + R3, −questions).
10. **Ask** (`owner-sim.mjs askMetrics`): precision = questions that obtained an owner-only unit / questions; recall =
    owner-only units obtained / 3; Ask-F1 = 2PR / (P + R); wasted = questions whose answered records are all carried by the
    documents (sop, email); wasted share = wasted / asked; confirmations, withheld, no-match; always-ask compliance = asked ≥ 20.
11. **Completion** = (passing + failing cases whose implicated ids avoid L1) / n; **Compliance** = (passing cases with no L4
    predicate act on the case) / n.
12. **Forward items** F = forward-tagged items implemented (R1.3, R1.4, R5.2, R7.1, S2, U02, U11, U13, NTF; U11 also fails
    on any failing go-live case).
13. **Cost**: build charged = max(reported, re-priced from the transcript), the bound when unobserved; agent = the §12 meter;
    matcher and extraction = provider-reported. **S1 claim rows** (`claim-row/0`, emitted by the runner, one per lineage and
    set) carry these in an `intent` block.
14. Differences of proportions: Newcombe hybrid score interval (95%), ids treated as independent (they are not: too narrow).

## 6. Hypotheses and readings (thresholds are `score.mjs THRESHOLDS`)

Every reading is development evidence. A recall-based support is read on the lower bound or blocked when masked; a
refutation on the upper bound.

| H | From | Supported if | Refuted if | Otherwise |
|---|---|---|---|---|
| H1 spec recovery | FCP (a), the plan's gate | derive's pooled R in [0.60, 0.85] | **R < 0.60** (lineages straddling 0.60 are flagged); or **R ≥ 0.95**: derivation is not the bottleneck on E8, F4 moves to outside beds | 0.85 < R < 0.95: inconclusive |
| H2 stated | I-1 | every lineage of every derive-family arm has ≥ 5 of 6 L1 ids on S (lower bound) and every none-agent lineage ≤ 4 (upper) | any derive-family lineage ≤ 3 of 6 on S (upper bound) | inconclusive |
| H3 latent | I-2 | derive pooled L3 (upper) in [0.45, 0.75], not masked, and ≥ 60% of its pooled L3 misses are owner-only or records-only ids | every derive lineage has ≥ 15/16 L3 on the lower bound and R ≥ 0.95 | inconclusive; rater-dependent when rater 2's L3 reads the band differently |
| H4 ledger | I-3, FCP (b) | Δ = primary(derive-ledger) − primary(derive) ≥ 0.10 and its interval's lower end > 0, neither masked | Δ < 0.03 and the interval's upper end < 0.10, neither masked | inconclusive |
| H5 prior | I-4 | derive-prior: mean F gain ≥ 1 over derive, owner-only gain ≤ 0, ≥ 1 lineage violates NW-RETRY-DECLINED or NW-UNREQUESTED-EMAIL, no derive lineage does | no L4 violation in either derive-prior lineage (the prior's over-reach risk is refuted) | inconclusive |
| H6 authority, recency | I-5 | ≥ 1 of the 4 derive and derive-ledger lineages violates NW-UNAUTHORISED or NW-STALE-SOP | 0 of 4 | inconclusive with fewer than 4 lineages |
| H7 asking | I-6 | derive mean Ask-F1 ≤ 0.5, mean wasted share ≥ 0.30, always-ask Ask-F1 < derive's, no-ask obtains no owner-only id, no-ask within 1 shared case of derive (per-lineage mean) | no-ask pooled L3 ≥ derive's (the owner-only ids were inferable: re-audit the content), unless masked | inconclusive |
| H8 floor | I-7, FCP (c) | every none-agent lineage ≤ 10/14 on S and S-perfect ≥ 0.95 | **both** derive and derive-ledger have a lower pooled pass rate on S than none-agent (building from a messy business is worse than not building) | inconclusive |

Reported without a threshold: per-layer recall under both raters, extras recall, over-reach classes and precision,
Goldilocks, MOI, Completion vs Compliance, ledger review counts, questions, cost, wall time.

## 7. Caps and estimated cost

Every lineage reserves all its bounds against its arm's cap and the total before anything starts; bounds settle at what
was charged; an unsettled reservation counts at its bound; a refusal (exit code 4) spends nothing (`spec1.mjs reserveAll`).

| Arm | Bounds per lineage | Arm cap | Estimate, K = 2 | Basis |
|---|---|---|---|---|
| derive | build $3 + matcher $0.30 | $4.50 | **$1.0–2.1** | B1L-H $0.39–0.62 per build (DESIGN: $0.5–1.0 with the pack and asking); a match about $0.002 |
| derive-ledger | + extraction $0.50 | $5.00 | **$1.0–2.3** | + one extraction call (tracker: $0.13 for an extraction and 78 writes) |
| none-agent | sessions $3 + matcher $0.30 | $6.60 | **$3.0–5.0** | agent-H + V $1.45 reported, $1.85 metered on this world (AGENTV-E8) |
| derive-prior | build $3 + matcher $0.30 | $4.50 | **$1.0–2.1** | as derive |
| no-ask | build $3 | $4.00 | **$0.8–2.0** | as derive, no matcher |
| always-ask | build $3 + matcher $0.30 | $4.50 | **$1.1–2.3** | as derive, 20 questions and more turns |
| **total** | | **$25** (binding) | **$8–16** | DESIGN §9 |

The per-arm caps sum to $29.1; the $25 total binds first. Wall time: about 20–25 min per build plus $0 grading of 10
worlds; about 75 min per agent lineage.

## 8. Commands (from the repository root)

```sh
# $0, before freezing: the tests, one file at a time (the machine is shared)
for f in spec1 score spec1-dry pack owner-sim truth; do nice -n 15 node --test --test-concurrency=1 experiments/specbiz/test/$f.test.mjs; done
node experiments/specbiz/spec1-freeze.mjs          # paste over section 9, set the status line, commit

# paid, SPEC-1 (in this order)
node experiments/specbiz/spec1.mjs --arm derive        --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20
node experiments/specbiz/spec1.mjs --arm none-agent    --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20
node experiments/specbiz/spec1.mjs --arm derive-ledger --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20
# paid, INTENT-1
node experiments/specbiz/spec1.mjs --arm no-ask        --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20
node experiments/specbiz/spec1.mjs --arm always-ask    --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20
node experiments/specbiz/spec1.mjs --arm derive-prior  --pack-seed 1 --lineages 2 --model claude-haiku-5-5 --budget 20

# $0, after: S-perfect in the same record format, then the scores
node experiments/specbiz/spec1.mjs perfect --worlds grading,shared
node experiments/specbiz/score.mjs --json research/intent-20261021/runs/score.json --md research/intent-20261021/runs/SCORE.md
```

The S-perfect regrade must reproduce 3011/3066 on the grading worlds (`perfect` checks it and exits 5 otherwise); a
different count means the oracle drifted, and no reading is made until that is explained. A paid invocation refuses
`--worlds`, `--concurrency`, `--root` and the cap overrides, and needs `--model` (a policy id, and Haiku 5.5).

## 9. Frozen inputs (sha256; `node experiments/specbiz/spec1-freeze.mjs`)

Engine files the in-progress engine bump may touch (`src/executors/claude-code.mjs`, `src/models/*`, `src/journal.mjs`,
`beds/lib/canonical.mjs`) are not frozen here: every result records their sha256 at launch (`stamps`).

<!-- FROZEN-TABLE -->

## 10. What this cannot show (DESIGN §8, plus what the runner adds)

- The owner is a simulator whose truth is SPEC-E, in easy mode (she knows every rule); the messy texts were written by the
  same model family as the arms.
- E8 only, one pack seed, K = 2; dev worlds; our generator.
- Attribution stops at each case's first divergence (hence the two bounds); a shared lid implicates every rule that could
  own it; R4.3 cannot be attributed at all; readings are implicated only through case classes.
- NW-INJECTION is unchecked; NW-STALE-SOP and NW-NEW-AFTER-CANCEL are approximate; notification text is unscored; there
  is no act-level "unscored anticipation" list.
- The S-perfect builds saw SPEC-E at `c013c04c…` (before S10–S15, extra units, not gold); the pack is rendered from the
  current SPEC-E `9fdbc1ee…`.
- always-ask is forced by instruction only; its compliance is measured.
- The ledger review costs the owner no questions; it is reported as burden of its own (entries reviewed).
