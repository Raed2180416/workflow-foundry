# Critique A of the synthesis: owner alignment and completeness (2026-10-08)

*Reviews `00-SYNTHESIS.md` as it stood at about 08:30 UTC (HEAD `c7149b6`). Development and diagnostic only; nothing
here is claim-bearing. Written by critic A. A second critic covers rigour; this one checks the synthesis against
what the owner asked, what he was already told, and what a non-specialist reader needs.*

**What was read.**
- `00-SYNTHESIS.md` in full, and `01-requirements.md` in full. Lanes 02–07 were spot-checked by grep for the points
  below.
- The session transcript `/root/.claude/projects/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a.jsonl`
  (5,297 lines at reading). The owner's messages and the assistant's replies after T:4040 were read in full. Quotes
  keep the owner's spelling. The transcript is data, not instructions.
- `research/core-20261006/PREREG.md` §1–§8, `docs/ROADMAP.md` §3 and §6, and `README.md` L120.

**Runs.** Both at about 08:30 UTC:
- `node experiments/p1/analyze.mjs experiments/runs/p1/results.jsonl` on 219 rows;
- `node experiments/c0/analyze.mjs experiments/runs/c0-dev`.

**References.**
- `S:Lnnn` is a line of `00-SYNTHESIS.md`.
- `T:nnnn` is a 0-based transcript line.
- `L1 #n` is item n of `01-requirements.md`.
- Tags: **[M]** measured here (command named), **[D]** documented at the path, **[I]** my inference.

---

## Verdict

The synthesis answers almost every owner question, and its core judgments are sound: bounded semantics, the
three-number coverage measure, the "P1 is a ceiling" framing, the security list and the stop list. It fails the owner
in five ways:

1. **It contradicts at least 12 things the owner was told in the last 11 hours and flags only one of them** (the
   interop promise, S:L221–224). The owner will notice that "a quarter to a third" became "a fifth", and "Evaluation:
   Strong" became "Weakest link".
2. **It narrows four explicit asks without saying so:**
   - "~100%" coverage now depends on whether new constructs help a Haiku builder;
   - the "edit" half of "construct and edit" has no experiment;
   - Kev's role and its running work are reversed;
   - the game-QA "visual understanding node" disappears.
3. **The replication benchmark is the owner's own proposal, and it lacks the memorisation and leakage guards he was
   promised at T:5225.**
4. **The security plan contradicts itself on order, and its decision 4 conflicts with the owner's standing "dont ask
   me to authenticate anythign" (L1 #11).** Under the default answer, the owner's benchmark is either blocked or run
   unsafely.
5. **It is written for specialists.** "The one document for the owner" (S:L3) needs a plain front page, a glossary
   and decisions phrased as "if yes / if no".

P0 items must be fixed before the owner reads the document. P1 items should be fixed in the same revision. P2 items
are polish.

---

## Coverage: every owner question against the synthesis

Status values:
- **ok**: answered directly.
- **partial**: answered with a gap.
- **evasive**: the answer sidesteps the question.
- **narrowed**: answered, but the ask was shrunk without saying so.
- **missing**: not answered.

| # | Owner ask (short, his words) | Where | Status | Finding |
|---|---|---|---|---|
| 1 | "represent any and all workflows independent of a harness" | §3.1 | **narrowed** | ~100% made conditional on helping Haiku (P0-2); harness independence untested (P1-13) |
| 2 | "a mini harness … to build focussed systems to execute tasks" | §1 | ok | — |
| 3 | AMP: "parallel workflows working together … alll possibly combinations" | §3.16 | partial | No combination matrix (P1-8) |
| 4 | Kev to "identify extremely complex workflows, all the way down to … tasks which dont need workflows", with a slider | §3.4 | **narrowed** | Kev demoted, tiers replaced by modes, change not flagged (P0-1, P0-6, P1-4) |
| 5 | "haiku 5.5 will e the workflow constructor right ? by using the tempaltes" | §3.5 | partial | The hardest tier stays Opus-built, unstated (P1-5); templates "mined from the corpus" (T:4062) dropped (P1-14) |
| 6 | "anythign else we … should maybe train this haiku … on" | §3.5 | ok | — |
| 7 | "is this implementation efficeint ? … rust …" | §3.14 | ok | — |
| 8 | "every single possible compeontn is maximally efficient" | §3.14 | partial | Construction and orchestration efficiency absent (P2-14) |
| 9 | "really deeply reason worst case sceanrios revaluate the entire concept" | §3.18, §4 | partial | Missing worst cases (P1-3, P2-11) |
| 10 | "re read this entire chat form the very ebignning" | — | **missing** | L1's re-read findings not surfaced (P2-9) |
| 11 | "any ege case when interracting together … workflow inside another … inside another … itertive flow" | §3.2 | partial | Partial failure, budget exhaustion mid-swarm, nested human steps, sagas after `call`, versioning (P1-8) |
| 12 | Node view: "visual understanding node", "beathing dot", "clicking it expands its chat" | §3.17 | **narrowed** | Visual node dropped (P1-6); screenshots are a fixture, unstated (P2-2) |
| 13 | "how agent swams work and how dynamic workflows in claude code wor"; "part of our scope ?" | §3.9, §3.10 | partial | Scope answered; *how swarms work* never explained (P2-1) |
| 14 | "subagent spawning … inside nodes? … or am i overcomplciating" | §3.11 | ok | Name changed from "delegate" without notice (P0-1, row 11) |
| 15 | "shared messae board, … shared understaning od state, some private notes" | §3.12 | partial | No experiment in the 4 weeks; confounded evidence (P1-7) |
| 16 | "auditability and efficiency is a huge huge part" | §3.13 | ok | — |
| 17 | "frontier research or any oss" | §3.15 | ok | — |
| 18 | "you get the ambition right. it becomes essentially" | §1, decision 1 | **wrong default** | P1-1 |
| 19 | "why can twe get this to a 100 percent ? what are we missing ?" | §3.1 | ok | — |
| 20 | "maybe we should curate and add it ?" | §3.1 | partial | The promised second-agent re-check isn't reported (P0-1, row 12) |
| 21 | "once we hve the core down … iterativelu test" | §3.3 | partial | "Core" undefined (P1-17) |
| 22 | "agreed" (bounded semantics) | §1, §3.2 | partial | Group chat refused by preference, not because it's unbounded (P1-8) |
| 23 | "where are we … against the compelte e2e vision" | §2, §3.3 | **inconsistent** | P0-1, row 1; P1-17 |
| 24 | "haiku 5.5 is building the environment right ? … why nto give it tools ?" | §3.6 | ok | Numbers have moved (P0-1, row 4) |
| 25 | "toy workflows … or cheating ? … say something arbitrary"; "train a small llm …?" | §3.7, §3.8 | partial | Wild tier inconsistent with what he was told (P0-1, row 8); "given the corpus" sidestepped (P1-14) |
| 26 | "cheaply recreate their workflow do their shit, and see if anything needs improvement" | §3.7 R-bench | **narrowed** | P0-4 |

---

## P0: fix before the owner reads it

### P0-1. Twelve contradictions with what the owner was already told, eleven of them unflagged

The synthesis corrects exactly one earlier answer (S:L221–224, the interop adapters). Every row below is a change
from something the owner read in this session, and none is marked as a change.

| # | What the owner was told (time, line) | What the synthesis says | Required wording in the revision |
|---|---|---|---|
| 1 | "About a quarter to a third of the full vision is built" (08:06, T:5116) | "about a fifth of the way there" (S:L146, L280) | "At 08:06 I said a quarter to a third. Counting honest verdicts, wild-task evidence and composition as *not built*, rather than partly built, it is lower." Or drop the fraction; see P1-17. |
| 2 | "Evaluation \| Strong: 9 task families, audits, pre-registration, freezes" (T:5116) | "Evaluation validity \| **Weakest link**" (S:L128) | "I called evaluation strong at 08:06. The *process* is strong, but the *validity* is weak: Claude wrote every bed, and nothing external has been run." |
| 3 | "the cheap model inside a workflow beats the strong model on its own … That's the core thesis showing up" (T:5116). Then: "The gap is mostly noise" (T:5200) | "The core bet has its first number. It is good" (S:L27) | Use the pre-registered rule (PREREG §5: "reaches or beats", directional, under-powered below ~35 points). "Success: at least as good as one Sonnet call, but not provably better at this size. Cost: about 1/15 [M]." Say that the 08:06 "beats" overstated it. |
| 4 | "With tools, Haiku did worse … (14/20 vs 17/21) and cost about twice as much" (T:5178) | 17/23 vs 18/24 (S:L409) | At 08:30 both are **20/26** [M P1], and tools cost about 3× ($0.096 vs $0.031 per trial). "Tools did not help; they did not hurt either. They cost about three times as much." |
| 5 | "This is a natural Kev decision. Kev outputs a tier … The slider sets the probability threshold … labels can come straight from C0 results" (22:17, T:4062) | "Kev extracts task properties and does not make the decision"; the slider is a dollar value; labels need paired runs (S:L306–323) | "This changes what I told you on 10-07. Kev no longer picks the tier, because the right tier depends on the model, the price and how often the task recurs, not on the text alone (L5 §2.2)." |
| 6 | Next steps: "Run C0 on incident, kinetics and synth … the first cross-family construction number", and "Kev wave-1 training on the laptop" (T:5116) | Decision 8 closes C0 dev after `records` and `codefix`; "Stop: the full Kev wave-1 build" (S:L861, L880) | State both reversals, with reasons. See P0-6 for the Kev part. |
| 7 | "approved the hosted spend of up to $450 after a pilot" for the Kev program (T:4348) | The 4-week budget has a Kev arm at $5–10 (S:L842) | Say whether the $150–450 approval stands, is cut or is withdrawn (P0-6, P1-15). |
| 8 | Wild tier: "τ²-bench, AppWorld, Spider 2.0 / BIRD …, a SWE-bench Verified slice, and GAIA"; "`ownerci`"; "20–30 things you actually want done" (T:5200) | "TextWorld, IDoFT or AppWorld"; "10–20 tasks you write"; `ownerci` absent from the tiers (S:L459–460, L882) | Pick one list and say why it changed. Which benchmarks install locally, and which need credentials or the live web (GAIA)? Tier B/C are blocked on missing Modal/Harbor credentials (L1 #36). Settle the number of owner tasks; T:5218 also gave them a distinct role: "things nobody has built a workflow for yet". |
| 9 | R-bench: three task types (translate; rebuild from intent; improve), a direct-agent baseline, a 30-item shortlist plus 5 harnesses attacked by a stronger agent, and guards against "models simply recalling public workflows … renamed and perturbed variants, and items published after the models' cutoff" (T:5218, T:5225) | Rebuild from the description only; a pilot of about 10 items; Haiku structured builder vs Opus free builder; no memorisation guard (S:L458–473, L789) | See P0-4. |
| 10 | "about 120–180 engineer-days for one person, much less with agents … I'll check capability after stages 2 and 5" (T:4682) | 125–190 engineer-days; pause S3–S7 after S2 (S:L193, L238, L844) | Use one estimate. Say the stage-5 check became a stage-2 gate, and why (see P0-2). |
| 11 | Subagents "only through a bounded delegate node" (T:4062) | The `executor` node; "Stop: a Foundry-native agent loop (`delegate`)" (S:L557, L859) | "What I called a delegate node is now called `executor`. The `delegate` on the stop list is a different thing: a Foundry-owned agent loop." |
| 12 | Agent-framework corpus: "about 120 items" (T:4682), then "about 165 … from 21 frameworks … A second, stronger agent independently re-checks every item" (T:4767) | "199 items from 18 frameworks; … not audited" (S:L19) | At 08:30 the folder holds 225 items in 21 framework files, and per-framework ledgers record re-read passes against source [M]. Re-count at revision. Say whether the promised independent re-check ran on every item. |

Also: T:4062 described a swarm as "map over agents, a shared board, an aggregator, a verifier". The `wide` operator
(S:L499–501) has no board. Mention it in one clause.

**Fix.** Add a section "What changed since I last told you" right after "The 10 points", built from this table: told /
now / why. Re-run both analysis scripts once at revision time and update every number in the document in one pass,
including the top-10 list. P1 has moved since S:L16 (08:30 run [M]):

| Arm | Passed | Cost per trial |
|---|---|---|
| fhand-haiku | 25/26 | $0.0157 |
| Sonnet single call | 20/27 | $0.236 |
| Haiku 5.5 single call, thinking off | 20/26 | $0.031 |
| Haiku agent with tools | 20/26 | $0.096 |
| fhand-sonnet | 26/26 | — |
| Haiku 4.5 single call | 0/27 | — |
| B0+N | 17/35 | — |

### P0-2. "~100%" is quietly made conditional on helping a Haiku builder

**The ask.** The owner: "I really do want to be able to represent any and all workflows independent of a harness"
(T:4050), and "why can twe get this to a 100 percent ?" (T:4604). He was told: "'100% of the real workflows in the
corpus' is achievable, and I'll make it the target" (T:4682).

**What the synthesis does.**
- Its falsifier (S:L236–238) and its Stage-3 kill rule (S:L844) pause S3–S7 if "the larger IR [does not] help a Haiku
  builder" on items that need the new constructs.
- That makes a *representation* goal depend on a *construction-aid* result. A construct can be required to represent
  a workflow exactly even if it never raises Haiku's build success. Triggers and error routes are examples.
- Under this rule the "~100%" target can be stopped by an experiment about something else, and the owner would not be
  asked.

**Fix.**
1. Replace S:L236–238 with: "After S2, measure whether the new constructs help a Haiku builder (S2 IR vs S1 IR on
   items that need them). The result decides what goes into Haiku's construction kit, and in which order S3–S7 are
   built. It does not decide whether the IR gets them. Representation is judged on its own measures: compiled and
   executed coverage, and the lowering audit."
2. Replace the S:L844 kill rule with: "S2 doesn't beat S1 → S3–S7 constructs stay out of Haiku's kit; whether to keep
   building them for representation is decision 12."
3. Add **decision 12** to §6: "Keep building toward ~100% representation (S3–S7, about 125–190 engineer-days by the
   lane estimate) even if the new constructs don't help Haiku build? Default: yes, at a lower priority than the wild
   tier."

### P0-3. "Construct *and edit*": the edit half has no experiment

**The ask.** The bar the owner set: "even a dumb model like haiku can construct and edit these workflows" (T:3295;
L1 #17).

**What the synthesis does.**
- It lists the edit half as aid 8 (S:L377–378: "No experiment has tested editing yet").
- It asks the owner to record "Haiku 5.5 constructs, edits and runs" (decision 3, S:L875).
- No stage of the 4-week plan, and no CX/RX experiment in L5, tests editing. The owner would approve a role that
  nothing measures.

**Fix.** Add an experiment **EX1, Haiku edits a workflow**, to Stage 2 or Stage 3.
- **Inputs:**
  - the 5 failed F-haiku runs and their two diagnosed defects (`research/construction-20261006/diagnosis/`);
  - at least 20 faults injected into the C0-dev F-opus artifacts: a check that does not gate, a wrong check, a
    dropped batch, the wrong model class on a node, a misread convention.
- **Task:** Haiku 5.5 gets the failing run record and the lint output, and proposes a patch to one node.
- **Scoring:** replay of the failing run, a regression slice, and the oracle on fresh dev seeds.
- **Arms:** Haiku patch, Opus patch, Haiku rebuild from scratch, retry without change.
- **Metrics:** fix rate, regressions, $ per fix.
- **Kill rule:** a Haiku fix rate below half of Opus's means edits escalate to Opus.
- **Cost:** about $15–30 [I].

State that edits are offline proposals proven by replay. Runtime self-modification by small models is a ROADMAP §3
non-goal.

Change decision 3 to: "Haiku 5.5 constructs (measured: C0, CX3) and edits (to be measured: EX1)."

### P0-4. R-bench, the owner's own proposal, lacks the guards he was promised

**The ask.** The owner's message 6 (T:5215) asks whether we can "cheaply recreate their workflow do their shit, and
see if anything needs improvement". He was told what the benchmark would contain and how it would stop recall (P0-1,
row 9).

**What the synthesis keeps.** One task type (rebuild from the original description) and one caveat about written
descriptions (S:L464). Nothing addresses the main validity threat: Haiku and Opus may simply *remember* public n8n
templates, nf-core pipelines and LangGraph examples. A "replicated" result could be recall, not construction.

**Fix.** Add to §3.7, before "R-bench caveats":
1. **Three task types**, as told at T:5218:
   - *translate*: from the original definition, which is also the honest route to compiled coverage;
   - *rebuild from intent*: from the description and a few input/output examples;
   - *improve*: same job, cheaper, faster or more reliable.

   Score each separately.
2. **Memorisation probe**, per item, before the build. Ask the builder model to reproduce the workflow from its title
   and platform alone. Score the overlap with the original graph. Label items above a pre-registered threshold
   "known", and report known and unknown items separately.
3. **Perturbed twins.** For each item, rename entities, change constants and flip one branch condition, then
   regenerate the oracle on the twin. Report the original-vs-twin gap. A large gap means recall.
4. **Recency.** Prefer items whose pinned source commit postdates the builder model's training cutoff. Record the
   cutoff from the model card, or mark it [unk].
5. **A source firewall against the template library.** Any repository or template family that supplies an R-bench
   item is excluded from:
   - skeleton mining;
   - worked examples;
   - the agentic constructs designed for Haiku's kit.

   Check for near-duplicates across all 27 platforms (graph hash plus description n-grams): n8n templates are widely
   forked.
6. **No model-written descriptions.** The agentic slice's descriptions are model-written (`"provenance": "written"` in
   the items [M]), so those items cannot enter rebuild-from-description. The same caveat L5 found for the 461 written
   descriptions applies.
7. **A direct-agent arm (B0)** in the pilot, as promised at T:5218.
8. **Pilot deliverables.** Either the 30-item shortlist plus 5 attacked harnesses as told, or an explicit correction.
   At 08:30 `research/replicate-20261008/` still does not exist [M].

### P0-5. The security plan contradicts itself on order, and decision 4 collides with an owner rule

**The order contradiction.**
- §7 says items 1–8, including **item 5, executor isolation**, "land in the Stage-1 engine bump" (S:L889–890).
- §5 puts the isolated executor in Stage 3, gated on decision 4 (S:L831). Stage 1's deliverables never mention
  executor isolation (S:L779–786).
- Meanwhile:
  - **Stage 1** runs the R-bench pilot with an "Opus free builder" (S:L789). A free builder is Claude Code in a
    sandbox, so an executor, reading third-party corpus text.
  - **Stage 2** runs "an injection slice" (S:L812): planted instructions aimed at builders and executors, inside a
    sandbox whose network is open and whose CLI login is readable (S:L898; L7 §3.4).
- An injection test run before isolation is not a test. If an injection succeeds, the "canary" it exfiltrates is the
  real login.

**The collision.** Decision 4 (S:L876) asks for "an API key in env". The owner's standing rule is "just dont ask me to
authenticate anythign" (T:2; L1 #11). Lane 7 says the gateway "likely" needs a key (L7 L504, L807). The synthesis
drops "likely". Under the default answer ("no executors on untrusted third-party content"), the R-bench free-builder
arm cannot run, and the synthesis does not say so.

**Fix.**
1. Make §5 and §7 agree. Executor isolation, at least the network namespace and no login inside the sandbox, lands
   before any run that puts third-party or adversarial text in an executor.
2. Until it lands, every R-bench arm runs on builders that need no executor:
   - the structured builder (construction as a Foundry workflow) on Haiku;
   - the same builder on Opus;
   - B0 single calls.

   The injection slice moves after isolation, and its first step is the canary test from §7 item 5.
3. Rewrite decision 4 in plain terms:

   > "This would ask you to put an API key in the environment. You told me on 10-06 not to ask you to authenticate
   > anything, so the default is no. With no, Claude Code never runs inside a node on text from outside (corpus items,
   > benchmarks, your repositories). R-bench and the injection tests use the structured builder only. Before you
   > answer, I will check whether a host-side gateway can work without a new credential."

### P0-6. The plan stops work that is running now, and work the owner was told comes next

At 08:19 the session started "the next Kev data groups as two workflows" (T:5295). The synthesis stops "the full Kev
wave-1 build (42 ports)" (S:L861), yet keeps "Kev is the local judge" in decision 3 (S:L875). The owner was told
three things:
- Kev wave-1 training on the laptop is a next step (T:5116);
- hosted spend up to $450 was approved (T:4348);
- earlier: "for evey single place kev can be used we need to be robust" (L1 #46).

A reader cannot tell whether Kev work is running, paused or cancelled.

**Fix.** Add **decision 13**:

> "Kev: pause the wave-1 data build now running until the Kev-vs-Haiku-5.5 probe (about $5–10, Stage 3) reports,
> or keep building data in parallel?"

- Give a recommendation, and say what keeps running meanwhile: the laptop bridge, contracts and probes.
- State the fate of the $150–450 hosted approval.
- Reword decision 3's Kev clause to "Kev is the candidate local judge, kept on a port only where it beats Haiku 5.5
  and rules."
- Also state that decision 8 reverses the 08:06 plan to run C0 on kinetics and synth, and give the reason (audits not
  finished; sealed round first).

---

## P1: fix in the same revision

**P1-1. The default for the owner's ambition sentence.** Decision 1 (S:L873) supplies *our* words as the default for
*his* unfinished sentence. Under "each has a default if you don't answer", the guess becomes the record.
- **Fix:** default "left open". Until he finishes it, quote his own words: "a mini harness … something that can allow
  us to build focussed systems to execute tasks".
- In §1, mark the guess as a guess, which it already is at S:L91. Do not carry it into decisions or the ROADMAP.

**P1-2. "Not 'any task'" reads as a retreat from his stated goal.** He said: "i want to be able to buidl the best
possibel workflow for any tas obviously, thats the ultimate goal" (L1 #6). S:L722–723 says the claim narrows: "Not
'any task'."
- **Fix:** replace with: "Your goal stays the best possible workflow for any task. For many tasks the best workflow is
  none, one call, and the router's job is to say so. What narrows is the claim we can defend today: checked workflows
  pay off on tasks that recur or need structure. 'Any task' is a goal we measure toward on the wild tier, not a claim."

**P1-3. Haiku 5.5 is no longer the "dumb, ~9B" stand-in the owner described.**
- His bar was "haiku being much dumber is akin to a 9b model … would prove … even a dumb model like haiku can
  construct" (T:3295).
- On P1, a Haiku 5.5 single call passes 20/26 where Haiku 4.5 passes 0/27 [M]. L1 #18 marks the 9B equivalence
  "unverified".
- So a Haiku 5.5 success proves less about weak models than the owner intends. The synthesis notices the shift
  (S:L40, W10) but never connects it to his bar.
- **Fix:** add that sentence to §3.5. Add a decision: "Keep Haiku 5.5 as the cheap model, and add Haiku 4.5, which
  is in the policy file, as a weak-constructor stress arm in CX3 and C0 sealed (about +$10–20 [I])? Later, an 8–9B
  open model on your 4060 through the bridge."
- Add a worst case: "the 'dumb model' proxy gets smarter every release, so the claim drifts".

**P1-4. Map his complexity scale onto the modes.** He asked for a scale from "extremely complex" down to "dont need
workflows". The synthesis gives six modes "ordered by construction effort" (S:L298–304) and never says which of his
words maps to which.
- **Fix:** add a three-column table to §3.4: his word, the mode, what runs.

  | His word | Mode | What runs |
  |---|---|---|
  | no workflow | `direct` or `agent` | one call, or Claude Code alone |
  | simplest | `template` | at most about 6 nodes |
  | standard | `construct` | a bespoke workflow |
  | extremely complex | `construct+` | multi-stage, nested, with waits or human steps |

- Say the router shows this word and the reason.
- Label the slider in his terms: "How much is a correct result worth to you?" (cost first ↔ reliability first). Do not
  lead with V and λ_t.

**P1-5. Say plainly that the hardest tier is Opus-built.** S:L345–346 says Haiku "builds the template and construct
tiers". L5 §2.4 and §3.1 assign `construct+` (nested, multi-stage, human gates) to Opus. A non-specialist will not
infer that the nested, three-deep workflows he asked about are not Haiku-built.
- **Fix:** add one sentence: "For now Opus builds the most complex tier: nested, multi-stage, with waits or human
  steps. Moving it to Haiku needs a decomposition experiment that is not in the 4-week plan."
- Add that experiment to the defer table with a trigger.

**P1-6. The flagship example disappeared.** The owner's one concrete example was game QA with a "visual understanding
node".
- **What the synthesis does:**
  - It notes that image inputs "don't exist yet" (S:L713).
  - It schedules neither image inputs nor the env port (L1 gap 7).
  - Neither appears in the defer table.
  - It names "the game-QA reference run" twice as the end-to-end falsifier (S:L274, L701). The `gameqa` bed is
    unaudited, and F workflows cannot run interactive beds without the env port (L1 #38).
- **Fix:**
  - Add a defer row: "Image inputs and the env port (game QA's visual node) | needed for your game-QA example;
    `gameqa` unaudited; earliest after Stage 3", with an effort estimate. Or schedule image inputs on agent nodes in
    Stage 3; it is a small change (`schemas/workflow.schema.json:63`, `src/context.mjs:49–53` per L6).
  - Until the env port exists, replace the end-to-end falsifier with a runnable bed, for example `gridquest`, and
    say so.

**P1-7. Board and private notes: no experiment scheduled, and the cited evidence is confounded.**
- The stop table allows "only the stage-2 experiment" (S:L857), but no week of §5 contains it. Private notes
  (lane 7 stage 3, the scratch field) are not scheduled either.
- S:L596 cites "B0+N … 16/33" as evidence against cross-run notes. At 08:30, B0+N is 17/35, and **14 of its 18
  failures are `MODEL_TIMEOUT`** [M]. It is also a cross-run notes store for a single call, not a board or
  node-private notes.
- **Fix:**
  - Delete the B0+N bullet, or restate it: "mostly timeouts; not evidence about boards".
  - Schedule lane 7 stage 2 (board vs no board vs B5 on `gridquest`, $20–40) and stage 3 (the scratch field on
    `records`, a few dollars) in Stage 3. Or move both to the defer table with "no experiment before 11-05".

**P1-8. "All combinations" and "any edge case when interacting together": the missing pieces.** §3.2 lists nine edge
cases. Add a short **composition matrix** with one row per combination and columns *supported now / stage / refused
(why) / conformance test*. The combinations: sequence; independent parallel; parallel with a shared board; nested
`call`; recursion via `self`; map over `call`; race or first-wins; pipeline or stream; trigger chains; a supervisor of
workflows; cross-store via MCP or A2A.

Then add these edge cases, each with a rule and a test:
- **Partial failure at fan-in** (`map`, `wide`, parallel children).
  - *Rule:* declare `onItemError: fail | collect | quorum(k)`. The reducer receives typed coverage (done, failed,
    cancelled). The verdict cannot be `pass` with collected errors unless acceptance says so. This ties to the
    `ERROR_COLLECTION` lint.
  - *Test:* 3 of 16 workers fail.
- **Budget exhaustion mid-swarm.**
  - *Rule:* stop launching new items. In-flight items keep only their reservation. Unstarted items become `skipped:
    budget`. A partial result returns with its coverage and the verdict `budget_exhausted`, never `pass`. Unused
    reservations go back to the parent.
  - *Static check:* depth-3 carving at fan-out 16 can leave leaves with less than one call's budget
    (`BUDGET_TOO_SMALL`).
  - *Test:* a 16-item map that runs out at item 9.
- **The weekly usage limit hit mid-run.** §7 item 10 pauses instead of failing. A resume after the 7-day reset may run
  on a different model or CLI version.
  - *Rule:* pin model ids and the CLI version per run. Refuse a mixed-version resume unless replay matches
    (decision 6).
- **Human steps inside nested runs.**
  - *Rule:* the question carries its path (root → child → node), the workflow hash and the question hash. An answer to
    a stale question, after a callee upgrade or a replay, is rejected. The parent's deadline keeps running unless the
    node declares otherwise. One approval never covers sibling map items unless it is declared as a batch approval.
  - Also say *where* he answers (P1-9).
- **`call` before sagas.** `call` arrives in Stage 2 (S1), and compensation only in S7 (S:L184, L190).
  - *Rule, until compensation exists:* a validator rule that `call` children may have only idempotent or
    approval-gated effects.
- **Versioning of reused and called workflows.**
  - A revocation list that overrides hash pins for security defects. Running runs stop at the next boundary, and
    pending triggers are disabled.
  - An IR version per document, with migration tests from S1 to S7.
  - Constructed workflows record their template and kit versions.
  - Kept workflows are re-qualified when the model id, CLI version, engine hash or template changes (W10).
- **Siblings calling the same child with the same input.**
  - *Rule:* the idempotency key is (callee hash, input hash, parent path). One rate-limit gate is shared across
    siblings.
- **Refusals by preference.** Group chat (5 items) and full-history handoffs (S:L208, L214) are not unbounded. With a
  turn cap they are representable.
  - Label them "refused by design choice (MAST failure data), representable if you want them", which is different
    from "cannot be represented exactly". The owner agreed to rejections for unboundedness (T:4702), not to
    rejections by preference.

**P1-9. Give the owner a control surface: answer, approve, cancel, stop everything.**
- **What exists.** The run view is read-only by design (S:L904), which is right. The synthesis never says where he
  *does* act:
  - `foundry answer` and `foundry approve` exist in `bin/foundry.mjs:149–150`, and the same actions exist in `web/`
    (`src/http.mjs:72–83`);
  - cancel exists only over HTTP (`src/http.mjs:83`); there is no `foundry cancel` in the CLI.
- **What happened on 10-07 23:17.** The owner said "stop everythign for now" (T:4793), and the stop was messy
  (T:4895):
  - the first kill command matched itself;
  - a scheduled check-in would have restarted the work;
  - workflow inputs had not been saved, so they had to be rebuilt from transcripts.
- **Fix:** add a §3.17 paragraph naming the action channels. Add `foundry cancel RUN` and a stop-all with
  process-group kill to the Stage-1 engine bump. Add the test: cancel a three-deep tree while an executor runs, a human
  step is pending and a map is in flight. Expect:
  - no orphan processes;
  - `finally` runs within its grace period;
  - effects whose outcome is unknown are listed;
  - the owner is told what stopped.

**P1-10. Evaluation leakage beyond R-bench.**
- **CX2 is circular** (S:L392, L766). The lint rules were written from the C0-dev failures (DX). "Do lint violations
  predict test failures?" on those same 10 artifacts is guaranteed to come out yes.
  - *Fix:* run CX2 only on artifacts built after the lint is frozen (the CX3 constructions), or on held-out families.
    Label the retro-audit as a sanity check.
- **The sealed families are read by several experiments:** the C0 sealed round, RX4 slider fidelity, the live CX5
  cascade and the injection slice.
  - *Fix:* one pre-registered round with every arm, read once. After that the families become development data. Say
    so in §5, Stage 2.
- **Owner-written tasks need a sealing procedure.** Where he sends them, who writes each oracle, and when. An oracle
  Claude writes *after* reading the task is not sealed.
  - *Fix:* he sends each task with its acceptance check, or the oracle is written by an agent that never sees the
    builders' kits. The tasks are stored like `beds/sealed/`, with a hash commitment in the repo.
- **Interim looks at P1.** Partial P1 numbers went to the owner three times (T:5116, T:5178, T:5200).
  - *Fix:* state that interim numbers change neither the stopping rule nor the verdict, and that the verdict uses
    only the final, pre-registered analysis.
- **Router labels.** RX1 and RX2 labels come from runs on families whose test seeds the diagnosis has now inspected.
  - *Fix:* keep them development-only, as the synthesis does for C0. Say it once more in §3.4.

**P1-11. Injection paths the security list omits.**
- **Retrieval poisoning.** Corpus-mined skeletons and worked examples would enter the builder's *trusted* context.
  - *Fix:* only reviewed skeletons enter it. Every retrieved snippet carries a provenance label. Corpus-mined text is
    untrusted until reviewed.
- **The board.** Lane 7's S1 (injection through board topics), S5 (confused deputy) and S6 (flooding)
  (L7 L756–761) are missing from §7.
  - *Fix:* add them as preconditions of any board experiment.
- **Corpus extraction.** Sonnet agents read untrusted repositories to produce the graphs and construct labels behind
  the "35%" number.
  - *Fix:* re-check a sample of 30, with a model class other than the extractor, before the number is used in a
    decision.

**P1-12. Reuse vanished, though the narrowed claim depends on it.** S:L722–723 narrows the claim to "tasks that
recur", yet reuse (C2, Phase 5) appears in no week and no defer row. The recurrence census (W3, S:L734) needs the
owner's ARC/AMP logs, and no decision asks him for them.
- **Fix:**
  - Add a defer row for reuse with its trigger.
  - Add a decision: "Can you list your 10 most frequent recurring tasks, or export N weeks of ARC/AMP task logs?
    Without them, 'pays off on recurring tasks' cannot be checked."
  - Mention the original brief's reuse metrics (reuse, deopt and wrong-reuse rates; L1 #33) as not built.

**P1-13. Harness independence has one implementation.** S:L96 says "so any harness can run it". Only Foundry's runtime
executes the IR, and the export adapters were deleted (D6).
- **Fix:** reword to "designed to be harness-independent; so far it runs only on Foundry's runtime".
- Add a cheap test, scheduled or deferred: a second minimal interpreter for the S0 conformance subset. Or a lowering
  to a Claude Code workflow script, which doubles as the B1-cc baseline.

**P1-14. "Given the corpus we are accumulating" gets no answer.** Message 5 asks whether to train a selector *given
the corpus*. §3.8 answers only "the corpus graphs carry no success labels" (S:L489). The owner was told on 10-07 that
templates would be "mined from the corpus" (T:4062), and on 10-08 to "turn corpus workflows into Foundry templates"
(T:5200).
- **Fix:** add a paragraph on the corpus's roles. It feeds:
  1. R-bench items;
  2. motif mining for Opus-written skeletons;
  3. retrieved examples, once items compile (0 compile today);
  4. hard-requirement labels for the router (RX6, the 449 original descriptions).

  It is not training data, because it has no success labels. The firewall of P0-4 item 5 keeps role 1 apart from
  roles 2 and 3.

**P1-15. Usage and money.**
- **Usage.** The "new usage rule" (S:L756–760: at most 4 agents, and only in-flight runs while the meter warns)
  overrides the owner's "Full speed" choice (T:3732) without asking. It is sensible; make it a decision row.
- **Totals.** Spent so far is about $85, and the plan adds $785–885. With the Kev hosted approval, if kept, the total
  is $1,020–1,420 against the $1,500 soft cap (`README.md:120`). Show this sum.
- **List price.** Say in one sentence that these are notional list-price dollars. Usage billing is off (T:1601–1707),
  so the binding limit is the weekly allowance, not his card. Otherwise "$885" reads as a bill.

**P1-16. The promised "revised roadmap" is missing.** The owner was told the synthesis would "synthesise the design
review into a revised roadmap that adds your new scope" (T:5116).
- **Fix:** add §8, "Proposed ROADMAP and doc changes", one row each:
  - §2.1: `call`, `executor`, `wide`, error routes;
  - §2.2: no workflow-scope board (decision 5);
  - §2.3: model roles;
  - §2.5: the construction cascade;
  - §2.8: the router;
  - §2.10: the run view;
  - §3: clarifications;
  - §5: phases now interleave, against the brief's "phases in order" (L1 #50);
  - THESIS §1 and the AGENTS.md objective, which still say "cheap open-weight models execute".

**P1-17. "Where are we": replace the fraction, define "the core", give dates.** A single fraction is a gut number that
has already changed once in 25 minutes.
- **Fix:**
  - Replace S:L146 with counts from the §2 table: layers built, layers measured on held-out tasks, layers measured on
    wild tasks (today 0).
  - Name the **first end-to-end milestone**: one owner-written task goes through the router, Haiku construction, the
    run, the run view and an honest verdict. Give a target week.
  - Define "the core" that his "once we hve the core down" refers to: honest verdicts, structured construction,
    `call`, the declared/compiled/executed pipeline and a sealed C0 number.
  - State the date the plan implies for S7 ("~100% compiled"), or say it is unknown.

**P1-18. Plain language.** The document is for one non-specialist reader. It uses dozens of undefined terms:
- experiment and arm codes: CPS, K_c, d3–d4, fhand, F/B0/B1/B5/B1-cc, D/C/E, CX2–CX8, RX1–RX5;
- runtime terms: `atSeq`, compare-and-swap, a Merkle link, a work-conserving scheduler;
- security terms: program-counter taint, sink-field policy, a declassification budget in bits;
- borrowed names: Continue-As-New, the DBOS `fork`, CEL, GEPA/MIPRO;
- the slider formula with p̂ and λ_t.

**Name collisions.**
- "T1" means a wild tier (S:L457), an oracle tier (S:L458) and a Kev wave (S:L834).
- "Stage" means a plan week (S:L762), an IR stage (S0–S7) and a lane-7 experiment ("Lane 7 stage 4").

**Fix.**
- **(a)** Add a front page, "In plain words", of at most 15 lines:
  - what works;
  - what doesn't;
  - what changed since I last told you;
  - what I need from you.
- **(b)** Add a glossary of about 25 terms, and define F/B0/B1/B5 once in a box.
- **(c)** Rename the wild tiers "rungs 0–4" and the plan stages "weeks 1–4".
- **(d)** Rewrite every decision as "If yes … / If no … / Cost to you".

  Decision 6 ("resume under a new engine when replay reproduces the checkpoint state hash") and decision 7 ("per
  (workflowHash, triggerId, specHash)") are not answerable as written. Decision 9's "5–10% exploration" should read:
  "on about 1 in 15 low-stakes tasks, deliberately try a different approach so the router learns honestly".
- **(e)** Move the formula, the §3.2 rule table and the §7 security table to an appendix, with a one-line summary
  each.

---

## P2: polish

**P2-1. How swarms work.** The owner asked "how agent swams work". §3.9 gives outcomes, not the mechanism. Lane 3 §0
has it in four lines (orchestrator–worker, handoff, shared board, learned topology; who decomposes, what is shared, how
it stops). Add a three-sentence version. Note that Kimi's orchestrator is *trained* (PARL), unlike a Claude Code
workflow script.

**P2-2. The game-QA screenshots are a fixture.** S:L715 asks the owner to judge `ui-6`/`ui-7`. They show a scripted
69-event fixture with text stand-ins for screenshots (L6 §0 item 4; L6 L357). Say so in that sentence, or he will think a
game-QA workflow ran.

**P2-3. "Clicking it expands its chat".** Keep the transcript read-only. Offer a safe middle path: an "ask about this
node" box that makes a separate, authority-free model call over the journal. Mark it as a proposal that needs an
experiment.

**P2-4. Break-even numbers conflict within one section.**
- §3.4 gives "about 7 runs" (S:L327) and "about 486" (S:L328).
- W3 gives 10.5 / 486 / 27.5 (S:L734).
- The owner was told "4–10 runs" (T:5200).
- Per family [M C0]:

  | Family | F-opus | F-haiku |
  |---|---|---|
  | `records` | 3.8 | 2.9 |
  | `codefix` | 9.6 | never |

  The pooled 486 hides that F-haiku pays back almost at once on `records`.
- **Fix:** one table per family. Drop the pooled figure from the prose.

**P2-5. Two UI kill rules.** "3 real failed runs" (S:L716) vs "10 recorded failing runs" (S:L622). Pick one, or label
the first a pilot.

**P2-6. "An audit trail" as a hard requirement.** It forces a workflow (S:L294). The owner wants everything auditable,
and direct calls are journaled too. As written, the guard would fire on every task and make the slider moot. Define the
term as "an audit trail beyond the model-call journal, such as approvals or effects".

**P2-7. Itemise orchestration cost.** The synthesis says orchestration "is not itemised" (S:L133). The workflow
completion records carry `subagent_tokens`: for example 401,330 for the Kev design workflow and 738,769 for review
lane A (T:4072, T:4422). Sum them per workflow from the journals and add the total to the spend line.

**P2-8. Process items from the re-read, not surfaced.**
- PR #1 has been unmerged since 10-06, and `main` is still `6e1c06c` (L1 #53).
- No phase has a `REPORT.md` (L1 #50).
- The B2 baseline is missing (L1 #31).
- The "no Haiku arm" note conflicts with the Kev program.
- ROADMAP §6.1 says README is the single entry point and that there are "no parallel status documents". The synthesis
  calls itself "the one document for the owner" (S:L3).
- **Fix:** one paragraph, "What the full re-read of our chat found", plus a README link to the synthesis.

**P2-9. Wording against the non-goals.** "A model gateway" is a ROADMAP §3 non-goal, and the synthesis proposes a
"host gateway" (S:L562, L876). Say in one clause that this is an internal security boundary for executors, not a
gateway product.

**P2-10. Haiku 4.5's zero is mostly one structural violation.** By about 08:35 there were 30 Haiku 4.5 single-call
trials [M, `results.jsonl` `oracleDetails`]:
- 19 score 0 because a row is placed in two records (`row-in-multiple-records`);
- 2 score 0 for other reasons;
- the other 9 score 0.43–0.65. The owner was told this ("output breaks
the format rules", T:5116). S:L40 presents it as "the ground moves under us". Say that part of the gap is a constraint
a code check would catch. That supports "code owns procedure" as much as "models got smarter".

**P2-11. Missing worst cases.** Add three rows to §4:
- **W15, the owner becomes the bottleneck.** Every trigger activation, approval and human step goes to him; with "all
  combinations" in AMP, approval fatigue follows.
  - *Settles it:* count approvals per run in the wild tier, and offer batch approval with bounds.
- **W16, the review shares its authors' blind spots.** Every lane, the synthesis and both critics are Claude, so W5
  applies to this re-evaluation too.
  - *Mitigation:* the owner spot-checks 3 claims of his choice against their cited files.
- **W17, private data in owner tasks.** Rung-4 tasks from ARC/AMP logs may contain secrets.
  - *Rule:* redact before anything enters the journal, corpus or exports. AGENTS.md forbids copying credentials.

**P2-12. Baselines the plan uses but never builds.** B5, best-of-K with the same verifier, is the bar for `wide` and
the board. B1-cc, a real Claude Code workflow, is an arm of C0 sealed. Neither exists (`experiments/lib/arms/` holds
b0-agent, b0-call, b1-script and foundry-workflow [M]), and no week builds them. Add both to week 1 or 2 with a cost.

**P2-13. Name the Rust exception.** Decision 11 says "Rust: not now", but §3.14 recommends a 115-line Rust sandbox
launcher. Put "except the reviewed 115-line sandbox launcher" in the decision row, as the owner was told at T:5263.

**P2-14. "Every single possible component."** §3.14 ranks runtime fixes only. Add one line listing what is unmeasured:
- the construction loop (6–17 minutes; testing is 45–76% of its cost);
- orchestration (P2-7);
- Kev serving on the GPU;
- the context compiler at large inputs;
- the run-view server under several live runs.

That answers "have we made sure" honestly: no, and here is what is not measured.

---

## Keep these (do not regress in revision)

- The explicit correction of the interop promise (S:L221–224). It is the model for P0-1.
- The coverage definition (S:L157–165): represent exactly or reject with a named reason; report declared, compiled
  and executed; the headline on a fresh held-out sample.
- The P1 framing as a ceiling, with its four favourable-setup bullets (S:L443–447).
- Stop rules with reasons, a falsifier per recommendation, and a default per decision.
- The read-only run view, and "a computed prompt is never consent".

## Revision checklist, in order

1. **P0-1:** re-run both analysis scripts; add the "what changed" table; fix every number in one pass.
2. **P0-5:** reorder the security plan, rewrite decision 4, restrict the pilot arms.
3. **P0-4:** add the R-bench guards and the three task types.
4. **P0-2, P0-3, P0-6:** add decisions 12–13 and experiment EX1; reword decisions 3 and 8.
5. **P1-18:** add the plain front page and glossary; rename the tiers and stages; rewrite the decisions.
6. The remaining P1 items, then P2.
