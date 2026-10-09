// Row 7 testbed: hand-made variants of the C0 solver. Each variant is a list of exact [find, replace] edits on the parent
// source; every `find` must occur exactly once (asserted), so the variants are reproducible from the committed parent.
// Mutants (positives) delete or widen a guard, check or decision threshold. Refactors (negatives) are meant to preserve
// behaviour: renames, reorders, extracted functions/constants. Written down before astdiff.mjs was run on any of them.
// Usage: node variants.mjs [OUTDIR]  -> OUTDIR/<id>/solve.mjs and OUTDIR/<id>.diff (default /var/tmp/foundry-work/c0-testbed/variants)
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(new URL('../../../..', import.meta.url).pathname);
export const PARENT = path.join(REPO, 'research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs');

export const VARIANTS = [
  // ---------------- mutants: guard deletions ----------------
  { id: 'M1-del-batch-count', kind: 'mutant', cls: 'deletion', what: 'extraction batch check no longer rejects a wrong record count',
    edits: [['    if (got.length !== want.size) return `count ${got.length} vs ${want.size}`;\n', '']] },
  { id: 'M2-del-batch-check-arg', kind: 'mutant', cls: 'deletion', what: 'extraction judge called without its check (checkBatch left defined but unused)',
    edits: [['    }, checkBatch(batch));', '    }, null);']] },
  { id: 'M3-del-void-provenance', kind: 'mutant', cls: 'deletion', what: 'void marker no longer has to occur in the row\'s own fields',
    edits: [['  const isVoid = !!marker && own.includes(marker.toLowerCase());', '  const isVoid = !!marker;']] },
  { id: 'M4-del-placeholder-date', kind: 'mutant', cls: 'deletion', what: 'placeholder birth dates (n/k, ?, 00/00/0000, TBD) no longer rejected',
    edits: [['  if (/n\\/k|unknown|^\\?+$|^-+$|^0+[\\/.]0+[\\/.]0+$|^—$|^n\\/a$|^TBD$/i.test(s)) return null;\n', '']] },
  { id: 'M5-del-date-override', kind: 'mutant', cls: 'deletion', what: 'the date-order data check in readConfig removed (model read always used)',
    edits: [['    if (ev.dmy > 0 && ev.mdy === 0) order = \'DMY\';\n    else if (ev.mdy > 0 && ev.dmy === 0) order = \'MDY\';\n', '']] },
  // ---------------- mutants: guard widenings ----------------
  { id: 'M6-widen-name-typos', kind: 'mutant', cls: 'widening', what: 'identity rule allows two typing errors instead of one (D1 class, opposite direction)',
    edits: [['  return partErr(nick(p.given), nick(q.given)) + partErr(p.family, q.family) <= 1;', '  return partErr(nick(p.given), nick(q.given)) + partErr(p.family, q.family) <= 2;']] },
  { id: 'M7-widen-year-range', kind: 'mutant', cls: 'widening', what: 'date validity range widened from 1800-2100 to 1000-2999',
    edits: [['  if (!(y >= 1800 && y <= 2100 && m >= 1', '  if (!(y >= 1000 && y <= 2999 && m >= 1']] },
  { id: 'M8-widen-batch-count-op', kind: 'mutant', cls: 'widening', what: 'batch check rejects only too many records (too few now pass)',
    edits: [['    if (got.length !== want.size) return', '    if (got.length > want.size) return']] },
  { id: 'M9-widen-sentinel', kind: 'mutant', cls: 'widening', what: 'the 1900-01-01 sentinel is accepted as a birth date',
    edits: [["const validIso = s => (s && /^\\d{4}-\\d{2}-\\d{2}$/.test(s) && s !== '1900-01-01' ? s : null);", 'const validIso = s => (s && /^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? s : null);'],
      ["    const r = validYmd(+m[1], +m[2], +m[3]); if (r === '1900-01-01') return null; if (r) return r;", '    const r = validYmd(+m[1], +m[2], +m[3]); if (r) return r;']] },
  { id: 'M10-widen-zero-phone', kind: 'mutant', cls: 'widening', what: 'all-zero national numbers are accepted as phones',
    edits: [['  if (!national || /^0+$/.test(national)) return null;', '  if (!national) return null;']] },
  { id: 'M11-widen-config-check', kind: 'mutant', cls: 'widening', what: 'config check accepts an empty systems list',
    edits: [["    val => (Array.isArray(val?.systems) && val.systems.length ? null : 'no systems'));", "    val => (Array.isArray(val?.systems) ? null : 'no systems'));"]] },
  { id: 'M12-widen-phone-link', kind: 'mutant', cls: 'widening', what: 'undated rows link on a shared phone alone (name check dropped)',
    edits: [['    else same = !!a.phone && a.phone === b.phone && namesMatch(a, b);', '    else same = !!a.phone && a.phone === b.phone;']] },
  // ---------------- refactors: behaviour-preserving ----------------
  { id: 'R1-rename-locals', kind: 'refactor', what: 'rename locals in assemble (valid->liveItems, uf->forest, members->group)',
    edits: [
      ['  const valid = items.filter(it => !it.isVoid);\n  const uf = unionFind(valid.length);\n  for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {\n    const a = valid[i], b = valid[j];',
        '  const liveItems = items.filter(it => !it.isVoid);\n  const forest = unionFind(liveItems.length);\n  for (let i = 0; i < liveItems.length; i++) for (let j = i + 1; j < liveItems.length; j++) {\n    const a = liveItems[i], b = liveItems[j];'],
      ['    if (same) uf.union(i, j);', '    if (same) forest.union(i, j);'],
      ['  valid.forEach((it, i) => { const r = uf.find(i);', '  liveItems.forEach((it, i) => { const r = forest.find(i);'],
      ['  for (const members of groups.values()) {', '  for (const group of groups.values()) {'],
      ['    members.sort((a, b) => {', '    group.sort((a, b) => {'],
      ['    const head = members[0];', '    const head = group[0];'],
      ['      for (const m of members) {', '      for (const m of group) {'],
      ['    const first = pick => members.find(pick);', '    const first = pick => group.find(pick);'],
      ['      entity_id: Math.min(...members.map(m => m.row)),\n      source_rows: members.map(m => m.row)', '      entity_id: Math.min(...group.map(m => m.row)),\n      source_rows: group.map(m => m.row)'],
    ] },
  { id: 'R2-rename-check-fn', kind: 'refactor', what: 'rename checkBatch -> batchProblem and its parameter val -> reply',
    edits: [['function checkBatch(batch) {\n  return val => {\n    const recs = val?.records;', 'function batchProblem(batch) {\n  return reply => {\n    const recs = reply?.records;'],
      ['    }, checkBatch(batch));', '    }, batchProblem(batch));']] },
  { id: 'R3-reorder-sections', kind: 'refactor', what: 'move the phone-normalisation section below the amounts section (hoisted function declarations)',
    edits: [], movePhone: true },
  { id: 'R4-reorder-fns', kind: 'refactor', what: 'swap the order of parseMagnitude/parseDec and of validYmd/year2 (function declarations)',
    edits: [], swaps: [['function parseMagnitude(raw) {', 'function parseDec(s) {', 'function toUsd(decStr, cur) {'], ['function validYmd(y, m, d) {', 'function year2(y) {', 'function parseDate(raw, order) {']] },
  { id: 'R5-extract-void', kind: 'refactor', what: 'extract the void-marker decision of buildItem into voidOf(line, rec)',
    edits: [['function buildItem(line, rec, cfgs) {\n  const { sys, row } = lineInfo(line);\n  const cfg = sysCfgFor(cfgs, sys);\n  const own = ownFields(line).toLowerCase();\n  const marker = rec.void_marker && rec.void_marker.trim();\n  const isVoid = !!marker && own.includes(marker.toLowerCase());\n  if (marker && !isVoid) log(\'void marker not in own fields, ignored\', { row, marker });\n',
      'function voidOf(line, rec, row) {\n  const own = ownFields(line).toLowerCase();\n  const marker = rec.void_marker && rec.void_marker.trim();\n  const isVoid = !!marker && own.includes(marker.toLowerCase());\n  if (marker && !isVoid) log(\'void marker not in own fields, ignored\', { row, marker });\n  return isVoid;\n}\n\nfunction buildItem(line, rec, cfgs) {\n  const { sys, row } = lineInfo(line);\n  const cfg = sysCfgFor(cfgs, sys);\n  const isVoid = voidOf(line, rec, row);\n']] },
  { id: 'R6-extract-placeholder', kind: 'refactor', what: 'extract the placeholder-date test into isPlaceholder(s)',
    edits: [['  if (/n\\/k|unknown|^\\?+$|^-+$|^0+[\\/.]0+[\\/.]0+$|^—$|^n\\/a$|^TBD$/i.test(s)) return null;', '  if (isPlaceholder(s)) return null;'],
      ['function year2(y) {', 'const isPlaceholder = text => /n\\/k|unknown|^\\?+$|^-+$|^0+[\\/.]0+[\\/.]0+$|^—$|^n\\/a$|^TBD$/i.test(text);\nfunction year2(y) {']] },
  { id: 'R7-extract-link', kind: 'refactor', what: 'extract the pair-linking rule of assemble into sameEntity(a, b)',
    edits: [['    let same = false;\n    if (a.birth && b.birth) same = a.birth === b.birth && namesMatch(a, b);\n    else same = !!a.phone && a.phone === b.phone && namesMatch(a, b);\n    if (same) uf.union(i, j);',
      '    if (sameEntity(a, b)) uf.union(i, j);'],
      ['function assemble(items) {', 'function sameEntity(a, b) {\n  if (a.birth && b.birth) return a.birth === b.birth && namesMatch(a, b);\n  return !!a.phone && a.phone === b.phone && namesMatch(a, b);\n}\n\nfunction assemble(items) {']] },
  { id: 'R8-arrow-fns', kind: 'refactor', what: 'turn validYmd and year2 into const arrow functions with renamed parameters (declared before first use)',
    edits: [['function validYmd(y, m, d) {\n  if (!(y >= 1800 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;\n  const dt = new Date(Date.UTC(y, m - 1, d));\n  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;\n  return `${String(y).padStart(4, \'0\')}-${String(m).padStart(2, \'0\')}-${String(d).padStart(2, \'0\')}`;\n}\nfunction year2(y) { return y < 100 ? (y >= 30 ? 1900 + y : 2000 + y) : y; }',
      'const validYmd = (yy, mm, dd) => {\n  if (!(yy >= 1800 && yy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;\n  const dt = new Date(Date.UTC(yy, mm - 1, dd));\n  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;\n  return `${String(yy).padStart(4, \'0\')}-${String(mm).padStart(2, \'0\')}-${String(dd).padStart(2, \'0\')}`;\n};\nconst year2 = yy => (yy < 100 ? (yy >= 30 ? 1900 + yy : 2000 + yy) : yy);']] },
  { id: 'R9-extract-const', kind: 'refactor', what: 'name the typo allowance: const MAX_NAME_EDITS = 1',
    edits: [['function namesMatch(p, q) {\n  return partErr(nick(p.given), nick(q.given)) + partErr(p.family, q.family) <= 1;', 'const MAX_NAME_EDITS = 1;\nfunction namesMatch(p, q) {\n  return partErr(nick(p.given), nick(q.given)) + partErr(p.family, q.family) <= MAX_NAME_EDITS;']] },
  { id: 'R10-reorder-checks', kind: 'refactor', what: 'check duplicate rows before unexpected rows in the batch check (same accept/reject set)',
    edits: [['    for (const r of got) if (!want.has(r)) return `unexpected row ${r}`;\n    if (new Set(got).size !== got.length) return \'duplicate rows\';',
      "    if (new Set(got).size !== got.length) return 'duplicate rows';\n    for (const r of got) if (!want.has(r)) return `unexpected row ${r}`;"]] },
];

const once = (src, find, id) => {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${id}: expected 1 match, found ${n} for ${JSON.stringify(find.slice(0, 80))}`);
};

export function applyVariant(src, v) {
  let out = src;
  if (v.movePhone) {
    const a = out.indexOf('// ---------- phone normalisation ----------\n'), b = out.indexOf('// ---------- amounts (exact decimal arithmetic) ----------');
    const block = out.slice(a + '// ---------- phone normalisation ----------\n'.length, b);
    out = out.slice(0, a) + out.slice(b);
    out = out.replace('// ---------- names ----------\n', `// ---------- phone normalisation ----------\n${block}// ---------- names ----------\n`);
    return out;
  }
  for (const [find, repl] of v.edits) { once(out, find, v.id); out = out.replace(find, () => repl); }
  for (const [startA, startB, end] of v.swaps ?? []) {
    const ia = out.indexOf(startA), ib = out.indexOf(startB), ie = out.indexOf(end);
    if (!(ia >= 0 && ia < ib && ib < ie)) throw new Error(`${v.id}: swap anchors out of order`);
    out = out.slice(0, ia) + out.slice(ib, ie) + out.slice(ia, ib) + out.slice(ie);
  }
  if (out === src) throw new Error(`${v.id}: no change`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const OUT = process.argv[2] ?? '/var/tmp/foundry-work/c0-testbed/variants';
  const src = readFileSync(PARENT, 'utf8');
  mkdirSync(OUT, { recursive: true });
  for (const v of VARIANTS) {
    const code = applyVariant(src, v);
    mkdirSync(path.join(OUT, v.id), { recursive: true });
    writeFileSync(path.join(OUT, v.id, 'solve.mjs'), code);
    let diff = '';
    try { execFileSync('diff', ['-u', PARENT, path.join(OUT, v.id, 'solve.mjs')]); } catch (e) { diff = String(e.stdout); }
    writeFileSync(path.join(OUT, `${v.id}.diff`), diff);
    // syntax check
    execFileSync('/opt/node24/bin/node', ['--check', path.join(OUT, v.id, 'solve.mjs')]);
    console.error(`${v.id}: ${diff.split('\n').filter(l => /^[+-][^+-]/.test(l)).length} changed lines`);
  }
}
