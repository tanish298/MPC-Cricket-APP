import React, { useState } from "react";

const C = {
  cream: "#F6F1E4",
  paper: "#FBF8F0",
  ink: "#211E18",
  inkSoft: "#5A5548",
  pitch: "#1C4B3B",
  gold: "#B8892B",
  line: "#DCD2B8",
};

// Shown once per device, the first time someone opens the app link. It's
// purely a friendly label -- not a login, not a password, and it carries no
// access of its own. It just lets Admin see who's currently on the app.
export default function NamePrompt({ onSubmit, onAdminCode }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState(null);

  const submitCode = async (e) => {
    e.preventDefault();
    if (!code.trim() || saving) return;
    setSaving(true);
    setCodeMsg(null);
    const result = await onAdminCode(code);
    setSaving(false);
    if (result === "wrong") setCodeMsg("That code isn't right.");
    else if (result === "locked") setCodeMsg("Too many wrong tries. Please wait 15 minutes and try again.");
    else if (result !== "ok") setCodeMsg("Couldn't check the code. Please try again.");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    await onSubmit(name);
    setSaving(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-5" style={{ background: C.cream }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700&family=Inter:wght@400;500;600&display=swap');
        .f-display { font-family: 'Fraunces', serif; }
        .f-ui { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="f-ui text-xs uppercase tracking-[0.2em] mb-1" style={{ color: C.inkSoft }}>Scorer's Ledger</div>
          <div className="f-display text-4xl" style={{ color: C.pitch }}>MPC Cricket App</div>
        </div>

        {adminMode ? (
        <form onSubmit={submitCode} className="rounded-2xl p-6" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <div className="f-display text-lg mb-1" style={{ color: C.ink }}>Admin login</div>
          <div className="f-ui text-xs mb-4" style={{ color: C.inkSoft }}>Enter your special access code.</div>
          <input
            type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off"
            placeholder="Access code"
            className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none mb-3"
            style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.ink }}
          />
          {codeMsg && <div className="f-ui text-xs mb-3 px-3 py-2 rounded-md" style={{ background: "#B23A2E22", color: C.inkSoft }}>{codeMsg}</div>}
          <button type="submit" disabled={!code.trim() || saving}
            className="w-full f-ui text-sm font-semibold py-2.5 rounded-md disabled:opacity-50"
            style={{ background: C.pitch, color: "#fff" }}>
            {saving ? "Checking…" : "Log in as Admin"}
          </button>
          <button type="button" onClick={() => { setAdminMode(false); setCodeMsg(null); setCode(""); }}
            className="w-full f-ui text-xs mt-4 text-center" style={{ color: C.inkSoft }}>
            ← Back
          </button>
        </form>
        ) : (
        <form onSubmit={submit} className="rounded-2xl p-6" style={{ background: C.paper, border: `1.5px solid ${C.line}` }}>
          <div className="f-display text-lg mb-1" style={{ color: C.ink }}>What's your name?</div>
          <div className="f-ui text-xs mb-4" style={{ color: C.inkSoft }}>
            Just so people know who's watching -- no password needed, and you can watch every match without signing in.
          </div>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="Your name"
            className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none mb-4"
            style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.ink }}
          />
          <button type="submit" disabled={!name.trim() || saving}
            className="w-full f-ui text-sm font-semibold py-2.5 rounded-md disabled:opacity-50"
            style={{ background: C.pitch, color: "#fff" }}>
            {saving ? "Please wait…" : "Continue"}
          </button>
          {onAdminCode && (
            <button type="button" onClick={() => setAdminMode(true)}
              className="w-full f-ui text-xs mt-4 text-center" style={{ color: C.inkSoft }}>
              Admin login
            </button>
          )}
        </form>
        )}
      </div>
    </div>
  );
}
