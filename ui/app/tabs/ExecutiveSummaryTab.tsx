import React, { useMemo } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { webAppSummaryQuery, webVitalsPerAppQuery, errorsPerAppQuery } from "../queries";
import { computeAppScore, computeFleetScore, PerAppSummary, PerAppVitals } from "../scoring";
import { KpiCard } from "../components/KpiCard";
import { GradeBadge, GradePill, gradeFromScore } from "../components/GradeBadge";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";

// ---------------------------------------------------------------------------
// Executive Summary — fleet grade + per-app grade card table
// ---------------------------------------------------------------------------
export const ExecutiveSummaryTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;

  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prev = useDql(webAppSummaryQuery(timeframeDays, sel, true), [timeframeDays, sel]);
  const vitals = useDql(webVitalsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);
  const errs = useDql(errorsPerAppQuery(timeframeDays, sel), [timeframeDays, sel]);

  const summaries: PerAppSummary[] = useMemo(() => {
    return (sum.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      sessions: Number(r.sessions ?? 0),
      users: Number(r.users ?? 0),
      actions: Number(r.actions ?? 0),
      errors: Number(r.errors ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      bounces: Number(r.bounces ?? 0),
      newUsers: Number(r.newUsers ?? 0),
      errorRate: Number(r.errorRate ?? 0),
      bounceRate: Number(r.bounceRate ?? 0),
    }));
  }, [sum.data]);

  const prevSummaries: Record<string, PerAppSummary> = useMemo(() => {
    const out: Record<string, PerAppSummary> = {};
    (prev.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      out[app] = {
        application: app,
        sessions: Number(r.sessions ?? 0),
        users: Number(r.users ?? 0),
        actions: Number(r.actions ?? 0),
        errors: Number(r.errors ?? 0),
        avgDuration: Number(r.avgDuration ?? 0),
        bounces: Number(r.bounces ?? 0),
        newUsers: Number(r.newUsers ?? 0),
        errorRate: Number(r.errorRate ?? 0),
        bounceRate: Number(r.bounceRate ?? 0),
      };
    });
    return out;
  }, [prev.data]);

  const vitalsByApp: Record<string, PerAppVitals> = useMemo(() => {
    const out: Record<string, PerAppVitals> = {};
    (vitals.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application_name ?? r.application ?? "");
      out[app] = {
        application: app,
        lcpAvg: Number(r.lcpAvg ?? NaN),
        clsAvg: Number(r.clsAvg ?? NaN),
        inpAvg: Number(r.inpAvg ?? NaN),
        ttfbAvg: Number(r.ttfbAvg ?? NaN),
      };
    });
    return out;
  }, [vitals.data]);

  const scoredRows = useMemo(() => {
    return summaries.map((s) => {
      const v = vitalsByApp[s.application];
      const { score, parts } = computeAppScore(v, s);
      return { ...s, vitals: v, score, parts };
    });
  }, [summaries, vitalsByApp]);

  const fleetScore = useMemo(() =>
    computeFleetScore(scoredRows.map((r) => ({ score: r.score, sessions: r.sessions }))),
  [scoredRows]);

  const prevFleetScore = useMemo(() => {
    const rows = summaries.map((s) => {
      const prevS = prevSummaries[s.application];
      const v = vitalsByApp[s.application];
      const { score } = computeAppScore(v, prevS);
      return { score, sessions: prevS?.sessions ?? 0 };
    });
    return computeFleetScore(rows);
  }, [summaries, prevSummaries, vitalsByApp]);

  const totalSessions = scoredRows.reduce((a, r) => a + r.sessions, 0);
  const totalActions = scoredRows.reduce((a, r) => a + r.actions, 0);
  const totalErrors = scoredRows.reduce((a, r) => a + r.errors, 0);
  const prevSessions = Object.values(prevSummaries).reduce((a, r) => a + r.sessions, 0);
  const prevActions = Object.values(prevSummaries).reduce((a, r) => a + r.actions, 0);
  const prevErrors = Object.values(prevSummaries).reduce((a, r) => a + r.errors, 0);

  const tableRows = useMemo(() =>
    scoredRows.slice().sort((a, b) => b.sessions - a.sessions).map((r) => ({
      application: r.application,
      grade: r.score,
      sessions: r.sessions,
      users: r.users,
      actions: r.actions,
      errorRate: r.errorRate,
      bounceRate: r.bounceRate,
      lcp: r.vitals?.lcpAvg ?? NaN,
      inp: r.vitals?.inpAvg ?? NaN,
      cls: r.vitals?.clsAvg ?? NaN,
    })),
  [scoredRows]);

  const maxSessions = Math.max(1, ...tableRows.map((r) => r.sessions));

  const columns: any = useMemo(() => [
    { id: "application", header: "Web App", accessor: "application", width: 220,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "grade", header: "Grade", accessor: "grade", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <GradePill score={Number(value)} showScore /> },
    { id: "sessions", header: "Sessions", accessor: "sessions", width: 160, sortType: "number" as any,
      cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxSessions} color="#4589FF" /> },
    { id: "users", header: "Users", accessor: "users", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "actions", header: "Actions", accessor: "actions", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.num(Number(value))}</span> },
    { id: "errorRate", header: "Error rate", accessor: "errorRate", width: 100, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 5 ? "#C21930" : v > 1 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col, fontWeight: 600 }}>{fmt.pct(v)}</span>;
      } },
    { id: "bounceRate", header: "Bounce", accessor: "bounceRate", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
    { id: "lcp", header: "LCP", accessor: "lcp", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 4000 ? "#C21930" : v > 2500 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "inp", header: "INP", accessor: "inp", width: 90, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 500 ? "#C21930" : v > 200 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{fmt.ms(v)}</span>;
      } },
    { id: "cls", header: "CLS", accessor: "cls", width: 80, sortType: "number" as any,
      cell: ({ value }: any) => {
        const v = Number(value);
        const col = v > 0.25 ? "#C21930" : v > 0.1 ? "#F9A825" : "#0D9C29";
        return <span style={{ color: col }}>{isFinite(v) ? v.toFixed(2) : "—"}</span>;
      } },
  ], [maxSessions]);

  const loading = sum.loading || vitals.loading;
  const gradeInfo = gradeFromScore(fleetScore);

  return (
    <div>
      {/* Fleet-wide top row */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", padding: "20px 20px 4px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <GradeBadge score={fleetScore} size={92} label="Fleet Grade" />
          {isFinite(prevFleetScore) && (
            <div style={{ fontSize: 11, opacity: 0.65 }}>
              prev period: <span style={{ color: gradeFromScore(prevFleetScore).color, fontWeight: 700 }}>{gradeFromScore(prevFleetScore).letter}</span> ({prevFleetScore.toFixed(0)})
            </div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiCard label="Web apps" value={String(scoredRows.length)} rawValue={scoredRows.length} color="#4589FF" />
          <KpiCard label="Sessions" value={fmt.num(totalSessions)} rawValue={totalSessions} prevRawValue={prevSessions} color="#4589FF" higherIsBetter />
          <KpiCard label="Actions" value={fmt.num(totalActions)} rawValue={totalActions} prevRawValue={prevActions} color="#08BDBA" higherIsBetter />
          <KpiCard label="Errors" value={fmt.num(totalErrors)} rawValue={totalErrors} prevRawValue={prevErrors} color="#C21930" />
          <KpiCard label="Error rate" value={fmt.pct(totalActions > 0 ? (totalErrors / totalActions) * 100 : 0)} rawValue={totalActions > 0 ? (totalErrors / totalActions) * 100 : 0} prevRawValue={prevActions > 0 ? (prevErrors / prevActions) * 100 : null} color="#C21930" />
        </div>
      </div>

      <SectionCard
        title="Per Web-App Grade Breakdown"
        subtitle={`Composite letter grade blends Core Web Vitals (LCP/INP/CLS/TTFB), error rate, and bounce rate. Weighted by session traffic. ${scoredRows.length} apps evaluated.`}
      >
        {loading ? <EmptyState loading /> : tableRows.length === 0 ? <EmptyState /> : (
          <DataTable data={tableRows} columns={columns} sortable resizable variant={{ rowSeparation: "horizontalDividers" }} />
        )}
      </SectionCard>

      {/* Grade legend */}
      <SectionCard title="How the grade is calculated">
        <div style={{ fontSize: 12, opacity: 0.85, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>Each web app's composite score is a weighted blend of six health signals. Higher is better.</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
            {[
              { label: "LCP", pct: "22%", target: "< 2.5s" },
              { label: "INP", pct: "18%", target: "< 200ms" },
              { label: "CLS", pct: "12%", target: "< 0.1" },
              { label: "TTFB", pct: "8%", target: "< 800ms" },
              { label: "Error rate", pct: "25%", target: "< 0.5%" },
              { label: "Bounce rate", pct: "15%", target: "< 30%" },
            ].map((p) => (
              <div key={p.label} style={{ padding: "6px 12px", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8, fontSize: 11 }}>
                <div style={{ fontWeight: 700 }}>{p.label} <span style={{ opacity: 0.65 }}>({p.pct})</span></div>
                <div style={{ opacity: 0.7 }}>target: {p.target}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
