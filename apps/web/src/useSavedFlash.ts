import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A brief "Saved!" on the button that did the saving.
 *
 * Confirmation belongs where the action happened — a banner elsewhere on the
 * page makes you look away from what you just pressed. Clears itself, and
 * cancels on unmount so a closed panel can't set state.
 */
export function useSavedFlash(ms = 1600): [boolean, () => void] {
  const [flashing, setFlashing] = useState(false);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clear, []);

  const flash = useCallback(() => {
    clear();
    setFlashing(true);
    timer.current = window.setTimeout(() => setFlashing(false), ms);
  }, [ms]);

  return [flashing, flash];
}
