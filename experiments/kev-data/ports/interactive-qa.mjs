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

// ================================================================================================================
// Q5 bug_class: what the replay of a confirmed repro showed, against what the rules predict
// ================================================================================================================
const GLYPH_ITEM = { $: 'coin pile', '*': 'gem', '!': 'potion', '=': 'chest' };
const GLYPH_ENEMY = { x: 'crawler', m: 'moth', h: 'shade', w: 'wisp' };
function frameCells(frame) {
  const rows = frame.split('\n').slice(0, -1), cells = [];
  rows.forEach((r, y) => [...r].forEach((g, x) => cells.push({ g, x, y })));
  return cells;
}
const hudValue = (frame, name) => { const m = new RegExp(`${name} (\\d+)`).exec(frame.split('\n').at(-1)); return m ? Number(m[1]) : null; };
// The differences between a build's observation and the one the rules predict (the control build stepped from the same
// state), as plain statements. No class names, no template ids: what a tester sees.
export function describeDifferences(obs, cobs) {
  const out = [], s = obs.state, c = cobs.state;
  if (obs.status !== cobs.status) out.push(`the session ends with status ${obs.status}${obs.error ? ` (${String(obs.error).split('\n')[0]})` : ''} where the rules keep it ${cobs.status}`);
  const ev = obs.events.join(' '), cev = cobs.events.join(' ');
  if (ev !== cev) out.push(`the events read "${ev || 'nothing'}" where the rules give "${cev || 'nothing'}"`);
  if (obs.status === 'crashed') return out;
  if (s.player.x !== c.player.x || s.player.y !== c.player.y) out.push(`the player stands at (${s.player.x}, ${s.player.y}) where the rules put (${c.player.x}, ${c.player.y})`);
  if (s.floor !== c.floor) out.push(`the player is on floor ${s.floor} where the rules put floor ${c.floor}`);
  if (s.player.hp !== c.player.hp) out.push(`HP is ${s.player.hp} where the rules give ${c.player.hp}`);
  if (s.gold !== c.gold) out.push(`gold is ${s.gold} where the rules give ${c.gold}`);
  for (const k of ['gems', 'potions']) if (s.inventory[k] !== c.inventory[k]) out.push(`${k} number ${s.inventory[k]} where the rules give ${c.inventory[k]}`);
  for (const k of ['sword', 'lantern']) if (s.inventory[k] !== c.inventory[k]) out.push(`the ${k} is ${s.inventory[k] ? 'carried' : 'missing'} where the rules have it ${c.inventory[k] ? 'carried' : 'missing'}`);
  const keys = x => (x.inventory.keys.length ? [...x.inventory.keys].sort().join(', ') : 'none');
  if (keys(s) !== keys(c)) out.push(`the keys carried are ${keys(s)} where the rules give ${keys(c)}`);
  // frame against state: a status line that disagrees with the state, glyphs the state does not explain
  const fg = hudValue(obs.frame, 'Gold'), fh = hudValue(obs.frame, 'HP');
  if (fg !== null && fg !== s.gold) out.push(`the status line shows gold ${fg} while the state says ${s.gold}`);
  if (fh !== null && fh !== s.player.hp) out.push(`the status line shows HP ${fh} while the state says ${s.player.hp}`);
  const cells = frameCells(obs.frame), at = (x, y) => cells.find(q => q.x === x && q.y === y)?.g;
  for (const q of cells) {
    if (GLYPH_ITEM[q.g] && !s.items.some(i => i.x === q.x && i.y === q.y)) out.push(`the map draws a ${GLYPH_ITEM[q.g]} at (${q.x}, ${q.y}) but the state lists none there`);
    if (GLYPH_ENEMY[q.g] && !s.enemies.some(e => e.x === q.x && e.y === q.y)) out.push(`the map draws a ${GLYPH_ENEMY[q.g]} at (${q.x}, ${q.y}) but the state puts none there`);
  }
  for (const e of s.enemies) {
    const ce = c.enemies.find(x => x.id === e.id);
    if (ce && (ce.x !== e.x || ce.y !== e.y)) out.push(`the ${e.kind} ${e.id} stands at (${e.x}, ${e.y}) where the rules put it at (${ce.x}, ${ce.y})`);
  }
  for (const d of s.doors) {
    const cd = c.doors.find(x => x.x === d.x && x.y === d.y);
    if (cd && cd.open !== d.open) out.push(`the ${d.color ?? d.kind} door at (${d.x}, ${d.y}) is ${d.open ? 'open' : 'shut'} where the rules have it ${cd.open ? 'open' : 'shut'}`);
    const g = at(d.x, d.y);
    if (g === "'" && !d.open) out.push(`the map draws the door at (${d.x}, ${d.y}) open while the state says it is shut`);
  }
  for (const i of c.items) if (!s.items.some(x => x.kind === i.kind && x.x === i.x && x.y === i.y)) out.push(`the state lists no ${i.kind} at (${i.x}, ${i.y}) where the rules keep one`);
  const walls = (x) => cells.filter(q => q.g === '#').length;
  const cwalls = frameCells(cobs.frame).filter(q => q.g === '#').length;
  if (walls() !== cwalls) out.push(`the map shows ${walls() - cwalls > 0 ? 'more' : 'fewer'} wall tiles than the rules give`);
  return out;
}

// the trigger step of every planted bug: the build and the rules stepped from the pre-state of the last action of its repro
export function triggerEffects(mod, task, c) {
  const { Game } = mod.engine, out = [];
  for (const b of c.bugs) {
    const g = new Game(c.world, c.bugs), actions = c.repros[b.id];
    for (let i = 0; i < actions.length - 1; i++) g.step(actions[i]);
    const pre = g.exportState();
    g.step(actions.at(-1));
    const ctl = new Game(c.world, []);
    ctl.importState(pre); ctl.step(actions.at(-1));
    const obs = g.observation(), cobs = ctl.observation(), diffs = describeDifferences(obs, cobs);
    out.push({ bug: b, actions, last: actions.at(-1), diffs, effect: diffs.length ? `After the last action (${actions.at(-1)}) ${diffs.join('; ')}.` : null });
  }
  return out;
}

// ================================================================================================================
// Q6: planted defects against designed behaviours
// ================================================================================================================
export function defectBehaviours(mod, task, c, tap) {
  const out = [];
  for (const b of c.bugs) {
    const key = b.template === 'crash_action' ? `crash_action:${b.variant}` : b.template;
    const sections = tap.BUG_SECTIONS[key];
    if (!sections) continue;                           // chest_rubble: the specification does not say whether rubble may fall
    const floor = b.template === 'wall_clip' ? c.world.levels[b.level].name : null;
    out.push({ id: `defect:${b.id}`, label: 'defect', behaviour: mod.text.hintText(c.world, b), sections, floor, template: b.template });
  }
  return out;
}
export function designedBehaviours(task, c, aligned, tap, strip) {
  const out = [];
  for (const a of aligned) {
    if (a.kind !== 'designed') continue;
    const sections = tap.DECOY_SECTIONS[a.report.title];
    if (!sections) continue;
    out.push({ id: `designed:${a.id}`, label: 'designed', behaviour: `${a.report.title}. ${strip(a.report.body)}`, sections, floor: sections.includes(2) ? c.world.levels[0].name : null, title: a.report.title });
  }
  return out;
}
