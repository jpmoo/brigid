-- The conversation about a manuscript, kept.
--
-- A chat that empties when the tab closes is a chat nobody uses twice: the
-- useful questions about a book are the ones you come back to a week later,
-- after writing something the last answer prompted. The transcript is also what
-- makes a follow-up mean anything — "and the other one?" needs the turn before
-- it to have survived.
--
-- Per manuscript, because that is what the conversation is about. Clearing is
-- the writer's decision and takes the lot; there is no partial forgetting, and
-- a chat that quietly dropped its own middle would answer worse without saying
-- why.

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  -- 'user' | 'assistant'
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_role_known
  CHECK (role IN ('user', 'assistant'));

-- Read in order, always, and only ever for one manuscript.
CREATE INDEX chat_messages_work_time_idx ON chat_messages (work_id, created_at);
