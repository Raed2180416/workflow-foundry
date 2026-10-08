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
| `samples/` | `records-v3-dev-d4-s108` (a real recorded run, development split) and three scripted fixtures; `.html` files open by double-click |

```sh
node tools/run-view/export-run.mjs --workspace WS --journal JOURNAL.sqlite --out run.json     # then open index.html and "Open run JSON"
node tools/run-view/serve.mjs --data tools/run-view/samples/zoo-finished.json                    # or: --workspace WS  (live; open the printed address)
node tools/run-view/headless-check.mjs --real tools/run-view/samples/records-v3-dev-d4-s108.json --fixtures tools/run-view/samples --shots OUT
```

Exports contain prompts, replies and corpus text. Treat them like the workspace they came from.
