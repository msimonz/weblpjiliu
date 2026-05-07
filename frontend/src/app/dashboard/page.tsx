"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch, setImpersonateToken } from "@/lib/api";
import { roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import AppVersionLabel from "@/components/AppVersionLabel";
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
  teacher_id?: string | null;
  teacher_name?: string | null;
};

type SummaryItem = {
  class_id: number;
  group_id: number | null;
  group_name: string | null;
  classes: Array<{ id: number; name: string; orden?: number | null }>;
  name: string;
  module_name: string | null;
  weighted: number | null;
  complete: boolean;
  totalEvals?: number;
  closedEvals?: number;
};

type SummaryStats = {
  passed: number;
  failed: number;
  pending: number;
  avg_weighted: number | null;
  pass_grade: number;
  absences: number;
};

type AbsenceItem = { fecha_clase: string; class_name: string };


const MESES_ABS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
function fmtAbsFecha(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${MESES_ABS[Number(m) - 1]}-${y}`;
}

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
  const [weighted, setWeighted] = useState<number | null>(null);
  const [weightedComplete, setWeightedComplete] = useState(false);
  const [detailTeacherName, setDetailTeacherName] = useState<string | null>(null);

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
  const [hoveredGroupId, setHoveredGroupId]   = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  // Pestañas
  const [activeTab, setActiveTab] = useState<"notas" | "inasistencias">("notas");

  // Inasistencias
  const [absItems,        setAbsItems]        = useState<AbsenceItem[]>([]);
  const [absLoading,      setAbsLoading]      = useState(false);
  const [absFilterFecha,  setAbsFilterFecha]  = useState("all");
  const [absFilterMateria,setAbsFilterMateria]= useState("all");

  useEffect(() => {
    const { data: logoData } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(logoData.publicUrl);
  }, []);

  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const params = new URLSearchParams(window.location.search);
        const impToken = params.get("impersonate");

        if (impToken) {
          setImpersonateToken(impToken);
          const info = await apiFetch("/api/auth/me");
          setMe(info);
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) return router.replace("/login");
          const info = await apiFetch("/api/auth/me");
          setMe(info);

          const activeRole = getActiveRole(info);
          if (activeRole !== "S") return router.replace(roleToRoute(activeRole));
        }
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
    setWeightedComplete(false);
    setDetailTeacherName(null);
    setError(null);
  }, [level]);

  useEffect(() => {
    setActiveTab("notas");
    setSelectedClass(null);
    setQ("");
    setSuggestions([]);
    setOpenSug(false);
    setItems([]);
    setWeighted(null);
    setWeightedComplete(false);
    setDetailTeacherName(null);
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

  async function handleConsult(classOverride?: { id: number; name: string; group_id?: number | null }) {
    const classId = classOverride?.id ?? selectedClass?.id;
    const groupId = classOverride?.group_id;
    if (!classId && !groupId) return;

    if (classOverride) {
      setSelectedClass({ id: classOverride.id, name: classOverride.name, level } as ClassItem);
      setSelectedGroupId(classOverride.group_id ?? null);
      setQ(classOverride.name);
      setOpenSug(false);
    }

    setError(null);
    setLoadingGrades(true);
    setDetailTeacherName(null);
    try {
      const scope = groupId ? `group_id=${groupId}` : `class_id=${classId}`;
      const url = `/api/student/grades?${scope}${courseId ? `&course_id=${courseId}` : ""}`;
      const res = await apiFetch(url);
      setItems(res?.items || []);
      setWeighted(typeof res?.weighted === "number" ? res.weighted : null);
      setWeightedComplete(Boolean(res?.complete));
      setDetailTeacherName(res?.teacher_name || null);
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

  useEffect(() => {
    if (!courseId) return;
    setAbsLoading(true);
    setAbsItems([]);
    setAbsFilterFecha("all");
    setAbsFilterMateria("all");
    apiFetch(`/api/student/absences?course_id=${courseId}`)
      .then((r: { items?: AbsenceItem[] }) => setAbsItems(r?.items || []))
      .catch(() => {})
      .finally(() => setAbsLoading(false));
  }, [courseId]);

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

  const examByGroupId = useMemo(() => {
    const m = new Map<number, ExamAvailableItem[]>();
    for (const ex of examAvailable) {
      if (ex.group_id) {
        const arr = m.get(ex.group_id) ?? [];
        arr.push(ex);
        m.set(ex.group_id, arr);
      }
    }
    return m;
  }, [examAvailable]);

  const hasGroups = useMemo(() => summaryItems.some(s => s.group_id !== null), [summaryItems]);

  // Orden: 1) examen disponible  2) con nota  3) sin nota — alfabético dentro de cada grupo
  const sortedSummaryItems = useMemo(() => {
    const cmp = (x: string | null, y: string | null) =>
      (x ?? "").localeCompare(y ?? "", "es", { sensitivity: "base" });
    const priority = (s: SummaryItem) => {
      const avList = s.group_id
        ? (examByGroupId.get(s.group_id) ?? [])
        : (examByClassId.get(s.class_id) ?? []);
      if (avList.some(e => !e.ya_rendido)) return 0;
      if (s.complete) return 1;
      if (s.weighted !== null) return 2;
      return 3;
    };
    return [...summaryItems].sort((a, b) => {
      const pa = priority(a), pb = priority(b);
      if (pa !== pb) return pa - pb;
      return cmp(a.module_name, b.module_name) || cmp(a.name, b.name);
    });
  }, [summaryItems, examByClassId, examByGroupId]);

  const PASS_GRADE = summaryStats?.pass_grade ?? 70;
  const gradeTextColor = (value: number | null) => {
    if (value === null) return "inherit";
    return value >= PASS_GRADE ? "var(--text)" : "rgb(185,28,28)";
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
        <AppVersionLabel
          style={{ display: "block", marginTop: 10, color: "var(--footer)", fontSize: 8, fontWeight: 700 }}
        />
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
              gap: 0,
              alignItems: "stretch",
            }}
          >
            <section className="flatSection" style={{ marginBottom: 12 }}>

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

              <div className="summaryCardsGrid" style={{ marginTop: 28, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      Aprobadas
                    </div>
                    <div
                      className={`summaryCardBox ${passedActive ? "summaryCardBoxPassedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${passedActive ? "summaryCardValueLight" : ""}`}
                        style={{ color: summaryStats ? "#166534" : "var(--text)" }}
                      >
                        {summaryStats ? passed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      No aprobadas
                    </div>
                    <div
                      className={`summaryCardBox ${failedActive ? "summaryCardBoxFailedActive" : ""}`}
                    >
                      <span
                        className={`summaryCardValue ${failedActive ? "summaryCardValueLight" : ""}`}
                        style={{ color: summaryStats ? "#b91c1c" : "var(--text)" }}
                      >
                        {summaryStats ? failed : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="summaryCardItem">
                    <div className="summaryCardLabel" style={{ color: "var(--text)" }}>
                      Promedio
                    </div>
                    {(() => {
                      const avg = summaryStats?.avg_weighted ?? null;
                      const avgPassed = summaryStats && avg !== null && avg >= PASS_GRADE;
                      const avgFailed = summaryStats && avg !== null && avg < PASS_GRADE;
                      return (
                        <div className={`summaryCardBox ${avgPassed ? "summaryCardBoxPassedActive" : avgFailed ? "summaryCardBoxFailedActive" : ""}`}>
                          <span
                            className={`summaryCardValue ${(avgPassed || avgFailed) ? "summaryCardValueLight" : ""}`}
                            style={{ color: avgPassed ? "#166534" : avgFailed ? "#b91c1c" : "var(--text)" }}
                          >
                            {avg === null || !summaryStats ? "—" : avg.toFixed(2)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
            </section>

            <div style={{ display: "flex", gap: 3, alignItems: "flex-end", paddingLeft: 2 }}>
              {(["notas", "inasistencias"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "6px 18px",
                    fontSize: 13,
                    fontWeight: activeTab === tab ? 700 : 500,
                    background: activeTab === tab
                      ? "var(--card)"
                      : "color-mix(in srgb, var(--stroke) 50%, var(--bg0))",
                    border: "1px solid var(--stroke)",
                    borderBottom: activeTab === tab ? "1px solid var(--card)" : undefined,
                    borderRadius: "8px 8px 0 0",
                    cursor: "pointer",
                    color: activeTab === tab ? "var(--text)" : "var(--muted)",
                    marginBottom: activeTab === tab ? "-1px" : 0,
                    position: "relative",
                    zIndex: activeTab === tab ? 2 : 1,
                  }}
                >
                  {tab === "notas" ? "Notas" : "Inasistencias"}
                </button>
              ))}
            </div>

            <section className="flatSection" style={{ position: "relative", zIndex: 1, borderTopLeftRadius: 0 }}>
              {activeTab === "notas" && (<>
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
                        className="fit-table-shell-flat student-summary-scroll"
                        style={{
                          background: "transparent",
                          border: "none",
                          borderRadius: 0,
                          boxShadow: "none",
                          padding: 0,
                        }}
                      >
                        <table
                          className="teacher-solid-table fit-table"
                          style={{
                            background: "transparent",
                            borderCollapse: "separate",
                            borderSpacing: 0,
                            boxShadow: "none",
                            borderRadius: 0,
                            overflow: "visible",
                          }}
                        >
                          <colgroup>
                            <col style={{ width: "17%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "5%" }} />
                            <col style={{ width: "14%" }} />
                            <col style={{ width: "19%" }} />
                          </colgroup>
                          <thead className="sticky-thead">
                            <tr style={{ background: "transparent" }}>
                              <th className="fit-th fit-wrap fit-tight" style={{ color: "#000" }}>
                                <b>Módulo</b>
                              </th>
                              <th className="fit-th fit-wrap" colSpan={2} style={{ color: "#000" }}>
                                <b>{hasGroups ? "Materia/Grupo" : "Materia"}</b>
                              </th>
                              <th className="fit-th fit-num fit-tight" style={{ color: "#000" }}>
                                <b>Nota final</b>
                              </th>
                              <th className="fit-th fit-num fit-tight" style={{ color: "#000" }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {summaryLoading ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={5}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  Cargando materias...
                                </td>
                              </tr>
                            ) : sortedSummaryItems.length === 0 ? (
                              <tr className="table-row-hover">
                                <td
                                  colSpan={5}
                                  className="fit-td fit-wrap"
                                  style={{ color: "var(--muted)" }}
                                >
                                  No hay materias registradas para este año todavía.
                                </td>
                              </tr>
                            ) : (
                              sortedSummaryItems.flatMap((s, sIdx) => {
                                const isGroup = !!s.group_id && s.classes.length > 0;
                                const isOdd   = sIdx % 2 === 0;
                                const noteColor = s.weighted === null
                                  ? "var(--muted)"
                                  : s.complete
                                    ? gradeTextColor(s.weighted)
                                    : "var(--muted)";
                                const noteOpacity = s.complete || s.weighted === null ? 1 : 0.22;
                                const noteText  = s.weighted === null ? "—" : s.weighted.toFixed(2);
                                const groupTdBg = isOdd ? "var(--tr-odd-bg)" : "var(--tr-even-bg)";

                                // Botón de acción (Detalle o Tomar Examen)
                                const actionBtn = (() => {
                                  if (!isHistoricalYear) {
                                    const avList = isGroup
                                      ? (examByGroupId.get(s.group_id!) ?? [])
                                      : (examByClassId.get(s.class_id) ?? []);
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
                                  const isPartial = s.weighted !== null && !s.complete;
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => handleConsult({ id: s.class_id, name: s.name, group_id: s.group_id })}
                                      className="btn fit-btn"
                                      style={isPartial ? {
                                        background: "#9ca3af",
                                        color: "#fff",
                                        border: "1px solid #6b7280",
                                        boxShadow: "none",
                                      } : undefined}
                                    >
                                      Detalle
                                    </button>
                                  );
                                })();

                                if (!isGroup) {
                                  // ── Fila individual: inline bg para zebra coherente con grupos ──
                                  const soloBg = isOdd ? "var(--tr-odd-bg)" : "var(--tr-even-bg)";
                                  return [(
                                    <tr key={`solo_${s.class_id}`} className="table-row-hover">
                                      <td className="fit-td fit-wrap" style={{ backgroundColor: soloBg, color: "var(--muted)", fontSize: 11 }}>
                                        {s.module_name ?? "—"}
                                      </td>
                                      <td className="fit-td fit-wrap" colSpan={2} style={{ backgroundColor: soloBg, fontWeight: 500, color: "var(--text)" }}>
                                        {s.name}
                                      </td>
                                      <td className="fit-td fit-num" style={{ backgroundColor: soloBg, fontWeight: 600, color: noteColor }}>
                                        <span style={{ opacity: noteOpacity }}>{noteText}</span>
                                      </td>
                                      <td className="fit-td fit-num" style={{ backgroundColor: soloBg }}>{actionBtn}</td>
                                    </tr>
                                  )];
                                }

                                // ── Grupo: fila única con nombre + materias apiladas en una columna ──
                                const isGrpHovered = hoveredGroupId === s.group_id;
                                const tdBg = isGrpHovered ? "var(--table-row-hover-bg)" : groupTdBg;
                                const grpHandlers = {
                                  onMouseEnter: () => setHoveredGroupId(s.group_id!),
                                  onMouseLeave: () => setHoveredGroupId(null),
                                };
                                return [(
                                  <tr key={`grp_${s.group_id}`} className="table-row-hover" {...grpHandlers}>
                                    <td className="fit-td fit-wrap"
                                      style={{ backgroundColor: tdBg, color: "var(--muted)", fontSize: 11, verticalAlign: "middle" }}>
                                      {s.module_name ?? "—"}
                                    </td>
                                    <td className="fit-td fit-wrap" colSpan={2}
                                      style={{ backgroundColor: tdBg, verticalAlign: "middle" }}>
                                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{s.group_name}</div>
                                      {[...s.classes].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)).map(cls => (
                                        <div key={cls.id} style={{ paddingLeft: "1rem", color: "var(--muted)", fontSize: 12 }}>
                                          {cls.name}
                                        </div>
                                      ))}
                                    </td>
                                    <td className="fit-td fit-num"
                                      style={{ backgroundColor: tdBg, fontWeight: 600, color: noteColor, verticalAlign: "middle" }}>
                                      <span style={{ opacity: noteOpacity }}>{noteText}</span>
                                    </td>
                                    <td className="fit-td fit-num"
                                      style={{ backgroundColor: tdBg, verticalAlign: "middle" }}>
                                      {actionBtn}
                                    </td>
                                  </tr>
                                )];
                              })
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
                        group_id: null,
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
                        <div>
                          <div className="label" style={{ fontWeight: 500 }}>
                            {selectedGroupId ? "Grupo" : "Materia"}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text)" }}>
                            {selectedClass.name}
                          </div>
                        </div>
                        {detailTeacherName ? (
                          <div style={{ marginTop: 10 }}>
                            <div className="label" style={{ fontWeight: 500, fontSize: 10 }}>
                              Profesor
                            </div>
                            <div style={{ fontWeight: 500, fontSize: 11, color: "var(--text)" }}>
                              {detailTeacherName}
                            </div>
                          </div>
                        ) : null}
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                        <div
                          style={{
                            minWidth: 140,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--stroke)",
                            background: weightedComplete
                              ? "color-mix(in srgb, var(--card) 88%, transparent)"
                              : "color-mix(in srgb, var(--stroke) 30%, transparent)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {weighted === null ? "Nota" : weightedComplete ? "Nota Final" : "Nota parcial"}
                          </span>
                          <strong
                            style={{
                              color: weighted === null
                                ? "var(--muted)"
                                : weightedComplete
                                  ? gradeTextColor(weighted)
                                  : "var(--muted)",
                              opacity: weightedComplete || weighted === null ? 1 : 0.22,
                              fontSize: 16,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {weighted === null ? "—" : weighted.toFixed(2)}
                          </strong>
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
                            borderCollapse: "separate",
                            borderSpacing: 0,
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
                                style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", color: "#000" }}
                              >
                                Tipo
                              </th>
                              <th
                                className="fit-th fit-wrap fit-tight"
                                style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", color: "#000" }}
                              >
                                Evaluación
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", color: "#000" }}
                              >
                                %
                              </th>
                              <th
                                className="fit-th fit-num fit-tight"
                                style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", color: "#000" }}
                              >
                                Nota
                              </th>
                              <th
                                className="fit-th fit-date fit-tight"
                                style={{ position: "sticky", top: 0, zIndex: 2, background: "color-mix(in srgb, rgb(14,165,233) 8%, var(--bg0))", color: "#000" }}
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
                                const isExam = String(it.type || "").toLowerCase() === "examen";
                                const isNoPresento = it.grade === 0 && it.attempts === 0 && !!it.finished_at;
                                const isExamenRendido = isExam && (it.attempts ?? 0) > 0 && !!it.finished_at;
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
                                        color: isNoPresento ? "inherit" : gradeTextColor(it.grade),
                                      }}
                                    >
                                      {isNoPresento ? (
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
                                      ) : it.grade === null ? (isExam ? "—" : "+") : Number(it.grade).toFixed(2)}
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
                            setWeightedComplete(false);
                            setDetailTeacherName(null);
                            setExamLinkMsg(null);
                            loadSummary();
                            apiFetch("/api/student/exam-available")
                              .then((r) => setExamAvailable(r?.items || []))
                              .catch(() => {});
                            if (openClassId) {
                              apiFetch(`/api/student/grades?class_id=${openClassId}${courseId ? `&course_id=${courseId}` : ""}`)
                                .then((r) => {
                                  setItems(r?.items || []);
                                  setWeighted(typeof r?.weighted === "number" ? r.weighted : null);
                                  setWeightedComplete(Boolean(r?.complete));
                                  setDetailTeacherName(r?.teacher_name || null);
                                })
                                .catch(() => {});
                            }
                          }}
                          className="btnRegresar"
                        >
                          ← Volver
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                </>
              </>)}
              {activeTab === "inasistencias" && (
                <>
                  {(() => {
                    const uniqueFechas   = [...new Set(absItems.map(a => a.fecha_clase))].sort((a, b) => b.localeCompare(a));
                    const uniqueMaterias = [...new Set(absItems.map(a => a.class_name))].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
                    const absFiltered = absItems.filter(a =>
                      (absFilterFecha   === "all" || a.fecha_clase === absFilterFecha) &&
                      (absFilterMateria === "all" || a.class_name  === absFilterMateria)
                    );
                    return (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: absFiltered.length > 0 ? "#dc2626" : "var(--muted)" }}>
                          {absLoading ? "Cargando..." : `Inasistencias: ${absFiltered.length}`}
                        </div>
                        <div style={{ borderRadius: 12, border: "1px solid var(--stroke)", overflow: "hidden" }}>
                          <table className="abs-modal-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th style={{ padding: "8px 12px", textAlign: "left", background: "color-mix(in srgb, rgb(14,165,233) 22%, var(--bg0))", borderBottom: "1px solid var(--stroke)" }}>
                                  <select className="select" value={absFilterFecha} onChange={e => setAbsFilterFecha(e.target.value)} style={{ fontSize: 13, padding: "4px 6px", fontWeight: absFilterFecha !== "all" ? 600 : 700, color: "var(--text)" }}>
                                    <option value="all" style={{ fontWeight: 700 }}>Fecha</option>
                                    {uniqueFechas.map(f => <option key={f} value={f}>{fmtAbsFecha(f)}</option>)}
                                  </select>
                                </th>
                                <th style={{ padding: "8px 12px", textAlign: "left", background: "color-mix(in srgb, rgb(14,165,233) 22%, var(--bg0))", borderBottom: "1px solid var(--stroke)" }}>
                                  <select className="select" value={absFilterMateria} onChange={e => setAbsFilterMateria(e.target.value)} style={{ fontSize: 13, padding: "4px 6px", fontWeight: absFilterMateria !== "all" ? 600 : 700, color: "var(--text)" }}>
                                    <option value="all" style={{ fontWeight: 700 }}>Materia</option>
                                    {uniqueMaterias.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {absLoading ? (
                                <tr><td colSpan={2} style={{ padding: "20px 12px", textAlign: "center", color: "var(--muted)", background: "var(--tr-even-bg)" }}>Cargando...</td></tr>
                              ) : absFiltered.length === 0 ? (
                                <tr><td colSpan={2} style={{ padding: "20px 12px", textAlign: "center", color: "var(--muted)", background: "var(--tr-even-bg)" }}>
                                  {absItems.length === 0 ? "Sin inasistencias registradas." : "No hay resultados para el filtro seleccionado."}
                                </td></tr>
                              ) : absFiltered.map((a, idx) => (
                                <tr key={`${a.fecha_clase}-${a.class_name}-${idx}`}>
                                  <td style={{ padding: "8px 12px", borderTop: "1px solid var(--stroke)", color: "var(--muted)", background: idx % 2 === 0 ? "var(--tr-even-bg)" : "var(--tr-odd-bg)" }}>{fmtAbsFecha(a.fecha_clase)}</td>
                                  <td style={{ padding: "8px 12px", borderTop: "1px solid var(--stroke)", fontWeight: 500, background: idx % 2 === 0 ? "var(--tr-even-bg)" : "var(--tr-odd-bg)" }}>{a.class_name}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
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
                  .then((r) => {
                    setItems(r?.items || []);
                    setWeighted(typeof r?.weighted === "number" ? r.weighted : null);
                    setWeightedComplete(Boolean(r?.complete));
                    setDetailTeacherName(r?.teacher_name || null);
                  })
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
                .then((r) => {
                  setItems(r?.items || []);
                  setWeighted(typeof r?.weighted === "number" ? r.weighted : null);
                  setWeightedComplete(Boolean(r?.complete));
                  setDetailTeacherName(r?.teacher_name || null);
                })
                .catch(() => {});
            }
          }}
        />
      )}

      <Footer />
    </div>
  );
}
