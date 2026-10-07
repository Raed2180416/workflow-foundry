// Seeded, platform-independent PRNG for bed generators (mulberry32 over an FNV-1a seed hash).
// Never use Math.random or the wall clock in a generator.
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map(String).join('\u0000')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function rng(...seedParts) {
  let a = hashSeed(...seedParts) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const api = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    float: (lo, hi) => lo + next() * (hi - lo),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p,
    shuffle: list => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    },
    sample: (list, k) => api.shuffle(list).slice(0, k),
    normal: (mu = 0, sigma = 1) => {
      const u = Math.max(next(), 1e-12), v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    fork: label => rng(a, label),
  };
  return api;
}
