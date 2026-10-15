# Owner decisions, 2026-10-15: eight first-class programs

The owner agreed with the whole analysis given in the session on 2026-10-15 ("I agree with your complete analysis btw, everything you said should also be first class"). Each item below is now a first-class program, with:
- its own design;
- a capability number against a simple baseline (AGENTS.md: every phase produces one);
- a frozen evaluation before any claim.

Programs are designed and scheduled in [FIRST-CLASS-PROGRAMS.md](FIRST-CLASS-PROGRAMS.md).

| # | Decision | Where it came from |
|---|---|---|
| F1 | **Earned structure.** "Needs a workflow" is a property of the operating regime and changes over time. The router stops predicting need once from task text. Instead:<ul><li>Hard primitives give structure from day one: recurrence, time and state, irreversible effects, size, exactness.</li><li>Everything else starts as an agent with a verifier.</li><li>The repeated part becomes a workflow when evidence earns it: recurrence and repeated failures.</li><li>Unsure cases tilt toward workflow + verification, for reliability on the hardest cases.</li><li>The probe decides the ambiguous middle.</li></ul> | M1, M1-R and J-NEED-2 (text-only predictors ≤ 0.71 AUROC across held-out families); E8 (seconds vs about 7 h per world). Owner examples: MVP → CI/CD, OSS maintenance, rule-bound research programs. |
| F2 | **Least-privilege provisioning.** Each node gets exactly the capabilities it needs and nothing more (tools, MCP servers, connectors, skills, data scopes):<ul><li>declared in its contract;</li><li>default deny;</li><li>a typed capability request to the governing harness, which is granted, logged or refused;</li><li>outside skills and plugins screened before any node can load them;</li><li>a skill finder and creator built on our retrieval and quarantine.</li></ul> | J-Q (regex 0.39 recall; typed screens 0.88–0.89); K-Dense skills dossier (136/177 skills carry a self-promotion directive our regex misses; 106 run unpinned `pip install`). |
| F3 | **Inline fix vs sub-workflow request.**<ul><li>Small, local fixes with no new capability and no side effect stay inline.</li><li>Anything that needs new capabilities, effects, a verifier or reuse goes to the harness. A fresh cheap builder with a clean context and a budget carve builds it, and the result comes back typed.</li><li>The governor sees repeats across nodes and builds once.</li></ul> | E8 B1N repair: fresh sessions given only the disagreement evidence took both flawed lineages to 100% for $0.16; `subflow` (experiments/rec/), REC-1. |
| F4 | **Spec from a messy business.** Deriving the contract from emails, documents, records and tribal knowledge is a first-class capability and a first-class test. Every E8 arm got a perfect 9K-token rulebook; reality never gives one. The requirement tracker (owner idea, 2026-10-14) is the bridge. | E8: every agent error was a contract misreading, every builder error a whole missed requirement; AutomationBench failures (outdated rule applied, misleading records). |
| F5 | **Automatic realistic mocks.** Behaviour-faithful sandboxes are built from API schemas, docs and recorded traffic, with model-driven actors, and checked against the real systems. The mock is both the bottleneck and the moat. Its cost is counted in every cost claim. | E8's world was hand-built with frontier effort, and the $1.70 build cost leaves that out. |
| F6 | **Outside ground truth.** Third-party worlds and real process data (AutomationBench, BPI challenge logs, a real user's process) stand beside our own beds, so the method is not tuned to worlds we designed. | We design the specs, worlds and graders. |
| F7 | **Long-term upkeep.** Measure upkeep cost over drift (API renames, policy editions, new record forms) for workflows that heal, against agents that adapt. | Heal prototypes exist; no drift-over-time measurement exists. |
| F8 | **Speed and latency are a first-class metric** beside accuracy and cost, in every comparison. | E8: seconds vs hours per world. |

These decisions sit alongside the earlier adopted decisions (research/need-router-20261014/DECISIONS-ADOPTED.md) and do not reopen them. Decision 12 (Jev is never the mode picker) stands. F1 reframes the router's question; the M0/NL0 preregistration is not reopened. Any change to a preregistered stage goes through a recorded amendment.

## Addendum, 2026-10-15: FIRST-CLASS-PROGRAMS §12 decisions adopted at their defaults

These were adopted by the orchestrating session under the owner's standing authorization ("work relentlessly end to end, don't ask me for perms, you are allowed to do anything necessary"). The owner was told the same turn, and any of them can be revised.

| § 12 | Decision | Adopted |
|---|---|---|
| 1 | Budget | The project soft cap rises from $1,500 to **$2,700, counted on the cap basis** (each stage at the larger of its cap and its metered spend). Paid F rows run in the plan's order. The $500 per-stage pause and every per-run `--cap` stay enforced. The cut alternative (smaller AB-R S3/S4 stages) is held in reserve. |
| 2 | Latency value λ_t | None. Latency is reported beside utility, never inside it. |
| 3 | A real process for F6 | No recording. OUT-2 uses the public BPI logs meanwhile. The owner rung is reported missing until owner tasks arrive. |
| 4 | F5 real systems | OSS twins within D5, after FID-1. No vendor accounts. |
| 5 | WorkBench | Acquire it as a shallow, inert clone with an acquisition record, licence checked. Then EARN-W's preregistration. |
| 6 | LP-1B injections | AB-H only, through a world pre-processor. `bridge.py` is never edited. |
| 7 | LP-1A query set author | A decision-11 far-family author; otherwise the owner. |
| 8 | Heal-kit drift choice | Unchanged. F3 and F7 use the `repair.mjs` path. |
| 9 | AB-R TRAIN/held-out split | TRAIN = dealdesk, reviews, slawatch, routing, receipts, referral. Held-out near = noshow, suppression, mailroom, gdpr, apintake, hr-inbox. EARN-1 uses TRAIN only. |
