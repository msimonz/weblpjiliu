"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { getRoles, roleLabelFromRole, type RoleCode } from "@/lib/roles";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function LoginPage() {
  const router = useRouter();

  // logo desde Supabase Storage (para <Header mode="simple" />)
  const [logoUrl, setLogoUrl] = useState<string>("");

  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  const [cedula, setCedula] = useState("");
  const [password, setPassword] = useState("");

  // ✅ mostrar/ocultar contraseña
  const [showPw, setShowPw] = useState(false);

  // ✅ rol elegido
  const [rolePick, setRolePick] = useState<RoleCode>("S");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleToRoute = (role: RoleCode) => {
    if (role === "A") return "/admin";
    if (role === "T") return "/teacher";
    return "/dashboard";
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const c = cedula.trim();
    if (!c) return setError("Ingresa tu cédula");
    if (!password) return setError("Ingresa tu contraseña");

    setLoading(true);
    try {
      // 1) resolver cédula -> email real
      const resolved = await apiFetch("/api/auth/resolve-login", {
        method: "POST",
        body: JSON.stringify({ cedula: c }),
      });

      const email = resolved?.email;
      if (!email) throw new Error("No se encontró email para esa cédula");

      // 2) login en supabase con email+password
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authErr) throw new Error("Cédula o contraseña incorrectas");

      // 3) validar roles reales contra el rol seleccionado
      const info = await apiFetch("/api/auth/me");
      const roles = getRoles(info);

      if (!roles.includes(rolePick)) {
        await supabase.auth.signOut();
        throw new Error(`No tienes el rol "${roleLabelFromRole(rolePick)}" asignado.`);
      }

      // 4) guardar rol activo y redirigir
      localStorage.setItem("active_role", rolePick);
      router.replace(roleToRoute(rolePick));
    } catch (err: any) {
      setError(err?.message || "No fue posible iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  const HEADER_H = 82;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      {/* ✅ Header global (dark-ready) */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 80 }}>
        <Header mode="simple" logoUrl={logoUrl} />
      </div>

      {/* ✅ LOGIN CARD (bajado para no chocar con el header fixed) */}
      <div
        className="container"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          paddingTop: HEADER_H,
        }}
      >
        <div className="card" style={{ width: 420 }}>
          <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
            Iniciar sesión
          </h1>

          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            Ingresa con tu cédula, contraseña y el rol con el que deseas entrar.
          </p>

          {error && <div className="msgError">{error}</div>}

          <form onSubmit={handleLogin} style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div>
              <div className="label">Rol</div>
              <select
                className="select"
                value={rolePick}
                onChange={(e) => setRolePick(e.target.value as RoleCode)}
              >
                <option value="S">Student</option>
                <option value="T">Teacher</option>
                <option value="A">Admin</option>
              </select>
            </div>

            <div>
              <div className="label">Cédula</div>
              <input
                className="input"
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                placeholder="Ej: 1020304050"
                inputMode="numeric"
                autoComplete="username"
              />
            </div>

            {/* ✅ Contraseña con ojito */}
            <div>
              <div className="label">Contraseña</div>

              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  style={{ paddingRight: 52 }}
                />

                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
                  title={showPw ? "Ocultar" : "Mostrar"}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    border: "1px solid var(--btn-light-border)",
                    background: "var(--btn-light-bg)",
                    color: "var(--btn-light-text)",
                    boxShadow: "var(--btn-light-shadow)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{showPw ? "🙈" : "👁️"}</span>
                </button>
              </div>
            </div>

            <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>

          <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
            Si no tienes acceso o olvidaste tu contraseña, contacta al administrador.
          </div>
        </div>
      </div>

      <Footer rightText="Made for Iglesia La Promesa." />
    </div>
  );
}
