# W-bed reference workflows (arm c): R1 and R3

*2026-10-14, Claude Opus 5.5, session `session_011geBy7JvDqKuqhDyfmzd1U`. $0: no model was called while writing or
validating these files, and `beds/sealed/` was not read. PROOF-LEDGER B10, W-BED.md §2.3 and §4 arm (c).*

*Updated 2026-10-14 after an adversarial review (refs-R1-R3 round; § "Review fixes" at the end). The reference bytes are
unchanged. The R3 bed was fixed: wbed-r3 1.1.0 (P0). The evidence is now labelled in-sample or out-of-sample, and the
harness is pinned.*

These are the hand-curated solvers the JIT arms are measured against ("the LangGraph engineer's graph"). Each is a
`solve.mjs` on the flow-v3 SDK. They were written from the task view (prompt, inputs, outputSchema), the W-BED rung spec
and the author fixtures (dev seeds 373–378: inputs and `referenceSolve` outputs). They were not written from the beds'
generator, oracle or bad controls. Both are frozen by sha256 in [FROZEN.json](FROZEN.json), and
`references.test.mjs` fails if either file changes.

| file | what |
|---|---|
| `r1-reference.mjs` | R1 ledger close: a linear pipeline in phases, with judges only where prose has to be read |
| `r3-reference.mjs` | R3 statement audit: one `flow.wide` over the suppliers (a code worker with per-difference judges) and a code reducer |
| `FROZEN.json` | Hashes, the one revision per rung, structure, authorship, the validation summary (in-sample and out-of-sample), the R3 bed finding and its fix, the engine re-validations, and harness pins |
| `history/*.v1.mjs` | The v1 bytes that the stub validation ran on |
| `stub-policy.mjs` | The $0 judge stub (policies A and B) |
| `validate.mjs` | The validation driver: real `run-compiled.mjs` sandbox, flow-v3, stub gateway; the bed oracle is used analyst-side only. Modes `--relations` and `--revalidate` |
| `author/` | Author-read judge answers for the fixtures and validation seeds, served through the flow-v3 override hook. They measure the code, not a model |
| `analyst/` | Analyst-side judge answers from the generator world for any dev seed (policy `world`). They let the frozen code be measured out of sample at $0, and never reach a reference except as judge answers |
| `validation/*.json` | The recorded runs (table below) |
| `references.test.mjs` | Freeze, engine, bed-version and harness pins; stub-policy units; sandboxed runs |

| recorded run | sample | what |
|---|---|---|
| `validation/fixtures-373-378.json` | in-sample (the author's fixtures) | R1 and R3, policies author, A, B; R3 rows on wbed-r3 1.0.0 |
| `validation/dev-301-312.json` | in-sample (the revision set) | R1 and R3, policies author, A, B; R3 rows on wbed-r3 1.0.0 |
| `validation/r1-sensitivity.json` | in-sample | R1 with one judge class flipped at a time |
| `validation/r3-bed-1.1.0.json` | in-sample | R3 on wbed-r3 1.1.0, fixtures and 301–312, policies author, A, B |
| `validation/dev-313-324.json` | **out-of-sample** | R1 and R3 on dev 313–324 at d3, d4 and d5, policies world, A, B |
| `validation/relations-author.json` | in-sample | the beds' M1 relations through each reference, author readings |
| `validation/relations-world-313-324.json` | **out-of-sample** | the same with world readings on 313–324 |

Run the tests with `node --test --test-concurrency=2 beds/wbed/references/*.test.mjs`. Run a validation with
`node beds/wbed/references/validate.mjs --rung r1,r3 --seeds 313-324 --difficulties 3,4,5 --policies world,A,B --labels --out <file>`.

## Design

**R1** (`FROZEN.json` → `references.r1.structure`) works in five stages.
- **Extract.** Code parses the customer export, every invoice list and the bank feed. Each list's format is read from the
  ledger notes: CSV or semicolon headers, JSON lines, `Lines "…"` templates, and the VENDEX phrasings. Guards check the
  row, invoice and feed counts that the prompt states.
- **Read the prose.** Judges handle the prose, and each judge has a code check:
  - the order of numeric birth dates, plus any dated switch, per system;
  - row markers and invoice status words that the fixed note templates do not define;
  - one batched place→country call;
  - extraction of a line the parser cannot read.
- **Second opinions.** A judged birth-date order that cross-system evidence contradicts unanimously gets one Sonnet second
  opinion. The evidence never overrides the notes, because the export plants namesakes whose dates agree only under the
  wrong order.
- **Identity.** Customer spec §2, §3 and §6 and appendix A are implemented exactly in code. The nickname table, the accent
  renderings and the phone table are read from the spec text. One exception, found out of sample: the name particles
  (`van`, `der`, …) are a fixed list, not read from the spec (§ "Out of sample").
- **Reconcile and report.** Amounts are converted exactly with BigInt arithmetic, rounding half away from zero.
  Invariants conserve rows, invoices and payments and check the report arithmetic.

**R3** (`references.r3.structure`) is prepare → `flow.wide('statements')` → reduce.
- **Prepare.** Code reads the spec, vendors, ledger and AP notes.
- **The worker**, one per supplier:
  - parses the supplier's statement in its dialect;
  - checks every amount and sign against the printed running balance and the closing line (an invariant);
  - matches documents by normalised reference and kind;
  - decides DUPLICATE and TIMING by rule;
  - asks one judge per difference that a note could explain. The candidate is PRICE, FX or MISSING_CREDIT; the alternative
    is UNEXPLAINED. Code checks that the quote is one of this supplier's notes and names neither another document nor, for
    a credit, another amount;
  - asserts Z1 for its supplier.
- **Reduce and verify.** The reducer converts each supplier-and-reason sum once. The verifier asserts Z3 and Z4.

**Decisions.**
- *No identity judge in R1.* `structure.outline` puts a judge on borderline pairs, but customer spec §3.1 defines the
  name match exactly, so code applies it.
- *No `flow.call` in R3.* No library entry exists for a frozen reference to call, so the dialect parsers are inline.
- *`flow.wide`, not `map`, in R3.* The W-BED outline has `map(statements, { concurrency: 8 })`. `wide` is the slice-2b
  operator whose admission semantics changed in FLOW-V3-SLICE2 §17.5, and it has never run in a paid stream (see "What
  remains paid").
- *Failures fall back to code.* Judges whose failure has a safe code fallback run as `softJudge`: a one-item `map` with
  `onItemError: 'null'`. Such a failure flags the run and does not end it.
- *Other problems deopt.* Anything the reference cannot read deopts. In the stream, the `static:` arm then falls back to
  the Haiku interpreter.

## Protocol followed (W-BED §2.3) and deviations

1. **Development on the author fixtures** (373–378 at d3 and d4), with the inputs and `referenceSolve` outputs.
2. **Freeze of v1, then one validation** on dev seeds 301–312 at d3 and d4. The judges were stubs, so the "< 10/12"
   trigger fired for both rungs.
3. **One revision per rung**, with the validation seeds' inputs.
   - R1 got three code fixes: a Unicode capital in a VENDEX name, ISO codes as country aliases, and a birth-date code
     reader limited to the right sentences.
   - R3 got only a cosmetic step name.
   - FROZEN.json lists both revisions and the v1 hashes.
4. **The one revision is spent.** (Review finding 3.)
   - For R1, dev 301–312 are development seeds. The three fixes came from 311 d3, 308 d4, 301 d4 and 303 d3, and the
     author read all 24 validation tasks to write `author/validation-answers.json`. That file's first "about" text said
     "seeds the author did not develop on"; that was wrong and has been corrected.
   - A paid run on 301–312 is therefore not a validation, and nothing may be revised after it.
   - **Any paid run of these files is report-only**: on dev seeds the author never saw, with no revision. The $0
     out-of-sample set used here is 313–324. The PREREG-WBED-SLICE1 §4.2 plan "validate on 301–312, revise once below
     10/12" conflicts with the freeze and is the PREREG owner's to change.
5. **Deviations.**
   - The author is this Opus 5.5 session, not a `claude -p` builder session. No model calls were allowed.
   - The author also saw the bed modules' exported `family`, `structure` and `difficulty` descriptors. `difficulty.levels`
     includes the generator's trap catalogue and rates: voidRowInv, thirdParty, remitOnly, flags, atlasSwitch, and the
     partial and split probabilities. That is more than the rung spec and labelled fixtures W-BED §2.3 allows, and it adds
     to arm (c)'s ceiling asymmetry (review finding 11; for the PREREG's threats section).
   - At the revision, the author wrote author readings for the 24 validation tasks as a diagnostic.

## Stub gateway

`stub-policy.mjs` answers every judge from the request alone and never from a generator, oracle or truth. There are two
fixed policies:
- **A:** the first enum value; the first quoted sentence of the prompt's first `<<< >>>` block; one array element per line.
- **B:** the last enum value and the last sentence.

What the stubs show, and what they do not (review finding 10):
- Every binary judge gets opposite answers under A and B. "Judge-dependent 36/36" therefore follows from the
  construction. It shows only that every task asks at least one judge whose answer reaches the output.
- The stubs never report a dated switch and never fill a free-text extraction field.
- Cost is list price from `policy/models.json` on `ceil(chars / 4)` tokens, without the `claude-cli` system prompt.
  DEV-NOTES D22 measured a tiny Haiku call through `claude-cli` at about $0.00011, and the first call at about $0.00017
  (a cache write of the CLI's ~2.5K-token system prompt). So add about $0.0001 per Haiku call: about +$0.001 per R1 task
  and +$0.001 to +$0.007 per R3 task. The Sonnet overhead is unmeasured.

## Measured ($0)

### In-sample (development): fixtures 373–378 and the revision set 301–312, d3 and d4; 36 tasks per rung

| | R1 | R3 |
|---|---|---|
| structurally valid runs (A, B, author) | 108/108 ok, 0 deopt, 0 crash | 108/108 ok, 0 deopt, 0 crash (wbed-r3 1.1.0) |
| v1 stub validation (before the revision) | 46/48 ok (2 deopts `names-read`, seed 311 d3) | 48/48 ok |
| oracle pass under stub A / B | 0/36 / 0/36 | 0/36 / 0/36 |
| with author readings: oracle pass | **36/36** (exact `referenceSolve` match) | **36/36** on wbed-r3 1.1.0 (0/36 on 1.0.0; § "R3 bed finding") |
| with author readings: statements / totals = bed reference | — | 36/36 / 36/36 (1.0.0: 36/36 / 0/36) |
| code-decided part = bed reference, under A and B | — | 72/72 |
| stub $ per task, mean (A / B) [max] | $0.0028 / $0.0035 [$0.0066] | $0.0093 / $0.0010 [$0.0187] |
| judge calls per task: mean d3 / d4 [max] | 6.9 / 9.9 [12] | 12 / 25 [49 with Sonnet escalations under A] |
| sandboxed wall-clock per run (stub judges) | median 0.4–0.7 s | median 0.3–0.7 s |

The R3 "author readings" are reasons copied from the bed's labelled outputs, not read from the notes. So R3's in-sample
pass checks the code-decided parts and the reason judges' quote checks, never the reading itself (review finding 10).

**What decides an R1 task.** We flipped one judge class at a time in the author readings, over 36 tasks
(`validation/r1-sensitivity.json`):

| judge class flipped | tasks it decides |
|---|---|
| birth-date order | 36/36 |
| row markers | 35/36 |
| invoice status words | 17/36 |
| places | 11/36 |

- With wrong orders, the evidence-triggered Sonnet second opinion fires in 29 of the 36 tasks; with correct orders, in
  none.
- The flip also answers the second opinion wrongly, because `dob-order-second` maps to `dob-order` in the override. So
  how often a correct Sonnet second opinion would rescue a wrong Haiku reading is **unmeasured** (review finding 10).

**What decides an R3 task.** Each task has 12 (d3) or 25 (d4) reason judgements. A task passes only if every one is
right.

### Out of sample: dev 313–324 at d3, d4 and d5 (36 tasks per rung; `validation/dev-313-324.json`)

No author and no revision saw these seeds. 325–348 (the dev-B stream) and 349–372 (`jit-oos`) were left untouched.
Policy `world` answers each judge from the generator world, host side (`analyst/world-readings.mjs`). On the 36
in-sample R1 tasks, world readings give the same output digest as the author readings in 36/36 tasks, with the same 221
judge calls. So they are correct readings, and the runs below measure the frozen code (review finding 4).

| | R1 | R3 |
|---|---|---|
| **with correct (world) readings: oracle pass** | **34/36** (d3 12/12, d4 10/12, d5 12/12) | **36/36** (48 suppliers at d5) |
| runs ok under stubs A / B | 35/36 / 35/36 (1 deopt `guard:names-read`, 320 d4) | 36/36 / 36/36 |
| stub $ per task, mean (A / B) [max] | $0.0034 / $0.0033 [$0.0074] | $0.0138 / $0.0013 [$0.0265] |
| judge calls per task [max] | 13 | 73 (d5, A with Sonnet escalations) |

Both R1 failures have the same cause: the generator types one error into a name, and the customer spec tolerates one per
name, but the reference's name particles are a fixed list (`r1-reference.mjs:265`, `:521`). This is the same class as
the v1 "Ryōta Ōta" deopt.
- **320 d4, deopt.** In "Supplier contact Femke van dn Berg", "dn" is not a particle, so the VENDEX reader cannot read the
  name. The span-extraction judge `vendex-entry` gets no stub or world answer, and guard `names-read` deopts. With a live
  judge the outcome is unmeasured. In the stream, a deopt hands the task to the Haiku interpreter.
- **322 d4, wrong answer.** ATLAS "Nora vn der Meer" splits as given "Nora vn", family "der Meer". It therefore does not
  match VENDEX "Nora van der Meer", and one customer is reported as two. Every judge was answered correctly, none
  failed, no guard or invariant fired, and every M1 relation agrees.

**Reading.** With perfect judges, the frozen R1 reference is wrong or deopts on 2/36 unseen tasks (Wilson 95%: 1.5–18%),
and 1/36 is silent. This sets a ceiling on arm (c) and on its expected fallback share (for PREREG §11). The references are
frozen, so this is recorded, not fixed.

### Metamorphic relations (ATTACK M1) through the references (review finding 7)

`validate.mjs --relations` runs every relation the bed declares through the same sandbox, policy and answers. A correct,
order-free solver must keep each relation.

| | R1 (5 relations) | R3 (3 relations) |
|---|---|---|
| in-sample, author readings (`relations-author.json`) | 180/180 agree | 108/108 agree |
| out-of-sample, world readings (`relations-world-313-324.json`) | 173 agree, 2 skip (no idle singleton), over 35 ok runs | 108/108 agree |

No relation was falsified. The wrong R1 answer on 322 d4 keeps every relation: an order-free code defect is invisible to
M1, which is its stated kill mode.

## R3 bed finding (fixed in wbed-r3 1.1.0)

- **The finding (author).** On wbed-r3 1.0.0, R3's oracle compared `by_reason` and `totals` with values the task did not
  determine. With the correct reason on every discrepancy, the reference's statements matched in 36/36 tasks, but its
  totals matched in 0/36. Each reason was off by +1 to +50 cents. Swapping in the bed's totals made it pass on the 4
  fixtures probed.
- **Root cause (review).** `beds/wbed/lib/fx.mjs` `drawQuotes` stored USD-per-unit rates at six decimals, while
  `lib/domain.mjs` `quoteLine` prints four. For example, EUR/USD was 1.104221, printed as "1.1042" (seed 373 d3). 70 of
  106 non-USD quotes on 301–312 and 373–378 had hidden digits.
- **Fix (W-BED-R2R3-NOTES §10).** `drawQuotes` now quantizes as records does. This gives wbed-r3 1.1.0, and R4 1.0.1 and
  R5 1.0.1 for their R3 packs.
  - Worlds, statements and reasons are unchanged; only the printed quotes and the US-cent totals move.
  - The frozen reference with author readings now passes 36/36. That pass is pinned in `references.test.mjs`.
  - Two bed tests check that every rate is what its line prints and that rule 5 at the printed quotes reproduces the
    totals.
- **Results still invalid.** Any R3 result on 1.0.0 (and any R4/R5 1.0.0 task with an R3 pack) stays invalid for totals.

## Re-validation

`references.test.mjs` fails when any of these change:
- a reference file;
- `flow-v3.mjs` or `run-compiled.mjs`, unless the pair matches the freeze or an entry in `FROZEN.json` `engine.revalidated`
  with 0 mismatches;
- a bed's family version, against the version `references.<rung>.bedFamilyVersion` names;
- a harness file or a recorded run.

To re-validate after an engine change:
1. Run `node beds/wbed/references/validate.mjs --revalidate`. It re-runs every recorded deterministic row (432: R1 from
   the fixture, 301–312 and out-of-sample runs, R3 from the 1.1.0 and out-of-sample runs; policies author, world, A and
   B; $0, about 1.5 min). It
   compares status, deopt, pass and output digest with the record.
2. With 0 mismatches, add its output to `engine.revalidated`.
3. Any mismatch is a behaviour change. Report it, and do not re-pin.

After a bed version bump, rerun the rung's recorded runs on the new version, as `validation/r3-bed-1.1.0.json` does, and
update `bedFamilyVersion`. One re-validation is recorded: `run-compiled.mjs` moved in autosave `bc06129` (the M1 review's
variants path, which the references never use), and 432/432 rows matched.

## What remains paid

- **Judge quality: the true pass rates.** Run on Haiku judges with Sonnet escalation, report-only, on dev seeds the
  author never saw (not 301–312), then on the stream seeds. Expected list cost by the stub token model plus D22's per-call
  overhead:
  - R1: about $0.004–0.009 per task;
  - R3: about $0.002–0.035 per task.
- **Arm (c) in the stream.** `stream.mjs` must run the `static:` arm on flow-v3; today it runs flow.mjs v1, which is an
  engine change. Arm (c) must also be stamped with the E2 freeze.
- **An R3 (c) smoke before any R3 stream** (review finding 12). R3's `flow.wide` has never met live judges or the
  stream. Its §17.5 admission semantics (the first judge item runs alone, then a budget-fit admission) cost one item's
  latency per wide, and D22 puts that at about 1.4 s per Haiku call.
- **R4's subsidiaries.** R4 will call these references by hash, so they need registry entries with learned profiles.

## Review fixes (2026-10-14, refs-R1-R3)

| finding | rating | outcome |
|---|---|---|
| 1. R3 oracle unpassable (hidden quote digits); R4/R5 inherit it | P0 | **fixed**: wbed-r3 1.1.0 (`lib/fx.mjs`), R4/R5 1.0.1, regression tests in `lib`, `r3` and here; re-validated 36/36 |
| 3. the paid validation on 301–312 is not a validation; the "about" text was false | P1 | **fixed here**: text corrected, the protocol states the revision is spent and later runs are report-only; the PREREG §4.2 edit is the PREREG owner's |
| 4. all evidence in-sample; R1 deopts out of sample | P1 | **fixed here**: in-sample labels; out-of-sample $0 measurement with correct readings (R1 34/36, R3 36/36), the two R1 failure modes pinned in a test; the fallback share is for PREREG §11 |
| 7. relations never checked against a correct solver | P2 | **fixed**: `--relations`, recorded runs, a test |
| 10. overstated validation | P2 | **fixed** in this README: judge dependence by construction, R3 readings are labels, the second-opinion value unmeasured, D22 overhead added, the authoring cost a lower bound |
| 11. the author saw the generator's trap catalogue | P2 | **recorded** (Protocol, FROZEN `authorship.seenNote`); the PREREG §11 wording is the PREREG owner's |
| 12. R3 uses `wide`, never run paid | P2 | **recorded** (Decisions; What remains paid: an R3 (c) smoke) |
| 13. freeze record gaps; a missing "Re-validation" section | P2 | **fixed**: run-compiled, bed versions, harness and recorded runs pinned; `--revalidate`; this section |

**Also found.** The override hook does not check an answer against the judge's schema. In 10 of 180 R1 tasks at d4–d5 on
dev 301–390, a row marker and an invoice status word share one judge name, for example `marker:ATLAS:QUERY` on fixture
374 d4. The author table, which is keyed by name, then answers the invoice question with the row answer `KEEP`, outside
its enum. The code maps that to DOES_NOT_COUNT, which is right here by coincidence. The world readings answer by schema
and give the same outputs. Live judges are unaffected, because the two calls have different prompts and ids. This
concerns the harness only and is recorded, not fixed.
