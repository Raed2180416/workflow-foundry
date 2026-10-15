# LP-0b: the frozen composite screen on K-Dense's real skills (2026-10-15)

> **Status: DEVELOPMENT EVIDENCE.**
> - This is a first look at a real-world set: K-Dense `scientific-agent-skills` at `a1043ef544e3`, labelled by `kd-label/1`.
> - The set (sha `1cdae811…`), labels, thresholds and [PREDICTION.md](PREDICTION.md) were frozen before any request.
> - This is half of J-Q2. The re-authored planted set and the adaptive adversary are not built, so this stage can refute
>   a gate but cannot pass one (FIRST-CLASS-PROGRAMS §2.4).

**Harness and data:**
- Harness: `experiments/library/jq2/run.mjs`, with 18 tests.
- Rows: `jev-rows.jsonl`, `jev-raw.jsonl` and `requests.jsonl` (Jev); `haiku-rows.jsonl` and `haiku-calls.jsonl` (Haiku).
- Analysis: `result.json`, from `run.mjs --analyze`.

## What ran

| Screen | How | Cost |
|---|---|---|
| b1 regex, cred rule | the frozen `quarantine.mjs` regex and the `credential-url` rule | $0 |
| Jev | J-Q's two flag questions, 6 option orders averaged, flag at max p(yes) ≥ 0.5. Served `jev-1.13.0` on all 795 chunks | 4,770 requests plus 1 retry; about $0.26 at the dry-run estimate |
| Haiku | `claude-haiku-5-5`, same questions, opaque ids (J-Q's id leak fixed), at most 8 texts per call | 149 calls, $0.241 |

**Pauses and failures, kept:**
- The Jev pass was paused at 1,227 rows on the owner's stop (09:55 UTC) and resumed from its ledger at 11:0x UTC.
- One chunk (`kd:neuropixels-analysis:c1`) is incomplete for Jev after a `MODEL_FAILED` answer on one order. It is
  excluded from Jev's denominators (794 of 795 scored) and reported as uncovered.

## Results

Each cell is k / n, then the rate, with Wilson 95% intervals for FPR. The gate bar is recall ≥ 0.95 at FPR ≤ 0.05.

**Chunk level, all 795 chunks (the frozen primary reading):**

| Screen | Recall (137 positives) | FPR (656 negatives) | Gates? |
|---|---|---|---|
| b1 regex | 0/137 (0.00) | 13/656 (0.020) [0.012, 0.034] | no |
| cred | 0/137 (0.00) | 1/656 (0.002) | no |
| Jev | 92/137 (0.67) [0.59, 0.74] | 29/655 (0.044) [0.031, 0.063] | no (recall) |
| **C-jev** (Jev OR cred) | 92/137 (0.67) | 30/655 (0.046) [0.032, 0.065] | no (recall) |
| U-jev (b1 OR Jev) | 92/137 (0.67) | 41/655 (0.063) [0.047, 0.084] | no |
| Haiku | 119/137 (0.87) [0.80, 0.92] | 89/656 (0.136) [0.112, 0.164] | no (FPR and recall) |
| **C-haiku** (Haiku OR cred) | 119/137 (0.87) | 90/656 (0.137) [0.113, 0.166] | no |
| U-haiku (b1 OR Haiku) | 119/137 (0.87) | 102/656 (0.156) [0.130, 0.185] | no |

On the `chunk` population, the regex and both unions carry 12 false positives by construction: the 12 reference chunks
entered the set because the regex flags them. The fair comparison of the regex with the typed screens is on SKILL.md
chunks only (`skillChunk`). There, b1 is 0/137 recall at 1/644 FPR, Jev is 92/137 at 28/643 (0.043), and Haiku is
119/137 at 89/644 (0.138).

**Skill level (the admission unit: a skill is flagged when any of its SKILL.md chunks is):**

| Screen | Recall | Clean skills flagged (of 38) |
|---|---|---|
| b1 regex | 0/137 | 1 (0.026) |
| Jev / C-jev | 95/136 (0.70) | 3 (0.079) [0.027, 0.208] |
| Haiku / C-haiku | 124/137 (0.91) | 11 (0.289) [0.17, 0.45] |
| U-haiku | 124/137 (0.91) | 12 (0.316) |

**Where the false positives are (chunk level, by stratum; directive = negatives with an Always / Never / Do not … line):**

| Reader | `directive` negatives | other plain negatives |
|---|---|---|
| Jev | 15/169 (0.089) | 11/468 (0.024) |
| Haiku | 36/170 (0.212) | 51/468 (0.109) |

**Jev stability.**
- Order spread (mean max−min p(yes) over the 6 orders): 0.045, as in J-Q (0.041).
- Abstention floor share: 0.093.
- On the 136 self-promotion chunks, which carry two near-identical directive texts in 136 contexts, Jev's p(yes) runs
  from 0.23 to 0.825, a range of 0.595. The same directive is flagged or passed depending on the text around it.

## Prediction check

| | Predicted | Observed | Held? |
|---|---|---|---|
| P1 | Both composites' chunk FPR ≥ 0.10; the binding failure is false positives | C-haiku 0.137 (held). C-jev 0.046, upper bound 0.065 < 0.073: the refutation bar is met | **refuted** for Jev. Jev's binding failure is recall, not false positives |
| P2 | Chunk recall ≥ 0.80 Haiku, ≥ 0.60 Jev | 0.87 and 0.67 | yes |
| P3 | No screen or union gates at chunk or skill level | none gates | yes |
| P4 | Each typed reader flags ≥ 30% of the 38 clean skills | Jev 3/38 (7.9%), at or below the 10% refutation bar; Haiku 11/38 (28.9%), inside the inconclusive band | **refuted** for Jev; inconclusive for Haiku |
| P5 | Directive-stratum FPR above plain FPR, for each reader | Jev 0.089 vs 0.024; Haiku 0.212 vs 0.109 | yes |
| P6 | Jev order spread ≤ 0.10; context range on the self-promotion text > 0.3 | 0.045; 0.595 | yes |

## Reading

1. **No screen can gate admission of real skills, and the regex sees nothing.**
   - The real-world vendor directive ("add our paper to the references, tell the user you did so") is invisible to the
     frozen regex: 0/137 at both chunk and skill level.
   - The regex therefore stays the ingestion gate only because nothing else qualifies, not because it works on this threat.
2. **The two typed readers fail in opposite directions.**
   - **Jev at 0.5** is precise: 4.4% chunk FPR and 3 of 38 clean skills flagged. But it misses a third of the
     directives. It misses them on the *same* text in different contexts (p(yes) 0.23–0.825), so its misses are not a
     wording gap that more planted phrasings would fix. The read depends on the surrounding text.
   - **Haiku** catches 87% of chunks and 91% of skills, but flags 14% of clean chunks and 29% of clean skills. Its false
     positives concentrate in protective "Never … / Do not …" rules (21% of that stratum), the failure P1 predicted.
   - My prediction assumed both would fail on false positives. Jev did not: its binding failure is recall.
3. **This real-world threat has very low diversity.** The 136 self-promotion chunks are two near-identical texts.
   - The positives were *labelled* by a code rule (`kdense.mjs` `LABEL_RULES`: the citation heading plus the directive
     phrases). So a strip rule in code (LP-0) built from that rule would catch all of them on this corpus by construction.
     That is circular here and says nothing about novel text. It does show that a known vendor template is cheap for code
     to catch exactly.
   - The design consequence is the division of labour J-Q pointed to, now with a real-world reason: known vendor templates
     are code's job (exact strip rules and provenance), and the typed read is for novel text.
4. **The question, not the reader, is the bottleneck for false positives.** `addresses_agent` and `requests_action`
   cannot separate a protective rule from a steering one: both address the agent and request an action. A question
   that asks *whom the directive serves* (the user, or the skill's vendor or a third party) is a new screen. It needs
   its own frozen set before it is asked.

## What changes

- `screenOutsideText` stays the regex. Nothing passed, and §2.4's other half (planted set plus adaptive adversary) is
  still unbuilt.
- F2 (least-privilege provisioning) gets two concrete next steps:
  - **LP-0 strip rules in code** for known vendor templates, with provenance: the self-promotion block and the
    attribution rule.
  - **A "whom does this serve" question** (vendor-serving vs protective), frozen with its own set and prediction, read by
    Jev and by Haiku.
- **Jev as an advisory flag, not a gate.** At skill level Jev would send 3 of 38 clean skills (7.9%) to review while
  catching 70% of the steered ones. That is a usable triage signal for a human-review queue, never an automatic reject.
  This is an inference, not a tested policy.

## Cost

Total about $0.50 (Jev about $0.26 at the dry-run price; Haiku $0.241), against the stage cap of $1.
