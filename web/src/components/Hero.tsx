import { useEffect, useState } from "react";
import type { Showcase } from "../../../shared/types.ts";
import { getShowcase } from "../api.ts";
import { HeroChart } from "./HeroChart.tsx";

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ticker = (s: string) => s.replace(".NS", "");

/** The page uses a real minus sign everywhere, which toFixed does not produce. */
const signed = (pct: number) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;

export function Hero() {
  const [showcase, setShowcase] = useState<Showcase | null>(null);

  useEffect(() => {
    let live = true;
    getShowcase()
      .then((data) => live && setShowcase(data))
      .catch(() => live && setShowcase(null));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="hero" id="top">
      <div className="hero-inner">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Meanwhile</span>

            <h1>
              Your watchlist tells you about <em>today</em>.
              <br />
              It should tell you what you <em>missed</em>.
            </h1>

            <p className="lede">
              Every investing app measures from yesterday's close — an anchor
              that resets at 9:15 and that you never chose. Disappear for a week
              and it reports “+0.3% today”, saying nothing about the 11% fall
              you slept through.
            </p>

            <p className="lede">
              This one measures from{" "}
              <strong>the moment you last looked</strong>, against how much that
              stock normally moves, minus what the market did anyway — then
              shows you only what survives.
            </p>

            <div className="hero-cta">
              <a className="btn btn-primary" href="#app">
                See it working
              </a>
              <a className="btn" href="#how">
                How it decides
              </a>
            </div>
          </div>

          <HeroChart />
        </div>

        <Contrast showcase={showcase} />
      </div>
    </section>
  );
}

/**
 * Both columns describe the same real companies at the same real prices.
 *
 * Writing the numbers by hand would leave the pitch disagreeing with the live
 * panel further down the page the moment the market moved — on a product whose
 * whole claim is that it never shows a stale price as a current one.
 */
function Contrast({ showcase }: { showcase: Showcase | null }) {
  if (!showcase || showcase.quotes.length === 0) return null;

  const { quotes, standout } = showcase;
  const busiest = Math.max(...quotes.map((q) => Math.abs(q.changePct ?? 0)));

  return (
    <div className="hero-contrast">
      <div className="contrast-col">
        <div className="contrast-label">
          Every other watchlist <span className="faint">· today</span>
        </div>
        <div className="contrast-body mono">
          {quotes.map((q) => (
            <div className="contrast-row" key={q.symbol}>
              <span>{ticker(q.symbol)}</span>
              <span>
                {money.format(q.price)}
                {q.changePct == null ? null : (
                  <span className={q.changePct >= 0 ? "up" : "down"}>
                    &nbsp;&nbsp;{signed(q.changePct)}
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className="faint contrast-note">
            {busiest < 1.5
              ? "A quiet day, so nothing looks wrong. You do the thinking."
              : "Every number measured from yesterday's close. You do the thinking."}
          </div>
        </div>
      </div>

      <div className="contrast-col accent">
        <div className="contrast-label">
          This one <span className="faint">· since you last looked</span>
        </div>
        <div className="contrast-body">
          {standout ? (
            <>
              <div className="mini-card">
                <div className="mini-head">
                  <strong>{ticker(standout.symbol)}</strong>
                  <span
                    className={`${standout.returnPct >= 0 ? "up" : "down"} mono`}
                  >
                    {signed(standout.returnPct)} · {Math.abs(standout.zScore).toFixed(1)}σ
                  </span>
                </div>
                {standout.reasons.slice(0, 2).map((reason) => (
                  <div className="mini-reason" key={reason}>
                    {reason}
                  </div>
                ))}
              </div>
              <div className="faint contrast-note">
                The same {ticker(standout.symbol)}.{" "}
                {standout.todayPct == null || Math.abs(standout.todayPct) < 0.5
                  ? "Flat today"
                  : `${signed(standout.todayPct)} today`}
                , {standout.returnPct >= 0 ? "up" : "down"}{" "}
                {Math.abs(standout.returnPct).toFixed(1)}% over the last{" "}
                {standout.days} days.
              </div>
            </>
          ) : (
            <div className="faint contrast-note">
              Nothing has crossed the bar across any window we looked at. This one
              says so and stops, rather than filling the space with numbers you
              did not ask for.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
