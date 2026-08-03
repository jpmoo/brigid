-- Which clock "1am" is on.
--
-- The scheduler asked for 01:00 on the server process's own clock, and said so
-- in its comment — but a server is very often set to UTC while the person who
-- typed "1am" meant 1am where they live. The backup then runs four or five
-- hours out and nothing anywhere says why.
--
-- Null means the host's zone, which is what every instance did before this and
-- is right for a machine set to the writer's own time.

ALTER TABLE settings ADD COLUMN backup_timezone text;

COMMENT ON COLUMN settings.backup_timezone IS
  'IANA zone the backup hour is read in. Null means the host clock.';
