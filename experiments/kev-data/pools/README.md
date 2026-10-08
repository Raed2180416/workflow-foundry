# Kev judge data factory: train pools (group `train-pools`)

*Development evidence only. Nothing here trains, serves or calls a model, and nothing here is labelled by a
model. Design: [`JUDGE-PROGRAM.md`](../../../research/kev-20261007/JUDGE-PROGRAM.md) §2.4, §3.3, §1.2 R1-R4/X1/X5;
plan entry: [`JUDGE-BUILD-PLAN.json`](../../../research/kev-20261007/JUDGE-BUILD-PLAN.json) `train-pools`.*

The records bed writes its label-bearing note sentences from small template pools (R3 has 32 forms in 900
worlds). The train pools widen the **training surface** of the template-bound wave-1 ports without touching
the held-out surface:

| Port | What the pool holds | Admitted lines (current build) |
|---|---|---|
| R1 `date_order` | paraphrases of the 38 non-held-out `ORDER_NOTE` templates (ATLAS, BRIGHTDESK, VENDEX; dmy and mdy); counterfactual year-first lines (label `ymd`) for the three systems | 1,182 |
| R2 `status_meaning` | paraphrases of the 12 non-held-out `FLAG_NOTE` templates (live and void); KOBO live-flag lines | 360 |
| R3 `sign_convention` | paraphrases of the 24 non-held-out `PERSP_NOTE` templates (BRIGHTDESK, ATLAS, LEDGR, KOBO; same and opposite) | 638 |
| R4 `timestamp_reliability` | paraphrases of the 8 non-held-out `MIRROR_NOTE` / `RELIABLE_NOTE` templates; restamped lines without a date window; reliable lines with one; KOBO mirror lines | 480 |
| X1 `injected_instruction` | per train family (records, incident, synth, runbook, codefix, gameqa): positives (about 60% without addressee words), benign memos, decoys, hard negatives (about 38% of the negatives carry addressee words) | 843 |
| X5 `precondition_holds` | records assumption phrasings (the `{assumption}` slot): one clause per convention asserted | 122 |

## Files

| Path | What |
|---|---|
| `train-pools.mjs` | build, filters, statistics, the consumer API, the two-model hooks and the CLI |
| `templates.mjs` | template extraction from the **frozen** bed copy, the held-out rule, the slot vocabulary, `fillLine` |
| `filters.mjs` | the local filters: shape, copies, near duplicates, addressee words, date windows |
| `x-pools.mjs` | candidate builders for X1 and X5 |
| `authored/*.mjs` | the authored lines (data only, no imports): 1 file per logical part, `-2`, `-3` ... are top-ups |
| `train-manifest.json` | committed: digests of the authored files and of every output file, counts, balance numbers, specGaps, deferrals. No pool line text |
| `../test/train-pools.test.mjs` | the acceptance tests (`node --test experiments/kev-data/test/train-pools.test.mjs`, about 35 s) |
| `.foundry/kev-data/pools/train/{R1,R2,R3,R4,X1,X5}.jsonl`, `rejects.jsonl` | built output, git-ignored |

Rebuild: `node experiments/kev-data/pools/train-pools.mjs build` (freezes the beds into a throw-away temp
copy, writes the pool and the manifest). Both are deterministic: the same authored files and the same records
bed templates give byte-identical files.

## Line format (one JSON object per line, sorted by `id`)

```
id          'R1:ATLAS:dmy:3#012'  (template id + authored position), 'R1:CF:year-first:ATLAS#004', 'X1:records:benign#031'
port, group ('paraphrase' | 'counterfactual' | 'authored'), kind, templateId, source ('ORDER_NOTE.ATLAS.dmy[3]'), system, label
text        the sentence with placeholders ({S}, {token}, {w0}, {w1}, {field}, {year}, {ex}, ...); slots: the sorted placeholders
example     the same sentence filled with deterministic values (for readers who compare wording)
order       R1: dmy | mdy | ymd, the order {ex} is written in;  exYear: the year {ex} is written in (VENDEX fixes 2021)
windowed    R4: carries {w0} and {w1};  slotCarried: the label sits in the slot values, not in the words (below)
pairKey, pairIndex, twin   flip twin: the admitted opposite-label line of the same template index and authored position
family, sourceKind, role, addressee      X1;   assertsPort      X5 (the port whose option the clause asserts)
skeleton, percent, bucket                lib/hash.mjs skeleton of the line under the contracts' masks; always the train bucket
filters     { local: 'pass', twoModel: 'pending' }
```

`fillLine(line, values)` fills a line (`values`: `S, token, w0, w1, field, year, live_ref, void_ref, ref, server,
city_us, city_eu, ex: {y, m, d}`); `{ex}` takes the line's own `order`. `providerLists(lines, valuesFor)` turns lines
into the lists `lib/counterfactual.mjs listProvider` takes (key `<port>:<system|*>:<label>`).

**Slot-carried templates.** In 18 bed templates the two labels have the same words: the label sits in the filling
(the example date against its month name, the referenced system's order, a US or a European team city,
`{live_ref}` against `{void_ref}`). Their lines are marked `slotCarried`, share a skeleton with their flip twin on
purpose, and are only correct when filled consistently: `{ex}` in the line's order, `{city_eu}` for dmy and
`{city_us}` for mdy. `templates.slotCarried` lists them.

## What was done and what is deferred

* **Paraphrases** are written by the authoring agent from the 82 non-held-out templates; the 20 held-out bed
  templates (`ORDER_NOTE` highest index per system and order, `FLAG_NOTE` 6 and 7, `PERSP_NOTE` 3, `MIRROR_NOTE` 4,
  `RELIABLE_NOTE` 4: §3.3) are excluded from the input by id and by skeleton. The authoring agent had also read the
  source of `beds/records/render.mjs` (the held-out templates included) while taking the task in; the local filter
  therefore rejects any line that is a near copy of a held-out template (4-gram Jaccard >= 0.5) or has its skeleton.
* **Local filter** (deterministic): placeholders equal to the template's, one sentence, no literal system name,
  not a copy or a light edit of the source (4-gram Jaccard < 0.5 and unigram Jaccard < 0.85), no near duplicate
  inside a template, no skeleton shared across labels (except slot-carried flip twins), no copy of a bed sentence
  (X1: 4-gram Jaccard < 0.5 against every string of the train-family beds), skeleton bucket 40-100% (§3.1 "train
  ... skeleton buckets 40-100%"). `rejects.jsonl` keeps every rejected candidate with all reasons.
* **Two-model filter: deferred to hosted-arms.** Every line is `filters.twoModel = "pending"`. `briefsFor(line)`
  builds the zero-shot question (the port's Q0 with the line as the note; two briefs for X5), `node train-pools.mjs
  briefs --pool DIR --out FILE` writes them all, and `applyTwoModelVerdicts` / `apply-verdicts` admit a line only
  if both models recovered its label and log both answers for every rejected line.
* **Heldout registry comparison.** The committed `experiments/kev-data/heldout-manifest.json` holds the registry's
  digest and entry count, not its skeleton hashes, so `checkAgainstHeldoutManifest(lines, manifest)` reports
  `available: false` today. Where `registry.json` is readable (assembly) call
  `dropRegistryCollisions(lines, registry)`; the function also accepts any manifest that lists hashes. Nothing here
  reads `.foundry/kev-data/heldout/` (the test spies on every fs call).

## Spec ambiguities resolved here

See `train-manifest.json` `specGaps`; the main ones: "slots preserved exactly" is the multiset of placeholders
(the program lists five slots, the bed templates need eleven more: `SLOT_VOCABULARY`); "date-window presence
balanced within each label to +/- 5 pp" is read as the share of windowed lines inside each R4 label being 45-55%
and the two labels within 5 pp of each other; the addressee regex of crit-S Q14 is not printed in the critique, so
`filters.mjs ADDRESSEE_WORDS` is the explicit list used (AI, LLM, automated, automation, assistant(s), agent(s),
bot(s), chatbot(s), override forms, `SYSTEM:`); X5 is not in the plan's scope text but is in its `ports`, so a
records-assumption clause pool is provided.
