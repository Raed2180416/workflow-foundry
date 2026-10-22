// Host side of the A1-C v2 pre-send lint (mechanism M4d; the agent side is tool-gated.mjs). Writes the act session's
// gate.json (read-only, in the session's step-guard directory, which the sandbox keeps read-only), and reads the
// session's gate log back without following links and with a size cap (the working directory is agent-writable).
// The configuration holds only what the lint needs: the messaging routes of the effect table and, per check, the
// left-out values a majority of readers found with a verbatim rule (hard bodyNot). Nothing grader-side exists here.
import { chmodSync, closeSync, constants as fsc, fstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EFFECTS } from './postconditions.mjs';

export { GATE_ENV, GATE_LOG, decide, callFacts, violationsOf, decodeRaw, routeOf, refusalText, cappedText, duplicateText, names } from './tool-gated.mjs';
export const GATE_FILE = 'gate.json';
export const LOG_MAX_BYTES = 1024 * 1024;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An outgoing messaging operation (an internal "note" is not one). */
export const outgoing = x => Boolean(x.channel) && x.channel !== 'note';
/** URL matchers for the effect table's outgoing messaging operations: method, host (the app's base URL host, or a host
 * sharing its last two labels), the path tail (the operation path minus 0-2 leading segments, params as one segment), and,
 * for operations that share one path, the body constants that select them. */
export function gateRoutes(effects = EFFECTS, keep = outgoing) {
  const out = [];
  for (const r of effects.rows.filter(keep)) {
    const base = effects.apps?.[r.app]?.baseUrl ?? null;
    let host = null;
    try { host = new URL(String(base).replace(/\{[^}]+\}/g, 'x')).host; } catch { /* no base */ }
    const labels = String(host ?? '').split('.').filter(Boolean);
    const baseHost = String(base ?? '').replace(/^https?:\/\//, '').split('/')[0];
    const hostRe = baseHost ? `^(?:${esc(baseHost).replace(/\\\{[^}]*\\\}/g, '[^.]+')}|(?:[^.]+\\.)*${esc(labels.slice(-2).join('.'))})$` : '.*';
    const segs = r.path.split('/').filter(Boolean);
    for (let k = 0; k <= Math.min(2, segs.length - 1); k++) {
      const tail = segs.slice(k);
      const lit = tail.filter(s => !/\{[^}]+\}/.test(s)).join('/').length;
      if (!lit) continue;
      out.push({ op: r.op, app: r.app, appKey: r.appKey, channel: r.channel, method: r.method, effect: r.effect, kind: r.kind, host: hostRe, tail: `(?:^|/)${tail.map(s => esc(s).replace(/\\\{[^}]*\\\}/g, '[^/]+')).join('/')}$`, lit,
        ...(r.bodyIs ? { bodyIs: r.bodyIs } : {}), ...(r.bodyIsNot ? { bodyIsNot: r.bodyIsNot } : {}) });
    }
  }
  return out;
}

/** The lint's rules: one per check with hard left-out values, for its recipients (gmail), channel (slack) or app. */
export function gateRules(pcs, merged = null) {
  const rules = [];
  for (const p of pcs) {
    const bn = p.params?.bodyNot ?? [];
    if (!bn.length) continue;
    const item = merged?.items?.find(i => i.id === p.item);
    const ruleFor = l => item?.exclusions?.find(e => e.literal === l)?.rule ?? null;
    const literals = bn.map(text => ({ text, rule: ruleFor(text) }));
    if (p.type === 'gmail_sent') rules.push({ pid: p.id, item: p.item, app: 'gmail', recipients: [...p.params.to, ...(p.params.cc ?? [])], literals, rule: literals[0].rule });
    else if (p.type === 'slack_posted') rules.push({ pid: p.id, item: p.item, app: 'slack', channels: [p.params.channel], literals, rule: literals[0].rule });
    else if (p.type === 'channel_posted') rules.push({ pid: p.id, item: p.item, app: p.params.app, channel: p.params.channel ?? null, literals, rule: literals[0].rule });
  }
  return rules;
}

export function gateConfig(pcs, { merged = null, perPair = 1, perSession = 2, effects = EFFECTS } = {}) {
  return { v: 1, perPair, perSession, routes: gateRoutes(effects), rules: gateRules(pcs, merged) };
}

/** Write gate.json (mode 0444) into `dir` (the act session's step-guard directory); a file left by an earlier attempt
 * (a resumed task) is removed first, so a read-only leftover never fails the write. */
export function writeGate(dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, GATE_FILE);
  rmSync(f, { force: true });
  writeFileSync(f, JSON.stringify(cfg, null, 1), { mode: 0o444 });
  chmodSync(f, 0o444);
  return f;
}

/** The session's gate log, read without following a link, as a regular single-link file of at most `maxBytes`. */
export function readGateLog(file, maxBytes = LOG_MAX_BYTES) {
  let fd;
  try { fd = openSync(file, fsc.O_RDONLY | fsc.O_NOFOLLOW | fsc.O_NONBLOCK); } catch { return { lines: [], status: 'absent' }; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) return { lines: [], status: 'not a regular file' };
    const n = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(n);
    let off = 0;
    while (off < n) { const k = readSync(fd, buf, off, n - off, off); if (!k) break; off += k; }
    const lines = buf.subarray(0, off).toString('utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && typeof x === 'object');
    return { lines, status: st.size > maxBytes ? 'cut' : 'ok' };
  } catch { return { lines: [], status: 'unreadable' }; } finally { closeSync(fd); }
}

/** Counts for the node row: client invocations that loaded the configuration, refusals, calls held with a refused
 * batch, identical resends, sends past a cap. */
export const gateSummary = lines => ({ loaded: lines.filter(e => e.kind === 'loaded').length, refused: lines.filter(e => e.kind === 'refused').length, held: lines.filter(e => e.kind === 'held').length,
  resentIdentical: lines.filter(e => e.kind === 'resent').length, capped: lines.filter(e => e.kind === 'capped').length,
  duplicatesRefused: lines.filter(e => e.kind === 'duplicate').length, heldThenSent: lines.filter(e => e.kind === 'sent').length });
