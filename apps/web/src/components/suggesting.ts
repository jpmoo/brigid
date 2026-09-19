/**
 * Suggesting mode, as it happens in the editor.
 *
 * Typing and deleting are intercepted before the browser acts on them and done
 * here instead, so that nothing the writer does while proofreading changes the
 * prose directly. Added words go into an `<ins>`, removed words into a `<del>`,
 * and both are read back into the document as suggestion marks.
 *
 * The rules are Google Docs', because that is what a writer already knows:
 * typing adds; deleting ordinary text strikes it rather than removing it;
 * deleting your own suggested text removes it outright; backspacing into text
 * already struck steps over it to the next letter; and typing over a selection
 * strikes the old words and adds the new ones as a single replacement.
 */

export interface Stamp {
  id: string;
  at: string;
}

/**
 * A fresh suggestion id.
 *
 * From getRandomValues rather than randomUUID, which exists only in a secure
 * context — and this application is as often reached at a bare address on the
 * home network as over HTTPS.
 */
export function newStamp(): Stamp {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return { id, at: new Date().toISOString() };
}

/** The suggestion element a node sits in, if any, within the editor. */
function suggestionAround(node: Node | null, root: HTMLElement, tag: "INS" | "DEL"): HTMLElement | null {
  for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
    if (at.nodeType === Node.ELEMENT_NODE) {
      const el = at as HTMLElement;
      if (el.tagName === tag && el.classList.contains("sug")) return el;
    }
  }
  return null;
}

const insAround = (node: Node | null, root: HTMLElement) => suggestionAround(node, root, "INS");
const delAround = (node: Node | null, root: HTMLElement) => suggestionAround(node, root, "DEL");

function suggestionElement(tag: "ins" | "del", stamp: Stamp): HTMLElement {
  const el = document.createElement(tag);
  el.className = "sug";
  el.dataset.sid = stamp.id;
  el.dataset.at = stamp.at;
  return el;
}

/** Every text node a range touches, collected before anything moves. */
function textNodesIn(range: Range, root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (range.intersectsNode(node) && (node.textContent ?? "").length > 0) out.push(node as Text);
  }
  return out;
}

/**
 * Where a range starts and ends within one text node it touches.
 *
 * A node the range merely passes through is covered whole. The first version
 * also asked whether the node's own start lay before the range — which, for the
 * node the range starts in, it always does — and so treated every partly
 * covered node as covered from its first character: one backspace took a whole
 * suggestion, four struck half a sentence.
 */
function clip(range: Range, node: Text): [number, number] {
  const length = node.length;
  const start = range.startContainer === node ? range.startOffset : 0;
  const end = range.endContainer === node ? range.endOffset : length;
  return [Math.max(0, Math.min(start, length)), Math.max(0, Math.min(end, length))];
}

/** A neighbouring deletion to join, so one run of backspaces is one suggestion. */
function adjacentDeletion(el: HTMLElement, side: "before" | "after"): HTMLElement | null {
  let node: Node | null = side === "before" ? el.previousSibling : el.nextSibling;
  while (node && node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").length) {
    node = side === "before" ? node.previousSibling : node.nextSibling;
  }
  return node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "DEL" &&
    (node as HTMLElement).classList.contains("sug")
    ? (node as HTMLElement)
    : null;
}

/**
 * Propose removing what a range covers.
 *
 * Ordinary text is struck; text that is itself a suggested insertion is simply
 * taken out, because an unaccepted suggestion withdrawn is not a change to the
 * prose; text already struck is left as it is. Returns the struck elements, in
 * order, so the caller can join them to a replacement and put the caret beside
 * them.
 */
function strike(range: Range, root: HTMLElement, stamp: Stamp | null): HTMLElement[] {
  const struck: HTMLElement[] = [];
  const fresh = stamp ?? newStamp();

  for (const node of textNodesIn(range, root)) {
    const [start, end] = clip(range, node);
    if (end <= start) continue;
    if (delAround(node, root)) continue;

    const ins = insAround(node, root);
    if (ins) {
      node.deleteData(start, end - start);
      if (!(ins.textContent ?? "").length) ins.remove();
      continue;
    }

    let piece = node;
    if (start > 0) piece = piece.splitText(start);
    if (end - start < piece.length) piece.splitText(end - start);
    const del = suggestionElement("del", fresh);
    piece.parentNode!.insertBefore(del, piece);
    del.appendChild(piece);
    struck.push(del);
  }
  return struck;
}

/** Put the caret at a point. */
function caretAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretBeside(el: Node, side: "before" | "after"): void {
  const parent = el.parentNode!;
  const index = Array.prototype.indexOf.call(parent.childNodes, el) as number;
  caretAt(parent, side === "before" ? index : index + 1);
}

/** The text node just before a collapsed point, if the point is at its very end. */
function textEndingAt(node: Node, offset: number, root: HTMLElement): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return offset === (node as Text).length ? (node as Text) : null;
  let before: Node | null = offset > 0 ? node.childNodes[offset - 1] ?? null : null;
  while (before && before.nodeType !== Node.TEXT_NODE) before = before.lastChild;
  return before && root.contains(before) ? (before as Text) : null;
}

/**
 * Type text as a suggestion, wherever the caret or selection is.
 *
 * Over a selection that includes ordinary text, the typed words are the second
 * half of a replacement and go in as a new element with its id, rather than
 * extending whatever insertion happens to sit nearby.
 */
export function suggestInsert(root: HTMLElement, text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !text) return;
  let range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;

  // Typing over a selection. If any of it was ordinary text, this is a
  // replacement: the struck words and the typed ones share one id, and the new
  // text goes after the old, as Docs sets it.
  let pair: Stamp | null = null;
  if (!range.collapsed) {
    const stamp = newStamp();
    const struck = strike(range, root, stamp);
    if (struck.length) {
      pair = stamp;
      caretBeside(struck[struck.length - 1]!, "after");
    } else {
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    range = selection.getRangeAt(0);
  }

  const { startContainer: node, startOffset: offset } = range;

  if (!pair) {
    // Inside an insertion already: the words simply join it.
    if (node.nodeType === Node.TEXT_NODE && insAround(node, root)) {
      (node as Text).insertData(offset, text);
      caretAt(node, offset + text.length);
      return;
    }
    // Just after one: keep extending it, so a word typed across a pause is
    // still one suggestion.
    const ending = textEndingAt(node, offset, root);
    if (ending && insAround(ending, root)) {
      const at = ending.length;
      ending.appendData(text);
      caretAt(ending, at + text.length);
      return;
    }
  }

  // A new suggestion. Never inside a deletion: typed words are not proposed for
  // removal, so the insertion goes just after the struck text.
  const ins = suggestionElement("ins", pair ?? newStamp());
  const body = document.createTextNode(text);
  ins.appendChild(body);
  const struckAround = delAround(node, root);
  if (struckAround) {
    struckAround.parentNode!.insertBefore(ins, struckAround.nextSibling);
  } else {
    range.insertNode(ins);
  }
  caretAt(body, text.length);
}

export type Reach = "character" | "word" | "lineboundary";

/**
 * Delete as a suggestion: the selection if there is one, otherwise one step in
 * a direction.
 *
 * "edge" when the step reached a paragraph break with nothing live to take —
 * a join rather than a deletion of words, left to the caller. "nothing" when
 * there was nothing to do at all, and the key should be swallowed.
 */
export function suggestDelete(
  root: HTMLElement,
  direction: "backward" | "forward",
  reach: Reach,
): "done" | "edge" | "nothing" {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "nothing";
  const original = selection.getRangeAt(0).cloneRange();
  if (!root.contains(original.commonAncestorContainer)) return "nothing";

  let range = original;
  if (original.collapsed) {
    /**
     * One step, taken past anything already struck.
     *
     * Backspacing into a deletion does not delete the deletion: the caret steps
     * over the struck letters and takes the next live one. Bounded, because a
     * long struck passage is walked a character at a time.
     *
     * When there is nothing live to take, the key is handed back only at a
     * paragraph's edge, with the caret put there — joining two paragraphs
     * removes no words. Anywhere else it is swallowed. Handing it back from
     * inside struck text would let the browser delete a struck letter outright,
     * which is an edit to the manuscript made in the one mode that promises
     * never to make one.
     */
    let caret = original;
    let found: Range | null = null;
    for (let guard = 0; guard < 20000; guard += 1) {
      selection.removeAllRanges();
      selection.addRange(caret);
      selection.modify("extend", direction, reach);
      const step = selection.getRangeAt(0).cloneRange();
      const stepped = !(
        step.startContainer === caret.startContainer &&
        step.startOffset === caret.startOffset &&
        step.endContainer === caret.endContainer &&
        step.endOffset === caret.endOffset
      );
      const touched = stepped && !step.collapsed ? textNodesIn(step, root) : [];
      const live = touched.some((node) => {
        const [s, e] = clip(step, node);
        return e > s && !delAround(node, root);
      });
      if (live) {
        found = step;
        break;
      }
      if (touched.length === 0) {
        // The start or end of the text, or a paragraph break: stop at the caret.
        selection.removeAllRanges();
        selection.addRange(caret);
        return stepped && !step.collapsed ? "edge" : "nothing";
      }
      // Only struck text: step past it and look again.
      caret = step.cloneRange();
      caret.collapse(direction === "backward");
    }
    if (!found) return "nothing";
    range = found;
  }

  // One run of deletes is one suggestion: a new deletion joins the struck text
  // it lands against.
  const struck = strike(range, root, null);
  for (const del of struck) {
    const neighbour = adjacentDeletion(del, direction === "backward" ? "after" : "before");
    if (neighbour && neighbour.dataset.sid) {
      del.dataset.sid = neighbour.dataset.sid;
      if (neighbour.dataset.at) del.dataset.at = neighbour.dataset.at;
    }
  }

  if (struck.length) {
    caretBeside(direction === "backward" ? struck[0]! : struck[struck.length - 1]!, direction === "backward" ? "before" : "after");
  } else {
    // Only suggested text was taken, which moves nothing that remains.
    const after = selection.getRangeAt(0);
    after.collapse(direction === "backward");
  }
  return "done";
}
