// The nodecap ledger (`.foundry/nodecap.sqlite`): mutable host records of the capability layer, ARCHITECTURE.md §2.1 and §3.2. Entry status
// (quarantine, revocation), observed pins, receipts, proposals, lock approvals and flow heads. Every write is a compare-and-swap on a
// revision; widening decisions (admit, bind into a lock, scope step-up) are accepted only from a person's channel (dashboard or CLI).
// Run grants are NOT authoritative here: they are adaptation decisions in the run's hash chain (src/store.mjs recordDecision); the
// grants_cache table is a lookup that is rebuilt from the chain.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, checkData } from '../data.mjs';
import { digest, fail } from './common.mjs';
import { STATUSES } from './catalog.mjs';

export const WIDEN_CHANNELS = Object.freeze(['dashboard', 'cli']);
// Status machine (catalog entries): imported → qualified → active ⇄ quarantined → revoked.
const TRANSITIONS = { imported: ['qualified', 'revoked'], qualified: ['active', 'quarantined', 'revoked'], active: ['quarantined', 'revoked'], quarantined: ['active', 'revoked'], revoked: [] };
const PROPOSAL_KINDS = ['capability.bind', 'capability.admit', 'capability.definition-changed', 'scope.step-up'];
const json = value => canonical(value);
const parse = row => row ? JSON.parse(row.body) : null;

/** A widening decision channel must be a person's (I3). An SDK client can answer an MCP elicitation itself, so elicitation never widens. */
export function requireWidenChannel(channel, allowed = WIDEN_CHANNELS) {
  if (!allowed.includes(channel)) fail('APPROVAL_CHANNEL_INSUFFICIENT', `Widening decisions are accepted only from ${allowed.join(' or ')}; ${String(channel).slice(0, 40)} cannot widen authority`, { channel });
  return channel;
}

export class NodecapLedger {
  constructor(workspace) {
    const dir = path.join(workspace, '.foundry');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink()) fail('LEDGER_PATH', '.foundry must not be a symlink');
    const file = path.join(dir, 'nodecap.sqlite');
    for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { if (lstatSync(f).isSymbolicLink()) fail('LEDGER_PATH', 'Ledger files must not be symlinks'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    this.file = file;
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS catalog_revs(id TEXT PRIMARY KEY, rev INTEGER NOT NULL, digest TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS entry_status(entry_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pins_observed(entry_id TEXT NOT NULL, server TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(entry_id, server));
      CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantine(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, code TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, rev INTEGER NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks(lock_hash TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lock_approvals(subject TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS heads(flow_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants_cache(run_id TEXT NOT NULL, node TEXT NOT NULL, member TEXT NOT NULL, decision_id TEXT NOT NULL, PRIMARY KEY(run_id, node, member));`);
  }
  close() { this.db.close(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // ---- catalog revision: which catalog digest the host last admitted (CAS on rev) ----
  catalogRev() { return this.db.prepare("SELECT rev, digest FROM catalog_revs WHERE id='catalog'").get() ?? { rev: 0, digest: null }; }
  setCatalog(catalogDigest, { expectedRev }) {
    return this.tx(() => {
      const current = this.catalogRev();
      if (current.rev !== expectedRev) fail('CONFLICT', `Catalog revision is ${current.rev}, not ${expectedRev}`, { rev: current.rev });
      this.db.prepare("INSERT INTO catalog_revs VALUES('catalog',?,?,?) ON CONFLICT(id) DO UPDATE SET rev=excluded.rev, digest=excluded.digest, at=excluded.at").run(expectedRev + 1, catalogDigest, Date.now());
      return { rev: expectedRev + 1, digest: catalogDigest };
    });
  }
  // ---- entry status ----
  status(entryId) { const row = this.db.prepare('SELECT rev, body FROM entry_status WHERE entry_id=?').get(entryId); return row ? { rev: row.rev, ...JSON.parse(row.body) } : null; }
  /** Move an entry along the status machine (CAS on its revision; 0 for an entry the ledger has not seen, whose status is `from`). */
  setStatus(entryId, { from, to, expectedRev = null, reason = '', actor = 'host' }) {
    if (!STATUSES.includes(to)) fail('LEDGER_STATUS', `Unknown status ${to}`);
    return this.tx(() => {
      const current = this.status(entryId), rev = current?.rev ?? 0, status = current?.status ?? from;
      if (expectedRev !== null && rev !== expectedRev) fail('CONFLICT', `Entry ${entryId} is at revision ${rev}, not ${expectedRev}`, { rev });
      if (!(TRANSITIONS[status] ?? []).includes(to)) fail('LEDGER_TRANSITION', `Entry ${entryId} cannot move from ${status} to ${to}`);
      const body = json({ status: to, reason: String(reason).slice(0, 300), actor: String(actor).slice(0, 40), at: Date.now() });
      if (current) {
        if (this.db.prepare('UPDATE entry_status SET rev=?, body=? WHERE entry_id=? AND rev=?').run(rev + 1, body, entryId, rev).changes !== 1) fail('CONFLICT', `Entry ${entryId} changed concurrently`);
      } else this.db.prepare('INSERT INTO entry_status VALUES(?,?,?)').run(entryId, 1, body);
      return { rev: rev + 1, status: to };
    });
  }
  /** Quarantine on observed drift (definition or behaviour change): recorded with its evidence, the entry stops being bindable at once. */
  quarantine(entryId, code, details = {}, { from = 'active' } = {}) {
    checkData(details);
    this.db.prepare('INSERT INTO quarantine(entry_id, code, body, at) VALUES(?,?,?,?)').run(entryId, code, json(details), Date.now());
    const current = this.status(entryId)?.status ?? from;
    if (current === 'quarantined' || current === 'revoked') return { status: current };
    return this.setStatus(entryId, { from, to: 'quarantined', reason: code, actor: 'host' });
  }
  quarantineLog(entryId) { return this.db.prepare('SELECT code, body, at FROM quarantine WHERE entry_id=? ORDER BY id').all(entryId).map(r => ({ code: r.code, at: r.at, ...JSON.parse(r.body) })); }
  // ---- pins and receipts ----
  recordPins(entryId, pins) {
    checkData(pins);
    this.db.prepare('INSERT INTO pins_observed VALUES(?,?,?,?) ON CONFLICT(entry_id, server) DO NOTHING').run(entryId, pins.server, json(pins), Date.now());
  }
  observedPins(entryId) { return this.db.prepare('SELECT body FROM pins_observed WHERE entry_id=? ORDER BY at').all(entryId).map(parse); }
  receipt(kind, body) {
    checkData(body);
    const id = `${kind}:${digest(body)}`;
    this.db.prepare('INSERT INTO receipts VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(id, kind, json(body));
    return id;
  }
  receipts(kind) { return this.db.prepare('SELECT id, body FROM receipts WHERE kind=? ORDER BY rowid').all(kind).map(r => ({ id: r.id, ...JSON.parse(r.body) })); }
  // ---- locks and their approvals ----
  putLock(lock) {
    const lockHash = `sha256:${digest(lock)}`;
    this.db.prepare('INSERT INTO locks VALUES(?,?) ON CONFLICT(lock_hash) DO NOTHING').run(lockHash, json(lock));
    return lockHash;
  }
  lock(lockHash) { return parse(this.db.prepare('SELECT body FROM locks WHERE lock_hash=?').get(lockHash)); }
  /** The approval subject of a version: what a person approves (the lowered workflow, its lock, the envelope and catalog it was resolved under, and the dry run shown). */
  static subject({ workflowHash, lockHash, envelopeDigest, catalogDigest, dryRunId = null }) { return `sha256:${digest({ workflowHash, lockHash, envelopeDigest, catalogDigest, dryRunId })}`; }
  approveLock(parts, { channel, actor = 'owner' }) {
    requireWidenChannel(channel);
    const subject = NodecapLedger.subject(parts);
    this.db.prepare('INSERT INTO lock_approvals VALUES(?,?) ON CONFLICT(subject) DO NOTHING').run(subject, json({ ...parts, channel, actor: String(actor).slice(0, 40), at: Date.now() }));
    return subject;
  }
  lockApproval(parts) { return parse(this.db.prepare('SELECT body FROM lock_approvals WHERE subject=?').get(NodecapLedger.subject(parts))); }
  // ---- proposals (foundry-capability-proposal/1) ----
  putProposal(proposal) {
    if (!PROPOSAL_KINDS.includes(proposal.kind)) fail('PROPOSAL_KIND', `Unknown proposal kind ${proposal.kind}`);
    const body = { schema: 'foundry-capability-proposal/1', id: proposal.id ?? `prop-${randomUUID()}`, status: 'open', createdAt: Date.now(), ...proposal };
    checkData(body);
    this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?)').run(body.id, 1, 'open', json(body));
    return { ...body, rev: 1 };
  }
  proposal(id) { const row = this.db.prepare('SELECT rev, status, body FROM proposals WHERE id=?').get(id); return row ? { ...JSON.parse(row.body), rev: row.rev, status: row.status } : null; }
  proposals({ status = null } = {}) {
    return (status ? this.db.prepare('SELECT id FROM proposals WHERE status=? ORDER BY rowid').all(status) : this.db.prepare('SELECT id FROM proposals ORDER BY rowid').all()).map(r => this.proposal(r.id));
  }
  /** A person decides a proposal (CAS on its revision; one winner among concurrent deciders). Only a widening channel decides. */
  decideProposal(id, { approve, channel, actor = 'owner', expectedRev }) {
    requireWidenChannel(channel);
    if (typeof approve !== 'boolean') fail('APPROVAL_AUTHORITY', 'An explicit approve true/false decision is required');
    return this.tx(() => {
      const current = this.proposal(id);
      if (!current) fail('NOT_FOUND', `No proposal ${id}`);
      if (current.status !== 'open' || current.rev !== expectedRev) fail('CONFLICT', `Proposal ${id} is ${current.status} at revision ${current.rev}`, { rev: current.rev, status: current.status });
      const status = approve ? 'approved' : 'declined', body = { ...current, status, decision: { approve, channel, actor: String(actor).slice(0, 40), at: Date.now() } };
      delete body.rev;
      if (this.db.prepare('UPDATE proposals SET rev=?, status=?, body=? WHERE id=? AND rev=?').run(expectedRev + 1, status, json(body), id, expectedRev).changes !== 1) fail('CONFLICT', `Proposal ${id} changed concurrently`);
      return { ...body, rev: expectedRev + 1 };
    });
  }
  // ---- flow heads: which (workflowHash, lockHash) a flow currently runs (CAS) ----
  head(flowId) { const row = this.db.prepare('SELECT rev, body FROM heads WHERE flow_id=?').get(flowId); return row ? { rev: row.rev, ...JSON.parse(row.body) } : null; }
  setHead(flowId, { workflowHash, lockHash, expectedRev = 0 }) {
    return this.tx(() => {
      const rev = this.head(flowId)?.rev ?? 0;
      if (rev !== expectedRev) fail('CONFLICT', `Flow ${flowId} head is at revision ${rev}, not ${expectedRev}`, { rev });
      const body = json({ workflowHash, lockHash, at: Date.now() });
      if (rev === 0) this.db.prepare('INSERT INTO heads VALUES(?,?,?)').run(flowId, 1, body);
      else if (this.db.prepare('UPDATE heads SET rev=?, body=? WHERE flow_id=? AND rev=?').run(rev + 1, body, flowId, rev).changes !== 1) fail('CONFLICT', `Flow ${flowId} head changed concurrently`);
      return { rev: rev + 1, workflowHash, lockHash };
    });
  }
  // ---- grants cache (rebuildable from the chain) ----
  cacheGrant(runId, node, member, decisionId) { this.db.prepare('INSERT INTO grants_cache VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(runId, node, member, decisionId); }
  cachedGrants(runId) { return this.db.prepare('SELECT node, member, decision_id AS decisionId FROM grants_cache WHERE run_id=? ORDER BY rowid').all(runId); }
}
