import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { geoPerAppQuery, deviceBreakdownQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Geo & Devices — where users come from + what they use.
// ---------------------------------------------------------------------------
export const GeoDevicesTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const geo = useDql(geoPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const devices = useDql(deviceBreakdownQuery(timeframeDays, sel), [timeframeDays, sel]);

  const geoRows = useMemo(() =>
    (geo.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      country: String(r.country ?? ""),
      sessions: Number(r.sessions ?? 0),
      users: Number(r.users ?? 0),
      errors: Number(r.errors ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
    })),
  [geo.data]);

  const deviceRows = useMemo(() =>
    (devices.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      browser: String(r.browserFamily ?? "Unknown"),
      os: String(r.osFamily ?? "Unknown"),
      deviceType: String(r.deviceType ?? "Unknown"),
      sessions: Number(r.sessions ?? 0),
      errors: Number(r.errors ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
    })),
  [devices.data]);

  const countries = new Set(geoRows.map((r) => r.country)).size;
  const topCountry = useMemo(() => {
    const agg: Record<string, number> = {};
    geoRows.forEach((r) => { agg[r.country] = (agg[r.country] ?? 0) + r.sessions; });
    const [name, count] = Object.entries(agg).sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    return { name, count };
  }, [geoRows]);
  const topBrowser = useMemo(() => {
    const agg: Record<string, number> = {};
    deviceRows.forEach((r) => { agg[r.browser] = (agg[r.browser] ?? 0) + r.sessions; });
    const [name, count] = Object.entries(agg).sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    return { name, count };
  }, [deviceRows]);

  const maxGeoSessions = Math.max(1, ...geoRows.map((r) => r.sessions));
  const geoCols: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "country", header: "Country", accessor: "country", width: 150 },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 200, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxGeoSessions} /> },
    { id: "users", header: "Users", accessor: "users", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "errors", header: "Errors", accessor: "errors", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span style={{ color: Number(value) > 0 ? "#C21930" : undefined }}>{fmt.num(Number(value))}</span> },
    { id: "avgDuration", header: "Avg duration", accessor: "avgDuration", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
  ], [maxGeoSessions]);

  const maxDevSessions = Math.max(1, ...deviceRows.map((r) => r.sessions));
  const devCols: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "browser", header: "Browser", accessor: "browser", width: 140 },
    { id: "os", header: "OS", accessor: "os", width: 130 },
    { id: "deviceType", header: "Device", accessor: "deviceType", width: 120 },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 200, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxDevSessions} color="#A56EFF" /> },
    { id: "errors", header: "Errors", accessor: "errors", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span style={{ color: Number(value) > 0 ? "#C21930" : undefined }}>{fmt.num(Number(value))}</span> },
    { id: "avgDuration", header: "Avg duration", accessor: "avgDuration", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
  ], [maxDevSessions]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Countries" value={String(countries)} rawValue={countries} color="#4589FF" />
        <KpiCard label="Top country" value={topCountry.name} subtext={`${fmt.num(topCountry.count)} sessions`} color="#08BDBA" />
        <KpiCard label="Top browser" value={topBrowser.name} subtext={`${fmt.num(topBrowser.count)} sessions`} color="#A56EFF" />
      </div>

      <SectionCard title="Geo breakdown — per Web App">
        {geo.loading ? <EmptyState loading /> : geoRows.length === 0 ? <EmptyState error={geo.error} /> : (
          <DataTable data={geoRows} columns={geoCols} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>

      <SectionCard title="Device / browser breakdown — per Web App">
        {devices.loading ? <EmptyState loading /> : deviceRows.length === 0 ? <EmptyState error={devices.error} /> : (
          <DataTable data={deviceRows} columns={devCols} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
