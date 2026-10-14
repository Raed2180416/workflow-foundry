# Requirement tracker on E8: frozen evaluation plan

*Frozen 2026-10-14, before the first extraction call. This is TRACKER-DESIGN.md §5 made concrete. It is a development /
diagnostic evaluation on practice worlds 1235–1237. No dev world (1232–1234) and no sealed world is used. The freeze is
by file: `gold.json`, `teeth.json` and this file were written before the first paid call. Their sha256 values are
recorded in `results.json`, and the first row of `model-calls.jsonl` comes after them. The orchestrator commits
afterwards, so the git commit does not itself prove the order.*

## Inputs (frozen by sha256)

- **User text:** `beds/ebed/e8/spec/SPEC-E.md`, `c013c04c…f8cf1`.
- **Builds:**
  - `b1lh-e8-1/solver.mjs` `837f2255…bb0b` (lineage 1; 1,022/1,022 on dev);
  - `b1lh-e8-3/solver.mjs` `1056e57e…fc86` (lineage 3; the partial-reserve defect);
  - `b1o-e8-1/solver.mjs` `ee4ce62d…790` (B1-O; batch-level reserve key, refused by the host).
- **Tracker code:** `experiments/tracker/*.mjs` at the hashes in `results.json` (`freeze.trackerCode`). Any fix made
  during the run is listed in REPORT.md with its reason.
- **Worlds:** `PRACTICE` from `experiments/ebed/smoke-service.mjs`: 1235 d2, 1236 d3, 1237 d5, `mix: 'tail'`.

## Models and budget

- **Models:** ids come from `policy/models.json` (policy 2026-10-09.1) only.
  - Extraction and property writing use `claude-haiku-5-5` (the first class-M model).
  - The one logged escalation per entry goes to `claude-sonnet-5-5` (the first class-L model).
  - The Sonnet extraction arm uses `claude-sonnet-5-5`.
- **Budget:** $3.00 in total for every paid call in this evaluation. The cap is enforced by `--budget` on each command
  plus a running total kept in `results.json`.
- **Order of spending:**
  1. Haiku extraction, 3 samples.
  2. Property writing for the primary ledger, with each entry's escalation.
  3. The Sonnet extraction arm, up to 3 samples, but only from what is left. It is skipped, and reported as skipped, if
     less than $0.40 remains.
- **Primary ledger:** Haiku sample 0. It is the only ledger that gets properties. The user-confirmation step is
  simulated as "confirm all": no analyst edits. Entries keep the extractor's words.

## (a) Extraction recall

The gold is in `gold.json`:
- 30 SPEC-E ids (R1.1–R7.2 and S1–S9) with their line spans;
- a U-list of 15 unnumbered normative statements;
- a clause list of 76 atomic clauses, each with a verbatim anchor.

All metrics are mechanical (`experiments/tracker/eval-e8.mjs`):
- **id recall:** the share of the 30 ids that some entry covers. An entry covers an id when its located quote lies
  inside the id's span.
- **U recall:** the same rule, over the U-list spans.
- **clause coverage:** an entry's located quote overlaps the clause anchor. This is a proxy: it overstates when one
  quote spans several clauses, and the report says so.
- **dropped share:** entries whose quote is not verbatim.
- **non-normative entries:** entries whose quote lies wholly in §6 or in a heading.
- **guard yield:** of the clauses no entry overlaps, the share whose anchor lies inside an `uncovered` sentence.

Missed ids and missed clauses are listed by name.

**Switch rule (from the design):** if Haiku's mean id recall is below 0.95, or its clause coverage is more than 10
points below Sonnet's, the recommended default becomes Sonnet 5.5. That would be recorded as a policy decision for the
owner. Nothing switches silently.

## (b) Known defects (expected outcomes)

The table shows each requirement by the SPEC-E span it must cover:

| requirement | lineage 1 | lineage 3 | B1-O |
|---|---|---|---|
| line 161–162: partial → resubmit failed items, original keys, same window | pass (≥ 1 decided) | **fail** | untested |
| §2 line 47 / §1 lines 20–23: one key per reservation item | pass | pass | **fail** |
| R4.2 step 1: reserve every item within 120 min of t | pass | pass (or fail only on F4 cases) | **fail** |

- **Caught** means that at least one requirement whose quote covers the span has status `fail` on that build.
- **(b) passes** when all three bold cells hold and every lineage-1 cell is `pass` or `untested`, but never `fail`.
- **If no extracted entry covers line 161–162 or line 47,** the result is "missed at extraction". Then the gold-ledger
  ablation runs: the clauses R4.2c and U05 as entries, with properties still written by Haiku.

## (c) False alarms

1. **Lineage 1.** Every requirement with status `fail` on lineage 1 is adjudicated by the analyst. The analyst runs the
   bed oracle on lineage 1's own runs of the same practice worlds (`oracle(world, rows)`, analyst-side only) and
   matches each failing instance by subject. Each one is labelled either:
   - **tracker wrong**, with a root cause: extraction misreading / property bug / anchor slack / spec ambiguity; or
   - **solver wrong**, meaning the oracle also fails that case, or the trace shows a real violation of the quoted
     condition.
   Target: at most 1 false-alarming requirement on lineage 1.
2. **Reference runs.** Every requirement is checked on the bed's two reference runs of each practice world
   (`calibrate`). Target: 0 fails.
3. **G3** with K = 3 builds: each `suspect` flag is listed and explained.
4. **Teeth.** `calibrate --teeth teeth.json` runs the necessity controls on the worlds where they apply. The mutation
   score is the share of (control, id) pairs that turn `fail`. Suggested bar: 0.8. A pair with no covering requirement
   counts as a miss.

## (d) Cost and time

- USD comes from the provider-reported list price in the model journal (`model-calls.jsonl`).
- Wall minutes are measured per step: extraction per sample, writing (with its escalations counted separately), and
  checking per build.
- **Target:** the tracker costs at most one Haiku build ($0.39–$0.53).
