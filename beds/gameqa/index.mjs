// `gameqa` bed: test a build of a tiny deterministic tile game that carries K planted bugs
// (K = difficulty) drawn from a catalog of 13 parameterized templates over 10 bug classes, and
// report each with a minimal repro from a fresh start plus a bug class. The oracle replays every
// reported repro on the buggy build and on a bug-free control build. See README.md.
import { rng } from '../lib/rng.mjs';
import { Game, ACTIONS } from './engine.mjs';
import { caseFor, evaluateRepro, replay, MAX_REPRO, MAX_REPORTS } from './case.mjs';
import { BUG_CLASSES, SIBLING } from './bugs.mjs';
import { designDoc, floorNotes, evidence, prompt, hintText, communityWiki } from './text.mjs';
import { decoyReports } from './decoys.mjs';
import { sessionLogs } from './sessions.mjs';

export const family = {
  id: 'gameqa',
  domain: 'game QA',
  version: '1.0.0',
  kind: 'interactive',
  description: 'Exploratory QA of a deterministic tile-game build with K planted bugs: read a prose specification with errata, triage an unverified evidence pack (vague, stale, misleading and adversarial reports), play the build through an env (step/snapshot/restore) and report each defect with a from-fresh-start repro and a bug class. Oracle replays each repro on the buggy and a bug-free control build.',
};

export const outputSchema = {
  type: 'object',
  required: ['bugs'],
  properties: {
    bugs: {
      type: 'array',
      maxItems: MAX_REPORTS,
      items: {
        type: 'object',
        required: ['bug_class', 'repro_actions', 'description'],
        properties: {
          bug_class: { type: 'string', enum: BUG_CLASSES },
          repro_actions: { type: 'array', minItems: 1, maxItems: MAX_REPRO, items: { type: 'string', enum: ACTIONS } },
          description: { type: 'string' },
        },
      },
    },
  },
};

const TESTERS = ['K. Abernathy (QA)', 'R. Okafor (QA)', 'M. Lindqvist (QA)', 'playtest-group-3', 'J. Ferreira (QA)'];
const BUDGET = { 1: 800, 2: 1200, 3: 2000, 4: 3000, 5: 4000 };

export function generate({ seed, split = 'dev', difficulty = 3 }) {
  if (split !== 'dev' && split !== 'test') throw new Error(`gameqa: split must be dev or test, got ${split}`);
  const c = caseFor({ seed, split, difficulty });
  const world = c.world;
  const r = rng('gameqa-text', seed, split, difficulty);
  const ev = evidence(world, c.bugs, r.fork('evidence'));
  const initial = new Game(world, c.bugs).observation();
  return {
    id: `gameqa:${split}:d${difficulty}:s${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: prompt(world),
    inputs: {
      game: { title: world.title, studio: world.studio, build: world.build, floors: world.levels.length },
      design_doc: designDoc(world, r.fork('doc')),
      floor_notes: floorNotes(world),
      changelog: ev.changelog,
      reports: ev.reports,
      ...(difficulty >= 3 ? { community_wiki: communityWiki(world, r.fork('wiki')) } : {}),
      ...(difficulty >= 2 ? { qa_sessions: sessionLogs(world, c.bugs, r.fork('sessions'), [0, 0, 1, 3, 4, 5][difficulty], TESTERS) } : {}),
      environment: {
        actions: [...ACTIONS],
        observation: 'step(action) returns { observation: { frame, state, events, status, error? }, done, reward, info }. frame = ASCII map rows plus a HUD line; state = JSON instrumentation (floor, turn, player {x,y,hp,max_hp}, gold, score, inventory, enemies, items, doors, shop when standing on a counter, save_slot); status = playing | won | game_over | crashed.',
        initial_observation: initial,
      },
    },
    budget: { envSteps: BUDGET[difficulty], maxReports: MAX_REPORTS, maxReproActions: MAX_REPRO },
  };
}

// ------------------------------------------------------------------ environment
export function createEnv(task) {
  const c = caseFor(task);
  let game = new Game(c.world, c.bugs);
  const snaps = new Map();
  let n = 0;
  const wrap = res => {
    const observation = game.observation();
    return { observation, done: observation.status !== 'playing', reward: 0, info: { ok: res?.ok ?? true, error: res?.error ?? null, turn: game.s.turn, steps: game.steps } };
  };
  return {
    determinism: 'D0',
    reset() { game = new Game(c.world, c.bugs); return wrap(); },
    step(action) { return wrap(game.step(action)); },
    observe() { return game.observation(); },
    snapshot() { const id = `snap-${++n}`; snaps.set(id, game.exportState()); return id; },
    restore(id) {
      if (!snaps.has(id)) throw new Error(`gameqa: unknown snapshot ${JSON.stringify(id)}`);
      game.importState(snaps.get(id));
      return wrap();
    },
    actions() { return game.s.status === 'playing' ? [...ACTIONS] : []; },
  };
}

// ------------------------------------------------------------------ oracle
function schemaError(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return 'output must be an object';
  if (!Array.isArray(output.bugs)) return 'bugs must be an array';
  if (output.bugs.length > MAX_REPORTS) return `at most ${MAX_REPORTS} bugs`;
  for (const [i, b] of output.bugs.entries()) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return `bugs[${i}] must be an object`;
    if (!BUG_CLASSES.includes(b.bug_class)) return `bugs[${i}].bug_class must be one of ${BUG_CLASSES.join(', ')}`;
    if (!Array.isArray(b.repro_actions) || b.repro_actions.length < 1 || b.repro_actions.length > MAX_REPRO) return `bugs[${i}].repro_actions must be an array of 1..${MAX_REPRO} actions`;
    for (const a of b.repro_actions) if (!ACTIONS.includes(a)) return `bugs[${i}].repro_actions contains an illegal action ${JSON.stringify(a)}`;
    if (typeof b.description !== 'string') return `bugs[${i}].description must be a string`;
  }
  return null;
}

export function oracle(task, output) {
  const c = caseFor(task);
  const bad = schemaError(output);
  if (bad) return { pass: false, score: 0, details: { reason: `schema: ${bad}`, planted: c.bugs.length } };
  const found = new Map();
  const perReport = [];
  let falseReports = 0, duplicates = 0;
  output.bugs.forEach((rep, index) => {
    const ev = evaluateRepro(c.world, c.bugs, rep.bug_class, rep.repro_actions);
    const row = { index, bug_class: rep.bug_class, length: rep.repro_actions.length };
    if (ev.verdict === 'match') {
      if (found.has(ev.bug)) { duplicates++; row.verdict = 'duplicate'; }
      else row.verdict = 'finding';
      const prev = found.get(ev.bug);
      found.set(ev.bug, prev == null ? rep.repro_actions.length : Math.min(prev, rep.repro_actions.length));
    } else {
      falseReports++;
      row.verdict = 'false';
      row.reason = ev.reason;
    }
    perReport.push(row);
  });
  const K = c.bugs.length;
  const recall = found.size / K;
  const pass = recall >= 0.8 && falseReports <= 1;
  const perBug = c.bugs.map(b => ({ bug_class: b.cls, found: found.has(b.id), minimalKnown: c.repros[b.id].length, shortestReported: found.get(b.id) ?? null }));
  const ratios = perBug.filter(x => x.found).map(x => x.shortestReported / x.minimalKnown);
  return {
    pass,
    score: Math.round(recall * 10000) / 10000,
    details: {
      reason: pass ? 'recall >= 0.8 with at most one false report' : recall < 0.8 ? `recall ${found.size}/${K} below 0.8` : `${falseReports} false reports (max 1)`,
      planted: K, found: found.size, recall, falseReports, duplicates,
      reproLengthRatio: ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000 : null,
      perBug, perReport,
    },
  };
}

// ------------------------------------------------------------------ reference and controls
export function referenceSolve(task) {
  const c = caseFor(task);
  return { bugs: c.bugs.map(b => ({ bug_class: b.cls, repro_actions: [...c.repros[b.id]], description: hintText(c.world, b) })) };
}

export const badControls = [
  { name: 'empty', make: () => ({ bugs: [] }) },
  {
    name: 'shuffled-or-corrupted',
    // Every repro loses its final (triggering) action and every class is rotated by one.
    make(task) {
      return {
        bugs: referenceSolve(task).bugs.map(b => ({
          bug_class: BUG_CLASSES[(BUG_CLASSES.indexOf(b.bug_class) + 1) % BUG_CLASSES.length],
          repro_actions: b.repro_actions.length > 1 ? b.repro_actions.slice(0, -1) : ['SAVE'],
          description: b.description,
        })),
      };
    },
  },
  {
    name: 'sibling-class',
    // Plausible-but-wrong: the right repros, each filed under its most confusable class.
    make(task) { return { bugs: referenceSolve(task).bugs.map(b => ({ ...b, bug_class: SIBLING[b.bug_class] })) }; },
  },
  {
    name: 'by-design-overreport',
    // Plausible-but-wrong: every real defect plus two documented behaviours filed as bugs.
    make(task) {
      const c = caseFor(task);
      return { bugs: [...referenceSolve(task).bugs, ...decoyReports(c, 2).map(({ decoy, ...rest }) => rest)] };
    },
  },
  {
    name: 'trigger-dropped',
    // Near miss: right classes, but each repro stops one action before the defect manifests.
    make(task) {
      return { bugs: referenceSolve(task).bugs.map(b => ({ ...b, repro_actions: b.repro_actions.length > 1 ? b.repro_actions.slice(0, -1) : ['SAVE'] })) };
    },
  },
];

// Host-side diagnostics for tests and calibration (never shown to solvers).
export const _internal = { caseFor, evaluateRepro, replay, decoyReports };
