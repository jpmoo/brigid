-- Being able to call the reading off.
--
-- Reading a novel takes the better part of an hour of a machine's full
-- attention, and the writer may want that machine back — or may have realized
-- the run is against a manuscript they are about to restructure anyway. Until
-- now the only way to stop it was to stop the server.
--
-- A stopped walk keeps everything it has read. Resuming carries on from the
-- next unread section; starting over throws the sections away first, which is
-- the honest way to pick up a prompt change or a model change that makes the
-- earlier reading no longer comparable with the later.

ALTER TABLE digest_state DROP CONSTRAINT digest_state_status_known;
ALTER TABLE digest_state ADD CONSTRAINT digest_state_status_known
  CHECK (status IN ('idle', 'walking', 'failed', 'stopped'));
