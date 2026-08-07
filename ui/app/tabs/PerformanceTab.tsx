import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Performance — latency / duration per web app.
// ---------------------------------------------------------------------------
export const PerformanceTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);

  const rows = useMemo(() =>
    (sum.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      sessions: Number(r.sessions ?? 0),
      actions: Number(r.actions ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      actionsPerSession: Number(r.sessions ?? 0) > 0 ? Number(r.actions ?? 0) / Number(r.sessions ?? 0) : 0,
    })),
  [sum.data]);

  const prevBy = useMemo(() => {
    const out: Record<string, any> = {};
    (prev.data?.records ?? []).forEach((r: any) => { out[String(r.application)] = r; });
    return out;
  }, [prev.data]);

  const fleetAvgDur = rows.length ? rows.reduce((a, r) => a + r.avgDuration * r.sessions, 0) / Math.max(1, rows.reduce((a, r) => a + r.sessions, 0)) : NaN;
  const prevFleetAvgDur = useMemo(() => {
    const arr = Object.values(prevBy) as any[];
    const total = arr.reduce((a, r) => a + Number(r.sessions ?? 0), 0);
    if (total === 0) return null;
    return arr.reduce((a, r) => a + Number(r.avgDuration ?? 0) * Number(r.sessions ?? 0), 0) / total;
  }, [prevBy]);

  const slowest = rows.slice().sort((a, b) => b.avgDuration - a.avgDuration)[0];
  const fastest = rows.slice().filter((r) => r.avgDuration > 0).sort((a, b) => a.avgDuration - b.avgDuration)[0];

  const maxDur = Math.max(1, ...rows.map((r) => r.avgDuration));
  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 220,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "avgDuration", header: "Avg Session Duration", accessor: "avgDuration", width: 240, sortType: "number" as any,
      cell: ({ value }: any) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(128,128,128,0.2)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (Number(value) / maxDur) * 100)}%`, height: "100%", background: "#4589FF" }} />
          </div>
          <div style={{ minWidth: 70, textAlign: "right" }}>{fmt.ms(Number(value))}</div>
        </div>
      ) },
    { id: "actionsPerSession", header: "Actions / Session", accessor: "actionsPerSession", width: 140, sortType: "number" as any,
      cell: ({ value }: any) => <span>{Number(value).toFixed(1)}</span> },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 120, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
  ], [maxDur]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Fleet avg session duration" value={fmt.ms(fleetAvgDur)} rawValue={fleetAvgDur} prevRawValue={prevFleetAvgDur} color="#4589FF" />
        <KpiCard label="Fastest web app" value={fastest?.application ?? "—"} subtext={fastest ? fmt.ms(fastest.avgDuration) : ""} color="#0D9C29" />
        <KpiCard label="Slowest web app" value={slowest?.application ?? "—"} subtext={slowest ? fmt.ms(slowest.avgDuration) : ""} color="#C21930" />
      </div>

      <SectionCard title="Session duration — per Web App" subtitle="Sort by any column. Session duration blends load performance with in-session activity.">
        {sum.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={sum.error} /> : (
          <DataTable data={rows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
