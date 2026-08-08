import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// KPI Card with sparkline, comparison arrow, and click-to-forecast modal.
// Ported / expanded from the user-journey-app KPI treatment.
// ---------------------------------------------------------------------------

export type RelatedMetric = { label: string; value: string; color?: string };

export type KpiCardProps = {
  label: string;
  value: string;
  rawValue?: number;
  prevRawValue?: number | null;
  sparkline?: number[];
  color?: string;
  suffix?: string;
  higherIsBetter?: boolean;
  subtext?: string;
  loading?: boolean;
  format?: (n: number) => string;
  unit?: string;
  related?: RelatedMetric[];
  description?: string;
};

// -- Sparkline component ----------------------------------------------------
function KpiSparkline({ data, color = "#4589FF", height = 30, format }: { data: number[]; color?: string; height?: number; format?: (n: number) => string }) {
  const VW = 200, H = height;
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
  const fmt = format ?? ((n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n % 1 === 0 ? 0 : 1)));

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
          {fmt(points[hoverIdx].value)}
        </div>
      )}
    </div>
  );
}

// -- Forecast: linear regression on sparkline -------------------------------
function linearForecast(data: number[], stepsAhead: number): number[] {
  const valid = data.filter((v) => v != null && isFinite(v));
  if (valid.length < 2) return [];
  const n = valid.length;
  const xMean = (n - 1) / 2;
  const yMean = valid.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (valid[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const out: number[] = [];
  for (let i = 0; i < stepsAhead; i++) out.push(Math.max(0, intercept + slope * (n + i)));
  return out;
}

// -- Detail modal ------------------------------------------------------------
function KpiDetailModal({
  show, onClose, label, value, color, sparkline, prevRawValue, rawValue,
  delta, higherIsBetter, related, description, format, unit,
}: {
  show: boolean; onClose: () => void; label: string; value: string; color: string;
  sparkline?: number[]; prevRawValue?: number | null; rawValue?: number;
  delta: number | null; higherIsBetter: boolean; related?: RelatedMetric[]; description?: string;
  format?: (n: number) => string; unit?: string;
}) {
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, onClose]);

  if (!show) return null;
  const spark = sparkline ?? [];
  const forecast = linearForecast(spark, Math.max(3, Math.floor(spark.length * 0.3)));
  const fmt = format ?? ((n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(2)));
  const trendLabel = forecast.length > 0 && spark.length > 0
    ? forecast[forecast.length - 1] > spark[spark.length - 1] ? "rising" : forecast[forecast.length - 1] < spark[spark.length - 1] ? "falling" : "flat"
    : "unknown";
  const trendPct = forecast.length > 0 && spark.length > 0 && spark[spark.length - 1] !== 0
    ? ((forecast[forecast.length - 1] - spark[spark.length - 1]) / Math.abs(spark[spark.length - 1])) * 100
    : 0;
  const trendGood = higherIsBetter ? trendPct > 0 : trendPct < 0;
  const trendColor = trendLabel === "flat" ? "rgba(128,128,128,0.7)" : trendGood ? "#0D9C29" : "#C21930";

  const overlay = (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 660, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto",
          background: "rgba(24, 26, 40, 0.98)",
          border: `1px solid ${color}55`,
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          padding: 24, color: "#e9ecf5",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.65, letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 36, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
            {delta != null && (
              <div style={{ fontSize: 13, marginTop: 4, color: (higherIsBetter ? delta > 0 : delta < 0) ? "#0D9C29" : Math.abs(delta) < 0.1 ? "rgba(128,128,128,0.7)" : "#C21930" }}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}% vs previous period
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#e9ecf5", fontSize: 22, cursor: "pointer", opacity: 0.7 }}>×</button>
        </div>

        {description && (
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>{description}</div>
        )}

        {/* Sparkline + forecast */}
        {spark.length >= 2 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", opacity: 0.65, letterSpacing: 0.5, marginBottom: 6 }}>
              History & Forecast
              <span style={{ marginLeft: 10, fontWeight: 500, opacity: 0.9, color: trendColor, textTransform: "none", letterSpacing: 0 }}>
                → projected {trendLabel} {trendPct !== 0 && `(${trendPct > 0 ? "+" : ""}${trendPct.toFixed(1)}%)`}
              </span>
            </div>
            <ForecastChart history={spark} forecast={forecast} color={color} format={fmt} unit={unit} />
            <div style={{ display: "flex", gap: 14, fontSize: 10, opacity: 0.65, marginTop: 4 }}>
              <span><span style={{ display: "inline-block", width: 14, height: 2, background: color, verticalAlign: "middle", marginRight: 4 }} /> history ({spark.length} buckets)</span>
              <span>
                <span style={{ display: "inline-block", width: 14, height: 0, borderTop: `2px dashed ${color}`, verticalAlign: "middle", marginRight: 4 }} />
                forecast ({forecast.length} buckets)
              </span>
            </div>
          </div>
        )}

        {related && related.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", opacity: 0.65, letterSpacing: 0.5, marginBottom: 8 }}>Related Metrics</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {related.map((m, i) => (
                <div key={i} style={{ padding: "10px 12px", background: "rgba(128,128,128,0.08)", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.6, letterSpacing: 0.4 }}>{m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: m.color ?? "#e9ecf5", marginTop: 2 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {prevRawValue != null && rawValue != null && (
          <div style={{ marginTop: 22, padding: "12px 14px", background: "rgba(128,128,128,0.08)", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, display: "flex", gap: 24, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.6 }}>Previous period</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{fmt(prevRawValue)}{unit ?? ""}</div>
            </div>
            <div style={{ opacity: 0.35, fontSize: 22, alignSelf: "center" }}>→</div>
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.6 }}>Current</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color }}>{fmt(rawValue)}{unit ?? ""}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function ForecastChart({ history, forecast, color, format, unit }: { history: number[]; forecast: number[]; color: string; format: (n: number) => string; unit?: string }) {
  const W = 600, H = 180;
  const all = [...history, ...forecast].filter((v) => v != null && isFinite(v));
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const n = history.length + forecast.length;
  const toPt = (v: number, i: number) => ({
    x: (i / (n - 1)) * W,
    y: H - ((v - min) / range) * (H - 24) - 12,
    value: v,
  });
  const hist = history.map((v, i) => toPt(v, i));
  const fore = forecast.map((v, i) => toPt(v, history.length + i));
  const histPts = hist.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const forePts = fore.length > 0 ? [hist[hist.length - 1], ...fore].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
  const fillPts = `0,${H} ${histPts} ${hist[hist.length - 1]?.x ?? 0},${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, background: "rgba(128,128,128,0.04)", borderRadius: 6 }}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(128,128,128,0.15)" strokeWidth="0.5" />
      ))}
      <polygon points={fillPts} fill={color} fillOpacity={0.12} />
      <polyline points={histPts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {fore.length > 0 && (
        <>
          <polyline points={forePts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="6,4" opacity={0.75} />
          <circle cx={fore[fore.length - 1].x} cy={fore[fore.length - 1].y} r={4} fill={color} />
          <text x={fore[fore.length - 1].x - 6} y={fore[fore.length - 1].y - 8} fill={color} fontSize="11" fontWeight="700" textAnchor="end">
            {format(fore[fore.length - 1].value)}{unit ?? ""}
          </text>
        </>
      )}
      <circle cx={hist[hist.length - 1].x} cy={hist[hist.length - 1].y} r={3} fill={color} />
      <line x1={hist[hist.length - 1].x} x2={hist[hist.length - 1].x} y1="0" y2={H} stroke="rgba(128,128,128,0.4)" strokeDasharray="3,3" strokeWidth="0.5" />
      <text x={hist[hist.length - 1].x + 4} y={12} fill="rgba(128,128,128,0.65)" fontSize="9" fontWeight="600">now</text>
    </svg>
  );
}

// -- Card component ---------------------------------------------------------
export const KpiCard: React.FC<KpiCardProps> = ({
  label, value, rawValue, prevRawValue, sparkline, color = "#4589FF",
  suffix, higherIsBetter = false, subtext, loading, format, unit, related, description,
}) => {
  const [detailOpen, setDetailOpen] = useState(false);

  const delta = useMemo(() => {
    if (rawValue == null || prevRawValue == null) return null;
    if (prevRawValue === 0) return rawValue === 0 ? 0 : 100;
    return ((rawValue - prevRawValue) / Math.abs(prevRawValue)) * 100;
  }, [rawValue, prevRawValue]);

  const isFlat = delta != null && Math.abs(delta) < 0.1;
  const good = delta != null && (higherIsBetter ? delta > 0 : delta < 0);
  const arrowColor = delta == null ? "transparent" : isFlat ? "rgba(128,128,128,0.6)" : good ? "#0D9C29" : "#C21930";

  const clickable = (sparkline && sparkline.length >= 2) || (related && related.length > 0) || (prevRawValue != null && rawValue != null);

  return (
    <>
      <div
        onClick={clickable ? () => setDetailOpen(true) : undefined}
        style={{
          minWidth: 0,
          padding: "14px 16px",
          background: "rgba(128,128,128,0.06)",
          border: `1px solid ${color}30`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          cursor: clickable ? "pointer" : "default",
          transition: "border-color 120ms ease, transform 120ms ease",
        }}
        onMouseEnter={(e) => { if (clickable) e.currentTarget.style.borderColor = `${color}88`; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${color}30`; }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(128,128,128,0.9)", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          {clickable && (
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.4, marginLeft: "auto" }}>
              <path d="M2 8 L8 2 M4 2 L8 2 L8 6" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loading ? "…" : value}</div>
          {suffix && <div style={{ fontSize: 12, opacity: 0.7 }}>{suffix}</div>}
          {delta != null && (
            <div style={{ fontSize: 11, fontWeight: 600, color: arrowColor, marginLeft: "auto" }}>
              {isFlat ? "—" : good ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
            </div>
          )}
        </div>
        {subtext && <div style={{ fontSize: 10, opacity: 0.6 }}>{subtext}</div>}
        {sparkline && sparkline.length >= 2 && <KpiSparkline data={sparkline} color={color} format={format} />}
      </div>

      <KpiDetailModal
        show={detailOpen}
        onClose={() => setDetailOpen(false)}
        label={label}
        value={value}
        color={color}
        sparkline={sparkline}
        prevRawValue={prevRawValue}
        rawValue={rawValue}
        delta={delta}
        higherIsBetter={higherIsBetter}
        related={related}
        description={description}
        format={format}
        unit={unit}
      />
    </>
  );
};
