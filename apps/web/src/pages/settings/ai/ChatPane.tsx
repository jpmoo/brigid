import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { apiUrl } from "../../../base.js";

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

  // Follow the answer as it arrives, which is the point of streaming it.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: "end" });
  }, [messages]);

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

      <div className="chat-log">
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
              {message.content || <span className="chat-waiting">Thinking&hellip;</span>}
            </div>
          </div>
        ))}
        <div ref={foot} />
      </div>

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
