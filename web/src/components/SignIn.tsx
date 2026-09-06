import { useEffect, useRef, useState } from "react";
import { logIn, register } from "../api.ts";

type Mode = "in" | "up";

/**
 * The sign-in dialog.
 *
 * Deliberately reachable only after the product has already worked for you.
 * Nothing here is required to use anything, so it never appears on arrival.
 */
export function SignIn({
  onDone,
  onClose,
}: {
  onDone: (email: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setBusy(true);

    const run = mode === "in" ? logIn : register;
    run(email, password)
      .then((r) => onDone(r.account?.email ?? email))
      .catch((err: unknown) =>
        setProblem(err instanceof Error ? err.message : "That did not work."),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "in" ? "Sign in" : "Create an account"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <h3>{mode === "in" ? "Sign in" : "Create an account"}</h3>
        <p className="modal-lede">
          {mode === "in"
            ? "Your watchlist, on any device you sign in from."
            : "Keeps the list you already have. Nothing is shared, and there is nothing to confirm."}
        </p>

        <form onSubmit={submit}>
          <label>
            Email
            <input
              ref={first}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              minLength={mode === "up" ? 8 : undefined}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {mode === "up" && (
            <p className="modal-hint">At least 8 characters.</p>
          )}

          {problem && <p className="notice">{problem}</p>}

          <button className="btn btn-primary modal-submit" disabled={busy}>
            {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="modal-switch">
          {mode === "in" ? "No account yet? " : "Already have one? "}
          <button
            className="link-btn"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setProblem(null);
            }}
          >
            {mode === "in" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
