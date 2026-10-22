// The one `python` tool every arm gets (PLAN §5.1, §5.2 "Tools"): the agent's code runs host-side under
// src/sandbox.mjs (fresh user/net/mount/pid namespaces, network off, allow-listed root: /home, /root, /opt, /tmp,
// /var, /run masked; 1 GiB address space, 8 tasks), the same sandbox Foundry's `code` nodes use. Standard library only;
// no bed state, files or network are reachable, and each call starts clean.
import { runCode } from '../../../src/sandbox.mjs';

export const PYTHON_TOOL = Object.freeze({
  name: 'python',
  description: 'Run a short Python 3 program (standard library only) and return what it prints. Each call starts fresh: no files, no network, no state kept between calls, and no access to the workspace tools. Use it for arithmetic, date calculations and data wrangling on values you already have.',
  inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'Python source; print() the result' } }, required: ['code'] },
});

export const PY_WRAPPER = `import io, contextlib, traceback
def main(inp):
    buf = io.StringIO()
    err = None
    g = {"__name__": "__main__"}
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            exec(compile(inp["code"], "<python>", "exec"), g)
    except BaseException:
        err = traceback.format_exc(limit=5)
    return {"output": buf.getvalue()[-20000:], "error": err[-4000:] if err else None}
`;

export const MAX_CODE_BYTES = 64 * 1024;

/** Run one python tool call. Returns { text, isError, ms }. Never throws for user-code errors. */
export async function runPythonTool(args, { timeoutMs = 30_000, run = runCode } = {}) {
  const code = typeof args?.code === 'string' ? args.code : null;
  if (code === null || !code.trim()) return { text: 'python: the "code" argument (a string) is required', isError: true, ms: 0 };
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) return { text: `python: code over ${MAX_CODE_BYTES} bytes`, isError: true, ms: 0 };
  const t0 = Date.now();
  try {
    const r = await run({ lang: 'python', source: PY_WRAPPER, input: { code }, timeoutMs });
    const v = r.value ?? {};
    const text = `${v.output ?? ''}${v.error ? `${v.output ? '\n' : ''}${v.error}` : ''}` || '(no output)';
    return { text, isError: Boolean(v.error), ms: Date.now() - t0 };
  } catch (e) {
    if (e?.code === 'SANDBOX_UNAVAILABLE') throw e; // an environment fault, not a tool result
    return { text: `python: ${e?.code ?? 'error'}: ${String(e?.message ?? e).slice(0, 2000)}`, isError: true, ms: Date.now() - t0 };
  }
}
