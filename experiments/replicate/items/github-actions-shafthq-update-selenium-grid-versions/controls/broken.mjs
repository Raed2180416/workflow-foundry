// Plan-level bad controls (beds/CONTRACT.md `badControls`): wrong answers that are valid under the output schema, built from the
// truth of the task. Each says on which tasks it is wrong (`applies`) and must fail the oracle on all of them. A control is only a
// control where it differs from the right answer: "pr-without-change" is right on a task that needs a pull request, so it does not apply there.
import { COMPOSE_PATH, KEYS, MODE_OF, TRACKED } from '../spec.mjs';
import { judgePlan } from '../oracle.mjs';
import { inputsOf } from '../scenarios.mjs';
import { renderPrText, solveFaithful, solveImproved, solveNothing } from './reference.mjs';

const good = (ctx) => (ctx.mode === 'original' ? solveFaithful(inputsOf(ctx.instance)) : solveImproved(inputsOf(ctx.instance)));
const needsPr = ctx => ctx.truth.status === 'updated';
const withFile = (plan, f) => ({ ...plan, files: { [COMPOSE_PATH]: f(plan.files[COMPOSE_PATH]) } });

export const BROKEN = Object.freeze([
  { name: 'empty', describe: 'an empty object', expect: 'SCHEMA', applies: () => true, make: () => ({}) },
  { name: 'do-nothing', describe: 'schema-valid, no files, no pull request, status unchanged, no versions: what a solution that does nothing returns', expect: 'VERSIONS or STATUS',
    applies: () => true, make: () => solveNothing() },
  { name: 'corrupted', describe: 'the right plan with one digit of one tag flipped (or, where there is no file, the status flipped)', expect: 'FILE_CONTENT or STATUS',
    applies: () => true,
    make: ctx => {
      const plan = good(ctx);
      if (plan.files[COMPOSE_PATH]) return withFile(plan, t => t.replace(/(selenium\/[a-z-]+:4\.\d+\.0-)(\d)/, (_, a, d) => a + ((Number(d) + 1) % 10)));
      return ctx.truth.status === 'failed' ? { ...plan, status: 'unchanged', message: '' } : { ...plan, status: 'failed', message: 'error' };
    } },
  { name: 'shuffled-file', describe: 'the right plan with the lines of the edited file in reverse order', expect: 'FILE_CONTENT',
    applies: needsPr, make: ctx => withFile(good(ctx), t => t.split('\n').reverse().join('\n')) },
  { name: 'only-chrome-updated', describe: 'only the Chrome tag is rewritten; Edge, Firefox and Hub keep their old tag', expect: 'FILE_CONTENT',
    applies: ctx => needsPr(ctx) && ctx.truth.changed.some(c => c.key !== 'chrome'),
    make: ctx => {
      let plan = good(ctx);
      for (const c of ctx.truth.changed.filter(c => c.key !== 'chrome')) {
        const image = TRACKED.find(t => t.key === c.key).image;
        plan = withFile(plan, t => t.replaceAll(`${image}:${c.to}`, `${image}:${c.from}`));
      }
      return plan;
    } },
  { name: 'prerelease-filter-dropped', describe: 'pre-release tags are used as published instead of reduced to their stable part (or refused)', expect: 'FILE_CONTENT or STATUS',
    applies: ctx => ['prerelease-reducible', 'prerelease-unreducible'].includes(ctx.instance.kind), make: ctx => solveImproved(inputsOf(ctx.instance), { keepPrerelease: true }) },
  { name: 'pr-without-change', describe: 'nothing changed, yet a pull request is opened for a gratuitous edit ("last checked")', expect: 'STATUS',
    applies: ctx => ctx.truth.status === 'unchanged',
    make: ctx => {
      const inputs = inputsOf(ctx.instance), cur = ctx.truth.versions.current, text = inputs.repo_files[COMPOSE_PATH];
      return { status: 'updated', versions: { current: { ...cur }, latest: { ...ctx.truth.versions.latest } }, files: { [COMPOSE_PATH]: `${text}# last checked by the weekly job\n` },
        pull_request: { open: true, ...renderPrText(cur, cur) }, message: 'Changes were made' };
    } },
  { name: 'wrong-branch', describe: 'the right plan, but the pull request is proposed from another branch (a second bot pull request piles up)', expect: 'PR_SINGLE_BOT or PR_ACTION',
    applies: needsPr, make: ctx => { const p = good(ctx); return { ...p, pull_request: { ...p.pull_request, branch: 'update-selenium-grid' } }; } },
  { name: 'error-swallowed', describe: 'a bad reference or pre-release is met with "nothing to do": the failure is not raised', expect: 'STATUS',
    applies: ctx => ctx.truth.status === 'failed',
    make: ctx => ({ status: 'unchanged', versions: { current: Object.fromEntries(KEYS.map(k => [k, ''])), latest: Object.fromEntries(KEYS.map(k => [k, ''])) }, files: {}, pull_request: { open: false }, message: 'No changes needed - versions are up to date' }) },
  { name: 'blanked-tags', describe: 'the original\'s behaviour when validation is skipped: tags blanked by a bad reference are written and a corrupted file goes to review', expect: 'STATUS',
    applies: ctx => ['reference-malformed', 'reference-missing-image'].includes(ctx.instance.kind), make: ctx => solveFaithful(inputsOf(ctx.instance), { skipValidation: true }) },
  { name: 'versions-misreported', describe: 'the effects are right but the reported current Chrome tag is wrong (plausible but wrong; only `versions` is off)', expect: 'VERSIONS',
    applies: ctx => ctx.truth.status !== 'failed', make: ctx => { const p = good(ctx); return { ...p, versions: { ...p.versions, current: { ...p.versions.current, chrome: `${p.versions.current.chrome}x` } } }; } },
  { name: 'transcription-of-the-original', describe: 'T2/T3 only: a faithful transcription of the original, defects included (right for T1, wrong against the maintainers\' intent)', expect: 'varies by defect',
    applies: ctx => ctx.variant !== 'T1' && !judgePlan(ctx.instance, ctx.mode, solveFaithful(inputsOf(ctx.instance))).pass, make: ctx => solveFaithful(inputsOf(ctx.instance)) },
  { name: 'improved-instead-of-original', describe: 'T1 only: the improved behaviour where the original differs (right against the intent, wrong for a faithful translation)', expect: 'varies by defect',
    applies: ctx => ctx.variant === 'T1' && !judgePlan(ctx.instance, ctx.mode, solveImproved(inputsOf(ctx.instance))).pass, make: ctx => solveImproved(inputsOf(ctx.instance)) },
]);

export const contextOf = (instance, variant) => ({ instance, variant, mode: MODE_OF[variant], truth: instance.truth[MODE_OF[variant]] });
