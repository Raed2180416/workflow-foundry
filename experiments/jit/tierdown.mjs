// JIT tier-down (THESIS-JIT §2.6): move each compiled solver's judgments down the model ladder, using the stream's
// own traces as the reference. A judge whose accepted value never varied becomes a code constant (T3). A judge that
// usually needs Sonnet is re-tried on Haiku with the existing successive-halving distiller. Every judge can be exported as
// Kev training records (T2), one question per enum field of its output.
//
// Agreement here is with the value the compiled solver accepted (it passed the solver's code check), not with an
// oracle. As distill.mjs says, it is a screening signal only: an assignment must be confirmed end to end on a stream.
//
//   node experiments/jit/tierdown.mjs <dir> [--json]                      profile every judge (no model calls)
//   node experiments/jit/tierdown.mjs <dir> --live --cap-usd 2 [--judge <name>] [--threshold 0.98]
//   node experiments/jit/tierdown.mjs <dir> --kev <out.jsonl> --judge <name>
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from '../../src/data.mjs';
import { searchNode, leafAgreement } from '../lib/distill.mjs';

// Cheapest first. Only ids from policy/models.json; local generative models are parked (owner decision), and Kev is
// reached through training/benchmark jobs on the laptop bridge, not through this ladder.
export const LADDER = Object.freeze(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name), s = statSync(p);
    if (s.isDirectory()) walk(p, out); else if (name === 'trace.jsonl' || name === 'results.jsonl') out.push(p);
  }
  return out;
};
const lines = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });

// Judge events from flow.mjs traces: trace.jsonl files, or results.jsonl rows that embed { trace: [events] }.
// Truncated requests cannot be replayed, so they are profiled but never re-tried.
export function harvestJudges(root) {
  const byName = new Map(), seen = new Set();
  for (const file of walk(root)) {
    const events = path.basename(file) === 'trace.jsonl'
      ? lines(file).map(e => ({ ...e, _src: file }))
      : lines(file).flatMap(r => (Array.isArray(r.trace) ? r.trace : []).map(e => ({ ...e, _src: file, _task: r.taskId })));
    for (const e of events) {
      if (e.kind !== 'judge' || e.value === undefined) continue;
      const key = canonical([e.name, e.system ?? '', e.prompt ?? '', e.value]);
      if (seen.has(key)) continue;   // a trace file and the results row that embeds it describe the same call
      seen.add(key);
      if (!byName.has(e.name)) byName.set(e.name, []);
      byName.get(e.name).push({ name: e.name, system: e.system ?? '', prompt: e.prompt, schema: e.schema, value: e.value, tier: e.tier ?? null,
        tiersTried: e.tiersTried ?? [], costUsd: e.costUsd ?? 0, truncated: !!e.truncated, src: e._src, taskId: e._task ?? null });
    }
  }
  return byName;
}

export function profileJudge(calls) {
  const tiers = {}, values = new Set(calls.map(c => canonical(c.value)));
  for (const c of calls) tiers[c.tier ?? 'unknown'] = (tiers[c.tier ?? 'unknown'] ?? 0) + 1;
  const escalated = calls.filter(c => (c.tiersTried?.length ?? 0) > 1).length, cost = calls.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const top = Object.entries(tiers).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    name: calls[0]?.name, n: calls.length, tiers, modalTier: top, escalationRate: calls.length ? escalated / calls.length : 0,
    costUsd: cost, meanCostUsd: calls.length ? cost / calls.length : 0, distinctValues: values.size,
    // T3 candidate: one value across at least 5 calls. It is a proposal for the compiler, never applied automatically.
    constant: calls.length >= 5 && values.size === 1 ? calls[0].value : undefined,
    replayable: calls.filter(c => !c.truncated && c.prompt && c.schema).length,
  };
}

// Evidence fields (verbatim quotes, free-text reasons) are how a judge shows its work, not what it decides: two models can
// quote the same sentence differently and agree on every decision. Agreement is scored on decision leaves only.
export const EVIDENCE_KEY = /^(quote|quotes|evidence|reason|reasons|rationale|note|notes|explanation|span|spans|source_text|why)$/i;
export function stripEvidence(v, ignore = EVIDENCE_KEY) {
  if (Array.isArray(v)) return v.map(x => stripEvidence(x, ignore));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !ignore.test(k)).map(([k, x]) => [k, stripEvidence(x, ignore)]));
  return v;
}
export const decisionAgreement = (ref, cand) => leafAgreement(stripEvidence(ref), stripEvidence(cand));

// Re-try one judge on every ladder model cheaper than its modal tier, cheapest first.
export async function tierDownJudge({ calls, modelPort, runId, threshold = 0.98, rounds = [4, 8, 16], log = () => {}, agreement = decisionAgreement }) {
  const prof = profileJudge(calls), at = LADDER.indexOf(prof.modalTier);
  const candidates = at > 0 ? LADDER.slice(0, at) : [];
  if (!candidates.length) return { ...prof, candidates: [], assigned: null, reason: at === 0 ? 'already at the cheapest hosted tier' : 'modal tier not on the ladder' };
  const replayable = calls.filter(c => !c.truncated && c.prompt && c.schema);
  const r = await searchNode({ node: prof.name, calls: replayable, candidates, modelPort, runId, threshold, rounds, log, agreement });
  return { ...prof, candidates: r.candidates.map(({ samples, ...c }) => c), assigned: r.assigned, sampleSize: r.sampleSize, threshold };
}

// Kev records (experiments/kev-data/export-kev.mjs wire shape): state = the judge's input, one classification question per
// top-level enum field of the output schema, label = the accepted value. Free-text fields (quotes, notes) stay with Haiku.
export function kevRecords(calls, { src = null } = {}) {
  const out = [];
  for (const c of calls) {
    if (c.truncated || !c.schema?.properties) continue;
    const questions = {};
    for (const [field, spec] of Object.entries(c.schema.properties)) {
      if (!Array.isArray(spec.enum) || !spec.enum.includes(c.value?.[field])) continue;
      questions[field] = { type: 'classification', instructions: c.system.slice(0, 4000), criteria: spec.enum.map(String), label: c.value[field], src: src ?? `jit_${c.name}` };
    }
    if (Object.keys(questions).length) out.push({ state: c.prompt, questions, _meta: { id: createHash('sha256').update(canonical([c.name, c.prompt, c.value])).digest('hex').slice(0, 24), source: 'jit-trace' } });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), root = args[0], flag = n => args.includes(n), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  if (!root) { console.error('usage: tierdown.mjs <dir> [--json] [--live --cap-usd N] [--judge name] [--kev out.jsonl]'); process.exit(2); }
  const judges = harvestJudges(root), only = opt('--judge');
  const names = [...judges.keys()].filter(n => !only || n === only).sort();
  if (opt('--kev')) {
    const recs = names.flatMap(n => kevRecords(judges.get(n)));
    mkdirSync(path.dirname(path.resolve(opt('--kev'))), { recursive: true });
    writeFileSync(opt('--kev'), recs.map(r => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
    console.log(`wrote ${recs.length} Kev records for ${names.join(', ')}`);
  } else if (flag('--live')) {
    const { createModelPort } = await import('../lib/models.mjs');
    const cap = Number(opt('--cap-usd') ?? 2), threshold = Number(opt('--threshold') ?? 0.98);
    const { port, db } = createModelPort({ journalFile: path.join(root, 'tierdown.journal.sqlite'), allowedModels: [...LADDER] });
    let spent = 0;
    const metered = { call: async req => { if (spent >= cap) throw new Error(`tier-down cap $${cap} reached`); const r = await port.call(req); spent += r.costUsd ?? 0; return r; } };
    const results = [];
    for (const n of names) {
      try { results.push(await tierDownJudge({ calls: judges.get(n), modelPort: metered, runId: `tierdown:${path.basename(root)}`, threshold, log: console.error })); }
      catch (e) { results.push({ ...profileJudge(judges.get(n)), error: String(e.message ?? e) }); if (spent >= cap) break; }
    }
    db.close();
    writeFileSync(path.join(root, 'tierdown.json'), JSON.stringify({ spentUsd: spent, capUsd: cap, threshold, results }, null, 1));
    console.log(JSON.stringify({ spentUsd: spent, judges: results.map(r => ({ name: r.name, modalTier: r.modalTier, assigned: r.assigned ?? null, error: r.error })) }));
  } else {
    const profiles = names.map(n => profileJudge(judges.get(n)));
    if (flag('--json')) console.log(JSON.stringify(profiles, null, 1));
    else {
      console.log('| judge | n | modal tier | escalation | $/call | distinct values | constant? |\n|---|---|---|---|---|---|---|');
      for (const p of profiles) console.log(`| ${p.name} | ${p.n} | ${p.modalTier} | ${(100 * p.escalationRate).toFixed(0)}% | ${p.meanCostUsd.toFixed(4)} | ${p.distinctValues} | ${p.constant !== undefined ? 'yes' : 'no'} |`);
    }
  }
}
