// AutomationBench tool client with the A1-C v2 pre-send lint (harness/v2/gate.mjs writes its configuration). It is copied
// over tool.mjs in the acting session's working directory when the lint is on, and it is byte-compatible with tool.mjs in
// usage, output and exit codes: without $AB_GATE_DIR, or with an absent or unreadable $AB_GATE_DIR/gate.json, it IS
// tool.mjs. With a configuration, an outgoing message (a POST, PUT or PATCH the configuration's routes name as a messaging
// operation) that carries a value a cited rule leaves out of the message for that recipient or channel is refused once,
// before it reaches the mailbox (no request file, so no world step), with a "HARNESS GATE" note on stderr and exit 1. At
// most one refusal per (rule, recipient) and two per session; an identical resend of a refused call is sent. Only the
// violating calls of a batch are refused; the others are sent, in order, in one step. A call that does not decode passes.
// Decisions are appended to .tools/gate-log.jsonl. Node built-ins only.
//
//   node tool.mjs list | call <tool_name> '<arguments JSON>'|@file|- | batch '<JSON array>'|@file|-
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOX = path.join(HERE, '.tools');
const WAIT_MS = Number(process.env.AUTOBENCH_TOOL_WAIT_MS ?? 180_000);
export const GATE_ENV = 'AB_GATE_DIR';
export const GATE_LOG = 'gate-log.jsonl';
const usage = () => { console.error("usage: node tool.mjs list | call <tool_name> '<arguments JSON>'|@file|- | batch '<JSON array>'|@file|-"); process.exit(2); };

function readArg(a) {
  if (a === undefined) return undefined;
  if (a === '-') return readFileSync(0, 'utf8');
  if (a.startsWith('@')) return readFileSync(path.resolve(a.slice(1)), 'utf8');
  return a;
}

function claim() {
  mkdirSync(BOX, { recursive: true });
  for (let tries = 0; tries < 10_000; tries++) {
    const used = readdirSync(BOX).map(f => /^req-(\d+)\.(?:json|claim)$/.exec(f)).filter(Boolean).map(m => Number(m[1]));
    const n = (used.length ? Math.max(...used) : 0) + 1;
    try { closeSync(openSync(path.join(BOX, `req-${n}.claim`), 'wx')); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('could not claim a request slot');
}

async function send(calls) {
  const n = claim();
  const tmp = path.join(BOX, `req-${n}.json.tmp`);
  writeFileSync(tmp, JSON.stringify({ v: 1, calls }));
  renameSync(tmp, path.join(BOX, `req-${n}.json`));
  const res = path.join(BOX, `res-${n}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_MS) {
    if (existsSync(res)) {
      try { return JSON.parse(readFileSync(res, 'utf8')); } catch { /* being written: retry */ }
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return { error: `the environment did not answer within ${Math.round(WAIT_MS / 1000)} s` };
}

// ---------------------------------------------------------------------------------------------------------------
// The lint (pure functions; the host imports them for tests and replays)

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const emailsIn = s => [...new Set((String(s ?? '').toLowerCase().match(EMAIL) ?? []))];
const normText = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Does `text` name `literal` (case-insensitive, any whitespace, whole words at its word-character ends)? */
export function names(text, literal) {
  const l = normText(literal).trim();
  if (!l) return false;
  const re = new RegExp(`${/^\w/.test(l) ? '(?<![\\w])' : ''}${esc(l).replace(/ /g, '\\s+')}${/\w$/.test(l) ? '(?![\\w])' : ''}`, 'i');
  return re.test(normText(text));
}

const qpDecode = s => Buffer.from(String(s).replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const decodeWords = s => String(s ?? '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, t) => (/^b$/i.test(enc) ? Buffer.from(t, 'base64').toString('utf8') : qpDecode(t.replace(/_/g, ' '))));
function parseHeaders(block) {
  const h = {};
  for (const line of String(block).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m) h[m[1].toLowerCase()] = (h[m[1].toLowerCase()] ? `${h[m[1].toLowerCase()]}, ` : '') + m[2]; }
  return h;
}
function decodePart(headers, body) {
  const cte = String(headers['content-transfer-encoding'] ?? '').toLowerCase().trim();
  if (cte === 'base64') return Buffer.from(String(body).replace(/\s+/g, ''), 'base64').toString('utf8');
  if (cte === 'quoted-printable') return qpDecode(body);
  return String(body);
}
function mimeText(headers, body, depth = 0) {
  const ct = String(headers['content-type'] ?? 'text/plain');
  const b = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (/^multipart\//i.test(ct) && b && depth < 4) {
    const parts = String(body).split(new RegExp(`--${esc(b)}(?:--)?\\s*`)).filter(p => p.trim());
    const texts = parts.map(p => { const k = p.search(/\r?\n\r?\n/); if (k < 0) return null; const ph = parseHeaders(p.slice(0, k)); return { ct: String(ph['content-type'] ?? 'text/plain'), text: mimeText(ph, p.slice(k).replace(/^\r?\n\r?\n/, ''), depth + 1) }; }).filter(Boolean);
    const plain = texts.filter(t => /text\/plain|multipart/i.test(t.ct));
    return (plain.length ? plain : texts).map(t => t.text).join('\n');
  }
  return decodePart(headers, body);
}
/** A Gmail `raw` message (base64url MIME) -> { to[], cc[], bcc[], subject, text } or null when it does not decode. */
export function decodeRaw(raw) {
  if (typeof raw !== 'string' || !raw.trim() || !/^[A-Za-z0-9_\-+/=\s]+$/.test(raw)) return null;
  let s;
  try { s = Buffer.from(raw.replace(/\s+/g, ''), 'base64url').toString('utf8'); } catch { return null; }
  const k = s.search(/\r?\n\r?\n/);
  if (k < 0 || s.includes('�')) return null;
  const h = parseHeaders(s.slice(0, k));
  if (!h.to && !h.subject && !h['content-type']) return null;
  const body = s.slice(k).replace(/^\r?\n\r?\n/, '');
  let text;
  try { text = mimeText(h, body); } catch { return null; }
  return { to: emailsIn(h.to), cc: emailsIn(h.cc), bcc: emailsIn(h.bcc), subject: decodeWords(h.subject ?? ''), text: `${decodeWords(h.subject ?? '')}\n${text}` };
}

const leaves = (v, out = [], key = null) => {
  if (v === null || v === undefined) return out;
  if (Array.isArray(v)) { v.forEach(x => leaves(x, out, key)); return out; }
  if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) leaves(x, out, k); return out; }
  out.push([key, String(v)]);
  return out;
};
const parseMaybe = s => { if (s === null || s === undefined || s === '') return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return undefined; } };
/** The route (a messaging operation) a method + URL reach, by the configuration's routes; the most specific wins. */
export function routeOf(method, url, routes = []) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { p = u.pathname; }
  let best = null;
  for (const r of routes) {
    if (String(method).toUpperCase() !== r.method) continue;
    if (!new RegExp(r.host, 'i').test(u.host)) continue;
    if (!new RegExp(r.tail).test(p)) continue;
    if (!best || r.lit > best.lit) best = r;
  }
  return best;
}
/** The facts of one tool call the lint needs: {route, recipients[], channels[], text} or null (not a message, or not decodable). */
export function callFacts(call, routes) {
  if (!call || call.name !== 'api_fetch') return null;
  const args = parseMaybe(call.arguments);
  if (!args || typeof args !== 'object') return null;
  const route = routeOf(args.method ?? 'GET', args.url, routes);
  if (!route) return null;
  let body = parseMaybe(args.body);
  if (body === undefined) body = typeof args.body === 'string' ? { text: args.body } : null;
  const params = parseMaybe(args.params) ?? null;
  const recipients = new Set(), channels = new Set();
  const texts = [];
  for (const obj of [body, params]) {
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj.raw === 'string') {
      const m = decodeRaw(obj.raw);
      if (!m) return null;
      [...m.to, ...m.cc, ...m.bcc].forEach(e => recipients.add(e));
      texts.push(m.text);
    }
    for (const [k, v] of leaves(obj)) {
      if (k === 'raw') continue;
      if (/^(to|cc|bcc|recipients?|email|emailaddress|address|phone|number|from)$/i.test(k ?? '')) emailsIn(v).forEach(e => recipients.add(e));
      if (/^(channel|channel_id|channelid|conversation|to|recipient|profile_ids?|page_id)$/i.test(k ?? '')) channels.add(String(v));
      texts.push(v);
    }
  }
  return { route, recipients: [...recipients], channels: [...channels], text: texts.join('\n') };
}
/** The rule violations of one call: [{rule, recipient, literal}] (rules of the route's app, for the call's recipient or
 * channel, whose left-out value the message names). */
export function violationsOf(facts, rules = []) {
  if (!facts) return [];
  const out = [];
  for (const rule of rules) {
    if (rule.app !== facts.route.app && rule.app !== facts.route.appKey) continue;
    let who = null;
    if (rule.recipients?.length) who = rule.recipients.find(e => facts.recipients.includes(String(e).toLowerCase())) ?? null;
    else if (rule.channels?.length) { const c = rule.channels.find(ch => facts.channels.some(x => x === ch.id || x.replace(/^#/, '').toLowerCase() === String(ch.name ?? '').toLowerCase())); who = c ? (c.name ? `#${c.name}` : c.id) : null; }
    else if (rule.channel) who = facts.channels.includes(rule.channel) || names(facts.text, rule.channel) ? rule.channel : null;
    else who = facts.route.app;
    if (!who) continue;
    for (const l of rule.literals ?? []) if (names(facts.text, l.text)) { out.push({ rule, recipient: who, literal: l }); break; }
  }
  return out;
}
export const callHash = c => createHash('sha256').update(`${c.name}\n${typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {})}`).digest('hex');
/** Gate state from the log lines: refusals per (rule, recipient), per session, and the refused calls. */
export function gateState(lines = []) {
  const s = { pairs: new Map(), total: 0, hashes: new Set() };
  for (const e of lines) if (e?.kind === 'refused') { s.total += 1; s.pairs.set(`${e.rule}|${e.recipient}`, (s.pairs.get(`${e.rule}|${e.recipient}`) ?? 0) + 1); if (e.hash) s.hashes.add(e.hash); }
  return s;
}
/**
 * decide(calls, cfg, logLines) -> [{i, action: 'send'|'refuse'|'resend'|'cap', violation?, hash}] per call, in order.
 * A refusal needs: a violation, the call not refused before (else an identical resend: sent), fewer than perSession
 * refusals so far and fewer than perPair for that (rule, recipient).
 */
export function decide(calls, cfg, logLines = []) {
  const st = gateState(logLines);
  const perPair = cfg?.perPair ?? 1, perSession = cfg?.perSession ?? 2;
  return calls.map((c, i) => {
    const hash = callHash(c);
    let vs;
    try { vs = violationsOf(callFacts(c, cfg?.routes ?? []), cfg?.rules ?? []); } catch { vs = []; }
    if (!vs.length) return { i, action: 'send', hash };
    if (st.hashes.has(hash)) return { i, action: 'resend', violation: vs[0], hash };
    const v = vs.find(x => (st.pairs.get(`${x.rule.pid}|${x.recipient}`) ?? 0) < perPair);
    if (!v || st.total >= perSession) return { i, action: 'cap', violation: vs[0], hash };
    st.total += 1; st.pairs.set(`${v.rule.pid}|${v.recipient}`, (st.pairs.get(`${v.rule.pid}|${v.recipient}`) ?? 0) + 1); st.hashes.add(hash);
    return { i, action: 'refuse', violation: v, hash };
  });
}
/** The refusal note (stderr). */
export function refusalText(d, call, { batch = false } = {}) {
  let a = {};
  try { a = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments ?? {}; } catch { /* shown as ? */ }
  let p = '?';
  try { p = new URL(String(a.url)).pathname; } catch { /* keep ? */ }
  const v = d.violation;
  const quote = String(v.literal.rule?.quote ?? v.rule.rule?.quote ?? '').replace(/\s+/g, ' ').slice(0, 200);
  const src = v.literal.rule?.source ?? v.rule.rule?.source ?? '?';
  return `HARNESS GATE: not sent (no world step used). Call ${d.i + 1} (${String(a.method ?? '?').toUpperCase()} ${p}) to ${v.recipient} contains "${v.literal.text}", which ${v.rule.pid} leaves out of this message (rule ${src}: "${quote}"). Remove it and send again. ${batch ? 'The other calls of this batch were sent; if the message must contain it, send this call again unchanged (without the calls already sent): it will be sent.' : 'If the message must contain it, run the identical command again: it will be sent.'}`;
}

function loadGate() {
  const dir = process.env[GATE_ENV];
  if (!dir) return null;
  try { const cfg = JSON.parse(readFileSync(path.join(dir, 'gate.json'), 'utf8')); return cfg && Array.isArray(cfg.rules) && Array.isArray(cfg.routes) ? cfg : null; } catch { return null; }
}
function readLog() {
  try { return readFileSync(path.join(BOX, GATE_LOG), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function log(entries) {
  if (!entries.length) return;
  try { mkdirSync(BOX, { recursive: true }); appendFileSync(path.join(BOX, GATE_LOG), entries.map(e => JSON.stringify(e)).join('\n') + '\n'); } catch { /* the lint never blocks on its log */ }
}

// ---------------------------------------------------------------------------------------------------------------
// The client (tool.mjs, with the lint between parsing and sending)

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'list') {
    process.stdout.write(readFileSync(path.join(HERE, 'tools.json'), 'utf8') + '\n');
    process.exit(0);
  }
  let calls;
  if (cmd === 'call') {
    if (!a) usage();
    const raw = readArg(b) ?? '{}';
    calls = [{ name: a, arguments: raw }];
  } else if (cmd === 'batch') {
    const raw = readArg(a);
    if (raw === undefined) usage();
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { console.error(`batch: the argument must be a JSON array (${e.message})`); process.exit(2); }
    if (!Array.isArray(arr) || !arr.length || !arr.every(c => c && typeof c === 'object' && typeof c.name === 'string')) {
      console.error('batch: expected a non-empty JSON array of {"name": "<tool>", "arguments": {...}}'); process.exit(2);
    }
    calls = arr.map(c => ({ name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) }));
  } else usage();

  const cfg = loadGate();
  const ds = cfg ? decide(calls, cfg, readLog()) : calls.map((c, i) => ({ i, action: 'send' }));
  const refused = ds.filter(d => d.action === 'refuse');
  if (cfg) log(ds.filter(d => d.action !== 'send').map(d => ({ t: Date.now() / 1000, kind: d.action === 'refuse' ? 'refused' : d.action === 'resend' ? 'resent' : 'capped', call: d.i + 1, of: calls.length, rule: d.violation.rule.pid, recipient: d.violation.recipient, literal: d.violation.literal.text, hash: d.hash })));
  for (const d of refused) console.error(refusalText(d, calls[d.i], { batch: cmd === 'batch' && calls.length > 1 }));
  const keep = ds.filter(d => d.action !== 'refuse').map(d => d.i);
  if (!keep.length) process.exit(1);
  const r = await send(keep.map(i => calls[i]));
  if (r.error) { console.error(r.error); process.exit(1); }
  if (cmd === 'call') process.stdout.write(String(r.results[0].content) + '\n');
  else for (const [k, x] of r.results.entries()) process.stdout.write(`### result ${keep[k] + 1}: ${x.name}\n${x.content}\n`);
  if (refused.length) process.exit(1);
}

// Run as the client (`node tool.mjs ...`), not when imported (host-side tests and replays import the lint).
const isMain = (() => { const me = fileURLToPath(import.meta.url); try { return realpathSync(process.argv[1]) === realpathSync(me); } catch { return path.resolve(process.argv[1] ?? '') === me; } })();
if (isMain) await main();
