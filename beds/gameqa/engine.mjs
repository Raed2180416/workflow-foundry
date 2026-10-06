// Deterministic turn-based tile game used by the `gameqa` bed. One Game instance is one build:
// `bugs` = [] is the bug-free control build; otherwise each bug object switches on one planted
// deviation (see bugs.mjs). Every planted deviation computes the correct result next to the
// buggy one and records a detector firing in `this.fired` only when the two differ, so a
// firing always means the bug manifested. `fired`, `mem` and the bug list are host-only and
// never appear in observations.

export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const COLOR_NAME = { A: 'amber', B: 'blue', C: 'crimson', D: 'dusk' };
export const ITEM_GLYPH = { coins: '$', gem: '*', potion: '!', chest: '=' };
export const ENEMY_GLYPH = { crawler: 'x', moth: 'm', shade: 'h', wisp: 'w' };
export const SHOP_ITEMS = ['potion', 'sword', 'lantern'];
export const ACTIONS = ['N', 'S', 'E', 'W', 'WAIT', 'SAVE', 'LOAD', 'USE:potion',
  'BUY:potion', 'BUY:sword', 'BUY:lantern', 'SELL:gem', 'SELL:potion', 'SELL:sword', 'SELL:lantern'];
const SOLID = new Set(['#', 'T', 'O', 'Y', '^']);
const SOLID_NAME = { '#': 'wall', T: 'statue', O: 'well', Y: 'tree', '^': 'brazier' };

export const CRASH_TEXT = {
  potion_at_full: "Uncaught TypeError: Cannot read properties of undefined (reading 'overheal')\n    at Satchel.consume (satchel.js:88:31)\n    at Player.use (player.js:142:12)",
  save_on_open_door: 'SerializationError: circular reference at tile.door.hinge.owner\n    at SaveSlot.write (save.js:57:9)\n    at Game.save (game.js:311:5)',
  sell_last_gem: 'RangeError: Invalid array length\n    at Ledger.removeAt (ledger.js:23:17)\n    at Shop.sellback (shop.js:204:20)',
  lantern_twice: "Uncaught TypeError: Cannot set properties of null (setting 'lit')\n    at Inventory.equip (inventory.js:66:14)\n    at Shop.buy (shop.js:118:7)",
};

export function parseAction(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  const up = t.toUpperCase();
  if (DIRS[up]) return { type: 'MOVE', dir: up, key: up };
  if (up === 'WAIT' || up === 'SAVE' || up === 'LOAD') return { type: up, key: up };
  const m = /^(USE|BUY|SELL):([a-z]+)$/i.exec(t);
  if (!m) return null;
  const verb = m[1].toUpperCase(), item = m[2].toLowerCase();
  const key = `${verb}:${item}`;
  if (!ACTIONS.includes(key)) return null;
  return { type: verb, item, key };
}

const kxy = (x, y) => `${x},${y}`;
const clone = v => structuredClone(v);

export class Game {
  constructor(world, bugs = []) {
    this.world = world;
    this.R = world.rules;
    this.bugByTemplate = new Map(bugs.map(b => [b.template, b]));
    this.fired = [];
    this.steps = 0;
    this.lastEvents = ['A new game begins.'];
    this.s = this.initialState();
    this.frameCache = null;
  }

  bug(template) { return this.bugByTemplate.get(template) ?? null; }
  fire(b, note) { if (!this.fired.some(f => f.bug === b.id && f.step === this.steps)) this.fired.push({ bug: b.id, step: this.steps, turn: this.s.turn, note }); }

  initialState() {
    const L0 = this.world.levels[0];
    const R = this.R;
    const s = {
      level: 0, turn: 0, status: 'playing', crash: null,
      player: { x: L0.start.x, y: L0.start.y, hp: R.maxHp },
      gold: R.startGold, score: 0,
      inv: { gems: 0, potions: 0, sword: 0, lantern: 0, keys: { a: 0, b: 0, c: 0, d: 0 } },
      save: null, lv: null,
      mem: { prevAction: null, lastBump: null, bumped: false, loadFlag: false, frozen: {}, rev: {}, ghosts: [], lagPrev: {}, hudGold: R.startGold, hudHp: R.maxHp },
    };
    s.lv = this.levelState(0);
    return s;
  }

  levelState(L) {
    const W = this.world.levels[L];
    return {
      items: W.items.map(clone),
      doors: W.doors.map(d => ({ ...d, open: false })),
      enemies: W.enemies.map(e => e.kind === 'wisp'
        ? { id: e.id, kind: 'wisp', braziers: e.braziers, b: 0, x: e.braziers[0][0], y: e.braziers[0][1], alive: true }
        : { id: e.id, kind: e.kind, route: e.route, i: 0, dir: 1, pause: 0, x: e.route[0][0], y: e.route[0][1], alive: true }),
      rubble: [],
    };
  }

  get L() { return this.world.levels[this.s.level]; }
  tile(x, y) { const L = this.L; if (x < 0 || y < 0 || x >= L.w || y >= L.h) return '#'; return L.grid[y][x]; }
  isSecret(x, y) { return this.L.secrets.some(p => p.x === x && p.y === y); }
  isRubble(x, y) { return this.s.lv.rubble.some(p => p[0] === x && p[1] === y); }
  blocked(x, y) {
    if (this.isRubble(x, y)) return true;
    const t = this.tile(x, y);
    if (t === '#') return !this.isSecret(x, y);
    return SOLID.has(t);
  }
  doorAt(x, y) { return this.s.lv.doors.find(d => d.x === x && d.y === y) ?? null; }
  enemyAt(x, y) { return this.s.lv.enemies.find(e => e.alive && e.kind !== 'wisp' && e.x === x && e.y === y) ?? null; }
  onShop() { const sh = this.L.shop; return !!sh && sh.x === this.s.player.x && sh.y === this.s.player.y; }

  // ---------------------------------------------------------------- step
  step(raw) {
    const s = this.s;
    if (s.status !== 'playing') return { ok: false, error: `The episode is over (status: ${s.status}). Use reset or restore a snapshot.` };
    const a = parseAction(raw);
    if (!a) return { ok: false, error: `Unknown action ${JSON.stringify(raw)}. Legal actions: ${ACTIONS.join(', ')}` };
    this.steps++;
    s.mem.bumped = false;
    const ev = [];
    const crash = this.crashCheck(a);
    if (crash) {
      s.status = 'crashed';
      s.crash = crash.message;
      this.fire(crash.bug, crash.variant);
      this.lastEvents = ['The game stopped responding.'];
      this.frameCache = null;
      return { ok: true };
    }
    let advance = true;
    switch (a.type) {
      case 'MOVE': this.move(a.dir, ev); break;
      case 'WAIT': ev.push('You wait.'); break;
      case 'SAVE': s.save = this.core(); ev.push('Game saved.'); break;
      case 'LOAD': advance = !this.load(ev); break;
      case 'USE': this.use(a.item, ev); break;
      case 'BUY': this.buy(a.item, ev); break;
      case 'SELL': this.sell(a.item, ev); break;
    }
    if (advance && s.status === 'playing') { s.turn++; this.enemiesStep(ev, a); }
    if (s.status === 'playing' && s.player.hp <= 0) { s.player.hp = 0; s.status = 'game_over'; ev.push('You collapse. Game over.'); }
    if (!s.mem.bumped) s.mem.lastBump = null;
    s.mem.prevAction = a.key;
    this.lastEvents = ev;
    this.frameCache = null;
    this.checkRender();
    return { ok: true };
  }

  core() {
    const s = this.s;
    return clone({ level: s.level, turn: s.turn, player: s.player, gold: s.gold, score: s.score, inv: s.inv, lv: s.lv, mem: s.mem });
  }

  crashCheck(a) {
    const b = this.bug('crash_action');
    if (!b) return null;
    const s = this.s;
    let hit = false;
    if (b.variant === 'potion_at_full') hit = a.type === 'USE' && a.item === 'potion' && s.inv.potions > 0 && s.player.hp >= this.R.maxHp;
    else if (b.variant === 'save_on_open_door') { const d = this.doorAt(s.player.x, s.player.y); hit = a.type === 'SAVE' && !!d && d.kind === 'locked' && d.open; }
    else if (b.variant === 'sell_last_gem') hit = a.type === 'SELL' && a.item === 'gem' && this.onShop() && s.inv.gems === 1;
    else if (b.variant === 'lantern_twice') hit = a.type === 'BUY' && a.item === 'lantern' && this.onShop() && s.inv.lantern === 1;
    return hit ? { bug: b, variant: b.variant, message: CRASH_TEXT[b.variant] } : null;
  }

  cond(c, n) {
    const s = this.s;
    switch (c) {
      case 'none': return true;
      case 'holding_potion': return s.inv.potions > 0;
      case 'gems_ge': return s.inv.gems >= n;
      case 'gold_ge': return s.gold >= n;
      case 'has_sword': return s.inv.sword > 0;
      case 'prev_wait': return s.mem.prevAction === 'WAIT';
      default: return false;
    }
  }

  // ---------------------------------------------------------------- movement
  move(dir, ev) {
    const s = this.s, p = s.player;
    const [dx, dy] = DIRS[dir];
    const nx = p.x + dx, ny = p.y + dy;
    const e = this.enemyAt(nx, ny);
    if (e) {
      if (s.inv.sword) { e.alive = false; s.score += this.R.scoreKill; ev.push(`You strike down the ${e.kind}.`); }
      else { p.hp -= 1; ev.push(`You bump into the ${e.kind} and it bites you.`); }
      return;
    }
    const door = this.doorAt(nx, ny);
    if (door && !door.open) {
      if (door.kind === 'bone') {
        if (s.inv.gems >= this.R.boneGems) { door.open = true; ev.push('The bone door senses your gems and grinds open.'); this.place(nx, ny, ev); }
        else ev.push('The bone door rattles but stays shut.');
        return;
      }
      const k = door.color.toLowerCase();
      const cname = COLOR_NAME[door.color];
      if (s.inv.keys[k] > 0) {
        const ke = this.bug('key_eaten');
        if (ke && ke.door === door.id && this.cond(ke.cond, ke.n)) {
          s.inv.keys[k]--;
          this.fire(ke);
          ev.push(`The ${cname} key turns in the lock.`);
          return;
        }
        s.inv.keys[k]--;
        door.open = true;
        ev.push(`The ${cname} key turns in the lock. The ${cname} door swings open.`);
        this.place(nx, ny, ev);
        return;
      }
      const streak = s.mem.lastBump === door.id && s.mem.prevAction === dir ? 2 : 1;
      s.mem.lastBump = door.id;
      s.mem.bumped = true;
      const bp = this.bug('door_bypass');
      if (bp && bp.door === door.id) {
        let ok = false;
        if (bp.cond === 'bump_twice') ok = streak >= 2;
        else if (bp.cond === 'holding_other_key') ok = Object.entries(s.inv.keys).some(([c, v]) => c !== k && v > 0);
        else if (bp.cond === 'after_load') ok = s.mem.loadFlag;
        if (ok) {
          door.open = true;
          this.fire(bp);
          ev.push(`The ${cname} door swings open.`);
          this.place(nx, ny, ev);
          return;
        }
      }
      ev.push(`The ${cname} door is locked.`);
      return;
    }
    if (this.blocked(nx, ny)) {
      const cb = this.bug('wall_clip');
      if (cb && cb.level === s.level && cb.x === nx && cb.y === ny && cb.dir === dir && this.cond(cb.cond, cb.n)) {
        const fx = nx + dx, fy = ny + dy;
        const fd = this.doorAt(fx, fy);
        if (!this.blocked(fx, fy) && !this.enemyAt(fx, fy) && (!fd || fd.open) && this.tile(fx, fy) !== '>') {
          this.fire(cb);
          this.place(fx, fy, ev);
          return;
        }
      }
      ev.push(`You bump into the ${this.isRubble(nx, ny) ? 'rubble' : SOLID_NAME[this.tile(nx, ny)] ?? 'wall'}.`);
      return;
    }
    this.place(nx, ny, ev);
  }

  place(x, y, ev) {
    const s = this.s, R = this.R;
    s.player.x = x; s.player.y = y;
    const here = s.lv.items.filter(it => it.x === x && it.y === y);
    const ghost = this.bug('ghost_sprite');
    for (const it of here) {
      let taken = true;
      if (it.kind === 'coins') { this.gainGold(it.value, ev); s.score += R.scoreCoin; ev.push(`You pick up ${it.value} gold.`); }
      else if (it.kind === 'gem') { s.inv.gems++; s.score += R.scoreGem; ev.push('You pick up a gem.'); }
      else if (it.kind === 'potion') {
        if (s.inv.potions < R.potionCap) { s.inv.potions++; ev.push('You pick up a potion.'); }
        else { taken = false; ev.push('Your satchel is full; the potion stays on the floor.'); }
      } else if (it.kind === 'key') { s.inv.keys[it.color.toLowerCase()]++; ev.push(`You pick up the ${COLOR_NAME[it.color]} key.`); }
      else if (it.kind === 'chest') {
        this.gainGold(it.value, ev); s.score += R.scoreChest;
        ev.push(`You open the chest and find ${it.value} gold.`);
        const cr = this.bug('chest_rubble');
        if (cr && it.id === cr.chest && this.cond(cr.cond, cr.n)) {
          const [ex, ey] = cr.entrance;
          if (!this.isRubble(ex, ey)) { s.lv.rubble.push([ex, ey]); this.fire(cr); ev.push('You hear stones shift.'); }
        }
      }
      if (taken) {
        s.lv.items = s.lv.items.filter(o => o !== it);
        if (ghost && ghost.variant === 'ghost_item' && ghost.kind === it.kind) s.mem.ghosts.push({ x, y, g: glyphOf(it) });
      }
    }
    if (this.tile(x, y) === '>') this.transition(ev);
    else if (this.onShop()) {
      const sh = this.L.shop;
      ev.push(`${sh.keeper}'s counter. Base prices: ${SHOP_ITEMS.map(i => `${i} ${sh.stock[i]}`).join(', ')}.`);
    }
  }

  gainGold(amount, ev) {
    const s = this.s, cap = this.R.purseCap;
    const raw = s.gold + amount;
    const correct = Math.min(cap, raw);
    let v = correct;
    const b = this.bug('purse_wrap');
    if (b) {
      if (b.variant === 'wrap256' && raw >= 256) v = raw - 256;
      else if (b.variant === 'capwrap' && raw > cap) v = raw - (cap + 1);
      if (v !== correct) this.fire(b);
    }
    if (v === correct && raw > cap) ev.push('Your purse is full; the extra coins are left behind.');
    s.gold = v;
    s.mem.hudGold = v;
  }

  transition(ev) {
    const s = this.s, R = this.R;
    const L = s.level;
    s.score += R.scoreFloor;
    if (L === this.world.levels.length - 1) { s.status = 'won'; ev.push('You climb the last stair into daylight. You win!'); return; }
    if (Object.values(s.inv.keys).some(v => v > 0)) ev.push('Your leftover keys crumble to dust.');
    s.inv.keys = { a: 0, b: 0, c: 0, d: 0 };
    const sd = this.bug('stairs_drop');
    if (sd && sd.from === L) {
      const inv = s.inv;
      let changed = false;
      if (sd.item === 'potion' && inv.potions >= sd.n) { inv.potions = 0; changed = true; }
      else if (sd.item === 'gem' && inv.gems >= sd.n) { inv.gems = 0; changed = true; }
      else if (sd.item === 'sword' && inv.sword) { inv.sword = 0; changed = true; }
      else if (sd.item === 'lantern' && inv.lantern) { inv.lantern = 0; changed = true; }
      else if (sd.item === 'gold_half' && s.gold > 1) { s.gold = Math.floor(s.gold / 2); changed = true; }
      if (changed) this.fire(sd);
    }
    s.level = L + 1;
    s.lv = this.levelState(L + 1);
    const st = this.world.levels[L + 1].start;
    s.player.x = st.x; s.player.y = st.y;
    s.mem.ghosts = []; s.mem.lagPrev = {}; s.mem.loadFlag = false; s.mem.frozen = {}; s.mem.rev = {};
    s.mem.hudGold = s.gold; s.mem.hudHp = s.player.hp;
    ev.push(`You take the stairs down to floor ${L + 2}, ${this.world.levels[L + 1].name}.`);
  }

  // ---------------------------------------------------------------- save / load
  load(ev) {
    const s = this.s;
    if (!s.save) { ev.push('The save slot is empty.'); return false; }
    const cur = { gold: s.gold, gems: s.inv.gems, potions: s.inv.potions, score: s.score };
    const saved = clone(s.save);
    const savedLevel = this.world.levels[saved.level];
    const savedOnShop = !!savedLevel.shop && savedLevel.shop.x === saved.player.x && savedLevel.shop.y === saved.player.y;
    Object.assign(s, { level: saved.level, turn: saved.turn, player: saved.player, gold: saved.gold, inv: saved.inv, lv: saved.lv, mem: saved.mem });
    s.score = Math.max(cur.score, saved.score);
    const du = this.bug('load_dupe');
    if (du && (du.cond === 'any' || savedOnShop)) {
      if (du.kind === 'coins' && cur.gold > s.gold) { s.gold = cur.gold; this.fire(du); }
      else if (du.kind === 'gem' && cur.gems > s.inv.gems) { s.inv.gems = cur.gems; this.fire(du); }
      else if (du.kind === 'potion' && cur.potions > s.inv.potions) { s.inv.potions = cur.potions; this.fire(du); }
    }
    s.mem.loadFlag = true;
    s.mem.lastBump = null;
    s.mem.hudGold = s.gold; s.mem.hudHp = s.player.hp;
    s.mem.lagPrev = {};
    const fz = this.bug('enemy_freeze');
    if (fz && fz.variant === 'after_load' && s.lv.enemies.some(e => e.id === fz.enemy)) s.mem.frozen[fz.enemy] = true;
    ev.push('Game loaded.');
    return true;
  }

  // ---------------------------------------------------------------- items and shop
  use(item, ev) {
    const s = this.s, R = this.R;
    if (item !== 'potion') { ev.push('Nothing happens.'); return; }
    if (s.inv.potions <= 0) { ev.push('You have no potion.'); return; }
    s.inv.potions--;
    if (s.player.hp >= R.maxHp) { ev.push('You drink the potion, but you were already at full health.'); return; }
    s.player.hp = Math.min(R.maxHp, s.player.hp + R.potionHeal);
    s.mem.hudHp = s.player.hp;
    ev.push(`You drink a potion. HP ${s.player.hp}/${R.maxHp}.`);
  }

  discountPct() { const R = this.R; return Math.min(R.discCap, R.discPerGem * this.s.inv.gems); }

  price(item) {
    const base = this.L.shop.stock[item];
    const n = base * (100 - this.discountPct());
    const correct = Math.floor((n + 50) / 100);
    const b = this.bug('price_rounding');
    let v = correct;
    if (b) {
      if (b.variant === 'floor') v = Math.floor(n / 100);
      else if (b.variant === 'ceil') v = Math.ceil(n / 100);
      else if (b.variant === 'half_down') v = n % 100 === 50 ? Math.floor(n / 100) : correct;
      if (v !== correct) this.fire(b);
    }
    return v;
  }

  buy(item, ev) {
    const s = this.s, R = this.R;
    if (!this.onShop()) { ev.push('There is no shop here.'); return; }
    if (item === 'sword' && s.inv.sword) { ev.push('You already carry a sword.'); return; }
    if (item === 'lantern' && s.inv.lantern) { ev.push('You already have a lantern.'); return; }
    if (item === 'potion' && s.inv.potions >= R.potionCap) { ev.push('Your satchel is full.'); return; }
    const price = this.price(item);
    if (s.gold < price) { ev.push(`You cannot afford the ${item} (${price} gold).`); return; }
    s.gold -= price;
    if (item === 'potion') s.inv.potions++; else s.inv[item] = 1;
    const hud = this.bug('stale_hud');
    if (!(hud && hud.variant === 'hud_gold')) s.mem.hudGold = s.gold;
    else if (s.mem.hudGold !== s.gold) this.fire(hud);
    ev.push(`You buy a ${item} for ${price} gold.`);
  }

  sell(item, ev) {
    const s = this.s, R = this.R;
    if (!this.onShop()) { ev.push('There is no shop here.'); return; }
    if (item === 'gem') {
      if (s.inv.gems <= 0) { ev.push('You have no gem to sell.'); return; }
      s.inv.gems--;
      this.gainGold(R.gemSell, ev);
      ev.push(`You sell a gem for ${R.gemSell} gold.`);
      return;
    }
    const have = item === 'potion' ? s.inv.potions : s.inv[item];
    if (!have) { ev.push(`You have no ${item} to sell.`); return; }
    const base = this.L.shop.stock[item];
    const correct = Math.floor(base / 2);
    let refund = correct;
    const b = this.bug('price_rounding');
    if (b && b.variant === 'sell_round_up') { refund = Math.ceil(base / 2); if (refund !== correct) this.fire(b); }
    if (item === 'potion') s.inv.potions--; else s.inv[item] = 0;
    this.gainGold(refund, ev);
    ev.push(`You sell the ${item} for ${refund} gold.`);
  }

  // ---------------------------------------------------------------- enemies
  patrolNext(e) {
    if (e.pause > 0) return { i: e.i, dir: e.dir, pause: e.pause - 1, x: e.x, y: e.y, end: false };
    let dir = e.dir, ni = e.i + dir;
    if (ni < 0 || ni >= e.route.length) { dir = -dir; ni = e.i + dir; }
    const end = ni === 0 || ni === e.route.length - 1;
    const pause = e.kind === 'crawler' && end ? 1 : 0;
    if (end) dir = ni === 0 ? 1 : -1;
    return { i: ni, dir, pause, x: e.route[ni][0], y: e.route[ni][1], end };
  }

  enemiesStep(ev, action, predicting = false) {
    const s = this.s, p = s.player;
    const tele = this.bug('enemy_teleport'), frz = this.bug('enemy_freeze'), hud = this.bug('stale_hud');
    for (const e of s.lv.enemies) {
      if (!e.alive) continue;
      if (e.kind === 'wisp') {
        if (s.turn % this.R.wispPeriod === 0) { e.b = 1 - e.b; [e.x, e.y] = e.braziers[e.b]; }
        continue;
      }
      const prev = [e.x, e.y];
      const correct = this.patrolNext(e);
      let nx = correct;
      if (correct.end) s.mem.rev[e.id] = (s.mem.rev[e.id] ?? 0) + 1;
      if (frz && frz.enemy === e.id && frz.variant === 'adjacent_wait' && action?.type === 'WAIT' && Math.abs(p.x - e.x) + Math.abs(p.y - e.y) === 1) s.mem.frozen[e.id] = true;
      if (frz && frz.enemy === e.id && s.mem.frozen[e.id] && (correct.x !== e.x || correct.y !== e.y)) {
        nx = { i: e.i, dir: e.dir, pause: e.pause, x: e.x, y: e.y };
        this.fire(frz);
      } else if (tele && tele.enemy === e.id && correct.end) {
        const hit = tele.variant === 'kth' ? s.mem.rev[e.id] % tele.k === 0
          : (e.route[0][1] === e.route[1][1] ? p.y === e.y : p.x === e.x);
        if (hit) {
          const oi = correct.i === 0 ? e.route.length - 1 : 0;
          nx = { i: oi, dir: oi === 0 ? 1 : -1, pause: 0, x: e.route[oi][0], y: e.route[oi][1] };
          if (nx.x !== correct.x || nx.y !== correct.y) this.fire(tele);
        }
      }
      if (nx.x === p.x && nx.y === p.y && (nx.x !== e.x || nx.y !== e.y)) {
        p.hp -= 1;
        if (!(hud && hud.variant === 'hud_hp')) s.mem.hudHp = p.hp;
        ev.push(`The ${e.kind} strikes you.`);
        continue;
      }
      Object.assign(e, { i: nx.i, dir: nx.dir, pause: nx.pause, x: nx.x, y: nx.y });
      if (e.x < prev[0]) s.mem.lagPrev[e.id] = prev; else delete s.mem.lagPrev[e.id];
    }
    if (!predicting && !(hud && hud.variant === 'hud_hp')) s.mem.hudHp = p.hp;
  }

  // Predicted enemy tiles for the next T turns assuming the player stays out of the way
  // (used by the reference planner only).
  predictOccupancy(T) {
    const saved = this.s, firedLen = this.fired.length;
    const sim = clone({ ...saved, save: null });
    sim.player = { x: -99, y: -99, hp: 99 };
    this.s = sim;
    const occ = [];
    for (let t = 0; t <= T; t++) {
      occ.push(new Set(sim.lv.enemies.filter(e => e.alive && e.kind !== 'wisp').map(e => kxy(e.x, e.y))));
      sim.turn++;
      this.enemiesStep([], { type: 'WAIT' }, true);
    }
    this.s = saved;
    this.fired.length = firedLen;
    return occ;
  }

  // ---------------------------------------------------------------- rendering
  render(buggy) {
    const s = this.s, L = this.L, R = this.R;
    const rows = L.grid.map(r => r.split(''));
    const put = (x, y, g) => { if (y >= 0 && y < L.h && x >= 0 && x < L.w) rows[y][x] = g; };
    for (const [x, y] of s.lv.rubble) put(x, y, '#');
    const ghost = buggy ? this.bug('ghost_sprite') : null;
    const hud = buggy ? this.bug('stale_hud') : null;
    if (ghost && ghost.variant === 'ghost_item') for (const g of s.mem.ghosts) if (rows[g.y][g.x] === '.') put(g.x, g.y, g.g);
    for (const d of s.lv.doors) {
      let open = d.open;
      if (ghost && ghost.variant === 'door_glyph' && ghost.door === d.id && s.inv.keys[d.color.toLowerCase()] > 0) open = true;
      put(d.x, d.y, open ? "'" : d.kind === 'bone' ? '&' : d.color);
    }
    for (const it of s.lv.items) put(it.x, it.y, glyphOf(it));
    const p = s.player;
    for (const e of s.lv.enemies) {
      if (!e.alive) continue;
      if (e.kind === 'shade' && !s.inv.lantern && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) > R.shadeRadius) continue;
      let [x, y] = [e.x, e.y];
      if (hud && hud.variant === 'enemy_lag' && hud.enemy === e.id && s.mem.lagPrev[e.id]) [x, y] = s.mem.lagPrev[e.id];
      put(x, y, ENEMY_GLYPH[e.kind]);
    }
    put(p.x, p.y, '@');
    const gold = hud && hud.variant === 'hud_gold' ? s.mem.hudGold : s.gold;
    const hp = hud && hud.variant === 'hud_hp' ? s.mem.hudHp : p.hp;
    const keys = Object.entries(s.inv.keys).filter(([, v]) => v > 0).map(([c, v]) => `${COLOR_NAME[c.toUpperCase()]}${v > 1 ? 'x' + v : ''}`);
    const hudLine = `HP ${hp}/${R.maxHp} | Gold ${gold} | Gems ${s.inv.gems} | Potions ${s.inv.potions} | Sword ${s.inv.sword ? 'yes' : 'no'} | Lantern ${s.inv.lantern ? 'yes' : 'no'} | Keys ${keys.length ? keys.join(',') : 'none'} | Turn ${s.turn} | Floor ${s.level + 1}/${this.world.levels.length}`;
    return rows.map(r => r.join('')).join('\n') + '\n' + hudLine;
  }

  hasRenderBug() { return !!(this.bug('ghost_sprite') || this.bug('stale_hud')); }

  checkRender() {
    if (!this.hasRenderBug() || this.s.status === 'crashed') return;
    const shown = this.render(true);
    this.frameCache = shown;
    if (shown !== this.render(false)) this.fire(this.bug('ghost_sprite') ?? this.bug('stale_hud'));
  }

  frame() {
    if (this.frameCache == null) this.frameCache = this.render(true);
    return this.frameCache;
  }

  observation() {
    const s = this.s, L = this.L, R = this.R;
    const state = {
      floor: s.level + 1, floor_name: L.name, floors_total: this.world.levels.length, turn: s.turn, status: s.status,
      player: { x: s.player.x, y: s.player.y, hp: s.player.hp, max_hp: R.maxHp },
      gold: s.gold, score: s.score,
      inventory: {
        gems: s.inv.gems, potions: s.inv.potions, sword: !!s.inv.sword, lantern: !!s.inv.lantern,
        keys: Object.entries(s.inv.keys).flatMap(([c, v]) => Array(v).fill(COLOR_NAME[c.toUpperCase()])),
      },
      enemies: s.lv.enemies.filter(e => e.alive).map(e => ({ id: e.id, kind: e.kind, x: e.x, y: e.y })),
      items: s.lv.items.map(it => ({ kind: it.kind, x: it.x, y: it.y, ...(it.kind === 'coins' ? { value: it.value } : {}), ...(it.kind === 'key' ? { color: COLOR_NAME[it.color] } : {}) })),
      doors: s.lv.doors.map(d => ({ x: d.x, y: d.y, kind: d.kind, ...(d.kind === 'locked' ? { color: COLOR_NAME[d.color] } : {}), open: d.open })),
      shop: this.onShop() ? { keeper: L.shop.keeper, base_prices: { ...L.shop.stock } } : null,
      save_slot: s.save ? 'used' : 'empty',
    };
    const out = { frame: this.frame(), state, events: [...this.lastEvents], status: s.status };
    if (s.status === 'crashed') out.error = s.crash;
    return out;
  }

  // Full internal state for snapshots (kept host-side, never handed to the solver).
  exportState() { return clone({ s: this.s, fired: this.fired, steps: this.steps, lastEvents: this.lastEvents }); }
  importState(st) { const c = clone(st); this.s = c.s; this.fired = c.fired; this.steps = c.steps; this.lastEvents = c.lastEvents; this.frameCache = null; }
}

export function glyphOf(it) {
  if (it.kind === 'key') return it.color.toLowerCase();
  return ITEM_GLYPH[it.kind];
}
