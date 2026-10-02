import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";

// ─── Linear regression forecast ───
export function linearForecast(data: number[], forecastBuckets: number): number[] {
  const n = data.length;
  if (n < 2) return new Array(forecastBuckets).fill(data[0] ?? 0);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += data[i]; sumXY += i * data[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const forecast: number[] = [];
  for (let i = 0; i < forecastBuckets; i++) forecast.push(Math.max(0, intercept + slope * (n + i)));
  return forecast;
}

// ─── Holt-Winters (double exponential smoothing) ───
export function holtWintersForecast(data: number[], forecastBuckets: number, alpha = 0.3, beta = 0.1): number[] {
  const n = data.length;
  if (n < 2) return new Array(forecastBuckets).fill(data[0] ?? 0);
  let level = data[0];
  let trend = data[1] - data[0];
  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    level = alpha * data[i] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const forecast: number[] = [];
  for (let i = 1; i <= forecastBuckets; i++) forecast.push(Math.max(0, level + i * trend));
  return forecast;
}

// ─── Triple Exponential Smoothing (Holt-Winters Seasonal / Additive) ───
export function tripleExpSmoothingForecast(data: number[], forecastBuckets: number, seasonLength?: number, alpha = 0.3, beta = 0.1, gamma = 0.3): number[] {
  const n = data.length;
  if (n < 4) return holtWintersForecast(data, forecastBuckets, alpha, beta);
  const m = seasonLength ?? detectSeasonLength(data);
  if (m < 2 || n < 2 * m) return holtWintersForecast(data, forecastBuckets, alpha, beta);

  let level = data.slice(0, m).reduce((a, b) => a + b, 0) / m;
  let trend = 0;
  for (let i = 0; i < m; i++) trend += (data[m + i] - data[i]) / m;
  trend /= m;
  const seasonal: number[] = new Array(n + forecastBuckets).fill(0);
  for (let i = 0; i < m; i++) seasonal[i] = data[i] - level;
  for (let i = m; i < n; i++) {
    const prevLevel = level;
    level = alpha * (data[i] - seasonal[i - m]) + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[i] = gamma * (data[i] - level) + (1 - gamma) * seasonal[i - m];
  }
  const forecast: number[] = [];
  for (let i = 1; i <= forecastBuckets; i++) {
    const seasonIdx = n - m + ((i - 1) % m);
    forecast.push(Math.max(0, level + i * trend + seasonal[seasonIdx]));
  }
  return forecast;
}

// ─── Prophet-style forecast (piecewise linear trend + Fourier seasonality) ───
export function prophetForecast(data: number[], forecastBuckets: number): number[] {
  const n = data.length;
  if (n < 4) return linearForecast(data, forecastBuckets);
  const numChangepoints = Math.min(Math.max(2, Math.floor(n / 10)), 25);
  const cpIndices: number[] = [];
  for (let i = 1; i <= numChangepoints; i++) cpIndices.push(Math.round((i / (numChangepoints + 1)) * n * 0.8));
  const trend = fitPiecewiseTrend(data, cpIndices);
  const detrended = data.map((v, i) => v - trend[i]);
  const seasonality = fitFourierSeasonality(detrended, n + forecastBuckets);
  // Average slope over the last ~10% of the trend (capped 4–20 points) to dampen noise from spiky data
  const slopeWindow = Math.min(20, Math.max(4, Math.floor(n * 0.1)));
  let slopeSum = 0;
  for (let i = n - slopeWindow; i < n - 1; i++) slopeSum += trend[i + 1] - trend[i];
  const rawSlope = slopeWindow > 1 ? slopeSum / (slopeWindow - 1) : (n >= 2 ? trend[n - 1] - trend[n - 2] : 0);
  // Dampen the slope toward zero proportional to data coefficient of variation — spiky data gets more damping
  const dmean = data.reduce((a, b) => a + b, 0) / n;
  const dstd = Math.sqrt(data.reduce((a, v) => a + (v - dmean) ** 2, 0) / n);
  const cv = dmean > 0 ? dstd / dmean : 1;
  const dampFactor = Math.max(0.1, 1 - Math.min(0.9, cv * 0.5));
  const lastSlope = rawSlope * dampFactor;
  const lastLevel = trend[n - 1];
  const forecast: number[] = [];
  for (let i = 0; i < forecastBuckets; i++) forecast.push(Math.max(0, lastLevel + lastSlope * (i + 1) + seasonality[n + i]));
  return forecast;
}

function fitPiecewiseTrend(data: number[], cpIndices: number[]): number[] {
  const n = data.length;
  const breakpoints = [0, ...cpIndices, n - 1];
  const trend: number[] = new Array(n).fill(0);
  for (let seg = 0; seg < breakpoints.length - 1; seg++) {
    const start = breakpoints[seg];
    const end = breakpoints[seg + 1];
    if (end <= start) continue;
    const startVal = data[start];
    const endVal = data[end];
    for (let i = start; i <= end; i++) trend[i] = startVal + ((i - start) / (end - start)) * (endVal - startVal);
  }
  const smoothed: number[] = [...trend];
  const windowSize = Math.max(3, Math.floor(n / 20));
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(n - 1, i + windowSize); j++) { sum += trend[j]; count++; }
    smoothed[i] = sum / count;
  }
  return smoothed;
}

function fitFourierSeasonality(detrended: number[], totalLength: number): number[] {
  const n = detrended.length;
  const period = detectSeasonLength(detrended) || Math.min(n, 24);
  const numHarmonics = Math.min(4, Math.floor(period / 2));
  const coeffs: { a: number; b: number; freq: number }[] = [];
  for (let h = 1; h <= numHarmonics; h++) {
    const freq = (2 * Math.PI * h) / period;
    let sumCos = 0, sumSin = 0;
    for (let i = 0; i < n; i++) { sumCos += detrended[i] * Math.cos(freq * i); sumSin += detrended[i] * Math.sin(freq * i); }
    coeffs.push({ a: (2 * sumCos) / n, b: (2 * sumSin) / n, freq });
  }
  const seasonality: number[] = new Array(totalLength).fill(0);
  for (let i = 0; i < totalLength; i++) { for (const { a, b, freq } of coeffs) seasonality[i] += a * Math.cos(freq * i) + b * Math.sin(freq * i); }
  return seasonality;
}

// ─── ARIMA(p, d, q) forecast ───
export function arimaForecast(data: number[], forecastBuckets: number, p = 5, d = 1, q = 2): number[] {
  const n = data.length;
  if (n < p + d + 2) return linearForecast(data, forecastBuckets);
  let diffed = [...data];
  const diffHistory: number[][] = [];
  for (let dd = 0; dd < d; dd++) {
    diffHistory.push([...diffed]);
    const newDiff: number[] = [];
    for (let i = 1; i < diffed.length; i++) newDiff.push(diffed[i] - diffed[i - 1]);
    diffed = newDiff;
  }
  const arCoeffs = fitAR(diffed, p);
  const residuals: number[] = new Array(diffed.length).fill(0);
  for (let i = p; i < diffed.length; i++) {
    let predicted = 0;
    for (let j = 0; j < p; j++) predicted += arCoeffs[j] * diffed[i - j - 1];
    residuals[i] = diffed[i] - predicted;
  }
  const maCoeffs = fitMA(residuals, q);
  const extended = [...diffed];
  const extResiduals = [...residuals];
  for (let i = 0; i < forecastBuckets; i++) {
    let forecast = 0;
    for (let j = 0; j < p; j++) { const idx = extended.length - j - 1; if (idx >= 0) forecast += arCoeffs[j] * extended[idx]; }
    for (let j = 0; j < q; j++) { const idx = extResiduals.length - j - 1; if (idx >= 0) forecast += maCoeffs[j] * extResiduals[idx]; }
    extended.push(forecast);
    extResiduals.push(0);
  }
  const forecastDiffed = extended.slice(diffed.length);
  let result = [...forecastDiffed];
  for (let dd = d - 1; dd >= 0; dd--) {
    const prev = diffHistory[dd];
    const integrated: number[] = [];
    let lastVal = prev[prev.length - 1];
    for (let i = 0; i < result.length; i++) { lastVal = lastVal + result[i]; integrated.push(lastVal); }
    result = integrated;
  }
  return result.map((v) => Math.max(0, v));
}

// ─── SARIMA(p, d, q)(P, D, Q, m) forecast ───
export function sarimaForecast(data: number[], forecastBuckets: number, p = 3, d = 1, q = 1, P = 1, D = 1, Q = 1, m?: number): number[] {
  const n = data.length;
  const season = m ?? detectSeasonLength(data);
  if (n < season * 2 + p + d) return arimaForecast(data, forecastBuckets, p, d, q);
  let diffed = [...data];
  const sDiffHistory: number[][] = [];
  for (let dd = 0; dd < D; dd++) {
    sDiffHistory.push([...diffed]);
    const newDiff: number[] = [];
    for (let i = season; i < diffed.length; i++) newDiff.push(diffed[i] - diffed[i - season]);
    diffed = newDiff;
  }
  const rDiffHistory: number[][] = [];
  for (let dd = 0; dd < d; dd++) {
    rDiffHistory.push([...diffed]);
    const newDiff: number[] = [];
    for (let i = 1; i < diffed.length; i++) newDiff.push(diffed[i] - diffed[i - 1]);
    diffed = newDiff;
  }
  const arCoeffs = fitAR(diffed, p);
  const sarCoeffs = fitSeasonalAR(diffed, P, season);
  const residuals: number[] = new Array(diffed.length).fill(0);
  const startIdx = Math.max(p, P * season);
  for (let i = startIdx; i < diffed.length; i++) {
    let predicted = 0;
    for (let j = 0; j < p; j++) predicted += arCoeffs[j] * diffed[i - j - 1];
    for (let j = 0; j < P; j++) { const idx = i - (j + 1) * season; if (idx >= 0) predicted += sarCoeffs[j] * diffed[idx]; }
    residuals[i] = diffed[i] - predicted;
  }
  const maCoeffs = fitMA(residuals, q);
  const smaCoeffs = fitSeasonalMA(residuals, Q, season);
  const extended = [...diffed];
  const extResiduals = [...residuals];
  for (let i = 0; i < forecastBuckets; i++) {
    let forecast = 0;
    for (let j = 0; j < p; j++) { const idx = extended.length - j - 1; if (idx >= 0) forecast += arCoeffs[j] * extended[idx]; }
    for (let j = 0; j < P; j++) { const idx = extended.length - (j + 1) * season; if (idx >= 0) forecast += sarCoeffs[j] * extended[idx]; }
    for (let j = 0; j < q; j++) { const idx = extResiduals.length - j - 1; if (idx >= 0) forecast += maCoeffs[j] * extResiduals[idx]; }
    for (let j = 0; j < Q; j++) { const idx = extResiduals.length - (j + 1) * season; if (idx >= 0) forecast += smaCoeffs[j] * extResiduals[idx]; }
    extended.push(forecast);
    extResiduals.push(0);
  }
  let result = extended.slice(diffed.length);
  for (let dd = d - 1; dd >= 0; dd--) {
    const prev = rDiffHistory[dd];
    const integrated: number[] = [];
    let lastVal = prev[prev.length - 1];
    for (let i = 0; i < result.length; i++) { lastVal = lastVal + result[i]; integrated.push(lastVal); }
    result = integrated;
  }
  for (let dd = D - 1; dd >= 0; dd--) {
    const prev = sDiffHistory[dd];
    const integrated: number[] = [];
    for (let i = 0; i < result.length; i++) {
      const base = i < season ? prev[prev.length - season + i] : integrated[i - season];
      integrated.push(base + result[i]);
    }
    result = integrated;
  }
  return result.map((v) => Math.max(0, v));
}

// ─── Helper: detect dominant season length via autocorrelation ───
function detectSeasonLength(data: number[]): number {
  const n = data.length;
  if (n < 8) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const centered = data.map((v) => v - mean);
  const maxLag = Math.floor(n / 2);
  const acf: number[] = [];
  const variance = centered.reduce((a, v) => a + v * v, 0);
  if (variance === 0) return 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    acf.push(sum / variance);
  }
  let bestLag = 0, bestVal = -Infinity;
  for (let lag = 2; lag < acf.length; lag++) {
    if (acf[lag] > bestVal && acf[lag] > acf[lag - 1] && (lag === acf.length - 1 || acf[lag] >= acf[lag + 1])) {
      bestVal = acf[lag]; bestLag = lag; break;
    }
  }
  return bestVal > 0.1 ? bestLag : Math.min(24, Math.floor(n / 4));
}

// ─── Helper: fit AR coefficients via Yule-Walker ───
function fitAR(data: number[], order: number): number[] {
  const n = data.length;
  if (n <= order) return new Array(order).fill(0);
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const centered = data.map((v) => v - mean);
  const r: number[] = new Array(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag++) { for (let i = 0; i < n - lag; i++) r[lag] += centered[i] * centered[i + lag]; r[lag] /= n; }
  if (r[0] === 0) return new Array(order).fill(0);
  const coeffs: number[] = new Array(order).fill(0);
  const prevCoeffs: number[] = new Array(order).fill(0);
  coeffs[0] = r[1] / r[0];
  let err = r[0] * (1 - coeffs[0] * coeffs[0]);
  for (let m = 1; m < order; m++) {
    let lambda = r[m + 1];
    for (let j = 0; j < m; j++) lambda -= coeffs[j] * r[m - j];
    if (Math.abs(err) < 1e-12) break;
    const k = lambda / err;
    for (let j = 0; j < m; j++) prevCoeffs[j] = coeffs[j];
    coeffs[m] = k;
    for (let j = 0; j < m; j++) coeffs[j] = prevCoeffs[j] - k * prevCoeffs[m - 1 - j];
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return coeffs;
}

function fitSeasonalAR(data: number[], order: number, season: number): number[] {
  const n = data.length;
  if (n <= order * season) return new Array(order).fill(0);
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const centered = data.map((v) => v - mean);
  const coeffs: number[] = [];
  for (let j = 0; j < order; j++) {
    const lag = (j + 1) * season;
    if (lag >= n) { coeffs.push(0); continue; }
    let num = 0, den = 0;
    for (let i = lag; i < n; i++) { num += centered[i] * centered[i - lag]; den += centered[i - lag] * centered[i - lag]; }
    coeffs.push(den !== 0 ? num / den : 0);
  }
  return coeffs;
}

function fitMA(residuals: number[], order: number): number[] {
  const n = residuals.length;
  if (n <= order) return new Array(order).fill(0);
  const mean = residuals.reduce((a, b) => a + b, 0) / n;
  const centered = residuals.map((v) => v - mean);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += centered[i] * centered[i];
  if (r0 === 0) return new Array(order).fill(0);
  const coeffs: number[] = [];
  for (let lag = 1; lag <= order; lag++) {
    let rk = 0;
    for (let i = lag; i < n; i++) rk += centered[i] * centered[i - lag];
    coeffs.push(Math.max(-0.9, Math.min(0.9, rk / r0)));
  }
  return coeffs;
}

function fitSeasonalMA(residuals: number[], order: number, season: number): number[] {
  const n = residuals.length;
  if (n <= order * season) return new Array(order).fill(0);
  const mean = residuals.reduce((a, b) => a + b, 0) / n;
  const centered = residuals.map((v) => v - mean);
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += centered[i] * centered[i];
  if (r0 === 0) return new Array(order).fill(0);
  const coeffs: number[] = [];
  for (let j = 0; j < order; j++) {
    const lag = (j + 1) * season;
    if (lag >= n) { coeffs.push(0); continue; }
    let rk = 0;
    for (let i = lag; i < n; i++) rk += centered[i] * centered[i - lag];
    coeffs.push(Math.max(-0.9, Math.min(0.9, rk / r0)));
  }
  return coeffs;
}

// ─── Confidence band (based on historical std dev) ───
export function confidenceBand(data: number[], forecast: number[]): { upper: number[]; lower: number[] } {
  const n = data.length;
  if (n < 2) return { upper: forecast, lower: forecast };
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance = data.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return {
    upper: forecast.map((v, i) => v + std * (1 + 0.1 * i)),
    lower: forecast.map((v, i) => Math.max(0, v - std * (1 + 0.1 * i))),
  };
}

// ─── Types & Helpers ───
export interface ForecastModalProps {
  label: string;
  sparkline: number[];
  color?: string;
  fromMs: number;
  toMs: number;
  onClose: () => void;
  getRequeryData: (analyzeDays: number, datapointMinutes: number) => Promise<number[]>;
}

export type ForecastMethod = "linear" | "holt-winters" | "triple-exp" | "prophet" | "arima" | "sarima";

const ANALYZE_OPTIONS = [7, 14, 30, 60, 90];
const DATAPOINT_OPTIONS = [15, 30, 60, 720, 1440];
const FORECAST_OPTIONS = [7, 14, 30];

const DEFAULT_ANALYZE_DAYS = 30;
const DEFAULT_DATAPOINTS = 15;
const DEFAULT_FORECAST_DAYS = 7;

function datapointLabel(minutes: number): string {
  if (minutes >= 1440) return "1 day";
  if (minutes >= 60) return `${minutes / 60} hr`;
  return `${minutes} min`;
}

function formatAxisValue(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function formatDate(ts: number, short = false): string {
  const d = new Date(ts);
  if (short) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const SELECT_STYLE: React.CSSProperties = {
  background: "#1a1e38", color: "#fff", border: "1px solid rgba(128,128,128,0.4)", borderRadius: 6,
  padding: "4px 8px", fontSize: 12, cursor: "pointer", appearance: "none", WebkitAppearance: "none",
  paddingRight: 24,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M3 5l3 3 3-3'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
};

// ─── Metric metadata for deep-dive analysis ──────────────────────────────────

interface MetricMeta {
  higherIsBetter: boolean;
  good: number | null;
  poor: number | null;
  unit: string;
  formatVal: (v: number) => string;
  cwvType: boolean;
  convImpactPer1pct: number | null;
}

function detectMetricMeta(label: string, historicalData: number[]): MetricMeta {
  const lbl = label.toUpperCase();
  const sorted = [...historicalData].filter(isFinite).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const inMs = median > 10;
  const timingFmt = (v: number): string =>
    inMs ? (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)
         : (v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`);
  if (/\bLCP\b|LARGEST.CONTENTFUL/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 2500 : 2.5, poor: inMs ? 4000 : 4.0, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: true, convImpactPer1pct: 0.7 };
  if (/\bFCP\b|FIRST.CONTENTFUL/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 1800 : 1.8, poor: inMs ? 3000 : 3.0, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: true, convImpactPer1pct: 0.4 };
  if (/\bINP\b|INTERACTION.TO.NEXT/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 200 : 0.2, poor: inMs ? 500 : 0.5, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: true, convImpactPer1pct: 0.3 };
  if (/\bTTFB\b|TIME.TO.FIRST.BYTE/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 800 : 0.8, poor: inMs ? 1800 : 1.8, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: true, convImpactPer1pct: 0.3 };
  if (/\bCLS\b|CUMULATIVE.LAYOUT/.test(lbl))
    return { higherIsBetter: false, good: 0.1, poor: 0.25, unit: "", formatVal: (v) => v.toFixed(3), cwvType: true, convImpactPer1pct: 1.5 };
  if (/\bFID\b|FIRST.INPUT.DELAY/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 100 : 0.1, poor: inMs ? 300 : 0.3, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: true, convImpactPer1pct: 0.2 };
  if (/APDEX/.test(lbl))
    return { higherIsBetter: true, good: 0.85, poor: 0.7, unit: "", formatVal: (v) => v.toFixed(3), cwvType: false, convImpactPer1pct: 5 };
  if (/ERROR.?RATE|ERROR\s*%/.test(lbl))
    return { higherIsBetter: false, good: 1, poor: 5, unit: "%", formatVal: (v) => `${v.toFixed(1)}%`, cwvType: false, convImpactPer1pct: 2 };
  if (/CONVERSION/.test(lbl))
    return { higherIsBetter: true, good: null, poor: null, unit: "%", formatVal: (v) => `${v.toFixed(2)}%`, cwvType: false, convImpactPer1pct: null };
  if (/REVENUE/.test(lbl))
    return { higherIsBetter: true, good: null, poor: null, unit: "$", formatVal: (v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`, cwvType: false, convImpactPer1pct: null };
  if (/DURATION|LOAD.TIME/.test(lbl))
    return { higherIsBetter: false, good: inMs ? 3000 : 3, poor: inMs ? 8000 : 8, unit: inMs ? "ms" : "s", formatVal: timingFmt, cwvType: false, convImpactPer1pct: 0.5 };
  return { higherIsBetter: true, good: null, poor: null, unit: "", formatVal: formatAxisValue, cwvType: false, convImpactPer1pct: null };
}

function copyText(text: string): void {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch { /* silent */ }
  document.body.removeChild(el);
}

function getDtTenantBase(): string {
  // Inside a DT app the origin is a sandboxed subdomain: "hash--tenantId.prodN.apps.dynatrace.com"
  // Strip the hash prefix and prodN segment to get the canonical tenant URL.
  const m = window.location.origin.match(/--([^.]+)\.(prod|dev)\d*\.apps\.dynatrace\.com$/i);
  return m ? `https://${m[1]}.apps.dynatrace.com` : window.location.origin;
}

function buildAnomalyDql(label: string, meta: MetricMeta): string | null {
  const lbl = label.toUpperCase();
  const threshold = meta.poor ?? meta.good;
  if (threshold == null) return null;
  const op = meta.higherIsBetter ? "<" : ">";
  type Spec = { expr: string; name: string; extra: string };
  const spec: Spec | null =
    /\bLCP\b|LARGEST.CONTENTFUL/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.largest_contentful_paint) / 1000000.0, 75)", name: "p75_lcp", extra: "\n| filter characteristics.has_page_summary == true" } :
    /\bINP\b|INTERACTION.TO.NEXT/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.interaction_to_next_paint) / 1000000.0, 75)", name: "p75_inp", extra: "\n| filter isNotNull(web_vitals.interaction_to_next_paint) and toDouble(web_vitals.interaction_to_next_paint) > 0" } :
    /\bFCP\b|FIRST.CONTENTFUL/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.first_contentful_paint) / 1000000.0, 75)", name: "p75_fcp", extra: "\n| filter characteristics.has_page_summary == true" } :
    /\bTTFB\b|TIME.TO.FIRST.BYTE/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.time_to_first_byte) / 1000000.0, 75)", name: "p75_ttfb", extra: "\n| filter characteristics.has_page_summary == true" } :
    /\bCLS\b|CUMULATIVE.LAYOUT/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.cumulative_layout_shift), 75)", name: "p75_cls", extra: "\n| filter characteristics.has_page_summary == true" } :
    /\bFID\b|FIRST.INPUT.DELAY/.test(lbl) ? { expr: "percentile(toDouble(web_vitals.first_input_delay) / 1000000.0, 75)", name: "p75_fid", extra: "" } :
    /APDEX/.test(lbl) ? { expr: "avg(toDouble(apdex_score))", name: "avg_apdex", extra: "" } :
    /ERROR.?RATE|ERROR\s*%/.test(lbl) ? { expr: "countIf(error == true) / toDouble(count()) * 100", name: "error_rate_pct", extra: "" } :
    /DURATION|LOAD.TIME/.test(lbl) ? { expr: "avg(toDouble(duration)) / 1000000.0", name: "avg_dur_s", extra: "" } :
    null;
  if (!spec) return null;
  return `fetch user.events, from: now()-1h${spec.extra}\n| summarize ${spec.name} = ${spec.expr}\n| filter ${spec.name} ${op} ${threshold}`;
}

interface NextStep { text: string; copyDql?: string; anomalyLink?: boolean; }

export function ForecastModal({ label, sparkline, color = "#4589FF", onClose, getRequeryData }: ForecastModalProps) {
  const [method, setMethod] = useState<ForecastMethod>("prophet");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [copiedStepIdx, setCopiedStepIdx] = useState<number | null>(null);

  // Pending (uncommitted) selections
  const [pendingAnalyzeDays, setPendingAnalyzeDays] = useState(DEFAULT_ANALYZE_DAYS);
  const [pendingDatapoints, setPendingDatapoints] = useState(DEFAULT_DATAPOINTS);
  const [pendingForecastDays, setPendingForecastDays] = useState(DEFAULT_FORECAST_DAYS);

  // Applied (active) values that drive the chart
  const [appliedAnalyzeDays, setAppliedAnalyzeDays] = useState(DEFAULT_ANALYZE_DAYS);
  const [appliedDatapoints, setAppliedDatapoints] = useState(DEFAULT_DATAPOINTS);
  const [appliedForecastDays, setAppliedForecastDays] = useState(DEFAULT_FORECAST_DAYS);

  // Active sparkline — starts as prop, replaced by requery results
  const [activeSparkline, setActiveSparkline] = useState<number[]>(sparkline);
  const [isRequerying, setIsRequerying] = useState(false);
  const [requeryError, setRequeryError] = useState<string | null>(null);

  const isDirty = pendingAnalyzeDays !== appliedAnalyzeDays
    || pendingDatapoints !== appliedDatapoints
    || pendingForecastDays !== appliedForecastDays;

  // Load with defaults on mount
  useEffect(() => {
    setIsRequerying(true);
    setRequeryError(null);
    getRequeryData(DEFAULT_ANALYZE_DAYS, DEFAULT_DATAPOINTS)
      .then((data) => { if (data.length > 0) setActiveSparkline(data); })
      .catch(() => setRequeryError("Failed to load data"))
      .finally(() => setIsRequerying(false));
  }, []); // intentionally only on mount

  const handleApply = useCallback(async () => {
    const needsRequery = pendingAnalyzeDays !== appliedAnalyzeDays || pendingDatapoints !== appliedDatapoints;
    if (needsRequery) {
      setIsRequerying(true);
      setRequeryError(null);
      try {
        const data = await getRequeryData(pendingAnalyzeDays, pendingDatapoints);
        if (data.length > 0) setActiveSparkline(data);
      } catch {
        setRequeryError("Requery failed — showing previous data");
      } finally {
        setIsRequerying(false);
      }
    }
    setAppliedAnalyzeDays(pendingAnalyzeDays);
    setAppliedDatapoints(pendingDatapoints);
    setAppliedForecastDays(pendingForecastDays);
  }, [pendingAnalyzeDays, pendingDatapoints, pendingForecastDays, appliedAnalyzeDays, appliedDatapoints, getRequeryData]);

  const historicalData = useMemo(() => activeSparkline.filter((v) => v != null && isFinite(v)), [activeSparkline]);

  const activeFromMs = Date.now() - appliedAnalyzeDays * 24 * 3600 * 1000;
  const activeToMs = Date.now();

  const forecastData = useMemo(() => {
    if (historicalData.length < 2) return [];
    const duration = activeToMs - activeFromMs;
    const bucketMs = duration / historicalData.length;
    const forecastMs = appliedForecastDays * 24 * 3600 * 1000;
    const forecastBuckets = Math.max(2, Math.round(forecastMs / bucketMs));
    switch (method) {
      case "linear": return linearForecast(historicalData, forecastBuckets);
      case "holt-winters": return holtWintersForecast(historicalData, forecastBuckets);
      case "triple-exp": return tripleExpSmoothingForecast(historicalData, forecastBuckets);
      case "prophet": return prophetForecast(historicalData, forecastBuckets);
      case "arima": return arimaForecast(historicalData, forecastBuckets);
      case "sarima": return sarimaForecast(historicalData, forecastBuckets);
      default: return holtWintersForecast(historicalData, forecastBuckets);
    }
  }, [historicalData, method, appliedAnalyzeDays, appliedForecastDays, activeFromMs, activeToMs]);

  const confidence = useMemo(() => confidenceBand(historicalData, forecastData), [historicalData, forecastData]);

  const confidenceScore = useMemo(() => {
    const n = historicalData.length;
    if (n < 3) return null;
    const mean = historicalData.reduce((a, b) => a + b, 0) / n;
    if (mean === 0) return null;
    const std = Math.sqrt(historicalData.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
    const cv = std / Math.abs(mean);
    return Math.round(Math.max(40, Math.min(98, (1 - Math.min(1, cv * 1.5)) * 100)));
  }, [historicalData]);

  const metricMeta = useMemo(() => detectMetricMeta(label, historicalData), [label, historicalData]);

  const rateAnalysis = useMemo(() => {
    if (historicalData.length < 4) return null;
    const durationMs = activeToMs - activeFromMs;
    const bucketMs = durationMs / historicalData.length;
    const bucketsPerDay = 86400000 / Math.max(1, bucketMs);
    const recentN = Math.max(4, Math.floor(historicalData.length * 0.15));
    const recentSlice = historicalData.slice(-recentN);
    const earlySlice = historicalData.slice(0, recentN);
    const recentSlope = recentSlice.length >= 2 ? (recentSlice[recentSlice.length - 1] - recentSlice[0]) / (recentN / bucketsPerDay) : 0;
    const earlySlope = earlySlice.length >= 2 ? (earlySlice[earlySlice.length - 1] - earlySlice[0]) / (recentN / bucketsPerDay) : 0;
    const isAccelerating = Math.abs(recentSlope) > Math.abs(earlySlope) * 1.4 && Math.sign(recentSlope) === Math.sign(earlySlope);
    const isTrendingBad = metricMeta.higherIsBetter ? recentSlope < 0 : recentSlope > 0;
    return { perDay: recentSlope, isAccelerating, isTrendingBad };
  }, [historicalData, activeFromMs, activeToMs, metricMeta]);

  const breachAnalysis = useMemo(() => {
    const { good, poor, higherIsBetter } = metricMeta;
    if (historicalData.length === 0) return null;
    const current = historicalData[historicalData.length - 1];
    const projected = forecastData.length > 0 ? forecastData[forecastData.length - 1] : current;
    const zone = (v: number): "good" | "needs_improvement" | "poor" | "unknown" => {
      if (good == null && poor == null) return "unknown";
      if (higherIsBetter) {
        if (good != null && v >= good) return "good";
        if (poor != null && v >= poor) return "needs_improvement";
        return "poor";
      } else {
        if (good != null && v <= good) return "good";
        if (poor != null && v <= poor) return "needs_improvement";
        return "poor";
      }
    };
    const durationMs = activeToMs - activeFromMs;
    const bucketMs = historicalData.length > 0 ? durationMs / historicalData.length : 900000;
    const bucketsPerDay = 86400000 / Math.max(1, bucketMs);
    let daysToGoodBreach: number | null = null;
    let daysToPoorBreach: number | null = null;
    for (let i = 0; i < forecastData.length; i++) {
      const v = forecastData[i];
      if (good != null && daysToGoodBreach == null && (higherIsBetter ? v < good : v > good)) daysToGoodBreach = +(i / bucketsPerDay).toFixed(1);
      if (poor != null && daysToPoorBreach == null && (higherIsBetter ? v < poor : v > poor)) daysToPoorBreach = +(i / bucketsPerDay).toFixed(1);
    }
    return { current, projected, currentZone: zone(current), projectedZone: zone(projected), daysToGoodBreach, daysToPoorBreach, zone };
  }, [historicalData, forecastData, metricMeta, activeFromMs, activeToMs]);

  const businessImpact = useMemo(() => {
    if (!metricMeta.convImpactPer1pct || !breachAnalysis) return null;
    const { current, projected } = breachAnalysis;
    if (current === 0) return null;
    const change = projected - current;
    const pctChange = Math.abs(change / current) * 100;
    const isBad = metricMeta.higherIsBetter ? change < 0 : change > 0;
    if (!isBad || pctChange < 1) return null;
    const convDrop = Math.min(25, pctChange * metricMeta.convImpactPer1pct / 100);
    return { convDropPct: +convDrop.toFixed(1), abandonmentPct: +(convDrop * 0.7).toFixed(1), metricPctChange: +pctChange.toFixed(0) };
  }, [breachAnalysis, metricMeta]);

  const recoveryProb = useMemo((): { level: "low" | "medium" | "high"; reason: string } => {
    const n = historicalData.length;
    if (n < 8) return { level: "medium", reason: "Insufficient history for recovery analysis" };
    const mean = historicalData.reduce((a, b) => a + b, 0) / n;
    const centered = historicalData.map(v => v - mean);
    const variance = centered.reduce((a, v) => a + v * v, 0);
    if (variance === 0) return { level: "high", reason: "Metric is perfectly stable" };
    let acf1 = 0;
    for (let i = 0; i < n - 1; i++) acf1 += centered[i] * centered[i + 1];
    acf1 /= variance;
    if (acf1 > 0.65) return { level: "low", reason: `High persistence (${(acf1 * 100).toFixed(0)}% autocorrelation) — rarely self-corrects` };
    if (acf1 > 0.35) return { level: "medium", reason: "Moderate persistence — may partially self-correct" };
    return { level: "high", reason: "Low persistence — volatile metric, may self-correct" };
  }, [historicalData]);

  const urgency = useMemo((): "act_now" | "monitor" | "on_track" => {
    if (!breachAnalysis || breachAnalysis.currentZone === "unknown") return "monitor";
    const { currentZone, daysToPoorBreach, daysToGoodBreach } = breachAnalysis;
    if (currentZone === "poor") return "act_now";
    if (currentZone === "needs_improvement") {
      if (daysToPoorBreach != null && daysToPoorBreach <= 3) return "act_now";
      if (rateAnalysis?.isAccelerating) return "act_now";
      return "monitor";
    }
    if (daysToGoodBreach != null && daysToGoodBreach <= 2 && (confidenceScore ?? 0) >= 50) return "act_now";
    if (daysToGoodBreach != null) return "monitor";
    return "on_track";
  }, [breachAnalysis, rateAnalysis, confidenceScore]);

  const nextSteps = useMemo((): NextStep[] => {
    const steps: NextStep[] = [];
    const { good, higherIsBetter, cwvType, formatVal } = metricMeta;
    const alertStep: NextStep | null = good != null ? {
      text: `Set a Dynatrace anomaly detection rule when ${label} ${higherIsBetter ? "falls below" : "exceeds"} ${formatVal(good)} to catch degradation early.`,
      copyDql: buildAnomalyDql(label, metricMeta) ?? undefined,
      anomalyLink: true,
    } : null;
    if (urgency === "act_now" || urgency === "monitor") {
      steps.push({ text: "Check the Change Intelligence tab for deployments in the past 72 hours — correlate timing with when the trend started." });
      if (cwvType) steps.push({ text: "Use 🌍 Dimension from the KPI card dropdown to break down by browser, OS, and geography — isolate whether degradation is segment-specific or global." });
      if (urgency === "act_now") steps.push({ text: "Open Dynatrace Davis AI (Causation) for automated root cause analysis on this metric." });
      if (alertStep) steps.push(alertStep);
      if (businessImpact && businessImpact.convDropPct > 2) steps.push({ text: `Validate in Business Analytics — a ${businessImpact.convDropPct}% conversion drop at this trajectory should appear in revenue data within 24–48 hours.` });
    } else {
      steps.push({ text: "Metric is on a healthy trajectory — maintain current monitoring and alert thresholds." });
      if (cwvType) steps.push({ text: "Run a periodic 🌍 Dimension check to confirm no specific segment is quietly degrading beneath the aggregate." });
      if (alertStep) steps.push(alertStep);
    }
    return steps.slice(0, 5);
  }, [urgency, metricMeta, breachAnalysis, businessImpact, label]);

  const svgRef = useRef<SVGSVGElement>(null);

  const exportForecastPdf = useCallback(() => {
    const svgEl = svgRef.current;
    let svgString = svgEl ? new XMLSerializer().serializeToString(svgEl) : "";
    // Make SVG responsive in the PDF by adding viewBox and removing fixed dimensions
    svgString = svgString
      .replace(/ width="\d+"/, "")
      .replace(/ height="\d+"/, "")
      .replace("<svg ", `<svg viewBox="0 0 900 400" `);

    const confidenceColor = (confidenceScore ?? 0) >= 80 ? "#0D9C29" : (confidenceScore ?? 0) >= 60 ? "#FFC800" : "#FF9040";
    const confidenceLabel = (confidenceScore ?? 0) >= 80 ? "High" : (confidenceScore ?? 0) >= 60 ? "Moderate" : "Low";
    const urgencyColor = urgency === "act_now" ? "#E00000" : urgency === "monitor" ? "#FFC800" : "#0D9C29";
    const urgencyLabel = urgency === "act_now" ? "ACT NOW" : urgency === "monitor" ? "MONITOR" : "ON TRACK";
    const urgencyEmoji = urgency === "act_now" ? "🔴" : urgency === "monitor" ? "🟡" : "🟢";
    const urgencyDesc = urgency === "act_now"
      ? breachAnalysis?.currentZone === "poor"
        ? `${label} is already in the "Poor" zone — immediate investigation recommended`
        : breachAnalysis?.daysToPoorBreach != null
          ? `Projected to breach "Poor" in ~${Math.ceil(breachAnalysis.daysToPoorBreach)}d at current rate${rateAnalysis?.isAccelerating ? " — and accelerating" : ""}`
          : "Trend is degrading rapidly — intervention recommended"
      : urgency === "monitor"
      ? breachAnalysis?.daysToPoorBreach != null
        ? `Trending toward "Poor" threshold — possible breach in ~${Math.ceil(breachAnalysis.daysToPoorBreach)}d`
        : `${label} is in "Needs Improvement" — watch for continued degradation`
      : `${label} is within healthy bounds across the ${appliedForecastDays}-day horizon`;

    const methodLabels: Record<string, string> = {
      "holt-winters": "Holt-Winters (Double Exp.)",
      "triple-exp": "Triple Exp. Smoothing",
      prophet: "Prophet",
      arima: "ARIMA",
      sarima: "SARIMA",
      linear: "Linear Regression",
    };

    const zoneLabel = (z: string) => z === "good" ? "✓ Good" : z === "needs_improvement" ? "⚠ Needs Improvement" : "✗ Poor";

    const metricsHtml = breachAnalysis ? `
      <div class="metrics-row">
        <div class="metric-cell">
          <div class="metric-label">Current Value</div>
          <div class="metric-val zone-${breachAnalysis.currentZone}">${metricMeta.formatVal(breachAnalysis.current)}</div>
          ${breachAnalysis.currentZone !== "unknown" ? `<div class="zone-badge zone-${breachAnalysis.currentZone}">${zoneLabel(breachAnalysis.currentZone)}</div>` : ""}
        </div>
        <div class="metric-cell">
          <div class="metric-label">${appliedForecastDays}d Projection</div>
          <div class="metric-val zone-${breachAnalysis.projectedZone}">${metricMeta.formatVal(breachAnalysis.projected)}</div>
          ${breachAnalysis.projectedZone !== "unknown" ? `<div class="zone-badge zone-${breachAnalysis.projectedZone}">${zoneLabel(breachAnalysis.projectedZone)}</div>` : ""}
        </div>
        <div class="metric-cell">
          <div class="metric-label">Rate / Day</div>
          <div class="metric-val zone-${rateAnalysis?.isTrendingBad ? (rateAnalysis.isAccelerating ? "poor" : "needs_improvement") : "good"}">${rateAnalysis ? `${rateAnalysis.perDay > 0 ? "+" : ""}${metricMeta.formatVal(Math.abs(rateAnalysis.perDay))}${rateAnalysis.isAccelerating ? " ⚡" : ""}` : "—"}</div>
          ${rateAnalysis?.isAccelerating ? `<div class="accel">Accelerating</div>` : ""}
        </div>
      </div>` : "";

    const breachHtml = breachAnalysis && (breachAnalysis.daysToGoodBreach != null || breachAnalysis.daysToPoorBreach != null) ? `
      <div class="breach-row">
        ${breachAnalysis.daysToGoodBreach != null ? `<span>⚠ Exits "Good" in <strong style="color:#FFC800">~${Math.ceil(breachAnalysis.daysToGoodBreach)}d</strong></span>` : ""}
        ${breachAnalysis.daysToPoorBreach != null ? `<span>✗ Enters "Poor" in <strong style="color:#E00000">~${Math.ceil(breachAnalysis.daysToPoorBreach)}d</strong></span>` : ""}
        <span style="margin-left:auto">Recovery probability: <strong style="color:${recoveryProb.level === "low" ? "#E00000" : recoveryProb.level === "medium" ? "#FFC800" : "#0D9C29"}">${recoveryProb.level === "low" ? "Low" : recoveryProb.level === "medium" ? "Medium" : "High"}</strong> <span style="font-size:10px;opacity:0.6">(${recoveryProb.reason})</span></span>
      </div>` : "";

    const businessHtml = businessImpact ? `
      <div class="business-impact">
        <div class="section-title" style="color:#E00000">If nothing is done — ${appliedForecastDays}-day impact estimate</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <span>📉 Est. conversion drop: <strong style="color:#E00000">−${businessImpact.convDropPct}%</strong></span>
          <span>🚪 Session abandonment: <strong style="color:#FFC800">+${businessImpact.abandonmentPct}%</strong></span>
          ${metricMeta.cwvType ? "<span>📊 CWV score will likely decline further</span>" : ""}
          ${/LCP|FCP|INP|TTFB/i.test(label) ? "<span>⭐ Apdex likely to follow without intervention</span>" : ""}
        </div>
      </div>` : "";

    const stepsHtml = nextSteps.map((step, i) => `
      <div class="step">
        <span class="step-num">${i + 1}.</span>
        <div class="step-body">
          <p>${step.text}</p>
          ${step.copyDql ? `<pre class="dql">${step.copyDql}</pre>` : ""}
        </div>
      </div>`).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${label} — ${appliedForecastDays}-Day Forecast</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0e1224;color:#e0e0f0;font-family:'Segoe UI',system-ui,sans-serif;padding:32px;font-size:13px}
@media print{body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;padding:.4in}@page{margin:.5in;size:A4 landscape}.no-print{display:none!important}}
h1{font-size:20px;font-weight:800;color:#fff;margin-bottom:2px}
.subtitle{font-size:11px;color:rgba(255,255,255,.45);margin-bottom:6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;border-bottom:1px solid rgba(128,128,128,.2);padding-bottom:14px}
.header-meta{font-size:11px;color:rgba(255,255,255,.5);text-align:right}
.chart-wrap{margin-bottom:16px}
.chart-wrap svg{width:100%!important;height:auto!important;display:block}
.confidence-row{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:16px;font-size:12px}
.conf-bar-bg{width:100px;height:5px;border-radius:3px;background:rgba(128,128,128,.2);overflow:hidden}
.conf-bar-fill{height:100%;border-radius:3px}
.legend{display:flex;gap:24px;justify-content:center;margin-bottom:20px;font-size:12px;color:rgba(255,255,255,.7);flex-wrap:wrap}
.legend-item{display:flex;align-items:center;gap:6px}
.deep-dive{border:1px solid rgba(128,128,128,.15);border-radius:10px;overflow:hidden}
.urgency-header{padding:12px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(128,128,128,.1)}
.urgency-label{font-size:16px;font-weight:800;letter-spacing:.03em}
.urgency-desc{font-size:12px;color:rgba(255,255,255,.6);margin-top:2px}
.metrics-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid rgba(128,128,128,.1)}
.metric-cell{padding:14px 16px;text-align:center;border-right:1px solid rgba(128,128,128,.1)}
.metric-cell:last-child{border-right:none}
.metric-label{font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.metric-val{font-size:22px;font-weight:800}
.zone-good{color:#0D9C29}.zone-needs_improvement{color:#FFC800}.zone-poor{color:#E00000}.zone-unknown{color:rgba(255,255,255,.85)}
.zone-badge{font-size:10px;margin-top:4px}
.accel{font-size:10px;margin-top:4px;color:#FFC800}
.breach-row{padding:10px 20px;border-bottom:1px solid rgba(128,128,128,.1);display:flex;gap:20px;flex-wrap:wrap;align-items:center;font-size:12px;color:rgba(255,255,255,.6)}
.business-impact{padding:12px 20px;border-bottom:1px solid rgba(128,128,128,.1);background:rgba(224,0,0,.04);font-size:12px;color:rgba(255,255,255,.65)}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.next-steps{padding:14px 20px}
.step{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;font-size:12px;color:rgba(255,255,255,.72);line-height:1.55}
.step-num{font-weight:700;flex-shrink:0;color:${color}}
.step-body{flex:1}.step-body p{margin:0 0 4px}
.dql{margin:6px 0;padding:8px 12px;background:rgba(0,0,0,.35);border:1px solid rgba(128,128,128,.2);border-radius:6px;font-size:10px;font-family:Consolas,monospace;color:rgba(255,255,255,.75);white-space:pre-wrap;word-break:break-all;line-height:1.6}
.print-btn{margin-top:24px;display:flex;justify-content:center}
button.print-action{padding:8px 24px;background:rgba(69,137,255,.85);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>${label} — ${appliedForecastDays}-Day Forecast</h1>
    <div class="subtitle">${formatDate(activeFromMs)} → ${formatDate(activeToMs + appliedForecastDays * 24 * 3600 * 1000)}</div>
  </div>
  <div class="header-meta">
    <div>Method: ${methodLabels[method] ?? method}</div>
    <div>Analyze: ${appliedAnalyzeDays}d &nbsp;|&nbsp; Datapoints: ${datapointLabel(appliedDatapoints)} &nbsp;|&nbsp; Forecast: ${appliedForecastDays}d</div>
    <div style="margin-top:4px;opacity:0.6">Generated: ${new Date().toLocaleString()}</div>
  </div>
</div>
<div class="chart-wrap">${svgString}</div>
${confidenceScore !== null ? `
<div class="confidence-row">
  <span style="color:rgba(255,255,255,.45)">Forecast Confidence:</span>
  <span style="font-size:14px;font-weight:700;color:${confidenceColor}">${confidenceScore}%</span>
  <div class="conf-bar-bg"><div class="conf-bar-fill" style="width:${confidenceScore}%;background:${confidenceColor}"></div></div>
  <span style="font-size:11px;color:rgba(255,255,255,.3)">${confidenceLabel} — based on historical volatility</span>
</div>` : ""}
<div class="legend">
  <div class="legend-item"><svg width="24" height="3"><line x1="0" y1="1.5" x2="24" y2="1.5" stroke="${color}" stroke-width="2"/></svg><span>Historical (${appliedAnalyzeDays}d)</span></div>
  <div class="legend-item"><svg width="24" height="3"><line x1="0" y1="1.5" x2="24" y2="1.5" stroke="${color}" stroke-width="2" stroke-dasharray="4,3"/></svg><span>Forecast (${appliedForecastDays}d)</span></div>
  <div class="legend-item"><svg width="16" height="12"><rect x="0" y="0" width="16" height="12" fill="${color}" fill-opacity="0.15" rx="2"/></svg><span>Confidence Band</span></div>
  <div class="legend-item"><svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="${color}"/></svg><span>Data Points (${datapointLabel(appliedDatapoints)})</span></div>
</div>
${breachAnalysis ? `
<div class="deep-dive">
  <div class="urgency-header" style="background:${urgency === "act_now" ? "rgba(224,0,0,.12)" : urgency === "monitor" ? "rgba(255,200,0,.08)" : "rgba(13,156,41,.08)"}">
    <span style="font-size:22px">${urgencyEmoji}</span>
    <div>
      <div class="urgency-label" style="color:${urgencyColor}">${urgencyLabel}</div>
      <div class="urgency-desc">${urgencyDesc}</div>
    </div>
  </div>
  ${metricsHtml}
  ${breachHtml}
  ${businessHtml}
  <div class="next-steps">
    <div class="section-title" style="color:${color};margin-bottom:10px">Recommended Next Steps</div>
    ${stepsHtml}
  </div>
</div>` : ""}
<div class="print-btn no-print">

</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }, [label, appliedForecastDays, appliedAnalyzeDays, appliedDatapoints, method, confidenceScore, breachAnalysis, businessImpact, nextSteps, urgency, metricMeta, rateAnalysis, recoveryProb, color, activeFromMs, activeToMs]);

  const allValues = useMemo(() => [...historicalData, ...forecastData, ...confidence.upper], [historicalData, forecastData, confidence.upper]);
  const totalPoints = historicalData.length + forecastData.length;

  const MARGIN = { top: 40, right: 60, bottom: 60, left: 70 };
  const W = 900;
  const H = 400;
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top - MARGIN.bottom;

  const yMin = Math.min(0, ...allValues.filter(isFinite));
  const yMax = Math.max(...[...historicalData, ...forecastData].filter(isFinite)) * 1.1 || 1;
  const yRange = yMax - yMin || 1;

  const xScale = (i: number) => MARGIN.left + (totalPoints > 1 ? (i / (totalPoints - 1)) * plotW : 0);
  const yScale = (v: number) => MARGIN.top + plotH - ((v - yMin) / yRange) * plotH;

  const duration = activeToMs - activeFromMs;
  const bucketMs = historicalData.length > 0 ? duration / historicalData.length : appliedDatapoints * 60000;

  const timeLabels = useMemo(() => {
    if (totalPoints < 2) return [];
    const labels: { x: number; text: string }[] = [];
    const totalDuration = duration + appliedForecastDays * 24 * 3600 * 1000;
    const labelCount = Math.min(12, totalPoints);
    const step = Math.max(1, Math.floor(totalPoints / labelCount));
    for (let i = 0; i < totalPoints; i += step) {
      const ts = activeFromMs + i * bucketMs;
      labels.push({ x: xScale(i), text: formatDate(ts, totalDuration > 5 * 24 * 3600 * 1000) });
    }
    return labels;
  }, [totalPoints, activeFromMs, bucketMs, duration, appliedForecastDays]);

  const yTicks = useMemo(() => {
    const count = 6;
    const ticks: { y: number; value: number }[] = [];
    for (let i = 0; i <= count; i++) {
      const value = yMin + (yRange * i) / count;
      ticks.push({ y: yScale(value), value });
    }
    return ticks;
  }, [yMin, yRange]);

  const historicalPath = historicalData.map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(" ");
  const forecastPath = forecastData.map((v, i) => {
    const idx = historicalData.length + i;
    return `${i === 0 ? "M" : "L"}${xScale(idx).toFixed(1)},${yScale(v).toFixed(1)}`;
  }).join(" ");
  const connectionPath = historicalData.length > 0 && forecastData.length > 0
    ? `M${xScale(historicalData.length - 1).toFixed(1)},${yScale(historicalData[historicalData.length - 1]).toFixed(1)} L${xScale(historicalData.length).toFixed(1)},${yScale(forecastData[0]).toFixed(1)}`
    : "";

  const confidencePoly = useMemo(() => {
    if (confidence.upper.length === 0) return "";
    const upper = confidence.upper.map((v, i) => `${xScale(historicalData.length + i).toFixed(1)},${yScale(v).toFixed(1)}`);
    const lower = [...confidence.lower].reverse().map((v, i) => `${xScale(historicalData.length + confidence.lower.length - 1 - i).toFixed(1)},${yScale(v).toFixed(1)}`);
    return [...upper, ...lower].join(" ");
  }, [confidence, historicalData.length]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round(((x - MARGIN.left) / plotW) * (totalPoints - 1));
    setHoverIdx(Math.max(0, Math.min(totalPoints - 1, idx)));
  };

  const hoverValue = hoverIdx !== null
    ? hoverIdx < historicalData.length ? historicalData[hoverIdx] : forecastData[hoverIdx - historicalData.length]
    : null;
  const hoverTs = hoverIdx !== null ? activeFromMs + hoverIdx * bucketMs : null;
  const isForecastPoint = hoverIdx !== null && hoverIdx >= historicalData.length;

  // "Now" is at the boundary between history and forecast — index historicalData.length,
  // which maps to activeToMs via: activeFromMs + length * bucketMs = activeToMs.
  const nowX = historicalData.length > 0 && forecastData.length > 0
    ? xScale(historicalData.length)
    : historicalData.length > 0 ? xScale(historicalData.length - 1) : null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0, 0, 0, 0.8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "rgba(20, 24, 46, 0.97)", borderRadius: 12, padding: "24px 32px", maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.5)", border: "1px solid rgba(128,128,128,0.2)" }}>

        {/* Header row 1: title + model selector + close */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: "#fff", fontSize: 18, fontWeight: 700 }}>{label} — {appliedForecastDays}-Day Forecast</h2>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              {formatDate(activeFromMs)} → {formatDate(activeToMs + appliedForecastDays * 24 * 3600 * 1000)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={method} onChange={(e) => setMethod(e.target.value as ForecastMethod)} style={SELECT_STYLE}>
              <option value="holt-winters" style={{ background: "#1a1e38", color: "#fff" }}>Holt-Winters (Double Exp.)</option>
              <option value="triple-exp" style={{ background: "#1a1e38", color: "#fff" }}>Triple Exp. Smoothing</option>
              <option value="prophet" style={{ background: "#1a1e38", color: "#fff" }}>Prophet</option>
              <option value="arima" style={{ background: "#1a1e38", color: "#fff" }}>ARIMA</option>
              <option value="sarima" style={{ background: "#1a1e38", color: "#fff" }}>SARIMA</option>
              <option value="linear" style={{ background: "#1a1e38", color: "#fff" }}>Linear Regression</option>
            </select>
            <button onClick={exportForecastPdf} style={{ background: "rgba(69,137,255,0.1)", color: "#4589FF", border: "1px solid rgba(69,137,255,0.35)", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              📄 PDF
            </button>
            <button onClick={onClose} style={{ background: "rgba(128,128,128,0.2)", color: "#fff", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              ✕ Close
            </button>
          </div>
        </div>

        {/* Header row 2: analysis controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "8px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 6, border: "1px solid rgba(128,128,128,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Analyze</span>
            <select value={pendingAnalyzeDays} onChange={(e) => setPendingAnalyzeDays(Number(e.target.value))} style={SELECT_STYLE}>
              {ANALYZE_OPTIONS.map((d) => (
                <option key={d} value={d} style={{ background: "#1a1e38", color: "#fff" }}>{d} days</option>
              ))}
            </select>
          </div>
          <div style={{ width: 1, height: 20, background: "rgba(128,128,128,0.25)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Datapoints</span>
            <select value={pendingDatapoints} onChange={(e) => setPendingDatapoints(Number(e.target.value))} style={SELECT_STYLE}>
              {DATAPOINT_OPTIONS.map((m) => (
                <option key={m} value={m} style={{ background: "#1a1e38", color: "#fff" }}>{datapointLabel(m)}</option>
              ))}
            </select>
          </div>
          <div style={{ width: 1, height: 20, background: "rgba(128,128,128,0.25)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>Forecast</span>
            <select value={pendingForecastDays} onChange={(e) => setPendingForecastDays(Number(e.target.value))} style={SELECT_STYLE}>
              {FORECAST_OPTIONS.map((d) => (
                <option key={d} value={d} style={{ background: "#1a1e38", color: "#fff" }}>{d} days</option>
              ))}
            </select>
          </div>
          {isDirty && (
            <button
              onClick={handleApply}
              disabled={isRequerying}
              style={{ marginLeft: 4, background: isRequerying ? "rgba(69,137,255,0.3)" : "rgba(69,137,255,0.85)", color: "#fff", border: "1px solid rgba(69,137,255,0.6)", borderRadius: 6, padding: "5px 16px", fontSize: 12, cursor: isRequerying ? "not-allowed" : "pointer", fontWeight: 600, transition: "background 0.15s" }}
            >
              {isRequerying ? "Loading…" : "Apply"}
            </button>
          )}
          {requeryError && (
            <span style={{ fontSize: 11, color: "#FF9040", marginLeft: 4 }}>{requeryError}</span>
          )}
        </div>

        {/* Chart */}
        <div style={{ position: "relative" }}>
          {isRequerying && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(20,24,46,0.7)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, zIndex: 2 }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Loading data…</span>
            </div>
          )}
          <svg ref={svgRef} width={W} height={H} style={{ display: "block", cursor: "crosshair" }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
            {yTicks.map((t, i) => (
              <g key={i}>
                <line x1={MARGIN.left} y1={t.y} x2={W - MARGIN.right} y2={t.y} stroke="rgba(128,128,128,0.15)" strokeWidth={1} />
                <text x={MARGIN.left - 8} y={t.y + 4} textAnchor="end" fill="rgba(255,255,255,0.6)" fontSize={11}>{formatAxisValue(t.value)}</text>
              </g>
            ))}
            {timeLabels.map((l, i) => (
              <text key={i} x={l.x} y={H - MARGIN.bottom + 20} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={10}>{l.text}</text>
            ))}
            {nowX !== null && (
              <>
                <line x1={nowX} y1={MARGIN.top} x2={nowX} y2={H - MARGIN.bottom} stroke="rgba(255,255,255,0.2)" strokeDasharray="4,4" strokeWidth={1} />
                <text x={nowX} y={MARGIN.top - 8} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={10}>Now</text>
              </>
            )}
            {/* Threshold lines */}
            {metricMeta.good != null && (() => { const ty = yScale(metricMeta.good); return ty > MARGIN.top && ty < H - MARGIN.bottom ? <g><line x1={MARGIN.left} y1={ty} x2={W - MARGIN.right} y2={ty} stroke="#0D9C29" strokeDasharray="6,3" strokeWidth={1.2} opacity={0.65} /><text x={W - MARGIN.right + 4} y={ty + 4} fontSize={9} fill="#0D9C29" opacity={0.8}>Good</text></g> : null; })()}
            {metricMeta.poor != null && (() => { const ty = yScale(metricMeta.poor); return ty > MARGIN.top && ty < H - MARGIN.bottom ? <g><line x1={MARGIN.left} y1={ty} x2={W - MARGIN.right} y2={ty} stroke="#E00000" strokeDasharray="6,3" strokeWidth={1.2} opacity={0.65} /><text x={W - MARGIN.right + 4} y={ty + 4} fontSize={9} fill="#E00000" opacity={0.8}>Poor</text></g> : null; })()}
            {confidencePoly && <polygon points={confidencePoly} fill={color} fillOpacity={0.08} />}
            {historicalPath && <path d={historicalPath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}
            {historicalData.map((v, i) => (
              <circle key={`h-${i}`} cx={xScale(i)} cy={yScale(v)} r={historicalData.length > 60 ? 1.5 : 3} fill={color} opacity={0.8} />
            ))}
            {connectionPath && <path d={connectionPath} fill="none" stroke={color} strokeWidth={1.5} opacity={0.6} />}
            {forecastPath && <path d={forecastPath} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6,4" opacity={0.8} />}
            {forecastData.map((v, i) => (
              <circle key={`f-${i}`} cx={xScale(historicalData.length + i)} cy={yScale(v)} r={forecastData.length > 60 ? 1.5 : 3} fill={color} opacity={0.5} />
            ))}
            {hoverIdx !== null && hoverValue !== null && (
              <>
                <line x1={xScale(hoverIdx)} y1={MARGIN.top} x2={xScale(hoverIdx)} y2={H - MARGIN.bottom} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="3,3" />
                <line x1={MARGIN.left} y1={yScale(hoverValue)} x2={W - MARGIN.right} y2={yScale(hoverValue)} stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3,3" />
                <circle cx={xScale(hoverIdx)} cy={yScale(hoverValue)} r={5} fill={isForecastPoint ? "transparent" : color} stroke={color} strokeWidth={2} />
              </>
            )}
          </svg>
        </div>

        {/* Hover tooltip */}
        {hoverIdx !== null && hoverValue !== null && hoverTs !== null && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 16, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
            <span>{formatDate(hoverTs)}</span>
            <span style={{ color, fontWeight: 700 }}>{isForecastPoint ? "Forecast: " : "Actual: "}{formatAxisValue(hoverValue)}</span>
            {isForecastPoint && confidence.upper[hoverIdx - historicalData.length] != null && (
              <span style={{ opacity: 0.5 }}>(±{formatAxisValue(confidence.upper[hoverIdx - historicalData.length] - hoverValue)})</span>
            )}
          </div>
        )}

        {/* Confidence score */}
        {confidenceScore !== null && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Forecast Confidence:</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: confidenceScore >= 80 ? "#0D9C29" : confidenceScore >= 60 ? "#FFC800" : "#FF9040" }}>{confidenceScore}%</span>
            <div style={{ width: 100, height: 5, borderRadius: 3, background: "rgba(128,128,128,0.2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${confidenceScore}%`, borderRadius: 3, background: confidenceScore >= 80 ? "#0D9C29" : confidenceScore >= 60 ? "#FFC800" : "#FF9040", transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{confidenceScore >= 80 ? "High" : confidenceScore >= 60 ? "Moderate" : "Low"} — based on historical volatility</span>
          </div>
        )}

        {/* Legend */}
        <div style={{ display: "flex", gap: 24, marginTop: 16, justifyContent: "center", fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width={24} height={3}><line x1={0} y1={1.5} x2={24} y2={1.5} stroke={color} strokeWidth={2} /></svg>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Historical ({appliedAnalyzeDays}d)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width={24} height={3}><line x1={0} y1={1.5} x2={24} y2={1.5} stroke={color} strokeWidth={2} strokeDasharray="4,3" /></svg>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Forecast ({appliedForecastDays}d)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width={16} height={12}><rect x={0} y={0} width={16} height={12} fill={color} fillOpacity={0.15} rx={2} /></svg>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Confidence Band</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill={color} /></svg>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Data Points ({datapointLabel(appliedDatapoints)})</span>
          </div>
        </div>

        {/* Deep Dive Analysis */}
        {breachAnalysis && (
          <div style={{ marginTop: 20, border: "1px solid rgba(128,128,128,0.15)", borderRadius: 10, overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
            {/* Urgency header */}
            <div style={{ padding: "12px 20px", background: urgency === "act_now" ? "rgba(224,0,0,0.12)" : urgency === "monitor" ? "rgba(255,200,0,0.08)" : "rgba(13,156,41,0.08)", borderBottom: "1px solid rgba(128,128,128,0.1)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>{urgency === "act_now" ? "🔴" : urgency === "monitor" ? "🟡" : "🟢"}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: urgency === "act_now" ? "#E00000" : urgency === "monitor" ? "#FFC800" : "#0D9C29", letterSpacing: "0.03em" }}>
                  {urgency === "act_now" ? "ACT NOW" : urgency === "monitor" ? "MONITOR" : "ON TRACK"}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                  {urgency === "act_now"
                    ? breachAnalysis.currentZone === "poor"
                      ? `${label} is already in the "Poor" zone — immediate investigation recommended`
                      : breachAnalysis.daysToPoorBreach != null
                        ? `Projected to breach "Poor" in ~${Math.ceil(breachAnalysis.daysToPoorBreach)}d at current rate${rateAnalysis?.isAccelerating ? " — and accelerating" : ""}`
                        : `Trend is degrading rapidly — intervention recommended`
                    : urgency === "monitor"
                    ? breachAnalysis.daysToPoorBreach != null
                      ? `Trending toward "Poor" threshold — possible breach in ~${Math.ceil(breachAnalysis.daysToPoorBreach)}d`
                      : `${label} is in "Needs Improvement" — watch for continued degradation`
                    : `${label} is within healthy bounds across the ${appliedForecastDays}-day horizon`}
                </div>
              </div>
            </div>

            {/* Key metrics row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid rgba(128,128,128,0.1)" }}>
              {[
                { lbl: "Current value", val: metricMeta.formatVal(breachAnalysis.current), z: breachAnalysis.currentZone },
                { lbl: `${appliedForecastDays}d projection`, val: metricMeta.formatVal(breachAnalysis.projected), z: breachAnalysis.projectedZone },
                { lbl: "Rate / day", val: rateAnalysis ? `${rateAnalysis.perDay > 0 ? "+" : ""}${metricMeta.formatVal(Math.abs(rateAnalysis.perDay))}${rateAnalysis.isAccelerating ? " ⚡" : ""}` : "—", z: rateAnalysis?.isTrendingBad ? (rateAnalysis.isAccelerating ? "poor" : "needs_improvement") : "good" },
              ].map((r, i) => (
                <div key={i} style={{ padding: "14px 16px", textAlign: "center", borderRight: i < 2 ? "1px solid rgba(128,128,128,0.1)" : "none" }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6 }}>{r.lbl}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: r.z === "poor" ? "#E00000" : r.z === "needs_improvement" ? "#FFC800" : r.z === "good" ? "#0D9C29" : "rgba(255,255,255,0.85)" }}>{r.val}</div>
                  {r.z !== "unknown" && i < 2 && <div style={{ fontSize: 10, marginTop: 4, color: r.z === "good" ? "#0D9C29" : r.z === "needs_improvement" ? "#FFC800" : "#E00000" }}>{r.z === "good" ? "✓ Good" : r.z === "needs_improvement" ? "⚠ Needs Improvement" : "✗ Poor"}</div>}
                  {i === 2 && rateAnalysis?.isAccelerating && <div style={{ fontSize: 10, marginTop: 4, color: "#FFC800" }}>Accelerating</div>}
                </div>
              ))}
            </div>

            {/* Breach timeline + recovery */}
            {(breachAnalysis.daysToGoodBreach != null || breachAnalysis.daysToPoorBreach != null || true) && (
              <div style={{ padding: "10px 20px", borderBottom: "1px solid rgba(128,128,128,0.1)", display: "flex", gap: 20, flexWrap: "wrap" as const, alignItems: "center" }}>
                {breachAnalysis.daysToGoodBreach != null && (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>⚠ Exits "Good" in <strong style={{ color: "#FFC800" }}>~{Math.ceil(breachAnalysis.daysToGoodBreach)}d</strong></span>
                )}
                {breachAnalysis.daysToPoorBreach != null && (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>✗ Enters "Poor" in <strong style={{ color: "#E00000" }}>~{Math.ceil(breachAnalysis.daysToPoorBreach)}d</strong></span>
                )}
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginLeft: "auto" }}>
                  Recovery probability: <strong style={{ color: recoveryProb.level === "low" ? "#E00000" : recoveryProb.level === "medium" ? "#FFC800" : "#0D9C29" }}>
                    {recoveryProb.level === "low" ? "Low" : recoveryProb.level === "medium" ? "Medium" : "High"}
                  </strong>
                  <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }}>({recoveryProb.reason})</span>
                </span>
              </div>
            )}

            {/* Business impact */}
            {businessImpact && (
              <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(128,128,128,0.1)", background: "rgba(224,0,0,0.04)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#E00000", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>
                  If nothing is done — {appliedForecastDays}-day impact estimate
                </div>
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap" as const }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>📉 Est. conversion drop: <strong style={{ color: "#E00000" }}>−{businessImpact.convDropPct}%</strong></div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>🚪 Session abandonment: <strong style={{ color: "#FFC800" }}>+{businessImpact.abandonmentPct}%</strong></div>
                  {metricMeta.cwvType && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>📊 CWV score will likely decline further</div>}
                  {/LCP|FCP|INP|TTFB/i.test(label) && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>⭐ Apdex likely to follow without intervention</div>}
                </div>
              </div>
            )}

            {/* Next steps */}
            <div style={{ padding: "14px 20px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: color, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 10 }}>Recommended Next Steps</div>
              {nextSteps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12, fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.55 }}>
                  <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <span>{step.text}</span>
                    {step.copyDql && (
                      <pre style={{ margin: "8px 0 6px", padding: "8px 12px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(128,128,128,0.2)", borderRadius: 6, fontSize: 10.5, fontFamily: "Consolas,monospace", color: "rgba(255,255,255,0.75)", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6, userSelect: "text" }}>
                        {step.copyDql}
                      </pre>
                    )}
                    {(step.copyDql || step.anomalyLink) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                        {step.copyDql && (
                          <button
                            onClick={() => { copyText(step.copyDql!); setCopiedStepIdx(i); setTimeout(() => setCopiedStepIdx(null), 2000); }}
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 5, border: `1px solid ${copiedStepIdx === i ? "#0D9C29" : "rgba(128,128,128,0.35)"}`, background: copiedStepIdx === i ? "rgba(13,156,41,0.15)" : "rgba(255,255,255,0.07)", color: copiedStepIdx === i ? "#0D9C29" : "rgba(255,255,255,0.75)", fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}
                          >
                            {copiedStepIdx === i ? "✓ Copied!" : "📋 Copy DQL"}
                          </button>
                        )}
                        {step.anomalyLink && (
                          <a
                            href={`${getDtTenantBase()}/ui/apps/dynatrace.settings/settings/all-alerts/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 5, border: "1px solid rgba(128,128,128,0.35)", background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.75)", fontSize: 11, textDecoration: "none", fontFamily: "inherit" }}
                          >
                            🔔 Open Alert Settings
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
