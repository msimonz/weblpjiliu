"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();

  const [cedula, setCedula] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // después de login exitoso:
      const info = await apiFetch("/api/auth/me"); // ya lo tienes en tu proyecto
      const role = info?.role;

      if (role === "A") router.replace("/admin");
      else if (role === "T") router.replace("/teacher");
      else router.replace("/dashboard"); // student
    } catch (err: any) {
      setError(err?.message || "No fue posible iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: 420 }}>
        <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
          Iniciar sesión
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Ingresa con tu cédula y contraseña.
        </p>

        {error && <div className="msgError">{error}</div>}

        <form onSubmit={handleLogin} style={{ marginTop: 14, display: "grid", gap: 12 }}>
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

        {/* ✅ Quitamos “Crear cuenta” */}
        <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
          Si no tienes acceso o olvidaste tu contraseña, contacta al administrador.
        </div>
      </div>
    </div>
  );
}
