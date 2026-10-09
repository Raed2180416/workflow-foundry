// Relaunch every unfinished arm of one or more stream configs as its own background process (per-arm logs), skipping
// arms that are finished or already running. Used after an environment stop (e.g. the account usage limit).
//   node experiments/jit/resume-streams.mjs experiments/jit/configs/dev-records-1.json [more configs...] [--dry]
import { readFileSync, existsSync, openSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2), dry = args.includes('--dry'), configs = args.filter(a => !a.startsWith('--'));
const slugOf = spec => spec.replace(/^static:.*\/([^/]+)\/([^/]+)\.mjs$/, (_, d, f) => `static-${d}-${f}`).replace(/[:/]/g, m => (m === ':' ? '-' : '--'));
const running = () => { try { return execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }); } catch { return ''; } };
const ps = running();
for (const file of configs) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const total = config.segments.reduce((n, s) => n + s.seeds.length, 0);
  for (const [i, spec] of config.arms.entries()) {
    const dir = path.join('experiments/runs/jit', config.experiment);
    const candidates = existsSync(dir) ? (await import('node:fs')).readdirSync(dir) : [];
    const slug = candidates.find(c => c === slugOf(spec)) ?? slugOf(spec);
    const results = path.join(dir, slug, 'results.jsonl');
    const done = existsSync(results) ? new Set(readFileSync(results, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).idx)).size : 0;
    const isRunning = ps.split('\n').some(l => l.includes('stream.mjs') && l.includes(file) && l.includes(spec));
    const state = done >= total ? 'finished' : isRunning ? 'running' : 'resume';
    console.log(`${config.experiment} ${spec}: ${done}/${total} ${state}`);
    if (state !== 'resume' || dry) continue;
    mkdirSync('experiments/runs/jit/logs', { recursive: true });
    const log = openSync(`experiments/runs/jit/logs/${config.experiment.replace(/^jit-/, '')}-arm${i + 1}.log`, 'a');
    spawn(process.execPath, ['experiments/jit/stream.mjs', '--config', file, '--arms', spec], { detached: true, stdio: ['ignore', log, log] }).unref();
  }
}
