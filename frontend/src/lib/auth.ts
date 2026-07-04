// Reemplaza la gestión de sesión de supabase-js: el JWT propio (emitido por
// POST /api/auth/login) se guarda en sessionStorage (aislado por pestaña, igual
// que hacía el adapter de supabase-js) y se decodifica en el cliente solo para
// leer el email y la expiración — la verificación real de la firma la hace el backend.

const TOKEN_KEY = "jiliu_token";

type TokenPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(normalized)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getSession(): { token: string; email: string } | null {
  const token = getToken();
  if (!token) return null;

  const decoded = decodeToken(token);
  if (!decoded?.exp || decoded.exp * 1000 <= Date.now()) {
    clearToken();
    return null;
  }

  return { token, email: decoded.email };
}

export function signOut(): void {
  clearToken();
}
