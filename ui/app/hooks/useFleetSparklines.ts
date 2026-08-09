import { useMemo } from "react";

// Aggregate per-bucket fleet metrics from webAppBucketedMetricsQuery output.
// Returns 14 sparklines (sums for counts, weighted avgs for rates/durations).
// Weights: actions for duration; sessions for LCP/INP/CLS/TTFB/load.
export interface FleetSparklines {
  buckets: string[];
  sessions: number[];
  users: number[];
  actions: number[];
  errors: number[];
  errorRate: number[];
  satisfied: number[];
  tolerating: number[];
  frustrated: number[];
  apdex: number[];
  avgDur: number[];
  lcp: number[];
  inp: number[];
  cls: number[];
  ttfb: number[];
  loadEnd: number[];
}

export function useFleetSparklines(records: any[] | undefined | null): FleetSparklines | null {
  return useMemo(() => {
    const recs = records ?? [];
    if (recs.length === 0) return null;
    const buckets = Array.from(new Set(recs.map((r) => String(r.bkt ?? "")))).filter(Boolean).sort();
    if (buckets.length === 0) return null;
    const idx: Record<string, number> = {};
    buckets.forEach((b, i) => { idx[b] = i; });
    const N = buckets.length;
    const z = () => new Array<number>(N).fill(0);
    const sessions = z(), users = z(), actions = z(), errors = z(),
          satisfied = z(), tolerating = z(), frustrated = z();
    const durNum = z(), durDen = z();
    const lcpNum = z(), lcpDen = z();
    const inpNum = z(), inpDen = z();
    const clsNum = z(), clsDen = z();
    const ttfbNum = z(), ttfbDen = z();
    const loadNum = z(), loadDen = z();
    for (const r of recs) {
      const i = idx[String(r.bkt ?? "")];
      if (i == null) continue;
      const s = Number(r.sessions ?? 0), a = Number(r.actions ?? 0), e = Number(r.errors ?? 0);
      sessions[i] += s;
      users[i] += Number(r.users ?? 0);
      actions[i] += a;
      errors[i] += e;
      satisfied[i] += Number(r.satisfied ?? 0);
      tolerating[i] += Number(r.tolerating ?? 0);
      frustrated[i] += Number(r.frustrated ?? 0);
      const push = (num: number[], den: number[], v: any, w: number) => {
        const n = Number(v);
        if (isFinite(n) && n > 0 && w > 0) { num[i] += n * w; den[i] += w; }
      };
      push(durNum, durDen, r.avgDuration, a);
      push(lcpNum, lcpDen, r.lcp, s);
      push(inpNum, inpDen, r.inp, s);
      push(clsNum, clsDen, r.cls, s);
      push(ttfbNum, ttfbDen, r.ttfb, s);
      push(loadNum, loadDen, r.loadEnd, s);
    }
    const div = (n: number[], d: number[]) => n.map((v, i) => d[i] > 0 ? v / d[i] : 0);
    const errorRate = actions.map((a, i) => a > 0 ? (errors[i] / a) * 100 : 0);
    const apdex = actions.map((_, i) => {
      const den = satisfied[i] + tolerating[i] + frustrated[i];
      return den > 0 ? (satisfied[i] + tolerating[i] * 0.5) / den : 0;
    });
    return {
      buckets, sessions, users, actions, errors, errorRate,
      satisfied, tolerating, frustrated, apdex,
      avgDur: div(durNum, durDen),
      lcp: div(lcpNum, lcpDen), inp: div(inpNum, inpDen),
      cls: div(clsNum, clsDen), ttfb: div(ttfbNum, ttfbDen),
      loadEnd: div(loadNum, loadDen),
    };
  }, [records]);
}

// Same idea for a generic sum-only aggregation: pass field names to sum per bucket.
export function useBucketedSums<K extends string>(
  records: any[] | undefined | null,
  fields: readonly K[],
): { buckets: string[] } & Record<K, number[]> | null {
  return useMemo(() => {
    const recs = records ?? [];
    if (recs.length === 0) return null;
    const buckets = Array.from(new Set(recs.map((r) => String(r.bkt ?? "")))).filter(Boolean).sort();
    if (buckets.length === 0) return null;
    const idx: Record<string, number> = {};
    buckets.forEach((b, i) => { idx[b] = i; });
    const N = buckets.length;
    const out: any = { buckets };
    for (const f of fields) out[f] = new Array<number>(N).fill(0);
    for (const r of recs) {
      const i = idx[String(r.bkt ?? "")];
      if (i == null) continue;
      for (const f of fields) out[f][i] += Number(r[f] ?? 0);
    }
    return out;
  }, [records, fields.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Overlay per-bucket-per-app values on a base rows list when TL is playing.
// Base rows are unchanged when TL is off. When on, fields listed in `fields`
// are replaced with the value for `keyField=app, bkt=buckets[tl.index]`.
export function useTlAppOverlay<T extends Record<string, any>>(
  rows: T[],
  bucketedRecords: any[] | undefined | null,
  opts: {
    keyField: keyof T & string;      // e.g. "application"
    bucketKeyField?: string;         // record field for app match (default = keyField)
    tlEnabled: boolean;
    tlIndex: number;
    fields: readonly (keyof T & string)[];
  },
): T[] {
  const { keyField, bucketKeyField, tlEnabled, tlIndex, fields } = opts;
  return useMemo(() => {
    if (!tlEnabled) return rows;
    const recs = bucketedRecords ?? [];
    if (recs.length === 0) return rows;
    const buckets = Array.from(new Set(recs.map((r) => String(r.bkt ?? "")))).filter(Boolean).sort();
    if (buckets.length === 0) return rows;
    const bIdx = Math.min(Math.max(tlIndex, 0), buckets.length - 1);
    const bKey = buckets[bIdx];
    const bF = bucketKeyField ?? keyField;
    const byApp: Record<string, any> = {};
    for (const r of recs) {
      if (String(r.bkt) === bKey) byApp[String(r[bF])] = r;
    }
    return rows.map((r) => {
      const bucketRow = byApp[String(r[keyField])];
      if (!bucketRow) return r;
      const patch: any = {};
      for (const f of fields) {
        const v = bucketRow[f as string];
        if (v != null && v !== "") patch[f] = Number(v);
      }
      return { ...r, ...patch };
    });
  }, [rows, bucketedRecords, tlEnabled, tlIndex, keyField, bucketKeyField, fields.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}
