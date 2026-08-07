import React, { useMemo, useState, useEffect } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Tabs, Tab } from "@dynatrace/strato-components-preview/navigation";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong, Paragraph } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Select } from "@dynatrace/strato-components/forms";
import { Switch } from "@dynatrace/strato-components/forms";

import {
  SettingsProvider, useSettings,
  TIMEFRAME_OPTIONS, REFRESH_OPTIONS, ALL_TABS,
} from "./SettingsContext";
import { TimelapseProvider, useTimelapse, TL_BUCKETS, TL_SPEEDS } from "./TimelapseContext";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { useDql } from "./useDql";
import { webAppInventoryQuery } from "./queries";
import appConfig from "../../app.config.json";

import { ExecutiveSummaryTab } from "./tabs/ExecutiveSummaryTab";
import { WebVitalsTab } from "./tabs/WebVitalsTab";
import { PerformanceTab } from "./tabs/PerformanceTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { NavigationFlowsTab } from "./tabs/NavigationFlowsTab";
import { ResourceConsumptionTab } from "./tabs/ResourceConsumptionTab";
import { CostRankingTab } from "./tabs/CostRankingTab";
import { TrafficEngagementTab } from "./tabs/TrafficEngagementTab";
import { GeoDevicesTab } from "./tabs/GeoDevicesTab";
import { PerfBudgetsTab } from "./tabs/PerfBudgetsTab";
import { ProblemsTab } from "./tabs/ProblemsTab";

const APP_VERSION_LABEL = appConfig.app.version;

const TAB_COMPONENTS: Record<string, React.FC> = {
  "Executive Summary": ExecutiveSummaryTab,
  "Web Vitals": WebVitalsTab,
  "Performance": PerformanceTab,
  "Errors & Reliability": ErrorsTab,
  "Navigation & Flows": NavigationFlowsTab,
  "Resource Consumption": ResourceConsumptionTab,
  "Cost & Ranking": CostRankingTab,
  "Traffic & Engagement": TrafficEngagementTab,
  "Geo & Devices": GeoDevicesTab,
  "Perf Budgets": PerfBudgetsTab,
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
}> = ({ onOpenHelp, onOpenSettings, aiOpen, onToggleAI, webApps }) => {
  const {
    timeframeDays, setTimeframeDays,
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
        <div style={{ minWidth: 170 }}>
          <Select
            name="timeframe"
            value={String(timeframeDays)}
            onChange={(v: any) => {
              const first = Array.isArray(v) ? v[0] : v;
              if (first != null) setTimeframeDays(Number(first));
            }}
          >
            <Select.Content>
              {TIMEFRAME_OPTIONS.map((tf) => (
                <Select.Option key={tf.value} value={String(tf.value)}>{tf.label}</Select.Option>
              ))}
            </Select.Content>
          </Select>
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
  const { tabVisibility, timeframeDays, refreshIntervalMs } = useSettings();
  const [tab, setTab] = useState<number>(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

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

  return (
    <>
      <AppHeader
        onOpenHelp={() => setShowHelp(true)}
        onOpenSettings={() => setShowSettings(true)}
        aiOpen={aiOpen}
        onToggleAI={() => setAiOpen((v) => !v)}
        webApps={webApps}
      />
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

      <HelpSheet show={showHelp} onDismiss={() => setShowHelp(false)} />
      <SettingsSheet show={showSettings} onDismiss={() => setShowSettings(false)} />
      <AIAssistSheet show={aiOpen} onDismiss={() => setAiOpen(false)} webApps={webApps} />
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
