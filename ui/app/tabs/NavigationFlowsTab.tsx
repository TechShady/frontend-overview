// NavigationFlowsTab — five sub-tabs:
//   1. Navigation Paths  — rectangular columnar flow graph + tables
//   2. Sankey            — multi-format page-path flow visualization
//   3. Geo Heatmap       — country performance cards + table
//   4. Maps              — interactive world choropleth map + globe
//   5. Session Replay    — sessions ranked by impact score
//
// REQUIRES npm install after first clone:
//   npm install d3-geo topojson-client world-atlas
//   (and @types/topojson-client @types/world-atlas in devDependencies)

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useAIInsights, analyzeNavigation } from "../components/AIInsights";
import { useSettings, CWV, NAV_FLOWS_SUB_TABS } from "../SettingsContext";
import { useDql } from "../useDql";
import { useTimelapse } from "../TimelapseContext";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { KpiCard } from "../components/KpiCard";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useBucketedSums } from "../hooks/useFleetSparklines";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
const ENV_URL = getEnvironmentUrl();

function sessionsFilterUrl(countryIso: string, appName: string | null, days: number): string {
  const countryName = ISO_NAMES[countryIso.toUpperCase()] ?? countryIso;
  const tf = encodeURIComponent(`now-${days}d;now`);
  const filter = appName
    ? `Frontends = ${appName} Location = "${countryName}"`
    : `Location = "${countryName}"`;
  return `${ENV_URL}/ui/apps/dynatrace.users.sessions/sessions/sessions?tf=${tf}&perspective=general#filtering=${encodeURIComponent(filter)}`;
}
import {
  topPagesQuery, pageTransitionsQuery, pagesBucketedMetricsQuery,
  geoFullQuery, geoFullBucketedQuery,
  sankeyFlowQuery, sankeyExtendedPathsQuery, sankeyPageDurationQuery,
  sankeyPrevPathsQuery, sankeyTimelapseQuery, sessionReplayQuery,
} from "../queries";
import { ISO_ALPHA2_TO_NUMERIC, ISO_NUMERIC_TO_ALPHA2 } from "../worldMapPaths";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";

// ---------------------------------------------------------------------------
// Module-level map init (runs once on import)
// ---------------------------------------------------------------------------
const worldGeo = feature(worldAtlas as any, (worldAtlas as any).objects.countries);
const worldProjection = geoNaturalEarth1().fitSize([960, 500], worldGeo as any);
const worldPathGen = geoPath().projection(worldProjection);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BLUE   = "#4589FF";
const GREEN  = "#0D9C29";
const YELLOW = "#B8860B";
const ORANGE = "#FF832B";
const RED    = "#C21930";
const CYAN   = "#08BDBA";
const PURPLE = "#A56EFF";

const ISO_NAMES: Record<string, string> = {
  US:"United States",CA:"Canada",MX:"Mexico",BR:"Brazil",AR:"Argentina",CO:"Colombia",CL:"Chile",
  PE:"Peru",VE:"Venezuela",GB:"United Kingdom",DE:"Germany",FR:"France",ES:"Spain",IT:"Italy",
  NL:"Netherlands",BE:"Belgium",CH:"Switzerland",AT:"Austria",PL:"Poland",SE:"Sweden",NO:"Norway",
  FI:"Finland",DK:"Denmark",IE:"Ireland",PT:"Portugal",CZ:"Czechia",RO:"Romania",HU:"Hungary",
  GR:"Greece",RU:"Russia",UA:"Ukraine",TR:"Turkey",CN:"China",JP:"Japan",KR:"South Korea",
  IN:"India",ID:"Indonesia",TH:"Thailand",VN:"Vietnam",PH:"Philippines",MY:"Malaysia",SG:"Singapore",
  AU:"Australia",NZ:"New Zealand",ZA:"South Africa",NG:"Nigeria",EG:"Egypt",KE:"Kenya",
  SA:"Saudi Arabia",AE:"United Arab Emirates",IL:"Israel",PK:"Pakistan",BD:"Bangladesh",
  TW:"Taiwan",HK:"Hong Kong",
};

const TL_BUCKET_LABELS: Record<string, string> = {
  "1m":"1 min","5m":"5 min","10m":"10 min","30m":"30 min","1h":"1 hr",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
function fmtMs(ms: number): string {
  if (!ms || isNaN(ms)) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }
function calcApdex(sat: number, tol: number, total: number): number {
  if (!total) return 0;
  return Math.min(1, (sat + tol * 0.5) / total);
}
function apdexClr(v: number): string {
  return v >= 0.9 ? GREEN : v >= 0.7 ? YELLOW : RED;
}
function decodeName(iso: string, fallback: string): string {
  const known = ISO_NAMES[iso.toUpperCase()];
  if (known) return `${known} (${iso})`;
  if (fallback && fallback.length > 2 && fallback !== iso) return `${fallback} (${iso})`;
  return iso;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SankeyNode { id: string; label: string; depth: number; value: number; y: number; height: number; }
interface SankeyLink { source: string; target: string; value: number; sy: number; ty: number; thickness: number; }
type SankeySubTabId = "flow" | "loops" | "timing" | "endpoints" | "pathTrends";
type NavFlowsSubTab = "paths" | "sankey" | "geo" | "maps" | "replay";
type MapMetric = "sessions" | "avgDur" | "apdex" | "errRate" | "fruRate" | "actionsPerSession" | "lcp" | "cls" | "inp";
type MapView = "world" | "globe";

// ---------------------------------------------------------------------------
// buildSankey — ported directly from user-journey-app (lines 19321-19420)
// ---------------------------------------------------------------------------
function buildSankey(records: any[]): { nodes: SankeyNode[]; links: SankeyLink[]; maxDepth: number } {
  const linkMap = new Map<string, number>();
  for (const r of records) {
    const steps = [String(r.s0 ?? ""), String(r.s1 ?? ""), String(r.s2 ?? ""), String(r.s3 ?? ""), String(r.s4 ?? "")];
    const count = Number(r.sessions ?? r.d0 ?? 1);
    for (let i = 0; i < 4; i++) {
      const src = steps[i]; const tgt = steps[i + 1];
      if (!src || !tgt || tgt === "(exit)") break;
      const key = `${i}|${src}|||${i + 1}|${tgt}`;
      linkMap.set(key, (linkMap.get(key) ?? 0) + count);
    }
  }
  const nodeValueMap = new Map<string, number>();
  const rawLinks: { srcDepth: number; src: string; tgtDepth: number; tgt: string; value: number }[] = [];
  for (const [key, value] of linkMap) {
    const [srcPart, tgtPart] = key.split("|||");
    const srcDepth = Number(srcPart.substring(0, srcPart.indexOf("|")));
    const src = srcPart.substring(srcPart.indexOf("|") + 1);
    const tgtDepth = Number(tgtPart.substring(0, tgtPart.indexOf("|")));
    const tgt = tgtPart.substring(tgtPart.indexOf("|") + 1);
    rawLinks.push({ srcDepth, src, tgtDepth, tgt, value });
    nodeValueMap.set(`${srcDepth}|${src}`, (nodeValueMap.get(`${srcDepth}|${src}`) ?? 0) + value);
    nodeValueMap.set(`${tgtDepth}|${tgt}`, (nodeValueMap.get(`${tgtDepth}|${tgt}`) ?? 0) + value);
  }
  if (rawLinks.length === 0) return { nodes: [], links: [], maxDepth: 0 };
  let maxDepth = 0;
  for (const l of rawLinks) maxDepth = Math.max(maxDepth, l.tgtDepth);
  const MAX_PER_COL = 8;
  const depthNodes = new Map<number, { name: string; value: number }[]>();
  for (const [key, value] of nodeValueMap) {
    const pipeIdx = key.indexOf("|");
    const depth = Number(key.substring(0, pipeIdx));
    const name = key.substring(pipeIdx + 1);
    const arr = depthNodes.get(depth) ?? [];
    arr.push({ name, value });
    depthNodes.set(depth, arr);
  }
  const keptNodes = new Set<string>();
  for (const [depth, arr] of depthNodes) {
    arr.sort((a, b) => b.value - a.value);
    arr.slice(0, MAX_PER_COL).forEach(n => keptNodes.add(`${depth}|${n.name}`));
  }
  const filteredLinks = rawLinks.filter(l => keptNodes.has(`${l.srcDepth}|${l.src}`) && keptNodes.has(`${l.tgtDepth}|${l.tgt}`));
  const CHART_H = 500; const NODE_PAD = 6;
  const nodes: SankeyNode[] = [];
  const nodeMap = new Map<string, SankeyNode>();
  for (let d = 0; d <= maxDepth; d++) {
    const col = (depthNodes.get(d) ?? []).filter(n => keptNodes.has(`${d}|${n.name}`)).sort((a, b) => b.value - a.value);
    const totalVal = col.reduce((a, n) => a + n.value, 0);
    const usableH = CHART_H - (col.length - 1) * NODE_PAD;
    let yOff = 0;
    for (const n of col) {
      const h = Math.max(4, (n.value / totalVal) * usableH);
      const id = `${d}|${n.name}`;
      const node: SankeyNode = { id, label: n.name, depth: d, value: n.value, y: yOff, height: h };
      nodes.push(node); nodeMap.set(id, node); yOff += h + NODE_PAD;
    }
  }
  const srcOffsets = new Map<string, number>(); const tgtOffsets = new Map<string, number>();
  const links: SankeyLink[] = [];
  filteredLinks.sort((a, b) => b.value - a.value);
  for (const l of filteredLinks) {
    const srcNode = nodeMap.get(`${l.srcDepth}|${l.src}`);
    const tgtNode = nodeMap.get(`${l.tgtDepth}|${l.tgt}`);
    if (!srcNode || !tgtNode) continue;
    const thickness = Math.max(1, (l.value / srcNode.value) * srcNode.height);
    const sy = srcNode.y + (srcOffsets.get(srcNode.id) ?? 0);
    const ty = tgtNode.y + (tgtOffsets.get(tgtNode.id) ?? 0);
    srcOffsets.set(srcNode.id, (srcOffsets.get(srcNode.id) ?? 0) + thickness);
    tgtOffsets.set(tgtNode.id, (tgtOffsets.get(tgtNode.id) ?? 0) + thickness);
    links.push({ source: srcNode.id, target: tgtNode.id, value: l.value, sy, ty, thickness });
  }
  return { nodes, links, maxDepth };
}

// ---------------------------------------------------------------------------
// SubTabBar — shared sub-tab navigation bar
// ---------------------------------------------------------------------------
function SubTabBar<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: "7px 16px", border: "none", borderBottom: active === t.id ? `2px solid ${BLUE}` : "2px solid transparent",
          background: "transparent", color: active === t.id ? BLUE : "rgba(128,128,128,0.7)",
          fontSize: 13, fontWeight: active === t.id ? 700 : 400, cursor: "pointer", marginBottom: -1,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ===========================================================================
// SUB-TAB 1: Navigation Paths — rectangular columnar graph + tables
// (Graph layout ported from user-journey-app NavigationPathsTab)
// ===========================================================================

const NavigationPathsSubTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;
  const pages = useDql(topPagesQuery(timeframeDays, sel), [timeframeDays, sel]);
  const transitions = useDql(pageTransitionsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const pageBucketed = useDql(pagesBucketedMetricsQuery(timeframeDays, sel, bucketLabel), [timeframeDays, sel, bucketLabel]);
  const pageSpk = useBucketedSums(pageBucketed.data?.records, ["views", "errors"] as const);
  const [minTransitions, setMinTransitions] = useState(3);
  const [selectedFlow, setSelectedFlow] = useState<{ src: string; tgt: string } | null>(null);

  const pageRows = useMemo(() =>
    (pages.data?.records ?? []).map((r: any) => ({
      application: String(r.application ?? ""),
      name: String(r.name ?? ""),
      type: String(r.type ?? ""),
      views: Number(r.views ?? 0),
      avgDuration: Number(r.avgDuration ?? 0),
      errors: Number(r.errors ?? 0),
      errRate: Number(r.views ?? 0) > 0 ? (Number(r.errors ?? 0) / Number(r.views ?? 0)) * 100 : 0,
    })), [pages.data]);

  const transitionRows = useMemo(() => {
    const agg: Record<string, { application: string; from: string; to: string; transitions: number }> = {};
    (transitions.data?.records ?? []).forEach((r: any) => {
      const app = String(r.application ?? "");
      const path: string[] = Array.isArray(r.path) ? r.path : [];
      for (let i = 0; i < path.length - 1; i++) {
        const from = String(path[i] ?? ""); const to = String(path[i + 1] ?? "");
        if (!from || !to || from === to) continue;
        const key = `${app}${from}${to}`;
        if (!agg[key]) agg[key] = { application: app, from, to, transitions: 0 };
        agg[key].transitions += 1;
      }
    });
    return Object.values(agg).sort((a, b) => b.transitions - a.transitions).filter(r => r.transitions >= minTransitions);
  }, [transitions.data, minTransitions]);

  // Build columnar graph (rectangular nodes in columns — ported from user-journey-app NavigationPathsTab)
  const graphData = useMemo(() => {
    if (transitionRows.length === 0) return null;

    const allPages = new Set<string>();
    transitionRows.forEach(t => { allPages.add(t.from); allPages.add(t.to); });

    // Build in/out degree from transitions
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    transitionRows.forEach(t => {
      outDeg.set(t.from, (outDeg.get(t.from) ?? 0) + t.transitions);
      inDeg.set(t.to, (inDeg.get(t.to) ?? 0) + t.transitions);
    });

    // View counts and error rate per page (for node display)
    const viewsByPage = new Map<string, number>();
    const errRateByPage = new Map<string, number>();
    pageRows.forEach(r => {
      viewsByPage.set(r.name, (viewsByPage.get(r.name) ?? 0) + r.views);
      errRateByPage.set(r.name, r.errRate);
    });

    // Assign layers via BFS from entry pages (pages with no incoming transitions)
    const pageLayer = new Map<string, number>();
    for (const page of allPages) {
      if ((inDeg.get(page) ?? 0) === 0 && (outDeg.get(page) ?? 0) > 0) pageLayer.set(page, 0);
    }
    // Fallback: no clear entry pages — seed layer 0 with top 2 pages by views
    if (pageLayer.size === 0) {
      Array.from(allPages)
        .sort((a, b) => (viewsByPage.get(b) ?? 0) - (viewsByPage.get(a) ?? 0))
        .slice(0, 2)
        .forEach(p => pageLayer.set(p, 0));
    }
    // BFS forward (4 passes, mirroring user-journey-app's multi-pass approach)
    for (let pass = 0; pass < 4; pass++) {
      for (const t of transitionRows) {
        const l = pageLayer.get(t.from);
        if (l !== undefined && !pageLayer.has(t.to)) pageLayer.set(t.to, l + 1);
      }
    }
    // Assign remaining unresolved pages to the middle layer
    const maxAssigned = pageLayer.size > 0 ? Math.max(...Array.from(pageLayer.values())) : 0;
    for (const page of allPages) {
      if (!pageLayer.has(page)) pageLayer.set(page, Math.floor(maxAssigned / 2));
    }
    // Cap at 7 layers to keep the diagram legible
    for (const [p, l] of pageLayer) pageLayer.set(p, Math.min(7, l));

    // Group pages by layer, sort by transition volume, cap at 6 per column
    const MAX_PER_LAYER = 6;
    const layerPagesMap = new Map<number, { name: string; volume: number }[]>();
    for (const [page, layer] of pageLayer) {
      const vol = (inDeg.get(page) ?? 0) + (outDeg.get(page) ?? 0);
      const arr = layerPagesMap.get(layer) ?? [];
      arr.push({ name: page, volume: vol });
      layerPagesMap.set(layer, arr);
    }
    for (const [, arr] of layerPagesMap) arr.sort((a, b) => b.volume - a.volume);
    const layerDisplayPages = new Map<number, { name: string; volume: number }[]>();
    for (const [layer, arr] of layerPagesMap) layerDisplayPages.set(layer, arr.slice(0, MAX_PER_LAYER));

    // Layout constants (from user-journey-app)
    const nodeW = 220, nodeH = 52, padX = 60, padY = 20, colWidth = nodeW + 140;
    const layers = Array.from(layerDisplayPages.keys()).sort((a, b) => a - b);
    const numLayers = layers.length || 1;
    const W = padX * 2 + numLayers * colWidth;
    const maxLayerNodes = Math.max(...Array.from(layerDisplayPages.values()).map(a => a.length), 1);
    const H = Math.max(450, maxLayerNodes * (nodeH + padY) + 100);

    // Compute node positions
    const nodePos = new Map<string, { x: number; y: number; h: number; views: number; errRate: number }>();
    const visiblePages = new Set<string>();
    layers.forEach((layer, li) => {
      const arr = layerDisplayPages.get(layer) ?? [];
      const totalH = arr.length * nodeH + Math.max(0, arr.length - 1) * padY;
      const startY = (H - totalH) / 2;
      let yOff = startY;
      arr.forEach(p => {
        nodePos.set(p.name, {
          x: padX + li * colWidth,
          y: yOff,
          h: nodeH,
          views: viewsByPage.get(p.name) ?? 0,
          errRate: errRateByPage.get(p.name) ?? 0,
        });
        visiblePages.add(p.name);
        yOff += nodeH + padY;
      });
    });

    // Build links between visible nodes (forward links only)
    const links: { src: string; tgt: string; value: number }[] = [];
    transitionRows.forEach(t => {
      if (!visiblePages.has(t.from) || !visiblePages.has(t.to) || t.from === t.to) return;
      const sl = pageLayer.get(t.from) ?? 0;
      const tl2 = pageLayer.get(t.to) ?? 0;
      if (tl2 >= sl) links.push({ src: t.from, tgt: t.to, value: t.transitions });
    });
    const sortedLinks = links.sort((a, b) => b.value - a.value).slice(0, 50);
    const maxLinkVal = Math.max(...sortedLinks.map(l => l.value), 1);

    return { nodePos, sortedLinks, maxLinkVal, W, H, nodeW, nodeH, layers, padX, colWidth };
  }, [pageRows, transitionRows]);

  const totalViews = pageRows.reduce((a, r) => a + r.views, 0);
  const uniquePages = new Set(pageRows.map(r => r.name)).size;

  const maxViews = Math.max(1, ...pageRows.map(r => r.views));
  const maxTrans = Math.max(1, ...transitionRows.map(r => r.transitions));

  // Parse bucketed page data into Map<bucketKey, Map<pageName, metrics>> for flow graph timelapse
  const tlPageBuckets = useMemo(() => {
    const out = new Map<string, Map<string, { views: number; errors: number; errRate: number; avgDur: number }>>();
    (pageBucketed.data?.records ?? []).forEach((r: any) => {
      const bkt = String(r.bkt ?? ""); const page = String(r.page ?? "");
      if (!bkt || !page) return;
      let inner = out.get(bkt); if (!inner) { inner = new Map(); out.set(bkt, inner); }
      const views = Number(r.views ?? 0); const errors = Number(r.errors ?? 0);
      inner.set(page, { views, errors, errRate: views > 0 ? (errors / views) * 100 : 0, avgDur: Number(r.avgDuration ?? 0) });
    });
    return out;
  }, [pageBucketed.data]);

  const tlBktList = useMemo(() => Array.from(tlPageBuckets.keys()).sort(), [tlPageBuckets]);

  useEffect(() => {
    if (!tl.enabled || tlBktList.length === 0) return;
    tl.reportBuckets(tlBktList.length, tlBktList[Math.min(tl.index, tlBktList.length - 1)]);
  }, [tl.enabled, tlBktList, tl.index]);

  useEffect(() => {
    if (!tl.enabled) return;
    tl.reportLoading("navflow", !!pageBucketed.loading);
    return () => tl.reportLoading("navflow", false);
  }, [tl.enabled, pageBucketed.loading]);

  // Current bucket's per-page data for node coloring
  const tlCurrentPageMap = useMemo(() => {
    if (!tl.enabled || tlBktList.length === 0) return null;
    return tlPageBuckets.get(tlBktList[Math.min(tl.index, tlBktList.length - 1)]) ?? null;
  }, [tl.enabled, tlPageBuckets, tlBktList, tl.index]);

  const { bucketValuesBySort: pageBucket } = useBucketedRanks({
    records: (pageBucketed.data?.records ?? []) as any[],
    rowKeyField: "page", bucketField: "bkt",
    metricFields: ["views", "sessions", "errors", "avgDuration"],
  });
  const pageBucketBySort = useMemo(() => {
    const remap = (src: Record<string, (number | null)[]>) => {
      const out: Record<string, (number | null)[]> = {};
      for (const r of pageRows) out[`${r.application}::${r.name}`] = src[r.name] ?? [];
      return out;
    };
    return { views: remap(pageBucket.views ?? {}), avgDuration: remap(pageBucket.avgDuration ?? {}), errors: remap(pageBucket.errors ?? {}), errRate: remap(pageBucket.errors ?? {}) };
  }, [pageBucket, pageRows]);
  const pageSortOptions: TLSortOption<typeof pageRows[number]>[] = useMemo(() => [
    { value: "views",       label: "Views",        get: r => r.views,       higherIsBetter: true },
    { value: "avgDuration", label: "Avg duration", get: r => r.avgDuration, higherIsBetter: false },
    { value: "errors",      label: "Errors",       get: r => r.errors,      higherIsBetter: false },
    { value: "errRate",     label: "Err %",        get: r => r.errRate,     higherIsBetter: false },
  ], []);

  const nodeColorOf = (errRate: number) => errRate > 5 ? RED : errRate > 1 ? YELLOW : BLUE;
  const LINK_COLORS = [BLUE, CYAN, PURPLE, GREEN, ORANGE, YELLOW];

  if (!sel) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, opacity: 0.75 }}>Select a web app to view navigation paths</div>
        <div style={{ fontSize: 12, opacity: 0.45 }}>Use the Web App dropdown at the top of the page to choose an app.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Unique pages" value={fmt.num(uniquePages)} rawValue={uniquePages} color={BLUE} sparkline={pageSpk?.views} />
        <KpiCard label="Total page views" value={fmt.num(totalViews)} rawValue={totalViews} color={CYAN} sparkline={pageSpk?.views} />
        <KpiCard label="Transitions shown" value={fmt.num(transitionRows.length)} rawValue={transitionRows.length} color="#A56EFF" sparkline={pageSpk?.views} />
      </div>

      {/* Columnar Navigation Flow Graph — layout ported from user-journey-app NavigationPathsTab */}
      <SectionCard title="Navigation Flow Graph" subtitle="Rectangular columnar layout — columns represent navigation steps. Node color = error rate. Edge thickness = transition volume.">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, padding: "0 4px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>Min transitions:</span>
          <input type="range" min={1} max={30} value={minTransitions} onChange={e => setMinTransitions(Number(e.target.value))} style={{ width: 120 }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>{minTransitions}</span>
          <div style={{ display: "flex", gap: 16, marginLeft: 16, fontSize: 11, opacity: 0.7 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: BLUE, marginRight: 4 }} />Low err</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: YELLOW, marginRight: 4 }} />&gt;1%</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: RED, marginRight: 4 }} />&gt;5%</span>
          </div>
          {tl.enabled && tlBktList.length > 0 && (
            <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7, fontFamily: "monospace" }}>
              ⏱ {tlBktList[Math.min(tl.index, tlBktList.length - 1)]}
            </span>
          )}
          {selectedFlow && (
            <button onClick={() => setSelectedFlow(null)} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, color: "rgba(255,255,255,0.7)", cursor: "pointer", padding: "2px 10px", fontSize: 12 }}>Clear selection</button>
          )}
        </div>
        {(pages.loading || transitions.loading) ? <EmptyState loading /> :
          !graphData ? <EmptyState error="No page transition data available" /> : (
          <div style={{ overflowX: "auto" }}>
            <svg width={graphData.W} height={graphData.H}
              style={{ display: "block", background: "rgba(6,10,20,0.95)", borderRadius: 8 }}
              onClick={() => setSelectedFlow(null)}>
              {/* Column step labels */}
              {graphData.layers.map((_, li) => (
                <text key={`col-${li}`}
                  x={graphData.padX + li * graphData.colWidth + graphData.nodeW / 2}
                  y={18}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.35)"
                  fontSize={10}
                  fontWeight={600}
                >
                  {`Step ${li + 1}`}
                </text>
              ))}
              {/* Links (bezier curves, like user-journey-app) */}
              {graphData.sortedLinks.map((link, i) => {
                const sp = graphData.nodePos.get(link.src);
                const tp = graphData.nodePos.get(link.tgt);
                if (!sp || !tp) return null;
                const thickness = Math.max(1.5, (link.value / graphData.maxLinkVal) * 14);
                const x1 = sp.x + graphData.nodeW;
                const x2 = tp.x;
                const y1 = sp.y + sp.h / 2;
                const y2 = tp.y + tp.h / 2;
                const cx1 = x1 + (x2 - x1) * 0.4;
                const cx2 = x1 + (x2 - x1) * 0.6;
                const color = LINK_COLORS[i % LINK_COLORS.length];
                const isSelected = selectedFlow?.src === link.src && selectedFlow?.tgt === link.tgt;
                const hasFocus = selectedFlow !== null;
                const opacity = hasFocus ? (isSelected ? 0.9 : 0.06) : 0.35;
                return (
                  <path key={i}
                    d={`M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? thickness * 1.4 : thickness}
                    strokeOpacity={opacity}
                    style={{ cursor: "pointer", transition: "stroke-opacity 0.2s" }}
                    onClick={e => { e.stopPropagation(); setSelectedFlow(prev => prev?.src === link.src && prev?.tgt === link.tgt ? null : { src: link.src, tgt: link.tgt }); }}
                  >
                    <title>{`${link.src} → ${link.tgt}: ${fmtCount(link.value)} transitions`}</title>
                  </path>
                );
              })}
              {/* Nodes (rectangles, like user-journey-app) */}
              {Array.from(graphData.nodePos.entries()).map(([name, pos]) => {
                const tlData = tlCurrentPageMap?.get(name);
                const dispErrRate = tlData ? tlData.errRate : pos.errRate;
                const dispViews   = tlData ? tlData.views   : pos.views;
                const color = nodeColorOf(dispErrRate);
                const shortName = name.length > 26 ? name.substring(0, 24) + "…" : name;
                const isSelected = selectedFlow?.src === name || selectedFlow?.tgt === name;
                const hasFocus = selectedFlow !== null;
                const nodeOpacity = hasFocus ? (isSelected ? 1 : 0.15) : (tlCurrentPageMap && !tlData ? 0.35 : 1);
                return (
                  <g key={name} style={{ opacity: nodeOpacity, transition: "opacity 0.3s, stroke 0.3s", cursor: "default" }}>
                    <rect
                      x={pos.x} y={pos.y} width={graphData.nodeW} height={pos.h} rx={6}
                      fill={`${color}18`}
                      stroke={color}
                      strokeWidth={tlCurrentPageMap && tlData ? 2.5 : 1.5}
                      strokeOpacity={0.85}
                    />
                    <text x={pos.x + 10} y={pos.y + 18}
                      fontSize={12} fill={color} fontWeight={700}
                      style={{ dominantBaseline: "middle" } as any}>
                      {shortName}
                    </text>
                    <text x={pos.x + 10} y={pos.y + 38}
                      fontSize={10} fill="rgba(255,255,255,0.65)">
                      {`${fmtCount(dispViews)} views${dispErrRate > 0 ? ` · ${fmtPct(dispErrRate)} err` : ""}`}
                    </text>
                    <title>{`${name}\nViews: ${fmtCount(dispViews)}\nErr rate: ${fmtPct(dispErrRate)}${tlData ? "\n(timelapse bucket)" : ""}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Top pages per Web App" subtitle="Ranked by page views.">
        {pages.loading ? <EmptyState loading /> : pageRows.length === 0 ? <EmptyState error={pages.error} /> : (
          <TimelapseTable
            data={pageRows}
            columns={[
              { id: "application", header: "Web App", accessor: "application", width: 180, cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
              { id: "name", header: "Page", accessor: "name", width: 340, cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
              { id: "type", header: "Type", accessor: "type", width: 110 },
              { id: "views", header: "Views", accessor: "views", width: 180, sortType: "number" as any, cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxViews} /> },
              { id: "avgDuration", header: "Avg duration", accessor: "avgDuration", width: 130, sortType: "number" as any, cell: ({ value }: any) => <span>{fmt.ms(Number(value))}</span> },
              { id: "errors", header: "Errors", accessor: "errors", width: 100, sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: Number(value) > 0 ? RED : undefined }}>{fmt.num(Number(value))}</span> },
              { id: "errRate", header: "Err %", accessor: "errRate", width: 90, sortType: "number" as any, cell: ({ value }: any) => <span>{fmt.pct(Number(value))}</span> },
            ]}
            rowKey={(r: any) => `${r.application}::${r.name}`}
            firstColumnField="application"
            sortOptions={pageSortOptions}
            defaultSort="views"
            bucketValuesBySort={pageBucketBySort}
          />
        )}
      </SectionCard>

      <SectionCard title="Page transitions (From → To)"
        subtitle={`Observed navigation edges. Minimum ${minTransitions} transitions.`}
        actions={<input type="range" min={1} max={50} value={minTransitions} onChange={e => setMinTransitions(Number(e.target.value))} style={{ width: 140 }} title={`min: ${minTransitions}`} />}>
        {transitions.loading ? <EmptyState loading /> : transitionRows.length === 0 ? <EmptyState error={transitions.error} /> : (
          <TimelapseTable
            data={transitionRows}
            columns={[
              { id: "application", header: "Web App", accessor: "application", width: 180, cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{String(value)}</span> },
              { id: "from", header: "From", accessor: "from", width: 280, cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
              { id: "arrow", header: "→", accessor: "arrow", width: 30, cell: () => <span style={{ opacity: 0.5 }}>→</span> },
              { id: "to", header: "To", accessor: "to", width: 280, cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(value)}</span> },
              { id: "transitions", header: "Transitions", accessor: "transitions", width: 200, sortType: "number" as any, cell: ({ value }: any) => <InlineBar value={Number(value)} max={maxTrans} color="#A56EFF" /> },
            ]}
            rowKey={(r: any) => `${r.application}::${r.from}->${r.to}`}
            firstColumnField="application"
            sortOptions={[{ value: "transitions", label: "Transitions", get: r => Number(r.transitions), higherIsBetter: true }]}
            defaultSort="transitions"
          />
        )}
      </SectionCard>
    </div>
  );
};

// ===========================================================================
// SUB-TAB 2: Sankey — page path flow visualization
// ===========================================================================

const SANKEY_COLORS = [BLUE, CYAN, "#A56EFF", ORANGE, GREEN, "#FF6B9D", "#FFD700", "#7FDBFF"];

function sankeyNodeColor(label: string, depth: number): string {
  return SANKEY_COLORS[depth % SANKEY_COLORS.length];
}

type SankeyStyle = "classic" | "gradient" | "directed" | "alluvial" | "stateMachine" | "chord" | "heatmap";
const SANKEY_STYLE_OPTIONS: { value: SankeyStyle; label: string }[] = [
  { value: "classic",      label: "Classic Sankey" },
  { value: "gradient",     label: "Gradient Sankey" },
  { value: "directed",     label: "Directed Flow Graph" },
  { value: "alluvial",     label: "Alluvial / Columnar" },
  { value: "stateMachine", label: "State Machine" },
  { value: "chord",        label: "Chord Diagram" },
  { value: "heatmap",      label: "Transition Heatmap" },
];
function cwvClr(val: number, metric: keyof typeof CWV): string { return val <= CWV[metric].good ? GREEN : val <= CWV[metric].poor ? YELLOW : RED; }

const SankeySubTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const flowData    = useDql(sankeyFlowQuery(timeframeDays, sel), [timeframeDays, sel]);
  const pathsData   = useDql(sankeyExtendedPathsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const durData     = useDql(sankeyPageDurationQuery(timeframeDays, sel), [timeframeDays, sel]);
  const prevData    = useDql(sankeyPrevPathsQuery(timeframeDays, sel), [timeframeDays, sel]);
  const tlData      = useDql(tl.enabled ? sankeyTimelapseQuery(timeframeDays, sel, bucketLabel) : null, [timeframeDays, sel, tl.enabled, bucketLabel]);

  const [subTab, setSubTab] = useState<SankeySubTabId>("flow");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [chartStyle, setChartStyle] = useState<SankeyStyle>("classic");
  const [focusMode, setFocusMode] = useState(false);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);

  // Time-lapse bucket management
  const tlBuckets = useMemo(() => {
    const m = new Map<string, any[]>();
    (tlData.data?.records ?? []).forEach(r => {
      const b = String(r.bucket ?? "");
      if (!b) return;
      const arr = m.get(b) ?? [];
      arr.push(r);
      m.set(b, arr);
    });
    return m;
  }, [tlData.data]);
  const tlBucketList = useMemo(() => Array.from(tlBuckets.keys()).sort(), [tlBuckets]);

  const sankeyTlActive = tl.enabled && subTab === "flow";
  useEffect(() => {
    if (!sankeyTlActive) return;
    const key = tlBucketList.length > 0 ? tlBucketList[Math.min(tl.index, tlBucketList.length - 1)] ?? "" : "";
    tl.reportBuckets(tlBucketList.length, key);
  }, [sankeyTlActive, tlBucketList, tl.index]);

  useEffect(() => {
    if (!tl.enabled) return;
    tl.reportLoading("sankey", !!tlData.loading);
    return () => tl.reportLoading("sankey", false);
  }, [tl.enabled, tlData.loading]);

  const allRecords = (flowData.data?.records ?? []) as any[];
  const tlBucketRecords = useMemo(() => {
    if (!sankeyTlActive || tlBucketList.length === 0) return null;
    const key = tlBucketList[Math.min(tl.index, tlBucketList.length - 1)];
    return tlBuckets.get(key) ?? [];
  }, [sankeyTlActive, tlBucketList, tlBuckets, tl.index]);

  const records = tlBucketRecords ?? allRecords;
  const { nodes, links, maxDepth } = useMemo(() => buildSankey(records), [records]);

  // Connected nodes/links for classic Sankey focus
  const { connectedNodes, connectedLinks } = useMemo(() => {
    if (!focusNodeId) return { connectedNodes: new Set<string>(), connectedLinks: new Set<number>() };
    const cn = new Set<string>([focusNodeId]);
    const cl = new Set<number>();
    links.forEach((l, i) => {
      if (l.source === focusNodeId || l.target === focusNodeId) { cl.add(i); cn.add(l.source); cn.add(l.target); }
    });
    return { connectedNodes: cn, connectedLinks: cl };
  }, [focusNodeId, links]);

  // Connected label set for directed/alluvial/stateMachine focus
  const connectedLabelSet = useMemo(() => {
    if (!focusLabel) return new Set<string>();
    const cl = new Set<string>([focusLabel]);
    for (const l of links) {
      const src = nodes.find(n => n.id === l.source);
      const tgt = nodes.find(n => n.id === l.target);
      if (src && tgt) {
        if (src.label === focusLabel) cl.add(tgt.label);
        if (tgt.label === focusLabel) cl.add(src.label);
      }
    }
    return cl;
  }, [focusLabel, links, nodes]);

  // Exit node detection: nodes with outbound < 30% of their value
  const exitNodeIds = useMemo(() => {
    const outboundByNode = new Map<string, number>();
    for (const l of links) outboundByNode.set(l.source, (outboundByNode.get(l.source) ?? 0) + l.value);
    const exitIds = new Set<string>();
    for (const n of nodes) {
      const outbound = outboundByNode.get(n.id) ?? 0;
      if (n.value > 0 && outbound < n.value * 0.3) exitIds.add(n.id);
    }
    return exitIds;
  }, [nodes, links]);

  // Exit labels aggregated across depths (for alternate chart types)
  const exitLabels = useMemo(() => {
    const labelOutboundMap = new Map<string, number>();
    const labelValueMap = new Map<string, number>();
    for (const l of links) {
      const src = nodes.find(n => n.id === l.source);
      if (src) labelOutboundMap.set(src.label, (labelOutboundMap.get(src.label) ?? 0) + l.value);
    }
    for (const n of nodes) labelValueMap.set(n.label, Math.max(labelValueMap.get(n.label) ?? 0, n.value));
    const exitSet = new Set<string>();
    for (const [label, value] of labelValueMap) {
      const outbound = labelOutboundMap.get(label) ?? 0;
      if (value > 0 && outbound < value * 0.3) exitSet.add(label);
    }
    return exitSet;
  }, [nodes, links]);

  // Page timing
  const durationMap = useMemo(() => {
    const m = new Map<string, { avgDuration: number; p90Duration: number; sessions: number }>();
    for (const r of (durData.data?.records ?? []) as any[]) {
      m.set(String(r.pageName ?? ""), { avgDuration: Number(r.avgDuration ?? 0), p90Duration: Number(r.p90Duration ?? 0), sessions: Number(r.sessions ?? 0) });
    }
    return m;
  }, [durData.data]);

  // Loop analysis from extended paths
  const loopAnalysis = useMemo(() => {
    const loopMap = new Map<string, { page: string; loopSessions: number; totalLoops: number }>();
    for (const r of (pathsData.data?.records ?? []) as any[]) {
      const path: string[] = (r.path ?? []).map((p: any) => String(p));
      const seen = new Map<string, number>();
      for (const pg of path) seen.set(pg, (seen.get(pg) ?? 0) + 1);
      for (const [pg, cnt] of seen) {
        if (cnt < 2) continue;
        const d = loopMap.get(pg) ?? { page: pg, loopSessions: 0, totalLoops: 0 };
        d.loopSessions++; d.totalLoops += cnt - 1;
        loopMap.set(pg, d);
      }
    }
    return Array.from(loopMap.values()).sort((a, b) => b.loopSessions - a.loopSessions).slice(0, 20);
  }, [pathsData.data]);

  // Endpoint analysis
  const endpointAnalysis = useMemo(() => {
    const entryMap = new Map<string, number>(); const exitMap = new Map<string, number>();
    for (const r of (pathsData.data?.records ?? []) as any[]) {
      const path: string[] = (r.path ?? []).map((p: any) => String(p));
      if (path.length < 1) continue;
      const entry = path[0]; const exit = path[path.length - 1];
      entryMap.set(entry, (entryMap.get(entry) ?? 0) + 1);
      exitMap.set(exit, (exitMap.get(exit) ?? 0) + 1);
    }
    const entries = Array.from(entryMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([page, count]) => ({ page, count, type: "entry" as const }));
    const exits = Array.from(exitMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([page, count]) => ({ page, count, type: "exit" as const }));
    return { entries, exits };
  }, [pathsData.data]);

  // Path trends: current vs prev period edge weights
  const pathTrends = useMemo(() => {
    function buildEdgeMap(records: any[]): Map<string, number> {
      const m = new Map<string, number>();
      for (const r of records) {
        const path: string[] = (r.path ?? []).map((p: any) => String(p));
        for (let i = 0; i < path.length - 1; i++) {
          const k = `${path[i]}|||${path[i + 1]}`;
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      return m;
    }
    const curr = buildEdgeMap((pathsData.data?.records ?? []) as any[]);
    const prev = buildEdgeMap((prevData.data?.records ?? []) as any[]);
    const allKeys = new Set([...curr.keys(), ...prev.keys()]);
    return Array.from(allKeys).map(k => {
      const [from, to] = k.split("|||");
      const c = curr.get(k) ?? 0; const p = prev.get(k) ?? 0;
      const delta = p > 0 ? ((c - p) / p) * 100 : 0;
      return { from, to, current: c, previous: p, delta };
    }).sort((a, b) => b.current - a.current).slice(0, 30);
  }, [pathsData.data, prevData.data]);

  const sankeySubTabs: { id: SankeySubTabId; label: string }[] = [
    { id: "flow",       label: "Flow Chart" },
    { id: "loops",      label: "Loop Analysis" },
    { id: "timing",     label: "Page Timing" },
    { id: "endpoints",  label: "Session Endpoints" },
    { id: "pathTrends", label: "Path Trends" },
  ];

  const isLoading = flowData.loading;

  // ---- Computed values ----
  const totalSessions = records.reduce((a: number, r: any) => a + Number(r.sessions ?? r.d0 ?? 0), 0);
  const uniquePages = new Set(nodes.map(n => n.label)).size;
  const hasFocus = focusNodeId !== null;
  const focusNode = hasFocus ? nodes.find(n => n.id === focusNodeId) ?? null : null;
  const focusInbound = hasFocus ? links.filter(l => l.target === focusNodeId) : [];
  const focusOutbound = hasFocus ? links.filter(l => l.source === focusNodeId) : [];
  const focusSessions = focusNode?.value ?? 0;

  const labelNodeIds = focusLabel ? nodes.filter(n => n.label === focusLabel).map(n => n.id) : [];
  const labelInbound = focusLabel ? links.filter(l => labelNodeIds.includes(l.target)).reduce((acc, l) => {
    const src = nodes.find(n => n.id === l.source)!;
    const existing = acc.find(a => a.label === src.label);
    if (existing) existing.value += l.value; else acc.push({ label: src.label, value: l.value });
    return acc;
  }, [] as { label: string; value: number }[]).sort((a, b) => b.value - a.value) : [];
  const labelOutbound = focusLabel ? links.filter(l => labelNodeIds.includes(l.source)).reduce((acc, l) => {
    const tgt = nodes.find(n => n.id === l.target)!;
    const existing = acc.find(a => a.label === tgt.label);
    if (existing) existing.value += l.value; else acc.push({ label: tgt.label, value: l.value });
    return acc;
  }, [] as { label: string; value: number }[]).sort((a, b) => b.value - a.value) : [];
  const labelSessions = focusLabel ? nodes.filter(n => n.label === focusLabel).reduce((a, n) => Math.max(a, n.value), 0) : 0;
  const hasLabelFocus = focusLabel !== null;

  const handleLabelClick = (label: string) => setFocusLabel(prev => prev === label ? null : label);

  // ---- Chart rendering constants ----
  const appEntityId = "";
  const W = 960;
  const H = 540;
  const PAD = { top: 20, right: 140, bottom: 20, left: 140 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const colW = maxDepth > 0 ? innerW / maxDepth : innerW;
  const NODE_W = 18;
  const DEPTH_LABELS = ["Page 1", "Page 2", "Page 3", "Page 4", "Page 5"];
  const scaleY = innerH / 500;
  const truncLabel = (s: string, max = 22) => s.length > max ? s.substring(0, max) + "…" : s;

  // ---- Tooltip builders ----
  const buildNodeTooltip = (nodeId: string): string => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return "";
    const isExit = exitNodeIds.has(nodeId);
    const inb = links.filter(l => l.target === nodeId).map(l => { const src = nodes.find(n => n.id === l.source)!; return { label: src.label, value: l.value }; }).sort((a, b) => b.value - a.value);
    const outb = links.filter(l => l.source === nodeId).map(l => { const tgt = nodes.find(n => n.id === l.target)!; return { label: tgt.label, value: l.value }; }).sort((a, b) => b.value - a.value);
    const totalIn = inb.reduce((s, x) => s + x.value, 0);
    const totalOut = outb.reduce((s, x) => s + x.value, 0);
    const exits = Math.max(0, node.value - totalOut);
    const starts = Math.max(0, node.value - totalIn);
    const selfIn = inb.find(x => x.label === node.label);
    const selfReloadPct = selfIn && node.value > 0 ? (selfIn.value / node.value) * 100 : 0;
    const lines: string[] = [`${node.label}: ${fmtCount(node.value)} sessions${isExit ? " ⛔ Exit Point" : ""}`];
    if (starts > 0) lines.push(`← Starts: ${fmtCount(starts)} (${Math.round(node.value > 0 ? (starts / node.value) * 100 : 0)}% started here)`);
    if (exits > 0) lines.push(`→ Exits: ${fmtCount(exits)} (${Math.round(node.value > 0 ? (exits / node.value) * 100 : 0)}% left here)`);
    if (selfReloadPct > 5) lines.push(`⟲ Self-reload: ${Math.round(selfReloadPct)}% (${fmtCount(selfIn!.value)})`);
    if (inb.length > 0) { lines.push(`Inbound (${inb.length}):`); inb.slice(0, 3).forEach(x => { const pct = totalIn > 0 ? (x.value / totalIn) * 100 : 0; lines.push(`  ${Math.round(pct)}% (${fmtCount(x.value)})  ${x.label}`); }); }
    if (outb.length > 0) { lines.push(`Outbound (${outb.length}):`); outb.slice(0, 3).forEach(x => { const pct = totalOut > 0 ? (x.value / totalOut) * 100 : 0; lines.push(`  ${Math.round(pct)}% (${fmtCount(x.value)})  ${x.label}`); }); }
    return lines.join("\n");
  };

  const buildLabelTooltip = (label: string): string => {
    const matchNodes = nodes.filter(n => n.label === label);
    const totalVal = matchNodes.reduce((a, n) => Math.max(a, n.value), 0);
    const nodeIds = matchNodes.map(n => n.id);
    const isExit = exitLabels.has(label);
    const inb = links.filter(l => nodeIds.includes(l.target)).reduce((acc, l) => { const src = nodes.find(n => n.id === l.source)!; const ex = acc.find(a => a.label === src.label); if (ex) ex.value += l.value; else acc.push({ label: src.label, value: l.value }); return acc; }, [] as { label: string; value: number }[]).sort((a, b) => b.value - a.value);
    const outb = links.filter(l => nodeIds.includes(l.source)).reduce((acc, l) => { const tgt = nodes.find(n => n.id === l.target)!; const ex = acc.find(a => a.label === tgt.label); if (ex) ex.value += l.value; else acc.push({ label: tgt.label, value: l.value }); return acc; }, [] as { label: string; value: number }[]).sort((a, b) => b.value - a.value);
    const totalIn = inb.reduce((s, x) => s + x.value, 0);
    const totalOut = outb.reduce((s, x) => s + x.value, 0);
    const exits = Math.max(0, totalVal - totalOut);
    const starts = Math.max(0, totalVal - totalIn);
    const selfIn = inb.find(x => x.label === label);
    const selfReloadPct = selfIn && totalVal > 0 ? (selfIn.value / totalVal) * 100 : 0;
    const lines: string[] = [`${label}: ${fmtCount(totalVal)} sessions${isExit ? " ⛔ Exit Point" : ""}`];
    if (starts > 0) lines.push(`← Starts: ${fmtCount(starts)} (${Math.round(totalVal > 0 ? (starts / totalVal) * 100 : 0)}% started here)`);
    if (exits > 0) lines.push(`→ Exits: ${fmtCount(exits)} (${Math.round(totalVal > 0 ? (exits / totalVal) * 100 : 0)}% left here)`);
    if (selfReloadPct > 5) lines.push(`⟲ Self-reload: ${Math.round(selfReloadPct)}% (${fmtCount(selfIn!.value)})`);
    if (inb.length > 0) { lines.push(`Inbound (${inb.length}):`); inb.slice(0, 3).forEach(x => { const pct = totalIn > 0 ? (x.value / totalIn) * 100 : 0; lines.push(`  ${Math.round(pct)}% (${fmtCount(x.value)})  ${x.label}`); }); }
    if (outb.length > 0) { lines.push(`Outbound (${outb.length}):`); outb.slice(0, 3).forEach(x => { const pct = totalOut > 0 ? (x.value / totalOut) * 100 : 0; lines.push(`  ${Math.round(pct)}% (${fmtCount(x.value)})  ${x.label}`); }); }
    return lines.join("\n");
  };

  // ---- renderLabelPopup ----
  const renderLabelPopup = () => {
    if (!focusLabel) return null;
    const totalIn = labelInbound.reduce((s, l) => s + l.value, 0);
    const totalOut = labelOutbound.reduce((s, l) => s + l.value, 0);
    const starts = Math.max(0, labelSessions - totalIn);
    const exits = Math.max(0, labelSessions - totalOut);
    const startPct = labelSessions > 0 ? (starts / labelSessions) * 100 : 0;
    const exitPct = labelSessions > 0 ? (exits / labelSessions) * 100 : 0;
    return (
      <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(69,137,255,0.08)", borderRadius: 8, borderLeft: "3px solid " + BLUE }}>
        <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
          <Strong style={{ fontSize: 13 }}>{focusLabel}</Strong>
          <Text style={{ fontSize: 12, opacity: 0.5 }}>{fmtCount(labelSessions)} sessions</Text>
          <button onClick={() => setFocusLabel(null)} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, color: "rgba(255,255,255,0.6)", cursor: "pointer", padding: "2px 8px", fontSize: 12 }}>Clear</button>
        </Flex>
        {(starts > 0 || exits > 0) && (
          <Flex gap={6} flexWrap="wrap" style={{ marginBottom: 8 }}>
            {starts > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.3)", color: BLUE, fontWeight: 700 }}>← Starts: {fmtCount(starts)} ({Math.round(startPct)}%)</span>}
            {exits > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(194,25,48,0.12)", border: "1px solid rgba(194,25,48,0.3)", color: RED, fontWeight: 700 }}>→ Exits: {fmtCount(exits)} ({Math.round(exitPct)}%)</span>}
          </Flex>
        )}
        {labelInbound.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, opacity: 0.5 }}>Inbound ({labelInbound.length}):</Text>
            <Flex gap={6} flexWrap="wrap" style={{ marginTop: 2 }}>
              {labelInbound.slice(0, 8).map((l, i) => (
                <span key={i} style={{ fontSize: 12, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }} title={l.label}>{truncLabel(l.label, 30)} <Strong style={{ color: CYAN }}>{fmtCount(l.value)}</Strong></span>
              ))}
            </Flex>
          </div>
        )}
        {labelOutbound.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 12, opacity: 0.5 }}>Outbound ({labelOutbound.length}):</Text>
            <Flex gap={6} flexWrap="wrap" style={{ marginTop: 2 }}>
              {labelOutbound.slice(0, 8).map((l, i) => {
                const isExitLbl = exitLabels.has(l.label);
                return <span key={i} style={{ fontSize: 12, padding: "1px 6px", borderRadius: 3, background: isExitLbl ? "rgba(194,25,48,0.1)" : "rgba(255,255,255,0.06)", border: isExitLbl ? "1px solid rgba(194,25,48,0.2)" : "none" }} title={l.label}>{isExitLbl ? "↗ " : ""}{truncLabel(l.label, 30)} <Strong style={{ color: isExitLbl ? RED : GREEN }}>{fmtCount(l.value)}</Strong></span>;
              })}
            </Flex>
          </div>
        )}
      </div>
    );
  };

  // ---- chartHeader ----
  const chartHeader = (
    <div style={{ marginBottom: 12 }}>
      <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Sankey Flow Diagram</span>
        <Flex alignItems="center" gap={8}>
          <button
            style={{ background: focusMode ? "rgba(69,137,255,0.25)" : "rgba(99,130,191,0.15)", border: focusMode ? "1px solid rgba(69,137,255,0.6)" : "1px solid rgba(99,130,191,0.3)", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: focusMode ? "#4589FF" : "rgba(128,128,128,0.8)", cursor: "pointer", fontWeight: focusMode ? 700 : 400 }}
            onClick={() => setFocusMode(!focusMode)}
            title={focusMode ? "Focus Mode: ON — unrelated nodes hidden on click" : "Focus Mode: OFF — unrelated nodes dimmed on click"}
          >
            Focus: {focusMode ? "ON" : "OFF"}
          </button>
          <Text style={{ fontSize: 13, opacity: 0.5 }}>Chart Style</Text>
          <select value={chartStyle} onChange={e => setChartStyle(e.target.value as SankeyStyle)} style={{ minWidth: 170, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.3)", background: "rgba(30,30,40,0.95)", color: "rgba(255,255,255,0.85)", fontSize: 12, cursor: "pointer" }}>
            {SANKEY_STYLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Flex>
      </Flex>
      <Text style={{ fontSize: 12, opacity: 0.5 }}>
        {SANKEY_STYLE_OPTIONS.find(o => o.value === chartStyle)?.label}: User navigation flows. Top {nodes.length} page nodes shown.{sankeyTlActive && tlBucketList.length > 0 ? ` · Time-Lapse: ${tlBucketList.length} snapshots` : ""}
      </Text>
      <Flex gap={16} flexWrap="wrap" style={{ margin: "8px 0" }}>
        <KpiCard label="Total Sessions" value={fmtCount(totalSessions)} color={BLUE} rawValue={totalSessions} />
        <KpiCard label="Unique Pages" value={String(uniquePages)} color={PURPLE} rawValue={uniquePages} />
        <KpiCard label="Flow Transitions" value={String(links.length)} color={CYAN} rawValue={links.length} />
        <KpiCard label="Max Depth" value={`${maxDepth + 1} pages`} color={GREEN} rawValue={maxDepth + 1} />
      </Flex>
      <Flex gap={12} alignItems="center" style={{ padding: "4px 0", flexWrap: "wrap" }}>
        <Flex gap={4} alignItems="center"><span style={{ width: 12, height: 12, borderRadius: 2, background: RED, display: "inline-block" }} /><Text style={{ fontSize: 11, opacity: 0.6 }}>Exit Point</Text></Flex>
        {Array.from({ length: maxDepth + 1 }, (_, d) => (
          <Flex key={d} gap={4} alignItems="center"><span style={{ width: 12, height: 12, borderRadius: 2, background: SANKEY_COLORS[d % SANKEY_COLORS.length], display: "inline-block" }} /><Text style={{ fontSize: 11, opacity: 0.6 }}>Page {d + 1}</Text></Flex>
        ))}
      </Flex>
    </div>
  );

  // ---- Classic Sankey (and Gradient variant) ----
  const renderClassicSankey = (useGradient: boolean) => (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block", margin: "0 auto", cursor: hasFocus ? "pointer" : "default" }} onClick={() => setFocusNodeId(null)}>
        {useGradient && (
          <defs>
            {links.map((l, i) => {
              const srcNode = nodes.find(n => n.id === l.source)!;
              const tgtNode = nodes.find(n => n.id === l.target)!;
              return (
                <linearGradient key={`lg-${i}`} id={`sankey-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={SANKEY_COLORS[srcNode.depth % SANKEY_COLORS.length]} />
                  <stop offset="100%" stopColor={SANKEY_COLORS[tgtNode.depth % SANKEY_COLORS.length]} />
                </linearGradient>
              );
            })}
          </defs>
        )}
        {Array.from({ length: maxDepth + 1 }, (_, d) => (
          <text key={`dl-${d}`} x={PAD.left + d * colW + NODE_W / 2} y={12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={10} fontWeight={600}>{DEPTH_LABELS[d] ?? `Page ${d + 1}`}</text>
        ))}
        {links.map((l, i) => {
          const srcNode = nodes.find(n => n.id === l.source)!;
          const tgtNode = nodes.find(n => n.id === l.target)!;
          const x0 = PAD.left + srcNode.depth * colW + NODE_W;
          const x1 = PAD.left + tgtNode.depth * colW;
          const y0 = PAD.top + l.sy * scaleY + (l.thickness * scaleY) / 2;
          const y1 = PAD.top + l.ty * scaleY + (l.thickness * scaleY) / 2;
          const curvature = (x1 - x0) * 0.4;
          const color = useGradient ? `url(#sankey-grad-${i})` : SANKEY_COLORS[srcNode.depth % SANKEY_COLORS.length];
          const isConn = !hasFocus || connectedLinks.has(i);
          const opacity = hasFocus ? (isConn ? 0.7 : (focusMode ? 0 : 0.06)) : 0.35;
          return (
            <path key={`link-${i}`} d={`M${x0},${y0} C${x0 + curvature},${y0} ${x1 - curvature},${y1} ${x1},${y1}`} fill="none" stroke={color} strokeWidth={Math.max(1, l.thickness * scaleY)} strokeOpacity={useGradient ? (hasFocus ? (isConn ? 0.8 : (focusMode ? 0 : 0.08)) : 0.5) : opacity} style={{ cursor: "pointer", transition: "stroke-opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); setFocusNodeId(srcNode.id); }}>
              <title>{`${srcNode.label} → ${tgtNode.label}: ${fmtCount(l.value)} sessions`}</title>
            </path>
          );
        })}
        {nodes.map((n) => {
          const x = PAD.left + n.depth * colW;
          const y = PAD.top + n.y * scaleY;
          const h = Math.max(2, n.height * scaleY);
          const isExit = exitNodeIds.has(n.id);
          const color = isExit ? RED : SANKEY_COLORS[n.depth % SANKEY_COLORS.length];
          const isLeft = n.depth === 0;
          const labelX = isLeft ? x - 4 : x + NODE_W + 4;
          const anchor = isLeft ? "end" : "start";
          const isFocused = n.id === focusNodeId;
          const isConn = !hasFocus || connectedNodes.has(n.id);
          const nodeOpacity = hasFocus ? (isFocused ? 1 : isConn ? 0.85 : (focusMode ? 0 : 0.15)) : 0.85;
          const labelOpacity = hasFocus ? (isConn ? 0.9 : (focusMode ? 0 : 0.15)) : 0.7;
          return (
            <g key={n.id} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); setFocusNodeId(isFocused ? null : n.id); }}>
              <rect x={x} y={y} width={NODE_W} height={h} rx={3} fill={color} opacity={nodeOpacity} stroke={isFocused ? "#fff" : (isExit ? RED : "none")} strokeWidth={isFocused ? 2 : (isExit ? 1.5 : 0)}>
                <title>{buildNodeTooltip(n.id)}</title>
              </rect>
              {h > 8 && <text x={labelX} y={y + h / 2 + 3.5} textAnchor={anchor} fill={`rgba(255,255,255,${labelOpacity})`} fontSize={10} fontWeight={isFocused || isExit ? 700 : 400}>{isExit ? "⛔ " : ""}{truncLabel(n.label)}</text>}
            </g>
          );
        })}
      </svg>
      {hasFocus && focusNode && (
        <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(69,137,255,0.08)", borderRadius: 8, borderLeft: `3px solid ${SANKEY_COLORS[focusNode.depth % SANKEY_COLORS.length]}` }}>
          <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
            <Strong style={{ fontSize: 13 }}>{focusNode.label}</Strong>
            <Text style={{ fontSize: 12, opacity: 0.5 }}>{fmtCount(focusSessions)} sessions</Text>
            <button onClick={() => setFocusNodeId(null)} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, color: "rgba(255,255,255,0.6)", cursor: "pointer", padding: "2px 8px", fontSize: 12 }}>Clear</button>
          </Flex>
          {(() => {
            const totalIn = focusInbound.reduce((s, l) => s + l.value, 0);
            const totalOut = focusOutbound.reduce((s, l) => s + l.value, 0);
            const starts = Math.max(0, focusSessions - totalIn);
            const exits = Math.max(0, focusSessions - totalOut);
            if (starts === 0 && exits === 0) return null;
            const startPct = focusSessions > 0 ? (starts / focusSessions) * 100 : 0;
            const exitPct = focusSessions > 0 ? (exits / focusSessions) * 100 : 0;
            return (
              <Flex gap={6} flexWrap="wrap" style={{ marginBottom: 8 }}>
                {starts > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(69,137,255,0.12)", border: "1px solid rgba(69,137,255,0.3)", color: BLUE, fontWeight: 700 }}>← Starts: {fmtCount(starts)} ({Math.round(startPct)}%)</span>}
                {exits > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(194,25,48,0.12)", border: "1px solid rgba(194,25,48,0.3)", color: RED, fontWeight: 700 }}>→ Exits: {fmtCount(exits)} ({Math.round(exitPct)}%)</span>}
              </Flex>
            );
          })()}
          {focusInbound.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 12, opacity: 0.5 }}>Inbound ({focusInbound.length}):</Text>
              <Flex gap={6} flexWrap="wrap" style={{ marginTop: 2 }}>
                {[...focusInbound].sort((a, b) => b.value - a.value).slice(0, 6).map((l, i) => {
                  const src = nodes.find(n => n.id === l.source)!;
                  return <span key={i} style={{ fontSize: 12, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.06)" }} title={src.label}>{truncLabel(src.label, 30)} <Strong style={{ color: CYAN }}>{fmtCount(l.value)}</Strong></span>;
                })}
              </Flex>
            </div>
          )}
          {focusOutbound.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 12, opacity: 0.5 }}>Outbound ({focusOutbound.length}):</Text>
              <Flex gap={6} flexWrap="wrap" style={{ marginTop: 2 }}>
                {[...focusOutbound].sort((a, b) => b.value - a.value).slice(0, 6).map((l, i) => {
                  const tgt = nodes.find(n => n.id === l.target)!;
                  const isExitTarget = exitLabels.has(tgt.label);
                  return <span key={i} style={{ fontSize: 12, padding: "1px 6px", borderRadius: 3, background: isExitTarget ? "rgba(194,25,48,0.1)" : "rgba(255,255,255,0.06)", border: isExitTarget ? "1px solid rgba(194,25,48,0.2)" : "none" }} title={tgt.label}>{isExitTarget ? "↗ " : ""}{truncLabel(tgt.label, 30)} <Strong style={{ color: isExitTarget ? RED : GREEN }}>{fmtCount(l.value)}</Strong></span>;
                })}
              </Flex>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ---- Directed Flow Graph ----
  const renderDirectedFlowGraph = () => {
    const uniqueNodes = new Map<string, { label: string; totalValue: number; depth: number }>();
    for (const n of nodes) {
      const existing = uniqueNodes.get(n.label);
      if (!existing || n.value > existing.totalValue) uniqueNodes.set(n.label, { label: n.label, totalValue: n.value, depth: n.depth });
    }
    const uNodes = Array.from(uniqueNodes.values()).sort((a, b) => b.totalValue - a.totalValue).slice(0, 16);
    const edgeMap = new Map<string, number>();
    for (const l of links) {
      const src = nodes.find(n => n.id === l.source)!;
      const tgt = nodes.find(n => n.id === l.target)!;
      edgeMap.set(`${src.label}|||${tgt.label}`, (edgeMap.get(`${src.label}|||${tgt.label}`) ?? 0) + l.value);
    }
    const edges = Array.from(edgeMap.entries()).map(([k, v]) => { const [from, to] = k.split("|||"); return { from, to, value: v }; }).sort((a, b) => b.value - a.value).slice(0, 30);
    const gW = 960, gH = 500, nodeRadius = 28;
    const depthGroups = new Map<number, typeof uNodes>();
    for (const n of uNodes) { const arr = depthGroups.get(n.depth) ?? []; arr.push(n); depthGroups.set(n.depth, arr); }
    const maxD = Math.max(...Array.from(depthGroups.keys()));
    const nodePositions = new Map<string, { x: number; y: number }>();
    for (const [d, group] of depthGroups) {
      const colX = 80 + (d / Math.max(maxD, 1)) * (gW - 160);
      group.forEach((n, i) => { nodePositions.set(n.label, { x: colX, y: group.length === 1 ? gH / 2 : 50 + (i / Math.max(group.length - 1, 1)) * (gH - 100) }); });
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <svg width={gW} height={gH} style={{ display: "block", margin: "0 auto" }}>
          <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="rgba(255,255,255,0.5)" /></marker></defs>
          {edges.map((e, i) => {
            const from = nodePositions.get(e.from); const to = nodePositions.get(e.to);
            if (!from || !to) return null;
            const dx = to.x - from.x; const dy = to.y - from.y; const dist = Math.sqrt(dx * dx + dy * dy);
            const ox = dist > 0 ? (dx / dist) * nodeRadius : 0; const oy = dist > 0 ? (dy / dist) * nodeRadius : 0;
            const x1 = from.x + ox, y1 = from.y + oy, x2 = to.x - ox, y2 = to.y - oy;
            const thickness = Math.max(1, (e.value / (edges[0]?.value ?? 1)) * 8);
            const edgeConn = !hasLabelFocus || (connectedLabelSet.has(e.from) && connectedLabelSet.has(e.to) && (e.from === focusLabel || e.to === focusLabel));
            const edgeOp = hasLabelFocus ? (edgeConn ? 0.5 : (focusMode ? 0 : 0.06)) : 0.4;
            return (
              <g key={`edge-${i}`} style={{ transition: "opacity 0.2s" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={SANKEY_COLORS[i % SANKEY_COLORS.length]} strokeWidth={thickness} strokeOpacity={edgeOp} markerEnd="url(#arrowhead)" />
                {(!hasLabelFocus || edgeConn) && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize={9} fontWeight={600}>{fmtCount(e.value)}</text>}
              </g>
            );
          })}
          {uNodes.map((n, i) => {
            const pos = nodePositions.get(n.label); if (!pos) return null;
            const isExit = exitLabels.has(n.label);
            const color = isExit ? RED : SANKEY_COLORS[n.depth % SANKEY_COLORS.length];
            const isFocused = focusLabel === n.label;
            const isConn = !hasLabelFocus || connectedLabelSet.has(n.label);
            const nodeOp = hasLabelFocus ? (isFocused ? 1 : isConn ? 0.85 : (focusMode ? 0 : 0.15)) : 0.8;
            const lblVis = hasLabelFocus ? (isConn ? 1 : (focusMode ? 0 : 0.15)) : 1;
            return (
              <g key={`node-${i}`} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); handleLabelClick(n.label); }}>
                <circle cx={pos.x} cy={pos.y} r={nodeRadius} fill={color} fillOpacity={nodeOp} stroke={isFocused ? "#fff" : color} strokeWidth={isFocused ? 3 : 2}><title>{buildLabelTooltip(n.label)}</title></circle>
                <text x={pos.x} y={pos.y - 3} textAnchor="middle" fill="white" fontSize={8} fontWeight={600} opacity={lblVis}>{isExit ? "⛔ " : ""}{truncLabel(n.label, 14)}</text>
                <text x={pos.x} y={pos.y + 10} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={8} opacity={lblVis}>{fmtCount(n.totalValue)}</text>
              </g>
            );
          })}
        </svg>
        {renderLabelPopup()}
      </div>
    );
  };

  // ---- Alluvial / Columnar ----
  const renderAlluvial = () => {
    const maxNodesCol = Math.max(...Array.from(new Map<number, number>(nodes.map(n => [n.depth, 0] as [number, number])).keys()).map(d => nodes.filter(n => n.depth === d).length), 1);
    const aW = 960; const nodeW = 140; const nodeH = 36; const nodeGap = 8;
    const aH = Math.max(540, Math.min(maxNodesCol, 12) * (nodeH + nodeGap) + 100);
    const aPAD = { top: 50, right: 40, bottom: 20, left: 40 };
    const aInnerW = aW - aPAD.left - aPAD.right; const aInnerH = aH - aPAD.top - aPAD.bottom;
    const numCols = maxDepth + 1; const aColW = numCols > 0 ? aInnerW / numCols : aInnerW;
    const depthCols = new Map<number, SankeyNode[]>();
    for (const n of nodes) { const arr = depthCols.get(n.depth) ?? []; arr.push(n); depthCols.set(n.depth, arr); }
    const alluvialNodes = new Map<string, { x: number; y: number; w: number; h: number; label: string; value: number; depth: number; cx: number; cy: number }>();
    for (const [d, col] of depthCols) {
      const sorted = [...col].sort((a, b) => b.value - a.value).slice(0, 12);
      const cx = aPAD.left + d * aColW + aColW / 2;
      const totalH = sorted.length * nodeH + (sorted.length - 1) * nodeGap;
      let yStart = aPAD.top + (aInnerH - totalH) / 2;
      if (yStart < aPAD.top) yStart = aPAD.top;
      for (const n of sorted) { const x = cx - nodeW / 2; alluvialNodes.set(n.id, { x, y: yStart, w: nodeW, h: nodeH, label: n.label, value: n.value, depth: d, cx, cy: yStart + nodeH / 2 }); yStart += nodeH + nodeGap; }
    }
    return (
      <div style={{ overflowX: "scroll", overflowY: "auto", maxHeight: 600 }}>
        <svg width={aW} height={aH} style={{ display: "block", minWidth: aW }}>
          {Array.from({ length: numCols }, (_, d) => { const cx = aPAD.left + d * aColW + aColW / 2; const colPX = 8; return (<g key={`col-bg-${d}`}><rect x={cx - aColW / 2 + colPX} y={aPAD.top - 20} width={aColW - colPX * 2} height={aInnerH + 30} rx={8} fill="rgba(60,60,80,0.35)" stroke="rgba(255,255,255,0.06)" strokeWidth={1} /><text x={cx} y={aPAD.top - 6} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize={12} fontWeight={700}>Step {d + 1}</text></g>); })}
          {links.map((l, i) => {
            const src = alluvialNodes.get(l.source); const tgt = alluvialNodes.get(l.target);
            if (!src || !tgt) return null;
            const x0 = src.x + src.w, y0 = src.cy, x1 = tgt.x, y1 = tgt.cy, cp = (x1 - x0) * 0.45;
            const maxVal = links.length > 0 ? Math.max(...links.map(ll => ll.value)) : 1;
            const thickness = Math.max(1, Math.min(4, (l.value / maxVal) * 4));
            const edgeConn = !hasLabelFocus || (connectedLabelSet.has(src.label) && connectedLabelSet.has(tgt.label) && (src.label === focusLabel || tgt.label === focusLabel));
            const edgeOp = hasLabelFocus ? (edgeConn ? 0.5 : (focusMode ? 0 : 0.06)) : 0.4;
            return <path key={`al-${i}`} d={`M${x0},${y0} C${x0 + cp},${y0} ${x1 - cp},${y1} ${x1},${y1}`} fill="none" stroke={`rgba(180,180,200,${edgeOp})`} strokeWidth={thickness} markerEnd="url(#alluvial-arrow)" style={{ transition: "stroke 0.2s" }} />;
          })}
          <defs><marker id="alluvial-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="rgba(180,180,200,0.5)" /></marker></defs>
          {Array.from(alluvialNodes.entries()).map(([id, n]) => {
            const isExit = exitLabels.has(n.label);
            const color = isExit ? RED : SANKEY_COLORS[n.depth % SANKEY_COLORS.length];
            const isFocused = focusLabel === n.label;
            const isConn = !hasLabelFocus || connectedLabelSet.has(n.label);
            const nodeOp = hasLabelFocus ? (isFocused ? 1 : isConn ? 0.85 : (focusMode ? 0 : 0.15)) : 0.9;
            const lblVis = hasLabelFocus ? (isConn ? 1 : (focusMode ? 0 : 0.15)) : 1;
            return (
              <g key={id} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); handleLabelClick(n.label); }}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={5} fill={color} fillOpacity={nodeOp} stroke={isFocused ? "#fff" : (isExit ? RED : "rgba(255,255,255,0.15)")} strokeWidth={isFocused ? 2.5 : 1}><title>{buildLabelTooltip(n.label)}</title></rect>
                <text x={n.cx} y={n.y + n.h / 2 + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={600} opacity={lblVis}>{isExit ? "⛔ " : ""}{truncLabel(n.label, 16)} — {fmtCount(n.value)}</text>
              </g>
            );
          })}
        </svg>
        {renderLabelPopup()}
      </div>
    );
  };

  // ---- State Machine ----
  const renderStateMachine = () => {
    const stateNodes = new Map<string, { label: string; totalOutbound: number; totalInbound: number; value: number }>();
    for (const n of nodes) { const ex = stateNodes.get(n.label); if (ex) ex.value = Math.max(ex.value, n.value); else stateNodes.set(n.label, { label: n.label, totalOutbound: 0, totalInbound: 0, value: n.value }); }
    const edgeMap = new Map<string, number>();
    for (const l of links) { const src = nodes.find(n => n.id === l.source)!; const tgt = nodes.find(n => n.id === l.target)!; const key = `${src.label}|||${tgt.label}`; edgeMap.set(key, (edgeMap.get(key) ?? 0) + l.value); }
    for (const [key, value] of edgeMap) { const [from, to] = key.split("|||"); const s = stateNodes.get(from); if (s) s.totalOutbound += value; const t = stateNodes.get(to); if (t) t.totalInbound += value; }
    const stateEdges: { from: string; to: string; value: number; pct: number }[] = [];
    for (const [key, value] of edgeMap) { const [from, to] = key.split("|||"); const s = stateNodes.get(from); stateEdges.push({ from, to, value, pct: s && s.value > 0 ? (value / s.value) * 100 : 0 }); }
    stateEdges.sort((a, b) => b.value - a.value);
    const topEdges = stateEdges.slice(0, 25);
    const topLabels = new Set<string>();
    for (const e of topEdges) { topLabels.add(e.from); topLabels.add(e.to); }
    const smNodes = Array.from(stateNodes.values()).filter(n => topLabels.has(n.label)).sort((a, b) => b.value - a.value).slice(0, 12);
    const smW = 960, smH = 540, nodeRectW = 120, nodeRectH = 46, cols = 4;
    const rowCount = Math.ceil(smNodes.length / cols);
    const cellW = smW / cols, cellH = smH / rowCount;
    const smPositions = new Map<string, { x: number; y: number }>();
    smNodes.forEach((n, i) => { smPositions.set(n.label, { x: cellW * (i % cols) + cellW / 2, y: cellH * Math.floor(i / cols) + cellH / 2 }); });
    return (
      <div style={{ overflowX: "auto" }}>
        <svg width={smW} height={smH} style={{ display: "block", margin: "0 auto" }}>
          <defs><marker id="sm-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="rgba(255,255,255,0.6)" /></marker></defs>
          {topEdges.map((e, i) => {
            const from = smPositions.get(e.from); const to = smPositions.get(e.to);
            if (!from || !to) return null;
            const dx = to.x - from.x, dy = to.y - from.y, dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) return null;
            const r = 50; const ox = (dx / dist) * r, oy = (dy / dist) * r;
            const x1 = from.x + ox, y1 = from.y + oy, x2 = to.x - ox, y2 = to.y - oy;
            const midX = (x1 + x2) / 2 + (dy / dist) * 18, midY = (y1 + y2) / 2 - (dx / dist) * 18;
            const thickness = Math.max(1.5, (e.value / (topEdges[0]?.value ?? 1)) * 5);
            const edgeConn = !hasLabelFocus || (connectedLabelSet.has(e.from) && connectedLabelSet.has(e.to) && (e.from === focusLabel || e.to === focusLabel));
            const edgeOp = hasLabelFocus ? (edgeConn ? 0.6 : (focusMode ? 0 : 0.06)) : 0.5;
            return (
              <g key={`sme-${i}`} style={{ transition: "opacity 0.2s" }}>
                <path d={`M${x1},${y1} Q${midX},${midY} ${x2},${y2}`} fill="none" stroke={`rgba(200,200,220,${edgeOp})`} strokeWidth={thickness} markerEnd="url(#sm-arrow)" />
                {(!hasLabelFocus || edgeConn) && <text x={midX} y={midY - 2} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={9} fontWeight={700}>{fmtCount(e.value)}</text>}
              </g>
            );
          })}
          {smNodes.map((n, i) => {
            const pos = smPositions.get(n.label); if (!pos) return null;
            const isExit = exitLabels.has(n.label);
            const color = isExit ? RED : SANKEY_COLORS[i % SANKEY_COLORS.length];
            const isFocused = focusLabel === n.label;
            const isConn = !hasLabelFocus || connectedLabelSet.has(n.label);
            const nodeOp = hasLabelFocus ? (isFocused ? 1 : isConn ? 0.85 : (focusMode ? 0 : 0.15)) : 0.9;
            const lblVis = hasLabelFocus ? (isConn ? 1 : (focusMode ? 0 : 0.15)) : 1;
            return (
              <g key={`smn-${i}`} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); handleLabelClick(n.label); }}>
                <rect x={pos.x - nodeRectW / 2} y={pos.y - nodeRectH / 2} width={nodeRectW} height={nodeRectH} rx={6} fill={color} fillOpacity={nodeOp} stroke={isFocused ? "#fff" : "rgba(255,255,255,0.15)"} strokeWidth={isFocused ? 2.5 : 1}><title>{buildLabelTooltip(n.label)}</title></rect>
                <text x={pos.x} y={pos.y - 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={700} opacity={lblVis}>{isExit ? "⛔ Exit" : truncLabel(n.label, 14)}</text>
                <text x={pos.x} y={pos.y + 12} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={9} opacity={lblVis}>{fmtCount(n.value)} sessions</text>
              </g>
            );
          })}
        </svg>
        {renderLabelPopup()}
      </div>
    );
  };

  // ---- Chord Diagram ----
  const renderChordDiagram = () => {
    const labelSet = new Set<string>();
    for (const n of nodes) labelSet.add(n.label);
    const labels = Array.from(labelSet);
    const idx = new Map<string, number>();
    labels.forEach((l, i) => idx.set(l, i));
    const N = labels.length;
    const matrix: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (const l of links) {
      const srcNode = nodes.find(n => n.id === l.source); const tgtNode = nodes.find(n => n.id === l.target);
      if (srcNode && tgtNode) { const si = idx.get(srcNode.label); const ti = idx.get(tgtNode.label); if (si !== undefined && ti !== undefined) matrix[si][ti] += l.value; }
    }
    const totals = labels.map((_, i) => { let s = 0; for (let j = 0; j < N; j++) s += matrix[i][j] + matrix[j][i]; return s; });
    const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;
    const cW = 700, cH = 700, cx = cW / 2, cy = cH / 2, outerR = 280, innerR = 260, ribbonR = 240;
    const gapAngle = 0.02, availAngle = Math.PI * 2 - gapAngle * N;
    const arcs: { start: number; end: number; label: string; total: number; color: string }[] = [];
    let angle = 0;
    for (let i = 0; i < N; i++) { const span = (totals[i] / grandTotal) * availAngle; arcs.push({ start: angle, end: angle + span, label: labels[i], total: totals[i], color: SANKEY_COLORS[i % SANKEY_COLORS.length] }); angle += span + gapAngle; }
    const arcPath = (startA: number, endA: number, r: number) => { const x1 = cx + Math.cos(startA) * r, y1 = cy + Math.sin(startA) * r, x2 = cx + Math.cos(endA) * r, y2 = cy + Math.sin(endA) * r, large = endA - startA > Math.PI ? 1 : 0; return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`; };
    const ribbons: { srcIdx: number; tgtIdx: number; srcStart: number; srcEnd: number; tgtStart: number; tgtEnd: number; value: number }[] = [];
    const arcCursor = arcs.map(a => a.start); const arcCursorTgt = arcs.map(a => a.start);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const val = matrix[i][j]; if (val <= 0) continue; const span = (val / grandTotal) * availAngle; ribbons.push({ srcIdx: i, tgtIdx: j, srcStart: arcCursor[i], srcEnd: arcCursor[i] + span, tgtStart: arcCursorTgt[j], tgtEnd: arcCursorTgt[j] + span, value: val }); arcCursor[i] += span; arcCursorTgt[j] += span; }
    const ribbonPath = (r: typeof ribbons[0]) => {
      const sx1 = cx + Math.cos(r.srcStart) * ribbonR, sy1 = cy + Math.sin(r.srcStart) * ribbonR;
      const sx2 = cx + Math.cos(r.srcEnd) * ribbonR, sy2 = cy + Math.sin(r.srcEnd) * ribbonR;
      const tx1 = cx + Math.cos(r.tgtStart) * ribbonR, ty1 = cy + Math.sin(r.tgtStart) * ribbonR;
      const tx2 = cx + Math.cos(r.tgtEnd) * ribbonR, ty2 = cy + Math.sin(r.tgtEnd) * ribbonR;
      return `M${sx1},${sy1} A${ribbonR},${ribbonR} 0 ${r.srcEnd - r.srcStart > Math.PI ? 1 : 0} 1 ${sx2},${sy2} Q${cx},${cy} ${tx1},${ty1} A${ribbonR},${ribbonR} 0 ${r.tgtEnd - r.tgtStart > Math.PI ? 1 : 0} 1 ${tx2},${ty2} Q${cx},${cy} ${sx1},${sy1} Z`;
    };
    const selChordIdx = focusLabel ? idx.get(focusLabel) ?? -1 : -1;
    const hasChordFocus = selChordIdx >= 0;
    const isChordConn = (i: number) => !hasChordFocus || i === selChordIdx || matrix[selChordIdx][i] > 0 || matrix[i][selChordIdx] > 0;
    const handleChordClick = (label: string) => { if (focusLabel === label) { setFocusNodeId(null); setFocusLabel(null); } else { const node = nodes.find(n => n.label === label); if (node) { setFocusNodeId(node.id); setFocusLabel(label); } else setFocusLabel(label); } };
    return (
      <div style={{ overflowX: "auto" }} onClick={() => { setFocusNodeId(null); setFocusLabel(null); }}>
        <svg width={cW} height={cH} style={{ display: "block", margin: "0 auto" }}>
          {ribbons.map((r, i) => { const isConn = !hasChordFocus || r.srcIdx === selChordIdx || r.tgtIdx === selChordIdx; const op = hasChordFocus ? (isConn ? 0.55 : (focusMode ? 0 : 0.04)) : 0.35; return <path key={`ribbon-${i}`} d={ribbonPath(r)} fill={arcs[r.srcIdx].color} fillOpacity={op} stroke={arcs[r.srcIdx].color} strokeWidth={isConn && hasChordFocus ? 1 : 0.5} strokeOpacity={hasChordFocus ? (isConn ? 0.8 : (focusMode ? 0 : 0.1)) : 0.5} style={{ cursor: "pointer", transition: "fill-opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); handleChordClick(labels[r.srcIdx]); }}><title>{`${labels[r.srcIdx]} → ${labels[r.tgtIdx]}: ${fmtCount(r.value)} sessions`}</title></path>; })}
          {arcs.map((a, i) => {
            const isExit = exitNodeIds.has(nodes.find(n => n.label === a.label)?.id ?? "");
            const color = isExit ? RED : a.color;
            const mid = (a.start + a.end) / 2;
            const lx = cx + Math.cos(mid) * (outerR + 18), ly = cy + Math.sin(mid) * (outerR + 18);
            const anchor = mid > Math.PI / 2 && mid < Math.PI * 1.5 ? "end" : "start";
            const rot = (mid * 180 / Math.PI) + (anchor === "end" ? 180 : 0);
            const isSel = selChordIdx === i; const conn = isChordConn(i);
            const arcOp = hasChordFocus ? (isSel ? 1 : conn ? 0.7 : (focusMode ? 0 : 0.15)) : 0.85;
            const lblFill = hasChordFocus ? (conn ? "rgba(255,255,255,0.9)" : (focusMode ? "rgba(255,255,255,0)" : "rgba(255,255,255,0.15)")) : "rgba(255,255,255,0.7)";
            return (
              <g key={`arc-${i}`} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); handleChordClick(a.label); }}>
                {isSel && <path d={arcPath(a.start, a.end, outerR + 2)} fill="none" stroke="#fff" strokeWidth={outerR - innerR + 4} strokeLinecap="butt" opacity={0.3} />}
                <path d={arcPath(a.start, a.end, outerR)} fill="none" stroke={color} strokeWidth={outerR - innerR} strokeLinecap="butt" opacity={arcOp} style={{ transition: "opacity 0.2s" }}><title>{`${a.label}: ${fmtCount(a.total)} connections${isExit ? " ⛔ Exit" : ""}${isSel ? " (selected)" : ""}`}</title></path>
                {a.end - a.start > 0.12 && <text x={lx} y={ly} textAnchor={anchor} fill={lblFill} fontSize={9} fontWeight={isSel ? 700 : 400} style={{ transition: "fill 0.2s" }} transform={`rotate(${rot},${lx},${ly})`}>{isExit ? "⛔ " : ""}{truncLabel(a.label, 18)}</text>}
              </g>
            );
          })}
          {hasChordFocus && <><text x={cx} y={cy - 8} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={12} fontWeight={700}>{truncLabel(labels[selChordIdx], 24)}</text><text x={cx} y={cy + 10} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={10}>{fmtCount(arcs[selChordIdx].total)} connections</text></>}
        </svg>
      </div>
    );
  };

  // ---- Transition Heatmap ----
  const renderTransitionHeatmap = () => {
    const labelSet = new Set<string>();
    for (const n of nodes) labelSet.add(n.label);
    const labels = Array.from(labelSet).sort((a, b) => (nodes.find(n => n.label === b)?.value ?? 0) - (nodes.find(n => n.label === a)?.value ?? 0));
    const topLabels = labels.slice(0, 15);
    const idxMap = new Map<string, number>(); topLabels.forEach((l, i) => idxMap.set(l, i));
    const NL = topLabels.length;
    const matrix: number[][] = Array.from({ length: NL }, () => new Array(NL).fill(0));
    let maxVal = 0;
    for (const l of links) {
      const srcNode = nodes.find(n => n.id === l.source); const tgtNode = nodes.find(n => n.id === l.target);
      if (srcNode && tgtNode) { const si = idxMap.get(srcNode.label); const ti = idxMap.get(tgtNode.label); if (si !== undefined && ti !== undefined) { matrix[si][ti] += l.value; if (matrix[si][ti] > maxVal) maxVal = matrix[si][ti]; } }
    }
    if (maxVal === 0) maxVal = 1;
    const hmPad = { top: 160, left: 180, right: 30, bottom: 40 }; const cellSize = 52;
    const hmW = hmPad.left + NL * cellSize + hmPad.right; const hmH = hmPad.top + NL * cellSize + hmPad.bottom;
    const heatColor = (v: number) => { if (v === 0) return "rgba(128,128,128,0.06)"; const t = v / maxVal; if (t < 0.33) return `rgba(69,137,255,${0.2 + t * 1.5})`; if (t < 0.66) return `rgba(255,200,0,${0.3 + (t - 0.33) * 1.5})`; return `rgba(194,25,48,${0.4 + (t - 0.66) * 1.5})`; };
    const hmSelIdx = focusLabel ? (idxMap.get(focusLabel) ?? -1) : -1;
    const hasHmFocus = hmSelIdx >= 0;
    const handleHmClick = (label: string) => { if (focusLabel === label) { setFocusNodeId(null); setFocusLabel(null); } else { const node = nodes.find(n => n.label === label); if (node) { setFocusNodeId(node.id); setFocusLabel(label); } else setFocusLabel(label); } };
    return (
      <div style={{ overflowX: "auto" }} onClick={() => { setFocusNodeId(null); setFocusLabel(null); }}>
        <svg width={hmW} height={hmH} style={{ display: "block", margin: "0 auto" }}>
          {hasHmFocus && <rect x={hmPad.left} y={hmPad.top + hmSelIdx * cellSize - 1} width={NL * cellSize} height={cellSize + 1} rx={2} fill="rgba(69,137,255,0.08)" stroke="rgba(69,137,255,0.3)" strokeWidth={1} />}
          {hasHmFocus && <rect x={hmPad.left + hmSelIdx * cellSize - 1} y={hmPad.top} width={cellSize + 1} height={NL * cellSize} rx={2} fill="rgba(69,137,255,0.08)" stroke="rgba(69,137,255,0.3)" strokeWidth={1} />}
          {topLabels.map((label, i) => { const isSel = hasHmFocus && i === hmSelIdx; return <text key={`col-${i}`} x={hmPad.left + i * cellSize + cellSize / 2} y={hmPad.top - 8} textAnchor="start" fill={isSel ? "#4589FF" : "rgba(255,255,255,0.6)"} fontSize={11} fontWeight={isSel ? 700 : 400} style={{ cursor: "pointer" }} transform={`rotate(-45,${hmPad.left + i * cellSize + cellSize / 2},${hmPad.top - 8})`} onClick={(e) => { e.stopPropagation(); handleHmClick(label); }}>{truncLabel(label, 24)}</text>; })}
          {topLabels.map((label, i) => { const isSel = hasHmFocus && i === hmSelIdx; return <text key={`row-${i}`} x={hmPad.left - 8} y={hmPad.top + i * cellSize + cellSize / 2 + 4} textAnchor="end" fill={isSel ? "#4589FF" : "rgba(255,255,255,0.6)"} fontSize={11} fontWeight={isSel ? 700 : 400} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); handleHmClick(label); }}>{truncLabel(label, 24)}</text>; })}
          {topLabels.map((_, ri) => topLabels.map((_, ci) => { const val = matrix[ri][ci]; const isFocCell = hasHmFocus && (ri === hmSelIdx || ci === hmSelIdx); const cellOp = hasHmFocus ? (isFocCell ? 1 : (focusMode ? 0.05 : 0.3)) : 1; return (<g key={`cell-${ri}-${ci}`} style={{ cursor: "pointer", transition: "opacity 0.2s" }} opacity={cellOp} onClick={(e) => { e.stopPropagation(); handleHmClick(topLabels[ri]); }}><rect x={hmPad.left + ci * cellSize} y={hmPad.top + ri * cellSize} width={cellSize - 1} height={cellSize - 1} rx={3} fill={heatColor(val)} stroke={isFocCell && val > 0 ? "rgba(69,137,255,0.5)" : "rgba(128,128,128,0.1)"} strokeWidth={isFocCell && val > 0 ? 1.5 : 0.5}><title>{`${topLabels[ri]} → ${topLabels[ci]}: ${fmtCount(val)} sessions`}</title></rect>{val > 0 && <text x={hmPad.left + ci * cellSize + cellSize / 2 - 0.5} y={hmPad.top + ri * cellSize + cellSize / 2 + 4} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={11} fontWeight={600}>{val >= 1000 ? fmtCount(val) : val}</text>}</g>); }))}
          <text x={hmPad.left + (NL * cellSize) / 2} y={14} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={12} fontWeight={600}>To Page →</text>
          <text x={14} y={hmPad.top + (NL * cellSize) / 2} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={12} fontWeight={600} transform={`rotate(-90,14,${hmPad.top + (NL * cellSize) / 2})`}>From Page →</text>
          <text x={hmPad.left} y={hmH - 8} fill="rgba(255,255,255,0.3)" fontSize={10}>Low</text>
          <rect x={hmPad.left + 28} y={hmH - 18} width={24} height={12} rx={3} fill="rgba(69,137,255,0.5)" />
          <rect x={hmPad.left + 56} y={hmH - 18} width={24} height={12} rx={3} fill="rgba(255,200,0,0.6)" />
          <rect x={hmPad.left + 84} y={hmH - 18} width={24} height={12} rx={3} fill="rgba(194,25,48,0.7)" />
          <text x={hmPad.left + 114} y={hmH - 8} fill="rgba(255,255,255,0.3)" fontSize={10}>High</text>
          {hasHmFocus && <text x={hmPad.left + 160} y={hmH - 8} fill="rgba(69,137,255,0.7)" fontSize={10} fontWeight={600}>Selected: {truncLabel(topLabels[hmSelIdx], 20)}</text>}
        </svg>
      </div>
    );
  };

  // ---- renderChart switch ----
  const renderChart = () => {
    switch (chartStyle) {
      case "gradient":     return renderClassicSankey(true);
      case "directed":     return renderDirectedFlowGraph();
      case "alluvial":     return renderAlluvial();
      case "stateMachine": return renderStateMachine();
      case "chord":        return renderChordDiagram();
      case "heatmap":      return renderTransitionHeatmap();
      case "classic":
      default:             return renderClassicSankey(false);
    }
  };

  return (
    <div>
      <SubTabBar tabs={sankeySubTabs} active={subTab} onChange={setSubTab} />

      {/* FLOW CHART */}
      {subTab === "flow" && (
        <div style={{ padding: "16px 20px" }}>
          {sankeyTlActive && (
            <div style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(128,128,128,0.06)", borderRadius: 8, border: "1px solid rgba(128,128,128,0.15)", fontSize: 12, opacity: 0.8 }}>
              Time-Lapse active — bucket {TL_BUCKET_LABELS[tl.bucket] ?? tl.bucket} · {tlBucketList.length} snapshots
              {tlBucketList.length > 0 && ` · showing ${tlBucketList[Math.min(tl.index, tlBucketList.length - 1)] ?? "—"}`}
            </div>
          )}
          {isLoading ? <EmptyState loading /> : nodes.length === 0 ? <EmptyState error={flowData.error ?? "No flow data"} /> : (
            <>
              {chartHeader}
              {renderChart()}
            </>
          )}
        </div>
      )}

      {/* LOOP ANALYSIS */}
      {subTab === "loops" && (
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Pages visited multiple times within a single session. High loop counts may indicate navigation confusion or repeat task attempts.</p>
          {pathsData.loading ? <EmptyState loading /> : loopAnalysis.length === 0 ? <EmptyState error="No loop data available" /> : (
            <div style={{ overflowX: "auto" }}>
              <DataTable sortable data={loopAnalysis.map(l => ({
                Page: l.page, "Loop Sessions": l.loopSessions, "Total Loops": l.totalLoops,
                "Avg Loops/Sess": l.loopSessions > 0 ? (l.totalLoops / l.loopSessions).toFixed(1) : "0",
              }))} columns={[
                { id: "Page", header: "Page", accessor: "Page", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                { id: "Loop Sessions", header: "Loop Sessions", accessor: "Loop Sessions", sortType: "number" as any, cell: ({ value }: any) => <span style={{ fontWeight: 700 }}>{fmtCount(value)}</span> },
                { id: "Total Loops", header: "Total Loops", accessor: "Total Loops", sortType: "number" as any },
                { id: "Avg Loops/Sess", header: "Avg Loops / Session", accessor: "Avg Loops/Sess", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: Number(value) > 3 ? RED : Number(value) > 2 ? YELLOW : GREEN }}>{value}</span> },
              ]} />
            </div>
          )}
        </div>
      )}

      {/* PAGE TIMING */}
      {subTab === "timing" && (
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Average and P90 time users spend on each page. Pages with high P90 outliers warrant deeper investigation.</p>
          {durData.loading ? <EmptyState loading /> : durationMap.size === 0 ? <EmptyState error="No duration data available" /> : (() => {
            const rows = Array.from(durationMap.entries()).map(([page, d]) => ({ page, ...d })).sort((a, b) => b.sessions - a.sessions);
            const maxAvg = Math.max(1, ...rows.map(r => r.avgDuration));
            return (
              <div style={{ overflowX: "auto" }}>
                <DataTable sortable data={rows.map(r => ({ Page: r.page, "Avg (ms)": Math.round(r.avgDuration), "P90 (ms)": Math.round(r.p90Duration), Views: r.sessions }))}
                  columns={[
                    { id: "Page", header: "Page", accessor: "Page", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                    { id: "Views", header: "Views", accessor: "Views", sortType: "number" as any, cell: ({ value }: any) => <span>{fmtCount(value)}</span> },
                    { id: "Avg (ms)", header: "Avg Duration", accessor: "Avg (ms)", sortType: "number" as any, cell: ({ value }: any) => (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: Math.max(4, (value / maxAvg) * 100), height: 8, background: value > 3000 ? RED : value > 1500 ? YELLOW : BLUE, borderRadius: 4 }} />
                        <span style={{ color: value > 3000 ? RED : value > 1500 ? YELLOW : undefined }}>{fmtMs(value)}</span>
                      </div>
                    )},
                    { id: "P90 (ms)", header: "P90", accessor: "P90 (ms)", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 4000 ? RED : value > 2000 ? YELLOW : undefined }}>{fmtMs(value)}</span> },
                  ]} />
              </div>
            );
          })()}
        </div>
      )}

      {/* SESSION ENDPOINTS */}
      {subTab === "endpoints" && (
        <div style={{ padding: "16px 20px" }}>
          {pathsData.loading ? <EmptyState loading /> : (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 320 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: GREEN }}>Entry Pages</h3>
                <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>First pages users land on in a session.</p>
                {endpointAnalysis.entries.length === 0 ? <EmptyState error="No data" /> : (
                  <div style={{ overflowX: "auto" }}>
                    <DataTable sortable data={endpointAnalysis.entries.map(e => ({ Page: e.page, Sessions: e.count }))}
                      columns={[
                        { id: "Page", header: "Entry Page", accessor: "Page", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                        { id: "Sessions", header: "Sessions", accessor: "Sessions", sortType: "number" as any, cell: ({ value }: any) => <span style={{ fontWeight: 700, color: GREEN }}>{fmtCount(value)}</span> },
                      ]} />
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 320 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: ORANGE }}>Exit Pages</h3>
                <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>Last pages visited before session ended.</p>
                {endpointAnalysis.exits.length === 0 ? <EmptyState error="No data" /> : (
                  <div style={{ overflowX: "auto" }}>
                    <DataTable sortable data={endpointAnalysis.exits.map(e => ({ Page: e.page, Sessions: e.count }))}
                      columns={[
                        { id: "Page", header: "Exit Page", accessor: "Page", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                        { id: "Sessions", header: "Sessions", accessor: "Sessions", sortType: "number" as any, cell: ({ value }: any) => <span style={{ fontWeight: 700, color: ORANGE }}>{fmtCount(value)}</span> },
                      ]} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PATH TRENDS */}
      {subTab === "pathTrends" && (
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Navigation edge frequency compared to the previous period. Green = more traffic, Red = less traffic.</p>
          {(pathsData.loading || prevData.loading) ? <EmptyState loading /> : pathTrends.length === 0 ? <EmptyState error="No trend data available" /> : (
            <div style={{ overflowX: "auto" }}>
              <DataTable sortable data={pathTrends.map(t => ({
                From: t.from, To: t.to, Current: t.current, Previous: t.previous,
                "Delta %": parseFloat(t.delta.toFixed(1)),
              }))} columns={[
                { id: "From", header: "From", accessor: "From", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                { id: "To", header: "To", accessor: "To", cell: ({ value }: any) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{value}</span> },
                { id: "Current", header: "Current", accessor: "Current", sortType: "number" as any, cell: ({ value }: any) => <span style={{ fontWeight: 700 }}>{fmtCount(value)}</span> },
                { id: "Previous", header: "Previous", accessor: "Previous", sortType: "number" as any, cell: ({ value }: any) => <span style={{ opacity: 0.7 }}>{fmtCount(value)}</span> },
                { id: "Delta %", header: "Δ vs Prior", accessor: "Delta %", sortType: "number" as any, cell: ({ value }: any) => {
                  const v = Number(value); const sign = v > 0 ? "+" : "";
                  return <span style={{ color: v > 5 ? GREEN : v < -5 ? RED : YELLOW, fontWeight: 700 }}>{sign}{v.toFixed(1)}%</span>;
                }},
              ]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// SUB-TAB 3: Geo Heatmap — country performance cards + table
// ===========================================================================

const GeoHeatmapSubTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const geoResult = useDql(geoFullQuery(timeframeDays, sel), [timeframeDays, sel]);

  const countries = useMemo(() => {
    const rows = (geoResult.data?.records ?? []) as any[];
    const m = new Map<string, { sessions: number; actions: number; avgDur: number; errors: number; sat: number; tol: number; fru: number; lcpSum: number; lcpN: number; clsSum: number; clsN: number; inpSum: number; inpN: number }>();
    rows.forEach((r: any) => {
      const iso = String(r.country ?? "").toUpperCase();
      if (!iso) return;
      const d = m.get(iso) ?? { sessions: 0, actions: 0, avgDur: 0, errors: 0, sat: 0, tol: 0, fru: 0, lcpSum: 0, lcpN: 0, clsSum: 0, clsN: 0, inpSum: 0, inpN: 0 };
      const act = Number(r.actions ?? 0);
      d.avgDur = d.actions > 0 ? (d.avgDur * d.actions + Number(r.avg_dur ?? 0) * act) / (d.actions + act) : Number(r.avg_dur ?? 0);
      d.sessions += Number(r.sessions ?? 0); d.actions += act;
      d.errors += Number(r.errors ?? 0);
      d.sat += Number(r.satisfied ?? 0); d.tol += Number(r.tolerating ?? 0); d.fru += Number(r.frustrated ?? 0);
      const lcp = Number(r.lcp_avg ?? NaN);
      if (!isNaN(lcp) && lcp > 0) { d.lcpSum += lcp * act; d.lcpN += act; }
      const cls = Number(r.cls_avg ?? NaN);
      if (!isNaN(cls)) { d.clsSum += cls * act; d.clsN += act; }
      const inp = Number(r.inp_avg ?? NaN);
      if (!isNaN(inp) && inp > 0) { d.inpSum += inp * act; d.inpN += act; }
      m.set(iso, d);
    });
    return Array.from(m.entries()).map(([iso, d]) => ({
      iso, name: decodeName(iso, ""),
      ...d,
      apdex: calcApdex(d.sat, d.tol, d.sat + d.tol + d.fru),
      errRate: d.actions > 0 ? (d.errors / d.actions) * 100 : 0,
      lcp: d.lcpN > 0 ? d.lcpSum / d.lcpN : NaN,
      cls: d.clsN > 0 ? d.clsSum / d.clsN : NaN,
      inp: d.inpN > 0 ? d.inpSum / d.inpN : NaN,
    })).sort((a, b) => b.sessions - a.sessions);
  }, [geoResult.data]);

  const totalCountries = countries.length;
  const bestApdex = countries.length > 0 ? Math.max(...countries.map(c => c.apdex)) : 0;
  const worstApdex = countries.length > 0 ? Math.min(...countries.map(c => c.apdex)) : 0;
  const avgApdex = countries.length > 0 ? countries.reduce((a, c) => a + c.apdex, 0) / countries.length : 0;

  if (geoResult.loading) return <EmptyState loading />;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <KpiCard label="Countries" value={String(totalCountries)} rawValue={totalCountries} color={BLUE} />
        <KpiCard label="Best Apdex" value={bestApdex.toFixed(2)} rawValue={bestApdex} color={apdexClr(bestApdex)} />
        <KpiCard label="Worst Apdex" value={worstApdex.toFixed(2)} rawValue={worstApdex} color={apdexClr(worstApdex)} />
        <KpiCard label="Avg Apdex" value={avgApdex.toFixed(2)} rawValue={avgApdex} color={apdexClr(avgApdex)} />
      </div>

      {countries.length === 0 ? <EmptyState error={geoResult.error ?? "No geographic data"} /> : (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Country Performance Cards</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
            {countries.slice(0, 20).map(c => {
              const totalAct = c.sat + c.tol + c.fru;
              return (
                <div key={c.iso} style={{
                  padding: "10px 14px", borderLeft: `3px solid ${apdexClr(c.apdex)}`,
                  background: "rgba(128,128,128,0.05)", border: "1px solid rgba(128,128,128,0.15)",
                  borderRadius: 8, minWidth: 180, maxWidth: 220,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>{c.name}</strong>
                    <span style={{ fontSize: 12, padding: "2px 6px", borderRadius: 4, background: `${apdexClr(c.apdex)}18`, color: apdexClr(c.apdex), fontWeight: 700 }}>{c.apdex.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                    <div><div style={{ fontSize: 11, opacity: 0.5 }}>Sessions</div><div style={{ fontSize: 12, fontWeight: 700, color: BLUE }}>{fmtCount(c.sessions)}</div></div>
                    <div><div style={{ fontSize: 11, opacity: 0.5 }}>Avg</div><div style={{ fontSize: 12, fontWeight: 700, color: c.avgDur > 3000 ? RED : c.avgDur > 1000 ? YELLOW : GREEN }}>{fmtMs(c.avgDur)}</div></div>
                    <div><div style={{ fontSize: 11, opacity: 0.5 }}>Err%</div><div style={{ fontSize: 12, fontWeight: 700, color: c.errRate > 5 ? RED : c.errRate > 1 ? YELLOW : GREEN }}>{fmtPct(c.errRate)}</div></div>
                  </div>
                  {totalAct > 0 && (
                    <div style={{ height: 4, borderRadius: 2, overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${(c.sat / totalAct) * 100}%`, background: GREEN }} />
                      <div style={{ width: `${(c.tol / totalAct) * 100}%`, background: YELLOW }} />
                      <div style={{ width: `${(c.fru / totalAct) * 100}%`, background: RED }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Full Country Breakdown</h3>
          <div style={{ overflowX: "auto" }}>
            <DataTable sortable data={countries.map(c => ({
              Country: c.name, iso: c.iso,
              Sessions: c.sessions, Actions: c.actions,
              "Avg (ms)": Math.round(c.avgDur), Errors: c.errors,
              "Err %": parseFloat(c.errRate.toFixed(2)), Apdex: parseFloat(c.apdex.toFixed(3)),
              "LCP (ms)": isNaN(c.lcp) ? 0 : Math.round(c.lcp),
              "CLS": isNaN(c.cls) ? 0 : parseFloat(c.cls.toFixed(3)),
              "INP (ms)": isNaN(c.inp) ? 0 : Math.round(c.inp),
            }))} columns={[
              { id: "Country", header: "Country", accessor: "Country", cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{value}</span> },
              { id: "Sessions", header: "Sessions", accessor: "Sessions", sortType: "number" as any, cell: ({ value }: any) => <span>{fmtCount(value)}</span> },
              { id: "Actions", header: "Actions", accessor: "Actions", sortType: "number" as any, cell: ({ value }: any) => <span>{fmtCount(value)}</span> },
              { id: "Avg (ms)", header: "Avg Duration", accessor: "Avg (ms)", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 3000 ? RED : value > 1000 ? YELLOW : GREEN }}>{fmtMs(value)}</span> },
              { id: "Errors", header: "Errors", accessor: "Errors", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 0 ? RED : GREEN, fontWeight: 700 }}>{value}</span> },
              { id: "Err %", header: "Error %", accessor: "Err %", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 5 ? RED : value > 1 ? YELLOW : GREEN }}>{fmtPct(value)}</span> },
              { id: "Apdex", header: "Apdex", accessor: "Apdex", sortType: "number" as any, cell: ({ value }: any) => <strong style={{ color: apdexClr(value) }}>{value.toFixed(2)}</strong> },
              { id: "LCP (ms)", header: "LCP", accessor: "LCP (ms)", sortType: "number" as any, cell: ({ value }: any) => value > 0 ? <span style={{ color: value > CWV.lcp.poor ? RED : value > CWV.lcp.good ? YELLOW : GREEN }}>{fmtMs(value)}</span> : <span style={{ opacity: 0.3 }}>—</span> },
              { id: "CLS", header: "CLS", accessor: "CLS", sortType: "number" as any, cell: ({ value }: any) => value > 0 ? <span style={{ color: value > CWV.cls.poor ? RED : value > CWV.cls.good ? YELLOW : GREEN }}>{value.toFixed(3)}</span> : <span style={{ opacity: 0.3 }}>—</span> },
              { id: "INP (ms)", header: "INP", accessor: "INP (ms)", sortType: "number" as any, cell: ({ value }: any) => value > 0 ? <span style={{ color: value > CWV.inp.poor ? RED : value > CWV.inp.good ? YELLOW : GREEN }}>{fmtMs(value)}</span> : <span style={{ opacity: 0.3 }}>—</span> },
            ]} />
          </div>
        </>
      )}
    </div>
  );
};

// ===========================================================================
// SUB-TAB 4: Maps — world choropleth + globe
// ===========================================================================

const MAP_METRICS: { id: MapMetric; label: string }[] = [
  { id: "sessions",          label: "Sessions" },
  { id: "avgDur",            label: "Avg Duration" },
  { id: "apdex",             label: "Apdex" },
  { id: "errRate",           label: "Error Rate" },
  { id: "fruRate",           label: "Frustration %" },
  { id: "actionsPerSession", label: "Actions/Session" },
  { id: "lcp",               label: "LCP" },
  { id: "cls",               label: "CLS" },
  { id: "inp",               label: "INP" },
];

type CountryData = {
  iso: string; numericId: string; sessions: number; actions: number; avgDur: number;
  errors: number; sat: number; tol: number; fru: number;
  lcp: number; cls: number; inp: number;
  apdex: number; errRate: number;
};

const WorldMapSubTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const bucketLabel = tl.enabled ? tl.bucket : undefined;

  const [metric, setMetric] = useState<MapMetric>("sessions");
  const [mapView, setMapView] = useState<MapView>("world");
  const [animKey, setAnimKey] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [rotLng, setRotLng] = useState(0);
  const [spinLock, setSpinLock] = useState<-1 | 0 | 1>(0);
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdingRef = useRef(false);

  const geoData = useDql(geoFullQuery(timeframeDays, sel), [timeframeDays, sel]);
  const tlData  = useDql(tl.enabled ? geoFullBucketedQuery(timeframeDays, sel, bucketLabel) : null, [timeframeDays, sel, tl.enabled, bucketLabel]);

  // Spin controls
  const startSpin = useCallback((dir: number) => {
    if (spinRef.current) return;
    spinRef.current = setInterval(() => setRotLng(prev => prev + dir * 0.8), 30);
  }, []);
  const stopSpin = useCallback(() => { if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; } }, []);
  const handleSpinDown = useCallback((dir: -1 | 1) => {
    holdingRef.current = true;
    if (spinLock) { setSpinLock(0); stopSpin(); } else { startSpin(dir); }
  }, [spinLock, startSpin, stopSpin]);
  const handleSpinUp = useCallback(() => {
    holdingRef.current = false;
    if (!spinLock) stopSpin();
  }, [spinLock, stopSpin]);
  const handleSpinLockToggle = useCallback((dir: -1 | 1) => {
    if (spinLock === dir) { setSpinLock(0); stopSpin(); }
    else { setSpinLock(dir); stopSpin(); startSpin(dir); }
    holdingRef.current = false;
  }, [spinLock, startSpin, stopSpin]);
  useEffect(() => () => { if (spinRef.current) clearInterval(spinRef.current); }, []);

  // Parse timelapse data
  const tlBucketsData = useMemo(() => {
    const buckets = new Map<string, Map<string, { sessions: number; actions: number; avgDur: number; errors: number; sat: number; tol: number; fru: number; lcp: number; cls: number; inp: number }>>();
    (tlData.data?.records ?? []).forEach((r: any) => {
      const rawHour = r.hour_bucket;
      const hour = typeof rawHour === "string" ? rawHour : (rawHour?.value ?? rawHour?.toString?.() ?? "");
      const country = String(r.country ?? "").toUpperCase();
      if (!hour || !country) return;
      if (!buckets.has(hour)) buckets.set(hour, new Map());
      const b = buckets.get(hour)!;
      b.set(country, {
        sessions: Number(r.sessions ?? 0), actions: Number(r.actions ?? 0),
        avgDur: Number(r.avg_dur ?? 0), errors: Number(r.errors ?? 0),
        sat: Number(r.satisfied ?? 0), tol: Number(r.tolerating ?? 0), fru: Number(r.frustrated ?? 0),
        lcp: Number(r.lcp_avg ?? 0), cls: Number(r.cls_avg ?? 0), inp: Number(r.inp_avg ?? 0),
      });
    });
    const hours = Array.from(buckets.keys()).sort();
    return { buckets, hours };
  }, [tlData.data]);

  useEffect(() => {
    if (!tl.enabled) return;
    const key = tlBucketsData.hours.length > 0 ? tlBucketsData.hours[Math.min(tl.index, tlBucketsData.hours.length - 1)] ?? "" : "";
    tl.reportBuckets(tlBucketsData.hours.length, key);
  }, [tl.enabled, tlBucketsData.hours, tl.index]);

  useEffect(() => {
    if (!tl.enabled) return;
    tl.reportLoading("maps", !!tlData.loading);
    return () => tl.reportLoading("maps", false);
  }, [tl.enabled, tlData.loading]);

  // Build country data
  const countries = useMemo((): CountryData[] => {
    const m = new Map<string, { sessions: number; actions: number; avgDur: number; errors: number; sat: number; tol: number; fru: number; lcpSum: number; lcpN: number; clsSum: number; clsN: number; inpSum: number; inpN: number }>();
    (geoData.data?.records ?? []).forEach((r: any) => {
      const iso = String(r.country ?? "").toUpperCase();
      if (!iso) return;
      const d = m.get(iso) ?? { sessions: 0, actions: 0, avgDur: 0, errors: 0, sat: 0, tol: 0, fru: 0, lcpSum: 0, lcpN: 0, clsSum: 0, clsN: 0, inpSum: 0, inpN: 0 };
      const act = Number(r.actions ?? 0);
      d.avgDur = d.actions > 0 ? (d.avgDur * d.actions + Number(r.avg_dur ?? 0) * act) / (d.actions + act) : Number(r.avg_dur ?? 0);
      d.sessions += Number(r.sessions ?? 0); d.actions += act;
      d.errors += Number(r.errors ?? 0);
      d.sat += Number(r.satisfied ?? 0); d.tol += Number(r.tolerating ?? 0); d.fru += Number(r.frustrated ?? 0);
      const lcp = Number(r.lcp_avg ?? NaN); if (!isNaN(lcp) && lcp > 0) { d.lcpSum += lcp * act; d.lcpN += act; }
      const cls = Number(r.cls_avg ?? NaN); if (!isNaN(cls)) { d.clsSum += cls * act; d.clsN += act; }
      const inp = Number(r.inp_avg ?? NaN); if (!isNaN(inp) && inp > 0) { d.inpSum += inp * act; d.inpN += act; }
      m.set(iso, d);
    });
    return Array.from(m.entries()).map(([iso, d]) => ({
      iso, numericId: ISO_ALPHA2_TO_NUMERIC[iso] ?? "",
      sessions: d.sessions, actions: d.actions, avgDur: d.avgDur, errors: d.errors,
      sat: d.sat, tol: d.tol, fru: d.fru,
      lcp: d.lcpN > 0 ? d.lcpSum / d.lcpN : NaN,
      cls: d.clsN > 0 ? d.clsSum / d.clsN : NaN,
      inp: d.inpN > 0 ? d.inpSum / d.inpN : NaN,
      apdex: calcApdex(d.sat, d.tol, d.sat + d.tol + d.fru),
      errRate: d.actions > 0 ? (d.errors / d.actions) * 100 : 0,
    }));
  }, [geoData.data]);

  const dataByNumericId = useMemo(() => new Map(countries.map(c => [c.numericId, c])), [countries]);
  const dataByIso = useMemo(() => new Map(countries.map(c => [c.iso, c])), [countries]);

  const maxSessions = Math.max(1, ...countries.map(c => c.sessions));

  const getMetricValue = (c: CountryData): number => {
    switch (metric) {
      case "sessions":          return c.sessions;
      case "avgDur":            return c.avgDur;
      case "apdex":             return c.apdex;
      case "errRate":           return c.errRate;
      case "fruRate":           return c.actions > 0 ? (c.fru / c.actions) * 100 : 0;
      case "actionsPerSession": return c.sessions > 0 ? c.actions / c.sessions : 0;
      case "lcp":               return isNaN(c.lcp) ? 0 : c.lcp;
      case "cls":               return isNaN(c.cls) ? 0 : c.cls;
      case "inp":               return isNaN(c.inp) ? 0 : c.inp;
    }
  };

  const getMetricColor = (c: CountryData): string => {
    const v = getMetricValue(c);
    switch (metric) {
      case "sessions": { const i = v / maxSessions; return `rgb(${Math.round(20 + i * 35)},${Math.round(80 + i * 57)},${Math.round(120 + i * 135)})`; }
      case "avgDur":   return v > 3000 ? RED : v > 1500 ? ORANGE : v > 800 ? YELLOW : GREEN;
      case "apdex":    return apdexClr(v);
      case "errRate":  return v > 5 ? RED : v > 2 ? ORANGE : v > 0.5 ? YELLOW : GREEN;
      case "fruRate":  return v > 15 ? RED : v > 5 ? ORANGE : v > 1 ? YELLOW : GREEN;
      case "actionsPerSession": { const max = Math.max(1, ...countries.map(c2 => c2.sessions > 0 ? c2.actions / c2.sessions : 0)); const i = v / max; return `rgb(${Math.round(20 + i * 10)},${Math.round(80 + i * 100)},${Math.round(50 + i * 50)})`; }
      case "lcp":      return v > CWV.lcp.poor ? RED : v > CWV.lcp.good ? ORANGE : GREEN;
      case "cls":      return v > CWV.cls.poor ? RED : v > CWV.cls.good ? ORANGE : GREEN;
      case "inp":      return v > CWV.inp.poor ? RED : v > CWV.inp.good ? ORANGE : GREEN;
    }
  };

  const formatMetricValue = (c: CountryData): string => {
    const v = getMetricValue(c);
    switch (metric) {
      case "sessions":          return fmtCount(v);
      case "avgDur":            return fmtMs(v);
      case "apdex":             return v.toFixed(2);
      case "errRate":           return fmtPct(v);
      case "fruRate":           return fmtPct(v);
      case "actionsPerSession": return v.toFixed(1);
      case "lcp":               return fmtMs(v);
      case "cls":               return v.toFixed(3);
      case "inp":               return fmtMs(v);
    }
  };

  // Time-lapse coloring
  const currentHourData = tl.enabled && tlBucketsData.hours.length > 0
    ? tlBucketsData.buckets.get(tlBucketsData.hours[Math.min(tl.index, tlBucketsData.hours.length - 1)])
    : null;

  const getTlColor = (iso: string): string => {
    if (!currentHourData) return "rgba(255,255,255,0.04)";
    const snap = currentHourData.get(iso);
    if (!snap) return "rgba(255,255,255,0.04)";
    const apdex = calcApdex(snap.sat, snap.tol, snap.actions);
    const errRate = snap.actions > 0 ? (snap.errors / snap.actions) * 100 : 0;
    const intensity = snap.sessions / maxSessions;
    switch (metric) {
      case "sessions": return `rgb(${Math.round(20 + intensity * 35)},${Math.round(80 + intensity * 57)},${Math.round(120 + intensity * 135)})`;
      case "avgDur":   return snap.avgDur > 3000 ? RED : snap.avgDur > 1500 ? ORANGE : snap.avgDur > 800 ? YELLOW : GREEN;
      case "apdex":    return apdexClr(apdex);
      case "errRate":  return errRate > 5 ? RED : errRate > 2 ? ORANGE : errRate > 0.5 ? YELLOW : GREEN;
      case "fruRate":  { const fr = snap.actions > 0 ? (snap.fru / snap.actions) * 100 : 0; return fr > 15 ? RED : fr > 5 ? ORANGE : fr > 1 ? YELLOW : GREEN; }
      case "actionsPerSession": { const aps = snap.sessions > 0 ? snap.actions / snap.sessions : 0; const i2 = aps / 10; return `rgb(${Math.round(20 + i2 * 10)},${Math.round(80 + i2 * 100)},${Math.round(50 + i2 * 50)})`; }
      case "lcp":      return snap.lcp > CWV.lcp.poor ? RED : snap.lcp > CWV.lcp.good ? ORANGE : GREEN;
      case "cls":      return snap.cls > CWV.cls.poor ? RED : snap.cls > CWV.cls.good ? ORANGE : GREEN;
      case "inp":      return snap.inp > CWV.inp.poor ? RED : snap.inp > CWV.inp.good ? ORANGE : GREEN;
    }
  };

  const handleMetricChange = (m: MapMetric) => { setMetric(m); setAnimKey(k => k + 1); };

  const selectedCountry = selectedIso ? dataByIso.get(selectedIso) : null;


  const animCSS = `
    @keyframes nf-map-fadein { from { opacity: 0; } to { opacity: 1; } }
    .nf-worldmap { animation: nf-map-fadein 0.5s ease-out both; }
    .nf-country-path { transition: fill 0.4s ease, stroke 0.15s ease; }
    .nf-country-path:hover { stroke: rgba(255,255,255,0.8) !important; stroke-width: 1.5px !important; filter: brightness(1.3); }
  `;

  if (geoData.loading && countries.length === 0) return <EmptyState loading />;

  return (
    <div style={{ padding: "16px 20px" }}>
      <style>{animCSS}</style>

      {/* View + Metric controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["world", "globe"] as MapView[]).map(v => (
            <button key={v} onClick={() => { setMapView(v); setAnimKey(k => k + 1); }} style={{
              padding: "6px 14px", borderRadius: 6, border: `1px solid ${mapView === v ? BLUE : "rgba(128,128,128,0.3)"}`,
              background: mapView === v ? `${BLUE}22` : "transparent", color: mapView === v ? BLUE : "rgba(128,128,128,0.7)",
              fontSize: 12, fontWeight: mapView === v ? 700 : 400, cursor: "pointer",
            }}>{v === "world" ? "World" : "Globe"}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {MAP_METRICS.map(m => (
          <button key={m.id} onClick={() => handleMetricChange(m.id)} style={{
            padding: "5px 12px", borderRadius: 6, border: `1px solid ${metric === m.id ? BLUE : "rgba(128,128,128,0.3)"}`,
            background: metric === m.id ? `${BLUE}22` : "transparent", color: metric === m.id ? BLUE : "rgba(128,128,128,0.7)",
            fontSize: 11, fontWeight: metric === m.id ? 700 : 400, cursor: "pointer",
          }}>{m.label}</button>
        ))}
      </div>

      {tl.enabled && (
        <div style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(128,128,128,0.06)", borderRadius: 8, border: "1px solid rgba(128,128,128,0.15)", fontSize: 12, opacity: 0.8 }}>
          Time-Lapse active · bucket {TL_BUCKET_LABELS[tl.bucket] ?? tl.bucket}
          {tlBucketsData.hours.length > 0 && ` · ${tlBucketsData.hours.length} snapshots · ${tlBucketsData.hours[Math.min(tl.index, tlBucketsData.hours.length - 1)] ?? ""}`}
          {tlData.loading && " · loading…"}
        </div>
      )}

      {countries.length === 0 ? <EmptyState error={geoData.error ?? "No geographic data"} /> : (
        <>
          {/* WORLD MAP */}
          {mapView === "world" && (
            <div style={{ background: "rgba(6,10,20,0.95)", borderRadius: 12, padding: 12, border: "1px solid rgba(255,255,255,0.06)", position: "relative" }}>
              <div className="nf-worldmap" key={animKey}>
                <svg viewBox="0 0 960 500" style={{ width: "100%", display: "block" }}>
                  <defs>
                    <radialGradient id="nf-ocean" cx="50%" cy="40%" r="70%">
                      <stop offset="0%" stopColor="rgba(12,18,35,1)" />
                      <stop offset="100%" stopColor="rgba(4,8,16,1)" />
                    </radialGradient>
                  </defs>
                  <rect width="960" height="500" fill="url(#nf-ocean)" rx="8" />
                  {(worldGeo as any).features.map((feat: any, fIdx: number) => {
                    const numId = String(feat.id);
                    const alpha2 = ISO_NUMERIC_TO_ALPHA2[numId] ?? "";
                    const c = dataByNumericId.get(numId);
                    const d = worldPathGen(feat) ?? "";
                    const isHov = hoveredId === numId;
                    const delay = Math.min(fIdx * 0.006, 0.6);
                    const isSelected = selectedIso === alpha2;

                    if (tl.enabled && alpha2) {
                      const fillColor = getTlColor(alpha2);
                      const snap = currentHourData?.get(alpha2);
                      return (
                        <path key={numId} d={d} fill={fillColor}
                          stroke={isHov ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.12)"}
                          strokeWidth={isHov ? 1.5 : 0.4}
                          style={{ transition: "fill 0.5s ease", cursor: c ? "pointer" : "default" }}
                          className="nf-country-path"
                          onMouseEnter={() => setHoveredId(numId)} onMouseLeave={() => setHoveredId(null)}>
                          <title>{decodeName(alpha2, "")}{snap ? `\nSessions: ${fmtCount(snap.sessions)}\nApdex: ${calcApdex(snap.sat, snap.tol, snap.actions).toFixed(2)}` : "\nNo data this bucket"}</title>
                        </path>
                      );
                    }

                    if (c) return (
                      <path key={numId} d={d}
                        fill={getMetricColor(c)}
                        stroke={isHov || isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.2)"}
                        strokeWidth={isHov || isSelected ? 2 : 0.5}
                        className="nf-country-path"
                        style={{ animationDelay: `${delay}s`, cursor: "pointer" }}
                        onClick={() => setSelectedIso(isSelected ? null : alpha2)}
                        onMouseEnter={() => setHoveredId(numId)} onMouseLeave={() => setHoveredId(null)}>
                        <title>{decodeName(c.iso, "")}\n{MAP_METRICS.find(m => m.id === metric)?.label}: {formatMetricValue(c)}\nSessions: {fmtCount(c.sessions)}\nApdex: {c.apdex.toFixed(2)}\nErr%: {fmtPct(c.errRate)}</title>
                      </path>
                    );
                    return (
                      <path key={numId} d={d} fill="rgba(255,255,255,0.04)"
                        stroke="rgba(255,255,255,0.08)" strokeWidth={0.3}
                        className="nf-country-path"
                        style={{ animationDelay: `${delay}s` }}
                        onMouseEnter={() => setHoveredId(numId)} onMouseLeave={() => setHoveredId(null)} />
                    );
                  })}
                </svg>
              </div>
              {/* Selected country detail panel */}
              {selectedCountry && (
                <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15 }}>{decodeName(selectedCountry.iso, "")}</strong>
                  <span>Sessions: <strong>{fmtCount(selectedCountry.sessions)}</strong></span>
                  <span>Apdex: <strong style={{ color: apdexClr(selectedCountry.apdex) }}>{selectedCountry.apdex.toFixed(2)}</strong></span>
                  <span>Avg: <strong style={{ color: selectedCountry.avgDur > 3000 ? RED : GREEN }}>{fmtMs(selectedCountry.avgDur)}</strong></span>
                  <span>Errors: <strong style={{ color: selectedCountry.errors > 0 ? RED : GREEN }}>{fmtCount(selectedCountry.errors)}</strong></span>
                  {!isNaN(selectedCountry.lcp) && <span>LCP: <strong style={{ color: selectedCountry.lcp > CWV.lcp.poor ? RED : GREEN }}>{fmtMs(selectedCountry.lcp)}</strong></span>}
                  <a href={sessionsFilterUrl(selectedCountry.iso, sel, timeframeDays)} target="_blank" rel="noopener noreferrer"
                    style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, border: `1px solid ${BLUE}55`, background: `${BLUE}18`, color: BLUE, fontSize: 11, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                    View Sessions ↗
                  </a>
                  <button onClick={() => setSelectedIso(null)} style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(128,128,128,0.3)", background: "transparent", color: "rgba(128,128,128,0.7)", fontSize: 11, cursor: "pointer" }}>✕ Close</button>
                </div>
              )}
            </div>
          )}

          {/* GLOBE — manual orthographic projection with pen-lift to avoid wrap artifacts */}
          {mapView === "globe" && (() => {
            const RAD = Math.PI / 180;
            const R = 200;
            const CX = 480, CY = 260;

            // Stricter visibility — reject points near the rim (cosC > 0.15) to avoid edge artifacts
            const projectStrict = (lat: number, lng: number): [number, number, boolean] => {
              const lam = (lng - rotLng) * RAD;
              const phi = lat * RAD;
              const cosC = Math.cos(phi) * Math.cos(lam);
              const x = CX + R * Math.cos(phi) * Math.sin(lam);
              const y = CY - R * Math.sin(phi);
              return [x, y, cosC > 0.15];
            };

            // Build paths with pen-lift: lift when invisible → no equator wrap artifacts
            const globePaths: { fillD: string; d: string; fill: string; title: string; alpha2: string }[] = [];
            (worldGeo as any).features.forEach((feat: any) => {
              const numId = String(feat.id);
              const alpha2 = ISO_NUMERIC_TO_ALPHA2[numId] ?? "";
              const c = dataByIso.get(alpha2);
              const fill = c ? (tl.enabled ? getTlColor(alpha2) : getMetricColor(c)) : "rgba(255,255,255,0.04)";
              const title = c ? `${decodeName(c.iso, "")}\n${MAP_METRICS.find(m => m.id === metric)?.label}: ${formatMetricValue(c)}` : "";
              const coords = feat.geometry?.coordinates;
              if (!coords || coords.length === 0) return;
              const rings: number[][][] = feat.geometry.type === "Polygon"
                ? [coords[0]]
                : feat.geometry.type === "MultiPolygon"
                  ? coords.map((p: any) => p[0])
                  : [];
              for (const ring of rings) {
                if (!ring || ring.length < 3) continue;
                let d = "", fillD = "";
                let penDown = false;
                for (let i = 0; i < ring.length; i += 2) {
                  const pt = ring[i];
                  if (!pt) continue;
                  const [x, y, vis] = projectStrict(pt[1], pt[0]);
                  if (vis) {
                    const cmd = penDown ? `L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`;
                    d += cmd; fillD += cmd;
                    penDown = true;
                  } else {
                    if (penDown) fillD += "Z";
                    penDown = false;
                  }
                }
                if (penDown) fillD += "Z";
                if (d) globePaths.push({ fillD, d, fill, title, alpha2 });
              }
            });

            return (
              <div style={{ position: "relative", background: "black", borderRadius: 12, padding: "24px 0", overflow: "hidden" }}>
                <button
                  onMouseDown={() => handleSpinDown(-1)} onMouseUp={handleSpinUp} onMouseLeave={handleSpinUp}
                  onTouchStart={() => handleSpinDown(-1)} onTouchEnd={handleSpinUp}
                  onDoubleClick={() => handleSpinLockToggle(-1)}
                  title={spinLock === -1 ? "Double-click to unlock spin" : "Hold to spin · Double-click to lock"}
                  style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", zIndex: 10, background: spinLock === -1 ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.08)", border: `1px solid ${spinLock === -1 ? "rgba(100,180,255,0.6)" : "rgba(255,255,255,0.2)"}`, borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: spinLock === -1 ? "rgba(100,180,255,1)" : "rgba(255,255,255,0.7)", fontSize: 18 }}
                >◀</button>
                <button
                  onMouseDown={() => handleSpinDown(1)} onMouseUp={handleSpinUp} onMouseLeave={handleSpinUp}
                  onTouchStart={() => handleSpinDown(1)} onTouchEnd={handleSpinUp}
                  onDoubleClick={() => handleSpinLockToggle(1)}
                  title={spinLock === 1 ? "Double-click to unlock spin" : "Hold to spin · Double-click to lock"}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", zIndex: 10, background: spinLock === 1 ? "rgba(100,180,255,0.25)" : "rgba(255,255,255,0.08)", border: `1px solid ${spinLock === 1 ? "rgba(100,180,255,0.6)" : "rgba(255,255,255,0.2)"}`, borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: spinLock === 1 ? "rgba(100,180,255,1)" : "rgba(255,255,255,0.7)", fontSize: 18 }}
                >▶</button>
                <svg viewBox="0 0 960 520" style={{ width: "100%", display: "block" }}>
                  <defs>
                    <radialGradient id="nf-globe-glow" cx="50%" cy="50%" r="50%">
                      <stop offset="85%" stopColor="transparent" />
                      <stop offset="95%" stopColor="rgba(100,180,255,0.15)" />
                      <stop offset="100%" stopColor="rgba(100,180,255,0.4)" />
                    </radialGradient>
                    <radialGradient id="nf-globe-surface" cx="35%" cy="30%" r="65%">
                      <stop offset="0%" stopColor="rgba(10,50,120,1)" />
                      <stop offset="60%" stopColor="rgba(4,20,70,1)" />
                      <stop offset="100%" stopColor="rgba(1,6,28,1)" />
                    </radialGradient>
                    <clipPath id="nf-globe-clip">
                      <circle cx={CX} cy={CY} r={R} />
                    </clipPath>
                  </defs>
                  <rect width="960" height="520" fill="black" />
                  {/* Atmosphere glow rings */}
                  <circle cx={CX} cy={CY} r={R + 12} fill="none" stroke="rgba(180,220,255,0.6)" strokeWidth={2} />
                  <circle cx={CX} cy={CY} r={R + 6} fill="none" stroke="rgba(100,180,255,0.2)" strokeWidth={8} />
                  {/* Globe sphere */}
                  <circle cx={CX} cy={CY} r={R} fill="url(#nf-globe-surface)" />
                  {/* Land fills — clipped to sphere, closed at terminator by fillD */}
                  <g clipPath="url(#nf-globe-clip)">
                    {globePaths.map((p, i) => (
                      <path key={i} d={p.fillD} fill={p.fill} stroke="none"
                        style={{ cursor: p.alpha2 ? "pointer" : "default" }}
                        onClick={() => { if (p.alpha2) window.open(sessionsFilterUrl(p.alpha2, sel, timeframeDays), "_blank", "noopener,noreferrer"); }}
                      />
                    ))}
                  </g>
                  {/* Country borders — pen-lift avoids wrap artifacts */}
                  {globePaths.map((p, i) => (
                    <path key={i} d={p.d} fill="none"
                      stroke="rgba(255,255,255,0.18)" strokeWidth={0.5}
                      strokeLinecap="round" strokeLinejoin="round"
                      style={{ cursor: p.alpha2 ? "pointer" : "default" }}
                      onClick={() => { if (p.alpha2) window.open(sessionsFilterUrl(p.alpha2, sel, timeframeDays), "_blank", "noopener,noreferrer"); }}>
                      {p.title && <title>{p.title}</title>}
                    </path>
                  ))}
                  {/* Outer ring */}
                  <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                </svg>
              </div>
            );
          })()}

          {/* Country table */}
          <div style={{ marginTop: 20, overflowX: "auto" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Country Data Table</h3>
            <DataTable sortable data={countries.slice(0, 100).map(c => ({
              Country: decodeName(c.iso, ""), ISO: c.iso,
              Sessions: c.sessions, Actions: c.actions,
              "Avg (ms)": Math.round(c.avgDur), Errors: c.errors,
              "Err %": parseFloat(c.errRate.toFixed(2)), Apdex: parseFloat(c.apdex.toFixed(3)),
            }))} columns={[
              { id: "Country", header: "Country", accessor: "Country", cell: ({ value }: any) => <span style={{ fontWeight: 600 }}>{value}</span> },
              { id: "Sessions", header: "Sessions", accessor: "Sessions", sortType: "number" as any, cell: ({ value }: any) => <span>{fmtCount(value)}</span> },
              { id: "Avg (ms)", header: "Avg Duration", accessor: "Avg (ms)", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 3000 ? RED : value > 1000 ? YELLOW : GREEN }}>{fmtMs(value)}</span> },
              { id: "Errors", header: "Errors", accessor: "Errors", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 0 ? RED : GREEN }}>{value}</span> },
              { id: "Err %", header: "Err %", accessor: "Err %", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 5 ? RED : value > 1 ? YELLOW : GREEN }}>{fmtPct(value)}</span> },
              { id: "Apdex", header: "Apdex", accessor: "Apdex", sortType: "number" as any, cell: ({ value }: any) => <strong style={{ color: apdexClr(value) }}>{value.toFixed(2)}</strong> },
            ]} />
          </div>
        </>
      )}
    </div>
  );
};

// ===========================================================================
// SUB-TAB 5: Session Replay Spotlight
// ===========================================================================

const SessionReplaySubTab: React.FC = () => {
  const { timeframeDays, webAppFilter } = useSettings();
  const sel = webAppFilter.selected;
  const tl = useTimelapse();
  const replayResult = useDql(sessionReplayQuery(timeframeDays, sel), [timeframeDays, sel]);

  const sessions = (replayResult.data?.records ?? []) as any[];
  const totalSessions = sessions.length;
  const withCrash = sessions.filter((s: any) => s.has_crash).length;
  const withBounce = sessions.filter((s: any) => Boolean(s.is_bounce)).length;
  const totalErrors = sessions.reduce((sum: number, s: any) => sum + Number(s.err ?? 0), 0);
  const avgImpact = totalSessions > 0 ? sessions.reduce((sum: number, s: any) => sum + Number(s.impact_score ?? 0), 0) / totalSessions : 0;

  const tlShared = tl.enabled ? tl.sharedMetrics : null;
  const baseSess = totalSessions;
  const ratio = tlShared && baseSess > 0 ? tlShared.sessions / baseSess : 1;
  const effTotal  = tlShared ? tlShared.sessions : totalSessions;
  const effCrash  = tlShared ? Math.round(withCrash * ratio) : withCrash;
  const effBounce = tlShared ? Math.round(withBounce * ratio) : withBounce;
  const effErrors = tlShared ? tlShared.errorCount : totalErrors;
  const effImpact = tlShared ? Math.max(0, avgImpact * (1 + (tlShared.errorRate - (baseSess > 0 ? (totalErrors / baseSess) * 100 : 0)) * 0.05)) : avgImpact;

  function impactColor(score: number): string { return score >= 50 ? RED : score >= 20 ? ORANGE : score >= 10 ? YELLOW : GREEN; }

  if (replayResult.loading) return <EmptyState loading />;

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        <KpiCard label={tlShared ? "Sessions (bucket)" : "Sessions"} value={fmtCount(effTotal)} rawValue={effTotal} color={BLUE} />
        <KpiCard label={tlShared ? "Crashes (bucket)" : "Crashes"} value={String(effCrash)} rawValue={effCrash} color={effCrash > 0 ? RED : GREEN} />
        <KpiCard label={tlShared ? "Bounces (bucket)" : "Bounces"} value={String(effBounce)} rawValue={effBounce} color={effBounce > 0 ? ORANGE : GREEN} />
        <KpiCard label={tlShared ? "Errors (bucket)" : "Total Errors"} value={fmtCount(effErrors)} rawValue={effErrors} color={effErrors > 5 ? RED : GREEN} />
        <KpiCard label={tlShared ? "Avg Impact (bucket)" : "Avg Impact"} value={effImpact.toFixed(1)} rawValue={effImpact} color={impactColor(effImpact)} />
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Sessions Ranked by Impact</h3>
      {sessions.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", opacity: 0.5, fontSize: 13 }}>
          No session data found in the selected timeframe.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {sessions.slice(0, 20).map((s: any, i: number) => {
            const score = Number(s.impact_score ?? 0);
            const startEnc = s.start_time ? encodeURIComponent(String(new Date(String(s.start_time)))) : "";
            const replayUrl = `${ENV_URL}/ui/apps/dynatrace.users.sessions/session-viewer/${s.session_id}/${startEnc}?tf=now-2h%3Bnow&df=1&perspective=general&sort=hasReplay%3Adescending`;
            return (
              <div key={String(s.session_id ?? i)} style={{
                padding: "12px 16px", borderLeft: `3px solid ${impactColor(score)}`,
                background: "rgba(128,128,128,0.04)", border: "1px solid rgba(128,128,128,0.15)", borderRadius: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: impactColor(score), minWidth: 26, textAlign: "center" }}>#{i + 1}</span>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                      <strong style={{ fontSize: 13 }}>Impact: {score.toFixed(0)}</strong>
                      {s.app_name && s.app_name !== "unknown" && <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, background: "rgba(69,137,255,0.15)", color: BLUE, fontWeight: 600 }}>{String(s.app_name)}</span>}
                      {Boolean(s.has_crash) && <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, background: `${RED}20`, color: RED, fontWeight: 700 }}>CRASH</span>}
                      {Boolean(s.is_bounce) && <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, background: `${ORANGE}20`, color: ORANGE, fontWeight: 700 }}>BOUNCE</span>}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>
                      {Number(s.dur_s ?? 0).toFixed(1)}s · {s.err} error{Number(s.err) !== 1 ? "s" : ""} · {s.navs} page{Number(s.navs) !== 1 ? "s" : ""} · {s.interactions} interaction{Number(s.interactions) !== 1 ? "s" : ""}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.4 }}>
                      {[s.device, s.browser_name, s.country].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                <a href={replayUrl} target="_blank" rel="noopener noreferrer"
                  style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${BLUE}`, color: BLUE, fontSize: 12, textDecoration: "none", whiteSpace: "nowrap", marginLeft: 12 }}>
                  ▶ Replay
                </a>
              </div>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Session Detail Table</h3>
          <div style={{ overflowX: "auto" }}>
            <DataTable sortable data={sessions.map((s: any) => {
              const st = s.start_time ? encodeURIComponent(String(new Date(String(s.start_time)))) : "";
              return {
                "Web App": String(s.app_name ?? "—"),
                Impact: Number(s.impact_score ?? 0),
                "Duration (s)": parseFloat(Number(s.dur_s ?? 0).toFixed(1)),
                Errors: Number(s.err ?? 0),
                Pages: Number(s.navs ?? 0),
                Device: String(s.device ?? "—"),
                Browser: String(s.browser_name ?? "—"),
                Country: String(s.country ?? "—"),
                Crash: Boolean(s.has_crash) ? "Yes" : "No",
                Bounce: Boolean(s.is_bounce) ? "Yes" : "No",
                _replayUrl: `${ENV_URL}/ui/apps/dynatrace.users.sessions/session-viewer/${s.session_id}/${st}?tf=now-2h%3Bnow&df=1&perspective=general&sort=hasReplay%3Adescending`,
              };
            })} columns={[
              { id: "Web App", header: "Web App", accessor: "Web App", cell: ({ value }: any) => <span style={{ fontWeight: 600, color: BLUE }}>{value}</span> },
              { id: "Impact", header: "Impact", accessor: "Impact", sortType: "number" as any, cell: ({ value }: any) => <strong style={{ color: impactColor(value) }}>{value}</strong> },
              { id: "Duration (s)", header: "Duration (s)", accessor: "Duration (s)", sortType: "number" as any },
              { id: "Errors", header: "Errors", accessor: "Errors", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 0 ? RED : GREEN }}>{value}</span> },
              { id: "Pages", header: "Pages", accessor: "Pages", sortType: "number" as any },
              { id: "Device", header: "Device", accessor: "Device" },
              { id: "Browser", header: "Browser", accessor: "Browser" },
              { id: "Country", header: "Country", accessor: "Country" },
              { id: "Crash", header: "Crash", accessor: "Crash", cell: ({ value }: any) => <span style={{ color: value === "Yes" ? RED : GREEN }}>{value}</span> },
              { id: "Bounce", header: "Bounce", accessor: "Bounce", cell: ({ value }: any) => <span style={{ color: value === "Yes" ? ORANGE : GREEN }}>{value}</span> },
              { id: "Replay", header: "Replay", accessor: "_replayUrl", cell: ({ value }: any) => (
                <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, fontSize: 12, textDecoration: "none" }}>▶ Replay</a>
              )},
            ]} />
          </div>
        </>
      )}
    </div>
  );
};

// ===========================================================================
// PARENT: NavigationFlowsTab — routes between the five sub-tabs
// ===========================================================================

const NAV_FLOWS_TABS: { id: NavFlowsSubTab; label: string }[] = [
  { id: "paths",  label: "Navigation Paths" },
  { id: "sankey", label: "Sankey" },
  { id: "geo",    label: "Geo Heatmap" },
  { id: "maps",   label: "Maps" },
  { id: "replay", label: "Session Replay" },
];

export const NavigationFlowsTab: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavFlowsSubTab>("paths");
  const { timeframeDays, webAppFilter, subTabVisibility } = useSettings();
  const sel = webAppFilter.selected;

  const topPagesResult = useDql(topPagesQuery(timeframeDays, sel), [timeframeDays, sel]);
  const transitionsResult = useDql(pageTransitionsQuery(timeframeDays, sel), [timeframeDays, sel]);

  const navStats = useMemo(() => {
    const pages = (topPagesResult.data?.records ?? []) as any[];
    const txns = (transitionsResult.data?.records ?? []) as any[];
    const uniquePages = pages.length;
    const totalSessions = txns.length; // each record = one session with multi-page path
    const totalTransitions = txns.reduce((a: number, r: any) => a + Math.max(0, Number(r.pathLen ?? 1) - 1), 0);
    return { uniquePages, totalSessions, totalTransitions };
  }, [topPagesResult.data, transitionsResult.data]);

  const { panel: aiPanel } = useAIInsights(useCallback(() =>
    analyzeNavigation(navStats.totalSessions, navStats.uniquePages, navStats.totalTransitions),
  [navStats]));

  const visibleSubTabs = useMemo(() =>
    NAV_FLOWS_TABS.filter(t => subTabVisibility[t.id] !== false),
  [subTabVisibility]);

  // If the active sub-tab was hidden, switch to the first visible one
  const effectiveTab = visibleSubTabs.some(t => t.id === activeTab)
    ? activeTab
    : (visibleSubTabs[0]?.id ?? "paths") as NavFlowsSubTab;

  return (
    <div>
      {aiPanel}
      {visibleSubTabs.length > 0 ? (
        <>
          <SubTabBar tabs={visibleSubTabs} active={effectiveTab} onChange={setActiveTab} />
          {effectiveTab === "paths"  && <NavigationPathsSubTab />}
          {effectiveTab === "sankey" && <SankeySubTab />}
          {effectiveTab === "geo"    && <GeoHeatmapSubTab />}
          {effectiveTab === "maps"   && <WorldMapSubTab />}
          {effectiveTab === "replay" && <SessionReplaySubTab />}
        </>
      ) : (
        <div style={{ padding: 40, textAlign: "center", opacity: 0.5 }}>All sub-tabs hidden. Re-enable them in Settings.</div>
      )}
    </div>
  );
};
