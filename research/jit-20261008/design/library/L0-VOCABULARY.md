# L0: the closed vocabulary card (the constructor's prompt, verbatim; budget at most 3,000 tokens)

*Library design, 2026-10-09. L0 is the closed vocabulary that the Haiku constructor writes in. It is fixed in the
compiler prompt and is not retrieved. Every L1 pattern, L2 component and L4 instance is built only from these 30
constructs, and anything outside this list is refused. The census rule table (`out/pattern-census.md`, last table)
maps every one of the 24,603 control nodes in the corpus onto one of these constructs or onto an L1 pattern; this card
covers what that table needs. Status: **E2** = exists in flow-v2 (`experiments/jit/flow-v2.mjs`); **E3** = exists in
flow-v3 slice 1 (`experiments/jit/flow-v3.mjs`, `call-host.mjs`); **IR** = an engine node that exists in the Phase 1
IR (`schemas/workflow.schema.json`, run by `src/engine.mjs`); **D** = designed in FLOW-V3.md, not built; **N** = an engine
node that is not built (COVERAGE §4 lists it as "none" or "partial").*

**Two layers, one rule.** A *solver* is a pure flow-v3 file (`solve.mjs`). It reads its input, makes typed decisions
and returns typed output. It has no effects, no waits and no approvals: FRONTIER-GAPS H2 option 2 says "Do not build
`flow.await`". An *envelope* is an engine workflow (IR JSON). It owns triggers, effects, waits, approvals, retries and
cross-run state, and it runs the solver as one pure node. The engine `compiled` node kind (H2 option 1) is **N**: it is
not in the schema enum today, so W-bed arm (g) uses solvers only. The constructor never writes control flow that untrusted data chooses (PRINCIPLES P9),
never writes an unbounded loop or wait, and never writes free-form JavaScript outside a `step` body.

## Solver constructs (flow-v3)

| # | construct | st. | one canonical example |
|---|---|---|---|
| 1 | `input` | E2 | `const task = flow.input();  // {prompt, inputs, files?}` |
| 2 | `step` (pure code) | E2 | `const rows = flow.step('parse', () => parseCsv(task.inputs.ledger));` |
| 3 | `judge` (one narrow typed model read) | E2 | `const k = await flow.judge('kind', {tiers:['claude-haiku-5-5'], system, prompt, schema:KIND, check: v => KINDS.includes(v.kind) ? null : 'bad kind'});` |
| 4 | `guard` (input outside compiled domain → deopt 75) | E2 | `flow.guard('known-currency', CCY.has(r.ccy), {ccy: r.ccy});` |
| 5 | `invariant` (own result broke a property → deopt) | E2 | `flow.invariant('sum-conserved', sum(out) === sum(rows), {d: sum(out)-sum(rows)});` |
| 6 | `map` (bounded parallel, fail-fast) | E2 | `const xs = await flow.map(rows, r => classify(r), {concurrency: 4});` |
| 7 | `flag` (weak-evidence decision; trace only) | E2 | `flow.flag('fuzzy-match', {a, b, score});` |
| 8 | `note` (trace event) | E2 | `flow.note('routes', counts);` |
| 9 | `done` (typed output, exactly once) | E2 | `flow.done({report, exceptions});` |
| 10 | `if` / `join` / bounded `for` (plain JS on **code values only**) | E2 | `for (let i = 0; i < 3 && !ok; i++) {...}  // the cap is a literal; the branch reads no model text` |
| 11 | `call` (child solver by hash; carved budget) | E3 | `const sub = await flow.call('sha256:…', {entity}, {name:'entity-close', budgetUsd:0.2, timeoutMs:120000, onDeopt:'propagate'});` |
| 12 | `agent` (sandboxed subagent; parent-side verify required) | D | `await flow.agent('decode', {instructions, files, returns:ROWS}, {model:'claude-haiku-5-5', tools:['Read','Bash'], budgetUsd:0.3, verify:(r,c)=>r.length===c.n?null:'count', retries:1});` |
| 13 | `wide` (planned fan-out ≤ 32, code check, typed coverage, panel) | D | `await flow.wide('table', {plan, check, maxFanout:32, worker:{judge}, reduce, quorum:1.0, budgetUsd:0.6});` |
| 14 | `plan` (JSON fragment over call/judge/map; host-checked) | D | `await flow.plan('route-entities', {proposal: PLAN_JUDGE, maxNodes: 16});` |

Judge rules carried on the card: one decision per judge; the schema is an enum or a closed object; a code `check` on
every judge whose answer cites the input (quote present, id echoed); tiers go from cheapest to dearest, from
`policy/models.json` only; `samples > 1` only for a gate on an effect. A judge reads untrusted text, and its output is
data. The next construct may branch on it only through an enum.

## Envelope constructs (engine)

| # | construct | st. | one canonical example (IR JSON fragment; **N** fragments are proposed shapes) |
|---|---|---|---|
| 15 | `effect` (host tool / MCP call; typed effect contract, L3) | IR | `{"kind":"task","tool":"sheets.append","args":{"$from":"solve.rows"},"timeoutMs":30000,"retry":{"maxAttempts":3,"backoffMs":2000}}` |
| 16 | `approve` (human gate before an effect) | IR | `{"kind":"human","question":"Post 3 journal entries?","answerSchema":{"enum":["approve","reject"]}}`; timeout routing **N** |
| 17 | `ask` (human input; returned as untrusted data) | IR | `{"kind":"human","question":"Which account?","answerSchema":{"type":"string","maxLength":64}}` |
| 18 | `wait.delay` (≤ 1 h; durable beyond 1 h is **N**) | IR | `{"kind":"wait","delayMs":600000}` |
| 19 | `wait.signal` (named event + timeout) | N | `{"kind":"wait","signal":"payment.settled","timeoutMs":86400000,"onTimeout":"escalate"}` |
| 20 | `retry` (per node; fixed args) / adaptive (by error class) | IR / N | `"retry":{"maxAttempts":5,"backoffMs":10000}`; adaptive: `"retry":{"on":{"rate_limit":{"maxAttempts":5}},"escalate":{"memoryGb":[4,8,16]}}` |
| 21 | `route.error` (error edge → handler) | IR partial | `"onError":"continue"` and then `{"when":{"$from":"x.ok","eq":false}, ...}`; a dedicated error edge is **N** |
| 22 | `finally` (completion hook; always runs) | IR partial / N | `{"kind":"task","tool":"tmp.cleanup","join":"all_resolved"}` (partial; true always-run is **N**) |
| 23 | `compensate` (saga undo of a completed effect) | N | `{"kind":"task","tool":"ledger.post","compensate":{"tool":"ledger.reverse","args":{"$from":"self.result.id"}}}` |
| 24 | `trigger.webhook` | N | `{"trigger":{"webhook":{"path":"/invoice","schema":INVOICE,"respond":"solve.ack"}}}` |
| 25 | `trigger.schedule` | N | `{"trigger":{"schedule":"0 6 * * 1-5","tz":"Europe/London","catchup":false}}` |
| 26 | `trigger.event` / `trigger.poll` | N | `{"trigger":{"poll":{"tool":"rss.items","everyMs":900000,"cursor":"state.lastId"}}}` |
| 27 | `state` (cross-run seen-set / cursor / counter; one writer) | N | `{"state":{"seen":{"type":"set","maxItems":100000,"ttlDays":30,"writer":"dedupe"}}}` |
| 28 | `admission` (overlapping runs: single / queue / restart / parallel) | N | `{"admission":{"mode":"queue","max":10}}` |
| 29 | `session` (conversation turn with bounded memory) | N | `{"session":{"key":"$from:input.chatId","memory":{"maxTurns":20,"summarise":"P51"}}}` |
| 30 | `stream` (bounded consumer, back pressure) | N | `{"stream":{"topic":"orders","batch":100,"maxInFlight":4}}` |

## What is refused at L0 (the constructor writes `refuse:<reason>` instead)

Group chat, full-history handoff and interactive dashboard state are the corpus's 35 `unsupported` items (COVERAGE §4, §10).
A shared mutable scratchpad is rewritten as `wide` with a typed reduce. Also refused:
- unbounded `while`;
- a `wait` with no timeout;
- an effect inside a solver;
- recursion by hash;
- a mutable call target;
- a model-chosen tool outside the allow-list;
- self-modification of the library;
- a credential in any literal: env-var names only, through the L3 binding.
