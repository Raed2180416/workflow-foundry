# node-graph-ui (F1): research dossier, as of 2026-10-21

*Committed on 2026-11-04 with the build, as the plan it followed. Written by the research phase of workflow
wf_6d3b90c9-c30 (no file edited, no paid call). Exa and Scite were unavailable then, so web evidence came from
WebSearch/WebFetch, live npm registry reads, and reading the repo and the installed `node_modules`.*

> **Scope note added at build time (2026-11-04).** Owner decision **D33** (`research/decisions-20261021.md`, recorded
> 13:15Z on 2026-11-04, after this dossier) says: *"We expose visualisations of the workflows the system creates; we do
> not build a visual editor ... The visualisation engine and its UI/UX are the owner's own work. Our job is a flawless
> core engine ... plus the read-only data a visualisation needs."* The build therefore delivered sections S2, S4, S5
> and the data half of S1 and S3 of the plan below (states, fold, layout, per-node detail, live feed, one list of
> human tasks, one-line summaries) as typed data and routes, and **did not** build the dashboard graph, the breathing
> dots, the drawer or the Playwright persona study (S1/S3 rendering, S6 browser arms). Reasons and what replaced the
> evaluation: [RESULT-NODE-GRAPH-DATA.md](RESULT-NODE-GRAPH-DATA.md) §1.

Evidence tags: **[obs]** observed in code or registry data · **[doc]** a document or page claims it · **[inf]** inference.

## 1. Bottom line

1. **Most of the visual part already exists, as a read-only prototype.** `tools/run-view/` has breathing dots with 16
   states, folding of the workflow IR into a graph, a click-to-open transcript, a live SSE feed, and a reducer checked
   against the runtime checkpoint (19 unit tests, 74 browser checks [doc: research/review-20261007/06-ui.md §7.2]).
   Missing in the product: the graph inside `app/dashboard`, a single inbox where you can act (approvals and human
   questions), and plain-words one-line run summaries. The job is integration plus simplification, not a new viewer.
2. **The graph is not the primary screen for a novice.** A novice asks: is it done, does it need me, did it break and
   what do I do. ISA-101 industrial HMIs keep normal state grey and use colour only for abnormal; Temporal's compact
   view and Langfuse's aggregated view group steps by default. Collapse the 16 internal states to **5 user-facing
   states**; sub-states become words and glyphs, not more colours.
3. **Measure with an AI persona, checked by controls.** Playwright 1.63 has `page.ariaSnapshot({mode:'ai'})` with
   `[ref=eN]` and an `aria-ref=` selector [obs: node_modules/playwright-core/types/types.d.ts:2101-2120]. Published
   work shows LLM personas are over-optimistic, so a positive and a deliberately degraded negative control are needed.
4. **Do not adopt a graph library** (folded graphs are 12 cards or fewer; `layoutRanks` lays them out). Do not adopt
   LangChain's Agent Inbox (archived 2026-09-20 [obs]); borrow its interrupt shape and AG-UI's interrupt outcome only.
5. **New security surface: the inbox now acts.** Approval dialogs can be forged ("Lies-in-the-Loop", Checkmarx 2025,
   demonstrated on Claude Code). Lead with typed, hash-bound facts; fence model text, label it untrusted, cap it.

## 2. What exists in the repo

| Asset | Status | What it means for this item |
|---|---|---|
| `tools/run-view/run-view.js` (`RunViewCore`) | [obs] global; starts its UI only when a `document` exists | reuse it, do not copy it |
| `tools/run-view/serve.mjs` SSE | [doc] lag p50 12 ms / p95 23 ms on a 250-item run | port the design to the dashboard |
| run-view token handling | [obs] header comment says the token is never in a request line, but the API checks `?t=` (`serve.mjs:56`) and the page appends it (`run-view.js:676`) | the dashboard uses a header token; stream over fetch |
| `app/dashboard` | [obs] 5 s poll, inbox for activations and paused actions, runs table, raw event timeline; no graph, no per-node cost, no transcripts | the product baseline B0 |
| `app/core/service.mjs` `inbox()` | [obs] approvals only; **questions from `human` nodes cannot be answered anywhere in the app** | add human tasks in a new file; do not edit `service.mjs` (the onboarding worktree edits it) |
| `tools/ui/` (G21 forms) | [doc] forms compiled from `answerSchema`, host re-validates | use `compileForm` / `validateAnswer` |
| `history-core.js` `summarise()` | [doc] deterministic `one_line` | one-line summaries at $0 |
| onboarding worktree `wf_c7946468-203-16` | [obs] `#/runs`, `#/runs/:id`, `#/waiting` | build no second runs list |
| engine v2 series (held) | [obs] patch 0010 adds actor/channel to `human.answered`; 0005 a remedy per stop code | pass `channel`; use remedies once merged |
| record gaps G1-G4 | [doc] 06-ui.md §2.8 | "why did it fail" is limited by G2; say so |

## 3. Frontier and adjacent fields (summary)

- Run and agent UIs 2025-26: Langfuse agent graphs (aggregated view by default), Temporal Compact/Timeline/Full,
  OpenAI Agent Builder (deprecated, shutting down 2026-11-30 [doc]), Vercel Workflow DevKit inspector, Magentic-UI action guards.
- Human-in-the-loop protocols: AG-UI interrupts (`@ag-ui/core` 1.0.3, MIT [obs]); Agent Inbox (archived [obs]);
  MCP Apps (SEP-1865) as a later route for F2.
- Security: Lies-in-the-Loop (Checkmarx Zero, 2025-10-21), including a padding variant that pushes the payload out of view.
- Simulated users: UXAgent (arXiv 2502.12561), Agent A/B (2504.09723), Synthetic Cognitive Walkthrough (2512.03568:
  LLMs complete more tasks than humans by more optimal paths), 2512.04262 (heuristic evaluation agrees on presence, not severity).
- Niche fields: ISA-101 / ISA-18.2 (grey normal, colour and motion for abnormal); IEC 60601-1-8 (rate encodes urgency,
  redundant glyph; exact Hz values unverified, behind a paywall); Apple US 6,658,577 breathing LED; process-mining
  token replay (do not animate tokens in a live view); Data Navigator (accessible node-link structure); KLM operator
  times and first-click testing; Node-RED node status (dot or ring plus a short text).

## 4. Adopt, borrow or build

Reuse: `RunViewCore`, `store-adapter.mjs`, `export-run.mjs` (`verifyChain`, `slimEvent`, `callOf`, scrubber),
`history-core.summarise`, `tools/ui`, `explain.mjs failureText`, the dashboard token and Host model.
Adopt: Playwright 1.63 `ariaSnapshot` (installed); optionally axe-core (needs owner decision O-F).
Rejected: elkjs (EPL/GPL, 8 MB), React Flow, Cytoscape and dagre (not needed at 12 cards), Agent Inbox (archived).
Build: the 5-state mapping and motion rules, fetch-streamed SSE with a header token, one inbox for approvals and
questions, a forgery-resistant approval card, a persona harness with controls, a KLM estimator, a calm/attention metric.

## 5. Risks

1. The persona agent may not be valid (LLMs over-perform; the accessibility tree is not the visual design).
2. Record gaps G1-G4 ("which check failed" is not always in the record).
3. The dashboard gains a write path (human answers); forged approval dialogs are the threat.
4. Merge collisions with the onboarding worktree (`service.mjs`) and the engine series: new files, narrow hooks.
5. Collapsing 16 states to 5 could hide environment fault vs model failure: keep it in the glyph and the words.
6. The writer is quadratic at 1000 items (06-ui §4.4).
7. Disk: screenshots small.

## 6. Build plan (as planned)

S0 worktree and fixtures (F1 failed after escalation, F2 send awaiting approval, F3 human question, F4 costs, F5
live 50-item map, F6 nothing waiting; sealed fixtures by a separate agent) · S1 `app/dashboard/graph/` (five states,
breathing about 3.5 s, pulse about 1.2 s, pause motion, status sentence) · S2 `app/dashboard/live.mjs` (graph,
stream with header token and chain check, call) · S3 node drawer (what, what to do, inputs and outputs, cost, checks,
transcript) · S4 `app/core/human-tasks.mjs` (questions with `answerSchema`, `compileForm`, re-validate, channels,
hash-bound facts) · S5 one-line summaries in history · S6 evaluation harness · S7 adversarial review, sealed run once.

## 7. Measurement plan (as planned)

Arms B0 (`app/dashboard` today), B1 (`tools/run-view` + the existing approval surface), T (integrated), C+ (answer on
the first screen), C- (T with raw ids and no inbox link). Tasks T1 why did the run fail, T2 approve the waiting step,
T3 what did step X cost, T4 answer the question, T5 which recent run failed and why, T6 is anything waiting (negative).
Agents: scripted mouse and keyboard paths with KLM time; a Haiku 5.5 persona on `ariaSnapshot` (and Mercury 3 as a
second persona), with the controls. Oracles from the store and journal, never from the UI.
