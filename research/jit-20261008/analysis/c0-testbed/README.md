# C0 testbed: rows 3 (Stage 1), 4 and 7 of BLOCKER-SYNTHESIS §2.1

*2026-10-09. Development evidence only: dev split, K = 1, one fixed solver. The static C0 records solver
(`research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs`, sha256 `09e56f54…`) is used as a **fixed testbed**.
It is not an R0 solver, and nothing here is a claim about JIT arms. Negative and partial results are kept.*

Seeds: records dev **201–224** (in sample: 201–216 d3, 217–224 d4, as `experiments/jit/configs/dev-records-1.json`) and
**249–272** (out of sample: 249–264 d3, 265–272 d4). 225–248 (reserved for R0) and anything ≥ 5000 were not generated or read.
`beds/sealed/` was not read.

## Results at a glance

| row | result | kill rule | verdict |
|---|---|---|---|
| C0 rerun | **15/24** (d3 13/16, d4 2/8), **$1.1777** list (320 calls: 24 Sonnet $0.4239, 296 Haiku $0.7537) | – | DEV-NOTES D5 had 16/24 (d3 14/16, d4 2/8); one d3 task fewer, K = 1 |
| 3, Stage 1 | Data check never wrong when decided on any one-regime leaf: **0 wrong of 124 decided** (in sample 61/64 decided, out of sample 63/64). As a gate on C0: **2/2 wrong date-order reads flagged** (s208, s214 BRIGHTDESK, both at 6:0 / 5:0); 5/8 lossy d4 ATLAS reads flagged; 9/62 correct reads flagged | none set for Stage 1 | holds out of sample on d3 and on one-regime d4 leaves; a single ATLAS leaf at d4 is the wrong unit |
| 4 | Gap AUROC for oracle failure **0.874, 95% CI [0.706, 1.000]** (9 failures / 24) | AUROC < 0.7 | **survives**, with a difficulty confound (difficulty alone: 0.767; within-difficulty pairs: 0.824). The DOB+phone estimator alone fails the rule (0.663) |
| 7 | AST diff flags **10/12 mutants** (deletions 4/5, widenings 6/7), **0/10 refactors** (1/10 before an inliner bug fix) | flags ≥ 50% of refactors | **survives**. Misses: void-provenance deletion (M3) and a phone-only linking widening (M12) |

Spend: **$1.1777** of the $2.50 cap, all on the C0 run (every call in `outputs/journal.jsonl`, totals in `outputs/cost.json`).
Rows 3, 4 and 7, including the replay, made no model calls.

## Commands

All scripts use `/opt/node24/bin/node`. Scratch goes to `/var/tmp/foundry-work/c0-testbed` (tasks, labels, journal SQLite,
sandbox workdirs). Run one at a time; RAM is tight.

```sh
cd research/jit-20261008/analysis/c0-testbed
node --max-old-space-size=1024 gen.mjs                  # 48 tasks + generator labels + manifest.json (scratch)
node --max-old-space-size=1024 run-c0.mjs $(seq 201 224) # live: C0 on 201-224 (claude-cli, ~$0.05/task), outputs/c0-runs/
node export-journal.mjs                                  # outputs/journal.jsonl, outputs/cost.json
node --max-old-space-size=1024 row3.mjs                  # outputs/row3.json
node --max-old-space-size=1024 row4.mjs                  # outputs/row4.json
node variants.mjs                                        # 12 mutants + 10 refactors (scratch, with .diff files)
node --expose-internals row7.mjs                         # outputs/row7.json (AST guard diff)
node --expose-internals astdiff.mjs <parent> <child>     # the tool itself; exit 1 = flagged
node --max-old-space-size=1024 replay.mjs                # $0: parent + 22 variants on 201-224 from the journal, outputs/row7-replay.json
```

## Files

| file | role |
|---|---|
| `gen.mjs` | regenerates tasks with `experiments/lib/beds.mjs makeTasks` (same `taskHash` as `stream.mjs`) and writes generator labels from `beds/records/world.mjs buildWorld` (date orders, ATLAS cutoff and per-row regime, truth entity count, row → person). The manifest (seed, difficulty, taskHash, file sha256) is in scratch and repeated in `manifest.json` here |
| `run-c0.mjs` | the static arm's compiled step, as `stream.mjs` runs it: `experiments/jit/run-compiled.mjs runCompiled` (sandboxed node, no network, gateway socket, $1 per task, 20 min), a port from `experiments/lib/models.mjs createModelPort` with the arm's model subset, journaled |
| `lib-parse.mjs` | $0 raw-line parsers (names, DOB, phone) for the six dialects. Validated against generator rows on 7 tasks: every DOB parsed, no ISO date wrong |
| `datecheck.mjs` | the N3 data check |
| `c0config.mjs` | C0's date-order reads, from its config call in the journal, with C0's own data override re-applied |
| `row3.mjs`, `row4.mjs`, `row7.mjs` | scoring |
| `variants.mjs`, `astdiff.mjs`, `replay.mjs` | row 7 testbed, tool and $0 behavioural replay |
| `outputs/c0-runs/s<seed>/` | C0 output, oracle verdict, stderr tail; `results.jsonl` one row per task |

## C0 rerun (step 2)

Run as a static arm's compiled step, with these deviations from `stream.mjs`:
- one task at a time, and claude-cli concurrency 2 instead of 16 (RAM);
- no Haiku-interpreter fallback. C0 returned `ok` on all 24 tasks, so no fallback would have fired anyway;
- a $2.30 spend stop, which was never reached.

| seed | d | pass | score | entities (truth / C0) | extra / missing | fields below 1.0 | cause (from oracle diffs, analyst side) |
|---|---|---|---|---|---|---|---|
| 201–206, 209, 211–213, 215, 216 | 3 | pass | 1.0 (s205 0.990) | equal | 0/0 | – | |
| 210 | 3 | pass | 0.986 | 45/45 | 0/0 | amount 0.80 | not investigated; passes the 0.97 field bar |
| 207 | 3 | **FAIL** | 0.984 | 36/36 | 0/0 | amount 0.78 | balance perspective (sign) misread, not a date error |
| 208 | 3 | **FAIL** | 0.776 | 39/45 | 6/0 | birth 0.90 | BRIGHTDESK date order read DMY, true MDY → split entities |
| 214 | 3 | **FAIL** | 0.804 | 36/40 | 4/0 | several | BRIGHTDESK date order read DMY, true MDY → split entities |
| 217 | 4 | **FAIL** | 0.912 | 49/52 | 3/0 | birth 0.90 | C0 reads one ATLAS order for both regimes (it cannot represent the swap); causes not separated further |
| 218 | 4 | **FAIL** | 0.823 | 56/60 | 5/1 | several | as 217 (not separated further) |
| 219 | 4 | pass | 0.968 | 56/57 | 1/0 | | |
| 220 | 4 | **FAIL** | 0.847 | 52/58 | 6/0 | several | as 217 (not separated further) |
| 221 | 4 | pass | 0.962 | 51/50 | 0/1 | | |
| 222 | 4 | **FAIL** | 0.927 | 59/57 | 0/2 | several | over-merge |
| 223 | 4 | **FAIL** | 0.710 | 47/55 | 9/1 | several | as 217 (not separated further) |
| 224 | 4 | **FAIL** | 0.906 | 56/57 | 2/1 | several | as 217 (not separated further) |

C0 never signalled on a d4 task (D5 reproduces). One point bears on dossier 2 E1's falsifier. The two d3 under-merges here (s208,
s214) come from an **upstream date-order misread**, not from name distance near the threshold. DEV-NOTES D1 attributes s214 to
under-merging in the JIT solvers; in C0, s214 fails because its config read the BRIGHTDESK order wrong. This is one solver at K = 1.

## Row 3 Stage 1: consequence gate for date-order reads

**Check (a re-derivation of dossier 6 N3).** Take every numeric birth date a/b/y in BRIGHTDESK, ATLAS or VENDEX with a, b ≤ 12
and a ≠ b, and read it both ways. A reading votes for its order when it equals an unambiguous birth date (VERITAS ISO, LEDGR
d.m.y, KOBO y/m/d or era date) on another row that shares a name token. The check's prediction is the argmax and its margin is
|DMY − MDY|. A leaf counts as decided at margin ≥ 1, and the gate trusts it at margin ≥ 2. The check reads only
`inputs.export`. Variant `plus` also uses month-name dates in the three systems as anchors.

N3 reproduces on the three known cheap-tier errors (correct:wrong votes):

| leaf | N3 | here |
|---|---|---|
| s204 ATLAS | 4:1 | 4:1 |
| s207 BRIGHTDESK | 3:1 | 2:0 |
| s208 BRIGHTDESK | 6:0 | 6:0 |

**Scored against generator labels** (variant n3; "m≥2" columns are the gate's trusted subset):

| set / d / leaf | leaves | decided | agree | m≥2 | agree at m≥2 | undecided | below gate |
|---|---|---|---|---|---|---|---|
| in d3 BRIGHTDESK | 16 | 15 | 15 | 13 | 13 | 0.06 | 0.19 |
| in d3 ATLAS | 16 | 16 | 16 | 15 | 15 | 0 | 0.06 |
| in d3 VENDEX | 16 | 15 | 15 | 14 | 14 | 0.06 | 0.13 |
| in d4 BRIGHTDESK | 8 | 7 | 7 | 7 | 7 | 0.13 | 0.13 |
| in d4 VENDEX | 8 | 8 | 8 | 6 | 6 | 0 | 0.25 |
| in d4 ATLAS, one leaf vs base order | 8 | 8 | **4** | 5 | **3** | 0 | 0.38 |
| in d4 ATLAS before cutoff (segment) | 8 | 8 | 7 | 7 | 7 | 0 | 0.13 |
| in d4 ATLAS after cutoff (segment) | 8 | 6 | 6 | 4 | 4 | 0.25 | 0.50 |
| **out** d3 BRIGHTDESK | 16 | 16 | 16 | 14 | 14 | 0 | 0.13 |
| **out** d3 ATLAS | 16 | 16 | 16 | 15 | 15 | 0 | 0.06 |
| **out** d3 VENDEX | 16 | 15 | 15 | 10 | 10 | 0.06 | 0.38 |
| **out** d4 BRIGHTDESK | 8 | 8 | 8 | 8 | 8 | 0 | 0 |
| **out** d4 VENDEX | 8 | 8 | 8 | 8 | 8 | 0 | 0 |
| **out** d4 ATLAS, one leaf vs base order | 8 | 6 | **2** | 4 | **1** | 0.25 | 0.50 |
| **out** d4 ATLAS before cutoff (segment) | 8 | 6 | 6 | 5 | 5 | 0.25 | 0.38 |
| **out** d4 ATLAS after cutoff (segment) | 8 | 8 | 8 | 7 | 7 | 0 | 0.13 |

N3's own scope (BRIGHTDESK + ATLAS):

| scope | decided / leaves | agree |
|---|---|---|
| in-sample d3 | 31/32 | 31 |
| out-of-sample d3 | 32/32 | 32 |
| in-sample d4, one ATLAS leaf | 15/16 | 11 |
| out-of-sample d4, one ATLAS leaf | 14/16 | 10 |

The in-sample d4 agreement of 11 is N3's "11 of 14 agree" pattern. The full per-leaf margins are in `outputs/row3.json`
(`margins`, correct:wrong). The `plus` variant decides slightly more leaves and is never wrong on one-regime leaves either.

Reading:
- **On one-regime leaves the check was never wrong when it decided:**
  - in sample: 61 decided of 64, 0 wrong;
  - out of sample: 63 decided of 64, 0 wrong;
  - at the gate margin (≥ 2) it is 0 wrong as well, with 6–38% of leaves below the gate depending on the system. VENDEX has
    the fewest numeric dates (about 5 per leaf), so it falls below the gate most often.
- **d4 ATLAS is two-regime.** The order swaps for rows changed on or after a dated vendor move. A single-leaf read is lossy by
  construction: agreement with the base order is 4/8 in sample and 2/8 out of sample, which is a coin flip.
- **Splitting by the generator's regime partition** (analyst side; the cutoff is stated in the notes, but this check does not
  parse it), the segment leaves agree 13/14 and 14/14 when decided. The one disagreement is s217 before the cutoff, 3:4 at
  margin 1, below the gate.
- **Exploratory, not a rule:** "both orders have votes" fires on 8/16 in-sample and 7/16 out-of-sample d3 ATLAS leaves. It is
  not a usable two-regime detector.

**Gate applied to C0's reads** (in sample; C0's config call from the journal; flag = margin < 2, or the data argmax differs
from C0's read):

| C0 leaves (24 tasks × 3) | n | flagged |
|---|---|---|
| wrong read, one-regime leaf | 2 (s208 BD, s214 BD) | **2** (data 6:0 and 5:0 against C0) |
| d4 ATLAS (lossy whatever the read; C0 read the base order on all 8) | 8 | 5 (s221, s222, s224 not flagged: data favours the base order at margin ≥ 2) |
| correct read | 62 | 9 (14.5%, all low-evidence leaves) |

| task level | flagged |
|---|---|
| C0 failures with at least one flag | 6/9 (s207 is a sign error, outside the check's scope; s222 and s224 are not flagged) |
| C0 passes with at least one flag | 5/15 |

Both date-order misreads that broke d3 tasks would have been escalated, at a cost of about 1 false flag per 7 correct leaves.

## Row 4: double-entry entity count

The design was frozen in the header of `row4.mjs` before any gap was computed.
- **Row set:** the rows C0 delivered. That isolates merging from void handling.
- **E1, DOB+phone blocking:**
  - numeric dates are read in the order the row-3 check picks, with both readings kept when it is undecided;
  - two rows link when they share a fuzzy name token and either have equal DOBs, or (when one is undated) share the last 8
    phone digits.
- **E2, looser union-find:** the DOB key ignores day/month order; rows link on a shared token plus an equal DOB key or an equal
  phone.
- **Primary score:** max(|C0 − E1|, |C0 − E2|).
- **Statistics:** AUROC for oracle failure, with a percentile CI from 10,000 bootstrap resamples of the 24 tasks.

| score | AUROC | 95% CI |
|---|---|---|
| **primary gap** | **0.874** | **[0.706, 1.000]** |
| \|C0 − E1\| (DOB+phone alone) | 0.663 | [0.389, 0.912] |
| \|C0 − E2\| (looser alone; equals the primary here) | 0.874 | [0.706, 1.000] |
| oracle-side reference: C0 − true count on the same rows | 0.833 | [0.573, 1.000] |
| exploratory baseline: difficulty alone | 0.767 | [0.573, 0.938] |
| exploratory: within-difficulty pairs only (primary) | 0.824 | – (d3 0.846, d4 0.750) |

- **Verdict: survives the kill rule (0.874 ≥ 0.7).** The CI's lower end sits just above 0.7.
- **Caveats:**
  - **The gap is confounded with size.** d4 tasks have more rows, E2's over-merge bias grows with the row count, and d4 holds 6
    of the 9 failures.
  - The within-difficulty AUROC (0.824) and the gain over difficulty alone (0.767) say the gap carries signal beyond size. That
    rests on n = 24 with 9 positives.
  - **Neither estimator is accurate as a count.** Against the true count on the same rows, the mean absolute error is E1 2.6
    and E2 5.4; C0's own is 1.5. Both estimators over-merge through households, namesakes and same-DOB family pairs. The gap
    works as a relative signal: a C0 under-merge pushes C0's count up while E2 stays put.
  - **What the gap can and cannot see.** Of the 9 failures, 7 are count failures (extra > 0). It cannot see s207 (a sign error)
    or s222 (an over-merge, C0 below the truth).
- The row-3 date order feeds E1, so the two rows are not independent signals.

## Row 7: recompile non-regression audit (AST guard diff)

**Tool** (`astdiff.mjs`). It parses with the acorn copy bundled inside Node 24 (`internal/deps/acorn`, v8.18.0, via
`--expose-internals`). It adds no dependency; `node_modules` has no acorn.

Guard sites are of four kinds:
- calls to non-local or member functions named guard / invariant / check / assert / flag / deopt / refuse (the flow SDK);
- if-statements whose consequent rejects (throw, or return of a string, null or false);
- conditionals with a null or problem-string branch;
- comparisons against a numeric literal.

Normalisation, so that renames, reorders and extractions do not count as changes:
- local identifiers become `$`;
- module-level literal constants are propagated;
- single-expression local functions are inlined;
- guards inside unreferenced functions are dropped, so a dead guard counts as deleted.

An unmatched parent site is paired with a child site by skeleton, which reports it as **modified** (with the literal or operator
change), or by test sub-term, which reports it as **widened (term dropped)**. Otherwise it is **deleted**. The tool flags a
child iff any parent site is deleted, modified or widened. The C0 parent has 56 sites (20 if, 13 cond, 23 cmp).

**Testbed** (`variants.mjs`, written before the tool was run): 12 mutants and 10 refactors.

| variant | class | AST diff | outputs changed on 201–224 ($0 replay) | pass/24 |
|---|---|---|---|---|
| parent | – | – | – | 15 |
| M1 batch count check deleted | deletion | **flag** (deleted if) | 0 | 15 |
| M2 batch check not passed to judge | deletion | **flag** (4 sites in now-dead `checkBatch`) | 0 | 15 |
| M3 void-marker provenance deleted | deletion | **miss** | 0 | 15 |
| M4 placeholder-date guard deleted | deletion | **flag** | 0 | 15 |
| M5 date-order data override deleted | deletion | **flag** (4 cmp sites) | 0 | 15 |
| M6 name typo allowance 1 → 2 | widening | **flag** (modified cmp, literal 1 → 2) | 22 | **1** |
| M7 year range 1800–2100 → 1000–2999 | widening | **flag** (modified) | 0 | 15 |
| M8 batch count `!==` → `>` | widening | **flag** (operator) | 0 | 15 |
| M9 1900-01-01 sentinel accepted | widening | **flag** (deleted + term dropped) | 1 | 15 |
| M10 all-zero phone accepted | widening | **flag** (term dropped) | 0 | 15 |
| M11 empty config accepted | widening | **flag** (term dropped) | 0 | 15 |
| M12 undated rows link on phone alone | widening | **miss** | 15 | **6** |
| R1 rename locals | refactor | no flag | 0 | 15 |
| R2 rename check function + param | refactor | no flag | 0 | 15 |
| R3 move phone section | refactor | no flag | 0 | 15 |
| R4 swap function order | refactor | no flag | 0 | 15 |
| R5 extract `voidOf` | refactor | no flag | 0 | 15 |
| R6 extract `isPlaceholder` | refactor | no flag (**flagged before the fix below**) | 0 | 15 |
| R7 extract `sameEntity` | refactor | no flag | 0 | 15 |
| R8 function → const arrow, renamed params | refactor | no flag | 0 | 15 |
| R9 extract `MAX_NAME_EDITS` constant | refactor | no flag | 0 | 15 |
| R10 reorder checks in batch check | refactor | no flag | 0 | 15 |

- **Detection: 10/12** (deletions 4/5, widenings 6/7). **False alarms: 0/10**, so the tool survives the kill rule (< 50%).
- **The first run had 1/10 false alarms (R6).** The inliner wrapped inlined bodies in extra parentheses. That bug was fixed
  after the result was seen. Both numbers are recorded; the pre-fix output is
  `/var/tmp/foundry-work/c0-testbed/row7-before-inline-fix.json`.
- **$0 replay** (`replay.mjs`). Every program ran in the run-compiled sandbox, with each model call served from the C0 journal
  by sha256 of (model, system, prompt). The parent reproduced all 24 live outputs exactly, with 0 replay misses.
  - All 10 refactors produce outputs identical to the parent on all 24 tasks. They are behaviour-preserving on this input set.
  - **9 of 12 mutants are invisible on the old cases.** Their outputs are unchanged, or the oracle score is unchanged (M9). A
    backward-transfer check on old cases would pass them.
  - The AST diff catches 8 of those 9; it misses only M3.
  - M12 is the reverse case: the AST diff misses it, but it is visible on old cases (15 outputs change, 15 → 6 passes).
  - So the union "AST diff or behaviour change on old cases" catches 11/12. Neither catches M3.
- **The misses are both decision logic, not guard syntax.** M3 turns `!!marker && own.includes(...)` into `!!marker`; M12 drops
  `&& namesMatch(a, b)` from a link rule. Neither is an if-reject, a conditional reject, a numeric comparison or a guard-named
  call. A sub-term-dropped rule applied to boolean assignments would catch both, but it was not in the frozen rules and was
  not added after the fact.

### Why v2.2's refusal replay is not this check (synthesis C13)

v2.2 (`preserveRefusals`; `experiments/jit/stream.mjs` `refusalPool`, `experiments/jit/acceptance.mjs` `applyRefusals`)
re-runs a recompile only on the trace-pool inputs on which the parent **refused** (a deopt handed to the interpreter). It
rejects the child only if one of those inputs is now answered wrongly. That is necessary but not sufficient for the D9 class:
1. It sees only inputs that are already in the pool and that the parent refused. A guard that never fired on a pooled input
   (the d4 tasks O/H v2 later failed were never in the pool) can be widened or deleted without any replayed case changing.
2. On this testbed it checks nothing at all. C0 never refuses (no deopt path), so the refusal set is empty and v2.2 would
   accept all 12 mutants.
3. The D9 heal itself fixed an over-strict check whose refusal inputs (s205, s206) the child then answered correctly. Refusal
   replay therefore passes it, while the widening that later caused the d4 silent misses is a source-level change.

A parent → child guard diff is computed from the source, not from inputs. It flags the edit whether or not any recorded input
exercises it, which is why the synthesis puts it in row 7 and not in v2.2. Here it flagged 8 of the 9 mutants that no old case
could reveal. It is a flag for review or for a targeted shadow, not a correctness proof: it says a fence moved, not whether
the move is right. A legitimate heal of an over-strict check, as in D3, is also flagged by design.

## Caveats

- **K = 1 everywhere.** One C0 run per task. The rerun gave 15/24 against D5's 16/24, so C0's own run-to-run variance is about
  one task.
- **Dev evidence.** In-sample seeds 201–224 were used to design N3 and to diagnose D1, D5 and D9, and the row-3 check was built
  knowing the s204/s207/s208 errors. Only 249–272 are out of sample, and only for row 3 (C0 was not run on them, so rows 4 and 7
  are in-sample only).
- **C0 is a fixed testbed, not an R0 solver.** Its failures (config misreads, ATLAS regimes) are not the JIT arms' failures, and
  its guard structure (no flow SDK, no deopts) is simpler than a JIT solver's.
- **Row 4** has n = 24 with 9 positives, a CI spanning [0.71, 1.0], and a difficulty confound.
- **Row 7's** mutants and refactors were hand-made by the same author as the tool, and are small single-site edits. A real
  Haiku or Opus recompile rewrites much more: messages, structure, check placement. Its false-alarm rate on real recompile
  pairs is unmeasured. The archived JIT version pairs that would measure it were lost with the cloud run data.
- **Row 3's** segment scoring uses the generator's regime partition. A deployable check would have to parse the cutoff date
  from the notes, or find a change point in update-date order. Neither was built.
- **What was not run:** row 3 Stage 2 (model reads) and the pooling of row 4 with JIT outputs (after R0).
