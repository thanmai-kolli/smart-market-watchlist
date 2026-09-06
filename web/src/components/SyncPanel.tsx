import { useState } from "react";
import { issueSyncCode, redeemSyncCode } from "../api.ts";

type Mode = "idle" | "showing" | "entering";

export function SyncPanel({ onAdopted }: { onAdopted: () => void }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [code, setCode] = useState("");
  const [entered, setEntered] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function show() {
    setMessage(null);
    issueSyncCode()
      .then((r) => {
        setCode(r.code);
        setMode("showing");
      })
      .catch(() => setMessage("Could not generate a code."));
  }

  function redeem() {
    setMessage(null);
    redeemSyncCode(entered.trim())
      .then(() => {
        setMode("idle");
        setEntered("");
        onAdopted();
      })
      .catch((e: unknown) =>
        setMessage(e instanceof Error ? e.message : "Could not use that code."),
      );
  }

  return (
    <div className="sync">
      {mode === "idle" && (
        <div className="sync-idle">
          <span className="faint">On another device?</span>
          <button className="link-btn" onClick={show}>
            Get a code
          </button>
          <span className="faint">·</span>
          <button className="link-btn" onClick={() => setMode("entering")}>
            Enter one
          </button>
        </div>
      )}

      {mode === "showing" && (
        <div className="sync-active">
          <label>Open this site elsewhere and enter this code</label>
          <div className="sync-code">
            <code>{code}</code>
            <button
              className="card-btn"
              onClick={() => {
                navigator.clipboard?.writeText(code).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  },
                  () => setMessage("Copy failed — select it manually."),
                );
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="faint">
            Anyone with this code can open your watchlist, so treat it like a
            password. It stays valid until you generate a new one.
          </p>
          <button className="link-btn" onClick={() => setMode("idle")}>
            Done
          </button>
        </div>
      )}

      {mode === "entering" && (
        <div className="sync-active">
          <label htmlFor="sync-input">Paste a code from your other device</label>
          <div className="sync-code">
            <input
              id="sync-input"
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && redeem()}
              placeholder="e.g. 3xK9m…"
              autoComplete="off"
            />
            <button className="card-btn" onClick={redeem} disabled={!entered.trim()}>
              Use it
            </button>
          </div>
          <p className="faint">
            This replaces the list on this device — it does not merge the two.
          </p>
          <button className="link-btn" onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      )}

      {message && <p className="sync-message">{message}</p>}
    </div>
  );
}
