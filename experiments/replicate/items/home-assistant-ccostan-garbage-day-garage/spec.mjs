// Frozen constants of the R-bench item home-assistant:CCOSTAN/Home-AssistantConfig/.../garbage_day_garage.yaml#0.
// Changing anything here changes the oracle: bump VERSION and regenerate fixtures/frozen.json (node freeze.mjs).
import { readFileSync } from 'node:fs';

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
export const CONFIG = Object.freeze(read('./fixtures/config.json'));
export const RECORDED = Object.freeze(read('./fixtures/recorded-responses.json'));

// 0.2.0 (2026-10-08, adversarial verification): documented condition scope inside repeat (wed-stop-then-reopen expects the R+180
// announcement), harder wed-flap and wed-external-snooze, button order and typographic quotes no longer judged, last_changed as local ISO.
export const VERSION = '0.2.0';

export const SPEC = Object.freeze({
  // Timing of every judged call must be within this many seconds of the nominal instant.
  toleranceSeconds: 1,
  garbageDays: Object.freeze(['wed', 'sun']),
  debounceSeconds: 20,
  // Seconds after the reminder starts (the instant the push and the inside speech go out).
  announceOffsets: Object.freeze([30, 90, 180]),
  snooze: Object.freeze({ '30m': 1800, '2h': 7200 }),
  ids: Object.freeze({
    group: CONFIG.entities.group,
    timer: CONFIG.entities.snoozeTimer,
    covers: Object.freeze({ large: CONFIG.entities.covers[0], small: CONFIG.entities.covers[1] }),
    snoozeEvent: 'mobile_app_notification_action',
  }),
  buttons: Object.freeze({ '30m': 'Snooze 30m', '2h': 'Snooze 2h' }),
  push: Object.freeze({ title: 'Garbage Day Reminder', who: 'carlo', group: 'Garbage_Reminders', tag: 'garbage_day_reminder', level: 'active' }),
  logbookTopic: 'GARBAGE',
});

// Whitespace-insensitive comparison of user-visible text (the author's template leaves double spaces). Typographic apostrophes and quotes
// read as their ASCII forms (it's / it’s are one text when spoken or shown).
export const norm = s => String(s ?? '').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim();

export const TEXT = Object.freeze({
  // Wednesday also says the recycling goes out; Sunday does not.
  reminder: weekday => norm(`Reminder: it's garbage day. ${weekday === 'wed' ? 'Both recycling and regular garbage go out today.' : ''} Please take the cans to the curb before you leave.`),
  snoozeLog: label => `Garbage reminders snoozed for ${label} from Carlo's phone.`,
  label: { '30m': '30 minutes', '2h': '2 hours' },
});

// Runtime limits of the environment (budgets frozen before any comparative run).
export const LIMITS = Object.freeze({ runsPerScenario: 5000, callsPerRun: 40, wakeHorizonSeconds: 100000 });

// T3 cost target: "self-inflicted work" = sched.set + sched.cancel + ha.get_state + wake-ups delivered (kv is not counted), summed over the
// core scenarios. The cap is the ORIGINAL definition's maximum over seeds 0..19 and difficulties 1..5 on this protocol, times `factor`
// (fixtures/frozen.json, written by `node freeze.mjs` from controls/original.mjs). A solution that polls blows through it.
const frozen = (() => { try { return read('./fixtures/frozen.json'); } catch { return null; } })();
export const T3_COST = Object.freeze({ factor: 1.25, cap: frozen?.cost?.cap ?? Number.POSITIVE_INFINITY, frozen: !!frozen });
