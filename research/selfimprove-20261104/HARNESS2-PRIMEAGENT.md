# Harness² and Prime Agent: what their self-improvement does in code, and what Foundry should take (2026-11-04)

**The owner's question [today].** Can we combine ideas from Harness² (Google Research) and Prime Agent (Prime
Intellect) to help Foundry heal and grow, or does that add ideological failure points?

**Evidence label.** A code reading of shallow clones (inert research material; nothing installed or run), plus the
projects' READMEs. Their benchmark numbers are the authors' claims and were not reproduced here.

## Acquisition

| Project | URL | Commit | Date read | Licence | Outcome |
|---|---|---|---|---|---|
| Harness² | https://github.com/google-research/harness2 | `6868817518876de8fd170c6a8354daca273b6191` | 2026-11-04 | Apache-2.0 | Cloned `--depth 1`, hooks disabled, no install; `harness2/core/{selection,recursion,library}.py` read. Clone at `corpus/harness-study/harness2` (not committed) |
| Prime Agent | https://github.com/PrimeIntellect-ai/prime-agent | `bba5bcf3f53dff4fe42bed2356c8569dafb00966` | 2026-11-04 | MIT | Cloned `--depth 1`, hooks disabled, no install; `crates/pa-core/src/refinement/{mod,planner,ranking}.rs` and the README read. Clone at `corpus/harness-study/prime-agent` (not committed) |

## What each one actually does

### Harness²: recursive harnessing without ground truth

- **Task-level recursion: propose → probe → compose.**
  - A harness editor proposes edits to eight components (system prompt, guardrails, memory, tool guidance, subagents,
    skills, scripts, plugins).
  - Each edit is probed by re-running the **same task**. The README says this happens "without ground-truth
    feedback".
  - The budget is about **4k rollouts and 3k improvement stages** per task at recursion budget k (`recursion.py`).
- **Selection** (`selection.py`, `run_selection`):
  - A model reads the anonymised candidate outputs and returns one ```` ```choice ```` id.
  - `context.assert_no_grader_verdicts(root)` makes sure no grade is visible to it.
  - If the selector fails, it falls back to a delivered base output.
- **Harnessing-level recursion** (`library.py`): a per-domain "experience library" keeps each adopted harness tree in
  full, plus an `EXPERIENCE.md` with a cue, a lesson and evidence. Later tasks in the same domain read it before
  starting.

### Prime Agent: a continual harness with `/refine`

- **State** (`refinement/mod.rs`): entries of five kinds (prompt, memory, skill, subagent, factory), each versioned.
  Each refinement event records its trigger, changes, evidence and outcome. Applied edits keep before and after
  snapshots for rollback.
- **Refine** (`planner.rs`):
  - A model proposes edits as JSON.
  - The planner validates **structure** (fields, limits, truncation) and applies them.
  - It never rewrites the immutable base system prompt.
- **Use** (`ranking.rs`): entries are ranked for the prompt by lexical term weights from the goal and recent messages.
- **What decides that an edit is good:** the proposing model's own reading of the trajectory. The README cites a Factorio
  case where refinement found an exploit (spawning resources through RCON) and then refined itself towards exploiting
  more efficiently.

## Where they meet what we have measured

| Their mechanism | Our closest measurement | What it showed |
|---|---|---|
| A model selecting among candidate outputs, no ground truth (Harness²) | VL-1: a verifier-led selection among forks, on look 2 | +3 over the default (+8/−5, p 0.58), inconclusive. Selection accuracy 0.72 on discordant tasks. Judges share their errors (κ 0.61–0.70) |
| Probing an edit on the same task (Harness²) | FH-1: patch → replay against capability contracts | 75.2% removed with 0 regressions, **with** frontier-written contracts as the verifier. Without an oracle there is nothing to replay against |
| Model-proposed edits, checked for structure only (Prime Agent) | C0: Haiku's construction self-checks | All 9 construction defects were in cases no probe contained; the F verdict passed all 5 oracle failures. Self-certification fails |
| A per-domain library of adopted harnesses and lessons (Harness²) | C2 reuse | Reuse behind a profile gate 85% against 98% for rebuilding; behind a conformance gate (the consumer's labelled history) 0 wrong reuse in 98 |
| Snapshots and rollback (Prime Agent) | Version-bound proposals, compare-and-swap, engine identity | Already the engine's model |

## Answer: adopt them as proposers, never as promoters

**Adopting them does not add failure points if** two conditions hold:
1. Their loops only **propose** changes to Foundry's mutable layer: workflow versions, skill text, templates, sub-agent
   specs.
2. **Promotion stays with Foundry's gate.** That means:
   - frozen oracles or capability contracts;
   - replay of recorded failures plus a regression slice;
   - the commit gate (ATTACK Move 1);
   - tri-state verdicts, where UNKNOWN never passes;
   - for anything claimed, a held-out check.

**They add failure points if** a loop judges its own improvement, or can reach the authority layer. The authority layer
is the capability set, the oracles, the approval rules, the engine. Concretely:
- **Selection without a verifier** (Harness²'s promoter) is the mechanism VL-1 found too noisy to clear a ≤ 2-loss rule.
- **Self-assessed refinement** (Prime Agent's promoter) is the mechanism C0 and Prime Agent's own Factorio case show
  failing.
- **Probing on the same task** is in-sample: an edit that helps this task can still hurt the next one. Harness² spends
  about 7k runs per task; our gate costs one replay of recorded failures plus a regression slice, often $0 when the
  nodes are deterministic (record/replay).

**What to take, concretely:**
1. **Propose → probe → compose as heal proposers** for FH-style healing. The probe is our replay ($0 on recorded runs).
   Only edits that pass the gate are composed.
2. **Prime Agent's split between immutable and supplemental state**, extended to engine and oracles (immutable) versus
   workflow, skills and templates (supplemental). Every refinement event records trigger, change, evidence and outcome.
   Snapshots are already free under version-bound proposals.
3. **Harness²'s per-domain library, but gated as C2-2 is:** an adopted workflow plus its lesson enters the library only
   with the gate's evidence. A later task may reuse it only behind the consumer-conformance gate. The cue/lesson/evidence
   triple is a good record format for the skill pack.
4. **Not taken:** verifier-free selection as a promoter. Probing on the same task as evidence. Any loop that can edit
   capabilities, oracles or approval rules.

## The experiment that would settle it (task #105, not run)

On the durability stream (DUR-1, still running), compare two ways of promoting the same proposals:
- (a) **our gate:** replay plus a regression slice plus the commit gate;
- (b) **Harness²-style:** a model chooses between the base and the edited run on the same input, with no oracle.

Count the regressions each admits on held-out stream items, and the gains each keeps. Recorded runs make most of it $0;
the paid part is a few dollars of selector calls.

**Prediction, stated before any data:** (b) admits more regressions at a similar gain. VL-1 and C0 both point that way.

The experiment is preregistered only after DUR-1 finishes, so that its stream stays untouched.
