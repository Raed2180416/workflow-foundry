// Development pilot for Phase 3 (procedure distillation): replay the journaled Sonnet extraction calls of the
// passing fhand-sonnet pilot runs (records dev seeds 101-102, d2) on cheaper models and measure node-level
// agreement. Screening evidence only (dev seeds, reference = one frontier model's outputs).
// Usage: node experiments/pilots/distill-records-pilot.mjs [--candidates a,b] [--rounds 4,8,16]
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { referenceCalls, searchNode } from '../lib/distill.mjs';
import { createModelPort } from '../lib/models.mjs';

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const candidates = arg('candidates', 'qwen3.5-2b-q4km,granite-4.2-3b-q4km,qwen3.5-4b-q4km,claude-haiku-4-5-20251001').split(',');
const rounds = arg('rounds', '4,8,16').split(',').map(Number);
const out = path.resolve('experiments/runs/distill-pilot');
mkdirSync(out, { recursive: true });
const ref = referenceCalls('experiments/runs/records-hand-pilot/journal.sqlite', { nodes: ['root/extract/read'] });
const calls = (ref.get('root/extract/read') ?? []).filter(c => c.modelId === 'claude-sonnet-5-5');
console.log(`reference calls: ${calls.length} (Sonnet, from passing runs)`);
const { port } = createModelPort({ journalFile: path.join(out, 'journal.sqlite') });
const t0 = Date.now();
const res = await searchNode({ node: 'root/extract/read', calls, candidates, modelPort: port, runId: 'distill-pilot', rounds, threshold: 0.98, log: m => console.log(new Date().toISOString().slice(11, 19), m) });
res.wallMs = Date.now() - t0;
writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 1));
for (const c of res.candidates) console.log(c.model.padEnd(28), `n=${c.n}`, `agree=${c.agreement.toFixed(4)}`, `err=${c.errors}`, `$/call=${(c.unitCostUsd ?? 0).toFixed(4)}`, `s/call=${(c.latencyMs / Math.max(1, c.n) / 1000).toFixed(1)}`, c.alive ? 'SURVIVED' : 'dropped');
console.log('assigned:', res.assigned);
process.exit(0);
