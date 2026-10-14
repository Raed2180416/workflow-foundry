// Run, replay and resume (E-BED §2.7, §9.7; BED-CONTRACT-v1.1 §3.6, §11.1, §12).
//
//   runWorld(opts)      a fresh run (journal in memory, or in `journalFile` with blobs in `blobDir`)
//   replayRun(opts)     re-run the host over a journal at $0: every call is answered from the journal, every content row
//                       must come out byte-identical (canonical JSON), and the ledger and SoR digests must equal the
//                       recorded run.end digests; otherwise the run is void ({ ok: false, divergence })
//   resumeRun(opts)     continue a journal after a quota stop or crash (a torn tail is cut back to the last commit
//                       boundary first, and the cut is recorded in the run.resume row): the committed prefix is replayed (verified), the
//                       per-arm workspace is restored to its last committed snapshot, and live calls pick up at the
//                       interrupted wake-up — the simulated clock never advanced past the last commit
import { createHost } from './host.mjs';
import { readJournal, repairJournal, ReplayDivergence, JournalIntegrityError } from './journal.mjs';
import { hashOf } from '../../lib/canonical.mjs';

export async function runWorld(opts) {
  const host = createHost(opts);
  const result = await host.run();
  return { ...result, host };
}

export async function replayRun({ item, world, journal, profile }) {
  let rows;
  try { rows = readJournal(journal); }
  catch (e) { if (e instanceof JournalIntegrityError) return { ok: false, void: true, divergence: { kind: 'integrity', message: e.message, seq: e.seq } }; throw e; }
  const start = rows.find(r => r.type === 'run.start');
  if (!start) return { ok: false, void: true, divergence: { kind: 'no-run-start' } };
  const host = createHost({ item, world, arm: null, profile: profile ?? start.profile, recorded: rows, mode: 'replay' });
  let result;
  try { result = await host.run(); }
  catch (e) {
    if (e instanceof ReplayDivergence) return { ok: false, void: true, divergence: { kind: 'content', index: e.index, expected: e.expected, got: e.got } };
    throw e;
  }
  const end = rows.find(r => r.type === 'run.end');
  const recorded = end?.digests ?? null;
  const mismatch = recorded && (recorded.sor !== result.digests.sor || recorded.ledger !== result.digests.ledger);
  if (mismatch) return { ok: false, void: true, divergence: { kind: 'digest', recorded, replayed: { sor: result.digests.sor, ledger: result.digests.ledger } } };
  return { ok: true, status: result.status, digests: result.digests, recorded, ledger: host.ledger.committed, ledgerDigest: hashOf(host.ledger.committed), host };
}

export async function resumeRun({ journalFile, ...opts }) {
  // A crash (unlike a quota stop) can leave a torn line or a partial wake-up: cut back to the last commit boundary.
  const { rows, dropped, tornLine } = repairJournal(journalFile);
  const host = createHost({ ...opts, journalFile, recorded: rows, mode: 'live', resumeNote: dropped ? { repaired: { droppedRows: dropped, tornLine } } : null });
  const result = await host.run();
  return { ...result, host };
}
