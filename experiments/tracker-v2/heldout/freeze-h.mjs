#!/usr/bin/env node
// Freeze manifest for PREREG-TRACKER-H (research/tracker-20261021/heldout/freeze-h.json): sha256 of the held-out cases, gold and requests,
// every code file the held-out builds, captures, binds, judges and reviews run through, the prompts, the templates and the $0 builds
// (reference and control records). `node experiments/tracker-v2/heldout/freeze-h.mjs` writes it; `--check` compares the tree against it
// and exits 1 on any drift not recorded in research/tracker-20261021/heldout/deviations-h.json (with the file's exact new hash).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPTURE_SYSTEM, BIND_SYSTEM, CAPTURE_PROMPT_ID, BIND_PROMPT_ID } from '../../../app/core/tracker/model.mjs';
import { PROSE_SYSTEM, PROSE_PROMPT_ID } from '../prose.mjs';
import { B0_SYSTEM, B0_VERSION } from '../../surface/b0.mjs';
import { AUTHOR_SYSTEM, AUTHOR_PROMPT_ID } from './author.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(ROOT, 'research/tracker-20261021/heldout');
const FILE = path.join(DIR, 'freeze-h.json');
const sha = b => createHash('sha256').update(b).digest('hex');
const ls = (dir, re = /\.mjs$/) => readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`);
const CODE = [...ls('app/core/tracker'), 'app/core/practice.mjs', 'app/core/stand-ins.mjs', 'app/core/capabilities.mjs', 'app/core/library.mjs', 'app/core/builder-model.mjs',
  'experiments/surface/oracle.mjs', 'experiments/surface/person.mjs', 'experiments/surface/run-builder-eval.mjs', 'experiments/surface/b0.mjs', 'experiments/surface/metrics.mjs',
  'experiments/tracker-v2/builder1.mjs', 'experiments/tracker-v2/run-builder1.mjs', 'experiments/tracker-v2/prose.mjs', 'experiments/lib/models.mjs',
  ...ls('experiments/tracker-v2/heldout', /\.(mjs|sh)$/)].filter(f => !f.endsWith('freeze-h.mjs'));
const INPUTS = ['research/tracker-20261021/heldout/cases.json', 'research/tracker-20261021/heldout/gold-heldout.json', 'research/tracker-20261021/heldout/requests-mercury-3.json',
  'research/tracker-20261021/PREREG-TRACKER-H.md', 'policy/models.json'];
const records = () => Object.fromEntries(['ref', 'control'].flatMap(arm => {
  const dir = path.join(DIR, 'runs', arm, 'records');
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => [`${arm}/${f}`, sha(readFileSync(path.join(dir, f)))]) : [];
}));
function manifest() {
  return {
    prereg: 'research/tracker-20261021/PREREG-TRACKER-H.md',
    code: Object.fromEntries(CODE.map(f => [f, sha(readFileSync(path.join(ROOT, f)))])),
    prompts: { [CAPTURE_PROMPT_ID]: sha(CAPTURE_SYSTEM), [BIND_PROMPT_ID]: sha(BIND_SYSTEM), [PROSE_PROMPT_ID]: sha(PROSE_SYSTEM), [B0_VERSION]: sha(B0_SYSTEM), [AUTHOR_PROMPT_ID]: sha(AUTHOR_SYSTEM) },
    inputs: Object.fromEntries(INPUTS.map(f => [f, sha(readFileSync(path.join(ROOT, f)))])),
    templates: Object.fromEntries(readdirSync(path.join(ROOT, 'app/core/templates')).sort().map(f => [f, sha(readFileSync(path.join(ROOT, 'app/core/templates', f)))])),
    zeroCostBuilds: records(),
  };
}
const m = manifest();
if (process.argv.includes('--check')) {
  if (!existsSync(FILE)) { console.error('no freeze-h.json'); process.exit(1); }
  const f = JSON.parse(readFileSync(FILE, 'utf8'));
  const devFile = path.join(DIR, 'deviations-h.json');
  const devs = existsSync(devFile) ? Object.entries(JSON.parse(readFileSync(devFile, 'utf8'))).filter(([k]) => /^H?D\d+$/.test(k)) : [];
  const drift = [], accepted = [];
  for (const k of ['code', 'prompts', 'inputs', 'templates', 'zeroCostBuilds']) {
    for (const [name, h] of Object.entries(f[k])) {
      if (m[k][name] === h) continue;
      const dev = devs.find(([, d]) => d.files?.[name] === m[k][name]);
      if (dev) accepted.push(`${k}: ${name} (${dev[0]})`); else drift.push(`${k}: ${name}${m[k][name] ? '' : ' (missing)'}`);
    }
    for (const name of Object.keys(m[k])) if (!(name in f[k])) drift.push(`${k}: ${name} (new since the freeze)`);
  }
  if (drift.length) { console.error(`drift since the held-out freeze:\n${drift.join('\n')}`); process.exit(1); }
  console.log(accepted.length ? `no unrecorded drift; recorded deviations: ${accepted.join(', ')}` : 'no drift');
} else {
  writeFileSync(FILE, `${JSON.stringify({ frozenAt: new Date().toISOString(), ...m }, null, 1)}\n`);
  console.log(`wrote ${path.relative(ROOT, FILE)}: ${Object.keys(m.code).length} code files, ${Object.keys(m.zeroCostBuilds).length} $0 builds`);
}
