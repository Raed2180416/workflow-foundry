// Conformance of spec/ports.json to the program text (JUDGE-PROGRAM.md revision 2). The acceptance
// validator (lib/contracts.mjs validateSpec) checks shape; this checks content against the program:
//   §1.2  every quoted wording Q0-Q3 verbatim; every quoted option description verbatim; option names
//         where the program lists them; wordings and descriptions the program does not give are
//         reported as authored
//   §1.1  port names, option counts (K), real-token budgets typical/max, the [M] evidence tag, waves,
//         the wave-1 list and the port count
//   §1.0  deployment rates (bed-natural S2, I2, X1, X8; balanced-within-entity R1-R4, X5; uniform)
//   §3.4  train and held-out families (bases and counts: "codefix: 4 domains", "bedtype (7 families)")
//   §6.1  epsilon: X5 0.02, every other port 0.05
// conformance({programText, spec}) -> { deviations: [{port, field, kind, program, spec}], checked }
//   kind: 'changed' (the spec differs from the program's text) or 'authored' (the program gives none).
// Every deviation must be a recorded gap: the contracts-lib test holds the allow-list and requires a
// specGaps entry for each.
//   node experiments/kev-data/lib/conform.mjs     prints the deviations
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, REPO_ROOT } from './contracts.mjs';

export const PROGRAM = path.join(REPO_ROOT, 'research', 'kev-20261007', 'JUDGE-PROGRAM.md');
const norm = s => String(s).replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
const section = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`section not found: ${start}`);
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? undefined : j);
};
const num = s => { const m = /^([\d.]+)(K?)$/.exec(s.trim()); return m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : NaN; };
const expandIds = text => text.split(/,\s*/).flatMap(t => {
  const m = /^([A-Z])(\d)[–-]\1?(\d)$/.exec(t.trim());
  return m ? Array.from({ length: Number(m[3]) - Number(m[2]) + 1 }, (_, i) => `${m[1]}${Number(m[2]) + i}`) : [t.trim()];
});
const stripParens = s => { let out = s, prev; do { prev = out; out = out.replace(/\([^()]*\)/g, ''); } while (out !== prev); return out; };
const familyBase = f => (f.startsWith('bedtype:') ? 'bedtype' : f.split(':')[0]);

// §1.2: one block of text per port header (**R1 `date_order`**), up to the next header.
export function portSections(programText) {
  const sec = section(programText, '### 1.2 Port specifications', '### 1.3 ');
  const re = /\*\*([RISKQXFC]\d) `([a-z_]+)`\*\*/g, marks = [...sec.matchAll(re)];
  const out = {};
  marks.forEach((m, i) => {
    const end = Math.min(marks[i + 1]?.index ?? sec.length, ...['\n#### ', '\n**C3–C6'].map(h => { const j = sec.indexOf(h, m.index); return j < 0 ? sec.length : j; }));
    out[m[1]] = { name: m[2], text: sec.slice(m.index, end) };
  });
  return out;
}
export function parsePortSection(text) {
  const t = norm(text);
  const wordings = {};
  for (const m of t.matchAll(/\*\*Q([0-3])\*\* "([^"]+)"/g)) wordings[`Q${m[1]}`] ??= m[2];
  const head = /^\*\*[A-Z]\d `[a-z_]+`\*\* \([^)]*\)\. "([^"]+)"/.exec(t);
  if (head && !wordings.Q0) wordings.Q0 = head[1];
  const descriptions = {};
  for (const m of t.matchAll(/- `([^`]+)`: "([^"]+)"/g)) descriptions[m[1]] ??= m[2];
  let names = null;
  const opt = /\*\*Opt\.\*\* (.*?)(?= - \*\*|$)/.exec(t);
  if (opt) {
    const list = norm(stripParens(opt[1])).replace(/\. Each has.*$/, '').replace(/\.$/, '');
    if (/^`[^`]+`(?:(?:, | and |, and )`[^`]+`)+$/.test(list)) names = [...list.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  }
  if (!names && Object.keys(descriptions).length) names = Object.keys(descriptions);
  return { wordings, descriptions, names };
}

// §1.1 table rows.
export function portTable(programText) {
  const sec = section(programText, '### 1.1 Port table', '### 1.2 ');
  const rows = {};
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    const m = /^([RISKQXFC]\d) `([a-z_]+)`$/.exec(cells[1] ?? '');
    if (!m) continue;
    const [, , , k, fam, tok, use, label, wave] = cells;
    const tm = /^([\d.]+K?)\/([\d.]+K?)/.exec(tok);
    rows[m[1]] = { name: m[2], k, fam, tok, typical: tm ? num(tm[1]) : NaN, max: tm ? num(tm[2]) : NaN, evidence: /\[M\]/.test(tok) ? 'M' : 'E', use, label, wave: Number(/^\d/.exec(wave)?.[0]) };
  }
  const w1 = /\*\*Wave 1 \((\d+)\):\*\* ([^.]+)\./.exec(sec);
  const count = /\*\*Count\.\*\* (\d+) ports/.exec(sec);
  return { rows, wave1: w1 ? expandIds(w1[2]) : null, wave1Count: w1 ? Number(w1[1]) : null, count: count ? Number(count[1]) : null };
}

// §1.0 deployment base rates.
export function deploymentRates(programText) {
  const sec = norm(section(programText, '**Deployment base rate**', '**Default consumer route.**'));
  const ids = name => { const m = new RegExp('`' + name + '` \\(([^)]*)\\)').exec(sec); return m ? expandIds(m[1].split(/:/)[0]) : null; };
  return { 'bed-natural': ids('bed-natural'), 'balanced-within-entity': ids('balanced-within-entity') };
}

// §3.4 held-out families.
export function familyTable(programText) {
  const sec = section(programText, '### 3.4 Held-out families', '### 3.5 ');
  const rows = {};
  const items = cell => {
    const raw = norm(cell.replace(/\*\*/g, ''));
    if (/^none\b/.test(raw)) return { items: [], text: raw };
    const parts = []; let depth = 0, cur = '';
    for (const ch of raw) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    return { text: raw, items: parts.map(p => p.trim()).filter(Boolean).map(p => {
      const count = /\((\d+) families\)/.exec(p)?.[1] ?? /:\s*(\d+) domains/.exec(p)?.[1];
      const base = norm(stripParens(p)).replace(/:.*$/, '').trim().toLowerCase().replace(/\s+/g, '-');
      return { base, count: count ? Number(count) : null };
    }) };
  };
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (!/^[RISKQXFC]\d$/.test(cells[1] ?? '')) continue;
    rows[cells[1]] = { train: items(cells[2]), heldOut: items(cells[3]) };
  }
  return rows;
}

export function conformance({ programText = readFileSync(PROGRAM, 'utf8'), spec = loadSpec().spec } = {}) {
  const deviations = [], dev = (port, field, kind, program, specValue) => deviations.push({ port, field, kind, program, spec: specValue });
  let checked = 0;
  const sections = portSections(programText), table = portTable(programText), rates = deploymentRates(programText), fams = familyTable(programText);
  const ports = spec.ports;
  // §1.1
  if (table.count !== Object.keys(ports).length) dev('*', 'count', 'changed', table.count, Object.keys(ports).length);
  const wave1 = Object.keys(ports).filter(id => ports[id].wave === 1).sort();
  if (JSON.stringify([...(table.wave1 ?? [])].sort()) !== JSON.stringify(wave1) || table.wave1Count !== wave1.length) dev('*', 'wave1', 'changed', table.wave1, wave1);
  for (const [id, c] of Object.entries(ports)) {
    const row = table.rows[id];
    if (!row) { dev(id, 'table', 'changed', null, c.name); continue; }
    checked++;
    if (row.name !== c.name) dev(id, 'name', 'changed', row.name, c.name);
    if (row.wave !== c.wave) dev(id, 'wave', 'changed', row.wave, c.wave);
    if (row.typical !== c.budget.typical || row.max !== c.budget.max) dev(id, 'budget', 'changed', `${row.typical}/${row.max}`, `${c.budget.typical}/${c.budget.max}`);
    if (row.evidence !== c.budget.evidence) dev(id, 'budget.evidence', 'changed', row.evidence, c.budget.evidence);
    const nOpts = c.options ? Object.keys(c.options).length : null;
    const k = /^(≤)?(\d+)(?:–(\d+))?/.exec(row.k);
    if (k && nOpts !== null && (k[1] ? nOpts > Number(k[2]) : k[3] ? (nOpts < Number(k[2]) || nOpts > Number(k[3])) : nOpts !== Number(k[2]))) dev(id, 'options.count', 'changed', row.k, nOpts);
    if (k && nOpts === null && c.optionSource && (k[1] || k[3]) && c.optionSource.max > Number(k[3] ?? k[2])) dev(id, 'optionSource.max', 'changed', row.k, c.optionSource.max);
    // §1.1 fam: every bed a port trains on is named there (named sources such as composer are not checked)
    for (const f of c.families.train.map(familyBase)) if (['records', 'incident', 'synth', 'kinetics', 'runbook', 'gameqa', 'gridquest', 'codefix', 'ownerci'].includes(f) && !row.fam.includes(f) && !(row.fam.includes('8 beds') && id === 'X1')) dev(id, 'families.train', 'changed', row.fam, c.families.train);
  }
  // §1.0
  for (const [id, c] of Object.entries(ports)) {
    const want = rates['bed-natural']?.includes(id) ? 'bed-natural' : rates['balanced-within-entity']?.includes(id) ? 'balanced-within-entity' : 'uniform';
    if (c.deploymentRate !== want) dev(id, 'deploymentRate', 'changed', want, c.deploymentRate);
  }
  // §6.1
  if (!/X5: ε = 2%/.test(programText) || !/ε = 5%/.test(programText)) dev('*', 'epsilon', 'changed', 'program text', null);
  for (const [id, c] of Object.entries(ports)) if (c.epsilon !== (id === 'X5' ? 0.02 : 0.05)) dev(id, 'epsilon', 'changed', id === 'X5' ? 0.02 : 0.05, c.epsilon);
  // §3.4
  for (const [id, row] of Object.entries(fams)) {
    const c = ports[id];
    if (!c) { dev(id, 'families', 'changed', row, null); continue; }
    for (const side of ['train', 'heldOut']) {
      const listed = c.families[side], bases = [...new Set(listed.map(familyBase))], want = row[side];
      const missing = want.items.filter(x => !bases.includes(x.base)).map(x => x.base);
      const extra = bases.filter(b => !want.items.some(x => x.base === b) && !new RegExp(`\\b${b}\\b`).test(want.text));
      const counts = want.items.filter(x => x.count !== null && listed.filter(f => familyBase(f) === x.base && f.includes(':')).length !== x.count);
      if (missing.length || extra.length || counts.length) dev(id, `families.${side}`, 'changed', want.text, listed);
    }
  }
  // §1.2
  for (const [id, c] of Object.entries(ports)) {
    const s = sections[id];
    const p = s ? parsePortSection(s.text) : { wordings: {}, descriptions: {}, names: null };
    if (s && s.name !== c.name) dev(id, 'name', 'changed', s.name, c.name);
    for (const q of ['Q0', 'Q1', 'Q2', 'Q3']) {
      if (!p.wordings[q]) dev(id, `wordings.${q}`, 'authored', null, c.wordings[q]);
      else if (norm(p.wordings[q]) !== norm(c.wordings[q])) dev(id, `wordings.${q}`, 'changed', p.wordings[q], c.wordings[q]);
    }
    if (c.options) {
      const names = Object.keys(c.options);
      if (p.names && (p.names.length !== names.length || p.names.some(n => !names.includes(n)))) dev(id, 'options', 'changed', p.names, names);
      for (const [o, d] of Object.entries(c.options)) {
        if (p.descriptions[o] !== undefined) { if (norm(p.descriptions[o]) !== norm(d)) dev(id, `options.${o}`, 'changed', p.descriptions[o], d); }
        else if ((p.names?.includes(o) || !s) && !c.optionsFrom) dev(id, 'options.descriptions', 'authored', null, names);
      }
    }
  }
  // one 'options.descriptions' deviation per port
  const seen = new Set();
  return { deviations: deviations.filter(d => { const k = `${d.port}|${d.field}`; if (seen.has(k)) return false; seen.add(k); return true; }), checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = conformance();
  for (const d of r.deviations) console.log(`${d.port} ${d.field} [${d.kind}]: program ${JSON.stringify(d.program)?.slice(0, 120)} | spec ${JSON.stringify(d.spec)?.slice(0, 120)}`);
  console.log(`${r.deviations.length} deviations over ${r.checked} ports`);
}
