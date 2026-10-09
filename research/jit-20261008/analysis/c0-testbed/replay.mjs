// $0 behavioural check for row 7: run the C0 parent and every variant (variants.mjs) on the in-sample tasks with model calls
// served from the C0 run's journal (no live calls). A stub tools/model.mjs looks each call up by sha256(model, system, prompt);
// a miss throws (the solver's judge then escalates or fails, as it would on a provider error) and is counted.
// Runs inside the same sandbox as run-compiled (src/executors/sandboxed-command.mjs, no network). Scores with the bed oracle.
// Output: outputs/row7-replay.json: per variant, tasks whose output differs from the parent's replayed output, oracle passes,
// replay misses. Usage: node --max-old-space-size=1024 replay.mjs [seed...]
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runSandboxed } from '../../../../src/executors/sandboxed-command.mjs';
import { loadFamily } from '../../../../experiments/lib/beds.mjs';
import { VARIANTS, applyVariant, PARENT } from './variants.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = '/var/tmp/foundry-work/c0-testbed';
const keyOf = (model, system, prompt) => createHash('sha256').update(JSON.stringify([model, system ?? '', prompt])).digest('hex');

const STUB = `import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const map = JSON.parse(readFileSync(new URL('./replay.json', import.meta.url), 'utf8'));
export async function callModel({ model, system = '', prompt } = {}) {
  const k = createHash('sha256').update(JSON.stringify([model, system ?? '', prompt])).digest('hex');
  const hit = map[k];
  appendFileSync(new URL('./replay-log.jsonl', import.meta.url), JSON.stringify({ model, hit: !!hit }) + '\\n');
  if (!hit) { if (process.env.DUMP_MISS) appendFileSync(new URL('./miss.jsonl', import.meta.url), JSON.stringify({ model, system, prompt }) + '\\n'); throw new Error('replay miss'); }
  if (!hit.ok) throw new Error('model call failed (replayed): ' + hit.error);
  return hit.value;
}
`;

function replayMaps() {
  const db = new DatabaseSync(path.join(SCRATCH, 'journal.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT id, run_id, model_id, request, response, ok, error_code FROM model_calls ORDER BY id').all();
  db.close();
  const latestRun = new Map();
  for (const r of rows) latestRun.set(Number((/:s(\d+):/.exec(r.run_id) ?? [])[1]), r.run_id);
  const maps = new Map();
  for (const r of rows) {
    const seed = Number((/:s(\d+):/.exec(r.run_id) ?? [])[1]);
    if (latestRun.get(seed) !== r.run_id) continue;
    const q = JSON.parse(r.request);
    let value = null;
    if (r.ok) { const resp = JSON.parse(r.response); try { value = JSON.parse(resp.text); } catch { value = resp.value; } }   // text keeps the model's key order (the journal's value is key-sorted), which the solver's prompts embed
    if (!maps.has(seed)) maps.set(seed, {});
    maps.get(seed)[keyOf(r.model_id, q.system, q.prompt)] = { ok: !!r.ok, value, error: r.error_code };
  }
  return maps;
}

const canon = out => JSON.stringify((out?.records ?? []).map(r => ({ ...r, source_rows: [...r.source_rows].sort((a, b) => a - b) })).sort((a, b) => a.entity_id - b.entity_id));

async function main() {
  const fam = await loadFamily('records');
  const maps = replayMaps();
  const seeds = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [...maps.keys()].filter(s => s >= 201 && s <= 224).sort((a, b) => a - b);
  const parentSrc = readFileSync(PARENT, 'utf8');
  const programs = [{ id: 'parent', kind: 'parent', src: parentSrc }, ...VARIANTS.map(v => ({ id: v.id, kind: v.kind, src: applyVariant(parentSrc, v) }))];
  const result = {};
  for (const p of programs) result[p.id] = { kind: p.kind, tasks: {} };
  for (const seed of seeds) {
    const task = JSON.parse(readFileSync(path.join(SCRATCH, 'tasks', `s${seed}.json`), 'utf8'));
    const live = JSON.parse(readFileSync(path.join(HERE, 'outputs', 'c0-runs', `s${seed}`, 'output.json'), 'utf8'));
    let parentCanon = null;
    for (const p of programs) {
      const wd = path.join(SCRATCH, 'replay', p.id, `s${seed}`);
      rmSync(wd, { recursive: true, force: true }); mkdirSync(path.join(wd, 'tools'), { recursive: true });
      writeFileSync(path.join(wd, 'solve.mjs'), p.src);
      writeFileSync(path.join(wd, 'tools', 'model.mjs'), STUB);
      writeFileSync(path.join(wd, 'tools', 'replay.json'), JSON.stringify(maps.get(seed)));
      writeFileSync(path.join(wd, 'task.json'), JSON.stringify({ prompt: task.prompt, inputs: task.inputs }));
      const r = await runSandboxed({ command: 'node', args: ['--max-old-space-size=512', 'solve.mjs', 'task.json'], workdir: wd, timeoutMs: 120000, network: false });
      let out = null; try { out = JSON.parse(r.stdout); } catch {}
      const log = (() => { try { return readFileSync(path.join(wd, 'tools', 'replay-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } })();
      const v = out ? fam.oracle(task, out) : { pass: false, score: 0 };
      const c = canon(out);
      if (p.id === 'parent') parentCanon = c;
      result[p.id].tasks[seed] = { exit: r.code, pass: v.pass, score: v.score, n: out?.records?.length ?? null, sameAsParent: c === parentCanon, sameAsLive: c === canon(live), misses: log.filter(x => !x.hit).length, calls: log.length };
      if (!process.env.KEEP_REPLAY) rmSync(path.join(wd, 'tools', 'replay.json'), { force: true });
    }
    process.stderr.write(`s${seed} done\n`);
  }
  for (const [id, r] of Object.entries(result)) {
    const ts = Object.values(r.tasks);
    r.summary = { tasks: ts.length, pass: ts.filter(t => t.pass).length, differFromParent: ts.filter(t => !t.sameAsParent).length, misses: ts.reduce((s, t) => s + t.misses, 0), sameAsLive: ts.filter(t => t.sameAsLive).length };
  }
  writeFileSync(path.join(HERE, 'outputs', 'row7-replay.json'), JSON.stringify(result, null, 1));
  console.log('| program | kind | pass/24 | outputs differ from parent | replay misses | identical to live output |\n|---|---|---|---|---|---|');
  for (const [id, r] of Object.entries(result)) console.log(`| ${id} | ${r.kind} | ${r.summary.pass}/${r.summary.tasks} | ${r.summary.differFromParent} | ${r.summary.misses} | ${r.summary.sameAsLive} |`);
}
main().catch(e => { console.error(e); process.exit(1); });
