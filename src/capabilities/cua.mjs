// Computer use on a local browser (catalog kind `cua`, backend `playwright-local`), ARCHITECTURE.md §2.7 and §3.5. The `ui.*` contract:
//   observe  an interactive-only indexed list (password values redacted, offscreen and zero-area elements dropped), with a basis hash;
//            with `path`, navigate there first
//   find     indices whose role/name match, from the last observation
//   act      click | fill | select | press | scroll | back on an index of the CURRENT basis (STALE_BASIS otherwise)
//   extract  bounded reads (a table by name, a field by label, or main text), labelled untrusted, secrets redacted
//   assert   a check on the DOM after a reload, never on a transient toast
//   commit   replay exactly one held request, named by its id only, allow-once, after a person approved the HOST's rendering of it
//   trace.export  stop tracing; replace every cookie and credential header in the network log (whatever its length) and add their values
//                 to the scrub set; redact every held secret from every archive entry; check it clean; write a hash-named trace artifact
//
// The network gate (every request of the browser context): a GET or HEAD passes only when its path is on the entry's owner-attested
// `safeGets` allowlist (paths whose GET has no side effect) and not on a hold path; every other request on the allowed origins is HELD
// (aborted, recorded, returned as COMMIT_REQUIRED with method, origin, path, body hash and a preview), and only `commit` sends a held
// request, exactly once. Off-allowlist origins and other schemes are blocked. So `observe`, `act` and `assert` are honestly effects none
// ONLY for an entry with `safeGets`: without one, every navigation could be a GET with a side effect, and those three members are
// classified non-idempotent, high risk, approval-gated (a person approves each call), and the session never re-navigates on its own.
// Channels the request gate does not see are closed by the S0 profile: WebSockets (routeWebSocket, and the constructor removed), dedicated
// and shared workers (removed: a worker's WebSocket is not routed), WebRTC (every RTC* constructor removed, and non-proxied UDP disabled),
// WebTransport and QUIC (removed, --disable-quic), service workers (blocked). Navigation off the origin allowlist is blocked by
// host-resolver rules plus a post-action origin check (a route handler alone misses redirect hops).
// Login happens host-side on an unobserved page before tracing starts; secrets, every cookie and storage value of the session, and every
// cookie or credential header the trace recorded (a site may rotate its session cookie on every response) join the scrub set. Page text (accessible names, values) is untrusted data from the site: the planner view carries no page title, caps each
// name, and is labelled untrusted; the effect gate, not the view filter, is what stops an injected instruction from changing anything.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { approxTokens, fail, FoundryError, sha256 } from './common.mjs';
import { memberRecord } from './members.mjs';
import { resolveCredential, ScrubSet } from './credentials.mjs';
import { readZip, writeZip } from './zipfile.mjs';

const CANDIDATES = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
/** The Chromium to launch: FOUNDRY_CHROMIUM, the entry's explicit path, then known installs; null when none exists (callers skip). */
export function chromiumPath(entry = null) {
  return [process.env.FOUNDRY_CHROMIUM, entry?.source?.executablePath, ...CANDIDATES].filter(Boolean).find(p => existsSync(p)) ?? null;
}
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'slider', 'switch', 'tab', 'menuitem', 'option']);
const LINE = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)(?::\s*(.*))?$/;
// The snapshot is YAML: a node whose text needs quoting (a name with ': ' or a quote) is written as one quoted scalar, e.g.
//   - 'button "It''s: here" [ref=e3]'      or      - 'button "Say \"hi\": now" [ref=e4]': x
const SINGLE = /^(\s*)- '((?:[^']|'')*)'(:.*)?$/, DOUBLE = /^(\s*)- "((?:[^"\\]|\\.)*)"(:.*)?$/;
export function parseSnapshotLine(line) {
  let m = SINGLE.exec(line);
  if (m) return LINE.exec(`${m[1]}- ${m[2].replace(/''/g, "'")}${m[3] ?? ''}`);
  m = DOUBLE.exec(line);
  if (m) { try { return LINE.exec(`${m[1]}- ${JSON.parse(`"${m[2]}"`)}${m[3] ?? ''}`); } catch { return null; } }
  return LINE.exec(line);
}
export const NAME_MAX = 60, VALUE_MAX = 120;
const DEFAULT_HOLD = ['delete', 'remove', 'logout', 'confirm', 'unsubscribe'];
const unquote = s => s.replace(/\\(.)/g, '$1');
const stripRefs = snapshot => snapshot.replace(/ \[ref=[a-z0-9]+\]/g, '').replace(/ \[active\]/g, '').replace(/ \[cursor=pointer\]/g, '');
const SECRETISH = /password|passcode|secret|token|api[-_ ]?key/i;
/** An owner path pattern: `*` is one path segment's characters, a trailing `/**` any suffix. */
export function pathPattern(pattern) {
  const tail = pattern.endsWith('/**'), body = tail ? pattern.slice(0, -3) : pattern;
  const source = body.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${source}${tail ? '(?:/.*)?' : ''}$`);
}
// The S0 profile's channel closures, run in every frame (Playwright init scripts reach about:blank and srcdoc frames and popups).
const S0_INIT = `(() => { for (const k of Object.getOwnPropertyNames(window)) if (/^(webkit)?RTC/.test(k)) { try { delete window[k]; } catch {} }
  for (const k of ['WebSocket', 'WebTransport', 'Worker', 'SharedWorker']) { try { delete window[k]; } catch {} } })();`;
export const S0_ARGS = Object.freeze(['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic']);

export class UiSession {
  constructor({ browser, entry, origin, holdPaths, safeGets = null, scrub, maxSteps, observationTokens }) {
    Object.assign(this, { browser, entry, origin, scrub, maxSteps, observationTokens, steps: 0, held: [], pending: new Map(), violations: [], items: [], basis: null, lastUrl: null, tracing: false });
    this.allowed = new Set([new URL(origin).origin]);
    // The origin as shown in held-request descriptors: a development (loopback) entry's port is dropped, as in its pins, so the model and
    // the approver see the same descriptor in every fresh world (replay at $0); held requests are only ever on the allowed origin.
    this.shownOrigin = entry?.dev === true ? (u => { u.port = ''; return u.origin; })(new URL(origin)) : new URL(origin).origin;
    this.hold = new RegExp(`/(${holdPaths.join('|')})(/|$|\\?)`, 'i');
    this.safe = safeGets ? safeGets.map(pathPattern) : null;
  }
  /** Whether a GET of `pathname` may pass without a commit: on the owner's safe-GET allowlist and not on a hold path (no allowlist: not held). */
  safeGet(pathname) { return !this.hold.test(pathname) && (this.safe ? this.safe.some(re => re.test(pathname)) : true); }
  /** Whether the session may navigate on its own (a restore, a reload) to `url`: only to an allowlisted safe GET. */
  autoNavigable(url) { try { const u = new URL(url); return !!this.safe && this.allowed.has(u.origin) && this.safeGet(u.pathname); } catch { return false; } }
  #observeSecrets(state) {
    for (const cookie of state?.cookies ?? []) this.scrub?.addObserved(cookie.value);
    for (const origin of state?.origins ?? []) for (const item of origin.localStorage ?? []) this.scrub?.addObserved(item.value);
  }
  async open({ login = null } = {}) {
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true });
    await this.context.addInitScript({ content: S0_INIT });
    await this.context.routeWebSocket(/.*/, ws => { this.violations.push({ kind: 'websocket', url: String(ws.url()).slice(0, 200) }); ws.close({ code: 1008, reason: 'blocked by the Foundry S0 profile' }); });
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
    this.#observeSecrets(this.storage); // the session cookie carries the user's authority: a secret like the password
    await this.context.route('**/*', route => this.#gate(route));
    await this.context.tracing.start({ screenshots: false, snapshots: true, sources: false });
    this.tracing = true;
    this.page = await this.context.newPage();
    return this;
  }
  async #gate(route) {
    const request = route.request(), url = new URL(request.url());
    // data: and blob: subresources stay inside the browser; every other non-http(s) request is blocked (none is passed through unread).
    if (['data:', 'blob:'].includes(url.protocol) && !request.isNavigationRequest()) return route.continue();
    if (!['http:', 'https:'].includes(url.protocol)) { this.violations.push({ kind: 'scheme', protocol: url.protocol }); return route.abort('blockedbyclient'); }
    if (!this.allowed.has(url.origin)) { this.violations.push({ kind: 'origin', origin: url.origin, path: url.pathname }); return route.abort('blockedbyclient'); }
    const method = request.method();
    if ((method === 'GET' || method === 'HEAD') && this.safeGet(url.pathname)) return route.continue();
    const body = request.postDataBuffer() ?? Buffer.alloc(0), headers = await request.allHeaders();
    // Deterministic id (session counter + request hash), so a replayed run shows the model the same transcript.
    const bodyHash = sha256(body), held = { id: `held-${this.held.length + 1}-${sha256(`${method} ${url.pathname}${url.search} ${bodyHash}`).slice(0, 8)}`, method, origin: this.shownOrigin, path: url.pathname + url.search, bodyHash,
      bodyPreview: this.scrub ? this.scrub.redact(body.subarray(0, 512).toString('utf8')) : body.subarray(0, 512).toString('utf8'),
      navigation: request.isNavigationRequest() };
    this.held.push(held);
    this.pending.set(held.id, { ...held, url: url.toString(), body, contentType: headers['content-type'] ?? null });
    return route.abort('blockedbyclient');
  }
  /** The host's own rendering of a held request, what a person approves before `commit` (never the model's account of it). */
  describeHeld(id) {
    const pending = this.pending.get(id);
    if (!pending) return null;
    const type = String(pending.contentType ?? '').toLowerCase(), text = pending.body.toString('utf8'), redact = s => this.scrub ? this.scrub.redact(s) : s;
    let body;
    if (!pending.body.length) body = { kind: 'empty' };
    else if (type.includes('application/x-www-form-urlencoded')) body = { kind: 'form', fields: [...new URLSearchParams(text)].slice(0, 50).map(([k, v]) => [redact(k).slice(0, 80), SECRETISH.test(k) ? '[redacted]' : redact(v).slice(0, 500)]) };
    else if (Buffer.from(text, 'utf8').equals(pending.body) && !/[\u0000-\u0008\u000e-\u001f]/.test(text)) body = { kind: 'text', contentType: type.slice(0, 80) || null, text: redact(text).slice(0, 4000), truncated: text.length > 4000 };
    else body = { kind: 'binary', bytes: pending.body.length };
    return { id, method: pending.method, origin: pending.origin, path: pending.path, bodyHash: pending.bodyHash, body };
  }
  async #navigate(work) {
    const heldBefore = this.held.length, violationsBefore = this.violations.length, url = this.page.url();
    await work();
    await this.#settle();
    const held = this.held.slice(heldBefore), violations = this.violations.slice(violationsBefore);
    const landed = (() => { try { return new URL(this.page.url()).origin; } catch { return 'null'; } })();
    if (violations.length) { await this.#restore(url); return { ok: false, code: 'ORIGIN_VIOLATION', observation: await this.observe() }; }
    if (held.length) {
      // A held navigation leaves the browser's error page; restore the last good URL (only an allowlisted safe GET is re-navigated).
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
  async goto(pathname) {
    const url = new URL(pathname, this.origin);
    if (!this.allowed.has(url.origin)) fail('ORIGIN_VIOLATION', 'Navigation outside the origin allowlist');
    const result = await this.#navigate(() => this.page.goto(url.toString()).catch(() => {}));
    return result.ok ? result.observation : result;
  }
  async #settle() { await this.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {}); await this.page.waitForTimeout(120); }
  /** The planner view: interactive elements only, names capped, no page title. Untrusted page text; the snapshot's hidden text never enters it. */
  async observe() {
    this.#step();
    const snapshot = await this.page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '');
    const passwords = new Set(await this.page.$$eval('input[type=password]', els => els.map(el => (el.labels?.[0]?.innerText ?? el.getAttribute('aria-label') ?? el.name ?? '').trim())).catch(() => []));
    const items = [], counts = new Map();
    for (const line of snapshot.split('\n')) {
      const m = parseSnapshotLine(line);
      if (!m || !INTERACTIVE.has(m[2])) continue;
      const role = m[2], name = unquote(m[3] ?? ''), ref = /\[ref=([a-z0-9]+)\]/.exec(m[4] ?? '')?.[1];
      const box = ref ? await this.page.locator(`aria-ref=${ref}`).boundingBox().catch(() => null) : null;
      if (!box || box.width * box.height <= 0 || box.x + box.width <= 0 || box.y + box.height <= 0) continue; // offscreen or zero-area
      const key = `${role}\u0000${name}`, nth = counts.get(key) ?? 0; counts.set(key, nth + 1);
      let value = m[5] && !m[5].endsWith(':') ? m[5].replace(/^"|"$/g, '') : undefined;
      if (value !== undefined && (passwords.has(name) || SECRETISH.test(name) || this.scrub?.contains(value))) value = '[redacted]';
      items.push({ i: items.length + 1, role, name, nth, ...(value !== undefined ? { value } : {}) });
    }
    this.items = items; this.basis = `sha256:${sha256(stripRefs(snapshot))}`; this.lastUrl = this.page.url();
    let view = items.map(({ value, ...item }) => ({ ...item, name: item.name.slice(0, NAME_MAX), ...(value !== undefined ? { value: value.slice(0, VALUE_MAX) } : {}) })), truncated = false;
    while (approxTokens(JSON.stringify(view)) > this.observationTokens && view.length > 1) { view = view.slice(0, Math.floor(view.length * 0.8)); truncated = true; }
    const url = (() => { try { return new URL(this.page.url()); } catch { return null; } })();
    return { basis: this.basis, path: url && this.allowed.has(url.origin) ? url.pathname + url.search : null, items: view, ...(truncated ? { truncated: true } : {}) };
  }
  #step() { if (++this.steps > this.maxSteps) fail('UI_STEP_BUDGET', `This UI session used its ${this.maxSteps} steps`); }
  find({ role = null, name = '' } = {}) {
    const q = String(name).toLowerCase();
    return { matches: this.items.filter(item => (!role || item.role === role) && item.name.toLowerCase().includes(q)).slice(0, 10).map(({ i, role: r, name: n }) => ({ i, role: r, name: n.slice(0, NAME_MAX) })) };
  }
  async #currentBasis() { const s = await this.page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => ''); return `sha256:${sha256(stripRefs(s))}`; }
  async act({ basis, index, op, value = null }) {
    this.#step();
    if (basis !== this.basis || (await this.#currentBasis()) !== this.basis) fail('STALE_BASIS', 'The page changed since that observation; observe again');
    const item = this.items.find(x => x.i === index);
    if (!item && op !== 'back' && op !== 'scroll') fail('TARGET_UNKNOWN', `No element ${index} in the last observation`);
    let target = null;
    if (item) {
      const locator = this.page.getByRole(item.role, { name: item.name, exact: true });
      if ((await locator.count()) <= item.nth) fail('TARGET_CHANGED', 'The target element is no longer on the page');
      target = locator.nth(item.nth);
    }
    if (item && !['click', 'fill', 'select', 'press', 'scroll'].includes(op)) fail('UI_OP', `Unknown op ${String(op).slice(0, 20)}`);
    return this.#navigate(async () => {
      if (item) {
        if (op === 'click') await target.click({ timeout: 3000 }).catch(error => { throw new FoundryError('UI_ACTION', 'The click did not complete', { reason: String(error.message).slice(0, 80).replace(/\n.*/s, '') }); });
        else if (op === 'fill') await target.fill(String(value ?? ''), { timeout: 3000 });
        else if (op === 'select') await target.selectOption(String(value ?? ''), { timeout: 3000 });
        else if (op === 'press') await target.press(String(value ?? 'Enter'), { timeout: 3000 });
        else await target.scrollIntoViewIfNeeded({ timeout: 3000 });
      } else if (op === 'back') await this.page.goBack().catch(() => {});
      else await this.page.mouse.wheel(0, 600);
    });
  }
  async #restore(url) {
    // A denied navigation leaves an error page. The session re-navigates on its own only to an allowlisted safe GET: re-requesting any
    // other URL could repeat a side effect nobody approved, so without a safe target the page is left blank for the model to observe.
    const target = this.autoNavigable(url) ? url : this.autoNavigable(new URL('/', this.origin).toString()) ? new URL('/', this.origin).toString() : 'about:blank';
    await this.page.goto(target).catch(() => {});
    await this.#settle();
  }
  /** Bounded, untrusted reads, with held secrets redacted. Hidden text is available here (it is still data) but never in the planner view. */
  async extract({ table = null, field = null, text = false, maxRows = 50 }) {
    this.#step();
    const redact = s => this.scrub ? this.scrub.redact(s) : s;
    if (table) {
      const rows = await this.page.getByRole('table', { name: table, exact: true }).first().locator('tr').evaluateAll((trs, max) => trs.slice(0, max).map(tr => [...tr.querySelectorAll('th,td')].map(c => c.innerText.trim().slice(0, 200))), maxRows).catch(() => null);
      if (!rows) fail('UI_EXTRACT', `No table named ${String(table).slice(0, 60)}`);
      return { table, rows: rows.map(row => row.map(redact)) };
    }
    if (field) {
      const locator = this.page.getByLabel(field, { exact: true }).first();
      const v = await locator.inputValue({ timeout: 2000 }).catch(() => null);
      if (v === null) fail('UI_EXTRACT', `No field labelled ${String(field).slice(0, 60)}`);
      const type = await locator.getAttribute('type', { timeout: 2000 }).catch(() => null);
      return { field, value: SECRETISH.test(field) || String(type).toLowerCase() === 'password' || this.scrub?.contains(v) ? '[redacted]' : v.slice(0, 200) };
    }
    if (text) return { text: redact(((await this.page.locator('main').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000)) };
    fail('UI_EXTRACT', 'extract needs table, field or text');
  }
  /** Checks run on the DOM after a reload (persisted state), never on a toast. A reload is a GET: only of a safe path, or an approved call. */
  async assert({ textPresent = null, rowContains = null, table = null, noReload = false }) {
    this.#step();
    if (!noReload) {
      if (this.safe && !this.autoNavigable(this.page.url())) fail('UI_RELOAD_HELD', 'This page is not on the safe-GET allowlist; reloading it could repeat a side effect');
      await this.page.reload().catch(() => {}); await this.#settle();
    }
    if (textPresent !== null) return { pass: ((await this.page.locator('body').innerText().catch(() => '')) ?? '').includes(textPresent) };
    if (rowContains !== null) {
      const rows = (await this.extract({ table, maxRows: 200 })).rows;
      return { pass: rows.some(row => row.some(cell => cell === rowContains)) };
    }
    fail('UI_ASSERT', 'assert needs textPresent or rowContains');
  }
  /** Send exactly one held request (allow-once), named by its id; what was approved is the host's describeHeld(id), checked by the dispatcher. */
  async commit({ id }) {
    const pending = this.pending.get(id);
    if (!pending) fail('COMMIT_UNKNOWN', 'No held request with that id (it was never held, or was already committed)');
    this.pending.delete(id); // allow-once: consumed before sending
    const response = await this.context.request.fetch(pending.url, { method: pending.method, headers: pending.contentType ? { 'content-type': pending.contentType } : {}, data: pending.body, maxRedirects: 0, failOnStatusCode: false });
    if (this.autoNavigable(this.page.url())) { await this.page.reload().catch(() => {}); await this.#settle(); }
    return { committed: true, status: response.status(), method: pending.method, path: pending.path };
  }
  /**
   * Stop tracing; scrub the network log structurally (every cookie and credential header value replaced, and added to the scrub set: the
   * log holds every cookie a site rotated, not only the current ones); redact every held secret (and every cookie and storage value of the
   * session) from every archive entry; refuse if any remains.
   */
  async exportTrace(dir) {
    if (!this.tracing) fail('UI_TRACE', 'No trace is being recorded');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.scrub ??= new ScrubSet();
    this.#observeSecrets(await this.context.storageState().catch(() => null)); // cookies set (or rotated) after login too
    const temp = path.join(dir, `.trace-${randomUUID()}.zip`);
    await this.context.tracing.stop({ path: temp }); this.tracing = false;
    let bytes;
    try {
      const scrub = this.scrub, entries = readZip(readFileSync(temp)).map(entry => {
        if (!entry.name.endsWith('.network')) return entry;
        const scrubbed = scrubTraceNetwork(entry.data);
        for (const value of scrubbed.values) scrub.addObserved(value);
        return { name: entry.name, data: scrubbed.data };
      }).map(({ name, data }) => ({ name, data: scrub.redactBuffer(data) }));
      if (entries.some(e => scrub.containsBuffer(e.data) || scrub.contains(e.name))) fail('SECRET_EXPOSURE', 'A secret remained in the UI trace after redaction; the trace was not exported');
      bytes = writeZip(entries);
    } finally { rmSync(temp, { force: true }); }
    const hash = sha256(bytes), final = path.join(dir, `ui-trace-${hash.slice(0, 16)}.zip`), staged = `${final}.${randomUUID()}.tmp`;
    writeFileSync(staged, bytes, { mode: 0o600 }); renameSync(staged, final);
    return { file: path.basename(final), sha256: hash };
  }
  async close() { await this.context?.close().catch(() => {}); }
}

const CREDENTIAL_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization']);
/** The secret parts of one credential header: each cookie value (cookie, set-cookie, one cookie per line) or the credential after its scheme. */
function headerSecrets(name, value) {
  const lower = name.toLowerCase(), pairs = lower === 'cookie' ? value.split(';') : lower === 'set-cookie' ? value.split('\n').map(line => line.split(';')[0]) : null;
  if (!pairs) return [value, value.replace(/^\S+\s+/, '')];
  return pairs.map(pair => pair.slice(pair.indexOf('=') + 1).trim()).filter(Boolean);
}
/**
 * Scrub a Playwright trace network log (JSON lines) structurally: every `cookies[].value` and every cookie, set-cookie or authorization
 * header value becomes [redacted], whatever its length. Returns the scrubbed bytes and the values found (the caller scrubs them from the
 * other archive entries too). A line that is not JSON cannot be scanned, so the trace is refused.
 */
export function scrubTraceNetwork(data) {
  const found = new Set();
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.cookies)) for (const c of node.cookies) if (typeof c?.value === 'string') { if (c.value) found.add(c.value); c.value = '[redacted]'; }
    if (Array.isArray(node.headers)) for (const h of node.headers) if (typeof h?.name === 'string' && typeof h.value === 'string' && CREDENTIAL_HEADERS.has(h.name.toLowerCase())) {
      for (const v of headerSecrets(h.name, h.value)) if (v) found.add(v);
      h.value = '[redacted]';
    }
    for (const value of Object.values(node)) visit(value);
  };
  const lines = data.toString('utf8').split('\n').map(line => {
    if (!line.trim()) return line;
    let parsed;
    try { parsed = JSON.parse(line); } catch { fail('SECRET_EXPOSURE', 'The trace network log could not be scanned for credentials; the trace was not exported'); }
    visit(parsed);
    return JSON.stringify(parsed);
  });
  return { data: Buffer.from(lines.join('\n'), 'utf8'), values: [...found] };
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
    const launched = this.chromium.launch({ executablePath, headless: true, args: [`--host-resolver-rules=MAP * ~NOTFOUND, ${hosts.map(h => `EXCLUDE ${h}`).join(', ')}`, ...S0_ARGS] });
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
      const session = new UiSession({ browser: await this.#browser(entry), entry, origin, holdPaths: entry.source.holdPaths ?? DEFAULT_HOLD, safeGets: entry.source.safeGets ?? null, scrub: this.scrub,
        maxSteps: entry.limits?.maxSteps ?? 30, observationTokens: entry.limits?.observationTokens ?? 2500 });
      await session.open({ login });
      // The first page loads only when the owner attested '/' as a safe GET; otherwise the session starts blank and its first page load is
      // an approved observe {path} (a GET nobody attested could have a side effect).
      if (session.autoNavigable(new URL('/', origin).toString())) await session.goto('/');
      return session;
    })();
    this.#sessions.set(key, pending);
    try { return await pending; } catch (error) { this.#sessions.delete(key); throw error; }
  }
  has({ runId, node, entry }) { return this.#sessions.has(`${runId}\u0000${node}\u0000${entry.id}`); }
  /** The host rendering of one held request of an EXISTING session (never opens one): null when there is no such session or request. */
  async held({ runId, node, entry, id }) {
    const session = this.#sessions.get(`${runId}\u0000${node}\u0000${entry.id}`);
    return session ? (await session.catch(() => null))?.describeHeld(id) ?? null : null;
  }
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
  // The model names a held request by its id only: what is sent, and what the person approves, is the host's own record of it.
  commit: ['Send one held request exactly once, after a person approves it.', { type: 'object', additionalProperties: false, required: ['id'], properties: { id: S(40) } }],
  'trace.export': ['Save the browser trace of this session as an artifact.', { type: 'object', additionalProperties: false, properties: {} }]
};
const VERB = { observe: 'observe', find: 'search', act: 'navigate', extract: 'read', assert: 'observe', commit: 'update', 'trace.export': 'read' };
// The view name a model sees for each member (review-cost M2): `find` and `act` are tool-protocol actions, so their views are named
// `_locate` and `_interact` (a model that saw `stockroom_ui_act` sent clicks as protocol acts). Member ids and tools keep their names.
const VIEW_NAME = { find: 'locate', act: 'interact', 'trace.export': 'trace_export' };
// Members a tool node's model has no use for (review-cost M3): the trace is exported when the node closes, and `assert` is a check for a
// verify node. They stay members (a requirement or a Tier-0 node can still name them); they never enter a tool node's standby.
const NOT_FOR_TOOL_NODES = new Set(['trace.export', 'assert']);
// Members that can make the browser issue a GET (navigate, click, reload): effects none only behind an owner safe-GET allowlist.
const NAVIGATING = new Set(['observe', 'act', 'assert']);

/** Origins as pinned: a development (loopback) entry's port is dropped, as for MCP HTTP sources, so a fresh world keeps the same pins. */
const pinnedOrigins = entry => entry.dev === true ? entry.source.origins.map(o => { const u = new URL(o); u.port = ''; return u.origin; }) : entry.source.origins;
/** The effect class of one ui.* member of `entry` (see the header: navigating members are effects none only with a safe-GET allowlist). */
export function uiEffects(entry, action) {
  if (action === 'commit') return { effects: 'non-idempotent', risk: 'high', requiresApproval: true };
  if (action === 'trace.export') return { effects: 'idempotent', risk: 'low', requiresApproval: false };
  if (NAVIGATING.has(action) && !entry.source.safeGets) return { effects: 'non-idempotent', risk: 'high', requiresApproval: true };
  return { effects: 'none', risk: 'low', requiresApproval: false };
}
/** The ui.* members of one cua entry. Every output is labelled untrusted:web.<entry> (page text is third-party data). */
export function uiMembers(entry) {
  const label = `untrusted:web.${entry.id}`;
  return Object.entries(VIEW).map(([action, [summary, inputSchema]]) => {
    const effect = uiEffects(entry, action);
    return memberRecord({ entry, name: action, id: `ui.${entry.id}.${action}`, adapter: 'nodecap-ui/2',
      pins: { backend: entry.source.backend, origins: pinnedOrigins(entry), holdPaths: entry.source.holdPaths ?? DEFAULT_HOLD, safeGets: entry.source.safeGets ?? null, profile: entry.source.profile },
      attestation: { type: `ui.${action.replace('.', '-')}`, system: entry.id, verbs: [VERB[action]], objects: ['page'], ...effect,
        outputLabel: label, dataClass: 'private', egress: 'first-party', maxTimeoutMs: 30000, cost: 0, outputMode: 'structured', outputSchema: { type: 'object' },
        ...(NOT_FOR_TOOL_NODES.has(action) ? { toolNode: false } : {}),
        view: { name: `${entry.id.replace(/-/g, '_')}_${VIEW_NAME[action] ?? action}`, summary, inputSchema } } });
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
