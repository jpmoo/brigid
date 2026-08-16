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
  /**
   * Named routes, not just route groups.
   *
   * A whole endpoint went missing here once and nothing noticed: the edit that
   * added it matched no anchor, wrote nothing, and typechecked perfectly —
   * a file that never changed still compiles. The first sign was a 404 in the
   * browser. These are the specific paths the AI panel calls, so a route that
   * quietly fails to register now fails here instead.
   */
  for (const path of [
    "cast", "commit", "chat", "identities", "not-a-character", "canvas",
    "style", "sections", "describe",
  ]) {
    check(`the ${path} route is registered`, routes.includes(path));
  }

  for (const part of ["works", "backups", "spelling", "preferences", "compile", "ollama", "analysis"]) {
    check(`the ${part} routes are mounted`, routes.includes(part));
  }

  /**
   * The shell must never be cacheable.
   *
   * A held copy of index.html names last week's JavaScript, so a server that has
   * been rebuilt, redeployed and migrated goes on serving the old application
   * with nothing anywhere to say so. That failure has cost more time here than
   * any bug, and it is invisible from the server side, so it is asserted.
   */
  try {
    const shell = await app.inject({ method: "GET", url: "/" });
    const cache = String(shell.headers["cache-control"] ?? "");
    // Only meaningful when a build is present; API-only is a valid state.
    if (shell.statusCode === 200) {
      check("the shell is served no-store", /no-store/.test(cache), `got "${cache}"`);
    } else {
      check("the shell is served no-store", true);
    }
  } catch (err) {
    check("the shell is served no-store", false, (err as Error).message);
  }

    await app.close();

} catch (err) {
  check("every route registers without conflict", false, (err as Error).message.split("\n")[0]);
} finally {
  await rm(CONFIG, { force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
