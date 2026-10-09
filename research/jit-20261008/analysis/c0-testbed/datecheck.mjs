// Row 3 Stage 1: the $0 data check for per-task date orders (re-derivation of dossier 6 N3).
// For a system S in {BRIGHTDESK, ATLAS, VENDEX}, every numeric birth date a/b/y in S with a, b <= 12 and a != b is read both
// ways. A reading counts as evidence for its order when it equals an unambiguous birth date on an anchor row that shares a name
// token. Anchors (as N3): VERITAS ISO, LEDGR d.m.y, KOBO y/m/d and era dates. Variant 'plus' also uses month-name dates in
// BRIGHTDESK / ATLAS / VENDEX as anchors. The check reads only task.inputs.export.
//   decide(): pred = argmax; margin = |DMY - MDY|; decided iff margin >= 1; the gate trusts a read only at margin >= 2.
import { parseExport } from './lib-parse.mjs';

export const SYSTEMS = ['BRIGHTDESK', 'ATLAS', 'VENDEX'];
const ANCHOR_SYS = new Set(['VERITAS', 'LEDGR', 'KOBO']);
const p2 = n => String(n).padStart(2, '0');

export function anchorsOf(rows, variant = 'n3') {
  return rows.filter(r => r.dob?.kind === 'iso' && (ANCHOR_SYS.has(r.sys) || (variant === 'plus' && r.dob.named))).map(r => ({ row: r.row, sys: r.sys, iso: r.dob.iso, tokens: new Set(r.tokens) }));
}

// Evidence items for system `sys` (optionally restricted to a row filter). Each item: {row, dmyIso, mdyIso, vote: 'DMY'|'MDY'|null}.
export function evidence(rows, sys, { variant = 'n3', rowFilter = null } = {}) {
  const anchors = anchorsOf(rows, variant);
  const items = [];
  for (const r of rows) {
    if (r.sys !== sys || r.dob?.kind !== 'num' || (rowFilter && !rowFilter(r))) continue;
    const { a, b, y } = r.dob;
    if (a > 12 || b > 12 || a === b) continue;
    const dmyIso = `${y}-${p2(b)}-${p2(a)}`, mdyIso = `${y}-${p2(a)}-${p2(b)}`;
    const toks = new Set(sys === 'VENDEX' ? (r.lineTokens ?? r.tokens) : r.tokens);
    const near = anchors.filter(an => an.row !== r.row && [...an.tokens].some(t => toks.has(t)));
    const hitD = near.some(an => an.iso === dmyIso), hitM = near.some(an => an.iso === mdyIso);
    items.push({ row: r.row, dmyIso, mdyIso, vote: hitD && !hitM ? 'DMY' : hitM && !hitD ? 'MDY' : null });
  }
  return items;
}

export function decide(items) {
  const dmy = items.filter(i => i.vote === 'DMY').length, mdy = items.filter(i => i.vote === 'MDY').length;
  const margin = Math.abs(dmy - mdy);
  return { dmy, mdy, margin, pred: margin === 0 ? null : dmy > mdy ? 'DMY' : 'MDY', numeric: items.length };
}

export function checkTask(task, opts = {}) {
  const rows = parseExport(task.inputs.export);
  return Object.fromEntries(SYSTEMS.map(sys => [sys, decide(evidence(rows, sys, opts))]));
}
