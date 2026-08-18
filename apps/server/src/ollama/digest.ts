import { createHash } from "node:crypto";
import { foldName } from "./analysis.js";
import type { DigestCharacter, DigestEvent, SectionDigest } from "@brigid/shared";
import { charBudget, generateJson } from "./client.js";
import type { Provider } from "./detect.js";

/**
 * Reading one section.
 *
 * The instruction that matters most here is what the walker is *forbidden* to
 * do: name a beat, score an axis, or reach for the vocabulary of any structure
 * model. A reader who has seen one chapter cannot know whether a departure is
 * the Crossing of the First Threshold or a trip to the shops, and a walker
 * allowed to guess would hand the judging pass a book pre-labeled with the
 * answers — which is exactly how every story comes to "fit" every model.
 * Observations here; verdicts later, once the whole book is in view.
 */

const SYSTEM = `You are reading one section of a novel and recording what is in it, for a later analysis of the whole book.

Record only what this section shows. Do not infer, speculate about, or refer to events outside it. Do not interpret the section's place in the book: you have not read the rest, and a later pass will do that with the whole manuscript in view.

Specifically, never use the vocabulary of story structure — do not write "inciting incident", "midpoint", "climax", "turning point", "act", "call to adventure", "all is lost", or any similar term. Describe what happens in the story's own concrete terms.

For characters, record ONLY actions that show what someone DOES TO THE STORY. This record exists to decide each character's role, and nothing else — so an action earns its place only if it would help answer one of these questions:

  - Does this character carry the story's central change, and pay for it?
  - Do they teach, equip, warn, or give someone what they need?
  - Do they oppose someone, wish them harm, or tempt them into betraying themselves?
  - Is their loyalty or truthfulness in doubt?
  - Do they disrupt, deceive, mock, break a rule, or refuse the terms?
  - Do they accompany, help, rescue, or stand by someone at a cost?
  - Do they test, block, admit, refuse, or set a condition someone must meet?
  - Do they compete for the same prize as someone else, or claim their credit?
  - Are they sought, protected, courted, awaited, or held as the reason for someone's action?
  - Are they lost, spent, or sacrificed — and does something come of it?

Write each as one plain sentence naming who did what to whom: "Gives Ines the key to the observatory." "Refuses to say where the boy went." "Stays behind so the others can cross."

Leave out everything else. Do not record travel, meals, greetings, what a room looked like, what someone wore, or that a conversation took place. Do not record character traits — "is generous" is not an action. A section where nobody does anything of this kind should return few characters or none, and that is a correct answer. Three telling actions are worth more than twenty incidental ones.

THE NARRATOR. ALWAYS record the voice telling this section as a character. There is no judgment to make here and no exception: every section has a narrator, and it goes in the list every time. Use the name the prose gives it if it has one; otherwise call it exactly "Narrator".

Recording it is not the same as recording everything it does. A narrator with a personality has an attitude in every paragraph, and writing each one down produces hundreds of lines like "Asserts they do not presume" — true, and useless. AT MOST TWO narratorial actions per section, and often none.

An action of the voice earns its place only if it is CONSEQUENTIAL — if it changes what the reader knows or believes, in a way an ordinary character's action would be scored for:
  - It withholds something from the reader that matters later, or reveals something no character knows.
  - It passes judgment that steers how the reader takes a character, rather than merely coloring a sentence.
  - It addresses the reader directly, or breaks the frame of the telling.
  - It is shown to be unreliable, mistaken, or hiding its own stake in events.

Do NOT record ordinary narration with attitude: a wry aside, an ironic contrast, a summary of what someone thinks, a remark on manners or society. That is the voice being itself, not the voice doing something. If nothing consequential happens, give the narrator an empty action list — a narrator who merely tells this section well is a correct and useful finding.

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
 * Has the prose changed in a way that changes what happens in it?
 *
 * Not the same question as whether it changed at all, and the reading walk is
 * only ever asking this one. A digest says who is present, what they do and
 * what it costs; none of that turns on where the paragraphs fall, so whitespace
 * is normalized away and reflowing a section does not spend an hour of a
 * machine's time re-learning a scene it already knows.
 *
 * The style measurements deliberately do not use this. Where the paragraphs
 * fall is exactly what they are measuring, so they keep the exact hash — the
 * two questions want different answers and had been sharing one.
 */
export function hashProse(text: string): string {
  return hashContent(text.replace(/\s+/g, " ").trim());
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
      /**
       * No longer gathered, but still merged. A section long enough to be read
       * in parts is merged here, and a digest written before these fields were
       * dropped would lose half its record if only the new fields survived.
       */
      held.wants = dedupe([...(held.wants ?? []), ...(character.wants ?? [])]);
      held.relations = [...(held.relations ?? []), ...(character.relations ?? [])];
      held.traits = dedupe([...(held.traits ?? []), ...(character.traits ?? [])]);
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
  provider?: Provider | null;
  apiKey?: string | null;
  /** Whether the model thinks, so the working can be switched off. */
  thinks?: boolean | null;
  /** What the outline calls this section, if anything. Context, not content. */
  label: string | null;
  text: string;
  /**
   * Everyone already named earlier in this book. Each section is read on its
   * own, so without this the reader has no idea the person it wants to call
   * "Brother Tuan" was called "Tuan" three chapters ago — and the roster gets
   * two characters with half a record each.
   */
  known?: string[];
  signal?: AbortSignal;
}

/**
 * The cast so far, handed to the reader as the spellings to prefer.
 *
 * Capped, because a long book's cast would crowd out the prose it is meant to
 * help read. The most recently seen are the ones a section is most likely to
 * be about.
 */
function namesInUse(known: string[] | undefined): string {
  if (!known?.length) return "";
  const shown = known.slice(0, 60);
  return `CHARACTERS ALREADY NAMED EARLIER IN THIS BOOK:\n${shown.join(", ")}\n\nIf someone in this section is one of them, use that EXACT name in "name" and put the wording this section uses in "aliases". A title or a count is not a new person: if the text says "Brother Tuan" and "Tuan" is listed above, the name is "Tuan" and "Brother Tuan" is an alias. Only introduce a new name for someone genuinely not listed.\n`;
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

    const result = await generateJson<Partial<SectionDigest>>({
      url: req.url,
      model: req.model,
      numCtx: req.numCtx,
      provider: req.provider ?? null,
      apiKey: req.apiKey ?? null,
      thinks: req.thinks ?? null,
      system: SYSTEM,
      format: SCHEMA as unknown as Record<string, unknown>,
      prompt: `${heading}${ofN}${namesInUse(req.known)}\n${part}`,
      ...(req.signal ? { signal: req.signal } : {}),
    });

    ms += result.ms;
    digests.push(ground(normalize(result.value), part, req.known ?? []));
  }

  return { digest: digests.length === 1 ? digests[0]! : mergeDigests(digests), ms };
}

/**
 * The schema constrains shape, not sense. A model can still return a character
 * with a blank name or an event with no text, and one of those stored is a row
 * of noise that the judging pass has to reason around forever.
 */
/**
 * Throw out characters the section never mentions.
 *
 * Asked "who is in this section", a model has no reason not to answer, and an
 * under-constrained one will promote a passing noun, carry someone over from a
 * chapter it half-remembers, or invent a plausible name outright. Everything
 * downstream inherits that: a roster entry, a spider graph, a profile scored on
 * events that never happened.
 *
 * This is checkable rather than merely askable, because the text is right here.
 * A character survives if either:
 *
 *  - some part of their name, or one of their aliases, appears in the prose —
 *    a name in the text is a name the reading did not invent; or
 *  - the book has already established them, in which case naming them from a
 *    pronoun is resolution rather than invention, and is the behavior the
 *    known-names list was added to encourage.
 *
 * Anything meeting neither test was invented in this section, and goes.
 */
export function ground(
  digest: SectionDigest,
  text: string,
  known: string[],
): SectionDigest {
  const prose = text.toLowerCase();
  const established = new Set(known.map((k) => k.trim().toLowerCase()));

  /** Any distinctive word of the name, so "Colonel Ash" matches "Ash". */
  const mentioned = (name: string): boolean => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return false;
    if (prose.includes(trimmed)) return true;
    return trimmed
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !TITLE_WORDS.has(word))
      .some((word) => prose.includes(word));
  };

  const characters = digest.characters.filter((character) => {
    /**
     * The narrating voice is never named in the prose it narrates, so the test
     * below would delete it every time — which is precisely how it went missing
     * before. It is recorded unconditionally now, and the writer discards it on
     * reconcile if this book's narrator is not a character.
     */
    if (foldName(character.name) === "narrator") return true;
    if (established.has(character.name.trim().toLowerCase())) return true;
    if (mentioned(character.name)) return true;
    return (character.aliases ?? []).some((alias) => mentioned(alias));
  });

  /**
   * An event attributed to somebody who was never here is kept, but the
   * attribution is dropped: the event may well have happened, and losing it
   * would cost more than an unattributed line does.
   */
  const surviving = new Set(characters.map((c) => c.name.trim().toLowerCase()));
  const events = digest.events.map((event) => ({
    ...event,
    who: (event.who ?? []).filter((who) => surviving.has(who.trim().toLowerCase())),
  }));

  return { ...digest, characters, events };
}

/** Too common to ground a name on — "Mr" appears on every other page. */
const TITLE_WORDS = new Set([
  "mr",
  "mrs",
  "ms",
  "the",
  "and",
  "old",
  "young",
  "man",
  "men",
  "woman",
  "women",
  "boy",
  "girl",
  "lady",
  "sir",
  "one",
  "two",
  "his",
  "her",
  "who",
  "that",
  "them",
  "they",
]);

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
