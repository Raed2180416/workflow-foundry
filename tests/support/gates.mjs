// Environment prerequisite gates for tests that genuinely need host tools.
//
// Every gate returns `false` when its prerequisite is present, or a precise,
// human-readable skip reason string. The return value is meant to be passed
// directly as node:test's `skip` option, so every skipped test records WHY it
// did not run (see research/list-skips.mjs). Gates never print environment
// variable values: reasons name variables, not their contents.
//
// A gate must never turn a real failure into a skip. It only reports whether a
// prerequisite exists; behavior of the tool once present (for example an
// allowlisted OpenCode reporting a different --version) is left to the test,
// where drift must fail loudly.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENCODE_V2_ALLOWLIST } from '../../src/opencode-v2-free.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const memo = new Map();
const once = (key, compute) => { if (!memo.has(key)) memo.set(key, compute()); return memo.get(key); };
const isFile = file => { try { return statSync(file).isFile(); } catch { return false; } };
const firstLine = text => String(text ?? '').trim().split(/\r?\n/)[0]?.slice(0, 160) || 'no diagnostic output';

/** Combine gates: false when all pass, otherwise every distinct reason joined by '; '. */
export function combine(...results) {
  const reasons = [...new Set(results.map(result => typeof result === 'function' ? result() : result).filter(Boolean))];
  return reasons.length ? reasons.join('; ') : false;
}

export function linux() {
  return process.platform === 'linux' ? false : `requires Linux (this platform is ${process.platform})`;
}

/** /usr/bin/bwrap present AND able to create user/PID/network namespaces. */
export function bwrap() {
  return once('bwrap', () => {
    const platform = linux(); if (platform) return platform;
    if (!existsSync('/usr/bin/bwrap')) return 'requires /usr/bin/bwrap (not installed in this environment)';
    const probe = spawnSync('/usr/bin/bwrap', ['--die-with-parent', '--unshare-user', '--unshare-pid', '--unshare-net', '--cap-drop', 'ALL',
      '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
      '--proc', '/proc', '--dev', '/dev', '/usr/bin/true'], { encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/bin:/bin' } });
    if (probe.error || probe.status !== 0)
      return `requires /usr/bin/bwrap with working unprivileged user namespaces (probe exit ${probe.status ?? probe.signal ?? probe.error?.code}: ${firstLine(probe.stderr || probe.error?.message)})`;
    return false;
  });
}

/** The v2 adapter and the MCP audit run /usr/bin/node inside the sandbox. */
export function usrBinNode() {
  return isFile('/usr/bin/node') ? false
    : 'requires /usr/bin/node (the bubblewrap sandbox only mounts /usr; not installed in this environment)';
}

/** SHA-256 of /usr/bin/opencode, or null when absent. Memoized per process. */
export function installedOpenCodeSHA256() {
  return once('opencode-sha', () => isFile('/usr/bin/opencode') ? createHash('sha256').update(readFileSync('/usr/bin/opencode')).digest('hex') : null);
}

const pairs = () => OPENCODE_V2_ALLOWLIST.map(entry => entry.version).join(', ');

/** /usr/bin/opencode present, not a link, and its digest on OPENCODE_V2_ALLOWLIST.
 * The reported --version is NOT checked here: the adapter enforces the pair at
 * run time, so a listed digest with a different version fails the test. */
export function opencodeAllowlisted() {
  if (!existsSync('/usr/bin/opencode')) return 'requires /usr/bin/opencode (not installed in this environment)';
  if (realpathSync('/usr/bin/opencode') !== '/usr/bin/opencode') return 'requires /usr/bin/opencode to be the binary itself (it is a link; the adapter refuses links)';
  const digest = installedOpenCodeSHA256();
  if (!OPENCODE_V2_ALLOWLIST.some(entry => entry.sha256 === digest))
    return `requires an allowlisted /usr/bin/opencode (installed sha256:${digest} is not on OPENCODE_V2_ALLOWLIST [${pairs()}]; an owner must verify it and commit an evidence receipt first)`;
  return false;
}

/** Present but NOT allowlisted: used by tests that prove the real refusal. */
export function opencodeUnlisted() {
  if (!existsSync('/usr/bin/opencode')) return 'requires an installed, unlisted /usr/bin/opencode (none is installed in this environment)';
  const digest = isFile('/usr/bin/opencode') ? installedOpenCodeSHA256() : null;
  if (OPENCODE_V2_ALLOWLIST.some(entry => entry.sha256 === digest)) return 'requires an unlisted /usr/bin/opencode (the installed binary is allowlisted)';
  return false;
}

/** Everything the actual v2 adapter (bubblewrap + installed CLI + private server) needs. */
export function actualOpenCodeV2Adapter() {
  return combine(linux, bwrap, usrBinNode, opencodeAllowlisted);
}

function playwrightChromium() {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsers || !existsSync(browsers)) return null;
  const candidates = [path.join(browsers, 'chromium')];
  try {
    for (const name of readdirSync(browsers).filter(name => /^chromium-\d+$/.test(name)).sort().reverse())
      candidates.push(path.join(browsers, name, 'chrome-linux', 'chrome'), path.join(browsers, name, 'chrome-linux64', 'chrome'));
  } catch { return null; }
  return candidates.find(isFile) ?? null;
}

/** Executable path for a Chromium build, or null. Prefers /usr/bin/chromium. */
export function chromiumExecutable() {
  return once('chromium', () => isFile('/usr/bin/chromium') ? '/usr/bin/chromium' : playwrightChromium());
}

export function chromium() {
  return chromiumExecutable() ? false
    : 'requires /usr/bin/chromium or a Playwright chromium under PLAYWRIGHT_BROWSERS_PATH (neither found in this environment)';
}

/** The pinned `playwright` devDependency is installed (npm ci). */
export function playwrightPackage() {
  return existsSync(path.join(root, 'node_modules/playwright/package.json')) ? false
    : 'requires the pinned playwright devDependency in node_modules (run npm ci)';
}

/** Ignored upstream research clones (research/acquire.mjs writes them). */
export function corpus() {
  let present = false;
  try { present = statSync(path.join(root, 'corpus')).isDirectory(); } catch {}
  return present ? false : 'requires corpus/ (ignored upstream clones; not present in this checkout — acquire with research/acquire.mjs)';
}

/** Opt-in lane: skipped with a precise reason unless `variable` is exactly '1'.
 * When opted in, the lane's own prerequisites decide (a missing prerequisite is
 * then reported as such instead of failing deep inside the test). */
export function optInLane(variable, { needs = [], gates = [] } = {}) {
  if (process.env[variable] !== '1') return `opt-in lane: set ${variable}=1${needs.length ? ` (needs ${needs.join(', ')})` : ''}`;
  const missing = combine(...gates);
  return missing ? `opt-in lane ${variable}=1 is set but ${missing}` : false;
}

/** Known opt-in lanes, for the files that own them to adopt as their `skip` value.
 * A browser lane adopting `chromium` must launch `chromiumExecutable()` rather
 * than a hard-coded /usr/bin/chromium, or the gate and the launch disagree. */
export const lanes = Object.freeze({
  packagingE2E: () => optInLane('FOUNDRY_PACKAGING_E2E', { needs: ['corpus/'], gates: [corpus] }),
  uiBrowserE2E: () => optInLane('FOUNDRY_UI_E2E', { needs: ['playwright', 'chromium'], gates: [playwrightPackage, chromium] }),
  uiTrialsE2E: () => optInLane('FOUNDRY_UI_TRIALS_E2E', { needs: ['playwright', 'chromium'], gates: [playwrightPackage, chromium] }),
  mcpRepairAudit: () => optInLane('FOUNDRY_MCP_REPAIR_AUDIT', { needs: ['Linux', '/usr/bin/bwrap', '/usr/bin/node'], gates: [linux, bwrap, usrBinNode] }),
});
