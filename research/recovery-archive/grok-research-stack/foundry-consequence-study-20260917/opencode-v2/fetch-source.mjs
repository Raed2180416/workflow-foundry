import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base = path.dirname(new URL(import.meta.url).pathname);
const tree = JSON.parse(readFileSync(path.join(base, 'upstream-tree.json')));
for (const file of process.argv.slice(2)) {
  const item = tree.tree.find(item => item.path === file && item.type === 'blob');
  if (!item || !/^(packages\/|LICENSE)/.test(file)) throw new Error(`Source path not in pinned tree: ${file}`);
  const target = path.join(base, 'upstream', file);
  if (existsSync(target)) throw new Error(`Already acquired: ${file}`);
  const url = `https://raw.githubusercontent.com/anomalyco/opencode/${tree.sha}/${file}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status}: ${file}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Source byte limit');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  const receipt = { url, revision: tree.sha, date: new Date().toISOString(), gitBlob: item.sha, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, outcome: 'acquired-inert-source' };
  writeFileSync(`${target}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ file, bytes: bytes.length, sha256: receipt.sha256 }));
}
