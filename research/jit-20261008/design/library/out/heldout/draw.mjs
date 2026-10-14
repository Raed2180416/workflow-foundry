// J1 / L1-b draw (2026-10-14): 10 workflows from each admitted platform, by the rule in PREREG.md §3. $0.
// Usage (repo root):  node research/jit-20261008/design/library/out/heldout/draw.mjs
// Reads only frames/*.ids.txt (ids, no workflow content). Writes draw.json. The skip pass is separate (skips.json, written
// when a drawn item meets a PREREG §3 skip reason) and is applied by resolve.mjs, which records every replacement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261017;
const K = 10;
const RESERVE = 12;
const ORDER = ['windmill', 'kestra', 'power-automate', 'step-functions', 'logic-apps'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);   // byte-wise for ASCII ids

const platforms = {};
for (const p of ORDER) {
  const raw = fs.readFileSync(path.join(HERE, 'frames', `${p}.ids.txt`), 'utf8');
  const ids = raw.split('\n').filter(Boolean).sort(cmp);
  const shuffled = shuffle(ids);
  platforms[p] = {
    frameSize: ids.length,
    frameSha256: sha(ids.join('\n') + '\n'),
    sample: shuffled.slice(0, K),
    reserve: shuffled.slice(K, K + RESERVE),
  };
}
const out = {
  made: new Date().toISOString(),
  seed: SEED,
  prng: 'mulberry32',
  method: 'PREREG.md §3: per platform, ids sorted byte-wise, Fisher-Yates on one shared mulberry32(seed) stream, platforms visited in admission order; first 10 are the sample, the next 12 the reserve order for the skip reasons fixed in PREREG §3.',
  order: ORDER,
  pinned: {
    windmill: 'hub.windmill.dev/flows listing fetched 2026-10-14T13:36Z (frames/windmill-hub-flows-listing.json)',
    kestra: 'kestra-io/blueprints@4a19ce21e2c94176ca1022d233aaf6303669f17f',
    'power-automate': 'pnp/powerautomate-samples@dbff07a8167d76e258564a0749bc508d58d85425',
    'step-functions': 'aws-samples/step-functions-workflows-collection@7842c46f966a344236c03e7c5cc28107552bd55d',
    'logic-apps': 'Azure/logicapps@c16c1d57be360c88bdf98571bc972eb1af29d1ca',
  },
  platforms,
};
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(out, null, 1) + '\n');
for (const p of ORDER) console.log(p, platforms[p].frameSize, '\n  sample: ' + platforms[p].sample.join('\n          ') + '\n  reserve: ' + platforms[p].reserve.slice(0, 4).join(' | '));
