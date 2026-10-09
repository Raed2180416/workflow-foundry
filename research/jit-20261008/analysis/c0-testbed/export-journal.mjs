// Export the C0 run's model-call journal (SQLite in scratch) to outputs/journal.jsonl: one line per call with cost, tokens,
// model, status and the raw response text (enough for the $0 replay in replay.mjs together with the regenerated tasks; requests
// are rebuilt by re-running the solver, and prompt_hash identifies each). Also prints per-seed and total cost.
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const db = new DatabaseSync(process.argv[2] ?? '/var/tmp/foundry-work/c0-testbed/journal.sqlite', { readOnly: true });
const rows = db.prepare('SELECT * FROM model_calls ORDER BY id').all();
const lines = [], bySeed = {}, byModel = {};
for (const r of rows) {
  const seed = Number((/:s(\d+):/.exec(r.run_id) ?? [])[1]);
  let text = null; try { text = JSON.parse(r.response).text ?? null; } catch {}
  lines.push(JSON.stringify({ id: r.id, seed, run_id: r.run_id, model: r.model_id, ok: !!r.ok, error: r.error_code, cost_usd: r.cost_usd, imputed_usd: r.imputed_usd,
    input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
    latency_ms: r.latency_ms, created_at: r.created_at, replay_key: r.replay_key, prompt_hash: r.prompt_hash, response_text: text }));
  bySeed[seed] = (bySeed[seed] ?? 0) + (r.cost_usd ?? 0);
  const m = byModel[r.model_id] ??= { calls: 0, ok: 0, usd: 0 }; m.calls++; m.ok += r.ok ? 1 : 0; m.usd += r.cost_usd ?? 0;
}
writeFileSync(path.join(HERE, 'outputs', 'journal.jsonl'), lines.join('\n') + '\n');
const total = Object.values(bySeed).reduce((a, b) => a + b, 0);
const summary = { calls: rows.length, totalUsd: +total.toFixed(6), byModel, bySeed: Object.fromEntries(Object.entries(bySeed).map(([k, v]) => [k, +v.toFixed(6)])) };
writeFileSync(path.join(HERE, 'outputs', 'cost.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
