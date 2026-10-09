# W-bed R0/R1: what landed

*2026-10-09, laptop session. $0: no model calls. `beds/sealed/` not read. Nothing under `src/`, `experiments/`, `policy/`,
`schemas/`, `bin/`, `skills/` or any existing bed was changed. Design reference: [W-BED.md](W-BED.md) §2, §3.0, §3.1, §3.8,
§6, §8. Tags as in W-BED: **[M]** measured here or read in the repo, **[I]** inference.*

## 1. Files

| path | what |
|---|---|
| `beds/wbed/lib/prng.mjs` | seeded PRNG and hashing: re-exports `beds/lib/rng.mjs` and `beds/lib/canonical.mjs`, plus `taskRng(rung, part, spec, attempt)` |
| `beds/wbed/lib/domain.mjs` | shared back-office primitives. Imported unchanged from records: `buildWorld` (the customer export), `clusterRows`, `rowsLink`, `ruleSolve`, `toUsdCents`, `rateFor`, `mulRate`/`divRate`, `dayNum`/`fromDay`/`isoDate`, `fmtAmount`, `CURRENCIES`. New: date styles (`fmtDate`/`parseDate`, `swappedDay`), market quote lines, `roundHalfAway`, `refKey` (invoice-reference matching) |
| `beds/wbed/lib/contracts.mjs` | typed stage contracts: `contract(id, schema)` with `check()`, using records' portable-subset `validate` |
| `beds/wbed/lib/faults.mjs` | R8 fault overlay hook points (`schemaDrift`, `adversarialContent`, `toolFailure`), the §8 fault schedule as data, `requireNoFaults` (asking for a fault throws in v1) |
| `beds/wbed/r1/{index,world,vocab,render,pipeline,stages,controls,score}.mjs` | family `wbed-r1` v1.0.0 |
| `beds/wbed/r0/index.mjs` | family `wbed-r0` v1.0.0 |
| `beds/wbed/attacks/triviality.mjs` | dry-run triviality attack driver: plan, call shape, `--stub`, `--emit` |
| `beds/wbed/{lib/lib,r0/r0,r1/r1,attacks/triviality}.test.mjs` | oracle-health and driver tests |

Run: `/opt/node24/bin/node --max-old-space-size=1024 --test 'beds/wbed/**/*.test.mjs'`. Result: **37 tests, 37 pass**, about
22 s [M].

## 2. The R1 task

The group closes its receivables ledger on a stated date, the last day of a month in 2025. The solver gets four inputs.
(1) The customer export: the `records` world at the same difficulty, imported unchanged, with its void markers, aliases,
twins, namesakes, per-task conventions and adversarial memos. (2) Each billing system's invoice list, booked against
customer row ids. There are 4–6 systems, plus TALLY from d4. Each list has its own dialect, date order, number format and
status words. (3) One bank feed. It mixes PAY lines with REMIT advices; some advices repeat a PAY line's reference and some
have no PAY line at all. Some payers pay another customer's invoice, invoice references are written loosely, and some
cash names no invoice. (4) Ledger notes and a spec with FX quotes. The output has one entry per real customer: the
canonical id (the smallest live row id), the live source rows, and invoiced, paid and open amounts in US cents. A totals
block follows. The best-known solution is the typed linear pipeline extract → normalise → reconcile → report.

Sizes [M], means over seeds 301–310:

| d | customer rows | invoices | bank lines | customers | inline tokens |
|---|---|---|---|---|---|
| 2 | 55 | 113 | 78 | 28 | 10.0K |
| 3 | 85 | 160 | 110 | 41 | 13.9K |
| 4 | 115 | 231 | 161 | 52 | 17.7K |
| 5 | 150 | 381 | 267 | 67 | 24.1K |

The drift knob (§2.5) works as follows. At d3, the ATLAS invoice date order is drawn per task, references are loose,
and remit-only advices and unapplied cash appear. At d4 three things are added: TALLY, a new system with DD-MM-YY dates;
an ATLAS print-server switch on a stated day, before which ATLAS printed dates in the other order; and one per-task status
word whose meaning (void or live) only the notes give. At d5 there are two such words, with opposite meanings, and more
of every planted case. The customer layer drifts as records does from d3 to d4. Generation takes at most 0.2 s and
retries a ledger 0 times on seeds 301–330 at every difficulty [M].

R0 (`wbed-r0`) is a single printed invoice of about 350–420 tokens [M]. The solver returns the invoice number, customer
row, ISO date (the order is stated in the notes, and the date is always ambiguous), currency, net, tax and gross in minor
units, and a `void` flag. d4 adds a discount line and a per-task status word, and d5 adds a credited line. Its `structure`
is `shape: 'none'`.

## 3. Oracle composition (W-BED §2.2)

- **End to end (`oracle`)**, exact (§2.2 item 1). Each true customer must appear once with exactly its live rows, its id
  and all three amounts to the cent. There may be no extra customers, and the totals must be exact. A row listed in two
  customers fails outright. Schema-invalid, non-plain or oversized output fails. Order does not matter.
- **Stage oracles (`stages[i].oracle`)** are diagnostics. Each one scores only the facts its own stage owns:
  - extract: one record per input line, with the surface text kept;
  - normalise: for each document, the ISO date, US cents, and whether the document's own fields let it count (status and
    close date);
  - reconcile: the customer partition;
  - report: local arithmetic only (one entry per reconciled customer, open = invoiced − paid, totals = sums).
- **Cross-stage relations** cover what no single stage owns, the joins between inputs (FRONTIER-GAPS §1 item 2):
  - X1, invoice conservation: invoice → row → customer;
  - X2, payment conservation: PAY lines only, one per bank reference, joined to invoices that count;
  - X3, ownership: each customer gets the invoices booked to its rows and the payments on those invoices, whoever paid.
- **`composedOracle(task, trace)`** = every stage oracle AND every relation. Tests show it agrees with `oracle` on the
  reference trace and on every bad control's trace. Exported as `invariants` (mined-invariant candidates, analyst side):
  L1 open identity, L2 totals, L3 partition, and X1–X3. On the 14 traced controls, the stage controls are caught only by
  stage oracles and the relation controls only by relations [M], so the two tiers do not overlap.
- **Decisiveness**: the generator re-draws the ledger until every applicable control fails the oracle (as records does).
  Planted cases guarantee each control has something to bite on:
  - ATLAS and TALLY date traps, one just inside and one just outside the close;
  - paid-status lags;
  - third-party payers;
  - REMIT duplicates;
  - invoices on twin void rows;
  - per-task status words on at least 2 invoices.

## 4. Bad controls (R1: 16; R0: 8)

| control | kind | why it is plausible |
|---|---|---|
| `empty` | stage | CONTRACT minimum |
| `shuffled-or-corrupted` | stage | right customers and totals; invoiced amounts rotated by one customer (open recomputed): a mis-joined report whose sums still tie out |
| `ignore-close-date` | stage | the commonest close error: next period's invoices and receipts taken |
| `atlas-invoice-dates-flipped` | stage | the ATLAS birth-date rule from the customer notes, or the UK default, applied to invoices; the planted traps flip in or out of the period |
| `unconverted-amounts` | stage | currencies summed as dollars |
| `void-status-counted` | stage | status words ignored |
| `no-dedup-customers` | stage | no identity resolution |
| `flag-meaning-flipped` (d≥4) | stage | the status word's name suggests one meaning, the notes state the other |
| `atlas-switch-ignored` (d≥4) | stage | the print-server switch missed |
| `tally-dates-month-first` (d≥4) | stage | the new system's DD-MM-YY read US style |
| `canonical-row-only` | **relation** | invoices joined on customer_id only; invoices on a customer's other rows (and their payments) dropped. Fails X1, X2, X3 |
| `payer-credited` | **relation** | a payment credited to the payer named in the feed. Sums still tie out. Fails X3 only |
| `remittance-double-count` | **relation** | REMIT advices counted next to their PAY line; every line parses and converts correctly. Fails X2, X3 |
| `void-row-invoices-kept` | **relation** | invoices on a void row attached to the real customer that row resembles (its twin). Fails X1, X3 |
| `round-at-end` | **relation** | each customer's per-currency sums converted once instead of per document; off by cents. Fails X1/X2/X3 |
| `status-paid-trusted` | **relation** | "paid" status taken as paid in full while the feed shows a part payment. Fails X2, X3 |

Six relation controls pass every stage oracle and the report's local checks on their own traces, and fail at least one
relation and the end-to-end oracle. The tests check this on 6 seeds × 4 difficulties. Every control fails, and
`referenceSolve` passes, on 20 seeds (301–320) at each of d2–d5 [M]. R0's controls are `empty`, `shuffled-or-corrupted`,
`date-order-flipped`, `tax-ignored`, `quantity-ignored`, `discount-ignored` (d≥4), `status-word-misread` (d≥4) and
`credited-line-billed` (d5). Each fails on 20 seeds per difficulty [M].

## 5. Expected Haiku cost per task

Base figures are the ones W-BED §3 cites [M]: one Haiku call $0.026–0.030 on records and kinetics; the Haiku agent
$0.103 per task on records and $0.088 on kinetics; Haiku 5.5 list price $0.10 in and $0.50 out per MTok. Records d3 is
about 7K inline tokens [M].

| arm on R1 d3 (≈14K tokens) | estimate |
|---|---|
| one Haiku call, token-priced | ≈ $0.005 (driver: $0.121 for 24 calls) [M] |
| one Haiku call, with the measured claude-cli per-call overhead | ≈ $0.03–0.04 [I: overhead-dominated, so roughly flat in input size] |
| Haiku agent | ≈ $0.12–0.18 [I: ×1.2–1.8 records, for twice the input and four stages] (W-BED §3.1 gives the same range) |
| R0, one call | ≈ $0.02–0.03 (370-token task; overhead-dominated) [I] |

Triviality attack (§2.4 item 1): 24 calls per rung. That is $0.62–0.72 per rung at the measured overhead, about $1.4
for R0 plus R1 [M, driver output].

## 6. Registration (coordinator)

`experiments/lib/beds.mjs` `loadFamily` resolves `beds/<id>/index.mjs`, but these beds live at `beds/wbed/<rung>/`.
`experiments/lib` is a frozen tree in ENGINE-FREEZE E1 (`6c414274…`). Pick one of two options:

- **(a) No engine change, preferred during the freeze.** Add one shim file per family, outside `beds/wbed/`:
  `beds/wbed-r1/index.mjs` containing `export * from '../wbed/r1/index.mjs';`, and the same for `beds/wbed-r0`.
- **(b) One-line edit in `loadFamily`**, on a branch merged after E1's last trial:
  `const file = path.join(root, 'beds', ...(id.startsWith('wbed-') ? ['wbed', id.slice(5)] : [id]), 'index.mjs');`

Both families also need the §8 seed ranges in `SEED-LEDGER.json`; this session did not edit it. The tests load both
families by path, so they pass without either step.

## 7. Triviality driver

`node beds/wbed/attacks/triviality.mjs --rung all` prints the plan: 12 seeds (379–390) × efforts none and medium × one
`claude-haiku-5-5` call = 24 calls per rung. It also prints sizes, cost, the gate (R1: ≤ 2/12 pass at each effort; R0:
≥ 10/12) and the exact `claude -p` line. The invocation and child env come from `policy/models.json`, and the effort flag
and `MAX_THINKING_TOKENS` from `src/models/port.mjs` `DECODING_BY_KIND` (both read only). The system prompt is
`b0-call.mjs`'s, and a test pins that the two match. The in-repo route is also printed: `b0Call` arms through
`runExperiment` with `createModelPort`, after registration.

- `--stub empty|reference|<control>` scores the plan with no model call.
- `--emit DIR` writes the prompts, schemas, `calls.jsonl` and a `run.sh` for the coordinator, and runs nothing. The token
  is never written; `run.sh` inherits `CLAUDE_CODE_OAUTH_TOKEN` or the login from the environment.

The JIT `interpret` session is arm (d), not part of this attack.

## 8. W-BED §3.1 as written vs what was buildable

1. **"Records world at d2–d3, 250–400 rows."** The records world is frozen and its LEVELS give 55 and 85 *customer*
   rows at d2 and d3. The 250–400 figure is reached only by counting every line: about 355 at d3 (85 + 160 + 110) [M].
   Growing the customer export would mean editing records.
2. **"Inline render about 25–40K tokens."** Measured 10K / 14K / 18K / 24K for d2–d5 [M]. The task is smaller than the
   triviality reasoning in §3.1 assumed. If the one-call attack passes more than 2/12, raise `LEVELS[d].inv` (invoice
   density) in `beds/wbed/r1/world.mjs` and bump the version. That knob is in the W-bed, not in records.
3. **"Oracle: records' `scoreAgainst` matching, extended to balances"** conflicts with §2.2 item 1 ("exact … set-exact
   on lists"). `scoreAgainst` passes at ≥ 97% field accuracy and pair F1 ≥ 0.95 with 2% entity slack. I implemented the
   exact rule. That makes R1 at least as hard as records with zero slack (open question 1).
4. **"Stage oracles: parsed rows, normalised values, clusters, report."** Implemented. However, attaching invoices and
   payments to customers belongs to no single stage's facts. Scoring it inside a stage would make the "passes every
   stage check but fails a relation" controls impossible by construction. So the join lives in the cross-stage
   relations, and the report stage oracle is local only. As a result, the stage oracles alone do not localise a join
   error; the relations do.
5. **"Attach invoices and payments by row id."** The bank feed carries no row ids, so payments attach through the invoice
   reference, and invoices attach by row id.
6. **Reference outline** (judges per convention note, band-pair judge, invariant). This describes the arm (c) workflow
   Opus will write, not the bed. The bed declares it in `structure.outline`. `referenceSolve` is the exact solver over
   the hidden world.
7. **§2.4 items 2 and 4** (the 20-line deterministic script and the white-box catalog script) were not built. Only the
   one-call attack driver exists, as briefed. Structure necessity (item 3) names no R1 attack: R1's feature is the
   pipeline itself, so "the best workflow without it" is the one-call attack.
8. **R8 (§3.8).** The hooks are wired into both generators: `schemaDrift` after the ledger is drawn, `adversarialContent`
   on the inputs. Without faults the generators are byte-identical, and a test pins it. f2 (tool failure) is host-side by
   design: the bed exports `hooks.toolFailure` and the schedule, but the service layer, which is frozen, must call it.

## 9. Open questions

1. Exact end-to-end pass, or records-style thresholds? Exact is what §2.2 says. With 41 customers at d3, one wrong
   nickname fails the task.
2. Should R1's customer layer use records d2 at W-bed d3? That would lower the ER share and make R1 test the ledger more
   than records again.
3. Fixture seeds 373–378 for the arm (c) author: should the fixture set include the stage traces (`referenceTrace`), or
   only inputs and final outputs as §2.3 says? I recommend final outputs only.
4. Is 14K tokens at d3 enough against the one-call gate? Decide after the $1.4 attack, before the reference workflow is
   commissioned.
