# Shared draws: equivalence check and design (BLOCKER-SYNTHESIS row 23, dossier 9 B10-E1 / QE1)

*Dev diagnostic. $0: no model calls, no usage spent. Read-only on `stream.mjs`, `interpret.mjs`, `b0-agent.mjs` and
`src/executors/claude-code.mjs`. Nothing here changes a config, an arm hash or the PREREG; the amendment text in §5 is a
draft for the PREREG owner.*

**The idea (dossier 9 §B10.1).** Each JIT arm buys its interpreter-role sessions (`interpreter` for warmup and deopt
fallbacks, `shadow`, `adjudicator`) separately, although they call the same `interpret()` as the `agent:<model>` arm on
the same model. If the requests are the same, the 2nd and 3rd agent draws per (task, model) could serve as the JIT arms'
interpreter pool. The interpreter spend would then be paid once.

## 1. Method

`equivalence-check.mjs` runs the real `runStream` with two arms on one model (`agent:claude-sonnet-5-5` and
`jit:claude-sonnet-5-5/claude-haiku-5-5`, warmup 1, a shadow on every compiled run). Interpretation goes through the real
`interpret()` → `b0Agent` → `runClaudeCode`, inside the real sandbox. Only the CLI binary is replaced, by
`stand-in-cli.sh`. The stand-in records what a real session would receive (argv, working directory, the prompt on stdin,
a sha256 of every workdir file) and makes no model call. The compiler, compiled runner, oracle and model port are fakes.
The task is synthetic, so no bed seed is generated or read. The stand-in never reads environment variables.

The sandbox hides `$HOME` and with it the repository, so the harness copies the stand-in into each fresh workdir as
`.stand-in-cli.sh`. The capture excludes that file. The harness also records the `interpret()` arguments exactly as
`stream.mjs` passed them.

`upper-bounds.mjs` recomputes the replaceable spend from committed totals.

```
node research/jit-20261008/analysis/shared-draws/equivalence-check.mjs   # writes equivalence-check.json (~10 s)
node research/jit-20261008/analysis/shared-draws/upper-bounds.mjs        # writes upper-bounds.json
```

`equivalence-check.json` records the sha256 of each exercised file, whether it differed from HEAD (`bb81aff`) at run
time, and that run's results. `stream.mjs` and `claude-code.mjs` had uncommitted work by other agents (export, seed
ledger, env allow-list). None of it touches the interpret call site, the workdir or traceId naming, or adjudication
(checked by diff). Every arm goes through the same `runClaudeCode`, so executor changes apply to all of them equally.

## 2. Result: field-by-field

The comparison is for the same task and model: the agent arm's session against the JIT `interpreter` (warmup),
`shadow` and `adjudicator` sessions.

| field | agent arm | JIT roles | same bytes? | reaches the model / changes decoding? |
|---|---|---|---|---|
| model id | `arm.model` | `arm.interpreter` | **yes** when the interpreter is the agent's model | yes, but identical |
| prompt text (stdin): bed prompt + `instructions(schema)` | b0Agent | b0Agent | **yes** (sha `20da1c68…` in all 5 sessions) | identical |
| output schema (inside the prompt) | family schema | family schema | **yes** | identical |
| argv: `-p --model … --output-format stream-json --verbose --no-session-persistence --safe-mode --strict-mcp-config --mcp-config {} --disable-slash-commands --tools Bash,Read,Write,Edit,Glob,Grep --permission-mode bypassPermissions --max-budget-usd 2` | — | — | **yes** (sha `37dcf734…` in all 5) | identical |
| `--effort` | `config.agentEffort` | `config.agentEffort` | **yes** (absent in both here) | identical. Config-level, not arm-level, so it matches only when both arms share one config file (true for `dev-records-1`, `dev-kinetics-1` and R0's draft configs) |
| `--max-budget-usd` | `config.agentBudgetUsd` | same | **yes** | not text the model reads; it ends a session the same way in both arms. Config-level, same caveat |
| timeout | `config.agentMinutes` | same | **yes** | not seen by the model; a kill truncates identically. Config-level |
| `--system-prompt` / `--append-system-prompt` | none | none | **yes** | the CLI's built-in system prompt is used in both |
| workdir contents (`inputs.json`, `files/*`) | `solverView(task)` | same | **yes** (same file shas) | identical. **Interactive families only:** `.env-service.json` holds a fresh service URL and token per session, so it differs. Not records or kinetics |
| salt | none | none | n/a | Interpreter sessions are not ModelPort calls: no salt, seed or temperature, and no journal. The salt and the salt-free memo apply only to compiled solvers' gateway judge calls (`run-compiled.mjs` `requestDigestOf`, flow-v2 `requestOf`). `claude -p` exposes no seed, so even byte-identical requests are independent draws |
| process environment | scrubbed parent env + `TMPDIR=/tmp` | same | same process, so same | not prompt text |
| **working directory** | `<workRoot>/<experiment>/agent-<model>/i<idx>-interpreter-<rand6>` | `<workRoot>/<experiment>/jit-<interp>--<compiler>/i<idx>-<role>-<rand6>` | **NO** | **Yes, it can change decoding.** The cwd reaches the model through the CLI's environment block in its system prompt (standard CLI behaviour; not checkable at $0), `pwd`, and every absolute path in Read and Write calls. Three parts differ: (a) `<rand6>` is random and differs between any two draws, agent–agent included, so it is exchangeable noise; (b) **the arm slug** (`agent-claude-sonnet-5-5` vs `jit-claude-sonnet-5-5--claude-haiku-5-5`); (c) **the role word** (`interpreter` / `shadow` / `adjudicator`). (b) and (c) are systematic, semantic cues: a session can read that it is a shadow or an adjudicator in a JIT arm. Their effect on answers is unmeasured |
| date in the CLI system prompt; CLI version | run time | run time | same only if run on the same day and CLI build | agent arms run in the concurrent pool and JIT arms run sequentially, often hours apart (the 187-minute stall, dossier 9). A CLI auto-update between them changes the CLI's own prompt |
| prior context | fresh session | fresh session | **yes** | the shadow and adjudicator never see the compiled answer: `interpret()` receives only the task |

The JS-level `interpret()` arguments differ only in `traceId` and `workdir`. The 7 others are identical: `budgetUsd`,
`effort`, `familyId`, `model`, `outputSchema`, `task` and `timeoutMs`.

**Verdict.**
- **Not byte-equivalent.** The one difference that reaches the model is the working directory path: the arm slug, the
  role word and a random suffix.
- **Equivalent in every field the arm config controls,** provided both arms share one config file. Model, prompt, schema,
  tools, flags, effort, budget, timeout, workdir files and environment all match.
- The random suffix is noise of the same kind between any two draws.
- The slug and role words are a small, systematic, unmeasured difference. They can be removed at $0 (§3), and should be
  before any draw is shared. Until they are, a pooled draw is "the same request up to a self-describing path", not an
  exchangeable draw.
- The per-draw cost agrees: S/H's 11 interpreter-role draws cost $0.30 each, against $0.29 per task for the Sonnet agent.

## 3. Design

**What must be made identical** (all in `stream.mjs`'s interpret call or the config; nothing in `interpret.mjs`):
1. **A neutral working directory** for every interpreter-family session in every arm, for example
   `<workRoot>/draws/<drawKey16>/d<k>`, with no arm slug and no role word. The arm and role go in the trace and the
   ledger, not in the path.
2. **One interpreter definition** shared by agent arms and JIT roles: `agentBudgetUsd`, `agentMinutes`, `agentEffort`,
   tools, `b0Agent` instructions. Its hash goes in the draw key. A JIT arm may consume a draw only when its own definition
   hashes the same, so arms in separate config files cannot silently share.
3. **The CLI build pinned and recorded** (in the init event or `claude --version`) and part of the key. All draws for one
   (task, model) are bought in one window, before the JIT arms consume them, which also removes the time-of-day
   difference.

**Journal keying: a draw ledger, the session-level twin of the salt-free memo.** S0-2's memo
(`run-compiled.mjs requestDigestOf`, flow-v2 `requestOf`/`requestDigest`) keys a gateway call by the sha256 of the
request as posted, with no salt, runId or nodeKey. A cursor per digest serves repeated identical requests in order. The
ledger should follow the same convention, with the same `canonical()` and sha256, so one audit tool covers both:
- `drawKey = sha256(canonical({ familyId, taskSha256, model, effort, budgetUsd, timeoutMs, tools, argvSha256, outputSchemaSha256, b0Sha256, cliVersion, policySha256 }))`.
  `taskSha256` is the trace's existing hash of `solverView`'s prompt, inputs and files.
- The key has **no** arm, role, traceId, runId or salt. Like the memo's digest, it describes only what reaches the model.
- Entry `(drawKey, k)` holds `{ traceId, tracePath, costUsd, answerSha256, createdAt, consumers: [{ arm, stream, role, idx }] }`.
  `k` is the ordinal, like the memo's cursor index. Draws are immutable once written. A resumed arm re-consumes the same
  `k`, and a faulted draw is replaced by appending `k ≥ R`, which is logged.

**Allocation (fixed in advance; blind to outcomes).**
- PREREG-stream (draft, HEAD) runs K = 2 streams on **different seed sets** (8001–8024 and 8101–8124), with one JIT
  lineage per arm per stream. So within a stream each (task, model) has exactly one agent draw, d0, and it is the
  scored one.
- Sharing therefore needs **R ≥ 3 same-seed replicate draws** for each agent arm whose model a JIT arm interprets with:
  - d0 is the agent arm's scored draw. It is never consumed by a JIT role.
  - d1 serves the JIT `interpreter` role (warmup and deopt fallback) or its `shadow` on task t. A task is either
    interpreted or compiled-and-shadowed, never both (`runJitTask`), so one draw covers both roles.
  - d2 serves the `adjudicator`.
- The JIT asks the ledger for `(drawKey, k)` only after its own state machine has decided to interpret, shadow or
  adjudicate. Under PREREG §2's ε = 0.25 floor that decision is a Bernoulli draw independent of the draw's content, so
  consumption does not select on content.

**Bias risks.**
1. **A JIT arm and an agent replicate scored on the same draw are not independent.**
   - If the JIT delivers d1's answer on task t (warmup, fallback, or adjudicated to the interpreter), and d1 is also
     scored as an agent replicate, the two outcomes are identical by construction.
   - A paired comparison (McNemar, or PREREG §4's task pairing) between them gets forced concordance, so the
     discordant count shrinks. A "no difference" or non-inferiority reading is then biased toward equivalence, and the
     variance of the difference is understated.
   - **Rule:** every JIT-vs-agent contrast uses d0 only. Replicates d1 and d2 are reported only for the within-task
     variance of the agent arm, never as a second agent stream in a JIT contrast.
   - Common random numbers would be legitimate only with an analysis that models the coupling. At n = 24 and K = 2 that
     is not worth it.
2. **Shadow and adjudicator must be different draws** (d1 ≠ d2). Otherwise majority-of-three collapses to two.
3. **Lineage variance (B9).** Two JIT lineages on the same seeds must not share warmup draws, or their compile inputs are
   identical and between-lineage variance is understated. PREREG's lineages are on different seed sets, so this does
   not arise. Raising K to same-seed lineages would need R ≥ 5 (d1–d2 for one lineage, d3–d4 for the other).
4. **The saving is real only if the replicates are bought anyway.** Under PREREG as drafted there are no replicates, and
   the only shareable draw is d0. Consuming d0 is rejected under (1), so the realisable saving is **$0**. With R = 3
   bought only to feed the JIT, nothing is saved; the spend just moves. The bounds below apply only if same-seed agent
   replicates are wanted for their own sake, for example for per-task agent variance (B9's ρ).
5. **Coverage.** A JIT arm can share only with a same-model agent arm. PREREG-stream §2 has all three agent arms. The
   HANDOFF §5.2 held-out list has no Sonnet agent, so S/H gets nothing there. R0 (synthesis row 8) has only the Haiku
   agent, so only H/H could share (`upper-bounds.json` `coverage`).

## 4. Upper bounds (assume equivalence, and enough replicate draws)

Each bound is the arm's whole interpreter-role spend: interpreter + shadow + adjudicator.

| arm | replaceable | of arm total | share | source |
|---|---|---|---|---|
| records O/H | $5.15 (interpreter 2.31 + shadows 2.20 + adjudicator 0.64) | $7.53 | **68.4%** (dossier: 69%, $5.16 from raw rows) | DEV-NOTES D12 |
| records S/H | $3.27 (interpreter 1.46 + shadows/adjudication 1.81) | $8.99 | **36.4%** (dossier: 36%) | DEV-NOTES D10 |
| records H/H | $0.81 | ≈ $5.79 implied | 14% | dossier 9 only; raw rows lost; a later snapshot than FG §0.1's $3.24 at 19 tasks |
| kinetics S/H | $1.88 | ≈ $18.8 implied | 10% | dossier 9 only; raw rows lost |
| kinetics O/H | $0 | $17.82 | 0% | no Opus agent arm in kinetics |
| whole records dev stream | $9.23 | $46.57 | 19.8% | all arms (H/H at the implied total) |

These assume: (a) the §3 path fix, so draws are exchangeable; (b) R ≥ 3 replicates already bought for another reason;
(c) a same-model agent arm in the design. Under PREREG as drafted, (b) fails and the realisable figure is $0. Under R0,
(c) fails for S/H and O/H.

## 5. PREREG amendment text (draft, for the PREREG-stream owner; not applied here)

> **Amendment (shared interpreter draws), proposed before any held-out run.** (1) Every interpreter-family session
> (agent arms; JIT `interpreter`, `shadow`, `adjudicator`) runs in a working directory whose path names neither the arm
> nor the role (`<workRoot>/draws/<drawKey16>/d<k>`); the arm and role are recorded in the trace and the draw ledger.
> (2) A draw is keyed by a salt-free `drawKey` over everything that reaches the CLI (family, task hash, model, effort,
> budget, timeout, tools, argv hash, schema hash, b0 instruction hash, CLI version, policy hash) and an ordinal `k`,
> using the same canonical sha256 convention as the S0-2 memo. (3) For each agent arm whose model is a JIT interpreter,
> R = 3 draws per task are bought on the stream's seeds before the JIT arms run: d0 is the agent arm's scored draw;
> d1 and d2 are replicates. The JIT arm on that model takes d1 for its interpreter or shadow session and d2 for its
> adjudicator, in place of a fresh session; a missing or faulted draw is replaced by a fresh one, logged as k ≥ 3.
> (4) Every JIT-vs-agent comparison uses d0 only. Replicates are reported only as within-task agent variance. (5) A JIT
> arm may consume a draw only if its interpreter definition hash equals the draw's. (6) Cost: an arm's interpreter-role
> spend is reported both as consumed draws (at the draw's cost) and as fresh-session cost avoided; neither moves the
> primary cost-per-success, which counts every draw once, in the arm that consumed it **and** in the agent arm that
> bought it, so both arms keep their standalone cost.

Point (6) is what keeps the PREREG's "every dollar" cost measure unchanged per arm. The saving appears only in the
experiment's total spend, not in any arm's cost per success.

## 6. Caveats and what this check cannot show

- The stand-in proves what `stream.mjs` hands the CLI. It cannot show the CLI's own system prompt. That the cwd and date
  appear there is standard CLI behaviour, not verified at $0. The §3 fix removes the question either way.
- Whether the slug and role words change answers is untested. Testing it needs paired live draws (Haiku-cents). It is not
  worth running if §3 is adopted.
- The dossier's "tabulate pass rates of JIT-role draws against agent-arm draws on the same pairs" part of QE1 needs the
  lost per-task traces. It waits for R0's persisted traces (S0-1 export).
- Upper bounds use committed totals (D10, D12) and the dossier's stated shares where raw rows are lost. They are dev, K = 1.
