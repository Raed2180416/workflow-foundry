// Usage-meter capture (PLAN §5.1 "meter", §9.1): every breadth session runs with `--output-format stream-json`; each
// `rate_limit_event` (5-hour and 7-day utilisation of the account, one meter for all models, resolution 0.01;
// research/jit-20261008/analysis/quota-meter/README.md) is journaled with the session it came from.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The meter reading of one stream event, or null. */
export function meterReading(event) {
  if (event?.type !== 'rate_limit_event') return null;
  const info = event.rate_limit_info ?? {};
  const w = info.unifiedWindows ?? {};
  const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    status: info.status ?? null, rateLimitType: info.rateLimitType ?? null, resetsAt: num(info.resetsAt),
    fiveHour: num(w.five_hour?.utilization), fiveHourResetsAt: num(w.five_hour?.resetsAt),
    sevenDay: num(w.seven_day?.utilization), sevenDayResetsAt: num(w.seven_day?.resetsAt),
    isUsingOverage: info.isUsingOverage ?? null, overageStatus: info.overageStatus ?? null,
    // every other window the account returns (per-model weekly windows, if a plan has them), kept verbatim
    otherWindows: Object.fromEntries(Object.entries(w).filter(([k]) => !['five_hour', 'seven_day'].includes(k))),
  };
}

/** A journal of meter readings (JSON lines). */
export function meterJournal(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  return {
    file,
    record(reading, ctx = {}) { appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...ctx, ...reading }) + '\n'); },
  };
}

export function readJournal(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** PLAN §9.1 rule 2: a wave starts only at 5h <= 0.60 and 7d <= 0.80; no new session at 5h >= 0.80. */
export const START_GATE = Object.freeze({ waveFiveHour: 0.60, waveSevenDay: 0.80, sessionFiveHour: 0.80 });
export function gate(last, { wave = false } = {}) {
  if (!last || last.fiveHour === null) return { ok: true, reason: 'no reading yet (the first session takes one)' };
  if (last.status && last.status !== 'allowed') return { ok: false, reason: `meter status ${last.status}` };
  if (wave && (last.fiveHour > START_GATE.waveFiveHour || (last.sevenDay ?? 0) > START_GATE.waveSevenDay)) return { ok: false, reason: `wave gate: 5h ${last.fiveHour}, 7d ${last.sevenDay}` };
  if (last.fiveHour >= START_GATE.sessionFiveHour) return { ok: false, reason: `session gate: 5h ${last.fiveHour}` };
  return { ok: true, reason: null };
}

/** Dose test summary: meter movement against list-price spend between the first and last reading of a run. */
export function doseSummary(readings, spentUsd) {
  const r = readings.filter(x => x.fiveHour !== null);
  if (r.length < 2) return { readings: r.length, spentUsd, fiveHourDelta: null, sevenDayDelta: null, usdPerFiveHourTick: null, usdPerSevenDayTick: null };
  const d5 = Math.round((r.at(-1).fiveHour - r[0].fiveHour) * 100) / 100, d7 = Math.round(((r.at(-1).sevenDay ?? 0) - (r[0].sevenDay ?? 0)) * 100) / 100;
  return { readings: r.length, spentUsd, fiveHourDelta: d5, sevenDayDelta: d7,
    // ticks are 0.01; attributable only on a quiet account (other sessions move the same meter)
    usdPerFiveHourTick: d5 > 0 ? spentUsd / (d5 * 100) : null, usdPerSevenDayTick: d7 > 0 ? spentUsd / (d7 * 100) : null };
}
