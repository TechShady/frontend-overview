import { useEffect, useRef, useState } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

// ---------------------------------------------------------------------------
// useDql — small hook that runs a DQL query and polls until SUCCEEDED.
// Refetches whenever the query string changes.
// ---------------------------------------------------------------------------
export type DqlState<T = Record<string, any>> = {
  data: { records: T[] } | null;
  loading: boolean;
  error: string | null;
};

export function useDql(query: string | null, deps: unknown[] = []): DqlState {
  const [state, setState] = useState<DqlState>({ data: null, loading: !!query, error: null });
  const abortRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    if (abortRef.current) abortRef.current.cancelled = true;
    const ctrl = { cancelled: false };
    abortRef.current = ctrl;
    if (!query) { setState({ data: null, loading: false, error: null }); return; }

    setState({ data: null, loading: true, error: null });
    (async () => {
      try {
        let r = await queryExecutionClient.queryExecute({
          body: { query, requestTimeoutMilliseconds: 30_000, maxResultRecords: 5000 },
        });
        while ((r.state === "RUNNING" || r.state === "NOT_STARTED") && r.requestToken) {
          if (ctrl.cancelled) return;
          await new Promise((res) => setTimeout(res, 1000));
          r = await queryExecutionClient.queryPoll({ requestToken: r.requestToken, requestTimeoutMilliseconds: 30_000 });
        }
        if (ctrl.cancelled) return;
        if (r.state === "SUCCEEDED") {
          const records = (r.result?.records ?? []) as any[];
          setState({ data: { records }, loading: false, error: null });
        } else {
          setState({ data: null, loading: false, error: `Query ${r.state ?? "failed"}` });
        }
      } catch (e: any) {
        if (ctrl.cancelled) return;
        setState({ data: null, loading: false, error: e?.message ?? String(e) });
      }
    })();

    return () => { ctrl.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ...deps]);

  return state;
}
