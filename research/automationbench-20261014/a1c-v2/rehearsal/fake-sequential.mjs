#!/usr/bin/env node
// $0 stand-in for `sequential.mjs look 2 … --exec -- <run.mjs options>` in the look2-chain.sh rehearsal: it launches
// nothing. It mimics what the chain relies on: run.mjs refuses a live directory that holds a run unless --resume, a
// resume needs launch.json and may only raise the caps, a finished run writes summary.json (cost.spentUsd), a stopped
// run writes no summary. Scripted per run id by FAKE_RC (JSON: id -> exit codes, one per invocation) and FAKE_SPEND
// (id -> USD per invocation). Every invocation is appended to $A1CV2_LIVE/invocations.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2), live = process.env.A1CV2_LIVE;
const sep = argv.indexOf('--'), head = argv.slice(0, sep), pass = argv.slice(sep + 1);
const flag = (a, k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const id = flag(pass, '--run-id'), dir = path.join(live, id), resume = pass.includes('--resume');
const cap = Number(flag(pass, '--cap')), tokenCap = flag(pass, '--token-cap') === undefined ? null : Number(flag(pass, '--token-cap'));
appendFileSync(path.join(live, 'invocations.jsonl'), JSON.stringify({ id, cwd: process.cwd(), role: flag(head, '--role'), arm: flag(head, '--arm'), firstLook: flag(head, '--first-look') ?? null, exec: head.includes('--exec'), cap, tokenCap, resume, pass }) + '\n');
const fail = m => { console.error(m); process.exit(1); };
if (pass.includes('--no-copy') || pass.includes('--tasks')) fail('look: refused option');
if (existsSync(path.join(dir, 'launch.json')) && !resume) fail(`${dir} already holds a run: pass --resume to continue it, or use a new --run-id`);
if (resume && !existsSync(path.join(dir, 'launch.json'))) fail('resume refused: launch.json is missing');
if (resume) { const p = JSON.parse(readFileSync(path.join(dir, 'launch.json'), 'utf8')); if (!(cap >= p.capUsd)) fail('resume refused: the cap can only be raised'); if (p.tokenCap !== null && !(tokenCap >= p.tokenCap)) fail('resume refused: the token cap can only be raised'); }
mkdirSync(dir, { recursive: true });
if (!resume) writeFileSync(path.join(dir, 'launch.json'), JSON.stringify({ capUsd: cap, tokenCap, model: 'claude-haiku-5-5' }));
const n = Number(existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8') : 0);
writeFileSync(path.join(dir, 'calls'), String(n + 1));
const rc = (JSON.parse(process.env.FAKE_RC ?? '{}')[id] ?? [0])[n] ?? 0;
const usd = (JSON.parse(process.env.FAKE_SPEND ?? '{}')[id] ?? [1])[n] ?? 1;
appendFileSync(path.join(dir, 'results.jsonl'), JSON.stringify({ task: `t${n}`, forks: [{ costUsd: usd, ...(tokenCap ? { tokens: { byModel: { 'mercury-3': { total: 1000 } } } } : {}) }] }) + '\n');
if (rc === 0) { const spent = readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + JSON.parse(l).forks[0].costUsd, 0); writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ n: 60, cost: { spentUsd: spent } })); }
process.exit(rc);
