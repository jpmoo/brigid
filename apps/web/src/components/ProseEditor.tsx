import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, Quote, Redo2, SpellCheck, Underline, Undo2 } from "lucide-react";
import {
  asProseDoc,
  autocorrectKeystroke,
  hasMark,
  normalizeProse,
  proseFromParagraphs,
  proseToText,
} from "@brigid/shared";
import type { ProseDoc, ProseText } from "@brigid/shared";
import { words } from "../spelling.js";
import type { Speller } from "../spelling.js";

/**
 * Editing a block's prose, in the manuscript, where it will be read.
 *
 * Deliberately narrow. Bold and italic are marks on the words themselves and
 * belong to whoever is writing the sentence; face, size, spacing, indent and
 * alignment belong to the block's format and the manuscript's typography, and
 * are not offered here at all. A writer able to set the line spacing of one
 * paragraph ends up with a manuscript no format can straighten out.
 *
 * The element is uncontrolled: React renders it once and then keeps its hands
 * off. A controlled contenteditable fights the caret on every keystroke, and
 * the caret always loses. The DOM is read back into the model when something
 * happens that warrants it.
 */

const ZWSP = "​";

/**
 * How far back undo reaches. Deep on purpose: a writer who rewrites a page and
 * then wants the original back should get it, and a snapshot of a block's prose
 * is a few tens of kilobytes at worst.
 */
const HISTORY_DEPTH = 500;

/**
 * Our own clipboard flavour, carried beside the plain text.
 *
 * Copying a bold passage and pasting it back has to stay bold, and the only
 * thing that survives a round trip through the system clipboard intact is what
 * we put there ourselves. The browser's own HTML would come back carrying the
 * spell-check spans and whatever styles the page had, which is why paste from
 * elsewhere is flattened — but text copied from Brigid keeps its marks.
 */
const PROSE_FLAVOUR = "application/x-brigid-prose";

// --- The model, in the DOM and back -------------------------------------
//
// docToHtml, htmlToDoc, the caret helpers and textBeforeCaret are exported so
// they can be driven in a real browser: the round trip, the caret's survival
// across a rebuild, and what a quote sees behind it are the things most likely
// to break here, and none can be tested without a live DOM and a live
// selection.

function runsToHtml(runs: ProseText[], speller: Speller | null): string {
  if (runs.length === 0) return "<br>";
  return runs
    .map((run) => {
      const inner = speller ? markMisspellings(run.text, speller) : escapeHtml(run.text);
      const underlined = hasMark(run, "underline") ? `<u>${inner}</u>` : inner;
      const em = hasMark(run, "em") ? `<em>${underlined}</em>` : underlined;
      return hasMark(run, "strong") ? `<strong>${em}</strong>` : em;
    })
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Wraps what the checker doesn't recognise.
 *
 * The wrapper is a plain inline span, so typing through one behaves like typing
 * through any other styled run — the caret doesn't get trapped and the text
 * isn't re-ordered. It is re-derived from scratch on each pass rather than
 * patched, which is why the pass only runs on leaving a word.
 */
function markMisspellings(text: string, speller: Speller): string {
  let out = "";
  let from = 0;
  for (const { word, at } of words(text)) {
    if (speller.correct(word)) continue;
    out += escapeHtml(text.slice(from, at));
    out += `<span class="misspelled" data-word="${escapeHtml(word)}">${escapeHtml(word)}</span>`;
    from = at + word.length;
  }
  out += escapeHtml(text.slice(from));
  return out;
}

/**
 * How the manuscript sets its paragraphs: the first-line indent, and whether the
 * opening one runs flush.
 *
 * The editor takes the same class and the same indent as the rendered
 * paragraphs it replaces. Without it, clicking into a block reflowed every line
 * — the indent vanished and the text shifted under the caret that had just been
 * placed by the click.
 */
export interface ProseLayout {
  /** A CSS length, or undefined when the mode sets no indent. */
  indent?: string | undefined;
  /** False when the block's break says its opening paragraph runs flush. */
  indentFirst?: boolean | undefined;
}

function paragraphAttrs(
  index: number,
  quoted: boolean,
  layout: ProseLayout | undefined,
): string {
  // The clipboard asks for bare paragraphs, but a blockquote has to survive a
  // copy, so that much is written either way.
  const quote = quoted ? ' data-blockquote="1"' : "";
  if (!layout) return quote;
  // A quoted paragraph is inset as a whole and never takes a first-line indent.
  const flush = quoted || (index === 0 && layout.indentFirst === false);
  const indent = !flush && layout.indent ? ` style="text-indent:${layout.indent}"` : "";
  const classes = ["prose", flush && !quoted ? "flush" : "", quoted ? "blockquote" : ""]
    .filter(Boolean)
    .join(" ");
  return ` class="${classes}"${indent}${quote}`;
}

export function docToHtml(
  doc: ProseDoc,
  speller: Speller | null,
  layout?: ProseLayout,
): string {
  if (doc.content.length === 0) return `<p${paragraphAttrs(0, false, layout)}><br></p>`;
  return doc.content
    .map(
      (p, i) =>
        `<p${paragraphAttrs(i, p.blockquote === true, layout)}>` +
        `${runsToHtml(p.content ?? [], speller)}</p>`,
    )
    .join("");
}

/** Our own clipboard flavour, or null if it isn't ours or isn't readable. */
function readFlavour(raw: string): ProseDoc | null {
  try {
    return asProseDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Reads the element back into the model, ignoring the decoration spans. */
export function htmlToDoc(root: HTMLElement): ProseDoc {
  const paragraphs: ProseDoc["content"] = [];

  const readParagraph = (node: Node): ProseText[] => {
    const runs: ProseText[] = [];
    const walk = (current: Node, strong: boolean, em: boolean, underline: boolean) => {
      if (current.nodeType === Node.TEXT_NODE) {
        const text = (current.textContent ?? "").replace(new RegExp(ZWSP, "g"), "");
        if (!text) return;
        const marks = [
          ...(strong ? [{ type: "strong" as const }] : []),
          ...(em ? [{ type: "em" as const }] : []),
          ...(underline ? [{ type: "underline" as const }] : []),
        ];
        runs.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
        return;
      }
      if (current.nodeType !== Node.ELEMENT_NODE) return;
      const el = current as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") return;
      const nextStrong = strong || tag === "STRONG" || tag === "B" || isBold(el);
      const nextEm = em || tag === "EM" || tag === "I" || isItalic(el);
      const nextUnderline = underline || tag === "U" || isUnderlined(el);
      for (const child of Array.from(el.childNodes)) walk(child, nextStrong, nextEm, nextUnderline);
    };
    for (const child of Array.from(node.childNodes)) walk(child, false, false, false);
    return runs;
  };

  // A paste, or the browser's own idea of a line, can leave bare text and <br>
  // among the paragraphs. Anything not in a <p> becomes one.
  let loose: ProseText[] = [];
  const flush = () => {
    if (loose.length === 0) return;
    paragraphs.push({ type: "paragraph", content: loose });
    loose = [];
  };

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === "P") {
      flush();
      const runs = readParagraph(child);
      const quoted = (child as HTMLElement).dataset.blockquote === "1";
      paragraphs.push({
        type: "paragraph",
        ...(runs.length ? { content: runs } : {}),
        ...(quoted ? { blockquote: true } : {}),
      });
    } else if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === "BR") {
      flush();
      paragraphs.push({ type: "paragraph" });
    } else {
      const text = (child.textContent ?? "").replace(new RegExp(ZWSP, "g"), "");
      if (text) loose.push({ type: "text", text });
    }
  }
  flush();

  return normalizeProse({ type: "doc", content: paragraphs });
}

// execCommand and pasted content both produce inline styles rather than tags.
function isBold(el: HTMLElement): boolean {
  const weight = el.style.fontWeight;
  return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

function isItalic(el: HTMLElement): boolean {
  return el.style.fontStyle === "italic";
}

function isUnderlined(el: HTMLElement): boolean {
  // Not `includes`: line-through and overline also live in this property, and
  // neither of them is an underline.
  return /\bunderline\b/.test(el.style.textDecoration || el.style.textDecorationLine);
}

// --- The caret, as a character offset -----------------------------------

/**
 * Where the caret is, counted in characters from the start, with paragraph
 * boundaries counting as one.
 *
 * Redecorating rebuilds the element's HTML, which destroys every node the
 * selection referred to. An offset survives that; a node reference does not.
 */
export function offsetOfPosition(
  root: HTMLElement,
  container: Node,
  within: number,
): number | null {
  if (!root.contains(container)) return null;

  let offset = 0;
  let found = false;

  const walk = (node: Node) => {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === container) {
        offset += within;
        found = true;
        return;
      }
      offset += (node.textContent ?? "").length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el !== root && el.tagName === "P" && el !== root.firstChild) offset += 1;
    if (node === container) {
      // The position sits between children rather than inside a text node.
      for (let i = 0; i < within; i += 1) {
        const child = node.childNodes[i];
        if (child) offset += (child.textContent ?? "").length;
      }
      found = true;
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };

  for (const child of Array.from(root.childNodes)) walk(child);
  return found ? offset : null;
}

export function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return offsetOfPosition(root, range.startContainer, range.startOffset);
}

/**
 * The character a point on screen falls on.
 *
 * Used to carry the caret across the swap from the rendered manuscript to the
 * editor: a click lands on read-only paragraphs, which are then replaced, so
 * the position has to survive as an offset rather than as a node. Counted the
 * same way as the caret, so the two are the same currency.
 *
 * The two spellings of the same API are both needed — Chrome and Firefox have
 * caretPositionFromPoint, WebKit has caretRangeFromPoint.
 */
export function offsetOfPoint(root: HTMLElement, x: number, y: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return offsetOfPosition(root, position.offsetNode, position.offset) ?? 0;

  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return offsetOfPosition(root, range.startContainer, range.startOffset) ?? 0;

  return 0;
}

export function setCaret(root: HTMLElement, offset: number): void {
  let remaining = offset;
  let target: { node: Node; at: number } | null = null;

  const walk = (node: Node, isFirstParagraph: boolean) => {
    if (target) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? "").length;
      if (remaining <= length) {
        target = { node, at: remaining };
        return;
      }
      remaining -= length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "P" && !isFirstParagraph) {
      if (remaining === 0) {
        target = { node: el, at: 0 };
        return;
      }
      remaining -= 1;
    }
    for (const child of Array.from(el.childNodes)) walk(child, isFirstParagraph);
    // An empty paragraph holds only a <br>; the caret goes in the paragraph.
    if (!target && el.tagName === "P" && remaining === 0 && !el.textContent) {
      target = { node: el, at: 0 };
    }
  };

  const children = Array.from(root.childNodes);
  children.forEach((child, i) => walk(child, i === 0));

  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  if (target) {
    range.setStart((target as { node: Node; at: number }).node, (target as { node: Node; at: number }).at);
  } else {
    // Past the end: the very end.
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// --- Autocorrect ---------------------------------------------------------

/**
 * What a quote opens after.
 *
 * Dashes are deliberately absent, unlike in the renderer. Interrupted dialogue
 * — «"Wait—"» — is the overwhelmingly common case in fiction, and here there is
 * no lookahead to tell it from a dash that introduces speech: the next
 * character hasn't been typed yet. So a quote after a dash closes.
 */
/**
 * The text before the caret, within its own paragraph.
 *
 * Scoped to the paragraph on purpose: a range reaching back to the start of the
 * block renders a paragraph break as nothing at all, so the last character of
 * the previous paragraph would look like the character before the caret, and a
 * quote opening a new line would be read as closing the one above it. Bounded
 * this way, the start of a paragraph correctly has nothing before it.
 */
export function textBeforeCaret(root: HTMLElement, range: Range): string {
  const node = range.startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const paragraph = element?.closest("p");
  const scope = paragraph && root.contains(paragraph) ? paragraph : root;

  const before = document.createRange();
  before.selectNodeContents(scope);
  try {
    before.setEnd(node, range.startOffset);
  } catch {
    return "";
  }
  return before.toString();
}

/** Characters that end a word, and so are worth re-checking the spelling on. */
const BOUNDARY = /[\s.,;:!?)\]}"”'’—–…]/;

// --- Where the suggestions go --------------------------------------------

interface SpellMenu {
  word: string;
  left: number;
  top?: number;
  /** Set instead of `top` when the menu opens upward. */
  bottom?: number;
  maxHeight: number;
}

const MENU_WIDTH = 210;
const MENU_GAP = 4;
const VIEWPORT_EDGE = 8;
/** Below this there isn't room for suggestions worth reading. */
const MENU_MIN = 120;

/**
 * The menu goes under the word, unless the word is near the foot of the screen
 * — which, in a manuscript being read from the top down, it very often is. Then
 * it opens upward instead, and either way it is capped to the room available
 * and scrolls inside it rather than running off the edge.
 */
export function placeSpellMenu(word: string, box: DOMRect): SpellMenu {
  const below = window.innerHeight - box.bottom - MENU_GAP - VIEWPORT_EDGE;
  const above = box.top - MENU_GAP - VIEWPORT_EDGE;
  const upward = below < MENU_MIN && above > below;

  const room = Math.max(MENU_MIN, upward ? above : below);
  const left = Math.max(
    VIEWPORT_EDGE,
    Math.min(box.left, window.innerWidth - MENU_WIDTH - VIEWPORT_EDGE),
  );

  return {
    word,
    left,
    maxHeight: Math.min(300, room),
    // Anchored to whichever edge it grows from, so a short list still sits
    // against the word rather than floating away from it.
    ...(upward
      ? { bottom: window.innerHeight - box.top + MENU_GAP }
      : { top: box.bottom + MENU_GAP }),
  };
}

// --- The component -------------------------------------------------------

export interface ProseEditorProps {
  blockId: string;
  /**
   * Where the click that opened the editor landed, counted in characters. The
   * rendered paragraphs are replaced by this component, so the position has to
   * cross the swap as an offset rather than as a node.
   */
  initialCaret: number;
  /** The paragraph setting to match, so clicking in doesn't reflow the block. */
  layout: ProseLayout;
  content: Record<string, unknown> | null;
  /** Fallback for blocks whose prose predates the structured document. */
  fallbackText: string;
  speller: Speller | null;
  /** Whether checking is switched on, which is not the same as ready. */
  spellcheckWanted: boolean;
  smartPunctuation: boolean;
  onSave: (doc: ProseDoc) => void;
  onDone: () => void;
  onAddWord: (word: string) => void;
  onIgnoreWord: (word: string) => void;
}

export function ProseEditor({
  blockId,
  initialCaret,
  layout,
  content,
  fallbackText,
  speller,
  spellcheckWanted,
  smartPunctuation,
  onSave,
  onDone,
  onAddWord,
  onIgnoreWord,
}: ProseEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Held in a ref: the rebuild functions are memoised on the checker, and the
  // layout must not be a reason to remake them.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /**
   * Undo, kept here rather than left to the browser.
   *
   * Re-underlining rebuilds the element from the model, and rebuilding an
   * element empties its native undo stack — so the browser's own undo would
   * reach back only as far as the last word the writer finished, which is worse
   * than none at all. Snapshots of the model, with the caret, are cheap: a
   * chapter of prose is a few tens of kilobytes and the depth is what matters.
   */
  const history = useRef<{ doc: ProseDoc; caret: number }[]>([]);
  const historyAt = useRef(-1);
  /** Set while an undo is being applied, so it isn't recorded as a new edit. */
  const restoring = useRef(false);
  const [marks, setMarks] = useState({ strong: false, em: false, underline: false });
  const [quoted, setQuoted] = useState(false);
  const [menu, setMenu] = useState<SpellMenu | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Rendered once per block. Later renders would take the caret with them.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doc =
      asProseDoc(content) ??
      proseFromParagraphs(fallbackText ? fallbackText.split(/\n{2,}/) : [""]);
    el.innerHTML = docToHtml(doc, speller, layoutRef.current);
    el.focus();
    setCaret(el, initialCaret);
    // Only when the block changes: re-running this on every keystroke, or when
    // the checker learns a word, would throw away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  const readDoc = useCallback(() => {
    const el = ref.current;
    return el ? htmlToDoc(el) : null;
  }, []);

  /**
   * Saving happens as the writing happens: a pause of about a second, and
   * whatever is on the page is on the server. Nothing is ever waiting on a
   * button being pressed.
   *
   * The document is read out of the DOM now and held, rather than read when the
   * timer fires. React detaches refs before passive cleanup runs, so a save
   * flushed at unmount — clicking away, closing the editor, leaving the page —
   * would otherwise find nothing to read and quietly lose the last few seconds.
   */
  const pending = useRef<ProseDoc | null>(null);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const doc = pending.current;
    if (!doc) return;
    pending.current = null;
    onSave(doc);
  }, [onSave]);

  const scheduleSave = useCallback(() => {
    pending.current = readDoc();
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 900);
  }, [flush, readDoc]);

  /**
   * Records the state *before* a change, so undo has somewhere to go back to.
   *
   * Called at the boundaries where an edit becomes a discrete thing a writer
   * would want back — finishing a word, starting a paragraph, applying a mark —
   * rather than per keystroke, which would make undo a letter-at-a-time crawl.
   */
  const remember = useCallback(() => {
    const el = ref.current;
    if (!el || restoring.current) return;
    const doc = htmlToDoc(el);
    const caret = caretOffset(el) ?? 0;

    const previous = history.current[historyAt.current];
    if (previous && JSON.stringify(previous.doc) === JSON.stringify(doc)) return;

    // Anything undone and then typed over is no longer reachable.
    history.current = history.current.slice(0, historyAt.current + 1);
    history.current.push({ doc, caret });
    if (history.current.length > HISTORY_DEPTH) history.current.shift();
    historyAt.current = history.current.length - 1;
  }, []);

  const restore = useCallback(
    (step: -1 | 1) => {
      const el = ref.current;
      if (!el) return;

      // The state being left is only on the stack once something has been
      // undone; going back from the live text has to put it there first.
      if (step === -1 && historyAt.current === history.current.length - 1) {
        const doc = htmlToDoc(el);
        const previous = history.current[historyAt.current];
        if (!previous || JSON.stringify(previous.doc) !== JSON.stringify(doc)) {
          history.current.push({ doc, caret: caretOffset(el) ?? 0 });
          historyAt.current = history.current.length - 1;
        }
      }

      const next = historyAt.current + step;
      const entry = history.current[next];
      if (!entry) return;
      historyAt.current = next;

      restoring.current = true;
      el.innerHTML = docToHtml(entry.doc, speller, layoutRef.current);
      setCaret(el, entry.caret);
      restoring.current = false;

      pending.current = entry.doc;
      scheduleSave();
    },
    [speller, scheduleSave],
  );

  /**
   * Re-underline. Rebuilds the element from the model, which is why it runs on
   * leaving a word rather than on every keystroke: a word half-typed is not
   * misspelled, and underlining it as it is written is only distracting.
   */
  const recheck = useCallback(() => {
    const el = ref.current;
    if (!el || !speller) return;
    const doc = htmlToDoc(el);
    const offset = caretOffset(el);
    const html = docToHtml(doc, speller, layoutRef.current);
    if (html === el.innerHTML) return;
    el.innerHTML = html;
    if (offset !== null) setCaret(el, offset);
  }, [speller]);

  /**
   * The dictionary is fetched only when checking is first wanted, so on the
   * first block opened in a session it arrives after the editor is already
   * showing. Nothing would be underlined until the next word boundary without
   * this — which reads exactly like a checker that isn't working.
   */
  useEffect(() => {
    if (!speller) return;
    recheck();
  }, [speller, recheck]);

  /**
   * The paragraphs the selection covers, or the one the caret sits in.
   *
   * A blockquote applies to whole paragraphs, so a selection that clips the end
   * of one and the start of the next turns both — which is what a writer
   * dragging across a passage means, and dropping the partial ends would be
   * surprising.
   */
  const paragraphsInSelection = useCallback((): HTMLElement[] => {
    const el = ref.current;
    if (!el) return [];
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return [];

    return Array.from(el.querySelectorAll("p")).filter((p) => range.intersectsNode(p));
  }, []);

  const refreshQuoted = useCallback(() => {
    const paragraphs = paragraphsInSelection();
    setQuoted(paragraphs.length > 0 && paragraphs.every((p) => p.dataset.blockquote === "1"));
  }, [paragraphsInSelection]);

  /**
   * Turn the paragraphs under the selection into an extract, or back into
   * prose. Mixed selections become quoted rather than toggling each one, since
   * the button reads as off in that state and pressing an off button should
   * turn things on.
   */
  const toggleBlockquote = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const paragraphs = paragraphsInSelection();
    if (paragraphs.length === 0) return;

    remember();
    const offset = caretOffset(el);
    const allQuoted = paragraphs.every((p) => p.dataset.blockquote === "1");
    for (const paragraph of paragraphs) {
      if (allQuoted) delete paragraph.dataset.blockquote;
      else paragraph.dataset.blockquote = "1";
    }

    // Rebuilt from the model so the class and the indent follow the attribute,
    // rather than being patched onto the element by hand in two places.
    const doc = htmlToDoc(el);
    el.innerHTML = docToHtml(doc, speller, layoutRef.current);
    if (offset !== null) setCaret(el, offset);

    setQuoted(!allQuoted);
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paragraphsInSelection, speller, scheduleSave]);

  const refreshMarks = useCallback(() => {
    setMarks({
      strong: document.queryCommandState("bold"),
      em: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
    });
    refreshQuoted();
  }, [refreshQuoted]);

  const applyMark = (kind: "bold" | "italic" | "underline") => {
    remember();
    document.execCommand(kind);
    refreshMarks();
    scheduleSave();
  };

  /** The selected fragment, read as the model. */
  const selectionDoc = useCallback((): ProseDoc | null => {
    const el = ref.current;
    if (!el) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;

    // A selection inside one paragraph clones as bare runs with no <p> around
    // them; htmlToDoc folds loose nodes into a paragraph, so both cases work.
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    const doc = htmlToDoc(holder);
    return doc.content.length ? doc : null;
  }, []);

  /** Writes the selection to the clipboard. False when there was none. */
  const writeClipboard = useCallback(
    (data: DataTransfer): boolean => {
      const doc = selectionDoc();
      if (!doc) return false;
      // Rebuilt from the model rather than lifted from the page, so the
      // underlines and their data attributes don't travel with the words.
      data.setData("text/plain", proseToText(doc));
      data.setData("text/html", docToHtml(doc, null));
      data.setData(PROSE_FLAVOUR, JSON.stringify(doc));
      return true;
    },
    [selectionDoc],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;

    if (event.key === "Escape") {
      event.preventDefault();
      commit();
      onDone();
      return;
    }

    // The usual pair, since the toolbar is not always where the hands are.
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      // Taken over from the browser: re-underlining rebuilds the element, and
      // that empties the native undo stack. Its undo would reach back only as
      // far as the last finished word.
      if (key === "z") {
        event.preventDefault();
        restore(event.shiftKey ? 1 : -1);
        return;
      }
      if (key === "y") {
        event.preventDefault();
        restore(1);
        return;
      }
      if (key === "b") {
        event.preventDefault();
        applyMark("bold");
        return;
      }
      if (key === "i") {
        event.preventDefault();
        applyMark("italic");
        return;
      }
      if (key === "u") {
        event.preventDefault();
        applyMark("underline");
        return;
      }
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // A finished word, a new paragraph, or a deletion is a step worth having
    // back on its own. Ordinary letters are folded into the word being typed.
    const deleting = event.key === "Backspace" || event.key === "Delete";
    if (event.key === "Enter" || deleting || (event.key.length === 1 && BOUNDARY.test(event.key))) {
      remember();
    }

    // Deleting a stretch of text can strand an underline on a word that is no
    // longer there, or join two halves into a word that is. A single character
    // is left to the next word boundary, as with typing — the word being edited
    // isn't misspelled yet, it's unfinished.
    if (deleting && window.getSelection()?.isCollapsed === false) {
      window.setTimeout(recheck, 0);
    }

    if (smartPunctuation && event.key.length === 1) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range && range.collapsed && el.contains(range.startContainer)) {
        const fix = autocorrectKeystroke(event.key, textBeforeCaret(el, range).slice(-2));
        if (fix) {
          event.preventDefault();
          // The characters being replaced are taken back through the selection
          // rather than by editing a text node directly. At the start of a
          // paragraph the caret sits in the <p> itself, with no text node to
          // edit — which is exactly where the opening quote of a line lives, and
          // why the first quote of a paragraph was the one that never turned.
          for (let i = 0; i < fix.replace; i += 1) {
            selection?.modify("extend", "backward", "character");
          }
          document.execCommand("insertText", false, fix.text);
          scheduleSave();
          return;
        }
      }
    }

    // Leaving a word is when its spelling becomes a question worth asking.
    if (event.key === "Enter" || BOUNDARY.test(event.key)) {
      window.setTimeout(recheck, 0);
    }
  };

  const commit = useCallback(() => {
    pending.current = readDoc();
    flush();
  }, [flush, readDoc]);

  const onClickBody = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const flagged = target.closest(".misspelled");
    if (!flagged) {
      setMenu(null);
      refreshMarks();
      return;
    }
    setMenu(
      placeSpellMenu(
        flagged.getAttribute("data-word") ?? flagged.textContent ?? "",
        flagged.getBoundingClientRect(),
      ),
    );
  };

  const replaceWord = (word: string, replacement: string) => {
    const el = ref.current;
    if (!el) return;
    for (const span of Array.from(el.querySelectorAll(".misspelled"))) {
      if ((span.getAttribute("data-word") ?? span.textContent) !== word) continue;
      span.replaceWith(document.createTextNode(replacement));
      break;
    }
    setMenu(null);
    recheck();
    scheduleSave();
  };

  /**
   * A pending save is flushed, never dropped. Held in a ref so this effect runs
   * on unmount alone rather than re-subscribing whenever a callback is remade.
   */
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const onLeave = () => flushRef.current();
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      flushRef.current();
    };
  }, []);

  return (
    <div className="prose-editor">
      <div className="prose-toolbar" role="toolbar" aria-label="Text style">
        <button
          type="button"
          className={`be-mark${marks.strong ? " on" : ""}`}
          aria-pressed={marks.strong}
          title="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyMark("bold")}
        >
          <Bold size={13} />
        </button>
        <button
          type="button"
          className={`be-mark${marks.em ? " on" : ""}`}
          aria-pressed={marks.em}
          title="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyMark("italic")}
        >
          <Italic size={13} />
        </button>
        <button
          type="button"
          className={`be-mark${marks.underline ? " on" : ""}`}
          aria-pressed={marks.underline}
          title="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyMark("underline")}
        >
          <Underline size={13} />
        </button>
        <span className="be-gap" />
        <button
          type="button"
          className={`be-mark${quoted ? " on" : ""}`}
          aria-pressed={quoted}
          title="Block quote"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleBlockquote}
        >
          <Quote size={13} />
        </button>
        <span className="be-gap" />
        <button
          type="button"
          className="be-mark"
          title="Undo (⌘Z)"
          aria-label="Undo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => restore(-1)}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="be-mark"
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => restore(1)}
        >
          <Redo2 size={13} />
        </button>
        <span className="be-gap" />
        {/* Whether the checker is on, and whether it has arrived yet: a
            dictionary is half a megabyte, so there is a moment on first use when
            nothing is underlined and the reason isn't otherwise visible. */}
        <span
          className={`prose-spell${speller ? " on" : ""}`}
          title={
            speller
              ? "Spelling is being checked"
              : spellcheckWanted
                ? "Fetching the dictionary…"
                : "Spelling checking is off — turn it on in Settings"
          }
        >
          <SpellCheck size={13} />
        </span>
        <span className="be-gap" />
        <span className="prose-hint">Escape when you&rsquo;re done</span>
      </div>

      <div
        className="prose-surface"
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Prose"
        // The browser's own checker would underline the same words in a second
        // colour, from a dictionary this app can't add to.
        spellCheck={false}
        onKeyDown={onKeyDown}
        onCopy={(event) => {
          if (writeClipboard(event.clipboardData)) event.preventDefault();
        }}
        onCut={(event) => {
          if (!writeClipboard(event.clipboardData)) return;
          event.preventDefault();
          remember();
          // We took the event, so the deletion is ours to do. execCommand rather
          // than deleteFromDocument: it merges the paragraphs either side of a
          // selection that spanned them, which is what a cut should leave.
          document.execCommand("delete");
          window.setTimeout(recheck, 0);
          scheduleSave();
        }}
        onPaste={(event) => {
          event.preventDefault();
          remember();

          // Text copied from Brigid keeps its bold and italic. Anything else is
          // flattened: a paste out of a word processor carries a stylesheet with
          // it, and none of it belongs in a manuscript whose look is decided by
          // its formats.
          const own = event.clipboardData.getData(PROSE_FLAVOUR);
          const doc = own ? readFlavour(own) : null;
          if (doc) {
            // A single paragraph is inserted inline so it joins the sentence it
            // was dropped into; more than one brings its paragraph breaks.
            const html =
              doc.content.length === 1
                ? runsToHtml(doc.content[0]?.content ?? [], null)
                : docToHtml(doc, null);
            document.execCommand("insertHTML", false, html);
          } else {
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          }

          window.setTimeout(recheck, 0);
          refreshMarks();
          scheduleSave();
        }}
        onInput={scheduleSave}
        onClick={onClickBody}
        onKeyUp={refreshMarks}
        onBlur={() => {
          commit();
          window.setTimeout(recheck, 0);
        }}
      />

      {menu
        ? createPortal(
            <>
          <div className="menu-scrim" role="presentation" onClick={() => setMenu(null)} />
          <div
            className="menu spell-menu"
            role="menu"
            style={{
              left: menu.left,
              maxHeight: menu.maxHeight,
              ...(menu.bottom === undefined ? { top: menu.top } : { bottom: menu.bottom }),
            }}
          >
            {speller?.suggest(menu.word).length ? (
              speller.suggest(menu.word).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  role="menuitem"
                  onClick={() => replaceWord(menu.word, suggestion)}
                >
                  {suggestion}
                </button>
              ))
            ) : (
              <span className="menu-note">No suggestions</span>
            )}
            <hr />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddWord(menu.word);
                setMenu(null);
                window.setTimeout(recheck, 0);
              }}
            >
              Add to dictionary
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onIgnoreWord(menu.word);
                setMenu(null);
                window.setTimeout(recheck, 0);
              }}
            >
              Ignore for now
            </button>
          </div>
            </>,
            // Out of the manuscript and onto the page. The sheet is `zoom`ed,
            // and zoom scales a fixed-positioned descendant's own coordinates
            // as well — so a menu placed at the word's measured position landed
            // somewhere else entirely, further off the harder the text was
            // scaled. Out here the numbers mean what they say.
            document.body,
          )
        : null}
    </div>
  );
}
