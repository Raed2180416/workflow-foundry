// DUR-1 version registry (PREREG-DUR-1 §6.3 "Promotion"; BUILD-PLAN row 8). $0, pure. One registry per lineage-stream:
// a hash chain of entries { n, at, kind: genesis | promote | rollback, version: { id, digest }, proposer, approver, reason,
// prev, hash }. A promotion is a compare-and-swap: it names the head it expects and is refused if the head moved; the
// proposer (a patch session) and the approver (the code gate) must differ (experiments/constitution/registry.mjs pattern).
import { createHash } from 'node:crypto';

const sha = s => createHash('sha256').update(s).digest('hex');
const body = e => JSON.stringify({ n: e.n, at: e.at, kind: e.kind, version: e.version, proposer: e.proposer, approver: e.approver, reason: e.reason, prev: e.prev });

export class RegistryError extends Error { constructor(code, msg) { super(`${code}: ${msg}`); this.code = code; } }

export class VersionRegistry {
  constructor({ label, genesis, at }) {
    if (!genesis?.digest) throw new Error('registry: genesis version { id, digest } required');
    this.label = label;
    this.entries = [];
    this.#append({ at, kind: 'genesis', version: { id: genesis.id, digest: genesis.digest }, proposer: 'build', approver: 'commissioning', reason: 'starting version (FH-1 heal-until-clean rule)' });
  }
  #append(e) {
    const prev = this.entries.at(-1)?.hash ?? null;
    const entry = { n: this.entries.length, ...e, prev };
    entry.hash = sha(body(entry));
    this.entries.push(Object.freeze(entry));
    return entry;
  }
  head() { return this.entries.at(-1); }
  /** The version in force (the head's), and every promoted version in order. */
  current() { return this.head().version; }
  promote({ expectHead, version, proposer, approver, at, reason = '' }) {
    if (expectHead !== this.head().hash) throw new RegistryError('STALE_HEAD', `expected head ${String(expectHead).slice(0, 12)}, head is ${this.head().hash.slice(0, 12)}`);
    if (!proposer || !approver || proposer === approver) throw new RegistryError('SELF_APPROVAL', `proposer ${proposer} and approver ${approver} must be two different parties`);
    if (!version?.digest) throw new RegistryError('BAD_VERSION', 'a version needs a digest');
    return this.#append({ at, kind: 'promote', version: { id: version.id, digest: version.digest }, proposer, approver, reason });
  }
  rollback({ expectHead, to, approver, at, reason = '' }) {
    if (expectHead !== this.head().hash) throw new RegistryError('STALE_HEAD', `expected head ${String(expectHead).slice(0, 12)}, head is ${this.head().hash.slice(0, 12)}`);
    const target = [...this.entries].reverse().find(e => e.version.digest === to.digest && e.kind !== 'rollback');
    if (!target) throw new RegistryError('UNKNOWN_VERSION', `rollback target ${to.digest} was never in force`);
    return this.#append({ at, kind: 'rollback', version: { id: to.id, digest: to.digest }, proposer: 'monitor', approver: approver ?? 'rollback-rule', reason });
  }
  toJSON() { return { label: this.label, entries: this.entries }; }
}

/** Verify a chain (entries as stored): every hash matches its body and links to the previous one. */
export function verifyChain(entries) {
  let prev = null;
  for (const e of entries) {
    if (e.prev !== prev) throw new RegistryError('CHAIN_BROKEN', `entry ${e.n} links to ${String(e.prev).slice(0, 12)}, expected ${String(prev).slice(0, 12)}`);
    if (sha(body(e)) !== e.hash) throw new RegistryError('ENTRY_EDITED', `entry ${e.n} does not match its hash`);
    prev = e.hash;
  }
  return true;
}
