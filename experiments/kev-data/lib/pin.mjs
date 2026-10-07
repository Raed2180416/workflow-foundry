// Bed pin and frozen copy (JUDGE-PROGRAM.md §2.1 [crit G12], §10 global acceptance 5).
//   pin          sha256 over (path, mode, sha256(content)) of every file git lists at the pinned
//                commit under the allow-list: the nine dev beds, beds/lib and beds/CONTRACT.md.
//                beds/sealed/ is never listed, hashed or opened: every git call passes only
//                allow-listed literal pathspecs, and every fs call reads only allow-listed paths.
//   diff hash    sha256 over the working-tree changes to those paths (modified, deleted, added or
//                untracked files) against the pinned commit; '' changes hash to a constant.
//   frozen copy  `git archive <commit> -- <allow-list>` extracted into
//                .foundry/kev-data/frozen/<pin hex>/, verified file by file against the pin. Builds
//                import beds only from it. A frozen copy records the diff hash it was made under; a
//                later run whose diff hash differs is refused (a bed edit between two builds).
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BED_ALLOWLIST = Object.freeze(['beds/records', 'beds/incident', 'beds/synth', 'beds/kinetics', 'beds/runbook',
  'beds/gameqa', 'beds/gridquest', 'beds/codefix', 'beds/ownerci', 'beds/lib', 'beds/CONTRACT.md']);
const SEALED = 'beds/sealed';
const sha = buf => createHash('sha256').update(buf).digest('hex');
const posix = p => p.split(path.sep).join('/');

export function allowListed(rel) {
  const p = posix(path.posix.normalize(rel));
  if (p === SEALED || p.startsWith(`${SEALED}/`) || p.startsWith('../') || path.posix.isAbsolute(p)) return false;
  return BED_ALLOWLIST.some(a => p === a || p.startsWith(`${a}/`));
}
function assertAllowListed(rel) {
  if (!allowListed(rel)) { const e = new Error(`BED_PATH: ${rel} is not under the bed allow-list`); e.code = 'BED_PATH'; throw e; }
}

function git(root, args, { input, encoding = 'utf8' } = {}) {
  const opts = { maxBuffer: 1 << 30, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' } };
  if (input !== undefined) opts.input = Buffer.from(input);
  if (encoding !== 'buffer') opts.encoding = encoding;
  const r = spawnSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], opts);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr ?? '').toString().trim()}`);
  return r.stdout;
}
// One pathspec per git call, so git only ever walks inside one allow-listed path.
const pathspecs = () => BED_ALLOWLIST.map(p => { assertAllowListed(p); return p; });

// Read blobs through `git cat-file --batch` (content exactly as committed).
function readBlobs(root, ids) {
  if (!ids.length) return new Map();
  const out = git(root, ['cat-file', '--batch'], { input: ids.join('\n') + '\n', encoding: 'buffer' });
  const blobs = new Map(); let pos = 0;
  for (const id of ids) {
    const nl = out.indexOf(0x0a, pos), header = out.subarray(pos, nl).toString();
    const [oid, type, size] = header.split(' ');
    if (oid !== id || type !== 'blob') throw new Error(`cat-file: unexpected ${header}`);
    const n = Number(size); blobs.set(id, out.subarray(nl + 1, nl + 1 + n)); pos = nl + 1 + n + 1;
  }
  return blobs;
}

const VERSION_RE = /^export const VERSION\s*=\s*['"]([^'"]+)['"]/m;

// The pin of the allow-listed beds at `commit` (default HEAD) in repository `root`.
export function bedPin(root, { commit = 'HEAD' } = {}) {
  const sha1 = git(root, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  const files = [];
  for (const spec of pathspecs()) {
    const out = git(root, ['ls-tree', '-r', '-z', '--full-tree', sha1, '--', spec]);
    for (const line of out.split('\0').filter(Boolean)) {
      const [meta, p] = line.split('\t'); const [mode, type, oid] = meta.split(' ');
      if (type !== 'blob') continue;
      assertAllowListed(p);
      files.push({ path: p, mode, oid });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const blobs = readBlobs(root, [...new Set(files.map(f => f.oid))]);
  const versions = {};
  for (const f of files) {
    const buf = blobs.get(f.oid); f.sha256 = sha(buf); f.bytes = buf.length;
    if (f.path.endsWith('.mjs')) { const m = VERSION_RE.exec(buf.toString('utf8')); if (m) versions[f.path] = m[1]; }
  }
  const pinHex = sha(files.map(f => `${f.path}\0${f.mode}\0${f.sha256}\n`).join(''));
  return { pin: `sha256:${pinHex}`, pinHex, commit: sha1, allowlist: [...BED_ALLOWLIST], files: files.map(({ oid, ...f }) => f), versions };
}

// Working-tree changes to the allow-listed paths against the pin's commit.
export function worktreeDiff(root, pinInfo) {
  const known = new Map(pinInfo.files.map(f => [f.path, f]));
  const changed = [];
  for (const f of pinInfo.files) {
    const abs = path.join(root, f.path);
    if (!existsSync(abs)) { changed.push({ path: f.path, status: 'deleted', sha256: null }); continue; }
    const h = sha(readFileSync(abs));
    if (h !== f.sha256) changed.push({ path: f.path, status: 'modified', sha256: h });
  }
  for (const spec of pathspecs()) {
    const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', spec]);
    for (const p of out.split('\0').filter(Boolean)) {
      if (known.has(p)) continue;
      assertAllowListed(p);
      const abs = path.join(root, p);
      changed.push({ path: p, status: 'added', sha256: existsSync(abs) ? sha(readFileSync(abs)) : null });
    }
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : 1));
  const diffHash = `sha256:${sha(changed.map(c => `${c.path}\0${c.status}\0${c.sha256 ?? ''}\n`).join(''))}`;
  return { diffHash, clean: changed.length === 0, changed };
}

export const frozenRoot = outRoot => path.join(outRoot, 'frozen');

// Make (or reuse) the frozen copy for the current pin. Refuses when the working-tree diff hash
// differs from the one the copy was made under (BED_DRIFT), or when expectPin is given and differs
// (PIN_MISMATCH).
export function freezeBeds(root, { outRoot = path.join(root, '.foundry', 'kev-data'), commit = 'HEAD', expectPin = null } = {}) {
  const info = bedPin(root, { commit });
  if (expectPin && expectPin !== info.pin) { const e = new Error(`PIN_MISMATCH: beds pin ${info.pin}, expected ${expectPin}`); e.code = 'PIN_MISMATCH'; throw e; }
  const diff = worktreeDiff(root, info);
  const dir = path.join(frozenRoot(outRoot), info.pinHex), manifestPath = path.join(dir, 'FROZEN.json');
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (m.pin !== info.pin) throw new Error(`FROZEN_CORRUPT: ${manifestPath} names pin ${m.pin}`);
    if (m.diffHash !== diff.diffHash) {
      const e = new Error(`BED_DRIFT: the working-tree diff of the pinned beds changed since the frozen copy was made (${m.diffHash} -> ${diff.diffHash}); commit or revert the bed edits, then build against the new pin`);
      e.code = 'BED_DRIFT'; e.details = { was: m.diffHash, now: diff.diffHash, changed: diff.changed.map(c => `${c.status} ${c.path}`) }; throw e;
    }
    verifyFrozen(dir, info);
    return { ...info, diffHash: diff.diffHash, clean: diff.clean, changed: diff.changed, dir, created: false };
  }
  mkdirSync(frozenRoot(outRoot), { recursive: true });
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const tar = git(root, ['archive', '--format=tar', info.commit, '--', ...pathspecs()], { encoding: 'buffer' });
  execFileSync('tar', ['-x', '-f', '-', '-C', tmp], { input: tar, maxBuffer: 1 << 30 });
  verifyFrozen(tmp, info);
  writeFileSync(path.join(tmp, 'FROZEN.json'), JSON.stringify({ pin: info.pin, commit: info.commit, diffHash: diff.diffHash, clean: diff.clean,
    changed: diff.changed.map(c => `${c.status} ${c.path}`), allowlist: info.allowlist, versions: info.versions, files: info.files.length }, null, 2) + '\n');
  renameSync(tmp, dir);
  return { ...info, diffHash: diff.diffHash, clean: diff.clean, changed: diff.changed, dir, created: true };
}

// Every file of the frozen copy matches the pin, and nothing else is there.
export function verifyFrozen(dir, info) {
  const want = new Map(info.files.map(f => [f.path, f.sha256]));
  const seen = [];
  const walk = rel => {
    for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (!rel && ent.name === 'FROZEN.json') continue;
      if (ent.isDirectory()) walk(r); else seen.push(r);
    }
  };
  walk('');
  const extra = seen.filter(p => !want.has(p)), missing = [...want.keys()].filter(p => !seen.includes(p));
  const wrong = seen.filter(p => want.has(p) && sha(readFileSync(path.join(dir, p))) !== want.get(p));
  if (extra.length || missing.length || wrong.length) throw new Error(`FROZEN_MISMATCH: extra ${extra.length}, missing ${missing.length}, changed ${wrong.length} (${[...extra, ...missing, ...wrong].slice(0, 3).join(', ')})`);
  return true;
}

// Bed access for generators: resolve and import allow-listed paths from the frozen copy only.
export function frozenBeds(frozen) {
  const dir = path.resolve(frozen.dir);
  const resolve = rel => {
    assertAllowListed(rel);
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep)) throw new Error(`BED_PATH: ${rel} escapes the frozen copy`);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`BED_PATH: ${rel} is not in the frozen copy ${frozen.pin}`);
    return abs;
  };
  return Object.freeze({ dir, pin: frozen.pin, commit: frozen.commit, path: resolve, import: rel => import(pathToFileURL(resolve(rel)).href), read: rel => readFileSync(resolve(rel), 'utf8') });
}
