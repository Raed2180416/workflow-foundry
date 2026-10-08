// Shared fixtures for the heal tests: the recorded C0/P1 runs, the frozen kit and the pinned gate. No live calls anywhere:
// every model node is served from a COPY of a recorded journal or by a scripted provider.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { REPO, KIT_DIR, loadKit } from '../kit.mjs';
import { loadGate } from '../pin-gate.mjs';
import { allTrials, loadWorkflow, p1Workflow } from '../replay.mjs';

export const HAVE_DATA = existsSync(KIT_DIR) && existsSync(path.join(REPO, 'experiments/runs/c0-dev/journal.sqlite')) && existsSync(path.join(REPO, 'experiments/runs/p1/journal.sqlite'));
export const skipReason = HAVE_DATA ? false : 'the frozen kit or the recorded C0/P1 journals are not present';
export const artifact = name => loadWorkflow(path.join(REPO, 'research/construction-20261006/artifacts', name, 'workflow.json'));
export const workflows = async () => ({ records: await artifact('F-haiku-records-k1'), codefix: await artifact('F-haiku-codefix-k1'), p1: await p1Workflow('M') });
let cache;
export async function world() {
  if (cache) return cache;
  const [kit, gate] = await Promise.all([loadKit(), loadGate()]);
  cache = { kit, gate, trials: allTrials(), wf: await workflows() };
  return cache;
}
export const byKey = (trials, key) => trials.find(t => t.key === key);
export const modelIds = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

// A scripted "model" that answers a node's request with the value recorded for the same request in a journal, optionally corrected
// for chosen runs. `keyOf(request)` decides what "the same request" means: by default the exact prompt (system, prompt, schema); the
// notes key matches a changed class or reader tag. Test double only: it reads recorded answers, it never calls a model.
import { DatabaseSync } from 'node:sqlite';
export const notesKey = a => /<input name="source_notes"[^>]*>\n([\s\S]*?)\n<\/input>/.exec(a.prompt)?.[1] ?? null;
export function journalScript(kit, journalFile, nodeSuffix, { fixRuns = new Set(), fix = v => v, cost = 0.001, keyOf = null, extend = v => v, override = null } = {}) {
  const key = keyOf ?? (a => kit.digest({ system: a.system, prompt: a.prompt, schema: a.schema }));
  const db = new DatabaseSync(journalFile, { readOnly: true }), idx = new Map();
  for (const r of db.prepare(`SELECT run_id, request, response FROM model_calls WHERE ok=1 AND node_key LIKE ?`).all(`%/${nodeSuffix}`)) {
    const req = JSON.parse(r.request ?? '{}'); if (typeof req.system !== 'string') continue;
    let value = JSON.parse(r.response).value; if (fixRuns.has(r.run_id)) value = fix(value);
    idx.set(key(req), value);
  }
  db.close();
  return args => {
    const k = key(args); let v = idx.get(k);
    if (override) v = override(args, v, k) ?? v;
    if (v === undefined) throw Object.assign(new Error('no recorded answer for this request'), { code: 'SCRIPT_EXHAUSTED' });
    return { value: extend(structuredClone(v), args), costUsd: cost, usage: { inputTokens: 100, outputTokens: 20 } };
  };
}
