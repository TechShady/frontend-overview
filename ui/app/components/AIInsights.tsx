import React, { useMemo } from "react";
import { Text, Strong } from "@dynatrace/strato-components/typography";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type InsightSeverity = "good" | "warning" | "critical" | "info";
export type InsightItem = { severity: InsightSeverity; icon: string; text: string };
export type RecommendationItem = { impact: "high" | "medium" | "low"; text: string };
export type AIInsightsData = { summary: string; insights: InsightItem[]; recommendations: RecommendationItem[] };

// ---------------------------------------------------------------------------
// CSS injection (same pattern as TimelapseTable.tsx)
// ---------------------------------------------------------------------------
const STYLE_ID = "ai-insights-styles";
function ensureAIStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* AI Insights panel */
.uj-ai-panel {
  border: 1px solid rgba(165, 110, 255, 0.25);
  border-radius: 10px;
  background: rgba(165, 110, 255, 0.04);
  overflow: hidden;
  animation: uj-ai-slide-in 0.25s ease-out;
}
@keyframes uj-ai-slide-in {
  from { opacity: 0; max-height: 0; transform: translateY(-8px); }
  to   { opacity: 1; max-height: 2000px; transform: translateY(0); }
}
.uj-ai-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(165, 110, 255, 0.15);
}
.uj-ai-panel-header svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.uj-ai-panel-body {
  padding: 16px;
}
.uj-ai-section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  opacity: 0.5;
  margin-bottom: 8px;
}
.uj-ai-insight-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 6px 10px;
  border-radius: 6px;
  margin-bottom: 4px;
}
.uj-ai-insight-row.good {
  background: rgba(13, 156, 41, 0.06);
  border-left: 3px solid #0D9C29;
}
.uj-ai-insight-row.warning {
  background: rgba(255, 131, 43, 0.06);
  border-left: 3px solid #FF832B;
}
.uj-ai-insight-row.critical {
  background: rgba(194, 25, 48, 0.06);
  border-left: 3px solid #C21930;
}
.uj-ai-insight-row.info {
  background: rgba(69, 137, 255, 0.06);
  border-left: 3px solid #4589FF;
}
.uj-ai-recommendation {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.04);
  margin-bottom: 4px;
}
.uj-ai-rec-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}
.uj-ai-rec-badge.high {
  background: rgba(194, 25, 48, 0.12);
  color: #C21930;
}
.uj-ai-rec-badge.medium {
  background: rgba(255, 131, 43, 0.12);
  color: #FF832B;
}
.uj-ai-rec-badge.low {
  background: rgba(128, 128, 128, 0.1);
}

/* Typewriter streaming animation */
@keyframes uj-ai-typewriter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.uj-ai-stream-word {
  display: inline;
  opacity: 0;
  animation: uj-ai-typewriter 0.3s ease forwards;
}
`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// SparkleIcon — copied from UserJourney.tsx
// ---------------------------------------------------------------------------
function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Large sparkle (bottom-right) */}
      <path d="M14 4L15.2 9.6L20 12L15.2 14.4L14 20L12.8 14.4L8 12L12.8 9.6Z" fill="url(#sparkle-grad)" />
      {/* Medium sparkle (top-left) */}
      <path d="M7 2L7.7 4.8L10 6L7.7 7.2L7 10L6.3 7.2L4 6L6.3 4.8Z" fill="url(#sparkle-grad)" />
      {/* Small sparkle (left-middle) */}
      <path d="M5 13L5.5 14.8L7 16L5.5 17.2L5 19L4.5 17.2L3 16L4.5 14.8Z" fill="url(#sparkle-grad)" />
      <defs>
        <linearGradient id="sparkle-grad" x1="3" y1="2" x2="20" y2="20">
          <stop stopColor="#c084fc" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StreamText — word-by-word streaming animation, copied from UserJourney.tsx
// ---------------------------------------------------------------------------
function StreamText({ text, baseDelay, style }: { text: string; baseDelay: number; style?: React.CSSProperties }) {
  const words = text.split(/(\s+)/);
  let wordIndex = 0;
  return (
    <Text style={style}>
      {words.map((w, i) => {
        if (/^\s+$/.test(w)) return w;
        const delay = baseDelay + wordIndex * 60;
        wordIndex++;
        return <span key={i} className="uj-ai-stream-word" style={{ animationDelay: `${delay}ms` }}>{w}</span>;
      })}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// AIInsightsPanel — copied from UserJourney.tsx
// ---------------------------------------------------------------------------
function AIInsightsPanel({ data, onClose }: { data: AIInsightsData; onClose: () => void }) {
  ensureAIStyles();
  // Calculate cumulative word offsets so each section streams after the previous
  const summaryWords = data.summary.split(/\s+/).length;
  const summaryDuration = summaryWords * 60;
  let insightOffset = summaryDuration + 400;
  const insightDurations: number[] = data.insights.map(ins => {
    const d = ins.text.split(/\s+/).length * 60;
    return d;
  });

  return (
    <div className="uj-ai-panel">
      <div className="uj-ai-panel-header">
        <SparkleIcon />
        <Strong style={{ flex: 1 }}>AI Insights</Strong>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16, opacity: 0.5, padding: "2px 6px" }}>✕</button>
      </div>
      <div className="uj-ai-panel-body">
        {/* Summary */}
        <div style={{ marginBottom: 16 }}>
          <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: "100ms" }}>Summary</div>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(165,110,255,0.06)", border: "1px solid rgba(165,110,255,0.12)" }}>
            <StreamText text={data.summary} baseDelay={200} style={{ fontSize: 13, lineHeight: "1.5" }} />
          </div>
        </div>

        {/* Insights */}
        {data.insights.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="uj-ai-section-title" style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${insightOffset - 200}ms` }}>Insights</div>
            {data.insights.map((ins, i) => {
              const myOffset = insightOffset;
              insightOffset += insightDurations[i] + 240;
              return (
                <div key={i} className={`uj-ai-insight-row ${ins.severity}`} style={{ opacity: 0, animation: "uj-ai-typewriter 0.3s ease forwards", animationDelay: `${myOffset - 100}ms` }}>
                  <Text style={{ fontSize: 14, flexShrink: 0 }}>{ins.icon}</Text>
                  <StreamText text={ins.text} baseDelay={myOffset} style={{ fontSize: 13 }} />
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendations */}
        {data.recommendations.length > 0 && (
          <div>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context — simplified from UserJourney.tsx (no activeSubTab)
// ---------------------------------------------------------------------------
export const AIInsightsContext = React.createContext<{ open: boolean; close: () => void }>({
  open: false,
  close: () => {},
});

// ---------------------------------------------------------------------------
// useAIInsightsOpen — helper hook for managing open state outside the context
// ---------------------------------------------------------------------------
export function useAIInsightsOpen(): { open: boolean; toggle: () => void; close: () => void } {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((v) => !v), []);
  const close = React.useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

// ---------------------------------------------------------------------------
// useAIInsights — simplified from UserJourney.tsx (no subTabKey / industry)
// ---------------------------------------------------------------------------
export function useAIInsights(analysisFn: () => AIInsightsData): { panel: React.ReactNode } {
  const { open, close } = React.useContext(AIInsightsContext);
  const data = useMemo(() => (open ? analysisFn() : null), [open, analysisFn]);
  return {
    panel: open && data ? (
      <div style={{ padding: "16px 20px" }}>
        <AIInsightsPanel data={data} onClose={close} />
      </div>
    ) : null,
  };
}

// ---------------------------------------------------------------------------
// Per-tab analysis functions
// ---------------------------------------------------------------------------

export function analyzeExecutiveSummary(
  rows: Array<{ application: string; score: number; grade: string }>,
  trend?: string,
): AIInsightsData {
  const count = rows.length;
  if (count === 0) {
    return {
      summary: "No application data is available for analysis. Ensure your web applications are properly instrumented with Dynatrace RUM.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No applications detected. Verify RUM instrumentation is deployed." }],
      recommendations: [{ impact: "high", text: "Check that the Dynatrace OneAgent or RUM JavaScript tag is deployed on your web applications." }],
    };
  }

  const validScores = rows.filter((r) => isFinite(r.score));
  const avgScore = validScores.length > 0 ? validScores.reduce((a, r) => a + r.score, 0) / validScores.length : 0;
  const excellent = rows.filter((r) => r.score >= 90).length;
  const good = rows.filter((r) => r.score >= 75 && r.score < 90).length;
  const poor = rows.filter((r) => r.score < 60).length;
  const worst = rows.slice().sort((a, b) => a.score - b.score)[0];
  const best = rows.slice().sort((a, b) => b.score - a.score)[0];

  const summaryStatus = avgScore >= 85 ? "healthy" : avgScore >= 70 ? "moderate" : "needing attention";
  const summary = `Your fleet of ${count} application${count === 1 ? "" : "s"} has an average composite score of ${avgScore.toFixed(0)}/100, indicating ${summaryStatus} overall performance. ${excellent} app${excellent === 1 ? "" : "s"} score excellent (≥90) and ${poor} score${poor === 1 ? "s" : ""} below 60${trend ? `, with a ${trend} trend` : ""}.`;

  const insights: InsightItem[] = [];
  if (excellent > 0) insights.push({ severity: "good", icon: "🏆", text: `${excellent} application${excellent === 1 ? "" : "s"} achieved an excellent score (≥90/100), indicating strong Core Web Vitals and reliability.` });
  if (poor > 0) insights.push({ severity: "critical", icon: "🚨", text: `${poor} application${poor === 1 ? "" : "s"} score${poor === 1 ? "s" : ""} below 60/100 — these need immediate attention to avoid user churn.` });
  if (good > 0) insights.push({ severity: "info", icon: "📊", text: `${good} application${good === 1 ? "" : "s"} score${good === 1 ? "s" : ""} in the good range (75–89), with room for targeted improvement.` });
  if (worst && isFinite(worst.score)) insights.push({ severity: worst.score < 60 ? "critical" : "warning", icon: "⚠️", text: `Lowest performer: ${worst.application} with a score of ${worst.score.toFixed(0)}/100 (grade ${worst.grade}).` });
  if (best && isFinite(best.score) && best.application !== worst?.application) insights.push({ severity: "good", icon: "✅", text: `Top performer: ${best.application} with a score of ${best.score.toFixed(0)}/100 (grade ${best.grade}).` });

  const recommendations: RecommendationItem[] = [];
  if (poor > 0) recommendations.push({ impact: "high", text: `Prioritize improvements to the ${poor} application${poor === 1 ? "" : "s"} scoring below 60. Focus on LCP, INP, and error rates as the highest-weighted metrics.` });
  recommendations.push({ impact: "medium", text: `Review Core Web Vitals for all applications — LCP >2.5s, INP >200ms, and CLS >0.1 are the most impactful score drivers.` });
  if (count > 3) recommendations.push({ impact: "low", text: `Use the Performance Overview tab to drill into specific Web Vital failures and identify common patterns across your fleet.` });

  return { summary, insights, recommendations };
}

export function analyzePerformanceOverview(
  rows: Array<{ application: string; lcp: number; inp: number; cls: number; apdex: number }>,
  totalSessions: number,
): AIInsightsData {
  const count = rows.length;
  if (count === 0) {
    return {
      summary: "No performance data is available. Ensure Core Web Vitals collection is enabled in your RUM configuration.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No Web Vitals data found. Check RUM configuration for Core Web Vitals collection." }],
      recommendations: [{ impact: "high", text: "Enable Core Web Vitals reporting in your Dynatrace RUM settings to start tracking LCP, INP, and CLS." }],
    };
  }

  const withLcp = rows.filter((r) => isFinite(r.lcp) && r.lcp > 0);
  const withInp = rows.filter((r) => isFinite(r.inp) && r.inp > 0);
  const withApdex = rows.filter((r) => isFinite(r.apdex));
  const avgLcp = withLcp.length > 0 ? withLcp.reduce((a, r) => a + r.lcp, 0) / withLcp.length : NaN;
  const avgInp = withInp.length > 0 ? withInp.reduce((a, r) => a + r.inp, 0) / withInp.length : NaN;
  const lcpPass = withLcp.filter((r) => r.lcp <= 2500).length;
  const avgApdex = withApdex.length > 0 ? withApdex.reduce((a, r) => a + r.apdex, 0) / withApdex.length : NaN;

  const lcpStatus = !isFinite(avgLcp) ? "unknown" : avgLcp <= 2500 ? "good" : avgLcp <= 4000 ? "needs improvement" : "poor";
  const summary = `Analyzing performance for ${count} application${count === 1 ? "" : "s"} covering ${totalSessions.toLocaleString()} sessions. Average LCP is ${isFinite(avgLcp) ? Math.round(avgLcp) + "ms" : "unavailable"} (${lcpStatus}) and average Apdex is ${isFinite(avgApdex) ? avgApdex.toFixed(2) : "unavailable"}. ${lcpPass} of ${withLcp.length} app${withLcp.length === 1 ? "" : "s"} pass the LCP ≤2500ms threshold.`;

  const insights: InsightItem[] = [];
  if (isFinite(avgLcp)) {
    if (avgLcp <= 2500) insights.push({ severity: "good", icon: "✅", text: `Fleet average LCP of ${Math.round(avgLcp)}ms meets the Google "Good" threshold of ≤2500ms.` });
    else if (avgLcp <= 4000) insights.push({ severity: "warning", icon: "⚠️", text: `Fleet average LCP of ${Math.round(avgLcp)}ms is in the "Needs Improvement" range (2500–4000ms) — users notice the delay.` });
    else insights.push({ severity: "critical", icon: "🚨", text: `Fleet average LCP of ${Math.round(avgLcp)}ms is "Poor" — above 4000ms, significantly impacting first impressions.` });
  }
  if (isFinite(avgInp)) {
    if (avgInp <= 200) insights.push({ severity: "good", icon: "✅", text: `Average INP of ${Math.round(avgInp)}ms meets the ≤200ms "Good" threshold for interaction responsiveness.` });
    else if (avgInp <= 500) insights.push({ severity: "warning", icon: "⚠️", text: `Average INP of ${Math.round(avgInp)}ms exceeds the 200ms threshold — interactions feel sluggish to users.` });
    else insights.push({ severity: "critical", icon: "🚨", text: `Average INP of ${Math.round(avgInp)}ms is "Poor" — above 500ms, indicating severely delayed interaction responses.` });
  }
  if (isFinite(avgApdex)) {
    const sev: InsightSeverity = avgApdex >= 0.85 ? "good" : avgApdex >= 0.7 ? "warning" : "critical";
    insights.push({ severity: sev, icon: sev === "good" ? "😊" : sev === "warning" ? "😐" : "😞", text: `Fleet average Apdex of ${avgApdex.toFixed(2)} — ${avgApdex >= 0.94 ? "Excellent" : avgApdex >= 0.85 ? "Good" : avgApdex >= 0.7 ? "Fair" : "Poor"} user satisfaction overall.` });
  }
  if (withLcp.length > 0 && lcpPass < withLcp.length) {
    insights.push({ severity: "warning", icon: "📉", text: `${withLcp.length - lcpPass} of ${withLcp.length} app${withLcp.length === 1 ? "" : "s"} fail the LCP ≤2500ms target — these represent the biggest user impact gains.` });
  }

  const recommendations: RecommendationItem[] = [];
  if (isFinite(avgLcp) && avgLcp > 2500) recommendations.push({ impact: "high", text: `Optimize LCP by preloading hero images, minimizing render-blocking resources, and using a CDN to serve static assets closer to users.` });
  if (isFinite(avgInp) && avgInp > 200) recommendations.push({ impact: "high", text: `Improve INP by deferring non-critical JavaScript, breaking up long tasks, and using web workers for heavy computations.` });
  recommendations.push({ impact: "medium", text: `Use Dynatrace session replay to identify the specific user interactions contributing to poor Core Web Vitals scores.` });

  return { summary, insights, recommendations };
}

export function analyzeErrors(
  rows: Array<{ application: string; errorRate: number; totalErrors: number }>,
  totalErrors: number,
): AIInsightsData {
  const count = rows.length;
  if (count === 0) {
    return {
      summary: "No error data is available for analysis.",
      insights: [{ severity: "good", icon: "✅", text: "No error data found — either no errors occurred or RUM error tracking is not configured." }],
      recommendations: [{ impact: "low", text: "Verify error tracking is enabled in your RUM configuration to detect JavaScript exceptions." }],
    };
  }

  const avgRate = rows.reduce((a, r) => a + (isFinite(r.errorRate) ? r.errorRate : 0), 0) / count;
  const criticalApps = rows.filter((r) => r.errorRate > 5).length;
  const warningApps = rows.filter((r) => r.errorRate > 1 && r.errorRate <= 5).length;
  const healthyApps = rows.filter((r) => r.errorRate <= 1).length;
  const worst = rows.slice().sort((a, b) => b.errorRate - a.errorRate)[0];

  const statusDesc = avgRate < 1 ? "healthy" : avgRate < 5 ? "elevated" : "critical";
  const summary = `Fleet error analysis across ${count} application${count === 1 ? "" : "s"} shows an average error rate of ${avgRate.toFixed(2)}% with ${totalErrors.toLocaleString()} total errors — overall reliability is ${statusDesc}. ${healthyApps} app${healthyApps === 1 ? "" : "s"} maintain rates below 1% and ${criticalApps} exceed${criticalApps === 1 ? "s" : ""} the 5% critical threshold.`;

  const insights: InsightItem[] = [];
  if (healthyApps > 0) insights.push({ severity: "good", icon: "✅", text: `${healthyApps} application${healthyApps === 1 ? "" : "s"} maintain error rates below 1% — healthy reliability baseline.` });
  if (criticalApps > 0) insights.push({ severity: "critical", icon: "🚨", text: `${criticalApps} application${criticalApps === 1 ? "" : "s"} exceed${criticalApps === 1 ? "s" : ""} the 5% error rate threshold — users are experiencing significant failures.` });
  if (warningApps > 0) insights.push({ severity: "warning", icon: "⚠️", text: `${warningApps} application${warningApps === 1 ? "" : "s"} have elevated error rates (1–5%) that warrant investigation.` });
  if (worst && isFinite(worst.errorRate)) insights.push({ severity: worst.errorRate > 5 ? "critical" : "warning", icon: "🔴", text: `Highest error rate: ${worst.application} at ${worst.errorRate.toFixed(2)}% (${worst.totalErrors.toLocaleString()} errors total).` });
  insights.push({ severity: avgRate < 1 ? "good" : avgRate < 5 ? "warning" : "critical", icon: "📊", text: `Fleet-wide average error rate: ${avgRate.toFixed(2)}% across all monitored applications.` });

  const recommendations: RecommendationItem[] = [];
  if (criticalApps > 0) recommendations.push({ impact: "high", text: `Immediately investigate the ${criticalApps} application${criticalApps === 1 ? "" : "s"} with error rates above 5% — use the JS Errors section to identify the root cause.` });
  if (warningApps > 0) recommendations.push({ impact: "medium", text: `Review error patterns in the ${warningApps} application${warningApps === 1 ? "" : "s"} with 1–5% error rates. Prioritize errors impacting session completion.` });
  recommendations.push({ impact: "low", text: `Set up Dynatrace problem detection alerts for error rate spikes to catch regressions before they impact many users.` });

  return { summary, insights, recommendations };
}

export function analyzeNavigation(
  totalSessions: number,
  uniquePages: number,
  transitions: number,
): AIInsightsData {
  const pagesPerSession = totalSessions > 0 ? transitions / totalSessions : 0;
  const summary = `Navigation analysis covers ${totalSessions.toLocaleString()} session${totalSessions === 1 ? "" : "s"} traversing ${uniquePages} unique page${uniquePages === 1 ? "" : "s"} with ${transitions.toLocaleString()} total page transitions. Users navigate an average of ${pagesPerSession.toFixed(1)} pages per session.`;

  const insights: InsightItem[] = [];
  if (pagesPerSession < 1.5 && totalSessions > 0) {
    insights.push({ severity: "warning", icon: "⚠️", text: `Low pages-per-session ratio of ${pagesPerSession.toFixed(1)} suggests users may be bouncing early or not discovering relevant content.` });
  } else if (pagesPerSession >= 3) {
    insights.push({ severity: "good", icon: "✅", text: `High engagement: users visit ${pagesPerSession.toFixed(1)} pages per session on average, indicating strong content discovery.` });
  } else if (totalSessions > 0) {
    insights.push({ severity: "info", icon: "📄", text: `Average of ${pagesPerSession.toFixed(1)} pages per session is moderate — there may be opportunities to increase content depth.` });
  }
  if (uniquePages > 50) {
    insights.push({ severity: "info", icon: "🗺️", text: `Large site with ${uniquePages} unique pages — use the Sankey diagram to identify primary user journeys and optimize key paths.` });
  } else if (uniquePages > 0 && uniquePages <= 10) {
    insights.push({ severity: "info", icon: "📱", text: `Compact app with ${uniquePages} unique pages — focus on optimizing the critical path for key user goals.` });
  }
  insights.push({ severity: "info", icon: "🔀", text: `${transitions.toLocaleString()} page transitions recorded — the Navigation Paths graph shows the most frequent routes through your app.` });

  const recommendations: RecommendationItem[] = [];
  if (pagesPerSession < 2 && totalSessions > 0) {
    recommendations.push({ impact: "medium", text: `Improve internal linking and content recommendations to encourage users to explore beyond the entry page.` });
  }
  recommendations.push({ impact: "medium", text: `Use the Sankey diagram to identify exit pages where users abandon their journey and optimize those pages to retain engagement.` });
  recommendations.push({ impact: "low", text: `Analyze the top navigation paths to ensure your primary conversion flows are frictionless and well-optimized for speed.` });

  return { summary, insights, recommendations };
}

export function analyzeCostRanking(
  rows: Array<{ application: string; totalCost: number }>,
  totalCost: number,
): AIInsightsData {
  const count = rows.length;
  if (count === 0) {
    return {
      summary: "No cost data available for analysis. Ensure resource consumption data is being collected.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No resource data found. RUM resource timing tracking may not be enabled." }],
      recommendations: [{ impact: "medium", text: "Enable resource timing collection in your Dynatrace RUM configuration to track bandwidth and request costs." }],
    };
  }

  const sorted = rows.slice().sort((a, b) => b.totalCost - a.totalCost);
  const topApp = sorted[0];
  const topPct = totalCost > 0 ? (topApp.totalCost / totalCost) * 100 : 0;
  const avgCost = totalCost / count;

  const summary = `Cost analysis across ${count} application${count === 1 ? "" : "s"} shows an estimated total of $${totalCost.toFixed(2)} in infrastructure costs. The most expensive application is ${topApp?.application || "unknown"}, accounting for ${topPct.toFixed(0)}% of total costs. Average cost per application is $${avgCost.toFixed(2)}.`;

  const insights: InsightItem[] = [];
  if (topPct > 50 && count > 1) {
    insights.push({ severity: "warning", icon: "💸", text: `${topApp.application} accounts for ${topPct.toFixed(0)}% of total estimated costs — disproportionate resource consumption warrants investigation.` });
  } else if (topPct > 30 && count > 1) {
    insights.push({ severity: "info", icon: "💡", text: `${topApp.application} is the top cost driver at ${topPct.toFixed(0)}% of total spend — review its resource usage patterns.` });
  }
  if (count > 1) {
    const bottomApp = sorted[sorted.length - 1];
    const ratio = topApp.totalCost > 0 && bottomApp.totalCost > 0 ? topApp.totalCost / bottomApp.totalCost : 0;
    if (ratio > 10) {
      insights.push({ severity: "warning", icon: "📊", text: `${ratio.toFixed(0)}x cost difference between the most and least expensive apps — a significant optimization opportunity exists.` });
    }
  }
  insights.push({ severity: "info", icon: "💰", text: `Estimated total infrastructure cost: $${totalCost.toFixed(2)} across all monitored web applications.` });
  insights.push({ severity: "info", icon: "📈", text: `Cost model factors in bandwidth egress, HTTP requests, and RUM event volume — adjust rate assumptions in the controls above the table.` });

  const recommendations: RecommendationItem[] = [];
  if (topPct > 40 && count > 1) recommendations.push({ impact: "high", text: `Audit ${topApp.application} for oversized assets, excessive third-party requests, and unoptimized images to reduce its outsized cost share.` });
  recommendations.push({ impact: "medium", text: `Implement browser caching, CDN, and resource compression across all applications to reduce bandwidth costs fleet-wide.` });
  recommendations.push({ impact: "low", text: `Review and remove unused third-party scripts that inflate request counts without adding user value.` });

  return { summary, insights, recommendations };
}

export function analyzePerfBudgets(
  rows: Array<{ application: string; passed: number; total: number; score: number }>,
  totalApps: number,
): AIInsightsData {
  const count = rows.length;
  if (count === 0) {
    return {
      summary: "No performance budget data available for analysis.",
      insights: [{ severity: "info", icon: "ℹ️", text: "No apps have performance budget data. Ensure vitals and resource data is available." }],
      recommendations: [{ impact: "medium", text: "Configure performance budget thresholds in Settings to start tracking compliance." }],
    };
  }

  const allPassed = rows.filter((r) => r.passed === r.total && r.total > 0).length;
  const allFailed = rows.filter((r) => r.passed === 0 && r.total > 0).length;
  const validScore = rows.filter((r) => isFinite(r.score));
  const avgScore = validScore.length > 0 ? validScore.reduce((a, r) => a + r.score, 0) / validScore.length : NaN;
  const worst = rows.slice().sort((a, b) => (isFinite(a.score) ? a.score : 100) - (isFinite(b.score) ? b.score : 100))[0];
  const totalChecks = rows.reduce((a, r) => a + r.total, 0);
  const totalPassed = rows.reduce((a, r) => a + r.passed, 0);
  const overallPct = totalChecks > 0 ? (totalPassed / totalChecks) * 100 : 0;

  const summary = `Performance budget compliance across ${count} application${count === 1 ? "" : "s"}: ${totalPassed} of ${totalChecks} budget checks passed (${overallPct.toFixed(0)}% compliance rate). ${allPassed} app${allPassed === 1 ? "" : "s"} pass all budgets and ${allFailed} fail all budgets. Average compliance score: ${isFinite(avgScore) ? avgScore.toFixed(0) : "N/A"}%.`;

  const insights: InsightItem[] = [];
  if (allPassed > 0) insights.push({ severity: "good", icon: "✅", text: `${allPassed} application${allPassed === 1 ? "" : "s"} pass all performance budget checks — excellent compliance.` });
  if (allFailed > 0) insights.push({ severity: "critical", icon: "🚨", text: `${allFailed} application${allFailed === 1 ? "" : "s"} fail every budget check — these need immediate performance work.` });
  if (worst && isFinite(worst.score)) {
    insights.push({ severity: worst.score < 50 ? "critical" : "warning", icon: "⚠️", text: `Worst compliance: ${worst.application} passes only ${worst.passed} of ${worst.total} budget checks (${worst.score.toFixed(0)}% score).` });
  }
  insights.push({
    severity: overallPct >= 80 ? "good" : overallPct >= 50 ? "warning" : "critical",
    icon: "📊",
    text: `Overall fleet compliance: ${overallPct.toFixed(0)}% of all budget checks pass across ${count} monitored application${count === 1 ? "" : "s"}.`,
  });

  const recommendations: RecommendationItem[] = [];
  if (allFailed > 0 || (worst && worst.score < 50)) recommendations.push({ impact: "high", text: `Focus on the worst-performing applications first — addressing LCP, INP, and error rate budgets will have the highest user impact.` });
  recommendations.push({ impact: "medium", text: `Adjust budget thresholds in Settings if they are too strict for your current baseline — then set quarterly improvement goals.` });
  recommendations.push({ impact: "low", text: `Use Perf Budgets as a regression gate — integrate budget alerts into your deployment pipeline to catch regressions early.` });

  return { summary, insights, recommendations };
}
