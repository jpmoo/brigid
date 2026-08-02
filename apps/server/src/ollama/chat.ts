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
}

const SYSTEM = `You are discussing an unpublished manuscript with the writer who wrote it.

You have been given a structural analysis, character role profiles, and an event timeline — all previously made from the manuscript itself. Answer from those. They are the record; your memory is not.

TREAT THIS MANUSCRIPT AS AN ORIGINAL WORK YOU HAVE NEVER SEEN. Even if it resembles something you recognize, do not use outside knowledge of it: what you remember may differ from what this writer actually wrote, and they may have changed it deliberately. If the brief does not settle a question, say so plainly and say what would settle it. Never fill a gap from memory.

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

  // Whatever is left goes to the timeline, trimmed from the end rather than
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
