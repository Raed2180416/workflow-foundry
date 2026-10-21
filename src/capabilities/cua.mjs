// Computer use on a local browser (catalog kind `cua`, backend `playwright-local`), ARCHITECTURE.md §2.7 and §3.5. The `ui.*` contract:
//   observe  an interactive-only indexed list (password values redacted, offscreen and zero-area elements dropped), with a basis hash
//   find     indices whose role/name match, from the last observation
//   act      click | fill | select | press | scroll | back on an index of the CURRENT basis (STALE_BASIS otherwise)
//   extract  bounded reads (a table by name, a field by label, or main text), labelled untrusted
//   assert   a check on the DOM after a reload, never on a transient toast
//   commit   replay exactly one held request, allow-once, after a person's approval (non-idempotent, high, requiresApproval)
//   trace.export  stop tracing and write a hash-named trace artifact
// Why `act` is honestly effects none: a network gate aborts every non-GET request, and GETs on hold paths, and returns COMMIT_REQUIRED with
// the request's method, origin, path, body hash and a 512-byte preview; only `commit` sends such a request, exactly once. Navigation off
// the origin allowlist is blocked by host-resolver rules plus a post-action origin check (a route handler alone misses redirect hops).
// Login happens host-side on an unobserved page before tracing starts; secrets join the scrub set.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { approxTokens, fail, FoundryError, sha256 } from './common.mjs';
import { memberRecord } from './members.mjs';
import { resolveCredential } from './credentials.mjs';

const CANDIDATES = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
/** The Chromium to launch: FOUNDRY_CHROMIUM, the entry's explicit path, then known installs; null when none exists (callers skip). */
export function chromiumPath(entry = null) {
  return [process.env.FOUNDRY_CHROMIUM, entry?.source?.executablePath, ...CANDIDATES].filter(Boolean).find(p => existsSync(p)) ?? null;
}
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'slider', 'switch', 'tab', 'menuitem', 'option']);
const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)(?::\s*(.*))?$/;
const DEFAULT_HOLD = ['delete', 'remove', 'logout', 'confirm', 'unsubscribe'];
const unquote = s => s.replace(/\\(.)/g, '$1');
const stripRefs = snapshot => snapshot.replace(/ \[ref=[a-z0-9]+\]/g, '').replace(/ \[active\]/g, '').replace(/ \[cursor=pointer\]/g, '');

export class UiSession {
  constructor({ browser, entry, origin, holdPaths, scrub, maxSteps, observationTokens }) {
    Object.assign(this, { browser, entry, origin, scrub, maxSteps, observationTokens, steps: 0, held: [], pending: new Map(), violations: [], items: [], basis: null, lastUrl: null, tracing: false });
    this.allowed = new Set([new URL(origin).origin]);
    this.hold = new RegExp(`/(${holdPaths.join('|')})(/|$|\\?)`, 'i');
  }
  async open({ login = null } = {}) {
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true });
    if (login) {
      // Unobserved, untraced login with host-resolved secrets; the model never sees this page.
      const page = await this.context.newPage();
      await page.goto(new URL(login.path, this.origin).toString());
      await page.getByLabel(login.userLabel ?? 'Email').fill(login.user);
      await page.getByLabel(login.passwordLabel ?? 'Password').fill(login.password);
      await Promise.all([page.waitForLoadState('load'), page.getByRole('button', { name: login.submit ?? 'Sign in' }).click()]);
      await page.close();
    }
    this.storage = await this.context.storageState();
    await this.context.route('**/*', route => this.#gate(route));
    await this.context.tracing.start({ screenshots: false, snapshots: true, sources: false });
    this.tracing = true;
    this.page = await this.context.newPage();
    return this;
  }
  async #gate(route) {
    const request = route.request(), url = new URL(request.url());
    if (['file:', 'data:', 'javascript:'].includes(url.protocol) && request.isNavigationRequest()) { this.violations.push({ kind: 'scheme', protocol: url.protocol }); return route.abort('blockedbyclient'); }
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (!this.allowed.has(url.origin)) { this.violations.push({ kind: 'origin', origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); }
    const method = request.method();
    if ((method === 'GET' || method === 'HEAD') && !this.hold.test(url.pathname)) return route.continue();
    const body = request.postDataBuffer() ?? Buffer.alloc(0), headers = await request.allHeaders();
    // Deterministic id (session counter + request hash), so a replayed run shows the model the same transcript.
    const bodyHash = sha256(body), held = { id: `held-${this.held.length + 1}-${sha256(`${method} ${url.pathname}${url.search} ${bodyHash}`).slice(0, 8)}`, method, origin: url.origin, path: url.pathname + url.search, bodyHash,
      bodyPreview: this.scrub ? this.scrub.redact(body.subarray(0, 512).toString('utf8')) : body.subarray(0, 512).toString('utf8'),
      navigation: request.isNavigationRequest() };
    this.held.push(held);
    this.pending.set(held.id, { ...held, url: url.toString(), body, contentType: headers['content-type'] ?? null });
    return route.abort('blockedbyclient');
  }
  async goto(pathname) {
    const url = new URL(pathname, this.origin);
    if (!this.allowed.has(url.origin)) fail('ORIGIN_VIOLATION', 'Navigation outside the origin allowlist');
    await this.page.goto(url.toString()).catch(() => {});
    await this.#settle();
    return this.observe();
  }
  async #settle() { await this.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {}); await this.page.waitForTimeout(120); }
  /** The planner view. Untrusted page text; the snapshot's hidden text never enters it. */
  async observe() {
    this.#step();
    const snapshot = await this.page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '');
    const passwords = new Set(await this.page.$$eval('input[type=password]', els => els.map(el => (el.labels?.[0]?.innerText ?? el.getAttribute('aria-label') ?? el.name ?? '').trim())).catch(() => []));
    const items = [], counts = new Map();
    for (const line of snapshot.split('\n')) {
      const m = LINE.exec(line);
      if (!m || !INTERACTIVE.has(m[2])) continue;
      const role = m[2], name = unquote(m[3] ?? ''), ref = /\[ref=([a-z0-9]+)\]/.exec(m[4] ?? '')?.[1];
      const box = ref ? await this.page.locator(`aria-ref=${ref}`).boundingBox().catch(() => null) : null;
      if (!box || box.width * box.height <= 0 || box.x + box.width <= 0 || box.y + box.height <= 0) continue; // offscreen or zero-area
      const key = `${role}\u0000${name}`, nth = counts.get(key) ?? 0; counts.set(key, nth + 1);
      let value = m[5] && !m[5].endsWith(':') ? m[5].replace(/^"|"$/g, '') : undefined;
      if (value !== undefined && (passwords.has(name) || /password|passcode|secret|token/i.test(name) || this.scrub?.contains(value))) value = '[redacted]';
      items.push({ i: items.length + 1, role, name: name.slice(0, 120), nth, ...(value !== undefined ? { value: value.slice(0, 120) } : {}) });
    }
    this.items = items; this.basis = `sha256:${sha256(stripRefs(snapshot))}`; this.lastUrl = this.page.url();
    let view = items, truncated = false;
    while (approxTokens(JSON.stringify(view)) > this.observationTokens && view.length > 1) { view = view.slice(0, Math.floor(view.length * 0.8)); truncated = true; }
    const url = new URL(this.page.url());
    return { basis: this.basis, path: url.pathname + url.search, title: (await this.page.title().catch(() => '')).slice(0, 120), items: view, ...(truncated ? { truncated: true } : {}) };
  }
  #step() { if (++this.steps > this.maxSteps) fail('UI_STEP_BUDGET', `This UI session used its ${this.maxSteps} steps`); }
  find({ role = null, name = '' } = {}) {
    const q = String(name).toLowerCase();
    return { matches: this.items.filter(item => (!role || item.role === role) && item.name.toLowerCase().includes(q)).slice(0, 10).map(({ i, role: r, name: n }) => ({ i, role: r, name: n })) };
  }
  async #currentBasis() { const s = await this.page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => ''); return `sha256:${sha256(stripRefs(s))}`; }
  async act({ basis, index, op, value = null }) {
    this.#step();
    if (basis !== this.basis || (await this.#currentBasis()) !== this.basis) fail('STALE_BASIS', 'The page changed since that observation; observe again');
    const item = this.items.find(x => x.i === index);
    if (!item && op !== 'back' && op !== 'scroll') fail('TARGET_UNKNOWN', `No element ${index} in the last observation`);
    const heldBefore = this.held.length, violationsBefore = this.violations.length, url = this.page.url();
    if (item) {
      const locator = this.page.getByRole(item.role, { name: item.name, exact: true });
      if ((await locator.count()) <= item.nth) fail('TARGET_CHANGED', 'The target element is no longer on the page');
      const target = locator.nth(item.nth);
      if (op === 'click') await target.click({ timeout: 3000 }).catch(error => { throw new FoundryError('UI_ACTION', 'The click did not complete', { reason: String(error.message).slice(0, 80).replace(/\n.*/s, '') }); });
      else if (op === 'fill') await target.fill(String(value ?? ''), { timeout: 3000 });
      else if (op === 'select') await target.selectOption(String(value ?? ''), { timeout: 3000 });
      else if (op === 'press') await target.press(String(value ?? 'Enter'), { timeout: 3000 });
      else if (op === 'scroll') await target.scrollIntoViewIfNeeded({ timeout: 3000 });
      else fail('UI_OP', `Unknown op ${op}`);
    } else if (op === 'back') await this.page.goBack().catch(() => {});
    else await this.page.mouse.wheel(0, 600);
    await this.#settle();
    const held = this.held.slice(heldBefore), violations = this.violations.slice(violationsBefore);
    const landed = (() => { try { return new URL(this.page.url()).origin; } catch { return 'null'; } })();
    if (violations.length) {
      await this.#restore(url);
      return { ok: false, code: 'ORIGIN_VIOLATION', observation: await this.observe() };
    }
    if (held.length) {
      // A held navigation leaves the browser's error page; restore the last good URL.
      if (held.some(h => h.navigation) || !this.allowed.has(landed)) await this.#restore(url);
      return { ok: false, code: 'COMMIT_REQUIRED', pending: held.map(({ navigation, ...h }) => h), observation: await this.observe() };
    }
    if (!this.allowed.has(landed)) {
      // No route saw it (a redirect hop): the resolver rule failed the load and the origin check catches where the page landed.
      await this.#restore(url);
      return { ok: false, code: 'ORIGIN_VIOLATION', observation: await this.observe() };
    }
    return { ok: true, observation: await this.observe() };
  }
  async #restore(url) {
    // A denied navigation leaves an error page: go back to the last good URL with the saved state.
    const target = this.allowed.has(new URL(url).origin) ? url : new URL('/', this.origin).toString();
    await this.page.goto(target).catch(() => {});
    await this.#settle();
  }
  /** Bounded, untrusted reads. Hidden text is available here (it is still data) but never in the planner view. */
  async extract({ table = null, field = null, text = false, maxRows = 50 }) {
    this.#step();
    if (table) {
      const rows = await this.page.getByRole('table', { name: table, exact: true }).first().locator('tr').evaluateAll((trs, max) => trs.slice(0, max).map(tr => [...tr.querySelectorAll('th,td')].map(c => c.innerText.trim().slice(0, 200))), maxRows).catch(() => null);
      if (!rows) fail('UI_EXTRACT', `No table named ${String(table).slice(0, 60)}`);
      return { table, rows };
    }
    if (field) {
      const v = await this.page.getByLabel(field, { exact: true }).first().inputValue({ timeout: 2000 }).catch(() => null);
      if (v === null) fail('UI_EXTRACT', `No field labelled ${String(field).slice(0, 60)}`);
      return { field, value: /password/i.test(field) ? '[redacted]' : v.slice(0, 200) };
    }
    if (text) return { text: ((await this.page.locator('main').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000) };
    fail('UI_EXTRACT', 'extract needs table, field or text');
  }
  /** Checks run on the DOM after a reload (persisted state), never on a toast. */
  async assert({ textPresent = null, rowContains = null, table = null, noReload = false }) {
    this.#step();
    if (!noReload) { await this.page.reload().catch(() => {}); await this.#settle(); }
    if (textPresent !== null) return { pass: ((await this.page.locator('body').innerText().catch(() => '')) ?? '').includes(textPresent) };
    if (rowContains !== null) {
      const rows = (await this.extract({ table, maxRows: 200 })).rows;
      return { pass: rows.some(row => row.some(cell => cell === rowContains)) };
    }
    fail('UI_ASSERT', 'assert needs textPresent or rowContains');
  }
  /** Send exactly one held request (allow-once); the descriptor must match the held record field for field. */
  async commit({ id, method, origin, path: p, bodyHash }) {
    const pending = this.pending.get(id);
    if (!pending) fail('COMMIT_UNKNOWN', 'No held request with that id (it was never held, or was already committed)');
    if (pending.method !== method || pending.origin !== origin || pending.path !== p || pending.bodyHash !== bodyHash) fail('COMMIT_MISMATCH', 'The approved request differs from the held one');
    this.pending.delete(id); // allow-once: consumed before sending
    const response = await this.context.request.fetch(pending.url, { method: pending.method, headers: pending.contentType ? { 'content-type': pending.contentType } : {}, data: pending.body, maxRedirects: 0, failOnStatusCode: false });
    await this.page.reload().catch(() => {}); await this.#settle();
    return { committed: true, status: response.status(), method: pending.method, path: pending.path };
  }
  async exportTrace(dir) {
    if (!this.tracing) fail('UI_TRACE', 'No trace is being recorded');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `.trace-${randomUUID()}.zip`);
    await this.context.tracing.stop({ path: temp }); this.tracing = false;
    const hash = sha256(readFileSync(temp)), final = path.join(dir, `ui-trace-${hash.slice(0, 16)}.zip`);
    const { renameSync } = await import('node:fs'); renameSync(temp, final);
    return { file: path.basename(final), sha256: hash };
  }
  async close() { await this.context?.close().catch(() => {}); }
}

/** Host-owned table of UI sessions keyed by (runId, node). One browser per cua entry, launched lazily, closed with the table. */
export class UiSessions {
  #browsers = new Map(); #sessions = new Map();
  constructor({ chromium, scrub = null, env = process.env, keychain } = {}) { Object.assign(this, { chromium, scrub, env, keychain }); }
  async #browser(entry) {
    if (this.#browsers.has(entry.id)) return this.#browsers.get(entry.id);
    const executablePath = chromiumPath(entry);
    if (!executablePath) fail('UI_BACKEND_UNAVAILABLE', 'No Chromium executable is installed for the playwright-local backend');
    const hosts = entry.source.origins.map(o => new URL(o).hostname);
    const launched = this.chromium.launch({ executablePath, headless: true, args: [`--host-resolver-rules=MAP * ~NOTFOUND, ${hosts.map(h => `EXCLUDE ${h}`).join(', ')}`] });
    this.#browsers.set(entry.id, launched);
    return launched;
  }
  async get({ runId, node, entry, origin = entry.source.origins[0] }) {
    const key = `${runId}\u0000${node}\u0000${entry.id}`;
    if (this.#sessions.has(key)) return this.#sessions.get(key);
    const pending = (async () => {
      const login = entry.login ? { path: entry.login.path,
        user: await resolveCredential(entry.login.user, { custody: entry.login.user.env ? 'C0' : 'C1', scrub: this.scrub, env: this.env, keychain: this.keychain }),
        password: await resolveCredential(entry.login.password, { custody: entry.login.password.env ? 'C0' : 'C1', scrub: this.scrub, env: this.env, keychain: this.keychain }) } : null;
      const session = new UiSession({ browser: await this.#browser(entry), entry, origin, holdPaths: entry.source.holdPaths ?? DEFAULT_HOLD, scrub: this.scrub,
        maxSteps: entry.limits?.maxSteps ?? 30, observationTokens: entry.limits?.observationTokens ?? 2500 });
      await session.open({ login });
      await session.goto('/');
      return session;
    })();
    this.#sessions.set(key, pending);
    try { return await pending; } catch (error) { this.#sessions.delete(key); throw error; }
  }
  has({ runId, node, entry }) { return this.#sessions.has(`${runId}\u0000${node}\u0000${entry.id}`); }
  async closeNode(runId, node) { for (const [key, s] of this.#sessions) if (key.startsWith(`${runId}\u0000${node}\u0000`)) { this.#sessions.delete(key); await (await s.catch(() => null))?.close(); } }
  async closeRun(runId) { for (const [key, s] of this.#sessions) if (key.startsWith(`${runId}\u0000`)) { this.#sessions.delete(key); await (await s.catch(() => null))?.close(); } }
  async close() {
    for (const s of this.#sessions.values()) await (await s.catch(() => null))?.close();
    this.#sessions.clear();
    for (const b of this.#browsers.values()) await (await b.catch(() => null))?.close();
    this.#browsers.clear();
  }
}

const S = (max = 200) => ({ type: 'string', maxLength: max });
const VIEW = {
  observe: ['Look at the current page: a numbered list of buttons, links and fields.', { type: 'object', additionalProperties: false, properties: { path: S(200) } }],
  find: ['Find numbered elements on the last observed page by role and name.', { type: 'object', additionalProperties: false, properties: { role: S(20), name: S(120) } }],
  act: ['Click, fill, select, press, scroll or go back on element i of the current observation.', { type: 'object', additionalProperties: false, required: ['basis', 'op'],
    properties: { basis: S(80), index: { type: 'integer', minimum: 1, maximum: 500 }, op: { enum: ['click', 'fill', 'select', 'press', 'scroll', 'back'] }, value: S(500) } }],
  extract: ['Read a table by name, a field by label, or the main text of the page.', { type: 'object', additionalProperties: false, properties: { table: S(120), field: S(120), text: { type: 'boolean' }, maxRows: { type: 'integer', minimum: 1, maximum: 200 } } }],
  assert: ['Reload and check that text or a table row is present on the page.', { type: 'object', additionalProperties: false, properties: { textPresent: S(200), rowContains: S(200), table: S(120) } }],
  commit: ['Send one held request exactly once, after a person approves it.', { type: 'object', additionalProperties: false, required: ['id', 'method', 'origin', 'path', 'bodyHash'],
    properties: { id: S(40), method: S(10), origin: S(200), path: S(500), bodyHash: S(64), bodyPreview: S(600) } }],
  'trace.export': ['Save the browser trace of this session as an artifact.', { type: 'object', additionalProperties: false, properties: {} }]
};
const VERB = { observe: 'observe', find: 'search', act: 'navigate', extract: 'read', assert: 'observe', commit: 'update', 'trace.export': 'read' };

/** The ui.* members of one cua entry. Every output is labelled untrusted:web.<entry> (page text is third-party data). */
export function uiMembers(entry) {
  const label = `untrusted:web.${entry.id}`;
  return Object.entries(VIEW).map(([action, [summary, inputSchema]]) => {
    const effects = action === 'commit' ? 'non-idempotent' : action === 'trace.export' ? 'idempotent' : 'none';
    return memberRecord({ entry, name: action, id: `ui.${entry.id}.${action}`, adapter: 'nodecap-ui/1', pins: { backend: entry.source.backend, origins: entry.source.origins, holdPaths: entry.source.holdPaths ?? DEFAULT_HOLD },
      attestation: { type: `ui.${action.replace('.', '-')}`, system: entry.id, verbs: [VERB[action]], objects: ['page'], effects, risk: action === 'commit' ? 'high' : 'low', requiresApproval: action === 'commit',
        outputLabel: label, dataClass: 'private', egress: 'first-party', maxTimeoutMs: 30000, cost: 0, outputMode: 'structured', outputSchema: { type: 'object' },
        view: { name: `${entry.id.replace(/-/g, '_')}_${action.replace('.', '_')}`, summary, inputSchema } } });
  });
}
/** Invoke one ui.* member on the session of (runId, node). */
export async function invokeUi(member, sessions, args, { runId, node, entry, artifactsDir }) {
  const session = await sessions.get({ runId, node, entry });
  switch (member.tool) {
    case 'observe': return args.path ? session.goto(args.path) : session.observe();
    case 'find': return session.find(args);
    case 'act': return session.act(args);
    case 'extract': return session.extract(args);
    case 'assert': return session.assert(args);
    case 'commit': return session.commit(args);
    case 'trace.export': return session.exportTrace(artifactsDir);
    default: fail('UI_OP', `Unknown ui member ${member.tool}`);
  }
}
