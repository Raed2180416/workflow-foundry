// Audit step 4 (triviality attack). A deterministic heuristic solver that reads ONLY task.prompt
// and task.inputs: no environment, no host internals, no model. It is deliberately white-box:
// its author knows the generator, so it keyword-greps the evidence pack with the generator's own
// vocabulary, mines the changelog, and builds "universal" repros (one probe per class that would
// trigger every variant of that class) with a static map simulator that steps around every tile
// an enemy could ever occupy. AUDIT.md reports its pass rates; the test suite keeps it < 20% at d3.
const D4 = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const KW = { // report text -> class (current-build reports only, decoy titles removed first)
  crash: /crash|CTD|went down|died on me|stopped responding/i, softlock: /ate my key|stuck on|softlock|walled in|trapped|buried|won't open|key's gone|sealed/i,
  item_duplication: /duplicate|after reloading|after I load|roll it back/i, wall_clip: /wall on|clipp|leaky|without using the door/i,
  integer_overflow: /wrap|broke|gold counter|went DOWN/i, enemy_ai: /teleport|blink|freez|frozen|stuck enemy|stopped moving|seems stuck/i,
  render_mismatch: /still drawn|phantom|ghost|HUD|drawn open|looks open|graphics|sprite|display/i, door_without_key: /without its key|keyless|let me through|opens without/i,
  transition_inventory_loss: /stairs|between floors/i, shop_rounding: /rounding|off by one|shop math|sell-back|prices off|coin too much/i,
};
const DECOY = /^(Walked through a wall|Crawlers freeze|Spare key vanished|Purse refuses|Potion vanished|Score not restored|Cannot pick up a fourth|Moth hit me|Shade disappears|Wisp teleports|Bone door opened|Shop discount is wrong|Purse goes past|Potion heals|Shade drawn)/;
const CL = [[/Satchel|serializer/, 'crash'], [/consumes the key/, 'softlock'], [/rubble/, 'softlock'], [/deltas/, 'item_duplication'], [/wall-sliding/, 'wall_clip'], [/compact save/, 'integer_overflow'], [/Patrol book|restored lazily/, 'enemy_ai'], [/dirty-rect|redraw only/, 'render_mismatch'], [/lock checks/, 'door_without_key'], [/item type by item/, 'transition_inventory_loss'], [/integer arith/, 'shop_rounding']];
const FIXED = [[/first turn/, 'crash'], [/shop counter|statues/, 'enemy_ai'], [/paid out twice/, 'integer_overflow'], [/blue sprite|turn counter/, 'render_mismatch'], [/-1/, 'shop_rounding'], [/reopened/, 'item_duplication'], [/door corners/, 'wall_clip'], [/another colour|inside edge/, 'door_without_key'], [/lantern was dropped/, 'transition_inventory_loss'], [/box the player/, 'softlock']];

let TRACE = null;
export function traceProbe(task, cls) { TRACE = []; const out = trivialSolve(task, cls); const t = TRACE; TRACE = null; return { out, trace: t }; }
export function trivialSolve(task, only) {
  const I = task.inputs, cur = I.game.build.split(' ')[0], K = (I.floor_notes[0].width - 12) / 2, score = {};
  for (const r of I.reports) if (r.build === cur && !DECOY.test(r.title.replace(/^Re: /, ''))) { const t = `${r.title} ${r.body.split('\n\n')[0]}`; for (const [c, re] of Object.entries(KW)) if (re.test(t)) { score[c] = (score[c] ?? 0) + 2; break; } }
  const [chg, fix] = I.changelog.split('## Fixed');
  for (const line of chg.split('\n')) for (const [re, c] of CL) if (re.test(line)) score[c] = (score[c] ?? 0) + 1;
  for (const line of fix.split('\n')) for (const [re, c] of FIXED) if (re.test(line)) score[c] = (score[c] ?? 0) - 1;
  const classes = Object.keys(score).filter(c => score[c] > 0).sort((a, b) => score[b] - score[a]).slice(0, K + (K < 5 ? 1 : 0));
  // ---- static simulator: maps from floor_notes, enemies fenced off along their whole possible route
  const st0 = I.environment.initial_observation.state, prices = Object.fromEntries([...I.floor_notes[0].notes.matchAll(/(potion|sword|lantern) (\d+)/g)].map(m => [m[1], +m[2]]));
  const probe = recipe => {
    const F = I.floor_notes.map(f => f.map.map(r => r.split(''))), fence = F.map(() => new Set()), acts = [];
    F.forEach((g, L) => g.forEach((row, y) => row.forEach((c, x) => { if ('xmh'.includes(c)) for (const [dx, dy] of c === 'x' ? [[1, 0]] : c === 'm' ? [[0, 1]] : [[1, 0], [0, 1]]) for (let i = 0; i < 5 && (i === 0 || g[y + dy * i]?.[x + dx * i] === '.'); i++) fence[L].add(`${x + dx * i},${y + dy * i}`); })));
    const s = { L: 0, x: st0.player.x, y: st0.player.y, gold: st0.gold, gems: 0, pots: 0, keys: {} }, coin = Object.fromEntries(st0.items.filter(i => i.kind === 'coins').map(i => [`0,${i.x},${i.y}`, i.value]));
    const at = (x, y) => F[s.L][y]?.[x] ?? '#', nook = (x, y) => at(x - 1, y) === '#' && at(x + 1, y) === '#';
    const ok = (x, y, goal) => { const c = at(x, y); if (fence[s.L].has(`${x},${y}`) || '#TOYw^'.includes(c)) return false; if ('ABCD'.includes(c)) return s.keys[c.toLowerCase()] > 0; if (c === '&') return s.gems >= 3; return c !== '>' || goal; };
    const act = a => { if (acts.length < 400) { acts.push(a); TRACE?.push([a, s.L, s.x, s.y]); } return true; };
    const step = d => { const [dx, dy] = D4[d], x = s.x + dx, y = s.y + dy, c = at(x, y); if (!ok(x, y, true)) return act(d); if ('ABCD'.includes(c)) s.keys[c.toLowerCase()]--; F[s.L][y][x] = c === '>' ? '>' : '.'; Object.assign(s, { x, y });
      if (c === '$') s.gold += coin[`${s.L},${x},${y}`] ?? 15; else if (c === '=') s.gold += 90; else if (c === '*') s.gems++; else if (c === '!') s.pots++; else if (/[a-d]/.test(c)) s.keys[c] = (s.keys[c] ?? 0) + 1;
      if (c === '>' && s.L < F.length - 1) { s.L++; s.keys = {}; F[s.L].forEach((row, yy) => row.forEach((cc, xx) => { if (cc === '@') { Object.assign(s, { x: xx, y: yy }); row[xx] = '.'; } })); } act(d); };
    const go = goal => { const prev = new Map([[`${s.x},${s.y}`, null]]), q = [[s.x, s.y]]; // BFS to the nearest tile with goal(x, y)
      while (q.length) { const [x, y] = q.shift(); if (goal(x, y) && (x !== s.x || y !== s.y)) { const path = []; for (let k = `${x},${y}`; prev.get(k); k = prev.get(k)[0]) path.unshift(prev.get(k)[1]); path.forEach(step); return true; }
        for (const [d, [dx, dy]] of Object.entries(D4)) { const k = `${x + dx},${y + dy}`; if (!prev.has(k) && ok(x + dx, y + dy, goal(x + dx, y + dy))) { prev.set(k, [`${x},${y}`, d]); if (at(x + dx, y + dy) !== '>') q.push([x + dx, y + dy]); } } }
      return false; };
    const to = g => go((x, y) => at(x, y) === g && !(g === '=' && nook(x, y))), shop = () => s.L === 0 && to('S'), earn = n => { for (let i = 0; i < 9 && s.gold < n; i++) if (!to('$') && !to('=')) return false; return s.gold >= n; };
    const next = () => { for (let i = 0; i < 12; i++) { if (to('>')) return true; if (!go((x, y) => /[a-d]/.test(at(x, y))) && !to('*')) return false; } return false; };
    recipe({ s, act, step, go, to, shop, earn, next, prices, at, nook, F, wait: n => { for (let i = 0; i < n; i++) act('WAIT'); } });
    return acts;
  };
  const R = {
    crash: p => { p.to('!') && p.act('USE:potion'); p.to('*') && p.shop(); while (p.s.gems-- > 0) p.act('SELL:gem'); p.earn(p.prices.lantern) && p.shop() && p.act('BUY:lantern') && p.act('BUY:lantern'); p.go((x, y) => /[a-d]/.test(p.at(x, y))) && p.go((x, y) => 'ABCD'.includes(p.at(x, y)) && p.s.keys[p.at(x, y).toLowerCase()] > 0) && p.act('SAVE'); },
    item_duplication: p => { p.shop(); p.act('SAVE'); p.to('*'); p.to('!'); p.to('$'); p.act('LOAD'); },
    shop_rounding: p => { p.earn(70); p.to('!') && p.shop() && p.act('SELL:potion'); for (let g = 0; g < 2; g++) { p.to('*'); p.shop(); for (const it of ['sword', 'lantern', 'potion']) { p.act(`BUY:${it}`); p.act(`SELL:${it}`); } } },
    render_mismatch: p => { p.earn(p.prices.potion) && p.shop() && p.act('BUY:potion'); for (const L of p.F.keys()) { for (const g of ['$', '*']) if (p.to(g)) p.wait(1); p.wait(12); if (L === p.F.length - 1 || !p.next()) break; } },
    integer_overflow: p => { for (const L of p.F.keys()) { while (p.to('$') || p.to('=')); if (L === 0) { while (p.to('*')); p.shop(); for (let i = 0; i < 6; i++) p.act('SELL:gem'); } if (!p.next()) break; } },
    transition_inventory_loss: p => { p.earn(p.prices.sword + p.prices.lantern) && p.shop() && p.act('BUY:sword') && p.act('BUY:lantern'); for (const L of p.F.keys()) { while (p.to('!') || p.to('*')); if (!p.next()) break; } },
    door_without_key: p => { for (const L of p.F.keys()) { p.act('SAVE'); p.act('LOAD'); for (let i = 0; i < 4; i++) { if (!p.go((x, y) => 'ABCD'.includes(p.at(x + 1, y)))) break; p.act('E'); p.act('E'); const c = p.at(p.s.x + 1, p.s.y).toLowerCase(); p.go((x, y) => p.at(x, y) === c); p.go((x, y) => p.at(x, y) === c.toUpperCase()); } if (!p.next()) break; } },
    softlock: p => { p.earn(p.prices.sword) && p.shop() && p.act('BUY:sword'); p.to('!'); p.to('*'); p.to('*'); for (const L of p.F.keys()) { p.go((x, y) => p.at(x, y) === '=' && p.nook(x, y)); if (!p.next()) break; } },
    wall_clip: p => { p.to('!'); p.to('*'); p.to('*'); const g = p.F[0]; for (let x = 2; x < g[0].length - 2; x++) if (g.filter(r => r[x] === '#').length >= g.length - 2) for (let y = 1; y < g.length - 1; y++) for (const [dx, d] of [[-1, 'E'], [1, 'W']]) if (p.go((xx, yy) => xx === x + dx && yy === y)) { p.wait(1); p.act(d); } },
    enemy_ai: p => { for (const L of p.F.keys()) { p.act('SAVE'); p.act('LOAD'); p.wait(40); if (!p.next()) break; } },
  };
  return { bugs: (only ? [only] : classes).map(c => { const a = probe(R[c]); return { bug_class: c, repro_actions: a.length ? a : ['WAIT'], description: `universal ${c} probe` }; }) };
}
