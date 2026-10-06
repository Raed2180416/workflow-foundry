# Workflow Foundry

Start here. This README is the single entry point for humans and agents.
Everything else is linked from it.

## What this is

The goal is to give agents tools to build **micro workflows**: small, task-specific
sub-harnesses they can design, test, inspect, revise and reuse, instead of
improvising every step. The split of responsibility is strict:

- **The host owns** capabilities, evidence checks, state, budgets and approvals.
- **The agent owns** construction of the process: a typed workflow program, not prose.

What exists is a local-first research system. It has a typed workflow IR, a
persistent SQLite runtime, an MCP server, a CLI, a visual web UI, portable skills,
LangGraph/n8n exports and a large adversarial test suite. It is **not** a claim that
a modest model can reliably build specialist harnesses across domains; that is still
the open research question. A valid schema, a successful model response and a
verified task outcome are three different results.

## Status: where we stopped

**Last research checkpoint: 2026-09-17** ([report](research/checkpoint-20260917/REPORT.md),
[one-page summary](research/checkpoint-20260917/FOUNDRY-CURRENT.md),
[hashes](research/checkpoint-20260917/EVIDENCE.json)).

What worked:
- **End-to-end model-in-the-loop outcome repair.** A run "succeeded" but wrote the
  wrong artifact. The system recorded an unsatisfied outcome and the same builder
  model produced a goal-preserving repair, which passed 5 dev and 8 withheld cases.
  v2 was then applied explicitly, re-run natively, and the outcome was satisfied. On
  independent partitions the repaired version scored 98/98 and the faulty one 80/98.
- The suite at that point was 645 tests: 641 pass and 4 opt-in skips. The opt-in
  run had 82 checks pass.
- New surface: the `outcome-*` CLI commands, a model facade for outcome repair, and
  a read-only outcome-history inspector.

What failed or did not run:
- The free-provider construction campaign (`opencode/big-pickle`) returned one 150 s
  stream of reasoning with no answer. The error-precedence bug it exposed was fixed
  offline. There has been no successful hosted rerun.
- Jev calibration was not run because no authentication was available.
- The repair covered **one synthetic objective**. The fault and expected outcome
  were supplied. This is a working mechanism, not general intent satisfaction.

**Re-verification on 2026-10-06** ([raw output](research/recheck-20261006/)), on a
fresh checkout of the recovered source:
- Before cleanup: 645 tests, 624 pass, 14 fail, 7 skip.
- After this cleanup: 609 tests, 595 pass, 10 fail, 4 skip. The 36 removed tests
  belonged to deleted campaign and reference-SWE tooling.
- The remaining failures are the 10 `actual adapter:` tests in
  `tests/provider-termination.test.mjs`. `src/opencode-v2-free.mjs` refuses any
  binary other than the verified OpenCode v2.0.5, and this machine has v2.0.23.
  This is environment drift, not a code regression.
- The 4 reference-SWE failures disappeared because those tests read run data that
  git ignores, and they were removed together with `research/reference-swe/`.
- The opt-in packaging E2E needs the ignored `corpus/` directory.

**First thing to do when resuming:** make `provider-termination` pass against the
installed OpenCode, either by re-verifying the adapter against v2.0.23 or by
pinning v2.0.5 again. Do this without weakening the tests. Then get a clean
`npm test`.

## Next steps

1. **Grounded outcome-contract identification.** Derive an adequate, revisable
   success condition from an *unseen* objective. Today the host authors it. This
   is the largest gap.
2. **Detect consequential ambiguity** and acquire evidence instead of
   manufacturing certainty.
3. **Cross-world continuation.** Preserve goal lineage and requalify freshly when
   the capability registry changes. Historical inspection deliberately does not
   do this.
4. **Controlled construction with an ordinary or local model.** Use a fresh
   source/config freeze, and never silently retry the old failed campaign.
   `src/ollama-local.mjs` is a library-only local provider for this. It is not
   wired into the CLI yet.
5. **Calibrated, bounded Jev judgments** once supported authentication is available.

Don't spend another campaign re-proving the fixed manifest contract. Keep all
negative results.

## Quickstart and commands

Requires Node 24+. The optional free-model bridge also needs Linux, bubblewrap and
an installed OpenCode under `/usr`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bin/foundry.mjs doctor          # or: npm run check
npm test                             # default suite; integration lanes skip

# opt-in integration lanes
FOUNDRY_PACKAGING_E2E=1 node --test tests/packaging.test.mjs        # needs corpus/
FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs              # needs /usr/bin/chromium
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
| `skills/` | Portable `SKILL.md` packs: construction, runtime, steering, evaluation, components, domains (software, browser, SRE, security, science, robotics, healthcare). |
| `adapters/` | LangGraph and n8n exports, each with its own README and VALIDATION notes. |
| `web/` | Visual workflow UI served by `foundry serve`. |
| `examples/` | Hand-authored example workflows and the batch task/suite. |
| `tests/` | `node:test` suite: regressions, adversarial audits, opt-in integration lanes. |
| `evals/` | Actual-TUI harness, evidence gate and incident oracle. See [evals/README.md](evals/README.md). |
| `research/manifests/` | Pinned corpus acquisition ledgers and protocol-adapter evidence. |
| `research/dossiers/` | Source-bound deconstruction dossiers (software/browser, SRE/security, science/robotics/healthcare, protocol adapters, existing ARC). |
| `research/*.mjs` | Acquisition, evidence builders/verifiers, release and fresh-install qualification. |
| `research/checkpoint-20260917/` | Last research checkpoint: report, one-page summary, evidence hashes. |
| `research/recheck-20261006/` | Raw test output from the 2026-10-06 re-verification. |
| [docs/RESEARCH.md](docs/RESEARCH.md) | **Research log**: thesis, ARC/AMP/Neural Core relation, experiment ledger, failure→fix chains, unproven claims. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Working architecture contract and module overview. |
| [docs/REPAIR-LIFECYCLE.md](docs/REPAIR-LIFECYCLE.md) | Draft trials, version-bound repairs, exact delivery, and their UI. |
| [docs/OUTCOME-REPAIR.md](docs/OUTCOME-REPAIR.md) | Outcome contracts, observation, repair and historical inspection. |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Package boundary, installer, MCP config shapes, restore. |
| [docs/SOURCE-COVERAGE.md](docs/SOURCE-COVERAGE.md) | What the corpus covers and how deeply it was inspected. |
| [AGENTS.md](AGENTS.md) | Working rules for agents in this repository. |

## Archives and history

- **GitHub release `evidence-20261006`**: a scrubbed evidence tarball of about
  57 MB. It contains benchmark runs, frozen Foundry SQLite databases, eval,
  reference-SWE and product-demo runs, `.foundry` state, and UI screenshots.
  The tests and docs that relied on those runs were removed from git. The data
  lives only in the release.
- **Not in git, kept locally or pending upload:** the third-party source corpus
  (`corpus/`, about 3.8 GB), full raw run data, the raw research stack
  (`~/Projects/grok-research-stack`), and the AI conversation logs from the Grok
  and ChatGPT/Codex sessions. Credentials, raw provider transcripts and private
  model reasoning are never published.
- Git history keeps every deleted document, including the long-form friend
  handoff, per-campaign result files and the full recovery archive. Look at
  commits before this cleanup.

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
