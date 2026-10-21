// Nodecap P4: computer use on local Chromium against the Stockroom practice app (ARCHITECTURE.md §2.7, §3.5). One browser per file; the
// file skips with a reason when no Chromium is installed. Loopback only; $0; no model. Development tests: they establish mechanism
// behaviour on one browser build and a toy app, nothing about model reliability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkCatalog } from '../src/capabilities/catalog.mjs';
import { UiSessions, chromiumPath, uiMembers, invokeUi } from '../src/capabilities/cua.mjs';
import { ScrubSet } from '../src/capabilities/credentials.mjs';
import { startStockroom } from '../experiments/nodecap/fixtures/stockroom/app.mjs';
import { catalogOf, workspace } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const executable = chromiumPath();
const skip = executable ? false : 'no Chromium executable installed (FOUNDRY_CHROMIUM, /opt/pw-browsers/chromium-1194, /usr/bin/chromium)';
const PASSWORD = `pw-${randomUUID()}`;
const env = { STOCKROOM_USER: 'ops@stockroom.test', STOCKROOM_PASSWORD: PASSWORD };
let chromium, sessions, scrub;

function cuaEntry(origin) {
  return checkCatalog(catalogOf({ id: 'stockroom-ui', kind: 'cua', trust: 'T0', status: 'active', dev: true,
    source: { backend: 'playwright-local', origins: [origin], profile: 'S0' },
    login: { path: '/login', user: { env: 'STOCKROOM_USER' }, password: { env: 'STOCKROOM_PASSWORD' } }, limits: { maxSteps: 60, observationTokens: 2500 } }), { allowDev: true }).entries[0];
}
async function world(t, options = {}) {
  const app = await startStockroom({ password: PASSWORD, ...options });
  t.after(() => app.close());
  const entry = cuaEntry(app.origin), runId = `run-${randomUUID().slice(0, 8)}`;
  t.after(() => sessions.closeRun(runId));
  const session = await sessions.get({ runId, node: 'work', entry });
  return { app, entry, session, runId };
}
const indexOf = (obs, role, name) => obs.items.find(i => i.role === role && i.name === name)?.i;

test.before(async () => {
  if (skip) return;
  ({ chromium } = await import('playwright'));
  scrub = new ScrubSet();
  sessions = new UiSessions({ chromium, scrub, env });
});
test.after(async () => { await sessions?.close(); });

test('cua G3: Chromium launches headless from an explicit executablePath; login is host-side and unobserved', { skip }, async t => {
  const { app, session } = await world(t);
  assert.equal(app.ledger.logins, 1);
  const obs = await session.observe();
  assert.equal(obs.title, 'Inventory');
  assert.ok(indexOf(obs, 'button', 'Save item'));
  assert.equal(scrub.contains(`x${PASSWORD}x`), true, 'the login secret is in the scrub set');
  assert.doesNotMatch(JSON.stringify(obs), new RegExp(PASSWORD));
});

test('cua: the planner view is indexed and interactive-only; hidden injection text never enters it; passwords are redacted', { skip }, async t => {
  const { session } = await world(t);
  const obs = await session.observe();
  assert.deepEqual(obs.items.map(i => i.i), obs.items.map((_, n) => n + 1));
  assert.ok(obs.items.every(i => ['button', 'link', 'textbox', 'spinbutton'].includes(i.role)), JSON.stringify(obs.items.map(i => i.role)));
  assert.doesNotMatch(JSON.stringify(obs), /SYSTEM NOTICE|attacker@example/);
  // ...but extract (bounded, labelled untrusted) can still read it as data.
  assert.match((await session.extract({ text: true })).text, /SYSTEM NOTICE/);
  const settings = await session.goto('/settings');
  const field = indexOf(settings, 'textbox', 'New password');
  const filled = await session.act({ basis: settings.basis, index: field, op: 'fill', value: 'hunter2-typed' });
  assert.equal(filled.ok, true);
  assert.equal(filled.observation.items.find(i => i.name === 'New password').value, '[redacted]');
  assert.doesNotMatch(JSON.stringify(filled), /hunter2-typed/);
});

test('cua: acting on a stale basis is refused; the observation must be refreshed', { skip }, async t => {
  const { session } = await world(t);
  const first = await session.observe();
  const next = indexOf(first, 'link', 'Next page');
  const moved = await session.act({ basis: first.basis, index: next, op: 'click' });
  assert.equal(moved.ok, true);
  assert.notEqual(moved.observation.basis, first.basis);
  await assert.rejects(session.act({ basis: first.basis, index: next, op: 'click' }), code('STALE_BASIS'));
  await assert.rejects(session.act({ basis: moved.observation.basis, index: 999, op: 'click' }), code('TARGET_UNKNOWN'));
});

test('cua: every non-GET is held (COMMIT_REQUIRED) and the server ledger is unchanged; commit sends exactly one, once', { skip }, async t => {
  const { app, session } = await world(t);
  let obs = await session.observe();
  for (const [name, value] of [['Name', 'Gadget Z'], ['Quantity', '12']]) {
    const r = await session.act({ basis: obs.basis, index: obs.items.find(i => i.name === name).i, op: 'fill', value });
    obs = r.observation;
  }
  const saved = await session.act({ basis: obs.basis, index: indexOf(obs, 'button', 'Save item'), op: 'click' });
  assert.equal(saved.code, 'COMMIT_REQUIRED');
  const [pending] = saved.pending;
  assert.deepEqual([pending.method, pending.path], ['POST', '/api/items']);
  assert.match(pending.bodyHash, /^[0-9a-f]{64}$/);
  assert.match(pending.bodyPreview, /Gadget Z/);
  const del = await session.act({ basis: saved.observation.basis, index: indexOf(saved.observation, 'button', 'Delete all'), op: 'click' });
  assert.equal(del.code, 'COMMIT_REQUIRED');
  // A form POST navigation (vendor address) is held too, and the page is restored rather than left on an error page.
  let vendor = await session.goto('/vendors/V-9');
  vendor = (await session.act({ basis: vendor.basis, index: vendor.items.find(i => i.name === 'Street').i, op: 'fill', value: '7 New Street' })).observation;
  const addr = await session.act({ basis: vendor.basis, index: indexOf(vendor, 'button', 'Save address'), op: 'click' });
  assert.equal(addr.code, 'COMMIT_REQUIRED');
  assert.equal(addr.observation.path, '/vendors/V-9');
  // A GET on a hold path (logout) is held as well.
  const out = await session.act({ basis: addr.observation.basis, index: indexOf(addr.observation, 'link', 'Sign out'), op: 'click' });
  assert.equal(out.code, 'COMMIT_REQUIRED');
  assert.equal(out.pending[0].method, 'GET');
  assert.deepEqual(app.ledger.writes, [], 'no write reached the server');
  assert.equal(app.ledger.logouts, 0);
  // Commit replays exactly the held request, once; the descriptor must match; a second identical commit is refused.
  const descriptor = ({ id, method, origin, path: p, bodyHash }) => ({ id, method, origin, path: p, bodyHash });
  await assert.rejects(session.commit({ ...descriptor(addr.pending[0]), bodyHash: '0'.repeat(64) }), code('COMMIT_MISMATCH'));
  const committed = await session.commit(descriptor(addr.pending[0]));
  assert.equal(committed.committed, true);
  assert.deepEqual(app.ledger.writes, [{ kind: 'vendor.address', vendor: 'V-9', street: '7 New Street', city: 'Leeds' }]);
  await assert.rejects(session.commit(descriptor(addr.pending[0])), code('COMMIT_UNKNOWN'));
  assert.equal(app.ledger.writes.length, 1);
  assert.equal((await session.assert({ textPresent: '7 New Street, Leeds' })).pass, true, 'verified on the DOM after reload');
});

test('cua: off-allowlist links and redirect hops are blocked (ORIGIN_VIOLATION) and the page is restored', { skip }, async t => {
  const { session } = await world(t);
  const obs = await session.observe();
  const partner = await session.act({ basis: obs.basis, index: indexOf(obs, 'link', 'Partner portal'), op: 'click' });
  assert.equal(partner.code, 'ORIGIN_VIOLATION');
  assert.equal(partner.observation.title, 'Inventory');
  const hop = await session.act({ basis: partner.observation.basis, index: indexOf(partner.observation, 'link', 'Old reports'), op: 'click' });
  assert.equal(hop.code, 'ORIGIN_VIOLATION', 'the redirect to evil.test is caught by the resolver rule plus the post-action origin check');
  assert.equal(hop.observation.title, 'Inventory');
  await assert.rejects(session.goto('https://evil.example/'), code('ORIGIN_VIOLATION'));
});

test('cua: the toast lies; only a check on the reloaded DOM and the server oracle tell the truth', { skip }, async t => {
  const { app, session } = await world(t, { toastLies: true });
  let obs = await session.observe();
  for (const [name, value] of [['Name', 'Phantom'], ['Quantity', '4']]) obs = (await session.act({ basis: obs.basis, index: obs.items.find(i => i.name === name).i, op: 'fill', value })).observation;
  const held = await session.act({ basis: obs.basis, index: indexOf(obs, 'button', 'Save item'), op: 'click' });
  // The page's toast says "Saved" even though the write was held and never sent: a toast-level check passes and proves nothing.
  assert.equal((await session.assert({ textPresent: 'Saved Phantom', noReload: true })).pass, true);
  await session.commit(held.pending[0]);
  // The server acknowledged (toastLies drops the write); a toast-level check would pass, the reload check and the oracle fail.
  assert.equal(app.ledger.writes.length, 0);
  assert.equal((await session.assert({ rowContains: 'Phantom', table: 'Items' })).pass, false);
  const page3 = await session.goto('/?page=3');
  assert.ok(page3.items.length > 0);
  assert.equal((await session.assert({ rowContains: 'Phantom', table: 'Items' })).pass, false);
});

test('cua: ui.* members, and a trace artifact that holds no login secret', { skip }, async t => {
  const { entry, runId } = await world(t);
  const members = uiMembers(entry);
  assert.deepEqual(members.map(m => [m.id, m.effects]), [['ui.stockroom-ui.observe', 'none'], ['ui.stockroom-ui.find', 'none'], ['ui.stockroom-ui.act', 'none'],
    ['ui.stockroom-ui.extract', 'none'], ['ui.stockroom-ui.assert', 'none'], ['ui.stockroom-ui.commit', 'non-idempotent'], ['ui.stockroom-ui.trace.export', 'idempotent']]);
  assert.ok(members.every(m => m.outputLabel === 'untrusted:web.stockroom-ui'));
  assert.equal(members.find(m => m.tool === 'commit').requiresApproval, true);
  const obs = await invokeUi(members[0], sessions, {}, { runId, node: 'work', entry });
  const rows = await invokeUi(members[3], sessions, { table: 'Items' }, { runId, node: 'work', entry });
  assert.equal(rows.rows.length, 11);
  assert.ok(obs.basis);
  const dir = workspace(t);
  const exported = await invokeUi(members.at(-1), sessions, {}, { runId, node: 'work', entry, artifactsDir: dir });
  assert.match(exported.file, /^ui-trace-[0-9a-f]{16}\.zip$/);
  assert.deepEqual(readdirSync(dir), [exported.file]);
  const listing = execFileSync('unzip', ['-l', path.join(dir, exported.file)], { encoding: 'utf8' });
  assert.match(listing, /trace/);
  const contents = execFileSync('unzip', ['-p', path.join(dir, exported.file)], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1');
  assert.ok(contents.length > 1000);
  assert.equal(contents.includes(PASSWORD), false, 'the trace (unzipped) never holds the login password');
});
