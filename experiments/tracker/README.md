# Requirement tracker (E8 first)

This implements the minimal tracker in [research/need-router-20261014/TRACKER-DESIGN.md](../../research/need-router-20261014/TRACKER-DESIGN.md)
(task #60). The owner's ask (2026-10-14) was: "log the conditions specified by the user and check against logic and
stuff demanded."

The tracker works only from the user's own text:

1. A model splits the text into a **ledger** of conditions. Each entry quotes the user verbatim, and the user confirms
   or edits the list.
2. A model writes one small JS **property** per entry, from the quote alone.
3. Every candidate build runs on **practice worlds**. Each property is checked against the run's **trace**: what the
   user's own platform would show them.
4. The output is a **status table**: untested / pass / fail / unclear per condition, with trace excerpts for the
   failures.

No property, extractor or writer ever sees world truth, the bed oracle or a build's code. The analyst uses the oracle
in the evaluation (design §5) only to label the tracker's alarms.

**Status: first paid run made (2026-10-14), development / diagnostic.** The report is
[research/need-router-20261014/tracker-e8/REPORT.md](../../research/need-router-20261014/tracker-e8/REPORT.md); the
frozen plan is `PREREG.md` in the same folder.
- **Cost:** $0.13 and about 6 min one-off (Haiku extraction plus 78 Haiku-written properties). A re-check costs $0.
- **Caught:** lineage 3's line-162 defect, 4/4.
- **Missed:** B1-O's batch keying.
- **False alarms:** 16 false-alarming requirements on lineage 1 and 21 on the reference runs, almost all property bugs
  where the writer guessed the trace vocabulary.
- **Not yet usable as a verdict.** The next step is a writer prompt and trace API revision, preregistered as a new
  version.

**Gleaning (2026-10-21, development evidence only; REPORT.md §10).** A second extraction pass over the coverage list
(`glean`, or `--glean` on `extract` / `all`) took the primary Haiku ledger from 23/30 to 28/30 SPEC-E ids and covered the
go-live sentences, for $0.0022–0.0028 per call (3 repeats agree). SPEC-E is in-sample for that prompt. The pass is
opt-in; the default pipeline is unchanged.

## Files

| file | does |
|---|---|
| `trace.mjs` | Trace API v1. `projectTrace(rows, { files, records })` is an allowlist projection of the host journal. `makeHelpers(t)` builds the `h` a property gets. `TRACE_API` is the writer's only reference and its prompt prefix. |
| `ledger.mjs` | The ledger and its $0 mechanical checks. Every quote must locate verbatim in the user's text, otherwise the entry is dropped and counted. Normative sentences that no quote overlaps go into a coverage list. Duplicates are merged, and ids follow position in the text. Also the user's edits (confirm / edit / add / delete), each logged; an edit bumps `check.version`. |
| `extract.mjs` | Extraction: one model call through the journaled ModelPort with a portable schema. Also `budgetedPort` (the spend cap and the per-call JSONL log) and the policy-driven default model ids. |
| `checks.mjs` | The property sandbox, the contrast pair (G2), the writer (rewrites, then one logged escalation), the §3 status rules and G3. |
| `report.mjs` | `report.md`: run health, the status table (with possibly-missed sentences), and failing instances with trace excerpts. |
| `run.mjs` | The runner and CLI. Builds run on the practice worlds, then properties, statuses and per-build files. `calibrate` is G4. Also the gleaning pass (`gleanLedger`, `mergeGleaned`): one model call over `ledger.uncovered`, entries or "none" per sentence, merged by quote pointer (the quote is the sentence, copied by code; existing entries and ids are untouched). It lives here because PREREG-SPEC1 freezes `extract.mjs` and `ledger.mjs` by sha256. |
| `eval-e8.mjs` | Analyst-side only, never imported by the tracker. `score` is the mechanical extraction recall against the frozen gold, on the frozen SPEC-E only (`frozenSpecE()`: `git show 48535bb:beds/ebed/e8/spec/SPEC-E.md`; any other text or a ledger from one is refused), plus go-live coverage (frozen lines 91–93). `adjudicate` joins a build's failing instances to the bed oracle's verdicts on the same run. |
| `test/*.test.mjs` | Leak test, projection, helpers, ledger mechanics, extraction, gleaning and writer with a scripted model, sandbox, contrast, status rules, G1/G3, spend cap, the frozen-SPEC-E hash and score check, and end to end on the three frozen E8 builds. Tests that assert SPEC-E lines read the frozen text. |

## How to run

All commands are run from the repository root.

```sh
# tests ($0, scripted model, no paid call; about 20 s, most of it the end-to-end run on practice world 1237)
node --test experiments/tracker/test/*.test.mjs

# the whole pipeline: extract, write a property per entry, check builds (metered: --budget caps model spend, default $2)
node experiments/tracker/run.mjs all --text beds/ebed/e8/spec/SPEC-E.md \
  --build research/enterprise-20261014/runs/b1lh-e8-1/solver.mjs \
  --build research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs \
  --build research/enterprise-20261014/runs/b1o-e8-1/solver.mjs --budget 2 --out /var/tmp/foundry-work/tracker/e8

# or step by step
node experiments/tracker/run.mjs extract --text beds/ebed/e8/spec/SPEC-E.md --out DIR [--samples 3] [--model ID] [--budget 2] [--glean]
node experiments/tracker/run.mjs glean   --ledger DIR/ledger.json --text <the text it was extracted from> [--sample N] [--model ID] [--budget 0.05]   # in place
node experiments/tracker/run.mjs ledger  --text beds/ebed/e8/spec/SPEC-E.md --entries gold.json --out DIR   # $0, frozen list (gold-ledger ablation)
node experiments/tracker/run.mjs edit    --ledger DIR/ledger.json --text beds/ebed/e8/spec/SPEC-E.md --edits edits.json
node experiments/tracker/run.mjs write   --ledger DIR/ledger.json [--model ID] [--escalate ID|none] [--reasoning low] [--budget 2]
node experiments/tracker/run.mjs check   --ledger DIR/ledger.json --build <solver.mjs> [--build ...] [--worlds 1235:2,1236:3,1237:5] [--size N] [--keep-traces]
node experiments/tracker/run.mjs calibrate --ledger DIR/ledger.json --teeth teeth.json [--worlds ...]   # G4, evaluation only

# analyst-side recall against the frozen gold ($0; the text defaults to git show 48535bb:beds/ebed/e8/spec/SPEC-E.md)
node experiments/tracker/eval-e8.mjs score --ledger DIR/ledger.json [--ledger ...]
```

**Outputs.**

- `DIR/ledger.json` is the ledger with its properties.
- `DIR/<build>/ledger.json` is the same ledger with statuses and evidence for that build, and `DIR/<build>/report.md`
  is its report.
- `DIR/<build>/health.json` holds per-world run health, run time, projection time and trace bytes.
- `DIR/journal.sqlite` is the ModelPort journal.
- `DIR/model-calls.jsonl` has one row per call, refusal and escalation, with cost.

The default `--out` is under `/var/tmp/foundry-work/tracker/`, outside the repository.

**Input formats.**

- `edits.json` is a list of edits:
  - `{ "op": "confirm", "id" }`
  - `{ "op": "edit", "id", "summary"?, "kind"?, "quote"?, "context"?, "reason"? }`
  - `{ "op": "add", "quote", "kind", "summary" }` (the quote must be a verbatim span)
  - `{ "op": "delete", "id" }`
- `teeth.json` is `{ "spans": { "<SPEC-E id>": [line, lineEnd] }, "controls": { "<control id>": ["<SPEC-E id>", ...] } }`.
  - A control applies on a world when the world's difficulty is at least the control's `minDifficulty`
    (`beds/ebed/e8/controls.mjs`).
  - A requirement covers an id when its quote lies inside that id's span.
  - The mutation score is the share of (control, id) pairs where a covering requirement fails on the control trace and
    does not fail on the reference runs.

**Exit codes.** `extract`, `write` and `all` exit 4 when the spend cap stops them. The ledger is saved first, with the
entries not yet written left pending.

## What holds by construction

- **Information boundary.** The trace carries only rows from an allowlist of the host journal:
  - inbound messages, projected as `host.armEvent` projects them, plus the attached document;
  - emitted effects, with results as delivered;
  - refused tick outputs, with what they proposed;
  - human tasks (the `task` only) and timers as the workflow declared them;
  - instances;
  - `master/`, `rulebook/` and `calendar/` files;
  - arm-visible records at the horizon.

  It never carries `ledger` rows, `counterparty.*`, `world.write`, `binding`, task plans, truth or the fault schedule.
  `test/trace.test.mjs` checks this with a hand-written journal that contains every forbidden row. It also runs a real
  run twice, on two worlds that differ only in truth labels: the traces are byte-identical and carry no truth case id.
- **Model-written code is untrusted.**
  - Solvers run only through `beds/ebed/host/sandbox-arm.mjs`.
  - Properties run in the same executor sandbox: user, mount and pid namespaces, an empty network namespace, and every host
    home and work root hidden. The sandbox directory holds only the trace and the property sources.
  - Each property runs in a fresh `vm` context:
    - no `process`, `require`, `import()`, `fetch`, `eval` or `new Function`;
    - `Date.now`, a bare `new Date()` and `Math.random` throw;
    - the trace is deep-frozen;
    - each property has 5 s per trace.
  - A throw, a timeout or a malformed output makes the status `unclear`, never `pass`.
- **G1 source.** The writer prompt holds only the quote, its context quotes, the kind, the summary and `TRACE_API`. A
  property is written once (keyed by quote hash and version). It is rewritten only after a user edit (`applyEdits` bumps
  the version). A check that came out untrustworthy stays `unclear` until the user edits the entry.
- **G2 contrast pair.**
  - The writer returns a minimal satisfying trace and a minimal violating trace.
  - On the satisfying trace, the property must return at least one instance, all `ok: true`. On the violating trace,
    at least one `ok: false`.
  - If the pair fails, the writer gets up to 2 rewrites, each with its own failure reason. Then comes **one** escalation
    to the next policy class (`onEscalate`, also logged in `model-calls.jsonl`). After that the status is
    `unclear: check not trustworthy`.
- **G3.** A requirement that fails on every one of K ≥ 3 builds is flagged `suspect`.
- **G4.** `calibrate` runs analyst-side in process. A fail on a reference run is a false alarm. A control that does not
  turn its target to `fail` means the property has no teeth.
- **Models.** Ids come only from `policy/models.json`. Extraction and writing default to the first class-M model
  (`claude-haiku-5-5`); the one escalation goes to the first model of the next class (`claude-sonnet-5-5`). `--model` and
  `--escalate` are checked against the policy. Every call goes through `experiments/lib/models.mjs` `createModelPort`,
  so it is journaled and priced by the provider. `--budget` is a hard cap checked before each call.

## Measured at $0 (development diagnostic, 2026-10-14)

`test/run.test.mjs` runs the probe's three hand-written properties (design §6, with the §6.3 string-key correction) as
fixtures. Through this runner, they reproduce the design's §6.1 table on practice world 1237. The full three-world run
was made once by hand, giving 1235 / 1236 / 1237:

- **Line 162:**
  - lineage 1: 0 · 0 · 4/4 pass;
  - lineage 3: 0 · 0 · **4/4 fail**, with the first instance `ORD-1237-0062` "released instead of resubmitting";
  - B1-O: untested.
- **Per-item reserve keys:**
  - lineage 1: 58 · 114 · 323, all pass;
  - lineage 3: 58 · 114 · 319, all pass;
  - B1-O: 58 · 118 · 344, **all fail**, on refused outputs.
- **R1.1:** 50 · 80 · 200 pass for all three builds.

**Run health.** B1-O had 39 / 63 / 183 refused tick outputs; the first refusal reason was "a batch op keys its items,
not the batch".

**Calibration on 1237.**

- The reference runs (earliest and latest) gave 0 fails for all three properties.
- The `no-keys` control turns both the per-item-key property and the corrected line-162 property to `fail`.

**Cost.**

- Each check takes about 0.7 s per build over the three worlds for the three properties.
- A sandboxed property costs about 50 ms on a 2.4 MB trace.
- World runs take 1.5 / 2.4 / 5.9 s for lineage 1.

**What this does not show:**

- that Haiku extracts the needed entries from SPEC-E;
- that Haiku writes such properties from the quotes;
- the false-alarm rate of a full ledger.

Those are design §5 (a)–(d), to run after the freeze.

## Not built (on purpose, per the design)

- No requirement DSL or temporal logic.
- No LLM judge reading traces.
- No automatic property repair after a check has run.
- No UI beyond `report.md` and `ledger.json`.
- No pattern-library suggestions.
- No `--loop tracked` builder mode.

The item adapter is E8's: the subject is `orderId` / `orderRef` / `fulfilmentRef` (`trace.mjs` `E8_SUBJECT`), and the
CLI binds E8. A second item would show whether trace API v1 holds without change (design §8.6).
