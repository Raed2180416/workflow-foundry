// Turns a task (seed, split, difficulty, variant) into the scenario list the environment plays. Pure: identical inputs give identical scenarios.
//   core   the 80 frozen mails in a seeded delivery order (thread order kept), against a mock Jira that already holds 15 tickets
//   probes (T3 only) five small scenarios with injected faults: lost create acknowledgement, search-index lag, transient sheet failure,
//          redelivered mails, mention injection through mail text
import { rng } from '../../../../beds/lib/rng.mjs';
import { readJson, configFor } from './spec.mjs';

let FX = null;
export const fixtures = () => (FX ??= {
  emails: readJson('./fixtures/emails.json'), labels: readJson('./fixtures/labels.json'), seed: readJson('./fixtures/jira-seed.json'), recordings: readJson('./fixtures/model-recordings.json'),
});

const BASE_MS = Date.UTC(2026, 9, 8, 6, 0, 0);
const STEP_MS = 90_000;
const atOf = i => new Date(BASE_MS + i * STEP_MS).toISOString();
function stamp(entry, i) {
  const mail = structuredClone(entry.mail);
  if (entry.provider === 'gmail') mail.date = atOf(i); else mail.receivedDateTime = atOf(i);
  return { ...entry, mail };
}
const triggerOf = e => (e.provider === 'gmail' ? 'gmail-new-email' : 'outlook-new-email');

export function coreOrder(seed, split) {
  const { emails, labels } = fixtures();
  const ids = emails.scored.map(e => e.caseId);
  const order = rng('rbench-n8n-20281', 'order', split, seed).shuffle(ids);
  for (const id of ids) {                                  // a follow-up never arrives before the mail it follows
    const f = labels.scored[id].follows;
    if (f && order.indexOf(f) > order.indexOf(id)) { const a = order.indexOf(f), b = order.indexOf(id); [order[a], order[b]] = [order[b], order[a]]; }
  }
  return order;
}

function scenarioFrom(id, kind, entries, deliveries, extra) {
  const stamped = entries.map((e, i) => stamp(e, i));
  const events = deliveries.map((entryIndex, i) => ({ seq: i, entryIndex, trigger: triggerOf(stamped[entryIndex]), at: atOf(i) }));
  return { id, kind, entries: stamped, events, ...extra };
}

export function scenariosFor({ seed, split, difficulty, variant }) {
  const { emails, seed: jiraSeed, labels } = fixtures();
  const config = configFor(difficulty);
  const byId = Object.fromEntries([...emails.scored, ...emails.probes].map(e => [e.caseId, e]));
  const order = coreOrder(seed, split).map(id => byId[id]);
  const list = [scenarioFrom('core', 'core', order, order.map((_, i) => i), { seeds: jiraSeed.tickets, nextIssueNumber: jiraSeed.nextIssueNumber, faults: {} })];
  if (variant === 'T3') {
    const P = ids => ids.map(id => byId[id]);
    const probe = (id, ids, deliveries, faults) => scenarioFrom(id, 'probe', P(ids), deliveries ?? ids.map((_, i) => i), { seeds: [], nextIssueNumber: 2000, faults });
    list.push(
      probe('probe-create-ack-lost', ['q1a'], null, { jira: { createAckLost: [0] } }),
      probe('probe-search-lag', ['q2a', 'q2b'], null, { jira: { lagSearches: 3 } }),
      probe('probe-sheet-503', ['q3a', 'q3b', 'q3c'], null, { sheets: { fail503: [1] } }),
      probe('probe-redelivery', ['q4a', 'q4b', 'q4c'], [0, 1, 2, 0, 1, 2], {}),
      probe('probe-mention-injection', ['q5a'], null, {}),
    );
  }
  return { config, scenarios: list, labels };
}
