import React, { useMemo, useCallback } from "react";
import { useAIInsights, analyzeExecutiveSummary } from "../components/AIInsights";
import { useSettings, INDUSTRY_BENCHMARKS } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webVitalsPerAppQuery, webAppBucketedMetricsQuery } from "../queries";
import { computeAppScore, computeFleetScore } from "../scoring";
import { gradeFromScore } from "../components/GradeBadge";
import { SectionCard, fmt } from "../components/layout";
import { useTimelapse } from "../TimelapseContext";

// ---------------------------------------------------------------------------
// Executive Summary — fleet-level report card
// Report-card layout inspired by the user-journey-app executive summary,
// adapted for a multi-app RUM fleet. Includes Copy Text + Export PDF buttons,
// an overall letter grade with weighted score breakdown, an AI narrative,
// key-metric KPI cards, Core Web Vitals cards, and a Performance Snapshot table.
// ---------------------------------------------------------------------------

const GREEN = "#0D9C29";
const YELLOW = "#F9A825";
const ORANGE = "#FB8C00";
const RED = "#C21930";
const BLUE = "#4589FF";
const PURPLE = "#A56EFF";

// -----------------------------------------------------------------------------
// Helpers — thresholds
// -----------------------------------------------------------------------------
function apdexClr(v: number) {
  if (!isFinite(v)) return "rgba(128,128,128,0.7)";
  if (v >= 0.85) return GREEN;
  if (v >= 0.7) return YELLOW;
  return RED;
}
function apdexLabel(v: number) {
  if (!isFinite(v)) return "—";
  if (v >= 0.94) return "Excellent";
  if (v >= 0.85) return "Good";
  if (v >= 0.7) return "Fair";
  if (v >= 0.5) return "Poor";
  return "Unacceptable";
}
function errClr(pct: number) {
  if (!isFinite(pct)) return "rgba(128,128,128,0.7)";
  if (pct < 0.5) return GREEN;
  if (pct < 1) return YELLOW;
  if (pct < 5) return ORANGE;
  return RED;
}
function durClr(ms: number) {
  if (!isFinite(ms)) return "rgba(128,128,128,0.7)";
  if (ms < 3000) return GREEN;
  if (ms < 6000) return YELLOW;
  return RED;
}
function cwvLcpClr(ms: number) { if (!isFinite(ms)) return "rgba(128,128,128,0.7)"; if (ms <= 2500) return GREEN; if (ms <= 4000) return YELLOW; return RED; }
function cwvInpClr(ms: number) { if (!isFinite(ms)) return "rgba(128,128,128,0.7)"; if (ms <= 200) return GREEN; if (ms <= 500) return YELLOW; return RED; }
function cwvClsClr(v: number) { if (!isFinite(v)) return "rgba(128,128,128,0.7)"; if (v <= 0.1) return GREEN; if (v <= 0.25) return YELLOW; return RED; }
function cwvTtfbClr(ms: number) { if (!isFinite(ms)) return "rgba(128,128,128,0.7)"; if (ms <= 800) return GREEN; if (ms <= 1800) return YELLOW; return RED; }

// -----------------------------------------------------------------------------
// Section header — subtle divider used to group the report card
// -----------------------------------------------------------------------------
const SectionHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 20px 8px" }}>
    {icon}
    <div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, opacity: 0.6 }}>{subtitle}</div>}
    </div>
  </div>
);

// -----------------------------------------------------------------------------
// Fleet-wide grade bar — one metric with weight, current value, and score bar
// -----------------------------------------------------------------------------
const GradeMetricRow: React.FC<{
  label: string; weight?: number; score: number; displayValue: string; color: string;
  indent?: boolean;
}> = ({ label, weight, score, displayValue, color, indent }) => {
  const clamped = Math.max(0, Math.min(100, isFinite(score) ? score : 0));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0", borderBottom: "1px solid rgba(128,128,128,0.1)", paddingLeft: indent ? 16 : 0 }}>
      <div style={{ width: 130, fontSize: indent ? 11 : 12, fontWeight: indent ? 500 : 600, opacity: indent ? 0.8 : 1 }}>
        {indent && <span style={{ opacity: 0.4, marginRight: 4 }}>↳</span>}
        {label}
        {weight != null && <span style={{ opacity: 0.55, fontWeight: 500, marginLeft: 6 }}>({weight}%)</span>}
      </div>
      <div style={{ flex: 1, height: indent ? 6 : 8, background: "rgba(128,128,128,0.15)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${clamped}%`, background: color, transition: "width .35s ease" }} />
      </div>
      <div style={{ width: 96, textAlign: "right", fontSize: 12, fontFamily: "monospace", color, fontWeight: 700 }}>
        {displayValue}
      </div>
      <div style={{ width: 44, textAlign: "right", fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
        {isFinite(score) ? (indent ? `${clamped.toFixed(0)}%` : `${clamped.toFixed(0)}/100`) : "—"}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------
export const ExecutiveSummaryTab: React.FC = () => {
  const { timeframeDays, webAppFilter, setWebAppFilter, gradeWeights, industry } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const prevPrevSum = useDql(webAppSummaryQuery(timeframeDays, sel, false, true), [timeframeDays, sel]);
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prevVitals = useDql(webVitalsPerAppQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const prevPrevVitals = useDql(webVitalsPerAppQuery(timeframeDays, sel, false, true), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);

  // Unfiltered queries for Report Card — always shows every app regardless of header filter
  const allSum = useDql(webAppSummaryQuery(timeframeDays, null), [timeframeDays]);
  const allVitals = useDql(webVitalsPerAppQuery(timeframeDays, null), [timeframeDays]);

  const periodScoredRows = useMemo(() => {
    const vRaw = vitals.data?.records ?? [];
    const vByApp: Record<string, any> = {};
    vRaw.forEach((r: any) => { vByApp[String(r.application ?? "")] = r; });
    return (sum.data?.records ?? []).map((r: any) => {
      const app = String(r.application ?? "");
      const v = vByApp[app] || {};
      const summary = {
        application: app,
        sessions: Number(r.sessions ?? 0),
        users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0),
        errors: Number(r.errors ?? 0),
        avgDuration: Number(r.avgDuration ?? 0),
        apdex: Number(r.apdex ?? 0),
        satisfied: Number(r.satisfied ?? 0),
        tolerating: Number(r.tolerating ?? 0),
        frustrated: Number(r.frustrated ?? 0),
        errorRate: Number(r.errorRate ?? 0),
        bounceRate: 0,
        newUsers: 0,
        bounces: 0,
      };
      const vitalsRow = {
        application: app,
        lcpAvg: Number(v.lcpAvg ?? NaN),
        inpAvg: Number(v.inpAvg ?? NaN),
        clsAvg: Number(v.clsAvg ?? NaN),
        ttfbAvg: Number(v.ttfbAvg ?? NaN),
        fcpAvg: Number(v.fcpAvg ?? NaN),
        loadEndAvg: Number(v.loadEndAvg ?? NaN),
      };
      const { score } = computeAppScore(vitalsRow, summary, gradeWeights);
      return { summary, vitals: vitalsRow, score };
    });
  }, [sum.data, vitals.data, gradeWeights]);

  const allAppsScoredRows = useMemo(() => {
    const vByApp: Record<string, any> = {};
    (allVitals.data?.records ?? []).forEach((r: any) => { vByApp[String(r.application ?? "")] = r; });
    return (allSum.data?.records ?? []).map((r: any) => {
      const app = String(r.application ?? "");
      const v = vByApp[app] || {};
      const summary = {
        application: app,
        sessions: Number(r.sessions ?? 0),
        users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0),
        errors: Number(r.errors ?? 0),
        avgDuration: Number(r.avgDuration ?? 0),
        apdex: Number(r.apdex ?? 0),
        satisfied: Number(r.satisfied ?? 0),
        tolerating: Number(r.tolerating ?? 0),
        frustrated: Number(r.frustrated ?? 0),
        errorRate: Number(r.errorRate ?? 0),
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
    }).sort((a, b) => (isFinite(b.score) ? b.score : -1) - (isFinite(a.score) ? a.score : -1));
  }, [allSum.data, allVitals.data, gradeWeights]);

  // When Timelapse is playing, rebuild scoredRows from the per-bucket per-app data.
  // This makes the grade breakdown, table, and everything downstream animate with playback.
  const scoredRows = useMemo(() => {
    if (!tl.enabled) return periodScoredRows;
    const recs = bucketed.data?.records ?? [];
    if (recs.length === 0) return periodScoredRows;
    const buckets = Array.from(new Set(recs.map((r: any) => String(r.bkt ?? "")))).filter(Boolean).sort();
    if (buckets.length === 0) return periodScoredRows;
    const bKey = buckets[Math.min(Math.max(tl.index, 0), buckets.length - 1)];
    const byApp: Record<string, any> = {};
    for (const r of recs as any[]) if (String(r.bkt) === bKey) byApp[String(r.application ?? "")] = r;
    return periodScoredRows.map((row) => {
      const b = byApp[row.summary.application];
      if (!b) return { ...row, summary: { ...row.summary, sessions: 0, users: 0, actions: 0, errors: 0, satisfied: 0, tolerating: 0, frustrated: 0 } };
      const summary = {
        ...row.summary,
        sessions:   Number(b.sessions ?? 0),
        users:      Number(b.users ?? 0),
        actions:    Number(b.actions ?? 0),
        errors:     Number(b.errors ?? 0),
        avgDuration: Number(b.avgDuration ?? row.summary.avgDuration),
        apdex:      isFinite(Number(b.apdex)) ? Number(b.apdex) : row.summary.apdex,
        satisfied:  Number(b.satisfied ?? 0),
        tolerating: Number(b.tolerating ?? 0),
        frustrated: Number(b.frustrated ?? 0),
        errorRate:  Number(b.errorRate ?? row.summary.errorRate),
      };
      const vitalsRow = {
        ...row.vitals,
        lcpAvg:  isFinite(Number(b.lcp))  ? Number(b.lcp)  : row.vitals.lcpAvg,
        inpAvg:  isFinite(Number(b.inp))  ? Number(b.inp)  : row.vitals.inpAvg,
        clsAvg:  isFinite(Number(b.cls))  ? Number(b.cls)  : row.vitals.clsAvg,
        ttfbAvg: isFinite(Number(b.ttfb)) ? Number(b.ttfb) : row.vitals.ttfbAvg,
      };
      const { score } = computeAppScore(vitalsRow, summary, gradeWeights);
      return { summary, vitals: vitalsRow, score };
    });
  }, [periodScoredRows, bucketed.data, tl.enabled, tl.index]);

  const prevByApp: Record<string, any> = useMemo(() => {
    const out: Record<string, any> = {};
    (prev.data?.records ?? []).forEach((r: any) => { out[String(r.application ?? "")] = r; });
    return out;
  }, [prev.data]);

  const totals = useMemo(() => {
    const T = { sessions: 0, users: 0, actions: 0, errors: 0,
                satisfied: 0, tolerating: 0, frustrated: 0,
                durWeighted: 0, durWeight: 0 };
    for (const r of scoredRows) {
      T.sessions += r.summary.sessions;
      T.users += r.summary.users;
      T.actions += r.summary.actions;
      T.errors += r.summary.errors;
      T.satisfied += r.summary.satisfied;
      T.tolerating += r.summary.tolerating;
      T.frustrated += r.summary.frustrated;
      if (isFinite(r.summary.avgDuration) && r.summary.actions > 0) {
        T.durWeighted += r.summary.avgDuration * r.summary.actions;
        T.durWeight += r.summary.actions;
      }
    }
    const apdexDen = T.satisfied + T.tolerating + T.frustrated;
    const apdex = apdexDen > 0 ? (T.satisfied + T.tolerating * 0.5) / apdexDen : NaN;
    const avgDur = T.durWeight > 0 ? T.durWeighted / T.durWeight : NaN;
    const errorRate = T.actions > 0 ? (T.errors / T.actions) * 100 : 0;
    return { ...T, apdex, avgDur, errorRate };
  }, [scoredRows]);

  const prevTotals = useMemo(() => {
    let sessions = 0, actions = 0, errors = 0, sat = 0, tol = 0, frus = 0, dW = 0, dN = 0;
    for (const r of Object.values(prevByApp)) {
      const rr = r as any;
      sessions += Number(rr.sessions ?? 0);
      actions += Number(rr.actions ?? 0);
      errors += Number(rr.errors ?? 0);
      sat += Number(rr.satisfied ?? 0);
      tol += Number(rr.tolerating ?? 0);
      frus += Number(rr.frustrated ?? 0);
      const dur = Number(rr.avgDuration ?? 0), n = Number(rr.actions ?? 0);
      if (isFinite(dur) && n > 0) { dW += dur * n; dN += n; }
    }
    const den = sat + tol + frus;
    return {
      sessions, actions, errors,
      apdex: den > 0 ? (sat + tol * 0.5) / den : NaN,
      avgDur: dN > 0 ? dW / dN : NaN,
      errorRate: actions > 0 ? (errors / actions) * 100 : 0,
    };
  }, [prevByApp]);

  // Previous-period per-app scores for "What Changed" comparison (#1)
  const prevScoredRows = useMemo(() => {
    const pvByApp: Record<string, any> = {};
    (prevVitals.data?.records ?? []).forEach((r: any) => { pvByApp[String(r.application ?? "")] = r; });
    return Object.entries(prevByApp).map(([app, rr]) => {
      const r = rr as any;
      const v = pvByApp[app] || {};
      const summary = {
        application: app, sessions: Number(r.sessions ?? 0), users: Number(r.users ?? 0),
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
      return {
        application: app, score,
        apdex: summary.apdex, errorRate: summary.errorRate, avgDuration: summary.avgDuration,
        satisfied: summary.satisfied, tolerating: summary.tolerating, frustrated: summary.frustrated,
      };
    });
  }, [prevByApp, prevVitals.data, gradeWeights]);

  // Two-periods-ago scores — used by Regression Watchlist to confirm multi-period trend
  const prevPrevByApp: Record<string, any> = useMemo(() => {
    const out: Record<string, any> = {};
    (prevPrevSum.data?.records ?? []).forEach((r: any) => { out[String(r.application ?? "")] = r; });
    return out;
  }, [prevPrevSum.data]);

  const prevPrevScoredRows = useMemo(() => {
    const ppvByApp: Record<string, any> = {};
    (prevPrevVitals.data?.records ?? []).forEach((r: any) => { ppvByApp[String(r.application ?? "")] = r; });
    return Object.entries(prevPrevByApp).map(([app, rr]) => {
      const r = rr as any;
      const v = ppvByApp[app] || {};
      const summary = {
        application: app, sessions: Number(r.sessions ?? 0), actions: Number(r.actions ?? 0),
        errors: Number(r.errors ?? 0), avgDuration: Number(r.avgDuration ?? 0), apdex: Number(r.apdex ?? 0),
        satisfied: Number(r.satisfied ?? 0), tolerating: Number(r.tolerating ?? 0),
        frustrated: Number(r.frustrated ?? 0), errorRate: Number(r.errorRate ?? 0),
        users: 0, bounceRate: 0, newUsers: 0, bounces: 0,
      };
      const vitalsRow = {
        application: app,
        lcpAvg: Number(v.lcpAvg ?? NaN), inpAvg: Number(v.inpAvg ?? NaN),
        clsAvg: Number(v.clsAvg ?? NaN), ttfbAvg: Number(v.ttfbAvg ?? NaN),
        fcpAvg: Number(v.fcpAvg ?? NaN), loadEndAvg: Number(v.loadEndAvg ?? NaN),
      };
      const { score } = computeAppScore(vitalsRow, summary, gradeWeights);
      return { application: app, score };
    });
  }, [prevPrevByApp, prevPrevVitals.data, gradeWeights]);

  // Business Impact stats (#3) — always shown; delta shown when prior period data exists
  const impactStats = useMemo(() => {
    const hasPrev = prevTotals.sessions >= 5 && prevTotals.actions >= 5;
    function delta(curr: number, prev: number, fmt2: (v: number) => string, higherBetter: boolean) {
      if (!hasPrev || !isFinite(prev) || prev === 0) return null;
      const d = curr - prev;
      if (Math.abs(d) < 1e-6) return { label: "stable", positive: true, neutral: true };
      return { label: (d > 0 ? "+" : "") + fmt2(d), positive: higherBetter ? d > 0 : d < 0, neutral: false };
    }
    const errCount = totals.errors;
    const prevErrCount = hasPrev ? Math.round((prevTotals.errorRate / 100) * prevTotals.actions) : 0;
    const errDelta = hasPrev ? errCount - prevErrCount : 0;
    return [
      {
        label: "Sessions",
        value: fmt.num(totals.sessions),
        delta: delta(totals.sessions, prevTotals.sessions, (v) => `${Math.abs(Math.round((v / prevTotals.sessions) * 100))}%`, true),
        subtext: hasPrev ? `vs ${fmt.num(prevTotals.sessions)} prior` : "this period",
      },
      {
        label: "Errors",
        value: fmt.num(errCount),
        delta: hasPrev && Math.abs(errDelta) > 0 ? { label: (errDelta > 0 ? "+" : "") + fmt.num(errDelta), positive: errDelta < 0, neutral: false } : (hasPrev ? { label: "stable", positive: true, neutral: true } : null),
        subtext: `${fmt.pct(totals.errorRate)} error rate`,
      },
      {
        label: "Apdex",
        value: isFinite(totals.apdex) ? totals.apdex.toFixed(2) : "—",
        delta: delta(totals.apdex, prevTotals.apdex, (v) => (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "pts", true),
        subtext: isFinite(totals.apdex) ? (totals.apdex >= 0.94 ? "Excellent" : totals.apdex >= 0.85 ? "Good" : totals.apdex >= 0.7 ? "Fair" : "Poor") : "",
      },
      {
        label: "Avg load",
        value: fmt.ms(totals.avgDur),
        delta: delta(totals.avgDur, prevTotals.avgDur, (v) => (v > 0 ? "+" : "") + (v / 1000).toFixed(2) + "s", false),
        subtext: isFinite(totals.avgDur) ? (totals.avgDur < 3000 ? "< 3s target" : "above target") : "",
      },
    ];
  }, [totals, prevTotals]);

  // What Changed per-app (#1)
  const whatChanged = useMemo(() => {
    if (!prevScoredRows.length) return [];
    const prevMap: Record<string, typeof prevScoredRows[number]> = {};
    prevScoredRows.forEach(r => { prevMap[r.application] = r; });
    return scoredRows
      .filter(r => isFinite(r.score) && r.summary.sessions >= 5)
      .map(r => {
        const p = prevMap[r.summary.application];
        if (!p || !isFinite(p.score)) return null;
        const delta = r.score - p.score;
        if (Math.abs(delta) < 4) return null;
        const curr = gradeFromScore(r.score);
        const prevGrade = gradeFromScore(p.score);
        // Identify the most meaningful driver (ignore negligible deltas)
        let driver = "";
        const apdexD = r.summary.apdex - p.apdex;
        const errD = r.summary.errorRate - p.errorRate;
        const durD = r.summary.avgDuration - p.avgDuration;
        const currFruDen = r.summary.satisfied + r.summary.tolerating + r.summary.frustrated;
        const prevFruDen = (p.satisfied ?? 0) + (p.tolerating ?? 0) + (p.frustrated ?? 0);
        const currFruPct = currFruDen > 0 ? (r.summary.frustrated / currFruDen) * 100 : NaN;
        const prevFruPct = prevFruDen > 0 ? ((p.frustrated ?? 0) / prevFruDen) * 100 : NaN;
        const fruD = isFinite(currFruPct) && isFinite(prevFruPct) ? currFruPct - prevFruPct : NaN;
        const candidates = [
          Math.abs(apdexD) >= 0.01           ? { label: "Apdex",         str: (apdexD > 0 ? "+" : "") + (apdexD * 100).toFixed(0) + " pts" }  : null,
          isFinite(fruD) && Math.abs(fruD) >= 2 ? { label: "Frustrated %", str: (fruD > 0 ? "+" : "") + fruD.toFixed(0) + "pp" }               : null,
          Math.abs(errD)   >= 0.1            ? { label: "Error rate",     str: (errD   > 0 ? "+" : "") + errD.toFixed(1) + "pp" }               : null,
          Math.abs(durD)   >= 200            ? { label: "Load time",      str: (durD   > 0 ? "+" : "") + (durD / 1000).toFixed(1) + "s" }       : null,
        ].filter((c): c is NonNullable<typeof c> => c !== null);
        driver = candidates[0]?.label ? `${candidates[0].label} ${candidates[0].str}` : "";
        return { application: r.summary.application, delta, curr, prevGrade, driver, gradeMoved: curr.letter !== prevGrade.letter };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 10);
  // Gate on prevVitals being present — prevents false changes from CWV data availability differences
  }, [scoredRows, prevScoredRows, prevVitals.data]);

  // Regression Watchlist — apps with confirmed downward trend across 2 consecutive periods
  const regressionWatchlist = useMemo(() => {
    if (!prevScoredRows.length) return [];
    const prevMap: Record<string, number> = {};
    prevScoredRows.forEach(r => { prevMap[r.application] = r.score; });
    const pp2Map: Record<string, number> = {};
    prevPrevScoredRows.forEach(r => { pp2Map[r.application] = r.score; });
    return scoredRows
      .filter(r => isFinite(r.score) && r.summary.sessions >= 5)
      .map(r => {
        const app = r.summary.application;
        const curr = r.score;
        const p1 = prevMap[app];
        const p2 = pp2Map[app];
        if (!isFinite(p1)) return null;
        const d1 = curr - p1; // current vs prev
        const d2 = isFinite(p2) ? p1 - p2 : null; // prev vs prevPrev
        // Consecutive decline: both periods dropped, or single-period sharp drop with bad score
        const consecutiveDecline = d1 < -4 && d2 != null && d2 < -3;
        const sharpDrop = d1 < -12 && curr < 70;
        if (!consecutiveDecline && !sharpDrop) return null;
        const totalDrop = isFinite(p2) ? curr - p2 : curr - p1;
        return {
          application: app,
          currScore: curr,
          prevScore: p1,
          p2Score: isFinite(p2) ? p2 : null,
          d1,
          d2,
          totalDrop,
          sessions: r.summary.sessions,
          consecutive: consecutiveDecline,
          grade: gradeFromScore(curr),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        // Sort by traffic × severity
        const urgencyA = Math.abs(a.totalDrop) * Math.log10(Math.max(10, a.sessions));
        const urgencyB = Math.abs(b.totalDrop) * Math.log10(Math.max(10, b.sessions));
        return urgencyB - urgencyA;
      })
      .slice(0, 8);
  }, [scoredRows, prevScoredRows, prevPrevScoredRows]);

  const fleetVitals = useMemo(() => {
    let lN = 0, lW = 0, iN = 0, iW = 0, cN = 0, cW = 0, tN = 0, tW = 0;
    for (const r of scoredRows) {
      const w = r.summary.sessions || 1;
      const v = r.vitals;
      if (isFinite(v.lcpAvg)) { lN += v.lcpAvg * w; lW += w; }
      if (isFinite(v.inpAvg)) { iN += v.inpAvg * w; iW += w; }
      if (isFinite(v.clsAvg)) { cN += v.clsAvg * w; cW += w; }
      if (isFinite(v.ttfbAvg)) { tN += v.ttfbAvg * w; tW += w; }
    }
    return {
      lcp: lW > 0 ? lN / lW : NaN,
      inp: iW > 0 ? iN / iW : NaN,
      cls: cW > 0 ? cN / cW : NaN,
      ttfb: tW > 0 ? tN / tW : NaN,
    };
  }, [scoredRows]);

  const fleetScore = useMemo(() =>
    computeFleetScore(scoredRows.map((r) => ({ score: r.score, sessions: r.summary.sessions }))),
  [scoredRows]);
  const grade = gradeFromScore(fleetScore);

  const reportCardRows = useMemo(() => {
    if (tl.enabled) return [...scoredRows].sort((a, b) => (isFinite(b.score) ? b.score : -1) - (isFinite(a.score) ? a.score : -1));
    if (sel) return allAppsScoredRows.filter(r => sel.includes(r.summary.application));
    return allAppsScoredRows;
  }, [tl.enabled, scoredRows, allAppsScoredRows, sel]);

  const { panel: aiPanel } = useAIInsights(useCallback(() =>
    analyzeExecutiveSummary(
      scoredRows.map((r) => ({ application: r.summary.application, score: r.score, grade: gradeFromScore(r.score).letter })),
      undefined,
    ),
  [scoredRows]));

  const scoreLB = (v: number, good: number, poor: number) => {
    if (!isFinite(v)) return NaN;
    if (v <= good) return 100;
    if (v >= poor) return 0;
    return 100 * (1 - (v - good) / (poor - good));
  };
  const scoreHB = (v: number, poor: number, good: number) => {
    if (!isFinite(v)) return NaN;
    if (v >= good) return 100;
    if (v <= poor) return 0;
    return 100 * ((v - poor) / (good - poor));
  };
  const gradeMetrics = useMemo(() => {
    const satN = totals.satisfied;
    const tolN = totals.tolerating;
    const fruN = totals.frustrated;
    const sfTotal = satN + tolN + fruN;
    const satPct  = sfTotal > 0 ? (satN / sfTotal) * 100 : 0;
    const tolPct  = sfTotal > 0 ? (tolN / sfTotal) * 100 : 0;
    const fruPct  = sfTotal > 0 ? (fruN / sfTotal) * 100 : 0;
    return [
      { label: "Apdex",      weight: gradeWeights.apdex,     score: scoreHB(totals.apdex, 0.5, 0.94),          value: isFinite(totals.apdex) ? totals.apdex.toFixed(2) : "—",      color: apdexClr(totals.apdex),       indent: false },
      { label: "Satisfied",  weight: undefined,               score: satPct,                                    value: `${satPct.toFixed(0)}% (${fmt.num(satN)})`,                  color: GREEN,                        indent: true  },
      { label: "Tolerating", weight: undefined,               score: tolPct,                                    value: `${tolPct.toFixed(0)}% (${fmt.num(tolN)})`,                  color: YELLOW,                       indent: true  },
      { label: "Frustrated", weight: undefined,               score: fruPct,                                    value: `${fruPct.toFixed(0)}% (${fmt.num(fruN)})`,                  color: RED,                          indent: true  },
      { label: "Error rate", weight: gradeWeights.errorRate,  score: scoreLB(totals.errorRate, 0.5, 5),         value: fmt.pct(totals.errorRate),                                   color: errClr(totals.errorRate),     indent: false },
      { label: "CWV — LCP",  weight: gradeWeights.lcp,        score: scoreLB(fleetVitals.lcp, 2500, 4000),      value: fmt.ms(fleetVitals.lcp),                                     color: cwvLcpClr(fleetVitals.lcp),   indent: false },
      { label: "CWV — INP",  weight: gradeWeights.inp,        score: scoreLB(fleetVitals.inp, 200, 500),        value: fmt.ms(fleetVitals.inp),                                     color: cwvInpClr(fleetVitals.inp),   indent: false },
      { label: "CWV — CLS",  weight: gradeWeights.cls,        score: scoreLB(fleetVitals.cls, 0.1, 0.25),       value: isFinite(fleetVitals.cls) ? fleetVitals.cls.toFixed(2) : "—", color: cwvClsClr(fleetVitals.cls),  indent: false },
      { label: "CWV — TTFB", weight: gradeWeights.ttfb,       score: scoreLB(fleetVitals.ttfb, 800, 1800),      value: fmt.ms(fleetVitals.ttfb),                                    color: cwvTtfbClr(fleetVitals.ttfb), indent: false },
    ];
  }, [totals, fleetVitals, gradeWeights]);

  const narrative = useMemo(() => {
    const lines: string[] = [];
    const scope = sel
      ? (sel.length === 1 ? `web app "${sel[0]}"` : `${sel.length} web apps`)
      : `${scoredRows.length} web app${scoredRows.length === 1 ? "" : "s"}`;
    const period = timeframeDays >= 1 ? `${timeframeDays} day${timeframeDays === 1 ? "" : "s"}` : `${Math.round(timeframeDays * 24)} hours`;
    lines.push(`Over the last ${period}, ${scope} handled ${fmt.num(totals.sessions)} session${totals.sessions === 1 ? "" : "s"} and ${fmt.num(totals.actions)} user actions.`);
    if (isFinite(totals.apdex)) {
      const q = apdexLabel(totals.apdex).toLowerCase();
      const sfDen = totals.satisfied + totals.tolerating + totals.frustrated;
      const fruPct = sfDen > 0 ? ((totals.frustrated / sfDen) * 100).toFixed(0) : "—";
      const satPct = sfDen > 0 ? ((totals.satisfied  / sfDen) * 100).toFixed(0) : "—";
      lines.push(`Fleet Apdex is ${totals.apdex.toFixed(2)} (${q}) — ${satPct}% satisfied, ${fmt.num(totals.tolerating)} tolerating, ${fmt.num(totals.frustrated)} frustrated (${fruPct}%).`);
    }
    if (totals.errorRate > 1) {
      lines.push(`Error rate is ${fmt.pct(totals.errorRate)}, above the 1% healthy threshold. Prioritise the noisy applications on the Errors tab.`);
    } else if (totals.errorRate > 0) {
      lines.push(`Error rate is ${fmt.pct(totals.errorRate)} — within the healthy range.`);
    }
    if (isFinite(fleetVitals.lcp) && fleetVitals.lcp > 4000) {
      lines.push(`LCP averages ${fmt.ms(fleetVitals.lcp)} — outside the Web Vitals target. Investigate render-blocking resources on the Hyperlyzer tab.`);
    } else if (isFinite(fleetVitals.lcp) && fleetVitals.lcp > 2500) {
      lines.push(`LCP averages ${fmt.ms(fleetVitals.lcp)} — needs improvement.`);
    }
    if (isFinite(prevTotals.apdex) && isFinite(totals.apdex)) {
      const delta = totals.apdex - prevTotals.apdex;
      if (Math.abs(delta) > 0.02) {
        lines.push(`Apdex is ${delta > 0 ? "up" : "down"} ${Math.abs(delta * 100).toFixed(1)} points versus the previous period.`);
      }
    }
    const worst = scoredRows.slice().filter((r) => isFinite(r.score) && r.summary.sessions > 0).sort((a, b) => a.score - b.score)[0];
    if (worst && scoredRows.length > 1) {
      lines.push(`Weakest app: ${worst.summary.application} (grade ${gradeFromScore(worst.score).letter}, ${worst.score.toFixed(0)}/100).`);
    }
    const best = scoredRows.slice().filter((r) => isFinite(r.score) && r.summary.sessions > 0).sort((a, b) => b.score - a.score)[0];
    if (best && scoredRows.length > 1) {
      lines.push(`Strongest app: ${best.summary.application} (grade ${gradeFromScore(best.score).letter}, ${best.score.toFixed(0)}/100).`);
    }
    return lines;
  }, [totals, prevTotals, fleetVitals, sel, timeframeDays, scoredRows]);

  const copyReportText = useCallback(() => {
    const lines: string[] = [];
    lines.push("=== Frontend Overview — Executive Summary ===");
    const selLabel = sel
      ? (sel.length === 1 ? sel[0] : `${sel.length} web apps`)
      : `${scoredRows.length} web apps`;
    lines.push(`Scope: ${selLabel}`);
    lines.push(`Period: last ${timeframeDays >= 1 ? `${timeframeDays} days` : `${Math.round(timeframeDays * 24)}h`}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push(`Overall Grade: ${grade.letter} (${isFinite(fleetScore) ? fleetScore.toFixed(0) : "—"}/100)`);
    lines.push("");
    lines.push("--- Grade breakdown ---");
    gradeMetrics.forEach((m) => {
      if (m.weight != null) {
        lines.push(`  ${m.label} (${m.weight}%): ${m.value} — ${isFinite(m.score) ? m.score.toFixed(0) + "/100" : "—"}`);
      } else {
        lines.push(`    ↳ ${m.label}: ${m.value}`);
      }
    });
    lines.push("");
    lines.push("--- Narrative ---");
    narrative.forEach((l) => lines.push(l));
    lines.push("");
    lines.push("--- Business Impact ---");
    impactStats.forEach((s) => {
      const arrow = s.delta == null || s.delta.neutral ? "=" : s.delta.positive ? "↑" : "↓";
      const deltaStr = s.delta ? ` ${arrow} ${s.delta.label}` : "";
      lines.push(`  ${s.label}: ${s.value}${deltaStr}  [${s.subtext}]`);
    });
    lines.push("");
    if (whatChanged.length > 0) {
      lines.push("--- What Changed ---");
      whatChanged.forEach((w) => {
        const driverStr = w.driver ? `  — ${w.driver}` : "";
        lines.push(`  ${w.application}: ${w.prevGrade.letter} → ${w.curr.letter} (${w.delta > 0 ? "+" : ""}${w.delta.toFixed(0)} pts)${driverStr}`);
      });
      lines.push("");
    }
    lines.push("--- Key metrics ---");
    lines.push(`  Sessions:   ${fmt.num(totals.sessions)}`);
    lines.push(`  Actions:    ${fmt.num(totals.actions)}`);
    lines.push(`  Errors:     ${fmt.num(totals.errors)} (${fmt.pct(totals.errorRate)})`);
    lines.push(`  Apdex:      ${isFinite(totals.apdex) ? totals.apdex.toFixed(2) : "—"}`);
    lines.push(`  Avg dur:    ${fmt.ms(totals.avgDur)}`);
    lines.push("");
    lines.push("--- Core Web Vitals ---");
    lines.push(`  LCP:  ${fmt.ms(fleetVitals.lcp)}`);
    lines.push(`  INP:  ${fmt.ms(fleetVitals.inp)}`);
    lines.push(`  CLS:  ${isFinite(fleetVitals.cls) ? fleetVitals.cls.toFixed(3) : "—"}`);
    lines.push(`  TTFB: ${fmt.ms(fleetVitals.ttfb)}`);
    lines.push("");
    lines.push("--- Report Card (all apps) ---");
    allAppsScoredRows.forEach(({ summary, score }) => {
      const g = gradeFromScore(score);
      lines.push(`  ${summary.application}: ${g.letter} (${isFinite(score) ? score.toFixed(0) + "/100" : "—"})`);
    });
    navigator.clipboard.writeText(lines.join("\n"))
      .then(() => console.log("Copied executive summary to clipboard"))
      .catch((e) => console.warn("Copy failed", e));
  }, [sel, scoredRows, timeframeDays, grade, fleetScore, gradeMetrics, narrative, totals, fleetVitals, impactStats, whatChanged, reportCardRows]);

  const exportReport = useCallback(() => {
    const scopeLabel = sel
      ? (sel.length === 1 ? sel[0] : `${sel.length} web apps`)
      : `${scoredRows.length} web apps`;
    const periodLabel = timeframeDays >= 1 ? `${timeframeDays} days` : `${Math.round(timeframeDays * 24)}h`;
    const html = `
<!doctype html>
<html><head><meta charset="utf-8"><title>Executive Summary — ${scopeLabel}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 32px; color: #1f2233; background: #fff; }
  h1 { margin: 0 0 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
  .grade { display: flex; align-items: center; gap: 24px; padding: 20px; border: 2px solid ${grade.color}; border-radius: 12px; margin-bottom: 24px; }
  .letter { font-size: 72px; font-weight: 900; color: ${grade.color}; line-height: 1; }
  .score { font-size: 15px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 13px; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f6f7fb; font-weight: 700; }
  .metric-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #eee; }
  .metric-label { width: 180px; font-weight: 600; }
  .bar-bg { flex: 1; height: 10px; background: #eee; border-radius: 5px; overflow: hidden; }
  .metric-value { width: 100px; text-align: right; font-family: monospace; font-weight: 700; }
  .narrative { padding: 14px; background: #f6f7fb; border-left: 4px solid #4589FF; margin-bottom: 24px; }
  .narrative p { margin: 6px 0; font-size: 14px; }
  h2 { margin-top: 28px; border-bottom: 2px solid #e0e0e0; padding-bottom: 6px; }
  .kpi-grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 24px; }
  .kpi-card { padding: 14px 18px; border-radius: 10px; border: 1px solid #e0e0e0; min-width: 130px; flex: 1 1 130px; }
  .kpi-label { font-size: 11px; color: #888; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 800; }
  .kpi-delta { font-size: 11px; font-weight: 600; margin-top: 3px; }
  .kpi-sub { font-size: 10px; color: #aaa; margin-top: 2px; }
  .changed-row { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 8px; background: #f9f9fb; border: 1px solid #eee; margin-bottom: 4px; }
  .report-grid { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 24px; }
  .report-card { padding: 12px 16px; border-radius: 12px; min-width: 110px; text-align: center; border: 2px solid; }
  @media print { body { padding: 16px; } }
</style></head>
<body>
  <h1>Executive Summary</h1>
  <div class="sub">Scope: <b>${scopeLabel}</b> · Period: last ${periodLabel} · Generated ${new Date().toLocaleString()}</div>

  <div class="grade">
    <div class="letter">${grade.letter}</div>
    <div>
      <div style="font-size: 20px; font-weight: 700;">Fleet Grade</div>
      <div class="score">Weighted score: <b>${isFinite(fleetScore) ? fleetScore.toFixed(1) : "—"} / 100</b></div>
      <div style="font-size: 12px; color: #888; margin-top: 6px;">Blend of Apdex (${gradeWeights.apdex}%), Error rate (${gradeWeights.errorRate}%), CWV — LCP (${gradeWeights.lcp}%), INP (${gradeWeights.inp}%), CLS (${gradeWeights.cls}%), TTFB (${gradeWeights.ttfb}%)</div>
    </div>
  </div>

  <h2>Grade Breakdown</h2>
  ${gradeMetrics.map((m) => m.weight != null ? `
    <div class="metric-row">
      <div class="metric-label">${m.label} <span style="color:#888; font-weight:normal;">(${m.weight}%)</span></div>
      <div class="bar-bg"><div style="height:100%; width:${Math.max(0, Math.min(100, m.score || 0))}%; background:${m.color};"></div></div>
      <div class="metric-value" style="color:${m.color};">${m.value}</div>
      <div style="width:60px; text-align:right; font-family:monospace; color:#888;">${isFinite(m.score) ? m.score.toFixed(0) + "/100" : "—"}</div>
    </div>` : `
    <div style="padding: 4px 0 4px 20px; font-size: 12px; color: #555; border-bottom: 1px solid #f0f0f0;">
      ↳ ${m.label}: <b style="color:${m.color};">${m.value}</b>
    </div>`).join("")}

  <h2>Narrative</h2>
  <div class="narrative">${narrative.map((l) => `<p>${l}</p>`).join("")}</div>

  <h2>Business Impact</h2>
  <div class="kpi-grid">
    ${impactStats.map((s) => {
      const dColor = s.delta == null || s.delta.neutral ? "#888" : s.delta.positive ? "#0D9C29" : "#C21930";
      const arrow = s.delta == null || s.delta.neutral ? "=" : s.delta.positive ? "↑" : "↓";
      return `<div class="kpi-card">
        <div class="kpi-label">${s.label}</div>
        <div class="kpi-value">${s.value}</div>
        ${s.delta ? `<div class="kpi-delta" style="color:${dColor};">${arrow} ${s.delta.label}</div>` : ""}
        <div class="kpi-sub">${s.subtext}</div>
      </div>`;
    }).join("")}
  </div>

  ${whatChanged.length > 0 ? `
  <h2>What Changed</h2>
  <div style="margin-bottom: 24px;">
    ${whatChanged.map((w) => `
      <div class="changed-row">
        <div style="min-width: 180px; font-size: 13px; font-weight: 700;">${w.application}</div>
        <div style="font-size: 20px; font-weight: 900;">
          <span style="color:${w.prevGrade.color}; opacity:0.6;">${w.prevGrade.letter}</span>
          <span style="font-size:13px; opacity:0.4;"> → </span>
          <span style="color:${w.curr.color};">${w.curr.letter}</span>
        </div>
        <div style="font-family:monospace; font-size:13px; font-weight:700; color:${w.delta > 0 ? "#0D9C29" : "#C21930"};">${w.delta > 0 ? "+" : ""}${w.delta.toFixed(0)} pts</div>
        ${w.driver ? `<div style="font-size:12px; color:#888;">${w.driver}</div>` : ""}
      </div>`).join("")}
  </div>` : ""}

  <h2>Key Metrics</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Sessions</td><td>${fmt.num(totals.sessions)}</td></tr>
    <tr><td>Actions</td><td>${fmt.num(totals.actions)}</td></tr>
    <tr><td>Errors</td><td>${fmt.num(totals.errors)} (${fmt.pct(totals.errorRate)})</td></tr>
    <tr><td>Apdex</td><td>${isFinite(totals.apdex) ? totals.apdex.toFixed(2) : "—"} — ${apdexLabel(totals.apdex)}</td></tr>
    <tr><td>Avg duration</td><td>${fmt.ms(totals.avgDur)}</td></tr>
  </table>

  <h2>Core Web Vitals</h2>
  <table>
    <tr><th>Metric</th><th>Value</th><th>Status</th></tr>
    <tr><td>LCP</td><td>${fmt.ms(fleetVitals.lcp)}</td><td style="color:${cwvLcpClr(fleetVitals.lcp)};">${!isFinite(fleetVitals.lcp) ? "—" : fleetVitals.lcp <= 2500 ? "Good" : fleetVitals.lcp <= 4000 ? "Needs improvement" : "Poor"}</td></tr>
    <tr><td>INP</td><td>${fmt.ms(fleetVitals.inp)}</td><td style="color:${cwvInpClr(fleetVitals.inp)};">${!isFinite(fleetVitals.inp) ? "—" : fleetVitals.inp <= 200 ? "Good" : fleetVitals.inp <= 500 ? "Needs improvement" : "Poor"}</td></tr>
    <tr><td>CLS</td><td>${isFinite(fleetVitals.cls) ? fleetVitals.cls.toFixed(3) : "—"}</td><td style="color:${cwvClsClr(fleetVitals.cls)};">${!isFinite(fleetVitals.cls) ? "—" : fleetVitals.cls <= 0.1 ? "Good" : fleetVitals.cls <= 0.25 ? "Needs improvement" : "Poor"}</td></tr>
    <tr><td>TTFB</td><td>${fmt.ms(fleetVitals.ttfb)}</td><td style="color:${cwvTtfbClr(fleetVitals.ttfb)};">${!isFinite(fleetVitals.ttfb) ? "—" : fleetVitals.ttfb <= 800 ? "Good" : fleetVitals.ttfb <= 1800 ? "Needs improvement" : "Poor"}</td></tr>
  </table>

  <h2>Report Card (all apps)</h2>
  <div class="report-grid">
    ${reportCardRows.map(({ summary, score }) => {
      const g = gradeFromScore(score);
      return `<div class="report-card" style="border-color:${g.color}44; background:${g.color}0d;">
        <div style="font-size:36px; font-weight:900; color:${g.color}; line-height:1.1;">${g.letter}</div>
        <div style="font-size:11px; font-weight:600; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:110px;">${summary.application}</div>
        <div style="font-size:10px; color:#888; font-family:monospace;">${isFinite(score) ? score.toFixed(0) + "/100" : "—"}</div>
      </div>`;
    }).join("")}
  </div>

  <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
</body></html>
    `;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }, [sel, scoredRows, timeframeDays, grade, fleetScore, gradeMetrics, narrative, totals, fleetVitals, impactStats, whatChanged, reportCardRows]);

  return (
    <div>
      {aiPanel}
      {/* Header bar with export/copy buttons */}
      <div style={{ display: "flex", alignItems: "center", padding: "20px 20px 0", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.2 }}>Executive Summary</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
            Scope: <b>{sel ? (sel.length === 1 ? sel[0] : `${sel.length} web apps`) : `${scoredRows.length} web app${scoredRows.length === 1 ? "" : "s"}`}</b> ·
            Period: last {timeframeDays >= 1 ? `${timeframeDays} day${timeframeDays === 1 ? "" : "s"}` : `${Math.round(timeframeDays * 24)}h`}
          </div>
        </div>
        <button className="uj-export-btn" onClick={copyReportText}
          title="Copy summary text to clipboard"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(128,128,128,0.08)", color: "inherit", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect x="6" y="6" width="10" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="4" y="2" width="10" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Copy Text
        </button>
        <button className="uj-export-btn" onClick={exportReport}
          title="Export as printable HTML report"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(69,137,255,0.12)", color: "inherit", border: "1px solid rgba(69,137,255,0.45)", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 3 v9 M6 8 l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M3 15 v2 a1 1 0 0 0 1 1 h12 a1 1 0 0 0 1-1 v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Overall grade card */}
      <div className="uj-grade-card" style={{ margin: "16px 20px 8px", padding: 20, border: `2px solid ${grade.color}55`, borderRadius: 14, background: `${grade.color}0d`, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ fontSize: 96, fontWeight: 900, color: grade.color, lineHeight: 1, letterSpacing: -3, minWidth: 120, textAlign: "center" }}>{grade.letter}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Overall Fleet Grade</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>Weighted score: <b>{isFinite(fleetScore) ? fleetScore.toFixed(1) : "—"}</b> / 100</div>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>Blend of Apdex ({gradeWeights.apdex}%), Error rate ({gradeWeights.errorRate}%), CWV — LCP ({gradeWeights.lcp}%), INP ({gradeWeights.inp}%), CLS ({gradeWeights.cls}%), TTFB ({gradeWeights.ttfb}%). Apdex uses satisfied/tolerating/frustrated counts.</div>
        </div>
      </div>

      {/* Grade breakdown bars */}
      <SectionCard title="Grade Breakdown" subtitle="Weighted contributors to the overall fleet grade.">
        <div>
          {gradeMetrics.map((m) => (
            <GradeMetricRow key={m.label} label={m.label} weight={m.weight} score={m.score} displayValue={m.value} color={m.color} indent={m.indent} />
          ))}
        </div>
      </SectionCard>

      {/* AI narrative */}
      <SectionHeader
        title="AI Executive Narrative"
        subtitle="Auto-generated summary of the current period."
        icon={
          <svg width="20" height="20" viewBox="0 0 20 20">
            <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill={PURPLE} opacity="0.9" />
          </svg>
        }
      />
      <div style={{ margin: "0 20px 4px", padding: 16, borderLeft: `4px solid ${PURPLE}`, background: `${PURPLE}0d`, borderRadius: "0 10px 10px 0" }}>
        {narrative.map((line, i) => (
          <div key={i} style={{ fontSize: 13, lineHeight: 1.6, margin: "4px 0" }}>{line}</div>
        ))}
      </div>

      {/* Business Impact (#3) */}
      <SectionHeader title="Business Impact" subtitle="Key metrics vs the prior equivalent period." />
      <div style={{ padding: "0 20px 8px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        {impactStats.map((s) => {
          const dColor = s.delta == null || s.delta.neutral ? "rgba(128,128,128,0.6)" : s.delta.positive ? GREEN : RED;
          return (
            <div key={s.label} style={{ padding: "12px 18px", borderRadius: 10, background: "rgba(128,128,128,0.07)", border: "1px solid rgba(128,128,128,0.15)", minWidth: 140, flex: "1 1 140px" }}>
              <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>{s.value}</div>
              {s.delta != null && (
                <div style={{ fontSize: 11, color: dColor, fontWeight: 600, marginTop: 3 }}>
                  {s.delta.neutral ? "=" : s.delta.positive ? "↑" : "↓"} {s.delta.label}
                </div>
              )}
              <div style={{ fontSize: 10, opacity: 0.45, marginTop: 2 }}>{s.subtext}</div>
            </div>
          );
        })}
      </div>

      {/* What Changed per-app (#1) */}
      {whatChanged.length > 0 && (
        <>
          <SectionHeader title="What Changed" subtitle="Apps with the largest score movement vs the prior period." />
          <div style={{ margin: "0 20px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
            {whatChanged.map((w) => (
              <div key={w.application} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 8, background: "rgba(128,128,128,0.06)", border: "1px solid rgba(128,128,128,0.12)" }}>
                <div style={{ minWidth: 170, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.application}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 20, fontWeight: 900 }}>
                  <span style={{ color: w.prevGrade.color, opacity: 0.6 }}>{w.prevGrade.letter}</span>
                  <span style={{ fontSize: 14, opacity: 0.4 }}>→</span>
                  <span style={{ color: w.curr.color }}>{w.curr.letter}</span>
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: w.delta > 0 ? GREEN : RED, fontWeight: 700, minWidth: 60 }}>
                  {w.delta > 0 ? "+" : ""}{w.delta.toFixed(0)} pts
                </div>
                {w.driver && <div style={{ fontSize: 11, opacity: 0.6 }}>{w.driver}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Regression Watchlist */}
      {regressionWatchlist.length > 0 && (
        <>
          <SectionHeader
            title="Regression Watchlist"
            subtitle="Apps with confirmed downward score trend across consecutive periods. Sorted by traffic × severity."
            icon={
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M3 5 L17 5 M3 10 L13 10 M3 15 L9 15" stroke={RED} strokeWidth="1.8" strokeLinecap="round" />
                <path d="M15 12 L18 16 L12 16 Z" fill={RED} />
              </svg>
            }
          />
          <div style={{ margin: "0 20px 8px" }}>
            {regressionWatchlist.map((w) => {
              const p2Label = w.p2Score != null ? `${w.p2Score.toFixed(0)} → ` : "";
              const trendStr = `${p2Label}${w.prevScore.toFixed(0)} → ${w.currScore.toFixed(0)}`;
              return (
                <div key={w.application} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 8, background: `${RED}08`, border: `1px solid ${RED}30`, marginBottom: 4 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: w.grade.color, minWidth: 36, textAlign: "center" }}>{w.grade.letter}</div>
                  <div style={{ minWidth: 170, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{w.application}</div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", opacity: 0.7, minWidth: 130 }}>
                    score: {trendStr}
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: RED, fontWeight: 700, minWidth: 70 }}>
                    {w.totalDrop.toFixed(0)} pts {w.consecutive ? "↘↘" : "↘"}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.5 }}>{fmt.num(w.sessions)} sessions</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Industry Benchmarks */}
      {(() => {
        const bench = industry ? INDUSTRY_BENCHMARKS[industry] : null;
        if (!bench) return null;
        const metrics: { label: string; fleet: number; ref: number; unit: string; lowerBetter: boolean }[] = [
          { label: "LCP",  fleet: fleetVitals.lcp,  ref: bench.lcp,  unit: "ms", lowerBetter: true },
          { label: "INP",  fleet: fleetVitals.inp,  ref: bench.inp,  unit: "ms", lowerBetter: true },
          { label: "CLS",  fleet: fleetVitals.cls,  ref: bench.cls,  unit: "",   lowerBetter: true },
          { label: "TTFB", fleet: fleetVitals.ttfb, ref: bench.ttfb, unit: "ms", lowerBetter: true },
        ];
        return (
          <SectionCard title={`Industry Benchmarks — ${industry}`} subtitle="Fleet P50 vs typical industry P75 from CrUX / HTTP Archive. Closer to zero is better.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {metrics.map(m => {
                if (!isFinite(m.fleet)) return null;
                const ratio = m.fleet / m.ref;
                const pctDiff = ((m.fleet - m.ref) / m.ref) * 100;
                const better = m.lowerBetter ? m.fleet <= m.ref : m.fleet >= m.ref;
                const clr = better ? GREEN : Math.abs(pctDiff) < 20 ? YELLOW : RED;
                const barFleet = Math.min(100, (m.fleet / (m.ref * 1.5)) * 100);
                const barRef = Math.min(100, (m.ref / (m.ref * 1.5)) * 100);
                return (
                  <div key={m.label} style={{ padding: "6px 10px", borderRadius: 6, background: `${clr}08`, border: `1px solid ${clr}25` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                      <div style={{ width: 44, fontSize: 12, fontWeight: 700 }}>{m.label}</div>
                      <div style={{ flex: 1, position: "relative", height: 12 }}>
                        {/* Reference bar (grey) */}
                        <div style={{ position: "absolute", top: 3, left: 0, width: `${barRef}%`, height: 6, background: "rgba(128,128,128,0.25)", borderRadius: 3 }} />
                        {/* Fleet bar */}
                        <div style={{ position: "absolute", top: 3, left: 0, width: `${barFleet}%`, height: 6, background: clr, borderRadius: 3, opacity: 0.8 }} />
                      </div>
                      <div style={{ minWidth: 90, textAlign: "right", fontSize: 11, fontFamily: "monospace" }}>
                        <span style={{ color: clr, fontWeight: 700 }}>{m.unit === "ms" ? fmt.ms(m.fleet) : m.fleet.toFixed(3)}</span>
                        <span style={{ opacity: 0.45 }}> vs {m.unit === "ms" ? fmt.ms(m.ref) : m.ref.toFixed(3)}</span>
                      </div>
                      <div style={{ minWidth: 64, textAlign: "right", fontSize: 11, fontWeight: 700, color: clr }}>
                        {pctDiff > 0 ? "+" : ""}{pctDiff.toFixed(0)}%
                      </div>
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.5, paddingLeft: 54 }}>
                      {better
                        ? `${Math.abs(pctDiff).toFixed(0)}% better than ${industry} median — maintain this`
                        : `${Math.abs(pctDiff).toFixed(0)}% slower than ${industry} peers — investigate`}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, opacity: 0.4, textAlign: "right", paddingTop: 4 }}>
                Industry: <strong>{industry}</strong> · Benchmarks reflect typical P75 from public CrUX / HTTP Archive data
              </div>
            </div>
          </SectionCard>
        );
      })()}

      <SectionHeader
        title="Report Card"
        subtitle={tl.enabled ? "Per-app grade — animates with timelapse playback." : sel ? `Per-app grade — ${reportCardRows.length} app${reportCardRows.length === 1 ? "" : "s"} selected. Click a card to toggle focus.` : "Per-app grade — all apps. Click a card to focus the rest of this tab, click again to clear."}
      />
      <div style={{ padding: "0 20px 20px", display: "flex", flexWrap: "wrap", gap: 10 }}>
        {reportCardRows.map(({ summary, score }) => {
          const g = gradeFromScore(score);
          const isSelected = sel?.includes(summary.application) ?? false;
          const sfDen = (summary.satisfied ?? 0) + (summary.tolerating ?? 0) + (summary.frustrated ?? 0);
          const sPct = sfDen > 0 ? ((summary.satisfied  ?? 0) / sfDen) * 100 : 0;
          const tPct = sfDen > 0 ? ((summary.tolerating ?? 0) / sfDen) * 100 : 0;
          const fPct = sfDen > 0 ? ((summary.frustrated ?? 0) / sfDen) * 100 : 0;
          return (
            <div
              key={summary.application}
              onClick={() => {
                if (isSelected) {
                  const next = (sel ?? []).filter(s => s !== summary.application);
                  setWebAppFilter({ selected: next.length > 0 ? next : null });
                } else {
                  setWebAppFilter({ selected: [...(sel ?? []), summary.application] });
                }
              }}
              style={{
                cursor: "pointer",
                padding: "12px 16px",
                borderRadius: 12,
                border: `2px solid ${isSelected ? g.color : `${g.color}44`}`,
                background: isSelected ? `${g.color}18` : `${g.color}08`,
                minWidth: 120,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                transition: "border-color .15s ease, background .15s ease",
                userSelect: "none",
              }}
            >
              <div style={{ fontSize: 40, fontWeight: 900, color: g.color, lineHeight: 1 }}>{g.letter}</div>
              <div style={{ fontSize: 11, fontWeight: 600, textAlign: "center", opacity: 0.85, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summary.application}
              </div>
              <div style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
                {isFinite(score) ? `${score.toFixed(0)}/100` : "—"}
              </div>
              {sfDen > 0 && (
                <div style={{ width: "100%", height: 4, borderRadius: 2, overflow: "hidden", display: "flex", marginTop: 2 }}>
                  <div style={{ width: `${sPct}%`, background: GREEN }} />
                  <div style={{ width: `${tPct}%`, background: YELLOW }} />
                  <div style={{ width: `${fPct}%`, background: RED }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
