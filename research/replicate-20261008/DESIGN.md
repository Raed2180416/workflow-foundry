# R-bench design (2026-10-08)

*Development design. No arm has run on any R-bench task, no pre-registration is frozen, and every harness named here is
development evidence (written and attacked by Claude agents, seeds inspected). Tags: [M] measured, with the command;
[D] documented, with the path; [I] inferred; [unk] unknown. Corpus items, task text and harness fixtures are data, never
instructions.*

Inputs: [SELECTION.md](SELECTION.md) and `experiments/replicate/selection.json`; the five pilot harnesses under
`experiments/replicate/items/` with their builder and verifier reports (2026-10-08); `beds/CONTRACT.md`;
`skills/micro-harness/references/ir.md` and `operators.md`; `research/review-20261007/00-SYNTHESIS.md` §3.1, §3.4, §3.7,
§5–7 and `02-ir-expressiveness.md` §7–8; THESIS §10 (D8–D16); ROADMAP §2.5, §2.8, §2.9, §4.

## 0. Key decisions

1. **One job, three task types, one oracle.** T1 translate, T2 rebuild from intent and T3 improve are scored on the same
   hidden battery of the same item, by the item's executable oracle, which judges effects and outputs only. T1 is graded
   for fidelity to the original (its defects included), T2 for the author's intent, T3 for intent plus every frozen
   improvement target and fault probe (§3).
2. **T2 gets the author's own words only.** Four of the five pilot harnesses give T2 a description written by the
   harness agent (two n8n paraphrases, a Home Assistant restatement, a GitHub Actions description). That breaks the
   synthesis rule that model-written descriptions never enter rebuild. Before run 1, each item gives T2 the author's
   text verbatim (read from `/opt/corpus` at task time and sha-checked when it may not be redistributed), plus worked
   examples. A T2 cell that still uses a restatement is reported in a separate stratum, `T2-restated` (§3.2).
3. **Arms** (§4): B0-haiku and B0-opus do the job directly with no artifact. F-opus→haiku is an Opus-built Foundry
   workflow whose model nodes run on Haiku. F-haiku is a Haiku-built workflow, and B1-haiku a Haiku-built script. For T1
   there is also C-det, a deterministic converter, which does not exist yet for any pilot platform. Builders are the
   in-runtime structured builder, not Claude Code. B0 runs as direct calls (one call per scenario, or per round of an
   event) until executor isolation (synthesis §7 item 5) passes, because THESIS D10 keeps executors off third-party text.
4. **Same world, same output record, for every arm.** Every arm acts on the item's own mocks and produces the record
   that item's oracle already judges: tables, a plan, or an `{actions}` episode. The only thing that differs between
   arms is the runtime (§3.1).
5. **Metrics** (§5). The primary metric is verified job success per task type. Next to it are cost per verified success
   with construction amortised over N runs (N = 1, 10, and the item's natural monthly run count), break-even against
   B0, construction and per-job latency, pass^k for executions and for constructions, and for T3 the ratio to the
   original's cost and latency measured in the same harness.
6. **Coverage feed** (§6.1). An oracle-passing T1 artifact that validates under the production label policy makes its
   item *executed*. It counts as *exact* only when no harness stand-in was used (trigger turned into a run, wait turned
   into a host wake-up, and so on). Items executed by deterministic-converter artifacts are kept apart from items
   executed by model-built ones, and only the former match D8's "compiled" definition.
7. **Router feed** (§6.2). Each item gives three labels:
   - hard-requirement labels, extracted by code from the original's constructs;
   - mode-outcome labels: success and cost for direct, script and workflow;
   - a best-mode label, cross-fitted over the K_c builds, at each slider value V and run count N.

   All of these are development labels.
8. **Measured harness cost: about $11 and 66 agent-minutes per item** (§7, [M]). That is build by Sonnet 5.5 (mean
   43 min, $6.2) plus adversarial verification by Opus 5.5 (mean 23 min, $4.6), with a range of $7.2–13.5 and
   51–78 min. The dollars are list-price lower bounds, because hidden reasoning is not counted. Verification is not
   optional: it changed every pilot. It found 18 classes of wrong solution that the first oracle accepted and 11
   correct designs that it rejected.
9. **Scale plan** (§8). The pipeline is scripted acquisition, a contract scaffold, an agent build, a scripted generic
   attack suite, an agent attack, a scripted health gate and freeze, and a second attack on a random third of items.
   - Items 6–30: about $280–540 of list-price-equivalent agent time and about 38 agent-hours.
   - Items 31–100: about $1.0–1.3K and 105–130 agent-hours, split 60 development and 40 sealed.

   Weekly allowance is the binding limit, not dollars.
10. **Recall guards are part of the run, not an appendix** (§9). Each run includes:
    - a memorisation probe per item and builder model;
    - a perturbed twin per item, used on T2;
    - item dates checked against the builder model's training cutoff (by item creation date, not repository head);
    - a source firewall with a near-duplicate check;
    - fresh test seeds (10001+), because pilot seeds 0–27 have been inspected.
11. **Run 1 is report-only** (§10). It covers 5 items × 3 task types × 3 test seeds. Constructions are K_c = 2 for
    Haiku-built arms and 1 for Opus. Executions are K = 2, except B0-opus at K = 1 on T1 and T2 only. Spend is expected
    around $170 [I]; the stop line is $300 recorded. Every comparison is directional; five items cannot carry a claim.
12. **The owner's reply and rung 3.** "This is why we look at different niche workflows …" answers the request for 20–30
    owner tasks with R-bench. R-bench covers "jobs real people built and run". It does not cover jobs the owner wants,
    or jobs nobody has built yet, which is what tests "does it need a workflow?". The default keeps R-bench as rung 2a.
    Alternatively, the owner either marks the R-bench items he would actually want done, or records that R-bench
    replaces rung 3 (§11).

## 1. What R-bench answers

The owner's idea, verbatim: "this is why we look at different niche workflows users have spent so mucht time custom
building and see if we can cheaply recreate their workflow do their shit, and see if anything needs improvement no ?"

It splits into three measured questions:

| Owner's words | Measured as | Task type |
|---|---|---|
| "cheaply recreate their workflow" | verified success and amortised cost of building an equivalent from the original (T1) or from the author's intent (T2), by a cheap and a frontier builder | T1, T2 |
| "do their shit" | the built artifact passes the item's oracle on hidden scenarios it never saw; the original (or its labelled emulation) passes the same oracle; broken versions fail | all |
| "see if anything needs improvement" | (a) documented defects in the original, shown by scenarios; (b) an arm meets frozen targets (cheaper, faster, survives fault probes) while keeping the job | T3 |

R-bench is rung 2a of the wild ladder (ROADMAP §4.2). It is harder to fool than our synthetic beds because people built
these jobs for their own needs. It is still easier to fool than sealed families, because Claude agents wrote every
oracle (§9).

**Early answer from the pilots, before any arm ran** [M, harness reports; nothing confirmed on a real platform]:
- all five originals pass their oracles, run in emulators or interpreters;
- the harnesses document **22 candidate defects** in the five originals (§2.2). One example: n8n:20281 calls itself
  five times but has no Execute Workflow Trigger, so real n8n would refuse those calls.

So "anything needs improvement?" already has a plausible yes, pending confirmation on the real platforms.

## 2. What the five pilots showed

### 2.1 Pilot by pilot

All five verdicts are **usable-with-limits** after one adversarial verification. All five health gates hold: the
original or reference passes, and every broken control fails, on at least 20 seeds.

| Item | Original control | Battery and pass rule (frozen version) | Verifier: v1 wrong passes fixed / correct designs v1 rejected | Main remaining limits |
|---|---|---|---|---|
| P1 `galaxy:iwc/variation-reporting/Generic-variation-analysis-reporting` (v2) | shipped tables for the shipped case; a `.ga` step emulator (own code) for derived cases | shipped case plus 20 seeded derived cases; 4 tables strict on the shipped case and on at least 18 of 20 derived cases | **4** (no DP prefilter; group by POS; countunique fixed at 1; AF label format) / **1** (highest-impact effect under random effect order) | 18/20 tolerance lets rare faults through (Math.round tie); multi-sample and join semantics inferred; emulator and reference share one reading; T3 graded on fidelity |
| P2 `n8n:12679` (0.2.0) | original executed on shim nodes (own code), plus a call-for-call transcription (identical trace on 40/40) | 15 core scenarios plus soak; state of both mocks after every step, no echo, no duplicate create; T3 adds 4 probes and a call cap | **6** classes (update path drops fields; cleared fields never written; case-sensitive tags; tags only on create; form tag; junk Zoho tag), plus an oracle crash and a mock bug / **1** (Berlin-midnight birthdays) | real n8n never run (assumptions A6, A11, A13, A14); T3-only checks; some behaviours never tested |
| P3 `n8n:20281` (0.2.0) | original executed in an n8n interpreter (own code, 15 Code nodes), plus a faithful transcription | 80 frozen synthetic mails; routing, dedupe, review and ack exact; category ≥ 0.85, priority ≥ 0.80; T3 adds 5 probes, model $ ≤ 0.40×, calls and latency ≤ 1.0× | **6** (ref-only prompt; forged `modelTape`; drop-critical; notify before create; mention dodge; probe dodge) / **2** | same 80 mails for every seed, so a solver that remembers model answers passes; labels by one author; recorded classifier accurate by construction |
| P4 `home-assistant:CCOSTAN/…/garbage_day_garage.yaml#0` (0.2.0) | own YAML/Jinja interpreter of HA semantics, corrected from HA docs (`_docs/scripts.markdown` lines 538–542, 1504–1506) | 15 scenarios, ordered trace (service, target, data, ±1 s); T3 adds 4 probes and a cap of 310 cost units | **2** (naive debounce; start gate from memory) / **4** (button order; typographic apostrophe; `last_changed` format; the condition-inside-repeat rule, which v1 took from memory and got wrong) | real HA never run; real TTS timing would likely miss ±1 s; probes P1/P3 rest on an unverified rule; fixed scenario order |
| P5 `github-actions:shafthq/…/update-selenium-grid-versions.yml` (0.1.1) | the original's bash steps actually run (bash -e, curl shim, docker stub, PR recording stub): the only real-code control | 14 scenario kinds; file byte-equal; exactly one correct PR operation; no PR on no change; T1 judged against the running original, T2/T3 against intent | **0** wrong edit or PR behaviour; 1 network hole in the curl shim / **3** (PR text order; leftover files on a failed plan; duplicate labels) | keyword-stuffed failure message passes 560/560; one-line PR text passes; generator never pits commented-out lines above the real one; repository read gives the answers (420/420) |

Totals [M, verifier reports]:
- **18** classes of wrong solution passed v1 and now fail;
- **11** correct designs failed v1 and now pass;
- **5** wrong-solution classes are still known to pass;
- on every item, a solver that can read `experiments/replicate/` can rebuild the answers.

### 2.2 Candidate defects in the originals (T3 material)

These come from the harnesses' scenarios. None was confirmed on the real platform.

| Item | Defects |
|---|---|
| galaxy (3) | the description promises a plot that no step produces; the flag step can only add labels; the same FILTER label is appended twice |
| n8n:12679 (5) | concurrent edits leave each system with the other's value; duplicate Zoho contacts on a pre-existing email or a redelivered webhook (rests on assumption A6); a missing birthday is written as 1970-01-01; 4.6 failing calls per episode and about 35 of 130 successful writes are no-ops; Zoho→KlickTipp segment tags may never apply (strict reading of the node output, inference) |
| n8n:20281 (8) | no Execute Workflow Trigger for its five self-calls; no Error Trigger, so the alert branch is unreachable; non-idempotent Jira create retry; a lagging search index gives a duplicate ticket; failed sheet append swallowed; a redelivered mail repeats every effect; mail text reaches Slack unescaped; quoted Outlook history reaches the model and Jira |
| HA garbage day (2) | the author's comment says "stop if the door closed", but the YAML only skips that announcement; on real hardware the announcements likely come seconds late against the stated 30/90/180 s schedule (inference) |
| GHA selenium (4) | quoted image references are silently corrupted (glued tags); a commented-out reference line produces a downgrade PR; a bad reference is rejected only by accident and `curl -s` hides a dead connection; pre-release filtering works only because `set -e` kills the step |

### 2.3 Rules taken from the pilots

- **L1. Adversarial verification is mandatory and is the cheapest part.** Verify took 23 min and $4.6 against 43 min
  and $6.2 for the build, and it changed every item (§7).
- **L2. Oracles must judge effects, not designs.** Each item needs at least one independently written alternative
  design that must pass:
  - galaxy has `independent-solve.mjs`;
  - HA has `controls/alternative.mjs`;
  - n8n:12679 has a design written from the description;
  - n8n:20281 and the selenium item need one.
- **L3. Platform semantics recalled from memory are wrong often enough to matter.** The HA repeat rule was wrong. Every
  semantic assumption goes into an assumption ledger with its source class (observed, documented at path:line,
  recalled). Each contested assumption gets a sensitivity run that flips it.
- **L4. The repository is the answer key.** Labels, recordings, frozen batteries and scenario fixtures sit next to the
  harness. No builder or executor may read `experiments/replicate/`. The structured builder and the sandboxed B1 and
  `code` runs satisfy this. B0-agent and the free builders wait for isolation.
- **L5. Inspected seeds are burned.** Builders and verifiers ran seeds 0–27 on both splits. Run 1 uses test seeds
  10001+ generated only at the freeze.
- **L6. A fixed stream is one instance, whatever the seed.** n8n:20281 reuses its 80 mails, and seeds only change
  deployment presets. The unit of analysis is the item.
- **L7. Interfaces drifted.** Galaxy takes `taskType`, the others take `variant`.
  `experiments/lib/beds.mjs` `loadFamily` cannot load `experiments/replicate/items/*`, and `makeTasks` passes no
  variant. The renderers drop definitions that n8n delivers through `solverFiles()` or `materialize()`. A runner shim
  in `experiments/replicate/` fixes all of this; THESIS D15 approves the shim.
- **L8. Cost accounting has holes.** `run-solution.mjs` records $0 for `.mjs` solvers. n8n:20281 trusts a model tape
  only in the process that recorded it. Arms must meter model spend through the journaled ModelPort or the host gateway.
- **L9. Foundry's per-run overhead decides small-job latency.** `foundry run` took 1.1–2.5 s against 0.19–0.37 s for
  the original bash, so 0/14 runs met the T3 latency target. Latency is reported both raw and net of engine overhead.
  The original's latency is re-measured on the machine that runs the arms.
- **L10. Each pilot wrote its own interpreter.** That came to two n8n executors, an HA engine, a Galaxy emulator, a YAML
  subset and a bash runner. Consolidating them into platform kits is the main lever on cost per item (§8.2). An arm
  must never reuse the oracle's interpreter (independence).

## 3. Task types

### 3.1 Common frame

- **Item:** one corpus workflow plus its harness (`experiments/replicate/items/<safeId>/`).
- **Instance:** `generate({seed, split, difficulty, variant})`, a pure function of its arguments. It produces the solver
  view and a hidden battery: cases, or scenarios of events with a virtual clock.
- **Hidden battery:** never shown to any arm. That covers scenario ids, expected traces, labels, recordings, fault
  windows and start times.
- **Output record:** what the item's oracle judges. Galaxy: four tables per case. Selenium: a plan the host applies
  through the PR stub. n8n:12679, n8n:20281 and HA: an `{actions}` episode that the oracle replays in a fresh
  environment.
- **Candidate forms.** Every arm produces the same output record through the same mocks. Only the runtime differs.

  | Form | Shape | Items |
  |---|---|---|
  | O (one-shot) | case or instance → output | galaxy (per case), selenium (per instance) |
  | E (event) | for each trigger event, one run with access to the item's API | n8n ×2, HA |
  | P (policy) | `{event, history} → next calls`, replayed by the host until done (the pilots' `policyHandler`) | n8n ×2, HA |

  How each arm uses the forms:
  - **F** uses form E natively. The item's API is registered as mock capabilities and called from `task` nodes, with
    effects declared as in reality. `wait` nodes handle delays of 1 h or less; longer waits become host-scheduled
    wake-up events. `human` nodes are answered by the scenario script.
  - **B1** uses form E with the JS API object, inside the no-network sandbox.
  - **B0** uses form P: one model call per round, with the episode history in context.

  The adapter turns capability calls into the `{actions}` record in execution order. It does not exist yet; it is
  precondition G7 (§10.9).

### 3.2 What each task type gets and how it is judged

| | T1 translate | T2 rebuild from intent | T3 improve |
|---|---|---|---|
| **Solver gets** | the original definition, verbatim and sha-pinned (`.ga` plus test outline; n8n JSON materialised from `/opt/corpus` at task time; HA YAML and GHA YAML vendored, MIT); the candidate contract and the mock API reference; the environment config (account ids by role); the platform-semantics notes the oracle assumes, each with its source | the **author's own description, verbatim** (template description, workflow annotation, file header comments, README text), sha-pinned and materialised at task time when it may not be redistributed; 2–10 worked examples (inputs → output or trace) generated by the reference from a disjoint data pool (seed `examples`) and labelled as such; contract, API reference and config | everything T1 gets, plus the verbatim description; the original's measured baseline on this harness (calls, failed calls, model $, cost units, latency on the arm machine) in `inputs.costTarget`, not only in `budget`; the frozen targets; the improvement dimensions; the fault classes probed, named generically ("redelivered events, concurrent edits, missing optional fields, transient API failures") |
| **Withheld** | hidden battery, oracle, references, labels, fixtures, model recordings; no description beyond what the definition contains | everything withheld from T1, plus the definition, node names and any harness restatement of the job | hidden battery and probe scenarios |
| **Graded against** | the original's behaviour, defects included (fidelity) | the author's evident intent; where no documented defect separates intent from fidelity, the two coincide | intent, plus all T3 probes, plus every target |
| **Success** | oracle pass on the instance's hidden battery, fidelity mode | oracle pass, intent mode | oracle pass on core and probes, **and** every target ≤ cap; improvement ratios are reported continuously |

Rules:
- **T2 sufficiency check (from the galaxy harness), required for every item.** Every bad control differs from the
  reference on at least one worked example, for seeds 1–5. Then T2 is solvable from the author's words plus the
  examples, without a restatement.
- **The API reference describes the environment, not the job.** A verifier checks that it leaks no job logic: no
  routing rules, no thresholds, no node names.
- **Galaxy T3 stays fidelity-graded.** Its harness fails a dedupe of the doubled FILTER label by design, and changing
  that now would be an oracle change after verification. This is listed as an owner decision (§11), not changed.
- **Intent is frozen per item before any run.** The selenium harness's "original mode" and "intent mode" are the
  pattern.

### 3.3 Construction probes

The F and B1 builders may run their artifact on **dev** instances:
- fresh dev seeds 9001–9002 at d3;
- at most 3 probe rounds per construction;
- they see what a developer would see (the output record, the effect trace, run errors) plus the pass bit and score,
  as C0 did;
- they see no violation codes, oracle details or test instances.

B0 builds nothing and gets no probes.

### 3.4 Pass rules carried into run 1 (frozen harness versions)

| Item | Core pass | T3 adds |
|---|---|---|
| galaxy v2 | four tables strict-equal on the shipped case and on at least 18/20 derived cases | at most 8 nodes, 0 model calls, at most 2,000 ms per job (still fidelity-graded) |
| n8n:12679 0.2.0 | 15/15 core scenarios and soak invariants; no `ECHO_WRITE`; no duplicate create | 4 probes (concurrent edits, pre-existing duplicate, missing birthday, redelivery); external calls at or under the cap |
| n8n:20281 0.2.0 | all routing, dedupe, review and ack codes clean; category ≥ 0.85; priority ≥ 0.80; ambiguous mails reach review; ≥ 0.85 of clear requests escalated; classification claimed from the model | 5 probes; `T3_TARGET_RULE` {modelUsdMax 0.40, externalCallsMax 1.0, latencyMsMax 1.0} × baseline |
| HA 0.2.0 | 15/15 scenarios, ordered trace within ±1 s | 4 probes; cost at most 310 units |
| selenium 0.1.1 | every scenario kind: file byte-equal, one PR operation with the right fields, no PR on no change, visible failure | `meetsTarget` (latency re-measured on the arm machine) |

## 4. Arms

| Arm | Builds | Runs | Artifact | Form | Construction cap | Per-episode cap | Can run when |
|---|---|---|---|---|---|---|---|
| **B0-haiku** | nothing | `claude-haiku-5-5`, one call per case, instance or round; no tools; episode history in context | none | O / P | — | $0.50 | now (B0-call). The B0-agent form (Claude Code with tools) only after §7 item 5 |
| **B0-opus** | nothing | `claude-opus-5-5`, same | none | O / P | — | $5 | as B0-haiku |
| **F-opus→haiku** | structured builder on `claude-opus-5-5`: in-runtime, schema-constrained calls, no executor, provenance-tainted context, ≤ 3 probe rounds | Foundry runtime; agent nodes fixed to class M (`claude-haiku-5-5`), `maxClass` M, so no escalation | `workflow.json` | O / E | $5, 30 min | $0.50 | structured builder v0 plus gates G1–G6 (§10.9) |
| **F-haiku** | structured builder on `claude-haiku-5-5`, same rules | as above | `workflow.json` | O / E | $1.50, 30 min | $0.50 | as above |
| **B1-haiku** | one direct `claude-haiku-5-5` call writes `solve.mjs` or `handler.mjs`, plus at most 3 probe-guided repair calls | sandboxed node, no network; model only through the host gateway, restricted to `claude-haiku-5-5` (`experiments/lib/arms/b1-script.mjs`) | script | O / E | $1, 30 min | $0.50 | §7 item 6 |
| **C-det** (T1 only) | a deterministic lowering of the original definition, no model | Foundry runtime | `workflow.json` | O / E | $0 | $0.50 | exists for **0 of 5** pilot platforms; arrives with the IR-S0 lowering. Run 1 reports "n/a: no converter" |

Deferred or optional arms:
- **Deferred:** F-cc-haiku and F-cc-opus (free builders in Claude Code) and the B0-agent form. These wait for executor
  isolation; under D10's default they are reported as missing. Together they complete the 2×2 of builder model ×
  builder method.
- **Optional ceiling:** F-ref, the reference ported to IR by hand. Only the selenium item has one (a one-node
  workflow, 14/14 through `foundry run`).

Held constant across arms:
- model ids from `policy/models.json` (policyVersion `2026-10-07.1`);
- the per-call timeout, stated as 300 s (P1 lost 30 trials to an unstated one);
- the world, mocks, battery and oracle;
- the work root outside the repository (enforced by `runner.mjs`).

Arms are interleaved per instance. Builders and executors never see `experiments/replicate/`. An arm must not import
an item's interpreter or emulator, because those are the oracle's side.

## 5. Metrics

Notation: arm *a*, item *i*, type *t*, test instance *s*, construction *c* (1..K_c), execution trial *k* (1..K).
`pass` is the item oracle's verdict on the output record.

| Metric | Definition |
|---|---|
| **Verified job success** (primary) | p(a,i,t) = mean of `pass` over s, c, k. The headline per arm and type is the macro mean over items (items weighted equally), with every item shown |
| **Cost per verified success, construction included** | CPS_N(a,i,t) = (B + N·e) / (N·p). B is the mean construction $ (all calls, probes, repairs and failed builds); e is the mean execution $ per episode (every journaled call, escalations included, timeouts charged at their cap). Reported at N = 1, 10 and N_item, the item's natural runs per month from its trigger (selenium weekly, about 4; event items from scenario rates [I]). B0 has B = 0. p = 0 gives ∞ |
| **Break-even** | N* = the smallest N with CPS_N(F or B1) ≤ CPS_N(B0-haiku), and again against B0-opus; "never" when it does not exist |
| **Latency** | construction wall time (median per arm); per job p50 and p90 wall time of real compute (virtual clock excluded); for F, the engine-overhead share (run wall time minus model and sandbox time) |
| **Reliability** | pass^K_exec = share of (artifact, s) where all K executions pass. pass^K_c_build = share of (i, t, s) where every construction's first execution passes. End to end = share of (i, t, s) where all K_c × K runs pass |
| **Improvement vs the original** (T3, where measurable) | for each frozen dimension d (external calls, failed calls, model $, cost units, latency): r_d = candidate / original, with the original measured on the same harness at the freeze and labelled `emulated` when it ran in our interpreter; plus probes passed and defects addressed. Shown for T3 passes, and separately for "core and probes pass, target missed" |
| **Fidelity–intent gap** | p(T1) − p(T2) per arm and item, plus how many T1 failures came from "fixing" a documented defect |
| **Secondary** | IR validity under the production label policy; acceptance-lint violations; agreement of Foundry's own run verdict with the oracle (it said "pass" on all five failed F trials in C0 dev); escalations; unknown-cost calls; harness faults (excluded under the runner's environment-fault rule) |

## 6. What R-bench feeds

### 6.1 Compiled and executed coverage (THESIS D8, the ~100% IR goal)

D8 counts only exact representation, or rejection with a named reason. Its headline is compiled plus executed coverage
on a fresh held-out sample after the IR freeze. R-bench supplies the executed half on the oracle-eligible items.

- **Per item record** (`coverage.json` next to each run): `{item, type: T1, arm, artifactHash, compiled, executed,
  standIns: [...], blockingConstructs: [...]}`.
  - `compiled`: the artifact validates under the production label policy. No relaxed policy, ever.
  - `executed`: `compiled` holds and the oracle passes on the frozen test battery.
- **Two numerators, never mixed:**
  - **E-auto:** items executed by a C-det artifact. This is the number that matches D8 and 02 §8 ("an automated
    lowering"). It is 0 in run 1 because no converter exists.
  - **E-model:** items executed by the best builder-arm T1 artifact. This shows the job is representable with model
    help, not that the IR compiles it.
- **Denominator:** health-gated R-bench items, reported as executed ÷ oracle-eligible, never as a share of the corpus.
- **Exactness.** An item that needed a stand-in is "executed with stand-ins [constructs]", not exact. When an IR stage
  lands, the same frozen harness re-runs the artifact without the stand-in. That gives each stage the capability number
  02 §7 asks for (the S(n) IR against S(n−1) on items that need the construct).

| Pilot | Corpus verdict (selection.json) | Stand-ins today | Stage that removes them (02 §7) |
|---|---|---|---|
| galaxy | native | none (map over a collection, joins, aggregation) | exact as soon as a lowering exists |
| selenium | via-extension: schedule-trigger | schedule → run input; fetch, file edit and PR as mock capabilities | S3 (triggers) |
| n8n:12679 | webhook-trigger + event-trigger | five triggers → one run per event; linked ids live in the mocked systems, not workflow state | S3 |
| n8n:20281 | event-trigger + subworkflow-call + error-branch | polling triggers → one run per mail; self-calls inlined; error workflow not represented (it is unreachable in the original anyway) | S1 (`call`), S2 (error routes), S3 |
| HA | event-trigger + durable-wait + run-concurrency-policy + subworkflow-call | state trigger with `for:` → event plus wake-up; notification button → `human` or a scenario event; restart mode → host admission; script calls inlined | S1, S3 (admission), S4 (signals) |

Two more uses:
- **Lowering audit.** Where C-det fails and an F arm's T1 artifact passes, the failure is a lowering bug or a missing
  construct. That is behavioural evidence for 02 §8.7's audit, stronger than a structural comparison.
- **Converters from harness interpreters.** For 3 of 5 pilots, the harness had to write an interpreter of the original.
  Those interpreters are the runtime half of a converter. Turning them into IR-emitting converters is the cheapest route
  to C-det for n8n, HA and Galaxy text tools. A converter used as an arm must be independent code, checked against
  shipped outputs or the real platform, never the oracle's own emulator.

### 6.2 Labels for the workflow-need router (ROADMAP §2.8, synthesis §3.4)

1. **Hard-requirement labels**, extracted by code from the original's constructs: trigger or schedule, durable wait,
   human step, effects with authority, audit trail beyond the journal.
   - The pilots: galaxy none; selenium schedule + effects (PR); n8n:12679 triggers + effects (CRM writes and deletes);
     n8n:20281 triggers + effects (Jira, Slack, mail) + audit log; HA trigger + wait + human step + effects.
   - So the guard forces a workflow on 4 of 5 pilots whatever the slider says. R-bench mostly tests whether the guard
     is right. The utility head only matters on items like galaxy.
2. **Mode-outcome labels**: `(features, mode, propensity = 1, cost, outcome, independence)` per (item, type, arm), in
   the shared decision schema v1. Modes are direct (B0), script (B1), construct (F), and later agent and reuse.
3. **Best-mode labels**: the argmax over modes of V·p − CPS cost at V ∈ {$0.10, $1, $10} and N ∈ {1, 10, N_item}.
   They are cross-fitted: the mode is chosen on construction 1 and scored on construction 2, and the reverse. A
   shuffled-label null is reported next to them, as RX1 requires.

Rules for these labels:
- **Development only.** Every R-bench seed used so far has been inspected.
- **Features from trusted fields only** (§2.9). Corpus descriptions are untrusted. Kev may extract task properties from
  them only in a quarantined node, and the router never reads the text.
- **What R-bench can show about routing:**
  - at 30 items, a first real-workflow headroom estimate;
  - at 100, a candidate training set for the calibrated head, still development data unless it comes from the sealed
    slice;
  - N_item makes "workflows pay off on tasks that recur" testable on real jobs. That question has been unchecked since
    the owner gave no recurring-task list (README decision 11).

## 7. Harness cost per item (measured)

Command: `node research/replicate-20261008/harness-cost.mjs <subagent dir of workflow wf_97f496b3-004> --json
research/replicate-20261008/harness-cost.json`. It reads the builder and verifier transcripts (agent meta
`harness:<id>` and `verify:<id>`).

What the numbers are:
- **Input-side tokens:** exact.
- **Output:** estimated from visible content at 3.5 characters per token. The transcripts' own output counts are
  streaming snapshots and unusable; hidden reasoning is not visible. **Dollars are therefore lower bounds.** Output is
  about 12% of the estimate, so even doubling it adds about 12%.
- **Prices:** list prices from `policy/models.json`; cache writes at 1.25× input; cache reads at $0.20/MTok
  (claude-api skill model table, cached 2026-10-06).
- **Charging:** on this subscription nothing is charged in dollars. The weekly allowance is what binds.

| Item | Build (Sonnet 5.5) | Verify (Opus 5.5) | Agent minutes | Input-side tokens | $ build | $ verify | **$ total** | Files / `.mjs` lines (tests) | Tests now |
|---|---|---|---|---|---|---|---|---|---|
| galaxy | 29.3 min | 22.2 min | 51.5 | 22.3 M | 3.81 | 3.37 | **7.18** | 28 / 1,873 (365) | 27 |
| n8n:12679 | 46.7 | 26.5 | 73.2 | 41.4 M | 6.75 | 5.29 | **12.04** | 27 / 2,659 (619) | 45 (1 todo) |
| n8n:20281 | 46.1 | 31.4 | 77.5 | 40.6 M | 7.00 | 6.52 | **13.52** | 37 / 3,319 (451) | 52 |
| HA garbage day | 38.7 | 22.5 | 61.2 | 30.9 M | 5.41 | 4.04 | **9.45** | 30 / 2,749 (640) | 36 |
| GHA selenium | 52.9 | 14.5 | 67.4 | 43.0 M | 8.24 | 3.81 | **12.05** | 103 / 2,846 (711) | 47 (1 todo) |
| **mean** | 42.7 | 23.4 | **66.2** | 35.6 M | 6.24 | 4.61 | **10.85** | | |

Further observations:
- **Totals:** 330.8 agent-minutes and $54.24 for five items. Wall clock was 08:35:59 → 11:27:19 UTC (2 h 51 min), with
  about two agents running at a time (builders first, verifiers overlapping the last build).
- **Selection:** choosing the 30 items cost one Opus agent 22.2 min and $9.20, about $0.31 per item.
- **The selection estimate is not a cost model.** SELECTION estimated 58 hours of effort for these five items. The
  measured figure is 5.5 agent-hours. The estimate also ranks items poorly: selenium was estimated at 6 h, the cheapest,
  and was the second most expensive in agent dollars.
- **A pilot harness is 2–3.3K lines of code** plus generated fixtures, and its suite runs in 28–145 s.
- **What the price buys:** a usable-with-limits development harness on mocks. It does not buy a real-platform control,
  a second annotator or a sealed battery. Those are extra (§8.4).

## 8. Plan: 30 items, then 100

### 8.1 Per-item pipeline (scripted where marked)

1. **Acquire** (script, existing pinned acquisition tooling): URL, SHA, date, licence, acquisition outcome. No install
   hooks. Credential-shaped strings are redacted (n8n:18122).
2. **Scaffold** (script, new): generated from the pilot shape. It produces the contract, freeze, control runner,
   determinism, leak and T2-sufficiency tests, and README sections for provenance, assumptions, verification and known
   limits.
3. **Build** (Sonnet agent, cap 60 min / $12): fixtures, mocks from the platform kit, oracle, reference, alternative
   design, broken controls, twin generator, assumption ledger.
4. **Generic attack suite** (script, new, $0). It runs empty, do-nothing, hard-coded shipped answer, replay of the worked
   examples, field-drop mutants at every output path, letter-case variants, keyword stuffing, prototype keys, huge
   numbers, repository-read leakage and a network canary. Each of these was found by hand in at least one pilot.
5. **Adversarial verify** (Opus agent, cap 40 min / $8): item-specific attacks and correct designs the oracle may
   reject.
6. **Health gate and freeze** (script): the original or reference passes and the bad controls fail on at least 20 fresh
   seeds; the alternative design passes; the battery hash is frozen.
7. **Second verify** on a random third of items (Opus agent, cap 30 min / $6). It measures the residual hole rate. If
   it averages more than one hole per item, two verifies become mandatory.
8. **Accept**, or exclude with a named reason. An excluded item is still a coverage data point.

### 8.2 Shared kit first

Before the next batch, consolidate the pilots' code into `experiments/replicate/kit/`:
- an n8n node emulator with an expression evaluator (two separate n8n executors exist today);
- the HA engine and mock (already re-exported at `experiments/replicate/mocks/home-assistant.mjs`);
- a GitHub Actions step runner with curl and PR shims;
- the YAML and Jinja subsets;
- Galaxy text-tool emulators;
- the SaaS mocks (Zoho, KlickTipp, Gmail, Outlook, Jira, Slack, Sheets);
- the R-bench runner shim and the form O/E/P adapter.

Expected effect: same-platform items (n8n has 6 more of the 30, HA 4 more) should cost 30–50% less to build [I]. This
has not been measured.

### 8.3 Items 6–30 (the rest of SELECTION)

Order:
1. **Kit reuse first:** n8n 19463, 17541, 19295, 18122, 11805 and 16639, and HA llmvision, tesla, the TheFes washing
   machine and apple_watch.
2. **Cheap controls:** canboat (runnable); dagster and temporal, reported apart as calibration; prefect; WorkflowHub
   251; two Shortcuts; two ADK; Node-RED.
3. **Heavy science last:** three nf-core items, capheine and pooled-PCR. They need acquisition and either containers or
   tool tapes. This container has no Docker daemon, so their original controls would be emulated or transcribed. The
   C-priority items (capheine 20 h, pooled-PCR 24 h, loan agent 12 h by SELECTION's estimate) are excluded with a named
   reason if acquisition fails.

Estimated cost [I]:

| Component | Estimate |
|---|---|
| 25 items at the measured $7–14 | $180–350 |
| Second verifies on about 8 items | $30–50 |
| Kit consolidation | $20–40 |
| Twins | $50–100 |
| **Total (list-price equivalent)** | **about $280–540**, about 38 agent-hours, about 13–19 h of wall time at 2–3 concurrent agents |

Two days at the earliest, paced by the allowance (the 2026-10-06 incident is the precedent).

### 8.4 Items 31–100

- **Pool.** Re-run the pinned acquisition scripts for items published after the newest builder model's cutoff
  (synthesis §3.1 estimates 1–2 agent-days and no model spend). Apply the eligibility filter by script: licence; 4–60
  nodes; mockable effects; no GPU; an author description of at least 60 characters, for T2. One selection pass costs
  about $0.3 per item for twice the candidates needed.
- **Quotas.** Clusters: automation 25, orchestration 20, science 20, consumer-creative 20, agentic 15. At most 12 items
  per platform. At least 40% dated after the cutoff. At least 25% judgement-bearing. At least 20 with a documented or
  suspected defect, for T3.
- **Near-duplicate check** against the first 30 and across platforms: graph hash plus description n-grams.
- **Sealed split, 60 development and 40 sealed.** The sealed items' harnesses are built by agent sessions with no
  access to the builder kit, the prompts or any R-bench results. They are frozen by hash and read once by one
  pre-registration, after the IR freeze. This is the claim-bearing round the synthesis asks for.
- **Cost [I].**

  | Component | Estimate |
  |---|---|
  | 70 builds at $7–14 | about $500–950 |
  | Second verifies | about $100 |
  | Twins | $150–250 |
  | **Total** | **about $1.0–1.3K list-price equivalent**, 105–130 agent-hours, about 35–45 h of wall time at 3 concurrent agents |

  At allowance pace that is 1–2 weeks.
- **Not automatable.** These need the owner or new infrastructure:
  - a real-platform confirmation lane: a Docker host running n8n, HA core, `act` and planemo against the same HTTP
    mocks, with emulator-vs-real trace diffs on about one item per platform;
  - a second annotator for labelled items;
  - licence edge cases;
  - credential redaction;
  - sealed authorship.

## 9. Threats to validity

| Threat | Pilot evidence | Mitigation | What remains |
|---|---|---|---|
| **Recall: items in training data, so T2 (and T1 fixes) can be memorised** | all five pilot sources are public; n8n:20281 is dated 2026-10-01, after the June 2026 cutoff given for Opus 5.5 in this session's model information [D, unverified against a model card]; Haiku 5.5's cutoff is [unk] | (1) Memorisation probe per item and builder model, before any build: reproduce the workflow from title and platform alone, three samples; score node-type multiset overlap and the share of distinctive constants reproduced; "known" if Jaccard ≥ 0.6 or constants ≥ 0.5 (frozen); known and unknown items reported apart. (2) A perturbed twin per item: entities renamed, constants shifted, one branch flipped, oracle regenerated by the item's generator; T2 runs on twin and original; a gap over 20 points marks the arm's T2 as recall-suspect. (3) Item dates taken from the item itself (template `createdAt`, first commit of the file), not the repository head. (4) Source firewall: R-bench repositories and template families are excluded from skeleton mining, worked examples and the Haiku kit, with the near-duplicate check | twins test surface recall, not recall of the idea; at least 5 of the 30 SELECTION items are post-cutoff by `createdAt` (n8n 20281, 19463, 19295, 18122, 17541) |
| **Model-written job descriptions** | 4 of 5 pilots' T2 texts are restatements | verbatim author text plus the sufficiency check (§3.2); restated cells reported apart | thin author texts make T2 lean on the examples |
| **Mocks simplify reality** | no original ran on its real platform; the galaxy emulator and reference share one reading; HA semantics were wrong from memory; n8n output shapes, duplicate handling, time zone and empty values are assumptions; real TTS timing drifts; the PR action's behaviour is recalled | assumption ledger with source class; every verdict lists the assumptions its scenarios depend on; a sensitivity run flips each contested assumption and reports which arm verdicts change; the real-platform lane when a Docker host exists | claims are limited to *logic replication against mocks*: no deployment, rate-limit, auth or pagination realism |
| **Oracle over-specification** | 11 correct designs rejected by v1 (order, punctuation, time zone, text layout, label sets, semantics) | an alternative design per item must pass; judge state and effects, not call patterns; second verifier on a third of items; after the freeze, no oracle change within a run: a suspected over-specification is logged, and the analysis shows the frozen result (primary) next to the flagged checks removed | tolerance rules such as galaxy's 18/20 trade over- against under-specification |
| **Oracle under-specification** | 18 wrong-solution classes passed v1; 5 still pass after v2 | generic attack suite plus agent attack; residual-hole audit; known residual classes listed per item in the pre-registration | holes no attacker found yet |
| **One author, one model family** | Sonnet built and Opus verified every harness; Opus also builds F-opus | alternative-design controls; shipped outputs where they exist (galaxy); owner spot-check of one item's scenarios; correlated blind spots stated plainly | no non-Claude reviewer is available |
| **Answer key in the repository** | 420/420 passes from reading the selenium fixtures; n8n:20281 labels and recordings; HA env helpers | builders run in-runtime; scripts and `code` in a no-network sandbox outside the repository; B0-agent and free builders only after isolation; leak tests | depends on gates G4, G5 and §7 item 5 |
| **Burned seeds and fixed streams** | seeds 0–27 inspected; n8n:20281's 80 mails fixed; HA scenario order fixed | test seeds 10001+, generated only at the freeze; item-level analysis; stateless arms only (no memory across episodes) | n8n:20281 needs fresh mails before any sealed use |
| **Single-author labels** (n8n:20281) | two-annotator check not done; thresholds tuned to a recorded classifier | live Haiku in the arms (scored in-process with `trustModelTape`); report per-class confusion; owner or second-model spot labels on 20 mails before run 1 | label noise caps measurable accuracy |
| **Runtime confound** | Foundry 1.1–2.5 s per run against 0.19–0.37 s for the original | latency raw and net of engine overhead; E1 engine freeze; original re-measured on the arm machine | T3 latency targets penalise Foundry's fixed overhead by design |
| **Cost accounting** | `.mjs` solver cost recorded as $0; model tapes trusted only in-process; harness orchestration not itemised; hidden reasoning | journaled ModelPort and gateway ledgers only; unknown cost charged at its cap; harness cost reported as lower bounds (§7) | orchestration remains the main untracked spend |
| **Prompt injection in corpus text** | none planted yet | construction-time provenance taint (§7 item 4) and the planted-instruction slice before any builder reads third-party text; secret scan of task text | — |
| **Licence** | `controls/reference.mjs` of n8n:20281 shares 32.8% of its 8-word sequences with the original | non-redistributable definitions and descriptions materialised at task time and never committed; clearance before any publication | — |
| **Small, harnessable sample** | the pilots were picked for having shipped data or mockable effects | report per item; stratify the 100; never generalise from five | — |

## 10. Pre-registration skeleton: `rbench-r1` (fill in and commit before the first arm runs)

| Field | Value |
|---|---|
| Experiment id | `rbench-r1` |
| Claim tested | C0 (construction) and C1 (cheap execution) on real workflows; C6 executed coverage, diagnostically. Stated as: "On real hand-built workflows, Haiku-built Foundry workflows reach success non-inferior to Opus-built ones at lower amortised CPS, and beat direct execution on CPS at the item's natural run count." |
| Evidence class | **development** (report-only, directional). Harnesses were written and attacked by the same agent pool, and the items are public |
| Pre-registration commit | `git rev-parse HEAD` after committing `research/replicate-20261008/PREREG-r1.md` |
| Engine | E1 freeze hash (rule 13); CLI flags recorded |

1. **Items and splits**
   - The 5 pilots at the frozen harness versions (galaxy v2, n8n:12679 0.2.0, n8n:20281 0.2.0, HA 0.2.0, selenium
     0.1.1, or their pre-run fixes). Record the path and sha256 of each `index.mjs` and `oracle`.
   - Test split, seeds 10001–10003, difficulty 3, generated once at the freeze, with the canonical task hashes in
     `FREEZE-r1.json`.
   - Construction probes: dev seeds 9001–9002.
   - Twins: the same test seeds through each item's twin transform, T2 only.
   - Burned seeds recorded: 0–27, both splits, all items.
2. **Controls before any arm**
   - On the frozen test seeds: original or emulated original passes; reference passes; alternative design passes;
     every bad control fails.
   - Generic attack suite run.
   - An item failing the health gate is excluded. More than 2 of 5 failing stops the run.
3. **Arms** (table in §4)

   | Arm | Types | K_c | Test seeds | K |
   |---|---|---|---|---|
   | B0-haiku | T1, T2, T3 | — | 3 | 2 |
   | B0-opus | T1, T2 | — | 3 | 1 |
   | F-opus→haiku | T1, T2, T3 | 1 | 3 | 2 |
   | F-haiku | T1, T2, T3 | 2 | 3 | 2 |
   | B1-haiku | T1, T2, T3 | 2 | 3 | 2 |
   | C-det | T1 | — | — | — (n/a, reported) |
   | Twins (T2): F-opus, F-haiku | T2 | 1 | 3 | 2 |
   | Twins (T2): B0-haiku | T2 | — | 3 | 1 |

   B0-opus does not run on twins, to save cost; its recall gap is not measured in run 1.

   Frozen arm definition hashes come from `armHash`. Model settings: Opus 5.5 at effort medium (thinking cannot be
   disabled); Haiku 5.5 at the arm's declared reasoning. The 300 s per-call timeout is stated.
4. **Measurements** (§5)
   - Primary: verified job success per arm and type, macro over items.
   - Secondary: CPS_N at N = 1, 10, N_item; N*; latency; pass^K and end-to-end reliability; T3 improvement ratios;
     the fidelity–intent gap; validity, lint and verdict agreement; the coverage record (§6.1); router labels (§6.2).
5. **Power**
   - 5 items, i.e. 5 clusters. 45 instance outcomes per arm, 30 for B0-opus.
   - The study is powered for nothing (ROADMAP §4.3: +10 points needs 116–234 paired tasks). Every result is
     **directional, no decision**, declared in advance.
6. **Analysis**
   - `experiments/replicate/analyze-r1.mjs` (sha256 recorded at the freeze).
   - Item-clustered bootstrap, B = 10,000, reported as spread, not inference. Gaps under 3 points are noise.
7. **Decision rules.** These choose the next step; they are not claims.

   | Rule | Condition | Consequence |
   |---|---|---|
   | DR1 Haiku as builder | F-haiku success ≥ F-opus − 15 points (macro), and CPS_10 ratio < 1 | Haiku-first construction stays the default for automations; otherwise "Opus builds automations" for the 30-item round |
   | DR2 IR vs script | B1-haiku ≥ F-haiku on success and on CPS_10 on at least 4 of 5 items | the input to the C0 sealed kill rule "typed IR kept only where verdicts and replay are needed" |
   | DR3 direct vs built | per item, the cheapest arm within 10 points of the best at N_item gives the mode label | B0-haiku winning on at least 3 of 5 items is recorded as a negative result for "workflows pay off on recurring jobs" |
   | DR4 recall | twin minus original over 20 points for an arm | that arm's T2 is flagged recall-suspect, and known items are reported apart |
   | DR5 improvement | at least one arm passes T3 on an item | the item counts as "improved", with its r_d |
   | Scale-up gate | at least 4 of 5 items healthy on fresh seeds, and the adapter ran forms O, E and P with harness faults under 10% | go to the 30-item round, whatever the arms' scores |
8. **Stop rules**
   - Recorded spend over **$300**: stop starting constructions, finish in-flight work, report partial results.
   - The health gate (step 2).
   - The runner's environment-fault stall (more than 25% after 8 attempts).
   - Any canary or egress probe firing.
   - **B0-opus calibration:** one smoke episode per item first; if the projected B0-opus total exceeds $80, B0-opus
     drops to T2 only (pre-registered).
9. **Preconditions** (each a checkbox in the pre-registration)

   | Gate | Requirement |
   |---|---|
   | G1 | E1 engine freeze |
   | G2 | structured builder v0 exists and passes its smoke |
   | G3 | synthesis §7 items 1 + 2: control-flow taint and the sink-field policy. Honest "webhook → write row" items compile; mock-bound effects are allowed under D15 |
   | G4 | §7 item 4: construction-time provenance taint, with the planted-instruction slice passing |
   | G5 | §7 item 6: model-written code sandboxed |
   | G6 | §7 item 8: acceptance lint |
   | G7 | runner shim and form O/E/P adapter in `experiments/replicate/`: loader, variant pass-through, definition materialisation with sha check, `trustModelTape` in-process, gateway metering |
   | G8 | T2 verbatim descriptions plus the sufficiency check per item |
   | G9 | twins built and verified; memorisation probes run and their thresholds frozen |
   | G10 | an alternative design passes for n8n:20281 and the selenium item |
10. **Cost** [I]. Per-construction figures scale C0 dev's measured $2.26 (Opus F), $0.96 (Haiku F) and $1.11 (Haiku B1)
    to R-bench task text of 2–17K tokens. The structured builder is unmeasured.

    | Component | Calculation | Estimate |
    |---|---|---|
    | F-opus | 15 constructions × $2–4 | $30–60 |
    | F-haiku | 30 × $0.5–1.5 | $15–45 |
    | B1-haiku | 30 × $0.05–0.5 | $2–15 |
    | Executions | 75 artifacts × 3 seeds × 2; mostly $0 for code-only, about $0.01–0.2 per episode with Haiku nodes | $4–35 |
    | B0-haiku | 90 episodes × $0.02–0.15 | $2–14 |
    | B0-opus | 30 episodes × $0.5–4 | $15–120 |
    | Probes and twins | memorisation probes $1–3; twin constructions 5 F-opus × $2–4 and 5 F-haiku × $0.5–1.5; their executions; 15 B0-haiku episodes | $15–38 |
    | **Total** | | **about $85–330, expected about $170**. The upper end exceeds the $300 stop, which then binds. All of it is under the $500 owner pause |

    A lean variant (K_c = 1 everywhere, B0-opus on T2 only, twins for F-haiku and B0-haiku only) is about $60–200.
11. **Threats:** §9, with each item's known residual wrong-pass classes listed.
12. **Amendments:** dated entries only. Inspected test seeds are recorded as burned.

## 11. Owner decisions

| # | Question | Default |
|---|---|---|
| R-1 | Your reply puts R-bench where your 20–30 tasks would go. Should R-bench replace rung 3, or should you tag the SELECTION items you would actually want done (owner-relevance labels)? | R-bench stays rung 2a; rung 3 is reported missing if no tasks arrive by 10-28. Tagging 5–10 items takes minutes and adds relevance without new oracles |
| R-2 | Run-1 size: the arm set above (about $170 expected) or the lean variant (about $110)? | the arm set above, with the B0-opus calibration rule |
| R-3 | A real-platform confirmation lane needs a host with a Docker daemon (D5 allows the image pulls; this container has no daemon). Provide one? | no; R-bench claims stay "logic replication against mocks" |
| R-4 | Cosmetic defects under T3: keep fidelity grading for galaxy's doubled FILTER label? | keep (no oracle change after verification) |
| R-5 | Allowance for items 6–30 (about $280–540 list-equivalent, about 38 agent-hours), then 31–100 (about $1.0–1.3K, 105–130 agent-hours) | build 6–30 after run 1's scale-up gate; 31–100 after the IR freeze, with the sealed 40 built by isolated sessions |
| R-6 | `n8n:18122` embeds webhook URLs that look like live credentials (public template); nothing was copied | for your information |

## 12. Sources

- `research/replicate-20261008/SELECTION.md`
- `experiments/replicate/selection.json`
- `experiments/replicate/items/*/README.md`, `index.mjs`, `controls/report.json`
- builder and verifier reports of 2026-10-08, quoted in §2
- `research/replicate-20261008/harness-cost.mjs` and `harness-cost.json`
- `beds/CONTRACT.md`
- `experiments/lib/{beds,runner}.mjs`, `experiments/lib/arms/*.mjs`
- `skills/micro-harness/references/{ir,operators}.md`
- `schemas/workflow.schema.json` (node kinds `task`, `assert`, `human`, `map`, `loop`, `wait`, `agent`, `code`, `verify`)
- `research/review-20261007/00-SYNTHESIS.md` §3.1, §3.4, §3.7, §5, §6, §7
- `research/review-20261007/02-ir-expressiveness.md` §7, §8
- `research/corpus-20261006/COVERAGE.md` §7, §8. Its oracle tiers T1–T3 are not R-bench task types.
- `docs/THESIS.md` §10 (D8–D16)
- `docs/ROADMAP.md` §2.5, §2.8, §2.9, §4
- `research/construction-20261006/REPORT-dev.md` (C0 per-construction costs)
- `README.md` (P1 timeout lesson, cost ledger, decisions)
- `policy/models.json` (policyVersion `2026-10-07.1`)
