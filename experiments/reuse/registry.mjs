// The reuse registry (research/reuse-20261021/PREREG-C2-1.md §2): proven workflows keyed by CONTRACT HASH, each entry
// carrying the evidence that proved it and the two profiles its gate checks. Append-only JSONL (register | revoke), so an
// entry's history is never rewritten. The registry stores pointers and hashes: the artifact files live where they were
// frozen (read-only), and the profiles live in the run directory (they hold words of the proven inputs; SOP-Bench text is
// CC BY-NC, so only their sha256 and a feature summary enter the repo).
//
// The contract a caller asks for, and an entry declares, is the procedure (sha256 of its text), the tool interface (the
// catalog: names, descriptions and input schemas, canonical), the input columns and the output columns. Two programs that
// need "the same workflow" name the same contract; a caller whose procedure text, tool specifications or columns differ
// gets no entry at all (a registry miss), before any profile is read.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendJsonl, readJsonl, sha256, shaCanon } from './lib.mjs';

export const REGISTRY_SCHEMA = 'c2-registry/1';

/** Canonical contract of a procedure: { procedureSha256, catalogSha256, inputColumns, outputColumns }. */
export function contractOf({ procedureText, catalog, inputColumns, outputColumns }) {
  if (typeof procedureText !== 'string' || !procedureText.length) throw new Error('contractOf: procedureText required');
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('contractOf: catalog required');
  const tools = [...catalog].map(t => ({ name: t.name, description: t.description ?? '', input_schema: t.input_schema ?? {} })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { procedureSha256: sha256(procedureText), catalogSha256: shaCanon(tools), inputColumns: [...inputColumns], outputColumns: [...outputColumns] };
}
export const contractHashOf = contract => shaCanon(contract);

/**
 * createRegistry({ file }) -> { register(entry), revoke(id, reason), lookup(contractHash), get(id), entries() }.
 * entry: { id, contractHash, contract, artifact: { dir, sha256, files: [..] }, sdk: { dir, sha256 }, origin: { program,
 * evidence: { rows, pass, of, runSha256 } }, profiles: { input: { file, sha256 }, trace: { file, sha256 } }, scope?: { source } }.
 */
export function createRegistry({ file }) {
  const load = () => readJsonl(file);
  const state = () => {
    const live = new Map();
    for (const ev of load()) {
      if (ev.kind === 'register') live.set(ev.entry.id, { ...ev.entry, revoked: null });
      else if (ev.kind === 'revoke' && live.has(ev.id)) live.get(ev.id).revoked = { reason: ev.reason, at: ev.at };
    }
    return live;
  };
  return {
    file,
    register(entry) {
      for (const k of ['id', 'contractHash', 'artifact', 'origin', 'profiles']) if (!entry?.[k]) throw new Error(`registry.register: ${k} required`);
      if (state().has(entry.id)) throw new Error(`registry.register: ${entry.id} already registered`);
      if (contractHashOf(entry.contract) !== entry.contractHash) throw new Error('registry.register: contractHash does not match the contract');
      appendJsonl(file, { schema: REGISTRY_SCHEMA, kind: 'register', at: new Date().toISOString(), entry });
      return entry;
    },
    revoke(id, reason) { if (!state().has(id)) throw new Error(`registry.revoke: unknown ${id}`); appendJsonl(file, { schema: REGISTRY_SCHEMA, kind: 'revoke', id, reason, at: new Date().toISOString() }); },
    /** Live (unrevoked) entries for a contract hash, in registration order; scope filters entries scoped to a source. */
    lookup(contractHash, { source = null } = {}) {
      return [...state().values()].filter(e => !e.revoked && e.contractHash === contractHash && (!e.scope?.source || e.scope.source === source));
    },
    get(id) { return state().get(id) ?? null; },
    entries() { return [...state().values()]; },
  };
}

/** Load an entry's profiles from their files, checking each sha256. */
export function loadProfiles(entry) {
  const out = {};
  for (const k of ['input', 'trace']) {
    const p = entry.profiles[k];
    if (!p) { out[k] = null; continue; }
    if (!existsSync(p.file)) throw new Error(`profile ${k} of ${entry.id} missing: ${p.file}`);
    const text = readFileSync(p.file, 'utf8');
    if (sha256(text) !== p.sha256) throw new Error(`profile ${k} of ${entry.id}: sha256 mismatch`);
    out[k] = JSON.parse(text);
  }
  return out;
}
export const artifactPath = (entry, rel) => path.join(entry.artifact.dir, rel);
