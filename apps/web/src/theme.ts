/**
 * Light, dark, or follow the system.
 *
 * "system" is resolved here and written to <html data-theme> rather than being
 * a third state in CSS, so an explicit choice always beats the media query
 * instead of racing it.
 */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "brigid.theme";

export function storedTheme(): ThemeChoice {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(choice: ThemeChoice): void {
  const resolved = choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = resolved;
  if (choice === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
}

/** Keeps "system" honest when the OS flips while the app is open. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
