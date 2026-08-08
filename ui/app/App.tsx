import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Tabs, Tab } from "@dynatrace/strato-components-preview/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong, Paragraph } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Select } from "@dynatrace/strato-components/forms";
import { Switch } from "@dynatrace/strato-components/forms";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import type { Timeframe } from "@dynatrace/strato-components/core";

import {
  SettingsProvider, useSettings,
  TIMEFRAME_OPTIONS, REFRESH_OPTIONS, ALL_TABS,
  setQueryAnchorMs,
} from "./SettingsContext";
import { TimelapseProvider, useTimelapse, TL_BUCKETS, TL_SPEEDS, TL_BUCKET_MS, SharedBucketMetrics } from "./TimelapseContext";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { useDql } from "./useDql";
import { webAppInventoryQuery, sharedTimelapseMetricsQuery } from "./queries";
import { ForecastProvider, ForecastOpener } from "./components/KpiCard";
import { ForecastModal } from "./components/ForecastModal";
import appConfig from "../../app.config.json";

import { ExecutiveSummaryTab } from "./tabs/ExecutiveSummaryTab";
import { PerformanceOverviewTab } from "./tabs/PerformanceOverviewTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { NavigationFlowsTab } from "./tabs/NavigationFlowsTab";
import { ResourceConsumptionTab } from "./tabs/ResourceConsumptionTab";
import { CostRankingTab } from "./tabs/CostRankingTab";
import { TrafficEngagementTab } from "./tabs/TrafficEngagementTab";
import { GeoDevicesTab } from "./tabs/GeoDevicesTab";
import { PerfBudgetsTab } from "./tabs/PerfBudgetsTab";
import { HyperlyzerTab } from "./tabs/HyperlyzerTab";
import { ProblemsTab } from "./tabs/ProblemsTab";

const APP_VERSION_LABEL = appConfig.app.version;

// Hotness palette (matches user-journey-app)
const TL_HOT_ELEV = "#FFF04D";
const TL_HOT_WARM = "#FF3D9A";
const TL_HOT_HIGH = "#FF073A";

// Convert a Strato Timeframe selection to a "days" duration.
function timeframeToDays(tf: Timeframe | null): number | null {
  if (!tf?.from?.absoluteDate || !tf?.to?.absoluteDate) return null;
  const fromMs = Date.parse(tf.from.absoluteDate);
  const toMs = Date.parse(tf.to.absoluteDate);
  if (!isFinite(fromMs) || !isFinite(toMs) || toMs <= fromMs) return null;
  return (toMs - fromMs) / 86400000;
}
// Anchor (epoch ms) for shifted windows; null when "live".
function timeframeAnchorMs(tf: Timeframe | null): number | null {
  if (!tf?.to?.absoluteDate) return null;
  const toMs = Date.parse(tf.to.absoluteDate);
  if (!isFinite(toMs)) return null;
  if (Math.abs(Date.now() - toMs) < 60_000) return null;
  return toMs;
}

const TAB_COMPONENTS: Record<string, React.FC> = {
  "Executive Summary": ExecutiveSummaryTab,
  "Performance Overview": PerformanceOverviewTab,
  "Errors & Reliability": ErrorsTab,
  "Navigation & Flows": NavigationFlowsTab,
  "Resource Consumption": ResourceConsumptionTab,
  "Cost & Ranking": CostRankingTab,
  "Traffic & Engagement": TrafficEngagementTab,
  "Geo & Devices": GeoDevicesTab,
  "Perf Budgets": PerfBudgetsTab,
  "Hyperlyzer": HyperlyzerTab,
  "Problems": ProblemsTab,
};

// ---------------------------------------------------------------------------
// Sticky top toolbar — matches user-journey-app layout
// ---------------------------------------------------------------------------
const AppHeader: React.FC<{
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  aiOpen: boolean;
  onToggleAI: () => void;
  webApps: { name: string; sessions: number }[];
  timeframeRaw: Timeframe | null;
  onChangeTimeframe: (tf: Timeframe | null) => void;
}> = ({ onOpenHelp, onOpenSettings, aiOpen, onToggleAI, webApps, timeframeRaw, onChangeTimeframe }) => {
  const {
    webAppFilter, setWebAppFilter,
    refreshIntervalMs, setRefreshIntervalMs,
  } = useSettings();
  const tl = useTimelapse();

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "rgba(128,128,128,0.06)",
      borderBottom: "1px solid rgba(128,128,128,0.25)",
      padding: "10px 20px 8px 20px",
    }}>
      <Flex alignItems="center" gap={12} flexWrap="wrap">
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.3 }}>Frontend Overview</div>
        <div style={{ opacity: 0.55, fontSize: 12 }}>
          {webApps.length} web app{webApps.length === 1 ? "" : "s"} detected
        </div>

        <Strong style={{ fontSize: 12 }}>Web App</Strong>
        <div style={{ minWidth: 220 }}>
          <Select
            name="webAppFilter"
            value={webAppFilter.selected ?? "__ALL__"}
            onChange={(v: any) => {
              const first = Array.isArray(v) ? v[0] : v;
              setWebAppFilter({ selected: !first || first === "__ALL__" ? null : String(first) });
            }}
          >
            <Select.Content>
              <Select.Option value="__ALL__">All web apps (compare)</Select.Option>
              {webApps.map((a) => (
                <Select.Option key={a.name} value={a.name}>{a.name} ({a.sessions.toLocaleString()})</Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>

        <Strong style={{ fontSize: 12 }}>Timeframe</Strong>
        <div style={{ minWidth: 280 }}>
          <TimeframeSelector
            value={timeframeRaw ?? { from: "now()-24h", to: "now()" }}
            onChange={onChangeTimeframe}
          />
        </div>

        <label
          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
          title="Time-Lapse — replay activity in time buckets"
        >
          <input
            type="checkbox"
            checked={tl.enabled}
            onChange={(e) => tl.setEnabled(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <svg width="14" height="14" viewBox="0 0 16 16" style={{ opacity: tl.enabled ? 0.9 : 0.55 }}>
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4 L8 8 L10.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
          <Strong style={{ fontSize: 12 }}>Time-Lapse</Strong>
        </label>

        <Strong style={{ fontSize: 12 }}>Metric-Stream</Strong>
        <div style={{ minWidth: 130 }}>
          <Select
            name="refresh"
            value={String(refreshIntervalMs)}
            onChange={(v: any) => {
              const first = Array.isArray(v) ? v[0] : v;
              if (first != null) setRefreshIntervalMs(Number(first));
            }}
          >
            <Select.Content>
              {REFRESH_OPTIONS.map((r) => (
                <Select.Option key={r.value} value={String(r.value)}>{r.label}</Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>

        <button
          onClick={onToggleAI}
          title="AI Insights"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: aiOpen ? "rgba(165,110,255,0.18)" : "rgba(128,128,128,0.08)",
            color: "inherit",
            border: `1px solid ${aiOpen ? "rgba(165,110,255,0.5)" : "rgba(128,128,128,0.3)"}`,
            borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="#A56EFF" opacity="0.9" />
          </svg>
          AI Assist
        </button>

        <button
          onClick={onOpenHelp}
          title="Help"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2 }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="10" fill="none" stroke="rgba(128,128,128,0.5)" strokeWidth="1.5" />
            <text x="11" y="15.5" textAnchor="middle" fill="rgba(128,128,128,0.7)" fontSize="14" fontWeight="700">?</text>
          </svg>
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2 }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="10" fill="none" stroke="rgba(128,128,128,0.5)" strokeWidth="1.5" />
            <path d="M11 7v1.5M11 13.5V15M7 11h1.5M13.5 11H15M8.5 8.5l1 1M12.5 12.5l1 1M13.5 8.5l-1 1M9.5 12.5l-1 1" stroke="rgba(128,128,128,0.7)" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="11" cy="11" r="2" stroke="rgba(128,128,128,0.7)" strokeWidth="1.5" />
          </svg>
        </button>

        <Text style={{ fontSize: 11, opacity: 0.4, fontFamily: "monospace", marginLeft: "auto" }}>v{APP_VERSION_LABEL}</Text>
      </Flex>

      {/* Time-Lapse strip */}
      {tl.enabled && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(69,137,255,0.04)", border: "1px solid rgba(69,137,255,0.20)", borderRadius: 8 }}>
          <Flex alignItems="center" gap={12} flexWrap="wrap">
            <Strong style={{ fontSize: 12 }}>Time-Lapse</Strong>
            <Flex alignItems="center" gap={4}>
              <span style={{ fontSize: 11, opacity: 0.65 }}>Bucket</span>
              <select value={tl.bucket} onChange={(e) => tl.setBucket(e.target.value as any)} style={{ fontSize: 11, background: "#1a1e2e", color: "#e0e0e0", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 4, padding: "3px 6px" }}>
                {TL_BUCKETS.map(b => <option key={b.value} value={b.value} style={{ background: "#1a1e2e", color: "#e0e0e0" }}>{b.label}</option>)}
              </select>
            </Flex>
            <Flex alignItems="center" gap={4}>
              <span style={{ fontSize: 11, opacity: 0.65 }}>Speed</span>
              <select value={tl.speedMs} onChange={(e) => tl.setSpeedMs(Number(e.target.value))} style={{ fontSize: 11, background: "#1a1e2e", color: "#e0e0e0", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 4, padding: "3px 6px" }}>
                {TL_SPEEDS.map(s => <option key={s.value} value={s.value} style={{ background: "#1a1e2e", color: "#e0e0e0" }}>{s.label}</option>)}
              </select>
            </Flex>
            <button
              onClick={() => {
                if (tl.index >= tl.totalBuckets - 1) tl.setIndex(0);
                tl.setPlaying(p => !p);
              }}
              disabled={tl.totalBuckets === 0}
              style={{
                fontSize: 11,
                background: tl.playing ? "rgba(255,61,154,0.15)" : "rgba(69,137,255,0.15)",
                color: "inherit",
                border: `1px solid ${tl.playing ? "rgba(255,61,154,0.45)" : "rgba(69,137,255,0.45)"}`,
                borderRadius: 4, padding: "3px 12px",
                cursor: tl.totalBuckets === 0 ? "not-allowed" : "pointer",
                fontWeight: 600, opacity: tl.totalBuckets === 0 ? 0.4 : 1,
              }}
            >{tl.playing ? "⏸ Pause" : "▶ Play"}</button>
            <button
              onClick={() => { tl.setPlaying(false); tl.setIndex(0); }}
              disabled={tl.totalBuckets === 0}
              style={{ fontSize: 11, background: "rgba(128,128,128,0.08)", color: "inherit", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 4, padding: "3px 10px", cursor: tl.totalBuckets === 0 ? "not-allowed" : "pointer", opacity: tl.totalBuckets === 0 ? 0.4 : 1 }}
            >↺ Restart</button>
            <div style={{ flex: 1, minWidth: 180, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, tl.totalBuckets - 1)}
                value={Math.min(tl.index, Math.max(0, tl.totalBuckets - 1))}
                onChange={(e) => { tl.setPlaying(false); tl.setIndex(Number(e.target.value)); }}
                disabled={tl.totalBuckets === 0}
                style={{ flex: 1, accentColor: "#4589FF" }}
              />
              <span style={{ fontSize: 11, opacity: 0.7, fontFamily: "monospace", minWidth: 90, textAlign: "right" }}>
                {tl.totalBuckets === 0 ? "no data" : `${tl.index + 1} / ${tl.totalBuckets}`}
              </span>
            </div>
            {tl.currentBucketKey && (
              <span style={{ fontSize: 11, opacity: 0.55, fontFamily: "monospace" }}>{tl.currentBucketKey}</span>
            )}
          </Flex>

          {/* Shared hotness strip — Z-score of shared metrics per bucket */}
          {tl.hotness.length > 0 && (() => {
            const stripH = 26;
            const maxHot = Math.max(0.5, ...tl.hotness);
            const bars = tl.hotness;
            const cursorIdx = Math.min(tl.index, Math.max(0, bars.length - 1));
            return (
              <div style={{ marginTop: 8, padding: "6px 4px 4px", borderTop: "1px solid rgba(69,137,255,0.15)" }}>
                <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
                    Hotness · {tl.hotnessSource || "signal"}
                  </span>
                  <Flex alignItems="center" gap={8}>
                    <span style={{ fontSize: 10, opacity: 0.55 }}><span style={{ display: "inline-block", width: 8, height: 8, background: "#4589FF", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Normal</span>
                    <span style={{ fontSize: 10, opacity: 0.55 }}><span style={{ display: "inline-block", width: 8, height: 8, background: TL_HOT_ELEV, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Elevated</span>
                    <span style={{ fontSize: 10, opacity: 0.55 }}><span style={{ display: "inline-block", width: 8, height: 8, background: TL_HOT_WARM, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Warm</span>
                    <span style={{ fontSize: 10, opacity: 0.55 }}><span style={{ display: "inline-block", width: 8, height: 8, background: TL_HOT_HIGH, borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />Spike</span>
                    <span style={{ fontSize: 10, opacity: 0.55, fontFamily: "monospace" }}>peak z={maxHot.toFixed(1)}</span>
                  </Flex>
                </Flex>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: stripH, cursor: "pointer" }}>
                  {bars.map((v, i) => {
                    const norm = Math.min(1, v / maxHot);
                    const color = v >= 2.5 ? TL_HOT_HIGH : v >= 1.5 ? TL_HOT_WARM : v >= 0.75 ? TL_HOT_ELEV : "#4589FF";
                    const opacity = i === cursorIdx ? 1 : 0.65;
                    const h = Math.max(2, norm * stripH);
                    return (
                      <div
                        key={i}
                        onClick={() => { tl.setPlaying(false); tl.setIndex(i); }}
                        title={`bucket ${i + 1} · z=${v.toFixed(2)} · click to seek`}
                        style={{ flex: 1, height: h, background: color, opacity, borderRadius: 1, transition: "opacity 0.15s", outline: i === cursorIdx ? "1px solid rgba(255,255,255,0.85)" : "none" }}
                      />
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2, textAlign: "right" }}>Click a bar to seek</div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AI Assist side panel — lightweight sheet (Sheet already handles overlay + focus)
// ---------------------------------------------------------------------------
const AIAssistSheet: React.FC<{ show: boolean; onDismiss: () => void; webApps: { name: string; sessions: number }[] }> = ({ show, onDismiss, webApps }) => {
  const { webAppFilter, timeframeDays } = useSettings();
  const target = webAppFilter.selected ?? "your fleet";
  const activity = webApps.reduce((a, b) => a + (b.sessions || 0), 0);
  return (
    <Sheet title="AI Assist" show={show} onDismiss={onDismiss} actions={<Button variant="emphasized" onClick={onDismiss}>Close</Button>}>
      <div style={{ padding: "4px 0" }}>
        <Paragraph>
          <Strong>Scope:</Strong> {target}
          <br />
          <Strong>Window:</Strong> last {timeframeDays >= 1 ? `${timeframeDays} day${timeframeDays === 1 ? "" : "s"}` : `${Math.round(timeframeDays * 24)}h`}
          <br />
          <Strong>Sessions in scope:</Strong> {activity.toLocaleString()}
        </Paragraph>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: "1px solid rgba(165,110,255,0.35)", background: "rgba(165,110,255,0.08)" }}>
          <Strong style={{ color: "#A56EFF" }}>Suggested next steps</Strong>
          <ul style={{ marginTop: 8, lineHeight: 1.6, fontSize: 13 }}>
            <li>Open <em>Executive Summary</em> to grade every web app on Core Web Vitals + error/bounce.</li>
            <li>Open <em>Resource Consumption</em> to see which app is heaviest per session.</li>
            <li>Enable <em>Time-Lapse</em> in the header to replay activity bucket by bucket.</li>
          </ul>
        </div>
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Help panel
// ---------------------------------------------------------------------------
const HelpSheet: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => (
  <Sheet title="Frontend Overview — Help" show={show} onDismiss={onDismiss} actions={<Button variant="emphasized" onClick={onDismiss}>Close</Button>}>
    <div style={{ padding: "4px 0" }}>
      <Paragraph>This app compares and contrasts every RUM-instrumented web application in your Dynatrace tenant.</Paragraph>
      <Paragraph><Strong>Executive Summary</Strong> — grades each web app on a 0–100 composite (LCP, INP, CLS, TTFB, error rate, bounce).</Paragraph>
      <Paragraph><Strong>Web Vitals</Strong> — Core Web Vitals distributions per app.</Paragraph>
      <Paragraph><Strong>Errors & Reliability</Strong> — JS errors, error rate, affected sessions.</Paragraph>
      <Paragraph><Strong>Resource Consumption</Strong> — bytes, requests, third-party impact per app.</Paragraph>
      <Paragraph><Strong>Time-Lapse</Strong> (header toggle) — replay activity in configurable buckets.</Paragraph>
      <Paragraph><Strong>Metric-Stream</Strong> (header) — auto-refresh cadence.</Paragraph>
      <Paragraph><Strong>Settings</Strong> — show/hide any tab and tune perf-budget thresholds.</Paragraph>
    </div>
  </Sheet>
);

// ---------------------------------------------------------------------------
// Settings panel — tab visibility toggles + perf budgets
// ---------------------------------------------------------------------------
const SettingsSheet: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => {
  const { tabVisibility, toggleTab, resetTabVisibility, budgets, setBudgets } = useSettings();
  const visibleCount = Object.values(tabVisibility).filter(Boolean).length;

  return (
    <Sheet title="Settings" show={show} onDismiss={onDismiss} actions={<Button variant="emphasized" onClick={onDismiss}>Close</Button>}>
      <div style={{ padding: "4px 0" }}>
        <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(128,128,128,0.06)", borderRadius: 6, border: "1px solid rgba(128,128,128,0.15)" }}>
          <Text style={{ fontSize: 12, opacity: 0.75 }}>These preferences are saved per-user and apply only to you.</Text>
        </div>

        {/* Tab visibility */}
        <div style={{ marginBottom: 18, border: "1px solid rgba(69,137,255,0.25)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: "rgba(69,137,255,0.08)", borderBottom: "1px solid rgba(69,137,255,0.25)" }}>
            <Strong style={{ fontSize: 13 }}>Show / Hide Tabs</Strong>
            <Text style={{ fontSize: 11, opacity: 0.65, display: "block", marginTop: 2 }}>
              {visibleCount} of {ALL_TABS.length} tabs visible. Hidden tabs won't appear in the navigation.
            </Text>
          </div>
          <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
            {ALL_TABS.map((name) => (
              <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, userSelect: "none" }}>
                <Switch value={!!tabVisibility[name]} onChange={() => toggleTab(name)} />
                <span style={{ opacity: tabVisibility[name] ? 1 : 0.55 }}>{name}</span>
              </label>
            ))}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(128,128,128,0.15)", display: "flex", justifyContent: "flex-end" }}>
            <Button variant="default" onClick={resetTabVisibility}>Show all tabs</Button>
          </div>
        </div>

        {/* Perf budgets */}
        <div style={{ border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: "rgba(128,128,128,0.08)", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
            <Strong style={{ fontSize: 13 }}>Performance Budgets</Strong>
            <Text style={{ fontSize: 11, opacity: 0.65, display: "block", marginTop: 2 }}>
              Thresholds used by the Perf Budgets tab. Values are in milliseconds unless noted.
            </Text>
          </div>
          <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
            {([
              ["lcp_ms", "LCP (ms)"],
              ["inp_ms", "INP (ms)"],
              ["cls", "CLS"],
              ["ttfb_ms", "TTFB (ms)"],
              ["pageLoad_ms", "Page load (ms)"],
              ["errorRate_pct", "Error rate (%)"],
              ["bytesPerPage_kb", "Bytes / page (KB)"],
              ["requestsPerPage", "Requests / page"],
              ["thirdPartyPct", "3rd party (%)"],
            ] as const).map(([key, label]) => (
              <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <span style={{ opacity: 0.75 }}>{label}</span>
                <input
                  type="number"
                  value={(budgets as any)[key]}
                  onChange={(e) => setBudgets({ ...budgets, [key]: Number(e.target.value) })}
                  style={{
                    background: "rgba(128,128,128,0.08)",
                    color: "inherit",
                    border: "1px solid rgba(128,128,128,0.3)",
                    borderRadius: 4, padding: "4px 8px",
                    fontFamily: "monospace",
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Main shell
// ---------------------------------------------------------------------------
const AppInner: React.FC = () => {
  const { tabVisibility, timeframeDays, setTimeframeDays, webAppFilter, refreshIntervalMs } = useSettings();
  const [tab, setTab] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [timeframeRaw, setTimeframeRaw] = useState<Timeframe | null>(null);
  const [forecastModal, setForecastModal] = useState<{ label: string; sparkline: number[]; color?: string } | null>(null);
  const tl = useTimelapse();

  // Metric-stream key — bump periodically to force query refetch
  const [streamKey, setStreamKey] = useState(0);
  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const id = window.setInterval(() => setStreamKey((k) => k + 1), refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshIntervalMs]);

  const inv = useDql(webAppInventoryQuery(timeframeDays), [timeframeDays, streamKey]);
  const webApps = useMemo(() => {
    const recs = inv.data?.records ?? [];
    return recs
      .map((r: any) => ({ name: String(r.application ?? ""), sessions: Number(r.sessions ?? 0) }))
      .filter((r) => r.name);
  }, [inv.data]);

  const visibleTabs = useMemo(() => ALL_TABS.filter((t) => tabVisibility[t] !== false), [tabVisibility]);
  useEffect(() => {
    if (tab >= visibleTabs.length && visibleTabs.length > 0) setTab(0);
  }, [visibleTabs.length]);

  // ---- Shared Time-Lapse metrics publisher ----
  // When TL is enabled, fetch per-bucket shared metrics and publish to context
  // so every tab can see the same bucket cursor + hotness strip renders.
  const tlBucketLabel = tl.bucket; // "1m"|"5m"|"10m"|"30m"|"1h" — DQL valid
  const sharedTlQuery = tl.enabled
    ? sharedTimelapseMetricsQuery(timeframeDays, webAppFilter.selected, tlBucketLabel)
    : null;
  const sharedTl = useDql(sharedTlQuery, [timeframeDays, webAppFilter.selected, tlBucketLabel, tl.enabled, streamKey]);

  // Parse records → SharedBucketMetrics[] and publish
  useEffect(() => {
    if (!tl.enabled) {
      tl.reportSharedMetrics([]);
      tl.reportBuckets(0);
      tl.reportHotness([]);
      return;
    }
    const recs = sharedTl.data?.records ?? [];
    if (recs.length === 0) {
      tl.reportSharedMetrics([]);
      tl.reportBuckets(0);
      tl.reportHotness([]);
      return;
    }
    const bucketMs = TL_BUCKET_MS[tl.bucket] ?? 300000;
    const parsed: SharedBucketMetrics[] = recs.map((r: any) => {
      const bucketStr = String(r.bkt ?? "");
      const fromMs = Date.parse(bucketStr) || 0;
      return {
        bucket: bucketStr,
        fromMs,
        toMs: fromMs + bucketMs,
        sessions: Number(r.sessions ?? 0),
        totalActions: Number(r.totalActions ?? 0),
        avgDurationMs: Number(r.avgDurationMs ?? 0),
        errorCount: Number(r.errorCount ?? 0),
        errorRate: Number(r.errorRate ?? 0),
        lcp: r.lcp != null ? Number(r.lcp) : null,
        cls: r.cls != null ? Number(r.cls) : null,
        inp: r.inp != null ? Number(r.inp) : null,
        ttfb: r.ttfb != null ? Number(r.ttfb) : null,
      };
    });
    tl.reportSharedMetrics(parsed);
    tl.reportBuckets(parsed.length, parsed[Math.min(tl.index, parsed.length - 1)]?.bucket);

    // Baselines: mean + std per metric
    const stats = (vals: number[]) => {
      const clean = vals.filter((v) => isFinite(v));
      if (clean.length < 2) return { mean: 0, std: 1 };
      const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
      const variance = clean.reduce((a, v) => a + (v - mean) ** 2, 0) / clean.length;
      return { mean, std: Math.max(1e-6, Math.sqrt(variance)) };
    };
    const errBase = stats(parsed.map((p) => p.errorRate));
    const durBase = stats(parsed.map((p) => p.avgDurationMs));
    const lcpBase = stats(parsed.map((p) => p.lcp ?? 0).filter((v) => v > 0));
    // Z-score per bucket: max(errZ, durZ, lcpZ). Only positive deviation = hot.
    const hot = parsed.map((p) => {
      const errZ = errBase.std > 0 ? (p.errorRate - errBase.mean) / errBase.std : 0;
      const durZ = durBase.std > 0 ? (p.avgDurationMs - durBase.mean) / durBase.std : 0;
      const lcpZ = lcpBase.std > 0 && p.lcp != null ? (p.lcp - lcpBase.mean) / lcpBase.std : 0;
      return Math.max(0, errZ, durZ, lcpZ);
    });
    tl.reportHotness(hot, "Shared KPIs Z-score");
  }, [tl.enabled, sharedTl.data, tl.bucket]);

  const openForecast = useCallback<ForecastOpener>((label, sparkline, color) => {
    if (sparkline && sparkline.length > 1) setForecastModal({ label, sparkline, color });
  }, []);

  const anchor = timeframeAnchorMs(timeframeRaw);
  const tfDurMs = timeframeDays * 86400000;
  const fromMs = (anchor ?? Date.now()) - tfDurMs;
  const toMs = anchor ?? Date.now();

  const handleTimeframeChange = useCallback((tf: Timeframe | null) => {
    setTimeframeRaw(tf);
    const d = timeframeToDays(tf);
    if (d != null) setTimeframeDays(d);
    setQueryAnchorMs(timeframeAnchorMs(tf));
  }, [setTimeframeDays]);

  return (
    <>
      <AppHeader
        onOpenHelp={() => setShowHelp(true)}
        onOpenSettings={() => setShowSettings(true)}
        aiOpen={aiOpen}
        onToggleAI={() => setAiOpen((v) => !v)}
        webApps={webApps}
        timeframeRaw={timeframeRaw}
        onChangeTimeframe={handleTimeframeChange}
      />
      <ForecastProvider value={openForecast}>
        <div style={{ padding: "0 8px" }}>
          {visibleTabs.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", opacity: 0.6 }}>
              <Paragraph>All tabs are hidden. Open <Strong>Settings</Strong> to enable one.</Paragraph>
              <Button variant="emphasized" onClick={() => setShowSettings(true)}>Open Settings</Button>
            </div>
          ) : (
            <Tabs selectedIndex={tab} onChange={(i: any) => setTab(Number(i) || 0)}>
              {visibleTabs.map((name) => {
                const Comp = TAB_COMPONENTS[name];
                return (
                  <Tab key={name} title={name}>
                    {Comp ? <Comp /> : <Paragraph>Unknown tab</Paragraph>}
                  </Tab>
                );
              })}
            </Tabs>
          )}
        </div>
      </ForecastProvider>

      <HelpSheet show={showHelp} onDismiss={() => setShowHelp(false)} />
      <SettingsSheet show={showSettings} onDismiss={() => setShowSettings(false)} />
      <AIAssistSheet show={aiOpen} onDismiss={() => setAiOpen(false)} webApps={webApps} />

      {forecastModal && (
        <ForecastModal
          label={forecastModal.label}
          sparkline={forecastModal.sparkline}
          color={forecastModal.color}
          fromMs={fromMs}
          toMs={toMs}
          onClose={() => setForecastModal(null)}
          getRequeryData={async () => forecastModal.sparkline}
        />
      )}
    </>
  );
};

export const App: React.FC = () => {
  return (
    <SettingsProvider>
      <TimelapseProvider>
        <DisclaimerModal />
        <Page>
          <Page.Main>
            <AppInner />
          </Page.Main>
        </Page>
      </TimelapseProvider>
    </SettingsProvider>
  );
};
