import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import "./kpi-card.css";

// ---------------------------------------------------------------------------
// KPI Card — direct port from user-journey-app.
// Provides KpiSparkline, KpiPanelOverlay (impact/anomaly/attribution),
// ForecastContext/Provider, and KpiCard with dropdown menu.
// ---------------------------------------------------------------------------

const GREEN = "#0D9C29";
const YELLOW = "#B8860B";
const RED = "#C21930";

export type ForecastOpener = (label: string, sparkline: number[], color?: string) => void;
export const ForecastContext = React.createContext<ForecastOpener | null>(null);
export const ForecastProvider = ForecastContext.Provider;

// ---------------------------------------------------------------------------
// Related-metrics correlations panel (minimal port).
// ---------------------------------------------------------------------------
export interface RelatedMetricEntry {
  label: string;
  sparkline: number[];
  color?: string;
  inverted?: boolean;
}
export type CorrelationOpener = (target: RelatedMetricEntry) => void;
export const CorrelationsContext = React.createContext<{
  registry: RelatedMetricEntry[];
  register: (metrics: RelatedMetricEntry[]) => void;
  open: CorrelationOpener;
} | null>(null);

// ---------------------------------------------------------------------------
// Interactive sparkline with hover crosshair + value tooltip
// ---------------------------------------------------------------------------
export function KpiSparkline({ data, color = "#4589FF" }: { data: number[]; color?: string }) {
  const VW = 200, H = 34;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const trimmed = data.length > 2 ? data.slice(0, -1) : data;
  const valid = trimmed.filter((v) => v != null && !isNaN(v) && isFinite(v));
  if (valid.length < 2) return null;
  const TARGET = 30;
  const interp: number[] = valid.length >= TARGET ? valid : Array.from({ length: TARGET }, (_, i) => {
    const t = i / (TARGET - 1);
    const srcIdx = t * (valid.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, valid.length - 1);
    return valid[lo] * (1 - (srcIdx - lo)) + valid[hi] * (srcIdx - lo);
  });
  const min = Math.min(...interp);
  const max = Math.max(...interp);
  const range = max - min || 1;
  const points = interp.map((v, i) => ({
    x: (i / (interp.length - 1)) * VW,
    y: H - ((v - min) / range) * (H - 4) - 2,
    value: v,
  }));
  const pts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fillPts = `0,${H} ${pts} ${VW},${H}`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VW;
    const idx = Math.round((x / VW) * (interp.length - 1));
    setHoverIdx(Math.max(0, Math.min(interp.length - 1, idx)));
  };

  const hoverPct = hoverIdx !== null ? (points[hoverIdx].x / VW) * 100 : 0;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${VW} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: H, marginTop: 4, opacity: 0.85, cursor: "crosshair" }}
        aria-hidden
        onMouseMove={handleMouseMove}
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
        <div style={{ position: "absolute", bottom: H + 6, left: `${Math.max(5, Math.min(hoverPct, 75))}%`, background: "rgba(0,0,0,0.85)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "3px 6px", borderRadius: 4, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 10, transform: "translateX(-50%)" }}>
          {points[hoverIdx].value >= 1000 ? `${(points[hoverIdx].value / 1000).toFixed(1)}k` : points[hoverIdx].value.toFixed(points[hoverIdx].value % 1 === 0 ? 0 : 1)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impact / Anomaly / Change-attribution overlay panels
// ---------------------------------------------------------------------------
function KpiPanelOverlay({ label, rawValue, sparkline, color, panel, onClose, effectiveHigherIsBetter }: {
  label: string; rawValue?: number; sparkline?: number[]; color?: string;
  panel: "impact" | "anomaly" | "attribution"; onClose: () => void; effectiveHigherIsBetter: boolean;
}) {
  const valid = (sparkline ?? []).filter((v) => isFinite(v) && v != null);
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  const std = valid.length > 1 ? Math.sqrt(valid.reduce((a, v) => a + (v - mean) ** 2, 0) / valid.length) : 0;
  const curr = rawValue ?? 0;
  const deviation = std > 0 ? (curr - mean) / std : 0;
  const pMin = valid.length ? Math.min(...valid) : 0;
  const pMax = valid.length ? Math.max(...valid) : 0;
  const lastFew = valid.slice(-4);
  const recentTrend = lastFew.length >= 2 ? (lastFew[lastFew.length - 1] - lastFew[0]) / (lastFew[0] || 1) * 100 : 0;
  const trendLabel = Math.abs(recentTrend) < 3 ? "Stable" : recentTrend > 0 ? (effectiveHigherIsBetter ? "Improving ↑" : "Worsening ↑") : (effectiveHigherIsBetter ? "Declining ↓" : "Improving ↓");
  const cv = mean > 0 ? std / Math.abs(mean) : 0;
  const stabilityLabel = cv < 0.05 ? "Very stable" : cv < 0.15 ? "Stable" : cv < 0.3 ? "Moderate variability" : "High variability";
  const anomalyStatus = Math.abs(deviation) < 1 ? { label: "Normal", color: "#0D9C29" } : Math.abs(deviation) < 2 ? { label: "Slightly elevated", color: "#FFC800" } : { label: "Anomalous", color: "#E00000" };
  const fmt = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(2);

  const titles: Record<string, string> = { impact: "👥 Impact Analysis", anomaly: "🔍 Anomaly Detection", attribution: "📋 Change Attribution" };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "rgba(20,24,46,0.98)", border: `1px solid ${color ?? "#4589FF"}40`, borderRadius: 12, padding: "24px 28px", maxWidth: 480, width: "90vw", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{titles[panel]}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{label}</div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(128,128,128,0.2)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, color: "#fff", padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>

        {panel === "impact" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Current value", value: fmt(curr), col: color ?? "#4589FF" },
              { label: "Peak (period)", value: fmt(pMax), col: "#0D9C29" },
              { label: "Trough (period)", value: fmt(pMin), col: "#E00000" },
              { label: "Mean (period)", value: fmt(mean), col: "rgba(255,255,255,0.7)" },
              { label: "Recent trend", value: trendLabel, col: recentTrend > 0 && effectiveHigherIsBetter ? "#0D9C29" : recentTrend < 0 && !effectiveHigherIsBetter ? "#0D9C29" : Math.abs(recentTrend) < 3 ? "rgba(255,255,255,0.6)" : "#E00000" },
              { label: "Data stability", value: stabilityLabel, col: "rgba(255,255,255,0.6)" },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, padding: "10px 12px", background: "rgba(69,137,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
              {effectiveHigherIsBetter ? `Higher ${label} positively impacts user outcomes.` : `Lower ${label} indicates a better user experience.`} Current value is {Math.abs(deviation) < 0.5 ? "within" : deviation > 0 ? "above" : "below"} the period mean.
            </div>
          </div>
        )}

        {panel === "anomaly" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              <div style={{ textAlign: "center", padding: "12px 20px", borderRadius: 10, background: `${anomalyStatus.color}18`, border: `1px solid ${anomalyStatus.color}40` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: anomalyStatus.color }}>{anomalyStatus.label}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{Math.abs(deviation).toFixed(2)}σ from mean</div>
              </div>
            </div>
            {[
              { label: "Current value", value: fmt(curr), col: color ?? "#4589FF" },
              { label: "Historical mean", value: fmt(mean), col: "rgba(255,255,255,0.7)" },
              { label: "Std deviation (±1σ)", value: `±${fmt(std)}`, col: "rgba(255,255,255,0.6)" },
              { label: "Normal range", value: `${fmt(Math.max(0, mean - std))} – ${fmt(mean + std)}`, col: "#0D9C29" },
              { label: "Deviation", value: `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}σ`, col: anomalyStatus.color },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, padding: "10px 12px", background: "rgba(69,137,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
              {Math.abs(deviation) < 1 ? `${label} is behaving normally for this timeframe. No action needed.` : Math.abs(deviation) < 2 ? `${label} shows slight deviation. Monitor for continued movement.` : `${label} is significantly outside the normal range. Investigate potential causes.`}
            </div>
          </div>
        )}

        {panel === "attribution" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
              Automated change detection requires deployment event data from Dynatrace. This analysis provides statistical context for manual correlation.
            </div>
            {[
              { label: "Period stability", value: stabilityLabel, col: cv < 0.1 ? "#0D9C29" : cv < 0.25 ? "#FFC800" : "#E00000" },
              { label: "Recent trend", value: trendLabel, col: "rgba(255,255,255,0.7)" },
              { label: "Trend magnitude", value: `${recentTrend >= 0 ? "+" : ""}${recentTrend.toFixed(1)}%`, col: Math.abs(recentTrend) < 5 ? "rgba(255,255,255,0.5)" : "#FFC800" },
              { label: "Value range (period)", value: `${fmt(pMin)} – ${fmt(pMax)}`, col: "rgba(255,255,255,0.6)" },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, padding: "10px 12px", background: "rgba(69,137,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
              To correlate with deployments: use the <strong style={{ color: "rgba(255,255,255,0.8)" }}>Change Intelligence</strong> tab or check Dynatrace Davis AI for automated root cause analysis.
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// KpiCard — main component
// ---------------------------------------------------------------------------
export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  color?: string;
  rawValue?: number;
  prevRawValue?: number | null;
  higherIsBetter?: boolean;
  /** @deprecated use higherIsBetter */
  inverted?: boolean;
  sparkline?: number[];
  onDrillToForecast?: (label: string, sparkline: number[], color?: string) => void;
  customContent?: React.ReactNode;
  isLoading?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
  suffix?: string;
  subtext?: string;
}

export function KpiCard({
  label, value, color, rawValue, prevRawValue, higherIsBetter, inverted = false,
  sparkline, onDrillToForecast, customContent, isLoading, loading, style, suffix, subtext,
}: KpiCardProps) {
  const forecastOpener = useContext(ForecastContext);
  const correlationsCtx = useContext(CorrelationsContext);
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"impact" | "anomaly" | "attribution" | null>(null);
  const hasSpark = !!sparkline && sparkline.length >= 2;
  const busy = isLoading || loading;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cardRef.current && cardRef.current.contains(t)) return;
      if ((t as HTMLElement).closest?.(".kpi-action-menu-portal")) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const delta = useMemo<number | null>(() => {
    if (rawValue == null || prevRawValue == null) return null;
    if (prevRawValue === 0) return rawValue === 0 ? 0 : 100;
    return ((rawValue - prevRawValue) / Math.abs(prevRawValue)) * 100;
  }, [rawValue, prevRawValue]);

  const effectiveHigherIsBetter = higherIsBetter ?? !inverted;
  const trendUp = delta !== null && delta > 0;
  const trendGood = delta !== null && (effectiveHigherIsBetter ? trendUp : !trendUp);
  const trendColor = delta === null ? undefined : delta === 0 ? undefined : trendGood ? GREEN : RED;
  const arrow = delta === null ? "" : delta === 0 ? "—" : trendUp ? "↑" : "↓";

  const THRESHOLD_COLORS = new Set([GREEN, RED, YELLOW]);
  const showProgressBar = hasSpark && !customContent && rawValue != null && THRESHOLD_COLORS.has(color ?? "");
  let progressPct = 50;
  if (showProgressBar) {
    if (color === GREEN) progressPct = effectiveHigherIsBetter ? 85 : 15;
    else if (color === RED) progressPct = effectiveHigherIsBetter ? 15 : 85;
  }

  const doForecast = () => {
    setMenuOpen(false);
    if (hasSpark) {
      if (onDrillToForecast) onDrillToForecast(label, sparkline!, color);
      else if (forecastOpener) forecastOpener(label, sparkline!, color);
    }
  };
  const doRelated = () => {
    setMenuOpen(false);
    if (correlationsCtx && hasSpark) correlationsCtx.open({ label, sparkline: sparkline!, color, inverted: !effectiveHigherIsBetter });
  };

  // Register this KPI's sparkline with the correlations registry so Related Metrics
  // can compute cross-metric correlations. Runs once per stable (label, sparkline).
  useEffect(() => {
    if (!correlationsCtx || !hasSpark) return;
    correlationsCtx.register([{ label, sparkline: sparkline!, color, inverted: !effectiveHigherIsBetter }]);
  }, [correlationsCtx, hasSpark, label, sparkline, color, effectiveHigherIsBetter]);

  return (
    <div
      ref={cardRef}
      className={`uj-kpi-card-enhanced${hasSpark ? " clickable" : ""}`}
      style={{ cursor: hasSpark ? "pointer" : undefined, ...style }}
      title={hasSpark ? `${label} — click for options` : label}
      onClick={(e) => { if (hasSpark) { e.stopPropagation(); setMenuOpen(prev => !prev); } }}
    >
      <Text style={{ fontSize: 11, opacity: 0.7, display: "block" }}>{label}</Text>
      {busy ? (
        <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
          <ProgressCircle size="small" />
        </div>
      ) : (
        <>
          {customContent ?? (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, marginTop: 4 }}>
              <Heading level={3} style={{ margin: 0, color }}>{value}</Heading>
              {suffix && <span style={{ fontSize: 11, opacity: 0.55 }}>{suffix}</span>}
              {delta !== null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: trendColor, whiteSpace: "nowrap", lineHeight: 1 }} title={`vs previous period: ${trendUp ? "+" : ""}${delta.toFixed(1)}%`}>
                  {arrow}&thinsp;{Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
          )}
          {subtext && <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>{subtext}</div>}
          {hasSpark && (
            <div style={{ width: "100%", marginTop: 2 }}>
              <KpiSparkline data={sparkline!} color={color ?? "#4589FF"} />
            </div>
          )}
          {showProgressBar && (
            <div style={{
              marginTop: 6, position: "relative", height: 4, borderRadius: 2, overflow: "visible",
              background: effectiveHigherIsBetter ? "linear-gradient(to right, #b01010, #c08010, #0D9C29)" : "linear-gradient(to right, #0D9C29, #c08010, #b01010)",
            }}>
              <div style={{ position: "absolute", top: -3, width: 2, height: 10, background: "#fff", borderRadius: 1, left: `${progressPct}%`, transform: "translateX(-50%)", boxShadow: "0 0 4px rgba(0,0,0,0.7)", opacity: 0.9 }} />
            </div>
          )}
        </>
      )}
      {menuOpen && hasSpark && (() => {
        const rect = cardRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const menuW = 200;
        const left = Math.max(8, Math.min(window.innerWidth - menuW - 8, rect.left + rect.width / 2 - menuW / 2));
        const top = rect.bottom + 6;
        return createPortal(
          <div
            className="kpi-action-menu kpi-action-menu-portal"
            style={{ position: "fixed", top, left, width: menuW }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="kpi-action-btn" onClick={doForecast}>📈 Forecast</button>
            <button className="kpi-action-btn" onClick={doRelated}>⟷ Related Metrics</button>
            <div className="kpi-action-sep" />
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("impact"); }}>👥 Impact</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("anomaly"); }}>🔍 Anomaly</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("attribution"); }}>📋 Change Attribution</button>
          </div>,
          document.body
        );
      })()}
      {activePanel && (
        <KpiPanelOverlay
          label={label}
          rawValue={rawValue}
          sparkline={sparkline}
          color={color}
          panel={activePanel}
          onClose={() => setActivePanel(null)}
          effectiveHigherIsBetter={effectiveHigherIsBetter}
        />
      )}
    </div>
  );
}

// Legacy re-export shape
export type RelatedMetric = { label: string; value: string; color?: string };
