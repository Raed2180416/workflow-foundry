// A minimal loopback host for one human task: GET renders the form, POST re-validates the submission and either
// re-renders it with an error summary (422) or hands the typed answer to `onAnswer` once (compare-and-swap: the
// first accepted answer wins; later posts get 409). The browser test and the E-bed host use it; it is not a
// general web server (no routing, no static files, no cookies).
import { acceptSubmission } from './formstate.mjs';
import { FORM_HEADERS, renderAccepted, renderForm } from './render.mjs';

export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * createFormHandler({ spec, token?, onAnswer?, maxBodyBytes? }) -> (req, res) => void.
 * onAnswer(answer) may throw (for example the runtime's ANSWER_CONFLICT); the error code is shown, the answer is
 * not recorded, and the form stays open.
 */
export function createFormHandler({ spec, token = null, onAnswer = () => {}, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const state = { answered: false, answer: undefined, posts: 0, rejected: 0 };
  const send = (res, status, html, extra = {}) => {
    res.writeHead(status, { ...FORM_HEADERS, ...extra });
    res.end(html);
  };
  const plain = (res, status, text) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); res.end(text); };
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://loopback.invalid');
    if (url.pathname !== '/') return plain(res, 404, 'not found');
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (state.answered) return send(res, 200, renderAccepted(spec, state.answer));
      return send(res, 200, renderForm(spec, { token }));
    }
    if (req.method !== 'POST') return plain(res, 405, 'method not allowed');
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') { req.resume(); return plain(res, 415, 'expected application/x-www-form-urlencoded'); }
    const chunks = [];
    let size = 0, over = false;
    req.on('data', chunk => { size += chunk.length; if (size > maxBodyBytes) { over = true; req.destroy(); } else chunks.push(chunk); });
    req.on('error', () => {});
    req.on('close', () => { if (over && !res.headersSent) plain(res, 413, 'body too large'); });
    req.on('end', () => {
      if (over) return;
      state.posts++;
      if (state.answered) return plain(res, 409, 'this task already has an answer');
      const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
      const result = acceptSubmission(spec, body, { token });
      if (!result.ok) { state.rejected++; return send(res, 422, renderForm(spec, { token, values: result.values, errors: result.errors })); }
      try { onAnswer(result.answer); }
      catch (error) {
        state.rejected++;
        const errors = [{ source: 'host', code: 'answer-refused', path: '', message: `The answer was not recorded (${String(error.code ?? 'error')})`, hint: 'Reload the page' }];
        return send(res, 409, renderForm(spec, { token, values: result.values, errors }));
      }
      state.answered = true; state.answer = result.answer;
      return send(res, 200, renderAccepted(spec, result.answer));
    });
  };
  handler.state = state;
  return handler;
}
