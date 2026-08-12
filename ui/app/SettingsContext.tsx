import React, { createContext, useContext, useState, useMemo, useEffect } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

// Every tab in the app in a single place — used both by App.tsx (rendering)
// and the Settings sheet (visibility toggles).
export const ALL_TABS: string[] = [
  "Executive Summary",
  "Performance Overview",
  "Opportunity Matrix",
  "Errors & Reliability",
  "Navigation & Flows",
  "Cost & Ranking",
  "Perf Budgets",
  "Hyperlyzer",
  "Action Backlog",
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

export type GradeWeights = {
  apdex: number;
  errorRate: number;
  lcp: number;
  inp: number;
  cls: number;
  ttfb: number;
};

export const DEFAULT_GRADE_WEIGHTS: GradeWeights = {
  apdex: 25,
  errorRate: 22,
  lcp: 20,
  inp: 16,
  cls: 10,
  ttfb: 7,
};

// Industry CWV benchmarks — typical P75 values (ms/unitless) from HTTP Archive / CrUX.
// Used by the Executive Summary to contextualise fleet metrics vs industry peers.
export type IndustryBenchmark = { lcp: number; inp: number; cls: number; ttfb: number };
export const INDUSTRY_BENCHMARKS: Record<string, IndustryBenchmark> = {
  "E-commerce":        { lcp: 3200, inp: 280, cls: 0.12, ttfb: 950 },
  "Finance":           { lcp: 2800, inp: 200, cls: 0.06, ttfb: 700 },
  "Media / News":      { lcp: 3800, inp: 320, cls: 0.18, ttfb: 1100 },
  "Technology / SaaS": { lcp: 2900, inp: 230, cls: 0.09, ttfb: 800 },
  "Government":        { lcp: 4200, inp: 360, cls: 0.15, ttfb: 1400 },
  "Healthcare":        { lcp: 3100, inp: 260, cls: 0.10, ttfb: 900 },
  "Travel":            { lcp: 3500, inp: 295, cls: 0.13, ttfb: 1000 },
  "Education":         { lcp: 3300, inp: 275, cls: 0.11, ttfb: 950 },
  "Retail / B2B":      { lcp: 2700, inp: 210, cls: 0.07, ttfb: 750 },
};
export const INDUSTRY_NAMES = Object.keys(INDUSTRY_BENCHMARKS);

type SettingsCtx = {
  timeframeDays: number;
  setTimeframeDays: (d: number) => void;
  webAppFilter: WebAppFilter;
  setWebAppFilter: (f: WebAppFilter) => void;
  refreshIntervalMs: number;
  setRefreshIntervalMs: (ms: number) => void;
  budgets: typeof DEFAULT_PERF_BUDGETS;
  setBudgets: (b: typeof DEFAULT_PERF_BUDGETS) => void;
  gradeWeights: GradeWeights;
  setGradeWeights: (w: GradeWeights) => void;
  industry: string;
  setIndustry: (s: string) => void;
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
  const [gradeWeights, setGradeWeights] = useState<GradeWeights>(DEFAULT_GRADE_WEIGHTS);
  const [industry, setIndustry] = useState<string>("");
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
      if (p.gradeWeights) setGradeWeights({ ...DEFAULT_GRADE_WEIGHTS, ...p.gradeWeights });
      if (typeof p.industry === "string") setIndustry(p.industry);
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
    saveState({ key: PREFS_KEY, body: { value: JSON.stringify({ timeframeDays, refreshIntervalMs, budgets, webAppFilter, gradeWeights, industry }) } });
  }, [timeframeDays, refreshIntervalMs, budgets, webAppFilter, gradeWeights, industry]);

  const toggleTab = (name: string) => setTabVisibility((v) => ({ ...v, [name]: !v[name] }));
  const resetTabVisibility = () => setTabVisibility(defaultTabVisibility());
  const toggleSubTab = (id: string) => setSubTabVisibility((v) => ({ ...v, [id]: !v[id] }));
  const resetSubTabVisibility = () => setSubTabVisibility(defaultSubTabVisibility());

  const value = useMemo(() => ({
    timeframeDays, setTimeframeDays,
    webAppFilter, setWebAppFilter,
    refreshIntervalMs, setRefreshIntervalMs,
    budgets, setBudgets,
    gradeWeights, setGradeWeights,
    industry, setIndustry,
    tabVisibility, setTabVisibility, toggleTab, resetTabVisibility,
    subTabVisibility, toggleSubTab, resetSubTabVisibility,
  }), [timeframeDays, webAppFilter, refreshIntervalMs, budgets, gradeWeights, industry, tabVisibility, subTabVisibility]);

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

export function periodClause(days: number, prev = false, prevPrev = false): string {
  const d = Math.max(0.0007, days); // ~1 min minimum
  const offset = prevPrev ? 2 : prev ? 1 : 0;
  if (CURRENT_ANCHOR_MS != null) {
    const durMs = d * 86400000;
    const to = CURRENT_ANCHOR_MS - offset * durMs;
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
  if (prevPrev) return `from: now()-${n * 3}${unit}, to: now()-${n * 2}${unit}`;
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
