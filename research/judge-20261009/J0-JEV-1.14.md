# J0: the J1 re-read on jev-1.14.0 (2026-10-15, development evidence)

The question (MEMORY-ROUTING-RECURSION §5 row 3): does J1 survive the version change? Jev's moving alias pointed at `jev-1.13.0`. `jev-1.14.0` shipped on 10-14 behind `jev-preview`, and policy `2026-10-15.2` lists it so that it can be named explicitly.

## What ran

| Item | Detail |
|---|---|
| Inputs | The three J1 dev-select inputs (runbook, kinetics, interactive), 1,106 records and 1,181 questions. |
| Input check | Each input was rebuilt at $0 and matches the wave-A manifest's sha256: kinetics and interactive rebuilt byte for byte from the original beds pin (`c34c073`); runbook copied from its original build. |
| Command | `score-served.mjs --jev --jev-model jev-1.14.0 --reread 20`, request ledger capped at 1,400. |
| Served version | Every response named `jev-1.14.0`. |
| Size and cost | 602,735 input tokens, about $0.025. |
| Data | Rows, raw bodies, re-reads, reports and the ledger are in `data/jev/J0/`. The paired comparison with J1's `jev-1.13.0` rows is `data/jev/J0/compare-j1.json`. |

## Result

Accuracy is argmax against the label on the same (record, question) pairs. "Agree" is the share where both versions pick the same argmax.

| | n | jev-1.13.0 (J1) | jev-1.14.0 (J0) | Δ | argmax agree | mean TV distance |
|---|---|---|---|---|---|---|
| **pooled** | 1,181 | **0.775** | **0.771** | −0.004 | 0.941 | 0.053 |

Per port, the ports that moved:

| port | n | 1.13.0 | 1.14.0 | Δ | agree |
|---|---|---|---|---|---|
| runbook X4 | 31 | 0.516 | 0.355 | −0.161 | 0.71 |
| kinetics X4 | 42 | 0.714 | 0.667 | −0.047 | 0.95 |
| interactive Q5 | 52 | 0.692 | 0.654 | −0.038 | 0.89 |
| interactive Q1 (4 directions) | 100 | 0.830 | 0.860 | +0.030 | 0.95 |

Every other port is unchanged to three decimals. These are: runbook Q4 and X1; kinetics X3, X8, K1, K2 and K3; interactive Q4, X1, Q6, X6 and Q2.

## Reading

- **J1 survives the version change at the pooled level.** The −0.4 point drop is far under the 3-point noise floor J1 set.
- The strong ports (Q4, Q6, K1, X8) are unchanged.
- The one notable move is **runbook X4: −16 points on 31 items, with 29% of argmaxes flipped**. X4 was already among J1's weak ports. This confirms that a weak port is also an unstable one, so it should not be used even as advisory.
- The served version is recorded on every row, which is why the pin matters: a silent alias move would have shifted X4 without anyone noticing.
- J1's verdict ("at most advisory"; pooled 0.774) holds on 1.14.0. The default pin stays `jev-1.13.0`, because nothing here argues for moving.
