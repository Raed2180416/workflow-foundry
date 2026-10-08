// The control "the original passes": runs the vendored workflow (or an edited variant of it) through runner.mjs against an instance's
// world, and turns the observation into the outcome the oracle judges. The workflow text is untrusted data; it is executed only here,
// in the runner's sandbox (minimal environment, shimmed curl and docker, private /tmp), as the task instructs.
import { runWorkflow } from '../runner.mjs';
import { ITEM, KEYS, PR, TRACKED, readText, sha256 } from '../spec.mjs';

export const originalText = () => {
  const text = readText(ITEM.vendoredPath);
  if (sha256(text) !== ITEM.rawSha256) throw new Error(`fixtures/original is not the pinned file (sha256 ${sha256(text)})`);
  return text;
};

// The original prints what it found: "Latest versions found:" then "Chrome: X"..., and "Current versions:" then the same. That log is
// the only place a workflow of this shape reports versions, so the adapter reads it (the oracle never sees how outcomes are produced).
function versionsFromLog(steps) {
  const read = (output, header) => {
    const out = Object.fromEntries(KEYS.map(k => [k, '']));
    const at = output.indexOf(header);
    if (at < 0) return out;
    for (const line of output.slice(at + header.length).split('\n').slice(1)) {     // the four lines right after the header
      const m = /^(Chrome|Edge|Firefox|Hub): ?(.*)$/.exec(line);
      if (!m) break;
      out[TRACKED.find(t => t.label === m[1]).key] = m[2];
    }
    return out;
  };
  const all = steps.map(s => s.output).join('\n');
  return { current: read(all, 'Current versions:'), latest: read(all, 'Latest versions found:') };
}

export function outcomeFromObservation(obs) {
  const ops = obs.pr.created + obs.pr.updated;
  return {
    failed: obs.failed,
    message: obs.message,
    claimedStatus: obs.failed ? 'failed' : ops > 0 ? 'updated' : 'unchanged',
    versions: versionsFromLog(obs.steps),
    pr: obs.pr,
    calls: { http: obs.http, blocked: obs.curl.filter(c => c.verdict === 'blocked') },
    contradictory: false,
  };
}

/** Execute `workflowText` (default: the pinned original) on an instance. Returns { observation, outcome }. */
export async function runOriginal(instance, { workflowText = originalText(), keep = false } = {}) {
  const observation = await runWorkflow({ workflowText, world: instance.world, keep });
  return { observation, outcome: outcomeFromObservation(observation) };
}

/** The run as a plan (the output schema), so that the executed original can be submitted as a T1 answer and judged by oracle(). */
export function planFromObservation(obs) {
  const outcome = outcomeFromObservation(obs);
  if (obs.failed) return { status: 'failed', versions: outcome.versions, files: {}, pull_request: { open: false }, message: obs.message };
  const bot = obs.pr.pulls.find(p => p.state === 'open' && p.head === PR.branch && obs.pr.touched.includes(p.number));
  return {
    status: outcome.claimedStatus,
    versions: outcome.versions,
    files: bot ? Object.fromEntries(Object.entries(bot.files).filter(([, f]) => f.content != null).map(([p, f]) => [p, f.content])) : {},
    pull_request: bot ? { open: true, branch: bot.head, title: bot.title, commit_message: bot.commitMessage, body: bot.body, labels: bot.labels } : { open: false },
    message: obs.steps.at(-1)?.output ?? '',
  };
}

/** What the world sees after a run, however the outcome was produced: used to show two implementations behave identically. */
export function effectSignature(outcome) {
  const bot = outcome.pr.pulls.find(p => p.state === 'open' && p.head === PR.branch);
  const status = outcome.failed ? 'failed' : outcome.pr.created + outcome.pr.updated > 0 ? 'updated' : 'unchanged';
  return JSON.stringify({ status, versions: status === 'failed' ? null : outcome.versions,
    pr: status === 'updated' && bot ? { n: bot.number, head: bot.head, base: bot.base, title: bot.title, labels: bot.labels, body: bot.body, commit: bot.commitMessage, files: bot.files } : null,
    ops: [outcome.pr.created, outcome.pr.updated] });
}
