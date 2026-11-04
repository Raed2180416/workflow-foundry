// Who decided what, in their own chained log (P5 walkthrough B1-B3). The run record's hash chain lives in the engine (src/, frozen
// here), and its approval events can only name the actor "user"; the person's turn-on lives in a ledger row that changes by UPDATE, and
// their click on an exact list lived in a JSON store. This log keeps every decision a person makes through Foundry, with who (their name
// from Settings, the OS account and the host), through which channel, on which version, and what exactly (for a list: every item's
// digest), each line linked to the one before by sha256. It sits beside the run record, not inside it.
//
//   <workspace>/site/decisions.jsonl   one JSON object per line; hash = sha256(canonical(line without hash)); prev = the line before's hash
//
// What it proves: a line edited or removed after it was written breaks every later link. What it does not: anyone using this account
// can rewrite the whole file and recompute every link. Only an outside copy of the latest link (the page offers it) shows that.
//
// Since the security review of 2026-10-21:
//   M4   a line says how Foundry knew who decided, and that it is not verified: the name is the one in Settings (anyone with the page can
//        change it, and a change of name is logged too), and "through the page" means a request carried a key this Foundry start gave a
//        browser tab, not that a particular person clicked. Approval by an identity a program cannot hold (a passkey) is planned.
//   L14  the site and the MCP server both append; each append (read the last line, write the next) runs under one file lock
//        (./file-lock.mjs), so two processes cannot both link to the same line and fork the chain.
//
// Since the honesty review of 2026-10-21 (B1): a line written now (v: 2) has a hash that commits to its place, its automation and its
// content separately: hash = sha256(canonical({ link: 2, seq, prev, flowId, body })), where body = sha256(canonical(line without hash)).
// So an evidence file can carry every OTHER line as { seq, prev, flowId, body, hash } without its details, and a reader can still check
// each of those links from the head alone: which lines belong to the automation, and that none of them was left out of the file. A line
// written before (no v) keeps hash = body; its link shows an order a reader cannot prove.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { canonical, digest } from '../../src/data.mjs';
import { loadSettings } from './settings.mjs';
import { withFileLock } from './file-lock.mjs';

/** The link format of lines written now (B1). */
export const LINK_V = 2;
/** A v2 line's hash from its parts: its place (seq, prev), its automation (flowId) and its content (body). */
export const linkHash = ({ seq, prev, flowId, body }) => digest({ link: LINK_V, seq, prev: prev ?? null, flowId: flowId ?? null, body });
/** { body, hash } of a line as written (its own hash field left out): v2 lines link their parts; older lines hash their content. */
export function lineHashes(line) {
  const { hash: _hash, ...rest } = line ?? {};
  const body = digest(rest);
  return { body, hash: rest.v === LINK_V ? linkHash({ seq: rest.seq, prev: rest.prev, flowId: rest.flowId, body }) : body };
}

/** The person at this computer, as Foundry can know them: { name, osUser, host }. */
export function whoIsHere(root) {
  let osUser = 'unknown'; try { osUser = userInfo().username; } catch { /* no passwd entry */ }
  return { name: loadSettings(root).yourName || null, osUser, host: hostname() };
}
export const whoLabel = w => w ? `${w.name ? `${w.name} (` : ''}${w.osUser}@${w.host}${w.name ? ')' : ''}` : 'unknown';
/** How Foundry knows who decided, per channel, in words an auditor can check (M4). None of them is a verified identity. */
export const HOW_KNOWN = Object.freeze({
  dashboard: 'A request to the Foundry page carrying a key that this start of Foundry gave a browser tab opened with a one-time link. It shows the request came through such a tab on this computer, not which person clicked. The name is the one in Settings.',
  cli: 'A yes typed in a terminal of this computer account (Foundry asks only when input and output are a terminal). It shows a terminal session answered, not which person typed. The name is the one in Settings.',
  'mcp-elicitation': 'The coding agent\'s dialog. Before asking, Foundry looked for hooks that could answer the dialog without showing it; a hook it cannot see could still answer. The name is the one in Settings.'
});

export class DecisionLog {
  constructor(root) { this.root = root; this.file = path.join(root, 'site', 'decisions.jsonl'); }
  lines() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { broken: l.slice(0, 80) }; } });
  }
  /** Append one decision; who and when are filled here. Returns the line. */
  append(entry) {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const who = whoIsHere(this.root);
    return withFileLock(this.file, () => {
      const all = this.lines(), last = all.at(-1);
      // v, seq and prev come last, so nothing in an entry can set them.
      const line = JSON.parse(JSON.stringify({ at: new Date().toISOString(), by: whoLabel(who), who, verified: false,
        howKnown: HOW_KNOWN[entry.channel] ?? null, ...entry, flowId: entry.flowId ?? null, v: LINK_V, seq: all.length + 1, prev: last?.hash ?? null }));
      line.hash = lineHashes(line).hash;
      appendFileSync(this.file, `${canonical(line)}\n`, { mode: 0o600 });
      return line;
    });
  }
  /** Re-check every link: { ok, lines, head, reason? }. */
  verify() {
    const all = this.lines();
    let prev = null;
    for (const [i, l] of all.entries()) {
      if (l.broken) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} is not JSON` };
      if ((l.prev ?? null) !== prev) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} does not name the line before it` };
      if (l.seq !== i + 1) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} is numbered ${l.seq}` };
      if (lineHashes(l).hash !== l.hash) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} was changed after it was written` };
      prev = l.hash;
    }
    return { ok: true, lines: all.length, head: prev };
  }
  forFlow(flowId) { return this.lines().filter(l => l.flowId === flowId); }
  /**
   * Every line's place in the chain without its details (an evidence file carries these for every line, L9, B1): a v2 line as
   * { v, seq, prev, flowId, body, hash }, which a reader can check from the parts; an older line as { seq, prev, hash }.
   */
  links() {
    return this.lines().map((l, i) => l.broken ? { seq: i + 1, prev: null, hash: null, broken: true }
      : l.v === LINK_V ? { v: LINK_V, seq: l.seq, prev: l.prev ?? null, flowId: l.flowId ?? null, body: lineHashes(l).body, hash: l.hash ?? null }
        : { seq: l.seq, prev: l.prev ?? null, hash: l.hash ?? null });
  }
}

/** Wire a FoundryApp so every decision it makes is logged and named (the site, the MCP server and the CLI all call this). */
export function recordDecisions(app) {
  const log = new DecisionLog(app.root);
  app.principal = () => whoLabel(whoIsHere(app.root));
  app.onDecision = entry => log.append(entry);
  app.decisions = log;
  return log;
}
