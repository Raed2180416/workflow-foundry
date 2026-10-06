// Demonstrations of designed behaviour that looks like a bug (secret passages, the crawler
// pause, keys crumbling on the stairs, the score rule on LOAD, bone doors, wisp blinks).
// They are present in the control build too, so reporting them is a false report. Used by the
// 'by-design-overreport' near-miss control and by the tests. Host-only.
import { Game } from './engine.mjs';
import { Driver } from './planner.mjs';
import { replay } from './case.mjs';

const BUILDERS = [
  {
    name: 'secret-passage', cls: 'wall_clip', description: 'The player walks through a wall stone (the documented secret passage).',
    run(D) {
      const sp = D.g.world.levels[0].secrets[0];
      return D.gotoTile(sp.x - 1, sp.y) && D.act('E') && D.act('E') && D.s.player.x === sp.x + 1;
    },
  },
  {
    name: 'crawler-pause', cls: 'enemy_ai', description: 'A crawler stops for a turn at each end of its route.',
    run(D) { for (let i = 0; i < 12; i++) D.act('WAIT'); return true; },
  },
  {
    name: 'keys-crumble', cls: 'transition_inventory_loss', description: 'The spare key is gone after taking the stairs.',
    run(D) {
      const sp = D.items(i => i.kind === 'key' && i.spare)[0];
      return !!sp && D.gotoItem(sp) && D.clearLevel();
    },
  },
  {
    name: 'score-kept-on-load', cls: 'item_duplication', description: 'Score is not rolled back by LOAD.',
    run(D) { D.act('SAVE'); return D.pickNearest('coins') && D.act('LOAD'); },
  },
  {
    name: 'wisp-blink', cls: 'enemy_ai', description: 'A wisp jumps between its braziers.',
    run(D) {
      const L = D.g.world.levels.findIndex(l => l.enemies.some(e => e.kind === 'wisp'));
      if (L < 0 || !D.reachLevel(L)) return false;
      for (let i = 0; i < 2 * D.g.R.wispPeriod; i++) D.act('WAIT');
      return true;
    },
  },
  {
    name: 'bone-door', cls: 'door_without_key', description: 'A bone door opens without any key.',
    run(D) {
      const L = D.g.world.levels.findIndex(l => l.doors.some(d => d.kind === 'bone'));
      if (L < 0 || !D.reachLevel(L)) return false;
      const door = D.s.lv.doors.find(d => d.kind === 'bone');
      return D.openTo(door.sep + 1) && door.open;
    },
  },
];

// Decoy reports whose replay fires no planted detector at all (so they are certainly false).
export function decoyReports(c, max = 2) {
  const out = [];
  for (const b of BUILDERS) {
    if (out.length >= max) break;
    const D = new Driver(new Game(c.world, c.bugs));
    let ok = false;
    try { ok = b.run(D); } catch { ok = false; }
    if (!ok || !D.actions.length || D.g.fired.length) continue;
    const rep = replay(c.world, c.bugs, D.actions);
    if (rep.invalid || rep.fired.length) continue;
    out.push({ bug_class: b.cls, repro_actions: D.actions, description: b.description, decoy: b.name });
  }
  return out;
}
