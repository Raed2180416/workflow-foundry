// "Make drafts you send yourself": the default first live effect, which needs no connection, no account and no key
// (SPEC §1, A7). A live send in this preview writes one message file to <workspace>/outbox (the stand-in for e-mail, approved by the
// person first); this module shows those messages as drafts the person opens in their own mail app (mailto:) or downloads as an
// .eml file marked unsent (X-Unsent: 1), and sends themselves. Foundry sends nothing and cannot see the person's mail.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FoundryError } from '../../src/data.mjs';

const ID = /^[a-f0-9]{16,64}$/;
export const MAILTO_MAX = 1800; // a conservative length for mailto: links across mail apps (longer drafts are offered as a download)
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 998);

export function mailto({ to, subject, body }) {
  const link = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(body ?? '')}`;
  return link.length <= MAILTO_MAX ? link : null;
}

/** RFC 2047 encoded-word for a non-ASCII header value. */
const header = v => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;

/** An unsent draft (RFC 5322 + MIME), CRLF line ends, base64 body so any text survives. */
export function eml({ to, subject, body, date = new Date() }) {
  const b64 = Buffer.from(String(body ?? '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return ['X-Unsent: 1', `To: ${oneLine(to)}`, `Subject: ${header(oneLine(subject))}`, `Date: ${date.toUTCString()}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', 'X-Foundry: draft made on this computer; not sent', '', b64, ''].join('\r\n');
}

// "I sent it" is the person's own note, kept in the workspace (site/sent.json), so it survives a new browser tab, a new port and a new
// coding-agent session (P1 walkthrough M9). Foundry still cannot see the person's mail.
const sentFile = app => path.join(app.root, 'site', 'sent.json');
export function sentMarks(app) { try { return existsSync(sentFile(app)) ? JSON.parse(readFileSync(sentFile(app), 'utf8')) : {}; } catch { return {}; } }
export function markSent(app, id, sent, { by = null, now = Date.now } = {}) {
  if (!/^[a-zA-Z0-9_-]{4,80}$/.test(String(id))) throw new FoundryError('NOT_FOUND', 'No such draft');
  const marks = sentMarks(app);
  if (sent) marks[id] = { at: new Date(now()).toISOString(), by }; else delete marks[id];
  mkdirSync(path.dirname(sentFile(app)), { recursive: true, mode: 0o700 });
  const tmp = `${sentFile(app)}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(marks, null, 2), { mode: 0o600 }); renameSync(tmp, sentFile(app));
  return { id, sent: !!sent };
}

/** Every draft in the live outbox, newest first. */
export function listDrafts(app) {
  const dir = app.outboxDir;
  if (!existsSync(dir)) return [];
  const marks = sentMarks(app);
  return readdirSync(dir).filter(f => f.endsWith('.json') && ID.test(f.slice(0, -5))).map(f => {
    const m = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const id = f.slice(0, -5);
    return { id, kind: 'email', to: m.to, subject: m.subject, body: m.body, runId: m.runId ?? null, flowId: null, at: statSync(path.join(dir, f)).mtime.toISOString(),
      mailto: mailto(m), tooLongForLink: !mailto(m), sent: marks[id] ?? null };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

/** Chat posts a live run wrote (the on-call digest): drafts the person pastes into the channel themselves (P1 walkthrough M15). */
export function listPosts(app) {
  const dir = path.join(app.worldDir, 'chat');
  if (!existsSync(dir)) return [];
  const marks = sentMarks(app);
  return readdirSync(dir).filter(f => f.endsWith('.json')).flatMap(f => {
    let posts = []; try { posts = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { posts = []; }
    const at = statSync(path.join(dir, f)).mtime.toISOString();
    return (Array.isArray(posts) ? posts : []).filter(p => p?.mode === 'live' && typeof p.postId === 'string').map(p => ({ id: `post-${p.postId}`, kind: 'post', to: p.channel, subject: null,
      body: p.text, runId: p.runId ?? null, at, sent: marks[`post-${p.postId}`] ?? null }));
  });
}

export function draft(app, id) {
  if (!ID.test(String(id))) throw new FoundryError('NOT_FOUND', 'No such draft');
  const file = path.join(app.outboxDir, `${id}.json`);
  if (!existsSync(file)) throw new FoundryError('NOT_FOUND', 'No such draft');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  return { id, to: m.to, subject: m.subject, body: m.body, eml: eml({ ...m, date: statSync(file).mtime }) };
}
