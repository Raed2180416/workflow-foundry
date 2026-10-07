# Audit of bed `incident` — 2026-10-07

Adversarial audit, then fixes, of the `incident` bed as found (generator `VERSION` 2.0.0; the README still said
v1.0.0 and the code referred to an `AUDIT.md` that did not exist). Scope: only `beds/incident/`. No model or LLM
API was called; every number below comes from deterministic scripts. Result: bed version **3.0.0** (task content
changed for every seed).

Method, in the order of the brief: (1) determinism and contract conformance; (2) truth leakage, including
white-box scripts that look for statistical pointers to the answer; (3) oracle bypass with degenerate and
hostile outputs; (4) oracle false negatives; (5) triviality attack with short deterministic solvers, iterated
against each generator change; (6) controls; (7) sizes and performance.

All pass rates are on the held-out seed range used by experiments (test split, seeds 5000 and up) unless noted.
"200 seeds" means test seeds 5000–5199.

## Findings

Severity: critical = a script reads the answer without judgment; high = a large shortcut or a broken claim;
medium = a partial shortcut or an oracle defect with no known pass bypass; low = robustness or documentation.

| id | sev | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| I-1 | critical | Benign "onset lookalike" templates were logged by the root only. One regex over them named the root in 200/200 d3 tasks (136/200 at d5, where one service logs under its legacy name). The root-only "own-vocabulary chronic" templates did the same in about 30% of tasks. | white-box regex over v2 logs, test seeds 5000–5199 | Most other serving services (p 0.85) log lookalikes of a class of their own in the same numbers; the extra stats services also log own-vocabulary chronic lines. After: 0/200 root-only. | `benign lookalike, stats and chronic lines are not root-only, and the root is not the loudest` |
| I-2 | critical | The "not yet in the table" note was drawn among impacted→impacted edges with edges into the root counted twice: its callee was the root in 89% of d3 tasks (81% at d4). The stale-row note preferred the root (71% at d4). | leak statistics over 100 test seeds per level | Added note: uniform over all non-gateway edges. Stale note: any role-compatible missing edge, no truth condition. After: 19% / 10% at d3, the same as the share of table rows that point at the root. | `prose notes, claims and the topology no longer point at the root or the blast radius` |
| I-3 | high | The topology was grown around the root (its callers preferred, edges into it likelier, edges around it forced hard): the root was the unique busiest callee of the dependency table in 54% of d3 tasks (max in-degree 78%), from the table alone. | in-degree over 100 test seeds | Root-agnostic topology from random anchor roles; the root is drawn afterwards among eligible services with a hard caller (layer-1 weight 0.4); the "falling-back caller" requirement applies to 50% of tasks (requiring it always favoured busy roots). After: unique busiest callee in 4.7% (d3), 10% (d4), 5.3% (d5). | same test (bound 0.3) |
| I-4 | high | Misleading claims (d4+) named the sibling of the true class, so the inverse sibling map returned the true class (47% of d4 claims named a class whose inverse sibling was the truth); their target was a direct caller of the root in 83%. | leak statistics | Target: the routine-deploy service with p 0.4, else any non-root service; class drawn uniformly from all 9 (or `bad_config_deploy` for the deploy target). Same for the d5 notice and injection (never the true root). After: direct caller 22%/12%, sibling 11%/12% (d4/d5). | same test; `truth never leaks` |
| I-5 | medium | The d5 "logs under its legacy name" note always named an impacted service (100%). | leak statistics | Any serving service. After: 19%. | same test |
| I-6 | medium | The routine deploy herring sat in an impacted dependent in 77% of d3 tasks (the ticket's d4+ guess names it). | leak statistics | 0.7 → 0.4. After: 43% (d3), base rate about 30%. | same test |
| I-7 | high | The root was the loudest service: most WARN+ERROR lines in 61% of d3 tasks; a 1-line "own trouble + 3 × blame received" ranking found the root in 77%. (The README's "the root is quiet" counted ERROR lines only.) | per-service counts, 200 seeds | Root fault volume scaled by 0.3–1.0 per task; 2 decoys at d3 whose volume follows the root's; up to 3 anonymous callers (p 0.8). After: loudest in 6%. | `... the root is not the loudest`; `the root is rarely the service with the most ERROR lines` |
| I-8 | high | The root's periodic stats lines stopped exactly at T (v2 emitted baselines only before T−20 s), so "first abnormal line after the root's last stats line" dated the fault; sporadic errors also never appeared in the root after T. | generator code, `baselineFor` | Stats continue after T with the fault's values (`BASELINE_AFTER`, same forms and levels); stats are numeric-only (no "(ok)" suffix); sporadic errors allowed after T. | `onset rules — canary releases, per-pod echoes, stats keep running after T` |
| I-9 | high | Triviality: the 40-line heuristic A1 (sickness ranking + vocabulary + "first onset-like line after the last recovery" + graph closure) passed 18/30 at d3 (60% over 200 seeds); A1 following the I-2 leak 68%; the white-box A2 59%. The bar is < 20%. | `heuristic.mjs`, `heuristic2.mjs` on the v2 generator | Fixes I-1 … I-8 and I-10, I-11 (below). After: A1 1/30, A1note 1/30, A2 0/30, A4 3/30 at d3 (200 seeds: 3%, 3%, 1.5%, 9.5%). | `surface-statistics and adversarial scripts pass < 20% at difficulty 3 and 5 on held-out seeds` |
| I-10 | medium | Blast radius was mechanical: given the root, A1's keyword parse of the notes plus closure over the table got the impacted set right in 100% of d3 tasks. | A1 with the true root | Optional-call paraphrases without the obvious keywords; hard-dependency notes worded like optional ones ("the fallback was removed", "the 'optional' flag is ignored"); mixed notes with the hard callee first; dated note pairs where only the later month holds; optional calls whose fallback reads from a provider (impacted if the provider fails too, a new prose rule, stated in the prompt). | `v3 traps stay solvable` (every optional call documented, dated pairs ordered, provider semantics) |
| I-11 | medium | T was mechanical: one recovery template per class, onset templates used only at T, "last rollout before the cascade" for config, "first refill after the last routine refill" for caches. | A1/A2 per-class breakdown | Root blips open with onset wording (p 0.85) and recover in paraphrase or only in values (p 0.7); onset wording repeats while the fault lasts; momentary "recoveries" inside the real episode; non-event onsets are often an abnormal stats value (p 0.7); canary releases (p 0.6, new prompt rule: a canary counts) and per-pod config loads; replicas echo the bad cache snapshot and routine refills; benign lookalikes carry the onset's words with a benign qualifier; sibling-worded consequences. | `onset rules ...`; `structural invariants`; `gradual onsets are the first abnormal value ...` |
| I-12 | high, **open** | A catalog-aware attacker over the 40-line budget (`heuristic-ceiling.mjs`, about 48 dense lines / 12k characters: A4 + ignore partial recoveries + bridge from anonymous callers to the table callee with the most onset-worded lines + numeric stats against their own median) passes 12/30 at d3 (31.5% over 200 seeds), 9/60 at d4, 15/60 at d5. Sudden classes (certificate, clock, rate limit) are its easiest: clear-cut stats plus the ±60 s tolerance. | `heuristic-ceiling.mjs` | Not fixed: the text comes from a finite phrase catalog, so enough white-box regex can encode most judgment. Kept as a fixture and a tripwire; README tells experiments to report it as the script ceiling. A v4 would need combinatorial or pinned paraphrased text. | triviality test (`ceiling` < 50%) |
| O-1 | medium | The oracle threw on outputs with a throwing getter or a throwing proxy (contract: return a verdict). | probes | Output copied as plain JSON data first (`plainCopy`); `oracle` wraps everything and never throws. | `the oracle never throws and only reads plain data` |
| O-2 | low | Sparse arrays passed schema validation (`forEach` skips holes): `impacted_services` with two holes plus the true names passed with Jaccard 0.83 (holes counted as one `undefined` name). | probe | Index loop in `validateOutput`; holes rejected in `plainCopy`. | same test |
| O-3 | low | The output was read several times (validation, then scoring), so an accessor could answer differently each time. No pass bypass without knowing the truth. | probe (flipping getter) | Single snapshot before validation; accessors invalid. | same test |
| O-4 | medium | False negatives: minute-precision timestamps (`2026-05-08T23:25Z`) failed `minLength: 20` although the README promised "ISO-8601 with Z or offset" and the regex allowed them; lower-case `t`/`z` (RFC 3339) failed. | probes | `minLength` 17; `T`/`Z` case-insensitive, upper-cased before parsing. README states the exact accepted form. | `accepted timestamp variants` |
| O-5 | low, open | `details.timeDeltaS` and `details.jaccard` would let a solver search the answer if verdict details were fed back. | code; `experiments/lib/runner.mjs` stores details, arms get the pass bit at most | Documented in README; no change (analysts need them). | – |
| T-1 | low | The v2 suite failed on arrival (1/20): the "decoy serves 5xx" check matched counts such as `expired 596 keys`. | `node --test beds/incident/` | Pattern restricted to HTTP status positions. | `v3 traps stay solvable` (decoy check) |
| T-2 | low | "First ERROR line is the root's" used 30 seeds and a 20% bound; with v3 it fluctuated around the bound by chance (base rate about 6%). | 200-seed rate | 100 seeds, bound 15%. | `ordering does not leak the root` |
| D-1 | low | Docs drift: README v1.0.0 vs code 2.0.0, missing AUDIT.md, stale knob and size tables, "no model" baselines over dev seeds only. | files | README rewritten (rules, knobs, sizes, baselines on test seeds), this file, `VERSION` 3.0.0. | `interface` (version) |
| D-2 | info | Determinism holds: byte-identical tasks across processes and call orders; test seeds 5000–5999 share no RNG seed with dev seeds 0–19999 (attempts 0, 1 and the class draw, all levels); no test task 5000–5029 equals a dev task 0–299. | hashes | – | `determinism`; `test-split seeds >= 5000 never reuse a dev task` |

Also fixed during the audit: inconsistencies the v3 changes themselves introduced and proofreading caught (a config
stats line reporting the canary release before promotion, a "staged for canary" lookalike after the release was
live, an all-window chronic line stating a normal heap value during a leak, "A inventory-svc" grammar).

## Contract conformance (step 1)

All exports are present (`family`, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls`, plus
`validateOutput`, `PASS_RULE`). `outputSchema` uses only the portable subset (checked by the test and by
`src/schema-subset.mjs`). `generate` is a pure function of `(seed, split, difficulty)` and rejects other types.
`split` is used only as RNG salt.

## Oracle probes (steps 3 and 4)

Rejected without crashing (after the fixes): `{}`, `null`, strings, numbers, arrays, `undefined`, `NaN`; extra
fields including a JSON `__proto__` key and `constructor`; wrong types (arrays for strings, numbers or `NaN` for
the timestamp, `Date` objects); `'Infinity'`, `'NaN'`, date-only, space-separated and zone-less timestamps;
upper-cased class ids; empty, oversized (41, 5,000 items), holey, nested or non-string impacted lists; over-long
strings (5 MB); getters, proxies, `toJSON` objects, symbol keys, inherited prototypes, functions. Degenerate
answers fail: every serving service or every service as the impacted set fails Jaccard in every task (tested
for 20 seeds × 5 levels; the generator only accepts tasks where "all serving services" is below 0.8), exactly
one class passes, and evidence never gates.

Accepted (no false negatives): any key order; any case and surrounding whitespace in names; duplicates; any order
of impacted names; minute precision, fractions, offsets, lower-case `t`/`z`; ±60 s inclusive; a JSON round trip of
the reference answer; a null-prototype object. The README's pass rule now states exactly what the code does
(`PASS_RULE`).

## Triviality attack (step 5)

Attackers (all read only `prompt` + `inputs`; fixtures in this directory):
- **A1** `heuristic.mjs` (40 lines): services ranked by own non-benign WARN/ERROR lines plus 3 × ERROR blame
  received; class by vocabulary vote; T = first onset-like root line after its last recovery line and before
  callers fail in earnest; impacted = closure over hard callers in the documented graph. `noteSolve` = A1 that
  trusts the "not yet in the table" note for the root.
- **A2** `heuristic2.mjs` (40 lines): white-box against v3's first round: negation-aware note parsing, root =
  most-blamed service with its own onset-worded lines plus descent, T = first line of the last onset-worded
  episode.
- **A4** `heuristic4.mjs` (40 dense lines): written from scratch against v3 with full catalog knowledge: dated
  notes, providers, blame descent, complete recovery and onset regexes.
- **ceiling** `heuristic-ceiling.mjs` (about 48 dense lines, over budget): see I-12.
Intermediate rounds (A3, A5–A8) were variants of these; each new device was re-attacked before moving on.

Pass counts at d3 and d5 on test seeds 5000–5029 (the tested range), and pass rate on 200 d3 seeds:

| attacker | v2 d3 /30 | v2 d5 /30 | v2 d3 200 seeds | v3 d3 /30 | v3 d5 /30 | v3 d3 200 seeds |
|---|---|---|---|---|---|---|
| A1 | 18 | 15 | 60% | 1 | 2 | 3% |
| A1note | 18 | 21 | 68% | 1 | 1 | 3% |
| A2 | 18 | 19 | 59% | 0 | 0 | 1.5% |
| A4 | 9 | 9 | 46.5% | 3 | 2 | 9.5% |
| ceiling (over budget) | 9 | 12 | 48.5% | 12 | 7 | 31.5% |
| firstJump / mostErrors / keywordGrep (`baseline.mjs`) | 0 / 0 / 0 | 0 / 0 / 0 | – | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0% |
| blameChain / adapted / strong (`attack.mjs`) | 0 / 1 / 1 | 0 / 2 / 1 | 0 / 4.5 / 10% | 0 / 1 / 1 | 0 / 1 / 0 | 0 / 2 / 2% |

(A4 and the ceiling were written against v3, which is why they score lower than A1 on v2.) Per-level table on
60 test seeds: README, "Script baselines".

## Controls (step 6)

`referenceSolve` passes 30/30 at d1, d3, d5 and 20/20 at d2, d4, on dev seeds 0–29 and test seeds 5000–5029,
score 1, also after a JSON round trip. All 9 bad controls (`empty`, `shuffled-or-corrupted`,
`plausible-but-wrong`, `sibling-class`, `late-timestamp`, `impacted-missing-half`, `blame-decoy`,
`onset-at-root-blip`, `follow-red-herring`) fail on every one of those tasks with score < 1.

## Sizes and performance (step 7)

`estimateTokens(prompt) + estimateTokens(inputs)`, dev seeds 0–59 (test seeds 5000–5059 match within 1%):

| d | v2 median tokens (min–max) | v3 median tokens (min–max) | v3 lines median | v3 impacted median (v2) |
|---|---|---|---|---|
| 1 | 8,837 (8,312–9,501) | 8,806 (8,065–9,341) | 316 | 2 (3) |
| 2 | 12,307 (11,147–14,209) | 12,041 (10,734–13,620) | 418 | 3 (3) |
| 3 | 14,616 (13,323–16,196) | 15,366 (13,709–17,864) | 455 | 3 (4) |
| 4 | 49,558 (45,646–55,248) | 53,049 (48,973–59,686) | 1,868 | 3 (5) |
| 5 | 121,146 (109,721–135,589) | 123,214 (111,329–134,389) | 4,512 | 4 (5) |

The static prompt grew from 945 to 990 tokens (canary and fallback-provider rules). d3 sits at the top of the
contract's 6–15K aim (median 15.4K, slightly above). Smaller impacted sets (root-agnostic topology) make the Jaccard rule stricter: a set of 2
or 3 must be exact. `generate` takes 4 ms (d3) and 27 ms median / 58 ms max (d5); the oracle rebuilds the task
once; a fresh process generating and scoring a d5 task stays far below 2 s and 200 MB (tested).

## Test suite

Before: 20 tests, 19 passing (T-1). After: 26 tests, all passing (`node --test beds/incident/`, about 60 s).

## Left open

- I-12: the over-budget white-box ceiling (about 30% at d3). Report it as a baseline row.
- O-5: verdict details would leak the answer if ever fed back to a solver.
- Not validated with any model; difficulty for models is a design target.
- Residual structural priors (root never gateway/batch, must host the class and have a hard caller; unique
  busiest table callee in about 5–10% of d3–d5 tasks); the class mix per 300 dev seeds ranges 25–45 per class.
