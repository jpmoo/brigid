import type { ReactNode } from "react";
import { findProse } from "./voice-check.js";

/**
 * Just enough Markdown for a model's answer.
 *
 * Models write in Markdown whether or not anyone asked, so a reply set as plain
 * text arrives full of asterisks and pipe characters. This renders the parts
 * they actually use — emphasis, code, headings, lists, tables, quotes — and
 * leaves the rest as the text it is.
 *
 * Built as React nodes rather than by setting innerHTML. A chat reply is model
 * output quoting a manuscript, which is about as untrusted as text in this app
 * gets; building nodes means there is no escaping to get wrong, because nothing
 * is ever parsed as HTML.
 */

/** Emphasis, code, and links, inside one line. */
function inline(text: string, keyed = 0): ReactNode[] {
  const out: ReactNode[] = [];
  // Ordered so the longest marker wins: ** before *, ~~ before ~.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/;

  let rest = text;
  let n = keyed;
  for (;;) {
    const found = pattern.exec(rest);
    if (!found || found.index === undefined) break;

    if (found.index > 0) out.push(rest.slice(0, found.index));
    const token = found[0];
    const key = `i${n++}`;

    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("[")) {
      // Rendered as its text, not as a link. Nothing here should be clickable:
      // the model is quoting a manuscript, not citing the web.
      out.push(<span key={key}>{/\[([^\]]+)\]/.exec(token)?.[1] ?? token}</span>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    rest = rest.slice(found.index + token.length);
  }
  if (rest) out.push(rest);
  return out;
}

/** A table, if these lines are one. Markdown tables need the divider row. */
function tableAt(lines: string[], from: number): { node: ReactNode; next: number } | null {
  const head = lines[from];
  const rule = lines[from + 1];
  if (!head?.includes("|") || !rule || !/^[\s|:-]+$/.test(rule) || !rule.includes("-")) return null;

  const cells = (line: string) =>
    line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

  const headers = cells(head);
  const rows: string[][] = [];
  let at = from + 2;
  while (at < lines.length && lines[at]?.includes("|")) {
    rows.push(cells(lines[at]!));
    at += 1;
  }

  return {
    node: (
      <div className="md-table-wrap" key={`t${from}`}>
        <table className="md-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{inline(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    next: at,
  };
}

export function Markdown({
  text,
  onManuscript,
  settled = true,
}: {
  text: string;
  /**
   * How to draw a block of prose the model wrote for the manuscript.
   *
   * Fenced like code because a fence is the only thing in markdown that holds
   * text exactly as given, but it is not code and must not be set as code —
   * and it is the one part of an answer that can be measured against the
   * writer's own fingerprint, which is what the caller does with it.
   */
  onManuscript?: (prose: string, key: string) => ReactNode;
  /** False while tokens are still arriving. */
  settled?: boolean;
}) {
  /**
   * Prose the model wrote for the manuscript without saying so.
   *
   * It is told to fence manuscript prose and often does not, and the fence is
   * what earns a passage its page, its measurements and its button to ask
   * again. An unfenced draft got none of them — rendered as chat, unchecked,
   * with nothing to do about it but retype the request.
   *
   * Only once the reply has finished. Deciding this from a half-arrived message
   * would frame the first paragraph as a manuscript and then unframe it when
   * the sentence explaining it turned up, and a block that appears and
   * disappears under a reader is worse than one that appears late.
   *
   * Skipped entirely when the model did fence it — that path already works, and
   * guessing alongside it could only disagree with it.
   */
  if (onManuscript && settled && !/^\s*```manuscript/m.test(text)) {
    const found = findProse(text);
    if (found) {
      return (
        <>
          {found.before ? <Markdown text={found.before} /> : null}
          {onManuscript(found.prose, "u0")}
          {found.after ? <Markdown text={found.after} /> : null}
        </>
      );
    }
  }

  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at]!;

    // A fenced block runs to its closing fence, or to the end while streaming.
    if (line.trim().startsWith("```")) {
      const tag = line.trim().slice(3).trim().toLowerCase();
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !lines[at]!.trim().startsWith("```")) {
        body.push(lines[at]!);
        at += 1;
      }
      at += 1;

      const prose = body.join("\n");
      if (tag === "manuscript" && onManuscript) {
        out.push(onManuscript(prose, `m${at}`));
        continue;
      }
      out.push(
        <pre className="md-pre" key={`p${at}`}>
          <code>{prose}</code>
        </pre>,
      );
      continue;
    }

    const table = tableAt(lines, at);
    if (table) {
      out.push(table.node);
      at = table.next;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = (["h4", "h5", "h6", "h6"] as const)[level - 1]!;
      out.push(
        <Tag className="md-h" key={`h${at}`}>
          {inline(heading[2]!)}
        </Tag>,
      );
      at += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push(<hr className="md-hr" key={`r${at}`} />);
      at += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (at < lines.length && /^\s*>\s?/.test(lines[at]!)) {
        body.push(lines[at]!.replace(/^\s*>\s?/, ""));
        at += 1;
      }
      out.push(
        <blockquote className="md-quote" key={`q${at}`}>
          {inline(body.join(" "))}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+/.test(line);
    const numbered = /^\s*\d+[.)]\s+/.test(line);
    if (bullet || numbered) {
      const items: string[] = [];
      const test = bullet ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/;
      while (at < lines.length && test.test(lines[at]!)) {
        items.push(lines[at]!.replace(test, ""));
        at += 1;
      }
      const List = bullet ? "ul" : "ol";
      out.push(
        <List className="md-list" key={`l${at}`}>
          {items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (!line.trim()) {
      at += 1;
      continue;
    }

    // Everything else is a paragraph, running until a blank line or a
    // construction that starts one of the blocks above.
    const body: string[] = [];
    while (at < lines.length) {
      const next = lines[at]!;
      if (
        !next.trim() ||
        next.trim().startsWith("```") ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+[.)]\s+/.test(next) ||
        /^\s*>\s?/.test(next) ||
        /^#{1,4}\s+/.test(next) ||
        tableAt(lines, at)
      ) {
        break;
      }
      body.push(next);
      at += 1;
    }
    out.push(
      <p className="md-p" key={`b${at}`}>
        {inline(body.join(" "))}
      </p>,
    );
  }

  return <>{out}</>;
}
