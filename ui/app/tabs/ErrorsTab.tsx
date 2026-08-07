import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { errorsPerAppQuery, jsErrorsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Errors & Reliability tab
// ---------------------------------------------------------------------------
export const ErrorsTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const perApp = useDql(errorsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(errorsPerAppQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const jsErrs = useDql(jsErrorsQuery(timeframeDays, sel), [timeframeDays, sel]);

  const rows = useMemo(() =>
    (perApp.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      totalActions: Number(r.totalActions ?? 0),
      totalErrors: Number(r.totalErrors ?? 0),
      sessions: Number(r.sessions ?? 0),
      errSessions: Number(r.errSessions ?? 0),
      errorRate: Number(r.errorRate ?? 0),
      errSessionsPct: Number(r.errSessionsPct ?? 0),
    })),
  [perApp.data]);

  const prevBy = useMemo(() => {
    const out: Record<string, any> = {};
    (prev.data?.records ?? []).forEach((r: any) => { out[String(r.application)] = r; });
    return out;
  }, [prev.data]);

  const totalErrs = rows.reduce((a, r) => a + r.totalErrors, 0);
  const totalActions = rows.reduce((a, r) => a + r.totalActions, 0);
  const prevTotalErrs = Object.values(prevBy).reduce((a: number, r: any) => a + Number(r.totalErrors ?? 0), 0);
  const prevTotalActions = Object.values(prevBy).reduce((a: number, r: any) => a + Number(r.totalActions ?? 0), 0);

  const worst = rows.slice().sort((a, b) => b.errorRate - a.errorRate)[0];
  const maxErr = Math.max(1, ...rows.map((r) => r.totalErrors));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 220,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "totalErrors", header: "Errors", accessor: "totalErrors", width: 180, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxErr} color="#C21930" /> },
    { id: "errorRate", header: "Error rate", accessor: "errorRate", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 5 ? "#C21930" : v > 1 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 700 }}>{fmt.pct(v)}</span>;
      } },
    { id: "errSessionsPct", header: "Sessions w/ errors", accessor: "errSessionsPct", width: 150, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
    { id: "totalActions", header: "Total actions", accessor: "totalActions", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
  ], [maxErr]);

  const topJsErrors = useMemo(() =>
    (jsErrs.data?.records ?? []).slice(0, 50).map((r: any) => ({
      application: String(r.application ?? ""),
      errorMessage: String(r.errorMessage ?? "Unknown"),
      errors: Number(r.errors ?? 0),
      affectedSessions: Number(r.affectedSessions ?? 0),
    })),
  [jsErrs.data]);

  const jsColumns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 180 },
    { id: "errorMessage", header: "Error Message", accessor: "errorMessage", width: 500,
      cell: ({ value }: any) => (
        <span style={{ fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{String(value)}</span>
      ) },
    { id: "errors", header: "Occurrences", accessor: "errors", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => <span style={{ color: "#C21930", fontWeight: 700 }}>{fmt.num(Number(value))}</span> },
    { id: "affectedSessions", header: "Sessions affected", accessor: "affectedSessions", width: 140, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Total errors" value={fmt.num(totalErrs)} rawValue={totalErrs} prevRawValue={prevTotalErrs} color="#C21930" />
        <KpiCard label="Overall error rate" value={fmt.pct(totalActions > 0 ? (totalErrs / totalActions) * 100 : 0)}
          rawValue={totalActions > 0 ? (totalErrs / totalActions) * 100 : 0}
          prevRawValue={prevTotalActions > 0 ? (prevTotalErrs / prevTotalActions) * 100 : null}
          color="#C21930" />
        <KpiCard label="Worst web app" value={worst?.application ?? "—"} subtext={worst ? `${fmt.pct(worst.errorRate)} error rate` : ""} color="#FF832B" />
        <KpiCard label="Unique JS errors" value={fmt.num(topJsErrors.length)} rawValue={topJsErrors.length} color="#A56EFF" />
      </div>

      <SectionCard title="Error rate — per Web App" subtitle="Which web app is failing the most? Sort by error rate to find highest-impact issues.">
        {perApp.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={perApp.error} /> : (
          <DataTable data={rows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>

      <SectionCard title="Top JavaScript errors" subtitle="Most common error messages across selected web apps. Click a row to inspect (coming soon).">
        {jsErrs.loading ? <EmptyState loading /> : topJsErrors.length === 0 ? <EmptyState error={jsErrs.error} label="No RUM errors captured." /> : (
          <DataTable data={topJsErrors} columns={jsColumns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
