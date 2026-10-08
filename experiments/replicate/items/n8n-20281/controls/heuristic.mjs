// Triviality attack (diagnostic, not a pass/fail control): the faithful plumbing with the model replaced by a keyword rule written in ~25 lines, no model call.
// The question it answers: how far can cue words alone get on the classification gates? If this reached the thresholds the "judgement" part of the job would be
// vacuous. It was written without tuning against the labels (one pass, then measured; see report.json "heuristic").
import { driveSync } from '../env.mjs';
import { configFor } from '../spec.mjs';
import { makeFaithful } from './reference.mjs';

const has = (t, words) => words.some(w => t.includes(w));
export function keywordClassify(p) {
  const t = `${p.subject} ${p.body}`.toLowerCase();
  const vendor = has(t, ['unsubscribe', 'webinar', 'open to a call', 'open to a 15', 'out of office', 'invoice 2', 'verify', 'thank', 'solved', 'fixed,', 'move thursday', 'recruit']);
  let category = 'Other';
  if (!vendor) {
    if (has(t, ['error', 'crash', 'fails', 'wrong', 'broken', 'stuck', 'duplicate', 'twice', 'missing', 'not work', 'does nothing', 'freez', '500', '502'])) category = 'Bug';
    else if (has(t, ['could you', 'would like', 'please add', 'feature', 'wish', 'support for', 'integration', 'do you plan', 'planned', 'allow', 'would help', 'bulk', 'can reports', 'can we', 'dark mode', 'idea'])) category = 'New Requirement';
    else if (has(t, ['cannot', "can't", 'login', 'password', 'how do', 'how to', 'where do', 'slow', 'address', 'access', 'locked', 'explain', 'question', 'sso'])) category = 'Issue';
  }
  let priority = 'Medium';
  if (has(t, ['production down', 'nobody', 'immediately', 'urgent', 'all 14', 'stuck'])) priority = 'Critical';
  else if (has(t, ['blocked', 'blocks', 'asap', 'every time', 'cannot reach', 'deadline', 'month-end', 'month end', 'since yesterday'])) priority = 'High';
  else if (has(t, ['cosmetic', 'nice to have', 'wish', 'just wondering', 'no rush', 'dark mode', 'not important', 'how do', 'quick question'])) priority = 'Low';
  const sure = category !== 'Other' && t.length > 150;
  return { isCustomerRequest: category !== 'Other', category, priority, confidence: sure ? 0.9 : 0.5 };
}
// The heuristic replaces classify() entirely, so it is built from the reference's parts here.
import { normalize, prepare, skipped, routeOf, escalate, acknowledge, review, auditRow } from './reference.mjs';
export function makeKeywordSolution(cfg) {
  return function handle(event, api) {
    const p = prepare(normalize(event), cfg);
    let c;
    if (p.skipAI) c = skipped(p);
    else {
      const k = keywordClassify(p);
      c = { ...p, ...k, productArea: '', title: p.subject.replace(/^((re|fwd?)\s*:\s*)+/i, '').slice(0, 100), summary: p.body.replace(/\s+/g, ' ').slice(0, 300), customerName: p.fromName, customerCompany: '', sentiment: 'Neutral', stepsToReproduce: '', reasoning: 'keyword rule', needsReview: false, classifiedBy: 'rules' };
    }
    const r = routeOf(c, cfg);
    if (r === 'escalate') c = acknowledge(escalate(c, api, cfg), api, cfg);
    else if (r === 'review') c = review(c, api, cfg);
    api.sheets.appendRow({ row: auditRow(c, event.at) });
  };
}
export const runKeywordSolution = task => driveSync(task, makeKeywordSolution(configFor(task.difficulty)));
