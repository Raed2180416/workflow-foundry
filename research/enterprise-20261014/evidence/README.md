# Evidence: E-BED's original power script (a negative result, kept as found)

`efinal-pw.mjs` is the scratch script behind E-BED §6's power figures (Wilcoxon 0.60 / 0.85, sign 0.34 / 0.57 at
K = 2 / 4). It was written in this session's scratchpad (`efinal/pw.mjs`, 2026-10-14 13:30 UTC) and is copied here
byte for byte (sha256 `fcdd83db37cee899761632f4cac879027d42693d26e714d29b01a444266639ad`). `efinal-pw.out` is its
output, re-run on 2026-10-14 with Node 24.21.0 ($0, no model calls; deterministic).

Why it is wrong ([M-c], BED-CONTRACT-v1.1 §13.4):

- Its generator is `s = (s * 1103515245 + 12345) % 2147483648` on JavaScript doubles. The product exceeds 2^53 on
  4,978,979 of the first 5 × 10^6 steps, so it is rounded and the sequence is **not** the ANSI-C LCG it imitates: it
  departs from the exact (BigInt) recurrence at the second step. Consecutive outputs feed Box-Muller. Which of these
  defects causes the bias was not isolated.
- The bias shows where closed forms exist: the sign rule's rate at equality is 0.572 at K = 4 against the closed form
  0.585, and its null size is 0.017 against the exact 10/512 = 0.0195.
- Corrected values (`experiments/lib/stats-ebed.mjs` `familyPower`, and two independent 10^6-draw scripts): Wilcoxon
  0.610 / 0.856, sign 0.336 / 0.585 (the closed form). The script's 0.604 / 0.851 are outside the pinned tolerance of
  `stats-ebed.test.mjs`.

These are test (i) figures only. The power of the whole bar decision is `decisionPower` (BED-CONTRACT-v1.1 §13.5).
The H-E2 "every world ≥ 0.95" rows at the end of the output use an exact binomial sum and do not depend on the
generator.
