// What the person should know about one exact list before they say yes, per card, computed by code from the preview run, the live
// state copied into it and the person's own data (shown on the list card; never a guess):
//   invoice-chase     firm-first: an invoice Foundry never reminded would get the firmer reminder first (P2 walkthrough B4)
//   expense-approval  already-sent: claims the decisions list already shows as sent to the approver (P3 walkthrough B4)
//                     answered: claims whose approver answer the person recorded (approver-answers.json)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const readJson = (file, fallback) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } };
const rowsOf = output => Array.isArray(output?.rows) ? output.rows : [];

/** The approver answers the person recorded for one automation: { [claimId]: { answer, approver, at, by } }. */
export function approverAnswers(root, flowId) { return readJson(path.join(root, 'site', 'approver-answers.json'), {})[flowId] ?? {}; }

export function listNotes(template, { preview, root, flowId, slots = {} }) {
  const notes = [];
  const outputs = preview?.run?.outputs ?? {};
  if (template === 'invoice-chase') {
    const keys = new Set((preview.state ?? []).filter(e => e.slot === 'reminded').map(e => e.key));
    const firm = rowsOf(outputs.fresh).map(r => ({ key: r.key?.text ?? '', to: r.plan?.to ?? null, invoice: r.plan?.invoice ?? String(r.key?.text ?? '').split('|')[0] }))
      .map(r => ({ ...r, stage: r.key.split('|').slice(1).join('|') }))
      .filter(r => r.stage && r.stage !== 'reminder' && !keys.has(`${r.invoice}|reminder`));
    if (firm.length) notes.push({ kind: 'firm-first', count: firm.length, invoices: firm.map(({ invoice, to, stage }) => ({ invoice, to, stage })) });
  }
  if (template === 'expense-approval') {
    const decided = readJson(path.join(root, 'world', 'sheets', 'expense-decisions.json'), []);
    const sentBefore = new Map((Array.isArray(decided) ? decided : []).filter(r => r?.decision === 'waiting for approver').map(r => [String(r.id), r.at ?? null]));
    const waitingNow = rowsOf(outputs.waiting).map(r => String(r.id));
    const again = waitingNow.filter(id => sentBefore.has(id));
    if (again.length) notes.push({ kind: 'already-sent', count: again.length, ids: again, approver: slots.approver ?? null, at: again.map(id => sentBefore.get(id)).filter(Boolean).sort()[0] ?? null });
    const answers = approverAnswers(root, flowId);
    const answered = waitingNow.filter(id => answers[id]);
    if (answered.length) notes.push({ kind: 'answered', count: answered.length, ids: answered, answers: Object.fromEntries(answered.map(id => [id, answers[id].answer])) });
  }
  return notes;
}
