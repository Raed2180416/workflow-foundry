#!/usr/bin/env node
// Host-identity scan (research/tracker-20261021/RESULT-TRACKER.md §11, review B1): finds e-mail addresses that belong to the host
// account in files, without storing or printing the address. The identities come only from the environment at run time:
//   FOUNDRY_IDENTITY_SHA256   comma-separated sha256 hex digests of lower-cased addresses (the owner's choice of what to block)
//   CLAUDE_CODE_USER_EMAIL    the cloud session's own account address, when set; it is hashed in memory and never written anywhere
// A finding prints as file:line and a masked form (first character, stars, @domain). Nothing is changed unless --replace is given.
//
//   node scripts/identity-scan.mjs --tracked                      every file git tracks (the commit-time check before a commit)
//   node scripts/identity-scan.mjs --staged                       the staged blobs (usable as a pre-commit hook; this repo installs none)
//   node scripts/identity-scan.mjs <paths...>                     the named files or directories
//   ... --replace requester@example.test                          replace each finding in the working files; the placeholder must have
//                                                                 the same length as the address, so byte offsets inside files hold
// Exit 0: nothing found (or everything replaced); 1: findings remain; 2: no identity in the environment, so nothing could be checked.
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sha256 = s => createHash('sha256').update(s).digest('hex');
// An e-mail-like token. The local part may be glued to text before it ("x.name@..."), so every suffix of the local part that starts
// after a separator is tried as well.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const MAX_BYTES = 32 * 1024 * 1024;

/** The set of sha256 digests to block, from the environment only. */
export function identityHashes(env = process.env) {
  const out = new Set();
  for (const h of String(env.FOUNDRY_IDENTITY_SHA256 ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('FOUNDRY_IDENTITY_SHA256 must hold sha256 hex digests');
    out.add(h);
  }
  if (env.CLAUDE_CODE_USER_EMAIL) out.add(sha256(env.CLAUDE_CODE_USER_EMAIL.trim().toLowerCase()));
  return out;
}

export const mask = a => { const at = a.indexOf('@'); return `${a[0]}${'*'.repeat(Math.max(0, at - 1))}${a.slice(at)}`; };

/** Every occurrence of a blocked address in text: [{ index, length, line, masked }]. */
export function findIdentities(text, hashes) {
  const found = [];
  if (!hashes.size || !text.includes('@')) return found;
  for (const m of text.matchAll(EMAIL)) {
    const token = m[0], at = token.indexOf('@');
    // Candidate starts: the whole token, then after each separator in the local part.
    const starts = [0, ...[...token.slice(0, at)].flatMap((ch, i) => (/[._%+-]/.test(ch) ? [i + 1] : []))];
    for (const s of starts) {
      // The domain may run on into more text ("name@gmail.com.") — try the domain cut at each dot as well.
      const tail = token.slice(s), dots = [...tail.matchAll(/\./g)].map(d => d.index).filter(i => i > tail.indexOf('@'));
      const cands = [tail, ...dots.map(i => tail.slice(0, i))];
      const hit = cands.find(c => hashes.has(sha256(c.toLowerCase())));
      if (hit) {
        const index = m.index + s;
        found.push({ index, length: hit.length, line: text.slice(0, index).split('\n').length, masked: mask(hit) });
        break;
      }
    }
  }
  return found;
}

/** text with every blocked address replaced by `placeholder` (same length required, so offsets hold). */
export function replaceIdentities(text, hashes, placeholder) {
  const found = findIdentities(text, hashes);
  let out = text;
  for (const f of [...found].sort((a, b) => b.index - a.index)) {
    if (placeholder.length !== f.length) throw new Error(`placeholder length ${placeholder.length} differs from the address length ${f.length}`);
    out = out.slice(0, f.index) + placeholder + out.slice(f.index + f.length);
  }
  return { text: out, replaced: found.length };
}

const isBinary = buf => buf.subarray(0, 8192).includes(0);
function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p)) if (f !== '.git' && f !== 'node_modules') walk(path.join(p, f), out); }
  else if (st.isFile()) out.push(p);
}

export function scan({ files, read, hashes, replace = null, write = null }) {
  const findings = [];
  let replaced = 0;
  for (const f of files) {
    let buf;
    try { buf = read(f); } catch { continue; }
    if (!buf || buf.length > MAX_BYTES || isBinary(buf)) continue;
    const text = buf.toString('utf8');
    const hits = findIdentities(text, hashes);
    if (!hits.length) continue;
    if (replace && write) { const r = replaceIdentities(text, hashes, replace); write(f, r.text); replaced += r.replaced; }
    for (const h of hits) findings.push({ file: f, line: h.line, masked: h.masked });
  }
  return { findings, replaced };
}

async function main(argv) {
  const args = argv.slice(2);
  const ri = args.indexOf('--replace');
  const replace = ri >= 0 ? args[ri + 1] : null;
  if (ri >= 0) args.splice(ri, 2);
  const hashes = identityHashes();
  if (!hashes.size) { console.error('identity-scan: no identity in the environment (FOUNDRY_IDENTITY_SHA256 or CLAUDE_CODE_USER_EMAIL); nothing checked'); return 2; }
  let files, read = f => readFileSync(f);
  if (args.includes('--staged')) {
    files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    read = f => execFileSync('git', ['show', `:${f}`], { maxBuffer: MAX_BYTES * 2 });
    if (replace) { console.error('identity-scan: --replace works on working files, not on staged blobs'); return 2; }
  } else if (args.includes('--tracked') || !args.length) {
    files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean);
  } else {
    files = [];
    for (const p of args) walk(p, files);
  }
  const { findings, replaced } = scan({ files, read, hashes, replace, write: (f, t) => writeFileSync(f, t) });
  const byFile = new Map();
  for (const x of findings) byFile.set(x.file, [...(byFile.get(x.file) ?? []), x]);
  for (const [f, xs] of byFile) console.log(`${f}: ${xs.length} (lines ${[...new Set(xs.map(x => x.line))].slice(0, 12).join(', ')}${xs.length > 12 ? ', ...' : ''}) ${xs[0].masked}`);
  console.log(`identity-scan: ${findings.length} occurrence(s) in ${byFile.size} file(s)${replace ? `; replaced ${replaced}` : ''}`);
  return findings.length && !replace ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then(code => { process.exitCode = code; }, e => { console.error(`identity-scan: ${e.message}`); process.exitCode = 2; });
