// Mock Gmail for the two actions the job uses. The mailbox is registered up front (message id -> headers), as in a real account.
//   reply {messageId, text, replyToSenderOnly?}     -> 200 {id, threadId, labelIds:['SENT'], to, cc}   (reply-all unless replyToSenderOnly: true)
//   createDraft {to, subject, text, threadId?}      -> 200 {id, message:{id, threadId, labelIds:['DRAFT']}}
import { ok, fail, EMAIL_RE, lower } from './common.mjs';
export class Gmail {
  constructor({ messages, ownAddress }) { this.opts = { ownAddress: lower(ownAddress), messages }; this.state = { sent: [], drafts: [] }; }
  #find(id) { return this.opts.messages.find(m => m.id === id); }
  reply({ messageId, text, replyToSenderOnly } = {}) {
    const m = this.#find(messageId);
    if (!m) return fail(404, 'NOT_FOUND', 'Requested entity was not found.');
    if (typeof text !== 'string' || !text.trim()) return fail(400, 'BAD_REQUEST', 'Message body is empty');
    const to = [lower(m.fromEmail)];
    const cc = replyToSenderOnly === true ? [] : [...m.to, ...m.cc].map(lower).filter(a => a !== this.opts.ownAddress && !to.includes(a));
    const id = `gsent${String(this.state.sent.length + 1).padStart(4, '0')}`;
    this.state.sent.push({ id, inReplyTo: m.id, threadId: m.threadId, to, cc, subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, text });
    return ok(200, { id, threadId: m.threadId, labelIds: ['SENT'], to, cc });
  }
  createDraft({ to, subject, text, threadId } = {}) {
    if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) return fail(400, 'BAD_REQUEST', 'Invalid To header');
    if (typeof subject !== 'string' || !subject.trim()) return fail(400, 'BAD_REQUEST', 'subject is required');
    if (typeof text !== 'string' || !text.trim()) return fail(400, 'BAD_REQUEST', 'Message body is empty');
    if (threadId !== undefined && !this.opts.messages.some(m => m.threadId === threadId)) return fail(404, 'NOT_FOUND', 'Requested entity was not found.');
    const id = `gdraft${String(this.state.drafts.length + 1).padStart(4, '0')}`;
    this.state.drafts.push({ id, threadId: threadId ?? null, to: [lower(to)], subject, text });
    return ok(200, { id, message: { id: `${id}m`, threadId: threadId ?? null, labelIds: ['DRAFT'] } });
  }
}
