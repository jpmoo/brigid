-- When to take a backup, and how many to keep.
--
-- The backups themselves are files on disk and are listed by reading the
-- directory rather than by a table. That way a file dropped in by hand — or
-- uploaded through the import tool — is a backup like any other, and the
-- listing can never disagree with what is actually there.

ALTER TABLE settings ADD COLUMN backup_enabled boolean NOT NULL DEFAULT true;
-- Local time on the server, which is the clock the writer thinks in.
ALTER TABLE settings ADD COLUMN backup_hour integer NOT NULL DEFAULT 1;
ALTER TABLE settings ADD COLUMN backup_minute integer NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN backup_keep integer NOT NULL DEFAULT 10;

ALTER TABLE settings ADD CONSTRAINT settings_backup_hour_range
  CHECK (backup_hour BETWEEN 0 AND 23);
ALTER TABLE settings ADD CONSTRAINT settings_backup_minute_range
  CHECK (backup_minute BETWEEN 0 AND 59);
-- At least one: a retention of zero would delete the backup it just took.
ALTER TABLE settings ADD CONSTRAINT settings_backup_keep_range
  CHECK (backup_keep BETWEEN 1 AND 200);
