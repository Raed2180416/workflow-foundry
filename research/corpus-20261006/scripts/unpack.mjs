// Restore the uncompressed corpus files from the gzipped copies kept in git (ROADMAP §6 rule 6: no large
// datasets in git; the full corpus is 2 MB gzipped). Verifies items.jsonl against MANIFEST.json.
// Usage: node research/corpus-20261006/scripts/unpack.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['items.jsonl', 'parts/automation.jsonl', 'parts/orchestration.jsonl', 'parts/science.jsonl', 'parts/consumer-creative.jsonl'];
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8'));
const expected = { 'items.jsonl': manifest.files.items.sha256, ...Object.fromEntries(manifest.files.parts.map(p => [p.part, p.sha256])) };
let bad = 0;
for (const f of files) {
  const gz = path.join(ROOT, f + '.gz');
  if (!existsSync(gz)) { console.error(`missing ${f}.gz`); bad++; continue; }
  const buf = gunzipSync(readFileSync(gz)), sha = createHash('sha256').update(buf).digest('hex');
  const ok = !expected[f] || expected[f] === sha;
  if (!ok) bad++;
  writeFileSync(path.join(ROOT, f), buf);
  console.log(`${f}: ${buf.length} bytes, sha256 ${sha.slice(0, 16)}… ${expected[f] ? (ok ? 'matches MANIFEST' : 'DOES NOT MATCH MANIFEST') : '(no manifest hash)'}`);
}
process.exit(bad ? 1 : 0);
