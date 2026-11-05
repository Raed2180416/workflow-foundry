// The condition ledger (task #60): one per flow, in the app workspace beside the activation ledger (app/core/ledger.mjs), never in
// src/ (frozen for this work). Every change is a version-bound proposal, a delta in OpenSpec's ADDED / MODIFIED / REMOVED form:
//   ADDED     a new condition (quote copied by pointer from the person's words)
//   MODIFIED  a new version of a condition (its summary, its check, its verification); carries the version it was based on
//   REMOVED   the condition is withdrawn; carries the version it was based on
// A proposal applies only if every MODIFIED / REMOVED base version is still current (compare-and-swap); the ledger version then moves
// by one. Proposals from the tracker reading the person's own words apply at once but leave the condition UNCONFIRMED; proposals from
// a model (MCP edit_conditions) wait for a person; only a person (app/core/ledger.mjs HUMAN_CHANNELS) confirms, accepts or waives.
// A waiver is bound to (condition version, workflow hash): it lapses when either changes.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { FoundryError } from '../../../src/data.mjs';
import { HUMAN_CHANNELS } from '../ledger.mjs';

export const STORE_VERSION = 'tracker-store/1';
export const OPS = Object.freeze(['ADDED', 'MODIFIED', 'REMOVED']);
export const PROPOSERS = Object.freeze(['tracker', 'model', 'person']);
const json = v => JSON.stringify(v ?? null);
const parse = s => (s == null ? null : JSON.parse(s));

export class ConditionStore {
  constructor(file, { now = Date.now } = {}) {
    this.db = new DatabaseSync(file); this.now = now;
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS ledgers(flow_id TEXT PRIMARY KEY, version INTEGER NOT NULL, words TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conditions(flow_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, confirmed INTEGER NOT NULL,
        body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(flow_id, id));
      CREATE TABLE IF NOT EXISTS condition_history(flow_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, proposal_id TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, base_version INTEGER NOT NULL, delta TEXT NOT NULL, proposed_by TEXT NOT NULL,
        status TEXT NOT NULL, channel TEXT, principal TEXT, note TEXT, created_at INTEGER NOT NULL, decided_at INTEGER, rev INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS results(flow_id TEXT NOT NULL, condition_id TEXT NOT NULL, condition_version INTEGER NOT NULL, workflow_hash TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(flow_id, condition_id, condition_version, workflow_hash));
      CREATE TABLE IF NOT EXISTS waivers(id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, condition_id TEXT NOT NULL, condition_version INTEGER NOT NULL, workflow_hash TEXT NOT NULL,
        why TEXT NOT NULL, channel TEXT NOT NULL, principal TEXT NOT NULL, at INTEGER NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS live_results(flow_id TEXT NOT NULL, condition_id TEXT NOT NULL, condition_version INTEGER NOT NULL, workflow_hash TEXT NOT NULL, run_id TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(flow_id, condition_id, condition_version, run_id));`);
  }
  close() { try { this.db.close(); } catch { /* closed */ } }

  ledger(flowId) {
    const l = this.db.prepare('SELECT * FROM ledgers WHERE flow_id=?').get(flowId);
    return l ? { flowId, version: l.version, words: parse(l.words), updatedAt: l.updated_at } : { flowId, version: 0, words: [], updatedAt: null };
  }
  #condition(r) { return r ? { ...parse(r.body), id: r.id, version: r.version, state: r.state, confirmed: !!r.confirmed } : null; }
  conditions(flowId, { all = false } = {}) {
    return this.db.prepare(`SELECT * FROM conditions WHERE flow_id=? ${all ? '' : "AND state='active'"} ORDER BY rowid`).all(flowId).map(r => this.#condition(r));
  }
  condition(flowId, id) {
    const c = this.#condition(this.db.prepare('SELECT * FROM conditions WHERE flow_id=? AND id=?').get(flowId, id));
    if (!c) throw new FoundryError('NOT_FOUND', `No condition ${id} on ${flowId}`);
    return c;
  }
  history(flowId, id) { return this.db.prepare('SELECT * FROM condition_history WHERE flow_id=? AND id=? ORDER BY version').all(flowId, id).map(r => ({ version: r.version, proposalId: r.proposal_id, at: r.at, ...parse(r.body) })); }
  #nextId(flowId) {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM conditions WHERE flow_id=?').get(flowId).n;
    return `C-${String(n + 1).padStart(3, '0')}`;
  }
  /** Record the person's words for this flow (append-only: a later turn never rewrites an earlier one). */
  setWords(flowId, words) {
    const cur = this.ledger(flowId);
    const keep = cur.words ?? [];
    if (keep.some((w, i) => words[i] && (words[i].text !== w.text || words[i].kind !== w.kind))) throw new FoundryError('WORDS_REWRITE', 'The person\'s earlier words cannot be rewritten; add a new turn instead');
    const merged = words.length >= keep.length ? words : keep;
    this.db.prepare('INSERT INTO ledgers(flow_id, version, words, updated_at) VALUES(?,?,?,?) ON CONFLICT(flow_id) DO UPDATE SET words=excluded.words, updated_at=excluded.updated_at')
      .run(flowId, cur.version, json(merged), this.now());
    return merged;
  }

  /** propose({ flowId, delta: [{ op, id?, baseVersion?, condition? }], by }) → proposal. Applies at once when by is 'tracker' or a person decides now. */
  propose({ flowId, delta, by, channel = null, principal = 'local-user', note = null }) {
    if (!PROPOSERS.includes(by)) throw new FoundryError('TRACKER_PROPOSER', `by must be one of ${PROPOSERS.join(', ')}`);
    if (!Array.isArray(delta) || !delta.length) throw new FoundryError('TRACKER_DELTA', 'A proposal needs at least one change');
    for (const d of delta) {
      if (!OPS.includes(d.op)) throw new FoundryError('TRACKER_DELTA', `op must be one of ${OPS.join(', ')}`);
      if (d.op !== 'ADDED' && (typeof d.id !== 'string' || !Number.isInteger(d.baseVersion))) throw new FoundryError('TRACKER_DELTA', `${d.op} needs the condition id and the version it is based on`);
      if (d.op !== 'REMOVED' && (!d.condition || typeof d.condition.quote !== 'string')) throw new FoundryError('TRACKER_DELTA', `${d.op} needs a condition with a quote`);
    }
    const id = randomUUID(), base = this.ledger(flowId).version;
    this.db.prepare("INSERT INTO proposals VALUES(?,?,?,?,?,'proposed',NULL,NULL,?,?,NULL,0)").run(id, flowId, base, json(delta), by, note ? String(note).slice(0, 1000) : null, this.now());
    if (by === 'tracker') return this.#apply(id, { channel: 'tracker', principal: 'tracker' });
    if (by === 'person') { if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `A person's edit comes from ${HUMAN_CHANNELS.join(', ')}, not from ${channel}`); return this.#apply(id, { channel, principal }); }
    return this.proposal(id);
  }
  proposal(id) {
    const r = this.db.prepare('SELECT * FROM proposals WHERE id=?').get(id);
    if (!r) throw new FoundryError('NOT_FOUND', 'No such condition proposal');
    return { id: r.id, flowId: r.flow_id, baseVersion: r.base_version, delta: parse(r.delta), by: r.proposed_by, status: r.status, channel: r.channel, principal: r.principal,
      note: r.note, createdAt: r.created_at, decidedAt: r.decided_at, rev: r.rev };
  }
  pending(flowId = null) {
    return this.db.prepare(`SELECT id FROM proposals WHERE status='proposed' ${flowId ? 'AND flow_id=?' : ''} ORDER BY created_at`).all(...(flowId ? [flowId] : [])).map(r => this.proposal(r.id));
  }
  /** A person's decision on a model's proposal. Compare-and-swap on the proposal's rev; stale bases make it 'superseded'. */
  decide(id, accept, { channel, principal = 'local-user', note = null, expectRev = null } = {}) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person decides on conditions (${HUMAN_CHANNELS.join(', ')}), not ${channel}`);
    if (typeof accept !== 'boolean') throw new FoundryError('APPROVAL_AUTHORITY', 'An explicit yes or no is required');
    const p = this.proposal(id);
    if (p.status !== 'proposed' || (expectRev !== null && expectRev !== p.rev)) throw new FoundryError('ACTIVATION_CONFLICT', 'This proposal was already decided or changed; reload and decide again', { status: p.status, rev: p.rev });
    if (!accept) {
      this.db.prepare("UPDATE proposals SET status='rejected', channel=?, principal=?, note=?, decided_at=?, rev=rev+1 WHERE id=? AND rev=?").run(channel, String(principal).slice(0, 200), note, this.now(), id, p.rev);
      return this.proposal(id);
    }
    return this.#apply(id, { channel, principal, note });
  }
  #apply(id, { channel, principal, note = null }) {
    const p = this.proposal(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stale = p.delta.filter(d => d.op !== 'ADDED').filter(d => {
        const cur = this.db.prepare('SELECT version, state FROM conditions WHERE flow_id=? AND id=?').get(p.flowId, d.id);
        return !cur || cur.version !== d.baseVersion || cur.state !== 'active';
      });
      if (stale.length) {
        this.db.prepare("UPDATE proposals SET status='superseded', channel=?, principal=?, note=?, decided_at=?, rev=rev+1 WHERE id=?").run(channel, principal, `stale: ${stale.map(d => d.id).join(', ')}`, this.now(), id);
        this.db.exec('COMMIT');
        throw new FoundryError('CONDITION_CONFLICT', `The condition changed since this edit was proposed (${stale.map(d => d.id).join(', ')}); propose it again`, { stale: stale.map(d => d.id) });
      }
      const at = this.now(), applied = [];
      for (const d of p.delta) {
        if (d.op === 'ADDED') {
          const cid = this.#nextId(p.flowId), body = { ...d.condition, origin: d.condition.origin ?? 'user' };
          const confirmed = channel !== 'tracker' && HUMAN_CHANNELS.includes(channel) ? 1 : 0;
          this.db.prepare("INSERT INTO conditions VALUES(?,?,1,'active',?,?,?)").run(p.flowId, cid, confirmed, json(body), at);
          this.db.prepare('INSERT INTO condition_history VALUES(?,?,1,?,?,?)').run(p.flowId, cid, json(body), id, at);
          applied.push({ op: 'ADDED', id: cid, version: 1 });
        } else if (d.op === 'MODIFIED') {
          const v = d.baseVersion + 1, body = { ...d.condition };
          const confirmed = HUMAN_CHANNELS.includes(channel) ? 1 : 0;
          this.db.prepare('UPDATE conditions SET version=?, body=?, confirmed=?, updated_at=? WHERE flow_id=? AND id=? AND version=?').run(v, json(body), confirmed, at, p.flowId, d.id, d.baseVersion);
          this.db.prepare('INSERT INTO condition_history VALUES(?,?,?,?,?,?)').run(p.flowId, d.id, v, json(body), id, at);
          applied.push({ op: 'MODIFIED', id: d.id, version: v });
        } else {
          this.db.prepare("UPDATE conditions SET state='removed', version=version+1, updated_at=? WHERE flow_id=? AND id=? AND version=?").run(at, p.flowId, d.id, d.baseVersion);
          applied.push({ op: 'REMOVED', id: d.id, version: d.baseVersion + 1 });
        }
      }
      const cur = this.ledger(p.flowId);
      this.db.prepare('INSERT INTO ledgers(flow_id, version, words, updated_at) VALUES(?,?,?,?) ON CONFLICT(flow_id) DO UPDATE SET version=version+1, updated_at=excluded.updated_at')
        .run(p.flowId, cur.version + 1, json(cur.words ?? []), at);
      this.db.prepare("UPDATE proposals SET status='accepted', channel=?, principal=?, note=COALESCE(?, note), decided_at=?, rev=rev+1 WHERE id=?").run(channel, String(principal).slice(0, 200), note, at, id);
      this.db.exec('COMMIT');
      return { ...this.proposal(id), applied, ledgerVersion: this.ledger(p.flowId).version };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* committed already */ }
      throw error;
    }
  }

  /** The person confirms a condition as theirs (it was read from their words, or they accept a suggested one). */
  confirm(flowId, conditionId, { channel, principal = 'local-user' }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person confirms a condition, not ${channel}`);
    const c = this.condition(flowId, conditionId);
    this.db.prepare('UPDATE conditions SET confirmed=1, updated_at=? WHERE flow_id=? AND id=? AND version=?').run(this.now(), flowId, conditionId, c.version);
    return this.condition(flowId, conditionId);
  }
  /** Waive one condition for one exact (condition version, workflow hash). A person only, with a reason. */
  waive(flowId, conditionId, { workflowHash, why, channel, principal = 'local-user' }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person waives a condition, not ${channel}`);
    if (typeof why !== 'string' || why.trim().length < 3) throw new FoundryError('WAIVER_REASON', 'Say why this condition can be set aside');
    if (typeof workflowHash !== 'string' || !workflowHash) throw new FoundryError('WAIVER_SCOPE', 'A waiver names the exact flow version it covers');
    const c = this.condition(flowId, conditionId), id = randomUUID();
    this.db.prepare('INSERT INTO waivers VALUES(?,?,?,?,?,?,?,?,?,1)').run(id, flowId, conditionId, c.version, workflowHash, why.trim().slice(0, 1000), channel, String(principal).slice(0, 200), this.now());
    return this.waiver(flowId, conditionId, { workflowHash });
  }
  unwaive(flowId, conditionId, { channel }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person lifts a waiver, not ${channel}`);
    this.db.prepare('UPDATE waivers SET active=0 WHERE flow_id=? AND condition_id=?').run(flowId, conditionId);
  }
  /** The active waiver for the CURRENT condition version and this workflow hash, if any. */
  waiver(flowId, conditionId, { workflowHash }) {
    const c = this.condition(flowId, conditionId);
    const r = this.db.prepare('SELECT * FROM waivers WHERE flow_id=? AND condition_id=? AND condition_version=? AND workflow_hash=? AND active=1 ORDER BY at DESC LIMIT 1').get(flowId, conditionId, c.version, workflowHash);
    return r ? { id: r.id, conditionVersion: r.condition_version, workflowHash: r.workflow_hash, why: r.why, channel: r.channel, by: r.principal, at: r.at } : null;
  }
  recordResult({ flowId, conditionId, conditionVersion, workflowHash, status, reason = null, body }) {
    this.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(flow_id, condition_id, condition_version, workflow_hash) DO UPDATE SET status=excluded.status, reason=excluded.reason, body=excluded.body, at=excluded.at')
      .run(flowId, conditionId, conditionVersion, workflowHash, status, reason, json(body), this.now());
  }
  /** A status from a LIVE run (./live.mjs), kept per run beside the practice result of the same workflow hash. */
  recordLiveResult({ flowId, conditionId, conditionVersion, workflowHash, runId, status, reason = null, body }) {
    this.db.prepare('INSERT INTO live_results VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(flow_id, condition_id, condition_version, run_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, body=excluded.body, at=excluded.at')
      .run(flowId, conditionId, conditionVersion, workflowHash, runId, status, reason, json(body), this.now());
  }
  /** The latest live result of this condition version (optionally for one workflow hash). */
  latestLive(flowId, conditionId, conditionVersion, workflowHash = null) {
    const r = this.db.prepare(`SELECT * FROM live_results WHERE flow_id=? AND condition_id=? AND condition_version=? ${workflowHash ? 'AND workflow_hash=?' : ''} ORDER BY at DESC, rowid DESC LIMIT 1`)
      .get(...[flowId, conditionId, conditionVersion, ...(workflowHash ? [workflowHash] : [])]);
    return r ? { runId: r.run_id, workflowHash: r.workflow_hash, status: r.status, reason: r.reason, at: r.at, ...parse(r.body) } : null;
  }
  result(flowId, conditionId, conditionVersion, workflowHash) {
    const r = this.db.prepare('SELECT * FROM results WHERE flow_id=? AND condition_id=? AND condition_version=? AND workflow_hash=?').get(flowId, conditionId, conditionVersion, workflowHash);
    return r ? { status: r.status, reason: r.reason, at: r.at, ...parse(r.body) } : null;
  }
}
