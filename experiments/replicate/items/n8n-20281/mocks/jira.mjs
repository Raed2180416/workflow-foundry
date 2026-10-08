// Mock Jira Software Cloud: JQL search (a small, strict subset), create issue, add comment, get issue.
//   search       {jql, fields?, limit?}                 -> 200 {startAt, maxResults, total, issues:[{id,key,fields}]}   400 on JQL outside the subset
//   createIssue  {fields}                               -> 201 {id, key, self}                                          400 with Jira-style field errors
//   addComment   {issueKey, body}                       -> 201 {id, body, created}                                      404 unknown key, 400 empty body
//   getIssue     {key}                                  -> 200 issue | 404
// JQL subset: clauses joined by AND; fields labels (=, !=, in, not in), statusCategory / status / issuetype / project (=, !=), key (=, in); optional
// "ORDER BY created ASC|DESC". Anything else is a 400 "Error in the JQL Query" (the real service is far richer; this mock only accepts what the job needs).
// Faults (per scenario): lagSearches = a newly created issue is invisible to the next N searches (eventual consistency of the search index);
// createAckLost = indexes of createIssue calls that COMMIT but answer 504 (the client cannot tell).
import { ok, fail, isObj, lower, clone } from './common.mjs';
import { JIRA_PRIORITY } from '../spec.mjs';

const STATUS_CATEGORY = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' };
const FIELDS_ALLOWED = new Set(['project', 'issuetype', 'summary', 'description', 'labels', 'priority', 'assignee']);
const PRIORITIES = new Set([...Object.values(JIRA_PRIORITY), 'Lowest']);

export class Jira {
  constructor({ projectKey, issueTypes, seedTickets = [], nextNumber, faults = {} }) {
    this.opts = { projectKey, issueTypes, faults };
    this.state = { issues: [], nextNumber, nextId: 10100, searches: 0, creates: 0, events: [] };
    for (const t of seedTickets) this.#insert({ key: `${projectKey}-${t.n}`, number: t.n, fields: t.fields, comments: [], visibleAfterSearch: 0, created: t.fields.created });
  }
  #insert(i) { i.id = String(this.state.nextId++); this.state.issues.push(i); return i; }
  #view(i, want) {
    const f = {
      summary: i.fields.summary, status: i.fields.status, labels: [...i.fields.labels], issuetype: i.fields.issuetype, priority: i.fields.priority,
      project: i.fields.project, created: i.created, description: i.fields.description,
    };
    const out = want ? Object.fromEntries(Object.entries(f).filter(([k]) => want.has(k))) : f;
    return { id: i.id, key: i.key, fields: out };
  }

  search({ jql, fields, limit } = {}) {
    this.state.searches++;
    let q;
    try { q = parseJql(String(jql ?? '')); } catch (e) { return fail(400, 'JQL_ERROR', `Error in the JQL Query: ${e.message}`); }
    const n = this.state.searches;
    let hits = this.state.issues.filter(i => i.visibleAfterSearch < n && q.clauses.every(c => matches(i, c)));
    hits.sort((a, b) => (a.number - b.number) * (q.order?.dir === 'asc' ? 1 : -1));
    const max = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 50));
    const want = fields ? new Set((Array.isArray(fields) ? fields : String(fields).split(',')).map(s => s.trim())) : null;
    return ok(200, { startAt: 0, maxResults: max, total: hits.length, issues: hits.slice(0, max).map(i => this.#view(i, want)) });
  }

  createIssue({ fields } = {}) {
    const idx = this.state.creates++;
    if (!isObj(fields)) return fail(400, 'BAD_REQUEST', 'fields is required');
    const errors = {};
    for (const k of Object.keys(fields)) if (!FIELDS_ALLOWED.has(k)) errors[k] = `Field '${k}' cannot be set. It is not on the appropriate screen, or unknown.`;
    if (fields.project?.key !== this.opts.projectKey) errors.project = `project is required and must be ${this.opts.projectKey}`;
    if (!this.opts.issueTypes.includes(fields.issuetype?.name)) errors.issuetype = `issue type must be one of ${this.opts.issueTypes.join(', ')}`;
    if (typeof fields.summary !== 'string' || !fields.summary.trim() || fields.summary.length > 255) errors.summary = 'summary is required (1..255 characters)';
    if (fields.description !== undefined && (typeof fields.description !== 'string' || fields.description.length > 32767)) errors.description = 'description must be text of at most 32767 characters';
    if (fields.labels !== undefined && (!Array.isArray(fields.labels) || fields.labels.some(l => typeof l !== 'string' || !l || /\s/.test(l)))) errors.labels = 'labels must be a list of non-empty strings without spaces';
    if (fields.priority !== undefined && !PRIORITIES.has(fields.priority?.name)) errors.priority = `priority must be one of ${[...PRIORITIES].join(', ')}`;
    if (fields.assignee !== undefined && (typeof fields.assignee?.accountId !== 'string' || !fields.assignee.accountId)) errors.assignee = 'assignee needs an accountId';
    if (Object.keys(errors).length) return { status: 400, body: { errorMessages: [], errors } };
    const number = this.state.nextNumber++;
    const key = `${this.opts.projectKey}-${number}`;
    const lag = this.opts.faults.lagSearches ?? 0;
    this.#insert({
      key, number, comments: [], visibleAfterSearch: this.state.searches + lag, created: `2026-10-08T07:${String(number % 60).padStart(2, '0')}:00.000+0000`,
      fields: { ...clone(fields), labels: clone(fields.labels ?? []), status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } }, created: undefined },
    });
    this.state.events.push({ type: 'create', key, via: idx });
    if ((this.opts.faults.createAckLost ?? []).includes(idx)) return fail(504, 'GATEWAY_TIMEOUT', 'upstream request timeout');
    return ok(201, { id: this.state.issues.at(-1).id, key, self: `https://jira.mock.example/rest/api/2/issue/${this.state.issues.at(-1).id}` });
  }

  addComment({ issueKey, body } = {}) {
    const i = this.state.issues.find(x => x.key === issueKey);
    if (!i) return fail(404, 'NOT_FOUND', `Issue Does Not Exist: ${issueKey}`);
    if (typeof body !== 'string' || !body.trim()) return fail(400, 'BAD_REQUEST', 'Comment body can not be empty!');
    if (body.length > 32767) return fail(400, 'BAD_REQUEST', 'The entered text is too long');
    const c = { id: String(i.comments.length + 1), body, created: '2026-10-08T08:00:00.000+0000' };
    i.comments.push(c);
    this.state.events.push({ type: 'comment', key: i.key });
    return ok(201, clone(c));
  }

  getIssue({ key } = {}) {
    const i = this.state.issues.find(x => x.key === key);
    return i ? ok(200, { ...this.#view(i), comments: i.comments.length }) : fail(404, 'NOT_FOUND', `Issue Does Not Exist: ${key}`);
  }

  dump() {
    return this.state.issues.map(i => ({ key: i.key, number: i.number, fields: clone(i.fields), comments: clone(i.comments) }));
  }
}

// ---- JQL subset -------------------------------------------------------------------------------------------------------------------------
function splitAnd(s) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') q = !q;
    if (!q && /^\s+and\s+/i.test(s.slice(i)) && /\s/.test(ch)) { out.push(cur); const m = s.slice(i).match(/^\s+and\s+/i); i += m[0].length - 1; cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const unq = v => { v = v.trim(); if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1); if (/^[A-Za-z0-9_.\- ]+$/.test(v) && !/\s/.test(v)) return v; throw new Error(`unexpected value ${v}`); };
function parseJql(src) {
  let s = src.trim(); let order = null;
  const mo = s.match(/\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?\s*$/i);
  if (mo) { if (lower(mo[1]) !== 'created') throw new Error(`cannot order by ${mo[1]}`); order = { dir: lower(mo[2] || 'asc') }; s = s.slice(0, mo.index); }
  if (!s.trim()) throw new Error('empty query');
  const clauses = splitAnd(s).map(part => {
    const m = part.trim().match(/^(\w+)\s+(not\s+in|in|!=|=)\s*(.+)$/i) ?? part.trim().match(/^(\w+)\s*(!=|=)\s*(.+)$/);
    if (!m) throw new Error(`cannot parse clause "${part.trim()}"`);
    const field = lower(m[1]); const op = lower(m[2]).replace(/\s+/g, ' ');
    if (!['labels', 'statuscategory', 'status', 'issuetype', 'project', 'key', 'issuekey'].includes(field)) throw new Error(`field '${m[1]}' does not exist or you do not have permission to view it`);
    let values;
    if (op === 'in' || op === 'not in') { const inner = m[3].trim().match(/^\((.*)\)$/s); if (!inner) throw new Error('expected a list in parentheses'); values = splitList(inner[1]).map(unq); }
    else { if (!['=', '!='].includes(op)) throw new Error(`bad operator ${op}`); values = [unq(m[3])]; }
    return { field: field === 'issuekey' ? 'key' : field, op, values };
  });
  return { clauses, order };
}
function splitList(s) { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function matches(i, { field, op, values }) {
  const vals = values.map(lower);
  const has = x => vals.includes(lower(x));
  let r;
  switch (field) {
    case 'labels': r = i.fields.labels.some(has); break;
    case 'statuscategory': r = has(i.fields.status.statusCategory.name) || has(i.fields.status.statusCategory.key); break;
    case 'status': r = has(i.fields.status.name); break;
    case 'issuetype': r = has(i.fields.issuetype.name); break;
    case 'project': r = has(i.fields.project.key); break;
    case 'key': r = has(i.key); break;
    default: r = false;
  }
  return op.startsWith('not') || op === '!=' ? !r : r;
}
export { STATUS_CATEGORY };
