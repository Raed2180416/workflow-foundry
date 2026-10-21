# Second rater for the four-layer truth (2026-10-21)

**Setup.**
- **Rater 2:** a separate agent on a different model family from rater 1 (Sonnet 5.5; rater 1 was the Opus 5.5 build
  agent).
- **What it saw:** only `rater2-blind-units.json` (the owner's request e-mail plus 69 units, shuffled, with neutral
  descriptions and no layer or field name that reveals it) and `beds/ebed/e8/spec/SPEC-E.md`.
- **What it did not see:** the truth file, the specbiz code and rater 1's labels. Its labels are in
  `rater2-labels.json`.

**Agreement:**

| Set | n | Agreement | Cohen's κ |
|---|---|---|---|
| Requirement units (L1 stated / L2 implied / L3 latent) | 46 | 35 (76.1%) | **0.57** |
| The 30 gold rules | 30 | 23 | – |
| Not-wanted (L4) units: rater 2 marks every one "unwanted" | 23 | 23 | – |

**Boundary-only agreement** (added 2026-10-21, compromise register B3). The 0.57 above is the 3-class figure (L1/L2/L3);
the six stated units, on which the raters agree perfectly, raise it. On the implied-versus-latent boundary itself, the
40 units both raters put in L2 or L3:

| Set | n | Agreement | Cohen's κ (bootstrap 95% CI) | Gwet's AC1 (CI) |
|---|---|---|---|---|
| L2 vs L3, both raters in {L2, L3} | 40 | 29 (72.5%) | **0.36** (0.04–0.66) | 0.52 (0.23–0.77) |
| L1 / L2 / L3 (the row above, for comparison) | 46 | 35 (76.1%) | 0.567 | 0.67 |

Recomputed from `rater2-labels.json` and `truth-e8-seed1.json`, not from the confusion table below (they agree);
10,000 unit resamples, seed 20261021 (`research/compromises-20261021/action0/b3.py`).

**Confusion** (rater 1 by rater 2):

| | R2: L1 | R2: L2 | R2: L3 |
|---|---|---|---|
| **R1: L1** | 6 | 0 | 0 |
| **R1: L2** | 0 | 7 | 6 |
| **R1: L3** | 0 | 5 | 22 |

**Disagreements:**
- R1.2, R1.4, R3.1, U02, U12 and U13: rater 1 says implied, rater 2 says latent.
- R4.5, R6.4, S2, S5 and U09: rater 1 says latent, rater 2 says implied.
- They are mostly idempotency and duplicate handling, terminal-state guards and tie-break readings. Rater 2 rated 4 of
  the 11 at low confidence.

**Reading.**
- "Stated" and "not wanted" are reliable.
- The **implied-versus-latent boundary is not.** The two raters agree only at κ = 0.57 there.
  *Corrected 2026-10-21:* 0.57 is the 3-class κ; on the boundary itself κ is **0.36** (CI 0.04–0.66), AC1 0.52 (table
  above). The boundary is less reliable than this line said.
- Therefore:
  1. The **primary** intent metric is recall over L2 ∪ L3, the unstated requirements, which needs no L2/L3 split.
  2. Per-layer recall is secondary and reported with this κ. *2026-10-21:* reported with the boundary κ 0.36, and
     computed under both raters' labels; a per-layer claim is allowed only if it holds under both.
  3. The 11 split units are adjudicated by the owner, or reported both ways.

**Interpretation gaps rater 2 found:**
- The markers U01 and AUTH are not defined in SPEC-E. The U-units have no markers there and were matched by
  description.
- Three not-wanted units depend on pack-specific facts the rater could not see.

The specbiz truth should give every unit a resolvable reference.
