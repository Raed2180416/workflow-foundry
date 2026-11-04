# PREREG-SW-1b: when the library misses (template-miss probe; exploratory addendum to SW-1)

Frozen 2026-10-28 before any paid call of `runs/sw1b-1`. Written while eval-1 (PREREG-SW-1) was still running: the
SW-1b design (bed, arms, endpoints, predictions) was fixed at about 18:00Z, before any eval-1 aggregate was computed;
partial eval-1 tables (about 30 of 120 units) were looked at from 18:10Z while the tooling was tested, and nothing below
was changed after that except the arm order inside a world (budget priority, below). Author: the orchestrator's Opus 5.5
worktree agent. Evidence label: **exploratory development evidence** (K=1, at most 8 worlds, one bed, one author for the
bed, the templates and the prompts). It sizes an effect and checks a mechanism; it is not a held-out claim.

## Why

SW-1 measures the two routes of owner message [75] on a bed whose sub-problem every library template was written for
(fit by construction, a declared threat). The SW-1 governing builder is template-only: it selects and fills. When a
node's sub-problem is outside the library, a template-only governing builder can only say "none" (or pick a template
that cannot pass) and fall back; a node that builds for itself can still write a procedure; and a governing builder
that may also write free-form from the typed request (the **open** builder) is the design that keeps the governing
route's isolation (fresh context, the node's request only) without the library's coverage limit.

## Bed

`beds/golive/layouts.mjs`, layout `blocks`: the same worlds, truth and oracles as golive@1.0.0; the two backlog exports
are printed as a legacy report (one `@@ RECORD n` block per exported row, one `<field name>: <value>` line per field in
the channel's own order and names, an `@@ END records=... <per-currency sums>` trailer). Nothing else changes (date and
amount styles, letter-O typos, blank currency, re-sent rows, impossible dates, traps, injections, the write-back
request; simple channels and the spec are byte-identical). `layouts.test.mjs` ($0): lossless (a reference reader
recovers every field of every row), the node controls still fail on every backlog node at d2-d5, no SW-1 template
reads it (legacy-export-intake with the true slots fails its practice run for every delimiter and trailer setting;
json-list-intake fails to parse), and the generator reproduces the frozen eval-1 inputs byte for byte.

## Tasks

`tasks-sw1b.json` (sha256 `b88cbf5c...21f`, 8 tasks): golive, split `test`, d4, seeds 201-208, layout `blocks`, run in
seed order, every arm of a world before the next world. They are eval-1's d4 worlds, so each arm has a paired layout
contrast on identical orders and truth (eval-1 rows for A0, A1F, A2F).

## Arms (Haiku 5.5, envelope and decoding exactly as SW-1)

Order inside a world (budget priority: if the cap stops a world, the arm left out is the one whose outcome the others
bound): **A0** node alone (baseline) · **A1F** parent directs a sub-workflow on legacy-export nodes; the node writes it
free-form in its own context · **A2OF** parent directs; the open governing builder: the library stage exactly as A2F;
if it ends without a passing sub-workflow (the builder picks "none", or the template never passes its checks in its 4
rounds), a fresh Haiku writes the sub-workflow free-form from the same request view (the typed request, the answer
contract, the inputs the request names; never the node's own context; `prompts-open.mjs`), with up to 4 rounds under the
same envelope check, practice run, by-hash binding, real run and contract gate; then the logged direct-answer fallback ·
**A2F** SW-1's template-only governing builder, unchanged.

## Endpoints

Backlog-node oracle pass on `blocks` (2 backlog nodes per world); the backlog path (sub-workflow / fallback / direct);
which template the builder picked; open stage used and passed; rounds; $ per task and per passing backlog node; safety as
SW-1 (0 authority violations in the runner audit and in `analyze-sw1b.mjs`'s independent re-check, 0 effects run,
depth <= 2, no child over its reservation, no node over $0.15); the paired layout contrast per arm (blocks vs eval-1's
delimited, same worlds).

## Predictions (on record)

1. A2F on blocks falls back on most backlog nodes, and its backlog pass is within 1 node of A0's on the same worlds.
2. A1F on blocks passes at least 2 more backlog nodes than A2F at 4 complete worlds (8 nodes), scaled to the worlds run.
3. A2OF on blocks passes at least as many backlog nodes as A1F minus 1.
4. Safety holds in every arm (a gate, not a prediction).

No hypothesis test: at this size only counts and paired discordances are reported, labelled exploratory.

## Budget and protocol

Owner cap: Haiku $5 for SW-1 and SW-1b together. Runner cap $4.85 over every journal under `runs/`, concurrency 2 (at
most two units in flight past the check; a d4 unit costs about $0.02-0.05), so the total stays under $5. A world counts
for an arm comparison only when both arms completed it. Env-fault units are re-run with the same command (completed
calls replay from the journal at $0). The code below runs after eval-1 finished; eval-1's code is commit 7b1d45d8.

```
node experiments/subworkflow/run.mjs --run-dir research/subworkflow-20261021/runs/sw1b-1 \
  --tasks research/subworkflow-20261021/tasks-sw1b.json --arms A0,A1F,A2OF,A2F --concurrency 2 --model-concurrency 5 \
  --cap-usd 4.85 --runs-root research/subworkflow-20261021/runs
node experiments/subworkflow/analyze-sw1b.mjs --difficulty 4 --seeds <complete worlds> --json research/subworkflow-20261021/runs/sw1b-1/analysis.json \
  --results research/subworkflow-20261021/runs/sw1b-1/results.jsonl,research/subworkflow-20261021/runs/eval-1/results.jsonl
```

## Frozen code (sha256)

| file | sha256 |
|---|---|
| experiments/subworkflow/node.mjs (the SW-1b version: eval-1's plus route `governing-open`) | 519549a07ba85aeea1652c2d45b55361d048d1752142a768ba98216f6eec722a |
| experiments/subworkflow/run.mjs (the SW-1b version: eval-1's plus `--layout`) | 0f9948f1a133d1f44b49ec3bce97f406904a7711478d513f8b5df6c0fd6daad5 |
| experiments/subworkflow/prompts-open.mjs | 8837653aaf3e0a9286561855e06b9bf7644e2564c648327087777bbd5a46cc1f |
| experiments/subworkflow/prompts.mjs (unchanged from eval-1) | 9077aec9c5aeaa97ab234c4b12b8fd3cf374d18204f02558eb327db660657862 |
| experiments/subworkflow/templates.mjs (unchanged) | 21006d08516f9001688fd24be0e680e2475448fd09b8b4eaaa76da80780b9c02 |
| experiments/subworkflow/dsl.mjs (unchanged) | 239646e605861ed75c8f0cca73d146e3d79f9ff557e0ea296f5800b9389af0e4 |
| experiments/subworkflow/bind.mjs (unchanged) | bcaab9e3e2e5bbf4eec6015a84d1605e887ebf6bf296184ab9ef4a673526213c |
| experiments/subworkflow/analyze-sw1b.mjs | f8953ebe6e2c3520f3da10a8856ae728488c671a570292b24e87b43605946052 |
| experiments/subworkflow/manifest-sw1b.mjs | a7fa7247a4b353a32e1615a20bcee734808c0c97bf8f8e80de58dbc6bd743f70 |
| beds/golive/layouts.mjs | 6e0e888b7e3b1506a6e80d83042cbeadd9cf264cc10c602761efcc06c57d68fa |
| beds/golive/index.mjs (unchanged) | 0442be3460c50a9f0726122ec5b7093de9fe6dfec6bf6797677846897642093b |
| beds/golive/world.mjs (unchanged) | 4348938f1435a063a5bcd255d52b432a1f6e3360153d29fb2da0af848650a813 |
| experiments/jit/call-host.mjs (unchanged) | fd499c77aa2c662a4e3c029a223a29809a78fa5e7a0914c3febc86ad1063c988 |
| src/sandbox.mjs (unchanged) | 871aa71a43e60f553ac0322b1d1e2b09fc1771071e04cca58eb004001dc63f26 |
| experiments/lib/models.mjs (unchanged) | d868e7d95c442b35fca25fac5e6e81b548f7f02f85e714d3303a94317d23b4d9 |
| policy/models.json (unchanged) | cffef22b216b382705b1086b004330a6d2b24366aed8cf506668b9e1a812ea69 |
| research/subworkflow-20261021/tasks-sw1b.json | b88cbf5cdc323b63adbfa26c65f00ebbd98ba722980eb16d696ef576ff71421f |
