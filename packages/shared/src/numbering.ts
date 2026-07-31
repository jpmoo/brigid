import type { NumberFormat } from "./variables.js";

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  let rest = n;
  let out = "";
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/**
 * "Chapter Seventeen" is as ordinary in print as "Chapter 17", so spelled-out
 * numbering is a first-class format rather than something the writer types by
 * hand. Covers 0–999, which is past any realistic chapter count; beyond that it
 * falls back to digits rather than inventing prose.
 */
function toWords(n: number): string {
  if (n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)] ?? "";
    const ones = n % 10;
    return ones === 0 ? tens : `${tens}-${ONES[ones] ?? ""}`;
  }
  const hundreds = `${ONES[Math.floor(n / 100)] ?? ""} Hundred`;
  const rest = n % 100;
  return rest === 0 ? hundreds : `${hundreds} ${toWords(rest)}`;
}

export function formatNumber(value: number, format: NumberFormat | undefined): string {
  switch (format) {
    case "roman-upper":
      return toRoman(value);
    case "roman-lower":
      return toRoman(value).toLowerCase();
    case "words-title":
      return toWords(value);
    case "words-upper":
      return toWords(value).toUpperCase();
    case "arabic":
    case undefined:
      return String(value);
    default:
      return String(value);
  }
}
