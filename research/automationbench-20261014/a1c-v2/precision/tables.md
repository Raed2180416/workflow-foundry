### T1. Check verdicts against the grader (618 compiled checks, 372 hard)

| Checks | Round | n | correct accept (TA) | correct reject (TR) | neutral pass (no graded counterpart) | **false accept** | **false reject** (aligned / unaligned) | undecided |
|---|---|---|---|---|---|---|---|---|
| all | 0 (act world) | 618 | 307 | 31 | 73 | **38** | **169** (115 / 54) | 0 |
| all | final | 618 | 266 | 22 | 66 | **40** | **135** (97 / 38) | 89 |
| hard | 0 (act world) | 372 | 179 | 17 | 28 | **28** | **120** (97 / 23) | 0 |
| hard | final | 372 | 200 | 10 | 34 | **30** | **98** (81 / 17) | 0 |
| advisory | 0 (act world) | 246 | 128 | 14 | 45 | **10** | **49** (18 / 31) | 0 |
| advisory | final | 246 | 66 | 12 | 32 | **10** | **37** (16 / 21) | 89 |

### T2. Round-0 verdict quality by check type

| Check type | n | hard | TA | TR | neutral | FA | FR | P(correct \| check fails) | P(correct \| check passes) |
|---|---|---|---|---|---|---|---|---|---|
| judged | 136 | 0 | 88 | 6 | 28 | 4 | 10 | 0.38 (6/16) | 0.97 |
| record_created | 107 | 71 | 20 | 7 | 4 | 6 | 70 | 0.09 (7/77) | 0.80 |
| gmail_sent | 94 | 86 | 62 | 0 | 7 | 15 | 10 | 0.00 (0/10) | 0.82 |
| sheet_row | 94 | 66 | 51 | 0 | 19 | 4 | 20 | 0.00 (0/20) | 0.95 |
| record_field | 78 | 61 | 40 | 10 | 5 | 2 | 21 | 0.32 (10/31) | 0.96 |
| slack_posted | 55 | 48 | 11 | 8 | 2 | 7 | 27 | 0.23 (8/35) | 0.65 |
| gmail_not_sent | 49 | 37 | 33 | 0 | 5 | 0 | 11 | 0.00 (0/11) | 1.00 |
| slack_not_posted | 5 | 3 | 2 | 0 | 3 | 0 | 0 | – | 1.00 |

### T3. Grader assertions and the checks that cover them

Scored assertions = assertions false in the initial world (action) plus guards (true at start) that the agent broke. "Full" = a check on the same entity and effect that tests the asserted value; "partial" = same entity/effect, asserted value not tested; "missing" = no check at all.

| Assertions | n | full, hard | full, judged | full, advisory | partial only | **missing** |
|---|---|---|---|---|---|---|
| action, passed | 471 | 317 | 12 | 30 | 69 | **43** |
| action, failed | 96 | 23 | 11 | 1 | 32 | **29** |
| guards broken (failed) | 25 | 5 | 1 | 4 | 0 | **15** |
| guards intact (not scored) | 388 | 44 | 84 | 7 | 1 | **252** |
| **all scored** | 592 | 345 | 24 | 35 | 101 | **87** |

### T4. False rejects by cause (a check that fails a world the grader passes, or demands an effect nobody asked for)

| Cause | checks ever FR | of them hard | tasks | tasks with a hard FR | hard FR at round 0 |
|---|---|---|---|---|---|
| wrong app/record kind in the compiled check | 53 | 42 | 11 | 10 | 36 |
| instruction/rationale sentence compiled as a literal | 10 | 10 | 8 | 8 | 10 |
| app not re-read by the check (blind) | 23 | 23 | 7 | 7 | 23 |
| values from another item merged into the check | 14 | 14 | 3 | 3 | 14 |
| field semantics (tag list vs equality; verb as field) | 14 | 13 | 3 | 3 | 13 |
| excluded-recipient list overlaps a required recipient | 4 | 4 | 3 | 3 | 4 |
| requirement the grader does not test | 17 | 3 | 5 | 1 | 3 |
| negative content rule compiled as a recipient ban | 7 | 2 | 2 | 1 | 2 |
| over-strict: sheet-wide literal required in every row | 6 | 5 | 1 | 1 | 5 |
| literal the target record does not store | 5 | 4 | 1 | 1 | 4 |
| prompt placeholder kept as a literal | 3 | 2 | 1 | 1 | 2 |
| wrong literal value | 2 | 2 | 1 | 1 | 2 |
| check mechanics (DM channel) | 1 | 1 | 1 | 1 | 1 |
| wrong entity | 1 | 1 | 1 | 1 | 1 |
| demands an effect the grader forbids | 13 | 0 | 2 | 0 | 0 |
| judged-check (checker) error | 1 | 0 | 1 | 0 | 0 |
| check of something not asked | 1 | 0 | 1 | 0 | 0 |
| **total** | 175 | 126 | 31 | 29 | 120 |

### T5. Why the 121 failing scored assertions were not fixed

| Class | assertions | tasks | causes (assertions) |
|---|---|---|---|
| missing | 44 | 18 | M-world 21; M-negative-content 8; M-wrongdecision 8; M-negative(world) 2; M-noposcheck+derived 1; M-count 1; M-convention 1; M-noposcheck+format 1; M-scope 1 |
| FA-partial | 30 | 16 | weak: graded literal/aspect not in the check 19; weak: derived value (count/total/date math) not compiled 11 |
| FA-full | 20 | 12 | check encodes a wrong entity/scope (ledger error), agent complied 10; check encodes a wrong value (ledger error), agent complied 5; checker accepted a wrong world 4; weak: graded literal/aspect not in the check 1 |
| caught-hard | 18 | 5 | TR-wrongreason 18 |
| caught-advisory | 9 | 5 | advisory-noaddr 5; advisory judged 2; TR-wrongreason 1; advisory-negative 1 |
