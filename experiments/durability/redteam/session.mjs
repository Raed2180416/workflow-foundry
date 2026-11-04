// DUR-1 J2 red-team session driver (PREREG-DUR-1 §8.3; BUILD-PLAN row 15). Sessions: RT-O1 (Opus 5.5 xhigh) against
// b1lh-e8-1 at t0, RT-O2 (Opus 5.5 xhigh) against ch-e8-1 at t0, RT-H (Haiku 5.5 high) against b1lh-e8-1 at t0. The workdir
// holds the target's source, SPEC-E, the contract, the API schemas, the DSL documentation and probe.mjs. <= 25 probes;
// output SCENARIOS.json: <= 8 scenarios of <= 16 arriving orders, each with predicted failing cases and a rationale. Each
// scenario passes the validity gate (validate.mjs) or is dropped (a bed finding is reported). The blind baseline is WC-1
// local search with the same 25 probes on the same target (D-11 compares the best silent failing count).
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, appendFileSync } from 'node:fs';
import { runClaudeCode } from '../../../src/executors/claude-code.mjs';
import { contractText } from '../../ebed/build.mjs';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { MockSystem } from '../../../beds/ebed/host/mocks.mjs';
import { TRANSFORMS, FAULTS, OVERLAYS, DIFFICULTIES, SIZE } from '../knobs.mjs';
import { serveProbes, PROBE_CLIENT, MAX_PROBES, MAX_SCENARIOS, MAX_ORDERS } from './probe.mjs';
import { validateScenario } from './validate.mjs';
import { evaluate, search } from '../wc-search.mjs';
import { WORK } from '../changes.mjs';
import { spendOf, EffortMissing, throwIfEnvFault, preflight, meteredRun } from '../heal-adapter.mjs';

export const RT_SESSIONS = Object.freeze({
  'RT-O1': Object.freeze({ target: 'b1lh-e8-1', model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 3, minutes: 30 }),
  'RT-O2': Object.freeze({ target: 'ch-e8-1', model: 'claude-opus-5-5', effort: 'xhigh', budgetUsd: 3, minutes: 30 }),
  'RT-H': Object.freeze({ target: 'b1lh-e8-1', model: 'claude-haiku-5-5', effort: 'high', budgetUsd: 0.5, minutes: 20 }),
});

export const DSL_DOC = `# Scenario language (a scenario is a JSON object; the platform's generator makes the world from it)

{ "base": one of 1301-1310, "salt": 0-9999 (a different world per salt), "difficulty": ${DIFFICULTIES.join('|')},
  "mix": "natural" | "tail", "size": ${SIZE.min}-${MAX_ORDERS} arriving orders,
  "transforms": up to two of ${JSON.stringify(TRANSFORMS)} (in-spec metamorphic transforms; anything else is refused),
  "fault": one of ${JSON.stringify(FAULTS)} (restart/crash: platform faults; ldfi-pair: a transient then a permanent failure on two
  saga steps of one order), "overlays": up to two of ${JSON.stringify(OVERLAYS)} (rule and environment changes) }

\`node probe.mjs scenario.json\` runs a scenario against the target and prints every case's verdict (pass, critical, first
divergence: rule, layer, code) and the effects. At most ${MAX_PROBES} probes.
`;

const task = ({ target }) => `# Task: find the worst worlds for this workflow

target/ holds a deployed E8 order-saga program (${target}). SPEC-E.md is its spec; CONTRACT.md its platform contract;
api/ the systems' schemas; DSL.md the scenario language. Find scenarios (worlds the generator makes) in which the program
fails cases SILENTLY (no error, no refusal: it just does the wrong thing), above all critical ones (money moved wrongly,
compensation missing). Use \`node probe.mjs scenario.json\` to test ideas (at most ${MAX_PROBES} probes).

Write SCENARIOS.json: an array of at most ${MAX_SCENARIOS} objects { "scenario": {...}, "predictedFailing": "which cases fail and
how", "rationale": "why the program fails there" }. Every scenario must be valid: the reference implementation passes it.
`;

function apiFiles() {
  const out = {};
  for (const def of e8.systems) out[`api/${def.id}.schema.json`] = JSON.stringify(new MockSystem(def).apiSchema(Date.parse('2026-03-02T00:00:00+01:00')), null, 1);
  return out;
}

/** One red-team session; session = { kind: 'stub', fn } or a paid config with spend. Returns { scenarios, validated, record }. */
export async function redTeamSession({ id, targetId, version, session, runDir, sealed = null, log = () => {} }) {
  const workdir = path.join(WORK, 'redteam', id);
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(path.join(workdir, 'target'), { recursive: true });
  if (version.programKind === 'composed') cpSync(version.dir, path.join(workdir, 'target'), { recursive: true });
  else writeFileSync(path.join(workdir, 'target', 'solver.mjs'), version.source);
  const files = { 'SPEC-E.md': e8.specE.text, 'CONTRACT.md': contractText(), 'DSL.md': DSL_DOC, 'TASK.md': task({ target: targetId }), 'probe.mjs': PROBE_CLIENT, ...apiFiles() };
  for (const [f, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, f)), { recursive: true }); writeFileSync(path.join(workdir, f), t); }
  mkdirSync(runDir, { recursive: true });
  const box = serveProbes({ workdir, targetId, version, sealed, journal: path.join(runDir, `${id}.probes.jsonl`) });
  const rec = { id, target: targetId, at: new Date().toISOString() };
  let r;
  try {
    if (session.kind === 'stub') r = await session.fn({ workdir, box });
    else {
      preflight(session, id);
      r = await meteredRun(session, { label: id, run: () => runClaudeCode({ model: session.model, prompt: `${files['TASK.md']}\nRead TASK.md, DSL.md and target/ first.`, workdir, files: {}, budgetUsd: session.budgetUsd, timeoutMs: session.minutes * 60_000, effort: session.effort }) });
    }
  } finally { rec.probes = await box.stop(); }
  throwIfEnvFault(r, id);
  rec.session = { kind: session.kind ?? 'paid', model: session.model ?? null, effort: session.effort ?? null, costUsd: r?.costUsd ?? 0, error: r?.error ?? null };
  let scenarios = [];
  try { scenarios = JSON.parse(readFileSync(path.join(workdir, 'SCENARIOS.json'), 'utf8')); } catch { scenarios = []; }
  if (!Array.isArray(scenarios)) scenarios = [];
  scenarios = scenarios.slice(0, MAX_SCENARIOS);
  const validated = [];
  for (const s of scenarios) validated.push({ ...(await validateScenario(s.scenario ?? {}, { targetId: id, sealed })), predicted: String(s.predictedFailing ?? '').slice(0, 300), rationale: String(s.rationale ?? '').slice(0, 600) });
  rec.scenarios = scenarios.length; rec.valid = validated.filter(v => v.valid).length; rec.bedFindings = validated.filter(v => v.bedFinding).length;
  writeFileSync(path.join(runDir, `${id}.record.json`), JSON.stringify({ ...rec, validated }, null, 1));
  rmSync(workdir, { recursive: true, force: true });
  log(`${id}: ${rec.probes} probes, ${rec.scenarios} scenarios, ${rec.valid} valid, ${rec.bedFindings} bed findings`);
  return { scenarios, validated, record: rec };
}

/** A $0 stub red-teamer: probes a few fixed ideas and writes them as scenarios (exercises the probe budget and the gate). */
export function stubRedTeam({ probes = 3 } = {}) {
  return { kind: 'stub', fn: async ({ workdir, box }) => {
    const ideas = [
      { base: 1301, salt: 11, difficulty: 3, mix: 'tail', size: 12, transforms: ['MR11'], fault: 'none', overlays: [] },
      { base: 1302, salt: 5, difficulty: 5, mix: 'tail', size: 12, transforms: [], fault: 'ldfi-pair', overlays: ['E1'] },
      { base: 1303, salt: 7, difficulty: 4, mix: 'natural', size: 12, transforms: ['MR5-delayed'], fault: 'crash', overlays: [] },
    ].slice(0, probes);
    const results = [];
    for (const [i, s] of ideas.entries()) {
      writeFileSync(path.join(workdir, 'probes', `req-${i + 1}.json`), JSON.stringify(s));
      const res = path.join(workdir, 'probes', `res-${i + 1}.json`);
      while (!existsSync(res)) { await box.tick(); if (!existsSync(res)) await new Promise(r => setTimeout(r, 200)); }
      results.push(JSON.parse(readFileSync(res, 'utf8')));
    }
    const scored = ideas.map((s, i) => ({ s, fails: (results[i].cases ?? []).filter(c => !c.pass).length })).sort((a, b) => b.fails - a.fails);
    writeFileSync(path.join(workdir, 'SCENARIOS.json'), JSON.stringify(scored.map(x => ({ scenario: x.s, predictedFailing: `${x.fails} cases`, rationale: 'stub: fixed idea list, ranked by probe failures' }))));
    return { costUsd: 0, turns: 0 };
  } };
}

/** The blind baseline (D-11): WC-1 local search with the same probe budget on the same target. */
export async function blindBaseline({ targetId, version, probes = MAX_PROBES, sealed = null, log = () => {} }) {
  return search({ targetId: `blind-${targetId}`, version, budget: probes, seed: 'dur1/j2-blind', poolSize: 60, sealed, maxSize: MAX_ORDERS, log });
}
export { evaluate };
