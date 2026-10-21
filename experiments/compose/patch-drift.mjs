// COMP-1 M5 driver: a drift patch session for a built composed program (research/composition-20261021/PREREG-COMP1.md
// M5). ADDED AFTER THE COMP-1 FREEZE (commit 7a64b34): not one of the frozen harness files, which it imports unchanged
// (build.mjs composedBuildFiles, smoke.mjs serveComposedMailbox, drift.mjs, drift-run.mjs, bundle.mjs).
// METERED: one sandboxed session (the B1L-H builder model, effort high) with a small cap (the orchestrator's rule: at
// most $1 per program). The session gets its own program, the DRIFTED SPEC-E.md, the change notice (the changed
// passages, before and after), the same CONTRACT, COMPOSE, API and kit files, and the smoke loop on the practice worlds
// 1235-1237 changed by the drift (drifted spec served by the host, the drift's world change applied). No grading in the
// loop. Afterwards ($0): patch locality (drift.mjs patchLocality: which modules changed against the modules declaring
// R2.2), module tests in the sandbox, and the patched and unpatched programs graded under the drift on dev worlds.
//   node experiments/compose/patch-drift.mjs --program research/composition-20261021/runs/ch-e8-1/program --label ch-e8-1-d1 \
//        --model claude-haiku-5-5 --effort high --budget 1 --minutes 20
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { practiceFor } from '../ebed/smoke-service.mjs';
import { composedBuildFiles, runModuleTests } from './build.mjs';
import { serveComposedMailbox, composedClientInstructions } from './smoke.mjs';
import { DRIFTS, driftedBinding, driftWorld, patchLocality } from './drift.mjs';
import { driftRun } from './drift-run.mjs';
import { readProgram } from './bundle.mjs';
import { subjectOf } from './fault-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));

export function patchTask(id) {
  const D = DRIFTS[id];
  const changes = D.spec.map((c, i) => `### Change ${i + 1}\n\nBefore:\n\n${c.from.split('\n').map(l => `> ${l}`).join('\n')}\n\nNow:\n\n${c.to.split('\n').map(l => `> ${l}`).join('\n')}\n`).join('\n');
  return `# Task: the rulebook changed

Your composed program in this directory (composition.json, parent.mjs, modules/, tests/) implements the order process of
SPEC-E.md. The business has changed one rule (${D.rule}); SPEC-E.md here is the new version. The changed passages:

${changes}
Update the program so that it implements the new SPEC-E.md exactly. Change only what the change requires and keep every
other behaviour as it is. COMPOSE.md and CONTRACT.md are unchanged. When you are done, \`node compose-kit/compose.mjs
check\` and \`node compose-kit/compose.mjs test\` must pass.
${composedClientInstructions('smoke')}`;
}

async function main() {
  const id = arg('--drift', 'review-timeout-clears');
  const D = DRIFTS[id];
  const before = path.resolve(arg('--program'));
  const label = arg('--label');
  const model = arg('--model', 'claude-haiku-5-5');
  if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id: ${model}`);
  const budgetUsd = Number(arg('--budget', '1'));
  if (budgetUsd > 1) throw new Error('M5 rule: at most $1 per program');
  const workdir = path.join('/var/tmp/foundry-work/compose-patch', label);
  if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
  const out = path.join(ROOT, 'research/composition-20261021/runs', label);
  mkdirSync(out, { recursive: true });
  // The workspace: the build's files with the drifted spec and the patch task, then the program itself.
  const files = composedBuildFiles(e8, { arm: 'C-H', loop: 'smoke' });
  files['SPEC-E.md'] = driftedBinding(id).specE;
  files['TASK.md'] = patchTask(id);
  for (const [f, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, f)), { recursive: true }); writeFileSync(path.join(workdir, f), t); }
  cpSync(before, workdir, { recursive: true });
  const driftItem = { ...e8, binding: driftedBinding(id), generateWorld: o => driftWorld(e8.generateWorld(o), id).world };
  const liveSmoke = path.join(path.dirname(workdir), `${label}.smoke.jsonl`);
  const box = serveComposedMailbox({ item: driftItem, workdir, mode: 'smoke', journal: liveSmoke, practice: practiceFor(e8) });
  const t = Date.now();
  let r, smokeRuns;
  try { r = await runClaudeCode({ model, prompt: `${files['TASK.md']}\nRead SPEC-E.md and your program first.`, workdir, files: {}, budgetUsd, timeoutMs: Number(arg('--minutes', '20')) * 60_000, effort: arg('--effort', 'high') }); }
  finally { smokeRuns = await box.stop(); if (existsSync(liveSmoke)) copyFileSync(liveSmoke, path.join(out, 'smoke.jsonl')); }
  const session = { model, budgetUsd, wallMs: Date.now() - t, costUsd: r.costUsd ?? null, turns: r.turns ?? null, error: r.error ?? null, smokeRuns };
  if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
  console.log(`patch session: ${JSON.stringify(session)}`);
  const after = readProgram(workdir);
  const keep = path.join(out, 'program');
  if (after.manifest) {
    mkdirSync(keep, { recursive: true });
    writeFileSync(path.join(keep, 'composition.json'), JSON.stringify(after.manifest, null, 1));
    for (const [f, text] of Object.entries(after.sources)) { mkdirSync(path.dirname(path.join(keep, f)), { recursive: true }); writeFileSync(path.join(keep, f), text); }
    if (existsSync(path.join(workdir, 'tests'))) cpSync(path.join(workdir, 'tests'), path.join(keep, 'tests'), { recursive: true });
  }
  const locality = after.manifest ? patchLocality(readProgram(before), after, { rule: D.rule }) : null;
  const tests = after.manifest ? await runModuleTests(workdir) : null;
  const worlds = arg('--worlds', '1165:2:30,1166:3:30').split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; });
  const graded = after.manifest ? await driftRun({ drift: id, worlds, subject: subjectOf(`program:${keep}`) }) : null;
  const stale = await driftRun({ drift: id, worlds, subject: subjectOf(`program:${before}`) });
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, drift: id, rule: D.rule, before: path.relative(ROOT, before), session, locality, tests,
    patched: graded?.worlds.map(w => ({ seed: w.seed, d: w.d, converted: w.converted, ...w.subject })) ?? null,
    unpatched: stale.worlds.map(w => ({ seed: w.seed, d: w.d, converted: w.converted, ...w.subject })) }, null, 1));
  console.log(JSON.stringify({ locality, tests, patched: graded?.worlds.map(w => w.subject?.oracle), unpatched: stale.worlds.map(w => w.subject?.oracle) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
