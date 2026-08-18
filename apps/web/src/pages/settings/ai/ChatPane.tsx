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
   * Whatever actually scrolls this pane, found rather than assumed.
   *
   * Twice now the following has moved the wrong thing, both times because the
   * code named a scroller instead of looking for one. A component cannot know
   * what encloses it — the page scrolls today, a future layout might hand it a
   * scrolling column — so it walks up and asks, and falls back to the document.
   */
  const scrollerOf = (el: HTMLElement | null): HTMLElement | null => {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }
    return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  };

  /**
   * Follow the answer only while the reader is at the bottom.
   *
   * Scrolling up during a long reply means wanting to read what has already
   * arrived, and dragging the view back down every time a token lands makes
   * that impossible — the reader loses a fight with the machine.
   *
   * The guard has to watch the scroller the reader is actually using, which is
   * what the two previous attempts got wrong. Listening on window in the
   * capture phase catches scroll from anywhere in the pane: scroll does not
   * bubble, but it does capture, so this sees the document scrolling and any
   * nested scroller a later layout introduces without having to be told about
   * either.
   *
   * The slack is generous. On a page-sized scroller "at the bottom" is a
   * looser idea than it is in a small box — a reader who has nudged the wheel
   * a line or two has not gone anywhere, and unpinning them for it would make
   * the following feel broken rather than considerate.
   */
  const log = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const onScroll = () => {
      const el = scrollerOf(log.current);
      if (!el) return;
      setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const el = scrollerOf(log.current);
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pinned]);

  async function send(text?: string) {
    const asked = (text ?? draft).trim();
    if (!asked || streaming) return;

    const history: Message[] = [...messages, { role: "user", content: asked }];
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
                        /* Only on the finished passage: measuring prose that is
                           still arriving would report a half-written draft. */
                        onRetry={streaming ? undefined : (note) => void send(note)}
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

      {!pinned && streaming ? (
        <button
          className="btn ghost chat-catchup"
          type="button"
          onClick={() => {
            setPinned(true);
            const el = scrollerOf(log.current);
            el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
