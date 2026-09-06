/**
 * The hero visual, and an argument rather than decoration: a price line with a
 * marker where the user last looked, everything before it faded and everything
 * after it lit. That gap is the entire product.
 *
 * It carries no figures. The shape is exaggerated to be legible at a glance, so
 * any percentage printed on it would be invented — and inventing one directly
 * above a panel of measured numbers is the habit this product argues against.
 */

// Hand-picked rather than random so the shape stays stable across renders and
// tells the same story every time: quiet drift, then a break after the marker.
const SERIES = [
  62, 60, 63, 61, 58, 60, 57, 59, 56, 58, 55, 57, 54, 56, 53,
  55, 52, 54, 51, 49, 46, 44, 40, 37, 33, 30, 26, 23, 20, 18,
];

const W = 560;
const H = 300;
const PAD = { top: 28, right: 24, bottom: 34, left: 20 };
const SPLIT = 15; // where "last looked" sits

export function HeroChart() {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (SERIES.length - 1)) * innerW;
  const y = (v: number) => PAD.top + ((70 - v) / 60) * innerH;

  const line = (from: number, to: number) =>
    SERIES.slice(from, to + 1)
      .map((v, k) => `${k === 0 ? "M" : "L"} ${x(from + k).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");

  const before = line(0, SPLIT);
  const after = line(SPLIT, SERIES.length - 1);
  const splitX = x(SPLIT);
  const lastX = x(SERIES.length - 1);
  const lastY = y(SERIES[SERIES.length - 1]!);

  return (
    <div className="hero-chart" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} role="presentation">
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--down)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--down)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            className="grid"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + (i * innerH) / 3}
            y2={PAD.top + (i * innerH) / 3}
          />
        ))}

        <path
          className="area"
          d={`${after} L ${lastX} ${PAD.top + innerH} L ${splitX} ${PAD.top + innerH} Z`}
          fill="url(#fade)"
        />

        <path className="line-before" d={before} />
        <path className="line-after" d={after} />

        <line
          className="marker"
          x1={splitX}
          x2={splitX}
          y1={PAD.top - 6}
          y2={PAD.top + innerH}
        />
        <circle className="marker-dot" cx={splitX} cy={y(SERIES[SPLIT]!)} r="4" />
        <text className="marker-label" x={splitX + 9} y={PAD.top + 4}>
          you last looked
        </text>

        <circle className="live-dot" cx={lastX} cy={lastY} r="4.5" />
        <circle className="live-halo" cx={lastX} cy={lastY} r="4.5" />
      </svg>
    </div>
  );
}
