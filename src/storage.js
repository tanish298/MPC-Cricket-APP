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

export async function saveKey(key, value) {
  try {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) console.error("saveKey failed", key, error);
  } catch (e) {
    console.error("saveKey failed", key, e);
  }
}
