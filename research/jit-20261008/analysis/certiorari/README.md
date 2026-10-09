# Certiorari queue pilot (BLOCKER-SYNTHESIS row 28, dossier 3 B17-E1)

*Dev diagnostic, pilot only. $0: no model calls. The input is the committed `nversion-records-dev.json` (4 compiled
records solvers × 24 dev tasks, seeds 201–224, K = 1). The full version (E-B17-1 over every arm's `events.jsonl`) waits
for R0's persisted runs.*

## 1. What the pilot asks

**The mechanism (dossier 3 §B17.4a).**
- Unresolved disagreements enter a queue.
- A (simulated) human rules on the top case.
- The ruling becomes a precedent that settles every other case matching it.

**Questions.** Does a precedent fix more than one case per ruling? How much harm does an over-broad precedent do, i.e.
how many correct deliveries does it overturn? How precise is the match rule?

## 2. What the data can and cannot show

The JSON gives, per (task, solver): `status` (ok or deopt), `pass` and `score`. Per task it gives `ok` and `distinct`
(the number of different answers). **It holds no answers.** So:

- **Answer groups are inferred.** Different (pass, score) means a different answer, because the oracle is a function of
  the answer. Equal (pass, score) may or may not be the same answer.
  - For each task the script lists every partition into exactly `distinct` groups that joins only equal-(pass, score)
    solvers.
  - Only s203 is ambiguous: 4 solvers all score 1, `distinct` = 2, giving 7 partitions. Each resample draws one at random.
    In 3 of the 7 the split is 2–2, so s203 has no majority and enters the queue as "unresolved". It is already right
    (every answer passes), so a ruling spent on it fixes nothing. Under FIFO it comes before s205, which is why FIFO
    policies at budget 2 reach the d4 cases in only about 4/7 of resamples.
  - s206 is resolved by `distinct` = 3: sonnetV1 and opusV2 both score 1 but gave different answers.
- **The match rule cannot see what the dossier asks for** (same decision class, same field, same convention). It uses
  only observable proxies:
  - **M1, same split:** the same solvers answered, sided together in the same way, and the same solvers refused.
  - **M3:** M1 plus the same drift segment (d3 or d4), a proxy for the convention regime.
  - **M2, same winner (broad):** the lineage(s) the ruling sided with are right whenever they disagree with the others.
- **Lineages.** opusV1 and opusV2 are one lineage, parent and child (synthesis erratum on DEV-NOTES D8), so there are 4
  solvers but 3 lineages.

## 3. Method (`cert-sim.mjs`)

**Baseline A** (the stream.mjs:547 analogue):
- deliver the strict majority if there is one;
- otherwise deliver the incumbent. The incumbent is opusV2, the only solver that answered all 24 (O/H's live version).
- A lone answer, or a unanimous one, is delivered as is.
- Baseline A passes **15/24**.

**Queues:**
- **Q1:** disagreements with no majority, i.e. 'unresolved': s205, s206, s208, s210, s224.
- **Q2:** Q1 plus answer-versus-refusal cases, where one solver answered and the others refused: s217, s218, s220, s222.
  This is the DEV-NOTES D9 class.

**The simulated human.**
- With probability 1 − e it gives the correct ruling: a passing group (chosen uniformly if several pass), or "route"
  when none passes.
- With probability e it errs: a failing group; or "route" when every group passes; or a random group when none passes.
- e ∈ {0, 0.1, 0.2}.
- The human is the dev oracle. It is used on the analyst side only and is never fed to any component.

**"Route".** The case goes to the interpreter, assumed to pass:
- the main run uses `--route-pass 1`, because the Opus agent went 24/24 on these seeds;
- `cert-sim-route075.*` uses 0.75, the Haiku agent's d4 rate.

**Policies.** Budgets B ∈ {1, 2, 4} rulings per 24-task stream.

| policy | rulings | precedent |
|---|---|---|
| A | none | none |
| B | case-only, FIFO | none |
| C | case-only, cert priority (the question with the most pending queued cases first, random tie-break) | none |
| D1 / D3 / D2 | cert priority | M1 / M3 / M2, applied to every matching case in the stream (retroactive correction) |
| Do | FIFO, online | M1, binding later tasks only |

**Precedence (stare decisis).** The first binding decision on a case stands. A case resolved by precedent leaves the
queue.

**Resamples.** 10,000 per cell, with a deterministic seed per cell (mulberry32).

```
node research/jit-20261008/analysis/certiorari/cert-sim.mjs                                     # cert-sim.{json,md}, ~1 min
node research/jit-20261008/analysis/certiorari/cert-sim.mjs --route-pass 0.75 --out cert-sim-route075
```

## 4. Results (budget 2 rulings per stream; full grid in `cert-sim.md`)

- "Fixed per ruling" counts fixes over baseline (direct + precedent) per ruling used. "Harm" is correct deliveries
  overturned.
- Precision is the share of precedent applications that deliver a passing answer: all applications / side rulings
  only. Route applications count as correct by assumption, so the side-only figure is the honest one.

| queue | policy | e | pass /24 (A = 15) | fixed per ruling | harm per ruling | precedent fixes | precedent harm | precision all / side-only | P(any harm) |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | B case-only FIFO | 0 / 0.1 / 0.2 | 15.00 / 14.84 / 14.68 | 0 | 0 / 0.08 / 0.16 | — | — | — | 0 / 0.16 / 0.30 |
| Q1 | C case-only cert | 0 / 0.1 / 0.2 | 15.50 / 15.30 / 15.09 | 0.25 / 0.23 / 0.20 | 0 / 0.08 / 0.16 | — | — | — | 0 / 0.15 / 0.29 |
| Q1 | D1 same split | 0 / 0.1 / 0.2 | 15.79 / 15.49 / 15.18 | 0.64 / 0.59 / 0.52 | 0.25 / 0.34 / 0.43 | 0.25 / 0.24 / 0.22 | **0.50 / 0.61 / 0.71** | 0.67 / 0.63 / 0.59 | 0.50 / 0.54 / 0.57 |
| Q1 | D2 same winner | 0 / 0.1 / 0.2 | 15.50 / 15.08 / 14.62 | 0.99 / 0.92 / 0.85 | 0.50 / 0.85 / 1.18 | 0.75 / 0.70 / 0.66 | **0.50 / 0.84 / 1.21** | 0.71 / 0.68 / 0.65 | 0.50 / 0.54 / 0.58 |
| Q1 | Do FIFO, later only | 0 / 0.1 / 0.2 | 15.57 / 15.37 / 15.13 | 0.28 / 0.28 / 0.27 | 0 / 0.10 / 0.21 | 0 / 0.05 / 0.10 | 0 / 0.10 / 0.21 | 0.67 / 0.65 / 0.63 | 0 / 0.09 / 0.21 |
| Q2 | C case-only cert | 0 / 0.1 / 0.2 | 16.25 / 16.06 / 15.86 | 0.63 / 0.57 / 0.50 | 0 / 0.04 / 0.08 | — | — | — | 0 / 0.07 / 0.15 |
| Q2 | D1 same split | 0 / 0.1 / 0.2 | 19.00 / 18.38 / 17.77 | **2.25 / 2.04 / 1.82** | 0.25 / 0.35 / 0.43 | 3.25 / 2.94 / 2.63 | 0.50 / 0.61 / 0.72 | 0.83 / 0.76 / 0.69 — side-only **0.67 / 0.57 / 0.49** | 0.50 / 0.54 / 0.58 |
| Q2 | D2 same winner | 0 / 0.1 / 0.2 | 19.50 / 18.72 / 18.00 | 2.50 / 2.30 / 2.11 | 0.25 / 0.44 / 0.61 | 3.75 / 3.45 / 3.15 | 0.50 / 0.81 / 1.07 | 0.77 / 0.74 / 0.72 — side-only 0.71 / 0.68 / 0.65 | 0.50 / 0.51 / 0.52 |
| Q2 | Do FIFO, later only | 0 / 0.1 / 0.2 | 17.27 / 16.90 / 16.48 | 1.14 / 1.05 / 0.94 | 0 / 0.10 / 0.20 | 1.70 / 1.59 / 1.43 | 0 / 0.10 / 0.20 | 0.79 / 0.74 / 0.69 | 0 / 0.10 / 0.20 |

Q2 (B case-only FIFO) is 15.00 / 14.84 / 14.69, the same as Q1's B: its first two FIFO cases are s205 and s206, which
the baseline already gets right.

**The dossier's rule, written before reading.** D must beat B by ≥ 2 prevented misses per stream at budget 2, with
harm ≤ 1. Otherwise precedent propagation is shelved.

| queue | e | D1 (same split) | D3 | D2 (same winner) | Do (online) |
|---|---|---|---|---|---|
| Q1 | 0 / 0.1 / 0.2 | fail (+0.79 / +0.65 / +0.50) | fail | fail (+0.50 / +0.24 / −0.06) | fail |
| Q2, route passes 1.0 | 0 / 0.1 / 0.2 | pass (+4.0 / +3.5 / +3.1) | pass | pass, pass, fail (harm 1.21) | pass, pass, fail |
| Q2, route passes 0.75 | 0 / 0.1 / 0.2 | pass (+3.0 / +2.7 / +2.3) | pass | pass, pass, fail (harm 1.21) | fail |

## 5. Verdicts

1. **On the stream's own "unresolved" queue (Q1), precedent fails the dossier's rule at every error rate.** It gains
   under 1 case per stream at budget 2, and its expected harm is about 0.5 even with a perfect human (e = 0).
   - **Mechanism.** s205, s206, s208 and s210 have the identical split: haikuV1 | sonnetV1 | opusV2, with opusV1
     refusing. But the right side differs: opusV2 on s205, sonnetV1 on s208, either on s206 and s210.
   - **So "same split" is not "same question".** A correct ruling on s208 ("sonnetV1 is right") overturns s205's
     correct delivery, and a correct ruling on s205 leaves s208 wrong.
   - **Side-ruling precision is 0.67 at e = 0** and falls to 0.59 at e = 0.2.
   - **The falsifier in dossier 3 holds here.** On this data the disputes behave like idiosyncratic facts, not recurring
     law, so far as a split signature can tell.
2. **The broad rule M2 is worse.** Harm grows with e to 1.2 per stream at e = 0.2, above the rule's limit of 1. It
   rarely gains more than D1 on Q1.
3. **Adding the answer-versus-refusal class (Q2) passes the rule, but for a reason that does not need a human.**
   - s217, s218, s220 and s222 share one split: only opusV2 answered (wrong every time, the D9 widened guard); the
     three other solvers refused.
   - One "route" ruling on any of them propagates to all four. That is most of the fixes per ruling (2.25 at e = 0).
   - But "when every other lineage refuses, route the lone answer" is a fixed rule that code can apply without a
     human (DEV-NOTES D8's consequence). Its value depends on the interpreter the case is routed to: the gain falls from
     +4.0 to +3.0 when routed cases pass at 0.75 rather than 1.
   - **Read as:** precedent works on that one recurring structural question. Side rulings ("lineage X is right") stay at
     precision 0.49–0.67 in every queue.
4. **Case-only rulings are safe but small.** C at budget 2 gains 0.5 (Q1) to 1.25 (Q2) with no harm at e = 0. At
   e = 0.2 the human's own errors cost about 0.16 cases per stream (B row).
5. **Online, later-only precedent (Do) is the safe variant.** At e = 0 it causes no harm on either queue. FIFO rules
   s203 (when it is queued) or s205 first. A ruling for opusV2's side on s205 turns none of the later matching cases
   from right to wrong. Its gain is smaller.
6. **Silent misses stay invisible.** s214 (unanimous and wrong, the common-mode case) and the two majority-wrong cases
   (s212, s223) never enter any queue. M2 sometimes reaches s212 by overturning its wrong majority, and that accounts
   for part of M2's 0.75 precedent fixes on Q1. A dispute-only queue cannot estimate the silent-miss rate (dossier 3
   §B17.1, problem 1). That needs the random audit slice (E-B17-3).

**Recommendation for the full version (after R0).**
- Do not propagate side rulings on a split signature.
- Define the match on decisions: the D11/N2 decision units (date order per source, void markers, sign flips) and
  B1's ledger. That needs answers and decision ledgers, which R0's persisted traces will have.
- Keep the route-on-unanimous-refusal rule as code, not as a human precedent.
- Re-run this simulator on R0's `events.jsonl` with the decision-level match rule before any owner time is spent.

## 6. Caveats

- One stream, K = 1, dev seeds, 4 solvers in 3 lineages, 24 tasks: these numbers are a sizing exercise. They are not
  evidence about precedent in general.
- No answers, so groups are inferred, s203's partition is resampled, and the match rules are proxies.
- The baseline's no-majority delivery uses opusV2 as incumbent. A different incumbent changes which Q1 cases start
  wrong.
- "Route" outcomes are assumed (1.0, or 0.75 in the second run).
- The human error model is symmetric and independent of the case. Real reviewers show automation bias (dossier 3,
  Goddard et al.), which this does not model.
