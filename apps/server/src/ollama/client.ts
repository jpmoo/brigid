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
  /** "completion", "tools", "thinking", "vision" — what the model can do. */
  capabilities?: string[];
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

/**
 * Does this model think before answering?
 *
 * Null rather than false when Ollama doesn't say, because the two lead to
 * different behaviour: a model known not to think can be sent `think: false`
 * safely, while a model whose capabilities are unknown must not be — Ollama
 * rejects the field outright on a model that lacks the capability, and a
 * rejected request is worse than a slow one.
 */
export function thinksFrom(show: ShowResponse): boolean | null {
  if (!Array.isArray(show.capabilities)) return null;
  return show.capabilities.includes("thinking");
}

/** Ask a host about a model: what it can hold, and whether it thinks. */
export async function inspectModel(
  url: string,
  model: string,
): Promise<{ numCtx: number | null; thinks: boolean | null }> {
  const answer = await fetch(`${url}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!answer.ok) return { numCtx: null, thinks: null };
  const show = (await answer.json()) as ShowResponse;
  return { numCtx: contextLengthFrom(show), thinks: thinksFrom(show) };
}

/** Ask a host what a model can hold. Null when it won't say. */
export async function contextLengthOf(url: string, model: string): Promise<number | null> {
  return (await inspectModel(url, model)).numCtx;
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
  /**
   * Sent to Ollama directly. Only models with the capability accept the field,
   * so this is set from `thinks` rather than guessed at.
   */
  think?: boolean;
  /**
   * Whether the model reports a thinking capability, as detected when it was
   * chosen. True means `think: false` is safe to send; null means Ollama never
   * said, and the field must be left off entirely.
   */
  thinks?: boolean | null;
}

/** A call that ran out of time rather than one that answered badly. */
export class ModelTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelTimeout";
  }
}

export interface GenerateResult {
  text: string;
  /**
   * Reasoning models put their working here and their answer in `text`. When
   * `text` comes back empty this is usually where everything went, so it is
   * kept rather than discarded — it is the difference between "the model said
   * nothing" and "the model said plenty, in the wrong field".
   */
  thinking: string;
  ms: number;
  /** What the model was actually given, if it says — useful for diagnosis. */
  promptTokens: number | null;
  /** How many tokens came back. Zero with a `done_reason` is a real clue. */
  evalCount: number | null;
  /** "stop", "length", "load" — why generation ended. */
  doneReason: string | null;
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
  if (opts.think === false) body.think = false;

  /**
   * Generous, because this runs in the background where nobody is waiting.
   *
   * A whole-book dossier through a large model on modest hardware is slow in a
   * way that is not a fault — ten minutes was a guess, and profiling a
   * well-attested character in a 120,000-word manuscript went past it. The cap
   * exists only so a wedged Ollama is eventually noticed, not to enforce a
   * pace.
   */
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 45 * 60_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const answer = await fetch(`${opts.url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch((err: unknown) => {
    // A timeout arrives as an opaque DOMException; say what actually expired.
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      const mins = Math.round((opts.timeoutMs ?? 45 * 60_000) / 60_000);
      throw new ModelTimeout(
        `the model did not finish within ${mins} minutes — it may be loading a context window larger than this machine can hold`,
      );
    }
    throw err;
  });

  if (!answer.ok) {
    const detail = await answer.text().catch(() => "");
    throw new Error(`Ollama answered ${answer.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const parsed = (await answer.json()) as {
    response?: string;
    thinking?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
  };
  return {
    text: parsed.response ?? "",
    thinking: parsed.thinking ?? "",
    ms: Date.now() - started,
    promptTokens: typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : null,
    evalCount: typeof parsed.eval_count === "number" ? parsed.eval_count : null,
    doneReason: parsed.done_reason ?? null,
  };
}

/**
 * The answer, as an object — with the ways models get this wrong handled.
 *
 * Constrained decoding makes malformed JSON rare but not impossible. Reasoning
 * models emit their working first, sometimes fenced, sometimes wrapped in
 * <think> tags; others add a sentence of preamble. Rather than fail a chapter
 * over punctuation, the JSON is dug out.
 */
export function parseJson<T>(text: string): T {
  let trimmed = text.trim();

  // Some models emit their reasoning inline rather than in the thinking field.
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // And some fence the answer.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) trimmed = fenced[1].trim();

  if (!trimmed) throw new Error("the model returned nothing");

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

/**
 * Why nothing came back.
 *
 * An empty answer has several quite different causes and they need different
 * fixes, so the message names what was actually observed rather than saying
 * "not JSON" — which is what it said before, and which told nobody anything.
 */
function diagnose(result: GenerateResult, numCtx: number | null): string {
  if (result.thinking && !result.text) {
    return "the model spent its whole answer on reasoning and returned no result — it may not support constrained JSON output";
  }
  if (result.doneReason === "length") {
    return `the model ran out of room before finishing its answer${numCtx ? ` (context set to ${numCtx.toLocaleString()})` : ""}`;
  }
  if (result.evalCount === 0) {
    return `the model produced no tokens at all${numCtx ? ` — a context window of ${numCtx.toLocaleString()} may be more than this machine can load` : ""}`;
  }
  const seen = [
    result.doneReason ? `done_reason=${result.doneReason}` : null,
    result.evalCount !== null ? `${result.evalCount} tokens out` : null,
    result.promptTokens !== null ? `${result.promptTokens} tokens in` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `the model returned an empty answer${seen ? ` (${seen})` : ""}`;
}

/**
 * Ask for JSON, and keep asking in simpler ways if the model can't manage it.
 *
 * Three attempts, each dropping a requirement the previous one made:
 *
 *  1. A JSON Schema. Ollama constrains decoding to it, which is much the best
 *     answer — but schema support arrived in Ollama 0.5, and an older server
 *     ignores the field and returns prose, or nothing.
 *  2. `format: "json"`, the older and far more widely supported form. Weaker,
 *     since the shape is only asked for, but the normalizers downstream were
 *     written on the assumption that a model can return nonsense anyway.
 *  3. The same, with thinking switched off, for reasoning models that spend
 *     the entire budget on working and leave the answer empty.
 *
 * Each failure is remembered, so if all three fail the error says what was
 * tried and what came back rather than reporting only the last one.
 */
export async function generateJson<T>(opts: GenerateOptions): Promise<{ value: T; ms: number }> {
  /**
   * Thinking is switched off from the first attempt when the model supports it.
   * Reading a chapter is transcription, not reasoning: the working costs time
   * and tokens for no gain, and under a constrained format it is the single
   * likeliest reason an answer comes back empty.
   */
  const base: GenerateOptions = opts.thinks ? { ...opts, think: false } : opts;

  const attempts: { label: string; opts: GenerateOptions }[] = [
    { label: "schema", opts: base },
    { label: "json mode", opts: base },
    { label: "json mode, plain prompt", opts: { ...base, format: undefined } },
  ];

  // Attempt 2 wants Ollama's older string form, which the typed field can't
  // express — a server predating schema support ignores an object here.
  attempts[1]!.opts = { ...base };
  (attempts[1]!.opts as unknown as { format: string }).format = "json";

  const failures: string[] = [];
  let ms = 0;

  for (const attempt of attempts) {
    let result: GenerateResult;
    try {
      result = await generate(attempt.opts);
    } catch (err) {
      /**
       * Neither a transport failure nor a timeout is fixed by asking again in a
       * simpler way. The retries exist for a model that answers badly, not for
       * one that is slow — and three attempts at forty-five minutes each would
       * spend most of an afternoon proving the point.
       */
      throw err;
    }
    ms += result.ms;

    const text = result.text.trim() || result.thinking.trim();
    if (text) {
      try {
        return { value: parseJson<T>(text), ms };
      } catch (err) {
        failures.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    failures.push(`${attempt.label}: ${diagnose(result, opts.numCtx)}`);
  }

  throw new Error(failures.join("; "));
}
