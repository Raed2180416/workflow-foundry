# Azure Grok 4.6 Research Stack

A deliberately small, high-reliability Grok Build profile for complex backend and research work.

## Launch

```bash
grok-azure
```

The first interactive launch asks once for the Azure Foundry key using hidden input and stores it in the desktop keyring. The key is never written to this repository or Grok TOML. Model-run shell commands inherit Grok's default secret filtering, so `*KEY*`, `*SECRET*`, and `*TOKEN*` variables are withheld.

The launcher uses an isolated `GROK_HOME` at `~/.grok-research`. Normal `~/.grok` configuration is left alone. Every launch re-syncs the canonical files from this repository.

Run local checks:

```bash
grok-research-doctor
```

After the key has been entered once, a tiny live provider check is available with:

```bash
grok-research-doctor --live
```

## Azure contract

- Endpoint: `https://researchcontrare-0719-resource.openai.azure.com/openai/v1`
- Protocol: OpenAI Chat Completions
- Configured deployment name: `grok-4.6`
- Context: 200,000 tokens
- Max completion: 64,000 tokens
- Auto-compaction: 68% (~136k), preserving ~64k output/headroom
- Default reasoning effort: `xhigh`

If the Foundry deployment was given a custom name, change `model = "grok-4.6"` in both `config/config.toml` and `config/stock-config.toml` to the deployment name.

## Agent topology

`research-primary` is the default orchestrator. It can delegate to:

- `architect` — execute/read only; maps architecture, invariants, callers, and blast radius.
- `adversarial-architect` — execute/read only; tries to falsify the plan.
- `implementer` — isolated worktree implementation; high reasoning by default.
- `perimeter-reviewer` — execute/read only; independent final-state review.
- `researcher` — execute/read only; inherits only Context7 + Exa.

The parent uses xhigh. The implementer uses high unless the parent explicitly needs xhigh. Independent review contexts reduce self-confirming trajectories.

## Completion gate

For code/config changes, completion is mechanically tied to the current repository state.

```bash
grok-verify 'your focused test command' 'your type/build command'
```

`grok-verify`:

1. fingerprints the current diff/untracked source state,
2. runs `git diff --check`,
3. runs lightweight syntax checks where safe,
4. requires at least one repository-specific command when code changed,
5. runs each supplied check,
6. writes a receipt under the worktree's git metadata only if all checks pass,
7. refuses to certify if verification itself changed the worktree.

The Stop hook compares the final fingerprint to both session-start state and the receipt. It ignores a dirty working tree that predates the session, but blocks completion when Grok changes source/config and the current state is unverified. Any post-verification edit makes the receipt stale automatically.

## Research tools

Only four remote MCP tools are present:

- Context7: current library/framework documentation (2 tools)
- Exa: current web search and fetch (2 tools)

Claude/Cursor skills, rules, agents, MCPs, hooks, and sessions are explicitly disabled for this profile. Existing external configs remain untouched.

Six locally installed LSPs are configured and start on demand: TypeScript/JavaScript, Pyright, rust-analyzer, gopls, clangd, and jdtls.

## ECC decision

ECC is vendored under `vendor/ECC` for inspection, but the full skill pack is intentionally not loaded. At the current checkout it contains 292 skills / roughly 2.65 MB of skill text. The active research profile has five small skills (~6.3 KB total):

- `frontier-backend-cycle`
- `verification-before-completion`
- `contract-perimeter`
- `systematic-debugging`
- `research-evidence`

These adapt the ECC ideas that directly target Grok's observed weak spots: self-review correlation, contract/perimeter drift, retry loops, context bloat, and unsupported completion claims. Broad framework-specific checklists, rigid global coverage targets, checkpoint-commit rituals, and hundreds of unrelated skills are excluded.

## Stock control and A/B testing

`grok-azure-stock` uses the same Azure endpoint, deployment, 200k context, xhigh effort, and compaction headroom, but no custom agents, skills, hooks, LSPs, or research MCPs.

Run the same prompt from the same commit in isolated worktrees:

```bash
grok-ab /path/to/repo prompt.md 'your deterministic judge command'
```

Artifacts are retained under `~/.local/state/grok-ab/<repo>/<timestamp>/` with model output, stderr, diffs, status, timings, and optional judge results. Do not select changes based on agent prose; select on hidden/deterministic acceptance criteria whenever possible.

## Source/upgrades

- Grok Build source snapshot: `vendor/grok-build`
- ECC source snapshot: `vendor/ECC`
- Canonical profile: `config/`
- Harness scripts: `bin/`

Reinstall the research home after manual profile edits with:

```bash
bin/install-research-home
```
