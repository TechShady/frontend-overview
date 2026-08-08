import React, { useMemo } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { geoPerAppQuery, deviceBreakdownQuery, geoBucketedMetricsQuery, deviceBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";

// ---------------------------------------------------------------------------
// Geo & Devices — where users come from + what they use.
// ---------------------------------------------------------------------------
export const GeoDevicesTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const geo = useDql(geoPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const devices = useDql(deviceBreakdownQuery(timeframeDays, sel), [timeframeDays, sel]);
  const geoBucketed = useDql(geoBucketedMetricsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const devBucketed = useDql(deviceBucketedMetricsQuery(timeframeDays, sel), [timeframeDays, sel]);

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

  // Bucketed movement data — geo keyed by country, remap onto app::country.
  const { bucketValuesBySort: geoBucket } = useBucketedRanks({
    records: (geoBucketed.data?.records ?? []) as any[],
    rowKeyField: "country",
    bucketField: "bkt",
    metricFields: ["sessions", "actions", "errors", "avgDuration"],
  });
  const geoBucketBySort = useMemo(() => {
    const remap = (src: Record<string, (number | null)[]>) => {
      const out: Record<string, (number | null)[]> = {};
      for (const r of geoRows) out[`${r.application}::${r.country}`] = src[r.country] ?? [];
      return out;
    };
    return {
      sessions: remap(geoBucket.sessions ?? {}),
      users: remap(geoBucket.sessions ?? {}),
      errors: remap(geoBucket.errors ?? {}),
      avgDuration: remap(geoBucket.avgDuration ?? {}),
    };
  }, [geoBucket, geoRows]);
  const geoSortOptions: TLSortOption<typeof geoRows[number]>[] = useMemo(() => [
    { value: "sessions",    label: "Sessions",     get: (r) => Number(r.sessions),    higherIsBetter: true },
    { value: "users",       label: "Users",        get: (r) => Number(r.users),       higherIsBetter: true },
    { value: "errors",      label: "Errors",       get: (r) => Number(r.errors),      higherIsBetter: false },
    { value: "avgDuration", label: "Avg duration", get: (r) => Number(r.avgDuration), higherIsBetter: false },
  ], []);

  // Bucketed device data — keyed by device type.
  const { bucketValuesBySort: devBucket } = useBucketedRanks({
    records: (devBucketed.data?.records ?? []) as any[],
    rowKeyField: "device",
    bucketField: "bkt",
    metricFields: ["sessions", "actions", "errors", "avgDuration"],
  });
  const devBucketBySort = useMemo(() => {
    const remap = (src: Record<string, (number | null)[]>) => {
      const out: Record<string, (number | null)[]> = {};
      for (const r of deviceRows) {
        const k = `${r.application}::${r.browser}::${r.os}::${r.deviceType}`;
        out[k] = src[r.deviceType] ?? [];
      }
      return out;
    };
    return {
      sessions: remap(devBucket.sessions ?? {}),
      errors: remap(devBucket.errors ?? {}),
      avgDuration: remap(devBucket.avgDuration ?? {}),
    };
  }, [devBucket, deviceRows]);
  const devSortOptions: TLSortOption<typeof deviceRows[number]>[] = useMemo(() => [
    { value: "sessions",    label: "Sessions",     get: (r) => Number(r.sessions),    higherIsBetter: true },
    { value: "errors",      label: "Errors",       get: (r) => Number(r.errors),      higherIsBetter: false },
    { value: "avgDuration", label: "Avg duration", get: (r) => Number(r.avgDuration), higherIsBetter: false },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Countries" value={String(countries)} rawValue={countries} color="#4589FF" />
        <KpiCard label="Top country" value={topCountry.name} subtext={`${fmt.num(topCountry.count)} sessions`} color="#08BDBA" />
        <KpiCard label="Top browser" value={topBrowser.name} subtext={`${fmt.num(topBrowser.count)} sessions`} color="#A56EFF" />
      </div>

      <SectionCard title="Geo breakdown — per Web App">
        {geo.loading ? <EmptyState loading /> : geoRows.length === 0 ? <EmptyState error={geo.error} /> : (
          <TimelapseTable
            data={geoRows}
            columns={geoCols}
            rowKey={(r: any) => `${r.application}::${r.country}`}
            firstColumnField="application"
            sortOptions={geoSortOptions}
            defaultSort="sessions"
            bucketValuesBySort={geoBucketBySort}
          />
        )}
      </SectionCard>

      <SectionCard title="Device / browser breakdown — per Web App">
        {devices.loading ? <EmptyState loading /> : deviceRows.length === 0 ? <EmptyState error={devices.error} /> : (
          <TimelapseTable
            data={deviceRows}
            columns={devCols}
            rowKey={(r: any) => `${r.application}::${r.browser}::${r.os}::${r.deviceType}`}
            firstColumnField="application"
            sortOptions={devSortOptions}
            defaultSort="sessions"
            bucketValuesBySort={devBucketBySort}
          />
        )}
      </SectionCard>
    </div>
  );
};
