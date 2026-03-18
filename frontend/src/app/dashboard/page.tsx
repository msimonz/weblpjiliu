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
  type: string | null;
  title: string;
  percent: number;
  grade: number | null;
  finished_at: string | null;
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
    console.log("C", c);
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

  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  useEffect(() => {
    if (!meLoading && studentLevelFixed) {
      setLevel(studentLevelFixed);
    }
  }, [meLoading, studentLevelFixed]);

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
  }, [level, blockedByYear]);

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

  function pickClass(c: ClassItem) {
    setSelectedClass(c);
    setQ(c.name);
    setOpenSug(false);
  }

  async function handleConsult(classOverride?: { id: number; name: string }) {
    if (blockedByYear) {
      setError("Sin notas para este año..");
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

      console.log("RESPUESTA /grades:", res);
      console.log("ITEMS /grades:", res?.items);

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

  const fixedCourseName = useMemo(() => {
    return studentCourseFixed?.name ?? "—";
  }, [studentCourseFixed]);

  if (meLoading) return <div className="container">Cargando...</div>;

  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  const passedActive = passed > 0;
  const failedActive = failed > 0;

  return (
    <div
      style={{
        fontFamily:
          '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 70,
          width: sidebarOpen ? SIDEBAR_W + 14 + 44 : 14 + 44,
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
        <div style={{ fontWeight: 700, fontSize: 18 }}>Perfil del estudiante</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13, fontWeight: 400 }}>
          Datos del usuario autenticado
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="label" style={{ fontWeight: 500 }}>
            Nombre
          </div>
          <div style={{ fontWeight: 600 }}>
            {me?.profile?.name ??
              me?.profile?.full_name ??
              me?.user?.user_metadata?.full_name ??
              "—"}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="label" style={{ fontWeight: 500 }}>
            Email
          </div>
          <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{me?.user?.email ?? "—"}</div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="label" style={{ fontWeight: 500 }}>
            Rol
          </div>
          <div style={{ fontWeight: 600 }}>{roleLabelFromRole(primaryRole(me))}</div>
        </div>

        <div style={{ marginTop: 10, marginBottom: 20 }}>
          <div className="label" style={{ fontWeight: 500 }}>
            Curso
          </div>
          <div style={{ fontWeight: 600 }}>{fixedCourseName}</div>
        </div>

        <ChangePasswordButton email={me?.user?.email} className="btn actionBtn" />

        <div style={{ marginTop: 12 }}>
          <button className="btn actionBtn" onClick={handleLogout} style={{ width: "100%" }}>
            Salir
          </button>
        </div>
      </aside>

      <main
        style={{
          marginLeft: sidebarOpen ? SIDEBAR_W : 0,
          transition: "margin-left 180ms ease",
        }}
      >
        <div className="container">
          <div
            className="topbar dashboard-topbar"
            style={{
              alignItems: "center",
            }}
          >
            <div className="brand">
              <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
            </div>

            <div className="topbarUserText">
              Estudiante ·{" "}
              {me?.profile?.name ??
                me?.profile?.full_name ??
                me?.user?.user_metadata?.full_name ??
                me?.user?.email ??
                "—"}
            </div>
          </div>

          {error && <div className="msgError">{error}</div>}

          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              alignItems: "stretch",
            }}
          >
            <section className="flatSection">
              <h2 className="sectionSubtitle">Resumen:</h2>

              <div
                className="yearRefreshRow"
                style={{
                  marginTop: 16,
                  alignItems: "flex-start",
                }}
              >
                <div className="yearSelectWrap">
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

                <button
                  type="button"
                  onClick={loadSummary}
                  className="btn actionBtn yearRefreshBtn"
                >
                  {summaryLoading ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              {blockedByYear && (
                <div style={{ marginTop: 8, color: "#b45309", fontWeight: 500, fontSize: 13 }}>
                  Sin notas para este año..
                </div>
              )}

              {!blockedByYear && (
                <div className="summaryCardsGrid" style={{ marginTop: 36 }}>
                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      Aprobadas
                    </div>
                    <div
                      className={`summaryCardBox ${passedActive ? "summaryCardBoxPassedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${passedActive ? "summaryCardValueLight" : ""}`}
                        style={{ color: "var(--text)" }}
                      >
                        {summaryStats ? passed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      Perdidas
                    </div>
                    <div
                      className={`summaryCardBox ${failedActive ? "summaryCardBoxFailedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${failedActive ? "summaryCardValueLight" : ""}`}
                        style={{ color: "var(--text)" }}
                      >
                        {summaryStats ? failed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      Promedio
                    </div>
                    <div className="summaryCardBox">
                      <span
                        className="summaryCardValue"
                        style={{
                          color: gradeTextColor(summaryStats?.avg_weighted ?? null),
                        }}
                      >
                        {summaryStats?.avg_weighted === null || !summaryStats
                          ? "—"
                          : summaryStats.avg_weighted.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="flatSection">
              <div style={{ position: "relative" }}>
                {openSug && (suggestions.length > 0 || loadingSug) && (
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      left: 0,
                      right: 0,
                      top: 12,
                      border: "1px solid var(--stroke2)",
                      borderRadius: 16,
                      overflow: "hidden",
                      boxShadow: "0 18px 45px rgba(2,132,199,.10)",
                      background: "var(--card)",
                      color: "var(--text)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                    }}
                  ></div>
                )}
              </div>

              {blockedByYear ? (
                <div style={{ marginTop: 18, color: "var(--muted)", fontWeight: 500 }}></div>
              ) : (
                <>
                  {!selectedClass && (
                    <div style={{ marginTop: -10 }}>
                      <div
                        className="fit-table-shell-flat"
                        style={{
                          background: "transparent",
                          border: "none",
                          borderRadius: 0,
                          boxShadow: "none",
                          overflow: "visible",
                          padding: 0,
                        }}
                      >
                        <table
                          className="teacher-solid-table fit-table"
                          style={{
                            background: "transparent",
                            borderCollapse: "collapse",
                            boxShadow: "none",
                            borderRadius: 0,
                            overflow: "visible",
                          }}
                        >
                          <colgroup>
                            <col style={{ width: "56%" }} />
                            <col style={{ width: "20%" }} />
                            <col style={{ width: "24%" }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: "transparent" }}>
                              <th
                                className="fit-th fit-wrap"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Materia
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Nota final
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              ></th>
                            </tr>
                          </thead>
                          <tbody>
                            {summaryLoading ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={3}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  Cargando materias...
                                </td>
                              </tr>
                            ) : summaryItems.length === 0 ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={3}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  No hay materias registradas para este año todavía.
                                </td>
                              </tr>
                            ) : (
                              summaryItems.map((s) => (
                                <tr key={s.class_id} className="table-row-hover">
                                  <td
                                    className="fit-td fit-wrap"
                                    style={{ fontWeight: 500, color: "var(--text)" }}
                                  >
                                    {s.name}
                                  </td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 600,
                                      color:
                                        s.weighted === null
                                          ? "var(--text)"
                                          : gradeTextColor(s.weighted),
                                    }}
                                  >
                                    {s.weighted === null ? "-" : s.weighted.toFixed(2)}
                                  </td>

                                  <td className="fit-td fit-num">
                                    <button
                                      type="button"
                                      onClick={() => handleConsult({ id: s.class_id, name: s.name })}
                                      className="btn actionBtn fit-btn"
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
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 18,
                          alignItems: "flex-end",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div className="label" style={{ fontWeight: 500 }}>
                            Materia
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text)" }}>
                            {selectedClass.name}
                          </div>
                        </div>
                      </div>

                      <div
                        className="fit-table-shell-flat"
                        style={{
                          background: "transparent",
                          border: "none",
                          borderRadius: 0,
                          boxShadow: "none",
                          overflow: "visible",
                          padding: 0,
                          marginTop: 8,
                        }}
                      >
                        <table
                          className="teacher-solid-table fit-table"
                          style={{
                            background: "transparent",
                            borderCollapse: "collapse",
                            boxShadow: "none",
                            borderRadius: 0,
                            overflow: "visible",
                          }}
                        >
                          <colgroup>
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "34%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "22%" }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: "transparent" }}>
                              <th
                                className="fit-th fit-wrap fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Tipo
                              </th>
                              <th
                                className="fit-th fit-wrap fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Evaluación
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                %
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Nota
                              </th>
                              <th
                                className="fit-th fit-date fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                Fecha
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {loadingGrades ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={5}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  Cargando evaluaciones...
                                </td>
                              </tr>
                            ) : items.length === 0 ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={5}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  No hay evaluaciones/notas para esta materia en este año.
                                </td>
                              </tr>
                            ) : (
                              items.map((it) => (
                                <tr key={it.exam_id} className="table-row-hover">
                                  <td
                                    className="fit-td fit-wrap"
                                    style={{ fontWeight: 500, color: "var(--text)" }}
                                  >
                                    {it.type}
                                  </td>

                                  <td
                                    className="fit-td fit-wrap"
                                    style={{ fontWeight: 600, color: "var(--text)" }}
                                  >
                                    {it.title}
                                  </td>

                                  <td className="fit-td fit-num" style={{ color: "var(--text)" }}>
                                    {Number(it.percent).toFixed(0)}%
                                  </td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 700,
                                      color: gradeTextColor(it.grade),
                                    }}
                                  >
                                    {it.grade === null ? "—" : Number(it.grade).toFixed(2)}
                                  </td>

                                  <td className="fit-td fit-date" style={{ color: "var(--text)" }}>
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

                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClass(null);
                            setQ("");
                            setItems([]);
                            setWeighted(null);
                            loadSummary();
                          }}
                          className="btn actionBtn yearRefreshBtn"
                        >
                          Volver
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}