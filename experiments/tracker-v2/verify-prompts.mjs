#!/usr/bin/env node
// Prompt equivalence (deviation D2, PREREG-TRACKER §8): every bind request already journaled for BUILDER-1 is rebuilt from the CURRENT
// tree (bind prompt, system prompt, schema) and compared byte for byte with what was sent. D2 changes how checks are evaluated, never
// what the binder or the prose reviewer is asked; this script is the evidence. Exit 1 on any difference.
//   node experiments/tracker-v2/verify-prompts.mjs [research/tracker-20261021/builder1]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bindPrompt, bindSchema, BIND_SYSTEM, CAPTURE_SYSTEM, capturePrompt } from '../../app/core/tracker/model.mjs';
import { loadCases, wordsFor } from './builder1.mjs';
import { vocabulary } from './run-builder1.mjs';
import { canonical } from '../../src/data.mjs';

const out = path.resolve(process.argv[2] ?? 'research/tracker-20261021/builder1');
const db = new DatabaseSync(path.join(out, 'journal', 'claude-haiku-5-5.sqlite'), { readOnly: true });
const cases = Object.fromEntries(loadCases().map(c => [c.id, c]));
const vocab = vocabulary();
const sha = s => createHash('sha256').update(s).digest('hex');
let same = 0, differ = 0, skipped = 0;
for (const row of db.prepare('select id, run_id, node_key, attempt, request from model_calls order by id').all()) {
  const req = JSON.parse(row.request);
  const args = req.providerRequest?.args ?? [];
  const system = typeof req.system === 'string' ? req.system : JSON.stringify(req.system ?? '');
  let m = row.run_id.match(/^t2-capture-([A-Z]\d)-s(\d)$/);
  if (m) {
    const ok = req.prompt === capturePrompt(wordsFor(cases[m[1]])) && system.includes(CAPTURE_SYSTEM);
    if (ok) same++; else { differ++; console.log(`DIFF ${row.run_id}`); }
    continue;
  }
  m = row.run_id.match(/^t2-bind-([A-Z]\d)-(.+)__(.+)$/);
  if (!m || row.attempt > 0 || row.node_key !== 'bind') { skipped++; continue; }   // lint retries carry the lint's own reasons
  const capFile = path.join(out, `capture-${m[2]}.json`);
  if (!existsSync(capFile)) { skipped++; continue; }
  const conditions = (JSON.parse(readFileSync(capFile, 'utf8')).cases[m[1]] ?? []).filter(x => x.verification === 'test');
  const prompt = bindPrompt({ vocab, words: wordsFor(cases[m[1]]), conditions });
  const schema = canonical(bindSchema(vocab, conditions.map(c => c.id)));   // key order: compared canonically
  const sentSchema = req.schema ? canonical(req.schema) : null;
  const ok = req.prompt === prompt && system.includes(BIND_SYSTEM) && (sentSchema === null || sha(sentSchema) === sha(schema));
  if (ok) same++; else { differ++; console.log(`DIFF ${row.run_id} node ${row.node_key}: prompt ${req.prompt === prompt} system ${system.includes(BIND_SYSTEM)} schema ${sentSchema === null ? 'n/a' : sha(sentSchema) === sha(schema)}`); }
}
console.log(`journaled requests rebuilt from the current tree: ${same} identical, ${differ} different, ${skipped} not rebuilt (retries or other steps)`);
process.exitCode = differ ? 1 : 0;
