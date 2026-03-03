"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function ExamStartPage() {
  const router = useRouter();
  const sp = useSearchParams();
  console.log("SearchParams", sp);
  const testId = sp.get("testId") || "";
  const classId = sp.get("classId") || "";
  const testTitle = sp.get("testTitle") || "";
  const label = sp.get("label") || "";

  // ✅ ya NO se escribe cédula: viene del perfil
  const [me, setMe] = useState<any>(null);
  const [meLoading, setMeLoading] = useState(true);

  const cedulaFixed = useMemo(() => {
    const c =
      me?.profile?.cedula ??
      me?.profile?.document ??
      me?.profile?.document_number ??
      me?.cedula ??
      null;

    return c ? String(c).trim() : "";
  }, [me]);

  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = useMemo(() => !!testId && !!classId && !!testTitle, [testId, classId, testTitle]);

  // ✅ cargar usuario autenticado para obtener la cédula
  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const info = await apiFetch("/api/auth/me");
        setMe(info);
      } catch (e: any) {
        setMe(null);
        setErr(e?.message || "No pude cargar tu perfil. Vuelve a iniciar sesión.");
      } finally {
        setMeLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) setErr("Falta información del examen. Vuelve y selecciónalo de nuevo.");
  }, [ready]);

  async function handleStart() {
    setErr(null);

    if (!ready) return;

    if (!cedulaFixed) {
      return setErr("Tu usuario no tiene cédula registrada. Contacta al administrador.");
    }
    if (!pin.trim()) return setErr("Escribe la clave del examen.");

    setLoading(true);
    try {
      const res = await apiFetch("/api/student/etm/start", {
        method: "POST",
        body: JSON.stringify({
          testId,
          classId: Number(classId),
          testTitle,
          cedula: cedulaFixed,
          pin: pin.trim(),
        }),
      });

      const url = res?.redirectUrl;
      if (!url) throw new Error("No se recibió la URL del examen.");

      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar el examen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 820, paddingTop: 28 }}>
      <div className="card">
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Presentar examen</h1>
        <p style={{ marginTop: 6, color: "var(--muted)" }}>
          {label ? (
            <>
              Examen seleccionado: <b>{label}</b>
            </>
          ) : (
            "Examen seleccionado"
          )}
        </p>

        {err && <div className="msgError">{err}</div>}

        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {/* ✅ CÉDULA FIJA (NO EDITABLE) */}
          <div>
            <div className="label">Cédula</div>

            <div
              style={{
                height: 46,
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                borderRadius: 14,
                border: "1px solid var(--stroke)",
                background: "color-mix(in srgb, var(--card) 70%, transparent)",
                color: "var(--text)",
                fontWeight: 900,
                opacity: cedulaFixed ? 1 : 0.65,
              }}
            >
              {meLoading ? "Cargando..." : cedulaFixed || "—"}
            </div>

            {!meLoading && !cedulaFixed && (
              <div style={{ marginTop: 8, color: "#b45309", fontWeight: 800, fontSize: 13 }}>
                No encontramos tu cédula en el perfil. Pídele al admin que la registre.
              </div>
            )}
          </div>

          {/* ✅ PIN SÍ ES INPUT */}
          <div>
            <div className="label">Clave del examen</div>
            <input
              className="input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Ej: 1234"
              inputMode="numeric"
            />
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>
              Esta es la clave que te entregó el docente.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              className="btnLight"
              type="button"
              onClick={() => router.back()}
              disabled={loading}
            >
              Volver
            </button>

            <button
              className="btn"
              type="button"
              onClick={handleStart}
              disabled={loading || !ready || meLoading || !cedulaFixed}
            >
              {loading ? "Iniciando..." : "Iniciar examen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}