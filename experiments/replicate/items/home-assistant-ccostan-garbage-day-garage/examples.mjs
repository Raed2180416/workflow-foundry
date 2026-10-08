// Worked examples for the T2 task: four situations from a DIFFERENT data set than the hidden battery (fixed dates and times, other door
// choices and margins). Each shows what people did, the events the integration received (in order) and the service calls the owner's
// setup made, with local times. The traces are produced by running the faithful reference in the env, so they cannot drift from it.
import { driveSync, replay } from './env.mjs';
import { exampleScenarios } from './scenarios.mjs';
import { makeFaithful } from './controls/reference.mjs';
import { formatLocal, parseLocal } from './mocks/ha-core.mjs';

const WHAT = {
  cover: s => `the ${s.door} garage door ${s.state === 'open' ? 'opens' : 'closes'}`,
  tap: s => `Carlo presses "${s.button}" on the phone notification`,
};

let cache = null;
export function buildExamples() {
  if (cache) return cache;
  const scenarios = exampleScenarios();
  const task = { seed: 'examples', split: 'dev', difficulty: 1, variant: 'T2' };
  const ep = driveSync(task, makeFaithful(), scenarios);
  const { env } = replay(task, ep.actions, scenarios);
  const recs = env._records();
  const iso = (start, t) => formatLocal(parseLocal(start) + t);
  const strip = ev => { const { seq, fresh, ...rest } = ev; return rest; };
  const out = scenarios.map((sc, i) => ({
    summary: sc.summary,
    start: sc.start,
    people: sc.script.map(s => ({ at: iso(sc.start, s.t), what: WHAT[s.do](s) })),
    events: recs[i].events.filter(e => e.event.type !== 'wake').map(e => strip(e.event)),   // wake-ups are the solver's own bookkeeping
    calls: recs[i].calls.map(c => ({ at: iso(sc.start, c.t), service: c.service, ...(Object.keys(c.target).length ? { target: c.target } : {}), data: c.data, status: c.status })),
  }));
  const sample = type => out.flatMap(s => s.events).find(e => e.type === type);
  cache = { scenarios: out, eventSamples: ['state_changed', 'event'].map(sample).filter(Boolean) };
  return cache;
}
