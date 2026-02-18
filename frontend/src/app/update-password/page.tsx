"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function UpdatePasswordPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>("");
  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  // cuando el usuario entra desde el link del correo, supabase crea una sesión temporal.
  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setMsg("El link no es válido o expiró. Solicita el correo nuevamente.");
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const p = password.trim();
    if (p.length < 6) {
      setMsg("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password: p });
      if (error) throw error;

      setOk(true);
      setMsg("✅ Contraseña actualizada. Ahora inicia sesión.");
      // opcional: cerrar sesión por seguridad
      await supabase.auth.signOut();
      setTimeout(() => router.replace("/login"), 900);
    } catch (e: any) {
      setMsg(e?.message || "No se pudo actualizar la contraseña.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: 20 }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 80 }}>
        <Header mode="simple" logoUrl={logoUrl} />
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

          {loading ? (
            <div style={{ marginTop: 12, color: "var(--muted)" }}>Cargando...</div>
          ) : (
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
          )}
        </div>
      </div>

      <Footer rightText="Made for Iglesia La Promesa." />
    </div>
  );
}
