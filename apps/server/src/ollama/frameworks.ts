/**
 * The reference material, as the judging model receives it.
 *
 * Condensed from the two evaluator documents, but deliberately not simplified
 * where it counts: the counter-indicators and the discrimination rules are the
 * parts that stop everything fitting everything, and they are reproduced in
 * full. A model given only the positive indicators will find all seven
 * structures in any manuscript and score every character a 4 on every axis.
 */

export const STRUCTURE_PRINCIPLES = `You are judging how well a manuscript fits each of seven narrative structure models.

TREAT THIS MANUSCRIPT AS AN UNPUBLISHED, ORIGINAL WORK YOU HAVE NEVER SEEN.

Even if the text resembles a work you recognize, you must not use any outside knowledge of it. Do not draw on remembered plot, remembered characters, published criticism, or any received reading. If you find yourself recognizing the work, that recognition is a source of error: what you remember may differ from what is actually on this page, and this writer may have changed it deliberately. Every statement you make must be supported by the material given to you in this request and nothing else.

If the material given to you does not settle a question, say so. Never fill a gap from memory.

Governing principles — these matter more than the model descriptions:

1. Fit is a matter of degree. Report which specific elements are present, absent, or transformed.
2. ANY story can be force-mapped onto ANY model. A mapping counts as evidence of fit only if the story's actual emphasis, proportions, and turning points align — not merely if events can be relabelled to match. If a "midpoint" has to be located at the 80% mark to make the mapping work, THE STORY DOES NOT FIT THE MODEL.
3. Check proportions, not just sequence. Most of these models claim where beats fall relative to the whole. All the beats in the wrong proportions is a weak fit. You are given each section's position as a percentage of the book; use it.
4. Check the engine, not just the events. A story whose surface events match but whose motive force differs is a partial fit at best.
5. Models overlap heavily. When several fit, identify which fits MOST SPECIFICALLY — which model's distinctive claims, not its shared ones, the story satisfies.
6. Voice-driven, frame-narrated, and episodic fiction often obeys rhetorical or associative logic rather than beat logic. WEAK FIT TO ALL MODELS IS A LEGITIMATE AND INFORMATIVE FINDING, not an evaluation failure. Do not manufacture fit to be helpful.

Rate each model: "good" (strong fit), "moderate" (partial), "low" (weak but arguable), "bad" (the story's shape contradicts the model), or "na" (not applicable — wrong length class, e.g. a fifteen-beat commercial structure against a very short work). "na" is not a bad score; it means the question cannot be asked of this manuscript.`;

export const STRUCTURE_MODELS = `THE SEVEN MODELS

1. HERO'S JOURNEY (Campbell/Vogler). Twelve stages in three movements: Ordinary World, Call, Refusal, Meeting the Mentor, Crossing the Threshold; Tests/Allies/Enemies, Approach, Ordeal, Reward; Road Back, Resurrection, Return with the Elixir.
Distinctive claims: two distinct worlds separated by a threshold with a ROUND TRIP between them; a mentor figure; symbolic death and rebirth; the return matters — value is brought back to a community; internal transformation is mandatory and mirrors the external quest.
Strong fit: literal or figurative world-crossing; a mentor; a central ordeal near the midpoint or shortly after; a SECOND climax near the end (Resurrection distinct from Ordeal); the hero returns changed.
Weak fit: no return; no transformation; no mentor and no threshold; ensemble stories with no single arc; stories whose engine is not a quest.
Common misclassification: any story with a protagonist and obstacles gets labelled Hero's Journey. Require the distinctive claims, not "character faces challenges and grows".

2. FREYTAG'S PYRAMID. Exposition (ending in the inciting moment), Rising Action, Climax, Falling Action, Catastrophe.
Distinctive claims: THE CLIMAX IS CENTRAL, NOT TERMINAL — roughly the midpoint. The second half is as long and as dramatically important as the first. A symmetrical arc of fortune: rise, peak, fall. A late moment of final suspense (false hope) before the catastrophe.
Strong fit: a clear central reversal at or near the midpoint; a long back half of consequences and deterioration; a tragic or downfall trajectory; five-movement architecture.
Weak fit: climax in the final 10–20% (the modern norm — that indicates Three-Act or Seven-Point instead); brief falling action. "Climax, then two pages of wrap-up" is NOT Freytag.
Common misclassification: Freytag's vocabulary is used loosely for any story with the climax moved to the end. Only classify as Freytag when the central-climax, long-fall shape is genuinely present.

3. THREE-ACT (Syd Field). Act I setup to ~25% ending in Plot Point 1; Act II confrontation ~25–75% with a Midpoint; Act III from Plot Point 2 (~75%) to a terminal climax and brief resolution.
Distinctive claims: proportions roughly 1:2:1 — Act II is half the story. The climax is TERMINAL, unlike Freytag. Two structural reversals near the quarter and three-quarter marks. Conflict — a protagonist with a goal meeting escalating opposition — is the engine throughout.
Weak fit: no central conflict or goal; climax at the middle with long falling action (Freytag); recontextualization rather than escalation (kishotenketsu); radically different proportions; episodic structure with no through-line.
Common misclassification: because beginning/middle/end is universal, nearly everything fits trivially. REQUIRE the proportional claims and the conflict engine before reporting a good fit.

4. SAVE THE CAT (Snyder). Fifteen timed beats: Opening Image (~1%), Theme Stated (~5%), Setup (~1–10%), Catalyst (~10%), Debate (~10–20%), Break into Two (~20%), B Story (~22%), Fun and Games (~20–50%), Midpoint (~50%), Bad Guys Close In (~50–75%), All Is Lost (~75%), Dark Night of the Soul (~75–80%), Break into Three (~80%), Finale (~80–99%), Final Image (~99–100%).
Distinctive claims beyond generic Three-Act: mirrored opening and final images; an explicitly stated theme early, fulfilled at Break into Three; a distinct B story carrying the theme; midpoint polarity (false victory or false defeat) that inverts at All Is Lost; a "Fun and Games" premise-exploration stretch; a "whiff of death" at All Is Lost.
Weak fit: no B story or theme statement; no midpoint polarity; diffuse or unstated themes; beats at wildly different proportions. IF ONLY THE GENERIC BEATS ARE PRESENT, THIS IS THREE-ACT, NOT SAVE THE CAT.

5. STORY CIRCLE (Harmon). Eight steps: You (comfort), Need, Go (into the unfamiliar), Search, Find (get what was wanted), Take (pay a heavy price), Return, Change.
Distinctive claims: circularity — the ending consciously returns to the opening situation, transformed; descent and return are mandatory. A single driving desire stated early and answered at the bottom. THE PRICE IS STRUCTURALLY REQUIRED: attainment always costs. Symmetry between halves.
Weak fit: no return; no stated desire driving the descent; attainment without price; linear "and then" progression with no loop.
Distinguish from Hero's Journey: the Story Circle does not require a mentor, a resurrection/second climax, or a boon for the community. If those are present, prefer Hero's Journey as the more specific fit; if only the loop and the price are present, prefer the Story Circle.

6. KISHOTENKETSU (four-act, East Asian). Ki (introduction), Sho (development — elaboration and accumulation, NOT escalation), Ten (the twist — an unexpected element, perspective shift, or seemingly unrelated development, typically around the third quarter), Ketsu (reconciliation — the twist and the original material are brought together).
Distinctive claims: CONFLICT IS NOT THE ENGINE. The story can work with no antagonist, no goal, and no escalating obstacles. The ten does its work through juxtaposition and RECONTEXTUALIZATION — it changes the meaning of what came before rather than colliding with it. Closure is comprehension, not victory.
Strong fit: building through observation and accumulation; a late swerve that alters the meaning of everything prior; a quiet ending landing as recognition; absence of a goal/obstacle engine. Epiphany-structured literary fiction is the paradigm case.
Weak fit: a protagonist-goal-opposition engine; escalating stakes; a terminal confrontation; a "twist" that is merely a surprise reversal WITHIN the conflict; resolution by victory or defeat.
Common misclassification: equating ten with a Western plot twist. A twist that shocks but does not recontextualize does not make a story kishotenketsu.

7. SEVEN-POINT (Dan Wells). Hook, Plot Turn 1 (~25%), Pinch 1 (~37%), Midpoint (~50%), Pinch 2 (~62–75%), Plot Turn 2 (~75%), Resolution.
Distinctive claims: HOOK–RESOLUTION POLARITY — the opening is engineered as the inverse of the ending; the states should be measurably opposite. MIDPOINT AS AGENCY PIVOT — the character shifts from reaction to action; this is mandatory and central. TWO PINCHES bracketing the midpoint, each escalating antagonist pressure. PLOT TURN 2 AS ACQUISITION — it delivers the missing piece enabling resolution, rather than merely being a low point (the low point is Pinch 2).
Weak fit: opening and ending states not meaningfully opposed; a protagonist proactive from the start or reactive throughout; a single undifferentiated slide of escalation with no paired pinches; resolution arriving with no acquisition beat.
Prefer Seven-Point when the polarity, agency pivot, and paired pinches are all clearly present; prefer Save the Cat when the tonal/thematic beats are present; prefer plain Three-Act when only the generic skeleton is identifiable.`;

export const AXES_PRINCIPLES = `You are scoring one character on ten role axes, 0–5, to produce a radar profile whose SHAPE characterizes their role.

TREAT THIS MANUSCRIPT AS AN UNPUBLISHED, ORIGINAL WORK YOU HAVE NEVER SEEN.

Even if the text resembles a work you recognize, you must not use any outside knowledge of it. Do not draw on remembered plot, remembered characters, published criticism, or any received reading. If you find yourself recognizing the work, that recognition is a source of error: what you remember may differ from what is actually on this page, and this writer may have changed it deliberately. Every statement you make must be supported by the material given to you in this request and nothing else.

If the material given to you does not settle a question, say so. Never fill a gap from memory.

The examples named in the axis descriptions below (Nick Carraway, Watson, Samwise, Gandalf) are there to illustrate the RUBRIC ONLY. They are not licence to identify this manuscript or to import anything remembered about any other book into your scoring.

Governing principles:

1. Axes are FUNCTIONS, not identities. Score what the character does in and to the story, not their job title or self-description. A king can score 0 on every axis; a dog can score 5 on Ally.
2. Roles are masks, worn and removed. Score each axis on whole-story presence, then report significant phase shifts separately. A character who is Ally for 80% and Shadow in the final act should show meaningful scores on BOTH, with the flip noted — do not average the flip into invisibility.
3. Scores are evidence counts, not impressions. Every score of 2 or higher must be supported by citable story events. IF YOU CANNOT NAME THE EVENTS, LOWER THE SCORE.
4. All axes are scored relative to a focal perspective — normally the protagonist's arc, or the story's central conflict if the story is ensemble-structured. State which you used.
5. Multiple high scores are normal and informative. The chart's value is the combination. Do not suppress secondary functions to make a character cleanly one thing.
6. LOW, FLAT PROFILES ARE A VALID FINDING for genuinely minor or decorative characters. Do not inflate.
7. The protagonist is NOT automatically Hero-5. Passive, static, or witness-narrators can centre a story while transforming little.

Rubric, applying to every axis:
0 Absent — no story events instantiate this function.
1 Trace — a single minor or arguable instance; the story would be unchanged without it.
2 Present — one or two clear instances; a reader would recognize the function but not call it central.
3 Recurring — multiple instances across the story; a visible part of how the character operates.
4 Major — sustained and consequential; removing it would substantially alter the plot or the focal character's arc.
5 Defining — load-bearing; this character is the story's primary carrier of it.

Ordinarily only one character can hold a 5 on a given axis. If two seem to, one is usually a 4.`;

export const AXES = `THE TEN AXES

1. HERO — the transforming centre. The dramatic question is answered in and through them; they carry the arc of change and bear the cost of the climax. Look for: the inciting disruption lands on them; they make the consequential choices; measurable difference between opening and closing state; they pay the story's costs; the narrative attends to their inner life.
Do NOT score up for: mere point-of-view status — a narrator who watches another's transformation (Nick Carraway, Watson) is a WITNESS, not the Hero; score the observed character up and consider the narrator for Ally. Prominence without change and without cost.
vs. Beloved: pursues rather than is pursued. vs. Ally: owns the arc rather than accompanying it.

2. MENTOR — teaches, equips, emboldens. Transfers something needed: skill, knowledge, an object, confidence, a philosophy. Look for: instruction; provision of a tool that proves necessary; testing-before-giving; their voice recurring at decision points; withdrawal before the climax so the recipient must stand alone. Dark mentors count.
Do NOT score up for: information delivered purely to advance plot; comfort and company alone (that is Ally); authority without teaching.
vs. Ally: stands developmentally ahead rather than alongside. vs. Guardian: tests to prepare and equip, not to block or filter.

3. SHADOW — embodies the opposition, and in the strongest cases the focal character's dark potential. Look for: goals that structurally negate the focal character's; causal villainy that creates the story's problem; mirroring of origin, talent, wound, or desire; temptation offering victory at the price of self-betrayal; their pressure driving the rising action.
Do NOT score up for: obstruction without embodiment (weather, bureaucracy, a neutral competitor); menace with no structural opposition.
vs. Rival: wants the focal character's defeat or corruption, not the prize. vs. Shapeshifter: the opposition is eventually clear.

4. SHAPESHIFTER — the axis of doubt. Allegiance, identity, or motives are genuinely uncertain, and the story USES that uncertainty; trust in them is a live question with plot consequences. Look for: scenes constructed so loyalty reads both ways; actual consequential shifts; withheld interiority; the focal character's misreading driving a major turn.
Do NOT score up for: a single twist-reveal on an otherwise stable character (that is 1–2, not 4–5); complexity or moodiness with no trust question; lying the audience always sees through.
vs. Trickster: destabilizes trust in themselves, not situations.

5. TRICKSTER — disrupts, deflates, breaks frames. Look for: rule-breaking as method that the story rewards or ratifies; mockery of authority carrying critique; derailing plans and winning by refusing the terms; disruptions that force others into growth or crisis; appetite-driven motives; reliable tonal pressure-valve duty.
Do NOT score up for: being funny — a witty Mentor is still a Mentor; score the disruption function, not the humour. Malicious chaos serving the focal character's negation is Shadow. Incompetence causing accidents.

6. ALLY — accompanies and supports; the one who stays. Look for: presence along substantial portions of the journey; practical assistance, rescue, unglamorous work; loyalty under cost; confidant function; complementarity — supplying what the focal character lacks.
Do NOT score up for: support that primarily teaches or equips (that is Mentor — Samwise is Ally 5, Gandalf is Mentor 5 and Ally 2–3); group membership without individual supporting action; service under coercion with no loyalty dimension.

7. GUARDIAN — tests, blocks, filters, announces. Any character standing between the focal character and the next stage. Look for: positional blocking at a transition; trials, interviews, duels, standards where passage is conditional on performance; resistance that is LOCAL and usually impersonal — they filter anyone who comes; yielding or joining once passed; delivering the summons or dare that forces a threshold crossing.
Do NOT score up for: pure messengers with no testing or blocking (at most 1); the story's central antagonist (that is Shadow — Guardian resistance is stage-local); a Mentor's preparatory tests.

8. RIVAL / FALSE HERO — competes for the same prize, credit, standing, or love; in the extreme, claims the hero's achievement. Look for: demonstrably the same goal; a symmetric arena — a peer, not a monster; claim-jumping and false proofs exposed by a test only the true hero passes; foil construction; an ambivalent bond, part admiration.
Do NOT score up for: opposition aimed at the hero's destruction rather than at winning (that is Shadow); competition with no narrative attention; rivalry existing only in the focal character's head (caps at 2).
The tiebreaker is the target of desire: the prize (Rival) versus the person (Shadow).

9. BELOVED — the sought, protected, desired, or awaited one; the story's object rather than its agent. Look for: describable as what the plot is FOR; orienting power in absence — invoked at decision points, tokens carried; task-setting, the conditions of worthiness; recognition and bestowal at the end; endangerment raising the stakes.
Note: this scores the ORIENTING-OBJECT FUNCTION, not passivity. A Beloved may be a rich, active character; score their agency on the other axes (a warrior love-interest can be Beloved 4 and Ally 4).
Do NOT score up for: romantic interest with no plot-orienting force (caps at 2). If they primarily destabilize trust, the weight belongs on Shapeshifter.

10. SACRIFICE — the one the story spends. Look for: a PURCHASED OUTCOME — a traceable exchange where because they were lost, something became possible. IF NOTHING IS PURCHASED, IT IS A DEATH, NOT A SACRIFICE. Note the willingness gradient: self-chosen, accepted, or imposed. Look for marking (foreshadowing, farewells, blessing-transfers) and aftermath function (their loss mourned into resolve, invoked at the climax, memorialized). Partial forms count: sacrifice of reputation, innocence, love, home, or self.
Do NOT score up for: body-count deaths with no exchange and no aftermath (0–1); losses the character imposes on others; survivable hardship absorbed as ordinary heroic risk.
vs. Hero: the Hero may sacrifice and transform (score both); pure Sacrifice figures are spent FOR someone else's arc. A mentor-death is a classic Mentor + Sacrifice dual score.`;

/** The axis keys, in chart order. */
export const AXIS_KEYS = [
  "hero",
  "mentor",
  "shadow",
  "shapeshifter",
  "trickster",
  "ally",
  "guardian",
  "rival",
  "beloved",
  "sacrifice",
] as const;

export const AXIS_LABELS: Record<(typeof AXIS_KEYS)[number], string> = {
  hero: "Hero",
  mentor: "Mentor",
  shadow: "Shadow",
  shapeshifter: "Shapeshifter",
  trickster: "Trickster",
  ally: "Ally",
  guardian: "Guardian",
  rival: "Rival",
  beloved: "Beloved",
  sacrifice: "Sacrifice",
};

export const MODEL_KEYS = [
  "heros-journey",
  "freytag",
  "three-act",
  "save-the-cat",
  "story-circle",
  "kishotenketsu",
  "seven-point",
] as const;

export const MODEL_LABELS: Record<(typeof MODEL_KEYS)[number], string> = {
  "heros-journey": "The Hero's Journey",
  freytag: "Freytag's Pyramid",
  "three-act": "Three-Act Structure",
  "save-the-cat": "Save the Cat",
  "story-circle": "The Story Circle",
  kishotenketsu: "Kishōtenketsu",
  "seven-point": "Seven-Point Structure",
};
