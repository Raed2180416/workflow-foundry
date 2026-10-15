# LP-0b prediction: the frozen composite screen on K-Dense's real skills (written 2026-10-15, before any LP-0b request)

FIRST-CLASS-PROGRAMS §2.4 LP-0b (J-Q2 pulled forward); J-Q REPORT "Next". Development evidence only. Written at HEAD `b1fe87e`
plus this stream's uncommitted files.

**Frozen set.** `1cdae8110ee58b7b1634b5e1f4637e74765b636b4d368ef2f80f61b2672e8ea2`
- Its manifest is in [freeze.json](freeze.json).
- The runner refuses every metered request unless this file names that sha (`run.mjs assertPredicted`).
- Labels follow `kd-label/1`, frozen in [LABELLING.md](LABELLING.md); the hand check agreed 47/47.
- Corpus: `a1043ef544e3`.

## What this stage is, and what it is not

**What runs:** the K-Dense real-world half of J-Q2, at the thresholds J-Q fixed.

| Screen | Definition |
|---|---|
| b1 | the frozen regex |
| cred | the `credential-url` rule alone |
| jev | Jev, max p(yes) over the two flag questions, 6 option orders averaged, ≥ 0.5 |
| haiku | Haiku label: either flag question answered yes |
| C-jev | jev OR cred (the frozen composite) |
| C-haiku | haiku OR cred (the frozen composite) |
| U-jev | b1 OR jev (the union) |
| U-haiku | b1 OR haiku (the union) |

**What is not built in this stream:**
- the re-authored synthetic planted set;
- the adaptive-adversary stage.

Both are needed before any screen can gate (§2.4). This stage can therefore **refute** the composite as a gate, but cannot
pass it.

**Method change from J-Q.** Model-facing ids are opaque. J-Q's Haiku prompt sent each text as
`<text id="planted-039">` or `<text id="clean-014">` (`experiments/library/tools/jq.mjs`, `runHaiku`). So J-Q's Haiku
reader saw an id that names the label.
- J-Q's Haiku row (recall 0.88, FPR 0.01) is confounded by that.
- J-Q's Jev row is not: Jev requests carry only the text, as `jq.test.mjs` checks.

**What I had already seen when writing this.**
- The regex and credential-rule numbers on this set; they are computed at $0 by `--dry`.
- 47 chunks by hand.
- The J-Q REPORT.

I had not seen any Jev or Haiku answer on any K-Dense text.

## Minimum detectable effects (also printed by `run.mjs --dry`)

All MDEs are one-sample, one-sided, α 0.05, power 0.8, against the gate bar (recall ≥ 0.95, FPR ≤ 0.05).

| Reading | n | MDE | Consequence |
|---|---|---|---|
| Chunk recall | 137 positives | 0.053 | A true recall above 0.897 cannot be told apart from the bar |
| Chunk FPR | 656 negatives | 0.023 | A true FPR below 0.073 cannot be told apart from the bar |
| Skill recall | 137 skills | 0.053 | as for chunks |
| Skill FPR | 38 clean skills | 0.108 | A skill-level FPR below 0.158 cannot be told apart from the bar. Skill FPR is descriptive here |

**Effective n.** The 136 self-promotion positives are two near-identical texts in 136 contexts. Recall on them is
stability across contexts, not breadth over directives. The other positive class has n = 1.

## Already computed at $0 (checks, not predictions)

| Screen | Chunk recall | Chunk FPR |
|---|---|---|
| b1 regex | 0/137 | 13/656 (0.020): 12 reference chunks and 1 docstring |
| cred | 0/137 | 1/656: a placeholder connection string |

- **No positive contains a credential URL.** So each composite equals its typed reader plus at most that one false positive.
- **Skill-level b1:** recall 0/137; FPR 1/38.

## Predictions

Each prediction has a predicted value and a refutation bar. A result between the two reads **inconclusive**. A bar inside
the MDE resolves only if the Wilson interval excludes it.

- **P1 (the composite does not gate on real skills; the binding failure is false positives).**
  - Prediction: the chunk FPR of both C-jev and C-haiku is ≥ 0.10.
  - Mechanism: SKILL.md bodies are instructions addressed to an agent, and `addresses_agent` cannot tell protective rules
    from steering.
  - *Refuted* if either composite's chunk FPR is ≤ 0.05 with its upper Wilson bound below 0.073.
- **P2 (the typed readers see the directive that the regex misses).**
  - Prediction: chunk recall on the 137 positives is ≥ 0.80 for Haiku and ≥ 0.60 for Jev.
  - *Refuted* if either is ≤ 0.25, which is at most about twice K-Dense's own scanner (15/136 = 0.11).
- **P3 (gate verdict).**
  - Prediction: no screen and no union meets recall ≥ 0.95 at FPR ≤ 0.05, at chunk or at skill level.
  - *Refuted* if C-jev or C-haiku meets both at chunk level.
- **P4 (admission cost per skill).**
  - Prediction: at skill level, each typed reader flags ≥ 30% of the 38 clean skills.
  - *Refuted* if either flags ≤ 10%.
  - The MDE is 0.108, so a value between 10% and 30% reads inconclusive.
- **P5 (where the false positives are).**
  - Prediction: for each typed reader, the FPR on `directive` chunks is higher than on unstratified negative chunks.
  - *Refuted* if, for both readers, the directive FPR is at or below the plain FPR.
- **P6 (Jev stability).**
  - Prediction: Jev's order spread (mean max−min of p(yes) over the 6 orders) is ≤ 0.10, as in J-Q (0.041).
  - Prediction: on the 136 self-promotion chunks, Jev's p(yes) ranges over more than 0.3 between contexts. Identical
    directive text scored differently by context is the instability K-Dense saw.
  - *Refuted* if the spread is > 0.15, or if the context range is < 0.1.

## Reading rule

- Development evidence. This is the first look at this set, and nothing here is held out.
- A pass on this half alone does not move `screenOutsideText` off the regex. §2.4 also requires the planted half and the
  adversary.
- A **fail** here is enough to keep the regex as the gate. It also redirects F2 toward:
  - code-side strip rules (LP-0);
  - a question that separates vendor-serving directives from protective ones. A new question is a new screen and needs its
    own frozen set.
- Ambiguous chunks are reported apart.
- Every Jev row records the served version.

## Cost (dry run, $0; `run.mjs --dry`)

| Item | Estimate |
|---|---|
| Jev | 795 chunks × 6 orders = **4,770 requests**, about 6.09M input tokens, **$0.256** (second-hand price $0.042/M; calibrated on J-Q's 290 tokens of overhead per request) |
| Haiku | **149 calls** (at most 8 texts or 8K tokens each), about 1.14M input tokens, **$0.219** |
| **Total** | **$0.475** |

**Caps.**
- `--cap 5247` Jev requests (+10%).
- `--haiku-cap 0.44`.
- Stage cap **$1**, per §2.4.

The estimate is above §2.4's "about $0.10" because the full census of K-Dense chunks (needed for skill-level admission)
replaces the small planted set.
