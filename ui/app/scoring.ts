import { CWV } from "./SettingsContext";

// ---------------------------------------------------------------------------
// Scoring — turn each web-app's summary metrics into a 0-100 score.
// Combines: Web Vitals (LCP/CLS/INP/TTFB), Error rate, Bounce rate.
// Each factor 0-100, weighted sum.
// ---------------------------------------------------------------------------
export type PerAppSummary = {
  application: string;
  sessions: number;
  users: number;
  actions: number;
  errors: number;
  avgDuration: number;
  bounces: number;
  newUsers: number;
  errorRate: number;
  bounceRate: number;
};

export type PerAppVitals = {
  application: string;
  lcpAvg: number;
  clsAvg: number;
  inpAvg: number;
  ttfbAvg: number;
};

// Piecewise: value <= good → 100, value >= poor → 0, linear between.
// For metrics where lower is better (LCP, INP, TTFB, CLS, errorRate, bounceRate).
export function scoreLowerBetter(value: number, good: number, poor: number): number {
  if (!isFinite(value)) return 0;
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.max(0, Math.min(100, 100 * (1 - (value - good) / (poor - good))));
}

// Weighted composite grade for a web app (0-100).
export function computeAppScore(
  vitals: Partial<PerAppVitals> | undefined,
  summary: Partial<PerAppSummary> | undefined,
): { score: number; parts: { label: string; score: number; weight: number }[] } {
  const lcp = vitals?.lcpAvg ?? NaN;
  const cls = vitals?.clsAvg ?? NaN;
  const inp = vitals?.inpAvg ?? NaN;
  const ttfb = vitals?.ttfbAvg ?? NaN;
  const err = summary?.errorRate ?? NaN;
  const bounce = summary?.bounceRate ?? NaN;

  const parts = [
    { label: "LCP", score: scoreLowerBetter(lcp, CWV.lcp.good, CWV.lcp.poor), weight: 22 },
    { label: "INP", score: scoreLowerBetter(inp, CWV.inp.good, CWV.inp.poor), weight: 18 },
    { label: "CLS", score: scoreLowerBetter(cls, CWV.cls.good, CWV.cls.poor), weight: 12 },
    { label: "TTFB", score: scoreLowerBetter(ttfb, CWV.ttfb.good, CWV.ttfb.poor), weight: 8 },
    { label: "Error rate", score: scoreLowerBetter(err, 0.5, 5), weight: 25 },
    { label: "Bounce rate", score: scoreLowerBetter(bounce, 30, 80), weight: 15 },
  ];
  const applicable = parts.filter((p) => isFinite(p.score));
  const wTotal = applicable.reduce((a, p) => a + p.weight, 0) || 1;
  const wSum = applicable.reduce((a, p) => a + p.score * p.weight, 0);
  return { score: wSum / wTotal, parts };
}

// Fleet-wide roll-up — weighted by traffic (sessions).
export function computeFleetScore(rows: Array<{ score: number; sessions: number }>): number {
  const total = rows.reduce((a, r) => a + (isFinite(r.score) ? r.sessions : 0), 0);
  if (total === 0) return NaN;
  return rows.reduce((a, r) => a + (isFinite(r.score) ? r.score * r.sessions : 0), 0) / total;
}
