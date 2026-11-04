// The nodecap ledger (`.foundry/nodecap.sqlite`): mutable host records of the capability layer, ARCHITECTURE.md §2.1 and §3.2. Entry status
// (quarantine, revocation), observed pins and the pin baseline, receipts, proposals, lock approvals, per-call person decisions and flow
// heads. Every write is a compare-and-swap on a revision; widening decisions (admit, bind into a lock, re-activate an entry, accept new pins,
// a scope step-up) and per-call effect approvals are accepted only as a PersonDecision for the exact subject (./person.mjs), never as a
// channel name. Run grants are NOT authoritative here: they are adaptation decisions in the run's hash chain (src/store.mjs
// recordDecision); the grants_cache table is a lookup that is rebuilt from the chain.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, checkData } from '../data.mjs';
import { digest, fail } from './common.mjs';
import { STATUSES } from './catalog.mjs';
import { acceptPerson, DEFAULT_PERSON_CHANNELS, PERSON_CHANNELS, subjectOf } from './person.mjs';

// Status machine (catalog entries): imported → qualified → active ⇄ quarantined → revoked. A move TO active widens (the entry becomes
// bindable) and needs a person; quarantine and revocation narrow and are host actions.
const TRANSITIONS = { imported: ['qualified', 'revoked'], qualified: ['active', 'quarantined', 'revoked'], active: ['quarantined', 'revoked'], quarantined: ['active', 'revoked'], revoked: [] };
const PROPOSAL_KINDS = ['capability.bind', 'capability.admit', 'capability.definition-changed', 'scope.step-up'];
// Kinds whose approval names exactly one offered candidate.
const CHOICE_KINDS = ['capability.bind', 'capability.admit'];
const json = value => canonical(value);
const parse = row => row ? JSON.parse(row.body) : null;

export class NodecapLedger {
  /** `channels`: the person channels whose decisions this ledger accepts (default cli and dashboard; beds and tests add 'scripted'). */
  constructor(workspace, { channels = DEFAULT_PERSON_CHANNELS } = {}) {
    if (!Array.isArray(channels) || !channels.length || channels.some(c => !PERSON_CHANNELS.includes(c))) fail('LEDGER_CHANNELS', `Person channels are among ${PERSON_CHANNELS.join(', ')}`);
    this.channels = Object.freeze([...channels]);
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
      CREATE TABLE IF NOT EXISTS grants_cache(run_id TEXT NOT NULL, node TEXT NOT NULL, member TEXT NOT NULL, decision_id TEXT NOT NULL, PRIMARY KEY(run_id, node, member));
      CREATE TABLE IF NOT EXISTS pin_baseline(entry_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS person_decisions(subject TEXT PRIMARY KEY, body TEXT NOT NULL);`);
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
  /** The subject a person decides to move an entry to `to` from (status, rev). */
  static statusSubject({ entryId, status, to, rev }) { return subjectOf({ kind: 'entry.status', entryId, status, to, rev }); }
  /**
   * The current status of an entry: the ledger's record, else the status the owner wrote in the catalog entry (`catalog`, the host's
   * checked catalog), else 'imported' (the start of the machine). Never a status the caller claims (review-thesis #2).
   */
  currentStatus(entryId, { catalog = null } = {}) {
    const current = this.status(entryId);
    if (current) return { status: current.status, rev: current.rev };
    const entry = catalog?.entries?.find(e => e.id === entryId) ?? null;
    if (catalog && !entry) fail('LEDGER_ENTRY_UNKNOWN', `${entryId} is not an entry of the catalog`);
    return { status: entry?.status ?? 'imported', rev: 0 };
  }
  /**
   * Move an entry along the status machine (CAS on its revision: `expectedRev` is required, 0 for an entry the ledger has not recorded).
   * The status it moves FROM is derived (currentStatus), never passed. A move to active widens authority: it needs `person`, a
   * PersonDecision (approve) for statusSubject({entryId, status, to, rev}).
   */
  setStatus(entryId, { to, expectedRev, reason = '', actor = 'host', person = null, catalog = null, ...rest }) {
    if (Object.hasOwn(rest, 'from')) fail('LEDGER_FROM', 'The status an entry moves from is the ledger\'s record or the catalog\'s, never the caller\'s claim');
    if (!STATUSES.includes(to)) fail('LEDGER_STATUS', `Unknown status ${to}`);
    if (!Number.isSafeInteger(expectedRev)) fail('LEDGER_REV_REQUIRED', 'A status change is a compare-and-swap: pass expectedRev (0 for an entry the ledger has not recorded)');
    return this.tx(() => {
      const { status, rev } = this.currentStatus(entryId, { catalog });
      if (rev !== expectedRev) fail('CONFLICT', `Entry ${entryId} is at revision ${rev}, not ${expectedRev}`, { rev });
      if (!(TRANSITIONS[status] ?? []).includes(to)) fail('LEDGER_TRANSITION', `Entry ${entryId} cannot move from ${status} to ${to}`);
      let decided = null;
      if (to === 'active') {
        decided = acceptPerson(person, NodecapLedger.statusSubject({ entryId, status, to, rev }), { channels: this.channels });
        if (!decided.approve) fail('PERSON_DECLINED', `The person declined to activate ${entryId}`);
      }
      return this.#writeStatus(entryId, rev, json({ status: to, from: status, reason: String(reason).slice(0, 300), actor: decided ? decided.channel : String(actor).slice(0, 40), ...(decided ? { principal: decided.principal } : {}), at: Date.now() }), to);
    });
  }
  #writeStatus(entryId, rev, body, to) {
    if (rev === 0) this.db.prepare('INSERT INTO entry_status VALUES(?,?,?)').run(entryId, 1, body);
    else if (this.db.prepare('UPDATE entry_status SET rev=?, body=? WHERE entry_id=? AND rev=?').run(rev + 1, body, entryId, rev).changes !== 1) fail('CONFLICT', `Entry ${entryId} changed concurrently`);
    return { rev: rev + 1, status: to };
  }
  /** Quarantine on observed drift (definition or behaviour change): recorded with its evidence, the entry stops being bindable at once.
   *  Narrowing: from any status but revoked, by the host, with no person (its own compare-and-swap inside one transaction). */
  quarantine(entryId, code, details = {}) {
    checkData(details);
    return this.tx(() => {
      this.db.prepare('INSERT INTO quarantine(entry_id, code, body, at) VALUES(?,?,?,?)').run(entryId, code, json(details), Date.now());
      const current = this.status(entryId);
      if (current?.status === 'quarantined' || current?.status === 'revoked') return { status: current.status, rev: current.rev };
      return this.#writeStatus(entryId, current?.rev ?? 0, json({ status: 'quarantined', from: current?.status ?? null, reason: String(code).slice(0, 300), actor: 'host', at: Date.now() }), 'quarantined');
    });
  }
  quarantineLog(entryId) { return this.db.prepare('SELECT code, body, at FROM quarantine WHERE entry_id=? ORDER BY id').all(entryId).map(r => ({ code: r.code, at: r.at, ...JSON.parse(r.body) })); }
  // ---- pins and receipts ----
  recordPins(entryId, pins) {
    checkData(pins);
    this.db.prepare('INSERT INTO pins_observed VALUES(?,?,?,?) ON CONFLICT(entry_id, server) DO NOTHING').run(entryId, pins.server, json(pins), Date.now());
  }
  observedPins(entryId) { return this.db.prepare('SELECT body FROM pins_observed WHERE entry_id=? ORDER BY at').all(entryId).map(parse); }
  /**
   * The reference pins of an entry without an attested pin: the first listing ever observed in this workspace (trust on first use, recorded
   * as such), until a person accepts a new definition (acceptPins). Every later qualification, in any process, is compared with it.
   */
  pinBaseline(entryId) { const row = this.db.prepare('SELECT rev, body FROM pin_baseline WHERE entry_id=?').get(entryId); return row ? { rev: row.rev, ...JSON.parse(row.body) } : null; }
  /** Record the first observed pins as the baseline (no-op when one exists). Returns the baseline in force. */
  firstPins(entryId, pins) {
    checkData(pins);
    this.db.prepare('INSERT INTO pin_baseline VALUES(?,?,?) ON CONFLICT(entry_id) DO NOTHING').run(entryId, 1, json({ pins, by: 'first-use', at: Date.now() }));
    return this.pinBaseline(entryId);
  }
  static pinsSubject({ entryId, pins, rev }) { return subjectOf({ kind: 'entry.pins', entryId, pins, rev }); }
  /** A person accepts a changed definition: the baseline becomes `pins` (CAS on its revision) and a quarantined entry becomes active again. */
  acceptPins(entryId, pins, { person, expectedRev }) {
    checkData(pins);
    return this.tx(() => {
      const current = this.pinBaseline(entryId), rev = current?.rev ?? 0;
      if (rev !== expectedRev) fail('CONFLICT', `The pin baseline of ${entryId} is at revision ${rev}, not ${expectedRev}`, { rev });
      const decided = acceptPerson(person, NodecapLedger.pinsSubject({ entryId, pins, rev }), { channels: this.channels });
      if (!decided.approve) fail('PERSON_DECLINED', `The person declined the new definition of ${entryId}`);
      const body = json({ pins, by: decided.channel, principal: decided.principal, at: Date.now() });
      if (rev === 0) this.db.prepare('INSERT INTO pin_baseline VALUES(?,?,?)').run(entryId, 1, body);
      else if (this.db.prepare('UPDATE pin_baseline SET rev=?, body=? WHERE entry_id=? AND rev=?').run(rev + 1, body, entryId, rev).changes !== 1) fail('CONFLICT', `The pin baseline of ${entryId} changed concurrently`);
      const status = this.status(entryId);
      if (status?.status === 'quarantined') {
        const body2 = json({ status: 'active', reason: 'definition accepted by a person', actor: decided.channel, principal: decided.principal, at: Date.now() });
        if (this.db.prepare('UPDATE entry_status SET rev=?, body=? WHERE entry_id=? AND rev=?').run(status.rev + 1, body2, entryId, status.rev).changes !== 1) fail('CONFLICT', `Entry ${entryId} changed concurrently`);
      }
      return { rev: rev + 1 };
    });
  }
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
  /** A person approves one version: `person` is a PersonDecision (approve) for NodecapLedger.subject(parts). */
  approveLock(parts, { person }) {
    const subject = NodecapLedger.subject(parts), decided = acceptPerson(person, subject, { channels: this.channels });
    if (!decided.approve) fail('PERSON_DECLINED', 'The person declined this version');
    this.db.prepare('INSERT INTO lock_approvals VALUES(?,?) ON CONFLICT(subject) DO NOTHING').run(subject, json({ ...parts, channel: decided.channel, principal: decided.principal, at: decided.at }));
    return subject;
  }
  /** The approval of one version, if a person approved it on a channel THIS ledger accepts (a bed's scripted approval in the same file
   *  does not count for a production ledger). */
  lockApproval(parts) { return this.#accepted(parse(this.db.prepare('SELECT body FROM lock_approvals WHERE subject=?').get(NodecapLedger.subject(parts)))); }
  #accepted(record) { return record && this.channels.includes(record.channel) ? record : null; }
  /** Whether a proposal was approved by a person on a channel this ledger accepts. */
  approvedProposal(id) { const p = this.proposal(id); return p?.status === 'approved' && this.channels.includes(p.decision?.channel) ? p : null; }
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
  /**
   * The subject a person decides for one proposal at one revision: its whole recorded body (what the dashboard or CLI renders) and, for an
   * approval of a capability.bind or capability.admit, the ONE candidate the person picked (review-thesis #1: a person approves one member,
   * never "the proposal as a whole").
   */
  static proposalSubject(proposal, { choice = null } = {}) {
    const { status, decision, applied, ...body } = proposal;
    return subjectOf({ kind: 'proposal', ...body, ...(choice !== null ? { choice } : {}) });
  }
  /**
   * A person decides a proposal (CAS on its revision; one winner among concurrent deciders): `person` is a PersonDecision for
   * proposalSubject(proposal, {choice}). Approving a capability.bind or capability.admit names exactly one offered candidate (`choice`).
   */
  decideProposal(id, { person, expectedRev, choice = null }) {
    return this.tx(() => {
      const current = this.proposal(id);
      if (!current) fail('NOT_FOUND', `No proposal ${id}`);
      if (current.status !== 'open' || current.rev !== expectedRev) fail('CONFLICT', `Proposal ${id} is ${current.status} at revision ${current.rev}`, { rev: current.rev, status: current.status });
      const picks = CHOICE_KINDS.includes(current.kind);
      if (choice !== null && (!picks || !(current.diff?.added ?? []).some(a => a.member === choice))) fail('PROPOSAL_CHOICE', `${String(choice).slice(0, 80)} is not a candidate this proposal offers`);
      const decided = acceptPerson(person, NodecapLedger.proposalSubject(current, { choice }), { channels: this.channels }), approve = decided.approve;
      if (approve && picks && choice === null) fail('PROPOSAL_CHOICE_REQUIRED', 'A person approves one candidate of a capability proposal, never the proposal as a whole');
      const status = approve ? 'approved' : 'declined', body = { ...current, status, decision: { approve, ...(approve && picks ? { choice } : {}), channel: decided.channel, principal: decided.principal, at: decided.at } };
      delete body.rev;
      if (this.db.prepare('UPDATE proposals SET rev=?, status=?, body=? WHERE id=? AND rev=?').run(expectedRev + 1, status, json(body), id, expectedRev).changes !== 1) fail('CONFLICT', `Proposal ${id} changed concurrently`);
      return { ...body, rev: expectedRev + 1 };
    });
  }
  /**
   * Consume an approved proposal once (CAS approved -> applied on its revision): the lock and workflow it produced are recorded, and no
   * later caller can apply the same approval again (review-thesis #1).
   */
  markApplied(id, { expectedRev, lockHash, workflowHash }) {
    return this.tx(() => {
      const current = this.proposal(id);
      if (!current) fail('NOT_FOUND', `No proposal ${id}`);
      if (current.status !== 'approved' || current.rev !== expectedRev) fail('PROPOSAL_APPLIED', `Proposal ${id} is ${current.status} at revision ${current.rev}; an approval is applied once`, { rev: current.rev, status: current.status });
      const body = { ...current, status: 'applied', applied: { lockHash, workflowHash, at: Date.now() } };
      delete body.rev;
      if (this.db.prepare('UPDATE proposals SET rev=?, status=?, body=? WHERE id=? AND rev=?').run(expectedRev + 1, 'applied', json(body), id, expectedRev).changes !== 1) fail('PROPOSAL_APPLIED', `Proposal ${id} changed concurrently`);
      return { ...body, rev: expectedRev + 1 };
    });
  }
  /** Open proposals for the same thing (kind and dedup key): a hostile server cannot raise one per turn. */
  openProposal(dedupKey) { return this.proposals({ status: 'open' }).find(p => p.dedupKey === dedupKey) ?? null; }
  /** Proposals raised during one run (every kind counts against the run's proposal limit). */
  proposalsOfRun(runId) { return this.proposals().filter(p => p.evidence?.runId === runId); }
  // ---- per-call person decisions (L2): the decision for one effect call, bound to the host's rendering of that call ----
  recordCallDecision(subject, person) {
    const decided = acceptPerson(person, subject, { channels: this.channels });
    this.db.prepare('INSERT INTO person_decisions VALUES(?,?) ON CONFLICT(subject) DO NOTHING').run(subject, json({ subject, ...decided }));
    return this.callDecision(subject);
  }
  callDecision(subject) { return this.#accepted(parse(this.db.prepare('SELECT body FROM person_decisions WHERE subject=?').get(subject))); }
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
