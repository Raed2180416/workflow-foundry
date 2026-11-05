// What the demo's scripted agent builds (app/demo/front-door.mjs): four free-form workflows for requests none of the seven examples could
// do, and two that Foundry must refuse. Hand-written here the way a coding agent would write them with the construction guide
// (skills/foundry-construct/SKILL.md and the app's capability catalogue); no model wrote them and none is a card. Each comes with the
// person's words and its practice cases. Development material for the front door, not evaluation evidence.
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
// A task is retried once unless it acts on the outside world (an unsafe retry is a validator error).
const task = (id, description, tool, args, needs = [], maxAttempts = 2) => ({ id, kind: 'task', needs, description, tool, args, timeoutMs: 10000, retry: { maxAttempts } });
const audit = (id, description, tool, args, needs) => ({ id, kind: 'verify', needs, description, method: 'capability', tool, args, subject: ref(`nodes.${needs[0]}`), independence: 'execution', gate: true, timeoutMs: 10000 });
const code = (id, description, source, args, needs = []) => ({ id, kind: 'code', needs, description, lang: 'js', source, args });

// ------------------------------------------------------------------------------------------------ 1. two-sheet reconciliation
const RECOUNT = `export default function main({ subject }) {
  const key = r => String(r.txn ?? '').trim().toLowerCase();
  const bank = new Map(subject.bank.map(r => [key(r), r])), ledger = new Map(subject.ledger.map(r => [key(r), r]));
  let missing = 0, extra = 0, changed = 0, matched = 0;
  for (const [k, r] of bank) { const o = ledger.get(k); if (!o) missing++; else { matched++; if (Number(o.amount) !== Number(r.amount)) changed++; } }
  for (const k of ledger.keys()) if (!bank.has(k)) extra++;
  const c = subject.counts;
  const pass = c.missing === missing && c.extra === extra && c.changed === changed && c.matched === matched;
  return { pass, score: pass ? 1 : 0, reasons: [\`Recount: \${missing} only in the bank, \${extra} only in the ledger, \${changed} amount(s) differ, \${matched} matched; \${pass ? 'agrees with' : 'differs from'} the comparison\`] };
}`;
export const reconciliation = {
  name: 'Two-sheet reconciliation with an independent recount',
  request: 'Every month, compare my bank sheet with the ledger sheet by transaction id and amount, and e-mail the differences to finance@acme.example. Double-check the differences before anything is sent.',
  whyNotACard: 'No example compares two sheets and recounts the result a second way.',
  workflow: {
    schemaVersion: '1.0', id: 'bank-ledger-reconciliation', version: 1,
    title: 'Reconcile the bank sheet with the ledger',
    goal: 'Compare the bank sheet with the ledger sheet by transaction id and amount, recount the differences a second, independent way, and e-mail them to finance@acme.example once the person says yes.',
    domain: 'finance',
    envelope: {
      assumptions: ['The bank and ledger sheets have one row per transaction: txn (its id) and amount'],
      risks: ['A difference missed or counted twice', 'The report going to anyone but finance@acme.example'],
      successCriteria: ['An independent recount of the differences agrees with the comparison', 'Exactly one report went to finance@acme.example, intact'],
      unsupported: ['Fixing the ledger', 'Matching transactions that have no shared id']
    },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    budget: { maxSteps: 60, maxConcurrency: 2, maxDurationMs: 600000, maxCost: 0 },
    nodes: [
      task('bank', 'Read the bank sheet', 'sheet.read', { sheet: 'bank' }),
      task('ledger', 'Read the ledger sheet', 'sheet.read', { sheet: 'ledger' }),
      task('compare', 'Compare bank and ledger rows by transaction id and amount', 'rows.reconcile', { left: ref('nodes.bank.rows'), right: ref('nodes.ledger.rows'), key: 'txn', compare: ['amount'] }, ['bank', 'ledger']),
      { id: 'recount', kind: 'verify', needs: ['compare'], description: 'Recount the differences a second, independent way (code) and compare with the comparison', method: 'code', lang: 'js', source: RECOUNT,
        subject: { bank: ref('nodes.bank.rows'), ledger: ref('nodes.ledger.rows'), counts: ref('nodes.compare.counts') }, independence: 'execution', gate: true },
      task('missingLines', 'List the bank rows the ledger lacks', 'rows.lines', { rows: ref('nodes.compare.missing'), line: '- in the bank, not in the ledger: {{txn}} ({{amount}})', empty: '- none in the bank alone' }, ['recount']),
      task('extraLines', 'List the ledger rows the bank lacks', 'rows.lines', { rows: ref('nodes.compare.extra'), line: '- in the ledger, not in the bank: {{txn}} ({{amount}})', empty: '- none in the ledger alone' }, ['recount']),
      task('changedLines', 'List the amounts that differ', 'rows.lines', { rows: ref('nodes.compare.changed'), line: '- {{key}}: bank {{left}}, ledger {{right}}', empty: '- no amount differs' }, ['recount']),
      task('report', 'Write the report', 'core.template', { text: 'Bank vs ledger\n\nMatched transactions: {{matched}}\n\n{{missing}}\n{{extra}}\n{{changed}}\n',
        variables: { matched: ref('nodes.compare.matched'), missing: ref('nodes.missingLines.text'), extra: ref('nodes.extraLines.text'), changed: ref('nodes.changedLines.text') } }, ['missingLines', 'extraLines', 'changedLines']),
      task('send', 'E-mail the differences to finance@acme.example (asks you first)', 'outbox.send', { to: 'finance@acme.example', subject: 'Bank vs ledger: the differences', body: ref('nodes.report.text') }, ['report'], 1),
      audit('audit', 'Re-read the outbox: exactly one report went to finance@acme.example, intact', 'outbox.audit', { to: ['finance@acme.example'] }, ['send'])
    ],
    acceptance: [eq(ref('nodes.recount.pass'), true), eq(ref('nodes.audit.pass'), true)]
  },
  practiceInput: [{ name: 'a month with every kind of difference', input: {},
    sheets: { bank: [{ txn: 'T-1', amount: 120 }, { txn: 'T-2', amount: 75 }, { txn: 'T-3', amount: 300 }, { txn: 'T-4', amount: 18 }],
      ledger: [{ txn: 'T-1', amount: 120 }, { txn: 'T-2', amount: 70 }, { txn: 'T-3', amount: 300 }, { txn: 'T-9', amount: 44 }] } }],
  // The person's own data for the live run in the demo.
  liveSheets: { bank: [{ txn: 'B-100', amount: 1200 }, { txn: 'B-101', amount: 85 }, { txn: 'B-102', amount: 40 }],
    ledger: [{ txn: 'B-100', amount: 1200 }, { txn: 'B-101', amount: 58 }, { txn: 'B-103', amount: 12 }] }
};

// ------------------------------------------------------------------------------------------------ 2. fan-out with a coverage ledger
const IDS = `export default function main({ rows }) { return { ids: rows.map(r => String(r.id)), count: rows.length }; }`;
const CHECK_ONE = `export default function main({ supplier, now }) {
  const days = Math.floor((Date.parse(supplier.expires + 'T00:00:00Z') - Date.parse(now)) / 86400000);
  return { read: [String(supplier.id)], id: String(supplier.id), name: supplier.name, expires: supplier.expires, daysLeft: days, expiring: Number.isFinite(days) && days <= 30 };
}`;
const PICK = `export default function main({ checked }) {
  const rows = checked.items.map(i => i.check).filter(c => c.expiring);
  return { rows, count: rows.length };
}`;
export const fanOut = {
  name: 'Fan-out over every supplier with a coverage ledger',
  request: 'Check every supplier in my suppliers sheet for a certificate that expires within 30 days, and post the ones that do to the #procurement channel. Make sure no supplier is skipped.',
  whyNotACard: 'No example checks every row one by one and proves that each one was checked.',
  workflow: {
    schemaVersion: '1.0', id: 'supplier-certificates', version: 1,
    title: 'Supplier certificates expiring within 30 days',
    goal: 'Check every supplier\'s certificate expiry, prove with a coverage ledger that each supplier was checked exactly once, and post the ones expiring within 30 days to #procurement once the person says yes.',
    domain: 'operations',
    envelope: {
      assumptions: ['The suppliers sheet has one row per supplier: id, name, expires (YYYY-MM-DD)', 'input.now is the moment of the run'],
      risks: ['A supplier skipped or checked twice', 'A post to the wrong channel'],
      successCriteria: ['The coverage ledger shows every supplier checked exactly once', 'Exactly one post went to #procurement, intact'],
      unsupported: ['Renewing certificates', 'Suppliers without an expiry date']
    },
    inputSchema: { type: 'object', additionalProperties: false, required: ['now'], properties: { now: { type: 'string', minLength: 10, maxLength: 40 } } },
    budget: { maxSteps: 2000, maxConcurrency: 4, maxDurationMs: 600000, maxCost: 0 },
    nodes: [
      task('read', 'Read the suppliers sheet', 'sheet.read', { sheet: 'suppliers' }),
      code('inventory', 'List every supplier id (the inventory the ledger checks against)', IDS, { rows: ref('nodes.read.rows') }, ['read']),
      { id: 'checked', kind: 'map', needs: ['inventory'], description: 'Check each supplier\'s certificate, one at a time', items: ref('nodes.read.rows'), maxItems: 1000, concurrency: 4,
        body: { nodes: [code('check', 'Work out how many days this supplier\'s certificate has left', CHECK_ONE, { supplier: ref('item'), now: ref('input.now') })],
          acceptance: [{ op: 'exists', value: ref('nodes.check.daysLeft') }] } },
      { id: 'coverage', kind: 'verify', needs: ['checked'], description: 'Coverage ledger: every supplier in the sheet was checked exactly once', method: 'ledger', subject: ref('nodes.checked'),
        ledger: { inventory: ref('nodes.inventory.ids'), reads: 'check.read', maxReads: 1, allowEmpty: true }, independence: 'execution', gate: true },
      code('expiring', 'Keep the suppliers whose certificate expires within 30 days', PICK, { checked: ref('nodes.checked') }, ['coverage']),
      task('lines', 'One line per expiring certificate', 'rows.lines', { rows: ref('nodes.expiring.rows'), line: '- {{name}} ({{id}}): expires {{expires}}, {{daysLeft}} day(s) left', empty: '- none this time' }, ['expiring']),
      task('compose', 'Write the post', 'core.template', { text: 'Supplier certificates expiring within 30 days ({{count}}):\n{{lines}}', variables: { count: ref('nodes.expiring.count'), lines: ref('nodes.lines.text') } }, ['lines']),
      task('post', 'Post the list to #procurement (asks you first)', 'chat.post', { channel: '#procurement', text: ref('nodes.compose.text') }, ['compose'], 1),
      audit('postAudit', 'Re-read #procurement: exactly one post from this run, intact', 'chat.audit', { channel: '#procurement', posts: 1 }, ['post'])
    ],
    acceptance: [eq(ref('nodes.coverage.pass'), true), eq(ref('nodes.postAudit.pass'), true)]
  },
  practiceInput: [{ name: 'five suppliers, two expiring', input: { now: '2026-01-05T09:00:00Z' },
    sheets: { suppliers: [{ id: 'S1', name: 'Practice Steel', expires: '2026-01-20' }, { id: 'S2', name: 'Practice Paper', expires: '2026-06-01' },
      { id: 'S3', name: 'Practice Glass', expires: '2026-02-01' }, { id: 'S4', name: 'Practice Wood', expires: '2027-01-01' }, { id: 'S5', name: 'Practice Ink', expires: '2026-03-30' }] } }]
};

// ------------------------------------------------------------------------------------------------ 3. multi-step approval chain
const DECIDE = `export default function main({ request, lead, finance }) {
  const approved = lead?.answer?.approve === true && finance?.answer?.approve === true;
  const by = lead?.answer?.approve !== true ? 'the team lead' : finance?.answer?.approve !== true ? 'finance' : null;
  return { id: String(request.id), item: request.item, amount: request.amount, decision: approved ? 'approved' : 'declined', declinedBy: by ?? '' };
}`;
const EXPECT = `export default function main({ count }) { return { to: count > 0 ? ['purchasing@acme.example'] : [] }; }`;
export const approvalChain = {
  name: 'Multi-step approval chain',
  request: 'For each submitted purchase request over 5000 in my requests sheet, ask the team lead first and then finance to approve it, and e-mail the decisions to purchasing@acme.example.',
  whyNotACard: 'The expense example decides by a limit; none asks two people in turn for each request.',
  workflow: {
    schemaVersion: '1.0', id: 'purchase-approval-chain', version: 1,
    title: 'Two-step approval of large purchase requests',
    goal: 'For each submitted purchase request over 5000, ask the team lead and then finance to approve it, and e-mail the decisions to purchasing@acme.example once the person says yes.',
    domain: 'finance',
    envelope: {
      assumptions: ['The requests sheet has one row per request: id, item, amount, status', 'In this preview every question goes to the person at this computer; separate approvers are not enforced'],
      risks: ['A request decided without both approvals', 'Decisions e-mailed to the wrong address'],
      successCriteria: ['Every large submitted request got a decision', 'The decisions went to purchasing@acme.example only, intact'],
      unsupported: ['Paying the supplier', 'Enforcing that the lead and finance are different people']
    },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    budget: { maxSteps: 400, maxConcurrency: 1, maxDurationMs: 86400000, maxCost: 0 },
    nodes: [
      task('read', 'Read the requests sheet', 'sheet.read', { sheet: 'requests' }),
      task('large', 'Keep the submitted requests over 5000', 'rows.filter', { rows: ref('nodes.read.rows'), where: [{ field: 'status', op: 'eq', value: 'submitted' }, { field: 'amount', op: 'gt', value: 5000 }] }, ['read']),
      { id: 'chain', kind: 'map', needs: ['large'], description: 'For each large request: the team lead, then finance', items: ref('nodes.large.rows'), maxItems: 20, concurrency: 1,
        body: { nodes: [
          { id: 'lead', kind: 'human', needs: [], description: 'The team lead approves or declines', question: 'Team lead: approve this purchase request?',
            answerSchema: { type: 'object', additionalProperties: false, required: ['approve'], properties: { approve: { type: 'boolean' }, note: { type: 'string', maxLength: 500 } } } },
          { id: 'finance', kind: 'human', needs: ['lead'], description: 'Finance approves or declines (only after the lead approved)', question: 'Finance: approve this purchase request?', when: eq(ref('nodes.lead.answer.approve'), true),
            answerSchema: { type: 'object', additionalProperties: false, required: ['approve'], properties: { approve: { type: 'boolean' }, note: { type: 'string', maxLength: 500 } } } },
          { ...code('decide', 'Record the decision for this request', DECIDE, { request: ref('item'), lead: ref('nodes.lead'), finance: { $ref: 'nodes.finance', default: null } }, ['lead', 'finance']), join: 'all_resolved' }],
          acceptance: [{ op: 'exists', value: ref('nodes.decide.decision') }] } },
      task('decisions', 'Collect the decisions', 'core.pluck', { items: ref('nodes.chain.items'), field: 'decide' }, ['chain']),
      task('lines', 'One line per decision', 'rows.lines', { rows: ref('nodes.decisions.items'), line: '- {{id}} {{item}} ({{amount}}): {{decision}} {{declinedBy}}', empty: '- no large request this time' }, ['decisions']),
      task('compose', 'Write the decisions e-mail', 'core.template', { text: 'Purchase requests over 5000\n\n{{lines}}\n', variables: { lines: ref('nodes.lines.text') } }, ['lines']),
      task('send', 'E-mail the decisions to purchasing@acme.example (asks you first)', 'outbox.send', { to: 'purchasing@acme.example', subject: 'Purchase request decisions', body: ref('nodes.compose.text') }, ['compose'], 1),
      code('expected', 'The one recipient the e-mail must have reached', EXPECT, { count: 1 }, ['send']),
      audit('audit', 'Re-read the outbox: the decisions went to purchasing@acme.example only, intact', 'outbox.audit', { to: ref('nodes.expected.to') }, ['send', 'expected'])
    ],
    acceptance: [eq(ref('nodes.chain.count'), ref('nodes.large.count')), eq(ref('nodes.audit.pass'), true)]
  },
  practiceInput: [
    { name: 'both approve', input: {}, answers: { lead: { approve: true }, finance: { approve: true } },
      sheets: { requests: [{ id: 'R1', item: 'Practice laptops', amount: 9000, status: 'submitted' }, { id: 'R2', item: 'Practice pens', amount: 40, status: 'submitted' }, { id: 'R3', item: 'Practice desks', amount: 7000, status: 'draft' }] } },
    { name: 'the lead declines', input: {}, answers: { lead: { approve: false, note: 'not this quarter' } },
      sheets: { requests: [{ id: 'R4', item: 'Practice servers', amount: 25000, status: 'submitted' }] } }]
};

// ------------------------------------------------------------------------------------------------ 4. incident escalation with a timer
const DUE = `export default function main({ now, minutes }) { return { at: new Date(Date.parse(now) + minutes * 60000).toISOString() }; }`;
const EXPECT_IM = `export default function main({ count }) { return { to: count > 0 ? ['im@acme.example'] : [] }; }`;
const OPEN_SEV1 = [{ field: 'severity', op: 'eq', value: 'sev1' }, { field: 'status', op: 'eq', value: 'open' }, { field: 'acknowledged', op: 'ne', value: true }];
export const escalation = {
  name: 'Incident escalation with a timer',
  request: 'When a sev1 incident is open in my incidents sheet, post it to the #oncall channel. If it is still not acknowledged 15 minutes later, e-mail the incident manager at im@acme.example.',
  whyNotACard: 'The on-call example posts a digest; none waits and then re-checks before escalating.',
  workflow: {
    schemaVersion: '1.0', id: 'sev1-escalation', version: 1,
    title: 'Escalate unacknowledged sev1 incidents after 15 minutes',
    goal: 'Post open, unacknowledged sev1 incidents to #oncall, wait 15 minutes, re-read the incidents sheet, and e-mail im@acme.example about any still unacknowledged, each send once the person says yes.',
    domain: 'operations',
    envelope: {
      assumptions: ['The incidents sheet has one row per incident: id, title, severity, status, acknowledged (true/false)', 'input.now is the moment of the run; the timer is 15 minutes after it'],
      risks: ['Escalating an incident someone already acknowledged', 'Paging the wrong channel or person'],
      successCriteria: ['Exactly one post went to #oncall, intact', 'The incident manager got an e-mail if and only if a sev1 was still unacknowledged after the wait'],
      unsupported: ['Phoning or texting anyone', 'Acknowledging incidents']
    },
    inputSchema: { type: 'object', additionalProperties: false, required: ['now'], properties: { now: { type: 'string', minLength: 10, maxLength: 40 } } },
    budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 3600000, maxCost: 0 },
    nodes: [
      task('read', 'Read the incidents sheet', 'sheet.read', { sheet: 'incidents' }),
      task('open', 'Keep the open, unacknowledged sev1 incidents', 'rows.filter', { rows: ref('nodes.read.rows'), where: OPEN_SEV1 }, ['read']),
      task('lines', 'One line per incident', 'rows.lines', { rows: ref('nodes.open.rows'), line: '- {{id}}: {{title}}', empty: '- no open sev1' }, ['open']),
      task('page', 'Write the #oncall post', 'core.template', { text: 'Open sev1 incidents ({{count}}):\n{{lines}}', variables: { count: ref('nodes.open.count'), lines: ref('nodes.lines.text') } }, ['lines']),
      task('post', 'Post the open sev1 incidents to #oncall (asks you first)', 'chat.post', { channel: '#oncall', text: ref('nodes.page.text') }, ['page'], 1),
      audit('postAudit', 'Re-read #oncall: exactly one post from this run, intact', 'chat.audit', { channel: '#oncall', posts: 1 }, ['post']),
      code('due', 'Work out when the 15 minutes are up', DUE, { now: ref('input.now'), minutes: 15 }),
      { id: 'hold', kind: 'wait', needs: ['postAudit', 'due'], description: 'Wait until 15 minutes after the post', at: ref('nodes.due.at') },
      task('recheck', 'Read the incidents sheet again', 'sheet.read', { sheet: 'incidents' }, ['hold']),
      task('still', 'Keep the sev1 incidents still open and unacknowledged', 'rows.filter', { rows: ref('nodes.recheck.rows'), where: OPEN_SEV1 }, ['recheck']),
      task('stillLines', 'One line per incident still unacknowledged', 'rows.lines', { rows: ref('nodes.still.rows'), line: '- {{id}}: {{title}}', empty: '- none' }, ['still']),
      task('escalation', 'Write the escalation e-mail', 'core.template', { text: 'Still unacknowledged after 15 minutes ({{count}}):\n{{lines}}', variables: { count: ref('nodes.still.count'), lines: ref('nodes.stillLines.text') } }, ['stillLines']),
      { ...task('escalate', 'E-mail the incident manager at im@acme.example (asks you first)', 'outbox.send', { to: 'im@acme.example', subject: 'Sev1 still unacknowledged', body: ref('nodes.escalation.text') }, ['escalation'], 1),
        when: { op: 'gt', left: ref('nodes.still.count'), right: 0 } },
      code('expected', 'Who must have been e-mailed: the incident manager if and only if something is still open', EXPECT_IM, { count: ref('nodes.still.count') }, ['still']),
      audit('mailAudit', 'Re-read the outbox: the escalation went to im@acme.example if and only if needed, intact', 'outbox.audit', { to: ref('nodes.expected.to') }, ['escalate', 'expected'])
    ],
    acceptance: [eq(ref('nodes.postAudit.pass'), true), eq(ref('nodes.mailAudit.pass'), true)]
  },
  // The practice clock is in the past, so the 15-minute timer is already due and practice exercises the escalation path.
  practiceInput: [{ name: 'one sev1 nobody acknowledged', input: { now: '2026-01-05T09:00:00Z' },
    sheets: { incidents: [{ id: 'INC-1', title: 'Practice: checkout is down', severity: 'sev1', status: 'open', acknowledged: false },
      { id: 'INC-2', title: 'Practice: slow search', severity: 'sev2', status: 'open', acknowledged: false },
      { id: 'INC-3', title: 'Practice: login errors', severity: 'sev1', status: 'open', acknowledged: true }] } }]
};

// ------------------------------------------------------------------------------------------------ two honest refusals
export const needsSms = {
  name: 'A capability Foundry lacks',
  request: 'Text the on-call engineer on +1 555 0100 by SMS whenever a sev1 incident opens in my incidents sheet.',
  workflow: {
    ...escalation.workflow, id: 'sev1-sms', title: 'Text the on-call engineer about sev1 incidents',
    goal: 'Text the on-call engineer about each open sev1 incident.',
    envelope: { ...escalation.workflow.envelope, successCriteria: ['The on-call engineer got one text per open sev1'] },
    nodes: [
      task('read', 'Read the incidents sheet', 'sheet.read', { sheet: 'incidents' }),
      task('open', 'Keep the open, unacknowledged sev1 incidents', 'rows.filter', { rows: ref('nodes.read.rows'), where: OPEN_SEV1 }, ['read']),
      task('text', 'Text the on-call engineer', 'sms.send', { to: '+1 555 0100', text: 'A sev1 incident is open' }, ['open'], 1),
      audit('textAudit', 'Check the text went out', 'sms.audit', { to: ['+1 555 0100'] }, ['text'])
    ],
    acceptance: [eq(ref('nodes.textAudit.pass'), true)]
  },
  practiceInput: [{ name: 'one open sev1', input: { now: '2026-01-05T09:00:00Z' }, sheets: { incidents: [{ id: 'INC-1', title: 'Practice: checkout is down', severity: 'sev1', status: 'open', acknowledged: false }] } }]
};
export const strangerTarget = {
  name: 'An outside-effect target the person never wrote',
  request: 'Every month, compare my bank sheet with the ledger sheet by transaction id and amount, and e-mail the differences to finance@acme.example.',
  // The agent "helpfully" copies the CFO, an address the person never gave.
  workflow: { ...JSON.parse(JSON.stringify(reconciliation.workflow).replaceAll('finance@acme.example', 'cfo@acme.example')), id: 'bank-ledger-for-the-cfo' },
  practiceInput: reconciliation.practiceInput
};

export const BUILDS = [reconciliation, fanOut, approvalChain, escalation];
export const REFUSALS = [needsSms, strangerTarget];
