# MOVE1-2-AB: Δ\* v1 and the commit gate on AutomationBench ($0 replays over stored dev60 runs)

**Evidence class: development / diagnostic, $0, in-sample.** Every number below comes from the stored devTrain dev60 runs
of the verifier lab (`--pool devTrain --subset 60 --seed 21`, k = 1 per arm; the A1-C arms are in-sample) and the stored
RL2 extractions. No model was called. Official grades were read only after Δ\* was built, as a scoring scaffold
(oracle-implied labels, ATTACK §6 Move 1 step A). No look-2, look-3, devCheck, test or sealed task, grade or bed was read.
No frozen file changed: requirement-ledger-v2, the A1-C v1/v2 manifests, the FREEZE-p2, PREREG-OT0 + AMEND-1 and PREREG-VL1
pins name none of the files this work touches (checked by `git diff d13c338e` and a search of the pin lists).

**Keep this file out of every harness, verifier and model context.** It names dev60 tasks. The code it describes is
generic: the hygiene test (`rl3.test.mjs`) fails if a task name, a grader check name, a lab path or a ceiling note
appears in the Δ\* or gate sources.

Branch `worktree-wf_bba577b8-b58-2`, built on the Move 0 branch (`worktree-wf_bba577b8-b58-1` @ `d3bd7acf`, merged).
Decisions in force: D21 (in-sample tuning allowed when disclosed), D22 (no paid step here), D28 (three-valued release,
clock ruling, claims policy).

---

## 0. Verdicts against ATTACK's preregistered numbers (applied verbatim in code; `dstar-replay.test.mjs` pins them)

**Move 1, replay A (closure), "success: closure recall ≥ 6 of 14 broken-guardrail tasks with no task over 30% of the
numerator; false exclusion ≤ 5%; ≤ 1 of the passing worlds flagged. Kill: recall < 4 of 14, or false exclusion > 10%,
or > 3 passing worlds flagged."**

| Δ\* source (stored readers, adapted) | closure recall (of 14; reachable 11) | max task share | + direct bans | false exclusion | passing worlds flagged (6 arms / 5 arms) | success | kill |
|---|---|---|---|---|---|---|---|
| **a1c** (primary: 3 Haiku A1-C readers) | **1** (1/11) | 1.00 | 1 | 2/162 = 1.2% | 0 / 0 | no | **yes** (recall) |
| m3 (3 Mercury A1-C readers) | 2 (2/11) | 0.67 | 2 | 9/208 = 4.3% | 13 / 10 | no | yes (recall, flags) |
| rl2 (3 Haiku RL2 readers) | 3 (3/11) | 0.33 | 5 | 14/224 = 6.3% | 11 / 8 | no | yes (recall, flags) |
| union (a1c + rl2, 6 readers) | 5 (5/11) | 0.20 | 6 | 14/277 = 5.1% | 11 / 8 | no | yes (flags) |
| *scaffold: oracle-implied dispositions (expressibility ceiling, not a capability)* | *13 (expressible 14)* | – | – | – | *3 / 3* | – | – |

Denominators: 14 haiku-a1c failing tasks with a broken guardrail (29 broken guardrails; 3 of the 14 are hard-defect tasks,
so 11 are reachable); 124 passing worlds over six arms (95 over the five non-Mercury arms).

**Move 1, replay B (derivation), "≥ 5 of the 7 candidate tasks reproduce the oracle values from predicates the readers
wrote (not from analyst-chosen dates); confident-wrong ≤ 5%".** Not evaluable at $0: no reader wrote these SELECTs.
Expressibility only (oracle-informed, analyst-written): **5 of 7 tasks certain and correct over the clock domain, 6 of 7
correct at the business-date anchor, 0 of 10 figures confident-wrong (0%), 5 of 10 figures UNKNOWN** (labelled nulls,
never a hard value).

**Move 2, replay C (gate over the stored calls), "success: ≥ 6 of the 12 message-mention breaks refused from ≥ 3
distinct tasks, ≤ 1 false refusal over all passing worlds; duplicates per arm 13/60 → ≤ 2/60. Kill: > 1 false refusal
on passing worlds, or any admitted write that Δ\* could not explain being right more often than wrong."** Gate with
identity v2 (§4):

| Δ\* source | mention breaks refused | all broken guardrails refused | passing worlds with a false refusal: P only / P + registry refusal of different content | worst arm: tasks with duplicates left (before) | unexplained admitted writes in passing worlds (base) | success | kill |
|---|---|---|---|---|---|---|---|
| **a1c** | 1 of 12 (1 task) | 1/29 | **0** / 2 | 7 (10) | 39.7% (40.5%) | no | no on P; yes on the conservative count (see §4) |
| m3 | 3 (1 task) | 4/29 | 10 / 12 | 7 (12) | 47.5% (39.4%) | no | yes |
| rl2 | **6 (4 tasks)** | 8/29 | 9 / 10 | 7 (12) | 40.7% (40.8%) | no | yes |
| union | **6 (4 tasks)** | 8/29 | 9 / 10 | 7 (12) | 41.8% (41.0%) | no | yes |
| *scaffold* | *12 (4 tasks)* | *23/29* | *1 / 3* | *7 (12)* | – | – | – |

**In one paragraph.** With the readers' *existing* outputs, Δ\* v1 is killed on every source: closure reaches 1 to 5 of
the 14 broken-guardrail tasks, and the sources that reach more also flag 11 to 13 passing worlds. The ceiling is not the
grammar: with oracle-implied dispositions the same closure, mention forms and checks catch 13 of 14 tasks and 27 of 29
guardrails (11 of 12 mention breaks) and flag 3 passing worlds. The gap is the **dispositions**: on the primary source 87%
of member votes are UNKNOWN (no executed rule, no verbatim quote), and the hard exclusions that do exist fire on passing
worlds because a stored list-style exclusion is attached to the wrong obligation (§2.3). The derived figures are
expressible as single SELECTs with no confident-wrong value under the D28 clock. The gate refuses 6 of 12 mention breaks
from 4 tasks on the RL2 dispositions, which meets that clause, but it inherits the same scope errors (9 to 10 false
refusals); its effect registry had a precision defect (v1 conflated distinct creates and per-item messages; fixed in v2,
§4.2), and it removes only part of the duplicates (worst arm 12 → 7 tasks). The decisive next experiment is the one
ATTACK already names as the paid step: readers that write predicates and SELECTs per obligation (≤ $1.5, Haiku, ledger
only), which needs a frozen preregistration first (§8).

---

## 1. What was built

| Piece | File | What it does |
|---|---|---|
| Universes (closure) | `experiments/autobench/verifier/requirement-ledger-v3/universe.mjs` | Code enumerates every collection (sheet worksheet, channel, app collection) into members with a stable key, flat attributes, a label, whole-word mention forms (organisation suffixes, unique first names, distinctive values) and e-mail addresses; SQL tables with a numeric twin column for money and percent text. `meta` is never read. |
| Pointer normalisation (Move 5 $0 step) | `pointers.mjs` | A written pointer resolves to exactly one member (brackets, case, sheet titles, singular collections, bare ids) or to nothing; ambiguity never guesses. |
| Sandbox | `sqlsafe.mjs` | Reader SQL runs on `node:sqlite` in a **child process** with SIGKILL at the deadline (a worker thread cannot interrupt a native SQLite step), an empty environment and a 48 MB heap; `setAuthorizer` **deny by default** (SELECT, READ of loaded tables, RECURSIVE, and a function allow-list only); SQLite limits (no attached databases); one statement only (node's `prepare` silently drops a trailing statement); row and reply caps. |
| Clock (D28) | `clock.mjs` | Today = the request's own date; else the latest work-item event date (domain [anchor, anchor + 30 d]); else the latest business date (± 30 d, "weak"); else a labelled null. Load stamps (values within 12 h before the host read the world) are not business dates. |
| Δ\* | `dstar.mjs` | Readers supply predicates (`where` over a universe), SELECT figures, pointers and quotes. Code evaluates every predicate on every day of the clock domain and disposes **every** member: `include` / `exclude` with an executed predicate or a verbatim quote / `unknown` (labelled null with its reason). Consensus: with ≥ 3 readers two verified votes and no more verified votes against. Compiles both directions into hard checks (`msg_lacks_any`, `msg_none`, `created_none_any`, `rec_field_not`, `rec_unchanged`, `rec_kept` for the complement; `msg_to`, `post_in`, `created_in`, `rec_field`, `msg_has` for obligations and certain figures). Emits the Agent-Diff state-diff shape (`diff_type, entity, where, expected_count, strict`) and the UNKNOWN list; `verdict()` is three-valued (FAILED blocks release, UNKNOWN is listed, never a pass). |
| Stored-reader adapters | `adapters.mjs` | Translate the stored A1-C v1 ledgers and RL2 extractions into Δ\* reader input. A listed claim stays a claim: only an induced rule that code executes on every member, or a quote code finds verbatim, can make it hard. |
| Evaluation | `evaluate.mjs`, `check.mjs` | Δ\* checks on a candidate world (v2's grammar plus the four `*_any` types; replies count as messages to a person only on outward-facing lists). |
| Effect registry | `experiments/autobench/harness/v3/registry.mjs` (+ `effects.json`, byte copy of A1-C v2's table) | Entity identity of every planned write, never the caller's key. Identity v2: e-mail by recipients + subject; chat by channel + text; a create by app, operation, ids, the entity-level name and its structured attributes. |
| Commit gate | `harness/v3/gate.mjs` | Before a write: P (a hard prohibition of Δ\*), K (the entity key is already committed; a message's key also carries the Δ\* members it is about), O (discharges an obligation, or is UNEXPLAINED). Admit with a certificate (effect, discharged assertions, read-back witness), refuse, or hold. A failed write releases its key. Pure function of (Δ\*, registry, call); it never reads the actor's plan or self-report. |
| Replays | `experiments/autobench/replay/{dstar-replay,dstar-score,gate-replay}.mjs` | Step A (closure), step B (`derive`), step C (gate), the pointer replay; scoring reads grades only after the build. |

`requirement-ledger-v2` is untouched; v3 started as a byte-identical copy (`20997d8e`).

## 2. Replay A: closure over the 60 stored inventories

### 2.1 Counts (primary source a1c; others in the summary file)

- Universes from the stored haiku-a1c `inventory.json` of all 60 tasks; Δ\* from the request, the inventory and the
  stored reader outputs only; scored against all six arms' stored worlds.
- Member dispositions (votes over groups): a1c 1,557 (include 146, exclude 55, all hard, **unknown 1,356 = 87%**); m3
  1,622 (77% unknown); rl2 2,009 (67%); union 3,075 (75%).
- Failing worlds flagged by a hard closure negative (of 236): a1c 8, m3 15, rl2 38, union 47.
- Mention breaks reached by any hard negative (of 12): a1c 1, m3 2, rl2 5, union 5; scaffold 11.
- Clock over the 60 tasks: request date 10, event-anchored 37, weak 6, **labelled null 7**.

### 2.2 Why recall is low (root cause)

The scaffold shows that closure itself is expressive enough: given the right dispositions, the code-enumerated universes
and mention forms produce a failing check on 13 of the 14 tasks. What the stored readers do not give is a rule that code
can execute over the universe: they list a few candidates (the A1-C ledgers) or label items in scope without a deciding
field (RL2). Of 1,557 primary member votes only 201 are disposed at all (146 include, 55 hard exclude); the rest stay UNKNOWN by construction, because the
disposition rules forbid a bare say-so from compiling to a hard check. This is the latent-requirements sweep's finding
measured on Δ\* ("readers list only 8 of 28"), and it is the reason ATTACK puts predicate-writing readers in the paid step.

### 2.3 Why the passing worlds are flagged (root cause of the precision failures)

| Source | Flagged passing worlds | Tasks | Mechanism |
|---|---|---|---|
| m3 | 6 | 1 | an induced threshold rule excludes a member from a per-item obligation; the per-item complement compiles to "no message at all to that member's address", but the passing worlds message that person for another reason (the exclusion was scoped to one obligation) |
| m3 | 7 | 2 | an induced categorical rule excludes members whose names then appear in rows the passing worlds create for another obligation |
| rl2 | 11 | 6 | an RL2 item marked out of scope with a verified quote for one requirement is attached to every obligation that names an item (the adapter's `labelHit`), so the ban spreads to another obligation's creates and messages |
| scaffold | 3 | 1 | a "row must not exist" guardrail compiles to "no new row names the member", broader than the guarded row |

All four are **scope** errors: a disposition valid for one obligation is applied to another effect. Closure as defined
in ATTACK is "all-and-only inside the enumerated universe *of a selection*"; the stored list outputs do not say which
selection a claim belongs to, so the adapters guess. A reader that writes one predicate per obligation states the scope;
code can also narrow a per-item complement to the obligation's own content (a candidate change, not applied: it would be
post-freeze tuning on dev60).

### 2.4 In-sample trajectory (disclosed under D21)

Pass 1 was frozen as code and replayed; passes 2 to 4 changed Δ\* after reading pass-1 flags and one recall miss.

| Pass | a1c recall / flags | m3 | rl2 | union | scaffold caught / flags |
|---|---|---|---|---|---|
| 1 | 0 / 7 | 2 / 14 | 5 / 16 | 5 / 16 | – |
| 2 | 1 / 0 | 2 / 13 | 3 / 10 | 5 / 10 | 9 / 19 |
| 3 | 1 / 0 | 2 / 13 | 3 / 10 | 5 / 10 | 13 / 19 |
| 4 (frozen) | 1 / 0 | 2 / 13 | 3 / 11 | 5 / 11 | 13 / 3 |

Tuning on dev60 cut false flags and did not buy recall, and the kill held at every pass. The pass-2 to pass-4 rules
(generic, listed for KNOWLEDGE): absence claims ("no note", "(none)") hold on empty fields; a listed claim compiles only
through an induced rule (one deciding field, a function of its value, both dispositions present, a value shared by ≥ 2
members or a separating threshold); precise update/delete exclusions; conditional bans ("until", "unless") and bans
contradicted by an obligation on the same target stay soft; obligation consensus; task-wide uniqueness of short forms; a
member is also named by a distinctive multi-word or CamelCase value of its own; recipient bans see only outward-facing
replies; the most specific container of a pointer.

## 3. Replay B: the 7 derived figures as SELECTs (expressibility, not capability)

`research/blockers-20261021/move12/derived-selects.json` holds one SELECT per figure, written by the analyst after reading
the failed assertions (oracle-informed; the expected values are read from the grade at run time and never written down).
The SELECT reads `:today` where the figure depends on today; the clock is D28's (§1).

| Task class | Figures | Clock | Result |
|---|---|---|---|
| aging buckets | 2 | weak (business dates only) | correct at the anchor; the buckets move inside the ± 30 d domain, so both are UNKNOWN (no hard literal) |
| tax estimate, vendor total, eligible count, drill plan title, offboarding card name | 5 | anchored or request date | **certain and correct** over the whole domain |
| days until a visa expires | 3 | anchored | not correct at the anchor; the value matches on exactly one day of the domain, the hidden clock's (a hard-defect task); UNKNOWN, never confident-wrong |

So 5 of 7 tasks certain and correct, 6 of 7 at the anchor, 0 of 10 figures confident-wrong. Three of the five certain
SELECTs carry dates or constants the analyst copied from records (a week start, a drill date, an end-date window), which
is exactly what the preregistered criterion excludes ("not from analyst-chosen dates"). This step shows that a single
sandboxed SELECT can carry each figure and that the clock ruling turns the date-dependent ones into labelled nulls rather
than wrong values; it does not show that a reader will write them.

**L0 count (D28 precondition).** Every stored reader family declares a "today" on almost every task (A1-C Haiku 54 of
60, Mercury 57, RL2 32; any reader 59), so a declared today is not evidence of need. The useful count, tasks whose
predicates or figures read `:today`, exists only once readers write predicates.

## 4. Replay C: the commit gate over the stored `calls.jsonl` of the six dev60 arms

### 4.1 Method

ATTACK names v2's `replay-gate.mjs --lint`. That file lives on the frozen A1-C v2 branch, serves live worlds through
`playback.py`, and covers only the a1c run. The replay here offers every recorded call of every stored session (six arms,
2,123 writes, 28 undecodable) in recorded order to a fresh harness/v3 gate built from Δ\* (same rules: v2's route table
and MIME decoding, ported), counts refusals, and scores them afterwards against the grades. A refused write is counted,
not simulated further. 150 calls used tool names other than `api_fetch`, `api_search` and `base64_encode`; every one returned only an echo of its own name, with no effect, so no
write path bypasses the gate in these runs (a live gate must still cover every path).

### 4.2 The registry's identity defect, found by root-causing the duplicate refusals

The first replay (identity v1, as committed in the earlier interrupted run) refused 22 writes of **different content** in
passing worlds, and refused writes in A0/A1 arms that have no duplicates at all. Causes, read from the calls:

- the name of a nested reference was taken as the entity's name, so every new issue of one issue type shared one key
  (every issue after the first was "a duplicate");
- an event's name without its customer, so per-customer events collided;
- recipient + subject only, so three per-employee approval requests to one approver collided.

Identity v2: an entity-level name (top of the body or directly under a wrapper such as `fields`) plus the create's
structured attributes (short scalars; long prose is not identity, so a reworded re-send is still a duplicate), and, in
the gate, a message key that carries the Δ\* members the message names. Registry refusals of different content in
passing worlds fell from 22 (8 worlds) to 3 (2 worlds); I read all three: two re-sends of one follow-up e-mail with a
reworded body and one note re-written on the same contact, so by the entity definition they are duplicates the gate
should stop. Counted conservatively they are false refusals, which is why the a1c row carries "2". Duplicate removal
became weaker, as the precision trade predicts: duplicate records removed, haiku-a1c 16 → 10 of 28 and m3-a1c 23 → 20 of
36 (9 and 12 records could not be attributed to a write and count as left); tasks with duplicates left, 10 → 5 (v1) or 7
(v2) and 12 → 5 or 7. v1's extra removals came with blocked distinct writes, so they do not count as a gain.

### 4.3 Readings

- **P refusals carry Δ\*'s scope errors (§2.3) unchanged:** 9 to 10 passing worlds on m3, rl2 and union; 0 on a1c, whose
  Δ\* has almost no hard exclusions. The rl2 and union sources meet the mention clause (6 of 12 from 4 tasks), so the gate
  mechanism reaches message-mention breaks before the write; the dispositions decide whether it does so safely.
- **Duplicates:** before the gate 10 and 12 tasks for the two A1-C arms (0 or 1 for A0/A1); after, 7 in the worst arm
  against the bar of 2. Exactly-once by key catches identical and lightly reworded re-sends; the rest are re-creations
  with different parents or routes, which need a read-back before a re-send (the certificate's witness), not a wider key.
- **Unexplained writes carry no signal here:** 14 to 20% of writes discharge no Δ\* obligation, and they sit in passing
  worlds at the base rate (39.7% vs 40.5% on a1c). The kill clause ("right more often than wrong") does not fire; as an
  UNKNOWN they are an honest assumption list, not a failure predictor.
- Certificates: about 1,930 to 2,000 admitted writes per source carry one (key, operation, discharged assertions, witness).

## 5. Move 5's pointer-normalisation step (where it serves Move 1)

Over the 180 stored A1-C replies per arm:

| Arm | Candidate pointers | Resolved before (exact) | Resolved after | How | Reader votes on members |
|---|---|---|---|---|---|
| haiku-a1c | 1,497 | 1,374 (91.8%) | 1,485 (99.2%) | 50 bracketed, 49 sheet titles, 12 bare ids; 12 left (a pointer with no worksheet), 0 ambiguous | 1,357 → 1,468 |
| m3-a1c | 3,088 | 1,928 (62.4%) | 3,088 (100%) | 1,020 bracketed, 122 sheet titles, 18 bare ids (ATTACK's "1,020 bracketed and 140 differently spelled") | 1,503 → 2,158 (+44%) |

Δ\* resolves every pointer through this code, so replay A already includes the gain.

## 6. Tests with teeth

| Suite | Tests | Covers |
|---|---|---|
| `verifier/requirement-ledger-v3/rl3.test.mjs` | 22 / 22 | the skeptic's control (under `PRAGMA query_only` an ATTACH creates a file, the SQL can lift the pragma and write, randomblob allocates); ATTACH refused with no file written; randomblob, zeroblob, load_extension, printf, random denied; PRAGMA, writes behind WITH, `sqlite_master` and `pragma_*` reads denied by the authorizer alone; trailing statements refused; a runaway recursive CTE killed without hiding other results; row cap; clock (request, anchored, weak, null, load stamps, meta never enumerated); universes and forms; pointers and ambiguity; dispositions (executed predicate, verbatim quote, refuted claim, bare say-so → UNKNOWN); clock-dependent members and figures → UNKNOWN; hostile reader SQL → every member UNKNOWN; consensus (two verified votes; an unverified majority never overrides a verified vote); per-item record negatives; Agent-Diff shape; three-valued verdict; direct bans (quote, condition, contradiction); hygiene |
| `harness/v3/gate.test.mjs` | 8 / 8 | routes and MIME; identity ignores caller keys; identity v2 (nested names, structured attributes, reworded re-sends); message keys by members; P refusals (mention on the ban's target only, recipient); K refusals; unexplained writes and holds; settle releases a failed write; purity |
| `replay/dstar-replay.test.mjs` | 5 / 5 | ATTACK's thresholds verbatim; every success and kill boundary of Moves 1 and 2; duplicate attribution; alignment |
| `verifier/requirement-ledger-v3/rl2.test.mjs` (v2's suite on the v3 copy) | 9 / 9 | the inherited grammar |

Each suite was run alone (`nice -n 15 node --test --test-concurrency=1`). **Mutation check: 32 of 32 deliberately broken
variants fail their suite** (sandbox 5, Δ\* 8, clock 2, pointers 1, universes 1, registry 3, gate 5, replay scoring 7),
run in a scratch mirror, never in the worktree; the unmutated mirror passes all three suites
(`move12/mutation-check.json`). The first mutation run left 3 survivors (the verified-vote filter, case-folded pointer
ambiguity, the mention ban's target); each got an assertion and the rerun killed all 32.

## 7. Disclosures

- **In-sample.** Every replay is dev60, where the A1-C arms were developed; the pass-2 to pass-4 rules (§2.4), identity v2
  and the message-about-members key (§4.2) were all found on these replays. None names a task, a value or a grader check.
  The clock module's horizon (30 days) and the load-stamp window were chosen after an analysis-only look at how dev60
  record dates relate to the hidden clock (scratch script; the hidden clock never enters Δ\* code; D28 is about the
  system, which never reads it).
- **Post-freeze changes to Δ\*.** After pass 4 two changes, both found by the new tests: an UNKNOWN keeps its own reason
  instead of "no verified majority", and a clock-dependent member is put on the UNKNOWN list. Replays A and B were rerun
  on the final code and are byte-identical to the pass-4 outputs (summary, per-task rows and figures).
- **Replay C was rerun with new metrics** for both identities: registry refusals split into same / different content, the
  duplicate clause and the unexplained-write kill clause added to the verdict (they were in the rule text but not in the
  boolean), duplicates attributed to writes by content (the loose-key count is kept beside it).
- **Deviation from ATTACK's recipe.** Readers are the *stored* list-style outputs, adapted; ATTACK's step A asks exactly
  that ("with the reader's existing exclusion rules"). The gate replay is harness/v3's, not v2's frozen `replay-gate.mjs`
  (§4.1). The stored readers ran with effort unset (Move 0: every dev60 arm is non-conforming), and that carries over.
- Nothing here reads look-2/look-3, devCheck, test or sealed data. The `/var/tmp/foundry-work/autobench/` tree holds such
  runs; only the lab's dev60 rows (its `load.mjs`) were opened.

## 8. What is left, and why

1. **The decisive Move 1 experiment is paid and needs a frozen preregistration first (D22): readers write predicates and
   SELECTs per obligation** (ATTACK: ≤ $1.5, Haiku, ledger only, 60 dev60 tasks, replayed against the stored worlds with
   the same scoring). Today's replay localises the gap to dispositions and their scope, which is what that step tests.
   Not built yet: the v3 reader prompt and strict output schema (v3's `extract.mjs` is still v2's list prompt). Proposed
   frozen numbers: ATTACK's, plus a scope check (no hard exclusion outside the obligation that disposed it).
2. **Disposition scope in code** (narrow a per-item complement to its obligation's content; never spread an item's
   exclusion across obligations). Identified in §2.3, not applied, because it would be post-freeze tuning on the same
   60 tasks; it belongs in the reader-step build with its own preregistered replay.
3. **Duplicates** stay above the bar (7 tasks in the worst arm against 2). The next lever is the certificate's read-back
   before any re-send, plus A1-C v2.1 not re-sending on repair (VL M3), not a wider key.
4. **Live gate.** Wiring `harness/v3/gate.mjs` into the A1-C v2.1 actor (pre-write hook) and the paid live step (≤ $2,
   14 broken-guardrail + 14 control tasks) are v2.1 work and need a preregistration.
5. **Move 2 part (a)** (the COMP one-line fixes behind the registry, M4b/M4d on worlds 1161/1162/1164) belongs to the
   COMP-2 step (`compose/runtime2.mjs`), not to this AutomationBench step.
6. **Move 3** can use `verdict()` and the stored replays for its risk-coverage curve; it is a separate step.
7. Mercury stays unused (D28 (7)); no policy edit was made (D28 (8)).

## 9. Reproduce ($0)

`S=/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad` (the lab and RL2
extractions are there; the scratchpad is not durable).

| Command | Output |
|---|---|
| `node experiments/autobench/replay/dstar-replay.mjs closure --vlab $S/vlab --rl2 $S/rl2-out/extract.jsonl --out <f>` | replay A (`move12/replay-a-closure.summary.json`; per task `move12/raw/replay-a-closure.json.gz`) |
| `node experiments/autobench/replay/dstar-replay.mjs derive --vlab $S/vlab --selects research/blockers-20261021/move12/derived-selects.json --out <f>` | replay B (`move12/replay-b-derive.json`) |
| `node experiments/autobench/replay/gate-replay.mjs --vlab $S/vlab --rl2 $S/rl2-out/extract.jsonl --identity v2 --out <f>` (and `--identity v1`) | replay C (`move12/replay-c-gate-identity-v{1,2}.summary.json`; per task under `raw/`) |
| `node experiments/autobench/replay/dstar-replay.mjs pointers --vlab $S/vlab --out <f>` | `move12/move5-pointers.json` |

Checksums of every output: `move12/SHA256SUMS`.
