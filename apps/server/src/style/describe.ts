import { eq, inArray } from "drizzle-orm";
import { blocks, styleProfiles, works } from "@brigid/db";
import {
  baselines,
  deviations,
  featureLabel,
  leastCharacteristic,
  mostCharacteristic,
} from "@brigid/shared";
import type { Baseline, StyleSample } from "@brigid/shared";
import { db } from "../db.js";
import { generateJson } from "../ollama/client.js";
import { readerOrFail } from "../ollama/reader.js";
import { refresh } from "./measure.js";
import { signature } from "./routes.js";

/**
 * The model reading the fingerprint.
 *
 * Everything the measuring side does works without a model. This is the part
 * that turns two hundred rates into something a person can act on, and it is
 * the only part that needs Ollama connected.
 *
 * The model is never asked to judge whether the writing is good. It is asked
 * what the numbers describe — and given passages to check its description
 * against, because a number without an example is an assertion and a writer has
 * no way to argue with it.
 */

const SYSTEM = `You are describing a novelist's prose style from measurements of their own manuscript, for the novelist themselves.

Rules:
- Describe, do not grade. Never say the writing is good, bad, strong or weak. The writer decides that; you are a mirror, not a judge.
- Every claim you make must rest on a number you were given or a passage you were shown. If neither supports it, do not say it.
- Numbers are evidence, not content. Write "sentences run long — around 24 words, where most novels sit nearer 15" rather than reciting rates.
- Address the writer as "you". Plain English, no jargon, no stylometry vocabulary.
- Comparisons to "most published fiction" are allowed only for the handful of measures where a rough norm is common knowledge: sentence length (typically 12-18 words), paragraph length, adverb use, and the share of dialogue. Say nothing comparative about the rest.
- Be specific and short. A writer who reads this should recognize themselves.`;

const SCHEMA = {
  type: "object",
  properties: {
    card: { type: "string" },
    commentary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
        },
        required: ["heading", "body"],
      },
    },
  },
  required: ["card", "commentary"],
} as const;

/** The features worth putting in front of a model, in an order that reads. */
const HEADLINE = [
  "sent.mean", "sent.sd", "sent.short", "sent.long", "sent.fragment",
  "punct.comma", "punct.semicolon", "punct.dash", "punct.ellipsis",
  "para.words", "para.single",
  "lex.ttr", "lex.syllables", "lex.latinate",
  "open.conjunction", "open.participle", "open.repeat",
  "pov.first", "pov.third", "pov.filtering", "pov.past",
  "mod.adverb", "mod.intensifier", "mod.hedge", "mod.negation",
  "tag.rate", "tag.said", "tag.adverb",
];

function readable(baseline: Baseline, dialogueShare: number): string {
  const lines: string[] = [];
  for (const key of HEADLINE) {
    const norm = baseline.overall[key];
    if (!norm) continue;
    const value = norm.mean;
    const shown = value >= 10 ? value.toFixed(0) : value.toFixed(2);
    // The spread as well, because "usually 24 words, sometimes 40" is a
    // different writer from "always 24".
    const spread = norm.sd >= 10 ? norm.sd.toFixed(0) : norm.sd.toFixed(2);
    lines.push(`- ${featureLabel(key)}: ${shown} (varies by about ${spread} between sections)`);
  }
  lines.push(`- share of words spoken aloud: ${(dialogueShare * 100).toFixed(0)}%`);
  return lines.join("\n");
}

/** How the writer's dialogue differs from their narration, where it does. */
function contrast(baseline: Baseline): string {
  const lines: string[] = [];
  for (const key of ["sent.mean", "sent.short", "punct.comma", "lex.syllables", "mod.hedge"]) {
    const n = baseline.narration[key];
    const d = baseline.dialogue[key];
    if (!n || !d) continue;
    const fmt = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(2));
    lines.push(`- ${featureLabel(key)}: ${fmt(n.mean)} narrating, ${fmt(d.mean)} in speech`);
  }
  return lines.join("\n");
}

/** A passage, trimmed to something a model can hold several of. */
function excerpt(text: string, words = 220): string {
  const parts = text.trim().split(/\s+/);
  return parts.length <= words ? text.trim() : `${parts.slice(0, words).join(" ")}…`;
}

export async function describe(
  workId: string,
  opts: { force: boolean },
): Promise<{ ok: true; card: string; commentary: { heading: string; body: string }[] }> {
  const config = await readerOrFail();

  const samples = await refresh(workId);
  const built = baselines(samples);
  const book = built.get(null);
  if (!book || book.sections === 0) {
    throw Object.assign(new Error("nothing is included in the fingerprint yet"), {
      statusCode: 400,
    });
  }

  const found = deviations(samples, built);
  const typicalIds = mostCharacteristic(found, samples, 5);
  const atypical = leastCharacteristic(found, samples, 3);

  const wanted = [...new Set([...typicalIds, ...atypical.map((a) => a.blockId)])];
  const passages =
    wanted.length > 0
      ? await db
          .select({ id: blocks.id, label: blocks.label, text: blocks.contentText })
          .from(blocks)
          .where(inArray(blocks.id, wanted))
      : [];
  const byId = new Map(passages.map((p) => [p.id, p]));

  const [work] = await db
    .select({ title: works.title })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);

  const spoken =
    samples.filter((s) => s.included).reduce((sum, s) => sum + s.measurement.words * s.measurement.dialogueShare, 0) /
    Math.max(1, book.words);

  const typicalText = typicalIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((p) => `--- ${p!.label || "Untitled"} ---\n${excerpt(p!.text)}`)
    .join("\n\n");

  const oddText = atypical
    .map((a) => {
      const p = byId.get(a.blockId);
      if (!p) return null;
      const why = a.moved
        .slice(0, 4)
        .map((m) => `${featureLabel(m.key.replace(/^\w+:/, ""))} ${m.z > 0 ? "well above" : "well below"} your usual`)
        .join("; ");
      return `--- ${p.label || "Untitled"} (${why}) ---\n${excerpt(p.text, 140)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const prompt = `MANUSCRIPT: "${work?.title ?? "Untitled"}" — ${book.words.toLocaleString()} words across ${book.sections} sections counted towards this profile.

MEASUREMENTS, averaged across everything counted:
${readable(book, spoken)}

NARRATION AGAINST SPEECH:
${contrast(book)}

PASSAGES MOST TYPICAL OF THIS WRITER — these sit closest to the middle of everything measured, so they are what the numbers above are describing:

${typicalText || "(none long enough to quote)"}

${oddText ? `PASSAGES LEAST LIKE THE REST, and what the measurements say moved:\n\n${oddText}\n` : ""}
Write two things.

"card": a short description of this writer's voice, three or four sentences, addressed to them. This is what will be shown to a model later when it is asked to write something that sounds like them, so it must be concrete and usable — the shape of the sentences, the punctuation habits, how close the narration stands, how speech is handled. Not praise, not a summary of the plot.

"commentary": four to six sections, each with a short heading and a paragraph. Cover: sentence rhythm; punctuation and paragraphing; word choice; how dialogue is written and attributed; how close the narrator stands to the scene. Where a passage above illustrates the point, quote a few words of it. If the numbers show a habit the writer may not have noticed — repeated sentence openings, heavy filtering, adverbs on speech tags — say so plainly and without recommending anything.`;

  const [existing] = await db
    .select()
    .from(styleProfiles)
    .where(eq(styleProfiles.workId, workId))
    .limit(1);

  const answer = await generateJson<{ card?: string; commentary?: { heading: string; body: string }[] }>({
    url: config.url,
    model: config.model,
    numCtx: config.numCtx,
    thinks: config.thinks ?? null,
    system: SYSTEM,
    format: SCHEMA as unknown as Record<string, unknown>,
    prompt,
  });

  const commentary = (answer.value.commentary ?? []).filter((c) => c?.heading && c?.body);
  /**
   * An edited card is the writer's own words about their own voice and outrank
   * the model's. Overwritten only when they ask for it in so many words.
   */
  const keepCard = existing?.cardEdited && !opts.force;
  const card = keepCard ? existing.card : (answer.value.card ?? "").trim();

  await db
    .insert(styleProfiles)
    .values({
      workId,
      card,
      cardEdited: keepCard ? true : false,
      exemplars: typicalIds,
      commentary,
      model: config.model,
      corpusSignature: signature(samples),
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: styleProfiles.workId,
      set: {
        ...(keepCard ? {} : { card, cardEdited: false }),
        exemplars: typicalIds,
        commentary,
        model: config.model,
        corpusSignature: signature(samples),
        generatedAt: new Date(),
      },
    });

  return { ok: true, card, commentary };
}
