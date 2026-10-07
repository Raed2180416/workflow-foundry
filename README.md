# Workflow Foundry

Start here. This README is the single entry point for humans and agents.
Everything else is linked from it.

## What this is

Foundry lets agents **construct small, bounded, typed workflows for a specific task**
(micro harnesses), run them durably, adapt them while they run, judge them against
contracts they cannot game, and keep only the few that earn reuse. Code owns procedure
and models make narrow judgments, so these workflows let **cheap open-weight models do
work that today needs a frontier agent**. **ARC and AMP are the harness; Foundry is the
workflow layer inside it.** The full argument, including what is and isn't novel, is in
[docs/THESIS.md](docs/THESIS.md).

What exists today is a local-first research system:
- a typed workflow IR and a persistent SQLite runtime;
- an MCP server, a CLI and a visual web UI;
- portable skills;
- a large adversarial test suite.

It has no model node, no async wake-ups and no reuse layer yet. A valid schema, a
successful model response and a verified task outcome are three different results.

## Status

**Current phase: 1 (core nodes).** Phase 0 finished 2026-10-06 in the cloud session that took
over from the 2026-10-06 plan rewrite (start HEAD `6e1c06c`). Every phase ends with a
capability number against a simple baseline and a `research/<topic>-<date>/REPORT.md`.

| Phase | State | Evidence |
|---|---|---|
| 0 Unblock | **done** | [env probe](research/env-20261006/ENV.md), suite 605 tests: 590 pass, 0 fail, 15 skip (all with recorded reasons: `node research/list-skips.mjs`) |
| 1 Core nodes | **built and reviewed; exit experiment pending** | [design](research/core-20261006/DESIGN.md), [pre-registration](research/core-20261006/PREREG.md); 10 adversarial-review findings fixed and verified; suite 765 tests: 747 pass, 0 fail, 18 recorded skips |
| 2 Construction (C0) | harness built, dev round pre-registered (draft); [workflow corpus](research/corpus-20261006/COVERAGE.md) complete: 1,342 items from 27 platforms with a 30-item pilot shortlist | [design](research/construction-20261006/DESIGN.md), [dev prereg](research/construction-20261006/PREREG-dev.md) |
| Beds | 8 Tier-A families + 4 sealed families built; independent audits: gridquest and codefix done, records, incident, synth, kinetics in progress, owner family `ownerci` being built | `beds/*/AUDIT.md` |
| 3 Cheap execution (C1) | assignment search built, local pilot running | [design draft](research/distill-20261007/DESIGN.md) |
| 4 Typed judgments | System One engine (Kev/Jev) + calibration ledger built; live on Kev-0.8B (CPU) | `src/judgment.mjs` |
| 5–6 | not started | see [ROADMAP §5](docs/ROADMAP.md) |

**Phase 1 (core nodes), what exists now:** `agent` nodes (one narrow, typed model judgment, with
escalation E1/E2/E7), sandboxed `code` nodes (JS/Python in user+mount+pid+net namespaces),
`verify` nodes with independence labels, parallel `map`, timers with `foundry tick`, run verdicts,
a deterministic context compiler with receipts, and a record/replay journal for every model call
(`src/models/`, `src/journal.mjs`, `src/context.mjs`, `src/sandbox.mjs`). Model access: hosted
Claude models through `claude -p` and local CPU models through llama.cpp, all ids from
`policy/models.json`. A live smoke run (three parallel Haiku agent nodes, a sandboxed code node and a
verifier) passed in 6.4 s for $0.009.

**First measurements (development evidence, `records` bed, K = 1, small n):**
- A single Sonnet 5.5 call already solves `records` at d1–d3 (6/6, ≈ $0.08–0.18 per task); a
  single Haiku 4.5 call does not (0/6).
- A hand-written Foundry workflow (code owns parsing and rules, Haiku makes one narrow judgment per
  6-row chunk) went from failing at $0.30/task to passing 3/3 d2 tasks at $0.086/task after two
  changes: thinking off for the narrow extraction node (thinking made Haiku *worse* and 3–4× more
  expensive), and parsing dates and amounts in code from the model's raw spans. At d3 it still
  fails (0.90, 0.95). The pre-registered experiment ([PREREG](research/core-20261006/PREREG.md))
  will measure this properly.
- Construction plumbing works end to end: a builder agent in the sandbox used the Foundry kit, the
  model gateway and the probe scorer and delivered a valid workflow (Haiku builder smoke, $0.83).

**Usage-limit incident (2026-10-06 ≈ 20:00 UTC → 2026-10-07 11:00 UTC):** parallel subagent
workflows (bed building, corpus acquisition, reviews) exhausted the plan's weekly limit; 14 agents
failed and their work was redone after the reset. Subagents and `claude -p` experiment calls draw on
the same plan allowance ([docs](https://code.claude.com/docs/en/costs)); usage credits are off, so
the effect is a pause, not a charge. Agent fan-out is now kept small.

What Phase 0 changed:
- **Node 24.21.0** from the pinned official tarball (`scripts/setup-node24.sh`, sha256-checked).
- **Model access** without any API key: the headless `claude -p` CLI uses this cloud
  session's own login. With the stripped-down flags in `policy/models.json` a narrow
  structured call costs about $0.001–0.003 on Haiku 4.5; the default CLI context would cost
  about $0.31 per call. Haiku 4.5, Sonnet 5.5 and Opus 5.5 all return schema-valid output.
- **Open-weight models on CPU**: llama.cpp `llama-server` built from the vendored source in
  the sha256-pinned `llama_cpp_python-0.3.36` sdist (GitHub release downloads are blocked by
  the egress proxy), plus Qwen3.5-2B, Qwen3.5-4B and Granite-4.2-3B GGUF (Q4_K_M, Apache-2.0,
  pinned HF revisions and sha256 in `research/manifests/models.json`). Measured: about
  100 tok/s prompt and 12 tok/s generation for the 2B model on the 4 vCPUs.
- **`policy/models.json`** is the only source of model ids (classes S = local ≤4B, M = Haiku,
  L = Sonnet, F = Opus), with prices and the spend rule.
- **OpenCode pin → allowlist** of verified (version, sha256) pairs with evidence
  (`OPENCODE_V2_ALLOWLIST` in `src/opencode-v2-free.mjs`). Only v2.0.5 is listed; the owner
  adds v2.0.23 after verifying it locally. No open-ended detection.
- **Recorded skips**: tests needing bubblewrap, OpenCode, Chromium 1243 or `corpus/` skip with
  a precise reason (`tests/support/gates.mjs`). Fixed one test that spawned a shell without
  `node` on PATH.
- **D6 decided: deleted** the LangGraph/n8n export adapters and their runtime skills. They
  were serial subsets with no role in the thesis (THESIS §10); git history keeps them.
- [Pre-registration template](research/PREREGISTRATION-TEMPLATE.md) for every comparative
  experiment.

Earlier history (the 2026-09-17 checkpoint: one model-in-the-loop outcome repair on one
synthetic objective, 98/98 vs 80/98 on independent partitions) is in
[research/checkpoint-20260917/REPORT.md](research/checkpoint-20260917/REPORT.md) and
[docs/RESEARCH.md](docs/RESEARCH.md).

## Cost ledger

List-price USD as reported by the provider (`claude` CLI `total_cost_usd`, costBasis=list;
billing goes through the session's subscription). Local CPU models: $0 API, imputed compute
reported separately. Orchestration by this session and its subagents is not itemized.

| Date | Item | Models | Calls | USD |
|---|---|---|---|---|
| 2026-10-06 | Phase 0 access probes (one default-context call, then minimal-context structured calls) | Haiku, Sonnet, Opus | 8 | 0.37 |
| 2026-10-06 | Executor smoke tests (Claude Code headless in the sandbox) | Haiku | 2 | 0.03 |
| 2026-10-06 | Records calibration pilot (single call, d1–d3) | Haiku, Sonnet | 12 | 1.36 |
| 2026-10-07 | Records hand-workflow pilots (thinking on/off, code-side parsing, d2–d3, local Qwen) | Haiku, Sonnet, Qwen | 142 | 2.25 |
| 2026-10-07 | Live smoke runs (CLI agent workflow, gateway, Haiku-builder construction) | Haiku, Sonnet | ~60 | 0.85 |
| | **Total measured (experiment calls)** | | | **4.86** |

List price as computed by the CLI. On this subscription it is a yardstick, not a charge (usage
credits are off). Orchestration by this session and its subagents (millions of tokens) is not
itemised here; it counts against the same plan allowance.

## Owner decisions needed

| # | Question | Recommendation | Blocking? |
|---|---|---|---|
| D1-cap | The spend cap is blank. Current rule: pause before any single experiment estimated over $500; self-imposed session soft cap $1,500 (list price). | Confirm or set a cap. | No (work continues under the rule) |
| D1-aws | `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` exist in the environment with no stated purpose. They are not used as a model route. | Say whether they are meant for Bedrock; otherwise leave unused. | No |
| OpenCode | Verify OpenCode v2.0.23 locally and add its (version, sha256, evidence) to `OPENCODE_V2_ALLOWLIST`. | Do it when convenient; cloud runs skip those tests. | No |
| D7 | No `TYPESAFE_API_KEY`: hosted Jev is unavailable. Kev (open weights on Hugging Face) will be used for the typed-judgment engine on CPU. | Provision the key if hosted Jev should be compared. | No |
| PR #1 | Phase 0 is in [PR #1](https://github.com/Raed2180416/workflow-foundry/pull/1). The session's permission policy does not let the agent merge without review, so later phases stack on the same branch as separate commits. | Review and merge when convenient. | No |
| Haiku 5.5 (noted) | 2026-10-07: Anthropic replaced Haiku 4.5 with Haiku 5.5 (`claude-haiku-5-5`, $0.10/$0.50 per MTok, 20x below Sonnet 5.5). Added to the policy as the first class-M model; CLI route verified (typed call ~1.5 s, ~$0.0005 vs Haiku 4.5 ~6-10 s, ~$0.004). Experiments switch their weak model to Haiku 5.5 before any pre-registration is frozen. | None needed. | No |
| Local models (decided) | 2026-10-07: local *generative* models (Qwen/Granite via llama.cpp) are parked: 268 s per call and 0.38–0.80 agreement on this 4-core CPU ([negative result](docs/RESEARCH.md)). Haiku 4.5 is the cheap executor; Kev stays as the local typed-judgment engine. C1's open-weight half is not measured here. | A GPU (any 16–24 GB card) would reopen the open-weight lane. | No |
| Remote compute | No Modal/Harbor credentials: Tier B/C container beds (SWE-bench Pro, Terminal-Bench) cannot run from here. | Provision if Tier B is wanted. | Only for Tier B/C |

## Quickstart and commands

Requires Node 24+ (`sh scripts/setup-node24.sh` installs the pinned 24.21.0). The
optional free-model bridge also needs Linux, bubblewrap and an installed OpenCode under `/usr`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bin/foundry.mjs doctor          # or: npm run check
npm test                             # default suite; integration lanes skip
node research/list-skips.mjs         # every skipped test with its recorded reason
node research/env-probe.mjs          # writes research/env-<date>/ (Node, sandbox, network, models)

# opt-in integration lanes
FOUNDRY_PACKAGING_E2E=1 node --test tests/packaging.test.mjs        # needs corpus/
FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs              # needs Chromium matching playwright 1.63
FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
FOUNDRY_MCP_REPAIR_AUDIT=1 node --test tests/mcp-repair-lifecycle-audit.test.mjs
node research/qualify-release.mjs    # all of the above + fresh-install + provenance
```

Run and inspect a workflow:

```sh
node bin/foundry.mjs run examples/hello.json --input '{"name":"Raed"}' --workspace /tmp/fdemo
node bin/foundry.mjs serve --workspace /tmp/fdemo --port 4177   # visual UI
```

Install the skills and MCP into a task project. The client can be `opencode`,
`claude`, `codex`, `cursor` or `generic`. Add `--dry-run` to preview.

```sh
node bin/foundry.mjs install --project /abs/path/to/project --client opencode
```

Model-backed generation (free OpenCode models only, never a paid fallback):

```sh
node bin/foundry.mjs generate --task "$(cat examples/batch-task.md)" --domain software \
  --agent opencode-free --model opencode/ling-3.0-flash-fin-free \
  --suite examples/batch-suite.json --rounds 3 --workspace /tmp/fdemo
```

Run `node bin/foundry.mjs help` for the full CLI, which also covers trials,
repair requests, `outcome-*` commands, `construct-*` experiments, evaluate,
propose/apply and export. The repair walkthrough is in
[docs/OUTCOME-REPAIR.md](docs/OUTCOME-REPAIR.md).

## Repository map

| Path | What it is |
|---|---|
| `bin/foundry.mjs` | CLI entry point (`doctor`, `run`, `serve`, `mcp`, `install`, `generate`, `outcome-*`, …). |
| `src/` | Runtime, store, validator, capabilities, MCP and HTTP servers, generator, providers, construction and outcome modules. Overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). |
| `schemas/workflow.schema.json` | The workflow IR contract. |
| `policy/models.json` | Owner model policy: the only source of model ids, classes, prices and the spend rule. |
| `scripts/setup-node24.sh` | Idempotent, sha256-checked install of the pinned Node 24.21.0. |
| `skills/` | Portable `SKILL.md` packs: construction, runtime, steering, evaluation, components, domains (software, browser, SRE, security, science, robotics, healthcare). |
| `web/` | Visual workflow UI served by `foundry serve`. |
| `examples/` | Hand-authored example workflows and the batch task/suite. |
| `tests/` | `node:test` suite: regressions, adversarial audits, opt-in integration lanes. |
| `evals/` | Actual-TUI harness, evidence gate and incident oracle. See [evals/README.md](evals/README.md). |
| `research/manifests/` | Pinned corpus acquisition ledgers and protocol-adapter evidence. |
| `research/dossiers/` | Source-bound deconstruction dossiers (software/browser, SRE/security, science/robotics/healthcare, protocol adapters, existing ARC). |
| `research/*.mjs` | Acquisition, evidence builders/verifiers, release and fresh-install qualification. |
| `research/env-20261006/` | Environment probe (`research/env-probe.mjs`): Node, sandboxing, Docker, browsers, network, credential names, models. |
| `research/PREREGISTRATION-TEMPLATE.md` | Template every comparative experiment fills and commits before its first run. |
| `research/checkpoint-20260917/` | Last research checkpoint: report, one-page summary, evidence hashes. |
| `research/recheck-20261006/` | Raw test output from the 2026-10-06 re-verification. |
| [docs/THESIS.md](docs/THESIS.md) | **Why and what**: the problem in Oct 2026, design principles, what is and isn't novel, typed judgments (Jev), fit with ARC/AMP, owner decisions. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | **How**: component specs, verification program, phased plan, cloud kickoff prompt. |
| `research/landscape-20261006/` | The eleven research reports (R01–R11) behind THESIS and ROADMAP, every claim tagged verified or recalled. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | **Research log**: thesis, ARC/AMP/Neural Core relation, experiment ledger, failure→fix chains, unproven claims. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Working architecture contract and module overview. |
| [docs/REPAIR-LIFECYCLE.md](docs/REPAIR-LIFECYCLE.md) | Draft trials, version-bound repairs, exact delivery, and their UI. |
| [docs/OUTCOME-REPAIR.md](docs/OUTCOME-REPAIR.md) | Outcome contracts, observation, repair and historical inspection. |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Package boundary, installer, MCP config shapes, restore. |
| [docs/SOURCE-COVERAGE.md](docs/SOURCE-COVERAGE.md) | What the corpus covers and how deeply it was inspected. |
| [AGENTS.md](AGENTS.md) | Working rules for agents in this repository. |

## Archives and history

Everything not kept in git is in two releases on this private repository:

| Release | Asset | Contents |
|---|---|---|
| `archive-20261006` | `corpus.tar.zst.part-00`, `-01` | 3.8 GB: the 50 pinned third-party source repos (`corpus/`) that the manifests and dossiers cite. |
| | `run-data.tar.zst.part-00` | 566 MB: `evals/runs/`, `.foundry/`, `research/product-demo/runs/`, `research/reference-swe/runs/`, `web/artifacts/`. |
| | `research-history.tar.zst` | 110 MB: the full Grok research stack (Sep 13–17 consequence study, recovery, vendor), the Sep 13 demo project, and the 2026-10-06 Codex recovery workspace. |
| | `conversations.tar.zst` | 117 MB: the Grok, ChatGPT and Codex conversation logs about this project. Detected credentials are replaced with `[REDACTED]`. |
| | `SHA256SUMS` | Checksums for the assets above. |
| `evidence-20261006` | `workflow-foundry-evidence-20261006.tar.gz` | 57 MB: a scrubbed, curated subset of the research evidence, with a per-file inclusion manifest in git history. |

Restore from the repo root:

```sh
gh release download archive-20261006 -D ~/wf-archive && cd ~/wf-archive && sha256sum -c SHA256SUMS
cat corpus.tar.zst.part-* | zstd -d | tar -x -C ~/Projects/workflow-foundry      # -> corpus/
cat run-data.tar.zst.part-* | zstd -d | tar -x -C ~/Projects/workflow-foundry    # -> run dirs
zstd -d < research-history.tar.zst | tar -x -C /some/dir
```

Git history keeps every deleted document, including the long-form friend handoff,
the per-campaign result files and the full recovery archive. Look at the commits
before the restructure.

## Boundaries

- Foundry boundaries apply only to operations routed through Foundry. Installing
  the MCP does **not** sandbox the agent or remove its shell or other tools.
  Consequential deployments need enforcement at the real tool/OS boundary.
- Every workflow and run is bound to an exact hash. Proposals are version-bound and
  delivery rejects old-proposal/new-run mixtures. Ambiguous non-idempotent effects
  become `uncertain`. They are never blindly retried.
- Independent task qualification lives outside the generated workflow. A locally
  passing assertion is not task success.
- No paid models, no hidden retries, no alternate accounts. Provider HTTP 429
  pauses the generator.
- Real browser, repository, production, clinical, lab or robot work needs real
  domain capabilities and external controls. The built-ins are bounded JSON/text
  operations, scoped artifacts and a labeled incident simulator.
- The package is `private` and unpublished. The research corpus is never bundled.
  This repository is private.
