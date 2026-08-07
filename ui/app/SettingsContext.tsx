import React, { createContext, useContext, useState, useMemo, useEffect } from "react";

// ---------------------------------------------------------------------------
// Timeframe options (whole app operates on these day-window values)
// ---------------------------------------------------------------------------
export const TIMEFRAME_OPTIONS: { label: string; value: number }[] = [
  { label: "Last 2 hours", value: 2 / 24 },
  { label: "Last 24 hours", value: 1 },
  { label: "Last 3 days", value: 3 },
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];
export const DEFAULT_TIMEFRAME_DAYS = 1;

// Web Vitals thresholds (Google recommended)
export const CWV = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 },
  ttfb: { good: 800, poor: 1800 },
};

// Perf budgets — used across tabs
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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export type WebAppFilter = {
  // "all" = compare across every web app; otherwise show a single selected app
  selected: string | null; // application.name or entity id
};

type SettingsCtx = {
  timeframeDays: number;
  setTimeframeDays: (d: number) => void;
  webAppFilter: WebAppFilter;
  setWebAppFilter: (f: WebAppFilter) => void;
  budgets: typeof DEFAULT_PERF_BUDGETS;
  setBudgets: (b: typeof DEFAULT_PERF_BUDGETS) => void;
};

const SettingsContext = createContext<SettingsCtx | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timeframeDays, setTimeframeDays] = useState<number>(DEFAULT_TIMEFRAME_DAYS);
  const [webAppFilter, setWebAppFilter] = useState<WebAppFilter>({ selected: null });
  const [budgets, setBudgets] = useState(DEFAULT_PERF_BUDGETS);

  // Persist a couple of user prefs in localStorage as a lightweight fallback
  // (a full user-app-state hook could be swapped in later).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fo-settings");
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.timeframeDays === "number") setTimeframeDays(p.timeframeDays);
        if (p.budgets) setBudgets({ ...DEFAULT_PERF_BUDGETS, ...p.budgets });
      }
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("fo-settings", JSON.stringify({ timeframeDays, budgets })); } catch { /* noop */ }
  }, [timeframeDays, budgets]);

  const value = useMemo(() => ({
    timeframeDays, setTimeframeDays,
    webAppFilter, setWebAppFilter,
    budgets, setBudgets,
  }), [timeframeDays, webAppFilter, budgets]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// DQL helpers — build a period clause the whole app can reuse
// ---------------------------------------------------------------------------
export function periodClause(days: number, prev = false): string {
  const durMs = Math.max(60_000, Math.round(days * 86_400_000));
  const now = Date.now();
  const to = prev ? now - durMs : now;
  const from = to - durMs;
  return `from: "${new Date(from).toISOString()}", to: "${new Date(to).toISOString()}"`;
}

// Optionally scope a query to a single web app. Called after `fetch ...`
// with the identifier field that carries the app name (usually `application`).
export function webAppFilterClause(selected: string | null, field = "application"): string {
  if (!selected) return "";
  const safe = selected.replace(/"/g, '\\"');
  return ` | filter ${field} == "${safe}"`;
}
