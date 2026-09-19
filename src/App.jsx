import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import NamePrompt from "./NamePrompt";
import CricketApp from "./CricketApp";

const DEVICE_NAME_KEY = "mpc_viewer_name";

function isSessionAnonymous(session) {
  return !!(session?.user?.is_anonymous ?? (session?.user?.app_metadata?.provider === "anonymous"));
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [role, setRole] = useState(null); // 'admin' | 'scorer' | 'viewer' | null (still loading)
  const [linkedPlayerName, setLinkedPlayerName] = useState(undefined); // undefined = loading, null = not set, string = set
  const [displayName, setDisplayName] = useState(null); // anonymous viewer's typed name
  const [needsName, setNeedsName] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [anonError, setAnonError] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true); // true while an automatic anonymous sign-in may be in flight

  const isAnonymous = isSessionAnonymous(session);

  // Get whatever session already exists, and keep listening for changes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Anyone who opens the app with no session at all (and isn't mid-login)
  // is signed in anonymously right away, so viewing never requires an
  // account or a password. This needs "Allow anonymous sign-ins" turned on
  // in the Supabase project (Authentication -> Settings).
  useEffect(() => {
    if (session === undefined) return;
    if (session === null && !showLogin) {
      supabase.auth.signInAnonymously().then(({ error }) => {
        if (error) setAnonError(error.message);
        setBootstrapping(false);
      });
    } else {
      setBootstrapping(false);
    }
  }, [session, showLogin]);

  // Once a real (non-anonymous) session is active, the login screen -- if
  // it was showing -- is no longer needed.
  useEffect(() => {
    if (session && !isSessionAnonymous(session)) setShowLogin(false);
  }, [session]);

  useEffect(() => {
    if (!session) { setRole(null); setLinkedPlayerName(undefined); setDisplayName(null); setNeedsName(false); return; }
    let cancelled = false;
    const anon = isSessionAnonymous(session);

    if (!anon) {
      // Register this user in the public "who has signed up" list (harmless
      // if it already exists; never overwrites an existing player_name since
      // that column isn't included in this upsert payload).
      supabase.from("profiles").upsert(
        { id: session.user.id, email: session.user.email },
        { onConflict: "id" }
      ).then(() => {});
    }

    (async () => {
      try {
        const profilePromise = supabase.from("profiles").select("player_name").eq("id", session.user.id).maybeSingle();
        if (anon) {
          const [{ data: deviceData, error: devErr }, { data: profileData }] = await Promise.all([
            supabase.from("device_roles").select("role, display_name").eq("id", session.user.id).maybeSingle(),
            profilePromise,
          ]);
          if (cancelled) return;
          setLinkedPlayerName(profileData ? (profileData.player_name || null) : null);
          const savedName = localStorage.getItem(DEVICE_NAME_KEY);
          if (!devErr && deviceData) {
            setRole(deviceData.role || "viewer");
            if (deviceData.display_name) {
              setDisplayName(deviceData.display_name);
            } else if (savedName) {
              setDisplayName(savedName);
              supabase.from("device_roles").update({ display_name: savedName }).eq("id", session.user.id).then(() => {});
            } else {
              setNeedsName(true);
            }
          } else {
            // First time this device has ever been seen.
            setRole("viewer");
            if (savedName) {
              setDisplayName(savedName);
              await supabase.from("device_roles").insert({ id: session.user.id, display_name: savedName });
            } else {
              setNeedsName(true);
            }
          }
        } else {
          const [{ data: roleData, error: roleErr }, { data: profileData, error: profileErr }] = await Promise.all([
            supabase.from("app_roles").select("role").eq("email", session.user.email).maybeSingle(),
            profilePromise,
          ]);
          if (cancelled) return;
          setRole(!roleErr && roleData ? roleData.role : "viewer");
          setLinkedPlayerName(!profileErr && profileData ? (profileData.player_name || null) : null);
        }
      } catch (e) {
        if (!cancelled) { setRole("viewer"); setLinkedPlayerName(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // Anonymous devices: keep a "last seen" heartbeat so Admin's "Who's Here"
  // list is current, and pick up a Scorer promotion made from another
  // device without needing to reload.
  useEffect(() => {
    if (!session || !isAnonymous || !displayName) return;
    let cancelled = false;
    const beat = async () => {
      const { data } = await supabase
        .from("device_roles")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", session.user.id)
        .select("role")
        .maybeSingle();
      if (!cancelled && data) setRole(data.role || "viewer");
    };
    beat();
    const t = setInterval(beat, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [session, isAnonymous, displayName]);

  const updateLinkedPlayerName = async (name) => {
    if (!session) return;
    const { error } = await supabase.from("profiles").update({ player_name: name }).eq("id", session.user.id);
    if (!error) setLinkedPlayerName(name);
  };

  const submitViewerName = async (name) => {
    const trimmed = name.trim();
    if (!trimmed || !session) return;
    localStorage.setItem(DEVICE_NAME_KEY, trimmed);
    const { error } = await supabase.from("device_roles").upsert(
      { id: session.user.id, display_name: trimmed },
      { onConflict: "id" }
    );
    if (!error) {
      setDisplayName(trimmed);
      setNeedsName(false);
      setRole((r) => r || "viewer");
    }
  };

  if (session === undefined || (session === null && bootstrapping && !showLogin)) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#F6F1E4" }}>
        <div style={{ color: "#1C4B3B", fontFamily: "serif" }}>Loading…</div>
      </div>
    );
  }

  // showLogin lets a viewer step up to a real Scorer/Admin account; Admin's
  // own login is otherwise completely unchanged from before.
  if (showLogin && (session === null || isAnonymous)) {
    return <Auth onCancel={session ? () => setShowLogin(false) : null} />;
  }

  if (session === null) {
    // Anonymous sign-in isn't enabled on this Supabase project yet -- fall
    // back to requiring a real login, same as the app behaved before.
    return <Auth errorHint={anonError ? "Open viewing needs \"Allow anonymous sign-ins\" turned on in Supabase (Authentication → Settings)." : null} />;
  }

  if (isAnonymous && needsName) {
    return <NamePrompt onSubmit={submitViewerName} />;
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
      onLogout={isAnonymous ? null : () => supabase.auth.signOut()}
      userEmail={isAnonymous ? null : session.user?.email}
      role={role}
      supabaseClient={supabase}
      linkedPlayerName={linkedPlayerName}
      setLinkedPlayerName={updateLinkedPlayerName}
      isAnonymous={isAnonymous}
      viewerName={displayName}
      onRequestLogin={() => setShowLogin(true)}
    />
  );
}
