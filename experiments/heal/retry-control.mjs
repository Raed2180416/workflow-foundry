// "Retry unchanged" control for a failing recorded trial (DESIGN §12 EX1 baseline), live, journaled, capped.
// Re-runs the ORIGINAL workflow and the HEALED head on the failing task with fresh salts (every model call goes live), n times each, and
// reports how often each passes the bed oracle. If the original passes about as often as the healed head, "the failing case now passes"
// (V3) was sampling luck, not evidence of a fix.
//
//   node experiments/heal/retry-control.mjs --incident p1 --state-tag live1 --n 8 --cap-usd 0.3 --out experiments/heal/runs/live-20261008-r4/p1-retry.json
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { REPO, WORK_ROOT, loadKit } from './kit.mjs';
import { allTrials, findTrial, loadWorkflow, p1Workflow, openCtx, replayRun, taskOf, pmap, keepLiveRows } from './replay.mjs';
import { liveProviders } from './propose.mjs';
import { INCIDENTS } from './live.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const key = arg('incident'), inc = INCIDENTS[key], n = Number(arg('n', '8')), capUsd = Number(arg('cap-usd', '0.3')), tag = arg('state-tag', 'live1');
const out = path.resolve(arg('out', path.join(REPO, `experiments/heal/runs/retry-${key}.json`)));
const globalFile = path.resolve(arg('global-file', path.join(REPO, 'experiments/heal/runs/live-20261008/spend-global.jsonl')));
const kit = await loadKit(), trials = allTrials(), trial = findTrial(inc.run, trials);
const base = inc.workflow.startsWith('preset:') ? await p1Workflow('M') : await loadWorkflow(path.join(REPO, inc.workflow));
const store = new kit.Store(path.join(WORK_ROOT, 'state', `${tag}-${key}`)), head = store.workflow(base.id);
const task = await taskOf(trial);
const providers = liveProviders(kit, undefined, Math.min(0.25, capUsd));
const empty = kit.emptyJournal(path.join(WORK_ROOT, 'retry', `empty-${process.pid}.sqlite`)); empty.db.close();
let spent = 0;
const runs = [];
// --escalate NODE:CLASS: instead of the promoted head, a variant of the original with one node on a stronger class (a capability probe:
// would the cheapest allocator heal have worked?). Not a promoted workflow, never written to a lineage.
const esc = arg('escalate', null);
let variant = head.workflow;
if (esc) { const [id, cls] = esc.split(':'); variant = structuredClone(base); const n = variant.nodes.find(x => x.id === id); n.model = { ...n.model, class: cls, maxClass: cls }; variant.version = base.version + 1; }
const arms = [['base', base], [esc ? `escalate-${esc}` : 'healed', variant]];
await pmap(arms.flatMap(([name, wf]) => Array.from({ length: n }, (_, i) => ({ name, wf, i }))), 3, async ({ name, wf, i }) => {
  if (spent > capUsd) { runs.push({ arm: name, i, skipped: 'cap' }); return; }
  const ctx = await openCtx(trial.source, { kit, name: `retry-${name}`, providers, journalFile: empty.file });
  try {
    const r = await replayRun(ctx, wf, trial, { mode: 'replay-or-live', salt: `heal-retry:${key}:${i}`, task });
    const usd = (r.liveUsd ?? 0) + (r.unknownUpperUsd ?? 0); spent += usd;
    appendFileSync(globalFile, JSON.stringify({ at: new Date().toISOString(), scope: `${inc.id}-retry`, label: `retry-control ${name} #${i}`, usd: +usd.toFixed(6) }) + '\n');
    runs.push({ arm: name, i, pass: r.pass, score: r.score, status: r.status, verdict: r.verdict, calls: r.calls, usd: +usd.toFixed(5) });
  } finally { try { keepLiveRows(ctx, out.replace(/\.json$/, '') + '.journal.sqlite', { arm: name, i }); } catch { /* best effort */ } ctx.close(); }
});
store.close();
const sum = a => { const rs = runs.filter(r => r.arm === a && !r.skipped); return { n: rs.length, pass: rs.filter(r => r.pass).length, verdictPass: rs.filter(r => r.verdict === 'pass').length, usd: +rs.reduce((s, r) => s + r.usd, 0).toFixed(4) }; };
const result = { schema: 'heal-retry-control/1', incident: inc.id, trial: trial.key, recordedPass: trial.pass, healedHash: esc ? null : head.hash, healedVersion: esc ? null : head.workflow.version, arm2: arms[1][0], base: sum('base'), healed: sum(arms[1][0]), spentUsd: +spent.toFixed(4), runs: runs.sort((a, b) => a.arm.localeCompare(b.arm) || a.i - b.i) };
mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ base: result.base, healed: result.healed, spentUsd: result.spentUsd }));
process.exit(0);
