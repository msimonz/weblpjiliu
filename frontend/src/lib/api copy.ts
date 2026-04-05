import { supabase } from "@/lib/supabaseClient";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

export async function apiFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url = `${API_BASE}${path}`;

  console.log("[apiFetch] URL =>", url);
  console.log("[apiFetch] token?", token ? "YES" : "NO");
  if (token) console.log("[apiFetch] token head:", token.slice(0, 20));

  const res = await fetch(url, { ...init, headers });

  const text = await res.text();

  console.log("[apiFetch] STATUS <=", res.status, res.statusText);
  console.log("[apiFetch] RAW BODY <=", text.slice(0, 500)); // solo primeros 500 chars

  // intenta parsear json
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // si no es JSON, dejamos json=null y seguimos con error si no ok
  }

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (json === null) {
    throw new Error(`Respuesta OK pero NO es JSON. Body head: ${text.slice(0, 120)}`);
  }

  return json;
}
