import React, { useState, useEffect } from "react";
import { useUserAppState, useSetUserAppState } from "@dynatrace-sdk/react-hooks";

export interface PersonaDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  tabSummary: string;
}

interface PersonaPickerModalProps {
  appName: string;
  appVersion: string;
  appDesc: string;
  repoUrl: string;
  whatsNew: string[];
  statePrefix: string;
  personas: PersonaDef[];
  defaultPersonaId?: string;
  onApply: (personaId: string) => void;
}

export function PersonaPickerModal({
  appName, appVersion, appDesc, repoUrl, whatsNew, statePrefix, personas, defaultPersonaId = "all", onApply,
}: PersonaPickerModalProps) {
  const versionKey  = `${statePrefix}-persona-v${appVersion}`;
  const everKey     = `${statePrefix}-persona-ever`;

  const versionState = useUserAppState({ key: versionKey });
  const everState    = useUserAppState({ key: everKey });
  const { execute: saveState } = useSetUserAppState();

  const [visible, setVisible]         = useState(false);
  const [isNewUser, setIsNewUser]     = useState(true);
  const [selectedId, setSelectedId]   = useState(defaultPersonaId);
  const [hoverBtn, setHoverBtn]       = useState(false);

  useEffect(() => {
    if (versionState.isLoading || everState.isLoading) return;
    if (versionState.data?.value === "seen") return;
    const prevPersona = everState.data?.value as string | undefined;
    setIsNewUser(!prevPersona);
    if (prevPersona) setSelectedId(prevPersona);
    else setSelectedId(defaultPersonaId);
    setVisible(true);
  }, [versionState.isLoading, versionState.data?.value, everState.isLoading, everState.data?.value, defaultPersonaId]);

  const handleContinue = () => {
    saveState({ key: versionKey, body: { value: "seen" } });
    saveState({ key: everKey, body: { value: selectedId } });
    onApply(selectedId);
    setVisible(false);
  };

  if (!visible) return null;

  const selected = personas.find(p => p.id === selectedId) ?? personas[0];

  const BLUE = "#4589FF";
  const BG   = "rgba(10,14,28,0.98)";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99998,
      background: "rgba(0,0,0,0.92)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <style>{`
        @keyframes ppmodal-in { from { opacity:0; transform:translateY(-20px) scale(0.97); } to { opacity:1; transform:none; } }
      `}</style>
      <div style={{
        background: BG, border: "1px solid rgba(69,137,255,0.3)",
        borderTop: "3px solid #4589FF", borderRadius: 14, width: "100%", maxWidth: 780,
        boxShadow: "0 24px 80px rgba(0,0,0,0.85), 0 0 40px rgba(69,137,255,0.08)",
        animation: "ppmodal-in 0.3s cubic-bezier(0.34,1.2,0.64,1)",
        overflow: "hidden", fontFamily: '"Inter",system-ui,sans-serif',
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,rgba(69,137,255,0.1) 0%,rgba(69,137,255,0.03) 100%)",
          borderBottom: "1px solid rgba(69,137,255,0.18)", padding: "28px 32px 22px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: BLUE, marginBottom: 6 }}>
            {isNewUser ? "Welcome" : `What's New in v${appVersion}`}
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            {isNewUser ? appName : `${appName} — v${appVersion}`}
          </h2>
          <p style={{ margin: 0, fontSize: 13.5, color: "rgba(255,255,255,0.68)", lineHeight: 1.6 }}>
            {isNewUser ? appDesc : ""}
          </p>
          {!isNewUser && whatsNew.length > 0 && (
            <ul style={{ margin: "10px 0 0", padding: "0 0 0 0", listStyle: "none" }}>
              {whatsNew.map((item, i) => (
                <li key={i} style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ color: BLUE, flexShrink: 0 }}>✦</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "24px 32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Left: persona grid */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
              Select Your Role
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {personas.map(p => {
                const active = selectedId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "flex-start",
                      padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                      background: active ? "rgba(69,137,255,0.18)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? "rgba(69,137,255,0.6)" : "rgba(255,255,255,0.1)"}`,
                      color: "#fff", textAlign: "left", transition: "all 0.15s",
                      boxShadow: active ? "0 0 12px rgba(69,137,255,0.15)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 22, marginBottom: 4 }}>{p.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? "#7ab4ff" : "rgba(255,255,255,0.9)" }}>{p.label}</span>
                    <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", marginTop: 2, lineHeight: 1.4 }}>{p.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: tab preview + continue */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
                Tabs Enabled for {selected.label}
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", lineHeight: 1.6, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 14px", border: "1px solid rgba(255,255,255,0.08)" }}>
                {selected.tabSummary}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
                You can always add or remove tabs later in <strong style={{ color: "rgba(255,255,255,0.55)" }}>Settings → Tab Visibility</strong>.
                {isNewUser && (
                  <span> Choosing <strong style={{ color: "rgba(255,255,255,0.55)" }}>All</strong> shows every tab.</span>
                )}
              </div>
            </div>

            <div style={{ marginTop: "auto" }}>
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 16 }} />
              <button
                onClick={handleContinue}
                onMouseEnter={() => setHoverBtn(true)}
                onMouseLeave={() => setHoverBtn(false)}
                style={{
                  width: "100%", padding: "13px 24px",
                  background: hoverBtn
                    ? "linear-gradient(135deg,#5599ff 0%,#2d6ef5 100%)"
                    : "linear-gradient(135deg,#4589FF 0%,#1e5de0 100%)",
                  border: `1px solid ${hoverBtn ? "#6aabff" : "#4589FF"}`,
                  borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
                  letterSpacing: "0.02em",
                  boxShadow: hoverBtn ? "0 4px 20px rgba(69,137,255,0.4)" : "0 2px 8px rgba(0,0,0,0.4)",
                  transition: "all 0.15s ease",
                }}
              >
                Continue as {selected.label} →
              </button>
              <div style={{ marginTop: 10, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.28)" }}>
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.35)", textDecoration: "none" }}>
                  Unofficial community app — not supported by Dynatrace
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
