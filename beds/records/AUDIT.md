# Audit of bed `records`: 2026-10-07

**Scope.** Adversarial audit and fix of `beds/records/` against `beds/CONTRACT.md`, for use in pre-registered
comparisons of agent harnesses. Pure code: no model was called. Bed before: v2.0.0 (git `65fe005`; the
README still said 1.0.0). Bed after: **v3.0.0**. Difficulties 1–2 are byte-identical to v2.0.0 (pinned by a
test); difficulties 3–5 changed.

**Commands.** `node --test beds/records/` (28 tests); `node beds/records/attacks/run.mjs 30 test 5000`
(triviality table); `node beds/records/measure.mjs 30` (sizes and ablations).

**Triviality budget.** A "≤ 40-line heuristic solver" means at most 40 lines of at most 160 characters
(≈ 6.4 KB) that reads only `task.prompt`/`task.inputs`. Without the width cap the budget is meaningless (any
solver fits on one line). The attacker may be written with the generator source at hand (white-box).
Pass rates are measured at difficulty 3 on 30 test-split seeds, 5000–5029.

## Findings

| id | severity | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| A1 | critical | **Trivially solvable at d3.** A 40-line × 160-char regex script that never reads the source notes (it reads only the spec's rate table, calling codes and nickname list) passes 20/30 (67%) at d3. The bed's own 39-line attacker `dense-v2` (11 KB, no width cap) passed 22/30; the previous test file asserted only the two weaker attackers. | `attacks/heur-v2.mjs` (new, 40 lines, max 160 chars) on v2.0.0: d1 26, d2 24, **d3 20**, d4 2, d5 0 of 30; `dense-v2`: 25, 27, **22**, 8, 7. | v3 per-task conventions (A2–A5), each decisive by construction. | `A1 regression (triviality)`: `heur-v3` ≤ 3/30, frozen `heur-v2`, `dense-v2`, `budget`, `dense-v1` < 6/30 at d3, and both 40-line fixtures fit the budget. |
| A2 | high | **The notes never had to be read.** Every convention (date orders, void markers, timestamps, signs) was constant across tasks, so the README's central claim ("locale from prose … only the source notes say which") was false at d1–d3 and nearly false at d4–d5 (only the cutoff date varied). A workflow built once on dev tasks transfers to test tasks unchanged. | A complete rule solver that never reads per-task notes (`notes-defaults` ablation) would pass 100% on v2. | From d3: BRIGHTDESK, ATLAS and VENDEX date orders, 2–3 extra status values with per-task meaning, a re-stamped mirror system, and per-system balance perspective, all stated only in the notes. The generator rejects any world in which misreading one of them alone still passes. | `A2 regression`: `notes-defaults` and each single per-task ablation pass 0/20 at d3. New bad controls (`*-order-flipped`, `status-meaning-flipped`, `unknown-status-live`, `mirror-ignored`, `perspective-ignored`) fail 30/30. |
| A3 | medium | **Prose was keyword-parseable.** Three ATLAS cutoff paraphrases whose only date was the cutoff ("first date in the ATLAS note" sufficed); all other notes were constant text. | v2 `render.mjs` `ATLAS_CUTOFF_NOTE`; `dense-v2` regex `/On (\d+ \w+ \d{4}), ATLAS moved/`. | Paraphrase pools: 8+8 per date order (ATLAS, VENDEX), 6+6 (BRIGHTDESK), 8+8 per status meaning, 5 mirror, 5 red-herring "reliable dates", 4+4 per perspective per system, 3 cutoff notes (one with a red-herring date). Every keyword that could decide one reading also occurs in a paraphrase of the other (UK/US, day/month first, "not void", "money we owe", "store credit", "read-only mirror", "restored from an old backup", …). Some state the convention only by example, by reference to another system (two-hop for VENDEX → ATLAS/BRIGHTDESK), by server country or by the team's city. | `A3 regression`: over 120 tasks every paraphrase of every pool and both values of every convention occur. |
| A4 | high | **Per-task date orders would be inferable from data.** About 30% of birth dates have day > 12, which reveals the order of a system; a majority heuristic would bypass any prose. | Design analysis; `ambP = 0.7` in `world.mjs`. | From d3, BRIGHTDESK and ATLAS write birth dates with day > 12 with a month name; VENDEX uses numeric dob/revision forms only for days ≤ 12. | `A4 regression`: no numeric date in those systems has a component > 12 at d3–d5. |
| A5 | medium | **Void markers were a closed list.** Six fixed markers (ZZTEST, storniert, DO NOT MIGRATE, SAMPLE, sandbox, withdrawn) were enough; decoy memos only punished keyword grepping of the whole line. | v2 notes. | Per-task extra status values in five systems; at least one void and one live per task; void ones mark two fake people (honouring them adds two extra entities), live ones mark at least two single-row people. Tokens are neutral words (`hold`, `ARCHIVE`, `replay`, …) so the label alone does not decide. | `A5 regression` (both meanings per task, ≥ 2 rows, stated in the notes) and the `status-meaning-flipped` / `unknown-status-live` controls. |
| A6 | medium | **Test suite was red at audit start** (18/20). `difficulty sanity` looked for `/ATLAS[^\n]*US[- ]host/`, which paraphrase 0 does not contain; `F5` counted the matched text ("On 3", "On 12", …) as paraphrase styles (5 ≠ 3). | `node --test beds/records/` on v2.0.0. | Checks now use the world (`ctx.cutoff`, `ctx.choices.cutTpl`) instead of wording. | `difficulty sanity`, `F5 regression`. |
| A7 | medium | **Documentation drift.** README said version 1.0.0 (code 2.0.0), "12 tests, ~17 s" (20 tests), and a token table 2–3% off (d3 6,445 vs measured 6,595); the test file and attack fixtures cited `AUDIT.md` and "AUDIT step 4", but no audit log existed; `attacks/budget.mjs` claimed "≤ 40 lines × ≤ 160 chars" but is 54 lines, max 237 chars. README described name/date/country comparison as exact while the code trims whitespace. | Diffs of README vs code; `wc`. | README rewritten for v3 (knobs, sizes, controls, ablations, limits); this file; header of `budget.mjs` corrected; README states the trimming. | `A7 regression`: README version string, pass-rule line and `THRESHOLDS` match the code. |
| A8 | medium | **Oracle trusted non-own properties and could crash.** `required` used `in`, so an inherited `records` or field passed (an `Object.create({records: truth})` output scored 1.0); a throwing getter crashed the oracle; a proxy was read several times. Only reachable by in-process JavaScript outputs, not by parsed JSON. | v2 probes: inherited records → pass 1.0; inherited field → pass 1.0; throwing getter → exception "boom". | `score.mjs`: the output is snapshotted once with `structuredClone` (own enumerable data only; functions, proxies and throwing accessors make it schema-invalid); `required` uses own properties; oversized `records` arrays are rejected before cloning. | `A8 regression`. |
| A9 | info | **Version scope.** P1 (pre-registered) ran on v1 tasks, C0 uses d3; changing d1–d2 as well would break continuity for no gain in the d3 criterion. | `experiments/p1/run.mjs`, `experiments/c0/run-dev.mjs`. | d1–d2 kept byte-identical to v2.0.0; d3–d5 change (version 3.0.0). | `A9 regression`: seven d1–d2 task hashes pinned to v2.0.0. |
| A10 | low | **`pairs-multiply` is not a decisive trap.** Multiplying by USD/XXX quotes instead of dividing passes 90–100% at d3–d5 (it only moves amount fields within the 3% budget). | `measure.mjs` ablation table. | Documented; not changed (amount fields are still wrong in ≥ 18/20 tasks). | `F5 regression` (amount accuracy < 1 in ≥ 18/20 tasks). |
| A11 | low | Found during the fix: two systems shared the status token `legacy`, and the generator's per-status decisiveness check matched rows by token only, so it could test the wrong rows. | Failing `A5 regression` during development. | Tokens unique across systems ignoring case; checks match (system, token). | `pools are internally consistent` (unique tokens). |
| A12 | low | The runtime test read the heap of the whole test process (which caches every task of the suite), so it failed as the suite grew without saying anything about `generate`/`oracle`. | `heap < 200 MB` failure once the suite cached more tasks. | Measured in a fresh child process: 8 cold d5 generations and oracle calls. | `A12 regression: runtime limits …`. |

Checks that found no defect:
- **Contract conformance.** All six exports present; `outputSchema` uses only `type`, `required`,
  `properties`, `items`, `minItems`, `maxItems`, `maxLength`; same seed → byte-identical task; the split is used
  only as RNG salt; no hashed world-RNG stream of test seeds 5000–6999 collides with dev seeds 0–9999 (new test).
- **Truth leakage.** No truth record, multi-row cluster list, E.164 number or converted non-USD amount appears in
  prompt + inputs; export lines are sorted by random row ids (adjacent-same-person rate < 6%); entity ids and
  field order carry no signal. Void rows never carry memos (they are marked anyway).
- **Oracle bypass.** Empty, all rows in one record, every row alone, truth clusters with blank fields, duplicated
  records, truth plus a record of all void rows, unknown-id padding, singleton splits, NaN/Infinity/BigInt,
  strings for numbers, oversized and deeply nested outputs all fail without crashing; the largest
  schema-valid output (1000 × 400 ids) is scored in ≈ 0.3 s. Extra properties and an own `"__proto__"` JSON
  key are harmless.
- **False negatives.** Key order, record order, `source_rows` order, letter case, NFD vs NFC, curly
  apostrophes, phone punctuation, surrounding whitespace and float noise below a tenth of a cent all keep
  score 1.0. The README pass rule matches `scoreAgainst` exactly.
- **Spec vs truth.** The prose rules (identity 3a/3b, name matching, conflict order including the mirror
  exception, accent restoration, phones, FX) were re-read against `world.mjs`; the text-level solver derives
  the truth with score 1.0 on 20 seeds × 5 difficulties × both splits. Two wording fixes made during the
  audit: two status paraphrases now end with an explicit instruction ("keep them" / "leave them out"), and
  spec 7 says which date selects the d5 rate table for a re-stamped row.

## Before / after numbers

Heuristic attackers, passes out of 30 test-split seeds (5000–5029) per difficulty
(`node beds/records/attacks/run.mjs 30 test 5000`):

| attacker | budget | v2.0.0 d1 / d2 / **d3** / d4 / d5 | v3.0.0 d1 / d2 / **d3** / d4 / d5 |
|---|---|---|---|
| `heur-v2` (written in this audit against v2) | 40 lines × 160 | 26 / 24 / **20** / 2 / 0 | 26 / 24 / **0** / 0 / 0 |
| `heur-v3` (re-adapted to v3, white-box) | 40 lines × 160 | – | 1 / 1 / **0** / 0 / 0 |
| `heur-v3-full` (every v3 template parser kept) | **over**: 57 lines, 8.4 KB | – | 26 / 24 / **17** / 6 / 0 |
| `dense-v2` (v2 audit fixture) | over width: 39 lines, 11 KB | 25 / 27 / **22** / 8 / 7 | 25 / 27 / **0** / 0 / 0 |
| `budget` (v2 audit fixture) | over: 54 lines, 237 chars | 21 / 13 / **1** / 2 / 0 | 21 / 13 / **0** / 0 / 0 |
| `dense-v1` (v1 shortcut) | 39 lines | 0 / 0 / **0** (30 crashes) | 0 / 0 / **0** (crashes) |

How `heur-v3` was obtained: `heur-v3-full` (all parsers, 17/30) had to lose 2.4 KB to fit. The cheapest cuts
(number words, accent restoration, the US-city list) already drop it to 4/30 at 7.5 KB; fitting 40 × 160 also
needs the example/reference/born-in parsers and era dates, which leaves 0/30. A second trimming order (keep
the template parsers, shorten the country table and drop VENDEX amounts) also gave 0/30 at 46 lines. Each
per-task convention costs a white-box parser roughly 100–300 characters, and each is decisive on its own.

Single-judgment ablations of the text solver (`measure.mjs`, 30 dev seeds): `notes-defaults`, `atlas-flipped`,
`bd-flipped`, `vendex-flipped`, `flags-flipped`, `unknown-flags-live`, `mirror-ignored` and
`perspective-ignored` each pass **0%** at d3–d5 (v2 had no per-task notes to ablate). Full table in README.

Controls (step 6): `referenceSolve` passes 30/30 with score 1.0 at d1, d3 and d5 (dev and test seeds); every
bad control fails 30/30 at d1/d3/d5 (20/20 at d2/d4) wherever it applies: 8 controls at all levels and
6 more from d3 (v2: 8 controls).

Sizes and runtime (step 7, `estimateTokens(prompt) + estimateTokens(inputs)`, 30 dev seeds):

| | d1 | d2 | d3 | d4 | d5 |
|---|---|---|---|---|---|
| v2.0.0 measured (README claimed) | 3,410 (3,403) | 4,755 (4,768) | 6,595 (6,445) | 7,857 (7,656) | 9,266 (9,036) |
| v3.0.0 measured | 3,410 [3,352..3,482] | 4,755 [4,665..4,869] | **7,107 [6,903..7,309]** | 8,419 [8,219..8,596] | 9,849 [9,611..10,292] |

d3 stays inside the contract's 6–15K band. Generation uses rejection sampling for the decisiveness checks:
median 1–2 attempts, worst 19 over 900 worlds, worst 0.3 s at d5 (contract: < 2 s); the oracle takes
≤ 0.1 s on real answers with a cold world cache and ≈ 0.3 s on the largest schema-valid output.

Test suite: v2.0.0 20 tests, 18 passing (A6); v3.0.0 28 tests, all passing, ≈ 2.5 min.

## Open items (not fixed here)

- **Experiments that hard-code v2 conventions will fail at d ≥ 3.** `experiments/workflows/records-hand.mjs`
  (the P1 "ceiling" workflow) fixes `DATE_ORDER = { BRIGHTDESK: 'mdy', LEDGR: 'dmy' }`, treats every `( )`,
  `CR`, `▲` or minus as a credit regardless of perspective, and orders conflicts by date only. Any workflow
  constructed on v2 tasks (C0 builds on dev seeds 1–3 at d3) has the same exposure. This is the intended
  effect of A2, but those workflows must be rebuilt or re-run against v3 before comparisons, and
  pre-registrations should pin `family.version` (or task hashes). This directory was the only one in scope.
- **A dedicated parser still works.** `heur-v3-full` passes 17/30 at d3 with 57 lines / 8.4 KB written
  from the generator source. The paraphrase pools are finite and shared by both splits (the contract allows
  the split only as RNG salt), so an agent that reads many dev tasks could learn them. Remedies would need a
  contract change (split-specific phrasing) or open-ended generated prose.
- **d1–d2 remain calibration levels**: unchanged from v2, a 40-line script passes 80–87% of them.
- Determinism relies on V8's `Math.exp`/`Math.log` (deterministic in V8, not guaranteed across engines).
- Rejection sampling conditions worlds on decisiveness (for example the mirror system tends to have many
  rows); this is a deliberate selection effect, documented here rather than measured further.
