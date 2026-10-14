// Requirement tracker, the report (TRACKER-DESIGN.md §4): report.md next to the per-build ledger.json. 1. run health,
// one line per world; 2. the status table, one row per requirement, with counts and the sentences extraction may have
// missed; 3. failing instances, up to 3 per failing requirement, each with the property's `why` and a trace excerpt
// (the rows naming the subject from 10 min before the trigger to the end of what the instance refers to).
import { makeHelpers } from './trace.mjs';

const hhmm = iso => (typeof iso === 'string' ? iso.slice(11, 16) : '--:--');
const mmdd = iso => (typeof iso === 'string' ? iso.slice(5, 10) : '--');
const short = (v, n = 28) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const mid = (v, n = 30) => { const s = String(v); return s.length > n ? `${s.slice(0, 8)}…${s.slice(-(n - 9))}` : s; };   // keys: their tail says most
const scalars = (o, skip = [], max = 4) => Object.entries(o ?? {}).filter(([k, v]) => !skip.includes(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))).slice(0, max).map(([k, v]) => `${k}=${short(v, 24)}`).join(' ');
const errText = e => (e ? `${e.code ?? ''} ${e.reason ?? ''}`.trim() : '');

/** One excerpt line for an effect, an inbound message or a refused output. */
export function excerptLine(row) {
  const when = `${mmdd(row.at)} ${hhmm(row.at)}`;
  if (row.system !== undefined && row.op !== undefined) {
    const items = Array.isArray(row.args?.items) ? `[${row.args.items.slice(0, 4).map(i => `${short(i.sku ?? Object.values(i).find(v => typeof v === 'string') ?? '?', 14)}${i.key !== undefined ? ` k=${mid(i.key, 30)}` : ''}`).join(', ')}${row.args.items.length > 4 ? ', …' : ''}]` : '';
    const args = scalars(row.args, ['items', 'orderId']);
    const r = row.result;
    let res = '(no result)';
    if (r) {
      const bad = Array.isArray(r.items) ? r.items.filter(i => i.status !== 'ok').slice(0, 3).map(i => `#${i.index} ${i.status} ${errText(i.error)}`.trim()).join('; ') : '';
      res = `${r.status}${r.error ? ` ${errText(r.error)}` : ''}${bad ? ` (${bad})` : ''} @${hhmm(r.at)}${r.dropped ? ' dropped' : ''}`;
    }
    return `${when} ${row.id} ${row.system}.${row.op}${row.key ? ` k=${mid(row.key, 34)}` : ''} ${[items, args].filter(Boolean).join(' ')} -> ${res}${row.abandoned ? ' (abandoned)' : ''}`.replace(/\s+/g, ' ');
  }
  if (row.proposed !== undefined) {
    const p = row.proposed.slice(0, 3).map(e => `${e.system}.${e.op}`).join(', ');
    const d = Array.isArray(row.detail) ? row.detail[0] : row.detail;
    return `${when} ${row.id} REFUSED ${row.code}${p ? ` [${p}${row.proposed.length > 3 ? ', …' : ''}]` : ''}: ${short(d ?? '', 90)}`;
  }
  return `${when} ${row.id} ${row.type} ${scalars(row.payload, ['items', 'records', 'events'])}${row.dropped ? ` (dropped: ${row.dropped})` : ''}`.replace(/\s+/g, ' ').trim();
}

/** The excerpt for one failing instance: rows naming its subject (plus its refs) in [at - 10 min, last ref + 10 min]. */
export function excerptLines(trace, inst, { beforeMin = 10, afterMin = 10, defaultSpanMin = 180, max = 14 } = {}) {
  const h = makeHelpers(trace);
  const byId = new Map([...trace.inbound, ...trace.effects, ...trace.refused].map(r => [r.id, r]));
  const refs = (inst.refs ?? []).map(id => byId.get(id)).filter(Boolean);
  const anchor = inst.at ?? refs[0]?.at ?? null;
  if (!anchor) return refs.slice(0, max).map(excerptLine);
  const lo = h.ms(anchor) - beforeMin * 60_000;
  const lastRef = Math.max(...refs.map(r => h.ms(r.result?.at ?? r.at)), h.ms(anchor));
  const hi = lastRef > h.ms(anchor) ? lastRef + afterMin * 60_000 : h.ms(anchor) + defaultSpanMin * 60_000;
  const subject = inst.subject ?? refs.find(r => r.subject)?.subject ?? null;
  const pool = new Map();
  for (const r of subject ? h.of(subject) : []) pool.set(r.id, r);
  for (const r of trace.refused) if (subject && h.norm(r.subject) === h.norm(subject)) pool.set(r.id, r);
  for (const r of refs) pool.set(r.id, r);
  const rows = [...pool.values()].filter(r => { const m = h.ms(r.at); return m >= lo && m <= hi; }).sort((a, b) => h.ms(a.at) - h.ms(b.at));
  const lines = rows.slice(0, max).map(r => `${refs.includes(r) ? '*' : ' '} ${excerptLine(r)}`);
  if (rows.length > max) lines.push(`  (+${rows.length - max} more rows)`);
  return lines;
}

/** Run health for one world, from the host rows and the trace. */
export function healthOf({ world, difficulty, status, rows, trace }) {
  const ticks = rows.filter(r => r.type === 'call').length;
  const first = trace.refused[0];
  const reason = first ? (Array.isArray(first.detail) ? first.detail[0] : first.detail) ?? first.code : null;
  return { world, difficulty, status, ticks, effects: trace.effects.length, refused: trace.refused.length, firstRefusal: reason ? String(reason).slice(0, 200) : null };
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/** report.md for one build: renderReport({ ledger, health, worlds }) → markdown. */
export function renderReport({ ledger, health = [], worlds = [], title = null }) {
  const L = [];
  const b = ledger.build ?? {};
  L.push(`# Requirement tracker report${title ? `: ${title}` : ''}`, '');
  L.push(`Source: \`${ledger.source?.file ?? '?'}\` (sha256 ${String(ledger.source?.sha256 ?? '').slice(0, 12)}…). Build: \`${b.file ?? '?'}\` (sha256 ${String(b.sha256 ?? '').slice(0, 12)}…).`);
  L.push(`Extractor: ${ledger.extractor?.model ?? '?'} (${ledger.extractor?.prompt ?? '?'}). Practice worlds only; no property sees world truth or the bed oracle. A \`pass\` means "no counterexample in n instances", not proof.`, '');
  L.push('## 1. Run health', '');
  for (const hl of health) L.push(`- world ${hl.world} (d${hl.difficulty}): ${hl.status}; ${hl.ticks} ticks, ${hl.effects} effects emitted, ${hl.refused} refused tick outputs${hl.firstRefusal ? ` (first: "${hl.firstRefusal}")` : ''}`);
  L.push('', '## 2. Status', '');
  L.push(`| id | quote (first 80 chars) | kind | triggered ${worlds.join('/')} | status | flags |`, '|---|---|---|---|---|---|');
  const counts = {};
  for (const r of ledger.requirements) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    const trig = worlds.map(w => { const x = r.evidence?.worlds?.[w]; return x ? (x.error ? 'err' : x.triggered) : '-'; }).join('/');
    const flags = [...(r.evidence?.flags ?? []), ...(r.confirmed ? [] : ['unconfirmed'])];
    const why = r.evidence?.reason ? ` (${r.evidence.reason})` : '';
    L.push(`| ${r.id} | ${cell(r.quote.slice(0, 80))}${r.quote.length > 80 ? '…' : ''} | ${r.kind} | ${trig} | **${r.status}**${cell(why)} | ${flags.join(', ')} |`);
  }
  L.push('', `Counts: ${['fail', 'pass', 'untested', 'unclear'].map(s => `${s} ${counts[s] ?? 0}`).join(', ')} (of ${ledger.requirements.length}).`);
  if (ledger.uncovered?.length) {
    L.push('', `Possibly missed by extraction (normative sentences no entry quotes, ${ledger.uncovered.length}):`, '');
    for (const u of ledger.uncovered) L.push(`- line ${u.line}${u.lineEnd && u.lineEnd !== u.line ? `–${u.lineEnd}` : ''}: ${u.text.slice(0, 160)}${u.text.length > 160 ? '…' : ''}`);
  }
  if (ledger.dropped?.length) L.push('', `Dropped at extraction (quote not verbatim or kind unknown): ${ledger.dropped.length}.`);
  const failing = ledger.requirements.filter(r => r.status === 'fail');
  L.push('', '## 3. Failing instances', '');
  if (!failing.length) L.push('None.');
  for (const r of failing) {
    L.push(`### ${r.id} (${r.kind}): ${r.summary || r.quote}`, '', `> ${r.quote}`, '');
    for (const f of r.evidence?.failing ?? []) {
      L.push(`World ${f.world}, ${f.subject ?? '(no subject)'} at ${f.at ?? '?'}: ${f.why}`, '', '```', ...(f.excerpt ?? []), '```', '');
    }
  }
  return L.join('\n') + '\n';
}
