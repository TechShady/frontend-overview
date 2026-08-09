import React, { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@dynatrace/strato-components-preview/tables";
import { useTimelapse } from "../TimelapseContext";
import { EmptyState } from "./layout";

// ---------------------------------------------------------------------------
// TimelapseTable — DataTable wrapper adding a Movement column + Time-Lapse
// playback with rank-change animation on the first column.
//
// Movement = rank delta between:
//   - Time-Lapse OFF: first bucket → last bucket of the current timeframe
//   - Time-Lapse ON:  first bucket → currentIndex bucket (animates)
//
// If `bucketValues` is not provided, Movement shows "—" for every row but the
// column is still present (per user request).
//
// Row identity is provided via `rowKey`. When a row's rank changes between
// two adjacent bucket steps during playback, the value in `firstColumnField`
// briefly flickers green (moved up) or red (moved down) for 400ms.
// ---------------------------------------------------------------------------

export type TLSortOption<T> = {
  value: string;                       // key stored in state (e.g. "sessions")
  label: string;                       // label in the dropdown
  get: (row: T) => number;             // numeric extractor for client-side sort + rank
  higherIsBetter?: boolean;            // default true (higher rank = better = smaller number)
};

export interface TimelapseTableProps<T extends Record<string, any>> {
  data: T[];
  columns: any[];
  rowKey: (row: T) => string;
  firstColumnField: string;            // accessor of the first column (flicker target)
  sortOptions: TLSortOption<T>[];
  defaultSort?: string;
  /** Per-row values per bucket, keyed by sort option value.
   *  Shape: { [sortValue]: { [rowKey]: (number|null)[] } }
   *  Array length must equal bucketCount for that sort. Missing rows are treated as null. */
  bucketValuesBySort?: Record<string, Record<string, (number | null)[]>>;
  bucketHigherIsBetter?: boolean;      // higher metric = better rank? default follows sort option
  loading?: boolean;
  emptyLabel?: string;
  variant?: any;
  resizable?: boolean;
}

// One-time CSS injection for row flicker + Movement visual effects.
const STYLE_ID = "tl-table-styles";
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
@keyframes tl-flicker-up {
  0%   { background: transparent; color: inherit; text-shadow: none; box-shadow: none; }
  15%  { background: rgba(13,156,41,0.55);  color: #fff; text-shadow: 0 0 6px rgba(13,156,41,0.9);  box-shadow: 0 0 12px rgba(13,156,41,0.6); }
  55%  { background: rgba(13,156,41,0.35);  color: #fff; text-shadow: 0 0 4px rgba(13,156,41,0.6);  box-shadow: 0 0 8px rgba(13,156,41,0.4); }
  100% { background: transparent; color: inherit; text-shadow: none; box-shadow: none; }
}
@keyframes tl-flicker-down {
  0%   { background: transparent; color: inherit; text-shadow: none; box-shadow: none; }
  15%  { background: rgba(194,25,48,0.55); color: #fff; text-shadow: 0 0 6px rgba(194,25,48,0.9); box-shadow: 0 0 12px rgba(194,25,48,0.6); }
  55%  { background: rgba(194,25,48,0.35); color: #fff; text-shadow: 0 0 4px rgba(194,25,48,0.6); box-shadow: 0 0 8px rgba(194,25,48,0.4); }
  100% { background: transparent; color: inherit; text-shadow: none; box-shadow: none; }
}
.tl-flicker-up   { animation: tl-flicker-up   900ms ease-out; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.tl-flicker-down { animation: tl-flicker-down 900ms ease-out; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.tl-move-arrow   { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; font-family: monospace; }
`;
  document.head.appendChild(s);
}

function rankOf(values: Array<{ key: string; v: number | null }>, higherIsBetter: boolean): Record<string, number> {
  const sortable = values.filter((x) => x.v != null && isFinite(x.v as number));
  const sorted = [...sortable].sort((a, b) => higherIsBetter ? (b.v as number) - (a.v as number) : (a.v as number) - (b.v as number));
  const out: Record<string, number> = {};
  sorted.forEach((x, i) => { out[x.key] = i + 1; });
  return out;
}

export function TimelapseTable<T extends Record<string, any>>({
  data, columns, rowKey, firstColumnField, sortOptions, defaultSort,
  bucketValuesBySort, bucketHigherIsBetter, loading, emptyLabel, variant, resizable,
}: TimelapseTableProps<T>) {
  ensureStyles();
  const tl = useTimelapse();

  const [sortValue, setSortValue] = useState<string>(defaultSort ?? sortOptions[0]?.value ?? "");
  useEffect(() => {
    if (!sortOptions.find((o) => o.value === sortValue) && sortOptions.length > 0) {
      setSortValue(sortOptions[0].value);
    }
  }, [sortOptions, sortValue]);
  const sortOpt = sortOptions.find((o) => o.value === sortValue) ?? sortOptions[0];
  const higherIsBetter = bucketHigherIsBetter ?? sortOpt?.higherIsBetter ?? true;

  // Bucket values for the currently-selected sort. Fallback to "*" (universal).
  const bucketValues: Record<string, (number | null)[]> | undefined = useMemo(() => {
    if (!bucketValuesBySort) return undefined;
    return bucketValuesBySort[sortValue] ?? bucketValuesBySort["*"];
  }, [bucketValuesBySort, sortValue]);

  // -----------------------------------------------------------------------
  // Rank per bucket + current sort value
  // -----------------------------------------------------------------------
  const bucketCount = Math.max(0, bucketValues ? Math.max(0, ...Object.values(bucketValues).map((a) => a.length)) : 0);

  // Only rank rows that are actually in `data` — extra keys in bucketValues (e.g. apps
  // present in a bucketed query but absent from the main summary query) would otherwise
  // inflate the rank universe and break the sum-of-movements = 0 invariant.
  const dataKeySet = useMemo(() => new Set(data.map((r) => rowKey(r))), [data, rowKey]);

  const ranksPerBucket = useMemo<Record<string, number>[]>(() => {
    if (!bucketValues || bucketCount === 0) return [];
    const out: Record<string, number>[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const values = Object.entries(bucketValues)
        .filter(([k]) => dataKeySet.has(k))
        .map(([k, arr]) => ({ key: k, v: arr[i] ?? null }));
      out.push(rankOf(values, higherIsBetter));
    }
    return out;
  }, [bucketValues, bucketCount, higherIsBetter, dataKeySet]);

  // Current (always-visible) rank derived from `data` sorted by current sort option
  const currentRanks = useMemo<Record<string, number>>(() => {
    if (!sortOpt) return {};
    const values = data.map((r) => ({ key: rowKey(r), v: sortOpt.get(r) }));
    return rankOf(values, sortOpt.higherIsBetter ?? true);
  }, [data, rowKey, sortOpt]);

  // NOTE: bucket count + hotness are published centrally by AppInner from
  // the shared TL metrics query — tables no longer report to avoid overwriting.

  // Playback index: when TL is ON, playbackIdx = tl.index, else = last bucket
  const playbackIdx = tl.enabled && bucketCount > 0
    ? Math.min(tl.index, bucketCount - 1)
    : Math.max(0, bucketCount - 1);
  const startIdx = 0;

  const movementByKey = useMemo<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {};
    if (bucketCount === 0 || ranksPerBucket.length === 0) {
      for (const r of data) out[rowKey(r)] = null;
      return out;
    }
    for (const r of data) {
      const k = rowKey(r);
      // Walk [0..playbackIdx] to find first and last non-null rank for this app.
      // Skipping empty/null buckets ensures sparse data still shows movement.
      let firstRank: number | null = null;
      let lastRank: number | null = null;
      for (let i = 0; i <= playbackIdx; i++) {
        const rank = ranksPerBucket[i]?.[k];
        if (rank != null) {
          if (firstRank === null) firstRank = rank;
          lastRank = rank;
        }
      }
      out[k] = firstRank != null && lastRank != null && firstRank !== lastRank
        ? firstRank - lastRank  // positive = moved up (better), negative = moved down
        : firstRank != null && lastRank != null ? 0 : null;
    }
    return out;
  }, [data, rowKey, ranksPerBucket, bucketCount, playbackIdx]);

  // -----------------------------------------------------------------------
  // Flicker state — trigger when a row's rank changes between consecutive
  // buckets during playback.
  // -----------------------------------------------------------------------
  const [flickerByKey, setFlickerByKey] = useState<Record<string, "up" | "down" | null>>({});
  const prevIdxRef = useRef<number>(-1);
  const timeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!tl.enabled || bucketCount === 0 || ranksPerBucket.length === 0) return;
    const idx = playbackIdx;
    if (prevIdxRef.current === idx) return;
    const prev = prevIdxRef.current;
    prevIdxRef.current = idx;
    if (prev < 0 || prev >= ranksPerBucket.length) return;

    const changes: Record<string, "up" | "down" | null> = {};
    for (const r of data) {
      const k = rowKey(r);
      const rPrev = ranksPerBucket[prev]?.[k];
      const rNow = ranksPerBucket[idx]?.[k];
      if (rPrev == null || rNow == null) continue;
      if (rNow < rPrev) changes[k] = "up";
      else if (rNow > rPrev) changes[k] = "down";
    }
    if (Object.keys(changes).length === 0) return;
    setFlickerByKey((prevState) => ({ ...prevState, ...changes }));

    Object.keys(changes).forEach((k) => {
      if (timeoutsRef.current[k]) window.clearTimeout(timeoutsRef.current[k]);
      timeoutsRef.current[k] = window.setTimeout(() => {
        setFlickerByKey((s) => ({ ...s, [k]: null }));
        delete timeoutsRef.current[k];
      }, 950);
    });
  }, [playbackIdx, tl.enabled, ranksPerBucket, bucketCount, data, rowKey]);

  useEffect(() => () => {
    Object.values(timeoutsRef.current).forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = {};
  }, []);

  // Reset flicker + playback tracker when Time-Lapse is toggled off
  useEffect(() => {
    if (!tl.enabled) {
      prevIdxRef.current = -1;
      setFlickerByKey({});
    }
  }, [tl.enabled]);

  // -----------------------------------------------------------------------
  // Client-side sort by current sort option
  // -----------------------------------------------------------------------
  const sortedData = useMemo(() => {
    if (!sortOpt) return data;
    const dir = sortOpt.higherIsBetter ?? true ? -1 : 1;
    return [...data].sort((a, b) => {
      const va = sortOpt.get(a), vb = sortOpt.get(b);
      const na = isFinite(va) ? va : (dir < 0 ? -Infinity : Infinity);
      const nb = isFinite(vb) ? vb : (dir < 0 ? -Infinity : Infinity);
      return (na - nb) * dir;
    });
  }, [data, sortOpt]);

  // -----------------------------------------------------------------------
  // Inject Movement column + wrap first column with flicker + header click sync
  // -----------------------------------------------------------------------
  const wrappedColumns = useMemo(() => {
    const enhanced = columns.map((col: any) => {
      let result = { ...col };

      // Wrap first column cell with flicker animation
      if (col.accessor === firstColumnField || col.id === firstColumnField) {
        const origCell = col.cell;
        result = {
          ...result,
          cell: (info: any) => {
            // Use the cell value directly as the row key (first-column accessor = rowKey extractor)
            const key = String(info.value ?? "");
            const flick = flickerByKey[key];
            const cls = flick === "up" ? "tl-flicker-up" : flick === "down" ? "tl-flicker-down" : "";
            const content = origCell ? origCell(info) : key;
            return <span className={cls} style={{ display: "inline-block" }}>{content}</span>;
          },
        };
      }

      // Intercept header clicks so sortValue stays in sync with DataTable's column sort.
      // Both DataTable's own sort and our setSortValue fire from the same click.
      const colKey = col.accessor ?? col.id ?? "";
      const matchOpt = sortOptions.find((o) => o.value === colKey);
      if (matchOpt) {
        const origHeader = result.header;
        const optValue = matchOpt.value;
        result = {
          ...result,
          header: (info: any) => (
            <span onClick={() => setSortValue(optValue)} style={{ cursor: "inherit" }}>
              {typeof origHeader === "function" ? origHeader(info) : origHeader}
            </span>
          ),
        };
      }

      return result;
    });

    const movementCol = {
      id: "_movement",
      header: "Movement",
      accessor: "_movement",
      width: 110,
      sortType: "number" as const,
      cell: (info: any) => {
        const delta = info.value as number | null;
        if (delta == null) return <span style={{ opacity: 0.35, fontFamily: "monospace" }}>—</span>;
        if (delta === 0) return <span className="tl-move-arrow" style={{ color: "rgba(128,128,128,0.55)" }} title="No rank change">=</span>;
        if (delta > 0) {
          return (
            <span className="tl-move-arrow" style={{ color: "#0D9C29" }} title={`Moved up ${delta} position${delta === 1 ? "" : "s"}`}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 1 L9 8 L1 8 Z" fill="#0D9C29" /></svg>
              {delta}
            </span>
          );
        }
        return (
          <span className="tl-move-arrow" style={{ color: "#C21930" }} title={`Moved down ${-delta} position${-delta === 1 ? "" : "s"}`}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 9 L1 2 L9 2 Z" fill="#C21930" /></svg>
            {-delta}
          </span>
        );
      },
    };

    return [...enhanced, movementCol];
  }, [columns, firstColumnField, rowKey, flickerByKey, movementByKey, sortOptions, setSortValue]);

  // Attach _movement to each row so DataTable can display + sort it.
  // Use null (not 0) so the cell can distinguish "no data" from "no change".
  const decorated = useMemo(() => sortedData.map((r) => ({ ...r, _movement: movementByKey[rowKey(r)] ?? null })), [sortedData, movementByKey, rowKey]);

  return (
    <div>
      {/* Movement / bucket status strip — sort is driven by column header clicks */}
      {(tl.enabled || bucketCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, fontSize: 11, opacity: 0.7 }}>
          {tl.enabled && bucketCount > 0 && (
            <span style={{ fontFamily: "monospace" }}>
              bucket {playbackIdx + 1}/{bucketCount}
              {tl.playing && <span style={{ marginLeft: 8, color: "#4589FF" }}>▶ playing</span>}
            </span>
          )}
          {!bucketValues && (
            <span style={{ opacity: 0.5 }}>Movement: no bucket data</span>
          )}
          {bucketValues && !tl.enabled && bucketCount > 0 && (
            <span style={{ opacity: 0.65 }}>Movement: first → last of {bucketCount} buckets by {sortOpt?.label ?? sortValue}</span>
          )}
          <span style={{ marginLeft: "auto", opacity: 0.45 }}>Click a column header to sort</span>
        </div>
      )}

      {loading ? <EmptyState loading /> : decorated.length === 0 ? <EmptyState label={emptyLabel} /> : (
        <DataTable data={decorated} columns={wrappedColumns} sortable resizable={resizable !== false} variant={variant ?? { rowSeparation: "horizontalDividers" }} />
      )}
    </div>
  );
}
