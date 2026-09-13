import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { runProcess } from './process.mjs';
import { FoundryError, checkData } from './data.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export function classifyOpenCodeFailure(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 4 * 1024 * 1024) return null;
  const failures = [];
  for (const line of stdout.split(/\r?\n/).filter(line => line.trim())) {
    let event; try { event = JSON.parse(line); } catch { return null; }
    if (event?.type === 'error' && event.error?.data && Number.isInteger(event.error.data.statusCode)) failures.push(event.error.data);
  }
  if (!failures.length) return null;
  const rate = failures.find(data => data.statusCode === 429);
  const selected = rate ?? failures.find(data => data.statusCode >= 500 && data.statusCode <= 599) ?? failures.find(data => [401, 403].includes(data.statusCode));
  if (!selected) return null;
  const retry = selected.responseHeaders?.['retry-after'];
  const retryAfterSeconds = typeof retry === 'string' && /^\d{1,7}$/.test(retry) ? Number(retry) : null;
  const details = { observedStatusCode: selected.statusCode, retryAfterSeconds, automaticRetry: false, completedResponse: false };
  if (rate) return new FoundryError('MODEL_RATE_LIMIT', 'The configured free provider returned HTTP 429. Generation is paused; no paid fallback or automatic retry is permitted. Resume only after the provider allows requests again.', details);
  if ([401, 403].includes(selected.statusCode)) return new FoundryError('MODEL_AUTH_REQUIRED', 'The configured provider refused access. No credentials or alternate account were substituted.', details);
  return new FoundryError('MODEL_UNAVAILABLE', `The configured provider returned HTTP ${selected.statusCode}; no completed model response is available.`, details);
}
export function parseFreeCatalog(text) {
  const blocks = text.split(/^(?=opencode\/[^\s]+\s*$)/m).filter(x => x.startsWith('opencode/'));
  const records = blocks.map(block => {
    const id = block.slice(0, block.indexOf('\n')).trim();
    const first = block.indexOf('{'), last = block.lastIndexOf('}');
    if (first < 0 || last < first) throw new FoundryError('MODEL_CATALOG', 'OpenCode model metadata is incomplete');
    return { id, metadata: JSON.parse(block.slice(first, last + 1)) };
  });
  if (!records.length) throw new FoundryError('MODEL_CATALOG', 'No OpenCode provider records were observed');
  return records;
}
export function requireFreeModel(records, id) {
  if (!Array.isArray(records) || records.filter(record => record?.id === id).length > 1) throw new FoundryError('MODEL_CATALOG', 'Duplicate or invalid model records cannot establish a unique free model');
  const selected = records.find(x => x.id === id);
  if (!selected || !id.startsWith('opencode/')) throw new FoundryError('MODEL_UNAVAILABLE', 'The requested model was not observed in the isolated OpenCode provider catalog');
  const cost = selected.metadata.cost;
  if (!cost || cost.input !== 0 || cost.output !== 0) throw new FoundryError('MODEL_NOT_FREE', 'Explicit zero input and output pricing is required');
  const walk = value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!Object.keys(value).length) throw new FoundryError('MODEL_NOT_FREE', 'Empty pricing metadata does not establish zero cost');
      for (const child of Object.values(value)) walk(child); return;
    }
    if (value !== 0) throw new FoundryError('MODEL_NOT_FREE', 'All observed pricing fields must be explicitly zero');
  };
  walk(cost); return selected;
}

export function parseOpenCodeEvents(stdout) {
  const events = stdout.split(/\r?\n/).filter(line => line.trim()).map(line => {
    try { return JSON.parse(line); } catch { throw new FoundryError('MODEL_PROTOCOL', 'Expected newline-delimited OpenCode JSON events'); }
  });
  if (events.some(event => !event || Array.isArray(event) || typeof event !== 'object' || typeof event.type !== 'string' || typeof event.sessionID !== 'string' || !event.sessionID)) throw new FoundryError('MODEL_PROTOCOL', 'Every provider event must have a concrete type and session identity');
  if (!events.length || events.some(e => e.type === 'error')) throw classifyOpenCodeFailure(stdout) ?? new FoundryError('MODEL_FAILED', 'OpenCode emitted an error or no events');
  if (events.some(e => e.type === 'tool_use')) throw new FoundryError('MODEL_TOOL_ATTEMPT', 'This architect mode is output-only; model tool attempts are not accepted');
  const texts = events.filter(e => e.type === 'text' && e.part?.type === 'text' && typeof e.part.text === 'string');
  const finishes = events.filter(e => e.type === 'step_finish' && e.part?.type === 'step-finish');
  if (!texts.length || !finishes.length || finishes.at(-1).part.reason !== 'stop') throw new FoundryError('MODEL_INCOMPLETE', 'No completed final model response was observed');
  if (events.at(-1) !== finishes.at(-1)) throw new FoundryError('MODEL_PROTOCOL', 'Output after the final stop event is uncommitted provider data');
  for (const event of finishes) if (event.part.cost !== 0) throw new FoundryError('MODEL_COST_UNKNOWN', 'The completed response did not report a zero cost');
  const ids = new Set(events.map(e => e.sessionID).filter(Boolean));
  if (ids.size !== 1) throw new FoundryError('MODEL_SESSION', 'Multiple or missing session identities in provider output');
  return { text: texts.map(e => e.part.text).join('\n'), sessionId: [...ids][0], cost: 0, tokens: finishes.map(e => e.part.tokens), events };
}

/** Optional product bridge. This is intentionally noninteractive and is NEVER
 * counted as the separately required actual-TUI comparative experiment. */
export class OpenCodeFreeProvider {
  constructor({ model, binary = '/usr/bin/opencode', timeoutMs = 240000 } = {}) {
    if (typeof model !== 'string' || !/^opencode\/[A-Za-z0-9._-]+$/.test(model)) throw new FoundryError('MODEL_ID', 'Provide an exact observed OpenCode free model id');
    if (process.platform !== 'linux' || !existsSync('/usr/bin/bwrap') || !existsSync(binary)) throw new FoundryError('MODEL_SANDBOX', 'The free adapter requires Linux, bubblewrap and an existing OpenCode binary');
    const target = realpathSync(binary);
    if (!target.startsWith('/usr/')) throw new FoundryError('MODEL_BINARY', 'This adapter only executes an installed OpenCode binary under the read-only /usr mount');
    this.model = model; this.binary = target; this.timeoutMs = timeoutMs;
    this.identity = { provider: 'opencode-free-isolated', model, transport: 'noninteractive-json-events', binary: target, binarySHA256: sha(readFileSync(target)) };
  }
  async generate({ prompt, directory, signal }) {
    if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 400000) throw new FoundryError('MODEL_INPUT_LIMIT', 'Architect prompt exceeds the supported budget');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const root = path.join(directory, `isolated-${randomUUID()}`);
    for (const rel of ['task', 'state/config/opencode', 'state/data', 'state/cache', 'state/state']) mkdirSync(path.join(root, rel), { recursive: true, mode: 0o700 });
    const config = {
      $schema: 'https://opencode.ai/config.json', enabled_providers: ['opencode'],
      autoupdate: false, share: 'disabled', plugin: [], lsp: false, formatter: false,
      permission: { '*': 'deny' }
    };
    const configPath = path.join(root, 'task/opencode.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    const home = os.homedir();
    const env = {
      PATH: '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', TERM: 'dumb',
      XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data', XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state',
      OPENCODE_CONFIG: '/task/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode'
    };
    const sandbox = args => [
      '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL',
      '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', home,
      '--dir', '/etc', '--ro-bind', '/etc/ssl', '/etc/ssl', '--ro-bind', realpathSync('/etc/resolv.conf'), '/etc/resolv.conf', '--ro-bind', '/etc/hosts', '/etc/hosts',
      '--bind', path.join(root, 'state'), '/state', '--ro-bind', path.join(root, 'task'), '/task', '--chdir', '/task', this.binary, ...args
    ];
    const run = async (name, args, options = {}) => {
      try {
        const result = await runProcess('/usr/bin/bwrap', sandbox(args), { env, timeoutMs: Math.min(this.timeoutMs, 45000), signal, ...options });
        writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(result, null, 2), { mode: 0o600 }); return result;
      } catch (error) {
        if (error.processResult) writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(error.processResult, null, 2), { mode: 0o600 });
        if (name === 'generation' && error.code === 'PROCESS_FAILED') {
          const classified = classifyOpenCodeFailure(error.processResult?.stdout);
          if (classified) { classified.processResult = error.processResult; throw classified; }
        }
        throw error;
      }
    };
    const version = (await run('version', ['--version'])).stdout.trim();
    const catalog = await run('catalog', ['models', 'opencode', '--verbose', '--pure']);
    const modelRecord = requireFreeModel(parseFreeCatalog(catalog.stdout), this.model);
    Object.assign(config, { model: this.model, small_model: this.model });
    writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    const invocation = await run('generation', ['run', '--format', 'json', '--model', this.model, '--pure'], { input: prompt, timeoutMs: this.timeoutMs });
    const parsed = parseOpenCodeEvents(invocation.stdout);
    const exported = await run('session-export', ['export', parsed.sessionId, '--pure']);
    let session;
    try { session = JSON.parse(exported.stdout); } catch { throw new FoundryError('MODEL_EXPORT', 'The actual model session export is not valid JSON'); }
    const observedModel = session.info?.model;
    if (`${observedModel?.providerID}/${observedModel?.id}` !== this.model || session.info?.cost !== 0) throw new FoundryError('MODEL_DRIFT', 'The executed session model or reported cost differs from the selected free model');
    if (session.info.id !== parsed.sessionId || !Array.isArray(session.messages)) throw new FoundryError('MODEL_DRIFT', 'Exported session identity does not match the streamed response');
    const messages = session.messages.filter(message => message?.info?.role === 'assistant');
    if (!messages.length || messages.some(message => `${message.info.providerID}/${message.info.modelID}` !== this.model || message.info.cost !== 0)) throw new FoundryError('MODEL_DRIFT', 'An assistant message used a different model or lacked a zero-cost receipt');
    const exportedText = messages.flatMap(message => Array.isArray(message.parts) ? message.parts.filter(part => part.type === 'text').map(part => part.text) : []).join('\n');
    if (exportedText !== parsed.text || messages.at(-1).info.finish !== 'stop') throw new FoundryError('MODEL_DRIFT', 'Streamed text or finish reason differs from the independently exported response');
    return {
      text: parsed.text,
      evidence: { ...this.identity, version, sessionId: parsed.sessionId, reportedCost: 0, tokens: session.info.tokens ?? null,
        modelRecord, promptSHA256: sha(prompt), rawOutputSHA256: sha(invocation.stdout), outputSHA256: sha(parsed.text), elapsedMs: invocation.elapsedMs,
        isolation: 'empty host-home view, fresh XDG state, read-only task mount, no credential env, no model tools; host network for free provider',
        evaluationMode: 'product-bridge-smoke; not TUI comparative evidence' }
    };
  }
}
