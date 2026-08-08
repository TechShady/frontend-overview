import React, { useMemo, useState, useCallback, useEffect } from "react";

// ─── Linear regression forecast ───
function linearForecast(data: number[], forecastBuckets: number): number[] {
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
function holtWintersForecast(data: number[], forecastBuckets: number, alpha = 0.3, beta = 0.1): number[] {
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
function tripleExpSmoothingForecast(data: number[], forecastBuckets: number, seasonLength?: number, alpha = 0.3, beta = 0.1, gamma = 0.3): number[] {
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
function prophetForecast(data: number[], forecastBuckets: number): number[] {
  const n = data.length;
  if (n < 4) return linearForecast(data, forecastBuckets);
  const numChangepoints = Math.min(Math.max(2, Math.floor(n / 10)), 25);
  const cpIndices: number[] = [];
  for (let i = 1; i <= numChangepoints; i++) cpIndices.push(Math.round((i / (numChangepoints + 1)) * n * 0.8));
  const trend = fitPiecewiseTrend(data, cpIndices);
  const detrended = data.map((v, i) => v - trend[i]);
  const seasonality = fitFourierSeasonality(detrended, n + forecastBuckets);
  const lastSlope = n >= 2 ? (trend[n - 1] - trend[n - 2]) : 0;
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
function arimaForecast(data: number[], forecastBuckets: number, p = 5, d = 1, q = 2): number[] {
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
function sarimaForecast(data: number[], forecastBuckets: number, p = 3, d = 1, q = 1, P = 1, D = 1, Q = 1, m?: number): number[] {
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
function confidenceBand(data: number[], forecast: number[]): { upper: number[]; lower: number[] } {
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

type ForecastMethod = "linear" | "holt-winters" | "triple-exp" | "prophet" | "arima" | "sarima";

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

export function ForecastModal({ label, sparkline, color = "#4589FF", onClose, getRequeryData }: ForecastModalProps) {
  const [method, setMethod] = useState<ForecastMethod>("prophet");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
          <svg width={W} height={H} style={{ display: "block", cursor: "crosshair" }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
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
      </div>
    </div>
  );
}
