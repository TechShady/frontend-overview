import React from "react";

// ---------------------------------------------------------------------------
// GradeBadge — Letter grade A–F with color.
// gradeFromScore takes a 0–100 score.
// ---------------------------------------------------------------------------
export function gradeFromScore(score: number): { letter: string; color: string } {
  if (!isFinite(score)) return { letter: "—", color: "rgba(128,128,128,0.7)" };
  if (score >= 93) return { letter: "A", color: "#0D9C29" };
  if (score >= 85) return { letter: "A-", color: "#0D9C29" };
  if (score >= 78) return { letter: "B+", color: "#4DAA00" };
  if (score >= 72) return { letter: "B", color: "#7CB342" };
  if (score >= 66) return { letter: "B-", color: "#9CCC65" };
  if (score >= 60) return { letter: "C+", color: "#FBC02D" };
  if (score >= 54) return { letter: "C", color: "#F9A825" };
  if (score >= 48) return { letter: "C-", color: "#F57F17" };
  if (score >= 40) return { letter: "D", color: "#FB8C00" };
  if (score >= 30) return { letter: "D-", color: "#EF6C00" };
  return { letter: "F", color: "#C21930" };
}

export const GradeBadge: React.FC<{ score: number; size?: number; label?: string }> = ({ score, size = 56, label }) => {
  const { letter, color } = gradeFromScore(score);
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `${color}18`,
          border: `2px solid ${color}`,
          color: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.max(14, size * 0.42),
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        {letter}
      </div>
      {label && <div style={{ fontSize: 10, opacity: 0.7, textAlign: "center" }}>{label}</div>}
    </div>
  );
};

// Inline pill version — great for table cells.
export const GradePill: React.FC<{ score: number; showScore?: boolean }> = ({ score, showScore }) => {
  const { letter, color } = gradeFromScore(score);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 12,
        background: `${color}18`,
        border: `1px solid ${color}55`,
        color: color,
        fontSize: 12,
        fontWeight: 700,
        minWidth: 44,
        justifyContent: "center",
      }}
    >
      {letter}
      {showScore && isFinite(score) && <span style={{ opacity: 0.75, fontWeight: 600 }}>{score.toFixed(0)}</span>}
    </span>
  );
};
