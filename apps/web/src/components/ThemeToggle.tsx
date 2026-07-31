import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, storedTheme, watchSystemTheme } from "../theme.js";
import type { ThemeChoice } from "../theme.js";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = {
  system: "Following the system",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => storedTheme());

  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  // Only matters while following the system, but harmless otherwise.
  useEffect(() => watchSystemTheme(() => applyTheme(choice)), [choice]);

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";

  return (
    <button
      className="btn ghost"
      type="button"
      title={`${LABEL[choice]} — click for ${LABEL[next].toLowerCase()}`}
      aria-label={`Theme: ${LABEL[choice]}`}
      onClick={() => setChoice(next)}
    >
      {choice === "system" ? <Monitor size={16} /> : choice === "light" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
