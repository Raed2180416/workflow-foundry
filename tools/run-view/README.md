# Run view: a read-only, node-style view of one Foundry run

A prototype for the owner's request (2026-10-07): a few simplified nodes, each with a breathing coloured dot and a one-line live
update; click a node to read its chat. Design, data model, measurements and limits: `research/review-20261007/06-ui.md`.
It lives here, not in `web/`, because `web/` is part of the frozen C0 construction kit.

| File | Role |
|---|---|
| `index.html`, `run-view.css`, `run-view.js` | the page (no dependencies, no network, no inline script or style; the data is only ever rendered as text) |
| `export-run.mjs` | folds a workspace's hash-chained events, the model-call journal and the workflow version into one JSON file (`--out`) or one self-contained HTML file (`--bundle`) |
| `serve.mjs` | read-only loopback server: the page plus a live feed (SSE) of a workspace's runs, with a per-start token |
| `make-fixtures.mjs`, `live-writer.mjs` | drive the real runtime with a scripted provider (no model spend) to make the state fixtures and the 1000-item run |
| `core.test.mjs` | `node --test tools/run-view/core.test.mjs` (reducer vs the runtime checkpoint, folding rules, timeline) |
| `headless-check.mjs` | Playwright and the preinstalled Chromium: screenshots, console errors, accessibility, hostile text, live feed, scale |
| `samples/` | `records-v3-dev-d4-s108` (a real recorded run, development split) and three scripted fixtures; `.html` files open by double-click; `samples/history/` is a real run-history bundle (below) |

```sh
node tools/run-view/export-run.mjs --workspace WS --journal JOURNAL.sqlite --out run.json     # then open index.html and "Open run JSON"
node tools/run-view/serve.mjs --data tools/run-view/samples/zoo-finished.json                    # or: --workspace WS  (live; open the printed address)
node tools/run-view/headless-check.mjs --real tools/run-view/samples/records-v3-dev-d4-s108.json --fixtures tools/run-view/samples --shots OUT
```

Exports contain prompts, replies and corpus text. Treat them like the workspace they came from.

## Run history: past runs, their messages, a timeline and a summary of each

The owner's request (2026-10-08): *"a way to see past runs, past messages and timeline with a quick summariser of what happened in previous runs"*. Design, data survey and
decisions: `research/review-20261007/06b-run-history.md` (its "Implementation status" section says what is built and what is not). Everything is read-only.

| File | Role |
|---|---|
| `store-adapter.mjs` | reads a workspace store without going through `Store` (which writes): header in three shapes (`blob-v1` today, `rows-v2` per-node rows, `unknown` = derived from the event chain), the hash-chained events, the workflow, in one read transaction |
| `index-runs.mjs` | walks folders (no symlinks) and joins stores, model journals and experiment result files into `foundry-run-index/1`: one row per run or trial with a fidelity badge (`full`, `journal-only`, `result-only`), verdict-vs-oracle honesty, split, cost, calls, escalations, failures. Holds ids and numbers, never content. A scan cache makes a rescan with nothing new cost about a quarter of a second |
| `history-core.js` | pure functions shared by Node and the page: facts from events, the deterministic summary, lanes for the timeline, compare, filters and the honest totals |
| `summarise.mjs` | prints the deterministic summary; with `--model-summary` (and only then) asks the class-M model of `policy/models.json` for a typed second summary through `ModelPort`, under per-run, batch and lifetime caps |
| `run-doc.mjs` | builds the per-run record that a bundle embeds (events, calls, workflow), withholding prompts, replies and outputs of held-out runs |
| `export-history.mjs` | writes ONE self-contained html file (CSP with hashes, `connect-src 'none'`, no request) holding the index and the selected runs, gzip + base64, plus an optional `.json` form |
| `history.html`, `history.css`, `history.js` | the page: runs list (filter, sort, group, page, totals), run (summary card, timeline, messages drawer, raw facts), compare two runs, tasks x arms |
| `headless-history.mjs` | Playwright + Chromium check and screenshots (`research/review-20261007/ui-history-*.png`) |
| `headless-adversarial.mjs` | the 2026-10-08 review's attack script: hostile text in every field and route, malformed routes, keyboard and the accessibility tree, computed contrast of every text node, 10,000 rows and a 1,000-node run |
| `test/*.test.mjs` | adapter (all store shapes), index, summariser, model summary (scripted provider), export, escaping (static + real browser), `review` (one regression per defect the review found) |

```sh
# 1. index the records on this machine (read-only; the cache keeps a rescan fast)
node tools/run-view/index-runs.mjs --root /var/tmp/foundry-work --root experiments/runs --sources tools/run-view/samples/history/sources.json --cache ~/.cache/foundry-run-view --out index.json
# 2. what happened in one run (free, deterministic) or in all the runs where Foundry said pass and the oracle failed
node tools/run-view/summarise.mjs --index index.json --run b6d33a19
node tools/run-view/summarise.mjs --index index.json --filter honesty=mismatch-pass-fail --limit 5
# 3. optional model summary of the same, a cent or less per run, only when you ask for it
node tools/run-view/summarise.mjs --index index.json --run b6d33a19 --model-summary --cache ~/.cache/foundry-run-view --per-run-usd 0.01 --batch-usd 0.05
# 4. one file you can open by double-click (add --summaries ~/.cache/foundry-run-view/model-summaries.json to show the model summaries)
node tools/run-view/export-history.mjs --index index.json --out history.html --embed mismatch,failed --max-bytes 4000000
node tools/run-view/headless-history.mjs --json history.json --shots research/review-20261007     # needs --json-out in step 4
node tools/run-view/headless-adversarial.mjs --json history.json                                  # the review's attacks; exits 1 if one gets through
node --test 'tools/run-view/test/*.test.mjs' tools/run-view/core.test.mjs
```

Reading the list: **fidelity** says what survives of a run (the experiment scripts delete a passing trial's workspace, so full records are mostly failures: read rates from all
rows, not from the full ones), **Verdict vs oracle** compares Foundry's verdict with the experiment's independent oracle (a Foundry `pass` the oracle failed is MISMATCH, in words),
and a **held-out** (`test`) run's prompts and replies are left out of a bundle unless it is built with `--allow-heldout-content` (every use is ledgered). Hostile text in a run can
neither run a script nor create an element: the page renders everything as text (`headless-history.mjs` and `test/escaping.test.mjs` check it in a real browser).

Joins (index-runs.mjs) after the 2026-10-08 review: a journal run named after a trial (`arm:task:tN`, or with the B1 script arm's `:<uuid>` suffix) joins the result line
of that trial written at or after its last call, nearest first (J2); a journal copied elsewhere (same first call time) is one run read from the copy nearest its result file;
two workspaces that reused one experiment name keep separate rows; every key is unique (a colliding trial key gets `@<result file>`). Journal-only failures are failed
model CALLS, and a run that finished positively is not summarised as failed because a call was retried. A record deleted between indexing and export opens as
"summary only". Review findings and measurements: `research/review-20261007/06b-run-history.md`, section "Review (adversarial, 2026-10-08)".

Not built: live mode (`serve.mjs --index`), an in-page summarise button, `foundry serve` integration (waits for the engine freeze), the builder transcript.

## JIT streams: cost and success curves, per-arm lanes, compiled versions

For the JIT stream experiments (`experiments/runs/jit/<experiment>/<arm>/`, layout in `research/jit-20261008/SPEC.md` §6.3). Read-only: it never writes into the run folders.
The totals, curves, steady state and break-even figures come from `experiments/jit/report.mjs` (`loadRun`, `buildReport`, `renderMarkdown`) unchanged.

| File | Role |
|---|---|
| `index-streams.mjs` | builds `foundry-jit-streams/1`: one record per experiment with each arm's rows (only the oracle's numeric fields), event log, open or fault-stopped tasks, compile attempts (`versions/`: outcome, reason and trigger, cost, host check, parent, BUILD-NOTES excerpt, withheld for held-out splits) and the report.mjs summary; the plan comes from `experiments/jit/configs/` |
| `export-streams.mjs` | writes `streams-export.json` and one self-contained html (hashed CSP, `connect-src 'none'`) |
| `streams.html`, `streams.css`, `streams.js` | the page (it also loads `history.css` and `history-core.js`): cumulative cost and success charts, lanes, version timeline, report.mjs summary |
| `test/streams.test.mjs`, `test/streams-fixture/` | $0 tests on a synthetic stream tree, including a real-browser check |

```sh
node tools/run-view/export-streams.mjs --out /tmp/streams.html            # also writes /tmp/streams-export.json; --out x.json writes the JSON only
node --test tools/run-view/test/streams.test.mjs
```
