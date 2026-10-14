// The host journal (BED-CONTRACT-v1.1 §12; E-BED §9.7): append-only, hash-chained, one per (arm, world). Every row
// is `{ seq, prev, hash, type, ...content }` with hash = sha256(prev + canonical(content)). Rows of an open wake-up are
// staged and become durable only at the wake-up's commit, so a quota stop or crash mid-wake-up leaves the journal at
// the last committed wake-up and the simulated clock never runs ahead of it (E-BED §2.7 clock freeze).
//
// Verify mode (`recorded` rows): the host re-runs and every content row it produces must equal the recorded row at the
// same position, byte for byte (canonical JSON); a mismatch throws ReplayDivergence and the run is void. Control rows
// (`clock.freeze`, `run.resume`) record interruptions; they are chained but never regenerated, so they are skipped
// while verifying. When the recorded content runs out the journal switches to live appending (resume), chaining on.
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonical, sha256 } from '../../lib/canonical.mjs';

export const GENESIS = '0'.repeat(64);
export const CONTROL_TYPES = Object.freeze(new Set(['clock.freeze', 'run.resume']));
const contentOf = row => { const { seq, prev, hash, ...content } = row; return content; };
export const rowHash = (prev, content) => sha256(prev + canonical(content));

export class ReplayDivergence extends Error {
  constructor(index, expected, got) {
    super(`replay diverged at content row ${index}: expected ${expected ? expected.type : 'end of journal'}, got ${got ? got.type : 'end of run'}`);
    this.name = 'ReplayDivergence'; this.code = 'REPLAY_DIVERGENCE';
    this.index = index; this.expected = expected; this.got = got;
  }
}

export class JournalIntegrityError extends Error {
  constructor(message, seq) { super(message); this.name = 'JournalIntegrityError'; this.code = 'JOURNAL_INTEGRITY'; this.seq = seq; }
}

/** Read and verify a JSONL journal file (or an array of rows); throws JournalIntegrityError on a broken chain. */
export function readJournal(source) {
  const rows = Array.isArray(source) ? source
    : readFileSync(source, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  verifyChain(rows);
  return rows;
}

export function verifyChain(rows) {
  let prev = GENESIS;
  rows.forEach((row, i) => {
    if (row.seq !== i) throw new JournalIntegrityError(`row ${i} has seq ${row.seq}`, i);
    if (row.prev !== prev) throw new JournalIntegrityError(`row ${i} does not chain to its predecessor`, i);
    if (row.hash !== rowHash(prev, contentOf(row))) throw new JournalIntegrityError(`row ${i} hash mismatch`, i);
    prev = row.hash;
  });
  return prev;
}

export class Journal {
  #rows = [];          // committed rows, in order
  #staged = [];        // content rows of the open wake-up
  #file;
  #recorded;           // recorded content rows still to verify (verify mode)
  #verified = 0;       // content rows verified so far
  #blobs;              // content-addressed blob store (workspace snapshots)

  constructor({ file = null, recorded = null, blobDir = null } = {}) {
    this.#file = file;
    if (file) mkdirSync(path.dirname(file), { recursive: true });
    this.#blobs = blobDir ? { dir: blobDir } : { mem: new Map() };
    if (blobDir) mkdirSync(blobDir, { recursive: true });
    if (recorded) {
      verifyChain(recorded);
      this.#rows = recorded.map(r => ({ ...r }));
      this.#recorded = recorded.filter(r => !CONTROL_TYPES.has(r.type)).map(contentOf);
    } else if (file && existsSync(file) && readFileSync(file, 'utf8').length) {
      throw new JournalIntegrityError(`journal file exists: ${file} (resume it instead of starting a new run)`, 0);
    }
  }

  get rows() { return this.#rows; }
  get head() { return this.#rows.length ? this.#rows.at(-1).hash : GENESIS; }
  get verifying() { return !!this.#recorded && this.#verified < this.#recorded.length; }
  get recordedContent() { return this.#recorded ?? []; }
  get stagedCount() { return this.#staged.length; }
  /** Content rows still unverified (a complete replay must end at 0). */
  get unverified() { return this.#recorded ? this.#recorded.length - this.#verified : 0; }

  stage(type, content = {}) {
    const row = { type, ...content };
    this.#staged.push(row);
    return row;
  }

  /** Make the staged rows durable (one wake-up). In verify mode they are compared with the recording instead. */
  commit() {
    const staged = this.#staged;
    this.#staged = [];
    // A recording ends at a commit boundary; one that ends inside a wake-up was truncated or forged.
    if (this.verifying && this.#recorded.length - this.#verified < staged.length) {
      const k = this.#recorded.length - this.#verified;
      for (let i = 0; i < k; i++) if (canonical(this.#recorded[this.#verified + i]) !== canonical(staged[i])) throw new ReplayDivergence(this.#verified + i, this.#recorded[this.#verified + i], staged[i]);
      throw new ReplayDivergence(this.#recorded.length, null, staged[k]);
    }
    const fresh = [];
    for (const content of staged) {
      if (this.verifying) {
        const want = this.#recorded[this.#verified];
        if (canonical(want) !== canonical(content)) throw new ReplayDivergence(this.#verified, want, content);
        this.#verified++;
        continue;
      }
      const prev = this.head;
      const row = { seq: this.#rows.length, prev, hash: rowHash(prev, content), ...content };
      this.#rows.push(row);
      fresh.push(row);
    }
    if (this.#file && fresh.length) appendFileSync(this.#file, fresh.map(r => JSON.stringify(r)).join('\n') + '\n');
    return fresh.length;
  }

  /** Drop the staged rows of an interrupted wake-up; returns them (for the freeze record's accounting). */
  discard() { const d = this.#staged; this.#staged = []; return d; }

  /** Append a control row immediately (never verified, always chained). Only legal with nothing staged. */
  control(type, content = {}) {
    if (!CONTROL_TYPES.has(type)) throw new Error(`not a control row type: ${type}`);
    if (this.#staged.length) throw new Error('control row with staged rows');
    const prev = this.head;
    const row = { seq: this.#rows.length, prev, hash: rowHash(prev, { type, ...content }), type, ...content };
    this.#rows.push(row);
    if (this.#file) appendFileSync(this.#file, JSON.stringify(row) + '\n');
    return row;
  }

  /** Content rows of the committed journal (control rows excluded), the unit replay compares. */
  contentRows() { return this.#rows.filter(r => !CONTROL_TYPES.has(r.type)).map(contentOf); }

  // Content-addressed blobs (workspace snapshots). Stored once per digest; never journaled inline.
  putBlob(digest, bytes) {
    if (this.#blobs.mem) { if (!this.#blobs.mem.has(digest)) this.#blobs.mem.set(digest, Buffer.from(bytes)); return; }
    const p = path.join(this.#blobs.dir, digest);
    if (!existsSync(p)) writeFileSync(p, bytes);
  }
  getBlob(digest) {
    if (this.#blobs.mem) return this.#blobs.mem.get(digest) ?? null;
    const p = path.join(this.#blobs.dir, digest);
    return existsSync(p) ? readFileSync(p) : null;
  }
}
