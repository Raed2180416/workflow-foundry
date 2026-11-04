// Extract Haiku facts for every distinct request in a verifier-lab dataset: one call per request (not per row).
//
//   node experiments/autobench/verifier/code-checks/facts-run.mjs --vlab <verifier-lab dir> --out <dir> [--model claude-haiku-5-5]
//        [--concurrency 4] [--replay] [--limit N]
//
// Writes <out>/facts.json: { <factsKey>: {ok, facts, error, costUsd, usage, modelId, latencyMs} } and journals every model
// call in <out>/facts-journal.sqlite (replayable with --replay). The model sees only the request text and the list of
// connected services; never a world, a diff, a label or a path into the lab (which holds labels).
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { extractHaikuFacts, factsKey } from './facts.mjs';

const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, out: { type: 'string' }, model: { type: 'string', default: 'claude-haiku-5-5' },
  concurrency: { type: 'string', default: '4' }, replay: { type: 'boolean', default: false }, limit: { type: 'string' } } });
if (!a.vlab || !a.out) { console.error('usage: facts-run.mjs --vlab <dir> --out <dir>'); process.exit(2); }

const lab = await import(pathToFileURL(path.join(path.resolve(a.vlab), 'load.mjs')).href);
const rows = lab.loadRows({ canonicalOnly: true });
const requests = new Map();
for (const r of rows) {
  const v = lab.verifierView(r);
  const key = factsKey(v.prompt.user, v.services);
  if (!requests.has(key)) requests.set(key, { user: v.prompt.user, services: v.services });
}
mkdirSync(a.out, { recursive: true });
const outFile = path.join(a.out, 'facts.json');
const done = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const todo = [...requests.entries()].filter(([k]) => !done[k]?.ok).slice(0, a.limit ? Number(a.limit) : undefined);
console.log(`requests ${requests.size}, cached ${requests.size - todo.length}, to run ${todo.length}`);

const { createModelPort } = await import('../../../lib/models.mjs');
const { port } = createModelPort({ journalFile: path.join(a.out, 'facts-journal.sqlite'), mode: a.replay ? 'replay' : 'live', allowedModels: [a.model],
  maxBudgetUsdPerCall: 0.05, concurrency: { [a.model]: Number(a.concurrency) } });

let spent = 0, n = 0;
await Promise.all(todo.map(async ([key, req]) => {
  let r;
  try { r = await extractHaikuFacts({ port, user: req.user, services: req.services, modelId: a.model }); }
  catch (e) { r = { key, ok: false, facts: null, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 500) }, costUsd: e.costUsd ?? 0 }; }
  done[key] = r; spent += r.costUsd ?? 0; n++;
  writeFileSync(outFile, JSON.stringify(done, null, 1));
  console.log(`${n}/${todo.length} ${key} ok=${r.ok} $${(r.costUsd ?? 0).toFixed(4)}${r.ok ? '' : ' ' + JSON.stringify(r.error).slice(0, 200)}`);
}));
console.log(`spent $${spent.toFixed(4)} on ${n} calls; facts in ${outFile}`);
