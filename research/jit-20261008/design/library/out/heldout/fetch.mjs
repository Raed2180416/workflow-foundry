// J1 / L1-b fetch (2026-10-14): retrieve the drawn workflows as raw bytes from their pinned public URLs and write
// <platform>/<file> plus <platform>/MANIFEST.json (url, fetchedAt, sha256, bytes, licence note, peeks). $0, no model.
// Usage (repo root):  node research/jit-20261008/design/library/out/heldout/fetch.mjs
// Inputs: draw.json (ids), skips.json (optional: [{platform, id, reason}] applied in reserve order, PREREG §3).
// Raw files are fetched with curl through the egress proxy (public URLs, no credentials); a zip is read in memory by
// python3 -I and only the one flow-definition member is written. Nothing fetched is executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const skips = fs.existsSync(path.join(HERE, 'skips.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'skips.json'), 'utf8')) : [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const curl = (url) => execFileSync('curl', ['-sS', '-m', '60', '-L', '--fail', url], { maxBuffer: 64 * 1024 * 1024 });
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const SRC = {
  windmill: { licence: 'none stated: the hub (hub.windmill.dev) shows no licence or terms text (WebFetch 2026-10-14). Raw file kept local, not committed (.gitignore).' },
  kestra: { repo: 'kestra-io/blueprints', sha: draw.pinned.kestra.split('@')[1], licence: 'no LICENSE file in the tree at the pinned SHA; the README carries only the kestra-io/kestra licence badge (kestra-io/kestra is Apache-2.0). Raw file kept local, not committed (.gitignore).' },
  'power-automate': { repo: 'pnp/powerautomate-samples', sha: draw.pinned['power-automate'].split('@')[1], licence: 'MIT (LICENSE, Copyright (c) 2021 Microsoft 365 Community)' },
  'step-functions': { repo: 'aws-samples/step-functions-workflows-collection', sha: draw.pinned['step-functions'].split('@')[1], licence: 'MIT-0 (LICENSE, Copyright Amazon.com, Inc. or its affiliates)' },
  'logic-apps': { repo: 'Azure/logicapps', sha: draw.pinned['logic-apps'].split('@')[1], licence: 'MIT (LICENSE, Copyright (c) Microsoft Corporation)' },
};
const PEEKED = new Set(['logic-apps|templates/Azure-Blob-Auto-Tier.json']);   // PREREG §3 peeks
const fileName = (p, id) => (p === 'windmill' ? `flow-${id}.json` : p === 'power-automate'
  ? id.split('#')[0].split('/')[1].replace(/[^A-Za-z0-9_.-]/g, '_') + '.definition.json'
  : id.replace(/\//g, '__'));

for (const p of draw.order) {
  const d = draw.platforms[p];
  const skipped = new Map(skips.filter((s) => s.platform === p).map((s) => [s.id, s.reason]));
  const queue = [...d.sample, ...d.reserve];
  const chosen = [];
  const skipLog = [];
  for (const id of queue) {
    if (chosen.length >= 10) break;
    if (skipped.has(id)) { skipLog.push({ id, reason: skipped.get(id) }); continue; }
    chosen.push(id);
  }
  const rows = [];
  for (const id of chosen) {
    const s = SRC[p];
    let url, bytes, extra = {};
    const fetchedAt = new Date().toISOString();
    if (p === 'windmill') {
      url = `https://hub.windmill.dev/flows/${id}`;
      bytes = curl(url);
    } else if (p === 'power-automate') {
      const [zipPath, member] = id.split('#');
      url = `https://raw.githubusercontent.com/${s.repo}/${s.sha}/${enc(zipPath)}`;
      const zip = curl(url);
      bytes = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,io;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));sys.stdout.buffer.write(z.read(sys.argv[1]))', member], { input: zip, maxBuffer: 64 * 1024 * 1024 });
      extra = { zipMember: member, zipSha256: sha(zip), zipBytes: zip.length };
    } else {
      url = `https://raw.githubusercontent.com/${s.repo}/${s.sha}/${enc(id)}`;
      bytes = curl(url);
    }
    const file = fileName(p, id);
    fs.writeFileSync(path.join(HERE, p, file), bytes);
    rows.push({ id, file, url, fetchedAt, sha256: sha(bytes), bytes: bytes.length, ...extra, ...(PEEKED.has(`${p}|${id}`) ? { peekedBeforeDraw: true } : {}) });
  }
  fs.writeFileSync(path.join(HERE, p, 'MANIFEST.json'), JSON.stringify({
    platform: p, pinned: draw.pinned[p], licenceNote: SRC[p].licence,
    selectionRule: 'PREREG.md §3 and draw.json: seeded draw (mulberry32 20261017) over the sorted frame, first 10, replaced from the reserve only for the PREREG §3 skip reasons',
    frameSize: d.frameSize, frameSha256: d.frameSha256, skipped: skipLog, workflows: rows,
  }, null, 1) + '\n');
  console.log(p, rows.length, 'skipped', skipLog.length);
}
