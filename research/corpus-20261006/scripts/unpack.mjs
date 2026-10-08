// Restore the uncompressed corpus files from the gzipped copies kept in git (ROADMAP §6 rule 6: no large
// datasets in git; the full corpus is about 2 MB gzipped), checking every file against MANIFEST.json.
//
// Usage: node research/corpus-20261006/scripts/unpack.mjs           restore items.jsonl and parts/*.jsonl, verify hashes
//        node research/corpus-20261006/scripts/unpack.mjs --check   verify only, write nothing
//        node research/corpus-20261006/scripts/unpack.mjs --pack    (maintainer) write <file>.gz for every manifest file whose
//                                                                   .gz is missing or holds different content
// The file list comes from MANIFEST.json (files.items and files.parts), so a new cluster part is covered once the
// manifest lists it. Every restored file must match its manifest sha256; a file without a manifest hash, a missing
// .gz or a mismatch is an error, and a mismatching file is not written. Ledgers (parts/<cluster>-ledger.md, in git
// uncompressed) are checked against the manifest hash when it records one. Exit code 0 when everything matches.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--pack') ? 'pack' : process.argv.includes('--check') ? 'check' : 'unpack';
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
// A corrupt or truncated .gz is reported like a hash mismatch (not written, exit 1) instead of aborting the run, so the
// remaining files and ledgers are still checked.
const gunzipOrNull = b => { try { return gunzipSync(b); } catch { return null; } };
const entries = [{ file: manifest.files.items.path, sha256: manifest.files.items.sha256 },
  ...manifest.files.parts.map(p => ({ file: p.part, sha256: p.sha256, ledger: p.ledger, ledgerSha256: p.ledgerSha256 }))];
let bad = 0;
for (const { file, sha256: want } of entries) {
  const raw = path.join(ROOT, file), gz = `${raw}.gz`;
  if (!/^[0-9a-f]{64}$/.test(want ?? '')) { console.error(`${file}: no sha256 in MANIFEST.json`); bad++; continue; }
  if (mode === 'pack') {
    if (!existsSync(raw)) { console.error(`${file}: missing, nothing to pack`); bad++; continue; }
    const buf = readFileSync(raw);
    if (sha(buf) !== want) { console.error(`${file}: sha256 ${sha(buf).slice(0, 16)}… does not match MANIFEST.json; regenerate the manifest first`); bad++; continue; }
    if (existsSync(gz) && sha(gunzipOrNull(readFileSync(gz)) ?? '') === want) { console.log(`${file}.gz: up to date`); continue; }
    writeFileSync(gz, gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }));
    console.log(`${file}.gz: written (${readFileSync(gz).length} bytes)`);
    continue;
  }
  if (!existsSync(gz)) { console.error(`missing ${file}.gz`); bad++; continue; }
  const buf = gunzipOrNull(readFileSync(gz));
  if (!buf) { console.error(`${file}.gz: not a readable gzip file (corrupt or truncated); not written`); bad++; continue; }
  const got = sha(buf);
  if (got !== want) { console.error(`${file}.gz: content sha256 ${got.slice(0, 16)}… DOES NOT MATCH MANIFEST (${want.slice(0, 16)}…); not written`); bad++; continue; }
  if (mode === 'unpack' && !(existsSync(raw) && sha(readFileSync(raw)) === want)) writeFileSync(raw, buf);
  console.log(`${file}: ${buf.length} bytes, sha256 ${got.slice(0, 16)}… matches MANIFEST${mode === 'check' ? ' (checked, not written)' : ''}`);
}
for (const { ledger, ledgerSha256 } of entries) {
  if (!ledger || !ledgerSha256) continue;
  const p = path.join(ROOT, ledger);
  if (!existsSync(p)) { console.error(`missing ${ledger}`); bad++; continue; }
  const got = sha(readFileSync(p));
  if (got !== ledgerSha256) { console.error(`${ledger}: sha256 ${got.slice(0, 16)}… DOES NOT MATCH MANIFEST`); bad++; }
  else console.log(`${ledger}: sha256 matches MANIFEST`);
}
process.exit(bad ? 1 : 0);
