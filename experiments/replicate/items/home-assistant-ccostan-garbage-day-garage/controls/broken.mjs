// Deliberately broken controls. Each is the faithful reference with ONE decision changed (a plausible misreading of the job or of the
// original), or a trivial solution. The oracle must reject every one of them, and `expectFail` names scenarios it must reject them on.
// T3-only controls pass the core scenarios; they exist to show the reliability probes and the cost target have teeth.
import { driveSync } from '../env.mjs';
import { rng } from '../../../../../beds/lib/rng.mjs';
import { makeFaithful } from './reference.mjs';

const variant = (name, describe, options, expectFail) => ({ name, describe, expectFail, make: task => driveSync(task, makeFaithful(options)) });

export const BROKEN = [
  { name: 'empty', describe: 'an empty episode record: the solver never answered', expectFail: ['wed-full', 'sun-full'], make: () => ({ actions: [] }) },
  { name: 'do-nothing', describe: 'a handler that ends every event without a single call (passes only the two scenarios where nothing should happen)', expectFail: ['wed-full', 'sun-full', 'wed-snooze30-then-expiry', 'sun-snooze2h'], make: task => driveSync(task, () => () => {}) },
  { name: 'shuffled-or-corrupted', describe: 'a correct episode with its actions shuffled (seeded), so calls land in the wrong runs', expectFail: ['wed-full'],
    make: task => { const ep = driveSync(task, makeFaithful()); return { actions: rng('ha-garbage-shuffle', task.seed, task.split).shuffle(ep.actions) }; } },
  variant('plausible-but-wrong', 'treats the delay list [30, 60, 90] as offsets from the start (+30, +60, +90) instead of cumulative (+30, +90, +180)', { offsets: [30, 60, 90] }, ['wed-full', 'sun-full']),
  variant('no-debounce', 'starts the reminder the moment the door opens (no 20 s hold)', { debounce: 0 }, ['wed-flap', 'wed-full']),
  variant('weekday-ignored', 'no weekday check anywhere: reminds on every day', { weekdayRule: 'never', loopWeekday: false }, ['mon-open']),
  variant('weekday-at-door-open', 'judges the weekday when the door opened instead of when the reminder would start', { weekdayRule: 'at-open' }, ['tue-midnight-starts-wed']),
  variant('no-weekday-recheck-in-loop', 'checks the weekday only at the start, so a sequence runs on past midnight', { loopWeekday: false }, ['wed-midnight-ends-sequence']),
  variant('no-door-recheck', 'announces without checking that the door is still open', { loopDoor: false }, ['wed-close-before-first', 'wed-stop-then-reopen']),
  variant('no-timer-recheck', 'does not look at the snooze timer between announcements', { loopTimer: false }, ['wed-external-snooze']),
  variant('no-snooze-gate-at-start', 'starts a reminder even while the snooze timer is running', { startTimerCheck: false }, ['wed-snooze30-then-expiry', 'sun-snooze2h', 'wed-snooze-after-run-ended']),
  variant('skip-instead-of-stop', 'a failed check skips that announcement but the sequence carries on (the original ends the whole run)', { stopOnFail: false }, ['wed-stop-then-reopen']),
  variant('no-restart', 'a new reminder does not replace the old sequence: both keep announcing', { restartKills: false }, ['wed-reopen-restarts-run']),
  variant('single-mode', 'a new reminder is ignored while an older sequence is waiting (mode single)', { singleMode: true }, ['wed-reopen-restarts-run']),
  variant('snooze-ignored-by-sequence', 'the snooze tap neither cancels the sequence nor does the sequence look at the timer', { snoozeKills: false, loopTimer: false }, ['wed-snooze30-then-expiry', 'sun-snooze2h']),
  variant('snooze-without-timer', 'logs the snooze but never starts the timer', { snoozeStartsTimer: false }, ['wed-snooze30-then-expiry', 'sun-snooze2h', 'wed-snooze-after-run-ended']),
  variant('snooze-without-logbook', 'starts the timer but writes no logbook entry', { logbook: false }, ['wed-snooze30-then-expiry', 'sun-snooze2h']),
  variant('snooze-always-30m', 'both buttons start the 30 minute timer', { snoozeSeconds: { '30m': 1800, '2h': 1800 } }, ['sun-snooze2h']),
  variant('any-action-snoozes', 'every notification action from any app is taken as Snooze 30m', { actionMatch: 'any' }, ['wed-foreign-phone-action']),
  variant('prefix-action-snoozes', 'any action starting with SNOOZE_GARBAGE_REMINDERS is a snooze (the near-miss SNOOZE_GARBAGE_REMINDERS_1H starts the 30 minute timer)', { actionMatch: 'prefix' }, ['wed-foreign-phone-action']),
  variant('recycling-always', 'the message mentions recycling every day', { message: 'always-recycling' }, ['sun-full']),
  variant('recycling-never', 'the message never mentions recycling', { message: 'never-recycling' }, ['wed-full']),
  variant('no-push', 'no phone push', { push: false }, ['wed-full', 'sun-full']),
  variant('no-inside-speech', 'no inside speech', { speech: false }, ['wed-full', 'sun-full']),
  variant('no-announcements', 'no Alexa announcements', { announce: false }, ['wed-full', 'sun-full']),
];

// Pass the core scenarios, fail the T3 target.
export const T3_ONLY = [
  variant('abort-on-first-failure', 'the original behaviour: the first failed service call ends the whole sequence (this is the faithful transcription)', {}, ['p1-speech-outage', 'p2-first-announcement-outage', 'p3-push-outage', 'p4-alexa-down-then-up']),
  { name: 'polling', describe: 'correct effects, but waits by polling once a second instead of scheduling the exact instants: far over the cost target', expectFail: [], expectCostFail: true,
    make: task => driveSync(task, makeFaithful({ abortOnError: false, trackDoor: true, polling: 1 })) },
];
