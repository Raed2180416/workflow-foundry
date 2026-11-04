// DUR-1 case-routed agent windows (PREREG-DUR-1 §7; BUILD-PLAN row 12). The per-tick agents (A-H: Haiku 5.5 effort high
// with the AGENTV validator; A-Ox: Opus 5.5 effort xhigh, same harness) act INSIDE the real stream world on selected
// cases only: a routing arm sends the ticks of the selected cases' instances to the agent and every other instance to the
// reference policy (E8 has no cross-case state, README E8-9). The code arms' outcomes on the same cases are read from
// their own stream runs, so every comparison is paired by case and nobody pays twice. The agent reads the spec in force
// at the tick (an announced change from its publication: a zero-lag prompt update that favours the agent, declared).
// Routing uses the truth case of the instance (the host journal's instance binding): harness-side, never an arm input.
// Selection (frozen, oracle-side, arm-independent): for change c in {E1, R1, R2s, E2s} on stream s, the first k cases
// exposed to c placed in [onset, onset + 4 world-days) that the reference completes, plus 2 controls not exposed to c
// drawn with rng('dur1/window', s, c) from completed cases placed in the same days. k = 6 (P0 may set k = 4).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { bindItem } from '../../beds/ebed/host/host.mjs';
import { referenceArm } from '../../beds/ebed/oracle/policy.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { agentVArm } from '../agentv/arm.mjs';
import { contractText } from '../ebed/build.mjs';
import { runBundle, armVersion } from './arms.mjs';
import { ROOT, WORK } from './changes.mjs';
import { DAY_MS } from './schedule.mjs';

const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));
export const WINDOW_CHANGES = Object.freeze(['R2s', 'E2s', 'R1', 'E1']);       // the order windows run in (§7)
export const AGENT = Object.freeze({
  'A-H': Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', budgetUsdPerTick: 0.4, minutesPerTick: 6, retries: 1 }),
  'A-Ox': Object.freeze({ model: 'claude-opus-5-5', effort: 'xhigh', budgetUsdPerTick: 1.0, minutesPerTick: 8, retries: 1 }),
});
export const K_DEFAULT = 6, K_FALLBACK = 4, CONTROLS = 2;

/**
 * selectWindow({ stream, change, exposure (Set of completed exposed cases), pools, W, onsetMs, k }) → { exposed: [case],
 * controls: [case] } (deterministic; uses only the frozen reference's pools and exposure and world placements).
 */
export function selectWindow({ stream, change, exposed, pools, W, onsetMs, k = K_DEFAULT }) {
  const placed = c => Date.parse(W.truth.cases[c].placedAt);
  const inWin = c => W.truth.cases[c]?.subject && pools[c] === 'completed' && placed(c) >= onsetMs && placed(c) < onsetMs + 4 * DAY_MS;
  const ex = [...exposed].filter(inWin).sort((a, b) => placed(a) - placed(b) || (a < b ? -1 : 1)).slice(0, k);
  const pool = Object.keys(W.truth.cases).filter(c => inWin(c) && !exposed.has(c)).sort();
  const r = rng('dur1/window', stream, change);
  const controls = r.sample(pool, Math.min(CONTROLS, pool.length)).sort();
  return { exposed: ex, controls };
}

/**
 * routingArm({ bundle, cases, agent, journal, specAt }) → arm. Ticks of instances bound to `cases` go to `agent` (with the
 * spec in force at the tick); every other tick to the reference policy (earliest timing).
 */
export function routingArm({ bundle, cases, agent, journal, specAt = null, id = 'routed' }) {
  const ref = referenceArm({ item: bundle.item, world: bundle.W, timing: 'earliest', journal, id: 'reference-earliest' });
  const bindingOf = instance => {
    const { committed, staged } = journal();
    for (const rows of [staged, committed]) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].type === 'instance.open' && rows[i].instance === instance) return rows[i].binding ?? null;
    return null;
  };
  const routed = new Set(cases);
  const log = [];
  return {
    id,
    log,
    async tick(input, ctx) {
      const c = bindingOf(input.instance);
      if (!routed.has(c)) return ref.tick(input, ctx);
      log.push({ at: input.now, instance: input.instance, case: c });
      const files = specAt ? { ...ctx.files, 'spec/SPEC-E.md': specAt(Date.parse(input.now)) } : ctx.files;
      return agent.tick(input, { ...ctx, files, query: ctx.query, status: ctx.status, instances: ctx.instances, recordCost: ctx.recordCost?.bind(ctx) });
    },
    close() { agent.close?.(); },
  };
}

/**
 * runWindow({ bundle, cases, kind: 'A-H' | 'A-Ox', runner?, label, meter? }) → { rows, status, ticks, costUsd }. A paid run
 * passes runner = null (the model's executor); the $0 rehearsal passes the agentv dry runner. Effort must be set (D28).
 */
export async function runWindow({ bundle, cases, kind = 'A-H', runner = null, label, meter = null, keepWorkdirs = false }) {
  const conf = AGENT[kind];
  if (!conf) throw new Error(`unknown agent kind ${kind}`);
  if (!POLICY.models.some(m => m.id === conf.model)) throw new Error(`model not in the owner policy: ${conf.model}`);
  if (!conf.effort) throw new Error(`DUR1_EFFORT: ${kind} has no effort (D28 (4))`);
  const workRoot = path.join(WORK, 'windows', label.replace(/[^\w.-]/g, '_'));
  const schemas = bindItem(e8.binding).schemas;
  const costs = [];
  const routings = [];   // every routing arm made in the run (a restart of the F fault ramp makes a new one)
  const version = armVersion(`window-${kind}`, ({ bundle: b, journal }) => {
    const agent = agentVArm({ id: `${kind}-${label}`.slice(0, 60), model: conf.model, workRoot, contract: contractText(), effort: conf.effort, budgetUsdPerTick: conf.budgetUsdPerTick,
      minutesPerTick: conf.minutesPerTick, schemas, retries: conf.retries, meter, keepWorkdirs, stopOnEnvFault: true, ...(runner ? { runner } : {}) });   // an environment fault freezes the run (never scored)
    const routing = routingArm({ bundle: b, cases, agent, journal, specAt: b.specAt, id: `routed-${kind}` });
    routings.push(routing);
    return routing;
  });
  const callTimeoutMs = ((1 + conf.retries) * conf.minutesPerTick + 1) * 60_000;
  const r = await runBundle(bundle, { version, callTimeoutMs });
  for (const row of r.rows) if (row.type === 'call' && Array.isArray(row.costs)) for (const c of row.costs) costs.push(c);
  const costUsd = costs.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const log = routings.flatMap(x => x.log);
  return { rows: r.rows, status: r.status, ms: r.ms, ticks: log.length, routedCases: [...new Set(log.map(x => x.case))], costUsd, sessions: costs.length };
}
