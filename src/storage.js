import { supabase } from "./supabaseClient";

// Same-shaped helpers as the ones the app used inside Claude's artifact
// environment, but backed by a single shared Supabase table ("kv_store")
// instead of window.storage. All logged-in users read/write the same
// rows, so the whole team sees the same teams/matches/stats.

export async function loadKey(key, fallback) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    return data.value ?? fallback;
  } catch (e) {
    console.error("loadKey failed", key, e);
    return fallback;
  }
}

// Cheap "has anything changed?" check -- fetches only the timestamp, not the
// whole (potentially large) value. Returns milliseconds, or null.
export async function loadStamp(key) {
  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data || !data.updated_at) return null;
    return new Date(data.updated_at).getTime();
  } catch (e) {
    return null;
  }
}

// Returns the saved timestamp (ms) on success, or null if the write failed
// (e.g. no permission, or no connection).
export async function saveKey(key, value) {
  try {
    const ts = Date.now();
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date(ts).toISOString() }, { onConflict: "key" });
    if (error) { console.error("saveKey failed", key, error); return null; }
    return ts;
  } catch (e) {
    console.error("saveKey failed", key, e);
    return null;
  }
}
