# codefix adversarial audit, 2026-10-07

Auditor: separate agent (no model or API calls; pure code). Scope: `beds/codefix/` only. Bed version
before: 1.0.0, after: **1.1.0** (task content changed, see F6). The audit stopped early: two probes
were denied by the session's permission policy (see "Not done"). This is a **partial audit**.

## Findings

| id | sev | finding | evidence | fix | regression test |
|---|---|---|---|---|---|
| F1 | info | Contract exports, portable `outputSchema`, byte-identical regeneration and split salting all hold. | `JSON.stringify(generate(x)) === JSON.stringify(generate(x))` for d3 s5001; existing determinism test | none needed | `codefix.audit.test.mjs` F1 |
| F2 | **high** | **Dev/test collisions.** Split is only an RNG salt and the instance space is small at low difficulty, so test tasks repeat dev tasks. Test seeds 5000-5099 against dev seeds 1-200 (v1.0.0): d1: 16/100 identical buggy module, 51/100 identical reference answer, 5 duplicates within the test seeds; d2: 3 and 10; d3: 1 and 4; d4: 0 and 1; d5: 0 and 0. | scratchpad `collide.mjs` (sha256 of `buggySource` and `reference`) | **not fixed** (needs more variety in the `domains/*.mjs` templates; see O1) | none |
| F3 | **high** | **Guard bypass by attribute access.** The guard banned *names* (`eval`, `open`, `sys`, ...) but not *attributes*, so `import dataclasses; dataclasses.builtins.eval(...)` or `dataclasses.sys` passed the static guard and reached the sandbox. | code review of `guard()` and `harness.py inspect_source` (Name vs Attribute nodes) | Ban the attribute names `builtins, open, eval, exec, system, popen, import_module, getattr, setattr, delattr, globals, locals, vars, sys, os, subprocess, socket, io, posix, nt, ctypes, gc, inspect, importlib, traceback, signal, threading, shutil, pathlib` unless the reference uses them. `compile` is still allowed (`re.compile`) | F3: five attribute attacks are rejected with `hidden === null` (they never run). A `re.compile` edit still passes |
| F4 | low | `schemaValid` accepted an **inherited** `patched_source` (from the prototype) and read the property twice, so a getter could change it between reads. Not reachable from JSON-parsed output. | code review | `readOutput()`: JSON round-trip, exactly one own data property, read once | F4: 22 degenerate outputs (null, NaN, ±Infinity, arrays, getter, prototype, `__proto__` key, BigInt, extra keys, wrong types) fail with `schema` and do not crash. Size, whitespace, NUL, lone surrogate and fenced outputs fail too |
| F5 | med | **Oracle crash on a malformed harness response.** A missing job, or `results` shorter than the hidden suite, made `sameResults(undefined, …)` throw (`JSON.parse(undefined)`) instead of returning `pass:false`. Can only happen if the candidate controls the harness output; the result-marker nonce makes that hard. | code review of `stripMsg` | `scoreHidden()` checks the job shape and result count and fails closed. Inspect results get the same check | F5: 9 malformed jobs, all fail without throwing |
| F6 | **med** | **Surface cue for the red herring (d4+).** Its expectation sentence was "I would expect …", while real bugs say "I expected …", and its comment lead-in came from a separate, herring-only pool. A regex could separate herring from real bugs without judgment. | `report.mjs` `herringExpectation` and the two lead-in pools | Shared sentence (`expectation()`) and one shared `COMMENT_LEADS` pool. Version bumped to 1.1.0 | F6: d4/d5 seeds 5000-5011 never use the herring-only sentence |
| F7 | low | Elimination cues. Decoy `FIXME`/`TODO` comments and the d5 code-comment injection only ever mark non-bug sites, and the reporter's wrong guess is always wrong. Each is a reliable "not here" signal, but none points at the bug. | `build.mjs` decoyPool / codeInjection `other`; README states the wrong guess | not fixed (design choice; documented) | none |
| F8 | med | **Hidden killers are public.** For killer cases with fixed arguments, the hidden killer is byte-identical to the bug-report repro (which states the expected value), and possibly to a visible test. Matching the repro then satisfies that hidden case, so only the random scenarios guard against overfitting. | `build.mjs`: hidden, visible and repro all call `site.killers(p, fork)`; deterministic killers ignore the fork | not fixed (needs per-site argument variation in `domains/*.mjs`; see O1) | none |
| F9 | low | Pass-rule documentation drift. The README's banned-name list omitted `exit, quit, help, memoryview, __builtins__, __loader__, __spec__, __file__`. Normalisation limits were undocumented: lists and dicts capped at 500 items, strings at 4000 characters, depth 12; 2 == 2.0, True ≠ 1, a namedtuple equals a list. | `index.mjs` vs README; `harness.py norm` | README updated | none (documentation) |
| F10 | info | Accepted variants verified: CRLF line endings, trailing whitespace, no final newline, comment and docstring edits, an added private helper, an added `import math` or `re`. A markdown-fenced module is rejected as a syntax error (strict, now documented). | oracle runs | README states the fence rule | F4 accepted variants |

## Numbers

Heuristic solver (`attacks/trivial_solver.py`, written by the bed author: an edit search scored on
visible tests, repro lines and doc examples, plus a docstring-default static fix), d3, test
seeds 5000-5029:

| version | passes | notes |
|---|---|---|
| 1.0.0 (before) | 3/30 (10.0 %) | all three passes contained a `wrong-default` bug that the docstring states verbatim |
| 1.1.0 (after) | 2/30 (6.7 %) | instances changed with the version salt; not an effect of F6, since this solver already treated both phrasings alike |

Both are below the 20 % bar. No stronger solver was written in this audit (see "Not done").

Controls, test seeds 5000-5029 (v1.1.0): `referenceSolve` passes 30/30 at d1, d3 and d5. Every bad
control fails 30/30 at each of those levels: `empty`, `shuffled-or-corrupted`, `unchanged-buggy`,
`near-miss-fix-one`, `near-miss-all-but-one`, `followed-red-herring`, `test-detection-hack` and
`signature-drift`. Worst-case time over those 90 tasks: generate 164 ms, oracle 290 ms (limit 2 s).

Sizes (v1.1.0, `node beds/codefix/measure.mjs 30 dev`), estimateTokens(prompt) +
estimateTokens(inputs), min/median/max: d1 1478/1619/2070, d2 2637/3342/3705, d3
5584/6013/7992, d4 7126/7655/10205, d5 8438/9820/12184. These match the README bands (d3 is
within 6-15K).

Tests: `node --test beds/codefix/` runs 25 tests (18 before, plus 7 audit regressions), all
passing, in about 80 s.

## Open items

- **O1 (high, blocks dev/test claims at d1-d3): F2 and F8.** The fix is more variety in the
  templates: identifiers, constants, docstring wording and killer arguments. That raises the
  instance space enough that collisions between dev and test seeds become negligible, and makes
  hidden killers use arguments that the repro does not show. Until this is done:
  (a) deduplicate test tasks against the dev seeds actually used (hash `build().reference`), or
  (b) evaluate codefix only at d4/d5, where no identical buggy module was seen in 100 × 200 pairs.
  Even then one d4 test task shared its reference answer with a dev task.
- **O2 (high, unverified): sandbox breadth.** `unshare` creates no PID namespace, so `/proc` still
  lists host processes. After F3 there is no known static route to `open`, `os` or `eval`, but
  the guard is a denylist, not a proof. Recommended: add `--pid --mount-proc` to
  `SANDBOX_SCRIPT`, and add a Python audit hook in `harness.py` installed before the candidate
  loads. It would block `open`, `os.*` process and file events, new imports and `ctypes`. Neither
  change is made or tested here.
- **O3 (med):** The herring complaint *prose* in `domains/*.mjs` often uses counterfactual
  phrasing ("I would expect", "should"), while real symptom prose describes observations.
  Varying both pools removes the remaining cue.
- **O4 (med, design):** There are 6 fixed templates with 118 sites. An agent or reuse arm that
  remembers dev tasks can recover each function's correct text by majority vote. Cross-task
  memory (C2 reuse) on this bed measures template recall as well as repair skill. Pre-register
  this, or use sealed families for reuse claims.
- **O5 (low):** `wrong-default` bugs (14 sites) can be fixed by regex from docstrings that state
  `default N` verbatim. Paraphrasing defaults in prose ("one second", "five units") would close
  this.

## Not done (permission denials during the audit)

- An empirical probe of what arbitrary code inside the sandbox can reach (`/proc/<pid>/root`)
  was denied by the session's permission policy. It was not retried. O2 is reasoning only.
- A follow-up read of the `params()` functions in `domains/*.mjs` was denied by the session's
  permission policy. That stopped the template work for F2/F8/O3/O5 and the stronger heuristic
  solver. No domain file was edited.
