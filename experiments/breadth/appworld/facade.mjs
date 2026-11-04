// Host-side facade for one AppWorld unit (experiments/breadth/appworld). It answers the agent's mailbox (.tools/ in the
// workdir, written by mcp.mjs inside the session sandbox, or in-process by a scripted client): `execute` requests go to
// the unit's sandboxed serve process (world.execute), `api_docs` requests to the same world's API-docs app, `python`
// requests run under src/sandbox.mjs (fresh namespaces, no network, every host path outside /usr, /bin, /lib absent),
// notes requests (the A-HN control only) read or replace a host-held text. The facade never grades and never exposes
// host files. Adapted from the AgentDojo bed's facade.mjs.
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCode } from '../../../src/sandbox.mjs';

export const PYTHON_CAP = 15;
export const PYTHON_TIMEOUT_MS = 30_000;
export const NOTES_MAX = 8000;
/** The shared python tool: the agent's code runs as a script; what it prints comes back (50 kB tail). */
export const PY_TOOL_SOURCE = `import io, contextlib, traceback
def main(inp):
    out = io.StringIO()
    err = None
    with contextlib.redirect_stdout(out):
        try:
            exec(compile(inp['code'], '<python-tool>', 'exec'), {'__name__': '__main__'})
        except BaseException:
            err = traceback.format_exc(limit=8)
    s = out.getvalue()
    return {'stdout': s[-50000:], 'truncated': len(s) > 50000, 'error': err}
`;

export async function runPythonTool(code, { timeoutMs = PYTHON_TIMEOUT_MS } = {}) {
  try {
    const r = await runCode({ lang: 'python', source: PY_TOOL_SOURCE, input: { code: String(code) }, timeoutMs });
    return r.value;
  } catch (e) {
    return { stdout: '', truncated: false, error: `${e.code ?? 'ERROR'}: ${String(e.message).slice(0, 2000)}` };
  }
}

/** A notes store for one lineage of one scenario stream (A-HN): { read() -> string, write(text) }. */
export function memoryNotes(initial = '') { let t = initial; return { read: () => t, write: x => { t = String(x).slice(0, NOTES_MAX); } }; }

export class Facade {
  constructor({ workdir, bridge, handle, pythonCap = PYTHON_CAP, python = runPythonTool, notes = null, log = null, maxExecutes = Infinity }) {
    Object.assign(this, { box: path.join(workdir, '.tools'), bridge, handle, pythonCap, python, notes, log, maxExecutes });
    this.next = 1; this.pythonRuns = 0; this.requests = 0; this.notesOps = 0; this.executes = 0; this.docs = 0; this.refused = 0; this.completed = false;
    this.stopped = false; this.busy = null; this.timer = null; this.journal = [];
  }
  start() {
    const tick = async () => {
      if (this.stopped) return;
      this.busy = this.drain().catch(e => { this.error ??= e; });
      await this.busy;
      if (!this.stopped) this.timer = setTimeout(tick, 20);
    };
    this.timer = setTimeout(tick, 20);
    return this;
  }
  /** Answer every pending request in number order (clients claim numbers with an exclusive create). */
  async drain() {
    if (!existsSync(this.box)) return;
    for (;;) {
      const f = path.join(this.box, `req-${this.next}.json`);
      if (!existsSync(f)) {
        // a claimed-but-abandoned slot would stall the queue: skip a slot with no claim when later requests exist
        const claimF = path.join(this.box, `req-${this.next}.claim`);
        const later = readdirSync(this.box).some(x => { const m = /^req-(\d+)\.json$/.exec(x); return m && Number(m[1]) > this.next; });
        if (later && !existsSync(claimF)) { this.next++; continue; }
        return;
      }
      let req;
      try { req = JSON.parse(readFileSync(f, 'utf8')); } catch { return; }
      const res = await this.answer(req);
      const tmp = path.join(this.box, `res-${this.next}.json.tmp`);
      writeFileSync(tmp, JSON.stringify(res));
      renameSync(tmp, path.join(this.box, `res-${this.next}.json`));
      this.requests++;
      this.next++;
    }
  }
  async answer(req) {
    if (typeof req.python === 'string') {
      if (this.pythonRuns >= this.pythonCap) return { python: { stdout: '', error: `the python tool limit (${this.pythonCap} runs) is reached` } };
      this.pythonRuns++;
      const r = await this.python(req.python);
      this.journal.push({ kind: 'python', chars: req.python.length, error: Boolean(r?.error) });
      return { python: r };
    }
    if (req.notes && typeof req.notes === 'object') {
      if (!this.notes) return { error: 'there is no notes file in this configuration' };
      this.notesOps++;
      if (req.notes.op === 'write') { this.notes.write(req.notes.text ?? ''); this.journal.push({ kind: 'notes-write', chars: String(req.notes.text ?? '').length }); return { notes: 'saved' }; }
      this.journal.push({ kind: 'notes-read' });
      return { notes: this.notes.read() };
    }
    try {
      if (typeof req.execute === 'string') {
        if (this.executes >= this.maxExecutes) return { output: `The limit of ${this.maxExecutes} execute calls for this task is reached.` };
        this.executes++;
        const r = await this.bridge.execute(this.handle, req.execute);
        if (r.refused) this.refused++;
        this.completed ||= Boolean(r.completed);
        this.journal.push({ kind: 'execute', chars: req.execute.length, refused: Boolean(r.refused), completed: Boolean(r.completed), outChars: String(r.output ?? '').length });
        return { output: r.output, completed: r.completed };
      }
      if (req.docs && typeof req.docs === 'object') {
        this.docs++;
        const r = await this.bridge.docs(this.handle, req.docs.appName ?? null, req.docs.apiName ?? null);
        this.journal.push({ kind: 'docs', app: req.docs.appName ?? null, api: req.docs.apiName ?? null });
        return { docs: r.output };
      }
    } catch (e) {
      this.log?.(`[facade ${this.handle}] bridge error: ${e.message}`);
      this.bridgeError ??= String(e.message);
      return { error: 'the environment failed to answer this request' };
    }
    return { error: 'empty request' };
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.busy;
    await this.drain().catch(() => {}); // answer anything that arrived last
    return { requests: this.requests, executes: this.executes, docs: this.docs, refused: this.refused, completed: this.completed, pythonRuns: this.pythonRuns, notesOps: this.notesOps,
      bridgeError: this.bridgeError ?? null, error: this.error ? String(this.error.message ?? this.error) : null };
  }
}
