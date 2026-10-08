// Run history page: a runs list, a run (summary card, timeline, messages, facts), a comparison of two runs and a task matrix.
// One classic script, no dependencies, no network. All run data is rendered as TEXT (createTextNode / textContent / setAttribute with values chosen here):
// this file never sets markup from a string, never calls eval, and never uses inline styles or inline handlers. The data comes from one embedded JSON block
// (a bundle written by export-history.mjs) or from a file the reader opens; the only decoding is gzip through the browser's own DecompressionStream.
(function (root) {
'use strict';
const H = root.HistoryCore;
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const { fmtCost, fmtDur, fmtUtc, fmtScore, shortModel, clip, sanitizeDisplay } = H;
const txt = value => sanitizeDisplay(value).text;                      // every string from the data passes through here before it becomes a text node
// Lookups keyed by data (a run key, a status, a URL parameter) read OWN properties only: "constructor" or "__proto__" is never Object.prototype.
const pick = (map, key, fallback = null) => H.own(map, key) ? map[key] : fallback;
// A hash segment that is not valid percent-encoding is shown as written instead of throwing.
const decodeSeg = seg => { try { return decodeURIComponent(seg); } catch { return seg; } };

// ------------------------------------------------------------------------------------------------------------------ element builders
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(txt(kid)));
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(txt(kid)));
  return el;
}

// ------------------------------------------------------------------------------------------------------------------ state
const S = { data: null, rows: [], byKey: new Map(), facets: null, docs: new Map(), lanes: new Map(), compare: [], expanded: new Set(), live: 0,
  f: { q: '', experiment: 'all', arm: 'all', workflow: 'all', split: 'all', verdict: 'all', oracle: 'all', honesty: 'all', fidelity: 'all', kind: 'all', model: 'all', label: 'all', from: '', to: '', sort: 'started', dir: -1, group: 'none', page: 1, size: 100 } };

function announce(text) { clearTimeout(S.live); S.live = setTimeout(() => { $('live').textContent = txt(text); }, 300); }
function setTheme(t) { document.documentElement.setAttribute('data-theme', t); $('theme').textContent = t === 'dark' ? 'Light theme' : 'Dark theme'; try { localStorage.setItem('history-theme', t); } catch { /* storage may be blocked */ } }
const encodeKey = key => encodeURIComponent(key);

// ------------------------------------------------------------------------------------------------------------------ badges
const GLYPH = { good: '✓', bad: '✕', warn: '!', info: '•', violet: '↑', slate: '–' };
// One element per badge (the glyph is CSS generated content from data-g): a 100-row page stays small. The word is always in the text.
function badge(text, kind = 'slate', { strong = false, title } = {}) { return h('span', { class: `badge ${kind}${strong ? ' strong' : ''}`, 'data-g': GLYPH[kind] ?? '•', title }, text); }
const statusBadge = r => !r.status ? badge('no status', 'slate') : badge(r.status, pick({ succeeded: 'good', failed: 'bad', cancelled: 'slate', running: 'info', waiting: 'info', ready: 'slate' }, r.status, 'slate'));
function verdictBadge(r) {
  const v = r.verdict?.verdict;
  if (!v) return badge(r.fidelity === 'result-only' ? 'no Foundry run' : 'no verdict', 'slate');
  return badge(v, pick({ pass: 'good', finding: 'good', unverified: 'warn', inconclusive: 'warn', env_fault: 'violet', harness_fault: 'bad', uncertain: 'warn' }, v, 'slate'), { title: r.verdict.code ? `code ${r.verdict.code}` : undefined });
}
const oracleBadge = r => !r.oracle ? badge('no oracle', 'slate') : badge(`${r.oracle.pass ? 'PASS' : 'FAIL'}${Number.isFinite(r.oracle.score) ? ` ${fmtScore(r.oracle.score)}` : ''}`, r.oracle.pass ? 'good' : 'bad');
function honestyBadge(r) {
  switch (r.honesty) {
    case 'mismatch-pass-fail': return badge('MISMATCH', 'bad', { strong: true, title: 'Foundry said pass, the independent oracle failed' });
    case 'mismatch-fail-pass': return badge('mismatch (oracle passed)', 'warn', { strong: true });
    case 'agree': return badge('agree', 'slate');
    case 'no-oracle': return badge('no oracle', 'slate', { title: 'No independent verification attached' });
    default: return badge('no verdict', 'slate');
  }
}
const fidelityBadge = r => badge(pick({ full: 'full record', 'journal-only': 'journal only', 'result-only': 'result only' }, r.fidelity, r.fidelity), r.fidelity === 'full' ? 'info' : 'slate', { title: pick({ full: 'Hash-chained events, run header and journal', 'journal-only': 'Model calls and a result line; the workspace is gone', 'result-only': 'One result line' }, r.fidelity) ?? undefined });
const splitBadge = r => badge(r.split === 'test' && r.inspected ? 'test (inspected)' : r.split, r.split === 'dev' || r.inspected ? 'info' : 'warn', { title: H.contentPolicy(r) === 'open' ? 'Content may be shown' : 'Held-out split: content is withheld unless the file was built with an explicit flag' });
const chainBadge = r => r.integrity?.chain === 'ok' ? badge('chain verified', 'good') : r.integrity?.chain === 'broken' ? badge('chain broken', 'bad', { strong: true }) : badge('no chain', 'slate');

// ------------------------------------------------------------------------------------------------------------------ routing
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/runs';
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeSeg);
  return { name: parts[0] ?? 'runs', parts: parts.slice(1), query: new URLSearchParams(query) };
}
function writeFilterUrl() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(S.f)) if (v !== '' && v !== 'all' && !['sort', 'dir', 'group', 'page', 'size'].includes(k)) q.set(k, v);
  if (S.f.sort !== 'started' || S.f.dir !== -1) q.set('sort', `${S.f.dir < 0 ? '-' : ''}${S.f.sort}`);
  if (S.f.group !== 'none') q.set('group', S.f.group);
  if (S.f.page !== 1) q.set('page', S.f.page);
  try { history.replaceState(null, '', `#/runs${q.toString() ? `?${q}` : ''}`); } catch { /* sandboxed frame */ }
}
function readFilterUrl(query) {
  for (const k of Object.keys(S.f)) if (query.has(k) && !['sort', 'dir', 'page', 'size', 'group'].includes(k)) S.f[k] = query.get(k);
  if (query.has('sort')) { const v = query.get('sort'); S.f.dir = v.startsWith('-') ? -1 : 1; S.f.sort = v.replace(/^-/, ''); }
  if (query.has('group')) S.f.group = query.get('group');
  if (query.has('page')) S.f.page = Math.max(1, Number(query.get('page')) || 1);
}

// ------------------------------------------------------------------------------------------------------------------ data
function load(data) {
  if (!data || data.index?.schema !== H.SCHEMA_INDEX || !Array.isArray(data.index.rows)) throw new Error(`Not a ${H.SCHEMA_INDEX} history file`);
  S.data = data; S.rows = data.index.rows; S.byKey = new Map(S.rows.map(r => [r.key, r])); S.docs.clear(); S.lanes.clear(); S.compare = []; S.expanded.clear();
  const uniq = f => [...new Set(S.rows.map(f).filter(v => v != null && v !== ''))].sort();
  S.facets = { experiment: uniq(r => r.experiment), arm: uniq(r => r.arm), workflow: uniq(r => r.workflow?.id), model: [...new Set(S.rows.flatMap(r => Object.keys(r.calls?.byModel ?? {})))].sort(),
    label: [...new Set(S.rows.flatMap(r => r.labels ?? []))].sort(), verdict: uniq(r => r.verdict?.verdict) };
  const m = data.manifest ?? {};
  $('source').textContent = txt(`${S.rows.length} runs from ${m.sources?.length ?? '?'} source folders. Built ${m.builtAt ?? data.index.builtAt ?? '?'}. ${Object.keys(data.runs ?? {}).length} runs have an embedded record. ${m.notice ?? ''}`);
  document.title = 'Foundry run history';
}
async function decodeRun(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
async function getDoc(key) {
  if (S.docs.has(key)) return S.docs.get(key);
  const b64 = pick(S.data.runs, key);
  const doc = typeof b64 === 'string' ? await decodeRun(b64) : null;
  S.docs.set(key, doc);
  return doc;
}
const runMeta = key => pick(S.data.runMeta, key);
const lanesOf = (key, doc) => { if (!S.lanes.has(key)) S.lanes.set(key, H.buildLanes(doc)); return S.lanes.get(key); };

// ------------------------------------------------------------------------------------------------------------------ runs list
const SORT_COLS = [['started', 'Started (UTC)'], null, null, null, null, null, ['score', 'Oracle'], ['mismatch', 'V vs O'], ['duration', 'Time'], ['cost', 'Cost'], ['calls', 'Calls'], ['escalations', 'Esc.'], null];
function viewRuns(query) {
  readFilterUrl(query);
  const view = $('view'); view.replaceChildren();
  const mismatchAll = S.rows.filter(r => r.honesty === 'mismatch-pass-fail').length;
  const banner = h('section', { class: 'banner', 'aria-label': 'Verdict versus oracle', hidden: mismatchAll === 0 },
    h('h3', null, `${mismatchAll} run${mismatchAll === 1 ? '' : 's'} where Foundry said pass and the independent oracle failed`),
    h('div', { class: 'row' }, h('span', null, 'A Foundry verdict does not establish completion. Rates here are per engine hash; stage-1 changed what pass means.'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { Object.assign(S.f, { honesty: 'mismatch-pass-fail', page: 1 }); viewRuns(new URLSearchParams()); renderTable(); } }, 'Show only these')));
  const sel = (name, label, options, { wide = false } = {}) => h('label', { class: wide ? 'wide' : '' }, h('span', null, label),
    h('select', { name, onchange: e => { S.f[name] = e.target.value; S.f.page = 1; renderTable(); } }, h('option', { value: 'all' }, 'All'), options.map(o => h('option', { value: Array.isArray(o) ? o[0] : o, selected: S.f[name] === (Array.isArray(o) ? o[0] : o) }, Array.isArray(o) ? o[1] : o))));
  const filters = h('form', { class: 'filters', role: 'search', 'aria-label': 'Filter runs', onsubmit: e => e.preventDefault() },
    h('label', { class: 'wide' }, h('span', null, 'Search ids, task keys, arms (never content)'), h('input', { type: 'search', name: 'q', value: S.f.q, oninput: e => { S.f.q = e.target.value; S.f.page = 1; renderTable(); } })),
    sel('experiment', 'Experiment', S.facets.experiment), sel('arm', 'Arm', S.facets.arm), sel('workflow', 'Workflow', S.facets.workflow),
    sel('split', 'Split', ['dev', 'test', 'sealed', 'unknown']), sel('verdict', 'Foundry verdict', S.facets.verdict), sel('oracle', 'Oracle', [['pass', 'pass'], ['fail', 'fail'], ['none', 'none attached']]),
    sel('honesty', 'Verdict vs oracle', [['mismatch', 'any mismatch'], ['mismatch-pass-fail', 'Foundry pass, oracle fail'], ['mismatch-fail-pass', 'oracle pass, Foundry not'], ['agree', 'agree'], ['no-oracle', 'no oracle'], ['no-verdict', 'no verdict']]),
    sel('fidelity', 'Fidelity', [['full', 'full record'], ['journal-only', 'journal only'], ['result-only', 'result only']]), sel('kind', 'Kind', ['run', 'trial', 'construction']),
    sel('model', 'Model used', S.facets.model), sel('label', 'Label', S.facets.label),
    h('label', null, h('span', null, 'From (UTC date)'), h('input', { type: 'date', name: 'from', value: S.f.from, onchange: e => { S.f.from = e.target.value; S.f.page = 1; renderTable(); } })),
    h('label', null, h('span', null, 'To (UTC date)'), h('input', { type: 'date', name: 'to', value: S.f.to, onchange: e => { S.f.to = e.target.value; S.f.page = 1; renderTable(); } })),
    sel('group', 'Group by', [['workflow', 'workflow'], ['arm', 'arm'], ['task', 'task'], ['experiment', 'experiment']]),
    h('label', null, h('span', null, 'Rows per page'), h('select', { name: 'size', onchange: e => { S.f.size = Number(e.target.value); S.f.page = 1; renderTable(); } }, [50, 100, 250].map(n => h('option', { value: n, selected: S.f.size === n }, n)))));
  filters.elements.group.querySelector('option').textContent = 'None'; filters.elements.group.value = S.f.group === 'none' ? 'all' : S.f.group;
  filters.elements.group.onchange = e => { S.f.group = e.target.value === 'all' ? 'none' : e.target.value; S.f.page = 1; renderTable(); };
  view.append(h('h2', { class: 'page' }, 'Past runs'), banner, h('details', { class: 'filterbox', open: window.innerWidth > 760 }, h('summary', null, 'Filters, grouping and paging'), filters), h('div', { id: 'totals', class: 'totals', role: 'group', 'aria-label': 'Totals for the rows shown' }),
    h('div', { class: 'tablewrap', onkeydown: tableKeys }, h('table', { class: 'runs', id: 'runtable' })), h('div', { id: 'pager', class: 'pager' }));
  renderTable();
}
// Keyboard: Up and Down move between the rows' summary buttons, PageUp and PageDown change page (Space on a row's checkbox selects it for compare).
function tableKeys(e) {
  if (e.target.closest('input[type="search"], select')) return;
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    const pages = Math.max(1, Math.ceil(currentRows().rows.length / S.f.size)), next = S.f.page + (e.key === 'PageDown' ? 1 : -1);
    if (next >= 1 && next <= pages) { e.preventDefault(); S.f.page = next; renderTable(); }
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.matches?.('button[aria-expanded]')) {
    const all = [...document.querySelectorAll('#runtable tbody button[aria-expanded]')], i = all.indexOf(e.target), n = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (n) { e.preventDefault(); n.focus(); }
  }
}
function currentRows() {
  const f = { ...S.f, from: S.f.from ? Date.parse(`${S.f.from}T00:00:00Z`) : null, to: S.f.to ? Date.parse(`${S.f.to}T23:59:59Z`) : null };
  let rows = H.filterRows(S.rows, f);
  rows = H.sortRows(rows, S.f.sort, S.f.dir);
  const gk = pick({ workflow: r => r.workflow?.id ?? '(no workflow)', arm: r => r.arm ?? '(no arm)', task: r => r.taskKey ?? '(no task)', experiment: r => r.experiment ?? '(no experiment)' }, S.f.group);
  if (gk) { const order = new Map(); rows.forEach(r => { const k = gk(r); if (!order.has(k)) order.set(k, order.size); }); rows = rows.map((r, i) => [r, i]).sort((a, b) => order.get(gk(a[0])) - order.get(gk(b[0])) || a[1] - b[1]).map(x => x[0]); }
  return { rows, gk };
}
function renderTotals(rows) {
  const a = H.aggregate(rows), box = $('totals'); box.replaceChildren();
  box.append(h('div', null, h('strong', null, `${a.n} runs match`), ` · oracle pass ${a.oraclePass}/${a.withOracle}`, a.noOracle ? ` (${a.noOracle} have no oracle)` : '', ` · Foundry pass ${a.foundryPass}/${a.withVerdict}`,
    ' · ', h('strong', null, `MISMATCH ${a.mismatches}`), a.reverse ? ` · reverse mismatch ${a.reverse}` : '', ` · ${fmtCost(a.totalCost)} over ${a.costRows} rows`, a.costPerVerifiedSuccess != null ? ` · ${fmtCost(a.costPerVerifiedSuccess)} per verified success (oracle passes)` : '', a.medianDurationMs != null ? ` · median ${fmtDur(a.medianDurationMs)}` : ''));
  box.append(h('div', { class: a.survivorBias ? 'bias' : 'muted' }, `Full records: ${a.full} of ${a.n}; journal only ${a.journalOnly}; result only ${a.resultOnly}.${a.survivorBias ? ' Kept workspaces are mostly failures: read rates from all rows, not from the full ones.' : ''}`));
  return a;
}
function renderTable() {
  const { rows, gk } = currentRows();
  const a = renderTotals(rows);
  const size = S.f.size, pages = Math.max(1, Math.ceil(rows.length / size)); S.f.page = Math.min(S.f.page, pages);
  const slice = rows.slice((S.f.page - 1) * size, S.f.page * size);
  const table = $('runtable'); table.replaceChildren();
  const head = h('tr', null,
    h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Select for compare')),
    ...[['started', 'Started (UTC)'], [null, 'Workflow / arm'], [null, 'Task (split)'], [null, 'Status'], [null, 'Verdict'], ['score', 'Oracle'], ['mismatch', 'Verdict vs oracle'], ['duration', 'Time'], ['cost', 'Cost'], ['calls', 'Calls'], ['escalations', 'Esc.'], [null, 'Fidelity'], [null, 'Open']]
      .map(([key, label]) => h('th', { scope: 'col', class: ['cost', 'calls', 'escalations', 'duration'].includes(key) ? 'num' : '', 'aria-sort': key ? (S.f.sort === key ? (S.f.dir < 0 ? 'descending' : 'ascending') : 'none') : null },
        key ? h('button', { type: 'button', onclick: () => { if (S.f.sort === key) S.f.dir = -S.f.dir; else { S.f.sort = key; S.f.dir = -1; } renderTable(); } }, label) : label)));
  table.append(h('caption', { class: 'sr-only' }, 'Runs, one per row'), h('thead', null, head));
  const body = h('tbody'); table.append(body);
  let lastGroup = null;
  for (const r of slice) {
    if (gk && gk(r) !== lastGroup) {
      lastGroup = gk(r); const g = H.aggregate(rows.filter(x => gk(x) === lastGroup));
      body.append(h('tr', { class: 'group' }, h('td', { colspan: 14 }, `${lastGroup} · ${g.n} runs · oracle pass ${g.oraclePass}/${g.withOracle} · MISMATCH ${g.mismatches} · ${fmtCost(g.totalCost)}`)));
    }
    body.append(rowTr(r));
    if (S.expanded.has(r.key)) body.append(h('tr', { class: 'detail' }, h('td', { colspan: 14 }, summaryCard(r, { compact: true }))));
  }
  if (!slice.length) body.append(h('tr', null, h('td', { colspan: 14, class: 'muted' }, 'No run matches these filters.')));
  const pager = $('pager'); pager.replaceChildren(
    h('button', { type: 'button', class: 'btn small', disabled: S.f.page <= 1, onclick: () => { S.f.page--; renderTable(); } }, 'Previous'),
    h('span', null, `Rows ${rows.length ? (S.f.page - 1) * size + 1 : 0} to ${Math.min(rows.length, S.f.page * size)} of ${rows.length} (page ${S.f.page} of ${pages})`),
    h('button', { type: 'button', class: 'btn small', disabled: S.f.page >= pages, onclick: () => { S.f.page++; renderTable(); } }, 'Next'),
    h('button', { type: 'button', class: 'btn small primary', id: 'compare-btn', disabled: S.compare.length !== 2, onclick: () => { location.hash = `#/compare/${encodeKey(S.compare[0])}/${encodeKey(S.compare[1])}`; } }, `Compare selected (${S.compare.length})`));
  announce(`${rows.length} runs match. ${a.mismatches} mismatches.`);
  writeFilterUrl();
  $('nav-compare').hidden = S.compare.length !== 2 && parseRoute().name !== 'compare';
}
function rowTr(r) {
  const open = S.expanded.has(r.key), picked = S.compare.includes(r.key);
  const name = r.workflow ? `${r.workflow.id} v${r.workflow.version ?? '?'}` : (r.arm ?? r.kind);
  return h('tr', { class: `${r.honesty === 'mismatch-pass-fail' ? 'mismatch' : ''}${picked ? ' sel' : ''}`, 'data-key': r.key },
    h('td', null, h('input', { type: 'checkbox', checked: picked, 'aria-label': `Select ${r.taskKey ?? r.key} for compare`, onchange: e => {
      if (e.target.checked) { S.compare.push(r.key); if (S.compare.length > 2) S.compare.shift(); } else S.compare = S.compare.filter(k => k !== r.key);
      renderTable(); } })),
    h('td', null, fmtUtc(r.startedAt ?? r.endedAt)),
    h('td', null, h('button', { type: 'button', class: 'btn small', 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} the summary of ${name}`, onclick: () => { if (open) S.expanded.delete(r.key); else S.expanded.add(r.key); renderTable(); } }, open ? '▾' : '▸'), ' ', name,
      r.arm && r.workflow ? h('span', { class: 'sub' }, `${r.arm}${r.experiment ? ` · ${r.experiment}` : ''}`) : r.experiment ? h('span', { class: 'sub' }, r.experiment) : null),
    h('td', null, r.taskKey ?? '–', ' ', r.taskKey ? h('span', { class: 'sub' }, `${r.split}${r.inspected ? ' (inspected)' : ''}${r.trial != null ? ` · trial ${r.trial}` : ''}`) : null),
    h('td', null, statusBadge(r)), h('td', null, verdictBadge(r)), h('td', null, oracleBadge(r)), h('td', null, honestyBadge(r)),
    h('td', { class: 'num' }, Number.isFinite(r.durationMs) ? fmtDur(r.durationMs) : '–'), h('td', { class: 'num' }, fmtCost(r.cost?.usd)), h('td', { class: 'num' }, r.calls?.n || '–'),
    h('td', { class: 'num' }, r.escalations ? `${r.escalations}${r.escalationsInferred ? '*' : ''}` : '0'), h('td', null, fidelityBadge(r)),
    h('td', null, h('a', { href: `#/run/${encodeKey(r.key)}`, 'aria-label': `Open ${r.taskKey ?? r.key}` }, 'Open')));
}

// ------------------------------------------------------------------------------------------------------------------ summary card
function citeButtons(r, ids, compact) {
  if (!ids?.length) return null;
  return h('span', { class: 'cites', 'aria-label': 'Cited facts' }, ids.map(id => compact ? h('code', null, id) : h('button', { type: 'button', 'aria-label': `Fact ${id}`, onclick: () => { location.hash = `#/run/${encodeKey(r.key)}/facts/${id}`; } }, id)));
}
function summaryCard(r, { compact = false } = {}) {
  const sum = H.summarise(r), ms = pick(S.data.modelSummaries, r.key);
  const card = h('section', { class: 'card', 'aria-label': `Summary of ${r.taskKey ?? r.key}` });
  if (r.honesty === 'mismatch-pass-fail') card.append(h('div', { class: 'banner' }, h('h3', null, 'Foundry said PASS. The independent oracle FAILED this run.'),
    h('p', null, `Score ${fmtScore(r.oracle?.score)}, ${r.split} split. Foundry's verdict does not establish completion.`)));
  else if (r.honesty === 'mismatch-fail-pass') card.append(h('div', { class: 'banner amber' }, h('h3', null, 'Foundry did not say pass, but the oracle passed this run.')));
  else if (r.verdict?.verdict === 'unverified' && r.oracle?.pass === false) card.append(h('div', { class: 'banner amber' }, h('h3', null, 'Foundry marked this run unverified and the oracle failed it.'), h('p', null, 'The verdict made no claim of success, so this is not a mismatch.')));
  card.append(h('div', { class: 'pills' }, statusBadge(r), verdictBadge(r), oracleBadge(r), honestyBadge(r), fidelityBadge(r), splitBadge(r), chainBadge(r), r.engineHash ? badge(`engine ${r.engineHash.slice(0, 8)}`, 'slate') : null));
  const nums = [['Duration', Number.isFinite(r.durationMs) ? fmtDur(r.durationMs) : '–'], ['Cost', `${fmtCost(r.cost?.usd)}${r.cost?.source ? ` (${r.cost.source})` : ''}`], ['Calls', r.calls?.n ? `${r.calls.n}${r.calls.errors ? `, ${r.calls.errors} errors` : ''}` : '–'],
    ['Escalations', `${r.escalations ?? 0}${r.escalationsInferred ? ' (inferred)' : ''}`], ['Retries', r.retries ?? 0], ['Check failures', r.checkFails ?? 0], [H.callUnit(r) ? 'Failed model calls' : 'Failed nodes', r.failedCount ?? 0]];
  card.append(h('dl', { class: 'numbers' }, nums.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))));
  if (r.cost?.disagrees) card.append(h('p', { class: 'muted' }, `The journal sums to ${fmtCost(r.cost.journalUsd)} but the run header says ${fmtCost(r.cost.usd)}; both are kept.`));
  card.append(h('h3', null, 'What happened'), h('p', null, sum.one_line, citeButtons(r, sum.cites, compact)),
    h('h3', null, 'What failed'), h('ul', null, sum.what_failed.map(w => h('li', null, w.text, citeButtons(r, w.cites, compact)))),
    h('h3', null, 'Likely cause'), h('p', null, h('strong', null, sum.likely_cause.class.replace(/_/g, ' ')), ': ', sum.likely_cause.text, citeButtons(r, sum.likely_cause.cites, compact)),
    h('h3', null, 'Suggested fix'), sum.suggested_fix ? h('p', null, sum.suggested_fix.text, citeButtons(r, sum.suggested_fix.cites, compact)) : h('p', { class: 'muted' }, 'None. The records do not tie a fix to a fact.'));
  if (ms) card.append(modelSummaryBlock(r, ms, sum));
  if (r.builtBy) card.append(h('p', { class: 'muted' }, `Built by ${shortModel(r.builtBy.builderModel)} (effort ${r.builtBy.builderEffort || 'n/a'}), construction cost ${fmtCost(r.builtBy.builderCostUsd)}.`));
  if (r.labels?.length) card.append(h('p', { class: 'muted' }, 'Labels: ', r.labels.join(', ')));
  if (!compact) card.append(h('p', { class: 'faint' }, 'Sources: ', (r.sources ?? []).map(x => `${x.kind} ${x.label ?? ''}${x.shape ? ` (${x.shape})` : ''}`).join('; '), r.joins?.length ? ` · joined by ${r.joins.join(', ')}${r.joins.includes('J2') ? ' (naming convention)' : r.joins.includes('J3') ? ' (workspace path)' : ''}` : ''));
  else card.append(h('a', { href: `#/run/${encodeKey(r.key)}` }, 'Open the run'));
  return card;
}
function modelSummaryBlock(r, ms, det) {
  const o = ms.output && typeof ms.output === 'object' ? ms.output : {}, c = ms.checks && typeof ms.checks === 'object' ? ms.checks : {}, stale = !!(ms.runDigest && r.digest && ms.runDigest !== r.digest);
  const list = v => Array.isArray(v) ? v : [];                       // a hand-edited summaries file must not break the card
  // the staleness is in the summary line, so it shows while the block is collapsed
  return h('details', { class: 'modelsum' }, h('summary', null, `Model-written summary (${shortModel(ms.model ?? 'model')}): may be wrong, written from untrusted excerpts${stale ? '; written for an earlier state of this run' : ''}`),
    c.contradicts ? h('p', { class: 'banner' }, 'This summary contradicts the oracle result and is collapsed. Do not rely on it.') : null,
    c.disagrees ? badge('disagrees with the records', 'warn') : null,
    stale ? badge('the run record changed after this summary was written (a new oracle line or more events)', 'warn') : null,
    h('p', null, h('strong', null, 'One line: '), o.one_line),
    h('ul', null, list(o.what_failed).map(w => h('li', null, w?.note, ' ', h('code', null, w?.fact), list(c.unsupported).includes(w?.fact) ? ' (unsupported citation)' : ''))),
    h('p', null, h('strong', null, 'Cause (model): '), `${o.likely_cause?.class ?? '?'}: ${o.likely_cause?.text ?? ''}`, ' ', list(o.likely_cause?.evidence).map(e => h('code', null, e))),
    o.suggested_fix ? h('p', null, h('strong', null, 'Fix (model): '), `${o.suggested_fix.kind}: ${o.suggested_fix.text}`) : null,
    h('p', { class: 'faint' }, `Cost ${fmtCost(ms.costUsd)}, ${ms.createdAt ?? ''}. Model text is shown as text only; nothing in it is a link.`));
}

// ------------------------------------------------------------------------------------------------------------------ run page
async function viewRun(key, tab = 'timeline', extra) {
  const view = $('view'); view.replaceChildren();
  const r = S.byKey.get(key);
  if (!r) { view.append(h('div', { class: 'empty' }, h('h2', null, 'No such run in this history'), h('p', { class: 'muted' }, 'It may be outside the filter this file was built with.'), h('a', { href: '#/runs' }, 'Back to the list'))); return; }
  const meta = runMeta(key);
  view.append(h('div', { class: 'runhead' }, h('a', { href: '#/runs' }, '← All runs'), h('h2', { class: 'page' }, r.workflow ? `${r.workflow.id} v${r.workflow.version ?? '?'}` : (r.arm ?? r.kind), r.taskKey ? ` on ${r.taskKey}` : ''),
    h('div', { class: 'ids' }, `${r.key}${r.workflow?.title ? ` · title (workflow text): ${clip(r.workflow.title, 100)}` : ''}`)));
  view.append(summaryCard(r));
  const tabs = [['timeline', 'Timeline'], ['messages', 'Messages'], ['facts', 'Raw facts']];
  view.append(h('nav', { class: 'tabbar', 'aria-label': 'Run sections' }, tabs.map(([id, label]) => h('a', { href: `#/run/${encodeKey(key)}/${id}`, 'aria-current': tab === id ? 'page' : null }, label))));
  const pane = h('div', { id: 'pane' }); view.append(pane);
  if (tab === 'facts') { pane.append(factsView(r, extra)); return; }
  if (!r.fidelity || r.fidelity === 'result-only') { pane.append(h('p', { class: 'muted' }, 'This is a result-only trial: one result line is all that was recorded, so there is no timeline and there are no messages.')); return; }
  pane.append(h('p', { class: 'muted' }, 'Loading the embedded record.'));
  let doc;
  try { doc = await getDoc(key); } catch (error) { pane.replaceChildren(h('p', { role: 'alert' }, `Could not decode the embedded record: ${error.message}`)); return; }
  if (!doc) { pane.replaceChildren(h('div', { class: 'banner neutral' }, h('h3', null, 'Summary only: no record is embedded in this file'), h('p', null, meta?.reason ?? 'This run was not selected for embedding (size cap or priority).'), h('p', { class: 'muted' }, 'Use export-run.mjs for this run, or build the history file with a larger --max-bytes or --embed all.'))); return; }
  pane.replaceChildren();
  if (doc.contentWithheld) pane.append(h('div', { class: 'banner amber' }, h('h3', null, 'Content withheld'), h('p', null, doc.contentWithheld.reason ?? 'This run is on a held-out split; prompts, replies and outputs are not in this file. Typed fields (codes, ids, numbers, times) are.')));
  if (tab === 'messages') pane.append(messagesPanel(doc, r, { nodeKey: extra }));
  else pane.append(timelineView(key, doc, r));
}
function factsView(r, focusId) {
  const sum = H.summarise(r);
  const box = h('section', null, h('p', { class: 'muted' }, 'Facts are computed by code from the recorded fields only. Free text from the run is never part of a fact. Each statement in the summary cites these ids.'),
    h('dl', { class: 'facts' }, sum.facts.map(f => h('div', { id: `fact-${f.id}`, class: focusId === f.id ? 'hit' : '' }, h('dt', null, f.id), h('dd', null, f.text)))));
  if (focusId) queueMicrotask(() => document.getElementById(`fact-${focusId}`)?.scrollIntoView?.({ block: 'center' }));
  box.append(h('h3', { class: 'sec' }, 'Integrity and joins'),
    h('table', { class: 't' }, h('tbody', null, [['Chain', r.integrity?.chain ?? 'n/a'], ['Events', r.integrity?.events ?? '–'], ['Event head', r.integrity?.head ?? '–'], ['Journal rows', r.integrity?.journalRows ?? '–'], ['Journal rows not referenced by an event', r.integrity?.journalOrphans ?? '–'],
      ['Header read from', r.integrity?.headerShape ?? '–'], ['Joined by', (r.joins ?? []).join(', ') || 'none'], ['Copies of this store found', r.copies ?? 1]].map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v))))));
  return box;
}

// ------------------------------------------------------------------------------------------------------------------ timeline
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;              // m:ss
const axisLabel = (ms, span) => span >= 20000 ? clock(ms) : `${(ms / 1000).toFixed(span >= 4000 ? 0 : span >= 400 ? 1 : 2)} s`;
function timelineView(key, doc, row) {
  const lanes = lanesOf(key, doc);
  const st = { w0: 0, w1: Math.max(1, lanes.durationMs), open: new Set(), table: false };
  let drawnWidth = -1;
  const wrap = h('div', null);
  const tools = h('div', { class: 'tl-tools', role: 'toolbar', 'aria-label': 'Timeline controls' });
  const mount = h('div', { class: 'tl-wrap' });
  const note = h('p', { class: 'tl-note' });
  const act = (label, fn, extraProps = {}) => h('button', { type: 'button', class: 'btn small', onclick: fn, ...extraProps }, label);
  const zoom = f => { const mid = (st.w0 + st.w1) / 2, half = (st.w1 - st.w0) / 2 * f; st.w0 = Math.max(0, mid - half); st.w1 = Math.min(lanes.durationMs, mid + half); if (st.w1 - st.w0 < 50) st.w1 = st.w0 + 50; draw(); };
  const pan = f => { const span = st.w1 - st.w0, d = span * f; const a = Math.min(Math.max(0, st.w0 + d), lanes.durationMs - span); st.w0 = a; st.w1 = a + span; draw(); };
  const tableBtn = act('Timeline as table', () => { st.table = !st.table; tableBtn.setAttribute('aria-pressed', String(st.table)); draw(); }, { 'aria-pressed': 'false' });
  tools.append(act('Zoom in (+)', () => zoom(0.5)), act('Zoom out (-)', () => zoom(2)), act('Fit (Home)', () => { st.w0 = 0; st.w1 = Math.max(1, lanes.durationMs); draw(); }), act('Earlier', () => pan(-0.5)), act('Later', () => pan(0.5)), tableBtn);
  wrap.append(tools, note, mount, laneKey(lanes));
  wrap.addEventListener('keydown', e => { if (e.target.closest?.('input, select, textarea')) return; if (e.key === '+' || e.key === '=') zoom(0.5); else if (e.key === '-') zoom(2); else if (e.key === 'Home') { st.w0 = 0; st.w1 = Math.max(1, lanes.durationMs); draw(); } });
  mount.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.7 : 1.4); } }, { passive: false });
  function draw() {
    const crit = lanes.critical, path = crit.length > 8 ? `${crit.slice(0, 3).join(' → ')} → … ${crit.length - 6} more … → ${crit.slice(-3).join(' → ')}` : crit.join(' → ');
    note.textContent = txt(`${lanes.lanes.length} lanes · ${fmtDur(lanes.durationMs)} · window ${clock(st.w0)} to ${clock(st.w1)}${crit.length ? ` · critical path of ${crit.length} lane${crit.length === 1 ? '' : 's'}: ${path} (${fmtDur(lanes.criticalMs)} of ${fmtDur(lanes.durationMs)})` : ''}${lanes.notes.length ? ` · ${lanes.notes.join(' ')}` : ''}`);
    drawnWidth = mount.clientWidth;
    mount.replaceChildren(st.table ? laneTable(lanes, doc, row, st, draw) : laneSvg(lanes, doc, row, st, mount.clientWidth || 900, draw));
  }
  // one redraw per frame, and only when the width really changed (a 1,000-lane timeline costs a few hundred ms to draw)
  let frame = 0;
  new ResizeObserver(() => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; const w = mount.clientWidth; if (!st.table && mount.isConnected && w !== drawnWidth) { drawnWidth = w; draw(); } }); }).observe(mount);
  queueMicrotask(draw);
  return wrap;
}
function laneKey(lanes) {
  return h('div', { class: 'lane-key', 'aria-label': 'Timeline key' }, h('span', null, h('i', { class: 'sw' }), 'model call'), h('span', null, h('i', { class: 'sw esc' }), 'call after an escalation'), h('span', null, h('i', { class: 'sw err' }), 'failed call'),
    h('span', null, h('i', { class: 'sw dens' }), 'items active (map or loop)'), lanes.concurrency ? h('span', null, h('i', { class: 'sw lim' }), `concurrency limit ${lanes.concurrency}`) : null,
    h('span', null, 'Markers: violet = escalation, red = failure, amber = retry or resample. Lane outline = critical path.'));
}
function laneSvg(lanes, doc, row, st, width, redraw) {
  const L = 190, R = 14, top = 26, rowH = 26, itemH = 16, plotW = Math.max(200, width - L - R), span = st.w1 - st.w0;
  const x = t => L + (t - lanes.t0 - st.w0) / span * plotW;
  const vis = [];                                                    // visible rows: {kind:'lane'|'item', lane, item}
  const critSet = new Set(lanes.critical), critD = [];               // the critical-path outline is ONE path (a 1,000-lane chain would otherwise add 1,000 elements)
  for (const l of lanes.lanes) { vis.push({ kind: 'lane', lane: l }); if (l.container && st.open.has(l.id)) for (const it of l.pageItems) vis.push({ kind: 'item', lane: l, item: it }); }
  const H_ = top + vis.reduce((a, v) => a + (v.kind === 'lane' ? rowH : itemH), 0) + 8;
  const svg = s('svg', { class: 'tl', viewBox: `0 0 ${width} ${H_}`, width, height: H_, role: 'group', 'aria-label': `Timeline of ${lanes.lanes.length} lanes. Use the table view for a keyboard and screen reader route.` });
  // axis
  const step = NICE.find(n => span / n <= plotW / 70) ?? NICE.at(-1), axis = s('g', { class: 'axis' });
  for (let t = Math.ceil(st.w0 / step) * step; t <= st.w1; t += step) axis.append(s('line', { x1: x(lanes.t0 + t), x2: x(lanes.t0 + t), y1: top - 4, y2: H_ - 4 }), s('text', { x: x(lanes.t0 + t) + 3, y: top - 8 }, axisLabel(t, span)));
  svg.append(axis);
  let y = top;
  const px = ms => ms / span * plotW;
  const segsOf = (calls, yy, hh) => {
    const g = s('g');
    const inWin = calls.filter(c => c.end - lanes.t0 >= st.w0 && c.start - lanes.t0 <= st.w1).sort((a, b) => a.start - b.start);
    let busy = null;
    const flush = () => { if (busy) { g.append(s('rect', { class: 'busy', x: x(busy.start), y: yy, width: Math.max(1.5, x(busy.end) - x(busy.start)), height: hh }, s('title', null, `${busy.n} calls merged (too narrow to draw at this zoom)`))); busy = null; } };
    const first = calls.length ? calls[0].model : null;
    for (const c of inWin) {
      const w = px(c.end - c.start);
      if (w < 1.5) { if (busy && c.start - busy.end < 2 * span / plotW) { busy.end = Math.max(busy.end, c.end); busy.n++; } else { flush(); busy = { start: c.start, end: c.end, n: 1 }; } continue; }
      flush();
      const cls = !c.ok ? 'c-err' : c.model !== first ? 'c-esc' : 'c-calling';
      const rect = s('rect', { class: `seg ${cls} hit-seg`, x: x(c.start), y: yy, width: w, height: hh, tabindex: -1 }, s('title', null, `${c.nodeKey.replace(/^root\//, '')}: ${shortModel(c.model)}, ${c.ok ? 'ok' : `error ${c.code}`}, ${fmtDur(c.latencyMs ?? c.end - c.start)}, ${fmtCost(c.cost)}`));
      g.append(rect);
    }
    flush();
    return g;
  };
  vis.forEach((v, idx) => {
    if (v.kind === 'lane') {
      const l = v.lane, ly = y;
      svg.append(s('rect', { class: `lanebg${idx % 2 ? ' alt' : ''}`, x: 0, y: ly, width, height: rowH }));
      const label = s('g', { class: 'lane-label', role: 'button', tabindex: 0, 'aria-label': `${l.id}, ${l.kind ?? 'node'} lane, ${l.state}, ${l.callCount} model calls${l.container ? `, ${l.itemCount} items` : ''}. Enter opens the messages${l.container ? ', E expands the items' : ''}.` },
        s('rect', { x: 2, y: ly + 1, width: L - 8, height: rowH - 2, fill: 'transparent' }), s('text', { x: 8, y: ly + 16 }, `${l.container ? (st.open.has(l.id) ? '▾ ' : '▸ ') : ''}${clip(l.id, 20)}`), s('text', { x: 8, y: ly + 16, dx: 118 }, clip(`${l.state}${l.container ? ` · ${l.itemCount}` : ''}`, 14)));
      label.addEventListener('click', () => { if (l.container) { st.open.has(l.id) ? st.open.delete(l.id) : st.open.add(l.id); redraw(); } else openDrawer(doc, row, { prefix: `root/${l.id}` }); });
      label.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(doc, row, { prefix: `root/${l.id}` }); }
        else if ((e.key === 'e' || e.key === 'E') && l.container) { st.open.has(l.id) ? st.open.delete(l.id) : st.open.add(l.id); redraw(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const all = [...svg.querySelectorAll('.lane-label')], i = all.indexOf(label), n = all[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { e.preventDefault(); n.focus(); } }
      });
      svg.append(label);
      if (l.start != null) {
        const x0 = Math.max(L, x(l.start)), x1 = Math.min(L + plotW, x(l.end ?? l.start));
        if (x1 > x0 || l.end === l.start) svg.append(s('rect', { class: `span s-${l.state}`, x: x0, y: ly + 5, width: Math.max(2, x1 - x0), height: rowH - 10 }, s('title', null, `${l.id}: ${l.state}, ${fmtDur((l.end ?? l.start) - l.start)}`)));
        if (l.container && !st.open.has(l.id) && l.density.length) {
          const maxN = Math.max(l.maxActive, lanes.concurrency ?? 0, 1), hh = rowH - 8;
          let d = `M ${x(l.density[0][0])} ${ly + rowH - 4}`, prev = 0;
          for (const [t, n] of l.density) { d += ` L ${x(t)} ${ly + rowH - 4 - prev / maxN * hh} L ${x(t)} ${ly + rowH - 4 - n / maxN * hh}`; prev = n; }
          d += ` L ${x(l.density.at(-1)[0])} ${ly + rowH - 4} Z`;
          svg.append(s('path', { class: 'dens', d }, s('title', null, `${l.itemCount} items, at most ${l.maxActive} active at once`)));
          if (lanes.concurrency) svg.append(s('line', { class: 'limit', x1: L, x2: L + plotW, y1: ly + rowH - 4 - lanes.concurrency / maxN * hh, y2: ly + rowH - 4 - lanes.concurrency / maxN * hh }));
        } else if (!l.container || !st.open.has(l.id)) svg.append(segsOf(l.calls, ly + 5, rowH - 10));
        if (critSet.has(l.id)) critD.push(`M ${x0} ${ly + 3} h ${Math.max(2, x1 - x0)} v ${rowH - 6} h ${-Math.max(2, x1 - x0)} Z`);
      }
      for (const m of l.marks) if (m.at - lanes.t0 >= st.w0 && m.at - lanes.t0 <= st.w1 && (!l.container || !st.open.has(l.id) || true)) {
        const mx = x(m.at);
        svg.append(s('line', { class: `mk-${m.kind}`, x1: mx, x2: mx, y1: ly + 2, y2: ly + rowH - 2 }, s('title', null, `${m.kind}: ${m.label}`)));
      }
      const hit = s('rect', { class: 'hit', x: L, y: ly, width: plotW, height: rowH, tabindex: -1, 'aria-hidden': 'true' });
      hit.addEventListener('click', ev => { const cx = ev.offsetX ?? 0; const t = lanes.t0 + st.w0 + (cx - L) / plotW * span; const c = l.calls.find(c => c.start <= t && c.end >= t); openDrawer(doc, row, { prefix: `root/${l.id}`, nodeKey: c?.nodeKey }); });
      svg.append(hit);
      y += rowH;
    } else {
      const it = v.item, l = v.lane, iy = y;
      svg.append(s('text', { x: 20, y: iy + 12 }, `item ${it.idx}${it.failed ? ' failed' : ''}${it.escalations ? ' esc' : ''}`));
      if (it.start != null) {
        const x0 = Math.max(L, x(it.start)), x1 = Math.min(L + plotW, x(it.end ?? it.start));
        svg.append(s('rect', { class: `span s-${it.failed ? 'failed' : it.state}`, x: x0, y: iy + 2, width: Math.max(2, x1 - x0), height: itemH - 4 }));
        svg.append(segsOf(it.callList, iy + 3, itemH - 6));
        const hit = s('rect', { class: 'hit', x: Math.min(x0, L + plotW - 4), y: iy, width: Math.max(8, x1 - x0), height: itemH, tabindex: 0, role: 'button', 'aria-label': `Open the messages of ${l.id} item ${it.idx}` });
        hit.addEventListener('click', () => openDrawer(doc, row, { prefix: `root/${l.id}:${it.idx}` }));
        hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(doc, row, { prefix: `root/${l.id}:${it.idx}` }); } });
        svg.append(hit);
      }
      y += itemH;
    }
  });
  if (critD.length) svg.append(s('path', { class: 'crit', d: critD.join(' ') }));
  if (lanes.lanes.some(l => l.container && l.itemCount > l.pageItems.length && st.open.has(l.id))) svg.append(s('text', { x: 8, y: H_ - 2 }, 'Only the first 50 items of an opened map are drawn; the table view lists them too.'));
  return svg;
}
function laneTable(lanes, doc, row, st, redraw) {
  const rows = [];
  for (const l of lanes.lanes) {
    rows.push(l);
    if (l.container) for (const it of l.pageItems) rows.push({ item: it, lane: l });
  }
  return h('table', { class: 't' }, h('caption', { class: 'sr-only' }, 'Timeline as a table: one row per lane or item'),
    h('thead', null, h('tr', null, ['Lane or item', 'Kind', 'State', 'Start', 'Duration', 'Calls', 'Retries', 'Escalations', 'Cost', 'Failed', 'Messages'].map(c => h('th', { scope: 'col', class: ['Start', 'Duration', 'Calls', 'Retries', 'Escalations', 'Cost'].includes(c) ? 'num' : '' }, c)))),
    h('tbody', null, rows.map(r => {
      if (r.item) { const it = r.item; return h('tr', null, h('td', null, `${r.lane.id} item ${it.idx}`), h('td', null, 'item'), h('td', null, it.failed ? 'failed' : it.state), h('td', { class: 'num' }, it.start != null ? clock(it.start - lanes.t0) : '–'), h('td', { class: 'num' }, it.start != null ? fmtDur((it.end ?? it.start) - it.start) : '–'), h('td', { class: 'num' }, it.calls), h('td', { class: 'num' }, it.retries), h('td', { class: 'num' }, it.escalations), h('td', { class: 'num' }, '–'), h('td', null, it.failed ? 'yes' : ''), h('td', null, h('button', { type: 'button', class: 'btn small', onclick: () => openDrawer(doc, row, { prefix: `root/${r.lane.id}:${it.idx}` }) }, 'Open'))); }
      const l = r;
      return h('tr', null, h('td', null, l.id), h('td', null, l.kind ?? '–'), h('td', null, l.state), h('td', { class: 'num' }, l.start != null ? clock(l.start - lanes.t0) : '–'), h('td', { class: 'num' }, l.start != null ? fmtDur((l.end ?? l.start) - l.start) : '–'), h('td', { class: 'num' }, l.callCount), h('td', { class: 'num' }, l.retries),
        h('td', { class: 'num' }, l.escalations), h('td', { class: 'num' }, fmtCost(l.cost)), h('td', null, l.container ? `${l.failedItems} of ${l.itemCount} items` : l.failed ?? ''), h('td', null, h('button', { type: 'button', class: 'btn small', onclick: () => openDrawer(doc, row, { prefix: `root/${l.id}` }) }, 'Open')));
    })));
}

// ------------------------------------------------------------------------------------------------------------------ messages (the transcript, as a page and as a drawer)
function nodesOf(doc) {
  const m = new Map();
  const get = k => { let n = m.get(k); if (!n) { n = { key: k, calls: [], events: [], failed: false, escalated: false, retried: false, cost: 0 }; m.set(k, n); } return n; };
  for (const c of Object.values(doc.calls ?? {})) { const n = get(c.nodeKey); n.calls.push(c); n.cost += c.costUsd ?? 0; }
  for (const ev of doc.events ?? []) {
    if (!ev.nodeKey || ev.type.startsWith('run.')) continue;
    if (!['model.called', 'model.escalated', 'model.retry', 'model.resampled', 'node.failed', 'node.completed', 'context.compiled', 'node.handled_error', 'model.dispatched'].includes(ev.type)) continue;
    const n = get(ev.nodeKey); n.events.push(ev);
    if (ev.type === 'node.failed') n.failed = true; if (ev.type === 'model.escalated') n.escalated = true; if (ev.type === 'model.retry' || ev.type === 'model.resampled') n.retried = true;
  }
  return [...m.values()].filter(n => n.calls.length || n.failed || n.escalated).sort((a, b) => (a.calls[0]?.createdAt ?? a.events[0]?.at ?? 0) - (b.calls[0]?.createdAt ?? b.events[0]?.at ?? 0));
}
function messagesPanel(doc, row, { prefix = null, nodeKey = null } = {}) {
  let nodes = nodesOf(doc);
  if (prefix) nodes = nodes.filter(n => n.key === prefix || n.key.startsWith(`${prefix}/`) || n.key.startsWith(`${prefix}:`));
  const st = { filter: 'all', q: '', sel: nodeKey && nodes.some(n => n.key === nodeKey) ? nodeKey : nodes[0]?.key };
  const text = n => n.calls.map(c => `${c.prompt ?? ''} ${c.reply ?? ''} ${c.system ?? ''} ${c.value == null ? '' : JSON.stringify(c.value)}`).join(' ').toLowerCase();
  const root_ = h('div', { class: 'msgs' }), list = h('div'), detail = h('div', { 'aria-live': 'polite' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter nodes' });
  function paint() {
    const keep = { all: () => true, model: n => n.calls.length > 0, failed: n => n.failed || n.calls.some(c => !c.ok), escalated: n => n.escalated, retried: n => n.retried }[st.filter];
    const q = st.q.trim().toLowerCase(), shown = nodes.filter(keep).filter(n => !q || n.key.toLowerCase().includes(q) || text(n).includes(q));
    chips.replaceChildren(...[['all', 'All'], ['model', 'Model nodes'], ['failed', 'Failed'], ['escalated', 'Escalated'], ['retried', 'Retried']].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(st.filter === id), onclick: () => { st.filter = id; paint(); } }, `${label} (${nodes.filter({ all: () => true, model: n => n.calls.length > 0, failed: n => n.failed || n.calls.some(c => !c.ok), escalated: n => n.escalated, retried: n => n.retried }[id]).length})`)));
    list.replaceChildren(...[h('div', { class: 'nodelist' }, shown.slice(0, 300).map(n => h('button', { type: 'button', 'aria-current': st.sel === n.key ? 'true' : null, onclick: () => { st.sel = n.key; paint(); } },
      h('span', { class: 'n1' }, n.key.replace(/^root\//, '')), h('span', { class: 'n2' }, `${n.calls.length} call${n.calls.length === 1 ? '' : 's'} · ${fmtCost(n.cost)}${n.failed ? ' · failed' : ''}${n.escalated ? ' · escalated' : ''}${n.retried ? ' · retried' : ''}`)))),
      shown.length > 300 ? h('p', { class: 'muted' }, `${shown.length - 300} more nodes are not listed; filter to narrow.`) : null, !shown.length ? h('p', { class: 'muted' }, 'No node matches.') : null].filter(Boolean));
    const node = nodes.find(n => n.key === st.sel);
    detail.replaceChildren(node ? nodeDetail(doc, row, node) : h('p', { class: 'muted' }, 'Pick a node.'));
  }
  const search = doc.contentWithheld ? null : h('label', { class: 'msgsearch' }, h('span', { class: 'sr-only' }, 'Search this run\'s prompts, replies and node names'), h('input', { type: 'search', placeholder: 'Search this run\'s messages', oninput: e => { st.q = e.target.value; paint(); } }));
  root_.append(h('div', null, search, chips, list), detail);
  paint();
  return root_;
}
function nodeDetail(doc, row, node) {
  const withheld = !!doc.contentWithheld, out = h('div');
  out.append(h('h3', { class: 'sec' }, node.key.replace(/^root\//, '')));
  // the escalation ladder, from typed events
  const rungs = node.events.filter(e => ['context.compiled', 'model.called', 'model.retry', 'model.resampled', 'model.escalated', 'node.failed', 'node.completed', 'node.handled_error'].includes(e.type));
  if (rungs.length) out.append(h('ol', { class: 'ladder', 'aria-label': 'Attempts in order' }, rungs.map(e => h('li', null, ({
    'context.compiled': `compiled context for ${shortModel(e.modelId)}${e.attempt != null ? `, attempt ${e.attempt}` : ''}`, 'model.called': `${shortModel(e.modelId)}: ${e.ok ? 'answered' : `error ${e.errorCode}`}, ${fmtDur(e.latencyMs)}, ${fmtCost(e.costUsd)}`,
    'model.retry': `retry ${e.retry ?? ''} after ${e.errorCode ?? 'an error'}`, 'model.resampled': `check failed, resampled (sample ${e.sampleIndex ?? '?'})`, 'model.escalated': `escalated ${shortModel(e.fromModel)} to ${shortModel(e.toModel)} (rule ${e.rule ?? '?'}${e.errorCode ? `, ${e.errorCode}` : ''})${e.inferred ? ' [inferred from a model change]' : ''}`,
    'node.failed': `FAILED: ${e.error?.code ?? 'error'}`, 'node.completed': 'completed', 'node.handled_error': 'failed into a handled error'
  })[e.type]))));
  for (const c of node.calls) out.append(callTurn(c, withheld));
  const done = node.events.find(e => e.type === 'node.completed' && e.output !== undefined);
  if (done && !withheld) out.append(h('div', { class: 'turn t-output' }, h('div', { class: 'th' }, h('span', { class: 'who' }, 'Node output (inline, clipped)')), codeBlock(done.output)));
  const failed = node.events.find(e => e.type === 'node.failed');
  if (failed && !withheld && failed.error?.message) out.append(h('div', { class: 'turn t-error' }, h('div', { class: 'th' }, h('span', { class: 'who' }, `Error ${failed.error.code} (runtime text)`)), h('pre', { class: 'code' }, txt(failed.error.message))));
  if (!node.calls.length && !failed) out.append(h('p', { class: 'muted' }, 'No model call is recorded for this node.'));
  return out;
}
function callTurn(c, withheld) {
  const chips = [c.ok ? 'ok' : `error ${c.errorCode}`, c.attempt != null ? `attempt ${c.attempt}` : null, c.sampleIndex ? `sample ${c.sampleIndex}` : null, fmtDur(c.latencyMs), fmtCost(c.costUsd), c.inputTokens != null ? `${c.inputTokens} in / ${c.outputTokens ?? 0} out` : null,
    c.promptVerified === true ? 'prompt matches the chain receipt' : c.promptVerified === false ? 'PROMPT DOES NOT MATCH the chain receipt' : null, c.mode && c.mode !== 'live' ? c.mode : null].filter(Boolean);
  const t = h('div', { class: `turn ${c.ok ? 't-reply' : 't-error'}` }, h('div', { class: 'th' }, h('span', { class: 'who' }, `Call ${c.id}: ${shortModel(c.modelId)}`), h('span', { class: 'muted' }, chips.join(' · '))));
  if (withheld) { t.append(h('p', { class: 'muted' }, 'Prompt and reply withheld (held-out split).')); return t; }
  if (c.system) t.append(h('details', null, h('summary', null, 'System prompt'), h('pre', { class: 'code' }, txt(c.system))));
  if (c.prompt) t.append(h('details', null, h('summary', null, 'Prompt'), h('pre', { class: 'code' }, txt(c.prompt))));
  if (c.value != null) t.append(h('details', { open: true }, h('summary', null, 'Typed output'), codeBlock(c.value)));
  if (c.reply) t.append(h('details', null, h('summary', null, 'Raw reply (not bound to the chain)'), h('pre', { class: 'code' }, txt(c.reply))));
  if (c.error) t.append(h('details', { open: true }, h('summary', null, 'Error'), codeBlock(c.error)));
  return t;
}
const codeBlock = value => h('pre', { class: 'code' }, txt(typeof value === 'string' ? value : JSON.stringify(value, null, 2)));

let drawerOpener = null;
function openDrawer(doc, row, opts) {
  const d = $('drawer'); drawerOpener = document.activeElement;
  d.replaceChildren(h('div', { class: 'dh' }, h('div', { class: 't' }, h('h2', { id: 'drawer-title' }, `Messages: ${(opts.prefix ?? '').replace(/^root\//, '') || 'run'}`), h('p', { class: 'muted' }, `${row.taskKey ?? row.key} · ${doc.contentWithheld ? 'content withheld' : 'text only'}`)),
    h('button', { type: 'button', class: 'btn small', id: 'drawer-close', onclick: closeDrawer }, 'Close')), h('div', { class: 'body' }, messagesPanel(doc, row, opts)));
  d.setAttribute('aria-labelledby', 'drawer-title'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  // a modal side sheet: the rest of the page is inert while it is open, so Tab cannot reach what it covers (at phone width it covers everything)
  for (const el of document.body.children) if (el !== d && el.id !== 'live' && el.tagName !== 'SCRIPT') el.inert = true;
  d.hidden = false; $('drawer-close').focus();
}
function closeDrawer() {
  const d = $('drawer'); if (d.hidden) return;
  for (const el of document.body.children) el.inert = false;
  d.hidden = true; d.replaceChildren(); if (drawerOpener?.isConnected) drawerOpener.focus(); drawerOpener = null;
}

// ------------------------------------------------------------------------------------------------------------------ compare
async function viewCompare(ka, kb) {
  const view = $('view'); view.replaceChildren();
  $('nav-compare').hidden = false;
  const ra = S.byKey.get(ka), rb = S.byKey.get(kb);
  if (!ra || !rb) { view.append(h('div', { class: 'empty' }, h('h2', null, 'Pick two runs to compare'), h('p', { class: 'muted' }, 'Select two rows in the runs list, then use Compare selected.'), h('a', { href: '#/runs' }, 'Back to the list'))); return; }
  view.append(h('a', { href: '#/runs' }, '← All runs'), h('h2', { class: 'page' }, 'Compare two runs'), h('p', { class: 'muted' }, 'A is the first selected run, B the second. Changed values are marked in words.'), h('p', null, 'Loading.'));
  let da = null, db = null;
  try { [da, db] = await Promise.all([ra.fidelity !== 'result-only' ? getDoc(ka) : null, rb.fidelity !== 'result-only' ? getDoc(kb) : null]); } catch (error) { view.append(h('p', { role: 'alert' }, `Could not decode a record: ${error.message}`)); }
  const cmp = H.compareDocs({ row: ra, doc: da, inputHash: ra.inputHash }, { row: rb, doc: db, inputHash: rb.inputHash });
  view.replaceChildren(h('a', { href: '#/runs' }, '← All runs'), h('h2', { class: 'page' }, 'Compare two runs'));
  view.append(h('div', { class: 'cmp' },
    h('section', { class: 'card' }, h('h3', null, 'Header'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('caption', { class: 'sr-only' }, 'Header fields of both runs'), h('thead', null, h('tr', null, ['Field', 'A', 'B', 'Change'].map(c => h('th', { scope: 'col' }, c)))),
      h('tbody', null, cmp.header.map(r => h('tr', { class: r.changed ? 'chg' : '' }, h('th', { scope: 'row' }, r.field), h('td', null, r.a), h('td', null, r.b), h('td', null, r.changed ? `changed${r.deltaText ? ` (${r.deltaText})` : ''}` : 'same'))))))),
    h('section', { class: 'card' }, h('h3', null, 'Where they first differ'), h('p', null, cmp.divergence?.text ?? 'No event record for one of the runs.'), ...cmp.notes.map(n => h('p', { class: 'muted' }, n))),
    cmp.versions ? h('section', { class: 'card' }, h('h3', null, 'Workflow versions differ'), h('ul', null, cmp.versions.added.length ? h('li', null, `Nodes only in B: ${cmp.versions.added.join(', ')}`) : null, cmp.versions.removed.length ? h('li', null, `Nodes only in A: ${cmp.versions.removed.join(', ')}`) : null,
      ...cmp.versions.changed.map(c => h('li', null, `${c.id}: ${c.diffs.join(', ')} changed`)), cmp.versions.acceptanceChanged ? h('li', null, 'Acceptance changed') : null), h('p', { class: 'muted' }, 'Text that changed is not interpreted here.')) : null,
    cmp.nodes.length ? h('section', { class: 'card' }, h('h3', null, 'Nodes aligned by id'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('caption', { class: 'sr-only' }, 'Per-node comparison'),
      h('thead', null, h('tr', null, ['Node', 'A state', 'A time', 'A cost', 'A models', 'B state', 'B time', 'B cost', 'B models'].map(c => h('th', { scope: 'col' }, c)))),
      h('tbody', null, cmp.nodes.map(n => { const f = (x, k) => x ? x[k] : '–'; const dur = x => x?.durationMs != null ? fmtDur(x.durationMs) : '–';
        return h('tr', { class: n.a?.state !== n.b?.state ? 'chg' : '' }, h('th', { scope: 'row' }, n.id), h('td', null, f(n.a, 'state')), h('td', null, dur(n.a)), h('td', null, n.a ? fmtCost(n.a.cost) : '–'), h('td', null, (n.a?.models || '–') + (n.a?.escalations ? ` (${n.a.escalations} esc)` : '')),
          h('td', null, f(n.b, 'state')), h('td', null, dur(n.b)), h('td', null, n.b ? fmtCost(n.b.cost) : '–'), h('td', null, (n.b?.models || '–') + (n.b?.escalations ? ` (${n.b.escalations} esc)` : ''))); }))))) : null,
    cmp.timelines ? h('section', { class: 'card cmp-tl' }, h('h3', null, 'Timelines on one relative axis'), compareTimelines(cmp.timelines, [da, db], [ra, rb])) : null,
    h('div', { class: 'pills' }, h('a', { href: `#/run/${encodeKey(ka)}` }, 'Open A'), ' ', h('a', { href: `#/run/${encodeKey(kb)}` }, 'Open B'))));
}
function compareTimelines(tl, docs, rows) {
  const dur = Math.max(tl.a.durationMs, tl.b.durationMs, 1);
  const mk = (lanes, label, doc, row) => { const st = { w0: 0, w1: dur, open: new Set(), table: false }; return h('div', null, h('h4', null, label), h('div', { class: 'tl-wrap' }, laneSvg(lanes, doc, row, st, 900, () => {}))); };
  return h('div', { class: 'cmp-tl' }, mk(tl.a, 'A', docs[0], rows[0]), mk(tl.b, 'B', docs[1], rows[1]));
}

// ------------------------------------------------------------------------------------------------------------------ task matrix
function viewTasks(query) {
  const view = $('view'); view.replaceChildren();
  const exp = query.get('experiment') ?? 'all';
  const rows = exp === 'all' ? S.rows : S.rows.filter(r => r.experiment === exp);
  const m = H.taskMatrix(rows);
  view.append(h('h2', { class: 'page' }, 'Tasks and arms'), h('p', { class: 'muted' }, 'Every trial with an independent oracle result, including baseline arms that have no Foundry run. Cells show oracle passes over trials; MISMATCH counts Foundry-pass trials the oracle failed. A task whose cell is empty was not run by that arm.'),
    h('label', { class: 'filters' }, h('span', null, 'Experiment'), h('select', { onchange: e => { location.hash = e.target.value === 'all' ? '#/tasks' : `#/tasks?experiment=${encodeURIComponent(e.target.value)}`; } }, h('option', { value: 'all' }, 'All'), S.facets.experiment.map(x => h('option', { value: x, selected: x === exp }, x)))));
  if (!m.tasks.length) { view.append(h('p', { class: 'muted' }, 'No trial with an oracle result.')); return; }
  view.append(h('div', { class: 'tablewrap' }, h('table', { class: 't matrix' }, h('caption', { class: 'sr-only' }, 'Tasks by arms'),
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Task (split)'), m.arms.map(a => h('th', { scope: 'col' }, a)))),
    h('tbody', null, m.tasks.map(t => h('tr', null, h('th', { scope: 'row' }, t.taskKey, h('span', { class: 'faint' }, ` (${t.split}${t.inspected ? ', inspected' : ''})`)),
      m.arms.map(a => { const c = t.cells.get(a); if (!c) return h('td', { class: 'cell faint' }, '–');
        const kind = c.pass === c.trials ? 'pass' : c.pass === 0 ? 'fail' : 'mixed';
        return h('td', { class: `cell cell-${kind}` }, h('a', { href: `#/run/${encodeKey(c.keys[0])}`, 'aria-label': `${t.taskKey}, ${a}: ${c.pass} of ${c.trials} pass${c.mismatch ? `, ${c.mismatch} mismatch` : ''}${c.experiments.size > 1 || c.files.size > 1 ? ', pooled from several sources' : ''}` },
          h('span', null, `${kind === 'pass' ? '✓' : kind === 'fail' ? '✕' : '!'} ${c.pass}/${c.trials}`), c.mismatch ? h('strong', null, `MISMATCH ${c.mismatch}`) : null, h('span', { class: 'faint' }, fmtCost(c.cost)),
          c.experiments.size > 1 || c.files.size > 1 ? h('span', { class: 'faint' }, c.experiments.size > 1 ? `pooled from ${c.experiments.size} experiments` : `pooled from ${c.files.size} result files`) : null)); })))))));
}

// ------------------------------------------------------------------------------------------------------------------ router and start
async function render() {
  const route = parseRoute();
  for (const a of document.querySelectorAll('.tabs a')) a.removeAttribute('aria-current');
  const nav = pick({ runs: 'nav-runs', run: 'nav-runs', tasks: 'nav-tasks', compare: 'nav-compare' }, route.name);
  if (nav) $(nav)?.setAttribute('aria-current', 'page');
  if (!S.data) return;
  closeDrawer();
  try {
    if (route.name === 'run') await viewRun(route.parts[0], route.parts[1] ?? 'timeline', route.parts[2]);
    else if (route.name === 'compare') await viewCompare(route.parts[0] ?? S.compare[0], route.parts[1] ?? S.compare[1]);
    else if (route.name === 'tasks') viewTasks(route.query);
    else viewRuns(route.query);
  } catch (error) { $('view').replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Could not show this page'), h('p', { role: 'alert' }, error.message))); }
  if (route.name === 'run' || route.name === 'compare') window.scrollTo?.(0, 0);
}
function showEmpty(message) {
  $('view').replaceChildren(h('div', { class: 'empty' }, h('h2', null, 'Open a run history'), h('p', null, message ?? 'This page shows past runs from a history file written by export-history.mjs.'),
    h('p', { class: 'muted' }, 'Build one: ', h('code', null, 'node tools/run-view/export-history.mjs --root DIR --out history.html'), '. Then open that one file, or use Open history file here with its .json form.')));
}
async function start() {
  let theme = 'dark';
  try { theme = localStorage.getItem('history-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch { /* default */ }
  setTheme(theme);
  $('theme').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { load(JSON.parse(String(r.result))); location.hash = '#/runs'; render(); } catch (error) { showEmpty(error.message); } }; r.readAsText(f); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  // Tab wraps inside the open drawer (the page behind it is inert; without the wrap focus would leave the document)
  $('drawer').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = [...$('drawer').querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener('hashchange', render);
  const embedded = document.getElementById('history-data');
  try {
    if (embedded) load(JSON.parse(embedded.textContent));
    else { const param = new URLSearchParams(location.search).get('data'); let same = null; try { same = param ? new URL(param, location.href) : null; } catch { same = null; }
      // same origin only, decided by the URL parser ("\\host/x" and "//host/x" resolve to another host), and never a scheme in the parameter
      if (param && same && /^https?:$/.test(location.protocol) && same.origin === location.origin && !/^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i.test(param)) { const res = await fetch(same.href, { cache: 'no-store' }); if (!res.ok) throw new Error(`Could not load ${param}: HTTP ${res.status}`); load(await res.json()); } }
  } catch (error) { showEmpty(error.message); return; }
  if (!S.data) { showEmpty(); return; }
  render();
}
root.RunHistory = { S, load, render, getDoc, openDrawer };
if (typeof document !== 'undefined') start();
})(globalThis);
