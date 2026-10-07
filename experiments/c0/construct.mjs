// One construction session (C0): the builder agent (Claude Code headless) gets probe tasks, the probe
// scorer and the model gateway, and must deliver a solver artifact (F: workflow.json, B1: solve.mjs).
// Everything it spends is measured: its own tokens (CLI-reported, or its budget bound when the session was killed)
// plus every gateway model call. Both arms read their construction skill from a read-only kit.
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { runClaudeCode, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { buildKit, SCRIPT_KIT_ALLOW } from '../lib/kit.mjs';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { builderPrompt } from './prompts.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';

// A construction whose builder session ended in one of these is not an outcome (PREREG-dev §5): the raw attempt is
// kept in construction-faults.jsonl and a resume retries it. The same classes as an execution trial's faults.
export const BUILD_ENV_FAULTS = ENV_FAULTS;

export const SCORE_TOOL = `// node tools/score.mjs <probe-index> <answer.json>
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const [probe, file] = process.argv.slice(2);
const output = JSON.parse(readFileSync(file, 'utf8'));
const res = await fetch(cfg.url + '/score', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: JSON.stringify({ probe: Number(probe), output }) });
console.log(JSON.stringify(await res.json()));
`;
// Every call's cost goes to stderr and to ./tools/calls.jsonl (next to this file), so a builder can read where the money went.
// The gateway is a loopback URL during construction and a unix socket next to this file at execution (where the
// script has no network at all); both go through node:http, so the client code path is the same.
export const MODEL_TOOL = `// import { callModel } from './tools/model.mjs'
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const here = path.dirname(fileURLToPath(import.meta.url));
function target() {
  if (!cfg.socket) { const u = new URL(cfg.url); return { host: u.hostname, port: u.port }; }
  const abs = path.join(here, cfg.socket), rel = path.relative(process.cwd(), abs);
  return { socketPath: rel.length < abs.length ? rel : abs };
}
function post(route, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target(), path: route, method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; });
      res.on('end', () => { let body = {}; try { body = JSON.parse(text); } catch {} resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject); req.end(data);
  });
}
export async function callModel({ model, system = '', prompt, schema, reasoning = 'none', maxTokens } = {}) {
  const { status, body } = await post('/model', { model, system, prompt, schema, decoding: { reasoning, ...(maxTokens ? { maxTokens } : {}) } });
  const line = JSON.stringify({ at: new Date().toISOString(), model, status, ok: !!body.ok, costUsd: body.costUsd ?? null, spentUsd: body.spentUsd ?? null, error: body.ok ? undefined : (body.error?.code ?? body.error ?? null) });
  process.stderr.write('[model] ' + line + '\\n');
  try { appendFileSync(new URL('./calls.jsonl', import.meta.url), line + '\\n'); } catch {}
  if (status !== 200 || !body.ok) throw new Error('model call failed: ' + status + ' ' + JSON.stringify(body.error ?? body).slice(0, 400));
  return body.value;
}
`;
export const BUDGET_TOOL = `// node tools/budget.mjs -> {"spentUsd","capUsd","reservedUsd","calls","scoreCallsLeft",...}
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const res = await fetch(cfg.url + '/budget', { headers: { authorization: 'Bearer ' + cfg.token } });
console.log(JSON.stringify(await res.json()));
`;
// Runs ./solve.mjs on a copy of one probe exactly as execution does (minus the execution sandbox's network isolation).
export const RUN_SOLVER = `#!/bin/sh
# ./tools/run-solver <probe-dir>: runs ./solve.mjs on a copy of that probe exactly as execution does
# (PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin, HOME = the task directory, no other environment).
set -e
[ -d "$1" ] || { echo "usage: ./tools/run-solver probes/probe-0" >&2; exit 2; }
src=$(cd "$(dirname "$0")/.." && pwd); d=$(mktemp -d)
cp -r "$1"/. "$d"/; cp "$src/solve.mjs" "$d/"; mkdir -p "$d/tools"; cp "$src/tools/model.mjs" "$src/tools/gateway.json" "$d/tools/"
cd "$d" && exec env -i PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME="$d" node solve.mjs task.json
`;

export function taskFiles(task, prefix = '') {
  const files = {
    [`${prefix}prompt.md`]: task.prompt,
    [`${prefix}inputs.json`]: JSON.stringify(task.inputs ?? {}, null, 1),
    [`${prefix}task.json`]: JSON.stringify({ prompt: task.prompt, inputs: task.inputs ?? {}, ...(task.files ? { files: task.files } : {}) }),
  };
  for (const [rel, content] of Object.entries(task.files ?? {})) files[`${prefix}files/${rel}`] = content;
  return files;
}

const sha = text => createHash('sha256').update(text).digest('hex');
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export async function construct({ arm, armId = arm, familyId, probeSeeds = [1, 2, 3], difficulty = 3, builderModel = 'claude-opus-5-5', builderEffort = 'high', builderBudgetUsd = 8,
  constructionModelUsd = 2, perTaskUsd = 1, minutes = 45, scoreChecks = 12, modelPort, workRoot, label, models }) {
  if (!['F', 'B1'].includes(arm)) throw new Error(`unknown construction arm ${arm}`);
  // The port must hold exactly the session's models (createModelPort({ allowedModels })): the builder's policy file,
  // the gateway allow-list and execution then agree, and no other model (no local one) is reachable.
  const portIds = modelPort.policy.models.map(m => m.id);
  if (!sameSet(portIds, models)) throw new Error(`construct: the model port policy (${portIds.join(', ')}) must be exactly the session models (${models.join(', ')})`);
  const fam = await loadFamily(familyId);
  const kit = arm === 'F' ? buildKit() : buildKit({ allow: SCRIPT_KIT_ALLOW });
  const probes = (await makeTasks(familyId, { split: 'dev', seeds: probeSeeds, difficulty })).map(t => t.task);
  const ledger = new Ledger({ capUsd: constructionModelUsd, label });
  // Fresh run id: a re-run after an environment fault must not be served this label's earlier journaled answers.
  const svc = await startServices({ modelPort, ledger, familyId, probes, scoreLimit: scoreChecks, runId: `construct:${label}:${randomUUID()}`, allowedModels: models });
  const workdir = path.join(workRoot, label);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const files = {
    'output-schema.json': JSON.stringify(fam.outputSchema, null, 1),
    'tools/gateway.json': JSON.stringify({ url: svc.url, token: svc.token }), 'tools/score.mjs': SCORE_TOOL, 'tools/model.mjs': MODEL_TOOL, 'tools/budget.mjs': BUDGET_TOOL,
  };
  probes.forEach((p, i) => Object.assign(files, taskFiles(p, `probes/probe-${i}/`)));
  if (arm === 'F') {
    // The builder's Foundry CLI validates and runs against the session policy, not the kit's full owner policy.
    const policyFile = path.join(workdir, 'tools/policy.json');
    files['tools/policy.json'] = JSON.stringify(modelPort.policy, null, 1);
    files['tools/foundry'] = `#!/bin/sh\nexport FOUNDRY_MODEL_GATEWAY_URL='${svc.url}'\nexport FOUNDRY_MODEL_GATEWAY_TOKEN='${svc.token}'\ncase "$1" in run|resume|tick|validate) exec node ${kit.dir}/bin/foundry.mjs "$@" --policy '${policyFile}';; esac\nexec node ${kit.dir}/bin/foundry.mjs "$@"\n`;
  }
  if (arm === 'B1') files['tools/run-solver'] = RUN_SOLVER;
  const classes = models.map(id => `${modelPort.policy.models.find(m => m.id === id)?.class} = ${id}`).join(', ');
  const prompt = builderPrompt(arm, { probes: probes.length, minutes, constructionModelUsd, perTaskUsd, scoreChecks, models, classes, kitDir: kit.dir });
  const started = Date.now();
  let r;
  try {
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
    for (const exe of ['tools/foundry', 'tools/run-solver']) if (files[exe]) chmodSync(path.join(workdir, exe), 0o755);
    r = await runClaudeCode({ model: builderModel, prompt, workdir, files: {}, kitDir: kit.dir, budgetUsd: builderBudgetUsd, timeoutMs: minutes * 60 * 1000 + 5 * 60 * 1000, effort: builderEffort });
  } catch (error) {
    // runClaudeCode throws only before the CLI starts (model id, sandbox, workspace): nothing was spent.
    r = { costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: null, usage: null, streamUsage: null, toolUses: [], sessionId: null,
      error: { code: error.code === 'SANDBOX_UNAVAILABLE' ? 'SANDBOX_UNAVAILABLE' : 'EXECUTOR_LAUNCH', message: String(error.message ?? error).slice(0, 500) } };
  } finally { await svc.close(); }   // settles in-flight gateway calls: the ledger below is complete
  const artifactName = arm === 'F' ? 'workflow.json' : 'solve.mjs', artifactPath = path.join(workdir, artifactName), artifact = existsSync(artifactPath) ? artifactName : null;
  const builderCostUsd = r.costUsd ?? r.costUpperUsd;   // unknown builder spend is charged at its bound, never $0
  // (/tmp is private to the sandbox, so it is not listed.)
  const outside = u => (JSON.stringify(u.input ?? '').match(/\/(?:home|root|opt|mnt|var|run|srv|media|etc|proc)\/[\w.\/-]*/g) ?? [])
    .filter(p => !p.startsWith(workdir) && !p.startsWith(kit.dir));
  const record = {
    arm, armId, familyId, label, difficulty, probeSeeds, builderModel, builderEffort, kitHash: kit.hash, kitDir: kit.dir, policyHash: modelPort.policyHash, models, runId: svc.runId,
    promptSha256: sha(prompt), artifact, artifactSha256: artifact ? sha(readFileSync(artifactPath)) : null,
    builderCostUsd, builderCostReportedUsd: r.costUsd ?? null, builderCostUnknown: !!r.costUnknown, builderCostUpperUsd: r.costUpperUsd ?? null, builderBudgetUsd,
    builderUsage: r.usage ?? null, builderStreamUsage: r.streamUsage ?? null, builderSessionId: r.sessionId ?? null,
    gatewayCostUsd: ledger.spentUsd, gatewayCapUsd: ledger.capUsd, gatewayOvershootUsd: Math.max(0, ledger.spentUsd - ledger.capUsd), gatewayCalls: ledger.calls, gatewayErrors: ledger.errors,
    gatewayRefusals: ledger.refusals, gatewayUnknownCalls: ledger.unknownCalls, gatewayUnknownUpperUsd: ledger.unknownUpperUsd, gatewayImputedUsd: ledger.imputedUsd,
    constructionCostUsd: builderCostUsd + ledger.spentUsd, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, minutes, turns: r.turns, toolUses: r.toolUses.length,
    builderError: r.error ?? null, scoreLog: svc.scoreLog, scoreChecks, firstPassAtCheck: svc.scoreLog.findIndex(s => s.pass) + 1 || null,
    notes: existsSync(path.join(workdir, 'BUILD-NOTES.md')) ? readFileSync(path.join(workdir, 'BUILD-NOTES.md'), 'utf8').slice(0, 4000) : null,
    // Transcript scans: nestedModelAttempts > 0 voids the construction (pre-registered); outsidePaths is reviewed by hand.
    hiddenPathAttempts: r.toolUses.filter(u => outside(u).length).length, outsidePaths: [...new Set(r.toolUses.flatMap(outside))].slice(0, 100),
    nestedModelAttempts: nestedModelUses(r.toolUses),
  };
  writeFileSync(path.join(workdir, 'construction.json'), JSON.stringify(record, null, 1));
  return { record, workdir, artifactPath: artifact ? artifactPath : null };
}
