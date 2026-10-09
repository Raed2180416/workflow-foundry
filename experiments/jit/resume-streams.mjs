// Relaunch every unfinished arm of one or more stream configs as its own background process (per-arm logs), skipping
// arms that are finished or already running. Used after an environment stop (e.g. the account usage limit).
//   node experiments/jit/resume-streams.mjs experiments/jit/configs/dev-records-1.json [more configs...] [--dry] [--export-only] [--commit]
//     [--run-root dir] (default experiments/runs/jit; a relaunched arm is given the same --run-root)
// First, every config's run directory is exported as text (stream.mjs exportRun: <runDir>/export/ with MANIFEST.json;
// BLOCKER-SYNTHESIS S0-1) and mirrored into the config's persist.commitDir when it sets one; --commit mirrors into
// stream.mjs DEFAULT_COMMIT_DIR when it does not. An export failure stops the script (exit 1). --export-only stops after
// the export and prints each mirrored directory (relative to the repository) on stdout, one per line (snapshot.sh reads it).
import { readFileSync, existsSync, openSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_ROOT, exportRun, persistOf, DEFAULT_MAX_BODY_BYTES } from './stream.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2), dry = args.includes('--dry'), exportOnly = args.includes('--export-only'), commit = args.includes('--commit');
const runRootAt = args.indexOf('--run-root'), runRoot = runRootAt >= 0 ? path.resolve(args[runRootAt + 1]) : RUN_ROOT;
const configs = args.filter((a, i) => !a.startsWith('--') && !(runRootAt >= 0 && i === runRootAt + 1));
const say = exportOnly ? (...x) => console.error(...x) : (...x) => console.log(...x);
const slugOf = spec => spec.replace(/^static:.*\/([^/]+)\/([^/]+)\.mjs$/, (_, d, f) => `static-${d}-${f}`).replace(/[:/]/g, m => (m === ':' ? '-' : '--'));
const running = () => { try { return execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }); } catch { return ''; } };
const ps = running();
for (const file of configs) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const dir = path.join(runRoot, config.experiment);
  if (existsSync(dir)) {
    const persist = persistOf(config, { commit });
    const res = exportRun(dir, { commitDir: persist?.commitDir ?? null, maxBodyBytes: persist?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES });
    say(`${config.experiment} export: ${Object.keys(res.manifest.files).length} files, ${res.changed.length} changed${res.commitDir ? `; mirror ${path.relative(REPO, res.commitDir)} (${res.mirrored.length} changed)` : ''}`);
    if (exportOnly && res.commitDir) console.log(path.relative(REPO, res.commitDir));
  } else say(`${config.experiment}: no run directory yet (nothing to export)`);
  if (exportOnly) continue;
  const total = config.segments.reduce((n, s) => n + s.seeds.length, 0);
  for (const [i, spec] of config.arms.entries()) {
    const candidates = existsSync(dir) ? (await import('node:fs')).readdirSync(dir) : [];
    const slug = candidates.find(c => c === slugOf(spec)) ?? slugOf(spec);
    const results = path.join(dir, slug, 'results.jsonl');
    const done = existsSync(results) ? new Set(readFileSync(results, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).idx)).size : 0;
    const isRunning = ps.split('\n').some(l => l.includes('stream.mjs') && l.includes(file) && l.includes(spec));
    const state = done >= total ? 'finished' : isRunning ? 'running' : 'resume';
    console.log(`${config.experiment} ${spec}: ${done}/${total} ${state}`);
    if (state !== 'resume' || dry) continue;
    const logs = path.join(runRoot, 'logs');
    mkdirSync(logs, { recursive: true });
    const log = openSync(path.join(logs, `${config.experiment.replace(/^jit-/, '')}-arm${i + 1}.log`), 'a');
    spawn(process.execPath, [path.join(REPO, 'experiments/jit/stream.mjs'), '--config', file, '--arms', spec, ...(runRoot !== RUN_ROOT ? ['--run-root', runRoot] : [])], { detached: true, stdio: ['ignore', log, log] }).unref();
  }
}
