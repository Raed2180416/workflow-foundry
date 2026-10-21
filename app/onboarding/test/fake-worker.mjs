// A scripted stand-in for the Mercury child process (no model, no network): it proves the key arrived in its environment and
// answers like a builder that needs one answer. Used by app/onboarding/test/worker.test.mjs.
import { createHash } from 'node:crypto';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { args } = JSON.parse(input);
const key = process.env.INCEPTION_API_KEY ?? '';
const envNames = Object.keys(process.env).sort();
process.stdout.write(JSON.stringify({ result: { status: 'needs_answers', builder: 'scripted-model-builder', template: 'invoice-chase',
  questions: [{ id: 'summaryTo', slot: 'summaryTo', question: 'Which e-mail address should get the summary?', why: 'test' }],
  understood: { request: args.request }, keySha: createHash('sha256').update(key).digest('hex'), envNames } }));
