// One archived compiled answer, replayed at $0 (A10 / #42): the version in force, a STRICT memo port over that run's own
// journal rows (run-compiled.mjs createMemoPort; a request the journal cannot answer throws REPLAY_MISS and nothing is
// spent), the tier-down override (override.mjs) in the sandbox, and the bed oracle on the output.
//
// Every model request the solver sends is recorded twice: by the override (judge name, call site, request key, tier) and
// by the port wrapper below (the archived row that answered it, with that row's original cost and latency). Joined on
// the request key, they give each judge's delivery-time spend at the tier the archive ran it.
import path from 'node:path';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCompiled, createMemoPort, memoRowOf, requestDigestOf, looseDigestOf } from '../jit/run-compiled.mjs';
import { loadFamily, makeTasks } from '../lib/beds.mjs';
import { requestKeyOf, canonical } from './override.mjs';
import { assertDevRow, rowJournal, solverOf, sha256 } from './archive.mjs';

export const OVERRIDE_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'override.mjs');

const beds = new Map(), tasks = new Map();
export async function bedOf(family) { if (!beds.has(family)) beds.set(family, await loadFamily(family)); return beds.get(family); }
export async function taskOf(row) {
  if (!tasks.has(row.taskKey)) {
    const k = assertDevRow(row);
    const [t] = await makeTasks(k.family, { split: k.split, seeds: [k.seed], difficulty: k.difficulty });
    tasks.set(row.taskKey, t.task);
  }
  return tasks.get(row.taskKey);
}

// The archived answers' original costs, in the k-th-answer order the memo port serves them (same keys as memoRowOf).
export function costIndexOf(journal) {
  const byDigest = new Map(), byLoose = new Map();
  for (const row of journal) {
    const m = memoRowOf(row);
    if (!m) continue;
    const entry = { costUsd: row.costUsd ?? 0, latencyMs: row.latencyMs ?? null, inputTokens: row.inputTokens ?? null, outputTokens: row.outputTokens ?? null, modelId: m.model };
    const [map, k] = m.digest ? [byDigest, m.digest] : [byLoose, m.loose];
    if (!map.has(k)) map.set(k, []); map.get(k).push(entry);
  }
  return { byDigest, byLoose };
}

// A model port that answers from the journal (strict) and records, per request, the original row's cost and the
// request key (override.mjs requestKeyOf), so the override log can be joined to spend.
export function recordingMemoPort(journal) {
  const memo = createMemoPort({ journal, strict: true }), costs = costIndexOf(journal), cursor = new Map(), calls = [];
  const take = (map, k) => { const list = map.get(k); if (!list) return null; const i = cursor.get(k) ?? 0; cursor.set(k, i + 1); return list[Math.min(i, list.length - 1)]; };
  return {
    ...memo,
    calls,
    async call(req) {
      const key = requestKeyOf({ system: req.system, prompt: req.prompt, schema: req.schema });
      const digest = requestDigestOf(req), loose = looseDigestOf(req);
      try {
        const r = await memo.call(req);
        const orig = take(costs.byDigest, digest) ?? take(costs.byLoose, loose);
        calls.push({ key, promptSha: sha256(String(req.prompt ?? '')), modelId: req.modelId, served: true, ok: r.ok, value: r.ok ? r.value : undefined,
          origCostUsd: orig?.costUsd ?? null, origLatencyMs: orig?.latencyMs ?? null, origInputTokens: orig?.inputTokens ?? null, origOutputTokens: orig?.outputTokens ?? null });
        return r;
      } catch (e) {
        calls.push({ key, promptSha: sha256(String(req.prompt ?? '')), modelId: req.modelId, served: false, miss: e.code ?? 'ERROR' });
        throw e;
      }
    },
  };
}

const readLog = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// Replay one row. overrideData: override.mjs data ({serve: [...]}); logging is always on. Returns
// {status, output, pass, score, oracle, memo, calls, log, judges, deopt, error}.
export async function replayRow({ arm, row, flowPath, overrideData = {}, work, keep = false, timeoutMs = 10 * 60 * 1000 }) {
  const task = await taskOf(row), bed = await bedOf(arm.family), solvePath = solverOf(arm, row);
  if (!solvePath) return { status: 'no-solver' };
  const journal = rowJournal(arm, row), port = recordingMemoPort(journal);
  const workdir = path.join(work, `${arm.experiment}-${arm.slug}-${row.idx}-${sha256(canonical(overrideData)).slice(0, 10)}`);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  try {
    const run = await runCompiled({ solvePath, task, modelPort: port, perTaskUsd: 1, timeoutMs, workdir, familyId: arm.family, flowPath, label: 'tierdown-replay',
      flowOverride: OVERRIDE_MODULE, flowOverrideData: { ...overrideData, log: true } });
    const log = readLog(path.join(workdir, 'override-log.jsonl'));
    const sc = run.status === 'ok' ? bed.oracle(task, run.output) : null;
    // Each judge event with its request key: computed from the event's own text, or (a prompt the trace truncated) found
    // through the port record with the same prompt hash.
    const judges = (run.trace ?? []).filter(e => e.kind === 'judge').map(e => {
      const key = e.truncated ? (port.calls.find(c => c.promptSha === e.promptSha256)?.key ?? null) : requestKeyOf({ system: e.system, prompt: e.prompt, schema: e.schema });
      return { name: e.name, key, ok: e.ok !== false, value: e.value, tier: e.tier ?? null, tiersTried: e.tiersTried ?? [], samples: e.samples ?? null,
        overridden: e.overridden ?? 0, error: e.error ?? null, schema: e.schema ?? null };
    });
    return { status: run.status, output: run.output, pass: sc ? !!sc.pass : false, score: sc ? sc.score : null, deopt: run.deopt ?? null, error: run.error ?? null,
      memo: port.memo.stats(), calls: port.calls, log, judges, journalRows: journal.length };
  } finally {
    if (!keep) rmSync(workdir, { recursive: true, force: true });
  }
}
