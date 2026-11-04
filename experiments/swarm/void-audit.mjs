// POST-HOC (PREREG-SWARM-R1 Amendment 2): audit of the hidden-path "attempts" that the frozen void rule (§5.1) counts.
// The scan (experiments/c0/construct.mjs accessedOutsidePaths) flags any tool use naming a host-root path outside the
// workdir. Inside the executor sandbox /root and /var/tmp are empty private tmpfs mounts (src/executors/claude-code.mjs
// DEFAULT_HIDDEN), so nothing there can hold hidden material; a session can only find there what it wrote itself or what
// the CLI wrote for it. This audit classifies every flagged path of a session:
//   cli-spill     /root/.claude/projects/<session dir>/<session id>/tool-results/<file>: the CLI saves a long tool output
//                 there and the model reads it back;
//   self-created  the first tool use of the session that names the path (or a path under it) writes it: a Write/Edit target,
//                 or a Bash command that creates it (mkdir, redirection, tee, cp/mv target, a heredoc written to it);
//   other         anything else (a real attempt: such a trial stays void).
import { accessedOutsidePaths, taskHostPaths } from '../c0/construct.mjs';
import { writesOf } from './spawn-tree.mjs';

export const CLI_SPILL_RE = /^\/root\/\.claude\/projects\/[^/]+\/[0-9a-f-]{36}\/tool-results\/[\w.-]+$/;
const under = (p, root) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
/** Does a tool use create path p (or something under p)? */
export function createsPath(use, p) {
  const ws = writesOf(use);
  if (ws.some(w => under(w, p) || under(p, w))) return true;
  if (use?.name !== 'Bash') return false;
  const c = String(use.input?.command ?? '');
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`mkdir\\s+(?:-p\\s+)?[^;&|]*${esc}|(?:cp|mv)\\s+[^;&|]*\\s${esc}(?:/|\\s|$)|>\\s*${esc}`).test(c);
}
/** Classify every accessed outside path of a session's tool uses (in order). Besides the three kinds above, a directory
 *  that is an ancestor of the session's own workdir is `workdir-ancestor` (in the sandbox it is a tmpfs holding only the
 *  workdir and what the session itself put there), and a path under a self-created directory is `self-created`. */
export function auditSession(toolUses, { workdir, taskTexts = [] }) {
  const stated = taskHostPaths(taskTexts);
  const flagged = accessedOutsidePaths(toolUses, [workdir], { ignore: stated }).paths;
  const out = flagged.map(p => classify(p));
  const createdDirs = out.filter(x => x.kind === 'self-created').map(x => x.path);
  return out.map(x => (x.kind === 'other' && createdDirs.some(d => under(x.path, d) && d !== x.path) ? { ...x, kind: 'self-created', via: 'under a self-created directory' } : x));
  function classify(p) {
    if (CLI_SPILL_RE.test(p)) return { path: p, kind: 'cli-spill' };
    if (under(workdir, p)) return { path: p, kind: 'workdir-ancestor' };
    const first = toolUses.find(u => JSON.stringify(u?.input ?? '').includes(p) || toolUses.length === 0);
    const firstIdx = toolUses.indexOf(first);
    const created = toolUses.slice(0, firstIdx + 1).some(u => createsPath(u, p)) || toolUses.slice(0, firstIdx + 1).some(u => writesOf(u).some(w => under(w, p)));
    // a directory named first by a command that creates a file inside it (mkdir -p a/b; cat > a/b/x) counts as created
    const createdInside = !created && toolUses.slice(0, firstIdx + 1).some(u => {
      const c = String(u?.input?.command ?? '');
      return u?.name === 'Bash' && new RegExp(`mkdir\\s+(?:-p\\s+)?\\S*${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(c);
    });
    return { path: p, kind: created || createdInside ? 'self-created' : 'other' };
  }
}
/** Amendment 2 void rule: a trial is void when a model other than Haiku served it, or the repository path was named, or
 *  an accessed outside path is none of cli-spill, self-created, workdir-ancestor. */
export const voidUnderAmendment2 = ({ drift = [], repoPathMentions = 0, audit = [] }) => drift.length > 0 || repoPathMentions > 0 || audit.some(x => x.kind === 'other');
