// The spike's activation ledger: which exact workflow version a person approved to run, after which practice run, through which
// human channel. Rows change only by compare-and-swap on `rev` (AGENTS.md build discipline). It lives beside the Foundry store, not in it,
// because the brief forbids src/ changes; DESIGN.md §8 proposes folding it into the store's proposal/apply transaction.
//
// Execution authority stays outside the model: decide() accepts only the human channels below. The MCP tool surface never calls it
// with a decision of its own; it can only relay a decision the person made in the client's elicitation dialog.
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
        dry_run_id TEXT NOT NULL, status TEXT NOT NULL, requested_at INTEGER NOT NULL, decided_at INTEGER, channel TEXT, principal TEXT, note TEXT, rev INTEGER NOT NULL);`);
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
  #row(r) { return r ? { id: r.id, flowId: r.flow_id, proposalId: r.proposal_id, workflowHash: r.workflow_hash, dryRunId: r.dry_run_id, status: r.status,
    requestedAt: r.requested_at, decidedAt: r.decided_at, channel: r.channel, principal: r.principal, note: r.note, rev: r.rev } : null; }
  activation(id) { if (typeof id !== 'string' || !id) throw new FoundryError('NOT_FOUND', 'No such approval request'); const r = this.#row(this.db.prepare('SELECT * FROM activations WHERE id=?').get(id)); if (!r) throw new FoundryError('NOT_FOUND', 'No such approval request'); return r; }
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
  /** The approved activation for an exact workflow hash, if any. */
  approvedFor(flowId, workflowHash) {
    return this.#row(this.db.prepare("SELECT * FROM activations WHERE flow_id=? AND workflow_hash=? AND status='approved' ORDER BY decided_at DESC LIMIT 1").get(flowId, workflowHash));
  }
  pending() { return this.db.prepare("SELECT * FROM activations WHERE status='pending' ORDER BY requested_at").all().map(r => this.#row(r)); }
  forFlow(flowId) { return this.db.prepare('SELECT * FROM activations WHERE flow_id=? ORDER BY requested_at DESC').all(flowId).map(r => this.#row(r)); }
}
