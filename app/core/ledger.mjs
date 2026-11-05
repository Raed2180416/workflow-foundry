// The spike's activation ledger: which exact workflow version a person approved to run, after which practice run, through which
// human channel. Rows change only by compare-and-swap on `rev` (AGENTS.md build discipline). It lives beside the Foundry store, not in it,
// because the brief forbids src/ changes; DESIGN.md §8 proposes folding it into the store's proposal/apply transaction.
//
// Execution authority stays outside the model: decide() accepts only the human channels below. The MCP tool surface never calls it
// with a decision of its own; it can only relay a decision the person made in the client's elicitation dialog.
//
// Since the UX review of 2026-10-21 (M7; SPEC §5 A5: "undo: turn off"): a person can turn an approved version off, and remove a draft
// they will not use. Neither rewrites history: the yes stays in `activations` as it was decided, and a turn-off is its own row in
// `turn_offs`, one per yes (the primary key makes a second turn-off of the same yes lose, as a compare-and-swap would). Turning on again
// is a new request and a new yes. A removed draft is a row in `withdrawn`: it no longer waits for a yes and cannot be turned on; the
// Foundry store keeps the proposal itself (src/ is frozen), as a record.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { FoundryError } from '../../src/data.mjs';

export const HUMAN_CHANNELS = Object.freeze(['dashboard', 'cli', 'mcp-elicitation']);

export class Ledger {
  constructor(file, { now = Date.now } = {}) {
    this.db = new DatabaseSync(file); this.now = now;
    try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS dry_runs(id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, workflow_hash TEXT NOT NULL, registry_hash TEXT NOT NULL,
        practice_run_id TEXT NOT NULL, passed INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS activations(id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, proposal_id TEXT NOT NULL, workflow_hash TEXT NOT NULL,
        dry_run_id TEXT NOT NULL, status TEXT NOT NULL, requested_at INTEGER NOT NULL, decided_at INTEGER, channel TEXT, principal TEXT, note TEXT, rev INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS turn_offs(activation_id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, workflow_hash TEXT NOT NULL, at INTEGER NOT NULL,
        channel TEXT NOT NULL, principal TEXT, note TEXT);
      CREATE TABLE IF NOT EXISTS withdrawn(proposal_id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, at INTEGER NOT NULL, channel TEXT NOT NULL, principal TEXT);
      CREATE TABLE IF NOT EXISTS freeform(proposal_id TEXT PRIMARY KEY, workflow_hash TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);`);
  }
  /** A free-form proposal (app/FRONT-DOOR.md): who built it, its practice cases and outside effects, as checked when it was proposed. Written once. */
  recordFreeform({ proposalId, workflowHash, body }) {
    this.db.prepare('INSERT INTO freeform VALUES(?,?,?,?)').run(proposalId, workflowHash, JSON.stringify(body), this.now());
    return this.freeform(proposalId);
  }
  freeform(proposalId) {
    if (typeof proposalId !== 'string') return null;
    const r = this.db.prepare('SELECT * FROM freeform WHERE proposal_id=?').get(proposalId);
    return r ? { proposalId: r.proposal_id, workflowHash: r.workflow_hash, body: JSON.parse(r.body), at: r.at } : null;
  }
  close() { try { this.db.close(); } catch { /* closed */ } }
  recordDryRun({ proposalId, workflowHash, registryHash, practiceRunId, passed, body }) {
    const row = { id: randomUUID(), proposalId, workflowHash, registryHash, practiceRunId, passed: !!passed, body, at: this.now() };
    this.db.prepare('INSERT INTO dry_runs VALUES(?,?,?,?,?,?,?,?)').run(row.id, proposalId, workflowHash, registryHash, practiceRunId, passed ? 1 : 0, JSON.stringify(body), row.at);
    return row;
  }
  latestDryRun(proposalId) {
    if (typeof proposalId !== 'string') return null;
    const r = this.db.prepare('SELECT * FROM dry_runs WHERE proposal_id=? ORDER BY at DESC, rowid DESC LIMIT 1').get(proposalId);
    return r ? { id: r.id, proposalId: r.proposal_id, workflowHash: r.workflow_hash, registryHash: r.registry_hash, practiceRunId: r.practice_run_id, passed: !!r.passed, body: JSON.parse(r.body), at: r.at } : null;
  }
  // A row with its turn-off, if any (turnedOff: { at, channel, principal, note }).
  static #WITH_OFF = 'SELECT a.*, t.at AS off_at, t.channel AS off_channel, t.principal AS off_principal, t.note AS off_note FROM activations a LEFT JOIN turn_offs t ON t.activation_id = a.id';
  #row(r) { return r ? { id: r.id, flowId: r.flow_id, proposalId: r.proposal_id, workflowHash: r.workflow_hash, dryRunId: r.dry_run_id, status: r.status,
    requestedAt: r.requested_at, decidedAt: r.decided_at, channel: r.channel, principal: r.principal, note: r.note, rev: r.rev,
    turnedOff: r.off_at === null || r.off_at === undefined ? null : { at: r.off_at, channel: r.off_channel, principal: r.off_principal, note: r.off_note } } : null; }
  activation(id) { if (typeof id !== 'string' || !id) throw new FoundryError('NOT_FOUND', 'No such approval request'); const r = this.#row(this.db.prepare(`${Ledger.#WITH_OFF} WHERE a.id=?`).get(id)); if (!r) throw new FoundryError('NOT_FOUND', 'No such approval request'); return r; }
  /** One open request per proposal: asking again returns the open one instead of piling up. */
  requestActivation({ flowId, proposalId, workflowHash, dryRunId }) {
    const open = this.db.prepare("SELECT * FROM activations WHERE proposal_id=? AND status='pending'").get(proposalId);
    if (open) return { ...this.#row(open), reused: true };
    const id = randomUUID();
    this.db.prepare("INSERT INTO activations VALUES(?,?,?,?,?,'pending',?,NULL,NULL,NULL,NULL,0)").run(id, flowId, proposalId, workflowHash, dryRunId, this.now());
    return { ...this.activation(id), reused: false };
  }
  /** A person's decision. Compare-and-swap on rev: a second, concurrent decision loses with ACTIVATION_CONFLICT and changes nothing. */
  decide(id, approved, { channel, principal = 'local-user', note = null, expectRev }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Approvals come only from a person (${HUMAN_CHANNELS.join(', ')}), not from ${channel}`);
    if (typeof approved !== 'boolean') throw new FoundryError('APPROVAL_AUTHORITY', 'An explicit yes or no is required');
    const current = this.activation(id);
    const rev = expectRev ?? current.rev;
    const changed = this.db.prepare("UPDATE activations SET status=?, decided_at=?, channel=?, principal=?, note=?, rev=rev+1 WHERE id=? AND rev=? AND status='pending'")
      .run(approved ? 'approved' : 'rejected', this.now(), channel, String(principal).slice(0, 200), note ? String(note).slice(0, 1000) : null, id, rev).changes;
    if (changed !== 1) throw new FoundryError('ACTIVATION_CONFLICT', 'This request was already decided or changed; reload and decide again', { status: current.status, rev: current.rev });
    return this.activation(id);
  }
  /** The approved activation for an exact workflow hash that is still on (not turned off), if any. */
  approvedFor(flowId, workflowHash) {
    return this.#row(this.db.prepare(`${Ledger.#WITH_OFF} WHERE a.flow_id=? AND a.workflow_hash=? AND a.status='approved' AND t.activation_id IS NULL ORDER BY a.decided_at DESC LIMIT 1`).get(flowId, workflowHash));
  }
  /** Requests still waiting for a yes: a removed draft's request no longer waits. */
  pending() { return this.db.prepare(`${Ledger.#WITH_OFF} WHERE a.status='pending' AND NOT EXISTS (SELECT 1 FROM withdrawn w WHERE w.proposal_id = a.proposal_id) ORDER BY a.requested_at`).all().map(r => this.#row(r)); }
  forFlow(flowId) { return this.db.prepare(`${Ledger.#WITH_OFF} WHERE a.flow_id=? ORDER BY a.requested_at DESC`).all(flowId).map(r => this.#row(r)); }
  /** A person turns an approved version off. Only a human channel; only a yes that is on; a second turn-off of the same yes loses. */
  turnOff(id, { channel, principal = 'local-user', note = null }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person turns an automation off (${HUMAN_CHANNELS.join(', ')}), not ${channel}`);
    const current = this.activation(id);
    if (current.status !== 'approved') throw new FoundryError('NOT_ON', 'This version is not on');
    try {
      this.db.prepare('INSERT INTO turn_offs VALUES(?,?,?,?,?,?,?)').run(id, current.flowId, current.workflowHash, this.now(), channel, String(principal).slice(0, 200), note ? String(note).slice(0, 1000) : null);
    } catch (error) {
      if (/UNIQUE|PRIMARY KEY/i.test(String(error?.message))) throw new FoundryError('ALREADY_OFF', 'This automation was already turned off');
      throw error;
    }
    return this.activation(id);
  }
  /** A person removes a draft (a proposal not turned on). A second removal loses. */
  withdraw(proposalId, { flowId, channel, principal = 'local-user' }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person removes a draft, not ${channel}`);
    try { this.db.prepare('INSERT INTO withdrawn VALUES(?,?,?,?,?)').run(proposalId, flowId, this.now(), channel, String(principal).slice(0, 200)); }
    catch (error) { if (/UNIQUE|PRIMARY KEY/i.test(String(error?.message))) throw new FoundryError('ALREADY_REMOVED', 'This draft was already removed'); throw error; }
    return this.withdrawn(proposalId);
  }
  withdrawn(proposalId) { const r = this.db.prepare('SELECT * FROM withdrawn WHERE proposal_id=?').get(proposalId); return r ? { proposalId: r.proposal_id, flowId: r.flow_id, at: r.at, channel: r.channel, principal: r.principal } : null; }
}
