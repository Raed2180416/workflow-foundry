# Where we stopped (status as of 2026-10-06)

Read this first when resuming. It points to everything else.

## The vision

Give agents the tools to **design, test, inspect, revise and reuse small executable
workflows** ("micro workflows" / micro sub-harnesses) for their tasks, instead of
improvising every step. The host runtime owns capabilities, evidence, state, budgets
and approvals. The agent owns process construction. Long-form context:
[FRIEND-HANDOFF-DYNAMIC-WORKFLOWS.md](FRIEND-HANDOFF-DYNAMIC-WORKFLOWS.md).

## Timeline

| When | Where | What |
|---|---|---|
| 2026-09-13 to 09-15 | Grok research stack, then ChatGPT/Codex | Core product: runtime, store, MCP server, skills, web UI, packaging, evals. Pushed to GitHub on 09-15 (`3954dce`). |
| 2026-09-15 to 09-17 | Local only (`~/Projects/grok-research-stack`) | Consequence study: workflow construction modules, outcome repair, outcome history, free/local provider adapters. **Never pushed until 2026-10-06.** |
| 2026-09-17 09:16 UTC | `continuation-checkpoint-20260917` | **Last real research checkpoint.** Finalized and bounded. No campaign left running. |
| 2026-10-06 | Codex recovery thread (ran out of usage), finished in Claude Code | Recovered the unpushed source, reran the tests, archived the evidence, and pushed everything here. |

## State at the last checkpoint (2026-09-17)

**Worked:**
- An end-to-end, model-in-the-loop repair path. A workflow ran "successfully" but
  produced the wrong artifact. The system recorded an unsatisfied outcome, asked the
  same builder model for a goal-preserving repair, and evaluated the fix (5 dev + 8
  withheld cases). It then applied v2 explicitly, re-ran it natively, and the
  outcome was satisfied.
- Independent partition suite: repaired 98/98, faulty 80/98, across 196 real executions.
- Default suite: 645 tests, 641 passed, 0 failed, 4 opt-in skips. The opt-in run
  (MCP stdio, packaging, Chromium UI) had 82 checks pass.
- New product surface: `outcome` CLI commands, a model-generation facade for outcome
  repair, refusal to bypass via the ordinary CLI, and a read-only outcome-history inspector.

**Did not work / not yet shown:**
- The free-provider construction campaign (`opencode/big-pickle`) failed. It
  returned one 150 s HTTP 200 stream with reasoning only and no answer. The
  error-precedence bug it exposed was fixed and tested offline, but there has
  been no successful hosted rerun.
- Jev calibration was not run because the auth was unavailable in that context.
- The repair was on **one synthetic objective**. The fault and expected outcome were
  supplied, and the builder knew its original solution. This is a working mechanism,
  not general intent satisfaction.

## Exact next steps (from the checkpoint)

1. **Grounded outcome-contract identification.** Derive an adequate, revisable success
   condition from an *unseen* objective. Today the host authors it. This is the
   largest open gap.
2. Detect consequential ambiguity and acquire evidence, rather than manufacturing certainty.
3. Cross-world continuation: preserve goal lineage and requalify freshly when the
   capability registry changes. Historical inspection deliberately does not cover this.
4. Controlled construction with an ordinary or local model. Use a fresh
   source/config freeze, and do not silently retry the old failed campaign.
5. Calibrated, bounded Jev judgments once supported authentication is available.

Don't spend another campaign re-proving the fixed manifest contract. Keep all
negative results.

## Re-verification on 2026-10-06 (fresh checkout of the recovered source)

- `npm test`: 645 tests, 624 pass, **14 fail**, 7 skipped.
- Opt-in run (MCP repair audit, packaging, UI browser, UI trials): 55 tests, 54 pass, **1 fail** (packaging).

The failures come from environment drift, not from new code regressions:
- 10 `actual adapter:` provider-termination tests need the OpenCode binary version
  that was pinned in September. The machine now has `opencode v2.0.23`.
- 4 reference-SWE tests (`original DefaultAgent ...`, `reference-01 graph ...`) read
  `research/reference-swe/runs/` and its venv, which are git-ignored and absent from a
  fresh checkout. Those runs are in the evidence release asset (see below).
- The packaging test depends on the ignored `corpus/` directory.

Raw output: [`research/recovery-archive/2026-10-06-rerun/`](../research/recovery-archive/2026-10-06-rerun/).
**First thing to do when resuming:** make these tests skip cleanly or be self-contained
in a fresh checkout. Then re-pin or adapt to the current OpenCode.

## Where everything lives

- **Source:** this repo, branch `research/workflow-foundry-20260913`.
- **Readable research archive (in git):** [`research/recovery-archive/`](../research/recovery-archive/).
  - `grok-research-stack/FOUNDRY-CURRENT.md` is the one-page checkpoint.
  - `grok-research-stack/foundry-consequence-study-20260917/continuation-checkpoint-20260917/REPORT.md` is the canonical report.
  - `.../EVIDENCE.json` has the exact source and result hashes.
  - `workflow-foundry-demo-20260913/` is the Sep 13 demo project.
  - `MANIFEST.json` lists every file considered, whether it was included or excluded, and why.
- **Full evidence archive (GitHub release `evidence-20261006`):** about 57 MB tar.gz with all
  8,829 included files. That covers benchmark runs, frozen Foundry SQLite DBs, eval
  runs, reference-SWE runs, product-demo runs, `.foundry` state, and UI screenshots.
- **Deliberately not published** (this repo is public): credential files, raw provider
  wire/session transcripts, private model reasoning, provider databases, `node_modules`,
  vendored upstream repos (`grok-research-stack/vendor`, 187 MB), and corpora. The
  Grok and ChatGPT conversation logs stay local in `~/.grok-research/sessions` and
  `~/.config/chat-on-steroids/sessions`.
