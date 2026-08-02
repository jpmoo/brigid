import type { CharacterAnalysis, PlacedDigest, StructureAnalysis } from "@brigid/shared";
import { AXIS_LABELS, MODEL_LABELS } from "./frameworks.js";
import { charBudget } from "./client.js";
import { timelineFor } from "./analysis.js";

/**
 * Talking about the manuscript, with the findings already in hand.
 *
 * Not a fresh reading. Both analyses have been made and paid for, and they are
 * a far better brief than the prose would be: the timeline carries positions
 * the model could not otherwise compute, and a profile carries a judgment it
 * would have to redo from scratch every question. So the context is assembled
 * from what is known rather than retrieved from what was written.
 *
 * The one hard constraint is the window. A novel's worth of findings will not
 * fit either, so the brief is built in order of what a question is most likely
 * to need, and cut where it runs out.
 */

export interface ChatContext {
  title: string;
  totalWords: number;
  structure: StructureAnalysis | null;
  profiles: CharacterAnalysis[];
  sections: PlacedDigest[];
  /** The actual prose, by section, for questions the findings cannot answer. */
  prose?: Map<string, string>;
  /** What was just asked, so the passages chosen bear on it. */
  question?: string;
}

const SYSTEM = `You are discussing an unpublished manuscript with the writer who wrote it.

You have read this manuscript already. The structural analysis, the character role profiles, and the event timeline below are your own prior work on it — you produced them by reading the book section by section, and the writer has reviewed and corrected the record they were built from.

So do not say the writer "provided" or "specified" any of it, and do not present a finding as something you were told. These are your conclusions. Own them: say "the midpoint falls at 54%", not "the analysis you gave me says the midpoint falls at 54%". If you disagree with something in your earlier analysis on reflection, say so directly.

Answer from this material. It is the record; your memory of any book it resembles is not.

THIS IS AN ORIGINAL, UNPUBLISHED WORK. If it resembles something you recognize, that resemblance is a trap: what you remember of the published book may differ from what is actually here, and this writer may have changed it deliberately. Use only the material in this brief and the passages quoted in it. If they do not settle a question, say so plainly and say what would settle it — never fill the gap from memory.

Cite positions when they matter — the timeline gives each section's place as a percentage of the book, and a claim about where something falls should carry one.

You are talking to the author about their own work. Be direct and specific. Do not flatter, and do not soften a structural problem into a compliment; a writer asking about their manuscript wants the answer, not encouragement. Where the analyses disagree with each other, or rest on thin evidence, say so.`;

/** One character's profile, compressed to what a conversation needs. */
function brief(profile: CharacterAnalysis): string {
  const carried = profile.axes
    .filter((a) => a.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((a) => `${AXIS_LABELS[a.axis as keyof typeof AXIS_LABELS] ?? a.axis} ${a.score}`)
    .join(", ");
  const shifts = profile.phaseShifts.length ? `\n  Shifts: ${profile.phaseShifts.join("; ")}` : "";
  return `${profile.name} — ${carried || "flat profile"}\n  ${profile.summary}${shifts}`;
}

/** The structure findings, as a paragraph rather than a table. */
function shapeBrief(structure: StructureAnalysis): string {
  const rated = structure.models
    .map(
      (m) =>
        `  ${MODEL_LABELS[m.model as keyof typeof MODEL_LABELS] ?? m.model}: ${m.fit} — ${m.summary}`,
    )
    .join("\n");
  return `STORY SHAPE\n${structure.overview}\n\nBest fit: ${structure.bestFit ?? "none clearly"}. ${structure.bestFitWhy}\n\nFramework by framework:\n${rated}`;
}

/**
 * Which passages to quote.
 *
 * The findings answer questions about shape and role; they cannot answer a
 * question about the writing, because a summary of a scene has none of the
 * sentences in it. So some real prose comes too, chosen by overlap between the
 * question and what each section says.
 *
 * Crude on purpose — term overlap, not embeddings. There is no vector store
 * here and adding one for a single-user tool would be a great deal of machinery
 * for a ranking that only has to beat "the first three sections". The opening
 * is always included regardless: questions about voice are usually questions
 * about how the book starts, and it is the passage a writer is most likely to
 * have in mind.
 */
function passagesFor(context: ChatContext, room: number): string {
  const prose = context.prose;
  if (!prose || room < 800) return "";

  const asked = (context.question ?? "").toLowerCase();
  const terms = [...new Set(asked.split(/[^a-z0-9']+/).filter((w) => w.length > 3))];

  const scored = context.sections.map((section) => {
    const text = prose.get(section.blockId) ?? "";
    const hay = `${section.label ?? ""} ${section.summary ?? ""} ${text.slice(0, 4000)}`.toLowerCase();
    let score = 0;
    for (const term of terms) if (hay.includes(term)) score += 1;
    // The opening, always: a question about the writing is usually a question
    // about how it begins.
    if (section.start === 0) score += 2;
    return { section, text, score };
  });

  const chosen = scored
    .filter((s) => s.text.trim() && s.score > 0)
    .sort((a, b) => b.score - a.score || a.section.start - b.section.start)
    .slice(0, 4);
  if (chosen.length === 0) return "";

  // Split evenly, so one long chapter cannot crowd out the other three.
  const each = Math.floor((room - 200) / chosen.length);
  const blocks = chosen
    .sort((a, b) => a.section.start - b.section.start)
    .map(({ section, text }) => {
      const at = `${Math.round(section.start * 100)}%`;
      const body = text.length <= each ? text : `${text.slice(0, each)}…`;
      return `[${at}] ${section.label ?? "section"}\n${body}`;
    });

  return `PASSAGES FROM THE MANUSCRIPT (verbatim — quote from these when discussing the writing itself)\n\n${blocks.join("\n\n---\n\n")}`;
}

/**
 * The brief, assembled to fit.
 *
 * Ordered by what a question about a manuscript most often turns on: the shape
 * first, because it is short and almost always relevant; then the cast, because
 * most questions are about somebody; then the timeline, which is the longest
 * and the first thing to lose. Cutting the timeline costs detail; cutting the
 * profiles would cost the ability to answer at all.
 */
export function buildBrief(context: ChatContext, numCtx: number | null): string {
  // Two thirds of the window, leaving room for the conversation and the answer.
  const budget = Math.floor(charBudget(numCtx ?? 8192) * 0.66);
  const parts: string[] = [
    `MANUSCRIPT: "${context.title}" — ${context.totalWords.toLocaleString()} words, ${context.sections.length} sections.`,
  ];
  let spent = parts[0]!.length;

  const add = (text: string): boolean => {
    if (spent + text.length > budget) return false;
    parts.push(text);
    spent += text.length;
    return true;
  };

  if (context.structure) add(shapeBrief(context.structure));

  if (context.profiles.length > 0) {
    const heads = ["CHARACTERS"];
    for (const profile of context.profiles) {
      const line = brief(profile);
      if (spent + line.length > budget) break;
      heads.push(line);
      spent += line.length;
    }
    parts.push(heads.join("\n\n"));
  }

  /**
   * Prose takes its share before the timeline does. A question the timeline
   * could answer is usually one the shape and the profiles already answered;
   * a question about the writing can only be answered from the writing, so
   * losing the passages costs more than losing the tail of a timeline.
   */
  const left = budget - spent - 40;
  const passages = passagesFor(context, Math.floor(left * 0.55));
  if (passages) {
    parts.push(passages);
    spent += passages.length;
  }

  // Whatever remains goes to the timeline, trimmed from the end rather than
  // omitted — half a timeline still places the first half of the book.
  const timeline = timelineFor(context.sections);
  const room = budget - spent - 40;
  if (room > 500) {
    const kept = timeline.length <= room ? timeline : `${timeline.slice(0, room)}\n…(timeline truncated)`;
    parts.push(`EVENT TIMELINE${kept}`);
  }

  return parts.join("\n\n");
}

export { SYSTEM as CHAT_SYSTEM };
