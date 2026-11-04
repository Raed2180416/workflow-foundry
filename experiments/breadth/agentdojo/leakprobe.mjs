#!/usr/bin/env node
// BG-8 from inside (PLAN §5.4): can anything an arm can execute reach gold, sealed manifests, authored injection tasks,
// verdicts, run records, the benchmark package, or the network? An AgentDojo arm executes code in exactly two places:
//   1. the shared `python` tool: src/sandbox.mjs (allow-list root: /usr, /bin, /lib...; no network; empty env). Probed
//      twice: directly (facade.mjs runPythonTool) and END TO END through the arm's own tool path: a bridge unit is
//      opened, the MCP relay (mcp.mjs makeServer, the code the CLI talks to) receives a `tools/call` for `python`
//      exactly as the CLI sends it, the mailbox carries it to the host facade (facade.mjs), which runs it;
//   2. the session sandbox where the CLI and its MCP relay run: src/executors/claude-code.mjs maskSteps (host read-only,
//      /home, /root, /tmp, /var/tmp ... masked; only the unit's workdir visible). The arm has no shell there (no built-in
//      tools), but the probe runs a script in that exact sandbox, laid out exactly as run.mjs lays out a unit (workdir
//      under the run's live directory, with planted run records beside it and planted host snapshots), to show what it
//      could reach.
// A scripted probe runs in each and must find none of the sensitive paths (a masked path may exist only as an EMPTY
// directory), no `agentdojo` package or data anywhere it can read, no network, and (python) no host process.
//
//   node experiments/breadth/agentdojo/leakprobe.mjs [--out research/breadth-20261021/agentdojo/bg8.json]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HIDDEN, DEFAULT_KEEP_RO, UNSHARE_ARGS, WORK_ROOT, executorEnv, maskSteps, sandboxAvailable, sandboxScript, splitReady } from '../../../src/executors/claude-code.mjs';
import { BENCH_ROOT, BridgeServer, HERE, HOST_ROOT, REPO, RESEARCH, writeJson } from './lib.mjs';
import { Facade, runPythonTool } from './facade.mjs';
import { PYTHON_TOOL, makeServer } from './mcp.mjs';
import { materializeSession, NODE_BIN } from './session.mjs';
import { benignUnit } from './scripted.mjs';
import { loadSplit } from './split.mjs';

export const RUNS_ROOT = path.join(WORK_ROOT, 'agentdojo');
const PROBE_TAG = `bg8-${process.pid}`;
/** Planted stand-ins for what a real run keeps beside and above a unit's workdir (run.mjs layout). */
export const PLANTED = Object.freeze({
  liveResults: path.join(RUNS_ROOT, PROBE_TAG, 'results.jsonl'),
  liveLaunch: path.join(RUNS_ROOT, PROBE_TAG, 'launch.json'),
  liveGrade: path.join(RUNS_ROOT, PROBE_TAG, 'grade-out-x.jsonl'),
  otherUnit: path.join(RUNS_ROOT, PROBE_TAG, 'w', 'other-unit', 'note.txt'),
  hostSnapshot: path.join(HOST_ROOT, 'runs', PROBE_TAG, 'units', 'u', 'serve.json'),
});
/** What must be unreachable from an arm. */
export const SENSITIVE = Object.freeze([
  HOST_ROOT, path.join(HOST_ROOT, 'sealed'), path.join(HOST_ROOT, 'authored'), path.join(HOST_ROOT, 'authoring'), path.join(HOST_ROOT, 'runs'),
  path.join(BENCH_ROOT, 'venv/lib/python3.12/site-packages/agentdojo/default_suites'), path.join(BENCH_ROOT, 'venv'), BENCH_ROOT,
  '/var/tmp/foundry-work/agentdojo-live', path.join(RUNS_ROOT, PROBE_TAG), ...Object.values(PLANTED),
  path.join(RESEARCH, 'SPLIT.json'), RESEARCH, path.join(HERE, 'bridge.py'), REPO, path.join(REPO, 'beds/sealed'), '/home/user/workflow-foundry',
  '/root/.cache/uv', '/root/.cache/pip', '/root/.cache/huggingface', '/root/.claude', '/tmp',
]);

export const PY_PROBE = `import os, sys, socket, glob, json
paths = ${JSON.stringify(SENSITIVE)}
seen = [p for p in paths if os.path.exists(p)]
content = {}
for p in seen:
    try:
        content[p] = sorted(os.listdir(p))[:20] if os.path.isdir(p) else 'file'
    except Exception:
        content[p] = None
leaked = [p for p in seen if content.get(p) not in ([], None)]
pkg = []
try:
    import agentdojo; pkg.append(getattr(agentdojo, '__file__', '?'))
except Exception:
    pass
for root in ['/usr/lib', '/usr/local/lib', '/usr/share']:
    for d, dirs, files in os.walk(root):
        if d.count('/') > 6:
            dirs[:] = []
        for n in dirs + files:
            if 'agentdojo' in n.lower() or 'spylab' in n.lower():
                pkg.append(os.path.join(d, n))
net = []
for host, port in [('1.1.1.1', 443), ('api.anthropic.com', 443), ('pypi.org', 443), ('api.drand.sh', 443)]:
    try:
        s = socket.create_connection((host, port), timeout=3); s.close(); net.append(host)
    except Exception:
        pass
procs = sorted(int(p) for p in os.listdir('/proc') if p.isdigit())
print('RESULT ' + json.dumps({'seen': seen, 'leaked': leaked, 'content': content, 'pkg': pkg, 'net': net, 'env': sorted(os.environ), 'procs': procs, 'uid': os.getuid()}))
`;

const parseResult = text => { const line = String(text ?? '').split('\n').find(l => l.startsWith('RESULT ')); return line ? JSON.parse(line.slice(7)) : null; };
/** A python-side verdict: no sensitive path with content, no package, no network, only the sandbox's own processes. */
const pyVerdict = res => ({ ok: !res.leaked.length && !res.pkg.length && !res.net.length && res.procs.length <= 3, ...res });

export async function probePython() {
  const r = await runPythonTool(PY_PROBE);
  const res = parseResult(r.stdout);
  if (!res) return { ok: false, error: r.error ?? 'no result', raw: String(r.stdout ?? '').slice(0, 500) };
  return pyVerdict(res);
}

/** The python probe through the arm's own tool path: relay -> mailbox -> host facade -> sandbox, on an open unit. */
export async function probeRelayPath({ liveDir = path.join('/var/tmp/foundry-work/agentdojo-live', 'bg8') } = {}) {
  const split = loadSplit();
  const unit = benignUnit('banking', split.suites.banking.dev[0]);
  const workdir = path.join(RUNS_ROOT, `${PROBE_TAG}-relay`, 'w', 'unit');
  const hostDir = path.join(HOST_ROOT, 'runs', `${PROBE_TAG}-relay`, 'units', 'unit');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(hostDir, { recursive: true });
  const b = new BridgeServer({ liveDir });
  let facade = null, h = null;
  try {
    await b.hello;
    h = b.handle('bg8');
    const ready = await b.open(h, unit, hostDir, 60);
    const tools = [...ready.catalog.map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema })), PYTHON_TOOL];
    materializeSession(workdir, tools);
    facade = new Facade({ workdir, bridge: b, handle: h }).start();
    const replies = [];
    const relay = makeServer({ tools, box: path.join(workdir, '.tools'), waitMs: 120_000, write: m => replies.push(m) });
    await relay({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    await relay({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'python', arguments: { code: PY_PROBE } } });
    await relay({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: '../../bridge', arguments: {} } });
    await relay({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'grade', arguments: {} } });
    const byId = Object.fromEntries(replies.map(m => [m.id, m]));
    const listed = byId[1]?.result?.tools?.map(t => t.name) ?? [];
    const res = parseResult(byId[2]?.result?.content?.[0]?.text);
    const unknownRejected = [3, 4].every(i => byId[i]?.result?.isError === true && /Unknown tool/.test(byId[i].result.content[0].text));
    const stats = await facade.stop();
    facade = null;
    const extraTools = listed.filter(n => n !== 'python' && !ready.catalog.some(t => t.name === n));
    if (!res) return { ok: false, error: 'no result through the relay', reply: JSON.stringify(byId[2]).slice(0, 500) };
    const v = pyVerdict(res);
    return { ...v, ok: v.ok && unknownRejected && !extraTools.length && stats.pythonRuns === 1, unit: unit.id, toolsListed: listed.length, extraTools, unknownRejected, facade: stats };
  } finally {
    if (facade) await facade.stop().catch(() => {});
    if (h) await b.close(h, '').catch(() => {});
    await b.quit();
    rmSync(path.join(RUNS_ROOT, `${PROBE_TAG}-relay`), { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'runs', `${PROBE_TAG}-relay`), { recursive: true, force: true });
  }
}

export const NODE_PROBE = `import { existsSync, readdirSync, statSync } from 'node:fs';
const paths = JSON.parse(process.argv[2]);
const seen = paths.filter(p => existsSync(p));
const content = Object.fromEntries(seen.map(p => { try { return [p, statSync(p).isDirectory() ? readdirSync(p).sort().slice(0, 20) : 'file']; } catch { return [p, null]; } }));
const hasPkg = ['/usr/lib/python3/dist-packages/agentdojo', '/usr/local/lib/python3.12/dist-packages/agentdojo'].filter(p => existsSync(p));
process.stdout.write('RESULT ' + JSON.stringify({ seen, content, hasPkg, cwd: process.cwd(), cwdFiles: readdirSync('.') }) + '\\n');
`;

/** Run the node probe inside the session sandbox (same maskSteps, keepRo and environment as session.mjs), with the
 * workdir where run.mjs puts a unit's (<RUNS_ROOT>/<run>/w/<unit>) and planted run records around it. */
export async function probeSessionSandbox() {
  if (!sandboxAvailable()) return { ok: false, error: 'SANDBOX_UNAVAILABLE' };
  const live = path.join(RUNS_ROOT, PROBE_TAG);
  const workdir = path.join(live, 'w', 'unit');
  rmSync(live, { recursive: true, force: true });
  mkdirSync(path.join(workdir, '.tools'), { recursive: true });
  for (const p of Object.values(PLANTED)) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, '{"planted":"bg8"}\n'); }
  writeFileSync(path.join(workdir, 'probe.mjs'), NODE_PROBE);
  try {
    const script = sandboxScript(maskSteps({ workdir, hidden: DEFAULT_HIDDEN, keepRo: DEFAULT_KEEP_RO }), workdir, [NODE_BIN, path.join(workdir, 'probe.mjs'), JSON.stringify(SENSITIVE)]);
    const env = executorEnv({ env: process.env, hidden: DEFAULT_HIDDEN });
    const out = await new Promise(resolve => {
      const c = spawn('unshare', [...UNSHARE_ARGS, 'sh', '-c', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let so = '', se = '';
      c.stdout.on('data', d => { so += d; }); c.stderr.on('data', d => { se += d; });
      c.on('close', code => resolve({ code, so, se }));
    });
    const { ready } = splitReady(out.se);
    const res = parseResult(out.so);
    if (!res) return { ok: false, error: `no result (code ${out.code}, ready ${ready}): ${out.se.slice(-400)}` };
    // A masked path is an EMPTY directory (not a leak). The unit's own workdir is visible by design, so a directory on
    // the way to it may list exactly the next component toward it and nothing else.
    const towardWorkdir = p => { const rest = path.relative(p, workdir); return rest && !rest.startsWith('..') ? rest.split('/')[0] : null; };
    const leaked = res.seen.filter(p => { const c = res.content[p]; if (c === null || (Array.isArray(c) && !c.length)) return false; const next = towardWorkdir(p); return !(next && Array.isArray(c) && c.length === 1 && c[0] === next); });
    const plantedSeen = Object.values(PLANTED).filter(p => res.seen.includes(p));
    return { ok: !leaked.length && !res.hasPkg.length && !plantedSeen.length, leaked, plantedSeen, ...res, workdirVisible: res.seen.filter(p => workdir.startsWith(p + '/') || workdir === p) };
  } finally {
    rmSync(live, { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'runs', PROBE_TAG), { recursive: true, force: true });
  }
}

export async function runLeakProbe() {
  const py = await probePython();
  const relay = await probeRelayPath();
  const sb = await probeSessionSandbox();
  return { kind: 'agentdojo-bg8', version: 2, at: new Date().toISOString(), sensitive: SENSITIVE, planted: PLANTED, pythonTool: py, relayPath: relay, sessionSandbox: sb,
    pass: Boolean(py.ok && relay.ok && sb.ok) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out');
  const outFile = i > 0 ? process.argv[i + 1] : path.join(RESEARCH, 'bg8.json');
  const res = await runLeakProbe();
  writeJson(outFile, res);
  const brief = x => ({ ok: x.ok, seen: x.seen, leaked: x.leaked, pkg: x.pkg ?? x.hasPkg, net: x.net, procs: x.procs, error: x.error });
  console.log(JSON.stringify({ pass: res.pass, python: brief(res.pythonTool), relay: { ...brief(res.relayPath), unknownRejected: res.relayPath.unknownRejected, extraTools: res.relayPath.extraTools }, session: { ...brief(res.sessionSandbox), plantedSeen: res.sessionSandbox.plantedSeen, cwdFiles: res.sessionSandbox.cwdFiles } }));
  if (!res.pass) process.exit(1);
}
