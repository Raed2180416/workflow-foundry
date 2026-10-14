// A minimal loopback host for one human task: GET renders the form, POST re-validates the submission and either
// re-renders it with an error summary (422) or hands the typed answer to `onAnswer` once (the first accepted answer
// wins; later posts get 409). The browser test uses it, and a bed host may; it is not a general web server (no routing,
// no static files, no cookies).
//
// Who may answer. The handler serves only the person holding its capability URL, `handler.path` ("/?t=<token>", a
// random 256-bit token unless the caller gives one of at least 32 URL-safe characters): every request, GET included,
// must carry the token, so a page or process that can reach the port but was not given the link can neither read the
// form (and its hidden token) nor answer it. Before that, a request must come from a loopback address, name this host
// and port in Host (127.0.0.1, localhost or [::1]; a DNS-rebinding name is refused), and must not be cross-site
// (Sec-Fetch-Site, when sent, is same-origin, or "none" for a navigation; Origin, when sent, is this origin or "null",
// which browsers send for a same-origin POST under Referrer-Policy: no-referrer). Refusals are plain-text 403s that
// echo nothing. A submission whose envelope fails (stale `_spec`, missing or wrong `_token`) is also a 403 with no
// form: only a request that passed every check sees its values echoed back (422).
//
// One task. The spec must be bound to a task (`bind.taskId`, or `bind.runId` and `bind.nodeKey`), so two tasks with
// the same question and schema have different spec hashes. `onAnswer` may be async; while it runs, other posts get
// 409, and the answer counts as recorded only after it resolves. If it throws or rejects (for example the runtime's
// ANSWER_CONFLICT), the answer is not recorded and the form stays open. `handler.close()` ends the task (timeout,
// cancellation): every later request gets 410. The once-only record is in memory: a new handler for the same task
// (a restart) accepts again unless `onAnswer` refuses, as Runtime.answer does for a node that is no longer waiting.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { acceptSubmission } from './formstate.mjs';
import { FORM_HEADERS, renderAccepted, renderForm } from './render.mjs';

export const MAX_BODY_BYTES = 256 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const LOOPBACK = /^(?:127(?:\.[0-9]{1,3}){3}|::1|::ffff:127(?:\.[0-9]{1,3}){3})$/;

const sameToken = (given, token) => typeof given === 'string' && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
const isTaskBound = bind => bind !== null && typeof bind === 'object' && (typeof bind.taskId === 'string' || (typeof bind.runId === 'string' && typeof bind.nodeKey === 'string'));

/** Why a request may not reach the form at all (a short reason), or null. */
function refusal(req, method) {
  if (!LOOPBACK.test(String(req.socket?.remoteAddress ?? ''))) return 'not a loopback caller';
  const port = req.socket.localPort;
  const host = String(req.headers.host ?? '').toLowerCase();
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return 'unrecognized host';
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && !(site === 'none' && (method === 'GET' || method === 'HEAD'))) return 'cross-site request';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== 'null' && origin.toLowerCase() !== `http://${host}`) return 'cross-origin request';
  return null;
}

/**
 * createFormHandler({ spec, token?, onAnswer?, maxBodyBytes? }) -> (req, res) => void, with `handler.token`,
 * `handler.path` (the capability path to hand to the person), `handler.close()` and `handler.state`.
 */
export function createFormHandler({ spec, token, onAnswer = () => {}, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  if (!spec || typeof spec.specHash !== 'string' || !Array.isArray(spec.fields)) throw new TypeError('createFormHandler needs a compiled spec');
  if (!isTaskBound(spec.bind)) throw new TypeError('the spec must be bound to one task: compile it with bind: { taskId } or bind: { runId, nodeKey }');
  if (token === undefined || token === null) token = randomBytes(32).toString('base64url');
  else if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError('token must be 32 to 256 URL-safe characters (A-Z a-z 0-9 _ -); leave it out to get a random one');
  if (typeof onAnswer !== 'function') throw new TypeError('onAnswer must be a function');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new TypeError('maxBodyBytes must be a positive integer');
  const state = { answered: false, answer: undefined, pending: false, closed: false, posts: 0, rejected: 0, refused: 0 };
  const send = (res, status, html, extra = {}) => {
    res.writeHead(status, { ...FORM_HEADERS, ...extra });
    res.end(html);
  };
  const plain = (res, status, text, extra = {}) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra });
    res.end(text);
  };
  const broken = (res, status) => { if (!res.headersSent) plain(res, status, status === 400 ? 'bad request' : 'internal error', { connection: 'close' }); else res.destroy(); };

  async function finishPost(res, body) {
    state.posts++;
    if (state.closed) return plain(res, 410, 'this task is closed');
    if (state.answered) return plain(res, 409, 'this task already has an answer');
    if (state.pending) return plain(res, 409, 'an answer for this task is being recorded');
    const result = acceptSubmission(spec, body, { token });
    if (result.envelope) { state.refused++; return plain(res, 403, 'This form is out of date, or the request did not come from it. Open the link you were given again.'); }
    if (!result.ok) { state.rejected++; return send(res, 422, renderForm(spec, { token, values: result.values, errors: result.errors })); }
    state.pending = true;
    try { await onAnswer(result.answer); }
    catch (error) {
      state.rejected++;
      const errors = [{ source: 'host', code: 'answer-refused', path: '', message: `The answer was not recorded (${String(error?.code ?? 'error')})`, hint: 'Reload the page' }];
      return send(res, 409, renderForm(spec, { token, values: result.values, errors }));
    } finally { state.pending = false; }
    state.answered = true; state.answer = result.answer;
    return send(res, 200, renderAccepted(spec, result.answer));
  }

  const handler = (req, res) => {
    try {
      const method = req.method;
      const why = refusal(req, method);
      if (why) { state.refused++; req.resume(); return plain(res, 403, `forbidden: ${why}`, { connection: 'close' }); }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== '/') { req.resume(); return plain(res, 404, 'not found'); }
      if (url.searchParams.getAll('t').length !== 1 || !sameToken(url.searchParams.get('t'), token)) { state.refused++; req.resume(); return plain(res, 403, 'forbidden: open the link you were given'); }
      if (state.closed) { req.resume(); return plain(res, 410, 'this task is closed'); }
      if (method === 'GET' || method === 'HEAD') {
        if (state.answered) return send(res, 200, renderAccepted(spec, state.answer));
        return send(res, 200, renderForm(spec, { token }));
      }
      if (method !== 'POST') { req.resume(); return plain(res, 405, 'method not allowed', { allow: 'GET, HEAD, POST' }); }
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/x-www-form-urlencoded') { req.resume(); return plain(res, 415, 'expected application/x-www-form-urlencoded'); }
      // Read the body; past the limit keep reading (and dropping) so the client gets the 413, up to a hard cap.
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size <= maxBodyBytes) chunks.push(chunk);
        else if (size > maxBodyBytes * 16) req.destroy();
      });
      req.on('error', () => {});
      req.on('end', () => {
        if (size > maxBodyBytes) return plain(res, 413, 'body too large', { connection: 'close' });
        const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
        finishPost(res, body).catch(() => broken(res, 500));
      });
    } catch {
      broken(res, 400);
    }
  };
  handler.token = token;
  handler.path = `/?t=${token}`;
  handler.close = () => { state.closed = true; };
  handler.state = state;
  return handler;
}
