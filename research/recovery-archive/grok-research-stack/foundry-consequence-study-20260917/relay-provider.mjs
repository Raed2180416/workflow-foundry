import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { FoundryError } from '../../workflow-foundry/src/data.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

/** Research transport only. Actual candidate authorship occurs in the separate
 * COS worker. File replay does not create another model inference or justify a
 * model-scale, token-cost, OS-isolation, or learned-discovery claim. */
export class CosRelayProvider {
  constructor({ packet, firstRound = 1, timeoutMs = 360000, author = 'worker-5' }) {
    this.packet = packet;
    this.round = firstRound - 1;
    this.timeoutMs = timeoutMs;
    this.identity = Object.freeze({ provider: 'cos-artifact-relay', model: '6', reasoningEffort: 'pro',
      authorAgent: author, modelIdentityBasis: 'Observed COS agents spawn receipt',
      usage: null, billedCost: null, isolation: 'procedural file restriction; not an OS sandbox' });
  }
  async generate({ prompt, signal, deadline }) {
    const round = ++this.round;
    const promptFile = path.join(this.packet, `PROMPT_${round}.txt`);
    if (existsSync(promptFile)) {
      if (readFileSync(promptFile, 'utf8') !== prompt) throw new FoundryError('RELAY_PROMPT_DRIFT', 'Prepared and actual generation prompts differ');
    } else writeFileSync(promptFile, prompt, { flag: 'wx', mode: 0o600 });
    const request = { at: new Date().toISOString(), round, promptSha256: sha(prompt), promptFile,
      provider: this.identity, disclosure: 'Upstream model author sees only this prompt; no hidden evaluator files are relayed.' };
    writeFileSync(path.join(this.packet, `CALL_${round}.json`), JSON.stringify(request, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ stage: 'awaiting-relayed-candidate', round, promptFile }));
    const responseFile = path.join(this.packet, `RESPONSE_${round}.json`);
    const authorFile = path.join(this.packet, `AUTHOR_${round}.json`);
    const stop = Math.min(deadline ?? Infinity, Date.now() + this.timeoutMs);
    while (Date.now() < stop) {
      if (signal?.aborted) throw new FoundryError('GENERATION_CANCELLED', 'Relayed generation cancelled');
      if (existsSync(responseFile) && existsSync(authorFile)) {
        const bytes = readFileSync(responseFile);
        if (bytes.length > 2 * 1024 * 1024) throw new FoundryError('CANDIDATE_SIZE', 'Relayed candidate exceeds two MiB');
        const authorBytes = readFileSync(authorFile);
        const response = { text: bytes.toString('utf8'), evidence: { ...this.identity, round,
          promptSha256: sha(prompt), responseSha256: sha(bytes), authorReceiptSha256: sha(authorBytes),
          responseFile, authorFile, receivedAt: new Date().toISOString(),
          inferenceAccounting: 'One upstream authored candidate; relay read is not a new inference; token usage and billed cost unobserved.' } };
        writeFileSync(path.join(this.packet, `RECEIVED_${round}.json`), JSON.stringify(response.evidence, null, 2), { flag: 'wx', mode: 0o600 });
        return response;
      }
      await sleep(300);
    }
    throw new FoundryError('RELAY_TIMEOUT', 'No complete relayed candidate and authorship receipt arrived within the bounded call');
  }
}
