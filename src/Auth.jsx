import React, { useState } from "react";
import { supabase } from "./supabaseClient";

const C = {
  cream: "#F6F1E4",
  paper: "#FBF8F0",
  ink: "#211E18",
  inkSoft: "#5A5548",
  pitch: "#1C4B3B",
  pitchDark: "#0F3126",
  ball: "#B23A2E",
  gold: "#B8892B",
  line: "#DCD2B8",
};

export default function Auth() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'error' | 'info', text }

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!email.trim() || !password) {
      setMessage({ type: "error", text: "Enter an email and password." });
      return;
    }
    if (mode === "signup") {
      const requiredCode = import.meta.env.VITE_INVITE_CODE;
      if (requiredCode && inviteCode.trim() !== requiredCode) {
        setMessage({ type: "error", text: "That invite code isn't right. Ask whoever set up the app for it." });
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setMessage({ type: "error", text: error.message });
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) {
          setMessage({ type: "error", text: error.message });
        } else if (data.session) {
          // Email confirmation is off in the Supabase project -> signed in immediately
        } else {
          setMessage({ type: "info", text: "Account created. Check your email to confirm, then sign in." });
          setMode("signin");
        }
      }
    } finally {
      setLoading(false);
    }
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
          <div className="f-display text-lg mb-4" style={{ color: C.ink }}>{mode === "signin" ? "Sign in" : "Create an account"}</div>

          <label className="f-ui block text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: C.inkSoft }}>Email</label>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none mb-3"
            style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.ink }}
          />

          <label className="f-ui block text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: C.inkSoft }}>Password</label>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none mb-4"
            style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.ink }}
          />

          {mode === "signup" && (
            <>
              <label className="f-ui block text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: C.inkSoft }}>Invite code</label>
              <input
                type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Ask your group for this"
                className="f-ui w-full px-3 py-2.5 rounded-md text-sm outline-none mb-4"
                style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.ink }}
              />
            </>
          )}

          {message && (
            <div className="f-ui text-xs mb-4 px-3 py-2 rounded-md"
              style={{ background: message.type === "error" ? C.ball + "22" : C.gold + "22", color: C.inkSoft }}>
              {message.text}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full f-ui text-sm font-semibold py-2.5 rounded-md disabled:opacity-50"
            style={{ background: C.pitch, color: "#fff" }}>
            {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Sign Up"}
          </button>

          <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(null); }}
            className="w-full f-ui text-xs mt-4 text-center" style={{ color: C.inkSoft }}>
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
