import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { createDefaultRegistry } from './capabilities.mjs';
import { validateWorkflow } from './validate.mjs';
import { FoundryError } from './data.mjs';

/** Advisory post-write validation only. Execution always validates independently. */
export function validateChangedFile(workspace, filePath) {
  if (typeof filePath !== 'string' || !filePath.endsWith('.workflow.json')) return { applicable: false };
  const root = realpathSync(workspace);
  const target = realpathSync(path.resolve(root, filePath));
  if (!target.startsWith(`${root}${path.sep}`)) throw new FoundryError('HOOK_PATH', 'Workflow file is outside the configured project');
  if (statSync(target).size > 2 * 1024 * 1024) throw new FoundryError('HOOK_SIZE', 'Workflow file exceeds two MiB');
  let workflow;
  try { workflow = JSON.parse(readFileSync(target, 'utf8')); } catch { return { applicable: true, valid: false, errors: [{ code: 'JSON', message: 'File does not contain valid JSON' }] }; }
  // A project may configure extra capabilities at its MCP host. A hook without that
  // manifest checks shape/dataflow only and must not falsely reject those tool names.
  return { applicable: true, ...validateWorkflow(workflow), capabilityBindingChecked: false, advisory: true };
}

export function claudeHookResult(workspace, event) {
  const file = event?.tool_input?.file_path ?? event?.tool_response?.filePath;
  const result = validateChangedFile(workspace, file);
  if (!result.applicable) return {};
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Workflow Foundry advisory validation: ${JSON.stringify(result)}. Use foundry_validate against the actual capability registry before execution.` } };
}
