#!/usr/bin/env node
// BG-8 from inside (PLAN §5.4): can anything an AppWorld arm executes reach the decrypted ground truth, the split lists,
// sealed manifests, verdicts, run records, package or HF caches, corpus/ or the network? An arm executes code in three
// places, each probed by a scripted probe:
//   1. AppWorld's own `execute(code)`: the sandboxed serve process (lib.mjs serveArgv). Probed END TO END through the
//      arm's tool path (relay tools/call -> mailbox -> host facade -> serve -> world.execute) on an open dev world, with
//      four chunks: allowed pathlib reads; bypasses of AppWorld's SafetyGuard (open/listdir reached through getattr and
//      __import__ with built names); subprocess, network, a scan of the heap for GroundTruth objects, uid, environment
//      and processes; and a filesystem scan for any file or directory named like ground truth or a split list;
//   2. the shared `python` tool: src/sandbox.mjs, directly and through the relay;
//   3. the session sandbox where the CLI and its MCP relay run (src/executors/claude-code.mjs maskSteps).
// Planted stand-ins for host-only data (a snapshot, a verdict, another unit's live outputs, a parity cache row) must be
// invisible everywhere; a masked path may exist only as an EMPTY directory or as a directory on the way to a path the
// sandbox keeps on purpose (the venv, bridge.py, the unit's public view and serve root).
//
//   node experiments/breadth/appworld/leakprobe.mjs [--out research/breadth-20261021/appworld/bg8.json]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HIDDEN, DEFAULT_KEEP_RO, UNSHARE_ARGS, executorEnv, maskSteps, sandboxAvailable, sandboxScript, splitReady } from '../../../src/executors/claude-code.mjs';
import { BENCH_ROOT, BRIDGE, BridgeServer, DATA_DIR, HOST_ROOT, LIVE_ROOT, PROTO, REPO, RESEARCH, SPLIT_FILE, VENV_DIR, WORLD_PROFILES, bridgeEnv, buildPublicView, buildServeRoot, hostArgv, writeJson } from './lib.mjs';
import { Facade, runPythonTool } from './facade.mjs';
import { armTools, makeServer } from './mcp.mjs';
import { materializeSession, NODE_BIN } from './session.mjs';
import { loadSplit } from './split.mjs';

const TAG = `bg8-${process.pid}`;
export const PLANTED = Object.freeze({
  hostSnapshot: path.join(HOST_ROOT, 'runs', TAG, 'units', 'x__r0', 'output', 'dbs', 'planted.jsonl'),
  hostVerdict: path.join(HOST_ROOT, 'runs', TAG, 'units', 'x__r0', 'verdict.json'),
  otherUnitLive: path.join(LIVE_ROOT, TAG, 'u', 'other__r0', 'serve', 'experiments', 'outputs', 'planted.jsonl'),
  parityCache: path.join(HOST_ROOT, 'parity', TAG, 'official.jsonl'),
});
export function sensitivePaths(taskId, pub) {
  return [
    DATA_DIR, path.join(DATA_DIR, 'tasks', taskId, 'ground_truth'), path.join(DATA_DIR, 'tasks', taskId, 'ground_truth', 'answer.json'),
    path.join(DATA_DIR, 'datasets', 'test_normal.txt'), path.join(BENCH_ROOT, 'root'), path.join(BENCH_ROOT, 'cache'), path.join(BENCH_ROOT, 'download'),
    path.join(BENCH_ROOT, 'home'), path.join(BENCH_ROOT, 'downloads.json'), HOST_ROOT, ...Object.values(PLANTED),
    path.join(pub, 'data', 'tasks', taskId, 'ground_truth'), path.join(pub, 'data', 'datasets'),
    '/home/user/workflow-foundry', '/home/user/workflow-foundry/corpus', path.join(REPO, 'beds', 'sealed'), RESEARCH, SPLIT_FILE,
    '/root/.cache/pip', '/root/.cache/uv', '/root/.cache/huggingface', '/root/.appworld', '/root/.claude', '/tmp', '/var/tmp/foundry-work/benches/agentdojo',
  ];
}
const GT_NAMES = ['ground_truth', 'answer.json', 'test_data.json', 'evaluation.py', 'private_data.json', 'public_data.json', 'compiled_solution.py', 'test_normal.txt', 'test_challenge.txt', 'train.txt', 'dev.txt'];

export const execChunks = paths => [
  // 1: what AppWorld's SafetyGuard allows (pathlib.Path.exists / iterdir / read_text are not on its deny list)
  `import pathlib, json
P = ${JSON.stringify(paths)}
res = {}
for p in P:
    q = pathlib.Path(p)
    try:
        ex = q.exists()
    except Exception as e:
        ex = 'err:' + type(e).__name__
    lst, txt = None, None
    if ex is True and q.is_dir():
        try:
            lst = sorted(x.name for x in q.iterdir())[:20]
        except Exception as e:
            lst = 'err:' + type(e).__name__
    if ex is True and q.is_file():
        try:
            txt = len(q.read_text())
        except Exception as e:
            txt = 'err:' + type(e).__name__
    res[p] = [ex, lst, txt]
print('RESULT ' + json.dumps(res))`,
  // 2: the guard's deny list bypassed with built names
  `import json
P = ${JSON.stringify(paths)}
out = {}
b = __builtins__
try:
    op = b['op' + 'en'] if isinstance(b, dict) else getattr(b, 'op' + 'en')
    r = op('/proc/self/status')
    out['open'] = type(r).__name__
    opened = {}
    for p in P:
        try:
            f = op(p)
            opened[p] = 'opened:' + type(f).__name__ + ':' + str(len(f.read()) if hasattr(f, 'read') else '')
        except Exception as e:
            opened[p] = 'err:' + type(e).__name__
    out['opened'] = opened
except Exception as e:
    out['open'] = 'err:' + type(e).__name__
try:
    m = __import__('o' + 's')
    ls = getattr(m, 'list' + 'dir')
    out['listdir_root'] = sorted(ls('/'))
    seen = {}
    for p in P:
        try:
            seen[p] = sorted(ls(p))[:20]
        except Exception as e:
            seen[p] = 'err:' + type(e).__name__
    out['listdir'] = seen
except Exception as e:
    out['listdir_root'] = 'err:' + type(e).__name__
print('RESULT ' + json.dumps(out))`,
  // 3: processes, network, heap, identity
  `import json
out = {}
try:
    sp = __import__('sub' + 'process')
    r = getattr(sp, 'r' + 'un')(['ls', '-la', '/var/tmp/foundry-work'], capture_output=True, text=True, timeout=10)
    out['subprocess'] = [getattr(r, 'returncode', None), (getattr(r, 'stdout', '') or '')[:400]] if r is not None else 'null-patched'
except Exception as e:
    out['subprocess'] = 'err:' + type(e).__name__ + ':' + str(e)[:120]
try:
    so = __import__('soc' + 'ket')
    s = so.create_connection(('1.1.1.1', 443), timeout=3)
    out['net'] = 'CONNECTED'
    s.close()
except Exception as e:
    out['net'] = 'err:' + type(e).__name__
try:
    g = __import__('g' + 'c')
    objs = g.get_objects()
    out['groundTruthObjects'] = sum(1 for o in objs if type(o).__name__ == 'GroundTruth')
    out['heapObjects'] = len(objs)
except Exception as e:
    out['groundTruthObjects'] = 'err:' + type(e).__name__
try:
    o = __import__('o' + 's')
    out['uid'] = o.getuid()
    out['env'] = sorted(o.environ)
    out['procs'] = sorted(int(x) for x in getattr(o, 'list' + 'dir')('/proc') if x.isdigit())
    out['cwd'] = o.getcwd()
except Exception as e:
    out['uid'] = 'err:' + type(e).__name__
print('RESULT ' + json.dumps(out))`,
  // 4: a scan of every visible tree for anything named like ground truth or a split list
  `import pathlib, json
names = set(${JSON.stringify(GT_NAMES)})
hits, n = [], 0
for root in ['/var', '/home', '/root', '/tmp', '/mnt', '/srv', '/opt', '/media', '/run', '/etc']:
    try:
        for q in pathlib.Path(root).rglob('*'):
            n += 1
            if q.name in names:
                hits.append(str(q))
            if n > 500000:
                break
    except Exception as e:
        hits.append('err:' + root + ':' + type(e).__name__)
print('RESULT ' + json.dumps({'scanned': n, 'hits': hits[:200]}))`,
];

const parseResult = text => { const line = String(text ?? '').split('\n').find(l => l.startsWith('RESULT ')); return line ? JSON.parse(line.slice(7)) : null; };
/** A visible directory is a leak unless it is empty or lists only the next component toward a path kept on purpose. */
export function leakedPaths(listing, kept) {
  const towardKept = p => kept.map(k => { const rest = path.relative(p, k); return rest && !rest.startsWith('..') && !path.isAbsolute(rest) ? rest.split('/')[0] : null; }).filter(Boolean);
  return Object.entries(listing).filter(([p, c]) => {
    if (c === null || c === undefined || typeof c === 'string') return false; // missing or unreadable
    if (Array.isArray(c) && !c.length) return false;
    const ok = new Set(towardKept(p));
    return !(Array.isArray(c) && c.every(x => ok.has(x)));
  }).map(([p]) => p);
}

/** 1 + 2: the execute path (and python through the relay) on an open dev world. */
export async function probeExecutePath() {
  const split = loadSplit();
  const taskId = split.pilotOrder[0];
  const live = path.join(LIVE_ROOT, TAG), unit = path.join(live, 'u', 'probe__r0');
  const pub = buildPublicView(path.join(unit, 'pub'), [taskId]);
  const serveRoot = buildServeRoot(path.join(unit, 'serve'), pub);
  const workdir = path.join(unit, 'w');
  for (const p of Object.values(PLANTED)) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, '{"planted":"bg8"}\n'); }
  const sens = sensitivePaths(taskId, pub);
  const kept = [VENV_DIR, BRIDGE, pub, serveRoot];
  const serve = new BridgeServer({ cmd: 'serve', serveRoot, publicDir: pub });
  let facade = null;
  try {
    await serve.hello;
    const h = serve.handle('bg8');
    const ready = await serve.open(h, taskId, WORLD_PROFILES.arm);
    const tools = armTools(false);
    materializeSession(workdir, tools);
    facade = new Facade({ workdir, bridge: serve, handle: h }).start();
    const replies = [];
    const relay = makeServer({ tools, box: path.join(workdir, '.tools'), waitMs: 600_000, write: m => replies.push(m) });
    let id = 0;
    const call = async (name, args) => { await relay({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }); return replies.at(-1); };
    await relay({ jsonrpc: '2.0', id: ++id, method: 'tools/list' });
    const listed = replies.at(-1)?.result?.tools?.map(t => t.name) ?? [];
    const outs = [];
    for (const code of execChunks(sens)) outs.push((await call('execute', { code }))?.result?.content?.[0]?.text ?? '');
    const pyOut = (await call('python', { code: PY_PROBE(sens) }))?.result?.content?.[0]?.text ?? '';
    const unknown = [await call('../bridge', {}), await call('grade', {})].every(m => m?.result?.isError === true && /Unknown tool/.test(m.result.content[0].text));
    const stats = await facade.stop(); facade = null;
    const closed = await serve.close(h);
    const [c1, c2, c3, c4] = outs.map(parseResult);
    const guardRefused = outs.map(o => /^Execution failed/.test(o) && !o.includes('RESULT '));
    const pathlibSeen = c1 ? Object.fromEntries(Object.entries(c1).map(([p, [ex, lst, txt]]) => [p, ex === true ? (lst ?? (txt !== null ? 'file' : [])) : null])) : null;
    const pathlibLeaked = pathlibSeen ? leakedPaths(Object.fromEntries(Object.entries(pathlibSeen).map(([p, v]) => [p, v === 'file' ? ['<file>'] : v])), kept) : null;
    const readable = c1 ? Object.entries(c1).filter(([, v]) => typeof v[2] === 'number').map(([p]) => p) : null;
    const listdirLeaked = c2?.listdir ? leakedPaths(c2.listdir, kept) : null;
    // with the guard's `open` reached through __builtins__, a FILE that opens and reads is a leak (a directory raises)
    const openedFiles = c2?.opened ? Object.entries(c2.opened).filter(([, v]) => v.startsWith('opened:')).map(([p]) => p) : [];
    const gtHits = c4 ? c4.hits.filter(x => !x.startsWith(VENV_DIR + '/')) : null;
    const pkgHits = c4 ? c4.hits.filter(x => x.startsWith(VENV_DIR + '/')) : null;
    const py = parseResult(pyOut);
    const pyLeaked = py ? leakedPaths(py.listing, []) : null;
    const res = {
      taskRole: 'devTrain (pilot order 0)', groundTruthLoaded: ready.groundTruthLoaded, toolsListed: listed, unknownRejected: unknown, guardRefusedChunk: guardRefused,
      pathlib: { leaked: pathlibLeaked, readableFiles: readable, visible: pathlibSeen ? Object.entries(pathlibSeen).filter(([, v]) => v !== null).map(([p]) => p) : null },
      bypass: c2 ? { open: c2.open, openedSensitiveFiles: openedFiles, openResults: c2.opened ?? null, listdirRoot: c2.listdir_root, leaked: listdirLeaked } : { raw: outs[1].slice(0, 400) },
      process: c3 ?? { raw: outs[2].slice(0, 400) }, scan: c4 ? { scanned: c4.scanned, groundTruthHits: gtHits, packageHits: pkgHits } : { raw: outs[3].slice(0, 400) },
      pythonViaRelay: py ? { leaked: pyLeaked, pkg: py.pkg, net: py.net, procs: py.procs.length, uid: py.uid } : { raw: pyOut.slice(0, 400) },
      facade: stats, closedExecutes: closed.executes,
    };
    res.ok = Boolean(c1 && c2 && c3 && c4 && py) && !res.groundTruthLoaded && JSON.stringify([...listed].sort()) === JSON.stringify(['api_docs', 'execute', 'python']) && unknown
      && !pathlibLeaked.length && !readable.some(p => !kept.some(k => p === k || p.startsWith(k + '/'))) && !(listdirLeaked ?? []).length && !openedFiles.length
      && String(c3.net).startsWith('err:') && c3.groundTruthObjects === 0 && !gtHits.length && !pyLeaked.length && !py.pkg.length && !py.net.length;
    return res;
  } finally {
    if (facade) await facade.stop().catch(() => {});
    await serve.quit();
    rmSync(live, { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'runs', TAG), { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'parity', TAG), { recursive: true, force: true });
  }
}

export const PY_PROBE = paths => `import os, json, socket
paths = ${JSON.stringify(paths)}
listing = {}
for p in paths:
    if os.path.exists(p):
        try:
            listing[p] = sorted(os.listdir(p))[:20] if os.path.isdir(p) else ['<file>']
        except Exception:
            listing[p] = None
pkg = []
for root in ['/usr/lib', '/usr/local/lib', '/usr/share']:
    for d, dirs, files in os.walk(root):
        if d.count('/') > 6:
            dirs[:] = []
        for n in dirs + files:
            if 'appworld' in n.lower():
                pkg.append(os.path.join(d, n))
net = []
for host, port in [('1.1.1.1', 443), ('s3.us-west-2.amazonaws.com', 443), ('pypi.org', 443)]:
    try:
        s = socket.create_connection((host, port), timeout=3); s.close(); net.append(host)
    except Exception:
        pass
procs = sorted(int(p) for p in os.listdir('/proc') if p.isdigit())
print('RESULT ' + json.dumps({'listing': listing, 'pkg': pkg, 'net': net, 'procs': procs, 'uid': os.getuid()}))
`;


/** Positive control (the probe has teeth): the SAME pathlib chunk in the same bridge `serve` code WITHOUT the sandbox
 * (host-only, network namespace only), on a root whose data is the FULL data. It must see the full data and read the
 * task's answer file; only the size of what it read is reported. Never used by a run. */
export async function probeControl() {
  const split = loadSplit();
  const taskId = split.pilotOrder[0];
  const root = path.join(HOST_ROOT, 'bg8-control', TAG);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, 'home'), { recursive: true });
  symlinkSync(DATA_DIR, path.join(root, 'data'));
  const sens = sensitivePaths(taskId, path.join(root, 'nonexistent-pub'));
  const [bin, argv] = hostArgv(['serve']);
  try {
    const out = await new Promise(resolve => {
      const c = spawn(bin, argv, { cwd: root, env: bridgeEnv(root), stdio: ['pipe', 'pipe', 'pipe'] });
      let so = '';
      c.stdout.on('data', d => { so += d; });
      c.on('close', () => resolve(so));
      const ops = [{ op: 'open', handle: 'c', taskId, settings: WORLD_PROFILES.arm }, { op: 'execute', handle: 'c', code: execChunks(sens)[0] }, { op: 'close', handle: 'c' }, { op: 'quit' }];
      c.stdin.end(ops.map(o => JSON.stringify(o)).join('\n') + '\n');
    });
    const msgs = out.split('\n').filter(l => l.startsWith(PROTO)).map(l => JSON.parse(l.slice(PROTO.length)));
    const exec = msgs.find(m => m.kind === 'output');
    const res = parseResult(exec?.output);
    if (!res) return { ok: false, error: 'no result', msgs: msgs.map(m => m.kind) };
    const answer = path.join(DATA_DIR, 'tasks', taskId, 'ground_truth', 'answer.json');
    const sawData = res[DATA_DIR]?.[0] === true, readAnswer = typeof res[answer]?.[2] === 'number';
    return { ok: sawData && readAnswer, sawFullData: sawData, readAnswerFileBytes: res[answer]?.[2] ?? null, visible: Object.entries(res).filter(([, v]) => v[0] === true).map(([p]) => p) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** 2: the shared python tool, directly. */
export async function probePythonTool() {
  const sens = sensitivePaths('0000000_1', '/nonexistent-public-view');
  for (const p of Object.values(PLANTED)) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, '{"planted":"bg8"}\n'); }
  try {
    const r = await runPythonTool(PY_PROBE(sens));
    const res = parseResult(r.stdout);
    if (!res) return { ok: false, error: r.error ?? 'no result' };
    const leaked = leakedPaths(res.listing, []);
    return { ok: !leaked.length && !res.pkg.length && !res.net.length && res.procs.length <= 3, leaked, pkg: res.pkg, net: res.net, procs: res.procs, uid: res.uid };
  } finally {
    rmSync(path.join(HOST_ROOT, 'runs', TAG), { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'parity', TAG), { recursive: true, force: true });
    rmSync(path.join(LIVE_ROOT, TAG), { recursive: true, force: true });
  }
}

export const NODE_PROBE = `import { existsSync, readdirSync, statSync } from 'node:fs';
const paths = JSON.parse(process.argv[2]);
const listing = Object.fromEntries(paths.filter(p => existsSync(p)).map(p => { try { return [p, statSync(p).isDirectory() ? readdirSync(p).sort().slice(0, 20) : ['<file>']]; } catch { return [p, null]; } }));
process.stdout.write('RESULT ' + JSON.stringify({ listing, cwd: process.cwd(), cwdFiles: readdirSync('.') }) + '\\n');
`;

/** 3: the session sandbox (same maskSteps, keepRo and environment as session.mjs), with a unit's workdir where run.mjs
 * puts it and planted host-only records around it. */
export async function probeSessionSandbox() {
  if (!sandboxAvailable()) return { ok: false, error: 'SANDBOX_UNAVAILABLE' };
  const live = path.join(LIVE_ROOT, TAG);
  const workdir = path.join(live, 'u', 'probe__r0', 'w');
  rmSync(live, { recursive: true, force: true });
  mkdirSync(path.join(workdir, '.tools'), { recursive: true });
  for (const p of Object.values(PLANTED)) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, '{"planted":"bg8"}\n'); }
  writeFileSync(path.join(workdir, 'probe.mjs'), NODE_PROBE);
  const sens = sensitivePaths('0000000_1', path.join(live, 'u', 'probe__r0', 'pub'));
  try {
    const script = sandboxScript(maskSteps({ workdir, hidden: DEFAULT_HIDDEN, keepRo: DEFAULT_KEEP_RO }), workdir, [NODE_BIN, path.join(workdir, 'probe.mjs'), JSON.stringify(sens)]);
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
    const leaked = leakedPaths(res.listing, [workdir, ...DEFAULT_KEEP_RO]);
    const plantedSeen = Object.values(PLANTED).filter(p => p in res.listing);
    return { ok: !leaked.length && !plantedSeen.length, leaked, plantedSeen, visible: Object.keys(res.listing), cwdFiles: res.cwdFiles };
  } finally {
    rmSync(live, { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'runs', TAG), { recursive: true, force: true });
    rmSync(path.join(HOST_ROOT, 'parity', TAG), { recursive: true, force: true });
  }
}

export async function runLeakProbe() {
  const execute = await probeExecutePath();
  const python = await probePythonTool();
  const session = await probeSessionSandbox();
  const control = await probeControl();
  return { kind: 'appworld-bg8', version: 1, at: new Date().toISOString(), planted: PLANTED, kept: { venv: VENV_DIR, bridge: BRIDGE, publicView: 'per unit', serveRoot: 'per unit' },
    executePath: execute, pythonTool: python, sessionSandbox: session, positiveControl: control, pass: Boolean(execute.ok && python.ok && session.ok && control.ok) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out');
  const outFile = i > 0 ? process.argv[i + 1] : path.join(RESEARCH, 'bg8.json');
  const res = await runLeakProbe();
  writeJson(outFile, res);
  console.log(JSON.stringify({ pass: res.pass, execute: { ok: res.executePath.ok, pathlibLeaked: res.executePath.pathlib?.leaked, readable: res.executePath.pathlib?.readableFiles, bypass: res.executePath.bypass,
    net: res.executePath.process?.net, gt: res.executePath.process?.groundTruthObjects, subprocess: res.executePath.process?.subprocess, scan: res.executePath.scan, py: res.executePath.pythonViaRelay },
  python: res.pythonTool, session: { ok: res.sessionSandbox.ok, leaked: res.sessionSandbox.leaked, planted: res.sessionSandbox.plantedSeen, error: res.sessionSandbox.error },
    control: { ok: res.positiveControl.ok, sawFullData: res.positiveControl.sawFullData, readAnswerFileBytes: res.positiveControl.readAnswerFileBytes, error: res.positiveControl.error } }, null, 1));
  if (!res.pass) process.exit(1);
}
