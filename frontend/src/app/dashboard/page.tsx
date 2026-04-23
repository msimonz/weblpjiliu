"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import TomarExamen, { type ExamAvailableItem } from "./TomarExamen";
import VerExamen from "./VerExamen";

type ClassItem = { id: number; name: string; level: number };

type CourseItem = { id: number; name: number; level: number; year: number };

type AnioLectivoItem = { year: number; nombre: string; activo: boolean };

type GradeItem = {
  exam_id: number;
  type: string | null;
  title: string;
  percent: number;
  grade: number | null;
  finished_at: string | null;
  attempts: number | null;
  fecha_fin: string | null;
  fecha_limite_ver: string | null;
};

type SummaryItem = {
  class_id: number;
  name: string;
  module_name: string | null;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [me, setMe] = useState<any>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string>("");

  const [level, setLevel] = useState<number>(1);

  const [studentCourses, setStudentCourses] = useState<CourseItem[]>([]);
  const [anioLectivoItems, setAnioLectivoItems] = useState<AnioLectivoItem[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const studentCourseFixed = useMemo(() => me?.course ?? null, [me]);

  const studentLevelFixed = useMemo(() => {
    const lvl = Number(studentCourseFixed?.level);
    return Number.isFinite(lvl) && lvl > 0 ? lvl : null;
  }, [studentCourseFixed]);

  // Courses filtered by selected year (for multi-year history)
  const coursesForYear = useMemo(() =>
    selectedYear != null
      ? studentCourses.filter(c => Number(c.year) === selectedYear)
      : studentCourses,
    [studentCourses, selectedYear]
  );

  const availableLevels = useMemo(() =>
    coursesForYear
      .map(c => ({ value: Number(c.level), label: LEVELS.find(l => l.value === Number(c.level))?.label ?? `Nivel ${c.level}` }))
      .sort((a, b) => a.value - b.value),
    [coursesForYear]
  );

  const selectedCourseForLevel = useMemo(() =>
    coursesForYear.find(c => Number(c.level) === level) ?? null,
    [coursesForYear, level]
  );

  const courseId = useMemo(() => selectedCourseForLevel?.id ?? null, [selectedCourseForLevel]);

  const activoYear = useMemo(() => anioLectivoItems.find(a => a.activo)?.year ?? null, [anioLectivoItems]);
  const isHistoricalYear = selectedYear !== null && activoYear !== null && selectedYear !== activoYear;

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<ClassItem[]>([]);
  const [openSug, setOpenSug] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);

  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);

  const [loadingGrades, setLoadingGrades] = useState(false);
  const [items, setItems] = useState<GradeItem[]>([]);
  const [, setWeighted] = useState<number | null>(null);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryItems, setSummaryItems] = useState<SummaryItem[]>([]);
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);

  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Exámenes disponibles ────────────────────────────────────────────────────
  const [examAvailable, setExamAvailable]     = useState<ExamAvailableItem[]>([]);
  const [tomarExamenInfo, setTomarExamenInfo] = useState<ExamAvailableItem | null>(null);
  const [verExamenInfo, setVerExamenInfo]     = useState<ExamAvailableItem | null>(null);
  const [verExamenEvalId, setVerExamenEvalId] = useState<number | null>(null);
  const [examLinkMsg, setExamLinkMsg]         = useState<string | null>(null);

  useEffect(() => {
    const { data: logoData } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(logoData.publicUrl);
  }, []);

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
    if (meLoading) return;
    apiFetch("/api/student/my-courses")
      .then((res) => setStudentCourses(res?.items || []))
      .catch(() => setStudentCourses([]));
  }, [meLoading]);

  useEffect(() => {
    if (meLoading) return;
    apiFetch("/api/student/anio-lectivo")
      .then((res) => {
        const items: AnioLectivoItem[] = res?.items || [];
        setAnioLectivoItems(items);
        const activo = items.find(i => i.activo);
        if (activo) setSelectedYear(activo.year);
      })
      .catch(() => {});
  }, [meLoading]);

  // T25 — cargar exámenes disponibles para el curso del estudiante
  useEffect(() => {
    if (meLoading) return;
    apiFetch("/api/student/exam-available")
      .then((r) => setExamAvailable(r?.items || []))
      .catch(() => setExamAvailable([]));
  }, [meLoading]);

  useEffect(() => {
    setSelectedClass(null);
    setQ("");
    setSuggestions([]);
    setOpenSug(false);
    setItems([]);
    setWeighted(null);
    setError(null);
  }, [level]);

  useEffect(() => {
    setSelectedClass(null);
    setQ("");
    setSuggestions([]);
    setOpenSug(false);
    setItems([]);
    setWeighted(null);
    setError(null);
    setSummaryItems([]);
    setSummaryStats(null);
    // loadSummary runs via the courseId effect; if courseId didn't change, run it explicitly
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  async function loadSummary() {
    if (!courseId) return;
    setError(null);
    setSummaryLoading(true);
    try {
      const res = await apiFetch(`/api/student/subjects-summary?course_id=${courseId}`);
      setSummaryItems(res?.items || []);
      setSummaryStats(res?.stats || null);
    } catch (e: unknown) {
      setSummaryItems([]);
      setSummaryStats(null);
      setError((e instanceof Error ? e.message : null) || "Error cargando resumen");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } catch (e) {
        setError((e as { message?: string })?.message || "Error buscando materias");
      } finally {
        setLoadingSug(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, level]);

  function _pickClass(c: ClassItem) {
    setSelectedClass(c);
    setQ(c.name);
    setOpenSug(false);
  }

  async function handleConsult(classOverride?: { id: number; name: string }) {
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
      const url = `/api/student/grades?class_id=${classId}${courseId ? `&course_id=${courseId}` : ""}`;
      const res = await apiFetch(url);
      setItems(res?.items || []);
      setWeighted(typeof res?.weighted === "number" ? res.weighted : null);
    } catch (e) {
      setError((e as { message?: string })?.message || "Error consultando notas");
    } finally {
      setLoadingGrades(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // T26 — mapa class_id → examen disponible (solo los no rendidos muestran botón naranja)
  const examByClassId = useMemo(() => {
    const m = new Map<number, ExamAvailableItem[]>();
    for (const ex of examAvailable) {
      if (ex.class_id) {
        const arr = m.get(ex.class_id) ?? [];
        arr.push(ex);
        m.set(ex.class_id, arr);
      }
    }
    return m;
  }, [examAvailable]);

  // Orden: 1) con nota  2) con examen activo sin rendir  3) resto — alfabético dentro de cada grupo
  const sortedSummaryItems = useMemo(() => {
    return [...summaryItems].sort((a, b) => {
      const aGrade = a.weighted !== null;
      const bGrade = b.weighted !== null;
      const aExam  = !aGrade && (examByClassId.get(a.class_id)?.some(e => !e.ya_rendido) ?? false);
      const bExam  = !bGrade && (examByClassId.get(b.class_id)?.some(e => !e.ya_rendido) ?? false);

      const rank = (hasGrade: boolean, hasExam: boolean) =>
        hasGrade ? 0 : hasExam ? 1 : 2;

      const diff = rank(aGrade, aExam) - rank(bGrade, bExam);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    });
  }, [summaryItems, examByClassId]);

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
          onClick={() => setSidebarOpen((v) => !v)}
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
          <div style={{ fontWeight: 600 }}>{roleLabelFromRole(getActiveRole(me))}</div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt="logo"
                    style={{ width: 34, height: 34, objectFit: "contain", borderRadius: 999 }}
                  />
                )}
                <div>
                  <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
                  <div style={{ color: "var(--muted)" }}>Notas y asignaciones</div>
                </div>
              </div>
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

              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 12,
                  width: "100%",
                }}
              >
                <div style={{ flex: "0 0 50%", minWidth: 0 }}>
                  <div className="label" style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>Nivel</div>
                  <select
                    className="select"
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value))}
                    disabled={availableLevels.length === 0}
                    style={{ width: "100%", fontWeight: 700 }}
                  >
                    {availableLevels.length === 0
                      ? <option value={level}>{LEVELS.find(l => l.value === level)?.label ?? `Nivel ${level}`}</option>
                      : availableLevels.map((x) => (
                          <option key={x.value} value={x.value}>{x.label}</option>
                        ))
                    }
                  </select>
                </div>

                <div style={{ flex: "0 0 calc(25% - 8px)", minWidth: 0 }}>
                  <div className="label" style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>Curso</div>
                  <div
                    className="select"
                    style={{ width: "100%", display: "flex", alignItems: "center", cursor: "default", userSelect: "none", fontWeight: 700 }}
                  >
                    {selectedCourseForLevel?.name ?? "—"}
                  </div>
                </div>

                <div style={{ flex: "0 0 calc(25% - 8px)", minWidth: 0 }}>
                  <div className="label" style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>Año Lectivo</div>
                  <select
                    className="select"
                    value={selectedYear ?? ""}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    disabled={anioLectivoItems.length === 0}
                    style={{ width: "100%", fontWeight: 700 }}
                  >
                    {anioLectivoItems.length === 0
                      ? <option value="">{selectedCourseForLevel?.year ?? "—"}</option>
                      : anioLectivoItems.map(a => (
                          <option key={a.year} value={a.year}>{a.year}</option>
                        ))
                    }
                  </select>
                </div>
              </div>

              {isHistoricalYear && (
                <div style={{ marginTop: 12, padding: "6px 12px", background: "color-mix(in srgb, orange 12%, var(--card) 88%)", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "var(--text)", display: "inline-block" }}>
                  Histórico — {selectedYear}
                </div>
              )}
              {isHistoricalYear && coursesForYear.length === 0 && (
                <div style={{ marginTop: 12, fontSize: 14, color: "var(--text-muted, #6b7280)" }}>
                  No hay datos para el año {selectedYear}.
                </div>
              )}

              <div className="summaryCardsGrid" style={{ marginTop: 28 }}>
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
                      No Aprobadas
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
                            <col style={{ width: "22%" }} />
                            <col style={{ width: "38%" }} />
                            <col style={{ width: "16%" }} />
                            <col style={{ width: "24%" }} />
                          </colgroup>
                          <thead>
                            <tr style={{ background: "transparent" }}>
                              <th
                                className="fit-th fit-wrap fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                <b>Módulo</b>
                              </th>
                              <th
                                className="fit-th fit-wrap"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                <b>Materia</b>
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ background: "transparent", color: "#000" }}
                              >
                                <b>Nota final</b>
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
                                  colSpan={4}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  Cargando materias...
                                </td>
                              </tr>
                            ) : sortedSummaryItems.length === 0 ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={4}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  No hay materias registradas para este año todavía.
                                </td>
                              </tr>
                            ) : (
                              sortedSummaryItems.map((s) => (
                                <tr key={s.class_id} className="table-row-hover">
                                  <td
                                    className="fit-td fit-wrap"
                                    style={{ color: "var(--muted)", fontSize: 11 }}
                                  >
                                    {s.module_name ?? "—"}
                                  </td>

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
                                    {/* T26/T27 — botón naranja si hay examen activo y no rendido */}
                                    {(() => {
                                      if (!isHistoricalYear) {
                                        const avList = examByClassId.get(s.class_id) ?? [];
                                        const av = avList.find(e => !e.ya_rendido);
                                        if (av) {
                                          return (
                                            <button
                                              type="button"
                                              className="btn fit-btn"
                                              style={{
                                                background: "linear-gradient(180deg,#fb923c 0%,#f97316 100%)",
                                                color: "#fff",
                                                border: "1px solid rgba(251,146,60,.82)",
                                                boxShadow: "0 4px 12px rgba(249,115,22,.3)",
                                                whiteSpace: "nowrap",
                                              }}
                                              onClick={() => setTomarExamenInfo(av)}
                                            >
                                              Tomar Examen
                                            </button>
                                          );
                                        }
                                      }
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => handleConsult({ id: s.class_id, name: s.name })}
                                          className="btn actionBtn fit-btn"
                                        >
                                          Detalle
                                        </button>
                                      );
                                    })()}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedClass && (() => {
                    // Construye ExamAvailableItem para abrir VerExamen
                    const buildExamInfo = (examId: number): ExamAvailableItem => {
                      const fromAvailable = (examByClassId.get(selectedClass.id) ?? [])
                        .find(av => av.id_evaluation === examId);
                      if (fromAvailable) return fromAvailable;
                      const it = items.find(i => i.exam_id === examId)!;
                      return {
                        id_programacion: 0,
                        id_evaluation: examId,
                        title: it.title,
                        tiempo_minutos: null,
                        class_id: selectedClass.id,
                        class_name: selectedClass.name,
                        module_name: null,
                        fecha_ini: "",
                        fecha_fin: "",
                        fecha_limite_ver: null,
                        ya_rendido: true,
                        finalizado_at: it.finished_at,
                      };
                    };
                    return (
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
                              items.map((it) => {
                                const isExamenRendido = it.type === "Examen" && (it.attempts ?? 0) > 0 && !!it.finished_at;
                                async function handleVerExamenClick() {
                                  const MESES = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
                                  let fecha_fin: string | null = it.fecha_fin ?? null;
                                  let fecha_limite_ver: string | null = it.fecha_limite_ver ?? null;
                                  try {
                                    const sched = await apiFetch(`/api/student/exam/${it.exam_id}/schedule`);
                                    fecha_fin        = sched.fecha_fin        ?? null;
                                    fecha_limite_ver = sched.fecha_limite_ver ?? null;
                                  } catch { /* usa caché si falla */ }

                                  const fmtCol = (iso: string) => {
                                    const d = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "America/Bogota" }));
                                    const hh = d.getHours(), mm = d.getMinutes();
                                    return `${String(d.getDate()).padStart(2,"0")}-${MESES[d.getMonth()]}-${d.getFullYear()} ${String(hh % 12 || 12).padStart(2,"0")}:${String(mm).padStart(2,"0")}${hh < 12 ? "am" : "pm"}`;
                                  };

                                  const ts  = Date.now();
                                  const enVentana = isExamenRendido &&
                                    !!fecha_fin && !!fecha_limite_ver &&
                                    ts > new Date(fecha_fin).getTime() &&
                                    ts <= new Date(fecha_limite_ver).getTime();

                                  if (enVentana) {
                                    setExamLinkMsg(null);
                                    const info = buildExamInfo(it.exam_id);
                                    setVerExamenInfo(info);
                                    setVerExamenEvalId(it.exam_id);
                                  } else {
                                    let msg: string;
                                    if (!fecha_limite_ver) {
                                      msg = "Este examen no tiene período de revisión habilitado.";
                                    } else if (fecha_fin && ts <= new Date(fecha_fin).getTime()) {
                                      msg = `El examen aún está en curso. Podrás revisarlo a partir del:\n${fmtCol(fecha_fin)}`;
                                    } else if (ts > new Date(fecha_limite_ver).getTime()) {
                                      msg = `El período de revisión se cerró el:\n${fmtCol(fecha_limite_ver)}`;
                                    } else {
                                      msg = "No puedes revisar este examen en este momento.";
                                    }
                                    setExamLinkMsg(msg);
                                  }
                                }

                                return (
                                  <tr key={it.exam_id} className="table-row-hover">
                                    <td
                                      className="fit-td fit-wrap"
                                      style={{ fontWeight: 500, color: "var(--text)" }}
                                    >
                                      {it.type}
                                    </td>

                                    <td
                                      className="fit-td fit-wrap"
                                      style={{ fontWeight: 600 }}
                                    >
                                      {isExamenRendido && !isHistoricalYear ? (
                                        <button
                                          type="button"
                                          onClick={handleVerExamenClick}
                                          style={{
                                            background: "none", border: "none", padding: 0,
                                            color: "#3b82f6", textDecoration: "underline",
                                            cursor: "pointer", fontWeight: 400, fontSize: "inherit",
                                            textAlign: "left",
                                          }}
                                        >
                                          {it.title}
                                        </button>
                                      ) : (
                                        <span style={{ color: "var(--text)" }}>{it.title}</span>
                                      )}
                                    </td>

                                    <td className="fit-td fit-num" style={{ color: "var(--text)" }}>
                                      {Number(it.percent).toFixed(0)}%
                                    </td>

                                    <td
                                      className="fit-td fit-num"
                                      style={{
                                        fontWeight: 700,
                                        color: it.attempts === 0 ? "inherit" : gradeTextColor(it.grade),
                                      }}
                                    >
                                      {it.attempts === 0 ? (
                                        <span
                                          style={{
                                            display: "inline-block",
                                            padding: "2px 4px",
                                            borderRadius: 4,
                                            fontSize: 10,
                                            fontWeight: 700,
                                            letterSpacing: 0.3,
                                            background: "rgba(239,68,68,0.1)",
                                            color: "#dc2626",
                                            border: "1px solid rgba(239,68,68,0.25)",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          No Presentó
                                        </span>
                                      ) : it.grade === null ? "—" : Number(it.grade).toFixed(2)}
                                    </td>

                                    <td className="fit-td fit-date" style={{ color: "var(--text)" }}>
                                      {it.finished_at
                                        ? new Date(it.finished_at).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 10,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const openClassId = selectedClass?.id ?? null;
                            setSelectedClass(null);
                            setQ("");
                            setItems([]);
                            setWeighted(null);
                            setExamLinkMsg(null);
                            loadSummary();
                            apiFetch("/api/student/exam-available")
                              .then((r) => setExamAvailable(r?.items || []))
                              .catch(() => {});
                            if (openClassId) {
                              apiFetch(`/api/student/grades?class_id=${openClassId}${courseId ? `&course_id=${courseId}` : ""}`)
                                .then((r) => { setItems(r?.items || []); setWeighted(typeof r?.weighted === "number" ? r.weighted : null); })
                                .catch(() => {});
                            }
                          }}
                          className="btn yearRefreshBtn"
                          style={{
                            background: "linear-gradient(180deg,#fb923c 0%,#f97316 100%)",
                            color: "#ffffff",
                            border: "1px solid rgba(251,146,60,.82)",
                            boxShadow: "0 10px 24px rgba(249,115,22,.22)",
                            fontSize: 20,
                            fontWeight: 700,
                            gap: 6,
                          }}
                        >
                          <span>⬅</span><span style={{ fontSize: 14, fontWeight: 400 }}>Volver</span>
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                </>
            </section>
          </div>
        </div>
      </main>

      {/* T27 — Overlay TomarExamen */}
      {tomarExamenInfo && (
        <TomarExamen
          examInfo={tomarExamenInfo}
          me={me}
          onClose={(submitted) => {
            setTomarExamenInfo(null);
            if (submitted) {
              apiFetch("/api/student/exam-available")
                .then((r) => setExamAvailable(r?.items || []))
                .catch(() => {});
              loadSummary();
              if (selectedClass?.id) {
                apiFetch(`/api/student/grades?class_id=${selectedClass.id}${courseId ? `&course_id=${courseId}` : ""}`)
                  .then((r) => { setItems(r?.items || []); setWeighted(typeof r?.weighted === "number" ? r.weighted : null); })
                  .catch(() => {});
              }
            }
          }}
          onFinished={(id_evaluation) => {
            // Guardar contexto para VerExamen, cerrar TomarExamen
            setVerExamenInfo(tomarExamenInfo);
            setVerExamenEvalId(id_evaluation);
            setTomarExamenInfo(null);
          }}
        />
      )}

      {/* Modal mensaje Ver Examen fuera de ventana */}
      {examLinkMsg && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{ maxWidth: 360, width: "90%", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>ℹ️</div>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
              {examLinkMsg?.includes("\n") ? (
                <>
                  <span>{examLinkMsg.split("\n")[0]}</span>
                  <br />
                  <strong style={{ color: "var(--text)", fontSize: 15, whiteSpace: "nowrap" }}>{examLinkMsg.split("\n")[1]}</strong>
                </>
              ) : examLinkMsg}
            </p>
            <button className="btn" style={{ padding: "10px 32px" }} onClick={() => setExamLinkMsg(null)}>
              Aceptar
            </button>
          </div>
        </div>
      )}

      {/* T34-T37 — Overlay VerExamen */}
      {verExamenInfo && verExamenEvalId && (
        <VerExamen
          id_evaluation={verExamenEvalId}
          examInfo={verExamenInfo}
          me={me}
          onClose={() => {
            // T38 — Bloque 9: refrescar al regresar
            setVerExamenInfo(null);
            setVerExamenEvalId(null);
            apiFetch("/api/student/exam-available")
              .then((r) => setExamAvailable(r?.items || []))
              .catch(() => {});
            loadSummary();
            if (selectedClass?.id) {
              apiFetch(`/api/student/grades?class_id=${selectedClass.id}${courseId ? `&course_id=${courseId}` : ""}`)
                .then((r) => { setItems(r?.items || []); setWeighted(typeof r?.weighted === "number" ? r.weighted : null); })
                .catch(() => {});
            }
          }}
        />
      )}

      <Footer />
    </div>
  );
}