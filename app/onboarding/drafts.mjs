// "Make drafts you send yourself": the default first live effect, which needs no connection, no account and no key
// (SPEC §1, A7). A live send in this preview writes one message file to <workspace>/outbox (the stand-in for e-mail, approved by the
// person first); this module shows those messages as drafts the person opens in their own mail app (mailto:) or downloads as an
// .eml file marked unsent (X-Unsent: 1), and sends themselves. Foundry sends nothing and cannot see the person's mail.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/** Every draft in the live outbox, newest first. */
export function listDrafts(app) {
  const dir = app.outboxDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json') && ID.test(f.slice(0, -5))).map(f => {
    const m = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    return { id: f.slice(0, -5), to: m.to, subject: m.subject, body: m.body, runId: m.runId ?? null, flowId: null, at: statSync(path.join(dir, f)).mtime.toISOString(),
      mailto: mailto(m), tooLongForLink: !mailto(m) };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

export function draft(app, id) {
  if (!ID.test(String(id))) throw new FoundryError('NOT_FOUND', 'No such draft');
  const file = path.join(app.outboxDir, `${id}.json`);
  if (!existsSync(file)) throw new FoundryError('NOT_FOUND', 'No such draft');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  return { id, to: m.to, subject: m.subject, body: m.body, eml: eml({ ...m, date: statSync(file).mtime }) };
}
