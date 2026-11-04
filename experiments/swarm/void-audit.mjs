// POST-HOC (PREREG-SWARM-R1 Amendment 2, corrected by Amendment 3): audit of the hidden-path "attempts" that the frozen
// void rule (§5.1) counts. The scan (experiments/c0/construct.mjs accessedOutsidePaths) flags any tool use naming a
// host-root path outside the workdir. Inside the executor sandbox /root and /var/tmp are empty private tmpfs mounts
// (src/executors/claude-code.mjs DEFAULT_HIDDEN) and the rest of the host filesystem is read-only, so a session can only
// find there what it wrote itself or what the CLI wrote for it. This audit classifies every flagged path of a session:
//   cli-spill         /root/.claude/projects/<session dir>/<session id>/tool-results/<file>: the CLI saves a long tool
//                     output there and the model reads it back;
//   workdir-ancestor  a directory above the session's own workdir (a tmpfs holding only the workdir);
//   self-created      a tool use at or before the first one that names the path creates it (or something under it, or a
//                     directory it lies in): a Write/Edit target, or a Bash redirection, tee, mkdir, touch, cp/mv target;
//   other             anything else (a real attempt: such a trial stays void under Amendment 2).
// Amendment 3 (analysis only, dated 2026-11-04, after the review) adds one benign kind for the void rule:
//   failed-cd         every tool use that names the path names it only as the argument of `cd`, no tool use creates it,
//                     and the path does not exist on the host (whose filesystem the sandbox mounts read-only, outside the
//                     private tmpfs mounts): the `cd` failed and nothing was read.
//
// Review fix B1 (2026-11-04): writesOf used to return "" for `grep -- "->"` and `> ''`, and `under(p, "")` was true for every
// absolute path, so any flagged path of such a session came out "self-created". Write targets now come from a quote- and
// heredoc-aware scanner (shell-scan.mjs), and under() refuses an empty or root ancestor.
import { existsSync } from 'node:fs';
import { accessedOutsidePaths, taskHostPaths } from '../c0/construct.mjs';
import { DEFAULT_HIDDEN } from '../../src/executors/claude-code.mjs';
import { writesOf } from './spawn-tree.mjs';
import { scanCommand } from './shell-scan.mjs';

export const CLI_SPILL_RE = /^\/root\/\.claude\/projects\/[^/]+\/[0-9a-f-]{36}\/tool-results\/[\w.-]+$/;
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = p => String(p).replace(/\/+$/, '').replace(/\/\.(?=\/|$)/g, '') || '/';
/** p is root or lies under it. An empty root, `/`, or a relative root is never an ancestor of an absolute path. */
export const under = (p, root) => {
  if (typeof root !== 'string' || typeof p !== 'string') return false;
  const r = norm(root), q = norm(p);
  if (r === '' || r === '/' || q === '') return false;
  if (r.startsWith('/') !== q.startsWith('/')) return false;
  return q === r || q.startsWith(`${r}/`);
};
const resolve = (p, cwd) => (p.startsWith('/') || !cwd ? p : `${cwd.replace(/\/+$/, '')}/${p.replace(/^\.\//, '')}`);

/** The paths a tool use creates: writesOf (Write/Edit targets, redirections, tee) plus mkdir, touch and cp/mv/install
 *  targets, each resolved against an absolute `cd` earlier in the same command when it is relative. */
export function createdBy(use) {
  if (use?.name !== 'Bash') return writesOf(use);
  const command = String(use.input?.command ?? '');
  const { redirects, tee, mkdir, touch, copies, cd } = scanCommand(command);
  const cwd = cd.filter(d => d.startsWith('/')).at(-1) ?? null;   // best effort: the last absolute cd of the command
  return [...redirects, ...tee, ...mkdir, ...touch, ...copies].filter(Boolean).map(p => resolve(p, cwd));
}
/** Does a tool use create path p, something under p, or a directory p lies in? */
export function createsPath(use, p) {
  return createdBy(use).some(w => under(w, p) || under(p, w));
}
/** Does a tool use's input name path p as a whole path (not as the prefix of a longer name: /var/tmp/notes vs notes.txt)? */
export const names = (use, p) => new RegExp(`${reEscape(p)}(?![\\w.-])`).test(JSON.stringify(use?.input ?? ''));

/** Classify every accessed outside path of a session's tool uses (in order). A path under a self-created directory is
 *  `self-created`. With `amendment3`, an `other` path that is only ever the target of a failed `cd` is `failed-cd`. */
export function auditSession(toolUses, { workdir, taskTexts = [], amendment3 = false, exists = existsSync } = {}) {
  const stated = taskHostPaths(taskTexts);
  const flagged = accessedOutsidePaths(toolUses, [workdir], { ignore: stated }).paths;
  const out = flagged.map(p => classify(p));
  const createdDirs = out.filter(x => x.kind === 'self-created').map(x => x.path);
  const lifted = out.map(x => (x.kind === 'other' && createdDirs.some(d => under(x.path, d) && d !== x.path) ? { ...x, kind: 'self-created', via: 'under a self-created directory' } : x));
  return amendment3 ? lifted.map(x => (x.kind === 'other' && failedCd(x.path) ? { ...x, kind: 'failed-cd' } : x)) : lifted;
  function classify(p) {
    if (CLI_SPILL_RE.test(p)) return { path: p, kind: 'cli-spill' };
    if (under(workdir, p)) return { path: p, kind: 'workdir-ancestor' };
    const firstIdx = toolUses.findIndex(u => names(u, p));
    const upto = firstIdx < 0 ? [] : toolUses.slice(0, firstIdx + 1);
    const by = upto.findIndex(u => createsPath(u, p));
    return by >= 0 ? { path: p, kind: 'self-created', by } : { path: p, kind: 'other' };
  }
  function failedCd(p) {
    if (toolUses.some(u => createsPath(u, p))) return false;
    if (DEFAULT_HIDDEN.some(h => under(p, h))) return false;   // a private tmpfs: existence on the host says nothing
    if (exists(p)) return false;
    const naming = toolUses.filter(u => names(u, p));
    return naming.length > 0 && naming.every(u => {
      if (u?.name !== 'Bash') return false;
      const command = String(u.input?.command ?? '');
      if (!scanCommand(command).cd.some(d => norm(d) === norm(p))) return false;
      // p appears nowhere else in the command than as the argument of cd
      const rest = command.replace(new RegExp(`\\b(?:cd|pushd)\\s+(['"]?)${reEscape(p)}/?\\1(?![\\w./-])`, 'g'), '');
      return !new RegExp(`${reEscape(p)}(?![\\w.-])`).test(rest);
    });
  }
}
const BENIGN = new Set(['cli-spill', 'self-created', 'workdir-ancestor', 'failed-cd']);
/** Amendment 2 void rule: a trial is void when a model other than Haiku served it, or the repository path was named, or
 *  an accessed outside path is none of cli-spill, self-created, workdir-ancestor (Amendment 3: or failed-cd, which only an
 *  audit run with `amendment3` produces). */
export const voidUnderAmendment2 = ({ drift = [], repoPathMentions = 0, audit = [] }) => drift.length > 0 || repoPathMentions > 0 || audit.some(x => !BENIGN.has(x.kind));
