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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import path from 'node:path';
import { canonical, digest } from '../../src/data.mjs';
import { loadSettings } from './settings.mjs';

/** The person at this computer, as Foundry can know them: { name, osUser, host }. */
export function whoIsHere(root) {
  let osUser = 'unknown'; try { osUser = userInfo().username; } catch { /* no passwd entry */ }
  return { name: loadSettings(root).yourName || null, osUser, host: hostname() };
}
export const whoLabel = w => w ? `${w.name ? `${w.name} (` : ''}${w.osUser}@${w.host}${w.name ? ')' : ''}` : 'unknown';

export class DecisionLog {
  constructor(root) { this.root = root; this.file = path.join(root, 'site', 'decisions.jsonl'); }
  lines() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { broken: l.slice(0, 80) }; } });
  }
  /** Append one decision; who and when are filled here. Returns the line. */
  append(entry) {
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const all = this.lines(), last = all.at(-1);
    const who = whoIsHere(this.root);
    const line = JSON.parse(JSON.stringify({ seq: all.length + 1, at: new Date().toISOString(), by: whoLabel(who), who, ...entry, prev: last?.hash ?? null }));
    line.hash = digest(line);
    appendFileSync(this.file, `${canonical(line)}\n`, { mode: 0o600 });
    return line;
  }
  /** Re-check every link: { ok, lines, head, reason? }. */
  verify() {
    const all = this.lines();
    let prev = null;
    for (const [i, l] of all.entries()) {
      if (l.broken) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} is not JSON` };
      const { hash, ...rest } = l;
      if (rest.prev !== prev) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} does not name the line before it` };
      if (digest(rest) !== hash) return { ok: false, lines: all.length, head: prev, reason: `line ${i + 1} was changed after it was written` };
      prev = hash;
    }
    return { ok: true, lines: all.length, head: prev };
  }
  forFlow(flowId) { return this.lines().filter(l => l.flowId === flowId); }
}

/** Wire a FoundryApp so every decision it makes is logged and named (the site, the MCP server and the CLI all call this). */
export function recordDecisions(app) {
  const log = new DecisionLog(app.root);
  app.principal = () => whoLabel(whoIsHere(app.root));
  app.onDecision = entry => log.append(entry);
  app.decisions = log;
  return log;
}
