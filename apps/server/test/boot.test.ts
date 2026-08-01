/**
 * Does the server assemble?
 *
 * Fastify refuses a route it already has, and it refuses it at startup — so a
 * second `PATCH /works/:id` is not a broken endpoint, it is a server that never
 * listens and a gateway with nothing to talk to. Nothing else in these tests
 * would have caught it: every file typechecked, every unit passed, and the
 * thing simply didn't come up.
 *
 * No database and no listening. Registration is the whole question.
 */
import { rm } from "node:fs/promises";

const CONFIG = "/tmp/brigid-boot-test.json";
process.env.BRIGID_CONFIG_PATH = CONFIG;

const { initConfig } = await import("../src/config.js");
const { buildApp } = await import("../src/app.js");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

try {
  await initConfig();
  const app = await buildApp();
  await app.ready();

  check("every route registers without conflict", true);

  // The table is a tree rather than a list of paths, so it is checked for the
  // names of the parts rather than for whole routes — enough to notice a whole
  // group of endpoints failing to register, which is the other silent failure.
  const routes = app.printRoutes({ commonPrefix: false });
  for (const part of ["works", "backups", "spelling", "preferences", "compile", "ollama"]) {
    check(`the ${part} routes are mounted`, routes.includes(part));
  }

  await app.close();
} catch (err) {
  check("every route registers without conflict", false, (err as Error).message.split("\n")[0]);
} finally {
  await rm(CONFIG, { force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
