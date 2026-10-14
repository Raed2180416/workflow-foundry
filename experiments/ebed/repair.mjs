// B1N repair session: a built solver is shown the orders where it disagrees with the majority of independently built
// solvers on the practice worlds (experiments/tracker/nversion.mjs), and decides from the spec, per order, whose
// behaviour the spec requires; it fixes its solver only where it is wrong. Same sandbox, files and smoke loop as
// build.mjs --loop smoke, plus the current solver.mjs and DISAGREEMENTS.md (observable data only: the order's inbound
// messages on the practice world, the build's own effect signature and the majority's). No oracle, no grading, no truth.
// The repaired solver is then graded on the grading worlds (disjoint from the practice worlds). METERED (the session).
//   node experiments/ebed/repair.mjs --solver <path> --disagreements <nversion json> --build-index <i> --label <label>
//        --model claude-haiku-5-5 [--budget 1.5] [--minutes 30] [--seeds 1232-1234] [--difficulties 2,3,5]
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { buildFiles, grade } from './build.mjs';
import { serveMailbox, PRACTICE } from './smoke-service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));

const describe = sig => { try { const s = JSON.parse(sig); return `effects ${s.ops.map(([k, n]) => `${k}×${n}`).join(', ')}; statuses ${s.st.join(', ') || '-'}; notifications ${s.nt.join(', ') || '-'}`; } catch { return 'nothing at all (no committed effect for this order)'; } };

/** DISAGREEMENTS.md: per order, the inbound messages it received on the practice world (as the solver saw them) and the two behaviours. */
export function disagreementText(list, { maxOrders = 12 } = {}) {
  const worlds = new Map();
  const lines = ['# Orders where your solver disagrees with the majority of independently built solvers', '',
    'Each order below ran on a practice world (the same ones `node smoke.mjs` uses). Two or more other solvers, built',
    'independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.',
    'For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix solver.mjs only',
    'where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.', ''];
  for (const x of list.slice(0, maxOrders)) {
    const key = `${x.seed}:${x.d}`;
    if (!worlds.has(key)) worlds.set(key, e8.generateWorld({ seed: x.seed, difficulty: x.d, mix: 'tail' }));
    const w = worlds.get(key);
    const msgs = (w.arrivals ?? []).filter(a => JSON.stringify(a.payload ?? {}).includes(x.order)).slice(0, 12)
      .map(a => `- ${a.at} ${a.type}${a.source ? ` (${a.source})` : ''}: ${JSON.stringify(a.payload).slice(0, 300)}`);
    const mig = (w.backlog ?? []).some(b => JSON.stringify(b.export ?? {}).includes(x.order));
    lines.push(`## ${x.order} (practice world ${x.seed}, difficulty ${x.d})`, '', 'Inbound messages:', ...(msgs.length ? msgs : ['- (none as separate messages)']),
      ...(mig ? ['- this order was also in the go-live migration export delivered at the start'] : []), '',
      `Yours: ${describe(x.mine)}`, `Majority: ${describe(x.consensus)}`, '');
  }
  if (list.length > maxOrders) lines.push(`(${list.length - maxOrders} more orders disagree in the same way or similar ways.)`);
  return lines.join('\n');
}

async function main() {
  const model = arg('--model', 'claude-haiku-5-5');
  if (!POLICY.models.some(m => m.id === model)) throw new Error(`--model must be a policy model id: ${model}`);
  const label = arg('--label', null); if (!label) throw new Error('--label is required');
  const nv = JSON.parse(readFileSync(arg('--disagreements'), 'utf8'));
  const list = nv.disagreements[Number(arg('--build-index'))];
  const solverPath = arg('--solver');
  const out = path.join(ROOT, 'research/enterprise-20261014/runs', label);
  mkdirSync(out, { recursive: true });
  const workdir = path.join('/var/tmp/foundry-work/ebed-build', label);
  if (existsSync(workdir)) throw new Error(`workdir exists: ${workdir}`);
  const [s0, s1] = arg('--seeds', '1232-1234').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  if (seeds.some(s => PRACTICE.seeds.includes(s))) throw new Error('grading seeds overlap the practice worlds');
  const files = buildFiles(e8, { loop: 'smoke' });
  files['solver.mjs'] = readFileSync(solverPath, 'utf8');
  files['DISAGREEMENTS.md'] = disagreementText(list);
  const prompt = `${files['TASK.md']}\n\nREPAIR TASK. solver.mjs already exists (yours). Read DISAGREEMENTS.md: orders where independently built solvers
disagree with yours. For each, decide from SPEC-E which behaviour is required, fix solver.mjs only where yours is wrong (keep everything
else as it is), run node smoke.mjs to check nothing broke, and write REPAIR-NOTES.md (per order: the rule ids and your verdict).\nRead SPEC-E.md, CONTRACT.md, DISAGREEMENTS.md and solver.mjs first.`;
  const liveSmoke = path.join(path.dirname(workdir), `${label}.smoke.jsonl`);
  const box = serveMailbox({ item: e8, workdir, mode: 'smoke', journal: liveSmoke });
  const t = Date.now();
  let r;
  try { r = await runClaudeCode({ model, prompt, workdir, files, budgetUsd: Number(arg('--budget', '1.5')), timeoutMs: Number(arg('--minutes', '30')) * 60_000, effort: 'high' }); }
  finally { await box.stop(); }
  const build = { model, repairOf: solverPath, disagreements: list.length, wallMs: Date.now() - t, costUsd: r.costUsd ?? null, error: r.error ?? null, turns: r.turns ?? null };
  for (const f of ['solver.mjs', 'REPAIR-NOTES.md', 'DISAGREEMENTS.md']) if (existsSync(path.join(workdir, f))) copyFileSync(path.join(workdir, f), path.join(out, f));
  copyFileSync(path.join(workdir, '.executor-transcript.jsonl'), path.join(out, 'transcript.jsonl'));
  if (existsSync(liveSmoke)) copyFileSync(liveSmoke, path.join(out, 'smoke.jsonl'));
  console.log(`repair: ${JSON.stringify(build)}`);
  const rows = await grade(e8, readFileSync(path.join(workdir, 'solver.mjs'), 'utf8'), { seeds, difficulties: arg('--difficulties', '2,3,5').split(',').map(Number), label });
  const sum = k => rows.reduce((s, x) => s + x[k], 0);
  const summary = { completed: sum('completed'), passed: sum('passed'), tail: sum('tail'), tailPassed: sum('tailPassed'), critical: sum('critical'), armErrors: sum('armErrors') };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, build, seeds, summary, rows }, null, 1));
  console.log(`summary: ${JSON.stringify(summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
