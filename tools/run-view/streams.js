// JIT streams page: per experiment, cumulative cost and success charts by task index (one line per arm), per-arm lanes (one cell per task, coloured pass/fail,
// marked by who delivered the answer, with event icons), a version timeline per JIT arm and the summary experiments/jit/report.mjs computes.
// One classic script after history-core.js (its text sanitiser and formatters), no dependencies, no network. All data is rendered as TEXT (createTextNode /
// setAttribute with values chosen here): no markup from strings, no eval, no inline styles or handlers. The data comes from one embedded JSON block
// (export-streams.mjs) or from a file the reader opens (index-streams.mjs or export-streams.mjs --json-out).
(function (root) {
'use strict';
const H = root.HistoryCore;
const SVGNS = 'http://www.w3.org/2000/svg';
const SCHEMA = 'foundry-jit-streams/1';
const $ = id => document.getElementById(id);
const txt = value => H.sanitizeDisplay(value).text;                    // every string from the data passes through here before it becomes text or an attribute
const pick = (map, key, fallback = null) => H.own(map, key) ? map[key] : fallback;
const decodeSeg = seg => { try { return decodeURIComponent(seg); } catch { return seg; } };

// ------------------------------------------------------------------------------------------------------------------ element builders
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : txt(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(txt(kid)));
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, typeof v === 'number' ? String(Math.round(v * 10) / 10) : txt(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(txt(kid)));
  return el;
}

// ------------------------------------------------------------------------------------------------------------------ numbers and names
// usd and pct are report.mjs's own formats (renderMarkdown), so the summary table reads exactly like report.md
const usd = x => x == null || !Number.isFinite(x) ? '–' : `$${x.toFixed(x < 10 ? 3 : 2)}`;
const pct = x => x == null || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(1)}%`;
const short = spec => String(spec ?? '').replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1');
const cost = H.fmtCost, model = H.shortModel;
const slotClass = a => Number.isInteger(a.slot) && a.slot >= 0 && a.slot < 8 ? `c${a.slot}` : 'cx';   // a ninth arm is never a generated hue
const DELIVERED = { compiled: ['C', 'compiled'], interpreter: ['I', 'interpreter'], adjudicated: ['A', 'adjudicated (majority of interpreters)'] };
const REASON = { initial: 'first compile after warmup', deopts: 'deopts since the last compile', regression: 'a regression case (adjudicated)', 'no-version': 'no version yet' };
// Event icons: glyph, class, words. The order is the order of importance in a cell (three fit).
const ICON = {
  rejected: ['⊘', 'rejected', 'recompile rejected, the old version kept'], recompile: ['↻', 'recompile', 'recompiled, new version adopted'], compile: ['◆', 'compile', 'first version compiled'],
  'fallback-compile': ['⇑', 'fallback', 'compile fell back to the fallback builder'], 'compile-failed': ['✕', 'failed', 'compile failed, no usable version'], void: ['✕', 'failed', 'compile voided (nested model use)'],
  crash: ['▼', 'crash', 'compiled run crashed'], timeout: ['▼', 'timeout', 'compiled run timed out'], invalid: ['▼', 'invalid', 'compiled output failed the schema'], deopt: ['▼', 'deopt', 'deopt to the interpreter'],
  'no-version': ['∅', 'nover', 'no compiled version yet'], regression: ['⚑', 'regression', 'regression case kept'], disagree: ['≠', 'disagree', 'shadow disagreed with the compiled answer'],
  unresolved: ['?', 'unresolved', 'no majority'], shadow: ['◐', 'shadow', 'shadow interpretation agreed'], fault: ['ϟ', 'fault', 'environment fault'], 'fault-retry': ['ϟ', 'fault', 'environment fault, retried'],
};
const ICON_ORDER = Object.keys(ICON);
const GLYPH = { good: '✓', bad: '✕', warn: '!', info: '•', violet: '↑', slate: '–' };
function badge(text, kind = 'slate', title) { return h('span', { class: `badge ${kind}`, 'data-g': GLYPH[kind] ?? '•', title }, text); }
const OUTCOME = { adopted: 'good', rejected: 'warn', 'not chosen': 'slate', failed: 'bad', voided: 'bad', pending: 'info', writing: 'info' };

// ------------------------------------------------------------------------------------------------------------------ state
const S = { data: null, exp: null, idx: null, charts: [], pinned: null, focus: { a: 0, i: 0 }, live: 0 };
function announce(text) { clearTimeout(S.live); S.live = setTimeout(() => { $('live').textContent = txt(text); }, 250); }
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); $('theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; try { localStorage.setItem('streams-theme', t); } catch { /* storage may be blocked */ } }

function load(data) {
  if (!data || data.schema !== SCHEMA || !Array.isArray(data.experiments)) throw new Error(`Not a ${SCHEMA} streams file`);
  for (const E of data.experiments) for (const a of E.arms ?? []) { a.byIdx = new Map((a.rows ?? []).map(r => [r.idx, r])); a.openIdx = new Map((a.inProgress ?? []).map(p => [p.idx, p])); }
  S.data = data; S.pinned = null;
  $('tabs').replaceChildren(...data.experiments.map(E => h('a', { id: `tab-${E.name}`, href: `#/exp/${encodeURIComponent(E.name)}` }, E.name)));
  $('source').textContent = txt(`${data.experiments.length} stream experiment${data.experiments.length === 1 ? '' : 's'} from ${data.root ?? '?'}. Snapshot ${data.builtAt ?? '?'}. ${(data.notes ?? [])[0] ?? ''}`);
}

// ------------------------------------------------------------------------------------------------------------------ experiment page
function viewExperiment(E, query) {
  const view = $('view'); view.replaceChildren();
  S.exp = E; S.charts = []; S.idx = null;
  const rows = E.arms.reduce((t, a) => t + a.rows.length, 0);
  view.append(h('div', { class: 'exphead' },
    h('h2', { class: 'page' }, E.name),
    h('div', { class: 'pills' }, badge(E.report?.evidence ?? 'evidence unknown', E.split === 'test' ? 'warn' : 'info'), E.plan?.familyId ? badge(`family ${E.plan.familyId}`, 'slate') : null,
      badge(`${E.arms.length} arm${E.arms.length === 1 ? '' : 's'}`, 'slate'), badge(`${E.taskCount} tasks${E.plan ? ' planned' : ''}`, 'slate'), badge(`${rows} rows`, 'slate'),
      E.content ? null : badge('builder notes withheld (held-out)', 'warn')),
    h('p', { class: 'meta' }, `Run folder ${E.runDir}${E.plan ? `; plan ${E.plan.source}` : ''}. ${E.report?.noiseRule ?? ''}`)));
  if (E.error || E.errors?.length) view.append(h('section', { class: 'banner amber' }, h('h3', null, 'Could not read everything'), ...(E.error ? [E.error] : []).concat(E.errors ?? []).map(x => h('p', null, x))));
  if (E.missingArms?.length) view.append(h('section', { class: 'banner neutral', 'aria-label': 'Arms not started' }, h('h3', null, `${E.missingArms.length} planned arm${E.missingArms.length === 1 ? ' has' : 's have'} no folder yet`), h('p', null, E.missingArms.map(m => m.label).join(', '))));
  if (!E.arms.length) return;
  view.append(chartsBlock(E), lanesBlock(E), versionsBlock(E), summaryBlock(E));
  const cell = query.get('cell');
  if (cell) { const k = cell.lastIndexOf(':'), ai = E.arms.findIndex(a => a.slug === cell.slice(0, k)), i = Number(cell.slice(k + 1)); if (ai >= 0 && Number.isInteger(i)) pin(ai, i, false); }
}

// ------------------------------------------------------------------------------------------------------------------ charts
const legendKey = a => s('svg', { class: `key ${slotClass(a)}`, width: 26, height: 10, 'aria-hidden': 'true' }, s('line', { x1: 2, y1: 5, x2: 24, y2: 5, class: `k-${a.kind}` }));
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function axisOf(max, integer) {
  const step = integer ? Math.max(1, Math.ceil(niceStep(Math.max(max, 1) / 4))) : niceStep(Math.max(max, 0.01) / 4);
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step), ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  const dec = integer ? 0 : Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0));
  return { top, ticks, fmt: v => integer ? String(v) : `$${v.toFixed(dec)}` };
}
function lineChart(E, spec) {
  const n = Math.max(1, E.taskCount), arms = E.arms, labels = arms.length <= 4;
  const W = 520, Hh = 236, m = { l: 48, r: labels ? 128 : 16, t: 12, b: 32 }, pw = W - m.l - m.r, ph = Hh - m.t - m.b;
  const done = a => a.summary.curve.filter(p => p.done);
  const max = Math.max(0, ...arms.flatMap(a => done(a).map(spec.val)));
  const ax = axisOf(spec.integer ? Math.max(max, ...arms.map(a => a.rows.length)) : max, spec.integer);
  const x = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw), y = v => m.t + ph - (v / ax.top) * ph;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${Hh}`, role: 'group', tabindex: 0, 'aria-label': `${spec.title} by task index, one line per arm. Left and right arrow keys read the values at each task; the values are also in the table below.` });
  svg.append(s('title', null, spec.title));
  for (const t of ax.ticks) svg.append(s('line', { class: t === 0 ? 'base' : 'grid', x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t) }), s('text', { x: m.l - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, ax.fmt(t)));
  const every = n <= 12 ? 1 : n <= 30 ? 4 : n <= 80 ? 10 : 20;
  for (let i = 0; i < n; i += every) svg.append(s('text', { x: x(i), y: m.t + ph + 14, 'text-anchor': 'middle' }, String(i)));
  svg.append(s('text', { x: m.l + pw / 2, y: Hh - 3, 'text-anchor': 'middle' }, 'task index'));
  // difficulty segments (the stream order is the config's: a later segment is harder)
  for (let i = 1; i < n; i++) if (E.tasks[i]?.difficulty != null && E.tasks[i - 1]?.difficulty != null && E.tasks[i].difficulty !== E.tasks[i - 1].difficulty) {
    const xx = (x(i - 1) + x(i)) / 2; svg.append(s('line', { class: 'seg', x1: xx, x2: xx, y1: m.t, y2: m.t + ph }), s('text', { x: xx + 3, y: m.t + 9 }, `d${E.tasks[i].difficulty} →`));
  }
  const ends = [];
  for (const a of arms) {
    const pts = done(a);
    if (!pts.length) continue;
    const cls = slotClass(a);
    if (pts.length > 1) svg.append(s('path', { class: `ln k-${a.kind} ${cls}`, d: pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.idx).toFixed(1)} ${y(spec.val(p)).toFixed(1)}`).join(' ') }));
    if (spec.markCompiles && a.kind === 'jit') for (const r of a.rows) if (r.events.some(e => e.kind === 'compile-attempt')) {
      const p = a.summary.curve[r.idx]; if (!p) continue;
      const cx = x(r.idx), cy = y(spec.val(p));
      svg.append(s('path', { class: `cmp ${cls}`, d: `M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z` }, s('title', null, `${a.label}: compile at task ${r.idx}`)));
    }
    const last = pts.at(-1);
    svg.append(s('circle', { class: `end ${cls}`, cx: x(last.idx), cy: y(spec.val(last)), r: 3.5 }));
    ends.push({ a, x: x(last.idx), y: y(spec.val(last)), v: spec.val(last) });
  }
  if (labels) {                                                       // direct labels for up to four lines, nudged apart, in text colour
    ends.sort((p, q) => p.y - q.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 12) ends[k].ly = (ends[k - 1].ly ?? ends[k - 1].y) + 12;
    for (const e of ends) svg.append(s('text', { class: 'dl', x: m.l + pw + 8, y: (e.ly ?? e.y) + 3.5 }, `${e.a.label} ${spec.fmt(e.v)}`));
  }
  const xh = s('line', { class: 'xh', y1: m.t, y2: m.t + ph, x1: -10, x2: -10, visibility: 'hidden' });
  const dots = arms.map(a => s('circle', { class: `xd ${slotClass(a)}`, r: 4, cx: -10, cy: -10, visibility: 'hidden' }));
  svg.append(xh, ...dots);
  const idxAt = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / pw) * (n - 1)))); };
  svg.append(s('rect', { class: 'overlay', x: m.l - 6, y: m.t, width: pw + 12, height: ph, onpointermove: ev => setIdx(idxAt(ev)), onclick: ev => setIdx(idxAt(ev)) }));
  svg.addEventListener('keydown', ev => {
    const cur = S.idx ?? -1, last = n - 1;
    const next = { ArrowRight: Math.min(last, cur + 1), ArrowLeft: Math.max(0, cur < 0 ? 0 : cur - 1), Home: 0, End: last }[ev.key];
    if (next === undefined) return; ev.preventDefault(); setIdx(next);
  });
  const update = i => {
    const show = i != null;
    xh.setAttribute('visibility', show ? 'visible' : 'hidden'); if (show) { xh.setAttribute('x1', String(x(i))); xh.setAttribute('x2', String(x(i))); }
    arms.forEach((a, k) => { const p = show ? a.summary.curve[i] : null; const on = p && p.done !== undefined && i <= (a.summary.curve.length - 1);
      dots[k].setAttribute('visibility', on ? 'visible' : 'hidden'); if (on) { dots[k].setAttribute('cx', String(x(i))); dots[k].setAttribute('cy', String(y(spec.val(p)))); } });
  };
  S.charts.push(update);
  return h('figure', { class: 'chartcard' }, h('h4', null, spec.title), svg);
}
function setIdx(i) {
  if (S.idx === i) return;
  S.idx = i;
  for (const u of S.charts) u(i);
  const E = S.exp, t = E.tasks[i], box = $('readout');
  if (!box) return;
  const head = `Task ${i}${t ? ` (d${t.difficulty ?? '?'} seed ${t.seed ?? '?'})` : ''}`;
  box.replaceChildren(h('div', { class: 'wrap' }, h('table', null, h('caption', { class: 'sr-only' }, `Cumulative values at task ${i}`),
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, head), h('th', { scope: 'col' }, 'cum. $'), h('th', { scope: 'col' }, 'cum. successes'), h('th', { scope: 'col' }, 'this task'), h('th', { scope: 'col' }, 'task $'))),
    h('tbody', null, E.arms.map(a => {
      const p = a.summary.curve[i], r = a.byIdx.get(i);
      const state = r ? `${r.pass ? '✓ pass' : '✕ fail'}, ${pick(DELIVERED, r.delivered, [r.delivered])[0]}` : a.openIdx.has(i) ? 'open' : 'not run';
      return h('tr', null, h('th', { scope: 'row' }, legendKey(a), ' ', a.label), h('td', { class: 'num' }, h('strong', null, p ? usd(p.cumUsd) : '–')), h('td', { class: 'num' }, h('strong', null, p ? String(p.cumSuccesses) : '–')),
        h('td', null, state), h('td', { class: 'num' }, r ? cost(r.costUsd) : '–'));
    })))));
  announce(`${head}: ${E.arms.map(a => { const p = a.summary.curve[i]; return `${a.label} ${p ? `${usd(p.cumUsd)}, ${p.cumSuccesses} successes` : 'not reached'}`; }).join('; ')}`);
}
function chartsBlock(E) {
  const legend = h('ul', { class: 'legend', 'aria-label': 'Arms' }, E.arms.map(a => h('li', null, legendKey(a), `${a.label} (${a.kind})`)));
  const sec = h('section', { class: 'block', 'aria-label': 'Cumulative cost and successes' },
    h('h3', { class: 'sec' }, 'Cumulative cost and successes by task index'), legend,
    h('div', { class: 'charts' },
      lineChart(E, { title: 'Cumulative cost ($)', val: p => p.cumUsd ?? 0, fmt: usd, markCompiles: true }),
      lineChart(E, { title: 'Cumulative successes', val: p => p.cumSuccesses ?? 0, fmt: v => String(v), integer: true })),
    h('div', { id: 'readout', class: 'readout' }, h('span', { class: 'muted' }, 'Point at a chart (or focus it and use the arrow keys) to read every arm at one task.')),
    h('p', { class: 'note' }, 'Lines: jit solid, agent dashed, static dotted. ◆ on a JIT cost line marks a task that paid for a compile. Costs are the rows\' own; spend of unfinished attempts is in the summary\'s total $ only (as report.mjs counts it). The stream order is fixed by the config: a dashed rule marks where a harder segment starts.'),
    curveTable(E));
  return sec;
}
function curveTable(E) {
  const n = Math.max(0, ...E.arms.map(a => a.summary.curve.length));
  return h('details', null, h('summary', null, 'Chart data as a table (cumulative successes / $ by task index; * marks a failed task)'),
    h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('caption', { class: 'sr-only' }, 'Cumulative curves'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'idx'), E.arms.map(a => h('th', { scope: 'col' }, a.label)))),
      h('tbody', null, Array.from({ length: n }, (_, i) => h('tr', null, h('th', { scope: 'row' }, String(i)),
        E.arms.map(a => { const p = a.summary.curve[i]; return h('td', { class: 'num' }, p?.done ? `${p.cumSuccesses} / ${usd(p.cumUsd)}${p.pass ? '' : ' *'}` : '–'); })))))));
}

// ------------------------------------------------------------------------------------------------------------------ lanes
const iconsOf = events => {
  const kinds = new Set(events.map(e => e.kind === 'shadow' && e.agree === false ? 'disagree' : e.kind));
  if (kinds.has('disagree')) kinds.delete('shadow');
  return ICON_ORDER.filter(k => kinds.has(k));
};
function cellLabel(E, a, i) {
  const r = a.byIdx.get(i), t = E.tasks[i], where = `${a.label}, task ${i}${t ? ` (d${t.difficulty ?? '?'} seed ${t.seed ?? '?'})` : ''}`;
  if (r) return `${where}: ${r.pass ? 'pass' : 'fail'}, delivered by ${pick(DELIVERED, r.delivered, [0, r.delivered])[1]}${r.version != null ? ` v${r.version}` : ''}, ${cost(r.costUsd)}${iconsOf(r.events).length ? `; ${iconsOf(r.events).map(k => ICON[k][2]).join('; ')}` : ''}`;
  if (a.openIdx.has(i)) return `${where}: started, no row yet (${a.openIdx.get(i).kinds.join(', ') || 'spend only'})`;
  return `${where}: not run yet`;
}
function laneStatus(E, a) {
  const last = a.rows.at(-1), open = a.inProgress?.at(-1);
  if (open) return `task ${open.idx} open (no row yet)`;
  if (a.rows.length >= E.taskCount) return 'finished';
  const next = last ? last.idx + 1 : 0;
  if (a.kind === 'jit' && last?.state?.pendingCompile && next >= (a.def?.jit?.warmup ?? 0)) return `next ${next}: compiles first (${last.state.pendingCompile})`;
  return `next task ${next}`;
}
function lanesBlock(E) {
  const n = E.taskCount, CW = 30, CH = 26, GAP = 3, LW = 248, ICH = 14, VBH = 13, LGAP = 12, TOP = 40;
  const X = i => LW + i * (CW + GAP);
  const layout = []; let y = TOP;
  for (const a of E.arms) { const hgt = Math.max(46, CH + ICH + (a.kind === 'jit' ? VBH + 2 : 0)); layout.push({ a, y, hgt }); y += hgt + LGAP; }
  const W = X(n) + 10, Ht = y;
  const svg = s('svg', { class: 'lanes', width: W, height: Ht, viewBox: `0 0 ${W} ${Ht}`, role: 'group', 'aria-label': 'Per-arm lanes, one cell per task. Arrow keys move between cells; Enter pins a cell\'s details, Escape unpins.' });
  // header: difficulty segments and task indices
  let start = 0;
  for (let i = 1; i <= n; i++) if (i === n || E.tasks[i]?.difficulty !== E.tasks[start]?.difficulty) {
    svg.append(s('rect', { class: `segband${E.tasks[start]?.difficulty % 2 ? ' alt' : ''}`, x: X(start), y: 4, width: X(i) - X(start) - GAP, height: 16, rx: 3 }),
      s('text', { class: 'hd', x: X(start) + 5, y: 15.5 }, E.tasks[start]?.difficulty != null ? `difficulty ${E.tasks[start].difficulty}${i - start > 3 ? ` (tasks ${start}–${i - 1})` : ''}` : 'tasks'));
    start = i;
  }
  const every = n <= 40 ? 1 : 5;
  for (let i = 0; i < n; i += every) svg.append(s('text', { class: 'hd', x: X(i) + CW / 2, y: 33, 'text-anchor': 'middle' }, String(i)));
  svg.append(s('text', { class: 'hd', x: 8, y: 33 }, 'arm'));
  const cells = [];
  layout.forEach(({ a, y: ly, hgt }, ai) => {
    if (ai % 2 === 0) svg.append(s('rect', { class: 'lanebg', x: 0, y: ly - 5, width: W, height: hgt + 10 }));
    svg.append(s('line', { class: `sw k-${a.kind} ${slotClass(a)}`, x1: 8, x2: 24, y1: ly + 8, y2: ly + 8 }), s('text', { class: 'al', x: 30, y: ly + 12 }, a.label),
      s('text', { class: 'sub', x: 8, y: ly + 27 }, `${a.rows.length}/${n} done · ${a.summary.successes} pass · ${usd(a.summary.totalUsd)}`),
      s('text', { class: 'sub', x: 8, y: ly + 41 }, laneStatus(E, a)));
    const row = [];
    for (let i = 0; i < n; i++) {
      const r = a.byIdx.get(i), x0 = X(i), state = r ? (r.pass ? 'pass' : 'fail') : a.openIdx.has(i) ? 'open' : 'todo';
      const g = s('g', { class: 'hit', tabindex: -1, role: 'button', 'aria-label': cellLabel(E, a, i), 'data-a': ai, 'data-i': i });
      g.append(s('rect', { class: `cell ${state}`, x: x0, y: ly, width: CW, height: CH, rx: 3 }), s('rect', { class: 'ring', x: x0 - 2, y: ly - 2, width: CW + 4, height: CH + 4, rx: 4 }));
      if (r) g.append(s('text', { class: 'cl', x: x0 + 11, y: ly + 18, 'text-anchor': 'middle', 'aria-hidden': 'true' }, pick(DELIVERED, r.delivered, ['?'])[0]),
        s('text', { class: 'pf', x: x0 + CW - 3, y: ly + 10, 'text-anchor': 'end', 'aria-hidden': 'true' }, r.pass ? '✓' : '✕'));
      else if (state === 'open') g.append(s('text', { class: 'cl', x: x0 + CW / 2, y: ly + 18, 'text-anchor': 'middle', 'aria-hidden': 'true' }, '…'));
      const evs = r ? r.events : state === 'open' ? (a.events ?? []).filter(e => e.idx === i) : [];
      const icons = iconsOf(evs), shown = icons.slice(0, 3);
      if (shown.length) g.append(s('text', { class: 'ic', x: x0 + CW / 2, y: ly + CH + 11, 'text-anchor': 'middle', 'aria-hidden': 'true' },
        ...shown.map(k => s('tspan', { class: `ic i-${ICON[k][1]}` }, ICON[k][0])), icons.length > 3 ? s('tspan', null, `+${icons.length - 3}`) : null));
      g.addEventListener('pointerenter', () => { if (!S.pinned) showDetail(ai, i, false); });
      g.addEventListener('focus', () => { S.focus = { a: ai, i }; if (!S.pinned) showDetail(ai, i, false); });
      g.addEventListener('click', () => pin(ai, i, true));
      svg.append(g); row.push(g);
    }
    cells.push(row);
    if (a.kind === 'jit') {                                           // which compiled version served each task
      const vy = ly + CH + ICH + 1;
      let k = 0;
      while (k < n) {
        const v = a.byIdx.get(k)?.version;
        if (v == null) { k++; continue; }
        let e = k; while (e + 1 < n && a.byIdx.get(e + 1)?.version === v) e++;
        svg.append(s('rect', { class: `vb${v % 2 ? '' : ' alt'}`, x: X(k), y: vy, width: X(e) + CW - X(k), height: VBH - 2, rx: 2 }, s('title', null, `version ${v} served tasks ${k}–${e}`)));
        if (X(e) + CW - X(k) >= 22) svg.append(s('text', { class: 'vt', x: X(k) + 3, y: vy + 9 }, `v${v}`));
        k = e + 1;
      }
    }
  });
  S.cells = cells;
  const first = cells[0]?.[0]; if (first) first.setAttribute('tabindex', '0');
  svg.addEventListener('keydown', ev => {
    const { a, i } = S.focus;
    const mv = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Home: [0, -Infinity], End: [0, Infinity] }[ev.key];
    if (mv) { ev.preventDefault(); const na = Math.max(0, Math.min(cells.length - 1, a + mv[0])), ni = Math.max(0, Math.min(n - 1, i + mv[1])); focusCell(na, ni); return; }
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pin(a, i, true); }
    if (ev.key === 'Escape' && S.pinned) { ev.preventDefault(); unpin(); }
  });
  const key = h('div', { class: 'lanes-key', 'aria-label': 'Key' },
    h('span', { class: 'k' }, badge('pass', 'good'), badge('fail', 'bad'), badge('open (no row yet)', 'warn'), badge('not run', 'slate')),
    ...Object.entries(DELIVERED).map(([, [g, w]]) => h('span', { class: 'k' }, h('span', { class: 'g' }, g), w)),
    ...[...new Map(ICON_ORDER.map(k => [ICON[k][0] + ICON[k][1], k])).values()].map(k => h('span', { class: 'k' }, h('span', { class: 'g' }, ICON[k][0]), ICON[k][2])),
    h('span', { class: 'k' }, h('span', { class: 'g' }, 'v1'), 'band under a JIT lane: the version that served the task'));
  return h('section', { class: 'block', 'aria-label': 'Per-arm lanes' }, h('h3', { class: 'sec' }, 'Per-arm lanes'), key, h('div', { class: 'lanes-wrap' }, svg),
    h('div', { id: 'detail', class: 'detail', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Point at a cell to see its cost breakdown and events; click (or Enter) to pin it.')));
}
function focusCell(a, i) {
  const g = S.cells?.[a]?.[i]; if (!g) return;
  for (const row of S.cells) for (const c of row) c.setAttribute('tabindex', '-1');
  g.setAttribute('tabindex', '0'); S.focus = { a, i }; g.focus();
}
function pin(a, i, focus) {
  for (const row of S.cells ?? []) for (const c of row) c.classList.remove('pinned');
  const same = S.pinned && S.pinned.a === a && S.pinned.i === i && focus;
  if (same) { unpin(); return; }
  S.pinned = { a, i };
  S.cells?.[a]?.[i]?.classList.add('pinned');
  showDetail(a, i, true);
  if (focus) focusCell(a, i); else { S.focus = { a, i }; for (const row of S.cells ?? []) for (const c of row) c.setAttribute('tabindex', '-1'); S.cells?.[a]?.[i]?.setAttribute('tabindex', '0'); }
  const E = S.exp, arm = E.arms[a];
  try { history.replaceState(null, '', `#/exp/${encodeURIComponent(E.name)}?cell=${encodeURIComponent(`${arm.slug}:${i}`)}`); } catch { /* sandboxed frame */ }
}
function unpin() {
  for (const row of S.cells ?? []) for (const c of row) c.classList.remove('pinned');
  S.pinned = null;
  $('detail')?.replaceChildren(h('p', { class: 'muted' }, 'Unpinned. Point at a cell to see its cost breakdown and events; click (or Enter) to pin it.'));
  try { history.replaceState(null, '', `#/exp/${encodeURIComponent(S.exp.name)}`); } catch { /* sandboxed frame */ }
}
function eventText(e) {
  const f = [];
  const add = (label, v) => { if (v !== undefined && v !== null && v !== '') f.push(`${label} ${v}`); };
  switch (e.kind) {
    case 'interpret': add('', `${e.role} ${model(e.model)}`); add('cost', cost(e.costUsd)); if (e.answer === false) f.push('no answer'); add('error', e.error); if (e.nestedModelAttempts) add('nested model attempts', e.nestedModelAttempts); break;
    case 'compiled': add('version', e.version); add('status', e.status); add('deopt', e.deoptKind); add('cost', cost(e.costUsd)); add('error', e.error); break;
    case 'compile-attempt': { const r = e.result ?? e; add('', `v${r.version ?? e.version} by ${model(r.builderModel ?? e.builderModel)}`); add('accepted', (r.checkTraces?.accepted ?? e.accepted) ? 'yes' : 'no');
      add('exact', r.checkTraces ? `${r.checkTraces.exact}/${r.checkTraces.cases}` : e.exactRate != null ? H.fmtScore(e.exactRate) : null); add('cost', cost(r.costUsd ?? e.costUsd)); break; }
    case 'compile': case 'recompile': add('', `v${e.version} by ${model(e.builderModel)}`); add('because', pick(REASON, e.reason, e.reason)); add('accepted', e.accepted ? 'yes' : 'no'); add('exact', H.fmtScore(e.exactRate)); add('traces', e.traces); add('regressions', e.regressions); break;
    case 'rejected': add('', `v${e.version} by ${model(e.builderModel)}`); add('kept', `v${e.keep}`); add('why', e.why); break;
    case 'fallback-compile': add('', `v${e.version}: ${model(e.from)} → ${model(e.to)}`); break;
    case 'deopt': case 'crash': case 'timeout': case 'invalid': add('version', e.version); add('kind', e.deoptKind); add('detail', e.detail); break;
    case 'shadow': add('version', e.version); f.push(e.agree === true ? 'agreed' : e.agree === false ? 'disagreed' : e.note ?? 'no answer'); break;
    case 'adjudicate': add('version', e.version); add('majority', e.outcome); break;
    case 'regression': add('version', e.version); add('case', e.regressionId); break;
    case 'fault': case 'fault-retry': add('component', e.component); add('code', e.code); break;
    case 'spend': add('', e.component); add('cost', cost(e.costUsd)); f.push('(not billed to a row)'); break;
    default: for (const [k, v] of Object.entries(e)) if (!['kind', 'at', 'idx'].includes(k) && (typeof v !== 'object' || v === null)) add(k, v);
  }
  return f.join(', ').replace(/^ /, '').replace(/^, /, '');
}
function showDetail(ai, i, pinned) {
  const E = S.exp, a = E.arms[ai], r = a.byIdx.get(i), t = E.tasks[i], box = $('detail');
  if (!box) return;
  const head = h('div', { class: 'dt' }, h('h4', null, `${a.label} · task ${i}`), h('span', { class: 'muted' }, r?.taskKey ?? (t ? `d${t.difficulty ?? '?'} seed ${t.seed ?? '?'}` : '')),
    r ? badge(r.pass ? 'pass' : 'fail', r.pass ? 'good' : 'bad') : a.openIdx.has(i) ? badge('open', 'warn') : badge('not run', 'slate'),
    r ? badge(`by ${pick(DELIVERED, r.delivered, [0, r.delivered])[1]}`, r.delivered === 'compiled' ? 'info' : r.delivered === 'adjudicated' ? 'violet' : 'slate') : null,
    r?.version != null ? badge(`v${r.version}`, 'info') : null, r?.compiledStatus && r.compiledStatus !== 'ok' ? badge(`compiled ${r.compiledStatus}${r.deoptKind && r.deoptKind !== r.compiledStatus ? ` (${r.deoptKind})` : ''}`, 'warn') : null,
    pinned ? h('button', { type: 'button', class: 'btn small', onclick: () => unpin() }, 'Unpin') : h('span', { class: 'faint' }, '(preview; click to pin)'));
  if (!r) {
    const evs = (a.events ?? []).filter(e => e.idx === i);
    box.replaceChildren(head, evs.length ? h('div', null, h('h5', null, 'Events so far (no row yet: running, or cut short by a fault)'), h('ol', { class: 'ev' }, evs.map(e => h('li', null, h('span', { class: 'k' }, e.kind), ' ', eventText(e), e.at ? h('span', { class: 'faint' }, ` ${e.at.slice(11, 19)}`) : null))))
      : h('p', { class: 'muted' }, 'This arm has not reached this task.'));
    return;
  }
  const parts = Object.entries(r.costBreakdown ?? {}).sort((p, q) => q[1] - p[1]);
  const breakdown = h('div', null, h('h5', null, 'Cost breakdown'), h('table', { class: 't' }, h('caption', { class: 'sr-only' }, 'Cost by component'),
    h('tbody', null, parts.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', { class: 'num' }, cost(v)))),
      h('tr', null, h('th', { scope: 'row' }, 'total'), h('td', { class: 'num' }, h('strong', null, cost(r.costUsd)))))),
    r.orphanUsd ? h('p', { class: 'note' }, `Includes ${cost(r.orphanUsd)} from an earlier unfinished attempt at this task.`) : null, r.costUnknown ? h('p', { class: 'note' }, 'Some cost here is unknown (charged at its bound).') : null);
  const facts = h('div', null, h('h5', null, 'Outcome'), h('dl', { class: 'numbers' },
    ...[['score', H.fmtScore(r.score)], ['latency', H.fmtDur(r.latencyMs)], ['finished', r.at ? `${r.at.slice(5, 10)} ${r.at.slice(11, 19)} UTC` : '–'], ['error', r.error ? `${r.error.code}${r.error.message ? `: ${r.error.message}` : ''}` : null]]
      .filter(([, v]) => v != null).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
    Object.keys(r.oracle ?? {}).length ? h('p', { class: 'note' }, `Oracle (numbers only): ${Object.entries(r.oracle).map(([k, v]) => `${k} ${H.fmtScore(v)}`).join(' · ')}`) : null,
    r.state ? h('p', { class: 'note' }, `JIT state after: ${r.state.traces ?? 0} traces, ${r.state.regressions ?? 0} regression cases, version ${r.state.version ?? 'none'}, ${r.state.deoptsSinceCompile ?? 0} deopts since the last compile${r.state.pendingCompile ? `, compile pending (${r.state.pendingCompile})` : ''}.`) : null);
  const events = h('div', null, h('h5', null, `Events (${r.events.length})`), r.events.length ? h('ol', { class: 'ev' }, r.events.map(e => h('li', null, ICON[e.kind] ? `${ICON[e.kind][0]} ` : '', h('span', { class: 'k' }, e.kind), ' ', eventText(e)))) : h('p', { class: 'muted' }, 'None.'));
  box.replaceChildren(head, h('div', { class: 'cols' }, breakdown, events, facts));
}

// ------------------------------------------------------------------------------------------------------------------ versions
function versionTimeline(E, a) {
  const n = Math.max(1, E.taskCount), W = 900, m = { l: 20, r: 20 }, pw = W - m.l - m.r, x = i => m.l + (i / n) * pw;
  const atIdx = new Map(); for (const v of a.versions) { const k = v.attemptIdx ?? -1; atIdx.set(k, (atIdx.get(k) ?? 0) + 1); }
  const rowsH = Math.max(1, ...atIdx.values()) * 16, Ht = 34 + rowsH + 22;
  const svg = s('svg', { class: 'vtl', viewBox: `0 0 ${W} ${Ht}`, role: 'img', 'aria-label': `Version timeline of ${a.label}: ${a.versions.map(v => `${v.dir} ${v.status}${v.attemptIdx != null ? ` at task ${v.attemptIdx}` : ''}`).join('; ') || 'no compile yet'}` });
  const adopted = a.versions.filter(v => v.status === 'adopted' && v.adoptedAt != null).sort((p, q) => p.adoptedAt - q.adoptedAt);
  const lastDone = a.rows.length ? a.rows.at(-1).idx + 1 : 0;
  adopted.forEach((v, k) => {
    const end = adopted[k + 1]?.adoptedAt ?? Math.max(v.adoptedAt + 1, lastDone);
    svg.append(s('rect', { class: `band${k % 2 ? ' alt' : ''}`, x: x(v.adoptedAt), y: 6, width: Math.max(3, x(end) - x(v.adoptedAt)), height: 20, rx: 3 }, s('title', null, `${v.dir} served tasks ${v.adoptedAt}–${end - 1}`)),
      s('text', { class: 'vl', x: x(v.adoptedAt) + 5, y: 20 }, `v${v.version} · ${model(v.builderModel)}`));
  });
  const used = new Map();
  for (const v of a.versions) {
    if (v.attemptIdx == null) continue;
    const k = used.get(v.attemptIdx) ?? 0; used.set(v.attemptIdx, k + 1);
    const cx = x(v.attemptIdx), cy = 40 + k * 16;
    svg.append(s('path', { class: `at ${v.status.replace(/ /g, '-')}`, d: `M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z` }, s('title', null, `${v.dir}: ${v.status}`)),
      s('text', { x: cx + 8, y: cy + 3.5 }, `${v.dir} ${v.status}`));
  }
  const ay = Ht - 16;
  svg.append(s('line', { class: 'axis', x1: m.l, x2: m.l + pw, y1: ay, y2: ay }));
  const every = n <= 30 ? (n <= 12 ? 1 : 4) : 10;
  for (let i = 0; i <= n; i += every) svg.append(s('line', { class: 'tick', x1: x(i), x2: x(i), y1: ay, y2: ay + 4 }), s('text', { x: x(i), y: ay + 13, 'text-anchor': 'middle' }, String(i)));
  return svg;
}
function whyText(v) {
  const base = pick(REASON, v.reason, v.reason ?? 'unknown');
  const trig = (v.trigger ?? []).map(t => `${t.kind}${t.deoptKind && t.deoptKind !== t.kind ? ` ${t.deoptKind}` : ''} at ${t.idx}`);
  return trig.length ? `${base}: ${trig.join(', ')}` : base;
}
function checkCell(c) {
  if (!c) return h('td', { class: 'chk' }, '–');
  return h('td', { class: 'chk' }, `exact ${c.exact ?? '?'}/${c.cases ?? '?'}${c.partial != null ? `, partial ${H.fmtScore(c.partial)}` : ''}`,
    h('span', { class: 'sub' }, `${c.clean ? '✓ clean' : '✕ not clean'} · ${c.accepted ? '✓ accepted' : '✕ not accepted'}${c.regressions ? ` · regressions ${c.regressionsPassed}/${c.regressions}` : ''}${c.deopts ? ` · deopts ${c.deopts}` : ''}${c.crashes ? ` · crashes ${c.crashes}` : ''}${c.timeouts ? ` · timeouts ${c.timeouts}` : ''}`),
    c.unexplained?.length ? h('span', { class: 'sub' }, `unexplained diffs: ${c.unexplained.join(', ')}`) : null, c.error ? h('span', { class: 'sub' }, `check error ${c.error}`) : null, c.recheck ? h('span', { class: 'sub' }, `rechecked at ${usd(c.recheck.capUsd)} cap`) : null,
    c.perCase?.length ? h('details', null, h('summary', null, 'per case'), h('ul', null, c.perCase.map(p => h('li', null, `${p.id} (${p.kind ?? '?'}): ${p.status}${p.partial != null && p.status === 'diff' ? ` ${H.fmtScore(p.partial)}` : ''}${p.deoptKind ? ` ${p.deoptKind}` : ''}${p.note ? ` – ${p.note}` : ''}`)))) : null);
}
function versionsBlock(E) {
  const jits = E.arms.filter(a => a.kind === 'jit');
  if (!jits.length) return null;
  return h('section', { class: 'block', 'aria-label': 'Compiled versions' }, h('h3', { class: 'sec' }, 'Compiled versions per JIT arm'),
    ...jits.map(a => {
      const total = a.versions.reduce((t, v) => t + (v.costUsd ?? 0), 0), last = a.rows.at(-1);
      const counts = Object.entries(a.versions.reduce((m, v) => { m[v.status] = (m[v.status] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${v} ${k}`).join(', ');
      return h('section', { class: 'card', 'aria-label': `Versions of ${a.label}` },
        h('h3', null, legendKey(a), ' ', a.label, a.def?.compiler ? ` (interpreter ${model(a.def.interpreter)}, compiler ${model(a.def.compiler)})` : ''),
        h('p', { class: 'note' }, a.versions.length ? `${a.versions.length} compile attempt${a.versions.length === 1 ? '' : 's'} (${counts}), ${usd(total)} in compiles.` : `No compile yet.${last?.state?.pendingCompile ? ` A compile is pending (${pick(REASON, last.state.pendingCompile, last.state.pendingCompile)}): the stream compiles before its next task.` : ''}`),
        a.versions.length ? versionTimeline(E, a) : null,
        a.versions.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't ver' }, h('caption', { class: 'sr-only' }, `Compile attempts of ${a.label}`),
          h('thead', null, h('tr', null, ['Version', 'Compiled', 'Why', 'Builder', 'Cost', 'Host check', 'Outcome', 'Parent', 'Builder notes'].map(c => h('th', { scope: 'col' }, c)))),
          h('tbody', null, a.versions.map(v => h('tr', null,
            h('th', { scope: 'row' }, `v${v.version}`, h('span', { class: 'sub' }, v.dir)),
            h('td', null, v.attemptIdx != null ? `before task ${v.attemptIdx}` : '–', h('span', { class: 'sub' }, `${v.at ? `${v.at.slice(5, 10)} ${v.at.slice(11, 16)} UTC` : ''}${v.durationMs ? ` · ${H.fmtDur(v.durationMs)}` : ''}${v.turns ? ` · ${v.turns} turns` : ''}`)),
            h('td', { class: 'why' }, whyText(v)),
            h('td', null, model(v.builderModel) || '–', h('span', { class: 'sub' }, `${v.builderEffort ? `effort ${v.builderEffort}` : ''}${v.fellBackTo ? ` · fell back to ${model(v.fellBackTo)}` : ''}${v.builderError ? ` · error ${v.builderError}` : ''}`)),
            h('td', { class: 'num' }, usd(v.costUsd), v.cost ? h('span', { class: 'sub' }, `builder ${usd(v.cost.builder)} · gateway ${usd(v.cost.gateway)} · check ${usd(v.cost.check)}`) : null),
            checkCell(v.check),
            h('td', null, badge(v.status, pick(OUTCOME, v.status, 'slate')), h('span', { class: 'sub' }, v.status === 'adopted' ? `as ${v.adoptedAs} at task ${v.adoptedAt}` : v.status === 'rejected' ? `${v.rejectedWhy ?? ''}${v.keptVersion != null ? `; kept v${v.keptVersion}` : ''}` : v.status === 'not chosen' && v.chosen ? `${model(v.chosen)} attempt chosen` : v.status === 'writing' ? 'compile.json not written yet' : ''),
              v.nestedModelAttempts || v.hiddenPathAttempts ? h('span', { class: 'sub' }, `integrity: nested model ${v.nestedModelAttempts}, hidden path ${v.hiddenPathAttempts}`) : null),
            h('td', null, v.parent ?? '–'),
            h('td', null, !v.notes ? '–' : v.notes.withheld ? h('span', { class: 'muted' }, v.notes.withheld) : h('details', null, h('summary', null, `${v.notes.source} (${v.notes.chars} chars)`), h('pre', { class: 'notes' }, v.notes.excerpt))))))))) : null);
    }));
}

// ------------------------------------------------------------------------------------------------------------------ summary (report.mjs)
function table(caption, head, rows) {
  return h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('caption', { class: 'sr-only' }, caption), h('thead', null, h('tr', null, head.map(c => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((c, k) => k === 0 ? h('th', { scope: 'row' }, c) : h('td', null, c)))))));
}
function summaryBlock(E) {
  const arms = [...E.arms].sort((p, q) => (p.spec ?? p.slug).localeCompare(q.spec ?? q.slug)).map(a => a.summary);   // report.mjs order
  const jit = arms.filter(a => a.kind !== 'agent'), agents = arms.filter(a => a.kind === 'agent');
  const integrity = arms.filter(a => a.counts.nestedModelAttempts || a.counts.hiddenPathAttempts || a.counts.voided || a.costUnknownRows);
  return h('section', { class: 'block', 'aria-label': 'Summary as report.mjs computes it' }, h('h3', { class: 'sec' }, 'Summary (experiments/jit/report.mjs)'),
    h('p', { class: 'note' }, `Evidence: ${E.report?.evidence ?? '?'}. ${E.report?.noiseRule ?? ''} Last half = tasks from index ${arms[0]?.steadyState?.fromIdx ?? '?'} of what each arm has finished.`),
    table('Arms', ['arm', 'n', 'success', '95% CI (Wilson)', 'total $', '$/success', '$/task', 'last half (success, $/task)', 'last half $', 'delivered by'], arms.map(a => {
      const lh = E.arms.find(x => x.summary === a)?.lastHalf;
      return [short(a.spec), String(a.tasks), `${a.successes}/${a.tasks} (${pct(a.successRate)})`, `${pct(a.ci.lo)}–${pct(a.ci.hi)}`, `${usd(a.totalUsd)}${a.unbilledUsd ? ` (incl. ${usd(a.unbilledUsd)} unfinished attempts)` : ''}`,
        usd(a.usdPerSuccess), usd(a.usdPerTask), `${a.steadyState.successes}/${a.steadyState.tasks} (${pct(a.steadyState.successRate)}), ${usd(a.steadyState.usdPerTask)}`, usd(lh?.usd), Object.entries(a.deliveredBy).map(([k, v]) => `${k} ${v}`).join(', ')];
    })),
    h('h4', null, 'Cost breakdown ($)'), table('Cost breakdown', ['arm', 'components'], arms.map(a => [short(a.spec), Object.entries(a.costBreakdown).map(([k, v]) => `${k} ${usd(v)}`).join(', ') || '–'])),
    jit.length ? [h('h4', null, 'Compiled-path events'), table('Compiled-path events', ['arm', 'compiles (recompiles)', 'attempts / Opus fallbacks', 'rejected', 'failed', 'deopts by kind', 'crashes', 'timeouts', 'invalid', 'shadows', 'disagreements', 'adjudicated', 'regressions', 'unresolved', 'faults'],
      jit.map(a => { const c = a.counts; return [short(a.spec), `${c.compiles} (${c.recompiles})`, `${c.compileAttempts} / ${c.fallbackCompiles}`, String(c.rejected), String(c.compileFailed), Object.entries(c.deoptsByKind).map(([k, v]) => `${k} ${v}`).join(', ') || '0',
        String(c.crashes), String(c.timeouts), String(c.invalid), String(c.shadows), String(c.disagreements), Object.entries(c.adjudications).map(([k, v]) => `${k} ${v}`).join(', ') || '0', String(c.regressions), String(c.unresolved), String(c.faults)]; }))] : null,
    agents.length && arms.length > 1 ? [h('h4', null, 'Against each agent arm'), table('Against each agent arm', ['arm', 'vs', 'success gap (tasks)', 'noise?', 'break-even idx (observed)', 'projected', 'cumulative $ gap', 'note'],
      arms.flatMap(a => Object.entries(a.breakEven ?? {}).map(([ref, be]) => { const v = a.vsAgents[ref];
        return [short(a.spec), short(ref), `${v.successGap >= 0 ? '+' : ''}${v.successGap}`, v.noise ? 'noise' : 'no', be.observedIdx ?? '–', be.projectedIdx ?? '–', usd(be.cumGapUsd), be.note ?? '']; })))] : null,
    integrity.length ? [h('h4', null, 'Integrity flags'), h('ul', null, integrity.map(a => h('li', null, `${short(a.spec)}: nested model attempts ${a.counts.nestedModelAttempts}, hidden-path attempts ${a.counts.hiddenPathAttempts} (review by hand), voided compiles ${a.counts.voided}, rows with unknown cost ${a.costUnknownRows}.`)))] : null,
    E.markdown ? h('details', null, h('summary', null, 'report.md, as experiments/jit/report.mjs renders it for this snapshot'), h('pre', { class: 'notes' }, E.markdown)) : null);
}

// ------------------------------------------------------------------------------------------------------------------ router and start
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeSeg);
  return { name: parts[0] ?? 'exp', parts: parts.slice(1), query: new URLSearchParams(query) };
}
function render() {
  if (!S.data) return;
  const route = parseRoute();
  const E = S.data.experiments.find(x => x.name === route.parts[0]) ?? S.data.experiments[0];
  for (const a of document.querySelectorAll('#tabs a')) a.removeAttribute('aria-current');
  if (!E) { showEmpty('This streams file holds no experiment.'); return; }
  $(`tab-${E.name}`)?.setAttribute('aria-current', 'page');
  document.title = `JIT streams: ${E.name}`;
  try { S.pinned = null; viewExperiment(E, route.query); } catch (error) { $('view').replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Could not show this experiment'), h('p', { role: 'alert' }, error.message))); }
}
function showEmpty(message) {
  $('view').replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Open a streams file'), h('p', null, message ?? 'This page shows JIT stream experiments from a file written by export-streams.mjs.'),
    h('p', { class: 'muted' }, 'Build one: ', h('code', null, 'node tools/run-view/export-streams.mjs --out streams.html'), '. Then open that one file, or use Open streams file here with its .json form.')));
}
async function start() {
  let theme = 'dark';
  try { theme = localStorage.getItem('streams-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch { /* default */ }
  setTheme(theme);
  $('theme').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { load(JSON.parse(String(r.result))); location.hash = '#/'; render(); } catch (error) { showEmpty(error.message); } }; r.readAsText(f); });
  window.addEventListener('hashchange', () => { const r = parseRoute(); if (S.exp && r.parts[0] === S.exp.name && r.query.has('cell')) return; render(); });
  const embedded = document.getElementById('streams-data');
  try {
    if (embedded) load(JSON.parse(embedded.textContent));
    else { const param = new URLSearchParams(location.search).get('data'); let same = null; try { same = param ? new URL(param, location.href) : null; } catch { same = null; }
      // same origin only, decided by the URL parser, and never a scheme in the parameter (as history.js)
      if (param && same && /^https?:$/.test(location.protocol) && same.origin === location.origin && !/^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i.test(param)) { const res = await fetch(same.href, { cache: 'no-store' }); if (!res.ok) throw new Error(`Could not load ${param}: HTTP ${res.status}`); load(await res.json()); } }
  } catch (error) { showEmpty(error.message); return; }
  if (!S.data) { showEmpty(); return; }
  render();
}
root.JitStreams = { S, load, render, setIdx, pin };
if (typeof document !== 'undefined') start();
})(globalThis);
