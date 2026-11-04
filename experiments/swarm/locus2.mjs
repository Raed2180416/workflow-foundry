// POST-HOC (not preregistered; written 2026-11-04 after the dev calibration, before any held-out trial): a stricter
// "did the evidence reach the model" test than rootcause.mjs seenDocs. The dev calibration showed both Haiku sessions read
// the corpus mostly through grep and Python scripts they wrote, whose output prints sentences or extracted fields without
// the "Document Dnnn" header or the Dnnn.txt path, so seenDocs undercounts what reached the model (and an `ls` of the
// corpus overcounts it). This module asks, per error unit, whether a tool result shown to the session contained:
//   header    the document's id (as seenDocs does);
//   sentence  a sentence of the needed document (30+ characters, whitespace-normalised) that names the compound;
//   coMention the document id and the compound (code or name) within 300 characters of each other.
// evidence = sentence || coMention. The frozen analysis (seen) is reported as preregistered; this is reported beside it.
import { truthOf } from './rootcause.mjs';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').toLowerCase();
/** Tool-result texts a session received ({ parent: null } the lead or single agent, 'any' every agent). */
export function toolResultTexts(events, { parent = null } = {}) {
  const out = [];
  for (const e of events) {
    if (e?.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    const p = e.parent_tool_use_id ?? null;
    if (parent !== 'any' && p !== parent) continue;
    for (const c of e.message.content) {
      if (c?.type !== 'tool_result') continue;
      out.push(norm(typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? c.content.map(x => x?.text ?? '').join('\n') : ''));
    }
  }
  return out;
}
/** Sentences of a document that name a compound (by code or name). */
export function evidenceSentences(task, docId, code) {
  const t = truthOf(task), e = t.entByCode.get(code);
  const text = task.files?.[`corpus/${docId}.txt`] ?? '';
  return text.split(/(?<=[.!?])\s+|\n/).map(norm).filter(s => s.length >= 30 && (s.includes(e.code.toLowerCase()) || s.includes(e.name.toLowerCase())));
}
export function evidenceSeen(task, texts, docId, code) {
  const t = truthOf(task), e = t.entByCode.get(code);
  const id = docId.toLowerCase(), names = [e.code.toLowerCase(), e.name.toLowerCase()];
  const header = texts.some(x => x.includes(`document ${id}`) || x.includes(`${id}.txt`));
  const sents = evidenceSentences(task, docId, code);
  const sentence = sents.some(s => texts.some(x => x.includes(s)));
  const coMention = texts.some(x => { let i = x.indexOf(id); while (i >= 0) { const w = x.slice(Math.max(0, i - 300), i + 300); if (names.some(n => w.includes(n))) return true; i = x.indexOf(id, i + 1); } return false; });
  return { header, sentence, coMention, evidence: sentence || coMention };
}
/** Per unit: the needed documents and whether their evidence reached the session. */
export function evidenceLocus(task, units, events, opts = {}) {
  const t = truthOf(task), texts = toolResultTexts(events, opts);
  return units.map(u => {
    let needed = [];
    if (u.unit === 'missing-compound') needed = (t.establishing.get(u.code) ?? []).map(id => [id, u.code]);
    else if ((u.unit === 'wrong-cell' || u.unit === 'missing-cell') && t.cells.get(`${u.code}|${u.property}`)) needed = [[t.cells.get(`${u.code}|${u.property}`).source, u.code]];
    else if (u.unit === 'missing-excluded' || u.unit === 'extra-excluded') {
      const d = t.byId.get(u.doc), mentions = d ? Object.keys(d.styles).map(eid => t.entById.get(eid).code).filter(c => t.inScope.has(c)) : [];
      needed = mentions.slice(0, 1).map(c => [u.doc, c]);
    }
    const seen = needed.map(([id, c]) => evidenceSeen(task, texts, id, c));
    return { unit: u.unit, code: u.code ?? null, property: u.property ?? null, doc: u.doc ?? null, needed: needed.map(x => x[0]),
      evidence: needed.length ? seen.some(s => s.evidence) : null, header: needed.length ? seen.some(s => s.header) : null };
  });
}
