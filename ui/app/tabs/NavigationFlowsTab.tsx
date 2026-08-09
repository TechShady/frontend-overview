// NavigationFlowsTab — five sub-tabs:
//   1. Navigation Paths  — force-directed SVG page-flow graph + tables
//   2. Sankey            — multi-format page-path flow visualization
//   3. Geo Heatmap       — country performance cards + table
//   4. Maps              — interactive world choropleth map + globe
//   5. Session Replay    — sessions ranked by impact score
//
// REQUIRES npm install after first clone:
//   npm install d3-geo topojson-client world-atlas
//   (and @types/topojson-client @types/world-atlas in devDependencies)

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useSettings, CWV } from "../SettingsContext";
import { useDql } from "../useDql";
import { useTimelapse } from "../TimelapseContext";
import { SectionCard, EmptyState, fmt, InlineBar } from "../components/layout";
import { KpiCard } from "../components/KpiCard";
import { TimelapseTable, TLSortOption } from "../components/TimelapseTable";
import { useBucketedRanks } from "../hooks/useBucketedRanks";
import { useBucketedSums } from "../hooks/useFleetSparklines";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
const ENV_URL = getEnvironmentUrl();
import {
  topPagesQuery, pageTransitionsQuery, pagesBucketedMetricsQuery,
  geoFullQuery, geoFullBucketedQuery,
  sankeyFlowQuery, sankeyExtendedPathsQuery, sankeyPageDurationQuery,
  sankeyPrevPathsQuery, sankeyTimelapseQuery, sessionReplayQuery,
} from "../queries";
import { ISO_ALPHA2_TO_NUMERIC, ISO_NUMERIC_TO_ALPHA2 } from "../worldMapPaths";
import { geoNaturalEarth1, geoPath, geoOrthographic } from "d3-geo";
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
// SUB-TAB 1: Navigation Paths — force-directed graph + tables
// ===========================================================================

interface ForceNode { id: string; label: string; x: number; y: number; r: number; sessions: number; errRate: number; }
interface ForceEdge { source: string; target: string; weight: number; }

function layoutForce(nodes: ForceNode[], edges: ForceEdge[], W: number, H: number, iters = 200): ForceNode[] {
  const ns = nodes.map(n => ({ ...n, vx: 0, vy: 0 }));
  const idx = new Map<string, number>();
  ns.forEach((n, i) => idx.set(n.id, i));
  const k = Math.sqrt((W * H) / Math.max(1, ns.length)) * 0.85;
  for (let it = 0; it < iters; it++) {
    const alpha = 1 - it / iters;
    for (let i = 0; i < ns.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < ns.length; j++) {
        if (i === j) continue;
        const dx = (ns[i].x - ns[j].x) || 0.01;
        const dy = (ns[i].y - ns[j].y) || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (k * k) / dist;
        fx += (dx / dist) * f; fy += (dy / dist) * f;
      }
      ns[i].vx = (ns[i].vx + fx * 0.01 * alpha) * 0.85;
      ns[i].vy = (ns[i].vy + fy * 0.01 * alpha) * 0.85;
    }
    for (const e of edges) {
      const si = idx.get(e.source); const ti = idx.get(e.target);
      if (si == null || ti == null) continue;
      const s = ns[si]; const t = ns[ti];
      const dx = t.x - s.x; const dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const str = Math.log1p(e.weight) * 0.5;
      const f = (dist / k) * str * 0.3 * alpha;
      const fx = (dx / dist) * f; const fy = (dy / dist) * f;
      s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
    }
    for (const n of ns) {
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x + n.vx));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y + n.vy));
    }
  }
  return ns;
}

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
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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

  // Build force graph
  const graphData = useMemo(() => {
    const W = 960; const H = 520;
    const sessByPage = new Map<string, number>();
    const errByPage = new Map<string, number>();
    const viewsByPage = new Map<string, number>();
    pageRows.forEach(r => {
      sessByPage.set(r.name, (sessByPage.get(r.name) ?? 0) + r.views);
      errByPage.set(r.name, (errByPage.get(r.name) ?? 0) + r.errors);
      viewsByPage.set(r.name, (viewsByPage.get(r.name) ?? 0) + r.views);
    });
    const edgeAgg = new Map<string, number>();
    (transitions.data?.records ?? []).forEach((r: any) => {
      const path: string[] = Array.isArray(r.path) ? r.path : [];
      for (let i = 0; i < path.length - 1; i++) {
        const from = String(path[i] ?? ""); const to = String(path[i + 1] ?? "");
        if (!from || !to || from === to) continue;
        const key = `${from}|||${to}`;
        edgeAgg.set(key, (edgeAgg.get(key) ?? 0) + 1);
      }
    });
    const edgesRaw = Array.from(edgeAgg.entries())
      .filter(([, w]) => w >= minTransitions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80);
    const pageSet = new Set<string>();
    edgesRaw.forEach(([k]) => { const [f, t] = k.split("|||"); pageSet.add(f); pageSet.add(t); });
    const maxViews = Math.max(1, ...Array.from(pageSet).map(p => viewsByPage.get(p) ?? 0));
    const seed = (i: number) => { const ang = (i * 2.39996) * Math.PI * 2; const r2 = 0.4 + (i / Math.max(1, pageSet.size)) * 0.5; return [W / 2 + Math.cos(ang) * r2 * W * 0.45, H / 2 + Math.sin(ang) * r2 * H * 0.45]; };
    const forceNodes: ForceNode[] = Array.from(pageSet).map((p, i) => {
      const views = viewsByPage.get(p) ?? 0;
      const errs = errByPage.get(p) ?? 0;
      const errRate = views > 0 ? (errs / views) * 100 : 0;
      const [x, y] = seed(i);
      return { id: p, label: p, x, y, r: 8 + Math.sqrt(views / maxViews) * 22, sessions: views, errRate };
    });
    const forceEdges: ForceEdge[] = edgesRaw.map(([k, w]) => {
      const [source, target] = k.split("|||");
      return { source, target, weight: w };
    });
    const laid = layoutForce(forceNodes, forceEdges, W, H);
    return { nodes: laid, edges: forceEdges, W, H };
  }, [pageRows, transitions.data, minTransitions]);

  const totalViews = pageRows.reduce((a, r) => a + r.views, 0);
  const uniquePages = new Set(pageRows.map(r => r.name)).size;

  const maxViews = Math.max(1, ...pageRows.map(r => r.views));
  const maxTrans = Math.max(1, ...transitionRows.map(r => r.transitions));

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

  const nodeColorOf = (n: ForceNode) => n.errRate > 5 ? RED : n.errRate > 1 ? YELLOW : BLUE;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, padding: 20, flexWrap: "wrap" }}>
        <KpiCard label="Unique pages" value={fmt.num(uniquePages)} rawValue={uniquePages} color={BLUE} sparkline={pageSpk?.views} />
        <KpiCard label="Total page views" value={fmt.num(totalViews)} rawValue={totalViews} color={CYAN} sparkline={pageSpk?.views} />
        <KpiCard label="Transitions shown" value={fmt.num(transitionRows.length)} rawValue={transitionRows.length} color="#A56EFF" sparkline={pageSpk?.views} />
      </div>

      {/* Force-directed graph */}
      <SectionCard title="Page Flow Graph" subtitle="Force-directed layout — node size = page views, color = error rate. Edges = navigation transitions.">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, padding: "0 4px" }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>Min transitions:</span>
          <input type="range" min={1} max={30} value={minTransitions} onChange={e => setMinTransitions(Number(e.target.value))} style={{ width: 120 }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>{minTransitions}</span>
          <div style={{ display: "flex", gap: 16, marginLeft: 16, fontSize: 11, opacity: 0.7 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: BLUE, marginRight: 4 }} />Low err</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: YELLOW, marginRight: 4 }} />&gt;1%</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: RED, marginRight: 4 }} />&gt;5%</span>
          </div>
        </div>
        {(pages.loading || transitions.loading) ? <EmptyState loading /> :
          graphData.nodes.length === 0 ? <EmptyState error="No page transition data available" /> : (
          <div style={{ overflowX: "auto" }}>
            <svg width={graphData.W} height={graphData.H} style={{ display: "block", background: "rgba(6,10,20,0.95)", borderRadius: 8 }}>
              <defs>
                <marker id="navpath-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.25)" />
                </marker>
              </defs>
              {/* Edges */}
              {graphData.edges.map((e, i) => {
                const sn = graphData.nodes.find(n => n.id === e.source);
                const tn = graphData.nodes.find(n => n.id === e.target);
                if (!sn || !tn) return null;
                const isHovered = hoveredNode === e.source || hoveredNode === e.target;
                const alpha = isHovered ? 0.7 : 0.18;
                const maxW = Math.max(...graphData.edges.map(ex => ex.weight));
                const sw = 0.5 + (e.weight / maxW) * 3;
                return (
                  <line key={i} x1={sn.x} y1={sn.y} x2={tn.x} y2={tn.y}
                    stroke={`rgba(255,255,255,${alpha})`} strokeWidth={sw}
                    markerEnd="url(#navpath-arrow)" />
                );
              })}
              {/* Nodes */}
              {graphData.nodes.map(n => {
                const isHov = hoveredNode === n.id;
                const col = nodeColorOf(n);
                return (
                  <g key={n.id} onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} style={{ cursor: "default" }}>
                    <circle cx={n.x} cy={n.y} r={n.r} fill={`${col}22`} stroke={col} strokeWidth={isHov ? 2 : 1} />
                    {isHov && <circle cx={n.x} cy={n.y} r={n.r + 4} fill="none" stroke={col} strokeWidth={1} strokeDasharray="3 3" />}
                    {n.r >= 14 && (
                      <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle"
                        fontSize={Math.max(8, Math.min(11, n.r * 0.5))} fill="rgba(255,255,255,0.85)"
                        style={{ pointerEvents: "none", userSelect: "none" }}>
                        {n.label.length > 18 ? n.label.slice(0, 16) + "…" : n.label}
                      </text>
                    )}
                    <title>{n.label}\nViews: {fmtCount(n.sessions)}\nErr rate: {fmtPct(n.errRate)}</title>
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

  // Connected nodes for focus mode
  const { connectedNodes, connectedLinks } = useMemo(() => {
    if (!focusNodeId) return { connectedNodes: new Set<string>(), connectedLinks: new Set<number>() };
    const cn = new Set<string>([focusNodeId]);
    const cl = new Set<number>();
    links.forEach((l, i) => {
      if (l.source === focusNodeId || l.target === focusNodeId) { cl.add(i); cn.add(l.source); cn.add(l.target); }
    });
    return { connectedNodes: cn, connectedLinks: cl };
  }, [focusNodeId, links]);

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

  const W = 960; const NODE_W = 18; const NODE_PAD_X = (W - NODE_W) / Math.max(1, maxDepth);

  const isLoading = flowData.loading;

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
            <div style={{ overflowX: "auto" }}>
              <svg width={W} height={560} style={{ display: "block", background: "rgba(6,10,20,0.95)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)" }}>
                <defs>
                  {SANKEY_COLORS.map((c, i) => (
                    <linearGradient key={i} id={`sk-grad-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={c} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={SANKEY_COLORS[(i + 1) % SANKEY_COLORS.length]} stopOpacity={0.4} />
                    </linearGradient>
                  ))}
                </defs>
                {/* Links */}
                {links.map((l, i) => {
                  const srcNode = nodes.find(n => n.id === l.source);
                  const tgtNode = nodes.find(n => n.id === l.target);
                  if (!srcNode || !tgtNode) return null;
                  const isFocused = !focusNodeId || connectedLinks.has(i);
                  const x1 = srcNode.depth * NODE_PAD_X + NODE_W;
                  const x2 = tgtNode.depth * NODE_PAD_X;
                  const midX = (x1 + x2) / 2;
                  const y1 = l.sy + l.thickness / 2 + 30;
                  const y2 = l.ty + l.thickness / 2 + 30;
                  const srcColor = sankeyNodeColor(srcNode.label, srcNode.depth);
                  return (
                    <path key={i}
                      d={`M${x1},${l.sy + 30} C${midX},${l.sy + 30} ${midX},${l.ty + 30} ${x2},${l.ty + 30} L${x2},${l.ty + l.thickness + 30} C${midX},${l.ty + l.thickness + 30} ${midX},${l.sy + l.thickness + 30} ${x1},${l.sy + l.thickness + 30} Z`}
                      fill={srcColor} fillOpacity={isFocused ? 0.35 : 0.06}
                      stroke={srcColor} strokeOpacity={isFocused ? 0.5 : 0.1} strokeWidth={0.5}
                      style={{ transition: "fill-opacity 0.2s" }}>
                      <title>{srcNode.label} → {tgtNode.label}: {fmtCount(l.value)} sessions</title>
                    </path>
                  );
                })}
                {/* Nodes */}
                {nodes.map(n => {
                  const isFocused = !focusNodeId || connectedNodes.has(n.id);
                  const col = sankeyNodeColor(n.label, n.depth);
                  const x = n.depth * NODE_PAD_X;
                  return (
                    <g key={n.id} onClick={() => setFocusNodeId(focusNodeId === n.id ? null : n.id)} style={{ cursor: "pointer" }}>
                      <rect x={x} y={n.y + 30} width={NODE_W} height={n.height} fill={col} fillOpacity={isFocused ? 0.85 : 0.2} rx={2} />
                      <text x={x + NODE_W + 5} y={n.y + n.height / 2 + 30 + 1} fontSize={10} fill={isFocused ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)"} dominantBaseline="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
                        {n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label} ({fmtCount(n.value)})
                      </text>
                      <title>{n.label}\n{fmtCount(n.value)} sessions</title>
                    </g>
                  );
                })}
                {/* Column depth labels */}
                {Array.from({ length: maxDepth + 1 }, (_, d) => (
                  <text key={d} x={d * NODE_PAD_X + NODE_W / 2} y={18} textAnchor="middle" fontSize={11} fill="rgba(255,255,255,0.4)">Step {d + 1}</text>
                ))}
              </svg>
              {focusNodeId && (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                  Focused: <strong>{focusNodeId.split("|").slice(1).join("|")}</strong> — click again to clear
                </div>
              )}
            </div>
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
  const [spinning, setSpinning] = useState(false);
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const geoData = useDql(geoFullQuery(timeframeDays, sel), [timeframeDays, sel]);
  const tlData  = useDql(tl.enabled ? geoFullBucketedQuery(timeframeDays, sel, bucketLabel) : null, [timeframeDays, sel, tl.enabled, bucketLabel]);

  // Spin controls
  const startSpin = (dir: number) => {
    if (spinRef.current) clearInterval(spinRef.current);
    spinRef.current = setInterval(() => setRotLng(r => r + dir * 0.8), 30);
  };
  const stopSpin = () => { if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null; } };
  useEffect(() => () => stopSpin(), []);

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

  // Globe: orthographic projection (recomputed each frame due to rotLng)
  const globeProj = useMemo(() =>
    geoOrthographic().scale(240).translate([480, 260]).rotate([-rotLng, -15, 0]),
  [rotLng]);
  const globePathGen = useMemo(() => geoPath().projection(globeProj), [globeProj]);

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
                  <button onClick={() => setSelectedIso(null)} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, border: "1px solid rgba(128,128,128,0.3)", background: "transparent", color: "rgba(128,128,128,0.7)", fontSize: 11, cursor: "pointer" }}>✕ Close</button>
                </div>
              )}
            </div>
          )}

          {/* GLOBE */}
          {mapView === "globe" && (
            <div style={{ background: "rgba(6,10,20,0.95)", borderRadius: 12, padding: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <button onMouseDown={() => { setSpinning(true); startSpin(-1); }} onMouseUp={() => { setSpinning(false); stopSpin(); }} onMouseLeave={() => { if (spinning) { setSpinning(false); stopSpin(); } }}
                  style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(128,128,128,0.3)", background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer", userSelect: "none" }}>◀ Spin</button>
                <button onMouseDown={() => { setSpinning(true); startSpin(1); }} onMouseUp={() => { setSpinning(false); stopSpin(); }} onMouseLeave={() => { if (spinning) { setSpinning(false); stopSpin(); } }}
                  style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid rgba(128,128,128,0.3)", background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer", userSelect: "none" }}>Spin ▶</button>
              </div>
              <svg viewBox="0 0 960 520" style={{ width: "100%", display: "block" }}>
                <defs>
                  <radialGradient id="nf-globe-bg" cx="50%" cy="40%" r="60%">
                    <stop offset="0%" stopColor="#0a1628" />
                    <stop offset="100%" stopColor="#020510" />
                  </radialGradient>
                </defs>
                <circle cx={480} cy={260} r={242} fill="url(#nf-globe-bg)" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                {(worldGeo as any).features.map((feat: any) => {
                  const numId = String(feat.id);
                  const alpha2 = ISO_NUMERIC_TO_ALPHA2[numId] ?? "";
                  const c = dataByIso.get(alpha2);
                  const d = globePathGen(feat) ?? "";
                  if (!d) return null;
                  const fill = c ? (tl.enabled ? getTlColor(alpha2) : getMetricColor(c)) : "rgba(255,255,255,0.04)";
                  return (
                    <path key={numId} d={d} fill={fill} stroke="rgba(255,255,255,0.12)" strokeWidth={0.4}>
                      {c && <title>{decodeName(c.iso, "")}\n{MAP_METRICS.find(m => m.id === metric)?.label}: {formatMetricValue(c)}</title>}
                    </path>
                  );
                })}
                <circle cx={480} cy={260} r={242} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
              </svg>
            </div>
          )}

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
            <DataTable sortable data={sessions.map((s: any) => ({
              Impact: Number(s.impact_score ?? 0),
              "Duration (s)": parseFloat(Number(s.dur_s ?? 0).toFixed(1)),
              Errors: Number(s.err ?? 0),
              Pages: Number(s.navs ?? 0),
              Device: String(s.device ?? "—"),
              Browser: String(s.browser_name ?? "—"),
              Country: String(s.country ?? "—"),
              Crash: Boolean(s.has_crash) ? "Yes" : "No",
              Bounce: Boolean(s.is_bounce) ? "Yes" : "No",
              _sessionId: String(s.session_id ?? ""),
              _startTime: s.start_time,
            }))} columns={[
              { id: "Impact", header: "Impact", accessor: "Impact", sortType: "number" as any, cell: ({ value }: any) => <strong style={{ color: impactColor(value) }}>{value}</strong> },
              { id: "Duration (s)", header: "Duration (s)", accessor: "Duration (s)", sortType: "number" as any },
              { id: "Errors", header: "Errors", accessor: "Errors", sortType: "number" as any, cell: ({ value }: any) => <span style={{ color: value > 0 ? RED : GREEN }}>{value}</span> },
              { id: "Pages", header: "Pages", accessor: "Pages", sortType: "number" as any },
              { id: "Device", header: "Device", accessor: "Device" },
              { id: "Browser", header: "Browser", accessor: "Browser" },
              { id: "Country", header: "Country", accessor: "Country" },
              { id: "Crash", header: "Crash", accessor: "Crash", cell: ({ value }: any) => <span style={{ color: value === "Yes" ? RED : GREEN }}>{value}</span> },
              { id: "Bounce", header: "Bounce", accessor: "Bounce", cell: ({ value }: any) => <span style={{ color: value === "Yes" ? ORANGE : GREEN }}>{value}</span> },
              { id: "Replay", header: "Replay", accessor: "_sessionId", cell: ({ value, rowData }: any) => {
                const st = rowData?._startTime ? encodeURIComponent(String(new Date(String(rowData._startTime)))) : "";
                return (
                  <a href={`${ENV_URL}/ui/apps/dynatrace.users.sessions/session-viewer/${value}/${st}?tf=now-2h%3Bnow&df=1&perspective=general`}
                    target="_blank" rel="noopener noreferrer" style={{ color: CYAN, fontSize: 12, textDecoration: "none" }}>
                    ▶ Replay
                  </a>
                );
              }},
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

  return (
    <div>
      <SubTabBar tabs={NAV_FLOWS_TABS} active={activeTab} onChange={setActiveTab} />
      {activeTab === "paths"  && <NavigationPathsSubTab />}
      {activeTab === "sankey" && <SankeySubTab />}
      {activeTab === "geo"    && <GeoHeatmapSubTab />}
      {activeTab === "maps"   && <WorldMapSubTab />}
      {activeTab === "replay" && <SessionReplaySubTab />}
    </div>
  );
};
