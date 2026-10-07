// One construction session (C0): the builder agent (Claude Code headless) gets probe tasks, the probe
// scorer and the model gateway, and must deliver a solver artifact (F: workflow.json, B1: solve.mjs).
// Everything it spends is measured: its own tokens (CLI-reported) plus every gateway model call.
import path from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { runClaudeCode } from '../../src/executors/claude-code.mjs';
import { buildKit } from '../lib/kit.mjs';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { builderPrompt } from './prompts.mjs';

export const SCORE_TOOL = `// node tools/score.mjs <probe-index> <answer.json>
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
const [probe, file] = process.argv.slice(2);
const output = JSON.parse(readFileSync(file, 'utf8'));
const res = await fetch(cfg.url + '/score', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' }, body: JSON.stringify({ probe: Number(probe), output }) });
console.log(JSON.stringify(await res.json()));
`;
export const MODEL_TOOL = `// import { callModel } from './tools/model.mjs'
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('./gateway.json', import.meta.url)));
export async function callModel({ model, system = '', prompt, schema, reasoning = 'none', maxTokens } = {}) {
  const res = await fetch(cfg.url + '/model', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' },
    body: JSON.stringify({ model, system, prompt, schema, decoding: { reasoning, ...(maxTokens ? { maxTokens } : {}) } }) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.ok) throw new Error('model call failed: ' + res.status + ' ' + JSON.stringify(body.error ?? body).slice(0, 400));
  return body.value;
}
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

export async function construct({ arm, familyId, probeSeeds = [1, 2, 3], difficulty = 3, builderModel = 'claude-opus-5-5', builderBudgetUsd = 8,
  constructionModelUsd = 2, perTaskUsd = 1, minutes = 45, scoreChecks = 12, modelPort, workRoot, label, models }) {
  const fam = await loadFamily(familyId);
  const kit = buildKit();
  const probes = (await makeTasks(familyId, { split: 'dev', seeds: probeSeeds, difficulty })).map(t => t.task);
  const ledger = new Ledger({ capUsd: constructionModelUsd, label });
  const svc = await startServices({ modelPort, ledger, familyId, probes, scoreLimit: scoreChecks, runId: `construct:${label}` });
  const workdir = path.join(workRoot, label);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const gateway = JSON.stringify({ url: svc.url, token: svc.token });
  const files = {
    'output-schema.json': JSON.stringify(fam.outputSchema, null, 1),
    'tools/gateway.json': gateway, 'tools/score.mjs': SCORE_TOOL, 'tools/model.mjs': MODEL_TOOL,
  };
  probes.forEach((p, i) => Object.assign(files, taskFiles(p, `probes/probe-${i}/`)));
  if (arm === 'F') files['tools/foundry'] = `#!/bin/sh\nexport FOUNDRY_MODEL_GATEWAY_URL='${svc.url}'\nexport FOUNDRY_MODEL_GATEWAY_TOKEN='${svc.token}'\nexec node ${kit.dir}/bin/foundry.mjs "$@"\n`;
  const prompt = builderPrompt(arm, { probes: probes.length, minutes, constructionModelUsd, perTaskUsd, scoreChecks, models, kitDir: kit.dir });
  const started = Date.now();
  let r;
  try {
    // materialise first so tools/foundry can be made executable before the session starts
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
    if (arm === 'F') chmodSync(path.join(workdir, 'tools/foundry'), 0o755);
    r = await runClaudeCode({ model: builderModel, prompt, workdir, files: {}, budgetUsd: builderBudgetUsd, timeoutMs: minutes * 60 * 1000 + 5 * 60 * 1000, effort: 'high' });
  } finally { await svc.close(); }
  const artifactName = arm === 'F' ? 'workflow.json' : 'solve.mjs';
  const artifactPath = path.join(workdir, artifactName);
  const record = {
    arm, familyId, label, difficulty, probeSeeds, builderModel, kitHash: kit.hash,
    artifact: existsSync(artifactPath) ? artifactName : null,
    builderCostUsd: r.costUsd, gatewayCostUsd: ledger.spentUsd, gatewayCalls: ledger.calls, gatewayErrors: ledger.errors,
    constructionCostUsd: r.costUsd + ledger.spentUsd, durationMs: Date.now() - started, turns: r.turns, toolUses: r.toolUses.length,
    builderError: r.error, scoreLog: svc.scoreLog, firstPassAtCheck: svc.scoreLog.findIndex(s => s.pass) + 1 || null,
    notes: existsSync(path.join(workdir, 'BUILD-NOTES.md')) ? readFileSync(path.join(workdir, 'BUILD-NOTES.md'), 'utf8').slice(0, 4000) : null,
    // Transcript scan: did the builder try to reach hidden paths (oracle access attempts)?
    hiddenPathAttempts: r.toolUses.filter(u => /workflow-foundry|\/beds\/|\/opt\/corpus/.test(JSON.stringify(u.input ?? ''))).length,
  };
  writeFileSync(path.join(workdir, 'construction.json'), JSON.stringify(record, null, 1));
  return { record, workdir, artifactPath: record.artifact ? artifactPath : null };
}
