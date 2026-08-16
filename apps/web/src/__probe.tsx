import { createRoot } from "react-dom/client";
import { ProseProfile } from "./pages/settings/ai/ProseProfile.js";
import { REFERENCE_WORKS } from "@brigid/shared";

// A manuscript with long, comma-heavy sentences: it should land at the ornate
// end of the tracks and name the books that are written that way.
const like = REFERENCE_WORKS.find((w) => w.title === "Moby-Dick")!;
const mine: Record<string, number> = {};
for (const [k, v] of Object.entries(like.features)) mine[k] = v * 1.05;

createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 24, maxWidth: 760 }}>
    <ProseProfile features={mine} dialogueShare={0.18} />
  </div>,
);
