"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

// El link del correo trae el token de un solo uso como query param (?token=...).
function readTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

export default function UpdatePasswordPage() {
  const router = useRouter();

  const [token] = useState<string | null>(readTokenFromUrl);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(() =>
    readTokenFromUrl() ? null : "El link no es válido o expiró. Solicita el correo nuevamente."
  );
  const [ok, setOk] = useState(false);
  const logoUrl = "/logo.png";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const p = password.trim();
    if (p.length < 6) {
      setMsg("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (!token) {
      setMsg("El link no es válido o expiró. Solicita el correo nuevamente.");
      return;
    }

    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password: p }),
        requireAuth: false,
        skipAuthRedirect: true,
      });

      setOk(true);
      setMsg("✅ Contraseña actualizada. Ahora inicia sesión.");
      setTimeout(() => router.replace("/login"), 900);
    } catch (e) {
      setMsg((e as { message?: string })?.message || "No se pudo actualizar la contraseña.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: 20 }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 80 }}>
        <Header logoUrl={logoUrl} />
      </div>

      <div className="container" style={{ minHeight: "100vh", display: "grid", placeItems: "center", paddingTop: 82 }}>
        <div className="card" style={{ width: 420 }}>
          <h1 style={{ margin: "6px 0 6px", fontSize: 26, letterSpacing: "-0.02em" }}>
            Cambiar contraseña
          </h1>

          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            Escribe tu nueva contraseña.
          </p>

          {msg && (
            <div className={ok ? "msgOk" : "msgError"} style={{ marginTop: 10 }}>
              {msg}
            </div>
          )}

          <form onSubmit={handleSave} style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div>
              <div className="label">Nueva contraseña</div>

              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu nueva contraseña"
                  autoComplete="new-password"
                  style={{ paddingRight: 46 }}
                />

                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="btnLight"
                  style={{
                    position: "absolute",
                    right: 6,
                    top: 6,
                    height: 38,
                    width: 38,
                    borderRadius: 12,
                    padding: 0,
                    display: "grid",
                    placeItems: "center",
                  }}
                  aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {show ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <button className="btn" type="submit" style={{ width: "100%" }}>
              Guardar contraseña
            </button>
          </form>
        </div>
      </div>

      <Footer rightText="Hecho para la Iglesia La Promesa." />
    </div>
  );
}
