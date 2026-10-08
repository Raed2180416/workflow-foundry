// The oracle: did the job get done on this Monday? It judges EFFECTS, never how the solution is built. It sees an outcome:
//   failed / message   whether the run ended in a visible failure, and what it said;
//   claimedStatus      what the solution says it did (updated | unchanged | failed); must agree with the effects;
//   versions           the tags it reports having found (current in the repository, latest in the reference, after the pre-release rule);
//   pr                 the state of the recording pull-request stub after the run (mocks/pull-requests.mjs);
//   calls              the HTTP requests the reference mock saw and the URLs the curl shim blocked (executed solutions only; null for a plan).
// Two sources produce an outcome: a plan (outcomeFromPlan: the host applies the solver's files and pull-request request through the
// same stub) and an executed workflow (runner.mjs). Both are judged by the same checks against the instance's truth.
import Ajv from 'ajv';
import { COMPOSE_PATH, KEYS, PR, REFERENCE_URL, STATUSES, TRACKED } from './spec.mjs';
import { PullRequestStore } from './mocks/pull-requests.mjs';

// ---------- the output a solver returns -----------------------------------------------------------------------------------------------
const tagSet = { type: 'object', required: [...KEYS], additionalProperties: false, properties: Object.fromEntries(KEYS.map(k => [k, { type: 'string' }])) };
export const outputSchema = {
  type: 'object',
  required: ['status', 'versions', 'files', 'pull_request', 'message'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...STATUSES], description: 'updated: a pull request was opened or updated; unchanged: nothing to do; failed: the run failed visibly and changed nothing' },
    versions: { type: 'object', required: ['current', 'latest'], additionalProperties: false, properties: { current: tagSet, latest: tagSet },
      description: 'the tag found for each tracked image in the repository file (current) and in the reference file after the pre-release rule (latest); "" if there is none' },
    files: { type: 'object', additionalProperties: { type: 'string' }, description: 'path -> complete new content, for every file the run edited in the working tree' },
    pull_request: { type: 'object', required: ['open'], additionalProperties: false,
      properties: { open: { type: 'boolean' }, branch: { type: 'string' }, title: { type: 'string' }, commit_message: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } },
      description: 'the request to open (or update) a pull request from the working tree; open=false for none' },
    message: { type: 'string', description: 'what the run reports; on failure it must say what is wrong' },
    meta: { type: 'object', description: 'ignored by the oracle (cost and latency bookkeeping)' },
  },
};
const validateShape = new Ajv({ strict: true, allErrors: true }).compile(outputSchema);
export const schemaViolations = output => (validateShape(output) ? [] : validateShape.errors.slice(0, 5).map(e => `${e.instancePath || '/'} ${e.message}`));

// ---------- outcomes ---------------------------------------------------------------------------------------------------------------------
export function outcomeFromPlan(instance, plan) {
  const { world } = instance;
  const store = new PullRequestStore({ base: world.repo, openPullRequests: world.openPullRequests });
  const failedRun = plan.status === 'failed';
  const pr = plan.pull_request;
  const contradictory = failedRun && (Object.keys(plan.files).length > 0 || pr.open === true);
  if (!failedRun && pr.open) {
    store.createPullRequest({ workspace: { ...world.repo, ...plan.files },
      inputs: { branch: pr.branch, title: pr.title, body: pr.body, 'commit-message': pr.commit_message, labels: (pr.labels ?? []).join('\n') } });
  }
  return { failed: failedRun, message: plan.message, claimedStatus: plan.status, versions: plan.versions, pr: store.snapshot(), calls: null, contradictory };
}

// ---------- judging ----------------------------------------------------------------------------------------------------------------------------
function firstDiff(expected, actual) {
  const a = expected.split('\n'), b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return { line: i + 1, expected: a[i] ?? null, actual: b[i] ?? null };
  return null;
}
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x));
// Does the text name the image together with its old and its new tag? (Table row, bullet, prose, a short block under a heading: the format
// is not prescribed, R5 asks only that every changed image is listed "with its old and its new tag".)
// A "section" is a line that names the image plus the following lines up to SECTION_LINES in all, stopping at a line that names another
// tracked image. The section must contain both tags, in either order, EXCEPT that "new <arrow> old" (→ -> => ⇒ "to") is a text that
// claims the change goes backwards and does not count. Verifier change 2026-10-08: the first version demanded old-before-new on ONE line,
// which rejected correct texts such as "Chrome now NEW (was OLD)", a "| Image | New | Old |" table or a heading followed by old:/new: lines.
const SECTION_LINES = 4;
const BACKWARDS = /→|->|=>|⇒|\bto\b/i;
function mentionsChange(text, label, from, to) {
  const lines = String(text ?? '').split('\n'), low = s => s.toLowerCase();
  const others = TRACKED.map(t => low(t.label)).filter(l => l !== low(label));
  for (let i = 0; i < lines.length; i++) {
    if (!low(lines[i]).includes(low(label))) continue;
    let j = i + 1;
    while (j < lines.length && j < i + SECTION_LINES && !others.some(o => low(lines[j]).includes(o))) j++;
    const s = lines.slice(i, j).join('\n');
    const f = s.indexOf(from);
    if (f >= 0 && s.indexOf(to, f + from.length) >= 0) return true;                 // old ... new
    const t = s.indexOf(to);
    if (t >= 0) {                                                                   // new ... old, unless it reads "new -> old"
      const g = s.indexOf(from, t + to.length);
      if (g >= 0 && !BACKWARDS.test(s.slice(t + to.length, g))) return true;
    }
  }
  return false;
}

/** Judge one outcome against an instance's truth in a mode ('original' | 'intent'). Never throws on a malformed outcome. */
export function judge(instance, mode, outcome) {
  const truth = instance.truth[mode];
  const checks = [];
  const check = (code, ok, detail) => checks.push(ok ? { code, ok: true } : { code, ok: false, detail });
  const pr = outcome.pr ?? { events: [], pulls: [], created: 0, updated: 0, touched: [], botBefore: null };
  const ops = pr.created + pr.updated;
  const derived = outcome.failed ? 'failed' : ops > 0 ? 'updated' : 'unchanged';
  const bots = pr.pulls.filter(p => p.state === 'open' && p.head === PR.branch);
  const others = pr.touched.filter(n => n !== bots[0]?.number && n !== pr.botBefore?.number);

  check('STATUS', derived === truth.status, { expected: truth.status, derived });
  check('STATUS_CLAIM', outcome.claimedStatus === truth.status, { expected: truth.status, claimed: outcome.claimedStatus });
  // A failed plan that still carries files or a pull-request request is NOT a violation: the contract tells the solver that the host discards
  // them, and the oracle judges effects. (Verifier change 2026-10-08; the first version failed such plans with FAILED_WITH_EFFECTS.) It is
  // reported in details.discardedEffects for diagnosis only.
  check('OTHER_PR_TOUCHED', others.length === 0, { touched: others });

  if (truth.status === 'failed') {
    check('PR_ON_FAILURE', ops === 0 && pr.touched.length === 0, { created: pr.created, updated: pr.updated });
    if (mode === 'intent' && truth.message) {
      const text = String(outcome.message ?? '').toLowerCase();
      check('MESSAGE', truth.message.allOf.every(group => group.some(token => text.includes(token.toLowerCase()))), { needsOneOf: truth.message.allOf, got: String(outcome.message ?? '').slice(-300) });
    }
  } else {
    const wanted = Object.fromEntries(KEYS.map(k => [k, truth.versions.current[k]]));
    const v = outcome.versions;
    const reported = v && KEYS.every(k => typeof v.current?.[k] === 'string' && typeof v.latest?.[k] === 'string');
    check('VERSIONS', reported && KEYS.every(k => v.current[k] === wanted[k] && v.latest[k] === truth.versions.latest[k]),
      { expected: truth.versions, got: v ?? null });
    if (truth.status === 'unchanged') {
      check('PR_UNEXPECTED', ops === 0 && pr.touched.length === 0, { created: pr.created, updated: pr.updated, touched: pr.touched });
    } else {
      check('PR_OPERATIONS', ops === 1, { created: pr.created, updated: pr.updated });
      const event = pr.events.find(e => e.operation !== 'none');
      check('PR_ACTION', event?.operation === truth.prAction && (truth.prAction !== 'updated' || event.number === truth.prNumber), { expected: { action: truth.prAction, number: truth.prNumber }, got: event ?? null });
      check('PR_SINGLE_BOT', bots.length === 1, { openOnBranch: bots.map(p => p.number) });
      const bot = bots[0];
      if (bot) {
        check('PR_BASE', bot.base === PR.base, { expected: PR.base, got: bot.base });
        check('PR_TITLE', bot.title === PR.title, { expected: PR.title, got: bot.title });
        check('PR_LABELS', sameSet(bot.labels, [...PR.labels]), { expected: PR.labels, got: bot.labels });
        check('PR_FILES', sameSet(Object.keys(bot.files), [COMPOSE_PATH]), { expected: [COMPOSE_PATH], got: Object.keys(bot.files) });
        const content = bot.files[COMPOSE_PATH]?.content;
        check('FILE_CONTENT', typeof content === 'string' && content === truth.composeAfter, typeof content === 'string' ? firstDiff(truth.composeAfter, content) : { got: content ?? null });
        const missing = (field, text) => truth.changed.filter(c => !mentionsChange(text, TRACKED.find(t => t.key === c.key).label, c.from, c.to)).map(c => c.key);
        check('PR_COMMIT_MESSAGE', missing('commit', bot.commitMessage).length === 0, { missingChanges: missing('commit', bot.commitMessage) });
        check('PR_BODY', missing('body', bot.body).length === 0, { missingChanges: missing('body', bot.body) });
      } else {
        for (const code of ['PR_BASE', 'PR_TITLE', 'PR_LABELS', 'PR_FILES', 'FILE_CONTENT', 'PR_COMMIT_MESSAGE', 'PR_BODY']) check(code, false, `no open pull request from branch ${PR.branch}`);
      }
    }
  }
  if (outcome.calls) {
    const http = outcome.calls.http ?? [];
    check('FETCH', http.length >= 1 && http.every(h => h.originalUrl === REFERENCE_URL), { requests: http.map(h => h.originalUrl ?? h.path) });
    check('NO_BLOCKED_CALLS', (outcome.calls.blocked ?? []).length === 0, { blocked: outcome.calls.blocked });
  }
  const passed = checks.filter(c => c.ok).length;
  const violations = checks.filter(c => !c.ok).map(c => c.code);
  return { pass: violations.length === 0, score: Number((passed / checks.length).toFixed(4)), details: { mode, kind: instance.kind, expected: truth.status, derived, violations, checks: checks.filter(c => !c.ok), discardedEffects: !!outcome.contradictory } };
}

/** Judge a plan: schema, then outcome, then checks. */
export function judgePlan(instance, mode, output) {
  const problems = output && typeof output === 'object' ? schemaViolations(output) : ['output is not an object'];
  if (problems.length) return { pass: false, score: 0, details: { mode, kind: instance.kind, violations: ['SCHEMA'], schema: problems } };
  return judge(instance, mode, outcomeFromPlan(instance, output));
}
