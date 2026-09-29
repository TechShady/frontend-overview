import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { Text, Heading } from "@dynatrace/strato-components/typography";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useKpiMenu } from "./KpiMenuContext";
import "./kpi-card.css";

// ---------------------------------------------------------------------------
// KPI Card — direct port from user-journey-app.
// Provides KpiSparkline, KpiPanelOverlay (impact/anomaly/attribution/baseline/cost/diagnose),
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
// Impact / Anomaly / Change-attribution / Baseline / Cost / Diagnose overlay panels
// ---------------------------------------------------------------------------
function KpiPanelOverlay({ label, rawValue, sparkline, color, panel, onClose, effectiveHigherIsBetter, onOpenPanel }: {
  label: string; rawValue?: number; sparkline?: number[]; color?: string;
  panel: "impact" | "anomaly" | "attribution" | "baseline" | "cost" | "diagnose";
  onClose: () => void; effectiveHigherIsBetter: boolean;
  onOpenPanel?: (p: "impact" | "anomaly" | "attribution" | "baseline" | "cost" | "diagnose") => void;
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

  // --- Baseline / Cost / Diagnose computations ---
  const n = valid.length;
  const mid = Math.floor(n / 2);
  const baselineMean = mid > 0 ? valid.slice(0, mid).reduce((a, b) => a + b, 0) / mid : mean;
  const currentHalfMean = n - mid > 0 ? valid.slice(mid).reduce((a, b) => a + b, 0) / (n - mid) : mean;
  const bDelta = baselineMean > 0 ? ((currentHalfMean - baselineMean) / baselineMean) * 100 : 0;
  const bDeltaGood = effectiveHigherIsBetter ? bDelta > 0 : bDelta < 0;
  const acorrLag = Math.max(1, Math.floor(n / 6));
  let acorrNum = 0;
  const acorrCount = n > acorrLag * 2 ? n - acorrLag : 0;
  for (let ai = 0; ai < acorrCount; ai++) acorrNum += (valid[ai] - mean) * (valid[ai + acorrLag] - mean);
  const acorrDen = std * std * acorrCount;
  const seasonalStrength = acorrDen > 0 ? Math.abs(acorrNum / acorrDen) : 0;
  const seasonalLabel = seasonalStrength > 0.6 ? "Strong" : seasonalStrength > 0.3 ? "Moderate" : "Weak/None";
  const t1e = Math.floor(n / 3), t2e = Math.floor(2 * n / 3);
  const t1avg = t1e > 0 ? valid.slice(0, t1e).reduce((a, b) => a + b, 0) / t1e : 0;
  const t2avg = t2e > t1e ? valid.slice(t1e, t2e).reduce((a, b) => a + b, 0) / (t2e - t1e) : 0;
  const t3avg = n > t2e ? valid.slice(t2e).reduce((a, b) => a + b, 0) / (n - t2e) : 0;
  const peakSegment = t1avg >= t2avg && t1avg >= t3avg ? "Early period" : t2avg >= t1avg && t2avg >= t3avg ? "Mid period" : "Late period";
  const isBusinessOutcome = /revenue|conversion.?rate|^cr$|cvr|conv\.?\s*rate/i.test(label);
  const isPerf = /lcp|inp|ttfb|duration|load|paint/i.test(label);
  const isError = /error/i.test(label);
  const isApdex = /apdex/i.test(label);
  const degradationRaw = !effectiveHigherIsBetter ? (curr - mean) : (mean - curr);
  const degradationPct = mean > 0 ? (degradationRaw / mean) * 100 : 0;
  let conversionImpactPct = 0;
  let conversionNote = "";
  if (!isBusinessOutcome) {
    if (isPerf && degradationRaw > 0) { conversionImpactPct = Math.min(25, (degradationRaw / 100) * 0.7); conversionNote = "~0.7% conversion drop per 100ms degradation (Google research)."; }
    else if (isError && degradationRaw > 0) { conversionImpactPct = Math.min(20, degradationPct * 2); conversionNote = "Error rate increases correlate with ~2x conversion loss rate."; }
    else if (isApdex && degradationRaw > 0) { conversionImpactPct = Math.min(20, Math.abs(degradationPct) * 5); conversionNote = "Apdex decline correlates with dissatisfied user abandonment."; }
    else if (degradationRaw > 0) { conversionImpactPct = Math.min(10, degradationPct * 0.5); }
  }
  const peakIdx = valid.length ? valid.indexOf(Math.max(...valid)) : 0;
  const peakToMean = mean > 0 ? pMax / mean : 1;
  const peakIsMid = n > 4 && peakIdx > n * 0.2 && peakIdx < n * 0.8;
  const trafficScaling = peakIsMid && peakToMean > 1.3;
  const isWorsening = effectiveHigherIsBetter ? recentTrend < -5 : recentTrend > 5;
  const worsePct = Math.abs(recentTrend);
  const funnelImpact = isWorsening ? Math.min(20, worsePct * 0.4) : 0;
  let changePointIdx = -1;
  let maxShift = 0;
  for (let ci = 2; ci < n - 2; ci++) {
    const before = valid.slice(0, ci).reduce((a, b) => a + b, 0) / ci;
    const after = valid.slice(ci).reduce((a, b) => a + b, 0) / (n - ci);
    const shift = Math.abs(after - before);
    if (shift > maxShift) { maxShift = shift; changePointIdx = ci; }
  }
  const changeDetected = maxShift > mean * 0.12 && changePointIdx > 0;
  const changePct = mean > 0 ? (maxShift / mean) * 100 : 0;
  const changePos = changeDetected ? Math.round((changePointIdx / n) * 100) : 0;
  const p50e = mean, p75e = mean + 0.674 * std, p90e = mean + 1.282 * std, p95e = mean + 1.645 * std, p99e = mean + 2.326 * std;
  const longTail = std > 0 && p50e > 0 && p99e > p50e * 2.5;
  const velDiffs = valid.slice(1).map((v, i) => v - valid[i]);
  const velPos = velDiffs.filter(d => d > std * 0.05).length;
  const velNeg = velDiffs.filter(d => d < -std * 0.05).length;
  const monotone = velDiffs.length > 0 ? Math.max(velPos, velNeg) / velDiffs.length : 0;
  const lag4 = Math.max(2, Math.floor(n / 4));
  let acorr4Num = 0;
  const lag4Count = n > lag4 * 2 ? n - lag4 : 0;
  for (let li = 0; li < lag4Count; li++) acorr4Num += (valid[li] - mean) * (valid[li + lag4] - mean);
  const lag4Den = std * std * lag4Count;
  const acorr4 = lag4Den > 0 ? acorr4Num / lag4Den : 0;
  const zScores = valid.map(v => std > 0 ? Math.abs((v - mean) / std) : 0);
  const spikeCount = zScores.filter(z => z > 2.5).length;
  const hasSpikePattern = spikeCount >= 1 && spikeCount <= Math.max(2, Math.floor(n * 0.1));
  const trendType =
    hasSpikePattern && spikeCount <= 2 ? "One-time spike"
    : acorr4 > 0.5 ? "Cyclical / periodic"
    : monotone > 0.65 && velPos > velNeg ? (effectiveHigherIsBetter ? "Steadily improving" : "Gradually worsening")
    : monotone > 0.65 && velNeg > velPos ? (effectiveHigherIsBetter ? "Gradually declining" : "Steadily improving")
    : Math.abs(recentTrend) < 3 ? "Stable"
    : "Variable / mixed";
  const trendBad = trendType === "Gradually worsening" || trendType === "Gradually declining";
  const detThreshold = effectiveHigherIsBetter ? mean - std : mean + std;
  const nearThreshold = effectiveHigherIsBetter ? curr < detThreshold * 1.1 : curr > detThreshold * 0.9;

  const diagSc: Record<string, string> = { ok: "#0D9C29", warning: "#FFC800", critical: "#E00000", info: "#4589FF" };
  const diagSl: Record<string, string> = { ok: "OK", warning: "REVIEW", critical: "CRITICAL", info: "INFO" };
  const diagnoseScenarios = [
    { id: "traffic", icon: "🚦", title: "Traffic Scaling",
      status: trafficScaling ? "warning" : "ok",
      finding: trafficScaling ? `Peak value (${fmt(pMax)}) occurs mid-period — consistent with traffic surge impact. Peak-to-mean: ${peakToMean.toFixed(1)}x.` : `No clear mid-period peak surge. Peak-to-mean: ${peakToMean.toFixed(1)}x — scaling likely not the primary cause.`,
      rec: trafficScaling ? `Monitor when ${label} exceeds ~${fmt(mean * 1.15)}. Consider auto-scaling or caching during peak load.` : "Investigate other causes. Traffic volume scaling appears stable." },
    { id: "funnel", icon: "📉", title: isBusinessOutcome ? "Performance Drivers (Funnel Impact)" : "Funnel Exits & Conversion",
      status: isBusinessOutcome ? "info" : isWorsening ? (worsePct > 10 ? "critical" : "warning") : "ok",
      finding: isBusinessOutcome ? `${label} IS the conversion/revenue metric. Focus on what drives it: LCP, Error Rate, TTFB, INP, and Apdex have the strongest correlation.` : isWorsening ? `Recent ${worsePct.toFixed(1)}% ${effectiveHigherIsBetter ? "decline" : "increase"} may drive early funnel exits. Est. ~${funnelImpact.toFixed(1)}% conversion impact.` : `${label} is relatively stable. Low funnel exit risk at current values.`,
      rec: isBusinessOutcome ? "Use the KPI cards for LCP, Error Rate, TTFB, and INP — those metrics have the highest leverage on your conversion/revenue outcomes." : isWorsening ? `A ${worsePct.toFixed(0)}% worsening adds ~${funnelImpact.toFixed(1)}% abandonment. Check funnel behavior and correlate with Business Analytics revenue data.` : "Continue monitoring. Set an alert if the trend reverses." },
    { id: "browser-geo", icon: "🌍", title: "Browser / Geo Specificity",
      status: (mean > 0 && std / mean > 0.35) ? "warning" : "ok",
      finding: (mean > 0 && std / mean > 0.35)
        ? `High coefficient of variation (${(std / mean * 100).toFixed(0)}%) — metric variability may indicate browser or geo-specific issues masked by aggregation.`
        : `Metric variance is low (CV: ${mean > 0 ? (std / mean * 100).toFixed(0) : 0}%) — behavior appears relatively uniform across segments.`,
      rec: (mean > 0 && std / mean > 0.35)
        ? "Use 🌍 Dimension from this card's menu to break down by browser/OS and geo. Flag any segment with values 2x+ the overall average."
        : "Use 🌍 Dimension to verify uniform behavior across segments. No urgent action needed." },
    { id: "pages", icon: "📋", title: "Pages / Actions Focus",
      status: isWorsening ? "warning" : "ok",
      finding: isWorsening
        ? `${label} is declining ${worsePct.toFixed(1)}% recently — specific pages or actions may be driving the degradation.`
        : `${label} appears stable — page-level distribution is unlikely to reveal an active problem right now.`,
      rec: isWorsening
        ? "Use 🌍 Dimension → split by page/action. Prioritize pages with high traffic AND poor metric values. Use 📅 Heatmap to find time/page patterns."
        : "Page-level breakdown is optional at this time. Use 📅 Heatmap if you suspect a specific page is contributing." },
    { id: "change", icon: "🔄", title: "Change / Deployment",
      status: changeDetected ? (changePct > 20 ? "critical" : "warning") : "ok",
      finding: changeDetected ? `Significant change point at ~${changePos}% into the period. Values shifted by ~${changePct.toFixed(0)}% (${fmt(maxShift)}).` : "No significant change point detected. Values appear to transition smoothly.",
      rec: changeDetected ? `Correlate with Dynatrace release events near the ${changePos}% mark. Check the Change Intelligence tab or Davis AI for automated RCA.` : "No deployment correlation needed. Monitor for new releases." },
    { id: "distribution", icon: "📊", title: "Performance Distribution (P50–P99)",
      status: longTail ? "warning" : "ok",
      finding: `P50: ${fmt(Math.max(0, p50e))}, P75: ${fmt(Math.max(0, p75e))}, P90: ${fmt(Math.max(0, p90e))}, P95: ${fmt(Math.max(0, p95e))}, P99: ${fmt(Math.max(0, p99e))}`,
      rec: longTail ? `High P99/P50 ratio (${(p99e / Math.max(p50e, 0.001)).toFixed(1)}x) indicates a long tail — investigate outlier sessions.` : `Distribution looks reasonable (P99/P50: ${(p99e / Math.max(p50e, 0.001)).toFixed(1)}x). Most users have a consistent experience.` },
    { id: "trend", icon: "📈", title: "Trend Pattern",
      status: trendBad ? "warning" : acorr4 > 0.5 ? "info" : "ok",
      finding: `Pattern: ${trendType}.${acorr4 > 0.3 ? ` Autocorrelation: ${(acorr4 * 100).toFixed(0)}%.` : ""}${hasSpikePattern ? ` Spike occurrences: ${spikeCount}.` : ""}`,
      rec: trendType === "One-time spike" ? "Isolated event. Verify against deployments or external events. Likely not systemic — watch for recurrence." : trendType === "Cyclical / periodic" ? "Cyclical behavior detected. Set time-based alerts aligned to the cycle. Confirm if it matches daily/weekly traffic patterns." : trendBad ? "Gradual degradation in progress. Investigate root cause before it impacts more users — check for memory or resource leaks." : "Pattern is healthy or stable. Continue monitoring with existing alerts." },
    { id: "threshold", icon: "⚡", title: "Deterioration Threshold",
      status: nearThreshold ? "warning" : "ok",
      finding: `Estimated threshold: ${fmt(Math.max(0, detThreshold))} (mean ${effectiveHigherIsBetter ? "−" : "+"}1σ).${nearThreshold ? ` Current value (${fmt(curr)}) is near or past the threshold.` : ""}`,
      rec: `Set a Dynatrace alert when ${label} ${effectiveHigherIsBetter ? "falls below" : "exceeds"} ${fmt(Math.max(0, detThreshold))} to catch deterioration early.` },
  ];

  const panelSeverity: string =
    panel === "anomaly" ? (Math.abs(deviation) >= 2 ? "critical" : Math.abs(deviation) >= 1 ? "warning" : "ok")
    : panel === "impact" ? (Math.abs(deviation) > 2 ? "critical" : Math.abs(deviation) > 1 ? "warning" : "ok")
    : panel === "attribution" ? (changeDetected && changePct > 20 ? "critical" : changeDetected || Math.abs(recentTrend) > 15 ? "warning" : "ok")
    : panel === "baseline" ? (Math.abs(bDelta) > 15 && !bDeltaGood ? "critical" : Math.abs(bDelta) > 8 && !bDeltaGood ? "warning" : "ok")
    : panel === "cost" ? (degradationPct > 20 ? "critical" : degradationPct > 8 ? "warning" : "ok")
    : panel === "diagnose" ? (diagnoseScenarios.some(s => s.status === "critical") ? "critical" : diagnoseScenarios.some(s => s.status === "warning") ? "warning" : "ok")
    : "ok";

  const severityColor: Record<string, string> = { ok: "#0D9C29", warning: "#FFC800", critical: "#E00000", info: "#4589FF" };
  const severityLabel: Record<string, string> = { ok: "OK", warning: "REVIEW", critical: "CRITICAL", info: "INFO" };

  const execSummary =
    panel === "impact"
      ? (Math.abs(deviation) < 0.5 ? `${label} is within normal range — stable at ${fmt(curr)}.` : `${label} is ${Math.abs(deviation).toFixed(1)}σ ${deviation > 0 ? "above" : "below"} the period mean${effectiveHigherIsBetter === (deviation > 0) ? ", trending positively" : ", trending negatively"}.`)
    : panel === "anomaly" ? `${label} is ${anomalyStatus.label} — ${Math.abs(deviation).toFixed(2)}σ from the period mean.`
    : panel === "attribution" ? (changeDetected ? `A ~${changePct.toFixed(0)}% value shift was detected at the ${changePos}% mark of the period.` : `No significant change — ${label} shows ${stabilityLabel.toLowerCase()} behavior.`)
    : panel === "baseline" ? (Math.abs(bDelta) < 3 ? `${label} is consistent with its earlier baseline — no significant drift.` : `${label} is ${Math.abs(bDelta).toFixed(1)}% ${bDelta > 0 ? "higher" : "lower"} than the first-half baseline.`)
    : panel === "cost" ? (isBusinessOutcome ? `${label} is a business outcome metric — optimize the performance drivers below.` : conversionImpactPct > 0 ? `Estimated ~${conversionImpactPct.toFixed(1)}% conversion impact based on ${fmt(Math.max(0, degradationRaw))} deviation from mean.` : `${label} appears within normal range — minimal cost impact.`)
    : panel === "diagnose" ? (() => {
        const crit = diagnoseScenarios.filter(s => s.status === "critical").map(s => s.title);
        const warn = diagnoseScenarios.filter(s => s.status === "warning").map(s => s.title);
        const all = [...crit, ...warn];
        return all.length === 0 ? `All ${diagnoseScenarios.length} diagnostic scenarios appear healthy for ${label}.` : `${all.length} scenario(s) need attention: ${all.join(", ")}.`;
      })()
    : "";

  const nextStep =
    panel === "impact" ? (Math.abs(deviation) > 2 ? `Investigate root cause — open 🩺 Diagnose or check 🌍 Dimension breakdown for anomalous segments.` : Math.abs(deviation) > 1 ? `Monitor closely. Consider setting a Dynatrace alert for ${label}.` : `No immediate action needed. Continue monitoring with existing alerts.`)
    : panel === "anomaly" ? (anomalyStatus.label === "Anomalous" ? `Investigate immediately — check 🌍 Dimension breakdown for geo/browser segments and 📋 Change Attribution for deployment correlation.` : anomalyStatus.label !== "Normal" ? `Monitor for continued movement. Set an alert at ${fmt(Math.max(0, mean + 2 * std))} to catch escalation early.` : `No action needed. ${label} is behaving normally.`)
    : panel === "attribution" ? (changeDetected ? `Correlate with Dynatrace deployment events near the ${changePos}% mark. Open the Change Intelligence tab or Davis AI for automated RCA.` : `No deployment correlation needed at this time. Monitor for new releases.`)
    : panel === "baseline" ? (Math.abs(bDelta) > 8 && !bDeltaGood ? `Investigate the drift. Use a longer timeframe in Dynatrace to compare same-day or same-hour baselines.` : seasonalStrength > 0.3 ? `Cyclical behavior detected — consider time-based alerting aligned to the periodic pattern.` : `Baseline is stable. No immediate action needed.`)
    : panel === "cost" ? (isBusinessOutcome ? `Prioritize optimization of LCP, Error Rate, and INP — they have the highest leverage on ${label}.` : degradationPct > 10 ? `Prioritize optimization. Connect Dynatrace Business Analytics for precise revenue impact.` : `Cost impact minimal at current levels. Continue monitoring.`)
    : panel === "diagnose" ? (diagnoseScenarios.find(s => s.status === "critical")?.rec ?? diagnoseScenarios.find(s => s.status === "warning")?.rec ?? `No critical issues detected. Review REVIEW-status scenarios for optimization opportunities.`)
    : "";

  const crossLinks: Array<{p: "impact"|"anomaly"|"attribution"|"baseline"|"cost"|"diagnose"; lbl: string}> =
    panel === "impact"      ? [{p:"diagnose", lbl:"🩺 Diagnose"}, {p:"anomaly", lbl:"🔍 Anomaly"}]
    : panel === "anomaly"      ? [{p:"attribution", lbl:"📋 Attribution"}, {p:"diagnose", lbl:"🩺 Diagnose"}]
    : panel === "attribution"  ? [{p:"diagnose", lbl:"🩺 Diagnose"}, {p:"cost", lbl:"💰 Cost Impact"}]
    : panel === "baseline"     ? [{p:"diagnose", lbl:"🩺 Diagnose"}, {p:"cost", lbl:"💰 Cost"}]
    : panel === "cost"         ? [{p:"diagnose", lbl:"🩺 Diagnose"}, {p:"baseline", lbl:"📊 Baseline"}]
    : panel === "diagnose"     ? [{p:"cost", lbl:"💰 Cost Impact"}, {p:"baseline", lbl:"📊 Baseline"}]
    : [];

  const exportPdf = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const sc2: Record<string, string> = { ok: "#0D9C29", warning: "#FFC800", critical: "#E00000", info: "#4589FF" };
    const panelRows = panel === "diagnose"
      ? diagnoseScenarios.map(s => `<div style="margin:6px 0;padding:8px 12px;background:#1a1e36;border-radius:6px;border-left:3px solid ${sc2[s.status]}"><strong style="color:#fff">${s.icon} ${s.title}</strong> <span style="font-size:10px;color:${sc2[s.status]};float:right;font-weight:bold">${s.status.toUpperCase()}</span><br><span style="color:#9ca3af;font-size:11px">${s.finding}</span><br><span style="color:#6b7280;font-size:11px">→ ${s.rec}</span></div>`).join("")
      : panel === "baseline" ? [
          { label: "Baseline avg (first half)", value: fmt(baselineMean) }, { label: "Current avg (second half)", value: fmt(currentHalfMean) },
          { label: "Change from baseline", value: `${bDelta >= 0 ? "+" : ""}${bDelta.toFixed(1)}%` }, { label: "Cyclical strength", value: seasonalLabel },
          { label: "Peak segment", value: peakSegment }, { label: "Early period avg", value: fmt(t1avg) }, { label: "Mid period avg", value: fmt(t2avg) }, { label: "Late period avg", value: fmt(t3avg) },
        ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2e4a"><span style="color:#9ca3af">${r.label}</span><strong>${r.value}</strong></div>`).join("")
      : panel === "cost" ? [
          { label: "Deviation from mean", value: `${degradationPct.toFixed(1)}%` }, { label: "Est. conversion impact", value: conversionImpactPct > 0 ? `-${conversionImpactPct.toFixed(1)}%` : "Minimal" },
          { label: "Severity", value: degradationPct > 20 ? "Severe" : degradationPct > 10 ? "Moderate" : degradationPct > 3 ? "Minor" : "Negligible" },
        ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2e4a"><span style="color:#9ca3af">${r.label}</span><strong>${r.value}</strong></div>`).join("")
      : panel === "impact" ? [
          { label: "Current value", value: fmt(curr) }, { label: "Peak (period)", value: fmt(pMax) }, { label: "Trough (period)", value: fmt(pMin) },
          { label: "Mean (period)", value: fmt(mean) }, { label: "Recent trend", value: trendLabel }, { label: "Data stability", value: stabilityLabel },
        ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2e4a"><span style="color:#9ca3af">${r.label}</span><strong>${r.value}</strong></div>`).join("")
      : panel === "anomaly" ? [
          { label: "Status", value: anomalyStatus.label }, { label: "Deviation", value: `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}σ` },
          { label: "Historical mean", value: fmt(mean) }, { label: "Normal range", value: `${fmt(Math.max(0, mean - std))} – ${fmt(mean + std)}` },
        ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2e4a"><span style="color:#9ca3af">${r.label}</span><strong>${r.value}</strong></div>`).join("")
      : [
          { label: "Period stability", value: stabilityLabel }, { label: "Recent trend", value: trendLabel },
          { label: "Change detected", value: changeDetected ? `Yes (~${changePos}% into period)` : "No" },
        ].map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2e4a"><span style="color:#9ca3af">${r.label}</span><strong>${r.value}</strong></div>`).join("");

    const pdfTitles: Record<string, string> = { impact: "👥 Impact Analysis", anomaly: "🔍 Anomaly Detection", attribution: "📋 Change Attribution", baseline: "📊 Baseline Compare", cost: "💰 Cost Impact", diagnose: "🩺 Diagnose" };
    const sev = panelSeverity;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${pdfTitles[panel] ?? panel} — ${label}</title><style>
      *{margin:0;padding:0;box-sizing:border-box}body{background:#0f1221;color:#e8eaf0;font-family:'Segoe UI',system-ui,sans-serif;padding:32px;font-size:13px}
      h1{font-size:20px;margin-bottom:4px}.sub{color:#6b7280;font-size:12px;margin-bottom:20px}
      .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
      .exec{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:13px;font-weight:600}
      .content{margin-bottom:16px}.next{padding:12px 16px;background:#1a2036;border-left:3px solid ${color ?? "#4589FF"};border-radius:6px;font-size:12px;color:#9ca3af}
      strong{color:#e8eaf0}@media print{body{background:#fff;color:#111}.exec,.next{border:1px solid #ccc}h1,.sub,.badge{color:#111}strong{color:#111}@page{margin:1cm}}
    </style></head><body>
      <h1>${pdfTitles[panel] ?? panel} <span class="badge" style="background:${sc2[sev]}22;color:${sc2[sev]}">${severityLabel[sev]}</span></h1>
      <div class="sub">${label} &middot; Generated ${new Date().toLocaleString()}</div>
      <div class="exec" style="background:${sc2[sev]}15;border-left:3px solid ${sc2[sev]}">${execSummary}</div>
      <div class="content">${panelRows}</div>
      <div class="next"><strong>Recommended Next Step:</strong><br>${nextStep}</div>
    </body></html>`;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const titles: Record<string, string> = { impact: "👥 Impact Analysis", anomaly: "🔍 Anomaly Detection", attribution: "📋 Change Attribution", baseline: "📊 Baseline Compare", cost: "💰 Cost Impact", diagnose: "🩺 Diagnose" };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100010, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "rgba(20,24,46,0.98)", border: `1px solid ${color ?? "#4589FF"}40`, borderRadius: 12, padding: "24px 28px", maxWidth: panel === "diagnose" ? 600 : 480, width: "90vw", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{titles[panel]}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: `${severityColor[panelSeverity]}20`, color: severityColor[panelSeverity], letterSpacing: "0.5px", textTransform: "uppercase" as const }}>{severityLabel[panelSeverity]}</span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{label}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={exportPdf} style={{ background: "rgba(69,137,255,0.15)", border: "1px solid rgba(69,137,255,0.3)", borderRadius: 6, color: "#4589FF", padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>📄 PDF</button>
            <button onClick={onClose} style={{ background: "rgba(128,128,128,0.2)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, color: "#fff", padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        </div>
        <div style={{ padding: "8px 12px", marginBottom: 14, background: `${severityColor[panelSeverity]}12`, borderLeft: `3px solid ${severityColor[panelSeverity]}`, borderRadius: 6, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
          {execSummary}
        </div>

        {panel === "impact" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Current value", value: fmt(curr), col: color ?? "#4589FF" },
              { label: "Peak (period)", value: fmt(pMax), col: effectiveHigherIsBetter ? "#0D9C29" : "#E00000" },
              { label: "Trough (period)", value: fmt(pMin), col: effectiveHigherIsBetter ? "#E00000" : "#0D9C29" },
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
              {effectiveHigherIsBetter ? `Higher ${label} positively impacts user outcomes and revenue.` : `Lower ${label} indicates a better user experience.`} Current value is {Math.abs(deviation) < 0.5 ? "within" : deviation > 0 ? "above" : "below"} the period mean.
            </div>
          </div>
        )}

        {panel === "anomaly" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              <div style={{ textAlign: "center", padding: "12px 20px", borderRadius: 10, background: `${anomalyStatus.color}18`, border: `1px solid ${anomalyStatus.color}40` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: anomalyStatus.color }}>{anomalyStatus.label}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{Math.abs(deviation).toFixed(2)}{"σ"} from mean</div>
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

        {panel === "baseline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Period Comparison (First Half vs Second Half)</div>
              {[
                { label: "Baseline avg (first half)", value: fmt(baselineMean), col: "rgba(255,255,255,0.7)" },
                { label: "Current avg (second half)", value: fmt(currentHalfMean), col: color ?? "#4589FF" },
                { label: "Change from baseline", value: `${bDelta >= 0 ? "+" : ""}${bDelta.toFixed(1)}%`, col: Math.abs(bDelta) < 3 ? "rgba(255,255,255,0.6)" : bDeltaGood ? "#0D9C29" : "#E00000" },
                { label: "Data stability", value: stabilityLabel, col: "rgba(255,255,255,0.6)" },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Seasonality &amp; Period Patterns</div>
              {[
                { label: "Cyclical strength", value: seasonalLabel, col: seasonalStrength > 0.3 ? "#FFC800" : "rgba(255,255,255,0.6)" },
                { label: "Peak segment", value: peakSegment, col: "rgba(255,255,255,0.7)" },
                { label: "Early period avg", value: fmt(t1avg), col: "rgba(255,255,255,0.6)" },
                { label: "Mid period avg", value: fmt(t2avg), col: "rgba(255,255,255,0.6)" },
                { label: "Late period avg", value: fmt(t3avg), col: "rgba(255,255,255,0.6)" },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 12px", background: "rgba(69,137,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
              {Math.abs(bDelta) < 3
                ? `${label} is consistent with its earlier baseline — no significant drift detected.`
                : bDeltaGood
                  ? `${label} has ${effectiveHigherIsBetter ? "improved" : "decreased"} ${Math.abs(bDelta).toFixed(1)}% vs baseline.${seasonalStrength > 0.3 ? " Cyclical pattern detected — compare same hour/day in prior periods for an accurate seasonality baseline." : ""}`
                  : `${label} has ${effectiveHigherIsBetter ? "declined" : "increased"} ${Math.abs(bDelta).toFixed(1)}% vs baseline.${seasonalStrength > 0.3 ? " Cyclical pattern detected — use a longer timeframe to compare same-day or same-hour baselines." : " Investigate root cause."}`
              }
            </div>
          </div>
        )}

        {panel === "cost" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "10px 12px", background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
              {isBusinessOutcome
                ? `${label} is a business outcome metric. The analysis below identifies which performance metrics drive it most.`
                : "Estimates based on industry benchmarks. Connect revenue data in Dynatrace Business Analytics for precision."}
            </div>
            {isBusinessOutcome ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", padding: "0 2px" }}>Top performance drivers for {label}</div>
                {[
                  { metric: "LCP (Page Load Speed)", impact: "High", note: "Each 100ms above 2.5s reduces conversion ~0.7%", col: "#E00000" },
                  { metric: "Error Rate", impact: "High", note: "Each 1% error rate increase → ~2% conversion drop", col: "#E00000" },
                  { metric: "INP (Interactivity)", impact: "Medium", note: "Slow interactions reduce task completion rate", col: "#FFC800" },
                  { metric: "TTFB", impact: "Medium", note: "High TTFB inflates all downstream timings", col: "#FFC800" },
                  { metric: "Apdex / Satisfaction", impact: "Medium", note: "Low Apdex correlates with early abandonment", col: "#FFC800" },
                  { metric: "Session Duration", impact: "Low–Medium", note: "Abnormally short durations may indicate friction", col: "rgba(255,255,255,0.5)" },
                ].map((r, i) => (
                  <div key={i} style={{ padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{r.metric}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: r.col }}>{r.impact}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{r.note}</div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Metric Deviation vs Mean</div>
                  {[
                    { label: "Deviation from mean", value: `${degradationRaw >= 0 ? "+" : ""}${degradationPct.toFixed(1)}%`, col: degradationRaw > 0 ? "#E00000" : "#0D9C29" },
                    { label: "Est. conversion impact", value: conversionImpactPct > 0 ? `-${conversionImpactPct.toFixed(1)}%` : "Minimal", col: conversionImpactPct > 5 ? "#E00000" : conversionImpactPct > 2 ? "#FFC800" : "#0D9C29" },
                    { label: "Severity", value: degradationPct > 20 ? "Severe" : degradationPct > 10 ? "Moderate" : degradationPct > 3 ? "Minor" : "Negligible", col: degradationPct > 20 ? "#E00000" : degradationPct > 10 ? "#FFC800" : "#0D9C29" },
                    { label: "Peak-to-mean ratio", value: mean > 0 ? `${(pMax / mean).toFixed(1)}x` : "N/A", col: pMax > mean * 3 ? "#E00000" : pMax > mean * 1.5 ? "#FFC800" : "#0D9C29" },
                  ].map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: r.col }}>{r.value}</span>
                    </div>
                  ))}
                </div>
                {conversionNote && (
                  <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                    <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>Benchmark: </span>{conversionNote}
                  </div>
                )}
                <div style={{ padding: "10px 12px", background: "rgba(69,137,255,0.06)", borderRadius: 8, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
                  {degradationPct > 10
                    ? `${label} is ${degradationPct.toFixed(0)}% worse than period mean — likely measurable business impact. Prioritize optimization.`
                    : `${label} is within normal range. Cost impact appears minimal at current levels.`}
                </div>
              </>
            )}
          </div>
        )}

        {panel === "diagnose" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
            {diagnoseScenarios.map(s => (
              <div key={s.id} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8, borderLeft: `3px solid ${diagSc[s.status]}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{s.title}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: diagSc[s.status], textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>{diagSl[s.status]}</span>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, marginBottom: 4 }}>{s.finding}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>→ {s.rec}</div>
              </div>
            ))}
          </div>
        )}

        {/* Mini sparkline */}
        {(panel === "baseline" || panel === "attribution" || panel === "impact") && valid.length >= 4 && (() => {
          const mn = Math.min(...valid), mx = Math.max(...valid), rng = mx - mn || 1;
          const pts = valid.map((d, i) => `${(i / (valid.length - 1) * 100).toFixed(1)},${(100 - (d - mn) / rng * 100).toFixed(1)}`).join(" ");
          return (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
              <div style={{ fontSize: 9, opacity: 0.35, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 }}>Period trend</div>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 36, display: "block" }}>
                <polyline points={pts} fill="none" stroke={color ?? "#4589FF"} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </div>
          );
        })()}

        {/* Recommended Next Step */}
        <div style={{ marginTop: 12, padding: "10px 14px", background: `${color ?? "#4589FF"}10`, borderLeft: `3px solid ${color ?? "#4589FF"}`, borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: color ?? "#4589FF", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>Recommended Next Step</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>{nextStep}</div>
        </div>

        {/* Cross-panel navigation */}
        {onOpenPanel && crossLinks.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Also see:</span>
            {crossLinks.map(l => (
              <button key={l.p} onClick={() => onOpenPanel(l.p)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "rgba(255,255,255,0.6)", padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                {l.lbl}
              </button>
            ))}
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
  query?: string;
}

export function KpiCard({
  label, value, color, rawValue, prevRawValue, higherIsBetter, inverted = false,
  sparkline, onDrillToForecast, customContent, isLoading, loading, style, suffix, subtext, query,
}: KpiCardProps) {
  const forecastOpener = useContext(ForecastContext);
  const correlationsCtx = useContext(CorrelationsContext);
  const kpiMenuCtx = useKpiMenu();
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"impact" | "anomaly" | "attribution" | "baseline" | "cost" | "diagnose" | null>(null);
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

  useEffect(() => { if (activePanel) setMenuOpen(false); }, [activePanel]);

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
  if (showProgressBar && sparkline && sparkline.length >= 2) {
    const sorted = [...sparkline].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= (rawValue as number)).length;
    const quantile = rank / sorted.length;
    let zoneMin: number, zoneMax: number;
    if (color === GREEN)       { zoneMin = effectiveHigherIsBetter ? 67 : 2;  zoneMax = effectiveHigherIsBetter ? 98 : 33; }
    else if (color === RED)    { zoneMin = effectiveHigherIsBetter ? 2  : 67; zoneMax = effectiveHigherIsBetter ? 33 : 98; }
    else                       { zoneMin = 33; zoneMax = 67; }
    progressPct = zoneMin + quantile * (zoneMax - zoneMin);
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
  const doOpenNotebook = () => {
    setMenuOpen(false);
    if (query) sendIntent({ 'dt.query': query }, { recommendedAppId: 'dynatrace.notebooks', recommendedIntentId: 'open-with-dql' });
  };
  const doDimension = () => {
    setMenuOpen(false);
    if (hasSpark) kpiMenuCtx?.openDimension({ label, sparkline: sparkline ?? [], color });
  };
  const doHeatmap = () => {
    setMenuOpen(false);
    if (hasSpark) kpiMenuCtx?.openHeatmap({ label, sparkline: sparkline ?? [], color });
  };

  // Register this KPI's sparkline with the correlations registry.
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
            {query && <button className="kpi-action-btn" onClick={doOpenNotebook}>↗ Open with...</button>}
            {kpiMenuCtx && <button className="kpi-action-btn" onClick={doDimension}>🌍 Dimension</button>}
            {kpiMenuCtx && <button className="kpi-action-btn" onClick={doHeatmap}>📅 Heatmap</button>}
            <div className="kpi-action-sep" />
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("impact"); }}>👥 Impact</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("anomaly"); }}>🔍 Anomaly</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("attribution"); }}>📋 Change Attribution</button>
            <div className="kpi-action-sep" />
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("baseline"); }}>📊 Baseline Compare</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("cost"); }}>💰 Cost Impact</button>
            <button className="kpi-action-btn" onClick={() => { setMenuOpen(false); setActivePanel("diagnose"); }}>🩺 Diagnose</button>
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
          onOpenPanel={(p) => { setMenuOpen(false); setActivePanel(p); }}
        />
      )}
    </div>
  );
}

// Legacy re-export shape
export type RelatedMetric = { label: string; value: string; color?: string };
