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
export default function NamePrompt({ onSubmit }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

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
        </form>
      </div>
    </div>
  );
}
