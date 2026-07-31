import { useEffect, useRef } from "react";
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

function inlinesToHtml(inlines: readonly TemplateInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.type === "tab") return `<span data-tab="1" contenteditable="false">⇥</span>`;
      if (inline.type === "variable") {
        const fmt = inline.numberFormat ? ` data-format="${inline.numberFormat}"` : "";
        return `<span data-var="${inline.name}"${fmt} contenteditable="false">${
          VARIABLES[inline.name].label
        }</span>`;
      }
      const text = inline.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return text;
    })
    .join("");
}

function htmlToInlines(root: HTMLElement, marks: TemplateMarks): TemplateInline[] {
  const out: TemplateInline[] = [];
  const pushText = (text: string) => {
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
      return;
    }
    if (node.dataset.tab) {
      out.push({ type: "tab" });
      return;
    }
    // A <br> or a stray wrapper the browser inserted; descend and keep the text.
    if (node.tagName === "BR") {
      pushText(" ");
      return;
    }
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
}

export function ChipEditor({ value, marks, onChange, placeholder }: ChipEditorProps) {
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
    onChange(htmlToInlines(ref.current, marks));
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

  return (
    <div className="chip-editor">
      <div
        className="chip-field"
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        data-placeholder={placeholder ?? "Type here, or drop in a chip"}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => {
          // Single line: Enter would create a <div> the serializer would have to
          // guess at, and a template paragraph is one line by definition.
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Tab") {
            e.preventDefault();
            insert('<span data-tab="1" contenteditable="false">⇥</span>');
          }
        }}
        onPaste={(e) => {
          // Paste as plain text so foreign markup can't enter the template.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
          insert(text.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
        }}
      />

      <div className="chip-bar">
        <select
          value=""
          onChange={(e) => {
            const name = e.target.value as VariableName;
            if (!name) return;
            insert(
              `<span data-var="${name}" contenteditable="false">${VARIABLES[name].label}</span>`,
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
          title="Insert a tab stop"
          onClick={() => insert('<span data-tab="1" contenteditable="false">⇥</span>')}
        >
          ⇥ Tab
        </button>
      </div>
    </div>
  );
}
