import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import CricketApp from "./CricketApp";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#F6F1E4" }}>
        <div style={{ color: "#1C4B3B", fontFamily: "serif" }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return <CricketApp onLogout={() => supabase.auth.signOut()} userEmail={session.user?.email} />;
}
