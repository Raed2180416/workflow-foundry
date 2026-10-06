# Phase 2 design: construction (C0), executors and the B1 baseline

*2026-10-06. Builds on Phase 1 (`research/core-20261006/DESIGN.md`). Claim C0 (ROADMAP §4.1):
given a fresh complex task family, an agent with Foundry builds a working workflow more
often, and at lower total cost, than the same agent alone or writing CC-workflow-style
scripts.*

## 1. The comparison, stated precisely

The **same builder agent** (Claude Code headless, Opus 5.5, `--safe-mode`, same tools) works
under three conditions on each family. Everything except the condition is held constant.

| Arm | What the builder produces | What runs on each test task |
|---|---|---|
| **B0** (agent alone) | nothing (no construction) | the agent itself, per task (Opus, and separately Haiku/Sonnet), with tools |
| **B1** (script) | `solve.mjs`: a CC-workflow-style script that may call models through the gateway | the script, per task, in the executor sandbox |
| **F** (Foundry) | `workflow.json`: a typed Foundry workflow (IR + code/agent/verify nodes + contracts) | the Foundry runtime, per task |

B1 is the strongest fair alternative: an equally capable agent with an equal construction
budget writing ordinary orchestration code ("dynamic workflows" as Claude Code writes them).
F differs only in the substrate (typed IR, static checks, sandboxed code nodes, narrow typed
model nodes with escalation, verify nodes, record/replay) and in Foundry's construction skill.

## 2. Construction protocol (identical for B1 and F)

- **Kit.** A read-only bundle at `/opt/foundry-kit/<hash>/` built by
  `experiments/lib/kit.mjs` from an allowlist (src/, schemas/, policy/, bin/, skills/, the
  operator library, node_modules for ajv). It never contains `beds/`, `experiments/` or
  `research/`. The builder's sandbox hides the repository (Phase 0 executor).
- **Probe tasks.** P = 3 tasks from the family's dev split (seeds disjoint from evaluation),
  materialised as files: prompt, inputs, files, output schema.
- **Score service** (host, `experiments/lib/services.mjs`, localhost): `POST /score
  {probe, output}` → `{pass, score}` only, at most S = 12 calls per construction. This is the
  only oracle access, and it is the same for both arms. Oracle details never leave the host.
- **Model gateway** (host, localhost): `POST /model {model, system, prompt, schema, decoding}`
  → ModelPort call; enforces the policy file, journals and charges the call to the arm. B1
  scripts and the F builder's own smoke runs both pay through it; the F runtime uses the same
  ModelPort in-process. Same models, same prices, same journal.
- **Budget.** Construction: $B_c = $6 list price (builder tokens + any model calls made
  during smoke runs), wall clock 45 min. Execution: per task budget $B_t (family-specific,
  equal across B1 and F; B0 gets the same per-task cap).
- **Builder prompt.** Shared preamble (task family description from the probe prompts, kit
  location, score service, gateway, budgets, deliverable). Then one condition-specific
  paragraph: B1 = "write solve.mjs that reads a task directory and writes answer.json; call
  models only through the gateway"; F = "build workflow.json with the Foundry IR; use
  `foundry validate`/`foundry run` from the kit; the Foundry construction skill is at …".
  Both prompts are frozen by hash in the pre-registration.
- **Node models.** In both arms the builder chooses which policy models its artifact calls
  (cheap ones are allowed and encouraged by the same sentence in both prompts). Model ids
  outside the policy fail at the gateway.

## 3. What is measured (per family, per arm)

- **Construction success**: the artifact exists, runs without harness fault on all P probes.
- **Time and $ to first qualified artifact (TTFH)**: until the first artifact that passes
  ≥ 2 of 3 probes through /score.
- **Verified success** on N_test sealed-split tasks of the family (K = 3 trials each), scored
  by the locked bed oracle on the host.
- **CPS** = (construction $ + all execution $ incl. failures) / verified successes; reported
  amortised over the N_test tasks and as the break-even task count vs B0.
- **pass^3**, harness-fault rate, verdict distribution (F), escalations (F).

## 4. Families and splits

- Dev families (8): records, incident, codefix, synth, kinetics, gridquest, gameqa, runbook.
  Used to develop the Foundry construction skill and operator library → **development
  evidence**.
- Sealed families (4): `beds/sealed/` (separate author, never seen by the experimenter).
  Constructed fresh at evaluation time under the frozen protocol → **claim-bearing evidence**
  for C0's generalisation.
- Seeds: probes from `dev` split seeds 1–3; evaluation tasks from `test` split seeds
  ≥ 5001 (disjoint from every seed the bed authors used).

## 5. Interactive families
For interactive beds the artifact receives an env handle through a host-side `env` capability
(`reset/step/observe/snapshot/restore`); B1 gets the same API through the gateway service
(`POST /env/...`), B0 gets it as a CLI in its sandbox. The final output is the episode record.

## 6. Threats
- **Skill leakage**: the Foundry skill and operators are developed on dev families; a literal
  scan of the kit for dev-family strings runs before sealed evaluation.
- **Builder variance**: construction is stochastic → K_c = 2 constructions per family per
  arm on sealed families (each evaluated on the same test tasks).
- **Unequal effort**: both arms get the same budget caps, the same /score calls, the same
  wall clock; actual spend is reported.
- **Oracle gaming**: oracle runs on the host on the raw output; the builder never sees oracle
  code or details; transcripts are scanned for access to hidden paths.
