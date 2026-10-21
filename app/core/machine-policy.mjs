// An organisation's policy for this computer (P4 walkthrough M1): a file IT controls, outside every Foundry folder, that can only make
// Foundry stricter. It is read on every check, by the service (live runs refused) and by the settings (the switch shown as "Set by your
// organisation", with no way to turn it off in the page).
//
//   where   /etc/foundry/policy.json (Linux), /Library/Application Support/Foundry/policy.json (macOS), %ProgramData%\Foundry\policy.json
//           (Windows); plus FOUNDRY_POLICY_FILE when set (tests, or a pilot that keeps the file elsewhere).
//   what    { "mode": "practice-only", "allowedAI": "none" }  (any subset; unknown keys and values are ignored)
//   rules   restrictions only: every file found is applied and the strictest value wins, so pointing FOUNDRY_POLICY_FILE at another file
//           can add a restriction but never remove one. On Linux and macOS the default file counts only when it is owned by root and not
//           writable by group or others (otherwise the user could edit it, and it would not be an IT control); it is then reported as
//           ignored. Nothing here is a secret; the file is plain JSON.
import { readFileSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';

export function policyFiles({ env = process.env, os = platform() } = {}) {
  const base = os === 'darwin' ? '/Library/Application Support/Foundry/policy.json'
    : os === 'win32' ? path.join(env.ProgramData ?? 'C:\\ProgramData', 'Foundry', 'policy.json') : '/etc/foundry/policy.json';
  return [{ file: base, requireRoot: os !== 'win32' }, ...(env.FOUNDRY_POLICY_FILE ? [{ file: path.resolve(env.FOUNDRY_POLICY_FILE), requireRoot: false }] : [])];
}

/** { mode?: 'practice-only', allowedAI?: 'none', files: [path], ignored: [{file, why}] } */
export function machinePolicy(options = {}) {
  const out = { files: [], ignored: [] };
  for (const { file, requireRoot } of policyFiles(options)) {
    let st; try { st = statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    if (requireRoot && (st.uid !== 0 || (st.mode & 0o022) !== 0)) { out.ignored.push({ file, why: 'not owned by root, or writable by others' }); continue; }
    let v; try { v = JSON.parse(readFileSync(file, 'utf8')); } catch { out.ignored.push({ file, why: 'not readable JSON' }); continue; }
    if (!v || typeof v !== 'object') continue;
    out.files.push(file);
    if (v.mode === 'practice-only') out.mode = 'practice-only';
    if (v.allowedAI === 'none') out.allowedAI = 'none';
  }
  return out;
}
