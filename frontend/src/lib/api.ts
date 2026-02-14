import { supabase } from "@/lib/supabaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export async function apiFetch(path: string, init: RequestInit = {}) {
  // 1) obtener token actual de supabase
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");

  if (token) headers.set("Authorization", `Bearer ${token}`);

  console.log("[apiFetch]", path, "token?", token ? "YES" : "NO");
  if (token) console.log("[apiFetch] token head:", token.slice(0, 20));

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  // intenta parsear json
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}
