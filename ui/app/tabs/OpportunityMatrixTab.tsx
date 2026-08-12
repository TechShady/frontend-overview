import React, { useMemo, useRef, useState } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webVitalsPerAppQuery } from "../queries";
import { computeAppScore } from "../scoring";
import { gradeFromScore } from "../components/GradeBadge";
import { fmt } from "../components/layout";

// ---------------------------------------------------------------------------
// Opportunity Matrix — full-width responsive scatter of all web apps.
// X axis: session volume (sqrt-scaled so outliers don't compress the cluster).
// Y axis: composite score 0–100.
// Median crosshair divides the chart into four action quadrants.
// ---------------------------------------------------------------------------

const GREEN  = "#0D9C29";
const ORANGE = "#FB8C00";
const RED    = "#C21930";
const BLUE   = "#4589FF";

// Internal SVG coordinate space
const VW = 1000, VH = 520;
const PL = 64, PR = 40, PT = 52, PB = 68;
const IW = VW - PL - PR;
const IH = VH - PT - PB;

interface TooltipData {
  x: number; y: number;
  app: string; score: number; sessions: number;
  quadrant: string; color: string;
}

const MIN_PRESETS = [
  { label: "All",   value: 0     },
  { label: "100+",  value: 100   },
  { label: "1 K+",  value: 1000  },
  { label: "10 K+", value: 10000 },
];

const QUADRANT_LEGEND = [
  { label: "Fix First — high traffic, low score",  color: RED    },
  { label: "Protect — high traffic, high score",   color: GREEN  },
  { label: "Monitor — low traffic, low score",     color: ORANGE },
  { label: "Maintain — low traffic, high score",   color: BLUE   },
];

export const OpportunityMatrixTab: React.FC = () => {
  const { timeframeDays, webAppFilter, gradeWeights } = useSettings();
  const sel = webAppFilter.selected;

  const sum    = useDql(webAppSummaryQuery(timeframeDays, sel),   [timeframeDays, sel]);
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);

  const [showLabels, setShowLabels] = useState(false);
  const [minSessions, setMinSessions] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build scored rows from raw DQL results
  const allScored = useMemo(() => {
    const vByApp: Record<string, any> = {};
    (vitals.data?.records ?? []).forEach((r: any) => { vByApp[String(r.application ?? "")] = r; });
    return (sum.data?.records ?? []).map((r: any) => {
      const app = String(r.application ?? "");
      const v = vByApp[app] || {};
      const summary = {
        application: app,
        sessions:    Number(r.sessions    ?? 0),
        users:       Number(r.users       ?? 0),
        actions:     Number(r.actions     ?? 0),
        errors:      Number(r.errors      ?? 0),
        avgDuration: Number(r.avgDuration ?? 0),
        apdex:       Number(r.apdex       ?? 0),
        satisfied:   Number(r.satisfied   ?? 0),
        tolerating:  Number(r.tolerating  ?? 0),
        frustrated:  Number(r.frustrated  ?? 0),
        errorRate:   Number(r.errorRate   ?? 0),
        bounceRate: 0, newUsers: 0, bounces: 0,
      };
      const vitalsRow = {
        application: app,
        lcpAvg:     Number(v.lcpAvg     ?? NaN),
        inpAvg:     Number(v.inpAvg     ?? NaN),
        clsAvg:     Number(v.clsAvg     ?? NaN),
        ttfbAvg:    Number(v.ttfbAvg    ?? NaN),
        fcpAvg:     Number(v.fcpAvg     ?? NaN),
        loadEndAvg: Number(v.loadEndAvg ?? NaN),
      };
      const { score } = computeAppScore(vitalsRow, summary, gradeWeights);
      return { summary, score };
    });
  }, [sum.data, vitals.data, gradeWeights]);

  const rows = useMemo(
    () => allScored.filter(r => isFinite(r.score) && r.summary.sessions >= Math.max(1, minSessions)),
    [allScored, minSessions]
  );

  const loading = sum.loading || vitals.loading;

  // Scales
  const maxSess = Math.max(...rows.map(r => r.summary.sessions), 1);
  const sortedBySess  = useMemo(() => [...rows].sort((a, b) => a.summary.sessions - b.summary.sessions), [rows]);
  const sortedByScore = useMemo(() => [...rows].sort((a, b) => a.score - b.score), [rows]);
  const medSess  = rows.length > 0 ? sortedBySess[Math.floor(rows.length / 2)].summary.sessions : 1;
  const medScore = rows.length > 0 ? sortedByScore[Math.floor(rows.length / 2)].score : 50;

  const xS = (s: number) => PL + (Math.sqrt(Math.max(0, s)) / Math.sqrt(maxSess)) * IW;
  const yS = (sc: number) => PT + IH - (Math.max(0, Math.min(100, sc)) / 100) * IH;
  const xMid = xS(medSess);
  const yMid = yS(medScore);

  function quad(sessions: number, score: number): { label: string; color: string } {
    const hi   = sessions >= medSess;
    const good = score   >= medScore;
    if (hi && !good) return { label: "Fix First", color: RED    };
    if (hi &&  good) return { label: "Protect",   color: GREEN  };
    if (!hi && !good) return { label: "Monitor",   color: ORANGE };
    return                  { label: "Maintain",  color: BLUE   };
  }

  // Annotated outliers (min score, max score) — deduplicated if same app
  const minApp = rows.length > 0 ? rows.reduce((a, b) => b.score < a.score ? b : a) : null;
  const maxApp = rows.length > 0 ? rows.reduce((a, b) => b.score > a.score ? b : a) : null;
  const annotations = [
    minApp ? { r: minApp, tag: "Min Score" } : null,
    maxApp && maxApp !== minApp ? { r: maxApp, tag: "Max Score" } : null,
  ].filter((x): x is { r: typeof rows[0]; tag: string } => x !== null);

  const fixFirst = useMemo(() => rows
    .filter(r => r.summary.sessions >= medSess && r.score < medScore)
    .sort((a, b) => (b.summary.sessions * (medScore - b.score)) - (a.summary.sessions * (medScore - a.score))),
    [rows, medSess, medScore]
  );

  const handleCircleEnter = (e: React.MouseEvent<SVGGElement>, r: typeof rows[0]) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const { label, color } = quad(r.summary.sessions, r.score);
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      app: r.summary.application,
      score: r.score,
      sessions: r.summary.sessions,
      quadrant: label,
      color,
    });
  };

  // Early returns after all hooks
  if (loading && rows.length === 0) {
    return <div style={{ padding: 48, textAlign: "center", opacity: 0.5 }}>Loading…</div>;
  }
  if (rows.length < 2) {
    return (
      <div style={{ padding: 48, textAlign: "center", opacity: 0.6 }}>
        Not enough data.{minSessions > 0 && " Try lowering the minimum sessions filter."}
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 8px 28px" }}>
      {/* ---- Header ---- */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.1 }}>Opportunity Matrix</div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 3 }}>
            Traffic volume vs composite score — the median crosshair divides four action quadrants.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Min sessions filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, opacity: 0.45, whiteSpace: "nowrap" }}>Min sessions:</span>
            {MIN_PRESETS.map(p => (
              <button key={p.value} onClick={() => setMinSessions(p.value)} style={{
                padding: "3px 10px", borderRadius: 12, border: "1px solid",
                fontSize: 11, cursor: "pointer", fontWeight: 600, transition: "all 0.15s",
                borderColor: minSessions === p.value ? BLUE : "rgba(128,128,128,0.25)",
                background:  minSessions === p.value ? `${BLUE}1a` : "transparent",
                color:       minSessions === p.value ? BLUE : "inherit",
              }}>{p.label}</button>
            ))}
          </div>
          {/* Labels toggle */}
          <button onClick={() => setShowLabels(v => !v)} style={{
            padding: "3px 12px", borderRadius: 12, border: "1px solid",
            fontSize: 11, cursor: "pointer", fontWeight: 600, transition: "all 0.15s",
            borderColor: showLabels ? BLUE : "rgba(128,128,128,0.25)",
            background:  showLabels ? `${BLUE}1a` : "transparent",
            color:       showLabels ? BLUE : "inherit",
          }}>
            {showLabels ? "Hide Labels" : "Show Labels"}
          </button>
        </div>
      </div>

      {/* ---- Chart ---- */}
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(128,128,128,0.14)", background: "rgba(128,128,128,0.03)" }}
        onMouseLeave={() => setTooltip(null)}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="xMidYMid meet">

          {/* Quadrant backgrounds */}
          <rect x={PL}   y={PT}   width={xMid - PL}      height={yMid - PT}      fill={`${GREEN}08`}  />
          <rect x={xMid} y={PT}   width={VW - PR - xMid} height={yMid - PT}      fill={`${RED}0c`}    />
          <rect x={PL}   y={yMid} width={xMid - PL}      height={VH - PB - yMid} fill={`${BLUE}07`}   />
          <rect x={xMid} y={yMid} width={VW - PR - xMid} height={VH - PB - yMid} fill={`${ORANGE}08`} />

          {/* Horizontal grid at score intervals */}
          {[25, 50, 75].map(v => (
            <line key={v} x1={PL} y1={yS(v)} x2={VW - PR} y2={yS(v)}
              stroke="rgba(128,128,128,0.1)" strokeWidth={1} strokeDasharray="4,6" />
          ))}

          {/* Border frame */}
          <rect x={PL} y={PT} width={IW} height={IH} fill="none" stroke="rgba(128,128,128,0.18)" strokeWidth={1} />

          {/* Median crosshair */}
          <line x1={xMid} y1={PT}      x2={xMid}      y2={VH - PB} stroke="rgba(128,128,128,0.22)" strokeWidth={1} strokeDasharray="5,5" />
          <line x1={PL}   y1={yMid}    x2={VW - PR}   y2={yMid}    stroke="rgba(128,128,128,0.22)" strokeWidth={1} strokeDasharray="5,5" />

          {/* Y axis ticks + labels */}
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={PL - 5} y1={yS(v)} x2={PL} y2={yS(v)} stroke="rgba(128,128,128,0.35)" strokeWidth={1} />
              <text x={PL - 8} y={yS(v) + 4} textAnchor="end" fontSize={11} fill="rgba(128,128,128,0.5)">{v}</text>
            </g>
          ))}

          {/* Quadrant labels */}
          <text x={xMid - 12} y={PT + 20}      textAnchor="end"   fontSize={12} fill={GREEN}  opacity={0.7} fontWeight={700}>PROTECT</text>
          <text x={xMid + 12} y={PT + 20}      textAnchor="start" fontSize={12} fill={RED}    opacity={0.8} fontWeight={700}>FIX FIRST</text>
          <text x={xMid - 12} y={VH - PB - 10} textAnchor="end"   fontSize={12} fill={BLUE}   opacity={0.7} fontWeight={700}>MAINTAIN</text>
          <text x={xMid + 12} y={VH - PB - 10} textAnchor="start" fontSize={12} fill={ORANGE} opacity={0.7} fontWeight={700}>MONITOR</text>

          {/* Axis labels */}
          <text x={PL + IW / 2} y={VH - 18} textAnchor="middle" fontSize={11} fill="rgba(128,128,128,0.55)" fontWeight={500}>
            Sessions (traffic volume, sqrt scale)
          </text>
          <text x={18} y={PT + IH / 2} textAnchor="middle" fontSize={11} fill="rgba(128,128,128,0.55)" fontWeight={500}
            transform={`rotate(-90,18,${PT + IH / 2})`}>
            Composite Score (0–100)
          </text>

          {/* Data points */}
          {rows.map(r => {
            const { label: qLabel, color } = quad(r.summary.sessions, r.score);
            const cx     = xS(r.summary.sessions);
            const cy     = yS(r.score);
            const radius = Math.max(5, Math.min(15, 5 + Math.sqrt(r.summary.sessions / maxSess) * 10));
            const isHov  = tooltip?.app === r.summary.application;
            const isAnn  = annotations.some(a => a.r === r);
            const dimmed = !!(tooltip && !isHov);
            const name   = r.summary.application;
            const label  = name.length > 18 ? name.slice(0, 17) + "…" : name;
            return (
              <g key={name} onMouseEnter={e => handleCircleEnter(e, r)} style={{ cursor: "pointer" }}>
                <circle
                  cx={cx} cy={cy} r={radius + (isHov ? 3 : 0)}
                  fill={color}
                  opacity={dimmed ? 0.2 : isHov ? 1 : 0.82}
                  stroke={isHov ? "rgba(255,255,255,0.9)" : isAnn ? `${color}aa` : "none"}
                  strokeWidth={isHov ? 2 : 1.5}
                />
                {(showLabels || isAnn) && !dimmed && (
                  <text
                    x={cx} y={cy - radius - 5}
                    textAnchor="middle"
                    fontSize={isAnn ? 11 : 9}
                    fill={isAnn ? color : "rgba(200,200,200,0.8)"}
                    fontWeight={isAnn ? 700 : 400}
                    style={{ pointerEvents: "none" }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Min/Max callout annotations */}
          {annotations.map(({ r, tag }) => {
            const cx = xS(r.summary.sessions);
            const cy = yS(r.score);
            const { color } = quad(r.summary.sessions, r.score);
            const radius = Math.max(5, Math.min(15, 5 + Math.sqrt(r.summary.sessions / maxSess) * 10));
            const goLeft = cx > (PL + IW / 2);
            const goUp   = cy > (PT + IH / 2);
            const lx = goLeft ? cx - 70 : cx + 70;
            const ly = goUp   ? cy - 30 : cy + 30;
            return (
              <g key={tag}>
                <line x1={cx} y1={cy - radius} x2={lx} y2={ly + 4} stroke={color} strokeWidth={1} opacity={0.55} strokeDasharray="3,2" />
                <text x={lx} y={ly}
                  textAnchor={goLeft ? "end" : "start"}
                  fontSize={10} fill={color} opacity={0.8} fontWeight={700}>
                  {tag}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {tooltip && (
          <div style={{
            position: "absolute",
            left: Math.min(tooltip.x + 14, (containerRef.current?.offsetWidth ?? 9999) - 220),
            top:  Math.max(tooltip.y - 72, 8),
            pointerEvents: "none", zIndex: 10,
            background: "rgba(18,18,22,0.97)",
            border: `1px solid ${tooltip.color}40`,
            borderLeft: `3px solid ${tooltip.color}`,
            borderRadius: 8,
            padding: "9px 13px",
            boxShadow: "0 6px 22px rgba(0,0,0,0.4)",
            minWidth: 205,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: tooltip.color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 }}>
              {tooltip.quadrant}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9, lineHeight: 1.35, overflowWrap: "break-word" }}>
              {tooltip.app}
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, opacity: 0.4, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Score</div>
                <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 15, color: tooltip.color }}>
                  {tooltip.score.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, opacity: 0.55 }}>/100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, opacity: 0.4, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Sessions</div>
                <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>{fmt.num(tooltip.sessions)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- Legend ---- */}
      <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        {QUADRANT_LEGEND.map(item => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.7 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
            {item.label}
          </div>
        ))}
        <div style={{ fontSize: 11, opacity: 0.35, marginLeft: 4 }}>
          {rows.length} apps · dot size ∝ sessions
        </div>
      </div>

      {/* ---- Fix First table ---- */}
      {fixFirst.length > 0 && (
        <div style={{ marginTop: 24, borderRadius: 8, border: "1px solid rgba(128,128,128,0.12)", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", background: `${RED}10`, borderBottom: "1px solid rgba(128,128,128,0.1)", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: RED, flexShrink: 0 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: RED }}>Fix First — ranked by traffic × score gap</div>
            <div style={{ fontSize: 11, opacity: 0.4, marginLeft: "auto" }}>
              {fixFirst.length} app{fixFirst.length !== 1 ? "s" : ""}
            </div>
          </div>
          {fixFirst.slice(0, 8).map((r, i) => {
            const gap = medScore - r.score;
            const g   = gradeFromScore(r.score);
            return (
              <div key={r.summary.application} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
                borderBottom: i < Math.min(fixFirst.length, 8) - 1 ? "1px solid rgba(128,128,128,0.07)" : "none",
                background: i % 2 === 0 ? "transparent" : "rgba(128,128,128,0.02)",
              }}>
                <div style={{ width: 22, fontSize: 11, opacity: 0.3, fontFamily: "monospace", fontWeight: 700 }}>#{i + 1}</div>
                <div style={{ fontSize: 21, fontWeight: 900, color: g.color, minWidth: 32, textAlign: "center", lineHeight: 1 }}>{g.letter}</div>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.summary.application}
                </div>
                <div style={{ fontSize: 11, opacity: 0.5, minWidth: 100, textAlign: "right" }}>
                  {fmt.num(r.summary.sessions)} sessions
                </div>
                <div style={{ fontSize: 12, color: RED, fontFamily: "monospace", fontWeight: 700, minWidth: 64, textAlign: "right" }}>
                  {r.score.toFixed(0)}/100
                </div>
                <div style={{ fontSize: 10, opacity: 0.4, minWidth: 70, textAlign: "right" }}>
                  gap {gap.toFixed(0)} pts
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
