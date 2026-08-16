-- The style card is not the writer's to edit.
--
-- It was, briefly. Two things were wrong with that. What the card says is an
-- account of what the measurements show, so a rewritten one is no longer that
-- — and it is the text handed to the model when it is asked to write in this
-- voice, which made an edited card a way to instruct the model while appearing
-- to describe it. A description nobody can argue with is worse than one that
-- can be regenerated from the numbers it came from.
--
-- So the column goes, along with the endpoint that set it. If the card reads
-- wrong, what is wrong is either the measurements or which sections are being
-- counted, and both of those can be changed.

ALTER TABLE style_profiles DROP COLUMN IF EXISTS card_edited;
