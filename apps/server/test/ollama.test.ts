/**
 * The address the writer types, and what comes back from it.
 *
 * The host is the one setting in Brigid that makes the server go and talk to
 * somewhere it was told about, so what counts as an address is worth pinning
 * down. The reply is checked against a real HTTP server rather than a stub —
 * the failures that matter here are a host that isn't Ollama and a host that
 * isn't there, and neither is interesting when it's mocked.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { parseJson, thinksFrom } from "../src/ollama/client.js";
import { buildRoster, foldName } from "../src/ollama/analysis.js";
import { asOllamaUrl, modelsAt } from "../src/ollama/routes.js";

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

async function refuses(label: string, value: string): Promise<void> {
  try {
    asOllamaUrl(value);
    check(label, false, "it was accepted");
  } catch {
    check(label, true);
  }
}

console.log("\nthe address");

check("a plain host and port is kept", asOllamaUrl("http://localhost:11434") === "http://localhost:11434");
check("https is allowed", asOllamaUrl("https://ollama.lan") === "https://ollama.lan");
check("surrounding space is ignored", asOllamaUrl("  http://box:11434  ") === "http://box:11434");

// A path would be joined onto `/api/tags` and make a nonsense request; a
// trailing slash would make a double one. Both are cut back to the origin.
check("a path is dropped", asOllamaUrl("http://box:11434/api/") === "http://box:11434");
check("a trailing slash is dropped", asOllamaUrl("http://box:11434/") === "http://box:11434");
check("a query is dropped", asOllamaUrl("http://box:11434/?x=1") === "http://box:11434");

await refuses("file: is refused", "file:///etc/passwd");
await refuses("a bare word is refused", "localhost:11434");
await refuses("nothing is refused", "");
await refuses("credentials in the address are refused", "http://user:pw@box:11434");

console.log("\nwhat the host answers");

/** Stands in for Ollama, and for the things that aren't it. */
async function serving(
  handler: (url: string, res: import("node:http").ServerResponse) => void,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => handler(req.url ?? "", res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await serving(
  (url, res) => {
    if (url !== "/api/tags") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          { name: "qwen2.5:14b", size: 9 },
          { name: "llama3.1:8b", size: 4 },
          { digest: "no name here" },
        ],
      }),
    );
  },
  async (origin) => {
    const models = await modelsAt(origin);
    check("the names come back", models.includes("llama3.1:8b") && models.includes("qwen2.5:14b"));
    check("sorted, so the menu doesn't reshuffle", models[0] === "llama3.1:8b");
    check("an entry with no name is left out", models.length === 2);
  },
);

// Something is listening, but it isn't Ollama — a router's admin page, say.
await serving(
  (_url, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end("<html>hello</html>");
  },
  async (origin) => {
    try {
      await modelsAt(origin);
      check("a host that isn't Ollama is refused", false, "it was accepted");
    } catch (err) {
      check("a host that isn't Ollama is refused", /not like Ollama/.test((err as Error).message));
    }
  },
);

await serving(
  (_url, res) => {
    res.writeHead(500).end();
  },
  async (origin) => {
    try {
      await modelsAt(origin);
      check("a host that errors is refused", false, "it was accepted");
    } catch (err) {
      check("a host that errors is refused", /500/.test((err as Error).message));
    }
  },
);

// Nothing at all — port 1 on loopback, where nothing listens.
try {
  await modelsAt("http://127.0.0.1:1");
  check("a host that isn't there is refused", false, "it was accepted");
} catch (err) {
  check("a host that isn't there is refused", /nothing answered/.test((err as Error).message));
}



console.log("\ndigging the answer out");

// The failure that started this: an empty answer reported as "not JSON: ",
// which told nobody anything. Each of these is a way a real model has of
// handing back an answer that isn't bare JSON.
function parsesTo(label: string, input: string, want: unknown): void {
  try {
    check(label, JSON.stringify(parseJson(input)) === JSON.stringify(want));
  } catch (err) {
    check(label, false, (err as Error).message);
  }
}

parsesTo("bare JSON parses", '{"a":1}', { a: 1 });
parsesTo("a fenced block is unwrapped", '```json\n{"a":1}\n```', { a: 1 });
parsesTo("an unlabelled fence too", '```\n{"a":1}\n```', { a: 1 });
parsesTo("inline reasoning is stripped", '<think>let me see</think>\n{"a":1}', { a: 1 });
parsesTo("a sentence of preamble is skipped", 'Here is the result:\n{"a":1}', { a: 1 });
parsesTo("reasoning wrapped around a fence", '<think>hm</think>```json\n{"a":1}```', { a: 1 });

for (const [label, input] of [
  ["nothing at all is refused", ""],
  ["whitespace is refused", "   \n  "],
  ["reasoning with no answer is refused", "<think>still thinking</think>"],
  ["prose with no JSON is refused", "I could not do that."],
] as const) {
  try {
    parseJson(input);
    check(label, false, "it was accepted");
  } catch {
    check(label, true);
  }
}

console.log("\nwhat the model can do");

check("a thinking model is recognized", thinksFrom({ capabilities: ["completion", "thinking"] }) === true);
check("a plain one is recognized too", thinksFrom({ capabilities: ["completion"] }) === false);
// Null and false are not the same: `think: false` is rejected outright by
// Ollama on a model that lacks the capability, so an unknown must not be
// treated as a no.
check("an Ollama that doesn't say gives null", thinksFrom({}) === null);

console.log("\nfolding two spellings of one name");

// The reported case: one section counts them, the next doesn't.
check("a counting word is dropped", foldName("Two French brothers") === foldName("French brothers"));
check("so is an article", foldName("The housekeeper") === foldName("housekeeper"));
check("and stacked ones", foldName("Some other servants") === foldName("servants"));
check("punctuation and case don't matter", foldName("Mr. Darcy") === foldName("mr darcy"));

// The error worth avoiding is the opposite one. A duplicate is untidy; a merge
// is wrong, and these are two different people.
check("honorifics are kept", foldName("Mr Bennet") !== foldName("Mrs Bennet"));
check("distinct names stay distinct", foldName("Jane") !== foldName("Jane Fairfax"));
// A name that is only a counting word must survive being folded.
check("a bare noise word is left alone", foldName("The Two") !== "");

console.log("\ntitles, folded only when the cast says it is safe");

/** A roster from bare (name, sections) pairs — one action each, two sections. */
function rosterOf(names: string[]) {
  const sections = [0, 1].map((i) => ({
    blockId: `b${i}`,
    label: `s${i}`,
    start: i / 2,
    end: (i + 1) / 2,
    words: 100,
    summary: "",
    events: [],
    characters: names.map((name) => ({ name, aliases: [], actions: ["did a thing"] })),
  }));
  return buildRoster(sections as never);
}

// One title claims the bare name, so they are the same person.
{
  const names = rosterOf(["Tuan", "Brother Tuan"]).map((r) => r.name);
  check("Brother Tuan folds into Tuan", names.length === 1 && names[0] === "Tuan");
}

// Two titles claim it, so the title is the only thing telling them apart.
{
  const names = rosterOf(["Mr Bennet", "Mrs Bennet"]).map((r) => r.name).sort();
  check("Mr and Mrs Bennet stay two people", names.length === 2);
}

// A title with no bare form to fold into is left exactly as it is.
{
  const names = rosterOf(["Captain Wentworth", "Anne"]).map((r) => r.name).sort();
  check("a title with nothing to fold into is untouched", names.length === 2);
}

// And the bare name keeps the titled one as an alias, so the record is whole.
{
  const [entry] = rosterOf(["Tuan", "Brother Tuan"]);
  check("the folded form is kept as an alias", entry!.aliases.includes("Brother Tuan"));
  check("and its record is added, not discarded", entry!.actions === 4);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
