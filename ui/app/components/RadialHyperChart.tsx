import React, { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// RadialHyperChart — 4-quadrant radial dimension explorer.
// Self-contained SVG component (originally from user-journey-app).
// ---------------------------------------------------------------------------

export type DimensionKey = "os" | "geo" | "browser" | "user_action";

export interface DimensionItem {
  label: string;
  displayLabel?: string;
  durationMs: number;
  count: number;
}

export interface DimensionData {
  key: DimensionKey;
  title: string;
  items: DimensionItem[];
}

export interface RadialHyperChartProps {
  dimensions: DimensionData[];
  appMedianMs: number;
  focusDim?: DimensionKey;
  onDimensionFocus?: (key: DimensionKey) => void;
  onSliceClick?: (dim: DimensionKey, item: DimensionItem) => void;
  size?: number;
  formatValue?: (value: number) => string;
  metricLabel?: string;
}

const DIM_BASE_HUE: Record<DimensionKey, number> = {
  os: 95,
  geo: 50,
  user_action: 220,
  browser: 30,
};

export const DIM_BASE_COLOR: Record<DimensionKey, string> = {
  os: "hsl(95, 55%, 45%)",
  geo: "hsl(45, 90%, 50%)",
  user_action: "hsl(220, 50%, 55%)",
  browser: "hsl(28, 85%, 50%)",
};

const formatDuration = (ms: number): string => {
  if (!isFinite(ms) || ms <= 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 1) return `${ms.toFixed(0)} ms`;
  return `${(ms * 1000).toFixed(0)} µs`;
};

const polar = (cx: number, cy: number, deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const annularSector = (
  cx: number, cy: number, rInner: number, rOuter: number,
  startDeg: number, endDeg: number,
): string => {
  const p1 = polar(cx, cy, startDeg, rOuter);
  const p2 = polar(cx, cy, endDeg, rOuter);
  const p3 = polar(cx, cy, endDeg, rInner);
  const p4 = polar(cx, cy, startDeg, rInner);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
};

const labelArcPath = (
  cx: number, cy: number, r: number,
  startDeg: number, endDeg: number, bottom: boolean,
): string => {
  if (!bottom) {
    const p1 = polar(cx, cy, startDeg, r);
    const p2 = polar(cx, cy, endDeg, r);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
  }
  const p1 = polar(cx, cy, endDeg, r);
  const p2 = polar(cx, cy, startDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${p2.y}`;
};

const colorFor = (hueBase: number, durationMs: number, refMedianMs: number): string => {
  const ref = refMedianMs > 0 ? refMedianMs : 1;
  const ratio = durationMs / ref;
  const t = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.log10(ratio + 0.01)));
  const hue = hueBase - 25 * t;
  const sat = 50 + 40 * t;
  const light = 65 - 25 * t;
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
};

interface QuadrantProps {
  cx: number; cy: number; rInner: number; rOuterMax: number;
  startDeg: number; endDeg: number;
  dim: DimensionData; appMedianMs: number;
  focused: boolean; dimmed: boolean; quadrantIndex: number;
  onHover: (h: { dimension: DimensionData; item: DimensionItem } | null) => void;
  onTitleClick: () => void;
  onSliceClick?: (dim: DimensionKey, item: DimensionItem) => void;
}

const Quadrant: React.FC<QuadrantProps> = ({
  cx, cy, rInner, rOuterMax, startDeg, endDeg, dim, appMedianMs,
  focused, dimmed, quadrantIndex, onHover, onTitleClick, onSliceClick,
}) => {
  const items = dim.items;
  const span = endDeg - startDeg;
  const gap = 1.0;
  const hueBase = DIM_BASE_HUE[dim.key];
  const midDeg = (startDeg + endDeg) / 2;
  const isBottom = midDeg > 90 && midDeg < 270;
  const labelRadius = isBottom ? rOuterMax + 24 : rOuterMax + 16;
  const arcD = labelArcPath(cx, cy, labelRadius, startDeg, endDeg, isBottom);
  const arcId = `arc-${dim.key}`;

  const backdrop = (
    <path
      d={annularSector(cx, cy, rInner, rOuterMax, startDeg, endDeg)}
      fill="rgba(128,128,128,0.08)"
      stroke="none"
      opacity={dimmed ? 0.55 : 1}
    />
  );

  const titleText = (
    <>
      <defs><path d={arcD} id={arcId} /></defs>
      <text
        fontSize={14}
        fontWeight={focused ? 700 : 600}
        fill={focused ? `hsl(${hueBase}, 70%, 55%)` : `hsl(${hueBase}, 50%, 65%)`}
        letterSpacing={1}
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={onTitleClick}
      >
        <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
          {dim.title}
        </textPath>
      </text>
    </>
  );

  if (items.length === 0) {
    return (
      <g style={{ opacity: dimmed ? 0.45 : 1 }}>
        {backdrop}
        {titleText}
      </g>
    );
  }

  const segSpan = (span - gap * (items.length - 1)) / items.length;
  const maxBarRange = rOuterMax - rInner;
  const positiveDurations = items.map((i) => i.durationMs).filter((v) => v > 0);
  const minDur = Math.max(1, Math.min(...positiveDurations));
  const maxDur = Math.max(minDur * 1.001, ...positiveDurations);
  const logMin = Math.log10(minDur);
  const logMax = Math.log10(maxDur);

  const lengthFor = (ms: number): number => {
    if (ms <= 0) return rInner + 4;
    const t = (Math.log10(ms) - logMin) / Math.max(0.0001, logMax - logMin);
    return rInner + Math.max(8, t * maxBarRange * 0.92 + maxBarRange * 0.08);
  };

  const refRadius = (() => {
    if (appMedianMs <= 0) return null;
    const t = (Math.log10(appMedianMs) - logMin) / Math.max(0.0001, logMax - logMin);
    if (!isFinite(t) || t < 0 || t > 1) return null;
    return rInner + t * maxBarRange;
  })();

  const quadDelay = quadrantIndex * 150;

  return (
    <g className="hyper-quadrant" style={{ opacity: dimmed ? 0.55 : 1, transition: "opacity 150ms", animationDelay: `${quadDelay}ms` }}>
      {backdrop}
      {refRadius !== null && (
        <path
          d={annularSector(cx, cy, refRadius - 0.5, refRadius + 0.5, startDeg, endDeg)}
          fill="rgba(128,128,128,0.65)"
          opacity={0.45}
        />
      )}
      {items.map((it, idx) => {
        const a0 = startDeg + idx * (segSpan + gap);
        const a1 = a0 + segSpan;
        const r = lengthFor(it.durationMs);
        const fill = colorFor(hueBase, it.durationMs, appMedianMs);
        return (
          <path
            key={`${dim.key}-${idx}-${it.label}`}
            d={annularSector(cx, cy, rInner, r, a0, a1)}
            fill={fill}
            stroke="rgba(128,128,128,0.2)"
            strokeWidth={0.75}
            style={{ cursor: "pointer", transition: "opacity 120ms" }}
            onMouseEnter={() => onHover({ dimension: dim, item: it })}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSliceClick && onSliceClick(dim.key, it)}
          >
            <title>{`${dim.title} — ${it.label}\n${formatDuration(it.durationMs)} (n=${it.count})`}</title>
          </path>
        );
      })}
      <g className="hyper-label" style={{ animationDelay: `${quadDelay + 300}ms` }}>
        {titleText}
      </g>
    </g>
  );
};

export const RadialHyperChart: React.FC<RadialHyperChartProps> = ({
  dimensions, appMedianMs, size = 720, focusDim, onDimensionFocus, onSliceClick, formatValue, metricLabel,
}) => {
  const fmt = formatValue ?? formatDuration;
  const [hovered, setHovered] = useState<{ dimension: DimensionData; item: DimensionItem } | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  const rOuterMax = size * 0.42;
  const rInner = size * 0.12;

  const layout: Record<DimensionKey, { start: number; end: number }> = {
    os: { start: 272, end: 358 },
    geo: { start: 2, end: 88 },
    user_action: { start: 92, end: 178 },
    browser: { start: 182, end: 268 },
  };

  const orderedDims = useMemo(() => {
    const order: DimensionKey[] = ["os", "geo", "user_action", "browser"];
    return order
      .map((k) => dimensions.find((d) => d.key === k))
      .filter((d): d is DimensionData => Boolean(d));
  }, [dimensions]);

  const animKey = useMemo(
    () => dimensions.map((d) => d.items.length).join("-") + "-" + appMedianMs.toFixed(0),
    [dimensions, appMedianMs],
  );

  return (
    <div style={{ position: "relative", width: size, height: size }} className="hyper-chart-enter" key={animKey}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Hyperlyzer radial chart">
        <circle cx={cx} cy={cy} r={rOuterMax + 1} fill="none" stroke="rgba(128,128,128,0.25)" strokeDasharray="2,3" />
        <circle className="hyper-center" cx={cx} cy={cy} r={rInner} fill="rgba(128,128,128,0.08)" stroke="rgba(128,128,128,0.25)" />
        {orderedDims.map((d, idx) => (
          <Quadrant
            key={d.key}
            cx={cx} cy={cy} rInner={rInner} rOuterMax={rOuterMax}
            startDeg={layout[d.key].start} endDeg={layout[d.key].end}
            dim={d} appMedianMs={appMedianMs}
            focused={focusDim === d.key}
            dimmed={focusDim !== undefined && focusDim !== d.key}
            quadrantIndex={idx}
            onHover={setHovered}
            onTitleClick={() => onDimensionFocus && onDimensionFocus(d.key)}
            onSliceClick={onSliceClick}
          />
        ))}
        <g className="hyper-center" style={{ animationDelay: "0.3s" }}>
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={22} fontWeight={500} fill="currentColor">{fmt(appMedianMs)}</text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>{metricLabel ?? "Application median"}</text>
        </g>
      </svg>
      {hovered && (
        <div style={{ position: "absolute", top: 12, left: 12, background: "rgba(30, 34, 56, 0.95)", color: "#eee", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 4, padding: "8px 12px", fontSize: 12, pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}>
          <div style={{ opacity: 0.65, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{hovered.dimension.title}</div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>{hovered.item.displayLabel ?? hovered.item.label}</div>
          <div style={{ marginTop: 2 }}>{fmt(hovered.item.durationMs)} <span style={{ opacity: 0.65 }}>· n={hovered.item.count.toLocaleString()}</span></div>
        </div>
      )}
    </div>
  );
};

export const formatActionDuration = formatDuration;
