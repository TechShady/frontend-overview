import React from "react";
import { createPortal } from "react-dom";

// ─── Types & Constants ────────────────────────────────────────────────────────

export interface HotnessCalendarPanelProps {
  heatScores: number[];
  bucketMs: number;
  pos: { x: number; y: number };
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
  getRequeryData: (days: number) => Promise<number[]>;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtHour = (h: number) =>
  h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;

type LevelKey = "nodata" | "baseline" | "low" | "warm" | "hot" | "spike";

const LEVELS: { key: LevelKey; label: string; color: string; min: number | null; tip: string }[] = [
  { key: "nodata",   label: "No Data",  color: "rgba(255,255,255,0.07)", min: null,      tip: "No recorded data for this hour × day slot" },
  { key: "baseline", label: "Baseline", color: "rgba(69,137,255,0.18)",  min: -Infinity, tip: "Normal performance, at or near average (< 0.1\\u03C3)" },
  { key: "low",      label: "Low",      color: "rgba(69,137,255,0.55)",  min: 0.1,       tip: "Slightly elevated (0.1 – 0.75\\u03C3)" },
  { key: "warm",     label: "Warm",     color: "#FFF04D",                min: 0.75,      tip: "Moderately elevated (0.75 – 1.5\\u03C3)" },
  { key: "hot",      label: "Hot",      color: "#FF3D9A",                min: 1.5,       tip: "Significantly elevated (1.5 – 2.5\\u03C3)" },
  { key: "spike",    label: "Spike",    color: "#FF073A",                min: 2.5,       tip: "Critical spike (> 2.5\\u03C3)" },
];

function getLevel(val: number | null): LevelKey {
  if (val === null) return "nodata";
  if (val >= 2.5)  return "spike";
  if (val >= 1.5)  return "hot";
  if (val >= 0.75) return "warm";
  if (val >= 0.1)  return "low";
  return "baseline";
}

function levelColor(key: LevelKey): string {
  return LEVELS.find(l => l.key === key)!.color;
}

// ─── Grid Builder ─────────────────────────────────────────────────────────────

function buildGrid(scores: number[], bucketMs: number): (number | null)[][] {
  const sums  = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const cnts  = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const startMs = Date.now() - scores.length * bucketMs;
  for (let i = 0; i < scores.length; i++) {
    const d = new Date(startMs + i * bucketMs);
    sums[d.getDay()][d.getHours()] += scores[i];
    cnts[d.getDay()][d.getHours()]++;
  }
  return Array.from({ length: 7 }, (_, dow) =>
    HOURS.map(h => cnts[dow][h] > 0 ? sums[dow][h] / cnts[dow][h] : null)
  );
}

// ─── Analysis Engine ──────────────────────────────────────────────────────────

interface HeatAnalysis {
  hotZoneText: string;
  worstDayText: string;
  worstHourText: string;
  hotCellCount: number;
  spikeCellCount: number;
  insights: string[];
  recommendations: string[];
}

function analyzeGrid(grid: (number | null)[][]): HeatAnalysis {
  const hourAvg = HOURS.map(h => {
    const vals = DAYS.map((_, d) => grid[d][h]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  const dayAvg = DAYS.map((_, d) => {
    const vals = HOURS.map(h => grid[d][h]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const worstHourIdx = hourAvg.indexOf(Math.max(...hourAvg));
  const worstDayIdx  = dayAvg.indexOf(Math.max(...dayAvg));
  const hotHours     = HOURS.filter(h => hourAvg[h] >= 0.75);

  let hotZoneText = "No significant hot zone detected";
  if (hotHours.length > 0) {
    const ranges: number[][] = [];
    let cur = [hotHours[0]];
    for (let i = 1; i < hotHours.length; i++) {
      if (hotHours[i] === hotHours[i - 1] + 1) cur.push(hotHours[i]);
      else { ranges.push(cur); cur = [hotHours[i]]; }
    }
    ranges.push(cur);
    const longest = ranges.reduce((a, b) => (b.length > a.length ? b : a));
    hotZoneText = longest.length === 1
      ? `${fmtHour(longest[0])} daily`
      : `${fmtHour(longest[0])}–${fmtHour(longest[longest.length - 1] + 1)} daily`;
  }

  const weekdayMean  = [1, 2, 3, 4, 5].reduce((a, d) => a + dayAvg[d], 0) / 5;
  const weekendMean  = [0, 6].reduce((a, d) => a + dayAvg[d], 0) / 2;
  const hotCellCount   = DAYS.flatMap((_, d) => HOURS.map(h => grid[d][h])).filter(v => v !== null && (v as number) >= 1.5).length;
  const spikeCellCount = DAYS.flatMap((_, d) => HOURS.map(h => grid[d][h])).filter(v => v !== null && (v as number) >= 2.5).length;

  const insights: string[] = [];
  const recs: string[] = [];
  const peakAvg = hourAvg[worstHourIdx];

  if (peakAvg >= 2.5)
    insights.push(`Critical spike zone at ${fmtHour(worstHourIdx)} — average Z-score ${peakAvg.toFixed(1)}\\u03C3 across the week.`);
  else if (peakAvg >= 1.5)
    insights.push(`Consistently hot at ${fmtHour(worstHourIdx)} — average Z-score ${peakAvg.toFixed(1)}\\u03C3 across the week.`);
  else if (peakAvg >= 0.75)
    insights.push(`Warm zone centered at ${fmtHour(worstHourIdx)} — mildly elevated throughout the week.`);
  else
    insights.push("No clearly elevated hour — CWV performance is broadly consistent throughout the day.");

  const safeWeekend = Math.max(weekendMean, 0.01);
  const safeWeekday = Math.max(weekdayMean, 0.01);
  if (weekdayMean > 0.1 && weekdayMean > weekendMean * 1.5) {
    insights.push(`Weekdays are ${((weekdayMean / safeWeekend - 1) * 100).toFixed(0)}% hotter than weekends — typical business-hours traffic pattern.`);
    recs.push("Scale CDN and origin capacity before weekday peak hours. Consider pre-warming caches between 7–9am Monday–Friday.");
  } else if (weekendMean > 0.1 && weekendMean > weekdayMean * 1.5) {
    insights.push(`Weekends are ${((weekendMean / safeWeekday - 1) * 100).toFixed(0)}% hotter than weekdays — possible leisure or batch workload.`);
    recs.push("Review weekend-specific workloads and CDN configurations causing elevated CWV degradation on Saturday–Sunday.");
  } else {
    insights.push(`CWV degradation is consistent across weekdays and weekends (weekday avg: ${weekdayMean.toFixed(2)}\\u03C3, weekend avg: ${weekendMean.toFixed(2)}\\u03C3).`);
  }

  if (spikeCellCount > 0) {
    insights.push(`${spikeCellCount} critical spike cell${spikeCellCount > 1 ? "s" : ""} detected — check for deployment or CDN events.`);
    recs.push(`Investigate the ${spikeCellCount} critical spike window${spikeCellCount > 1 ? "s" : ""} — check deployment logs and CDN events around ${fmtHour(worstHourIdx)} on ${DAYS[worstDayIdx]}.`);
  }
  if (hotHours.length > 0) {
    recs.push(`Pre-warm caches and CDN before ${fmtHour(hotHours[0])} — elevated CWV window runs ${fmtHour(hotHours[0])}–${fmtHour(hotHours[hotHours.length - 1] + 1)}.`);
  }
  if (hotCellCount > 48) {
    insights.push(`${hotCellCount} hot/spike cells out of 168 (${Math.round(hotCellCount / 168 * 100)}%) — widespread CWV degradation.`);
    recs.push("High proportion of hot hours suggests a systemic issue with LCP/INP/CLS. Review render-blocking resources, image optimization, and third-party scripts.");
  }
  if (recs.length === 0) recs.push("No significant action needed — CWV performance looks healthy across the week.");

  return {
    hotZoneText,
    worstDayText:  `${DAYS[worstDayIdx]} (avg ${dayAvg[worstDayIdx].toFixed(2)}\\u03C3)`,
    worstHourText: `${fmtHour(worstHourIdx)} (avg ${hourAvg[worstHourIdx].toFixed(2)}\\u03C3)`,
    hotCellCount, spikeCellCount, insights, recommendations: recs,
  };
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function exportHeatmapPdf(grid: (number | null)[][], analysis: HeatAnalysis) {
  const ts = new Date().toLocaleString();
  const cellTd = (val: number | null) => {
    const col = levelColor(getLevel(val));
    return `<td style="width:44px;height:17px;background:${col};border-radius:3px;border:1px solid rgba(255,255,255,0.04)"></td>`;
  };
  const legend = LEVELS.map(l =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${l.color};border:1px solid rgba(255,255,255,0.12)"></span><span style="font-size:10px;opacity:0.65">${l.label}</span></span>`
  ).join("");
  const insHtml = analysis.insights.map(s => `<div style="margin-bottom:5px;padding:7px 11px;background:rgba(128,128,128,0.07);border-radius:6px;font-size:12px;line-height:1.5">💡 ${s}</div>`).join("");
  const recHtml = analysis.recommendations.map(s => `<div style="margin-bottom:5px;padding:7px 11px;background:rgba(69,137,255,0.07);border:1px solid rgba(69,137,255,0.15);border-radius:6px;font-size:12px;line-height:1.5">→ ${s}</div>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hotness Heatmap — Frontend Overview</title>
<style>
  @media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}@page{margin:.6in;size:A4}.pb{page-break-before:always}}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1223;color:#e8eaf0;margin:0;padding:24px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 10px}
  table{border-collapse:separate;border-spacing:2px}
</style></head><body>
<h1>🗓 Hotness Heatmap — Frontend Overview</h1>
<div style="font-size:11px;opacity:0.4;margin-bottom:18px">Generated ${ts} · 7-day view (Sun–Sat, 12am–11pm)</div>
<table>
  <tr><td style="width:34px"></td>${DAYS.map(d => `<td style="text-align:center;font-size:10px;font-weight:700;padding-bottom:4px;opacity:0.55">${d}</td>`).join("")}</tr>
  ${HOURS.map(h => `<tr><td style="width:34px;text-align:right;padding-right:5px;font-size:9px;opacity:0.45;white-space:nowrap">${fmtHour(h)}</td>${DAYS.map((_, d) => cellTd(grid[d][h])).join("")}</tr>`).join("")}
</table>
<div style="margin:14px 0 24px">${legend}</div>
<div class="pb"></div>
<h2>Heatmap Analysis</h2>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">
  <div style="background:rgba(255,7,58,0.08);border:1px solid rgba(255,7,58,0.25);border-radius:8px;padding:10px 13px">
    <div style="font-size:9px;opacity:0.5;text-transform:uppercase;margin-bottom:3px">Hot Zone</div>
    <div style="font-size:13px;font-weight:700;color:#FF3D9A">${analysis.hotZoneText}</div>
  </div>
  <div style="background:rgba(255,131,43,0.08);border:1px solid rgba(255,131,43,0.25);border-radius:8px;padding:10px 13px">
    <div style="font-size:9px;opacity:0.5;text-transform:uppercase;margin-bottom:3px">Worst Hour</div>
    <div style="font-size:13px;font-weight:700;color:#FF832B">${analysis.worstHourText}</div>
  </div>
  <div style="background:rgba(255,240,77,0.08);border:1px solid rgba(255,240,77,0.25);border-radius:8px;padding:10px 13px">
    <div style="font-size:9px;opacity:0.5;text-transform:uppercase;margin-bottom:3px">Worst Day</div>
    <div style="font-size:13px;font-weight:700;color:#FFF04D">${analysis.worstDayText}</div>
  </div>
</div>
<h2>Insights</h2>${insHtml}
<h2>Recommendations</h2>${recHtml}
<div style="margin-top:28px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.07);font-size:10px;opacity:0.3">Hotness Heatmap · Frontend Overview</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HotnessCalendarPanel({ heatScores, bucketMs, pos, onDragStart, onClose, getRequeryData }: HotnessCalendarPanelProps) {
  const [scores, setScores]             = React.useState<number[]>(heatScores);
  const [loading, setLoading]           = React.useState(true);
  const [hover, setHover]               = React.useState<{ dow: number; hour: number; val: number | null } | null>(null);
  const [filterLevel, setFilterLevel]   = React.useState<LevelKey | null>(null);
  const [showAnalysis, setShowAnalysis] = React.useState(false);
  const [panelH, setPanelH] = React.useState(520);
  const hmResizeRef = React.useRef<{ startY: number; startH: number } | null>(null);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!hmResizeRef.current) return;
      const dy = e.clientY - hmResizeRef.current.startY;
      setPanelH(Math.max(350, hmResizeRef.current.startH + dy));
    };
    const onUp = () => { hmResizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  React.useEffect(() => {
    setLoading(true);
    getRequeryData(7)
      .then(data => { if (data.length > 0) setScores(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grid     = React.useMemo(() => buildGrid(scores, bucketMs), [scores, bucketMs]);
  const analysis = React.useMemo(() => showAnalysis ? analyzeGrid(grid) : null, [grid, showAnalysis]);

  const toggleFilter = (key: LevelKey) => setFilterLevel(prev => prev === key ? null : key);
  const cellOpacity  = (key: LevelKey) => filterLevel ? (key === filterLevel ? 1 : 0.1) : 1;

  const CELL_W = 28, CELL_H = 14, GAP = 2, LEFT_PAD = 42;
  const panelW = LEFT_PAD + 7 * (CELL_W + GAP) + 48;

  return createPortal(
    <div style={{
      position: "fixed", left: pos.x, top: pos.y, zIndex: 9001,
      background: "linear-gradient(135deg, #0f1117 0%, #131720 100%)",
      border: "1px solid rgba(69,137,255,0.3)", borderRadius: 12,
      boxShadow: "0 8px 40px rgba(0,0,0,0.7)", width: panelW,
      userSelect: "none", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#e8eaf0",
      height: panelH, display: "flex", flexDirection: "column" as const,
    }}>
      {/* Header */}
      <div onMouseDown={onDragStart} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px 10px", cursor: "grab", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ fontSize: 15 }}>📅</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Hotness Heatmap</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {loading ? "Loading 7-day window…" : "Hour-of-day × Day-of-week · 7-day view"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button
            onClick={() => exportHeatmapPdf(grid, analysis ?? analyzeGrid(grid))}
            style={{ fontSize: 10, padding: "3px 9px", background: "rgba(69,137,255,0.1)", border: "1px solid rgba(69,137,255,0.3)", borderRadius: 5, color: "#4589FF", cursor: "pointer", fontWeight: 600 }}
            title="Export heatmap as PDF"
          >PDF</button>
          <button
            onClick={() => setShowAnalysis(p => !p)}
            style={{ fontSize: 10, padding: "3px 9px", background: showAnalysis ? "rgba(255,61,154,0.15)" : "rgba(128,128,128,0.08)", border: `1px solid ${showAnalysis ? "rgba(255,61,154,0.4)" : "rgba(128,128,128,0.2)"}`, borderRadius: 5, color: showAnalysis ? "#FF3D9A" : "#ccc", cursor: "pointer", fontWeight: 600 }}
            title="Analyze heatmap patterns"
          >{showAnalysis ? "▲ Analyze" : "▼ Analyze"}</button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "13px 14px 12px", overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 32, fontSize: 13 }}>Loading 7 days of data…</div>
        ) : (
          <>
            <div style={{ display: "flex", marginLeft: LEFT_PAD, marginBottom: 4, gap: GAP }}>
              {DAYS.map(d => <div key={d} style={{ width: CELL_W, textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>{d}</div>)}
            </div>

            {HOURS.map(h => (
              <div key={h} style={{ display: "flex", alignItems: "center", marginBottom: GAP, gap: GAP }}>
                <div style={{ width: LEFT_PAD - GAP, textAlign: "right", paddingRight: 6, fontSize: 9, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{fmtHour(h)}</div>
                {DAYS.map((_, dow) => {
                  const val = grid[dow][h];
                  const key = getLevel(val);
                  const isHov = hover?.dow === dow && hover?.hour === h;
                  return (
                    <div key={dow} style={{ width: CELL_W, height: CELL_H, borderRadius: 3, background: levelColor(key), opacity: cellOpacity(key), border: isHov ? "1px solid rgba(255,255,255,0.6)" : "1px solid transparent", boxSizing: "border-box", cursor: "default", transition: "opacity 0.12s ease, border 0.1s" }}
                      onMouseEnter={() => setHover({ dow, hour: h, val })} onMouseLeave={() => setHover(null)} />
                  );
                })}
              </div>
            ))}

            <div style={{ height: 22, marginTop: 5, fontSize: 11, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>
              {hover ? (hover.val !== null ? `${DAYS[hover.dow]} ${fmtHour(hover.hour)} — avg Z-score: ${hover.val.toFixed(2)}\\u03C3` : `${DAYS[hover.dow]} ${fmtHour(hover.hour)} — no data`) : "Hover a cell to see average hotness"}
            </div>

            {/* Clickable legend */}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {LEVELS.map(({ key, label, color, tip }) => (
                <div key={key} onClick={() => toggleFilter(key)} title={tip} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", padding: "3px 7px", borderRadius: 5, background: filterLevel === key ? "rgba(255,255,255,0.09)" : "transparent", border: filterLevel === key ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent", transition: "all 0.12s ease" }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
                  <span style={{ fontSize: 9, opacity: filterLevel && filterLevel !== key ? 0.35 : 0.75, fontWeight: filterLevel === key ? 700 : 400 }}>{label}</span>
                </div>
              ))}
              {filterLevel && <div onClick={() => setFilterLevel(null)} style={{ fontSize: 9, opacity: 0.45, cursor: "pointer", alignSelf: "center", padding: "3px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)" }}>✕ Clear</div>}
            </div>

            {/* Analysis section */}
            {showAnalysis && analysis && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 12 }}>
                  <div style={{ background: "rgba(255,7,58,0.07)", border: "1px solid rgba(255,7,58,0.2)", borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 9, opacity: 0.5, textTransform: "uppercase" as const, marginBottom: 2, letterSpacing: "0.04em" }}>Hot Zone</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF3D9A" }}>{analysis.hotZoneText}</div>
                  </div>
                  <div style={{ background: "rgba(255,131,43,0.07)", border: "1px solid rgba(255,131,43,0.2)", borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 9, opacity: 0.5, textTransform: "uppercase" as const, marginBottom: 2, letterSpacing: "0.04em" }}>Worst Hour</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF832B" }}>{analysis.worstHourText}</div>
                  </div>
                  <div style={{ background: "rgba(255,240,77,0.07)", border: "1px solid rgba(255,240,77,0.2)", borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 9, opacity: 0.5, textTransform: "uppercase" as const, marginBottom: 2, letterSpacing: "0.04em" }}>Worst Day</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FFF04D" }}>{analysis.worstDayText}</div>
                  </div>
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const, opacity: 0.4, marginBottom: 5, letterSpacing: "0.06em" }}>Insights</div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, marginBottom: 10 }}>
                  {analysis.insights.map((ins, i) => <div key={i} style={{ fontSize: 11, padding: "5px 9px", background: "rgba(128,128,128,0.05)", border: "1px solid rgba(128,128,128,0.1)", borderRadius: 5, lineHeight: 1.5 }}>💡 {ins}</div>)}
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const, opacity: 0.4, marginBottom: 5, letterSpacing: "0.06em" }}>Recommendations</div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                  {analysis.recommendations.map((rec, i) => <div key={i} style={{ fontSize: 11, padding: "5px 9px", background: "rgba(69,137,255,0.05)", border: "1px solid rgba(69,137,255,0.13)", borderRadius: 5, lineHeight: 1.5 }}>→ {rec}</div>)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Height resize handle */}
      <div
        onMouseDown={e => {
          e.stopPropagation();
          hmResizeRef.current = { startY: e.clientY, startH: panelH };
        }}
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: "ns-resize",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "3px",
          zIndex: 1,
        }}
      >
        <svg width="10" height="6" viewBox="0 0 10 6" style={{ opacity: 0.3 }}>
          <line x1="0" y1="2" x2="10" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    </div>,
    document.body
  );
}
