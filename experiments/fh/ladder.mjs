// The classify -> intervene routing step of the failure-handling loop, as code (review finding M2; $0; written after FH-1).
// FH-1's heal.mjs records `intervene` as a string and every branch patches: all eight FH-1 incidents are deterministic code, so
// the step was never exercised. This is the ROADMAP §2.6 classifier's first two checks made executable, and replayed on every
// incident with recorded re-execution evidence (the 10-08 auto-heal's three and FH-1's eight):
//   1. re-execute the failing unit at the same upstream state (K times; K = 8 by §2.6). A failure that does not reproduce is
//      variance: the action is RETRY (resample), never a patch. A Wilson lower bound on the flip rate above tau decides it.
//   2. a failure that reproduces every time is a workflow defect: PATCH (L3). For a program with no model call, one re-execution
//      with an identical journal is proof of determinism (the platform and the world are deterministic), so K = 1 suffices.
//   3. a patch needs a verifier that sees the failure: if the workflow's own verdict passes the runs the oracle fails, the route is
//      PATCH WITH AN INDEPENDENT VERIFIER (the 10-08 H-rec lesson); without one, the patch loop has no correctness signal.
//   Too few re-executions to tell: RESAMPLE FIRST (the 10-08 offline classifier patched H-p1 with "variance not tested").
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Wilson score interval lower bound for k successes in n trials. */
export function wilsonLower(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n, d = 1 + z * z / n;
  return Math.max(0, (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d);
}

/**
 * route({ reruns: [{ pass, verdictPass? }], deterministic, tau, K }) -> { action, reason, flips, n, lower }
 * `reruns` are re-executions of the originally failing unit at the same upstream state; `pass` is the independent oracle's
 * judgement of each, `verdictPass` the workflow's own acceptance (if it has one). `deterministic`: the unit has no model call and
 * a re-execution produced an identical journal.
 */
export function route({ reruns = [], deterministic = false, tau = 0.05, K = 8 } = {}) {
  const n = reruns.length, flips = reruns.filter(r => r.pass).length;
  const lower = wilsonLower(flips, n);
  const blind = reruns.some(r => r.verdictPass === true && r.pass === false);
  const at = { flips, n, lower, blindVerifier: blind };
  if (n === 0) return { action: 'resample-first', reason: 'variance not tested: no live re-execution at the same state (a strict replay of recorded outputs always reproduces)', ...at };
  if (flips > 0 && lower > tau) return { action: 'retry', reason: `the failure does not reproduce (${flips}/${n} re-executions pass; Wilson lower ${lower.toFixed(3)} > ${tau}): variance, no patch`, ...at };
  if (flips === 0 && (deterministic || n >= K)) {
    if (blind) return { action: 'patch-with-independent-verifier', reason: `reproduces ${n}/${n}, but the workflow's own verdict passes runs the oracle fails: a patch loop needs a verifier that sees the failure`, ...at };
    return { action: 'patch', reason: deterministic ? 'deterministic program, identical journal on re-execution: workflow defect' : `reproduces ${n}/${n} (K = ${K}): workflow defect`, ...at };
  }
  return { action: 'resample-more', reason: `${flips}/${n} pass: neither reproducible nor clearly variance at K = ${K}${blind ? '; the workflow\'s own verdict already passes runs the oracle fails (blind verifier)' : ''}`, ...at };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

/** The recorded evidence of every incident with re-executions, and what the loop actually did. */
export function recordedIncidents() {
  const out = [];
  // 10-08 auto-heal (research/heal-20261008): the retry controls re-executed the failing trial live (experiments/heal/runs/live-20261008-r4).
  const p1 = json('experiments/heal/runs/live-20261008-r4/p1-retry.json');
  out.push({ incident: 'H-p1 (10-08)', did: 'patched (offline classifier: "variance not tested"); heal tied retry 8/8 vs 8/8 at +15% cost',
    reruns: p1.runs.filter(r => r.arm === 'base').map(r => ({ pass: r.pass, verdictPass: r.verdict === 'pass' })), deterministic: false });
  const rec = json('experiments/heal/runs/live-20261008-r4/rec-escalate.json');
  out.push({ incident: 'H-rec (10-08)', did: 'patched with the workflow\'s own verifier; 0 of 16 candidates valid',
    reruns: Array.from({ length: rec.base.n }, (_, i) => ({ pass: i < rec.base.pass, verdictPass: i < rec.base.verdictPass })), deterministic: false });
  // H-cfx: only a strict replay of the recorded trial exists (fidelity identical); its failing check reads a model node's output,
  // so a live re-execution could differ. No live re-execution was recorded.
  out.push({ incident: 'H-cfx (10-08)', did: 'patched; two valid fixes blocked by governance', reruns: [], deterministic: false });
  // FH-1: the baseline's second execution of every incident program (identical journals on all 12 worlds).
  for (const inc of ['ch-e8-1', 'ch-e8-2', 'ch-e8-3', 'cht-e8-1', 'cht-e8-2', 'cht-e8-3', 'b1lh-e8-2', 'b1lh-e8-3']) {
    const f = `research/heal-20261021/fh1/baseline/${inc}.json`;
    if (!existsSync(path.join(ROOT, f))) continue;
    const b = json(f);
    out.push({ incident: `${inc} (FH-1)`, did: 'patched (H-C, H-N, H-0)', reruns: [{ pass: b.retry.grading.nRecovered > 0 }], deterministic: b.retry.identicalJournals === true });
  }
  return out.map(x => ({ ...x, route: route(x) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('| Incident | Re-executions (oracle pass) | Deterministic | Route | Why | What the loop did |');
  console.log('|---|---|---|---|---|---|');
  for (const x of recordedIncidents()) console.log(`| ${x.incident} | ${x.route.flips}/${x.route.n} | ${x.deterministic ? 'yes' : 'no'} | **${x.route.action}** | ${x.route.reason} | ${x.did} |`);
}
