import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DimSlice { name: string; value: number; avg?: number; unit?: string; }

export interface DimensionModalProps {
  label: string;
  color?: string;
  onClose: () => void;
  fetchGeo?: (pct: string) => Promise<DimSlice[]>;
  fetchBrowser?: (pct: string) => Promise<DimSlice[]>;
}

const GEO_COLORS     = ["#4589FF", "#23A5D0", "#3FA66C", "#A66C3F", "#8B5CF6", "#64748B", "#F59E0B", "#EC4899"];
const BROWSER_COLORS = ["#FF6B35", "#4ECDC4", "#45B7D1", "#96CEB4", "#B0B0B0", "#F59E0B"];

const PCT_OPTIONS = ["P50", "P75", "P90", "P95", "P99"] as const;
type PctOption = typeof PCT_OPTIONS[number];

function formatAvg(avg: number, unit?: string): string {
  if (unit === "s") return avg >= 1 ? `${avg.toFixed(2)} s` : `${(avg * 1000).toFixed(0)} ms`;
  if (unit === "%") return `${avg.toFixed(1)}%`;
  return avg.toFixed(2);
}

// ─── SVG Pie Chart ────────────────────────────────────────────────────────────

function PieChart({ data, title, colors, pct }: { data: DimSlice[]; title: string; colors: string[]; pct: PctOption }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{ opacity: 0.4, fontSize: 12, textAlign: "center", padding: 32 }}>No data</div>;

  const R = 78, Rh = 84;
  const cx = 92, cy = 92;
  let startAngle = -Math.PI / 2;

  const hasAvg = data.some(d => d.avg != null);

  const slices = data.map((d, i) => {
    const angle = (d.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    const r = hovered === i ? Rh : R;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
    const pctShare = (d.value / total) * 100;
    const result = { path, color: colors[i % colors.length], slice: d, pct: pctShare };
    startAngle = endAngle;
    return result;
  });

  const hovSlice = hovered !== null ? slices[hovered] : null;

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.45, textTransform: "uppercase" as const, marginBottom: 12, letterSpacing: "0.06em" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
        <svg width={184} height={184} style={{ flexShrink: 0, overflow: "visible" }}>
          {slices.map((s, i) => (
            <path
              key={i}
              d={s.path}
              fill={s.color}
              stroke="#151829"
              strokeWidth={hovered === i ? 2 : 1.5}
              style={{ cursor: "pointer", transition: "all 0.15s ease" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
          {/* Center hole */}
          <circle cx={cx} cy={cy} r={34} fill="#151829" />
          {hovSlice && (
            <>
              <text x={cx} y={cy - (hovSlice.slice.avg != null ? 9 : 5)} textAnchor="middle" fontSize={hovSlice.slice.avg != null ? 9 : 11} fill="#e8eaf0" fontWeight={700}>
                {hovSlice.slice.avg != null ? formatAvg(hovSlice.slice.avg, hovSlice.slice.unit) : `${hovSlice.pct.toFixed(1)}%`}
              </text>
              {hovSlice.slice.avg != null && (
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={8} fill="rgba(232,234,240,0.45)">{hovSlice.pct.toFixed(1)}%</text>
              )}
              <text x={cx} y={cx + (hovSlice.slice.avg != null ? 14 : 10)} textAnchor="middle" fontSize={8} fill="rgba(232,234,240,0.5)">
                {hovSlice.slice.name.length > 13 ? hovSlice.slice.name.slice(0, 12) + "…" : hovSlice.slice.name}
              </text>
            </>
          )}
        </svg>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, paddingTop: 4, flex: 1, minWidth: 0 }}>
          {hasAvg && (
            <div style={{ fontSize: 9, opacity: 0.4, marginBottom: 2, fontWeight: 600, letterSpacing: "0.04em" }}>
              {pct} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; SHARE
            </div>
          )}
          {slices.map((s, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", opacity: hovered !== null && hovered !== i ? 0.35 : 1, transition: "opacity 0.12s" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, opacity: 0.85, flex: 1, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{s.slice.name}</span>
              {s.slice.avg != null && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#e8eaf0", flexShrink: 0 }}>{formatAvg(s.slice.avg, s.slice.unit)}</span>
              )}
              <span style={{ fontSize: 10, opacity: 0.45, fontWeight: 600, flexShrink: 0, minWidth: 30, textAlign: "right" as const }}>{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Fallback Data ─────────────────────────────────────────────────────────────

const DEFAULT_GEO: DimSlice[] = [
  { name: "United States", value: 38 },
  { name: "United Kingdom", value: 17 },
  { name: "Germany", value: 14 },
  { name: "France", value: 9 },
  { name: "Canada", value: 8 },
  { name: "Australia", value: 6 },
  { name: "Other", value: 8 },
];

const DEFAULT_BROWSER: DimSlice[] = [
  { name: "Chrome", value: 57 },
  { name: "Safari", value: 23 },
  { name: "Firefox", value: 10 },
  { name: "Edge", value: 8 },
  { name: "Other", value: 2 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function DimensionModal({ label, color, onClose, fetchGeo, fetchBrowser }: DimensionModalProps) {
  const [geoData, setGeoData]         = useState<DimSlice[]>([]);
  const [browserData, setBrowserData] = useState<DimSlice[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedPct, setSelectedPct] = useState<PctOption>("P50");

  const fetchGeoRef     = useRef(fetchGeo);
  const fetchBrowserRef = useRef(fetchBrowser);
  fetchGeoRef.current     = fetchGeo;
  fetchBrowserRef.current = fetchBrowser;

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchGeoRef.current     ? fetchGeoRef.current(selectedPct)     : Promise.resolve(DEFAULT_GEO),
      fetchBrowserRef.current ? fetchBrowserRef.current(selectedPct) : Promise.resolve(DEFAULT_BROWSER),
    ])
      .then(([geo, browser]) => {
        if (!active) return;
        setGeoData(geo.length     ? geo     : DEFAULT_GEO);
        setBrowserData(browser.length ? browser : DEFAULT_BROWSER);
      })
      .catch(() => { if (active) { setGeoData(DEFAULT_GEO); setBrowserData(DEFAULT_BROWSER); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedPct]);

  const exportDimensionPdf = useCallback(() => {
    const pieSvg = (data: DimSlice[], colors: string[]) => {
      const total = data.reduce((s, d) => s + d.value, 0);
      if (!total) return `<p style="opacity:0.4;font-size:12px;text-align:center;padding:32px">No data</p>`;
      const R = 78, cx = 92, cy = 92;
      let startAngle = -Math.PI / 2;
      const paths = data.map((d, i) => {
        const angle = (d.value / total) * Math.PI * 2;
        const endAngle = startAngle + angle;
        const x1 = cx + R * Math.cos(startAngle);
        const y1 = cy + R * Math.sin(startAngle);
        const x2 = cx + R * Math.cos(endAngle);
        const y2 = cy + R * Math.sin(endAngle);
        const largeArc = angle > Math.PI ? 1 : 0;
        const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
        startAngle = endAngle;
        return `<path d="${path}" fill="${colors[i % colors.length]}" stroke="#151829" stroke-width="1.5"/>`;
      }).join("");
      return `<svg width="184" height="184" style="flex-shrink:0">${paths}<circle cx="${cx}" cy="${cy}" r="34" fill="#151829"/></svg>`;
    };

    const legendRows = (data: DimSlice[], colors: string[]) => {
      const total = data.reduce((s, d) => s + d.value, 0);
      return data.map((d, i) => {
        const pct = total ? ((d.value / total) * 100).toFixed(1) : "0.0";
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${colors[i % colors.length]};flex-shrink:0"></span>
          <span style="font-size:11px;flex:1;opacity:0.85">${d.name}</span>
          ${d.avg != null ? `<span style="font-size:10px;font-weight:700">${formatAvg(d.avg, d.unit)}</span>` : ""}
          <span style="font-size:10px;opacity:0.45;font-weight:600;min-width:30px;text-align:right">${pct}%</span>
        </div>`;
      }).join("");
    };

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Dimension Breakdown — ${label}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#151829;color:#e8eaf0;font-family:'Segoe UI',system-ui,sans-serif;padding:32px;font-size:13px}
@media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;padding:.4in}@page{margin:.5in;size:A4 landscape}.no-print{display:none!important}}
.header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:16px}
h1{font-size:16px;font-weight:800;margin-bottom:3px}
.subtitle{font-size:11px;opacity:0.4}
.meta{font-size:11px;opacity:.4;text-align:right}
.charts{display:grid;grid-template-columns:1fr 1px 1fr;gap:28px;align-items:start}
.chart-block{display:flex;align-items:flex-start;gap:16px}
.chart-title{font-size:10px;font-weight:700;opacity:0.45;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px}
.divider{background:rgba(255,255,255,.07);min-height:200px}
.footer{margin-top:20px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;opacity:0.3;text-align:right}
.print-btn{margin-top:24px;display:flex;justify-content:center}
button.print-action{padding:8px 24px;background:rgba(69,137,255,.85);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<div class="header-row">
  <div>
    <h1>🌍 Dimension Breakdown</h1>
    <div class="subtitle"><span style="color:${color ?? "#4589FF"};font-weight:700">${label}</span> &ensp;&middot;&ensp; Geographic &amp; Browser distribution &middot; ${selectedPct} &middot; last 7 days</div>
  </div>
  <div class="meta">Generated: ${new Date().toLocaleString()}</div>
</div>
<div class="charts">
  <div>
    <div class="chart-title">GEO breakdown (country)</div>
    <div class="chart-block">
      ${pieSvg(geoData, GEO_COLORS)}
      <div style="padding-top:4px;flex:1">${legendRows(geoData, GEO_COLORS)}</div>
    </div>
  </div>
  <div class="divider"></div>
  <div>
    <div class="chart-title">Browser breakdown</div>
    <div class="chart-block">
      ${pieSvg(browserData, BROWSER_COLORS)}
      <div style="padding-top:4px;flex:1">${legendRows(browserData, BROWSER_COLORS)}</div>
    </div>
  </div>
</div>
<div class="footer">Dimension Breakdown &middot; Frontend Overview</div>
<div class="print-btn no-print">

</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }, [label, color, geoData, browserData, selectedPct]);

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)" }} onClick={onClose} />
      <div style={{
        position: "relative",
        background: "#151829",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        padding: "26px 32px",
        width: 820,
        maxWidth: "95vw",
        boxShadow: "0 28px 70px rgba(0,0,0,0.6)",
        fontFamily: "'Segoe UI',system-ui,sans-serif",
        color: "#e8eaf0",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              <span style={{ marginRight: 8 }}>🌍</span>Dimension Breakdown
            </div>
            <div style={{ fontSize: 11, opacity: 0.4, marginTop: 3 }}>
              <span style={{ color: color ?? "#4589FF", fontWeight: 700 }}>{label}</span>
              &ensp;&middot;&ensp;Geographic &amp; Browser distribution &middot; last 7 days
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: 3 }}>
              {PCT_OPTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPct(p)}
                  style={{
                    padding: "3px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: selectedPct === p ? (color ?? "#4589FF") : "transparent",
                    color: selectedPct === p ? "#fff" : "rgba(232,234,240,0.45)",
                    letterSpacing: "0.02em",
                    transition: "all 0.15s",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={exportDimensionPdf}
              style={{ background: "rgba(69,137,255,0.1)", border: "1px solid rgba(69,137,255,0.35)", borderRadius: 6, padding: "5px 12px", color: "#4589FF", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              📄 PDF
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "inherit", fontSize: 18, cursor: "pointer", opacity: 0.35, padding: "4px 8px", lineHeight: 1 }}
            >&#x2715;</button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "48px 0", opacity: 0.45, fontSize: 13 }}>Loading dimension data&hellip;</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: 28, alignItems: "start" }}>
            <PieChart data={geoData} title="GEO breakdown (country)" colors={GEO_COLORS} pct={selectedPct} />
            <div style={{ background: "rgba(255,255,255,0.07)", height: "100%", minHeight: 200 }} />
            <PieChart data={browserData} title="Browser breakdown" colors={BROWSER_COLORS} pct={selectedPct} />
          </div>
        )}

        <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, opacity: 0.3, textAlign: "right" }}>
          Dimension Breakdown &middot; Frontend Overview
        </div>
      </div>
    </div>,
    document.body
  );
}
