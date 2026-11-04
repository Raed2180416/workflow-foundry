# Scale: jobs larger than one context

Load this when the work has more than ~50 units or cannot fit one reader's input budget: auditing a large codebase,
a research program over gigabytes of data, a backlog of thousands of records. The aim is a workflow that **proves
it covered everything and checked what it found**, at the lowest cost per verified unit.

## Why big jobs fail

The weak points below appear in published traces and in ours. Each has a counter that code owns.

| Weak point | Evidence | Counter |
|---|---|---|
| Declaring done early | Premature termination is a named multi-agent failure mode (MAST, arXiv 2503.13657); a stop rule that demands evidence cut premature stops from 40/66 to 0/66 (arXiv 2608.23623) | Stop only when the coverage ledger and every gate have evidence |
| Never stopping | 34% of 6,549 agent repos had no exit mechanism at all (arXiv 2607.01641) | `maxIterations`, timeouts, `maxItems`, run budget on everything |
| Skimming and context rot | Quality falls as inputs grow, even for frontier models (Recursive LMs, arXiv 2512.24601) | Small shards; the input treated as an environment that code slices, not one huge prompt |
| Coverage illusion | A model's "I reviewed all files" is unchecked | The reader returns the unit ids it read; code compares them with the shard |
| Lost provenance | Findings merged without location cannot be checked or de-duplicated | Every finding = unit id + location + reason |
| Correlated misses | One model's blind spots repeat across shards | A blind second reader of a different model on a fixed sample |
| Contradictions across shards | Shards judge in isolation | Reconcile step over recorded cross-shard edges |
| Cost blow-up | Multi-agent systems use about 15x the tokens of chat (Anthropic, multi-agent research system, 2025) | Fan-out sized from a measured probe; cheapest class that passes |

## The protocol

1. **Recon by code.** List every unit with id, path or key, size and type. Record the structure: directories,
   modules, tables, partitions, time ranges, plus import or join edges between units. Recon output is the inventory
   the ledger is checked against, so it must come from code.
2. **Filter by code, then size from a probe.** First let code clear what it can (static checks, statistics,
   queries); models get only what code cannot decide. Then run the reader on 3–5 probe shards with known answers
   at increasing sizes (e.g. 1/8, 1/4, 1/2 of the model's window) and measure recall and cost per unit. Shard
   size = the largest size before recall drops (bigger shards are cheaper per unit until context rot). Shard
   count = remaining work ÷ shard size. If shard count × cost per shard exceeds the budget, do not fan out
   further: filter more by code, sample with a stated guarantee (step 9), or ask. Use the cheapest model class
   whose probe recall meets the bar; a stronger class may justify larger shards. If the remaining work fits a
   few calls, do not fan out at all.
3. **Partition by structure.** Keep coupled units together: a module, a table, a time window. Bound each shard by
   the measured per-reader budget. Keep shards well inside the model's window, since context rot starts long
   before the limit. Record the edges a shard boundary cuts; the reconcile step needs them.
4. **Fan out as sized, not as allowed.** The count comes from step 2. One `map` takes at most 1,000 items and
   runs at most 16 at once; that is a limit, not a target. Beyond it, nest maps (a map of shard groups). Set `failure: "collect"` and gate on the failed count, so a
   failed shard is visible and never silently dropped. Set `concurrency` from the budget.
5. **Coverage ledger.** Each reader returns the unit ids it read. A `verify` node with `method: "ledger"` (subject: the
   map; `ledger.inventory`: the ids code listed in step 1; `ledger.reads`: the path to each item's ids) fails unless
   every unit is read, none more than `maxReads` times (default 1; raise it only for a planned second reading), no read
   names a unit outside the inventory, and no shard failed. Never hand-write this count (`antipatterns.md`).
6. **Re-decompose, don't drop.** A shard that fails, times out or exceeds budget is split and re-run in a bounded
   `loop` until none fail or the retry budget ends. Remaining failures are reported by name, never absorbed.
7. **Sampled second reader.** Pick a fixed-rule sample of shards (every k-th), so a model doesn't choose its own
   sample. A different model class re-reads it blind to the first findings. Code estimates the first reader's miss
   rate and gates on it.
8. **Reconcile.** De-duplicate on unit + location + claim, check findings that cross recorded edges, and flag
   contradictions for a judgment node or a person.
9. **When exhaustive is unaffordable, say so up front.** Choose one of these and state the guarantee in the envelope:
   - (a) a cheap exhaustive pass by code (static analysis, grep, statistics, schema checks), with models only on
     flagged units;
   - (b) a uniform random or stratified sample. With n sampled units and zero misses, the miss rate is below 3/n at
     95% confidence (the rule of three).

   Never present a sample as a full audit.
10. **Checkpoint.** The engine journals each map item, so a resumed run continues where it stopped. Keep shard
    outputs small and typed so a resume is cheap.
11. **Stop on evidence.** Done means: the ledger is complete, the failed count is 0 (or named), the second-reader
    gate passed, and the reconcile step ran. Report the miss-rate estimate with its sample size.

## Is a big workflow optimal? The rubric

Score a generated workflow before running it at scale, and again after the probe:

| Measure | Good | Bad sign |
|---|---|---|
| Cost per verified unit | Falls as code takes more of the work | Model calls on units code could have cleared |
| Proved coverage | Ledger equals inventory | Coverage stated by a model |
| Redundancy | Only the planned second reading | Units read by several shards; overlapping agents |
| Verifier strength | Sampled miss rate measured; a mutated output fails a gate | Checks that never failed in practice |
| Critical path | Short; the long work is parallel | A serial chain of model calls |
| Large-class spend | Named nodes with a justification | Big models everywhere "to be safe" |

Compare it against two baselines with the same budget: one agent working alone, and the cheap code-only pass. A
large workflow that does not beat both is not optimal, however thorough it looks.

## Two sketches

**Deep audit of a large, messy codebase.**
1. Recon: files, languages, sizes, an import graph, generated and vendored code excluded by rule, with the
   exclusions listed.
2. A cheap exhaustive pass by code: linters, a secret scan, a dependency audit, complexity and churn metrics. It
   flags hot units.
3. Shards are modules under the measured budget, hot units first. Readers return read ids and located findings.
4. A sampled, different-model second reader estimates misses.
5. Reconcile across the import edges: cross-module issues, duplicates, contradictions.
6. Acceptance: the ledger verifier passes and the sampled miss rate is under its threshold.

**A research program over ~300 GB of artifacts.**
1. Treat the data as an environment, never as a prompt. Code profiles it: formats, schemas, partitions, row counts,
   distributions, missingness, duplicates.
2. Questions become queries that code runs. Models read profiles, samples and query results, and propose the next
   query.
3. Every claim records the query, the data version and the rows it rests on. A claim without them is not reported.
4. Partitions are processed by a map over shard groups. Statistics come from code, with intervals.
5. A different model re-derives a sample of claims from the raw queries.
6. Acceptance:
   - each claim has provenance;
   - every partition is profiled;
   - re-derivation agrees on the sample.

## Engine limits to know

- `map.maxItems` is at most 1,000, so nest maps for more.
- `budget.maxConcurrency` is at most 16.
- A sandboxed `code` node has no network and a 10 s default timeout; set `timeoutMs` for heavy steps.
- Values pass between nodes as inline JSON; a `code` node's output is capped at 512 KB. With no data handle yet,
  bulk data and plans beyond about 10,000 units travel as references (path or key plus content hash) read in slices.
- In-node creation of a sub-workflow at run time is not built yet. Plan the decomposition at construction time,
  and use a bounded `loop` to re-split.

Evidence level: the weak points are from public sources and our runs. The protocol is **design**: it has not yet
been measured end to end on a 300 GB job. The exemplar `exemplars/partitioned-audit.json` implements steps 3–8 and
passes `foundry validate` and `foundry lint`.
