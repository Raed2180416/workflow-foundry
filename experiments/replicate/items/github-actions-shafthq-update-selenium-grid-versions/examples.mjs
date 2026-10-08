// The worked examples of T2 (input -> the plan that is correct for it). Built from the same templates as the scored instances but from
// a different seed namespace ('rbench-selenium-example'), so no example is a scored instance (item.test.mjs checks that). Each plan is
// the improved reference's answer and passes the oracle's intent mode on its own instance (checked too).
import { rng } from '../../../../beds/lib/rng.mjs';
import { buildKind, inputsOf } from './scenarios.mjs';
import { solveImproved } from './controls/reference.mjs';

const WANT = [
  { kind: 'prerelease-reducible', why: 'two or more images have a newer tag; some reference tags are published as -nightly / -beta / -dev builds, whose stable part is used',
    ok: i => i.truth.intent.status === 'updated' && i.meta.marked.length >= 1 && i.truth.intent.changed.length >= 2 },
  { kind: 'no-change', why: 'the repository is already on the reference tags (the reference has trailing spaces and CRLF line ends): nothing to do', ok: () => true },
  { kind: 'reference-malformed', why: 'the fetch answered 404 with a text body: the run fails and says what is wrong with the reference', ok: i => i.meta.variant === 'not-found' },
];

export function buildExamples() {
  return WANT.map(({ kind, why, ok }, n) => {
    for (let j = 0; j < 500; j++) {
      const inst = buildKind(kind, rng('rbench-selenium-example', n, j), { example: n });
      if (!ok(inst)) continue;
      const inputs = inputsOf(inst);
      return { index: n + 1, why, inputs, plan: solveImproved(inputs), _instance: inst };
    }
    throw new Error(`no example found for ${kind}`);
  });
}
/** The examples as shown to the solver (no hidden instance). */
export const publicExamples = () => buildExamples().map(({ _instance, ...shown }) => shown);
