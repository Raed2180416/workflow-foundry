// Tool client (experiments/breadth/agentdojo). It is copied into each agent workdir and is the only way an agent reaches
// the suite's tools and the shared python tool: every request goes through a file mailbox (.tools/) that the host
// answers (facade.mjs). Same protocol as experiments/sopbench/tool.mjs, plus `python`. Node built-ins only.
//
//   node tool.mjs list                                   the tool definitions (name, description, JSON input schema)
//   node tool.mjs call <tool_name> '<arguments JSON>'    one tool call = one step
//   node tool.mjs call <tool_name> @args.json            ... arguments read from a file ('-' reads stdin)
//   node tool.mjs batch '[{"name": ..., "arguments": {...}}, ...]'   several calls in ONE step, run in order
//                                                         (the equivalent of parallel tool calls; also @file / -)
//   node tool.mjs python @script.py | - | '<code>'       run Python 3 in a sandbox (no network, no files kept); prints
//                                                         what the code printed (not a suite tool; no step is used)
// The printed text is exactly what the tool returned, or the error text when the call failed. Exit 0 when the
// environment answered (even with an error inside the result), 1 when it refused or did not answer, 2 on wrong usage.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOX = path.join(HERE, '.tools');
const WAIT_MS = Number(process.env.AGENTDOJO_TOOL_WAIT_MS ?? 180_000);
const usage = () => { console.error("usage: node tool.mjs list | call <tool_name> '<arguments JSON>'|@file|- | batch '<JSON array>'|@file|- | python @file|-|'<code>'"); process.exit(2); };

function readArg(a) {
  if (a === undefined) return undefined;
  if (a === '-') return readFileSync(0, 'utf8');
  if (a.startsWith('@')) return readFileSync(path.resolve(a.slice(1)), 'utf8');
  return a;
}

/** Claim the next request number with an exclusive create, so parallel invocations never share one. */
function claim() {
  mkdirSync(BOX, { recursive: true });
  for (let tries = 0; tries < 10_000; tries++) {
    const used = readdirSync(BOX).map(f => /^req-(\d+)\.(?:json|claim)$/.exec(f)).filter(Boolean).map(m => Number(m[1]));
    const n = (used.length ? Math.max(...used) : 0) + 1;
    try { closeSync(openSync(path.join(BOX, `req-${n}.claim`), 'wx')); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not claim a request slot');
}

async function send(body) {
  const n = claim();
  const tmp = path.join(BOX, `req-${n}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ v: 1, ...body }));
  renameSync(tmp, path.join(BOX, `req-${n}.json`));
  const res = path.join(BOX, `res-${n}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_MS) {
    if (existsSync(res)) {
      try { return JSON.parse(readFileSync(res, 'utf8')); } catch { /* being written: retry */ }
    }
    await new Promise(r => setTimeout(r, 25));
  }
  return { error: `the environment did not answer within ${Math.round(WAIT_MS / 1000)} s` };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'list') {
  process.stdout.write(readFileSync(path.join(HERE, 'tools.json'), 'utf8') + '\n');
  process.exit(0);
}
let body;
if (cmd === 'call') {
  if (!a) usage();
  body = { calls: [{ name: a, arguments: readArg(b) ?? '{}' }] };
} else if (cmd === 'batch') {
  const raw = readArg(a);
  if (raw === undefined) usage();
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { console.error(`batch: the argument must be a JSON array (${e.message})`); process.exit(2); }
  if (!Array.isArray(arr) || !arr.length || !arr.every(c => c && typeof c === 'object' && typeof c.name === 'string')) {
    console.error('batch: expected a non-empty JSON array of {"name": "<tool>", "arguments": {...}}'); process.exit(2);
  }
  body = { calls: arr.map(c => ({ name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) })) };
} else if (cmd === 'python') {
  const code = readArg(a);
  if (!code || !code.trim()) usage();
  body = { python: code };
} else usage();

const r = await send(body);
if (r.error) { console.error(r.error); process.exit(1); }
if (cmd === 'python') {
  process.stdout.write(String(r.python?.stdout ?? ''));
  if (r.python?.error) process.stdout.write(`\nError:\n${r.python.error}\n`);
} else if (cmd === 'call') process.stdout.write(String(r.results[0].content) + '\n');
else for (const [i, x] of r.results.entries()) process.stdout.write(`### result ${i + 1}: ${x.name}\n${x.content}\n`);
