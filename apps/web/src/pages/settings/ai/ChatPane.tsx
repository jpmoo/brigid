import { useEffect, useRef, useState } from "react";
import { Send, Square, Trash2 } from "lucide-react";
import { apiUrl } from "../../../base.js";
import { ApiError, api } from "../../../api.js";
import { Markdown } from "./Markdown.js";

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
  const foot = useRef<HTMLDivElement | null>(null);
  const [clearing, setClearing] = useState(false);

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
   * Follow the answer only while the reader is at the bottom.
   *
   * Scrolling up during a long reply means wanting to read what has already
   * arrived, and yanking the view back down every time a token lands makes that
   * impossible — the reader loses a fight with the machine. So the log is
   * pinned to the bottom only if it was at the bottom to begin with, and
   * scrolling away silently stops the following until you come back.
   */
  const log = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned) foot.current?.scrollIntoView({ block: "end" });
  }, [messages, pinned]);

  async function send() {
    const asked = draft.trim();
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
        Available once the story shape has been analysed and at least one character has
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

      <div
        className="chat-log"
        ref={log}
        onScroll={() => {
          const el = log.current;
          if (!el) return;
          // A little slack: "at the bottom" should survive a stray pixel.
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
        }}
      >
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
                  <Markdown text={message.content} />
                ) : (
                  message.content
                )
              ) : (
                <span className="chat-waiting">Thinking&hellip;</span>
              )}
            </div>
          </div>
        ))}
        <div ref={foot} />
      </div>

      {!pinned && streaming ? (
        <button
          className="btn ghost chat-catchup"
          type="button"
          onClick={() => {
            setPinned(true);
            foot.current?.scrollIntoView({ block: "end", behavior: "smooth" });
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
