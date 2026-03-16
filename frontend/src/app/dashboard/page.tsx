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

  const totalPF = passed + failed;
  const passPct = totalPF > 0 ? Math.round((passed / totalPF) * 100) : 0;
  const failPct = totalPF > 0 ? Math.round((failed / totalPF) * 100) : 0;

  const fixedCourseName = useMemo(() => {
    return studentCourseFixed?.name ?? "—";
  }, [studentCourseFixed]);

  if (meLoading) return <div className="container">Cargando...</div>;

  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;
  const topbarLeftPad = sidebarOpen ? 18 : 58;

  const summaryGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    marginTop: 12,
    alignItems: "stretch",
  };

  const summaryBoxBase: React.CSSProperties = {
    borderRadius: 18,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  };

  return (
    <div>
      <style jsx>{`
        .teacher-solid-table {
          --table-head-bg: #0f172a;
          --table-head-text: #ffffff;
          --table-row-hover-bg: rgba(14, 165, 233, 0.08);
        }

        :global(html.dark) .teacher-solid-table,
        :global(html[data-theme="dark"]) .teacher-solid-table {
          --table-head-bg: #111827;
          --table-head-text: #f8fafc;
          --table-row-hover-bg: rgba(59, 130, 246, 0.12);
        }

        @media (prefers-color-scheme: dark) {
          .teacher-solid-table {
            --table-head-bg: #111827;
            --table-head-text: #f8fafc;
            --table-row-hover-bg: rgba(59, 130, 246, 0.12);
          }
        }

        .teacher-solid-table thead,
        .teacher-solid-table thead tr,
        .teacher-solid-table thead th {
          background-color: var(--table-head-bg) !important;
          background-image: none !important;
          color: var(--table-head-text) !important;
          opacity: 1 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        .teacher-solid-table tbody tr.table-row-hover > td {
          transition: background-color 120ms ease;
          line-height: 1.15;
        }

        .teacher-solid-table tbody tr.table-row-hover:hover > td {
          background-color: var(--table-row-hover-bg) !important;
        }

        .fit-table-shell {
          margin-top: 12px;
          overflow-x: hidden;
          border-radius: 18px;
          border: 1px solid var(--stroke);
          background: var(--card);
        }

        .fit-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        .fit-th,
        .fit-td {
          padding: 8px 10px;
          border-bottom: 1px solid var(--stroke);
          font-size: 13px;
          line-height: 1.15;
          vertical-align: middle;
          min-width: 0;
        }

        .fit-th {
          text-align: left;
        }

        .fit-wrap {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
        }

        .fit-num {
          white-space: nowrap;
          text-align: center;
        }

        .fit-date {
          white-space: normal;
          word-break: break-word;
          text-align: center;
        }

        .fit-btn {
          width: 100%;
          margin-top: 0;
          padding: 6px 10px;
          min-height: 30px;
          line-height: 1;
          font-size: 12px;
        }

        .summaryCardInner {
          position: relative;
          width: 100%;
          padding: 8px 10px;
          min-width: 0;
        }

        .summaryTitle {
          font-size: 12px;
          font-weight: 800;
          line-height: 1.05;
          word-break: break-word;
        }

        .summaryValue {
          font-size: 22px;
          font-weight: 900;
          line-height: 1;
          margin-top: 3px;
          word-break: break-word;
        }

        .summaryMeta {
          margin-top: 3px;
          color: var(--muted);
          font-size: 9px;
          line-height: 1.05;
          word-break: break-word;
        }

        .dashboard-topbar {
          flex-wrap: wrap;
          row-gap: 10px;
        }

        .dashboard-topbar .brand {
          min-width: 0;
          max-width: 100%;
        }

        .dashboard-topbar .brand > div:first-child {
          white-space: normal;
          word-break: normal;
          overflow-wrap: normal;
        }

        @media (max-width: 768px) {
          .fit-table {
            table-layout: fixed;
          }

          .fit-th,
          .fit-td {
            padding: 6px 4px;
            font-size: 11px;
            line-height: 1.05;
          }

          .fit-btn {
            padding: 5px 4px;
            min-height: 28px;
            font-size: 10px;
          }

          .fit-tight {
            letter-spacing: -0.01em;
          }

          .summaryCardInner {
            padding: 6px 7px;
          }

          .summaryTitle {
            font-size: 9px;
            line-height: 1;
          }

          .summaryValue {
            font-size: 15px;
            line-height: 1;
            margin-top: 2px;
          }

          .summaryMeta {
            font-size: 7px;
            line-height: 1;
            margin-top: 2px;
          }

          .dashboard-topbar {
            padding-left: 58px !important;
          }

          .dashboard-topbar .brand {
            flex: 1 1 100%;
          }

          .dashboard-topbar .brand > div:first-child {
            font-size: 15px !important;
            line-height: 1.05;
          }

          .dashboard-topbar .brand > div:last-child {
            font-size: 12px !important;
            line-height: 1.15;
          }
        }
      `}</style>

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

        <div style={{ marginTop: 10, marginBottom: 20 }}>
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
              paddingLeft: topbarLeftPad,
            }}
          >
            <div className="brand">
              <div style={{ fontWeight: 900, fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="btnLight">Estudiante · {me?.user?.email}</div>
            </div>
          </div>

          {error && <div className="msgError">{error}</div>}

          <div
            style={{
              marginTop: 18,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              alignItems: "stretch",
            }}
          >
            <div className="card">
              <h2 style={{ marginTop: 6 }}>
                Resumen del año <span style={{ fontSize: "0.7em" }}>(Materias)</span>
              </h2>

              {blockedByYear ? (
                <div style={{ marginTop: 12, color: "var(--muted)", fontWeight: 800 }}>
                  Sin notas para este año..
                </div>
              ) : (
                <div style={summaryGridStyle}>
                  <div
                    className="btnLight"
                    style={{
                      ...summaryBoxBase,
                      position: "relative",
                      overflow: "hidden",
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
                    <div className="summaryCardInner">
                      <div className="summaryTitle">Pasadas</div>
                      <div className="summaryValue">{summaryStats ? passed : "—"}</div>
                    </div>
                  </div>

                  <div
                    className="btnLight"
                    style={{
                      ...summaryBoxBase,
                      position: "relative",
                      overflow: "hidden",
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
                    <div className="summaryCardInner">
                      <div className="summaryTitle">Perdidas</div>
                      <div className="summaryValue">{summaryStats ? failed : "—"}</div>
                    </div>
                  </div>

                  <div
                    className="btnLight"
                    style={{
                      ...summaryBoxBase,
                      border: "1px solid var(--stroke)",
                    }}
                  >
                    <div className="summaryCardInner">
                      <div className="summaryTitle">Promedio</div>
                      <div
                        className="summaryValue"
                        style={{
                          color: gradeTextColor(summaryStats?.avg_weighted ?? null),
                        }}
                      >
                        {summaryStats?.avg_weighted === null || !summaryStats
                          ? "—"
                          : summaryStats.avg_weighted.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 12,
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h1 style={{ margin: "6px 0 6px", fontSize: 28, letterSpacing: "-0.02em" }}>
                  Consultar notas
                </h1>

                <button type="button" onClick={loadSummary} className="btnLight">
                  {summaryLoading ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 1fr 160px",
                  gap: 12,
                }}
              >
                <div>
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
                      Sin notas para este año..
                    </div>
                  )}
                </div>

                <div style={{ position: "relative" }}>
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
                    ></div>
                  )}
                </div>
              </div>

              {blockedByYear ? (
                <div style={{ marginTop: 18, color: "var(--muted)", fontWeight: 800 }}>
                  Sin notas para este año..
                </div>
              ) : (
                <>
                  {!selectedClass && (
                    <div style={{ marginTop: 18 }}>
                      <div className="fit-table-shell">
                        <table className="teacher-solid-table fit-table">
                          <colgroup>
                            <col style={{ width: "56%" }} />
                            <col style={{ width: "20%" }} />
                            <col style={{ width: "24%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="fit-th fit-wrap">Materia</th>
                              <th className="fit-th fit-num fit-tight">Nota final</th>
                              <th className="fit-th fit-num fit-tight">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summaryLoading ? (
                              <tr className="table-row-hover">
                                <td colSpan={3} className="fit-td fit-wrap" style={{ color: "var(--muted)" }}>
                                  Cargando materias...
                                </td>
                              </tr>
                            ) : summaryItems.length === 0 ? (
                              <tr className="table-row-hover">
                                <td colSpan={3} className="fit-td fit-wrap" style={{ color: "var(--muted)" }}>
                                  No hay materias/evaluaciones registradas para este año todavía.
                                </td>
                              </tr>
                            ) : (
                              summaryItems.map((s) => (
                                <tr key={s.class_id} className="table-row-hover">
                                  <td className="fit-td fit-wrap" style={{ fontWeight: 600 }}>
                                    {s.name}
                                  </td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 700,
                                      color: gradeTextColor(s.weighted),
                                    }}
                                  >
                                    {s.weighted === null ? "—" : s.weighted.toFixed(2)}
                                  </td>

                                  <td className="fit-td fit-num">
                                    <button
                                      type="button"
                                      onClick={() => handleConsult({ id: s.class_id, name: s.name })}
                                      className="btn fit-btn"
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
                          flexWrap: "wrap",
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

                      <div className="fit-table-shell">
                        <table className="teacher-solid-table fit-table">
                          <colgroup>
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "34%" }} />
                            <col style={{ width: "8%" }} />
                            <col style={{ width: "18%" }} />
                            <col style={{ width: "22%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="fit-th fit-wrap fit-tight">Tipo</th>
                              <th className="fit-th fit-wrap fit-tight">Evaluación</th>
                              <th className="fit-th fit-num fit-tight">%</th>
                              <th className="fit-th fit-num fit-tight">Nota</th>
                              <th className="fit-th fit-date fit-tight">Fecha</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loadingGrades ? (
                              <tr className="table-row-hover">
                                <td colSpan={5} className="fit-td fit-wrap" style={{ color: "var(--muted)" }}>
                                  Cargando evaluaciones...
                                </td>
                              </tr>
                            ) : items.length === 0 ? (
                              <tr className="table-row-hover">
                                <td colSpan={5} className="fit-td fit-wrap" style={{ color: "var(--muted)" }}>
                                  No hay evaluaciones/notas para esta materia en este año.
                                </td>
                              </tr>
                            ) : (
                              items.map((it) => (
                                <tr key={it.exam_id} className="table-row-hover">
                                  <td className="fit-td fit-wrap" style={{ fontWeight: 700 }}>
                                    {it.type}
                                  </td>

                                  <td className="fit-td fit-wrap" style={{ fontWeight: 900 }}>
                                    {it.title}
                                  </td>

                                  <td className="fit-td fit-num">
                                    {Number(it.percent).toFixed(0)}%
                                  </td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 900,
                                      color: gradeTextColor(it.grade),
                                    }}
                                  >
                                    {it.grade === null ? "—" : Number(it.grade).toFixed(2)}
                                  </td>

                                  <td className="fit-td fit-date">
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
          </div>
        </div>
      </main>

      <Footer rightText="Desarrollado para la Iglesia La Promesa." />
    </div>
  );
}