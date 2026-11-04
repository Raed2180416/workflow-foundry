# PROTOCOL-ROUTER-2 (DRAFT, 2026-11-04): the sealed check of "does this request need a workflow?"

Status: **draft, not frozen, nothing run.** It is the corrected protocol the ROUTER-1 review asked for (M1, M5; RESULT-ROUTER-1
"Review addendum"). It becomes a preregistration only when the owner agrees to write the requests (step 2) and the files in
step 1 are committed with their hashes, in that order. No model is called before that commit.

## Why ROUTER-1 cannot settle the question

- One author wrote the rubric, every label, 133 of the items, the router and the judge prompt; the rubric quotes test items.
- The never-trigger endpoint (0 false triggers with the threshold at the highest dev negative) passes about 39% of the time for
  any score, and the middle band was chosen where it could only add errors.
- Every ROUTER-1 item has now been read, tuned on or both: all 319 are development data from here on.

## 1. Frozen before any sealed item exists (commit + sha256 of each)

- `RUBRIC.md`, with every example that came from the ROUTER-1 item pool replaced by an invented one; `src/need/judge-prompt.mjs`
  (moving the mode definitions into the system turn so they cache is allowed here, before anything is measured on the sealed set).
- The systems and their operating points, all chosen on the 319 ROUTER-1 requests (pooled; they are development data):

  | id | system | operating point, chosen on ROUTER-1 | ROUTER-1 pooled (dev + test) |
  |---|---|---|---|
  | H50 | Haiku 5.5 asked directly | percent ≥ 50 (its own boundary) | 7/216 false triggers, recall 0.971 |
  | **H80 (primary)** | Haiku 5.5 asked directly | percent ≥ 80: the lowest bar whose pooled false-trigger count is at most 2 | 2/216, recall 0.932 |
  | C80 | code clears p < 0.05, Haiku at ≥ 80 decides the rest | as shipped (`needCascade`), bar 0.80 | (compute before freezing) |
  | M | Mercury 3 asked directly, 4,000-token output cap | percent ≥ 50 | (13 faults at 1,000; re-asked at 4,000: 13/13 answered) |
  | J | Jev (`jev-1.13.0`), only if the owner's key is mapped in | argmax of the 4-rotation average | not measured |
  | code | router v1.1, code only | t_default | development evidence only |
  | ngram | char 3-5-gram logistic regression | refit on all 319, threshold by the out-of-fold rule | n/a |
  | never / always / keyword | baselines | as ROUTER-1 | |

## 2. The sealed set: written and labelled by someone else

- **Author and labeller: the owner** (or a person the owner names), not any model and not the ROUTER-1 author. Requests he would
  really send, in his own words: at least 100, and as many "looks procedural but is a one-off" requests as he can think of,
  because those are where false triggers live.
- He labels each with the frozen rubric before seeing any system's answer; a second person labels a random 30 blind, for
  agreement (Cohen's κ reported; the primary metrics use the owner's labels).
- The file is committed with its hash before any system is run on it, and no system output is read before every system has run.

## 3. Endpoints (sealed set, read once)

- **E1 (primary): the false-trigger rate of H80**, with its 95% Clopper-Pearson upper bound. The owner's "never trigger" is read
  as a target rate: met at 5% if the upper bound is ≤ 5%. With zero false triggers that needs at least 72 negatives (two-sided;
  183 for 2%, 368 for 1%), so the set size decides the strongest claim it can carry; it is stated before the set is written.
- **E2:** recall of H80 with its 95% interval; it must be ≥ 0.85 at the lower bound to count as useful.
- **E3:** every system's false triggers, recall, F1, AUROC, cost and latency per decision; H80 vs code and vs ngram by exact
  McNemar; H80 vs C80 for the cost of the cascade.
- **E4:** the slider: each system's false triggers and recall at s = 0, 0.25, 0.5, 0.75 and 1 as shipped.
- Every false trigger and every miss is listed with its words and root-caused.

## 4. What it still does not answer

Whether a workflow actually helps on the requests labelled "needs one" (success or cost against doing them directly) is the
counterfactual question: the label factory in `../DESIGN.md` §2. A first $0 signal may exist where per-task raw-agent and
workflow-arm results are already on disk for AutomationBench devTrain tasks; it is not part of this protocol.

## Budget

One Haiku answer per request serves H50, H80 and C80 (about $0.0003 each; two samples to measure flips): Haiku ≤ $1. Mercury
≤ 200K tokens, Jev ≤ 1,200 requests. Frozen with step 1.
