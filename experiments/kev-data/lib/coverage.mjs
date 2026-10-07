// Coverage script (JUDGE-PROGRAM.md §1.5; §10 contracts-lib acceptance): every inventory decision
// D:A0-D:H6 of 02-decision-inventory.md appears exactly once in the §1.5 coverage map, the totals are
// 47 mapped, 18 deferred and 35 excluded, the deferred set equals the §1.3 table, the excluded set
// equals the §1.4 table, and every mapped decision is the decision of at least one frozen port in
// spec/ports.json (and every port's decision is mapped to it).
//   node experiments/kev-data/lib/coverage.mjs        prints the summary; exit 1 on any error
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, REPO_ROOT } from './contracts.mjs';

export const PROGRAM = path.join(REPO_ROOT, 'research', 'kev-20261007', 'JUDGE-PROGRAM.md');
export const INVENTORY = path.join(REPO_ROOT, 'research', 'kev-20261007', '02-decision-inventory.md');
export const EXPECTED_TOTALS = Object.freeze({ mapped: 47, deferred: 18, excluded: 35 });

const section = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`section not found: ${start}`);
  const j = end ? text.indexOf(end, i + start.length) : -1;
  return text.slice(i, j < 0 ? undefined : j);
};

// Inventory ids from the summary table rows ("| A0 | ...").
export function inventoryIds(text) {
  const ids = [...section(text, '## 3. Summary table', '## 4.').matchAll(/^\|\s*([A-H]\d{1,2})\s*\|/gm)].map(m => `D:${m[1]}`);
  return ids;
}

const expand = (a, b) => {
  if (!b) return [a];
  const [, la, na] = /^D:([A-H])(\d+)$/.exec(a), [, lb, nb] = /^D:([A-H])(\d+)$/.exec(b);
  if (la !== lb || Number(nb) < Number(na)) throw new Error(`bad range ${a}–${b}`);
  return Array.from({ length: Number(nb) - Number(na) + 1 }, (_, i) => `D:${la}${Number(na) + i}`);
};

// §1.5 statements: a group of bold subjects (**D:X1**, **D:X2**, or **D:X1–D:X4**) followed by its
// text up to the next group. The text decides the status.
export function parseCoverageMap(programText) {
  const sec = section(programText, '### 1.5 Coverage map', '**Totals.**');
  const re = /\*\*(D:[A-H]\d{1,2})(?:[–-](D:[A-H]\d{1,2}))?\*\*/g;
  const marks = [...sec.matchAll(re)].map(m => ({ start: m.index, end: m.index + m[0].length, ids: expand(m[1], m[2]) }));
  const groups = [];
  for (const m of marks) {
    const prev = groups.at(-1);
    if (prev && /^\s*,\s*$/.test(sec.slice(prev.end, m.start))) { prev.ids.push(...m.ids); prev.end = m.end; }
    else groups.push({ ids: [...m.ids], end: m.end, start: m.start });
  }
  const out = [];
  groups.forEach((g, i) => {
    const text = sec.slice(g.end, groups[i + 1]?.start ?? sec.length).replace(/\s+/g, ' ').trim();
    let status, targets = [];
    if (text.startsWith('→')) {
      const rest = text.slice(1).trim();
      if (/^excluded\b/.test(rest)) status = 'excluded';
      else { status = 'mapped'; targets = [...new Set([...rest.matchAll(/\b([RISKQXFC]\d)\b/g)].map(m => m[1]))]; }
    } else if (/^deferred\b/.test(text)) status = 'deferred';
    else if (/^(excluded\b|governance \(excluded\))/.test(text)) status = 'excluded';
    else status = 'unparsed';
    for (const id of g.ids) out.push({ id, status, targets, text });
  });
  const totals = /\*\*Totals\.\*\*\s*Mapped (\d+)[^,]*, deferred (\d+), excluded (\d+)/.exec(programText);
  return { statements: out, stated: totals ? { mapped: Number(totals[1]), deferred: Number(totals[2]), excluded: Number(totals[3]) } : null };
}

const tableIds = (text, start, end) => new Set([...section(text, start, end).split('\n').filter(l => /^\|\s*(\*\*|D:)/.test(l))
  .flatMap(l => { const cells = l.split('|'); const cell = start.startsWith('### 1.3') ? cells[1] : cells[2]; return [...(cell ?? '').matchAll(/D:[A-H]\d{1,2}/g)].map(m => m[0]); })]);

export function coverage({ programText = readFileSync(PROGRAM, 'utf8'), inventoryText = readFileSync(INVENTORY, 'utf8'), spec = loadSpec().spec } = {}) {
  const errors = [];
  const inv = inventoryIds(inventoryText);
  const { statements, stated } = parseCoverageMap(programText);
  const seen = new Map();
  for (const s of statements) seen.set(s.id, [...(seen.get(s.id) ?? []), s]);
  for (const id of inv) { const n = seen.get(id)?.length ?? 0; if (n !== 1) errors.push(`${id} appears ${n} times in §1.5`); }
  for (const id of seen.keys()) if (!inv.includes(id)) errors.push(`${id} in §1.5 is not an inventory decision`);
  for (const s of statements) if (s.status === 'unparsed') errors.push(`${s.id}: cannot classify "${s.text.slice(0, 60)}"`);
  const status = id => seen.get(id)?.[0]?.status;
  const totals = { mapped: 0, deferred: 0, excluded: 0 };
  for (const id of inv) if (totals[status(id)] !== undefined) totals[status(id)]++;
  for (const k of Object.keys(EXPECTED_TOTALS)) if (totals[k] !== EXPECTED_TOTALS[k]) errors.push(`${k}: ${totals[k]}, expected ${EXPECTED_TOTALS[k]}`);
  if (!stated || Object.keys(EXPECTED_TOTALS).some(k => stated[k] !== totals[k])) errors.push(`stated totals ${JSON.stringify(stated)} differ from the computed ${JSON.stringify(totals)}`);
  if (inv.length !== 100) errors.push(`inventory has ${inv.length} ids, expected 100 (D:A0-D:H6)`);
  // §1.3 and §1.4 tables
  const deferred13 = tableIds(programText, '### 1.3 Deferred decisions', '**Ledger-only contracts**');
  const excluded14 = tableIds(programText, '### 1.4 Excluded decisions', 'D:A14 moved');
  const set = st => new Set(inv.filter(id => status(id) === st));
  const diff = (a, b) => [...a].filter(x => !b.has(x));
  for (const [name, table, st] of [['§1.3', deferred13, 'deferred'], ['§1.4', excluded14, 'excluded']]) {
    const s = set(st), extra = diff(table, s), missing = diff(s, table);
    if (extra.length || missing.length) errors.push(`${name} table vs §1.5 ${st}: table-only ${extra.join(',') || '-'}; map-only ${missing.join(',') || '-'}`);
  }
  // ports.json
  const ports = Object.values(spec.ports), mapped = set('mapped');
  for (const id of mapped) if (!ports.some(p => p.decisions.includes(id))) errors.push(`${id} is mapped but no frozen port lists it as a decision`);
  for (const p of ports) for (const d of p.decisions) {
    if (!mapped.has(d)) errors.push(`${p.id} lists ${d}, which §1.5 does not map`);
    else if (!seen.get(d)[0].targets.includes(p.id)) errors.push(`${p.id} lists ${d}, but §1.5 maps ${d} to ${seen.get(d)[0].targets.join(', ')}`);
  }
  for (const l of Object.values(spec.ledgerOnly)) for (const d of l.decisions) if (status(d) !== 'deferred') errors.push(`${l.id} (ledger-only) lists ${d}, which is not deferred`);
  return { ok: errors.length === 0, totals, stated, inventory: inv.length, errors,
    byStatus: Object.fromEntries(['mapped', 'deferred', 'excluded'].map(st => [st, inv.filter(id => status(id) === st)])) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = coverage();
  console.log(JSON.stringify({ ok: r.ok, inventory: r.inventory, totals: r.totals, stated: r.stated, errors: r.errors }, null, 2));
  process.exitCode = r.ok ? 0 : 1;
}
