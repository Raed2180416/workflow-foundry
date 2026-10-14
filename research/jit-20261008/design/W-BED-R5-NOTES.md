# W-bed R5: what landed

*2026-10-09, laptop session. Cost $0: no model calls. `beds/sealed/` was not read. Nothing under `src/`, `experiments/`,
`policy/`, `schemas/`, `bin/`, `skills/` or any bed outside `beds/wbed/` was changed, and no existing W-bed export
changed behaviour. Design reference: [W-BED.md](W-BED.md) §2, §3.4, §3.5, §3.8, §5, §6, §8, and
[FLOW-V3.md](FLOW-V3.md) §2.2. Conventions follow [W-BED-R4-NOTES.md](W-BED-R4-NOTES.md),
[W-BED-R1-NOTES.md](W-BED-R1-NOTES.md) and [W-BED-R2R3-NOTES.md](W-BED-R2R3-NOTES.md). Tags: **[M]** means measured
here or read in the repo, **[I]** means inference.*

## 1. Files

| path | what |
|---|---|
| `beds/wbed/r5/index.mjs` | family `wbed-r5` v1.0.0 "legacy dump". The bed interface plus `stages`, `relations`, `composedOracle`, `referenceTrace`, `structure`, `invariants`, `necessityControls`, and the R5-specific `verifyPredicate`, `restoreInputs`, `dumpOf`, `childTask`, `CATALOGUE`, `formatOf`, `sizeOf`, `taskTokens` |
| `beds/wbed/r5/world.mjs` | `LEVELS`; `dumpLayer` (rows, extra records, trailer, encode, decisiveness re-draw) and `buildDump` (R4 world + the dump layer) |
| `beds/wbed/r5/catalogue.mjs` | the 11 formats, the tiers and the draw rule (`classOf`, `poolOf`, `formatOf`) |
| `beds/wbed/r5/formats-dev.mjs` | dev formats: fixed-width, code-page, jsonl-versions, monthly-csv (encoder, README prose, white-box decoder, the format's misreading) |
| `beds/wbed/r5/formats-wild.mjs` | wild formats: copybook-overpunch, keyed-stanzas, decoder-tool |
| `beds/wbed/r5/formats-novel.mjs` | novel formats: column-store, print-image (split dev, d5); hex-masked, tagged-dictionary (split test, d5) |
| `beds/wbed/r5/decoder-tool.mjs` | the shipped `decoder.mjs`; its text is built from the same functions the bed runs (tested by a `data:` import and by running it as a command) |
| `beds/wbed/r5/common.mjs` | system codes, the key=value trailer, README framing and vagueness |
| `beds/wbed/r5/decode.mjs` | the decode stage under the truth and every mistake; `verifyPredicate`; row multiset comparison |
| `beds/wbed/r5/pipeline.mjs` | the exact solver as stages; `r1TraceOnRows` (R1's normalise and report over decoded rows) |
| `beds/wbed/r5/score.mjs` | `outputSchema` (R4's plus `dump`) and the exact end-to-end scorer |
| `beds/wbed/r5/stages.mjs` | the decode stage contract and oracle, relations D1–D3, `composeOracle` |
| `beds/wbed/r5/controls.mjs` | decode controls, the relation control, the necessity control |
| `beds/wbed/r5/restore.mjs` | decoded rows back to the pack's R1 invoice lists (`invoiceListsOf`, `restoreInputsOf`) |
| `beds/wbed/r5/r5.test.mjs` | 22 oracle-health tests |
| `beds/wbed-r5/index.mjs` | one-line registration shim; `loadFamily('wbed-r5')` works (tested) |
| `beds/wbed/lib/legacy.mjs` | **new helper module** (additions only): row shape, `trailerOf`, `codeSum`, overpunch, number words, masked hex, CSV, major-unit amounts |
| `beds/wbed/attacks/triviality.mjs` | **modified**: rung table gains `r5` (gate: one call ≤ 2/12; necessity: code parsers for the dev formats only) |

No existing lib file changed. Seeds: the `wbed-dev` rows (dev 301–390) and the held-out blocks of `SEEDS-LEDGER.json`
that already list wbed-r5. Tests use dev 301–320, R1 packs at child seeds of parents 301–320, held-out 8201–8202 and
8301–8302, and a format-draw scan over dev 301–390 and held-out 8201–8524; the attack plan uses 379–390.

Run with `/opt/node24/bin/node --max-old-space-size=1024 --test --test-concurrency=2 'beds/wbed/**/*.test.mjs'`.
Result: §12.

## 2. The task

An R5 task is the R4 task at the same `(seed, split, difficulty)`: the same group, the same children and the same
intercompany layer. One unplanted receivables subsidiary (a seeded pick) could not produce its billing exports. Its pack
loses `inputs.invoices` and gains `dump: "files/dump/<sub>/"`. The task's `files` hold a legacy dump of the invoice records of all
its billing systems, drawn per task from 11 text encodings. Some records are not invoices of the ledger: deleted or
struck records, void copies, re-sent duplicates and superseded versions (1–4 by difficulty). A trailer gives the record
count and control totals. The solver decodes the dump into rows of R1's extract-stage invoice shape (invoice, system
name, customer row id, the date *as printed*, currency, amount in the smallest unit, status text verbatim). It reports
those rows as `dump.rows`, closes the pack from them as an R1 close, and consolidates as in R4. Every other subsidiary,
the register, the schedules, the group notes and the group spec are R4's byte for byte (tested). `inputs.dump_spec` and
one prompt paragraph are new.

## 3. The format catalogue

| format | where the layout is described | tier | drawn at | split | its misreading (control) |
|---|---|---|---|---|---|
| fixed-width | README prose only: column ranges (vagueness 0), sentences (1) or widths in words in field order (2) | dev | d2–d4 | dev + test | `fixed-width-off-by-one` |
| code-page | `CODEPAGE.TXT` escape table (per-task shuffle of `^HH` → code point) + README field order | dev | d2–d4 | dev + test | `codepage-standard` |
| jsonl-versions | README (both schemas) + in-band schema lines (1–2 switches) | dev | d2–d4 | dev + test | `schema-switch-ignored` |
| monthly-csv | each file's header + README synonym list (2–4 header layouts across months) | dev | d2–d4 | dev + test | `header-drift-mismapped` |
| copybook-overpunch | `INVREC.CPY` COBOL copybook + README sign convention | wild | d2–d4 | dev + test | `overpunch-ignored` |
| keyed-stanzas | README (keys, continuation rule) | wild | d2–d4 | dev + test | `continuation-dropped` |
| decoder-tool | shipped `decoder.mjs` + README prose (flags: run number as key, field layout number) | wild (grade 2) | d3–d4 | dev + test | `decoder-wrong-flags` |
| column-store | `MANIFEST.TXT` (file → field) | novel-dev | d5 | dev | `manifest-ignored` |
| print-image | printed column headings and rulers on every page + README (ditto marks, struck lines, page totals) | novel-dev | d5 | dev | `ditto-literal` |
| hex-masked | README prose (XOR mask byte, separator byte, field order) | novel-test | d5 | test | `mask-not-removed` |
| tagged-dictionary | `FIELDS.DIC` (tag number → field, per-task numbering) | novel-test | d5 | test | `dictionary-ignored` |

Every format is a deterministic encoder from R1 rows (plus the extra records and the trailer) to `{name: text}` with
README prose. Each also has a white-box decoder that reads only the files; per-task parameters come from the README, a
code table, a copybook, a manifest or a dictionary. On all 220 dumps of the catalogue test (11 formats × 20 R1 packs ×
vagueness 0–2), and on every R5 task generated, the decoder reproduces the generator's rows and trailer exactly
[M]. So every dump is decodable from its files alone.

**The draw rule** (`catalogue.mjs`):
- class = `novel` at d5; else `dev` when seed mod 3 = 0; else `wild`.
- pool:
  - `dev` → the 4 dev formats;
  - `wild` → the wild formats of grade ≤ 1 at d2 and of grade ≤ 2 at d3–d4;
  - `novel` → `novel-dev` on split dev, `novel-test` on split test.
- One seeded pick, `rng('wbed','r5','format', split, seed, d, 0)`. It is fixed across generator re-draws.

What follows by construction (tested on dev 301–390 and held-out 8201–8524):
- no novel format at d ≤ 4;
- the d5 pools of the two splits are disjoint from each other and from every d ≤ 4 format, so a held-out d5 task
  carries a format no dev task ever carries;
- at d2–d4, exactly the seeds with seed mod 3 ≠ 0 carry a non-dev format (60 of dev 301–390 at each difficulty).

## 4. Oracle composition

**End-to-end** (`scoreDump`). It passes only if all three hold:
1. `dump.rows` equals the generator's rows as a multiset (order free; one row per invoice record);
2. `dump.sub_id` names the dump subsidiary;
3. R4's own oracle passes on the rest of the answer. That covers every pack by its own rung, including the dump pack's
   R1 oracle on the original R1 task, plus balances, eliminations and the consolidated block.

The output schema is R4's plus `dump {sub_id, rows[]}`.

**`composedOracle(task, trace)`** is the AND of:
- the **decode stage oracle**: rows exact and trailer exact;
- **D1 trailer count**: decoded count = trailer records;
- **D2 control totals**: `verifyPredicate` on the decode hand-off;
- **D3 rows carried**: the report's `dump.rows` = the decode rows, the dump pack's child trace consumed exactly those
  rows (`extract.invoices`), and the dump subsidiary is named;
- **R4's composed oracle**: every child's composed oracle by its own rung, R4's parent stages, W1–W4.

The tests check, on dev 301–302 at every difficulty, that the composed oracle passes on the reference trace and agrees
with the end-to-end oracle on every control's trace and on the necessity control's [M].

**How a decode mistake propagates.** `r1TraceOnRows` re-runs R1's normalise and report over the decoded rows. A row
identical to a pack invoice is that invoice. For any other row:
- its date counts only if it is a date that billing system printed;
- an unknown status word does not count;
- a currency without a quote does not count;
- duplicate invoice numbers count twice.

On the true rows it gives R1's own answer (tested). So a control's whole answer is what that misreading produces end
to end, not just a wrong `dump.rows`.

## 5. Controls

**Bad controls: 34 defined.** At most 25 apply to one task: 21 at d2, 23 at d3, 24 at d4, 25 at d5 (mean per task over
dev 301–320) [M].
- **R4 inherited (19).** R4's controls with the true decode and `dump` added. `empty` gets empty rows. These include
  `empty`, `shuffled-or-corrupted` and R4's seven relation controls. They fail at R5 because R4's oracle fails.
- **Generic decode controls (4, every format):**
  - `decoys-kept`: the excluded records decoded as invoices;
  - `trailer-as-row`;
  - `totals-forced`: the excluded records kept, then as many genuine rows dropped from the end, so the count matches;
  - `amount-units-misread`.
- **Format misreadings (11, one per format; table in §3).** Each runs the format's own decoder with that misreading
  switched on, so its output is what such a reader gets. It applies only to tasks of its format, as R4's controls apply
  from a minimum difficulty.
- **Relation control (1):** `dump-rows-raw-reported`. The pack is closed from the right rows, but the answer reports
  the raw decode as `dump.rows`. It passes the decode stage, every R4 stage and every child, and fails only D3 (tested).

**Decisiveness.** The dump layer is re-drawn until every applicable decode mistake changes the decoded rows. Re-draws
needed: 0 on dev 301–320 at d2–d5, and 0 on the 220 catalogue dumps [M]. So far every misreading is decisive on its
first draw.

**Coverage.** Each format misreading changes the rows of all 20 R1 packs in the catalogue test, so every control fails
on ≥ 20 tasks. On R5 tasks, every applicable control fails on dev 301–320 at every difficulty [M].

**Necessity control** `necessity:dev-parsers-only` (W-BED §2.4 item 3). This is the R4 reference plus code parsers for
the four dev formats, and no agent node:
- on a dev-format dump it decodes right and passes (tested: every dev-format task);
- on any other dump there is no parser, so the rows are empty and the pack is closed with no invoices. R4's own oracle
  then fails as well (tested).

Failure share [M]:

| d | dev 301–320 | why |
|---|---|---|
| 2, 3, 4 | 14/20 fail each (70%) | seeds 303, 306, …, 318 are the dev-format tasks |
| 5 | 20/20 | every d5 task carries a novel format |

Attack seeds 379–390 at d3: 8/12 fail. The driver's stub verdict line prints "gate fails" because `runStub` applies the
one-call gate (≤ 2/12) to every stub. For the necessity control the criterion is ≥ 50% failing, which 8/12 meets.

## 6. The verify predicate and its miss rate

`verifyPredicate(rows, trailer)` has the FLOW-V3 §2.2 shape: `null` when it holds, else a reason. It requires all of:
- the record count;
- the sum of the customer row ids;
- the amount total per currency (smallest unit; the currency key sets must match);
- the four text hash totals: code-point sums of the invoice numbers, system names, printed dates and status texts.

It accepts the truth on every task [M].

**Measured miss rate.** A miss is a wrong decode that still satisfies the trailer. Two cases are measured:
- **own trailer**: each misreading also reads the trailer its own way, which is what an agent node would hand its
  verify;
- **true trailer**: the trailer as it really is.

| measured over | wrong decodes | full predicate: own / true trailer | without hash totals: own / true trailer |
|---|---|---|---|
| catalogue: 11 formats × 20 R1 packs × 5 mistakes | 1,100 | **0** / 0 | 16 / 19 |
| R5 tasks: dev 301–320 × d2–d5 × 5 applicable mistakes | 400 | **0** / 0 | 18 / — |

W-BED §3.5's falsifier allows at most 1 miss in 20 agent-node runs. The full predicate misses 0 of 1,500 [M].

**What the hash totals buy.** Without them, the misses are all `continuation-dropped`: 16 of 20 keyed-stanza packs.
Dropping continuation lines cuts dates and status texts but, on those packs, no number. So count, row ids and amounts
still tie out. On R5 tasks keyed-stanzas is the most common wild format, so a count-plus-amounts predicate would miss
about one keyed-stanza task in 1.25.

Two misreadings fail even the weak predicate for structural reasons:
- `codepage-standard`: the escaped separators inside the trailer garble its amount pairs;
- `overpunch-ignored`: Σ⌊aᵢ/10⌋ ≠ ⌊Σaᵢ/10⌋ once a currency's last digits sum past 9.

This is why the trailer carries hash totals (deviation 4).

## 7. Measured sizes

**Dump tokens per format** (utf8 bytes / 4; R1 packs at child d3/d4, 20 packs each; mean, min–max) [M]:

| format | tokens |
|---|---|
| fixed-width | 4,589 (3,002–5,853) |
| code-page | 4,766 (3,834–5,679) |
| jsonl-versions | 7,193 (5,255–9,420) |
| monthly-csv | 3,280 (2,692–3,853) |
| copybook-overpunch | 4,547 (3,186–5,789) |
| keyed-stanzas | 5,235 (4,072–6,477) |
| decoder-tool | 3,511 (2,960–4,051) |
| column-store | 3,037 (2,440–3,629) |
| print-image | 5,072 (3,770–6,347) |
| hex-masked | 5,086 (4,020–6,161) |
| tagged-dictionary | 6,209 (4,874–7,587) |

**R5 tasks, dev 301–310** [M]:

| | d3 | d4 | d5 |
|---|---|---|---|
| dump tokens, mean (min–max) | 3,760 (3,200–4,351) | 6,042 (4,104–8,283) | 4,368 (3,348–6,314) |
| invoice rows / extra records | 165 / 2 | 243 / 3 | 239 / 4 |
| inline task tokens, mean (max) | 44,571 (45,708) | 97,334 (101,576) | 153,172 (157,006) |
| R4 inline, for comparison (R4-NOTES §7) | 43,259 | 95,020 | 152,531 |

The dump replaces the pack's invoice lists (about 4–6K tokens) and adds a dump of similar size plus `dump_spec`
(about 600 tokens). So R5 is about +1–2K tokens over R4 at every difficulty. Attack seeds 379–390 (driver dry run):
- d3: mean 45,105, max 48,846;
- d4: mean 97,410;
- d5: mean 154,204, max 157,549 [M].

**Runtime.**
- R5's own generation cost on top of R4's group draw is 65–200 ms at d5 [M].
- The CONTRACT's 2 s limit is set by R4's group draw. That took 2.4–2.8 s cold today with a load average of about 34
  on this laptop (R0 running), against R4-NOTES' 0.6 s.
- The R5 runtime test therefore times R4's draw separately and asserts the R5 increment < 1 s and the oracle < 2 s.

## 8. Cost estimates

Base figures are as in R4-NOTES §8: Haiku 5.5 list $0.10 in and $0.50 out per MTok, and about $0.00011 per tiny judge
call through claude-cli.

| arm, per R5 task | d3 | d5 |
|---|---|---|
| one Haiku call, token-priced (driver: 24 calls) | ≈ $0.015 ($0.365 per 24) [M] | ≈ $0.036 ($0.869 per 24) [M] |
| triviality attack total, list | $0.365 (d4 $0.635) [M] | $0.869 [M] |
| agent node `decode-dump` (Haiku, Bash/Read/Write; reads a 3–9K dump and a README, writes and runs one parser, about 8–15 turns at 10–20K context) | $0.02–0.06 [I] | same; novel formats nearer the top [I] |
| reference (arm c) = R4 reference + one agent node + restore | ≈ $0.05–0.16 [I] | ≈ $0.14–0.31 [I] (W-BED §3.5: $0.15–0.45) |
| compiled after sub-compile (dev/wild formats served by a compiled decoder; agent only on refusal) | ≈ R4 compiled + $0 [I] | + one agent node per novel task [I] |

The driver's "measured overhead $0.62–0.72" is the R1 per-call constant (R4-NOTES §8). At d4–d5 the token price
dominates.

The W-BED §3.5 Haiku-agent estimate ($0.5–1.0) is probably low at d5, for the same reason as R4: a 150K-token task
is re-read on every turn [I].

## 9. Deviations from W-BED.md, and why

1. **Three tiers, not two.** W-BED asks two things of the necessity control:
   - it must fail ≥ 50% of tasks by construction;
   - it must pass on dev-format tasks, so the control is plausible.

   With only "dev" and "novel" formats, and novel formats only at d5, every d ≤ 4 task would carry a dev format and the
   control would pass everywhere below d5. So d2–d4 also draw **wild** formats. They are seen in dev streams, so they
   recur and can be compiled. The necessity control has no parser for them, which stands for a reference author who
   wrote parsers for the formats in the fixtures. The split dev/wild is by seed mod 3.
2. **The answer carries the decoded rows** (`dump.rows`). The oracle W-BED states ("the decoded rows exact, then the R4
   oracle") needs them in the output. Without them a decode error that happens not to change the R1 answer would go
   unscored.
3. **Rows are R1's extract-stage invoice records**, with surface dates and status texts, not normalised values. The
   dump replaces only the invoice lists. The customer export, bank feed, ledger notes and spec stay as R1 inputs. So the
   R1 solver's date and status judgment is unchanged, and the agent node decodes containers, not business rules. The
   cost: the reference needs a restore step (rows back to list lines). The bed exports it, and it is tested
   line-equivalent.
4. **The trailer carries hash totals over the text fields.** W-BED says "row count and control totals". With count,
   row ids and amounts only, text-only misreadings pass: 16 of 1,100 catalogue decodes, 16 of 20 keyed-stanza packs
   (§6). That would break the W-BED §3.5 falsifier on keyed-stanza tasks by construction, not by agent behaviour.
5. **Format-specific controls apply to their format only** (`applies(task)`, like R4's `minDifficulty`). The CONTRACT
   asks that every control fail on ≥ 20 seeds. For format controls this is met on 20 bare R1 packs per format in the
   catalogue test, plus every R5 task of that format. It is not met on 20 R5 tasks per format: dev formats are drawn on
   one seed in twelve, so that would take about 240 R5 tasks at roughly 1 s each.
6. **The necessity control outputs empty rows and a pack closed with no invoices.** It does not deopt. This is the
   best-effort answer of a parser-less reference, and it keeps the control scoreable. A deopting reference fails the
   task either way.
7. **Novel pools are two formats per split.** W-BED says only "a format never seen at d ≤ 4". Two per split give the
   held-out run variety without sharing anything with dev.
8. **Format difficulty within d2–d4.** The grade-2 wild format (decoder-tool) is drawn from d3. At d2 only grade-1
   formats appear.
9. **Runtime limit** (§7): the R5 increment is asserted, not the cold total, because R4's group draw sets the total and
   depends on machine load.
10. **The R1-on-wrong-rows model** (`r1TraceOnRows`, §4) affects only control outputs. Those fail on `dump.rows`
    anyway. It exists so that each control's whole answer, and its trace for the composed oracle, is a real
    consequence of the misreading.

## 10. What the agent node needs (extends R4-NOTES §10, items 1–9 not repeated)

These are the exact `flow.agent` behaviours that the R5 reference (arm c) and the JIT arm need from FLOW-V3 §2.2.
None is built yet. Each is an engine change for the E2 freeze.

10. **The verify predicate's context must include the dump files.** FLOW-V3 §2.2 sketches
    `verify(rows, ctx)` against `ctx.manifest.rowCount` and `ctx.manifest.controlTotal`: values the parent already
    holds. R5's trailer is not parent-held. It is inside the dump, in the dump's own convention (a T record, a
    `#TRAILER` CSV line, a copybook TRL-REC, a `***` print block, a masked hex record). Only a decoder can read it.
    - The R5 reference has the agent return `{rows, trailer, trailer_quote}`.
    - The verify is `verifyPredicate(rows, trailer)`, plus a check that `trailer_quote` occurs verbatim in a dump
      file.
    - Needed: `ctx.files`, read-only texts of the file handles passed to the agent, and a `returns` schema that
      admits the trailer object.
    - Measured: a misreading that also misreads the trailer the same way is never missed with the full predicate
      (0/1,500). It is missed 16/1,100 times without the hash totals (§6). So the verify is only as strong as the
      totals the bed puts in the trailer.
11. **A retry must carry the verify's reason.** FLOW-V3 retries once with a fresh nonce. A decoding mistake is usually
    deterministic: the same misreading of the same README repeats. Needed: the retry's instructions get the reason
    string, for example "record count 150 != trailer 148", or "hash total date_text 81234 != trailer 80711".
    `verifyPredicate`'s reasons are written for this.
12. **The input profile must see `files`, not only `inputs`.** The compiled decoder must refuse an unseen format so
    that the agent falls back:
    - the JIT angle of W-BED §3.5;
    - the d5 novel formats force this;
    - on split test the novel format is new to every dev stream.

    The slice-1 `profile.mjs` learns over `{prompt, inputs}`, but the dump is in `task.files`. Needed: profile features
    over a file map (file names, README fingerprint, first-line and record-type shapes, separator and escape
    statistics). This is the R5 analogue of R4's outside-profile plant. The reuse measure is "compiled decoder refuses
    every novel-format dump and serves every recurring-format dump".
13. **A harvested-parser compilation path keyed by format.** `interpret.mjs` harvests scripts per agent session. For a
    sub-compile, the node needs:
    - (a) the harvested scripts grouped by the format they ran on (the profile cluster of item 12);
    - (b) a callee contract whose input is the file map (12–40 KB of text here; the dump is 3–9K tokens) and whose
      output is `{rows, trailer, trailer_quote}`;
    - (c) the **same verify at the call site** for both paths, so that a compiled decoder that misreads a drifted
      dump deopts to the agent. That means `flow.call(…, { verify })`, or a rule that the parent applies
      `verifyPredicate` after either path.
14. **Dump-shipped code runs only in the agent sandbox.** The decoder-tool format ships `decoder.mjs`. The agent runs
    it, which is fine: it is synthetic text, D10 holds, and the sandbox is `runClaudeCode`'s. A compiled callee
    harvested from that session would `node decoder.mjs` a file from the task input. Needed: a policy that a compiled
    callee never executes code from its input files. The compile prompt must port the logic, or the call must refuse
    and fall back to the agent. Today nothing distinguishes data files from code files in a handle.
15. **Budget.** One agent node per R5 task, so the 2-concurrent and 16-per-run limits do not bind. Its `budgetUsd`
    (about $0.10–0.30 reserved) comes out of the same parent `perTaskUsd` that R4-NOTES §10 item 5 already says must
    cover K child calls. Needed: `perTaskUsd(R5) ≥ perTaskUsd(R4) + agent reservation`.
16. **Isolation.** The agent gets only the dump directory and `dump_spec`. It does not get the other packs, the pack's
    ledger notes or the group inputs: decoding needs none of them. The nested-model and hidden-path scans of FLOW-V3
    §2.2 apply unchanged. The README contains no instruction-like text in v1; R8's f3 hook is where adversarial README
    lines would enter (round 2).
17. **The trace must expose the agent's value as the decode hand-off.** The composed oracle scores `trace.decode`. The
    reference should name the node `decode-dump`, and `stream.mjs` must write the `agent-end` value under that span
    name, as R4-NOTES item 6 asks for `childId`.

## 11. Open questions

- Is seed mod 3 the right dev share? It makes 1/3 of d2–d4 tasks dev-format, so a JIT arm meets each dev format about
  once in 12 tasks and each wild format about once in 5 (keyed-stanzas and copybook are the most frequent).
- Should the arm (c) reference ship code parsers for the dev formats with the agent as fallback (the compiled shape),
  or call the agent on every dump? The first is the "LangGraph engineer's graph". The second sets the agent-every-time
  baseline cost.
- The weak-predicate result (§6) suggests that a JIT-written verify, if the compiler chooses it, may omit hash totals.
  The bed could report that verify's recall per format from the stage oracle. This is analyst-side, as W-BED §2.2 item
  3 requires.

## 12. Test run

Full W-bed suite (`beds/wbed/**/*.test.mjs`, concurrency 2, with R0 running in the background at a load average of
about 34): **127 tests, 127 pass, 0 fail**, 348 s. The 22 R5 tests are among them, and every R0–R4 test stays green
[M]. In this run the d5 cold timing was R4 group draw 2,145 ms, R5 increment 45 ms, oracle 41 ms.

**Addendum (2026-10-14, refs-R1-R3 review fixes): wbed-r5 1.0.1.** R5 itself is unchanged. Groups with an R3 pack follow
wbed-r3 1.1.0 through wbed-r4 1.0.1 (FX quotes stored at their printed precision, W-BED-R2R3-NOTES §10): 67 of 120 task
hashes moved on dev 301–330 × d2–d5. The R5 suite passes.
