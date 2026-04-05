import { supabase } from "@/lib/supabaseClient";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");

type ApiFetchOptions = RequestInit & {
  skipAuthRedirect?: boolean;
  requireAuth?: boolean;
};

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

async function getFreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data?.session ?? null;
  if (!session) return null;

  const expiresAt = session.expires_at ?? 0;
  const now = Math.floor(Date.now() / 1000);

  if (expiresAt && expiresAt - now <= 60) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) return null;
    return refreshed.session?.access_token ?? null;
  }

  return session.access_token ?? null;
}

async function refreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function signOutAndRedirect(skipAuthRedirect?: boolean) {
  try {
    await supabase.auth.signOut();
  } catch {}
  if (!skipAuthRedirect) redirectToLogin();
}

function buildHeaders(
  initHeaders: HeadersInit | undefined,
  body: RequestInit["body"],
  token?: string | null
) {
  const headers = new Headers(initHeaders || {});
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function parseResponse(res: Response) {
  const text = await res.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { text, json };
}

export async function apiFetch<T = any>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const {
    skipAuthRedirect = false,
    requireAuth = true,
    ...requestInit
  } = init;

  const url = `${API_BASE}${path}`;

  let token: string | null = null;

  if (requireAuth) {
    token = await getFreshAccessToken();

    if (!token) {
      await signOutAndRedirect(skipAuthRedirect);
      throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    }
  }

  const doRequest = async (bearer?: string | null) => {
    const headers = buildHeaders(requestInit.headers, requestInit.body, bearer);
    return fetch(url, {
      ...requestInit,
      headers,
    });
  };

  let res: Response;

  try {
    res = await doRequest(token);
  } catch (e: any) {
    throw new Error(e?.message || "No se pudo conectar con el servidor");
  }

  if (requireAuth && res.status === 401) {
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      token = refreshed;
      try {
        res = await doRequest(token);
      } catch (e: any) {
        throw new Error(e?.message || "No se pudo conectar con el servidor");
      }
    }
  }

  const { text, json } = await parseResponse(res);

  if (requireAuth && res.status === 401) {
    await signOutAndRedirect(skipAuthRedirect);
    throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  }

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (json === null) {
    throw new Error(`Respuesta OK pero no es JSON. Body head: ${text.slice(0, 120)}`);
  }

  return json as T;
}