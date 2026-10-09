// Vocabulary of the R1 billing systems: date styles, status words, per-task flag words. Shared by world.mjs and
// render.mjs (kept separate so the two do not import each other).
// Invoice date style per billing system. ATLAS (order per task from d3, switching at d4+) and TALLY are resolved per task.
export const BASE_STYLE = { BRIGHTDESK: 'MDY', LEDGR: 'DMY_DOT', VENDEX: 'WORDS', KOBO: 'YMD_SLASH', VERITAS: 'ISO', TALLY: 'DMY_DASH_YY' };
// Status words. open and paid are live; void never counts. Per-task flag words are drawn from FLAG_WORDS.
export const STATUS_WORDS = {
  BRIGHTDESK: { open: 'open', paid: 'paid', void: 'void' },
  LEDGR: { open: 'offen', paid: 'bezahlt', void: 'storniert' },
  ATLAS: { open: 'OPEN', paid: 'SETTLED', void: 'CANCELLED' },
  VENDEX: { open: 'still open', paid: 'paid in full', void: 'cancelled, raised in error' },
  KOBO: { open: '未払', paid: '支払済', void: '取消' },
  VERITAS: { open: 'issued', paid: 'settled', void: 'voided' },
  TALLY: { open: 'active', paid: 'closed', void: 'voided' },
};
export const FLAG_WORDS = {
  BRIGHTDESK: ['held', 'batch', 'rebill'], LEDGR: ['Klärung', 'Sammel', 'Prüfung'], ATLAS: ['QUERY', 'HELD', 'BATCH'],
  VENDEX: ['parked', 'routed', 'queued'], KOBO: ['保留', '確認中'], VERITAS: ['batch', 'held', 'replay'], TALLY: ['paused', 'queued'],
};

export const statusWord = inv => (inv.flag ? inv.flag : STATUS_WORDS[inv.system][inv.status]);
export const statusLiveOf = inv => inv.status !== 'void' && !(inv.flag && inv.flagPolarity === 'void');
