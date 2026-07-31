/**
 * Word counting. Shared so the server's stored count and anything the client
 * shows optimistically agree exactly.
 *
 * Counts whitespace-separated runs containing at least one letter or digit, so
 * a lone em dash or a row of asterisks doesn't inflate the count. Hyphenated and
 * apostrophised words count once, which is what a writer expects and what most
 * publishers' counts do.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const token of text.split(/\s+/)) {
    if (token && /[\p{L}\p{N}]/u.test(token)) count += 1;
  }
  return count;
}
