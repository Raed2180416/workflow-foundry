# Audit of bed `incident` — 2026-10-07

(First audit, v2.0.0 → v3.0.0. The second audit, v4.0.0 → v4.2.0, is the last section of this file.)

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

---

# Second audit — 2026-10-07 (attempt 1, interrupted) and 2026-10-08 (pass 2, this section)

Scope: only `beds/incident/`. No model or LLM API was called; every number below comes from deterministic scripts
(test split unless noted). Result: bed version **4.2.0** (task content changed for every seed).

## What the interrupted first attempt left (reconstructed, not re-verified line by line)

The first attempt of the second audit changed the generator in five rounds (v4.0.0) and then a partial sixth pass
(v4.1.0), and stopped before updating this file, the README or the tests. Its changes are documented only in code
comments (`gen.mjs`, the dated round headers in `catalog.mjs`); the comments cite this file's "Second audit" section,
which did not exist. Summary from those comments:

- Round 1 (v4.0): certificate notAfter no longer equals T (it is 75–240 s earlier from d3; v3 printed the exact
  answer string in every certificate task); latent phase for sudden faults; collateral timeouts; ONSET_MORE and
  ONSET_DIRECT onsets; no stats series of the fault's kind in the root from d3; stray anomalies in another resource;
  root blips echoed by callers; T range 8–16 min.
- Round 2: anonymous direct callers (p 0.7), momentary improvements between T and the cascade, herrings placed on
  the root's table neighbours, canaries without the version, routine refills of other cache namespaces, more note
  paraphrases.
- Round 3: composed lookalikes, per-task generated names for unrelated resources, notes that name services by what
  they provide.
- Round 4: per-service dialects, test and shadow replicas, ONSET_X, first symptom 15–90 s after the onset.
- Round 5: word-level synonyms per service, recovering strays, echo-only recoveries, consequence episodes.
- v4.1 ("S-1", "S-2"): decoys, routine deploys, the noisy job's jump, claims, the maintenance notice, injections and
  the certificate-renewal herring no longer timed relative to T; chronic, decoy, blip-other, shadow and renewal
  herrings no longer drawn with the true class (or excluding it).

Spot checks of those claims (100–200 test seeds, d3): on v4.0 the first decoy start dated T within 60 s for a
constant offset in 67% of tasks and the first routine deploy in 49% (base rate 25%); on v4.1 19% and 13%. A
keyword vote over WARN/ERROR lines (the 9-regex list in `incident.test.mjs`) named the true class in 90/100 tasks on
v4.0 and 62/100 on v4.1. Both confirm S-1 and S-2 as described. Its attackers A5–A11 and two over-budget ceilings
lived only in a scratch directory; the strongest two are now fixtures (`heuristic6.mjs` = its `a10b.mjs`,
`heuristic-ceiling2.mjs` = its `a8full.mjs`, verbatim apart from a one-line v4.2 adaptation noted in their headers).

## Findings (pass 2)

Severity as in the first audit: critical = a script reads the answer (or a component of it) without judgment;
high = a large shortcut or a broken claim; medium = a partial shortcut or an oracle defect with no known pass
bypass; low = robustness or documentation.

| id | sev | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| F-28 | high | The working tree was v4.1.0 while README, AUDIT.md and the interface test said 3.0.0; 4 of 26 tests failed on arrival (version pin; the note check required literal service names although from d3 notes name services by what they provide; two tests expected the root's stats series that v4 round 1 removed; v3 decoy-timing and lag bounds). Knob, size and baseline tables described v3. | `node --test beds/incident/`: 22/26 | Tests rewritten to v4 semantics with the same intent (description-aware note check that also asserts each description names exactly one service; "no stats series of the fault's kind in the root from d3"; lag bounds from `KNOBS`); README rewritten; this section. | `interface`, `v3 traps stay solvable`, `onset rules …`, `gradual onsets …` |
| F-29 | critical (v3, v4.0), high (v4.1) | Class prior. The root's herring kit (its own blip, its stray, its lookalikes, the same-class blip in a neighbour) carried only the true class, and nothing of similar weight carried any other single class. A 9-regex keyword vote over WARN/ERROR lines named the true class in 99/100 d3 tasks on v3.0.0 (missed by the first audit), 90 on v4.0, 62 on v4.1; the attempt's catalog regexes 74% (v4.1, 200 seeds); the true class was the unique most frequent blip class in 80% (v4.1). | `incident.test.mjs` VOTE lists; truth tags over test seeds 5000–5099/5199 | Rival anomaly (`K.rival`, d3+): a non-root service R carries the same kit for one other class h (blip shortly before its own episode, lookalikes, a blip of h in a third service) plus a sustained, never-recovering anomaly of h in another resource of R, 0.8–1.4× the root's fault lines (5–30), random start; decoy vocabulary leans to h (p 0.5); new `RIVAL_MORE` templates (no class ids or verdicts). After: vote 35/100 (d3), 27/100 (d5); the rival class wins the vote in about half; catalog regexes 50% (a coin flip between the two stories); unique blip majority 24%. New near-miss control `follow-rival`. | `F-29: no class prior …` (fails on v4.1: 80/100 and 62/100); `v3 traps …` (4b); controls |
| F-30 | medium | Herring clocks left after v4.1: blips were echoed by callers only if they ended before T − 60 s, so "the last 'answering again' line + 3 min" was within 60 s of T in 43% of d3 tasks (49% at d5); the same-class blip came before T − 240 s (33%). Base rate for a constant guess over T's range: 25%. | best-constant-offset scan, 200–300 test seeds | Echoes for any non-root blip at any time, as long as neither the blipping service nor the echoing caller is failing or falling back because of the real fault by then; same-class blip at any time. After: 14% and 11%; decoys 20%, deploys 13%, rival start 12%. | `F-30: herring clocks …` (fails on v4.1: 42%, 33%) |
| F-31 | high | Triviality at the bar on v4.1, invisible to the suite: the attempt's compliant A10 (38 code lines) passed 13/60 (21.7%) at d3 on test seeds 5000–5059 and A9 12/60 (20%); on the tested range 5000–5029 its over-budget ceilings passed 6/30 (20%) at d3 (`zceil2`) and 6/30 at d5 (`a8full`). None of them was a fixture, so the suite's tripwire (the v3 attackers, 0–1/30) could not see it. | `final.mjs` runs (scratch), numbers below | F-29 and F-30; A10, A12 and ceiling2 are fixtures now (compliant < 20%, over-budget < 35% on 5000–5029 at d3 and d5). After: A10 6/60, ceiling2 9/60 at d3. | `surface-statistics and adversarial scripts …` |
| F-32 | low | Dead noise: from d3 the stats-baseline services still logged a second, always-normal stats series (`STRAY_STATS`) meant to mirror the root's, which v4 round 1 removed (about 10 lines per task). | code (`baselineFor`) | Gated on `K.rootStats` (never true together with strays, so it is off at every level); with lighter decoys (0.4–0.8 of the root's loudness, at least 10–16 lines; were 0.5–1.0 and 14–22) and d3 `bg` 0.38 → 0.32 this keeps d3 at 16.5K tokens with the rival (about 18K without these trims). | `difficulty scales size …` (d3 median ≤ 17K) |
| F-33 | low | The triviality test called attackers without a guard; the v4 attackers throw on some d1 tasks, which crashed the test instead of counting a failed answer. | test run | A throwing script answers nothing. | same test |
| O-6 | low | The oracle accepted timestamps with calendar fields that do not exist (`2026-02-30T10:00:00Z`, `…T24:00:00Z`): V8 rolls them over to another day. No pass bypass beyond the ±60 s rule, but the README promised a real instant. | probes | Month 01–12, day within the month, hour 00–23 checked before parsing. | `oracle rejects schema-invalid output …` |
| D-4 | low | The overview wrote "X provides P, and it calls Y" when the "relies on" clause was skipped, so "provides …" did not delimit P; notes that name X by what it provides could not be resolved literally (failed the new description check at dev/d3/s14). | test | Comma only after a "relies on" clause. | `v3 traps …` (each description names exactly one service) |
| D-5 | low | Notes opening with a description started lower-case ("- the service behind …"), and possessives on descriptions read "the service behind order records's requests". | proofreading | Capitalised openings; templates rephrased without possessives. Fixtures lower-case "The " before matching. | `v3 traps …` (case-insensitive mention check) |

Also checked, no defect found: determinism (byte-identical tasks in one process and across processes; hash of 9
tasks identical in two runs); test seeds 5000–5999 share no RNG seed with dev seeds 0–19999 (attempts 0, 1 and the
class draw) and no test task 5000–5029 equals a dev task 0–299; `outputSchema` uses only the portable subset; every
export is present; no exact answer timestamp appears in any message body (the rival's certificate dates are tied
to its own start, so they hit T only by chance: 1 of 100 d5 tasks); no benign template family is logged by the root
alone (one skeleton in 4/200 tasks, a recovery line of the root's own stray); the rival's and the blip-same
service's table neighbourhoods contain the root in 14% and 25% of d3 tasks (a random non-root service: 10%).

## Oracle probes (steps 3 and 4)

Rejected without crashing, in addition to the first audit's list: `2026-02-30`, `T24:00`, month 13 or 00, a
leading space, 7 fractional digits, a comma as decimal separator, `+24:00` and `+00:60` offsets, a zero-width space
in a name, the whole answer as a JSON string, evidence ids over 12 characters, a class with a leading space.
Accepted (no false negatives): leap days (`2028-02-29`), `+14:00` offsets, a non-breaking space around a name (it
is trimmed), plus the first audit's variants (all still tested). The README pass rule matches `PASS_RULE` and the
code.

## Triviality attack (step 5)

New attacker, written from scratch for this pass: **A12** (`heuristic5.mjs`, 40 code lines, 8.4k characters,
short keyword lists instead of the phrase catalog): cascade start = first burst of dependent failures; root = the
service with the most novel WARN/ERROR fault-worded lines near the cascade plus failing request lines of its own,
weighted by failing documented callers, then descending to a troubled callee; class = keyword vote over the root's
lines; T = the root's first novel class-worded line after its last recovery (its own, or echoed by a caller) that
names the same resource as its late fault lines; impacted = closure over the table and parsed notes. It stays at
6–8% (its root accuracy is 35%; given the true root it passes 14.5%, so time is its weak part). The catalog-aware A10
and ceiling2 are stronger (given the true root they pass 21% and 34.5%; their root accuracy is 53% and 41%).

Pass counts (test seeds; "→" is v4.1 → v4.2; v4.1 is the working tree as found, v4.2 the result):

| attacker | lines | d3 5000–5029 | d5 5000–5029 | d3 5000–5059 | d3 5000–5199 | d5 5000–5199 |
|---|---|---|---|---|---|---|
| v2/v3 scripts (`baseline`, `attack`, A1, A1note, A2, A4) | ≤ 40 | 0–1 → 0 | 0–3 → 0 | 0–1 → 0–1 | ≤ 4 → ≤ 4 | ≤ 7 → ≤ 3 |
| A12 `heuristic5.mjs` (this pass) | 40 | 2 → 2 | 3 → 3 | 2 → 5 | 12 → 15 (7.5%) | 14 → 16 (8%) |
| A10 `heuristic6.mjs` (attempt 1) | 38 | 5 → 2 | 5 → 1 | 13 → 6 | 35 → 28 (14%) | 16 → 12 (6%) |
| A9 (attempt 1, scratch) | 38 | 5 → 1 | 4 → 0 | 12 → 5 | 39 → 22 (11%) | 12 → 8 |
| A11 (attempt 1, scratch) | 51 | 1 → 1 | 0 → 0 | 4 → 1 | 20 → 12 | 8 → 12 |
| ceiling (v3) | ~48 | 0 → 0 | 0 → 0 | 0 → 0 | 1 → 2 | 3 → 1 |
| ceiling2 `heuristic-ceiling2.mjs` (attempt 1) | 44 | 3 → 4 | 6 → 3 | 10 → 9 | 30 → 29 (14.5%) | 22 → 20 (10%) |
| ceiling3 (attempt 1 `zceil2`, scratch) | 47 | 6 → 0 | 3 → 3 | 13 → 2 | 37 → 23 | 15 → 15 |

Every compliant script is below 20% on every range at d3 and d5 (the bar applies to 5000–5029); the best is A10 at
14% over 200 d3 seeds. Over-budget ceilings reach 14.5%. Two dead ends worth recording (measured on an intermediate v4.2 build): a combination of A12's and ceiling2's root
finders (union of correct roots 60%) did not beat ceiling2 alone (14% each), and the global keyword vote is now a
coin flip between the true and the rival class.

## Controls (step 6)

`referenceSolve` passes 30/30 at d1, d3, d5 and 20/20 at d2, d4, on dev seeds 0–29 and test seeds 5000–5029,
score 1, also after a JSON round trip. All 10 bad controls (the first audit's 9 plus `follow-rival`) fail on every
one of those tasks with score < 1.

## Sizes and performance (step 7)

`estimateTokens(prompt) + estimateTokens(inputs)`, dev seeds 0–59 (test seeds 5000–5059 within 2%; d3 16,745):

| d | v4.1 median tokens (min–max) | v4.2 median tokens (min–max) | v4.2 lines median |
|---|---|---|---|
| 1 | 9,029 (8,400–9,909) | 8,955 (8,429–9,687) | 314 |
| 2 | 12,308 (11,276–13,172) | 12,131 (10,922–13,300) | 419 |
| 3 | 16,647 (14,397–22,791) | 16,533 (14,472–22,399) | 472 |
| 4 | 54,590 (50,167–62,169) | 54,764 (49,758–62,071) | 1,896 |
| 5 | 123,010 (112,154–142,275) | 123,455 (115,472–133,071) | 4,493 |

The static prompt is 1,195 tokens (v3: 990). d3 stays above the contract's 6–15K aim. `generate` takes about 8 ms
at d3 and 60 ms at d5 (max 92 ms over 60 seeds); a fresh process generating and scoring a d5 task stays far below
2 s and 200 MB (tested).

## Test suite

Before: 26 tests, 22 passing (F-28). After: 28 tests, all passing (`node --test beds/incident/`, about 105 s).

## Left open

- Residual class signal: a catalog-tuned keyword vote names the true class in about half of d3 tasks, because the
  root's own fault lines carry it; choosing between the two stories needs the root.
- The root's own blip is near T by design; the first blip echo still dates T within 60 s in 34% of d3 tasks for a
  constant offset (base 25%).
- I-12 (first audit) is no longer at 30%: the best over-budget ceiling passes 14.5% at d3. O-5 stays open (verdict
  details would leak the answer if fed back).
- The rival makes root-finding harder for every reader, not only for scripts; whether d3 remains solvable by
  frontier models at a useful rate is unmeasured. The tests only show that every answer is recoverable.
- The first attempt's rounds 1–5 were taken as found apart from the spot checks above; their individual
  before/after numbers in code comments are that attempt's own.
- d3 median 16.5K tokens, above the contract's aim. Not validated with any model.
