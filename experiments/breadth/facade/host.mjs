// Bed facade, host side (outside the executor sandbox): answers the relay's mailbox (mcp-relay.mjs) for one session.
// World tools go to the bed process (bed-process.mjs); `python` goes to the sandboxed python tool (python-tool.mjs).
// Requests are untrusted files in an agent-writable directory: only regular files under a size cap are read, names
// must be in the session's catalog, arguments must be a JSON object, and responses are written to a fresh temporary
// name and renamed into place (a planted link at the response path is replaced, never followed). Every call is
// journaled host-side (calls.jsonl), in the order the world saw it.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';
import { faultState } from './faults.mjs';
import { PYTHON_TOOL, runPythonTool } from './python-tool.mjs';

export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_TEXT_CHARS = 100_000;
export const STOPPED_TEXT = 'The environment has stopped after an earlier tool error; no further actions are possible in this task.';

const sha256 = s => createHash('sha256').update(s).digest('hex');

/** Write a response atomically: exclusive-create a random temporary file, then rename over the target name. */
export function writeResponse(box, n, obj) {
  const tmp = path.join(box, `.res-${n}-${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o644);
  try { writeSync(fd, JSON.stringify(obj)); } finally { closeSync(fd); }
  renameSync(tmp, path.join(box, `res-${n}.json`));
}

/** Read one request file if it is a regular file under the cap; null otherwise (with the reason). */
export function readRequest(file) {
  let st;
  try { st = lstatSync(file); } catch { return { error: 'vanished' }; }
  if (!st.isFile()) return { error: 'not a regular file' };
  if (st.size > MAX_REQUEST_BYTES) return { error: `request over ${MAX_REQUEST_BYTES} bytes` };
  try { return { req: JSON.parse(readFileSync(file, 'utf8')) }; } catch (e) { return { error: `unreadable request: ${String(e.message).slice(0, 100)}` }; }
}

/**
 * startFacadeHost({ mailbox, hostDir, catalog, bed, python, stopOnFatal, fault }) -> { stop(), state }.
 * fault: an optional declared fault or drift spec (faults.mjs); catalog entries may carry `distractor: true`.
 * catalog: [{ name (MCP name), bedName, write }] of the bed tools exposed in this session.
 * bed: { request(obj) } (bed-process.mjs startBedServer). python: expose the python tool (default true).
 */
export function startFacadeHost({ mailbox, hostDir, catalog, bed, python = true, stopOnFatal = true, pollMs = 15, pythonTimeoutMs = 30_000, runPython = runPythonTool, fault = null }) {
  mkdirSync(mailbox, { recursive: true });
  mkdirSync(hostDir, { recursive: true });
  const byName = new Map(catalog.map(t => [t.name, t]));
  const log = path.join(hostDir, 'calls.jsonl');
  const faults = faultState(fault);
  const state = { seq: 0, handled: new Set(), fatal: null, worldCalls: 0, writes: 0, pythonCalls: 0, refused: 0, rejected: 0, envFault: null, faultEvents: [] };
  let stopping = false, busy = null;

  async function handle(n, file) {
    state.handled.add(n);
    const { req, error } = readRequest(file);
    const at = new Date().toISOString(), t0 = Date.now();
    const rec = { seq: ++state.seq, n, at };
    let res;
    if (error || !req || typeof req.name !== 'string' || (req.arguments !== undefined && (typeof req.arguments !== 'object' || req.arguments === null || Array.isArray(req.arguments)))) {
      state.rejected += 1;
      res = { isError: true, text: `request rejected: ${error ?? 'malformed request'}` };
      Object.assign(rec, { kind: 'rejected', reason: error ?? 'malformed' });
    } else if (python && req.name === PYTHON_TOOL.name) {
      state.pythonCalls += 1;
      try {
        const r = await runPython(req.arguments ?? {}, { timeoutMs: pythonTimeoutMs });
        res = { isError: r.isError, text: r.text.slice(0, MAX_TEXT_CHARS) };
        Object.assign(rec, { kind: 'python', args: req.arguments, isError: r.isError, textSha256: sha256(r.text), text: r.text.slice(0, 4000) });
      } catch (e) {
        state.envFault ??= `python tool: ${e?.code ?? 'error'}: ${String(e?.message ?? e).slice(0, 200)}`;
        res = { isError: true, text: 'python: the sandbox is unavailable' };
        Object.assign(rec, { kind: 'python', args: req.arguments, envFault: state.envFault });
      }
    } else if (!byName.has(req.name)) {
      state.rejected += 1;
      res = { isError: true, text: `Unknown tool: ${req.name.slice(0, 100)}` };
      Object.assign(rec, { kind: 'rejected', reason: 'unknown tool', name: req.name.slice(0, 100) });
    } else if (state.fatal && stopOnFatal) {
      state.refused += 1;
      res = { isError: true, text: STOPPED_TEXT };
      Object.assign(rec, { kind: 'refused', name: req.name, args: req.arguments ?? {} });
    } else {
      const t = byName.get(req.name);
      // a declared fault or drift (faults.mjs) decides first; a plain pass forwards the arguments unchanged
      const d = faults.decide({ name: req.name, bedName: t.bedName, write: Boolean(t.write), distractor: Boolean(t.distractor), args: req.arguments ?? {} });
      if (d.fault) state.faultEvents.push({ seq: rec.seq, fault: d.fault, name: req.name });
      if (d.action === 'refuse') {
        res = { isError: true, text: d.text };
        Object.assign(rec, { kind: 'fault', fault: d.fault, name: req.name, args: req.arguments ?? {}, text: d.text });
        rec.ms = Date.now() - t0;
        appendFileSync(log, JSON.stringify(rec) + '\n');
        writeResponse(mailbox, n, res);
        return;
      }
      state.worldCalls += 1;
      try {
        const r = await bed.request({ op: 'call', name: t.bedName, args: d.args });
        if (r.kind !== 'call') throw new Error(`bed answered ${r.kind}: ${r.error ?? ''}`);
        if (r.write) state.writes += 1;
        if (r.fatal) state.fatal ??= { seq: rec.seq, error: r.error };
        const text = r.fatal ? `Error: ${r.error}` : String(r.text ?? r.error ?? '');
        // lost acknowledgement: the call was applied, the answer says it timed out
        res = d.action === 'apply_then_error' ? { isError: true, text: d.text } : { isError: Boolean(r.fatal || r.error), text: text.slice(0, MAX_TEXT_CHARS) };
        Object.assign(rec, { kind: 'world', name: req.name, bedName: t.bedName, args: d.args, action: r.action, write: Boolean(r.write), fatal: Boolean(r.fatal),
          error: r.error ?? null, textSha256: sha256(text), textLen: text.length, text: text.slice(0, 4000), ...(d.fault ? { fault: d.fault, ...(d.action === 'apply_then_error' ? { answered: d.text } : {}), ...(d.args !== req.arguments ? { argsSent: req.arguments ?? {} } : {}) } : {}) });
      } catch (e) {
        state.envFault ??= `bed: ${String(e?.message ?? e).slice(0, 300)}`;
        res = { isError: true, text: 'the environment is unavailable' };
        Object.assign(rec, { kind: 'world', name: req.name, args: req.arguments ?? {}, envFault: state.envFault });
      }
    }
    rec.ms = Date.now() - t0;
    appendFileSync(log, JSON.stringify(rec) + '\n');
    writeResponse(mailbox, n, res);
  }

  async function sweep() {
    let names; try { names = readdirSync(mailbox); } catch { return; }
    const todo = names.map(f => /^req-(\d+)\.json$/.exec(f)).filter(Boolean).map(m => Number(m[1])).filter(n => !state.handled.has(n)).sort((a, b) => a - b);
    for (const n of todo) await handle(n, path.join(mailbox, `req-${n}.json`));
  }
  const loop = (async () => { while (!stopping) { busy = sweep(); await busy; await new Promise(r => setTimeout(r, pollMs)); } })();
  return {
    state,
    /** Stop after a final sweep. Resolves with the session's facade summary. */
    async stop() { stopping = true; await loop; await sweep(); return summary(); },
  };
  function summary() {
    return { worldCalls: state.worldCalls, writes: state.writes, pythonCalls: state.pythonCalls, refused: state.refused, rejected: state.rejected,
      fatal: state.fatal, envFault: state.envFault, calls: state.seq, faultEvents: state.faultEvents };
  }
}

/** The graded trajectory of a session: its world actions in order (refused and rejected calls never reached the world). */
export function trajectoryFromCalls(callsFile) {
  let lines = [];
  try { lines = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { lines = []; }
  const world = lines.filter(c => c.kind === 'world' && c.action);
  const fatal = world.find(c => c.fatal);
  return { actions: world.map(c => c.action), fatal: fatal ? fatal.error : null, calls: lines };
}
