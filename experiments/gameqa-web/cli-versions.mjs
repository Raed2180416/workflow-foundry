#!/usr/bin/env node
// Claude CLI version per GQA-1 run, from the local model journals ($0; review finding m1). meta.json of the A1 runs did not
// record the CLI version, so the claim "2.1.312 on 2026-10-28, 2.1.318 on 2026-11-04" had nothing committed behind it. The
// journals (experiments/runs/gameqa-web/<runId>/journal.sqlite, git-ignored because they can carry host account identity)
// record the provider's engine version for every call; this script copies out only that column, the call count and the
// first and last call time, per run. A2 runs also carry meta.cli {start, end}.
//   node experiments/gameqa-web/cli-versions.mjs > research/gameqa-20261021/analysis/cli-versions.json
import { readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(ROOT, 'experiments/runs/gameqa-web');
const dirs = existsSync(base) ? readdirSync(base).flatMap(d => (d === '_harness-fault' ? readdirSync(path.join(base, d)).map(x => path.join(d, x)) : [d])) : [];
const runs = [];
for (const d of dirs.sort()) {
  const f = path.join(base, d, 'journal.sqlite');
  if (!existsSync(f)) continue;
  const db = new DatabaseSync(f, { readOnly: true });
  try {
    const rows = db.prepare('select engine_version as version, count(*) as calls, min(created_at) as first, max(created_at) as last from model_calls group by engine_version').all();
    runs.push({ run: d, versions: rows.map(r => ({ version: r.version, calls: r.calls, first: new Date(r.first).toISOString(), last: new Date(r.last).toISOString() })) });
  } finally { db.close(); }
}
const byVersion = {};
for (const r of runs) for (const v of r.versions) (byVersion[v.version] ??= []).push(r.run);
console.log(JSON.stringify({ note: 'Claude CLI engine version per GQA-1 run, copied from the local model journals (engine_version column only).', byVersion, runs }, null, 1));
