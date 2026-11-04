// AgentDojo frozen held-out split (research/breadth-20261021/PLAN.md §4.3 T1-2; PREREG-BREADTH-v0 §1.3).
//
// THE RULE IS FIXED BY THE COMMIT THAT ADDS THIS FILE (split-rule.mjs, the "split-rule commit"; pure functions, no I/O).
// The salt comes after it and is chosen by nobody: a public randomness beacon round that did not exist when the rule
// was committed.
//   beacon  = drand quicknet (chain 52db9ba7...e971, 3 s period, genesis 1692803367; https://drand.love)
//   round R = the first round whose time (genesis + (R - 1) * 3) is >= the rule commit's committer time + 300 s
//   salt    = "<rule commit sha>:<R>:<randomness of R>"      (randomness = sha256(signature) for quicknet; checked)
// Population: the 97 user tasks of AgentDojo benchmark v1.2.2 (agentdojo 0.1.35), pinned by the sha256 of their sorted
// "suite/user_task_N" ids. Within each suite, user tasks are ordered by ascending hex of
//   sha256("breadth-ad-v1:" + salt + ":" + suite + "/" + id).
// Dev seats: round(0.4 * 97) = 39, apportioned to suites by largest remainder on quotas 0.4 * n_suite (40, 20, 16, 21
// -> 16, 8, 6.4, 8.4); a tie on the remainder goes to the suite with the smaller sha256("breadth-ad-v1:" + salt +
// ":seat:" + suite). The first dev_s user tasks of suite s are dev; the rest (58) are held out.
// Units (PREREG §1.3): dev = each dev user task x {benign, upstream injection a, upstream injection b}; sealed = each
// held-out user task x {benign, authored injection a, authored injection b} = 174. For each (user task, condition) the
// injection tasks of the suite that pass the fail-to-pass gate on THAT pairing (null agent: injection not registered;
// injection-gold agent: registered) are ordered by sha256("breadth-ad-v1:" + salt + ":inj:" + suite + "/" + user task +
// ":" + injection id) and the first two are a and b (seal.mjs; dev from upstream's 35 injection tasks, sealed from the
// authored pool once it is frozen). Clusters: user task, and two-way (user task x injection task).
//
// The CLI that applies it (beacon fetch, SPLIT.json, checks) is split.mjs; it may change, this file may not.
import { createHash } from 'node:crypto';
import { shaCanon } from './lib.mjs';

export const SPLIT_RULE = Object.freeze({
  version: 'ad-split-v1',
  bed: 'AgentDojo benchmark v1.2.2 (agentdojo 0.1.35, PyPI wheel sha256 364bea4219716b716bf639f504d195943f7f6a5535d312ca41d7098704a2affd)',
  population: Object.freeze({ userTasks: 97, bySuite: Object.freeze({ banking: 16, slack: 21, travel: 20, workspace: 40 }),
    userTaskIdsSha256: 'ba97b1dac6befb634a3133a2a4ae9e18634ca999f0bfa624f92dd1f75a868eb6',
    injectionTasks: 35, injectionTaskIdsSha256: '5f8b38e8ccbb5d1803dfdb527f4336358ac8b2bc19c24c553dff88a68d8ed63c' }),
  beacon: Object.freeze({ name: 'drand quicknet', chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971', genesis: 1692803367, period: 3,
    url: 'https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/', delaySec: 300 }),
  prefix: 'breadth-ad-v1:',
  devShare: 0.4,
  expected: Object.freeze({ dev: 39, heldOut: 58, sealedUnits: 174, conditions: Object.freeze(['benign', 'inj-a', 'inj-b']) }),
});

export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const idsSha256 = ids => sha256([...ids].sort().join('\n'));
export const roundAt = (t, b = SPLIT_RULE.beacon) => Math.ceil((t + b.delaySec - b.genesis) / b.period) + 1;
export const roundTime = (r, b = SPLIT_RULE.beacon) => b.genesis + (r - 1) * b.period;
export const makeSalt = (ruleCommit, round, randomness) => `${ruleCommit}:${round}:${randomness}`;
export const taskKey = (salt, suite, id) => sha256(`${SPLIT_RULE.prefix}${salt}:${suite}/${id}`);
export const injKey = (salt, suite, userTask, inj) => sha256(`${SPLIT_RULE.prefix}${salt}:inj:${suite}/${userTask}:${inj}`);

/** Dev seats per suite: largest remainder on 0.4 * n, exact integer arithmetic (quota tenths), ties by salted hash. */
export function devSeats(sizes, salt) {
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const seats = Math.round(SPLIT_RULE.devShare * total);
  const rows = Object.entries(sizes).map(([s, n]) => ({ s, floor: Math.floor((4 * n) / 10), rem: (4 * n) % 10, tie: sha256(`${SPLIT_RULE.prefix}${salt}:seat:${s}`) }));
  let left = seats - rows.reduce((a, r) => a + r.floor, 0);
  const order = [...rows].sort((a, b) => b.rem - a.rem || (a.tie < b.tie ? -1 : 1));
  const out = Object.fromEntries(rows.map(r => [r.s, r.floor]));
  for (const r of order) { if (left <= 0) break; out[r.s]++; left--; }
  return out;
}

/** The split of the population { suite: [ids] } under `salt`. */
export function splitTasks(bySuite, salt) {
  const ids = Object.entries(bySuite).flatMap(([s, xs]) => xs.map(x => `${s}/${x}`));
  if (ids.length !== SPLIT_RULE.population.userTasks || idsSha256(ids) !== SPLIT_RULE.population.userTaskIdsSha256) throw new Error('the user-task population differs from the pinned one');
  const seats = devSeats(Object.fromEntries(Object.entries(bySuite).map(([s, xs]) => [s, xs.length])), salt);
  const suites = {};
  for (const s of Object.keys(bySuite).sort()) {
    const order = bySuite[s].map(id => ({ id, k: taskKey(salt, s, id) })).sort((a, b) => (a.k < b.k ? -1 : 1)).map(r => r.id);
    const num = id => Number(id.split('_').pop());
    suites[s] = { n: order.length, devSeats: seats[s], order, dev: order.slice(0, seats[s]).sort((a, b) => num(a) - num(b)), heldOut: order.slice(seats[s]).sort((a, b) => num(a) - num(b)) };
  }
  return suites;
}

/** Order the eligible injection tasks for one (suite, user task) and take the first two (seal.mjs, dev units). */
export function pickInjections(salt, suite, userTask, eligible) {
  return [...eligible].map(i => ({ i, k: injKey(salt, suite, userTask, i) })).sort((a, b) => (a.k < b.k ? -1 : 1)).slice(0, 2).map(r => r.i);
}

export function buildSplit(bySuite, { ruleCommit, ruleCommitTime, beaconRound }) {
  const salt = makeSalt(ruleCommit, beaconRound.round, beaconRound.randomness);
  const suites = splitTasks(bySuite, salt);
  const lists = Object.fromEntries(Object.entries(suites).map(([s, e]) => [s, { dev: e.dev, heldOut: e.heldOut }]));
  return {
    kind: 'agentdojo-split', version: 1, rule: SPLIT_RULE.version, bed: SPLIT_RULE.bed,
    method: 'per suite: ascending sha256("breadth-ad-v1:" + salt + ":" + suite + "/" + id); dev = first dev_s (largest remainder of 0.4 * n_s, total 39); salt = rule commit : drand quicknet round : randomness (split.mjs header)',
    ruleCommit, ruleCommitTime, beacon: { ...SPLIT_RULE.beacon, round: beaconRound.round, roundTime: roundTime(beaconRound.round), randomness: beaconRound.randomness, signature: beaconRound.signature },
    salt, populationSha256: SPLIT_RULE.population.userTaskIdsSha256,
    counts: { dev: Object.values(suites).reduce((a, e) => a + e.dev.length, 0), heldOut: Object.values(suites).reduce((a, e) => a + e.heldOut.length, 0) },
    suites, devSha256: shaCanon(Object.fromEntries(Object.entries(lists).map(([s, e]) => [s, e.dev]))),
    heldOutSha256: shaCanon(Object.fromEntries(Object.entries(lists).map(([s, e]) => [s, e.heldOut]))), splitSha256: shaCanon(lists),
  };
}

