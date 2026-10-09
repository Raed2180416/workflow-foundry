// Adapter: Home Assistant garbage-day item (pilot P4). Read-only on experiments/. Produces effect logs from the item's own
// environment (successful service calls the mock recorded) and candidate designs from the item's own controls.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const ROOT = new URL('../../../../../experiments/replicate/items/home-assistant-ccostan-garbage-day-garage/', import.meta.url);
const imp = rel => import(new URL(rel, ROOT).href);

export const meta = { id: 'ha', title: 'home-assistant: garbage_day_garage (P4)', variant: 'T2', difficulty: 3, split: 'dev', logUnit: 'successful service call (virtual seconds)' };

let M;
export async function init() {
  if (M) return M;
  const [idx, env, orig, ref, alt, broken, tr] = await Promise.all(['index.mjs', 'env.mjs', 'controls/original.mjs', 'controls/reference.mjs', 'controls/alternative.mjs', 'controls/broken.mjs', 'trace.mjs'].map(imp));
  M = { idx, env, orig, ref, alt, broken, tr };
  return M;
}
export const taskFor = (seed, variant = meta.variant) => M.idx.generate({ seed, split: meta.split, difficulty: meta.difficulty, variant });

const toEvents = (task, output) => {
  const sc = M.env.scenarioList(task);
  const { env } = M.env.replay(task, output.actions, sc);
  const ev = [];
  for (const r of env._records()) for (const c of r.calls) if (c.status < 400) ev.push({ case: r.id, type: `ha.service:${c.service}`, t: c.t, key: { entities: c.entity_ids, data: c.data } });
  return ev;
};
export const logOf = (task, output) => toEvents(task, output);

// Expected logs.
//   expectedLog(task):        the effects the author's YAML produced when executed (controls/original.mjs), which passes the oracle on every seed.
//   oracleExpected(task):     the hand-built oracle's own expected traces (scenarios.mjs `expect`), in the oracle's normal form (pre = key already normal).
export const expectedLog = task => toEvents(task, M.env.driveSync(task, M.orig.makeOriginal()));
export const oracleExpected = task => {
  const ev = [];
  for (const sc of M.env.scenarioList(task)) for (const e of sc.expect) { const { service, ...key } = e.norm; ev.push({ case: sc.id, type: `ha.service:${service}`, t: e.t, key, pre: true }); }
  return ev;
};
// The v0.1.0 reading of the condition scope (stop the whole run at a failed check): what oracle v1 expected. Used only for the E-class test.
export const expectedLogV1 = task => toEvents(task, M.env.driveSync(task, M.ref.makeFaithful({ stopOnFail: true })));

export const oracleOf = (task, output) => { const r = M.idx.oracle(task, output); return { pass: r.pass, score: r.score }; };

const drive = (o) => task => M.env.driveSync(task, M.ref.makeFaithful(o));
// Perturbations of a log (class encodings that are not separate designs in the repository).
const mapData = (events, f) => events.map(e => (e.type === 'ha.service:script.notify_engine_two_button' ? { ...e, key: { ...e.key, data: f({ ...e.key.data }) } } : e));
const swapButtons = ev => mapData(ev, d => { [d.title1, d.title2] = [d.title2, d.title1]; [d.action1, d.action2] = [d.action2, d.action1]; [d.icon1, d.icon2] = [d.icon2, d.icon1]; return d; });
const apostrophe = ev => ev.map(e => {
  const sw = s => (typeof s === 'string' ? s.replace(/it's/g, 'it’s') : s);
  const d = { ...e.key.data }; for (const k of ['value1', 'value2', 'value3', 'message']) if (k in d) d[k] = sw(d[k]);
  return { ...e, key: { ...e.key, data: d } };
});

// kind: 'class-wrong' | 'class-correct' | 'class-residual' | 'control-wrong' | 'control-correct' | 'reference'
// oracleV2: the verdict the current (v2) oracle gives, measured by running it ('run') or recorded from the item's documentation ('doc:pass').
export function candidates() {
  const { broken, alt, ref, orig } = M;
  const b = name => broken.BROKEN.find(x => x.name === name);
  const list = [
    { id: 'ha/faithful', kind: 'reference', make: drive({}) },
    { id: 'ha/original-executed', kind: 'reference', make: task => M.env.driveSync(task, orig.makeOriginal()) },
    { id: 'ha/improved', kind: 'control-correct', make: task => M.env.driveSync(task, ref.makeImproved()) },
    { id: 'ha/alternative-design', kind: 'control-correct', note: 'alternative.mjs: kv-only state, own ids, value1/value2 split, apostrophe, buttons reversed, numeric duration', make: async task => M.env.drive(task, alt.makeAlternative()) },
    // classes
    { id: 'ha/W1 naive-debounce', cls: 'HA-W1', kind: 'class-wrong', decidedBy: 'battery', make: task => b('naive-debounce').make(task) },
    { id: 'ha/W2 start-gate-from-memory', cls: 'HA-W2', kind: 'class-wrong', decidedBy: 'battery', make: task => b('start-gate-from-memory').make(task) },
    { id: 'ha/C1 buttons-reversed', cls: 'HA-C1', kind: 'class-correct', decidedBy: 'comparison', realisation: 'perturbation', make: drive({}), perturb: swapButtons },
    { id: 'ha/C2 typographic-apostrophe', cls: 'HA-C2', kind: 'class-correct', decidedBy: 'comparison', realisation: 'perturbation', make: drive({}), perturb: apostrophe },
    { id: 'ha/C3 last_changed-debounce', cls: 'HA-C3', kind: 'class-correct', decidedBy: 'environment', make: drive({ lastChangedDebounce: true }) },
    { id: 'ha/C4 skip-round-condition-scope', cls: 'HA-C4', kind: 'class-correct', decidedBy: 'expected-log', make: drive({}), expectedAlt: 'v1' },
    // other controls, for the ranking
    ...broken.BROKEN.filter(x => !['naive-debounce', 'start-gate-from-memory'].includes(x.name)).map(x => ({ id: `ha/bad ${x.name}`, kind: 'control-wrong', make: task => x.make(task) })),
    ...orig.MUTANTS.map(m => ({ id: `ha/mutant ${m.name}`, kind: 'control-wrong', make: task => M.env.driveSync(task, orig.makeMutant(m)) })),
  ];
  return list;
}
