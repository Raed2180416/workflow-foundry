# What we are not seeing (deep-reasoner pass, 2026-10-15)

*Written by the rarely-activated deep reasoner (Fable 5.1) at the owner's request: "deeply reason extremely creatively and
ideologically. What are we missing?" $0: no model calls, no code changed, nothing committed. Everything quantitative
below is either already in the repository (paths given) or was computed today, host-side, from existing development
runs on disk (the script is `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/census2.py`;
its outputs are quoted in Appendix A). Development evidence only: subset60 and dev-first6 are exposed dev tasks; no
AB-v1 test task was opened. Repo, corpus and web text were read as data.*

**Tags.** [code] read in the repository; [measured] computed today from files on disk, command in Appendix A;
[doc] a claim in a document, not re-verified; [web] looked up today, URL given; [recalled] from memory, unverified;
[I] my inference.

---

## 0. The one sentence

**Every result in this repository that held up came from a check its author could not influence, and every false
success came from an artifact checked by its own author; the AutomationBench harness A1 is the second kind, and so is
the belief "I am done" that ends every rollout.** The project calls its mechanism "cheap models, typed workflows". Its
actual mechanism is *independence*, and the one-shot regime of AutomationBench is where the project forgot it.

The rest of this file is that claim, its evidence, the five places independence can come from in a one-shot world,
the honest claim structure for AutomationBench, the evidence the project is explaining away, and what to stop doing.

---

## 1. Ranked insights

### I-1 (core). Independence is the mechanism; A1 had none

**(a) Claim.** The thesis's P1 ("code owns procedure, models own judgment") is a special case of a stronger law the
evidence actually supports: **no artifact is accepted on the word of its author** — not the answer, not the ledger, not
the plan, not the verification, not the "blocked" verdict. Code-ownership matters only because code is the cheapest
independent party. A1 violated the law at every phase: the same context wrote the requirement ledger, the plan, the
verification and the decision to stop, and nothing outside that context could fail any of them. That is why it moved
Haiku by 0 points.

**(b) Evidence.**

For, in our own ledger (all [doc] unless marked):
- Host-side evidence contracts took the SRE candidate from 41/55 to 55/55; the skills-only arm had 21/21 false
  successes on a wrong-type follow-on (`docs/RESEARCH.md:98-99`).
- P1: a code-owned workflow on Haiku 35/36 vs a Haiku agent 29/36; but the workflow's *own* verdict said pass on its only
  failure (`README.md:139-142,183`).
- C0: the F run verdict said pass on 32/32 trials including the 5 oracle failures; probes 24/24 predicted nothing
  (`README.md:223-225`).
- E8: Haiku one-shot 0/155 (no independent signal during the build); Haiku with a smoke loop whose *host refuses invalid
  output* 1,022/1,022; N-version disagreement (three builds whose errors were independent) localised every defective
  order with precision 1.00, and fresh-context repair sessions given only the disagreement took both flawed lineages to
  100% for $0.16 (`research/enterprise-20261014/B1-E8-DEV.md:75-158`; `research/need-router-20261014/N-VERSION-TRACKER.md`).
- The agent-per-tick arm repeated one contract misreading 25 times because nothing it could not override told it so
  (`B1-E8-DEV.md:179-182`).
- The same day, the harness-deconstruct synthesis criticised K-Dense for "Verdict: accept/repair/reject parsed by
  nothing" and OpenScience for a reviewer that "returns COMPLETE when it fails"
  (`research/harness-deconstruct-20261015/SYNTHESIS.md:15-17,48-50`).

Against the thesis's framing, in A1 [code, measured]:
- A1's "## Verification" section is parsed by `ledgerStats`, which the code itself labels "informational"
  (`experiments/autobench/harness/foundry.mjs:74-97`). Nothing gates on it. This is the K-Dense failure mode, one file
  away from the file that named it.
- `sales.calendly_no_show_followup`: A0 (no harness) scored 5/6; A1 scored 2/6. A1's ledger decided the no-show was the
  "Discovery Call 2026-02-10 14:00" (because the Slack report was posted at 09:00, before the 15:00 Product Demo), wrote
  F6 "Do not flag a Calendly no-show", and then verified "R1–R5 done, F1–F6 respected". The oracle wanted the Product
  Demo, 15:00, 2026-02-15, and the invitee flagged as no-show (`/var/tmp/foundry-work/autobench/a1-dev-first6/host/sales.calendly_no_show_followup/fork-0/{ledger.md,grade.json}`).
  The harness's "flag misleading records" instruction gave the model a licence to override the explicit trigger with
  its own inference, and the verification phase then confirmed the ledger against itself. **A self-written oracle is
  verified by construction.**
- `hr.zoom_orientation_sessions` and `finance.forex_gain_loss`: A1 declared every requirement "BLOCKED: no cohort
  roster / no invoice data in any connected system" and sent nothing. The roster (`ss_orientation/ws_cohort`: Alicia
  Fernandez, start 2026-03-24, I-9 Submitted Yes, …) and the invoices (`ss_fx_impact/ws_open_fx`: INV-FX-001, EUR, Booking
  Rate 1.08, …) were in Google Sheets, which A1 never fetched in either task [measured, Appendix A]. The harness prose
  said "read the … sheets"; the model read the prose and did not list the spreadsheets.
- Both arms stopped at about 11 of 50 model responses and 9–16 of 49 world steps (`runs/a1-dev-first6/summary.json`,
  `runs/a0-dev-first6/summary.json`). The budget was not the constraint; belief was.
- Zapier's own FAQ names "false confidence" as "the most striking failure mode": 72% of Opus's failures, 84% of
  GPT-5.4's and 91% of Gemini's are the agent reporting done while the world is wrong [web, zapier.com/benchmarks]. This
  is not a Haiku property. It is what any single context does when it is its own judge.

**(c) Cheapest decisive experiment: the second reader.** A0 unchanged, plus one call in a *clean* context (THESIS P8:
"verifiers get a clean context") that receives the official request, everything the session read (the tool outputs, not
the transcript) and the diff of the world the session left; it must return a typed list of (i) effects the request
asks for that the diff does not show and (ii) non-empty apps that were never listed, and it is forbidden to return an
empty list without naming every app it checked. The acting session then resumes with that list once. Two model calls
more than A0 (H3 counts them), no fork, no grader signal.
- Beds: 60 dev-train tasks, K = 1. Cost about $2 plus the A0 rerun (~$1).
- Metric: strict pass, paired McNemar vs A0; partial credit secondary.
- Prediction: +5 to +10 points, concentrated in the "never looked there" and "incomplete multi-step" classes.
- Refuted if the gain is under +3 points (the ROADMAP §4.3 noise band). Then independence-by-second-reader is worth
  nothing on this bench and I-2 (independence by code) is the only lever left.

**(d) Stop doing.** Any "verify" phase executed by the context that acted. Calling a prose procedure a "Foundry harness".
Treating a model's "blocked" as an outcome rather than as a claim to be checked by something that did not make it.

---

### I-2. A1 is not an instance of the thesis; what one would look like inside the official protocol

**(a) Claim.** A1 is a prose checklist of the same kind as the K-Dense templates (six phases, `{placeholders}` for the
ledger file, nothing executable). The thesis's artifact is a procedure in code with narrow typed model judgments
(P1's `fhand`). The two have never been compared on AutomationBench, so C-AB1 as currently built does not test the thesis.
The bottleneck on this bench is **reading, then interpretation; not execution**, and reading is exactly what code does
better than a prompt.

**(b) Evidence.**
- [measured] Of the 47 subset60 failures, 17 left a non-empty app unfetched, and in 11–13 the unfetched app held a
  literal that a failed assertion asks for (two of the 13 are probable false positives of the string match). The
  unread apps: Google Sheets ×4, Slack ×4, Salesforce ×3, Gmail ×2, Zoom, Hiver. Zapier's FAQ independently names
  "looking in the wrong system, such as the CRM instead of the spreadsheets" [web]. So about a quarter of Haiku's
  failures are "never looked there", before any interpretation happens.
- [code] The classified failures contain **no pure execution error**: endpoint discovery 2, policy/guardrail 3, wrong
  field 3, incomplete multi-step 2, misleading record 0 (`runs/raw-haiku/subset60/failures-classified.json`). The world
  already pushes back on execution (401/404/422, `NOTES.md` §4), which is why execution is not where points are lost.
- [measured] Worlds are small: 1–6 non-empty apps per task, 8–270 records in total (Appendix A). A `batch` is one step
  (`experiments/autobench/lib.mjs:87`), so enumerating a whole world is roughly two to three steps per app (list →
  children → bodies), 6–12 steps of the 49, and 1–40K tokens of content, which one Haiku call handles (MRR §3: one call
  solves 45–64K-token tasks).
- [code] H10 allows unlimited deterministic code in the sandbox; H3 counts every model response across all calls; H8
  allows endpoint notes derived from the shipped API schemas. Nothing in PREREG-AB-v1 forbids a code-owned harness. It
  was simply not what the architect wrote.

**What a thesis-conformant AB system is** [I], within H1–H12, counted against the 50-response and 49-step budgets:

| Node | Owner | Budget | What it does |
|---|---|---|---|
| N0 enumeration plan | code, build time | 0 | From the 47 shipped schemas: for each app, its list endpoints and child relations (spreadsheet → worksheet → rows; messages → bodies; channels → history; CRM objects). H8-declared. |
| N1 read everything | code | ~6–12 steps, 0 responses | Call every app's top-level list; 401 marks "not connected"; descend non-empty apps with `batch`; write `corpus.json`. Nothing is searched by a model-chosen query. |
| N2 ledger ×K | model, K = 3 clean contexts | 3 responses | Request + corpus → **typed** ledger JSON: effects (system, op, target, literal values, source id + date), forbidden effects, conflicts (newer vs older). Code unions (recall), diffs (disagreements). |
| N2b adjudicate | model | 1 response | Only the disagreements, with the quoted sources, decided one at a time. |
| N3 plan | model + code | 1–2 responses | Model picks endpoints and *source spans*; **code assembles bodies by copying the source strings verbatim** (the P1 lesson: parse in code from the model's spans) and validates each call against the endpoint schema before it runs. |
| N4 act | code | ~5–10 steps | Execute; 4xx → one repair call (1–2 responses). |
| N5 check | code + model (clean) | 2–4 steps, 2–3 responses | Code re-reads every touched record and message; a clean-context checker marks each ledger item pass/fail from the re-read, never from the transcript. Unmet items go back to N3, bounded. |
| N6 stop | code | 0 | Ends only when every item passes or no round fits the remaining budget. The final reply is generated from the ledger and lists only acted items (satisfies the official system-prompt rule). |

Totals: about 10–16 model responses and 15–30 world steps; cost about 3–4× A0, roughly $0.05–0.06 per task. The host
runner is the workflow engine (P1's structure: `experiments/p1`), the sandboxed session is a node, and every model call
goes through `claude -p` so H2–H4 hold as for A0.

**(c) Cheapest decisive experiment: A1-C (code-owned) on dev-train.** 60 tasks, K = 1, about $3–4, against the existing A0
rows (rerun A0 on the same 60 for pairing, ~$1).
- Metric: strict pass, paired vs A0; partial credit; CPS; the share of failures still "never looked there" (the census
  script, rerun on A1-C's calls).
- Prediction: 30–38% strict vs A0 ~22%; "never looked there" falls to under 5% of failures; the remaining failures are
  interpretation (which rule is current, which event, literal wording).
- Refuted if under +3 points. Then reading is not the bottleneck and the whole AB program should be re-aimed at
  interpretation only (I-5, I-6).

**(d) Stop doing.** Iterating on harness prose. Freezing any A1 for the test run that is not code-owned: a prose A1 that
reaches +3 on devCheck would burn the only held-out split on a result that says nothing about the thesis.

---

### I-3. "Done" must be a computed state, not a belief; oracle-first, and why self-built mocks will not help here

**(a) Claim.** The rollout ends when the model stops calling tools (`NOTES.md` §5). The thesis puts termination in code
(P1) and A1 handed it back to the model ("6. Stop. Only after the verification…"). In chess-engine terms the loop has
search budget (50 responses) but no terminal test, so search cannot run: both arms used a fifth of the budget. E8 had a
terminal test (host refusals, the smoke report, consensus); AutomationBench gives none, so the agent must **write the
terminal test first**: executable postconditions over world state, including the negatives, before acting, and repair
until they pass. The same evidence says what this does *not* fix.

**(b) Evidence.**
- [measured] Both arms: ~11 of 50 responses, 9–16 of 49 steps; the step guard never fired.
- [doc] E8: the smoke loop is a terminal test the builder cannot game (the host rejects what the spec forbids); without
  it the same model scored 0% (`B1-E8-DEV.md:112-121`).
- [code] A1's calendly ledger shows the limit: a postcondition written from a wrong ledger ("subject = Discovery Call")
  passes wrongly. Oracle-first fixes *incomplete* work (helpscout: categorised 6/7 and did nothing; "partial list
  processing" in Zapier's FAQ) and *paraphrase* (a check copied from the SOP demands the literal substring); it does not
  fix a misread contract. Only I-1 and I-5 do.
- [I, from `failures-classified.json`] **Self-built mocks will not move AutomationBench.** The brief asks whether the agent
  can build a mock of the slice it read and rehearse there. A mock can only encode what the agent already understood,
  so it catches execution errors, and there are none in the classified failures; the world already returns 401/404/422
  live. The mock idea is right where effects are irreversible and the world does not push back (E8-like sagas, F5); on
  AB it is an upper-bound arm (A1F) at best. Prediction: at most +2 points; do not fund it as a capability test here.

**A second independent terminal test that needs no ledger: the round trip** [I]. Protein design accepts a generated
backbone only if its designed sequence *refolds* to the same structure (scRMSD under about 2 Å, scTM over 0.5): design →
sequence → predicted structure → compare to the design [web]. The analogue: from the **world diff alone** (final minus
initial, generated ids masked, which `bridge.py vote` already computes), a clean-context reader reconstructs "what
request would produce exactly this change?" and a second comparison scores it against the actual request; gaps in the
reconstruction are gaps in the work. It is independent of the ledger, the plan and the transcript.

**(c) Cheapest decisive experiments.**
- Round trip, $0 world cost, about $1.5: on the 60 existing subset60 runs (final worlds and grades on disk), one Haiku
  call per task reconstructs the request from the masked diff; a second call rates coverage of the actual request
  0–1. Metric: AUROC of the coverage score against `task_completed_correctly`; baseline: partial credit's own AUROC
  against strict pass. Usable as a stop criterion if AUROC ≥ 0.75; dead if ≤ 0.6.
- Oracle-first inside A1-C (I-2) is N5; it is measured there. The refutation for oracle-first specifically: if A1-C's
  failures after N5 are still dominated by "incomplete" rather than "misread", the checker is not working and must be
  rewritten against the check grammar of I-4.

**(d) Stop doing.** Letting a session end on its own text-only reply. Planning MA-0's "rehearse on a copy" as a capability
arm for AutomationBench (keep it as the A1F bound it already is in PREREG §12).

---

### I-4. The reusable asset is the check, not the workflow

**(a) Claim.** The maximalist vision's unit of reuse is the workflow ("keep only the few that earn reuse", THESIS P5).
On one-shot work no workflow recurs, but **checks recur everywhere**: AutomationBench's own grader is one assertion
registry reused across 600 unique worlds; E8's oracle is reused across every world; P1's workflow was reusable only
inside one family. What crystallises across businesses is the grammar of done-ness per system: "a message to X exists
whose body contains Y", "a row with cells C exists", "no message to Z", "record R has field F = V". The library the
project should be building first (Phase 5) is a **contract library**: typed postcondition templates per system, plus
precedent patterns, that a cheap model instantiates and code evaluates.

**(b) Evidence.**
- [measured] 112 distinct assertion types cover the 60 exposed dev tasks, 4.8 per task; one type
  (`gmail_message_sent_to_with_body_contains`) appears in 26 of 60 tasks; 102 app-stripped shape families, and the top
  dozen are all "message exists/not to X with substring", "row exists/updated/not", "action exists/not" (Appendix A).
  Across 600 tasks the number of workflows that recur is 0 (`NOTES.md` §11); the number of check types that recur is
  nearly all of them.
- [doc] Every bed in the repository has an oracle library that outlived its workflows (`beds/*/AUDIT.md`;
  `beds/ebed/e8/controls.mjs`, `golden.mjs`). The tracker's hardest artifact is "writing 78 correct temporal checks from
  prose … the hardest artifact we make" (`N-VERSION-TRACKER.md:4-7`); the property writer "guesses the vocabulary"
  (`tracker-e8/REPORT.md`). That is exactly what a per-system check grammar removes: the vocabulary is fixed by the
  library, the model only fills parameters.
- [doc] THESIS §9's one kept finding: "host-side contracts carry the gain … the contract layer is the shared asset".
  The repository agrees with this insight and then plans a workflow library.

**(c) Cheapest decisive experiment.** $0 first: count assertion types over the 300 dev-split tasks (types only, never
params or test tasks; `assertDevOnly` applies) and report the reuse ratio tasks ÷ distinct types, beside the workflow
reuse ratio (0). Then, inside A1-C: two checkers, one free-form (the model writes checks) and one library-backed (the
model fills parameters of fixed templates, code evaluates). Metric: checker false-pass rate on the dev grades (the
F11 quantity in `need-router-20261014/DESIGN.md:435`) and strict pass. Prediction: the library checker halves the
false-pass rate. Refuted if free-form is as good: then the grammar is already in the model and the library is only an
audit convenience.

**(d) Stop doing.** Planning the Phase 5 reuse layer around workflow artifacts first. Crystallise contracts; derive
procedures.

---

### I-5. N-version applies to requirement extraction, and the repo already measured why K = 1 fails

**(a) Claim.** Port the E8 lesson up one level: build K independent ledgers from the same evidence, take the union for
recall, treat disagreement as the pointer to what needs adjudication or a question. A single extraction is the most
variable artifact in the pipeline, and A1 rests everything on one.

**(b) Evidence.**
- [doc] Tracker-e8 extraction recall by Haiku across three samples of the *same* spec: 0.767, 0.933, **0.000** (a raw
  failure: one entry); the union of two samples covered 28/30 ids for $0.023; Sonnet was worse (0.53–0.57)
  (`research/need-router-20261014/tracker-e8/REPORT.md` §2, line 83). So K = 1 has a non-trivial chance of a near-empty
  ledger, and K = 3 ∪ reaches the 0.95 bar the tracker set.
- [doc] E8 B1N: three lineages, independent errors, perfect localisation; correlated errors (B1-O repeating a lineage's
  misreading) are the known failure (`N-VERSION-TRACKER.md:23-35`). The same applies to ledgers: the calendly misreading
  would likely recur across samples of the same context, so the K ledgers must be built in clean contexts over the
  corpus, not by re-sampling the acting session.
- [code] A1's ledgers had 11–25 items, 0 of them checked, with "superseded" and "flag" lines that were sometimes the
  errors (calendly's F6) (`runs/a1-dev-first6/results.jsonl` `ledger` fields).
- [web, doc] ClarifyGPT's finding, already in FIRST-CLASS §4.3: ask only when candidates disagree. On AB asking is
  forbidden, so disagreement must be resolved by adjudication against quoted sources (N2b in I-2).

**(c) Cheapest decisive experiment.** $0: on the 60 dev tasks, the developer may read dev assertions; for K = 1 vs K = 3 ∪
ledgers (three clean Haiku calls per task over the corpus from N1, about $0.01 each, so ~$2 for 60 tasks), measure
*ledger coverage of the assertion targets* (recipients, substrings, record fields; a literal match) and the
disagreement rate. Prediction: coverage rises by ≥ 10 points and the disagreement set contains the misread items on
≥ half of the policy/guardrail failures. Refuted if the union adds under 3 points of coverage: then extraction is
not the weak link and interpretation is (I-6).

**(d) Stop doing.** Single-pass ledgers. Sonnet for extraction. Counting ledger lines as evidence of anything.

---

### I-6. Precedent is the spec: records are the cheapest oracle of tacit rules

**(a) Claim.** The "hidden success criteria" of business work are not hidden; they are distributed across the policy
text, the precedent records and the requester's head. Requirements engineering's standing result is that tacit
requirements come from artifacts and observed practice, not from interviews [recalled]; audit practice reconciles
systems against each other ("analytical procedures") rather than trusting representations [recalled; ISA 500/580 rank
evidence by independence from the entity]. On AutomationBench the requester's head is unreachable (no questions), so the
only sources are the world's policies and its **precedents**: the last follow-up task, the last announcement, the last
invoice of the same kind show the house format, the status vocabulary and who gets notified. Reading two or three
precedents of the record type you are about to create is a code step, costs one batch, and attacks the "wrong field"
class directly.

**(b) Evidence.**
- [code] Wrong field is 3 of 10 classified failures: "Routed to Robert Kim" vs the role; "8 registrant" vs "8
  cancellation emails"; a paraphrased "DocuSign documents have been sent" (`failures-classified.json`). Two of three are
  paraphrases of a literal the world contains; the third is a convention a precedent row would show.
- [doc] FIRST-CLASS §4.4 already lists "Records: past orders whose outcomes reveal a rule; inference only" as a carrier,
  but ranks it below the SOP page and gives it "about 10%" of the rules. In a real business the proportion is the other
  way round: SOPs are stale, records are current.
- [doc] The AB worlds carry deterministic distractor records "seeded by example_id" (`NOTES.md` §2), so precedents and
  traps coexist; the N-version step (I-5) is what tells a precedent from a trap.

**(c) Cheapest decisive experiment.** $0 census on subset60: for each failed assertion with a literal value, does a
pre-existing record of the *target* type in `world0.json` carry the same pattern (same subject prefix, same status
vocabulary, same recipient list)? If ≥ half of the wrong-field failures have such a precedent, add "fetch k precedents
per target type" to N1 and re-measure wrong-field failures in A1-C. Refuted if precedents exist for under a quarter of
them: then AB's conventions live only in policy text, and the step is for real businesses, not this bench.

**(d) Stop doing.** Treating the SOP as the primary carrier in SPEC-0/SPEC-1; make records a first-class carrier with its
own recall measurement.

---

### I-7. The honest claim structure for AutomationBench, and the contradiction adopted on one day

**(a) Claim.** By the project's own utility (u = p − c/V − B/(N·V) − …, `DESIGN.md` §5) and by F1 ("structure is earned
by recurrence"), a one-shot task with N = 1 never amortises a build. The owner adopted F1 and froze AB-v1, a one-shot
headline, on the same day. Both are right only if the claims are separated:

| Regime | What it tests | What it cannot test | Honest headline |
|---|---|---|---|
| Public one-shot (AB-v1) | **A frontier-written, task-agnostic, code-owned template executed by Haiku** (C1; the shape of P1's `fhand`), and spec discovery from a world | per-task construction, need routing, reuse | "Haiku + a code-owned procedure: X% strict on 266 held-out public tasks, CPS $Y; raw Haiku Z%" |
| AB-R recurring families | per-family construction (C0) and reuse (Phase 5): build once on dev triggers, run on held-out triggers | transfer to unseen task shapes | "build once $B, then $c per trigger at p" |
| Private leaderboard | a different population ("purposely harder") with different top entries | comparability with the public set | directional only |

**(b) Evidence.**
- [doc] `NOTES.md` §11: "the raw tasks are single triggers on unique worlds, so build once … has nothing to amortize";
  `OWNER-DECISIONS.md` F1; `PREREG-AB-v1.md` §13 (a +6 forecast for a prose harness).
- [web] Zapier's private leaderboard (v1.0.6) tops out at Gemini 4 Argon (High) 51.29%, Sonnet 5.5 (Max) 44.75%, Opus
  5.5 (Max) 42.47%; the README numbers quoted in the brief (Opus 5 max 50.3%, Sonnet 5 max 34.7%) are public-set
  figures [doc]. They are not the same population, and the project should never put them in one table.
- [I] The attainable ceiling of the public set is unknown. If an oracle-aware solver cannot reach ~100% (ambiguous
  configs like `Old_Churn_Days=90`, literal-wording assertions), the frontier's 42–51% must be read against that
  ceiling, and so must ours.

**(c) Cheapest decisive experiment: the oracle-aware ceiling.** Host-side, dev tasks only (the developer may read dev
assertions): scripted or Opus-written solutions *given the assertions* for 30 dev tasks, graded by the unchanged rubric.
$0 model money if scripted; about $5 by an Opus agent. Metric: strict pass with the answers in hand. If under 90%, the
benchmark's ceiling is published beside every score; if ~100%, the gap is all ours.

**(d) Stop doing.** Describing AB-v1 as a test of "Foundry" or of construction. Pooling public and private numbers.
Letting the "publishable score" goal pull the project toward prompt-tuning a one-shot bench, which is the regime F1
says not to build for.

---

### I-8. "Cheap model" is a proxy; the axis is cost per verified success at fixed independence

**(a) Claim.** The research questions are still phrased "can Haiku …". The evidence says the variance is in the loop,
not the model: the same Haiku is worthless or perfect depending on whether anything independent pushes back (E8 0% vs
100%), and the frontier model inside no loop is worse than the cheap model inside one (Opus one-shot 27.5%). So the
"slider" the owner wants (cost first ↔ reliability first) should not move the model tier; it should move the
**independence budget**: K lineages, second readers, verifier tier, precedent depth. Haiku is the stress test that makes
independence visible; it is not the product.

**(b) Evidence.** [doc] `B1-E8-DEV.md:112-121` (Haiku + loop beats Opus without one at 20× lower build cost); `README.md:195-200`
(F-opus 16/16 at $0.075 vs the Opus agent 16/16 at $0.506: the loop makes the frontier model cheap too); P1's CPS
ratio 0.051 with the caveat that the success gap is "largely an artefact" of timeouts (`README.md:164-178`): the robust
P1 finding is cost at parity, not capability. Against: no experiment has yet varied independence at fixed model while
also varying the model at fixed independence.

**(c) Cheapest decisive experiment.** On dev-train, a 2×2 at K = 1: {raw, A1-C} × {Haiku, Sonnet}, 60 tasks each cell
(two cells exist or are cheap; the Sonnet cells cost about $10–15, cap $20; the prereg's A2 reference is one of them).
Prediction: A1-C(Haiku) ≥ raw Sonnet, and A1-C(Sonnet) − A1-C(Haiku) < raw Sonnet − raw Haiku (the loop compresses the
model gap). Refuted if the model gap is unchanged inside the loop: then model tier is the axis after all and the
cheap-model thesis is simply a cost story.

**(d) Stop doing.** Framing programs as "can Haiku build these nodes, or do we need a fine-tuned model"
(`B1-E8-DEV.md:11`); the data already answered: neither, it needs a loop.

---

### I-9. Evidence being explained away, and measurement displacing the product loop

**(a) Claim.** Four results contradict parts of the thesis and are being carried as caveats instead of changing the
plan; and the project is repeating the sibling-project failure its own THESIS §9 diagnoses ("proof plumbing has
displaced usefulness; the researcher supplies the hard decision").

**(b) Evidence.**
1. **The typed IR as an authoring surface.** C0: Haiku writing the IR 11/16, Haiku writing a script 16/16; the heal
   could not express a per-row guard in the IR (`README.md:195-198,216`; `docs/RESEARCH.md:116-117`). The JIT pivot
   accepted this, yet THESIS §4 still lists the IR first, D12 keeps building toward "100% representation even if new
   constructs don't help a cheap builder", and the coverage layer reports 476/1,342 declared with **0 compiled, 0
   executed** (`README.md:104`). The IR's proven value is audit, taint and replay. Make it the compilation target and
   the audit substrate; stop measuring representation until a capability number depends on a construct.
2. **The P1 headline** is cost at parity, not a success lift ("largely an artefact of the harness", `README.md:169-178`).
   Say "cheaper at equal success" everywhere and drop "makes a cheap model reliable" until a clean run shows it.
3. **Jev**: three tests at or below Haiku and below a size rule (`runs/m1-r/REPORT.md`, `runs/jev-need2/REPORT.md`,
   `runs/jq/REPORT.md`); decision 12 already demotes it. Fine; but "typed judgment layer" is still a named layer of the
   vision with no measured lift. Keep it as a feature, not a layer.
4. **"Workflows pay off on tasks that recur" is unchecked** by design (decision 11 default: no list), and the owner's own
   tasks are "waiting", defaulting to "reported as missing" on 10-28 (`README.md:355,357`). Meanwhile about $1,950 is
   planned against a $1,500 soft cap across the need router, MRR, AB-v1, AB-R and F1–F8 (`FIRST-CLASS-PROGRAMS.md` §11),
   with a 21-row roadmap, exposure scans and split hygiene. Every bed is Claude-written (`README.md:118`). There is no
   loop in which a real user's failure changes the system. F7 (upkeep over drift) cannot be measured without real time
   passing on a real stream; F8 (latency) is a column, not a program.

**(c) Cheapest decisive experiment.** One owner task by 10-20, not twenty by 10-28: the owner's most frequent recurring
task, with its acceptance check, run weekly by whatever the system is that week, failures fed to the earning rule (F1).
Cost: the owner's hour. Alternatively, the most recurring process the owner demonstrably has is this repository's own
research discipline (preregistration checks, exposure scans, cost ledgers, claim rows); FIRST-CLASS §9 rules it out as
F6 evidence, correctly, but it is a legitimate *product loop*: run it through Foundry and count what breaks.
Refutation of the "measurement over-investment" claim: if two of the nine paid rows in FIRST-CLASS §10 change a design
decision by 11-04, the measurement was buying decisions and I am wrong.

**(d) Stop doing.** D12 representation work; F7 and F8 as separate programs (fold F8 into the S1 claim row, which the plan
already does, and park F7 until a stream exists); adding programs before one real user's task has run.

---

## 2. Outside fields: what each one has already solved, mapped onto ours

| Field | Solved problem | Maps to | Source |
|---|---|---|---|
| Aviation checklists | Challenge-response needs two crew: the pilot monitoring reads the challenge, the pilot flying responds, the monitor verifies the response matches the completed action; single-crew "call-do-response" lets skipped items pass unnoticed (Degani & Wiener, NASA 1990; 1993) | A1 is single-crew do-confirm; I-1's second reader is the pilot monitoring | [web] https://flightsafety.org/ap/ap_may91.pdf ; https://www.skybrary.aero/index.php/Checklists_-_Purpose_and_Use |
| Protein design | Generate-and-filter accepts a design only if its sequence refolds to the design (scRMSD < 2 Å, scTM > 0.5): an independent round trip, not a judgment of the design | I-3's round-trip terminal test from the world diff | [web] https://arxiv.org/pdf/2301.12485 ; https://arxiv.org/pdf/2402.04997 |
| Zapier's own analysis | False confidence is the dominant failure for every frontier model (72–91%); wrong system; giving up after one search; partial lists; paraphrase | I-1, I-2, I-3, I-6: the census reproduces every item on Haiku | [web] https://zapier.com/benchmarks |
| Audit and assurance | Evidence is ranked by independence from the entity; management representations alone are never sufficient; analytical procedures reconcile systems against each other | the independence labels already in the IR; I-6 reconciliation checks ("for every trigger in A, a record in B") as a check-grammar family | [recalled] ISA 500, ISA 580 |
| Chess engines | Cheap evaluation plus deep search beats expensive evaluation plus shallow search at fixed compute, but search needs a terminal test | E8 (Haiku + loop > Opus one-shot); AB has no terminal test, so the 50-response budget is unused | [recalled] |
| Mechanism design | Self-reports are not incentive-compatible; peer prediction scores an agent on agreement with independent peers | why N-version works and self-verdicts cannot; the owner's "slider" as an independence budget (I-8) | [recalled] |
| Requirements engineering | Tacit requirements come from artifacts and practice, not interviews; traceability = each requirement has a test; modelling exposes contradictions reading does not | I-6 precedent mining; the tracker; F4+F5 are one artifact (an executable system model), not two | [recalled] |
| Compiler testing | Differential testing and metamorphic relations replace a missing oracle; spec mining from traces (Daikon) recovers invariants | N-version (done); precedent-mined invariants for F4 | [recalled] |

One structural note from the table [I]: F4 ("spec from a messy business") and F5 ("realistic mocks") are designed as two
pipelines producing two artifacts. A behaviour-faithful mock *is* an executable spec of a system, and a requirement
ledger with executable checks *is* a mock of the grader; E8's smoke runner was both at once. If SPEC-0's carriers and
FID-0's manifest do not share a schema, the project is building two specs of the same business. $0 check: do they?

---

## 3. Verdict

The project's working mechanism is not cheapness and not typing; it is independence, and every number in the ledger
sorts cleanly by whether the check could be influenced by the thing it checked. On AutomationBench the project built a
prose checklist, let one context write the requirements, the plan, the verification and the decision to stop, and
measured zero, while the same evidence (28% of Haiku's failures never read the app that held the answer, both arms
stopping at a fifth of their budget, Zapier's 72–91% false-confidence finding on frontier models) says exactly where the
independent signal must come from in a one-shot world: code that reads everything, K clean-context ledgers unioned for
recall, precedent records as the current spec, executable postconditions written before acting, a round-trip reader
that reconstructs the request from the world diff, and termination owned by code. None of that needs a fork, a grader
or a frontier model at run time, and all of it fits inside 50 responses and 49 steps. The honest headline for the public
set is "Haiku executing a frontier-written code-owned template", the recurring families are where construction and
reuse get tested, and the reusable asset to build first is the contract library, not the workflow library. The three
things to stop are: calling prose a harness, letting any artifact be judged by its author, and spending the remaining
budget measuring the project against worlds it wrote, while the one real recurring task that would close the loop is
still "waiting".

---

## Appendix A. What was computed today ($0, host-side, development data only)

Script: `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/census2.py <run-dir>`.
Inputs: `/var/tmp/foundry-work/autobench/{raw-haiku-60,a1-dev-first6,a0-dev-first6}/host/<task>/fork-0/{grade.json,calls.jsonl}`
and `prep/<task>/world0.json` (dev tasks; all already exposed per PREREG-AB-v1 §1.2 and AM-2). The script parses only
`api_fetch` URLs (not search results), maps hosts to the world's app keys by an alias table, counts non-empty apps
(records under `world.<app>`), and locates each failed, non-excluded assertion's literal parameters (strings ≥ 4 chars,
not purely numeric) in the initial world.

| Run | Failed tasks | With a non-empty app never fetched | With an answer-literal app never fetched |
|---|---|---|---|
| raw-haiku-60 (subset60) | 47 | 17 | 13 (probable false positives: `pipefy`, `wave` ⇒ 11–13) |
| a1-dev-first6 | 6 | 2 (forex, hr: Google Sheets) | 2 |
| a0-dev-first6 | 6 | 1 (forex: Google Sheets) | 1 |

Never-fetched apps holding answer literals (subset60): google_sheets ×4, slack ×4, salesforce ×3, gmail ×2, zoom, hiver.
World sizes: 1–6 non-empty apps per task; 8–270 records. Subset60 usage: steps mean 13.7 (max 48), turns mean 13.4 (max
23); no task made zero fetches. Assertion grammar over the 60 dev grades: 112 distinct types, 4.8 per task, top
`gmail_message_sent_to_with_body_contains` (26/60), 102 app-stripped shape families.

Where the missed data lived (dev tasks): `hr.zoom_orientation_sessions` → `google_sheets` `ss_orientation/ws_cohort`
(Name, Email, Location, Start Date, I-9 Submitted); `finance.forex_gain_loss` → `google_sheets` `ss_fx_impact/ws_open_fx`
(Invoice, Customer, Currency, Foreign Amount, Booking Rate, USD at Booking). The A1 prompts for both ask for exactly
that data; the A1 ledgers declare it absent.

## Appendix B. Files read

`AGENTS.md`, `README.md`, `docs/THESIS.md`, `docs/RESEARCH.md`, `docs/ROADMAP.md` §6, `research/architecture-20261015/{OWNER-DECISIONS,FIRST-CLASS-PROGRAMS}.md`,
`research/enterprise-20261014/B1-E8-DEV.md`, `research/need-router-20261014/{DESIGN.md §1 §5, DECISIONS-ADOPTED.md, N-VERSION-TRACKER.md, runs/m1-r/REPORT.md, runs/jev-need2/REPORT.md, tracker-e8/REPORT.md}`,
`research/architecture-20261014/{MEMORY-ROUTING-RECURSION.md owner summary, runs/jq/REPORT.md}`, `research/harness-deconstruct-20261015/SYNTHESIS.md`,
`research/automationbench-20261014/{NOTES.md, PREREG-AB-v1.md, runs/raw-haiku/subset60/{summary.json,failures-classified.json,results.jsonl}, runs/a1-dev-first6/*, runs/a0-dev-first6/*}`,
`experiments/autobench/harness/foundry.mjs`, `experiments/autobench/lib.mjs` (adapterText), and the dev-task ledgers, grades, prompts and worlds listed in Appendix A.
Not read: `RECURRING-DESIGN.md`, `experiments/autobench/families/` (AM-8: not harness knowledge), any test-split task, `beds/sealed/`, any credential file.
