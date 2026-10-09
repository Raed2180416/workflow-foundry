# Workflow records-v3-workflow (wf_5daeb91c-401)

status: completed; finished agents: 2

## Script

```js
export const meta = {
  name: 'records-v3-workflow',
  description: 'Rebuild the hand-written records workflow for bed v3 (per-task conventions read by typed agent nodes), then independently review it on fresh dev seeds',
  phases: [{ title: 'Build', detail: 'one builder iterating on dev seeds' }, { title: 'Review', detail: 'leakage/hardcoding review + fresh-dev check' }],
}
const COMMON = `Repository: /home/user/workflow-foundry (Node 24 on PATH; ESM; node:test). Do NOT commit, push or touch git state. Do NOT edit beds/ (the records bed v3.0.0 was just audited and is frozen), src/, or experiments/lib/. Work roots under /var/tmp/foundry-work/ only (never inside the repo).
Context: Workflow Foundry builds typed workflows where CODE owns procedure and MODELS make narrow typed judgments. The Phase 1 exit experiment P1 (research/core-20261006/PREREG.md, experiments/p1/run.mjs) runs a hand-written workflow for the 'records' bed on Haiku 4.5 (claude-haiku-4-5-20251001) and Sonnet 5.5 (claude-sonnet-5-5) against single-call and agent baselines. The existing workflow experiments/workflows/records-hand.mjs was written for bed v2, where every convention was constant across tasks (it hardcodes DATE_ORDER etc.). The audit (beds/records/AUDIT.md, README.md) showed v2 d1-d3 was solvable by a 40-line regex script; v3.0.0 makes conventions PER TASK and states them only in prose in inputs.source_notes (date orders by example or by reference to another system or by a team's city/history, extra status values with per-task live/void meanings, a re-stamped mirror system whose change dates must not be trusted, per-system balance perspective). d1-d2 are unchanged from v2 (scriptable); P1 will move to d3 and d4.
Read: beds/records/README.md, beds/records/AUDIT.md, beds/CONTRACT.md, experiments/workflows/records-hand.mjs (the v2 workflow and its helpers), experiments/lib/arms/foundry-workflow.mjs (how a workflow is run per task: input {prompt, inputs}, node 'answer' output), experiments/lib/models.mjs, experiments/lib/beds.mjs, experiments/lib/runner.mjs, research/core-20261006/DESIGN.md (IR: agent/code/verify/map nodes, context inputs, returns schemas (portable subset: no pattern/oneOf/uniqueItems/nested $ref), checks, escalation), skills/micro-harness/SKILL.md (general lessons: narrow judgments, thinking off for extraction, raw-span extraction parsed in code, id-echo checks, rules in code, verify then answer).
HARD RULES: (1) Use ONLY the dev split (seeds 101-160) for development; never generate or look at test-split tasks (seeds >= 5000). (2) Do NOT read the generator internals beds/records/world.mjs, pools.mjs, render.mjs, solve-text.mjs or attacks/ — a hand workflow author knows the domain from the README and from dev task texts, not from the generator's paraphrase pools; you may read index.mjs only to call generate()/oracle(). (3) Never hardcode a per-task convention (date order, status meaning, mirror system, perspective): each must be READ from that task's source_notes by an agent node with a typed (enum) output, or derived in code from what such a node returns. Fixed facts the README states as constant across tasks may be coded. (4) Every model id comes from policy/models.json; spend through experiments/lib/models.mjs createModelPort (journal under /var/tmp/foundry-work/records-v3/) so costs are journaled.`

phase('Build')
const built = await agent(`${COMMON}
NOTE: a previous attempt at this exact task was cut off by a usage limit after ~1.5 hours; its partial files (experiments/workflows/records-v3.mjs, records-v3.test.mjs, records-v3-dev.mjs) and its dev log under /var/tmp/foundry-work/records-v3/ remain (also committed as WIP). Read them and the dev log first, keep what works, and finish; do not redo dev runs already logged unless the code changed. Note the R8 change: the runtime's default per-call model timeout is now the ModelPort's (300 s). TASK: Write experiments/workflows/records-v3.mjs exporting buildRecordsV3Workflow({ extractModelClass, conventionsModelClass, maxClass, concurrency, maxCost, reasoning }) (plus any pure helpers it needs, exported for tests) and experiments/workflows/records-v3.test.mjs (unit tests of the pure helpers on literal fixtures; no model calls). Design guidance (adapt as needed, justify deviations in a header comment):
- A 'conventions' agent node (or a few narrow ones, e.g. one per system, via map) that reads inputs.source_notes and returns a typed object: per system the numeric date order (dmy/mdy/ymd, with any date-dependent rule such as 'numeric dates written after <date> use <order>' expressed as typed fields), the extra status values with their meaning (live/void) and how a void row is recognised, which system's change dates are untrustworthy (mirror/restore window), each system's balance perspective (sign convention), and anything else per-task the README lists. Keep each judgment narrow; thinking off unless measured otherwise; validate with checks (e.g. every system named in the notes is covered; enums only) and escalate on failure.
- Row parsing and extraction: reuse the v2 approach (code splits rows; an extraction agent node per chunk returns raw spans with id echo; code parses dates/amounts using the conventions; union-find identity resolution, conflict rules and FX in code from inputs.spec), adapting to v3 formats seen in dev tasks.
- A verify node before 'answer' (structural and consistency checks), and node 'answer' returning {records:[...]} matching the bed's output schema.
Iterate: run the workflow on dev seeds via a small driver (experiments/workflows/records-v3-dev.mjs) using experiments/lib/arms/foundry-workflow.mjs + experiments/lib/runner.mjs with the bed oracle, Haiku for extraction and conventions first. Development target: >= 8/10 passes on dev seeds 101-110 at d3 AND >= 6/10 at d4, at <= $0.40 per task on Haiku. If Haiku cannot read the conventions reliably, measure Sonnet for the conventions node only and report both. Spend cap for your whole session: $25 of model calls (check the journal). Record every dev run's pass/score/cost in /var/tmp/foundry-work/records-v3/dev-log.jsonl.
Final answer: the design (nodes, which are model vs code, schemas of the judgment nodes), dev results per seed (d3 and d4, pass, score, cost, model calls, escalations), what failed and why, total spend, and the exact builder options you recommend for P1 arms fhand-haiku and fhand-sonnet.`, { label: 'build:records-v3', phase: 'Build', model: 'opus', effort: 'xhigh' })

phase('Review')
const review = await agent(`${COMMON}
TASK: INDEPENDENT REVIEW of the workflow experiments/workflows/records-v3.mjs (just built by another agent; its report follows). Builder report:
${built}
Do all of:
1. Hardcoding/leakage audit: search the workflow source for any per-task convention baked into code (fixed date orders per system, fixed status tokens/meanings, fixed mirror system names or windows, fixed perspectives), any string copied from the generator's paraphrase pools (compare against beds/records/pools.mjs and render.mjs — you MAY read them for this audit), any use of test-split seeds, any oracle/truth access. Report each with file:line.
2. Fresh-dev generalisation check: run the workflow with the builder's recommended options on dev seeds 141-150 at d3 and d4 (seeds the builder did not use), Haiku extraction, via experiments/lib/arms/foundry-workflow.mjs + runner + bed oracle, journal under /var/tmp/foundry-work/records-v3-review/. Report pass/score/cost per seed and totals. Spend cap $10.
3. Code review: node schemas portable and narrow? checks on every model node? escalation sane? cost accounting through run.cost? any way a bad model output crashes the run instead of failing a check?
Final answer: a findings table (id, severity blocker/major/minor, finding, file:line, proposed fix) and the fresh-dev numbers, and a GO/NO-GO for using this workflow in P1 (GO requires no blocker; numbers are informational, not a gate).`, { label: 'review:records-v3', phase: 'Review', model: 'sonnet', effort: 'xhigh' })
return { built, review }
```

## Agent result 1

I finished the records v3 workflow and validated it on the dev split. With Haiku doing extraction and convention reading, it passes 10/10 at d3 and 10/10 at d4 on seeds 101–110. Every task scored 1.000, cost was $0.091–$0.153 per task, and 12 calls escalated to Sonnet. All-Sonnet passes 5/5 at d3 and 5/5 at d4 on seeds 106–110. Haiku read the conventions reliably, so I did not run the "Sonnet for conventions only" variant.

Unit tests pass (21/21, no model calls). Nothing was committed, and I did not touch `beds/`, `src/` or `experiments/lib/`.

**What I changed this session.** The earlier attempt's code was nearly complete and its last good run (a6) passed 40/40. The a7 run was killed by the usage limit (HTTP 429), so the current code had never been checked live; that is what a8 and s8 below do. My only code change: the verify node used to fail whenever code's evidence-derived date order overrode the model's direct answer. That happened in 7 of 43 runs, and the derived value was right every time. These overrides are now listed as `note:` reasons and no longer fail the check. The dev driver logs them too.

## Design (`experiments/workflows/records-v3.mjs`)
Code nodes:
- **spec**: reads rate tables, calling codes and trunk rules, and the nickname appendix.
- **prep**: splits rows and parses the five structured line formats, splits the notes into one paragraph per system, lists the extra status values that occur in the export, collects non-exact country strings, and chunks the VENDEX rows.
- **merge**: applies the conventions (void rows, date orders with the ATLAS cutoff, sign flips, mirror rows last in conflict order), then identity linking (union-find), field-by-field conflicts, accent restoration, E.164 phones and exact FX with half-away-from-zero rounding.
- **check** (verify, does not block the answer): structural checks, one mirror only, every row either void or merged, VENDEX spans verbatim.
- **answer**: returns `{records:[...]}`.

Model nodes, all typed (enums), thinking off, 300 s timeout. Retry once on a schema error; on a failed check, escalate to Sonnet (up to 2 escalations), or resample once for VENDEX and for nodes already at the top class.
- **dates** (one call each for BRIGHTDESK, ATLAS, VENDEX): `{basis: explicit|example|same_as_system|place, order: dmy|mdy, quote, example_numeric, example_meaning, same_as_system: system enum|none, moved_from, place, place_in_united_states: bool|null}`. Code derives the final order from the evidence: it parses the example date, follows "same as" references (LEDGR is always day-first), and maps a place to month-first if it is in the US, day-first otherwise. Checks: the quote is verbatim and contains the evidence, "same as LEDGR" implies day-first, the moved-from place differs from the current place, and the place agrees with the order.
- **atlas_switch**: `{present, quote, switch_date, after: swapped|day_first|month_first|none, boundary: on_or_after|after|none}`. Checks: the quote is verbatim and contains the date.
- **statuses** (one call per extra status value): `{meaning: void|live, relation: same_as|different_from|none, compared_with: fixed-marker enum, quote}`. Checks: the quote mentions the value, and the meaning agrees with the compared marker and the stated relation.
- **mirror** (BRIGHTDESK, LEDGR, VERITAS): `{update_dates: restamped|real|not_stated, quote}`. Checks: the quote is verbatim, and a "restamped" answer requires that system's update dates to span at most 120 days. That threshold only triggers escalation; it never decides.
- **perspective** (BRIGHTDESK, LEDGR, ATLAS, KOBO): `{positive_in_master: positive|negative, positive_printed_balance_means and negative_printed_balance_means: they_owe_us|we_owe_them, master_span, quote}`. Checks: spans are verbatim, the two "positive" fields agree, positive and negative meanings differ, and sign words in the span match the answer.
- **vendex** and **vendex_b**: two independently framed reads of each 5-row chunk, returning `{ids, rows:[{row, name, birth_date, revised, phone, balance_text, balance_kind, currency, place_kind, place, country}]}` with a row-id echo check. Code re-anchors spans to the entry text and combines the two reads field by field.
- **countries** (chunks of up to 30 strings): `{ids, names, codes: ISO enum}`. Checks: id echo, and no "other".

Deviations from the guidance, justified in the header comment:
- The five structured systems are parsed in code. Their line formats are constant and stated identically in every task's notes.
- The single conventions node is split into five narrow ones.
- VENDEX is read twice. Silent field omissions by a single read caused a dev failure.

No per-task convention is hard-coded. The fixed markers, ZZTEST, "Application withdrawn" and the VENDEX direction words all appear verbatim in every task's notes.

## Dev results (live, current code)
Haiku runs (extraction and conventions on Haiku, escalation allowed to Sonnet), label a8:

| seed | d3 cost | d3 calls | d3 escalations | d4 cost | d4 calls | d4 escalations |
|---|---|---|---|---|---|---|
| 101 | $0.1112 | 22 | 0 | $0.1394 | 28 | 0 |
| 102 | $0.1157 | 23 | 1 | $0.1099 | 24 | 0 |
| 103 | $0.1093 | 22 | 0 | $0.1305 | 26 | 1 |
| 104 | $0.1073 | 22 | 0 | $0.1252 | 25 | 1 |
| 105 | $0.1527 | 27 | 3 | $0.1092 | 23 | 1 |
| 106 | $0.1020 | 22 | 0 | $0.1218 | 24 | 1 |
| 107 | $0.1078 | 23 | 0 | $0.1188 | 25 | 1 |
| 108 | $0.1035 | 22 | 0 | $0.1210 | 25 | 1 |
| 109 | $0.1083 | 23 | 1 | $0.1244 | 26 | 0 |
| 110 | $0.0912 | 20 | 0 | $0.1295 | 27 | 1 |
| **mean** | **$0.111** | | 5 total | **$0.123** | | 7 total |

Every row passed with score 1.000.

- **Code-health run (a8r, d3 seeds 101–103):** 3/3 pass, $0.34. It is logged as "replay-or-live", but all 67 calls were live because the prompts had changed since a6. The driver's `--summary` view skips these rows because of that label.
- **All-Sonnet (s8):** every task passed with score 1.000 and 0 escalations.
  - d3: s106 $0.2783 (22 calls), s107 $0.2189 (23), s108 $0.2132 (22), s109 $0.1939 (22), s110 $0.1718 (20).
  - d4: s106 $0.2108 (23), s107 $0.2147 (24), s108 $0.2137 (24), s109 $0.2385 (26), s110 $0.2405 (26).
  - The earlier s6 run covered seeds 101–105 at 10/10, on slightly earlier prompts.
- **Earlier runs:** a2 20/20, a3 19/20, a4 50/50 (seeds 101–125), a5 19/20, a6 40/40 (seeds 101–120), a7 0/20 because of the usage limit, not model errors.

## What failed and why
- **a1:** a code-node bundling error.
- **a3 d3 s103:** verify passed but the oracle failed. A single VENDEX read silently dropped a field, which split one person into two records. This is why VENDEX is now read twice.
- **a5 d3 s107:** VENDEX's date order was read from the place the team moved *from* instead of where it works now. The `moved_from` and `place` fields and their check were added for this.
- **a8 escalations:**
  - Perspective (6): Haiku gave positive and negative printed balances the same meaning, misreading the "▲ or a minus marks…" clause. In one KOBO case it also said "positive" for prepaid store credit, which is wrong.
  - Countries (5): Haiku answered "other" for a valid country string.
  - atlas_switch (1): the quote was truncated and missing the date.
  - The checks caught every one and Sonnet repaired it.

## Spend
- Previous session: $18.44.
- This session: $4.87.
- Cumulative in the journal: **$23.31**, under the $25 cap (I counted the cap cumulatively).

## Recommended builder options for P1
- **fhand-haiku:** `buildRecordsV3Workflow({ extractModelClass: 'M', conventionsModelClass: 'M', maxClass: 'L', concurrency: 4, maxCost: 2, reasoning: 'none' })`, with `maxCostUsd: 2` and `assignment: { judge: 'claude-haiku-4-5-20251001', atlas_switch: 'claude-haiku-4-5-20251001' }`.
- **fhand-sonnet:** the same, with `extractModelClass: 'L'`, `conventionsModelClass: 'L'`, and `assignment: { judge: 'claude-sonnet-5-5', atlas_switch: 'claude-sonnet-5-5' }`.

I checked that both assignments are accepted by `createRun`. Two changes to `experiments/p1/run.mjs` are needed:
- Its current `{ read: … }` assignment names no node in this workflow, so it will be rejected.
- Its tasks still use difficulties 2 and 3; they need to move to 3 and 4.

## Limits
- These are development numbers only. Dev seeds 101–125 were used to shape the workflow, so they are not held-out evidence. d5 is untested.
- Three rules come from dev observation or general knowledge rather than the README:
  - The 120-day window in the mirror check.
  - The place-to-order rule (US means month-first, everywhere else day-first).
  - The English sign words in the perspective check.
- All three only trigger escalation or derive values from what the model quoted.

Files are in /home/user/workflow-foundry/experiments/workflows:
- records-v3.mjs
- records-v3.test.mjs
- records-v3-dev.mjs

Logs are in /var/tmp/foundry-work/records-v3:
- dev-log.jsonl
- journal.sqlite
- a8-d3.out
- a8-d4.out
- s8-d3.out
- s8-d4.out

## Agent result 2

**Verdict: GO for P1. There is no blocker.** Two major findings (F1, F2) are cheap to fix and should be fixed before the P1 freeze.

The review changed no repo files. All probes and logs are under `/var/tmp/foundry-work/records-v3-review/`. I generated no test-split tasks. The 21 unit tests pass.

## Findings

All line numbers refer to `experiments/workflows/records-v3.mjs`.

| id | severity | finding | file:line | proposed fix |
|---|---|---|---|---|
| F1 | major | `atlas_switch` uses `onError:'continue'`, but `merge` has the default `join` (all_success). If `atlas_switch` exhausts its checks at Haiku and Sonnet, `merge`, `check` and `answer` are skipped. The run ends ACCEPTANCE_FAILED with no answer. The `{ok:false}` handling in `resolveConventions` is therefore dead code. I reproduced this with a scripted adversary (`fuzz.mjs`): 5 of 12 runs had no answer. With `join:'all_resolved'` on `merge`, 24 of 24 runs produced an answer, 8 of them with `atlas_switch` handled_error. It has not been seen in the 264 logged real runs (one `atlas_switch` escalation, repaired). | 1085, 1102; dead handling at 496, 533-541 | Add `join:'all_resolved'` to the `merge` node. |
| F2 | major | The two VENDEX reads disagree on country, and `combineVendexReads` silently keeps read A's value. A "place stated, country none" in read A also discards read B's country. The `check` node never sees this, so the failing run had `check` pass=true. In the 40 fresh-dev runs, both A/B country disagreements were A wrong and B right: Dublin→GB and Fredericia→DE. Dublin→GB gave a +44 phone and split a person, which is the only fresh-dev failure (d3 s145, score 0.964, extra=1). Fredericia→DE cost one country field in rv2 d4 s150, still a pass. Across all journals, 5 disagreements in about 2,500 row pairs (0.2%), roughly 2-5% of tasks. A is not reliably the right read: in the builder's logs B was wrong twice and A once. | 295-296; 763; verify at 838-844 | On a country disagreement, or a none-vs-value disagreement, record a diagnostic and have a Sonnet call adjudicate that row, or send the place string through the `countries` node. |
| F3 | minor | The prompts embed literals copied from dev seed 101 notes, which breaks the micro-harness rule against literals from probe tasks. Examples: "Femke Visser", "Mattia M. Ferraro", "50,042.72", "+33 1 95 59 16 95", "13 April 1988", "03/02/1958", and the ATLAS switch example "5 May 2020" (the d4 s101 and s119 date). This is not test leakage, since names come from finite pools and no truth is exposed. It only flatters dev seed 101. | 874, 908, 1000-1008, 1014-1025 | Replace them with synthetic examples. |
| F4 | minor | Several checks are tied to the bed's paraphrase vocabulary. The perspective sign words are at 991-996; the status-mention formats at 395-397; the ATLAS tag regex `[A-Z][A-Z ]*[A-Z]` at 369, which only fits the pool tokens ('ON STOP', 'DORMANT', …). Every word occurs in dev notes for seeds 101-125, so none is provably pool-only. The failure mode is an extra escalation or an exhausted node, never a silent wrong answer. Both splits share the pools, so none of this supports a generalisation claim. | 369, 395-397, 991-996 | Accept for P1 and document the coupling. |
| F5 | minor | The 120-day mirror window is a generator property, though it only triggers escalation. In dev, true mirrors span 16-45 days (n=79, oracle-pass runs); the other candidate systems span 2,299-3,731 days (n=158). The margin is 2.7x. A correct "restamped" answer on a window over 120 days would be rejected at both classes, and the mirror would be lost. | 964, 30, 680 | Raise it to 365 days, or make it a warning only. |
| F6 | minor | The `countries` checks do not enforce that `names` and `codes` match `ids` in length, and do not reject `none`. A short array or a `none` silently leaves a country null with no diagnostic. It was not observed: the 35 final country calls were well-formed. | 1101; 717-722 | Add an unmapped-string diagnostic in `mergeMain` and a `none` check. |
| F7 | minor | `check` is `gate:false` and has no remediation path. A failed check still emits an answer (by design, though it needs reporting), and F2 shows it can pass on wrong answers. | 1113-1114 | In P1, report check-pass and oracle-pass separately. |
| F8 | minor | The fixed-marker table exists in three copies, and `FIXED_STATUS` is unused. The ISO3 map exists twice. This is a drift risk. | 98-104, 544-545, 665; 114, 405 | Keep one copy and inject it via args. |
| F9 | info | The builder's numbers are for Haiku 4.5. The P1 draft now uses Haiku 5.5 for class M. The orchestrator's own check (`h55-d3` and `h55-d4`, seeds 151-155) is 10/10 at $0.07-0.10 per 5 tasks. | n/a | None. |
| F10 | info | d5 is untested, but `parseSpec` reads the two dated FX tables correctly. | 412-450 | None. |
| F11 | info | The `armHash` recorded for rv1 differs from the one recomputed now. `policy/models.json` was rewritten at 21:36, mid-run, and git shows no content change. rv2 ran entirely on the current files. | n/a | None. |

## Hardcoding and leakage audit

- **Per-task conventions:** none is baked in. Date orders, status meanings, mirror and perspective all come from typed model nodes. Code only resolves example dates, "same as" references, and US versus non-US places.
- **Fixed facts, all README constants:**
  - LEDGR day-first (507).
  - The fixed status markers, KOBO=JP (796), and the default currencies (802).
  - The mirror candidate list (96).
  - The `flip` map starts all false.
- **Pool copying:** I found no phrase that exists in the pools but in no dev note. The prompt vocabulary matches phrases that appear in dev notes: for example "exactly like" 18 times, "Do not confuse" 20, and "restore kept the original" 8.
- **Test seeds:** none. The dev driver rejects seeds outside 101-160 (`records-v3-dev.mjs:35`). Every dev-log and results row is a dev task, seeds 101-155.
- **Oracle or truth access:** none. The workflow and its test file never import anything from the beds.

## Fresh-dev run (seeds 141-150, Haiku 4.5 pinned, escalation to Sonnet 5.5)

I used the builder's recommended options. A prior interrupted pass of this review had already completed rv1 (20 tasks). I verified its results against the journal (per-run cost and call counts matched exactly) and kept it as sample 1. I ran a second independent sample, rv2, with a new salt.

| seed | d3 rv1 | d3 rv2 | d4 rv1 | d4 rv2 |
|---|---|---|---|---|
| 141 | P 1.000 $0.114 | P 1.000 $0.105 | P 1.000 $0.115 | P 1.000 $0.115 |
| 142 | P 1.000 $0.116 | P 1.000 $0.118 | P 1.000 $0.129 | P 1.000 $0.125 |
| 143 | P 1.000 $0.100 | P 1.000 $0.089 | P 1.000 $0.106 | P 1.000 $0.108 |
| 144 | P 1.000 $0.103 | P 1.000 $0.100 | P 1.000 $0.096 | P 1.000 $0.098 |
| 145 | **F 0.964 $0.093** | P 1.000 $0.093 | P 1.000 $0.123 | P 1.000 $0.114 |
| 146 | P 1.000 $0.098 | P 1.000 $0.090 | P 1.000 $0.098 | P 1.000 $0.097 |
| 147 | P 1.000 $0.088 | P 1.000 $0.090 | P 1.000 $0.105 | P 1.000 $0.108 |
| 148 | P 1.000 $0.088 | P 1.000 $0.091 | P 1.000 $0.118 | P 1.000 $0.109 |
| 149 | P 1.000 $0.093 | P 1.000 $0.090 | P 1.000 $0.133 | P 1.000 $0.128 |
| 150 | P 1.000 $0.087 | P 1.000 $0.091 | P 1.000 $0.109 | P 0.999 $0.101 |

- **Pass rates:**
  - d3: rv1 9/10, rv2 10/10.
  - d4: 10/10 in both samples.
  - Total: 39/40, mean score 0.9991.
- **Cost:** mean $0.104 per task. d3 is $0.098 (rv1) and $0.096 (rv2); d4 is $0.113 (rv1) and $0.110 (rv2).
- **Spend:** the review journal totals $4.172 for 889 calls and 40 runs, against the $10 cap. 882 calls were Haiku 4.5 and 7 were Sonnet. `run.cost` equals the journal sum per run, and none of the 889 calls failed.
- **Escalations:** 7, all in rv1 and none in rv2. Perspective accounts for 4 and countries for 3.
- **Latency:** mean 72 s, max 93 s per task, well inside P1's 20-minute cap.
- **`check` and the oracle:** `check` passed on all 40 runs, including the one oracle failure.

## Code review answers

- **Node schemas:** portable and narrow. They use only `type`, `enum`, `required`, `additionalProperties`, `min/maxLength` and `maxItems`, plus `['string','null']` unions. There are no `$ref`, `pattern` or `oneOf` keywords. The workflow saves and validates, and `createRun` works with the P1 subset policy: class M resolves to Haiku 5.5 and class L to Sonnet 5.5.
- **Checks:** all 8 agent nodes have checks. VENDEX has only an id-echo check; verbatim spans are enforced in code and in `check`, not at the node.
- **Escalation:** sane. M to L is the only possible step, and every escalation is logged. After the L-class retry fails, an M-declared node throws MODEL_ESCALATION_EXHAUSTED. In maps the failed item is collected into the output, and `merge` degrades with diagnostics.
- **Environment faults:** rate-limit, unavailable and timeout errors are not swallowed by `collect` or `continue`. They fail the run with their code, so P1's `envFaultRule` sees them (seen in the builder's a7 run).
- **Crash on bad model output:** only F1. In 36 adversarial runs there were no code-node errors and no timeouts.
