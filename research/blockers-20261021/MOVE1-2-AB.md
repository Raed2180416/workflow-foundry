# MOVE1-2-AB: Δ\* v1 and the commit gate on AutomationBench ($0 replays over stored dev60 runs)

**Evidence class: development / diagnostic, $0, in-sample.** Every number below comes from the stored devTrain dev60 runs
of the verifier lab (`--pool devTrain --subset 60 --seed 21`, k = 1 per arm; the A1-C arms are in-sample) and the stored
RL2 extractions. No model was called. Official grades are a scoring scaffold only (oracle-implied labels, ATTACK §6 Move 1
step A) and never enter Δ\*; but only pass 1 was built before any score was read: passes 2–4 (§2.4) and the review fixes
of 2026-11-04 (§10) were made after reading replay scores, on these same 60 tasks (in-sample, disclosed under D21). No
look-2, look-3, devCheck, test or sealed task, grade or bed was read.
No frozen file changed: requirement-ledger-v2, the A1-C v1/v2 manifests, the FREEZE-p2, PREREG-OT0 + AMEND-1 and PREREG-VL1
pins name none of the files this work touches (checked by `git diff d13c338e` and a search of the pin lists).

**Keep this file out of every harness, verifier and model context.** It names dev60 tasks. The code it describes is
generic: the hygiene test (`rl3.test.mjs`) fails if a task name, a grader check name, a lab path or a ceiling note
appears in the Δ\* or gate sources.

Branch `worktree-wf_bba577b8-b58-2`, built on the Move 0 branch (`worktree-wf_bba577b8-b58-1` @ `d3bd7acf`, merged).
**Revised 2026-11-04 after the review of `28d74da9`** (§10 lists every finding and what was done). The review found a
scoring bug that had turned the only positive Move 2 clause into a pass, and several mechanisms that let lists, the host
clock, code-induced rules and soft failures pass as evidence. All numbers below are from the fixed code (Δ\* v1.1,
`rl3-sql-v2`, `v3-gate-v2`, replays `dstar-replay-v2` and `gate-replay-v3`); the superseded numbers are in §10.
Decisions in force: D21 (in-sample tuning allowed when disclosed), D22 (no paid step here), D28 (three-valued release,
clock ruling, claims policy).

---

## 0. Verdicts against ATTACK's preregistered numbers (applied verbatim in code; `dstar-replay.test.mjs` pins them)

**Move 1, replay A (closure), "success: closure recall ≥ 6 of 14 broken-guardrail tasks with no task over 30% of the
numerator; false exclusion ≤ 5%; ≤ 1 of the ~70 passing worlds flagged. Kill: recall < 4 of 14, or false exclusion > 10%,
or > 3 passing worlds flagged."** ATTACK counts passing worlds on "the 14 broken-guardrail tasks and 14 matched passing
controls"; the verdict uses that count (54 passing worlds of the five dev60 arms on 28 tasks; the matching rule is seeded
and blind to flags, but was fixed after the all-worlds counts were known, §7). All 124 passing worlds of the six arms are
reported beside it.

| Δ\* source (stored readers, adapted) | closure recall (of 14) | max task share | + direct bans | false exclusion | passing worlds flagged: matched (of 54) / all six arms (of 124) | verdict, matched count | verdict, all worlds |
|---|---|---|---|---|---|---|---|
| **a1c** (primary: 3 Haiku A1-C readers) | **0** | – | 0 | 2/162 = 1.2% | 0 / 0 | **kill** (recall) | kill (recall) |
| m3 (3 Mercury A1-C readers) | 0 | – | 0 | 1/208 = 0.5% | 0 / 0 | kill (recall) | kill (recall) |
| rl2 (3 Haiku RL2 readers) | 3 | 0.33 | 5 | 14/224 = 6.3% | 4 / 11 | kill (recall, flags) | kill (recall, flags) |
| union (a1c + rl2, 6 readers) | 4 | 0.25 | 6 | 14/277 = 5.1% | 4 / 11 | kill (flags) | kill (flags) |
| *scaffold: oracle-implied dispositions AND the grader's own targets and values (a ceiling, not a capability)* | *13* | – | – | – | *– / 3* | – | – |

Denominators: 14 haiku-a1c failing tasks with a broken guardrail (29 broken guardrails; 3 of the 14 are hard-defect tasks,
so 11 are reachable). Every hard exclusion that remains is a verified quote; the a1c and m3 "recall" of the first report
(1 and 2 tasks) and all 13 of m3's flagged passing worlds came from rules that CODE induced from listed claims, which no
longer count as reader rules (finding 7).

**Move 1, replay B (derivation), "≥ 5 of the 7 candidate tasks reproduce the oracle values from predicates the readers
wrote (not from analyst-chosen dates); confident-wrong ≤ 5%".** Not evaluable at $0: no reader wrote these SELECTs. What
was measured is expressibility of analyst-written, oracle-informed SELECTs: 5 of 7 tasks certain and correct over the
clock domain and 6 of 7 correct at the business-date anchor, **but 3 of those 5 SELECTs carry dates or constants the
analyst copied from records, so at most 2 of 7 meet the criterion's "not from analyst-chosen dates"**; 0 of 10 figures
confident-wrong; 5 of 10 UNKNOWN. Unchanged by the fixes (byte-identical rerun).

**Move 2, replay C (gate over the stored calls of ATTACK's five dev60 arms; the Mercury arm as a sensitivity line),
"success: ≥ 6 of the 12 message-mention breaks refused from ≥ 3 distinct tasks, ≤ 1 false refusal over all passing
worlds; duplicates per arm 13/60 → ≤ 2/60. Kill: > 1 false refusal on passing worlds, or any admitted write that Δ\*
could not explain being right more often than wrong."** False refusals are counted per refusal (P refusals plus registry
refusals of different content), 95 passing worlds. Identity v2, admit mode:

| Δ\* source | mention breaks refused | all broken guardrails refused | false refusals, five arms (worlds) | six arms | worst arm: tasks with duplicates left (before) | unexplained admitted writes in passing worlds (base) | verdict, five arms | six arms |
|---|---|---|---|---|---|---|---|---|
| **a1c** | 0 of 12 | 0/29 | 1 (1): a registry refusal | 3 (2) | 7 (10) | 40.0% (39.1%) | **no success, no kill** (computed) | kill |
| m3 | 0 of 12 | 0/29 | 1 (1) | 3 (2) | 7 (10) | 44.4% (39.0%) | no success, no kill | kill |
| rl2 | 5 (3 tasks) | 7/29 | 13 (6) | 22 (10) | 7 (10) | 38.9% (39.8%) | **kill** | kill |
| union | 5 (3 tasks) | 7/29 | 13 (6) | 22 (10) | 7 (10) | 41.2% (39.8%) | **kill** | kill |
| *scaffold* | *12 (4 tasks)* | *23/29* | *2 (2)* | *4 (3)* | *7 (10)* | – | *kill* | *kill* |

No source meets the mention clause: the first report's "6 of 12 from 4 tasks" counted a refused spreadsheet row append
as a channel-mention break (finding 1). The duplicate clause fails for every source, the gate's own registry included.

**In one paragraph.** With the readers' *existing* outputs, Δ\* v1.1 is killed on every source on ATTACK's count and on
the all-worlds count: the two A1-C reader families reach no broken-guardrail task at all once code-induced rules stop
counting as reader rules, and the RL2-based sources reach 3 or 4 tasks while flagging 4 of the 54 matched passing worlds.
The scaffold, which is given the oracle's dispositions and the grader's own targets, containers and values, catches 13 of
14 tasks; that is a ceiling on the grammar plus perfect information, not evidence that dispositions alone are the gap
(finding 12). On the primary source 91% of member votes are UNKNOWN. The gate refuses 5 of 12 mention breaks from 3
tasks on the RL2 dispositions, short of the bar, with 13 false refusals; on a1c it is quiet (1 conflated registry
refusal, at the bar) and does not stop enough duplicates (7 tasks against 2). In hold mode, the gate's new default,
it holds a write in 35 to 46 of the 95 passing worlds, so "admit with discharged items or hold" is not deployable until
obligations cover the writes. The decisive next step is still the paid reader step (≤ $1.5, Haiku, ledger only, frozen
preregistration first, §8).

---

## 1. What was built

| Piece | File | What it does |
|---|---|---|
| Universes (closure) | `experiments/autobench/verifier/requirement-ledger-v3/universe.mjs` | Code enumerates every collection (sheet worksheet, channel, app collection) into members with a stable key, flat attributes, a label, whole-word mention forms (organisation suffixes, unique first names, distinctive values) and e-mail addresses; SQL tables with a numeric twin column for money and percent text. `meta` is never read. |
| Pointer normalisation (Move 5 $0 step) | `pointers.mjs` | A written pointer resolves to exactly one member (brackets, case, sheet titles, singular collections, bare ids) or to nothing; ambiguity never guesses. |
| Sandbox | `sqlsafe.mjs` (`rl3-sql-v2`) | Reader SQL runs on `node:sqlite` in a **child process** with SIGKILL at the deadline (a worker thread cannot interrupt a native SQLite step), an empty environment and a 48 MB heap; `setAuthorizer` **deny by default** (SELECT, READ of loaded tables, RECURSIVE, and a function allow-list only); SQLite limits (no attached databases); one statement only (node's `prepare` silently drops a trailing statement); row and reply caps. v2: the date and time functions refuse `'now'`, a missing time value and the `localtime`/`utc` modifiers, so the host clock is unreachable (`:today` is the only today); the worker runs under `ulimit -f` (8 MiB), so a spill fails at once (`SQL_SPILL`); one time budget per call, and a failed batch is retried per predicate, never per day-variant; an oversized reply is `SQL_REPLY`, not a timeout; every result lists the columns it reads. |
| Clock (D28) | `clock.mjs` (`rl3-clock-v2`) | Today = the request's own date; else the latest **past-event** date of the work items (domain [anchor, anchor + 30 d]); else the latest business date (± 30 d, "weak"); else a labelled null. Load stamps (values within 12 h before the host read the world) are not business dates. v2: scheduled kinds (events, meetings, invitees) and schedule fields (start, end, due, scheduled) are business dates, never past events; a reader's "today" counts only when its quote is in the request. |
| Δ\* | `dstar.mjs` (`dstar-v1.1`) | Readers supply predicates (a boolean over one universe, evaluated by code as a projected column for every member, never spliced into a WHERE), SELECT figures, pointers and quotes. Code evaluates every predicate on every day of the clock domain and disposes **every** member: `include` / `exclude` with an executed predicate or a verbatim quote / `unknown` (labelled null with its reason). A predicate that reads an identifying column (member number, rowid, label column, an id) or no attribute is a list: soft claims only. A rule code induces from listed claims (≥ 2 claims per side, no extrapolation) has its own basis, `induced`, never verified. Consensus: with ≥ 3 readers two verified votes and no more verified votes against. Compiles both directions (`msg_lacks_any`, `msg_none`, `created_none_any`, `rec_field_not`, `rec_unchanged`, `rec_kept` for the complement; `msg_to`, `post_in`, `created_in`, `rec_field`, `msg_has`, `created_has` for obligations, content literals and certain figures); a positive is hard only when its target and literal are grounded in the request or a record, else soft and listed. Emits the Agent-Diff state-diff shape and the UNKNOWN list; `verdict()` is three-valued: a hard failure is FAILED and blocks release; a soft failure or an undecided check is UNKNOWN and joins the assumption list. |
| Stored-reader adapters | `adapters.mjs` | Translate the stored A1-C v1 ledgers and RL2 extractions into Δ\* reader input. A listed claim stays a claim: only an induced rule that code executes on every member, or a quote code finds verbatim, can make it hard. |
| Evaluation | `evaluate.mjs`, `check.mjs` | Δ\* checks on a candidate world (v2's grammar plus the four `*_any` types; replies count as messages to a person only on outward-facing lists). |
| Effect registry | `experiments/autobench/harness/v3/registry.mjs` (+ `effects.json`, byte copy of A1-C v2's table) | Entity identity of every planned write, never the caller's key. Identity v2: e-mail by recipients + subject; chat by channel + text; a create by app, operation, ids, the entity-level name and its structured attributes. |
| Commit gate | `harness/v3/gate.mjs` (`v3-gate-v2`) | Before a write: P (a hard prohibition of Δ\*), K (the entity key is already committed; a message's key also carries the Δ\* members it is about), O (discharges an obligation, or is UNEXPLAINED, held by default). Fails closed: an unknown tool, unparseable arguments, a body without a method or an undecodable write is held. A hard ban no call-level rule can enforce (sheet rows) is listed and travels with every write of its app as `unverified`. Admit with a certificate whose witness is a read-back spec; `witnessHolds` confirms it only from the world's own changes. A failed write releases its key. Pure function of (Δ\*, registry, call); it never reads the actor's plan or self-report. |
| Replays | `experiments/autobench/replay/{dstar-replay,dstar-score,gate-replay}.mjs` | Step A (closure, with ATTACK's matched controls), step B (`derive`), step C (gate, five arms, per-refusal counts, admit and hold modes, witnesses), the pointer replay; scoring reads grades only after the build. |
| Mutation check | `replay/mutation-check.mjs` | 62 deliberately broken variants (38 of them revert one fix of §10) in a scratch mirror; a variant must fail its suite. |

`requirement-ledger-v2` is untouched; v3 started as a byte-identical copy (`20997d8e`).

## 2. Replay A: closure over the 60 stored inventories

### 2.1 Counts (primary source a1c; others in the summary file)

- Universes from the stored haiku-a1c `inventory.json` of all 60 tasks; Δ\* from the request, the inventory and the
  stored reader outputs only; scored against all six arms' stored worlds.
- Member dispositions (votes over groups): a1c 1,557 (include 141, exclude 2, both hard by quote, **unknown 1,414 =
  91%**); m3 1,622 (82% unknown); rl2 2,009 (67%); union 3,075 (77%).
- Failing worlds flagged by a hard closure negative (of 236): a1c 0, m3 0, rl2 38, union 40.
- Mention breaks reached by any hard negative (of 12): a1c 0, m3 0, rl2 5, union 5; scaffold 11.
- Clock over the 60 tasks: request date 10, event-anchored 37, weak 6, **labelled null 7** (unchanged by clock v2).
- UNKNOWN list (a1c): 411 members, 35 values (ungrounded literals and clock-dependent figures), 7 todays, 5 targets, 1
  universe.

### 2.2 Why recall is low (root cause)

The stored readers give no rule that code can execute over a universe: they list a few candidates (the A1-C ledgers) or
label items in scope without a deciding field (RL2). Code can induce a rule from listed claims, but an induced rule is
code's generalisation, not the reader's, so it no longer counts (finding 7); what remains hard is a verbatim quote. The
first report's a1c and m3 recall (1 and 2 tasks) came entirely from induced rules. This is the latent-requirements
sweep's finding measured on Δ\* ("readers list only 8 of 28"), and the reason ATTACK puts predicate-writing readers in
the paid step.

The scaffold catches 13 of 14 tasks, but it is given more than dispositions: its checks are built from the grader's own
targets, containers and field, value and tag parameters (`dstar-score.mjs` `scaffoldNegatives`). So it bounds what the
grammar can express with perfect information; it does not show that the readers' dispositions are the only gap.

### 2.3 Why the passing worlds are flagged (root cause of the precision failures)

| Source | Flagged passing worlds (all six arms) | Mechanism |
|---|---|---|
| rl2, union | 11 (4 in the matched set) | an RL2 item marked out of scope with a verified quote for one requirement is attached to every obligation that names an item (the adapter's `labelHit`), so the ban spreads to another obligation's creates and messages |
| scaffold | 3 | a "row must not exist" guardrail compiles to "no new row names the member", broader than the guarded row |
| m3 (first report) | 13, now 0 | induced threshold and categorical rules (finding 7) |

The remaining flags are **scope** errors: a disposition valid for one obligation is applied to another effect. A reader
that writes one predicate per obligation states the scope; code can also narrow a per-item complement to the
obligation's own content (a candidate change, not applied: post-freeze tuning on dev60).

**Positives compiled from content literals and targets (ATTACK (c), (d); finding 6).** Grounded literals now compile to
hard `msg_has` / `created_has`. Measured on the same worlds (a1c source; passing worlds of 124 with the check failing vs
failing worlds of 236): record-grounded `msg_has` 14 vs 54, record-grounded `created_has` 6 vs 13, request-grounded
`msg_has` 2 vs 7, `msg_to` 4 vs 35, `post_in` 0 vs 11, `created_in` 1 vs 29, `rec_field` 8 vs 17. On union,
record-grounded `created_has` fires on 22 passing vs 40 failing worlds and `rec_field` 16 vs 25, i.e. about as often on
correct runs as on wrong ones. Passing worlds with any failing hard check rose from 15 to 30 (a1c) and 36 to 62 (union).
So "grounded in some record" is too weak a basis for a hard content literal. The rule was fixed before measuring and is
kept as specified (changing it now would be in-sample tuning); the reader-step preregistration should require a
stronger basis (a request-grounded literal, or a quoted rule that names it) and report this table.

### 2.4 In-sample trajectory (disclosed under D21)

Pass 1 was frozen as code and replayed; passes 2 to 4 changed Δ\* after reading pass-1 flags and one recall miss.

| Pass | a1c recall / flags | m3 | rl2 | union | scaffold caught / flags |
|---|---|---|---|---|---|
| 1 | 0 / 7 | 2 / 14 | 5 / 16 | 5 / 16 | – |
| 2 | 1 / 0 | 2 / 13 | 3 / 10 | 5 / 10 | 9 / 19 |
| 3 | 1 / 0 | 2 / 13 | 3 / 10 | 5 / 10 | 13 / 19 |
| 4 (frozen) | 1 / 0 | 2 / 13 | 3 / 11 | 5 / 11 | 13 / 3 |
| review fixes (2026-11-04) | 0 / 0 | 0 / 0 | 3 / 11 | 4 / 11 | 13 / 3 |

Tuning on dev60 cut false flags and did not buy recall, and the kill held at every pass. The review fixes removed the only
recall that did not rest on a verbatim quote. The pass-2 to pass-4 rules
(generic, listed for KNOWLEDGE): absence claims ("no note", "(none)") hold on empty fields; a listed claim compiles only
through an induced rule (one deciding field, a function of its value, both dispositions present, a value shared by ≥ 2
members or a separating threshold; since the review, at least two claims per side, no extrapolation, and the induced
votes are soft, never hard); precise update/delete exclusions; conditional bans ("until", "unless") and bans
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
is exactly what the preregistered criterion excludes ("not from analyst-chosen dates"): **at most 2 of 7 tasks meet the
criterion as written**, and neither of those two was written by a reader. The rerun on the fixed code (clock v2,
sandbox v2) is byte-identical. This step shows that a single
sandboxed SELECT can carry each figure and that the clock ruling turns the date-dependent ones into labelled nulls rather
than wrong values; it does not show that a reader will write them.

**L0 count (D28 precondition).** Every stored reader family declares a "today" on almost every task (A1-C Haiku 54 of
60, Mercury 57, RL2 32; any reader 59), so a declared today is not evidence of need. The useful count, tasks whose
predicates or figures read `:today`, exists only once readers write predicates.

## 4. Replay C: the commit gate over the stored `calls.jsonl` of the dev60 arms

### 4.1 Method

ATTACK names v2's `replay-gate.mjs --lint`. That file lives on the frozen A1-C v2 branch, serves live worlds through
`playback.py`, and covers only the a1c run. The replay here offers every recorded call of every stored session (six arms,
2,123 decoded writes) in recorded order to a fresh harness/v3 gate built from Δ\* (same rules: v2's route table and MIME
decoding, ported), twice: in admit mode (unexplained writes admitted, the mode the kill clause is about) and in hold mode
(the gate's default). A refused or held write is counted, not simulated further. The preregistered verdict uses
ATTACK's five dev60 arms (95 passing worlds); the Mercury arm is the six-arm sensitivity line. False refusals are counted
per refusal. A refusal aligns with a broken guardrail only when it is a message to the guardrail's recipient or in its
channel (resolved through the enumerated channel list) and names the guardrail's literal.

158 calls the gate cannot read (six arms) are now held, not passed as reads: 150 calls of tools outside the harness's
tool set (each returned only an echo of its own name in these runs, so no write path bypassed the gate here), 5 with
unparseable arguments and 3 undecodable writes. On the five arms they put a hold in 12 of the 95 passing worlds.

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
passing worlds fell from 22 (8 worlds) to 3 (2 worlds; 1 refusal in 1 world on the five arms): two re-sends of one
follow-up e-mail with a reworded body (Mercury arm) and one note re-written on the same contact (haiku-a1c). By the
entity definition they are re-sends the gate should stop, but that is a judgment made after scoring; **the verdict
counts them as false refusals** (finding 9), which on the five arms is exactly the bar (1) and on six arms a kill (3).
Duplicate removal: tasks with duplicates left in the worst arm, 10 → 7 (haiku-a1c) and 12 → 7 (m3-a1c), against a bar of
2.

### 4.3 Readings

- **The mention clause is not met by any source.** rl2 and union refuse 5 of the 12 mention breaks, from 3 tasks; the
  first report's sixth was a refused spreadsheet row append aligned through an empty-channel shortcut (finding 1). The
  scaffold refuses all 12 from 4 tasks, so the call-level rule can reach every mention break when the dispositions and
  targets are right.
- **P refusals carry Δ\*'s scope errors (§2.3):** 13 false refusals in 6 of the 95 passing worlds (rl2, union); a1c and m3
  now have no hard exclusion that refuses anything.
- **Duplicates:** before the gate 10 and 12 tasks for the two A1-C arms (0 or 1 for A0/A1); after, 7 in the worst arm
  against the bar of 2. Exactly-once by key catches identical and lightly reworded re-sends; the rest are re-creations
  with different parents or routes, which need a read-back before a re-send, not a wider key.
- **Unexplained writes carry no signal here:** 13 to 20% of writes discharge no Δ\* obligation, and they sit in passing
  worlds at the base rate (40.0% vs 39.1% on a1c). The kill clause ("right more often than wrong") does not fire.
- **Hold mode (the default since `v3-gate-v2`, ATTACK's "admitted ... or held"):** the gate would hold at least one write
  in 41 of the 95 passing worlds on a1c (35 for an unexplained write), 46 on rl2, 35 on union; holds sit in passing worlds
  at about the base rate (a1c 133 held writes in passing vs 264 in failing worlds). Holding every unexplained write is
  therefore not deployable until Δ\* covers the writes a correct run makes; until then it is the honest default for an
  unattended run and a cost to report, not a precision gain.
- **Certificates:** about 1,930 to 2,010 admitted writes per source carry one; 1,722 to 1,802 of them are confirmed by
  the world's own changes (the stored diff as an end-of-run read-back, `witnessHolds`), about 90%. The rest are claims
  (the tool said ok, the stored world does not show the effect), which is exactly the case the certificate exists to
  catch. The first report counted all of them as witnessed (finding 11).

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
| `verifier/requirement-ledger-v3/rl3.test.mjs` | 32 / 32 | the skeptic's control; ATTACH, randomblob, zeroblob, load_extension, printf, random, PRAGMA, writes behind WITH, `sqlite_master`, `pragma_*`, trailing statements; **the host clock (`'now'`, no time value, a runtime-built `'now'`, `localtime`/`utc`) refused while `:today` and fixed dates compute; a 24 MB DISTINCT fails fast with SQL_SPILL; the time budget, per-predicate retry and SQL_REPLY; predicates cannot close their parentheses or add a query, and their reads are traced; lists posing as predicates (`_mid`, `_label`, the label column, rowid, a constant, an OR with a list) never become hard; induced rules (two claims per side, no extrapolation, never verified, and an unverified include does not beat an induced exclusion); grounded and ungrounded literals, recipients, channels and figure targets; the verdict maps soft failures and undecided checks to UNKNOWN on the assumption list; clock v2 (a future meeting and a ticket's start time are not past events; a record's "as of" is not the work's date); app-qualified pointers never cross apps**; plus the earlier clock, universe, pointer, disposition, consensus, contract and hygiene tests |
| `harness/v3/gate.test.mjs` | 10 / 10 | routes and MIME; identity ignores caller keys; identity v2; message keys by members; P refusals; K refusals; unexplained writes held by default; settle; purity; **fail closed (unknown tools, unparseable arguments, a body without a method, an invalid URL, which crashed the gate before); unenforced sheet-row bans listed and attached as `unverified`; witnesses confirmed only by the world's changes** |
| `replay/dstar-replay.test.mjs` | 6 / 6 | ATTACK's thresholds verbatim; every success and kill boundary of Moves 1 and 2; **per-refusal counting; five arms in the verdict; channel guardrails align only with messages in that channel (a refused row append does not); seeded same-domain matched controls and the dual Move 1 verdict**; duplicate attribution |
| `verifier/requirement-ledger-v3/rl2.test.mjs` (v2's suite on the v3 copy) | 9 / 9 | the inherited grammar |

Each suite was run alone (`nice -n 15 node --test --test-concurrency=1`). **Mutation check (now committed,
`replay/mutation-check.mjs`; result `move12/mutation-check.json`): 62 of 62 deliberately broken variants fail their suite,
including all 38 that revert one fix of §10.** One full run killed 61; the survivor reverted only the predicate text
check and the WHERE splice and was still refused by the read trace (defence in depth), so it was redefined as the full
revert of the old mechanism (no text check, splice, no trace) and run alone on the same code (killed). The first report's "32 of 32" came
from an uncommitted scratch harness (finding 15); the committed one re-creates those categories and adds one mutant per
fix of §10 that reverts it, so each fix has a test that fails on the old behaviour.

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
- **Review fixes are post-hoc (2026-11-04).** Every change of §10 was made after the review read the replay outputs, on
  the same 60 tasks. They tighten what counts as evidence (none was tuned to raise a number), and every verdict moved
  toward kill or stayed, but they are in-sample all the same.
- **Matched controls (finding 8).** ATTACK's Move 1 count needs "14 matched passing controls"; the first report counted
  all 124 passing worlds instead and did not say so. The matching rule (`matchedControls`: same domain first, seeded hash
  order, blind to flags and Δ\*) was written after the all-worlds counts and the reviewer's note that the flags depend on
  which controls are chosen; it is a deviation, not a preregistration. Both counts are reported and give the same
  verdicts. The matched set holds 54 passing worlds of the five arms, not ATTACK's estimate of about 70.
- **Arms.** Move 2's verdict now uses ATTACK's five dev60 arms; the first report used six. The six-arm line is reported
  beside it and is a kill for every source.
- **Universe word lists (finding 18).** The label-column preferences (`LABEL_PREF`, e.g. carrier, dock, location) and the
  organisation suffixes (`ORG_SUFFIX`, e.g. supplies, freelance, logistics) in `universe.mjs` were written in pass 1 by
  an author who had looked at dev60 inventories while building the A1-C arms. They are generic English header and
  company-suffix words, not task or grader strings, but they are informed by dev60 and therefore in-sample.
- **Content-literal hardness (finding 6).** Implemented as the review specified (grounded in the request or a record ⇒
  hard with consensus); §2.3 shows it is a weak basis on dev60. Not changed after measuring.
- **Scaffold.** The ceiling row uses the grader's targets, containers and values as well as oracle dispositions (§2.2).
- **Deviation from ATTACK's recipe.** Readers are the *stored* list-style outputs, adapted; ATTACK's step A asks exactly
  that ("with the reader's existing exclusion rules"). The gate replay is harness/v3's, not v2's frozen `replay-gate.mjs`
  (§4.1). The stored readers ran with effort unset (Move 0: every dev60 arm is non-conforming), and that carries over.
- Nothing here reads look-2/look-3, devCheck, test or sealed data. The `/var/tmp/foundry-work/autobench/` tree holds such
  runs; only the lab's dev60 rows (its `load.mjs`) were opened.

## 8. What is left, and why

1. **The decisive Move 1 experiment is paid and needs a frozen preregistration first (D22): readers write predicates and
   SELECTs per obligation** (ATTACK: ≤ $1.5, Haiku, ledger only, 60 dev60 tasks, replayed against the stored worlds with
   the same scoring). Today's replay shows that the stored readers' outputs carry almost no executable rule (and that
   lists and code-induced rules must not stand in for one); whether readers asked for predicates write rules that are
   right and correctly scoped is what that step tests. Not built yet: the v3 reader prompt and strict output schema
   (v3's `extract.mjs` is still v2's list prompt). Proposed frozen numbers: ATTACK's on the matched count with this
   file's control rule, plus a scope check (no hard exclusion outside the obligation that disposed it), the §2.3
   precision table for positives, and a stronger basis for hard content literals.
2. **Disposition scope in code** (narrow a per-item complement to its obligation's content; never spread an item's
   exclusion across obligations). Identified in §2.3, not applied, because it would be post-freeze tuning on the same
   60 tasks; it belongs in the reader-step build with its own preregistered replay.
3. **Duplicates** stay above the bar (7 tasks in the worst arm against 2). The next lever is the certificate's read-back
   before any re-send (the witness spec and `witnessHolds` exist now; a live gate must read the world, not the stored
   diff), plus A1-C v2.1 not re-sending on repair (VL M3), not a wider key.
3b. **Hold mode** would stop a write in 35 to 46 of 95 passing worlds. Before the gate holds unexplained writes in a live
   run, Δ\* must explain the writes a correct run makes (obligation coverage), or the product must turn a hold into a
   question to the user; the cost belongs in the A1-C v2.1 preregistration.
3c. **Sheet-row bans** cannot be enforced at the call (the call does not carry the row); they are listed as `unverified`.
   Mapping a sheet range to its rows would close this; not built.
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
| `nice -n 15 node experiments/autobench/replay/mutation-check.mjs --work <empty scratch dir> --out <f>` | `move12/mutation-check.json` (about 20 minutes; one mutant writes up to 8 MiB of SQLite temp data per worker before the cap stops it, and its reverted twin up to about 50 MB in `/var/tmp`, freed at exit) |

Checksums of every output: `move12/SHA256SUMS`.

## 10. Review of 2026-11-04 (of `28d74da9`): findings and what was done

| # | Finding (reviewer's severity) | Done | Evidence |
|---|---|---|---|
| 1 | Move 2 mention clause wrongly met: a refused call with no channel aligned with a channel guardrail (HIGH) | `refusalAligns` aligns only refused **messages** to the guardrail's recipient or in its channel, the call's channel resolved through the enumerated channel list; no empty-channel shortcut | rl2/union 6 of 12 from 4 tasks → **5 of 12 from 3 tasks**; scaffold stays 12/12; test with a refused row append |
| 2 | Reader SQL could read the host clock (HIGH) | date, time, datetime, julianday, unixepoch, strftime replaced in the worker: `'now'` (also built at run time), no time value, `localtime`/`utc` → SQL_CLOCK; other arguments computed by SQLite's own function on a private connection | test: 10 host-clock forms refused, `:today` and fixed dates compute; a `julianday('now')` predicate disposes nothing |
| 3 | Reader SQL could fill the shared disk (HIGH on this host) | worker under `ulimit -f` (8 MiB); spill → SQL_SPILL in milliseconds | **disagreement in part:** in-memory temp storage was rejected because this build does not enforce SQLite's heap limit (measured: 110 MB resident under `hard_heap_limit` = 4 MB); test: a 24 MB DISTINCT fails fast |
| 4 | A hand-written list passed as an executed predicate (MED-HIGH) | predicate = projected boolean (`CASE WHEN (…)`), balanced parentheses, no statement keyword outside parentheses; reads traced by the authorizer; reading an identifying column or no attribute ⇒ list ⇒ soft | test: `_mid IN`, `_label IN`, the label column, rowid, a constant, an OR with a list, `0) UNION SELECT 1 --` |
| 5 | The verdict let soft failures pass (MED) | a failed soft check and an undecided check are UNKNOWN and on the assumption list; release = no FAILED | **disagreement in part:** a soft check that passes stays SUPPORTED (the world already satisfies it; nothing is assumed). Test |
| 6 | Mechanisms (c), (d) partly built (MED) | grounded content literals → hard `msg_has`/`created_has` (consensus); ungrounded → soft + UNKNOWN; recipients, channels and figure targets grounded before a hard positive | §2.3: record-grounded literals are a weak basis (kept as specified, flagged for the reader prereg) |
| 7 | Code-induced rules counted as reader rules (MED) | basis `induced`, never verified or hard; ≥ 2 claims per side; no extrapolation; an unverified include needs no exclude vote of any kind | a1c recall 1 → 0, m3 recall 2 → 0, m3 flags 13 → 0 |
| 8 | Move 1 counted all passing worlds, not ATTACK's matched controls; six arms where ATTACK names five (MED) | seeded matched controls (post hoc, §7), both counts reported; Move 2 verdict on five arms, six-arm line beside it | union: kill on both counts (4 of 54 matched flagged), not "undetermined" as the reviewer expected, because the seeded controls include flagged tasks |
| 9 | a1c Move 2 verdict softened (MED) | the computed verdict is reported; the "true duplicates" reading is a note | a1c: no success, no kill on five arms (1 refusal = the bar); kill on six arms |
| 10 | The live gate let writes through unchecked (MED) | unknown tools, unparseable arguments, a body without a method, undecodable writes and invalid URLs are held (an invalid URL crashed the gate before); unenforceable bans listed and attached as `unverified` | 158 calls held in the replay; gate tests |
| 11 | Certificates had no read-back; unexplained writes admitted by default (MED-LOW) | the witness is a read-back spec; `witnessHolds` confirms it from the world's changes; unexplained writes held by default; hold-mode numbers reported | about 90% of certificates witnessed by the stored diff; hold mode stops a write in 35–46 of 95 passing worlds |
| 12 | Scaffold claim overstated (MED-LOW) | wording: the ceiling also uses the grader's targets, containers and values | §0, §2.2 |
| 13 | Clock could be certain and wrong (MED-LOW) | past-event fields only (scheduled kinds and start/end/due fields are business dates); a reader's today only from the request | test; replay B and the clock census unchanged |
| 14 | No overall SQL time budget; ENOBUFS called a timeout (LOW-MED) | one budget per call; a failed batch is retried per predicate (all its day-variants together); SQL_REPLY | test: 8 runaway day-variants fail together in < 2 s |
| 15 | Tests missed findings 1–5, 7, 10; mutation harness not committed (LOW-MED) | tests added; `replay/mutation-check.mjs` committed | 62 of 62 mutants killed, 38 of them reverts of a fix (§6) |
| 16 | Move 2 counted worlds, not refusals (LOW) | per-refusal count | rl2: 13 refusals in 6 worlds (five arms) |
| 17 | Evidence wording (LOW) | replay B: at most 2 of 7 meet the criterion; "grades read after the build" corrected | §0, §3, header |
| 18 | Pointer fallback could cross apps; universe word lists informed by dev60 (LOW) | an app-qualified pointer never resolves to another app's member; word lists disclosed (§7) | test; the pointer replay is byte-identical |

Superseded numbers of the first report (code `28d74da9`): Move 1 recall a1c 1, m3 2, rl2 3, union 5; flags (all worlds)
0, 13, 11, 11. Move 2 (six arms, worlds): mention 1, 3, 6, 6 of 12; false-refusal worlds 2, 12, 10, 10; scaffold 12 of 12,
3 worlds.

