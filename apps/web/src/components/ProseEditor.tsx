import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic } from "lucide-react";
import { asProseDoc, autocorrectKeystroke, hasMark, normalizeProse, proseFromParagraphs } from "@brigid/shared";
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

// --- The model, in the DOM and back -------------------------------------

function runsToHtml(runs: ProseText[], speller: Speller | null): string {
  if (runs.length === 0) return "<br>";
  return runs
    .map((run) => {
      const inner = speller ? markMisspellings(run.text, speller) : escapeHtml(run.text);
      const em = hasMark(run, "em") ? `<em>${inner}</em>` : inner;
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

function docToHtml(doc: ProseDoc, speller: Speller | null): string {
  if (doc.content.length === 0) return "<p><br></p>";
  return doc.content.map((p) => `<p>${runsToHtml(p.content ?? [], speller)}</p>`).join("");
}

/** Reads the element back into the model, ignoring the decoration spans. */
function htmlToDoc(root: HTMLElement): ProseDoc {
  const paragraphs: ProseDoc["content"] = [];

  const readParagraph = (node: Node): ProseText[] => {
    const runs: ProseText[] = [];
    const walk = (current: Node, strong: boolean, em: boolean) => {
      if (current.nodeType === Node.TEXT_NODE) {
        const text = (current.textContent ?? "").replace(new RegExp(ZWSP, "g"), "");
        if (!text) return;
        const marks = [
          ...(strong ? [{ type: "strong" as const }] : []),
          ...(em ? [{ type: "em" as const }] : []),
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
      for (const child of Array.from(el.childNodes)) walk(child, nextStrong, nextEm);
    };
    for (const child of Array.from(node.childNodes)) walk(child, false, false);
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
      paragraphs.push(runs.length ? { type: "paragraph", content: runs } : { type: "paragraph" });
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

// --- The caret, as a character offset -----------------------------------

/**
 * Where the caret is, counted in characters from the start, with paragraph
 * boundaries counting as one.
 *
 * Redecorating rebuilds the element's HTML, which destroys every node the
 * selection referred to. An offset survives that; a node reference does not.
 */
function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  let offset = 0;
  let found = false;

  const walk = (node: Node) => {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === range.startContainer) {
        offset += range.startOffset;
        found = true;
        return;
      }
      offset += (node.textContent ?? "").length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el !== root && el.tagName === "P" && el !== root.firstChild) offset += 1;
    if (node === range.startContainer) {
      // Caret sits between children rather than inside a text node.
      for (let i = 0; i < range.startOffset; i += 1) {
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

function setCaret(root: HTMLElement, offset: number): void {
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
/** Characters that end a word, and so are worth re-checking the spelling on. */
const BOUNDARY = /[\s.,;:!?)\]}"”'’—–…]/;

// --- The component -------------------------------------------------------

export interface ProseEditorProps {
  blockId: string;
  content: Record<string, unknown> | null;
  /** Fallback for blocks whose prose predates the structured document. */
  fallbackText: string;
  speller: Speller | null;
  smartPunctuation: boolean;
  onSave: (doc: ProseDoc) => void;
  onDone: () => void;
  onAddWord: (word: string) => void;
  onIgnoreWord: (word: string) => void;
}

export function ProseEditor({
  blockId,
  content,
  fallbackText,
  speller,
  smartPunctuation,
  onSave,
  onDone,
  onAddWord,
  onIgnoreWord,
}: ProseEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);

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
  const [marks, setMarks] = useState({ strong: false, em: false });
  const [menu, setMenu] = useState<{ word: string; x: number; y: number } | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Rendered once per block. Later renders would take the caret with them.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const doc =
      asProseDoc(content) ??
      proseFromParagraphs(fallbackText ? fallbackText.split(/\n{2,}/) : [""]);
    el.innerHTML = docToHtml(doc, speller);
    el.focus();
    setCaret(el, 0);
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
      el.innerHTML = docToHtml(entry.doc, speller);
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
    const html = docToHtml(doc, speller);
    if (html === el.innerHTML) return;
    el.innerHTML = html;
    if (offset !== null) setCaret(el, offset);
  }, [speller]);

  const refreshMarks = useCallback(() => {
    setMarks({
      strong: document.queryCommandState("bold"),
      em: document.queryCommandState("italic"),
    });
  }, []);

  const applyMark = (kind: "bold" | "italic") => {
    remember();
    document.execCommand(kind);
    refreshMarks();
    scheduleSave();
  };

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
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // A finished word, a new paragraph, or a deletion is a step worth having
    // back on its own. Ordinary letters are folded into the word being typed.
    if (
      event.key === "Enter" ||
      event.key === "Backspace" ||
      event.key === "Delete" ||
      (event.key.length === 1 && BOUNDARY.test(event.key))
    ) {
      remember();
    }

    if (smartPunctuation && event.key.length === 1) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range && range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = range.startContainer.textContent ?? "";
        const before = text.slice(Math.max(0, range.startOffset - 2), range.startOffset);
        const fix = autocorrectKeystroke(event.key, before);
        if (fix) {
          event.preventDefault();
          const node = range.startContainer as Text;
          const at = range.startOffset;
          node.replaceData(at - fix.replace, fix.replace, fix.text);
          const caret = at - fix.replace + fix.text.length;
          range.setStart(node, caret);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
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
    const box = flagged.getBoundingClientRect();
    setMenu({
      word: flagged.getAttribute("data-word") ?? flagged.textContent ?? "",
      x: box.left,
      y: box.bottom + 4,
    });
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
        onPaste={(event) => {
          // Plain text only: a paste out of a word processor carries a stylesheet
          // with it, and none of it belongs in a manuscript whose look is decided
          // by its formats.
          event.preventDefault();
          remember();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          window.setTimeout(recheck, 0);
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

      {menu ? (
        <>
          <div className="menu-scrim" role="presentation" onClick={() => setMenu(null)} />
          <div className="menu spell-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
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
        </>
      ) : null}
    </div>
  );
}
