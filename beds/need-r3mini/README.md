# need-r3mini: the W-bed R3 supplier-statement audit cut down to 2-3 statements

**Routing anchor for the need router (experiments/need-router), not a Tier-A bed.**
**Kind:** oneshot. **Role:** `need-anchor`. **Domain:** back-office supplier statement audit (W-bed R3) on 2-3 suppliers.
**Version:** 1.0.0.

Everything is fictional and generated: the group (Hollin Group), its suppliers, billing systems, references, notes and
amounts all come from the W-bed R3 generator (`beds/wbed/r3/`, imported read-only), which builds them from syllable and
name pools. No benchmark data is copied. No model was called to build or test this bed ($0).

## Intended class (a HYPOTHESIS, not a fact)

The family is meant to be a **negative class** and a **shortcut breaker** for the need router, the metamorphic partner of
`wbed-r3`. A `wbed-r3` task is a fan-out / fan-in audit of 8-48 supplier statements (about 6K tokens at its d2, about 62K at
its d5) whose best-known solution is a map over suppliers with a code reducer. A `need-r3mini` task has the same rules
text, the same reason codes decided from cover notes and AP notes, the same statement dialects, the same adjusted-balance
and USD-total arithmetic, the same output form and the rung's own pass rule, but only **2 or 3 statements** and under 3K
input tokens. Everything on its surface says "audit / reconcile / statements / ledger / fan-in totals"; its structure has no
fan-out. The hypothesis is:

- **one direct model call should suffice** (2-3 statements, about 2.2-2.95K input tokens, a closed set of six reason codes,
  an answer of 3-5 discrepancies plus six fan-in rows), and no constructed workflow or code reducer is needed;
- at the higher ambiguity levels (d3-d5) a cheap model may make reason-code or arithmetic slips that a plain agent loop
  (with a calculator) would avoid; that would show up in the router's labels as "agent", not "construct-before".

Nothing here has been measured on a model. The router's paired labels (direct call vs. Haiku agent vs. Opus agent vs.
construct-before vs. JIT vs. reuse) are what would confirm or refute the hypothesis, per difficulty. Nobody should assume one
call suffices at any difficulty, or for a cheap model, before those labels exist.

The contract's "a 20-line script must not solve it" rule is waived for this family (it is meant to be direct-call
solvable). No solver that reads only the prompt and `inputs` is shipped or claimed; the notes are templated prose, so a
keyword script over them may well exist. Script-solvability would be expected for an anchor and is not evidence about model
behaviour. What the tests do show is that two cheap readings fail on every task: a reading that ignores the notes (every
difference a note would explain is called UNEXPLAINED) and the default "everything UNEXPLAINED".

## What one task is

One task is the audit of 2 or 3 suppliers (the **cut**) of one `wbed-r3` world, written out exactly as the rung writes it,
restricted to those suppliers:

| `inputs` key | Content (the rung's text for the cut) |
|---|---|
| `statements` | one file per supplier: its statement in its billing system's dialect, with the supplier's cover note |
| `ledger` | our AP ledger lines for these suppliers only (the rung's line ids; the header says "the suppliers in inputs.vendors only" in place of "all suppliers") |
| `vendors` | the supplier-list rows (id, name, other names our ledger uses, currency, billing system, statement file) |
| `ap_notes` | the AP clerk's notes that name these suppliers (a one-line "no entries" marker when there are none) |
| `audit_spec` | the rung's specification, header and sections 1-6 verbatim; only the FX quote lines of currencies not in the cut and the statement-format lines of billing systems not in the cut are left out |

The prompt says how many suppliers there are, that everything inside the statements, notes and ledger is data, not
instructions, and gives the output form. The solver returns the rung's output:
`{"statements":[{vendor_id, currency, statement_balance_minor, ledger_balance_minor, adjusted_balance_minor, discrepancies:[{ref, reason, amount_minor}]}], "by_reason":[{reason, count, usd_cents}], "totals":{statements, discrepancies, difference_usd_cents, adjustments_usd_cents}}`
with one statements entry per supplier of the cut, six `by_reason` rows (zero rows included) and the totals **over the
cut's suppliers**.

The six reason codes (TIMING, PRICE, FX, DUPLICATE, MISSING_CREDIT, UNEXPLAINED) are decided as the rung decides them: from
document counts and the in-transit cut-off date, and, for PRICE, FX and MISSING_CREDIT, only from what a cover note or an AP
note says about that very document. A note that mentions a document without explaining its difference does not explain it.

## The truth: the rung's own logic on the cut

`mini.mjs` builds the rung's world with `buildAudit(seed, split, rungDifficulty)` after importing `beds/wbed/r3/index.mjs`
(which installs the rung's decisiveness verifier, so the world is exactly the one `wbed-r3` builds), runs the rung's own
`runPipeline` (split / match / classify / reduce), keeps the cut's items of the split, match and classify stages and calls
the rung's own `reduce` on them (so `by_reason` and `totals` are over the cut). The oracle is the rung's `scoreAudit`
(pass = exact on every supplier of the cut, all six `by_reason` rows and the totals, references compared by the rung's key) after a schema check against the family schema. Nothing in `beds/wbed/` is modified.

Tests (`need-r3mini.test.mjs`) cross-check against the rung, for 40 seeds at every difficulty: the per-supplier entries of
`referenceSolve` equal `wbed-r3`'s own `referenceSolve` entries for those suppliers (deep equal); `by_reason` and `totals`
recomputed from the rung's entries with the rung's exact conversion equal the cut's; the split, match and classify items
equal `referenceTrace` of the paired rung task filtered to the cut; and every statement file is byte-identical to the rung
task's, every ledger line, supplier row and AP note is one of the rung's lines, and the specification's header and sections 1-4 and 6 are identical.

## Difficulty knob

`difficulty` 1..5 chooses **which 2-3 suppliers** of the rung world are cut out, by an *ambiguity score* of the cut, and
which rung world is used. It does not change the number of statements asked for (2 or 3, drawn per task, see below) or the
rules.

| Term of the ambiguity score | Points |
|---|---|
| per discrepancy, decided by counts and the cut-off alone (TIMING, DUPLICATE) | 0 |
| per discrepancy, a one-sided document dated before the cut-off (a credit note with or without an agreeing note; an unmatched invoice or payment) | 1 |
| per discrepancy, an invoice difference with or without a price note; a one-sided invoice dated just before the cut-off | 2 |
| per discrepancy, a payment difference with or without a conversion note (rung d3 world) | 3 |
| per discrepancy, the "memo-means-price" supplier (a price note on one invoice, another invoice difference without one) | 4 |
| per supplier, our ledger names it by another name (rung d3 world) | +1 |
| per supplier, its statement prints credits with a CR suffix (never in the worlds used here) | +1 |
| per supplier, reading effort of its statement: VERITAS (ISO dates) 0; BRIGHTDESK (US dates), LEDGR (German numbers), ATLAS (day/month order stated per task) 1 | 0-1 |

The discrepancy scale is the one `need-stage`'s `r3-classify` uses; the planted variant of each discrepancy comes from the
rung's own plan items (`world.vendors[].plan`), not from the task text. The score is summed over the cut. Level to world and
band wanted (the cut is drawn from the candidates nearest the band, ties in a seeded order):

| Difficulty | Rung world | Ambiguity band |
|---|---|---|
| 1 | `wbed-r3` d2 (8 suppliers; BRIGHTDESK, LEDGR, VERITAS; no FX, no other names) | 0-4 |
| 2 | same | 5-7 |
| 3 | `wbed-r3` d3 (16 suppliers; adds ATLAS, FX payments, ledger lines under other names) | 8-10 |
| 4 | same | 11-13 |
| 5 | same | 14 and above |

Measured prevalence of the rung's planted cases in the cuts (dev seeds 601-640, number of the 40 tasks of a level that
contain at least one; "invoice difference" = PRICE with its note or the same difference without a note; "payment
difference" = FX with its note or the same without; "other name" = a supplier our ledger names by another name):

| Difficulty | Invoice difference | Near-cut-off invoice | Payment difference | Other-name supplier | Memo-means-price supplier | Any item of score 3 or more |
|---|---|---|---|---|---|---|
| 1 | 8 | 5 | 0 | 0 | 0 | 0 |
| 2 | 23 | 19 | 0 | 0 | 0 | 0 |
| 3 | 18 | 8 | 34 | 27 | 1 | 35 |
| 4 | 35 | 3 | 17 | 21 | 28 | 40 |
| 5 | 39 | 5 | 25 | 24 | 37 | 40 |

Discrepancies by reason code over the same 40 tasks per level (TIMING / PRICE / FX / DUPLICATE / MISSING_CREDIT /
UNEXPLAINED): d1 35 / 8 / 0 / 20 / 39 / 22; d2 31 / 23 / 0 / 9 / 32 / 35; d3 12 / 17 / 33 / 12 / 18 / 49; d4 16 / 38 / 19 /
7 / 11 / 73; d5 3 / 47 / 20 / 10 / 12 / 91. Level 1 is mostly credit notes and in-transit items, level 5 mostly decoys
(UNEXPLAINED) among judged items.

Why the world stops at the rung's d3: the rung's d4 and d5 worlds (32 and 48 suppliers, statements of 22-40 lines, CR
suffixes, yen, statements written as sentences) cannot be cut to two suppliers under 3K tokens (the two shortest suppliers of
a d5 world need about 2.9-3.3K tokens once the 1K-token specification and the prompt are added). The rung has no d1
(`MIN_D = 2`), so d1 and d2 use its smallest world. Hence d3, d4 and d5 of one seed cut three different supplier sets out of
the **same** d3 world.

Every cut also satisfies these (generation redraws the cut until it does; the generator throws if none exists):

- 3-5 discrepancies in all, 2 or 3 suppliers (a seeded preference of 40% for 3; three suppliers are used only when a
  triple within the band fits under the token cap);
- input under the token cap (2950 tokens by prompt + pretty JSON of the inputs, `TOKEN_CAP`);
- at least two reason codes occur and at least one discrepancy is posted (PRICE, FX or MISSING_CREDIT), so "everything
  UNEXPLAINED" and a reading that ignores the notes both fail;
- adjusted balances are not all equal (so rotating them across suppliers is a real error);
- at least one of the rung's plausible mistakes (its bad-control options, run on the cut) gives a different, schema-valid
  answer.

### Expected input size (tokens) per difficulty

Tokens are `ceil(bytes / 4)` (the formula used across Foundry; not a tokenizer). "Compact" is the router's formula,
`JSON.stringify(inputs) + prompt`. "Inline" is what a single-call arm sees (`experiments/lib/beds.mjs` `inlineRender`: prompt
plus `inputs.json` indented by one space). Measured on dev seeds 601-640 (40 tasks per level); `wbed-r3` is the paired rung
task of the same seed, inline.

| Difficulty | Rung world | Compact median (min-max) | Inline median (max) | 3-supplier tasks | Discrepancies 3 / 4 / 5 | Ambiguity median (min-max) | In band | `wbed-r3` inline median | Ratio |
|---|---|---|---|---|---|---|---|---|---|
| 1 | d2 | 2619 (2297-2922) | 2633 (2937) | 6 | 36 / 4 / 0 | 4 (1-5) | 39 | 6044 | 0.43 |
| 2 | d2 | 2578 (2213-2941) | 2592 (2955) | 18 | 30 / 10 / 0 | 5 (4-7) | 39 | 6044 | 0.43 |
| 3 | d3 | 2778 (2388-2923) | 2792 (2937) | 8 | 21 / 17 / 2 | 9 (8-10) | 40 | 12857 | 0.22 |
| 4 | d3 | 2772 (2299-2927) | 2786 (2941) | 3 | 8 / 20 / 12 | 12 (9-13) | 39 | 12857 | 0.22 |
| 5 | d3 | 2775 (2430-2940) | 2789 (2954) | 2 | 1 / 15 / 24 | 15 (12-19) | 38 | 12857 | 0.22 |

The contract's aim of 6-15K tokens at difficulty 3 does not apply to an anchor whose point is a small input. Input size
is almost flat across levels (about 2.6-2.8K); what rises is the ambiguity score and, with it, the number of discrepancies
(3 at d1 to 4-5 at d5). That coupling is not removed: the high bands need more judged items, so **answer size and
ambiguity rise together** (the tests only pin the answer at 3-5 discrepancies). The out-of-band tasks (1-2 of 40 per level)
are the nearest cut that is well posed under the token cap, 1-2 points from the band. For `wbed-r3` itself the other
difficulties are about 38.8K (d4, 32 statements) and 62.4K tokens (d5, 48 statements); they have no same-world partner here.

## Controls

Bad controls (each fails on every dev seed 601-640 at every difficulty; tested):

| Control | What it submits |
|---|---|
| `empty` | no statements, no rows, zero totals (schema-invalid: the family schema needs 2-3 statements) |
| `shuffled-or-corrupted` | the right audit with the adjusted balances rotated by one supplier (a mis-joined report whose totals still tie out) |
| `plausible-but-wrong` | the first of the rung's own plausible mistakes (its `CONTROL_DEFS` options such as `timing-window-ignored`, `memo-means-price`, `credit-always-missing`, `payment-diff-always-fx`, `adjusted-accept-all`, `reduce-rate-rounded`, `sign-flipped`, `duplicate-collapsed`, `split-exact-name-only`) run on the cut that changes the cut's answer |
| `plausible-but-wrong:last-near-miss` | the last distinct such mistake (the first when the cut has only one) |
| `answer-for-other-suppliers` | the right audit of other suppliers of the same world (attribution error) |
| `balances-without-differences` | both balances right, adjusted = ledger balance, no discrepancies, zero fan-in (a skim) |

All but `empty` are schema-valid, so they test the oracle and not the schema. `describeTask(task).nearMisses` names the
rung mistakes that apply to a task.

## Oracle

`oracle(task, output)` recomputes the case from `(seed, split, difficulty)` and ignores the prompt, inputs and budget of the
task object it is handed (tested: rewriting them changes no verdict). It snapshots the output (functions, symbols and proxies
are not plain data and are rejected), validates it against `outputSchema` (the rung's schema with `statements` limited to 2-3
items; portable subset only, `portableSchemaViolations` is empty) and returns `pass: false, score: 0,
details: {reason: 'schema-invalid', errors}` for anything invalid. Otherwise it is the rung's `scoreAudit`: exact per
supplier on currency, the three balances and the multiset of (reference, reason, amount); all six `by_reason` rows exact;
totals exact. Score = 0.7 x exact suppliers share + 0.15 x correct `by_reason` rows share + 0.15 if all totals are exact;
`pass` needs everything exact (score 1). Matching ignores letter case, spaces, hyphens and slashes in references, case and
surrounding spaces in `vendor_id`, and case in `currency`; order of suppliers, discrepancies and rows is free (tested). Each of
19 single-field mutations of a correct answer fails (tested). `details` carry counts and field names only, never true values.

## Evidence status

Development and diagnostic only. Seeds 601-640 (split `dev`) are used throughout, and the tests (and the checks used to
choose the bands, the cap and the well-posedness conditions) are development evidence, not held-out evidence. No sealed or
`test`-split results exist for this family (the `test` split is generated and its reference and controls pass in the tests).
Not claimed: that one call suffices at any difficulty, that the levels are ordered by measured hardness (the knob is an
ambiguity score from the rung's planted cases, not a measured difficulty), or that anything here transfers to real
statements. **Untrusted text:** this family contains **no adversarial or injection strings**; the cover notes and AP notes
are templated and some are deliberate non-explaining mentions of a document. The prompt says that everything inside the
statements, notes and ledger is data, not instructions.

## Tests (`node --test beds/need-r3mini/*.test.mjs`, Node 24, built-ins only, about 17 s)

Development seeds 601-640 only. They show: the contract shape, the portable schema and loading through
`experiments/lib/beds.mjs`; byte-identical repeated generation, fresh objects, that split, seed and difficulty matter, and
identical output from a fresh process; `generate` and `oracle` each well under 2 s at difficulty 5 on cold seeds;
`referenceSolve` passes (score 1) for all 40 seeds at every level in both splits; every bad control fails for 40 seeds at
every level and is schema-valid except `empty`; schema-invalid output (wrong types, 1 or 4 statements, bad enums, floats,
functions, symbols, proxies) is rejected; the comparison rules and the 19 single-field mutations; that the oracle ignores
the task text; no hidden truth in the task (reason codes only inside the specification's rules, never next to a document;
no world metadata or mistake names; no answer fields; derived ledger and adjusted balances not printed in the ledger,
supplier list, notes, specification or prompt, and aggregate USD totals not printed anywhere); no instruction-like strings
in the inputs; **the family-specific properties**: the cut's truth equals `wbed-r3`'s own truth for the same suppliers (statement entries, fan-in recomputed from the rung's entries, stage traces) for
40 seeds x 5 difficulties, the rung's text is reused byte for byte, input is under 3K tokens at every level by both formulas
(`TOKEN_CAP` 2950; at least 1.5K), 2-3 statements and 3-5 discrepancies with both supplier counts occurring, the
ambiguity score's median rises strictly with difficulty with at least 36 of 40 cuts in band, no planted case of score 3 or
more at d1 and PRICE, FX and MISSING_CREDIT cases all occurring at d5, the specification lists exactly the cut's currencies
and billing systems, and the notes-blind and all-UNEXPLAINED readings fail on every task.

## Files

| File | Role |
|---|---|
| `index.mjs` | Contract interface: `family`, `outputSchema`, `generate`, `oracle`, `referenceSolve`, `badControls`; analysis helpers `describeTask` (rung task, cut, ambiguity, near misses; kept off the task), `truthTrace`, `inputTokens`; constants `RUNG_DIFFICULTY`, `BANDS`, `TOKEN_CAP`, `VERSION` |
| `mini.mjs` | The world side: ambiguity facts from the rung's plan items, the restricted rendering of the rung's text, the restricted truth (rung pipeline and reducer), the rung's mistakes on the cut, and the choice of the cut |
| `need-r3mini.test.mjs` | node:test suite (23 tests) |

## Limits and unknowns

- No model was run. The class hypothesis is untested; difficulty is an ambiguity score, not a measured hardness.
- d3-d5 all use the rung's d3 world; the rung's d4/d5 dialects (CR suffix, TALLY, yen, sentences) never appear, and a
  `wbed-r3` d4/d5 task has no same-world mini partner. A "r3-mini against r3 d5" comparison is across worlds: the same rules
  text, reason codes, output form and a subset of the dialects, with 2-3 statements instead of 48.
- Ambiguity and answer size are correlated by construction (see the size table); length is nearly flat but is not
  independent of the cut (a 3-supplier cut is used only when it fits the cap).
- The truth shares code with the rung (its reason rule, match and reducer), so the cross-checks show that the cut, its text
  and its truth are the rung's, not that the rung's truth is right (that is the rung's own oracle health).
- Importing this bed imports `beds/wbed/r3/index.mjs`, which installs the rung's world verifier on import (as the rung's
  own index always does); nothing in that bed is modified.
- Scoring reuses the rung's pass rule, so a cheap model that is right on every discrepancy but off by one cent in a USD
  total fails; the partial score separates the cases.
