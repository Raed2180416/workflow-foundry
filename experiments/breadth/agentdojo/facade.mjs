// Host-side facade for one unit (experiments/breadth/agentdojo). It answers the agent's mailbox (.tools/ in the
// workdir, written by mcp.mjs inside the session sandbox, or by tool.mjs for scripted clients): suite-tool calls go to
// the bridge (one upstream ToolsExecutor step per request), python requests run under src/sandbox.mjs (fresh
// namespaces, no network, every host path outside /usr, /bin, /lib absent), notes requests (the A-HN control only) read
// or replace a host-held text. The facade never grades and never exposes host files.
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

/** A notes store for one lineage of one cluster stream (A-HN): { read() -> string, write(text) }. */
export function memoryNotes(initial = '') { let t = initial; return { read: () => t, write: x => { t = String(x).slice(0, NOTES_MAX); } }; }

export class Facade {
  constructor({ workdir, bridge, handle, pythonCap = PYTHON_CAP, python = runPythonTool, notes = null, log = null }) {
    Object.assign(this, { box: path.join(workdir, '.tools'), bridge, handle, pythonCap, python, notes, log });
    this.next = 1; this.pythonRuns = 0; this.requests = 0; this.notesOps = 0; this.stopped = false; this.busy = null; this.timer = null; this.journal = [];
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
    if (!Array.isArray(req.calls) || !req.calls.length) return { error: 'empty request' };
    try {
      const r = await this.bridge.calls(this.handle, req.calls.map(c => ({ name: String(c.name), arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) })));
      this.journal.push({ kind: 'calls', names: r.results.map(x => x.name), errors: r.results.filter(x => x.error).length });
      return { results: r.results.map(x => ({ name: x.name, content: x.content, error: Boolean(x.error) })), steps: r.steps };
    } catch (e) {
      this.log?.(`[facade ${this.handle}] bridge error: ${e.message}`);
      this.bridgeError ??= String(e.message);
      return { error: 'the environment failed to answer this request' };
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.busy;
    await this.drain().catch(() => {}); // answer anything that arrived last
    return { requests: this.requests, pythonRuns: this.pythonRuns, notesOps: this.notesOps, bridgeError: this.bridgeError ?? null, error: this.error ? String(this.error.message ?? this.error) : null };
  }
}
