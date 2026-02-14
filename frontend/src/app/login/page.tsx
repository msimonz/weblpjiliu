"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";

type Tab = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [cedula, setCedula] = useState("");
  const [codeJiliu, setCodeJiliu] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(
    () => (tab === "login" ? "Iniciar sesión" : "Crear cuenta"),
    [tab]
  );

  async function afterAuthRedirect() {
    // Esto debe pegarle a tu backend y traer role/type desde public.users
    const me = await apiFetch("/api/auth/me");
    const role: string | null = me?.role ?? me?.profile?.type ?? null;

    if (role === "A") router.push("/admin");
    else if (role === "T") router.push("/teacher");
    else router.push("/dashboard");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      await afterAuthRedirect();
    } catch (err: any) {
      setMsg(err?.message || "Error iniciando sesión");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim();
      const cleanName = name.trim();
      const cleanCedula = cedula.trim();
      const cleanCode = codeJiliu.trim();

      if (!cleanEmail || !password || !cleanName || !cleanCedula || !cleanCode) {
        throw new Error("Completa todos los campos.");
      }

      // 1) Signup en Supabase Auth
      const { error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });
      if (signUpErr) throw signUpErr;

      // OJO:
      // Si en Supabase tienes "Confirm email" ACTIVADO,
      // este signIn puede fallar con "Email not confirmed".
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInErr) throw signInErr;

      // 2) Crear perfil negocio en tu backend (public.users)
      // id_course queda NULL => NO se manda
      await apiFetch("/api/auth/profile", {
        method: "POST",
        body: JSON.stringify({
          name: cleanName,
          cedula: cleanCedula,
          code_jiliu: cleanCode,
        }),
      });

      // 3) Redirigir según rol
      await afterAuthRedirect();
    } catch (err: any) {
      setMsg(err?.message || "Error creando cuenta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <h1>Portal de Notas</h1>
          <p>Accede con tu cuenta para ver tus calificaciones por año y materia.</p>
        </div>

        <div className="badges">
          <div className="badgeLogo">J</div>
          <div className="badgeLogo">P</div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="tabs">
            <button
              type="button"
              className={tab === "login" ? "tab tabActive" : "tab"}
              onClick={() => setTab("login")}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              className={tab === "register" ? "tab tabActive" : "tab"}
              onClick={() => setTab("register")}
            >
              Crear cuenta
            </button>
          </div>

          <h2>{title}</h2>
          <p>
            {tab === "login"
              ? "Ingresa con tu email y contraseña."
              : "Regístrate con tu email y completa tu perfil con tu cédula."}
          </p>

          {msg && <div className="msgError">{msg}</div>}

          <form
            className="form"
            onSubmit={tab === "login" ? handleLogin : handleRegister}
          >
            <div>
              <div className="label">Email</div>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tuemail@correo.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <div className="label">Contraseña</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                required
              />
            </div>

            {tab === "register" && (
              <>
                <div>
                  <div className="label">Nombre</div>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Tu nombre completo"
                    required
                  />
                </div>

                <div>
                  <div className="label">Cédula</div>
                  <input
                    className="input"
                    value={cedula}
                    onChange={(e) => setCedula(e.target.value)}
                    placeholder="1027..."
                    inputMode="numeric"
                    required
                  />
                </div>

                <div>
                  <div className="label">Código de JILIU</div>
                  <input
                    className="input"
                    value={codeJiliu}
                    onChange={(e) => setCodeJiliu(e.target.value)}
                    placeholder="123456..."
                    inputMode="numeric"
                    required
                  />
                </div>
              </>
            )}

            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Procesando..." : tab === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          <div className="footer">
            Al continuar, aceptas el uso interno de tus datos académicos para mostrar calificaciones.
          </div>
        </div>

        <div className="card">
          <p className="sideTitle">¿Qué podrás ver aquí?</p>
          <ul className="list">
            <li>
              Notas por <b>año</b> y por <b>materia</b>.
            </li>
            <li>
              Importación automática semanal desde <b>EasyTestMaker</b>.
            </li>
            <li>
              Próximamente: asignaciones y calificaciones subidas por profesores.
            </li>
          </ul>

          <div className="note">
            Si ya tienes cuenta, entra con tu email. Si no, crea una y registra tu perfil.
          </div>

          <div className="footer">© {new Date().getFullYear()} JILIU · La Promesa</div>
        </div>
      </div>
    </div>
  );
}
