/**
 * A passage cut to length without being flattened.
 *
 * The obvious way to trim prose to a word count is to split on whitespace and
 * join the first n back together with spaces, and it destroys the thing being
 * shown: paragraph breaks are whitespace. Every exemplar handed to the model
 * arrived as one unbroken block, so it learned that this writer does not break
 * paragraphs — and wrote back the same way. A sample is an instruction, and a
 * sample with its shape removed is a wrong one.
 *
 * So the cut is made at paragraph boundaries where possible, and inside a
 * paragraph only when a single one is longer than the whole budget.
 */
export function excerpt(text: string, words: number): string {
  const paragraphs = text.trim().split(/\n{2,}/);
  const kept: string[] = [];
  let spent = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const length = trimmed.split(/\s+/).length;

    if (spent + length <= words) {
      kept.push(trimmed);
      spent += length;
      continue;
    }

    // Nothing kept yet and this one alone overruns: take part of it rather
    // than returning nothing at all.
    if (kept.length === 0) {
      kept.push(`${trimmed.split(/\s+/).slice(0, words).join(" ")}…`);
      spent = words;
    }
    break;
  }

  const out = kept.join("\n\n");
  return spent < countWords(text) ? `${out}\n\n…` : out;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
