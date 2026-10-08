// Mock Microsoft Teams incoming webhook (Workflows / Power Automate style): POST an Adaptive Card message, 202 on success.
import { ok, fail, isObj } from './common.mjs';
export class Teams {
  constructor({ webhookUrl }) { this.opts = { webhookUrl }; this.state = { posts: [] }; }
  post({ url, body } = {}) {
    if (!this.opts.webhookUrl || url !== this.opts.webhookUrl) return fail(404, 'WEBHOOK_NOT_FOUND', 'no webhook is registered at this URL');
    const card = isObj(body) && body.type === 'message' && Array.isArray(body.attachments) ? body.attachments[0] : null;
    if (!card || card.contentType !== 'application/vnd.microsoft.card.adaptive' || !isObj(card.content) || !Array.isArray(card.content.body)) return fail(400, 'BAD_PAYLOAD', 'expected {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive", content:{body:[...]}}]}');
    this.state.posts.push({ url, body });
    return ok(202, {});
  }
}
