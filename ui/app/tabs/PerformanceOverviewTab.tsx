import React, { useMemo, useCallback } from "react";
import { useAIInsights, analyzePerformanceOverview } from "../components/AIInsights";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webVitalsPerAppQuery, webAppBucketedMetricsQuery } from "../queries";
import { computeAppScore, computeFleetScore, PerAppSummary, PerAppVitals } from "../scoring";
import { KpiCard } from "../components/KpiCard";
import { GradeBadge, GradePill, gradeFromScore } from "../components/GradeBadge";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useFleetSparklines, useTlAppOverlay } from "../hooks/useFleetSparklines";
import { useTimelapse } from "../TimelapseContext";

// ---------------------------------------------------------------------------
// Performance Overview
// Consolidates the former Executive Summary + Web Vitals + Performance tabs.
// Fleet grade + all KPI cards + one per-app comparison table.
// ---------------------------------------------------------------------------

type EnrichedSummary = PerAppSummary & {
  avgDuration: number;
  p50Duration: number;
  p90Duration: number;
  apdex: number;
  satisfied: number;
  tolerating: number;
  frustrated: number;
};

type ExtendedVitals = PerAppVitals & {
  lcpP75: number;
  inpP75: number;
  clsP75: number;
  ttfbP75: number;
  fcpAvg: number;
  loadEndAvg: number;
  samples: number;
};

export const PerformanceOverviewTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);

  const summaries: EnrichedSummary[] = useMemo(() => {
    return (sum.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      sessions: Number(r.sessions ?? 0),
      users: Number(r.users ?? 0),
      actions: Number(r.actions ?? 0),
      errors: Number(r.errors ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      p50Duration: Number(r.p50Duration ?? 0),
      p90Duration: Number(r.p90Duration ?? 0),
      apdex: Number(r.apdex ?? 0),
      satisfied: Number(r.satisfied ?? 0),
      tolerating: Number(r.tolerating ?? 0),
      frustrated: Number(r.frustrated ?? 0),
      bounces: 0,
      newUsers: 0,
      errorRate: Number(r.errorRate ?? 0),
      bounceRate: 0,
    }));
  }, [sum.data]);

  const prevSummaries: Record<string, EnrichedSummary> = useMemo(() => {
    const out: Record<string, EnrichedSummary> = {};
    (prev.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      out[app] = {
        application: app,
        sessions: Number(r.sessions ?? 0),
        users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0),
        errors: Number(r.errors ?? 0),
        avgDuration: Number(r.avgDuration ?? 0),
        p50Duration: Number(r.p50Duration ?? 0),
        p90Duration: Number(r.p90Duration ?? 0),
        apdex: Number(r.apdex ?? 0),
        satisfied: Number(r.satisfied ?? 0),
        tolerating: Number(r.tolerating ?? 0),
        frustrated: Number(r.frustrated ?? 0),
        bounces: 0,
        newUsers: 0,
        errorRate: Number(r.errorRate ?? 0),
        bounceRate: 0,
      };
    });
    return out;
  }, [prev.data]);

  const vitalsByApp: Record<string, ExtendedVitals> = useMemo(() => {
    const out: Record<string, ExtendedVitals> = {};
    (vitals.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application_name ?? r.application ?? "");
      out[app] = {
        application: app,
        lcpAvg: Number(r.lcpAvg ?? NaN),
        lcpP75: Number(r.lcpP75 ?? NaN),
        inpAvg: Number(r.inpAvg ?? NaN),
        inpP75: Number(r.inpP75 ?? NaN),
        clsAvg: Number(r.clsAvg ?? NaN),
        clsP75: Number(r.clsP75 ?? NaN),
        ttfbAvg: Number(r.ttfbAvg ?? NaN),
        ttfbP75: Number(r.ttfbP75 ?? NaN),
        fcpAvg: Number(r.fcpAvg ?? NaN),
        loadEndAvg: Number(r.loadEndAvg ?? NaN),
        samples: Number(r.samples ?? 0),
      };
    });
    return out;
  }, [vitals.data]);

  const scoredRows = useMemo(() => {
    return summaries.map((s) => {
      const v = vitalsByApp[s.application];
      const { score } = computeAppScore(v, s);
      return { ...s, vitals: v, score };
    });
  }, [summaries, vitalsByApp]);

  const fleetScore = useMemo(() =>
    computeFleetScore(scoredRows.map((r) => ({ score: r.score, sessions: r.sessions }))),
  [scoredRows]);

  const prevFleetScore = useMemo(() => {
    const rows = summaries.map((s) => {
      const prevS = prevSummaries[s.application];
      const v = vitalsByApp[s.application];
      const { score } = computeAppScore(v, prevS);
      return { score, sessions: prevS?.sessions ?? 0 };
    });
    return computeFleetScore(rows);
  }, [summaries, prevSummaries, vitalsByApp]);

  // -----------------------------------------------------------------------
  // Fleet totals & session-weighted averages
  // -----------------------------------------------------------------------
  const totals = useMemo(() => {
    const T = { sessions: 0, users: 0, actions: 0, errors: 0, satisfied: 0, tolerating: 0, frustrated: 0,
                durWeighted: 0, durWeight: 0 };
    for (const r of scoredRows) {
      T.sessions += r.sessions;
      T.users += r.users;
      T.actions += r.actions;
      T.errors += r.errors;
      T.satisfied += r.satisfied;
      T.tolerating += r.tolerating;
      T.frustrated += r.frustrated;
      if (isFinite(r.avgDuration) && r.actions > 0) {
        T.durWeighted += r.avgDuration * r.actions;
        T.durWeight += r.actions;
      }
    }
    const apdexDen = T.satisfied + T.tolerating + T.frustrated;
    const apdex = apdexDen > 0 ? (T.satisfied + T.tolerating * 0.5) / apdexDen : NaN;
    const avgDur = T.durWeight > 0 ? T.durWeighted / T.durWeight : NaN;
    const errorRate = T.actions > 0 ? (T.errors / T.actions) * 100 : 0;
    return { ...T, apdex, avgDur, errorRate };
  }, [scoredRows]);

  const { panel: aiPanel } = useAIInsights(useCallback(() =>
    analyzePerformanceOverview(
      scoredRows.map((r) => ({
        application: r.application,
        lcp: r.vitals?.lcpAvg ?? NaN,
        inp: r.vitals?.inpAvg ?? NaN,
        cls: r.vitals?.clsAvg ?? NaN,
        apdex: r.apdex,
      })),
      totals.sessions,
    ),
  [scoredRows, totals.sessions]));

  const prevTotals = useMemo(() => {
    const T = { sessions: 0, actions: 0, errors: 0, satisfied: 0, tolerating: 0, frustrated: 0,
                durWeighted: 0, durWeight: 0 };
    for (const r of Object.values(prevSummaries)) {
      T.sessions += r.sessions;
      T.actions += r.actions;
      T.errors += r.errors;
      T.satisfied += r.satisfied;
      T.tolerating += r.tolerating;
      T.frustrated += r.frustrated;
      if (isFinite(r.avgDuration) && r.actions > 0) {
        T.durWeighted += r.avgDuration * r.actions;
        T.durWeight += r.actions;
      }
    }
    const apdexDen = T.satisfied + T.tolerating + T.frustrated;
    const apdex = apdexDen > 0 ? (T.satisfied + T.tolerating * 0.5) / apdexDen : NaN;
    const avgDur = T.durWeight > 0 ? T.durWeighted / T.durWeight : NaN;
    const errorRate = T.actions > 0 ? (T.errors / T.actions) * 100 : 0;
    return { ...T, apdex, avgDur, errorRate };
  }, [prevSummaries]);

  // Fleet Web Vitals — session-weighted averages
  const fleetVitals = useMemo(() => {
    let lcpN = 0, lcpW = 0, inpN = 0, inpW = 0, clsN = 0, clsW = 0,
        ttfbN = 0, ttfbW = 0, loadN = 0, loadW = 0;
    for (const r of scoredRows) {
      const v = r.vitals;
      if (!v) continue;
      const w = v.samples || r.sessions || 1;
      if (isFinite(v.lcpAvg)) { lcpN += v.lcpAvg * w; lcpW += w; }
      if (isFinite(v.inpAvg)) { inpN += v.inpAvg * w; inpW += w; }
      if (isFinite(v.clsAvg)) { clsN += v.clsAvg * w; clsW += w; }
      if (isFinite(v.ttfbAvg)) { ttfbN += v.ttfbAvg * w; ttfbW += w; }
      if (isFinite(v.loadEndAvg)) { loadN += v.loadEndAvg * w; loadW += w; }
    }
    return {
      lcp: lcpW > 0 ? lcpN / lcpW : NaN,
      inp: inpW > 0 ? inpN / inpW : NaN,
      cls: clsW > 0 ? clsN / clsW : NaN,
      ttfb: ttfbW > 0 ? ttfbN / ttfbW : NaN,
      loadEnd: loadW > 0 ? loadN / loadW : NaN,
    };
  }, [scoredRows]);

  // -----------------------------------------------------------------------
  // Per-app comparison table
  // -----------------------------------------------------------------------
  const tableRows = useMemo(() =>
    scoredRows.slice().sort((a, b) => b.sessions - a.sessions).map((r) => ({
      application: r.application,
      grade: r.score,
      sessions: r.sessions,
      users: r.users,
      actions: r.actions,
      errorRate: r.errorRate,
      avgDuration: r.avgDuration,
      apdex: r.apdex,
      lcp: r.vitals?.lcpAvg ?? NaN,
      inp: r.vitals?.inpAvg ?? NaN,
      cls: r.vitals?.clsAvg ?? NaN,
      ttfb: r.vitals?.ttfbAvg ?? NaN,
      loadEnd: r.vitals?.loadEndAvg ?? NaN,
    })),
  [scoredRows]);

  // Swap in per-bucket per-app values when TL is playing so the table matches KPI cards.
  const displayTableRows = useTlAppOverlay(tableRows, bucketed.data?.records, {
    keyField: "application", tlEnabled: tl.enabled, tlIndex: tl.index,
    fields: ["sessions", "users", "actions", "errorRate", "avgDuration", "apdex", "lcp", "inp", "cls", "ttfb", "loadEnd"],
  });

  const maxSessions = Math.max(1, ...displayTableRows.map((r) => r.sessions));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "grade", header: "Grade", accessor: "grade", width: 84, sortType: "number" as any,
      cell: ({ value }: any) => <GradePill score={Number(value)} showScore /> },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 140, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxSessions} color="#4589FF" /> },
    { id: "users", header: "Users", accessor: "users", width: 80, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "actions", header: "Actions", accessor: "actions", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "errorRate", header: "Error rate", accessor: "errorRate", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 5 ? "#C21930" : v > 1 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{fmt.pct(v)}</span>;
      } },
    { id: "avgDuration", header: "Duration", accessor: "avgDuration", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 6000 ? "#C21930" : v > 3000 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "apdex", header: "Apdex", accessor: "apdex", width: 84, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v >= 0.85 ? "#0D9C29" : v >= 0.7 ? "#F9A825" : "#C21930";
        return <span style={{ color: col, fontWeight: 600 }}>{isFinite(v) ? v.toFixed(2) : "—"}</span>;
      } },
    { id: "lcp", header: "LCP", accessor: "lcp", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 4000 ? "#C21930" : v > 2500 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "inp", header: "INP", accessor: "inp", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 500 ? "#C21930" : v > 200 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "cls", header: "CLS", accessor: "cls", width: 80, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 0.25 ? "#C21930" : v > 0.1 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{isFinite(v) ? v.toFixed(2) : "—"}</span>;
      } },
    { id: "ttfb", header: "TTFB", accessor: "ttfb", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 1800 ? "#C21930" : v > 800 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "loadEnd", header: "Load event end", accessor: "loadEnd", width: 120, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 5000 ? "#C21930" : v > 2500 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
  ], [maxSessions]);

  const loading = sum.loading || vitals.loading;

  // ---------------------------------------------------------------------
  // Bucketed metrics → Movement column
  // ---------------------------------------------------------------------
  const bucketedRecords = bucketed.data?.records ?? [];
  const { bucketValuesBySort } = useBucketedRanks({
    records: bucketedRecords as any[],
    rowKeyField: "application",
    bucketField: "bkt",
    metricFields: ["sessions", "users", "actions", "errors", "errorRate", "avgDuration", "apdex", "lcp", "inp", "cls", "ttfb", "loadEnd"],
  });

  // Sort → metric mapping. "grade" reuses "apdex" bucket data as a proxy since
  // grade is a composite score not computed per-bucket.
  const sortOptions: TLSortOption<typeof tableRows[number]>[] = useMemo(() => [
    { value: "grade",       label: "Grade",       get: (r) => Number(r.grade),       higherIsBetter: true },
    { value: "sessions",    label: "Sessions",    get: (r) => Number(r.sessions),    higherIsBetter: true },
    { value: "users",       label: "Users",       get: (r) => Number(r.users),       higherIsBetter: true },
    { value: "actions",     label: "Actions",     get: (r) => Number(r.actions),     higherIsBetter: true },
    { value: "errorRate",   label: "Error rate",  get: (r) => Number(r.errorRate),   higherIsBetter: false },
    { value: "avgDuration", label: "Duration",    get: (r) => Number(r.avgDuration), higherIsBetter: false },
    { value: "apdex",       label: "Apdex",       get: (r) => Number(r.apdex),       higherIsBetter: true },
    { value: "lcp",         label: "LCP",         get: (r) => Number(r.lcp),         higherIsBetter: false },
    { value: "inp",         label: "INP",         get: (r) => Number(r.inp),         higherIsBetter: false },
    { value: "cls",         label: "CLS",         get: (r) => Number(r.cls),         higherIsBetter: false },
    { value: "ttfb",        label: "TTFB",        get: (r) => Number(r.ttfb),        higherIsBetter: false },
    { value: "loadEnd",     label: "Load event end", get: (r) => Number(r.loadEnd),  higherIsBetter: false },
  ], []);

  // Alias "grade" → "apdex" bucketing (grade isn't computed per bucket).
  const bucketBySort = useMemo(() => {
    const out: Record<string, Record<string, (number | null)[]>> = { ...bucketValuesBySort };
    if (bucketValuesBySort.apdex) out.grade = bucketValuesBySort.apdex;
    return out;
  }, [bucketValuesBySort]);

  // -----------------------------------------------------------------------
  // Fleet sparklines — aggregate across apps per bucket.
  // -----------------------------------------------------------------------
  const fleetSparklines = useFleetSparklines(bucketedRecords);

  // When TL is on, KPI cards should show the current-bucket aggregate (animated).
  // Otherwise show timeframe totals.
  const tlIdx = tl.enabled && fleetSparklines ? Math.min(Math.max(tl.index, 0), fleetSparklines.buckets.length - 1) : -1;
  const kpi = useMemo(() => {
    if (tlIdx >= 0 && fleetSparklines) {
      const i = tlIdx;
      return {
        sessions: fleetSparklines.sessions[i],
        actions: fleetSparklines.actions[i],
        errors: fleetSparklines.errors[i],
        errorRate: fleetSparklines.errorRate[i],
        satisfied: fleetSparklines.satisfied[i],
        tolerating: fleetSparklines.tolerating[i],
        frustrated: fleetSparklines.frustrated[i],
        apdex: fleetSparklines.apdex[i],
        avgDur: fleetSparklines.avgDur[i],
        lcp: fleetSparklines.lcp[i],
        inp: fleetSparklines.inp[i],
        cls: fleetSparklines.cls[i],
        ttfb: fleetSparklines.ttfb[i],
        loadEnd: fleetSparklines.loadEnd[i],
      };
    }
    return {
      sessions: totals.sessions, actions: totals.actions, errors: totals.errors,
      errorRate: totals.errorRate, satisfied: totals.satisfied, tolerating: totals.tolerating,
      frustrated: totals.frustrated, apdex: totals.apdex, avgDur: totals.avgDur,
      lcp: fleetVitals.lcp, inp: fleetVitals.inp, cls: fleetVitals.cls,
      ttfb: fleetVitals.ttfb, loadEnd: fleetVitals.loadEnd,
    };
  }, [tlIdx, fleetSparklines, totals, fleetVitals]);
  const spk = fleetSparklines;

  return (
    <div>
      {aiPanel}
      {/* Unified 5-column KPI grid — Fleet Grade spans first column (all 3 rows), KPIs align in 5 equal columns */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "160px repeat(5, minmax(140px, 1fr))",
        gap: 10,
        padding: "20px 20px 4px",
        alignItems: "stretch",
      }}>
        {/* Fleet Grade — spans 3 rows */}
        <div style={{ gridColumn: "1 / 2", gridRow: "1 / span 3", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <GradeBadge score={fleetScore} size={92} label="Fleet Grade" />
          {isFinite(prevFleetScore) && (
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              prev: <span style={{ color: gradeFromScore(prevFleetScore).color, fontWeight: 700 }}>{gradeFromScore(prevFleetScore).letter}</span> ({prevFleetScore.toFixed(0)})
            </div>
          )}
        </div>

        {/* Row 1: Primary counters */}
        <KpiCard label="Web apps" value={String(scoredRows.length)} rawValue={scoredRows.length} color="#4589FF" sparkline={spk?.sessions.map(() => scoredRows.length)} />
        <KpiCard label="Sessions" value={fmt.num(kpi.sessions)} rawValue={kpi.sessions} prevRawValue={prevTotals.sessions} color="#4589FF" higherIsBetter sparkline={spk?.sessions} />
        <KpiCard label="Actions" value={fmt.num(kpi.actions)} rawValue={kpi.actions} prevRawValue={prevTotals.actions} color="#08BDBA" higherIsBetter sparkline={spk?.actions} />
        <KpiCard label="Errors" value={fmt.num(kpi.errors)} rawValue={kpi.errors} prevRawValue={prevTotals.errors} color="#C21930" sparkline={spk?.errors} />
        <KpiCard label="Error rate" value={fmt.pct(kpi.errorRate)} rawValue={kpi.errorRate} prevRawValue={isFinite(prevTotals.errorRate) ? prevTotals.errorRate : null} color="#C21930" sparkline={spk?.errorRate} />

        {/* Row 2: Performance & Apdex */}
        <KpiCard label="Avg session duration" value={fmt.ms(kpi.avgDur)} rawValue={isFinite(kpi.avgDur) ? kpi.avgDur : undefined} prevRawValue={isFinite(prevTotals.avgDur) ? prevTotals.avgDur : null} color="#4589FF" sparkline={spk?.avgDur} />
        <KpiCard label="Apdex" value={isFinite(kpi.apdex) ? kpi.apdex.toFixed(2) : "—"} rawValue={isFinite(kpi.apdex) ? kpi.apdex : undefined} prevRawValue={isFinite(prevTotals.apdex) ? prevTotals.apdex : null} color="#0D9C29" higherIsBetter sparkline={spk?.apdex} />
        <KpiCard label="Satisfied actions" value={fmt.num(kpi.satisfied)} rawValue={kpi.satisfied} prevRawValue={prevTotals.satisfied} color="#0D9C29" higherIsBetter sparkline={spk?.satisfied} />
        <KpiCard label="Tolerating actions" value={fmt.num(kpi.tolerating)} rawValue={kpi.tolerating} prevRawValue={prevTotals.tolerating} color="#F9A825" sparkline={spk?.tolerating} />
        <KpiCard label="Frustrated actions" value={fmt.num(kpi.frustrated)} rawValue={kpi.frustrated} prevRawValue={prevTotals.frustrated} color="#C21930" sparkline={spk?.frustrated} />

        {/* Row 3: Fleet Core Web Vitals */}
        <KpiCard label="Fleet LCP" value={fmt.ms(kpi.lcp)} rawValue={isFinite(kpi.lcp) ? kpi.lcp : undefined} color="#4589FF" subtext="target ≤ 2.5s" sparkline={spk?.lcp} />
        <KpiCard label="Fleet INP" value={fmt.ms(kpi.inp)} rawValue={isFinite(kpi.inp) ? kpi.inp : undefined} color="#08BDBA" subtext="target ≤ 200ms" sparkline={spk?.inp} />
        <KpiCard label="Fleet CLS" value={isFinite(kpi.cls) ? kpi.cls.toFixed(3) : "—"} rawValue={isFinite(kpi.cls) ? kpi.cls : undefined} color="#A56EFF" subtext="target ≤ 0.1" sparkline={spk?.cls} />
        <KpiCard label="Fleet TTFB" value={fmt.ms(kpi.ttfb)} rawValue={isFinite(kpi.ttfb) ? kpi.ttfb : undefined} color="#F9A825" subtext="target ≤ 800ms" sparkline={spk?.ttfb} />
        <KpiCard label="Load event end" value={fmt.ms(kpi.loadEnd)} rawValue={isFinite(kpi.loadEnd) ? kpi.loadEnd : undefined} color="#FF7A56" subtext="target ≤ 2.5s" sparkline={spk?.loadEnd} />
      </div>

      <SectionCard
        title="Per Web-App Comparison"
        subtitle={`Every RUM app broken down by grade, traffic, error rate, duration, Apdex, and all Core Web Vitals. ${scoredRows.length} apps evaluated.`}
      >
        {loading ? <EmptyState loading /> : tableRows.length === 0 ? <EmptyState /> : (
          <TimelapseTable
            data={displayTableRows}
            columns={columns}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={sortOptions}
            defaultSort="sessions"
            bucketValuesBySort={bucketBySort}
          />
        )}
      </SectionCard>

      <SectionCard title="How the grade is calculated">
        <div style={{ fontSize: 12, opacity: 0.85, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>Each web app's composite score is a weighted blend of six health signals. Higher is better.</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
            {[
              { label: "LCP", pct: "22%", target: "< 2.5s" },
              { label: "INP", pct: "18%", target: "< 200ms" },
              { label: "CLS", pct: "12%", target: "< 0.1" },
              { label: "TTFB", pct: "8%", target: "< 800ms" },
              { label: "Error rate", pct: "25%", target: "< 0.5%" },
              { label: "Bounce rate", pct: "15%", target: "< 30%" },
            ].map((p) => (
              <div key={p.label} style={{ padding: "6px 12px", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, fontSize: 11 }}>
                <div style={{ fontWeight: 700 }}>{p.label} <span style={{ opacity: 0.65 }}>({p.pct})</span></div>
                <div style={{ opacity: 0.7 }}>target: {p.target}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
