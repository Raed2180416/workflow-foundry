// Oracle for the n8n:20281 job. It judges the EFFECTS an episode had on the mock services (replayed in a fresh environment), never how the solution is built.
//   per mail      what was committed in Jira / Slack / Teams / mail, and the audit-sheet row, must equal what the job's rules require for the
//                 classification the solution itself recorded in the audit row ("routing exact"): see CODES below
//   against labels  category / priority accuracy over the non-filtered mails, every deliberately ambiguous mail (and the mail whose model call always fails)
//                 must reach the review queue, and the clear customer requests must be escalated (a guard against "send everything to review")
//   T3 only       five fault-injection probes (same per-mail rules) and a cost target
// Pass (T1/T2): zero per-mail violations, ambiguousReview = 1, clearEscalation >= 0.85, category >= 0.85, priority >= 0.80, every mail answered.
// The oracle never trusts anything in `output` beyond the actions; the labels live in fixtures/labels.json (host side).
import { replay, createEnv } from './env.mjs';
import { filterReason, threadLabelOf, THRESHOLDS, CATEGORIES, TICKET_CATEGORIES, PRIORITIES, JIRA_PRIORITY, CATEGORY_KEY } from './spec.mjs';
import { fixtures } from './scenarios.mjs';

export const CODES = Object.freeze({
  NO_ANSWER: 'the run for this mail was never finished (no done) or hit a call cap',
  AUDIT_MISSING: 'no audit row with this message id', AUDIT_DUPLICATE: 'more than one audit row for this message id', AUDIT_INVALID: 'audit row fields outside the sheet conventions',
  FILTER_MODEL_CALL: 'a filtered sender (internal / automated) caused a model call', FILTER_EFFECT: 'a filtered sender caused a ticket, message or reply', FILTER_CLAIM: 'a filtered sender was recorded as a customer request',
  JIRA_CREATE_EXPECTED: 'a new ticket was required and none was committed', JIRA_CREATE_UNEXPECTED: 'a ticket was created where none (or a comment) was required',
  JIRA_CREATE_MULTIPLE: 'more than one ticket committed for one mail (duplicate)', JIRA_COMMENT_EXPECTED: 'a comment on the open ticket of the thread was required',
  JIRA_COMMENT_UNEXPECTED: 'a Jira comment where none was required', JIRA_COMMENT_WRONG_KEY: 'comment on a ticket other than the open ticket of the thread', JIRA_COMMENT_MULTIPLE: 'more than one comment for one mail',
  JIRA_COMMENT_CONTENT: 'the comment does not carry the mail', TICKET_FIELDS: 'new ticket violates project / issue type / priority / thread-label / summary / description rules',
  SLACK_COUNT: 'wrong number of Slack messages for this mail', SLACK_CHANNEL: 'Slack message in the wrong channel', SLACK_CONTENT: 'Slack message lacks the ticket key (escalation) or the sender (review)',
  SLACK_BROADCAST: 'channel-wide mention in a Slack message that is not a Critical new ticket', TEAMS_EXPECTED: 'Teams webhook configured but no card posted', TEAMS_UNEXPECTED: 'Teams card posted where none is required',
  TEAMS_CONTENT: 'Teams card lacks the ticket key', ACK_EXPECTED: 'acknowledgement required (new ticket, mode send or draft) but not made', ACK_UNEXPECTED: 'acknowledgement made where none is required',
  ACK_MODE: 'sent where a draft was required, or drafted where sending was required', ACK_CHANNEL: 'acknowledgement through the wrong mail service', ACK_RECIPIENT: 'acknowledgement goes to anyone but the sender',
  ACK_CONTENT: 'acknowledgement lacks the ticket reference', AUDIT_KEY_MISMATCH: 'audit row Jira Key / Follow-up disagree with what was done', AUDIT_ACK_MISMATCH: 'audit row Customer Ack disagrees with what was done',
  REDELIVERY_EFFECT: 'a redelivered mail caused effects again (ticket, comment, message, reply or audit row)',
});

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const lower = v => String(v ?? '').trim().toLowerCase();
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;

function ticketTypeName(category, cfg) { return { Bug: cfg.bugIssueType, Issue: cfg.issueIssueType, 'New Requirement': cfg.requirementIssueType }[category]; }
function channelFor(category, cfg) { return { Bug: cfg.bugSlackChannel, Issue: cfg.issueSlackChannel, 'New Requirement': cfg.requirementSlackChannel }[category]; }

export function claimOf(row) {
  if (!row) return null;
  const confidence = row.Confidence === '' ? NaN : Number(row.Confidence);
  return { cr: row['Customer Request'] === 'Yes', crValid: ['Yes', 'No'].includes(row['Customer Request']), category: row.Category, priority: row.Priority, confidence,
    valid: ['Yes', 'No'].includes(row['Customer Request']) && (CATEGORIES.includes(row.Category) || row.Category === 'Unclassified') && PRIORITIES.includes(row.Priority) && range(confidence, 0, 1) };
}
// The routing rule applied to the claim: the one place the job's decision rule lives.
export function routeOfClaim(c, cfg) {
  if (c.category === 'Unclassified') return 'review';
  if (c.cr && TICKET_CATEGORIES.includes(c.category) && c.confidence >= Number(cfg.minConfidence)) return 'escalate';
  if (c.cr && c.confidence < Number(cfg.minConfidence)) return 'review';
  return 'ignore';
}

// Diagnostic only: older quoted messages that ended up in a ticket or comment (an Outlook reply header or a Gmail "On ... wrote:" line).
const QUOTE_RE = /\bSent:\s[\s\S]{0,200}?\bSubject:|\bOn [^\n]{0,200} wrote:/;
const flat = (ev, type) => ev.calls.flatMap(c => c.effects ?? []).filter(e => e.type === type);

function judgeScenario(sr, seedTickets, cfg, labels) {
  const rowsById = new Map();
  for (const r of sr.dump.rows) { const k = r['Message ID']; (rowsById.get(k) ?? rowsById.set(k, []).get(k)).push(r); }
  const issues = new Map(sr.dump.jira.map(i => [i.key, i]));
  const open = new Map();                                              // thread id -> key of the open ticket
  for (const t of seedTickets) if (t.statusCategory !== 'done') open.set(t.threadId, `${cfg.jiraProjectKey}-${t.n}`);
  const seen = new Map();
  const perMail = [];
  const cost = { modelCalls: 0, inputTokens: 0, outputTokens: 0, modelUsd: 0, externalCalls: 0, latencyMs: 0, calls: 0 };

  for (const ev of sr.events) {
    const entry = sr.entries[ev.entryIndex];
    const delivery = seen.get(ev.entryIndex) ?? 0; seen.set(ev.entryIndex, delivery + 1);
    const v = [];                                                       // [code, detail]
    const add = (code, detail = '') => v.push([code, detail]);
    const rec = { caseId: entry.caseId, delivery, route: null, claim: null, escalated: false, review: false, key: null, followUp: false, violations: v };
    for (const c of ev.calls) {
      cost.calls++;
      if (c.name === 'model.complete') { cost.modelCalls++; cost.inputTokens += c.usage?.inputTokens ?? 0; cost.outputTokens += c.usage?.outputTokens ?? 0; cost.modelUsd += c.costUsd ?? 0; }
      else if (c.known && !c.name.startsWith('state.')) cost.externalCalls++;
      cost.latencyMs += c.latencyMs ?? 0;
    }
    if (ev.capped) add('NO_ANSWER', 'call cap');

    const creates = flat(ev, 'jira.create'), comments = flat(ev, 'jira.comment'), slack = flat(ev, 'slack'), teams = flat(ev, 'teams');
    const mail = ev.calls.flatMap(c => c.effects ?? []).filter(e => e.type === 'mail.send' || e.type === 'mail.draft');
    const rowsN = flat(ev, 'sheet.rows').reduce((n, e) => n + e.n, 0);
    const modelCalls = ev.calls.filter(c => c.name === 'model.complete').length;
    const jiraCommentCalls = ev.calls.filter(c => c.name === 'jira.addComment');
    perMail.push(rec);
    const reviewCh = String(cfg.reviewSlackChannel).replace('#', '');
    rec.quotedForwarded = ev.calls.some(c => (c.name === 'jira.addComment' || c.name === 'jira.createIssue') && QUOTE_RE.test(String(c.args?.body ?? c.args?.fields?.description ?? '')));
    rec.escalated = creates.length + comments.length > 0;                 // observed, whatever the audit row claims
    rec.followUp = comments.length > 0;
    rec.review = !rec.escalated && slack.some(x => x.channel === reviewCh);

    if (delivery > 0) {                                                 // a redelivery: everything was done the first time
      if (creates.length || comments.length || slack.length || teams.length || mail.length || rowsN) add('REDELIVERY_EFFECT', `creates ${creates.length}, comments ${comments.length}, slack ${slack.length}, teams ${teams.length}, mail ${mail.length}, rows ${rowsN}`);
      continue;
    }

    const rows = rowsById.get(entry.id) ?? [];
    const row = rows[0] ?? null;
    if (!row) add('AUDIT_MISSING'); else if (rows.length > 1) add('AUDIT_DUPLICATE', String(rows.length));
    const claim = claimOf(row);
    rec.claim = claim && { cr: claim.cr, category: claim.category, priority: claim.priority, confidence: claim.confidence, valid: claim.valid };
    const filtered = filterReason(entry.fromEmail, cfg);

    if (filtered) {
      rec.route = 'filtered';
      if (modelCalls) add('FILTER_MODEL_CALL', String(modelCalls));
      if (creates.length || comments.length || slack.length || teams.length || mail.length) add('FILTER_EFFECT', `creates ${creates.length}, comments ${comments.length}, slack ${slack.length}, teams ${teams.length}, mail ${mail.length}`);
      if (claim && claim.cr) add('FILTER_CLAIM');
      continue;
    }

    if (!claim) { rec.route = 'unknown'; continue; }
    if (!claim.valid) { add('AUDIT_INVALID', JSON.stringify(rec.claim)); rec.route = 'unknown'; continue; }
    const route = routeOfClaim(claim, cfg);
    rec.route = route;

    if (route === 'escalate') {
      const existing = open.get(entry.threadId) ?? null;
      let key = null;
      if (existing) {
        if (creates.length) add('JIRA_CREATE_UNEXPECTED', `${creates.length} created, ${existing} was open`);
        if (comments.length === 0) add('JIRA_COMMENT_EXPECTED', existing);
        else {
          if (comments.length > 1 || jiraCommentCalls.filter(c => c.status < 300).length > 1) add('JIRA_COMMENT_MULTIPLE', String(comments.length));
          if (comments.some(c => c.key !== existing)) add('JIRA_COMMENT_WRONG_KEY', `${comments.map(c => c.key).join(',')} vs ${existing}`);
          const body = jiraCommentCalls.find(c => c.args?.issueKey === existing)?.args?.body ?? jiraCommentCalls[0]?.args?.body ?? '';
          if (!(body.includes(entry.ref) || norm(body).includes(norm(entry.plain).slice(0, 30)))) add('JIRA_COMMENT_CONTENT');
        }
        key = comments.some(c => c.key === existing) ? existing : (comments[0]?.key ?? null);
      } else {
        if (comments.length) add('JIRA_COMMENT_UNEXPECTED', comments.map(c => c.key).join(','));
        if (creates.length === 0) add('JIRA_CREATE_EXPECTED');
        else {
          if (creates.length > 1) add('JIRA_CREATE_MULTIPLE', creates.map(c => c.key).join(','));
          key = creates[0].key;
          open.set(entry.threadId, key);
          const f = issues.get(key)?.fields;
          const want = { type: ticketTypeName(claim.category, cfg), priority: JIRA_PRIORITY[claim.priority], label: threadLabelOf(entry.threadId) };
          const problems = [];
          if (f?.project?.key !== cfg.jiraProjectKey) problems.push('project');
          if (f?.issuetype?.name !== want.type) problems.push(`issuetype ${f?.issuetype?.name} != ${want.type}`);
          if (cfg.setJiraPriority !== false && f?.priority?.name !== want.priority) problems.push(`priority ${f?.priority?.name} != ${want.priority}`);
          for (const l of ['customer-email', CATEGORY_KEY[claim.category], want.label]) if (!(f?.labels ?? []).includes(l)) problems.push(`label ${l}`);
          if (!String(f?.summary ?? '').trim()) problems.push('summary');
          if (!lower(f?.description).includes(lower(entry.fromEmail))) problems.push('description lacks the sender');
          if (problems.length) add('TICKET_FIELDS', problems.join('; '));
        }
      }
      rec.key = key;
      // Slack
      const wantCh = String(channelFor(claim.category, cfg)).replace('#', '');
      if (slack.length !== 1) add('SLACK_COUNT', `${slack.length} messages, 1 required`);
      else {
        if (slack[0].channel !== wantCh) add('SLACK_CHANNEL', `${slack[0].channel} vs ${wantCh}`);
        if (key && !slack[0].text.includes(key)) add('SLACK_CONTENT', 'no ticket key');
      }
      const critical = claim.priority === 'Critical' && !rec.followUp;
      if (slack.some(s => s.broadcasts.length) && !critical) add('SLACK_BROADCAST', slack.flatMap(s => s.broadcasts).join(' '));
      rec.criticalPing = critical ? slack.some(s => s.broadcasts.includes('<!channel>')) : null;
      // Teams
      if (cfg.teamsWebhookUrl) {
        if (teams.length === 0) add('TEAMS_EXPECTED'); else if (key && !teams.some(t => t.text.includes(key))) add('TEAMS_CONTENT');
      } else if (teams.length) add('TEAMS_UNEXPECTED');
      // acknowledgement: only for a newly opened ticket
      const mode = String(cfg.ackMode || 'off').toLowerCase();
      const ackWanted = ['send', 'draft'].includes(mode) && !rec.followUp && !!key;
      if (!ackWanted) { if (mail.length) add('ACK_UNEXPECTED', `${mail.length} mail effects`); }
      else if (mail.length === 0) add('ACK_EXPECTED');
      else {
        if (mail.length > 1) add('ACK_UNEXPECTED', `${mail.length} mail effects, 1 required`);
        const m = mail[0];
        if (m.provider !== entry.provider) add('ACK_CHANNEL', `${m.provider} vs ${entry.provider}`);
        if ((m.type === 'mail.draft') !== (mode === 'draft')) add('ACK_MODE', `${m.type} in mode ${mode}`);
        if (m.to.length !== 1 || m.to[0] !== lower(entry.fromEmail) || (m.cc ?? []).length) add('ACK_RECIPIENT', `to ${m.to.join(',')} cc ${(m.cc ?? []).join(',')}`);
        if (!m.text.includes(key)) add('ACK_CONTENT');
        if (m.type === 'mail.draft' && m.provider === 'gmail' && m.threadId !== entry.threadId) add('ACK_CHANNEL', 'draft not in the thread');
        rec.ack = m.type === 'mail.draft' ? 'draft' : 'send';
      }
      // audit consistency
      if (row) {
        if ((row['Jira Key'] ?? '') !== (key ?? '')) add('AUDIT_KEY_MISMATCH', `${row['Jira Key']} vs ${key}`);
        if ((row['Follow-up'] === 'Yes') !== rec.followUp) add('AUDIT_KEY_MISMATCH', 'Follow-up');
        const ack = lower(row['Customer Ack']);
        if (rec.ack && !ack.startsWith(rec.ack === 'draft' ? 'draft' : 'sent')) add('AUDIT_ACK_MISMATCH', row['Customer Ack']);
        if (!rec.ack && (ack.startsWith('sent') || ack.startsWith('draft'))) add('AUDIT_ACK_MISMATCH', row['Customer Ack']);
      }
    } else {
      if (creates.length || comments.length) add('JIRA_CREATE_UNEXPECTED', `${route}: ${creates.length} created, ${comments.length} commented`);
      if (teams.length) add('TEAMS_UNEXPECTED');
      if (mail.length) add('ACK_UNEXPECTED', `${route}: ${mail.length} mail effects`);
      if (route === 'review') {
        if (slack.length !== 1) add('SLACK_COUNT', `${slack.length} messages, 1 required`);
        else {
          if (slack[0].channel !== reviewCh) add('SLACK_CHANNEL', `${slack[0].channel} vs ${reviewCh}`);
          if (!lower(slack[0].text).includes(lower(entry.fromEmail))) add('SLACK_CONTENT', 'no sender');
        }
        if (slack.some(s => s.broadcasts.length)) add('SLACK_BROADCAST', slack.flatMap(s => s.broadcasts).join(' '));
      } else if (slack.length) add('SLACK_COUNT', `ignored mail but ${slack.length} Slack messages`);
      if (row && (row['Jira Key'] ?? '') !== '') add('AUDIT_KEY_MISMATCH', `${row['Jira Key']} on a mail without ticket`);
    }
  }
  // exactly one audit row per distinct mail of the scenario, none for unknown ids
  const known = new Set(sr.entries.map(e => e.id));
  const strays = [...rowsById.keys()].filter(k => !known.has(k));
  return { perMail, cost, strayRows: strays.length };
}

function validOutput(out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return 'output must be an object';
  if (!Array.isArray(out.actions)) return 'output.actions must be an array';
  if (out.actions.length > 20000) return 'too many actions';
  for (const a of out.actions) {
    if (!a || typeof a !== 'object' || typeof a.call !== 'string' || a.call.length > 64) return 'every action is {call: string, args?: object}';
    if (a.args !== undefined && (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))) return 'action.args must be an object';
  }
  return null;
}

export function oracle(task, output) {
  const bad = validOutput(output);
  if (bad) return { pass: false, score: 0, details: { schemaInvalid: bad } };
  const { env, unanswered } = replay(task, output.actions, { modelTape: output.modelTape ?? null });
  const cfg = env._config();
  const scenarios = env._scenarios();
  const records = env._records();
  const { labels } = fixtures();

  const perScenario = records.map((sr, i) => ({ id: sr.id, kind: sr.kind, ...judgeScenario(sr, scenarios[i].seeds ?? [], cfg, labels) }));
  const core = perScenario[0];
  const codeCount = {}; const first = [];
  const tally = (scenarioId, m) => { for (const [code, detail] of m.violations) { codeCount[code] = (codeCount[code] ?? 0) + 1; if (first.length < 14) first.push({ scenario: scenarioId, mail: m.caseId, code, detail }); } };
  for (const m of core.perMail) tally('core', m);

  // label-based gates (core scenario)
  const L = labels.scored;
  const nonFiltered = core.perMail.filter(m => !L[m.caseId].filtered);
  const hit = (m, f) => { const l = L[m.caseId]; return m.claim && f(l, m.claim) ? 1 : 0; };
  const catOk = nonFiltered.reduce((n, m) => n + hit(m, (l, c) => c.category === l.cat), 0);
  const priOk = nonFiltered.reduce((n, m) => n + hit(m, (l, c) => c.priority === l.pri), 0);
  const unamb = nonFiltered.filter(m => !L[m.caseId].amb);
  const catOkUn = unamb.reduce((n, m) => n + hit(m, (l, c) => c.category === l.cat), 0);
  const priOkUn = unamb.reduce((n, m) => n + hit(m, (l, c) => c.priority === l.pri), 0);
  const mustReview = core.perMail.filter(m => L[m.caseId].amb || L[m.caseId].fault === 'permanent');
  const clear = core.perMail.filter(m => ['ticket-new', 'ticket-followup'].includes(L[m.caseId].route) && !L[m.caseId].amb && L[m.caseId].fault !== 'permanent');
  const followUps = core.perMail.filter(m => L[m.caseId].route === 'ticket-followup');
  const ratio = (a, b) => (b ? a / b : 1);
  const acc = { category: ratio(catOk, nonFiltered.length), priority: ratio(priOk, nonFiltered.length), categoryUnambiguous: ratio(catOkUn, unamb.length), priorityUnambiguous: ratio(priOkUn, unamb.length), n: nonFiltered.length };
  const ambiguousReview = ratio(mustReview.filter(m => m.review && !m.escalated).length, mustReview.length);
  const clearEscalation = ratio(clear.filter(m => m.escalated).length, clear.length);
  const followUpsLanded = ratio(followUps.filter(m => m.escalated && m.followUp).length, followUps.length);
  const routingClean = ratio(core.perMail.filter(m => m.violations.length === 0).length, core.perMail.length);
  const coreViolations = core.perMail.reduce((n, m) => n + m.violations.length, 0);

  const gates = {
    routingExact: coreViolations === 0 && core.strayRows === 0, ambiguousReview: ambiguousReview === 1,
    clearEscalation: clearEscalation >= THRESHOLDS.clearEscalationRecall, categoryAccuracy: acc.category >= THRESHOLDS.categoryAccuracy, priorityAccuracy: acc.priority >= THRESHOLDS.priorityAccuracy,
  };
  const corePass = Object.values(gates).every(Boolean) && unanswered === 0;

  // fidelity (reported, not gating): behaviours of the original the description does not spell out
  const crit = core.perMail.filter(m => m.criticalPing !== undefined && m.criticalPing !== null);
  const fidelity = { criticalPing: crit.length ? crit.filter(m => m.criticalPing).length + '/' + crit.length : 'n/a', quotedHistoryInJira: core.perMail.filter(m => m.quotedForwarded).length };

  // probes (T3)
  const probes = perScenario.slice(1).map(s => {
    const codes = {};
    for (const m of s.perMail) { tally(s.id, m); for (const [c] of m.violations) codes[c] = (codes[c] ?? 0) + 1; }
    return { id: s.id, pass: s.perMail.every(m => m.violations.length === 0) && s.strayRows === 0, codes };
  });
  const probesPass = probes.every(p => p.pass);

  let target = null, costOk = true;
  if (task.variant === 'T3') {
    const t = task.budget?.target;
    if (t) {
      target = { ...t, modelUsd: core.cost.modelUsd, externalCalls: core.cost.externalCalls, latencyMs: core.cost.latencyMs };
      costOk = core.cost.modelUsd <= t.modelUsdMax && core.cost.externalCalls <= t.externalCallsMax && core.cost.latencyMs <= t.latencyMsMax;
    }
  }
  const pass = corePass && (task.variant !== 'T3' || (probesPass && costOk));
  const share = (x, hi) => Math.max(0, Math.min(1, x / hi));
  const gateScores = [routingClean, ambiguousReview, share(clearEscalation, THRESHOLDS.clearEscalationRecall), share(acc.category, THRESHOLDS.categoryAccuracy), share(acc.priority, THRESHOLDS.priorityAccuracy)];
  if (task.variant === 'T3') { gateScores.push(probes.length ? probes.filter(p => p.pass).length / probes.length : 1, costOk ? 1 : 0); }
  const score = pass ? 1 : Math.min(0.99, gateScores.reduce((a, b) => a + b, 0) / gateScores.length);

  return {
    pass, score: Number(score.toFixed(4)),
    details: {
      variant: task.variant, difficulty: task.difficulty, config: { ackMode: cfg.ackMode, teams: !!cfg.teamsWebhookUrl, minConfidence: cfg.minConfidence },
      gates, corePass, accuracy: acc, ambiguousReview, clearEscalation, followUpsLanded, routingCleanShare: routingClean, coreViolations, violationsByCode: codeCount, firstViolations: first,
      strayAuditRows: core.strayRows, unanswered, fidelity, probes: task.variant === 'T3' ? probes : undefined,
      cost: { model: { calls: core.cost.modelCalls, inputTokens: core.cost.inputTokens, outputTokens: core.cost.outputTokens, usd: Number(core.cost.modelUsd.toFixed(6)) },
        externalCalls: core.cost.externalCalls, latencyMs: core.cost.latencyMs, calls: core.cost.calls,
        all: probes.length ? { modelUsd: Number(perScenario.reduce((a, s) => a + s.cost.modelUsd, 0).toFixed(6)), externalCalls: perScenario.reduce((a, s) => a + s.cost.externalCalls, 0) } : undefined },
      target, costOk: task.variant === 'T3' ? costOk : undefined,
    },
  };
}

// Host-side helper for tests and controls: the judged per-mail rows of an episode.
export function judge(task, output) { const r = oracle(task, output); return r; }
export { createEnv };
