// Mock Microsoft Outlook (Graph) reply. reply {messageId, comment, saveAsDraft?, replyToSenderOnly?}
//   send:  202 {} (the reply goes out)   draft: 201 {id, isDraft:true} (a draft reply is saved, nothing is sent)
import { ok, fail, lower } from './common.mjs';
export class Outlook {
  constructor({ messages, ownAddress }) { this.opts = { ownAddress: lower(ownAddress), messages }; this.state = { sent: [], drafts: [] }; }
  reply({ messageId, comment, saveAsDraft, replyToSenderOnly } = {}) {
    const m = this.opts.messages.find(x => x.id === messageId);
    if (!m) return fail(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
    if (typeof comment !== 'string' || !comment.trim()) return fail(400, 'ErrorInvalidRequest', 'comment is required');
    const to = [lower(m.fromEmail)];
    const everyone = [...m.to, ...m.cc].map(lower).filter(a => a !== this.opts.ownAddress && !to.includes(a));
    const record = { inReplyTo: m.id, conversationId: m.threadId, to, cc: replyToSenderOnly === true ? [] : everyone, comment };
    if (saveAsDraft === true) {
      const id = `odraft${String(this.state.drafts.length + 1).padStart(4, '0')}`;
      this.state.drafts.push({ id, ...record });
      return ok(201, { id, isDraft: true });
    }
    this.state.sent.push({ id: `osent${String(this.state.sent.length + 1).padStart(4, '0')}`, ...record });
    return ok(202, {});
  }
}
