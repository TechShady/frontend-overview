import { useMemo } from "react";

// ---------------------------------------------------------------------------
// useBucketedRanks — helper that takes raw bucketed DQL records and produces
// the `bucketValuesBySort` map consumed by <TimelapseTable/>.
//
// Records must have a bucket timestamp field (default `bkt`) and a row-key
// field (e.g. `application`). All other numeric fields become metric maps.
// ---------------------------------------------------------------------------

export interface UseBucketedRanksOptions<R extends Record<string, any>> {
  records: R[] | null | undefined;
  rowKeyField?: keyof R & string;
  rowKeyFn?: (r: R) => string;         // composite key; takes precedence over rowKeyField
  bucketField?: keyof R & string;      // default "bkt"
  metricFields: Array<keyof R & string>;
}

export interface BucketedRanks {
  bucketCount: number;
  bucketValuesBySort: Record<string, Record<string, (number | null)[]>>;
}

export function useBucketedRanks<R extends Record<string, any>>({
  records, rowKeyField, rowKeyFn, bucketField = "bkt" as any, metricFields,
}: UseBucketedRanksOptions<R>): BucketedRanks {
  const getKey = rowKeyFn ?? ((r: R) => String(r[rowKeyField!] ?? ""));
  return useMemo(() => {
    if (!records || records.length === 0) return { bucketCount: 0, bucketValuesBySort: {} };

    // Collect distinct bucket timestamps in ascending order.
    const bktSet = new Set<string>();
    for (const r of records) {
      const b = String(r[bucketField] ?? "");
      if (b) bktSet.add(b);
    }
    const buckets = [...bktSet].sort();
    const bktIndex: Record<string, number> = {};
    buckets.forEach((b, i) => { bktIndex[b] = i; });
    const bucketCount = buckets.length;

    // For each metric field, build { rowKey → (bucketCount)-length array }.
    const bucketValuesBySort: Record<string, Record<string, (number | null)[]>> = {};
    for (const m of metricFields) {
      bucketValuesBySort[m] = {};
    }

    for (const r of records) {
      const k = getKey(r);
      if (!k) continue;
      const i = bktIndex[String(r[bucketField] ?? "")];
      if (i == null) continue;
      for (const m of metricFields) {
        const map = bucketValuesBySort[m];
        if (!map[k]) map[k] = new Array(bucketCount).fill(null);
        const raw = r[m];
        const v = raw == null || raw === "" ? null : Number(raw);
        map[k][i] = v != null && isFinite(v) ? v : null;
      }
    }

    return { bucketCount, bucketValuesBySort };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, rowKeyField, rowKeyFn, bucketField, JSON.stringify(metricFields)]);
}
