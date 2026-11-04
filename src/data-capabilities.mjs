// Data handles, the producers (research/engine-20261104/DATA-HANDLES.md, step 2). Three host capabilities that put data far
// larger than an inline JSON value into the content-addressed blob store (src/blobs.mjs) and return handles:
//   data.import     one file under a root the host allows -> a handle (labelled untrusted:import: nobody in the workflow
//                   wrote these bytes)
//   data.split      a text or NDJSON handle -> views of at most maxLines lines / maxBytes bytes, cut at line boundaries,
//                   with no copying (the shard plan for a map)
//   data.inventory  the files under an allowed root -> an NDJSON handle of {id, path, bytes[, sha256]} (the recon step of
//                   skills/foundry-construct/references/scale.md; its ids feed a ledger verify)
// They are registered by the host, never by a workflow: registerDataCapabilities(registry, { allowedRoots }). With no
// allowed root, data.import and data.inventory refuse. Paths are resolved through realpath and must stay inside a root;
// symlinks are not followed out of it. Effects are "none": the blob store is the engine's own content-addressed state.
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from './data.mjs';
import { BLOB_LIMITS, BlobStore, MEDIA_TYPES, isHandle } from './blobs.mjs';

export const DATA_LIMITS = Object.freeze({ maxViews: 2000, maxInventoryFiles: 200000, maxInventoryDepth: 32 });
const stores = new Map();
const storeFor = directory => { if (!stores.has(directory)) stores.set(directory, new BlobStore(directory)); return stores.get(directory); };

function rootsOf(allowedRoots) {
  if (!Array.isArray(allowedRoots)) throw new FoundryError('DATA_ROOT', 'allowedRoots must be a list of directories');
  return allowedRoots.map(r => { const real = realpathSync(r); if (!lstatSync(real).isDirectory()) throw new FoundryError('DATA_ROOT', `${r} is not a directory`); return real; });
}
// The real path of `target`, refused unless it lies inside one of the roots (after resolving every symlink).
function inside(roots, target) {
  if (!roots.length) throw new FoundryError('DATA_ROOT', 'No data root is allowed on this host: data.import and data.inventory refuse');
  if (typeof target !== 'string' || !target.length || target.includes('\0')) throw new FoundryError('DATA_PATH', 'A path is a non-empty string');
  const candidates = path.isAbsolute(target) ? [target] : roots.map(r => path.join(r, target));
  for (const candidate of candidates) {
    let real; try { real = realpathSync(candidate); } catch { continue; }
    const root = roots.find(r => real === r || real.startsWith(`${r}${path.sep}`));
    if (root) return { real, root };
    throw new FoundryError('DATA_PATH', `${target} resolves outside every allowed data root`);
  }
  throw new FoundryError('DATA_PATH', `${target} does not exist under an allowed data root`);
}
function readWhole(file, size) {
  const buffer = Buffer.allocUnsafe(size), fd = openSync(file, 'r');
  try { for (let at = 0; at < size;) { const n = readSync(fd, buffer, at, size - at, at); if (n <= 0) break; at += n; } }
  finally { closeSync(fd); }
  return buffer;
}
function sha256File(file, size) {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(Math.min(4 << 20, Math.max(1, size))), fd = openSync(file, 'r');
  try { for (let at = 0; at < size;) { const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - at), at); if (n <= 0) break; hash.update(buffer.subarray(0, n)); at += n; } }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

const handleSchema = { type: 'object' };
export function registerDataCapabilities(registry, { allowedRoots = [], maxBlobBytes = BLOB_LIMITS.maxBlobBytes } = {}) {
  const roots = rootsOf(allowedRoots);
  const base = { version: '1', requiresApproval: false, effects: 'none', risk: 'low', cost: 0, cancellation: 'cooperative' };
  registry.register({
    ...base, name: 'data.import', implementation: 'workflow-foundry/data-handles/1/data.import', maxTimeoutMs: 600000, outputLabel: 'untrusted:import',
    description: 'Put one file from an allowed data root into the blob store and return its handle. The content is untrusted data.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 4096 }, mediaType: { enum: [...MEDIA_TYPES] } } },
    outputSchema: handleSchema,
    execute: async (args, ctx) => {
      const { real } = inside(roots, args.path), stat = lstatSync(real);
      if (!stat.isFile()) throw new FoundryError('DATA_PATH', `${args.path} is not a regular file`);
      if (stat.size > maxBlobBytes) throw new FoundryError('BLOB_TOO_LARGE', `${args.path} is ${stat.size} bytes; the largest blob is ${maxBlobBytes}`);
      return storeFor(ctx.store.directory).put(readWhole(real, stat.size), args.mediaType ?? 'text/plain');
    }
  });
  registry.register({
    ...base, name: 'data.split', implementation: 'workflow-foundry/data-handles/1/data.split', maxTimeoutMs: 600000,
    description: `Cut a text or NDJSON handle into views of at most maxLines lines and maxBytes bytes, at line boundaries; at most ${DATA_LIMITS.maxViews} views.`,
    inputSchema: { type: 'object', additionalProperties: false, required: ['blob'], properties: { blob: { type: 'object' }, maxLines: { type: 'integer', minimum: 1 }, maxBytes: { type: 'integer', minimum: 1 } } },
    outputSchema: { type: 'object', required: ['views', 'count'], properties: { views: { type: 'array' }, count: { type: 'integer' } } },
    execute: async (args, ctx) => {
      if (!isHandle(args.blob)) throw new FoundryError('BLOB_HANDLE', 'blob must be a handle');
      const views = storeFor(ctx.store.directory).split(args.blob, { maxLines: args.maxLines ?? Infinity, maxBytes: args.maxBytes ?? Infinity });
      if (views.length > DATA_LIMITS.maxViews) throw new FoundryError('DATA_SPLIT_LIMIT', `${views.length} views exceed ${DATA_LIMITS.maxViews}; raise maxLines or maxBytes, or split in two levels`);
      return { views, count: views.length };
    }
  });
  registry.register({
    ...base, name: 'data.inventory', implementation: 'workflow-foundry/data-handles/1/data.inventory', maxTimeoutMs: 3600000, outputLabel: 'untrusted:import',
    description: 'List the regular files under an allowed data root (symlinks are not followed) as an NDJSON handle of {id, path, bytes[, sha256]}.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string', minLength: 1, maxLength: 4096 }, hash: { type: 'boolean' }, suffixes: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 32 } } } },
    outputSchema: { type: 'object', required: ['inventory', 'files', 'bytes'], properties: { inventory: { type: 'object' }, files: { type: 'integer' }, bytes: { type: 'integer' } } },
    execute: async (args, ctx) => {
      const { real: top } = inside(roots, args.root);
      if (!lstatSync(top).isDirectory()) throw new FoundryError('DATA_PATH', `${args.root} is not a directory`);
      const lines = [], suffixes = args.suffixes ?? null;
      let files = 0, bytes = 0;
      const walk = (dir, depth) => {
        if (depth > DATA_LIMITS.maxInventoryDepth) throw new FoundryError('DATA_INVENTORY_LIMIT', `deeper than ${DATA_LIMITS.maxInventoryDepth} directories`);
        for (const name of readdirSync(dir).sort()) {
          const full = path.join(dir, name), stat = lstatSync(full);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) { walk(full, depth + 1); continue; }
          if (!stat.isFile() || (suffixes && !suffixes.some(s => name.endsWith(s)))) continue;
          if (++files > DATA_LIMITS.maxInventoryFiles) throw new FoundryError('DATA_INVENTORY_LIMIT', `more than ${DATA_LIMITS.maxInventoryFiles} files; narrow root or suffixes`);
          const rel = path.relative(top, full).split(path.sep).join('/');
          bytes += stat.size;
          lines.push(JSON.stringify({ id: rel, path: rel, bytes: stat.size, ...(args.hash ? { sha256: sha256File(full, stat.size) } : {}) }));
        }
      };
      walk(top, 0);
      const inventory = storeFor(ctx.store.directory).put(lines.length ? `${lines.join('\n')}\n` : '', 'application/x-ndjson');
      return { inventory, files, bytes };
    }
  });
  return registry;
}
