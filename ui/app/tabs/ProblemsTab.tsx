import React, { useMemo } from "react";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { problemsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useTimelapse, TL_BUCKET_MS } from "../TimelapseContext";

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

  // Bucket problems into time slots for KPI sparklines. Bucket count is
  // driven by TL when playing, otherwise 24 slots across the timeframe.
  const tl = useTimelapse();
  const sparklines = useMemo(() => {
    if (rows.length === 0) return null;
    const N = tl.enabled ? Math.max(8, Math.min(48, Math.round((timeframeDays * 24 * 3600 * 1000) / TL_BUCKET_MS[tl.bucket]))) : 24;
    const nowMs = Date.now();
    const spanMs = timeframeDays * 24 * 3600 * 1000;
    const startMs = nowMs - spanMs;
    const bucketMs = spanMs / N;
    const z = () => new Array<number>(N).fill(0);
    const active = z(), avail = z(), errCat = z(), slow = z();
    for (const r of rows) {
      const ps = r.start / 1e6;
      const pe = r.open ? nowMs : r.start / 1e6 + r.durationMs;
      for (let i = 0; i < N; i++) {
        const bs = startMs + i * bucketMs;
        const be = bs + bucketMs;
        if (ps < be && pe > bs) {
          active[i] += 1;
          if (r.category === "AVAILABILITY") avail[i] += 1;
          else if (r.category === "ERROR") errCat[i] += 1;
          else if (r.category === "SLOWDOWN") slow[i] += 1;
        }
      }
    }
    // Closed-in-period: bucket by end time.
    const closed = z();
    for (const r of rows) {
      if (r.open) continue;
      const pe = r.start / 1e6 + r.durationMs;
      const i = Math.min(N - 1, Math.max(0, Math.floor((pe - startMs) / bucketMs)));
      closed[i] += 1;
    }
    return { active, closed, avail, errCat, slow };
  }, [rows, tl.enabled, tl.bucket, timeframeDays]);

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
        <KpiCard label="Open problems" value={String(openCount)} rawValue={openCount} color="#C21930" sparkline={sparklines?.active} />
        <KpiCard label="Closed in period" value={String(closedCount)} rawValue={closedCount} color="rgba(128,128,128,0.9)" sparkline={sparklines?.closed} />
        <KpiCard label="Availability" value={String(availability)} rawValue={availability} color="#FF832B" sparkline={sparklines?.avail} />
        <KpiCard label="Errors" value={String(errors)} rawValue={errors} color="#C21930" sparkline={sparklines?.errCat} />
        <KpiCard label="Slowdowns" value={String(slowdowns)} rawValue={slowdowns} color="#F9A825" sparkline={sparklines?.slow} />
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
