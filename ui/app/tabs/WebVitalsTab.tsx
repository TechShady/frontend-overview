import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings, CWV } from "../SettingsContext";
import { useDql } from "../useDql";
import { webVitalsPerAppQuery, webAppSummaryQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Web Vitals — LCP, INP, CLS, TTFB per web app.
// ---------------------------------------------------------------------------
export const WebVitalsTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const summary = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);

  const rows = useMemo(() => {
    const sessions: Record<string, number> = {};
    (summary.data?.records ?? []).forEach((r: any) => {
      sessions[String(r.application ?? "")] = Number(r.sessions ?? 0);
    });
    return (vitals.data?.records ?? []).map((r: any) => ({
      application: String(r.application_name ?? r.application ?? ""),
      lcp: Number(r.lcpAvg ?? NaN),
      inp: Number(r.inpAvg ?? NaN),
      cls: Number(r.clsAvg ?? NaN),
      ttfb: Number(r.ttfbAvg ?? NaN),
      sessions: sessions[String(r.application_name ?? r.application ?? "")] ?? 0,
    }));
  }, [vitals.data, summary.data]);

  // Fleet averages weighted by sessions.
  const fleet = useMemo(() => {
    const total = rows.reduce((a, r) => a + r.sessions, 0);
    if (total === 0) return { lcp: NaN, inp: NaN, cls: NaN, ttfb: NaN };
    const w = (field: keyof typeof rows[0]) => rows.reduce((a, r) => a + (isFinite(r[field] as number) ? (r[field] as number) * r.sessions : 0), 0) / total;
    return { lcp: w("lcp"), inp: w("inp"), cls: w("cls"), ttfb: w("ttfb") };
  }, [rows]);

  const goodShare = (field: "lcp" | "inp" | "cls" | "ttfb") => {
    const good = rows.filter((r) => {
      const v = r[field];
      if (!isFinite(v)) return false;
      return v <= CWV[field].good;
    }).length;
    return rows.length ? (good / rows.length) * 100 : 0;
  };

  const maxSessions = Math.max(1, ...rows.map((r) => r.sessions));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 220,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 160, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxSessions} /> },
    ...(["lcp", "inp", "cls", "ttfb"] as const).map((k) => ({
      id: k,
      header: k.toUpperCase(),
      accessor: k,
      width: 100,
      sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const th = CWV[k];
        const col = v > th.poor ? "#C21930" : v > th.good ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{k === "cls" ? (isFinite(v) ? v.toFixed(2) : "—") : fmt.ms(v)}</span>;
      },
    })),
  ], [maxSessions]);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Fleet LCP" value={fmt.ms(fleet.lcp)} rawValue={fleet.lcp} color="#4589FF" subtext={`${goodShare("lcp").toFixed(0)}% of apps < 2.5s`} />
        <KpiCard label="Fleet INP" value={fmt.ms(fleet.inp)} rawValue={fleet.inp} color="#A56EFF" subtext={`${goodShare("inp").toFixed(0)}% of apps < 200ms`} />
        <KpiCard label="Fleet CLS" value={isFinite(fleet.cls) ? fleet.cls.toFixed(2) : "—"} rawValue={fleet.cls} color="#08BDBA" subtext={`${goodShare("cls").toFixed(0)}% of apps < 0.1`} />
        <KpiCard label="Fleet TTFB" value={fmt.ms(fleet.ttfb)} rawValue={fleet.ttfb} color="#FF832B" subtext={`${goodShare("ttfb").toFixed(0)}% of apps < 800ms`} />
      </div>

      <SectionCard
        title="Core Web Vitals — per Web App"
        subtitle="Green = good, yellow = needs improvement, red = poor (Google CWV thresholds). Sort by any column to find the worst offender."
      >
        {vitals.loading ? <EmptyState loading /> : rows.length === 0 ? <EmptyState error={vitals.error} /> : (
          <DataTable data={rows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>
    </div>
  );
};
