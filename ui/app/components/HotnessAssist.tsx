import React from "react";
import { createPortal } from "react-dom";
import type { SharedBucketMetrics } from "../TimelapseContext";
import type { InsightItem, RecommendationItem } from "./AIInsights";
import { StreamText } from "./AIInsights";

const TL_HOT_ELEV = "#FFF04D";
const TL_HOT_WARM = "#FF3D9A";
const TL_HOT_HIGH = "#FF073A";
const GREEN = "#0D9C29";

export type Baselines = {
  sessions: { mean: number; std: number };
  errorRate: { mean: number; std: number };
  avgDurationMs: { mean: number; std: number };
  lcp: { mean: number; std: number };
  inp: { mean: number; std: number };
  cls: { mean: number; std: number };
  ttfb: { mean: number; std: number };
};

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const STYLE_ID = "hotness-assist-styles";
function ensureHAStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.uj-ha-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  border: 1px solid rgba(255,107,53,0.4); background: rgba(255,107,53,0.1);
  color: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all 0.2s ease; white-space: nowrap;
}
.uj-ha-btn:hover { background: rgba(255,107,53,0.2); border-color: rgba(255,107,53,0.65); box-shadow: 0 0 6px rgba(255,107,53,0.12); }
.uj-ha-btn.active { background: rgba(255,7,58,0.15); border-color: rgba(255,7,58,0.55); box-shadow: 0 0 10px rgba(255,7,58,0.18); }
.uj-export-btn {
  display: inline-flex; align-items: center;
  padding: 5px 12px; background: rgba(69,137,255,0.1);
  border: 1px solid rgba(69,137,255,0.3); border-radius: 6px;
  color: #4589FF; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.uj-export-btn:hover { background: rgba(69,137,255,0.2); border-color: rgba(69,137,255,0.5); }
@keyframes uj-ai-typewriter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.uj-ai-stream-word { display: inline; opacity: 0; animation: uj-ai-typewriter 0.3s ease forwards; }
.uj-ai-section-title {
  font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.6px; opacity: 0.5; margin-bottom: 8px;
}
.uj-ai-insight-row {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 6px 10px; border-radius: 6px; margin-bottom: 4px;
}
.uj-ai-insight-row.good     { background: rgba(13,156,41,0.06);  border-left: 3px solid #0D9C29; }
.uj-ai-insight-row.warning  { background: rgba(255,131,43,0.06); border-left: 3px solid #FF832B; }
.uj-ai-insight-row.critical { background: rgba(194,25,48,0.06);  border-left: 3px solid #C21930; }
.uj-ai-insight-row.info     { background: rgba(69,137,255,0.06); border-left: 3px solid #4589FF; }
.uj-ai-recommendation {
  display: flex; gap: 8px; align-items: flex-start;
  padding: 8px 12px; border-radius: 6px;
  background: rgba(128,128,128,0.04); margin-bottom: 4px;
}
.uj-ai-rec-badge {
  font-size: 10px; padding: 2px 6px; border-radius: 3px;
  font-weight: 700; text-transform: uppercase; white-space: nowrap; flex-shrink: 0;
}
.uj-ai-rec-badge.high   { background: rgba(194,25,48,0.12);  color: #C21930; }
.uj-ai-rec-badge.medium { background: rgba(255,131,43,0.12); color: #FF832B; }
.uj-ai-rec-badge.low    { background: rgba(128,128,128,0.1); }
`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmtCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const hotColor = (z: number) => z >= 2.5 ? TL_HOT_HIGH : z >= 1.5 ? TL_HOT_WARM : z >= 0.75 ? TL_HOT_ELEV : "#4589FF";

// Composite bucket score (0–100) from fleet-level metrics.
// Weights: error rate 25%, avg duration 25%, LCP 22%, INP 18%, CLS 6%, TTFB 4%
function bucketScore(row: SharedBucketMetrics): number {
  const s = (val: number | null, good: number, poor: number): number => {
    if (val == null || poor === good) return 50;
    return Math.max(0, Math.min(100, Math.round((poor - val) / (poor - good) * 100)));
  };
  return Math.round(
    s(row.errorRate, 0.5, 5) * 0.25 +
    s(row.avgDurationMs, 2000, 8000) * 0.25 +
    s(row.lcp, 2500, 4000) * 0.22 +
    s(row.inp, 200, 500) * 0.18 +
    s(row.cls, 0.1, 0.25) * 0.06 +
    s(row.ttfb, 800, 1800) * 0.04
  );
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
export interface HotnessAssistData {
  summary: string;
  worstIdx: number;
  worstBucketKey: string;
  worstHotZ: number;
  worstDriver: string;
  worstCwvVital: string | null;
  worstCwvTeam: string | null;
  worstCwvAction: string | null;
  worstRow: SharedBucketMetrics;
  bestIdx: number;
  bestBucketKey: string;
  bestRow: SharedBucketMetrics;
  hotBuckets: number;
  criticalBuckets: number;
  affectedSessions: number;
  cwvViolationBuckets: number;
  alertPattern: "deployment" | "load-induced" | "infrastructure" | "unknown";
  burstType: "stable" | "transient" | "sustained" | "chronic";
  maxConsecutiveHot: number;
  worstScore: number;
  bestScore: number;
  worst2Idx: number;
  worst2BucketKey: string;
  worst2HotZ: number;
  worst2Row: SharedBucketMetrics;
  worst2Score: number;
  best2Idx: number;
  best2BucketKey: string;
  best2Row: SharedBucketMetrics;
  best2Score: number;
  analyzedCount: number;
  cwvBudget: {
    lcp: { good: number; needs: number; poor: number };
    inp: { good: number; needs: number; poor: number };
    cls: { good: number; needs: number; poor: number };
    ttfb: { good: number; needs: number; poor: number };
  };
  errorRateDelta: number;
  durationDelta: number;
  lcpDelta: number | null;
  inpDelta: number | null;
  clsDelta: number | null;
  ttfbDelta: number | null;
  allHotness: number[];
  insights: InsightItem[];
  recommendations: RecommendationItem[];
  episodeCount: number;
  longestEpisodeBuckets: number;
  avgRecoveryBuckets: number;
  driftSlope: number;
  driftLabel: "worsening" | "stable" | "improving";
  worstProblems?: Array<{ displayId?: string; title: string }>;
}

// ---------------------------------------------------------------------------
// Analysis engine
// ---------------------------------------------------------------------------
export function analyzeHotnessTimelapse(
  allRows: SharedBucketMetrics[],
  hotness: number[],
  baselines: Baselines,
  bucketGranularity: string,
): HotnessAssistData {
  // Drop last bucket before analysis (may be an incomplete interval)
  const usableHotness = hotness.length > 1 ? hotness.slice(0, -1) : hotness;
  const usableRows    = allRows.length  > 1 ? allRows.slice(0, -1) : allRows;

  // Discard buckets with no session data from analysis
  const hasData       = usableRows.map(r => r.sessions > 0);
  const analyzedCount = hasData.filter(Boolean).length;

  // Ranked sort — top-2 worst (hottest) and top-2 best (coolest) — empty buckets excluded
  const ranked    = usableHotness.map((z, i) => ({ z, i })).filter((_, i) => hasData[i]).sort((a, b) => b.z - a.z);
  const worstIdx  = ranked[0]?.i ?? 0;
  const worst2Idx = ranked.length > 1 ? (ranked[1]?.i ?? worstIdx) : worstIdx;
  const bestIdx   = ranked[ranked.length - 1]?.i ?? 0;
  const best2Idx  = ranked.length > 1 ? (ranked[ranked.length - 2]?.i ?? bestIdx) : bestIdx;

  const worstRow  = usableRows[worstIdx];
  const worst2Row = usableRows[worst2Idx];
  const bestRow   = usableRows[bestIdx];
  const best2Row  = usableRows[best2Idx];
  const worstZ    = usableHotness[worstIdx]  ?? 0;
  const worst2Z   = usableHotness[worst2Idx] ?? 0;
  const bestZ     = usableHotness[bestIdx]   ?? 0;
  const best2Z    = usableHotness[best2Idx]  ?? 0;

  // Z-scores for worst bucket across all metrics
  const errZ  = baselines.errorRate.std > 0     ? (worstRow.errorRate   - baselines.errorRate.mean)     / baselines.errorRate.std     : 0;
  const durZ  = baselines.avgDurationMs.std > 0 ? (worstRow.avgDurationMs - baselines.avgDurationMs.mean) / baselines.avgDurationMs.std : 0;
  const lcpZ  = baselines.lcp.std  > 0 && worstRow.lcp  != null ? (worstRow.lcp  - baselines.lcp.mean)  / baselines.lcp.std  : 0;
  const inpZ  = baselines.inp.std  > 0 && worstRow.inp  != null ? (worstRow.inp  - baselines.inp.mean)  / baselines.inp.std  : 0;
  const clsZ  = baselines.cls.std  > 0 && worstRow.cls  != null ? (worstRow.cls  - baselines.cls.mean)  / baselines.cls.std  : 0;
  const ttfbZ = baselines.ttfb.std > 0 && worstRow.ttfb != null ? (worstRow.ttfb - baselines.ttfb.mean) / baselines.ttfb.std : 0;
  const sessZ = baselines.sessions.std > 0 ? (worstRow.sessions - baselines.sessions.mean) / baselines.sessions.std : 0;

  // [1] CWV Attribution — which vital drove the spike and what team/action to assign
  const cwvCandidates = [
    { vital: "LCP",  z: lcpZ,  team: "CDN / server delivery",      action: "check CDN cache-hit ratio and origin response times" },
    { vital: "CLS",  z: clsZ,  team: "render & layout stability",  action: "audit dynamic content injection and image/ad sizing" },
    { vital: "INP",  z: inpZ,  team: "JavaScript execution",        action: "profile main-thread blocking tasks and event handlers" },
    { vital: "TTFB", z: ttfbZ, team: "backend & network latency",   action: "check database query times and server response latency" },
  ].filter(c => c.z > 0).sort((a, b) => b.z - a.z);
  const topCwv = cwvCandidates[0] ?? null;

  // Driver classification (enhanced with CWV awareness)
  let worstDriver = "Mixed issues";
  if      (errZ >= 2.5)              worstDriver = "Error storm";
  else if (errZ >= 1.5)              worstDriver = "Error rate spike";
  else if (durZ >= 2.5 || lcpZ >= 2.5) worstDriver = "Severe performance regression";
  else if (durZ >= 1.5)              worstDriver = "Performance regression";
  else if (topCwv && topCwv.z >= 1.5) worstDriver = `${topCwv.vital} degradation`;
  else if (sessZ >= 2.0)             worstDriver = "Traffic surge";
  else if (sessZ <= -1.5)            worstDriver = "Traffic anomaly";
  else                               worstDriver = "Experience degradation";

  // [2] Traffic vs Error Decoupling — determines likely root-cause category
  let alertPattern: HotnessAssistData["alertPattern"] = "unknown";
  if      (errZ >= 1.0 && sessZ < 0.5)       alertPattern = "deployment";
  else if (errZ >= 1.0 && sessZ >= 0.75)     alertPattern = "load-induced";
  else if ((lcpZ >= 1.0 || durZ >= 1.0 || ttfbZ >= 1.0) && errZ < 0.5) alertPattern = "infrastructure";

  // [3] CWV Budget Heatmap + aggregate counts
  const cwvBudget: HotnessAssistData["cwvBudget"] = {
    lcp:  { good: 0, needs: 0, poor: 0 },
    inp:  { good: 0, needs: 0, poor: 0 },
    cls:  { good: 0, needs: 0, poor: 0 },
    ttfb: { good: 0, needs: 0, poor: 0 },
  };
  let hotBuckets = 0, criticalBuckets = 0, affectedSessions = 0, cwvViolationBuckets = 0;
  for (let i = 0; i < usableRows.length; i++) {
    if (!hasData[i]) continue;
    const row = usableRows[i];
    const z   = usableHotness[i] ?? 0;
    if (z >= 0.75) { hotBuckets++; affectedSessions += row.sessions; }
    if (z >= 2.5)  criticalBuckets++;
    let hasPoor = false;
    if (row.lcp  != null) { row.lcp  <= 2500 ? cwvBudget.lcp.good++  : row.lcp  <= 4000 ? cwvBudget.lcp.needs++  : (cwvBudget.lcp.poor++,  hasPoor = true); }
    if (row.inp  != null) { row.inp  <= 200  ? cwvBudget.inp.good++  : row.inp  <= 500  ? cwvBudget.inp.needs++  : (cwvBudget.inp.poor++,  hasPoor = true); }
    if (row.cls  != null) { row.cls  <= 0.1  ? cwvBudget.cls.good++  : row.cls  <= 0.25 ? cwvBudget.cls.needs++  : (cwvBudget.cls.poor++,  hasPoor = true); }
    if (row.ttfb != null) { row.ttfb <= 800  ? cwvBudget.ttfb.good++ : row.ttfb <= 1800 ? cwvBudget.ttfb.needs++ : (cwvBudget.ttfb.poor++, hasPoor = true); }
    if (hasPoor) cwvViolationBuckets++;
  }

  // [4] Composite Score Delta
  const worstScore  = bucketScore(worstRow);
  const worst2Score = bucketScore(worst2Row);
  const bestScore   = bucketScore(bestRow);
  const best2Score  = bucketScore(best2Row);

  // [5] Sustained vs Burst Classification
  let maxRun = 0, currentRun = 0;
  for (let i = 0; i < usableHotness.length; i++) {
    if (!hasData[i]) { currentRun = 0; continue; }
    const z = usableHotness[i];
    if (z >= 0.75) { currentRun++; maxRun = Math.max(maxRun, currentRun); }
    else currentRun = 0;
  }
  const burstType: HotnessAssistData["burstType"] =
    maxRun === 0 ? "stable" : maxRun <= 2 ? "transient" : maxRun <= 5 ? "sustained" : "chronic";

  // Deltas between worst and best
  const errorRateDelta = worstRow.errorRate    - bestRow.errorRate;
  const durationDelta  = worstRow.avgDurationMs - bestRow.avgDurationMs;
  const lcpDelta  = worstRow.lcp  != null && bestRow.lcp  != null ? worstRow.lcp  - bestRow.lcp  : null;
  const inpDelta  = worstRow.inp  != null && bestRow.inp  != null ? worstRow.inp  - bestRow.inp  : null;
  const clsDelta  = worstRow.cls  != null && bestRow.cls  != null ? worstRow.cls  - bestRow.cls  : null;
  const ttfbDelta = worstRow.ttfb != null && bestRow.ttfb != null ? worstRow.ttfb - bestRow.ttfb : null;

  // -------------------------------------------------------------------------
  // Insights
  // -------------------------------------------------------------------------
  const insights: InsightItem[] = [];

  // Spike severity + composite score
  if (worstZ >= 2.5) {
    insights.push({ severity: "critical", icon: "🔥", text: `Critical spike at bucket ${worstIdx + 1} (${worstRow.bucket}, Z=${worstZ.toFixed(1)}) driven by ${worstDriver.toLowerCase()}. Error rate ${worstRow.errorRate.toFixed(1)}%, avg load ${Math.round(worstRow.avgDurationMs)}ms${worstRow.lcp != null ? `, LCP ${Math.round(worstRow.lcp)}ms` : ""}. Composite performance score dropped to ${worstScore}/100 vs ${bestScore}/100 at best conditions.` });
  } else if (worstZ >= 1.5) {
    insights.push({ severity: "warning", icon: "⚠️", text: `Elevated spike at bucket ${worstIdx + 1} (${worstRow.bucket}, Z=${worstZ.toFixed(1)}) — ${worstDriver.toLowerCase()}. Composite score: ${worstScore}/100 vs ${bestScore}/100 at peak conditions.` });
  } else if (worstZ >= 0.75) {
    insights.push({ severity: "info", icon: "📈", text: `Hottest window at bucket ${worstIdx + 1} (${worstRow.bucket}, Z=${worstZ.toFixed(1)}) remained in tolerable range. Composite score: ${worstScore}/100.` });
  }

  // [1] CWV Attribution
  if (topCwv && topCwv.z >= 1.0) {
    const allSpikesStr = cwvCandidates.filter(c => c.z >= 0.75).map(c => `${c.vital} +${c.z.toFixed(1)}z`).join(", ");
    insights.push({
      severity: topCwv.z >= 2.0 ? "critical" : "warning", icon: "🎯",
      text: `CWV root-cause: dominant signal was ${topCwv.vital} (+${topCwv.z.toFixed(1)}z), pointing to ${topCwv.team}${cwvCandidates.length > 1 ? ` (other degraded vitals: ${allSpikesStr})` : ""}. Recommended action: ${topCwv.action}.`,
    });
  }

  // [2] Traffic vs Error Decoupling
  if (alertPattern === "deployment") {
    insights.push({ severity: "warning", icon: "🚢", text: `Deployment signal: error rate spiked to ${worstRow.errorRate.toFixed(1)}% while session volume stayed near-normal (sessionsZ=${sessZ.toFixed(1)}). This pattern strongly suggests a code deployment or configuration change rather than a capacity issue. Check deployment history around ${worstRow.bucket}.` });
  } else if (alertPattern === "load-induced") {
    insights.push({ severity: "warning", icon: "📈", text: `Load-induced degradation: both sessions (+${sessZ.toFixed(1)}z) and errors (+${errZ.toFixed(1)}z) spiked together, suggesting the infrastructure hit capacity limits. Consider triggering scale-out at ${Math.round(baselines.sessions.mean * 1.3).toLocaleString()} sessions/${bucketGranularity} (130% of average).` });
  } else if (alertPattern === "infrastructure") {
    insights.push({ severity: "warning", icon: "🔧", text: `Infrastructure signal: performance degraded (load ${Math.round(worstRow.avgDurationMs)}ms${worstRow.lcp != null ? `, LCP ${Math.round(worstRow.lcp)}ms` : ""}${worstRow.ttfb != null ? `, TTFB ${Math.round(worstRow.ttfb)}ms` : ""}) without a corresponding error spike — typical of CDN issues, network congestion, or origin server saturation rather than an application bug.` });
  }

  // Best window
  insights.push({ severity: "good", icon: "✨", text: `Peak performance at bucket ${bestIdx + 1} (${bestRow.bucket}, Z=${bestZ.toFixed(2)}) — error rate ${bestRow.errorRate.toFixed(1)}%, load ${Math.round(bestRow.avgDurationMs)}ms${bestRow.lcp != null ? `, LCP ${Math.round(bestRow.lcp)}ms` : ""}. Composite score: ${bestScore}/100. Use these conditions as the performance SLO baseline.` });

  // Error rate delta
  if (errorRateDelta > 2) {
    insights.push({ severity: "warning", icon: "🐛", text: `Error rate gap: ${errorRateDelta.toFixed(1)}pp between best (${bestRow.errorRate.toFixed(1)}%) and worst (${worstRow.errorRate.toFixed(1)}%) windows. High error rates directly degrade user experience and push users into frustrated Apdex buckets.` });
  }

  // LCP delta
  if (lcpDelta != null && lcpDelta > 500) {
    insights.push({ severity: "warning", icon: "🖼️", text: `LCP worsened ${Math.round(lcpDelta)}ms during the spike (${Math.round(bestRow.lcp!)}ms → ${Math.round(worstRow.lcp!)}ms). LCP > 4000ms is classified as Poor and negatively affects Google Search ranking in addition to user experience.` });
  }

  // INP delta
  if (inpDelta != null && inpDelta > 100) {
    insights.push({ severity: "warning", icon: "🖱️", text: `INP worsened ${Math.round(inpDelta)}ms during the spike (${Math.round(bestRow.inp!)}ms → ${Math.round(worstRow.inp!)}ms). Poor INP means JavaScript is blocking the main thread — users experience UI lag when clicking, typing, or scrolling.` });
  }

  // CLS delta
  if (clsDelta != null && clsDelta > 0.05) {
    insights.push({ severity: "warning", icon: "📐", text: `CLS worsened by ${clsDelta.toFixed(3)} units during the spike (${bestRow.cls!.toFixed(3)} → ${worstRow.cls!.toFixed(3)}). Layout instability during hot windows can indicate late-loading ads, dynamic content injection, or images without reserved dimensions.` });
  }

  // TTFB delta
  if (ttfbDelta != null && ttfbDelta > 200) {
    insights.push({ severity: "warning", icon: "🌐", text: `TTFB worsened ${Math.round(ttfbDelta)}ms during the spike (${Math.round(bestRow.ttfb!)}ms → ${Math.round(worstRow.ttfb!)}ms). Server response time degradation at this scale typically indicates database slowdowns, backend service saturation, or DNS resolution issues.` });
  }

  // [3] CWV Budget chronic violations
  const chronicVitals = (["lcp", "inp", "cls", "ttfb"] as const).filter(v => cwvBudget[v].poor > 0);
  const vitalLabel: Record<string, string> = { lcp: "LCP", inp: "INP", cls: "CLS", ttfb: "TTFB" };
  if (chronicVitals.length > 0) {
    const details = chronicVitals.map(v => `${vitalLabel[v]}: ${cwvBudget[v].poor}/${analyzedCount} buckets Poor`).join(", ");
    insights.push({ severity: chronicVitals.length >= 2 ? "critical" : "warning", icon: "📊", text: `Chronic CWV violations across the full period: ${details}. Violations outside hot windows are systemic issues requiring architectural fixes, not just incident response.` });
  }

  // Critical bucket count
  if (criticalBuckets > 0) {
    insights.push({ severity: "critical", icon: "🚨", text: `${criticalBuckets} bucket${criticalBuckets !== 1 ? "s" : ""} reached critical spike level (Z≥2.5) — these are the highest-priority remediation windows.` });
  }

  // [5] Sustained vs Burst
  if (burstType === "chronic") {
    insights.push({ severity: "critical", icon: "⏳", text: `Chronic degradation pattern detected: ${maxRun} consecutive hot buckets. This duration (${maxRun} × ${bucketGranularity}) suggests the issue was not self-healing and likely required explicit intervention — rollback, scaling, or emergency config fix.` });
  } else if (burstType === "sustained") {
    insights.push({ severity: "warning", icon: "⏱️", text: `Sustained degradation: ${maxRun} consecutive elevated buckets (${maxRun} × ${bucketGranularity} of hotness). The issue persisted long enough to warrant active intervention — check for auto-remediation workflows.` });
  } else if (burstType === "transient") {
    insights.push({ severity: "info", icon: "⚡", text: `Transient spike: max ${maxRun} consecutive hot bucket${maxRun !== 1 ? "s" : ""}, which self-resolved. This pattern suggests a brief cache miss storm, a deployment that auto-rolled back, or a short infrastructure hiccup.` });
  }

  // Traffic surge
  if (sessZ >= 1.5) {
    insights.push({ severity: "info", icon: "📈", text: `Traffic surge during worst window: ${fmtCount(worstRow.sessions)} sessions vs ${fmtCount(Math.round(baselines.sessions.mean))} average (+${sessZ.toFixed(1)}z). Performance issues tolerable at normal load often become critical when traffic amplifies infrastructure pressure.` });
  }

  // [6] Fleet Correlation
  const spikedMetricCount = [errZ, durZ, lcpZ, inpZ, clsZ, ttfbZ].filter(z => z >= 1.0).length;
  if (spikedMetricCount >= 3) {
    insights.push({ severity: "warning", icon: "🌐", text: `Fleet-wide event likely: ${spikedMetricCount} metrics degraded simultaneously (${spikedMetricCount} of 6 signals elevated), suggesting a shared infrastructure or CDN event rather than an app-specific regression. Check CDN provider status, shared backend services, and infrastructure change logs for ${worstRow.bucket}.` });
  } else if (spikedMetricCount <= 1 && worstZ >= 1.0) {
    insights.push({ severity: "info", icon: "🎯", text: `App-specific signal: only ${spikedMetricCount === 0 ? "no individual metric significantly" : "one metric"} deviated strongly. Use the Web App filter in the header to isolate individual applications and compare their hotness patterns.` });
  }

  // [4] Score gap alert threshold suggestion
  if (bestScore >= 70 && worstScore < 50) {
    insights.push({ severity: "good", icon: "📉", text: `Score gap: composite score swings from ${bestScore}/100 (best) to ${worstScore}/100 (worst spike) — a ${bestScore - worstScore}-point drop. Setting a Davis anomaly detection metric event at ${Math.round((bestScore + worstScore) / 2)}/100 would catch degradation midway through — before it hits critical levels.` });
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------
  const recs: RecommendationItem[] = [];

  if (topCwv && topCwv.z >= 1.5) {
    const actionDetail =
      topCwv.vital === "LCP"  ? "Target LCP ≤ 2500ms. Use Dynatrace Waterfall analysis, CDN access logs, and origin response time metrics to trace the delay source." :
      topCwv.vital === "INP"  ? "Target INP ≤ 200ms. Use browser DevTools Performance tab to identify long tasks blocking the main thread during the spike window." :
      topCwv.vital === "CLS"  ? "Target CLS ≤ 0.1. Reserve explicit size attributes for all images, ads, and iframes. Audit dynamic content injected above the fold." :
                                "Target TTFB ≤ 800ms. Check backend query performance, server-side caching (stale-while-revalidate), and connection pooling.";
    recs.push({ impact: "high", text: `${topCwv.vital} was the primary CWV driver of the worst spike. ${actionDetail}` });
  } else if (worstDriver.includes("Error")) {
    recs.push({ impact: "high", text: `Root-cause the error surge to ${worstRow.errorRate.toFixed(1)}% during ${worstRow.bucket}. Use the Errors & Reliability tab filtered to that window. Returning to baseline ${baselines.errorRate.mean.toFixed(1)}% error rate is the highest-leverage improvement for overall fleet health score.` });
  } else if (worstDriver.includes("Performance") || worstDriver.includes("regression")) {
    recs.push({ impact: "high", text: `Investigate the ${Math.round(durationDelta)}ms load time regression at ${worstRow.bucket}. Common causes: slow backend queries, CDN cache miss storm, or infrastructure saturation. Use Dynatrace Waterfall charts and distributed tracing to pinpoint the delay.` });
  }

  recs.push({ impact: "high", text: `Engineer for ${bestRow.bucket}-style conditions consistently: ${bestRow.errorRate.toFixed(1)}% error rate, ${Math.round(bestRow.avgDurationMs)}ms load${bestRow.lcp != null ? `, ${Math.round(bestRow.lcp)}ms LCP` : ""}. Composite score target: ${bestScore}/100. Set Davis anomaly detection to alert when composite score drops below ${Math.round(bestScore * 0.85)}/100 (85% of peak).` });

  if (alertPattern === "load-induced" || sessZ >= 1.5) {
    recs.push({ impact: "medium", text: `Scale-out headroom: configure auto-scaling to trigger at ${Math.round(baselines.sessions.mean * 1.3).toLocaleString()} sessions/${bucketGranularity} (130% of average) to absorb burst traffic before it degrades UX. Review current Kubernetes HPA or cloud scaling policies against this threshold.` });
  }

  if (cwvViolationBuckets > 0) {
    recs.push({ impact: "medium", text: `Set up CWV-specific metric events in Dynatrace to trigger workflows when LCP > 4000ms or INP > 500ms. This shifts alerting from lagging indicators (error rate) to leading ones (vitals degrading before users abandon). ${cwvViolationBuckets} of ${analyzedCount} buckets had at least one vital in Poor range.` });
  }

  if (burstType === "sustained" || burstType === "chronic") {
    recs.push({ impact: "medium", text: `The ${maxRun}-bucket sustained degradation window indicates insufficient auto-remediation. Configure Davis Workflows to auto-escalate to PagerDuty after 2 consecutive hot ${bucketGranularity} windows, and review SRE runbooks for rollback and scale-out playbooks.` });
  }

  if (affectedSessions > 1000) {
    recs.push({ impact: "medium", text: `${fmtCount(affectedSessions)} user sessions were in elevated hotness windows. Enable Session Replay sampling triggers on error rate or performance thresholds to capture real user impact evidence for stakeholder communication and root-cause analysis.` });
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const spikeSummary = criticalBuckets > 0
    ? `${hotBuckets} bucket${hotBuckets !== 1 ? "s" : ""} elevated including ${criticalBuckets} critical spike${criticalBuckets !== 1 ? "s" : ""}`
    : hotBuckets > 0 ? `${hotBuckets} bucket${hotBuckets !== 1 ? "s" : ""} elevated`
    : "all buckets within normal operating range";
  const burstDesc = burstType !== "stable" ? ` (${burstType} pattern, max ${maxRun} consecutive)` : "";
  const cwvAttr   = topCwv && topCwv.z >= 1.0 ? `, primary CWV driver: ${topCwv.vital}` : "";
  const patDesc   = alertPattern !== "unknown" ? ` Pattern analysis suggests ${alertPattern === "deployment" ? "a deployment regression" : alertPattern === "load-induced" ? "load-induced overload" : "infrastructure degradation"}.` : "";
  const summary = `Analyzed ${analyzedCount} ${bucketGranularity} bucket${analyzedCount !== 1 ? "s" : ""} across the full timelapse period (last bucket excluded as potentially incomplete; empty buckets excluded). ${spikeSummary.charAt(0).toUpperCase() + spikeSummary.slice(1)}${burstDesc}. Worst anomaly: bucket ${worstIdx + 1} (${worstRow.bucket}, Z=${worstZ.toFixed(1)}, driver: ${worstDriver}${cwvAttr}). Second-worst: bucket ${worst2Idx + 1} (${worst2Row.bucket}, Z=${worst2Z.toFixed(1)}). Composite score: worst ${worstScore}/100, best ${bestScore}/100.${affectedSessions > 0 ? ` ${fmtCount(affectedSessions)} sessions were in elevated windows.` : ""}${patDesc}`;

  // Spike episodes
  const HOT_THRESH = 0.75;
  const episodeList: { startIdx: number; endIdx: number; bucketCount: number }[] = [];
  let inEp = false, epStart = 0;
  for (let i = 0; i < usableHotness.length; i++) {
    if (usableHotness[i] >= HOT_THRESH) {
      if (!inEp) { inEp = true; epStart = i; }
    } else if (inEp) {
      episodeList.push({ startIdx: epStart, endIdx: i - 1, bucketCount: i - epStart });
      inEp = false;
    }
  }
  if (inEp) episodeList.push({ startIdx: epStart, endIdx: usableHotness.length - 1, bucketCount: usableHotness.length - epStart });
  const episodeCount = episodeList.length;
  const longestEpisodeBuckets = episodeList.reduce((m, ep) => Math.max(m, ep.bucketCount), 0);

  // Recovery speed
  const recoveryList = episodeList.map(ep => {
    for (let i = ep.endIdx + 1; i < usableHotness.length; i++) {
      if (usableHotness[i] < 0.3 || usableHotness[i] >= HOT_THRESH) return i - ep.endIdx;
    }
    return usableHotness.length - ep.endIdx;
  });
  const avgRecoveryBuckets = recoveryList.length > 0
    ? Math.round(recoveryList.reduce((s, v) => s + v, 0) / recoveryList.length)
    : 0;

  // Drift trend (linear regression)
  const dn = usableHotness.length;
  const dSumX = (dn * (dn - 1)) / 2;
  const dSumX2 = (dn * (dn - 1) * (2 * dn - 1)) / 6;
  const dSumY = usableHotness.reduce((s, v) => s + v, 0);
  const dSumXY = usableHotness.reduce((s, v, i) => s + i * v, 0);
  const driftSlope = dn > 1 ? (dn * dSumXY - dSumX * dSumY) / (dn * dSumX2 - dSumX * dSumX) : 0;
  const driftLabel: "worsening" | "stable" | "improving" = driftSlope > 0.02 ? "worsening" : driftSlope < -0.02 ? "improving" : "stable";

  return {
    summary, worstIdx, worstBucketKey: worstRow.bucket, worstHotZ: worstZ, worstDriver,
    worstCwvVital: topCwv?.vital ?? null, worstCwvTeam: topCwv?.team ?? null, worstCwvAction: topCwv?.action ?? null,
    worstRow, bestIdx, bestBucketKey: bestRow.bucket, bestRow,
    worst2Idx, worst2BucketKey: worst2Row.bucket, worst2HotZ: worst2Z, worst2Row, worst2Score,
    best2Idx, best2BucketKey: best2Row.bucket, best2Row, best2Score,
    analyzedCount,
    hotBuckets, criticalBuckets, affectedSessions, cwvViolationBuckets,
    alertPattern, burstType, maxConsecutiveHot: maxRun,
    worstScore, bestScore, cwvBudget,
    errorRateDelta, durationDelta, lcpDelta, inpDelta, clsDelta, ttfbDelta,
    allHotness: hotness, insights, recommendations: recs,
    episodeCount, longestEpisodeBuckets, avgRecoveryBuckets, driftSlope, driftLabel,
  };
}

// ---------------------------------------------------------------------------
// HotnessAssistButton
// ---------------------------------------------------------------------------
export function HotnessAssistButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  ensureHAStyles();
  return (
    <button className={`uj-ha-btn${active ? " active" : ""}`} onClick={onClick} title="Hotness Assist — full-period timelapse analysis">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C9 6 7 10 9 13C10 15 11 16 10 18C12 17 13 15 12 13C14 14 15 16 14 18C16 16 17 13 15 10C17 12 18 14 17 17C19 15 19 11 17 8C20 10 21 13 20 16C22 13 21 8 18 5C15 3 13 2 12 2Z" fill="url(#ha-btn-grad)" />
        <defs><linearGradient id="ha-btn-grad" x1="7" y1="2" x2="17" y2="18"><stop stopColor="#FF6B35"/><stop offset="0.5" stopColor="#FF073A"/><stop offset="1" stopColor="#FF3D9A"/></linearGradient></defs>
      </svg>
      Hotness Assist
    </button>
  );
}

// ---------------------------------------------------------------------------
// HotnessAssistPanel
// ---------------------------------------------------------------------------
export function HotnessAssistPanel({
  data, pos, onClose, onDragStart,
}: {
  data: HotnessAssistData;
  pos: { x: number; y: number };
  onClose: () => void;
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  ensureHAStyles();
  const [panelW, setPanelW] = React.useState(648);
  const [panelH, setPanelH] = React.useState(600);
  const resizeRef = React.useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      setPanelW(Math.max(380, resizeRef.current.startW + dx));
      setPanelH(Math.max(420, resizeRef.current.startH + dy));
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const maxZ = Math.max(0.5, ...data.allHotness);
  const summaryWords    = data.summary.split(/\s+/).length;
  const summaryDuration = summaryWords * 60;
  const kpiDelay   = summaryDuration + 200;
  const chartDelay = summaryDuration + 700;
  const patDelay   = summaryDuration + 900;
  const cardsDelay = summaryDuration + 1100;
  const tableDelay = summaryDuration + 1300;
  const budgetDelay = summaryDuration + 1500;
  let insightOffset = summaryDuration + 1700;
  const insightDurations = data.insights.map(ins => ins.text.split(/\s+/).length * 60);

  const patternColor =
    data.alertPattern === "deployment"     ? TL_HOT_WARM :
    data.alertPattern === "load-induced"   ? TL_HOT_ELEV :
    data.alertPattern === "infrastructure" ? "#FF832B"   : "#888";
  const patternLabel =
    data.alertPattern === "deployment"     ? "Deployment Regression" :
    data.alertPattern === "load-induced"   ? "Load-Induced Overload" :
    data.alertPattern === "infrastructure" ? "Infrastructure Issue"  : "Pattern Unknown";
  const burstColor =
    data.burstType === "chronic"   ? TL_HOT_HIGH :
    data.burstType === "sustained" ? TL_HOT_WARM :
    data.burstType === "transient" ? TL_HOT_ELEV : GREEN;
  const burstLabel =
    data.burstType === "chronic"   ? `Chronic (${data.maxConsecutiveHot} consecutive)` :
    data.burstType === "sustained" ? `Sustained (${data.maxConsecutiveHot} consecutive)` :
    data.burstType === "transient" ? `Transient (${data.maxConsecutiveHot} consecutive)` : "Stable";

  // Greedy row assignment for chart labels — prevents overlap regardless of bucket proximity
  const chartW = Math.max(data.allHotness.length * 6, 120);
  const rawLabels = [
    { idx: data.worstIdx,  label: "W1", color: TL_HOT_HIGH, lineW: 1.5, lineOp: 0.75 },
    ...(data.worst2Idx !== data.worstIdx ? [{ idx: data.worst2Idx, label: "W2", color: "#FF8FAB",  lineW: 1,   lineOp: 0.65 }] : []),
    ...(data.bestIdx  !== data.worstIdx  ? [{ idx: data.bestIdx,   label: "B1", color: GREEN,       lineW: 1.5, lineOp: 0.75 }] : []),
    ...(data.best2Idx !== data.bestIdx && data.best2Idx !== data.worstIdx ? [{ idx: data.best2Idx, label: "B2", color: "#6EE7A0", lineW: 1, lineOp: 0.65 }] : []),
  ].map(l => ({ ...l, cx: Math.min(l.idx * 6 + 3, chartW - 10) }));
  const rowMaxX: number[] = [];
  const labelRow = new Map<string, number>();
  [...rawLabels].sort((a, b) => a.cx - b.cx).forEach(lbl => {
    let r = 0; while (r < rowMaxX.length && lbl.cx - rowMaxX[r] < 20) r++;
    labelRow.set(lbl.label, r); rowMaxX[r] = lbl.cx;
  });
  const labelRowH  = 14;
  const linesStartY = rowMaxX.length * labelRowH + 2;
  const chartBarH  = 130 - linesStartY;

  const generateReportHtml = (): string => {
    const ts = new Date().toLocaleString();
    const rMaxZ = Math.max(0.5, ...data.allHotness);
    const svgW  = Math.max(data.allHotness.length * 6, 120);
    const rSpecs = [
      { idx: data.worstIdx,  label: "W1", color: "#FF073A", lineW: 1.5, lineOp: 0.75 },
      ...(data.worst2Idx !== data.worstIdx ? [{ idx: data.worst2Idx, label: "W2", color: "#FF8FAB", lineW: 1,   lineOp: 0.65 }] : []),
      ...(data.bestIdx  !== data.worstIdx  ? [{ idx: data.bestIdx,   label: "B1", color: "#0D9C29", lineW: 1.5, lineOp: 0.75 }] : []),
      ...(data.best2Idx !== data.bestIdx   ? [{ idx: data.best2Idx,  label: "B2", color: "#6EE7A0", lineW: 1,   lineOp: 0.65 }] : []),
    ].map(l => ({ ...l, cx: Math.min(l.idx * 6 + 3, svgW - 10) }));
    const rRowMaxX: number[] = []; const rLabelRow = new Map<string, number>();
    [...rSpecs].sort((a, b) => a.cx - b.cx).forEach(lbl => {
      let r = 0; while (r < rRowMaxX.length && lbl.cx - rRowMaxX[r] < 20) r++;
      rLabelRow.set(lbl.label, r); rRowMaxX[r] = lbl.cx;
    });
    const rLabelRowH = 14; const rLinesY = rRowMaxX.length * rLabelRowH + 2; const rBarH = 130 - rLinesY;
    const rMarkedIdxs = new Set(rSpecs.map(l => l.idx));
    const bars  = data.allHotness.map((v, i) => {
      const h = Math.max(2, (v / rMaxZ) * rBarH);
      const c = v >= 2.5 ? "#FF073A" : v >= 1.5 ? "#FF3D9A" : v >= 0.75 ? "#FFF04D" : "#4589FF";
      return `<rect x="${i * 6 + 0.5}" y="${130 - h}" width="5" height="${h}" fill="${c}" opacity="${rMarkedIdxs.has(i) ? 1 : 0.65}" rx="0.5"/>`;
    }).join("");
    const threshLines = [{ z: 0.75, c: "#FFF04D" }, { z: 1.5, c: "#FF3D9A" }, { z: 2.5, c: "#FF073A" }]
      .map(({ z, c }) => `<line x1="0" y1="${130 - (z / rMaxZ) * rBarH}" x2="${svgW}" y2="${130 - (z / rMaxZ) * rBarH}" stroke="${c}" stroke-width="0.5" stroke-dasharray="3,2" opacity="0.4"/>`).join("");
    const markers = rSpecs.map(({ idx, label, color, lineW, lineOp, cx }) => {
      const row = rLabelRow.get(label) ?? 0;
      return `<line x1="${idx * 6 + 3}" y1="${rLinesY}" x2="${idx * 6 + 3}" y2="130" stroke="${color}" stroke-width="${lineW}" stroke-dasharray="3,2" opacity="${lineOp}"/><rect x="${cx - 9}" y="${row * rLabelRowH + 1}" width="18" height="13" rx="2" fill="rgba(15,20,40,0.88)"/><text x="${cx}" y="${row * rLabelRowH + 11}" font-size="8" fill="${color}" font-weight="700" font-family="'Segoe UI',system-ui,sans-serif" text-anchor="middle">${label}</text>`;
    }).join("");
    const mkMetricRows = (row: SharedBucketMetrics, score: number, color: string) => [
      { l: "Sessions",   v: fmtCount(row.sessions) },
      { l: "Error Rate", v: fmtPct(row.errorRate) },
      { l: "Avg Load",   v: `${Math.round(row.avgDurationMs)}ms` },
      { l: "Score",      v: `${score}/100` },
      ...(row.lcp  != null ? [{ l: "LCP",  v: `${Math.round(row.lcp)}ms` }]  : []),
      ...(row.inp  != null ? [{ l: "INP",  v: `${Math.round(row.inp)}ms` }]  : []),
      ...(row.cls  != null ? [{ l: "CLS",  v: row.cls.toFixed(3) }]           : []),
      ...(row.ttfb != null ? [{ l: "TTFB", v: `${Math.round(row.ttfb)}ms` }] : []),
    ].map(r => `<tr><td style="padding:3px 10px;opacity:0.7;font-size:12px">${r.l}</td><td style="padding:3px 10px;font-weight:600;font-size:12px;color:${color}">${r.v}</td></tr>`).join("");
    const worstMetrics  = mkMetricRows(data.worstRow,  data.worstScore,  "#FF073A");
    const bestMetrics   = mkMetricRows(data.bestRow,   data.bestScore,   "#0D9C29");
    const worst2Metrics = mkMetricRows(data.worst2Row, data.worst2Score, "#FF8FAB");
    const best2Metrics  = mkMetricRows(data.best2Row,  data.best2Score,  "#6EE7A0");
    const insightsHtml = data.insights.length > 0 ? `<h2>Insights</h2>${data.insights.map(ins => {
      const c = ins.severity === "critical" ? "#FF073A" : ins.severity === "warning" ? "#FF3D9A" : ins.severity === "good" ? "#0D9C29" : "#4589FF";
      return `<div style="margin-bottom:7px;padding:8px 12px;border-radius:6px;border-left:3px solid ${c};background:rgba(255,255,255,0.03)"><span style="font-size:10px;font-weight:700;text-transform:uppercase;opacity:0.55;margin-right:6px">${ins.severity}</span><span style="font-size:12px">${ins.icon} ${ins.text}</span></div>`;
    }).join("")}` : "";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hotness Assist Report</title>
<style>
  @media print{body{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}@page{margin:0.6in;size:A4;}.no-print{display:none !important;}}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e0e0e0;background:#0f1428;margin:0 auto;padding:32px;max-width:900px;line-height:1.5;}
  h1{margin:0 0 4px;font-size:22px;color:#FF6B35;}h2{font-size:12px;margin:20px 0 8px;border-bottom:1px solid rgba(255,255,255,0.12);padding-bottom:5px;color:#bbb;text-transform:uppercase;letter-spacing:0.5px;}
  table{border-collapse:collapse;width:100%;}.toolbar{text-align:right;margin-bottom:16px;}.toolbar button{background:#FF6B35;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:13px;cursor:pointer;}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;}.kpi-tile{background:rgba(128,128,128,0.08);border:1px solid rgba(128,128,128,0.15);border-radius:8px;padding:10px 14px;}
  .card-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;}.card{border-radius:8px;padding:12px 14px;}
  .page-break{page-break-before:always;}
  .pat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;}.pat-card{border-radius:8px;padding:12px 14px;}
  .diff-table{width:100%;border-collapse:collapse;margin-bottom:20px;}.diff-table th{padding:5px 10px;font-size:10px;font-weight:700;opacity:0.5;text-transform:uppercase;border-bottom:1px solid rgba(128,128,128,0.2);text-align:left;}.diff-table td{padding:5px 10px;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);}
</style></head><body>
<div class="toolbar no-print"><button onclick="window.print()">Print / Save PDF</button></div>
<h1>🔥 Hotness Assist Report — Frontend Overview</h1>
<div style="font-size:11px;color:#888;margin-bottom:20px">${data.allHotness.length} buckets · ${data.hotBuckets} elevated · ${data.criticalBuckets} critical · pattern: ${patternLabel} · ${burstLabel} | ${ts}</div>
<h2>Summary</h2><p style="font-size:13px;line-height:1.6;margin:0 0 20px">${data.summary}</p>
<h2>Key Metrics</h2>
<div class="kpi-grid">
  <div class="kpi-tile"><div style="font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Hot Buckets</div><div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.hotBuckets > 0 ? "#FFF04D" : "#4589FF"}">${data.hotBuckets}</div><div style="font-size:10px;opacity:0.4">of ${data.allHotness.length} total</div></div>
  <div class="kpi-tile"><div style="font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Critical Spikes</div><div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.criticalBuckets > 0 ? "#FF073A" : "#4589FF"}">${data.criticalBuckets}</div><div style="font-size:10px;opacity:0.4">Z ≥ 2.5</div></div>
  <div class="kpi-tile"><div style="font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Affected Sessions</div><div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.affectedSessions > 0 ? "#FF832B" : "#4589FF"}">${fmtCount(data.affectedSessions)}</div><div style="font-size:10px;opacity:0.4">in hot windows</div></div>
  <div class="kpi-tile"><div style="font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">CWV Violations</div><div style="font-size:22px;font-weight:700;font-family:monospace;color:${data.cwvViolationBuckets > 0 ? "#FF832B" : "#4589FF"}">${data.cwvViolationBuckets}</div><div style="font-size:10px;opacity:0.4">buckets w/ Poor vital</div></div>
</div>
<h2>Hotness Timeline</h2>
<div style="background:rgba(128,128,128,0.04);border:1px solid rgba(128,128,128,0.15);border-radius:8px;padding:8px 10px 6px;margin-bottom:20px">
  <svg width="100%" height="130" viewBox="0 0 ${svgW} 130" preserveAspectRatio="none" style="display:block">${threshLines}${bars}${markers}</svg>
</div>
<h2>Pattern Analysis</h2>
<div class="pat-grid">
  <div class="pat-card" style="background:${patternColor}12;border:1px solid ${patternColor}40">
    <div style="font-size:9px;opacity:0.55;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Pattern Analysis</div>
    <div style="font-size:14px;font-weight:700;color:${patternColor}">${patternLabel}</div>
    <div style="font-size:11px;opacity:0.55;margin-top:4px">${
      data.alertPattern === "deployment"     ? "Code / config change most likely" :
      data.alertPattern === "load-induced"   ? "Infrastructure capacity limit hit" :
      data.alertPattern === "infrastructure" ? "CDN, network, or origin saturation" : "Insufficient signal for classification"
    }</div>
  </div>
  <div class="pat-card" style="background:${burstColor}12;border:1px solid ${burstColor}40">
    <div style="font-size:9px;opacity:0.55;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Spike Duration</div>
    <div style="font-size:14px;font-weight:700;color:${burstColor}">${burstLabel}</div>
    <div style="font-size:11px;opacity:0.55;margin-top:4px">${
      data.burstType === "chronic"   ? "Needs active remediation" :
      data.burstType === "sustained" ? "Likely needed intervention" :
      data.burstType === "transient" ? "Appears self-resolved" : "No elevated buckets"
    }</div>
  </div>
</div>
<div class="page-break"></div>
<h2>What's Different — Worst #1 vs Best #1</h2>
<div class="card-grid">
  <div class="card" style="background:rgba(255,7,58,0.05);border:1px solid rgba(255,7,58,0.2)"><div style="font-size:11px;font-weight:700;color:#FF073A;text-transform:uppercase;margin-bottom:6px">🔥 Worst #1 — Bucket ${data.worstIdx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.worstBucketKey}</div><div style="font-size:13px;font-weight:700;color:#FF073A;margin-bottom:8px">Z=${data.worstHotZ.toFixed(2)} · ${data.worstDriver}</div><table><tbody>${worstMetrics}</tbody></table></div>
  <div class="card" style="background:rgba(13,156,41,0.04);border:1px solid rgba(13,156,41,0.2)"><div style="font-size:11px;font-weight:700;color:#0D9C29;text-transform:uppercase;margin-bottom:6px">✨ Best #1 — Bucket ${data.bestIdx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.bestBucketKey}</div><div style="font-size:13px;font-weight:700;color:#0D9C29;margin-bottom:8px">Z=${(data.allHotness[data.bestIdx] ?? 0).toFixed(2)} · Optimal</div><table><tbody>${bestMetrics}</tbody></table></div>
</div>
<table class="diff-table">
  <thead><tr><th>Metric</th><th style="color:#0D9C29">Best</th><th style="color:#FF073A">Worst</th><th>Gap</th></tr></thead>
  <tbody>
    ${([
      { label: "Score",      best: `${data.bestScore}/100`,                    worst: `${data.worstScore}/100`,                   gap: `−${data.bestScore - data.worstScore}pt`,  bad: data.bestScore - data.worstScore > 15 },
      { label: "Error Rate", best: `${data.bestRow.errorRate.toFixed(1)}%`,    worst: `${data.worstRow.errorRate.toFixed(1)}%`,   gap: `+${data.errorRateDelta.toFixed(1)}pp`,         bad: data.errorRateDelta > 1 },
      { label: "Avg Load",   best: `${Math.round(data.bestRow.avgDurationMs)}ms`, worst: `${Math.round(data.worstRow.avgDurationMs)}ms`, gap: `+${Math.round(data.durationDelta)}ms`,  bad: data.durationDelta > 200 },
      ...(data.lcpDelta  != null ? [{ label: "LCP",  best: `${Math.round(data.bestRow.lcp!)}ms`,  worst: `${Math.round(data.worstRow.lcp!)}ms`,  gap: `+${Math.round(data.lcpDelta)}ms`,       bad: data.lcpDelta  > 300 }] : []),
      ...(data.inpDelta  != null ? [{ label: "INP",  best: `${Math.round(data.bestRow.inp!)}ms`,  worst: `${Math.round(data.worstRow.inp!)}ms`,  gap: `+${Math.round(data.inpDelta)}ms`,       bad: data.inpDelta  > 50  }] : []),
      ...(data.clsDelta  != null ? [{ label: "CLS",  best: data.bestRow.cls!.toFixed(3),          worst: data.worstRow.cls!.toFixed(3),          gap: `+${data.clsDelta.toFixed(3)}`,           bad: data.clsDelta  > 0.05 }] : []),
      ...(data.ttfbDelta != null ? [{ label: "TTFB", best: `${Math.round(data.bestRow.ttfb!)}ms`, worst: `${Math.round(data.worstRow.ttfb!)}ms`, gap: `+${Math.round(data.ttfbDelta)}ms`,      bad: data.ttfbDelta > 100 }] : []),
      { label: "Sessions", best: fmtCount(data.bestRow.sessions), worst: fmtCount(data.worstRow.sessions), gap: "—", bad: false },
    ] as { label: string; best: string; worst: string; gap: string; bad: boolean }[]).map(r => `<tr><td>${r.label}</td><td style="color:#0D9C29;font-weight:600">${r.best}</td><td style="color:${r.bad ? "#FF073A" : "#e0e0e0"};font-weight:600">${r.worst}</td><td style="color:${r.bad ? "#FF073A" : "#4589FF"};font-weight:700">${r.gap}</td></tr>`).join("")}
  </tbody>
</table>
${data.worst2Idx !== data.worstIdx ? `<div class="page-break"></div>
<h2>Common Bad Signals — Worst #1 vs Worst #2</h2>
<div class="card-grid">
  <div class="card" style="background:rgba(255,7,58,0.05);border:1px solid rgba(255,7,58,0.2)"><div style="font-size:11px;font-weight:700;color:#FF073A;text-transform:uppercase;margin-bottom:6px">🔥 Worst #1 — Bucket ${data.worstIdx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.worstBucketKey}</div><div style="font-size:13px;font-weight:700;color:#FF073A;margin-bottom:8px">Z=${data.worstHotZ.toFixed(2)}</div><table><tbody>${worstMetrics}</tbody></table></div>
  <div class="card" style="background:rgba(255,143,171,0.05);border:1px solid rgba(255,143,171,0.25)"><div style="font-size:11px;font-weight:700;color:#FF8FAB;text-transform:uppercase;margin-bottom:6px">🔥 Worst #2 — Bucket ${data.worst2Idx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.worst2BucketKey}</div><div style="font-size:13px;font-weight:700;color:#FF8FAB;margin-bottom:8px">Z=${data.worst2HotZ.toFixed(2)}</div><table><tbody>${worst2Metrics}</tbody></table></div>
</div>
<table class="diff-table">
  <thead><tr><th>Metric</th><th style="color:#FF073A">W1 (bkt ${data.worstIdx + 1})</th><th style="color:#FF8FAB">W2 (bkt ${data.worst2Idx + 1})</th><th>Pattern</th></tr></thead>
  <tbody>
    ${([
      { label: "Error Rate", v1: `${data.worstRow.errorRate.toFixed(1)}%`,  v2: `${data.worst2Row.errorRate.toFixed(1)}%`,  bothHot: data.worstRow.errorRate > 2 && data.worst2Row.errorRate > 2 },
      { label: "Avg Load",   v1: `${Math.round(data.worstRow.avgDurationMs)}ms`, v2: `${Math.round(data.worst2Row.avgDurationMs)}ms`, bothHot: data.worstRow.avgDurationMs > 4000 && data.worst2Row.avgDurationMs > 4000 },
      ...(data.worstRow.lcp  != null && data.worst2Row.lcp  != null ? [{ label: "LCP",  v1: `${Math.round(data.worstRow.lcp)}ms`,  v2: `${Math.round(data.worst2Row.lcp)}ms`,  bothHot: data.worstRow.lcp  > 2500 && data.worst2Row.lcp  > 2500 }] : []),
      ...(data.worstRow.inp  != null && data.worst2Row.inp  != null ? [{ label: "INP",  v1: `${Math.round(data.worstRow.inp)}ms`,  v2: `${Math.round(data.worst2Row.inp)}ms`,  bothHot: data.worstRow.inp  > 200  && data.worst2Row.inp  > 200  }] : []),
      ...(data.worstRow.cls  != null && data.worst2Row.cls  != null ? [{ label: "CLS",  v1: data.worstRow.cls.toFixed(3),           v2: data.worst2Row.cls.toFixed(3),           bothHot: data.worstRow.cls  > 0.1  && data.worst2Row.cls  > 0.1  }] : []),
      ...(data.worstRow.ttfb != null && data.worst2Row.ttfb != null ? [{ label: "TTFB", v1: `${Math.round(data.worstRow.ttfb)}ms`, v2: `${Math.round(data.worst2Row.ttfb)}ms`, bothHot: data.worstRow.ttfb > 800  && data.worst2Row.ttfb > 800  }] : []),
    ] as { label: string; v1: string; v2: string; bothHot: boolean }[]).map(r => `<tr><td>${r.label}</td><td style="color:#FF3D9A;font-weight:600">${r.v1}</td><td style="color:#FF8FAB;font-weight:600">${r.v2}</td><td style="color:${r.bothHot ? "#FF832B" : "#888"};font-weight:700">${r.bothHot ? "Both hot" : "—"}</td></tr>`).join("")}
  </tbody>
</table>` : ""}
${data.best2Idx !== data.bestIdx ? `<div class="page-break"></div>
<h2>Common Good Signals — Best #1 vs Best #2</h2>
<div class="card-grid">
  <div class="card" style="background:rgba(13,156,41,0.04);border:1px solid rgba(13,156,41,0.2)"><div style="font-size:11px;font-weight:700;color:#0D9C29;text-transform:uppercase;margin-bottom:6px">✨ Best #1 — Bucket ${data.bestIdx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.bestBucketKey}</div><div style="font-size:13px;font-weight:700;color:#0D9C29;margin-bottom:8px">Z=${(data.allHotness[data.bestIdx] ?? 0).toFixed(2)}</div><table><tbody>${bestMetrics}</tbody></table></div>
  <div class="card" style="background:rgba(110,231,160,0.04);border:1px solid rgba(110,231,160,0.2)"><div style="font-size:11px;font-weight:700;color:#6EE7A0;text-transform:uppercase;margin-bottom:6px">✨ Best #2 — Bucket ${data.best2Idx + 1}</div><div style="font-size:10px;opacity:0.4;font-family:monospace;margin-bottom:6px">${data.best2BucketKey}</div><div style="font-size:13px;font-weight:700;color:#6EE7A0;margin-bottom:8px">Z=${(data.allHotness[data.best2Idx] ?? 0).toFixed(2)}</div><table><tbody>${best2Metrics}</tbody></table></div>
</div>
<table class="diff-table">
  <thead><tr><th>Metric</th><th style="color:#0D9C29">B1 (bkt ${data.bestIdx + 1})</th><th style="color:#6EE7A0">B2 (bkt ${data.best2Idx + 1})</th><th>Pattern</th></tr></thead>
  <tbody>
    ${([
      { label: "Error Rate", v1: `${data.bestRow.errorRate.toFixed(1)}%`,  v2: `${data.best2Row.errorRate.toFixed(1)}%`,  bothHealthy: data.bestRow.errorRate < 1 && data.best2Row.errorRate < 1 },
      { label: "Avg Load",   v1: `${Math.round(data.bestRow.avgDurationMs)}ms`, v2: `${Math.round(data.best2Row.avgDurationMs)}ms`, bothHealthy: data.bestRow.avgDurationMs < 3000 && data.best2Row.avgDurationMs < 3000 },
      ...(data.bestRow.lcp  != null && data.best2Row.lcp  != null ? [{ label: "LCP",  v1: `${Math.round(data.bestRow.lcp)}ms`,  v2: `${Math.round(data.best2Row.lcp)}ms`,  bothHealthy: data.bestRow.lcp  <= 2500 && data.best2Row.lcp  <= 2500 }] : []),
      ...(data.bestRow.inp  != null && data.best2Row.inp  != null ? [{ label: "INP",  v1: `${Math.round(data.bestRow.inp)}ms`,  v2: `${Math.round(data.best2Row.inp)}ms`,  bothHealthy: data.bestRow.inp  <= 200  && data.best2Row.inp  <= 200  }] : []),
      ...(data.bestRow.cls  != null && data.best2Row.cls  != null ? [{ label: "CLS",  v1: data.bestRow.cls.toFixed(3),           v2: data.best2Row.cls.toFixed(3),           bothHealthy: data.bestRow.cls  <= 0.1  && data.best2Row.cls  <= 0.1  }] : []),
      ...(data.bestRow.ttfb != null && data.best2Row.ttfb != null ? [{ label: "TTFB", v1: `${Math.round(data.bestRow.ttfb)}ms`, v2: `${Math.round(data.best2Row.ttfb)}ms`, bothHealthy: data.bestRow.ttfb <= 800  && data.best2Row.ttfb <= 800  }] : []),
    ] as { label: string; v1: string; v2: string; bothHealthy: boolean }[]).map(r => `<tr><td>${r.label}</td><td style="color:#0D9C29;font-weight:600">${r.v1}</td><td style="color:#6EE7A0;font-weight:600">${r.v2}</td><td style="color:${r.bothHealthy ? "#0D9C29" : "#888"};font-weight:700">${r.bothHealthy ? "Both healthy" : "—"}</td></tr>`).join("")}
  </tbody>
</table>` : ""}
${insightsHtml}
${data.recommendations.length > 0 ? `<div class="page-break"></div><h2>Recommendations</h2>${data.recommendations.map(rec => {
  const bCol = rec.impact === "high" ? "#C21930" : rec.impact === "medium" ? "#FF832B" : "#6b7280";
  const bBg  = rec.impact === "high" ? "rgba(194,25,48,0.12)" : rec.impact === "medium" ? "rgba(255,131,43,0.12)" : "rgba(128,128,128,0.12)";
  return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-radius:6px;background:rgba(128,128,128,0.05);border:1px solid rgba(128,128,128,0.12);margin-bottom:5px"><span style="font-size:10px;padding:2px 6px;border-radius:3px;font-weight:700;text-transform:uppercase;white-space:nowrap;flex-shrink:0;background:${bBg};color:${bCol}">${rec.impact}</span><span style="font-size:12px;line-height:1.5">${rec.text}</span></div>`;
}).join("")}` : ""}
${(data.cwvBudget.lcp.good + data.cwvBudget.lcp.needs + data.cwvBudget.lcp.poor + data.cwvBudget.inp.good + data.cwvBudget.inp.needs + data.cwvBudget.inp.poor) > 0 ? `<div class="page-break"></div><h2>CWV Budget — Full Period Distribution</h2><div style="background:rgba(128,128,128,0.04);border:1px solid rgba(128,128,128,0.15);border-radius:8px;padding:12px 16px;margin-bottom:20px">${(["lcp","inp","cls","ttfb"] as const).map(vital => {
  const b = data.cwvBudget[vital]; const total = b.good + b.needs + b.poor; if (total === 0) return "";
  const goodPct = Math.round(b.good / total * 100); const needsPct = Math.round(b.needs / total * 100); const poorPct = 100 - goodPct - needsPct;
  const lbl = {lcp:"LCP",inp:"INP",cls:"CLS",ttfb:"TTFB"}[vital]; const thr = {lcp:"≤2500ms",inp:"≤200ms",cls:"≤0.1",ttfb:"≤800ms"}[vital];
  return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;font-weight:600">${lbl} <span style="font-size:10px;opacity:0.45">Good ${thr}</span></span><span style="font-size:11px;opacity:0.5">${b.good}G · ${b.needs}NI · ${b.poor}P</span></div><div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px">${goodPct > 0 ? `<div style="flex:${goodPct};background:#0D9C29;opacity:0.8"></div>` : ""}${needsPct > 0 ? `<div style="flex:${needsPct};background:#FFF04D;opacity:0.8"></div>` : ""}${poorPct > 0 ? `<div style="flex:${poorPct};background:#FF073A;opacity:0.8"></div>` : ""}</div></div>`;
}).join("")}<div style="display:flex;gap:16px;margin-top:4px;font-size:10px;opacity:0.45"><span>&#9632; Good</span><span style="color:#FFF04D">&#9632; Needs Improvement</span><span style="color:#FF073A">&#9632; Poor</span></div></div>` : ""}
${data.worstProblems && data.worstProblems.length > 0 ? `<h2>Active Davis Problems During Worst Window</h2><div style="background:rgba(255,7,58,0.04);border:1px solid rgba(255,7,58,0.15);border-radius:8px;padding:10px 14px;margin-bottom:20px">${data.worstProblems.map((p, i) => `<div style="font-size:12px;display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:${i < data.worstProblems!.length - 1 ? "1px solid rgba(128,128,128,0.08)" : "none"}"><span style="color:#FF073A;font-size:10px;flex-shrink:0">&#9670;</span>${p.displayId ? `<span style="font-family:monospace;font-size:10px;color:#FF832B;flex-shrink:0">${p.displayId}</span>` : ""}<span style="opacity:0.8">${p.title}</span></div>`).join("")}</div>` : ""}
<div style="text-align:center;margin-top:30px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);font-size:10px;color:#555">Hotness Assist | Frontend Overview | ${data.analyzedCount}/${data.allHotness.length} buckets analyzed | ${ts}</div>
</body></html>`;
  };

  const handleExportPdf = () => {
    const html = generateReportHtml();
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  return createPortal(
    <div style={{ position: "fixed", left: pos.x, top: pos.y, width: panelW, height: panelH, background: "var(--dt-colors-background-base-default,#0f1428)", border: "1px solid rgba(255,107,53,0.3)", borderRadius: 10, boxShadow: "0 16px 56px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,107,53,0.08)", zIndex: 601, userSelect: "none", fontSize: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div onMouseDown={onDragStart} style={{ padding: "11px 14px", background: "linear-gradient(135deg, rgba(255,107,53,0.13) 0%, rgba(255,61,154,0.07) 100%)", borderBottom: "1px solid rgba(255,107,53,0.2)", cursor: "grab", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <path d="M12 2C9 6 7 10 9 13C10 15 11 16 10 18C12 17 13 15 12 13C14 14 15 16 14 18C16 16 17 13 15 10C17 12 18 14 17 17C19 15 19 11 17 8C20 10 21 13 20 16C22 13 21 8 18 5C15 3 13 2 12 2Z" fill="url(#ha-hdr-grad)" />
          <defs><linearGradient id="ha-hdr-grad" x1="7" y1="2" x2="17" y2="18"><stop stopColor="#FF6B35"/><stop offset="0.5" stopColor="#FF073A"/><stop offset="1" stopColor="#FF3D9A"/></linearGradient></defs>
        </svg>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Hotness Assist</span>
        <span style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>{data.analyzedCount}/{data.allHotness.length} buckets · {data.hotBuckets} elevated{data.criticalBuckets > 0 ? ` · ${data.criticalBuckets} critical` : ""}</span>
        <button onMouseDown={e => e.stopPropagation()} onClick={handleExportPdf} className="uj-export-btn" title="Open printable report for PDF export">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ marginRight: 5, verticalAlign: "middle" }}><path d="M4 1h5l4 4v9a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 14V2.5A1.5 1.5 0 014 1z" stroke="currentColor" strokeWidth="1.5"/><path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.5"/></svg>
          Export PDF
        </button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => {
            const appName = "Frontend Overview";
            const rec0 = data.recommendations[0]?.text ?? "Investigate root cause.";
            const text = `${appName} detected a ${data.alertPattern}-pattern spike — ${data.episodeCount} episode${data.episodeCount !== 1 ? "s" : ""} (longest ${data.longestEpisodeBuckets} bucket${data.longestEpisodeBuckets !== 1 ? "s" : ""}, peak Z=${data.worstHotZ.toFixed(1)}). Drift: ${data.driftLabel}. Recovery: ${data.avgRecoveryBuckets === 0 ? "n/a" : `avg ${data.avgRecoveryBuckets} bucket${data.avgRecoveryBuckets !== 1 ? "s" : ""}`}. Recommendation: ${rec0}`;
            navigator.clipboard.writeText(text).catch(() => {});
          }}
          title="Copy executive summary to clipboard"
          style={{ background: "rgba(128,128,128,0.12)", border: "1px solid rgba(128,128,128,0.2)", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 10, padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}
        >
          📋
        </button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.5, fontSize: 16, padding: "0 2px", lineHeight: 1 }}>✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: "auto", flex: 1, padding: "14px 16px" }}>

        {/* Summary */}
        <div style={{ marginBottom: 14 }}>
          <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: "100ms" }}>Summary</div>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,107,53,0.05)", border: "1px solid rgba(255,107,53,0.15)" }}>
            <StreamText text={data.summary} baseDelay={200} style={{ fontSize: 13, lineHeight: "1.6" }} />
          </div>
        </div>

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          {([
            { label: "Hot Buckets",       value: String(data.hotBuckets),              sub: `of ${data.analyzedCount} analyzed`,    color: data.hotBuckets > 0 ? TL_HOT_ELEV : "#4589FF" },
            { label: "Critical Spikes",   value: String(data.criticalBuckets),          sub: "Z ≥ 2.5",                              color: data.criticalBuckets > 0 ? TL_HOT_HIGH : "#4589FF" },
            { label: "Affected Sessions", value: fmtCount(data.affectedSessions),       sub: "in hot windows",                       color: data.affectedSessions > 0 ? "#FF832B" : "#4589FF" },
            { label: "CWV Violations",    value: String(data.cwvViolationBuckets),      sub: "buckets w/ Poor vital",                color: data.cwvViolationBuckets > 0 ? "#FF832B" : "#4589FF" },
          ] as const).map((tile, i) => (
            <div key={i} style={{ background: "rgba(128,128,128,0.06)", border: "1px solid rgba(128,128,128,0.14)", borderRadius: 8, padding: "10px 12px", opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${kpiDelay + i * 80}ms` }}>
              <div style={{ fontSize: 9, opacity: 0.5, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{tile.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: tile.color, fontFamily: "monospace", lineHeight: 1.2 }}>{tile.value}</div>
              <div style={{ fontSize: 9, opacity: 0.4, marginTop: 2 }}>{tile.sub}</div>
            </div>
          ))}
        </div>

        {/* Hotness mini-chart */}
        <div style={{ marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${chartDelay}ms` }}>
          <div className="uj-ai-section-title">Hotness Timeline — Full Period</div>
          <div style={{ background: "rgba(128,128,128,0.04)", border: "1px solid rgba(128,128,128,0.12)", borderRadius: 8, padding: "8px 10px 6px" }}>
            <svg width="100%" height="130" viewBox={`0 0 ${chartW} 130`} preserveAspectRatio="none" style={{ display: "block" }}>
              {[{ z: 0.75, color: TL_HOT_ELEV }, { z: 1.5, color: TL_HOT_WARM }, { z: 2.5, color: TL_HOT_HIGH }].map(({ z, color }) => (
                <line key={z} x1={0} y1={130 - (z / maxZ) * chartBarH} x2={chartW} y2={130 - (z / maxZ) * chartBarH} stroke={color} strokeWidth={0.5} strokeDasharray="3,2" opacity={0.4} />
              ))}
              {data.allHotness.map((v, i) => {
                const h = Math.max(2, (v / maxZ) * chartBarH);
                const color = v >= 2.5 ? TL_HOT_HIGH : v >= 1.5 ? TL_HOT_WARM : v >= 0.75 ? TL_HOT_ELEV : "#4589FF";
                const isMarked = rawLabels.some(l => l.idx === i);
                return <rect key={i} x={i * 6 + 0.5} y={130 - h} width={5} height={h} fill={color} opacity={isMarked ? 1 : 0.65} rx={0.5} />;
              })}
              {rawLabels.map(({ idx, label, color, lineW, lineOp, cx }) => {
                const row = labelRow.get(label) ?? 0;
                return (
                  <React.Fragment key={label}>
                    <line x1={idx * 6 + 3} y1={linesStartY} x2={idx * 6 + 3} y2={130} stroke={color} strokeWidth={lineW} strokeDasharray="3,2" opacity={lineOp} />
                    <rect x={cx - 9} y={row * labelRowH + 1} width={18} height={13} rx={2} fill="rgba(15,20,40,0.88)" />
                    <text x={cx} y={row * labelRowH + 11} fontSize={8} fill={color} fontWeight="700" fontFamily="'Segoe UI',system-ui,sans-serif" textAnchor="middle" opacity={0.95}>{label}</text>
                  </React.Fragment>
                );
              })}
            </svg>
            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 9, opacity: 0.4 }}>
              <span><span style={{ display: "inline-block", width: 7, height: 7, background: TL_HOT_ELEV, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Elevated (Z≥0.75)</span>
              <span><span style={{ display: "inline-block", width: 7, height: 7, background: TL_HOT_WARM, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Warm (Z≥1.5)</span>
              <span><span style={{ display: "inline-block", width: 7, height: 7, background: TL_HOT_HIGH, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Spike (Z≥2.5)</span>
            </div>
          </div>
        </div>

        {/* Alert Pattern + Burst type banner */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${patDelay}ms` }}>
          <div style={{ background: `${patternColor}12`, border: `1px solid ${patternColor}40`, borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Pattern Analysis</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: patternColor }}>{patternLabel}</div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
              {data.alertPattern === "deployment"     ? "Code / config change most likely" :
               data.alertPattern === "load-induced"   ? "Infrastructure capacity limit hit" :
               data.alertPattern === "infrastructure" ? "CDN, network, or origin saturation" : "Insufficient signal for classification"}
            </div>
          </div>
          <div style={{ background: `${burstColor}12`, border: `1px solid ${burstColor}40`, borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Spike Duration</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: burstColor }}>{burstLabel}</div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
              {data.burstType === "chronic"   ? "Needs active remediation" :
               data.burstType === "sustained" ? "Likely needed intervention" :
               data.burstType === "transient" ? "Appears self-resolved" : "No elevated buckets"}
            </div>
          </div>
        </div>

        {/* Spike Episodes + Recovery + Drift */}
        {(() => {
          const epColor = data.episodeCount === 0 ? "#10B981" : data.episodeCount === 1 ? "#FFF04D" : data.episodeCount <= 3 ? "#FF3D9A" : "#E00000";
          const recLabel = data.episodeCount === 0 ? "N/A" : data.avgRecoveryBuckets <= 1 ? "Rapid" : data.avgRecoveryBuckets <= 3 ? "Fast" : data.avgRecoveryBuckets <= 6 ? "Moderate" : "Slow";
          const recColor = data.episodeCount === 0 ? "#888" : data.avgRecoveryBuckets <= 1 ? "#10B981" : data.avgRecoveryBuckets <= 3 ? "#10B981" : data.avgRecoveryBuckets <= 6 ? "#FFF04D" : "#E00000";
          const driftColor = data.driftLabel === "worsening" ? "#E00000" : data.driftLabel === "improving" ? "#10B981" : "#888";
          const cs: React.CSSProperties = { flex: 1, borderRadius: 8, padding: "9px 11px", display: "flex", flexDirection: "column", gap: 2 };
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div style={{ ...cs, background: `${epColor}0d`, border: `1px solid ${epColor}30` }}>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.5, textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Spike Episodes</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: epColor }}>{data.episodeCount}</div>
                <div style={{ fontSize: 10, opacity: 0.6 }}>{data.episodeCount === 0 ? "No hot buckets" : `Longest: ${data.longestEpisodeBuckets} bucket${data.longestEpisodeBuckets !== 1 ? "s" : ""}`}</div>
              </div>
              <div style={{ ...cs, background: `${recColor}0d`, border: `1px solid ${recColor}30` }}>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.5, textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Recovery Speed</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: recColor }}>{recLabel}</div>
                <div style={{ fontSize: 10, opacity: 0.6 }}>{data.episodeCount === 0 ? "—" : `Avg ${data.avgRecoveryBuckets} bucket${data.avgRecoveryBuckets !== 1 ? "s" : ""} to baseline`}</div>
              </div>
              <div style={{ ...cs, background: `${driftColor}0d`, border: `1px solid ${driftColor}30` }}>
                <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.5, textTransform: "uppercase" as const, letterSpacing: 0.8 }}>Drift Trend</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: driftColor }}>{data.driftLabel.charAt(0).toUpperCase() + data.driftLabel.slice(1)}</div>
                <div style={{ fontSize: 10, opacity: 0.6 }}>{`${data.driftSlope >= 0 ? "+" : ""}${data.driftSlope.toFixed(3)}Z/bucket`}</div>
              </div>
            </div>
          );
        })()}

        {/* What's Different — W1 vs B1 title above cards */}
        <div className="uj-ai-section-title" style={{ marginBottom: 6, opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${cardsDelay - 150}ms` }}>What's Different — Worst #1 vs Best #1</div>

        {/* Pair 1: W1 vs B1 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${cardsDelay}ms` }}>
          {/* W1 */}
          <div style={{ background: "rgba(255,7,58,0.05)", border: "1px solid rgba(255,7,58,0.2)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: TL_HOT_HIGH, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>🔥 Worst #1 — Bucket {data.worstIdx + 1}</div>
            <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.worstBucketKey}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: hotColor(data.worstHotZ) }}>Z = {data.worstHotZ.toFixed(2)}</span>
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600, background: `${hotColor(data.worstHotZ)}22`, border: `1px solid ${hotColor(data.worstHotZ)}44`, color: hotColor(data.worstHotZ) }}>{data.worstDriver}</span>
            </div>
            {([
              { label: "Sessions",   value: fmtCount(data.worstRow.sessions),              bad: false },
              { label: "Score",      value: `${data.worstScore}/100`,                       bad: data.worstScore < 50 },
              { label: "Error Rate", value: fmtPct(data.worstRow.errorRate),                bad: data.worstRow.errorRate > 2 },
              { label: "Avg Load",   value: `${Math.round(data.worstRow.avgDurationMs)}ms`, bad: true },
              ...(data.worstRow.lcp  != null ? [{ label: "LCP",  value: `${Math.round(data.worstRow.lcp)}ms`,  bad: data.worstRow.lcp  > 2500 }] : []),
              ...(data.worstRow.inp  != null ? [{ label: "INP",  value: `${Math.round(data.worstRow.inp)}ms`,  bad: data.worstRow.inp  > 200  }] : []),
              ...(data.worstRow.cls  != null ? [{ label: "CLS",  value: data.worstRow.cls.toFixed(3),           bad: data.worstRow.cls  > 0.1  }] : []),
              ...(data.worstRow.ttfb != null ? [{ label: "TTFB", value: `${Math.round(data.worstRow.ttfb)}ms`, bad: data.worstRow.ttfb > 800  }] : []),
            ] as { label: string; value: string; bad: boolean }[]).map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: row.bad ? TL_HOT_WARM : "#c0c0c0" }}>{row.value}</span>
              </div>
            ))}
          </div>
          {/* B1 */}
          <div style={{ background: "rgba(13,156,41,0.04)", border: "1px solid rgba(13,156,41,0.2)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>✨ Best #1 — Bucket {data.bestIdx + 1}</div>
            <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.bestBucketKey}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: hotColor(data.allHotness[data.bestIdx] ?? 0) }}>Z = {(data.allHotness[data.bestIdx] ?? 0).toFixed(2)}</span>
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600, background: "rgba(13,156,41,0.12)", border: "1px solid rgba(13,156,41,0.3)", color: GREEN }}>Optimal</span>
            </div>
            {([
              { label: "Sessions",   value: fmtCount(data.bestRow.sessions),              good: false },
              { label: "Score",      value: `${data.bestScore}/100`,                       good: data.bestScore >= 70 },
              { label: "Error Rate", value: fmtPct(data.bestRow.errorRate),                good: data.bestRow.errorRate < 1 },
              { label: "Avg Load",   value: `${Math.round(data.bestRow.avgDurationMs)}ms`, good: true },
              ...(data.bestRow.lcp  != null ? [{ label: "LCP",  value: `${Math.round(data.bestRow.lcp)}ms`,  good: data.bestRow.lcp  <= 2500 }] : []),
              ...(data.bestRow.inp  != null ? [{ label: "INP",  value: `${Math.round(data.bestRow.inp)}ms`,  good: data.bestRow.inp  <= 200  }] : []),
              ...(data.bestRow.cls  != null ? [{ label: "CLS",  value: data.bestRow.cls.toFixed(3),           good: data.bestRow.cls  <= 0.1  }] : []),
              ...(data.bestRow.ttfb != null ? [{ label: "TTFB", value: `${Math.round(data.bestRow.ttfb)}ms`, good: data.bestRow.ttfb <= 800  }] : []),
            ] as { label: string; value: string; good: boolean }[]).map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: row.good ? GREEN : "#c0c0c0" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* What's Different — W1 vs B1 table */}
        <div style={{ marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${tableDelay}ms` }}>
          <div style={{ background: "rgba(128,128,128,0.03)", border: "1px solid rgba(128,128,128,0.12)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
              {["Metric", "Best", "Worst", "Gap"].map((h, i) => (
                <div key={i} style={{ padding: "5px 10px", fontSize: 9, fontWeight: 700, opacity: 0.45, textTransform: "uppercase", letterSpacing: 0.5, background: "rgba(128,128,128,0.06)", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>{h}</div>
              ))}
              {([
                { label: "Score",      best: `${data.bestScore}/100`,                    worst: `${data.worstScore}/100`,                   gap: `−${data.bestScore - data.worstScore}pt`,            bad: data.bestScore - data.worstScore > 15 },
                { label: "Error Rate", best: `${data.bestRow.errorRate.toFixed(1)}%`,    worst: `${data.worstRow.errorRate.toFixed(1)}%`,   gap: `+${data.errorRateDelta.toFixed(1)}pp`,              bad: data.errorRateDelta > 1 },
                { label: "Avg Load",   best: `${Math.round(data.bestRow.avgDurationMs)}ms`, worst: `${Math.round(data.worstRow.avgDurationMs)}ms`, gap: `+${Math.round(data.durationDelta)}ms`,        bad: data.durationDelta > 200 },
                ...(data.lcpDelta  != null ? [{ label: "LCP",  best: `${Math.round(data.bestRow.lcp!)}ms`,          worst: `${Math.round(data.worstRow.lcp!)}ms`,          gap: `+${Math.round(data.lcpDelta)}ms`,                bad: data.lcpDelta  > 300 }] : []),
                ...(data.inpDelta  != null ? [{ label: "INP",  best: `${Math.round(data.bestRow.inp!)}ms`,          worst: `${Math.round(data.worstRow.inp!)}ms`,          gap: `+${Math.round(data.inpDelta)}ms`,                bad: data.inpDelta  > 50  }] : []),
                ...(data.clsDelta  != null ? [{ label: "CLS",  best: data.bestRow.cls!.toFixed(3),                  worst: data.worstRow.cls!.toFixed(3),                  gap: `+${data.clsDelta.toFixed(3)}`,                   bad: data.clsDelta  > 0.05 }] : []),
                ...(data.ttfbDelta != null ? [{ label: "TTFB", best: `${Math.round(data.bestRow.ttfb!)}ms`,         worst: `${Math.round(data.worstRow.ttfb!)}ms`,         gap: `+${Math.round(data.ttfbDelta)}ms`,               bad: data.ttfbDelta > 100 }] : []),
                { label: "Sessions",   best: fmtCount(data.bestRow.sessions),            worst: fmtCount(data.worstRow.sessions),           gap: "—",                                                  bad: false },
              ] as { label: string; best: string; worst: string; gap: string; bad: boolean }[]).map((row, i, arr) => (
                <React.Fragment key={i}>
                  <div style={{ padding: "4px 10px", fontSize: 11, opacity: 0.75, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none" }}>{row.label}</div>
                  <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: GREEN, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none" }}>{row.best}</div>
                  <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: row.bad ? TL_HOT_WARM : "#c0c0c0", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none" }}>{row.worst}</div>
                  <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, color: row.bad ? TL_HOT_HIGH : "#4589FF", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none" }}>{row.gap}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Pair 2: W1 vs W2 + Common Bad Signals */}
        {data.worst2Idx !== data.worstIdx && (() => {
          type CompRow = { label: string; v1: string; v2: string; z1: number; z2: number; bothHot: boolean };
          const w1 = data.worstRow, w2 = data.worst2Row;
          const compRows: CompRow[] = [
            { label: "Error Rate", v1: fmtPct(w1.errorRate),               v2: fmtPct(w2.errorRate),               z1: data.worstHotZ,  z2: data.worst2HotZ, bothHot: w1.errorRate > 2 && w2.errorRate > 2 },
            { label: "Avg Load",   v1: `${Math.round(w1.avgDurationMs)}ms`, v2: `${Math.round(w2.avgDurationMs)}ms`, z1: data.worstHotZ, z2: data.worst2HotZ, bothHot: w1.avgDurationMs > 4000 && w2.avgDurationMs > 4000 },
            ...(w1.lcp  != null && w2.lcp  != null ? [{ label: "LCP",  v1: `${Math.round(w1.lcp)}ms`,  v2: `${Math.round(w2.lcp)}ms`,  z1: data.worstHotZ, z2: data.worst2HotZ, bothHot: w1.lcp  > 2500 && w2.lcp  > 2500 }] : []),
            ...(w1.inp  != null && w2.inp  != null ? [{ label: "INP",  v1: `${Math.round(w1.inp)}ms`,  v2: `${Math.round(w2.inp)}ms`,  z1: data.worstHotZ, z2: data.worst2HotZ, bothHot: w1.inp  > 200  && w2.inp  > 200  }] : []),
            ...(w1.cls  != null && w2.cls  != null ? [{ label: "CLS",  v1: w1.cls.toFixed(3),           v2: w2.cls.toFixed(3),           z1: data.worstHotZ, z2: data.worst2HotZ, bothHot: w1.cls  > 0.1  && w2.cls  > 0.1  }] : []),
            ...(w1.ttfb != null && w2.ttfb != null ? [{ label: "TTFB", v1: `${Math.round(w1.ttfb)}ms`, v2: `${Math.round(w2.ttfb)}ms`, z1: data.worstHotZ, z2: data.worst2HotZ, bothHot: w1.ttfb > 800  && w2.ttfb > 800  }] : []),
          ];
          return (<>
            <div className="uj-ai-section-title" style={{ marginBottom: 6, opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${tableDelay + 50}ms` }}>Common Bad Signals — Worst #1 vs Worst #2</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${tableDelay + 200}ms` }}>
              {/* W1 */}
              <div style={{ background: "rgba(255,7,58,0.05)", border: "1px solid rgba(255,7,58,0.2)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: TL_HOT_HIGH, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>🔥 Worst #1 — Bucket {data.worstIdx + 1}</div>
                <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.worstBucketKey}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: hotColor(data.worstHotZ), marginBottom: 6 }}>Z = {data.worstHotZ.toFixed(2)}</div>
                {([
                  { label: "Sessions",   value: fmtCount(w1.sessions),               bad: false },
                  { label: "Score",      value: `${data.worstScore}/100`,             bad: data.worstScore < 50 },
                  { label: "Error Rate", value: fmtPct(w1.errorRate),                bad: w1.errorRate > 2 },
                  { label: "Avg Load",   value: `${Math.round(w1.avgDurationMs)}ms`, bad: true },
                  ...(w1.lcp  != null ? [{ label: "LCP",  value: `${Math.round(w1.lcp)}ms`,  bad: w1.lcp  > 2500 }] : []),
                  ...(w1.inp  != null ? [{ label: "INP",  value: `${Math.round(w1.inp)}ms`,  bad: w1.inp  > 200  }] : []),
                  ...(w1.cls  != null ? [{ label: "CLS",  value: w1.cls.toFixed(3),           bad: w1.cls  > 0.1  }] : []),
                  ...(w1.ttfb != null ? [{ label: "TTFB", value: `${Math.round(w1.ttfb)}ms`, bad: w1.ttfb > 800  }] : []),
                ] as { label: string; value: string; bad: boolean }[]).map((row, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                    <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: row.bad ? TL_HOT_WARM : "#c0c0c0" }}>{row.value}</span>
                  </div>
                ))}
              </div>
              {/* W2 */}
              <div style={{ background: "rgba(255,143,171,0.05)", border: "1px solid rgba(255,143,171,0.25)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#FF8FAB", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>🔥 Worst #2 — Bucket {data.worst2Idx + 1}</div>
                <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.worst2BucketKey}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: hotColor(data.worst2HotZ), marginBottom: 6 }}>Z = {data.worst2HotZ.toFixed(2)}</div>
                {([
                  { label: "Sessions",   value: fmtCount(w2.sessions),               bad: false },
                  { label: "Score",      value: `${data.worst2Score}/100`,            bad: data.worst2Score < 50 },
                  { label: "Error Rate", value: fmtPct(w2.errorRate),                bad: w2.errorRate > 2 },
                  { label: "Avg Load",   value: `${Math.round(w2.avgDurationMs)}ms`, bad: true },
                  ...(w2.lcp  != null ? [{ label: "LCP",  value: `${Math.round(w2.lcp)}ms`,  bad: w2.lcp  > 2500 }] : []),
                  ...(w2.inp  != null ? [{ label: "INP",  value: `${Math.round(w2.inp)}ms`,  bad: w2.inp  > 200  }] : []),
                  ...(w2.cls  != null ? [{ label: "CLS",  value: w2.cls.toFixed(3),           bad: w2.cls  > 0.1  }] : []),
                  ...(w2.ttfb != null ? [{ label: "TTFB", value: `${Math.round(w2.ttfb)}ms`, bad: w2.ttfb > 800  }] : []),
                ] as { label: string; value: string; bad: boolean }[]).map((row, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                    <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: row.bad ? "#FF8FAB" : "#c0c0c0" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${tableDelay + 300}ms` }}>
              <div style={{ background: "rgba(128,128,128,0.03)", border: "1px solid rgba(128,128,128,0.12)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
                  {["Metric", `W1 (bkt ${data.worstIdx + 1})`, `W2 (bkt ${data.worst2Idx + 1})`, "Pattern"].map((h, i) => (
                    <div key={i} style={{ padding: "5px 10px", fontSize: 9, fontWeight: 700, opacity: 0.45, textTransform: "uppercase", letterSpacing: 0.5, background: "rgba(128,128,128,0.06)", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>{h}</div>
                  ))}
                  {compRows.map((row, i, arr) => (
                    <React.Fragment key={i}>
                      <div style={{ padding: "4px 10px", fontSize: 11, opacity: 0.75, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHot ? "rgba(255,7,58,0.04)" : "none" }}>{row.label}</div>
                      <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: TL_HOT_WARM, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHot ? "rgba(255,7,58,0.04)" : "none" }}>{row.v1}</div>
                      <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#FF8FAB", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHot ? "rgba(255,7,58,0.04)" : "none" }}>{row.v2}</div>
                      <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, color: row.bothHot ? "#FF832B" : "#888", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHot ? "rgba(255,7,58,0.04)" : "none" }}>{row.bothHot ? "Both hot" : "—"}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </>);
        })()}

        {/* Pair 3: B1 vs B2 + Common Good Signals */}
        {data.best2Idx !== data.bestIdx && (() => {
          type CompRow = { label: string; v1: string; v2: string; bothHealthy: boolean };
          const b1 = data.bestRow, b2 = data.best2Row;
          const compRows: CompRow[] = [
            { label: "Error Rate", v1: fmtPct(b1.errorRate),               v2: fmtPct(b2.errorRate),               bothHealthy: b1.errorRate < 1  && b2.errorRate < 1  },
            { label: "Avg Load",   v1: `${Math.round(b1.avgDurationMs)}ms`, v2: `${Math.round(b2.avgDurationMs)}ms`, bothHealthy: b1.avgDurationMs < 3000 && b2.avgDurationMs < 3000 },
            ...(b1.lcp  != null && b2.lcp  != null ? [{ label: "LCP",  v1: `${Math.round(b1.lcp)}ms`,  v2: `${Math.round(b2.lcp)}ms`,  bothHealthy: b1.lcp  <= 2500 && b2.lcp  <= 2500 }] : []),
            ...(b1.inp  != null && b2.inp  != null ? [{ label: "INP",  v1: `${Math.round(b1.inp)}ms`,  v2: `${Math.round(b2.inp)}ms`,  bothHealthy: b1.inp  <= 200  && b2.inp  <= 200  }] : []),
            ...(b1.cls  != null && b2.cls  != null ? [{ label: "CLS",  v1: b1.cls.toFixed(3),           v2: b2.cls.toFixed(3),           bothHealthy: b1.cls  <= 0.1  && b2.cls  <= 0.1  }] : []),
            ...(b1.ttfb != null && b2.ttfb != null ? [{ label: "TTFB", v1: `${Math.round(b1.ttfb)}ms`, v2: `${Math.round(b2.ttfb)}ms`, bothHealthy: b1.ttfb <= 800  && b2.ttfb <= 800  }] : []),
          ];
          return (<>
            <div className="uj-ai-section-title" style={{ marginBottom: 6, opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${tableDelay + 250}ms` }}>Common Good Signals — Best #1 vs Best #2</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${tableDelay + 400}ms` }}>
              {/* B1 */}
              <div style={{ background: "rgba(13,156,41,0.04)", border: "1px solid rgba(13,156,41,0.2)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: GREEN, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>✨ Best #1 — Bucket {data.bestIdx + 1}</div>
                <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.bestBucketKey}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: GREEN, marginBottom: 6 }}>Z = {(data.allHotness[data.bestIdx] ?? 0).toFixed(2)}</div>
                {([
                  { label: "Sessions",   value: fmtCount(b1.sessions),               good: false },
                  { label: "Score",      value: `${data.bestScore}/100`,              good: data.bestScore >= 70 },
                  { label: "Error Rate", value: fmtPct(b1.errorRate),                good: b1.errorRate < 1 },
                  { label: "Avg Load",   value: `${Math.round(b1.avgDurationMs)}ms`, good: true },
                  ...(b1.lcp  != null ? [{ label: "LCP",  value: `${Math.round(b1.lcp)}ms`,  good: b1.lcp  <= 2500 }] : []),
                  ...(b1.inp  != null ? [{ label: "INP",  value: `${Math.round(b1.inp)}ms`,  good: b1.inp  <= 200  }] : []),
                  ...(b1.cls  != null ? [{ label: "CLS",  value: b1.cls.toFixed(3),           good: b1.cls  <= 0.1  }] : []),
                  ...(b1.ttfb != null ? [{ label: "TTFB", value: `${Math.round(b1.ttfb)}ms`, good: b1.ttfb <= 800  }] : []),
                ] as { label: string; value: string; good: boolean }[]).map((row, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                    <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: row.good ? GREEN : "#c0c0c0" }}>{row.value}</span>
                  </div>
                ))}
              </div>
              {/* B2 */}
              <div style={{ background: "rgba(110,231,160,0.04)", border: "1px solid rgba(110,231,160,0.2)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6EE7A0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>✨ Best #2 — Bucket {data.best2Idx + 1}</div>
                <div style={{ fontSize: 9, opacity: 0.4, fontFamily: "monospace", marginBottom: 5 }}>{data.best2BucketKey}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6EE7A0", marginBottom: 6 }}>Z = {(data.allHotness[data.best2Idx] ?? 0).toFixed(2)}</div>
                {([
                  { label: "Sessions",   value: fmtCount(b2.sessions),               good: false },
                  { label: "Score",      value: `${data.best2Score}/100`,             good: data.best2Score >= 70 },
                  { label: "Error Rate", value: fmtPct(b2.errorRate),                good: b2.errorRate < 1 },
                  { label: "Avg Load",   value: `${Math.round(b2.avgDurationMs)}ms`, good: true },
                  ...(b2.lcp  != null ? [{ label: "LCP",  value: `${Math.round(b2.lcp)}ms`,  good: b2.lcp  <= 2500 }] : []),
                  ...(b2.inp  != null ? [{ label: "INP",  value: `${Math.round(b2.inp)}ms`,  good: b2.inp  <= 200  }] : []),
                  ...(b2.cls  != null ? [{ label: "CLS",  value: b2.cls.toFixed(3),           good: b2.cls  <= 0.1  }] : []),
                  ...(b2.ttfb != null ? [{ label: "TTFB", value: `${Math.round(b2.ttfb)}ms`, good: b2.ttfb <= 800  }] : []),
                ] as { label: string; value: string; good: boolean }[]).map((row, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid rgba(128,128,128,0.08)" }}>
                    <span style={{ opacity: 0.55, fontSize: 11 }}>{row.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: row.good ? "#6EE7A0" : "#c0c0c0" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${tableDelay + 500}ms` }}>
              <div style={{ background: "rgba(128,128,128,0.03)", border: "1px solid rgba(128,128,128,0.12)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr" }}>
                  {["Metric", `B1 (bkt ${data.bestIdx + 1})`, `B2 (bkt ${data.best2Idx + 1})`, "Pattern"].map((h, i) => (
                    <div key={i} style={{ padding: "5px 10px", fontSize: 9, fontWeight: 700, opacity: 0.45, textTransform: "uppercase", letterSpacing: 0.5, background: "rgba(128,128,128,0.06)", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>{h}</div>
                  ))}
                  {compRows.map((row, i, arr) => (
                    <React.Fragment key={i}>
                      <div style={{ padding: "4px 10px", fontSize: 11, opacity: 0.75, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHealthy ? "rgba(13,156,41,0.04)" : "none" }}>{row.label}</div>
                      <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: GREEN, borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHealthy ? "rgba(13,156,41,0.04)" : "none" }}>{row.v1}</div>
                      <div style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#6EE7A0", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHealthy ? "rgba(13,156,41,0.04)" : "none" }}>{row.v2}</div>
                      <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, color: row.bothHealthy ? GREEN : "#888", borderBottom: i < arr.length - 1 ? "1px solid rgba(128,128,128,0.07)" : "none", background: row.bothHealthy ? "rgba(13,156,41,0.04)" : "none" }}>{row.bothHealthy ? "Both healthy" : "—"}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </>);
        })()}

        {/* CWV Budget Heatmap */}
        {(data.cwvBudget.lcp.good + data.cwvBudget.lcp.needs + data.cwvBudget.lcp.poor +
          data.cwvBudget.inp.good + data.cwvBudget.inp.needs + data.cwvBudget.inp.poor) > 0 && (
          <div style={{ marginBottom: 14, opacity: 0, animation: "uj-ai-typewriter 0.4s ease forwards", animationDelay: `${budgetDelay}ms` }}>
            <div className="uj-ai-section-title">CWV Budget — Full Period Distribution</div>
            <div style={{ background: "rgba(128,128,128,0.03)", border: "1px solid rgba(128,128,128,0.12)", borderRadius: 8, padding: "10px 12px" }}>
              {(["lcp", "inp", "cls", "ttfb"] as const).map(vital => {
                const b = data.cwvBudget[vital];
                const total = b.good + b.needs + b.poor;
                if (total === 0) return null;
                const goodPct  = Math.round(b.good  / total * 100);
                const needsPct = Math.round(b.needs / total * 100);
                const poorPct  = 100 - goodPct - needsPct;
                const label = { lcp: "LCP", inp: "INP", cls: "CLS", ttfb: "TTFB" }[vital];
                const threshold = { lcp: "≤2500ms", inp: "≤200ms", cls: "≤0.1", ttfb: "≤800ms" }[vital];
                return (
                  <div key={vital} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{label} <span style={{ fontSize: 9, opacity: 0.45 }}>Good {threshold}</span></span>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>{b.good}G · {b.needs}NI · {b.poor}P</span>
                    </div>
                    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1 }}>
                      {goodPct  > 0 && <div style={{ flex: goodPct,  background: GREEN,      opacity: 0.8 }} title={`${b.good} Good`} />}
                      {needsPct > 0 && <div style={{ flex: needsPct, background: TL_HOT_ELEV, opacity: 0.8 }} title={`${b.needs} Needs Improvement`} />}
                      {poorPct  > 0 && <div style={{ flex: poorPct,  background: TL_HOT_HIGH, opacity: 0.8 }} title={`${b.poor} Poor`} />}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 9, opacity: 0.4 }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: GREEN, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Good</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: TL_HOT_ELEV, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Needs Improvement</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: TL_HOT_HIGH, borderRadius: 1, verticalAlign: "middle", marginRight: 3 }} />Poor</span>
              </div>
            </div>
          </div>
        )}

        {/* Insights */}
        {data.insights.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${insightOffset - 200}ms` }}>Insights</div>
            {data.insights.map((ins, i) => {
              const myOffset = insightOffset;
              insightOffset += insightDurations[i] + 240;
              return (
                <div key={i} className={`uj-ai-insight-row ${ins.severity}`} style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${myOffset - 100}ms` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{ins.icon}</span>
                  <StreamText text={ins.text} baseDelay={myOffset} style={{ fontSize: 13 }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendations */}
        {data.recommendations.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${insightOffset}ms` }}>Recommendations</div>
            {data.recommendations.map((rec, i) => {
              const myOffset = insightOffset + 300 + i * 800;
              return (
                <div key={i} className="uj-ai-recommendation" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${myOffset}ms` }}>
                  <span className={`uj-ai-rec-badge ${rec.impact}`}>{rec.impact}</span>
                  <StreamText text={rec.text} baseDelay={myOffset + 100} style={{ fontSize: 13 }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Active Davis Problems */}
        {data.worstProblems && data.worstProblems.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="uj-ai-section-title">Active Davis Problems During Worst Window</div>
            <div style={{ background: "rgba(255,7,58,0.04)", border: "1px solid rgba(255,7,58,0.15)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              {data.worstProblems.map((p, i) => (
                <div key={i} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, padding: "2px 0", borderBottom: i < data.worstProblems!.length - 1 ? "1px solid rgba(128,128,128,0.08)" : "none" }}>
                  <span style={{ color: "#FF073A", fontSize: 10, flexShrink: 0 }}>◆</span>
                  {p.displayId && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#FF832B", flexShrink: 0 }}>{p.displayId}</span>}
                  <span style={{ opacity: 0.8 }}>{p.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 9, opacity: 0.3, lineHeight: 1.5 }}>
          Drag header to reposition · Z-scores computed from shared fleet KPI baselines · Composite score: error rate 25%, avg load 25%, LCP 22%, INP 18%, CLS 6%, TTFB 4%
        </div>
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={e => {
          e.stopPropagation();
          resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: panelW, startH: panelH };
        }}
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: "nwse-resize",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "3px",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
          <line x1="1" y1="9" x2="9" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="9" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
    </div>,
    document.body,
  );
}
