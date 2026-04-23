"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import RegistrarAsistencia from "./RegistrarAsistencia";
import ReporteAsistencia from "./ReporteAsistencia";
type MonitorView = "" | "REGISTRAR" | "CONSULTAR";

export default function MonitorPage() {
  const router = useRouter();
  const [me, setMe]           = useState<Record<string, unknown> | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView]       = useState<MonitorView>("");

  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");
        const info = await apiFetch("/api/auth/me");
        setMe(info);
        const activeRole = getActiveRole(info);
        if (activeRole !== "M") return router.replace(roleToRoute(activeRole));
      } catch {
        router.replace("/login");
      } finally {
        setMeLoading(false);
      }
    })();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (meLoading) return <div className="container">Cargando...</div>;

  const SIDEBAR_W = 300;
  const HAM_PAD   = 14;
  const hamLeft   = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div style={{ fontFamily: '"Inter","Segoe UI",system-ui,-apple-system,sans-serif' }}>
      {/* Hamburger */}
      <div style={{ position: "fixed", top: 0, left: 0, zIndex: 70, width: sidebarOpen ? SIDEBAR_W + HAM_PAD + 44 : HAM_PAD + 44, height: 72 }}>
        <div
          onClick={() => setSidebarOpen((v) => !v)}
          style={{ position: "absolute", left: hamLeft, top: HAM_PAD, zIndex: 70, width: 44, height: 44, borderRadius: 14, background: "var(--card)", border: "1px solid var(--stroke)", boxShadow: "var(--shadow)", backdropFilter: "blur(10px)", display: "grid", placeItems: "center", cursor: "pointer" }}
        >
          <div style={{ display: "grid", gap: 5 }}>
            {[85, 65, 45].map((op, i) => (
              <div key={i} style={{ width: 18, height: 2, borderRadius: 9, background: `color-mix(in srgb, var(--text) ${op}%, transparent)` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: SIDEBAR_W, padding: 18, background: "var(--card)", borderRight: "1px solid var(--stroke)", boxShadow: "var(--shadow)", backdropFilter: "blur(10px)", overflow: "auto", zIndex: 55, transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 180ms ease", color: "var(--text)" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Perfil del monitor</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>Datos del usuario autenticado</div>

        {[
          { label: "Nombre", value: me?.profile?.name ?? "—" },
          { label: "Email",  value: me?.user?.email  ?? "—" },
          { label: "Rol",    value: roleLabelFromRole(getActiveRole(me)) },
          { label: "Curso",  value: me?.course?.name ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{ marginTop: 10 }}>
            <div className="label" style={{ fontWeight: 500 }}>{label}</div>
            <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{value}</div>
          </div>
        ))}

        <div style={{ marginTop: 20 }}>
          <ChangePasswordButton email={me?.user?.email} className="btn actionBtn" />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn actionBtn" onClick={handleLogout} style={{ width: "100%" }}>Salir</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ marginLeft: sidebarOpen ? SIDEBAR_W : 0, transition: "margin-left 180ms ease" }}>
        <div className="container">
          {/* Top bar */}
          <div className="topbar dashboard-topbar" style={{ alignItems: "center" }}>
            <div className="brand">
              <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Panel Monitor</div>
            </div>
            <div className="topbarUserText">
              Monitor · {me?.profile?.name ?? me?.user?.email ?? "—"}
            </div>
          </div>

          {/* Menú */}
          <div className="card" style={{ marginTop: 18 }}>
            <div style={{ display: "grid", gridTemplateColumns: "4fr 1fr", gap: 14, alignItems: "end" }}>
              <div>
                <div className="label">¿Qué quieres hacer?</div>
                <select
                  className="select"
                  style={{ width: "100%", marginTop: 6 }}
                  value={view}
                  onChange={(e) => setView(e.target.value as MonitorView)}
                >
                  <option value="" disabled>Selecciona una opción...</option>
                  <option value="REGISTRAR">Registrar asistencia</option>
                  <option value="CONSULTAR">Reporte de asistencia</option>
                </select>
              </div>
              <div>
                <div className="label">Año lectivo</div>
                <div className="select" style={{ cursor: "default", userSelect: "none", marginTop: 6 }}>
                  {(me?.course as { year?: number })?.year ?? "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Vistas */}
          {view === "REGISTRAR" && <RegistrarAsistencia me={me} />}
          {view === "CONSULTAR" && <ReporteAsistencia me={me} />}
        </div>
      </main>

      <Footer />
    </div>
  );
}
