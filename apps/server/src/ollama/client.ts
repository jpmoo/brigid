/**
 * Talking to Ollama.
 *
 * The one thing worth knowing about this file: **Ollama does not give a model
 * its own context window unless asked.** The default `num_ctx` is small — a
 * couple of thousand tokens — and it applies no matter what the model can
 * actually hold. Worse, exceeding it is silent: the prompt is truncated from
 * the front and the model answers confidently about the half of the chapter it
 * was shown. For a tool whose whole job is reading long prose, that failure
 * mode would be invisible and would poison every judgment downstream.
 *
 * So the window is read from the model when it is chosen, stored, and sent on
 * every request.
 */

/** What `/api/show` reports, of the little we need. */
interface ShowResponse {
  model_info?: Record<string, unknown>;
  parameters?: string;
  details?: { parameter_size?: string };
}

/**
 * The model's real context length.
 *
 * Ollama reports it under an architecture-prefixed key — `llama.context_length`,
 * `qwen2.context_length`, `gemma3.context_length` — so the architecture is not
 * worth enumerating; any key ending in `.context_length` is the one. A model
 * that doesn't report one gets a conservative floor rather than a guess.
 */
export function contextLengthFrom(show: ShowResponse): number | null {
  const info = show.model_info ?? {};
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
      return value;
    }
  }

  // Some builds only surface it as a set parameter, in modelfile syntax.
  const declared = /^\s*num_ctx\s+(\d+)\s*$/m.exec(show.parameters ?? "");
  if (declared) {
    const n = Number(declared[1]);
    if (n > 0) return n;
  }

  return null;
}

/** Ask a host what a model can hold. Null when it won't say. */
export async function contextLengthOf(url: string, model: string): Promise<number | null> {
  const answer = await fetch(`${url}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!answer.ok) return null;
  return contextLengthFrom((await answer.json()) as ShowResponse);
}

/**
 * Roughly how many characters fit in a window.
 *
 * Tokenizers vary and Ollama doesn't expose one, so this is deliberately
 * pessimistic: 3 characters per token against a window that also has to hold
 * the instructions and the answer. Being wrong in this direction costs a
 * needless split; being wrong the other way costs silent truncation.
 */
export function charBudget(numCtx: number): number {
  const forAnswer = Math.min(2048, Math.floor(numCtx * 0.25));
  return Math.max(2000, (numCtx - forAnswer) * 3);
}

export interface GenerateOptions {
  url: string;
  model: string;
  /** The model's full window. Sent as `num_ctx` — see the note at the top. */
  numCtx: number | null;
  system?: string;
  prompt: string;
  /** A JSON Schema. Ollama constrains decoding to it, which beats asking. */
  format?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  ms: number;
  /** What the model was actually given, if it says — useful for diagnosis. */
  promptTokens: number | null;
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const started = Date.now();

  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    stream: false,
    options: {
      // The whole point of this file. Null only when the model refused to say
      // what it can hold, in which case Ollama's default is all there is.
      ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}),
      // Reading a chapter is not a creative act; the same prose should digest
      // the same way twice, or the digest churns on every re-read.
      temperature: 0,
    },
  };
  if (opts.system) body.system = opts.system;
  if (opts.format) body.format = opts.format;

  // A long chapter through a large model on modest hardware is genuinely slow,
  // and this runs in the background where nobody is waiting on it.
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const answer = await fetch(`${opts.url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!answer.ok) {
    const detail = await answer.text().catch(() => "");
    throw new Error(`Ollama answered ${answer.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const parsed = (await answer.json()) as { response?: string; prompt_eval_count?: number };
  return {
    text: parsed.response ?? "",
    ms: Date.now() - started,
    promptTokens: typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : null,
  };
}

/**
 * The answer, as an object.
 *
 * Constrained decoding makes malformed JSON rare but not impossible, and some
 * models still wrap it in a fenced block or a sentence of preamble. Rather than
 * fail a chapter over punctuation, the outermost braces are found and parsed.
 */
export function parseJson<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through to salvage.
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      // Fall through to the error below.
    }
  }

  throw new Error(`the model's answer was not JSON: ${trimmed.slice(0, 200)}`);
}
