
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
const providers = {"file:///home/raed/Projects/workflow-foundry/src/opencode-free.mjs":"OpenCodeFreeProvider","file:///home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs":"OpenCodeV2FreeProvider"};
registerHooks({ load(url, context, next) {
  const name = providers[url];
  if (!name) return next(url, context);
  return { format: 'module', shortCircuit: true, source:
    'import { readFileSync, appendFileSync, writeFileSync } from "node:fs"; export class ' + name + ' {' +
    'constructor({ model }) { this.identity = { provider: "supplied-offline-cli-control", model }; }' +
    'async generate({ prompt }) {' +
    'appendFileSync(' + "\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/evidence-01/foundry-outcome-cli-Z9m0F8/offline-provider-calls.jsonl\"" + ', JSON.stringify({ prompt }) + "\n");' +
    "writeFileSync(\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/evidence-01/foundry-outcome-cli-Z9m0F8/.foundry/artifacts/ceff8a06-2d49-4b9e-bfc0-74d03953b919/record.json\", '{}');" +
    'return { text: readFileSync(' + "\"/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/outcome-cli-20260917/evidence-01/foundry-outcome-cli-Z9m0F8/candidate-v2.json\"" + ', "utf8") }; }}'
  };
} });
