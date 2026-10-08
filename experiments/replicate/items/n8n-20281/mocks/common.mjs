// Shared helpers of the mock services. All mocks are deterministic plain-data state machines: no clock, no randomness, no network.
export const clone = v => (v === undefined ? undefined : structuredClone(v));
export const ok = (status, body) => ({ status, body });
export const fail = (status, code, message) => ({ status, body: { error: code, message } });
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const lower = v => String(v ?? '').trim().toLowerCase();
export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
