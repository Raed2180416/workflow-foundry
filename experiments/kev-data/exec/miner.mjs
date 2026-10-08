// The journal miner (JUDGE-PROGRAM.md §1.2 F1 "REAL-TRACE", §3.5): real journaled failures with a REPLAY label, as a case study.
//
// The model-call journals of the experiments (experiments/runs/**/journal*.sqlite, table model_calls, src/journal.mjs) hold the
// failures of real runs. A failed call is labelled ONLY by what a replay of it did: a later call with the same prompt hash on the
// same model that passed is a replay that passed, which is the healer's first check (flake). A failed call with no such later
// call is left unlabelled (the checks that would decide it were not run), and no label ever comes from reading the message: the
// probe's 9 real items were labelled "from the message" by an LLM agent and were dropped (§3.5).
//
// The availability rule (§3.5): an axis counts only with >= 30 independent tasks and >= 300 labelled rows. Until then the output is
// a case study, written under .foundry/kev-data/case-study/ (git-ignored), never to a Kev file, never to training. Journals are
// opened read-only; a running experiment's journal is only read.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/contracts.mjs';
import { f1State } from '../judges/failures.mjs';

export const AVAILABLE_TASKS = 30, AVAILABLE_ROWS = 300;
// a cancelled call is an operator abort, not a failure (§3.5; the probe excluded it too)
const NOT_A_FAILURE = new Set(['CANCELLED', 'ABORT_ERR']);

export function findJournals(root = path.join(REPO_ROOT, 'experiments', 'runs')) {
  const out = [];
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'work') walk(p); } else if (/^journal.*\.sqlite$/.test(e.name) || /\.journal\.sqlite$/.test(e.name)) out.push(p);
    }
  };
  try { walk(root); } catch { /* no runs directory */ }
  return out.sort();
}

export function mineJournal(file, { source = path.basename(path.dirname(file)) } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT id, run_id, node_key, attempt, model_id, ok, error_code, prompt_hash, json_extract(response,'$.error.message') AS message FROM model_calls ORDER BY id`).all();
    const mined = [];
    rows.forEach((r, i) => {
      if (r.ok || !r.error_code || NOT_A_FAILURE.has(r.error_code)) return;
      const later = rows.slice(i + 1).filter(x => x.prompt_hash === r.prompt_hash && x.model_id === r.model_id);
      const earlier = rows.slice(0, i).filter(x => x.node_key === r.node_key && x.run_id !== r.run_id && !NOT_A_FAILURE.has(x.error_code));
      const passed = later.some(x => x.ok);
      const failure = { node: { kind: 'agent', attempts: Math.max(1, (r.attempt ?? 0) + 1), error: { code: r.error_code, message: String(r.message ?? r.error_code) } },
        priorRuns: earlier.map(x => ({ ok: Boolean(x.ok), code: x.ok ? null : x.error_code })) };
      mined.push({ source, journalId: r.id, task: `${source}:${r.run_id}`, node: r.node_key, state: f1State(failure),
        label: passed ? 'flake' : null, labelBasis: passed ? `replay: a later call with the same prompt hash on ${r.model_id} passed (journal row ${later.find(x => x.ok).id})` : 'unlabelled: no replay of this call is journaled',
        laterCalls: later.length });
    });
    return { file, calls: rows.length, failures: mined.length, rows: mined };
  } finally { db.close(); }
}

// All journals: the case-study table and its availability verdict.
export function mineAll({ root, files = findJournals(root) } = {}) {
  const per = files.map(f => { try { return mineJournal(f); } catch (e) { return { file: f, calls: 0, failures: 0, rows: [], error: e.message.slice(0, 100) }; } });
  const rows = per.flatMap(p => p.rows), labelled = rows.filter(r => r.label);
  const tasks = new Set(labelled.map(r => r.task));
  return { journals: per.map(p => ({ file: path.relative(REPO_ROOT, p.file), calls: p.calls, failures: p.failures, error: p.error ?? null })), rows, labelled: labelled.length, unlabelled: rows.length - labelled.length,
    tasks: tasks.size, labels: labelled.reduce((m, r) => ({ ...m, [r.label]: (m[r.label] ?? 0) + 1 }), {}),
    available: tasks.size >= AVAILABLE_TASKS && labelled.length >= AVAILABLE_ROWS,
    status: tasks.size >= AVAILABLE_TASKS && labelled.length >= AVAILABLE_ROWS ? 'available' : `case study: ${tasks.size} tasks and ${labelled.length} labelled rows (the availability minimum is ${AVAILABLE_TASKS} tasks and ${AVAILABLE_ROWS} rows)` };
}

export function writeCaseStudy(result, dir = path.join(REPO_ROOT, '.foundry', 'kev-data', 'case-study')) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'f1-journal-replay.jsonl');
  writeFileSync(file, result.rows.map(r => JSON.stringify(r)).join('\n') + (result.rows.length ? '\n' : ''));
  writeFileSync(path.join(dir, 'f1-journal-replay.summary.json'), JSON.stringify({ journals: result.journals, labelled: result.labelled, unlabelled: result.unlabelled, tasks: result.tasks, labels: result.labels, status: result.status }, null, 2) + '\n');
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const r = mineAll();
  console.log(JSON.stringify({ journals: r.journals, labelled: r.labelled, unlabelled: r.unlabelled, tasks: r.tasks, labels: r.labels, status: r.status }, null, 2));
  if (process.argv.includes('--write')) console.log(writeCaseStudy(r));
}
