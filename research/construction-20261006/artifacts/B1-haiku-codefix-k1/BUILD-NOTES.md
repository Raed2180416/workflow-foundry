# BUILD-NOTES: module-fix solver (solve.mjs)

## What it does
`node solve.mjs task.json` prints `{"patched_source": ...}`; logs go to stderr.
1. **Audit** (claude-opus-5-5, medium): checks the module against its docstrings and design notes, sentence by sentence, and returns defects with spec quotes. Bug reports are claims to check, not ground truth.
2. **Patch** (claude-sonnet-5-5, low): returns exact `{old, new}` edits. Code applies an edit only if `old` occurs exactly once; otherwise it retries once.
3. **Verify in code**: compile check, public names and parameter names unchanged, visible tests run in an isolated Python process with a stub `pytest`.
4. **Repair** (claude-opus-5-5, low, max 2 rounds) on any problem. The candidate with fewest problems is printed; a fatal error prints the original.

## Verified
- Offline: the Python checker on probe-0's original matches CI (5 pass, `test_top_tokens_by_frequency` fails).
- `tools/run-solver`, final config: probe-0 and probe-2 score 1.0. Probe-1 scored 1.0 under the Sonnet-audit config; the Opus-audit output differs only in an equivalent `if` form and was not re-scored.
- All probes were fixed on the first pass, so the repair and retry paths are untested.
- Cost: about $0.17 per task. Construction spend $0.77 of $2; 7 score checks left.

## Known weaknesses
- Recall rests on one audit call; subtle defects with no spec example, test or log trace may be missed.
- Verification checks compile, names and visible tests only; hidden behaviour and unintended edits are not checked.
- A visible test that contradicts the spec may pull repair the wrong way; untested.
- The pytest stub covers `raises`, `approx`, `mark`, `fixture` only.
- Only `patched_source` is returned, so changelog requests are ignored.
- Three probes are the only evaluation; no false-positive rate measured.
