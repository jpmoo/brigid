# Brigid — Specification

**Status:** in progress. Sections marked _PROPOSED_ are my resolution of something
you haven't pinned down yet — red-line them. Sections marked _OPEN_ need your call.

---

## 1. What Brigid is

A self-hosted novel writing application for a single user. The writer works in a
document that looks like the finished book, while an outline panel beside it
exposes the manuscript's structure as a tree of blocks.

**Constraints**

- Single user. Auth is tailored to one owner — no registration, no multi-tenancy.
- PostgreSQL for all persistence.
- Runs on a headless Ubuntu server. Development happens on macOS; no local
  services are stood up here.

---

## 2. Stack

Mirrors the Hermes Notes house pattern.

| Layer | Choice |
|---|---|
| Repo | pnpm workspace monorepo — `apps/{server,web}`, `packages/{db,shared}` |
| Language | TypeScript, ESM, Node 22 |
| Server | Fastify 5, Zod validation |
| Data | Drizzle ORM over postgres.js |
| Auth | `@node-rs/argon2` + `@fastify/cookie` session |
| Ordering | `fractional-indexing` for sibling sort keys |
| Web | React 18 + Vite, react-router, lucide-react |
| Editor | TipTap / ProseMirror |
| Drag & drop | dnd-kit |
| Inference | Ollama, over HTTP, configured in settings |

---

## 3. Domain model

### 3.1 Library

The landing page is a library of the user's works, plus settings. A **work** is
one manuscript.

A work carries the metadata that templates draw on:

- title, subtitle
- author first name, author last name
- page setup (trim size, margins)
- header and footer definitions

### 3.2 Blocks

A work's content is a **tree of blocks**. There is only one kind of thing — a
block — and its position in the tree is what creates the layers of organization.
A chapter is not a special entity; it is a block that has children.

Each block has:

| Field | Meaning |
|---|---|
| `parent_id` | tree position |
| `sort_key` | fractional index, orders siblings |
| `label` | user-specified title, shown in the outline |
| `format_id` | which block-format template renders it |
| `content` | the prose |
| `word_count` | denormalized, always maintained |

When creating a block, the user places it relative to the current block as a
**sibling, child, or parent**, and picks its format.

### 3.3 Levels

A work defines an ordered list of **levels** — depth 0, 1, 2, … — each with a
name and a bound break template. For a typical novel:

| Depth | Name | Break template |
|---|---|---|
| 0 | Part | Part break |
| 1 | Chapter | Chapter break |
| 2 | Scene | Section break |

A book without parts simply configures levels as `[Chapter, Scene]`. Levels are
what make drag-and-drop meaningful: moving a block to a different indentation
changes its level, which changes the break rendered before it. Nothing about the
break is stored on the block.

_PROPOSED._ Introducing a new depth prompts the user to bind a break template to
it — chosen from the library or created on the spot.

### 3.4 Templates

Two categories, as you framed them:

**Break templates** — "splits between blocks." Rendered *between* blocks, never
editable as prose, never counted toward word count. Built-in: chapter break,
section break. The user can define others (subsection break, part break, …).

**Block-format templates** — "block format." Wrap a block's own content.
Built-in: regular text, title page. Each carries:

- `counts_toward_word_count` — true for regular text, false for title page
- `structural` — whether the block participates in level/break derivation. Notes
  and front matter opt out.
- `renders_in_document` — false for notes, which appear in the outline only

Both categories live in one library, tagged by category, with built-ins flagged
undeletable.

### 3.5 Variables

Templates, headers, and footers compose from literal text plus **variables**
(your "special characters"). Confirmed set:

| Variable | Scope |
|---|---|
| Page break | control |
| Page number | page |
| Total page numbers | document |
| Total word count | document |
| Manuscript title | work |
| Manuscript subtitle | work |
| Manuscript author first name | work |
| Manuscript author last name | work |

_PROPOSED additions_ — the set above can't express a chapter break, which you
described earlier as needing a chapter number:

| Variable | Scope | Why |
|---|---|---|
| Level counter | level | "Chapter **17**" — the number is the whole point of a chapter break |
| Level title | level | "Chapter 17: **The Crossing**" — pulls the block's label |
| Current chapter title | page | running heads; the recto side of most published novels |
| Block word count | block | drafting aid |

Level counters need a **number format** (arabic, roman, spelled-out — "Chapter
Seventeen" is common) and a **restart rule** (continuous across the manuscript,
or restarting under each parent). Both are real published conventions.

### 3.6 Word counting

- Every block's word count is tracked, always, regardless of format.
- A block contributes to the manuscript total only if its format's
  `counts_toward_word_count` is set.
- Breaks never contribute.

---

## 4. Rendering the document

The document is the block tree flattened depth-first, in order. For each block:

1. Emit the break preceding it, derived from its level
2. Emit its content through its block-format template

_PROPOSED._ Break templates carry a `suppress_on_first_child` flag. Separator-style
breaks (a scene ornament) set it — you don't want an ornament immediately under a
chapter heading. Heading-style breaks (a chapter break under a part) don't — you
do want "Part One" followed by "Chapter 1."

### 4.1 Page-like, not paginated

The document pane renders as paper-styled continuous prose: correct trim width,
margins, typography, and break formatting, but no real page boundaries. True
pagination is an **export** concern and will be spec'd separately.

_OPEN._ This makes the page-number variables unresolvable in the live view. They
still belong in the model for export. Options for the live view: render them as
visible tokens (`[page #]`), render them greyed, or hide headers and footers
entirely while drafting.

### 4.2 Editing

Editing happens **in the document view** — the writer types into the stitched page.

_PROPOSED architecture._ One ProseMirror document holding every block as a custom
node, with breaks as non-editable atom nodes generated from the tree. Persistence
tracks dirty blocks and writes them individually. This gives true continuous
editing — selection and copy across block boundaries, no seams.

The risk is scale: a 130k-word novel is a large ProseMirror document. If it drags,
the fallback is windowed materialization of the block set. Worth measuring early
on realistic manuscript sizes rather than designing around a guess.

---

## 5. Interface

### 5.0 Branding

Two SVG assets live in `assets/`, both with transparent backgrounds:

- `brigid-logo.svg` — a quill inside a Celtic knotwork circle
- `brigid-title.svg` — the wordmark, "BRIGID" in an uncial face

Placement:

- **Login screen** — logo and title, both large
- **Top panel** — logo only, small

The palette falls out of the artwork and should drive the app theme. Deep green
ink on cream paper suits a novel writing app almost too well:

| Token | Value | Source |
|---|---|---|
| Ink (deepest) | `#134625` | logo primary |
| Ink | `#245537` | logo secondary |
| Ink (wordmark) | `#356548` | title |
| Sage | `#99B6A4` | logo accent |
| Paper | `#ECEBE6` | title background (removed) |
| Paper (bright) | `#FCFDFC` | logo background (removed) |

_OPEN._ Both assets sit on a 1387×756 canvas with the artwork occupying a small
centered region — the logo's true bounds are 440×481 at offset (475, 58), the
wordmark's 514×151 at (437, 276). Rendered as-is in a small top panel, the mark
would appear at roughly a third of its box. Tightening each `viewBox` to the
artwork bounds would fix that; it changes the aspect ratio, so it's your call.

### 5.1 Work view

Two panes. Left: the outline. Right: the document.

The left panel is expandable, collapsible, and pinnable — same interaction model
as the Hermes Notes sidebar.

### 5.2 Outline block cards

Each block in the outline shows:

- word count, in the left margin of the card
- the user-specified label / title
- a couple of lines of content preview
- a kebab menu (`…`) for per-block actions, TBD

Blocks nest visually to show the outline structure, expandable and collapsible per
node.

### 5.3 Scroll binding

Bidirectional. Scrolling the document moves the highlighted block in the outline;
clicking a block in the outline scrolls the document to it.

### 5.4 Drag and drop

Blocks drag anywhere in the outline. Dropping at a new indentation changes the
block's level, and the break rendered before it changes accordingly. Sibling order
is a fractional index, so a move is a single-row update.

_OPEN._ Whether a subtree moves with its root (drag a chapter, its scenes follow)
or detaches. Subtree-moves-with-root is the obvious default.

---

## 6. Settings

### 6.0 Configuration and first run

Two layers, split by what has to exist before the database does.

**`.env.local`** (gitignored; `.env.example` is the template). Read after `.env`
and overriding it, so a shared base can be overridden per host. Holds `PORT`,
`HOST`, `APP_ORIGIN`, `SECURE_COOKIES`.

**`data/brigid.config.json`** (gitignored, mode 0600). Holds the two values that
can't live in the database because one of them *is* the database: the connection
string and the session signing secret. The secret is minted at first boot,
before and independent of any database, so completing setup never requires a
restart to pick up a new cookie key.

**First run happens in the app.** With no database configured the server starts
anyway, in setup mode: `/api/setup/*` is live, everything else answers 503. The
first screen is the setup wizard, which in one submission either provisions a
fresh Postgres role and database from admin credentials or accepts an existing
connection string, then migrates, creates the single account, and signs the
writer straight in.

Setup closes the instant an account exists. That matters: these endpoints are
necessarily unauthenticated — there is nobody to authenticate as yet — so leaving
them reachable afterwards would let anyone repoint the instance at their own
database.

`DATABASE_URL` and `SESSION_SECRET` remain supported in env for anyone who would
rather configure by hand and skip the wizard entirely.

### 6.1 Ollama

Follows the Hermes Notes pattern. The user enters a base URL; Brigid calls
`GET /api/tags` on that host and populates dropdowns from the installed models.
Two independently selectable slots:

- **Inference model**
- **Summarization model**

Single-user means no admin/user split on ownership of this config.

_OPEN._ What inference is actually for. Also whether semantic search over the
manuscript is wanted — that would add a third model slot and pgvector.

---

## 7. Deferred

- **Export.** Real pagination, PDF, EPUB, manuscript-format submission.
- **Revision history.** Not yet discussed.

---

## 8. Open questions

1. Level counter formatting and restart rules (§3.5).
2. Page-number variables in the live page-like view (§4.1).
3. What Ollama inference is for; semantic search or not (§6.1).
4. Subtree behavior on drag (§5.4).
5. Whether "print it in the left margin" means the outline card's margin, as
   read in §5.2, or the document's.
6. Whether to tighten the logo and wordmark `viewBox` to the artwork bounds (§5.0).
