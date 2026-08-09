import React, { useMemo, useState, useCallback } from "react";
import { useAIInsights, analyzeCostRanking } from "../components/AIInsights";
import { useSettings } from "../SettingsContext";
import { useDql } from "../useDql";
import { resourceConsumptionQuery, webAppSummaryQuery, webAppBucketedMetricsQuery } from "../queries";
import { KpiCard } from "../components/KpiCard";
import { SectionCard, EmptyState, fmt } from "../components/layout";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useFleetSparklines } from "../hooks/useFleetSparklines";
import { useTimelapse } from "../TimelapseContext";

// ---------------------------------------------------------------------------
// Cost & Ranking — creative: assign a $ estimate per byte, requests, and RUM
// events to give web-app owners an intuitive "who costs the most" ranking.
// User adjustable rate assumptions live here.
// ---------------------------------------------------------------------------
export const CostRankingTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const [rateReq, setRateReq] = useState(0.0000004);       // $ per HTTP request (CDN)
  const [rateRumEvent, setRateRumEvent] = useState(0.00001); // $ per RUM action captured

  const consumption = useDql(resourceConsumptionQuery(timeframeDays, sel), [timeframeDays, sel]);
  const sum = useDql(webAppSummaryQuery(timeframeDays, sel), [timeframeDays, sel]);
  const bucketed = useDql(webAppBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);
  const spk = useFleetSparklines(bucketed.data?.records);

  const rows = useMemo(() => {
    const actionsBy: Record<string, number> = {};
    (sum.data?.records ?? []).forEach((r: any) => { actionsBy[String(r.application)] = Number(r.actions ?? 0); });
    return (consumption.data?.records ?? []).map((r: any) => {
      const app = String(r.application ?? "");
      const reqs = Number(r.totalRequests ?? 0);
      const actions = actionsBy[app] ?? 0;
      const costReqs = reqs * rateReq;
      const costRum = actions * rateRumEvent;
      const total = costReqs + costRum;
      return {
        application: app,
        requests: reqs,
        actions,
        costReqs,
        costRum,
        totalCost: total,
      };
    });
  }, [consumption.data, sum.data, rateReq, rateRumEvent]);

  const totalCost = rows.reduce((a, r) => a + r.totalCost, 0);

  const { panel: aiPanel } = useAIInsights(useCallback(() =>
    analyzeCostRanking(
      rows.map((r) => ({ application: r.application, totalCost: r.totalCost })),
      totalCost,
    ),
  [rows, totalCost]));
  const costPerAction = rows.reduce((a, r) => a + r.actions, 0) > 0
    ? totalCost / rows.reduce((a, r) => a + r.actions, 0)
    : 0;

  const maxCost = Math.max(1e-6, ...rows.map((r) => r.totalCost));
  const columns: any = useMemo(() => [
    { id: "rank", header: "Rank", accessor: "rank", width: 60,
      cell: ({ value }: any) => <span style={{ fontWeight: 700, opacity: 0.7 }}>#{Number(value)}</span> },
    { id: "application", header: "Web App", accessor: "application", width: 200,
      cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
    { id: "costReqs", header: "Requests ($)", accessor: "costReqs", width: 130, sortType: "number" as any,
      cell: ({ value }: any) => <span>${Number(value).toFixed(2)}</span> },
    { id: "costRum", header: "RUM ($)", accessor: "costRum", width: 110, sortType: "number" as any,
      cell: ({ value }: any) => <span>${Number(value).toFixed(2)}</span> },
    { id: "totalCost", header: "Total cost", accessor: "totalCost", width: 240, sortType: "number" as any,
      cell: ({ value }: any) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: "rgba(128,128,128,0.2)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (Number(value) / maxCost) * 100)}%`, height: "100%", background: "#FF832B" }} />
          </div>
          <div style={{ minWidth: 80, textAlign: "right", fontWeight: 700, color: "#FF832B" }}>${Number(value).toFixed(2)}</div>
        </div>
      ) },
    { id: "pct", header: "% of fleet", accessor: "pct", width: 100,
      cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
  ], [maxCost, totalCost]);

  const ranked = rows.slice().sort((a, b) => b.totalCost - a.totalCost).map((r, i) => ({
    ...r,
    rank: i + 1,
    pct: totalCost > 0 ? (r.totalCost / totalCost) * 100 : 0,
  }));

  // Bucketed proxy metrics for Movement column (actions ≈ RUM cost, sessions ≈ traffic).
  const { bucketValuesBySort } = useBucketedRanks({
    records: (bucketed.data?.records ?? []) as any[],
    rowKeyField: "application",
    bucketField: "bkt",
    metricFields: ["actions", "sessions", "errors"],
  });
  const bucketBySort = useMemo(() => ({
    totalCost: bucketValuesBySort.actions ?? {},
    costRum: bucketValuesBySort.actions ?? {},
    costReqs: bucketValuesBySort.actions ?? {},
  }), [bucketValuesBySort]);

  const sortOptions: TLSortOption<typeof ranked[number]>[] = useMemo(() => [
    { value: "totalCost", label: "Total cost",       get: (r) => Number(r.totalCost), higherIsBetter: false },
    { value: "costReqs",  label: "Request cost",     get: (r) => Number(r.costReqs),  higherIsBetter: false },
    { value: "costRum",   label: "RUM capture cost", get: (r) => Number(r.costRum),   higherIsBetter: false },
  ], []);

  return (
    <div>
      {aiPanel}
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Estimated fleet cost" value={`$${totalCost.toFixed(2)}`} rawValue={totalCost} color="#FF832B" sparkline={spk?.actions} />
        <KpiCard label="Cost / user action" value={`$${costPerAction.toFixed(5)}`} rawValue={costPerAction} color="#A56EFF" sparkline={spk?.actions} />
      </div>

      <SectionCard
        title="Cost model assumptions"
        subtitle="These rates are illustrative. Adjust to match your CDN / observability contract for realistic numbers. Apps with $0 may lack resource-consumption data in your environment."
      >
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7 }}>Per HTTP request ($)</span>
            <input type="number" step="0.0000001" value={rateReq} onChange={(e) => setRateReq(Number(e.target.value))}
              style={{ padding: "4px 8px", background: "rgba(128,128,128,0.1)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, width: 120, color: "white" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7 }}>Per RUM action ($)</span>
            <input type="number" step="0.000001" value={rateRumEvent} onChange={(e) => setRateRumEvent(Number(e.target.value))}
              style={{ padding: "4px 8px", background: "rgba(128,128,128,0.1)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, width: 120, color: "white" }} />
          </label>
          <button
            onClick={() => { setRateReq(0.0000004); setRateRumEvent(0.00001); }}
            style={{ padding: "4px 12px", background: "rgba(128,128,128,0.15)", border: "1px solid rgba(128,128,128,0.3)", borderRadius: 6, color: "white", cursor: "pointer", fontSize: 12 }}
          >Reset defaults</button>
        </div>
      </SectionCard>

      <SectionCard
        title="Web-App Cost Leaderboard"
        subtitle={`Estimated request + RUM-capture cost per web app over the selected ${timeframeDays}-day timeframe. Ranked highest to lowest.`}
      >
        {consumption.loading ? <EmptyState loading /> : ranked.length === 0 ? <EmptyState /> : (
          <TimelapseTable
            data={ranked}
            columns={columns}
            rowKey={(r: any) => String(r.application)}
            firstColumnField="application"
            sortOptions={sortOptions}
            defaultSort="totalCost"
            bucketValuesBySort={bucketBySort}
          />
        )}
      </SectionCard>
    </div>
  );
};
