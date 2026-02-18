"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { primaryRole, roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";

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

  const studentCourseFixed = useMemo(() => {
    const c = me?.course ?? null;
    return c;
  }, [me]);

  const studentLevelFixed = useMemo(() => {
    const lvl = Number(studentCourseFixed?.level);
    return Number.isFinite(lvl) && lvl > 0 ? lvl : null;
  }, [studentCourseFixed]);

  const blockedByYear = useMemo(() => {
    if (!studentLevelFixed) return false;
    return level !== studentLevelFixed;
  }, [level, studentLevelFixed]);

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

  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // auth guard
  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");
        const info = await apiFetch("/api/auth/me");
        setMe(info);

        const activeRole = getActiveRole(info);
        if (activeRole !== "S") return router.replace(roleToRoute(activeRole));
      } catch {
        router.replace("/login");
      } finally {
        setMeLoading(false);
      }
    })();
  }, [router]);

  // set year to real student level
  useEffect(() => {
    if (!meLoading && studentLevelFixed) {
      setLevel(studentLevelFixed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meLoading, studentLevelFixed]);

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

  async function loadSummary() {
    setError(null);

    if (blockedByYear) {
      setSummaryItems([]);
      setSummaryStats(null);
      return;
    }

    setSummaryLoading(true);
    try {
      const res = await apiFetch(`/api/student/subjects-summary?level=${level}`);
      setSummaryItems(res?.items || []);
      setSummaryStats(res?.stats || null);
    } catch (e: any) {
      setSummaryItems([]);
      setSummaryStats(null);
      setError(e?.message || "Error cargando resumen del año");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, blockedByYear]);

  // autocomplete
  useEffect(() => {
    setError(null);

    if (blockedByYear) {
      setSuggestions([]);
      setOpenSug(false);
      setLoadingSug(false);
      return;
    }

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
  }, [q, level, blockedByYear]);

  const canConsult = useMemo(
    () => !!selectedClass?.id && !blockedByYear,
    [selectedClass, blockedByYear]
  );

  function pickClass(c: ClassItem) {
    setSelectedClass(c);
    setQ(c.name);
    setOpenSug(false);
  }

  async function handleConsult(classOverride?: { id: number; name: string }) {
    if (blockedByYear) {
      setError("Aún no ha cursado este año.");
      return;
    }

    const classId = classOverride?.id ?? selectedClass?.id;
    if (!classId) return;

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

  const PASS_GRADE = summaryStats?.pass_grade ?? 70;
  const gradeTextColor = (value: number | null) => {
    if (value === null) return "inherit";
    return value >= PASS_GRADE ? "rgb(21,128,61)" : "rgb(185,28,28)";
  };

  const passed = summaryStats?.passed ?? 0;
  const failed = summaryStats?.failed ?? 0;

  // ✅ NUEVO: porcentajes para “barra de progreso” dentro de las tarjetas
  const totalPF = passed + failed;
  const passPct = totalPF > 0 ? Math.round((passed / totalPF) * 100) : 0;
  const failPct = totalPF > 0 ? Math.round((failed / totalPF) * 100) : 0;

  const fixedCourseName = useMemo(() => {
    return (
      studentCourseFixed?.name ??
      (me?.profile?.id_course ? `ID ${me.profile.id_course}` : "—")
    );
  }, [studentCourseFixed, me]);

  if (meLoading) return <div className="container">Cargando...</div>;

  // ✅ medidas UI
  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div>
      {/* ✅ HAMBURGUESA (se pega al borde del sidebar cuando abre) */}
      <div
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 70,
          width: sidebarOpen ? SIDEBAR_W + HAM_PAD + 44 : HAM_PAD + 44,
          height: 72,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: hamLeft,
            top: HAM_PAD,
            zIndex: 70,
            width: 44,
            height: 44,
            borderRadius: 14,
            background: "var(--card)",
            border: "1px solid var(--stroke)",
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "grid", gap: 5 }}>
            <div
              style={{
                width: 18,
                height: 2,
                borderRadius: 9,
                background: "color-mix(in srgb, var(--text) 85%, transparent)",
              }}
            />
            <div
              style={{
                width: 18,
                height: 2,
                borderRadius: 9,
                background: "color-mix(in srgb, var(--text) 65%, transparent)",
              }}
            />
            <div
              style={{
                width: 18,
                height: 2,
                borderRadius: 9,
                background: "color-mix(in srgb, var(--text) 45%, transparent)",
              }}
            />
          </div>
        </div>
      </div>

      {/* ✅ SIDEBAR (oculta y aparece con hover) */}
      <aside
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: SIDEBAR_W,
          padding: 18,
          background: "var(--card)",
          borderRight: "1px solid var(--stroke)",
          boxShadow: "var(--shadow)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          overflow: "auto",
          zIndex: 55,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 180ms ease",
          color: "var(--text)",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18 }}>Perfil del estudiante</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>
          Datos del usuario autenticado
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="label">Nombre</div>
          <div style={{ fontWeight: 900 }}>
            {me?.profile?.name ??
              me?.profile?.full_name ??
              me?.user?.user_metadata?.full_name ??
              "—"}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="label">Email</div>
          <div style={{ fontWeight: 900, wordBreak: "break-word" }}>{me?.user?.email ?? "—"}</div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="label">Rol</div>
          <div style={{ fontWeight: 900 }}>{roleLabelFromRole(primaryRole(me))}</div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="label">Curso</div>
          <div style={{ fontWeight: 900 }}>{fixedCourseName}</div>
        </div>
        <ChangePasswordButton email={me?.user?.email} className="btn" />
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={handleLogout} style={{ width: "100%" }}>
            Salir
          </button>
        </div>
      </aside>

      {/* ✅ CONTENIDO */}
      <main
        style={{
          marginLeft: sidebarOpen ? SIDEBAR_W : 0,
          transition: "margin-left 180ms ease",
        }}
      >
        <div className="container">
          <div className="topbar" style={{ alignItems: "center" }}>
            <div className="brand">
              <div style={{ fontWeight: 900, fontSize: 18 }}>JILIU · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="btnLight">
                {me?.role === "A" ? "Admin" : me?.role === "T" ? "Teacher" : "Student"} ·{" "}
                {me?.user?.email}
              </div>
            </div>
          </div>

          {error && <div className="msgError">{error}</div>}

          <div
            style={{
              marginTop: 18,
              display: "grid",
              gridTemplateColumns: "1.2fr .8fr",
              gap: 18,
              alignItems: "start",
            }}
          >
            {/* IZQUIERDA */}
            <div className="card">
              <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
                Consultar notas
              </h1>

              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 160px", gap: 12 }}>
                <div>
                  <div className="label">Año</div>
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

                  {blockedByYear && (
                    <div style={{ marginTop: 8, color: "#b45309", fontWeight: 800, fontSize: 13 }}>
                      Aún no ha cursado este año.
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
                  <div className="label">Materia</div>
                  <input
                    className="input"
                    value={q}
                    disabled={blockedByYear}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setSelectedClass(null);
                      setItems([]);
                      setWeighted(null);
                    }}
                    placeholder={
                      blockedByYear
                        ? "Aún no ha cursado este año"
                        : "Escribe: Matemáticas, Inglés, Historia..."
                    }
                    onFocus={() => !blockedByYear && q.trim() && setOpenSug(true)}
                  />

                  {openSug && (suggestions.length > 0 || loadingSug) && (
                    <div
                      style={{
                        position: "absolute",
                        zIndex: 20,
                        left: 0,
                        right: 0,
                        top: 76,
                        border: "1px solid var(--stroke2)",
                        borderRadius: 16,
                        overflow: "hidden",
                        boxShadow: "0 18px 45px rgba(2,132,199,.10)",
                        background: "var(--card)",
                        color: "var(--text)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                      }}
                    >
                      {loadingSug && (
                        <div style={{ padding: 12, color: "var(--muted)" }}>Buscando...</div>
                      )}
                      {!loadingSug &&
                        suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => pickClass(s)}
                            className="btnLight"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: 12,
                              borderRadius: 0,
                              border: 0,
                              background: "transparent",
                              boxShadow: "none",
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

              {blockedByYear ? (
                <div style={{ marginTop: 18, color: "var(--muted)", fontWeight: 800 }}>
                  Aún no ha cursado este año.
                </div>
              ) : (
                <>
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
                        </div>
                        <button type="button" onClick={loadSummary} className="btnLight">
                          {summaryLoading ? "Cargando..." : "Refrescar"}
                        </button>
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          overflow: "hidden",
                          borderRadius: 18,
                          border: "1px solid var(--stroke)",
                        }}
                      >
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
                                <tr
                                  key={s.class_id}
                                  style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}
                                >
                                  <td style={{ padding: 12, fontWeight: 900 }}>{s.name}</td>
                                  <td
                                    style={{
                                      padding: 12,
                                      fontWeight: 900,
                                      color: gradeTextColor(s.weighted),
                                    }}
                                  >
                                    {s.weighted === null ? "—" : s.weighted.toFixed(2)}
                                  </td>
                                  <td style={{ padding: 12 }}>
                                    <button
                                      type="button"
                                      onClick={() => handleConsult({ id: s.class_id, name: s.name })}
                                      className="btn"
                                      style={{ width: "100%", marginTop: 0 }}
                                    >
                                      Detalle
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
                          <div className="label">Materia</div>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>{selectedClass.name}</div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div className="label">Ponderado total</div>
                          <div
                            style={{
                              fontWeight: 900,
                              fontSize: 22,
                              color: gradeTextColor(weighted),
                            }}
                          >
                            {weighted === null ? "—" : weighted.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          overflow: "hidden",
                          borderRadius: 18,
                          border: "1px solid var(--stroke)",
                        }}
                      >
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
                                <tr
                                  key={it.exam_id}
                                  style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}
                                >
                                  <td style={{ padding: 12, fontWeight: 900 }}>{it.title}</td>
                                  <td style={{ padding: 12 }}>{Number(it.percent).toFixed(0)}%</td>
                                  <td
                                    style={{
                                      padding: 12,
                                      fontWeight: 900,
                                      color: gradeTextColor(it.grade),
                                    }}
                                  >
                                    {it.grade === null ? "—" : Number(it.grade).toFixed(2)}
                                  </td>
                                  <td style={{ padding: 12 }}>
                                    {it.finished_at
                                      ? new Date(it.finished_at).toLocaleDateString()
                                      : "—"}
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
                          className="btnLight"
                        >
                          Volver a materias
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* DERECHA */}
            <div className="card">
              <h2 style={{ marginTop: 6 }}>Resumen del año</h2>
              <p style={{ marginTop: 0, color: "var(--muted)" }}>
                Totales calculados con ponderado por materia.
              </p>

              {blockedByYear ? (
                <div style={{ marginTop: 12, color: "var(--muted)", fontWeight: 800 }}>
                  Aún no ha cursado este año.
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    {/* ✅ PASADAS con “barra de progreso” en el background */}
                    <div
                      className="btnLight"
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 18,
                      }}
                    >
                      <div
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${passPct}%`,
                          background:
                            "linear-gradient(180deg, rgba(34,197,94,.22), rgba(21,128,61,.18))",
                        }}
                      />
                      <div style={{ position: "relative" }}>
                        <div className="label">Materias pasadas</div>
                        <div style={{ fontSize: 26, fontWeight: 900 }}>
                          {summaryStats ? passed : "—"}
                        </div>
                        <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>
                          {summaryStats ? `${passPct}% del total` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* ✅ PERDIDAS con “barra de progreso” en el background */}
                    <div
                      className="btnLight"
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 18,
                      }}
                    >
                      <div
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${failPct}%`,
                          background:
                            "linear-gradient(180deg, rgba(239,68,68,.22), rgba(185,28,28,.18))",
                        }}
                      />
                      <div style={{ position: "relative" }}>
                        <div className="label">Materias perdidas</div>
                        <div style={{ fontSize: 26, fontWeight: 900 }}>
                          {summaryStats ? failed : "—"}
                        </div>
                        <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>
                          {summaryStats ? `${failPct}% del total` : "—"}
                        </div>
                      </div>
                    </div>

                    <div
                      className="btnLight"
                      style={{
                        gridColumn: "1 / span 2",
                        padding: 14,
                        borderRadius: 18,
                        border: "1px solid var(--stroke)",
                      }}
                    >
                      <div className="label">Promedio ponderado total</div>
                      <div
                        style={{
                          fontSize: 26,
                          fontWeight: 900,
                          color: gradeTextColor(summaryStats?.avg_weighted ?? null),
                        }}
                      >
                        {summaryStats?.avg_weighted === null || !summaryStats
                          ? "—"
                          : summaryStats.avg_weighted.toFixed(2)}
                      </div>
                      <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                        Umbral para “pasada”:{" "}
                        {summaryStats ? summaryStats.pass_grade.toFixed(2) : "—"}
                        {summaryStats?.pending ? ` · Pendientes: ${summaryStats.pending}` : ""}
                      </div>
                    </div>
                  </div>

                  {/* ✅ QUITADO: gráfica de barras de abajo */}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer rightText="Made for Iglesia La Promesa." />
    </div>
  );
}
