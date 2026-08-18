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
import { ground } from "../src/ollama/digest.js";
import { excerpt } from "../src/ollama/excerpt.js";
import { buildBrief } from "../src/ollama/chat.js";
import type { PlacedDigest } from "@brigid/shared";
import { asEndpointUrl } from "../src/ollama/routes.js";
import { detect } from "../src/ollama/detect.js";

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
    asEndpointUrl(value);
    check(label, false, "it was accepted");
  } catch {
    check(label, true);
  }
}

console.log("\nthe address");

check("a plain host and port is kept", asEndpointUrl("http://localhost:11434") === "http://localhost:11434");
check("https is allowed", asEndpointUrl("https://ollama.lan") === "https://ollama.lan");
check("surrounding space is ignored", asEndpointUrl("  http://box:11434  ") === "http://box:11434");

/**
 * A path is how a proxied endpoint is reached, so it is kept — dropping it sent
 * every request to the root of the host, which answered 404 from something that
 * had never heard of the model server. A trailing slash would double the join,
 * and a trailing `/v1` would be asked for twice, since `/v1/...` is appended.
 */
check(
  "a path is kept, because a proxied endpoint is reached by one",
  asEndpointUrl("http://box/gateway/openai") === "http://box/gateway/openai",
);
check(
  "a trailing /v1 is dropped, since one is appended",
  asEndpointUrl("http://box:8080/v1") === "http://box:8080",
);
check(
  "and dropped from under a prefix too",
  asEndpointUrl("http://box/gateway/openai/v1") === "http://box/gateway/openai",
);
check("a trailing slash is dropped", asEndpointUrl("http://box:11434/") === "http://box:11434");
check("a query is dropped", asEndpointUrl("http://box:11434/?x=1") === "http://box:11434");

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
    if (url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          models: [
            { name: "qwen2.5:14b", size: 9 },
            { name: "llama3.1:8b", size: 4 },
            { digest: "no name here" },
          ],
        }),
      );
      return;
    }
    // The verification step: real Ollama answers this too, which is what
    // tells it apart from a server that only shims the listing.
    if (url === "/api/show") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ capabilities: ["completion"] }));
      return;
    }
    res.writeHead(404).end();
  },
  async (origin) => {
    const found = await detect(origin);
    check("Ollama is recognized by its own listing", found?.provider === "ollama");
    check(
      "and the names come back",
      Boolean(found?.models.includes("llama3.1:8b") && found.models.includes("qwen2.5:14b")),
    );
    check("an entry with no name is left out", found?.models.length === 2);
  },
);

/**
 * An OpenAI-compatible server, which is anything that is not Ollama: llama.cpp,
 * LM Studio, vLLM. It is recognized by the listing it serves rather than by
 * being asked, so a writer never has to know which kind they are running.
 */
await serving(
  (url, res) => {
    if (url === "/api/tags") {
      res.writeHead(404).end();
      return;
    }
    if (url === "/v1/models") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "local-model" }] }));
      return;
    }
    if (url === "/props") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } }));
      return;
    }
    res.writeHead(404).end();
  },
  async (origin) => {
    const found = await detect(origin);
    check("an OpenAI-compatible server is recognized", found?.provider === "openai");
    check("and says what it is serving", found?.models[0] === "local-model");
    // llama.cpp reports the window it was started with; most do not, and a
    // number invented here would be worse than none.
    check("and its window, when it reports one", found?.numCtx === 16384);
  },
);

/**
 * llama.cpp shims Ollama's listing for tool compatibility without implementing
 * generation behind it. Answering /api/tags is what fooled detection into
 * calling this server Ollama and sending every request to /api/generate, which
 * 404s forever — the bug a writer actually hit.
 */
await serving(
  (url, res) => {
    if (url === "/api/tags") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ models: [{ name: "qwen3.6-35b" }] }));
      return;
    }
    if (url === "/api/show") {
      // The part a listing-only shim has no reason to have implemented.
      res.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify({ error: { message: "File Not Found", type: "not_found_error", code: 404 } }),
      );
      return;
    }
    if (url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: [{ id: "/home/user/models/qwen3.6-35b.gguf" }],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  },
  async (origin) => {
    const found = await detect(origin);
    check(
      "a listing-only Ollama shim is not mistaken for Ollama",
      found?.provider === "openai",
      found?.provider,
    );
    check("and falls through to what it actually serves", Boolean(found?.models[0]?.includes("qwen3.6-35b")));
  },
);

/** Real Ollama, where /api/show answers, is still called Ollama. */
await serving(
  (url, res) => {
    if (url === "/api/tags") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
      return;
    }
    if (url === "/api/show") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          model_info: { "llama.context_length": 131072 },
          capabilities: ["completion"],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  },
  async (origin) => {
    const found = await detect(origin);
    check("a server that can show what it listed is still Ollama", found?.provider === "ollama");
    check("with the window /api/show reported", found?.numCtx === 131072);
  },
);

// Something is listening, but it is neither — a router's admin page, say.
await serving(
  (_url, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end("<html>hello</html>");
  },
  async (origin) => {
    check("a host serving neither protocol is not claimed", (await detect(origin)) === null);
  },
);

await serving(
  (_url, res) => {
    res.writeHead(500).end();
  },
  async (origin) => {
    check("nor is one that errors", (await detect(origin)) === null);
  },
);

// Nothing at all — port 1 on loopback, where nothing listens.
check("nor is one that isn't there", (await detect("http://127.0.0.1:1")) === null);



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

console.log("\nkeeping the reading tied to the page");

const PROSE =
  "Tuan set down the lamp. Across the yard, Ash was still waiting, and neither of them spoke.";

function grounded(characters: { name: string; aliases?: string[] }[], known: string[] = []) {
  const digest = {
    summary: "",
    characters: characters.map((c) => ({ aliases: [], actions: ["did a thing"], ...c })),
    events: [],
  };
  return ground(digest as never, PROSE, known).characters.map((c) => c.name);
}

check("a name in the prose is kept", grounded([{ name: "Tuan" }]).length === 1);
check("so is a surname inside a longer form", grounded([{ name: "Colonel Ash" }]).length === 1);
check("and one reached through an alias", grounded([{ name: "The Keeper", aliases: ["Tuan"] }]).length === 1);

// The hallucination: nobody of that name is here, and the book has never
// mentioned them either.
check("an invented name is dropped", grounded([{ name: "Beatrice Vane" }]).length === 0);

// But someone the book already established, named here from a pronoun, is
// resolution rather than invention — which is what the known-names list is for.
check(
  "an established name resolved from a pronoun is kept",
  grounded([{ name: "Beatrice Vane" }], ["Beatrice Vane"]).length === 1,
);

// A title alone must not ground anyone: "Mr" is on every other page.
check("a title alone does not ground a name", grounded([{ name: "Mr Fairfax" }]).length === 0);

// The narrating voice is never named in the prose it narrates, so grounding
// would delete it every time — which is how it went missing in the first place.
check("the narrator survives grounding", grounded([{ name: "Narrator" }]).length === 1);
check("and so does a titled form of it", grounded([{ name: "The Narrator" }]).length === 1);

console.log("\nshowing the model a passage without flattening it");

/**
 * The obvious way to trim prose to a word count splits on whitespace and joins
 * the first n back with spaces — and paragraph breaks are whitespace. Every
 * exemplar reached the model as one unbroken block, so it learned that this
 * writer does not break paragraphs, and wrote back the same way. A sample is an
 * instruction, and a sample with its shape removed is a wrong one.
 */
const SCENE = [
  '"Where were you," she said.',
  '"Out."',
  "He put the cup down on the sill where the paint had gone. There was nothing in the yard to have been out in, and they both knew it, and neither of them said so.",
  '"All right," she said. "All right."',
].join("\n\n");

{
  const whole = excerpt(SCENE, 500);
  check("a passage keeps its paragraphs", whole.split(/\n{2,}/).length === 4, whole);
  check("including a one-word reply of its own", whole.includes('"Out."'));

  /**
   * The path a real exemplar takes. A whole section runs past any sane budget,
   * and it was only on being trimmed that the old cut flattened what it kept —
   * so a short fixture passes either way and guards nothing.
   */
  const trimmed = excerpt(`${SCENE}\n\n${SCENE}\n\n${SCENE}`, 60);
  check(
    "a long passage keeps them through the trim",
    trimmed.split(/\n{2,}/).filter((p) => p !== "…").length >= 3,
    trimmed,
  );
  check("and still breaks for each speaker", trimmed.includes('"Out."'), trimmed);
  check(
    "and every quotation mark",
    (whole.match(/"/g) ?? []).length === (SCENE.match(/"/g) ?? []).length,
  );
  check("a passage that fits is not marked as cut", !whole.endsWith("…"));

  const short = excerpt(SCENE, 12);
  check("a cut passage says it was cut", short.endsWith("…"), short);
  check(
    "and is cut between paragraphs, not through one",
    short
      .split(/\n{2,}/)
      .filter((p) => p !== "…")
      .every((p) => SCENE.includes(p)),
    short,
  );

  const long = excerpt("word ".repeat(400).trim(), 50);
  check("a single paragraph longer than the budget is cut inside it", long.split(/\s+/).length <= 55);
  check("and says so too", long.includes("…"));
}

console.log("\nthe writer's own marks on the manuscript");

{
  const long = Array.from({ length: 9 }, (_, i) => `Paragraph ${i + 1} of it.`).join("\n\n");
  const sections = [
    { blockId: "a", label: "14.4", start: 0.62, words: 900, summary: "", events: [], characters: [] },
    { blockId: "b", label: "3.1", start: 0.14, words: 800, summary: "", events: [], characters: [] },
  ] as unknown as PlacedDigest[];
  const marks = [
    {
      name: "The hinge",
      description: "Not sure this turn is earned yet.",
      section: "14.4",
      at: 0.62,
      line: { index: 4, of: 9, text: "Paragraph 5 of it." },
    },
    { name: "Check the dog", description: null, section: "3.1", at: 0.14, line: { index: 0, of: 6, text: "The dog." } },
  ];
  const ask = (question: string) =>
    buildBrief(
      {
        title: "T", totalWords: 60000, structure: null, profiles: [], sections,
        prose: new Map([["a", long], ["b", "short"]]), question, bookmarks: marks,
      },
      32768,
    );

  const asked = ask("What did I mean by the bookmark halfway through 14.4?");
  check("a bookmark is listed with the note left on it", asked.includes("Not sure this turn is earned yet."));
  check("and the line it marks", asked.includes('marks: "Paragraph 5 of it."'));
  /**
   * "Paragraph 5" answers nothing on its own — five of how many? A writer says
   * "halfway through", so the position is given that way and by the count.
   */
  check("and where in the section, in words", asked.includes("about halfway through (paragraph 5 of 9)"));
  check("and where in the book", asked.includes("[62% of the book]"));

  // Naming a bookmark names its section: "revise the bit at The hinge" is as
  // much a request about 14.4 as naming the number would be.
  const byName = ask("Revise the bit at The hinge in my voice");
  check("naming a bookmark pulls its section in whole", byName.includes("14.4 — COMPLETE"));

  const byWord = ask("what was I worried about at the hinge");
  check("and a distinctive word of the name is enough", byWord.includes("14.4 — COMPLETE"));

  const unrelated = ask("What is the shape of the book?");
  check(
    "a question naming none of them pulls no section in whole",
    !unrelated.includes("— COMPLETE"),
  );
  check("but the marks are still listed", unrelated.includes("=== BOOKMARKS"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
