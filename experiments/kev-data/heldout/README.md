# heldout-author

Group `heldout-author` of the Kev judge data factory (`research/kev-20261007/JUDGE-PROGRAM.md` revision 2,
`JUDGE-BUILD-PLAN.json`). It writes the held-out surface material the judge ports are evaluated on: wordings,
other-register pool lines, non-deciding sentences, injection carriers, cities, unseen S5 type names and Q2 cues.

Everything the group writes goes under `.foundry/kev-data/heldout/` (git-ignored). Git carries this code,
the tests and `experiments/kev-data/heldout-manifest.json` (sha256, counts and statuses; no text).

## Isolation

The author wrote every line from `experiments/kev-data/spec/ports.json` and the program text only. The
author did not read bed generator or template source (`beds/**`, the frozen copies), the train pools, or
other groups' files. The programs that do read them are scripts that report ids and counts, never text:

- `copy-filter.mjs` reads the frozen bed copy (allow-listed files, `beds/sealed/` excluded) and the train
  pools, and writes `copy-filter.json` with ids, jaccard values and counts.
- `test/heldout-author.test.mjs` reads `TEAM_CITIES` from the frozen bed copy to check the city list.

One slip is on record: a grep for the name `TEAM_CITIES` over `experiments/kev-data` while debugging the city
test printed a handful of matching lines from `pools/templates.mjs`, `solve/records-lib.mjs` and
`pools/train-manifest.json` (placeholder descriptions and a short fallback list of team-city names). No authored
line was written or changed because of them. The copy filter and the TEAM_CITIES test also give feedback by id and
by the author's own city names, and lines or cities they flagged were rewritten or dropped.

No file under `ports/` or `taps/` may import or open the held-out directory (the test scans for it). The only
reader outside this group is the `assembly` group, through `surface.mjs`.

## Commands

```
node experiments/kev-data/heldout/author.mjs check            # lint the authored sources, print pool sizes per slice
node experiments/kev-data/heldout/author.mjs build            # write the outputs and the committed manifest
node experiments/kev-data/heldout/copy-filter.mjs             # 4-gram Jaccard <= 0.3 against bed templates and train pools; refreshes the manifest
node experiments/kev-data/heldout/author.mjs manifest         # rewrite the manifest only
node experiments/kev-data/heldout/run-filter.mjs --providers <module.mjs> [--rounds 3]   # two-model filter (hosted-arms)
node --test experiments/kev-data/test/heldout-author.test.mjs
```

Order after editing an authored source: `build`, then `copy-filter`. The copy filter rewrites the manifest because
its report is one of the hashed outputs.

## Authored sources (`.foundry/kev-data/heldout/authored/`, git-ignored)

One line per unit: `<register>[,<tag>...]@@<text>[@@<assumption>...]`. Register codes: `o` ops chat, `v` vendor
documentation, `n` non-native English, `e` email, `t` ticket, `c` changelog, `f` faq, `m` memo. Tags are
pool specific (`neg`, `tu=1|2`, `K=`, `V=`, `W=`, `ns=`, `about=`, `sys=`, `k=`). Placeholders: `{S}`, `{S2}`,
`{token}`, `{w0}`/`{w1}` (R4 windows), `{field}`, `{city}`/`{country}` (know lines only). The linter rejects
lines whose text contradicts their label (an R1 example date of the wrong order, an R4 window with only one
bound, an X5 pair without both assumptions) and near-duplicates inside a pool.

Layout: `wordings/<port>.txt`, `R1/{dmy,mdy,ymd,know}.*`, `R2/{void,live}.*`, `R3/{same,opposite}.*`,
`R4/{reliable,restamped}.*`, `X1/{yes,no}.*`, `X5/{assumptions,pairs,not_stated}.*`, `X8/conventions.*`,
`nondeciding/R1-R4.*`, `carriers/<port>.*`, `cities.*`, `S5/unseen.*`, `Q2/{cued,plain}.*`.

## Outputs (`.foundry/kev-data/heldout/`)

- `wordings.jsonl`, `wordings.json`: 40 per wave-1 port (10 calib-OOD, 10 dev-OOD, 20 test-OOD).
- `surface/<port>.jsonl`: units `{id, port, role, label, slice, status, text, register, systems, tags, hard, features,
  skeleton, source, filter, ...}`. `role` is `decisive`, `nondeciding`, `carrier`, `knowledge`, `type-name` or `cue`.
  `status` is `pending-filter` (selected, waiting for the two-model filter), `admitted`, `reserve`, `rejected` or
  `carrier`. `slice` comes from the skeleton hash: below 50 percent test-OOD, below 80 percent dev-OOD, else
  calib-OOD, so a masked form is in one slice only.
- `cities.json`, `registry.json` (skeleton hashes by slice, no text; `build.mjs` `loadHeldout` reads it with
  `wordings.jsonl`), `reject-log.jsonl`, `copy-filter.json`, `manifest.json`.

## Two-model filter and top-up (not run by this group)

`filter.mjs` is the harness: a unit is admitted only if Sonnet 5.5 and Opus 5.5 both recover the brief's label for
every request the unit implies; rejects are logged with both answers; `run-filter.mjs` promotes reserve units and
keeps class mixes (R4 window balance, X1 addressee shares). No model is called here. Until the hosted-arms group
runs it, selected lines have status `pending-filter` and none is `admitted`. Shortcut-audit top-up requests are
answered by adding lines tagged `tu=1` or `tu=2` (at most two rounds); they are forced into the selection.

## Spec readings

- "Other registers": the three named registers (ops chat, vendor documentation, non-native English) hold at
  least half of every label's selected lines, each at least 10 percent; the five others fill the rest.
- Wording "none equal to Q0-Q3": equal after whitespace normalisation and case folding, and also word 3-gram
  Jaccard below 0.6 against each of Q0-Q3.
- "Year-first lines for BRIGHTDESK, ATLAS and VENDEX": year-first lines are written with `{S}` so any system fills
  them; about a dozen per system name that system. In every slice at least 80 percent of the selected year-first
  lines can be filled with each of the three systems.
- R4 window decoupling: within each label and slice half the selected lines carry both window bounds and half carry
  none, so the window is not a label cue.
- X5 `not_stated` units: at least 50 percent presence-matched (a same-register sentence about another system or
  convention), absent-system at most 10 percent.
