import React, { useMemo, useCallback } from "react";
import { useAIInsights, analyzePerfBudgets } from "../components/AIInsights";
import { useSettings, DEFAULT_PERF_BUDGETS } from "../SettingsContext";
import { useDql } from "../useDql";
import { webVitalsPerAppQuery, resourceConsumptionQuery, errorsPerAppQuery, webAppBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt } from "../components/layout";
import { GradePill } from "../components/GradeBadge";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useFleetSparklines } from "../hooks/useFleetSparklines";
import { useTimelapse } from "../TimelapseContext";

// ---------------------------------------------------------------------------
// Perf Budgets — did each web app meet its budget for each metric?
// ---------------------------------------------------------------------------
export const PerfBudgetsTab: React.FC = () => {
  const { timeframeDays, webAppFilter, budgets, setBudgets } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const resources = useDql(resourceConsumptionQuery(timeframeDays, sel), [timeframeDays, sel]);
  const errs = useDql(errorsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);
  const spk = useFleetSparklines(bucketed.data?.records);

  const rows = useMemo(() => {
    const byApp: Record<string, any> = {};
    (vitals.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application_name ?? r.application ?? "");
      byApp[app] = { application: app, lcp: Number(r.lcpAvg ?? NaN), inp: Number(r.inpAvg ?? NaN), cls: Number(r.clsAvg ?? NaN), ttfb: Number(r.ttfbAvg ?? NaN) };
    });
    (resources.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      byApp[app] = { ...(byApp[app] ?? { application: app }),
        bytesPerPage: Number(r.avgBytesPerView ?? 0),
        requestsPerPage: Number(r.avgRequestsPerView ?? 0),
      };
    });
    (errs.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      byApp[app] = { ...(byApp[app] ?? { application: app }), errorRate: Number(r.errorRate ?? 0) };
    });
    return Object.values(byApp).map((r: any) => {
      const checks = [
        { key: "lcp",              label: "LCP",           value: r.lcp,              limit: budgets.lcp_ms,           unit: "ms" },
        { key: "inp",              label: "INP",           value: r.inp,              limit: budgets.inp_ms,           unit: "ms" },
        { key: "cls",              label: "CLS",           value: r.cls,              limit: budgets.cls,              unit: "" },
        { key: "ttfb",             label: "TTFB",          value: r.ttfb,             limit: budgets.ttfb_ms,          unit: "ms" },
        { key: "bytesPerPage",     label: "Bytes / page",  value: r.bytesPerPage,     limit: budgets.bytesPerPage_kb * 1024, unit: "B" },
        { key: "requestsPerPage",  label: "Reqs / page",   value: r.requestsPerPage,  limit: budgets.requestsPerPage,  unit: "" },
        { key: "errorRate",        label: "Error rate",    value: r.errorRate,        limit: budgets.errorRate_pct,    unit: "%" },
      ];
      const applied = checks.filter((c) => isFinite(c.value));
      const passed = applied.filter((c) => c.value <= c.limit).length;
      const total = applied.length;
      const score = total > 0 ? (passed / total) * 100 : NaN;
      return { ...r, passed, total, score, checks, passedLabel: `${passed}/${total}` };
    });
  }, [vitals.data, resources.data, errs.data, budgets]);

  const totalPassing = rows.filter((r) => r.total > 0 && r.passed === r.total).length;
  const totalFailing = rows.length - totalPassing;

  const { panel: aiPanel } = useAIInsights(useCallback(() =>
    analyzePerfBudgets(
      rows.map((r) => ({ application: r.application, passed: r.passed, total: r.total, score: r.score })),
      rows.length,
    ),
  [rows]));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "score", header: "Compliance", accessor: "score", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <GradePill score={Number(value)} showScore /> },
    { id: "passed", header: "Passed", accessor: "passed", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        if (!isFinite(v)) return <span style={{ opacity: 0.4 }}>—</span>;
        return <span style={{ color: "#0D9C29", fontWeight: 700 }}>{v}</span>;
      } },
    { id: "lcp",              header: "LCP",           accessor: "lcp",             width: 90,  sortType: "number" as any, cell: mkBudgetCell(budgets.lcp_ms, "ms") },
    { id: "inp",              header: "INP",           accessor: "inp",             width: 90,  sortType: "number" as any, cell: mkBudgetCell(budgets.inp_ms, "ms") },
    { id: "cls",              header: "CLS",           accessor: "cls",             width: 90,  sortType: "number" as any, cell: mkBudgetCell(budgets.cls, "") },
    { id: "ttfb",             header: "TTFB",          accessor: "ttfb",            width: 90,  sortType: "number" as any, cell: mkBudgetCell(budgets.ttfb_ms, "ms") },
    { id: "bytesPerPage",     header: "Bytes / page",  accessor: "bytesPerPage",    width: 110, sortType: "number" as any, cell: mkBudgetCell(budgets.bytesPerPage_kb * 1024, "B") },
    { id: "requestsPerPage",  header: "Reqs / page",   accessor: "requestsPerPage", width: 100, sortType: "number" as any, cell: mkBudgetCell(budgets.requestsPerPage, "") },
    { id: "errorRate",        header: "Error rate",    accessor: "errorRate",       width: 100, sortType: "number" as any, cell: mkBudgetCell(budgets.errorRate_pct, "%") },
  ], [budgets]);

  // Bucketed movement data.
  const { bucketValuesBySort: appBucket } = useBucketedRanks({
    records: (bucketed.data?.records ?? []) as any[],
    rowKeyField: "application",
    bucketField: "bkt",
    metricFields: ["lcp", "inp", "cls", "ttfb", "errorRate", "sessions"],
  });
  const bucketBySort = useMemo(() => ({
    score: appBucket.errorRate ?? {},
    passed: appBucket.errorRate ?? {},
    lcp: appBucket.lcp ?? {},
    inp: appBucket.inp ?? {},
    cls: appBucket.cls ?? {},
    ttfb: appBucket.ttfb ?? {},
    errorRate: appBucket.errorRate ?? {},
    bytesPerPage: appBucket.sessions ?? {},
    requestsPerPage: appBucket.sessions ?? {},
  }), [appBucket]);
  const sortOptions: TLSortOption<any>[] = useMemo(() => [
    { value: "score",           label: "Compliance",    get: (r) => Number(r.score),           higherIsBetter: true },
    { value: "passed",          label: "Passed checks", get: (r) => Number(r.passed),          higherIsBetter: true },
    { value: "lcp",             label: "LCP",           get: (r) => Number(r.lcp),             higherIsBetter: false },
    { value: "inp",             label: "INP",           get: (r) => Number(r.inp),             higherIsBetter: false },
    { value: "cls",             label: "CLS",           get: (r) => Number(r.cls),             higherIsBetter: false },
    { value: "ttfb",            label: "TTFB",          get: (r) => Number(r.ttfb),            higherIsBetter: false },
    { value: "bytesPerPage",    label: "Bytes / page",  get: (r) => Number(r.bytesPerPage),    higherIsBetter: false },
    { value: "requestsPerPage", label: "Reqs / page",   get: (r) => Number(r.requestsPerPage), higherIsBetter: false },
    { value: "errorRate",       label: "Error rate",    get: (r) => Number(r.errorRate),       higherIsBetter: false },
  ], []);

  return (
    <div>
      {aiPanel}
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Web apps meeting all budgets" value={String(totalPassing)} rawValue={totalPassing} color="#0D9C29" higherIsBetter sparkline={spk?.apdex} />
        <KpiCard label="Web apps missing ≥ 1 budget" value={String(totalFailing)} rawValue={totalFailing} color="#C21930" sparkline={spk?.errorRate} />
      </div>

      <SectionCard title="Performance budgets" subtitle="Adjust each budget below. All rows re-evaluate live.">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11 }}>
          {[
            { key: "lcp_ms",           label: "LCP (ms)",           step: 100 },
            { key: "inp_ms",           label: "INP (ms)",           step: 10 },
            { key: "cls",              label: "CLS",                step: 0.01 },
            { key: "ttfb_ms",          label: "TTFB (ms)",          step: 50 },
            { key: "bytesPerPage_kb",  label: "Bytes / page (KB)",  step: 100 },
            { key: "requestsPerPage",  label: "Reqs / page",        step: 5 },
            { key: "errorRate_pct",    label: "Error rate (%)",     step: 0.1 },
          ].map((b) => (
            <label key={b.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ opacity: 0.7 }}>{b.label}</span>
              <input
                type="number"
                step={b.step}
                value={(budgets as any)[b.key]}
                onChange={(e) => setBudgets({ ...budgets, [b.key]: Number(e.target.value) })}
                style={{ padding: "4px 8px", background: "rgba(128,128,128,0.1)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, width: 100, color: "white" }}
              />
            </label>
          ))}
          <button
            onClick={() => setBudgets({ ...DEFAULT_PERF_BUDGETS })}
            style={{ alignSelf: "flex-end", padding: "6px 12px", background: "rgba(128,128,128,0.15)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, cursor: "pointer" }}
          >Reset</button>
        </div>
      </SectionCard>

      <SectionCard title="Budget compliance — per Web App" subtitle="Green cell = passes budget, red = misses. Compliance grade is passed / total checks.">
        {vitals.loading || resources.loading || errs.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState /> : (
          <TimelapseTable
            data={rows as any[]}
            columns={columns}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={sortOptions}
            defaultSort="score"
            bucketValuesBySort={bucketBySort}
          />
        )}
      </SectionCard>
    </div>
  );
};

function mkBudgetCell(limit: number, unit: string) {
  return ({ value }: any) => {
    const v = Number(value);
    if (!isFinite(v)) return <span style={{ opacity: 0.4 }}>—</span>;
    const pass = v <= limit;
    const col = pass ? "#0D9C29" : "#C21930";
    const label = unit === "ms" ? `${v.toFixed(0)}ms`
      : unit === "%" ? `${v.toFixed(1)}%`
      : unit === "B" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}MB` : `${(v / 1024).toFixed(0)}KB`)
      : v < 1 ? v.toFixed(2) : v.toFixed(0);
    return (
      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: `${col}20`, color: col, fontWeight: 700, fontSize: 11 }} title={`limit: ${limit}`}>
        {pass ? "✓" : "✗"} {label}
      </span>
    );
  };
}
