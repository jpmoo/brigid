import {
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
  BreakTemplateSettings,
  CounterRestart,
  PageSetup,
  TemplateBody,
  TemplateCategory,
} from "@brigid/shared";

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
  /** Free-form UI preferences (panel pinned, panel width, theme, …). */
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One manuscript. The library on the landing page lists these. */
export const works = pgTable("works", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  authorFirstName: text("author_first_name"),
  authorLastName: text("author_last_name"),
  pageSetup: jsonb("page_setup").$type<PageSetup>().notNull(),
  /** Running heads and feet, composed from the variable library. */
  headerVerso: jsonb("header_verso").$type<TemplateBody>(),
  headerRecto: jsonb("header_recto").$type<TemplateBody>(),
  footerVerso: jsonb("footer_verso").$type<TemplateBody>(),
  footerRecto: jsonb("footer_recto").$type<TemplateBody>(),
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
