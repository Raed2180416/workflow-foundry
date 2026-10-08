// Does the promoted P1 heal (v3: k = 3 agreement on statuses/judge) correct the error it was promoted for, or did it only pass a re-roll?
// Live, journaled, capped; development evidence on inspected P1 test seeds (review of the 2026-10-08 live heal runs).
//
//   A. V3 again on the failing run, K replicas, with every live call KEPT: reader 1 (judge__s1) has the original prompt, so it replays the
//      RECORDED wrong read; readers 2 and 3 are live. A pass therefore means the new readers outvoted the recorded error (not a re-roll).
//   B. Injected-fault sweep on the recorded PASSING runs: for each status item, the recorded read is replaced (journal injection on a copy)
//      by the error class of the incident: meaning flipped, relation "none" (the check's escape hatch), compared_with "none". The parent
//      (v2) replays strictly; where that turns the oracle from pass to fail (a decisive fault), the healed head (v3) runs with readers 2/3
//      live. Reported: decisive faults, parent passes (0 by construction), healed passes.
//
//   node experiments/heal/p1-mechanism.mjs --cap-usd 0.5 [--k 3] [--max-trials 35] [--out experiments/heal/runs/review-20261008/p1-mechanism.json]
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { REPO, loadKit } from './kit.mjs';
import { allTrials, findTrial, openCtx, replayRun, taskOf, acceptedCalls, injectRow, uninject, keepLiveRows, pmap } from './replay.mjs';
import { liveProviders } from './propose.mjs';
import { Budget } from './budget.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const out = path.resolve(arg('out', path.join(REPO, 'experiments/heal/runs/review-20261008/p1-mechanism.json')));
const dir = path.dirname(out), evidence = path.join(dir, 'p1-mechanism.journal.sqlite');
const globalFile = path.resolve(arg('global-file', path.join(REPO, 'experiments/heal/runs/live-20261008/spend-global.jsonl')));
const capUsd = Number(arg('cap-usd', '0.5')), K = Number(arg('k', '3')), maxTrials = Number(arg('max-trials', '35'));
mkdirSync(dir, { recursive: true });
const budget = new Budget(capUsd, { file: path.join(dir, 'p1-mechanism.spend.jsonl') });
const charge = (usd, label) => { const l = budget.charge(usd, label); appendFileSync(globalFile, JSON.stringify({ at: l.at, scope: 'review-p1-mechanism', label, usd: l.usd }) + '\n'); };

const kit = await loadKit(), trials = allTrials();
const ARCH = path.join(REPO, 'experiments/heal/runs/live-20261008/archive/state/live1-p1');
const v2 = JSON.parse(readFileSync(path.join(ARCH, 'm-b8d4c58754.json'), 'utf8')).proposal.workflow;
const v3 = JSON.parse(readFileSync(path.join(ARCH, 'p-ff6251d1-r2.json'), 'utf8')).proposal.workflow;
const providers = liveProviders(kit, undefined, 0.05);   // a status read costs about $0.0005; the per-call cap bounds an unobservable call
const usdOf = r => (r.liveUsd ?? 0) + (r.unknownUpperUsd ?? 0);
const readers = (ctx, runId, item) => ctx.journal.forRun(runId).filter(x => new RegExp(`^root/statuses:${item}/judge(__s\\d|__esc)?$`).test(x.nodeKey) && x.ok)
  .map(x => ({ node: x.nodeKey.split('/').pop(), replayed: !!x.request?.replayOf, meaning: x.response?.value?.meaning ?? null, relation: x.response?.value?.relation ?? null }));

// ---- A ----------------------------------------------------------------------------------------------------------------------------------
const failing = findTrial('fhand-haiku/records:test:d3:s5002/1', trials), task = await taskOf(failing);
const A = [];
for (let k = 0; k < K; k++) {
  const release = budget.reserve(0.02, `A replica ${k}`);
  const ctx = await openCtx(failing.source, { kit, name: 'mechA', providers });
  try {
    const r = await replayRun(ctx, v3, failing, { mode: 'replay-or-live', task });
    charge(usdOf(r), `A V3 replica ${k}`);
    A.push({ replica: k, pass: r.pass, score: r.score, status: r.status, liveCalls: r.liveCalls, item1: readers(ctx, r.runId, 1) });
    keepLiveRows(ctx, evidence, { part: 'A', replica: k });
  } finally { release(); ctx.close(); }
}
console.error(`[mech] A: ${A.filter(a => a.pass).length}/${A.length} pass; reader 1 on item 1: ${A.map(a => a.item1.find(x => x.node === 'judge__s1')?.meaning + (a.item1.find(x => x.node === 'judge__s1')?.replayed ? '(replayed)' : '(live)')).join(', ')}`);

// ---- B ----------------------------------------------------------------------------------------------------------------------------------
const passing = trials.filter(t => t.source === 'p1' && t.armId === 'fhand-haiku' && t.family === 'records' && t.pass).sort((a, b) => a.key.localeCompare(b.key)).slice(0, maxTrials);
const B = [];
let stopped = null;
await pmap(passing, 3, async t => {
  if (stopped) return;
  const tk = await taskOf(t), ctx = await openCtx(t.source, { kit, name: 'mechB', providers });
  try {
    const items = acceptedCalls(ctx.journal, t.runId).filter(r => /^root\/statuses:\d+\/judge$/.test(r.nodeKey));
    for (const row of items) {
      if (stopped) break;
      const v = row.response.value, wrong = { ...v, meaning: v.meaning === 'void' ? 'live' : 'void', relation: 'none', compared_with: 'none' };
      const item = Number(/statuses:(\d+)/.exec(row.nodeKey)[1]);
      injectRow(ctx.db, row.id, wrong);
      try {
        const parent = await replayRun(ctx, v2, t, { mode: 'replay', task: tk });
        const decisive = parent.status === 'succeeded' ? !parent.pass : parent.error?.code !== 'REPLAY_MISS';
        const rec = { trial: t.key, item, from: v.meaning, parent: { pass: parent.pass, status: parent.status, err: parent.error?.code ?? null }, decisive };
        if (decisive) {
          let release;
          try { release = budget.reserve(0.02, `B ${t.key} item ${item}`); } catch (e) { stopped = e.message; B.push({ ...rec, healed: null, skipped: 'cap' }); break; }
          try {
            const healed = await replayRun(ctx, v3, t, { mode: 'replay-or-live', task: tk });
            charge(usdOf(healed), `B healed ${t.key} item ${item}`);
            rec.healed = { pass: healed.pass, status: healed.status, err: healed.error?.code ?? null, liveCalls: healed.liveCalls, readers: readers(ctx, healed.runId, item) };
          } finally { release(); }
        }
        B.push(rec);
      } finally { uninject(ctx.db, row.id); }
    }
    keepLiveRows(ctx, evidence, { part: 'B', trial: t.key });
  } finally { ctx.close(); }
});
const dec = B.filter(b => b.decisive && b.healed);
const result = { schema: 'heal-p1-mechanism/1', at: new Date().toISOString(), tier: 'development/diagnostic (P1 test seeds are INSPECTED)', parent: v2.version, healed: v3.version,
  A: { replicas: A.length, pass: A.filter(a => a.pass).length, reader1ReplayedWrong: A.filter(a => { const r1 = a.item1.find(x => x.node === 'judge__s1'); return r1?.replayed && r1.meaning === 'live'; }).length, rows: A },
  B: { trials: passing.length, faults: B.length, decisive: B.filter(b => b.decisive).length, parentPass: dec.filter(b => b.parent.pass).length, healedPass: dec.filter(b => b.healed.pass).length, ran: dec.length,
    escalated: dec.filter(b => b.healed.readers.some(r => r.node === 'judge__esc')).length, stopped, rows: B },
  spentUsd: budget.summary().spentUsd, capUsd, evidence: path.relative(REPO, evidence) };
writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ A: { pass: result.A.pass, of: result.A.replicas, reader1ReplayedWrong: result.A.reader1ReplayedWrong }, B: { faults: result.B.faults, decisive: result.B.decisive, ran: result.B.ran, parentPass: result.B.parentPass, healedPass: result.B.healedPass, escalated: result.B.escalated, stopped }, spentUsd: result.spentUsd }));
process.exit(0);
