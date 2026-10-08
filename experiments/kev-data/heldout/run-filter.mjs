// Run the two-model filter over the surface files (the hosted-arms group's job; no model is called
// here unless a provider module is passed).
//   node experiments/kev-data/heldout/run-filter.mjs --providers <module.mjs> [--heldout DIR] [--rounds 3]
// The module exports `sonnet` and `opus`: async ({model, port, request, mode}) => {answer}.
// Each round filters the units that are `pending-filter`, writes the reject log (both answers), and
// re-selects: rejected units leave their quota and reserve units are promoted (class mixes such as the
// R4 window balance and the X1 addressee shares are kept), until every quota is met or the reserve is
// empty. Shortfalls are reported, never padded.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadSpec } from '../lib/contracts.mjs';
import { runTwoModelFilter, rejectLogLines, checkFilterInvariant } from './filter.mjs';
import { selectPool } from './assemble.mjs';
import { POOLS } from './pools.mjs';
import { HELDOUT_DIR, serializeUnit } from './author.mjs';

export function deserializeUnit(o) { return { ...o, tagMap: o.tags ?? {}, tags: Object.keys(o.tags ?? {}).sort() }; }
const DECISIVE = Object.keys(POOLS);

export async function filterRound(surface, { contracts, providers, cities }) {
  const units = Object.values(surface).flat();
  const pendingBefore = units.filter(u => u.status === 'pending-filter').length;
  const { rejects } = await runTwoModelFilter(units, { contracts, providers, cities });
  const errors = [], stats = {};
  for (const port of DECISIVE) selectPool(port, surface[port] ?? [], errors, stats);
  return { pendingBefore, rejects, errors, stats };
}

export async function runFilter({ heldout = HELDOUT_DIR, providers, rounds = 3, contracts = loadSpec().contracts } = {}) {
  const surface = {}, files = {};
  for (const f of ['R1', 'R2', 'R3', 'R4', 'I1', 'I2', 'S2', 'Q4', 'X1', 'X3', 'X5', 'X8', 'F1', 'S5', 'Q2']) {
    const file = path.join(heldout, 'surface', `${f}.jsonl`); files[f] = file;
    surface[f] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => deserializeUnit(JSON.parse(l)));
  }
  const cities = JSON.parse(readFileSync(path.join(heldout, 'cities.json'), 'utf8')).cities;
  const log = [];
  for (let r = 1; r <= rounds; r++) {
    const out = await filterRound(surface, { contracts, providers, cities });
    log.push({ round: r, filtered: out.pendingBefore, rejected: out.rejects.length, shortfalls: out.errors.length });
    if (out.rejects.length) appendFileSync(path.join(heldout, 'reject-log.jsonl'), rejectLogLines(out.rejects));
    if (!out.pendingBefore || (!out.rejects.length && !surface.R1.some(u => u.status === 'pending-filter'))) break;
  }
  for (const [port, f] of Object.entries(files)) writeFileSync(f, surface[port].map(u => JSON.stringify(serializeUnit(u))).join('\n') + '\n');
  const bad = Object.values(surface).flat().map(checkFilterInvariant).filter(Boolean);
  return { log, invariantViolations: bad };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = Object.fromEntries(args.map((a, i) => (a.startsWith('--') ? [a.slice(2), args[i + 1]] : null)).filter(Boolean));
  if (!opt.providers) { console.error('usage: run-filter.mjs --providers <module.mjs> [--heldout DIR] [--rounds N]'); process.exit(2); }
  const mod = await import(pathToFileURL(path.resolve(opt.providers)).href);
  const res = await runFilter({ heldout: path.resolve(opt.heldout ?? HELDOUT_DIR), providers: { sonnet: mod.sonnet, opus: mod.opus }, rounds: Number(opt.rounds ?? 3) });
  console.log(JSON.stringify(res, null, 1));
  process.exitCode = res.invariantViolations.length ? 1 : 0;
}
