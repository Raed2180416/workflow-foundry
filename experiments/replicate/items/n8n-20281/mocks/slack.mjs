// Mock Slack chat.postMessage by channel name. Unknown channel -> 200 {ok:false, error:'channel_not_found'} like the real API.
import { ok } from './common.mjs';
export const BROADCAST_RE = /<!(channel|here|everyone)(\|[^>]*)?>|<!subteam\^[A-Z0-9]+(\|[^>]*)?>/gi;
export const broadcastsIn = text => [...String(text ?? '').matchAll(BROADCAST_RE)].map(m => m[0]);
export class Slack {
  constructor({ channels }) { this.opts = { channels: [...channels, 'general', 'random'] }; this.state = { messages: [] }; }
  postMessage({ channel, text } = {}) {
    const name = String(channel ?? '').replace(/^#/, '');
    if (!this.opts.channels.includes(name)) return ok(200, { ok: false, error: 'channel_not_found' });
    if (typeof text !== 'string' || !text.trim()) return ok(200, { ok: false, error: 'no_text' });
    if (text.length > 40000) return ok(200, { ok: false, error: 'msg_too_long' });
    const ts = `1760000000.${String(this.state.messages.length + 1).padStart(6, '0')}`;
    this.state.messages.push({ channel: name, text, ts, broadcasts: broadcastsIn(text) });
    return ok(200, { ok: true, channel: name, ts, message: { text } });
  }
}
