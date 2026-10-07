#!/usr/bin/env node
// Generates the bundled smoke dataset (deterministic; synthetic support tickets in Kev's
// "By Hand" JSONL format). It exists to prove the fine-tune path works end to end on the laptop
// GPU in about two minutes; it measures nothing about model quality.
//   node bridge/laptop/smoke/make-toy.mjs   -> toy-train.jsonl (64) and toy-heldout.jsonl (16)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let seed = 20261007;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = xs => xs[Math.floor(rand() * xs.length)];

const ISSUES = {
  billing: [['Charged twice', 'I see two charges for order #{n}. Please refund one.'], ['Wrong amount', 'My invoice {n} shows more than the price on the website.'], ['Refund missing', 'The refund for order #{n} never reached my card.'], ['Card declined', 'My card was declined but the money left my account for order #{n}.']],
  shipping: [['Late parcel', 'Order #{n} was due last week and has not arrived.'], ['Lost package', 'Tracking for #{n} has not moved in ten days.'], ['Wrong address', 'Order #{n} went to my old address.'], ['Damaged box', 'Parcel #{n} arrived crushed and the item is broken.']],
  access: [['Cannot log in', 'The password reset email for account {n} never arrives.'], ['Locked out', 'My account {n} is locked after two attempts.'], ['2FA broken', 'The code for account {n} is always rejected.'], ['Email change', 'I cannot change the email on account {n}.']]
};
const ANGRY = ['This is unacceptable.', 'I am furious and want this fixed now.', 'Third time I write about this!', 'Your service is a disgrace.'];
const CALM = ['Thanks for your help.', 'No rush, whenever you can.', 'Kind regards.', 'Appreciate it.'];
const URGENT = ['I need this today.', 'It is blocking my work right now.', 'Please treat this as urgent.'];

function record() {
  const team = pick(Object.keys(ISSUES));
  const [subject, body] = pick(ISSUES[team]);
  const angry = rand() < 0.4;
  const urgent = rand() < 0.35;
  const priority = urgent ? 2 : angry ? 1 : rand() < 0.5 ? 0 : 1;
  const text = [body.replace('{n}', String(1000 + Math.floor(rand() * 9000))), angry ? pick(ANGRY) : pick(CALM), urgent ? pick(URGENT) : ''].filter(Boolean).join(' ');
  return {
    state: { subject, body: text },
    questions: {
      team: { type: 'choice', instructions: 'Which team should handle this ticket?', criteria: { billing: 'Payments and refunds', shipping: 'Delivery problems', access: 'Login and account access' }, label: team },
      angry: { type: 'noul', instructions: 'Is the customer angry?', label: angry },
      priority: { type: 'score', instructions: 'How urgent is this ticket?', criteria: ['low', 'normal', 'high'], label: priority }
    }
  };
}

const rows = Array.from({ length: 80 }, record);
fs.writeFileSync(path.join(HERE, 'toy-train.jsonl'), rows.slice(0, 64).map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(HERE, 'toy-heldout.jsonl'), rows.slice(64).map(r => JSON.stringify(r)).join('\n') + '\n');
console.log('wrote toy-train.jsonl (64) and toy-heldout.jsonl (16)');
