# Workflow design-review-c (wf_1ab0b3e4-a4d)

status: completed; finished agents: 3

## Script

```js
export const meta = {
  name: 'design-review-c',
  description: 'Design review lane C: measured efficiency and the Rust question; workflow-need router (Kev, slider) and Haiku-as-constructor enablement; live node-graph UI spec and prototype',
  phases: [{ title: 'Research', detail: 'efficiency/Rust, router+constructor, UI' }],
}
const COMMON = args.common
phase('Research')
const results = await parallel([
  () => agent(`${COMMON}
TASK (lane 4, efficiency and the Rust question): MEASURE before concluding. Benchmark the Foundry runtime on this VM (note the CPU contention: other agents and 4 C0 builder sessions are running; repeat measurements and report spread): per-node overhead for code nodes (sandbox spawn cost js/python), agent nodes with a scripted provider (no model), map fan-out of 10/100/1000 items, journal/store write latency (SQLite), context compile time, validate time for workflows of 10/100/1000 nodes, memory per run, and replay speed. Compare with real model-call latency from journals (experiments/runs/*/journal.sqlite, /var/tmp/foundry-work/records-v3/journal.sqlite: Haiku 5.5 ~1.5 s, Sonnet several s). Profile hot spots (node --cpu-prof). Then answer: is the implementation efficient; where are the real costs (tokens, model latency, sandbox spawns, serial waits) vs runtime overhead; concrete optimisations ranked by measured gain (e.g. sandbox process pooling, prompt-cache-friendly prefixes, batching, parallelism, journal batching); and the Rust question: lines of code and dependency inventory (cloc of src/, bin/, tests/), what a port would take (person-weeks, risk), what would get faster and whether it matters given the measured numbers, alternatives (Rust only for the sandbox/scheduler via napi, Bun/Deno, keeping Node). Write research/review-20261007/04-efficiency-rust.md with all numbers and commands. Scripts go under /var/tmp/foundry-work/bench/ (not the repo).`, { label: 'review:efficiency', phase: 'Research', model: 'sonnet', effort: 'xhigh' }),
  () => agent(`${COMMON}
TASK (lane 5, workflow-need router and Haiku as constructor): Two owner asks. (A) A way to measure whether a task needs a workflow at all, and how complex: from 'no workflow (a direct agent/single call is best)' through simple to extremely complex workflows, using Kev (research/kev-20261007/JUDGE-PROGRAM.md, 02-decision-inventory.md decision D6 'reuse, construct, delegate or cascade', 01-kev-dossier.md), with a user-facing sensitivity slider for triggering workflow creation. Design: the port's question and options (tiers), the state it reads (task text + cheap features), label sources (C0 results: per family whether B0, B1 or F won and at what cost; P1; the corpus as positives with complexity features; agentic coding tasks and simple Q&A as negatives; synthetic), the decision rule behind the slider (expected value: P(workflow helps) x gain - construction cost; the slider moves the threshold or a risk-aversion weight; show it maps to an operating point on a measured curve), calibration and abstention, and how to evaluate it (held-out families, regret vs oracle choice). (B) Haiku 5.5 as the workflow CONSTRUCTOR: what it needs to construct accurately. Read skills/micro-harness/ (SKILL.md, references/ir.md, operators.md), experiments/c0/ (prompts, construct), research/construction-20261006/DESIGN.md, src/construction*.mjs, the corpus COVERAGE.md motif section, and any finished C0 construction artifacts/notes under /var/tmp/foundry-work/c0-dev/construct/*/ and experiments/runs/c0-dev/ (read-only; constructions may still be running). Propose: construction itself as a Foundry workflow (narrow typed steps a weak model can do: classify task shape, pick operators, draft one node at a time, validate, test on probes, repair from validator/oracle feedback), a template/operator library mined from the corpus and from passing constructions, retrieval of similar kept workflows, worked examples, schema-guided generation, static checks as feedback, Kev gates during construction, and what to FINE-TUNE or few-shot (and with what data) if needed. Include what information is still missing for accurate construction (e.g. tool/capability catalogs, effect declarations, budgets, oracle discovery). Write research/review-20261007/05-router-constructor.md with experiments for each claim.`, { label: 'review:router-constructor', phase: 'Research', model: 'opus', effort: 'xhigh' }),
  () => agent(`${COMMON}
TASK (lane 6, live node-graph UI): The owner wants an easy-to-understand visual view: simplified semantic nodes (e.g. in a game-QA workflow one node is 'visual understanding'), each with a small breathing dot whose colour shows state, a one-line live update of what is happening inside the node, and clicking a node expands its 'chat' (its transcript). Read web/ (the existing UI), src/runtime.mjs and src/store.mjs (events, run state, frames, map items), src/journal.mjs (prompts/responses per model call), src/http.mjs, bin/foundry.mjs (serve command), and the UI tests in tests/ui-*.test.mjs. Write research/review-20261007/06-ui.md: the data model (which events/state drive each visual element; how map/loop/call frames collapse into simplified group nodes; semantic grouping rules and labels; state colours incl. waiting/escalated/check-failed/env-fault; live line text source; transcript panel content: prompt, typed output, checks, escalations, costs, receipts), streaming transport (SSE from existing events), performance for 1000-node runs, accessibility, and privacy (untrusted content rendering). THEN build a working prototype (IMPORTANT: it lives in tools/run-view/, NOT web/: everything under web/ is copied into the frozen C0 construction kit and changing it blocks the running C0 experiment; a previous interrupted attempt already left files in tools/run-view/ (moved there from tools/run-view/), read them and continue): a single self-contained page tools/run-view/index.html (+ a small JS file if needed; no npm dependencies; no external network) that renders a recorded run from a JSON export of a real run (write a tiny exporter script tools/run-view/export-run.mjs that reads a Foundry workspace store and journal and writes run-view JSON; use a real records-v3 run from /var/tmp/foundry-work/records-v3/ or p1 if present, else create one by running experiments/workflows/records-v3-dev.mjs on one dev seed with --mode replay-or-live), with replay controls (play/pause/speed) so the breathing dots and live lines animate through the recorded event timeline, and a click-to-expand transcript drawer. Test it headless with Playwright (Chromium is preinstalled; executablePath /opt/pw-browsers/chromium if needed): screenshot at 3 timeline points into research/review-20261007/ui-*.png, and verify no console errors. Do not edit existing web/ files except adding tools/run-view/.`, { label: 'review:ui', phase: 'Research', model: 'sonnet', effort: 'xhigh' }),
])
return results
```

## Agent result 1

I wrote `/home/user/workflow-foundry/research/review-20261007/05-router-constructor.md`. It is a design and review note: nothing was trained or run, and no model was called. It reads the finished C0 constructions under `/var/tmp/foundry-work/c0-dev/` without changing them. No other file was touched and git state is unchanged.

**What the note concludes**

1. **Whether a task "needs a workflow" depends on more than its text.** It also depends on the executor model, how often the task recurs, what a success is worth, and whether a cheap verifier exists. On `records` d3, one Sonnet call already passed 6/6 for $0.08–0.18. The Haiku-built workflow cost $1.01 to construct, so it pays off after somewhere between about 7 repeats and never. That range is inferred: its per-task cost has not been measured on test tasks.
2. **Kev should feed the decision, not make it.** The router has two stages:
   - **Hard requirements:** code guards plus Kev detect waits, triggers, human gates, effects and audit needs. These force a workflow regardless of model capability.
   - **Utility:** a small calibrated head per executor model picks the mode (direct, agent, template, construct, construct+) with the highest expected value.
   - **New Kev port:** `task_properties` asks 10 yes/no questions with labels from code or generator truth. Kev only joins after a fine-tune that beats code and embedding baselines.
3. **The slider is the value of one success in dollars.** With two modes this is exactly a threshold on the predicted gain from building a workflow. Each position shows a measured operating point on held-out families (trigger rate, success, $ per task, wait). Hard requirements override the slider.
4. **Haiku 5.5 as constructor:** in the running C0 round, Haiku-built workflows passed all 3 probes at 0.41× (records, $1.01) and 0.44× (codefix, $0.90) of Opus's construction cost. These are probe results only, one construction per arm, on development families. No test-seed results exist yet.
5. **Constructor design:** construction becomes a Foundry workflow of narrow typed steps, using:
   - operator templates the runtime can execute, with typed slots;
   - worked examples retrieved from other families;
   - schema-constrained generation one node at a time;
   - a strict lint whose errors drive repair;
   - Haiku first, escalating to Opus when it fails.
6. **We cannot fine-tune Haiku 5.5;** whether Anthropic offers that is unknown. The levers are curated context and Kev fine-tunes.

**Problems found in the existing artifacts**
- All 7 Foundry workflows built so far (4 in C0, 3 gate smokes) accept as soon as an answer exists. Six have a verify node that never blocks; one has none.
- The Haiku-built records workflow drops failed batches silently. The validator only warns.
- The Haiku builder put the codefix workflow's model calls on Sonnet and Opus, not Haiku. A cheap constructor does not mean cheap execution.
- For Haiku constructions, 45–76% of the cost is running the workflow on probes, not the builder's own tokens.
- 461 of the corpus's 829 written descriptions contain graph-derived phrasing ("N nodes", "trigger:"). That leaks the labels if they are used as router inputs.

**Experiments:** 14 are specified: RX1–RX6 for the router and CX1–CX8 for the constructor. Each has a design, sample size, cost, baseline and kill rule. The staged total is about $450–480 list price, each experiment under the $500 pause rule. Two come first:
- **CX2:** a free retro-audit of the existing workflows against the strict lint.
- **RX1:** a sweep to measure the gap between the best fixed mode and per-task choice. Its first pass covers records and codefix (≈ $85). If the gap is under 3 points of success and under 20% of cost, the router should not be built.

**Owner decisions requested:**
- The default slider value (proposed "Balanced", a success worth $1).
- Allowing ε-exploration on low-stakes tasks.
- Naming annotators.
- Haiku-first construction as the default.

## Agent result 2

Lane 6 is done: the design doc, a working viewer prototype and the screenshots are written. 19 unit tests and 74 headless Chromium checks pass, with no console, page or CSP errors on any page opened. Nothing was committed, and `web/`, `src/`, `experiments/`, `beds/`, `skills/` and `policy/` are untouched.

**Files**
- Doc: `/home/user/workflow-foundry/research/review-20261007/06-ui.md`. Claims are tagged measured, documented or inferred.
- Screenshots: `/home/user/workflow-foundry/research/review-20261007/ui-*.png`.
  - Three timeline points of the real run: `ui-1-calling.png`, `ui-2-escalation.png`, `ui-3-end.png`.
  - Transcript drawer: `ui-4-transcript.png`.
  - Comparison and special views: the existing UI (`ui-0`), a 1000-item map (`ui-10`), a 1000-node graph (`ui-14`), the live feed (`ui-11`), a broken chain (`ui-12`), a 390 px window (`ui-13`), a nested map/loop drill-down (`ui-15`) and a breathing-dot filmstrip (`ui-16`).
- Prototype: `/home/user/workflow-foundry/tools/run-view/`. Open `index.html`, or double-click a bundle in `samples/` (`records-v3-dev-d4-s108.html`, `zoo-finished.html`).
  - `export-run.mjs` folds a workspace's events, journal and workflow version into one JSON or one-file HTML.
  - `serve.mjs` is a read-only loopback server that streams a workspace's runs live (SSE, with a per-start token).
  - `make-fixtures.mjs` and `live-writer.mjs` drive the real runtime with a scripted provider, so no model spend.
  - Tests: `core.test.mjs` and `headless-check.mjs`. The `README.md` there has the commands.
  - The real run is a `records:dev` task, `v3-h55fix2` d4 s108. No sealed or p1 data was read.

**What the prototype does**
- The page shows a few simplified nodes, each with a coloured dot that breathes only while that part is active.
- Each node carries a one-line live note built from typed event fields only, never model text.
- Clicking a node opens a read-only transcript: the prompt, typed reply, check results, escalations, costs and context receipts.
- It has 16 states, including waiting, escalated, check-failed, needs-you, and an environment-fault state that is never escalated.
- Replay has play, pause, speed, step and "next notable moment".
- Maps and loops always collapse into one card, with a drawer that drills item, then iteration, then step. Chains, preparation steps and wide fans fold at three detail levels. Graphs of more than 24 cards fold into at most 12 stages.
- Replay and live feed run the same reducer.

**Measured**
- **Reducer check:** it matches the runtime's own checkpoint for every node instance on four real-runtime workflows (cost to 1e-9, call count equals journal rows). All 26 journal prompts of the real run match the chain's receipts, and an edited prompt is flagged.
- **Diagnosis questions:** on one failed real run, the run view fully answers 6 of 7 within 2 clicks with no raw JSON. The question "why did it escalate" is only partly answered, because the runtime does not record which check failed. The existing `web/` UI answers 3 of 7 fully, needs about 6 clicks of raw JSON for in-item facts, and cannot show a prompt, a reply or the oracle at all. This is one run counted by me, not a user study.
- **Scale:**
  - A 1000-item map folds in 45 ms and keeps the overview at about 475 DOM nodes.
  - 16x replay holds 16.7 ms per frame.
  - A 1000-node static graph opens as 9 stage cards in 0.4 s.
  - Following a live 1000-item run: lag p50 34 ms, p95 69 ms, frame p95 16.7 ms.
  - A viewer attached to a running 250-item run did not measurably slow the writer.
- **Writer cost (a finding for lane 4):** the 1000-item map took 168 s to write at 38 events/s, against 1.98 s and 326 events/s at 100 items. Each event rewrites the whole run blob (829 KB at 1000 items, about 40 ms of size-proportional work per event). That is an algorithm, not a language, so a Rust port alone would not fix it.
- **Constructed workflows:** the seven built by the C0 and gate constructors have 4 to 9 root nodes, and 25 of their 44 root nodes are `code`. Folding there saves little (median 6 to 5 cards).

**Limits**
- **Visual-understanding node:** it cannot be built yet, because agent inputs are json or text only. The game-QA fixture uses text stand-ins and says so in its title.
- **Fixture states:** only 18 of the 37 event types appear in recorded runs on this machine. The retry, wait, human, approval, uncertain and verifier states were checked on real-runtime fixtures with scripted replies, not on recorded runs.
- **Runtime gaps:** seven are listed in section 2.8. They need one-field runtime changes, which wait for the P1 freeze.
- **Untested:** no one has used it, so label quality is unknown, and the ROADMAP "under 2 minutes" test with the owner was not run. It was not tried with a screen reader. Timings come from a shared 4-vCPU box at load 3 to 6.

**Decisions for the owner (section 9 of the doc):** whether the page moves into `web/` as a tab after the C0 freeze, whether constructors emit a labels-and-groups sidecar, and which runtime fields to add first.

## Agent result 3

I wrote `/home/user/workflow-foundry/research/review-20261007/04-efficiency-rust.md`. It holds every number with its source file, the commands, and an A1/A2/B spread (three passes across two VM boots). Scripts and raw outputs are in `/var/tmp/foundry-work/bench/` (`out/r3/` is this boot). `src/` was not touched, nothing was committed, and the only repo file I wrote is the report.

**Headline findings** (all development evidence, none sealed):

1. **The runtime is efficient for today's workloads.** In the latest real Haiku 5.5 runs (50–59 s wall), a model call was in flight for 76–81 % of the time and code nodes took 3–5 %. Foundry's own store and runtime work is about 1–3 %. The idle remainder is mostly queueing for the shared 6-slot model gate, checked on one run.

2. **There is one real scaling defect, and it is an algorithm, not a language.** Every event rewrites the whole run JSON blob, so cost grows with run size: 3–5 ms per node at 100 nodes, 16–18 ms at 500. A 1000-item `map` takes 73–90 s with task bodies and 117–135 s with agent bodies, even with a zero-latency scripted model. Profiles put 77–82 % of CPU in `store.mjs` and `data.mjs`.
   - **Headroom.** An in-memory floor (state in memory, events still hash-chained) is 10–54× faster. It drops to only 2.3× if every read still copies the whole state, so the fix is per-node rows plus targeted reads.
   - **Event loop.** The loop is starved while such runs execute: zero timer ticks during a 500-node chain, 1.6 s median and 3.3 s max lateness at 1000 items. `src/http.mjs` runs executions in the same process as the UI server.

3. **The biggest cheap win is two environment variables for `claude -p`.** The first is `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, the second `FORCE_PROMPT_CACHING_5M=1`.
   - **Latency and CPU.** A trivial call drops from 1.74 s to 0.95 s, and child CPU from 840 to 560 ms.
   - **Cost.** Per-call cost falls 17–31 % on three request shapes.
   - **Throughput.** At concurrency 6 it rises from 1.89 to 3.01 calls/s.
   - **Caveats.** I measured this only on this VM, and P1 is frozen, so adopt it after P1 or log it as a deviation.
   - **Why it matters.** The CLI route is the real ceiling for swarms: about 0.85 core-seconds per call, 2.3 calls/s on 4 vCPU (3.4 with the flags).

4. **Scheduler batch barrier.** On a shadow of the real records DAG, the original scheduler runs 8.5–10.5 % over an ideal schedule. A work-conserving dispatcher runs 0.8–1.5 % over, which is 6.5–8.8 % less wall. The prototype passes 216 of 217 kernel tests; the one failure is the engine-hash binding rejecting a modified source tree.

5. **Sandbox launch costs 200–210 ms per code node.** A 115-line Rust launcher (libc only) passes all 15 tests in `tests/sandbox.test.mjs`, and the suite catches deliberate mutations of it. It takes a JS code node from 212 to 41 ms and a Python one from 187 to 29 ms.

6. **Rust:**
   - **Recommendation.** Do not port the kernel now.
   - **Size.** The kernel is about 4,540 dense JS lines, 10,483 in all of `src/` and `bin/`.
   - **Cost.** I estimate about 19 person-weeks (range 14–26) as judgement, not measurement. It would also carry risk: canonical-JSON number formatting, and Ajv error text that feeds hashed prompts and so replay keys.
   - **Gain.** A Rust version of the whole-blob design is 3–8× faster on the commit path. That saves under 1.5 % of a real run. The in-JS redesign removes the cost entirely.
   - **Alternatives.** Bun and Deno are within noise of Node. Rust is worth adding only as the small standalone sandbox launcher.
   - **Revisit when** all of these hold:
     - overhead is still 10 % or more after the per-node-row redesign;
     - the IR is frozen;
     - a conformance corpus exists;
     - there is a deployment reason, such as embedding into AMP's Rust daemon.

7. **Remaining cost levers are in workflow design.** The two extraction nodes (`vendex`, `vendex_b`) are 52 % of Haiku 5.5 spend and 63 % of output tokens. Output tokens are 58 % of spend and about 3.0 ms per token of latency.

**Not measured:** the owner's laptop, a direct API route (no key), multi-process SQLite contention, and runs above 1,000 items. The report's section 9 lists the full limits. Section 6 has the optimisations ranked by measured gain.
