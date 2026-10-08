// Deterministic draws for the exec family: every choice is a salted hash of a key and a tag, never Math.random or a
// clock, so a plan is a pure function of its key and the order of draws does not matter (a new draw cannot shift
// the others). Shared by the planner, the world and the recipes.
import { createHash } from 'node:crypto';

export const sha = s => createHash('sha256').update(s).digest('hex');
export const hnum = s => parseInt(sha(s).slice(0, 12), 16);
export const unit = s => hnum(s) / 0x1000000000000;

export function makeRnd(key) {
  const u = tag => unit(`${key}|${tag}`);
  const api = {
    key,
    unit: u,
    int: (tag, lo, hi) => lo + Math.floor(u(tag) * (hi - lo + 1)),
    chance: (tag, p) => u(tag) < p,
    pick: (tag, list) => list[Math.floor(u(tag) * list.length)],
    // weighted pick over [[item, weight], ...]
    weighted: (tag, pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = u(tag) * total;
      for (const [item, w] of pairs) { if ((x -= w) < 0) return item; }
      return pairs.at(-1)[0];
    },
    shuffle: (tag, list) => list.map((x, i) => ({ x, h: sha(`${key}|${tag}|${i}`) })).sort((a, b) => (a.h < b.h ? -1 : 1)).map(o => o.x),
    sample: (tag, list, n) => api.shuffle(tag, list).slice(0, n),
    sub: tag => makeRnd(`${key}/${tag}`),
  };
  return api;
}

export const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details) e.details = details; return e; };

// Wilson score interval lower bound for k successes in n trials (z = 1.96, 95% two-sided).
export function wilsonLower(k, n, z = 1.96) {
  if (n === 0) return 0;
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / d);
}
