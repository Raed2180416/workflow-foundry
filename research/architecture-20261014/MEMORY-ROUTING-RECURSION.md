# Memory, routing and recursion: the revised design (2026-10-15)

This answers the owner's questions of 2026-10-14 (realistic mocks, a workflow inside a workflow, memory, routing with user
control, Jev as the need judge, Jev/Kev status, and the line between necessary and unnecessary complexity). It revises the
merged design of 2026-10-14 (from the five lane reports JA, MEM, REAL, REC and ROUT) using the adversarial critique of
2026-10-15. Each of the critique's ten changes is accepted or rejected below, with a reason.

**Status.** Development and diagnostic design only. No result here is sealed or claim-bearing. Written at HEAD `e6bcc9e`
(branch `claude/intelligent-hamilton-vg1f9a`). Writing it cost $0: no model or Jev calls, no repository edits other than
this file, and neither `beds/sealed/` nor any credential file was read.

**Tags.**
- **[V]** I checked it today in the repository at the cited path, or recomputed it at $0 from committed rows.
- **[web]** A page I opened today; the URLs are in Appendix A.
- **[D]** Taken from the 2026-10-14 design, which cites the lane reports. I did not re-verify it, because the lane reports
  are not in the repository.
- **[C]** Taken from the critique. I did not re-verify it.
- **[I]** My own decision or inference.
- **[arith]** My arithmetic, with its assumptions stated.

---

## Owner summary

1. **Realistic mocks: you are right, and one already exists.**
   - **What E8 shows.** A workflow's flaws show up only when a model works inside a world that pushes back. A one-shot
     Haiku build scored 0/155. The same model scored 1,022/1,022 after it practised in a mock world [V].
   - **Why that may not travel.** We wrote both the practice worlds and the grading worlds with the same generator.
   - **The fix is already acquired.** Zapier's AutomationBench (acquired 10-14) has 600 hand-built business worlds full of
     traps, graded on the final state of the world and written by someone else [V].
   - **First run, MA-0, about $10–30.** Two arms on the same tasks:
     - a Haiku agent;
     - the same agent allowed to rehearse on a copy of the world before acting on the real one. This arm tests your idea
       directly.
   - **Model-written people come second.** Customers, analysts and attackers written by a model are MA-1, about $30,
     with two fixes:
     - the models that admit a text must not be the models being tested;
     - texts they reject are scored separately, never thrown away.

2. **A workflow inside a workflow.**
   - **The tool.** An agent node gets one tool, `subflow`, to write and run its own sub-workflow.
   - **The call always runs.** The agent never negotiates. The host decides only how much isolation and checking to put
     around the call.
   - **Hard refusals only.** The host refuses only for:
     - budget;
     - depth;
     - taint from untrusted data;
     - a sub-task that is not smaller than its parent.
   - **Verification.** The host plants a deliberately broken answer. A sub-workflow counts as verified only if its check
     catches that answer. Otherwise its output counts as the agent's own work.
   - **Long waits are not sub-workflows.** Asking a customer, waiting days and re-judging is handled by obligations (timed
     wake-ups), which the bed hosts already have [V].
   - **The test.** REC-1 (about $250) checks whether the tool helps Haiku and does not hurt Opus.

3. **"Don't dumb down the model": I found a real violation.**
   - **The cap.** The product runtime refuses or truncates any Haiku node whose input exceeds 8,000 tokens [V]. That limit
     dates from when "class M" meant a 7–14B open model.
   - **The evidence against it.** One Haiku 5.5 call solves 45–64K-token tasks in M1 [V].
   - **The fix.** Raise the limit for the hosted classes to 100K before the need-router matrix starts on 10-18.
   - **Size alone never triggers a sub-workflow.** It takes size plus a failed or slow attempt.

4. **Memory: private by default, unlimited inside a node.**
   - **Inside a node.** The model sees everything it needs, with no limits.
   - **Out of a node.** Its typed result, its key assumptions and handles to its files leave the node. Its transcript never
     does.
   - **Across runs, Foundry keeps three things:**
     - proven procedures (the library);
     - typed application state;
     - the audit record.
   - **Not Foundry's job.** User memory and "lessons" belong to AMP (your decision D11).
   - **Answer keys** live where no model can read them.
   - **Three real holes, each a $0 fix:**
     - a workspace shared between cases;
     - answer labels stored inside a solver's folder;
     - a replay cache that can fake a unanimous vote.

5. **Your control.**
   - **One fixed order:**
     1. the policy file;
     2. a short list of safety rules, written in the policy file where you can see and edit them;
     3. your pins;
     4. everything automatic.
   - **Where pins count.** A pin counts whether you set it in the UI, in the CLI, or through an agent working for you over
     MCP. Only a model inside the run cannot pin.
   - **One card per run** shows each node's model and why.
   - **One hole.** An automatic assignment can silently replace a model you pinned [V]. It gets fixed.

6. **Can Jev decide whether a task needs a workflow? No, and now there is more data.**
   - **The scores.** Asked directly, Jev scored 0.53 on 96 tasks and 0.46 on 144 tasks [V]. A one-line size rule scored
     0.71 and 0.65.
   - **One caveat first.** Those labels count 300-second timeouts as failures: 54 of 288 calls [V]. A re-run at 600 s
     costs about $15 and comes before we call the question settled.
   - **Why the answer holds either way.** "Needs a workflow" depends on:
     - which model runs the task;
     - the time limit;
     - the difficulty;
     - how often the task recurs.

     The same family goes from one call solving it at difficulty 3 to one call failing at difficulty 5 [V]. A cheap try on
     one example measures this. Reading the text cannot.
   - **Jev's role.** It may answer small property questions that feed the decision.

7. **Jev/Kev: "implemented right?" The plumbing is right; the job is not done yet.**
   - **Right.** The safety rules: Jev only ranks or vetoes, and it never decides.
   - **Not done yet:**
     - Jev gates nothing.
     - Its version is not pinned, and 1.14 shipped yesterday behind an alias [web].
     - The penny tests that would earn it a job never ran.
     - It is not an independent second opinion. When Haiku and Jev are both wrong, they pick the same wrong option 36 times
       in 40 [V].
   - **Next.** Pin the version now. Run the penny tests with every option order.
   - **Kev** stays parked.

8. **The line.** Build three kinds of thing:
   - what prevents a failure we have seen, or one we can plant for free;
   - what keeps a decision in your hands;
   - what a test can show working this week.

   Everything else waits for an experiment that needs it. In short: free inside a node, typed at its edges, you at the
   top.

9. **Cost.**
   - **This week:** $0 for the fixes and builds.
   - **Small runs:** about $25–45 for the re-label, the Jev tests and AutomationBench.
   - **Larger runs:** MA-1 about $30; REC-1 about $250.
   - **Total:** about $310 estimated, about $450 at the caps. Each experiment is under the $500 pause.
   - **With the need router's about $950:** the estimate fits the $1,500 soft cap, but the caps do not (about $1,680). §5
     lists what to drop first.

10. **Decisions for you** (each has a default; see §6):
    - how AutomationBench text may reach a model. Default: a host-run tool loop that needs no exemption;
    - unpausing the penny Jev tests;
    - approving MA-0, MA-1 and REC-1;
    - one to three hours of your writing and review;
    - whether the AWS keys are meant for Bedrock. Default: they stay unused.

---

## 1. What changed since the design

**New evidence, committed after the design was written [V].**

- **M1 at difficulty 5** (`research/need-router-20261014/runs/m1/REPORT.md`, `runs/m1-d5/`, $5.92).
  - R3 went from 8–9/12 at d3 to 0/12 at d5.
  - R6 went from 2–6/12 to 0/12.
  - R3′ still scored 10–11/12.
  - Reading: the need for a workflow flips with difficulty inside one family.
- **Jev on d3 and d5 together** (144 tasks, `runs/jev-need/REPORT.md`): task-level AUROC 0.46, against 0.65 for the size
  rule. Jev is most confident that one call fails on R3′, which one call solves 10–12/12 at both levels.

**The timeout confound, quantified [V]**, recomputed from `runs/{m1,m1-d5}/results.jsonl`. All calls ran with a 300 s limit,
and each timeout was recorded at $0.

| Run | Timeouts | R1 | R4 | R5 | R3 | R6 |
|---|---|---|---|---|---|---|
| d3 | 26/192 | 18/24 | 8/24 | 0/24 (4 schema-invalid, the rest wrong) | 0 | 0 |
| d5 | 28/96 | — | — | — | 17/24 | 11/24 |

- The need-router arm `direct-H` uses a 600 s limit (`prereg/stages.json` `arms.direct-H.providerTimeoutMs`).
- The R3 calls at d5 that did not time out also failed: 0/7, with 4 schema-invalid.
- So the d5 flip is real, but most of it rests on timeouts.

**Two facts that change the plan's timing [V].**
1. **The need-router label engine stamps whole trees** (`prereg/stages.json` `engineStamp.labelEngine.trees`):
   - `src`;
   - `experiments/lib`;
   - `experiments/c0`;
   - `beds/lib`;
   - `policy/models.json`.

   Any later change to one of these is a §13 deviation before the next stage. NL0 starts 10-18.
2. **R4 and R5 are not need-router jobs** (`stages.json` `jobs`). REC-1's flat baseline rows for R4-d5 and R5-d5
   therefore do not exist in the matrix.

**Corrections to the critique [V].**
- **Timeouts.** R5 has no timeouts, so "concentrated in R1/R4/R5" overstates the confound. Its strongest form is at d5,
  which the critique had not seen.
- **No validator edit is needed.** `src/models/policy.mjs:102-103` already accepts any positive integer budget.
- **The exemption cannot work as written.** The critique's D10 exemption asks for "egress: none, no CLI token in the
  sandbox". A `claude -p` executor needs both to reach the model. `src/executors/claude-code.mjs` passes
  `CLAUDE_CODE_OAUTH_TOKEN` and shares the network namespace.
- **The proposed gateway route sits in a stamped tree.** The critique would put `flow:subflow` in
  `experiments/lib/services.mjs`, which is inside the stamped `experiments/lib` tree.
- **The nested-model scan matches more than the critique lists.** It also matches `/v1/messages` and the Anthropic SDK
  names (`NESTED_API`, `claude-code.mjs:134`), so the subflow route must avoid those strings.
- **Source.** The quote "from a user, an agent via MCP, or ARC" is at ROADMAP:33, not in THESIS.
- **The 8K cap does not bias the need-router labels.** `construct-H` is the B1 script arm, which calls the gateway, not
  `src/runtime.mjs`. `selfCheck` is defined for B1 only (`experiments/c0/construct.mjs:153`). The cap does bind:
  - every `workflow.json` run through the product runtime, by MCP or the F arm (`experiments/lib/arms/foundry-workflow.mjs`);
  - the C0 F-haiku arm, which ran under it. It may explain part of F-haiku's 11/16 against B1-haiku's 16/16 (unverified,
    and worth a $0 journal check).

---

## 2. Decisions on the critique's ten changes

The critique's precondition comes first, then the ten ranked changes, then its niche ideas. Every accepted change keeps
the critique's direction; the modifications are mine [I].

**Precondition: "adopt an allowance budget per workstream before launching". Rejected as a precondition.**
- The owner explicitly declined the usage rule (D14, "Full speed", README; ROADMAP §6). A design must not reinstate it by
  the back door.
- What I keep:
  - §5 prints a rough usage estimate per workstream, for information only;
  - the plan is ordered so that a usage stop loses the least: $0 fixes and penny tests first, large runs last.

| # | Change | Verdict | Reason and modification |
|---|---|---|---|
| 1 | Remove the size caps that hold Haiku back | **Accept, modified** | Verified: `inputBudgetTokensByClass.M = 8000` reaches `compileContext` (`src/runtime.mjs:1193`), which throws `CONTEXT_OVERFLOW` (`src/context.mjs:112-125`). ROADMAP §2.3 still calls class M "7–14B", while the policy notes say hosted classes are "placed by price tier and must be justified by measurement". M1 is that measurement. Modifications: no `policy.mjs` edit; set M, L and F to 100,000 (the policy's own Haiku price boundary, above the largest measured one-call success), leave S at 4,000 (parked); delete `defaultsByRole`; add a test that a Haiku `agent` node compiles a 60K-token input. **Timing:** batch it with the Jev pin into one policy version before the NL0 stamp (10-18), recorded as a single §13 deviation against M1. The design's ~10-29 date would collide with E2E and NL2b. REC's S2 becomes "size AND (probe failed OR probe slow)". The library's `CAP_TABLE` (S6 fill: 8,000 total, 2,500 for task text, `experiments/library/context.mjs`) is a deliberate per-step cap: revisit it when the library is unpaused, not now |
| 2 | Make AutomationBench the venue for realism; resolve D10 | **Accept, modified** | Accepted: it is the only bed where Claude wrote neither the spec, nor the traps, nor the oracle; the bridge matches the official environment 35/35 [V]; and the runner puts the official prompt into a `claude -p` session with Bash [V], which sits outside D10 as written. Modifications: **(a)** the exemption as worded cannot be met (§1), so the default route is a **host-run tool loop**: Haiku through the journaled ModelPort, tool calls as typed JSON, the host forwarding them to `bridge.py serve`. No executor and no token sit in any sandbox. It falls under D15 (builder reads third-party text, no effects, no egress, mocks) and is closer to the official native tool loop than the Bash bridge. The owner may instead exempt fictional MIT worlds for the current executor. **(b)** AutomationBench does not replace MA-1: its system prompt says "Do not ask clarifying questions" and each task is one trigger message (NOTES §3) [V], so it cannot test clarification, mind changes or pressure. **(c)** On raw one-off tasks, run **rehearse-H** (rehearse on a fork of the world, then act on the real one) instead of construct-H. At N = 1 a build has nothing to amortise; rehearsal is the owner's realistic-mock idea at task level. Construct-H belongs to the recurring families (#62, MA-0b) |
| 3 | Separate the MA-1 panel from the arms; never discard texts | **Accept, modified** | Accepted: a panel that shares the arms' reading family filters out, by construction, exactly the texts the arms misread; Jev is not "diverse" (φ = 0.612 [0.505, 0.713], 36 of 40 joint errors on the same option, `research/judge-20261009/independence/README.md:23,30`) [V]. Modifications: **admission** = deterministic anchor checks plus whichever non-Claude decoders exist (local Qwen3.5-4B offline; Bedrock only if the owner confirms D1-aws). Claude and Jev decodes are recorded as strata, never used to admit; rejected texts form a scored `T2-hard` stratum. **Human anchor:** the critique's "≥30 per class" is still underpowered (two independent proportions at n = 30, p ≈ 0.7: ±0.23 [arith]). Make it **paired** (the same intent records written by a human and by the model), pooled across classes and report-only. It fires only when the paired lower bound exceeds 0.10, which 60 pairs can show only for gaps of about 0.2 or more [arith: discordance 0.2, sd ≈ 0.058]. Authors: the decision-11 far-family authors when available (the owner's messages are spec-shaped), else the owner. **Sealed pack:** same renderer mix, different seeds (critique N5), plus an audit sample of *admitted* items per split. Standardized-patient portrayal accuracy ranges 42–89% even for trained humans, and that field's remedy is continuous monitoring (Baig et al. 2014) [web] |
| 4 | Give sub-workflows a check that can fail | **Accept, modified** | Accepted: "typed return plus one invariant, or a self-differential" cannot fail. That is `ACCEPTANCE_EXISTENCE_ONLY` one level down; the repo's own record is 32/32 "pass" verdicts including 5 oracle failures (README C0) [V]. Modifications: **(a)** a check earns credit only if it rejects a host-planted single mutant (one probe unit's output perturbed by a type-preserving edit); the double mutant is optional; otherwise the output is `unverified` and counts as an agent delivery. **(b)** Reverse-generation self-tests are allowed, not preferred: the agent's generator shares the agent's blind spots. **(c)** The run-level budget is accepted with corrected arithmetic: silent-wrong ≈ 1 − Π(1 − eᵢqᵢ), where eᵢ is the node's error rate, not 1 − Π(1 − qᵢ). With e = 0.1, q = 0.2 and 10 nodes that is 0.18, not 0.89 [arith]; still too high, so allocate a run budget (e.g. ≤ 0.05) across nodes, Viola–Jones style. **(d)** **Rejected:** tracker properties as the default check source. By its own README the tracker is "not yet usable as a verdict" (16–21 false alarms) [V]; revisit after tracker v2 is preregistered and calibrated |
| 5 | Spawn is a hint: run inline instead of refusing | **Accept** | Lazy task creation (Mohr, Kranz, Halstead, IEEE TPDS 2(3):264–280, 1991) [web] gives the right semantics: the program states potential structure, the runtime decides whether it becomes a real task, and the result never depends on that choice. So `subflow` always runs. The host chooses `child` (isolated, metered, mutant-checked, eligible for memo and harvest) or `inline` (the agent's own budget and sandbox; an agent delivery; no harvest) from S2–S4, and logs `executedAs` on the card. Delete S5 (the discretionary allowance) and the soft refusal. Hard refusals stay: depth or count, budget, taint, and the size-change measure (N4). The 10% randomised slice moves to the E2E live lane |
| 6 | Re-label the need labels and restate the Jev need verdict | **Accept, enlarged** | Restate it as "stock Jev, asked the verdict directly, did not beat a size rule" (0.53 vs 0.71; 0.46 vs 0.65 on 144 tasks). Re-run **54** timed-out calls (26 at d3, 28 at d5), not 26, at 600 s: the d5 confound is the larger one. Estimated $10–15: the 600-s call priced at about twice the dearest completed call per rung (R1 $0.046, R4 $0.089, R3 $0.116, R6 $0.297 at d5); hard bound $54 at the $1/call rule [arith]. Report both labellings: a timeout at the router's own budget *is* a real outcome (M1 REPORT), but the router's budget is 600 s. J-NEED-2 runs with every option order averaged plus a Haiku typed arm on identical questions. Pin `jev-1.13.0` now (with change #1). The e8d7a53 exemption covers the heal kit; `MODEL_POLICY_DRIFT` blocks resuming an in-flight `src` run with model nodes (`src/runtime.mjs:639`), and none is in the matrix |
| 7 | Build flow-in-agent without touching the stamped executor; fix H4 | **Accept, modified** | Verified: `extraEnv` may carry `FOUNDRY_MODEL_GATEWAY_TOKEN` (`EXTRA_ENV_CREDENTIALS`, `claude-code.mjs`), and `runSolver` already writes `tools/gateway.json` (`experiments/library/run.mjs:119`) [V]. Modification: put the `subflow` route in a **new module outside every stamped tree** (e.g. `experiments/rec/`), not in `experiments/lib/services.mjs`; its client path must not match `NESTED_API`. Then agent-H's stamp is unchanged and its matrix rows can be reused. H4/F-R2: withdraw the tool only on shown harm (upper bound of the paired difference < 0), and print the minimum detectable effect before the run: about 0.26 at n = 36 paired tasks [arith: discordance 0.3, 80% power]. New: R4 and R5 have no matrix rows (§1), so either budget their flat arms (about $50–100) or use `wbed-r1-hi`, which the matrix covers |
| 8 | Memory: three fixes, one deletion | **Accept, modified** | Fixes accepted: M1, M2, M3, M6, X1, X4. M3 is narrower than stated: the memo fakes unanimity when a journal holds fewer answers per key than the samples requested, and it is on in every `jit.replayJournal` arm (`stream.mjs` `replayPort` passes `live`, so `reuse` defaults on, `run-compiled.mjs:110`) [V]. Strike the new "`unverified` + TTL" item class and the family notebook (D11). Count N-version promotion evidence from pre-repair agreement only (`repair.mjs:1-8` shows minority builds the majority's behaviour) [V]. Add W5b (10% injected documents) to X2; W5 is one world-level flag (`world.mjs:87,170`) [V]. **Rejected:** "keep `principal` as one optional field with no behaviour". `foundry-identity-1` is `additionalProperties: false` (`schemas/identity.schema.json`) [V], so a field that does nothing would cost a schema version. AMP's `project` and ARC's `taskId` already scope a run when present, and cross-tenant walls belong to AMP/ARC |
| 9 | Pins from any caller; invariants listed in the policy | **Accept, modified** | Pins from UI, CLI, MCP and ARC count as user pins and carry `provenance.caller`; only `builder` provenance (a model inside this run) is demoted to a suggestion. Waiving a guard (rank 3, e.g. `GLOBAL_READ_UNGUARDED`) requires UI or CLI, because an agent over MCP is a model and AGENTS.md keeps authority outside the model. `invariants: [{id, rule, reason}]` goes in the policy file, hashed into `modelPolicyHash`, and the card prints the id of any refused pin. Timing: provenance, `ASSIGNMENT_CONFLICT` and enforcing the invariants are `src` changes; they land at the engine bump after the matrix (≥ 11-04). No experiment in this plan uses run-level assignment on the `src` runtime |
| 10 | Verifier independence: measure it; open the non-Claude route | **Accept, modified** | Replace the family test with a measured **conditional miss rate**: P(the verifier passes \| the producer is wrong), on planted mutants plus real failures, per port. A verifier may gate only when that rate fits the node's share of the run budget (change 4c), not below an arbitrary φ = 0.3. Otherwise it is `correlated` and does not gate. Capture–recapture (N2) is report-only, with Briand et al.'s warning about fewer than four detectors. **D1-aws: raised, not blocking.** Using keys "with no stated purpose" as a model route needs the owner's yes; the design must work without them, so code checks remain the source of independence |

**The critique's other findings.**
- **F3.** The E8 agent-H baseline is missing (`runs/agenth-e8-1/` holds only `ticks-killed-run1.jsonl`) [V]. REC-1's E8 cage
  test runs only if #58's agent-H paired rows land; otherwise codefix-d5 is the cage test.
- **F4.** Diagnosis accepted; remedy rejected. The tick hosts already have typed obligations with `dueAt` and `onDue`,
  journaled as `obligation.upsert/cancel` (`beds/ebed/host/host.mjs:676-715`) [V]. Clarification across ticks uses carry
  and obligations, so no new primitive is needed.
- **F10.** Accepted. E8 v1.2 needs a spec sentence: "the counted action for an undecidable case is the one a kind-correct
  clarification resolves to".
- **F13.** Accepted. Model-rendered packs are labelled `synthetic`. The adaptive-injection class reaches only compiled
  solvers, whose text goes only to quarantined `flow.judge`. Agent arms with Bash wait for executor isolation.
- **F15.** Accepted. Practice worlds and grading worlds share a generator. AutomationBench is the out-of-generator check.
- **F17.** Accepted. Every report prints `cacheReadShare` per arm (`services.mjs:38-43`) [V].
- **F20.** Accepted. Screen any Jev rung against oracle labels, never against agreement with Haiku.
- **F21.** Accepted:
  - drop the supersession port;
  - remove or precompute the date-order and counting knobs in J-APP. TypeSafe's own advice is "count in code" and to keep
    ordering in code [web];
  - add J-Q2, an adaptive adversary, once the MA-1 renderer exists.
- **F22.** Accepted. Print Kotte's abstention floor per port before choosing a risk target. For J1's pooled accuracy of
  0.774 at α = 0.05, the floor is (0.226 − 0.05)/(1 − 0.05) ≈ 0.19 [arith].

**The critique's niche ideas.**
- **N1, item response theory.** Accepted as a $0 secondary analysis (`NR-irt`) on existing rows. It has direct prior art:
  IRT-Router, ACL 2025 [web].
- **N2, capture–recapture.** Report-only.
- **N3** is change 5.
- **N4, size-change termination.** Accepted. The measure is declared per edge: the unit set is a strict subset, or else
  the input tokens are strictly fewer.
- **N5, standardized patients.** Accepted inside change 3.
- **N6** is change 4c.
- **N7, order-averaged judging.** Accepted for every Jev choice port. SCOPE averages both orderings and calibrates a
  threshold, with an empirical FDR of about 0.097 at α = 0.10 (ICML 2026) [web]. Its guarantee assumes exchangeability,
  which held-out families break, so it is reported, never promised.

---

## 3. The revised design

### 3.1 Jev and Kev: what is true, and what to wire next

| Place | Built | Gates anything | Measured (dev) | Verdict |
|---|---|---|---|---|
| Client, wire converters, request builders (`src/judgment.mjs`, `experiments/library/jev.mjs`) | yes | no | J1, jev-need | Correct discipline: rank or veto only; no reputation, evidence or labels inside a request [D] |
| JudgmentPort (`src/ports.mjs`) | yes, used only by `experiments/` and `tests/` | no | unit tests | No journal or replay. Add both, plus the served version, before any runtime use [D] |
| Policy entry | `jev-latest` alias only [V] | — | — | **Pin `jev-1.13.0` now.** The alias moves; TypeSafe: "send that version's ID" if thresholds are tuned, and log the `model` field of each response [web] |
| Need decider | script | no (decision 12) | 0.53 (96 tasks), 0.46 (144) vs size 0.71/0.65 [V] | Not a decider. Property features only (J-NEED-2) |
| Voter or verifier beside Claude | — | — | φ 0.612; 36 of 40 joint errors on the same option [V] | **Not independent.** Not a diverse panel member either |
| Note-semantics ports in beds (J1) | — | — | pooled 0.774; strong Q4, Q6, K1, X8; weak X6, X4, X3 [D] | At most advisory |
| Applicability veto on reuse | request builder | no | never | **J-APP**, without date or counting knobs (F21) |
| Quarantined read | request builder | no; the live screen is a regex (recall 0.39) [D] | never | **J-Q**, then J-Q2 with an adaptive adversary |
| Failure class | request builder | no | never | Don't wire: code does it exactly [D] |
| Kev | parked 10-09 | — | at or below the rule on 4 of 5 ports [D] | Keep parked |

**Every Jev test** follows these rules:
- synthetic text only (Q5b);
- the pinned id, with the served version on every row;
- the raw responses journaled;
- all option orders, averaged (N7);
- a Haiku typed arm on the same questions;
- results written to the ledger as veto or rank only;
- Kotte's abstention floor printed (F22).

**A port graduates in this order:**
1. pass on dev;
2. pass on a re-authored held-out set;
3. a threshold that is feasible under the abstention floor;
4. one journaled, replayable port at the post-matrix engine bump;
5. use as veto or rank only;
6. a breaker on its false-veto rate.

### 3.2 The memory model

This is the owner's question: how memory is shared, and what each part keeps to itself.

**The principle [I].** Memory should travel with authority and evidence, not with convenience. Each kind of memory below is
justified by a failure it prevents.

**Seven memories, by lifetime.**

| # | Memory | Who writes it | Who reads it | Lifetime | Status |
|---|---|---|---|---|---|
| 1 | **Working memory** of a node: context, tool outputs, scratch, workspace | the node's model and tools | that model only; the parent sees handles | the node | unrestricted inside (R7) |
| 2 | **Run memory**: typed outputs, `decisions[]` (key assumptions), artifact handles, labels | node code via the runtime | declared edges only | the run | built (edges, labels); `decisions[]` new and small |
| 3 | **Procedural memory**: library workflows, templates, assignments | the harvest ladder only (draft → shadow → canary → served) | selection code; models see candidates with provenance | across runs, fingerprint-bound, retired after 30 days unused | built in `experiments/library` |
| 4 | **Application state**: cursors, dedupe sets | the declared writer, compare-and-swap | the declared reader | TTL, journaled | built (`src/state.mjs`) |
| 5 | **Evidence**: journal, ledger, verdicts, oracle truth | runtime, oracles | replay, calibration and analysis code; **never a prompt** | append-only | built; M2 and M3 are holes |
| 6 | **Accidental memories**: prompt cache, replay memo, workspace carry, resume | infrastructure | whoever reuses the bytes | varies | the source of three of four holes; audit with an executable leak scan, not a table |
| 7 | **User memory**: preferences, facts, lessons | — | — | — | **not Foundry** (THESIS §4, D11). AMP claims, or a replay-proven workflow version |

**Who sees what.** This is the design's table with the principal removed [D, revised].

| Item | Node's own model | Parent's model | Parent's code | Sibling | Owner, auditors | Future runs |
|---|---|---|---|---|---|---|
| Transcript, tool outputs | yes | no, except an escalation or repair fork under a receipt | handle | no | yes | only via verified harvest into the library |
| Scratch, workspace | yes | no | handle | no | yes | same |
| Typed output | yes | yes, labelled with the join of its inputs | yes | along a declared edge only | yes | archived run record only |
| `decisions[]` (capped, labelled) | yes | yes, behind the untrusted preamble if tainted | yes | no | yes | no |
| Untrusted outside text | yes, labelled | only through a quarantined typed read | label check | no | yes | no |
| Library procedures | as candidates with provenance | — | selection code | — | yes | yes, after the ladder |
| Truth domain (oracle verdicts, labels, held-out material) | **never** | **never** | oracle and analysis code only | never | yes | calibration code only |
| Credentials | never | never | provider adapter only | never | owner | — |

**Rules that govern the stores Foundry has.**

| # | Rule | Applies to | Prevents |
|---|---|---|---|
| R1 | Private by default. Sharing only through an explicit handle or a declared edge; children inherit nothing; grants only narrow | memory 1 and 2 | Leakage across scopes. Infection between agents spreads through shared transcripts [D: MEM §2.2]; MINJA poisons a memory bank with ordinary queries (NeurIPS 2025) [web] |
| R2 | Boundaries carry typed outputs, assumptions and handles, never transcripts | 2 | Injected instructions travelling between agents. Anthropic's research system likewise has subagents "store their work in external systems, then pass lightweight references back" (2025, older) [web]; Claude Code subagents return "only the summary" and their reports are scanned (2026 docs) [web] |
| R3 | One writer per item; snapshot reads; compare-and-swap | 4, E-bed carry | Lost updates, stale reads |
| R4 | Append-only: invalidate, never delete; a contradiction is kept as two items | 3, 5 | Contradictions collapsing silently. "Contradiction persistence" and "provenance collapse" are two of the four failure modes in Governed Shared Memory (arXiv 2606.24535, June 2026) [web] |
| R5 | A summary is a derived view that names what it covers; raw items are never replaced | any summary handed to a model | Loss through summarising: the repo's B0+N notes arm scored 17/36 against 23/36 without notes [V README P1] |
| R6 | Model output crosses a run boundary only through the library ladder (verified) or as an AMP claim | 3 | The self-reinforcing cycle in which a corrupted outcome becomes precedent (A-MemGuard [D]); the MINJA path |
| R7 | Inside a node nothing is restricted. Escalation and repair get a full context fork | 1 | Starving the model, i.e. dumbing it down |
| R8 | Labels survive derivation. Text derived from untrusted input never steers control flow | 1–3 | Injection that persists through memory |
| R9 | The truth domain and credentials sit outside every sandbox, workdir and prompt | 5 | Oracle leaks (F9); M2 |
| R10 | Cross-run items are bound to a fingerprint (policy hash, engine tree, model versions); a change sends them to shadow | 3 | Staleness after a model or engine change ("stale propagation" [web 2606.24535]) |

**Left to AMP and ARC:** user and tenant walls, preference memory, and multi-user sharing graphs.
- The prior art is real: Collaborative Memory uses private and shared tiers with bipartite access graphs and per-fragment
  provenance (arXiv 2505.18279, 2025; the abstract reports no experiments) [web].
- Foundry needs none of this until it serves more than one principal.

**The holes, and their $0 fixes [V].**

| Hole | Evidence | Fix |
|---|---|---|
| M1: agent workspace shared across cases | `experiments/ebed/agent-arm.mjs:99-108` copies `ws/` in and out every tick; the prompt says "persistent workspace across ticks and instances" | Keep `agent-H-ws` as the honest "learns on the job" baseline. Foundry's own arms get a workspace per instance |
| M2: truth stored next to a solver | `experiments/library/run.mjs:112` puts the library at `<workdir>/library`; the solver runs with `cwd` and `HOME` = workdir and no sandbox | Library outside every workdir; retrieval only through a host handle |
| M3: replay cache fakes unanimity | `run-compiled.mjs:110-123` serves the last answer again under `reuse`; `stream.mjs` `replayPort` turns it on | `reuse: false` when samples > 1 or a run is claim-bearing; print `memo.reused` in every report |
| M6: a child's deopt `detail` reaches parent code | `flow-v3.mjs:592-594` (up to 1,000 characters) | Label it untrusted |

**Memory tests.**
- **X1 ($0).** A leak scan: no truth-domain bytes under any sandbox, workdir or prompt.
- **X4 ($0).** Memo `reused` hits across task ids in the existing journals. Must be 0 for claim-bearing runs.
- **Cache share ($0).** Print `cacheReadShare` per arm.
- **X2.** Deferred. When it runs, it uses W5b (10% injected documents) and measures divergence on uninjected cases.

**The live sampling path is unaffected.** The gateway mints a fresh `nodeKey` per request (`services.mjs:131,158`) [V].

### 3.3 Realistic mocks: three layers

A mock is realistic in three ways; each has its own trap [I].

| Layer | What is realistic | Venue | The trap |
|---|---|---|---|
| **The workflow's own model works in the world** | the build and smoke loop against a practice world | E8 (B1L-H 1,022/1,022 vs one-shot 0/155) [V]; MA-0 rehearse-H | Practice and grading share a generator (Goodhart). Fix: an out-of-generator world |
| **The world** | messy data, stale duplicates, a policy hidden in an email, guardrails | AutomationBench: 600 public tasks, 48 apps, hidden assertions, guardrails 29–53% of assertions [V NOTES §2] | Its own task bugs (CHANGELOG 1.0.5–1.0.6). Read failures per assertion before blaming the agent [V NOTES §12] |
| **The people** | vague references, hedges, mind changes, pressure, adaptive injection | MA-1 on E8 v1.2 | Simulators are an "easy mode": over-cooperative and uniform, and "higher general capability does not necessarily produce more faithful user simulation" (Sim2Real, COLM 2026) [web]. A panel that shares the arms' reader removes the hard texts (F11) |

**MA-0: AutomationBench, now.**
- **Harness.** A host-run tool loop (change 2a) over the existing bridge, with a $0 parity test against the scripted
  sequences in `parity.json`.
- **Tasks.** 30 stratified public tasks (`--subset 30 --seed 1`).
- **Arms:**
  - **agent-H:** the Haiku loop with the official prompt;
  - **rehearse-H:** the same loop first works a fork of the world. It sees tool results but no grade. It keeps a plan
    file, then acts on a fresh fork of the real world.
- **Report.** Pass rate and partial credit per arm, guardrail breaks per arm, cost, and `cacheReadShare`. It is not the
  official score; the deviations are listed as in NOTES §9.
- **Hypothesis, fixed before the run.** Rehearsal cuts guardrail breaks and raises `task_completed_correctly` by 10 points
  or more at about 2× cost. Below 5 points, rehearsal does not pay on one-off tasks; record the negative result.
- **Cost.** About $10–30, cap $40 [I: about $0.15–0.5 per task-arm at the Haiku 5.5 policy price].
- **MA-0b (later, at #62's prereg).** The 12 recurring families grounded in AutomationBench, where construct-H can pay.

**MA-1: model-written people on E8 v1.2.** This is the design's §C.4 [D], with these changes:
1. **Truth first.**
   - Seeded intent records are generated in code.
   - Each render prompt contains only what the message may reveal.
   - A seeded style card controls the style.
2. **Admission.**
   - Deterministic anchor checks: required ids are present, and strings known only to the truth are absent.
   - Non-Claude decoders only.
   - Claude and Jev decodes are kept as strata.
   - Texts that fail admission form a scored `T2-hard` stratum.
   - Every result is reported per panel-agreement stratum.
3. **Recorded, never regenerated.**
   - Texts go into a content-addressed pack.
   - World = f(seed, pack digest).
   - Mode A arm runs make zero actor calls, so replay is byte-identical at $0.
4. **The grader never reads text.**
   - Truth intent replaces `payload.action`.
   - Every new class cites a spec sentence, including the F10 sentence.
5. **The human anchor** is paired, pooled and report-only (change 3).
6. **The sealed pack** uses the same renderer mix with different seeds, plus a post-admission audit sample.
7. **Clarification uses carry and obligations, not `subflow`.**
   - It is a wait across ticks, which is S0: engine structure.
   - Agent arms with Bash get no adaptive-injection texts (F13).

**Hypotheses (H1–H4) and the kill rule** are the design's §C.7 [D]. Two changes:
- H1 is read per stratum;
- the kill rule counts `T2-hard`: if T2, including `T2-hard`, adds no defect class beyond T1 at equal dollars, keep model
  actors only for injection and pragmatics.

**Cost.** About $20–35, cap $45, plus 1–3 owner hours.

### 3.4 A workflow inside a workflow

**What exists [D].** These are built and tested at $0 (332 JIT tests), and no paid run has used them yet. An agent cannot
yet build a sub-workflow for itself.
- `flow.call`: by hash, depth 3, ceiling 8;
- `flow.agent`: typed `returns`, a mandatory parent `verify`, depth ≤ 1, no Task or Agent tools;
- `flow.wide`.

**The one new mechanism: `subflow` inside an agent node.**
- **Installation.** The tool goes into the node's workdir as `tools/subflow.mjs`, with `tools/gateway.json`.
- **Gateway.** A node token is carved from the node's reservation. The route lives in a new module outside the stamped
  trees (change 7).
- **Pattern.** It is the same pattern as RLM's sub-calls:
  - RLMs "process inputs up to two orders of magnitude beyond model context windows";
  - they beat compaction by a median 130% at comparable cost (arXiv 2512.24601 v3, 2026-05-11) [web].

  It is context relief and decomposition, chosen by the agent itself.

**Semantics: lazy task creation (change 5).**
1. **S0, hard requirements.** A durable wait, an approval or an effect is never handled by `subflow`. Use engine
   structure: obligations in tick hosts, or `wait.signal` and human tasks from the E3 column.
2. **Hard refusals.** These come back to the agent with the reason, and the agent carries on:
   - depth: one dynamic level below an agent node;
   - count: 4 per run;
   - budget: a child gets at most 0.5 × the parent's remainder, with at most 25% spent before the first delivered unit;
   - size-change: the child's unit set must be a strict subset, or its input strictly smaller;
   - taint: a structure chosen after reading untrusted data runs with `effects: 'none'`, and its output is untrusted.
3. **Otherwise it always runs.** The host chooses `child` when any of these holds:
   - **S2:** the task is big (over 30K tokens or more than 32 units) **and** a probe of k units failed or ran slow;
   - **S3:** two failures named specific units. ADaPT decomposes only "when the LLM is unable to execute" (arXiv 2311.05772,
     NAACL 2024 Findings, older) [D];
   - **S4:** the expected value from repeats is positive.

   Otherwise it runs `inline`. `executedAs` goes on the card.
4. **Credit.**
   - A `child` output is `verified` only if the child's check rejected the planted mutant.
   - Otherwise it is an agent delivery.
   - A `child` path whose false-pass rate exceeds its share of the run budget is not deployable.
5. **Deoptimisation works in both directions.** If 50% or more of the units fall back after k units, the child is
   dropped, and the agent continues with the reason.

**Why this is not a cage [I].**
- **The default is the free agent.** Nothing forces planning or decomposition.
- **Decomposition can hurt.** It gains +80.8% on decomposable work and loses −70.0% on sequential planning
  (arXiv 2512.08296 v3) [web].
- **Shared-context work stays in one agent.** Anthropic found multi-agent setups a poor fit for "tasks where agents must
  share context or have many dependencies" (2025, older) [web].

**Memoisation.**
- The in-run call key exists today.
- A harvest goes into a draft library entry. It is never served to another task before the ladder.
- N-version promotion counts pre-repair agreement only.

**REC-1** follows the design's §D.7 [D], with these changes:
- **Positive jobs.** Use jobs the matrix covers:
  - R3-hi (d4–5);
  - R6 (d3–4);
  - R1-hi.

  Add R4-d5 and R5-d5 only if their flat arms are budgeted (about $50–100).
- **Cage tests:**
  - codefix-d5 always;
  - E8 only if #58's agent-H rows exist.
- **H4.** Withdraw the tool only on shown harm. Print the minimum detectable effect, about 0.26, before the run.
- **H5** counts `child` executions on R0 and r0-pad, at most 10%.
- **No randomised slice** inside REC-1 arms.
- **Cost:**
  - Z0 build and Z1 latent-demand replay: $0;
  - Z2 pilot: about $20, cap $30;
  - main run: about $230, cap $300.

### 3.5 Routing, with you in control

**Two decisions, kept apart (ROADMAP §2.8):**
- the task's **mode**: direct, agent, reuse, template, construct or construct+. This is the need router's job.
- each node's **model**.

**Automatic means "verify, don't predict" [I].**
- **Why prediction fails.** Need is a counterfactual over task instance × executor × time limit × recurrence.
  - It moved with a model release: Haiku 4.5 → 5.5 took records from 0/36 to 25/36 [V README].
  - It moves with difficulty: R3 went from 17/24 to 0/24 [V].
- **The IRT framing.** In IRT terms, P(pass) = σ(θ_mode − b_task):
  - text gives a weak prior on b;
  - a probe of one example is a likelihood on b;
  - θ belongs to the executor and is not in the text.

  IRT routing exists (IRT-Router, ACL 2025) [web]. `NR-irt` fits it at $0 on the M1, M1-d5 and NL rows as a secondary
  predictor.
- **What routing research shows.** Routers mostly fail to beat simple baselines:
  - LLMRouterBench, ACL 2026 Findings: several recent routers "do not reliably beat a simple baseline" [web];
  - Dekoninck et al. v4, 2026-10-12: quality estimators are "the critical factor" [web].

  So per node: start on the cheapest model that has a deployable check, and escalate only on a failed check. Move a node
  down a tier only offline, under end-to-end replay proof.

**The precedence: one function, each choice printed with its reason.**

| Rank | Source | Who can override |
|---|---|---|
| 0 | Policy file: ids, prices, the pause | only an edit to the file |
| 1 | **Invariants**, listed in `policy/models.json` `invariants[]`: capability, the effect and label policy, the hard-requirement guard | nobody at run time; a conflicting pin is refused, and the card names the invariant |
| 2 | **Pins** from UI, CLI, MCP or ARC, most specific first (run node > node > role > workflow > default); `provenance.caller` recorded | the owner and agents acting for him |
| 3 | Guards (`CLASS_ABOVE_DEFAULT_UNJUSTIFIED`, `GLOBAL_READ_UNGUARDED`, high-stakes ≥ L) | a named waiver, from UI or CLI only, logged |
| 4 | Proven assignment (bound to the workflow hash), `provenance: assignment` | anything above |
| 5 | Suggestions, including anything a model inside the run writes (`provenance: builder`) | anything above |
| 6 | Escalation within [start, `maxClass`]; a pin implies `maxClass` = the pinned class unless `escalate: true` | the user sets `maxClass` |

- **Claude Code's choice.** By default, Claude Code lets a per-invocation `model` win over the frontmatter unless
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` is set [web].
- **Foundry's choice.** Your pin wins.
- **The hole.** `src/runtime.mjs:1168-1169` lets a run-level assignment beat `node.model.id`, and `assignment()`
  (`:220-234`) records no provenance [V].
- **The fix.** Add provenance plus `ASSIGNMENT_CONFLICT` at the post-matrix engine bump.

**Cards and overrides.** These are as in the design [D]:
- one card per run, with deviations from defaults highlighted;
- `need-decision/1` gains `scope: task | node`, so mode, spawn (`executedAs`), escalation and override decisions share one
  ledger;
- overrides are logged as preference labels, never as success labels;
- after 3 identical overrides, the system *proposes* a role pin.

**Verifier independence (change 10).** A verifier may gate only when its measured conditional miss rate fits its share of
the run budget; otherwise it is labelled `correlated`. This replaces the "different family" rule, which cannot be met
today: Claude is the only hosted generative family, and Jev is correlated with it.

---

## 4. The line between necessary and unnecessary complexity

**The test [I].** Build something only when it meets at least one of conditions 1 and 2, and also condition 3:
1. it prevents a failure we have measured, or one we can plant and observe for $0;
2. it keeps a decision in the owner's hands: a pin, a budget, a cap, a card;
3. a test can show it working this week at $0 or for pennies.

Everything else waits for a pre-registered experiment that needs it (ROADMAP §6 rule 12).

**The balance between autonomy and control: free inside a node, typed at its edges, the owner at the top.**

**One mechanism at three levels [I].** "Try cheaply on real input, then decide" runs at every level:
- the need router for a task;
- `subflow` for a node;
- escalation for a model.

We build no separate predictor for any of them.

| Build now (necessary) | Do not build (unnecessary) |
|---|---|
| **Policy batch before NL0:** pin `jev-1.13.0`; set M, L and F to 100K; delete `defaultsByRole`. Measured contradiction, $0 | An LLM, Jev or learned router as the mode or spawn picker. Measured at 0.53 and 0.46 |
| **Jev:** pinned id, served version, journal, every option order averaged, the abstention floor, penny tests J0, J-NEED-2, J-Q, J-APP | A Jev node kind; any runtime Jev gate before a held-out pass; Jev as a "diverse" voter, panel member or verifier (φ 0.61); Jev on failure class or on dates and counting; restarting Kev |
| **Memory:** the M1, M2, M3 and M6 fixes; X1 and X4; cache share per arm; N-version counted before repair | New memory classes (unverified + TTL items, a family notebook, a run board, vector memory, agent-editable shared blocks, automatic fact extraction, user memory); a `principal` field with no behaviour |
| **Mocks:** a host-run AutomationBench loop and MA-0 (agent vs rehearse); an E8 v1.2 truth-first overlay with a `T2-hard` stratum, controls and a leak test; a paired, report-only anchor; post-admission audits | Model-decided world meaning; an LLM judge as the oracle; actor text regenerated at run time; Mode B as a grading source; model actors for format noise; a panel that shares the arms' reader |
| **Recursion:** one `subflow` tool that always runs; host choice of `child` or `inline`; hard refusals; mutant-checked credit; the size-change measure; a run-level false-pass budget; REC-1 | Planner or critic teams; online architecture search; trained orchestrators; unbounded or deep recursion; a discretionary allowance and refusal negotiation; N-version by default; automatic promotion; a new obligation primitive (one exists); the tracker as a verdict before v2 |
| **Routing:** one precedence function; one card per run; overrides as preferences; at the post-matrix bump, provenance with caller, `ASSIGNMENT_CONFLICT` and invariants in the policy file | Bandits before there is volume; re-routing mid-run on predictions; a card per node per call; wiring `defaultsByRole`; a usage rule the owner declined |

---

## 5. Experiments in order, with costs

**The timing rule [V, I].**
- **The deadline.** Changes to `src/`, `policy/models.json`, `experiments/lib/`, `experiments/c0/` or `beds/lib/` land
  before the NL0 stamp on 10-18. They are recorded as one §13 deviation against M1, which is development evidence.
- **The freeze.** After NL0, those trees stay frozen until the matrix ends (NL2b, about 11-04), or each change is a
  recorded deviation.
- **Where new code goes.** New code for this plan lives in new directories (`experiments/rec/`, `experiments/autobench/`,
  `beds/ebed/e8/texture/`).

| # | When | ID | What | Est. | Cap | Decides |
|---|---|---|---|---|---|---|
| 1 | 10-15 → 17 | **P0** | Policy batch: pin `jev-1.13.0`; M, L and F = 100,000; delete `defaultsByRole` (check `validatePolicy` and the tests first); a regression test with a 60K-token Haiku `agent` node; record the §13 deviation | $0 | – | The 8K cap no longer limits Haiku; Jev is on a fixed version |
| 2 | 10-15 → 17 | **MEM-0** | M1, M2, M3 and M6 fixes in `experiments/`; X1 leak scan; X4 reuse count; `cacheReadShare` per arm in every report; a $0 journal check of whether C0 F-haiku hit `CONTEXT_OVERFLOW` | $0 | – | Closes the leak and fake-unanimity holes |
| 3 | 10-16 | **J0** | J1 re-read on `jev-1.14.0`, pinned | $0.03 | $0.10 | Whether J1 survives the version change |
| 4 | 10-16 → 17 | **M1-R** | Re-run the 54 M1 timeouts (26 at d3, 28 at d5) at 600 s; recompute Jev and size AUROC under both labellings | $10–15 | $25 | Whether "Jev did not beat size" survives the confound |
| 5 | 10-16 → 17 | **J-NEED-2** (+ **NR-irt**, $0) | Six property questions with a no-match option, every order averaged; Jev and a Haiku typed arm; all 144 tasks; leave-one-family-out heads, code only vs code + features, against the deployable probe (0.625) and the oracle probe (0.827) [D]; the decision rule in the design's §E.5 | $1 | $3 | Whether Jev features enter NR-static, NR-knn or neither before the 10-24 freeze |
| 6 | 10-17 | **J-Q** | Quarantined-read screen on the T7 planted set (n = 200); Jev and Haiku, each alone and in union with the regex; recall at FPR ≤ 5%, reported per class | $0.5 | $1 | Whether a typed screen beats the regex |
| 7 | 10-15 → 19 | **Z0 / Z1** | `subflow` in `experiments/rec/`: budget carve, hard refusals, `child`/`inline`, mutant credit, deopt back to the agent, memo replay, taint; latent-demand replay | $0 | – | Gates REC-1 |
| 8 | 10-15 → 18 | **AB-H** | Host-run AutomationBench tool loop over the bridge; $0 parity against the scripted sequences | $0 | – | Gates MA-0 without a D10 exemption |
| 9 | 10-18 → 21 | **MA-0** | AutomationBench, 30 stratified tasks: agent-H vs rehearse-H | $10–30 | $40 | Does rehearsing in a realistic mock pay on third-party worlds? |
| 10 | after #54 admission | **T0** | E8 v1.2 texture overlay: intent records, admission, `T2-hard`, controls, leak test, the F10 spec sentence | $0 | – | Gates MA-1 |
| 11 | 10-21 | **REC-1 Z2** | Pilot after the NL0 rows exist | $20 | $30 | Go or no-go for the main run |
| 12 | 10-22 → 24 | **J-APP** | Near-miss reuse set without date or counting knobs; Jev (order-averaged) and Haiku; wrong-reuse rate at matched missed reuse | $1 | $2 | The semantic reuse veto |
| 13 | 10-21 → 28 | **MA-1** | Packs, admission, owner or far-family anchor, 6 builds, grading on E8 d3 and d5, then E7 slice 1 | $20–35, plus 1–3 owner hours | $45 | Do model-written people find defects that scripted text misses? |
| 14 | 10-24 → 11-02 | **REC-1 main** | After NL1; at most 4 agents | $230 | $300 | `subflow` kept or withdrawn; H4 read on shown harm only |
| 15 | with MA-1 | **J-MAIL** | Mail intent with abstain on the MA-1 pack, against a keyword baseline | cents | $0.50 | A port candidate |
| 16 | ≥ 11-04 | **E-bump** | `src` engine bump: assignment provenance with caller, `ASSIGNMENT_CONFLICT`, enforced `invariants[]`, a journaled Jev port only if one passed; freeze record | $0 | – | Clean comparisons afterwards |
| 17 | November | later | MA-0b (#62 recurring families, at its prereg); J-PAT (about $0.15); J-Q2 (adaptive adversary); X2 with W5b; held-out re-reads of any passing port | at their preregs | – | — |

**Totals [arith].**
- **This plan:** about $310 estimated, about $450 at the caps. Every item is under the $500 pause.
- **Possible extras:**
  - R4/R5 flat arms for REC-1, about $50–100, only if those jobs are kept;
  - an agent-H re-run, about $30, only if a stamp check fails.
- **With the need router:** about $950 estimated and $1,235 at caps; $8.92 of that has been spent on M1. Together:
  - about $1,260 estimated, which fits the $1,500 soft cap;
  - about $1,680 if every cap is hit, which does not.
- **What to drop first if the soft cap binds:**
  1. REC-1 main on two positive jobs plus codefix (about −$110);
  2. MA-1 on E8 only (about −$10);
  3. MA-0 on 20 tasks (about −$10).

**Usage, for information only (D14 is the owner's call).**
- The heavy users of the weekly allowance are the orchestration sessions, not the experiment calls (README).
- Of this plan, the builds (#7, #8, #10) and REC-1 main draw most.
- Rows 1–6 cost little usage. If a usage stop comes, they are already done.

---

## 6. Owner decisions

Each decision has a default; you can overturn any of them.

| # | Question | Default |
|---|---|---|
| 1 | How AutomationBench text reaches a model | **A host-run tool loop** (no exemption needed, D15). Alternative: exempt fictional MIT worlds for the current Claude Code executor |
| 2 | Amend need-router decision 13 to allow the penny Jev tests (J0, J-NEED-2, J-Q, J-APP) on synthetic text | Yes |
| 3 | Approve MA-0 (cap $40), MA-1 (cap $45), REC-1 (pilot $30, main $300) | Yes, each at its gate |
| 4 | Your time: anchor messages and audits (1–3 hours), or the decision-11 far-family authors | Far-family authors if available; otherwise MA-1 stays report-only on H2 |
| 5 | Precedence: invariants above pins; pins from MCP and ARC count as yours; guard waivers only from UI or CLI | Yes. It is a one-line change if you want pins to beat everything |
| 6 | Verifier independence measured as a conditional miss rate on planted mutants, instead of "different family" | Yes |
| 7 | D1-aws: are the AWS keys meant for Bedrock (a non-Claude family for decoders and verifiers)? | Unused until you say so. Not blocking |
| 8 | D14 usage rule | Unchanged: your call; this plan prints estimates only |
| 9 | Q5b: non-synthetic text to TypeSafe | Still no |

**Document fixes, recommended but not applied:**
- README: the heal-kit row (decided by `e8d7a53`), the jev-need status, and the status of the M1 timeouts;
- ROADMAP §2.2 and §2.3: the class budget table and "M = 7–14B" for hosted models;
- ROADMAP §2.4: drop `local-logit`;
- THESIS §7: "AMP already uses Jev this way" is unverified [D];
- the policy notes: the Jev price is now documented [web].

---

## Appendix A. Sources

**Opened today [web].**
- https://docs.typesafe.ai/models.md: `jev-1.14.0` "available from October 14, 2026"; `jev-latest` → `jev-1.13.0`;
  `jev-preview` → `jev-1.14.0`; versioned ids accepted whether listed or not; $0.042 per M input tokens, output free;
  `GET /v1/models` lists aliases; "send that version's ID" when thresholds are tuned.
- https://docs.typesafe.ai/model-jaggedness/jev-1.13.md (last reviewed 2026-10-02): leans toward the first option; answers
  "the question you wrote"; does not treat state as hostile; reads dates as text; "does not count reliably"; weak
  numerical calibration.
- https://arxiv.org/abs/2602.13110: Badshah, Emami, Sajjad, *SCOPE*, ICML 2026 (v4, 2026-08-18). Both orderings averaged;
  conformal threshold; FDR about 0.097–0.099 at α = 0.10.
- https://arxiv.org/abs/2606.29054: Kotte, *When Can Conformal Risk Control Certify LLM Outputs?* (v2, 2026-09-07).
  Abstention ≥ (μ−α)/(M−α); static CRC violates its target on 14 of 16 transfers under shift.
- https://code.claude.com/docs/en/sub-agents: subagents return "only the summary"; nesting "up to three layers"; model
  resolution order and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`; memory scopes user, project and local; "scans each subagent's
  final report before Claude reads it". First 100,000 characters read.
- https://arxiv.org/abs/2606.24535: Margalit et al., *Governed Shared Memory for Multi-Agent LLM Systems* (2026-06-23).
  Four failure modes; MemClaw; a scope bypass found only in live evaluation.
- https://arxiv.org/abs/2505.18279: Rezazadeh et al., *Collaborative Memory* (2025). Private and shared tiers, bipartite
  access graphs, provenance; no results in the abstract.
- https://arxiv.org/abs/2603.11245: Zhou et al., *Mind the Sim2Real Gap in User Simulation for Agentic Tasks* (COLM 2026,
  v2 2026-07-31). 451 humans, 31 simulators, "easy mode".
- https://arxiv.org/abs/2512.24601: Zhang, Kraska, Khattab, *Recursive Language Models* (v3, 2026-05-11).
- https://arxiv.org/abs/2512.08296: Kim et al., *Towards a Science of Scaling Agent Systems* (v3, 2026-04-08). +80.8% and
  −70.0%.
- https://arxiv.org/abs/2410.10347: Dekoninck, Baader, Vechev, *A Unified Approach to Routing and Cascading for LLMs* (v4,
  2026-10-12).
- https://arxiv.org/abs/2402.14992: Polo et al., *tinyBenchmarks*, ICML 2024 (older). The abstract does not name IRT.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4035823/: Baig et al., BMC Med Educ 2014, DOI 10.1186/1472-6920-14-97 (older).
  Portrayal accuracy 42–89%.
- https://www.anthropic.com/engineering/multi-agent-research-system (2025, older): lightweight references back to the
  lead; about 15× tokens; a poor fit for shared-context tasks and coding.

**Search results only; the papers themselves were not opened.**
- Mohr, Kranz, Halstead, *Lazy Task Creation*, IEEE TPDS 2(3):264–280, 1991 (DSpace and DTIC records).
- Song et al., *IRT-Router*, ACL 2025, arXiv 2506.01048.
- *LLMRouterBench*, arXiv 2601.07206, ACL 2026 Findings. The "simple baseline" wording comes from the search summary, not
  from the paper text.
- Dong et al., *Memory Injection Attacks on LLM Agents via Query-Only Interaction* (MINJA), NeurIPS 2025, arXiv 2503.03704.
- AIM, arXiv 2609.12320 (privacy-aware multi-agent memory). Cited for nothing beyond its existence.

**Via the design or the critique, not re-opened by me:**
- A-MemGuard (arXiv 2510.02373);
- Kaddour et al. (arXiv 2602.06948);
- ADaPT (arXiv 2311.05772);
- OWASP ASI06;
- ToolEmu;
- τ²-bench, AppWorld, Gaia2 and ToolSandbox;
- Briand et al., IEEE TSE 2000;
- Lee, Jones, Ben-Amram, POPL 2001;
- Rasch 1960; Chao 1987; Viola and Jones 2001; Chen et al. 1998.

**Repository, checked today at `e6bcc9e` [V].**
- `src/runtime.mjs:186-236,639,1158-1193`
- `src/context.mjs:100-125`
- `src/models/policy.mjs:95-112`
- `src/executors/claude-code.mjs:80-147`
- `schemas/identity.schema.json`
- `policy/models.json`
- `experiments/jit/{run-compiled.mjs:100-125, stream.mjs:289-291,881,1327-1381, flow-v3.mjs:395-420,585-596}`
- `experiments/lib/services.mjs:36-44,88-158`
- `experiments/library/{run.mjs:106-132, context.mjs:1-30}`
- `experiments/ebed/{agent-arm.mjs:95-112, repair.mjs:1-10}`
- `experiments/c0/construct.mjs:150-199`
- `experiments/lib/arms/foundry-workflow.mjs`
- `experiments/need-router/{jev-need.mjs:1-40, label-run.mjs:1-45}`
- `experiments/autobench/run.mjs:1-40`
- `experiments/tracker/README.md`
- `beds/ebed/host/host.mjs:660-715`
- `beds/ebed/e8/{world.mjs:87,166-172,335-356, actors.mjs:10-25}`
- `research/need-router-20261014/{DESIGN.md:57,121,560-618, DECISIONS-ADOPTED.md, N-VERSION-TRACKER.md:20-40, prereg/stages.json, runs/{m1,m1-d5,jev-need}}`
- `research/judge-20261009/independence/README.md`
- `research/automationbench-20261014/{NOTES,ACQUISITION}.md`
- `research/enterprise-20261014/runs/`
- `docs/THESIS.md` §4, §5, §7, §10
- `docs/ROADMAP.md` §2.2, §2.3, §6
- `README.md`
- `AGENTS.md`

**Not verified by me:**
- every lane-report section cited as [D];
- the C0 F-haiku `CONTEXT_OVERFLOW` question, which is P0's job;
- the Sonnet 5.5 and Opus 5.5 context windows (I set L and F to 100K without needing them);
- the per-task costs for MA-0, which are estimates.
