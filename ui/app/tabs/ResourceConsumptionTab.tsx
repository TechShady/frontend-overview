import React, { useMemo } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { resourceConsumptionQuery, thirdPartyImpactQuery, webAppBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";

// ---------------------------------------------------------------------------
// Resource Consumption — the "who's eating the most bytes / requests" tab.
// This is a key new focus for the Frontend Overview app.
// ---------------------------------------------------------------------------
export const ResourceConsumptionTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const consumption = useDql(resourceConsumptionQuery(timeframeDays, sel), [timeframeDays, sel]);
  const thirdParty = useDql(thirdPartyImpactQuery(timeframeDays, sel), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel), [timeframeDays, sel]);

  const rows = useMemo(() =>
    (consumption.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      pageViews: Number(r.pageViews ?? 0),
      totalBytes: Number(r.totalBytes ?? 0),
      totalRequests: Number(r.totalRequests ?? 0),
      avgBytesPerView: Number(r.avgBytesPerView ?? 0),
      avgRequestsPerView: Number(r.avgRequestsPerView ?? 0),
      avgDomComplete: Number(r.avgDomComplete ?? 0),
    })),
  [consumption.data]);

  const totalBytes = rows.reduce((a, r) => a + r.totalBytes, 0);
  const totalRequests = rows.reduce((a, r) => a + r.totalRequests, 0);
  const totalViews = rows.reduce((a, r) => a + r.pageViews, 0);
  const heaviest = rows.slice().sort((a, b) => b.totalBytes - a.totalBytes)[0];
  const chattiest = rows.slice().sort((a, b) => b.totalRequests - a.totalRequests)[0];
  const worstAvg = rows.slice().sort((a, b) => b.avgBytesPerView - a.avgBytesPerView)[0];

  const maxBytes = Math.max(1, ...rows.map((r) => r.totalBytes));
  const maxReq = Math.max(1, ...rows.map((r) => r.totalRequests));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "pageViews", header: "Page views", accessor: "pageViews", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "totalBytes", header: "Total bytes downloaded", accessor: "totalBytes", width: 230, sortType: "number" as any,
      cell: ({ value }: any) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(128,128,128,0.2)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (Number(value) / maxBytes) * 100)}%`, height: "100%", background: "#FF832B" }} />
          </div>
          <div style={{ minWidth: 70, textAlign: "right", fontWeight: 600 }}>{fmt.bytes(Number(value))}</div>
        </div>
      ) },
    { id: "totalRequests", header: "Total requests", accessor: "totalRequests", width: 200, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxReq} color="#A56EFF" /> },
    { id: "avgBytesPerView", header: "Bytes / page", accessor: "avgBytesPerView", width: 120, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 3_000_000 ? "#C21930" : v > 1_500_000 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{fmt.bytes(v)}</span>;
      } },
    { id: "avgRequestsPerView", header: "Reqs / page", accessor: "avgRequestsPerView", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 100 ? "#C21930" : v > 60 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{v.toFixed(0)}</span>;
      } },
    { id: "avgDomComplete", header: "DOM Complete", accessor: "avgDomComplete", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
  ], [maxBytes, maxReq]);

  // Third-party
  const tpRows = useMemo(() =>
    (thirdParty.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      totalActions: Number(r.totalActions ?? 0),
      totalBytes: Number(r.totalBytes ?? 0),
      thirdPartyBytes: Number(r.thirdPartyBytes ?? 0),
      thirdPartyRequests: Number(r.thirdPartyRequests ?? 0),
      thirdPartyBytesPct: Number(r.thirdPartyBytesPct ?? 0),
    })),
  [thirdParty.data]);

  const maxTpBytes = Math.max(1, ...tpRows.map((r) => r.thirdPartyBytes));
  const tpCols: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "thirdPartyBytes", header: "3rd-party bytes", accessor: "thirdPartyBytes", width: 240, sortType: "number" as any,
      cell: ({ value }: any) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(128,128,128,0.2)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (Number(value) / maxTpBytes) * 100)}%`, height: "100%", background: "#08BDBA" }} />
          </div>
          <div style={{ minWidth: 70, textAlign: "right" }}>{fmt.bytes(Number(value))}</div>
        </div>
      ) },
    { id: "thirdPartyRequests", header: "3rd-party requests", accessor: "thirdPartyRequests", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "thirdPartyBytesPct", header: "% of total bytes", accessor: "thirdPartyBytesPct", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 60 ? "#C21930" : v > 40 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 700 }}>{fmt.pct(v)}</span>;
      } },
  ], [maxTpBytes]);

  // Bucketed movement data (proxies from bucketed metrics: sessions/actions).
  const { bucketValuesBySort: appBucket } = useBucketedRanks({
    records: (bucketed.data?.records ?? []) as any[],
    rowKeyField: "application",
    bucketField: "bkt",
    metricFields: ["sessions", "actions"],
  });
  const consumptionBucketBySort = useMemo(() => ({
    totalBytes: appBucket.sessions ?? {},
    totalRequests: appBucket.actions ?? {},
    pageViews: appBucket.sessions ?? {},
    avgBytesPerView: appBucket.sessions ?? {},
    avgRequestsPerView: appBucket.actions ?? {},
    avgDomComplete: appBucket.actions ?? {},
  }), [appBucket]);
  const consumptionSortOptions: TLSortOption<typeof rows[number]>[] = useMemo(() => [
    { value: "totalBytes",         label: "Total bytes",           get: (r) => Number(r.totalBytes),         higherIsBetter: false },
    { value: "totalRequests",      label: "Total requests",        get: (r) => Number(r.totalRequests),      higherIsBetter: false },
    { value: "pageViews",          label: "Page views",            get: (r) => Number(r.pageViews),          higherIsBetter: true },
    { value: "avgBytesPerView",    label: "Bytes / page",          get: (r) => Number(r.avgBytesPerView),    higherIsBetter: false },
    { value: "avgRequestsPerView", label: "Requests / page",       get: (r) => Number(r.avgRequestsPerView), higherIsBetter: false },
    { value: "avgDomComplete",     label: "DOM Complete",          get: (r) => Number(r.avgDomComplete),     higherIsBetter: false },
  ], []);

  const tpBucketBySort = useMemo(() => ({
    thirdPartyBytes: appBucket.sessions ?? {},
    thirdPartyRequests: appBucket.actions ?? {},
    thirdPartyBytesPct: appBucket.sessions ?? {},
  }), [appBucket]);
  const tpSortOptions: TLSortOption<typeof tpRows[number]>[] = useMemo(() => [
    { value: "thirdPartyBytes",    label: "3rd-party bytes",     get: (r) => Number(r.thirdPartyBytes),    higherIsBetter: false },
    { value: "thirdPartyRequests", label: "3rd-party requests",  get: (r) => Number(r.thirdPartyRequests), higherIsBetter: false },
    { value: "thirdPartyBytesPct", label: "% of total bytes",    get: (r) => Number(r.thirdPartyBytesPct), higherIsBetter: false },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Total bytes (fleet)" value={fmt.bytes(totalBytes)} rawValue={totalBytes} color="#FF832B" />
        <KpiCard label="Total requests (fleet)" value={fmt.num(totalRequests)} rawValue={totalRequests} color="#A56EFF" />
        <KpiCard label="Avg bytes / page" value={fmt.bytes(totalViews > 0 ? totalBytes / totalViews : 0)} rawValue={totalViews > 0 ? totalBytes / totalViews : 0} color="#4589FF" />
        <KpiCard label="Heaviest web app" value={heaviest?.application ?? "—"} subtext={heaviest ? fmt.bytes(heaviest.totalBytes) : ""} color="#C21930" />
        <KpiCard label="Chattiest web app" value={chattiest?.application ?? "—"} subtext={chattiest ? `${fmt.num(chattiest.totalRequests)} requests` : ""} color="#A56EFF" />
        <KpiCard label="Worst avg page weight" value={worstAvg?.application ?? "—"} subtext={worstAvg ? fmt.bytes(worstAvg.avgBytesPerView) : ""} color="#FF832B" />
      </div>

      <SectionCard
        title="Resource consumption — per Web App"
        subtitle="Which web apps are consuming the most bandwidth and making the most network requests? Sort by any column to find the biggest offenders."
      >
        {consumption.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={consumption.error} label="No resource data captured. RUM enrichment for `networkBytes` / `networkRequests` may be off." /> : (
          <TimelapseTable
            data={rows}
            columns={columns}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={consumptionSortOptions}
            defaultSort="totalBytes"
            bucketValuesBySort={consumptionBucketBySort}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Third-party impact — per Web App"
        subtitle="How much of each web app's payload is 3rd-party (ads, analytics, tag managers, chat widgets)? High % usually means slow, unpredictable performance."
      >
        {thirdParty.loading ? <EmptyState loading /> : tpRows.length === 0 ? <EmptyState error={thirdParty.error} label="No third-party fields present in RUM." /> : (
          <TimelapseTable
            data={tpRows}
            columns={tpCols}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={tpSortOptions}
            defaultSort="thirdPartyBytes"
            bucketValuesBySort={tpBucketBySort}
          />
        )}
      </SectionCard>
    </div>
  );
};
