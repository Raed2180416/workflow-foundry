// Lantern Vault: a small deterministic grid game for the gameqa-web bed (plain browser JS, no dependencies).
// The game is the system under test. A build is the game plus a set of injected faults, chosen by the host through
// window.__BUILD_FLAGS before the page loads (the clean build has none). Every injected fault computes the correct
// result next to the faulty one and records a probe only when the two differ, so a probe means "the fault manifested".
// Probes are read by the oracle only (__game.__faults); testers see the public state, the HUD text and the UI layer.
(function () {
  'use strict';
  const LEVEL = [
    '##############',
    '#P..c...#...c#',
    '#.##.##.#.##.#',
    '#c.^..c.=..g.#',
    '#.#####.#.####',
    '#...k.s.#z...#',
    '###.###.##D###',
    '#g...c..#.R.E#',
    '#L.h.^..#..g.#',
    '##############',
  ];
  const W = LEVEL[0].length, H = LEVEL.length;
  const START = Object.freeze({ x: 1, y: 1 });
  const V = Object.freeze({ coin: 100, gem: 5000, relic: 20000, heartBonus: 500, spikePenalty: 500, bonusPerTick: 10 });
  const TIME_LIMIT = 300, MAX_LIVES = 5, START_LIVES = 3, DASH_COOLDOWN = 6, INVULN = 4, TOAST_TICKS = 12, SCORE_CAP = 999999;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  const flags = new Set(Array.isArray(window.__BUILD_FLAGS) ? window.__BUILD_FLAGS : []);
  const bug = name => flags.has(name);
  let faults = [], muted = false, quiet = false;
  let SEED = 1, S = null, queue = [];
  const fault = (id, detail = {}) => { if (!muted && !quiet) faults.push({ id, frame: S.frame, clock: S.clock, ...detail }); };
  const ev = name => { if (!muted) S.events.push(name); };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function newState(seed) {
    const rng = mulberry32((seed >>> 0) || 1);
    const tiles = LEVEL.map(r => r.split(''));
    const enemies = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tiles[y][x];
      if (t === 's' || t === 'z') {
        enemies.push({ id: `e${enemies.length + 1}`, x, y, px: x, py: y, axis: t === 's' ? 'x' : 'y', dir: rng() < 0.5 ? -1 : 1, phase: rng() < 0.5 ? 0 : 1 });
        tiles[y][x] = '.';
      } else if (t === 'P') tiles[y][x] = '.';
    }
    const coinsTotal = tiles.flat().filter(t => t === 'c').length;
    // Seeded start offset: each enemy first walks 0..7 steps along its patrol route (same rule as moveEnemies).
    const solid = (x, y) => { const t = tiles[y]?.[x]; return t !== '.' && t !== 'c' && t !== 'k' && t !== 'g' && t !== 'h'; };
    for (const e of enemies) {
      for (let k = Math.floor(rng() * 8); k > 0; k--) {
        const step = d => e.axis === 'x' ? [e.x + d, e.y] : [e.x, e.y + d];
        let [nx, ny] = step(e.dir);
        if (solid(nx, ny)) { e.dir = -e.dir; [nx, ny] = step(e.dir); if (solid(nx, ny)) break; }
        e.x = nx; e.y = ny; e.px = nx; e.py = ny;
      }
    }
    return {
      seed, frame: 0, clock: 0, mode: 'playing', dialog: null, player: { ...START }, lives: START_LIVES, score: 0, keys: 0,
      coins: 0, coinsTotal, gems: 0, relics: 0, timeLeft: TIME_LIMIT, dashCooldown: 0, invuln: 0, gateOpen: false,
      tiles, enemies, events: [], toast: null, bonus: null,
      // display cache: what the HUD shows (kept in the state so a desync is part of the deterministic replay)
      disp: { coins: 0, time: TIME_LIMIT, timerLive: true, timerFaulted: false },
      keyThisTick: false, respawned: false,
    };
  }

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const tileAt = (x, y) => inBounds(x, y) ? S.tiles[y][x] : '#';
  const walkSolid = (x, y) => { const t = tileAt(x, y); return t === '#' || (t === '=' && !S.gateOpen); };
  const dashSolid = (x, y) => { const t = tileAt(x, y); return t === '#' || t === 'D' || (t === '=' && !S.gateOpen); };
  const enemySolid = (x, y) => { const t = tileAt(x, y); return t !== '.' && t !== 'c' && t !== 'k' && t !== 'g' && t !== 'h'; };

  function addScore(n) {
    const correct = Math.min(SCORE_CAP, S.score + n);
    if (bug('score_int16')) {
      const stored = (correct << 16) >> 16;
      if (stored !== correct) fault('score_int16', { correct, stored });
      S.score = stored;
    } else S.score = correct;
  }

  function toast(kind, text) { S.toast = { kind, text, ttl: TOAST_TICKS }; }

  function hurt(cause) {
    S.lives -= 1;
    if (cause === 'spikes') {
      ev('spikes');
      const correct = Math.max(0, S.score - V.spikePenalty);
      if (bug('spike_wrap')) {
        const stored = (S.score - V.spikePenalty) & 0xFFFF;
        if (stored !== correct) fault('spike_wrap', { correct, stored });
        S.score = stored;
      } else S.score = correct;
    } else ev(cause);
    if (S.keyThisTick && bug('key_lost_on_hit')) { S.keys -= 1; fault('key_lost_on_hit'); }
    S.respawned = true;
    if (S.lives <= 0) { S.lives = 0; S.mode = 'gameover'; S.dialog = 'gameover'; ev('game-over'); return; }
    S.player = { ...START }; S.invuln = INVULN; ev('respawn');
  }

  // Effects of entering a tile. Returns true when the move must stop (hurt, level complete).
  function enter(x, y, how) {
    const t = S.tiles[y][x];
    switch (t) {
      case 'c':
        S.tiles[y][x] = '.'; S.coins += 1; addScore(V.coin); ev('coin');
        if (how === 'dash' && bug('hud_coin_dash')) fault('hud_coin_dash'); else S.disp.coins += 1;
        return false;
      case 'g': S.tiles[y][x] = '.'; S.gems += 1; addScore(V.gem); ev('gem'); toast('gem', `Gem! +${V.gem}`); return false;
      case 'R': S.tiles[y][x] = '.'; S.relics += 1; addScore(V.relic); ev('relic'); toast('relic', `Relic! +${V.relic}`); return false;
      case 'k': S.tiles[y][x] = '.'; S.keys += 1; S.keyThisTick = true; ev('key'); toast('key', 'Key collected - find the locked door'); return false;
      case 'h':
        S.tiles[y][x] = '.';
        if (S.lives < MAX_LIVES) { S.lives += 1; ev('heart'); } else { addScore(V.heartBonus); ev('heart-bonus'); }
        return false;
      case '^': hurt('spikes'); return true;
      case 'E': complete(); return true;
      default: return false;
    }
  }

  function walk(dir) {
    const [dx, dy] = DIRS[dir], nx = S.player.x + dx, ny = S.player.y + dy, t = tileAt(nx, ny);
    if (t === 'D') {
      if (S.keys <= 0) { ev('bump'); return; }
      S.keys -= 1; S.tiles[ny][nx] = '/'; ev('door-open');
    } else if (walkSolid(nx, ny)) { ev('bump'); return; }
    S.player = { x: nx, y: ny }; ev('move');
    enter(nx, ny, 'walk');
  }

  function dash(dir) {
    const [dx, dy] = DIRS[dir], { x, y } = S.player;
    const a = { x: x + dx, y: y + dy }, b = { x: x + 2 * dx, y: y + 2 * dy };
    const blockedA = dashSolid(a.x, a.y), blockedB = dashSolid(b.x, b.y);
    const correct = blockedA ? null : (blockedB ? a : b);
    let land = correct;
    if (bug('dash_tunnel') && blockedA && !blockedB) { land = b; fault('dash_tunnel', { from: { x, y }, to: b }); }
    if (!land) { ev('bump'); return; }
    S.dashCooldown = DASH_COOLDOWN; ev('dash');
    if (land === b && !blockedA) { S.player = { ...a }; if (enter(a.x, a.y, 'dash')) return; }
    S.player = { ...land };
    enter(land.x, land.y, 'dash');
  }

  function doMove(m) { if (m.dash && S.dashCooldown === 0) dash(m.dir); else walk(m.dir); }

  // Everything a tester can observe that a move can change (state, this tick's events, the HUD caches, the toast).
  const outcome = () => JSON.stringify({ p: S.player, sc: S.score, l: S.lives, k: S.keys, c: S.coins, g: S.gems, r: S.relics, t: S.tiles,
    go: S.gateOpen, d: S.dashCooldown, m: S.mode, dl: S.dialog, i: S.invuln, ev: S.events, dc: S.disp.coins, to: S.toast, b: S.bonus });
  // The correct outcome of a single move, computed on a throwaway copy of the state (events recorded there, no probes).
  function predict(m) {
    const saved = S; S = structuredClone(saved); quiet = true;
    try { doMove(m); return { player: { ...S.player }, outcome: outcome() }; } finally { S = saved; quiet = false; }
  }

  function useAction() {
    if (tileAt(S.player.x, S.player.y) === 'L') {
      S.gateOpen = !S.gateOpen; ev('lever'); ev(S.gateOpen ? 'gate-open' : 'gate-close');
    }
  }

  function moveEnemies() {
    for (const e of S.enemies) {
      e.px = e.x; e.py = e.y;
      if ((S.clock + e.phase) % 2 !== 0) continue;
      const step = d => e.axis === 'x' ? [e.x + d, e.y] : [e.x, e.y + d];
      let [nx, ny] = step(e.dir);
      if (enemySolid(nx, ny)) { e.dir = -e.dir; [nx, ny] = step(e.dir); if (enemySolid(nx, ny)) continue; }
      e.x = nx; e.y = ny;
    }
  }

  function collide(prev) {
    if (S.mode !== 'playing' || S.respawned || S.invuln > 0) return;
    for (const e of S.enemies) {
      const same = e.x === S.player.x && e.y === S.player.y;
      const moved = prev.x !== S.player.x || prev.y !== S.player.y;
      const swap = moved && e.x === prev.x && e.y === prev.y && e.px === S.player.x && e.py === S.player.y;
      if (same) { hurt('hit'); return; }
      if (swap) {
        if (bug('enemy_swap')) { fault('enemy_swap', { enemy: e.id }); continue; }
        hurt('hit'); return;
      }
    }
  }

  function complete() {
    const bonus = S.timeLeft * V.bonusPerTick;
    addScore(bonus); S.bonus = bonus; S.mode = 'complete'; S.dialog = 'levelup'; ev('level-complete');
  }

  function resume(how) {
    S.mode = 'playing'; S.dialog = null; ev('resume');
    S.disp.timerLive = !(how === 'click' && bug('timer_hud_freeze'));
    if (S.disp.timerLive) S.disp.timerFaulted = false;
  }

  let restarted = false;
  function restart(how) {
    const frame = S.frame; S = newState(SEED); S.frame = frame; restarted = true; ev('restart');
    if (how === 'pause' && bug('restart_pause_lock')) { S.mode = 'paused'; S.dialog = null; fault('restart_pause_lock'); }
  }

  function onClick(id) {
    if (id === 'btn-resume' && S.dialog === 'pause') resume('click');
    else if (id === 'btn-restart' && S.dialog === 'pause') restart('pause');
    else if (id === 'btn-next' && S.dialog === 'levelup') { S.mode = 'won'; S.dialog = 'victory'; ev('win'); }
    else if (id === 'btn-retry' && S.dialog === 'gameover') restart('retry');
    else if (id === 'btn-again' && S.dialog === 'victory') restart('again');
  }

  function onEnter() {
    if (S.dialog === 'pause') resume('key');
    else if (S.dialog === 'levelup') onClick('btn-next');
    else if (S.dialog === 'gameover') onClick('btn-retry');
    else if (S.dialog === 'victory') onClick('btn-again');
  }

  function tick() {
    S.frame += 1; S.events = []; S.keyThisTick = false; S.respawned = false; restarted = false;
    const inputs = queue; queue = [];
    let move = null, use = false, pausedHere = false, lateMove = null;
    const allMoves = [];
    for (const inp of inputs) {
      if (restarted) break;
      if (pausedHere) {
        // Once the game pauses, the rest of the tick's input is ignored (DESIGN §2). The pause_move fault keeps one late arrow.
        if (inp.type === 'key' && KEYMAP[inp.key] && !inp.shift && !lateMove) lateMove = { dir: KEYMAP[inp.key], dash: false };
        continue;
      }
      if (inp.type === 'click') { onClick(inp.id); continue; }
      const k = inp.key;
      if (k === 'p' || k === 'P' || k === 'Escape') {
        if (S.mode === 'playing') { S.mode = 'paused'; S.dialog = 'pause'; ev('pause'); pausedHere = true; }
        else if (S.mode === 'paused' && S.dialog === 'pause') resume('key');
        continue;
      }
      if (k === 'Enter') { onEnter(); continue; }
      if (S.mode !== 'playing') continue;
      if (KEYMAP[k]) { const m = { dir: KEYMAP[k], dash: Boolean(inp.shift) }; allMoves.push(m); move = m; }
      else if (k === ' ') use = true;
    }
    if (!restarted && S.mode === 'paused' && pausedHere && lateMove && bug('pause_move')) {
      // The probe fires on any observable effect of the late arrow (a step, a bump event, a pickup), not only a changed position.
      const before = { ...S.player }, was = outcome();
      walk(lateMove.dir);
      // sig: the symptom signature (a different player position, or only other observable effects such as a bump event), which
      // the oracle keeps fixed when it tests minimality (a reducer keeps the failure signature, as test-case reducers do).
      if (outcome() !== was) fault('pause_move', { from: before, to: { ...S.player }, sig: S.player.x !== before.x || S.player.y !== before.y ? 'position' : 'effect' });
    }
    if (!restarted && S.mode === 'playing') {
      S.clock += 1;
      const prev = { ...S.player };
      // Use acts on the tile the player stands on at the start of the tick, before the move (DESIGN §2).
      if (use) useAction();
      if (move) {
        if (bug('multi_move') && allMoves.length > 1) {
          // The probe compares the whole observable outcome with the correct one (only the last move), not only the position:
          // a pickup on the way out and back, or an extra bump event, is the same fault manifesting.
          const correct = predict(move);
          for (const m of allMoves) { doMove(m); if (S.mode !== 'playing' || S.respawned) break; }
          if (outcome() !== correct.outcome) fault('multi_move', { correct: correct.player, actual: { ...S.player }, sig: S.player.x !== correct.player.x || S.player.y !== correct.player.y ? 'position' : 'effect' });
        } else doMove(move);
      }
      if (S.mode === 'playing') { moveEnemies(); collide(S.respawned ? { ...S.player } : prev); }
      if (S.mode === 'playing') {
        if (S.dashCooldown > 0) S.dashCooldown -= 1;
        // Immunity covers the respawn tick and the next INVULN ticks, so it does not count down on the respawn tick.
        if (S.invuln > 0 && !S.respawned) S.invuln -= 1;
        if (S.toast) { S.toast.ttl -= 1; if (S.toast.ttl <= 0) S.toast = null; }
        S.timeLeft -= 1;
        if (S.timeLeft <= 0) { S.timeLeft = TIME_LIMIT; hurt('timeout'); }
      }
    }
    if (S.disp.timerLive) S.disp.time = S.timeLeft;
    else if (S.disp.time !== S.timeLeft && !S.disp.timerFaulted) { S.disp.timerFaulted = true; fault('timer_hud_freeze', { shown: S.disp.time, actual: S.timeLeft }); }
    render();
  }

  // ---------------------------------------------------------------- rendering (DOM; no canvas)
  const GLYPH = { '#': '', '.': '', c: '•', g: '◆', R: '★', k: '⚷', D: '▮', '/': '', '^': '▲', E: '⇲', L: '♲', h: '♥', '=': '≡' };
  const CLASS = { '#': 'wall', '.': 'floor', c: 'coin', g: 'gem', R: 'relic', k: 'key', D: 'door', '/': 'door-open', '^': 'spikes', E: 'exit', L: 'lever', h: 'heart', '=': 'gate' };
  let cells = null;
  const $ = id => document.getElementById(id);
  const show = (id, on) => { const el = $(id); if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); };

  function buildBoard() {
    const board = $('board');
    board.style.gridTemplateColumns = `repeat(${W}, var(--cell))`;
    board.innerHTML = '';
    cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = document.createElement('div'); d.className = 'cell'; board.appendChild(d); cells.push(d);
    }
  }

  function occluded(id) {
    const el = $(id); if (!el || el.hasAttribute('hidden')) return false;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(top === el || el.contains(top));
  }

  function render() {
    if (!cells) buildBoard();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = S.tiles[y][x], c = cells[y * W + x];
      let cls = `cell ${CLASS[t] || 'floor'}`;
      if (t === '=' && S.gateOpen) cls += ' open';
      c.className = cls; c.textContent = t === '=' && S.gateOpen ? '' : (GLYPH[t] || '');
    }
    for (const e of S.enemies) { const c = cells[e.y * W + e.x]; c.className += ' enemy'; c.textContent = '☹'; }
    const pc = cells[S.player.y * W + S.player.x]; pc.className += ' player' + (S.invuln > 0 ? ' blink' : ''); pc.textContent = '☺';
    $('hud-score').textContent = `Score ${S.score}`;
    $('hud-lives').textContent = `Lives ${S.lives}`;
    $('hud-keys').textContent = `Keys ${S.keys}`;
    $('hud-coins').textContent = `Coins ${S.disp.coins}/${S.coinsTotal}`;
    $('hud-time').textContent = `Time ${S.disp.time}`;
    $('hud-dash').textContent = S.dashCooldown === 0 ? 'Dash ready' : `Dash ${S.dashCooldown}`;
    const t = $('toast');
    if (S.toast) {
      t.textContent = S.toast.text;
      // toast_over_resume: while the pause menu is open the key toast is drawn centred, above the dialog. During play it is drawn
      // normally, so the fault's only observable effect is the covered Resume button (found by the differential audit).
      t.className = 'toast' + (S.toast.kind === 'key' && S.dialog === 'pause' && bug('toast_over_resume') ? ' toast-center' : '');
      t.removeAttribute('hidden');
    } else { t.setAttribute('hidden', ''); t.className = 'toast'; }
    show('pause', S.dialog === 'pause');
    show('levelup', S.dialog === 'levelup');
    show('gameover', S.dialog === 'gameover');
    show('victory', S.dialog === 'victory');
    const banner = $('bonus-banner');
    banner.textContent = S.bonus === null ? '' : `Time bonus +${S.bonus}`;
    banner.className = 'banner' + (S.dialog === 'levelup' && bug('bonus_over_next') && S.bonus >= 1000 ? ' banner-wide' : '');
    $('final-score').textContent = `Final score ${S.score}`;
    $('levelup-score').textContent = `Score ${S.score}`;
    if (S.dialog === 'pause' && bug('toast_over_resume') && S.toast && S.toast.kind === 'key' && occluded('btn-resume') && !S.toastFaulted) {
      S.toastFaulted = true; fault('toast_over_resume');
    }
    if (S.dialog !== 'pause') S.toastFaulted = false;
    if (S.dialog === 'levelup' && bug('bonus_over_next') && occluded('btn-next') && !S.bannerFaulted) { S.bannerFaulted = true; fault('bonus_over_next'); }
  }

  // ---------------------------------------------------------------- input wiring
  document.addEventListener('keydown', e => {
    if (e.key === 'Shift') return;
    queue.push({ type: 'key', key: e.key, shift: e.shiftKey });
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault?.();
  });
  const BUTTONS = ['btn-resume', 'btn-restart', 'btn-next', 'btn-retry', 'btn-again'];

  // ---------------------------------------------------------------- public test API (what a QA build exposes)
  function publicState() {
    return {
      frame: S.frame, clock: S.clock, mode: S.mode, dialog: S.dialog, player: { ...S.player }, lives: S.lives, score: S.score, keys: S.keys,
      coins: S.coins, coinsTotal: S.coinsTotal, gems: S.gems, relics: S.relics, timeLeft: S.timeLeft, dashCooldown: S.dashCooldown,
      dashReady: S.dashCooldown === 0, invulnerable: S.invuln, gateOpen: S.gateOpen, bonus: S.bonus,
      toast: S.toast ? { kind: S.toast.kind, text: S.toast.text, ttl: S.toast.ttl } : null,
      enemies: S.enemies.map(e => ({ id: e.id, x: e.x, y: e.y, axis: e.axis, dir: e.dir })),
      events: [...S.events], tiles: S.tiles.map(r => r.join('')),
    };
  }
  function hud() {
    const ids = ['hud-score', 'hud-lives', 'hud-keys', 'hud-coins', 'hud-time', 'hud-dash'];
    return Object.fromEntries(ids.map(id => [id.slice(4), $(id).textContent]));
  }
  const UI_IDS = [['pause', 'dialog'], ['btn-resume', 'button'], ['btn-restart', 'button'], ['levelup', 'dialog'], ['bonus-banner', 'text'], ['btn-next', 'button'],
    ['gameover', 'dialog'], ['btn-retry', 'button'], ['victory', 'dialog'], ['btn-again', 'button'], ['toast', 'toast']];
  function ui() {
    return UI_IDS.map(([id, kind]) => {
      const el = $(id), r = el.getBoundingClientRect();
      let visible = r.width > 0 && r.height > 0;
      for (let n = el; n && visible; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('hidden')) visible = false;
      const out = { id, kind, visible, text: visible ? el.textContent.trim().slice(0, 60) : '' };
      if (visible) out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      if (visible && kind === 'button') out.top = !occluded(id);
      return out;
    });
  }

  window.__game = Object.freeze({
    reset(seed) { SEED = Number(seed) >>> 0 || 1; S = newState(SEED); queue = []; faults = []; render(); },
    tick, publicState, hud, ui,
    __faults: () => faults.map(f => ({ ...f })),
  });

  function boot() {
    for (const id of BUTTONS) $(id).addEventListener('click', () => queue.push({ type: 'click', id }));
    window.__game.reset(Number(new URLSearchParams(location.search).get('seed')) || 1);
    if (!window.__LOCKSTEP) setInterval(tick, 120);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
