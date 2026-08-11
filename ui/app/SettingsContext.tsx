import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

// Every tab in the app in a single place — used both by App.tsx (rendering)
// and the Settings sheet (visibility toggles).
export const ALL_TABS: string[] = [
  "Executive Summary",
  "Performance Overview",
  "Errors & Reliability",
  "Navigation & Flows",
  "Cost & Ranking",
  "Perf Budgets",
  "Hyperlyzer",
];

export const NAV_FLOWS_SUB_TABS: { id: string; label: string }[] = [
  { id: "paths",  label: "Navigation Paths" },
  { id: "sankey", label: "Sankey" },
  { id: "geo",    label: "Geo Heatmap" },
  { id: "maps",   label: "Maps" },
  { id: "replay", label: "Session Replay" },
];

export const TIMEFRAME_OPTIONS: { label: string; value: number }[] = [
  { label: "Last 2 hours", value: 2 / 24 },
  { label: "Last 24 hours", value: 1 },
  { label: "Last 3 days", value: 3 },
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];
export const DEFAULT_TIMEFRAME_DAYS = 1;

export const REFRESH_OPTIONS: { label: string; value: number }[] = [
  { label: "Off", value: 0 },
  { label: "30 seconds", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "10 minutes", value: 600_000 },
];

export const CWV = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 },
  ttfb: { good: 800, poor: 1800 },
};

export const DEFAULT_PERF_BUDGETS = {
  lcp_ms: 2500,
  inp_ms: 200,
  cls: 0.1,
  ttfb_ms: 800,
  pageLoad_ms: 3000,
  errorRate_pct: 1.0,
  bytesPerPage_kb: 2000,
  requestsPerPage: 60,
  thirdPartyPct: 40,
};

export type WebAppFilter = { selected: string[] | null };

type SettingsCtx = {
  timeframeDays: number;
  setTimeframeDays: (d: number) => void;
  webAppFilter: WebAppFilter;
  setWebAppFilter: (f: WebAppFilter) => void;
  refreshIntervalMs: number;
  setRefreshIntervalMs: (ms: number) => void;
  budgets: typeof DEFAULT_PERF_BUDGETS;
  setBudgets: (b: typeof DEFAULT_PERF_BUDGETS) => void;
  tabVisibility: Record<string, boolean>;
  setTabVisibility: (v: Record<string, boolean>) => void;
  toggleTab: (name: string) => void;
  resetTabVisibility: () => void;
  subTabVisibility: Record<string, boolean>;
  toggleSubTab: (id: string) => void;
  resetSubTabVisibility: () => void;
};

const SettingsContext = createContext<SettingsCtx | null>(null);

const TAB_VIS_KEY = "fo-tab-visibility";
const PREFS_KEY = "fo-prefs-v1";
const SUB_TAB_VIS_KEY = "fo-subtab-vis";

function defaultTabVisibility(): Record<string, boolean> {
  const rec: Record<string, boolean> = {};
  ALL_TABS.forEach((t) => { rec[t] = true; });
  return rec;
}

function defaultSubTabVisibility(): Record<string, boolean> {
  const rec: Record<string, boolean> = {};
  NAV_FLOWS_SUB_TABS.forEach((t) => { rec[t.id] = true; });
  return rec;
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timeframeDays, setTimeframeDays] = useState<number>(DEFAULT_TIMEFRAME_DAYS);
  const [webAppFilter, setWebAppFilter] = useState<WebAppFilter>({ selected: null });
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(0);
  const [budgets, setBudgets] = useState(DEFAULT_PERF_BUDGETS);
  const [tabVisibility, setTabVisibility] = useState<Record<string, boolean>>(defaultTabVisibility);
  const [subTabVisibility, setSubTabVisibility] = useState<Record<string, boolean>>(defaultSubTabVisibility);

  const tabVisState = useUserAppState({ key: TAB_VIS_KEY });
  const subTabVisState = useUserAppState({ key: SUB_TAB_VIS_KEY });
  const prefsState = useUserAppState({ key: PREFS_KEY });
  const { execute: saveState } = useSetUserAppState();

  useEffect(() => {
    if (tabVisState.isLoading) return;
    const raw = tabVisState.data?.value;
    if (!raw) return;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      setTabVisibility({ ...defaultTabVisibility(), ...parsed });
    } catch { /* noop */ }
  }, [tabVisState.isLoading, tabVisState.data?.value]);

  useEffect(() => {
    if (prefsState.isLoading) return;
    const raw = prefsState.data?.value;
    if (!raw) return;
    try {
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (typeof p.timeframeDays === "number") setTimeframeDays(p.timeframeDays);
      if (typeof p.refreshIntervalMs === "number") setRefreshIntervalMs(p.refreshIntervalMs);
      if (p.budgets) setBudgets({ ...DEFAULT_PERF_BUDGETS, ...p.budgets });
      if (p.webAppFilter) {
        const waf = p.webAppFilter;
        // Migrate old persisted format (single string → array)
        if (typeof waf.selected === "string") {
          setWebAppFilter({ selected: [waf.selected] });
        } else {
          setWebAppFilter(waf);
        }
      }
    } catch { /* noop */ }
  }, [prefsState.isLoading, prefsState.data?.value]);

  useEffect(() => {
    if (subTabVisState.isLoading) return;
    const raw = subTabVisState.data?.value;
    if (!raw) return;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      setSubTabVisibility({ ...defaultSubTabVisibility(), ...parsed });
    } catch { /* noop */ }
  }, [subTabVisState.isLoading, subTabVisState.data?.value]);

  useEffect(() => {
    saveState({ key: TAB_VIS_KEY, body: { value: JSON.stringify(tabVisibility) } });
  }, [tabVisibility]);

  useEffect(() => {
    saveState({ key: SUB_TAB_VIS_KEY, body: { value: JSON.stringify(subTabVisibility) } });
  }, [subTabVisibility]);

  useEffect(() => {
    saveState({ key: PREFS_KEY, body: { value: JSON.stringify({ timeframeDays, refreshIntervalMs, budgets, webAppFilter }) } });
  }, [timeframeDays, refreshIntervalMs, budgets, webAppFilter]);

  const toggleTab = (name: string) => setTabVisibility((v) => ({ ...v, [name]: !v[name] }));
  const resetTabVisibility = () => setTabVisibility(defaultTabVisibility());
  const toggleSubTab = (id: string) => setSubTabVisibility((v) => ({ ...v, [id]: !v[id] }));
  const resetSubTabVisibility = () => setSubTabVisibility(defaultSubTabVisibility());

  const value = useMemo(() => ({
    timeframeDays, setTimeframeDays,
    webAppFilter, setWebAppFilter,
    refreshIntervalMs, setRefreshIntervalMs,
    budgets, setBudgets,
    tabVisibility, setTabVisibility, toggleTab, resetTabVisibility,
    subTabVisibility, toggleSubTab, resetSubTabVisibility,
  }), [timeframeDays, webAppFilter, refreshIntervalMs, budgets, tabVisibility, subTabVisibility]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

// When the TimeframeSelector arrow buttons shift the window into the past
// (e.g. `now-4h..now-2h`), we need queries to actually look at that shifted
// window. Track the current end anchor (epoch ms) at module scope so
// `periodClause` can emit absolute ISO timestamps, and query strings change
// when the user shifts the window (driving useDql refetch).
let CURRENT_ANCHOR_MS: number | null = null;
export function setQueryAnchorMs(ms: number | null) { CURRENT_ANCHOR_MS = ms; }
export function getQueryAnchorMs(): number | null { return CURRENT_ANCHOR_MS; }
function toIso(ms: number): string { return new Date(ms).toISOString(); }

export function periodClause(days: number, prev = false): string {
  const d = Math.max(0.0007, days); // ~1 min minimum
  if (CURRENT_ANCHOR_MS != null) {
    const durMs = d * 86400000;
    const to = prev ? CURRENT_ANCHOR_MS - durMs : CURRENT_ANCHOR_MS;
    const from = to - durMs;
    return `from: "${toIso(from)}", to: "${toIso(to)}"`;
  }
  // DQL rejects fractional duration units — emit integer h/m depending on size.
  const totalMinutes = Math.max(1, Math.round(d * 24 * 60));
  const unit = totalMinutes >= 24 * 60 && totalMinutes % (24 * 60) === 0 ? "d"
             : totalMinutes >= 60 && totalMinutes % 60 === 0 ? "h"
             : "m";
  const n = unit === "d" ? Math.round(totalMinutes / 1440)
          : unit === "h" ? Math.round(totalMinutes / 60)
          : totalMinutes;
  if (prev) return `from: now()-${n * 2}${unit}, to: now()-${n}${unit}`;
  return `from: now()-${n}${unit}`;
}

export function webAppFilterClause(selected: string[] | null, field = "application"): string {
  if (!selected || selected.length === 0) return "";
  if (selected.length > 50) return "";
  const esc = (s: string) => s.replace(/"/g, '\\"');
  if (selected.length === 1) return ` | filter ${field} == "${esc(selected[0])}"`;
  const conditions = selected.map(s => `${field} == "${esc(s)}"`).join(" or ");
  return ` | filter (${conditions})`;
}
