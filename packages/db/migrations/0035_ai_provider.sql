-- Which kind of server is answering.
--
-- Brigid talked to Ollama and only Ollama. It now talks to anything serving the
-- OpenAI shape as well — llama.cpp, LM Studio, vLLM — because the writer's
-- choice of runner is their business and not this application's.
--
-- Detected rather than asked. The address is probed when it is saved: a server
-- answering /api/tags is Ollama, one answering /v1/models is the other kind.
--
-- Null on rows written before this existed, which means Ollama, because at the
-- time there was nothing else it could have been.
ALTER TABLE settings ADD COLUMN ai_provider text;

ALTER TABLE settings ADD CONSTRAINT settings_ai_provider_known
  CHECK (ai_provider IS NULL OR ai_provider IN ('ollama', 'openai'));

COMMENT ON COLUMN settings.ai_provider IS
  'Which protocol the endpoint speaks, detected when the address was saved. '
  'Null means Ollama, which is what every row predating this column used.';

-- A key, for servers that ask for one.
--
-- llama.cpp wants none; vLLM started with --api-key wants one, and so does
-- anything behind a proxy. Optional, and sent as a bearer token only when it is
-- set.
--
-- It is stored in the clear, in a database on the writer's own machine, which
-- is the same place the manuscript is. That is the honest description: this is
-- not a secret store, and a key that would matter if it leaked belongs
-- somewhere else.
--
-- It is never sent back to the browser. The settings screen is told whether one
-- exists, not what it is.
ALTER TABLE settings ADD COLUMN ai_api_key text;

COMMENT ON COLUMN settings.ai_api_key IS
  'Bearer token for endpoints that require one. Never returned to the client.';
