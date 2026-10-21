// Auto-bind envelope and limits policy (`foundry-nodecap-envelope/1`), ARCHITECTURE.md §2.1 and §3.2. The envelope is a predicate over
// standby members: what the broker may grant inside a run without a person. Only an owner policy edit changes it (a new digest, which
// enters every new lock; running versions keep theirs).
import { checkData, clone } from '../data.mjs';
import { validateData } from '../validate.mjs';
import { CUSTODY, digest, EFFECTS, effectRank, fail, isPrivate, TRUST } from './common.mjs';

export const DEFAULT_ENVELOPE = Object.freeze({
  schema: 'foundry-nodecap-envelope/1',
  autoBind: { effects: ['none'], risk: ['low'], trust: ['T0', 'T1'], custody: ['C0', 'C1'], maxUsdPerCall: 0, requireAuthoredView: true,
    underUntrustedControl: { effects: ['none'] }, thirdPartyEgressWithPrivateData: 'deny' },
  standby: { maxPerNode: 20, trust: ['T0', 'T1', 'T2'] },
  limits: { boundPerNode: 5, skillsPerNode: 3, skillTokens: 1200, grantsPerRun: 10, proposalsPerRun: 2, relistTtlMs: 60000 },
  denyTools: ['*manage_connections*', 'auto_provision_mcp', 'enable_zapier_action', 'manage_zapier_connections', 'handle_auth_failure', 'COMPOSIO_MANAGE_CONNECTIONS'],
  widenChannels: ['dashboard', 'cli']
});
const list = items => ({ type: 'array', uniqueItems: true, maxItems: 10, items: { enum: items } });
export const envelopeSchema = { type: 'object', additionalProperties: false, required: ['schema', 'autoBind', 'standby', 'limits', 'denyTools', 'widenChannels'], properties: {
  schema: { const: 'foundry-nodecap-envelope/1' },
  autoBind: { type: 'object', additionalProperties: false, required: ['effects', 'risk', 'trust', 'custody', 'maxUsdPerCall', 'requireAuthoredView', 'underUntrustedControl', 'thirdPartyEgressWithPrivateData'], properties: {
    effects: list(EFFECTS), risk: list(['low', 'high']), trust: list(TRUST.filter(t => t !== 'T3')), custody: list(CUSTODY), maxUsdPerCall: { type: 'number', minimum: 0, maximum: 10 },
    requireAuthoredView: { const: true }, underUntrustedControl: { type: 'object', additionalProperties: false, required: ['effects'], properties: { effects: list(['none']) } },
    thirdPartyEgressWithPrivateData: { enum: ['deny'] } } },
  standby: { type: 'object', additionalProperties: false, required: ['maxPerNode', 'trust'], properties: { maxPerNode: { type: 'integer', minimum: 0, maximum: 20 }, trust: list(TRUST.filter(t => t !== 'T3')) } },
  limits: { type: 'object', additionalProperties: false, required: ['boundPerNode', 'skillsPerNode', 'skillTokens', 'grantsPerRun', 'proposalsPerRun', 'relistTtlMs'], properties: {
    boundPerNode: { type: 'integer', minimum: 0, maximum: 5 }, skillsPerNode: { type: 'integer', minimum: 0, maximum: 3 }, skillTokens: { type: 'integer', minimum: 16, maximum: 1200 },
    grantsPerRun: { type: 'integer', minimum: 0, maximum: 50 }, proposalsPerRun: { type: 'integer', minimum: 0, maximum: 10 }, relistTtlMs: { type: 'integer', minimum: 1000, maximum: 3600000 } } },
  denyTools: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 128 } },
  widenChannels: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ['dashboard', 'cli'] } } } };

export function checkEnvelope(envelope = DEFAULT_ENVELOPE) {
  checkData(envelope);
  validateData(envelopeSchema, envelope, 'nodecap envelope', { trustedSchema: true });
  // Auto-bind is never wider than effects none in this spike: an effectful acquisition is always a person's (L2, through the engine gate).
  if (envelope.autoBind.effects.some(e => e !== 'none')) fail('ENVELOPE_POLICY', 'The auto-bind envelope admits only effects none; effectful members are acquired through a per-call approval');
  return clone(envelope);
}
export const envelopeDigest = envelope => `sha256:${digest(envelope)}`;

const globRegex = pattern => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
/** Whether a member (by registry id or bare tool name) matches the deny list: credential brokers, connection managers, self-provisioning. */
export function denyListed(envelope, member) {
  const names = [member.id, member.tool, member.view?.name].filter(Boolean);
  return envelope.denyTools.some(pattern => names.some(name => globRegex(pattern).test(name) || globRegex(pattern).test(name.split('.').pop())));
}

/**
 * The auto-bind predicate (L1): may the broker grant `member` to a node without a person? `controlLabel` is the label under which the need
 * was raised (I6), `holdsPrivate` whether the node already holds private data (egress-aware Rule of Two). Returns {ok} or {ok:false, code}.
 */
export function autoBind(envelope, member, { controlLabel = 'trusted', holdsPrivate = false } = {}) {
  const a = envelope.autoBind;
  if (denyListed(envelope, member)) return { ok: false, code: 'NEED_DENYLISTED' };
  if (controlLabel !== 'trusted' && !a.underUntrustedControl.effects.includes(member.effects)) return { ok: false, code: 'NEED_UNTRUSTED_EFFECT' };
  if (!a.effects.includes(member.effects)) return { ok: false, code: 'NEED_EFFECTFUL' };
  if (!a.risk.includes(member.risk) || member.requiresApproval === true) return { ok: false, code: 'NEED_RISK' };
  if (!a.trust.includes(member.trust)) return { ok: false, code: 'NEED_TRUST' };
  if (member.custody && !a.custody.includes(member.custody)) return { ok: false, code: 'NEED_CUSTODY' };
  if ((member.cost ?? 0) > a.maxUsdPerCall) return { ok: false, code: 'NEED_COST' };
  if (a.requireAuthoredView && !member.view?.summary) return { ok: false, code: 'NEED_VIEW' };
  // Egress-aware Rule of Two: private data and a third-party egress never meet under one grant without a person.
  if ((holdsPrivate || isPrivate(member.dataClass)) && member.egress === 'third-party') return { ok: false, code: 'NEED_RULE_OF_TWO' };
  if (controlLabel !== 'trusted' && holdsPrivate && member.egress !== 'local' && effectRank(member.effects) > 0) return { ok: false, code: 'NEED_RULE_OF_TWO' };
  return { ok: true };
}
