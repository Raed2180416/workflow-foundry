# PREREG-CI1-R: review arms for CI-1 (blind cards, static cards, one-shot plus practice, isolated A2 rerun)

*Written 2026-11-04, before the first review-arm builder call, and frozen with `MANIFEST-R.json` (committed together). It answers
three findings of the CI-1 review (findings 4, 5 and 6). Evidence level: **development evidence.** The 28 items are held out from
builder development but were written by the same author who wrote the bed, so they are not sealed. The scoring oracle failed its own
validity check on both earlier waves (RESULT-CI1.md §0). The two dev-split smoke builds per arm (`runs/dev-R-*`) were run only to check
that the runner works, and are not evidence.*

## 1. Questions

1. **Did the pattern cards carry knowledge of the test items?** (finding 4) The original cards
   (`experiments/ci1/library/pattern-hints.json`) were written by the same session that had already written every item description.
   The new cards (`experiments/ci1-r/library/pattern-hints-blind.json`) were written by ONE fresh `claude -p` call to
   claude-opus-5-5, which saw only:
   - the 2026-10-14 catalog entries for the same 16 patterns;
   - the IR rules and the capability list that every arm sees.

   It never saw a bed item, a description, a run, or the original hints (`write-blind-cards.mjs`, $0.14).
2. **Is retrieval better than giving every card in every prompt?** (finding 5)
3. **Does a practice run alone give the compose loop's gain**, without the worked examples and the self-review? (finding 5)
4. **Does running the builder without the account identity change A2?** (finding 6) This also replicates A2 at K = 3.

## 2. Arms (Haiku 5.5, `claude-haiku-5-5`, K = 3, every item of both test waves)

| Arm | What | Code |
|---|---|---|
| **A2b** | A2 with the blind cards: the same index, leave-one-out exclusions, masked BM25, shape rerank, 3 cards and 3 exemplars as A2. Only the card text, cue words and shape features differ | `retrieve-r.mjs retrieveWith`, `builders-r.mjs` |
| **A1cH** | A1c with all 16 blind cards in every prompt; nothing is retrieved (no index, no exemplars) | `retrieve-r.mjs staticCards` |
| **A0p** | A0's system prompt and blocks, then the compose path's code-owned loop **without** the review call: validation, then a practice run in the public world, at most 3 repairs. No worked examples | `builders-r.mjs PracticeOneShotBuilder` |
| **A2i** | the frozen A2 code unchanged (`makeBuilderFactory('A2')`, original cards), rerun now | `run-arm.mjs` |

Every review arm runs under **account isolation**: the account variables are removed and each `claude -p` child gets an empty,
throwaway `CLAUDE_CONFIG_DIR`. `ACCOUNT-PROBE.md` shows this removes the account address from the model's context, which removing the
variables alone does not.

Records are scrubbed of non-fixture addresses before they are written, and the journal is checked for the account address at the end.
A disk check runs before each build (stop below 1.2 GB). The earlier arms (A0, A0t, A1c, A2) ran **with** the account address in
context. A2i measures what that difference does to A2, and it is the same-session control for A2b.

Items: the 19 wave-1 test items (`SPLIT.json`) and the 9 wave-2 items (`w2/SPLIT-W2.json`). Labels: `test-R-<arm>` and `w2-R-<arm>`.
Schedule (`r-run.sh`): stream 1 runs A2b then A1cH; stream 2 runs A2i then A0p. Within an arm, wave 1 runs before wave 2, and builds
run 3 at a time.

## 3. Oracle

- **Primary: the corrected oracle, on 26 items.**
  - Wave 1: oracle v2 (`experiments/ci1-posthoc/oracle-v2.mjs`), without the two items whose descriptions are ambiguous (16312, 17545).
  - Wave 2: v2 plus the eight declared w2x transforms (`experiments/ci1-posthoc/rescore-w2x.mjs`).
  - Both files are frozen by MANIFEST-R before any review-arm build, so the corrected oracle is not post hoc for these arms. It was
    written after the earlier arms' failures were seen, and the review arms are compared with those arms under the same oracle.
- **Secondary:** v2 on all 28 items. v1 is recorded for wave 1.
- **Validity caveat, stated now:** no false-negative probe certifies this oracle. Every failing review-arm build is root-caused. Any new
  oracle defect class is reported, and the claims are bounded by it. No oracle change is made to the numbers below.

## 4. Contrasts (paired by item, item bootstrap of 10,000 resamples with seed 20261022, sign test; `pooled.mjs` with `--w2x --exclude 16312,17545`)

| # | Contrast | Session | Prediction |
|---|---|---|---|
| C1 | **A2b − A2i** (blind vs original cards) | same | −8 to +3 points; on 17878, A2b passes ≤ 2 of 3 |
| C2 | **A1cH − A2b** (all cards vs retrieved cards and exemplars) | same | −5 to +5 |
| C3 | **A0p − A0** (practice run vs one-shot) | cross | +3 to +12 |
| C4 | **A1c − A0p** (worked examples + self-review over a practice run) | cross | −5 to +5 |
| C5 | **A2i − A2** (isolated rerun vs the earlier run) | cross | −6 to +6 |

Cost predictions: A0p's $ per verified build is below both A1c's and A2's. A1cH's tokens per build are above A2b's.

"Cross" means the two arms ran in different sessions, months apart in load and with or without the account in context. C5 measures
that difference for A2. If |C5| > 6, the cross-session contrasts C3 and C4 are reported as unreliable.

## 5. Decision rules (fixed now)

- **C1 ≤ −5, or A2b passes ≤ 1 of 3 on 17878:**
  - The retrieval gain and the §6 attribution in RESULT-CI1.md are reported as possibly carried by card text written with knowledge of
    the bed.
  - The retrieval claim becomes "not shown with blind cards".
- **Otherwise:** the original cards are not shown to carry test knowledge in the measured effect.
- **C2 ≥ −2:** retrieval as selection is not supported over static instructions on this slice. The recommendation becomes the static
  card block, which needs no index or BM25.
- **A0p ≥ A1c − 2 points and A0p's $ per verified build is lower:** one-shot plus a practice run is the recommended cheap builder for
  this slice. The worked examples and the self-review are not worth their cost here.
- **No result here changes a frozen earlier number.**

## 6. Budget and run rules

- **Caps:**
  - Per arm: wave 1 $1.0 and wave 2 $0.6 (A0p: $0.7 and $0.4).
  - All arms together: $4.5 at most.
  - CI-1 item total, including the earlier $3.43, the probe and the blind cards: at most $10.
- **Faults:** rate limits, session limits and the disk floor are environment faults. Such a build is not scored. The runner waits
  30 minutes and resumes, at most 6 times (`run-detached-r.sh`).
- **Disk:** checked before every build.
- **Freeze:** the runner refuses to run if `MANIFEST-R.json` or the wave's own manifest (`MANIFEST.json` for wave 1, `MANIFEST-W2.json`
  for wave 2) differs.

## 7. Analysis (after all four arms finish)

1. Score the review arms' wave-1 runs with oracle v2 (wave 2 already records v2):

   ```
   node experiments/ci1-posthoc/rescore.mjs test-R-A2b test-R-A1cH test-R-A0p test-R-A2
   ```

2. Apply the w2x transforms to the review arms' wave-2 runs:

   ```
   CI1_BED=…/bed-w2 node experiments/ci1-posthoc/rescore-w2x.mjs w2-R-A2b w2-R-A1cH w2-R-A0p w2-R-A2
   ```

3. Compute the primary contrasts (corrected oracle, 26 items):

   ```
   node experiments/ci1-w2/pooled.mjs A0=test-A0+w2-A0 A1c=test-A1c+w2-A1c A2=test-A2+w2-A2 A2i=test-R-A2+w2-R-A2 A2b=test-R-A2b+w2-R-A2b A1cH=test-R-A1cH+w2-R-A1cH A0p=test-R-A0p+w2-R-A0p --w2x --exclude 16312,17545 --pairs A2b:A2i,A1cH:A2b,A0p:A0,A1c:A0p,A2i:A2
   ```

4. Repeat step 3 without `--w2x` and `--exclude` for the secondary oracle (v2 on 28 items).
5. Root-cause every failing build, by class.
6. Report wall time per build and per verified build (`experiments/ci1-r/walltime.mjs`).
