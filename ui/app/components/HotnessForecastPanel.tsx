import React from "react";
import { createPortal } from "react-dom";
import {
  linearForecast, holtWintersForecast, tripleExpSmoothingForecast,
  prophetForecast, arimaForecast, sarimaForecast, confidenceBand,
} from "./ForecastModal";
import type { ForecastMethod } from "./ForecastModal";

const LOOKBACK_OPTIONS = [7, 14, 30, 60, 90];
const FORECAST_OPTIONS = [7, 14, 30];

function runModel(method: ForecastMethod, data: number[], buckets: number): number[] {
  if (data.length < 2) return new Array(buckets).fill(0);
  try {
    switch (method) {
      case "linear":       return linearForecast(data, buckets);
      case "holt-winters": return holtWintersForecast(data, buckets);
      case "triple-exp":   return tripleExpSmoothingForecast(data, buckets);
      case "prophet":      return prophetForecast(data, buckets);
      case "arima":        return arimaForecast(data, buckets);
      case "sarima":       return sarimaForecast(data, buckets);
    }
  } catch { return linearForecast(data, buckets); }
}

function hotnessColor(z: number): string {
  return z >= 2.5 ? "#FF073A" : z >= 1.5 ? "#FF3D9A" : z >= 0.75 ? "#FFF04D" : "#4589FF";
}

function computeConfidence(data: number[]): number {
  const n = data.length;
  if (n < 3) return 70;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(data.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  const cv = mean > 0 ? std / mean : 1;
  return Math.round(Math.max(40, Math.min(98, 92 - cv * 40)));
}

export interface HotnessForecastPanelProps {
  hotness: number[];
  bucketMs: number;
  onClose: () => void;
  pos: { x: number; y: number };
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  getRequeryData: (days: number) => Promise<number[]>;
}

export function HotnessForecastPanel({
  hotness, bucketMs, onClose, pos, onDragStart, getRequeryData,
}: HotnessForecastPanelProps) {
  const [method, setMethod]                   = React.useState<ForecastMethod>("prophet");
  const [pendingLookback, setPendingLookback] = React.useState(14);
  const [appliedLookback, setAppliedLookback] = React.useState(14);
  const [pendingForecast, setPendingForecast] = React.useState(7);
  const [appliedForecast, setAppliedForecast] = React.useState(7);
  const [histData, setHistData]               = React.useState<number[]>(hotness);
  const [isLoading, setIsLoading]             = React.useState(false);
  const [loadError, setLoadError]             = React.useState<string | null>(null);
  const [hoverIdx, setHoverIdx]               = React.useState<number | null>(null);

  const isDirty = pendingLookback !== appliedLookback || pendingForecast !== appliedForecast;

  const bucketsPerDay   = Math.max(1, Math.round(86400000 / bucketMs));
  const trainingData    = histData.slice(-appliedLookback * bucketsPerDay);
  const forecastBuckets = appliedForecast * bucketsPerDay;

  const forecastData = React.useMemo(
    () => trainingData.length >= 2 ? runModel(method, trainingData, forecastBuckets) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(trainingData), method, forecastBuckets],
  );

  const { upper, lower } = React.useMemo(
    () => forecastData.length > 0 && trainingData.length >= 2
      ? confidenceBand(trainingData, forecastData)
      : { upper: [] as number[], lower: [] as number[] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(trainingData), JSON.stringify(forecastData)],
  );

  const confidence = React.useMemo(() => computeConfidence(trainingData), [trainingData]);

  const peakIdx = forecastData.length > 0 ? forecastData.indexOf(Math.max(...forecastData)) : -1;
  const peakZ   = peakIdx >= 0 ? forecastData[peakIdx] : 0;

  const handleApply = async () => {
    const needsRequery = pendingLookback !== appliedLookback;
    if (needsRequery) {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await getRequeryData(pendingLookback);
        if (data.length > 0) setHistData(data);
        else setLoadError("No data returned for this period");
      } catch { setLoadError("Failed to load historical data"); }
      finally { setIsLoading(false); }
    }
    setAppliedLookback(pendingLookback);
    setAppliedForecast(pendingForecast);
  };

  // SVG dimensions
  const W = 860, H = 290;
  const mL = 52, mR = 28, mT = 28, mB = 44;
  const cW = W - mL - mR, cH = H - mT - mB;
  const histLen = trainingData.length, fLen = forecastData.length;
  const total   = histLen + fLen;

  const allZ  = [...trainingData, ...forecastData, ...upper, ...lower].filter(isFinite);
  const maxY  = Math.max(3, ...(allZ.length ? allZ : [3])) * 1.15;
  const xOf   = (i: number) => (i / Math.max(total - 1, 1)) * cW;
  const yOf   = (v: number) => cH - Math.max(0, Math.min(v, maxY)) / maxY * cH;
  const barW  = Math.max(1.5, cW / Math.max(total, 1) - 1);

  const bandPts = upper.length > 0
    ? [
        ...upper.map((v, i) => `${mL + xOf(histLen + i)},${mT + yOf(v)}`),
        ...lower.slice().reverse().map((v, i) => `${mL + xOf(histLen + fLen - 1 - i)},${mT + yOf(v)}`),
      ].join(" ")
    : "";

  const confColor = confidence >= 80 ? "#3EC96A" : confidence >= 65 ? "#FFF04D" : "#FF8C42";

  const selStyle: React.CSSProperties = {
    fontSize: 12, padding: "4px 8px", borderRadius: 6,
    background: "rgba(255,255,255,0.07)", color: "#e8eeff",
    border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer",
  };

  return createPortal(
    <div style={{
      position: "fixed", left: pos.x, top: pos.y, zIndex: 9999, width: 940,
      background: "rgba(14,18,36,0.97)", border: "1px solid rgba(69,137,255,0.3)",
      borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.72)",
      fontFamily: '"Inter",system-ui,sans-serif', color: "#e8eeff",
      backdropFilter: "blur(14px)",
    }}>
      {/* Header / drag handle */}
      <div onMouseDown={onDragStart} style={{
        cursor: "grab", padding: "10px 16px 9px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        userSelect: "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📈</span>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.4 }}>Hotness Forecast</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>drag to move</span>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.45)",
          fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1,
        }}>×</button>
      </div>

      {/* Controls */}
      <div style={{
        padding: "9px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", whiteSpace: "nowrap" }}>Model</span>
          <select value={method} onChange={e => setMethod(e.target.value as ForecastMethod)} style={selStyle}>
            <option value="prophet">Prophet</option>
            <option value="holt-winters">Holt-Winters</option>
            <option value="triple-exp">Triple Exp. Smoothing</option>
            <option value="arima">ARIMA</option>
            <option value="sarima">SARIMA</option>
            <option value="linear">Linear Regression</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", whiteSpace: "nowrap" }}>Analyze</span>
          <select value={pendingLookback} onChange={e => setPendingLookback(Number(e.target.value))} style={selStyle}>
            {LOOKBACK_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", whiteSpace: "nowrap" }}>Forecast</span>
          <select value={pendingForecast} onChange={e => setPendingForecast(Number(e.target.value))} style={selStyle}>
            {FORECAST_OPTIONS.map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        {isDirty && (
          <button onClick={handleApply} disabled={isLoading} style={{
            fontSize: 12, padding: "5px 16px", borderRadius: 6, background: "#4589FF",
            color: "white", border: "none", cursor: isLoading ? "wait" : "pointer",
            fontWeight: 700, opacity: isLoading ? 0.6 : 1,
          }}>
            {isLoading ? "Loading…" : "Apply"}
          </button>
        )}
        {loadError && <span style={{ fontSize: 11, color: "#FF3D9A" }}>{loadError}</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>Model confidence</span>
          <div style={{ width: 72, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${confidence}%`, background: confColor, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>{confidence}%</span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: "6px 16px 0" }}>
        <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}
          onMouseLeave={() => setHoverIdx(null)}>

          {/* Threshold lines */}
          {([0, 0.75, 1.5, 2.5] as number[]).map(z => {
            const y = mT + yOf(z);
            return (
              <g key={z}>
                <line x1={mL} y1={y} x2={mL + cW} y2={y}
                  stroke={z === 0 ? "rgba(255,255,255,0.08)" : hotnessColor(z)}
                  strokeWidth={0.5} strokeDasharray={z === 0 ? undefined : "3,4"} opacity={0.35} />
                <text x={mL - 5} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.32)" fontSize={9}>{z.toFixed(2)}</text>
              </g>
            );
          })}

          {/* Confidence band */}
          {bandPts && <polygon points={bandPts} fill="rgba(69,137,255,0.09)" />}

          {/* Historical bars */}
          {trainingData.map((v, i) => {
            const bH = Math.max(1.5, Math.min(v, maxY) / maxY * cH);
            return (
              <rect key={i} x={mL + xOf(i)} y={mT + cH - bH} width={barW} height={bH}
                fill={hotnessColor(v)} opacity={hoverIdx === i ? 1 : 0.82}
                onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }} />
            );
          })}

          {/* "Now" divider */}
          {histLen > 0 && (() => {
            const nx = mL + xOf(histLen - 1) + barW + 1;
            return (
              <>
                <line x1={nx} y1={mT} x2={nx} y2={mT + cH}
                  stroke="rgba(255,255,255,0.45)" strokeWidth={1.2} strokeDasharray="5,4" />
                <text x={nx + 4} y={mT + 13} fill="rgba(255,255,255,0.5)" fontSize={10} fontWeight="bold">Now</text>
              </>
            );
          })()}

          {/* Forecast bars */}
          {forecastData.map((v, i) => {
            const bH = Math.max(1.5, Math.min(v, maxY) / maxY * cH);
            return (
              <rect key={i} x={mL + xOf(histLen + i)} y={mT + cH - bH} width={barW} height={bH}
                fill={hotnessColor(v)} opacity={hoverIdx === histLen + i ? 0.85 : 0.32}
                onMouseEnter={() => setHoverIdx(histLen + i)} style={{ cursor: "crosshair" }} />
            );
          })}

          {/* Forecast trend line */}
          {fLen > 1 && (
            <polyline
              points={forecastData.map((v, i) => `${mL + xOf(histLen + i) + barW / 2},${mT + yOf(v)}`).join(" ")}
              fill="none" stroke="rgba(100,160,255,0.7)" strokeWidth={1.6} strokeDasharray="6,4" />
          )}

          {/* Peak marker */}
          {peakIdx >= 0 && peakZ >= 0.75 && (() => {
            const cx = mL + xOf(histLen + peakIdx) + barW / 2;
            const cy = mT + yOf(peakZ);
            return (
              <>
                <circle cx={cx} cy={cy} r={4} fill={hotnessColor(peakZ)} stroke="white" strokeWidth={1.5} />
                <text x={cx} y={cy - 8} textAnchor="middle" fill={hotnessColor(peakZ)} fontSize={9} fontWeight="bold">
                  ↑ {peakZ.toFixed(1)}σ
                </text>
              </>
            );
          })()}

          {/* Hover tooltip */}
          {hoverIdx !== null && (() => {
            const isForecast = hoverIdx >= histLen;
            const v = isForecast ? forecastData[hoverIdx - histLen] : trainingData[hoverIdx];
            if (v === undefined) return null;
            const cx = mL + xOf(hoverIdx) + barW / 2;
            const cy = mT + yOf(v) - 12;
            return (
              <g>
                <line x1={cx} y1={mT} x2={cx} y2={mT + cH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                <rect x={cx - 40} y={cy - 17} width={80} height={18} rx={4}
                  fill="rgba(14,18,36,0.94)" stroke="rgba(255,255,255,0.18)" strokeWidth={0.8} />
                <text x={cx} y={cy - 3} textAnchor="middle" fill="white" fontSize={10} fontWeight="bold">
                  {isForecast ? "~" : ""}{v.toFixed(2)}σ{isForecast ? " (fcst)" : ""}
                </text>
              </g>
            );
          })()}

          {/* Axes */}
          <line x1={mL} y1={mT + cH} x2={mL + cW} y2={mT + cH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
          <line x1={mL} y1={mT} x2={mL} y2={mT + cH} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />

          {/* X-axis labels */}
          <text x={mL} y={mT + cH + 14} textAnchor="middle" fill="rgba(255,255,255,0.32)" fontSize={9}>−{appliedLookback}d</text>
          {histLen > 0 && (
            <text x={mL + xOf(histLen)} y={mT + cH + 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={9}>Now</text>
          )}
          <text x={mL + cW} y={mT + cH + 14} textAnchor="end" fill="rgba(255,255,255,0.32)" fontSize={9}>+{appliedForecast}d</text>
          <text x={mL} y={mT + cH + 28} textAnchor="start" fill="rgba(255,255,255,0.2)" fontSize={9} fontStyle="italic">Hotness Z-score (σ)</text>
        </svg>
      </div>

      {/* Footer */}
      <div style={{
        padding: "5px 16px 11px", borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          {peakZ >= 0.75
            ? <span>Forecast peak: <span style={{ color: hotnessColor(peakZ), fontWeight: 700 }}>z={peakZ.toFixed(2)}</span> at +{peakIdx + 1} bucket(s) into forecast window</span>
            : <span style={{ color: "#3EC96A" }}>No significant hotness spikes projected in forecast window</span>
          }
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {(["#4589FF","#FFF04D","#FF3D9A","#FF073A"] as const).map((col, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.42)" }}>
              <span style={{ width: 8, height: 8, background: col, borderRadius: 2, display: "inline-block" }} />
              {["Normal","Elevated","Warm","Spike"][i]}
            </span>
          ))}
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.42)" }}>
            <svg width={16} height={8}><line x1={0} y1={4} x2={16} y2={4} stroke="rgba(100,160,255,0.7)" strokeWidth={1.6} strokeDasharray="4,3" /></svg>
            Forecast trend
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.42)" }}>
            <span style={{ width: 14, height: 8, background: "rgba(69,137,255,0.09)", border: "1px solid rgba(69,137,255,0.2)", borderRadius: 1, display: "inline-block" }} />
            Confidence band
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
