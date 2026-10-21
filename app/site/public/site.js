// The site shell: copy, token, API wrapper, hash router, focus management, live regions, the "waiting" badge.
// Views live in /views/*.js and render into <main>. The one-time key arrives in the URL fragment (#t=...&r=/route), moves to
// sessionStorage and leaves the address bar; every /api call sends it in the x-foundry-token header.
import { el, clear, append } from './components/dom.js';
export { el };

const state = { copy: null, claims: null, templates: null, token: null, memory: {}, renderId: 0 };

// ------------------------------------------------------------------------------------------------ token and first route
function takeToken() {
  const raw = location.hash.slice(1);
  if (raw.startsWith('t=')) {
    const params = new URLSearchParams(raw);
    const t = params.get('t'), r = params.get('r');
    try { sessionStorage.setItem('foundry-token', t); } catch { /* storage off: keep it in memory */ }
    history.replaceState(null, '', `${location.pathname}#${r && r.startsWith('/') ? r : '/'}`);
    return t;
  }
  try { return sessionStorage.getItem('foundry-token'); } catch { return null; }
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
/** A claim in the page: its text, then a small link to where it comes from. */
export function claimRef(id) {
  const c = state.claims?.[id];
  if (!c) return document.createTextNode(id);
  return el('span', { class: 'claim', dataset: { claim: id } }, c.text, ' ', el('a', { href: `#/claims?c=${id}`, class: 'small', 'aria-label': t('claims.sourceFor', { short: c.short }) }, t('claims.source')));
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
let toastTimer = null;
export function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 2500);
}
let waitingCount = 0, pageTitle = 'Foundry';
function setTitle(title) { pageTitle = title; document.title = `${waitingCount ? `(${waitingCount}) ` : ''}${title} · ${t('shell.brand')}`; }

// ------------------------------------------------------------------------------------------------ routes
const ROUTES = [
  [/^\/?$/, 'home', 'home'], [/^\/describe$/, 'describe', 'home'], [/^\/make\/([a-z][a-z0-9-]{0,63})$/, 'make', 'home'],
  [/^\/checked\/([A-Za-z0-9-]{8,64})$/, 'checked', 'home'], [/^\/go-live\/([A-Za-z][A-Za-z0-9_-]{0,63})$/, 'go-live', 'automations'],
  [/^\/drafts$/, 'drafts', 'automations'], [/^\/waiting$/, 'waiting', 'waiting'], [/^\/automations$/, 'automations', 'automations'],
  [/^\/automations\/([A-Za-z][A-Za-z0-9_-]{0,63})$/, 'automation', 'automations'], [/^\/runs$/, 'runs', 'runs'], [/^\/runs\/([A-Za-z0-9-]{1,64})$/, 'run', 'runs'],
  [/^\/connections$/, 'connections', 'connections'], [/^\/keys$/, 'keys', 'connections'], [/^\/settings$/, 'settings', 'connections'],
  [/^\/connect-agent$/, 'connect-agent', 'connections'], [/^\/pricing$/, 'pricing', null], [/^\/trust$/, 'trust', null], [/^\/docs$/, 'docs', 'help'],
  [/^\/glossary$/, 'glossary', 'help'], [/^\/help$/, 'help', 'help'], [/^\/claims$/, 'claims', null], [/^\/it-brief(?:\/([A-Za-z][A-Za-z0-9_-]{0,63}))?$/, 'it-brief', null],
  [/^\/import$/, 'import', 'home'], [/^\/org$/, 'org', 'connections']
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
  if (!state.token) { renderNoToken(); return; }
  node.setAttribute('aria-busy', 'true');
  let content;
  try {
    const mod = await import(`./views/${route.view}.js`);
    content = await mod.render({ params: route.params, query: route.query, path: route.path });
  } catch (error) {
    const { errorPanel } = await import('./components/ui.js');
    content = el('div', {}, el('h1', {}, t('errors.pageTitle')), errorPanel(error, { action: { label: t('common.backHome'), href: '#/' } }));
    console.error(error);
  }
  if (myId !== state.renderId) return; // a newer navigation won
  clear(node);
  node.className = content?.dataset?.layout === 'narrow' ? 'narrow' : '';
  append(node, content);
  node.removeAttribute('aria-busy');
  const h1 = node.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); setTitle(h1.textContent.trim()); if (!state.first) h1.focus(); }
  state.first = false;
  window.scrollTo(0, 0);
}
function renderNoToken() {
  const node = clear(main());
  append(node, el('div', {}, el('h1', { tabindex: '-1' }, t('shell.noTokenTitle')), el('p', { class: 'lead' }, t('shell.noToken')),
    el('pre', {}, 'node app/cli.mjs site'), el('p', {}, el('a', { href: '#/help' }, t('nav.help')))));
  setTitle(t('shell.noTokenTitle'));
}

// ------------------------------------------------------------------------------------------------ badge
export async function refreshBadge() {
  if (!state.token) return;
  try {
    const [o, b] = await Promise.all([api('/api/overview'), api('/api/batches')]);
    waitingCount = (o.inbox?.count ?? 0) + (b.open?.length ?? 0);
    const badge = document.getElementById('waiting-count');
    badge.hidden = !waitingCount; badge.textContent = String(waitingCount);
    badge.setAttribute('aria-label', t('nav.waitingCount', { n: waitingCount }));
    setTitle(pageTitle);
  } catch { /* the badge is a convenience; the page keeps working */ }
}

// ------------------------------------------------------------------------------------------------ start
async function start() {
  state.token = takeToken();
  try { const theme = localStorage.getItem('foundry-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; } catch { /* no storage */ }
  const [copy, registry] = await Promise.all([fetch('/copy/en.json').then(r => r.json()), state.token ? api('/api/claims').catch(() => ({ claims: {} })) : { claims: {} }]);
  state.copy = copy; state.claims = registry.claims ?? {};
  document.querySelectorAll('[data-copy]').forEach(n => { n.textContent = t(n.dataset.copy); });
  document.querySelector('.skip').addEventListener('click', e => { e.preventDefault(); const h1 = main().querySelector('h1'); (h1 ?? main()).focus(); });
  const menu = document.querySelector('.menu-button');
  menu.addEventListener('click', () => { const open = document.querySelector('.nav').classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/') || location.hash === '' || location.hash === '#') render(); });
  state.first = true;
  await render();
  refreshBadge();
  setInterval(() => { if (document.visibilityState === 'visible') refreshBadge(); }, 5000);
}
start();
