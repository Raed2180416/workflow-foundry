// Kev export (JUDGE-PROGRAM.md §2.2 export, §2.3 rule 3, §2.5 unknowables). A factory record
//   { state, questions: {qid: {type, instructions, criteria, label, target?}}, meta: {...} }
// becomes one line of a Kev JSONL file
//   { state, questions: {qid: {type, instructions, criteria, label, src, target?}}, _meta: {id, source?} }
// plus one line of the meta sidecar <name>.meta.jsonl, { id, meta }, in the same order and keyed by
// _meta.id. Kev's load_records and api_request read only state and questions (kev:kev/data.py), so
// template ids, form ids, seeds and worlds never reach the training machine.
//   src           kevdata_<port> (kevdata_<companion id> for a companion question such as S1_present),
//                 so Kev's per-question report is per port
//   _meta.id      lib/hash.mjs recordId: a hash of state, questions and meta (stable across rebuilds)
//   _meta.source  "unknowable" for presence-matched unknowables of soft-target ports (kev.benchmark
//                 scores them on confidence only), in every slice; absent otherwise (Kev's default
//                 source applies). In train such a question must carry its soft target.
//                 An X5 unknowable is a labelled class (not_stated), so it keeps the default source.
//
//   node experiments/kev-data/export-kev.mjs <factory-records.jsonl> <out.jsonl> --slice <slice>
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, recordId, sha256 } from './lib/hash.mjs';
import { questionContract } from './lib/render.mjs';
import { loadSpec } from './lib/contracts.mjs';

export const SRC_PREFIX = 'kevdata_';
export const UNKNOWABLE_SOURCE = 'unknowable';
const QUESTION_KEYS = Object.freeze(['type', 'instructions', 'criteria', 'label', 'target']);

const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details) e.details = details; return e; };
export const metaFileOf = file => file.replace(/\.jsonl$/, '') + '.meta.jsonl';
export const softTargetPort = contract => typeof contract?.unknowable === 'string' && contract.unknowable.startsWith('soft-target');

// One factory record -> { kev, meta } (kev is the Kev line, meta the sidecar line).
export function toKevRecord(record, { contracts, slice = null, guard = null } = {}) {
  if (!record || typeof record !== 'object') throw fail('EXPORT_RECORD', 'a record is an object');
  if (record.state === undefined || record.state === null) throw fail('EXPORT_RECORD', 'a record needs a state');
  // JSON round-trip: the id is computed on exactly what the files hold (undefined fields dropped).
  const { state, questions, meta = {} } = JSON.parse(JSON.stringify({ state: record.state, questions: record.questions, meta: record.meta ?? {} }));
  if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) throw fail('EXPORT_RECORD', 'a record needs at least one question');
  const unknowable = meta.variant === 'unknowable';
  const out = {}, plain = {}; let softUnknowable = false;
  for (const [qid, q] of Object.entries(questions)) {
    const qc = questionContract(qid, contracts);
    if (!qc) throw fail('EXPORT_PORT', `question ${qid}: no frozen contract for it`);
    const { contract, reportId } = qc;
    if (contract.ledgerOnly) throw fail('EXPORT_PORT', `question ${qid}: ${qc.port} is ledger-only (no data)`);
    const extra = Object.keys(q).filter(k => !QUESTION_KEYS.includes(k));
    if (extra.length) throw fail('EXPORT_QUESTION', `question ${qid} carries ${extra.join(', ')} (only ${QUESTION_KEYS.join(', ')} are exported)`);
    if (q.type !== 'choice' || typeof q.instructions !== 'string' || !q.criteria || typeof q.criteria !== 'object') throw fail('EXPORT_QUESTION', `question ${qid} is not a System One choice question`);
    if (!Object.hasOwn(q.criteria, q.label)) throw fail('EXPORT_QUESTION', `question ${qid}: label ${JSON.stringify(q.label)} is not an offered option`);
    if (guard) {
      const leaks = guard.check(q.instructions, slice);
      if (leaks.length) throw fail('HELDOUT_WORDING', `question ${qid} in ${slice} uses held-out wording ${leaks.map(l => `${l.port}/${l.id} (${l.slice})`).join(', ')}`);
    }
    if (unknowable && softTargetPort(contract)) {
      softUnknowable = true;
      if (slice === 'train' && (q.target === undefined || q.target === null)) throw fail('EXPORT_UNKNOWABLE', `question ${qid}: a training unknowable of a soft-target port needs a target (lib/render.mjs uniformTarget)`);
    }
    const pq = { type: q.type, instructions: q.instructions, criteria: q.criteria, label: q.label };
    if (q.target !== undefined && q.target !== null) pq.target = q.target;
    plain[qid] = pq;
    out[qid] = { ...pq, src: `${SRC_PREFIX}${reportId}` };
  }
  const id = recordId({ state, questions: plain, meta });
  const _meta = softUnknowable ? { id, source: UNKNOWABLE_SOURCE } : { id };
  return { kev: { state, questions: out, _meta }, meta: { id, meta } };
}

// Write <file> and its sidecar atomically (tmp + rename). Returns hashes and counts.
export function exportKev(records, { file, contracts = loadSpec().contracts, slice = null, guard = null } = {}) {
  if (typeof file !== 'string' || !file.endsWith('.jsonl')) throw fail('EXPORT_FILE', 'the output file must end in .jsonl');
  const lines = [], metas = [], ids = new Set();
  for (const r of records) {
    const { kev, meta } = toKevRecord(r, { contracts, slice, guard });
    if (ids.has(kev._meta.id)) throw fail('EXPORT_DUPLICATE', `record id ${kev._meta.id} appears twice (an identical record)`);
    ids.add(kev._meta.id);
    lines.push(JSON.stringify(kev)); metas.push(JSON.stringify(meta));
  }
  const body = lines.length ? lines.join('\n') + '\n' : '', metaBody = metas.length ? metas.join('\n') + '\n' : '';
  const metaFile = metaFileOf(file);
  mkdirSync(path.dirname(file), { recursive: true });
  for (const [f, b] of [[file, body], [metaFile, metaBody]]) { writeFileSync(`${f}.tmp`, b); renameSync(`${f}.tmp`, f); }
  return { file, metaFile, records: lines.length, sha256: `sha256:${sha256(body)}`, metaSha256: `sha256:${sha256(metaBody)}`,
    unknowable: lines.filter(l => l.includes(`"source":"${UNKNOWABLE_SOURCE}"`)).length };
}

const readJsonl = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw fail('EXPORT_READ', `${f}:${i + 1} is not JSON`); } });

// Read a Kev file and its sidecar back into factory records ({state, questions, meta} plus the
// Kev-side id and source), checking the sidecar is keyed by _meta.id in file order.
export function readKevFile(file) {
  const kev = readJsonl(file), side = readJsonl(metaFileOf(file));
  if (kev.length !== side.length) throw fail('EXPORT_SIDECAR', `${file}: ${kev.length} records, ${side.length} sidecar lines`);
  return kev.map((k, i) => {
    if (side[i].id !== k._meta?.id) throw fail('EXPORT_SIDECAR', `${file}:${i + 1}: sidecar id ${side[i].id} != _meta.id ${k._meta?.id}`);
    const questions = Object.fromEntries(Object.entries(k.questions).map(([qid, { src, ...q }]) => [qid, q]));
    const record = { state: k.state, questions, meta: side[i].meta };
    if (recordId(record) !== k._meta.id) throw fail('EXPORT_ID', `${file}:${i + 1}: _meta.id does not match the record content`);
    return { ...record, id: k._meta.id, source: k._meta.source ?? null, src: Object.fromEntries(Object.entries(k.questions).map(([qid, q]) => [qid, q.src])) };
  });
}
export const fileDigest = file => `sha256:${sha256(readFileSync(file))}`;
export { canonical };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--slice');
  const slice = at >= 0 ? args.splice(at, 2)[1] : null;
  const [input, output] = args;
  if (!input || !output) { console.error('usage: node experiments/kev-data/export-kev.mjs <factory-records.jsonl> <out.jsonl> [--slice <slice>]'); process.exit(2); }
  const r = exportKev(readJsonl(input), { file: path.resolve(output), slice });
  console.log(JSON.stringify(r, null, 2));
}
