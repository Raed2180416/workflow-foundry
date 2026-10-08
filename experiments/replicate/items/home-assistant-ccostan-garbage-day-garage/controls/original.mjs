// The ORIGINAL definition as a control: the author's YAML, read from fixtures/original/ (MIT, redistributable; LICENSE kept next to it),
// parsed by controls/miniyaml.mjs and executed by controls/original-engine.mjs on this item's protocol.
// Also the mutants of that definition (the same YAML with one decision changed), which the oracle must reject.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseYaml } from './miniyaml.mjs';
import { createAutomationHandler } from './original-engine.mjs';

const here = new URL('../', import.meta.url);
export const ORIGINAL = Object.freeze({
  id: 'home-assistant:CCOSTAN/Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml#0',
  url: 'https://github.com/CCOSTAN/Home-AssistantConfig/blob/71ffa6120b8b649508c3ffe312f6d09792c7b37b/config/automation/Speech/garbage_day_garage.yaml',
  revision: 'git 71ffa6120b8b649508c3ffe312f6d09792c7b37b (2026-10-05T21:48:56+00:00)',
  license: 'MIT, Copyright (c) 2018 Carlo Costanzo',
  sha256: 'c7cae208c73ad49d929e18a43bc09b70760a44ec85f81c93118a31b194f0f62b',
  file: new URL('fixtures/original/garbage_day_garage.yaml', here),
  rawPath: '/opt/corpus/home-assistant/git/CCOSTAN__Home-AssistantConfig/config/automation/Speech/garbage_day_garage.yaml',
});

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export function originalText() {
  const text = readFileSync(ORIGINAL.file, 'utf8');
  if (sha256(text) !== ORIGINAL.sha256) throw new Error(`fixtures/original/garbage_day_garage.yaml does not match the pinned sha256 ${ORIGINAL.sha256}`);
  return text;
}
// True when the corpus copy is present and byte-identical to the committed fixture.
export const corpusMatches = () => existsSync(ORIGINAL.rawPath) && sha256(readFileSync(ORIGINAL.rawPath, 'utf8')) === ORIGINAL.sha256;

export function loadOriginal() {
  const doc = parseYaml(originalText());
  if (!Array.isArray(doc) || doc.length !== 1) throw new Error('expected a one-automation YAML list');
  return doc[0];
}
export const makeOriginal = (coverage) => createAutomationHandler(loadOriginal(), { coverage });
// The alternative reading of Home Assistant's condition semantics (see original-engine.mjs); a sensitivity probe, not a control.
export const makeOriginalIterationLocal = () => createAutomationHandler(loadOriginal(), { iterationLocalConditions: true });

// Mutants of the original definition: one decision changed each. The expectation says which core scenarios must fail.
const walk = (node, fn) => { if (Array.isArray(node)) node.forEach(x => walk(x, fn)); else if (node && typeof node === 'object') { fn(node); Object.values(node).forEach(x => walk(x, fn)); } };
const loopOf = a => { let r; walk(a.action, n => { if (n.repeat) r = n.repeat; }); return r; };
export const MUTANTS = [
  { name: 'no-debounce', describe: 'drop `for: 00:00:20` from the state trigger', expectFail: ['wed-flap'],
    mutate: a => { delete a.trigger[0].for; } },
  { name: 'announces-on-any-day', describe: 'delete the weekday condition before the reminder starts and in the loop', expectFail: ['mon-open'],
    mutate: a => { a.action = a.action.filter(x => !(x.condition === 'time')); loopOf(a).sequence = loopOf(a).sequence.filter(x => x.condition !== 'time'); } },
  { name: 'no-door-check-in-loop', describe: 'delete the group.garage_doors state condition inside the repeat', expectFail: ['wed-close-before-first'],
    mutate: a => { const r = loopOf(a); r.sequence = r.sequence.filter(x => !(x.condition === 'state' && x.entity_id === 'group.garage_doors')); } },
  { name: 'no-timer-check-in-loop', describe: 'delete the snooze-timer state condition inside the repeat', expectFail: ['wed-external-snooze'],
    mutate: a => { const r = loopOf(a); r.sequence = r.sequence.filter(x => !(x.condition === 'state' && x.entity_id === 'timer.garbage_reminder_snooze')); } },
  { name: 'mode-single', describe: 'mode: single instead of restart', expectFail: ['wed-reopen-restarts-run'],
    mutate: a => { a.mode = 'single'; } },
  { name: 'delays-as-absolute-offsets', describe: 'announcements at +30, +60, +90 instead of +30, +90, +180', expectFail: ['wed-full', 'sun-full'],
    mutate: a => { walk(a.action, n => { if (n.variables?.reminder_delays) n.variables.reminder_delays = [30, 30, 30]; }); } },
  { name: 'recycling-always', describe: 'drop the Wednesday condition from the message', expectFail: ['sun-full'],
    mutate: a => { walk(a.action, n => { if (n.variables?.reminder_message) n.variables.reminder_message = n.variables.reminder_message.replace("now().strftime('%a') == 'Wed'", 'true'); }); } },
  { name: 'snooze-2h-is-30m', describe: 'the 2 hour button starts the 30 minute duration', expectFail: ['sun-snooze2h'],
    mutate: a => { walk(a.action, n => { if (n.variables?.snooze_duration) n.variables.snooze_duration = "{{ '00:30:00' }}"; }); } },
  { name: 'snooze-not-logged', describe: 'delete the logbook call in the snooze branch', expectFail: ['wed-snooze30-then-expiry'],
    mutate: a => { a.action[0].choose[0].sequence = a.action[0].choose[0].sequence.filter(x => x.service !== 'script.send_to_logbook'); } },
];
export function makeMutant(m) {
  const doc = structuredClone(loadOriginal());
  m.mutate(doc);
  return createAutomationHandler(doc);
}
