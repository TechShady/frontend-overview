import React, { useMemo } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webAppBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useFleetSparklines, useTlAppOverlay } from "../hooks/useFleetSparklines";
import { useTimelapse } from "../TimelapseContext";

// ---------------------------------------------------------------------------
// Traffic & Engagement — sessions, users, bounce, session duration per web app.
// ---------------------------------------------------------------------------
export const TrafficEngagementTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;
  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);
  const spk = useFleetSparklines(bucketed.data?.records);

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

  // Bucketed movement data.
  const { bucketValuesBySort } = useBucketedRanks({
    records: (bucketed.data?.records ?? []) as any[],
    rowKeyField: "application",
    bucketField: "bkt",
    metricFields: ["sessions", "users", "actions", "avgDuration"],
  });
  const bucketBySort = useMemo(() => ({
    sessions: bucketValuesBySort.sessions ?? {},
    users: bucketValuesBySort.users ?? {},
    actionsPerSession: bucketValuesBySort.actions ?? {},
    avgDuration: bucketValuesBySort.avgDuration ?? {},
  }), [bucketValuesBySort]);
  const sortOptions: TLSortOption<typeof rows[number]>[] = useMemo(() => [
    { value: "sessions",          label: "Sessions",             get: (r) => Number(r.sessions),          higherIsBetter: true },
    { value: "users",             label: "Users",                get: (r) => Number(r.users),             higherIsBetter: true },
    { value: "newUsersPct",       label: "New users %",          get: (r) => Number(r.newUsersPct),       higherIsBetter: true },
    { value: "actionsPerSession", label: "Actions / session",    get: (r) => Number(r.actionsPerSession), higherIsBetter: true },
    { value: "avgDuration",       label: "Avg session duration", get: (r) => Number(r.avgDuration),       higherIsBetter: true },
    { value: "bounceRate",        label: "Bounce rate",          get: (r) => Number(r.bounceRate),        higherIsBetter: false },
  ], []);

  const displayRows = useTlAppOverlay(rows, bucketed.data?.records, {
    keyField: "application", tlEnabled: tl.enabled, tlIndex: tl.index,
    fields: ["sessions", "users", "actions", "avgDuration"],
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Total sessions" value={fmt.num(totalSessions)} rawValue={totalSessions} prevRawValue={prevSessions} color="#4589FF" higherIsBetter sparkline={spk?.sessions} />
        <KpiCard label="Total users" value={fmt.num(totalUsers)} rawValue={totalUsers} prevRawValue={prevUsers} color="#08BDBA" higherIsBetter sparkline={spk?.users} />
        <KpiCard label="Busiest web app" value={busiest?.application ?? "—"} subtext={busiest ? `${fmt.num(busiest.sessions)} sessions` : ""} color="#A56EFF" rawValue={busiest?.sessions} sparkline={spk?.sessions} />
      </div>

      <SectionCard title="Traffic & engagement — per Web App">
        {sum.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={sum.error} /> : (
          <TimelapseTable
            data={displayRows}
            columns={columns}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={sortOptions}
            defaultSort="sessions"
            bucketValuesBySort={bucketBySort}
          />
        )}
      </SectionCard>
    </div>
  );
};
