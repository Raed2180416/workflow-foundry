# Where Workflow Foundry stands (2026-11-05)

**Start here.** This page says exactly where the project is: against the vision, against every idea the owner raised,
and what the next agent should do. [README.md](README.md) explains what Foundry is and maps the repository;
[AGENTS.md](AGENTS.md) and [docs/ROADMAP.md](docs/ROADMAP.md) §6 hold the working rules. Everything below is
development evidence unless it says sealed or held-out.

## 1. One paragraph

Foundry lets an agent build a bounded, typed workflow for a task, run it durably, check it against contracts it cannot
game, repair it, and keep only what earns reuse. Code owns the procedure, and models make narrow judgments. That is how
cheap models (Haiku 5.5) do work that otherwise needs a frontier agent. People and their agents use it in natural
language through MCP; the person approves anything that acts on the outside world.

## 2. Placement against the maximal vision: about 35–40 %

| Pillar | Where | Proven | Missing |
|---|---|---|---|
| Engine: durable, typed, safe, big data | ~80 % | 11/11 durability and control attacks blocked (LangGraph handles 1 of 8 natively); data handles with proof every item was read; the engine suite is green | Code steps need Linux namespaces (WSL2 on Windows); no built-in scheduler |
| Building any workflow from plain language, cheaply | ~40 % | Free-form builders in research harnesses: held-out AutomationBench 29/60 against 9/60 for plain Haiku (Opus 5.5 xhigh alone: 26/60, descriptive); n8n rebuilds 83–90 % (CI-1, dev); the order saga 14/14 with a practice world against Opus one-shot 5/14 | The product path was card-bound (7 cards). A free-form front door is being integrated (§5). The agent-through-MCP path has no score of its own yet (SKILLPACK-1) |
| As good as hand-curated or frontier-built | ~30 % | Sealed SOP-Bench (recurring work): 87.6 % against 67.1 % for an agent, about a third of the cost per run | No head-to-head against a real hand-curated org workflow |
| Knowing a build is right | ~35 % | Independent verify nodes, locked contracts, three-way verdicts | 12 of 31 AutomationBench failures were silent; the requirement tracker adds +4..+12 catches; free-form builds need generated checks |
| Healing, adapting, growing | ~30 % | Classify → patch → replay 75 % against 0 % for retry (dev); parent-directed sub-workflows 27–32/32 against 11/32 | The reuse gate is worse than rebuilding (85 % vs 98 %); DUR-1 stopped at its own safety gate; promotion experiment not run; the swarm lead never delegated |
| Knowing when a workflow is needed | ~40 % | Asking Haiku: 5 false triggers in 132; a sensitivity slider | The rule-based formula failed on held-out tasks |
| Real integrations (MCP, skills, connectors) | ~20 % | Per-node MCP servers, skills, connections and a broker (dev) | Product flows use local stand-ins; no real connector proven end to end |
| Org-wide workflows with sections for control | ~15 % | Principals, segregation of duties, approval thresholds in the engine | Org layer designed only; single-person dashboard |
| Product for people and their agents | ~40 % | Site, dashboard, live node-graph data, approval dialogs, 11 MCP tools before the front-door change, CLI | No real users; free-form front door in integration |
| Proof against competitors | ~30 % | AutomationBench, SOP-Bench, n8n rebuilds, LangGraph durability | Many beds written by one author; OpenAI Agents SDK, CrewAI and Temporal comparisons not run; nothing published |

## 3. Run it ($0)

| What | Command |
|---|---|
| Engine tests | `npm test` |
| Product tests | `for f in app/test/*.test.mjs app/onboarding/test/*.test.mjs; do node --test "$f"; done` |
| Engine MCP server, free-form (an agent builds any workflow with the skill pack) | `node bin/foundry.mjs mcp` |
| Product MCP server (proposals, practice, the person's approval, runs, waiting questions) | `node app/cli.mjs mcp` |
| Onboarding site and dashboard (127.0.0.1 only) | `node app/cli.mjs open` |
| What waits for the person; answer in a real terminal | `node app/cli.mjs tasks`, `node app/cli.mjs answer TASK_ID` |
| Skill pack for building workflows | `skills/foundry-construct/` (core `SKILL.md`; references load on demand) |
| Read-only run viewer prototype | `tools/run-view/` |

## 4. Every idea the owner raised, with its status

All 138 items, one per line in the order raised, with evidence:
[research/status-20261104/IDEAS-LITERAL.md](research/status-20261104/IDEAS-LITERAL.md).

| Status | Items |
|---|---|
| ✅ done or measured positive | 57 |
| ◐ partial | 58 |
| ❌ measured negative | 2 |
| 🔧 built, not measured | 2 |
| 📐 designed only | 5 |
| ⬜ not started | 4 |
| 💬 question answered (incl. mixed) | 8 |
| ➖ dropped | 2 |

The per-test reasons for every score are in [WHY-NOT-HIGHER.md](research/status-20261104/WHY-NOT-HIGHER.md), and the
idea-by-idea evidence in [IDEAS-AND-STATUS.md](research/status-20261104/IDEAS-AND-STATUS.md).

**Ten mechanisms that close the gaps and generalise across domains** (each must be tested on two or more beds and never
tuned on held-out tasks):
1. **Read the world's rules before building.** Data may restrict (veto, select among, supersede within scope), never
   authorise. This targets the 17 of 60 look-2 tasks that every system failed.
2. **Build from the end state backwards.** Write the must-hold and must-not-hold postconditions first, then the steps.
3. **Make checks independent.** Probe the world after acting, use readers from a different model family, generate
   executable checks, and score every check against broken variants.
4. **Allow one bounded repair round behind a regression gate.**
5. **Build from retrieved corpus patterns, not a template store.**
6. **Let code decide structure (fan-out, sub-workflows) from measured signals, not model whim.**
7. **Give compiled workflows guards that fall back to a model on inputs outside their profile.**
8. **Mine "what usually also holds" from the corpus, confirmed by the person.**
9. **Keep a library of proven workflows behind the reuse gate.**
10. **Use separate-author sealed evaluation.**

## 5. In integration right now

One implementation agent (no workflows) is integrating two pieces on its own branch. They merge into this branch when its
tests are green; this section is updated when they land.
- **The free-form front door.** The product MCP accepts an agent-built typed workflow (built with the skill pack) and
  Foundry's own one-shot + practice builder for words-only requests. The 7 cards become examples inside the skill pack,
  never a user-facing catalogue. Practice data and stand-ins are generated for any workflow, honest refusals when a
  capability is missing, and the same gates throughout. It adds a $0 demo: `npm run demo`.
- **The requirement tracker (A7)** in the product: the person's conditions from their own words, checked on practice
  data and live runs. It lands as one squashed snapshot of `3310e803`, because its early history held the account
  e-mail.

## 6. Today's design answer: recursive approval and loops

The owner's idea: every sub-node may ask for a sub-workflow; before creating anything at any depth, it asks the
workflow's main agent, which approves only what serves the goal, without interrupting the person.

It fits the evidence: nodes rarely ask on their own (6/32), while parent-directed sub-workflows pass 27–32/32. The design
is "code asks, the node proposes, the main agent approves alignment, code enforces budget and authority". Authority only
narrows, so the person is asked only when a proposal would widen it. Loops between nodes, sub-agents and runs exist only
as declared, typed, budgeted, journaled channels.

The full design note: [research/status-20261105/RECURSIVE-APPROVAL-AND-LOOPS.md](research/status-20261105/RECURSIVE-APPROVAL-AND-LOOPS.md).

## 7. The next agent's queue, in order

1. **Front door.** If §5 has not landed, merge the implementation agent's branch after re-running its tests. Then run
   `npm run demo` and read app/FRONT-DOOR.md.
2. **SKILLPACK-1** (owner-approved $20). Fill σ_b at $0 from existing builder runs, freeze
   [the draft prereg](research/skillpack-20261104/PREREG-SKILLPACK-1-DRAFT.md), and run it on E8 and SOP-Bench dev.
   Add an arm that builds through the new front door.
3. **Recursive approval hook (#135).** Build the `propose_sub` engine hook at $0, then run SW-1 arm A3 against A0 and
   A1F, with seeded misaligned proposals to measure the veto rate.
4. **Restrict-only policy layer.** First a $0 rule-extraction replay on the recorded look-2 worlds, then a
   preregistered look-3 arm.
5. **DUR-1.** Apply RESULT-DUR-1's corrected amendment and re-run within the D24 cap ($80). Then run promotion
   experiment #105, gate versus Harness²-style promotion, starting with its $6 pilot on FH-1's recorded heal runs.
6. **Real connectors** for the main systems through node capabilities, with per-action approval.
7. **Separate-author sealed sets,** plus one real hand-curated org workflow to beat.
8. **Laptop path for code steps** without Linux namespaces (WSL2 guidance or a WASM sandbox).
9. **Publishing** any score needs the owner's explicit "publish".

## 8. Branches, bundles and things never to push

- **Everything is merged into `claude/intelligent-hamilton-vg1f9a`** (PR Raed2180416/workflow-foundry#1), except:
  - `a1c-v1-pin-look2`: the frozen look-2 checkout, kept as a pin;
  - the tracker's original history, which must never be pushed (its squashed snapshot is what lands);
  - the implementation agent's branch until it merges (§5).
- **Older work** is preserved as scanned git bundles in `research/session-20261028-rescue/`; restore with
  `git fetch <bundle> <ref>`.
- **Security rules that persist:**
  - never read or print credential files;
  - never commit the account e-mail;
  - run the pre-commit scan, which blocks key and address patterns;
  - never read `beds/sealed/`, AutomationBench devCheck/test contents, VERIFIER-LAB.md or ATTACK*.md into any model
    context;
  - model ids come only from `policy/models.json`;
  - a change to a guarded src file must be recorded in `experiments/autobench/test/manifest-allowances.mjs` and
    `research/automationbench-20261014/MANIFEST-ALLOWANCES.md`.
