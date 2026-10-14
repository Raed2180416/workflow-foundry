export const meta = {
  name: 'bed-audits',
  description: 'Adversarially audit the records, incident, codefix, synth and kinetics beds (two lanes, one agent per bed)',
  phases: [{ title: 'Audit', detail: 'break the oracle, then fix; two beds at a time' }],
}
const COMMON = `Repository: /home/user/workflow-foundry (Node 24 on PATH; ESM; built-in node:test; do NOT add npm dependencies; do NOT commit or push; do NOT touch git state). Read beds/CONTRACT.md first. You own ONLY the directory beds/<family>/ named below. Do not edit any other file: other agents are concurrently editing src/, experiments/ and research/corpus-20261006/. Run tests with: node --test beds/<family>/ . Untrusted code (e.g. Python under test) must only run inside the bed's existing sandbox helper. Do not call any LLM or model API; this audit is pure code.
This bed will be used in pre-registered experiments comparing agent harnesses (plain agents vs typed workflows on cheap and frontier models). An invalid oracle blocks every claim, so be hostile.`
const AUDIT = `You are an ADVERSARIAL AUDITOR, then fixer, of a bed built by another agent. Read its README.md, index.mjs and tests first.
Audit steps (do all, write findings into beds/<family>/AUDIT.md with a dated header, a findings table (id, severity, finding, evidence, fix, regression test), and the before/after numbers):
1. Determinism and contract conformance (every export present; outputSchema is the portable subset; same seed -> byte-identical task; test split seeds >= 5000 never collide with dev seeds).
2. Truth leakage: search prompt/inputs/files for answer strings; check ids/orderings don't leak the answer (e.g. root service listed first, entity_id order, sorted fields, the answer being the first/last/only candidate matching a regex).
3. Oracle bypass: try degenerate outputs (empty arrays, all-candidates, huge outputs, wrong types, extra fields, NaN/Infinity, strings for numbers, duplicated items, prototype keys like __proto__) and confirm they fail without crashing the oracle. Try hard to pass WITHOUT solving.
4. Oracle false negatives: confirm that semantically correct answers in acceptable variant forms (key order, number formatting the schema allows, case where the README says case-insensitive) pass, and that the README pass rule matches the code exactly.
5. Triviality attack: spend real effort writing a <=40-line deterministic heuristic solver that reads only prompt+inputs (keyword grep / regex / majority heuristics) and measure its pass rate at difficulty 3 over 30 test-split seeds (5000+). If it passes > 20%, strengthen the generator (more paraphrase variety, red herrings, ambiguity resolved only by prose rules) until it drops below 20% while referenceSolve still passes 100%. Keep the heuristic solver as a test fixture.
6. Controls: referenceSolve passes 30/30 seeds at d1, d3, d5; every bad control fails 30/30.
7. Sizes and performance: estimateTokens(prompt+inputs) per difficulty matches README; generate+oracle within the contract's time limits.
Fix every problem you find (you may rewrite generator/oracle), re-run tests, add a regression test for each fix, and update README.md if knobs or rules changed. Bump the bed's version string if task content changes.
Final answer: findings (one line each with severity), fixes, heuristic-solver pass rates before/after, final test counts, token sizes per difficulty, anything left open.`
const LANES = [['records', 'incident', 'synth'], ['codefix', 'kinetics']]
phase('Audit')
const out = await parallel(LANES.map(lane => async () => {
  const res = []
  for (const f of lane) {
    const r = f === 'synth'
      ? await agent(`${COMMON}\nYour family directory: beds/${f}/\nNOTE: a previous audit attempt on this bed was cut off by a usage limit; any partial edits are in the working tree (committed as WIP). Inspect git log/diff for beds/synth, keep what is correct, finish.\n\n${AUDIT}`, { label: `audit:${f}`, phase: 'Audit', model: 'sonnet', effort: 'xhigh' })
      : (f === 'kinetics' || f === 'incident')
        ? await agent(`${COMMON}\nYour family directory: beds/${f}/\nNOTE: this bed already passed a complete first audit (see its AUDIT.md). This is a SECOND, independent audit pass. A previous second-pass attempt was interrupted midway; its partial edits are in the working tree (kinetics was bumped to 4.0.0 with AUDIT findings F20-F27 started). Inspect git diff HEAD~3 -- beds/${f}, keep what is correct, finish the hardening, update AUDIT.md (second-pass section) and README, and make every test green.\n\n${AUDIT}`, { label: `audit2:${f}`, phase: 'Audit', model: 'opus', effort: 'xhigh' })
        : await agent(`${COMMON}\nYour family directory: beds/${f}/\n\n${AUDIT}`, { label: `audit:${f}`, phase: 'Audit' })
    res.push({ family: f, report: r })
  }
  return res
}))
return out.filter(Boolean).flat()