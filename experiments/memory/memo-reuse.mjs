// X4 memo reuse count (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2 "Memory tests"; MEM-0, $0): memo
// `reused` hits across task ids in the existing journals; must be 0 for claim-bearing runs. Per arm of a JIT stream run
// directory (stream.mjs layout: <run>/<arm>/results.jsonl, journal.jsonl), two counts:
// - recorded: the memo counts the stream wrote on its compiled events (jit.replayJournal arms only), reused by task index;
// - replayed: the arm's own journal served to its task-run requests in journal order, the way a replay arm's memo port
//   would serve it (run-compiled.mjs createMemoPort: one port per arm, a cursor per request key, every servable row of the
//   journal as the source): hits, hits answered with a row another task (or a compile / host-check run) journaled
//   (crossTask), requests past a key's last answer (reused: 0 under M3, stream.mjs REPLAY_MEMO_OPTIONS; reusedIfOn: what
//   reuse would have served).
// A test-split run is claim-bearing: any recorded reused hit there fails the check (exit 1).
//   node experiments/memory/memo-reuse.mjs [runDir...] [--json]   (default: research/jit-20261008/runs/*)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoRowOf } from '../jit/run-compiled.mjs';
import { REPLAY_MEMO_OPTIONS } from '../jit/stream.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

/** The task index of a journal row's run (stream.mjs labels compiled runs `<experiment>:<arm>:<idx>:v<version>`), else null. */
export const taskOfRunId = runId => { const m = /^[^:]+:[^:]+:(\d+):v\d+:/.exec(String(runId ?? '')); return m ? Number(m[1]) : null; };
const keyOfMemo = m => (m.digest ? `d:${m.digest}` : `l:${m.loose}`);
const keyOfRow = row => (row.requestDigest ? `d:${row.requestDigest}` : row.requestDigestLoose ? `l:${row.requestDigestLoose}` : null);

/** Replay an arm's journal rows (journal order) against themselves as the replay memo serves them. */
export function replayCount(rows, { dir = null, reuse = REPLAY_MEMO_OPTIONS.reuse } = {}) {
  const lists = new Map(), cursor = new Map();
  let servable = 0;
  for (const row of rows) {
    const m = memoRowOf(row, { dir });
    if (!m) continue;
    servable++;
    const k = keyOfMemo(m);
    if (!lists.has(k)) lists.set(k, []);
    lists.get(k).push({ task: taskOfRunId(row.runId) });
  }
  const out = { rows: rows.length, servable, taskRequests: 0, hits: 0, crossTask: 0, reused: 0, reusedIfOn: 0, live: 0, crossTaskByTask: {} };
  for (const row of rows) {
    const task = taskOfRunId(row.runId);
    if (task === null) continue;
    out.taskRequests++;
    const m = memoRowOf(row, { dir }), k = m ? keyOfMemo(m) : keyOfRow(row);
    const list = k ? lists.get(k) : null, i = k ? cursor.get(k) ?? 0 : 0;
    if (k) cursor.set(k, i + 1);
    if (list && i < list.length) {
      out.hits++;
      if (list[i].task !== task) { out.crossTask++; out.crossTaskByTask[task] = (out.crossTaskByTask[task] ?? 0) + 1; }
    } else if (list?.length) { out.reusedIfOn++; if (reuse) out.reused++; else out.live++; }
    else out.live++;
  }
  return out;
}

/** The memo counts a stream recorded on its compiled events, with reused by task index. */
export function recordedCount(results) {
  const out = { requests: 0, hits: 0, reused: 0, live: 0, reusedByTask: {}, compiledRuns: 0 };
  for (const r of results) for (const e of r.events ?? []) {
    if (e.kind !== 'compiled' || !e.memo) continue;
    out.compiledRuns++;
    for (const k of ['requests', 'hits', 'reused', 'live']) out[k] += e.memo[k] ?? 0;
    if (e.memo.reused > 0) out.reusedByTask[r.idx] = (out.reusedByTask[r.idx] ?? 0) + e.memo.reused;
  }
  return out;
}

/** Every arm of a run directory: { run, arm, split, claimBearing, recorded, replayed, violation }. */
export function scanRun(runDir) {
  const arms = [];
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(runDir, d.name), results = readJsonl(path.join(dir, 'results.jsonl'));
    if (!results.length && !existsSync(path.join(dir, 'journal.jsonl'))) continue;
    const split = results.find(r => r.taskKey)?.taskKey.split(':')[1] ?? null, claimBearing = split === 'test';
    const recorded = recordedCount(results);
    const replayed = existsSync(path.join(dir, 'journal.jsonl')) ? replayCount(readJsonl(path.join(dir, 'journal.jsonl')), { dir }) : null;
    arms.push({ run: path.basename(runDir), arm: d.name, split, claimBearing, recorded, replayed, violation: claimBearing && recorded.reused > 0 });
  }
  return arms.sort((a, b) => a.arm.localeCompare(b.arm));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), json = argv.includes('--json');
  let dirs = argv.filter(a => a !== '--json');
  if (!dirs.length) { const root = path.join(REPO, 'research/jit-20261008/runs'); dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(root, d.name)); }
  const arms = dirs.flatMap(d => scanRun(path.resolve(d)));
  if (json) console.log(JSON.stringify(arms, null, 1));
  else {
    console.log('run | arm | split | recorded memo requests/hits/reused/live | journal task requests | replayed hits (cross-task) | reused (if reuse were on) | live');
    for (const a of arms) {
      const r = a.recorded, p = a.replayed;
      console.log(`${a.run} | ${a.arm} | ${a.split ?? '-'}${a.claimBearing ? ' (claim-bearing)' : ''} | ${r.compiledRuns ? `${r.requests}/${r.hits}/${r.reused}/${r.live}` : 'no replay arm'} | `
        + `${p ? `${p.taskRequests} | ${p.hits} (${p.crossTask}) | ${p.reused} (${p.reusedIfOn}) | ${p.live}` : 'no journal | - | - | -'}${a.violation ? ' | VIOLATION: reused on a claim-bearing run' : ''}`);
    }
    const t = arms.reduce((s, a) => ({ reused: s.reused + a.recorded.reused, replayedReused: s.replayedReused + (a.replayed?.reused ?? 0), crossTask: s.crossTask + (a.replayed?.crossTask ?? 0), reusedIfOn: s.reusedIfOn + (a.replayed?.reusedIfOn ?? 0) }), { reused: 0, replayedReused: 0, crossTask: 0, reusedIfOn: 0 });
    console.log(`totals: recorded reused ${t.reused}; replayed reused ${t.replayedReused} (would be ${t.reusedIfOn} with reuse on); cross-task hits ${t.crossTask}; claim-bearing violations ${arms.filter(a => a.violation).length}`);
  }
  process.exit(arms.some(a => a.violation) ? 1 : 0);
}
