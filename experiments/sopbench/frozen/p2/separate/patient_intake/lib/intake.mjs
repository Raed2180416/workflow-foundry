// lib/intake.mjs: the plain-code parts of the patient intake SOP. Reads the task's fields into the forms the tools take,
// holds the lifestyle index of SOP 5.2.1, and the fallbacks used when a tool has no record for the patient. Pure functions:
// no tool call, no model.

const NULL_TEXT = new Set(['', 'null', 'nan', 'n/a', 'na', 'nil', 'unknown', 'undefined']);
const NONE_ITEM = new Set([...NULL_TEXT, 'none']);
const pad = n => String(n).padStart(2, '0');

// A task field as trimmed text, or null when it is empty or a null-like word.
export function text(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return NULL_TEXT.has(s.toLowerCase()) ? null : s;
}

// A list field: a real array, a Python-style list string ("['Hip Replacement 2019', 'Asthma']"), or plain text.
// "None" and empty entries are dropped.
export function items(v) {
  let raw;
  if (Array.isArray(v)) raw = v.map(String);
  else if (v == null) raw = [];
  else {
    const s = String(v).trim();
    const quoted = [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]);
    if (quoted.length) raw = quoted;
    else if (/^\[.*\]$/s.test(s)) raw = s.slice(1, -1).split(',');
    else raw = s.split(';');
  }
  return raw.map(x => x.trim()).filter(x => !NONE_ITEM.has(x.toLowerCase()));
}

// The tools reject an empty list, so a patient with no entries is sent as ['None'].
export const listArg = list => (list.length ? list : ['None']);

// A date as YYYY-MM-DD (the tools' format): ISO, M/D/YY, M/D/YYYY, or whatever Date reads; null when unreadable.
export function isoDate(v) {
  const s = text(v);
  if (!s) return null;
  let y, mo, d, m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [, y, mo, d] = m;
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) {
    [, mo, d, y] = m;
    if (y.length === 2) y = String(Number(y) < 70 ? 2000 + Number(y) : 1900 + Number(y));
  } else {
    const t = new Date(s);
    if (Number.isNaN(t.getTime())) return null;
    [y, mo, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  }
  const [yy, mm, dd] = [Number(y), Number(mo), Number(d)];
  if (yy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${pad(mm)}-${pad(dd)}`;
}

// A phone number in the tools' XXX-XXX-XXXX format, or null when it does not hold ten digits.
export function phoneArg(v) {
  const digits = (text(v) ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : null;
}

// The SOP's categories (5.2.1) from free or near-enum text; null when the text names none of them.
export function smokingOf(v) {
  const s = text(v)?.toLowerCase();
  if (!s) return null;
  if (/never|non|^no$|^none$/.test(s)) return 'Never';
  if (/former|ex[\s-]?smoker|quit|past|previous|stopped/.test(s)) return 'Former';
  if (/current|active|yes|daily|smok|cigarette|cigar/.test(s)) return 'Current';
  return null;
}

export function alcoholOf(v) {
  const s = text(v)?.toLowerCase();
  if (!s) return null;
  if (/^(none|never|no|non|0)\b|abstain|don'?t drink|do not drink/.test(s)) return 'None';
  if (/heavy|daily|frequent|high|very/.test(s)) return 'Heavy';
  if (/moderate|regular|weekly|often|several/.test(s)) return 'Moderate';
  if (/occasion|light|rare|social|sometime|weekend|once|seldom/.test(s)) return 'Occasional';
  return null;
}

// Weekly exercise, as the tool's four bands: a number is read first (5 and up is '5+ times'), then the words.
export function exerciseOf(v) {
  const s = text(v)?.toLowerCase();
  if (!s) return null;
  const n = /\d+/.exec(s);
  if (n) {
    const k = Number(n[0]);
    return k === 0 ? 'None' : k <= 2 ? '1-2 times' : k <= 4 ? '3-4 times' : '5+ times';
  }
  if (/none|never|no|sedentary|zero/.test(s)) return 'None';
  if (/once|twice|one|two/.test(s)) return '1-2 times';
  if (/three|four/.test(s)) return '3-4 times';
  if (/five|six|seven|daily|every day/.test(s)) return '5+ times';
  return null;
}

// Insurance type as the tool's enum (Private, Medicare, Medicaid, None); null when the text names none of them.
export function insuranceTypeOf(v) {
  const s = text(v)?.toLowerCase();
  if (!s) return null;
  if (/medicare/.test(s)) return 'Medicare';
  if (/medicaid/.test(s)) return 'Medicaid';
  if (/^(none|uninsured|self[- ]pay|no insurance)$/.test(s)) return 'None';
  if (/private|commercial|employer|group|hmo|ppo|epo|aetna|cigna|humana|blue|united|kaiser|tricare/.test(s)) return 'Private';
  return null;
}

// The task's fields in the forms the sections take. Every value is a string, a list, or null when the task left it out.
export function readIntake(inputs) {
  return {
    patient_id: text(inputs.patient_id),
    insurance_provider: text(inputs.insurance_provider),
    policy_number: text(inputs.policy_number),
    group_number: text(inputs.group_number),
    coverage_start_date: isoDate(inputs.coverage_start_date),
    insurance_type: insuranceTypeOf(inputs.insurance_type),
    smoking_status: smokingOf(inputs.smoking_status),
    alcohol_consumption: alcoholOf(inputs.alcohol_consumption),
    exercise_frequency: exerciseOf(inputs.exercise_frequency),
    previous_surgeries: items(inputs.previous_surgeries),
    chronic_conditions: items(inputs.chronic_conditions),
    preferred_pharmacy_name: text(inputs.preferred_pharmacy_name),
    preferred_pharmacy_address: text(inputs.preferred_pharmacy_address),
    pharmacy_phone: phoneArg(inputs.pharmacy_phone),
  };
}

// SOP 5.2.1 index values (smoking, alcohol, exercise), summed into the aggregate lifestyle score.
export const SMOKING_INDEX = { Never: 0, Former: 1, Current: 2 };
export const ALCOHOL_INDEX = { None: 0, Occasional: 1, Moderate: 2, Heavy: 3 };
export const EXERCISE_INDEX = { '5+ times': -1, '3-4 times': 0, '1-2 times': 1, None: 2 };
export const lifestyleIndex = (smoking, alcohol, exercise) => SMOKING_INDEX[smoking] + ALCOHOL_INDEX[alcohol] + EXERCISE_INDEX[exercise];
// The level the aggregate implies. The procedure does not state the bands; the example rows fix 0-1 as low and 4 as medium,
// so 2-4 is medium and 5 and up is high (the top edge is a guess). Used only when the tool gives no answer.
export const lifestyleBand = score => (score <= 1 ? 'low' : score <= 4 ? 'medium' : 'high');

// Overall risk when the tool has no record: the history size and the lifestyle level, read off the example rows
// (three or more surgeries and conditions, or a high lifestyle level, is high; otherwise low). A guess, flagged where used.
export const overallFallback = (surgeries, conditions, lifestyleLevel) =>
  (surgeries.length + conditions.length >= 3 || lifestyleLevel === 'high' ? 'high' : 'low');

// The tool's answer under its output column when it is one of the allowed values; null for an error or any other answer.
export function answerOf(r, column, allowed) {
  if (!r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return null;
  const v = String(r.value[column] ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}
