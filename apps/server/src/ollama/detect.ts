/**
 * What is answering at that address.
 *
 * Brigid talks to a model the writer runs. Which server they run it with is
 * their business — Ollama, llama.cpp, LM Studio, vLLM, anything that speaks the
 * OpenAI shape — so rather than ask them to say, the address is probed and the
 * answer decides.
 *
 * Two protocols, tried in order — but listing is not proof.
 *
 * Ollama is tried first, because when it is genuine it can say things nothing
 * else can: which models are installed, how large a window each one holds,
 * whether a model reasons. That is worth a great deal, and it is why Ollama
 * gets a model picker and the others do not.
 *
 * `/api/tags` alone is not enough to call it, though. llama.cpp ships a
 * compatibility shim that answers `/api/tags` — because tools that only know
 * how to *list* Ollama models are common enough to be worth placating — without
 * implementing `/api/generate` or `/api/chat` behind it. A server can be
 * genuinely present, genuinely listing models, and still 404 on every actual
 * request, forever, if listing is all that was verified. So a second, cheap
 * call confirms the part that matters: `/api/show`, which Brigid needs anyway
 * to read a model's context window, and which a listing-only shim has no
 * reason to have bothered implementing.
 *
 * Only when both answer is it called Ollama. Anything that lists but cannot
 * show falls through to the OpenAI shape, which most of the rest speak. It
 * lists what it is serving and little else — usually one model, already chosen
 * when the server was started, with nothing for a picker to pick.
 */

export type Provider = "ollama" | "openai";

export interface Detected {
  provider: Provider;
  /** What it is serving. One entry, usually, on anything but Ollama. */
  models: string[];
  /**
   * The window, where the server will say. Ollama says per model, and llama.cpp
   * says for the one it loaded. Most of the rest do not say at all, and a
   * number invented here would be worse than none: too large and every request
   * fails, too small and the manuscript is silently truncated.
   */
  numCtx: number | null;
  /**
   * Whether a model reasons, when Ollama's `/api/show` said and there is a
   * model to ask about. Read here rather than a second time later, since the
   * verification call already had to make it.
   */
  thinks: boolean | null;
}

const timeout = () => AbortSignal.timeout(8000);

async function json(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: timeout() });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Ollama's own list. Necessary, and — since llama.cpp shims it too — not sufficient. */
async function askOllama(base: string): Promise<string[] | null> {
  const found = (await json(`${base}/api/tags`)) as { models?: { name?: string }[] } | null;
  if (!found || !Array.isArray(found.models)) return null;
  return found.models.map((m) => m.name).filter((n): n is string => typeof n === "string");
}

/**
 * The verification. `/api/show` is Ollama's own metadata call — no inference,
 * cheap, and part of the real API rather than a listing convenience — so a
 * server that goes to the trouble of shimming `/api/tags` for tool
 * compatibility but stops there will 404 here. A real Ollama, or anything that
 * chose to implement this much of the API, answers with the model's details.
 */
async function askOllamaShow(
  base: string,
  model: string,
): Promise<{ numCtx: number | null; thinks: boolean | null } | null> {
  try {
    const res = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: timeout(),
    });
    if (!res.ok) return null;
    const show = (await res.json()) as {
      model_info?: Record<string, unknown>;
      capabilities?: string[];
    };
    if (!show || typeof show !== "object") return null;

    const ctxKey = Object.keys(show.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const numCtx = ctxKey ? Number(show.model_info?.[ctxKey]) : null;
    return {
      numCtx: Number.isFinite(numCtx) && numCtx! > 0 ? numCtx : null,
      thinks: Array.isArray(show.capabilities) ? show.capabilities.includes("thinking") : null,
    };
  } catch {
    return null;
  }
}

/** The OpenAI listing, which nearly everything else serves. */
async function askOpenAi(base: string): Promise<string[] | null> {
  const found = (await json(`${base}/v1/models`)) as { data?: { id?: string }[] } | null;
  if (!found || !Array.isArray(found.data)) return null;
  return found.data.map((m) => m.id).filter((id): id is string => typeof id === "string");
}

/**
 * llama.cpp says what it loaded with, and it is the one OpenAI-compatible
 * server common enough to be worth asking specially. Everything else returns
 * nothing here, which is the honest answer for a server that never said.
 */
async function llamaContext(base: string): Promise<number | null> {
  const props = (await json(`${base}/props`)) as
    | { default_generation_settings?: { n_ctx?: number }; n_ctx?: number }
    | null;
  const found = props?.default_generation_settings?.n_ctx ?? props?.n_ctx;
  return typeof found === "number" && found > 0 ? found : null;
}

/**
 * Probe an address and say what is there.
 *
 * Null when nothing answers either way, which the caller reports as "nothing is
 * listening" rather than guessing at a protocol and failing later with
 * something less useful.
 */
export async function detect(base: string): Promise<Detected | null> {
  const ollama = await askOllama(base);
  if (ollama) {
    const verified = ollama[0] ? await askOllamaShow(base, ollama[0]) : null;
    if (verified) {
      return { provider: "ollama", models: ollama, numCtx: verified.numCtx, thinks: verified.thinks };
    }
    // Listed, but could not be shown: a listing-only shim, not real Ollama.
    // Fall through and ask the other way.
  }

  const openai = await askOpenAi(base);
  if (openai) {
    return {
      provider: "openai",
      models: openai,
      numCtx: await llamaContext(base),
      thinks: null,
    };
  }

  return null;
}
