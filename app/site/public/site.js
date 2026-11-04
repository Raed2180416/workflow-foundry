// The site shell: copy, key, API wrapper, hash router, focus management, live regions, the "waiting" badge and notice.
// Views live in /views/*.js and render into <main>. Foundry opens this page with a one-time code in the address (#/route?c=...): the page
// takes it out of the address at once, trades it for this tab's key (POST /auth/open, app/site/gate.mjs) and keeps the key in this tab's
// sessionStorage only; every /api call sends it in the x-foundry-token header. A closed tab or a new start of Foundry ends the key; the
// way back in is `node app/cli.mjs open`, which the page says (security review 2026-10-21, H1 H2: a key kept in localStorage for a
// fixed port could be read by whatever answered on that port while Foundry was down). A link pasted into this tab works without a
// reload (hashchange). Help and the glossary open without a key.
import { el, clear, append } from './components/dom.js';
export { el };

const state = { copy: null, claims: null, templates: null, token: null, memory: {}, renderId: 0 };

// ------------------------------------------------------------------------------------------------ key and first route
const KEY = 'foundry-token';
function storeToken(t) { try { sessionStorage.setItem(KEY, t); } catch { /* storage off: keep it in memory */ } }
function forgetToken() { try { sessionStorage.removeItem(KEY); } catch { /* storage off */ } }
// Before the review the key was also kept in localStorage: remove any copy an older version left there.
function forgetOldCopy() { try { localStorage.removeItem(KEY); } catch { /* storage off */ } }
const CODE = /^[A-Za-z0-9_-]{43}$/;
/** The one-time code in the address (#/route?c=CODE), taken out of the address before anything else happens. */
function takeCode() {
  const raw = location.hash.slice(1), at = raw.indexOf('?');
  if (at < 0) return null;
  const query = new URLSearchParams(raw.slice(at + 1)), code = query.get('c');
  if (!code) return null;
  query.delete('c');
  const route = raw.slice(0, at).startsWith('/') ? raw.slice(0, at) : '/', rest = query.toString();
  history.replaceState(null, '', `${location.pathname}#${route}${rest ? `?${rest}` : ''}`);
  return CODE.test(code) ? code : '';
}
/** Trade a code for this tab's key. Returns the key, or null with state.codeProblem set (expired, already used). */
async function redeem(code) {
  try {
    const res = await fetch('/auth/open', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.key === 'string') { storeToken(data.key); state.codeProblem = null; return data.key; }
    state.codeProblem = data.code ?? 'CODE_EXPIRED';
  } catch { state.codeProblem = 'CODE_EXPIRED'; }
  return null;
}
async function takeToken() {
  forgetOldCopy();
  const code = takeCode();
  if (code !== null) { const key = code ? await redeem(code) : (state.codeProblem = 'CODE_SHAPE', null); if (key) return key; }
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

// ------------------------------------------------------------------------------------------------ copy
/** A copy string by dotted key; {name} placeholders from vars; {claim:C01} becomes the claim's text. */
export function t(key, vars = {}) {
  let v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), state.copy);
  if (v && typeof v === 'object') v = v.plain;
  if (typeof v !== 'string') { console.warn(`missing copy ${key}`); return key; }
  return v.replace(/\{claim:(C\d{2})\}/g, (_, c) => state.claims?.[c]?.text ?? c).replace(/\{([a-zA-Z0-9_]+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m));
}
/** A copy value as stored (a list of strings, for example). */
export const raw = key => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), state.copy);
/** The precise variant of a copy string (shown under "Show details"), or null. */
export function precise(key, vars = {}) {
  const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), state.copy);
  if (!v || typeof v !== 'object' || typeof v.precise !== 'string') return null;
  return v.precise.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m));
}
/** Copy with [text](#/route) links and {claim:Cxx} chips, as DOM nodes (still text only: no markup is parsed). */
export function rich(key, vars = {}) {
  let v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), state.copy);
  if (v && typeof v === 'object') v = v.plain;
  if (typeof v !== 'string') return document.createTextNode(key);
  const out = document.createDocumentFragment();
  const re = /\[([^\]]+)\]\((#\/[^)\s]*)\)|\{claim:(C\d{2})\}|\{([a-zA-Z0-9_]+)\}/g;
  let last = 0, m;
  while ((m = re.exec(v))) {
    if (m.index > last) out.append(v.slice(last, m.index));
    if (m[1]) out.append(el('a', { href: m[2] }, m[1]));
    else if (m[3]) out.append(claimRef(m[3]));
    else out.append(m[4] in vars ? (vars[m[4]] instanceof Node ? vars[m[4]] : String(vars[m[4]])) : m[0]);
    last = re.lastIndex;
  }
  if (last < v.length) out.append(v.slice(last));
  return out;
}
/** A claim in the page: its text, its status, its qualifier (what it does not cover), then a small link to where it comes from. */
// Security review 2026-10-21 (L17): the status shows where the claim is used. Honesty review (M6): every status, "Works now" included, and
// the qualifier too, so a claim never reads wider in a page than on the claims page (app/site/test/journeys/crawl.mjs checks every page).
export function claimRef(id) {
  const c = state.claims?.[id];
  if (!c) return document.createTextNode(id);
  return el('span', { class: 'claim', dataset: { claim: id } }, c.text, ' ', el('span', { class: 'chip', dataset: { claimStatus: c.status ?? '' } }, c.status ?? ''), ' ',
    c.qualifier ? [el('span', { class: 'muted', dataset: { claimQualifier: '' } }, `(${c.qualifier})`), ' '] : null,
    // UX review M6 (WCAG 2.5.3): the link's name starts with the word it shows ("source"), then says which claim.
    el('a', { href: `#/claims?claim=${id}`, class: 'small', 'aria-label': t('claims.sourceFor', { short: c.short }) }, t('claims.source')));
}
export const claims = () => state.claims ?? {};

// ------------------------------------------------------------------------------------------------ API
export class ApiError extends Error {
  constructor(status, data) {
    super(data?.problem?.what ?? data?.error?.message ?? data?.error ?? `HTTP ${status}`);
    this.status = status; this.data = data; this.code = data?.error?.code ?? data?.problem?.code ?? null; this.problem = data?.problem ?? null;
  }
}
export async function api(path, body, { method } = {}) {
  const res = await fetch(path, { method: method ?? (body ? 'POST' : 'GET'), cache: 'no-store',
    headers: { 'x-foundry-token': state.token ?? '', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  // A key from an earlier start of Foundry (every start makes new keys): say so, never loop.
  if (res.status === 401) { forgetToken(); state.token = null; state.staleToken = true; if (state.copy) renderNoToken(); }
  if (!res.ok) throw new ApiError(res.status, typeof data === 'string' ? { error: data } : data);
  if (data && typeof data === 'object' && data.ok === false && data.problem) throw new ApiError(409, data);
  return data;
}
/** Download an attachment that needs the token header: fetch it, then hand the browser a local blob link. */
export async function download(path, filename) {
  const res = await fetch(path, { headers: { 'x-foundry-token': state.token ?? '' }, cache: 'no-store' });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const blob = await res.blob(), url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return blob;
}
/** A person's decision: only from a real click on a visible card (SPEC R5). Programmatic calls are refused here. */
export async function decide(event, body, source = event?.currentTarget) {
  if (!event || event.isTrusted !== true) throw new Error('A decision needs a click by the person.');
  const card = source?.closest?.('[data-decision-card]');
  if (!card || card.offsetParent === null) throw new Error('A decision needs a visible card.');
  return api('/api/decide', body);
}
export async function templates() { if (!state.templates) state.templates = (await api('/api/templates')).templates; return state.templates; }
export const memory = state.memory;

// ------------------------------------------------------------------------------------------------ live regions, toast, title
export function say(message, { assertive = false } = {}) {
  const region = document.getElementById(assertive ? 'live-assertive' : 'live-polite');
  region.textContent = '';
  setTimeout(() => { region.textContent = message; }, 30);
}
// The toast is a visual echo only (aria-hidden): what it says is also said in the polite live region, which is always in the page, so a
// screen reader hears it (UX review m2: a region going from display:none to shown is not reliably announced). It moves to the top of the
// window when it would cover the control that has the focus (m20, WCAG 2.4.11), and nothing that matters is said only in a toast.
let toastTimer = null;
const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
function placeToast() {
  const node = document.getElementById('toast');
  if (!node || node.hidden) return;
  node.classList.remove('top');
  const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : null;
  if (overlaps(focused, node.getBoundingClientRect())) node.classList.add('top');
}
export function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message; node.hidden = false;
  say(message);
  placeToast();
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}
const clearToast = () => { clearTimeout(toastTimer); const node = document.getElementById('toast'); if (node) node.hidden = true; };

// ------------------------------------------------------------------------------------------------ focus
/** Move focus to a node (a heading or a region gets tabindex=-1 first). Returns whether it took the focus. */
export function focusOn(node, { scroll = true } = {}) {
  if (!node?.isConnected) return false;
  if (!node.matches('a[href], button, input, select, textarea, summary, [tabindex]')) node.setAttribute('tabindex', '-1');
  node.focus({ preventScroll: !scroll });
  return document.activeElement === node;
}
// UX review M1 (WCAG 2.4.3): when the control that had the focus disappears (a part of the page is redrawn) or stops being focusable,
// the focus goes to the nearest heading of the part that still stands, never to the top of the page. Views also move the focus on purpose
// where they know better; this catches the rest.
let lastFocus = { node: null, chain: [] };
function restoreFocus() {
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  const lost = lastFocus.node;
  if (!lost || (lost.isConnected && !lost.disabled && lost.getClientRects().length)) return;
  const view = document.getElementById('view');
  const standing = lastFocus.chain.find(n => n.isConnected && view?.contains(n) && n.getClientRects().length);
  if (!standing) return;
  const heading = standing.matches('h1, h2, h3') ? standing : standing.querySelector('h2, h3, h1') ?? standing.closest('section, article')?.querySelector('h2, h3') ?? view.querySelector('h1');
  focusOn(heading ?? standing, { scroll: false });
}
function guardFocus() {
  document.addEventListener('focusin', e => {
    const chain = []; for (let n = e.target?.parentElement; n && n.id !== 'view'; n = n.parentElement) chain.push(n);
    lastFocus = { node: e.target, chain };
  });
  const check = () => { setTimeout(restoreFocus, 0); };
  new MutationObserver(check).observe(document.getElementById('view'), { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  document.addEventListener('focusin', placeToast);
}
let waitingCount = 0, pageTitle = 'Foundry';
function setTitle(title) { pageTitle = title; document.title = `${waitingCount ? `(${waitingCount}) ` : ''}${title} · ${t('shell.brand')}`; }

// ------------------------------------------------------------------------------------------------ routes
const ROUTES = [
  [/^\/?$/, 'home', 'home'], [/^\/describe$/, 'describe', 'home'], [/^\/make\/([a-z][a-z0-9-]{0,63})$/, 'make', 'home'],
  [/^\/checked\/([A-Za-z0-9-]{8,64})$/, 'checked', 'home'], [/^\/go-live\/([A-Za-z][A-Za-z0-9_-]{0,63})$/, 'go-live', 'automations'],
  [/^\/drafts$/, 'drafts', 'automations'], [/^\/waiting$/, 'waiting', 'waiting'], [/^\/automations$/, 'automations', 'automations'],
  [/^\/automations\/([A-Za-z][A-Za-z0-9_-]{0,63})$/, 'automation', 'automations'], [/^\/runs$/, 'runs', 'runs'], [/^\/runs\/([A-Za-z0-9-]{1,64})$/, 'run', 'runs'],
  [/^\/connections$/, 'connections', 'connections'], [/^\/keys$/, 'keys', 'connections'], [/^\/settings$/, 'settings', null],
  [/^\/connect-agent$/, 'connect-agent', 'connections'], [/^\/pricing$/, 'pricing', null], [/^\/trust$/, 'trust', null], [/^\/docs$/, 'docs', 'help'],
  [/^\/glossary$/, 'glossary', 'help'], [/^\/help$/, 'help', 'help'], [/^\/claims$/, 'claims', null], [/^\/it-brief(?:\/([A-Za-z][A-Za-z0-9_-]{0,63}))?$/, 'it-brief', null],
  [/^\/import$/, 'import', 'home'], [/^\/org$/, 'org', null]
];
export const ROUTE_PATTERNS = ROUTES.map(r => r[0]);
export function navigate(path) { if (location.hash === `#${path}`) render(); else location.hash = path; }
function parse() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(1) : '/';
  const [path, query = ''] = raw.split('?');
  for (const [re, view, nav] of ROUTES) { const m = path.match(re); if (m) return { view, nav, params: m.slice(1), query: new URLSearchParams(query), path }; }
  return { view: 'not-found', nav: null, params: [], query: new URLSearchParams(query), path };
}

const main = () => document.getElementById('view');
async function render() {
  const myId = ++state.renderId, route = parse(), node = main();
  document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === route.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelector('.nav')?.classList.remove('open');
  document.querySelector('.menu-button')?.setAttribute('aria-expanded', 'false');
  clearToast();
  if (!state.token && !NO_KEY_VIEWS.has(route.view)) { renderNoToken(); return; }
  // While a page loads (UX review m9): a visible "Loading" line, and the page being left can't be used (inert), so a click on it does
  // nothing half-way through a change of page. A control in the page that had the focus would lose it to the top of the document when
  // the page turns inert (M1), so the focus waits on the "Loading" line until the new page's heading takes it.
  const loading = document.getElementById('loading');
  if (loading) loading.hidden = false;
  if (loading && node.contains(document.activeElement)) loading.focus({ preventScroll: true });
  node.setAttribute('aria-busy', 'true'); node.inert = true;
  let content;
  try {
    const mod = await import(`./views/${route.view}.js`);
    content = await mod.render({ params: route.params, query: route.query, path: route.path });
  } catch (error) {
    // A key that went out of date while the tab was open (Foundry started again): the page that says the one command, not an error (m1).
    if (!state.token && !NO_KEY_VIEWS.has(route.view)) { if (myId === state.renderId) { endLoading(node); renderNoToken(); } return; }
    const { errorPanel } = await import('./components/ui.js');
    content = el('div', {}, el('h1', {}, t('errors.pageTitle')), errorPanel(error, { notDone: t('errors.nothingChanged'), action: { label: t('common.backHome'), href: '#/' } }));
    console.error(error);
  }
  if (myId !== state.renderId) return; // a newer navigation won
  if (!state.token && !NO_KEY_VIEWS.has(route.view)) { endLoading(node); renderNoToken(); return; }
  clear(node);
  node.className = content?.dataset?.layout === 'narrow' ? 'narrow' : '';
  append(node, content);
  endLoading(node);
  const h1 = node.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); setTitle(h1.textContent.trim()); }
  // A page can ask for a part of it to be shown and focused (a claim linked from another page: UX review m15). The scroll happens after
  // the page is in the document, never before it.
  const target = content?.dataset?.focus ? node.querySelector(content.dataset.focus) : null;
  if (target) { focusOn(target, { scroll: false }); target.scrollIntoView({ block: 'start' }); }
  else { if (h1 && !state.first) h1.focus(); window.scrollTo(0, 0); }
  // Never left on nothing after a change of page (the "Loading" line that held the focus is hidden now).
  if (!state.first && (document.activeElement === document.body || !document.activeElement)) node.focus({ preventScroll: true });
  state.first = false;
}
function endLoading(node) { node.removeAttribute('aria-busy'); node.inert = false; const loading = document.getElementById('loading'); if (loading) loading.hidden = true; }
// Pages that hold no workspace data and need no key: the way back must never need the key it is about (P2 walkthrough B2).
const NO_KEY_VIEWS = new Set(['help', 'glossary']);
function renderNoToken() {
  const node = clear(main());
  endLoading(node);
  const command = el('pre', {}, 'node app/cli.mjs open');
  // The exact command for this folder (absolute path, this workspace): the only thing the server says without a key.
  fetch('/open-info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(info => { if (info?.open) command.textContent = info.open; }).catch(() => {});
  const lead = state.codeProblem === 'CODE_USED' ? t('shell.codeUsed') : state.codeProblem ? t('shell.codeExpired') : state.staleToken ? t('shell.noTokenStale') : t('shell.noToken');
  append(node, el('div', { dataset: { noKey: state.codeProblem ?? (state.staleToken ? 'stale' : 'none') } }, el('h1', { tabindex: '-1' }, t('shell.noTokenTitle')), el('p', { class: 'lead' }, lead),
    command, el('p', {}, t('shell.noTokenOwnTerminal')), el('p', {}, t('shell.noTokenNotRunning')), el('p', {}, el('a', { href: '#/help' }, t('shell.noTokenHelp')))));
  setTitle(t('shell.noTokenTitle'));
  node.querySelector('h1')?.focus();
  updateNotice(0);
}

// ------------------------------------------------------------------------------------------------ badge
export async function refreshBadge() {
  if (!state.token) return;
  try {
    const [o, b] = await Promise.all([api('/api/overview'), api('/api/batches')]);
    const before = waitingCount;
    waitingCount = (o.inbox?.count ?? 0) + (b.open?.length ?? 0);
    // The link's name is "Waiting for you (2)": the count is said once, inside the name (UX review m16), and only changes when it does.
    const badge = document.getElementById('waiting-count'), srCount = document.getElementById('waiting-count-sr');
    if (badge.textContent !== String(waitingCount) || badge.hidden !== !waitingCount) { badge.hidden = !waitingCount; badge.textContent = String(waitingCount); }
    const sr = waitingCount ? t('nav.waitingCount', { n: waitingCount }) : '';
    if (srCount && srCount.textContent !== sr) srCount.textContent = sr;
    updateNotice(waitingCount);
    // Something new waits: said once, politely, on any page (M2: the notice itself is not a live region, so a poll never repeats it).
    if (waitingCount > before && !state.firstBadge) say(t('shell.waitingNotice', { n: waitingCount }));
    state.firstBadge = false;
    setTitle(pageTitle);
  } catch { /* the badge is a convenience; the page keeps working */ }
}
// The page follows along when something new waits (a list your coding agent asked for, say): a notice on every page but Waiting itself and
// Home (which has its own), so nobody has to know to look (P1 walkthrough M13). UX review M2: the notice is changed only when what it says
// changes, never on every poll.
function updateNotice(n) {
  const notice = document.getElementById('notice');
  if (!notice) return;
  const route = parse(), show = n > 0 && !!state.token && !['waiting', 'home'].includes(route.view);
  if (notice.hidden !== !show) notice.hidden = !show;
  if (!show || notice.dataset.count === String(n)) return;
  notice.dataset.count = String(n);
  notice.replaceChildren(el('p', {}, t('shell.waitingNotice', { n }), ' ', el('a', { href: '#/waiting' }, t('shell.waitingNoticeLink'))));
}

// ------------------------------------------------------------------------------------------------ start
async function start() {
  state.token = await takeToken();
  try { const theme = localStorage.getItem('foundry-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; } catch { /* no storage */ }
  const [copy, registry] = await Promise.all([fetch('/copy/en.json').then(r => r.json()), state.token ? api('/api/claims').catch(() => ({ claims: {} })) : { claims: {} }]);
  state.copy = copy; state.claims = registry.claims ?? {};
  document.querySelectorAll('[data-copy]').forEach(n => { n.textContent = t(n.dataset.copy); });
  document.querySelector('.skip').addEventListener('click', e => { e.preventDefault(); const h1 = main().querySelector('h1'); (h1 ?? main()).focus(); });
  const menu = document.querySelector('.menu-button');
  menu.addEventListener('click', () => { const open = document.querySelector('.nav').classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  window.addEventListener('hashchange', async () => {
    // A link with a one-time code pasted into this tab: trade it and go on, no reload needed (P2 walkthrough B2).
    if (/[?&]c=/.test(location.hash)) { const key = await takeToken(); if (key) { state.token = key; state.staleToken = false; } render(); refreshBadge(); return; }
    if (location.hash.startsWith('#/') || location.hash === '' || location.hash === '#') { await render(); updateNotice(waitingCount); }
  });
  guardFocus();
  state.first = true; state.firstBadge = true;
  await render();
  refreshBadge();
  setInterval(() => { if (document.visibilityState === 'visible') refreshBadge(); }, 5000);
}
start();
