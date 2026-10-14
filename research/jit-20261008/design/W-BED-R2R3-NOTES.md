# W-bed R2/R3: what landed

*2026-10-09, laptop session. $0: no model calls. `beds/sealed/` not read. Nothing under `src/`, `experiments/`, `policy/`,
`schemas/`, `bin/`, `skills/` or any bed outside `beds/wbed/` was changed. Design reference: [W-BED.md](W-BED.md) §2.1–2.5,
§3.2, §3.3; R0/R1 conventions as in [W-BED-R1-NOTES.md](W-BED-R1-NOTES.md). Tags: **[M]** measured here or read in the
repo, **[I]** inference.*

## 1. Files

| path | what |
|---|---|
| `beds/wbed/lib/parties.mjs` | new helper: fictional companies (stem, sector, goods, legal form, language, domain, contact person from records' name cultures) |
| `beds/wbed/lib/fx.mjs` | new helper: per-task market quotes (±3% around records' rates, `mulRate`/`divRate`), quote lines, exact USD cents |
| `beds/wbed/lib/dialects.mjs` | new helper: R1's billing-system amount dialects as a function (`amountIn`), pinned to R1's own render by a test |
| `beds/wbed/r2/{index,world,vocab,render,pipeline,stages,controls,score,keyword}.mjs` | family `wbed-r2` v1.0.0 "inbox router" |
| `beds/wbed/r3/{index,world,vocab,render,pipeline,stages,controls,score}.mjs` | family `wbed-r3` v1.0.0 "statement audit" |
| `beds/wbed-r2/index.mjs`, `beds/wbed-r3/index.mjs` | one-line registration shims (option (a) of R1-NOTES §6); `loadFamily('wbed-r2' / 'wbed-r3')` works |
| `beds/wbed/r2/r2.test.mjs`, `beds/wbed/r3/r3.test.mjs` | oracle-health tests (19 + 22) |
| `beds/wbed/attacks/triviality.mjs` | **modified** (existing file inside `beds/wbed/`): the rung list is now a data table `RUNGS {family, expect, gate, necessity}`; `--rung all` covers r0–r3; stubs can name necessity controls. Still dry-run only |

Existing lib exports are unchanged (R0/R1 tests green). Seeds: `SEED-LEDGER.json` `wbed-dev` already lists wbed-r2/r3
(dev 301–390); held-out blocks per the R1 registration commit. Tests use 301–320 and the attack plan 379–390.

Run: `/opt/node24/bin/node --max-old-space-size=1024 --test 'beds/wbed/**/*.test.mjs'`. Result: **78 tests, 78 pass**
(R0/R1/lib/triviality 37, R2 19, R3 22), about 20 s [M].

## 2. The R2 task ("inbox router")

One day of a fictional group's accounts inbox: 30/40/50/60 e-mails (d2–d5) with attachment text from suppliers,
customers and others, plus the group's supplier list, open payables (supplier bills), open receivables (customer
invoices), a few desk notes and a written processing spec. Each document is one of invoice, credit note, remittance
advice, dispute, statement request, bank-detail change (from d4), unrelated or planted injection. The kind is never a
field: every kind has a plain template, decoy templates that carry another kind's keyword (or none: "the paperwork you
asked for is attached", "Apologies for the wrong reference..."), hedged decidable versions ("I may be wrong, but..."),
and from d4 German, French and Spanish invoices and credit notes. Handling differs per route: an invoice is posted at its
total (not net), a credit note is posted negative on the supplier bill its reference resolves to (exact, one-character
typo, or date and amount from d3), a remittance is allocated named-invoices-first, capped by open amounts, then
oldest-first, remainder unapplied (named invoices of another customer count from d3), a dispute holds the customer
invoice it cites with a reason code (PRICE, QUANTITY, DAMAGED, NOT_RECEIVED, DUPLICATE) read from prose, a statement
request queues `send_statement`, a bank change holds the supplier (VERIFY_BANK), unrelated and injections do nothing.
2/3/4/4 documents are genuinely undecidable by construction (U1–U3 templates: both readings consistent with the text)
and must go to the review queue; nothing else may. Output: `{routing[], entries[], holds[], review_queue[]}`.

## 3. The R3 task ("statement audit")

Month-end supplier statement audit for 8/16/32/48 suppliers (d2–d5, the fan-out width) against one AP ledger (line ids
L0001...). Each supplier prints its statement from one of the back office's billing systems in R1's dialects (date order,
number format, CR suffix for credits from d4; ATLAS from d3 with a per-task date order, TALLY from d4, KOBO yen and
VENDEX statements written in sentences at d5), with a cover note; the ledger names some suppliers by other names
(abbreviation or former name, from d3); AP notes and the audit spec state the rules and the per-task FX quotes. Per
supplier: split the ledger, match documents by reference key and kind, rule-decide DUPLICATE (count difference) and
TIMING (one-sided, dated after the cut-off), judge PRICE / FX (non-USD suppliers, d ≥ 3) / MISSING_CREDIT / UNEXPLAINED
from the cover note and AP notes, and compute the adjusted balance = ledger + accepted (PRICE, FX, MISSING_CREDIT). Fan-in
(code): per-reason counts and US cents by the stated rule (per supplier per reason: sum in the supplier's currency,
convert once with the quote, then add), and totals. Output: `{statements[], by_reason[], totals}`; oracle exact.

## 4. Oracle composition (W-BED §2.2)

Both rungs follow R1: the end-to-end oracle is the exact scorer (`score.mjs`); `stages` are analyst-side diagnostics;
`composedOracle = (every stage oracle) AND (every cross-stage relation)` and the tests check it agrees with the
end-to-end oracle on the reference trace and on every control's trace.

| rung | stages (oracle owns) | relations (what no stage owns) |
|---|---|---|
| R2 | split (one record per document) · route (route of every document, review included: the judged branch) · read (facts each routed document states) · post (local: echoes routing, review queue = routed review, entries/holds only from producing routes, right number) | Y1 facts reach the books (bills, statement requests, bank holds); Y2 credit lands negative on the bill its reference resolves to; Y3 remittance allocated by the stated rule and conserves its amount; Y4 dispute hold lands on the resolved invoice with the read reason |
| R3 | split (per supplier, ledger line ids) · match (balances and differing documents) · classify (reason per discrepancy: the per-item judgment) · reduce (local: six codes once, counts agree, totals are sums) | Z1 item conservation (statement − ledger = Σ discrepancies; the reported item is the classified item); Z2 adjusted = ledger + accepted; Z3 fan-in conservation (by_reason recomputed from the classified items); Z4 coverage (every split item exactly once) |

R2's oracle is exact on routing *and* handling: entries are a multiset in exact minor units (references matched by
`refKey`), holds and review queue set-exact, routing exact per document. Escalating a decidable document and not
escalating an undecidable one are both errors.

## 5. Controls

Each control is the bed's own pipeline with one option set, so each has a full trace; generation re-draws (80 attempts;
measured 0–3 retries) until every applicable control fails. **Tests: on 20 seeds × d2–d5, the reference passes and every
bad and necessity control fails, both rungs [M].**

**R2: 18 bad controls** (16 at d2–d3, 18 at d4–d5). Stage: `empty`, `shuffled-or-corrupted` (entry amounts rotated),
`keyword-router`, `escalate-hedged`, `injection-obeyed`, `statement-request-ignored`, `foreign-cues-missed` (d4),
`bank-change-unrelated` (d4), `bill-net-not-total`, `dispute-reason-keyword`. Relation (pass every stage oracle and
post's local checks, fail Y1–Y4): `credit-on-latest-bill`, `credit-sign-positive`, `typo-refs-unresolved` (d3),
`allocate-oldest-first`, `allocate-uncapped`, `named-own-only` (d3), `no-unapplied`, `dispute-hold-latest`.
**Necessity (6):** `one-handler:invoice|remittance|dispute|ignore` (no branch), `no-escalation` (branch without the
review arm), `review-everything` (escalation without the branch).

**R3: 15 bad controls** (12 at d2, 14 at d3, 15 at d4–d5). Stage: `empty`, `shuffled-or-corrupted` (adjusted balances
rotated; totals still tie out), `split-exact-name-only` (d3), `duplicate-collapsed`, `cr-suffix-ignored` (d4),
`timing-window-ignored`, `timing-all-one-sided`, `memo-means-price`, `credit-always-missing`, `payment-diff-always-fx`
(d3). Relation (pass every stage oracle and `reduceLocal`, fail Z1–Z4): `adjusted-accept-all`,
`adjusted-timing-accepted`, `reduce-rate-rounded`, `exceptions-only`, `sign-flipped`. **Necessity (3):**
`sequential-single-context` (d4–d5), `no-reducer-lost-middle`, `no-reducer-currency-mixed`; the two reducer-less controls
get every per-item stage right and fail Z3 specifically (tested).

## 6. Measured sizes and the keyword rule

**R2 keyword-rule failure fraction** (`keyword.mjs`: first matching English kind keyword in subject and body, in a fixed
priority order, else unrelated; never escalates). Share of documents misrouted, 20 seeds per difficulty [M]:

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| all documents | 0.417 | 0.455 | 0.583 | 0.645 |
| decidable documents only | 0.375 | 0.411 | 0.547 | 0.620 |

On plain templates alone the rule routes ≥ 95% correctly (tested), so the failure comes from decoys, hedges, foreign
cues, the new kind and undecidables, i.e. from the judged conditions, not from an unreadable surface. The
`keyword-router` control fails the oracle on every seed.

**Inline task sizes** (`inlineRender`, utf8 bytes / 4), seeds 301–320 [M]:

| | d2 | d3 | d4 | d5 |
|---|---|---|---|---|
| R2 mean (min–max) | 5,334 (5,190–5,495) | 6,557 (6,398–6,735) | 7,702 (7,579–7,857) | 8,910 (8,739–9,082) |
| R3 mean (min–max) | 6,008 (5,315–6,417) | 13,256 (12,330–14,306) | 38,670 (36,082–40,723) | 63,362 (60,284–68,008) |

R3 detail (means over seeds 301–310) [M]: statements 8/16/32/48; statement lines 105/278/918/1,530; ledger lines
100/271/904/1,511; discrepancies 11/22/48/77; tokens per item 513/660/1,059/1,188; fixed overhead (spec, notes, quotes,
vendor list) ≈ 3.2K at d5; items skimmed by the sequential control 0/0/5/24. Every d4 and d5 task is above the
32K-token single-context budget (tested); the d5 mean is ≥ 60K (tested). Attack seeds 379–390 at d5: 60,872–64,612.

## 7. Expected Haiku cost per task

Base figures as R1-NOTES §5 [M]: one Haiku call $0.026–0.030 with the claude-cli overhead; Haiku 5.5 $0.10 / $0.50 per
MTok; Haiku agent $0.088–0.103 on records/kinetics.

| arm | R2 (d3 ≈ 6.6K tok) | R3 (d3 ≈ 13K; d5 ≈ 63K) |
|---|---|---|
| one call, token-priced | ≈ $0.004 | ≈ $0.005 (d3); ≈ $0.011 (d5) [M driver: $0.101 / $0.108 / $0.274 per 24 calls] |
| one call with the claude-cli overhead | $0.03–0.04 [I] | $0.03–0.05 [I] |
| Haiku agent | $0.15–0.25 [I, W-BED §3.2] | $0.25–0.50 [I, W-BED §3.3]; more at d5 if it re-reads 63K per turn [I] |
| reference workflow, token-priced | ≈ $0.01–0.02 (40 kind judges of ≈ 1–1.5K tokens) [I] | ≈ $0.02–0.03 at d5 (48 item calls of ≈ 4.4K tokens) [I] |
| reference workflow with a per-call overhead of $0.03 | ≈ $1.2–1.6 per task [I] | ≈ $1.4–1.9 at d5 [I] |

The last row is W-BED §10's unmeasured risk made concrete: under `claude-cli`, a per-document or per-item map costs
overhead × width unless judges are batched. The 20-call overhead probe W-BED proposes (≈ $0.10) should run before R2/R3.

Triviality attack (§2.4 item 1), 24 calls per rung: $0.62–0.72 per rung at the measured overhead [M, driver output]. For
R3 the size gate needs the attack at d5 as well (`--difficulty 5`, another $0.62–0.72); at d3 the R3 one-call test is a
judgment test, not a size test.

## 8. W-BED §3.2 / §3.3 as written vs what was built

1. **R2 output adds `routing[]`** (document → route, review included). §3.2 lists `{entries, holds, review_queue}`. The
   brief asks for an oracle exact on routing and handling; without routing, unrelated vs injection vs a mis-routed
   document with no effect would be indistinguishable, and the route stage oracle and keyword measurement need it.
2. **R2 drift.** The new kind is `bank_change` (d4: hold the supplier, VERIFY_BANK); "a kind whose cue changes language"
   is German/French/Spanish invoices and credit notes at d4–d5 (40%/50% of foreign suppliers). §3.2 names neither.
3. **R2 handlers.** §3.2's "dispute → reason code plus a hold" is built as a customer dispute holding our receivable;
   credit notes are supplier credits against payables; remittances are customer payments against receivables. The
   reference outline's `autoFlag` on split samples is replaced by constructed undecidables (U1–U3), so the oracle can
   be exact.
4. **R2 keyword rule** is one specific English rule (§6). Other rules would give other fractions; the number is the
   failure of the obvious rule, not a lower bound on all rules.
5. **R3 width: N = 8/16/32/48** (the brief) vs §3.3's N = 40 at d3 and 120 at d5. Consequently R3 d3 is ≈ 13K tokens,
   not "≥ 40K at d3"; the size necessity holds at d4 (≈ 39K) and d5 (≈ 63K) only. To clear the 32K budget at d4 the
   statement length is 22–36 lines at d4 and 24–40 at d5 (§3.3: 10–30).
6. **R3 sequential necessity is a deterministic stand-in**: one context reads statements in order and skims past an
   assumed 32K-token budget (takes each closing balance). The budget is an inference [I]; the real evidence is the
   triviality attack at d5 (model calls, not run here).
7. **R3 judgments**: one judgment per non-rule discrepancy; DUPLICATE and TIMING are rule-decided (counts, cut-off).
   §3.3 has a judge per unmatched line.
8. **R3 conservation identity**: §3.3's "Σ adjusted = ledger difference" is not an identity as written (adjusted
   balances are balances, not differences). Restated as Z1 (statement − ledger = Σ discrepancies per item), Z2 (adjusted
   = ledger + accepted) and Z3 (fan-in recomputation). "Totals by reason and vendor": vendor totals are the per-statement
   rows in native currency; USD appears only in `by_reason` and `totals`.
9. **R3 relation controls all live in the reduce stage** (fan-in is the rung's point); R1's per-line rounding control
   became `reduce-rate-rounded`.
10. **Cross-rung reuse**: R3 prints statements with R1's billing-system dialects through `lib/dialects.mjs` (pinned
    against R1's render). It does not reuse records' customer layer. ATLAS's per-task date order does not make TIMING
    ambiguous: the cut-off is 5–9 days before month end (day 19–26), so dates near it have a day above 12.
11. **Faults**: hook points as R1 (`adversarialContent` no-op; asking for a fault throws in v1). R2's planted injections
    are part of the task, not the R8 overlay.

## 9. Open questions

- Run the 20-call claude-cli overhead probe before any R2/R3 arm: at $0.03 per call the reference map is the most
  expensive arm, which inverts §10's cost bet unless judges are batched [I].
- Whether the R3 one-call attack at d3 (13K) passes > 2/12: if so, R3 is admitted only at d4–d5 and the stream should
  start at d4.
- Whether the R2 undecidable templates are undecidable for a strong reader too (Sonnet/Opus review of U1–U3 samples,
  cost ≈ $0.5) [I].

**Addendum (coordinator, 2026-10-09 12:40 UTC).** The per-call overhead question in §7 is answered by a live 20-call
probe (DEV-NOTES D22): about $0.00011 and 1.4 s per tiny Haiku judge call through the claude-cli ModelPort. Per-item
judge maps are cheap in dollars; batching matters for wall time only.

## 10. wbed-r3 1.1.0: FX quotes stored at their printed precision (2026-10-14, adversarial review P0)

*Fix by Claude Opus 5.5 in the refs-R1-R3 review round, $0, `beds/sealed/` not read.*

- **Defect (1.0.0).** `lib/fx.mjs` `drawQuotes` stored a USD-per-unit rate at six decimals (`mulRate(round(rate × 1e6))`),
  while `lib/domain.mjs` `quoteLine` prints four (it truncates at ≥ 0.05). Spec rule 5 says "convert … at the quote
  below", so `by_reason` and `totals` were not derivable from the task. Example: seed 373 d3 stored EUR/USD 1.104221 and
  printed "1.1042". On dev 301–312 and 373–378 (d3, d4), 70 of 106 non-USD quotes had hidden digits. records quantizes
  to the printed precision (`records/world.mjs` `quant`); R3 did not. Found by the arm (c) reference author (references
  README "R3 bed finding"): with correct reasons, its statements matched 36/36 and its totals 0/36.
- **Fix.** `drawQuotes` quantizes as records does (`quantUsdPerUnit`: six decimals below 0.05, four above). USD/XXX
  quotes were already four decimals. The RNG draws are unchanged.
- **What moved.** On dev 301–390 × d2–d5: no world, attempt, statement or labelled reason changed (task hashes with the
  quote lines masked: 360/360 equal). Only the printed quotes changed, by at most one in the fourth decimal, along with
  the US-cent totals (253/360 task hashes). R1 is unchanged (360/360). R4 and R5 tasks with an R3 pack changed (67/120 on
  dev 301–330), so they are now wbed-r4 1.0.1 and wbed-r5 1.0.1. Results recorded on wbed-r3 1.0.0, and on R4/R5 1.0.0
  tasks with an R3 pack, stay invalid for US-cent totals.
- **Tests.**
  - `lib/lib.test.mjs`: every stored rate is exactly what its printed line says, over 400 draws of every currency.
  - `r3/r3.test.mjs`: spec rule 5, computed independently in BigInt at the printed quotes, reproduces `by_reason` and
    `totals` on 27 tasks.

  Both fail on 1.0.0. The full W-bed R1/R3/R4/R5 suite, `beds/lib/metamorphic.test.mjs` and the R3/R4-dependent JIT
  tests pass. The frozen R3 reference with author readings now passes 36/36
  (`beds/wbed/references/validation/r3-bed-1.1.0.json`).
