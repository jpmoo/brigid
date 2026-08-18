import { useEffect, useRef, useState } from "react";
import { Send, Square, Trash2 } from "lucide-react";
import { apiUrl } from "../../../base.js";
import { ApiError, api } from "../../../api.js";
import type { ProseDna } from "../../../api.js";
import { Markdown } from "./Markdown.js";
import { ManuscriptDraft } from "./ManuscriptDraft.js";

/**
 * Talking about the manuscript, once both analyses are in.
 *
 * The brief is assembled on the server from findings already made rather than
 * from the prose — they are better context than the manuscript would be, and
 * they carry positions and judgments that could not be recomputed per question.
 *
 * Streamed, because an answer of any length outlasts what a proxy will hold a
 * silent request open for, and because watching a reply arrive is the
 * difference between a conversation and a form submission.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Written by the measurement rather than typed, and prunable because of it. */
  retry?: boolean;
}

export function ChatPane({ workId, ready }: { workId: string; ready: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [clearing, setClearing] = useState(false);
  /**
   * The writer's own measurements, so a passage the model writes can be held
   * against them the moment it arrives. Fetched once and kept: the extractor is
   * shared and pure, so the comparison itself costs nothing and needs no
   * server. Null if no fingerprint has been taken, in which case the prose is
   * shown without one rather than not shown.
   */
  const [dna, setDna] = useState<ProseDna | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .proseDna(workId)
      .then((found) => {
        if (alive) setDna(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workId]);

  /**
   * The conversation is kept, so returning to this tab picks up where it left
   * off — and a follow-up like "and the other one?" still has the turn before
   * it to refer to.
   */
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void api
      .getChatHistory(workId)
      .then(({ messages: held }) => {
        if (alive) setMessages(held);
      })
      .catch(() => {
        // An empty transcript is indistinguishable from a failed read here, and
        // neither is worth an error over an unasked question.
      });
    return () => {
      alive = false;
    };
  }, [workId, ready]);

  /**
   * Nothing scrolls the page while a reply is arriving.
   *
   * Three attempts to follow the answer politely all failed the same way, and
   * each fix was a better guess about which element to watch and when to let
   * go. The reader's complaint never changed: they could not read while it
   * wrote. At some point the honest reading is that a page which moves itself
   * while someone is reading it is the problem, and the cleverness was only
   * ever damage control.
   *
   * So the text arrives and the view stays exactly where it was put. A reply
   * grows downward, which is what a reader who is at the bottom wants and what
   * a reader who is not can ignore. Anyone wanting the end asks for it, and the
   * button below appears while it is writing to make that one click.
   *
   * This gives up something real: at the bottom of a finished conversation, a
   * new answer no longer follows itself into view. That is a smaller cost than
   * not being able to read.
   */
  const log = useRef<HTMLDivElement | null>(null);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    const check = () => {
      const el = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
      setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    };
    check();
    window.addEventListener("scroll", check, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", check, { capture: true });
  }, []);

  /**
   * One previous attempt, and only one.
   *
   * Both extremes fail, and this went through each of them. Keeping every
   * attempt poisoned the context: by the fifth, the dominant pattern was the
   * model's own failures, the writer's notes were the oldest thing in the
   * window, and it answered by copying those notes back with extra full stops.
   * Dropping all of them broke it differently — the note says "your last
   * attempt came out at 6.0 words a sentence", which is not an instruction at
   * all if the attempt it describes is nowhere in the conversation. That is a
   * critique with its subject removed, and starting over from scratch each
   * time is a lottery rather than a revision.
   *
   * So a retry carries the writer's own request, the one draft being revised,
   * and the measurements of it. Enough to improve on, bounded so it cannot
   * accumulate: the third attempt sees the second, not the first and second
   * both, and the window holds one draft however many times it is asked.
   *
   * The attempt is passed in rather than taken from the end of the
   * conversation, because the button belongs to a particular passage and the
   * writer may well be asking again about an earlier one.
   */
  function historyFor(previous: string): Message[] {
    let last = -1;
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i]!.role === "user" && !messages[i]!.retry) last = i;
    }
    const upTo = last === -1 ? [] : messages.slice(0, last + 1);
    return [...upTo, { role: "assistant", content: "```manuscript\n" + previous + "\n```" }];
  }

  async function send(text?: string, previous?: string) {
    const asked = (text ?? draft).trim();
    if (!asked || streaming) return;

    const history: Message[] = [
      ...(previous ? historyFor(previous) : messages),
      { role: "user", content: asked, ...(previous ? { retry: true } : {}) },
    ];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abort.current = controller;

    try {
      const res = await fetch(apiUrl(`/works/${workId}/chat`), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        let message = `the model answered ${res.status}`;
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // Not JSON — the status is the useful part.
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let held = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        held += decoder.decode(value, { stream: true });
        // Rewriting the last message each time keeps the transcript one source
        // of truth rather than two that can disagree.
        setMessages([...history, { role: "assistant", content: held }]);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Stopped on purpose; whatever arrived stays.
      } else {
        setError(err instanceof Error ? err.message : "the model did not answer");
        setMessages(history);
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  }

  if (!ready) {
    return (
      <p className="tpl-note">
        Available once the story shape has been analyzed and at least one character has
        been profiled. Both are the context this works from &mdash; without them there
        would be nothing to talk about but the prose, which the model has not read.
      </p>
    );
  }

  return (
    <>
      <p className="tpl-note">
        Asks about this manuscript. It has its own story-shape findings, every character
        profile, and the event timeline with positions &mdash; and it pulls in the actual
        passages your question bears on, so it can talk about the sentences as well as
        the structure.
      </p>

      {error ? <div className="alert error">{error}</div> : null}

      {clearing ? (
        <div className="modal-backdrop" onClick={() => setClearing(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">Clear this conversation?</h2>
            <p className="card-subtitle">
              The whole transcript goes. Nothing else is affected &mdash; the analyses it
              draws on are untouched, and the next question starts from them as before.
            </p>
            <div className="modal-actions">
              <button className="btn secondary" type="button" onClick={() => setClearing(false)}>
                Keep it
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  void api
                    .clearChatHistory(workId)
                    .then(() => {
                      setMessages([]);
                      setClearing(false);
                    })
                    .catch((err: unknown) =>
                      setError(err instanceof ApiError ? err.message : "could not clear it"),
                    );
                }}
              >
                Clear it
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="chat-log" ref={log}>
        {messages.length === 0 ? (
          <p className="chat-empty">
            Try: &ldquo;Where does the midpoint actually fall?&rdquo; &middot; &ldquo;Who
            carries the Shadow function, and is it earned?&rdquo; &middot; &ldquo;Is the
            opening doing too much work?&rdquo; &middot; &ldquo;How would you describe
            the voice?&rdquo;
          </p>
        ) : null}

        {messages.map((message, i) => (
          <div className={`chat-turn ${message.role}`} key={i}>
            <span className="chat-who">{message.role === "user" ? "You" : "Brigid"}</span>
            <div className="chat-body">
              {message.content ? (
                // The writer's own words are shown as typed; the model's are
                // rendered, because it writes Markdown whether or not anyone
                // asked and asterisks are not emphasis.
                message.role === "assistant" ? (
                  <Markdown
                    text={message.content}
                    onManuscript={(prose, key) => (
                      <ManuscriptDraft
                        key={key}
                        prose={prose}
                        dna={dna}
                        streaming={streaming}
                        onRetry={streaming ? undefined : (note) => void send(note, prose)}
                      />
                    )}
                  />
                ) : (
                  message.content
                )
              ) : (
                <span className="chat-waiting">Thinking&hellip;</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {!atEnd && streaming ? (
        <button
          className="btn ghost chat-catchup"
          type="button"
          onClick={() => {
            const el = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
        >
          Jump to the latest
        </button>
      ) : null}

      <div className="chat-ask">
        <textarea
          rows={2}
          value={draft}
          placeholder="Ask about the manuscript…"
          disabled={streaming}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; shift-enter is a new line, as everywhere else.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {messages.length > 0 && !streaming ? (
          <button
            className="btn ghost"
            type="button"
            title="Clear this conversation"
            onClick={() => setClearing(true)}
          >
            <Trash2 size={14} />
            Clear
          </button>
        ) : null}
        {streaming ? (
          <button className="btn secondary" type="button" onClick={() => abort.current?.abort()}>
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button className="btn" type="button" disabled={!draft.trim()} onClick={() => void send()}>
            <Send size={14} />
            Ask
          </button>
        )}
      </div>
    </>
  );
}
