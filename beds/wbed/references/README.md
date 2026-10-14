# W-bed reference workflows (arm c): R1 and R3

*2026-10-14, Claude Opus 5.5, session `session_011geBy7JvDqKuqhDyfmzd1U`. $0: no model was called while writing or
validating these files, and `beds/sealed/` was not read. PROOF-LEDGER B10, W-BED.md §2.3 and §4 arm (c).*

These are the hand-curated solvers the JIT arms are measured against ("the LangGraph engineer's graph"). Each is a
`solve.mjs` on the flow-v3 SDK. They were written from the task view (prompt, inputs, outputSchema), the W-BED rung spec
and the author fixtures (dev seeds 373–378: inputs and `referenceSolve` outputs). They were not written from the beds'
generator, oracle or bad controls. Both are frozen by sha256 in [FROZEN.json](FROZEN.json), and
`references.test.mjs` fails if either file changes.

| file | what |
|---|---|
| `r1-reference.mjs` | R1 ledger close. A linear pipeline in phases, with judges only where prose has to be read |
| `r3-reference.mjs` | R3 statement audit. One `flow.wide` over the suppliers (a code worker with per-difference judges) and a code reducer |
| `FROZEN.json` | Hashes, the one revision per rung, structure, authorship, the validation summary, and the R3 bed finding |
| `history/*.v1.mjs` | The v1 bytes that the stub validation ran on |
| `stub-policy.mjs` | The $0 judge stub (policies A and B) |
| `validate.mjs` | The validation driver: real `run-compiled.mjs` sandbox, flow-v3, stub gateway; the bed oracle is used analyst-side only |
| `author/` | Author-read judge answers for fixtures and validation seeds, served through the flow-v3 override hook. They measure the code, not a model |
| `validation/*.json` | The recorded runs: fixtures, dev 301–312, and the R1 judge-class sensitivity |
| `references.test.mjs` | Freeze pins, stub-policy units, and sandboxed runs on fixtures |

Run them with `node --test --test-concurrency=2 beds/wbed/references/*.test.mjs`, and
`node beds/wbed/references/validate.mjs --rung r1,r3 --seeds 301-312 --difficulties 3,4 --policies author,A,B --labels --out <file>`.

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
  renderings and the phone table are read from the spec text.
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
4. **Deviations.**
   - The author is this Opus 5.5 session, not a `claude -p` builder session. No model calls were allowed.
   - The author also saw the bed modules' exported `family`, `structure` and `difficulty` descriptors.
   - At the revision, the author wrote author readings for the 24 validation tasks as a diagnostic.

## Stub gateway

`stub-policy.mjs` answers every judge from the request alone and never from a generator, oracle or truth. There are two
fixed policies:
- **A:** the first enum value; the first quoted sentence of the prompt's first `<<< >>>` block; one array element per line.
- **B:** the last enum value and the last sentence.

Every binary judge in the references therefore gets opposite answers under A and B. A task whose delivered answer
differs between A and B depends on judge quality.

The stubs never report a dated switch or fill a free-text extraction field. Cost is list price from `policy/models.json`
on `ceil(chars / 4)` tokens.

## Measured ($0, dev only; 72 tasks = 2 rungs × 36)

| | R1 | R3 |
|---|---|---|
| structurally valid runs (A, B, author; fixtures + dev) | 108/108 ok, 0 deopt, 0 crash | 108/108 ok, 0 deopt, 0 crash |
| v1 stub validation (before the revision) | 46/48 ok (2 deopts `names-read`, seed 311 d3) | 48/48 ok |
| oracle pass under stub A / B | 0/36 / 0/36 | 0/36 / 0/36 |
| judge-dependent tasks (answer differs A vs B) | 36/36 | 36/36 |
| with author readings: oracle pass (exact) | **36/36** (12 fixtures + 24 dev) | 0/36 (see the finding below) |
| with author readings: statements = bed reference | — | **36/36** |
| code-decided part = bed reference, under A and B | — | 72/72 |
| stub $ per task, mean (A / B) [max] | $0.0028 / $0.0035 [$0.0066] | $0.0093 / $0.0010 [$0.0187] |
| judge calls per task, dev: mean d3 / d4 [max] | 6.9 / 9.9 [12] | 12 / 25 [49 with Sonnet escalations under A] |
| sandboxed wall-clock per run (stub judges) | median 0.4–0.7 s | median 0.3–0.7 s |

**What decides an R1 task.** We flipped one judge class at a time in the author readings, over 36 tasks
(`validation/r1-sensitivity.json`):

| judge class flipped | tasks it decides |
|---|---|
| birth-date order | 36/36 |
| row markers | 35/36 |
| invoice status words | 17/36 |
| places | 11/36 |

- With wrong orders, the evidence-triggered Sonnet second opinion fires in 29 of the 36 tasks.
- With correct orders, it fires in none of them.

**What decides an R3 task.** Each task has 12 (d3) or 25 (d4) reason judgements. A task passes only if every one is
right.

## R3 bed finding (blocks R3 success claims)

R3's oracle compares `by_reason` and `totals` with values that the task does not determine.
- **Fixtures.** On all 12 author fixtures, the labelled values differ from the spec rule by +1 to +50 cents per reason.
  The rule is "convert each supplier-and-reason sum once at the quote below, half away from zero".
- **Other readings.** No reading of the printed quotes reproduces them: per discrepancy, per currency, or rounding once.
  The pattern fits truth computed at rates more precise than the 4-decimal quotes that the spec prints.
- **Effect.** With correct reasons, the reference's statements match in 36/36 tasks and its totals in 0/36, so the oracle
  fails it 36/36. Swapping in the bed reference's totals makes it pass, on the 4 fixtures probed.
- **The fix belongs in `beds/wbed/r3`**, which was not edited here. When it lands, the R3 test's `totalsMatchReference`
  assertion flips, and the validation must be rerun.

## What remains paid

- **Judge quality: the true pass rates.** Run on Haiku judges with Sonnet escalation, on the stream seeds. Expected list
  cost by the stub token model:
  - R1: about $0.003–0.006 per task;
  - R3: about $0.001–0.01 per task.
  The per-call overhead of the `claude-cli` provider is unmeasured (W-BED O5).
- **Arm (c) in the stream.** `stream.mjs` must run the `static:` arm on flow-v3; today it runs flow.mjs v1, which is an
  engine change. Arm (c) must also be stamped with the E2 freeze.
- **R4's subsidiaries.** R4 will call these references by hash, so they need registry entries with learned profiles.
- **R3's totals.** These wait for the bed fix above.
