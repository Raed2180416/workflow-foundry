export const meta = {
  name: 'jit-profiles-durability',
  description: 'Runtime-learned input profiles as automatic guards (type feedback for agent work), evaluated offline at $0 on archived dev tasks; durability metrics in the stream report; adversarial review',
  phases: [{ title: 'Build' }, { title: 'Evaluate' }, { title: 'Review' }],
}
const CTX = `Repository /home/user/workflow-foundry (Node 24 ESM, node:test, no new deps). Read research/jit-20261008/THESIS-JIT.md, SPEC.md, DEV-NOTES.md (D1-D12; D9 = a heal widened a guard so the healed solver silently failed d4 drift tasks where its predecessor deopted; D5 = static solver silent on drift), experiments/jit/{stream,report,run-compiled,flow,flow-v2}.mjs, experiments/lib/beds.mjs, beds/records/README.md, beds/kinetics/README.md. Another workflow is editing experiments/jit/{stream,check-traces,compile,prompts,tierdown,report}.mjs in a separate worktree right now: do NOT edit those files. Create only NEW files: experiments/jit/profile.mjs, experiments/jit/durability.mjs, experiments/jit/eval-profiles.mjs and tests experiments/jit/test/profile.test.mjs, experiments/jit/test/durability.test.mjs. Do not touch git. Read experiments/runs/jit/** and /var/tmp/foundry-work/jit/** read-only (dev split data only). No live model calls. Shared 4-CPU VM with live streams: run only your own tests.`
phase('Build')
const build = await agent(`${CTX}

Build two things.
(1) profile.mjs — runtime-learned input profiles ("type feedback" for agent workloads): learnProfile(tasks) builds a profile from the accepted trace tasks of a stream (task.json objects: {prompt, inputs, files?}); checkProfile(profile, task) returns {novel: bool, reasons: [...], score} without any model call. Profile features must be generic (no family-specific code): JSON shape skeleton (key paths and types), per-path value-set for low-cardinality strings (enum-like), numeric ranges per path (with a margin), array length ranges, string pattern classes per path (e.g. date-like, phone-like, digits/letters/punct signature, length range, line-format signatures for multi-line text fields: tokenise lines into shape signatures like 'A|A|9/9/9' and keep the set), vocabulary novelty for prose fields (share of tokens unseen, with a threshold), and the prompt skeleton (numbers/quoted text masked). Widening: widenProfile(profile, task) merges a task confirmed by the interpreter. Serialisable JSON; deterministic; documented thresholds.
(2) durability.mjs — computeDurability(rows, events) for one arm of a stream (results.jsonl/events.jsonl shapes as written by stream.mjs): version churn (versions over time, tasks between changes), deopt/guard-fire rate over a sliding window, silent-miss rate for compiled deliveries (oracle-scored, experimenter's view), shadow disagreement rate over time, time-to-durable (define precisely: first task index after which the version does not change for >= W tasks AND the windowed compiled success stays >= S; W, S parameters; report undefined if never), and cost per task over the window. CLI: node experiments/jit/durability.mjs <runDir> prints a per-arm table.
Tests at $0 for both (synthetic fixtures). Return files, API, tests.`, { label: 'build', phase: 'Build', effort: 'high' })
phase('Evaluate')
const evalr = await agent(`${CTX}

BUILD REPORT:
${build}

Write experiments/jit/eval-profiles.mjs and run it ($0): for records (jit-dev-records-1) and kinetics (jit-dev-kinetics-1), regenerate the dev tasks of the stream config (experiments/jit/configs/dev-*.json; dev split only) with experiments/lib/beds.mjs makeTasks. Learn a profile from the first 3 tasks (the warmup traces) and, separately, from all d3 (records) / d4 (kinetics) tasks seen before each point; then check every later task: report novelty flags by difficulty segment (does the profile flag the drift segment d4 / d5 as novel, and how often does it false-alarm on same-difficulty tasks?). Join with the archived outcomes: experiments/runs/jit/jit-dev-records-1/*/results.jsonl and the N-version probe research/jit-20261008/nversion-records-dev.json — for each compiled delivery that silently failed (pass false, no deopt), would the profile have flagged the input as novel (i.e. converted a silent failure into a deopt)? Specifically the Opus-arm v2/v3 d4 failures (D9). Report precision/recall-style tables: novel vs silent-failure, novel vs pass, and the deopt-on-novelty counterfactual (how many silent failures caught, how many correct compiled answers would have been turned into deopts and what that would cost at the arm's interpreter price). Also run durability.mjs on both run dirs and report. Return the tables and a 10-line conclusion. Development evidence only.`, { label: 'evaluate', phase: 'Evaluate', effort: 'high' })
phase('Review')
const rev = await agent(`${CTX}

BUILD:
${build}

EVALUATION:
${evalr}

Adversarially review profile.mjs, durability.mjs and the evaluation: is the profile secretly family-specific or leaking oracle information (it must use only task inputs/prompt); is the novelty threshold tuned on the same tasks it is evaluated on (if so, re-run with a split: tune on records, evaluate on kinetics or vice versa, and report both); is time-to-durable gameable; are the counterfactual counts right (recompute a sample by hand). Fix confirmed P0/P1 issues in the new files only, rerun tests and the evaluation, and return the corrected tables, findings, and final conclusion.`, { label: 'review', phase: 'Review', effort: 'high' })
return { build, evalr, rev }