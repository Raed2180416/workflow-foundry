#!/usr/bin/env node
// POST HOC diagnostic (not a score): for builds that stopped in a hidden world because their own acceptance could not be evaluated or
// failed (MISSING_REFERENCE / ACCEPTANCE_FAILED raised after the nodes ran), rerun the same workflow with its acceptance removed and
// apply oracle v1 to the effects. Answers "was the workflow's behaviour right, and only its self-check broken?" ($0, no model call).
// The preregistered verdict stays a failure: acceptance is part of the delivered workflow and the runtime refuses to finish without it.
//   node experiments/ci1-posthoc/effects-only.mjs <label...>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, scoreBuilt } from '../ci1/bed.mjs';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
export const SELF_CHECK_ERRORS = /^(MISSING_REFERENCE|ACCEPTANCE_FAILED)\b/;

/** True when the build failed only because a hidden world stopped on a self-check error. */
export function selfCheckFailure(rec) {
  if (rec.pass || rec.outcome !== 'ready' || !rec.workflow) return false;
  const bad = (rec.worlds ?? []).filter(w => !w.pass);
  return bad.length > 0 && bad.every(w => w.status && w.status !== 'succeeded' && SELF_CHECK_ERRORS.test(w.error ?? ''));
}

/** The same workflow without acceptance; null when the error came from a node argument rather than the acceptance. */
export function withoutAcceptance(workflow, errorText) {
  const ref = /Missing value at (\S+)/.exec(errorText ?? '')?.[1];
  const inArgs = ref && workflow.nodes.some(n => JSON.stringify({ args: n.args, items: n.items, when: n.when }).includes(`"${ref}"`));
  const inAcceptance = ref ? JSON.stringify(workflow.acceptance ?? []).includes(`"${ref}"`) : true;
  if (inArgs && !inAcceptance) return null;
  // the validator refuses an empty acceptance, so the self-check becomes a no-op node that always holds
  const noop = { id: 'posthoc_noop', kind: 'task', needs: [], description: 'post hoc: always holds', tool: 'core.identity', args: { value: 1 }, timeoutMs: 1000, retry: { maxAttempts: 1 } };
  return { ...workflow, budget: { ...workflow.budget, maxSteps: (workflow.budget?.maxSteps ?? 50) + 1 }, nodes: [...workflow.nodes, noop], acceptance: [{ op: 'eq', left: { $ref: 'nodes.posthoc_noop.value' }, right: 1 }] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const label of process.argv.slice(2)) {
    const dir = path.join(RUNS, label, 'records');
    if (!existsSync(dir)) { console.log(`${label}: no records`); continue; }
    const rows = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    const hits = rows.filter(selfCheckFailure);
    let right = 0;
    for (const rec of hits.sort((a, b) => (a.item + a.k < b.item + b.k ? -1 : 1))) {
      const bad = rec.worlds.find(w => !w.pass);
      const wf = withoutAcceptance(rec.workflow, bad.error);
      if (!wf) { console.log(`  ${rec.item} k${rec.k}: the missing reference is read by a node, not by the acceptance`); continue; }
      const oracle = JSON.parse(readFileSync(path.join(BED, 'oracle', `${rec.item}.json`), 'utf8'));
      const s = await scoreBuilt(oracle, wf);
      right += s.pass ? 1 : 0;
      console.log(`  ${rec.item} k${rec.k}: ${bad.error.slice(0, 80)} -> effects without acceptance ${s.pass ? 'pass' : `fail (${s.worlds.find(w => !w.pass)?.reasons?.[0]?.slice(0, 120)})`}`);
    }
    console.log(`${label}: ${hits.length} builds stopped only by their own acceptance; effects right without it in ${right}`);
  }
}
