import { useEffect, useMemo, useState } from "react";
import type {
  Briefing,
  Intent,
  WatchlistEntry,
  WatchlistSummary,
} from "../../shared/types.ts";
import {
  acknowledge,
  addSymbol,
  createList,
  deleteList,
  getBriefing,
  getMarket,
  getWatchlist,
  removeSymbol,
  renameList,
  setIntent,
  type MarketSnapshot,
} from "./api.ts";
import { BriefingPanel } from "./BriefingPanel.tsx";
import { About } from "./components/About.tsx";
import {
  AnchorControl,
  DEFAULT_ANCHOR,
  type AnchorOption,
} from "./components/AnchorControl.tsx";
import { Decisions } from "./components/Decisions.tsx";
import { Hero } from "./components/Hero.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { ListBar } from "./components/ListBar.tsx";
import { MarketIndices } from "./components/MarketIndices.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { SiteNav } from "./components/SiteNav.tsx";
import { SymbolRow } from "./components/SymbolRow.tsx";
import { SymbolSearch } from "./components/SymbolSearch.tsx";

export function App() {
  const [items, setItems] = useState<WatchlistEntry[] | null>(null);
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [activeList, setActiveList] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [anchorOption, setAnchorOption] = useState<AnchorOption>(DEFAULT_ANCHOR);
  const [error, setError] = useState<string | null>(null);

  /**
   * Every write goes through here on the way to failing.
   *
   * A refused write used to resolve to nothing at all: the button did nothing,
   * said nothing, and left the person to guess. That is the one failure mode
   * this product should not have.
   */
  function report(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  function loadBriefing(option: AnchorOption) {
    const at =
      option.days == null ? undefined : Date.now() - option.days * 86_400_000;
    getBriefing(at).then(setBriefing).catch(() => setBriefing(null));
  }

  /** Every list mutation returns the whole view, so one handler absorbs them all. */
  function apply(w: {
    items: WatchlistEntry[];
    lists: WatchlistSummary[];
    activeListId: string | null;
  }) {
    setItems(w.items);
    setLists(w.lists);
    setActiveList(w.activeListId);
    loadBriefing(anchorOption);
  }

  function refresh(list: string | null = activeList) {
    getWatchlist(list)
      .then((w) => {
        setItems(w.items);
        setLists(w.lists);
        setActiveList(w.activeListId);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    loadBriefing(anchorOption);
  }

  useEffect(() => {
    // Loaded independently: the market strip depends on NSE, an optional source
    // that can be slow or blocked, and it must never hold up the watchlist.
    refresh(null);
    getMarket().then(setMarket).catch(() => setMarket(null));
  }, []);

  const owned = useMemo(
    () =>
      new Set(
        (items ?? [])
          .filter((i) => activeList == null || i.listId === activeList)
          .map((i) => i.symbol),
      ),
    [items, activeList],
  );

  const anchor = useMemo(() => {
    if (!items || items.length === 0) return null;
    return Math.min(...items.map((i) => i.lastSeenAt));
  }, [items]);

  return (
    <>
      <SiteNav market={market} onIdentityChange={() => refresh(null)} />
      <Hero />

      <section className="section" id="app">
        <div className="section-inner">
          <MarketIndices />

          <div className="section-head">
            <span className="eyebrow">Your watchlist</span>
            <h2>Live, and it remembers you</h2>
            <p className="section-lede">
              No signup. Add what you care about, close the tab, come back
              whenever — it will know how long you were gone.
            </p>
          </div>

          <div className="layout">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">Since you last checked</div>
                  <div className="panel-sub">
                    {briefing?.widenedFrom
                      ? `Nothing since your visit ${briefing.widenedFrom.days} days ago — reaching back ${Math.round(
                          (Date.now() - briefing.anchorAt) / 86_400_000,
                        )} days instead`
                      : (briefing?.anchorLabel ??
                        (anchor ? formatAnchor(anchor) : "—"))}
                  </div>
                </div>
                <AnchorControl
                  value={anchorOption}
                  onChange={(option) => {
                    setAnchorOption(option);
                    setBriefing(null);
                    loadBriefing(option);
                  }}
                />
              </div>

              <BriefingPanel
                briefing={briefing}
                onAck={(symbols) => {
                  Promise.all(symbols.map(acknowledge))
                    .then(() => refresh())
                    .catch(report);
                }}
              />
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">Tracking</div>
                  <div className="panel-sub">
                    {items
                      ? `${items.length} ${items.length === 1 ? "stock" : "stocks"}${
                          activeList == null && lists.length > 1
                            ? ` across ${lists.length} lists`
                            : ""
                        }`
                      : "Loading…"}
                  </div>
                </div>
              </div>

              <ListBar
                lists={lists}
                activeId={activeList}
                onSelect={(id) => {
                  setActiveList(id);
                  refresh(id);
                }}
                onCreate={(name) => {
                  createList(name).then(apply).catch(report);
                }}
                onRename={(id, name) => {
                  renameList(id, name).then(apply).catch(report);
                }}
                onDelete={(id) => {
                  deleteList(id).then(apply).catch(report);
                }}
              />

              <SymbolSearch
                existing={owned}
                onAdd={(symbol) => {
                  addSymbol(symbol, activeList)
                    .then((w) => {
                      setItems(w.items);
                      setLists(w.lists);
                      loadBriefing(anchorOption);
                    })
                    .catch(report);
                }}
              />

              {error && <p className="notice">{error}</p>}
              {!error && !items && <LoadingRows />}
              {items?.length === 0 && (
                <div className="placeholder">
                  <div className="placeholder-icon">◇</div>
                  <h4>Nothing in this list yet</h4>
                  <p>Search above to add your first stock.</p>
                </div>
              )}
              {items != null && items.length > 0 && (
                <div className="list-legend">
                  Change is measured from the previous close — the ordinary kind.
                  The briefing on the left measures from your last visit.
                </div>
              )}
              {items?.map((item) => (
                <SymbolRow
                  key={`${item.listId}:${item.symbol}`}
                  item={item}
                  showList={activeList == null && lists.length > 1}
                  onRemove={(symbol, listId) => {
                    removeSymbol(symbol, listId)
                      .then((w) => {
                        setItems(w.items);
                        setLists(w.lists);
                        loadBriefing(anchorOption);
                      })
                      .catch(report);
                  }}
                  onIntent={(symbol, listId, intent) => {
                    setIntent(symbol, listId, intent)
                      .then((w) => {
                        setItems(w.items);
                        setLists(w.lists);
                        loadBriefing(anchorOption);
                      })
                      .catch(report);
                  }}
                />
              ))}
            </div>
          </div>

          <Provenance market={market} />
        </div>
      </section>

      <HowItWorks />
      <Decisions />
      <About />
      <SiteFooter />
    </>
  );
}

function formatAnchor(ts: number): string {
  const days = Math.round((Date.now() - ts) / 86_400_000);
  const when = new Date(ts).toLocaleString("en-IN", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return days <= 0 ? when : `${days} days ago · ${when}`;
}

/**
 * Where the numbers came from, and what happens when the two sources disagree.
 *
 * Most apps present a single figure as fact. Showing that two sources were
 * consulted, whether they matched, and which one wins if they don't, is the
 * difference between a number and a number you can trust.
 */
function Provenance({ market }: { market: MarketSnapshot | null }) {
  if (!market) return null;
  const c = market.crossCheck;

  return (
    <div className="provenance">
      <div className="prov-item">
        <span className="prov-label">Prices</span>
        <span>Delayed public feed, labelled per symbol</span>
      </div>
      <div className="prov-item">
        <span className="prov-label">Corporate actions</span>
        <span>NSE, the exchange itself</span>
      </div>
      <div className="prov-item">
        <span className="prov-label">Benchmark cross-check</span>
        {c.status === "agree" && (
          <span className="prov-ok">
            ✓ {c.sources} sources agree on NIFTY (
            {c.exchange?.toLocaleString("en-IN")})
          </span>
        )}
        {c.status === "diverged" && (
          <span className="prov-warn">
            ⚠ Sources differ by {c.diffPct}% — feed{" "}
            {c.feed?.toLocaleString("en-IN")}, exchange{" "}
            {c.exchange?.toLocaleString("en-IN")}. Exchange wins.
          </span>
        )}
        {c.status === "unavailable" && (
          <span className="faint">Only one source reachable right now</span>
        )}
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div className="row" key={i}>
          <div className="skeleton" style={{ width: "34%" }} />
          <div className="skeleton" style={{ width: 78, justifySelf: "end" }} />
          <div className="skeleton" style={{ width: "56%", height: 9 }} />
          <div
            className="skeleton"
            style={{ width: 46, height: 9, justifySelf: "end" }}
          />
        </div>
      ))}
    </>
  );
}
