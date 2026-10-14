# BUILD-NOTES

## Procedure in code
- Parse each line by system; names, dates, phones and USD amounts are normalised in code.
- Identity: union-find on spec rules 3(a)/(b), with a one-typo name match. Conflicts: most recent first, restamped systems last.

## Judges (flow.judge, quote-checked)
- void-markers, balance-signs, restamped-systems, date-orders: three haiku-5-5 votes; opus-5-5 once on disagreement. Quotes must sit in that system's paragraph.
- vendex-fields: batches of 6 free-text entries; haiku, haiku, opus. Checks: quotes are substrings, dates and money parse.
- country-names: only for unknown country strings (none here).

## Guards and invariants
Guards: input shape, rates, calling codes, nicknames, paragraphs, row count, LEDGR fields, VERITAS JSON, row names, update dates, rate per currency. Invariants: E.164 shape, rows conserved, no void row used, entity = lowest row, field shapes.

## This compile
- `tidy()` keeps particles (van, von, der, de, ...) lower-case before another family word: "VAN LEEUWEN" gives "van Leeuwen". Fixes case-0 and trace-0. Casing only.
- No guard or check changed.
- Two-typo name pairs are flagged (`near-miss-names`), not judged: the spec caps typos at one.

## check-traces
No deopt, crash or timeout. Regression case-0 passes. Exact: case-0, trace-0, trace-1, trace-2. Mean partial 98%.

## Disagreements
- trace-3, `amount_usd` of the 14 LEDGR-won records: the agent did not flip LEDGR signs. The task says: "Saldo changes sign in the master."
- trace-4, 3108/9470 (Anke vs Anja) and 3918/4934 (Elena vs Elisa): the agent merged both pairs, each two letters apart. The task says: "at most one typing error in total is tolerated across given and family name together". We keep them apart.
