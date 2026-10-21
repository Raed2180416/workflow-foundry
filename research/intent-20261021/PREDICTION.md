# INTENT-0 / SPEC-0 prediction (written 2026-10-21, before the specbiz and corpus code)

FIRST-CLASS-PROGRAMS §0.1 asks each $0 stage to commit its PREDICTION.md before its code. The orchestrator should
commit this file in its own commit, ahead of `experiments/specbiz/`, `experiments/intent/` and the rest of
`research/intent-20261021/`.

**Already seen before this file was written (not predictions):**
- the corpus totals: 1,559 items; description provenance original 449, written 1,046, recovered-by-model 64;
  oracle kinds none 1,121, test-profile 277, output-equivalence 108, mocked-execution 53;
- the qualifying pool for corpus inversion (description `original` and oracle kind not `none`): **213 items**, from
  nf-core 72, airflow 44, galaxy 30, snakemake 24, nextflow 17, temporal 7, argo 6, kubeflow 5, wdl 5, cwl 2 and tekton 1.
  No business-automation platform (n8n, Zapier, activepieces, node-red) contributes, because their descriptions are
  `written` by our normaliser from the graph's features;
- the oracle notes: most of those oracles need outside infrastructure (Galaxy server, Nextflow plus containers, an
  Airflow connection with real credentials, a Kubernetes cluster);
- lexical probes of node types show that naive keyword detectors are noisy (`ask` matches `task`, `sla` matches
  `translate`, genomics `dedup` means read deduplication, not idempotency).

## SPEC-0 gates (seeded carrier assignment and rendering of E8's SPEC-E)

- **P-S1 (leak).** At seeds 1–20, no unit-specific 8-word shingle of SPEC-E appears in a carrier other than its
  assigned one: 0 leaks. Inside its own carrier the verbatim share of a unit's shingles is at most 0.10 (the rendering is
  a paraphrase, not a copy).
- **P-S2 (coverage).** At seeds 1–20, all 30 gold ids are recoverable from at least one carrier through the
  author-written mapping. Without asking the owner, 27 of 30 are recoverable (the 3 owner-only ids are not).
- **P-S3 (quotas).** Every seed gives SOP 16, override 3, email 4, records 4 and owner-only 3 of the 30 gold ids, so the
  SOP mentions 19 of 30 (63%), 3 of them at a stale edition.
- **P-S4 (precedent).** Every records-carried rule has precedent rows that fit the true rule and contradict each
  listed alternative reading.

## Corpus prior (lexical detectors over normalised graphs)

- **P-C1.** Error handling is most common in the CI/CD and orchestration families (at least 30% of items) and least common
  in consumer families (under 10%).
- **P-C2.** Explicit retries are visible in under 10% of items overall. This is a lower bound, because normalisation drops
  node settings (n8n `retryOnFail`, Airflow `default_args`).
- **P-C3.** Failure notification (a notifying node reachable from an error path) is under 10% in every family with at
  least 15 items.
- **P-C4.** Recurring schedules are most common in business automation (n8n and activepieces schedule triggers) and in
  data orchestration. Airflow's `@once` is not recurrence and is excluded.
- **P-C5.** Of the 213 qualifying inversion items, at most 15 have an oracle that runs offline without credentials or a
  cluster (Temporal's mocked test suite and Kubeflow's compile-equivalence goldens are the candidates).

**Refutation.** Each P is read as supported or refuted against the numbers the code prints. A refuted P is reported as
written, not edited. Everything here is development and diagnostic evidence: no model is called, and nothing is
sealed or claim-bearing.
