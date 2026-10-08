// Number and text formatting the original tools apply, reproduced here once so the reference
// implementation, the .ga emulator and the case generator cannot drift apart.
//
//  * pyFloat   : Python 3 str(float) (Galaxy column_maker "Compute" prints Python values).
//  * javaFloat : Java Double/Float.toString for the plain-decimal range (SnpSift extractFields prints AF).
//  * g14       : C printf "%.14Lg" (datamash prints min/max with it).
//  * pyRound6  : Python round(x, 6): the exact binary value is rounded, exact ties go to even.

// Shortest round-trip digits and decimal exponent of a finite double (digits: string, exp10: value = 0.d1d2.. * 10^exp10).
function shortest(x) {
  const [m, e] = Math.abs(x).toExponential().split('e');
  return { digits: m.replace('.', ''), exp: Number(e) + 1 };
}

export function pyFloat(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const { digits, exp } = shortest(x), sign = x < 0 ? '-' : '';
  const decpt = exp; // value = 0.DIGITS * 10^decpt
  // repr() uses scientific notation when the decimal exponent is < -4 or >= 16.
  if (decpt - 1 < -4 || decpt - 1 >= 16) {
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = decpt - 1;
    return `${sign}${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  let s;
  if (decpt <= 0) s = `0.${'0'.repeat(-decpt)}${digits}`;
  else if (decpt >= digits.length) s = `${digits}${'0'.repeat(decpt - digits.length)}.0`;
  else s = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  return sign + s;
}

// Java Double.toString: plain decimal for 1e-3 <= |x| < 1e7, always with a fractional digit.
export function javaFloat(x) {
  if (!Number.isFinite(x)) throw new Error(`javaFloat: not finite: ${x}`);
  if (x === 0) return '0.0';
  const a = Math.abs(x);
  if (a < 1e-3 || a >= 1e7) throw new Error(`javaFloat: ${x} is outside the plain-decimal range this harness models`);
  const s = String(x);
  return s.includes('.') ? s : `${s}.0`;
}

// "%.14Lg"
export function g14(x) {
  if (x === 0) return '0';
  const P = 14;
  const [m, e] = x.toExponential(P - 1).split('e');
  const exp = Number(e);
  if (exp < -4 || exp >= P) {
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    return `${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  let s = x.toFixed(Math.max(0, P - 1 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// Python round(x, 6) for a double: correctly rounded from the exact binary value, ties to even.
export function pyRound6(x) {
  const exact = Math.abs(x).toFixed(100); // exact for every double >= 1e-6 (<= ~75 fractional digits)
  const [ip, fp] = exact.split('.');
  const keep = fp.slice(0, 6), rest = fp.slice(6);
  let n = BigInt(ip + keep);
  const half = '5' + '0'.repeat(rest.length - 1);
  if (rest > half || (rest === half && n % 2n === 1n)) n += 1n;
  const s = n.toString().padStart(7, '0');
  const out = Number(`${s.slice(0, -6)}.${s.slice(-6)}`);
  return x < 0 ? -out : out;
}

// Galaxy sanitises '|' in a text parameter to 'X' (visible in the shipped FILTER values).
export const galaxySanitize = s => s.replaceAll('|', 'X');
