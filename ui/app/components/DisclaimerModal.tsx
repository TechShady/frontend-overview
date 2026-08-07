import React, { useState, useEffect } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";
import appConfig from "../../../app.config.json";

const DISCLAIMER_STATE_KEY = `fo-disclaimer-${appConfig.app.version}`;

const AMBER = "#F59E0B";
const AMBER_DARK = "#D97706";
const AMBER_GLOW = "rgba(245, 158, 11, 0.15)";
const AMBER_BORDER = "rgba(245, 158, 11, 0.4)";

function WarningIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.27 4.5L1.5 28.5A3 3 0 0 0 4.23 33H31.77a3 3 0 0 0 2.73-4.5L20.73 4.5a3 3 0 0 0-5.46 0Z"
        fill={AMBER_GLOW}
        stroke={AMBER}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="18" y1="13.5" x2="18" y2="22.5" stroke={AMBER} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="18" cy="27" r="1.5" fill={AMBER} />
    </svg>
  );
}

export function DisclaimerModal() {
  const savedState = useUserAppState({ key: DISCLAIMER_STATE_KEY });
  const { execute: saveState } = useSetUserAppState();
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const [checkHover, setCheckHover] = useState(false);

  useEffect(() => {
    if (savedState.isLoading) return;
    if (savedState.data?.value === "accepted") return;
    setVisible(true);
  }, [savedState.isLoading, savedState.data?.value]);

  const handleContinue = () => {
    if (dontShow) {
      saveState({ key: DISCLAIMER_STATE_KEY, body: { value: "accepted" } });
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.88)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        animation: "fo-disclaimer-fadein 0.25s ease",
      }}
    >
      <style>{`
        @keyframes fo-disclaimer-fadein { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fo-disclaimer-slidein { from { opacity: 0; transform: translateY(-16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>

      <div
        style={{
          background: "linear-gradient(160deg, #111520 0%, #0D1018 100%)",
          border: `1px solid ${AMBER_BORDER}`,
          borderTop: `3px solid ${AMBER}`,
          borderRadius: "12px",
          maxWidth: "560px",
          width: "100%",
          boxShadow: `0 0 60px rgba(0,0,0,0.8), 0 0 30px ${AMBER_GLOW}, inset 0 1px 0 rgba(245,158,11,0.08)`,
          animation: "fo-disclaimer-slidein 0.3s cubic-bezier(0.34, 1.2, 0.64, 1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)",
            borderBottom: `1px solid rgba(245,158,11,0.2)`,
            padding: "28px 32px 24px",
            display: "flex",
            alignItems: "flex-start",
            gap: "16px",
          }}
        >
          <div style={{ flexShrink: 0, marginTop: "2px" }}><WarningIcon /></div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: AMBER, marginBottom: "6px" }}>
              Important Notice
            </div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#FFFFFF", lineHeight: 1.25 }}>
              Unofficial Community Application
            </h2>
          </div>
        </div>

        <div style={{ padding: "28px 32px" }}>
          <p style={{ margin: "0 0 20px", fontSize: "14.5px", lineHeight: 1.7, color: "rgba(255,255,255,0.85)" }}>
            This is <strong style={{ color: "#FFFFFF" }}>not an official Dynatrace application</strong> and it is not something you can open a support ticket on.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: "14.5px", lineHeight: 1.7, color: "rgba(255,255,255,0.85)" }}>
            You may create an issue on the GitHub repository:
          </p>
          <a
            href="https://github.com/TechShady/frontend-overview"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13.5px", fontWeight: 600, color: AMBER, textDecoration: "none", background: "rgba(245,158,11,0.08)", border: `1px solid rgba(245,158,11,0.25)`, borderRadius: "6px", padding: "8px 14px", marginBottom: "20px" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
            github.com/TechShady/frontend-overview
          </a>
          <p style={{ margin: "0 0 28px", fontSize: "14.5px", lineHeight: 1.7, color: "rgba(255,255,255,0.85)" }}>
            Feel free to fork the repository for your own use as well.
          </p>

          <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", marginBottom: "24px" }} />

          <div
            style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", marginBottom: "24px", userSelect: "none" }}
            onClick={() => setDontShow((v) => !v)}
            onMouseEnter={() => setCheckHover(true)}
            onMouseLeave={() => setCheckHover(false)}
          >
            <div
              style={{
                width: "20px", height: "20px", flexShrink: 0,
                border: `2px solid ${dontShow ? AMBER : checkHover ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.3)"}`,
                borderRadius: "5px",
                background: dontShow ? AMBER_GLOW : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "border-color 0.15s, background 0.15s",
                boxShadow: dontShow ? `0 0 8px ${AMBER_GLOW}` : "none",
              }}
            >
              {dontShow && (
                <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                  <path d="M1 4L4.5 7.5L11 1" stroke={AMBER} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: "14px", color: checkHover || dontShow ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)", transition: "color 0.15s" }}>
              Don't show this again
            </span>
          </div>

          <button
            onClick={handleContinue}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              width: "100%", padding: "13px 24px",
              background: btnHover
                ? `linear-gradient(135deg, ${AMBER} 0%, #E8920A 100%)`
                : `linear-gradient(135deg, ${AMBER_DARK} 0%, #B45309 100%)`,
              border: `1px solid ${btnHover ? AMBER : AMBER_DARK}`,
              borderRadius: "8px",
              color: "#0D1018",
              fontSize: "15px", fontWeight: 700, cursor: "pointer",
              letterSpacing: "0.03em",
              boxShadow: btnHover ? `0 4px 16px ${AMBER_GLOW}` : "0 2px 6px rgba(0,0,0,0.3)",
              transition: "all 0.15s ease",
            }}
          >
            I Understand — Continue
          </button>
        </div>
      </div>
    </div>
  );
}
