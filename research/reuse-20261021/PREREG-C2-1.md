# Pre-registration: C2-1, a proven workflow reused by a separate program, gated by its input and trace profiles

| Field | Value |
|---|---|
| Experiment id | C2-1 (task #43; requirements row A9) |
| Claim tested | C2 (selective reuse), stated in the owner's words: "the same workflow in a separate program can get reused once proven to work". Falsifiable form: a workflow proven in program A, reused byte-identical by a separate program B through a registry keyed by contract hash and gated by profiles of what it was proven on, answers B's items at least as accurately as B rebuilding the sub-workflow from scratch with the same builder (within 3 points), at lower cost and latency per item, and refuses the items where reuse would be wrong |
| Evidence class | **development** (preregistered, but the second program, its suppliers and its oracle are authored by the experimenter; not sealed) |
| Pre-registration commit | the commit that adds this file (FREEZE-C2-1.json records its sha256 and the code hashes) |
| Date | 2026-10-21 |

## 0. What is being reused, by whom

- **Program A, the proven workflow.** SOP-Bench `dangerous_goods`, phase-2 frozen workflow
  (`experiments/sopbench/frozen/p2/dangerous_goods/`, artifact sha256 `8e7b1822…`, frozen in `FREEZE-p2.json`, read only).
  Built once by Haiku 5.5 for $0.028. Its evidence: **20/20 strict on SOP-Bench's 20 dev rows** (build + repair), re-run here
  byte-identical through the SOP-Bench bridge on the dev world (`prove.mjs`; sealed rows are never touched). That is training
  evidence for program A; the SOP-Bench sealed run (in flight, not read) is A's held-out test.
- **Program B, the separate program.** The "Hazmat Shipment Desk" (`program-b.mjs`): books outbound shipments for 12
  suppliers. For every line item it needs the product's hazard class under the same dangerous-goods procedure (the sub-task
  program A's workflow solves); around it B has its own logic in code (hold on any unclassified item; the most severe class
  decides the mode: air ≤ B, sea ≤ C, road always; class D on road needs an escort; reroute when the requested mode is not
  allowed). Each supplier has its own product master and scoring service behind the **same tool contract** (the four
  scoring tools, same names and specifications), served by B's world (`world-b.mjs`, byte-compatible with the SOP-Bench
  bridge: on A's 20 proof rows the frozen workflow makes identical tool calls and receives identical answers in both, 20/20).
- **The registry** (`registry.mjs`): entries keyed by the contract hash (procedure text sha256, canonical tool catalog,
  input and output columns). B asks for the dangerous-goods contract and gets A's entry, with its evidence and two profiles.

## 1. Beds and splits

### 1.1 Items
- Generator `gen-b.mjs` (deterministic from a seed). Per supplier: 15 labelled history products (5 build + 10 repair: what a
  builder may learn from) and 10 shipments of 1–3 items. Component scores: a total drawn uniformly over 4–20, split
  uniformly into four 1–5 scores, 3% zeros. Proof-style documents reuse the 20 proven rows' texts (referenced by row id; the
  texts stay outside the repo, CC BY-NC); GHS and German documents are authored for B.
- **dev manifest** `runs/c2-dev/manifest-dev.json` (seed `c2-dev-1`, sha256 `06191fb4…`): suppliers S0–S6, 70 shipments,
  138 items. Used to develop the harness and to choose the gate (§1.4). Never reported as a result.
- **test manifest** `runs/c2-1/manifest-test.json` (seed `c2-test-1`, sha256 `15f753dc…`): suppliers S0–S6 and H1–H5,
  **120 shipments, 235 items** (S0 18, S1 21, S2 21, S3 20, S4 21, S5 17, S6 19, H1 21, H2 21, H3 21, H4 19, H5 16).
  Generated after the gate was chosen; no arm, gate or the proven entry has run on it before the freeze.

### 1.2 Suppliers (what differs from A's data; known to B's integration team after the fact, invisible to every arm)

| Supplier | Kind | Data | Reusing A's workflow is |
|---|---|---|---|
| S0 | in-profile replica | A's id format, A's document vocabulary, scores 1–5 | right |
| S1 | benign input drift | GHS-style documents | right |
| S2 | harmful input drift | ids `P-NNNNN` | wrong (A keeps §5.1's `P_NNNNN` rule: Unable to Decide) |
| S3 | harmful environment drift | scores stored 1–10 (SOP score = ⌈v/2⌉) | mostly wrong |
| S4 | silent semantic drift | scores stored inverted (6 − s) | mostly wrong; invisible to shape profiles |
| S5 | benign environment drift | three extra fields in every score response | right |
| S6 | in-domain, unproven branches | missing scores (1–3), malformed or unknown ids, blank documents | right if A implements §5 (its proof never exercised these) |
| H1 | held-out: type drift | scores returned as strings | wrong |
| H2 | held-out: field rename | score under `score` | wrong |
| H3 | held-out: id case | ids `p_NNNNN` | wrong |
| H4 | held-out: offset scale | scores stored 0–4 (SOP score = v + 1) | mostly wrong; invisible to shape profiles |
| H5 | held-out: language | German documents | right |

### 1.3 Held-out drift kinds
H1–H5 were defined after the gate was chosen on S0–S6 and before the test manifest was generated, by one rule: one supplier
per standard data-validation drift category not already covered by S1–S6 (schema type change, field rename, value-format
change, unit/offset change, benign language change). They test whether the gate generalises beyond the drifts it was
developed on. The experimenter knew the gate when choosing them; that is stated, not hidden.

### 1.4 Oracle and controls (run before any arm; results recorded here)
- B's oracle (`program-b.mjs` `truthOf`): sop.txt §5.1–5.7 with B's hazard matrix (A 4–8, B 9–12, C 13–16, D 17–20; the
  procedure names no cut-offs) and each supplier's id format and score scale. Its author had read A's workflow before
  writing it; it shares no code with it.
- **Known-good control: passed.** On A's 20 proven rows, B's oracle reproduces SOP-Bench's own labels 20/20.
- **Known-bad control: passed.** A constant answer ("Hazard Class D") does not (it matches 8/20).
- **Host parity: passed.** The frozen workflow on A's 20 proof rows in B's world: identical tool call sequences, contents
  and answers to the SOP-Bench bridge, 20/20.
- By construction, B's bands equal A's workflow's bands; totals 8 and 10–14 are not pinned by A's evidence. Every accuracy is
  therefore also reported on the **pinned subset** (items whose true total is 0, 4–7, 9 or 15–20).

### 1.5 The gate (chosen on dev, frozen)
Two checks over the JIT input profiles (`experiments/jit/profile.mjs`, unchanged; learned with `PARAMS_V2`), both generic:
- **G2, input profile** (pre-run, $0): the item's inputs against the profile of A's 20 proven inputs, `TOLERANT_CHECK`.
- **G3, trace profile** (post-run, $0, sound only for effect-free tools): the run's tool results, section path, flags and
  answer against the profile of A's 20 proving runs, ignoring added fields (`new-path`): an additive response field is a
  compatible change; a missing field, a new type, a value out of range, an error or an answer the proof never produced is not.

Dev results that chose it (138 items; accepted / wrong accepted / false deopts):

| Gate | Accepted | Wrong accepted | False deopts | Harmful caught |
|---|---|---|---|---|
| b0 none | 138 | 54 | 0 | 0.00 |
| b1 G2 only | 115 | 33 | 2 | 0.39 |
| b2 G2 + strict G3 | 64 | 21 | 41 | 0.61 |
| **b3 G2 + G3 (primary)** | **86** | **21** | **19** | **0.61** |
| clairvoyant | 84 | 0 | 0 | 1.00 |

Rule used: fewest wrong accepted, then fewest false deopts (b2 and b3 tie on wrong, b3 has 22 fewer false deopts, all S5).
On dev, every wrong acceptance under b3 is S3 (5: values ≤ 7 pass the range margin) or S4 (16: invisible).

## 2. Arms

Models from `policy/models.json` (2026-10-21.2): `claude-haiku-5-5` through the Claude CLI executor for the builder and the
agent. A's workflow and the builds make no model call at run time unless a build adds `flow.judge` (then Haiku, $0.05 cap per
run). Frozen hashes of every file that decides an answer, a gate verdict or a metric: `FREEZE-C2-1.json`.

| Arm | Definition | Per item | Budget |
|---|---|---|---|
| **REUSE** (primary) | registry lookup by contract hash → A's entry → G2 → run → G3. Accept: A's answer. Refuse: **deopt to rebuild**: the supplier's build from SCRATCH (same lineage), built at the supplier's first refusal and reused for its later refusals | $0 run (+ builds for suppliers with a refusal) | builds as SCRATCH |
| REUSE-sticky | as REUSE; after a supplier's first refusal every later item of it goes to the build | | |
| REUSE-b0 / -b1 / -b2 | no gate / G2 only / G2 + strict G3 (ablations of the gate) | | |
| REUSE-oracle | clairvoyant gate (ceiling) | | |
| **SCRATCH** | B builds its own sub-workflow per supplier with the **same builder**: SOP-Bench phase-2's loop (`build-b.mjs`; same prompts imported byte-identical, Haiku 5.5, effort high, Bash/Read/Write/Edit/Glob/Grep, the same kit and SDK, ≤ 2 repair rounds, keep-only-if-no-row-lost) on the supplier's 5 build + 10 repair labelled products; the build runs on all the supplier's items | $0 run | $1.00 build + $0.50 per repair session (SOP-Bench: $3 / $1.50) |
| **AGENT** | one Haiku 5.5 session per item with SOP-Bench's A-H prompts, tool client and limits (Bash only, 10 tool steps, 10 min) | one session | $0.25 reservation |

Held constant: the procedure text, the tool contract and B's world per supplier, the items, the oracle, the strict scorer
(SOP-Bench's), HSD's composition code. The builds (SCRATCH) and the deopt builds (REUSE) are the same artifacts (paired by
lineage); REUSE differs from SCRATCH only where the gate accepts.

## 3. Measurements
- **Primary:** item accuracy (strict, SOP-Bench scorer) on the 235 test items, per arm.
- Secondary: accuracy on the pinned subset; shipment decision accuracy (HSD's decision from the arm's classes equals the
  decision from the true classes); holds; **wrong bookings** (a wrong decision that is not a hold); per supplier; dev-known
  (S0–S6) vs held-out (H1–H5).
- Reuse: reuse rate (accepted / items), deopt rate, **wrong-reuse rate** (accepted and wrong / accepted), false-deopt rate
  (refused though A was right / refused), catch rate (refused / items where A is wrong).
- **M3 rule** (ATTACK-20261014 §3; `experiments/lib/stats.mjs`): on the primary gate's admitted decisions, the one-sided 95%
  exact bound on parent-clustered (`reuseBoundRule`, method exact, the M3 choice "aE") and parent × entry crossed counts
  (`reuseBoundRule2`, the amended L4 rule M3b), ≥ 60 admitted. Only `serve` turns reuse on.
- Cost: USD per item = (builds the arm paid + agent spend) / items; with projections at 100 and 1,000 items per supplier
  (labelled as projections). Latency: per-item wall time (workflow run in the sandbox incl. gate checks; agent session),
  build wall time, and the amortised mean including builds.
- Unit: item, clustered by shipment (paired bootstrap over shipments, B = 10,000, seed `c2-boot`).

## 4. Power
235 items in 120 shipments. Build lineages K = 2 and agent repetitions K = 2 if the budget allows (order in §7), otherwise 1.
No power analysis supports a comparative claim at this K: every comparison is **directional development evidence**; gaps
under 3 points are noise.

## 5. Analysis and decision rules
`experiments/reuse/analyze.mjs` (sha256 in the freeze).
- **D1, may this gate serve reuse?** M3b crossed rule returns `serve`. Prediction: **no** (S4 and H4 are invisible to shape
  profiles, and one entry gives the entry axis no information; dev gave `kill` on the parent rule).
- **D2, REUSE vs SCRATCH accuracy:** non-inferior if the paired 95% interval of REUSE − SCRATCH lies above −0.03, per lineage.
- **D3, REUSE vs AGENT accuracy:** better / worse if the paired interval excludes 0.
- **D4, cost and latency:** REUSE's USD and mean latency per item (with builds) below SCRATCH's and AGENT's at the run's size.
- **D5, generalisation of the gate:** catch rate on harmful held-out items (H1–H4) and false-deopt rate on H5, against the
  same on dev-known kinds.

Predictions (recorded before the test run): REUSE ≈ SCRATCH on accuracy except S4 and H4 (REUSE wrong, SCRATCH can learn the
inversion or offset from labelled examples); REUSE cheaper than SCRATCH (fewer builds); AGENT poor on every harmful supplier
(it sees no label) and close to perfect on S0; at about 20 items per supplier a build ($0.03–0.10) costs about as much as
the agent on those items ($0.0014 each), so the cost win over the agent appears only with volume.

## 6. Kill rule
- Stop before the paid phases if A's entry is below 95% on the test S0 items (a harness defect, not a finding).
- An environment fault (rate or usage limit, sandbox) stops a phase; it is resumed, never scored.
- Spend cap $2.90 for the whole experiment (the brief's $3), enforced by one ledger (`LIVE_ROOT/spend.jsonl`); a phase that
  meets it stops, and only complete lineages / repetitions enter the arm table.

## 7. Cost
Order of paid work: builds lineage 1 (12 suppliers) → agent k = 1 (235 items) → builds lineage 2 → agent k = 2.
Estimate: builds 12 × $0.03–0.10 = $0.4–1.2 per lineage (dev smoke: S2 $0.054 with one repair); agent 235 × ≈ $0.0014 ≈
$0.33 per repetition (dev smoke: $0.0008–0.0019 per item). Total ≈ $1.5–3.0; the cap binds first if builds run long.
Spent before the freeze (dev smoke, development evidence): **$0.0598** (one S2 build $0.0542, four agent items $0.0055).

## 8. Threats to validity
- **Self-authored second program.** The experimenter wrote B, its suppliers, its oracle and the gate. The held-out drift
  kinds narrow, not remove, this. The SOP-Bench sealed run is A's independent test; nothing here substitutes for it.
- **One proven entry, one procedure.** Wrong reuse clusters by entry; with one entry, no rule can bound the rate over
  entries the gate has not seen (M3b). A second pairing (another SOP) is the next step.
- **Bands by construction** (§1.4): pinned-subset accuracy is reported beside every accuracy.
- **G3 needs effect-free tools** (it runs before deciding). For effectful sub-workflows it would need a dry-run world.
- **Supplier mix is a design choice.** Pooled rates depend on it; every rate is also reported per supplier.
- **K ≤ 2** lineages and repetitions: build variance is visible but not estimated.
- Contamination: builders and agents never see B's oracle, the test items' labels, or any other supplier's data; builders
  see only their supplier's 15 labelled products. SOP-Bench-derived text never enters the repo.

## Amendments
(dated entries only)
