# Review lane 4: efficiency and the Rust question (2026-10-08)

*Development and diagnostic evidence. Nothing here is a sealed or claim-bearing result. Runtime source under test:
`src/`, `bin/`, `schemas/`, `policy/` are byte-identical at HEAD `450ce53` and `a939083` (`git diff --stat 450ce53 a939083 -- src bin schemas policy`
is empty), and the working tree had no `src/` changes during the measurements. All scripts live in `/var/tmp/foundry-work/bench/`
(not in the repo). Nothing was committed or pushed; the only repo file written is this one.*

**Tags.** **[M]** measured, with the output file named. **[D]** documented, with a path. **[I]** inferred, with the reasoning shown.
Raw outputs: `A1` = `/var/tmp/foundry-work/bench/out/` (previous VM boot, 2026-10-07 22:2x-22:4x), `A2` = `.../out/r2/` (same boot,
22:54-23:22), `B` = `.../out/r3/` (this boot, 2026-10-08 07:17-08:07). B's per-step start load average is in `out/r3/queue.log`.

---

## 0. Answers in brief

1. **For the workloads that exist today the runtime is efficient enough, and model calls dominate.** [M] In the latest real Haiku 5.5
   records runs (50-59 s wall), a model call was in flight for 76-81 % of the wall, sandboxed code nodes took 3-5 %, and Foundry's own
   store/runtime work is about 1-3 % (a strict replay of the same runs, with zero model latency, takes 2.4-3.6 s including the real sandbox runs).
   Sections 2.2 and 3.10.
2. **There is one real scaling defect, and it is an algorithm, not a language.** [M] Every node transition re-reads, re-validates,
   re-serialises and rewrites the whole run JSON blob. Cost per node grows with run size: 3-5 ms/node at 10-100 nodes, 16-18 ms/node at 500,
   and a 1000-item `map` takes **73-90 s for `task` bodies and 117-135 s for `agent` bodies with a zero-latency scripted model** (three passes,
   section 3.1). With real latency that overhead is of the same order as the model time, so it is the first thing that breaks a swarm-style
   fan-out. Profiles put 77-82 % of CPU in `store.mjs` + `data.mjs` (section 4).
3. **A store-less floor shows the headroom.** [M] The same runtime with run state kept in memory (still hash-chaining events) runs
   `chain-task:500` in 0.9 s (vs 9.1 s), `map-task:1000` in 1.65 s (vs 89 s), `map-agent:1000` in 2.7 s (vs 129 s): 10-54x. A version
   that still hands out a full copy of the state on every read gets only 2.3x. The fix is "stop snapshotting the whole run", i.e. per-node rows
   plus targeted reads, not a faster serialiser (section 3.3).
4. **The in-process event loop is starved while a large or all-synchronous run executes.** [M] Zero timer ticks in 8.6 s of a 500-node chain;
   tick lateness p50 0.3 s and max 1.3 s at a 300-item agent map, p50 1.6 s and max 3.3 s at 1000 items. `foundry serve` runs executions in the
   same process as the HTTP/UI server (`src/http.mjs:68`), so a UI sharing that process freezes (section 3.4).
5. **The cheapest, largest win is outside the code base: two environment variables for the `claude -p` route.** [M] With
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` a trivial Haiku 5.5 call goes from 1,744 ms to 949 ms wall (interleaved, n=8), child CPU from
   840 to 560 ms, startup connections from 11 to 6. With `FORCE_PROMPT_CACHING_5M=1` as well, per-call cost falls 17-31 % on three request
   shapes, and throughput at concurrency 6 rises from 1.89 to 3.01 calls/s. Not yet adopted, and P1 is frozen (section 2.4, 6).
6. **The `claude -p` route is the real ceiling for swarms, not Foundry.** [M] One call costs about 0.85 core-seconds of CPU at startup; this
   4-vCPU VM tops out at 2.3 calls/s (3.4 with the flags above). 1,000 leaf judgments need at least 7.2 min (4.9 min with the flags) even with
   unlimited model capacity. A direct HTTP client (needs an owner-provisioned key; not measurable here) is the only path past that (section 2.4).
7. **Scheduler: batch barrier costs 6.5-8.8 % of wall on the real DAG shape.** [M] A work-conserving dispatcher brings the shadow of the real
   records DAG from 8.5-10.5 % over its ideal schedule to 0.8-1.5 % (section 3.6). The prototype passes 216/217 kernel tests; the one failure is
   the engine-hash binding rejecting a modified source tree.
8. **Sandbox launch is 200-210 ms and 200 ms of CPU per code node, from a shell script that forks about 50 times.** [M] A 115-line Rust launcher
   (libc only) passes all 15 tests in `tests/sandbox.test.mjs` and takes a JS code node from 212 to 41 ms (5.2x), Python from 187 to 29 ms (6.4x);
   throughput at concurrency 4 goes from 17 to 77 code nodes/s. Mutations of the launcher are caught by the suite (section 3.7).
9. **Rust: do not port the kernel now.** The measured gain for real runs is at most about 1.5-3 % of wall, the kernel is a moving target,
   and a port would take roughly **19 person-weeks (range 14-26) [I]** for the kernel alone while the research code stays JavaScript.
   Rust helps where it is already cheap to add: a small standalone sandbox launcher. Revisit when the triggers in section 7.5 hold.
   Bun and Deno are within noise of Node (section 7.4).
10. **Biggest remaining cost levers are in workflow design, not runtime:** two extraction nodes (`vendex`, `vendex_b`) are 52 % of Haiku 5.5 spend, 63 % of
    output tokens and about 50 % of summed call latency; output tokens are 58 % of spend and about 3.0 ms/token of latency (section 2.3).

---

## 1. Method, environment and what to trust

- **Machine.** [M] Firecracker VM, Linux 6.18.44, 4 vCPU Intel Xeon @ 2.10 GHz, 16 GB RAM, ext4 on `/dev/vda`. Node v24.21.0, Bun 1.4.2, Deno 2.9.6,
  Rust 1.97.0. The session sets `NODE_OPTIONS=--max-old-space-size=8192` and `BUN_OPTIONS=--smol`; Bun runs below clear the latter.
- **Contention.** Other agents (four C0 builder sessions, P1, `claude -p` workers) share the 4 vCPUs. Every script prints load average and busy
  percentage in its header; most steps ran at load 1.3-5, a few at 7-10. Every number is a p50 over repeats with min/p90/max/sd/cv in the raw output. I report
  three passes where I have them (A1, A2, B) so the spread is visible. Contention moves wall times by up to 2.5x (for example `chain-agent:100`: 0.90 s, 0.99 s,
  2.36 s), so read ratios and scaling, not single absolutes. Another lane measured a 500-node chain at 21.1 s under heavier contention
  (`02-ir-expressiveness.md` section 4); mine is 8.4-9.1 s in three idle-ish passes; same mechanism.
- **What the scripts are.** `wf.mjs` builds the same workflows the tests build (probe task, scripted agent node, map, code node with a stubbed or real
  sandbox). Scripted-provider agent nodes are real agent nodes with the real ModelPort, journal and Ajv validation; only the provider is fake.
  Model-latency numbers come only from the journals and from live Haiku 5.5 calls (about $0.09 total for all live calls in this lane).
- **Prototypes are prototypes.** Anything named `fast`, `fast3`, `b20-floor`, `sbx-proto3` is bench code in `/var/tmp/foundry-work/bench/`, never in the repo.
- **Not measured, so not claimed:** behaviour on the owner's laptop, a direct Anthropic API route (no key), Windows/macOS, cold page cache, multi-writer
  SQLite contention across processes, runs above 1,000 items, GPU-side Kev latency, and Opus/Sonnet runtime paths other than the journals.

---

## 2. Where time and money go in real runs

### 2.1 Real model-call latency (journals)

[M] `journal-latency.mjs` over consistent snapshots of every journal (`snap-journals3.mjs`, B). Live calls only (replays excluded). Latency is
`ModelPort` wall time around `provider.complete`, i.e. the whole `claude -p` process lifetime.

| Journal | Model | n | latency p10 / p50 / p90 / p99 (ms) | mean out tok | mean $/call |
|---|---|---|---|---|---|
| records-v3 | Haiku 5.5 | 2,164 | 2,470 / **3,812** / 6,800 / 8,395 | 775 | 0.00066 |
| records-v3 | Sonnet 5.5 | 531 | 3,215 / **4,208** / 6,162 / 13,484 | 363 | 0.0095 |
| records-v3 | Haiku 4.5 | 3,990 | 3,996 / 6,515 / 8,017 / 11,139 | 428 | 0.0045 |
| p1 | Haiku 5.5 | 282 | 2,502 / 4,194 / 194,925 / 300,332 | 7,172 | 0.0044 |
| p1 | Sonnet 5.5 | 252 | 3,188 / 4,068 / 6,097 / 88,983 | 964 | 0.018 |
| c0-dev (construction) | Haiku 5.5 | 462 | 7,819 / **14,950** / 25,657 / 32,244 | 4,065 | 0.0031 |
| c0-dev | Sonnet 5.5 | 169 | 3,368 / 8,832 / 19,895 / 23,387 | 1,199 | 0.034 |
| c0-dev | Opus 5.5 | 107 | 9,241 / 13,285 / 23,558 / 45,605 | 1,390 | 0.071 |
| kev-probe | Sonnet 5.5 | 398 | 3,054 / 3,981 / 6,220 / 9,616 | 103 | 0.0064 |

File: `out/r3/journal-latency.json`. The long p90/p99 of the `p1` Haiku 5.5 rows are executor-style calls, not typed judgments.

**Latency model.** [M] `journal-model.mjs`, least squares on records-v3: Haiku 5.5 latency = 2,004 ms + 3.01 ms x output tokens (R^2 0.86, n=2,164);
Sonnet 5.5 = 3,215 + 3.87 x tokens (R^2 0.35); Haiku 4.5 = 4,209 + 5.05 x tokens (R^2 0.41). So a typical 775-token Haiku 5.5 answer is 2.3 s of generation plus about 2.0 s fixed.

**How much of one call is not the API.** [M] `journal-cli-overhead.mjs`: the CLI reports `duration_api_ms`; the rest of the journaled latency is process
spawn, initialisation and teardown. Haiku 5.5: latency p50 3,812, API p50 2,316, **non-API p50 1,325 ms (35 %)**; Sonnet 5.5 1,468 ms (35 %); p1 Haiku 5.5
1,332 ms (32 %). Fresh trivial calls (B, `b10`, n=6): wall p50 1,775 ms, API 550 ms, **non-API 1,225 ms, child CPU 870 ms**.

### 2.2 One real run's wall-clock budget

[M] `diag-gaps.mjs` / `diag-gap-detail.mjs` / `diag-global.mjs` on the two surviving Haiku 5.5 live workspaces (`v3-h55fix2-x4`, d4 tasks): the event window is split
into time with at least one model call in flight, time with only a code node running, and the remainder.

| Run | Wall | Model call in flight | Code node only | Remainder |
|---|---|---|---|---|
| `d4_s108` (180 events, 26 calls, 5 code nodes) | 50.3 s | 40.7 s (81 %) | 1.4 s (2.8 %) | 8.1 s (16 %) |
| `d4_s109` (189 events, 27 calls, 5 code nodes) | 59.3 s | 44.9 s (76 %) | 3.0 s (5.1 %) | 11.3 s (19 %) |

**The remainder is mostly queueing for the shared provider gate (checked on `d4_s108`; the barrier below is the other visible part), not runtime slack.** [M] In that run, 5 distinct runs overlapped and the global number of live calls
was 6 in every second where this run had none (`diag-global.mjs`); `ModelPort` allows 6 concurrent `claude-cli` calls
(`src/models/port.mjs:13` `DEFAULT_CONCURRENCY`). Latency is measured after `semaphore.acquire` (`port.mjs` `callStart`), so queue wait is invisible in the journal's
`latency_ms`; per-run "non-model" figures in other analyses (284 runs, p50 22.6 % of wall in `real-run-breakdown.txt`) mostly measure gate sharing.
Lane 6 independently flags the missing "left the queue" event (its gap G1). [I] Aggregate throughput of a saturated gate is
`6 slots / call latency`, so shortening a call (section 2.4) raises it directly.

A scheduler effect is also visible in the same run [M, `diag-events-window.mjs`]: `mirror` finished at 14.13 s, but the next four maps started only at 15.68 s, after `dates` (a Sonnet
escalation) finished at 15.59 s. Section 3.6 measures the cost of that barrier in isolation.

### 2.3 Cost anatomy of the Haiku 5.5 records workflow

[M] `journal-cache.mjs`, `node-kind-shares.txt` (2,164 calls, $1.437). Task cost: $0.014-0.019 per d3/d4 task over the Haiku 5.5 arms (`x4` arms $0.022-0.028)
(`results-live.jsonl`, 12 arms, all 5/5 or 20/20 pass except `h55fix2-x4` 10/12); about 22 calls and 42-60 s each.

| Component | Share of spend |
|---|---|
| Output tokens (1.68 M) | **58 %** |
| Cache writes (2.83 M tokens at 2x input price) | **39 %** |
| Cache reads (3.21 M tokens at 0.1x) | 2 % |
| Uncached input (4,328 tokens) | ~0 % |

| Node kind | calls | % output tokens | % cost | % summed latency | cost/call |
|---|---|---|---|---|---|
| `vendex_b` judge | 376 | 32.7 | 26.8 | 25.6 | $0.00103 |
| `vendex` judge | 376 | 30.5 | 25.6 | 24.0 | $0.00098 |
| `perspective` | 376 | 12.8 | 14.5 | 15.6 | $0.00056 |
| `dates` | 282 | 8.4 | 10.3 | 11.0 | $0.00052 |
| `statuses` | 242 | 4.6 | 7.3 | 7.5 | $0.00044 |
| `mirror` | 282 | 3.6 | 7.1 | 8.0 | $0.00036 |
| `countries`, `atlas_switch`, `adjudicate` | 230 | 7.3 | 8.3 | 8.4 | - |

The two `vendex` nodes emit per-row records of 1.4k tokens whose fields (`name`, `phone`, `balance_text`, ...) are mostly spans copied from the input
(sample in `snap3/records-v3.sqlite`, last `vendex` row). [I] Returning spans as offsets or row indices and letting code slice the text would cut
output tokens substantially; the effect on accuracy is unmeasured and would need its own experiment.

### 2.4 The `claude -p` route in detail (the real fixed cost)

| Measurement [M] | Result | File |
|---|---|---|
| Trivial typed Haiku 5.5 call, wall / API / non-API / child CPU | 1,775 / 550 / 1,225 / 870 ms (n=6); A2: 1,751 / 488 / 1,263 / 810 | `r3/b10.txt`, `r2/b10.txt` |
| `claude --version` | 10-12 ms | shell, 5 runs |
| CLI-internal `duration_ms` (one strace'd call each) vs external wall (b21 p50) | base 756 ms vs 1,744 ms; flagged 654 ms vs 949 ms: about 1 s of the base wall is outside the CLI's own timer (boot and shutdown) | `r3/st/{base,nonessential}.out`, `r3/b21-startup.txt` |
| Startup connects (strace `-e connect`, one call) | 11 AF_INET connects baseline; 6 with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | `r3/st/*.strace` |
| **Env variants, interleaved, n=8, trivial call** | wall p50 / non-API / child CPU: base 1,744 / 1,178 / 840 ms; `DISABLE_NONESSENTIAL_TRAFFIC` **949 / 415 / 560**; `DISABLE_TELEMETRY`+`DISABLE_ERROR_REPORTING`+`DISABLE_BUG_COMMAND` 1,120 / 536 / 640; `CLAUDE_CODE_DISABLE_CLAUDE_MDS`+`CLAUDE_CODE_DISABLE_BUILTIN_ANTMCP` 1,912 / 1,200 / 880 (no effect); nonessential + telemetry + MDS + `DISABLE_AUTOUPDATER` 998 / 420 / 580 | `r3/b21-startup.txt` |
| Same flag on a real `vendex` request (n=7 after warm-up) | wall 6,240 ms base vs 5,651 with the flag (-590 ms, -9 %); with `FORCE_PROMPT_CACHING_5M=1` also: 5,774 ms | `r3/b19-ne-vendex.txt` |
| **Cost per call with `FORCE_PROMPT_CACHING_5M=1`** | trivial call (b13, n=4): $0.000196 -> $0.000135 (-31 %); real `mirror` request (b19, n=4): $0.000362 -> $0.000271 (-25 %); real `vendex` request with the nonessential flag too (n=7): $0.001007 -> $0.000834 (-17 %), cache read 2,105 -> 2,972 tokens, cache write 1,390 -> 356 | `r2/b13.txt`, `r3/b19-cache-variants.txt`, `r3/b19-ne-vendex.txt` |
| An identical request repeated | still writes ~1,200 cache tokens and reads only the CLI's constant ~883; no benefit from repeating | `r3/b19-cache-variants.txt` (`repeat`) |
| Moving instructions into the user message, or `--append-system-prompt` | worse: $0.000436 and $0.000402 vs $0.000362 | same |
| `DISABLE_PROMPT_CACHING=1` | cheaper than default (-12 %, $0.000319) but worse than 5-minute TTL | same |
| **Throughput vs concurrency (24 trivial calls per level)** | K=1 0.52 calls/s; K=2 1.05; K=4 1.49; K=6 1.89 (p50 2.8 s); K=8 2.34 (p50 3.1 s); child CPU 871-911 ms/call | `r3/b22-cli-throughput.txt` |
| Same, both flags set | K=1 0.89 (p50 1.11 s); K=6 **3.01** (p50 1.67 s); K=8 **3.44**; CPU 620-667 ms/call; cost $0.000104/call vs $0.000274/call | `r3/b22-cli-throughput-ne.txt` |

Readings.
- [M] The route's fixed cost is dominated by what the CLI does besides the API call: about 1.2 s and 0.85 core-seconds. The nonessential-traffic flag removes about two thirds of the non-API
  time and a third of the CPU on this VM. [I] The extra connections go to the same remote address as the API traffic (one IP on port 443 in the trace) and to local proxy ports; on a low-latency laptop the saving may be smaller. Unverified there.
- [I] With the flags the remaining non-API time is about 0.4 s, so a direct API client would add only about 0.4 s and 0.56 core-seconds per call over the flagged CLI. The flags remove most of
  the case for building a separate client, except for swarm scale (CPU ceiling 3.4 calls/s) and concurrency above the CPU limit.
- [I] Changing the environment does not change replay keys (`modelDigestOf` hashes the policy entry and provider config, not the process environment), so existing journals still replay. It does change
  engine behaviour for a frozen preregistration (P1), so adopt it after P1 or record it as a deviation.
- Other facts, [D]: `policy/models.json` `claude-cli.invocation` already passes `--safe-mode --strict-mcp-config --tools ""`; `FORCE_PROMPT_CACHING_5M` is not set (lane 1, gap 14).

---

## 3. Runtime overhead without a model

### 3.1 Per-node overhead and scaling

[M] `b02-scaling.mjs`: `Runtime.execute` wall time only (validation and store creation excluded). `probe.noop` task nodes, scripted-provider agent nodes (journaled, Ajv-validated, 100 in/10 out tokens), `map`
nodes with task or agent bodies (concurrency 16), code nodes with a stubbed runner. 3 repeats (2 at size 1000), `synchronous=FULL`, ext4. Cell = **ms per node, p50**; the three values are passes A1 / A2 / B.

| Scenario | n=10 | n=100 | n=500 | n=1000 | events @ max | run blob @ max | peak RSS, fresh process |
|---|---|---|---|---|---|---|---|
| chain of tasks | 4.9 / 3.1 / 3.2 | 6.6 / 4.2 / 4.9 | 15.8 / 16.8 / 18.2 | - | 1,004 | 226 KB | 250 MB |
| fan of tasks | 2.1 / 2.1 / 3.4 | 3.5 / 4.0 / 5.1 | 16.4 / 15.4 / 18.5 | - | 1,004 | 226 KB | 287 MB (A2) |
| `map` with task body | 7.7 / 4.8 / 6.1 | 13.0 / 9.1 / 10.3 | - | **86.0 / 73.5 / 89.5** | 4,006 | 610 KB | 355 MB (n=1000) |
| fan of agent nodes | 12.6 / 6.3 / 5.9 | 10.7 / 8.4 / 9.6 | 48.0 / 32.2 / 35.4 | - | 2,004 | 238 KB | 290 MB (n=500) |
| `map` with agent body | 7.4 / 6.7 / 8.1 | 29.7 / 14.2 / 16.2 | - | **123.7 / 117.1 / 129.4** | 6,006 | 648 KB | 399 MB (n=1000) |
| fan of code nodes (stub sandbox) | 2.1 / 2.1 / 1.8 | 4.8 / 4.5 / 3.1 | 12.5 / 9.7 / 11.2 | - | 1,004 | 124 KB | 91 MB (n=100) |
| chain of agent nodes | 4.4 / 13.4 / 19.7 | 9.0 / 9.9 / 23.6 | 30.7 / 32.0 / 55.2 | - | 2,004 | 238 KB | - |

Totals in pass B (wall p50): `chain-task` 32 ms / 494 ms / 9.09 s for 10 / 100 / 500 nodes; `map-task:1000` 89.5 s (two repeats: 89.5, 92.3); `map-agent:1000` 129.4 s (129.4, 135.0). Files: `out/b02-full-FULL-disk.txt` (A1), `out/r2/b02.txt` (A2), `out/r3/b02.txt` (B).

- A two-term fit of the chain (A2 and B) is wall = 1.1-1.6 ms x n + 0.031-0.033 ms x n^2. [I] Under 100 nodes the linear term dominates; at 500 the quadratic term is about 90 % (fit from two sizes only).
- Marginal cost of a node at small n [M]: task about 3-5 ms (two events), scripted agent node about 6-10 ms (four events + one journal row + one context compile), code node bookkeeping with a stubbed
  sandbox 2-3 ms. Real sandbox spawn adds 200 ms (section 3.7).
- `synchronous=NORMAL` or `OFF` cuts `chain-task:100` from 494-661 ms to about 305-314 ms and the 500-node cases by 13-23 % (`out/b02-NORMAL-disk.txt`, `out/b02-OFF-disk.txt`); tmpfs behaves like NORMAL. Durability is not the main
  cost; CPU is.
- Hard limits [D]: `schemas/workflow.schema.json` caps one node list at 500 nodes (501 is rejected in 1.4 ms, line 89), `map.maxItems` at 1,000 (line 121) and `maxConcurrency` at 16, `checkBudget` aborts the run at 10 MiB
  of run state (`src/runtime.mjs:235`), and `checkData` throws `DATA_LIMIT` above 200,000 JSON nodes (`src/data.mjs:12`). [I] At 26.8-30.8 JSON nodes per map item (counted on 100-item runs) the node limit is reached at about 6.5-7.5k items, the byte cap at about 16k; either way a single map cannot grow past a few thousand items in one run blob.

### 3.2 Why: every event is O(state)

[M] `b03-store.mjs` (B), `Store.updateRun` with a no-op mutation and one event, `synchronous=FULL`:

| Run state | `updateRun` p50 (A1 / A2 / B) | `store.run` (SELECT + `JSON.parse`) p50 |
|---|---|---|
| 2 KB | 0.76 / 0.59 / 0.99 ms | 0.02 ms |
| 10 KB | 1.10 / 0.97 / 1.30 | 0.04-0.06 |
| 93 KB | 3.39 / 3.09 / 3.69 | 0.2 |
| 929 KB | 33.4 / 32.9 / 33.9 | 3.0 |
| 4,679 KB | 186.8 / 201.5 / 197.3 | 16.3 |

Source [D]: `src/store.mjs:121-141` `updateRun` = `this.run(id)` (SELECT + `JSON.parse`), an events `SELECT ... ORDER BY seq DESC LIMIT 1`, an events `COUNT(*)`, the mutation, `checkData(run)` (a full recursive walk plus `JSON.stringify`),
a canonical event insert, `canonical(run)` (a full walk, key sort, `checkData` again, `JSON.stringify`), `UPDATE runs SET body`, and `clone(run)` for the return value (`checkData` + `JSON.stringify` + `JSON.parse`).
`runtime.mjs` also calls `this.current()` (a full `store.run`) about 30 times, and `checkBudget` stringifies the whole run again for the state cap (`runtime.mjs:235`). The raw SQLite commit is not the problem:
a 300-byte row commit is 0.25-0.29 ms at `FULL`, 12-19 us at `NORMAL`/`OFF` (`b03` section a).

Journal and chain [M]: `Journal.record` (4.3 KB row) p50 0.31-0.32 ms (p90 0.45-0.51, max 3.5-4.4 ms); `Journal.lookup` by replay key p50 16-17 us. `Store.events()` (hash-chain verification, used on resume and by every `GET` of a run)
costs 0.8-1.1 ms at 100 events, 5.9-8.9 ms at 1,000 and 30-31 ms at 5,000.

### 3.3 The floor: what an O(1)-per-event design can reach

[M] `b20-floor.mjs`: the same `Runtime` and scenarios with `run`, `updateRun` and `events` replaced by an in-memory implementation that keeps the same semantics the runtime relies on (hash-chained events using the real `digest`,
`eventHead`, `updatedAt`, owner checks inside the mutate callbacks) but no SQLite for run state, no whole-state validation, no clone. It returns the live object (aliasing), which is not a safe design; it is a lower bound.

| Scenario (B, p50) | Current store | Aliased in-memory floor | Speed-up | Floor with a full copy per read (no aliasing) |
|---|---|---|---|---|
| `chain-task:100` | 494 ms | 72 ms | 6.9x | 197 ms |
| `chain-task:500` | 9.09 s | 0.89 s | 10x | 3.97 s |
| `fan-task:500` | 9.27 s | 0.36 s | 26x | - |
| `fan-agent:500` | 17.7 s | 0.68 s | 26x | - |
| `map-task:1000` | 89.5 s | 1.65 s | 54x | 38.5 s |
| `map-agent:1000` | 129.4 s | 2.67 s | 48x | - |

Files `out/r3/b20-floor.txt`, `out/r3/b20-floor-noalias.txt`. Lessons: (1) the runtime's own logic (scheduling, refs, context compile, Ajv, journal) is cheap, 0.3-2.7 ms per node;
(2) the remaining gap at `chain-task:500` (1.78 ms/node vs 0.72 at 100) shows a smaller O(n) per node left in the runtime (for example `labelScope` walks every node of the frame); (3) an in-memory store that still returns a whole copy
of the state per read only gets 2.3x, so the redesign has to change the access pattern: per-node rows (the append-only commit path is 0.12-0.38 ms per event independent of state size at `FULL`, 0.02-0.04 ms at `NORMAL`,
`b15`, 5 MB of existing rows) and targeted reads, not "SQLite -> Rust".

### 3.4 The event loop is starved during large or synchronous runs

[M] `b23-loop-lag.mjs`: a 10 ms ticker and `monitorEventLoopDelay` while a run executes in-process.

| Run | Wall | Tick lateness p50 / p99 / max | Ticks seen / expected |
|---|---|---|---|
| `chain-task:100` (all sync) | 0.57 s | no tick ran | 0 / 57 |
| `chain-task:500` | 8.6 s | no tick ran | 0 / 861 |
| `map-task:300` | 7.2 s | no tick ran | 0 / 724 |
| `fan-agent:200`, 100 ms scripted latency | 4.1 s | 0.2 / 310 / 341 ms | 130 / 407 |
| `map-agent:300`, 100 ms latency | 11.3 s | 312 / 1,347 / 1,347 ms | 30 / 1,125 |
| `map-agent:1000`, 100 ms latency | 115 s | 1,621 / 3,306 / 3,306 ms | 73 / 11,542 |

[D] `src/http.mjs:68` runs `foundry.startRun(run.id)` in the server process. Synchronous `DatabaseSync` calls plus promise chains that never reach the macrotask queue (probe tasks here; journal hits in replay [I], not measured) keep timers, sockets and HTTP
requests waiting for the whole run. For ordinary live runs (15 nodes, 3 ms per event) this is invisible; at 300+ items or during replay it is not. Lane 6 saw the same cause from the UI side (`GET /api/runs/:id` returns
4.1 MB and verifies the whole chain in 86 ms at 1,000 items, `06-ui.md` section 3.1).

### 3.5 Concurrent runs in one process

[M] `b18-concurrent.mjs`: K runs of 40 scripted agent nodes (300 ms scripted latency; lower bound 900 ms per run with `maxConcurrency` 16) in one process. Separate workspaces: K=1 1.18 s; K=2 1.42 s; K=5 1.94 s;
K=10 3.19 s (K x solo would be 11.8 s). One shared workspace and Store: 1.19, 1.29, 1.66, 2.86 s. No failures, no `SQLITE_BUSY` in one process. Ten concurrent runs cost 2.7x the latency of one, entirely from CPU on one thread; with real model
latency (seconds per call, tens of nodes) the aggregate CPU demand is far below that. Multi-process writers to one DB file were not measured.

### 3.6 Scheduler barrier

[D] `src/runtime.mjs:355-371`: each scheduling round takes up to `maxConcurrency` ready nodes and waits for **all** of them (`Promise.allSettled`) before looking at newly ready nodes.
[M] `b09-barrier.mjs`: shadow the real records-v3 DAG (15 nodes, 8 maps, 114-146 events) with sleep tasks whose durations are the real per-node/per-item sums of journaled call latencies, at scale 0.5, global concurrency 4, 5 real runs per label.
"Ideal" is an event-driven work-conserving list schedule over the same durations. `fast3` = the original store with only the scheduler replaced by the work-conserving version.

| Label | Original scheduler: mean wall, over ideal | Work-conserving (fast3): mean wall, over ideal | Change in wall |
|---|---|---|---|
| `h55fix2-d3` (A/B in `r3/b09-orig.txt`, `b09-sched.txt`) | 14.0 s, **+10.5 %** (7.0-13.8) | 12.8 s, **+0.8 %** (0.6-1.2) | **-8.8 %** |
| `h55fix2-d4` (`b09-orig-d4.txt`, `b09-sched-d4.txt`) | 17.8 s, **+8.5 %** (6.6-12.9) | 16.7 s, **+1.5 %** (0.5-4.4) | **-6.5 %** |
| work-conserving + faster store (`fast`) | - | 12.8 s, +1.0 % | -8.6 % |

Earlier scales (0.02, 0.1) gave larger percentages (31 %, 13 %) because fixed store overhead does not scale with the sleeps (A2). Prototype correctness: with `fast3/src/runtime.mjs` and the repo's tests for runtime, journal, context, timers, security,
control, dataflow, store, verdict, ports, engine binding and ModelPort (18 files, 217 tests), 216 pass; the one failure (`timers: foundry tick in a new process`) is `ENGINE_DRIFT`, because the CLI subprocess runs the repo's `src/` while the
test runs the modified one. [I] Any performance change in `src/` therefore changes the engine hash and blocks resume of runs created under the old engine; schedule it as an engine bump. Note: on the real, shared gate (section 2.2) the barrier delays
one run but does not lower aggregate throughput while other runs keep the six slots full.

### 3.7 Code nodes and the sandbox

[M] `b01-sandbox.mjs` (15 repeats), `b01b`, `b01c`, `b08-pool.mjs`, `b11`, `b24-native-vs-prod.mjs`.

| Measure | Result (p50, ms) | Source |
|---|---|---|
| `spawn /bin/true`, `node -e 0`, `node --permission -e 0`, `python3 -I -B -c pass` | 2.3, 31, 42 (28-29 on A2), 16.8 | `r3/b01-a.txt` |
| `unshare --user --net --mount --pid /bin/true` | 4.6-4.7 | same |
| **`runCode` js (trivial) / python / 400 KB input** | A2 210 / 190 / 212; A2 again 204 / 190 / 209; **B 260 / 216 / 246 (load 1.3-3)**; b24 (B) 212 / 187 | `r2/b01*.txt`, `r3/b01-a.txt`, `r3/b24*.txt` |
| Of which `SETUP` shell script alone (`/usr/bin/true`) | 155-175 ms wall, 150-170 ms CPU (26 mounts in `mountinfo` on this VM) | `r2/b01b.txt`, `r3/b01b.txt` |
| `SETUP` without the per-mount remount loop (measurement only, not secure) | 75-83 ms | `r3/b01c.txt` |
| `SETUP` with the loop but without `mountpoint(1)` forks | 119-130 ms (-20 to -25 %) | same |
| Throughput, `runCode` js: concurrency 1 / 2 / 4 / 8 | 3.6-4.9 / 6.5-9.9 / 14-20 / 10-20 per second | `r3/b01-a.txt`, `r2/b01-again.txt` |
| Warm single-use pool (child spawned ahead, payload sent later) | 215 -> **19.7 ms**, 92 % off the node's critical path, CPU unchanged (200 ms per run) | `r3/b08-a.txt`, `r3/b08-b.txt` |
| **Native launcher `sbx-proto3` (115 lines of Rust, `libc` only), whole code node** | js **212 -> 41 ms (5.2x)**, python **187 -> 29 ms (6.4x)**, child CPU 210 -> 40 ms | `r3/b24-native-vs-prod.txt` |
| Throughput with the native launcher: concurrency 1 / 4 / 8 | 25 / 77 / 86 code nodes/s (production 4.9 / 17 / 18.9) | same |

The shell script `SETUP` forks `mountpoint` and `mount` for every inherited mount and every allowlisted path (about 50 process launches); cost therefore grows with the number of host mounts [I: the 26 mounts here are few for a Docker
or desktop host].

**The native launcher was checked against the repo's own adversarial suite**, not only timed. [M] `/var/tmp/foundry-work/bench/native-test/` is a copy of `src/` whose `runCode` execs `sbx-proto3 <lang> <interpreter> <cmd...>` instead of
`unshare ... sh -c SETUP`; `tests/sandbox.test.mjs` run against it: **15 pass, 0 fail, 0 skipped** (production: 15/15, 14.7 s; native: 9.1 s). Mutation checks: skipping the read-only remount of `/proc` makes
"every mount but /tmp is read-only" fail; skipping the rlimits makes "per-process limits cap memory, processes and file size" fail; with a missing launcher the suite skips as unavailable (fails closed). It covers namespaces,
mount allowlist and masks, `/dev` contents, capability drop (CapEff 0), `no_new_privs` (stricter than the shell path), rlimits, uid 65534, PATH-only environment, kill-on-timeout and the nested-userns case. Not covered:
`tests/executor-sandbox.test.mjs` and kernels or hosts other than this VM.

### 3.8 Compile, validate, schema compile, cold start

[M] `b04-compile-validate.mjs` (A2 and B twice, B values shown).

| Operation | Result |
|---|---|
| `compileContext`, 1 input of 1 / 10 / 100 / 1,000 KB | 0.09-0.11 / 0.23 / 1.6-1.7 / 19-20 ms |
| `compileContext`, 8 inputs of 100 KB total; 64 inputs of 10 KB total | 2.0 ms; 0.7-0.8 ms |
| `validateWorkflow`, chain of 10 / 100 / 500 (the schema maximum) | 0.55-0.67 / 3.0-4.3 / 16.7-18.1 ms |
| 999 nodes (499 plus a map body of 500) | 28-30 ms |
| 501 nodes | rejected in 1.4 ms |
| Ajv compile of a new data schema (20 distinct) | 6-8 ms each; cached by digest for 128 schemas (`src/validate.mjs:39-52`) |
| Cold start: `node -e 0` / import `src/foundry.mjs` / `foundry doctor` | 37-39 ms / 220-244 ms / 359-394 ms |
| Of the import, Ajv (module load plus compile of the workflow, identity and decision schemas at import) | 48 % of 226 ms sampled CPU (`out/r3/prof-cold`) |

All of this is negligible next to a 1.1-6 s model call. [I] Cold start matters only for CLI-per-call use; compiling schemas lazily or shipping Ajv standalone validators would remove about 100 ms.

### 3.9 Memory

[M] `b12-mem-child.mjs` (one scenario per fresh process) and `b05` section b. Baseline high-water 74 MB. Peak RSS: `chain-task:500` 250 MB (heap 80 MB); `fan-agent:500` 290 MB; `map-task:1000` 355 MB;
`map-agent:1000` 399 MB (heap 125 MB; run blob 648 KB, events 2.3 MB). Fifteen sequential 20-node runs in one process: RSS flat at 158-160 MB, heap oscillating 12-43 MB, no growth. The peak is garbage from re-parsing
the blob (about 0.2-0.35 MB RSS per node at these sizes), not retained state. Memory is not a constraint at current sizes.

### 3.10 Replay speed

[M] `b05` (scripted, 100 independent agent nodes): live 9.8 ms per agent node vs strict replay 9.4 ms (ratio 0.96-0.99): replay saves the model, not the runtime. `b17-replay-store.mjs`: strict replay of real recorded
records-v3 runs from their stored workflow JSON and journal, into a fresh workspace, compared by answer digest:

| Run | Live wall | Replay wall (A2 / B) | Speed-up | Calls replayed | Same answer |
|---|---|---|---|---|---|
| a5 `d3_s107` | 102.7 s | 2.67 / 2.81 s | 37x | 23 | yes |
| a3 `d3_s103` | 59.9 s | 2.21 / 2.40 s | 25x | 18 | yes |
| h55fix2-x4 `d4_s108` | 50.3 s | 3.17 / 3.53 s | 14x | 26 | yes |
| h55fix2-x4 `d4_s109` | 59.3 s | 3.26 / 3.61 s | 16x | 27 | yes |

4/4 answers identical (`r3/b17-a.txt`, `r3/b17-b.txt`). The replay wall includes four or five real sandbox runs each (the code nodes re-run), so with the native launcher it would be about 0.7-1 s shorter [I].
Reconstructing the replay from `foundry.sqlite` required pinning every node to the model of its first journaled attempt (class M changed from Haiku 4.5 to 5.5), which `b17` does.

---

## 4. Profile hot spots

[M] `node --cpu-prof` on `b02-scaling.mjs` (`prof-analyze.mjs`, `out/r3/prof-analysis.txt`; A2 profiles agree).

| Profile | Busy | `store.mjs` | `data.mjs` (`checkData`, `canonical`, `clone`) | Everything else | `updateRun` inclusive |
|---|---|---|---|---|---|
| `chain-task:300` (4.7 s) | 4,696 ms | 45 % (`JSON.parse` in `run` 25 %, SQLite `transaction` 17 %) | 32 % | 23 % (ajv 2.5 %, gc 3.8 %, runtime 4.2 %) | 57 % |
| `map-agent:200` (6.6 s) | 6,557 ms | 44 % (SQLite 25 %, `JSON.parse` 15 %) | 38 % | 18 % (ajv 2.1 %, gc 3.7 %, runtime 1.3 %) | 72 % |

Top functions by self time: `run` (JSON.parse of the blob), `transaction` (SQLite exec), `checkData`, `walk`, `visit`, `clone`, `canonical`. Model-side code (ModelPort, provider, journal record) is under 2 %.
The cold-start profile is 48 % Ajv. Replaying real runs (`prof-real/`) is dominated by the same functions plus the harness's own store loading, so it is not reported as a separate share.

---

## 5. Is the implementation efficient?

Yes where it is used, no where it will be used next.

- **Real runs today:** runtime plus sandbox is about 4-8 % of wall (store/runtime 1-3 %, code nodes 3-5 %, section 2.2 and 3.10); model calls are 76-81 %; the rest is waiting for the shared gate.
  Within model calls, 35 % of each call is `claude -p` startup and teardown, which two environment variables cut by about two thirds.
- **Where the real costs are, in order [M]:** (1) model latency (a typical Haiku 5.5 call 3.8 s, of which 2.3 s is output tokens) and the 6-slot gate; (2) `claude -p` startup (1.2 s, 0.85 core-seconds, per call);
  (3) output tokens (58 % of spend) and cache writes (39 %); (4) serial dependency chains in the workflow itself (vendex -> diff -> adjudicate -> merge); (5) sandbox launches (0.2 s each, serial on the critical path);
  (6) batch barrier (6.5-8.8 % of wall); (7) store and runtime (1-3 % now, quadratic later).
- **Fan-out and nested workflows are the risk.** [M] A 1,000-item map costs 73-135 s of pure overhead before the first real token, the event loop is unresponsive for seconds while it runs, and the run-state limits (200,000 JSON nodes, 10 MiB) sit at about 6.5-7.5k items.
  [I] Nested frames (`call`, loops) inside one run put every child node in the same blob, so nesting multiplies the problem unless children get their own run rows.
- **Spread:** from n=100 up, the three passes of each scaling number agree within about +-25 % except `chain-agent` (visible contention), and every ratio quoted above is stable across passes.

---

## 6. Optimisations ranked by measured gain

Gain is on the metric named, from the measurement cited. "Effort" is for the JavaScript code base. Rank is by gain per effort on the workloads that exist or are planned (a real 22-26-call record run; a 100-1000-item fan-out).

| # | Change | Measured gain | Effort and risk |
|---|---|---|---|
| 1 | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `FORCE_PROMPT_CACHING_5M=1` in the `claude-cli` provider environment | per call: -0.6 to -0.8 s wall (-9 % on a 6 s call, -45 % on a trivial call), -280 ms CPU, -17 to -31 % cost; gate throughput at K=6 1.89 -> 3.01 calls/s (+59 %); for a 26-call run at effective parallelism 2.5, about 7 s or 12-14 % of wall [I] | two lines. P1 is frozen: adopt after P1 or log a deviation. Verify on the owner's machine; check usage accounting stays reported (cost and tokens are still returned in the measured calls). |
| 2 | Per-node run state (rows) with targeted reads; stop snapshotting and re-validating the whole run per event; check budget from counters; send the UI an event delta, not the blob | map-task:1000 89 s -> 1.65 s floor (54x), chain-task:500 9.1 -> 0.9 s (10x), 2.3x if full copies are kept; event-loop stalls disappear with it; real runs gain 0.5-1.5 s (1-3 %) | largest change in the list (store + about 30 `current()` call sites + resume/audit paths); engine bump; ROADMAP section 2.1 already lists it as debt. Do before swarm and nested features. |
| 3 | Work-conserving dispatch instead of `Promise.allSettled` batches | -8.8 % and -6.5 % wall on the shadowed real DAG (10.5/8.5 % over ideal -> 0.8/1.5 %) | about 30 lines (prototype `fast3/src/runtime.mjs`, 216/217 kernel tests pass; failure is the engine hash). Engine bump. Failure/cancel propagation needs review. |
| 4 | Native sandbox launcher (Rust or C helper, or `bwrap` where present), kept behind the same `runCode` contract | -170 ms and -170 ms CPU per code node (js 212 -> 41 ms, python 187 -> 29 ms); 4.5x throughput at concurrency 4; about 0.85 s (1.5-2 %) off a real run's critical path | 115 lines, passes 15/15 sandbox tests, mutation-checked; needs a build step (rule 6: no binaries in git; build from pinned source or ship a release asset with a manifest hash; keep the shell path as a logged fallback). Treat as a security component: review before replacing. |
| 5 | Pooled single-use sandbox (pre-spawn, payload later) | 215 -> 20 ms off the critical path; CPU unchanged | about 60 lines; keeps the shell script; does not help when code nodes are spawned in bursts. Alternative to 4 if no native helper is wanted. |
| 6 | Shrink the shell `SETUP` (replace the per-mount `mountpoint` forks by one pass) | -20 to -25 % of launch | small, keeps the exact security property if the remount of every listed mount stays; strictly weaker than 4. |
| 7 | Shorter outputs for the two extraction nodes (spans or indices instead of echoed fields; code slices the text) | if output tokens fell by half: about -18 % of total spend, about -2 s on each of the two slowest calls [I from 3.0 ms/token and 63 % token share] | workflow change; must be re-qualified for accuracy (no accuracy data here). |
| 8 | Raise the provider gate with CPU headroom, or give it per-run fairness | gate was pinned at 6 in every idle window; CPU limits calls to 2.3/s (3.4 with the flags in row 1) on 4 vCPU | none without more cores; measure on the target machine. |
| 9 | Direct HTTP model client (needs an owner-provisioned key) | after 1, only about 0.4 s and 0.56 core-seconds per call more (inferred from the flagged startup); needed above about 3.4 calls/s on 4 vCPU | new provider (`gateway.mjs` shows the shape); credentials rule; unmeasurable without a key. |
| 10 | `synchronous=NORMAL` for scratch/diagnostic runs | -13 to -23 % of runtime on 100-500 node runs | weakens crash durability of the evidence core; keep `FULL` where the hash-chain must survive power loss. |
| 11 | Lazy or standalone Ajv validators at import | about 100 ms of the 220-244 ms import | small; only matters for CLI-per-call use. |
| - | **Not worth doing:** a faster serialiser, Bun or Deno (within +-20 % noise), journal batching (0.3 ms per call), context-compile caching (0.1-2 ms), Ajv compile caching (already cached), a Rust port of the whole-blob store (7-9x on a path that should stop existing). | | |

---

## 7. The Rust question

### 7.1 Inventory

[M] `loc.mjs` (cloc is not installed; counts non-blank, non-comment-only lines), 2026-10-08.

| Area | Files | Code lines | Size |
|---|---|---|---|
| `src/` + `bin/` (runtime, interfaces, research modules) | 45 | **10,483** | 802 KB |
| of which core engine (runtime, store, journal, data, context, validate, dataflow, verdict, schema-subset, engine, capabilities, process, ports, hooks, components) | 15 | 2,474 | 204 KB |
| sandbox + executors | 3 | 339 | 33 KB |
| model layer (port, policy, 4 providers, llama supervisor) | 7 | 699 | 58 KB |
| interfaces (CLI, MCP, HTTP/UI server, facade, install) | 5 | 920 | 78 KB |
| judgment (Kev/Jev engine) | 1 | 106 | 9 KB |
| construction, generation, repair, evaluation, trials (research modules) | 11 | 5,264 | 340 KB |
| OpenCode and Ollama adapters | 3 | 681 | 61 KB |
| `tests/` (54 `*.test.mjs` + support; about 4,500 lines exercise the kernel) | 56 | 10,960 | 820 KB |
| `web/` UI | 3 | 1,130 | 122 KB |
| `bridge/` | 35 | 5,520 | 402 KB |
| `experiments/` | 62 | 11,309 | 757 KB |
| `evals/` | 66 | 13,082 (458 code, 12,423 JSON) | 636 KB |
| `beds/` | 171 | 32,043 (+2.8 MB JSON) | 5.4 MB |

Source lines are dense (377 lines over 200 characters in `src/`; the longest is 900), so a line count understates effort. The README counts 765 tests (including subtests); a grep finds about 450 `test(` declarations.

Dependencies [M]: three runtime packages, all pinned: `@modelcontextprotocol/sdk` 1.30.0 (MIT; about 94 packages in `node_modules`, 47 MB with Playwright), `ajv` 8.20.0 (MIT), `jsonc-parser` 3.3.1 (MIT); dev: `playwright` 1.63.0 (Apache-2.0).
Node built-ins used: `fs`, `path`, `crypto`, `child_process`, `url`, `util`, `timers/promises`, `os`, `sqlite`, `http`, `string_decoder`, `perf_hooks`, `module`, `async_hooks` (`AsyncLocalStorage` for scoped cancellation). Tests add `node:test`, `net`, `https`, `stream`, `events` and a Playwright browser.

| Node facility | Rust equivalent | Port risk |
|---|---|---|
| `node:sqlite` | `rusqlite` (bundled SQLite; the same C library) | low; same file format |
| canonical JSON + SHA-256 (`digest`) | `serde_json` + `sha2` + an ECMAScript number formatter (`ryu-js`) | **medium: 5 of 13 number edge cases differ with plain `serde_json`** (`1.0`, `-0`, `1e5`, `123456789012345680000`, `12345678901234567890`; `b16-digest`). Hashes already match on three real states (9, 92, 928 KB). |
| Ajv 8 (draft-07, `allErrors`, strict flags, error messages) | `jsonschema` crate or a hand-written validator | **high: retry feedback puts Ajv's `schemaPath` and `message` text into the next prompt (`port.mjs` `schemaFeedback`), and the prompt is hashed into the replay key**; a different message string breaks replay of recorded retries. |
| `AbortSignal` + `AsyncLocalStorage` scopes + promises | `tokio` + `CancellationToken` + task-local | medium; ownership-token and cancel semantics have many tests (`control-audit`, `runtime-*`) |
| `child_process` for `claude -p`, `llama-server`, sandbox | `tokio::process` | low |
| MCP server (SDK) | `rmcp` | unknown maturity; not evaluated |
| HTTP/UI server | `axum` or `hyper` | low; the UI itself stays JS |
| JS and Python code nodes | still need Node/Python as interpreters inside the sandbox | Rust does not remove the Node dependency |

### 7.2 What a port would take

[I] Method: kernel scope = core engine 2,474 + sandbox 339 + model layer 699 + interfaces 920 + judgment 106 = about 4,540 dense JavaScript lines; x 1.7-1.8 for Rust gives roughly 7.7k lines.
Productivity assumption 120-200 tested lines per engineer-day, plus fixed items. These are estimates, not measurements.

| Piece | Person-weeks | Main risk |
|---|---|---|
| Data, canonical JSON, refs, conditions, labels, dataflow | 1.0 | number formatting parity, refs semantics |
| Store, events, CAS, timers, migration of existing `.foundry` DBs | 1.5 | read-compat with existing runs |
| ModelPort, journal, policy, four providers, replay keys | 2.5 | replay-key bit-compatibility with recorded journals |
| Validator: workflow schema, data schemas, schema subset | 2.5 | Ajv semantics and message text (above) |
| Runtime, context compiler, verdict, capabilities, engine identity | 4.0 | cancellation, ownership tokens, resume, label taint |
| Sandbox launcher productionised | 0.5 | prototype exists (115 lines, 15/15) |
| CLI, MCP, HTTP | 2.0 | `rmcp` maturity |
| Kernel tests ported or a black-box harness over the CLI/MCP | 3.0 | tests assert JS error codes and messages |
| A stable boundary so the 5.9k lines of research modules, experiments, bridge, beds (all import `src/` as a library today) keep working | 2.0 | duplicate maintenance |
| **Total** | **about 19 (range 14-26)** | |

That is 3.5-6 months for one engineer, with the research modules, `bridge`, `experiments`, `beds` and the UI left in JavaScript. During that time the IR is not frozen: lanes 2, 5 and 6 propose nesting, loops, signals, a board, a router
and an event feed, so every change would be made twice or the port would trail the design. [I] Writing Rust is quick with agents; the cost is verification (a conformance corpus), and the existing journals, event chains
and digests are a good start (the digest parity above is the template).

### 7.3 What would get faster, and whether it matters

[M] A Rust re-implementation of the hot commit path (`rust-bench`, same SQLite C library, same pragmas, whole-blob design: select, parse, verify tail, mutate, hash and insert event, serialise, update, commit) against the Node `Store.updateRun`:

| Run state | Node `updateRun` (A1 / A2 / B) | Rust equivalent (A2 / B) | Ratio |
|---|---|---|---|
| 0-2 KB | 0.76 / 0.59 / 0.99 ms | 0.27 / 0.40 ms | 2.5x |
| 9-10 KB | 1.10 / 0.97 / 1.30 | 0.40 / 0.37 | 2.6-3.5x |
| 91-93 KB | 3.39 / 3.09 / 3.69 | 0.92 / 1.02 | 3.6x |
| 927-929 KB | 33.4 / 32.9 / 33.9 | 4.4 / 4.5 | 7.5x |
| 4.3-4.7 MB | 186.8 / 201.5 / 197.3 | 21.4 / 23.1 | 8.6x |

`digest` of a run state (canonical JSON + SHA-256): Node 0.16 / 0.97 / 13.2 ms for 9 / 92 / 928 KB; Rust 0.035 / 0.34 / 4.2 ms (3.1-4.7x), identical hashes (`r3/b16.txt`).
Process cold start: a Rust binary is a few ms against 220-244 ms for the Node import (the Rust launcher itself starts in 5 ms, `r3/b11.txt`). These are the places Rust wins.

Does it matter? [M/I] No for real runs: a record run does 114-189 updates at about 3-4 ms, so the store is 0.4-0.8 s of 42-60 s; Rust would save about 0.3-0.6 s (under 1.5 %). The model, the CLI startup, the 6-slot gate and the dependency
chain are unaffected by the language. In the fan-out regime a Rust port of the *same* whole-blob design would turn a 1000-item agent map from about 129 s to about 30-37 s [I: 82 % of CPU is store/data code, 7.5x on it], but the in-JS design change removes the O(state) term entirely (floor 2.7 s, section 3.3), after which the runtime
is not the bottleneck at all. Algorithm first; the language only multiplies what is left.

### 7.4 Alternatives

| Option | Evidence | Verdict |
|---|---|---|
| Keep Node, fix the algorithm (rows, targeted reads, work-conserving dispatch) | sections 3.3, 3.6 | **do this** |
| Rust or C **sandbox launcher only**, exec'd as a subprocess (no napi, no ABI) | 5.2-6.4x, passes 15/15 | **do this**, as a reviewed security component |
| Rust napi addon for hot paths (digest, store) | hot path 3-8x only if the whole-blob design stays; needs prebuilt `.node` binaries per platform (rule 6), N-API ABI, build chain (cargo 1.97.0 present) | no: the hot path should disappear |
| **Bun 1.4.2** (`BUN_OPTIONS` cleared) | interleaved, 2 rounds, p50: chain-100 0.48-0.67 s vs Node 0.46 s; chain-500 6.8-10.4 s vs 8.7-11.0 s; fan-agent-100 0.91-0.95 vs 0.85-0.93 s; map-agent-100 1.65-1.96 vs 1.66-1.68 s; map-task-100 0.94-1.11 vs 0.92-1.20 s; RSS 162-180 MB vs 238-247 MB at chain-500; 91 tests in 11 core test files pass under `bun test` (A2); cold import 239 ms vs 240 ms | within noise on speed; lower memory; the JS sandbox interpreter must stay Node (`--permission`); no |
| **Deno 2.9.6** (written in Rust) | same files run unmodified (`node:sqlite` works) with `--node-modules-dir=manual`; chain-500 8.3-8.5 s; fan-agent-100 0.77-0.91 s; map-agent-100 1.35-1.54 s; cold import 205 ms | within noise (0-20 % faster on three of five); no |
| Worker threads for the UI/MCP server | would fix section 3.4 without a store redesign, but each worker needs its own `DatabaseSync` handle | cheaper partial fix than a port: run executions in a child process or worker; do it with item 2 |
| Full Rust kernel | sections 7.2-7.3 | not now |

`out/r3/rt.txt` has the raw interleaved Node/Bun/Deno numbers. One caveat: the three runtimes were run at load 3-6 on a shared box, so differences under about 20 % are not resolvable.

### 7.5 Recommendation and triggers

**Keep Node for the kernel.** Spend the effort on items 1-4 of section 6, plus the Rust (or C) launcher. Revisit a Rust kernel only when all of these hold:
1. After the per-node-row redesign, runtime overhead is still at least 10 % of wall or of cost on a representative workload (the criterion lane 1 proposed); today it is 1-3 %.
2. The IR and semantics are frozen after P1/C0 and the lane 2/5/6 features are decided, so the target stops moving.
3. A conformance corpus exists: recorded journals, event chains, replay keys and digests from real runs, plus the sandbox suite, so a port is verifiable by replay, not by reading.
4. There is a deployment reason: embedding into AMP's Rust daemon (landscape R11 documents `hippocampusd`, about 54k lines, loopback HTTP, with a Python client and MCP server [D: `research/landscape-20261006/11-amp-interface-map.md`]) or a single static binary.
   AMP's context compile takes 2.6-19 s [D: `docs/THESIS.md`, the standalone-versus-integrated discussion], three orders of magnitude above anything in Foundry's runtime, so integration cost does not come from Foundry's language.

Cheap preparation now: pin number formatting and canonical JSON in a test vector file; keep Ajv error text out of hashed prompts (or version it); avoid new Node-only APIs in the IR semantics.

---

## 8. What the owner's new asks imply for efficiency

- **Swarms (100-1,000 cheap leaf calls).** [M/I] Today the ceilings are the `claude -p` route (2.3-3.4 calls/s on 4 vCPU), the 6-slot gate, `maxConcurrency` 16, map `maxItems` 1,000 and the O(state) store (73-135 s at 1,000 items).
  A swarm design must either use a direct API client plus the store redesign, or accept minutes of overhead. A leaf must cost much less than $0.0003 and 1 s to be worth fanning out through this route.
- **Workflows inside workflows, iterative flows.** [I] Keep each child in its own run row (own blob, own events, parent holds a handle) so nesting depth does not enlarge one blob; this also matches lane 2's `call`/`detach`/`await`.
  Loops append events and per-iteration rows; they must not grow `run.frames` without bound.
- **Shared board, private notes, audit.** [M] Append-only rows are cheap (0.12-0.38 ms per event at `FULL`, independent of existing size) and hash-chaining is cheap (events verify at 6-9 ms per 1,000); the blob is the only structure that does not scale. Board entries and node scratch belong in rows keyed by `(run, scope, seq)`.
- **Visual UI with live state.** [M] The UI polls the whole run every 3 s (`web/app.js:1062-1064`) and `GET` verifies the full chain (86 ms, 4.1 MB at 1,000 items per lane 6); a "breathing dot" needs a per-node state fold over an event stream with a `seq` cursor, served from a process that does not execute runs
  (section 3.4). Lane 6 measured the viewer side as cheap (45 ms fold for 7,418 events); the writer is the limit.
- **Need-router (Kev).** [D/I] A router in front of every task must be cheaper than the task it routes. A flagged Haiku 5.5 call costs about 0.95-1.1 s and about $0.0001-0.0003; Kev on CPU took 2.5-13.7 s per question here (lane 1), slower than Haiku; GPU 22-28 ms was measured only on the laptop over a tunnel. Route with Kev only where a GPU is in the loop.
- **Frontier and open-source techniques worth checking [I, from general knowledge, not verified in this lane]:** provider batch/async APIs (discounted, but not reachable through `claude -p`), request-level prompt-cache control through a direct client, event-sourced stores with per-entity rows (the pattern in item 2),
  and bubblewrap-style launchers. Lane 3 owns the literature sweep.

---

## 9. Unknowns and limits

- No measurement on the owner's laptop or on cloud hardware. CPU-bound results (sandbox, store) should improve on faster cores; the `claude -p` startup saving may be smaller on a low-latency network.
- The CLI environment flags are measured on three request shapes with n=4-8 per variant and different load phases; they are development evidence. Their effect on the subscription's usage accounting is unknown (the returned cost and token fields are present).
- The shadow DAG reproduces only 54-61 % of the real wall (shadow at full scale / real wall, p50 0.54-0.61), because real runs share the six provider slots with other runs (section 2.2). The A/B between schedulers is exact for the shadow, an estimate for solo live runs, and no live A/B was run (about $0.15 and noisy at n=6).
- The floor and the Rust hot path measure a *design*, not an implementation; the in-memory floor aliases state and skips validation by construction.
- The native launcher differs from the shell path in details (`no_new_privs` is set; mount flags are copied from `mountinfo`/`statvfs`; escaped mount names exit 97 as before). It passed the 15 sandbox tests on this kernel only; escape testing beyond the suite was not done.
- A port estimate of 14-26 person-weeks is judgement, not a measurement; Rust `rmcp` and `jsonschema` fit was not evaluated.
- Multi-process write contention on one SQLite file, runs above 1,000 items, and the run-state 10 MiB cap were not exercised.
- A1 and A2 are outputs left in `/var/tmp/foundry-work/bench/` from an earlier boot (2026-10-07). I reused only outputs I could trace to a script in that directory and re-ran the key ones on this boot (B); `out/r3/*` is the primary record.

---

## 10. Reproduction: commands and files

Everything is under `/var/tmp/foundry-work/bench/`; outputs in `out/r3/` unless noted. Run from that directory.

| What | Command | Output |
|---|---|---|
| Whole serial queue of this pass | `./run-r3.sh` (about 45 min) | `out/r3/*.txt`, `out/r3/queue.log` |
| Sandbox cost, decomposition, SETUP variants | `node b01-sandbox.mjs 15`; `node b01b-sandbox-decomp.mjs 15`; `node b01c-setup-variants.mjs` | `b01-a/b.txt`, `b01b.txt`, `b01c.txt` |
| Warm pool; native launcher floor and whole node | `node b08-pool.mjs 15`; `node b11-native-launcher.mjs 20`; `node b11b-native-codenode.mjs 20`; `node b24-native-vs-prod.mjs 25` | `b08-*.txt`, `b11*.txt`, `b24-native-vs-prod.txt` |
| Native launcher against the sandbox suite | `cargo build --release --offline` in `sbx-proto3/`; `cd native-test && node --test tests/sandbox.test.mjs` (mutations: write `noro-proc` or `nolimits` to `sbx-proto3/MUTATE`) | console |
| Scaling by node type and size | `REPS=3 TAG=r3- node b02-scaling.mjs` (env `ONLY`, `SIZES`, `SYNC`, `ROOT`, `SRC`) | `b02.txt`, `out/b02-r3-*.json` |
| A/B of source variants | `node b02c-compare.mjs "orig=X=1" "fast=SRC=$PWD/fast/src" -- chain-task:100,chain-task:500,fan-agent:500,map-agent:100,map-task:100 3` | `b02c.txt` (store+scheduler prototype 1.01-1.32x) |
| Store, journal, chain verification | `node b03-store.mjs`; `node b15-incremental-store.mjs` (`SYNC=NORMAL` variant) | `b03-*.txt`, `b15*.txt` |
| Store-less floor and event-loop lag | `REPS=3 node b20-floor.mjs` (`ALIAS=0`); `node b23-loop-lag.mjs` | `b20-floor*.txt`, `b23-loop-lag.txt` |
| Concurrent runs | `REPS=3 node b18-concurrent.mjs` | `b18.txt` |
| Compile, validate, schema, cold start | `node b04-compile-validate.mjs` | `b04-a/b.txt` |
| Replay, memory | `node b05-replay-memory.mjs`; `ARMS=... PER_ARM=3 node b17-replay-store.mjs`; `node b12-mem-child.mjs <scenario> <n>` | `b05.txt`, `b17-*.txt`, `mem-*.txt` |
| Scheduler shadow A/B | `SCALE=0.5 LABEL=h55fix2-d3 [SRC=$PWD/fast3/src] node b09-barrier.mjs` | `b09-orig*.txt`, `b09-sched*.txt`, `b09-fast.txt` |
| Kernel tests on a prototype source tree | `cd fast3 && node --test --test-concurrency=2 tests/runtime-*.test.mjs tests/timers.test.mjs ...` (18 files) | console: 216/217, the failure is `ENGINE_DRIFT` |
| Profiles | `node --cpu-prof --cpu-prof-dir=... b02-scaling.mjs` with `ONLY=chain-task SIZES=300 CUSTOM_SIZES=1 REPS=1 NOJSON=1`; `node prof-analyze.mjs <file> 16` | `prof-analysis.txt`, `prof/`, `prof-cold/` |
| Journal latency, cost, cache, CLI overhead | `node snap-journals3.mjs`; `node journal-latency.mjs snap3/*.sqlite`; `journal-model.mjs`, `journal-cache.mjs <db> <model>`, `journal-cli-overhead.mjs`, `real-run-breakdown.mjs` | `journal-*.{txt,json}`, `node-kind-shares.txt` |
| Real-run wall budget and gate sharing | `node diag-gaps.mjs`; `node diag-gap-detail.mjs <arm> <task>`; `node diag-global.mjs <arm> <task>`; `node diag-events-window.mjs <arm> <task> 13000 19500` | `diag-gaps.txt` and console |
| `claude -p` overhead, startup flags, cache variants, throughput (live, about $0.09 total) | `node b10-claude-cli.mjs 6`; `N=8 node b21-startup.mjs`; `N=5 node b19-cache-variants.mjs` (`VARIANTS`, `KIND`); `N=24 node b22-cli-throughput.mjs` (with the two flags exported for the flagged run); `strace -f -tt -e trace=connect claude -p ...` | `b10.txt`, `b21-startup.txt`, `b19-*.txt`, `b22-*.txt`, `st/` |
| Rust hot path and digest | `rust-bench/target/release/foundry-hotpath <kb> 60 FULL <dir>`; `node b16-digest.mjs` | `rust-*.txt`, `b16.txt` |
| Bun and Deno | `./run-rt.sh` (Deno from `npm install --ignore-scripts deno@2.9.6` in `deno-try/`) | `rt.txt` |
| LOC and dependency inventory | `node loc.mjs`; `node loc-roles.mjs`; `npm ls --omit=dev --depth=0` | `out/r3-loc.txt`, `out/r3-loc-roles.txt` |

Prototype sources: `fast/src/{store,runtime}.mjs` (single serialisation per event, no `COUNT(*)`, cached statements, work-conserving dispatch), `fast3/src/runtime.mjs` (dispatch only), `sbx-proto3/src/main.rs` (launcher),
`native-test/src/sandbox.mjs` (the one patched line block), `rust-bench/src/main.rs` (commit path). None of them is in the repo.
