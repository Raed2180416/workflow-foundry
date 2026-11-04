// CI-1 review response (research/ci1-20261021/r/): two guards every CI-1 runner from here on applies, kept in a new file so the frozen
// runners and src/ (the engine v2 series) stay untouched.
//
// 1. Account identity. Root cause of compromise C7 for this route (research/ci1-20261021/r/ACCOUNT-PROBE.md): the cloud session
//    exports the account e-mail as CLAUDE_CODE_USER_EMAIL, the claude-cli provider passes the environment through (src/executors/
//    claude-code.mjs SCRUBBED_ENV does not list it), and the child `claude -p` puts it into the model's context. Removing the
//    variables below from this process's environment before the ModelPort is created removes it from every builder call.
// 2. Disk floor (owner rule: stop and report below 1.2 GB free). A runner checks before each build and stops cleanly (exit 75 with
//    a reason, so the detached wrapper can resume after the disk is freed); a build already running finishes.
import { statfsSync } from 'node:fs';

export const ACCOUNT_ENV = /^CLAUDE_CODE_(USER_EMAIL|ACCOUNT_UUID|ORGANIZATION_UUID)$/;
/** Remove the account identity variables from env (in place); returns the names removed (never the values). */
export function stripAccountIdentity(env = process.env) {
  const removed = Object.keys(env).filter(k => ACCOUNT_ENV.test(k)).sort();
  for (const k of removed) delete env[k];
  return removed;
}
export const DISK_FLOOR_BYTES = 1.2e9;
export const freeBytes = (dir = '/var/tmp') => { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); };
/** null when there is room, else a one-line reason. */
export function diskStop(dir = '/var/tmp', floor = DISK_FLOOR_BYTES, measure = freeBytes) {
  const free = measure(dir);
  return free >= floor ? null : `free disk ${(free / 1e9).toFixed(2)} GB under the ${(floor / 1e9).toFixed(1)} GB floor`;
}
/** Every e-mail address in text, except fixture domains (.example, example.com/org/net, .test, .invalid): for leak checks. */
export const nonFixtureAddresses = text => [...String(text).matchAll(/[\w.+-]+@([\w-]+\.)+[\w-]+/g)].map(m => m[0])
  .filter(m => !/@([\w-]+\.)*(example(\.(com|org|net))?|test|invalid)$/i.test(m));
