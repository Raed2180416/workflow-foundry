// World generation for the `gameqa` bed: rules (with errata), floors made of a west-to-east
// chain of rooms separated by walls with one opening each (archway, coloured locked door or
// bone door), landmarks, a shop, a treasure alcove, secret passages, items and patrolling
// enemies. The world is a pure function of (seed, split, difficulty) and is generated BEFORE
// any bug is chosen, so the map never depends on which bugs are planted.
import { rng } from '../lib/rng.mjs';

export const DIFF = {
  1: { K: 1, levels: 2, W: 14, H: 8, rooms: [3, 3], enemies: [1, 2], shade: false, wisp: false, bone: false, errata: 0, secrets: 1 },
  2: { K: 2, levels: 2, W: 16, H: 9, rooms: [3, 3], enemies: [2, 2], shade: true, wisp: false, bone: false, errata: 0, secrets: 1 },
  3: { K: 3, levels: 3, W: 18, H: 10, rooms: [3, 4], enemies: [2, 3], shade: true, wisp: true, bone: true, errata: 1, secrets: 1 },
  4: { K: 4, levels: 3, W: 20, H: 11, rooms: [4, 4], enemies: [2, 3], shade: true, wisp: true, bone: true, errata: 2, secrets: 2 },
  5: { K: 5, levels: 4, W: 22, H: 12, rooms: [4, 5], enemies: [3, 3], shade: true, wisp: true, bone: true, errata: 3, secrets: 2 },
};

export const TITLES = ['Lantern Vale', 'Thornwick Deep', 'Glimmerholt', 'Saltreach Keep', 'Mirefall Crypts', 'Cobblewyn Halls', 'Emberlode', 'Quillmoor Vaults'];
export const STUDIOS = ['Tallowmere Games', 'Brightfen Interactive', 'Cinderjar Studio', 'Hollowbrook Works', 'Pebblewright Games'];
const FLOOR_NAMES = ['Lamplit Hall', 'Mossy Cellar', 'Clockwork Gallery', 'Ember Vault', 'Drowned Chapel', 'Rootbound Stair', 'Ashen Library', 'Copper Kiln', 'Silent Orchard', 'Glass Cistern', "Bellfounder's Crypt", 'Fungal Arcade'];
const ROOM_NAMES = ['antechamber', 'gallery', 'vestry', 'larder', 'scriptorium', 'atrium', 'cistern room', 'workshop', 'chapel', 'armory', 'loft', 'kiln room', 'pantry', 'reading room', 'bell room', 'store room'];
const LANDMARK_NAMES = {
  T: ['headless statue', 'bronze heron statue', 'cracked statue', "statue of the founder", 'weeping statue'],
  O: ['old well', 'dry well', 'mossy well', 'wishing well', 'sealed well'],
  Y: ['dead tree', 'petrified tree', 'twisted root', 'hollow stump', 'lightning-split tree'],
};
const KEEPERS = ['Mabely', 'Dorran', 'Old Quist', 'Yarrow', 'Pell the Tinker', 'Hesketh', 'Brannagh', 'Widow Corrie'];

function makeRules(r, cfg) {
  const doc = {
    maxHp: r.pick([5, 6]), potionHeal: r.pick([2, 3]), potionCap: 3, purseCap: r.pick([400, 450, 500]),
    discPerGem: r.pick([4, 5, 6]), discCap: r.pick([20, 24, 25, 30]), gemSell: r.pick([25, 30, 35]),
    boneGems: 3, shadeRadius: 3, wispPeriod: r.pick([5, 6, 7]), startGold: r.int(20, 40),
    scoreCoin: 10, scoreGem: 25, scoreChest: 50, scoreKill: 100, scoreFloor: 200,
  };
  const rules = { ...doc };
  const errata = [];
  const order = ['discount', ...r.shuffle(['purse', 'potion', ...(cfg.shade ? ['shade'] : [])])];
  const versions = ['0.9.2', '0.9.3', '0.9.3-hotfix'];
  for (const key of order.slice(0, cfg.errata)) {
    const version = versions[errata.length];
    if (key === 'discount') {
      rules.discPerGem = r.pick([4, 5, 6].filter(v => v !== doc.discPerGem));
      rules.discCap = r.pick([16, 20, 24, 25, 30].filter(v => v !== doc.discCap));
      errata.push({ key, version, from: { perGem: doc.discPerGem, cap: doc.discCap }, to: { perGem: rules.discPerGem, cap: rules.discCap } });
    } else if (key === 'purse') {
      rules.purseCap = doc.purseCap + r.pick([50, 100]);
      errata.push({ key, version, from: doc.purseCap, to: rules.purseCap });
    } else if (key === 'potion') {
      rules.potionHeal = doc.potionHeal === 2 ? 3 : 2;
      errata.push({ key, version, from: doc.potionHeal, to: rules.potionHeal });
    } else if (key === 'shade') {
      rules.shadeRadius = r.pick([2, 4]);
      errata.push({ key, version, from: doc.shadeRadius, to: rules.shadeRadius });
    }
  }
  return { rules, doc, errata };
}

const k = (x, y) => `${x},${y}`;

function tryLevel(r, L, cfg, feats, names) {
  const W = cfg.W, H = cfg.H;
  const n = r.int(cfg.rooms[0], cfg.rooms[1]);
  const total = W - 2 - (n - 1);
  const widths = Array(n).fill(3);
  let extra = total - 3 * n;
  if (extra < 0) return null;
  while (extra-- > 0) widths[r.int(0, n - 1)]++;
  const rooms = [];
  let x = 1;
  for (let i = 0; i < n; i++) { rooms.push({ x0: x, x1: x + widths[i] - 1 }); x += widths[i] + 1; }
  const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, xx) => (xx === 0 || y === 0 || xx === W - 1 || y === H - 1) ? '#' : '.'));
  const seps = [];
  for (let i = 0; i < n - 1; i++) {
    const sx = rooms[i].x1 + 1;
    for (let y = 0; y < H; y++) g[y][sx] = '#';
    const oy = r.int(1, H - 2);
    g[oy][sx] = '.';
    seps.push({ i, x: sx, oy, type: 'gap' });
  }
  if (L === 0) {
    if (seps.length < 2) return null;
    seps[1].type = 'locked';
    for (let i = 2; i < seps.length; i++) seps[i].type = r.chance(0.45) ? 'locked' : 'gap';
  } else {
    seps[r.int(0, seps.length - 1)].type = 'locked';
    for (const s of seps) if (s.type === 'gap' && r.chance(0.3)) s.type = 'locked';
  }
  if (feats.boneLevel === L) {
    const cands = seps.filter(s => s.type === 'gap' && !(L === 0 && s.i === 0));
    if (!cands.length) return null;
    r.pick(cands).type = 'bone';
  }
  const needGapSecret = L === 0 || feats.secret2Level === L;
  if (needGapSecret && !seps.some(s => s.type === 'gap')) return null;
  if (!seps.some(s => s.type === 'locked')) return null;
  const colors = r.shuffle(['A', 'B', 'C', 'D']);
  let ci = 0;
  for (const s of seps) if (s.type === 'locked') s.color = colors[ci++];
  const unusedColors = colors.slice(ci);

  const reserved = new Set();
  for (const s of seps) { reserved.add(k(s.x - 1, s.oy)); reserved.add(k(s.x + 1, s.oy)); reserved.add(k(s.x, s.oy)); }
  const used = new Set();
  const roomOf = xx => rooms.findIndex(rm => xx >= rm.x0 && xx <= rm.x1);
  const isFree = (xx, y) => xx > 0 && y > 0 && xx < W - 1 && y < H - 1 && g[y][xx] === '.' && !reserved.has(k(xx, y)) && !used.has(k(xx, y)) && roomOf(xx) >= 0;
  const freeIn = roomIdxs => {
    const out = [];
    for (const ri of roomIdxs) { const rm = rooms[ri]; for (let y = 1; y < H - 1; y++) for (let xx = rm.x0; xx <= rm.x1; xx++) if (isFree(xx, y)) out.push([xx, y]); }
    return out;
  };
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  // start / exit
  const startCands = freeIn([0]).filter(([xx]) => xx === rooms[0].x0);
  if (!startCands.length) return null;
  const [sxp, syp] = r.pick(startCands);
  const start = { x: sxp, y: syp };
  used.add(k(sxp, syp));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) reserved.add(k(sxp + dx, syp + dy));
  const exitCands = freeIn([n - 1]).filter(([xx]) => xx === rooms[n - 1].x1);
  if (!exitCands.length) return null;
  const [exx, exy] = r.pick(exitCands);
  const exit = { x: exx, y: exy };
  g[exy][exx] = '>';
  used.add(k(exx, exy));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) reserved.add(k(exx + dx, exy + dy));

  // shop on the first floor, in room 0 or 1 (both reachable before any lock)
  let shop = null;
  if (L === 0) {
    const ri = r.pick([0, 1]);
    const c = freeIn([ri]);
    if (!c.length) return null;
    const [hx, hy] = r.pick(c);
    g[hy][hx] = 'S';
    used.add(k(hx, hy));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) reserved.add(k(hx + dx, hy + dy));
    shop = { x: hx, y: hy, keeper: names.keeper, stock: { potion: r.int(9, 19), sword: r.int(24, 44), lantern: r.int(12, 30) } };
  }

  // secret passages (in archway walls)
  const secrets = [];
  const addSecret = sep => {
    const rows = range(1, H - 2).filter(y => Math.abs(y - sep.oy) >= 2 && g[y][sep.x - 1] === '.' && g[y][sep.x + 1] === '.' && !used.has(k(sep.x - 1, y)) && !used.has(k(sep.x + 1, y)));
    if (!rows.length) return false;
    const y = r.pick(rows);
    secrets.push({ x: sep.x, y, sep: sep.i });
    for (const xx of [sep.x - 1, sep.x + 1]) reserved.add(k(xx, y));
    return true;
  };
  if (L === 0 && !addSecret(seps[0])) return null;
  if (feats.secret2Level === L && L !== 0 && !addSecret(r.pick(seps.filter(s => s.type === 'gap')))) return null;

  // treasure alcove: a one-tile nook in the top or bottom row of a room
  let alcove = null;
  if (feats.alcoveLevel === L) {
    const cands = [];
    for (let ri = 0; ri < n; ri++) {
      const rm = rooms[ri];
      for (const row of [1, H - 2]) {
        const inner = row === 1 ? 2 : H - 3;
        for (let xx = rm.x0 + 1; xx <= rm.x1 - 1; xx++) {
          if ([xx - 1, xx, xx + 1].every(cx => isFree(cx, row)) && isFree(xx, inner)) cands.push({ x: xx, y: row, entrance: [xx, inner], room: ri });
        }
      }
    }
    if (!cands.length) return null;
    alcove = r.pick(cands);
    g[alcove.y][alcove.x - 1] = '#';
    g[alcove.y][alcove.x + 1] = '#';
    used.add(k(alcove.x, alcove.y));
    reserved.add(k(alcove.entrance[0], alcove.entrance[1]));
  }

  // landmarks: at most one statue, well and tree per floor
  const landmarks = [];
  const glyphs = r.shuffle(['T', 'O', 'Y']);
  for (const ri of r.shuffle(range(0, n - 1))) {
    if (!glyphs.length || !r.chance(0.75)) continue;
    const c = freeIn([ri]).filter(([xx, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !reserved.has(k(xx + dx, y + dy)) || g[y + dy][xx + dx] === '#'));
    if (!c.length) continue;
    const [lx, ly] = r.pick(c);
    const gl = glyphs.pop();
    g[ly][lx] = gl;
    used.add(k(lx, ly));
    landmarks.push({ glyph: gl, x: lx, y: ly, name: names.landmarks[gl], room: ri });
  }
  if (!landmarks.length) return null;

  // wisp braziers
  const enemies = [];
  if (feats.wispLevel === L) {
    const c = freeIn(range(0, n - 1));
    if (c.length < 2) return null;
    const [b1, b2] = r.sample(c, 2);
    if (Math.abs(b1[0] - b2[0]) + Math.abs(b1[1] - b2[1]) < 4) return null;
    for (const [bx, by] of [b1, b2]) { g[by][bx] = '^'; used.add(k(bx, by)); }
    enemies.push({ id: `w${L + 1}`, kind: 'wisp', braziers: [b1, b2] });
  }

  // items
  const items = [];
  let itemN = 0;
  const place = (kind, roomIdxs, extraProps = {}) => {
    const c = freeIn(roomIdxs);
    if (!c.length) return false;
    const [ix, iy] = r.pick(c);
    used.add(k(ix, iy));
    items.push({ id: `f${L + 1}i${++itemN}`, kind, x: ix, y: iy, ...extraProps });
    return true;
  };
  const firstLock = seps.find(s => s.type === 'locked').i;
  for (const s of seps) if (s.type === 'locked' && !place('key', range(0, s.i), { color: s.color })) return null;
  const spare = L === 0 || (cfg.bone && r.chance(0.5));
  if (spare && !place('key', range(0, firstLock), { color: unusedColors[0], spare: true })) return null;
  const bone = seps.find(s => s.type === 'bone');
  if (bone) { for (let i = 0; i < 3; i++) if (!place('gem', range(0, bone.i))) return null; }
  else if (L === 0) { for (let i = 0; i < 2; i++) if (!place('gem', [0, 1])) return null; }
  else if (!place('gem', range(0, n - 1))) return null;
  for (let i = r.int(0, 2); i > 0; i--) place('gem', range(0, n - 1));
  if (L === 0) { if (!place('potion', [0, 1])) return null; }
  else if (!place('potion', range(0, n - 1))) return null;
  if (r.chance(0.5)) place('potion', range(0, n - 1));
  for (let i = r.int(4, 6); i > 0; i--) place('coins', range(0, n - 1), { value: r.int(10, 30) });
  if (!place('chest', range(0, n - 1), { value: r.int(90, 180) })) return null;
  if (alcove) items.push({ id: `f${L + 1}i${++itemN}`, kind: 'chest', x: alcove.x, y: alcove.y, value: r.int(20, 50), alcove: true });

  // patrolling enemies
  const kinds = [];
  const ne = r.int(cfg.enemies[0], cfg.enemies[1]);
  for (let i = 0; i < ne; i++) kinds.push(i === 0 ? 'crawler' : r.pick(['crawler', 'moth']));
  if (feats.shadeLevel === L) kinds.push('shade');
  let en = 0;
  for (const kind of kinds) {
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const ri = r.int(L === 0 && n > 1 ? 1 : 0, n - 1);
      const rm = rooms[ri];
      const horiz = kind === 'crawler' ? true : kind === 'moth' ? false : r.chance(0.5);
      const span = horiz ? rm.x1 - rm.x0 + 1 : H - 2;
      const len = r.int(3, Math.min(5, span));
      if (len > span) continue;
      let route;
      if (horiz) { const y = r.int(1, H - 2); const x0 = r.int(rm.x0, rm.x1 - len + 1); route = range(0, len - 1).map(i => [x0 + i, y]); }
      else { const xx = r.int(rm.x0, rm.x1); const y0 = r.int(1, H - 2 - len + 1); route = range(0, len - 1).map(i => [xx, y0 + i]); }
      if (!route.every(([rx, ry]) => isFree(rx, ry))) continue;
      for (const [rx, ry] of route) used.add(k(rx, ry));
      enemies.push({ id: `${kind[0]}${L + 1}${++en}`, kind, route });
      ok = true;
    }
    if (!ok && kind !== 'moth') return null;
  }

  const lvl = {
    index: L, name: names.floors[L], w: W, h: H, grid: g.map(row => row.join('')),
    rooms: rooms.map((rm, i) => ({ ...rm, name: names.rooms[L][i] })),
    seps, doors: seps.filter(s => s.type !== 'gap').map(s => ({ id: `f${L + 1}${s.type === 'bone' ? 'bone' : s.color}`, x: s.x, y: s.oy, kind: s.type === 'bone' ? 'bone' : 'locked', color: s.color ?? null, sep: s.i })),
    items, enemies, start, exit, secrets, landmarks, shop, alcove,
  };
  return validate(lvl) ? lvl : null;
}

// Every item, the shop, the exit and every patrol tile must be reachable, and the floor must be
// solvable by collecting keys (and gems for bone doors) in order.
function validate(lv) {
  const { w, h, grid } = lv;
  const solid = (x, y) => { const t = grid[y][x]; if (t === '#') return !lv.secrets.some(p => p.x === x && p.y === y); return 'TOY^'.includes(t); };
  const reach = openDoors => {
    const seen = new Set([k(lv.start.x, lv.start.y)]);
    const q = [[lv.start.x, lv.start.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen.has(k(nx, ny)) || solid(nx, ny)) continue;
        const d = lv.doors.find(dd => dd.x === nx && dd.y === ny);
        if (d && !openDoors.has(d.id)) continue;
        seen.add(k(nx, ny));
        if (grid[ny][nx] !== '>') q.push([nx, ny]);
      }
    }
    return seen;
  };
  const all = reach(new Set(lv.doors.map(d => d.id)));
  const targets = [...lv.items.map(i => [i.x, i.y]), [lv.exit.x, lv.exit.y], ...lv.enemies.flatMap(e => e.route ?? [])];
  if (lv.shop) targets.push([lv.shop.x, lv.shop.y]);
  if (!targets.every(([x, y]) => all.has(k(x, y)))) return false;
  const open = new Set();
  for (let guard = 0; guard < 10; guard++) {
    const seen = reach(open);
    if (seen.has(k(lv.exit.x, lv.exit.y))) return true;
    let progressed = false;
    for (const d of lv.doors) {
      if (open.has(d.id)) continue;
      if (d.kind === 'bone') { const gems = lv.items.filter(i => i.kind === 'gem' && seen.has(k(i.x, i.y))).length; if (gems >= 3) { open.add(d.id); progressed = true; } }
      else if (lv.items.some(i => i.kind === 'key' && i.color === d.color && seen.has(k(i.x, i.y)))) { open.add(d.id); progressed = true; }
    }
    if (!progressed) return false;
  }
  return false;
}

export function makeWorld(seed, split, difficulty) {
  const cfg = DIFF[difficulty];
  if (!cfg) throw new Error(`gameqa: difficulty must be 1..5, got ${difficulty}`);
  const r = rng('gameqa-world', seed, split, difficulty);
  const { rules, doc, errata } = makeRules(r.fork('rules'), cfg);
  const nr = r.fork('names');
  const floors = nr.sample(FLOOR_NAMES, cfg.levels);
  const roomPool = nr.shuffle(ROOM_NAMES);
  const names = {
    title: nr.pick(TITLES), studio: nr.pick(STUDIOS), keeper: nr.pick(KEEPERS), floors,
    rooms: floors.map((_, L) => Array.from({ length: 6 }, (_, i) => roomPool[(L * 3 + i) % roomPool.length])),
    landmarks: Object.fromEntries(Object.entries(LANDMARK_NAMES).map(([gl, list]) => [gl, nr.pick(list)])),
  };
  const fr = r.fork('feats');
  const feats = {
    boneLevel: cfg.bone ? 1 : -1,
    shadeLevel: cfg.shade ? fr.int(0, cfg.levels - 1) : -1,
    wispLevel: cfg.wisp ? fr.int(0, cfg.levels - 1) : -1,
    alcoveLevel: fr.int(0, Math.min(1, cfg.levels - 1)),
    secret2Level: cfg.secrets > 1 ? cfg.levels - 1 : -1,
  };
  const levels = [];
  for (let L = 0; L < cfg.levels; L++) {
    let lv = null;
    for (let a = 0; a < 400 && !lv; a++) lv = tryLevel(r.fork(`level${L}-${a}`), L, cfg, feats, names);
    if (!lv) throw new Error(`gameqa: could not generate floor ${L} for seed ${seed}`);
    levels.push(lv);
  }
  const br = r.fork('build');
  const build = `0.9.${br.int(4, 6)} (build ${br.int(2200, 2899)})`;
  return { title: names.title, studio: names.studio, build, rules, docRules: doc, errata, levels, cfg, difficulty };
}
