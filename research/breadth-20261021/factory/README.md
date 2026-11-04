# Family factory prototype for node V (T1-4): results, 2026-11-04

Plan: `research/breadth-20261021/PLAN.md` §4.3 T1-4, §6. Code: `experiments/breadth/factory/README.md`. Everything below
is **development evidence at $0**, run by the session that wrote the families (Opus 5.5). No model was called, no V arm
has run, no sealed stream was read, and nothing here is a capability number for any arm.

## What exists

| Item | State | Evidence |
|---|---|---|
| D16 acquisitions (holidays 0.107, Hypothesis 6.170.5, UCI 498 zip, ProcureChange P2P JSON) | done, hash-pinned, recorded; UCI CSV deleted after parameter extraction | `ACQUISITION.md`, `../DISPOSALS.md`, `params/` |
| B0 shared harness `experiments/autobench/abr/lib` | extracted (131 byte-identical definitions in 12 families); import check 12/12; targeted equivalence 12/12 identical; **the plan's full gate-JSON falsifier not completed** (about 24 CPU-hours on a machine at load 25-35) | `b0/B0.md`, `b0/*.json` |
| `family.spec` compiler | POLICY.md + compiled.json (attribution, hard clauses, control roster, G0 static lint) from one spec; generated controls per clause and per trap | `abr/lib/factory/spec.py`, `controls.py` |
| Three V families | `abr-reg-incident-clock` (A3 statute-derived clocks), `abr-itsm-queue` (A1 UCI-calibrated), `abr-p2p-audit` (A2 clean population + injected violations); each with 4-week streams, a month-end, a week-3 policy edition, look-alike/authority/stale/replay traps, messy intake | `experiments/autobench/families/abr-*/` |
| Seed block and frozen split | 8850-8873 sealed, 8874-8999 held-out, 2101-2160 dev registered in SEED-LEDGER.json **before any generator existed** (commit 441edc0a); hash rule over seed numbers only | `SPLIT.json` sha256 `d7ed9e49…c5f6` |
| 24 sealed streams | generated host-only (3,394 triggers), hashes committed, reproducible (`seal.py --verify`) | `SEALED-HASHES.json` sha256 `0128e3d8…0546` |
| Gates G0-G12 | run by the author (not admission evidence); G8/G9/G11 paid or need another session | `gates-author/` |
| B4 distinctness | all three distinct at τ = 0.35; the itsm swap rule does not fire | `B4-distinctness.json` |
| Scripted $0 baselines | reference + null/echo/naive/memoryless on 8 dev streams per family | `baselines/` |
| PREREG-V-1 | **draft, not frozen** (blockers F1-F6) | `PREREG-V-1.md` |

## Gates G0-G12, author-run (development evidence; admission needs a session that did not write the families)

AutomationBench venv, dev seeds 2113-2116, practice 2101-2104; JSON in `gates-author/` (aggregates only).

| Gate | reg-incident-clock 0.1.0 | itsm-queue 0.1.0 | p2p-audit 0.1.1 |
|---|---|---|---|
| G0 spec lint (+ every clause exercised) | pass | pass | pass |
| G1 determinism + WorldState round trip | pass | pass | pass |
| G2 solvability (reference on 8 streams) | pass, 100% | pass, 100% | pass, 100% |
| G3 necessity (each expected effect's removal caught; no decorative clause) | pass, 125/125 | pass, 313/313 | pass, 191/191 |
| G4 N-version agreement | 379/379 | 935/935 | 421/421 |
| G5 controls: every control detected; null = no-op share; echo 0; memoryless < 0.90 and no clean week | pass | pass | pass |
| G5 bar "naive < 0.60 per trigger" | **missed** (0.77) | **missed** (0.72) | **missed** (0.84) |
| G5 proposed OD-F1 "naive < 0.60 on acting triggers, zero clean weeks" | met (0.00) | met (0.03) | met, narrowly (0.58) |
| G6 trap validity (each kind >= 5 exposures, its control fails there, reference passes) | pass, 9 kinds | pass, 7 kinds | pass, 7 kinds |
| G7 metamorphic (rename, +7 d, +364 d) | pass; permutation not built | pass; permutation not built | pass; permutation not built |
| G8 blind arm | pending (paid; runner mode not built) | pending | pending |
| G9 second reader | pending (another session) | pending | pending |
| G10 mutation score; policy-neutral variants; ab_disagree | 0.996 (777/780); 110/110; 0 | 0.997 (1,777/1,783); 302/302; 0 | 0.999 (862/863); 139/139; 0 |
| G11 differential tier | pending (paid, optional) | pending | pending |
| G12 leakage + abr-apply = app path | pass; 191 triggers, 0 diffs | pass; 492, 0 | pass; 212, 0 |

Build history the gates forced (each fix at its cause): world shape (WorldState adds `no_same_sender_noise`; Slack
timestamps without zero microseconds); the app path's full-app dumps compared like with like; a mutation operator that
assumed a pre-existing Slack message; p2p's quiet-clause control did not exist (A6 was "decorative" until the reference
grew an `eager` switch); p2p's replay trap was exposed 4 times on 4 dev streams, so a second duplicate injection was
added (generator 0.1.1, re-sealed before any arm or read).

## Parity (the factory's analogue of "our adapter scores like the benchmark's own evaluator")

Node V has no external evaluator: the families are ours, so parity is established three ways, all $0.

1. **N-version truth vs observable-only reference (G4).** The truth engine computes expected effects from latent
   typed state; the reference reads only tool-visible state, parses everything itself and shares the spec, not code.
   Agreement on every dev trigger tried: reg 1,133/1,133 (12 streams), itsm 2,804/2,804 (12 streams), p2p 1,248/1,248
   (12 streams, generator 0.1.1); 0 hard violations. Three real disagreements surfaced during the build and were fixed at their cause,
   not by loosening the oracle: an ambiguous retraction test in the reg policy text (a newsletter mentioning "retract"),
   sub-second latent times in the itsm generator, and pre-stream payments counted in the p2p end table.
2. **The benchmark's own handlers (G10 `ab_disagree`).** AutomationBench's AssertionRegistry, run on every passing
   reference trigger as a cross-check: 0 disagreements on every family (`gates-author/`, G10).
3. **abr-apply vs the app's own model path (G12).** The fast WorldStore path and AutomationBench's tool path
   (bridge.Rollout, `api_fetch`, determinism shim) produce the same world after every trigger, generated ids and clocks
   masked, and the reference passes every trigger on the app path too: reg 191, itsm 492, p2p 197 triggers compared, 0
   differences each.
4. **Golden tests from public rule text**: 9 reg cases (NIS2 Art. 23(4) hours; Reg. 1182/71 Art. 3(2)(c) month clipping
   incl. 31 Jan -> 28/29 Feb; Art. 3(4) weekend and holiday roll, incl. Good Friday + Easter Monday), each checked against
   both the clock engine and the reference's own arithmetic; 5 p2p tolerance and quantity cases (incl. half-up limit
   rounding); itsm matrix and pause cases plus the UCI-mined P3/P4 thresholds (91.68 h, 328.53 h). Hypothesis 6.170.5:
   4 properties of the clock engine, 400 examples each, pass; the frozen holiday table equals holidays 0.107.

## Scripted $0 baselines (8 dev streams per family, seeds 2113-2120, carry mode, fast path)

| Family | Solver | Clean streams | Clean weeks | Pass rate | No-op share | Hard violations |
|---|---|---|---|---|---|---|
| reg-incident-clock | reference | 8/8 | 32/32 | 1.000 | 0.803 | 0 |
| | null / echo | 0 / 0 | 0/32 / 0/32 | 0.793 / 0.000 | | 603 / 603 |
| | naive (<= 40 lines) | 0 | 0/32 | 0.786 | | 601 |
| | memoryless | 0 | 0/32 | 0.379 | | 952 |
| itsm-queue | reference | 8/8 | 32/32 | 1.000 | 0.718 | 0 |
| | null / echo | 0 / 0 | 0/32 / 0/32 | 0.716 / 0.000 | | 976 / 976 |
| | naive | 0 | 0/32 | 0.721 | | 938 |
| | memoryless | 0 | 0/32 | 0.626 | | 7,531 |
| p2p-audit (0.1.1) | reference | 8/8 | 32/32 | 1.000 | 0.650 | 0 |
| | null / echo | 0 / 0 | 0/32 / 0/32 | 0.640 / 0.000 | | 1,198 / 1,198 |
| | naive | 0 | 0/32 | 0.837 | | 470 |
| | memoryless | 0 | 0/32 | 0.890 | | 2,700 |

Reading: per-trigger rates mostly measure the quiet share of a stream (null passes 0.64-0.79); the headline is the
clean stream, which no control reaches. The p2p naive control passes 0.84 per trigger because most invoices in a clean
population are simply approved; it still keeps no clean week. That is why PLAN §6.1 makes clean periods and hard
violations the headline, and why G5's per-trigger naive bar is missed (PREREG-V-1 F2, OD-F1).

## Messy intake

Each family has a phrasebank (reg 25 phrasings, itsm 26, p2p 18). The answerability lint and the reference's
classification pass on all 60 practice/dev seeds per family (the lint caught and forced a fix of one ambiguous itsm
phrase). The 3-model panel is paid and pending; the 12 messy sealed streams carry intake `v0-prepanel`.

## What this does not show

No arm has run, so nothing here says whether Haiku in Foundry beats anything. The families were written by the same
model family that will be compared (PLAN §7's reason to keep V out of the external pool). The gates were run by their
author. Rates are from 8-12 dev streams; the clock engine and references were tested on 2027 calendars only.
