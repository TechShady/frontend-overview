import React from "react";
import { createPortal } from "react-dom";

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

function cellColor(z: number, hasData: boolean): string {
  if (!hasData) return "rgba(140,140,160,0.28)";
  if (z >= 2.5) return "#FF073A";
  if (z >= 1.5) return "#FF3D9A";
  if (z >= 0.75) return "#FFF04D";
  if (z >= 0.1) return "rgba(69,137,255,0.55)";
  return "rgba(69,137,255,0.12)";
}

function buildGrid(scores: number[], bucketMs: number): { grid: (number | null)[][]; dayLabels: string[]; dataHours: number } {
  if (scores.length === 0) return { grid: DAYS.map(() => HOURS.map(() => null)), dayLabels: DAYS, dataHours: 0 };

  const now = Date.now();
  const startMs = now - scores.length * bucketMs;
  const dataHours = (scores.length * bucketMs) / 3600000;

  const sums: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const counts: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));

  for (let i = 0; i < scores.length; i++) {
    const ts = startMs + i * bucketMs;
    const d = new Date(ts);
    const dow = d.getDay();
    const hour = d.getHours();
    sums[dow][hour] += scores[i];
    counts[dow][hour]++;
  }

  const grid: (number | null)[][] = Array.from({ length: 7 }, (_, dow) =>
    Array.from({ length: 24 }, (__, h) => (counts[dow][h] > 0 ? sums[dow][h] / counts[dow][h] : null))
  );

  return { grid, dayLabels: DAYS, dataHours };
}

export function HotnessCalendarPanel({ heatScores, bucketMs, pos, onDragStart, onClose, getRequeryData }: HotnessCalendarPanelProps) {
  const [scores, setScores] = React.useState<number[]>(heatScores);
  const [loading, setLoading] = React.useState(true);
  const [hover, setHover] = React.useState<{ dow: number; hour: number; val: number | null } | null>(null);

  React.useEffect(() => {
    setLoading(true);
    getRequeryData(14)
      .then((data) => { if (data.length > 0) setScores(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { grid, dayLabels, dataHours } = React.useMemo(() => buildGrid(scores, bucketMs), [scores, bucketMs]);

  const CELL_W = 28, CELL_H = 14, GAP = 2;
  const LEFT_PAD = 42;

  const panelW = LEFT_PAD + 7 * (CELL_W + GAP) + 24;

  const content = (
    <div
      style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 9001,
        background: "linear-gradient(135deg, #0f1117 0%, #131720 100%)",
        border: "1px solid rgba(69,137,255,0.3)", borderRadius: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)", width: panelW + 32, userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px", cursor: "grab", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        onMouseDown={onDragStart}
      >
        <span style={{ fontSize: 15 }}>📅</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Hotness Heatmap</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>
            {loading ? "Loading…" : `Hour-of-day × Day-of-week · ${Math.round(dataHours)}h of data`}
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 18, cursor: "pointer", padding: 0 }}>✕</button>
      </div>

      {/* Grid */}
      <div style={{ padding: "14px 16px 10px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", padding: 32, fontSize: 13 }}>Loading historical data…</div>
        ) : (
          <>
            {/* Day-of-week column headers */}
            <div style={{ display: "flex", marginLeft: LEFT_PAD, marginBottom: 4, gap: GAP }}>
              {dayLabels.map((d) => (
                <div key={d} style={{ width: CELL_W, textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>{d}</div>
              ))}
            </div>

            {/* Hour rows */}
            {HOURS.map((h) => (
              <div key={h} style={{ display: "flex", alignItems: "center", marginBottom: GAP, gap: GAP }}>
                <div style={{ width: LEFT_PAD - GAP, textAlign: "right", paddingRight: 6, fontSize: 9, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
                  {h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                </div>
                {dayLabels.map((_, dow) => {
                  const val = grid[dow][h];
                  const isHovered = hover?.dow === dow && hover?.hour === h;
                  return (
                    <div
                      key={dow}
                      style={{
                        width: CELL_W, height: CELL_H, borderRadius: 3,
                        background: cellColor(val ?? 0, val !== null),
                        border: isHovered ? "1px solid rgba(255,255,255,0.6)" : "1px solid transparent",
                        boxSizing: "border-box",
                        cursor: "default", transition: "border 0.1s",
                      }}
                      onMouseEnter={() => setHover({ dow, hour: h, val })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
              </div>
            ))}

            {/* Tooltip */}
            <div style={{ height: 28, marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
              {hover && hover.val !== null
                ? `${DAYS[hover.dow]} ${hover.hour}:00 — avg Z-score: ${hover.val.toFixed(2)}σ`
                : hover && hover.val === null
                  ? `${DAYS[hover.dow]} ${hover.hour}:00 — no data`
                  : "Hover a cell to see average hotness"}
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 4 }}>
              {[
                { color: "rgba(140,140,160,0.28)", label: "No Data" },
                { color: "rgba(69,137,255,0.12)", label: "Baseline" },
                { color: "rgba(69,137,255,0.55)", label: "Low" },
                { color: "#FFF04D", label: "Warm" },
                { color: "#FF3D9A", label: "Hot" },
                { color: "#FF073A", label: "Spike" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{label}</span>
                </div>
              ))}
            </div>

            {dataHours < 24 && (
              <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                Less than 24h of data available. Switch to a longer timeframe for richer patterns.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
