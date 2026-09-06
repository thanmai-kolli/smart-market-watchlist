import { useEffect, useRef, useState } from "react";
import type { SymbolInfo } from "../../../shared/types.ts";
import { searchSymbols } from "../api.ts";

export function SymbolSearch({
  onAdd,
  existing,
}: {
  onAdd: (symbol: string) => void;
  existing: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolInfo[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }

    // Debounced, and stamped so a slow earlier response cannot overwrite a
    // newer one — otherwise results flicker back to a stale query.
    const stamp = ++latest.current;
    const timer = setTimeout(() => {
      searchSymbols(q)
        .then((r) => {
          if (stamp === latest.current) setResults(r.results);
        })
        .catch(() => {
          if (stamp === latest.current) setResults([]);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  function add(symbol: string) {
    onAdd(symbol);
    setQuery("");
    setResults([]);
  }

  const visible = results.filter((r) => !existing.has(r.symbol));

  return (
    <div className="search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add a stock — try INFY, bank, pharma…"
        aria-label="Search stocks to add"
      />

      {query.trim().length > 0 && (
        <div className="results">
          {visible.length === 0 ? (
            <div className="result">
              <span className="result-name">
                {results.length > 0
                  ? "Already on your list"
                  : "No match among the NSE names we cover"}
              </span>
            </div>
          ) : (
            visible.map((r) => (
              <button
                key={r.symbol}
                className="result"
                onClick={() => add(r.symbol)}
              >
                <span className="result-sym">{r.symbol.replace(".NS", "")}</span>
                <span className="result-name">{r.name}</span>
                <span className="result-sector">{r.sector}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
