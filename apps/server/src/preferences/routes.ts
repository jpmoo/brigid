import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";

/**
 * How the writer likes to be shown their work.
 *
 * Kept on the server rather than in the browser. A self-hosted app has one
 * writer, and the size of the type is a decision they made once — it should
 * hold on the laptop, on the desktop, and after clearing site data, the same
 * way the rest of their settings do.
 *
 * The column is a free-form blob on purpose: these are small, they accumulate,
 * and none of them is worth a migration each. Only known keys are accepted, so
 * the blob can't collect whatever a client feels like sending.
 */
const preferences = z.object({
  /** A multiplier, not an index — the ladder of sizes can change. */
  textScale: z.number().min(0.5).max(3).optional(),
  viewMode: z.enum(["book", "manuscript"]).optional(),
});

export type Preferences = z.infer<typeof preferences>;

export async function preferencesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/preferences", async (req) => {
    requireUser(req);
    const [row] = await db
      .select({ preferences: settings.preferences })
      .from(settings)
      .limit(1);
    // Anything unrecognised in the column is dropped rather than handed on.
    return { preferences: preferences.parse(row?.preferences ?? {}) };
  });

  app.patch("/preferences", async (req) => {
    requireUser(req);
    const patch = preferences.parse(req.body);

    const [row] = await db
      .select({ id: settings.id, preferences: settings.preferences })
      .from(settings)
      .limit(1);
    if (!row) return { preferences: patch };

    // Merged, not replaced: two controls save independently and neither should
    // erase what the other just set.
    const merged = { ...(row.preferences ?? {}), ...patch };
    const [saved] = await db
      .update(settings)
      .set({ preferences: merged as never, updatedAt: new Date() })
      .where(eq(settings.id, row.id))
      .returning({ preferences: settings.preferences });

    return { preferences: preferences.parse(saved?.preferences ?? merged) };
  });
}
