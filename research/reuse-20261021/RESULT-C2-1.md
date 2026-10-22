# RESULT C2-1: a proven workflow reused by a separate program, gated by its profiles (2026-10-21/22)

*Development evidence. Preregistered in [PREREG-C2-1.md](PREREG-C2-1.md) (commit `e608f180`) and frozen in
[FREEZE-C2-1.json](FREEZE-C2-1.json) (commit `997f539d`: code, manifest `15f753dc…`, proven entry and prereg hashes) before any
test-set run; the frozen code still matches the freeze (the analysis checks it). The second program, its 12 suppliers and
its oracle were written by the experimenter, so nothing here is sealed or claim-bearing. Every per-item record is under
`/var/tmp/foundry-work/reuse-c2/c2-1/test/` (SOP-Bench-derived text, kept out of the repo); aggregates are in
[runs/c2-1/](runs/c2-1/). The follow-up that tests this result's post-hoc fix, preregistered, is
[RESULT-C2-2.md](RESULT-C2-2.md).*

## 1. What ran

- **Program A (the proven workflow):** SOP-Bench `dangerous_goods`, phase-2 frozen workflow (Haiku-built for $0.028, read
  only), 20/20 strict on SOP-Bench's dev rows, re-proved byte-identical through the SOP-Bench bridge (`prove.mjs`).
- **Program B (the separate program):** the Hazmat Shipment Desk (`program-b.mjs`): books shipments for 12 suppliers and needs
  each line item's hazard class under the same procedure; its own code holds, picks the mode, reroutes and escorts.
- **Registry** (`registry.mjs`): append-only, keyed by contract hash (procedure text, canonical tool catalog, input and output
  columns). B asks for the dangerous_goods contract and gets A's entry with its evidence and two profiles.
- **Gate (preregistered primary b3):** G2, the item's inputs against the profile of A's 20 proven inputs ($0, before the run),
  and G3, the run's tool results, section path, flags and answer against the profile of A's 20 proving runs ($0, after the
  run, sound for effect-free tools). Accept: A's answer. Refuse: deopt to the supplier's rebuild.
- **Baselines:** SCRATCH, B rebuilds the sub-workflow per supplier with the **same builder** (SOP-Bench phase 2's loop,
  Haiku 5.5, on the supplier's 15 labelled history products); AGENT, one Haiku 5.5 session per item with SOP-Bench's prompts.
- **Items:** 235 test items in 120 shipments (S0–S6 dev-known drift kinds, H1–H5 held-out kinds). K = 2 build lineages,
  K = 2 agent repetitions, all complete.

Lineage 2 and agent repetition 2 stopped on `MODEL_RATE_LIMIT` at 2026-10-21 23:29 Z (2 builds, 2 agent sessions); by the
prereg (§6) they were resumed at 02:11 Z and never scored. The faulted records stay in the ledger and the build table, and
the faulted build directories are preserved (`build/S3-L2.envfault-…`, `build/S4-L2.envfault-…`).

## 2. Capability against the baselines

| Arm | Item accuracy L1 / L2 (k1 / k2) | Wrong bookings | Reuse rate | Wrong reuse | USD per item | USD per correct item | Time per item incl. builds |
|---|---|---|---|---|---|---|---|
| **REUSE**, preregistered gate b3 | 200/235 = 85.1% / 201 = 85.5% | 19 / 18 | 47.7% | 32 of 112 (28.6%) | $0.0017 / $0.0013 | $0.0020 / $0.0015 | 9.2 s / 8.2 s |
| **SCRATCH**, same builder, every supplier | 230 = 97.9% / 231 = 98.3% | 3 / 2 | – | – | $0.0026 / $0.0024 | $0.0026 / $0.0024 | 13.3 s / 13.8 s |
| **AGENT**, Haiku per item | 134 = 57.0% / 133 = 56.6% | 17 / 11 (holds 45 / 50) | – | – | $0.0013 / $0.0010 | $0.0024 / $0.0019 | 11.4 s / 9.4 s |
| REUSE, clairvoyant gate (ceiling) | 230 = 97.9% / 233 = 99.1% | 3 / 1 | 43.0% | 0 | $0.0018 / $0.0015 | | 9.8 s / 9.5 s |
| *REUSE, post-hoc gate G0* (§5) | *230 = 97.9% / 231 = 98.3%* | | *38.7%* | *0 of 91* | *$0.0018 / $0.0015* | *$0.0018 / $0.0015* | *10.0 s / 9.7 s* (incl. conformance runs) |

USD includes every build an arm paid (SCRATCH 12 per lineage, REUSE 7: the suppliers with a refusal) and agent spend; the
proven entry runs at $0. At about 20 items per supplier a build ($0.03–0.15) is worth 25–100 agent items, so REUSE beats the
agent on time and on cost per correct answer but not on cost per item. Projected at 1,000 items per supplier (from the
measured unit costs; a projection, not a measurement): REUSE $0.00003 and 1.2–1.4 s per item, SCRATCH $0.00005 and 0.7–1.2 s
(its builds run faster than the entry plus the gate checks), AGENT $0.0010–0.0013 and 9–11 s.

## 3. Preregistered decisions

| Rule | Prediction | Result |
|---|---|---|
| D1: may b3 serve reuse (M3b crossed returns `serve`)? | no | **no**: M3b `kill` (upper 0.618, one entry); parent-clustered aE `kill` (upper 0.394, 32 wrong of 112 admitted) |
| D2: REUSE non-inferior to SCRATCH (paired 95% interval above −3 pts), per lineage | ≈ SCRATCH except S4 and H4 | **fails, both lineages: REUSE is inferior.** L1 −12.8 pts [−18.9, −7.2], L2 −12.8 [−19.0, −7.1]. The deficit is exactly the wrong reuses: S4 21, H4 7, S3 4 |
| D3: REUSE vs AGENT | AGENT poor on harmful suppliers | **REUSE better**, +28.1 to +28.9 pts, every interval excludes 0 (L1 vs k1 [20.4, 36.1]) |
| D4: REUSE USD and latency per item below SCRATCH and AGENT | cheaper than SCRATCH; cost win over the agent only with volume | below SCRATCH on both, both lineages; below AGENT on time (9.2 / 8.2 s vs 11.4 / 9.4 s) and on USD per correct item, **not** on USD per item at this volume ($0.0017 / $0.0013 vs $0.0013 / $0.0010) |
| D5: does the gate generalise to held-out drift kinds? | – | catch rate on harmful held-out items 70/77 = 90.9% (H1, H2, H3 all; H4 7 of 14) against 32/57 = 56.1% on dev-known harmful kinds; 0 false deopts on H5 (German). It generalises to **shape** drift (types, field names, id case) and not to **meaning** drift (H4 offset, as S4 inversion on dev) |

## 4. Root causes of every failure

- **Wrong reuse (32 per lineage), the decisive failure.** A profile of what the producer saw describes form, not meaning.
  S4 stores scores inverted (6 − s): every value is an integer 1–5, inside the proven range, so G3 accepts all 21 and all
  21 are wrong. H4 stores scores 0–4 (SOP = v + 1): every value sits inside the proven range (A's proven rows include zero scores); A
  reads each component one low, so D becomes C, C becomes B, B becomes A (7 of 11 accepted wrong); items with three or more
  zeros answer Unable to Decide, outside the proven answers, and are refused. S3 stores 1–10: G3's number-range margin admits
  values up to 6, so items whose stored values all stay ≤ 6 are accepted and over-classified (4 of 8 accepted wrong).
  Predicted in the prereg (§1.5, D1) for S4 and H4; S3 behaved as on dev (5 wrong accepted there, 4 here).
- **False deopts (21).** All 19 S6 items (A is right on every one): S6 exercises branches A's proof never reached (missing
  scores, malformed or unknown ids, blank documents), so G3 sees missing paths and an answer, Unable to Decide, that the 20
  proving runs never produced. The gate is right that these branches were unproven; it cannot know that A implements them
  correctly. The rest: 1 H4 and 1 S3 item that A got right by coincidence.
- **SCRATCH's residual errors (5 in L1, 4 in L2), all band-edge misclassifications on scale-drift suppliers.** Each failing
  build reached 15/15 on the supplier's labelled history with a rule that is right on those 15 and wrong at a band edge it
  never saw. H4-L1 did not find the +1 offset: it treated zeros as imputable, imputed with the mean ("the SOP says the max,
  but the examples rule that out") and shifted its class floors to 7/11/15 on raw totals (true: 5/9/13). S3-L2 found that
  scores are doubled but banded the raw sum (A ≤ 15, B ≤ 23, …) instead of halving each component with rounding up, so raw
  2, 3, 9, 9 (true 1 + 2 + 5 + 5 = 13, C) became 23, B. H4-L2 chose floors 6/9/15 (true 5/9/13). Root cause: 15 labelled
  examples underdetermine the conversion, and the builder's acceptance test is those same 15. A held-out slice of B's
  history (C2-2 has 60 per supplier) would catch these builds before deployment.
- **AGENT (57%).** It never sees a label, so it follows the procedure literally: §5.1's id format makes it answer Unable to
  Decide on every S2 and H3 item (0/42 per repetition), and it reads S3's 1–10 values as invalid and answers Unable on most.
  On the suppliers where literal reading is right (S0, S1, S5, S6, H1, H2, H5) it scores 126/133 = 94.7% in both
  repetitions; 13 of its 14 errors there are Unable to Decide, mostly because §5.7 names classes but no cut-offs and the agent
  declines to invent them (one declines to impute a blank document). This is an information gap by design (B's conventions live only in B's labelled history), not a model
  defect: the agent is the "no history" baseline.
- **Session rate limit (environment).** Lineage 2 and agent repetition 2 hit `MODEL_RATE_LIMIT` while the main tree ran the
  SOP-Bench sealed run and other paid experiments on the same account; recorded as faults, resumed 2 h 40 min later at
  concurrency 1 (builds) and 2 (agent), never scored. $0.0350 was spent on the faulted sessions.

## 5. Post-hoc, then preregistered: consumer conformance

Conceived after the dev and test gate results (not preregistered in C2-1): before B reuses A's entry for a supplier, run it
on that supplier's 15 labelled history products ($0) and admit it only if it reproduces every label (`posthoc.mjs`, G0).
On C2-1's test set: 91 accepted, **0 wrong**, 10 false deopts (5 S3 and 5 H4 items A got right by coincidence), 7 builds;
REUSE-G0 equals SCRATCH's accuracy in both lineages (230 and 231) at $0.0018 / $0.0015 per item instead of $0.0026 / $0.0024.
M3 aE on its admitted decisions: `serve` (upper 0.036); M3b `no-decision` (one entry).

Because that is post-hoc, it was tested in a separate preregistered experiment, **C2-2** ([RESULT-C2-2.md](RESULT-C2-2.md), $0,
fresh suppliers, 60 history labels each, four supplier kinds designed against it): the M3 rule on the history plus a per-run
check against A's proof widened with B's conforming history made **0 wrong reuses in 98 accepted items on fresh suppliers of
every C2-1 kind** (M3 `serve`, upper 0.034; b3 on the same items: 38 wrong of 123), and failed, as predicted, on a supplier
whose scale changed after the history (17 of 17 accepted, all wrong).

## 6. Honest reading

- **The owner's definition holds, with a correction to what "proven" means.** A workflow proven in program A was reused,
  byte-identical, by a separate program through a contract-hash registry, and on the suppliers where reuse was right it was
  right on every item at $0 per run (S0, S1, S5, H5: 72 of 72; plus S6 when admitted). But **proof in the producer's
  program is not proof in the consumer's**: gating on the producer's evidence (b3) was inferior to rebuilding by 12.8 points
  in both lineages and let 28.6% of accepted items through wrong. The gate that works is proof in the consumer's program
  (its own labelled history), which C2-2 confirmed preregistered.
- **Capability number (dev):** preregistered REUSE 85.1 / 85.5% vs SCRATCH 97.9 / 98.3% vs AGENT 57.0 / 56.6%; post-hoc
  REUSE-G0 97.9 / 98.3% at 60–70% of SCRATCH's cost. K = 2 lineages and K = 2 repetitions: the gate's decisions are deterministic
  (identical in both lineages), and the two lineages' builds differ by at most 3 items on any supplier.
- **What it does not show.** Program B, its 12 suppliers, its oracle and the gate are mine; the band cut-offs are B's by
  construction (pinned-subset accuracy is within 1.5 points of the full accuracy for every arm). One entry and one procedure:
  no rule can bound wrong reuse across entries (M3b). Nothing here is sealed; the SOP-Bench sealed run is A's independent
  test and is not read here.
- **Cost.** $0.533 in this session (lineage-2 builds and agent repetition-2 resume); $1.82 for C2-1 in total including the
  dev smoke ($0.06) and $0.035 lost to the rate-limit fault; C2-2 $0. Brief cap $3; experiment ledger cap $2.90.

## 7. Next

1. Monitoring of admitted reuse: spot-check labels on a sample of reused answers per supplier and revoke on the M3 bound or
   a CUSUM (ATTACK-20261014 M9); this is the only defence against drift after the history (C2-2 T1).
2. A second proven entry (another SOP-Bench procedure) reused by B, so M3b's entry axis has information.
3. Gate rebuilt workflows the same way: a build proven on 15 labels and checked on held-out history before it serves.
4. Move the registry and the conformance gate from `experiments/reuse/` into `src/` only after 1–3 (no new subsystem without
   the experiment that needs it).

## 8. Reproduce

```
node experiments/reuse/c2.mjs analyze --run-id c2-1 --set test     # arms, metrics, M3 (needs LIVE_ROOT records)
node experiments/reuse/posthoc.mjs --run-id c2-1 --set test        # post-hoc G0 ($0)
node experiments/reuse/report.mjs --run-id c2-1 --set test         # the tables below
nice -n 15 node --test --test-concurrency=1 experiments/reuse/test/reuse.test.mjs   # 13 tests
```

## 9. Full tables (generated by `report.mjs`)

#### Arms (235 items, 120 shipments; lineages 1, 2; agent reps 1, 2)

| Arm | Item acc | Pinned acc | Ship acc | Wrong bookings | Holds | Reuse | Wrong reuse | Deopt | False deopt | Builds paid | USD total | USD/item | Mean ms/item (no builds) | Mean/item incl. builds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REUSE@L1 | 200/235 = 85.1% | 84.1% | 84.2% | 19 | 7 | 47.7% | 32 (28.6%) | 52.3% | 21 (17.1%) | 7 | $0.4089 | $0.0017 | 1.3 s | 9.2 s |
| REUSE-sticky@L1 | 208/235 = 88.5% | 87.8% | 88.3% | 14 | 7 | 40.4% | 23 (24.2%) | 59.6% | 29 (20.7%) | 7 | $0.4089 | $0.0017 | 0.9 s | 8.9 s |
| REUSE-b0@L1 | 101/235 = 43.0% | 43.9% | 42.5% | 18 | 58 | 100.0% | 134 (57.0%) | 0.0% | 0 (–) | 0 | $0.0000 | $0.0000 | 0.9 s | 0.9 s |
| REUSE-b1@L1 | 122/235 = 51.9% | 52.4% | 50.8% | 18 | 48 | 90.6% | 113 (53.1%) | 9.4% | 1 (4.5%) | 2 | $0.0938 | $0.0004 | 0.9 s | 2.9 s |
| REUSE-b2@L1 | 200/235 = 85.1% | 84.1% | 84.2% | 19 | 7 | 40.4% | 32 (33.7%) | 59.6% | 38 (27.1%) | 8 | $0.4420 | $0.0019 | 1.4 s | 10.0 s |
| REUSE-oracle@L1 | 230/235 = 97.9% | 97.6% | 97.5% | 3 | 7 | 43.0% | 0 (0.0%) | 57.0% | 0 (0.0%) | 7 | $0.4250 | $0.0018 | 1.4 s | 9.8 s |
| SCRATCH@L1 | 230/235 = 97.9% | 97.6% | 97.5% | 3 | 7 | – | – | – | – | 12 | $0.6077 | $0.0026 | 1.0 s | 13.3 s |
| REUSE@L2 | 201/235 = 85.5% | 85.4% | 85.0% | 18 | 7 | 47.7% | 32 (28.6%) | 52.3% | 21 (17.1%) | 7 | $0.3096 | $0.0013 | 1.1 s | 8.2 s |
| REUSE-sticky@L2 | 208/235 = 88.5% | 88.4% | 88.3% | 14 | 7 | 40.4% | 23 (24.2%) | 59.6% | 29 (20.7%) | 7 | $0.3096 | $0.0013 | 0.7 s | 7.8 s |
| REUSE-b0@L2 | 101/235 = 43.0% | 43.9% | 42.5% | 18 | 58 | 100.0% | 134 (57.0%) | 0.0% | 0 (–) | 0 | $0.0000 | $0.0000 | 0.9 s | 0.9 s |
| REUSE-b1@L2 | 122/235 = 51.9% | 52.4% | 50.8% | 18 | 48 | 90.6% | 113 (53.1%) | 9.4% | 1 (4.5%) | 2 | $0.0927 | $0.0004 | 0.9 s | 3.4 s |
| REUSE-b2@L2 | 201/235 = 85.5% | 85.4% | 85.0% | 18 | 7 | 40.4% | 32 (33.7%) | 59.6% | 38 (27.1%) | 8 | $0.3470 | $0.0015 | 1.1 s | 9.0 s |
| REUSE-oracle@L2 | 233/235 = 99.1% | 99.4% | 99.2% | 1 | 7 | 43.0% | 0 (0.0%) | 57.0% | 0 (0.0%) | 7 | $0.3529 | $0.0015 | 1.2 s | 9.5 s |
| SCRATCH@L2 | 231/235 = 98.3% | 98.2% | 98.3% | 2 | 7 | – | – | – | – | 12 | $0.5566 | $0.0024 | 0.5 s | 13.8 s |
| AGENT@k1 | 134/235 = 57.0% | 56.1% | 54.2% | 17 | 45 | – | – | – | – | 0 | $0.3156 | $0.0013 | 11.4 s | 11.4 s |
| AGENT@k2 | 133/235 = 56.6% | 55.5% | 55.0% | 11 | 50 | – | – | – | – | 0 | $0.2461 | $0.0010 | 9.4 s | 9.4 s |

#### Projected cost and time per item at N items per supplier (projection from measured unit costs)

| Arm | N=20 USD | N=100 USD | N=1000 USD | N=20 time | N=100 time | N=1000 time |
|---|---|---|---|---|---|---|
| REUSE@L1 | $0.0017 | $0.0003 | $0.0000 | 9.1 s | 2.8 s | 1.4 s |
| SCRATCH@L1 | $0.0025 | $0.0005 | $0.0001 | 13.0 s | 3.4 s | 1.2 s |
| REUSE@L2 | $0.0013 | $0.0003 | $0.0000 | 8.1 s | 2.5 s | 1.2 s |
| SCRATCH@L2 | $0.0023 | $0.0005 | $0.0000 | 13.5 s | 3.1 s | 0.7 s |
| AGENT@k1 | $0.0013 | $0.0013 | $0.0013 | 11.4 s | 11.4 s | 11.4 s |
| AGENT@k2 | $0.0010 | $0.0010 | $0.0010 | 9.4 s | 9.4 s | 9.4 s |

#### Per supplier: items correct (REUSE route reuse/deopt; wrong reuse)

| Supplier | Kind | REUSE@L1 | SCRATCH@L1 | REUSE@L2 | SCRATCH@L2 | AGENT@k1 | AGENT@k2 |
|---|---|---|---|---|---|---|---|
| S0 | in-profile replica | 18/18 (r18) | 18/18 | 18/18 (r18) | 18/18 | 16/18 | 18/18 |
| S1 | benign input drift (GHS text style) | 21/21 (r21) | 21/21 | 21/21 (r21) | 21/21 | 20/21 | 20/21 |
| S2 | harmful input drift (id format P-NNNNN) | 21/21 (r0) | 21/21 | 21/21 (r0) | 21/21 | 0/21 | 0/21 |
| S3 | harmful environment drift (scores stored 1-10) | 16/20 (r8, w4) | 20/20 | 14/20 (r8, w4) | 18/20 | 3/20 | 3/20 |
| S4 | silent semantic drift (scores stored inverted) | 0/21 (r21, w21) | 21/21 | 0/21 (r21, w21) | 21/21 | 0/21 | 0/21 |
| S5 | benign environment drift (extra response fields) | 17/17 (r17) | 17/17 | 17/17 (r17) | 17/17 | 15/17 | 16/17 |
| S6 | in-domain unproven branches (missing scores, bad ids, blank documents) | 19/19 (r0) | 19/19 | 19/19 (r0) | 19/19 | 18/19 | 17/19 |
| H1 | held-out: type drift (scores returned as strings) | 21/21 (r0) | 21/21 | 21/21 (r0) | 21/21 | 21/21 | 19/21 |
| H2 | held-out: field rename (score under "score") | 21/21 (r0) | 21/21 | 21/21 (r0) | 21/21 | 20/21 | 21/21 |
| H3 | held-out: id case drift (p_NNNNN) | 21/21 (r0) | 21/21 | 21/21 (r0) | 21/21 | 0/21 | 0/21 |
| H4 | held-out: offset scale (scores stored 0-4) | 9/19 (r11, w7) | 14/19 | 12/19 (r11, w7) | 17/19 | 5/19 | 4/19 |
| H5 | held-out: language drift (German documents) | 16/16 (r16) | 16/16 | 16/16 (r16) | 16/16 | 16/16 | 15/16 |

#### Gate view on the proven entry (all items, $0)

| Gate | Accepted | Wrong accepted | Wrong-reuse rate | Deopt | False deopt | Catch rate | dev-known: acc / wrong / false deopt | held-out: acc / wrong / false deopt |
|---|---|---|---|---|---|---|---|---|
| b0 | 235 | 134 | 57.0% | 0 | 0 | 0.0% | 137 / 57 / 0 | 98 / 77 / 0 |
| b1 | 213 | 113 | 53.1% | 22 | 1 | 15.7% | 115 / 36 / 1 | 98 / 77 / 0 |
| b2 | 95 | 32 | 33.7% | 140 | 38 | 76.1% | 68 / 25 / 37 | 27 / 7 / 1 |
| b3 (primary) | 112 | 32 | 28.6% | 123 | 21 | 76.1% | 85 / 25 / 20 | 27 / 7 / 1 |
| oracle | 101 | 0 | 0.0% | 134 | 0 | 100.0% | 80 / 0 / 0 | 21 / 0 / 0 |

#### M3 rule on the primary gate's 112 admitted decisions (32 wrong)

- parent-clustered exact (aE): **kill**, upper 0.394, n_eff 62.3, Deff 1.80
- parent × entry crossed exact (M3b): **kill**, upper 0.618, n_eff 8.7, Deff 12.90, entries 1

#### Paired differences in item accuracy (shipment-cluster bootstrap, 95%)

| A − B | point | 95% interval |
|---|---|---|
| REUSE@L1 − SCRATCH@L1 | -12.8 pts | [-18.9, -7.2] |
| REUSE@L1 − AGENT@k1 | 28.1 pts | [20.4, 36.1] |
| REUSE@L1 − AGENT@k2 | 28.5 pts | [20.6, 36.6] |
| REUSE@L2 − SCRATCH@L2 | -12.8 pts | [-19.0, -7.1] |
| REUSE@L2 − AGENT@k1 | 28.5 pts | [20.9, 36.5] |
| REUSE@L2 − AGENT@k2 | 28.9 pts | [21.1, 37.1] |
| SCRATCH@L1 − AGENT@k1 | 40.9 pts | [32.5, 49.6] |
| SCRATCH@L2 − AGENT@k1 | 41.3 pts | [32.9, 49.8] |
| SCRATCH@L1 − AGENT@k2 | 41.3 pts | [32.7, 50.0] |
| SCRATCH@L2 − AGENT@k2 | 41.7 pts | [33.3, 50.4] |

#### Builds

| Build | USD | Wall | Rounds | Best round | Labelled pass | Judge calls/run |
|---|---|---|---|---|---|---|
| S0-L1 | $0.0313 | 2.7 min | 1 | 0 | 15/15 | 0 |
| S1-L1 | $0.0356 | 2.8 min | 1 | 0 | 15/15 | 0 |
| S2-L1 | $0.0404 | 3.2 min | 1 | 0 | 15/15 | 0 |
| S3-L1 | $0.0526 | 4.8 min | 2 | 1 | 15/15 | 0 |
| S5-L1 | $0.0331 | 2.6 min | 1 | 0 | 15/15 | 0 |
| S4-L1 | $0.0695 | 6.4 min | 2 | 1 | 15/15 | 0 |
| S6-L1 | $0.0534 | 4.8 min | 2 | 1 | 15/15 | 0 |
| H1-L1 | $0.0361 | 3 min | 1 | 0 | 15/15 | 0 |
| H2-L1 | $0.0321 | 2.8 min | 1 | 0 | 15/15 | 0 |
| H3-L1 | $0.0415 | 3.5 min | 1 | 0 | 15/15 | 0 |
| H5-L1 | $0.0292 | 2.6 min | 1 | 0 | 15/15 | 0 |
| H4-L1 | $0.1529 | 9.1 min | 2 | 1 | 15/15 | 0 |
| S0-L2 | $0.0332 | 2.8 min | 1 | 0 | 15/15 | 0 |
| S1-L2 | $0.0330 | 5.5 min | 1 | 0 | 15/15 | 0 |
| S2-L2 | $0.0317 | 5 min | 1 | 0 | 15/15 | 0 |
| S3-L2 | $0.0346 | 5 min | 1 | – | 0/15 (failed) (env MODEL_RATE_LIMIT) | – |
| S4-L2 | $0.0000 | 2.6 min | 1 | – | 0/15 (failed) (env MODEL_RATE_LIMIT) | – |
| S3-L2 | $0.0563 | 4.9 min | 2 | 1 | 15/15 | 0 |
| S4-L2 | $0.1044 | 9.7 min | 2 | 1 | 15/15 | 0 |
| S5-L2 | $0.0375 | 3 min | 1 | 0 | 15/15 | 0 |
| S6-L2 | $0.0610 | 5 min | 2 | 1 | 15/15 | 0 |
| H1-L2 | $0.0280 | 2.3 min | 1 | 0 | 15/15 | 0 |
| H2-L2 | $0.0440 | 3.5 min | 1 | 0 | 15/15 | 0 |
| H3-L2 | $0.0308 | 2.6 min | 1 | 0 | 15/15 | 0 |
| H4-L2 | $0.0578 | 4.8 min | 2 | 1 | 15/15 | 0 |
| H5-L2 | $0.0389 | 3.1 min | 1 | 0 | 15/15 | 0 |

#### POST-HOC (not preregistered): consumer conformance on B's labelled history before reuse

Per supplier, the proven entry on its 15 labelled products: S0 15/15, S1 15/15, S2 0/15, S3 4/15, S4 0/15, S5 15/15, S6 15/15, H1 0/15, H2 0/15, H3 0/15, H4 8/15, H5 15/15.

| Gate | Accepted | Wrong accepted | False deopt | Catch rate | M3 parent (aE) | M3 crossed (M3b) |
|---|---|---|---|---|---|---|
| G0 | 91 | 0 | 10 | 100.0% | serve (0.036) | no-decision (0.283) |
| G0+b3 | 72 | 0 | 29 | 100.0% | serve (0.045) | no-decision (0.289) |
| b3 | 112 | 32 | 21 | 76.1% | kill (0.394) | kill (0.618) |

Spend: builds $1.1989, agent $0.5617 over 470 sessions (0 session errors, 0 without an answer, 0 with audit flags).

