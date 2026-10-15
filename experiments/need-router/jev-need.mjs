// Can Jev decide "does this task need a workflow?" (owner question, 2026-10-14). Jev (TypeSafe's hosted System One, typed
// questions in, a probability per option out) reads each M1 task the way a router would see it BEFORE execution (the
// prompt, truncated, plus size facts; never the answer, the oracle or the outcome) and answers two typed questions:
//   single-call  can one careful model call with the whole task in context produce the correct final answer? (yes / no)
//   mode         the cheapest approach likely to succeed reliably: direct (one call) / agent / workflow (build first)
// Its answers are then scored against what actually happened in M1 (one Haiku call per task; runs/m1, runs/m1-d5).
// PREDICTION, written before any request (2026-10-14): Jev tracks surface (length, procedural wording) more than
// outcome; task-level AUROC of p(single-call = yes) against one-call success <= 0.65, family-level Spearman <= 0.4,
// and it will not beat the size heuristic (log input tokens) by more than noise.
// METERED (pennies): one request per task, request ledger with a hard cap. The key comes only from the environment
// variable FOUNDRY_SYSTEMONE_API_KEY, mapped per command; it is never printed, logged or written.
//   FOUNDRY_SYSTEMONE_API_KEY=... node experiments/need-router/jev-need.mjs --runs m1,m1-d5 [--cap 200] [--jev-model <id>] [--dry]
// Requests name the pinned version (score-served.mjs JEV_MODEL, jev-1.13.0 since 2026-10-15). --jev-model is the explicit
// override for a deliberate re-read on another version; the id must be listed in policy/models.json judgmentModels.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { JEV_MODEL, jevClient, requestLedger } from '../kev-data/score-served.mjs';
import { toSystemOneQuestion, fromSystemOneAnswer } from '../../src/judgment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

export const QUESTIONS = {
  'single-call': toSystemOneQuestion({
    question: 'Can ONE careful model call, given this whole task in its context and no tools, produce the correct final answer?',
    options: ['yes', 'no'],
    optionDescriptions: { yes: 'one call is enough: the task fits in one context and needs no multi-step procedure, tools or checking', no: 'one call is not enough: it needs a multi-step procedure, tools, iteration or a built workflow' },
  }),
  mode: toSystemOneQuestion({
    question: 'What is the cheapest approach that is likely to produce the correct answer reliably for a task like this?',
    options: ['direct', 'agent', 'workflow'],
    optionDescriptions: { direct: 'one model call with the task in context', agent: 'a tool-using agent that works through the task', workflow: 'build a multi-step workflow (code plus model steps) first, then run it' },
  }),
};

/** What a router sees before execution: the prompt (truncated) and size facts. Never the answer, oracle or outcome. */
export function stateOf(task, maxChars = 6000) {
  const inputs = JSON.stringify(task.inputs ?? {});
  const files = Object.values(task.files ?? {}).join('\n');
  const tokens = Math.ceil((inputs.length + files.length + String(task.prompt ?? '').length) / 4);
  const p = String(task.prompt ?? '');
  return `TASK PROMPT (first ${Math.min(maxChars, p.length)} of ${p.length} characters):\n${p.slice(0, maxChars)}\n\nSIZE: about ${tokens} tokens of prompt, inputs and files in total; ${Object.keys(task.files ?? {}).length} attached files.`;
}

/** AUROC of scores against binary labels (ties count half). */
export function auroc(scores, labels) {
  const pos = scores.filter((_, i) => labels[i]), neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
export function spearman(a, b) {
  const rank = xs => { const o = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(xs.length); o.forEach(([, i], k) => { r[i] = k; }); return r; };
  const ra = rank(a), rb = rank(b), n = a.length, m = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

async function main() {
  const runs = arg('--runs', 'm1').split(',');
  const outDir = path.join(ROOT, 'research/need-router-20261014/runs/jev-need');
  mkdirSync(outDir, { recursive: true });
  // The labels: one-call success per task (passed at either effort) from the M1 rows.
  const label = new Map();
  for (const r of runs) {
    const f = path.join(ROOT, 'research/need-router-20261014/runs', r, 'results.jsonl');
    if (!existsSync(f)) throw new Error(`missing ${f}`);
    for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const x = JSON.parse(l);
      const k = x.taskKey;
      const cur = label.get(k) ?? { family: x.family, pass: false, passes: 0, n: 0 };
      cur.pass ||= !!x.pass; cur.passes += x.pass ? 1 : 0; cur.n += 1;
      label.set(k, cur);
    }
  }
  // Regenerate each task (pure) to build the router's view.
  const keys = [...label.keys()].sort();
  const tasks = [];
  for (const k of keys) {
    const [fam, split, d, s] = k.split(':');
    const t = (await makeTasks(fam, { split, seeds: [Number(s.slice(1))], difficulty: Number(d.slice(1)) }))[0];
    if (t.taskKey !== k) throw new Error(`task key mismatch ${t.taskKey} vs ${k}`);
    tasks.push(t);
  }
  console.log(`${tasks.length} tasks; ${tasks.filter(t => label.get(t.taskKey).pass).length} solved by one call`);
  if (process.argv.includes('--dry')) { console.log(stateOf(tasks[0].task).slice(0, 800)); return; }
  const { served, config } = jevClient({ model: arg('--jev-model', JEV_MODEL) });
  const ledger = requestLedger({ file: path.join('/var/tmp/foundry-work/need/jev-need', 'requests.jsonl'), cap: Number(arg('--cap', '200')) });
  const rows = [];
  for (const t of tasks) {
    ledger.take({ tag: 'jev-need', id: t.taskKey });
    let body, err = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { body = await served.ask({ state: stateOf(t.task), questions: QUESTIONS }); break; }
      catch (e) { err = e.code ?? String(e.message); if (!['MODEL_QUOTA', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT'].includes(err)) break; await new Promise(r => setTimeout(r, 2000 * 2 ** attempt)); }
    }
    if (!body) { rows.push({ taskKey: t.taskKey, family: t.familyId, error: err }); continue; }
    const sc = fromSystemOneAnswer(body.answers['single-call'], ['yes', 'no']);
    const md = fromSystemOneAnswer(body.answers.mode, ['direct', 'agent', 'workflow']);
    const tokens = Math.ceil((JSON.stringify(t.task.inputs ?? {}).length + Object.values(t.task.files ?? {}).join('').length + t.task.prompt.length) / 4);
    rows.push({ taskKey: t.taskKey, family: t.familyId, model: body.model ?? null, usage: body.usage ?? null, pSingle: sc.probabilities.yes, mode: md.probabilities,
      oneCallPass: label.get(t.taskKey).pass, tokens });
  }
  const ok = rows.filter(r => r.pSingle !== undefined);
  const y = ok.map(r => r.oneCallPass);
  const res = {
    n: ok.length, errors: rows.length - ok.length, model: ok[0]?.model ?? null, jevModel: config.model,
    aurocJev: auroc(ok.map(r => r.pSingle), y),
    aurocSmallInput: auroc(ok.map(r => -Math.log10(r.tokens)), y),      // size heuristic: smaller input -> more likely one call suffices
    families: Object.values(ok.reduce((m, r) => { const k = r.taskKey.split(':s')[0]; (m[k] ??= { key: k, n: 0, pass: 0, p: 0, direct: 0 }); m[k].n++; m[k].pass += r.oneCallPass ? 1 : 0; m[k].p += r.pSingle; m[k].direct += r.mode.direct; return m; }, {}))
      .map(f => ({ ...f, passRate: f.pass / f.n, meanPSingle: f.p / f.n, meanPDirect: f.direct / f.n })),
  };
  res.spearmanFamily = spearman(res.families.map(f => f.meanPSingle), res.families.map(f => f.passRate));
  res.accuracyAt05 = ok.filter(r => (r.pSingle >= 0.5) === r.oneCallPass).length / ok.length;
  res.baseRate = y.filter(Boolean).length / y.length;
  writeFileSync(path.join(outDir, 'rows.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, families: undefined }, null, 1));
  for (const f of res.families) console.log(`  ${f.key.padEnd(24)} one-call pass ${f.pass}/${f.n}  Jev p(single)=${f.meanPSingle.toFixed(2)}  p(direct)=${f.meanPDirect.toFixed(2)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
