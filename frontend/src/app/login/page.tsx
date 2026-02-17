"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { getRoles, roleLabelFromRole, type RoleCode } from "@/lib/roles";

export default function LoginPage() {
  const router = useRouter();

  // ✅ logo
  const [logoUrl, setLogoUrl] = useState<string>("");

  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  const [cedula, setCedula] = useState("");
  const [password, setPassword] = useState("");

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
      const roles = getRoles(info); // RoleCode[]

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

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 50% 0%, rgba(14,165,233,.18), transparent 70%)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      {/* ✅ HEADER */}
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          background: "rgba(255,255,255,.55)",
          borderBottom: "1px solid rgba(2,132,199,.15)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          zIndex: 50,
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="La Promesa"
            style={{ height: 44, width: "auto", objectFit: "contain" }}
          />
        ) : null}

        <div style={{ display: "grid", lineHeight: 1.1 }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: "rgba(15,23,42,.9)" }}>
            JILIU · La Promesa
          </div>
          <div style={{ fontSize: 12, color: "rgba(15,23,42,.55)", fontWeight: 700 }}>
            Portal de notas y asignaciones
          </div>
        </div>
      </header>

      {/* ✅ LOGIN CARD (se baja para no chocar con el header) */}
      <div
        className="container"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center", paddingTop: 72 }}
      >
        <div className="card" style={{ width: 420 }}>
          <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
            Iniciar sesión
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
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

            <div>
              <div className="label">Contraseña</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña"
                autoComplete="current-password"
              />
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
    </div>
  );
}
