-- Running heads were to be composed per work, from the variable library, as
-- four template bodies. Compile does the job instead: a submission wants
-- Shunn's head — surname, short title, page — and nothing else, and it is
-- decided at the moment of compiling rather than stored against the work.
--
-- The columns were never written to. Dropping them beats leaving four nullable
-- blobs that look like a feature someone forgot to finish.

ALTER TABLE works DROP COLUMN header_verso;
ALTER TABLE works DROP COLUMN header_recto;
ALTER TABLE works DROP COLUMN footer_verso;
ALTER TABLE works DROP COLUMN footer_recto;
