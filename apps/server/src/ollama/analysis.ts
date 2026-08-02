import type {
  CharacterAnalysis,
  IdentityProposal,
  PlacedDigest,
  RosterEntry,
  StructureAnalysis,
} from "@brigid/shared";
import { generateJson } from "./client.js";
import {
  AXES,
  AXES_PRINCIPLES,
  AXIS_KEYS,
  MODEL_KEYS,
  MODEL_LABELS,
  STRUCTURE_MODELS,
  STRUCTURE_PRINCIPLES,
} from "./frameworks.js";

/**
 * Judging, once the whole book has been read.
 *
 * Everything here consumes the digest rather than the manuscript. That is what
 * makes whole-story judgments possible at all — a novel doesn't fit in a
 * context window, but an account of it does, and the account carries the
 * positions the structure models need.
 */

/** Below this, a character cannot produce a profile the rubric would accept. */
const MIN_ACTIONS = 6;
const MIN_SECTIONS = 2;

/**
 * Who is in the book, and who there is enough of to judge.
 *
 * Names are reconciled case-insensitively and through the aliases each section
 * recorded, so "the Colonel" and "Colonel Ash" don't become two people with
 * half a profile each.
 */
/**
 * Strings that are placeholders rather than names.
 *
 * Deliberately tiny. This used to catch "the narrator", "the author" and their
 * kin, which was wrong: whether a narrator is a character is a question about a
 * particular book, and plenty of books answer yes — an unnamed first-person
 * narrator with a presence throughout is the story's centre, not an artefact of
 * the reading. Deciding that in code meant the one character the writer most
 * wanted profiled could not be.
 *
 * What is left is only what could never name anybody: a reader's non-answer.
 * Everything else is the writer's call, and there is now a control for it — see
 * the excluded_characters table, which records that judgment per manuscript and
 * survives re-reads.
 */
const NOT_A_CHARACTER = new Set(["unknown", "none", "n/a", "na", "-", "unnamed", "nobody"]);

function isRealCharacter(name: string): boolean {
  return !NOT_A_CHARACTER.has(name.trim().toLowerCase());
}

/**
 * Words that only ever count or point, and never identify.
 *
 * A digest naming the same people twice is the commonest way the roster grows a
 * duplicate: one section writes "Two French brothers", the next writes "French
 * brothers", and they arrive as two characters with half a record each. Folding
 * these off the front settles it.
 *
 * Deliberately short, and deliberately not including honorifics. Dropping "Mr"
 * would fold Mr Bennet and Mrs Bennet into one person, which is a far worse
 * error than the one being fixed — a duplicate is untidy, a merge is wrong.
 */
const LEADING_NOISE = new Set([
  "a",
  "an",
  "the",
  "some",
  "several",
  "many",
  "few",
  "both",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "another",
  "other",
  "various",
  "assorted",
  "unnamed",
  "unknown",
]);

/**
 * The key two spellings of one name have in common.
 *
 * Lowercased, stripped of punctuation, and with counting words taken off the
 * front. Conservative on purpose: it merges what is plainly the same phrase and
 * leaves anything else alone.
 */
export function foldName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.,''"()\[\]]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  let start = 0;
  while (start < words.length - 1 && LEADING_NOISE.has(words[start]!)) start += 1;

  return words.slice(start).join(" ");
}

/**
 * Titles that sit in front of a name.
 *
 * These cannot be stripped blindly. "Mr Bennet" and "Mrs Bennet" fold to the
 * same thing and are two people, and merging them corrupts both profiles — far
 * worse than leaving a duplicate. So they are stripped only where the roster
 * itself shows it is safe: see `mergeTitled`.
 */
const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "master",
  "sir",
  "lady",
  "lord",
  "dame",
  "dr",
  "doctor",
  "prof",
  "professor",
  "rev",
  "reverend",
  "father",
  "mother",
  "brother",
  "sister",
  "saint",
  "st",
  "captain",
  "capt",
  "colonel",
  "col",
  "major",
  "general",
  "lieutenant",
  "lt",
  "sergeant",
  "sgt",
  "admiral",
  "king",
  "queen",
  "prince",
  "princess",
  "duke",
  "duchess",
  "count",
  "countess",
  "baron",
  "uncle",
  "aunt",
  "cousin",
  "old",
  "young",
]);

/** The name with any leading title removed, or null if there wasn't one. */
function withoutTitle(folded: string): string | null {
  const words = folded.split(" ");
  if (words.length < 2 || !TITLES.has(words[0]!)) return null;
  return words.slice(1).join(" ");
}

/**
 * Fold "Brother Tuan" into "Tuan" — but only when that is demonstrably safe.
 *
 * The test is the roster itself. If exactly one titled form reduces to a given
 * bare name, the two are the same person and are merged. If two do — Mr Bennet
 * and Mrs Bennet both reducing to "bennet" — the title is the only thing
 * telling them apart, so nothing is touched.
 *
 * This is why it runs after the roster is built rather than inside the fold: it
 * is a question about the cast, and a string on its own cannot answer it.
 */
function mergeTitled(byKey: Map<string, RosterEntry>): void {
  const reducesTo = new Map<string, string[]>();
  for (const key of byKey.keys()) {
    const bare = withoutTitle(key);
    if (!bare) continue;
    reducesTo.set(bare, [...(reducesTo.get(bare) ?? []), key]);
  }

  for (const [bare, titled] of reducesTo) {
    // Only when the bare name is itself in the cast, and only one title claims
    // it. Two claimants means the title is load-bearing.
    if (titled.length !== 1) continue;
    const host = byKey.get(bare);
    const held = byKey.get(titled[0]!);
    if (!host || !held) continue;

    host.sections += held.sections;
    host.actions += held.actions;
    host.span.first = Math.min(host.span.first, held.span.first);
    host.span.last = Math.max(host.span.last, held.span.last);
    for (const alias of [held.name, ...held.aliases]) {
      if (!host.aliases.includes(alias) && alias !== host.name) host.aliases.push(alias);
    }
    byKey.delete(titled[0]!);
  }
}

export function buildRoster(sections: PlacedDigest[], excluded: string[] = []): RosterEntry[] {
  const ruledOut = new Set(excluded);
  const byKey = new Map<string, RosterEntry>();
  const aliasTo = new Map<string, string>();

  const keyFor = (name: string) => {
    const folded = foldName(name);
    return aliasTo.get(folded) ?? folded;
  };

  for (const section of sections) {
    for (const character of section.characters) {
      const key = keyFor(character.name);
      // Ruled out by the writer, or a bare role word. Either way, not a person.
      if (!key || ruledOut.has(key) || !isRealCharacter(character.name)) continue;

      // Bind this section's aliases to the identity, so a later section using
      // only the nickname lands on the same person.
      for (const alias of character.aliases ?? []) {
        const folded = foldName(alias);
        if (folded && !aliasTo.has(folded)) aliasTo.set(folded, key);
      }

      const held = byKey.get(key);
      if (!held) {
        byKey.set(key, {
          name: character.name.trim(),
          aliases: [...new Set((character.aliases ?? []).map((a) => a.trim()).filter(Boolean))],
          sections: 1,
          actions: character.actions.length,
          span: { first: section.start, last: section.end },
          judgeable: false,
        });
        continue;
      }
      // Keep the plainest spelling seen: "French brothers" over "Two French
      // brothers", since the counting word was never part of the name.
      const seen = character.name.trim();
      if (seen && seen.length < held.name.length) held.name = seen;
      held.sections += 1;
      held.actions += character.actions.length;
      held.span.last = Math.max(held.span.last, section.end);
      held.span.first = Math.min(held.span.first, section.start);
      for (const alias of character.aliases ?? []) {
        const trimmed = alias.trim();
        if (trimmed && !held.aliases.includes(trimmed)) held.aliases.push(trimmed);
      }
    }
  }

  // After the whole cast is known, because the question "is this title the only
  // thing distinguishing two people?" cannot be answered one name at a time.
  mergeTitled(byKey);

  return [...byKey.values()]
    .map((entry) => decideJudgeable(entry))
    .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name));
}

/**
 * Enough to judge, or not.
 *
 * The rubric requires citable events for every score of 2 or higher, so a
 * character with four recorded actions in one section can only ever produce a
 * flat profile of noughts and ones. Spending a model on that reaches a
 * conclusion already known, and on a self-hosted box that is somebody's
 * electricity and somebody's GPU. The finding is reported instead.
 */
function decideJudgeable(entry: RosterEntry): RosterEntry {
  if (entry.sections < MIN_SECTIONS) {
    return {
      ...entry,
      judgeable: false,
      reason: `appears in only one section — too little to score a profile against`,
    };
  }
  if (entry.actions < MIN_ACTIONS) {
    return {
      ...entry,
      judgeable: false,
      reason: `only ${entry.actions} recorded ${entry.actions === 1 ? "action" : "actions"} across the book — every axis would rest on too little to cite`,
    };
  }
  return { ...entry, judgeable: true, ...(entry.reason ? { reason: undefined } : {}) };
}

/** The book as the judging model sees it: events, in order, with positions. */
export function timelineFor(sections: PlacedDigest[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    const at = `${Math.round(section.start * 100)}–${Math.round(section.end * 100)}%`;
    const name = section.label ? `${section.label} ` : "";
    lines.push(`\n[${at}] ${name}(${section.words} words)`);
    if (section.summary) lines.push(`  ${section.summary}`);
    for (const event of section.events) {
      const kind = event.kind ? ` (${event.kind}${event.weight ? `, ${event.weight}` : ""})` : "";
      const who = event.who?.length ? ` — ${event.who.join(", ")}` : "";
      lines.push(`  • ${event.what}${kind}${who}`);
    }
  }
  return lines.join("\n");
}

/** One character's whole-book record, positioned. */
export function dossierFor(sections: PlacedDigest[], name: string): string {
  const wanted = name.trim().toLowerCase();
  const lines: string[] = [];

  for (const section of sections) {
    const match = section.characters.find(
      (c) =>
        c.name.trim().toLowerCase() === wanted ||
        (c.aliases ?? []).some((a) => a.trim().toLowerCase() === wanted),
    );
    if (!match) continue;

    const at = `${Math.round(section.start * 100)}–${Math.round(section.end * 100)}%`;
    lines.push(`\n[${at}] ${section.label ?? "section"}`);
    for (const action of match.actions) lines.push(`  • ${action}`);
    for (const want of match.wants ?? []) lines.push(`  wants: ${want}`);
    for (const relation of match.relations ?? []) lines.push(`  with ${relation.who}: ${relation.what}`);
  }

  return lines.join("\n");
}

const STRUCTURE_SCHEMA = {
  type: "object",
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          model: { type: "string", enum: [...MODEL_KEYS] },
          fit: { type: "string", enum: ["good", "moderate", "low", "bad", "na"] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                element: { type: "string" },
                event: { type: "string" },
                position: { type: "number" },
              },
              required: ["element", "event"],
            },
          },
          gaps: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["model", "fit", "evidence", "gaps", "summary"],
      },
    },
    bestFit: { type: "string" },
    bestFitWhy: { type: "string" },
    overview: { type: "string" },
  },
  required: ["models", "bestFitWhy", "overview"],
} as const;

export async function analyseStructure(opts: {
  url: string;
  model: string;
  numCtx: number | null;
  thinks?: boolean | null;
  title: string;
  totalWords: number;
  sections: PlacedDigest[];
  signal?: AbortSignal;
}): Promise<{ result: StructureAnalysis; ms: number }> {
  const prompt = `MANUSCRIPT: "${opts.title}" — ${opts.totalWords.toLocaleString()} words, ${opts.sections.length} sections.

${STRUCTURE_MODELS}

Below is the manuscript's event timeline. Each section is marked with its position as a percentage of the whole book. USE THESE POSITIONS: they are exact, and the proportional claims of these models stand or fall on them.

TIMELINE:${timelineFor(opts.sections)}

Judge all seven models. Return one entry per model, using these exact keys: ${MODEL_KEYS.join(", ")}.

For each: the fit rating, the distinctive elements you found with the events instantiating them and their positions, the distinctive elements that are absent or mislocated, and a summary of a few sentences explaining the rating in plain language.

Then name the single best-fitting model in "bestFit" using one of those keys — or leave it empty if the manuscript follows rhetorical or associative logic and fits no beat model well, which is a legitimate finding. Explain in "bestFitWhy". In "overview", give a few sentences on the manuscript's shape overall.`;

  const answer = await generateJson<Partial<StructureAnalysis>>({
    url: opts.url,
    model: opts.model,
    numCtx: opts.numCtx,
    thinks: opts.thinks ?? null,
    system: STRUCTURE_PRINCIPLES,
    format: STRUCTURE_SCHEMA as unknown as Record<string, unknown>,
    prompt,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const raw = answer.value;
  const found = new Map((raw.models ?? []).map((m) => [m.model, m]));

  // Every model gets a bar, whether or not the judge remembered it. A missing
  // model rendered as an absent row would look like a bug; rendered as "no
  // finding" it is at least honest.
  const models = MODEL_KEYS.map((key) => {
    const m = found.get(key);
    return {
      model: key,
      fit: m?.fit ?? "low",
      evidence: Array.isArray(m?.evidence) ? m.evidence : [],
      gaps: Array.isArray(m?.gaps) ? m.gaps : [],
      summary: m?.summary ?? "No finding was returned for this model.",
    };
  });

  const bestFit = raw.bestFit && MODEL_KEYS.includes(raw.bestFit as never) ? raw.bestFit : null;

  return {
    result: {
      models,
      bestFit,
      bestFitWhy: raw.bestFitWhy ?? "",
      overview: raw.overview ?? "",
    },
    ms: answer.ms,
  };
}

const CHARACTER_SCHEMA = {
  type: "object",
  properties: {
    focal: { type: "string" },
    axes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          axis: { type: "string", enum: [...AXIS_KEYS] },
          score: { type: "integer", minimum: 0, maximum: 5 },
          aligned: { type: "array", items: { type: "string" } },
          contradictory: { type: "array", items: { type: "string" } },
        },
        required: ["axis", "score", "aligned", "contradictory"],
      },
    },
    summary: { type: "string" },
    phaseShifts: { type: "array", items: { type: "string" } },
    epithet: { type: "string" },
    confidence: { type: "string" },
  },
  required: ["focal", "axes", "epithet", "summary", "confidence"],
} as const;

export async function analyseCharacter(opts: {
  url: string;
  model: string;
  numCtx: number | null;
  thinks?: boolean | null;
  title: string;
  name: string;
  /** The committed record, when there is one. Falls back to the reading. */
  dossier?: string;
  /** Lines already written for this cast, so they aren't written again. */
  taken?: string[];
  /** Whose arc to score against — one chart, one perspective. */
  focal: string;
  sections: PlacedDigest[];
  signal?: AbortSignal;
}): Promise<{ result: CharacterAnalysis; ms: number }> {
  const prompt = `MANUSCRIPT: "${opts.title}"

${AXES}

The focal perspective for this evaluation is ${opts.focal}. Score ${opts.name} relative to that arc.

Here is everything the manuscript records ${opts.name} doing, in order, each marked with its position as a percentage of the book:
${opts.dossier ?? dossierFor(opts.sections, opts.name)}

For wider context, the book's event timeline:${timelineFor(opts.sections)}

Score ${opts.name} on all ten axes, using these exact keys: ${AXIS_KEYS.join(", ")}.

For every axis give:
- "aligned": the actions from the record above that MOST support this score — the citable events the rubric demands. For a score of 2 or higher this must not be empty; if you cannot name the events, lower the score.
- "contradictory": the actions that cut AGAINST this reading, or complicate it — what a careful reader would raise as an objection. If the character's behaviour is consistent on this axis, return an empty list rather than inventing an objection.

Then: "epithet", ONE short line for this character's card — at most twelve words. Either a wry description of what they are in this story, or a line of their own dialogue that captures them. It must come from THIS manuscript: quote or paraphrase what is actually on the page, never what you may know of a character with this name from elsewhere. Dry and specific beats grand and vague — "would rather be right than liked" over "a complex and compelling figure". No quotation marks unless it is their speech.${
    opts.taken?.length
      ? `\nThese lines are ALREADY IN USE for other characters in this same book. Yours must be different in wording AND in idea — do not write a variation on one of them, and do not reach for the same observation about a different person:\n${opts.taken.map((t) => `  - ${t}`).join("\n")}`
      : ""
  }
Then: "summary", a one- or two-sentence reading of the SHAPE of the profile (for example "Shapeshifter-Guardian with late Sacrifice: the distrusted gatekeeper who is spent to prove loyalty"), followed by a few sentences on what that means for this character's role. "phaseShifts": any axis concentrated in one span of the book, or any mid-story role flip, with where it turns. "confidence": where the evidence is thin and which scores are least certain.

A flat or near-zero profile is a valid result. Do not inflate.`;

  const answer = await generateJson<Partial<CharacterAnalysis>>({
    url: opts.url,
    model: opts.model,
    numCtx: opts.numCtx,
    thinks: opts.thinks ?? null,
    system: AXES_PRINCIPLES,
    format: CHARACTER_SCHEMA as unknown as Record<string, unknown>,
    prompt,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const raw = answer.value;
  const found = new Map((raw.axes ?? []).map((a) => [a.axis, a]));

  // A radar chart with a missing spoke is not a shape, so every axis is
  // present; an axis the judge skipped is a 0, which is what "no story events
  // instantiate this function" means anyway.
  const axes = AXIS_KEYS.map((key) => {
    const a = found.get(key);
    const score = typeof a?.score === "number" ? Math.max(0, Math.min(5, Math.round(a.score))) : 0;
    const aligned = Array.isArray(a?.aligned) ? a.aligned.filter(Boolean) : [];
    return {
      axis: key,
      // The rubric's own rule, enforced rather than requested: a score of 2 or
      // more with nothing to cite is exactly what principle 3 forbids.
      score: score >= 2 && aligned.length === 0 ? 1 : score,
      aligned,
      contradictory: Array.isArray(a?.contradictory) ? a.contradictory.filter(Boolean) : [],
    };
  });

  return {
    result: {
      name: opts.name,
      focal: raw.focal ?? opts.focal,
      axes,
      summary: raw.summary ?? "",
      phaseShifts: Array.isArray(raw.phaseShifts) ? raw.phaseShifts : [],
      epithet: typeof raw.epithet === "string" ? raw.epithet.trim().slice(0, 140) : "",
      confidence: raw.confidence ?? "",
    },
    ms: answer.ms,
  };
}

/**
 * The "only one 5 per axis" rule, applied across the cast.
 *
 * The rubric says a 5 means this character is the story's primary carrier of a
 * function, and that if two seem to hold it, one is usually a 4. Characters are
 * judged one at a time and cannot know what the others scored, so the rule
 * cannot be honoured in the prompt — it has to be settled here, once all the
 * profiles are in. The strongest claim keeps the 5; the rest step down.
 */
export function reconcilePrimacy(profiles: CharacterAnalysis[]): CharacterAnalysis[] {
  const out = profiles.map((p) => ({ ...p, axes: p.axes.map((a) => ({ ...a })) }));

  for (const axis of AXIS_KEYS) {
    const claimants = out
      .map((p) => p.axes.find((a) => a.axis === axis))
      .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.score === 5);
    if (claimants.length <= 1) continue;

    // Most cited evidence wins the primacy; ties keep the earlier profile.
    claimants.sort((a, b) => b.aligned.length - a.aligned.length);
    for (const loser of claimants.slice(1)) loser.score = 4;
  }

  return out;
}

export { MODEL_LABELS };


const IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          canonical: { type: "string" },
          names: { type: "array", items: { type: "string" } },
          why: { type: "string" },
        },
        required: ["canonical", "names", "why"],
      },
    },
    suspects: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, why: { type: "string" } },
        required: ["name", "why"],
      },
    },
  },
  required: ["groups", "suspects"],
} as const;

/**
 * Who in this cast is the same person, and who is secretly two.
 *
 * The reading is done section by section, so it cannot answer this: the section
 * that wrote "the housekeeper" had no way of knowing a later one would write
 * "Mrs Reynolds". String folding catches the mechanical cases — counting words,
 * an unambiguous title — but "the housekeeper" and "Mrs Reynolds" share no
 * letters, and only something that has read the book can join them.
 *
 * So this runs once, over the whole cast at once, and proposes. It never
 * writes: a wrong merge silently fuses two people's profiles into a character
 * who does not exist, which is far worse than the duplicate it was fixing, so
 * the writer settles every one.
 */
export async function proposeIdentities(opts: {
  url: string;
  model: string;
  numCtx: number | null;
  thinks?: boolean | null;
  title: string;
  roster: RosterEntry[];
  sections: PlacedDigest[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ result: IdentityProposal; ms: number }> {
  /** A few actions each — enough to tell people apart, not the whole record. */
  const sketch = opts.roster
    .map((entry) => {
      const actions: string[] = [];
      for (const section of opts.sections) {
        for (const character of section.characters) {
          if (foldName(character.name) !== foldName(entry.name)) continue;
          for (const action of character.actions) {
            if (actions.length < 4) actions.push(action);
          }
        }
      }
      const aka = entry.aliases.length ? ` (also called ${entry.aliases.join(", ")})` : "";
      const at = `${Math.round(entry.span.first * 100)}–${Math.round(entry.span.last * 100)}%`;
      return `${entry.name}${aka} — appears ${at}, ${entry.actions} recorded actions\n${actions
        .map((a) => `    · ${a}`)
        .join("\n")}`;
    })
    .join("\n\n");

  const prompt = `MANUSCRIPT: "${opts.title}"

This book was read one section at a time, so the same person may have been recorded under more than one name — a section that wrote "the housekeeper" had no way of knowing a later one would write her name. The cast as recorded, with a few of each one's actions:

${sketch}

Two questions.

1. "groups": which of these names refer to the SAME PERSON? Return one group per person recorded under more than one name. "canonical" is the name to keep — prefer the one the book itself uses most, and a proper name over a description. "names" lists every recorded name in the group, canonical included. "why" is the evidence: what in the actions above shows they are one person.

Be strict. Two characters with the same surname are usually two people. Two characters who never appear in the same section are NOT thereby the same person. If the actions do not actually show it, leave them separate — merging two people into one is far worse than leaving a duplicate, because it invents a character who is not in the book. Return an empty list if nothing is clearly the same.

2. "suspects": any single name whose recorded actions read like MORE THAN ONE person — a name the reading has been applying to two different characters. Give the name and what makes you think so. Empty list if none.

Use names exactly as spelled above. Do not introduce a name that is not in the list.`;

  const answer = await generateJson<Partial<IdentityProposal>>({
    url: opts.url,
    model: opts.model,
    numCtx: opts.numCtx,
    thinks: opts.thinks ?? null,
    system:
      "You reconcile a cast list read piecemeal. You join names only on evidence, and you say when there is none.",
    format: IDENTITY_SCHEMA as unknown as Record<string, unknown>,
    prompt,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  /** Only names actually in the cast, and only groups that still merge. */
  const known = new Map(opts.roster.map((r) => [foldName(r.name), r.name]));
  const groups = (answer.value.groups ?? [])
    .map((group) => {
      const names = [...new Set((group.names ?? []).map((n) => known.get(foldName(n))).filter(Boolean))] as string[];
      const canonical = known.get(foldName(group.canonical ?? "")) ?? names[0];
      if (!canonical || names.length < 2) return null;
      return { canonical, names, why: group.why ?? "" };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  const suspects = (answer.value.suspects ?? [])
    .map((s) => ({ name: known.get(foldName(s.name ?? "")) ?? "", why: s.why ?? "" }))
    .filter((s) => s.name);

  return { result: { groups, suspects }, ms: answer.ms };
}


/**
 * The cast, from what the writer has committed.
 *
 * The same shape as `buildRoster`, and the same folding, but read from settled
 * rows rather than from the reading. This is the list profiles are drawn from,
 * so an action the writer moved or dropped is reflected here and nowhere else
 * has to know about it.
 */
export function rosterFromCast(
  rows: { characterName: string; action: string; blockId: string; state: string }[],
  positions: Map<string, number>,
  excluded: string[] = [],
): RosterEntry[] {
  const ruledOut = new Set(excluded);
  const byKey = new Map<string, RosterEntry>();

  for (const row of rows) {
    if (row.state !== "committed") continue;
    const key = foldName(row.characterName);
    if (!key || ruledOut.has(key) || !isRealCharacter(row.characterName)) continue;

    const at = positions.get(row.blockId) ?? 0;
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, {
        name: row.characterName.trim(),
        aliases: [],
        sections: 1,
        // A row with no action is a character recorded as present and idle.
        actions: row.action ? 1 : 0,
        span: { first: at, last: at },
        judgeable: false,
      });
      continue;
    }
    if (row.action) held.actions += 1;
    held.span.first = Math.min(held.span.first, at);
    held.span.last = Math.max(held.span.last, at);
  }

  // Sections are counted as distinct blocks, not as rows.
  for (const [key, entry] of byKey) {
    entry.sections = new Set(
      rows.filter((r) => r.state === "committed" && foldName(r.characterName) === key).map((r) => r.blockId),
    ).size;
  }

  mergeTitled(byKey);

  return [...byKey.values()]
    .map((entry) => decideJudgeable(entry))
    .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name));
}

/** One character's committed record, positioned, for the profiling prompt. */
export function dossierFromCast(
  rows: { characterName: string; action: string; blockId: string; state: string }[],
  sections: PlacedDigest[],
  name: string,
): string {
  const wanted = foldName(name);
  const byBlock = new Map(sections.map((s) => [s.blockId, s]));

  const mine = rows
    .filter((r) => r.state === "committed" && foldName(r.characterName) === wanted && r.action)
    .sort((a, b) => (byBlock.get(a.blockId)?.start ?? 0) - (byBlock.get(b.blockId)?.start ?? 0));

  const lines: string[] = [];
  let lastBlock = "";
  for (const row of mine) {
    if (row.blockId !== lastBlock) {
      const section = byBlock.get(row.blockId);
      const at = section
        ? `${Math.round(section.start * 100)}\u2013${Math.round(section.end * 100)}%`
        : "?";
      lines.push(`\n[${at}] ${section?.label ?? "section"}`);
      lastBlock = row.blockId;
    }
    lines.push(`  \u2022 ${row.action}`);
  }
  return lines.join("\n");
}
