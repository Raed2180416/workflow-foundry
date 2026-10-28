# DUR-1 design: does a Haiku-built E8 workflow hold up in the worst case, notice change, heal, and stay healed?

*Synthesis, 2026-10-22, revised about 04:35Z. Status: **DRAFT** (the build and review come next; the Fix phase freezes
[PREREG-DUR-1.md](PREREG-DUR-1.md)). Read at main-tree HEAD `056d70fa` and, read-only, the gap-closure branch
`worktree-wf_0f86d12b-ab5-2` at `9e2a2b61` (FH-1 result committed) and the Move 0 branch `worktree-wf_bba577b8-b58-1`
at `d3bd7acf` (`certify.mjs`). No model was called and nothing was committed; the only things run were $0 power
simulations (prereg §11). `beds/sealed/` and AutomationBench devCheck/test tasks were not read. Paths are relative to
`/home/user/workflow-foundry`. The build plan is [BUILD-PLAN.md](BUILD-PLAN.md).*

## 0. In one paragraph

DUR-1 runs nine Haiku-built E8 order-saga programs (3 monoliths, 6 composed of sub-workflow modules), in the versions
FH-1 commissioned, through three independent streams of six 14-day worlds each (84 world-days per stream). Nine changes
land along each stream: a new rulebook edition, an unannounced API rename (later reverted), an announced rule change,
a sealed announced rule change, a load shift into compensation branches, a platform fault ramp, a sealed unannounced
environment drift, adversarial content, and a sealed unannounced change of meaning that only customer complaints
reveal. Each program runs static and with an oracle-free monitor plus a Haiku heal loop (FH-1's contract-gated patch,
with the two additions FH-1 itself recommends). It is compared, on the same cases, with: the hand-crafted reference
static and maintained by a perfect expert after a delay of 0, 2 or 7 days ($0); three Opus-written programs (S1–S3)
static and maintained by Opus 5.5 xhigh; a per-tick Haiku agent with validator; and a small Opus 5.5 xhigh per-tick
probe. Before and after the streams, a $0 worst-case search and an Opus red team attack the same programs. Every arm
except the agents and the maintainers costs $0 per world, so $80 (D24) buys K = 9 lineages × 3 streams. A $0 stage can
kill the claim before any paid heal. Everything is development evidence.

## 1. Owner question → what DUR-1 measures → verdict

| Owner question | Measured by | Verdict |
|---|---|---|
| "Is the workflow that's created good enough in the worst case?" | Silent wrong cases (case level, at first divergence), silent critical cases, per-class worst lineage and worst world, worst-world pass rate on the frozen adversarial set (WC-1 search + J2 red team), out-of-contract harm, zero-event bounds per world | D-5 (with D-11) |
| "Does it adapt and heal as it does real work?" | Heal (MH-H) against static (S-H\*) on change-induced cases; durable share; time-to-durable (TTD) per change; detection delay; heal precision; regressions; forgetting (the rename is reverted); patch locality in composed programs | D-1 (primary), D-6, D-10 |
| "Have we tested its performance as it changes?" | Per-world and per-day success curves for every arm over 6 worlds and 9 changes on 3 streams | reported for every arm |
| Self-healing reaches "a durable state equal to or better than a human's" [46][70] | Final-week success, TTD and maintenance $ against a perfect expert with delay L ∈ {0, 2, 7} days and against Opus-maintained S1–S3 | D-4 |
| "Versus an agent doing every tick"; "beat Opus 5.5 xhigh at a fraction of the cost" | Paired cases against the per-tick Haiku agent; $ per correct case against the agent, the Opus maintainer and an Opus xhigh per-tick probe | D-3 (primary), D-2, D-7 |
| Runs expose flaws in a hand-crafted workflow | Six mined latent defects healed from complaints; false complaints never promote harm; retroactive sweep | D-8 |
| "Every failure deeply figure out" [106] | A root-cause record per failing class per arm and per unhealed change; no result text before the ledger is complete | protocol rule |
| Sub-workflows in long-horizon enterprise tasks | 6 of 9 lineages are composed; patch locality; one patch fixing every entry point | reported |

"Assuming the router is met": E8 is a router-positive family by the need router's own primitives (recurring work,
timers and state, irreversible money effects, exactness). DUR-1 takes the routing decision as given.

## 2. How this design was chosen

Three designs were drafted and judged twice (rigor and owner fit). **Cost-first won (8/10 in both judgments)**: every
arm except the agents runs at $0 per world on E8, it falsifies cheaply (a $0 kill rule before any paid heal), it uses
nine lineages, it separates change damage from base defects with twin worlds, and it is runnable this week. The final
design keeps its skeleton and grafts the judged-best ideas from the other two:

| Graft | From | Why it was judged better |
|---|---|---|
| Silent wrong cases as the headline, counted per case at first divergence, worst lineage and worst world before means, always paired with loud failures, false alarms and escalations | worst-case-first; rigor judge's anti-gaming fix | The owner asked about the worst case; a silence metric alone can be gamed by alarming on everything |
| Frozen scenario-class taxonomy (IP, OOP-S, CHG-A, CHG-U, FLT, ADV, RT, OOC); out-of-contract scored on harm and loud/silent only | worst-case-first | Keeps every number in its class; no claim from undefined behaviour |
| WC-1 $0 search: exact-weight importance half (ESS, CVaR10%) and local-search half; LDFI fault pairs on each order's effect lineage; fresh-salt confirmation and transfer to unsearched lineages | worst-case-first; adaptation-first (fresh re-draws) | Worst cases come from search, not more seeds; combined faults never tested; winner's curse and selection bias guarded |
| J2 red team with `probe.mjs`, a $0 validity gate (oracle-breaking worlds are bed findings), a blind-search baseline with the same probe budget, a cross-run at t0 and stream end, red-team worlds kept out of every heal regression set | worst-case-first; rigor judge | The thin $5 red team of cost-first had no validity gate and no baseline |
| Stale-verifier ablation; "detects" claimed only from unannounced changes, "the unknown" only from sealed ones | worst-case-first | Verifier staleness is the predictable worst case of a heal loop |
| S1–S3 static and Opus-maintained (REF-S, REF-M) beside the $0 perfect-expert curve R-maint(L) | worst-case-first; owner-fit judge | "≥ human" needs a measured maintainer, not only a ceiling |
| Complaints drawn from a seeded u(stream, world, case) shared by every arm, false complaints at a rate, detection reported with and without complaints | adaptation-first | Makes the feedback channel arm-independent and declared |
| Incremental twins (all earlier changes on, only the new one off) computed on the frozen reference as exposure denominators | adaptation-first; rigor judge | Cost-first's "twin = changes off" was ambiguous for cumulative changes |
| A reverted change (the rename is gone in W6), adversarial content, a canary before promotion | adaptation-first | Tests over-fitted heals, injection, and safer promotion than rollback alone |
| Owner question → metric → verdict table, root-cause records, a monitor-only arm (W-M0) | adaptation-first | Owner-facing; shows what healing adds beyond detection |
| Rule-of-three bounds per world, primary tests clustered on lineage, margin on the FH-1 cost prior, starting versions frozen only after FH-1's verdict | both judges | Cases cluster by lineage and world |
| AutomationBench-R slawatch in carry mode as DUR-2 | adaptation-first, as follow-on | E8 has no cross-case state; the ABR runner and wf-H builder do not exist yet |

**Declined, with reasons.**
- *Adaptation-first's ABR primary leg.* `experiments/autobench/stream.mjs`, the `wf-H` builder, `gen.py --weeks` and
  `serve --faults` do not exist; no model has run on any family; new oracle-side code would have no mutation evidence.
  It is DUR-2.
- *Widening the Opus xhigh per-tick agent to every sealed window × 2 streams (owner-fit graft 4).* Not affordable
  under D24: OT-0 measured an Opus 5.5 per-tick E8 agent at **$1.284 per case** at default effort without a validator
  (`research/org-20261021/RESULT-OT0.md:50`); xhigh with a validator costs more, so four 6-case windows would cost
  roughly $30–120. DUR-1 instead (a) measures the frontier on the *same job* the cheap system does (REF-M: Opus xhigh
  maintaining Opus-written programs, K = 3), and (b) runs a small A-Ox probe (≤ $7) on sealed-change cases. The
  orchestrator may add a comparator-only top-up, as D19 and D26 did for AutomationBench (§7).
- *A Mercury 3 per-tick row.* D28 (7) stops new Mercury pilots until the allowance is read
  (`research/decisions-20261021.md:51`). Mercury tokens: 0.
- *CUSUM, invariance contracts, N-version voting as a gate.* K15 failed, K4 flagged 0 of 18, and N-version voting had
  precision 0.609 and 0/92 on go-live (`research/heal-20261021/PREREG-FH1.md:84-97` on the branch).

## 3. Facts checked since the three drafts (they change the design)

1. **FH-1 has a committed result** (`9e2a2b61`, 03:04Z): with the 13 contracts as verifier, one Haiku session per
   program removes 357/475 real failing cases with 0 regressions for $1.142; post hoc, "heal until the verifier is
   clean, at most two fresh sessions" reaches 475/475 and 8/8 programs at 1,022/1,022 for $1.451
   (`research/heal-20261021/RESULT-FH1.md` on the branch, §3.2–3.4). Session cost: mean $0.143, median $0.073,
   range $0.036–0.397 (§5). So the starting versions can be frozen now, by an oracle-free rule.
2. **FH-1 names the next lever**: the patcher could not see raw error payloads; the one `ch-e8-3` miss was a one-token
   classifier defect (`err.code` instead of `err.reason`) behind a flattened smoke report (§4, §8.1). DUR-1's heal adds
   raw effect results to `FAILURES.md` and preregisters heal-until-clean. Under an unannounced API rename this is
   exactly the evidence a patcher needs.
3. **D28 constrains claims** (`research/decisions-20261021.md:51`): no heal claim until it passes the certification
   gauntlet (Move 0, `experiments/lib/certify.mjs`, being built on `worktree-wf_bba577b8-b58-1`); every headline carries
   the reachable-subset (ceiling) column and each node's effort, temperature and cap; a paid run with effort unset is an
   error; no Mercury pilots. The AGENTV and OT-0 agent runs used the CLI default effort (`effort: null` in
   `research/enterprise-20261014/runs/agentv-e8-s12/result.json`), so DUR-1 sets effort explicitly and re-measures the
   agent's cost per case in rehearsal.
4. **Seeds 1161–1168 belong to the composition harness** (`experiments/compose/validate.mjs:2`,
   `experiments/compose/test/capabilities.test.mjs:2`). Both cost-first (1167–1184) and worst-case-first (1167–1182)
   overlapped it. DUR-1 uses **1171–1188**. A repo search found no use of 1169–1199 in the composition, enterprise,
   org, heal or E8 files.
5. **The ledger cannot take a new E8 row.** `experiments/lib/ebed-seed-ledger.test.mjs:19-46` requires exactly
   2 + 13×4 + 9 E-bed rows, disjoint, and `experiments/jit/seeds.mjs:17` knows no `draft` status. The draft claim is
   therefore a dated sentence in the `use` text of `ebed-dev` and `ebed-e8-rehearsal` (the OT-0 precedent) plus a
   `research/durability-20261021/SEED-CLAIMS.json` row with status `draft`.
6. **The capability contracts read truth-side case bookkeeping.** `factsOf` reads `world.truth.cases[c]` (order id,
   placement, class prefix `gl-`, customer) and the journal index maps events to cases through `truth.eventCase`
   (`experiments/compose/capabilities.mjs:57-90`; `beds/ebed/oracle/view.mjs:23-24`). They never read expected outcomes,
   but a deployment would have to correlate events by normalised order references. DUR-1 adds a $0 validity check (V-9)
   with a payload-derived case index and reports detection with and without the contract channel if the two disagree.
7. **Data and API changes need no oracle or contract edit.** Editions are read through `editionAt`
   (`beds/ebed/e8/transition.mjs:32`; the contracts do the same, `capabilities.mjs:50-53`), and an F5 rename on any
   effect op is generic in the host and the journal view (`beds/ebed/host/faults.mjs:11,57`; `view.mjs:23`). Only rule
   changes edit a copy of the transition (`experiments/compose/drift.mjs:21-76`), whose D1 edit is not date-gated yet.
8. **Same-instant duplicates are partly out of contract.** M4d cost every subject 8 cases on 1161 d2
   (`research/composition-20261021/RESULT-COMP1.md:299-301`), and a same-instant duplicate placement of a review order
   is an MR5 contract gap. The in-stream fault ramp therefore uses crash-after-apply, restarts and delayed duplicates;
   same-instant duplicates go to the OOC class of the worst-case search.
9. **The host machine restarts** (register C9, three restarts on 10-22: `research/compromises-20261021/REGISTER.md:82`)
   and the disk had 1.9 GB free at 04:27Z. Every DUR-1 runner resumes from its last commit, treats a kill as an
   environment fault, and keeps ≤ 300 MB.
10. **Move 0 exists and has re-scored FH-1** (`worktree-wf_bba577b8-b58-1` at `d3bd7acf`, not yet on main):
    `certifyHeal` in deterministic mode certifies 7 of 8 H-C k1 heals ([0.47, 0.997]) and 5 of 5 k2; the own gate of the
    no-verifier arm accepted 8 of 8 and certification none. Case outcomes inside an incident × class cell are identical
    (ICC 1.0), so FH-1's 475 cases are worth n_eff 21.6 (`MOVE0-CERTIFY.md` §3.2). DUR-1 therefore counts heals in
    cells (lineage × stream × change), certifies every promotion with `certifyHeal` under a fixed evidence mapping
    (prereg §10, *Certification*), and makes D-1 depend on the certified-durable share. `certify.mjs` imports only
    `stats.mjs`, `stats-builds.mjs` and `gauntlet.mjs`; the first two are byte-identical to main's, so the build can
    import it read-only from `d3bd7acf` if it is not merged by the freeze.
11. **The preregistration template was amended on 10-21 (B7, A4)** and merged into main (`056d70fa`): a banner with the
    unit, K, cases per build, a *measured* σ and a *computed* MDE; build-level tests only; gaps under 3 points are
    noise. Measured here at $0: the 9 programs' as-delivered pass rates on the FH-1 grading pool have SD 0.043
    [0.029, 0.083]; the exact sign-flip MDE for D-1 is 0.047 (0.091 at the upper SD); D-3's simulated power is 0.59 at a
    true tie (prereg §11). D-3 was changed from a window-only bootstrap (lineages averaged first, which hides the build
    spread) to a two-way bootstrap over lineages and windows, and every 2-point rule became 3 points.
12. **OT-0 is committed** (`research/org-20261021/RESULT-OT0.md`): on the d2 sized world, Haiku + validator (A-HV) scored
    14/14 for $0.163 per case, and A-F Opus 5.5 (default effort, no validator) 6/14 for $1.284 per case, its 13 arm
    errors all one host refusal that the validator returns before commit. So A-Ox runs with the validator (a fair
    frontier comparator), and its cap rests on the $1.28 measurement. Frontier yardsticks per *task*: Opus 5.5 xhigh
    $0.385 on AutomationBench look 2 and $0.41 on SOP-Bench dev60.
13. **The operating principles name "Haiku 5.5 max" for cheap implementation** (`research/OPERATING-PRINCIPLES.md` §7).
    DUR-1 keeps FH-1's frozen effort (high) for heal sessions, because FH-1's costs and certified heals are its evidence
    base; the deviation is disclosed, and effort is a later lever, not a DUR-1 factor.

## 4. The design

### 4.1 Bed

E8 (`beds/ebed/e8`, bed digest `b9e5a67138d42a7f`): one shop over 14 days, an exact oracle with controls, mutation and
specificity evidence (three blind solvers at 1,749/1,749, `beds/ebed/e8/README.md:6-9`), a fault battery
(`experiments/compose/faults.mjs`), a drift harness (`drift.mjs`), metamorphic relations, six mined latent defects with
true and false revealing events, nine Haiku-built programs that cost $0 per world and replay byte-identically, and a
per-tick agent runner with a validator. **Limit, stated up front:** E8 is per-instance (README E8-9); errors that
compound through state carried across cases cannot be tested here. That is DUR-2.

### 4.2 Streams and changes

Three streams; each is six d3, tail-mix worlds (80 arriving orders; W6 160), seeds 1171–1176, 1177–1182, 1183–1188. The
program version carries from world to world. Changes are cumulative unless stated:

| World | Change (class) | Seen by arms as |
|---|---|---|
| W1 | none: the in-control and false-alarm segment | — |
| W2 | **P1** new rulebook edition ed-2026-3, published d3, effective d6 (CHG-A, spec-anticipated) · **E1** `carrier.create` `location` → `site` from d9 (CHG-U) | rulebook files · `400 field-renamed` |
| W3 | **R1** D1 `review-timeout-clears`, spec v2 published d2, effective for orders placed from d5 (CHG-A) | new spec text |
| W4 | **R2s** sealed rule change, announced (CHG-A, unseen by the designer) · **L1** compensation-heavy load (MR11 failures on 15% of straight orders) | spec text · none |
| W5 | **F** fault ramp: crash-after-apply 0→15% of effectful ticks, restarts, delayed duplicates (FLT) · **E2s** sealed unannounced environment drift, onset d3–d6 by the author's choice (CHG-U) · **ADV** instruction lines in every order document, plus one adversarial complaint | errors and files · documents |
| W6 | **E1r** the rename is gone (revert) · **U1s** sealed unannounced change of meaning, onset d3–d5 by the author's choice, revealed only by complaints (CHG-U) · 2× volume; faults off | complaints only |

Every changed world has incremental twins (all earlier changes on, only the new one off) and a base twin (all DUR
changes off). A case is *exposed* to a change when the frozen reference's expected effects or requests differ between
the world and that twin; a failure is *change-induced* when it fails in the world and passes in the twin under the same
version timeline. All of this is $0 and oracle-side; for sealed changes only counts are printed before the end.

### 4.3 Arms

- **S-H\*** (static) and **MH-H** (monitor + Haiku heal): the nine commissioned programs. **S-H** (as delivered) is a
  descriptive row. **W-M0** is S-H\* with the monitor attached and no heal (an analysis view, $0): what detection alone
  buys.
- **Forks of MH-H**: **MH-H→O** (one Opus xhigh patch after two rejected Haiku sessions on an incident), **MH-stale**
  (no contract update at R1, stream s1).
- **R-static** and **R-maint(L)**: the reference policy, frozen or switched to the true new rule L ∈ {0, 2, 7}
  world-days after the change becomes knowable (at publication if announced, else at the first deployment-visible
  signal on its own journal). **R-ceil** switches at the first oracle failure (an upper bound).
- **REF-S** and **REF-M**: S1–S3 static (all streams), and maintained by Opus 5.5 xhigh with the same channels and gate
  as MH-H (stream s1).
- **A-H**: a per-tick Haiku 5.5 agent with the AGENTV validator, effort high, on *case-routed windows*; **A-Ox**: the
  same at Opus 5.5 xhigh on a few sealed-change cases. **c-oss** (literal port of the Temporal reference app) is a
  descriptive row.
- **LD-H**: the six latent defects as hand-crafted programs, healed from complaints.

### 4.4 Monitor and heal (frozen in the prereg)

Channels: m1 errors and host refusals; m2 the 13 capability contracts (re-certified by an Opus contract owner, C-O, at
announced rule changes and on verifier-blind complaint incidents); m3 the OT-0 observer's clause C1 (conservation,
exactly-once); m4 announcements and config digests (spec text, rulebook files, API schemas); m5 complaints; m6 an
input-profile e-detector (`profile.mjs` features, conformal rank p-values against a fixed practice calibration, power
bet ε = 0.3, e-CUSUM h = 10,000: an alarm after 4 consecutive maximally novel cases). m6 is measured and never opens a
heal: it is the held-out test of the K15 lead.

Incidents are classified first (FH-1's ladder: re-execution, then defect). A heal is one Haiku 5.5 session (effort
high, $0.50, 20 min) with `FAILURES.md` built from contract classes **plus the raw effect results of example failing
cases**, at most two sessions per incident (heal until the verifier is clean). The evidence is leak-free: under an
announced change the smoke loop runs practice worlds with the announced overlay; under an unannounced change it replays
only cases the arm has already seen to completion. A code gate, then a one-day shadow canary, then a compare-and-swap
promotion at a day boundary; a rollback within two world-days if new contract failures appear.

### 4.5 Case-routed windows (replacing teacher forcing)

Cost-first started agents from the reference's journal prefix with `resumeRun`, which may not accept a foreign prefix.
Because E8 has no cross-case state, DUR-1 instead runs the agent **inside the real stream world on selected cases
only**: a routing arm sends the ticks of the selected cases to the agent and every other instance to the reference
policy. The code arms' outcomes on the same cases are read from their own stream runs, so every comparison is paired by
case, nobody pays twice, and the agent sees exactly the world state the code arms saw. The selection rule (the first
six exposed cases after the onset that complete, plus two seeded unexposed controls) uses only the frozen reference.
This also removes the backlog and stray cases from the agent's bill.

### 4.6 Worst case

Every number is reported per class (IP, OOP-S, CHG-A, CHG-U, FLT, ADV, RT, OOC). WC-1 searches a typed knob space (fuzz
bases 1301–1310 with derived salts, difficulty 2–5, mix, size or scale tier, ≤ 2 in-spec metamorphic transforms, a fault
or an LDFI fault pair, designer-known change overlays) against every code arm at t0 and at stream end: half
importance-sampled with exact inclusion weights (ESS, CVaR10%), half local search. The J2 red team (two Opus xhigh
sessions and one Haiku session, white-box, 25 probes each) proposes worlds behind a $0 validity gate. The union of
confirmed worst worlds and valid red-team worlds (ADV-SET) is frozen, re-drawn on fresh salts, transferred to the
lineages it was not searched against, and run on every code arm and on two routed agent windows. A harm shield on the
effect port (`experiments/constitution/port.mjs:33`) is a $0 ablation: would it turn silent critical failures into loud
refusals?

### 4.7 Statistics

Primary tests are D-1 (heal versus static) and D-3 (non-inferiority to the per-tick Haiku agent), Holm-corrected at
one-sided α = 0.05. D-1's unit is the lineage, paired within lineage: the exact one-sided sign-flip permutation test on
9 lineage differences (`pairedPermutation`, `experiments/lib/stats.mjs:518`), with a 3-point floor and the certified
durable share as co-conditions. D-3's units are crossed: a two-way bootstrap resamples lineages and windows, so neither
the build spread nor the case clustering is hidden. No test pools cases across lineages (template B7). Everything else
is a stated rule or descriptive, with its operating characteristics computed in advance (prereg §10–§11). Zero-event
bounds use the (lineage × world) unit. Every promotion gets a `certifyHeal` verdict (Move 0) under a frozen evidence
mapping; if `certify.mjs` cannot be imported at the freeze, heal verdicts are labelled "uncertified (Move 0 pending)".

### 4.8 Budget logic

$80 (D24) in a fixed priority order with per-row caps, expected about $67 (prereg §12). The streams' $0 arms and every
analysis run first; paid rows follow in order; unspent cap flows down; a session starts only if spent + its cap ≤ $80.
Costs come from measurements: FH-1 heal sessions (mean $0.143), COMP-1 announced patches ($0.02–0.05), AGENTV and
OT-0 agents ($0.13–0.163 per case at d2, default effort; re-measured at d3 and effort high in rehearsal), OT-0's Opus
agent ($1.284 per case at default effort, no validator).

## 5. Design decisions and their reasons

1. **E8 only.** It is the only bed where every non-agent arm costs $0 per world, with an exact oracle and a working
   heal loop; ABR lacks its runner and builder; JIT streams lost on cost (R0-K); W-bed's R8 hooks are no-ops.
2. **Nine lineages × three streams.** The lineage is the unit for heal claims (cases inside one program are dependent);
   the third stream buys D-3 power.
3. **Commissioned starting versions (FH-1 heal-until-clean).** The contrast is about change, not about commissioning,
   which FH-1 answered.
4. **Changes mix what the spec anticipates and what it does not.** P1, E1 and E2s use mechanisms SPEC-E describes (they
   test whether construction generalised); R1, R2s and U1s change rules; L1 and F move load and faults; ADV attacks.
   Results are reported by class.
5. **A blind author writes three of the nine changes** (R2s, E2s, U1s), from a frozen brief, without seeing programs,
   results, contracts, monitors or heal prompts; the experimenter never reads the bundle before the run.
6. **Monitors are oracle-free; complaints are declared oracle-derived feedback** (seeded, arm-independent, partial,
   delayed), and every detection number is reported with and without them.
7. **Opus is used where it is needed and counted:** the verifier (contracts), the sealed author, the red team, the
   REF-M maintainer and two probes. Haiku patches.
8. **Every verdict names who acted** (builder tier, patcher tier, verifier tier, executor), as R0-K taught.

## 6. What DUR-1 cannot show, and what follows it

- No state carried across cases; no adaptive in-node sub-workflow creation (A5, gap closure); no n8n ports; no sealed
  family. Six of nine changes are designer-written and announced changes are not detection.
- The verifier is frontier-written and close to the oracle on base worlds (FH-1 §6); DUR-1 measures how it ages under
  change (C-O upkeep, MH-stale), not how to get one for a new family.
- **DUR-1C** (only if D-1 passes): the same frozen protocol on held-out 9101–9104 for the code arms (about $15; needs a
  new decision, because D24 is a development budget).
- **DUR-2**: AutomationBench-R slawatch in carry mode with an outage clause, once `stream.mjs`, `wf-H`, multi-week
  generation and a held-out seed guard exist and are calibrated at $0; sealed E8 worlds 9201–9204 for sealed drift
  families and the heal arm.
- **FH-2** (evidence for the patcher) is partly anticipated here; DUR-1 does not isolate its effect.

## 7. Decisions for the orchestrator

1. **Budget (proposed):** run cap **$80** under D24, priority order and per-row caps as in prereg §12, expected
   ≈ $67; Mercury 0 tokens. Root-cause analysis sessions (Sonnet 5.5, Opus 5.5 xhigh for unhealed changes and silent
   critical cases) recorded separately, ≤ $4.
2. **Optional comparator top-up (not assumed):** +$40, Opus-comparator-only, to run A-Ox on 4 sealed-change windows ×
   6 cases (K = 2 streams per change), by the same frozen rule. Without it A-Ox stays a descriptive probe.
3. **Seed claim:** approve the draft claim of 1171–1188 (ebed-dev, `jit-dev`) and 1207–1210, 1223–1226
   (`ebed-e8-rehearsal`).
4. **Move 0 dependency:** allow the build to import `certify.mjs` and `gauntlet.mjs` read-only from `d3bd7acf` if Move 0
   is not merged by the freeze (their dependencies are byte-identical to main's); otherwise heal verdicts carry
   "uncertified (Move 0 pending)" and are re-scored later without new data.
5. **Record the decision** in `research/decisions-20261021.md` as the next free number (D31 at 04:30Z; D29 and D30 are
   taken); proposed text in prereg §16.
6. **Scheduling:** paid DUR-1 rows draw on the same account limits as the SOP-Bench, OT-0, AutomationBench, VL-1 and
   A1-C v2 runs. Opus rows (P1, P2, P6–P8) start only when no other Opus chain is drawing on the session limit; the
   chain enforces ≤ 2 concurrent DUR-1 sessions.
