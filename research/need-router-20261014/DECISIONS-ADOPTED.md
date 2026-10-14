# Owner decisions for need router v1: adopted defaults (2026-10-14)

The owner gave standing authority ("don't ask me for perms, you are allowed to do anything necessary", 2026-10-14). Every
decision in DESIGN.md §9 is therefore taken at its **recommended default** below. Each stays open: the owner may overturn any
of them at any time, and an overturn is applied before the next paid stage, never retroactively to a frozen reading.

| # | decision | adopted |
|---|---|---|
| 1 | kill rule | three-outcome form with five readings (§5); minimum useful effect 0.03 success-equivalents per task at V = $1; replaces ROADMAP:632-634 |
| 2 | slider | V ∈ {$0.10, $1, $10}, default and headline $1; N headline 10, with 1 and 100 reported |
| 3 | W (cost of a wrong delivery) | W = V; sensitivities W = 0 and W = 10V |
| 4 | frontier agent | an Opus agent with no workflow counts as "no workflow" |
| 5 | meaning of "task" | a job: one request is N = 1, a recurring family has a declared N |
| 6 | which "testing" | both: testing the router and testing each workflow before the agent relies on it (the owner's later questions on a requirement tracker point to the second as well) |
| 7 | probe before deciding | yes: NR-probe may spend a few cents (two Haiku calls and one Haiku agent on one example); NR-static is reported beside it |
| 8 | seed ledger | purposes `need-example` (dev 601-609), `need-label` (dev 610-650), `need-heldout` (test 8801-8848, held-out): added to SEED-LEDGER.json |
| 9 | one-example acceptance check as a production input | allowed, reported separately (NR-probe-oracle is never primary in v1) |
| 10 | owner tasks | requested (20-30 real tasks with acceptance checks + the 10 most frequent recurring tasks, by 10-28); until they arrive no reading goes above diagnostic |
| 11 | far families | funded: 2-4 families written after the freeze by an author who has not seen the router code |
| 12 | Jev and Haiku judges | baseline and feature only, never the mode-picker, in v1 (Jev may route templates and spec sections to a builder: a hint, never a gate) |
| 13 | pause list | §8 adopted |
| 14 | spend | M1 (cap $15) and NL0 (cap $140) approved now; later stages at their gates, each under the $500 pause |
| 15 | sealed families | spent on this program |
| 16 | claim thresholds | C7a claim grade at >= 10 held-out clusters incl. owner tasks with >= 50% confident labels; C7b at >= 30 held-out families |
| 17 | document fixes | §8 list approved (applied as they come up) |

The designer's own calls (structural rule primary and kNN secondary; W = V; N = 10 headline; agent-H+proc in v1; JIT out of v1;
cluster W in TRAIN; agent-O at one draw) stand as well.
