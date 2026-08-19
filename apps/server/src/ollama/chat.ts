import { measure } from "@brigid/shared";
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
  /**
   * The writer's own voice, measured and described.
   *
   * Carried into the conversation because a question about how something is
   * written, or a request to write something that sounds like them, cannot be
   * answered from summaries of what happens. The card steers; the exemplars
   * are what actually transfer a voice; the targets are what the answer can be
   * checked against afterwards.
   */
  dna?: {
    card: string;
    targets: { label: string; value: string }[];
    /** The section furthest from their usual, as contrast. */
    unlike?: { label: string; text: string } | null;
    exemplars: { label: string; text: string }[];
  };
  /**
   * The writer's own marks on the manuscript.
   *
   * Not derived from anything and not the model's work: a bookmark is a place
   * somebody deliberately flagged and a note they left themselves about it,
   * which makes it the most direct statement of intent in the whole brief. It
   * is also how a writer refers to a passage in conversation — "the bookmark
   * halfway through 14.4" — so the position within the section matters as much
   * as the name.
   */
  bookmarks?: {
    name: string;
    description: string | null;
    /** Which section, and where in the book that section falls. */
    section: string;
    at: number;
    /** Where in the section, when the mark names a line rather than the whole. */
    line: { index: number; of: number; text: string } | null;
  }[];
}

const SYSTEM = `You are discussing an unpublished manuscript with the writer who wrote it.

You have read this manuscript already. The structural analysis, the character role profiles, and the event timeline below are your own prior work on it — you produced them by reading the book section by section, and the writer has reviewed and corrected the record they were built from.

So do not say the writer "provided" or "specified" any of it, and do not present a finding as something you were told. These are your conclusions. Own them: say "the midpoint falls at 54%", not "the analysis you gave me says the midpoint falls at 54%". If you disagree with something in your earlier analysis on reflection, say so directly.

Answer from this material. It is the record; your memory of any book it resembles is not.

TWO KINDS OF MATERIAL, AND THEY MUST NOT BE CONFUSED.

Everything under STORY SHAPE, CHARACTERS and EVENT TIMELINE is YOUR OWN NOTES. You wrote them. They are compressed paraphrase - "Gives Ines the key to the observatory" is your summary of a scene, not a line from it. Nothing in them is in the writer's words, nothing in them is quotable, and nothing in them tells you anything at all about how the book is written.

Only what appears under MANUSCRIPT PASSAGES is the writer's actual prose. Those are their sentences, verbatim.

So:
- Quote ONLY from MANUSCRIPT PASSAGES. Never repeat a line from your notes as though it were text from the book, and never present a summary as something the writer wrote.
- Any question about the WRITING - voice, style, rhythm, diction, dialogue, sentence-level pacing, whether a passage works - can be answered only from MANUSCRIPT PASSAGES. Your notes are silent on all of it. If the passages here do not cover what was asked, say so and say which part of the book you would need.
- Questions about STRUCTURE and ROLE are the reverse: answer those from your notes, which cover the whole book, rather than generalising from whichever few passages happen to be quoted here.

THIS IS AN ORIGINAL, UNPUBLISHED WORK. If it resembles something you recognize, that resemblance is a trap: what you remember of the published book may differ from what is actually here, and this writer may have changed it deliberately. Use only the material in this brief and the passages quoted in it. If they do not settle a question, say so plainly and say what would settle it — never fill the gap from memory.

WRITING IN THE WRITER'S VOICE.

If YOUR VOICE appears below, you have a measured description of how this writer writes and passages of their own prose to work from. When they ask you to revise a section, draft one, or continue something, use it.

- Work from the exemplars first. The measurements tell you what to aim at; the exemplars tell you what it sounds like. Imitate the second, check yourself against the first.
- Put every piece of prose you write for them inside a fenced block opened with \`\`\`manuscript and closed with \`\`\`. Nothing else goes in those fences — no notes, no headings, no explanation. Everything you want to say about the passage goes outside them.
- Revising means revising. Keep what happens, keep who is there, keep the order of events; a revision that changes the story is a different scene, not a better version of this one.
- What you must NOT keep is the draft's form. Its paragraphing, its punctuation and its lack of either carry no authority whatever. Drafts arrive as dictation, as a transcript of a voice recording, as a wall of notes with no full stops in it — that is a fact about how the writer captured the material, not about how the scene should read. The exemplars show you how their finished prose is set. The draft does not.
- So: notes and half-finished lines are instructions to you, not prose to preserve — write what they were reaching for. A block of unbroken text becomes paragraphs. Missing punctuation gets supplied. Speech buried in a transcript — "and then she said well I don't know" — is a line of dialogue, and comes back as one, in its own paragraph, in quotation marks.
- Never return more than a hundred words of prose as a single paragraph. If the draft you were given was one block, that is the strongest possible sign it needs breaking up, not a pattern to copy.
- Say plainly, outside the fence, what you changed and what you were unsure of. If a note in the draft was ambiguous, say which way you read it.
- Never claim the result sounds like them. You produced an imitation from measurements and samples; whether it lands is theirs to judge.

HOW PROSE INSIDE THOSE FENCES MUST BE SET. This is a manuscript, not a chat reply, and it is going to be pasted straight into one.

- Paragraphs are separated by a blank line. Never run a scene together as one block, and never use a single line break to end a paragraph.
- Speech goes in double quotation marks: "I told you," he said. Straight quotes — the application typesets them on the way in.
- A new speaker begins a new paragraph, always, including for a one-word reply.
- Punctuate inside the closing quote: a comma before a speech tag ("Wait," she said), a period when the speech ends the sentence ("Wait." She turned.).
- No markdown of any kind inside the fence. No headings, no bullets, no asterisks for emphasis — italics are the manuscript's business, not yours.
- No labels, no scene numbers, no "Revised version:" line. Only the prose itself, exactly as it should appear on the page.

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
  return `=== STORY SHAPE (your notes: paraphrase, not the writer's words) ===\n${structure.overview}\n\nBest fit: ${structure.bestFit ?? "none clearly"}. ${structure.bestFitWhy}\n\nFramework by framework:\n${rated}`;
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
/**
 * Whether a section is finished prose or the notes it was captured as.
 *
 * Measured rather than guessed at, and told to the model outright. A transcript
 * of a voice recording is one unbroken block with no quotation marks in it, and
 * a model handed that alongside "revise this" reads the shape as intentional
 * and gives back another block. Saying so removes the ambiguity — and the
 * evidence is exactly the same arithmetic the fingerprint runs on, so it costs
 * nothing and cannot be wrong about what it counted.
 */
function shapeNote(text: string): string {
  const m = measure(text);
  if (m.words < 80) return "";

  const found: string[] = [];
  if (m.paragraphs <= 1 && m.words > 150) {
    found.push(`${m.words} words in one unbroken paragraph`);
  }
  const quotes = (text.match(/["“”]/g) ?? []).length;
  if (quotes === 0 && /\b(said|says|asked|told|replied)\b/i.test(text)) {
    found.push("speech reported with no quotation marks anywhere in it");
  }
  const stops = (text.match(/[.!?]/g) ?? []).length;
  if (m.words > 200 && stops < m.words / 45) {
    found.push("almost no sentence punctuation");
  }

  if (found.length === 0) return "";
  return `\n[RAW MATERIAL: ${found.join("; ")}. That is how this was captured — dictation, a transcript, or notes — and not how it should read. Its shape tells you nothing about how to set the prose; the exemplars tell you that.]`;
}

function passagesFor(context: ChatContext, room: number): string {
  const prose = context.prose;
  if (!prose || room < 800) return "";

  const asked = (context.question ?? "").toLowerCase();
  const terms = [...new Set(asked.split(/[^a-z0-9']+/).filter((w) => w.length > 3))];

  /**
   * A section the question names outright.
   *
   * "Revise 14.4 in my voice" is unanswerable from an excerpt: a revision has
   * to be of the whole thing, and half a scene rewritten is worse than none.
   * So a label appearing in the question wins the space it needs before
   * anything else is chosen, and arrives whole however long it is.
   *
   * Matched on the label as written — the numbering a writer sees in the
   * outline is what they will type — and bounded so a bare "4" cannot claim
   * every section whose label contains one.
   */
  const mentions = (label: string): boolean => {
    const clean = label.trim().toLowerCase();
    if (clean.length < 2) return false;
    return new RegExp(`(^|[^\\w.])${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w.]|$)`).test(asked);
  };

  /**
   * Sections the question names, whether by their own label or by a bookmark
   * in them.
   *
   * "Revise the bit at the bookmark called Hinge" names a section as surely as
   * "revise 14.4" does — the writer simply knows the place by what they called
   * it rather than by its number. Matched on the bookmark's whole name, and on
   * any distinctive word of it, since names are written to be recognized rather
   * than typed exactly.
   */
  const byBookmark = new Set(
    (context.bookmarks ?? [])
      .filter((mark) => {
        if (mentions(mark.name)) return true;
        const words = mark.name.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 4);
        return words.some((w) => asked.includes(w));
      })
      .map((mark) => mark.section.toLowerCase()),
  );

  const named = context.sections.filter(
    (section) =>
      mentions(section.label ?? "") ||
      byBookmark.has((section.label ?? "").trim().toLowerCase()),
  );

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

  const wanted = new Set(named.map((n) => n.blockId));
  const whole = named
    .map((section) => ({ section, text: prose.get(section.blockId) ?? "" }))
    .filter((n) => n.text.trim());

  // What the named sections do not take, shared among the rest.
  let left = room - whole.reduce((sum, n) => sum + n.text.length + 80, 0);

  const chosen = scored
    .filter((s) => s.text.trim() && s.score > 0 && !wanted.has(s.section.blockId))
    .sort((a, b) => b.score - a.score || a.section.start - b.section.start)
    .slice(0, left > 1200 ? 4 : 0);

  if (chosen.length === 0 && whole.length === 0) return "";

  // Split evenly, so one long chapter cannot crowd out the other three.
  const each = chosen.length > 0 ? Math.floor((left - 200) / chosen.length) : 0;
  const blocks = [...whole, ...chosen]
    .sort((a, b) => a.section.start - b.section.start)
    .map(({ section, text }) => {
      const at = `${Math.round(section.start * 100)}%`;
      const entire = wanted.has(section.blockId);
      const body = entire || text.length <= each ? text : `${text.slice(0, each)}…`;
      const note = entire ? " — COMPLETE, you were asked about this one" : "";
      const shape = entire ? shapeNote(text) : "";
      return `[${at}] ${section.label ?? "section"}${note}${shape}\n${body}`;
    });

  return `=== MANUSCRIPT PASSAGES ===
THE WRITER'S ACTUAL PROSE, VERBATIM. The only material here in their words, and the only material that can answer a question about the writing. Quote from this and nowhere else.

${blocks.join("\n\n- - - - -\n\n")}
=== END OF MANUSCRIPT PASSAGES ===`;
}

/**
 * The writer's bookmarks, listed so they can be referred to.
 *
 * Each carries the note left with it and the line it marks, so a question about
 * "the one where I wondered about the timeline" can be answered from the note
 * and the passage rather than from a guess about which place was meant.
 *
 * Position is given twice and in words: where the section falls in the book,
 * and where the mark falls in the section. "Halfway through 14.4" is how a
 * writer says it, and a paragraph number alone does not answer that.
 */
function bookmarksBrief(marks: NonNullable<ChatContext["bookmarks"]>): string {
  if (marks.length === 0) return "";

  const where = (line: { index: number; of: number }): string => {
    if (line.of <= 1) return "the whole section";
    const through = line.index / Math.max(1, line.of - 1);
    if (through <= 0.12) return "at the start";
    if (through <= 0.38) return "about a third in";
    if (through <= 0.62) return "about halfway through";
    if (through <= 0.88) return "about two thirds in";
    return "near the end";
  };

  const lines = marks.map((mark) => {
    const place = mark.line
      ? `${mark.section}, ${where(mark.line)} (paragraph ${mark.line.index + 1} of ${mark.line.of})`
      : mark.section;
    const note = mark.description?.trim() ? `\n  note: ${mark.description.trim()}` : "";
    const marked = mark.line?.text.trim() ? `\n  marks: "${mark.line.text.trim()}"` : "";
    return `- "${mark.name}" — ${place} [${Math.round(mark.at * 100)}% of the book]${note}${marked}`;
  });

  return `=== BOOKMARKS (the writer's own marks and notes, not yours) ===
Places this writer flagged, with whatever they wrote to themselves about each. These are their words, not a summary of anything. When they refer to a bookmark — by name, by what the note says, or by where it falls — this is what they mean.

${lines.join("\n")}
=== END OF BOOKMARKS ===`;
}

/**
 * The writer's voice, for questions about how the book is written.
 *
 * The card is the description; the targets are the handful of numbers an answer
 * can be measured against afterwards; the exemplars are passages of the
 * writer's own prose closest to the middle of everything they have written.
 *
 * The exemplars are the part that does the work. A model cannot be steered by
 * statistics — nothing conditions generation on a mean sentence length — but it
 * imitates a sample readily. The numbers are for checking, not for steering.
 */
function voiceBrief(dna: NonNullable<ChatContext["dna"]>): string {
  const parts = [
    "=== YOUR VOICE (measured from the sections the writer counts as typical of them) ===",
  ];
  if (dna.card.trim()) parts.push(dna.card.trim());
  if (dna.targets.length > 0) {
    parts.push(
      `What the measurements say:\n${dna.targets
        .map((t) => `- ${t.label}: ${t.value}`)
        .join("\n")}`,
    );
  }
  if (dna.exemplars.length > 0) {
    parts.push(
      `WRITE LIKE THIS — their own prose, verbatim, from the sections closest to the middle of everything they have written. This is what "in my voice" means. Imitate the cadence, the punctuation, the distance; do not borrow the content.\n\n${dna.exemplars
        .map((e) => `--- ${e.label} ---\n${e.text}`)
        .join("\n\n")}`,
    );
  }
  parts.push("=== END OF YOUR VOICE ===");
  /**
   * The far end of the same book.
   *
   * A model shown only what to sound like has nothing to measure that against,
   * and every sample it is given reads as equally central. This one is the
   * furthest from their usual — which is a fact about distance, not about
   * quality, and the wording has to keep those apart. A writer's oddest section
   * is often their best one, or a letter, or a different narrator on purpose,
   * and telling a model it is bad prose to be avoided would teach it to flatten
   * exactly the range it is meant to be reproducing.
   */
  if (dna.unlike) {
    parts.push(
      `LESS LIKE THIS — also their own prose, from the section that sits furthest from their usual. It is not worse writing, and it may be deliberate; it is simply the least representative thing they have written. Use it to see where the edge of the voice is. When writing as them, sound nearer the passages above than this one.\n\n--- ${dna.unlike.label} ---\n${dna.unlike.text}`,
    );
  }

  return parts.join("\n\n");
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

  // Before anything else: it is short, and a request to write in the writer's
  // voice is unanswerable without it while everything else degrades gracefully.
  if (context.dna) add(voiceBrief(context.dna));

  // Short, and the most direct statement of intent in the brief: a place the
  // writer flagged and what they said about it.
  if (context.bookmarks && context.bookmarks.length > 0) {
    add(bookmarksBrief(context.bookmarks));
  }

  if (context.structure) add(shapeBrief(context.structure));

  if (context.profiles.length > 0) {
    const heads = ["=== CHARACTERS (your notes: each action summarizes a scene, it is not a line from it) ==="];
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
    parts.push(`=== EVENT TIMELINE (your notes: paraphrase of what happens) ===${kept}`);
  }

  return parts.join("\n\n");
}

export { SYSTEM as CHAT_SYSTEM };
