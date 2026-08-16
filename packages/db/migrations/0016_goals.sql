-- Standing goals: a length for the manuscript, and a length for its sections.
--
-- One of each, which the shape enforces rather than a rule having to. The total
-- is a column on the work, so there can only be one; a section goal is a column
-- on the level, so each level has at most its own — a chapter and a scene can
-- both have one, neither can have two.
--
-- Null means no goal. Canceling one is setting it back to null, not deleting a
-- row, so there is nothing to tidy up afterwards.

ALTER TABLE works ADD COLUMN total_word_goal integer;
ALTER TABLE work_levels ADD COLUMN word_goal integer;

ALTER TABLE works ADD CONSTRAINT works_total_word_goal_positive
  CHECK (total_word_goal IS NULL OR total_word_goal > 0);
ALTER TABLE work_levels ADD CONSTRAINT work_levels_word_goal_positive
  CHECK (word_goal IS NULL OR word_goal > 0);
