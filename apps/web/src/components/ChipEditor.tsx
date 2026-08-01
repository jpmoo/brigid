import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowRightToLine, Braces } from "lucide-react";
import { NUMBER_FORMATS, VARIABLES, VARIABLE_NAMES, formatNumber } from "@brigid/shared";
import type { NumberFormat, TemplateInline, TemplateMarks, VariableName } from "@brigid/shared";

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

/** A numeric chip shows its format, using 3 so every option looks different. */
const SAMPLE = 3;
const FORMAT_LABEL: Record<NumberFormat, string> = {
  arabic: "1, 2, 3",
  "roman-upper": "I, II, III",
  "roman-lower": "i, ii, iii",
  "words-title": "One, Two, Three",
  "words-upper": "ONE, TWO, THREE",
};

function chipLabel(name: VariableName, format?: string): string {
  const base = VARIABLES[name].label;
  if (!VARIABLES[name].numeric) return base;
  return `${base} · ${formatNumber(SAMPLE, (format as NumberFormat) ?? "arabic")}`;
}

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

function markOpen(m: TemplateMarks): string {
  return (
    (m.bold ? "<b>" : "") +
    (m.italic ? "<i>" : "") +
    (m.underline ? "<u>" : "") +
    (m.smallCaps ? '<span data-sc="1">' : "") +
    (m.allCaps ? '<span data-caps="1">' : "")
  );
}

function markClose(m: TemplateMarks): string {
  return (
    (m.allCaps ? "</span>" : "") +
    (m.smallCaps ? "</span>" : "") +
    (m.underline ? "</u>" : "") +
    (m.italic ? "</i>" : "") +
    (m.bold ? "</b>" : "")
  );
}

function inlinesToHtml(inlines: readonly TemplateInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.type === "lineBreak") return `<br>${ZWSP}`;
      if (inline.type === "tab") {
        return `${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`;
      }
      if (inline.type === "variable") {
        const fmt = inline.numberFormat ? ` data-format="${inline.numberFormat}"` : "";
        return `${ZWSP}<span data-var="${inline.name}"${fmt} contenteditable="false">${chipLabel(
          inline.name,
          inline.numberFormat,
        )}</span>${ZWSP}`;
      }
      const text = inline.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `${markOpen(inline)}${text}${markClose(inline)}`;
    })
    .join("");
}

const sameMarks = (a: TemplateMarks, b: TemplateMarks) =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.smallCaps === !!b.smallCaps &&
  !!a.allCaps === !!b.allCaps;

/**
 * Marks are read from the elements the text actually sits inside, so a line can
 * hold roman and italic side by side. Previously every span in a paragraph took
 * the same marks, which made the toggles a property of the line rather than of
 * what you had selected.
 */
function htmlToInlines(root: HTMLElement, multiline: boolean): TemplateInline[] {
  const out: TemplateInline[] = [];
  const pushText = (raw: string, marks: TemplateMarks) => {
    const text = raw.replace(/\u200B/g, "");
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === "text" && sameMarks(last, marks)) last.text += text;
    else out.push({ type: "text", text, ...marks });
  };

  const walk = (node: Node, marks: TemplateMarks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "", marks);
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tag = node.tagName;
    const here: TemplateMarks = { ...marks };
    if (tag === "B" || tag === "STRONG") here.bold = true;
    if (tag === "I" || tag === "EM") here.italic = true;
    if (tag === "U") here.underline = true;
    if (node.dataset.sc) here.smallCaps = true;
    if (node.dataset.caps) here.allCaps = true;

    const varName = node.dataset.var;
    if (varName && (CHIPPABLE as readonly string[]).includes(varName)) {
      const inline: TemplateInline = { type: "variable", name: varName as VariableName, ...here };
      const fmt = node.dataset.format;
      if (fmt) inline.numberFormat = fmt as never;
      out.push(inline);
      // A browser that dropped a keystroke inside the chip anyway: recover the
      // character rather than losing it silently.
      const label = chipLabel(varName as VariableName, node.dataset.format);
      const stray = (node.textContent ?? "").replace(/\u200B/g, "").replace(label, "");
      if (stray) pushText(stray, here);
      return;
    }
    if (node.dataset.tab) {
      out.push({ type: "tab" });
      const stray = (node.textContent ?? "").replace(/\u200B/g, "").replace("⇥", "");
      if (stray) pushText(stray, here);
      return;
    }
    if (node.tagName === "BR") {
      if (!multiline) {
        pushText(" ", here);
        return;
      }
      // Browsers park a bogus <br> in an otherwise-empty field to give the
      // caret somewhere to sit. That one isn't a line the writer typed; every
      // other one is, including a trailing break.
      const isOnlyChild = node.parentElement === root && root.childNodes.length === 1;
      if (!isOnlyChild) out.push({ type: "lineBreak" });
      return;
    }
    // A block-level wrapper the browser made when Enter was pressed: its content
    // starts a new line.
    const isBlock = /^(DIV|P)$/.test(tag);
    if (isBlock && multiline && out.length > 0) out.push({ type: "lineBreak" });
    node.childNodes.forEach((child) => walk(child, here));
  };

  root.childNodes.forEach((child) => walk(child, {}));
  return out;
}

export interface ChipEditorProps {
  value: TemplateInline[];
  marks: TemplateMarks;
  onChange: (next: TemplateInline[]) => void;
  placeholder?: string;
  /** Allow Enter to start a new line within the same template line. */
  multiline?: boolean;
  /** Marks in force at the caret, so a toolbar can show what is on. */
  onActiveMarks?: (marks: TemplateMarks) => void;
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
  toggleMark: (mark: keyof TemplateMarks) => void;
  focus: () => void;
}

export const ChipEditor = forwardRef<ChipEditorHandle, ChipEditorProps>(function ChipEditor(
  { value, marks, onChange, placeholder, multiline = false, showToolbar = true, onActiveMarks },
  handleRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  // The chip whose number format is being chosen, and where to put the menu.
  const [formatFor, setFormatFor] = useState<{ el: HTMLElement; top: number; left: number } | null>(
    null,
  );
  const [chipMenu, setChipMenu] = useState(false);
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

  // The caret is lost the moment a toolbar control takes focus, so the last
  // position inside the field is remembered and put back before acting.
  const savedRange = useRef<Range | null>(null);

  /**
   * What is marked where the caret is. Walked up from the selection rather than
   * taken from the stored inlines, because the answer has to reflect the exact
   * position — a line can hold roman and italic, and the toolbar should say
   * which one you are standing in.
   */
  const reportMarks = () => {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    let node: Node | null = selection.getRangeAt(0).startContainer;
    const found: TemplateMarks = {};
    while (node && node !== el) {
      if (node instanceof HTMLElement) {
        const tag = node.tagName;
        if (tag === "B" || tag === "STRONG") found.bold = true;
        if (tag === "I" || tag === "EM") found.italic = true;
        if (tag === "U") found.underline = true;
        if (node.dataset.sc) found.smallCaps = true;
        if (node.dataset.caps) found.allCaps = true;
      }
      node = node.parentNode;
    }
    onActiveMarks?.(found);
  };

  const rememberSelection = () => {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    reportMarks();
  };

  const restoreSelection = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    if (!range || !el.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const emit = () => {
    if (!ref.current) return;
    dirty.current = true;
    onChange(htmlToInlines(ref.current, multiline));
  };

  const insert = (html: string) => {
    const el = ref.current;
    if (!el) return;
    restoreSelection();
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

  /**
   * Toggle a mark over the selection, or arm it for whatever is typed next.
   *
   * Bold and italic go through execCommand, which is deprecated but is the only
   * thing that handles the caret case natively — with nothing selected it sets
   * the typing state, so the next characters come out marked. Small caps and
   * all caps have no such command, so an empty marked span is planted and the
   * caret put inside it, which produces the same behaviour.
   */
  const toggleMark = (mark: keyof TemplateMarks) => {
    const el = ref.current;
    if (!el) return;
    restoreSelection();

    if (mark === "bold" || mark === "italic" || mark === "underline") {
      document.execCommand(mark, false);
      emit();
      reportMarks();
      return;
    }

    const attr = mark === "smallCaps" ? "data-sc" : "data-caps";
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      const span = document.createElement("span");
      span.setAttribute(attr, "1");
      span.textContent = ZWSP;
      range.insertNode(span);
      const inner = document.createRange();
      inner.setStart(span.firstChild as Node, 1);
      inner.collapse(true);
      selection.removeAllRanges();
      selection.addRange(inner);
    } else {
      const existing = (range.commonAncestorContainer as HTMLElement).parentElement?.closest?.(
        `[${attr}]`,
      );
      if (existing) {
        // Already marked: unwrap rather than nest a second one.
        const parent = existing.parentNode;
        while (existing.firstChild) parent?.insertBefore(existing.firstChild, existing);
        parent?.removeChild(existing);
      } else {
        const span = document.createElement("span");
        span.setAttribute(attr, "1");
        span.appendChild(range.extractContents());
        range.insertNode(span);
      }
    }
    emit();
    reportMarks();
  };

  useImperativeHandle(handleRef, () => ({
    toggleMark,
    insertVariable: (name) =>
      insert(
        `${ZWSP}<span data-var="${name}" contenteditable="false">${chipLabel(name)}</span>${ZWSP}`,
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
        onInput={() => {
          rememberSelection();
          emit();
        }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onFocus={rememberSelection}
        onBlur={emit}
        onClick={(e) => {
          // Clicking a numeric chip offers its formats. Non-numeric chips have
          // nothing to choose, so they stay inert.
          const target = (e.target as HTMLElement).closest?.("[data-var]") as HTMLElement | null;
          const name = target?.dataset.var as VariableName | undefined;
          if (!target || !name || !VARIABLES[name]?.numeric) {
            setFormatFor(null);
            return;
          }
          const field = ref.current?.getBoundingClientRect();
          const chip = target.getBoundingClientRect();
          setFormatFor({
            el: target,
            top: chip.bottom - (field?.top ?? 0) + 4,
            left: chip.left - (field?.left ?? 0),
          });
        }}
        onKeyDown={(e) => {
          // A single-line field takes no Enter at all: a template paragraph is
          // one line by definition. A cell can hold several.
          if (e.key === "Enter") {
            e.preventDefault();
            if (multiline) insert(`<br>${ZWSP}`);
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

      {formatFor ? (
        <>
          <div className="menu-scrim" role="presentation" onClick={() => setFormatFor(null)} />
          <div className="chip-format-menu" style={{ top: formatFor.top, left: formatFor.left }}>
            <span className="cfm-head">Number as</span>
            {NUMBER_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={(formatFor.el.dataset.format ?? "arabic") === f ? "selected" : ""}
                onClick={() => {
                  const name = formatFor.el.dataset.var as VariableName;
                  formatFor.el.dataset.format = f;
                  formatFor.el.textContent = chipLabel(name, f);
                  setFormatFor(null);
                  emit();
                }}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {showToolbar ? (
      <div className="chip-bar">
        <div className="chip-picker">
          <button
            type="button"
            className="btn secondary chip-tab-btn"
            aria-expanded={chipMenu}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setChipMenu((v) => !v)}
          >
            Insert chip…
          </button>
          {chipMenu ? (
            <>
              <div className="menu-scrim" role="presentation" onClick={() => setChipMenu(false)} />
              <div className="menu chip-menu">
                {CHIPPABLE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setChipMenu(false);
                      insert(
                        `${ZWSP}<span data-var="${n}" contenteditable="false">${chipLabel(n)}</span>${ZWSP}`,
                      );
                    }}
                  >
                    {VARIABLES[n].label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className="btn secondary chip-tab-btn"
          title="Advance to the next tab stop — spacing set by the format's tab stop"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(`${ZWSP}<span data-tab="1" contenteditable="false">⇥</span>${ZWSP}`)}
        >
          ⇥ Tab
        </button>
      </div>
      ) : null}
    </div>
  );
});


/**
 * The chip and tab controls, separated from the field so a caller can place
 * them wherever its toolbar wants them. Mousedown is suppressed throughout:
 * the caret must survive being reached for.
 */
export function ChipTools({ editor }: { editor: React.RefObject<ChipEditorHandle | null> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="chip-picker">
        {/* Sized like the mark buttons so the whole line reads as one set of
            controls; the list it opens can be as large as it needs to be. */}
        <button
          type="button"
          className="be-mark"
          title="Insert a chip"
          aria-label="Insert a chip"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <Braces size={13} />
        </button>
        {open ? (
          <>
            <div className="menu-scrim" role="presentation" onClick={() => setOpen(false)} />
            <div className="menu chip-menu">
              {CHIPPABLE.map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    editor.current?.insertVariable(n);
                  }}
                >
                  {VARIABLES[n].label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="be-mark"
        title="Advance to the next tab stop — spacing set by the format's tab stop"
        aria-label="Insert a tab stop"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.current?.insertTab()}
      >
        <ArrowRightToLine size={13} />
      </button>
    </>
  );
}
