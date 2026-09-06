import { useEffect, useRef, useState } from "react";

export interface AnchorOption {
  label: string;
  /** null means "whenever this user actually last acknowledged each symbol". */
  days: number | null;
}

const OPTIONS: AnchorOption[] = [
  { label: "Since you last checked", days: null },
  { label: "Past 24 hours", days: 1 },
  { label: "Past week", days: 7 },
  { label: "Past month", days: 30 },
  { label: "Past 3 months", days: 90 },
];

/**
 * The control that makes the idea legible.
 *
 * Every other watchlist has a fixed, invisible reference point. Making it a
 * visible thing you can move is the fastest way to show that the reference point
 * was ever a choice — change it and the whole briefing recomputes.
 */
export function AnchorControl({
  value,
  onChange,
}: {
  value: AnchorOption;
  onChange: (option: AnchorOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="anchor" ref={ref}>
      <button
        className="anchor-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="anchor-label">{value.label}</span>
        <span className="anchor-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="anchor-menu" role="listbox">
          {OPTIONS.map((o) => (
            <li key={o.label}>
              <button
                role="option"
                aria-selected={o.label === value.label}
                className={o.label === value.label ? "selected" : ""}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const DEFAULT_ANCHOR = OPTIONS[0]!;
