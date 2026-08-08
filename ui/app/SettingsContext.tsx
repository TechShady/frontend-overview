import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

// Every tab in the app in a single place — used both by App.tsx (rendering)
// and the Settings sheet (visibility toggles).
export const ALL_TABS: string[] = [
  "Executive Summary",
  "Performance Overview",
  "Errors & Reliability",
  "Navigation & Flows",
  "Resource Consumption",
  "Cost & Ranking",
  "Traffic & Engagement",
  "Geo & Devices",
  "Perf Budgets",
  "Hyperlyzer",
  "Problems",
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

export type WebAppFilter = { selected: string | null };

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
};

const SettingsContext = createContext<SettingsCtx | null>(null);

const TAB_VIS_KEY = "fo-tab-visibility";
const PREFS_KEY = "fo-prefs-v1";

function defaultTabVisibility(): Record<string, boolean> {
  const rec: Record<string, boolean> = {};
  ALL_TABS.forEach((t) => { rec[t] = true; });
  return rec;
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timeframeDays, setTimeframeDays] = useState<number>(DEFAULT_TIMEFRAME_DAYS);
  const [webAppFilter, setWebAppFilter] = useState<WebAppFilter>({ selected: null });
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(0);
  const [budgets, setBudgets] = useState(DEFAULT_PERF_BUDGETS);
  const [tabVisibility, setTabVisibility] = useState<Record<string, boolean>>(defaultTabVisibility);

  const tabVisState = useUserAppState({ key: TAB_VIS_KEY });
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
      if (p.webAppFilter) setWebAppFilter(p.webAppFilter);
    } catch { /* noop */ }
  }, [prefsState.isLoading, prefsState.data?.value]);

  useEffect(() => {
    saveState({ key: TAB_VIS_KEY, body: { value: JSON.stringify(tabVisibility) } });
  }, [tabVisibility]);

  useEffect(() => {
    saveState({ key: PREFS_KEY, body: { value: JSON.stringify({ timeframeDays, refreshIntervalMs, budgets, webAppFilter }) } });
  }, [timeframeDays, refreshIntervalMs, budgets, webAppFilter]);

  const toggleTab = (name: string) => setTabVisibility((v) => ({ ...v, [name]: !v[name] }));
  const resetTabVisibility = () => setTabVisibility(defaultTabVisibility());

  const value = useMemo(() => ({
    timeframeDays, setTimeframeDays,
    webAppFilter, setWebAppFilter,
    refreshIntervalMs, setRefreshIntervalMs,
    budgets, setBudgets,
    tabVisibility, setTabVisibility, toggleTab, resetTabVisibility,
  }), [timeframeDays, webAppFilter, refreshIntervalMs, budgets, tabVisibility]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

export function periodClause(days: number, prev = false): string {
  // Emit relative timeframes using DQL `now()` so the query string is stable
  // across renders — otherwise the SDK's useDql refires on every render.
  const d = Math.max(0.0007, days); // ~1 min minimum
  if (prev) return `from: now()-${d * 2}d, to: now()-${d}d`;
  return `from: now()-${d}d`;
}

export function webAppFilterClause(selected: string | null, field = "application"): string {
  if (!selected) return "";
  const safe = selected.replace(/"/g, '\\"');
  return ` | filter ${field} == "${safe}"`;
}
