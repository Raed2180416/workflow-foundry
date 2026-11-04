// AppWorld frozen held-out split (research/breadth-20261021/PLAN.md §4.3 T1-3; PREREG-BREADTH-v0 §1.3, row 3).
//
// THE RULE IS FIXED BY THE COMMIT THAT ADDS THIS FILE (split-rule.mjs, the "split-rule commit"; pure functions, no I/O).
// The salt comes after it and is chosen by nobody: a public randomness beacon round that did not exist when the rule was
// committed (the same beacon rule as the AgentDojo bed's ad-split-v1):
//   beacon  = drand quicknet (chain 52db9ba7...e971, 3 s period, genesis 1692803367; https://drand.love)
//   round R = the first round whose time (genesis + (R - 1) * 3) is >= the rule commit's committer time + 300 s
//   salt    = "<rule commit sha>:<R>:<randomness of R>"      (randomness = sha256(signature) for quicknet; checked)
// Inputs are TASK IDS ONLY, from AppWorld's official split lists (data/datasets/<split>.txt, data 0.1.0); no task file
// is opened to make the split. A task id is "<scenario>_<variant>" (7 hex digits, variant 1-3).
//
// Population (pinned by sha256 of the sorted ids joined with "\n"):
//   train 90 (30 scenarios), dev 57 (19), test_normal 168 (56), test_challenge 417 (139, NEVER USED by this bed).
// Roles (official splits; nothing moves between them):
//   devTrain  = train (90): F-kit development, comparator dev arms, the dev pilot and cost gate; unlimited looks.
//   devCheck  = dev (57): the dev hold-back; at most 3 looks per arm family (PLAN §5.3 item 8).
//   sealed    = test_normal (168 = 56 scenarios x 3 variants), encrypted-public held-out (H1e). Haiku arms (A-H, A-HN,
//               F-H) run all 168. test_challenge is not part of this bed.
// Salted orders (sha256 of PREFIX + salt + ":" + kind + ":" + key, ascending hex):
//   scenario order   kind "scn", key = scenario            (sealed scenarios)
//   variant order    kind "var", key = task id              (within each sealed scenario)
//   run order        kind "order", key = task id            (every run's unit order, PLAN §5.2 interleaving)
//   pilot order      kind "pilot", key = task id            (devTrain tasks; dev-pilot prefixes per arm)
// A-S (Sonnet) candidate list: every sealed scenario's FIRST variant (variant order), scenarios in scenario order (56),
//   then the SECOND variant of each scenario in scenario order (56 more; at most 2 variants per scenario). The A-S subset
//   is the first k of this list; k = the smallest count whose n_eff = (k1 + 2 * k2 / (1 + icc)) reaches 60, where k2 is
//   the number of scenarios with two variants and k1 = 56 - k2 (k >= 56), using the dev-pilot ICC estimate frozen
//   before any sealed run; default (icc <= 1/3) k = 64 (56 scenarios, 8 of them with 2 variants).
// A-O (Opus) anchors: the first 20 scenarios in scenario order, each with its FIRST variant (the A-S first variant; so
//   anchors are nested in the A-S subset, which is nested in the Haiku set: every comparison is paired).
// Dev pilot: devTrain tasks in pilot order; an arm's pilot is a prefix (sizes are set in run.mjs PILOT_SIZES, not here).
//
// The CLI that applies it (beacon fetch, SPLIT.json, checks) is split.mjs; it may change, this file may not.
import { createHash } from 'node:crypto';

export const SPLIT_RULE = Object.freeze({
  version: 'aw-split-v1',
  bed: 'AppWorld 0.1.3.post1 (PyPI wheel sha256 db77f8003982502383a50fa2974983894bd1c54f64e2fd3f7e1540d5edd037eb), data 0.1.0 (bundle sha256 fd9f9608c2ec71ed0ac25c3633a738b9129a318a129e31230425b9188e508250)',
  population: Object.freeze({
    train: Object.freeze({ n: 90, scenarios: 30, idsSha256: 'c6a9f42f672b132098925592393e0f76f21393a6027839d57f8825ef683224ca' }),
    dev: Object.freeze({ n: 57, scenarios: 19, idsSha256: 'd36670b383552f4c586baf1f84f0d53fcd3e05db5698b1532b2291ace23288a8' }),
    test_normal: Object.freeze({ n: 168, scenarios: 56, idsSha256: 'e19110ce02aafefbe1b379f2d7d671cf6585eea6b490d8d71663b530972f72f6' }),
    test_challenge: Object.freeze({ n: 417, scenarios: 139, idsSha256: '8c710d5b92225930370a062c8e2e1cb13095c6d784ec0cb696475b9ea7aee027', used: false }),
  }),
  beacon: Object.freeze({ name: 'drand quicknet', chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971', genesis: 1692803367, period: 3,
    url: 'https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/', delaySec: 300 }),
  prefix: 'breadth-aw-v1:',
  sonnet: Object.freeze({ maxVariantsPerScenario: 2, nEffTarget: 60, defaultIcc: 1 / 3, defaultK: 64 }),
  opusAnchors: Object.freeze({ scenarios: 20, variants: 1 }),
});

export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
export const idsSha256 = ids => sha256([...ids].sort().join('\n'));
export const roundAt = (t, b = SPLIT_RULE.beacon) => Math.ceil((t + b.delaySec - b.genesis) / b.period) + 1;
export const roundTime = (r, b = SPLIT_RULE.beacon) => b.genesis + (r - 1) * b.period;
export const makeSalt = (ruleCommit, round, randomness) => `${ruleCommit}:${round}:${randomness}`;
export const key = (salt, kind, k) => sha256(`${SPLIT_RULE.prefix}${salt}:${kind}:${k}`);
export const scenarioOf = id => id.replace(/_\d+$/, '');
const byKey = (salt, kind) => (a, b) => { const ka = key(salt, kind, a), kb = key(salt, kind, b); return ka < kb ? -1 : ka > kb ? 1 : 0; };

/** n_eff of k1 single-variant and k2 two-variant scenario clusters at intra-cluster correlation icc. */
export const nEff = (k1, k2, icc) => k1 + (2 * k2) / (1 + icc);
/** The A-S cut: the smallest k >= scenarios whose n_eff reaches the target (capped at 2 variants per scenario). */
export function sonnetK(icc = SPLIT_RULE.sonnet.defaultIcc, scenarios = SPLIT_RULE.population.test_normal.scenarios, target = SPLIT_RULE.sonnet.nEffTarget) {
  if (!(icc >= 0 && icc <= 1)) throw new Error('icc must be in [0, 1]');
  for (let k2 = 0; k2 <= scenarios; k2++) if (nEff(scenarios - k2, k2, icc) >= target - 1e-9) return scenarios + k2;
  return 2 * scenarios;
}

export function checkPopulation(lists) {
  for (const [split, p] of Object.entries(SPLIT_RULE.population)) {
    const ids = lists[split];
    if (split === 'test_challenge' && !ids) continue;
    if (!ids || ids.length !== p.n || idsSha256(ids) !== p.idsSha256) throw new Error(`the ${split} population differs from the pinned one`);
    if (new Set(ids.map(scenarioOf)).size !== p.scenarios) throw new Error(`${split}: scenario count differs`);
  }
}

/** The split of the official lists { train, dev, test_normal } under `salt`. */
export function splitLists(lists, salt) {
  checkPopulation(lists);
  const sealed = lists.test_normal;
  const scenarios = [...new Set(sealed.map(scenarioOf))].sort(byKey(salt, 'scn'));
  const variants = Object.fromEntries(scenarios.map(s => [s, sealed.filter(id => scenarioOf(id) === s).sort(byKey(salt, 'var'))]));
  for (const s of scenarios) if (variants[s].length !== 3) throw new Error(`scenario ${s} does not have 3 variants`);
  const sonnetCandidates = [...scenarios.map(s => variants[s][0]), ...scenarios.map(s => variants[s][1])];
  const opusAnchors = scenarios.slice(0, SPLIT_RULE.opusAnchors.scenarios).map(s => variants[s][0]);
  const pilotOrder = [...lists.train].sort(byKey(salt, 'pilot'));
  return { scenarios, variants, sonnetCandidates, opusAnchors, pilotOrder };
}

export const runOrder = (ids, salt) => [...ids].sort(byKey(salt, 'order'));
export const sonnetSubset = (split, icc = null) => split.sealed.sonnetCandidates.slice(0, icc === null ? SPLIT_RULE.sonnet.defaultK : sonnetK(icc));

export function buildSplit(lists, { ruleCommit, ruleCommitTime, beaconRound }) {
  const salt = makeSalt(ruleCommit, beaconRound.round, beaconRound.randomness);
  const s = splitLists(lists, salt);
  const roles = { devTrain: [...lists.train], devCheck: [...lists.dev], sealed: [...lists.test_normal] };
  const sealed = { scenarioOrder: s.scenarios, variantOrder: s.variants, sonnetCandidates: s.sonnetCandidates, sonnetDefault: s.sonnetCandidates.slice(0, SPLIT_RULE.sonnet.defaultK),
    opusAnchors: s.opusAnchors };
  return {
    kind: 'appworld-split', version: 1, rule: SPLIT_RULE.version, bed: SPLIT_RULE.bed,
    method: 'official splits; salted orders sha256("breadth-aw-v1:" + salt + ":" + kind + ":" + key); salt = rule commit : drand quicknet round : randomness (split-rule.mjs header)',
    ruleCommit, ruleCommitTime, beacon: { ...SPLIT_RULE.beacon, round: beaconRound.round, roundTime: roundTime(beaconRound.round), randomness: beaconRound.randomness, signature: beaconRound.signature },
    salt, population: SPLIT_RULE.population,
    counts: { devTrain: roles.devTrain.length, devCheck: roles.devCheck.length, sealed: roles.sealed.length, sealedScenarios: s.scenarios.length,
      sonnetDefault: sealed.sonnetDefault.length, opusAnchors: sealed.opusAnchors.length, testChallengeUsed: 0 },
    roles, sealed, pilotOrder: s.pilotOrder,
    devSha256: sha256(JSON.stringify({ devTrain: [...roles.devTrain].sort(), devCheck: [...roles.devCheck].sort() })),
    sealedSha256: sha256(JSON.stringify([...roles.sealed].sort())),
    splitSha256: sha256(JSON.stringify({ roles: { devTrain: [...roles.devTrain].sort(), devCheck: [...roles.devCheck].sort(), sealed: [...roles.sealed].sort() }, sealed, pilotOrder: s.pilotOrder })),
  };
}
