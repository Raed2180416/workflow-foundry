#!/usr/bin/env node
// The A1-C harness manifest hash a paid run.mjs launch would compute, for any checkout (the a1c-v1 pin worktree or the
// v2 branch), including the Mercury node-model variants. DEVELOPER TOOL, $0, no model, no task: `run.mjs --dry-run`
// cannot give the Mercury variants' hash, because the runner names the remote executor in the manifest only after it has
// loaded the policy for a paid run; this mirrors that expression of run.mjs (`remoteRoles.length ? { executor: ... }`).
// Checked against the recorded runs: aada200 + the B2 config gives 5622c941… (a1c-dev60-dn) and, with
// --node-models ledger=mercury-3,checker=mercury-3 --concurrency 2, ef5c3382… (m3-a1c-dev60-dn).
//   node experiments/autobench/replay/manifest-hash.mjs --root DIR --harness codeowned|codeowned-v2 [--concurrency 3]
//        [--node-models ledger=mercury-3,checker=mercury-3] [--session-tokens 300000] [--call-tokens 100000]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) a[argv[i].replace(/^--/, '')] = argv[++i]; return a; }
const a = args(process.argv.slice(2));
if (!a.root || !a.harness) throw new Error('--root DIR and --harness codeowned|codeowned-v2 are required');
const root = path.resolve(a.root);
const run = await import(pathToFileURL(path.join(root, 'experiments/autobench/run.mjs')).href);
const co = await import(pathToFileURL(path.join(root, 'experiments/autobench', run.PIPELINE_HARNESSES[a.harness])).href);
const { cliVersion } = await import(pathToFileURL(path.join(root, 'experiments/autobench/harness/foundry.mjs')).href);
const nodeModels = a['node-models'] ? Object.fromEntries(a['node-models'].split(',').filter(Boolean).map(x => x.split('=').map(y => y.trim()))) : undefined;
const remoteRoles = [...new Set(Object.values(nodeModels ?? {}).filter(m => /^mercury/.test(m)))].sort();
// run.mjs's launch guard, mirrored (re-review 2026-10-21, B-1: this tool once printed a hash for an arm run.mjs refused
// to launch): executor-model roles run only in the pipelines that checkout's run.mjs wires them into (EXECUTOR_PIPELINES;
// a checkout that predates it, such as the a1c-v1 pin, wires the codeowned pipeline only).
const wired = run.EXECUTOR_PIPELINES ?? [run.CODEOWNED];
if (remoteRoles.length && !wired.includes(a.harness)) throw new Error(`${remoteRoles.join(', ')}: executor models are wired into ${wired.join(' and ')} only in ${root}; run.mjs would refuse this launch`);
const opt = { model: 'claude-haiku-5-5', effort: null, budgetUsd: 0.75, timeoutMin: 20, maxSteps: 50, tools: ['Bash'], det: 'record', k: 1, concurrency: Number(a.concurrency ?? 3), dateNote: true, nodeModels };
const sessionTokens = Number(a['session-tokens'] ?? 300000), callTokens = Number(a['call-tokens'] ?? 100000);
const cfg = { ...opt, cli: cliVersion(), ...(remoteRoles.length ? { executor: `src/executors/claude-code.mjs runClaudeCode for claude-cli roles; src/executors/openai-chat.mjs runOpenAIChat for ${remoteRoles.join(', ')} roles (model nodes: one request, no tools, at most ${callTokens} tokens; per-task token pool ${sessionTokens})` } : {}) };
const m = (co.pipelineManifest ?? co.codeownedManifest)((co.pipelineConfig ?? co.codeownedConfig)(cfg));
process.stdout.write(`${JSON.stringify({ root, harness: a.harness, version: co.HARNESS_VERSION, nodeModels: nodeModels ?? null, concurrency: opt.concurrency, cli: cfg.cli, files: m.files.length, sha256: m.sha256 })}\n`);
