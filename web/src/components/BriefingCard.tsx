import { useState } from "react";
import type { BriefingCard as Card } from "../../../shared/types.ts";
import { StateChip } from "./StateChip.tsx";

const KIND_LABEL: Record<Card["kind"], string> = {
  move: "Unusual move",
  cluster: "Sector-wide",
  corporate_action: "Corporate action",
  halt: "Trading halted",
  level: "52-week level",
};

export function BriefingCard({
  card,
  onAck,
}: {
  card: Card;
  onAck: (symbols: string[]) => void;
}) {
  const [showWorking, setShowWorking] = useState(false);
  const direction = card.returnPct >= 0 ? "up" : "down";

  return (
    <article className={`card kind-${card.kind}`}>
      <div className="card-top">
        <span className="card-kind">{KIND_LABEL[card.kind]}</span>
        {card.lists?.map((l) => (
          <span className="card-list" key={l}>
            {l}
          </span>
        ))}
        {card.intent === "buy" && <span className="card-intent">watching to buy</span>}
        {card.intent === "hold" && <span className="card-intent">holding</span>}
        <StateChip state={card.dataState} />
        <span className={`card-sigma num ${direction}`}>
          {Math.abs(card.zScore).toFixed(1)}σ
        </span>
      </div>

      <h4 className="card-headline">{card.headline}</h4>

      {card.members && card.members.length > 0 && (
        // Without this a cluster says "three stocks moved" and never says which,
        // which is the one thing a person needs to act on it.
        <p className="card-members mono">
          {card.members.map((m) => m.replace(".NS", "")).join(" · ")}
        </p>
      )}

      {card.working && <Measure w={card.working} />}

      <ul className="card-reasons">
        {card.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      {/* A visual anchor for sigma: most people have no feel for what 2.8 means. */}
      {card.kind !== "corporate_action" && (
        <SigmaBar z={card.zScore} />
      )}

      <div className="card-actions">
        {/* A cluster covers several symbols, and dismissing it has to clear all
            of them or the ones left behind come back on their own. */}
        <button
          className="card-btn"
          onClick={() => onAck([...new Set([card.symbol, ...(card.members ?? [])])])}
        >
          Got it
        </button>
        {card.working && (
          <button
            className="card-btn ghost"
            onClick={() => setShowWorking((v) => !v)}
            aria-expanded={showWorking}
          >
            {showWorking ? "Hide working" : "Why?"}
          </button>
        )}
      </div>

      {showWorking && card.working && <Working w={card.working} />}
    </article>
  );
}

/**
 * The line that makes the verdict legible.
 *
 * A percentage alone invites the wrong reaction — 18% sounds alarming until you
 * know that over the same stretch this stock swings ±13.7% as a matter of course.
 */
function Measure({ w }: { w: NonNullable<Card["working"]> }) {
  const days = w.tradingDaysElapsed;

  return (
    <p className="card-measure">
      <strong className={`num ${w.returnPct >= 0 ? "up" : "down"}`}>
        {w.returnPct >= 0 ? "+" : ""}
        {w.returnPct.toFixed(1)}%
      </strong>
      <span>
        {" "}
        over {days} trading day{days === 1 ? "" : "s"} — a swing of ±
        {w.expectedOneSigmaPct.toFixed(1)}% would have been ordinary.
      </span>
    </p>
  );
}

/** Where this move sits against the stock's normal range, clamped at ±4σ. */
function SigmaBar({ z }: { z: number }) {
  const clamped = Math.max(-4, Math.min(4, z));
  const pos = ((clamped + 4) / 8) * 100;

  return (
    <div className="sigma-bar" aria-hidden="true">
      <div className="sigma-track">
        <div className="sigma-normal" />
        <div
          className={`sigma-dot ${z >= 0 ? "up" : "down"}`}
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="sigma-legend">
        <span>−4σ</span>
        <span className="faint">normal range</span>
        <span>+4σ</span>
      </div>
    </div>
  );
}

/**
 * The arithmetic, shown on demand.
 *
 * "How do you know it's 2.8 sigma?" is the obvious question, and showing the
 * working answers it better than any explanation could.
 */
function Working({ w }: { w: NonNullable<Card["working"]> }) {
  const rows: Array<[string, string]> = [
    ["price then", `₹${w.priceThen.toFixed(2)}`],
    ["price now", `₹${w.priceNow.toFixed(2)}`],
    ["return", `${w.returnPct.toFixed(2)}%`],
    ["NIFTY moved", `${w.marketReturnPct.toFixed(2)}%`],
    ["beta", w.beta.toFixed(2)],
    ["market explains", `${w.marketExplainsPct.toFixed(2)}%`],
    ["stock-specific", `${w.idiosyncraticPct.toFixed(2)}%`],
    ["daily volatility", `${w.dailySigmaPct.toFixed(2)}%`],
    ["trading days", w.tradingDaysElapsed.toFixed(1)],
    ["expected 1σ move", `${w.expectedOneSigmaPct.toFixed(2)}%`],
    ["relative volume", w.relativeVolume == null ? "—" : `${w.relativeVolume.toFixed(1)}×`],
  ];

  return (
    <div className="working">
      {rows.map(([label, value]) => (
        <div className="working-row" key={label}>
          <span>{label}</span>
          <span className="num">{value}</span>
        </div>
      ))}
      <div className="working-row total">
        <span>z-score</span>
        <span className="num">{w.zScore.toFixed(2)}σ</span>
      </div>
    </div>
  );
}
