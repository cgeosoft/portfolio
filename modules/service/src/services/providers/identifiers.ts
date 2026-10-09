/**
 * Security identifier checks. Both validate the check digit, so a ticker or
 * a word that only looks like an identifier is not taken for one.
 */

/** Value of one identifier character: 0-9 for digits, 10-35 for A-Z. */
function charValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  return -1;
}

/** An ISIN: 2 letters, 9 letters or digits, 1 check digit (Luhn over the expanded digits). */
export function isIsin(value: string): boolean {
  const s = value.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  const digits = Array.from(s, (ch) => String(charValue(ch))).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A CUSIP: 8 letters or digits and 1 check digit. */
export function isCusip(value: string): boolean {
  const s = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}[0-9]$/.test(s) || !/[0-9]/.test(s.slice(0, 8))) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = charValue(s[i]!);
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (sum % 10)) % 10 === Number(s[8]);
}
