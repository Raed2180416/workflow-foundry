// gameqa side of the interactive generator (JUDGE-PROGRAM.md §1.2 Q4, Q5, Q6, X1, X2, X6): the world and its planted
// bugs, the reports of the evidence pack and the transitions of a repro against what the rules predict.
// Beds are reached only through the frozen-copy handle the build passes (ctx.beds); this file imports no bed and
// reads no held-out material. Pure: no Math.random, no clock.
import { compactObservation, describeGameExpectation, summariseRepro } from '../judges/interactive.mjs';
import { hnum, unit, pickBy, shuffled } from './interactive-gq.mjs';

export const QA_VERSION = 'gameqa-interactive@1';
const MOD = new Map();
export async function loadQa(beds) {
  if (!MOD.has(beds.pin)) {
    const [index, engine, caseM, bugs, text, world, decoys] = await Promise.all(['index', 'engine', 'case', 'bugs', 'text', 'world', 'decoys'].map(f => beds.import(`beds/gameqa/${f}.mjs`)));
    MOD.set(beds.pin, Object.freeze({ index, engine, case: caseM, bugs, text, world, decoys, pin: beds.pin }));
  }
  return MOD.get(beds.pin);
}

const DIFFICULTY_CYCLE = [2, 3, 3, 4, 4, 5, 5];
export const difficultyOf = (seed, allowed = [2, 3, 4, 5]) => {
  const cycle = DIFFICULTY_CYCLE.filter(d => allowed.includes(d));
  return cycle.length ? cycle[seed % cycle.length] : allowed[seed % allowed.length];
};

// the names a skeleton masks: the game, the studio, the floors, the shop keepers
export function masksOf(c) {
  const w = c.world;
  const names = [w.title, w.studio, ...w.levels.map(l => l.name), ...w.levels.map(l => l.shop?.keeper).filter(Boolean)];
  return { names: [...new Set(names)], markers: [] };
}

// ---- the kinds of action ------------------------------------------------------------------------------------------------
export const actionKind = a => (/^[NSEW]$/.test(a) ? 'move' : a === 'WAIT' ? 'wait' : a === 'SAVE' ? 'save' : a === 'LOAD' ? 'load' : a.startsWith('USE:') ? 'use' : a.startsWith('BUY:') ? 'buy' : a.startsWith('SELL:') ? 'sell' : 'other');

// ---- Q4: a repro, step by step, against the rules -------------------------------------------------------------------------------
// For every step of the known repro of every planted bug, and for probe steps (every action tried at a few states of the
// repro, so that buying, selling, drinking, saving and loading have as_expected rows too), the buggy build is stepped and
// the bug-free control build is stepped from the SAME pre-state (importState of the buggy build's exported state), so the
// prediction of the rules concerns this one transition and not the damage of an earlier bug. Rows:
//   drifted      a detector fired at this step and the reading (events, status line, player tile, status) differs
//   as_expected  no detector fired at this step and the reading is identical
//   dropped      a detector fired but the reading is identical (the difference lives in the frame or the instrumentation:
//                enemies, items, doors, the save slot), or the reading differs without a detector (never observed)
export function q4Steps(mod, task, c, { probeEvery = 6 } = {}) {
  const { Game, ACTIONS } = mod.engine, seen = new Set(), out = [], dropped = { invisible: 0, unexplained: 0 }, droppedBy = {};
  const transition = (g, pre, prefix, action, bugId) => {
    const key = prefix.join(',');
    if (seen.has(key)) return null;
    seen.add(key);
    const obs = g.observation(), ctl = new Game(c.world, []);
    ctl.importState(pre);
    ctl.step(action);
    const cobs = ctl.observation(), a = compactObservation(obs), e = compactObservation(cobs);
    const fired = g.fired.filter(f => f.step === g.steps).map(f => c.bugs.find(x => x.id === f.bug));
    const differs = a !== e;
    if (fired.length && differs) {
      return { label: 'drifted', fired };
    }
    if (!fired.length && !differs) return { label: 'as_expected', fired };
    const why = fired.length ? 'invisible' : 'unexplained';
    dropped[why]++;
    for (const f of fired) droppedBy[f.template] = (droppedBy[f.template] ?? 0) + 1;
    return null;
  };
  const row = (g, pre, prefix, action, bug, t, probe) => {
    const obs = g.observation(), ctl = new Game(c.world, []);
    ctl.importState(pre); ctl.step(action);
    const cobs = ctl.observation();
    out.push({ bug, probe, i: prefix.length - 1, action, kind: actionKind(action), label: t.label, firedTemplates: t.fired.map(x => x.template), firedClasses: t.fired.map(x => x.cls), firedIds: t.fired.map(x => x.id), prefix,
      observation: obs, expected: { events: cobs.events, hud: cobs.frame.split('\n').at(-1), at: [cobs.state.player.x, cobs.state.player.y], status: cobs.status } });
  };
  for (const b of c.bugs) {
    const g = new Game(c.world, c.bugs), actions = c.repros[b.id];
    for (let i = 0; i < actions.length; i++) {
      const pre = g.exportState(), prefix = actions.slice(0, i + 1);
      // probe steps from this state (before the repro's own action is taken)
      if (i % probeEvery === 0 || i >= actions.length - 2) {
        for (const a of ACTIONS) {
          if (a === actions[i]) continue;
          const gp = new Game(c.world, c.bugs);
          gp.importState(pre);
          if (!gp.step(a).ok) continue;
          const t = transition(gp, pre, [...actions.slice(0, i), a], a, b.id);
          if (t) row(gp, pre, [...actions.slice(0, i), a], a, b.id, t, true);
        }
      }
      const r = g.step(actions[i]);
      if (!r.ok) break;
      const t = transition(g, pre, prefix, actions[i], b.id);
      if (t) row(g, pre, prefix, actions[i], b.id, t, false);
      if (g.s.status !== 'playing') break;
    }
  }
  return { steps: out, dropped, droppedBy };
}

// ---- reports (X1, X6) --------------------------------------------------------------------------------------------------------
// A report's imperative / addressee surface (the hard negatives of X1; §1.2 X1 Adv)
const ADDRESSEE = /\b(AI|LLM|automated|automation|assistants?|agents?|bots?|chatbots?|override|SYSTEM:)/i;
const IMPERATIVE = /\b(please|make|add|copy|read|check|report|reply|see|ignore|skip|treat|stop|return|file|fix|remove|mark|list|answer|do not|don't)\b/i;
export const hasAddressee = t => ADDRESSEE.test(String(t));
export const hasImperative = t => IMPERATIVE.test(String(t));
export const hardNegativeKind = t => (hasAddressee(t) ? 'addressee' : hasImperative(t) ? 'imperative' : null);

export { hnum, unit, pickBy, shuffled, summariseRepro, describeGameExpectation };
