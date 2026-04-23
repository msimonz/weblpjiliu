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

  const [logoUrl, setLogoUrl] = useState<string>("");

  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  const [cedula, setCedula] = useState("");
  const [password, setPassword] = useState("");
  const [cedulaHint, setCedulaHint] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rolePick, setRolePick] = useState<RoleCode>("S");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recuperación de contraseña
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetEmailError, setResetEmailError] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const roleToRoute = (role: RoleCode) => {
    if (role === "A") return "/admin";
    if (role === "T") return "/teacher";
    if (role === "M") return "/monitor";
    if (role === "E") return "/secretaria";
    return "/dashboard";
  };

  async function resolveEmailByCedula(cedulaValue: string) {
    const c = cedulaValue.trim();
    if (!c) throw new Error("Ingresa tu cédula");

    const resolved = await apiFetch("/api/auth/resolve-login", {
      method: "POST",
      body: JSON.stringify({ cedula: c }),
      requireAuth: false,
      skipAuthRedirect: true,
    });

    const email = resolved?.email;
    if (!email) throw new Error("No se encontró email para esa cédula");

    return email as string;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const c = cedula.trim();
    if (!c) return setError("Ingresa tu cédula");
    if (!password) return setError("Ingresa tu contraseña");

    setLoading(true);
    try {
      const email = await resolveEmailByCedula(c);

      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authErr) throw new Error("Cédula o contraseña incorrectas");

      const info = await apiFetch("/api/auth/me");
      const roles = getRoles(info);

      if (!roles.includes(rolePick)) {
        await supabase.auth.signOut();
        throw new Error(`No tienes el rol "${roleLabelFromRole(rolePick)}" asignado.`);
      }

      sessionStorage.setItem("active_role", rolePick);
      router.replace(roleToRoute(rolePick));
    } catch (err) {
      setError((err as { message?: string })?.message || "No fue posible iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  function openForgotPasswordModal() {
    setResetEmail("");
    setResetEmailError("");
    setShowForgotModal(true);
  }

  function closeForgotPasswordModal() {
    if (sendingReset) return;
    setShowForgotModal(false);
    setResetEmailError("");
  }

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  async function handleSendResetEmail() {
    setResetEmailError("");
    setError(null);

    const email = resetEmail.trim();

    if (!email) {
      setResetEmailError("Ingresa tu correo electrónico");
      return;
    }

    if (!isValidEmail(email)) {
      setResetEmailError("Ingresa un correo electrónico válido");
      return;
    }

    setSendingReset(true);

    try {
      const redirectTo = `${window.location.origin}/update-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetErr) throw resetErr;
      setShowForgotModal(false);
    } catch (e) {
      setResetEmailError((e as { message?: string })?.message || "No fue posible enviar el correo de recuperación");
    } finally {
      setSendingReset(false);
    }
  }

  const HEADER_H = 82;

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        maxWidth: "100vw",
        overflowX: "clip",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 80,
          width: "100%",
          maxWidth: "100vw",
        }}
      >
        <Header logoUrl={logoUrl} />
      </div>

      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: "100vw",
          overflowX: "clip",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${HEADER_H}px + 12px)`,
          paddingBottom: 24,
          paddingLeft: 16,
          paddingRight: 16,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            margin: "0 auto",
            boxSizing: "border-box",
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
              padding: "18px 16px",
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            <h1
              style={{
                margin: "0 0 6px",
                fontSize: "clamp(24px, 6vw, 28px)",
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              Iniciar sesión
            </h1>

            {error && (
              <div
                className="msgError"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                }}
              >
                {error}
              </div>
            )}

            <form
              onSubmit={handleLogin}
              style={{
                marginTop: 4,
                display: "grid",
                gap: 12,
                width: "100%",
              }}
            >
              <div style={{ width: "100%" }}>
                <select
                  className="select"
                  value={rolePick}
                  onChange={(e) => setRolePick(e.target.value as RoleCode)}
                  style={{
                    width: "100%",
                    minHeight: 46,
                    boxSizing: "border-box",
                    fontSize: 16,
                  }}
                >
                  <option value="S">Estudiante</option>
                  <option value="T">Profesor</option>
                  <option value="M">Monitor</option>
                  <option value="A">Admin</option>
                  <option value="E">Secretaría</option>
                </select>
              </div>

              <div style={{ width: "100%" }}>
                <div className="label" style={{ marginBottom: 6, fontSize: 14 }}>
                  Cédula
                </div>
                <input
                  className="input"
                  type="text"
                  value={cedula}
                  onChange={(e) => {
                    const value = e.target.value;

                    if (/^\d*$/.test(value)) {
                      setCedula(value);
                      setCedulaHint("");
                    } else {
                      setCedula(value.replace(/\D/g, ""));
                      setCedulaHint("Solo puedes ingresar números en la cédula");
                    }
                  }}
                  placeholder="Ej: 1020304050"
                  inputMode="numeric"
                  autoComplete="username"
                  pattern="[0-9]*"
                  maxLength={15}
                  style={{
                    width: "100%",
                    minHeight: 46,
                    boxSizing: "border-box",
                    fontSize: 16,
                  }}
                />

                {cedulaHint && (
                  <div
                    style={{
                      marginTop: 6,
                      color: "#d32f2f",
                      fontSize: 13,
                      lineHeight: 1.3,
                    }}
                  >
                    {cedulaHint}
                  </div>
                )}
              </div>

              <div style={{ width: "100%" }}>
                <div className="label" style={{ marginBottom: 6, fontSize: 14 }}>
                  Contraseña
                </div>

                <div
                  style={{
                    position: "relative",
                    width: "100%",
                  }}
                >
                  <input
                    className="input"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    autoComplete="current-password"
                    style={{
                      width: "100%",
                      minHeight: 46,
                      boxSizing: "border-box",
                      fontSize: 16,
                      paddingRight: 52,
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
                    title={showPw ? "Ocultar" : "Mostrar"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 34,
                      height: 34,
                      borderRadius: 10,
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
                    <span style={{ fontSize: 15, lineHeight: 1 }}>
                      {showPw ? "🙈" : "👁️"}
                    </span>
                  </button>
                </div>
              </div>

              <button
                className="btn"
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  minHeight: 46,
                  boxSizing: "border-box",
                  marginTop: 2,
                  fontSize: 15,
                }}
              >
                {loading ? "Ingresando..." : "Ingresar"}
              </button>
            </form>

            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                lineHeight: 1.35,
                textAlign: "center",
              }}
            >
              <button
                type="button"
                onClick={openForgotPasswordModal}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  margin: 0,
                  color: "var(--primary)",
                  textDecoration: "underline",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ¿Olvidó su contraseña?
              </button>
            </div>

          </div>
        </div>
      </main>

      <div
        style={{
          width: "100%",
          maxWidth: "100vw",
          overflowX: "clip",
        }}
      >
        <Footer />
      </div>

      {showForgotModal && (
        <div
          onClick={closeForgotPasswordModal}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 380,
              borderRadius: 18,
              padding: "18px 16px",
              boxSizing: "border-box",
            }}
          >
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 16,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
              }}
            >
              Recuperar contraseña
            </h2>

            <div style={{ width: "100%" }}>
              <input
                className="input"
                type="email"
                value={resetEmail}
                onChange={(e) => {
                  setResetEmail(e.target.value);
                  setResetEmailError("");
                }}
                placeholder="Correo"
                autoComplete="email"
                style={{
                  width: "100%",
                  minHeight: 46,
                  boxSizing: "border-box",
                  fontSize: 16,
                }}
              />
            </div>

            {resetEmailError && (
              <div
                style={{
                  marginTop: 8,
                  color: "#d32f2f",
                  fontSize: 13,
                  lineHeight: 1.3,
                }}
              >
                {resetEmailError}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={closeForgotPasswordModal}
                disabled={sendingReset}
                style={{
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid var(--btn-light-border)",
                  background: "var(--btn-light-bg)",
                  color: "var(--btn-light-text)",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSendResetEmail}
                disabled={sendingReset}
                className="btn"
                style={{
                  width: "100%",
                  minHeight: 44,
                  fontSize: 14,
                }}
              >
                {sendingReset ? "Enviando..." : "Enviar correo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}