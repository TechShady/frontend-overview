import React, { useState } from "react";

// ---------------------------------------------------------------------------
// KPI Card with sparkline + comparison arrow — adapted from user-journey-app.
// Minimal, self-contained; no context dependency.
// ---------------------------------------------------------------------------

export type KpiCardProps = {
  label: string;
  value: string;
  rawValue?: number;
  prevRawValue?: number | null;
  sparkline?: number[];
  color?: string;
  suffix?: string;
  higherIsBetter?: boolean; // default false (e.g. errors, latency)
  subtext?: string;
  loading?: boolean;
};

function KpiSparkline({ data, color = "#4589FF" }: { data: number[]; color?: string }) {
  const VW = 200, H = 30;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const valid = data.filter((v) => v != null && isFinite(v));
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const points = valid.map((v, i) => ({
    x: (i / (valid.length - 1)) * VW,
    y: H - ((v - min) / range) * (H - 4) - 2,
    value: v,
  }));
  const pts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fillPts = `0,${H} ${pts} ${VW},${H}`;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VW;
    const idx = Math.round((x / VW) * (valid.length - 1));
    setHoverIdx(Math.max(0, Math.min(valid.length - 1, idx)));
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${VW} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: H, marginTop: 4, opacity: 0.9, cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <polygon points={fillPts} fill={color} fillOpacity={0.12} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2.5} fill={color} />
        {hoverIdx !== null && points[hoverIdx] && (
          <>
            <line x1={points[hoverIdx].x} y1={0} x2={points[hoverIdx].x} y2={H} stroke={color} strokeWidth={0.75} strokeDasharray="2,2" opacity={0.6} />
            <circle cx={points[hoverIdx].x} cy={points[hoverIdx].y} r={3} fill={color} stroke="#fff" strokeWidth={1} />
          </>
        )}
      </svg>
      {hoverIdx !== null && points[hoverIdx] && (
        <div style={{ position: "absolute", bottom: H + 4, left: `${(points[hoverIdx].x / VW) * 100}%`, transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {points[hoverIdx].value >= 1000 ? `${(points[hoverIdx].value / 1000).toFixed(1)}k` : points[hoverIdx].value.toFixed(points[hoverIdx].value % 1 === 0 ? 0 : 1)}
        </div>
      )}
    </div>
  );
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label, value, rawValue, prevRawValue, sparkline, color = "#4589FF",
  suffix, higherIsBetter = false, subtext, loading,
}) => {
  // Delta calc
  let delta: number | null = null;
  if (rawValue != null && prevRawValue != null) {
    if (prevRawValue === 0) delta = rawValue === 0 ? 0 : 100;
    else delta = ((rawValue - prevRawValue) / Math.abs(prevRawValue)) * 100;
  }

  const isPositive = delta != null && delta > 0;
  const isNegative = delta != null && delta < 0;
  const isFlat = delta != null && Math.abs(delta) < 0.1;
  const good = higherIsBetter ? isPositive : isNegative;
  const bad = higherIsBetter ? isNegative : isPositive;
  const arrowColor = isFlat ? "rgba(128,128,128,0.6)" : good ? "#0D9C29" : bad ? "#C21930" : "rgba(128,128,128,0.6)";

  return (
    <div
      style={{
        flex: "1 1 180px",
        minWidth: 180,
        padding: "14px 16px",
        background: "rgba(128,128,128,0.06)",
        border: `1px solid ${color}30`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(128,128,128,0.9)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: color }}>{loading ? "…" : value}</div>
        {suffix && <div style={{ fontSize: 12, opacity: 0.7 }}>{suffix}</div>}
        {delta != null && (
          <div style={{ fontSize: 11, fontWeight: 600, color: arrowColor, marginLeft: "auto" }}>
            {isFlat ? "—" : good ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      {subtext && <div style={{ fontSize: 10, opacity: 0.6 }}>{subtext}</div>}
      {sparkline && sparkline.length >= 2 && <KpiSparkline data={sparkline} color={color} />}
    </div>
  );
};
