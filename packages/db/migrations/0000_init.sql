-- Brigid initial schema.
--
-- Single user, one Postgres database. The shape follows the spec in
-- docs/brigid-spec.md: a work is a tree of blocks, a block's format comes from a
-- template, and the break rendered before a block is derived from its depth via
-- work_levels rather than stored on the block.

-- ---------------------------------------------------------------- identity --

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------- settings --

-- Singleton. Ollama config lives here, not in env, so it is changeable from the
-- UI without a redeploy.
CREATE TABLE settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ollama_url          text,
  inference_model     text,
  summarization_model text,
  preferences         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (id) VALUES (1);

-- --------------------------------------------------------------- templates --

CREATE TABLE templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category        text NOT NULL CHECK (category IN ('break', 'block-format')),
  name            text NOT NULL,
  builtin_key     text UNIQUE,
  body            jsonb NOT NULL,
  break_settings  jsonb,
  format_settings jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Each category carries exactly its own settings blob.
  CONSTRAINT templates_settings_match_category CHECK (
    (category = 'break'        AND break_settings IS NOT NULL AND format_settings IS NULL) OR
    (category = 'block-format' AND format_settings IS NOT NULL AND break_settings IS NULL)
  )
);

CREATE INDEX templates_category_idx ON templates (category);

-- ------------------------------------------------------------------- works --

CREATE TABLE works (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  subtitle          text,
  author_first_name text,
  author_last_name  text,
  page_setup        jsonb NOT NULL,
  header_verso      jsonb,
  header_recto      jsonb,
  footer_verso      jsonb,
  footer_recto      jsonb,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The layers of organization within a work, one row per outline depth. Dragging
-- a block to a different indentation changes which row applies to it, and so
-- changes the break rendered before it.
CREATE TABLE work_levels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id           uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  depth             integer NOT NULL CHECK (depth >= 0),
  name              text NOT NULL,
  break_template_id uuid REFERENCES templates(id) ON DELETE SET NULL,
  counter_restart   text NOT NULL DEFAULT 'continuous'
                    CHECK (counter_restart IN ('continuous', 'under-parent')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_levels_work_depth_key UNIQUE (work_id, depth)
);

-- ------------------------------------------------------------------ blocks --

-- The manuscript. A chapter is not a special entity: it is a block with
-- children. ON DELETE CASCADE on parent_id means deleting a block takes its
-- subtree with it.
CREATE TABLE blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id      uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES blocks(id) ON DELETE CASCADE,
  sort_key     text NOT NULL,
  label        text,
  format_id    uuid NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
  content      jsonb,
  content_text text NOT NULL DEFAULT '',
  word_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blocks_work_parent_sort_idx ON blocks (work_id, parent_id, sort_key);

-- --------------------------------------------------------------- built-ins --

-- Seeded, editable, undeletable. The writer adds their own alongside these.

INSERT INTO templates (category, name, builtin_key, body, format_settings) VALUES
  (
    'block-format',
    'Regular text',
    'regular-text',
    '{"nodes":[{"type":"content"}]}'::jsonb,
    '{"countsTowardWordCount":true,"structural":true}'::jsonb
  ),
  (
    'block-format',
    'Title page',
    'title-page',
    '{"nodes":[
        {"type":"spacer","lines":8},
        {"type":"paragraph","align":"center","content":[
          {"type":"variable","name":"manuscriptTitle","allCaps":true}]},
        {"type":"spacer","lines":2},
        {"type":"paragraph","align":"center","content":[
          {"type":"variable","name":"manuscriptSubtitle","italic":true}]},
        {"type":"spacer","lines":6},
        {"type":"paragraph","align":"center","content":[
          {"type":"variable","name":"authorFirstName"},
          {"type":"text","text":" "},
          {"type":"variable","name":"authorLastName"}]},
        {"type":"pageBreak"}
      ]}'::jsonb,
    '{"countsTowardWordCount":false,"structural":false}'::jsonb
  );

INSERT INTO templates (category, name, builtin_key, body, break_settings) VALUES
  (
    'break',
    'Chapter break',
    'chapter-break',
    '{"nodes":[
        {"type":"pageBreak"},
        {"type":"spacer","lines":4},
        {"type":"paragraph","align":"center","content":[
          {"type":"text","text":"Chapter ","smallCaps":true},
          {"type":"variable","name":"levelCounter","numberFormat":"arabic","smallCaps":true}]},
        {"type":"spacer","lines":2}
      ]}'::jsonb,
    -- A chapter heading directly under a part title is correct, so no suppression.
    -- Opening paragraph runs flush, the usual convention for a chapter opening.
    '{"suppressOnFirstChild":false,"indentFirstParagraph":false}'::jsonb
  ),
  (
    'break',
    'Section break',
    'section-break',
    '{"nodes":[
        {"type":"spacer","lines":1},
        {"type":"paragraph","align":"center","content":[{"type":"text","text":"⁂"}]},
        {"type":"spacer","lines":1}
      ]}'::jsonb,
    -- An ornament immediately beneath a chapter heading is wrong, so suppress it
    -- on the first child.
    '{"suppressOnFirstChild":true,"indentFirstParagraph":false}'::jsonb
  );
