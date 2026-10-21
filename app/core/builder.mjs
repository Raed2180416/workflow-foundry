// The spike's builder: a STUB that matches a request to a frontier-written template and fills its slots by code. It calls no model
// (the brief is $0). It stands where the cheap constructor (Mercury 3 or Haiku 5.5 under the owner policy) would sit, behind the same
// return shape, so the MCP tools, the dashboard and the approval path can be exercised end to end. It is not model generation and is
// never reported as such: every proposal carries `builder: BUILDER_ID`.
//
// What it does ask: only the questions whose wrong default would send data to the wrong place or do something the person would refuse
// (INTENT layer 4, "not wanted": wrong-target first; research/intent-20261021/DESIGN.md §1). Everything else gets a visible default.
import { FoundryError } from '../../src/data.mjs';

export const BUILDER_ID = 'stub-template-matcher/1 (no model; stands in for the cheap constructor)';
const EMAIL = /[^@\s<>()"',;]+@[^@\s<>()"',;]+\.[A-Za-z]{2,}/;
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';

const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
// A task is retried once on failure unless it acts on the outside world (an unsafe retry is a validator error: UNSAFE_RETRY).
const task = (id, description, tool, args, needs = [], maxAttempts = 2) => ({ id, kind: 'task', needs, description, tool, args, timeoutMs: 10000, retry: { maxAttempts } });

/** The weekly report template, written once by a frontier author; the builder only fills `team`, `recipient` and the version. */
export function weeklyReportWorkflow({ team, recipient, version = 1, id }) {
  const reportText = 'Weekly report for {{team}} (week of {{weekOf}})\n\nFinished {{done}} of {{total}} items. Still open: {{open}}. Blocked: {{blocked}}.\n\nFinished this week:\n{{doneLines}}\n';
  return {
    schemaVersion: '1.0', id: id ?? `weekly-report-${slug(team)}`, version,
    title: `Weekly report for ${team}`,
    goal: `Every week, count what ${team} finished from the tracker export, write a short report, and send it to ${recipient} after you approve it.`,
    domain: 'general',
    envelope: {
      assumptions: ['You paste or export the tracker items (title, status, owner); the flow does not read your tracker by itself',
        'Delivery is a local outbox file standing in for e-mail; nothing leaves this machine'],
      risks: ['Sending the report to the wrong person', 'A report that silently drops items'],
      successCriteria: ['Every item you gave is counted', 'The report is saved', 'The report is delivered to the one recipient you named',
        'What was delivered is exactly the saved report (checked by re-reading the outbox)'],
      unsupported: ['Running on a schedule by itself (no scheduler in this spike)', 'Reading Jira, Linear or Asana directly (no connector)',
        'Sending to anyone other than the named recipient']
    },
    inputSchema: { type: 'object', additionalProperties: false, required: ['items', 'weekOf'],
      properties: { weekOf: { type: 'string', minLength: 1, maxLength: 40 },
        items: { type: 'array', maxItems: 500, items: { type: 'object', additionalProperties: false, required: ['title', 'status'],
          properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, status: { enum: ['done', 'open', 'blocked'] }, owner: { type: 'string', maxLength: 120 } } } } } },
    budget: { maxSteps: 20, maxConcurrency: 2, maxDurationMs: 60000, maxCost: 0 },
    nodes: [
      task('tally', 'Count finished, open and blocked items', 'report.tally', { items: ref('input.items') }),
      task('count', 'Count every item a second, independent way (used by a check)', 'core.aggregate', { operation: 'count', values: ref('input.items') }),
      task('compose', 'Write the report text', 'core.template', { text: reportText, variables: { team, weekOf: ref('input.weekOf'), done: ref('nodes.tally.done'),
        total: ref('nodes.tally.total'), open: ref('nodes.tally.open'), blocked: ref('nodes.tally.blocked'), doneLines: ref('nodes.tally.doneLines') } }, ['tally']),
      task('save', 'Save the report as weekly-report.md', 'core.artifact', { name: 'weekly-report.md', content: ref('nodes.compose.text') }, ['compose']),
      task('send', `Send the report to ${recipient} (asks you first)`, 'outbox.send', { to: recipient, subject: `Weekly report: ${team}`, body: ref('nodes.compose.text') }, ['save'], 1),
      { id: 'confirm', kind: 'verify', needs: ['send'], description: 'Re-read what was delivered and compare it with the saved report', method: 'capability',
        tool: 'outbox.check', args: { messageId: ref('nodes.send.messageId'), sha256: ref('nodes.save.sha256') }, subject: ref('nodes.send'), independence: 'execution', gate: true, timeoutMs: 10000 }
    ],
    acceptance: [eq(ref('nodes.tally.total'), ref('nodes.count.value')), { op: 'exists', value: ref('nodes.save.sha256') },
      eq(ref('nodes.send.delivered'), true), eq(ref('nodes.confirm.pass'), true)],
    metadata: { tags: ['template:weekly-report', 'builder:stub'], rationale: 'Frontier-written template; slots filled by the stub builder.' }
  };
}

export const SAMPLE_INPUT = Object.freeze({ weekOf: 'practice week', items: [
  { title: 'Practice: ship the login fix', status: 'done', owner: 'Sam' }, { title: 'Practice: write release notes', status: 'done', owner: 'Ana' },
  { title: 'Practice: migrate the billing table', status: 'open', owner: 'Lee' }, { title: 'Practice: vendor contract review', status: 'blocked' }] });

export const TEMPLATES = Object.freeze([{ id: 'weekly-report', title: 'Weekly progress report from a tracker export',
  matches: /\b(week|weekly|every (mon|tues|wednes|thurs|fri)day|status report|what (we|the team|my team) (got )?(done|finished)|progress report)\b/i }]);

/**
 * Turn a request (and answers to earlier questions) into one of:
 *   { status: 'unsupported', reply, supported }          nothing matches; no guessing
 *   { status: 'needs_answers', questions, understood }   a question whose wrong default would cause harm is open
 *   { status: 'ready', workflow, understood, willDo, willNotDo, sampleInput }
 */
export function buildFromIntent({ request, answers = {}, base = null }) {
  if (typeof request !== 'string' || !request.trim() || request.length > 30000) throw new FoundryError('REQUEST_TEXT', 'Describe what you want in 1-30000 characters');
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) throw new FoundryError('ANSWERS', 'answers is an object of question id to text');
  const template = base ? TEMPLATES[0] : TEMPLATES.find(t => t.matches.test(request));
  if (!template) return { status: 'unsupported', builder: BUILDER_ID,
    reply: 'I cannot build that yet. This preview only knows one kind of flow: a weekly progress report from a tracker export. Nothing was created.',
    supported: TEMPLATES.map(t => ({ id: t.id, title: t.title })) };
  const text = `${request}\n${Object.values(answers).filter(v => typeof v === 'string').join('\n')}`;
  const recipientAnswer = typeof answers.recipient === 'string' ? answers.recipient.trim() : '';
  const recipient = recipientAnswer.match(EMAIL)?.[0] ?? request.match(EMAIL)?.[0] ?? base?.recipient ?? null;
  const teamMatch = request.match(/\bfor (?:the |my |our )?([A-Za-z][A-Za-z0-9 &-]{1,40}?) team\b/i) ?? request.match(/\b([A-Z][A-Za-z0-9&-]{1,30}) team\b/);
  const team = (typeof answers.team === 'string' && answers.team.trim()) || teamMatch?.[1]?.trim() || base?.team || 'your team';
  const day = DAYS.find(d => new RegExp(`\\b${d}s?\\b`, 'i').test(text));
  const understood = {
    template: template.id, team, teamIsDefault: team === 'your team', recipient,
    schedule: day ? `every ${day[0].toUpperCase()}${day.slice(1)}` : /week/i.test(text) ? 'weekly' : 'when you run it',
    constraints: [...(/spam|only (to )?me\b|just me\b|nobody else|no one else/i.test(text) ? ['one recipient only'] : []),
      ...(/don'?t send|draft|review (it )?first|check (it )?first/i.test(text) ? ['you review before anything is sent'] : [])]
  };
  const questions = [];
  if (!recipient) questions.push({ id: 'recipient', question: 'Who should get the report? (one e-mail address)',
    why: 'This is the only choice that sends your data somewhere. I will not guess it.', answerSchema: { type: 'string', pattern: EMAIL.source } });
  if (recipientAnswer && !recipientAnswer.match(EMAIL)) questions.push({ id: 'recipient', question: `"${recipientAnswer.slice(0, 80)}" is not an e-mail address. Who should get the report?`,
    why: 'The report can only go to one e-mail address.', answerSchema: { type: 'string', pattern: EMAIL.source } });
  if (questions.length) return { status: 'needs_answers', builder: BUILDER_ID, template: template.id, questions: questions.slice(0, 3), understood };
  const workflow = weeklyReportWorkflow({ team, recipient, version: base ? base.version + 1 : 1, id: base?.id });
  return { status: 'ready', builder: BUILDER_ID, template: template.id, workflow, understood, sampleInput: SAMPLE_INPUT,
    willDo: [`Count the items in the export you give it and list the finished ones`, `Save the report on this machine`,
      `Send it to ${recipient} only, after you approve each send`, 'Check that what was sent is exactly what was saved'],
    willNotDo: ['Send to anyone else, or more than one message per run', 'Read your tracker, e-mail or files by itself',
      `Run by itself ${understood.schedule === 'when you run it' ? 'on a schedule' : understood.schedule}: there is no scheduler yet, so you (or your coding agent) start each run`,
      'Use a paid model: this flow has no model step at all'] };
}
