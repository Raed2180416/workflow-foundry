
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
const blocked = () => { throw new Error('Offline CLI test forbids network and child-provider dispatch'); };
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
http.request = http.get = https.request = https.get = blocked;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[name] = blocked;
syncBuiltinESMExports();
const providers = {"file:///home/raed/Projects/workflow-foundry/src/opencode-free.mjs":"\nimport { readFileSync, appendFileSync, writeFileSync } from 'node:fs';\nexport class OpenCodeFreeProvider {\n  constructor({ model }) { this.identity = { provider: 'supplied-offline-cli-control', model }; }\n  async generate({ prompt }) {\n    appendFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/offline-provider-calls.jsonl\", JSON.stringify({ prompt }) + '\\n');\n    writeFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/.foundry/artifacts/c704bdca-ba0d-4fce-83c3-9888b2d77564/record.json\", '{}');\n    return { text: readFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/candidate-v2.json\", 'utf8') };\n  }\n}\n","file:///home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs":"\nimport { readFileSync, appendFileSync, writeFileSync } from 'node:fs';\nexport class OpenCodeV2FreeProvider {\n  constructor({ model }) { this.identity = { provider: 'supplied-offline-cli-control', model }; }\n  async generate({ prompt }) {\n    appendFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/offline-provider-calls.jsonl\", JSON.stringify({ prompt }) + '\\n');\n    writeFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/.foundry/artifacts/c704bdca-ba0d-4fce-83c3-9888b2d77564/record.json\", '{}');\n    return { text: readFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/verification-Eubfvm/cli-evidence/foundry-outcome-cli-dVFflL/candidate-v2.json\", 'utf8') };\n  }\n}\n"};
registerHooks({ load(url, context, next) {
  if (!Object.hasOwn(providers, url)) return next(url, context);
  return { format: 'module', shortCircuit: true, source: providers[url] };
} });
