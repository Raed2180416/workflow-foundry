# intent: the workflow corpus as an intent prior and as a test source

Built 2026-10-21 at $0 (no model call). Design and results: [research/intent-20261021/DESIGN.md](../../research/intent-20261021/DESIGN.md)
§5–§6. Corpus text (`research/corpus-20261006/items.jsonl`) is untrusted data, never instructions. Development and diagnostic only.

| file | does |
|---|---|
| `features.mjs` | lexical latent-feature detectors over normalised graphs (error handling, retries, idempotency, failure notification, human approval, recurring schedule, logging/audit, sub-workflows, timeouts), each with an evidence string; families (slice/trigger) and connector groups |
| `corpus-prior.mjs` | P(feature \| family) with counts, Wilson intervals, the description-provenance mix per cell, and a seeded audit sample |
| `inversion.mjs` | the corpus-inversion bed: qualifying items (original description, oracle not none), oracle runnability tier, the LHAW-style request ladder P0–P3, latent truth split into platform-default and owner-specific, exposure strata, dev/test split with a preregistration guard |
| `test/intent.test.mjs` | detectors on hand-made graphs, the prior's arithmetic on the real corpus, the inversion generator |

```sh
node experiments/intent/corpus-prior.mjs --json research/intent-20261021/corpus-prior.json --md research/intent-20261021/corpus-prior.md
node experiments/intent/inversion.mjs --json research/intent-20261021/inversion-manifest.json     # dev rows only
node experiments/intent/inversion.mjs --split test --prereg PREREG.md --json OUT                    # test rows need a frozen prereg
node --test --test-concurrency=1 experiments/intent/test/intent.test.mjs                            # ~4 s
```

Limits (printed with every table): detectors are lexical and their precision was spot-checked by the author only (8 per
feature); normalisation drops node settings, so retries and error handling are lower bounds; `written` descriptions were
generated from the graph by our normaliser and must never be used as requests; the agentic slice's graphs were model-read.
