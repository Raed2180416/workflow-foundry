// Host-side client of the bridge mailbox for arm A1-C (harness/codeowned.mjs). It speaks the SAME protocol as the
// agent-side client tool.mjs (claim req-<n> with an exclusive create, write req-<n>.json.tmp, rename into place, wait for
// res-<n>.json), into the same mailbox directory the acting session later uses, so the bridge serves code-issued reads
// exactly as it serves an agent's tool calls: every batch is one world step in the host-only call log (calls.jsonl), the
// bridge refuses steps beyond max-steps - 1, and nothing here can see grades, assertions or host directories.
//
// The client records each batch it issues (node label, the pipeline's model-response count when issued, the number of
// calls) so the pipeline audit can apply H3 to code-issued steps too.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const RESULT_MAX_CHARS = 400_000;

/** A JSON tool call as the session would make it: {name, arguments: "<JSON string>"}. */
export const toolCall = (name, args) => ({ name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
/** api_fetch with params/body given as objects (serialized as the catalog requires: JSON strings or null). */
export function fetchCall(method, url, { params = null, body = null } = {}) {
  return toolCall('api_fetch', { method, url, params: params === null ? null : typeof params === 'string' ? params : JSON.stringify(params), body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body) });
}

/** Parse a tool result's text as JSON (null when it is not JSON). */
export function parseResult(content) {
  if (typeof content !== 'string') return content ?? null;
  try { return JSON.parse(content); } catch { return null; }
}

/** The HTTP-like status of an api_fetch result: 401 (no account), 404, 422, 400, 'error' (other error object), 200. */
export function resultStatus(content) {
  const j = parseResult(content);
  if (j === null) return /no .* account is connected/i.test(String(content)) ? 401 : 'text';
  const e = j && typeof j === 'object' && !Array.isArray(j) ? j.error : undefined;
  if (e === undefined || e === null || e === false) return 200;
  const code = typeof e === 'object' ? Number(e.code) : NaN;
  if (Number.isFinite(code)) return code;
  if (/no .* account is connected/i.test(JSON.stringify(e))) return 401;
  if (/not found/i.test(JSON.stringify(e))) return 404;
  return 'error';
}

/**
 * bridgeClient({ mailbox, waitMs, responsesSoFar, maxResponses }) -> { batch(calls, {node}) -> {results|error}, log, steps }.
 * responsesSoFar() returns the pipeline's model-response count at the moment a step is issued (for the H3 audit).
 * maxResponses (the official 50): once the pipeline has used that many model responses, no code-issued step is sent (the
 * official loop runs no world step from response 50 on, and the audit fails a task-run that issues one); the batch
 * returns an error and is logged as refused.
 */
export function bridgeClient({ mailbox, waitMs = 180_000, responsesSoFar = () => 0, maxResponses = Infinity, pollMs = 25 } = {}) {
  mkdirSync(mailbox, { recursive: true });
  const log = [];
  const claim = () => {
    for (let tries = 0; tries < 10_000; tries++) {
      const used = readdirSync(mailbox).map(f => /^req-(\d+)\.(?:json|claim)$/.exec(f)).filter(Boolean).map(m => Number(m[1]));
      const n = (used.length ? Math.max(...used) : 0) + 1;
      try { closeSync(openSync(path.join(mailbox, `req-${n}.claim`), 'wx')); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    throw new Error('could not claim a request slot');
  };
  async function batch(calls, { node = 'code' } = {}) {
    if (!Array.isArray(calls) || !calls.length) throw new Error('batch: at least one call');
    const atIssue = responsesSoFar();
    if (atIssue >= maxResponses) {
      log.push({ req: null, node, calls: calls.length, responsesAtIssue: atIssue, t0: Date.now() / 1000, refused: true, notIssued: 'response budget spent' });
      return { error: `not issued: the pipeline has used ${atIssue} of ${maxResponses} model responses (no world step after the last one)` };
    }
    const n = claim();
    const tmp = path.join(mailbox, `req-${n}.json.tmp`);
    writeFileSync(tmp, JSON.stringify({ v: 1, calls: calls.map(c => ({ name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) })) }));
    renameSync(tmp, path.join(mailbox, `req-${n}.json`));
    const entry = { req: n, node, calls: calls.length, responsesAtIssue: atIssue, t0: Date.now() / 1000 };
    log.push(entry);
    const res = path.join(mailbox, `res-${n}.json`);
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      if (existsSync(res)) {
        try {
          const r = JSON.parse(readFileSync(res, 'utf8'));
          entry.t1 = Date.now() / 1000;
          entry.refused = Boolean(r.error);
          if (r.results) r.results = r.results.map(x => ({ name: x.name, content: String(x.content ?? '').slice(0, RESULT_MAX_CHARS) }));
          return r;
        } catch { /* being written */ }
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    entry.refused = true;
    entry.timeout = true;
    return { error: `the environment did not answer within ${Math.round(waitMs / 1000)} s` };
  }
  return { batch, log, get steps() { return log.filter(e => !e.refused).length; } };
}
