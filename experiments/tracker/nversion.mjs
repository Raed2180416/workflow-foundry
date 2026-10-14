// N-version disagreement as an oracle-free requirement check (Avizienis's N-version programming; McKeeman's
// differential testing; AlphaCode's clustering of candidate programs by behaviour on generated inputs). $0.
// K independently built workflows for the same spec run on the same practice worlds. For every order (keyed by the
// order id the workflows themselves emit, never a truth label) each build's observable behaviour is reduced to a
// signature: the committed effects by system.op, the status values it set, the notification templates it sent. Where
// builds disagree, at least one is wrong; the majority signature is the consensus and a minority build is suspect.
// Afterwards (analysis only, never input to the method) the bed oracle says how often "suspect" means "actually fails".
//   node experiments/tracker/nversion.mjs --solvers a.mjs,b.mjs,c.mjs [--seeds 1235-1237] [--difficulties 2,3,5] [--json out]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld, referenceRuns, oracle, binding } from '../../beds/ebed/e8/index.mjs';
import { createHost } from '../../beds/ebed/host/host.mjs';
import { sandboxArm } from '../../beds/ebed/host/sandbox-arm.mjs';

/** Observable per-order signature from a run's ledger rows (no truth labels: keyed by the order id in the effect args). */
export function signatures(rows) {
  const by = new Map();
  const emitted = new Map();   // ledger rows carry an args digest; the arguments are on the effect.emit row of the same emission
  for (const r of rows) if (r.type === 'effect.emit') emitted.set(r.emission, r.effect?.args ?? null);
  for (const r0 of rows) {
    if (r0.type !== 'ledger' || !r0.committed) continue;
    const r = { ...r0, args: emitted.get(r0.emission) ?? null };
    const oid = r.args?.orderId ?? (Array.isArray(r.args?.items) ? r.args.items[0]?.orderId : null);
    if (!oid) continue;
    const s = by.get(oid) ?? { ops: {}, statuses: [], notices: [] };
    const k = `${r.system}.${r.op}`;
    s.ops[k] = (s.ops[k] ?? 0) + 1;
    if (k === 'orders.setStatus') s.statuses.push(`${r.args.fulfilmentId ? 'F' : 'O'}:${r.args.status}`);
    if (k === 'notify.send') s.notices.push(r.args.template);
    by.set(oid, s);
  }
  const out = new Map();
  for (const [oid, s] of by) out.set(oid, JSON.stringify({ ops: Object.entries(s.ops).sort(), st: [...new Set(s.statuses)].sort(), nt: [...s.notices].sort() }));
  return out;
}

/** Majority vote per order across builds. Returns per order { consensus, votes, suspects: [build index] } . */
export function vote(sigsPerBuild) {
  const orders = new Set(sigsPerBuild.flatMap(m => [...m.keys()]));
  const out = new Map();
  for (const o of orders) {
    const sig = sigsPerBuild.map(m => m.get(o) ?? '∅');
    const counts = new Map();
    for (const s of sig) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const majority = n * 2 > sig.length ? top : null;           // strict majority, else no consensus
    // No strict majority: the order is unresolved (adjudicate against the spec), never a suspect flag on every build.
    out.set(o, { consensus: majority, distinct: counts.size, unresolved: majority === null, suspects: majority === null ? [] : sig.map((s, i) => (s !== majority ? i : -1)).filter(i => i >= 0) });
  }
  return out;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const files = arg('--solvers', '').split(',').filter(Boolean);
  const [s0, s1] = arg('--seeds', '1235-1237').split('-').map(Number);
  const diffs = arg('--difficulties', '2,3,5').split(',').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const report = [], disagreements = files.map(() => []);
  const tally = files.map(() => ({ flagged: 0, flaggedFail: 0, notFlaggedFail: 0, notFlagged: 0 }));
  for (const [i, seed] of seeds.entries()) {
    const d = diffs[i % diffs.length];
    const w = generateWorld({ seed, difficulty: d, mix: 'tail' });
    const { pools } = await referenceRuns(w);
    const runs = [];
    for (const f of files) {
      const arm = sandboxArm({ id: path.basename(path.dirname(f)), solverSource: readFileSync(f, 'utf8'), timeoutMs: 20_000 });
      const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000 });
      try { await host.run(); } catch { /* graded as it stands */ } finally { arm.close(); }
      const rows = host.journal.contentRows();
      // Analysis only: the oracle's per-order verdict, keyed through the truth's subject (never fed to the vote).
      const v = oracle(w, rows, { pools, arm: 'nv' });
      const failOrders = new Set(v.cases.filter(c => c.pool === 'completed' && !c.pass).map(c => w.truth.cases[c.case]?.subject).filter(Boolean));
      const passOrders = new Set(v.cases.filter(c => c.pool === 'completed' && c.pass).map(c => w.truth.cases[c.case]?.subject).filter(Boolean));
      runs.push({ sigs: signatures(rows), failOrders, passOrders });
    }
    const votes = vote(runs.map(r => r.sigs));
    let noConsensus = 0;
    for (const [o, x] of votes) {
      if (x.unresolved) noConsensus++;
      for (const b of x.suspects) disagreements[b].push({ seed, d, order: o, mine: runs[b].sigs.get(o) ?? null, consensus: x.consensus });
      runs.forEach((r, b) => {
        if (!r.failOrders.has(o) && !r.passOrders.has(o)) return;      // not a completed case: not scored
        const flagged = x.suspects.includes(b), failed = r.failOrders.has(o);
        const t = tally[b];
        if (flagged) { t.flagged++; if (failed) t.flaggedFail++; } else { t.notFlagged++; if (failed) t.notFlaggedFail++; }
      });
    }
    report.push({ seed, d, orders: votes.size, noConsensus, perBuild: runs.map((r, b) => ({ build: files[b], oracleFails: r.failOrders.size })) });
    console.log(`world ${seed} d${d}: ${votes.size} orders, ${noConsensus} without a majority; oracle fails per build: ${runs.map(r => r.failOrders.size).join(' / ')}`);
  }
  console.log('\nper build: suspect flags vs the oracle (completed cases only)');
  tally.forEach((t, b) => {
    const prec = t.flagged ? t.flaggedFail / t.flagged : null, rec = (t.flaggedFail + t.notFlaggedFail) ? t.flaggedFail / (t.flaggedFail + t.notFlaggedFail) : null;
    console.log(`  ${files[b]}\n     flagged ${t.flagged}, of which oracle-failing ${t.flaggedFail} (precision ${prec === null ? '-' : prec.toFixed(2)}); oracle failures ${t.flaggedFail + t.notFlaggedFail}, caught ${t.flaggedFail} (recall ${rec === null ? '-' : rec.toFixed(2)})`);
  });
  const j = arg('--json', null);
  if (j) writeFileSync(j, JSON.stringify({ files, report, tally, disagreements }, null, 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
