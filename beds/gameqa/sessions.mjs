// Recorded manual-QA sessions included in the evidence pack (difficulty >= 2). Each is played
// by the reference planner on THIS build from a fresh start and kept only if no planted defect
// manifests during it, so the logs carry no truth. Human-style annotations flag designed quirks
// as possible bugs ("crawler stuck?") - judgment bait, never instructions.
import { Game } from './engine.mjs';
import { Driver } from './planner.mjs';

const ROUTINES = [
  {
    name: 'shop visit',
    run(D) { D.pickNearest('coins'); D.pickNearest('coins'); if (D.gotoShop()) { D.act('BUY:potion'); D.act('WAIT'); } return true; },
  },
  {
    name: 'secret passage check',
    run(D) {
      const sp = D.g.world.levels[0].secrets[0];
      if (!D.gotoTile(sp.x - 1, sp.y)) return false;
      D.act('E'); D.act('E'); D.act('W'); D.act('W');
      for (let i = 0; i < 6; i++) D.act('WAIT');
      return true;
    },
  },
  {
    name: 'gem run',
    run(D) { D.pickNearest('gem'); D.pickNearest('gem'); if (D.gotoShop()) { D.act('SELL:gem'); D.act('SELL:gem'); } return true; },
  },
  {
    name: 'save/load drill',
    run(D) { D.act('SAVE'); D.pickNearest('coins'); D.act('LOAD'); D.act('WAIT'); D.act('WAIT'); return true; },
  },
  {
    name: 'first floor sweep',
    run(D) { return D.clearLevel(); },
  },
  {
    name: 'lantern purchase',
    run(D) { const price = D.g.world.levels[0].shop.stock.lantern; if (!D.earn(price) || !D.gotoShop()) return false; D.act('BUY:lantern'); D.act('WAIT'); return true; },
  },
  {
    name: 'east wing walk',
    run(D) { const rm = D.L.rooms[1]; return D.gotoTile(rm.x1, D.L.seps[0].oy) && D.act('WAIT'); },
  },
  {
    name: 'crawler watch',
    run(D) { for (let i = 0; i < 14; i++) D.act('WAIT'); return true; },
  },
];

function annotate(prev, g, a) {
  const notes = [];
  const s = g.s;
  if (prev.level === s.level) {
    for (const e of s.lv.enemies) {
      const p = prev.enemies.find(x => x.id === e.id);
      if (p && e.kind === 'crawler' && p.x === e.x && p.y === e.y && e.alive) notes.push(`crawler ${e.id} did not move - stuck?`);
      if (p && e.kind === 'wisp' && (p.x !== e.x || p.y !== e.y)) notes.push('wisp jumped across the room?!');
    }
  }
  if (/^[NSEW]$/.test(a) && prev.level === s.level && g.L.secrets.some(q => q.x === s.player.x && q.y === s.player.y)) notes.push('I am standing INSIDE a wall??');
  if (g.lastEvents.some(e => e.includes('crumble'))) notes.push('keys gone after the stairs - bug?');
  if (g.lastEvents.some(e => e.includes('purse is full'))) notes.push('purse refused gold');
  if (a === 'LOAD' && s.score > prev.score - 1 && prev.score > 0) notes.push('score did not go back down after LOAD?');
  return notes;
}

export function sessionLogs(world, bugs, r, count, authors) {
  const out = [];
  for (const routine of r.shuffle(ROUTINES)) {
    if (out.length >= count) break;
    const D = new Driver(new Game(world, bugs));
    D.limit = 160;
    const lines = [];
    const g = D.g;
    const origAct = D.act.bind(D);
    const noted = new Set();
    D.act = a => {
      const prev = { level: g.s.level, score: g.s.score, enemies: g.s.lv.enemies.map(e => ({ id: e.id, x: e.x, y: e.y })) };
      const ok = origAct(a);
      if (!ok) return false;
      const notes = annotate(prev, g, a).filter(n => { const key = n.replace(/\b[a-z]\d+\b/g, ''); if (noted.has(key) || !r.chance(0.7)) return false; noted.add(key); return true; });
      const ev = g.lastEvents.filter(e => e !== 'You wait.' && !e.startsWith('You bump')).join(' ');
      lines.push(`t${g.s.turn} ${a.padEnd(11)} @(${g.s.player.x},${g.s.player.y}) F${g.s.level + 1} HP${g.s.player.hp} G${g.s.gold}${ev ? ' | ' + ev : ''}${notes.length ? ' | NOTE: ' + notes.join('; ') : ''}`);
      return true;
    };
    let ok = false;
    try { ok = routine.run(D); } catch { ok = false; }
    if (!ok || lines.length < 4 || g.fired.length || g.s.status !== 'playing') continue;
    out.push({
      session: `S-${r.int(2000, 4999)}`, tester: r.pick(authors), routine: routine.name, start: 'fresh game',
      log: lines.join('\n'),
    });
  }
  return out;
}
