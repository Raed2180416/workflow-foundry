// Clean-room authoring of the C-H-T decomposition templates (research/composition-20261021/HARNESS.md §7.3). METERED:
// one sandboxed frontier session (a policy model id, default claude-opus-5-5) that sees ONLY SPEC-E.md, COMPOSE.md, the
// API schemas and this task: no oracle, world, generator, test, run or other template. Its templates/ directory then
// feeds `build.mjs --arm C-H-T --templates <dir>`. The templates in builder/templates/ were written by the harness author
// from SPEC-E, but in a session that had read the oracle's transition, so this is the independent alternative.
//   node experiments/compose/author-templates.mjs --model claude-opus-5-5 --effort high --budget 5 --minutes 45 --label tpl-opus-1
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { MockSystem } from '../../beds/ebed/host/mocks.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { readProgram, programProblems } from './bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));

export const AUTHOR_TASK = `# Task: a decomposition template

A less capable model will build the order process of SPEC-E.md as a composed program (COMPOSE.md: a parent orchestrator
plus sub-workflow modules, each with a declared typed interface and its own contract tests). Write it a decomposition
template, from SPEC-E.md and COMPOSE.md only, in the directory \`templates/\`:

- \`templates/DECOMPOSITION.md\`: the modules and why these boundaries; for each module the SPEC-E rules it owns, its
  instance key (per order, per fulfilment, ...), its input and output, the effects, human tasks and timers it may use,
  the events it receives back; the parent's routing and the order of the phases; a checklist that assigns every rule
  and reading of SPEC-E (R1-R7, S1-S15, §1-§4.8) to exactly one module (or to the parent); the pitfalls the split guards
  against. Cite SPEC-E sections for every requirement you state; add nothing SPEC-E does not say.
- \`templates/composition.json\`: a complete, valid manifest (COMPOSE.md) for that decomposition, with input and output
  schemas.
- \`templates/parent.mjs\` and \`templates/modules/<id>.mjs\`: skeletons with the exported functions and comments saying
  what each must do. No business logic: the builder writes that.

Keep each rule in one module, so a later change of one rule touches one module. Check the manifest against COMPOSE.md
(module ids, effect kinds from api/*.schema.json, schemas in the portable subset, an acyclic call graph).
`;

async function main() {
  const model = arg('--model', 'claude-opus-5-5');
  if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id: ${model}`);
  const label = arg('--label', `tpl-${Date.now()}`);
  const workdir = path.join('/var/tmp/foundry-work/compose-templates', label);
  if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
  const t0 = Date.parse('2026-03-02T00:00:00+01:00');
  const files = { 'SPEC-E.md': e8.specE.text, 'COMPOSE.md': readFileSync(path.join(here, 'builder', 'COMPOSE.md'), 'utf8'), 'TASK.md': AUTHOR_TASK };
  for (const def of e8.systems) files[`api/${def.id}.schema.json`] = JSON.stringify(new MockSystem(def).apiSchema(t0), null, 1);
  const t = Date.now();
  const r = await runClaudeCode({ model, prompt: `${AUTHOR_TASK}\nRead SPEC-E.md, COMPOSE.md and api/*.schema.json first.`, workdir, files,
    budgetUsd: Number(arg('--budget', '5')), timeoutMs: Number(arg('--minutes', '45')) * 60_000, effort: arg('--effort', 'high') });
  const out = path.join(ROOT, 'research/composition-20261021/runs', label);
  mkdirSync(out, { recursive: true });
  if (existsSync(path.join(workdir, 'templates'))) cpSync(path.join(workdir, 'templates'), path.join(out, 'templates'), { recursive: true });
  if (existsSync(path.join(workdir, '.executor-transcript.jsonl'))) copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
  const prog = existsSync(path.join(out, 'templates')) ? readProgram(path.join(out, 'templates')) : null;
  const problems = prog?.manifest ? programProblems(prog, { item: e8 }) : ['no templates/composition.json'];
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, model, costUsd: r.costUsd ?? null, turns: r.turns ?? null, error: r.error ?? null, wallMs: Date.now() - t, problems }, null, 1));
  console.log(JSON.stringify({ label, costUsd: r.costUsd, problems }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
