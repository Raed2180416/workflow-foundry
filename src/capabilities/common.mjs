// Shared helpers of the node-capability layer (research/nodecap-20261021/ARCHITECTURE.md). This directory sits beside, and is distinct
// from, the engine-hashed src/capabilities.mjs: nothing here is in the engine identity (src/engine.mjs), so the spike changes no run binding.
import { createHash } from 'node:crypto';
import { digest, FoundryError } from '../data.mjs';
import { joinLabels } from '../context.mjs';

export { digest, FoundryError, joinLabels };
export const fail = (code, message, details) => { throw new FoundryError(code, message, details); };
export const sha256 = data => createHash('sha256').update(data).digest('hex');
/** A pin: `sha256:` + the canonical digest of a JSON value (src/data.mjs digest: sorted keys, JSON.stringify; RFC 8785 JCS for values that pass checkData). */
export const pinOf = value => `sha256:${digest(value)}`;
export const PIN = /^sha256:[0-9a-f]{64}$/;
export const EFFECTS = Object.freeze(['none', 'idempotent', 'non-idempotent']);
export const effectRank = effects => EFFECTS.indexOf(effects);
export const maxEffects = list => list.reduce((a, b) => effectRank(b) > effectRank(a) ? b : a, 'none');
export const TRUST = Object.freeze(['T0', 'T1', 'T2', 'T3']);
export const CUSTODY = Object.freeze(['C0', 'C1', 'C2', 'C3', 'C4']);
export const VERBS = Object.freeze(['read', 'search', 'list', 'create', 'update', 'delete', 'send', 'transform', 'observe', 'navigate', 'compute']);
export const DATA_CLASSES = Object.freeze(['public', 'internal', 'private', 'secret']);
export const EGRESS = Object.freeze(['local', 'first-party', 'third-party']);
export const LABEL = '^(?:trusted|untrusted:[A-Za-z0-9_.:-]+(?:\\+[A-Za-z0-9_.:-]+)*)$';
export const isPrivate = dataClass => dataClass === 'private' || dataClass === 'secret';
/** Approximate tokens (chars/4), labelled approximate wherever it is reported. */
export const approxTokens = text => Math.ceil(String(text ?? '').length / 4);
/** The tool-node id of a dispatcher call, from the engine-supplied node key (`root/.../<node>__loop:<n>/<do|act|log>`), never from arguments. */
export function toolNodeOf(nodeKey) {
  const match = /\/([A-Za-z][A-Za-z0-9_-]*)__loop:(\d+)\/([A-Za-z][A-Za-z0-9_-]*)$/.exec(String(nodeKey ?? ''));
  if (!match) fail('NODECAP_NODE_KEY', 'A nodecap dispatcher runs only inside a lowered tool node');
  return { node: match[1], turn: Number(match[2]), body: match[3] };
}
/** A one-line, host-authored error for model-visible results: the code, never upstream text. */
export const refusal = (code, extra = {}) => ({ ok: false, code, ...extra });
