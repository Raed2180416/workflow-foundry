// ROUTER-1 review addendum (2026-11-04, finding m10/m7): WHY did 13 of 193 Mercury test calls give no answer, and does a larger
// output cap fix it? Re-asks exactly the faulted TEST items (the ids are read from runs/mercury-test.jsonl, nothing else) with the
// same system prompt, judge prompt, schema and salt as the frozen pass, changing one thing: maxTokens (default 4,000 instead of
// 1,000). Rows go to runs/mercury-test-refault-<maxTokens>.jsonl and never replace the preregistered rows. DIAGNOSTIC: it informs
// the product judge's output cap; the preregistered Mercury numbers stay as measured.
//
//   set -a; . /root/.config/foundry/inception.env; set +a; node experiments/need-router/router1/mercury-refault.mjs [--max-tokens 4000] [--token-cap 70000]
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadSet, readJsonl, rowsFile, RUNS, LIVE, MERCURY, SALT } from './judges.mjs';
import { SYSTEM, judgePrompt, JUDGE_SCHEMA, readJudgeAnswer } from '../../../src/need/judge-prompt.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const maxTokens = arg('--max-tokens', 4000), tokenCap = arg('--token-cap', 70000);
const faulted = readJsonl(rowsFile('mercury', 'test')).filter(r => !r.ok).map(r => r.id);
const items = loadSet().filter(it => it.split === 'test' && faulted.includes(it.id));
const out = path.join(RUNS, `mercury-test-refault-${maxTokens}.jsonl`);
const done = new Set(readJsonl(out).filter(r => r.ok).map(r => r.id));          // a faulted row is asked again on a re-run
const todo = items.filter(it => !done.has(it.id));
console.log(`refault: ${faulted.length} faulted test ids; ${todo.length} to ask at maxTokens ${maxTokens}; token cap ${tokenCap}`);
if (todo.length) {
  mkdirSync(LIVE, { recursive: true });
  const { createModelPort } = await import('../../lib/models.mjs');
  // callTokens: the per-call reservation must hold the input too (eb-e8's prompt is about 2,000 tokens; the first run reserved
  // maxTokens + 2,000 and the port refused that call with MODEL_BUDGET before sending it).
  const { port, tokens } = createModelPort({ journalFile: path.join(LIVE, 'mercury-refault.sqlite'), allowedModels: ['claude-haiku-5-5', MERCURY], tokenCap, callTokens: maxTokens + 6000 });
  for (const it of todo) {
    let r;
    try {
      r = await port.call({ runId: `router1-refault:${it.id}`, nodeKey: 'need-judge', sampleIndex: 0, modelId: MERCURY, system: SYSTEM, prompt: judgePrompt(it.text), schema: JUDGE_SCHEMA,
        decoding: { maxTokens, reasoning: 'none' }, salt: SALT });
    } catch (e) { r = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) } }; }
    const a = r.ok ? readJudgeAnswer(r.value) : null;
    const row = { id: it.id, split: 'test', judge: 'mercury', modelId: MERCURY, maxTokens, ok: !!a, mode: a?.mode ?? null, needsWorkflow: a?.needsWorkflow ?? null, p: a?.p ?? null,
      gold: it.gold.mode, usage: r.usage ?? null, latencyMs: r.latencyMs ?? null, error: a ? null : (r.error ?? { code: 'ANSWER' }), at: new Date().toISOString() };
    appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`${it.id}: ${a ? `${a.mode} ${Math.round(a.p * 100)}% (gold ${it.gold.mode})` : `FAULT ${row.error.code}`}; out ${r.usage?.outputTokens ?? '?'} tokens`);
    if (r.error?.code === 'TOKEN_CAP') break;
  }
  console.log(`tokens ${JSON.stringify(tokens())}`);
}
