import React, { useMemo, useState, useCallback } from "react";
import { Heading, Text, Strong } from "@dynatrace/strato-components/typography";
import { Flex } from "@dynatrace/strato-components/layouts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MetricEntry {
  label: string;
  sparkline: number[];
  color?: string;
  /** When true, lower values are "better" (e.g. Error Rate, Latency) */
  inverted?: boolean;
}

export interface CorrelationResult {
  label: string;
  color?: string;
  /** Pearson correlation coefficient (-1 to +1) */
  r: number;
  /** Absolute correlation strength (0 to 1) */
  strength: number;
  /** Human-readable direction description */
  direction: string;
  /** Influence narrative for the user */
  narrative: string;
  /** Mini sparkline data of the correlated metric */
  sparkline: number[];
}

// ---------------------------------------------------------------------------
// Pearson Correlation Coefficient
// ---------------------------------------------------------------------------
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const xs = x.slice(0, n);
  const ys = y.slice(0, n);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return num / den;
}

// ---------------------------------------------------------------------------
// Compute correlations for a target metric vs all other registered metrics
// ---------------------------------------------------------------------------
export function computeCorrelations(
  target: MetricEntry,
  allMetrics: MetricEntry[],
  minStrength = 0.3
): CorrelationResult[] {
  const results: CorrelationResult[] = [];
  if (!target.sparkline || target.sparkline.length < 3) return results;

  for (const metric of allMetrics) {
    if (metric.label === target.label) continue;
    if (!metric.sparkline || metric.sparkline.length < 3) continue;

    const r = pearsonCorrelation(target.sparkline, metric.sparkline);
    const strength = Math.abs(r);
    if (strength < minStrength) continue;

    // Build direction description
    const positive = r > 0;
    let direction: string;
    if (positive) {
      direction = `As ${metric.label} increases, ${target.label} also increases`;
    } else {
      direction = `As ${metric.label} increases, ${target.label} decreases`;
    }

    // Build narrative — explain the relationship in business terms
    let narrative: string;
    const strengthLabel = strength >= 0.8 ? "very strong" : strength >= 0.6 ? "strong" : strength >= 0.4 ? "moderate" : "weak";
    if (target.inverted) {
      // Target is "bad when high" (e.g. Error Rate, Latency)
      if (positive) {
        narrative = `${metric.label} shows a ${strengthLabel} positive correlation (r=${r.toFixed(2)}) — when ${metric.label} rises, ${target.label} tends to worsen.`;
      } else {
        narrative = `${metric.label} shows a ${strengthLabel} inverse correlation (r=${r.toFixed(2)}) — higher ${metric.label} is associated with improved ${target.label}.`;
      }
    } else {
      // Target is "good when high" (e.g. Conversions, Apdex)
      if (positive) {
        narrative = `${metric.label} shows a ${strengthLabel} positive correlation (r=${r.toFixed(2)}) — they tend to move together.`;
      } else {
        narrative = `${metric.label} shows a ${strengthLabel} inverse correlation (r=${r.toFixed(2)}) — when ${metric.label} rises, ${target.label} tends to drop.`;
      }
    }

    results.push({ label: metric.label, color: metric.color, r, strength, direction, narrative, sparkline: metric.sparkline });
  }

  // Sort by strength descending
  results.sort((a, b) => b.strength - a.strength);
  return results;
}

// ---------------------------------------------------------------------------
// Context — allows any tab to register its metrics for cross-correlation
// ---------------------------------------------------------------------------
export type MetricsRegistry = MetricEntry[];
export type CorrelationOpener = (target: MetricEntry) => void;
export const CorrelationsContext = React.createContext<{
  registry: MetricsRegistry;
  register: (metrics: MetricEntry[]) => void;
  open: CorrelationOpener;
} | null>(null);

// ---------------------------------------------------------------------------
// Mini Sparkline (for the panel rows)
// ---------------------------------------------------------------------------
function MiniSparkline({ data, color = "#4589FF" }: { data: number[]; color?: string }) {
  const W = 72, H = 22;
  const valid = data.filter(v => v != null && !isNaN(v) && isFinite(v));
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const points = valid.map((v, i) => ({
    x: (i / (valid.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 3) - 1.5,
  }));
  const pts = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", opacity: 0.8 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Strength Bar
// ---------------------------------------------------------------------------
function StrengthBar({ value, positive }: { value: number; positive: boolean }) {
  const GREEN = "#0D9C29";
  const RED = "#C21930";
  const color = positive ? GREEN : RED;
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 100 }}>
      <div style={{ flex: 1, height: 5, background: "rgba(128,128,128,0.15)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 28, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correlations Panel (full-screen overlay like ForecastModal)
// ---------------------------------------------------------------------------
export function CorrelationsPanel({ target, allMetrics, onClose }: {
  target: MetricEntry;
  allMetrics: MetricEntry[];
  onClose: () => void;
}) {
  const [minStrength, setMinStrength] = useState(0.3);
  const correlations = useMemo(() => computeCorrelations(target, allMetrics, minStrength), [target, allMetrics, minStrength]);

  const exportCorrelationsPdf = useCallback(() => {
    const strengthLbl = `${minStrength * 100}%+`;

    const sparklineSvg = (data: number[], color: string) => {
      const W = 72, H = 22;
      const valid = data.filter(v => v != null && !isNaN(v) && isFinite(v));
      if (valid.length < 2) return "";
      const min = Math.min(...valid);
      const max = Math.max(...valid);
      const range = max - min || 1;
      const points = valid.map((v, i) => ({
        x: (i / (valid.length - 1)) * W,
        y: H - ((v - min) / range) * (H - 3) - 1.5,
      }));
      const pts = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const last = points[points.length - 1];
      return `<svg width="${W}" height="${H}" style="display:block;opacity:0.8;flex-shrink:0"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="${color}"/></svg>`;
    };

    const cardsHtml = correlations.map((c, idx) => {
      const pct = Math.round(c.strength * 100);
      const barColor = c.r > 0 ? "#0D9C29" : "#C21930";
      const badgeColor = c.r > 0 ? "#0D9C29" : "#C21930";
      const badgeBg = c.r > 0 ? "rgba(13,156,41,0.12)" : "rgba(194,25,48,0.12)";
      const badgeBorder = c.r > 0 ? "rgba(13,156,41,0.3)" : "rgba(194,25,48,0.3)";
      const borderColor = c.r > 0 ? "rgba(13,156,41,0.6)" : "rgba(194,25,48,0.6)";
      return `<div class="card" style="border-left:3px solid ${borderColor}">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;opacity:0.35;font-weight:600">#${idx + 1}</span>
            <strong style="font-size:13px;color:${c.color ?? "#4589FF"}">${c.label}</strong>
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder}">r = ${c.r > 0 ? "+" : ""}${c.r.toFixed(2)}</span>
          </div>
          ${sparklineSvg(c.sparkline, c.color ?? "#4589FF")}
        </div>
        <div class="strength-bar-wrap">
          <div class="strength-bar-bg"><div class="strength-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <span style="font-size:10px;font-weight:700;color:${barColor};min-width:28px;text-align:right">${pct}%</span>
        </div>
        <div class="direction">${c.direction}</div>
        <div class="narrative">${c.narrative}</div>
      </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Related Metrics — ${target.label}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0e1224;color:#e0e0f0;font-family:'Segoe UI',system-ui,sans-serif;padding:32px;font-size:13px}
@media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;padding:.4in}@page{margin:.5in;size:A4}.no-print{display:none!important}}
.header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:1px solid rgba(128,128,128,.2);padding-bottom:14px}
h1{font-size:18px;font-weight:800;color:#fff;margin-bottom:4px}
.subtitle{font-size:12px;opacity:0.5}
.meta{font-size:11px;opacity:.5;text-align:right}
.card{background:rgba(128,128,128,.05);border:1px solid rgba(128,128,128,.15);border-radius:10px;padding:12px 16px;margin-bottom:10px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.strength-bar-wrap{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.strength-bar-bg{flex:1;height:5px;background:rgba(128,128,128,.15);border-radius:3px;overflow:hidden}
.strength-bar-fill{height:100%;border-radius:3px}
.direction{font-size:11px;opacity:0.6;margin-top:6px}
.narrative{font-size:11px;opacity:0.5;margin-top:2px;font-style:italic}
.legend-box{margin-top:20px;padding:10px 14px;background:rgba(128,128,128,.04);border-radius:8px;border:1px solid rgba(128,128,128,.1)}
.print-btn{margin-top:24px;display:flex;justify-content:center}
button.print-action{padding:8px 24px;background:rgba(69,137,255,.85);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<div class="header-row">
  <div>
    <h1>Related Metrics</h1>
    <div class="subtitle">Metrics correlated with <strong style="color:${target.color ?? "#4589FF"}">${target.label}</strong> &middot; Min strength: ${strengthLbl}</div>
  </div>
  <div class="meta">
    <div>Generated: ${new Date().toLocaleString()}</div>
    <div>${correlations.length} correlation${correlations.length !== 1 ? "s" : ""} found</div>
  </div>
</div>
${correlations.length === 0
  ? `<div style="padding:32px 0;text-align:center;opacity:0.5">No metrics found with correlation strength above ${minStrength * 100}%</div>`
  : cardsHtml}
<div class="legend-box">
  <div style="font-size:10px;opacity:0.4;display:block;margin-bottom:4px">How it works</div>
  <div style="font-size:11px;opacity:0.5">Pearson correlation coefficient (r) measures linear relationship between two time-series sparklines. Values near +1 indicate strong positive co-movement; values near -1 indicate strong inverse movement. A green bar means the metrics move together; a red bar means they move in opposite directions. Relationships with |r| below the threshold are filtered out.</div>
</div>
<div class="print-btn no-print">

</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }, [target, correlations, minStrength]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "rgba(20,24,46,0.97)", border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 16, padding: "28px 32px", maxWidth: 680, width: "90%",
          maxHeight: "85vh", overflowY: "auto",
          boxShadow: "0 16px 64px rgba(0,0,0,0.5)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 16 }}>
          <div>
            <Heading level={4} style={{ margin: 0 }}>Related Metrics</Heading>
            <Text style={{ fontSize: 12, opacity: 0.6 }}>
              Metrics correlated with <Strong style={{ color: target.color ?? "#4589FF" }}>{target.label}</Strong> based on time-series similarity
            </Text>
          </div>
          <button
            onClick={exportCorrelationsPdf}
            style={{
              background: "rgba(69,137,255,0.1)", border: "1px solid rgba(69,137,255,0.35)",
              borderRadius: 8, padding: "6px 14px", color: "#4589FF", cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}
          >
            📄 PDF
          </button>
          <button
            onClick={onClose}
            style={{
              background: "rgba(128,128,128,0.15)", border: "1px solid rgba(128,128,128,0.25)",
              borderRadius: 8, padding: "6px 14px", color: "inherit", cursor: "pointer", fontSize: 13,
            }}
          >
            Close
          </button>
        </Flex>

        {/* Strength filter */}
        <Flex alignItems="center" gap={12} style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 11, opacity: 0.5 }}>Min correlation strength:</Text>
          {[0.3, 0.5, 0.7].map(v => (
            <button
              key={v}
              onClick={() => setMinStrength(v)}
              style={{
                background: minStrength === v ? "rgba(69,137,255,0.2)" : "rgba(128,128,128,0.08)",
                border: `1px solid ${minStrength === v ? "rgba(69,137,255,0.5)" : "rgba(128,128,128,0.2)"}`,
                borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer", color: "inherit",
              }}
            >
              {v * 100}%+
            </button>
          ))}
        </Flex>

        {/* Results */}
        {correlations.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <Text style={{ opacity: 0.5 }}>No metrics found with correlation strength above {minStrength * 100}%</Text>
            <br />
            <Text style={{ fontSize: 12, opacity: 0.4 }}>Try lowering the threshold or ensuring more metrics have sparkline data in the current timeframe.</Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {correlations.map((c, idx) => (
              <div
                key={c.label}
                style={{
                  background: "rgba(128,128,128,0.05)", border: "1px solid rgba(128,128,128,0.15)",
                  borderRadius: 10, padding: "12px 16px",
                  borderLeft: `3px solid ${c.r > 0 ? "rgba(13,156,41,0.6)" : "rgba(194,25,48,0.6)"}`,
                }}
              >
                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 6 }}>
                  <Flex alignItems="center" gap={8}>
                    <span style={{ fontSize: 11, opacity: 0.35, fontWeight: 600 }}>#{idx + 1}</span>
                    <Strong style={{ fontSize: 13, color: c.color ?? "#4589FF" }}>{c.label}</Strong>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 4,
                      background: c.r > 0 ? "rgba(13,156,41,0.12)" : "rgba(194,25,48,0.12)",
                      color: c.r > 0 ? "#0D9C29" : "#C21930",
                      border: `1px solid ${c.r > 0 ? "rgba(13,156,41,0.3)" : "rgba(194,25,48,0.3)"}`,
                    }}>
                      r = {c.r > 0 ? "+" : ""}{c.r.toFixed(2)}
                    </span>
                  </Flex>
                  <MiniSparkline data={c.sparkline} color={c.color ?? "#4589FF"} />
                </Flex>
                <StrengthBar value={c.strength} positive={c.r > 0} />
                <Text style={{ fontSize: 11, opacity: 0.6, marginTop: 6, display: "block" }}>{c.direction}</Text>
                <Text style={{ fontSize: 11, opacity: 0.5, marginTop: 2, display: "block", fontStyle: "italic" }}>{c.narrative}</Text>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div style={{ marginTop: 20, padding: "10px 14px", background: "rgba(128,128,128,0.04)", borderRadius: 8, border: "1px solid rgba(128,128,128,0.1)" }}>
          <Text style={{ fontSize: 10, opacity: 0.4, display: "block", marginBottom: 4 }}>How it works</Text>
          <Text style={{ fontSize: 11, opacity: 0.5, display: "block" }}>
            Pearson correlation coefficient (r) measures linear relationship between two time-series sparklines.
            Values near +1 indicate strong positive co-movement; values near -1 indicate strong inverse movement.
            A green bar means the metrics move together; a red bar means they move in opposite directions.
            Relationships with |r| below the threshold are filtered out.
          </Text>
        </div>
      </div>
    </div>
  );
}
