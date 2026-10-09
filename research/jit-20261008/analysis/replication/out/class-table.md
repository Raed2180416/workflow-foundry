| class | platform | kind | decided by | designs | v2 oracle | conformance G | conformance I | I tau .95 | I 90% exact |
|---|---|---|---|---|---|---|---|---|---|
| GX-W1 W1 skips the DP>=1 prefilter | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W2 W2 by-variant report grouped by POS | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W3 W3 countunique per position hard-coded to 1 | Galaxy | wrong | battery | 1 | reject | reject | reject | accept **X** | reject |
| GX-W4 W4 AF threshold label printed with 2 decimal | Galaxy | wrong | battery | 1 | reject | reject | reject | reject | reject |
| HA-W1 W1 naive-debounce | Home Assistant | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| HA-W2 W2 start-gate-from-memory | Home Assistant | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| N12-W1 W1 forgets first KT->Zoho | n8n:12679 | wrong | battery | 23 | reject | reject | reject | reject | mixed(15/23 accepted) **X** |
| N12-W2 W2 empty-values-never-written | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W3 W3 case-sensitive-zoho-segment-tags | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | accept **X** |
| N12-W4 W4 kt-segments-to-zoho-on-create-only | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W5 W5 form-tag-on-every-new-subscriber | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N12-W6 W6 bookkeeping-tag-on-every-zoho-contact | n8n:12679 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W1 W1 ref-only-prompt (T3) | n8n:20281 | wrong | harness (prompt) | 1 | reject | reject | reject | reject | reject |
| N20-W2 W2 forged-modelTape (T3) | n8n:20281 | wrong | harness (cost accounting) | 1 | accept **X** | accept **X** | accept **X** | accept **X** | accept **X** |
| N20-W3 W3 drop-critical | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W4 W4 notify-before-create | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W5 W5 mention-dodge-critical (T3) | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| N20-W6 W6 probe-dodge (T3) | n8n:20281 | wrong | battery | 1 | reject | reject | reject | reject | reject |
| GX-C1 C1 multi-effect record keeps the highest-imp | Galaxy | correct | expected-log | 1 | accept | reject **X** | accept | accept | accept |
| GHA-C1 pr-text-new-then-old | GitHub Actions | correct | comparison | 3 | accept | reject **X** | accept | accept | accept |
| GHA-C2 failed-with-leftovers | GitHub Actions | correct | comparison | 1 | accept | reject **X** | accept | accept | accept |
| GHA-C3 labels-twice | GitHub Actions | correct | comparison | 1 | accept | reject **X** | accept | accept | accept |
| HA-C1 C1 buttons-reversed | Home Assistant | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| HA-C2 C2 typographic-apostrophe | Home Assistant | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| HA-C3 C3 last_changed-debounce | Home Assistant | correct | environment | 1 | accept | reject **X** | accept | accept | accept |
| HA-C4 C4 skip-round-condition-scope | Home Assistant | correct | expected-log | 1 | accept | reject **X** | accept | accept | accept |
| N12-C1 C1 berlin-midnight-birthdays (alternative de | n8n:12679 | correct | comparison | 1 | accept | reject **X** | reject **X** | reject **X** | accept |
| N20-C1 C1 review-names-sender-by-display-name | n8n:20281 | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| N20-C2 C2 here-ping-on-critical-follow-up | n8n:20281 | correct | comparison | 1 | accept* | reject **X** | accept | accept | accept |
| GX-R1 R1 Math.round instead of Python round at exa | Galaxy | residual | battery | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R1 LIMIT-catch-all-misleading-message | GitHub Actions | residual | comparison | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R2 LIMIT-reads-commented-lines-takes-max | GitHub Actions | residual | battery | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| GHA-R3 LIMIT-stuffed-pr-text | GitHub Actions | residual | comparison | 1 | accept **X** | reject | accept **X** | accept **X** | accept **X** |
| N20-R1 R1 memorised-answers (no model calls) | n8n:20281 | residual | harness (answers not in effects) | 1 | accept **X** | accept **X** | accept **X** | accept **X** | accept **X** |
