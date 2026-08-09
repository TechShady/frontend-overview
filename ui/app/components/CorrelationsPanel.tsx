import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import type { RelatedMetricEntry } from "./KpiCard";
import { KpiSparkline } from "./KpiCard";

// Pearson correlation over the shorter of the two arrays.
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const A = a.slice(-n).map((v) => (isFinite(v) ? v : 0));
  const B = b.slice(-n).map((v) => (isFinite(v) ? v : 0));
  const mA = A.reduce((s, v) => s + v, 0) / n;
  const mB = B.reduce((s, v) => s + v, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const xa = A[i] - mA, xb = B[i] - mB;
    num += xa * xb; dA += xa * xa; dB += xb * xb;
  }
  const denom = Math.sqrt(dA * dB);
  return denom > 0 ? num / denom : 0;
}

export interface CorrelationsPanelProps {
  target: RelatedMetricEntry;
  registry: RelatedMetricEntry[];
  onClose: () => void;
}

export const CorrelationsPanel: React.FC<CorrelationsPanelProps> = ({ target, registry, onClose }) => {
  const ranked = useMemo(() => {
    return registry
      .filter((m) => m.label !== target.label && Array.isArray(m.sparkline) && m.sparkline.length >= 3)
      .map((m) => ({
        entry: m,
        r: pearson(target.sparkline, m.sparkline),
      }))
      .filter((x) => isFinite(x.r) && Math.abs(x.r) >= 0.15)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .slice(0, 12);
  }, [target, registry]);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 3000,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)", maxHeight: "80vh", overflow: "auto",
          background: "var(--dt-colors-background-base-default,#0f1428)",
          border: "1px solid rgba(128,128,128,0.35)", borderRadius: 12,
          boxShadow: "0 12px 48px rgba(0,0,0,0.6)", color: "inherit",
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(128,128,128,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Related metrics — {target.label}</div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>Pearson correlation with other KPIs on this page. Higher |r| ⇒ tighter relationship.</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.6, fontSize: 18, padding: "0 6px" }}
            aria-label="Close"
          >✕</button>
        </div>

        <div style={{ padding: "10px 16px", background: "rgba(128,128,128,0.06)", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
          <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>Target</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, minWidth: 160 }}>{target.label}</div>
            <div style={{ flex: 1 }}>
              <KpiSparkline data={target.sparkline} color={target.color ?? "#4589FF"} />
            </div>
          </div>
        </div>

        {ranked.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", fontSize: 12, opacity: 0.7 }}>
            No significant correlations detected. Not enough KPIs with matching sparklines on this tab, or all correlations are below |r| ≥ 0.15.
          </div>
        ) : (
          <div style={{ padding: "6px 8px" }}>
            {ranked.map(({ entry, r }) => {
              const badKorrelation = target.inverted ? r > 0 : r < 0;
              const strong = Math.abs(r) >= 0.7;
              const mid = Math.abs(r) >= 0.4;
              const badgeColor = badKorrelation ? "#C21930" : "#0D9C29";
              return (
                <div key={entry.label} style={{
                  display: "grid", gridTemplateColumns: "180px 1fr 90px", alignItems: "center",
                  gap: 12, padding: "8px 10px", borderBottom: "1px solid rgba(128,128,128,0.15)",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</div>
                  <div><KpiSparkline data={entry.sparkline} color={entry.color ?? "#4589FF"} /></div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: badgeColor,
                      background: `${badgeColor}18`, padding: "2px 6px", borderRadius: 4,
                    }}>
                      r = {r >= 0 ? "+" : ""}{r.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>
                      {strong ? "strong" : mid ? "moderate" : "weak"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
