import { useDql as useSdkDql } from "@dynatrace-sdk/react-hooks";

// Thin wrapper around the SDK's useDql so all callsites keep the
// `useDql(queryString, [deps])` signature. deps are ignored — the SDK
// re-runs whenever the query string changes.
export type DqlState<T = Record<string, any>> = {
  data: { records: T[] } | null;
  loading: boolean;
  error: string | null;
};

export function useDql(query: string | null, _deps: unknown[] = []): DqlState {
  const res = useSdkDql({ query: query ?? "fetch user.events | limit 0" });
  return {
    data: res.data ? { records: (res.data.records ?? []) as any[] } : null,
    loading: !!res.isLoading,
    error: res.error ? (res.error as any)?.message ?? String(res.error) : null,
  };
}
