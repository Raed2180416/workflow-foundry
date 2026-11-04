#!/usr/bin/env node
// $0 cost model for AgentDojo arms (an ESTIMATE [inf], replaced by the dev pilot's measured cost). It reads a scripted
// gold run's host-only call logs (the tool outputs an agent that follows the gold would see), the suite catalogs and the
// system prompt, and prices one session per unit with the policy file's prices under prompt caching:
//   turn k (k = 1..T, T = gold steps + 1) sends the context so far; turn 1 writes the cache for the base
//   (system + catalog + prompt + CLI overhead), later turns read the cached prefix (0.1x input price) and write the new
//   tail (1.25x); every turn emits `outPerTurn` tokens (thinking + call), the last one also the answer.
// An agent explores more than the gold: `turnFactor` multiplies the turns and the tool output volume (low / mid / high).
// Tokens are characters / 4. Writes research/breadth-20261021/agentdojo/cost-estimate.json.
//
//   node experiments/breadth/agentdojo/costest.mjs --run <gold scripted run id> [--out FILE]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPolicy, modelById } from '../../../src/models/policy.mjs';
import { HOST_ROOT, RESEARCH, readJson, writeJson } from './lib.mjs';
import { ARMS, systemPrompt } from './run.mjs';

export const ASSUMPTIONS = Object.freeze({
  charsPerToken: 4, cliOverheadTokens: 2000, answerTokens: 150, cacheRead: 0.1, cacheWrite: 1.25,
  outPerTurn: Object.freeze({ 'A-H': 400, 'A-HN': 450, 'A-S': 500, 'A-O': 1200 }),
  turnFactor: Object.freeze({ low: 1.2, mid: 1.8, high: 3.0 }),
  plan: Object.freeze({
    dev: Object.freeze({ 'A-H': { units: 117, repeat: 1 }, 'A-S': { units: 30, repeat: 1 }, 'A-O': { units: 30, repeat: 1 } }),
    sealed: Object.freeze({ 'A-H': { units: 174, repeat: 2 }, 'A-S': { units: 61, repeat: 2 }, 'A-O': { units: 20, repeat: 2 }, 'A-HN': { units: 174, repeat: 1 } }),
  }),
});
const tok = s => Math.ceil(String(s ?? '').length / ASSUMPTIONS.charsPerToken);

/** Per-unit trajectory facts from a scripted run's host-only call logs. */
export function trajectories(runId) {
  const dir = path.join(HOST_ROOT, 'runs', runId, 'units');
  if (!existsSync(dir)) throw new Error(`no host-only unit logs for ${runId}`);
  return readdirSync(dir).map(tag => {
    const f = path.join(dir, tag, 'calls.jsonl');
    const steps = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.step) : [];
    return { tag, suite: tag.split('__')[0], steps: steps.length, outputs: steps.map(s => s.results.reduce((a, r) => a + tok(r.content), 0)),
      callArgs: steps.map(s => s.calls.reduce((a, c) => a + tok(JSON.stringify(c.args)), 0)) };
  });
}

/** Expected USD of one session on a trajectory for one arm and turn factor. */
export function sessionCost({ baseTokens, outputs, callArgs }, { inPrice, outPrice, outPerTurn, factor }) {
  const T = Math.max(1, Math.round((outputs.length + 1) * factor));
  const scale = factor; // more exploration: more and larger tool outputs
  let prefix = baseTokens, inUsd = (ASSUMPTIONS.cacheWrite * baseTokens) * inPrice, outTok = 0;
  for (let k = 1; k < T; k++) {
    const i = Math.min(outputs.length - 1, Math.floor((k - 1) / scale));
    const tail = outPerTurn + (i >= 0 ? (outputs[i] + (callArgs[i] ?? 0)) : 200);
    inUsd += (ASSUMPTIONS.cacheRead * prefix + ASSUMPTIONS.cacheWrite * tail) * inPrice;
    prefix += tail; outTok += outPerTurn;
  }
  outTok += outPerTurn + ASSUMPTIONS.answerTokens;
  return (inUsd + outTok * outPrice) / 1e6;
}

export function estimate(runId) {
  const inv = readJson('/var/tmp/foundry-work/agentdojo-live/parity/inventory.json');
  const policy = loadPolicy().policy;
  const trs = trajectories(runId);
  const catTok = Object.fromEntries(Object.entries(inv.suites).map(([s, v]) => [s, tok(JSON.stringify(v.catalog))]));
  const sysTok = tok(systemPrompt({ upstreamSystem: inv.systemMessage, notes: false }));
  const out = { kind: 'agentdojo-cost-estimate', version: 1, evidence: '[inf] model of a gold-following agent with exploration factors; the dev pilot measures the real cost', run: runId,
    assumptions: ASSUMPTIONS, catalogTokens: catTok, systemPromptTokens: sysTok, units: trs.length, perUnitUsd: {}, plans: {} };
  for (const [arm, cfg] of Object.entries(ARMS)) {
    const m = modelById(policy, cfg.model);
    const price = { inPrice: m.price.inputPerMTok, outPrice: m.price.outputPerMTok, outPerTurn: ASSUMPTIONS.outPerTurn[arm] };
    out.perUnitUsd[arm] = Object.fromEntries(Object.entries(ASSUMPTIONS.turnFactor).map(([k, factor]) => {
      const costs = trs.map(t => sessionCost({ baseTokens: sysTok + catTok[t.suite] + 200 + ASSUMPTIONS.cliOverheadTokens + (cfg.notes ? 300 : 0), outputs: t.outputs, callArgs: t.callArgs }, { ...price, factor }));
      return [k, costs.reduce((a, b) => a + b, 0) / costs.length];
    }));
  }
  for (const [name, plan] of Object.entries(ASSUMPTIONS.plan)) {
    out.plans[name] = Object.fromEntries(Object.entries(plan).map(([arm, p]) => [arm, Object.fromEntries(Object.entries(out.perUnitUsd[arm]).map(([k, v]) => [k, Math.round(v * p.units * p.repeat * 100) / 100]))]));
    out.plans[name].total = Object.fromEntries(Object.keys(ASSUMPTIONS.turnFactor).map(k => [k, Math.round(Object.entries(out.plans[name]).filter(([a]) => a !== 'total').reduce((s, [, v]) => s + v[k], 0) * 100) / 100]));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--run'), o = process.argv.indexOf('--out');
  if (i < 0) { console.error('usage: costest.mjs --run <gold scripted run id> [--out FILE]'); process.exit(2); }
  const res = estimate(process.argv[i + 1]);
  const file = o > 0 ? process.argv[o + 1] : path.join(RESEARCH, 'cost-estimate.json');
  writeJson(file, res);
  console.log(JSON.stringify({ perUnitUsd: res.perUnitUsd, plans: res.plans, out: file }, null, 1));
}
