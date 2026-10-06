// Model-call record/replay journal (DESIGN §3). Rows are committed synchronously, so a
// response is durable before the caller can observe it (R2 journal-before-observe).
import { DatabaseSync } from 'node:sqlite';
import { FoundryError, canonical } from './data.mjs';

// Model-behaviour outcomes are reproducible and replay; environment faults never do.
export const REPLAYABLE_ERRORS = Object.freeze(['MODEL_SCHEMA', 'MODEL_TRUNCATED', 'MODEL_REFUSAL']);
const replayableSql = `(ok=1 OR error_code IN (${REPLAYABLE_ERRORS.map(c => `'${c}'`).join(',')}))`;
export const isReplayable = row => !!row && (row.ok || REPLAYABLE_ERRORS.includes(row.errorCode));

const json = value => value === undefined || value === null ? null : canonical(value);
const parse = text => text == null ? null : JSON.parse(text);
const int = (v, name, min = 0) => {
  if (v === undefined || v === null) return null;
  if (!Number.isSafeInteger(v) || v < min) throw new FoundryError('JOURNAL_ENTRY', `${name} must be an integer >= ${min}`);
  return v;
};
const num = (v, name) => {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new FoundryError('JOURNAL_ENTRY', `${name} must be a non-negative number`);
  return v;
};
const str = (v, name, required = false) => {
  if (v === undefined || v === null) { if (required) throw new FoundryError('JOURNAL_ENTRY', `${name} is required`); return null; }
  if (typeof v !== 'string' || (required && !v)) throw new FoundryError('JOURNAL_ENTRY', `${name} must be a string`);
  return v;
};
const row = r => r && ({
  id: r.id, replayKey: r.replay_key, runId: r.run_id, nodeKey: r.node_key, attempt: r.attempt, sampleIndex: r.sample_index,
  modelId: r.model_id, provider: r.provider, engineVersion: r.engine_version, decoding: parse(r.decoding), receiptHash: r.receipt_hash,
  promptHash: r.prompt_hash, request: parse(r.request), response: parse(r.response), ok: r.ok === 1, errorCode: r.error_code,
  inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, imputedUsd: r.imputed_usd, latencyMs: r.latency_ms, createdAt: r.created_at,
});

export class Journal {
  constructor(db) {
    const handle = db instanceof DatabaseSync ? db : db?.db;
    if (!(handle instanceof DatabaseSync)) throw new FoundryError('JOURNAL_DB', 'Journal requires a node:sqlite DatabaseSync handle');
    this.db = handle;
    handle.exec(`CREATE TABLE IF NOT EXISTS model_calls(id INTEGER PRIMARY KEY, replay_key TEXT NOT NULL, run_id TEXT NOT NULL, node_key TEXT NOT NULL,
        attempt INT, sample_index INT, model_id TEXT NOT NULL, provider TEXT, engine_version TEXT, decoding TEXT, receipt_hash TEXT, prompt_hash TEXT,
        request TEXT, response TEXT, ok INT NOT NULL, error_code TEXT, input_tokens INT, output_tokens INT, cost_usd REAL, imputed_usd REAL,
        latency_ms INT, created_at INT NOT NULL);
      CREATE INDEX IF NOT EXISTS model_calls_replay ON model_calls(replay_key, id);
      CREATE INDEX IF NOT EXISTS model_calls_attempt ON model_calls(run_id, node_key, attempt, id);`);
    this.statements = {
      insert: handle.prepare(`INSERT INTO model_calls(replay_key,run_id,node_key,attempt,sample_index,model_id,provider,engine_version,decoding,receipt_hash,
        prompt_hash,request,response,ok,error_code,input_tokens,output_tokens,cost_usd,imputed_usd,latency_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
      lookup: handle.prepare(`SELECT * FROM model_calls WHERE replay_key=? AND ${replayableSql} ORDER BY id DESC LIMIT 1`),
      attempt: handle.prepare('SELECT * FROM model_calls WHERE run_id=? AND node_key=? AND attempt=? ORDER BY id'),
      run: handle.prepare('SELECT * FROM model_calls WHERE run_id=? ORDER BY id'),
      get: handle.prepare('SELECT * FROM model_calls WHERE id=?'),
      cost: handle.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(imputed_usd),0) AS imputed,
        COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COALESCE(SUM(ok=0),0) AS errors FROM model_calls WHERE run_id=?`),
    };
  }

  record(entry) {
    if (!entry || typeof entry !== 'object') throw new FoundryError('JOURNAL_ENTRY', 'A journal entry object is required');
    const ok = entry.ok === true;
    if (!ok && !str(entry.errorCode, 'errorCode', true)) throw new FoundryError('JOURNAL_ENTRY', 'A failed call needs an errorCode');
    const { lastInsertRowid } = this.statements.insert.run(
      str(entry.replayKey, 'replayKey', true), str(entry.runId, 'runId', true), str(entry.nodeKey, 'nodeKey', true),
      int(entry.attempt, 'attempt'), int(entry.sampleIndex, 'sampleIndex'), str(entry.modelId, 'modelId', true), str(entry.provider, 'provider'),
      str(entry.engineVersion, 'engineVersion'), json(entry.decoding), str(entry.receiptHash, 'receiptHash'), str(entry.promptHash, 'promptHash'),
      json(entry.request), json(entry.response), ok ? 1 : 0, ok ? null : entry.errorCode,
      int(entry.inputTokens, 'inputTokens'), int(entry.outputTokens, 'outputTokens'), num(entry.costUsd, 'costUsd'), num(entry.imputedUsd, 'imputedUsd'),
      int(entry.latencyMs, 'latencyMs'), Date.now());
    return Number(lastInsertRowid);
  }
  get(id) { return row(this.statements.get.get(id)); }
  /** Latest replayable row for a key (ok, or a model-behaviour error); environment faults are skipped. */
  lookup(replayKey) { return row(this.statements.lookup.get(replayKey)); }
  forAttempt(runId, nodeKey, attempt) { return this.statements.attempt.all(runId, nodeKey, attempt).map(row); }
  forRun(runId) { return this.statements.run.all(runId).map(row); }
  costForRun(runId) {
    const r = this.statements.cost.get(runId);
    return { calls: r.calls, costUsd: r.cost, imputedUsd: r.imputed, inputTokens: r.input, outputTokens: r.output, errors: r.errors };
  }
}
