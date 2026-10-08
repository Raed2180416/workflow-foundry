// A recording stub of the GitHub pull-request effect, modelled on peter-evans/create-pull-request@v8 AS DOCUMENTED (recalled
// documentation, not source: the action's source was not available offline):
//   * it compares the working tree with the checked-out base; with no difference it does nothing (operation "none");
//   * otherwise it commits the difference to `branch` and opens a pull request from it into the base branch;
//   * if an open pull request from that branch exists, it is UPDATED (same number), never duplicated;
//   * inputs left out take the action's defaults; `labels` is a comma- or newline-separated list;
//   * simplification: on an update every field becomes what the run supplied (the real action only ADDS labels; here a run that supplies none
//     is judged as having none).
// Only the inputs the original uses are implemented; any other input throws, so a variant that relies on one is not silently flattened.
import { PR } from '../spec.mjs';

const DEFAULTS = Object.freeze({
  branch: 'create-pull-request/patch',
  title: 'Changes by create-pull-request action',
  body: 'Automated changes by [create-pull-request](https://github.com/peter-evans/create-pull-request) GitHub action',
  'commit-message': '[create-pull-request] automated change',
});
const IMPLEMENTED = new Set(['token', 'commit-message', 'branch', 'delete-branch', 'title', 'body', 'labels']);
export const splitList = value => String(value ?? '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);

/** Files that differ between two {path: text} snapshots: {path: {status, content}} (content null when deleted). */
export function diffTrees(base, work) {
  const out = {};
  for (const path of new Set([...Object.keys(base), ...Object.keys(work)])) {
    if (!(path in work)) out[path] = { status: 'deleted', content: null };
    else if (!(path in base)) out[path] = { status: 'added', content: work[path] };
    else if (base[path] !== work[path]) out[path] = { status: 'modified', content: work[path] };
  }
  return out;
}

export class PullRequestStore {
  /** @param base the checked-out tree {path: text}; @param openPullRequests [{number, head, base, title, body, labels, files}] */
  constructor({ base, openPullRequests = [], baseBranch = PR.base }) {
    this.base = structuredClone(base);
    this.baseBranch = baseBranch;
    this.pulls = openPullRequests.map(p => ({ state: 'open', commitMessage: '', files: {}, ...structuredClone(p) }));
    this.before = structuredClone(this.pulls);
    this.events = [];            // one per createPullRequest call: {operation: 'none'|'created'|'updated', number, branch, requested}
    this.touched = new Set();    // numbers of pull requests this run created or modified
  }
  get open() { return this.pulls.filter(p => p.state === 'open'); }
  createPullRequest({ workspace, inputs }) {
    for (const name of Object.keys(inputs)) if (!IMPLEMENTED.has(name)) throw Object.assign(new Error(`create-pull-request stub: input "${name}" is not implemented`), { code: 'UNSUPPORTED' });
    const value = name => (inputs[name] === undefined || inputs[name] === '' ? DEFAULTS[name] : inputs[name]);
    const changed = diffTrees(this.base, workspace);
    const branch = value('branch');
    if (!Object.keys(changed).length) { const event = { operation: 'none', number: null, branch, reason: 'no changes in the working tree' }; this.events.push(event); return event; }
    const fields = { head: branch, base: this.baseBranch, title: value('title'), body: value('body'), commitMessage: value('commit-message'), labels: splitList(inputs.labels), files: changed };
    const existing = this.pulls.find(p => p.state === 'open' && p.head === branch);
    let event;
    if (existing) { Object.assign(existing, fields); this.touched.add(existing.number); event = { operation: 'updated', number: existing.number, branch }; }
    else {
      const number = Math.max(0, ...this.pulls.map(p => p.number)) + 1;
      this.pulls.push({ number, state: 'open', ...fields });
      this.touched.add(number);
      event = { operation: 'created', number, branch };
    }
    this.events.push(event);
    return event;
  }
  /** The pull requests of the bot's branch and the others, as the oracle reads them. */
  snapshot() {
    return {
      events: structuredClone(this.events),
      pulls: structuredClone(this.pulls),
      created: this.events.filter(e => e.operation === 'created').length,
      updated: this.events.filter(e => e.operation === 'updated').length,
      requests: this.events.length,
      touched: [...this.touched].sort((a, b) => a - b),
      botBefore: structuredClone(this.before.find(b => b.head === PR.branch) ?? null),
    };
  }
}
