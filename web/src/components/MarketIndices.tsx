import { useEffect, useState } from "react";
import type { IndicesResponse } from "../../../shared/types.ts";
import { getIndices } from "../api.ts";

const value = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * The ordinary market picture, which the rest of this page deliberately is not.
 *
 * Every other panel here answers "has anything happened to you". This one
 * answers "what did the market do", because that is the question people arrive
 * with and refusing to answer it is not the same as being disciplined.
 */
export function MarketIndices() {
  const [data, setData] = useState<IndicesResponse | null>(null);

  useEffect(() => {
    let live = true;
    getIndices()
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, []);

  if (!data || data.indices.length === 0) return null;

  return (
    <div className="indices">
      <div className="indices-head">
        <span className="eyebrow">The market</span>
        {data.asOf && (
          <span className="faint">
            {data.state === "live" ? "Live" : "Last traded"}{" "}
            {new Date(data.asOf).toLocaleString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="indices-row">
        {data.indices.map((i) => {
          const direction = i.changePct == null ? "" : i.changePct >= 0 ? "up" : "down";
          return (
            <div className="index" key={i.symbol}>
              <span className="index-name">{i.name}</span>
              <span className="index-value mono">{value.format(i.value)}</span>
              {i.changePct == null ? (
                <span className="index-change faint">no change data</span>
              ) : (
                <span
                  className={`index-change mono ${direction}`}
                  title={
                    i.changeFrom === "exchange"
                      ? "Change from NSE, which publishes a previous close the price feed does not"
                      : undefined
                  }
                >
                  {i.changePct >= 0 ? "+" : "−"}
                  {Math.abs(i.changePct).toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
