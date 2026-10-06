// Loader for sealed held-out bed families.
//
// Each `sealed-<n>.sealed` file is base64(gzip(JSON {"files": {relativePath: text}})): one bed
// family directory (index.mjs, README.md, its test file and helpers), authored by a separate agent
// so that the arms under evaluation (and the people building them) never see the families before
// sealed evaluation. This loader is deliberately content-free. Opening the archives defeats
// their purpose, so load them programmatically and do not print their contents.
//
// Inside an archive, imports of the shared bed helpers use the placeholder `__BEDS_LIB__/`. When
// it decodes an archive, the loader rewrites the placeholder to the absolute file URL of
// beds/lib/ in this checkout.
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, isAbsolute, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(HERE, '..', 'lib');
const PLACEHOLDER = '__BEDS_LIB__/';

const toNumber = n => {
  const m = /^(?:sealed-)?(\d+)$/.exec(String(n));
  if (!m) throw new Error(`invalid sealed family id: ${n}`);
  return Number(m[1]);
};

/** Ids of the sealed families present, e.g. ['sealed-1', 'sealed-2', ...]. */
export function listSealed() {
  return readdirSync(HERE).map(f => /^sealed-(\d+)\.sealed$/.exec(f)).filter(Boolean)
    .map(m => Number(m[1])).sort((a, b) => a - b).map(n => `sealed-${n}`);
}

/** Absolute path of the archive for family n (number or 'sealed-<n>'). */
export function sealedPath(n) { return join(HERE, `sealed-${toNumber(n)}.sealed`); }

function decode(n) {
  const raw = readFileSync(sealedPath(n), 'utf8').trim();
  const doc = JSON.parse(gunzipSync(Buffer.from(raw, 'base64')).toString('utf8'));
  if (!doc || typeof doc.files !== 'object') throw new Error(`malformed archive for sealed-${toNumber(n)}`);
  return doc.files;
}

/**
 * Materialise family n into `dir` (default: a fresh temp directory), rewriting the bed-helper
 * import placeholder. Returns the directory. The caller is responsible for removing it.
 */
export function extractSealed(n, dir = mkdtempSync(join(tmpdir(), 'bed-sealed-'))) {
  const libUrl = pathToFileURL(LIB).href + '/';
  for (const [rel, text] of Object.entries(decode(n))) {
    if (isAbsolute(rel) || normalize(rel).startsWith('..')) throw new Error('unsafe path in sealed archive');
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, /\.m?js$/.test(rel) ? String(text).split(PLACEHOLDER).join(libUrl) : String(text));
  }
  return dir;
}

/**
 * Decode family n into a fresh temp directory, import its index.mjs and return the module
 * (the bed interface from beds/CONTRACT.md). By default the temp directory is removed once the
 * module has loaded. Pass { keep: true } to keep it; the result then carries the directory on the
 * non-enumerable property `__sealedDir`.
 */
export async function loadSealed(n, { keep = false } = {}) {
  const dir = extractSealed(n);
  try {
    const mod = await import(pathToFileURL(join(dir, 'index.mjs')).href);
    if (!keep) return mod;
    return Object.defineProperty({ ...mod }, '__sealedDir', { value: dir, enumerable: false });
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}
