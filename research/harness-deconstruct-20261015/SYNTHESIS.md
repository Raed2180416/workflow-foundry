# OpenScience and K-Dense versus Foundry: what they do, what we can already do, what to take (2026-10-15)

Sources: [OPENSCIENCE.md](OPENSCIENCE.md), [KDENSE-BYOK.md](KDENSE-BYOK.md) and [KDENSE-SKILLS.md](KDENSE-SKILLS.md). Three subagents wrote these dossiers from shallow, inert clones ([ACQUISITION.md](ACQUISITION.md)). Every claim in them carries a file:line span and an evidence tag. Development reading only. Nothing in the corpus was run.

## The short answer

Both are general chat agents with a large skill shelf and a polished workspace.
- **OpenScience:** an OpenCode-style loop, about 154K lines of TypeScript.
- **K-Dense (Kady):** a Pi agent inside a Fastify host.

Neither builds a typed, checkable workflow:
- **OpenScience:** plan mode is a chat reply.
- **K-Dense:** the "326 guided workflows" are prose templates with `{placeholders}`. No outcome is ever recorded for one.

Their verification is mostly prose, with the same model checking itself:
- **OpenScience:** the report reviewer returns COMPLETE when it fails.
- **K-Dense:** "Verdict: accept/repair/reject" is parsed by nothing.

**So most of what they do, our product can already do, in its stricter form.** We have:
- typed contracts, plus acceptance that a wrong answer can fail;
- verifiers labelled by independence;
- journaled replay;
- taint labels on untrusted data;
- compare-and-swap state;
- preregistration with sealed families;
- cost per verified success.

**What they have and we lack:**
- breadth: hundreds of scientific skills and connectors, file formats, remote compute;
- a real user workspace;
- external benchmark runs (OpenScience reports Terminal-Bench Science and BiomniBench, though its numbers are weaker than shown);
- an in-node study loop.

## What to take (ranked by value; each needs its own test before use)

1. **Observational provenance (K-Dense).** Every file edge is graded observed, inferred or declared. The agent has no tool to write provenance, and size-limit gaps are shown rather than hidden. This fits our record and replay directly: apply it to code and executor nodes.
2. **Approvals bound to an exact digest, an expiry and a cost quote (K-Dense batches; OpenScience remote compute).** A paid job is never rerun, and credentials never reach the agent's environment. This matters for owner-in-control (F2) and for side-effecting nodes.
3. **Worst-case cost reservation per model call (K-Dense).** This closes our known gap where a timeout is booked at $0. M1 and M1-R both booked timeouts at $0, so this is evidence of need.
4. **Existence-level file-format checks as a free `verify` component, and an allowlist for verifier commands taken from task text (OpenScience).**
5. **The study (autoresearch) loop as a typed library card (OpenScience).** It enforces one run per idea, rejects repeated configurations, and applies kill rules and budgets. We add the two things it lacks: hashing the evaluation script and gating on the measured delta.
6. **A status-versus-verdict handoff for executors, and a default gap list in exported evidence (K-Dense).**
7. **Corpora:**
   - the 326 K-Dense templates and their science tasks, as a task source, once oracles are written for them;
   - the 64 K-Dense skills that have a CLI with JSON output and tests, as typed-step candidates. `genomic-coordinates` is the cleanest pilot, but running it executes corpus code, so it needs a sandbox first.

## What to avoid (their failure modes, which are also risks for us)

- **Checks written in prose that look like gates but gate nothing.** Our rule stays: a check exists only if code can fail it.
- **The same model checking its own work.** Pass-on-failure is the worst version.
- **One workspace shared by all agents.** This is our hole M1, now fixed per instance.
- **Model-written memory loaded into later runs.**
- **Silent model fallback.** OpenScience falls back with only a log warning; ours is refused and logged.
- **An unpinned skill supply.** K-Dense syncs `main` daily: 106 skills `pip install`, 278 of 613 test packages are unpinned, and a scanner that fails open has 18 HIGH/CRITICAL skills on main.
- **Directives inside skills.** 136 of 177 K-Dense skills tell the agent to insert K-Dense's paper into the user's deliverables. Our regex screen misses it, and K-Dense's own scanner flags 15. This becomes a real-world test set for J-Q2 (F2).
- **Tuning on the benchmarks they report**, and docs that describe features the build no longer has.

## Where this feeds

The eight first-class programs (research/architecture-20261015/OWNER-DECISIONS.md, FIRST-CLASS-PROGRAMS.md):
- **F2 (least-privilege provisioning and the skill finder):** K-Dense's library becomes the first outside skill supply to screen, index and select from, with a hard filter on effects, credentials and capabilities, then BM25 to at most 20. The constructor sees one contract, never a body. Bodies run only in sandboxed agent nodes.
- **F6 (outside ground truth):** OpenScience's Harbor adapter is a route to external science rungs.
