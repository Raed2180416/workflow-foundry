// requirement-ledger-v3 (Δ* v1): pointer normalisation (ATTACK Move 5, $0 step, where it serves Move 1).
//
// Readers cite members by pointer, and they spell pointers many ways: wrapped in brackets or quotes, with "." for ":",
// with a worksheet's title for its id, with a plural collection name, as a bare id. The v1 merge compared pointer
// strings exactly, so a bracketed or differently spelled pointer never resolved and that reader's vote on the member was
// silently skipped. normalizePointer resolves a written pointer to ONE member of the code-enumerated universes, or to
// nothing (never to a guess): every stage requires a unique match.
// Generic by construction (PREREG-AB-v1 H7/H8). Pointers are untrusted text; nothing here executes them.
import { norm } from './lib.mjs';

export const POINTER_VERSION = 'rl3-pointers-v1';

const singular = s => String(s ?? '').toLowerCase().replace(/ies$/, 'y').replace(/(ses|xes)$/, s => s.slice(0, -2)).replace(/s$/, '');
const clean = raw => String(raw ?? '').trim().replace(/^[\s[(<"'`]+|[\s\])>"'`.,;]+$/g, '').trim();

/** Index the members of a universe list once: by pointer, alias, key, lower-case forms and bare ids. */
export function pointerIndex(universes) {
  const exact = new Map(), lower = new Map(), byId = new Map(), rows = [];
  const add = (map, k, hit) => { if (!k) return; const list = map.get(k) ?? []; if (!list.some(x => x.m === hit.m)) list.push(hit); map.set(k, list); };
  for (const u of universes) for (const m of u.members) {
    const hit = { u, m };
    for (const k of [m.ptr, m.alias, m.key]) { add(exact, k, hit); add(lower, String(k ?? '').toLowerCase(), hit); }
    add(byId, String(m.id ?? '').toLowerCase(), hit);
    if (m.alias) add(byId, String(m.alias.split(':').pop()).toLowerCase(), hit);
    if (u.app === 'google_sheets' && Number.isFinite(m.attrs?._row)) {
      const [ss, ws] = String(u.container ?? '').split('/');
      const [ssTitle, wsTitle] = String(u.title ?? '').split(' / ');
      rows.push({ hit, ss: ss?.toLowerCase(), ws: ws?.toLowerCase(), ssTitle: norm(ssTitle), wsTitle: norm(wsTitle), row: m.attrs._row });
    }
  }
  return { exact, lower, byId, rows, universes };
}

const unique = list => (list?.length === 1 ? list[0] : null);

/** Resolve a written pointer -> {u, m, how} | {u: null, m: null, how: 'unresolved'|'ambiguous'}. */
export function normalizePointer(raw, index) {
  const s = clean(raw);
  const miss = how => ({ u: null, m: null, how });
  if (!s) return miss('unresolved');
  let h = unique(index.exact.get(String(raw ?? '').trim()));
  if (h) return { ...h, how: 'exact' };
  h = unique(index.exact.get(s));
  if (h) return { ...h, how: 'unwrapped' };
  h = unique(index.lower.get(s.toLowerCase()));
  if (h) return { ...h, how: 'case' };
  // sheet rows: [google_sheets:row:]<ss>/<ws id or title>#<row> (also "row <n>" spelled out)
  const sm = /^(?:google_sheets[:.](?:rows?|values)[:./])?([^/#]+)\/([^#]+)#\s*(?:row\s*)?(\d+)$/i.exec(s) ?? /^(?:google_sheets[:.](?:rows?)[:./])?([^/#]+)\/([^#]+)\s+row\s+(\d+)$/i.exec(s);
  if (sm) {
    const ss = sm[1].trim().toLowerCase(), ws = sm[2].trim().toLowerCase(), row = Number(sm[3]);
    const hits = index.rows.filter(r => r.row === row && (r.ss === ss || r.ssTitle === norm(ss)) && (r.ws === ws || r.wsTitle === norm(ws) || r.ws === ws.replace(/\s+/g, '_')));
    if (hits.length === 1) return { ...hits[0].hit, how: 'sheet-row' };
    if (hits.length > 1) return miss('ambiguous');
  }
  const wsRow = /^([A-Za-z0-9_ -]+)#\s*(\d+)$/.exec(s);
  if (wsRow) {
    const ws = wsRow[1].trim().toLowerCase(), row = Number(wsRow[2]);
    const hits = index.rows.filter(r => r.row === row && (r.ws === ws || r.wsTitle === norm(ws)));
    if (hits.length === 1) return { ...hits[0].hit, how: 'worksheet-row' };
  }
  // app[.:]collection[:/]id
  const am = /^([a-z0-9_]+)[.:]([A-Za-z0-9_]+)[:/](.+)$/.exec(s);
  if (am) {
    const app = am[1].toLowerCase(), coll = singular(am[2]), id = am[3].trim().toLowerCase();
    const cands = (index.byId.get(id) ?? []).filter(x => x.u.app === app && (singular(x.u.kind) === coll || coll.startsWith(singular(x.u.kind)) || singular(x.u.kind).startsWith(coll)));
    if (cands.length === 1) return { ...cands[0], how: 'app-collection-id' };
    const any = (index.byId.get(id) ?? []).filter(x => x.u.app === app);
    if (any.length === 1) return { ...any[0], how: 'app-id' };
    if (cands.length > 1 || any.length > 1) return miss('ambiguous');
  }
  // a bare id (the last segment of anything else)
  const tail = s.split(/[:/]/).pop().trim().toLowerCase();
  const b = index.byId.get(tail) ?? [];
  if (b.length === 1) return { ...b[0], how: 'bare-id' };
  return miss(b.length > 1 ? 'ambiguous' : 'unresolved');
}
