// Bug catalog for the `gameqa` bed: 13 parameterized templates over 10 bug classes. Each
// template samples its parameters from the already-generated world and knows a trigger
// recipe (`repro`) the reference planner follows from a fresh start. The engine implements
// the deviation and its detector (engine.mjs). Host-only: nothing here reaches the solver.

export const BUG_CLASSES = [
  'crash', 'softlock', 'item_duplication', 'wall_clip', 'integer_overflow',
  'enemy_ai', 'render_mismatch', 'door_without_key', 'transition_inventory_loss', 'shop_rounding',
];

// Plausible confusions used by the 'sibling-class' near-miss control.
export const SIBLING = {
  crash: 'softlock', softlock: 'door_without_key', item_duplication: 'transition_inventory_loss',
  wall_clip: 'softlock', integer_overflow: 'shop_rounding', enemy_ai: 'render_mismatch',
  render_mismatch: 'enemy_ai', door_without_key: 'softlock', transition_inventory_loss: 'item_duplication',
  shop_rounding: 'integer_overflow',
};

const lockedDoors = world => world.levels.flatMap(lv => lv.doors.filter(d => d.kind === 'locked').map(d => ({ ...d, level: lv.index })));
const patrolEnemies = (world, pred = () => true) => world.levels.flatMap(lv => lv.enemies.filter(e => (e.kind === 'crawler' || e.kind === 'moth') && pred(e)).map(e => ({ ...e, level: lv.index })));
const isHoriz = e => e.route[0][1] === e.route[1][1];

// Clip candidates: separator wall stones with walkable floor on both sides.
function clipCandidates(world, L) {
  const lv = world.levels[L];
  const routes = new Set(lv.enemies.flatMap(e => e.route ?? []).map(([x, y]) => `${x},${y}`));
  const out = [];
  for (const sep of lv.seps) {
    for (let y = 1; y < lv.h - 1; y++) {
      if (Math.abs(y - sep.oy) < 1) continue;
      if (lv.secrets.some(p => p.x === sep.x && p.y === y)) continue;
      const w = lv.grid[y][sep.x - 1], e = lv.grid[y][sep.x + 1];
      if (w !== '.' || e !== '.' || routes.has(`${sep.x - 1},${y}`) || routes.has(`${sep.x + 1},${y}`)) continue;
      out.push({ x: sep.x, y, sep: sep.i });
    }
  }
  return out;
}

function priceOf(base, disc, mode) {
  const n = base * (100 - disc);
  if (mode === 'correct') return Math.floor((n + 50) / 100);
  if (mode === 'floor') return Math.floor(n / 100);
  if (mode === 'ceil') return Math.ceil(n / 100);
  if (mode === 'half_down') return n % 100 === 50 ? Math.floor(n / 100) : Math.floor((n + 50) / 100);
  throw new Error(mode);
}

// ------------------------------------------------------------------ condition helpers
function satisfy(D, cond, n, filter) {
  if (cond === 'none' || cond === 'prev_wait') return true;
  const pick = kind => (filter && D.pickNearest(kind, { filter })) || D.pickNearest(kind);
  if (cond === 'holding_potion') return D.s.inv.potions > 0 || pick('potion');
  if (cond === 'gems_ge') { for (let i = 0; i < 4 && D.s.inv.gems < n; i++) if (!pick('gem')) return false; return D.s.inv.gems >= n; }
  if (cond === 'gold_ge') return D.earn(n);
  if (cond === 'has_sword') {
    if (D.s.inv.sword) return true;
    if (D.s.level !== 0) return false;
    const price = D.g.world.levels[0].shop.stock.sword;
    if (!D.earn(price) || !D.gotoShop()) return false;
    D.act('BUY:sword');
    return D.s.inv.sword > 0;
  }
  return false;
}

export const TEMPLATES = [
  {
    id: 'crash_action', cls: 'crash',
    sample(world, r) { return { variant: r.pick(['potion_at_full', 'save_on_open_door', 'sell_last_gem', 'lantern_twice']) }; },
    repro(D, b) {
      if (b.variant === 'potion_at_full') return D.pickNearest('potion') && D.act('USE:potion');
      if (b.variant === 'save_on_open_door') {
        const door = D.s.lv.doors.find(d => d.kind === 'locked');
        return D.openTo(door.sep + 1) && D.act('SAVE');
      }
      if (b.variant === 'sell_last_gem') {
        const avoid = new Set();
        if (!D.pickNearest('gem')) return false;
        for (const it of D.items(i => i.kind === 'gem')) avoid.add(`${it.x},${it.y}`);
        if (!D.goto(D.g.L.shop.x, D.g.L.shop.y, { avoid, softAvoid: true })) return false;
        for (let i = 0; i < 4 && D.s.inv.gems > 1; i++) D.act('SELL:gem');
        return D.s.inv.gems === 1 && D.act('SELL:gem');
      }
      const price = D.g.world.levels[0].shop.stock.lantern;
      return D.earn(price) && D.gotoShop() && D.act('BUY:lantern') && D.act('BUY:lantern');
    },
  },
  {
    id: 'key_eaten', cls: 'softlock',
    sample(world, r) {
      const door = r.pick(lockedDoors(world));
      const cond = r.pick(['holding_potion', 'gems_ge', 'has_sword']);
      return { door: door.id, level: door.level, color: door.color, cond, n: r.int(1, 2) };
    },
    repro(D, b) {
      const lvW = D.g.world.levels[b.level];
      const doorW = lvW.doors.find(d => d.id === b.door);
      const local = kind => lvW.items.filter(i => i.kind === kind && lvW.rooms.findIndex(rm => i.x >= rm.x0 && i.x <= rm.x1) <= doorW.sep).length;
      const early = b.cond === 'has_sword' || (b.cond === 'gems_ge' && local('gem') < b.n) || (b.cond === 'holding_potion' && local('potion') < 1);
      if (early && !satisfy(D, b.cond, b.n)) return false;
      if (!D.reachLevel(b.level)) return false;
      const door = D.s.lv.doors.find(d => d.id === b.door);
      if (!satisfy(D, b.cond, b.n, i => D.roomOf(i.x) <= door.sep)) return false;
      if (!D.openTo(door.sep)) return false;
      if (!D.s.inv.keys[b.color.toLowerCase()]) { const key = D.items(i => i.kind === 'key' && i.color === b.color)[0]; if (!key || !D.gotoItem(key)) return false; }
      return D.goto(door.x, door.y, { stopWhen: () => D.fired(b.id) }) || D.fired(b.id);
    },
  },
  {
    id: 'chest_rubble', cls: 'softlock',
    sample(world, r) {
      const lv = world.levels.find(l => l.alcove);
      const chest = lv.items.find(i => i.alcove);
      const cond = r.pick(['none', 'holding_potion', 'gems_ge', 'gold_ge']);
      return { level: lv.index, chest: chest.id, entrance: lv.alcove.entrance, cond, n: cond === 'gold_ge' ? r.int(50, 90) : r.int(1, 2) };
    },
    repro(D, b) {
      if (!D.reachLevel(b.level)) return false;
      if (!satisfy(D, b.cond, b.n)) return false;
      const chest = D.s.lv.items.find(i => i.id === b.chest);
      return !!chest && D.gotoItem(chest);
    },
  },
  {
    id: 'load_dupe', cls: 'item_duplication',
    sample(world, r) { return { kind: r.pick(['gem', 'potion', 'coins']), cond: r.pick(['any', 'saved_on_shop']) }; },
    repro(D, b) {
      if (b.cond === 'saved_on_shop' && !D.gotoShop()) return false;
      D.act('SAVE');
      return D.pickNearest(b.kind) && D.act('LOAD');
    },
  },
  {
    id: 'wall_clip', cls: 'wall_clip',
    sample(world, r, d) {
      let L = r.int(0, world.levels.length - 1);
      let cands = clipCandidates(world, L);
      if (d >= 4 && r.chance(0.5)) {
        L = 0;
        const sec = world.levels[0].secrets[0];
        cands = clipCandidates(world, 0).filter(c => c.x === sec.x && Math.abs(c.y - sec.y) <= 2);
        if (!cands.length) cands = clipCandidates(world, 0);
      }
      if (!cands.length) { L = 0; cands = clipCandidates(world, 0); }
      const c = r.pick(cands);
      return { level: L, x: c.x, y: c.y, sep: c.sep, dir: r.pick(['E', 'W']), cond: r.pick(['none', 'gems_ge', 'holding_potion', 'prev_wait']), n: r.int(1, 2) };
    },
    repro(D, b) {
      if (!D.reachLevel(b.level)) return false;
      if (!satisfy(D, b.cond, b.n)) return false;
      const ax = b.dir === 'E' ? b.x - 1 : b.x + 1;
      if (!D.gotoTile(ax, b.y)) return false;
      if (b.cond === 'prev_wait') D.act('WAIT');
      if (D.s.player.x !== ax || D.s.player.y !== b.y) return false;
      return D.act(b.dir);
    },
  },
  {
    id: 'purse_wrap', cls: 'integer_overflow',
    sample(world, r) {
      const total = world.rules.startGold + world.levels.reduce((a, lv) => a + lv.items.filter(i => (i.kind === 'coins' || i.kind === 'chest') && !i.alcove).reduce((s, i) => s + i.value, 0), 0);
      return { variant: total > world.rules.purseCap + 40 && r.chance(0.5) ? 'capwrap' : 'wrap256' };
    },
    repro(D, b) {
      for (let guard = 0; guard < 40 && !D.fired(b.id); guard++) {
        const it = D.nearest(D.items(i => (i.kind === 'coins' || i.kind === 'chest') && !i.alcove));
        if (it) { if (!D.gotoItem(it)) return false; continue; }
        if (D.s.level === 0 && D.s.inv.gems > 0) { if (!D.gotoShop()) return false; for (let i = 0; i < 6 && D.s.inv.gems > 0 && !D.fired(b.id); i++) if (!D.act('SELL:gem')) return false; continue; }
        if (!D.clearLevel()) return false;
      }
      return D.fired(b.id);
    },
  },
  {
    id: 'enemy_teleport', cls: 'enemy_ai',
    sample(world, r) {
      const e = r.pick(patrolEnemies(world, en => en.route.length >= 3));
      return { enemy: e.id, level: e.level, variant: r.pick(['kth', 'in_line']), k: r.int(2, 3) };
    },
    repro(D, b) {
      if (!D.reachLevel(b.level)) return false;
      if (b.variant === 'in_line') {
        const e = D.s.lv.enemies.find(en => en.id === b.enemy);
        const horiz = isHoriz(e);
        const routes = new Set(D.s.lv.enemies.flatMap(en => en.route ?? []).map(([x, y]) => `${x},${y}`));
        const cands = [];
        const L = D.L;
        for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 1; x++) {
          if ((horiz ? y !== e.route[0][1] : x !== e.route[0][0]) || routes.has(`${x},${y}`) || D.g.blocked(x, y) || D.g.tile(x, y) === '>' || D.g.doorAt(x, y)) continue;
          cands.push({ x, y });
        }
        const t = D.nearest(cands);
        if (!t || !D.gotoTile(t.x, t.y)) return false;
      }
      return D.waitUntil(() => D.fired(b.id), 80);
    },
  },
  {
    id: 'enemy_freeze', cls: 'enemy_ai',
    sample(world, r) {
      const e = r.pick(patrolEnemies(world, en => en.route.length >= 3));
      return { enemy: e.id, level: e.level, variant: r.pick(['after_load', 'adjacent_wait']) };
    },
    repro(D, b) {
      if (!D.reachLevel(b.level)) return false;
      if (b.variant === 'after_load') { D.act('SAVE'); D.act('LOAD'); return D.waitUntil(() => D.fired(b.id), 10); }
      const e = D.s.lv.enemies.find(en => en.id === b.enemy);
      const routes = new Set(D.s.lv.enemies.flatMap(en => en.route ?? []).map(([x, y]) => `${x},${y}`));
      const cands = [];
      for (const [rx, ry] of e.route) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = rx + dx, y = ry + dy;
        if (routes.has(`${x},${y}`) || D.g.blocked(x, y) || D.g.tile(x, y) === '>' || D.g.doorAt(x, y) || D.roomOf(x) < 0) continue;
        if (D.s.lv.items.some(i => i.x === x && i.y === y)) continue;
        cands.push({ x, y });
      }
      const t = D.nearest(cands);
      return !!t && D.gotoTile(t.x, t.y) && D.waitUntil(() => D.fired(b.id), 40);
    },
  },
  {
    id: 'ghost_sprite', cls: 'render_mismatch',
    sample(world, r) {
      const variant = r.pick(['ghost_item', 'ghost_item', 'door_glyph']);
      const door = r.pick(lockedDoors(world));
      return { variant, kind: r.pick(['gem', 'coins', 'key']), door: door.id, level: door.level, color: door.color };
    },
    repro(D, b) {
      if (b.variant === 'door_glyph') {
        if (!D.reachLevel(b.level)) return false;
        const door = D.s.lv.doors.find(d => d.id === b.door);
        if (!D.openTo(door.sep)) return false;
        const key = D.items(i => i.kind === 'key' && i.color === b.color)[0];
        return !!key && D.gotoItem(key, { stopWhen: () => D.fired(b.id) });
      }
      if (!D.pickNearest(b.kind)) return false;
      for (const m of ['N', 'S', 'E', 'W', 'WAIT']) {
        if (D.fired(b.id)) return true;
        const [dx, dy] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0], WAIT: [0, 0] }[m];
        const x = D.s.player.x + dx, y = D.s.player.y + dy;
        if (m !== 'WAIT' && (D.g.blocked(x, y) || D.g.enemyAt(x, y) || D.g.doorAt(x, y) || D.g.tile(x, y) === '>')) continue;
        D.act(m);
      }
      return D.fired(b.id);
    },
  },
  {
    id: 'stale_hud', cls: 'render_mismatch',
    sample(world, r) {
      const crawlers = patrolEnemies(world, e => isHoriz(e));
      const variant = r.pick(['hud_gold', 'hud_hp', 'enemy_lag']);
      const e = r.pick(crawlers.length ? crawlers : patrolEnemies(world));
      return { variant, enemy: e.id, level: e.level };
    },
    repro(D, b) {
      if (b.variant === 'hud_gold') {
        const price = D.g.world.levels[0].shop.stock.potion;
        return D.earn(price + 10) && D.gotoShop() && D.act('BUY:potion');
      }
      if (b.variant === 'enemy_lag') return D.reachLevel(b.level) && D.waitUntil(() => D.fired(b.id), 40);
      if (!D.reachLevel(b.level)) return false;
      const e = D.s.lv.enemies.find(en => en.id === b.enemy);
      const mid = e.route[Math.floor(e.route.length / 2)];
      return D.gotoTile(mid[0], mid[1]) && D.waitUntil(() => D.fired(b.id), 40);
    },
  },
  {
    id: 'door_bypass', cls: 'door_without_key',
    sample(world, r) {
      const door = r.pick(lockedDoors(world));
      const lv = world.levels[door.level];
      const spare = lv.items.find(i => i.kind === 'key' && i.spare);
      const conds = ['bump_twice', 'after_load'];
      if (spare && lv.rooms.findIndex(rm => spare.x >= rm.x0 && spare.x <= rm.x1) <= door.sep) conds.push('holding_other_key');
      return { door: door.id, level: door.level, color: door.color, sep: door.sep, cond: r.pick(conds) };
    },
    repro(D, b) {
      if (!D.reachLevel(b.level)) return false;
      const key = D.items(i => i.kind === 'key' && i.color === b.color)[0];
      if (key) D.avoid = new Set([`${key.x},${key.y}`]);
      if (b.cond === 'after_load') { D.act('SAVE'); D.act('LOAD'); }
      if (b.cond === 'holding_other_key') { const sp = D.items(i => i.kind === 'key' && i.spare)[0]; if (!sp || !D.gotoItem(sp)) return false; }
      const door = D.s.lv.doors.find(d => d.id === b.door);
      if (!D.openTo(door.sep)) return false;
      if (!D.goto(door.x - 1, door.y)) return false;
      if (D.s.inv.keys[b.color.toLowerCase()]) return false;
      D.act('E');
      if (!D.fired(b.id) && b.cond === 'bump_twice') D.act('E');
      return D.fired(b.id);
    },
  },
  {
    id: 'stairs_drop', cls: 'transition_inventory_loss',
    sample(world, r) {
      const from = r.int(0, world.levels.length - 2);
      const item = r.pick(['potion', 'gem', 'sword', 'lantern', 'gold_half']);
      const avail = world.levels.slice(0, from + 1).reduce((a, lv) => a + lv.items.filter(i => i.kind === item).length, 0);
      return { from, item, n: avail >= 2 ? r.int(1, 2) : 1 };
    },
    repro(D, b) {
      if (b.item === 'sword' || b.item === 'lantern') {
        const price = D.g.world.levels[0].shop.stock[b.item];
        if (!D.earn(price) || !D.gotoShop()) return false;
        D.act(`BUY:${b.item}`);
        if (!D.s.inv[b.item]) return false;
      }
      if (!D.reachLevel(b.from)) return false;
      if (b.item === 'potion' || b.item === 'gem') {
        const have = () => D.s.inv[b.item === 'gem' ? 'gems' : 'potions'];
        for (let i = 0; i < 4 && have() < b.n; i++) if (!D.pickNearest(b.item)) return false;
        if (have() < b.n) return false;
      }
      return D.clearLevel() && D.fired(b.id);
    },
  },
  {
    id: 'price_rounding', cls: 'shop_rounding',
    sample(world, r) {
      const R = world.rules, stock = world.levels[0].shop.stock;
      const feasible = [];
      for (const mode of ['floor', 'ceil', 'half_down']) {
        for (let g = 1; g <= 2; g++) {
          const disc = Math.min(R.discCap, R.discPerGem * g);
          if (Object.values(stock).some(base => priceOf(base, disc, mode) !== priceOf(base, disc, 'correct'))) { feasible.push(mode); break; }
        }
      }
      if (stock.potion % 2 === 1) feasible.push('sell_round_up');
      return { variant: r.pick(feasible.length ? feasible : ['ceil']) };
    },
    repro(D, b) {
      if (b.variant === 'sell_round_up') {
        return D.pickNearest('potion') && D.gotoShop() && D.act('SELL:potion');
      }
      const R = D.g.R, stock = D.g.world.levels[0].shop.stock;
      const hitAt = gems => {
        const disc = Math.min(R.discCap, R.discPerGem * gems);
        return ['potion', 'lantern', 'sword'].find(it => priceOf(stock[it], disc, b.variant) !== priceOf(stock[it], disc, 'correct'));
      };
      for (let guard = 0; guard < 5; guard++) {
        if (D.s.inv.gems > 0 && hitAt(D.s.inv.gems)) {
          const avoid = new Set(D.items(i => i.kind === 'gem').map(i => `${i.x},${i.y}`));
          if (!D.goto(D.g.L.shop.x, D.g.L.shop.y, { avoid, softAvoid: true })) return false;
          const hit = hitAt(D.s.inv.gems);
          if (hit) { D.act(`BUY:${hit}`); return D.fired(b.id); }
        }
        if (!D.pickNearest('gem')) return false;
      }
      return false;
    },
  },
];

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));
export { priceOf, clipCandidates };
