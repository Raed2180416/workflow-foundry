// C0's per-task config (its date-order reads), recovered from the model-call journal: run-compiled keeps only the last 8000
// characters of the solver's stderr, which drops the `config [...]` log line. The config call is the solver's readConfig()
// judge (Sonnet, then Opus on a failed check); its schema check passes on any non-empty systems array, so the first ok call
// per run is the value used. C0's own data override (solve.mjs readConfig/numericEvidence) is then re-applied verbatim.
import { DatabaseSync } from 'node:sqlite';

export function loadC0Configs(journalFile) {
  const db = new DatabaseSync(journalFile, { readOnly: true });
  const rows = db.prepare("SELECT id, run_id, model_id, response, ok, created_at FROM model_calls WHERE ok = 1 AND request LIKE '%numeric_date_order%' ORDER BY id").all();
  db.close();
  const bySeed = new Map();   // latest run per seed (a retried run supersedes)
  for (const r of rows) {
    const seed = Number((/:s(\d+):/.exec(r.run_id) ?? [])[1]);
    let value = null;
    try { const resp = JSON.parse(r.response); value = resp.value ?? JSON.parse(resp.text); } catch { continue; }
    if (bySeed.get(seed)?.runId === r.run_id) continue;   // first ok call of a run wins; a later run replaces an earlier one
    bySeed.set(seed, { runId: r.run_id, model: r.model_id, systems: value.systems });
  }
  return bySeed;
}

// solve.mjs lines 116-138, verbatim logic.
export function applyOverride(systems, exportText) {
  const lines = String(exportText).split('\n').map(s => s.trim()).filter(Boolean);
  const sysOf = line => ((/^([A-Za-z]+)/.exec(line) || [])[1] || '').toUpperCase();
  return systems.map(c0 => {
    const c = { ...c0 };
    let dmy = 0, mdy = 0;
    for (const line of lines) {
      if (sysOf(line) !== String(c.name).toUpperCase()) continue;
      for (const m of line.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g)) {
        const a = +m[1], b = +m[2];
        if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++;
      }
    }
    let order = c.numeric_date_order;
    if (dmy > 0 && mdy === 0) order = 'DMY'; else if (mdy > 0 && dmy === 0) order = 'MDY';
    c.overridden = order !== c.numeric_date_order ? { from: c.numeric_date_order, dmy, mdy } : null;
    c.numeric_date_order = order;
    return c;
  });
}
