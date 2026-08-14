import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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

import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import {
  SettingsProvider, useSettings,
  TIMEFRAME_OPTIONS, REFRESH_OPTIONS, ALL_TABS, NAV_FLOWS_SUB_TABS,
  DEFAULT_GRADE_WEIGHTS,
  INDUSTRY_NAMES,
  setQueryAnchorMs, getQueryAnchorMs,
} from "./SettingsContext";
import { TimelapseProvider, useTimelapse, TL_BUCKETS, TL_SPEEDS, TL_BUCKET_MS, SharedBucketMetrics } from "./TimelapseContext";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { useDql } from "./useDql";
import { webAppInventoryQuery, sharedTimelapseMetricsQuery } from "./queries";
import { ForecastProvider, ForecastOpener, CorrelationsContext, RelatedMetricEntry } from "./components/KpiCard";
import { HotnessAssistButton, HotnessAssistPanel, analyzeHotnessTimelapse, HotnessAssistData } from "./components/HotnessAssist";
import { ForecastModal } from "./components/ForecastModal";
import { CorrelationsPanel } from "./components/CorrelationsPanel";
import { AIInsightsContext } from "./components/AIInsights";
import appConfig from "../../app.config.json";

import { ExecutiveSummaryTab } from "./tabs/ExecutiveSummaryTab";
import { PerformanceOverviewTab } from "./tabs/PerformanceOverviewTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { NavigationFlowsTab } from "./tabs/NavigationFlowsTab";
import { CostRankingTab } from "./tabs/CostRankingTab";
import { PerfBudgetsTab } from "./tabs/PerfBudgetsTab";
import { HyperlyzerTab } from "./tabs/HyperlyzerTab";
import { ActionBacklogTab } from "./tabs/ActionBacklogTab";
import { OpportunityMatrixTab } from "./tabs/OpportunityMatrixTab";

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
  "Opportunity Matrix": OpportunityMatrixTab,
  "Errors & Reliability": ErrorsTab,
  "Navigation & Flows": NavigationFlowsTab,
  "Cost & Ranking": CostRankingTab,
  "Perf Budgets": PerfBudgetsTab,
  "Hyperlyzer": HyperlyzerTab,
  "Action Backlog": ActionBacklogTab,
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

  const [appFilterPhrase, setAppFilterPhrase] = useState("");

  const filteredWebApps = useMemo(() => {
    if (!appFilterPhrase.trim()) return webApps;
    const lower = appFilterPhrase.toLowerCase();
    return webApps.filter(a => a.name.toLowerCase().includes(lower));
  }, [webApps, appFilterPhrase]);

  const prevPhraseRef = useRef("");
  useEffect(() => {
    const prev = prevPhraseRef.current;
    prevPhraseRef.current = appFilterPhrase;
    if (!appFilterPhrase.trim()) {
      if (prev.trim()) setWebAppFilter({ selected: null });
      return;
    }
    const lower = appFilterPhrase.toLowerCase();
    const matched = webApps.filter(a => a.name.toLowerCase().includes(lower)).map(a => a.name);
    // If phrase matches everything (or nothing), treat as no filter
    setWebAppFilter({ selected: matched.length > 0 && matched.length < webApps.length ? matched : null });
  }, [appFilterPhrase, webApps]);

  // Hotness Assist panel state
  const [hotnessAssistOpen, setHotnessAssistOpen] = useState(false);
  const [hotnessAssistPos, setHotnessAssistPos] = useState<{ x: number; y: number }>({ x: 48, y: 200 });
  const hotnessAssistDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const startHotnessAssistDrag = useCallback((e: React.MouseEvent) => {
    hotnessAssistDragRef.current = { startX: e.clientX, startY: e.clientY, origX: hotnessAssistPos.x, origY: hotnessAssistPos.y };
    const move = (me: MouseEvent) => {
      if (!hotnessAssistDragRef.current) return;
      setHotnessAssistPos({ x: hotnessAssistDragRef.current.origX + me.clientX - hotnessAssistDragRef.current.startX, y: hotnessAssistDragRef.current.origY + me.clientY - hotnessAssistDragRef.current.startY });
    };
    const up = () => { hotnessAssistDragRef.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }, [hotnessAssistPos]);
  useEffect(() => { if (!tl.enabled) setHotnessAssistOpen(false); }, [tl.enabled]);

  // Hotness diagnosis panel — draggable, portaled to body.
  const [tlDiagPanel, setTlDiagPanel] = useState<{ pos: { x: number; y: number } } | null>(null);
  const tlDiagDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const startTlDiagDrag = useCallback((e: React.MouseEvent) => {
    if (!tlDiagPanel) return;
    tlDiagDragRef.current = { startX: e.clientX, startY: e.clientY, origX: tlDiagPanel.pos.x, origY: tlDiagPanel.pos.y };
    const move = (me: MouseEvent) => {
      if (!tlDiagDragRef.current) return;
      setTlDiagPanel({ pos: { x: tlDiagDragRef.current.origX + me.clientX - tlDiagDragRef.current.startX, y: tlDiagDragRef.current.origY + me.clientY - tlDiagDragRef.current.startY } });
    };
    const up = () => { tlDiagDragRef.current = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }, [tlDiagPanel]);
  useEffect(() => { if (!tl.enabled) setTlDiagPanel(null); }, [tl.enabled]);

  // Baselines (mean/std) across all buckets for Z-score computation.
  const tlBaselines = useMemo(() => {
    const rows = tl.sharedMetricsAll;
    if (rows.length < 2) return null;
    const stat = (get: (r: SharedBucketMetrics) => number | null | undefined) => {
      const vs = rows.map(get).filter((v): v is number => v != null && isFinite(v));
      if (vs.length < 2) return { mean: 0, std: 1 };
      const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
      const variance = vs.reduce((a, b) => a + (b - mean) ** 2, 0) / vs.length;
      const std = Math.sqrt(variance) || 1;
      return { mean, std };
    };
    return {
      sessions: stat((r) => r.sessions),
      errorRate: stat((r) => r.errorRate),
      avgDurationMs: stat((r) => r.avgDurationMs),
      lcp: stat((r) => r.lcp),
      inp: stat((r) => r.inp),
      cls: stat((r) => r.cls),
      ttfb: stat((r) => r.ttfb),
    };
  }, [tl.sharedMetricsAll]);

  const hotnessAssistData: HotnessAssistData | null = useMemo(() => {
    if (!tl.enabled || tl.sharedMetricsAll.length < 2 || !tlBaselines || tl.hotness.length === 0) return null;
    return analyzeHotnessTimelapse(tl.sharedMetricsAll, tl.hotness, tlBaselines, tl.bucket);
  }, [tl.enabled, tl.sharedMetricsAll, tl.hotness, tlBaselines, tl.bucket]);

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20,
      background: "var(--dt-colors-background-base-default, #0f1428)",
      borderBottom: "1px solid rgba(128,128,128,0.35)",
      padding: "10px 20px 8px 20px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    }}>
      <Flex alignItems="center" gap={12} flexWrap="wrap">
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.3 }}>Frontend Overview</div>
        <div style={{ opacity: 0.55, fontSize: 12 }}>
          {webApps.length} web app{webApps.length === 1 ? "" : "s"} detected
        </div>

        <Strong style={{ fontSize: 12 }}>Web App</Strong>
        <input
          type="text"
          value={appFilterPhrase}
          onChange={e => setAppFilterPhrase(e.target.value)}
          placeholder="filter apps…"
          style={{
            width: 130,
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid rgba(128,128,128,0.4)",
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            fontSize: 12,
            outline: "none",
          }}
        />
        <Select
          name="webAppFilter"
          multiple={true}
          value={webAppFilter.selected ?? []}
          onChange={(v: string[]) => {
            setWebAppFilter({ selected: v.length === 0 ? null : v });
          }}
        >
          <Select.Trigger width="280px" />
          <Select.Content>
            {filteredWebApps.length === 0
              ? <Select.EmptyState>No apps match filter</Select.EmptyState>
              : filteredWebApps.map((a) => (
                  <Select.Option key={a.name} value={a.name}>{a.name} ({a.sessions.toLocaleString()})</Select.Option>
                ))
            }
          </Select.Content>
        </Select>

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
                  <Flex alignItems="center" gap={8}>
                    <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
                      Hotness · {tl.hotnessSource || "signal"}
                    </span>
                    {hotnessAssistData && (
                      <HotnessAssistButton active={hotnessAssistOpen} onClick={() => setHotnessAssistOpen(v => !v)} />
                    )}
                  </Flex>
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
                        onClick={() => { tl.setPlaying(false); tl.setIndex(i); setTlDiagPanel(prev => ({ pos: prev?.pos ?? { x: 48, y: 260 } })); }}
                        title={`bucket ${i + 1} · z=${v.toFixed(2)} · click to diagnose`}
                        style={{ flex: 1, height: h, background: color, opacity, borderRadius: 1, transition: "opacity 0.15s", outline: i === cursorIdx ? "1px solid rgba(255,255,255,0.85)" : "none" }}
                      />
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2, textAlign: "right" }}>Click a bar to seek &amp; diagnose · drag panel to move</div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Hotness diagnosis panel — portaled to body so z-index is unconstrained */}
      {tlDiagPanel && tlBaselines && tl.sharedMetricsAll.length > 0 && createPortal((() => {
        const idx = Math.min(Math.max(tl.index, 0), tl.sharedMetricsAll.length - 1);
        const row = tl.sharedMetricsAll[idx];
        if (!row) return null;
        // positive badnessZ = worse than mean; sessions is neutral
        const bZ = (val: number, base: { mean: number; std: number }, lowerIsBetter: boolean) => {
          const raw = (val - base.mean) / base.std;
          return lowerIsBetter ? -raw : raw;
        };
        const metrics: { label: string; value: string; z: number; neutral: boolean; desc: string }[] = [
          { label: "Sessions",     value: row.sessions.toLocaleString(),           z: (row.sessions - tlBaselines.sessions.mean) / tlBaselines.sessions.std, neutral: true,  desc: "traffic volume vs avg" },
          { label: "Error Rate",   value: `${row.errorRate.toFixed(2)}%`,          z: bZ(row.errorRate, tlBaselines.errorRate, false),                       neutral: false, desc: "errors vs avg — ↑ bad" },
          { label: "Avg Duration", value: `${Math.round(row.avgDurationMs)}ms`,    z: bZ(row.avgDurationMs, tlBaselines.avgDurationMs, false),               neutral: false, desc: "load time vs avg — ↑ bad" },
          ...(row.lcp != null && tlBaselines.lcp.mean > 0 ? [{ label: "LCP", value: `${Math.round(row.lcp)}ms`, z: bZ(row.lcp, tlBaselines.lcp, false), neutral: false, desc: "paint time vs avg — ↑ bad" }] : []),
          ...(row.inp != null && tlBaselines.inp.mean > 0 ? [{ label: "INP", value: `${Math.round(row.inp)}ms`, z: bZ(row.inp, tlBaselines.inp, false), neutral: false, desc: "input latency vs avg — ↑ bad" }] : []),
          ...(row.cls != null && tlBaselines.cls.mean > 0 ? [{ label: "CLS", value: row.cls.toFixed(3), z: bZ(row.cls, tlBaselines.cls, false), neutral: false, desc: "layout shift vs avg — ↑ bad" }] : []),
          ...(row.ttfb != null && tlBaselines.ttfb.mean > 0 ? [{ label: "TTFB", value: `${Math.round(row.ttfb)}ms`, z: bZ(row.ttfb, tlBaselines.ttfb, false), neutral: false, desc: "server latency vs avg — ↑ bad" }] : []),
        ];
        const hotZ = tl.hotness[idx] ?? 0;
        const hotColor = hotZ >= 2.5 ? TL_HOT_HIGH : hotZ >= 1.5 ? TL_HOT_WARM : hotZ >= 0.75 ? TL_HOT_ELEV : "#4589FF";
        const mColor = (m: typeof metrics[0]) => {
          if (m.neutral) return Math.abs(m.z) >= 1.5 ? TL_HOT_WARM : "#4589FF";
          if (m.z <= 0) return "#0D9C29";
          return m.z >= 2.5 ? TL_HOT_HIGH : m.z >= 1.5 ? TL_HOT_WARM : m.z >= 0.75 ? TL_HOT_ELEV : "#0D9C29";
        };
        const bad = metrics.filter(m => !m.neutral && m.z >= 0.75).sort((a, b) => b.z - a.z);
        const sessM = metrics[0];
        let driver = "";
        if (bad.length === 0 && Math.abs(sessM.z) < 0.75) driver = "Within normal range";
        else if (Math.abs(sessM.z) >= 1.5 && (bad.length === 0 || Math.abs(sessM.z) > bad[0].z)) driver = sessM.z > 0 ? "Traffic surge" : "Traffic drop";
        else if (bad[0]?.label === "Error Rate") driver = "Error storm";
        else if (bad[0]?.label === "Avg Duration" || bad[0]?.label === "LCP") driver = "Performance regression";
        else if (bad[0]) driver = `${bad[0].label} anomaly`;
        const driverColor = driver === "Within normal range" ? "#0D9C29" : bad[0]?.z >= 2.5 ? TL_HOT_HIGH : bad[0]?.z >= 1.5 ? TL_HOT_WARM : TL_HOT_ELEV;

        return (
          <div style={{ position: "fixed", left: tlDiagPanel.pos.x, top: tlDiagPanel.pos.y, width: 290, background: "var(--dt-colors-background-base-default,#0f1428)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.55)", zIndex: 600, userSelect: "none", fontSize: 12 }}>
            <div onMouseDown={startTlDiagDrag} style={{ padding: "7px 10px", borderBottom: "1px solid rgba(128,128,128,0.2)", cursor: "grab", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(128,128,128,0.07)", borderRadius: "8px 8px 0 0" }}>
              <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>Bucket {idx + 1} · Why is this hot?</span>
              <button onClick={() => setTlDiagPanel(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.5, fontSize: 15, padding: "0 2px", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "7px 10px", borderBottom: "1px solid rgba(128,128,128,0.12)" }}>
              <div style={{ fontSize: 10, opacity: 0.45, marginBottom: 3, fontFamily: "monospace" }}>{row.bucket}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: hotColor }}>Hotness Z = {hotZ.toFixed(2)}</span>
                {driver && <span style={{ fontSize: 10, fontWeight: 600, color: driverColor, background: `${driverColor}18`, border: `1px solid ${driverColor}40`, borderRadius: 4, padding: "1px 6px" }}>{driver}</span>}
              </div>
            </div>
            <div style={{ padding: "6px 0 4px" }}>
              {metrics.map(m => {
                const col = mColor(m);
                const barW = Math.min(100, Math.abs(m.z) / 3 * 100);
                return (
                  <div key={m.label} style={{ padding: "3px 10px 5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{m.label}</span>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                        <span style={{ fontSize: 11, fontFamily: "monospace", opacity: 0.6 }}>{m.value}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: col, fontFamily: "monospace", minWidth: 54, textAlign: "right" }}>{m.z >= 0 ? "+" : ""}{m.z.toFixed(2)}z</span>
                      </div>
                    </div>
                    <div style={{ height: 3, background: "rgba(128,128,128,0.12)", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${barW}%`, background: col, borderRadius: 2, transition: "width 0.2s" }} />
                    </div>
                    <div style={{ fontSize: 9, opacity: 0.35, marginTop: 1 }}>{m.desc}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "5px 10px", borderTop: "1px solid rgba(128,128,128,0.12)", fontSize: 9, opacity: 0.35 }}>Drag header · panel tracks current bucket</div>
          </div>
        );
      })(), document.body)}

      {/* Hotness Assist panel */}
      {hotnessAssistOpen && hotnessAssistData && (
        <HotnessAssistPanel
          data={hotnessAssistData}
          pos={hotnessAssistPos}
          onClose={() => setHotnessAssistOpen(false)}
          onDragStart={startHotnessAssistDrag}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Help panel
// ---------------------------------------------------------------------------
const HelpSheet: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => (
  <Sheet title="Frontend Overview — Help" show={show} onDismiss={onDismiss} actions={<Button variant="emphasized" onClick={onDismiss}>Close</Button>}>
    <div style={{ padding: "4px 0", lineHeight: 1.6 }}>
      <Paragraph style={{ marginBottom: 16 }}>This app compares and contrasts every RUM-instrumented web application in your Dynatrace tenant. Use the web app filter in the header to scope all tabs to a single application.</Paragraph>

      <Strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>Tabs</Strong>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {[
          { name: "Executive Summary", desc: "Grades every web app on a 0–100 composite score (LCP, INP, CLS, TTFB, error rate, bounce). Trend lines show improvement/degradation over time.", subTabs: null },
          { name: "Performance Overview", desc: "Fleet-wide Core Web Vitals per app — LCP, INP, CLS, TTFB with color-coded pass/fail indicators. Rank apps by any metric.", subTabs: null },
          { name: "Opportunity Matrix", desc: "Scatter plot of every web app by traffic volume (x) vs composite score (y). The median crosshair divides four action quadrants: Fix First, Protect, Monitor, Maintain. Includes a ranked Fix First table and min/max session filter.", subTabs: null },
          { name: "Errors & Reliability", desc: "Error rates, total error counts, and sessions with errors per web app. Also shows the top JavaScript errors across your fleet with affected session counts.", subTabs: null },
          { name: "Navigation & Flows", desc: "Five sub-tabs for deep navigation analysis:", subTabs: ["Navigation Paths — force-directed graph of page transitions + page performance table", "Sankey — multi-format flow diagram (Classic, Gradient, Directed, Alluvial, State Machine, Chord, Heatmap) with click-to-drill detail panel", "Geo Heatmap — Apdex and session counts by country", "Maps — interactive world choropleth + globe for geographic metrics", "Session Replay — sessions ranked by impact score"] },
          { name: "Cost & Ranking", desc: "Creative cost model: assigns $ estimates per byte, request, and RUM event to rank web apps by estimated infrastructure cost. Adjust rate assumptions live.", subTabs: null },
          { name: "Perf Budgets", desc: "Set custom thresholds for LCP, INP, CLS, TTFB, bytes/page, requests/page, and error rate. Each web app is graded pass/fail per metric.", subTabs: null },
          { name: "Hyperlyzer", desc: "Multidimensional radial exploration of a single web app across OS, browser, geo, and user action dimensions. Requires a specific app to be selected in the header.", subTabs: null },
          { name: "Action Backlog", desc: "Data-driven, cross-app list of recommended actions. Each item is generated by evaluating every app against CWV, error rate, and Apdex thresholds, then ranked by traffic × severity so you always know what to fix first.", subTabs: null },
        ].map(tab => (
          <div key={tab.name} style={{ padding: "10px 12px", background: "rgba(128,128,128,0.05)", borderRadius: 6, border: "1px solid rgba(128,128,128,0.12)" }}>
            <Strong style={{ fontSize: 13 }}>{tab.name}</Strong>
            <Text style={{ fontSize: 12, opacity: 0.8, display: "block", marginTop: 3 }}>{tab.desc}</Text>
            {tab.subTabs && (
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 12, opacity: 0.7, lineHeight: 1.7 }}>
                {tab.subTabs.map((st, i) => <li key={i}>{st}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <Strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>Header Controls</Strong>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.85 }}>
        <div><Strong>Web App filter</Strong> — scope all tabs to a specific application, or leave blank for fleet-wide view.</div>
        <div><Strong>Timeframe</Strong> — select data window from 2 hours to 90 days.</div>
        <div><Strong>Time-Lapse</Strong> — replay activity bucket-by-bucket. Rank tables animate with movement indicators and green/red flicker when apps change rank.</div>
        <div><Strong>Metric-Stream</Strong> — auto-refresh cadence for live monitoring.</div>
        <div><Strong>AI Assist</Strong> — context-aware analysis for the active tab: summary, color-coded insights, and prioritized recommendations with streaming animation.</div>
        <div><Strong>Settings</Strong> — show/hide tabs, adjust performance budget thresholds, configure grade weights, and select your industry for benchmark comparisons.</div>
      </div>
    </div>
  </Sheet>
);

// ---------------------------------------------------------------------------
// Settings panel — tab visibility toggles + perf budgets
// ---------------------------------------------------------------------------
const SettingsSheet: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => {
  const { tabVisibility, toggleTab, resetTabVisibility, budgets, setBudgets, gradeWeights, setGradeWeights, subTabVisibility, toggleSubTab, industry, setIndustry } = useSettings();
  const visibleCount = ALL_TABS.filter(t => tabVisibility[t] !== false).length;

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
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {([
              { name: "Executive Summary", sub: null },
              { name: "Performance Overview", sub: null },
              { name: "Opportunity Matrix", sub: "Full-width scatter of traffic × score — four action quadrants with Fix First ranking" },
              { name: "Errors & Reliability", sub: null },
              { name: "Navigation & Flows", sub: "nav-flows" },
              { name: "Cost & Ranking", sub: null },
              { name: "Perf Budgets", sub: null },
              { name: "Hyperlyzer", sub: "Requires a single web app selected in the header" },
              { name: "Action Backlog", sub: "Data-driven cross-app action list ranked by traffic × severity" },
            ] as { name: string; sub: string | null }[]).map(({ name, sub }) => (
              <div key={name}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }} onClick={() => toggleTab(name)}>
                  <Switch value={!!tabVisibility[name]} onChange={() => toggleTab(name)} />
                  <div style={{ paddingTop: 2 }}>
                    <span style={{ fontSize: 13, opacity: tabVisibility[name] ? 1 : 0.5, userSelect: "none" }}>{name}</span>
                    {sub && sub !== "nav-flows" && <Text style={{ fontSize: 11, opacity: 0.5, display: "block", marginTop: 1 }}>{sub}</Text>}
                  </div>
                </div>
                {sub === "nav-flows" && tabVisibility[name] && (
                  <div style={{ marginLeft: 38, marginTop: 6, display: "flex", flexDirection: "column", gap: 5, padding: "8px 10px", background: "rgba(128,128,128,0.04)", borderRadius: 6, border: "1px solid rgba(128,128,128,0.12)" }}>
                    <Text style={{ fontSize: 11, opacity: 0.5, marginBottom: 2 }}>Sub-tabs</Text>
                    {NAV_FLOWS_SUB_TABS.map(({ id, label }) => (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => toggleSubTab(id)}>
                        <Switch value={subTabVisibility[id] !== false} onChange={() => toggleSubTab(id)} />
                        <span style={{ fontSize: 12, opacity: subTabVisibility[id] !== false ? 0.9 : 0.4, userSelect: "none" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(128,128,128,0.15)", display: "flex", justifyContent: "flex-end" }}>
            <Button variant="default" onClick={resetTabVisibility}>Show all tabs</Button>
          </div>
        </div>

        {/* Industry benchmark */}
        <div style={{ marginBottom: 18, border: "1px solid rgba(69,137,255,0.25)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: "rgba(69,137,255,0.07)", borderBottom: "1px solid rgba(69,137,255,0.20)" }}>
            <Strong style={{ fontSize: 13 }}>Industry Benchmarks</Strong>
            <Text style={{ fontSize: 11, opacity: 0.65, display: "block", marginTop: 2 }}>
              Select your industry to compare CWV against typical peer medians on the Executive Summary.
            </Text>
          </div>
          <div style={{ padding: "12px 12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["", ...INDUSTRY_NAMES].map(ind => (
                <button
                  key={ind || "__none"}
                  onClick={() => setIndustry(ind)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                    background: industry === ind ? "rgba(69,137,255,0.18)" : "rgba(128,128,128,0.08)",
                    color: "inherit",
                    border: industry === ind ? "1px solid rgba(69,137,255,0.55)" : "1px solid rgba(128,128,128,0.25)",
                  }}
                >
                  {ind || "None"}
                </button>
              ))}
            </div>
            {industry && (
              <Text style={{ fontSize: 11, opacity: 0.55, display: "block", marginTop: 8 }}>
                Benchmarks will appear in Executive Summary → Industry Benchmarks section.
              </Text>
            )}
          </div>
        </div>

        {/* Grade weights */}
        {(() => {
          const total = Object.values(gradeWeights).reduce((a, v) => a + (Number(v) || 0), 0);
          const ok = Math.round(total) === 100;
          const WEIGHT_FIELDS: { key: keyof typeof gradeWeights; label: string }[] = [
            { key: "apdex",     label: "Apdex" },
            { key: "errorRate", label: "Error rate" },
            { key: "lcp",       label: "CWV — LCP" },
            { key: "inp",       label: "CWV — INP" },
            { key: "cls",       label: "CWV — CLS" },
            { key: "ttfb",      label: "CWV — TTFB" },
          ];
          return (
            <div style={{ marginBottom: 18, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", background: "rgba(128,128,128,0.08)", borderBottom: "1px solid rgba(128,128,128,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <Strong style={{ fontSize: 13 }}>Grade Weights</Strong>
                  <Text style={{ fontSize: 11, opacity: 0.65, display: "block", marginTop: 2 }}>
                    Weights used to compute the overall fleet grade. Must sum to 100%.
                  </Text>
                </div>
                <Button variant="default" onClick={() => setGradeWeights(DEFAULT_GRADE_WEIGHTS)}>Reset</Button>
              </div>
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                {WEIGHT_FIELDS.map(({ key, label }) => (
                  <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    <span style={{ opacity: 0.75 }}>{label} (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={gradeWeights[key]}
                      onChange={(e) => setGradeWeights({ ...gradeWeights, [key]: Number(e.target.value) })}
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
              <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(128,128,128,0.15)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, opacity: 0.65 }}>Total:</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: ok ? "var(--dt-colors-text-success-default, #0D9C29)" : "var(--dt-colors-text-critical-default, #C21930)" }}>
                  {total}% {ok ? "✓" : "✗ — must equal 100%"}
                </span>
              </div>
            </div>
          );
        })()}

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
  // Correlations: KpiCards auto-register their sparklines here; the panel opens on "Related Metrics".
  // Registry is keyed by label (last write wins) so we always show the freshest sparkline.
  const [correlationsRegistry, setCorrelationsRegistry] = useState<Record<string, RelatedMetricEntry>>({});
  const [correlationsTarget, setCorrelationsTarget] = useState<RelatedMetricEntry | null>(null);
  const registerCorrelations = useCallback((metrics: RelatedMetricEntry[]) => {
    setCorrelationsRegistry((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const m of metrics) {
        const existing = prev[m.label];
        // Compare by shallow sparkline reference / length to avoid infinite state churn
        if (!existing || existing.sparkline !== m.sparkline) { next[m.label] = m; changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);
  const openCorrelations = useCallback((target: RelatedMetricEntry) => setCorrelationsTarget(target), []);
  // Reset the registry when the tab or timeframe changes so stale sparklines don't persist.
  useEffect(() => { setCorrelationsRegistry({}); }, [tab, timeframeDays]);
  const correlationsCtxValue = useMemo(() => ({
    registry: Object.values(correlationsRegistry),
    register: registerCorrelations,
    open: openCorrelations,
  }), [correlationsRegistry, registerCorrelations, openCorrelations]);
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
    // Gap-fill: DQL bin() only returns buckets that contain data, so sparse
    // tenants or short activity windows produce far fewer rows than expected.
    // Generate every slot in the full query range and fill missing ones with
    // zeros so the hotness strip always shows the correct bucket count.
    const effectAnchor = timeframeAnchorMs(timeframeRaw);
    const rangeToMs    = effectAnchor != null ? effectAnchor : Date.now();
    const rangeFromMs  = rangeToMs - timeframeDays * 86400000;
    const alignedStart = Math.floor(rangeFromMs / bucketMs) * bucketMs;
    const gapFilled: SharedBucketMetrics[] = [];
    for (let slot = alignedStart; slot < rangeToMs; slot += bucketMs) {
      const match = parsed.find(p => Math.abs(p.fromMs - slot) < bucketMs * 0.5);
      gapFilled.push(match ?? {
        bucket: new Date(slot).toISOString(),
        fromMs: slot,
        toMs: slot + bucketMs,
        sessions: 0, totalActions: 0, avgDurationMs: 0, errorCount: 0, errorRate: 0,
        lcp: null, cls: null, inp: null, ttfb: null,
      });
    }

    tl.reportSharedMetrics(gapFilled);
    tl.reportBuckets(gapFilled.length, gapFilled[Math.min(tl.index, gapFilled.length - 1)]?.bucket);

    // Baselines: mean + std per metric
    const stats = (vals: number[]) => {
      const clean = vals.filter((v) => isFinite(v));
      if (clean.length < 2) return { mean: 0, std: 1 };
      const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
      const variance = clean.reduce((a, v) => a + (v - mean) ** 2, 0) / clean.length;
      return { mean, std: Math.max(1e-6, Math.sqrt(variance)) };
    };
    const errBase = stats(gapFilled.map((p) => p.errorRate));
    const durBase = stats(gapFilled.map((p) => p.avgDurationMs));
    const lcpBase = stats(gapFilled.map((p) => p.lcp ?? 0).filter((v) => v > 0));
    // Z-score per bucket: max(errZ, durZ, lcpZ). Only positive deviation = hot.
    const hot = gapFilled.map((p) => {
      const errZ = errBase.std > 0 ? (p.errorRate - errBase.mean) / errBase.std : 0;
      const durZ = durBase.std > 0 ? (p.avgDurationMs - durBase.mean) / durBase.std : 0;
      const lcpZ = lcpBase.std > 0 && p.lcp != null ? (p.lcp - lcpBase.mean) / lcpBase.std : 0;
      return Math.max(0, errZ, durZ, lcpZ);
    });
    tl.reportHotness(hot, "Shared KPIs Z-score");
  }, [tl.enabled, sharedTl.data, tl.bucket, timeframeDays, timeframeRaw]);

  const openForecast = useCallback<ForecastOpener>((label, sparkline, color) => {
    if (sparkline && sparkline.length > 1) setForecastModal({ label, sparkline, color });
  }, []);

  const aiContextValue = useMemo(() => ({ open: aiOpen, close: () => setAiOpen(false) }), [aiOpen]);

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
    <AIInsightsContext.Provider value={aiContextValue}>
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
        <CorrelationsContext.Provider value={correlationsCtxValue}>
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
        </CorrelationsContext.Provider>
      </ForecastProvider>

      <HelpSheet show={showHelp} onDismiss={() => setShowHelp(false)} />
      <SettingsSheet show={showSettings} onDismiss={() => setShowSettings(false)} />

      {correlationsTarget && (
        <CorrelationsPanel
          target={correlationsTarget}
          registry={correlationsCtxValue.registry}
          onClose={() => setCorrelationsTarget(null)}
        />
      )}

      {forecastModal && (
        <ForecastModal
          label={forecastModal.label}
          sparkline={forecastModal.sparkline}
          color={forecastModal.color}
          fromMs={fromMs}
          toMs={toMs}
          onClose={() => setForecastModal(null)}
          getRequeryData={async (analyzeDays, datapointMinutes) => {
            try {
              // Cap points to stay under query limit (5000 records)
              const maxPts = 4800;
              const requestedPts = Math.round(analyzeDays * 1440 / datapointMinutes);
              const effMins = requestedPts > maxPts
                ? Math.ceil(analyzeDays * 1440 / maxPts)
                : datapointMinutes;
              const snapMins = ([15, 30, 60, 120, 360, 720, 1440] as const).find((m) => m >= effMins) ?? 1440;
              const dpLabel = snapMins >= 1440 ? "1d" : snapMins >= 60 ? `${snapMins / 60}h` : `${snapMins}m`;

              const anchor = getQueryAnchorMs() ?? Date.now();
              const fromIso = new Date(anchor - analyzeDays * 86400000).toISOString();
              const toIso = new Date(anchor).toISOString();
              const sel = webAppFilter.selected;
              const esc = (s: string) => s.replace(/"/g, '\\"');
              const appFilt = !sel || sel.length === 0 ? ""
                : sel.length === 1 ? ` and frontend.name == "${esc(sel[0])}"`
                : ` and (${sel.map(s => `frontend.name == "${esc(s)}"`).join(" or ")})`;
              const lbl = forecastModal.label.toLowerCase();
              const isAct = `characteristics.classifier == "user_action" or characteristics.classifier == "user_interaction" or characteristics.classifier == "page_summary" or characteristics.classifier == "view_summary" or characteristics.classifier == "navigation"`;

              const query = `fetch user.events, from: "${fromIso}", to: "${toIso}"
| filter isNotNull(frontend.name)${appFilt}
| fieldsAdd bkt = bin(start_time, ${dpLabel}), isAct = ${isAct}, dur_ms = toDouble(duration) / 1000000.0
| summarize
    sessions = countDistinct(dt.rum.session.id),
    actions = countIf(isAct),
    errors = countIf(characteristics.has_error == true),
    sat = countIf(isAct and dur_ms <= 3000),
    tol = countIf(isAct and dur_ms > 3000 and dur_ms <= 12000),
    fru = countIf(isAct and dur_ms > 12000),
    avgDur = avg(if(isAct, dur_ms)),
    lcp = avg(toDouble(web_vitals.largest_contentful_paint) / 1000000.0),
    inp = avg(toDouble(web_vitals.interaction_to_next_paint) / 1000000.0),
    cls = avg(toDouble(web_vitals.cumulative_layout_shift)),
    ttfb = avg(toDouble(web_vitals.time_to_first_byte) / 1000000.0),
    loadEnd = avg(toDouble(performance.load_event_end) / 1000000.0),
    by:{bkt}
| sort bkt asc
| limit 5000`;

              const start = await queryExecutionClient.queryExecute({
                body: { query, requestTimeoutMilliseconds: 60000, maxResultRecords: 5000 },
              });
              let recs: any[];
              if (start.state === "SUCCEEDED") {
                recs = (start.result?.records ?? []) as any[];
              } else {
                const token = start.requestToken;
                if (!token) throw new Error("No query token");
                recs = [];
                for (let i = 0; i < 60; i++) {
                  await new Promise((r) => setTimeout(r, 1000));
                  const poll = await queryExecutionClient.queryPoll({ requestToken: token });
                  if (poll.state === "SUCCEEDED") { recs = (poll.result?.records ?? []) as any[]; break; }
                  if (poll.state === "FAILED" || poll.state === "CANCELLED") throw new Error(`Query ${poll.state}`);
                }
              }
              if (recs.length === 0) return forecastModal.sparkline;

              return recs.map((r): number => {
                let v: number;
                if (lbl.includes("error rate")) {
                  const a = Number(r.actions ?? 0);
                  v = a > 0 ? (Number(r.errors ?? 0) / a) * 100 : 0;
                } else if (lbl.includes("apdex")) {
                  const s = Number(r.sat ?? 0), t = Number(r.tol ?? 0), f = Number(r.fru ?? 0);
                  const d = s + t + f; v = d > 0 ? (s + t * 0.5) / d : 0;
                } else if (lbl.includes("satisfied")) { v = Number(r.sat ?? 0); }
                else if (lbl.includes("tolerating")) { v = Number(r.tol ?? 0); }
                else if (lbl.includes("frustrated")) { v = Number(r.fru ?? 0); }
                else if (lbl.includes("duration")) { v = Number(r.avgDur ?? 0); }
                else if (lbl.includes("lcp")) { v = Number(r.lcp ?? 0); }
                else if (lbl.includes("inp")) { v = Number(r.inp ?? 0); }
                else if (lbl.includes("cls")) { v = Number(r.cls ?? 0); }
                else if (lbl.includes("ttfb")) { v = Number(r.ttfb ?? 0); }
                else if (lbl.includes("load")) { v = Number(r.loadEnd ?? 0); }
                else if (lbl.includes("error")) { v = Number(r.errors ?? 0); }
                else if (lbl.includes("action")) { v = Number(r.actions ?? 0); }
                else { v = Number(r.sessions ?? 0); }
                return isFinite(v) ? v : 0;
              });
            } catch {
              return forecastModal.sparkline;
            }
          }}
        />
      )}
    </AIInsightsContext.Provider>
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
