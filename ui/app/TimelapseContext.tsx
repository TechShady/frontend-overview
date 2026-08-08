import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Shared time-lapse state (ported from user-journey-app). Every tab that
// supports playback can subscribe to enabled/index/playing so all animate together.

export type TlBucket = "1m" | "5m" | "10m" | "30m" | "1h";

export const TL_BUCKETS: { value: TlBucket; label: string }[] = [
  { value: "1m", label: "1 minute" },
  { value: "5m", label: "5 minutes" },
  { value: "10m", label: "10 minutes" },
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
];

export const TL_BUCKET_MS: Record<TlBucket, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "10m": 600_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
};

export const TL_SPEEDS: { value: number; label: string }[] = [
  { value: 4000, label: "0.25x" },
  { value: 2000, label: "0.5x" },
  { value: 1200, label: "1x" },
  { value: 700, label: "2x" },
  { value: 400, label: "4x" },
];

// Table-first default: slow playback so rank movement is legible.
export const TL_TABLE_DEFAULT_SPEED_MS = 4000;

export interface SharedBucketMetrics {
  bucket: string;
  fromMs: number;
  toMs: number;
  sessions: number;
  totalActions: number;
  avgDurationMs: number;
  errorCount: number;
  errorRate: number;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
}

export interface TimelapseState {
  enabled: boolean;
  bucket: TlBucket;
  bucketMs: number;
  speedMs: number;
  playing: boolean;
  index: number;
  totalBuckets: number;
  currentBucketKey: string;
  hotness: number[];
  hotnessSource: string;
  isLoading: boolean;
  sharedMetrics: SharedBucketMetrics | null;
  sharedMetricsAll: SharedBucketMetrics[];
  setEnabled: (v: boolean) => void;
  setBucket: (v: TlBucket) => void;
  setSpeedMs: (v: number) => void;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setIndex: React.Dispatch<React.SetStateAction<number>>;
  reportBuckets: (total: number, currentKey?: string) => void;
  reportHotness: (arr: number[], source?: string) => void;
  reportLoading: (source: string, loading: boolean) => void;
  reportSharedMetrics: (rows: SharedBucketMetrics[]) => void;
}

const TimelapseCtx = createContext<TimelapseState | null>(null);

export function useTimelapse(): TimelapseState {
  const v = useContext(TimelapseCtx);
  if (!v) throw new Error("useTimelapse must be used inside <TimelapseProvider>");
  return v;
}

export const TimelapseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabled] = useState(false);
  const [bucket, setBucket] = useState<TlBucket>("1h");
  const [speedMs, setSpeedMs] = useState(TL_TABLE_DEFAULT_SPEED_MS);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [totalBuckets, setTotalBuckets] = useState(0);
  const [currentBucketKey, setCurrentBucketKey] = useState("");
  const [hotness, setHotness] = useState<number[]>([]);
  const [hotnessSource, setHotnessSource] = useState<string>("");
  const [loadingSources, setLoadingSources] = useState<Set<string>>(() => new Set());
  const [sharedMetricsAll, setSharedMetricsAll] = useState<SharedBucketMetrics[]>([]);

  const totalRef = useRef(0);
  useEffect(() => { totalRef.current = totalBuckets; }, [totalBuckets]);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    if (!enabled) {
      setHotness([]);
      setHotnessSource("");
      setLoadingSources(new Set());
      setSharedMetricsAll([]);
    }
  }, [bucket, enabled]);

  useEffect(() => {
    if (!enabled || !playing) return;
    const id = window.setInterval(() => {
      setIndex(i => {
        const total = totalRef.current;
        if (total === 0) return i;
        const next = i + 1;
        if (next >= total) {
          setPlaying(false);
          return total - 1;
        }
        return next;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [enabled, playing, speedMs]);

  const reportBuckets = useCallback((total: number, key?: string) => {
    setTotalBuckets(total);
    if (key != null) setCurrentBucketKey(key);
  }, []);

  const reportHotness = useCallback((arr: number[], source?: string) => {
    setHotness(arr);
    if (source != null) setHotnessSource(source);
  }, []);

  const reportLoading = useCallback((source: string, loading: boolean) => {
    setLoadingSources(prev => {
      const has = prev.has(source);
      if (loading && has) return prev;
      if (!loading && !has) return prev;
      const next = new Set(prev);
      if (loading) next.add(source); else next.delete(source);
      return next;
    });
  }, []);

  const reportSharedMetrics = useCallback((rows: SharedBucketMetrics[]) => {
    setSharedMetricsAll(rows);
  }, []);

  const isLoading = loadingSources.size > 0;
  const bucketMs = TL_BUCKET_MS[bucket];
  const sharedMetrics = sharedMetricsAll.length > 0
    ? sharedMetricsAll[Math.min(Math.max(index, 0), sharedMetricsAll.length - 1)]
    : null;

  const value = useMemo<TimelapseState>(() => ({
    enabled, bucket, bucketMs, speedMs, playing, index, totalBuckets, currentBucketKey,
    hotness, hotnessSource, isLoading, sharedMetrics, sharedMetricsAll,
    setEnabled, setBucket, setSpeedMs, setPlaying, setIndex,
    reportBuckets, reportHotness, reportLoading, reportSharedMetrics,
  }), [enabled, bucket, bucketMs, speedMs, playing, index, totalBuckets, currentBucketKey, hotness, hotnessSource, isLoading, sharedMetrics, sharedMetricsAll, reportBuckets, reportHotness, reportLoading, reportSharedMetrics]);

  return <TimelapseCtx.Provider value={value}>{children}</TimelapseCtx.Provider>;
};
