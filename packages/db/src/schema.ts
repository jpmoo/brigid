import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type {
  BlockFormatSettings,
  BlockOptions,
  BreakTemplateSettings,
  CounterRestart,
  PageSetup,
  TemplateBody,
  TemplateCategory,
  Typography,
} from "@brigid/shared";
import type { DigestCharacter, DigestEvent } from "@brigid/shared";

/**
 * Brigid is single-user, so this table holds exactly one row. It exists anyway
 * so sessions have something to reference and so a password change is an
 * ordinary update rather than a config edit.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** The opaque token stored in the cookie; hashed at rest. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byExpiry: index("sessions_expires_at_idx").on(t.expiresAt) }),
);

/**
 * Instance settings. A singleton — `id` is pinned to 1 by a check constraint.
 * Ollama config lives here rather than in env so it can be changed from the UI
 * without a redeploy, matching the Hermes Notes pattern.
 */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  ollamaUrl: text("ollama_url"),
  inferenceModel: text("inference_model"),
  summarizationModel: text("summarization_model"),
  /**
   * The model's full context window, read from Ollama when the model is chosen.
   * Ollama otherwise serves a small default — a model that can hold 128k gets
   * 4k unless asked otherwise, and the excess is silently dropped.
   */
  ollamaNumCtx: integer("ollama_num_ctx"),
  /**
   * Whether the model reports a thinking capability. Reading a chapter is
   * transcription, not reasoning, so thinking is switched off where it can be —
   * but Ollama rejects the field on models that don't support it, so this is
   * detected rather than assumed. Null means Ollama didn't say.
   */
  ollamaThinks: boolean("ollama_thinks"),
  /** How the writer likes to work, not anything about a particular manuscript. */
  spellcheckEnabled: boolean("spellcheck_enabled").notNull().default(true),
  /** The nightly backup: whether, when on the server's own clock, and how many. */
  backupEnabled: boolean("backup_enabled").notNull().default(true),
  backupHour: integer("backup_hour").notNull().default(1),
  backupMinute: integer("backup_minute").notNull().default(0),
  backupKeep: integer("backup_keep").notNull().default(10),
  /** Free-form UI preferences (panel pinned, panel width, theme, …). */
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Words the writer has taught the checker: names, places, invented things. A
 * novel is full of them, and a checker that keeps flagging them is one that
 * gets switched off.
 */
export const dictionaryWords = pgTable("dictionary_words", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** As typed — how it reads back in the list. */
  word: text("word").notNull(),
  /** Case-folded, and the uniqueness key: "Maren" also settles "maren". */
  wordFolded: text("word_folded").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One manuscript. The library on the landing page lists these. */
export const works = pgTable("works", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  authorFirstName: text("author_first_name"),
  authorLastName: text("author_last_name"),
  pageSetup: jsonb("page_setup").$type<PageSetup>().notNull(),
  /** A length to aim at for the whole manuscript. Null means none. */
  totalWordGoal: integer("total_word_goal"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The layers of organization within a work, one row per outline depth.
 *
 * This is what makes drag-and-drop meaningful: a block's break is looked up by
 * its depth, so dragging a block to a different indentation changes the break
 * rendered before it without touching the block.
 */
export const workLevels = pgTable(
  "work_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    depth: integer("depth").notNull(),
    /** "Part", "Chapter", "Scene". */
    name: text("name").notNull(),
    /** Null means blocks at this depth are run together with no split. */
    breakTemplateId: uuid("break_template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    counterRestart: text("counter_restart").$type<CounterRestart>().notNull().default("continuous"),
    /** A length to aim at for each section at this depth. Null means none. */
    wordGoal: integer("word_goal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ workDepth: unique("work_levels_work_depth_key").on(t.workId, t.depth) }),
);

/**
 * The template library. Both categories share a table because they share a body
 * format and the same variable vocabulary; the category-specific settings live
 * in the two nullable jsonb columns.
 */
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").$type<TemplateCategory>().notNull(),
    name: text("name").notNull(),
    /** Set for seeded templates. Editable, but not deletable. */
    builtinKey: text("builtin_key"),
    body: jsonb("body").$type<TemplateBody>().notNull(),
    /** Populated when category = 'break'. */
    breakSettings: jsonb("break_settings").$type<BreakTemplateSettings>(),
    /** Populated when category = 'block-format'. */
    formatSettings: jsonb("format_settings").$type<BlockFormatSettings>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    builtin: unique("templates_builtin_key_key").on(t.builtinKey),
    byCategory: index("templates_category_idx").on(t.category),
  }),
);

/**
 * Named places to come back to. A bookmark points at a *block*, not an offset
 * into prose: a block survives editing, an offset doesn't. Deleting the block
 * takes its bookmarks with it, which is right — the place is gone.
 */
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    blockId: uuid("block_id")
      .notNull()
      .references((): AnyPgColumn => blocks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortKey: text("sort_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byWork: index("bookmarks_work_sort_idx").on(t.workId, t.sortKey) }),
);

/**
 * The manuscript itself: a tree. There is no separate chapter entity — a chapter
 * is a block that has children. What a block renders as comes from its format
 * template; what precedes it comes from its depth.
 */
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    // Self-reference: the callback needs an explicit AnyPgColumn annotation to
    // break the circular inference on `blocks`.
    parentId: uuid("parent_id").references((): AnyPgColumn => blocks.id, {
      onDelete: "cascade",
    }),
    /** Fractional index — ordering a sibling is a single-row update. */
    sortKey: text("sort_key").notNull(),
    /** Shown in the outline card, and available to templates as `levelTitle`. */
    label: text("label"),
    formatId: uuid("format_id")
      .notNull()
      .references(() => templates.id, { onDelete: "restrict" }),
    /** ProseMirror document. */
    content: jsonb("content").$type<Record<string, unknown>>(),
    /** Plain-text projection of `content`, for word counting and search. */
    contentText: text("content_text").notNull().default(""),
    /**
     * A detached break instance. Null means the block's break still renders from
     * whatever template its level binds — which is what makes a drag between
     * indentations change the break. Editing one break copies the body here, and
     * from then on that break belongs to this block alone.
     */
    breakTemplateId: uuid("break_template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    breakBody: jsonb("break_body").$type<TemplateBody>(),
    /**
     * A detached format instance. Null means the block still renders through
     * its format template, so editing that template reaches it. Editing this
     * one block's format copies the body here and it stops following.
     */
    formatBody: jsonb("format_body").$type<TemplateBody>(),
    /**
     * Type for this block alone. A style-only format has no body to detach, so
     * "edit this block's format" means its typography.
     */
    formatTypography: jsonb("format_typography").$type<Typography>(),
    /** Decisions about this block rather than about its format. */
    options: jsonb("options").$type<BlockOptions>(),
    /**
     * Always maintained, for every block, regardless of whether the block's
     * format contributes to the manuscript total.
     */
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The traversal order query: children of a parent, in sort order.
    byParent: index("blocks_work_parent_sort_idx").on(t.workId, t.parentId, t.sortKey),
  }),
);

/**
 * One section, as the model read it.
 *
 * Keyed by a hash of the prose that was read, which is the entire staleness
 * mechanism: nothing has to remember to invalidate anything, because a section
 * whose prose has changed no longer matches its row, and the walker looks for
 * exactly that. Edit one scene and one scene is re-read.
 *
 * The model is stored too, because a different model is a different reader —
 * its digest of chapter three is not interchangeable with another's. Changing
 * the model makes every row stale, which is expensive and correct.
 */
export const sectionDigests = pgTable(
  "section_digests",
  {
    blockId: uuid("block_id")
      .primaryKey()
      .references(() => blocks.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    characters: jsonb("characters").$type<DigestCharacter[]>().notNull().default([]),
    events: jsonb("events").$type<DigestEvent[]>().notNull().default([]),
    /** What it cost, so the progress display can estimate what is left. */
    ms: integer("ms"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWork: index("section_digests_work_idx").on(t.workId),
  }),
);

/**
 * Whether the walker is running, and why it stopped if it did.
 *
 * Progress is not kept here — it is counted from the digest rows themselves, so
 * it cannot drift out of step with what has actually been read.
 */
export const digestState = pgTable("digest_state", {
  workId: uuid("work_id")
    .primaryKey()
    .references(() => works.id, { onDelete: "cascade" }),
  status: text("status").$type<"idle" | "walking" | "failed">().notNull().default("idle"),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Findings, kept because they are slow to make.
 *
 * Stamped with a fingerprint of the digest they were judged from, so a report
 * can say plainly that the book has moved on rather than quietly presenting
 * last week's reading of a rewritten chapter. Nothing is invalidated
 * automatically: a stale report is still the best answer available, and
 * deleting it the moment a comma changes would leave the panel empty for no
 * gain.
 */
export const analyses = pgTable("analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"structure" | "character" | "framework">().notNull(),
  /** For 'character', who it is about. Null for 'structure'. */
  subject: text("subject"),
  model: text("model").notNull(),
  digestFingerprint: text("digest_fingerprint").notNull(),
  /**
   * Every section as it stood when this was judged, so drift can be measured in
   * words rather than reported as a bare yes-or-no. Null on reports written
   * before this was kept; those fall back to the fingerprint.
   */
  digestSnapshot: jsonb("digest_snapshot").$type<[string, string, number][]>(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  ms: integer("ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A queued run of character profiles.
 *
 * One model call per character, a dozen characters — far too long to hold an
 * HTTP request open for, so the request records the queue and returns, and a
 * worker writes each profile into `analyses` as it lands. `wanted` minus `done`
 * is what is left, which is what makes the job survive a restart.
 */
export const characterRuns = pgTable("character_runs", {
  workId: uuid("work_id")
    .primaryKey()
    .references(() => works.id, { onDelete: "cascade" }),
  status: text("status").$type<"queued" | "running" | "idle" | "failed">().notNull().default("queued"),
  wanted: jsonb("wanted").$type<string[]>().notNull().default([]),
  done: jsonb("done").$type<string[]>().notNull().default([]),
  /** Who is being profiled right now, for the progress line. */
  currentSubject: text("current_subject"),
  /** Whose arc the axes are scored against — one run, one perspective. */
  focal: text("focal"),
  digestFingerprint: text("digest_fingerprint"),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
