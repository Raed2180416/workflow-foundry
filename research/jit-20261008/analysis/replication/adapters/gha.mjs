// Adapter: GitHub Actions "Update Selenium Grid Docker Versions" (pilot P5). One instance per seed (one of 14 scenario kinds), so a design's
// verdict is taken over several seeds (a design is accepted iff accepted on every seed it was run on, as the item's own tests do).
// Effect log of a run: the run status (derived from the effects, and as claimed), the versions it reports, the failure message, the
// line-level edits to files in the bot's pull request, the pull-request operation (created/updated, branch, base, title, labels), the PR text
// (commit message, body), and any other pull request it touched. Observed effects come from the same PR stub the oracle uses (outcomeFromPlan).
// Expected log = the effects of the reference plan (solveImproved), asserted equal to the instance truth on file content and PR action.
const ROOT = new URL('../../../../../experiments/replicate/items/github-actions-shafthq-update-selenium-grid-versions/', import.meta.url);
const imp = rel => import(new URL(rel, ROOT).href);

export const meta = { id: 'gha', title: 'github-actions: update-selenium-grid-versions (P5)', variant: 'T2', difficulty: 3, split: 'dev', logUnit: 'run status / versions / file line edit / PR operation / PR text' };
let M;
export async function init() {
  if (M) return M;
  const [idx, orc, ref, adv, brk, spec] = await Promise.all(['index.mjs', 'oracle.mjs', 'controls/reference.mjs', 'controls/adversarial.mjs', 'controls/broken.mjs', 'spec.mjs'].map(imp));
  M = { idx, orc, ref, adv, brk, spec };
  return M;
}
export const taskFor = (seed, variant = meta.variant) => M.idx.generate({ seed, split: meta.split, difficulty: meta.difficulty, variant });

function lineDiff(a, b) {   // LCS line diff -> ordered [{op:'del'|'add', text}]
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: 'del', text: a[i++] }); else out.push({ op: 'add', text: b[j++] }); }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

function effects(caseId, instance, outcome, truth) {
  const ev = [], c = caseId;
  const pr = outcome.pr, ops = pr.created + pr.updated;
  const derived = outcome.failed ? 'failed' : ops > 0 ? 'updated' : 'unchanged';
  ev.push({ case: c, stream: 'run', type: 'run.status', key: { derived, claimed: outcome.claimedStatus } });
  if (derived !== 'failed' && truth.status !== 'failed') ev.push({ case: c, stream: 'run', type: 'run.versions', key: { versions: outcome.versions ?? null } });
  if (derived === 'failed' || truth.status === 'failed') ev.push({ case: c, stream: 'run', type: 'run.message', key: { message: String(outcome.message ?? '') }, msg: truth.message ?? null });
  const bots = pr.pulls.filter(p => p.state === 'open' && p.head === M.spec.PR.branch);
  const op = pr.events.find(e => e.operation !== 'none');
  if (op) ev.push({ case: c, stream: 'pr', type: 'pr.operation', key: { operation: op.operation, number: op.operation === 'updated' ? op.number : null, head: op.branch } });
  for (const bot of bots) {
    ev.push({ case: c, stream: 'pr', type: 'pr.fields', key: { number: bot.number, base: bot.base, title: bot.title, labels: bot.labels } });
    for (const [path, f] of Object.entries(bot.files)) {
      const before = (instance.world.repo[path] ?? '').split('\n'), after = (f.content ?? '').split('\n');
      for (const d of lineDiff(before, after)) ev.push({ case: c, stream: `file:${path}`, type: `file.${d.op}`, key: { path, text: d.text } });
    }
    ev.push({ case: c, stream: 'pr', type: 'pr.text', key: { field: 'commit', text: bot.commitMessage }, changes: truth.changed ?? [] });
    ev.push({ case: c, stream: 'pr', type: 'pr.text', key: { field: 'body', text: bot.body }, changes: truth.changed ?? [] });
  }
  for (const n of pr.touched) if (!bots.some(b => b.number === n) && n !== pr.botBefore?.number) ev.push({ case: c, stream: 'pr', type: 'pr.touched-other', key: { number: n } });
  return ev;
}
const inst = task => M.idx.instanceOf(task);
export function logOf(task, output) {
  const instance = inst(task), truth = instance.truth[M.spec.MODE_OF[task.variant]];
  const bad = output && typeof output === 'object' ? M.orc.schemaViolations(output) : ['not an object'];
  if (bad.length) return [{ case: instance.kind, stream: 'run', type: 'run.invalid', key: { schema: true } }];
  return effects(instance.kind, instance, M.orc.outcomeFromPlan(instance, output), truth);
}
export function expectedLog(task) {
  const instance = inst(task), truth = instance.truth[M.spec.MODE_OF[task.variant]];
  const plan = M.ref.solveImproved(task.inputs);
  const out = M.orc.outcomeFromPlan(instance, plan);
  const bot = out.pr.pulls.find(p => p.state === 'open' && p.head === M.spec.PR.branch && (out.pr.touched.includes(p.number)));
  if (truth.status === 'updated' && bot?.files[M.spec.COMPOSE_PATH]?.content !== truth.composeAfter) throw new Error(`expected log disagrees with instance truth on seed ${task.seed}`);
  return effects(instance.kind, instance, out, truth);
}
export const oracleOf = (task, output) => { const r = M.idx.oracle(task, output); return { pass: r.pass, score: r.score }; };

const ctxOf = task => M.brk.contextOf(inst(task), task.variant);
export function candidates() {
  const C = [{ id: 'gha/reference (solveImproved)', kind: 'reference', make: t => M.ref.solveImproved(t.inputs) },
    { id: 'gha/faithful transcription of the original (T2 judged on intent)', kind: 'control-unlabelled', make: t => { try { return M.ref.solveFaithful(t.inputs); } catch (e) { return { __skip: true }; } } }];
  const cls = { 'pr-text-new-then-old': ['GHA-C1', 'class-correct', 'comparison'], 'pr-text-block': ['GHA-C1', 'class-correct', 'comparison'], 'pr-text-table-new-first': ['GHA-C1', 'class-correct', 'comparison'],
    'failed-with-leftovers': ['GHA-C2', 'class-correct', 'comparison'], 'labels-twice': ['GHA-C3', 'class-correct', 'comparison'],
    'LIMIT-catch-all-misleading-message': ['GHA-R1', 'class-residual', 'comparison'], 'LIMIT-reads-commented-lines-takes-max': ['GHA-R2', 'class-residual', 'battery'], 'LIMIT-stuffed-pr-text': ['GHA-R3', 'class-residual', 'comparison'] };
  for (const a of M.adv.ADVERSARIAL) { const [k, kind, d] = cls[a.name] ?? [undefined, a.correct ? 'control-correct' : 'control-wrong', undefined]; C.push({ id: `gha/${a.name}`, cls: k, kind, decidedBy: d, make: t => a.solve(t.inputs) }); }
  for (const b of M.brk.BROKEN.filter(b => b.name !== 'empty')) C.push({ id: `gha/bad ${b.name}`, kind: 'control-wrong', make: t => { const x = ctxOf(t); return b.applies(x) ? b.make(x) : { __skip: true }; } });
  C.push({ id: 'gha/bad empty', kind: 'control-wrong', make: () => ({}) });
  return C;
}
