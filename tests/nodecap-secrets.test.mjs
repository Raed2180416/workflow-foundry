// Nodecap P7: secret canary sweep (ARCHITECTURE.md §2.6, I7). Canary credentials (HTTP bearer tokens and a UI login password) are used by
// a real run; afterwards no byte of the workspace (both SQLite databases and their WAL files, artifacts including unzipped traces), no
// event, decision or journal row, and no prompt holds them. A server that echoes the credential back is refused before the value can be
// written (SECRET_EXPOSURE). The sweep is itself checked on a planted copy (it must find what it looks for). $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { chromiumPath } from '../src/capabilities/cua.mjs';
import { construct, launch, subjectOf } from '../src/capabilities/launcher.mjs';
import { startTicketsServer } from '../experiments/nodecap/fixtures/servers/tickets-http.mjs';
import { startStockroom } from '../experiments/nodecap/fixtures/stockroom/app.mjs';
import { FIXTURES, catalogOf, ticketsEntry, workspace, openLedger, approveVersion } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const RETURNS = { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: 200 } } };

/** Every place a secret could land: all files under the workspace (zips unzipped), plus caller-supplied strings. */
function sweep(dir, canaries, extra = []) {
  const hits = [];
  const visit = d => {
    for (const name of readdirSync(d)) {
      const file = path.join(d, name), info = statSync(file);
      if (info.isDirectory()) { visit(file); continue; }
      let text = readFileSync(file).toString('latin1');
      if (name.endsWith('.zip')) text += execFileSync('unzip', ['-p', file], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1');
      for (const c of canaries) if (text.includes(c)) hits.push({ file: path.relative(dir, file), canary: c.slice(0, 12) });
    }
  };
  visit(dir);
  for (const [where, value] of extra) for (const c of canaries) if (String(value).includes(c)) hits.push({ where, canary: c.slice(0, 12) });
  return hits;
}

async function harness(t, { script, withUi }) {
  const dir = workspace(t), readToken = `canary-read-${randomUUID()}`, writeToken = `canary-write-${randomUUID()}`, password = `canary-pw-${randomUUID()}`;
  const tickets = await startTicketsServer({ readToken, writeToken });
  t.after(() => tickets.close());
  const entries = [ticketsEntry(tickets.url)];
  let app = null, chromium = null;
  if (withUi) {
    ({ chromium } = await import('playwright'));
    app = await startStockroom({ password }); t.after(() => app.close());
    // safeGets: the owner's attestation that these pages have no side effect on GET, so ui.observe is a read the node may use here.
    entries.push({ id: 'stockroom-ui', kind: 'cua', trust: 'T0', status: 'active', dev: true, source: { backend: 'playwright-local', origins: [app.origin], profile: 'S0', safeGets: ['/', '/vendors/*', '/invoices/*', '/settings'] },
      login: { path: '/login', user: { env: 'STOCKROOM_USER' }, password: { env: 'STOCKROOM_PASSWORD' } } });
  }
  const env = { NODECAP_TICKETS_READ_TOKEN: readToken, NODECAP_TICKETS_WRITE_TOKEN: writeToken, STOCKROOM_USER: 'ops@stockroom.test', STOCKROOM_PASSWORD: password };
  const catalog = checkCatalog(catalogOf(...entries), { allowDev: true });
  const store = new Store(dir), ledger = openLedger(dir), host = new NodecapHost({ catalog, ledger, envelope, env, chromium });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); try { store.close(); } catch {} try { ledger.close(); } catch {} });
  const workflow = { schemaVersion: '1.0', id: 'NodecapSecrets', version: 1, title: 'Secret sweep', goal: 'Read a ticket title', domain: 'diagnostic',
    envelope: { assumptions: ['fixture'], risks: [], successCriteria: ['title'] }, budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 },
    nodes: [{ id: 'work', kind: 'agent', needs: [], description: 'Tool node', role: 'extract', instructions: 'Read the ticket title.', returns: RETURNS, model: { class: 'M' } }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.work.title' } }] };
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire: { systems: ['tickets', 'stockroom-ui'], objects: ['ticket', 'page'], effectsMax: 'none', max: 4 }, maxTurns: 5 } } };
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  approveVersion(ledger, construction);
  const launched = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  // The session ids the app issued are secrets too (a session cookie carries the user's authority): swept for once the run has ended.
  return { dir, store, ledger, host, provider, canaries: [readToken, writeToken, password], sessionIds: () => app?.sessionIds() ?? [], ...launched };
}

test('secrets: canary credentials used by a real run appear nowhere in the workspace, the chain, the journal or any prompt', async t => {
  const withUi = !!chromiumPath();
  const script = [step({ action: 'read', tool: 'tickets_get', args: { id: 42 } }), ...(withUi ? [step({ action: 'read', tool: 'stockroom_ui_observe', args: {} })] : []),
    step({ action: 'done', answer: { title: 'Refund for order 7731' } })];
  const h = await harness(t, { script, withUi });
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(h.host.scrub.size >= 1, true, 'the resolved values are held in the scrub set');
  if (withUi) {
    assert.ok(run.frames['root/work__loop:1'].outputs.do.ok, 'the UI read ran (the trace and its cookies exist to be swept)');
    assert.equal(h.sessionIds().length, 1, 'the app issued one session');
  }
  const canaries = [...h.canaries, ...h.sessionIds()];
  const extra = [['events', JSON.stringify(h.store.events(run.id))], ['decisions', JSON.stringify(h.store.decisions(run.id))], ['journal', JSON.stringify(new Journal(h.store).forRun(run.id))],
    ...h.provider.calls.map((c, i) => [`prompt ${i}`, `${c.system}\n${c.prompt}`])];
  h.store.close(); h.ledger.close(); // flush to disk before reading the raw files
  assert.deepEqual(sweep(h.dir, canaries, extra), []);
  if (withUi) assert.equal(readdirSync(h.dir, { recursive: true }).filter(f => /ui-trace-[0-9a-f]{16}\.zip$/.test(f)).length, 1, 'the swept workspace holds the exported UI trace');
  // The sweep finds a planted copy (it is not vacuous).
  writeFileSync(path.join(h.dir, '.foundry', 'planted.txt'), `x ${h.canaries[0]} y`);
  assert.equal(sweep(h.dir, h.canaries).length, 1);
});

test('secrets: a server that echoes the credential is refused before the value is written (SECRET_EXPOSURE)', async t => {
  const h = await harness(t, { script: [step({ action: 'read', tool: 'tickets_get', args: { id: 99 } })], withUi: false });
  const run = await h.execute();
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'SECRET_EXPOSURE');
  const extra = [['events', JSON.stringify(h.store.events(run.id))], ['journal', JSON.stringify(new Journal(h.store).forRun(run.id))]];
  h.store.close(); h.ledger.close();
  assert.deepEqual(sweep(h.dir, h.canaries, extra), []);
});
