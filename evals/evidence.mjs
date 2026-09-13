import { createHash } from 'node:crypto';

export const hashBytes = value => createHash('sha256').update(value).digest('hex');

// Unit fixtures for this gate are never construction benchmark generations.
export function inspectTuiEvidence({ manifest, session, prompt, transcript, output }) {
  const errors = [];
  const fail = message => errors.push(message);
  if (manifest?.mode !== 'actual-tui') fail('Run is not attributed to an actual TUI.');
  if (!transcript || Buffer.byteLength(transcript) < 20) fail('Raw TUI transcript is missing.');
  if (typeof prompt !== 'string' || manifest?.promptSHA256 !== hashBytes(prompt ?? '')) fail('Prompt hash mismatch.');
  if (!Array.isArray(session?.messages)) return { valid: false, errors: [...errors, 'Session export is missing.'] };
  const expectedModel = manifest?.model;
  const sessionModel = `${session.info?.model?.providerID}/${session.info?.model?.id}`;
  if (!expectedModel || expectedModel !== sessionModel) fail('Session model does not match the selected model.');
  if (session.info?.cost !== 0) fail('Session cost is nonzero or unreported.');
  const users = session.messages.filter(message => message.info?.role === 'user');
  const submitted = users.flatMap(message => message.parts ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
  if (typeof prompt !== 'string' || submitted !== prompt.trim()) fail('Actual submitted prompt differs from the recorded prompt or contains additional intervention.');
  let reconstructed;
  const toolEvents = [];
  const assistants = session.messages.filter(message => message.info?.role === 'assistant');
  for (const message of assistants) {
    if (`${message.info.providerID}/${message.info.modelID}` !== expectedModel) fail('Assistant message used a different or unreported model.');
    if (message.info.cost !== 0) fail('Assistant message cost is nonzero or unreported.');
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool') continue;
      const state = part.state ?? {};
      toolEvents.push({ tool: part.tool, status: state.status, filePath: state.input?.filePath });
      if (state.status !== 'completed') continue;
      const target = state.input?.filePath;
      if (['write', 'edit', 'patch', 'apply_patch'].includes(part.tool) && target !== '/task/output.json') {
        fail('Completed modification targets an unrecognized output path.');
        continue;
      }
      if (part.tool === 'write' && target === '/task/output.json') {
        if (typeof state.input.content !== 'string') fail('Successful write has no preserved source content.');
        else reconstructed = state.input.content;
      }
      if (part.tool === 'edit' && target === '/task/output.json') {
        const { oldString, newString, replaceAll } = state.input;
        if (typeof reconstructed !== 'string' || typeof oldString !== 'string' || !oldString || typeof newString !== 'string' || !reconstructed.includes(oldString)) {
          fail('Cannot reconstruct a completed edit from preserved prior output.');
        } else if (replaceAll === true) reconstructed = reconstructed.split(oldString).join(newString);
        else if (reconstructed.indexOf(oldString) !== reconstructed.lastIndexOf(oldString)) fail('Ambiguous completed edit cannot establish exact provenance.');
        else reconstructed = reconstructed.replace(oldString, () => newString);
      }
      if (['patch', 'apply_patch'].includes(part.tool)) fail('Patch provenance reconstruction is unsupported; do not substitute an operator-authored result.');
    }
  }
  if (!assistants.some(message => message.info.finish === 'stop')) fail('No completed final assistant response.');
  if (typeof output !== 'string') fail('No output file exists.');
  if (typeof reconstructed !== 'string') fail('No successful model-attributed write exists.');
  if (typeof output === 'string' && typeof reconstructed === 'string' && output !== reconstructed) fail('Output bytes differ from completed model tool writes/edits.');
  if (manifest?.outputSHA256 && typeof output === 'string' && manifest.outputSHA256 !== hashBytes(output)) fail('Frozen output hash mismatch.');
  return {
    valid: errors.length === 0, errors, sessionID: session.info?.id,
    model: expectedModel, appVersion: session.info?.version,
    cost: session.info?.cost, tokens: session.info?.tokens,
    assistantMessages: assistants.length, userMessages: users.length,
    toolCalls: toolEvents.length, toolEvents,
    outputSHA256: typeof output === 'string' ? hashBytes(output) : null,
    limitations: ['Local provenance assumes the evaluator, transcript and session export have not been forged.', 'Only complete writes and unambiguous edits are reconstructed.'],
  };
}

export function inspectSmoke(input) {
  const evidence = inspectTuiEvidence(input);
  let exactJSON = false;
  try {
    const output = JSON.parse(input.output);
    exactJSON = output?.probe === 'workflow-foundry-tui' && output?.ok === true
      && Array.isArray(output.sequence) && output.sequence.length === 3
      && output.sequence.every((item, index) => item === index + 1)
      && Object.keys(output).sort().join(',') === 'ok,probe,sequence';
  } catch { /* Missing or malformed JSON is a failed oracle. */ }
  return { ...evidence, exactJSON, passed: evidence.valid && exactJSON, classification: evidence.valid && exactJSON ? 'diagnostic-smoke-pass' : 'diagnostic-smoke-failure' };
}

export function inspectPair(baseline, treatment) {
  const errors = [];
  const common = ['taskSHA256', 'schemaSHA256', 'model', 'appVersion', 'executorSHA256', 'toolsSHA256', 'budgetSHA256', 'configSHA256'];
  for (const key of common) {
    if (!baseline?.[key] || !treatment?.[key] || baseline[key] !== treatment[key]) errors.push(`Missing or unequal comparison control: ${key}`);
  }
  if (baseline?.sessionID === treatment?.sessionID || !baseline?.sessionID || !treatment?.sessionID) errors.push('Arms require distinct recorded sessions.');
  if (baseline?.arm !== 'baseline' || treatment?.arm !== 'foundry') errors.push('Comparison arms are mislabeled.');
  if (baseline?.split !== treatment?.split) errors.push('Arms have different exposure splits.');
  if (baseline?.skillSHA256) errors.push('Baseline was exposed to Foundry skills.');
  if (!treatment?.skillSHA256) errors.push('Foundry skill snapshot is missing.');
  if (baseline?.split === 'heldout' && (!baseline?.sealVerified || !treatment?.sealVerified)) errors.push('Heldout sealing is not verified.');
  return { comparable: errors.length === 0, errors };
}
