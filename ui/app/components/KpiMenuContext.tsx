import React, { createContext, useContext } from "react";

export interface KpiMenuContextValue {
  openDimension: (opts: { label: string; sparkline?: number[]; color?: string }) => void;
  openHeatmap: (opts: { label: string; sparkline?: number[]; color?: string; getRequeryData?: (days: number) => Promise<{ values: number[]; bucketMs: number; unit?: string }> }) => void;
}

export const KpiMenuContext = createContext<KpiMenuContextValue | null>(null);

export function useKpiMenu() {
  return useContext(KpiMenuContext);
}
