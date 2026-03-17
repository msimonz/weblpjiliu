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
  const topbarLeftPad = sidebarOpen ? 18 : 58;

  const passedActive = passed > 0;
  const failedActive = failed > 0;

  return (
    <div
      style={{
        fontFamily:
          '"Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
      }}
    >
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
          font-weight: 600 !important;
        }

        .teacher-solid-table tbody tr.table-row-hover > td {
          transition: background-color 120ms ease;
          line-height: 1.15;
          font-weight: 400;
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

        .fit-table-shell-flat {
          margin-top: 12px;
          overflow-x: hidden;
          border-radius: 0;
          border: 0;
          background: transparent;
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
          padding: 0 10px;
          height: 30px;
          min-height: 30px;
          line-height: 1;
          font-size: 12px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .summaryHeadText {
          font-size: 15.5px !important;
          font-weight: 600 !important;
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
          font-weight: 700 !important;
        }

        .dashboard-topbar .brand > div:last-child {
          font-weight: 400;
        }

        .topbarUserText {
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.2;
          text-align: right;
          word-break: break-word;
        }

        .flatSection {
          padding: 0;
          margin: 0;
          background: transparent;
          border: 0;
          box-shadow: none;
        }

        .flatSection + .flatSection {
          margin-top: 24px;
        }

        .sectionTitle {
          margin: 0 0 8px;
          font-size: 20px;
          line-height: 1.05;
          letter-spacing: -0.01em;
          font-weight: 700;
        }

        .sectionSubtitle {
          margin: 0;
          font-size: 24px;
          line-height: 1.1;
          font-weight: 700;
        }

        .sectionMinor {
          margin-left: 4px;
          font-size: 0.7em;
          font-weight: 500;
        }

        .yearRefreshRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: stretch;
          margin-top: 10px;
        }

        .yearSelectWrap {
          min-width: 0;
          width: 100%;
        }

        .yearSelectWrap .select {
          width: 100%;
          min-width: 0;
          height: 30px;
          min-height: 30px;
          padding-top: 0;
          padding-bottom: 0;
          line-height: 1;
          font-weight: 400;
        }

        .yearRefreshBtn {
          white-space: nowrap;
          min-width: 118px;
          height: 30px;
          min-height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          align-self: center;
          margin: 0;
          padding: 0 12px;
          line-height: 1;
          font-size: 12px;
          font-weight: 600;
        }

        .summaryCardsGrid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          align-items: start;
        }

        .summaryCardItem {
          min-width: 0;
        }

        .summaryCardLabel {
          margin: 0 0 6px;
          text-align: center;
          font-size: 12px;
          line-height: 1.05;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
        }

        .summaryCardBox {
          width: 100%;
          height: 30px;
          min-height: 30px;
          border-radius: 14px;
          border: 1px solid var(--stroke);
          background: var(--card);
          box-shadow: var(--shadow);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 10px;
          box-sizing: border-box;
        }

        .summaryCardValue {
          font-size: 15.5px;
          line-height: 1;
          font-weight: 800;
        }

.summaryCardBoxPassedActive {
  background: linear-gradient(
    180deg,
    rgba(21, 128, 61, 0.3) 0%,
    rgba(22, 101, 52, 0.3) 100%
  );
  border-color: rgba(34, 197, 94, 0.5);
}

.summaryCardBoxFailedActive {
  background: linear-gradient(
    180deg,
    rgba(185, 28, 28, 0.3) 0%,
    rgba(127, 29, 29, 0.3) 100%
  );
  border-color: rgba(248, 113, 113, 0.5);
}

        .summaryCardValueLight {
          color: #ffffff;
        }

        .actionBtn {
          background: linear-gradient(180deg, #22c7ff 0%, #0ea5e9 100%) !important;
          color: #ffffff !important;
          border: 1px solid rgba(56, 189, 248, 0.82) !important;
          box-shadow: 0 10px 24px rgba(2, 132, 199, 0.22);
          transition:
            transform 120ms ease,
            filter 120ms ease,
            box-shadow 120ms ease,
            border-color 120ms ease;
          font-weight: 600 !important;
        }

        .actionBtn:hover {
          filter: brightness(1.05);
          box-shadow: 0 14px 30px rgba(2, 132, 199, 0.28);
          border-color: rgba(125, 211, 252, 0.95) !important;
        }

        .actionBtn:active {
          transform: translateY(1px);
        }

        .actionBtn:disabled {
          opacity: 0.72;
          cursor: not-allowed;
          transform: none;
          filter: none;
          box-shadow: 0 6px 16px rgba(2, 132, 199, 0.16);
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
            padding: 0 6px;
            height: 28px;
            min-height: 28px;
            font-size: 10px;
          }

          .fit-tight {
            letter-spacing: -0.01em;
          }

          .summaryHeadText {
            font-size: 12px !important;
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

          .topbarUserText {
            font-size: 12px;
            text-align: left;
          }

          .sectionTitle {
            font-size: 18px;
          }

          .sectionSubtitle {
            font-size: 20px;
          }

          .yearRefreshRow {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
          }

          .yearSelectWrap .select {
            height: 28px;
            min-height: 28px;
            font-size: 10px;
          }

          .yearRefreshBtn {
            min-width: 102px;
            height: 28px;
            min-height: 28px;
            padding: 0 10px;
            font-size: 10px;
          }

          .summaryCardsGrid {
            gap: 10px;
          }

          .summaryCardLabel {
            font-size: 11px;
            margin-bottom: 5px;
          }

          .summaryCardBox {
            height: 28px;
            min-height: 28px;
            border-radius: 12px;
            padding: 0 8px;
          }

          .summaryCardValue {
            font-size: 13px;
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
              paddingLeft: topbarLeftPad,
            }}
          >
            <div className="brand">
              <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
            </div>

            {/* <div className="topbarUserText">Estudiante · {me?.user?.email}</div> */}
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
              <h2 className="sectionSubtitle">
                Resumen del año <span className="sectionMinor">(Materias)</span>
              </h2>

              {blockedByYear ? (
                <div style={{ marginTop: 12, color: "var(--muted)", fontWeight: 500 }}>
                  Sin notas para este año..
                </div>
              ) : (
                <div className="summaryCardsGrid">
                  <div className="summaryCardItem">
                    <div className="summaryCardLabel">Pasadas</div>
                    <div
                      className={`summaryCardBox ${passedActive ? "summaryCardBoxPassedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${passedActive ? "summaryCardValueLight" : ""}`}
                      >
                        {summaryStats ? passed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel">Perdidas</div>
                    <div
                      className={`summaryCardBox ${failedActive ? "summaryCardBoxFailedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${failedActive ? "summaryCardValueLight" : ""}`}
                      >
                        {summaryStats ? failed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel">Promedio</div>
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
              <h1 className="sectionTitle">Consultar notas</h1>

              <div className="yearRefreshRow">
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

                  {blockedByYear && (
                    <div style={{ marginTop: 8, color: "#b45309", fontWeight: 500, fontSize: 13 }}>
                      Sin notas para este año..
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={loadSummary}
                  className="btn actionBtn yearRefreshBtn"
                >
                  {summaryLoading ? "Cargando..." : "Refrescar"}
                </button>
              </div>

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
                <div style={{ marginTop: 18, color: "var(--muted)", fontWeight: 500 }}>
                  Sin notas para este año..
                </div>
              ) : (
                <>
                  {!selectedClass && (
                    <div style={{ marginTop: 16 }}>
                      <div className="fit-table-shell-flat">
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
                              <th className="fit-th fit-num fit-tight"></th>
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
                                  No hay materias/evaluaciones registradas para este año todavía.
                                </td>
                              </tr>
                            ) : (
                              summaryItems.map((s) => (
                                <tr key={s.class_id} className="table-row-hover">
                                  <td className="fit-td fit-wrap" style={{ fontWeight: 500 }}>
                                    {s.name}
                                  </td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 600,
                                      color: gradeTextColor(s.weighted),
                                    }}
                                  >
                                    {s.weighted === null ? "—" : s.weighted.toFixed(2)}
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
                          <div style={{ fontWeight: 600, fontSize: 16 }}>{selectedClass.name}</div>
                        </div>
                      </div>

                      <div className="fit-table-shell-flat">
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
                                  <td className="fit-td fit-wrap" style={{ fontWeight: 500 }}>
                                    {it.type}
                                  </td>

                                  <td className="fit-td fit-wrap" style={{ fontWeight: 600 }}>
                                    {it.title}
                                  </td>

                                  <td className="fit-td fit-num">{Number(it.percent).toFixed(0)}%</td>

                                  <td
                                    className="fit-td fit-num"
                                    style={{
                                      fontWeight: 700,
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