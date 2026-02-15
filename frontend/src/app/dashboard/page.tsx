"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";

type ClassItem = { id: number; name: string; level: number };

type GradeItem = {
  exam_id: number;
  title: string;
  percent: number;
  grade: number | null;
  finished_at: string | null;
  attempts: number | null;
  source: string | null;
};

type SummaryItem = {
  class_id: number;
  name: string;
  weighted: number | null;
};

type SummaryStats = {
  passed: number;
  failed: number;
  pending: number;
  avg_weighted: number | null;
  pass_grade: number;
};

const LEVELS = [
  { value: 1, label: "Primer año" },
  { value: 2, label: "Segundo año" },
  { value: 3, label: "Tercer año" },
  { value: 4, label: "Cuarto año" },
];

export default function DashboardPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [meLoading, setMeLoading] = useState(true);

  const [level, setLevel] = useState<number>(1);

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<ClassItem[]>([]);
  const [openSug, setOpenSug] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);

  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);

  const [loadingGrades, setLoadingGrades] = useState(false);
  const [items, setItems] = useState<GradeItem[]>([]);
  const [weighted, setWeighted] = useState<number | null>(null);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryItems, setSummaryItems] = useState<SummaryItem[]>([]);
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);

  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);

  // auth guard
  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");
        const info = await apiFetch("/api/auth/me");
        setMe(info);
      } catch {
        router.replace("/login");
      } finally {
        setMeLoading(false);
      }
    })();
  }, [router]);

  // reset when level changes
  useEffect(() => {
    setSelectedClass(null);
    setQ("");
    setSuggestions([]);
    setOpenSug(false);

    setItems([]);
    setWeighted(null);

    setError(null);
  }, [level]);

  // cargar resumen por año (cuando hay level y NO hay materia seleccionada)
  async function loadSummary() {
    setError(null);
    setSummaryLoading(true);
    try {
      const res = await apiFetch(`/api/student/subjects-summary?level=${level}`);
      console.log("FRONT subjects-summary RES =>", res);
      console.log("FRONT subjects-summary items =>", res?.items);
      setSummaryItems(res?.items || []);
      setSummaryStats(res?.stats || null);
    } catch (e: any) {
      console.error("FRONT subjects-summary ERROR =>", e);
      setSummaryItems([]);
      setSummaryStats(null);
      setError(e?.message || "Error cargando resumen del año");
    } finally {
      setSummaryLoading(false);
    }
  }


  useEffect(() => {
    // cada vez que cambia el año, refrescamos el resumen
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // autocomplete
  useEffect(() => {
    setError(null);

    if (!q.trim()) {
      setSuggestions([]);
      setOpenSug(false);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoadingSug(true);
        const res = await apiFetch(
          `/api/student/classes?level=${level}&q=${encodeURIComponent(q.trim())}`
        );
        setSuggestions(res?.items || []);
        setOpenSug(true);
      } catch (e: any) {
        setError(e?.message || "Error buscando materias");
      } finally {
        setLoadingSug(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, level]);

  const canConsult = useMemo(() => !!selectedClass?.id, [selectedClass]);

  function pickClass(c: ClassItem) {
    setSelectedClass(c);
    setQ(c.name);
    setOpenSug(false);
  }

  async function handleConsult(classOverride?: { id: number; name: string }) {
    const classId = classOverride?.id ?? selectedClass?.id;
    if (!classId) return;

    // si viene desde la tabla resumen, seteamos el input también
    if (classOverride) {
      setSelectedClass({ id: classOverride.id, name: classOverride.name, level } as ClassItem);
      setQ(classOverride.name);
      setOpenSug(false);
    }

    setError(null);
    setLoadingGrades(true);
    try {
      const res = await apiFetch(`/api/student/grades?level=${level}&class_id=${classId}`);
      setItems(res?.items || []);
      setWeighted(typeof res?.weighted === "number" ? res.weighted : null);
    } catch (e: any) {
      setError(e?.message || "Error consultando notas");
    } finally {
      setLoadingGrades(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // mini chart helpers
  const passed = summaryStats?.passed ?? 0;
  const failed = summaryStats?.failed ?? 0;
  const maxBar = Math.max(1, passed, failed);
  const CHART_MAX = 50; // tope para que no choque con padding
  const passH = Math.min(CHART_MAX, Math.round((passed / maxBar) * CHART_MAX));
  const failH = Math.min(CHART_MAX, Math.round((failed / maxBar) * CHART_MAX));


  if (meLoading) return <div className="container">Cargando...</div>;

  return (
    <div className="container">
      <div className="topbar" style={{ alignItems: "center" }}>
        <div className="brand">
          <div style={{ fontWeight: 900, fontSize: 18 }}>JILIU · La Promesa</div>
          <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid var(--stroke)",
              background: "rgba(255,255,255,.75)",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            {me?.role === "A" ? "Admin" : me?.role === "T" ? "Teacher" : "Student"} ·{" "}
            {me?.user?.email}
          </div>
          <button
            onClick={handleLogout}
            style={{
              border: 0,
              borderRadius: 14,
              padding: "10px 12px",
              cursor: "pointer",
              background: "rgba(255,255,255,.85)",
              borderColor: "var(--stroke)",
              borderStyle: "solid",
              borderWidth: 1,
              fontWeight: 900,
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {error && <div className="msgError">{error}</div>}

      {/* NUEVO LAYOUT: izquierda consultar, derecha mini dashboard */}
      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "1.2fr .8fr",
          gap: 18,
        }}
      >
        {/* IZQUIERDA */}
        <div className="card">
          <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
            Consultar notas
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Selecciona el año, busca la materia y consulta tus evaluaciones con ponderado.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 160px", gap: 12 }}>
            <div>
              <div className="label">Año JILIU</div>
              <select
                className="select"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
              >
                {LEVELS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ position: "relative" }}>
              <div className="label">Materia</div>
              <input
                className="input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSelectedClass(null);
                  setItems([]);
                  setWeighted(null);
                }}
                placeholder="Escribe: Matemáticas, Inglés, Historia..."
                onFocus={() => q.trim() && setOpenSug(true)}
              />

              {openSug && (suggestions.length > 0 || loadingSug) && (
                <div
                  style={{
                    position: "absolute",
                    zIndex: 20,
                    left: 0,
                    right: 0,
                    top: 76,
                    background: "rgba(255,255,255,.98)",
                    border: "1px solid var(--stroke2)",
                    borderRadius: 16,
                    overflow: "hidden",
                    boxShadow: "0 18px 45px rgba(2,132,199,.10)",
                  }}
                >
                  {loadingSug && <div style={{ padding: 12, color: "var(--muted)" }}>Buscando...</div>}
                  {!loadingSug &&
                    suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickClass(s)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 12,
                          border: 0,
                          background: "transparent",
                          cursor: "pointer",
                          fontWeight: 800,
                        }}
                      >
                        {s.name}
                      </button>
                    ))}
                  {!loadingSug && suggestions.length === 0 && (
                    <div style={{ padding: 12, color: "var(--muted)" }}>No hay coincidencias</div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                className="btn"
                disabled={!canConsult || loadingGrades}
                onClick={() => handleConsult()}
                style={{ width: "100%" }}
              >
                {loadingGrades ? "Consultando..." : "Consultar"}
              </button>
            </div>
          </div>

          {/* Si NO hay materia seleccionada -> mostramos tabla resumen */}
          {!selectedClass && (
            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <div className="label">Materias del año (ponderado total)</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    Dale “Consultar” para ver el detalle de esa materia.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadSummary}
                  style={{
                    border: "1px solid var(--stroke2)",
                    background: "rgba(255,255,255,.85)",
                    borderRadius: 14,
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  {summaryLoading ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(14,165,233,.08)" }}>
                      <th style={{ textAlign: "left", padding: 12 }}>Materia</th>
                      <th style={{ textAlign: "left", padding: 12, width: 120 }}>Nota</th>
                      <th style={{ textAlign: "left", padding: 12, width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryLoading ? (
                      <tr>
                        <td colSpan={3} style={{ padding: 12, color: "var(--muted)" }}>
                          Cargando materias...
                        </td>
                      </tr>
                    ) : summaryItems.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ padding: 12, color: "var(--muted)" }}>
                          No hay materias/evaluaciones registradas para este año todavía.
                        </td>
                      </tr>
                    ) : (
                      summaryItems.map((s) => (
                        <tr key={s.class_id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 900 }}>{s.name}</td>
                          <td style={{ padding: 12, fontWeight: 900 }}>
                            {s.weighted === null ? "—" : s.weighted.toFixed(2)}
                          </td>
                          <td style={{ padding: 12 }}>
                            <button
                              type="button"
                              onClick={() => handleConsult({ id: s.class_id, name: s.name })}
                              style={{
                                width: "100%",
                                border: 0,
                                borderRadius: 14,
                                padding: "10px 12px",
                                cursor: "pointer",
                                color: "white",
                                background: "linear-gradient(180deg, var(--sky), var(--sky2))",
                                fontWeight: 900,
                              }}
                            >
                              Consultar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Si hay materia seleccionada -> detalle como antes */}
          {selectedClass && (
            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 18,
                  alignItems: "flex-end",
                }}
              >
                <div>
                  <div className="label">Materia seleccionada</div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{selectedClass.name}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="label">Ponderado total</div>
                  <div style={{ fontWeight: 900, fontSize: 22 }}>
                    {weighted === null ? "—" : weighted.toFixed(2)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(14,165,233,.08)" }}>
                      <th style={{ textAlign: "left", padding: 12 }}>Evaluación</th>
                      <th style={{ textAlign: "left", padding: 12, width: 70 }}>%</th>
                      <th style={{ textAlign: "left", padding: 12, width: 90 }}>Nota</th>
                      <th style={{ textAlign: "left", padding: 12, width: 120 }}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                          No hay evaluaciones/notas para esta materia en este año.
                        </td>
                      </tr>
                    ) : (
                      items.map((it) => (
                        <tr key={it.exam_id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 900 }}>{it.title}</td>
                          <td style={{ padding: 12 }}>{Number(it.percent).toFixed(0)}%</td>
                          <td style={{ padding: 12, fontWeight: 900 }}>
                            {it.grade === null ? "—" : Number(it.grade).toFixed(2)}
                          </td>
                          <td style={{ padding: 12 }}>
                            {it.finished_at ? new Date(it.finished_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClass(null);
                    setQ("");
                    setItems([]);
                    setWeighted(null);
                    loadSummary();
                  }}
                  style={{
                    border: "1px solid var(--stroke2)",
                    background: "rgba(255,255,255,.85)",
                    borderRadius: 14,
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Volver a materias
                </button>
              </div>
            </div>
          )}
        </div>

        {/* DERECHA: mini-dashboard */}
        <div className="card">
          <h2 style={{ marginTop: 6 }}>Resumen del año</h2>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            Totales calculados con ponderado por materia (solo materias con notas).
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 18,
                border: "1px solid var(--stroke)",
                background: "rgba(255,255,255,.65)",
              }}
            >
              <div className="label">Materias pasadas</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{summaryStats ? passed : "—"}</div>
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 18,
                border: "1px solid var(--stroke)",
                background: "rgba(255,255,255,.65)",
              }}
            >
              <div className="label">Materias perdidas</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{summaryStats ? failed : "—"}</div>
            </div>

            <div
              style={{
                gridColumn: "1 / span 2",
                padding: 14,
                borderRadius: 18,
                border: "1px solid var(--stroke)",
                background: "rgba(255,255,255,.65)",
              }}
            >
              <div className="label">Promedio ponderado total</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>
                {summaryStats?.avg_weighted === null || !summaryStats ? "—" : summaryStats.avg_weighted.toFixed(2)}
              </div>
              <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                Umbral para “pasada”: {summaryStats ? summaryStats.pass_grade.toFixed(2) : "—"}
                {summaryStats?.pending ? ` · Pendientes: ${summaryStats.pending}` : ""}
              </div>
            </div>
          </div>

          {/* Mini bar chart */}
          <div style={{ marginTop: 18 }}>
            <div className="label">Materias pasadas vs perdidas</div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "flex-end",
                gap: 18,
                height: 110,
                padding: 12,
                borderRadius: 18,
                border: "1px solid var(--stroke)",
                background: "rgba(14,165,233,.06)",
                overflow: "hidden",
                boxSizing: "border-box",
              }}
            >
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: "70%",
                    height: `${passH}px`,
                    borderRadius: 14,
                    background: "linear-gradient(180deg, rgba(34,197,94,.9), rgba(21,128,61,.9))",
                  }}
                />
                <div style={{ fontWeight: 900, fontSize: 13 }}>Pasadas ({passed})</div>
              </div>

              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: "70%",
                    height: `${failH}px`,
                    borderRadius: 14,
                    background: "linear-gradient(180deg, rgba(239,68,68,.9), rgba(185,28,28,.9))",
                  }}
                />
                <div style={{ fontWeight: 900, fontSize: 13 }}>Perdidas ({failed})</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, color: "var(--muted)", fontSize: 13 }}>
            * El promedio usa solo materias con ponderado calculable (con notas).
          </div>
        </div>
      </div>
    </div>
  );
}
