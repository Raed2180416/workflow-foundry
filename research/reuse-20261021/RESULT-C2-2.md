# RESULT C2-2: consumer conformance as the reuse gate, on fresh suppliers and on its blind spots (2026-10-22)

*Development evidence, $0. Preregistered in [PREREG-C2-2.md](PREREG-C2-2.md) (commit `5d334ba2`) and frozen in
[FREEZE-C2-2.json](FREEZE-C2-2.json) (commit `cdf01e7b`: code, manifest `8d2a2bf1…`, prereg hashes) before any run on its
items. Program B, its suppliers and the four blind-spot kinds were written by the experimenter, so nothing here is sealed.
Per-run records (with traces; they hold SOP-Bench-derived text) are under `/var/tmp/foundry-work/reuse-c2/c2-2/`;
aggregates in [runs/c2-2/summary-c22.json](runs/c2-2/summary-c22.json). No amendment was needed.*

Run: `node experiments/reuse/c22.mjs run` then `analyze` (960 history runs and 320 stream runs, all `done`, 279 s at
concurrency 3; no model call). Unit tests: `experiments/reuse/test/c22.test.mjs` (4 tests).

## 0. Review corrections (dated 2026-11-04)

*An adversarial review of C2-1 and C2-2 (2026-11-04) found that this file's "M3 serve" claim rests on the wrong cluster
unit and that its main prediction could hardly fail. The preregistered results below are kept as they were; where a
sentence is superseded it is marked "(corrected, §0)". Nothing here changes a count.*

- **M3 does not let the gate serve (finding 1, blocker for the claim).** PREREG §3 clustered the admitted decisions by
  shipment. The gate admits or refuses whole suppliers, and its errors are correlated within a supplier (T1: 17 of 17
  wrong), so the supplier is the unit of independent evidence. Recomputed ($0, [runs/c2-2/m3-supplier-c22.json](runs/c2-2/m3-supplier-c22.json),
  `c22-m3-supplier.mjs`; the shipment-clustered numbers reproduce `summary-c22.json` exactly): the primary's 98 admitted
  stream decisions on C2-1-kind suppliers fall in **5 suppliers**; clustered by supplier, M3 returns **no-decision**:
  one-sided exact upper bound 0.085 at the rule's ρ floor 0.1 (n_eff 33.9), 0.456 if each admitted supplier counts once
  (ρ = 1). The raw count is 98 ≥ the rule's minimum of 60; it fails because the upper bound is above 5%. E1 passed as
  preregistered, but its M3 half no longer supports "serve". Future preregistrations cluster by the admission unit.
- **E1 could hardly fail (finding 6).** Each supplier applies one deterministic transform to every item
  (`program-b.mjs` `sopScoreOf`, `rawOf`) and history and stream come from the same generator (`gen-b.mjs`), so "the entry
  reproduces 60 history labels" implies "it is right on the stream" almost surely. E1 tests that the generator is
  stationary, not that the gate is sound. The two cases that do test the gate were designed knowing it: T1 (drift after
  admission: 17/17 accepted and wrong) and T3 (mixed conventions within a supplier: the whole supplier refused, 20 false
  deopts). A real test needs a second program the experimenter did not generate (another SOP, or external data).
- **The projection leaves out labelling (finding 12).** The primary assumes 60 labelled history products per supplier;
  SCRATCH's builder used 15. In every admission here G0-M3 = G0-60 = G0-15, so the 45 extra labels bought the (withdrawn)
  certificate and 4 fewer per-run false deopts (S1 3, S6 1), nothing else. §2's USD and time per item count builds only.
- **Two predictions hold by construction (finding 13).** E6 (S6's 0 false deopts): every S6 product cycles through all
  six branch kinds (`gen-b.mjs:124`, `EDGE_KINDS[i % 6]`), so even the first 15 history items cover them. And B's oracle
  shares the reused workflow's class bands (disclosed in C2-1); the same workflow always fails 6 of SOP-Bench's 254 sealed
  dangerous_goods rows, all on hazard_class, cause unknown (`research/sopbench-20261021/RESULT-p2.md` §9). If those are
  band-edge errors, B's oracle inherits them and no C2 number can show it.
- **The freeze guard counted stream records only (finding 8).** `c22.mjs` recorded `streamRecordsBeforeFreeze`, but
  admission comes from the history runs. No breach: `history.jsonl` was created at 02:23:12Z, 10 s after the freeze
  (02:23:01.97Z), and `stream.jsonl` at 02:26:37Z. `c22.mjs` is frozen and unchanged; later drivers use
  `freeze-guard.mjs`, which refuses a freeze while any result-feeding record file is non-empty (C2-3 does).
- **What the capability number is now.** On fresh suppliers of every C2-1 kind: 0 wrong reuses in 98 accepted items,
  in 5 admitted suppliers, with no M3 certificate. No baseline ran in C2-2 (REUSE and SCRATCH accuracy are bounded,
  costs projected). Against rebuilding, C2-1's measured arms say the history gate ties it on accuracy (C2-1 §0).

## 1. The answer

Program A's proven workflow, reused by program B **only after it reproduces B's own labelled history for the supplier**
(M3 bound on 60 history labels) and with **every run checked against everything proven** (A's proof widened with B's
conforming history), made **0 wrong reuses in 98 accepted items on fresh suppliers of every C2-1 kind**, and the M3 rule
on those admitted decisions returns `serve` (one-sided exact 95% upper bound 3.4%, n_eff 86.8) when clustered by shipment, as preregistered (corrected, §0: clustered by supplier, the admission unit, it is no-decision). C2-1's preregistered
producer-side gate (b3), replicated on the same items, made 38 wrong reuses in 123 accepted (30.9%).

It fails exactly where it was predicted to fail: on **T1**, a supplier whose scoring service changed meaning after the
history was recorded, it accepted 17 of 17 items and all 17 were wrong. No gate that relies on past evidence can see that
drift; only fresh labels (audits of reused answers) can. Pooled over all 16 suppliers including T1, the primary gate's
wrong-reuse rate is 17/115 = 14.8%, and M3 kills it.

## 2. Gates (320 stream items, 16 suppliers)

"Builds" = suppliers with at least one refused item, each needing a rebuild. USD and time per item are a **projection**
from C2-1's measured unit costs ($0.0506 and 241 s per build; the entry run measured here, 0.67 s per item). SCRATCH
(every supplier rebuilds) projects to $0.00253 and 12.7 s per item; the Haiku agent (C2-1, measured) $0.00134 and 11.4 s.
"Acc gap ≥" is the worst case of acc(REUSE) − acc(SCRATCH): REUSE and SCRATCH share the builds on refused items, so the gap
is at least −(wrong reuse)/items whatever the builds do.

| Gate | Accepted | Wrong | Wrong rate | False deopt | Catch | Builds | M3 aE (upper) | M3b (upper) | C2-1 kinds acc / wrong / fd | T kinds acc / wrong / fd | REUSE USD/item | Time/item | Acc gap ≥ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| b0 (no gate) | 320 | 175 | 54.7% | 0 | 0.0% | 0 | kill (0.616) | kill (0.820) | 241 / 134 / 0 | 79 / 41 / 0 | $0 | 0.7 s | −54.7 pts |
| b3 (C2-1 primary) | 180 | 57 | 31.7% | 22 | 67.4% | 8 | kill (0.408) | kill (0.640) | 123 / 38 / 22 | 57 / 19 / 0 | $0.00127 | 6.7 s | −17.8 pts |
| G0-15 | 137 | 39 | 28.5% | 47 | 77.7% | 9 | kill (0.395) | kill (0.618) | 98 / 0 / 9 | 39 / 39 / 38 | $0.00142 | 7.5 s | −12.2 pts |
| G0-15+b3c | 111 | 17 | 15.3% | 51 | 90.3% | 12 | kill (0.261) | no-decision (0.491) | 94 / 0 / 13 | 17 / 17 / 38 | $0.00190 | 9.7 s | −5.3 pts |
| G0-60 | 137 | 39 | 28.5% | 47 | 77.7% | 9 | kill (0.395) | kill (0.618) | 98 / 0 / 9 | 39 / 39 / 38 | $0.00142 | 7.5 s | −12.2 pts |
| G0-M3 | 137 | 39 | 28.5% | 47 | 77.7% | 9 | kill (0.395) | kill (0.618) | 98 / 0 / 9 | 39 / 39 / 38 | $0.00142 | 7.5 s | −12.2 pts |
| **G0-M3+b3c (primary)** | **115** | **17** | **14.8%** | 47 | 90.3% | 10 | kill (0.254) | no-decision (0.485) | **98 / 0 / 9** | 17 / 17 / 38 | $0.00158 | 8.2 s | −5.3 pts |
| oracle (ceiling) | 145 | 0 | 0.0% | 0 | 100.0% | 10 | serve (0.023) | no-decision (0.274) | 107 / 0 / 0 | 38 / 0 / 0 | $0.00158 | 8.2 s | 0 |

Without T1 (15 suppliers), the primary gate accepts 98, 0 wrong, M3 aE `serve` (upper 0.034, by shipment; corrected, §0:
no-decision by supplier, upper 0.085), M3b `no-decision` (upper 0.282, one entry).

## 3. Per supplier (accepted / wrong / false deopt)

| Supplier | Entry right on stream | History reproduced (first 15, all 60) | M3 on history | b3 | G0-15 | G0-15+b3c | G0-M3+b3c |
|---|---|---|---|---|---|---|---|
| S0 replica | 20/20 | 15/15, 60/60 | serve | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 |
| S1 GHS text | 21/21 | 15/15, 60/60 | serve | 21 / 0 / 0 | 21 / 0 / 0 | 18 / 0 / 3 | 21 / 0 / 0 |
| S2 hyphen ids | 0/17 | 0/15, 0/60 | kill | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| S3 1–10 scale | 2/19 | 0/15, 8/60 | kill | 5 / 3 / 0 | 0 / 0 / 2 | 0 / 0 / 2 | 0 / 0 / 2 |
| S4 inverted | 1/24 | 1/15, 3/60 | kill | 24 / 23 / 0 | 0 / 0 / 1 | 0 / 0 / 1 | 0 / 0 / 1 |
| S5 extra fields | 20/20 | 15/15, 60/60 | serve | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 | 20 / 0 / 0 |
| S6 unproven branches | 22/22 | 15/15, 60/60 | serve | 0 / 0 / 22 | 22 / 0 / 0 | 21 / 0 / 1 | 22 / 0 / 0 |
| H1 strings | 0/20 | 0/15, 0/60 | kill | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| H2 renamed field | 0/19 | 0/15, 0/60 | kill | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| H3 id case | 0/20 | 0/15, 0/60 | kill | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| H4 offset 0–4 | 6/24 | 6/15, 22/60 | kill | 18 / 12 / 0 | 0 / 0 / 6 | 0 / 0 / 6 | 0 / 0 / 6 |
| H5 German | 15/15 | 15/15, 60/60 | serve | 15 / 0 / 0 | 15 / 0 / 0 | 15 / 0 / 0 | 15 / 0 / 0 |
| T1 temporal semantic | 0/17 | 15/15, 60/60 | serve | 17 / 17 / 0 | 17 / 17 / 0 | 17 / 17 / 0 | **17 / 17 / 0** |
| T2 temporal shape | 0/22 | 15/15, 60/60 | serve | 0 / 0 / 0 | 22 / 22 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| T3 sparse sub-brand | 20/22 | 14/15, 56/60 | no-decision | 22 / 2 / 0 | 0 / 0 / 20 | 0 / 0 / 20 | 0 / 0 / 20 |
| T4 one wrong label | 18/18 | 14/15, 59/60 | no-decision | 18 / 0 / 0 | 0 / 0 / 18 | 0 / 0 / 18 | 0 / 0 / 18 |

## 4. Decisions against the predictions (all recorded before the run)

| Rule | Prediction | Result |
|---|---|---|
| E1: 0 wrong reuse on C2-1 kinds, M3 aE `serve` | yes; admit S0, S1, S5, S6, H5; refuse S2, S3, S4, H1–H4 | **yes** as preregistered: 98 accepted, 0 wrong, `serve` (upper 0.034, by shipment); admitted and refused exactly as predicted. *(Corrected, §0: by supplier no-decision, upper 0.085; and E1 could hardly fail.)* |
| E2: T1 wrong-accepted ≥ 80% | yes (stated blind spot) | **yes**: 17/17 |
| E3: T2 refused ≥ 95% by the primary, none by G0-M3 alone | yes | **yes**: 22/22 refused (every run answered Unable to Decide, an answer outside everything proven, and its scores are strings); G0-M3 alone accepted 22/22, all wrong |
| E4: T3 | G0-M3 refuses; G0-15 may admit | G0-M3 refused (56/60); G0-15 refused too (the one sub-brand product among the first 15 changed class). 2 harmful items caught, 20 false deopts |
| E5: T4 refused by every G0 gate | yes | **yes**: 18 false deopts |
| E6: S6 false deopts ≤ 2 (b3 refuses all) | yes | **yes**: 0 (b3: 22) |
| E7: M3b crossed not `serve` | yes | **yes**: `no-decision` (one entry) |
| Pooled primary wrong rate | ≈ 10–20%, 0% without T1 | 14.8%; 0% without T1 |

## 5. Root causes and what they mean

- **Producer profiles cannot see meaning (b3, replicated).** S4's inverted scores and H4's offset scores sit inside the
  1–5 range A was proven on, so every shape check passes; 35 of b3's 57 wrong reuses are S4 and H4. S3's 1–10 values pass
  when they happen to stay at or below about 6 (the range margin). Root cause: a profile of what the producer saw
  describes form, and the drift is in what the numbers mean.
- **Consumer history sees meaning, but only the past (T1).** Every T1 history product was stored on the SOP scale; the
  inversion starts after. The entry reproduces 60/60 labels and then answers every stream item wrong, and the per-run
  check passes because inverted values keep every shape. Nothing in this design can catch it without new labels. The
  fix is not a better gate but **monitoring of admitted reuse**: spot-check labels on a sample of reused answers and run
  the same M3 bound (or the M9 CUSUM from ATTACK-20261014) on them, so a supplier whose conformance decays is revoked.
- **Shape drift after the history needs the per-run check (T2).** G0 alone admitted T2 on its history and was wrong on
  all 22 items; the widened per-run check refused all 22. G0 and b3c are complementary: G0 for meaning on the past, b3c
  for shape on every run.
- **The history length did not change any admission here; it changed the certificate and the per-run false deopts.**
  G0-15, G0-60 and G0-M3 admitted and refused the same 16 suppliers. What 60 labels buy: (a) M3 can certify a supplier
  (15 perfect labels bound the per-item error only at 18.1%; 60 bound it at 4.9%); (b) the widened profile covers more of
  the supplier's normal variety, so b3c's false deopts fell from 4 (S1 3, S6 1 with 15 labels) to 0.
- **False deopts are mostly supplier-level and mostly right in spirit.** Of the primary's 47 false deopts, 9 are items a
  refused supplier's entry got right by coincidence (S3 2, S4 1, H4 6: the supplier's data is misread, the class happens
  to land right), 20 are T3 (a sparse drift makes the whole supplier fail conformance, so its 20 unaffected items deopt
  with its 2 affected ones) and 18 are T4 (one clerical error in B's records). The cost of a false deopt is a rebuild
  ($0.05 projected), not a wrong booking.

## 6. Honest reading

- **Capability number (dev, preregistered, $0):** wrong reuse 0/98 on fresh suppliers of every C2-1 kind, M3 `serve` by
  shipment (corrected, §0: no-decision by supplier; 5 admitted suppliers);
  against the producer-profile gate's 38/123 on the same items, and against no gate's 134/241. REUSE needs 10 builds
  where SCRATCH needs 16 (projected $0.00158 against $0.00253 per item, 8.2 s against 12.7 s), and its accuracy is at least
  SCRATCH's on everything except T1.
- **It is not a guarantee.** On T1 the gate is wrong 17/17, and a drift like T1 is ordinary in the real world (a
  supplier changes a scale and does not say so). Reuse needs post-admission monitoring with fresh labels; C2-2 does not
  build or test it.
- **M3b cannot serve with one entry.** The crossed rule needs evidence across entries before it bounds wrong reuse for
  the next entry; a second proven workflow (another SOP) reused by B is the next experiment.
- **Self-authored.** The second program, all 16 suppliers and the four blind-spot kinds are mine; I chose T1–T4 knowing the
  gate. T1 and T4 fail it by construction: they measure known limits, they do not test the gate. The claim that is tested
  is E1, on suppliers generated by the same kinds as C2-1 (fresh seed); that is replication on fresh data, not
  generalisation to new kinds of drift.
- No build or agent ran in C2-2: REUSE and SCRATCH accuracy are bounded, not measured, and costs are projections.
