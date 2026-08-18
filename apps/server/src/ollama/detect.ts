/**
 * What is answering at that address.
 *
 * Brigid talks to a model the writer runs. Which server they run it with is
 * their business — Ollama, llama.cpp, LM Studio, vLLM, anything that speaks the
 * OpenAI shape — so rather than ask them to say, the address is probed and the
 * answer decides.
 *
 * Two protocols, tried in order:
 *
 * Ollama first, because its `/api/tags` is unambiguous and because it can say
 * things nothing else can: which models are installed, how large a window each
 * one holds, and whether a model reasons. That is worth a great deal, and it is
 * why Ollama gets a model picker and the others do not.
 *
 * Then the OpenAI shape, which most of the rest speak. It lists what it is
 * serving and little else. Usually that is one model, already chosen when the
 * server was started, and there is nothing for a picker to pick.
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

/** Ollama's own list, which is also how Ollama is recognized. */
async function askOllama(base: string): Promise<string[] | null> {
  const found = (await json(`${base}/api/tags`)) as { models?: { name?: string }[] } | null;
  if (!found || !Array.isArray(found.models)) return null;
  return found.models.map((m) => m.name).filter((n): n is string => typeof n === "string");
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
  if (ollama) return { provider: "ollama", models: ollama, numCtx: null };

  const openai = await askOpenAi(base);
  if (openai) {
    return { provider: "openai", models: openai, numCtx: await llamaContext(base) };
  }

  return null;
}
