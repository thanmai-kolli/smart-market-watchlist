import type { Intent, WatchlistEntry } from "../../../shared/types.ts";
import { StateChip } from "./StateChip.tsx";

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Wording describes the user's own position, never an action to take.
 *
 * "Sell" as a button would read as a recommendation on a page that promises it
 * never makes one.
 */
const INTENTS: Array<{ value: Intent; label: string }> = [
  { value: "none", label: "Just watching" },
  { value: "buy", label: "Watching to buy" },
  { value: "hold", label: "Holding" },
];

export function SymbolRow({
  item,
  showList,
  onRemove,
  onIntent,
}: {
  item: WatchlistEntry;
  showList: boolean;
  onRemove: (symbol: string, listId: string) => void;
  onIntent: (symbol: string, listId: string, intent: Intent) => void;
}) {
  const change = item.changePct;
  const direction = change == null ? "" : change >= 0 ? "up" : "down";
  const label = item.symbol.replace(".NS", "");

  return (
    <div className="row">
      <div>
        <span className="row-sym">{label}</span>
        <StateChip state={item.dataState} />
        {showList && <span className="row-list">{item.listName}</span>}
      </div>
      <div className="row-name">
        <span className="row-company">{item.name}</span>
        <select
          className={`row-intent i-${item.intent}`}
          value={item.intent}
          onChange={(e) => onIntent(item.symbol, item.listId, e.target.value as Intent)}
          aria-label={`What you are doing with ${label}`}
        >
          {INTENTS.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </div>

      <div className={`row-price num ${direction}`}>
        {item.price == null ? "—" : `₹${inr.format(item.price)}`}
      </div>
      <div className={`row-change num ${direction}`}>
        {change == null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
      </div>

      <button
        className="row-remove"
        onClick={() => onRemove(item.symbol, item.listId)}
        aria-label={`Remove ${label} from ${item.listName}`}
        title={`Remove ${label} from ${item.listName}`}
      >
        ×
      </button>
    </div>
  );
}
