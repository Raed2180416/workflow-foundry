# Requirement tracker: minimal design (E8 first)

*2026-10-14. Design for task #60. Owner's ask (verbatim, 2026-10-14): "how do we build a tracker to make sure what user
wants is built, for this we need a model to understand what's needed, and we shouldn't over engineer here, we just need
to log the conditions specified i guess by user normally and check against logic and stuff demanded."*

**Status: design.** Nothing here is built. §6 reports a **$0 feasibility probe** (development diagnostic): three
properties that I wrote by hand, knowing both defects, run over the arm-visible trace of the three existing E8 builds
on the practice worlds. It shows that the trace carries the evidence these properties need. It is **not** evidence
that a model can write such properties from a user's words. That claim is what §5 is for.

---

## 0. What it is, in one paragraph

The user's text is the source. A model splits it into a **ledger** of conditions. Each entry quotes the user's
verbatim span, and the user confirms or edits the list. For each condition a model writes a **small JS property**
from the quote alone. The property runs over a fixed **trace API**: what came in, what the workflow emitted, what the
systems answered, what was refused, and the final records. Every candidate build runs on **practice worlds**, which it
already does in the smoke loop, and each property reports, per instance where its condition was triggered, whether the
trace satisfies it. The output is a **status table**: untested / pass / fail / unclear per condition, with trace
excerpts for the failures. No property sees world truth or the bed oracle. A real user has neither.

**Cut on purpose (no over-engineering):** no requirement DSL or temporal logic, no LLM judge reading traces (a model
writes each check once and the check runs at $0 after that), no automatic property repair, no UI beyond `report.md`
plus `ledger.json` (a page can come later), and no truth labels.

**Information boundary.** The tracker may read only what the user's own platform would show them:
- inbound messages,
- the workflow's tick outputs (including refused ones),
- effect results as delivered,
- human tasks and timers as the workflow declared them,
- the user's reference files (`master/`, `rulebook/`, `calendar/`),
- the final records of the queryable tables.

It may never read:
- `ledger` rows (`subjectCase`, `faultTags`, `injected`, `committed`),
- `counterparty.*` rows,
- `binding` fields,
- task plans (`case`, `ordinal`, `user`, `noise`, `steps`),
- `world.truth`,
- the fault schedule,
- `beds/ebed/e8/index.mjs` `oracle` / `referenceRuns`.

The analyst uses the oracle in the evaluation (§5) only to label the tracker's alarms. Neither the tracker nor the
builder ever uses it.

---

## 1. Ledger (`ledger.json`)

One file per (user text, build target). One entry per user-stated condition.

```json
{
  "tracker": "1",
  "source": { "file": "beds/ebed/e8/spec/SPEC-E.md", "sha256": "c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1" },
  "extractor": { "model": "claude-haiku-5-5", "prompt": "tracker-extract/1", "costUsd": 0.0, "at": "…" },
  "requirements": [
    {
      "id": "Q-031",
      "quote": "If a batch comes back `partial`, resubmit only the failed items, with their original keys, inside the same window.",
      "span": { "line": 161, "lineEnd": 162 },
      "context": ["Q-030"],
      "kind": "when-then",
      "summary": "after a partial reserve result, re-emit only the failed items with their original keys inside the reserve window; do not release instead",
      "confirmed": false,
      "check": { "version": 1, "writer": "claude-haiku-5-5", "traceApi": "1", "fn": "(t, h) => …",
                 "contrast": { "satisfies": { … }, "violates": { … } }, "contrastOk": true, "escalated": false },
      "status": "fail",
      "evidence": {
        "build": { "file": "research/enterprise-20261014/runs/b1lh-e8-3/solver.mjs", "sha256": "…" },
        "worlds": { "1235": { "triggered": 0 }, "1236": { "triggered": 0 }, "1237": { "triggered": 4, "pass": 0, "fail": 4, "censored": 0 } },
        "failing": [ { "world": 1237, "subject": "ORD-1237-0062", "at": "2026-03-05T15:23:00+01:00", "why": "released before resubmitting", "refs": ["em-0000755", "em-0000757"] } ],
        "flags": []
      }
    }
  ],
  "uncovered": [ { "line": 87, "text": "…a normative sentence no entry quotes…" } ]
}
```

**Kinds.** Each kind maps to a property skeleton the writer fills in:

| kind | skeleton | SPEC-E example |
|---|---|---|
| `must` | for each trigger: there exists a matching effect | R2.1 "Read `fraud.check` for every new order." |
| `never` | for each candidate effect: it is not of the forbidden shape | R5.1 "Never undo a step that did not commit; never undo a step twice." |
| `when-then` | for each trigger event or result: the required effect follows, and no forbidden effect comes first | line 162 (partial reserve) |
| `deadline` | `when-then` with a window `[anchor+lo, anchor+hi]` and explicit inclusive/exclusive bounds | R1.1 "Within 60 min of `p`…"; R3.2 timeout in (D, D+60] |
| `order` | for each object with both A and B: A is emitted (or commits) before B | R5.1 shipment cancel, then refund, then releases |

**Granularity.**
- One entry is one trigger-to-obligation pair. A quote is at most one sentence.
- A condition that needs a neighbouring sentence or a reading names it in `context`, for example line 162 with the
  R4.2 step 1 window, or R3.2 with S1. The property writer sees the context quotes too.
- R4.2 thus yields about six entries: reserve within 120 min of t; partial → resubmit; charge after the last
  reservation committed; charge within 120 min of it; ship within 120 min of the charge; a 400 is corrected and
  re-issued with the same key, and is not a failure.

**Extraction model: Claude Haiku 5.5 (`claude-haiku-5-5`), with Sonnet 5.5 (`claude-sonnet-5-5`) as the measured
alternative.** Why Haiku:
1. **The task is shallow.** Extraction is copying spans and classifying them. It is not deep reasoning, and the main
   failure mode (a missed condition) is made visible mechanically by the coverage list, not left silent.
2. **Hallucination is impossible by construction.** A quote must be a verbatim substring of the user text after
   whitespace normalisation. Entries that fail this are dropped and counted.
3. **Cost.** About $0.01 per 6K-token text for Haiku against about $0.15 for Sonnet (inference from list prices of
   $0.10/$0.50 vs $2/$10 per MTok in `policy/models.json`, at about 20K tokens in and 10K out). A Haiku build costs
   $0.39–0.53, so Sonnet extraction would add 30–40% to every request.
4. **It tests the thesis.** Keeping the tracker on the builder's tier tests the claim we care about: cheap models
   build, and cheap models check against the user's own words.

**Switch rule (preregistered, §5a):** if Haiku's id-level recall after the coverage guard is below 0.95, or its
clause-level recall is more than 10 points below Sonnet's, the default becomes Sonnet 5.5, recorded as a policy
decision, not a silent fallback.

**Extraction input and output.**
- The model sees only the user's text plus the ledger schema and the kind table. It never sees code, a build or a trace.
- It returns entries through the model port with a portable JSON schema (`src/models/port.mjs` `checkPortableSchema`),
  so cost lands in the model journal.

Mechanical checks after extraction ($0):
1. **Verbatim quote:** the quote must locate to a line span, and the first occurrence wins.
2. **Coverage list:** every sentence of the user text that carries a normative cue and that no quote overlaps goes
   into `uncovered`, which the report shows. Cues are: must, never, only, within, at most, exactly once, if/when,
   before/after, until, deadline, each/every, do not.
3. **Duplicates:** two entries with the same quote are merged.

**User control.**
- The report lists entries as a checklist (quote, summary, kind). The user confirms, edits the summary or kind,
  deletes, or adds a condition by selecting a span.
- Any edit bumps `check.version`, and the property is rewritten from the edited quote.
- Unconfirmed entries are still checked, but are marked as unconfirmed.

**Not in the ledger.** Conditions the user did not state. A pattern library could later suggest extra conditions,
labelled `source: library`, never auto-confirmed and kept in a separate section. That is the owner's "compare against
enterprise patterns" idea. It stays outside this minimal tracker.

---

## 2. Checks: from a quote to an executable property, without the oracle

### 2.1 Trace API v1 (fixed; the property writer's only reference)

The trace is built by an **allowlist projection** of the host journal (`beds/ebed/host/journal.mjs`
`contentRows()`), plus the final records and the reference files. The probe (§6) implements it in about 40 lines:

```
t.horizon      ISO time the run ended; a window that closes after it is censored
t.files        { 'master/catalog.json': text, 'rulebook/<edition>/policy.json': text, … }   reference files the workflow had
t.inbound      [{ id, type, at, source, payload, instance }]    every message delivered except effect results:
               order.placed, customer.action, carrier.status, humanTask.*, timer.fired, migration
t.effects      [{ id, at, instance, subject, system, op, args, key, after, result, abandoned }]   every effect emitted, in
               order; at = emission time; result = { at, status, error?, items?, result?, attempts? } as delivered, or null
t.refused      [{ at, instance, code, detail, proposed: [{ system, op, args, key, after }] }]   tick outputs the platform
               refused (nothing in them was applied); crashes and timeouts have proposed: []
t.tasks        [{ at, instance, task }]          human tasks as the workflow declared them (id, kind, role, subject, dueAt…)
t.timers       [{ at, instance, id, dueAt }]
t.instances    [{ instance, openedAt, subject, closed: { at, reason } | null }]
t.records      { 'orders.orders': [...], 'billing.charges': [...], … }   records at t.horizon (non-hidden tables only)
h.ms(iso)  h.minutes(a, b)  h.norm(orderId)  h.within(iso, anchorIso, loMin, hiMin, { lo, hi: 'incl' | 'excl' })
h.censored(deadlineIso)  h.of(subject)   (inbound + effects naming one subject, in time order; the only E8-specific helper)
Instance = { subject, at, ok: true | false | null, why, refs: [ids] }   ok null = censored or undecidable
```

Each source row maps to the trace like this:

| journal row | trace field |
|---|---|
| `deliver` / `delivery.dropped` (event projected exactly as `host.armEvent` does) | `inbound` and `effects[].result` |
| `call` (`output.effects`) and `effect.emit` | `effects` and `refused[].proposed` |
| `effect.result` (emission → event id) | `effects[].result` |
| `arm.error` (without `binding`) | `refused` |
| `humanTask.created` (only `task`) | `tasks` |
| `obligation.upsert` | `timers` |
| `instance.open` / `instance.close` (without `binding`) | `instances` |

**Leak test (must exist before any use).** The serialized trace of a run contains:
- no truth case id (`o0001`, `x0…`),
- no `subjectCase`, `faultTags`, `injected`, `binding`, `noise` or `ordinal`,
- and its digest is identical across two worlds that differ only in truth labels.

### 2.2 The property contract

A property is `(t, h) => Instance[]`. It must be pure and deterministic, and it is model-written, so it is untrusted.
It runs **out of process** in the same sandbox as solvers (`beds/ebed/host/sandbox-arm.mjs` pattern: user/mount/pid
namespaces, no network, nothing but the trace JSON and the property file in its directory), with a 5 s limit per
property per world. A throw or a timeout makes the status `unclear`.

**Writing rules** (given to the writer, and checked by review):
1. Write from the quote and its `context` quotes only.
2. Anchor windows on facts the user's world produced: inbound times and payloads (`placedAt`, action times, answer
   times, carrier `reportedAt`) and system results. Do not anchor on the workflow's own decisions, unless the condition
   is about the order of the workflow's own actions.
3. When an anchor depends on another rule (for example "ready at t"), take the lenient bound and return `ok: null` for
   instances inside the slack.
4. Read business constants from `t.files` (fees, policy hours, carrier codes, editions), never from the workflow's
   outputs.

**Example** (the line-162 entry). This is the shape a writer should produce. It is the probe's property after the
correction found in §6.3:

```js
(t, h) => t.effects
  .filter(e => e.system === 'inventory' && e.op === 'reserve' && e.result?.status === 'partial')
  .map(e => {
    const F = e.args.fulfilmentId;
    const failed = e.result.items.filter(i => i.status !== 'ok').map(i => e.args.items[i.index]);
    const later = t.effects.filter(x => x.args?.fulfilmentId === F && h.ms(x.at) >= h.ms(e.result.at));
    const resub = later.find(x => x.system === 'inventory' && x.op === 'reserve');
    const release = later.find(x => x.system === 'inventory' && x.op === 'release');
    const permanent = later.some(x => x.result?.error?.retryable === false);
    const firstReserve = Math.min(...t.effects.filter(x => x.op === 'reserve' && x.args.fulfilmentId === F).map(x => h.ms(x.at)));
    const deadline = firstReserve + 120 * 60_000;        // lenient: t <= first reserve emission
    const keysOk = !!resub && failed.every(f => typeof f.key === 'string' && resub.args.items.some(i => i.sku === f.sku && i.key === f.key))
      && resub.args.items.every(i => failed.some(f => f.sku === i.sku));
    if (!resub && h.censored(new Date(deadline).toISOString())) return { subject: e.args.orderId, at: e.at, ok: null, why: 'censored', refs: [e.id] };
    const ok = keysOk && h.ms(resub.at) <= deadline && !(release && h.ms(release.at) < h.ms(resub.at) && !permanent);
    return { subject: e.args.orderId, at: e.at, ok, why: ok ? 'failed items resubmitted with original keys' : (release ? 'released instead of resubmitting' : 'no valid resubmission'), refs: [e.id, resub?.id, release?.id].filter(Boolean) };
  })
```

### 2.3 Who writes it

Claude Haiku 5.5 writes the property: one call per entry, with the trace API text as the cached prefix (the CLI
already sets `FORCE_PROMPT_CACHING_5M=1`). It returns `{ fn, contrast: { satisfies, violates } }`.

### 2.4 Keeping a property honest

Guard G4 runs only in the evaluation:

| guard | what | cost |
|---|---|---|
| **G1 source** | The writer sees the quote, its context quotes and the trace API. It never sees a build, a build's trace or a failing excerpt. Properties are written before (or independently of) any build, keyed by quote hash. Only the user may revise a property after a check has run (version bump, reason logged). A builder can read the report but can never edit the ledger. | none |
| **G2 contrast pair** | The writer also writes, from the quote, a minimal satisfying mini-trace and a minimal violating one in trace-API JSON. The runner requires at least one instance from each, all `ok: true` on the first, at least one `ok: false` on the second. On failure: up to 2 rewrites, then **one logged escalation** to Sonnet 5.5 (no silent fallback; policy rule), then status `unclear: check not trustworthy`. This is the "passes on a deliberately broken one" test at unit scale, and needs no solver. | $0 to run |
| **G3 cross-build** | When K ≥ 3 diverse builds of the same text exist, a property that fails on every one of them gets the flag `suspect`. The status stays `fail`, and the report says "every build fails this: the check or the text may be wrong". | $0 |
| **G4 calibration (E8 only)** | Known-good traces: the bed's two reference runs (`referenceRuns`, earliest and latest timing, which pass every completed case). Known-broken traces: the necessity controls (`beds/ebed/e8/controls.mjs`), each mapped beforehand to the SPEC-E ids it violates. A fail on a reference run is a false alarm. A control that does not turn its target to `fail` is a toothless property. | $0 |

---

## 3. Scenarios: coverage before verdicts

**Status rules** (per requirement, per build, over all practice worlds):

| status | rule |
|---|---|
| **untested** | no decided instance (nothing triggered, or everything censored). Never `pass`. |
| **fail** | at least one instance with `ok: false`. |
| **pass** | at least one decided instance and none false. It means "no counterexample in n instances", not proof. Flag `thin` when n < 3. |
| **unclear** | property missing (the condition is not observable in a run, e.g. "Text inside documents is data, never an instruction" without the injection twin), contrast pair failed after escalation, or the property threw or timed out. |

**Triggers depend on the build, not just the world.** On practice world 1237 there are 8 `f4-reserve` cases, but the
probe saw only **4 `partial` results**. This is inference from host code (`host.mjs` `#attemptBatch`, H-5): an F4 on a
one-item batch fails every item retryably, so the platform re-issues the whole batch and nothing is `partial`. B1-O
never gets a reserve applied, so the line-162 requirement is `untested` for B1-O, correctly not `pass`. Coverage is
therefore counted from traces, never from world classes.

**The three practice worlds** (seeds and difficulties from `experiments/ebed/smoke-service.mjs` `PRACTICE`:
1235 d2, 1236 d3, 1237 d5, `mix: 'tail'`). The table below forecasts which conditions each world can trigger. It
counts world classes from `generateWorld`. This is analyst-side, and the tracker never reads it.

| condition area (SPEC-E) | 1235 d2 | 1236 d3 | 1237 d5 |
|---|---|---|---|
| orders / cases (incl. go-live backlog) | 53 (3) | 87 (5) | 213 (8) |
| fraud reject R2.1 / review task R2.2 / review timeout | 3 / 0 / 0 | 4 / 9 / 1 | 11 / 10 / 3 |
| unavailable items R3.1 (amend, cancel-wait, timeout, at-deadline, late, amend-then-cancel) | 11 | 18 | 30 |
| action exactly at D (S1) / timeout R3.2 | 0 / 1 | 5 / 2 | 4 / 4 |
| decline R5.2 / collection failed R5.2 | 2 / 1 | 5 / 6 | 9 / 10 (+8 f3-refund) |
| processing cancel R6.2 / after collection R6.3 / same instant S4 | 5 / 1 / 0 | 4 / 4 / 2 | 8 (+2 S8) / 6 / 2 |
| duplicates R1.4 / out-of-order reports S7, R7.2 / stray actions §3.2 | 0 / 0 / 0 | 6 / 14 / 2 | 31 / 32 / 5 |
| edition switch R1.3 / F5 rename R4.2 400 | – / – | – / – | yes / yes (d ≥ 4 / d5) |
| F3 charge+refund S2 / F4 partial l.162 / F6 permanent R5.2 / F1 | – | – | 14 / 8 (4 partial) / 2 / 5 |

Consequences:
- **Many conditions are exercised by 1237 alone** (R1.3, S2, F6, line 162), so they will be `thin` at best.
- **R2.2's "ask again if an answer was unusable"** depends on actor noise (`freeText` 0.08, `withdraw` 0.04 over
  about 10 review tasks in each of 1236 and 1237) and may come out `untested`. That is the honest answer.
- **The remedy for a user** is more practice worlds from the same generator (a 3-world smoke run takes about 10 s).
  For this evaluation, the seeds stay at 1235–1237 and untested conditions are reported as such.
- **A real user needs a scenario source.** E8 has `generateWorld`; a real deployment would use a simulator or
  recorded history. The `untested` list is what tells the user which scenarios are still missing.

---

## 4. Report (`report.md` next to `ledger.json`)

1. **Run health, one line per world:**
   - run status,
   - ticks,
   - effects emitted,
   - refused tick outputs, with the first refusal reason (for example B1-O on 1237: 183 refused, "a batch op keys its
     items, not the batch").
2. **Status table**, one row per requirement:

   | id | quote (first 80 chars) | kind | triggered 1235/1236/1237 | status | flags |
   |---|---|---|---|---|---|

   Under the table: counts by status, plus the `uncovered` sentences, listed as "possibly missed by extraction".
3. **Failing instances.** Up to 3 per failing requirement, each with the property's `why` and a trace excerpt.
   The excerpt holds the rows of `h.of(subject)` from 10 min before the trigger to the window end, one line each.

Here are the real excerpts from the probe, on practice world 1237 (`ORD-1237-0062`, fulfilment `-F1`). Lineage 3
**fails** the line-162 requirement:

```
03-05 15:23 em-0000755 inventory.reserve [SKU-1024 k=…:ri:…-F1:SKU-1024, SKU-1022 k=…:ri:…-F1:SKU-1022]
                       -> partial (#0 error 503 batch-item-not-processed) @15:24
03-05 15:24 em-0000757 inventory.release SKU-1022 -> ok @15:25        (no resubmission of SKU-1024; no charge, no shipment)
```

Lineage 1 **passes** on the same trigger:

```
03-05 15:23 em-0000755 inventory.reserve [SKU-1024 k=rsv:…:SKU-1024, SKU-1022 k=rsv:…:SKU-1022] -> partial (#0 503) @15:24
03-05 15:24 em-0000757 inventory.reserve [SKU-1024 k=rsv:…:SKU-1024]  -> ok @15:25   (failed item only, original key)
03-05 15:25 em-0000760 billing.charge -> ok;  15:26 em-0000761 carrier.create -> ok
```

**Use in the build loop (next, not part of the minimal tracker).** The report can be the builder's feedback: a
`--loop tracked` mode beside `smoke` and `graded`. It replaces the oracle-graded loop with the user's own conditions,
which is what a real user could actually offer. Once properties feed a builder they become **development evidence**.
The independent grade stays the bed oracle on dev worlds 1232–1234, and sealed worlds are never touched.

---

## 5. Evaluation plan on E8 (practice seeds 1235–1237 only)

All of it is a development/diagnostic evaluation. Freeze the following in `research/need-router-20261014/` **before
any extraction run**:
- the gold lists below,
- the control → SPEC-E id map,
- the expected outcomes in (b),
- the thresholds,
- the model ids (from `policy/models.json`),
- the budget (cap $3).

The three builds are frozen by file sha256:
- `b1lh-e8-1/solver.mjs`: lineage 1, 1,022/1,022 on dev worlds;
- `b1lh-e8-3/solver.mjs`: lineage 3, 1,015/1,022, the partial-reserve defect;
- `b1o-e8-1/solver.mjs`: 281/1,022, with a batch-level reserve key that the host refuses.

Every solver and every property runs out of process in the sandbox.

### (a) Extraction recall against SPEC-E's own ids

**Gold.** The scoring set is 30 ids:
- **21 rule ids:** R1.1–R1.4, R2.1–R2.2, R3.1–R3.2, R4.1–R4.5, R5.1–R5.2, R6.1–R6.4, R7.1–R7.2.
- **9 readings:** S1–S9. Note that S7 sits after S9 in the file, at line 266.

Each id is scored by the line span of its paragraph, for example R4.2 = lines 159–170 and S7 = lines 266–267.
Alongside it, the analyst freezes a **U-list** of the unnumbered normative statements, with line spans. Expected
about 15–20, including:
- §1 keys (lines 20–23),
- merge only on the first tick (32–33),
- declare the subject (35–36),
- §2 "each item carries its own `key`" (47),
- §3.1 normalise ids and a repeated order is one order (64–66),
- §3.2 unknown `orderRef` (71–72),
- §3.3 unknown carrier code means `info`, and messages about a cancelled shipment change nothing (77–81),
- §3.5 go-live (91–94),
- §4 "Act inside the window…" (98–100),
- the 400 rule (168–170),
- §4.8 recipients and "exactly once" (236–248).

The analyst also freezes a **clause list**: each id split into atomic trigger-to-obligation clauses, with R4.2 giving
about 6 clauses.

**Metrics.** All are mechanical: an entry covers an id when its quote lies inside the id's span.
- **id recall** = covered ids / 30;
- **U recall**;
- **clause recall**, scored by the analyst against the frozen clause list, blind to which model produced the entry;
- **precision**, the share of entries quoting non-normative text (§6 history, headings);
- **quote validity**, the share dropped by the verbatim check;
- **coverage guard yield**: of the clauses the model missed, how many sit in `uncovered`.

**Arms.** Haiku 5.5 × 3 samples and Sonnet 5.5 × 3 samples, both at temperature default, with the same prompt. Report
mean and range. The switch rule in §1 applies.

### (b) Does the tracker fail the two known defects?

Expected outcomes, preregistered:

| requirement (by the SPEC-E span it must cover) | lineage 1 | lineage 3 | B1-O |
|---|---|---|---|
| line 161–162 partial → resubmit failed items, original keys, same window | pass (≥ 1 decided) | **fail** | untested |
| §2 line 47 / §1 lines 20–23 one key per reservation item (batch carries none) | pass | pass | **fail** |
| R4.2 step 1 reserve every item within 120 min of t | pass | pass (or fail only on the F4 cases) | **fail** |

The table checks over `t.refused[].proposed` as well as `t.effects`, because B1-O's reserves never reach the systems.
- **(b) passes** if all three bold cells come out as expected and both lineage-1 cells come out pass.
- **If extraction produced no entry covering line 162 or line 47,** report it as "missed at extraction". Then run the
  **gold-ledger ablation**: ledger entries from the frozen clause list, properties still model-written. This separates
  an extraction miss from a check miss.

### (c) False alarms

1. **Reference runs.** Every requirement is checked on the two reference runs of each practice world. Target: **0**
   fails, because these runs pass every completed case.
2. **Lineage 1** (1,022/1,022 on dev). Every `fail` is adjudicated by the analyst with the bed oracle in graded mode
   on the same practice world (`smokeReport(…, { mode: 'graded' })`, matched by subject and rule). An alarm on a case
   the oracle passes is a false alarm, and each one is root-caused to one of:
   - an extraction misreading,
   - a property bug,
   - anchor slack,
   - an ambiguity in the spec.

   Target: **≤ 1 false-alarming requirement on lineage 1**. A false alarm on a reference run counts against the
   tracker whatever lineage 1 shows.
3. **G3** with K = 3 builds: list the `suspect` flags. Every one should be explained either by B1-O's shared refusal
   or by a property bug.

**Teeth (the "deliberately broken" side, at $0).** Run the necessity controls on the practice worlds where they apply:

| control | violates (SPEC-E ids) | applies on |
|---|---|---|
| no-compensation | R5.1, R5.2, R6.2 | all three worlds |
| forward-order-compensation | R5.1 order | all three worlds |
| no-keys | §1 keys, §2 l.47, l.162 | 1237 only (d5) |
| timer-first | R3.2, R2.2, S1 | all three worlds |
| edition-by-publication | R1.3, R1.2 | 1237 only (d ≥ 4) |
| no-dedupe | R1.4 | 1236, 1237 (d ≥ 3) |
| last-signal-wins | R7.2 | 1236, 1237 (d ≥ 3) |
| no-correlation | R3.2, R6.2, R6.3 | all three worlds |
| charge-twice | §1 keys, §4 "second commit" | all three worlds |

The **tracker mutation score** is the share of (control, id) pairs where the tracker's requirements covering that id
turn `fail` on the control trace and are not `fail` on the reference runs. Suggested bar: ≥ 0.8. The oracle's own K1
bar is 0.95, and the tracker is weaker by design, since it has no truth.

### (d) Cost and time

Measure the following:
- extraction USD and wall time, per sample and per model;
- property writing USD and wall time, including contrast rewrites and escalations, counted separately;
- check wall time per build on the three worlds;
- trace size.

All USD comes from the provider-reported list price in the model journal.

**Estimates** (inference, to be replaced by measurement):

| item | estimate |
|---|---|
| Haiku extraction | ~$0.01 |
| Sonnet extraction | ~$0.15 |
| Haiku property writing for ~50 entries | ~$0.15–0.30 |
| one-off total | ≤ $0.50 and ≤ 15 min wall |
| each re-check | $0 and ≤ 30 s |

For comparison, the probe's measured check costs for lineage 1 were:
- 1.4 / 2.3 / 6.0 s per world for the sandboxed run,
- 5 / 8 / 21 ms for the projection,
- 0.56 / 1.05 / 2.71 MB of trace JSON.

The builds being checked cost $0.39 (lineage 1, 18.8 min, 71 turns, 10 smoke runs) and $0.53 (lineage 3, 20.2 min).
B1-O, built by Opus 5.5, cost $7.63 over 32.9 min. **Target: the tracker costs at most one Haiku build.**

---

## 6. Feasibility probe (2026-10-14, $0, development diagnostic)

The scripts were in my scratchpad, outside the repo.

**What I did.**
- Ran the three frozen solvers out of process (`sandboxArm`, `createHost`, profile `temporal-like`) on 1235 d2,
  1236 d3 and 1237 d5.
- Projected the trace by allowlist (no ledger rows, no truth fields).
- Ran three properties I **wrote myself, knowing both defects**.

### 6.1 Results per build

Each cell shows triggered / fail per world (1235 / 1236 / 1237).

| property | lineage 1 | lineage 3 | B1-O |
|---|---|---|---|
| l.162 partial → resubmit | 0/0 · 0/0 · **4/0** | 0/0 · 0/0 · **4/4** | 0 · 0 · 0 (untested) |
| §2 per-item reserve keys (incl. refused outputs) | 58/0 · 114/0 · 323/0 | 58/0 · 114/0 · 319/0 | **58/58 · 118/118 · 344/344** |
| R1.1 `orders.create` within 60 min of p | 50/0 · 80/0 · 200/0 | 50/0 · 80/0 · 200/0 | 50/0 · 80/0 · 200/0 |

Run health, from the projected trace: B1-O had 39 / 63 / 183 refused tick outputs, every one rejected for a top-level
key on `inventory.reserve`. Lineages 1 and 3 had 0 / 0 / 0.

### 6.2 Calibration on world 1237

| trace | l.162 property | per-item keys | R1.1 |
|---|---|---|---|
| reference run (earliest) | 4/0 | 323/0 | 200/0 |
| reference run (latest) | 4/0 | 316/0 | 200/0 |
| `no-keys` control | **4/0** | 323/323 | 200/0 |

### 6.3 What it shows, and what it does not

- **The trace carries the evidence.** It is enough to fail lineage 3 on line 162 at 4 of 4 triggers, and B1-O on
  batch keying at every reserve it proposed. It does so with 0 alarms on lineage 1 and on both reference runs for
  these three properties.
- **Teeth checks catch a bad property.** My own line-162 property **passed the `no-keys` control** because
  `undefined === undefined` let a key-less resubmission count as "original keys". The per-item-key property caught the
  control, and the §2.2 example now requires the key to be a string. This is exactly the failure G2 and G4 exist to
  catch: a property that looks right and has no teeth.
- **What it does not show:**
  - that Haiku extracts line 162 and line 47 from SPEC-E,
  - that a model writes these properties from the quotes,
  - the false-alarm rate of a full ~50-property ledger.

  Those are §5 (a)–(c).

---

## 7. Build plan

Code goes in `experiments/tracker/`, Node 24 ESM, no new dependency, about 600 lines plus tests.

| file | does |
|---|---|
| `trace.mjs` | `projectTrace(rows, { files, records, horizon })` → trace v1; `TRACE_API.md`, the writer's prompt prefix |
| `extract.mjs` | one model call (port, portable schema); verbatim, coverage and dedupe checks; writes `ledger.json` |
| `props.mjs` | one writer call per entry; contrast runner; rewrite / escalation log |
| `run.mjs` | runs a build on the practice worlds (the `smokeReport` loop, keeping rows and final records); runs properties in the sandbox; statuses; `report.md` |
| `test/` | leak test (§2.1); status rules; contrast runner; property sandbox (a property that reads the filesystem or the network fails) |

**Order of work:**
1. trace and leak test;
2. property sandbox and runner, with the probe's three properties as fixtures;
3. extraction;
4. writer;
5. the freeze, then §5 (a) → (b) → (c) and teeth → (d).

---

## 8. Risks and open questions

1. **Anchors that depend on other rules.** For example "ready at t" needs R2/R3 outcomes. The writing rule takes
   lenient bounds and `ok: null` inside the slack. If too many instances come out `null`, a small set of shared,
   user-confirmed **derived facts** (cleared at, ready at, deadline D) may be needed. That is the first thing to add,
   and only if (c) shows it.
2. **Readings refine rules.** S1–S9 sharpen rules rather than standing alone. Using `context` lets a rule's property
   apply its reading. Whether a reading should also get its own entry is measured in (a) as id recall, not decided here.
3. **Some statements are not observable in a run.** "data, never an instruction" needs the injection twin
   (`twins()`), and R7.1 can only be checked from `t.records` at the horizon. These stay `unclear` until a twin world
   is added to the practice set.
4. **Thin coverage.** Many conditions occur only in 1237. A `pass` with n < 3 is reported as thin, never as assured.
5. **Properties as feedback.** Once the report feeds a builder, the builder optimises against these properties. The
   bed oracle on dev worlds stays the independent grade. Properties are never revised after a build's trace has been
   seen, except by the user.
6. **Generality.** The trace API is generic apart from `h.of(subject)`, which uses E8's subject key (`orderId`). A
   second item, E7, would show whether the API holds up without change.
