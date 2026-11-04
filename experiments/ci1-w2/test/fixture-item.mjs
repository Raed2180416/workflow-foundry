// A synthetic CI-1 item for tests that must run on a fresh clone (CI-1 review finding 11: the scorer-teeth tests skipped whenever the
// local wave-2 bed was absent). Not derived from the corpus: the reference is the frontier-written worked example "ex-overdue-tasks"
// (experiments/ci1/library/examples.json), its worlds come from the seeded generator below, and the oracle is built exactly as a
// wave-2 oracle is (schema foundry.ci1.oracle/2: reference effects per hidden world, v2 declaration with categorical columns).
import { loadExamples } from '../../ci1/builders.mjs';
import { foundryCanon } from '../../ci1/bed.mjs';
import { tokens } from '../../ci1/canon.mjs';
import { categoricalColumns } from '../../ci1-posthoc/oracle-v2.mjs';

export const FIXTURE_EXAMPLE = loadExamples().find(e => e.id === 'ex-overdue-tasks');
const OWNERS = ['ana.ruiz@team.example', 'ben.okafor@team.example', 'chloe.martin@team.example', 'dev.patel@team.example', 'eva.lind@team.example', 'farid.haddad@team.example', 'gia.tran@team.example', 'hugo.blanc@team.example', 'ines.costa@team.example'];
const TITLES = ['Fix roof', 'Order tiles', 'Call plumber', 'Paint fence', 'Renew permit', 'Book skip', 'Clean gutters'];
const STATUS = ['open', 'Done', 'in progress', 'DONE', 'open'];
/** World i: 2 to 6 tasks, due dates around the run day, mixed status spellings; world 0 has nothing overdue. */
export function fixtureWorld(i) {
  let s = (i + 1) * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const n = 2 + Math.floor(rnd() * 5), now = `2026-03-${String(10 + i).padStart(2, '0')}T08:00:00Z`, day = Date.parse(now.slice(0, 10));
  const rows = Array.from({ length: n }, (_, j) => {
    const offset = i === 0 ? 1 + j : Math.floor(rnd() * 9) - 5;
    return { task_id: `T${i}${j}`, title: TITLES[(i + j) % TITLES.length], owner_email: OWNERS[Math.floor(rnd() * OWNERS.length)],
      due: new Date(day + offset * 86400000).toISOString().slice(0, 10), status: STATUS[Math.floor(rnd() * STATUS.length)], reminded_on: '' };
  });
  return { id: `f${String(i).padStart(2, '0')}`, now, event: null, sheets: { tasks: { columns: FIXTURE_EXAMPLE.workspace.sheets.tasks.columns, rows } } };
}
/** The fixture's frozen-style oracle: 6 hidden worlds and 1 public world, reference effects from the worked example's own runs. */
export async function fixtureOracle() {
  const worlds = Array.from({ length: 7 }, (_, i) => fixtureWorld(i));
  const vocab = new Set(); const walk = v => { if (typeof v === 'string') for (const t of tokens(v)) if (!/^-?\d+(\.\d+)?$/.test(t)) vocab.add(t); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(FIXTURE_EXAMPLE.workflow);
  const ref = [];
  for (const w of worlds) { const f = await foundryCanon(FIXTURE_EXAMPLE.workflow, w); if (f.run.status !== 'succeeded') throw new Error(`fixture reference failed in ${w.id}: ${f.run.error?.message}`); ref.push({ world: w, reference: f.canon }); }
  return { schema: 'foundry.ci1.oracle/2', id: 'fixture-overdue', workspace: FIXTURE_EXAMPLE.workspace,
    decl: { vocab: [...vocab].sort(), mask: {}, freeText: {}, respondCode: false, optional: {}, categorical: [...categoricalColumns(worlds)].sort() },
    hidden: ref.slice(1), public: ref[0] };
}
