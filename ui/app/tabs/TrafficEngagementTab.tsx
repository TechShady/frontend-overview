import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Traffic & Engagement — sessions, users, bounce, session duration per web app.
// ---------------------------------------------------------------------------
export const TrafficEngagementTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);

  const rows = useMemo(() =>
    (sum.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      sessions: Number(r.sessions ?? 0),
      users: Number(r.users ?? 0),
      newUsers: Number(r.newUsers ?? 0),
      actions: Number(r.actions ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      bounceRate: Number(r.bounceRate ?? 0),
      actionsPerSession: Number(r.sessions ?? 0) > 0 ? Number(r.actions ?? 0) / Number(r.sessions ?? 0) : 0,
      newUsersPct: Number(r.sessions ?? 0) > 0 ? (Number(r.newUsers ?? 0) / Number(r.sessions ?? 0)) * 100 : 0,
    })),
  [sum.data]);

  const prevBy = useMemo(() => {
    const out: Record<string, any> = {};
    (prev.data?.records ?? []).forEach((r: any) => { out[String(r.application)] = r; });
    return out;
  }, [prev.data]);

  const totalSessions = rows.reduce((a, r) => a + r.sessions, 0);
  const totalUsers = rows.reduce((a, r) => a + r.users, 0);
  const prevSessions = Object.values(prevBy).reduce((a: number, r: any) => a + Number(r.sessions ?? 0), 0);
  const prevUsers = Object.values(prevBy).reduce((a: number, r: any) => a + Number(r.users ?? 0), 0);
  const busiest = rows.slice().sort((a, b) => b.sessions - a.sessions)[0];

  const maxSessions = Math.max(1, ...rows.map((r) => r.sessions));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 200, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxSessions} /> },
    { id: "users", header: "Users", accessor: "users", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "newUsersPct", header: "New users %", accessor: "newUsersPct", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
    { id: "actionsPerSession", header: "Actions / session", accessor: "actionsPerSession", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{Number(value).toFixed(1)}</span> },
    { id: "avgDuration", header: "Avg session duration", accessor: "avgDuration", width: 150, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
    { id: "bounceRate", header: "Bounce rate", accessor: "bounceRate", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 60 ? "#C21930" : v > 30 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{fmt.pct(v)}</span>;
      } },
  ], [maxSessions]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Total sessions" value={fmt.num(totalSessions)} rawValue={totalSessions} prevRawValue={prevSessions} color="#4589FF" higherIsBetter />
        <KpiCard label="Total users" value={fmt.num(totalUsers)} rawValue={totalUsers} prevRawValue={prevUsers} color="#08BDBA" higherIsBetter />
        <KpiCard label="Busiest web app" value={busiest?.application ?? "—"} subtext={busiest ? `${fmt.num(busiest.sessions)} sessions` : ""} color="#A56EFF" />
      </div>

      <SectionCard title="Traffic & engagement — per Web App">
        {sum.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={sum.error} /> : (
          <DataTable data={rows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
