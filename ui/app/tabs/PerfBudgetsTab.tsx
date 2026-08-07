import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings, DEFAULT_PERF_BUDGETS } from "../SettingsContext";
import { useDql } from "../useDql";
import { webVitalsPerAppQuery, resourceConsumptionQuery, errorsPerAppQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt } from "../components/layout";
import { GradePill } from "../components/GradeBadge";

// ---------------------------------------------------------------------------
// Perf Budgets — did each web app meet its budget for each metric?
// ---------------------------------------------------------------------------
export const PerfBudgetsTab: React.FC = () => {
  const { timeframeDays, webAppFilter, budgets, setBudgets } = useSettings();
  const sel = webAppFilter.selected;

  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const resources = useDql(resourceConsumptionQuery(timeframeDays, sel), [timeframeDays, sel]);
  const errs = useDql(errorsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);

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
      return { ...r, passed, total, score, checks };
    });
  }, [vitals.data, resources.data, errs.data, budgets]);

  const totalPassing = rows.filter((r) => r.total > 0 && r.passed === r.total).length;
  const totalFailing = rows.length - totalPassing;

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "score", header: "Compliance", accessor: "score", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <GradePill score={Number(value)} showScore /> },
    { id: "passed", header: "Passed", accessor: "passed", width: 90, sortType: "number" as any,
      cell: ({ row }: any) => (
        <span>
          <span style={{ color: "#0D9C29", fontWeight: 700 }}>{row.original.passed}</span>
          <span style={{ opacity: 0.6 }}> / {row.original.total}</span>
        </span>
      ) },
    { id: "lcp",              header: "LCP",           accessor: "lcp",             width: 90,  cell: mkCheckCell("lcp") },
    { id: "inp",              header: "INP",           accessor: "inp",             width: 90,  cell: mkCheckCell("inp") },
    { id: "cls",              header: "CLS",           accessor: "cls",             width: 90,  cell: mkCheckCell("cls") },
    { id: "ttfb",             header: "TTFB",          accessor: "ttfb",            width: 90,  cell: mkCheckCell("ttfb") },
    { id: "bytesPerPage",     header: "Bytes / page",  accessor: "bytesPerPage",    width: 110, cell: mkCheckCell("bytesPerPage") },
    { id: "requestsPerPage",  header: "Reqs / page",   accessor: "requestsPerPage", width: 100, cell: mkCheckCell("requestsPerPage") },
    { id: "errorRate",        header: "Error rate",    accessor: "errorRate",       width: 100, cell: mkCheckCell("errorRate") },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Web apps meeting all budgets" value={String(totalPassing)} rawValue={totalPassing} color="#0D9C29" higherIsBetter />
        <KpiCard label="Web apps missing ≥ 1 budget" value={String(totalFailing)} rawValue={totalFailing} color="#C21930" />
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
                style={{ padding: "4px 8px", background: "rgba(128,128,128,0.1)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, width: 100 }}
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
          <DataTable data={rows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};

function mkCheckCell(key: string) {
  return ({ row }: any) => {
    const chk = (row.original.checks ?? []).find((c: any) => c.key === key);
    if (!chk || !isFinite(chk.value)) return <span style={{ opacity: 0.4 }}>—</span>;
    const pass = chk.value <= chk.limit;
    const col = pass ? "#0D9C29" : "#C21930";
    const label = chk.unit === "ms" ? `${chk.value.toFixed(0)}ms`
      : chk.unit === "%" ? `${chk.value.toFixed(1)}%`
      : chk.unit === "B" ? (chk.value >= 1e6 ? `${(chk.value / 1e6).toFixed(1)}MB` : `${(chk.value / 1024).toFixed(0)}KB`)
      : chk.value < 1 ? chk.value.toFixed(2) : chk.value.toFixed(0);
    return (
      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: `${col}20`, color: col, fontWeight: 700, fontSize: 11 }} title={`limit: ${chk.limit}`}>
        {pass ? "✓" : "✗"} {label}
      </span>
    );
  };
}
