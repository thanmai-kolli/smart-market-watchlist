import type { Briefing } from "../../shared/types.ts";
import { BriefingCard } from "./components/BriefingCard.tsx";

export function BriefingPanel({
  briefing,
  onAck,
}: {
  briefing: Briefing | null;
  onAck: (symbols: string[]) => void;
}) {
  if (!briefing) {
    return (
      <div className="placeholder">
        <div className="skeleton" style={{ width: "60%", margin: "0 auto" }} />
      </div>
    );
  }

  const { cards, alsoRan, listTally } = briefing;
  const quiet = (listTally ?? []).filter((l) => l.cards === 0 && l.checked > 0);
  const blind = briefing.symbolsTotal > 0 && briefing.symbolsChecked === 0;
  const partial =
    briefing.symbolsChecked > 0 && briefing.symbolsChecked < briefing.symbolsTotal;

  return (
    <>
      {partial && (
        <div className="widened">
          {briefing.symbolsTotal - briefing.symbolsChecked} of{" "}
          {briefing.symbolsTotal} could not be priced, so this briefing is
          incomplete.
        </div>
      )}

      {blind ? (
        <Blind briefing={briefing} />
      ) : cards.length === 0 ? (
        <Quiet briefing={briefing} />
      ) : (
        <div className="cards">
          {cards.map((c) => (
            <BriefingCard key={c.symbol + c.kind} card={c} onAck={onAck} />
          ))}
        </div>
      )}

      {quiet.length > 0 && cards.length > 0 && (
        <p className="list-tally">
          Nothing in {quiet.map((l) => l.name).join(", ")} — the budget of three
          is spent across every list, not per list.
        </p>
      )}

      {alsoRan.length > 0 && (
        // With no cards this list is the entire answer, so it opens itself.
        // Collapsed, a quiet day looks like an empty screen rather than a
        // finding, which is the one reading the quiet state has to survive.
        <details className="also-ran" open={cards.length === 0}>
          <summary>
            {alsoRan.length} other{alsoRan.length === 1 ? "" : "s"} — closest was{" "}
            <strong>{alsoRan[0]!.symbol.replace(".NS", "")}</strong> at{" "}
            {Math.abs(alsoRan[0]!.zScore).toFixed(1)}σ
          </summary>
          <div className="also-list">
            {alsoRan.map((a) => (
              <div className="also-row" key={a.symbol}>
                <span>{a.symbol.replace(".NS", "")}</span>
                <span className={`num ${a.returnPct >= 0 ? "up" : "down"}`}>
                  {a.returnPct >= 0 ? "+" : ""}
                  {a.returnPct.toFixed(2)}%
                </span>
                <span className="num faint">
                  {Math.abs(a.zScore).toFixed(1)}σ
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/**
 * The quiet state, with its evidence.
 *
 * A blank screen reads as broken. Showing what was checked, what came closest
 * and what the bar was makes "nothing happened" a finding rather than a failure.
 */
function Quiet({ briefing }: { briefing: Briefing }) {
  const closest = briefing.alsoRan[0];
  // z is the move divided by the ordinary swing, so the swing comes back out of
  // the ratio -- no extra field needed on the response.
  const band =
    closest && Math.abs(closest.zScore) > 0.05
      ? Math.abs(closest.returnPct / closest.zScore)
      : null;

  return (
    <div className="quiet">
      <div className="quiet-mark">✓</div>
      <h4>Nothing needs you</h4>
      <p>
        Checked {briefing.symbolsChecked} stock
        {briefing.symbolsChecked === 1 ? "" : "s"} since {briefing.anchorLabel}.
      </p>
      {closest && (
        <p className="faint">
          The largest was {closest.symbol.replace(".NS", "")} at{" "}
          {closest.returnPct >= 0 ? "+" : ""}
          {closest.returnPct.toFixed(1)}%
          {band != null && (
            <> — but ±{band.toFixed(1)}% is an ordinary swing for it over this
              stretch</>
          )}
          . Nothing reached {briefing.threshold}σ.
        </p>
      )}
    </div>
  );
}

/**
 * What to show when the price feed could not answer.
 *
 * The failure mode this exists to prevent is the worst one available: with no
 * prices, nothing clears the threshold, and the quiet state would announce
 * "nothing needs you" — a confident all-clear from an app that cannot see. An
 * upstream outage must never be reported as calm markets.
 */
function Blind({ briefing }: { briefing: Briefing }) {
  return (
    <div className="quiet blind">
      <div className="quiet-mark">?</div>
      <h4>Can't tell you right now</h4>
      <p>
        The price feed isn't answering, so {briefing.symbolsTotal} stock
        {briefing.symbolsTotal === 1 ? "" : "s"} went unchecked. This is not the
        same as nothing having happened — it means we could not look.
      </p>
      <p className="faint">
        Your lists are safe and the reference point has not moved, so nothing
        will be skipped once the feed returns.
      </p>
    </div>
  );
}
