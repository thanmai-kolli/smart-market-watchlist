import type { MarketSnapshot } from "../api.ts";
import { ProfileMenu } from "./ProfileMenu.tsx";

export function SiteNav({
  market,
  onIdentityChange,
}: {
  market: MarketSnapshot | null;
  onIdentityChange: () => void;
}) {
  const b = market?.benchmark;
  const direction = b == null ? "" : b.changePct >= 0 ? "up" : "down";

  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="brand" href="#top">
          <span className="brand-mark">M</span>
          <span className="brand-text">Meanwhile</span>
        </a>

        <nav className="nav-links">
          <a href="#app">Your list</a>
          <a href="#how">How it works</a>
          <a href="#engineering">Under the hood</a>
          <a href="#about">About</a>
        </nav>

        <div className="nav-right">
          <div className="market-strip" title={market?.asOf ?? undefined}>
            <span className={`pulse ${market?.open ? "open" : ""}`} />
            <span className="dim">{market?.label ?? "Checking\u2026"}</span>
            {b && (
              <>
                <span className="faint">·</span>
                <span className={`num ${direction}`}>
                  {b.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
                <span className={`num ${direction}`}>
                  {b.changePct >= 0 ? "+" : ""}
                  {b.changePct.toFixed(2)}%
                </span>
              </>
            )}
          </div>

          <ProfileMenu onIdentityChange={onIdentityChange} />
        </div>
      </div>
    </header>
  );
}
