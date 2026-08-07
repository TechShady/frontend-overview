import React, { useMemo, useState } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { topPagesQuery, pageTransitionsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Navigation & Flows — top pages + page-to-page transitions per web app.
// Note: no user-journey / funnel concepts — this shows actual pages users visit.
// ---------------------------------------------------------------------------
export const NavigationFlowsTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const pages = useDql(topPagesQuery(timeframeDays, sel), [timeframeDays, sel]);
  const transitions = useDql(pageTransitionsQuery(timeframeDays, sel), [timeframeDays, sel]);
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

  const transitionRows = useMemo(() =>
    (transitions.data?.records ?? [])
      .map((r: any) => ({
        application: String(r.application ?? ""),
        from: String(r.page ?? ""),
        to: String(r.nextPage ?? ""),
        transitions: Number(r.transitions ?? 0),
      }))
      .filter((r) => r.transitions >= minTransitions),
  [transitions.data, minTransitions]);

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

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Unique pages" value={fmt.num(uniquePages)} rawValue={uniquePages} color="#4589FF" />
        <KpiCard label="Total page views" value={fmt.num(totalViews)} rawValue={totalViews} color="#08BDBA" />
        <KpiCard label="Unique transitions" value={fmt.num(transitionRows.length)} rawValue={transitionRows.length} color="#A56EFF" />
      </div>

      <SectionCard title="Top pages per Web App" subtitle="Ranked by page views. Duration and error rate are per-page.">
        {pages.loading ? <EmptyState loading /> : pageRows.length === 0 ? <EmptyState error={pages.error} /> : (
          <DataTable data={pageRows} columns={pageCols} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
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
          <DataTable data={transitionRows} columns={transCols} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
