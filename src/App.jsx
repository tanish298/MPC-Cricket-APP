import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import CricketApp from "./CricketApp";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [role, setRole] = useState(null); // 'admin' | 'scorer' | 'viewer' | null (still loading)
  const [linkedPlayerName, setLinkedPlayerName] = useState(undefined); // undefined = loading, null = not set, string = set

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRole(null); setLinkedPlayerName(undefined); return; }
    let cancelled = false;

    // Register this user in the public "who has signed up" list (harmless
    // if it already exists; never overwrites an existing player_name since
    // that column isn't included in this upsert payload).
    supabase.from("profiles").upsert(
      { id: session.user.id, email: session.user.email },
      { onConflict: "id" }
    ).then(() => {});

    (async () => {
      try {
        const [{ data: roleData, error: roleErr }, { data: profileData, error: profileErr }] = await Promise.all([
          supabase.from("app_roles").select("role").eq("email", session.user.email).maybeSingle(),
          supabase.from("profiles").select("player_name").eq("id", session.user.id).maybeSingle(),
        ]);
        if (cancelled) return;
        setRole(!roleErr && roleData ? roleData.role : "viewer");
        setLinkedPlayerName(!profileErr && profileData ? (profileData.player_name || null) : null);
      } catch (e) {
        if (!cancelled) { setRole("viewer"); setLinkedPlayerName(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const updateLinkedPlayerName = async (name) => {
    if (!session) return;
    const { error } = await supabase.from("profiles").update({ player_name: name }).eq("id", session.user.id);
    if (!error) setLinkedPlayerName(name);
  };

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

  if (role === null || linkedPlayerName === undefined) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#F6F1E4" }}>
        <div style={{ color: "#1C4B3B", fontFamily: "serif" }}>Loading…</div>
      </div>
    );
  }

  return (
    <CricketApp
      onLogout={() => supabase.auth.signOut()}
      userEmail={session.user?.email}
      role={role}
      supabaseClient={supabase}
      linkedPlayerName={linkedPlayerName}
      setLinkedPlayerName={updateLinkedPlayerName}
    />
  );
}
