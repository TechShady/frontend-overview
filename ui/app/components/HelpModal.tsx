import React, { useState } from "react";
import { createPortal } from "react-dom";

interface HelpSection {
  id: string;
  icon: string;
  title: string;
  content: React.ReactNode;
}

const SECTION_STYLE: React.CSSProperties = { marginBottom: 28 };

const H3: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#7ab4ff", marginBottom: 8, marginTop: 0,
};

const P: React.CSSProperties = {
  fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.7, margin: "0 0 8px",
};

const UL: React.CSSProperties = {
  margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5, color: "rgba(255,255,255,0.75)", lineHeight: 1.7,
};

const CODE: React.CSSProperties = {
  background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.2)",
  borderRadius: 3, padding: "1px 5px", fontSize: 11.5, fontFamily: "monospace", color: "#a8d1ff",
};

const SECTIONS: HelpSection[] = [
  {
    id: "overview",
    icon: "📊",
    title: "What is Frontend Overview?",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          Frontend Overview compares and contrasts every RUM-instrumented web application in your Dynatrace tenant. Instead of investigating one app at a time, you see the entire fleet side by side — so the outliers are immediately obvious.
        </p>
        <p style={P}>
          Each tab answers a different question: <strong style={{ color: "#fff" }}>Executive Summary</strong> scores every app, <strong style={{ color: "#fff" }}>Performance Overview</strong> shows Core Web Vitals across the fleet, <strong style={{ color: "#fff" }}>Errors & Reliability</strong> ranks by failure rate, and so on. Use the web app filter in the header to scope any tab to a single application.
        </p>
        <p style={P}>
          Every KPI card also has a rich dropdown menu — click the metric label to open a heatmap, launch a forecast, see related metrics, or jump directly into Dynatrace for deeper investigation.
        </p>
      </div>
    ),
  },
  {
    id: "header",
    icon: "🎛️",
    title: "Header Controls",
    content: (
      <div style={SECTION_STYLE}>
        <p style={{ ...H3, marginTop: 0 }}>Web App Filter</p>
        <p style={P}>Type an app name to scope all tabs to that application. Leave blank for the full fleet-wide view. Multiple apps can be selected.</p>

        <p style={H3}>Timeframe</p>
        <p style={P}>Controls the data window for every query in the app. Options range from 2 hours to 90 days. The current timeframe drives KPI cards, heatmaps, sparklines, and forecasts.</p>

        <p style={H3}>Time-Lapse</p>
        <p style={P}>Replay activity bucket-by-bucket across the selected timeframe. Rank tables animate with movement indicators — green/red flicker when apps change position. Useful for spotting exactly when a ranking shift happened.</p>

        <p style={H3}>Metric-Stream</p>
        <p style={P}>Auto-refresh cadence for live monitoring. Set to 0 for manual refresh only; set to 300000 ms (5 min) for a hands-free incident watch view.</p>

        <p style={H3}>AI Assist</p>
        <p style={P}>Context-aware analysis for the active tab. Streams a summary, color-coded insights, and prioritized recommendations. Content adapts to whatever tab is currently open.</p>

        <p style={H3}>Settings (⚙️)</p>
        <p style={P}>Show/hide individual tabs, adjust performance budget thresholds, configure grade weights, set your industry for benchmark comparisons, and choose role presets that toggle multiple tabs at once.</p>
      </div>
    ),
  },
  {
    id: "kpi-cards",
    icon: "📋",
    title: "KPI Cards & Metric Dropdown",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          KPI cards appear across multiple tabs to show per-metric values for each web application. Each card shows the current value, a sparkline trend, and a color-coded status indicator. Click the metric label or the "⋯" button to open the metric dropdown.
        </p>

        <p style={H3}>Metric Dropdown Options</p>
        <ul style={UL}>
          <li><strong style={{ color: "#fff" }}>Open with…</strong> — launches the relevant Dynatrace app (Frontend, Sessions, Notebooks, Dashboards) with the metric pre-selected for deeper investigation</li>
          <li><strong style={{ color: "#fff" }}>Heatmap</strong> — opens a day-of-week × hour-of-day heatmap for this specific metric, showing when it runs worst across 7 days of history</li>
          <li><strong style={{ color: "#fff" }}>Forecast</strong> — projects this metric forward using 6 forecasting algorithms with confidence bands and a full deep-dive analysis</li>
          <li><strong style={{ color: "#fff" }}>Related Metrics</strong> — finds other metrics in the fleet that correlate with this one (Pearson correlation). Useful for identifying root causes and knock-on effects</li>
          <li><strong style={{ color: "#fff" }}>Dimension</strong> — breaks down the metric by geo, browser, OS, or user action. Shows pie charts for each dimension</li>
          <li><strong style={{ color: "#fff" }}>Baseline Compare</strong> — overlays the current period against the previous equivalent period to show regression or improvement</li>
          <li><strong style={{ color: "#fff" }}>Cost Impact</strong> — applies the cost model to estimate what this metric's degradation is costing in RUM event volume or infrastructure overhead</li>
          <li><strong style={{ color: "#fff" }}>Diagnose</strong> — runs a structured set of checks against this metric and surfaces CRITICAL / REVIEW / OK findings with recommended next steps</li>
        </ul>
      </div>
    ),
  },
  {
    id: "heatmap",
    icon: "🗓️",
    title: "KPI Heatmap (per metric)",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          The <strong style={{ color: "#fff" }}>Heatmap</strong> option on any KPI card opens a day-of-week × hour-of-day calendar scoped to that single metric. It answers "when does this metric run worst?" across 7 days of history.
        </p>
        <p style={P}>
          This is different from the fleet-level Hotness Calendar — each KPI heatmap shows one metric's own absolute values (in its native unit: ms, %, count) rather than an aggregated Z-score. The color scale is relative to that metric's own history.
        </p>
        <ul style={UL}>
          <li>Hover any cell to see the exact average value for that day × hour slot</li>
          <li>Best and worst hour / day are highlighted with a ring for quick identification</li>
          <li>Values are aggregated using hourly bins across all matching days in the 7-day window</li>
          <li>Empty cells (no data) appear as neutral — the metric simply had no events in that slot</li>
        </ul>
        <p style={P}>
          Supported metric types: Core Web Vitals (LCP, INP, CLS, TTFB), Error Rate, Session Duration, and action/session counts.
        </p>
      </div>
    ),
  },
  {
    id: "forecast",
    icon: "📈",
    title: "Forecast",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          The <strong style={{ color: "#fff" }}>Forecast</strong> option projects any KPI metric forward from the current baseline. Six algorithms are available — select the one that fits the metric's behavior pattern.
        </p>
        <ul style={UL}>
          <li><strong style={{ color: "#fff" }}>Linear</strong> — straight-line extrapolation. Best for steadily trending metrics.</li>
          <li><strong style={{ color: "#fff" }}>Holt-Winters</strong> — double exponential smoothing; tracks level and trend, adapts to acceleration/deceleration.</li>
          <li><strong style={{ color: "#fff" }}>Triple Exp</strong> — triple exponential smoothing with seasonality. Good for metrics with a repeating daily/weekly pattern.</li>
          <li><strong style={{ color: "#fff" }}>Prophet</strong> — piecewise trend with changepoint detection. Handles sudden shifts in baseline well.</li>
          <li><strong style={{ color: "#fff" }}>ARIMA</strong> — auto-regressive integrated moving average. Good general-purpose model for stationary time series.</li>
          <li><strong style={{ color: "#fff" }}>SARIMA</strong> — seasonal ARIMA. Best when the metric has strong, consistent seasonality.</li>
        </ul>
        <p style={P}>A confidence band (shaded area) is shown around the forecast — wider bands mean less certainty. The deep-dive analysis section below the chart shows:</p>
        <ul style={UL}>
          <li><strong style={{ color: "#fff" }}>ACT NOW / MONITOR / ON TRACK</strong> — urgency assessment based on breach timeline and rate of change</li>
          <li><strong style={{ color: "#fff" }}>Current Value, 7-Day Projection, Rate</strong> — key metrics at a glance</li>
          <li><strong style={{ color: "#fff" }}>Breach Timeline</strong> — how many days until the metric crosses its threshold (if trending bad)</li>
          <li><strong style={{ color: "#fff" }}>Business Impact</strong> — estimated user/session impact if the trend continues</li>
          <li><strong style={{ color: "#fff" }}>Recommended Next Steps</strong> — specific DQL queries you can copy and run to investigate</li>
          <li><strong style={{ color: "#fff" }}>📄 PDF export</strong> — download the forecast chart and analysis as a PDF for sharing</li>
        </ul>
      </div>
    ),
  },
  {
    id: "related-metrics",
    icon: "🔗",
    title: "Related Metrics",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>
          The <strong style={{ color: "#fff" }}>Related Metrics</strong> panel (also called Correlations) finds other metrics in the fleet that statistically correlate with the selected metric using Pearson correlation.
        </p>
        <p style={P}>
          This helps answer: "when LCP degrades, what else moves?" — whether that's error rate, session duration, or another web vital. High correlation can indicate a root cause or a downstream effect.
        </p>
        <ul style={UL}>
          <li>Filter by correlation strength: <strong style={{ color: "#fff" }}>30%</strong> (weak), <strong style={{ color: "#fff" }}>50%</strong> (moderate), <strong style={{ color: "#fff" }}>70%</strong> (strong)</li>
          <li>Each result shows a progress bar for strength, direction (positive = both move together, negative = inverse), and a plain-language narrative</li>
          <li>Results are ranked by correlation coefficient — strongest relationships first</li>
          <li>"How it works" legend explains the methodology and what to act on</li>
          <li><strong style={{ color: "#fff" }}>📄 PDF export</strong> — export the full correlation list for reporting</li>
        </ul>
      </div>
    ),
  },
  {
    id: "tabs",
    icon: "📑",
    title: "Tabs Reference",
    content: (
      <div style={SECTION_STYLE}>
        {[
          { name: "Executive Summary", desc: "Grades every web app on a 0–100 composite score (LCP, INP, CLS, TTFB, error rate, bounce rate). Trend lines show improvement or degradation over time. Use this as the top-level health dashboard for your fleet." },
          { name: "Performance Overview", desc: "Fleet-wide Core Web Vitals per app — LCP, INP, CLS, TTFB with color-coded pass/fail indicators. Rank apps by any metric. Best for CWV regression triage." },
          { name: "Opportunity Matrix", desc: "Scatter plot of every web app by traffic volume (x) vs composite score (y). The median crosshair divides four action quadrants: Fix First, Protect, Monitor, Maintain. Includes a ranked Fix First table and min/max session filter." },
          { name: "Errors & Reliability", desc: "Error rates, total error counts, and sessions-with-errors per web app. Also shows the top JavaScript errors across your fleet with affected session counts." },
          { name: "Session & Engagement", desc: "Bounce rate, session duration, session count, and page load events per web app. Reveals engagement quality alongside performance." },
          { name: "Navigation & Flows", desc: "Five sub-tabs for deep navigation analysis: Navigation Paths (force-directed graph of page transitions), Sankey (multi-format flow diagram with click-to-drill detail), Geo Heatmap (Apdex and sessions by country), Maps (interactive world choropleth + globe), and Session Replay (sessions ranked by impact score)." },
          { name: "Cost & Ranking", desc: "Creative cost model: assigns $ estimates per byte, request, and RUM event to rank web apps by estimated infrastructure cost. Adjust rate assumptions live." },
          { name: "Perf Budgets", desc: "Set custom thresholds for LCP, INP, CLS, TTFB, bytes/page, requests/page, and error rate. Each web app is graded pass/fail per metric." },
          { name: "Hyperlyzer", desc: "Multidimensional radial exploration of a single web app across OS, browser, geo, and user action dimensions. Requires a specific app to be selected in the header." },
          { name: "Action Backlog", desc: "Data-driven, cross-app list of recommended actions. Each item is generated by evaluating every app against CWV, error rate, and Apdex thresholds, then ranked by traffic × severity so you always know what to fix first." },
        ].map(t => (
          <div key={t.name} style={{ padding: "10px 12px", background: "rgba(128,128,128,0.05)", borderRadius: 6, border: "1px solid rgba(128,128,128,0.12)", marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#fff" }}>{t.name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>{t.desc}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "web-vitals",
    icon: "⚡",
    title: "Core Web Vitals Reference",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>Google's Core Web Vitals define user experience quality thresholds. Frontend Overview shows all four for every app.</p>

        <p style={H3}>LCP — Largest Contentful Paint</p>
        <p style={P}>How long it takes for the largest visible element to load. Measures perceived load speed.</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {[{ label: "Good", val: "≤ 2.5s", color: "#0D9C29" }, { label: "Needs Improvement", val: "2.5–4s", color: "#FFB800" }, { label: "Poor", val: "> 4s", color: "#E6001F" }].map(b => (
            <div key={b.label} style={{ padding: "4px 10px", borderRadius: 5, background: `${b.color}18`, border: `1px solid ${b.color}40`, fontSize: 12 }}>
              <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>
              <span style={{ color: "rgba(255,255,255,0.55)", marginLeft: 6 }}>{b.val}</span>
            </div>
          ))}
        </div>

        <p style={H3}>INP — Interaction to Next Paint</p>
        <p style={P}>Responsiveness to user interactions (clicks, taps, key presses). Replaced FID as the Core Web Vital for interactivity.</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {[{ label: "Good", val: "≤ 200ms", color: "#0D9C29" }, { label: "Needs Improvement", val: "200–500ms", color: "#FFB800" }, { label: "Poor", val: "> 500ms", color: "#E6001F" }].map(b => (
            <div key={b.label} style={{ padding: "4px 10px", borderRadius: 5, background: `${b.color}18`, border: `1px solid ${b.color}40`, fontSize: 12 }}>
              <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>
              <span style={{ color: "rgba(255,255,255,0.55)", marginLeft: 6 }}>{b.val}</span>
            </div>
          ))}
        </div>

        <p style={H3}>CLS — Cumulative Layout Shift</p>
        <p style={P}>Visual stability — how much content unexpectedly moves during page load. Lower is better; 0 = perfectly stable.</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {[{ label: "Good", val: "≤ 0.1", color: "#0D9C29" }, { label: "Needs Improvement", val: "0.1–0.25", color: "#FFB800" }, { label: "Poor", val: "> 0.25", color: "#E6001F" }].map(b => (
            <div key={b.label} style={{ padding: "4px 10px", borderRadius: 5, background: `${b.color}18`, border: `1px solid ${b.color}40`, fontSize: 12 }}>
              <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>
              <span style={{ color: "rgba(255,255,255,0.55)", marginLeft: 6 }}>{b.val}</span>
            </div>
          ))}
        </div>

        <p style={H3}>TTFB — Time to First Byte</p>
        <p style={P}>Server response time — how long before the first byte of a response arrives. Mostly reflects backend / CDN performance.</p>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {[{ label: "Good", val: "≤ 800ms", color: "#0D9C29" }, { label: "Needs Improvement", val: "800ms–1.8s", color: "#FFB800" }, { label: "Poor", val: "> 1.8s", color: "#E6001F" }].map(b => (
            <div key={b.label} style={{ padding: "4px 10px", borderRadius: 5, background: `${b.color}18`, border: `1px solid ${b.color}40`, fontSize: 12 }}>
              <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>
              <span style={{ color: "rgba(255,255,255,0.55)", marginLeft: 6 }}>{b.val}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "settings",
    icon: "⚙️",
    title: "Settings",
    content: (
      <div style={SECTION_STYLE}>
        <p style={P}>Settings are saved per-user in Dynatrace user state. Open Settings from the ⚙️ button in the header.</p>

        <p style={H3}>Role Presets</p>
        <p style={P}>Apply a preset to show only the tabs relevant to your role (Executive, Developer, SRE, Product, etc.). Presets are a starting point — you can still toggle individual tabs after applying one.</p>

        <p style={H3}>Tab Visibility</p>
        <p style={P}>Toggle individual tabs on/off. Hidden tabs do not load data, which speeds up initial load time when you only care about a subset of views.</p>

        <p style={H3}>Performance Budgets</p>
        <p style={P}>Custom thresholds for LCP, INP, CLS, TTFB, bytes/page, requests/page, and error rate. These drive the pass/fail badges in the Perf Budgets tab and inform the Action Backlog rankings.</p>

        <p style={H3}>Grade Weights</p>
        <p style={P}>Adjust how much each metric contributes to the 0–100 composite score in Executive Summary. If your team prioritizes error rate over visual stability, increase its weight accordingly.</p>

        <p style={H3}>Industry Benchmarks</p>
        <p style={P}>Select your industry to compare against sector-specific benchmarks rather than generic Google thresholds. Available for e-commerce, financial services, media, SaaS, and others.</p>
      </div>
    ),
  },
  {
    id: "tips",
    icon: "💡",
    title: "Pro Tips",
    content: (
      <div style={SECTION_STYLE}>
        <ul style={UL}>
          <li>Start with <strong style={{ color: "#fff" }}>Executive Summary</strong> to identify which apps need attention, then switch to <strong style={{ color: "#fff" }}>Performance Overview</strong> to see which metric is responsible</li>
          <li>Use the <strong style={{ color: "#fff" }}>Opportunity Matrix</strong> to prioritize — high-traffic apps in the "Fix First" quadrant have the highest impact per improvement</li>
          <li>Click any metric label on a KPI card to access <strong style={{ color: "#fff" }}>Heatmap</strong> and <strong style={{ color: "#fff" }}>Forecast</strong> — these are the fastest way to answer "is this getting worse?"</li>
          <li><strong style={{ color: "#fff" }}>Related Metrics</strong> at 70% strength is the fastest way to find correlated root causes — if LCP and TTFB correlate, the problem is server-side</li>
          <li>The <strong style={{ color: "#fff" }}>KPI Heatmap</strong> (day × hour) reveals whether a metric's worst performance is always at the same time — recurring patterns suggest scheduled jobs, batch imports, or known traffic peaks</li>
          <li>Use <strong style={{ color: "#fff" }}>Forecast → Prophet</strong> model when a metric has had a sudden baseline shift (e.g. after a deployment). Prophet handles changepoints better than linear extrapolation</li>
          <li>The <strong style={{ color: "#fff" }}>Forecast PDF</strong> is useful for weekly reviews — export one per critical app and share with the responsible team before the meeting</li>
          <li>The <strong style={{ color: "#fff" }}>Time-Lapse</strong> is best used on the Performance Overview tab — watch rank positions change and identify exactly which bucket caused a metric to shift</li>
          <li>Leaving the <strong style={{ color: "#fff" }}>Web App filter</strong> blank gives you the fleet-wide aggregate. Scoping to one app isolates its data in every tab simultaneously — no need to filter each tab individually</li>
          <li><strong style={{ color: "#fff" }}>Action Backlog</strong> ranks items by traffic × severity — this is the most objective way to decide what to fix first when multiple apps have issues</li>
          <li>The <strong style={{ color: "#fff" }}>Hyperlyzer</strong> tab requires a specific app to be selected. Use it for deep-dive dimensional analysis after Executive Summary or Performance Overview identifies an outlier</li>
          <li>The <strong style={{ color: "#fff" }}>AI Assist</strong> panel summarizes the active tab in plain language — useful for briefing a stakeholder who doesn't read charts</li>
        </ul>
      </div>
    ),
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState("overview");
  const section = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#0f1422", border: "1px solid rgba(69,137,255,0.25)", borderRadius: 14, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.85)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 28px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff" }}>📊 Frontend Overview — Help Guide</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Everything you need to get the most out of Frontend Overview</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href="https://github.com/TechShady/frontend-overview/raw/main/USER_GUIDE.docx"
              target="_blank"
              rel="noreferrer"
              title="Download User Guide as Word document"
              style={{ background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.3)", borderRadius: 8, color: "#7ab4ff", fontSize: 13, padding: "8px 14px", cursor: "pointer", textDecoration: "none", fontWeight: 600 }}
            >
              📄 User Guide
            </a>
            <button onClick={onClose} style={{ background: "rgba(128,128,128,0.15)", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 13, padding: "8px 16px", cursor: "pointer" }}>
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
          {/* Nav */}
          <div style={{ width: 210, borderRight: "1px solid rgba(255,255,255,0.06)", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, overflowY: "auto" }}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 6, border: "none",
                  background: activeSection === s.id ? "rgba(69,137,255,0.15)" : "transparent",
                  color: activeSection === s.id ? "#fff" : "rgba(255,255,255,0.55)",
                  fontSize: 12, fontWeight: activeSection === s.id ? 600 : 400,
                  cursor: "pointer", textAlign: "left", width: "100%",
                  outline: activeSection === s.id ? "1px solid rgba(69,137,255,0.3)" : "none",
                }}
              >
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ lineHeight: 1.3 }}>{s.title}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <span style={{ fontSize: 22 }}>{section.icon}</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>{section.title}</h3>
            </div>
            {section.content}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
