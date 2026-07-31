import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { VARIABLES, VARIABLE_NAMES } from "@brigid/shared";
import type { TemplateInline, TemplateMarks, VariableName } from "@brigid/shared";

/**
 * A line of template content: static text the writer types, with variables
 * dropped in as chips and tabs as visible stops.
 *
 * Chips are `contenteditable=false` spans carrying the variable name in a data
 * attribute, so the browser treats each as one indivisible character — you
 * can't land a caret inside "manuscript title" and break it in half. The DOM is
 * the source of truth only while focused; on every input it is serialized back
 * to TemplateInline[], which is what gets stored.
 */

const CHIPPABLE = VARIABLE_NAMES.filter((n) => VARIABLES[n].insertAs === "inline");

/**
 * A zero-width space either side of every atom.
 *
 * Without one, there is no editable text position immediately after a
 * `contenteditable=false` span, so a character typed there lands *inside* the
 * chip — which is how a typed ":" after "manuscript title" disappeared. The
 * caret always has somewhere legitimate to sit now, and these are stripped back
 * out when serializing.
 */
const ZWSP = "\u200B";

/** Discard the zero-width guards either side of an atom being removed. */
function stripGuards(atom: HTMLElement): void {
  for (const sibling of [atom.previousSibling, atom.nextSibling]) {
    if (
      sibling &&
      sibling.nodeType === Node.TEXT_NODE &&
      (sibling.textContent ?? "").replace(/\u200B/g, "") === ""
    ) {
      sibling.parentNode?.removeChild(sibling);
    }
  }
}

function inlinesToHtml(inlines: readonly TemplateInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.type === "lineBreak") return "<br>";
      if (inline.type === "tab") {
        return `${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`;
      }
      if (inline.type === "variable") {
        const fmt = inline.numberFormat ? ` data-format="${inline.numberFormat}"` : "";
        return `${ZWSP}<span data-var="${inline.name}"${fmt} contenteditable="false">${
          VARIABLES[inline.name].label
        }</span>${ZWSP}`;
      }
      const text = inline.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return text;
    })
    .join("");
}

function htmlToInlines(
  root: HTMLElement,
  marks: TemplateMarks,
  multiline: boolean,
): TemplateInline[] {
  const out: TemplateInline[] = [];
  const pushText = (raw: string) => {
    const text = raw.replace(/\u200B/g, "");
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += text;
    else out.push({ type: "text", text, ...marks });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const varName = node.dataset.var;
    if (varName && (CHIPPABLE as readonly string[]).includes(varName)) {
      const inline: TemplateInline = { type: "variable", name: varName as VariableName, ...marks };
      const fmt = node.dataset.format;
      if (fmt) inline.numberFormat = fmt as never;
      out.push(inline);
      // A browser that dropped a keystroke inside the chip anyway: recover the
      // character rather than losing it silently.
      const label = VARIABLES[varName as VariableName].label;
      const stray = (node.textContent ?? "").replace(/\u200B/g, "").replace(label, "");
      if (stray) pushText(stray);
      return;
    }
    if (node.dataset.tab) {
      out.push({ type: "tab" });
      const stray = (node.textContent ?? "").replace(/\u200B/g, "").replace("⇥", "");
      if (stray) pushText(stray);
      return;
    }
    if (node.tagName === "BR") {
      // Trailing <br> is the filler browsers keep at the end of a contenteditable
      // block; it isn't a line the writer typed.
      if (multiline && node.nextSibling) out.push({ type: "lineBreak" });
      else if (!multiline) pushText(" ");
      return;
    }
    // A block-level wrapper the browser made when Enter was pressed: its content
    // starts a new line.
    const isBlock = /^(DIV|P)$/.test(node.tagName);
    if (isBlock && multiline && out.length > 0) out.push({ type: "lineBreak" });
    node.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);
  return out;
}

export interface ChipEditorProps {
  value: TemplateInline[];
  marks: TemplateMarks;
  onChange: (next: TemplateInline[]) => void;
  placeholder?: string;
  /** Allow Enter to start a new line within the same template line. */
  multiline?: boolean;
  /**
   * Hide the built-in chip/tab bar. A table cell is the editing surface itself,
   * so its controls live in a row beneath the table where there is room for
   * them — reached through the imperative handle below.
   */
  showToolbar?: boolean;
}

export interface ChipEditorHandle {
  insertVariable: (name: VariableName) => void;
  insertTab: () => void;
  focus: () => void;
}

export const ChipEditor = forwardRef<ChipEditorHandle, ChipEditorProps>(function ChipEditor(
  { value, marks, onChange, placeholder, multiline = false, showToolbar = true },
  handleRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);

  // Only write the DOM when the change came from outside; rewriting it while
  // the writer is typing would reset the caret to the start on every keystroke.
  useEffect(() => {
    if (!ref.current || dirty.current) {
      dirty.current = false;
      return;
    }
    const html = inlinesToHtml(value);
    if (ref.current.innerHTML !== html) ref.current.innerHTML = html;
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    dirty.current = true;
    onChange(htmlToInlines(ref.current, marks, multiline));
  };

  const insert = (html: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    // With no caret inside the field — the usual case when clicking a button in
    // the toolbar — append rather than silently doing nothing.
    if (!selection || selection.rangeCount === 0 || !el.contains(selection.anchorNode)) {
      el.insertAdjacentHTML("beforeend", html);
    } else {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      const last = fragment.lastChild;
      range.insertNode(fragment);
      if (last) {
        range.setStartAfter(last);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    emit();
  };

  /**
   * Delete a chip or tab as one keystroke.
   *
   * Left to itself the browser makes this a two- or three-press affair: the
   * zero-width guards go first, then the atom needs selecting before it will
   * go. That reads as "it won't delete". Backspace and Delete now take the
   * whole atom, guards included, when the caret is beside one.
   */
  const removeAtomBeside = (dir: -1 | 1): boolean => {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return false;

    let node: Node | null = range.startContainer;
    // Real text on the side we're deleting toward: let the browser handle it.
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const side = dir === -1 ? text.slice(0, range.startOffset) : text.slice(range.startOffset);
      if (side.replace(/\u200B/g, "").length > 0) return false;
    } else if (node === el) {
      const index = range.startOffset + (dir === -1 ? -1 : 0);
      node = el.childNodes[index] ?? null;
      if (node instanceof HTMLElement && (node.dataset.var || node.dataset.tab)) {
        stripGuards(node);
        node.remove();
        return true;
      }
      return false;
    }

    // Step sideways, discarding the zero-width guards on the way.
    let cursor: Node | null = node;
    while (cursor && cursor !== el) {
      const sibling: Node | null = dir === -1 ? cursor.previousSibling : cursor.nextSibling;
      if (!sibling) {
        cursor = cursor.parentNode;
        continue;
      }
      if (
        sibling.nodeType === Node.TEXT_NODE &&
        (sibling.textContent ?? "").replace(/\u200B/g, "") === ""
      ) {
        cursor = sibling;
        continue;
      }
      if (sibling instanceof HTMLElement && (sibling.dataset.var || sibling.dataset.tab)) {
        stripGuards(sibling);
        sibling.remove();
        return true;
      }
      return false;
    }
    return false;
  };

  useImperativeHandle(handleRef, () => ({
    insertVariable: (name) =>
      insert(
        `${ZWSP}<span data-var="${name}" contenteditable="false">${VARIABLES[name].label}</span>${ZWSP}`,
      ),
    insertTab: () => insert(`${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`),
    focus: () => ref.current?.focus(),
  }));

  return (
    <div className="chip-editor">
      <div
        className="chip-field"
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={multiline}
        data-placeholder={placeholder ?? "Type here, or drop in a chip"}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => {
          // A single-line field takes no Enter at all: a template paragraph is
          // one line by definition. A cell can hold several.
          if (e.key === "Enter") {
            e.preventDefault();
            if (multiline) insert("<br>");
          }
          if (e.key === "Tab") {
            e.preventDefault();
            insert(`${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`);
          }
          if (e.key === "Backspace" && removeAtomBeside(-1)) {
            e.preventDefault();
            emit();
          }
          if (e.key === "Delete" && removeAtomBeside(1)) {
            e.preventDefault();
            emit();
          }
        }}
        onPaste={(e) => {
          // Paste as plain text so foreign markup can't enter the template.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
          insert(text.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
        }}
      />

      {showToolbar ? (
      <div className="chip-bar">
        <select
          value=""
          onChange={(e) => {
            const name = e.target.value as VariableName;
            if (!name) return;
            insert(
              `${ZWSP}<span data-var="${name}" contenteditable="false">${VARIABLES[name].label}</span>${ZWSP}`,
            );
            e.target.value = "";
          }}
        >
          <option value="">Insert chip…</option>
          {CHIPPABLE.map((n) => (
            <option key={n} value={n}>
              {VARIABLES[n].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn secondary chip-tab-btn"
          title="Advance to the next tab stop — spacing set by the format's tab stop"
          onClick={() => insert(`${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`)}
        >
          ⇥ Tab
        </button>
      </div>
      ) : null}
    </div>
  );
});
