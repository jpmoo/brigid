-- Whether the chosen model thinks before answering.
--
-- Reasoning models spend tokens on working before they produce a result. For
-- reading a chapter that is waste twice over: the job is transcription rather
-- than reasoning, and with a constrained JSON format the working can consume
-- the whole budget and leave the answer empty — which is exactly the failure
-- this column exists to prevent.
--
-- It has to be detected rather than assumed, because Ollama rejects a request
-- that passes `think` to a model with no thinking capability. So the capability
-- is read from the model when it is chosen, the same moment its context window
-- is, and thinking is switched off only where switching it off is legal.
--
-- Null means unknown — an older Ollama that doesn't report capabilities. In
-- that case nothing is sent, and the fallback ladder in the client handles a
-- thinking model the slow way.

ALTER TABLE settings ADD COLUMN ollama_thinks boolean;

COMMENT ON COLUMN settings.ollama_thinks IS
  'True when the model reports a thinking capability, so `think: false` is safe '
  'to send. Null when Ollama did not say.';
