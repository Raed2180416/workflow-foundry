// Reference planner (trusted host code). Drives a Game instance with time-expanded BFS over
// (x, y, turn) so paths dodge predicted enemy positions, then executes and re-plans on any
// deviation. Used to build the known minimal repros and decoy demonstrations; never shown to
// solvers.
import { DIRS } from './engine.mjs';

const MOVES = ['N', 'S', 'E', 'W', 'WAIT'];
const kxy = (x, y) => `${x},${y}`;

export function planPath(game, tx, ty, opts = {}) {
  const s = game.s, L = game.L, W = L.w, H = L.h;
  const T = opts.maxT ?? 2 * (W + H) + 40;
  const occ = game.predictOccupancy(T + 1);
  const avoid = opts.avoid ?? new Set();
  const pass = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const isTarget = x === tx && y === ty;
    let ok = !game.blocked(x, y);
    const t = game.tile(x, y);
    if (t === '>' && !isTarget) ok = false;
    const d = game.doorAt(x, y);
    if (d && !d.open) {
      if (d.kind === 'bone') ok = s.inv.gems >= game.R.boneGems;
      else ok = (opts.useKeys !== false || isTarget) && s.inv.keys[d.color.toLowerCase()] > 0;
    }
    if (!isTarget && avoid.has(kxy(x, y))) ok = false;
    pass[y * W + x] = ok ? 1 : 0;
  }
  const sx = s.player.x, sy = s.player.y;
  if (sx === tx && sy === ty) return [];
  const N = W * H;
  const seen = new Uint8Array(N * (T + 2));
  const parent = new Int32Array(N * (T + 2)).fill(-1);
  const via = new Int8Array(N * (T + 2)).fill(-1);
  const start = sy * W + sx;
  seen[start] = 1;
  let frontier = [start];
  for (let t = 0; t <= T && frontier.length; t++) {
    const next = [];
    for (const idx of frontier) {
      const cell = idx % N, x = cell % W, y = (cell - x) / W;
      for (let m = 0; m < 5; m++) {
        let nx = x, ny = y;
        if (m < 4) { const [dx, dy] = DIRS[MOVES[m]]; nx += dx; ny += dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || !pass[ny * W + nx]) continue; }
        const key = kxy(nx, ny);
        if (m < 4 && occ[t].has(key)) continue;
        if (occ[t + 1].has(key)) continue;
        const nidx = (t + 1) * N + ny * W + nx;
        if (seen[nidx]) continue;
        seen[nidx] = 1; parent[nidx] = idx; via[nidx] = m;
        if (nx === tx && ny === ty) {
          const out = [];
          let cur = nidx;
          while (cur !== start && parent[cur] >= 0) {
            const c = cur % N, cx = c % W, cy = (c - cx) / W;
            out.push({ a: MOVES[via[cur]], x: cx, y: cy });
            cur = parent[cur];
          }
          return out.reverse();
        }
        next.push(nidx);
      }
    }
    frontier = next;
  }
  return null;
}

// Static BFS distance (walls, closed doors without keys) used to order targets.
export function distances(game, opts = {}) {
  const L = game.L, W = L.w, H = L.h, s = game.s;
  const dist = new Map([[kxy(s.player.x, s.player.y), 0]]);
  const q = [[s.player.x, s.player.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const m of ['N', 'S', 'E', 'W']) {
      const [dx, dy] = DIRS[m];
      const nx = x + dx, ny = y + dy, key = kxy(nx, ny);
      if (dist.has(key) || game.blocked(nx, ny)) continue;
      const d = game.doorAt(nx, ny);
      if (d && !d.open && !(d.kind === 'locked' && s.inv.keys[d.color.toLowerCase()] > 0 && opts.useKeys !== false) && !(d.kind === 'bone' && s.inv.gems >= game.R.boneGems)) continue;
      dist.set(key, dist.get(kxy(x, y)) + 1);
      if (game.tile(nx, ny) !== '>') q.push([nx, ny]);
    }
  }
  return dist;
}

export class Driver {
  constructor(game) { this.g = game; this.actions = []; this.avoid = new Set(); this.limit = 400; }
  get s() { return this.g.s; }
  get L() { return this.g.L; }
  alive() { return this.g.s.status === 'playing' && this.actions.length < this.limit; }
  act(a) { if (!this.alive()) return false; this.g.step(a); this.actions.push(a); return true; }
  fired(id) { return this.g.fired.some(f => f.bug === id); }
  roomOf(x) { return this.L.rooms.findIndex(rm => x >= rm.x0 && x <= rm.x1); }

  goto(tx, ty, opts = {}) {
    const avoid = opts.avoid ?? this.avoid;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!this.alive()) return false;
      if (this.s.player.x === tx && this.s.player.y === ty) return true;
      let plan = planPath(this.g, tx, ty, { ...opts, avoid });
      if (!plan && opts.softAvoid) plan = planPath(this.g, tx, ty, { ...opts, avoid: new Set() });
      if (!plan) return false;
      let deviated = false;
      const lvl = this.s.level;
      for (const st of plan) {
        if (!this.act(st.a)) return false;
        if (this.s.status !== 'playing') return this.s.status === 'won';
        if (this.s.level !== lvl) return true;
        if (opts.stopWhen?.()) return true;
        if (this.s.player.x !== st.x || this.s.player.y !== st.y) { deviated = true; break; }
      }
      if (!deviated) return true;
    }
    return false;
  }

  items(pred) { return this.s.lv.items.filter(pred); }
  // Nearest reachable target; if none is reachable yet, the westmost one (gotoItem opens doors).
  nearest(list, opts = {}) {
    const dist = distances(this.g, opts);
    let best = null, bd = Infinity;
    for (const it of list) { const d = dist.get(kxy(it.x, it.y)); if (d != null && d < bd) { bd = d; best = it; } }
    if (best || opts.reachableOnly) return best;
    for (const it of list) if (!best || this.roomOf(it.x) < this.roomOf(best.x) || (this.roomOf(it.x) === this.roomOf(best.x) && it.x < best.x)) best = it;
    return best;
  }

  // Open every door west of room `ri` (collecting keys / gems as needed).
  openTo(ri) {
    for (const sep of this.L.seps) {
      if (sep.i >= ri) break;
      const door = this.s.lv.doors.find(d => d.sep === sep.i);
      if (!door || door.open) continue;
      if (door.kind === 'bone') {
        for (let i = 0; i < 6 && this.s.inv.gems < this.g.R.boneGems; i++) {
          const gem = this.nearest(this.items(i => i.kind === 'gem' && this.roomOf(i.x) <= sep.i));
          if (!gem || !this.goto(gem.x, gem.y, { avoid: new Set() })) return false;
        }
        if (this.s.inv.gems < this.g.R.boneGems) return false;
      } else if (!this.s.inv.keys[door.color.toLowerCase()]) {
        const key = this.items(i => i.kind === 'key' && i.color === door.color)[0];
        if (!key || !this.goto(key.x, key.y)) return false;
      }
      if (!this.goto(door.x, door.y)) return false;
      if (!door.open && !this.s.lv.doors.find(d => d.id === door.id).open) return false;
    }
    return true;
  }

  gotoItem(it, opts = {}) {
    if (!this.openTo(this.roomOf(it.x))) return false;
    if (!this.s.lv.items.some(o => o.id === it.id)) return false;
    return this.goto(it.x, it.y, opts);
  }

  gotoTile(x, y, opts = {}) { return this.openTo(this.roomOf(x)) && this.goto(x, y, opts); }

  clearLevel() {
    const lvl = this.s.level;
    if (!this.openTo(this.L.rooms.length)) return false;
    const ex = this.L.exit;
    return this.goto(ex.x, ex.y) && (this.s.level === lvl + 1 || this.s.status === 'won');
  }

  reachLevel(L) {
    for (let i = 0; i < 6 && this.s.level < L; i++) if (!this.clearLevel()) return false;
    return this.s.level === L && this.alive();
  }

  pickNearest(kind, opts = {}) {
    const list = this.items(i => i.kind === kind && !i.alcove && (!opts.filter || opts.filter(i)));
    const it = this.nearest(list, { useKeys: false, reachableOnly: true }) ?? this.nearest(list);
    return !!it && this.gotoItem(it, opts);
  }

  gotoShop() { const sh = this.g.world.levels[0].shop; return this.s.level === 0 && this.goto(sh.x, sh.y); }

  // Collect gold until at least `amount` (coins and the big chest of the current floor).
  earn(amount) {
    for (let i = 0; i < 12 && this.s.gold < amount; i++) {
      const it = this.nearest(this.items(i => (i.kind === 'coins' || i.kind === 'chest') && !i.alcove));
      if (!it || !this.gotoItem(it)) return false;
    }
    return this.s.gold >= amount;
  }

  waitUntil(pred, max = 60) {
    for (let i = 0; i < max; i++) { if (pred()) return true; if (!this.act('WAIT')) return false; }
    return pred();
  }
}
