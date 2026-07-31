import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

/**
 * In-app confirm and prompt.
 *
 * The browser's own dialogs can't be styled, block the whole tab, and look
 * nothing like the rest of the app. These return promises, so calling code
 * still reads as `if (await confirm(...))` rather than being turned inside out
 * into callbacks.
 */

export interface PromptField {
  label: string;
  value?: string;
  type?: "text" | "number";
  placeholder?: string;
  min?: number;
  max?: number;
  hint?: string;
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: ReactNode;
  fields: PromptField[];
  confirmLabel?: string;
}

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves with one value per field, or null if cancelled. */
  prompt: (options: PromptOptions) => Promise<string[] | null>;
}

const DialogContext = createContext<Dialogs | null>(null);

type Pending =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (values: string[] | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const firstField = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setPending(null);
    setValues([]);
  }, []);

  const api = useMemo<Dialogs>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => setPending({ kind: "confirm", options, resolve })),
      prompt: (options) =>
        new Promise<string[] | null>((resolve) => {
          setValues(options.fields.map((f) => f.value ?? ""));
          setPending({ kind: "prompt", options, resolve });
        }),
    }),
    [],
  );

  const cancel = () => {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve(null);
    close();
  };

  const accept = (e?: FormEvent) => {
    e?.preventDefault();
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(true);
    else pending.resolve(values);
    close();
  };

  return (
    <DialogContext.Provider value={api}>
      {children}

      {pending ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={cancel}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        >
          <form
            className="modal dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={accept}
            role="dialog"
            aria-modal="true"
            aria-label={pending.options.title}
          >
            <h2 className="card-title">{pending.options.title}</h2>
            {pending.options.message ? (
              <div className="card-subtitle">{pending.options.message}</div>
            ) : null}

            {pending.kind === "prompt"
              ? pending.options.fields.map((field, i) => (
                  <div className="field" key={i}>
                    <label className="field-label" htmlFor={`dlg-${i}`}>
                      {field.label}
                    </label>
                    <input
                      id={`dlg-${i}`}
                      ref={i === 0 ? firstField : undefined}
                      type={field.type ?? "text"}
                      min={field.min}
                      max={field.max}
                      placeholder={field.placeholder}
                      value={values[i] ?? ""}
                      autoFocus={i === 0}
                      onChange={(e) =>
                        setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                      }
                    />
                    {field.hint ? <p className="field-hint">{field.hint}</p> : null}
                  </div>
                ))
              : null}

            <div className="modal-actions">
              <div className="spacer" />
              <button className="btn secondary" type="button" onClick={cancel}>
                {pending.kind === "confirm" ? (pending.options.cancelLabel ?? "Cancel") : "Cancel"}
              </button>
              <button
                className={`btn${pending.kind === "confirm" && pending.options.danger ? " danger" : ""}`}
                type="submit"
                autoFocus={pending.kind === "confirm"}
              >
                {pending.options.confirmLabel ??
                  (pending.kind === "confirm" ? "Continue" : "Save")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used inside DialogProvider");
  return ctx;
}
