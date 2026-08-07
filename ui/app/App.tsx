import React, { useMemo, useState } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Tabs, Tab } from "@dynatrace/strato-components-preview/navigation";
import { Select, SelectOption } from "@dynatrace/strato-components-preview/forms";
import { SettingsProvider, useSettings, TIMEFRAME_OPTIONS } from "./SettingsContext";
import { useDql } from "./useDql";
import { webAppInventoryQuery } from "./queries";
import { ExecutiveSummaryTab } from "./tabs/ExecutiveSummaryTab";
import { WebVitalsTab } from "./tabs/WebVitalsTab";
import { PerformanceTab } from "./tabs/PerformanceTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { NavigationFlowsTab } from "./tabs/NavigationFlowsTab";
import { ResourceConsumptionTab } from "./tabs/ResourceConsumptionTab";
import { TrafficEngagementTab } from "./tabs/TrafficEngagementTab";
import { GeoDevicesTab } from "./tabs/GeoDevicesTab";
import { PerfBudgetsTab } from "./tabs/PerfBudgetsTab";
import { ProblemsTab } from "./tabs/ProblemsTab";
import { CostRankingTab } from "./tabs/CostRankingTab";

// ---------------------------------------------------------------------------
// AppHeader — sticky bar with timeframe + web-app filter
// ---------------------------------------------------------------------------
const AppHeader: React.FC = () => {
  const { timeframeDays, setTimeframeDays, webAppFilter, setWebAppFilter } = useSettings();
  const inv = useDql(webAppInventoryQuery(timeframeDays), [timeframeDays]);

  const webApps = useMemo(() => {
    const recs = inv.data?.records ?? [];
    return recs
      .map((r: any) => ({ name: String(r.application ?? ""), sessions: Number(r.sessions ?? 0) }))
      .filter((r) => r.name);
  }, [inv.data]);

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(128,128,128,0.06)",
        borderBottom: "1px solid rgba(128,128,128,0.25)",
        padding: "10px 20px",
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.3 }}>
        Frontend Overview
      </div>
      <div style={{ opacity: 0.55, fontSize: 12 }}>
        {webApps.length} web app{webApps.length === 1 ? "" : "s"} detected
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ minWidth: 190 }}>
          <Select
            name="timeframe"
            value={String(timeframeDays)}
            onChange={(v: any) => {
              const first = Array.isArray(v) ? v[0] : v;
              if (first != null) setTimeframeDays(Number(first));
            }}
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <SelectOption key={tf.value} value={String(tf.value)}>{tf.label}</SelectOption>
            ))}
          </Select>
        </div>
        <div style={{ minWidth: 260 }}>
          <Select
            name="webAppFilter"
            value={webAppFilter.selected ?? "__ALL__"}
            onChange={(v: any) => {
              const first = Array.isArray(v) ? v[0] : v;
              setWebAppFilter({ selected: !first || first === "__ALL__" ? null : String(first) });
            }}
          >
            <SelectOption value="__ALL__">All web apps (compare)</SelectOption>
            {webApps.map((a) => (
              <SelectOption key={a.name} value={a.name}>{a.name} ({a.sessions.toLocaleString()})</SelectOption>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main tabbed shell
// ---------------------------------------------------------------------------
const AppInner: React.FC = () => {
  const [tab, setTab] = useState<number>(0);
  return (
    <>
      <AppHeader />
      <div style={{ padding: "0 8px" }}>
        <Tabs selectedIndex={tab} onChange={(i: any) => setTab(Number(i) || 0)}>
          <Tab title="Executive Summary"><ExecutiveSummaryTab /></Tab>
          <Tab title="Web Vitals"><WebVitalsTab /></Tab>
          <Tab title="Performance"><PerformanceTab /></Tab>
          <Tab title="Errors & Reliability"><ErrorsTab /></Tab>
          <Tab title="Navigation & Flows"><NavigationFlowsTab /></Tab>
          <Tab title="Resource Consumption"><ResourceConsumptionTab /></Tab>
          <Tab title="Cost & Ranking"><CostRankingTab /></Tab>
          <Tab title="Traffic & Engagement"><TrafficEngagementTab /></Tab>
          <Tab title="Geo & Devices"><GeoDevicesTab /></Tab>
          <Tab title="Perf Budgets"><PerfBudgetsTab /></Tab>
          <Tab title="Problems"><ProblemsTab /></Tab>
        </Tabs>
      </div>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <SettingsProvider>
      <Page>
        <Page.Main>
          <AppInner />
        </Page.Main>
      </Page>
    </SettingsProvider>
  );
};
