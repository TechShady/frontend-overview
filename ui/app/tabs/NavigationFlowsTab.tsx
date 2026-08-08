import React, { useMemo, useState } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { topPagesQuery, pageTransitionsQuery, pagesBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";

// ---------------------------------------------------------------------------
// Navigation & Flows — top pages + page-to-page transitions per web app.
// Note: no user-journey / funnel concepts — this shows actual pages users visit.
// ---------------------------------------------------------------------------
export const NavigationFlowsTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const pages = useDql(topPagesQuery(timeframeDays, sel), [timeframeDays, sel]);
  const transitions = useDql(pageTransitionsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const pageBucketed = useDql(pagesBucketedMetricsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const [minTransitions, setMinTransitions] = useState(5);

  const pageRows = useMemo(() =>
    (pages.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      name: String(r.name ?? ""),
      type: String(r.type ?? ""),
      views: Number(r.views ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      errors: Number(r.errors ?? 0),
      errRate: Number(r.views ?? 0) > 0 ? (Number(r.errors ?? 0) / Number(r.views ?? 0)) * 100 : 0,
    })),
  [pages.data]);

  const maxViews = Math.max(1, ...pageRows.map((r) => r.views));
  const uniquePages = new Set(pageRows.map((r) => `${r.application}::${r.name}`)).size;
  const totalViews = pageRows.reduce((a, r) => a + r.views, 0);

  const pageCols: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 180,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "name", header: "Page", accessor: "name", width: 340,
      cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
    { id: "type", header: "Type", accessor: "type", width: 110 },
    { id: "views", header: "Views", accessor: "views", width: 180, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxViews} /> },
    { id: "avgDuration", header: "Avg duration", accessor: "avgDuration", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
    { id: "errors", header: "Errors", accessor: "errors", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span style={{ color: Number(value) > 0 ? "#C21930" : undefined }}>{fmt.num(Number(value))}</span> },
    { id: "errRate", header: "Err %", accessor: "errRate", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
  ], [maxViews]);

  const transitionRows = useMemo(() => {
    // Server returns `path` arrays per session; derive from→to pairs client-side
    // because DQL `shift()` isn't available in this tenant.
    const agg: Record<string, { application: string; from: string; to: string; transitions: number }> = {};
    (transitions.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      const path: string[] = Array.isArray(r.path) ? r.path : [];
      for (let i = 0; i < path.length - 1; i++) {
        const from = String(path[i] ?? "");
        const to = String(path[i + 1] ?? "");
        if (!from || !to || from === to) continue;
        const key = `${app}\u0001${from}\u0001${to}`;
        if (!agg[key]) agg[key] = { application: app, from, to, transitions: 0 };
        agg[key].transitions += 1;
      }
    });
    return Object.values(agg)
      .sort((a, b) => b.transitions - a.transitions)
      .filter((r) => r.transitions >= minTransitions);
  }, [transitions.data, minTransitions]);

  const maxTrans = Math.max(1, ...transitionRows.map((r) => r.transitions));
  const transCols: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 180,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "from", header: "From", accessor: "from", width: 280,
      cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
    { id: "arrow", header: "→", accessor: "arrow", width: 30, cell: () => <span style={{ opacity: 0.5 }}>→</span> },
    { id: "to", header: "To", accessor: "to", width: 280,
      cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
    { id: "transitions", header: "Transitions", accessor: "transitions", width: 200, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxTrans} color="#A56EFF" /> },
  ], [maxTrans]);

  // Bucketed page metrics — key by "app::page" to match pageRows.
  const { bucketValuesBySort: pageBucket } = useBucketedRanks({
    records: (pageBucketed.data?.records ?? []) as any[],
    rowKeyField: "page",
    bucketField: "bkt",
    metricFields: ["views", "sessions", "errors", "avgDuration"],
  });
  const pageBucketBySort = useMemo(() => {
    const remap = (src: Record<string, (number | null)[]>) => {
      const out: Record<string, (number | null)[]> = {};
      for (const r of pageRows) out[`${r.application}::${r.name}`] = src[r.name] ?? [];
      return out;
    };
    return {
      views:       remap(pageBucket.views ?? {}),
      avgDuration: remap(pageBucket.avgDuration ?? {}),
      errors:      remap(pageBucket.errors ?? {}),
      errRate:     remap(pageBucket.errors ?? {}),
    };
  }, [pageBucket, pageRows]);
  const pageSortOptions: TLSortOption<typeof pageRows[number]>[] = useMemo(() => [
    { value: "views",       label: "Views",        get: (r) => Number(r.views),       higherIsBetter: true },
    { value: "avgDuration", label: "Avg duration", get: (r) => Number(r.avgDuration), higherIsBetter: false },
    { value: "errors",      label: "Errors",       get: (r) => Number(r.errors),      higherIsBetter: false },
    { value: "errRate",     label: "Err %",        get: (r) => Number(r.errRate),     higherIsBetter: false },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Unique pages" value={fmt.num(uniquePages)} rawValue={uniquePages} color="#4589FF" />
        <KpiCard label="Total page views" value={fmt.num(totalViews)} rawValue={totalViews} color="#08BDBA" />
        <KpiCard label="Unique transitions" value={fmt.num(transitionRows.length)} rawValue={transitionRows.length} color="#A56EFF" />
      </div>

      <SectionCard title="Top pages per Web App" subtitle="Ranked by page views. Duration and error rate are per-page.">
        {pages.loading ? <EmptyState loading /> : pageRows.length === 0 ? <EmptyState error={pages.error} /> : (
          <TimelapseTable
            data={pageRows}
            columns={pageCols}
            rowKey={(r: any) => `${r.application}::${r.name}`}
            firstColumnField="application"
            sortOptions={pageSortOptions}
            defaultSort="views"
            bucketValuesBySort={pageBucketBySort}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Page transitions (From → To)"
        subtitle={`Actual navigation edges observed in sessions. Minimum ${minTransitions} transitions.`}
        actions={
          <input
            type="range" min={1} max={50} value={minTransitions}
            onChange={(e) => setMinTransitions(Number(e.target.value))}
            style={{ width: 160 }}
            title={`min transitions: ${minTransitions}`}
          />
        }
      >
        {transitions.loading ? <EmptyState loading /> : transitionRows.length === 0 ? <EmptyState error={transitions.error} /> : (
          <TimelapseTable
            data={transitionRows}
            columns={transCols}
            rowKey={(r: any) => `${r.application}::${r.from}->${r.to}`}
            firstColumnField="application"
            sortOptions={[{ value: "transitions", label: "Transitions", get: (r) => Number(r.transitions), higherIsBetter: true }]}
            defaultSort="transitions"
          />
        )}
      </SectionCard>
    </div>
  );
};
