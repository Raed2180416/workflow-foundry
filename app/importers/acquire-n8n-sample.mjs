#!/usr/bin/env node
// Re-fetch the exact n8n sample files named in research/surface-20261021/n8n-sample-manifest.json, at their pinned commits,
// and refuse any file whose sha256 differs. Downloads JSON and LICENSE text only; nothing is installed, built or executed.
//   node app/importers/acquire-n8n-sample.mjs [--dir /var/tmp/foundry-work/surface-20261021/n8n-acq]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MANIFEST, DEFAULT_ACQ } from './run-n8n-sample.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' } } });
const dir = path.resolve(values.dir ?? DEFAULT_ACQ), manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let bad = 0;
for (const [repo, info] of Object.entries(manifest.repos)) {
  const [owner, name] = info.url.split('/').slice(-2);
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${info.commit}/LICENSE`);
  mkdirSync(path.join(dir, repo), { recursive: true });
  if (res.ok) writeFileSync(path.join(dir, repo, 'LICENSE'), Buffer.from(await res.arrayBuffer()));
}
for (const f of manifest.files) {
  const res = await fetch(f.rawUrl);
  const bytes = Buffer.from(await res.arrayBuffer()), sha = createHash('sha256').update(bytes).digest('hex');
  if (!res.ok || sha !== f.sha256) { bad++; process.stderr.write(`REFUSED ${f.id}: HTTP ${res.status}, sha256 ${sha.slice(0, 12)} != ${f.sha256.slice(0, 12)}\n`); continue; }
  const target = path.join(dir, f.repo, f.path);
  mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes);
}
process.stdout.write(`${manifest.files.length - bad}/${manifest.files.length} files verified in ${dir}\n`);
process.exitCode = bad ? 1 : 0;
