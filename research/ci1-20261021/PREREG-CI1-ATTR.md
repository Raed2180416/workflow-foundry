# PREREG-CI1-ATTR: leave-one-pattern-out attribution (addendum to PREREG-CI1 §4)

*Written 2026-11-04, after the test-split results (RESULT-CI1.md §3) and the post hoc oracle v2 rescoring (§4), before any
attribution build. Exploratory: it can say which retrieved card a pass depends on for one item; it cannot change any primary number.
Arm code, bed and retrieval index are the frozen ones (`MANIFEST.json` sha256 `39bf40bd…`; `run-arm.mjs --drop` was frozen with them).*

## Deviations from PREREG-CI1 §4 and why

| Preregistered | Now | Why |
|---|---|---|
| Items where A2 pass@1 exceeds A1c under oracle v1: 11679, 16364, 16904, 17545, 17807 | Items where A2 exceeds A1c under oracle v2 with the two ambiguous items dropped (v2x): 17878, 11679, 16904 | Under v2 the v1 flips on 16364 and 17807 are oracle artefacts (addressee leak, comma tokenizer) and 17545 is an ambiguous description: nothing to attribute there. 17878 is a v2 flip v1 could not see (every build failed v1 on a categorical-cell leak). |
| Each retrieved card removed in turn, K = 1 | 17878: each of its 3 cards removed in turn, and all 3 removed, K = 3 (12 builds). 11679 and 16904: all 3 cards removed, K = 3 (6 builds) | On 11679 and 16904 A1c already passes 2 of 3, so a one-card removal at K = 1 or 3 cannot be told from noise; only 17878 (A2 3/3, A1c 0/3) has a contrast large enough. "All cards removed" separates the cards from the exemplar skeletons, which stay. |

## Predictions (written now)

- 17878: A1c's three builds all skip an unpaid invoice whose currency cell is empty (an unstated filter; the description makes only
  status, due date and client e-mail required). A2's three builds do not. The card most likely to carry this is **P08** ("decide in
  code which items qualify before any effect ... treat missing values explicitly"); P42 (cross-run state: the 7-day re-reminder rule)
  and P36 (scheduled batch) are less likely. Prediction: removing P08 alone loses at least 2 of 3 passes; removing P42 or P36 alone
  loses at most 1; removing all three loses at least 2.
- 11679, 16904 with all cards removed: 2 or 3 of 3 pass each (the cards are not what these items need; their A1c failures were a
  dropped e-mail and a reference to a skipped branch).
- Budget: 18 Haiku builds, about $0.17; cap $0.20 per run (6 runs).

Builds are scored by the frozen oracle v1 inside the runner and rescored with oracle v2 (`experiments/ci1-posthoc/rescore.mjs`); the
v2 verdict is the one read, as for the A2 vs A1c v2x contrast this follows from. Runs: `experiments/ci1-posthoc/attribution-run.sh`.
