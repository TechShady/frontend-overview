import React, { useMemo, useRef, useState, useCallback } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webVitalsPerAppQuery } from "../queries";
import { computeAppScore } from "../scoring";
import { gradeFromScore } from "../components/GradeBadge";
import { fmt } from "../components/layout";

// ---------------------------------------------------------------------------
// Opportunity Matrix — full-width responsive scatter.
// X axis: session volume (sqrt-scaled).  Y axis: composite score 0–100.
// Four equal-area quadrants split at score = 50 and sqrt-midpoint of traffic.
// Scroll to zoom · drag to pan · zoom ≥ 2.5× reveals app labels.
// ---------------------------------------------------------------------------

const BLUE   = "#4589FF";  // upper-left  — Maintain
const GREEN  = "#0D9C29";  // upper-right — Protect
const YELLOW = "#F9A825";  // lower-left  — Monitor
const RED    = "#C21930";  // lower-right — Fix First

// SVG coordinate space (internal, scales to 100% container width)
const VW = 1000, VH = 480;
const PL = 58, PR = 20, PT = 46, PB = 56;
const IW = VW - PL - PR;
const IH = VH - PT - PB;
// Equal-quadrant pivots (fixed, not median-based)
const SCORE_SPLIT = 50;                    // y: fixed score threshold
const X_MID = PL + IW / 2;               // x: center of chart
const Y_MID = PT + IH - (SCORE_SPLIT / 100) * IH;  // y: yScale(50)

const LABEL_ZOOM_THRESHOLD = 2.5;

interface Vp { tx: number; ty: number; zoom: number; }
interface Tip {
  x: number; y: number;
  app: string; score: number; sessions: number;
  quadrant: string; color: string;
  letter: string; letterColor: string;
}

const MIN_PRESETS = [
  { label: "All",  value: 0     },
  { label: "100+", value: 100   },
  { label: "1K+",  value: 1000  },
  { label: "10K+", value: 10000 },
];

const LEGEND = [
  { label: "Protect — high traffic, high score",  color: GREEN  },
  { label: "Maintain — low traffic, high score",  color: BLUE   },
  { label: "Fix First — high traffic, low score", color: RED    },
  { label: "Monitor — low traffic, low score",    color: YELLOW },
];

function chipStyle(active: boolean, color = BLUE) {
  return {
    padding: "3px 11px", borderRadius: 12, border: "1px solid",
    fontSize: 11, cursor: "pointer", fontWeight: 600, transition: "all 0.12s",
    borderColor: active ? color : "rgba(128,128,128,0.25)",
    background:  active ? `${color}18` : "transparent",
    color:       active ? color : "inherit",
  } as React.CSSProperties;
}

export const OpportunityMatrixTab: React.FC = () => {
  const { timeframeDays, webAppFilter, gradeWeights } = useSettings();
  const sel = webAppFilter.selected;

  const sum    = useDql(webAppSummaryQuery(timeframeDays, sel),   [timeframeDays, sel]);
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);

  const [showLabels,  setShowLabels]  = useState(false);
  const [minSessions, setMinSessions] = useState(0);
  const [tooltip,     setTooltip]     = useState<Tip | null>(null);
  const [vp,          setVp]          = useState<Vp>({ tx: 0, ty: 0, zoom: 1 });
  const [dragState,   setDragState]   = useState<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  // Zoom toward the chart centre (used by +/− buttons)
  const zoomTo = useCallback((target: number) => {
    const newZoom = Math.max(1, Math.min(12, target));
    setVp(prev => {
      const s  = newZoom / prev.zoom;
      const mx = X_MID;
      const my = PT + IH / 2;
      return { zoom: newZoom, tx: mx - s * (mx - prev.tx), ty: my - s * (my - prev.ty) };
    });
  }, []);

  // Build scored rows
  const allScored = useMemo(() => {
    const vByApp: Record<string, any> = {};
    (vitals.data?.records ?? []).forEach((r: any) => { vByApp[String(r.application ?? "")] = r; });
    return (sum.data?.records ?? []).map((r: any) => {
      const app = String(r.application ?? "");
      const v   = vByApp[app] || {};
      const summary = {
        application: app,
        sessions: Number(r.sessions ?? 0), users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0), errors: Number(r.errors ?? 0),
        avgDuration: Number(r.avgDuration ?? 0), apdex: Number(r.apdex ?? 0),
        satisfied: Number(r.satisfied ?? 0), tolerating: Number(r.tolerating ?? 0),
        frustrated: Number(r.frustrated ?? 0), errorRate: Number(r.errorRate ?? 0),
        bounceRate: 0, newUsers: 0, bounces: 0,
      };
      const vitalsRow = {
        application: app,
        lcpAvg: Number(v.lcpAvg ?? NaN), inpAvg: Number(v.inpAvg ?? NaN),
        clsAvg: Number(v.clsAvg ?? NaN), ttfbAvg: Number(v.ttfbAvg ?? NaN),
        fcpAvg: Number(v.fcpAvg ?? NaN), loadEndAvg: Number(v.loadEndAvg ?? NaN),
      };
      const { score } = computeAppScore(vitalsRow, summary, gradeWeights);
      return { summary, score };
    });
  }, [sum.data, vitals.data, gradeWeights]);

  const rows = useMemo(
    () => allScored
      .filter(r => isFinite(r.score) && r.summary.sessions >= Math.max(1, minSessions))
      .sort((a, b) => a.summary.sessions - b.summary.sessions),   // small → large so big dots render on top
    [allScored, minSessions]
  );

  const loading = sum.loading || vitals.loading;

  // Scales
  const maxSess = Math.max(...rows.map(r => r.summary.sessions), 1);
  // sessThreshold: value that maps to X_MID on sqrt scale → maxSess × 0.25
  const sessThreshold = maxSess * 0.25;

  const xS = (s: number) => PL + (Math.sqrt(Math.max(0, s)) / Math.sqrt(maxSess)) * IW;
  const yS = (sc: number) => PT + IH - (Math.max(0, Math.min(100, sc)) / 100) * IH;

  function quad(sessions: number, score: number): { label: string; color: string } {
    const right = sessions >= sessThreshold;
    const top   = score   >= SCORE_SPLIT;
    if (!right &&  top) return { label: "Maintain",  color: BLUE   };
    if ( right &&  top) return { label: "Protect",   color: GREEN  };
    if (!right && !top) return { label: "Monitor",   color: YELLOW };
    return                    { label: "Fix First",  color: RED    };
  }

  const fixFirst = useMemo(() => rows
    .filter(r => r.summary.sessions >= sessThreshold && r.score < SCORE_SPLIT)
    .sort((a, b) => (b.summary.sessions * (SCORE_SPLIT - b.score)) - (a.summary.sessions * (SCORE_SPLIT - a.score))),
    [rows, sessThreshold]
  );

  const showLabelNow = showLabels && vp.zoom >= LABEL_ZOOM_THRESHOLD;
  const isDragging   = dragState !== null;

  // Pan handlers
  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    setDragState({ sx: e.clientX, sy: e.clientY, tx0: vp.tx, ty0: vp.ty });
    setTooltip(null);
  };
  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = VW / rect.width;
    setVp(prev => ({
      ...prev,
      tx: dragState.tx0 + (e.clientX - dragState.sx) * scale,
      ty: dragState.ty0 + (e.clientY - dragState.sy) * scale,
    }));
  };
  const onSvgMouseUp   = () => setDragState(null);
  const onSvgLeave     = () => { setDragState(null); setTooltip(null); };

  const onDotEnter = (e: React.MouseEvent<SVGCircleElement>, r: typeof rows[0]) => {
    if (isDragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { label, color } = quad(r.summary.sessions, r.score);
    const g = gradeFromScore(r.score);
    setTooltip({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      app: r.summary.application, score: r.score, sessions: r.summary.sessions,
      quadrant: label, color, letter: g.letter, letterColor: g.color,
    });
  };

  if (loading && rows.length === 0) {
    return <div style={{ padding: 56, textAlign: "center", opacity: 0.45 }}>Loading…</div>;
  }
  if (rows.length < 2) {
    return <div style={{ padding: 56, textAlign: "center", opacity: 0.6 }}>Not enough data.{minSessions > 0 && " Try lowering the min sessions filter."}</div>;
  }

  const groupXform = `translate(${vp.tx},${vp.ty}) scale(${vp.zoom})`;

  const tooltipW = containerRef.current?.offsetWidth ?? 9999;

  return (
    <div style={{ padding: "12px 0 28px" }}>

      {/* ── Header ── */}
      <div style={{ padding: "0 8px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.1 }}>Opportunity Matrix</div>
          <div style={{ fontSize: 12, opacity: 0.45, marginTop: 3 }}>
            Traffic volume (x) vs composite score (y) · use +/− to zoom · drag to pan{showLabels ? ` · zoom ${LABEL_ZOOM_THRESHOLD}× for labels` : ""}
          </div>
          {/* Score formula breakdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontSize: 10, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.6, whiteSpace: "nowrap" }}>Score =</span>
            {[
              { label: "Apdex",      weight: gradeWeights.apdex,     tip: "Satisfied/(Sat+Tol+Fru) · 3s/12s thresholds. Mapped 0.5→0, 0.94→100." },
              { label: "Error rate", weight: gradeWeights.errorRate,  tip: "% actions with errors. ≤0.5% → 100, ≥5% → 0." },
              { label: "LCP",        weight: gradeWeights.lcp,        tip: "Largest Contentful Paint. ≤2.5 s → 100, ≥4 s → 0." },
              { label: "INP",        weight: gradeWeights.inp,        tip: "Interaction to Next Paint. ≤200 ms → 100, ≥500 ms → 0." },
              { label: "CLS",        weight: gradeWeights.cls,        tip: "Cumulative Layout Shift. ≤0.1 → 100, ≥0.25 → 0." },
              { label: "TTFB",       weight: gradeWeights.ttfb,       tip: "Time to First Byte. ≤800 ms → 100, ≥1800 ms → 0." },
            ].map((f, i, arr) => (
              <React.Fragment key={f.label}>
                <div title={f.tip} style={{
                  display: "flex", alignItems: "baseline", gap: 3,
                  fontSize: 11, padding: "2px 8px", borderRadius: 10,
                  background: "rgba(128,128,128,0.1)",
                  border: "1px solid rgba(128,128,128,0.18)",
                  cursor: "default", whiteSpace: "nowrap",
                }}>
                  <span style={{ opacity: 0.65 }}>{f.label}</span>
                  <span style={{ fontWeight: 800, opacity: 0.9 }}>{f.weight}%</span>
                </div>
                {i < arr.length - 1 && <span style={{ fontSize: 10, opacity: 0.25 }}>+</span>}
              </React.Fragment>
            ))}
            <span style={{ fontSize: 10, opacity: 0.28, marginLeft: 2 }}>· adjustable in Settings</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, opacity: 0.4, whiteSpace: "nowrap" }}>Min sessions:</span>
          {MIN_PRESETS.map(p => (
            <button key={p.value} onClick={() => { setMinSessions(p.value); setVp({ tx: 0, ty: 0, zoom: 1 }); }} style={chipStyle(minSessions === p.value)}>
              {p.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: "rgba(128,128,128,0.2)", margin: "0 2px" }} />
          <button onClick={() => setShowLabels(v => !v)} style={chipStyle(showLabels)}>
            Labels {showLabels ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* ── Chart ── */}
      <div
        ref={containerRef}
        style={{
          position: "relative", width: "100%",
          borderTop: "1px solid rgba(128,128,128,0.15)",
          borderBottom: "1px solid rgba(128,128,128,0.15)",
          overflow: "hidden",
          background: "rgba(10,10,14,0.7)",
        }}
        onMouseLeave={onSvgLeave}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ width: "100%", display: "block", cursor: isDragging ? "grabbing" : "crosshair", userSelect: "none" }}
          preserveAspectRatio="xMidYMid meet"
          textRendering="geometricPrecision"
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
        >
          <defs>
            <clipPath id="om-clip">
              <rect x={PL} y={PT} width={IW} height={IH} />
            </clipPath>
          </defs>

          {/* ── Zoomable / pannable layer ── */}
          <g clipPath="url(#om-clip)">
            <g transform={groupXform}>

              {/* Quadrant fills */}
              <rect x={PL}   y={PT}    width={X_MID - PL}      height={Y_MID - PT}      fill={`${BLUE}1a`}   />
              <rect x={X_MID} y={PT}   width={VW - PR - X_MID} height={Y_MID - PT}      fill={`${GREEN}18`}  />
              <rect x={PL}   y={Y_MID} width={X_MID - PL}      height={VH - PB - Y_MID} fill={`${YELLOW}10`} />
              <rect x={X_MID} y={Y_MID} width={VW - PR - X_MID} height={VH - PB - Y_MID} fill={`${RED}14`}  />

              {/* Score grid lines at 25 / 75 */}
              {[25, 75].map(v => (
                <line key={v} x1={PL} y1={yS(v)} x2={VW - PR} y2={yS(v)}
                  stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              ))}

              {/* Quadrant divider: dashed white crosshair */}
              <line x1={X_MID} y1={PT}     x2={X_MID}     y2={VH - PB}
                stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="5,5" />
              <line x1={PL}    y1={Y_MID}  x2={VW - PR}   y2={Y_MID}
                stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="5,5" />

              {/* Data points — sorted ascending sessions so big dots render on top */}
              {rows.map(r => {
                const { label: qLabel, color } = quad(r.summary.sessions, r.score);
                const cx     = xS(r.summary.sessions);
                const cy     = yS(r.score);
                const radius = Math.max(4, Math.min(13, 4 + Math.sqrt(r.summary.sessions / maxSess) * 9));
                const isHov  = tooltip?.app === r.summary.application;
                const dimmed = !!(tooltip && !isHov);
                const name   = r.summary.application;
                return (
                  <g key={name}>
                    <circle
                      cx={cx} cy={cy} r={isHov ? radius + 3 : radius}
                      fill={color}
                      fillOpacity={dimmed ? 0.12 : 1}
                      stroke={isHov ? "white" : "none"}
                      strokeWidth={2}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={e => onDotEnter(e, r)}
                      onMouseLeave={() => setTooltip(null)}
                    />
                    {showLabelNow && (
                      <text
                        x={cx} y={cy - radius - 4}
                        textAnchor="middle" fontSize={9 / vp.zoom}
                        fill="rgba(230,230,230,0.88)"
                        style={{ pointerEvents: "none" }}
                      >
                        {name.length > 22 ? name.slice(0, 21) + "…" : name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>

          {/* ── Static overlay (axes, labels — never zoom) ── */}

          {/* Chart border */}
          <rect x={PL} y={PT} width={IW} height={IH}
            fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />

          {/* Y axis spine */}
          <line x1={PL} y1={PT} x2={PL} y2={VH - PB}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
          {/* X axis spine */}
          <line x1={PL} y1={VH - PB} x2={VW - PR} y2={VH - PB}
            stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />

          {/* Y axis ticks */}
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={PL - 5} y1={yS(v)} x2={PL} y2={yS(v)}
                stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
              <text x={PL - 8} y={yS(v) + 4} textAnchor="end"
                fontSize={11} fill="rgba(255,255,255,0.38)">{v}</text>
            </g>
          ))}

          {/* Quadrant labels — inset near crosshair, outside zoom */}
          <text x={X_MID - 12} y={PT + 20}      textAnchor="end"   fontSize={11} fill={BLUE}   fontWeight={700} opacity={0.8}>MAINTAIN</text>
          <text x={X_MID + 12} y={PT + 20}      textAnchor="start" fontSize={11} fill={GREEN}  fontWeight={700} opacity={0.85}>PROTECT</text>
          <text x={X_MID - 12} y={VH - PB - 10} textAnchor="end"   fontSize={11} fill={YELLOW} fontWeight={700} opacity={0.8}>MONITOR</text>
          <text x={X_MID + 12} y={VH - PB - 10} textAnchor="start" fontSize={11} fill={RED}    fontWeight={700} opacity={0.85}>FIX FIRST</text>

          {/* Axis titles */}
          <text x={PL + IW / 2} y={VH - 15} textAnchor="middle"
            fontSize={11} fill="rgba(255,255,255,0.3)" fontWeight={500}>
            Sessions (traffic volume · sqrt scale)
          </text>
          <text x={16} y={PT + IH / 2} textAnchor="middle"
            fontSize={11} fill="rgba(255,255,255,0.3)" fontWeight={500}
            transform={`rotate(-90,16,${PT + IH / 2})`}>
            Composite Score (0–100)
          </text>

          {/* Zoom indicator */}
          {vp.zoom > 1.05 && (
            <text x={VW - PR - 6} y={PT + 16} textAnchor="end"
              fontSize={10} fill="rgba(255,255,255,0.3)">
              {vp.zoom.toFixed(1)}×
            </text>
          )}
          {showLabels && vp.zoom < LABEL_ZOOM_THRESHOLD && (
            <text x={VW - PR - 6} y={PT + 16} textAnchor="end"
              fontSize={10} fill={`${BLUE}cc`}>
              use +/− buttons · labels at {LABEL_ZOOM_THRESHOLD}×
            </text>
          )}

          {/* App count */}
          <text x={PL + 6} y={PT + 16} textAnchor="start"
            fontSize={10} fill="rgba(255,255,255,0.25)">
            {rows.length} apps
          </text>
        </svg>

        {/* ── Zoom controls ── */}
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          display: "flex", flexDirection: "column", gap: 3, zIndex: 15,
        }}>
          {[
            { label: "+", action: () => zoomTo(vp.zoom * 1.5), title: "Zoom in" },
            { label: "−", action: () => zoomTo(vp.zoom / 1.5), title: "Zoom out", disabled: vp.zoom <= 1.05 },
          ].map(btn => (
            <button key={btn.label} onClick={btn.action} title={btn.title} disabled={btn.disabled}
              style={{
                width: 30, height: 30, borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(14,14,20,0.88)",
                color: btn.disabled ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)",
                fontSize: 18, fontWeight: 300, lineHeight: 1,
                cursor: btn.disabled ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(4px)",
                transition: "background 0.12s",
              }}>
              {btn.label}
            </button>
          ))}
          {vp.zoom > 1.05 && (
            <button onClick={() => setVp({ tx: 0, ty: 0, zoom: 1 })} title="Reset zoom"
              style={{
                width: 30, height: 30, borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(14,14,20,0.88)",
                color: "rgba(255,255,255,0.55)",
                fontSize: 9, fontWeight: 700, lineHeight: 1,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                backdropFilter: "blur(4px)",
              }}>
              1×
            </button>
          )}
        </div>

        {/* ── Hover tooltip ── */}
        {tooltip && (
          <div style={{
            position: "absolute",
            left: Math.min(tooltip.x + 16, tooltipW - 230),
            top: Math.max(tooltip.y - 88, 8),
            pointerEvents: "none", zIndex: 20,
            background: "rgba(12,12,18,0.97)",
            border: `1px solid ${tooltip.color}38`,
            borderLeft: `3px solid ${tooltip.color}`,
            borderRadius: 8, padding: "10px 14px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
            minWidth: 215,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: tooltip.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              {tooltip.quadrant}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, marginBottom: 10, overflowWrap: "break-word" }}>
              {tooltip.app}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Score</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: tooltip.letterColor, lineHeight: 1 }}>{tooltip.letter}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: tooltip.color }}>{tooltip.score.toFixed(0)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, opacity: 0.38, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>Sessions</div>
                <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 14 }}>{fmt.num(tooltip.sessions)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap", justifyContent: "center", alignItems: "center", padding: "0 8px" }}>
        {LEGEND.map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.6 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
            {item.label}
          </div>
        ))}
      </div>

      {/* ── Fix First table ── */}
      {fixFirst.length > 0 && (
        <div style={{ marginTop: 22, borderRadius: 8, border: "1px solid rgba(128,128,128,0.12)", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", background: `${RED}0e`, borderBottom: "1px solid rgba(128,128,128,0.1)", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: RED, flexShrink: 0 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: RED }}>Fix First — ranked by traffic × score gap below 50</div>
            <div style={{ fontSize: 11, opacity: 0.38, marginLeft: "auto" }}>{fixFirst.length} app{fixFirst.length !== 1 ? "s" : ""}</div>
          </div>
          {fixFirst.slice(0, 8).map((r, i) => {
            const g = gradeFromScore(r.score);
            return (
              <div key={r.summary.application} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
                borderBottom: i < Math.min(fixFirst.length, 8) - 1 ? "1px solid rgba(128,128,128,0.07)" : "none",
                background: i % 2 ? "rgba(128,128,128,0.02)" : "transparent",
              }}>
                <div style={{ width: 22, fontSize: 11, opacity: 0.28, fontFamily: "monospace", fontWeight: 700 }}>#{i + 1}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: g.color, minWidth: 32, textAlign: "center", lineHeight: 1 }}>{g.letter}</div>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.summary.application}
                </div>
                <div style={{ fontSize: 11, opacity: 0.45, minWidth: 100, textAlign: "right" }}>
                  {fmt.num(r.summary.sessions)} sessions
                </div>
                <div style={{ fontSize: 12, color: RED, fontFamily: "monospace", fontWeight: 700, minWidth: 60, textAlign: "right" }}>
                  {r.score.toFixed(0)}/100
                </div>
                <div style={{ fontSize: 10, opacity: 0.38, minWidth: 66, textAlign: "right" }}>
                  gap {(SCORE_SPLIT - r.score).toFixed(0)} pts
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
