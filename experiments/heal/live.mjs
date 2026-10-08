// Live heal campaign driver (2026-10-08). Runs ONE incident through the whole loop with live model calls (claude -p route, journaled),
// under a per-incident cap AND a campaign-wide cap that is shared by every process through an append-only spend file.
// Development/diagnostic evidence only: all three incidents are already-inspected test seeds.
//
//   node experiments/heal/live.mjs --incident rec|cfx|p1 --cap-usd 2 [--global-cap-usd 8] [--tag live1] [--lint-debt strict|defer]
//        [--fresh-n 4] [--fresh-k 1] [--max-rounds 4] [--no-promote] [--out-dir experiments/heal/runs/live-20261008]
//
// Everything lands under --out-dir: <incident>.json (heal-run record), <incident>/ (spend.jsonl, proposer journals, variance
// journal), <incident>.lineage.jsonl, spend-global.jsonl (every charge of every incident), lessons/.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO, WORK_ROOT } from './kit.mjs';
import { healIncident } from './heal.mjs';
import { Budget } from './budget.mjs';

// The same three incidents as incidents.mjs (which runs its offline loop on import, so it cannot be imported here).
export const INCIDENTS = Object.freeze({
  rec: { id: 'H-rec', run: 'F-haiku/records:test:d3:s6001/0', workflow: 'research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json' },
  cfx: { id: 'H-cfx', run: 'F-haiku/codefix:test:d3:s6004/0', workflow: 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json' },
  p1: { id: 'H-p1', run: 'fhand-haiku/records:test:d3:s5002/1', workflow: 'preset:p1-fhand-haiku' },
});

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const has = name => process.argv.includes(`--${name}`);

// A budget with its own cap whose every charge also lands in the campaign-wide file; remaining() honours both caps.
export class CampaignBudget extends Budget {
  constructor(capUsd, { file, globalFile, globalCapUsd, scope }) { super(capUsd, { file }); Object.assign(this, { globalFile, globalCapUsd, scope }); }
  globalSpent() { return existsSync(this.globalFile) ? readFileSync(this.globalFile, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd || 0), 0) : 0; }
  remaining() { return Math.max(0, Math.min(super.remaining(), this.globalCapUsd - this.globalSpent() - this.reserved)); }
  charge(usd, label, detail = {}) {
    const line = super.charge(usd, label, detail);
    mkdirSync(path.dirname(this.globalFile), { recursive: true });
    appendFileSync(this.globalFile, JSON.stringify({ at: line.at, scope: this.scope, label, usd: line.usd }) + '\n');
    return line;
  }
  summary() { return { ...super.summary(), campaignSpentUsd: +this.globalSpent().toFixed(6), campaignCapUsd: this.globalCapUsd }; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const key = arg('incident'), inc = INCIDENTS[key];
  if (!inc) { console.error('usage: live.mjs --incident rec|cfx|p1 --cap-usd N'); process.exit(2); }
  const outDir = path.resolve(arg('out-dir', path.join(REPO, 'experiments/heal/runs/live-20261008'))), tag = arg('tag', 'live1');
  const runsDir = path.join(outDir, key), globalFile = path.join(outDir, 'spend-global.jsonl');
  mkdirSync(runsDir, { recursive: true });
  const budget = new CampaignBudget(Number(arg('cap-usd', '2')), { file: path.join(runsDir, 'spend.jsonl'), globalFile, globalCapUsd: Number(arg('global-cap-usd', '8')), scope: inc.id });
  const started = Date.now();
  const out = await healIncident({
    run: inc.run, workflow: inc.workflow.startsWith('preset:') ? inc.workflow : path.join(REPO, inc.workflow), budget, live: true, promote: !has('no-promote'),
    proposer: 'claude', lintDebt: arg('lint-debt', has('no-promote') ? 'defer' : 'strict'), maxRounds: Number(arg('max-rounds', '4')),
    freshOpts: { n: Number(arg('fresh-n', '4')), k: Number(arg('fresh-k', '1')) }, writeLessons: true, lessonsDir: path.join(outDir, 'lessons'), progress: true,
    stateDir: path.join(WORK_ROOT, 'state', `${tag}-${key}`), lineageFile: path.join(outDir, `${key}.lineage.jsonl`), runsDir,
  });
  out.wallMs = Date.now() - started; out.campaign = { tag, incident: inc.id, cap: budget.capUsd };
  writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify({ incident: inc.id, ...out }, null, 1) + '\n');
  console.log(JSON.stringify({ incident: inc.id, class: out.classification?.class, root: out.localisation?.root?.node, result: out.result, decisions: out.decisions.map(d => [d.kind, d.decision, d.rejectCode]), budget: out.budget, wallS: Math.round(out.wallMs / 1000) }, null, 1));
  process.exit(0);
}
