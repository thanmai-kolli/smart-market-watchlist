import { useState } from "react";
import type { WatchlistSummary } from "../../../shared/types.ts";

/**
 * Switching, naming and removing lists.
 *
 * "All lists" is a first-class choice rather than the absence of one, because
 * the briefing spends a single budget of three across everything a person
 * tracks — so the combined view is the honest default, not a special case.
 */
export function ListBar({
  lists,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  lists: WatchlistSummary[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const active = lists.find((l) => l.id === activeId) ?? null;
  const total = lists.reduce((n, l) => n + l.count, 0);

  const submit = () => {
    const name = draft.trim();
    if (name.length > 0) onCreate(name);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="listbar">
      <div className="listbar-tabs" role="tablist" aria-label="Your watchlists">
        <button
          role="tab"
          aria-selected={activeId === null}
          className={`list-tab ${activeId === null ? "on" : ""}`}
          onClick={() => onSelect(null)}
        >
          All lists <span className="list-count">{total}</span>
        </button>

        {lists.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={activeId === l.id}
            className={`list-tab ${activeId === l.id ? "on" : ""}`}
            onClick={() => onSelect(l.id)}
          >
            {l.name} <span className="list-count">{l.count}</span>
          </button>
        ))}

        {adding ? (
          <input
            autoFocus
            className="list-new"
            value={draft}
            maxLength={40}
            placeholder="Name it — Banking, Long-term…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            aria-label="Name for the new list"
          />
        ) : (
          <button className="list-tab ghost" onClick={() => setAdding(true)}>
            + New list
          </button>
        )}
      </div>

      {active && (
        <div className="listbar-actions">
          <button
            className="list-action"
            onClick={() => {
              const name = window.prompt("Rename this list", active.name);
              if (name != null) onRename(active.id, name);
            }}
          >
            Rename
          </button>
          {lists.length > 1 && (
            <button
              className="list-action danger"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${active.name}"? The stocks stay in any other list they are in.`,
                  )
                ) {
                  onDelete(active.id);
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
