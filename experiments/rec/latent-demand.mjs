// latent-demand.mjs: Z1, the latent-demand replay for `subflow` (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.4
// REC-1 "Z0 build and Z1 latent-demand replay: $0", §5 row 7). Development evidence; $0: no model call, no oracle call.
//
// How often would the host turn subflow work into a `child`, on tasks Haiku has already attempted? The host's own functions
// (subflow.mjs isBig, chooseExecution) are replayed over committed attempt rows: a row's task is re-rendered from its taskKey
// (experiments/lib/beds.mjs makeTasks; the generator is pure and seeded) to measure its size, and the row's recorded attempt
// stands in for the probe ("size plus a failed or slow attempt", design owner summary 3). Two readings of the probe:
//   deployable  what a host sees without an oracle: slow = the call hit its time limit (MODEL_TIMEOUT); failed = any other
//               recorded error (schema-invalid, refusal, ...). A wrong but well-formed answer is invisible here.
//   oracle      failed = the oracle said fail (row.pass false): the upper bound of a perfect check, analysis only (an oracle
//               is never a runtime signal: need-router DESIGN §6).
// Size: input tokens as the host counts them (subflow.mjs tokensOf, bytes / 4, over the prompt, the inputs JSON and the files,
// exactly as experiments/need-router/features.mjs) and units [I: a unit is a row of a list or table in the task's inputs
// (experiments/library/index.mjs shapeOf over the inputs) or a file, whichever count is larger; a table inside a file is that
// file's content, so need-r0pad's padding documents count once each]. H5 (design §3.4: child executions on R0 and r0-pad at most 10%) is read on wbed-r0 rows; need-r0pad has no attempt
// rows, so it is sized only (size-only families): where none of its tasks is big, S2 cannot fire on it whatever a probe says.
// H5's verdict: 'fail' when either reading of the attempt rows is over 10% (a real check sees between the two), else
// 'undetermined' when a size-only task is big (S2 then depends on a probe these rows do not have), else 'pass'.
// Not replayable from these rows (listed in the result): S3 needs per-unit failures named by a deployable check, S4 needs
// repeats inside one run, and the agent's own propensity to call the tool needs transcripts, which are not committed.
//
//   node experiments/rec/latent-demand.mjs [--rows a.jsonl,b.jsonl] [--size-only need-r0pad@2,3,4,5:601-603] [--json out.json]
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTasks } from '../lib/beds.mjs';
import { shapeOf } from '../library/index.mjs';
import { isBig, chooseExecution, tokensOf, LIMITS } from './subflow.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_ROWS = Object.freeze(['research/need-router-20261014/runs/m1/results.jsonl', 'research/need-router-20261014/runs/m1-d5/results.jsonl']);
export const DEFAULT_SIZE_ONLY = Object.freeze(['need-r0pad@2,3,4,5:601-603']);
export const H5_FAMILIES = Object.freeze(['wbed-r0', 'need-r0pad']), H5_LIMIT = 0.1;
export const NOT_REPLAYABLE = Object.freeze([
  'S3: needs per-unit failures named by a deployable check inside one run; the rows carry one whole-task attempt and only oracle verdicts name units',
  'S4: needs repeats of one sub-workflow structure inside one run',
  'the agent\'s own propensity to call subflow: needs agent transcripts, none committed (archived agent rows hold only cost and turns)',
]);

/** The size of a rendered task: {tokens, units}. */
export function taskSizeOf(task) {
  const files = Object.values(task.files ?? {});
  return { tokens: tokensOf(JSON.stringify(task.inputs ?? {}) + files.join('\n') + String(task.prompt ?? '')), units: Math.max(shapeOf({ inputs: task.inputs ?? {} }).itemLists.maxLength, files.length) };
}
/** The two probe readings of one attempt row. */
export function probeOf(row) {
  const code = row?.error && typeof row.error === 'object' ? row.error.code ?? 'ERROR' : row?.error ? 'ERROR' : null;
  const slow = code === 'MODEL_TIMEOUT';
  return { deployable: { failed: code && !slow ? 1 : 0, slow }, oracle: { failed: row?.pass === true ? 0 : 1, slow }, code };
}
const cellOf = taskKey => { const [family, , d] = String(taskKey).split(':'); return `${family}@${d}`; };
const share = (a, b) => (b ? Math.round((a / b) * 1e4) / 1e4 : null);
/** "family@d1,d2:s0-s1" -> {family, difficulties, seeds}. */
export function parseSizeOnly(spec) {
  const m = /^([\w-]+)@([\d,]+):(\d+)-(\d+)$/.exec(String(spec));
  if (!m) throw new Error(`--size-only ${spec}: expected family@d1,d2:seed0-seed1`);
  const [s0, s1] = [Number(m[3]), Number(m[4])];
  return { family: m[1], difficulties: m[2].split(',').map(Number), seeds: Array.from({ length: s1 - s0 + 1 }, (_, i) => s0 + i) };
}
// The default sizer: re-render the task from its key (family:split:dN:sSEED), cached per key.
export function bedSizer() {
  const cache = new Map();
  return async taskKey => {
    if (!cache.has(taskKey)) {
      const [family, split, d, s] = String(taskKey).split(':');
      const [t] = await makeTasks(family, { split, seeds: [Number(s.slice(1))], difficulty: Number(d.slice(1)) });
      cache.set(taskKey, taskSizeOf(t.task));
    }
    return cache.get(taskKey);
  };
}

/**
 * The replay. rows: attempt rows ({taskKey, arm, pass, error}); sizeOf(taskKey) -> {tokens, units}; sizeOnly: [{family,
 * difficulties, seeds, split?}]. Returns {cells, tasks, sizeOnly, h5, limits, notReplayable}.
 */
export async function replayLatentDemand({ rows, sizeOf = bedSizer(), sizeOnly = [], limits = LIMITS }) {
  const cells = new Map(), tasks = new Map();
  for (const row of rows) {
    const size = await sizeOf(row.taskKey), big = isBig(size, limits), p = probeOf(row);
    const dep = chooseExecution({ big, probe: p.deployable }), orc = chooseExecution({ big, probe: p.oracle });
    const key = `${cellOf(row.taskKey)}\0${row.arm}`;
    const c = cells.get(key) ?? { cell: cellOf(row.taskKey), arm: row.arm, n: 0, big: 0, deployable: { child: 0, failed: 0, slow: 0 }, oracle: { child: 0, failed: 0 }, tokens: [Infinity, 0], units: [Infinity, 0] };
    c.n++; if (big) c.big++;
    if (dep.executedAs === 'child') c.deployable.child++; if (p.deployable.failed) c.deployable.failed++; if (p.deployable.slow) c.deployable.slow++;
    if (orc.executedAs === 'child') c.oracle.child++; if (p.oracle.failed) c.oracle.failed++;
    c.tokens = [Math.min(c.tokens[0], size.tokens), Math.max(c.tokens[1], size.tokens)]; c.units = [Math.min(c.units[0], size.units), Math.max(c.units[1], size.units)];
    cells.set(key, c);
    const t = tasks.get(row.taskKey) ?? { taskKey: row.taskKey, cell: cellOf(row.taskKey), big, attempts: 0, deployableChild: false, oracleChild: false };
    t.attempts++; t.deployableChild ||= dep.executedAs === 'child'; t.oracleChild ||= orc.executedAs === 'child';
    tasks.set(row.taskKey, t);
  }
  // Per cell over tasks: a task gets a child when any of its attempts would have triggered one.
  const byTaskCell = new Map();
  for (const t of tasks.values()) {
    const c = byTaskCell.get(t.cell) ?? { cell: t.cell, tasks: 0, big: 0, deployableChild: 0, oracleChild: 0 };
    c.tasks++; if (t.big) c.big++; if (t.deployableChild) c.deployableChild++; if (t.oracleChild) c.oracleChild++;
    byTaskCell.set(t.cell, c);
  }
  const sized = [];
  for (const spec of sizeOnly) for (const d of spec.difficulties) {
    const sizes = await Promise.all(spec.seeds.map(s => sizeOf(`${spec.family}:${spec.split ?? 'dev'}:d${d}:s${s}`)));
    sized.push({ cell: `${spec.family}@d${d}`, seeds: spec.seeds, tasks: sizes.length, big: sizes.filter(s => isBig(s, limits)).length,
      tokens: [Math.min(...sizes.map(s => s.tokens)), Math.max(...sizes.map(s => s.tokens))], units: [Math.min(...sizes.map(s => s.units)), Math.max(...sizes.map(s => s.units))] });
  }
  const h5Rows = [...cells.values()].filter(c => H5_FAMILIES.includes(c.cell.split('@')[0]));
  const n = h5Rows.reduce((s, c) => s + c.n, 0), dep = h5Rows.reduce((s, c) => s + c.deployable.child, 0), orc = h5Rows.reduce((s, c) => s + c.oracle.child, 0);
  const h5Sized = sized.filter(c => H5_FAMILIES.includes(c.cell.split('@')[0]));
  const h5 = { limit: H5_LIMIT, rows: n, cells: h5Rows.map(c => c.cell), deployableChild: dep, oracleChild: orc, deployableShare: share(dep, n), oracleShare: share(orc, n),
    sizeOnly: h5Sized.map(c => ({ cell: c.cell, tasks: c.tasks, big: c.big, s2Possible: c.big > 0 })),
    verdict: !n || share(dep, n) > H5_LIMIT || share(orc, n) > H5_LIMIT ? (n ? 'fail' : 'undetermined') : h5Sized.some(c => c.big > 0) ? 'undetermined' : 'pass' };
  const order = (a, b) => a.cell.localeCompare(b.cell) || String(a.arm ?? '').localeCompare(String(b.arm ?? ''));
  return { limits: { bigTokens: limits.bigTokens, bigUnits: limits.bigUnits }, cells: [...cells.values()].sort(order), tasks: [...byTaskCell.values()].sort(order), sizeOnly: sized, h5, notReplayable: [...NOT_REPLAYABLE] };
}

const readRows = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const files = arg('--rows', DEFAULT_ROWS.join(',')).split(',').filter(Boolean);
  const sizeOnly = arg('--size-only', DEFAULT_SIZE_ONLY.join(' ')).split(' ').filter(Boolean).map(parseSizeOnly);
  const inputs = files.map(f => { const abs = path.resolve(ROOT, f), text = readFileSync(abs, 'utf8'); return { path: path.relative(ROOT, abs), sha256: createHash('sha256').update(text).digest('hex'), rows: readRows(abs).length }; });
  const rows = files.flatMap(f => readRows(path.resolve(ROOT, f)));
  const r = await replayLatentDemand({ rows, sizeOnly });
  const out = { schema: 'rec-z1/1', evidence: 'development', costUsd: 0, at: new Date().toISOString(), inputs, ...r };
  for (const c of r.tasks) console.log(`${c.cell.padEnd(16)} tasks ${String(c.tasks).padStart(3)}  big ${String(c.big).padStart(3)}  child (deployable) ${String(c.deployableChild).padStart(3)}  child (oracle) ${String(c.oracleChild).padStart(3)}`);
  for (const c of r.sizeOnly) console.log(`${c.cell.padEnd(16)} size only: ${c.tasks} tasks, big ${c.big}, tokens ${c.tokens.join('-')}, units ${c.units.join('-')}`);
  console.log(`H5 (child share on ${H5_FAMILIES.join(', ')} <= ${H5_LIMIT}): deployable ${r.h5.deployableChild}/${r.h5.rows}, oracle ${r.h5.oracleChild}/${r.h5.rows}; size-only cells big ${r.h5.sizeOnly.map(c => `${c.cell} ${c.big}/${c.tasks}`).join(', ')} -> ${r.h5.verdict}`);
  const j = arg('--json', null);
  if (j) { mkdirSync(path.dirname(path.resolve(j)), { recursive: true }); writeFileSync(path.resolve(j), JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${j}`); }
}
