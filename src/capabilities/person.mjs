// The person's channel (I3), ARCHITECTURE.md §1.2 and §2.1. Every decision that widens authority (approve a lock, decide a capability
// proposal, re-activate a quarantined entry, connect an OAuth scope class) and every per-call approval of an effect (L2) is accepted only
// as a PersonDecision: an object minted by a person channel after it authenticated a principal and showed that principal the host's own
// rendering of the subject. A channel NAME is never enough: a string, a JSON value, a model's output, an MCP elicitation answer or a tool
// argument cannot become a PersonDecision (the brand is a module-private WeakSet, so no deserialized or hand-built object passes), and each
// decision is bound to one subject digest and consumed once.
//
// Channels:
//   cli        ttyPerson(): the controlling terminal of this process (/dev/tty, never stdin, so a pipe cannot answer), owned by this OS user;
//              the person reads the host-rendered subject and types back a one-time code shown with it. The OS user, uid and terminal
//              are recorded as the principal. A process without a controlling terminal (a daemon, a server spawned with pipes, a
//              sandboxed MCP server, which runs in its own session) cannot mint one.
//   dashboard  not built in this spike: no authenticated dashboard session exists, so nothing mints a dashboard decision (refused).
//   scripted   scriptedPerson(): the frozen scripted person of the development beds and tests. A ledger accepts it only when it was opened
//              with channels that include 'scripted' (beds and tests do; the default does not), and every record says 'scripted', so no
//              result can report a scripted decision as a person's.
import { closeSync, fstatSync, openSync, readlinkSync, readSync, writeSync } from 'node:fs';
import { isatty } from 'node:tty';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { digest, fail } from './common.mjs';

export const PERSON_CHANNELS = Object.freeze(['cli', 'dashboard', 'scripted']);
export const DEFAULT_PERSON_CHANNELS = Object.freeze(['cli', 'dashboard']);
const MINTED = new WeakSet(), CONSUMED = new WeakSet();
const SUBJECT = /^sha256:[0-9a-f]{64}$/;

function mint({ channel, principal, subject, approve }) {
  if (!SUBJECT.test(String(subject))) fail('PERSON_SUBJECT', 'A person decision binds one subject digest (sha256:<hex>)');
  if (typeof approve !== 'boolean') fail('APPROVAL_AUTHORITY', 'An explicit approve true/false decision is required');
  const decision = Object.freeze({ schema: 'foundry-person-decision/1', channel, principal: Object.freeze({ ...principal }), subject, approve, at: Date.now() });
  MINTED.add(decision);
  return decision;
}
/** Whether `value` is a decision a person channel minted (never true for a string, a JSON value or a hand-built object). */
export const isPersonDecision = value => typeof value === 'object' && value !== null && MINTED.has(value);

/**
 * Accept one decision for `subject` (checked by the ledger, by OAuth connect and by the dispatcher): genuine, from an accepted channel,
 * bound to exactly this subject, and not used before. Consumes it and returns the record to store ({channel, principal, approve, at}).
 */
export function acceptPerson(decision, subject, { channels = DEFAULT_PERSON_CHANNELS } = {}) {
  if (!isPersonDecision(decision)) fail('APPROVAL_CHANNEL_INSUFFICIENT', 'Widening decisions and effect approvals come only from a person channel (an authenticated principal), never from a channel name, a model or an elicitation');
  if (!channels.includes(decision.channel)) fail('APPROVAL_CHANNEL_INSUFFICIENT', `This ledger does not accept decisions from the ${decision.channel} channel`, { channel: decision.channel });
  if (decision.subject !== subject) fail('PERSON_SUBJECT_MISMATCH', 'The person decided a different subject than the one being changed', { decided: decision.subject.slice(0, 20), subject: String(subject).slice(0, 20) });
  if (CONSUMED.has(decision)) fail('PERSON_DECISION_REUSED', 'A person decision is used once');
  CONSUMED.add(decision);
  return { channel: decision.channel, principal: { ...decision.principal }, approve: decision.approve, at: decision.at };
}

/** A subject digest for any host-computed value (what the person is shown is rendered from the same value). */
export const subjectOf = value => `sha256:${digest(value)}`;

// Terminal text is untrusted where it quotes data (a held request body, a catalog summary): control characters (escape sequences that
// could repaint the prompt) are replaced before anything is written to the terminal.
const UNPRINTABLE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'g');
const printable = text => String(text).replace(UNPRINTABLE, '?');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The CLI person channel: show `summary` (host-rendered) and the subject on the controlling terminal, read the person's answer from it.
 * The answer is `approve <code>` (the one-time code printed with this subject) or `decline`. Anything else mints nothing.
 * `ttyPath` exists for tests; production uses /dev/tty.
 */
export function ttyPerson({ subject, summary, ttyPath = '/dev/tty', maxBytes = 256 }) {
  if (!SUBJECT.test(String(subject))) fail('PERSON_SUBJECT', 'A person decision binds one subject digest');
  let fd;
  try { fd = openSync(ttyPath, 'r+'); } catch (error) { fail('PERSON_CHANNEL_UNAVAILABLE', `No controlling terminal to ask a person on (${error.code ?? 'error'}); this process cannot mint a person decision`); }
  try {
    if (!isatty(fd)) fail('PERSON_CHANNEL_UNAVAILABLE', 'The person channel must be a terminal');
    const info = fstatSync(fd), uid = process.getuid?.() ?? null;
    if (uid !== null && info.uid !== uid) fail('PERSON_CHANNEL_UNAVAILABLE', 'The terminal belongs to another OS user');
    const code = Array.from(randomBytes(6), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    writeSync(fd, `\nFoundry needs a person's decision.\n${printable(summary)}\nSubject ${subject}\nType "approve ${code}" to approve, or "decline": `);
    const buffer = Buffer.alloc(maxBytes);
    let line = '';
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n <= 0) break;
      line += buffer.subarray(0, n).toString('utf8');
      if (line.includes('\n') || line.length >= maxBytes) break;
    }
    const answer = line.split('\n')[0].trim();
    let tty = null;
    try { tty = readlinkSync(`/proc/self/fd/${fd}`); } catch {}
    const principal = { kind: 'os-user', uid, user: (() => { try { return userInfo().username; } catch { return null; } })(), tty };
    if (answer === `approve ${code}`) return mint({ channel: 'cli', principal, subject, approve: true });
    if (answer === 'decline') return mint({ channel: 'cli', principal, subject, approve: false });
    fail('PERSON_INPUT_INVALID', 'The answer was neither the approval code shown with this subject nor "decline"; nothing was decided');
  } finally { closeSync(fd); }
}

/** The scripted person of beds and tests: decide(subject, approve) mints a decision recorded as channel 'scripted'. */
export function scriptedPerson(name = 'scripted-person') {
  const principal = { kind: 'scripted', name: String(name).slice(0, 60) };
  return (subject, approve) => mint({ channel: 'scripted', principal, subject, approve });
}
