// A run owner in its own process, for the chaos scenarios that kill, freeze, starve or restart the orchestrator
// (experiments/orch/chaos.mjs). It opens one workspace with the probe capabilities (lib/harness.mjs) and does one action:
//
//   node owner.mjs SPEC_JSON_FILE
//   spec: { workspace, action: 'create' | 'execute' | 'create-execute' | 'tick' | 'signal' | 'approve' | 'verify' | 'cancel',
//           workflow?, input?, runId?, policy?, effectsFile?, models?: <ScriptedProvider script>, clockOffsetMs?,
//           signal?: {id, name, key?, payload?}, approval?: {decision}, cancel?: {graceMs, force} }
//
// stdout: one JSON line per phase ({phase, ...}); the last line is the result. clockOffsetMs shifts Date.now() for the
// whole process (a clock step) before any module of the runtime is loaded.
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (spec.clockOffsetMs) { const real = Date.now.bind(Date); Date.now = () => real() + spec.clockOffsetMs; }
const say = row => process.stdout.write(JSON.stringify(row) + '\n');

const { Foundry } = await import('../../../src/foundry.mjs');
const { verifyRun } = await import('../../../src/verify-run.mjs');
const { probeRegistry, scriptedPort, appendDurable } = await import('./harness.mjs');
const { ScriptedProvider } = await import('../../../src/models/providers/scripted.mjs');
const { digest } = await import('../../../src/data.mjs');

const { registry, stats } = probeRegistry({ effectsFile: spec.effectsFile ?? null });
// The provider side of a model call: with modelsLedger, every call is written down when the provider receives it (a hosted
// provider bills from that moment, whatever happens to the caller).
function providerOf(spec) {
  const provider = new ScriptedProvider(spec.models);
  if (spec.modelsLedger) { const complete = provider.complete.bind(provider); provider.complete = args => { appendDurable(spec.modelsLedger, { model: args.modelEntry.id, pid: process.pid, at: Date.now() }); return complete(args); }; }
  return provider;
}
const foundry = new Foundry(spec.workspace, {
  registry, policy: { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 16, maxCost: 5, ...(spec.policy ?? {}) },
  ...(spec.models ? { models: store => scriptedPort(store, providerOf(spec)).port } : {}), cancelPollMs: 50, cancelGraceMs: 300,
});
const summary = run => run && ({ status: run.status, error: run.error ? { code: run.error.code, message: String(run.error.message ?? '').slice(0, 300) } : null,
  verdict: run.verdict ? { verdict: run.verdict.verdict, code: run.verdict.code } : null, steps: run.steps, cost: run.cost, resumeCount: run.resumeCount,
  outputDigest: run.outputs ? digest(run.outputs) : null });
try {
  let runId = spec.runId ?? null;
  if (spec.action === 'create' || spec.action === 'create-execute') {
    foundry.save(spec.workflow);
    runId = foundry.createRun(spec.workflow.id, spec.input ?? {}).id;
    say({ phase: 'created', runId, pid: process.pid });
  }
  if (spec.action === 'execute' || spec.action === 'create-execute') {
    say({ phase: 'executing', runId, pid: process.pid });
    const run = await foundry.startRun(runId);
    say({ phase: 'result', runId, ...summary(run), stats });
  } else if (spec.action === 'tick') {
    const r = await foundry.tick({ now: Date.now() });
    say({ phase: 'result', tick: r, run: runId ? summary(foundry.store.run(runId)) : null });
  } else if (spec.action === 'signal') {
    const outcomes = [];
    for (let i = 0; i < (spec.repeat ?? 1); i++) {
      try { const r = foundry.runtime.deliverSignal(runId, spec.signal); outcomes.push(r.duplicate ? 'duplicate' : 'delivered'); }
      catch (e) { outcomes.push(e.code ?? 'error'); }
    }
    say({ phase: 'result', outcomes });
  } else if (spec.action === 'approve') {
    const run = foundry.store.run(runId);
    const pending = Object.values(run.approvals ?? {}).filter(a => a.status === 'pending');
    const results = [];
    for (const a of pending) { try { foundry.runtime.approve(runId, a.id, spec.approval?.decision ?? true, 'user'); results.push({ id: a.id, ok: true }); } catch (e) { results.push({ id: a.id, code: e.code }); } }
    say({ phase: 'result', approvals: results });
  } else if (spec.action === 'verify') {
    const report = verifyRun(foundry.store, runId);
    say({ phase: 'result', ok: report.ok, findings: (report.findings ?? []).filter(f => f.severity === 'error').slice(0, 10), run: summary(foundry.store.run(runId)) });
  } else if (spec.action === 'cancel') {
    const r = await foundry.cancel(runId, { actor: 'orch', reason: 'chaos', graceMs: spec.cancel?.graceMs ?? 2000, force: !!spec.cancel?.force });
    say({ phase: 'result', cancel: { outcome: r.outcome, message: r.message } });
  }
} catch (error) {
  say({ phase: 'error', code: error.code ?? error.name, message: String(error.message ?? error).slice(0, 500), errno: error.errno ?? null });
  process.exitCode = 2;
} finally {
  try { await foundry.close(); } catch (error) { say({ phase: 'close-error', code: error.code ?? null, message: String(error.message).slice(0, 300) }); }
}
