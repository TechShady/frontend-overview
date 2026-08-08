import React, { useMemo } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { problemsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";

// ---------------------------------------------------------------------------
// Problems tab — Davis problems currently affecting web-app services.
// ---------------------------------------------------------------------------
export const ProblemsTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const prob = useDql(problemsQuery(timeframeDays, sel), [timeframeDays, sel]);

  const rows = useMemo(() =>
    (prob.data?.records ?? []).map((r: any) => {
      const start = Number(r.start ?? 0);
      const end = Number(r.end ?? 0);
      const open = !end || end === 0;
      const durationMs = open ? Date.now() - start / 1e6 : (end - start) / 1e6;
      return {
        id: String(r.id ?? ""),
        title: String(r.title ?? ""),
        category: String(r.category ?? ""),
        severity: String(r.severity ?? ""),
        open,
        start,
        durationMs,
        affected: (r.affected ?? []) as string[],
      };
    }),
  [prob.data]);

  const openCount = rows.filter((r) => r.open).length;
  const closedCount = rows.length - openCount;
  const availability = rows.filter((r) => r.category === "AVAILABILITY").length;
  const errors = rows.filter((r) => r.category === "ERROR").length;
  const slowdowns = rows.filter((r) => r.category === "SLOWDOWN").length;

  const columns: any = useMemo(() => [
    { id: "id", header: "ID", accessor: "id", width: 90,
      cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
    { id: "title", header: "Title", accessor: "title", width: 320,
      cell: ({ value }: any) => <span>{String(value)}</span> },
    { id: "category", header: "Category", accessor: "category", width: 130 },
    { id: "open", header: "Status", accessor: "open", width: 90,
      cell: ({ value }: any) => (
        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
          background: value ? "#C2193020" : "#0D9C2920", color: value ? "#C21930" : "#0D9C29" }}>
          {value ? "OPEN" : "CLOSED"}
        </span>
      ) },
    { id: "durationMs", header: "Duration", accessor: "durationMs", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
    { id: "affected", header: "Affected", accessor: "affected", width: 320,
      cell: ({ value }: any) => (
        <span style={{ fontSize: 11, opacity: 0.85 }}>{(Array.isArray(value) ? value.slice(0, 3).join(", ") : String(value)) + (Array.isArray(value) && value.length > 3 ? ` +${value.length - 3}` : "")}</span>
      ) },
  ], []);

  const sortOptions: TLSortOption<typeof rows[number]>[] = useMemo(() => [
    { value: "start",      label: "Most recent", get: (r) => Number(r.start),      higherIsBetter: true },
    { value: "durationMs", label: "Duration",    get: (r) => Number(r.durationMs), higherIsBetter: false },
    { value: "category",   label: "Category",    get: (r) => (r.category === "AVAILABILITY" ? 3 : r.category === "ERROR" ? 2 : r.category === "SLOWDOWN" ? 1 : 0), higherIsBetter: false },
  ], []);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Open problems" value={String(openCount)} rawValue={openCount} color="#C21930" />
        <KpiCard label="Closed in period" value={String(closedCount)} rawValue={closedCount} color="rgba(128,128,128,0.9)" />
        <KpiCard label="Availability" value={String(availability)} rawValue={availability} color="#FF832B" />
        <KpiCard label="Errors" value={String(errors)} rawValue={errors} color="#C21930" />
        <KpiCard label="Slowdowns" value={String(slowdowns)} rawValue={slowdowns} color="#F9A825" />
      </div>

      <SectionCard title="Davis problems affecting web apps">
        {prob.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={prob.error} label="No matching problems." /> : (
          <TimelapseTable
            data={rows}
            columns={columns}
            rowKey={(r: any) => String(r.id)}
            firstColumnField="id"
            sortOptions={sortOptions}
            defaultSort="start"
          />
        )}
      </SectionCard>
    </div>
  );
};
