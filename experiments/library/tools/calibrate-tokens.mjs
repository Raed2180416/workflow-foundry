// Rebuild experiments/library/fixtures/token-calibration.json from model-call journals that recorded the provider's own
// input-token counts for claude-haiku-5-5 (claude CLI provider). $0: it only reads existing journals.
//
//   node experiments/library/tools/calibrate-tokens.mjs <journal.jsonl | journal.sqlite> ... > fixtures/token-calibration.json
//
// Per successful call: the text the gateway sent (system + prompt + JSON schema), reduced to the counter's features
// (tokens.mjs featuresOf: letter runs, letter chars, digit chars, punctuation chars), and the measured input tokens
// (input + cache read + cache write; the CLI's own system prompt is in there too, which is why the fit carries a
// per-journal intercept). Only numbers are written: no prompt text leaves the journals.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { featuresOf } from '../tokens.mjs';

const MODEL = 'claude-haiku-5-5';
const textOf = b => `${b.system ?? ''}\n${b.prompt ?? ''}\n${b.schema ? JSON.stringify(b.schema) : ''}`;
const rows = [];
for (const file of process.argv.slice(2)) {
  const ds = path.basename(path.dirname(file)) + '/' + path.basename(file);
  if (file.endsWith('.jsonl')) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (!r.ok || r.modelId !== MODEL || !r.request?.body) continue;
      rows.push({ ds, chars: textOf(r.request.body).length, ...featuresOf(textOf(r.request.body)), tokens: (r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0) });
    }
  } else {
    const db = new DatabaseSync(file, { readOnly: true });
    for (const r of db.prepare('SELECT request, input_tokens a, cache_read_tokens b, cache_write_tokens c FROM model_calls WHERE ok = 1 AND model_id = ?').all(MODEL)) {
      let b; try { b = JSON.parse(r.request); } catch { continue; }
      rows.push({ ds, chars: textOf(b.body ?? b).length, ...featuresOf(textOf(b.body ?? b)), tokens: (r.a ?? 0) + (r.b ?? 0) + (r.c ?? 0) });
    }
    db.close();
  }
}
// Least squares: tokens ~ intercept[ds] + a*lRuns + b*lChars + c*dChars + d*punct (normal equations, Gauss-Jordan).
const dss = [...new Set(rows.map(r => r.ds))], F = ['lRuns', 'lChars', 'dChars', 'punct'];
const X = rows.map(r => [...dss.map(d => (r.ds === d ? 1 : 0)), ...F.map(f => r[f])]), y = rows.map(r => r.tokens), k = X[0].length;
const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b]; A[a][k] += X[i][a] * y[i]; }
for (let c = 0; c < k; c++) {
  let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
  [A[c], A[p]] = [A[p], A[c]];
  for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
}
const beta = A.map((row, i) => row[k] / row[i]);
const intercepts = Object.fromEntries(dss.map((d, i) => [d, Math.round(beta[i])]));
const coefficients = Object.fromEntries(F.map((f, i) => [f, Math.round(beta[dss.length + i] * 1e4) / 1e4]));
const rmse = Math.sqrt(rows.reduce((s, r, i) => s + (y[i] - X[i].reduce((t, v, j) => t + v * beta[j], 0)) ** 2, 0) / rows.length);
process.stdout.write(JSON.stringify({ schema: 'token-calibration/1', model: MODEL, generatedBy: 'experiments/library/tools/calibrate-tokens.mjs',
  sources: dss, fit: { intercepts, coefficients, rmse: Math.round(rmse * 10) / 10, n: rows.length },
  rows: rows.map(r => [dss.indexOf(r.ds), r.lRuns, r.lChars, r.dChars, r.punct, r.chars, r.tokens]), columns: ['ds', 'lRuns', 'lChars', 'dChars', 'punct', 'chars', 'tokens'] }) + '\n');
