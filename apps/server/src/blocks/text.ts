/**
 * Plain text of a ProseMirror document, with its paragraphs still in it.
 *
 * This began as a helper for word counting and search, where a space between
 * paragraphs is as good as anything — and it joined them with one. Then
 * everything else started reading the same field, and a space is not as good as
 * anything to any of them.
 *
 * What it cost, in the order it hurt. The style measurements split paragraphs
 * on a blank line, found none, and measured every section as a single paragraph
 * — so "paragraph length" was reporting section length, four times too large on
 * a short section and a hundred times too large on a chapter, and the writer's
 * marker sat off the end of a scale built from novels that average thirty. The
 * reading walk sent the model a wall of text with no breaks in it. And the
 * exemplars offered to the model as "their own prose, verbatim, this is what in
 * my voice means" arrived with the paragraphing stripped out, which is a poor
 * way to teach anyone how a writer sets a scene.
 *
 * Blank lines now, because that is what marks a paragraph everywhere else in
 * this application: in what the model is told to write, in what the importer
 * accepts, and in what the extractor splits on.
 *
 * Inline children still join with nothing. A paragraph broken into runs by a
 * bold word is one paragraph, and putting a space at every mark boundary would
 * open a gap in the middle of a sentence.
 */
export function extractText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { type?: string; text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";

  // Told apart by what the children are rather than by a list of node types:
  // anything holding text is inline, anything holding blocks is not, and a
  // schema that gains a node tomorrow needs no entry here.
  const inline = node.content.some(
    (child) => !!child && typeof child === "object" && typeof (child as { text?: unknown }).text === "string",
  );
  return node.content.map((child) => extractText(child)).join(inline ? "" : "\n\n");
}
