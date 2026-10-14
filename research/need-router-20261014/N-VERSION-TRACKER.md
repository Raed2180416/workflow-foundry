# N-version disagreement as an oracle-free requirement check (E8, 2026-10-14, dev, $0)

**Why.** The requirement tracker (experiments/tracker/, TRACKER-DESIGN.md, tracker-e8/REPORT.md) logs the user's conditions
cheaply ($0.13) but its Haiku-written checks do not yet decide: 16/78 false failures on a correct build, 44/78 untested, and the
review showed two real defects (a removed partial-batch resubmission; a dropped required notification) left its status table
unchanged. Writing 78 correct temporal checks from prose is writing an oracle, the hardest artifact we make; asking Haiku to do
it blind in one pass repeats the one-shot B1-H failure. The checker needs independent evidence, as the builder did.

**Method** (`experiments/tracker/nversion.mjs`; N-version programming, Avizienis 1985; differential testing, McKeeman 1998;
AlphaCode's clustering of candidate programs by behaviour on generated inputs). K workflows built independently from the same
spec run on the same practice worlds. Each build's behaviour per order is reduced to an observable signature (committed
effects by system.op, statuses set, notification templates), keyed by the order id the workflows themselves emit, never by a
truth label. Per order, a strict majority is the consensus; minority builds are suspects; a split is unresolved (adjudicate
against the spec), never a flag on everyone. The bed oracle is read afterwards only to score the method.

**Result** (practice worlds 1235 d2, 1236 d3, 1237 d5; 346 orders; completed cases only):

| builds | build | suspect flags | of which the oracle fails | oracle failures caught |
|---|---|---|---|---|
| K = 3 (B1L-H lineages 1–3) | lineage 1 (100%) | 0 | – | – (none to catch) |
| | lineage 2 (go-live gap) | 16 | 16 | **16/16** |
| | lineage 3 (partial-batch gap) | 4 | 4 | **4/4** |
| K = 4 (+ B1-O, 27.5%) | lineage 1 | 12* | 0 | – |
| | lineage 2 | 20* | 16 | 16/16 |
| | lineage 3 | 12* | 4 | 4/4 |
| | B1-O | 244 | 240 | **240/240** |

\* K = 4 run under the first rule, which flagged every build on a 2–2 split; 12 orders split because B1-O makes the same
go-live and partial-batch mistakes as lineages 2 and 3. Under the current rule those 12 are *unresolved*, not suspects.

**Reading.** With three cheap independent builds whose defects are independent, majority vote localises every defective
order to the build that has it, with no false flag on the correct build: precision 1.00, recall 1.00 (20 failures, small n).
Correlated defects defeat the vote (two builds sharing a misreading out-vote the right one); the K = 4 splits show where that
starts. That is why disagreement is a *pointer* for the builder ("on order X two other builds did A, you did B: which does
the spec require?") and for the tracker's targeted adjudication, never a verdict on its own.

**Next.** (1) The N-version build loop B1N-H: three Haiku builds, each given its minority orders as feedback (observable diffs
only), rebuilt, then graded on the grading worlds 1232–1234 (disjoint from the practice worlds). (2) The tracker uses
disagreements to pick which requirements to check (and which spec sentence decides) instead of writing 78 checks blind.

Raw: `nversion-e8-k3.json`, `nversion-e8-k4.json`.
