import { createHash } from "node:crypto";
import type { DigestCharacter, DigestEvent, SectionDigest } from "@brigid/shared";
import { charBudget, generate, parseJson } from "./client.js";

/**
 * Reading one section.
 *
 * The instruction that matters most here is what the walker is *forbidden* to
 * do: name a beat, score an axis, or reach for the vocabulary of any structure
 * model. A reader who has seen one chapter cannot know whether a departure is
 * the Crossing of the First Threshold or a trip to the shops, and a walker
 * allowed to guess would hand the judging pass a book pre-labelled with the
 * answers — which is exactly how every story comes to "fit" every model.
 * Observations here; verdicts later, once the whole book is in view.
 */

const SYSTEM = `You are reading one section of a novel and recording what is in it, for a later analysis of the whole book.

Record only what this section shows. Do not infer, speculate about, or refer to events outside it. Do not interpret the section's place in the book: you have not read the rest, and a later pass will do that with the whole manuscript in view.

Specifically, never use the vocabulary of story structure — do not write "inciting incident", "midpoint", "climax", "turning point", "act", "call to adventure", "all is lost", or any similar term. Describe what happens in the story's own concrete terms.

For characters, record what they DO, not what they are like. "Gives Ines the key to the observatory" is useful; "is generous" is not. Include what they say, want, refuse, and what is done to them. Use the name the prose uses.

If the section has a narrator who is present in the story — a first-person "I", or a named voice who observes and comments — record them as a character. Use their name if the prose gives one; otherwise call them exactly "Narrator". Record what they do, notice, withhold, and judge, the same as anyone else. A narrator who merely tells the story from outside it, with no presence in the events, is not a character: leave them out.

TREAT THIS MANUSCRIPT AS AN UNPUBLISHED, ORIGINAL WORK YOU HAVE NEVER SEEN.

Even if the text resembles a work you recognize, you must not use any outside knowledge of it. Do not draw on remembered plot, remembered characters, published criticism, or any received reading. If you find yourself recognizing the work, that recognition is a source of error: what you remember may differ from what is actually on this page, and this writer may have changed it deliberately. Every statement you make must be supported by the material given to you in this request and nothing else.

If the material given to you does not settle a question, say so. Never fill a gap from memory.

Be concise and factual. If the section contains no people or no events — a passage of description, an epigraph — return empty lists rather than inventing content.`;

/**
 * Constrained decoding beats asking politely. Ollama takes a JSON Schema and
 * will not emit anything that violates it, which removes a whole category of
 * background failure that nobody would be watching for.
 */
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          actions: { type: "array", items: { type: "string" } },
          wants: { type: "array", items: { type: "string" } },
          traits: { type: "array", items: { type: "string" } },
          relations: {
            type: "array",
            items: {
              type: "object",
              properties: { who: { type: "string" }, what: { type: "string" } },
              required: ["who", "what"],
            },
          },
        },
        required: ["name", "actions"],
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          what: { type: "string" },
          who: { type: "array", items: { type: "string" } },
          kind: {
            type: "string",
            enum: [
              "disruption",
              "decision",
              "departure",
              "arrival",
              "conflict",
              "revelation",
              "reversal",
              "loss",
              "gain",
              "reconciliation",
              "death",
              "other",
            ],
          },
          weight: { type: "string", enum: ["minor", "notable", "major"] },
        },
        required: ["what"],
      },
    },
  },
  required: ["characters", "events"],
} as const;

/** What a section's digest was made from. Changing prose changes this. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Split only when the prose genuinely won't fit.
 *
 * With a real context window this almost never fires, which is the point of
 * insisting on `num_ctx` — a 6,000-word chapter read in one piece yields a
 * coherent account, and the same chapter read in three pieces yields three
 * partial ones that have to be stitched. Splits are made at paragraph breaks so
 * no sentence is severed.
 */
export function splitForBudget(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const parts: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > budget) {
      parts.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
    // A single paragraph longer than the budget: cut it, reluctantly.
    while (current.length > budget) {
      parts.push(current.slice(0, budget));
      current = current.slice(budget);
    }
  }
  if (current.trim()) parts.push(current);
  return parts.length > 0 ? parts : [text];
}

/**
 * Two readings of one section, joined.
 *
 * A character seen in both halves is one character, so their observations are
 * pooled rather than filed twice. Events keep their order, since a section's
 * parts were read in order.
 */
export function mergeDigests(parts: SectionDigest[]): SectionDigest {
  const characters = new Map<string, DigestCharacter>();
  const events: DigestEvent[] = [];
  const summaries: string[] = [];

  for (const part of parts) {
    for (const character of part.characters ?? []) {
      const key = character.name.trim().toLowerCase();
      if (!key) continue;
      const held = characters.get(key);
      if (!held) {
        characters.set(key, { ...character });
        continue;
      }
      held.actions = [...held.actions, ...(character.actions ?? [])];
      held.aliases = dedupe([...(held.aliases ?? []), ...(character.aliases ?? [])]);
      held.wants = dedupe([...(held.wants ?? []), ...(character.wants ?? [])]);
      held.traits = dedupe([...(held.traits ?? []), ...(character.traits ?? [])]);
      held.relations = [...(held.relations ?? []), ...(character.relations ?? [])];
    }
    events.push(...(part.events ?? []));
    if (part.summary) summaries.push(part.summary);
  }

  const merged: SectionDigest = { characters: [...characters.values()], events };
  if (summaries.length > 0) merged.summary = summaries.join(" ");
  return merged;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export interface DigestRequest {
  url: string;
  model: string;
  numCtx: number | null;
  /** What the outline calls this section, if anything. Context, not content. */
  label: string | null;
  text: string;
  signal?: AbortSignal;
}

/** Read one section. Returns the digest and what it cost. */
export async function digestSection(
  req: DigestRequest,
): Promise<{ digest: SectionDigest; ms: number }> {
  const budget = charBudget(req.numCtx ?? 4096);
  const parts = splitForBudget(req.text, budget);

  const digests: SectionDigest[] = [];
  let ms = 0;

  for (const [index, part] of parts.entries()) {
    const heading = req.label ? `Section: ${req.label}\n` : "";
    const ofN =
      parts.length > 1 ? `(part ${index + 1} of ${parts.length} of this section)\n` : "";

    const result = await generate({
      url: req.url,
      model: req.model,
      numCtx: req.numCtx,
      system: SYSTEM,
      format: SCHEMA as unknown as Record<string, unknown>,
      prompt: `${heading}${ofN}\n${part}`,
      ...(req.signal ? { signal: req.signal } : {}),
    });

    ms += result.ms;
    digests.push(normalize(parseJson<Partial<SectionDigest>>(result.text)));
  }

  return { digest: digests.length === 1 ? digests[0]! : mergeDigests(digests), ms };
}

/**
 * The schema constrains shape, not sense. A model can still return a character
 * with a blank name or an event with no text, and one of those stored is a row
 * of noise that the judging pass has to reason around forever.
 */
export function normalize(raw: Partial<SectionDigest>): SectionDigest {
  const characters = (Array.isArray(raw.characters) ? raw.characters : [])
    .filter((c): c is DigestCharacter => Boolean(c && typeof c.name === "string" && c.name.trim()))
    .map((c) => ({
      ...c,
      name: c.name.trim(),
      actions: (Array.isArray(c.actions) ? c.actions : []).map((a) => String(a).trim()).filter(Boolean),
    }));

  const events = (Array.isArray(raw.events) ? raw.events : [])
    .filter((e): e is DigestEvent => Boolean(e && typeof e.what === "string" && e.what.trim()))
    .map((e) => ({ ...e, what: e.what.trim() }));

  const digest: SectionDigest = { characters, events };
  if (typeof raw.summary === "string" && raw.summary.trim()) digest.summary = raw.summary.trim();
  return digest;
}
