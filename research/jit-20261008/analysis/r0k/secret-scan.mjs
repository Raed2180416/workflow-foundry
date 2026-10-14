#!/usr/bin/env node
// Extended secret scan of a finished run (R0-RUNBOOK section 3, step 1) and the outsidePaths check of ENGINE-FREEZE E1c
// gates. $0, read-only, prints FILE NAMES and counts only (never a matched line or any file content).
//   node secret-scan.mjs [--out secret-scan-jit-r0-kinetics.json] <dir-or-file> [<dir-or-file> ...]
// Patterns: the runbook's extended set (an Anthropic API key prefix, a JWT-shaped pair, the OAuth-token and session-ingress
// file names, the managed-login directory). Each is written with one bracketed character so that this file does not match
// its own patterns (the bracketed form matches exactly the same strings). A positive control (a fake credential written to
// a temp directory at run time, in pieces) must be found, or the script exits 2: a scan that cannot find a plant is void.
// outsidePaths: every JSON / JSONL file is parsed; the key 'outsidePaths' (compile.json, traces) is collected, and an entry
// under /home/claude or /root/.ccr is a failure (the sandbox kept only the login file, never those directories).
import { readdirSync, readFileSync, lstatSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PATTERNS = { 'api-key-prefix': /sk-ant[-]/, 'jwt-pair': /eyJ[A-Za-z0-9_-]{10,}\.eyJ/, 'oauth-token-name': /oauth_toke[n]/, 'session-ingress-name': /session_ingres[s]/, 'managed-login-dir': /\.claude\/remot[e]/ };
const HOST_CRED = /^\/home\/claude|^\/root\/\.ccr/;

const walk = (p, out = []) => {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) { out.push({ p, link: true }); return out; }
  if (st.isDirectory()) for (const e of readdirSync(p)) walk(path.join(p, e), out);
  else out.push({ p, link: false });
  return out;
};
const scanText = txt => Object.entries(PATTERNS).filter(([, re]) => re.test(txt)).map(([k]) => k);

// positive control, planted at run time from pieces
const ctl = mkdtempSync(path.join(tmpdir(), 'scan-ctl-'));
writeFileSync(path.join(ctl, 'plant.txt'), ['x ', 'sk-ant', '-', 'api03-PLANT y'].join(''));
const control = walk(ctl).map(f => ({ f: path.basename(f.p), hits: scanText(readFileSync(f.p, 'latin1')) }));
rmSync(ctl, { recursive: true, force: true });
if (!control.some(c => c.hits.includes('api-key-prefix'))) { console.error('positive control not found: the scan is void'); process.exit(2); }

const args = process.argv.slice(2), outAt = args.indexOf('--out'), outFile = outAt >= 0 ? args[outAt + 1] : null;
const targets = args.filter((a, i) => !(outAt >= 0 && (i === outAt || i === outAt + 1)));
const report = { patterns: Object.keys(PATTERNS), positiveControl: 'found', locations: [], outsidePaths: { files: 0, withKey: 0, nonEmpty: 0, hostCredentialEntries: [], distinctEntries: 0 } };
const distinct = new Set();
for (const t of targets) {
  const files = walk(t), hits = [], links = files.filter(f => f.link).map(f => f.p);
  let bytes = 0;
  for (const f of files.filter(x => !x.link)) {
    const buf = readFileSync(f.p), txt = buf.toString('latin1');
    bytes += buf.length;
    const h = scanText(txt);
    if (h.length) hits.push({ file: f.p, patterns: h });
    if (/\.jsonl?$/.test(f.p) && txt.includes('outsidePaths')) {
      report.outsidePaths.files++;
      const docs = f.p.endsWith('.jsonl') ? txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [JSON.parse(txt)];
      const visit = o => { if (Array.isArray(o)) o.forEach(visit); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'outsidePaths') { report.outsidePaths.withKey++; const a = Array.isArray(v) ? v : [v]; if (a.length) report.outsidePaths.nonEmpty++; for (const x of a) { const s = typeof x === 'string' ? x : JSON.stringify(x); distinct.add(s); if (HOST_CRED.test(s)) report.outsidePaths.hostCredentialEntries.push({ file: f.p, entry: s }); } } visit(v); } };
      docs.forEach(visit);
    }
  }
  report.locations.push({ path: t, files: files.filter(f => !f.link).length, bytes, symlinks: links.length, hitFiles: hits });
}
report.outsidePaths.distinctEntries = distinct.size;
report.clean = report.locations.every(l => !l.hitFiles.length) && !report.outsidePaths.hostCredentialEntries.length;
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ clean: report.clean, locations: report.locations.map(l => ({ path: l.path, files: l.files, symlinks: l.symlinks, hitFiles: l.hitFiles.length })), outsidePaths: report.outsidePaths }, null, 1));
process.exit(report.clean ? 0 : 1);
