/**
 * Turning scored symbols into a briefing.
 *
 * The budget is the point. A threshold alone gives either nothing or everything;
 * a fixed number of slots forces ranking, and makes "nothing qualified" a real
 * answer rather than a failure.
 */
import type { AlsoRan, BriefingCard } from "../../../shared/types.ts";
import type { Scored } from "./pipeline.ts";

export interface RankOptions {
  threshold: number;
  budget: number;
}

export interface Ranked {
  cards: BriefingCard[];
  alsoRan: AlsoRan[];
}

/** Below this many same-sector movers, a "sector move" claim is not credible. */
const MIN_CLUSTER = 3;

/** Members must be moving together, not merely in the same direction. */
const CLUSTER_SPREAD = 1.2;

export function rank(scored: Scored[], opts: RankOptions): Ranked {
  const usable = scored.filter((s) => !s.suppressed);

  const { clusters, singles } = findClusters(usable, opts.threshold);
  const candidates = [...clusters, ...singles.map(toCard)];

  candidates.sort((a, b) => b.score - a.score);

  const qualifying = candidates.filter(
    (c) => Math.abs(c.zScore) >= opts.threshold || c.kind !== "move",
  );

  const cards = qualifying.slice(0, opts.budget);
  const shown = new Set(
    cards.flatMap((c) => [c.symbol, ...(c.members ?? [])]),
  );

  // Everything else, ranked. A near-miss is far more informative than a count:
  // it shows the system looked at all of it and tells the user how close it came.
  const alsoRan: AlsoRan[] = usable
    .filter((s) => !shown.has(s.symbol))
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
    .map((s) => ({
      symbol: s.symbol,
      name: s.name,
      returnPct: s.returnPct,
      zScore: s.zScore,
    }));

  return { cards, alsoRan };
}

/**
 * Fold correlated movers into one card.
 *
 * Five IT stocks falling together is one fact, not five. Showing it five times
 * spends the whole attention budget on a single piece of information — and worse,
 * implies five separate things went wrong.
 */
function findClusters(
  scored: Scored[],
  threshold: number,
): { clusters: BriefingCard[]; singles: Scored[] } {
  const bySector = new Map<string, Scored[]>();
  for (const s of scored) {
    if (s.kind !== "move") continue;
    const list = bySector.get(s.sector) ?? [];
    list.push(s);
    bySector.set(s.sector, list);
  }

  const clusters: BriefingCard[] = [];
  const clustered = new Set<string>();

  for (const [sector, members] of bySector) {
    const movers = members.filter((m) => Math.abs(m.zScore) >= threshold * 0.6);
    if (movers.length < MIN_CLUSTER) continue;

    const first = movers[0]!;
    const sameDirection = movers.every(
      (m) => Math.sign(m.returnPct) === Math.sign(first.returnPct),
    );
    if (!sameDirection) continue;

    const zs = movers.map((m) => Math.abs(m.zScore));
    if (Math.max(...zs) - Math.min(...zs) > CLUSTER_SPREAD) continue;

    const avgReturn =
      movers.reduce((a, m) => a + m.returnPct, 0) / movers.length;
    const avgZ = movers.reduce((a, m) => a + m.zScore, 0) / movers.length;
    const strongest = movers.reduce((a, b) =>
      Math.abs(b.zScore) > Math.abs(a.zScore) ? b : a,
    );

    for (const m of movers) clustered.add(m.symbol);

    clusters.push({
      kind: "cluster",
      symbol: strongest.symbol,
      name: `${movers.length} ${sector} stocks`,
      sector,
      headline: `${movers.length} ${sector} stocks moved together — ${avgReturn >= 0 ? "up" : "down"} ${Math.abs(avgReturn).toFixed(1)}%`,
      reasons: [
        "Sector-wide, so none of them moved on their own.",
        `Average ${Math.abs(avgZ).toFixed(1)}σ across ${movers.length} holdings.`,
      ],
      returnPct: Math.round(avgReturn * 100) / 100,
      zScore: Math.round(avgZ * 100) / 100,
      score: Math.abs(avgZ) * 1.1,
      dataState: strongest.dataState,
      members: movers.map((m) => m.symbol),
    });
  }

  return {
    clusters,
    singles: scored.filter((s) => !clustered.has(s.symbol)),
  };
}

function toCard(s: Scored): BriefingCard {
  return {
    kind: s.kind,
    symbol: s.symbol,
    name: s.name,
    sector: s.sector,
    headline: s.headline,
    reasons: s.reasons,
    returnPct: s.returnPct,
    zScore: s.zScore,
    score: s.score,
    dataState: s.dataState,
    working: s.working,
  };
}
