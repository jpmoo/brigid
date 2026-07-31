import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A button that only fires after being held down for a while.
 *
 * Used as the last step before something irreversible. A click is a reflex; a
 * sustained hold is a decision, and letting go part-way cancels it — so there
 * is no single motion that can destroy a manuscript by accident.
 */
export function HoldToConfirm({
  seconds = 3,
  label,
  holdingLabel,
  onConfirm,
  disabled,
}: {
  seconds?: number;
  label: string;
  holdingLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const frame = useRef<number | null>(null);
  const startedAt = useRef(0);
  const fired = useRef(false);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

  const tick = useCallback(() => {
    const elapsed = (performance.now() - startedAt.current) / 1000;
    const next = Math.min(1, elapsed / seconds);
    setProgress(next);
    if (next >= 1) {
      if (!fired.current) {
        fired.current = true;
        stop();
        onConfirm();
      }
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }, [seconds, onConfirm, stop]);

  const start = () => {
    if (disabled) return;
    fired.current = false;
    startedAt.current = performance.now();
    setHolding(true);
    frame.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      className={`hold-btn${holding ? " holding" : ""}`}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // Keyboard equivalent: space or enter held down repeats keydown, which
      // would restart the timer, so the hold is tracked from the first press.
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !holding && !e.repeat) start();
      }}
      onKeyUp={stop}
      onBlur={stop}
    >
      <span className="hold-fill" style={{ transform: `scaleX(${progress})` }} />
      <span className="hold-label">
        {holding ? (holdingLabel ?? "Keep holding…") : label}
      </span>
    </button>
  );
}
