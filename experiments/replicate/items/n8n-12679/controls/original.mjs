// Executes the ORIGINAL n8n:12679 workflow graph against the mocks.
//
// What is real: the graph (nodes, connections, branch order by canvas position), every node parameter, every condition,
// every field mapping, every hard-coded constant, and every expression - all read at run time from the corpus file
// (n8n ToS: the definition is NOT redistributable, so it is never copied into git; it is pinned by sha256).
// What is a shim: the node implementations (switch, filter, webhook/trigger, KlickTipp, Zoho CRM, HTTP Request). They are
// authored from the node parameters, not from n8n's or the community package's source, so node-level behaviour that is
// not visible in the definition is an ASSUMPTION (README A1-A12). The workflow is therefore "the original graph on
// shim nodes": stronger than a hand transcription, weaker than a run on real n8n.
//
// Safety: expressions in the definition are untrusted text. They are never evaluated as JavaScript. Each one must be
// either a plain path ($json.a.b / $('Node').item.json.a.b) or on the reviewed allowlist below (matched by exact text);
// anything else throws UnreviewedExpression, and the test suite asserts the whole definition is covered.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { clone } from '../mocks/common.mjs';

export const ORIGINAL = Object.freeze({
  rawPath: '/opt/corpus/n8n/workflows/12679.json.gz',
  sha256: 'e007cdb5b21493078a941883f27eabe8a6f9c4bb19adb32cebcc096634ece9c1',
});
export const TRIGGER_NODE = Object.freeze({
  'zoho-form': 'Contact registered via Form in Zoho CRM',
  'zoho-created-or-updated': 'Contact created or updated in Zoho CRM',
  'zoho-deleted': 'Contact deleted in Zoho CRM',
  'kt-tagged': 'Contact Tagged in KlickTipp',
  'kt-deleted': 'Contact Deleted in KlickTipp',
});

export class NodeError extends Error { constructor(node, message) { super(`${node}: ${message}`); this.node = node; } }
export class UnreviewedExpression extends Error {}

export function originalAvailable(rawPath = ORIGINAL.rawPath) { return existsSync(rawPath); }
export function loadOriginal({ rawPath = ORIGINAL.rawPath, sha256 = ORIGINAL.sha256 } = {}) {
  const buf = readFileSync(rawPath);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha256) throw new Error(`corpus file ${rawPath} has sha256 ${got}, expected ${sha256}`);
  const doc = JSON.parse(gunzipSync(buf).toString('utf8'));
  return doc.workflow.workflow;       // the n8n workflow object: nodes, connections, settings
}

// ----------------------------------------------------------------------------------------------- rebinding
// The definition carries the author's account ids. They are discovered by node role and bound to the mock account.
const walk = (v, f) => {
  if (typeof v === 'string') return f(v);
  if (Array.isArray(v)) return v.map(x => walk(x, f));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, f)]));
  return v;
};
export function rebind(wf, cfg) {
  const out = clone(wf), by = new Map(out.nodes.map(n => [n.name, n]));
  const P = name => { const n = by.get(name); if (!n) throw new Error(`definition changed: node "${name}" missing`); return n.parameters; };
  const K = cfg.klicktipp, pairs = [];
  const soi = P('Create Contact with SOI'), doi = P('Create Contact with DOI');
  pairs.push([soi.listId, K.lists.soi.id], [doi.listId, K.lists.doi.id], [soi.tagId, K.tags.created.id], [doi.tagId, K.tags.createdViaForm.id]);
  pairs.push([P('Tag contact in KlickTipp').tagId[0], K.tags.segmentOnline.id], [P('Tag contact in KlickTipp1').tagId[0], K.tags.segmentAbc.id]);
  pairs.push([soi.fields.dataFields[0].fieldId, K.fields.zohoContactId]);
  const guard = P('Only process changes via UI users').conditions.conditions[0].rightValue;
  pairs.push([guard, cfg.apiUserName]);
  for (const [a, b] of pairs) if (!a || typeof a !== 'string') throw new Error('definition changed: an account id could not be discovered');
  // The segment tag NAMES in the definition must equal the mock account's, or the control would silently test something else.
  const bodies = ['Tag Contact in Zoho CRM', 'Tag Contact in Zoho CRM1'].map(n => P(n).jsonBody);
  for (const [i, seg] of cfg.segments.entries()) if (!bodies[i].includes(`"name": "${seg.zohoTag}"`)) throw new Error(`definition changed: segment ${seg.key} no longer tags "${seg.zohoTag}"`);
  const used = new Map(pairs.map(([a]) => [a, 0]));
  for (const n of out.nodes) {
    if (n.type.endsWith('stickyNote')) continue;
    n.parameters = walk(n.parameters, s => { let t = s; for (const [a, b] of pairs) if (t.includes(a)) { used.set(a, used.get(a) + 1); t = t.replaceAll(a, b); } return t; });
  }
  for (const [a, c] of used) if (!c) throw new Error('definition changed: an account id was not found in any parameter');
  out.__binding = { count: pairs.length, usage: [...used.values()] };
  return out;
}

// ----------------------------------------------------------------------------------------------- expressions
const flat = s => s.replace(/\s+/g, ' ').trim();
const tagHas = (j, name) => (j.Tag ?? []).some(t => (t?.name || '').toLowerCase() === name);
// Reviewed allowlist (exact text after whitespace folding). Each entry is a hand-written equivalent of one expression
// that occurs in the definition; it is not derived by evaluating the definition's text.
const SPECIAL = new Map([
  [flat(`($json.Tag ?? []).some(t => (t?.name || '').toLowerCase() === 'online store')`), c => tagHas(c.json, 'online store')],
  [flat(`($json.Tag ?? []).some(t => (t?.name || '').toLowerCase() === 'abc')`), c => tagHas(c.json, 'abc')],
  [flat(`new Date($json.fieldBirthday * 1000).toLocaleDateString('en-CA')`), c => localDate(c.json.fieldBirthday * 1000, c.tz)],
  [flat(`$('Contact Tagged in KlickTipp').item.json.status === "Subscribed" ? false : true`), c => !(c.node('Contact Tagged in KlickTipp').status === 'Subscribed')],
  [flat(`$('Get subscription status').item.json.status === "Subscribed" ? false : true`), c => !(c.node('Get subscription status').status === 'Subscribed')],
]);
// toLocaleDateString('en-CA') in the workflow's time zone (assumption A11: the process uses the workflow timezone).
function localDate(ms, tz) {
  if (!Number.isFinite(ms)) return 'Invalid Date';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
const PATH = /^\$json((?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/;
const NODE_PATH = /^\$\('([^']+)'\)\.item\.json((?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/;
const dig = (o, path) => path.slice(1).split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
export function classifyExpression(expr) {
  const e = flat(expr);
  if (SPECIAL.has(e)) return 'special';
  if (PATH.test(e)) return 'path';
  if (NODE_PATH.test(e)) return 'node-path';
  return null;
}
export function evalExpression(expr, ctx) {
  const e = flat(expr);
  if (SPECIAL.has(e)) return SPECIAL.get(e)(ctx);
  let m = PATH.exec(e);
  if (m) return dig(ctx.json, m[1]);
  m = NODE_PATH.exec(e);
  if (m) return dig(ctx.node(m[1]), m[2]);
  throw new UnreviewedExpression(`expression not on the reviewed allowlist: ${e.slice(0, 120)}`);
}
// A parameter value: a literal, a whole-string expression ={{ ... }} (typed result), or a template with embedded {{ ... }}.
export function evalParam(v, ctx) {
  if (typeof v !== 'string' || !v.startsWith('=')) return v;
  const body = v.slice(1);
  const whole = /^\s*\{\{([\s\S]+)\}\}\s*$/.exec(body);
  if (whole && !whole[1].includes('{{')) return evalExpression(whole[1], ctx);
  return body.replace(/\{\{([\s\S]+?)\}\}/g, (_, x) => { const r = evalExpression(x, ctx); return r === undefined || r === null ? '' : String(r); });
}
export function expressionsOf(wf) {
  const found = [];
  for (const n of wf.nodes) {
    if (n.type.endsWith('stickyNote')) continue;
    walk(n.parameters, s => { if (s.startsWith('=')) { const body = s.slice(1); const w = /^\s*\{\{([\s\S]+)\}\}\s*$/.exec(body); if (w && !w[1].includes('{{')) found.push({ node: n.name, expr: w[1] }); else for (const m of body.matchAll(/\{\{([\s\S]+?)\}\}/g)) found.push({ node: n.name, expr: m[1] }); } return s; });
  }
  return found;
}

// ----------------------------------------------------------------------------------------------- node shims
const cond = (c, ctx) => {
  const v = evalParam(c.leftValue, ctx), r = evalParam(c.rightValue, ctx), { type, operation } = c.operator;
  const key = `${type}.${operation}`;
  switch (key) {
    case 'string.exists': return v !== undefined && v !== null;
    case 'string.notEmpty': return v !== undefined && v !== null && v !== '';
    case 'string.empty': return v === undefined || v === null || v === '';
    case 'string.notEquals': return String(v) !== String(r);
    case 'boolean.true': return v === true;
    case 'array.contains': return Array.isArray(v) && v.includes(r);
    default: throw new NodeError('condition', `unsupported operator ${key}`);
  }
};
const holds = (block, ctx) => { const results = block.conditions.map(c => cond(c, ctx)); return (block.combinator ?? 'and') === 'or' ? results.some(Boolean) : results.every(Boolean); };

function ktFields(dataFields, ctx) {
  const out = {};
  for (const f of dataFields ?? []) { const v = evalParam(f.fieldValue, ctx); out[f.fieldId] = v === undefined || v === null ? '' : v; }
  return out;
}
function zohoFields(p, ctx) {
  const out = {}, src = p.additionalFields ?? p.updateFields ?? {};
  if (p.lastName !== undefined) out.Last_Name = evalParam(p.lastName, ctx);
  for (const [k, raw] of Object.entries(src)) {
    if (k === 'customFields') { for (const cf of raw.customFields ?? []) out[cf.fieldId] = evalParam(cf.value, ctx); continue; }
    if (k === 'Mailing_Address') { for (const [ak, av] of Object.entries(raw.address_fields ?? {})) out[ak] = evalParam(av, ctx); continue; }
    const v = evalParam(raw, ctx);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
function check(name, r) {
  if (r.status >= 300) throw new NodeError(name, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}

export function makeOriginalHandler(wf, cfg, { zohoGetShape = 'alias' } = {}) {
  const by = new Map(wf.nodes.map(n => [n.name, n]));
  for (const [trigger, name] of Object.entries(TRIGGER_NODE)) if (!by.has(name)) throw new Error(`definition changed: trigger node ${name} missing (${trigger})`);
  const tz = wf.settings?.timezone ?? 'UTC';
  const pos = name => by.get(name).position;
  const order = targets => [...targets].sort((a, b) => pos(a.node)[1] - pos(b.node)[1] || pos(a.node)[0] - pos(b.node)[0]);   // execution order v1: top to bottom, then left to right

  function runNode(node, items, st, api) {
    const p = node.parameters, t = node.type.replace('n8n-nodes-base.', '').replace('n8n-nodes-klicktipp.', 'kt:');
    const ctxOf = item => ({ json: item.json, tz, node: name => { const d = st.data[name]; if (!d || !d.length) throw new NodeError(node.name, `no data from node ${name}`); return d[0].json; } });
    const each = f => items.map(item => ({ json: f(item, ctxOf(item)) }));
    switch (t) {
      case 'webhook': case 'kt:klicktippTrigger': return [items];
      case 'filter': return [items.filter(item => holds(p.conditions, ctxOf(item)))];
      case 'switch': {
        const rules = p.rules.values, all = !!p.options?.allMatchingOutputs, outs = rules.map(() => []);
        for (const item of items) {
          for (let i = 0; i < rules.length; i++) { if (holds(rules[i].conditions, ctxOf(item))) { outs[i].push(item); if (!all) break; } }
        }
        return outs;
      }
      case 'kt:klicktipp': {
        const k = `${p.resource}.${p.operation ?? ''}`;
        return [each((item, c) => {
          const id = () => String(evalParam(p.subscriberId, c));
          switch (k) {
            case 'subscriber.subscribe': return check(node.name, api.klicktipp.subscribe({ email: evalParam(p.email, c), listId: evalParam(p.listId, c), tagId: evalParam(p.tagId, c), fields: ktFields(p.fields?.dataFields, c) }));
            case 'subscriber.update': return check(node.name, api.klicktipp.updateSubscriber({
              ...(p.identifierType === 'id' ? { id: id() } : { lookupEmail: evalParam(p.lookupEmail, c) }), ...(p.email !== undefined ? { email: evalParam(p.email, c) } : {}), fields: ktFields(p.fields?.dataFields, c) }));
            case 'subscriber.get': return check(node.name, api.klicktipp.getSubscriber(p.identifierType === 'id' ? { id: id() } : { email: evalParam(p.lookupEmail, c) }));
            case 'subscriber.delete': return check(node.name, api.klicktipp.deleteSubscriber({ id: id() }));
            case 'contact-tagging.': return check(node.name, api.klicktipp.tag({ email: evalParam(p.email, c), tagIds: p.tagId }));
            default: throw new NodeError(node.name, `unsupported KlickTipp operation ${k}`);
          }
        })];
      }
      case 'zohoCrm': {
        if (p.resource !== 'contact') throw new NodeError(node.name, `unsupported Zoho resource ${p.resource}`);
        return [items.flatMap(item => {
          const c = ctxOf(item);
          switch (p.operation ?? 'create') {          // n8n omits parameters that hold their default; the Zoho node's default operation is create (A5)
            case 'create': { const b = check(node.name, api.zoho.createContact({ fields: zohoFields(p, c) })); return [{ json: { ...b.data[0].details } }]; }
            case 'update': { const b = check(node.name, api.zoho.updateContact({ id: String(evalParam(p.contactId, c)), fields: zohoFields(p, c) })); return [{ json: { ...b.data[0].details } }]; }
            case 'get': {
              const b = check(node.name, api.zoho.getContact({ id: String(evalParam(p.contactId, c)) }));
              return b.data.map(r => ({ json: zohoGetShape === 'alias' ? { ...r, email: r.Email } : { ...r } }));
            }
            case 'delete': { const b = check(node.name, api.zoho.deleteContact({ id: String(evalParam(p.contactId, c)) })); return [{ json: { ...b.data[0].details } }]; }
            default: throw new NodeError(node.name, `unsupported Zoho operation ${p.operation}`);
          }
        })];
      }
      case 'httpRequest': {
        const u = new URL(p.url);
        if (u.hostname !== 'www.zohoapis.eu') throw new NodeError(node.name, `refusing to call ${u.hostname}: only the Zoho mock is reachable`);
        return [each((item, c) => {
          const body = JSON.parse(evalParam(p.jsonBody, c));
          if (p.method === 'PUT' && u.pathname === '/crm/v3/Contacts') return check(node.name, api.zoho.bulkUpdate({ records: body.data }));
          if (p.method === 'POST' && u.pathname === '/crm/v3/Contacts/actions/add_tags') return check(node.name, api.zoho.addTags({ ids: body.ids, tags: body.tags }));
          throw new NodeError(node.name, `unsupported request ${p.method} ${u.pathname}`);
        })];
      }
      default: throw new NodeError(node.name, `unsupported node type ${node.type}`);
    }
  }

  const runs = [];
  function handler(event, api) {
    const start = TRIGGER_NODE[event.trigger];
    if (!start) throw new Error(`no entry node for trigger ${event.trigger}`);
    const st = { data: {}, executed: [] };
    const out = { trigger: event.trigger, executed: st.executed, error: null };
    const visit = (name, items) => {
      const outs = runNode(by.get(name), items, st, api);
      st.data[name] = outs.flat(); st.executed.push(name);
      (wf.connections[name]?.main ?? []).forEach((targets, i) => { const o = outs[i] ?? []; if (o.length) for (const t of order(targets)) visit(t.node, o); });
    };
    try { visit(start, [{ json: clone(event.data) }]); }
    catch (e) { if (e instanceof NodeError) out.error = e.message; else throw e; }   // an n8n node error ends the whole execution
    runs.push(out);
  }
  handler.runs = runs;
  return handler;
}

// ----------------------------------------------------------------------------------------------- broken variants of the ORIGINAL
// Each takes a rebound clone and breaks one thing the job depends on.
const retarget = (wf, from, to) => { for (const v of Object.values(wf.connections)) for (const outs of v.main ?? []) for (const t of outs) if (t.node === from) t.node = to; };
export const MUTANTS = {
  'no-ui-user-guard': {
    describe: 'both "only process changes via UI users" filters removed (the author warns this causes a loop)',
    apply(wf) { for (const g of ['Only process changes via UI users', 'Only process changes via UI users1']) retarget(wf, g, wf.connections[g].main[0][0].node); return wf; },
  },
  'single-and-double-opt-in-swapped': {
    describe: 'the SOI and DOI nodes exchange their list and tag ids',
    apply(wf) {
      const a = wf.nodes.find(n => n.name === 'Create Contact with SOI').parameters, b = wf.nodes.find(n => n.name === 'Create Contact with DOI').parameters;
      [a.listId, b.listId] = [b.listId, a.listId]; [a.tagId, b.tagId] = [b.tagId, a.tagId];
      return wf;
    },
  },
  'zoho-delete-not-propagated': { describe: 'Zoho deletions no longer reach KlickTipp', apply(wf) { wf.connections['Contact deleted in Zoho CRM'].main = [[]]; return wf; } },
  'klicktipp-delete-not-propagated': { describe: 'KlickTipp deletions no longer reach Zoho', apply(wf) { wf.connections['Contact Deleted in KlickTipp'].main = [[]]; return wf; } },
  'zoho-id-not-saved-in-klicktipp': {
    describe: 'after creating a Zoho contact from KlickTipp the Zoho id is not written back to the subscriber',
    apply(wf) { wf.connections['Set subscription status in Zoho'].main = [[]]; return wf; },
  },
};
