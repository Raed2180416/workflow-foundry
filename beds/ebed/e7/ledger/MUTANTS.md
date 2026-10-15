# E7 oracle mutants: 679 mutants, one standard

Development and diagnostic evidence ($0, no model calls, 2026-10-15). The tool is `tools/mutate.mjs`, ported from
E8's (`beds/ebed/e8/tools/mutate.mjs`). Its mutants come from the two oracle modules: `transition.mjs` (ids t1–t483,
sha256 `05c6609dde239584…`) and its SLA engine `sla.mjs` (ids e1–e196, sha256 `17b1b07c334120aa…`). Neither module was
changed by this review. The measured run is `ledger/mutation-20261015.json`.

**In short.** The first measured run (run 1) used 29 goldens: the item's 28, plus the instants golden written first in this review. It killed 504 of 679. Its 175 survivors
were triaged one by one: 47 were killable, 126 are grader-equivalent and 2 are uncertain. Three of the killable were
first triaged as equivalent and corrected: t66 and t341 when the final run killed them, and t345 on a witness journal
found while checking t341 (§4, §5). The killable ones got 26 new goldens, each asserting a spec-stated outcome the grader
sees. The final run used 54 goldens; G10c (for t345) was written after it, and its 129 survivors were then re-run against
all 55 goldens (golden-only: the corpus differential does not depend on the goldens, and a kill cannot be undone). The
result: 551 of 679 killed (461 by goldens, 86 by the corpus, 4 by the time or memory limit), 126 equivalent, 2 uncertain.

| formula | value |
|---|---|
| raw (killed / all) | 551 / 679 = **0.811** |
| E-BED §9.5 (killed / (all − equivalent)) | 551 / 553 = **0.996** |
| run 1 (29 goldens), raw | 504 / 679 = 0.742 |

The raw formula cannot reach K1 (0.95) while the 126 equivalents stay in the operator set, as for E8 (whether K1
counts equivalents in the denominator is the owner's decision). Under the second formula, which is the one E-BED §9.5
uses ("each survivor is equivalent or gets a new golden"), only the two uncertain mutants are left (§4).

## 0. The standard (one, for every mutant)

**What is compared.** The original and the mutant oracle are compared on what the shared grader reports
(`oracle/grade.mjs` `gradeCase`):
- for a completed-pool case: its verdict (`pass`), any oracle error, and the first divergence as layer/code/lid (E8's
  key);
- for every case: its critical codes.

The critical codes are part of E7's comparison because `critical()` (index.mjs) reads the transition's own history
(counted answers, moot approvals, the deadline), so a mutant of `transition.mjs` can change them. E8 compared verdicts
only. Three things are not compared: the instant of the first divergence, the detail of a critical, and the verdicts of
censored cases, which no score counts.

The mutant oracle is the whole binding re-imported over the mutant modules (a copy of `index.mjs`), so
`referenceTransition`, `recordsOf`, `canonicalArgs` and `critical` are all the mutant's. E8's H1 (`canonicalArgs` never
swapped in) does not arise.

**Reachable input.** A journal the host can write, for some arm, on some world of E7's world contract.

- **Any arm behaviour, within what the systems accept** (`systems.mjs`):
  - `itsm` checks no transition (R8 is the arm's job). It refuses unknown CIs, services, groups and incidents.
  - `sla` checks the stage, not the order of the `at` values. It accepts a breach or an escalation only for a recorded
    SLA.
  - Instant arguments (`TIME`) are any string of 1–40 characters.
  - The host refuses an effect whose `args` are not an object (an arm error, no ledger row).
- **Host semantics:**
  - Delivery within an instant is by (source, id).
  - A result arrives one minute after its effect.
  - A committed key is deduplicated.
  - F5 renames are mapped back.
- **World contract** (`world.mjs`, DESIGN §4):
  - The rulebook is generated per difficulty. From d4 there are two editions, effective 2026-01-01 and 2026-03-23.
    - `policy.json` and `alert-urgency.json` are identical in both editions.
    - `order` values are unique.
    - Every target × percent / 100 is a whole number.
    - No condition list is empty.
    - Every definition with a `reset` also has `whenStartFails`.
    - Escalations are listed in ascending percent.
    - Priority is monotone in urgency.
  - Which incident a message or an alert belongs to is the world's truth (`truth.eventCase`).
  - A caller's message about an incident comes after its report.
  - Go-live incidents are the four DESIGN §4.6 stages: report-opened, P3/P4, one export record each, nothing at t0
    itself.
  - Resolvers act along R8.2: an accept follows an assignment, and a resolver update comes ≥ 16 min after it.
  - The analyst-only `controlFlags` never occur in a generated world.
- **Inputs the spec states, generated or not.** The generator's class mix is a sample, not a limit (E8's rule), so these
  are reachable even where no generator class produces them:
  - a reply during a hold for another reason (R6.2);
  - updates after the resolution (R3.3);
  - a confirmation or a withdrawal at any time (R6.5, R6.6);
  - two approval tasks in one instant, and a re-ask at the deadline (R7.2);
  - instants written at any offset, or as no instant at all (§1).

**Killed** means one of:
1. a golden that passes the original fails the mutant (goldens assert only spec-stated outcomes the grader sees, §5);
2. the corpus differential shows a different signature on some case (§3);
3. the mutant oracle does not finish (time limit or memory limit), does not load, or throws where the original does not.

E8 also required a searched witness journal for each golden kill. That search was not repeated here. §5 instead says, per
kind of golden assertion, how the grader sees it, and the one invisible assertion found became a unit check. Witness
journals were built only for the projected deadline windows (t341–t349, §5), where run 1's triage had been wrong.

**Equivalent (grader)** means no reachable input gives a different signature: no golden fails it, the corpus
differential shows 0 differences, and a one-line argument says why. The kinds:

| kind | meaning |
|---|---|
| contract | only inputs outside the world contract or the host semantics separate the two |
| consumed | the grader never reads the difference |
| stopped | the difference arises only after the grader has stopped at an earlier divergence of the same journal |
| code | dead code, the same value, or only slower (cache and memo mutants) |

**Uncertain** means the mutant is separated only by an input whose reachability the spec leaves open (§4).

## 1. Result

| verdict | transition.mjs | sla.mjs | all |
|---|---|---|---|
| killed by a golden | 319 | 142 | 461 |
| killed by the corpus differential | 75 | 11 | 86 |
| killed by the time or memory limit, or an error | 4 | 0 | 4 |
| equivalent (grader: contract) | 37 | 23 | 60 |
| equivalent (grader: consumed) | 8 | 0 | 8 |
| equivalent (grader: stopped) | 5 | 0 | 5 |
| equivalent (grader: code) | 33 | 20 | 53 |
| uncertain | 2 | 0 | 2 |
| **total** | 483 | 196 | **679** |

Kills by check (the final run with the golden-only re-run): golden 461, corpus 86, memory 4. Run 1, with 29 goldens, was 385 by goldens,
115 by the corpus and 4 by the time limit. The final run was paused at the owner's request after 222 mutants and resumed
with `--resume` on the same sources, corpus key and goldens (the run id hashes the two sources and the corpus key).

Four mutants never terminate. Run 1 stopped them by the time limit; the final run stopped all four by the memory
watchdog. Each leaves a deadline in the list that its firing never removes, so the deadline loop never ends:
- t223 deletes `appr.dl = …`;
- t273 sends a caller deadline into the fail-safe branch;
- t283 sends the approval deadline into the auto-closure branch;
- t291 deletes `appr.declared = D`.

An oracle that never answers cannot grade. The loop also allocates on every turn. A first attempt at the final run was
killed by the kernel at 6.5 GB while running t223, because the worker's old-generation cap did not bound the process.
The tool now has an RSS watchdog in the main thread (§7).

## 2. The mutant set

`mutantsOf()` applies generic per-line operators to every code line of both modules:

| operator | count |
|---|---|
| relational boundary | 38 |
| equality | 168 |
| logic | 118 |
| arithmetic swap, max/min, floor/ceil | 31 |
| window bound (±1 min) | 13 |
| first/last pick | 18 |
| statement deletion | 173 |
| deleted guard (an `if (…) return\|continue\|break` made `if (false)`; input-validation throws are left alone) | 56 |

It adds 64 named semantic operators from E-BED §9.5 and DESIGN §10 (§2.1). Mutants with the same module text are one
mutant: the first operator names it and the others are listed as aliases. One generated edit did not parse and is not a
mutant (`sla.mjs:200`, first/last pick).

The ids are index-stable for these two sources. A source change renumbers everything after the changed line.

### 2.1 The named operators and their fate

| E-BED §9.5 / DESIGN §10 operator | mutant | final |
|---|---|---|
| breach boundary inclusive (S2) | e168 | killed, golden G15 |
| threshold ceil | e169 (generic floor→ceil) | **equivalent (contract)**: every target × percent / 100 is a whole number, so R5.1's rounding is never exercised |
| holidays dropped | e11 | killed, golden G2 |
| zone swapped: the system zone, the calendar's own zone ignored, source precedence reversed | e54, e47, e49 (`.find`→`.findLast` over the sources) | killed, golden G5 (e49: G7) |
| calendar swap: 24×7, service ↔ group schedule | e53, e42, e44 | killed (G2; corpus; G12) |
| pause condition deleted (attach / evaluation) | e56, e106 | killed, goldens G11, G8 |
| pause on any hold | e63 | killed, corpus (ref-earliest@1009:3) |
| retroactive start / retroactive pause dropped | e39, e58 | killed, golden G11 |
| attaches running although its pause holds (S14) | e76 | killed, golden G11b |
| reset dropped (evaluation / attach) | e97, e119 | killed, golden G12 |
| reset re-attach in the old edition (S15) | e103 | killed, **new golden G12c** |
| reset re-attach unconditional (S15) | e105 | **equivalent (contract)**: every definition with a reset has whenStartFails, so the branch only runs with its start holding |
| edition by startAt (S6) | t433, e34 | killed, golden G13 |
| edition by publication | t25 | killed, new golden G27 (run 1: corpus, ref-earliest@1010:5) |
| edition by run date: priority, definitions | t86, t369 | killed (new golden G27, run 1 corpus; corpus) |
| edition by run date: alert urgency, approval deadline, caller/closure days | t85, t224, t47 | **equivalent (contract)**: `alert-urgency.json` and `policy.json` are identical in both editions (R0 for them is not exercised in slice 1) |
| first-match / highest-order precedence (R2.2, R3.1) | t34, t35, t44, t45 | killed (G1; corpus) |
| D anchored at attach | e55 | killed, golden G11 |
| start record plans the current D / from the attach (S13) | e143, e144 | killed (G8, G11) |
| recipient fixed at attach / the current group / at the threshold (R5.2) | t402, t374, t403 | killed (new golden G30, run 1 corpus; corpus; **new golden G30b**) |
| SoD exclusion dropped | t358 | killed, golden G14 |
| dedupe on CI only, join after resolution | t122, t123 | **equivalent (contract)**: which incident an alert joins is the world's truth, and the transition only validates it |
| closure at D (S1) | the `+ SEC` window bounds | killed, golden G9 |
| escalations skipped when reached before the attach (S12) | t400 | killed, new golden G14i (run 1: corpus) |
| closure and declaration windows one minute longer (window bound, R6.3, R6.5, R7.2): the fired deadline / the pending projection | t278, t288, t294 / t341, t343, t345, t347, t349 | killed (G9, G10, G14) / t341 killed (G9c), t345 killed (**new golden G10c**); t343, t349 **equivalent (consumed)**, t347 **equivalent (contract)** (§5) |
| R4.2 order: stop before cancel (S5; the analogue of "compensation order reversal") | e89 | killed, **new golden G20c** |
| missing key / record order: not after create, SLA records not in lifecycle order, breach not before the end | t339, t382, t396 | killed (**G29**, **G29**, G15) |
| approval: anchored at the latest P1, re-ask on a timeout, re-ask without a cause, any task's answer counts, answer after the deadline counts | t58, t8, t231, t243, t244 | killed (**G22**, G14b, G14b, G14b); t244 **equivalent (code)**: the fail-safe has always fired before a later answer is processed |
| other engine operators (conditions any/every, null vs missing field, generation count, cancel reasons, 100% apart from D, thresholds after the end, elapsed counts paused time) | e7, e2, e37, e90, e94, e171, e179, e185 | killed, except e2, e171 and e179: **equivalent (code)** |

## 3. The corpus differential

The corpus is 93 journals on four dev worlds (dev seeds 1001–1199 only; the tool refuses others):
- worlds 1009:d3, 1010:d5, 1011:d4 and 1012:d2, each with size 60;
- 275 cases in all;
- per world: both reference runs, every control applicable at that difficulty (18–19), and the three solvers under
  `specificity/`. The solvers run out of process in the sandbox arm.

The solvers are s1, s2 and s3 at sha256 `471bf324…`, `6609dc42…` and `134b6749…`. They are blind drafts by another
session and were still being edited (2026-10-15); the corpus key records their hashes.

Grading is per case. A case's journal content, as the grader reads it (`idx.bucket(c)`: deliveries, ledger rows, tasks,
task events, and calls reduced to outcome, decisions and whether they emitted anything), is identical across journals
up to sequence numbering and instance names. Such a case is graded once, since its grade is a function of that content.
6,402 case gradings reduce to **4,976 distinct case contents**. A full pass of the original takes 10–16 s; a surviving
mutant needs one pass, or about 250 s when the mutant disables a cache. The ledger args are run through the oracle's own
`canonicalArgs`: the original's once, and a mutant's own for mutants of `utc`/`canonicalArgs`.

Run 1's 115 corpus kills first differed on:
- `ref-earliest`: 108;
- `first-match-priority`: 3;
- `timer-first`: 2;
- `echo`: 1;
- `s3.mjs`: 1.

By first-differing signature:
- layer-5 records: 46;
- outside-allowed: 24;
- missed: 20;
- oracle error: 11;
- decision: 8. One of them, t49, differs only in its critical code: `historyOf` returning null for every incident sends
  `critical()` to its rows-only fallback, so a `major-without-approval` disappears.
- over/under-escalation: 3;
- order: 1;
- a passing case left open: 1;
- grading threw: 1.

In the final run the corpus killed 86 (`ref-earliest` 80, `first-match-priority` 3, `timer-first`, `echo` and `s3.mjs` 1
each): the new goldens kill the other 29 of run 1's corpus kills first (t25, t86, t400 and t402 among them, §2.1).

## 4. Run 1's 175 survivors, triaged

Every survivor of run 1 is either killed by a new golden (47, named in the evidence column) or equivalent (126) or
uncertain (2). The evidence is the final run's, or for t345 the golden-only re-run with G10c. For equivalents the corpus
figure is from the final run. Lines are the current sources'; `tr` is transition.mjs.

| k | line | operator | mutant line | verdict | reason (one line) | evidence |
|---|---|---|---|---|---|---|
| t10 | tr:38 | logic | `if (!args && typeof args !== 'object' \|\| Array.isArray(args)) return args;` | equivalent (contract) | the guard returns non-objects as they are; the host refuses an effect whose args are not an object (host/output.mjs: `args: not an object`, an arm error, no ledger row), so canonicalArgs only ever sees objects | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t11 | tr:38 | logic | `if (!args \|\| typeof args !== 'object' && Array.isArray(args)) return args;` | equivalent (contract) | as t10 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t12 | tr:38 | deleted guard | `if (false) return args;` | equivalent (contract) | as t10 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t17 | tr:45 | equality | `if (out !== args) out = { ...args };` | equivalent (code) | canonicalises in place instead of in a copy: the same values come back (canonicalisation is idempotent, so a row read twice is unchanged) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t19 | tr:56 | deleted guard | `if (false) return r;` | equivalent (code) | rulesOf without its cache: rebuilt from the world on every call (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t20 | tr:60 | relational boundary | `.sort((a, b) => (a.effectiveFrom <= b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFr`… | equivalent (contract) | the edition sort differs only for two editions with the same effectiveFrom; every rulebook's effective dates are distinct (2026-01-01, 2026-03-23) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t21 | tr:60 | relational boundary | `.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom >= b.effectiveFr`… | equivalent (contract) | as t20 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t22 | tr:61 | first/last pick | `const systemTz = eds.at(-1).policy.systemTimeZone;` | equivalent (contract) | the system zone read from the last edition: policy.json is identical in both editions of every rulebook (Europe/Amsterdam) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t23 | tr:68 | statement deletion | `void 0;` | equivalent (code) | as t19 (cache never written) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t33 | tr:86 | relational boundary | `return rows.reduce((a, b) => (b.order <= a.order ? b : a)).priority;` | equivalent (contract) | `<=` changes only which of two rows with the same `order` wins; `order` is unique in every priority.json (13 or 14 rows) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t43 | tr:93 | relational boundary | `const g = rows.reduce((a, b) => (b.order <= a.order ? b : a)).group;` | equivalent (contract) | as t33 for assignment.json (4 or 5 rows, unique orders) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t47 | tr:100 | edition at the horizon: caller and closure days (R0, R6) | `const pol = editionAt(world, ms(world.horizonEnd)).policy;` | equivalent (contract) | the caller and closure days of the edition at the horizon instead of at the clock's start: policy.json is identical in both editions of every rulebook (R0 for the policy is not exercised by slice 1) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t50 | tr:130 | logic | `if (!t && t.subject === null) return null;` | equivalent (consumed) | historyOf is called only by critical(), which returns before it for a case with no incident | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t51 | tr:130 | deleted guard | `if (false) return null;` | equivalent (consumed) | as t50 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t58 | tr:167 | approval anchored at the latest P1, not the first (R7.1) | `if (inc.priority === 1) appr.x = at;` | killed (new golden) | G22: a later reclassification that keeps priority 1 moves the approval anchor (R7.1 'first becomes 1') | final run: golden `G22 approval anchored where the priority first became 1` |
| t66 | tr:171 | logic | `if (appr.x === null \|\| appr.answer && appr.moot !== null \|\| appr.declared !== null) return`… | killed (new golden) | G14d: with no counted answer, `appr.answer && appr.moot !== null` is false, so the guard no longer returns once the approval is moot and a later change of the ended incident moves the moot instant (R7.3, S11; first triaged as equivalent, corrected by the final run) | final run: golden `G14d an approval is moot from the first instant it is moot` |
| t67 | tr:171 | logic | `if (appr.x === null \|\| appr.answer \|\| appr.moot !== null && appr.declared !== null) return`… | killed (new golden) | G14d: a later change of an ended incident moves the moot instant, so a task created after the approval became moot is allowed (R7.3, S11) | final run: golden `G14d an approval is moot from the first instant it is moot` |
| t72 | tr:172 | deleted guard | `if (false) return;` | equivalent (code) | unreachable: an approval deadline earlier than an event's or another deadline's instant has always fired first (fireBefore), so `declared` is set and the first guard returns | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t85 | tr:189 | edition by run date: alert urgency (R0, R2.1) | `const urgency = isAlert ? editionAt(world, now).alertUrgency[pl.severity] : pl.urgency;` | equivalent (contract) | alert-urgency.json is identical in both editions of every rulebook | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t93 | tr:204 | first/last pick | `const rec = (e.payload.records?.['itsm.incidents'] ?? []).findLast(x => x.number === N);` | equivalent (contract) | a go-live export holds one incident record per number | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t94 | tr:206 | arithmetic swap | `const pre = [...(e.payload.events ?? [])].map((x, i) => ({ ...x, at: ms(x.at), seq: e.seq `… | equivalent (code) | the seq given to the replayed pre-t0 events is stored on the history's changes and never read | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t95 | tr:206 | arithmetic swap | `const pre = [...(e.payload.events ?? [])].map((x, i) => ({ ...x, at: ms(x.at), seq: e.seq `… | equivalent (code) | as t94 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t96 | tr:206 | arithmetic swap | `const pre = [...(e.payload.events ?? [])].map((x, i) => ({ ...x, at: ms(x.at), seq: e.seq `… | equivalent (code) | as t94 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t98 | tr:207 | equality | `const rep = pre.find(x => x.type === 'incident.reported' \|\| x.type !== 'alert.raised');` | equivalent (contract) | every go-live incident is one of the four DESIGN §4.6 stages, opened by a caller's report that is the export's first event, so the opening is found either way | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t100 | tr:207 | first/last pick | `const rep = pre.findLast(x => x.type === 'incident.reported' \|\| x.type === 'alert.raised')`… | equivalent (contract) | as t98: one report per export, no alert | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t105 | tr:209 | logic | `if (inc.priority !== rec.priority && inc.group !== rec.assignmentGroup \|\| inc.openedAt !==`… | equivalent (contract) | the guard checks that the migrated record agrees with the rules; the export always does (the generator writes it by the same rules), so throwing less changes nothing | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t106 | tr:209 | logic | `if (inc.priority !== rec.priority \|\| inc.group !== rec.assignmentGroup && inc.openedAt !==`… | equivalent (contract) | as t105 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t119 | tr:228 | logic | `if (inc.source.kind !== 'alert' && pl.ci !== inc.ci \|\| pl.check !== inc.check \|\| ENDED.has`… | equivalent (contract) | the alert-join guard only throws on an alert that the world's truth gives to an incident it does not join; the grader takes each alert's incident from the world's truth (oracle/view.mjs eventCase), so a joining alert always fits | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t120 | tr:228 | logic | `if (inc.source.kind !== 'alert' \|\| pl.ci !== inc.ci && pl.check !== inc.check \|\| ENDED.has`… | equivalent (contract) | as t119 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t121 | tr:228 | logic | `if (inc.source.kind !== 'alert' \|\| pl.ci !== inc.ci \|\| pl.check !== inc.check && ENDED.has`… | equivalent (contract) | as t119 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t122 | tr:228 | dedupe on CI only (R1.2, R1.3) | `if (inc.source.kind !== 'alert' \|\| pl.ci !== inc.ci \|\| ENDED.has(inc.state)) throw new Err`… | equivalent (contract) | as t119 (dedupe on CI only: which incident an alert joins is the world's truth, not the transition's) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t123 | tr:228 | join after resolution (R1.3, S8) | `if (inc.source.kind !== 'alert' \|\| pl.ci !== inc.ci \|\| pl.check !== inc.check) throw new E`… | equivalent (contract) | as t119 (an alert after the resolution belongs to a new incident in the world's truth, S8) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t124 | tr:229 | statement deletion | `void 0;` | killed (new golden) | G16b: a joining alert delivered again re-opens its link window at the redelivery (R1.4) | final run: golden `G16b a joining alert delivered again changes nothing` |
| t132 | tr:238 | statement deletion | `void 0;` | equivalent (contract) | checkMoot after a joining alert's reclassification: the alert only lowers urgency (R1.3), priority is monotone in urgency in every edition's priority.json (checked: no cell where a more urgent urgency gives a larger priority number), and an ended incident takes no joining alert (S8), so the approval never becomes moot there | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t134 | tr:244 | logic | `if (!inc.opened && ENDED.has(inc.state)) return;                          // R3.3` | killed (new golden) | G25: an update about a resolved incident is applied (R3.3) | final run: golden `G25 updates about a resolved incident change nothing` |
| t135 | tr:244 | deleted guard | `if (false) return;                          // R3.3` | killed (new golden) | G25 (as t134) | final run: golden `G25 updates about a resolved incident change nothing` |
| t139 | tr:249 | statement deletion | `inc.assignee = pl.user; inc.state = 'inProgress'; void 0;` | equivalent (contract) | accept leaves holdReason as it was: an accept comes for an assigned incident (after an assignment, which clears the hold), so holdReason is already null; every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t149 | tr:261 | statement deletion | `inc.state = 'inProgress'; void 0; pend.caller = null;` | equivalent (contract) | resume leaves holdReason set: every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t150 | tr:261 | statement deletion | `inc.state = 'inProgress'; inc.holdReason = null; void 0;` | equivalent (code) | resume leaves pend.caller set: pend.caller is read only while the incident is on hold awaiting the caller, and every such hold sets it afresh | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t155 | tr:265 | statement deletion | `inc.group = pl.toGroup; inc.k += 1; inc.state = 'assigned'; void 0; inc.holdReason = null;`… | killed (new golden) | G26: a reassignment keeps the old assignee in the records (R3.2: it clears the assignee) | final run: golden `G26 a reassignment clears the assignee` |
| t156 | tr:265 | statement deletion | `inc.group = pl.toGroup; inc.k += 1; inc.state = 'assigned'; inc.assignee = null; void 0; p`… | equivalent (contract) | reassign leaves holdReason set: every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t157 | tr:265 | statement deletion | `inc.group = pl.toGroup; inc.k += 1; inc.state = 'assigned'; inc.assignee = null; inc.holdR`… | equivalent (code) | as t150 (reassign) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t159 | tr:272 | equality | `if (impact !== inc.impact && urgency === inc.urgency && priority === inc.priority) return;`… | killed (new golden) | G22: a reclassification that changes the impact but not the urgency or priority records nothing (R2.3) | final run: golden `G22 approval anchored where the priority first became 1` |
| t160 | tr:272 | equality | `if (impact === inc.impact && urgency !== inc.urgency && priority === inc.priority) return;`… | killed (new golden) | G27: a reclassification that changes the urgency but not the priority records nothing (R2.3) | final run: golden `G27 a reclassification records any change and nothing else` |
| t161 | tr:272 | equality | `if (impact === inc.impact && urgency === inc.urgency && priority !== inc.priority) return;`… | killed (new golden) | G27: a reclassification with the same impact and urgency whose priority changes with the edition (R0) records nothing (R2.3) | final run: golden `G27 a reclassification records any change and nothing else` |
| t163 | tr:272 | logic | `if (impact === inc.impact && urgency === inc.urgency \|\| priority === inc.priority) return;`… | killed (new golden) | G22, G27: a reclassification that keeps the priority but changes impact or urgency records nothing (R2.3) | final run: golden `G22 approval anchored where the priority first became 1` |
| t164 | tr:272 | deleted guard | `if (false) return;     // R2.3: nothing changes` | killed (new golden) | G27: a reclassification that changes nothing is recorded (R2.3: otherwise nothing) | final run: golden `G27 a reclassification records any change and nothing else` |
| t169 | tr:280 | statement deletion | `inc.state = 'resolved'; void 0; inc.resolvedAt = at; inc.closeCode = pl.closeCode; pend.ca`… | equivalent (contract) | resolve leaves holdReason set: every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t172 | tr:280 | statement deletion | `inc.state = 'resolved'; inc.holdReason = null; inc.resolvedAt = at; inc.closeCode = pl.clo`… | equivalent (code) | as t150 (resolve) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t178 | tr:292 | deleted guard | `if (false) return;` | equivalent (contract) | a caller's message about an incident comes after its report: the world's truth gives a message to an incident only once it exists (a message naming no recorded incident is a stray with no subject, §3.3) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t184 | tr:296 | logic | `if (!(inc.state === 'onHold' \|\| inc.holdReason === 'awaitingCaller' && pend.caller && at <`… | killed (new golden) | G28: a reply while the incident is on hold for another reason resumes it (R6.2: a reply at any other time changes nothing) | final run: golden `G28 a reply during a hold for another reason changes nothing` |
| t185 | tr:296 | logic | `if (!(inc.state === 'onHold' && inc.holdReason === 'awaitingCaller' \|\| pend.caller && at <`… | uncertain | differs only when pend.caller survives the end of an awaiting-caller hold, i.e. a hold (another reason) arriving while the incident is already on hold awaiting the caller, then a reply before D; no generator class does this (hold-change is a new reason from inProgress) and the spec neither allows nor forbids a hold during a hold (R3.2 vs R8.2) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t188 | tr:297 | statement deletion | `void 0; inc.holdReason = null; pend.caller = null;` | uncertain | after a reply the state stays onHold (holdReason null): no condition separates onHold from inProgress except VND-HOLD's stop, and VND-HOLD can run during an awaiting-caller hold only after a hold during a hold (vendor, then caller), the input of t185 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t189 | tr:297 | statement deletion | `inc.state = 'inProgress'; void 0; pend.caller = null;` | equivalent (contract) | reply leaves holdReason set: every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t190 | tr:297 | statement deletion | `inc.state = 'inProgress'; inc.holdReason = null; void 0;` | equivalent (code) | as t150 (reply) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t193 | tr:300 | relational boundary | `if (!(inc.state === 'resolved' && pend.resolved && at < pend.resolved.D2)) return;` | killed (new golden) | G10b: a confirmation exactly at D2 no longer counts (R6.5, S1) | final run: golden `G10b a confirmation at D2 counts; one before the resolution changes nothing` |
| t195 | tr:300 | logic | `if (!(inc.state === 'resolved' \|\| pend.resolved && at <= pend.resolved.D2)) return;` | equivalent (code) | `state === 'resolved'` and `pend.resolved && at <= D2` coincide: pend.resolved is set exactly while the incident is resolved (updates after the resolution change nothing, R3.3), and a confirmation after D2 is processed after the auto-closure fired (fireBefore) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t201 | tr:301 | statement deletion | `inc.state = 'closed'; inc.closedAt = at; inc.closeReason = 'confirmed'; void 0;` | equivalent (code) | confirm leaves pend.resolved set: it is read only while the incident is resolved, and the incident is closed | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t204 | tr:304 | deleted guard | `if (false) return;` | killed (new golden) | G18b: a withdrawal after the resolution cancels the incident (R6.6: otherwise it changes nothing) | final run: golden `G18b a withdrawal after the resolution changes nothing` |
| t207 | tr:305 | statement deletion | `inc.state = 'cancelled'; inc.cancelledAt = at; void 0; pend.caller = null; pend.resolved =`… | equivalent (contract) | withdraw leaves holdReason set: every definition's cancel condition (state cancelled) is checked first, and every rulebook condition on holdReason is paired with state onHold (pause: onHold+awaitingCaller; VND-HOLD start: onHold+awaitingVendor), so a stale holdReason outside a hold changes no SLA; the incident record carries no holdReason | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t208 | tr:305 | statement deletion | `inc.state = 'cancelled'; inc.cancelledAt = at; inc.holdReason = null; void 0; pend.resolve`… | equivalent (code) | as t150 (withdraw) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t209 | tr:305 | statement deletion | `inc.state = 'cancelled'; inc.cancelledAt = at; inc.holdReason = null; pend.caller = null; `… | equivalent (code) | dead statement: a withdrawal counts only before the resolution, so pend.resolved is already null | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t218 | tr:323 | logic | `if (appr.x === null \|\| x.at < appr.x && appr.moot !== null) return;` | equivalent (code) | `x.at < appr.x` is never true once appr.x is set: tasks are processed in time order, and appr.x is the instant of an earlier or same-instant occurrence | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t224 | tr:328 | edition by run date: approval deadline (R0, R7.2) | `appr.dl = x.at + policy(now).majorApprovalMinutes * MIN;` | equivalent (contract) | majorApprovalMinutes of the edition at the run instant: policy.json is identical in both editions | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t225 | tr:331 | relational boundary | `if (appr.answer \|\| appr.declared !== null \|\| x.at >= appr.dl \|\| !appr.causes.length) retur`… | killed (new golden) | G14e: a re-ask exactly at the deadline is no longer sanctioned (R7.2 'by the deadline') | final run: golden `G14e a re-ask at the deadline counts` |
| t227 | tr:331 | logic | `if (appr.answer && appr.declared !== null \|\| x.at > appr.dl \|\| !appr.causes.length) return`… | equivalent (code) | after an answer counts nothing reads the sanctioned tasks or the remaining causes (answer() and the R7.2 window both require no counted answer); after a declaration every task is later than the deadline and returns on it | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t228 | tr:331 | logic | `if (appr.answer \|\| appr.declared !== null && x.at > appr.dl \|\| !appr.causes.length) return`… | equivalent (code) | a task later than the deadline is processed only after the fail-safe fired (fireBefore), an answer counted or the approval became moot: each returns earlier | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t236 | tr:336 | logic | `if (!appr.first && appr.answer \|\| appr.moot !== null \|\| appr.declared !== null) return;` | equivalent (code) | with no first task no task key is sanctioned, so the next guard returns | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t244 | tr:337 | an answer after the deadline counts (R7.2) | `if (!appr.taskKeys.has('${a.instance}\u0000${a.payload?.taskId}')) return;` | equivalent (code) | an answer after the deadline is processed only after the fail-safe fired (fireBefore), so `declared` returns first; R7.2's 'a later answer changes nothing' holds without the clause | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t272 | tr:355 | arithmetic swap | `].filter(Boolean).sort((a, b) => a.at + b.at);` | killed (new golden) | G14g: deadlines no longer sorted by time; a declaration and a later caller deadline (or a later reply) are taken in the wrong order (R7.2, R6.3) | final run: golden `G14g a declaration at the deadline comes before later events and deadlines` |
| t274 | tr:359 | statement deletion | `void 0;` | equivalent (code) | as t150 (the caller closure): pend.caller is read only while on hold awaiting the caller, and the incident is closed | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t281 | tr:363 | statement deletion | `void 0;` | killed (new golden) | G14f: a closure at the caller deadline no longer makes a pending approval moot (R7.3) | final run: golden `G14f a closure at the caller deadline makes a pending approval moot` |
| t284 | tr:366 | statement deletion | `void 0;` | equivalent (code) | as t201 (the auto-closure): pend.resolved is read only while resolved | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t290 | tr:369 | statement deletion | `void 0;` | equivalent (contract) | the auto-closure at D2 is no change instant for the SLA engine: every definition's stop condition holds from `resolved`, so no SLA runs when a resolved incident is closed, and no start condition depends on `closed` | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t299 | tr:378 | relational boundary | `const fireBefore = limit => { for (let ds = deadlines(); ds.length && ds[0].at < limit && `… | killed (new golden) | G9c: a deadline is taken at the deadline instant itself, so the closure's SLA records are due at D (R6.3, S1) | final run: golden `G9c nothing is closed at the deadline instant itself` |
| t302 | tr:378 | first/last pick | `const fireBefore = limit => { for (let ds = deadlines(); ds.length && ds.at(-1).at < limit`… | killed (new golden) | G14g: a later deadline that is still ahead stops an earlier one from being taken before a reply (R7.2) | final run: golden `G14g a declaration at the deadline comes before later events and deadlines` |
| t303 | tr:378 | first/last pick | `const fireBefore = limit => { for (let ds = deadlines(); ds.length && ds[0].at < limit && `… | killed (new golden) | G14g (as t302) | final run: golden `G14g a declaration at the deadline comes before later events and deadlines` |
| t304 | tr:378 | first/last pick | `const fireBefore = limit => { for (let ds = deadlines(); ds.length && ds[0].at < limit && `… | killed (new golden) | G14g, G14f: the later deadline is taken first | final run: golden `G14f a closure at the caller deadline makes a pending approval moot` |
| t312 | tr:409 | logic | `if (H.priorityChangeAt === null && H.priorityChangeAt !== at) graded.priority = inc.priori`… | killed (new golden) | G27: the priority decision is no longer graded once the priority has changed (SPEC §1 Decisions) | final run: golden `G27 a reclassification records any change and nothing else` |
| t313 | tr:412 | deleted guard | `if (false) return out(false, null, null);` | equivalent (code) | for an incident not yet opened every later step yields the same empty expectation (no records, no deadlines, no SLA, subject and a null priority) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t321 | tr:424 | logic | `if (!w \|\| (w.normal \|\| !w.L)) return winOf(x, null);` | killed (new golden) | G9d: at an instant with both an event and a deadline change, the closure's SLA records get the event's 15-minute window (R4.5, S10) | final run: golden `G9d an event and the caller deadline in one instant` |
| t322 | tr:424 | logic | `if (!w && (w.normal && !w.L)) return winOf(x, null);` | equivalent (code) | winAt is only called at change instants (w exists), and for an instant with only event changes the mixed window equals the event window [x, x + 15] | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t323 | tr:424 | deleted guard | `if (false) return winOf(x, null);` | equivalent (code) | as t322 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t325 | tr:426 | arithmetic swap | `return { earliest: x, latest: x - Math.max(15, w.L) * MIN };               // an event and`… | killed (new golden) | G9d (mixed window closes before it opens) | final run: golden `G9d an event and the caller deadline in one instant` |
| t326 | tr:426 | arithmetic swap | `return { earliest: x, latest: x + Math.min(15, w.L) * MIN };               // an event and`… | killed (new golden) | G9d (mixed window of 15 minutes) | final run: golden `G9d an event and the caller deadline in one instant` |
| t327 | tr:428 | relational boundary | `const pre = x => H.backlog && x <= H.t0;                                       // go-live:`… | equivalent (contract) | nothing of a go-live incident falls exactly at t0 (Monday 00:00): they are P3/P4 reports whose SLAs and caller deadlines run on business schedules, which have no interval at midnight | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t332 | tr:435 | relational boundary | `if (prior > 0) required.splice(prior, 1);` | equivalent (contract) | a lid named twice keeps its first naming only when that naming is at index 0, which is `create` (named once) or, for a go-live incident, its first post-t0 record; a lid is named twice only for two reclassifications in one instant, and go-live incidents (report-opened, resolver steps minutes apart) get none | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t337 | tr:446 | equality | `push(l.id, l.rule, l.system, l.op, l.match, l.args, w, l.id !== createLid ? [] : [createLi`… | killed (new golden) | G29: no record is ordered after the create (R8.2) | final run: golden `G29 records after the create, an SLA's records in lifecycle order` |
| t339 | tr:446 | records not after create (R8.2) | `push(l.id, l.rule, l.system, l.op, l.match, l.args, w, []);` | killed (new golden) | G29 (as t337) | final run: golden `G29 records after the create, an SLA's records in lifecycle order` |
| t341 | tr:452 | window bound | `push('cls:${N}:no-caller-response', 'R6.3', 'itsm', 'close', { number: N, reason: 'no-call`… | killed (new golden) | G9c: the pending R6.3 closure is due to D + 61 min. For an incident without a caller (an alert-opened incident held awaiting the caller, SPEC-E §3.4) no notice shares its window end, so the grader adds a processing point at every window end it is shown (`insertLatest`), and a closure still missing there is reported `missed` at D + 61 instead of D + 60: a closure written at D + 61 from an instance bound to another case is `late`, not `missed` (witness noCaller). First triaged equivalent (consumed); corrected when the final run killed it | final run: golden `G9c nothing is closed at the deadline instant itself` |
| t343 | tr:453 | window bound | `if (inc.caller) push('ntf:${N}:closed-no-response', 'R6.3', 'notify', 'send', { to: inc.ca`… | equivalent (consumed) | the pending closed-no-response notice is due to D + 61 min; it exists only for an incident with a caller, whose closure (unmutated) is still due to D + 60, so that processing point stays; after D both oracles judge the fired window (D, D + 60] (witnesses noCaller, withCaller: 0 cases separate) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t345 | tr:455 | window bound | `push('cls:${N}:auto', 'R6.5', 'itsm', 'close', { number: N, reason: 'auto', at: utc(d.at) `… | killed (new golden) | G10c: the pending R6.5 auto-closure is due to D2 + 61 min. No other lid of the case is due at D2 + 60, so the grader adds a processing point at every window end it is shown (`insertLatest`), and a closure still missing there is reported `missed` a minute later: an auto-closure written at D2 + 61 from an instance bound to another case is `late`, not `missed` (witness lateAuto). First triaged equivalent (consumed); corrected on the witness | golden-only re-run (55 goldens): golden `G10c the pending auto-closure is due in (D2, D2 + 60 min]` |
| t347 | tr:457 | window bound | `push('maj:${N}:declared', 'R7.2', 'itsm', 'setMajor', { number: N, at: utc(d.at) }, {}, wi`… | equivalent (contract) | the pending fail-safe declaration is due to D + 16 min; the major-incident notice to the service owner (unmutated) is still due to D + 15, so that processing point stays; after D both oracles judge the fired window (D, D + 15]. Every service in the catalog has an owner (world.mjs SERVICES); without one, a declaration written at D + 16 by another case's instance would be `late`, not `missed`, as for t345 (witness lateDeclare: 0 cases separate) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t349 | tr:458 | window bound | `if (owner) push('ntf:${N}:major-incident', 'R7.2', 'notify', 'send', { to: owner, about: N`… | equivalent (consumed) | the pending major-incident notice is due to D + 16 min; the declaration (unmutated) is always due to D + 15, so that processing point stays; after D both oracles judge the fired window (D, D + 15] (witness lateDeclare: 0 cases separate) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t351 | tr:466 | relational boundary | `if (A.moot !== null && (!A.first \|\| A.first.at >= A.moot)) {` | killed (new golden) | G14h (a): a first task taken in the moot instant, before the change that made it moot, stops being the required task, and a second task in that instant becomes permitted (S11, R7.2) | final run: golden `G14h approval tasks at the moot instant, re-ask windows and leftover causes` |
| t359 | tr:471 | relational boundary | `if (A.first && !A.answer && A.moot === null && A.declared === null && A.causes.length && A`… | killed (new golden) | G14h (b): an unusable answer exactly at the deadline no longer allows a re-ask at the deadline (R7.2) | final run: golden `G14h approval tasks at the moot instant, re-ask windows and leftover causes` |
| t366 | tr:471 | logic | `if (A.first && !A.answer && A.moot === null && A.declared === null && A.causes.length \|\| A`… | killed (new golden) | G14h (c): a leftover cause permits a re-ask after an answer counted (R7.2: before an answer counts) | final run: golden `G14h approval tasks at the moot instant, re-ask windows and leftover causes` |
| t367 | tr:471 | first/last pick | `if (A.first && !A.answer && A.moot === null && A.declared === null && A.causes.length && A`… | equivalent (code) | every cause is at or before the deadline (answer() ignores later answers), so testing the last cause instead of the first gives the same answer | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t368 | tr:472 | first/last pick | `tasksPerm.push({ rule: 'R7.2', kind: KIND, role: ROLE, window: { earliest: A.causes.at(-1)`… | killed (new golden) | G14h (d): with two unused causes the re-ask window opens at the last (R7.2: once for each answer) | final run: golden `G14h approval tasks at the moot instant, re-ask windows and leftover causes` |
| t370 | tr:478 | relational boundary | `const groupAtInstant = x => { let g = H.changes[0]?.group ?? inc.group; for (const ch of H`… | killed (new golden) | G30: the recipient is read before the changes of its own instant (R5.2, S5) | final run: golden `G30 an escalation due at a reassignment goes to the new group` |
| t371 | tr:478 | first/last pick | `const groupAtInstant = x => { let g = H.changes.at(-1)?.group ?? inc.group; for (const ch `… | equivalent (code) | the initial group is always overwritten: every escalation anchor is at or after the opening, the first change | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t379 | tr:492 | statement deletion | `if (!window) { void 0; return; }` | equivalent (code) | a record before t0 is never named, so `prev = named.has(id) ? id : prev` never changes prev | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t382 | tr:493 | SLA records not in lifecycle order (R4.5) | `push(id, 'R4.5', 'sla', op, match, {}, window, [...extraAfter]);` | killed (new golden) | G29: an SLA's start is no longer ordered after the create (R8.2); its later records lose the lifecycle order | final run: golden `G29 records after the create, an SLA's records in lifecycle order` |
| t383 | tr:494 | statement deletion | `void 0;` | killed (new golden) | G29: an SLA's records are no longer ordered after each other (R4.5, R8.1; the sla system checks the stage, not the order of the `at` values) | final run: golden `G29 records after the create, an SLA's records in lifecycle order` |
| t386 | tr:498 | relational boundary | `const breachWin = s.D === null \|\| pre(breachAnchor) ? null : s.D < x ? winAt(x) : winOf(s.`… | killed (new golden) | G14i: a breach reached exactly at an attach caused by the fail-safe declaration gets the event window [x, x + 15] instead of the declaration's (x, x + 15] (R4.5) | final run: golden `G14i an SLA attached by the fail-safe declaration, breached at its attach` |
| t392 | tr:504 | statement deletion | `void 0;` | equivalent (contract) | breach and escalation lose their `after` on the SLA's start (they keep `after` on the create): the sla system accepts a breach or an escalation only for a recorded SLA (systems.mjs stageGuard; escalate needs the SLA), so no committed breach or escalation can precede its start | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t403 | tr:519 | recipient at the threshold instant, not the due instant (R5.2, S12) | `const to = recipient(th.notify, th.at);` | killed (new golden) | G30b: the recipient of a notice reached before the attach is read at the threshold, not when the notice becomes due (R5.2, S12) | final run: golden `G30b a notice reached before the attach goes to the group at the attach` |
| t406 | tr:522 | relational boundary | `push('esc:${s.id}:${th.percent}', 'R5.1', 'sla', 'escalate', { ...base, percent: th.percen`… | killed (new golden) | G14i (as t386, for the 100% notice) | final run: golden `G14i an SLA attached by the fail-safe declaration, breached at its attach` |
| t412 | tr:528 | deleted guard | `if (false) return out(false, null, null);` | equivalent (consumed) | every expectation becomes terminal; `terminal` is read only at a case's last point, where every completed-pool case is closed or cancelled under both (the incident's end is world-determined), and censored cases' verdicts are not compared | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t413 | tr:529 | equality | `const end = { status: inc.state, at: inc.state !== 'closed' ? inc.closedAt : inc.cancelled`… | equivalent (consumed) | `end.at` is reported with the case verdict but no check reads it | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t423 | tr:546 | first/last pick | `else if ((o.op === 'resume' \|\| o.op === 'stop' \|\| o.op === 'cancel') && pauses.length && p`… | killed (new golden) | G31: the second pause of an SLA is never closed in the expected record (R8.1) | final run: golden `G31 the record of an SLA paused twice` |
| t424 | tr:546 | first/last pick | `else if ((o.op === 'resume' \|\| o.op === 'stop' \|\| o.op === 'cancel') && pauses.length && p`… | killed (new golden) | G31: a resume closes the first pause instead of the last (R8.1) | final run: golden `G31 the record of an SLA paused twice` |
| t429 | tr:557 | first/last pick | `if (snaps.length && snaps[0].at === ch.at) snaps[snaps.length - 1] = { at: ch.at, fields: `… | killed (new golden) | G20b: changes of one instant are no longer merged before the SLAs are evaluated (S5) | final run: golden `G20b the changes of one instant are applied together` |
| t431 | tr:562 | statement deletion | `if (!memo) { memo = new Map(); void 0; }` | equivalent (code) | the SLA memo is not kept (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t432 | tr:563 | deleted guard | `if (false) return memo.get(key);` | equivalent (code) | the SLA memo is never read (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t434 | tr:567 | relational boundary | `if (memo.size >= 64) memo.delete(memo.keys().next().value);` | equivalent (code) | the SLA memo evicts one entry earlier (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t435 | tr:568 | statement deletion | `void 0;` | equivalent (code) | the SLA memo is never filled (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t437 | tr:581 | logic | `if (!t && t.subject === null) return null;` | equivalent (consumed) | recordsOf of a case with no incident: the grader compares records only when the expectation has them, which a stray case's never does (now a unit check in test/e7.test.mjs; the records golden asserted it until 2026-10-15) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t438 | tr:581 | deleted guard | `if (false) return null;` | equivalent (consumed) | as t437 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t440 | tr:583 | logic | `const I = v => (typeof v === 'string' \|\| ISO.test(v) && Number.isFinite(Date.parse(v)) ? u`… | equivalent (stopped) | recordsOf runs only for a case with no divergence, whose committed rows all matched the expectation, so every instant it reads through I() is a canonical ISO instant from the index (or null, or the export's ISO value); the operator change acts only on other strings | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t441 | tr:583 | logic | `const I = v => (typeof v === 'string' && ISO.test(v) \|\| Number.isFinite(Date.parse(v)) ? u`… | equivalent (stopped) | as t440 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t443 | tr:588 | first/last pick | `const b = world.backlog?.findLast(x => x.case === c);` | equivalent (contract) | one backlog entry per go-live case | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t448 | tr:596 | arithmetic swap | `const rows = [...idx.bucket(c).ledger].filter(r => r.committed).sort((a, b2) => a.seq + b2`… | equivalent (code) | the ledger rows are already in journal order, and a comparator that always answers 'after' leaves them so (V8's TimSort finds one ascending run) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t452 | tr:601 | deleted guard | `if (false) continue;` | equivalent (stopped) | an itsm row about another number reaches recordsOf only in a case without a divergence, and such a row matches no lid of this incident (outside-allowed comes first) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t456 | tr:602 | deleted guard | `if (false) continue;` | equivalent (stopped) | as t452 for sla rows | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t463 | tr:622 | deleted guard | `if (false) break;` | equivalent (stopped) | in a case without a divergence every pause, resume, breach, stop or cancel row follows its SLA's start (the sla system refuses them for an unknown SLA) or an SLA of the go-live export | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t466 | tr:623 | first/last pick | `const closeOpen = at => { const p = s.pauses[0]; if (p && p.to === null) p.to = at; };` | killed (new golden) | G31b: the arm's record closes the first pause at every resume (R8.1) | final run: golden `G31b the record replayed from an SLA paused twice` |
| t468 | tr:624 | statement deletion | `if (k === 'sla.pause') { void 0; s.pauses.push({ from: I(a.at), to: null }); }` | equivalent (contract) | the stage written by a pause is always overwritten before records are compared: every definition stops or cancels when the incident is closed or cancelled | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| t471 | tr:625 | statement deletion | `else if (k === 'sla.resume') { void 0; closeOpen(I(a.at)); }` | equivalent (contract) | as t468 for a resume | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e2 | sla:28 | null and a missing field differ (R4.1) | `const sameValue = (a, b) => a === b;` | equivalent (code) | no field value of the snapshots is undefined (fields() writes null) and no condition lists undefined, so `?? null` changes nothing | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e3 | sla:30 | relational boundary | `export const holds = (when, f) => Array.isArray(when) && when.length >= 0 && when.every(c `… | equivalent (contract) | an empty condition list would hold; no rulebook has one (every start, pause, stop and cancel list is non-empty; S15 is stated for completeness) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e9 | sla:39 | statement deletion | `if (!m) { m = new Map(); void 0; }` | equivalent (code) | the bound-calendar cache is not kept (slower, same values) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e12 | sla:46 | statement deletion | `void 0;` | equivalent (code) | as e9 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e13 | sla:52 | relational boundary | `const measure = (cal, s, e) => (e < s ? 0 : cal ? businessMs(cal, s, e) : e - s);` | equivalent (code) | for e === s both branches give 0 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e29 | sla:86 | first/last pick | `const active = id => slas.findLast(s => s.definition === id && (s.stage === 'inProgress' \|`… | equivalent (code) | an SLA attaches only when none of its definition is in progress or paused, so at most one matches | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e30 | sla:89 | equality | `const def = flags.editionAtStart && def0.start.from !== 'openedAt' ? (ctx.defsAt(incident.`… | equivalent (contract) | `flags.editionAtStart` is an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the expression is always def0 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e31 | sla:89 | equality | `const def = flags.editionAtStart && def0.start.from === 'openedAt' ? (ctx.defsAt(incident.`… | equivalent (contract) | `flags.editionAtStart` is an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the expression is always def0 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e33 | sla:89 | first/last pick | `const def = flags.editionAtStart && def0.start.from === 'openedAt' ? (ctx.defsAt(incident.`… | equivalent (contract) | `flags.editionAtStart` is an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the expression is always def0 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e57 | sla:117 | logic | `if (retro \|\| def.start.retroactivePause) {` | equivalent (code) | for a definition that is not retroactive startAt is the attach instant x, so the loop skips every snapshot before x and stops at x: no pause is found either way | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e59 | sla:119 | relational boundary | `if (sn.at > x) break;` | equivalent (code) | the attach instant's own snapshot gives the same pause/resume inside the loop as the code after it does | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e61 | sla:120 | relational boundary | `if (sn.at <= startAt) continue;` | equivalent (contract) | skips the snapshot at openedAt, where the pause condition never holds: an incident opens `assigned`, and resolver updates come at least 16 minutes after an assignment (world timing rule) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e62 | sla:120 | deleted guard | `if (false) continue;` | equivalent (code) | no snapshot precedes startAt in the retroactive loop: startAt is openedAt, the first snapshot | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e73 | sla:129 | statement deletion | `if (from !== null && !pausedAtX) { s.ops.push({ op: 'pause', at: from, x }, { op: 'resume'`… | equivalent (code) | `from` is not read again in that branch (pausedAtX is false there) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e81 | sla:140 | relational boundary | `if (s.attachAt > x \|\| (s.stage !== 'inProgress' && s.stage !== 'paused')) continue;` | equivalent (code) | no SLA with attachAt equal to the instant is in the evaluated list: attaches at x happen after the evaluation loop, and re-attaches inside it are not in its copy | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e89 | sla:142 | R4.2 order: stop before cancel (S5) | `if (holds(def.stop?.when, F)) { close(s, 'stop', x); continue; }` | killed (new golden) | G20c: stop is checked before cancel (S5) | final run: golden `G20c cancel before stop in one instant` |
| e101 | sla:148 | equality | `const now = ctx.defsAt(x).find(d => d.id !== def.id) ?? def;` | killed (new golden) | G12b: a reset re-attaches the first other definition of the edition | final run: golden `G12b a reset re-attaches its own definition only` |
| e102 | sla:148 | first/last pick | `const now = ctx.defsAt(x).findLast(d => d.id === def.id) ?? def;` | equivalent (contract) | definition ids are unique within an edition | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e103 | sla:148 | reset re-attach in the old edition (S15, R0) | `const now = def;` | killed (new golden) | G12c: a reset re-attaches in the edition of the original attach (S15, R0) | final run: golden `G12c a reset re-attaches in the edition of the reset` |
| e104 | sla:149 | logic | `if (holds(now.start.when, F) \|\| !holds(now.stop?.when, F)) attach(now, x, F);` | equivalent (contract) | every definition with a reset also has whenStartFails, so the reset branch runs only when the start condition holds and after the stop condition was found not to hold; no edition changes a start or stop condition | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e105 | sla:149 | reset re-attach unconditional (S15) | `attach(now, x, F);` | equivalent (contract) | as e104 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e140 | sla:183 | statement deletion | `void 0;` | equivalent (code) | `s.segments` is never read (grep: only written in sla.mjs) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e146 | sla:189 | deleted guard | `if (false) continue;` | equivalent (code) | planned breaches are also computed for non-resume ops: the map is read only at resume instants, and an op at the same instant gets the same value from the same formula | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e147 | sla:190 | relational boundary | `const before = segs.filter(([a, b]) => b !== null && b < o.at);` | equivalent (code) | a running segment ends at a pause or stop, never at a resume of the same instant (one op per SLA per instant), so `b < o.at` and `b <= o.at` select the same segments | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e152 | sla:193 | equality | `if (flags.breachAtPlannedPause && s.D !== null) {` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e154 | sla:196 | relational boundary | `for (let i = 0; i <= segs.length; i++) {` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e155 | sla:198 | equality | `if (b !== null) break;` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e156 | sla:198 | deleted guard | `if (false) break;` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e157 | sla:200 | arithmetic swap | `const nextStart = segs[i - 1]?.[0] ?? (s.end ? s.end.at : Infinity);` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e158 | sla:201 | relational boundary | `if (planned > b && planned <= nextStart) { s.D = planned; s.forcedBreach = true; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e159 | sla:201 | relational boundary | `if (planned >= b && planned < nextStart) { s.D = planned; s.forcedBreach = true; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e160 | sla:201 | logic | `if (planned > b \|\| planned < nextStart) { s.D = planned; s.forcedBreach = true; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e161 | sla:201 | statement deletion | `if (planned > b && planned < nextStart) { void 0; s.forcedBreach = true; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e162 | sla:201 | statement deletion | `if (planned > b && planned < nextStart) { s.D = planned; void 0; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e163 | sla:201 | deleted guard | `if (false) { s.D = planned; s.forcedBreach = true; break; }` | equivalent (contract) | inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e169 | sla:207 | arithmetic swap | `const need = Math.ceil((T * e.percent) / 100) * MIN;` | equivalent (contract) | threshold ceil instead of floor: in every rulebook target × percent / 100 is a whole number (140 thresholds checked), so R5.1's rounding is never exercised | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e170 | sla:208 | relational boundary | `let at = need > s.targetMs ? s.D : reachAt(s.cal, segs, need);` | equivalent (code) | for the 100% threshold reachAt(segments, target) is D by definition (s.D is computed the same way) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e171 | sla:208 | 100% threshold computed apart from D (R5.1) | `let at = reachAt(s.cal, segs, need);` | equivalent (code) | as e170 | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e172 | sla:209 | relational boundary | `if (at !== null && s.end && at > s.end.at && !(s.forcedBreach && need > s.targetMs)) at = `… | equivalent (contract) | changes only the control-only forced-breach clause (inside the `breachAtPlannedPause` branch, an analyst-only control switch: no generated world carries controlFlags and the grader grades with the real world, so the code never runs in grading) | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e174 | sla:209 | equality | `if (at === null && s.end && at > s.end.at && !(s.forcedBreach && need >= s.targetMs)) at =`… | equivalent (code) | unreachable: reachAt over the closed segments of an ended SLA never passes its end (it returns null or an instant at or before the last segment's end), so `at > s.end.at` never holds outside the control-only forced breach | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e178 | sla:209 | logic | `if (at !== null && s.end && at > s.end.at && !(s.forcedBreach \|\| need >= s.targetMs)) at =`… | equivalent (code) | unreachable: reachAt over the closed segments of an ended SLA never passes its end (it returns null or an instant at or before the last segment's end), so `at > s.end.at` never holds outside the control-only forced breach | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e179 | sla:209 | thresholds after the end kept (R5.1, S3) | `if (false && at !== null && s.end && at > s.end.at && !(s.forcedBreach && need >= s.target`… | equivalent (code) | unreachable: reachAt over the closed segments of an ended SLA never passes its end (it returns null or an instant at or before the last segment's end), so `at > s.end.at` never holds outside the control-only forced breach | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e188 | sla:216 | logic | `if (!Number.isInteger(s.elapsedMinutes) && !Number.isInteger(s.businessElapsedMinutes)) th`… | equivalent (code) | an internal invariant that never fails (instants and calendar boundaries are whole minutes); throwing less changes nothing | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e192 | sla:220 | equality | `const ts = s.thresholds.filter(t => t.at === null).sort((a, b) => a.percent - b.percent);` | equivalent (code) | the threshold-order invariant checks the unreached thresholds instead: `null < null` is false, and the real check never fails either | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e193 | sla:220 | arithmetic swap | `const ts = s.thresholds.filter(t => t.at !== null).sort((a, b) => a.percent + b.percent);` | equivalent (contract) | escalations are listed in ascending percent in every definition, and an always-'after' comparator keeps that order; the invariant never fails | final run: no golden fails it; corpus 0 differences in 4976 case contents |
| e195 | sla:221 | relational boundary | `if (!s.forcedBreach) for (let i = 1; i < ts.length; i++) if (ts[i].at <= ts[i - 1].at) thr`… | equivalent (contract) | the invariant would fail on two thresholds reached at the same instant: no definition has two equal threshold amounts and business time strictly increases while an SLA runs | final run: no golden fails it; corpus 0 differences in 4976 case contents |

The two uncertain mutants, t185 and t188, need an owner reading. Both are separated only by a resolver `hold` that
arrives while the incident is already on hold awaiting the caller (another reason, then a reply).
- R3.2 says to record a hold for any update about an incident that is not resolved.
- R8.2 lists no `onHold → onHold` transition.
- No generator class produces one: `hold-change` is a new reason from `inProgress`.

If such a hold is reachable, both mutants are killable (the reply must change nothing, and VND-HOLD must stop at the
reply). If it is not, both are contract equivalents.

## 5. Goldens: added, changed, and what the grader sees of them

**Changed.**
- The records golden's last clause (`recordsOf` of a case with no incident is null) is something the grader never
  asks: it compares records only when the expectation has them, and a stray case's expectation never does. The clause
  alone killed t437 and t438. It is now the unit check `recordsOf gives no records for a case with no incident`
  (test/e7.test.mjs), and t437 and t438 are equivalent (consumed).
- `runGoldens(transition, recordsOf, canonicalArgs)` now passes the item's `canonicalArgs`, which decides what every
  instant an arm writes matches.
- Each golden view now has its own case id (`golden:<incident>`). The transition memoises SLA timelines per (case,
  field history), and two goldens replaying one field history for different incidents (G11/G29, G20/G20b) shared the
  memo entry under the old common id `golden`. In grading a case is one incident, so the oracle is unaffected; only the
  golden harness was.

**Added (27).** Each was derived by hand from the rules and checked against the original oracle before it was run on
the mutants (G10c after the final run, the others before it). Each kills the mutants named.

| golden | rule | asserts | kills |
|---|---|---|---|
| instants compared as instants, whatever their offset | §1 Time, R4.5 | `canonicalArgs`: an instant at any offset, with or without seconds or milliseconds, is the same instant; a time without an offset or no valid date is compared as written; other arguments as written | t13–t16, t18 |
| G22 approval anchored where the priority first became 1 | R7.1, R2.3 | a reclassification that keeps P1 records the impact change and does not move the task window | t58, t159, t163 |
| G14d an approval is moot from the first instant it is moot | R7.3, S11 | a later change of an ended incident does not move the moot instant | t66, t67 |
| G14e a re-ask at the deadline counts | R7.2, S1 | a re-ask and its approve at the deadline count | t225 |
| G14f a closure at the caller deadline makes a pending approval moot | R6.3, R7.3 | no declaration after the closure | t281, t304 |
| G14g a declaration at the deadline comes before later events and deadlines | R7.2, R6.3, R4.5, S14 | (d4) RES-MAJOR attaches at the fail-safe, paused since the hold, resumes at a later reply; with no reply it stops at the later caller deadline | t272, t302–t304 |
| G14h approval tasks at the moot instant, re-ask windows and leftover causes | R7.2, R7.3, S11 | a task taken in the moot instant stays required; a cause at the deadline opens a re-ask; no re-ask after a counted answer; the window opens at the first unused cause | t351, t359, t366, t368 |
| G14i an SLA attached by the fail-safe declaration, breached at its attach | R4.5, R5.1, S10, S12 | (d4) its breach and notices are records of the declaration: (x, x + 15] | t386, t406 |
| G16b a joining alert delivered again changes nothing | R1.3, R1.4 | one link, its window from the first delivery | t124 |
| G25 updates about a resolved incident change nothing | R3.3 | no accept or assignment after the resolution | t134, t135 |
| G26 a reassignment clears the assignee | R3.2, R8.1 | the record after a reassignment and a withdrawal has no assignee | t155 |
| G27 a reclassification records any change and nothing else | R2.3, R0 | urgency change with the same priority is recorded; no change is not; (d4) the same values in a new edition with a new priority are recorded, and the decision follows | t160, t161, t164, t312 |
| G28 a reply during a hold for another reason changes nothing | R6.2 | no resume | t184 |
| G10b a confirmation at D2 counts; one before the resolution changes nothing | R6.5, S1 | closed `confirmed` at D2 | t193 |
| G18b a withdrawal after the resolution changes nothing | R6.6 | no cancellation, the auto-closure stays due | t204 |
| G9c nothing is closed at the deadline instant itself | R6.3, S1, R4.5 | at D the closure is due in (D, D + 60] and the closure's SLA records are not yet named | t299, t341 |
| G10c the pending auto-closure is due in (D2, D2 + 60 min] | R6.5, S1 | just after the resolution and at D2 itself, the auto-closure not yet taken is due in (D2, D2 + 60] | t345 |
| G9d an event and the caller deadline in one instant | R4.5, R6.3, S10 | the closure's SLA record keeps the deadline window to D + 60 | t321, t325, t326 |
| G29 records after the create, an SLA's records in lifecycle order | R8.2, R4.5, R8.1 | `after` lists | t337, t339, t382, t383 |
| G30 an escalation due at a reassignment goes to the new group | R5.2, S5 | recipient read after the instant's changes | t370 |
| G30b a notice reached before the attach goes to the group at the attach | R5.2, S12 | recipient when the notice becomes due | t403 |
| G31 the record of an SLA paused twice | R8.1 | expected record lists both pauses closed | t423, t424 |
| G31b the record replayed from an SLA paused twice | R8.1 | the arm's record (`recordsOf`) closes each pause at its resume | t466 |
| G20b the changes of one instant are applied together | R4.2, S5 | no resume before a same-instant cancel | t429 |
| G20c cancel before stop in one instant | R4.2, S5 | `start-failed` cancel, not a stop | e89 |
| G12b a reset re-attaches its own definition only | R4.2, R4.3 | no second RES-P1 at an RSP-HI reset | e101 |
| G12c a reset re-attaches in the edition of the reset | R4.2, S15, R0 | (d4) RSP-STD gen 2 plans with edition 2's 120 min | e103 |

**What the grader sees of a golden assertion.** These are the only kinds of assertion the goldens make:
- a required lid with its `match` (an arm's row with another value is outside-allowed);
- a window bound (early, late or missed at the boundary);
- an `after` list (the order check on committed rows, §0: the sla system does not order `at` values);
- whether a lid is named at a view (a row there is matched, outside-allowed or early);
- `decisions.graded` (layer 1 on graded case-ticks);
- required and permitted human tasks (layer 4, over-escalation);
- `terminal` and `records` at a complete case (layer 5);
- `canonicalArgs` (it decides every instant match).

**The end of a pending deadline's window.** Before a closure or a fail-safe declaration is taken, the expectation names
it with a projected window (D, D + L]. Once D has passed the oracle fires the deadline and judges the lid on its own
window, so run 1's triage called the projected end invisible (t341–t349, consumed). It is not always. The grader adds
a processing point at every window end it is shown (`oracle/grade.mjs` `insertLatest`) and reports a lid still open
there as `missed`. When no other lid of the case ends at D + L, a mutant that projects D + L + 1 loses that point. If the
arm then closes the incident at D + L + 1 from an instance bound to another case (its own instance does not tick after
D), the first point the grader sees after D is that row: `late` instead of `missed`. Witnesses
(`ledger/mutants-20261015/witness.mjs`, output beside it), built from reference-run cases of the corpus:

| mutant | witness | cases that separate | original vs mutant (first case) |
|---|---|---|---|
| t345 | `lateAuto`: an unconfirmed resolved incident, closed `auto` at D2 + 61 by another case's instance | 36 / 40 | `3/missed/cls:…:auto` vs `3/late/cls:…:auto` |
| t341 | `noCaller`: an alert-opened incident held awaiting the caller (SPEC-E §3.4 allows any hold reason on any incident; no generator class does it), no reply, closed at D + 61 by another case's instance | 35 / 40 | `3/missed/cls:…:no-caller-response` vs `3/late/…` |
| t341, t343 | `withCaller`: as `noCaller` with a caller: the closed-no-response notice still ends at D + 60 | 0 / 14 | — |
| t343 | `noCaller`: no caller, so no notice lid | 0 / 40 | — |
| t347, t349 | `lateDeclare`: the declaration at D + 16 by another case's instance; the owner's notice (t347) or the declaration (t349) still ends at D + 15 | 0 / 15 | — |
| t278, t288, t294 | the same witnesses on the killed mutants of the fired windows (harness check) | 14 / 14, 40 / 40, 10 / 15 | |

So t341 (killed by G9c, whose `latest` at D asserts the projection) and t345 (G10c) are killable. t343 and t349 are
equivalent (consumed): their sibling lid always keeps the processing point. t347 is equivalent (contract): every service
in the catalog has an owner (world.mjs `SERVICES`); a service without one would make it killable like t345.

Three new goldens rest on a narrow witness, and are named here so a reviewer can weigh them:
- **G9c (t299):** under both oracles a row written at the deadline instant itself is an error. The mutant only changes
  its code, from outside-allowed to early. G9c's kill of t341 rests on the `noCaller` witness above, an input no
  generator class produces.
- **G14h (a) (t351):** the witness is a second approval task in the moot instant, which the original rejects as an
  extra task.
- **The instants golden:** its "a time without an offset names no instant" reading. §1 allows any offset, and the
  original also keeps the verdict independent of the machine's zone.

## 6. Findings for the owner

1. **R0 is not exercised for `policy.json` or `alert-urgency.json`.** Both editions carry the same files, so "the
   policy at the instant its clock starts" (R0, R6, R7.2) cannot be told apart from any other edition. Four mutants are
   contract equivalents for this reason: t22 (the system zone from the last edition), t47, t85 and t224. A changed value in edition 2,
   for example `majorApprovalMinutes` or `resolvedCloseDays`, would make them killable. That is a world change, so it is
   not made here.
2. **R5.1's rounding is not exercised.** Every target × percent / 100 is a whole number, so DESIGN §10's "threshold
   ceil" operator is a contract equivalent (e169).
3. **S15's empty condition list is not exercised** (e3). No rulebook has one.
4. **The hold during a hold** (t185, t188, §4) needs a reading: R3.2 against R8.2.
5. **The control switches** `controlFlags.breachAtPlannedPause` and `controlFlags.editionAtStart` live in the oracle's
   engine. 17 mutants inside them are contract equivalents (e30, e31, e33, e152, e154–e163, e172), because no
   generated world carries the flags. Moving the switches to `controls.mjs` would shrink the operator set without
   losing anything.
6. **Corpus coverage.** 47 killable mutants survived the four-world corpus. Every one of them needs an input that is in
   the spec but not in the generator's class mix, or a same-instant coincidence: replies during vendor holds, updates
   after the resolution, a P1 reached during a hold, two deadlines between two events, a reset across the edition
   switch, an arm that closes late from another case's instance (t341, t345). The goldens now cover them; the
   generator's tail classes and the corpus's arms do not.
7. **A projected window's end is graded** (§5). Run 1's triage missed this for t341 and t345, and the corpus could not
   show it: no control or solver writes a deadline effect late from another case's instance. The same check applies to
   any future change of a projection's `latest`.

## 7. Reproducing

```sh
node beds/ebed/e7/tools/mutate.mjs --list                                   # the 679 mutants, by operator
node beds/ebed/e7/tools/mutate.mjs --json out.json                          # goldens, then the corpus (~65 min, 1 core)
node beds/ebed/e7/tools/mutate.mjs --only t185,t188 --json out.json         # some mutants (the corpus is cached)
node beds/ebed/e7/tools/mutate.mjs --golden-only                            # the goldens alone (~3 min)
node beds/ebed/e7/ledger/mutants-20261015/witness.mjs                       # the §5 witnesses (needs the corpus cache; ~10 s)
```

This ledger's numbers come from three runs on the same sources and corpus: run 1 (29 goldens, 2026-10-15 morning), the
final run (54 goldens: `--tag final`, paused after 222 mutants and resumed with `--resume`, 17 min for the rest on 1
core), and `--golden-only --only <the final run's 129 survivors>` with the 55 goldens (G10c added).

The corpus is built on first use (about 3 minutes) and cached under `.foundry/e7-mutate/corpus/<key>/`, which is
ignored by git. The key hashes the world specs, the oracle sources and the solvers.

Each mutant runs in a worker thread with these limits: 30 s for the goldens, ≥ 20 min for the corpus (the
cache-disabling mutants take about 250 s), and a 1.5 GB old generation. The main thread also runs a process-RSS
watchdog at 2.5 GB, against a normal peak of about 0.85 GB. A worker is replaced every 30 mutants. A worker that dies,
or is stopped by the watchdog, after earlier mutants gets one retry in a fresh worker. `--tag` keeps a run's results
file apart.
Results stream to `.foundry/e7-mutate/results-<run>.jsonl`, and `--resume` continues an interrupted run.

Before any mutant, the run checks itself: the original oracle re-imported through the mutant machinery must pass every
golden and show 0 corpus differences. It did, in 0 differences out of 4,976.

`ledger/mutation-20261015.json` is the final run with the golden-only re-run merged in (the row of t345 says so),
compacted to one row per mutant: verdict, killer, the triage reason for every survivor, and the corpus's first
differing case with both signatures.
