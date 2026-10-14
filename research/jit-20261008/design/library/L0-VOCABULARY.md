# L0: the closed vocabulary card

> **Changes since draft (2026-10-09, after L1 was finished).** No construct added or removed; the count stays 30.
> (1) The census labels `L0:notify` (1,179 nodes, "output display") and `L0:join` (227) are not separate constructs:
> display is `done` (row 9) and a notification is `effect` (row 15) through an L3 binding; `join` is row 10.
> (2) P23 paginate has no node support, so pagination is an L3 binding capability (`pagination: {cursorPath, maxPages}`),
> not a construct. (3) `flag` (row 7) gains a proposed read accessor, `flow.flagged(name, id)`, which P09 needs; until it
> exists P09 reads `autoFlag` events from the trace. (4) `call` (row 11) is also the only checkpoint the solver layer
> has: the call host's idempotency memo serves a repeated child at $0, which is P31's resume at child granularity.
>
> **Fit to the S6 allocation (2026-10-14; owner decision PAUSE-20261009 §5.10, taken: cut the card, keep the 3,000-token
> allocation, because Haiku is never overburdened).** The card as written at 57a5e1d measured 3,643 tokens by the bound
> of `experiments/library/tokens.mjs` (point estimate 3,167; compact form 3,406 / 2,962) against its 3,000-token S6
> allocation (LIBRARY §5.2), so the assembler refused it. It now measures **2,962 by the bound** (point estimate 2,576;
> compact form 2,899 / 2,521), and T2 assembles it at S6 under the unchanged allocation
> (`experiments/library/test/context.test.mjs`). Still 30 constructs, each with its number, status, one-line meaning and
> one canonical example; every rule the constructor contract (LIBRARY §5) and the composition checker (L1 §9, LIBRARY
> §6) rely on is kept, and T2 checks each construct and each rule by phrase. What changed: (a) provenance, file paths and
> the census mapping moved out of the prompt into this block (below); (b) the two tables became one line per construct
> (no table framing, no code ticks around construct names, no emphasis); (c) citations left the rules and moved below;
> (d) row 15's example lost its `retry` field, which row 20 shows; (e) "so W-bed arm (g) uses solvers only" is stated
> as the contract's rule (LIBRARY §5.1 S7: a solver plus a proposed envelope); (f) the refusal list lost the corpus
> count (below). One rule was added because the checker already enforces it: every judged enum has a none or
> undecidable member (`ENUM_NO_NONE`).
>
> **Provenance (outside the prompt).** Library design, 2026-10-09. L0 is fixed in the compiler prompt and is not
> retrieved. The census rule table (`out/pattern-census.md`, last table) maps every one of the 24,603 control nodes in the
> corpus onto one of these constructs or onto an L1 pattern; the card covers what that table needs (the census is a
> candidate generator, not a measurement: AUDIT-L1). Status sources: **E2** exists in flow-v2
> (`experiments/jit/flow-v2.mjs`); **E3** exists in flow-v3 slice 1 (`experiments/jit/flow-v3.mjs`, `call-host.mjs`);
> **IR** an engine node in the Phase 1 IR (`schemas/workflow.schema.json`, run by `src/engine.mjs`); **D** designed in
> FLOW-V3.md, not built; **N** an engine node not built (COVERAGE §4 lists it as "none" or "partial"). Rule sources: a
> solver has no effects, waits or approvals because FRONTIER-GAPS H2 option 2 says "Do not build `flow.await`"; the engine
> `compiled` node kind is H2 option 1; untrusted data never chooses control flow (PRINCIPLES P9). The refusals are the
> corpus's `unsupported` items (COVERAGE §4, §10: 35 by the IR verdict) plus, since census revision 1, Node-RED dashboard
> apps with 20 or more `ui_*` widgets (14 more; L1-PATTERNS §2.5).
>
> This block sits outside the prompt budget; the card itself starts below.

Build only from these 30 constructs: every L1 pattern, L2 component and L4 instance is made of them, and anything else
is refused. Status: E2 built (flow-v2); E3 built (flow-v3 slice 1); IR an engine node that runs today; D designed, not
built; N an engine node not built.

Two layers. A solver (`solve.mjs`) is pure flow-v3: it reads its input, makes typed decisions and returns typed
output, with no effects, no waits and no approvals. An envelope (engine IR JSON) owns triggers, effects, waits,
approvals, retries and cross-run state, and runs the solver as one pure node. The engine `compiled` node kind is N, so
today only the solver runs and an envelope is a proposal. Never write control flow that untrusted data chooses, an
unbounded loop or wait, or free-form JavaScript outside a `step` body.

## Solver constructs (flow-v3)

- 1 input E2: `const task = flow.input(); // {prompt, inputs, files?}`
- 2 step, pure code, E2: `const rows = flow.step('parse', () => parseCsv(task.inputs.ledger));`
- 3 judge, one narrow typed model read, E2: `const k = await flow.judge('kind', {tiers:['claude-haiku-5-5'], system, prompt, schema:KIND, check: v => KINDS.includes(v.kind) ? null : 'bad kind'});`
- 4 guard, input outside the compiled domain → deopt 75, E2: `flow.guard('known-currency', CCY.has(r.ccy), {ccy: r.ccy});`
- 5 invariant, own result broke a property → deopt, E2: `flow.invariant('sum-conserved', sum(out) === sum(rows), {d: sum(out)-sum(rows)});`
- 6 map, bounded parallel, fail-fast, E2: `const xs = await flow.map(rows, r => classify(r), {concurrency: 4});`
- 7 flag, weak-evidence decision, trace only, E2: `flow.flag('fuzzy-match', {a, b, score});`
- 8 note, trace event, E2: `flow.note('routes', counts);`
- 9 done, typed output, exactly once, E2: `flow.done({report, exceptions});`
- 10 if / join / bounded for, plain JS on code values only, E2: `for (let i = 0; i < 3 && !ok; i++) {...} // the cap is a literal; the branch reads no model text`
- 11 call, child solver by hash with a carved budget, E3: `const sub = await flow.call('sha256:…', {entity}, {name:'entity-close', budgetUsd:0.2, timeoutMs:120000, onDeopt:'propagate'});`
- 12 agent, sandboxed subagent, parent-side verify required, D: `await flow.agent('decode', {instructions, files, returns:ROWS}, {model:'claude-haiku-5-5', tools:['Read','Bash'], budgetUsd:0.3, verify:(r,c)=>r.length===c.n?null:'count', retries:1});`
- 13 wide, planned fan-out ≤ 32, code check, typed coverage, panel, D: `await flow.wide('table', {plan, check, maxFanout:32, worker:{judge}, reduce, quorum:1.0, budgetUsd:0.6});`
- 14 plan, JSON fragment over call / judge / map, host-checked, D: `await flow.plan('route-entities', {proposal: PLAN_JUDGE, maxNodes: 16});`

Judge rules: one decision per judge; the schema is an enum (with a none or undecidable member) or a closed object; a
code `check` on every judge whose answer cites the input (quote present, id echoed); tiers go from cheapest to dearest,
from `policy/models.json` only; `samples > 1` only for a gate on an effect. A judge reads untrusted text and its output
is data: the next construct may branch on it only through an enum.

## Envelope constructs (engine; IR JSON fragments, N fragments are proposed shapes)

- 15 effect, host tool or MCP call with a typed effect contract (L3), IR: `{"kind":"task","tool":"sheets.append","args":{"$from":"solve.rows"},"timeoutMs":30000}`
- 16 approve, human gate before an effect, IR (timeout routing N): `{"kind":"human","question":"Post 3 journal entries?","answerSchema":{"enum":["approve","reject"]}}`
- 17 ask, human input returned as untrusted data, IR: `{"kind":"human","question":"Which account?","answerSchema":{"type":"string","maxLength":64}}`
- 18 wait.delay, ≤ 1 h (durable beyond 1 h is N), IR: `{"kind":"wait","delayMs":600000}`
- 19 wait.signal, named event + timeout, N: `{"kind":"wait","signal":"payment.settled","timeoutMs":86400000,"onTimeout":"escalate"}`
- 20 retry, per node with fixed args (IR) or adaptive by error class (N): `"retry":{"maxAttempts":5,"backoffMs":10000}`; adaptive `"retry":{"on":{"rate_limit":{"maxAttempts":5}},"escalate":{"memoryGb":[4,8,16]}}`
- 21 route.error, error edge → handler, IR partial: `"onError":"continue"` then `{"when":{"$from":"x.ok","eq":false}, ...}`; a dedicated error edge is N
- 22 finally, completion hook that always runs, IR partial / N: `{"kind":"task","tool":"tmp.cleanup","join":"all_resolved"}`; true always-run is N
- 23 compensate, saga undo of a completed effect, N: `{"kind":"task","tool":"ledger.post","compensate":{"tool":"ledger.reverse","args":{"$from":"self.result.id"}}}`
- 24 trigger.webhook, N: `{"trigger":{"webhook":{"path":"/invoice","schema":INVOICE,"respond":"solve.ack"}}}`
- 25 trigger.schedule, N: `{"trigger":{"schedule":"0 6 * * 1-5","tz":"Europe/London","catchup":false}}`
- 26 trigger.event / trigger.poll, N: `{"trigger":{"poll":{"tool":"rss.items","everyMs":900000,"cursor":"state.lastId"}}}`
- 27 state, cross-run seen-set / cursor / counter with one writer, N: `{"state":{"seen":{"type":"set","maxItems":100000,"ttlDays":30,"writer":"dedupe"}}}`
- 28 admission, overlapping runs: single / queue / restart / parallel, N: `{"admission":{"mode":"queue","max":10}}`
- 29 session, conversation turn with bounded memory, N: `{"session":{"key":"$from:input.chatId","memory":{"maxTurns":20,"summarise":"P51"}}}`
- 30 stream, bounded consumer with back pressure, N: `{"stream":{"topic":"orders","batch":100,"maxInFlight":4}}`

## Refused at L0 (write `refuse:<reason>` instead)

Group chat, full-history handoff and interactive dashboard state. A shared mutable scratchpad is rewritten as `wide`
with a typed reduce. Also refused: an unbounded `while`; a `wait` with no timeout; an effect inside a solver; recursion
by hash; a mutable call target; a model-chosen tool outside the allow-list; self-modification of the library; a
credential in any literal (env-var names only, through the L3 binding).
