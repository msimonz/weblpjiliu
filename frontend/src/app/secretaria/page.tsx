"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import AppVersionLabel from "@/components/AppVersionLabel";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import * as XLSX from "xlsx";
import ConsultarAsistencia from "./ConsultarAsistencia";


// ─── Tipos ────────────────────────────────────────────────────────────────────
type SecView = "" | "NOTAS" | "CONSULTAR";

type AnioLectivo  = { year: number; nombre: string; activo: boolean };
type Course       = { id: number; name: string; level: number; year: number };
type ClassItem    = { id: number; name: string; level: number; id_module: number | null; module_name: string | null };
type ModuleItem   = { id: number; name: string };
type LevelItem    = { id: number; name: string };
type EvalItem     = {
  id: number; title: string; percent: number;
  id_course: number; id_class: number;
  evaluation_type?: { id: number; type: string } | null;
  class?: { id: number; name: string } | null;
};
type StudentRow   = { id: string; name: string; cedula: string | null; id_course: number };
type GradeRow     = { id_student: string; id_exam: number; grade: number | null; attempts: number | null };
type GridClassInfo = { id: number; name: string; level: number } | null;

// ─── Constantes visuales (idénticas a admin) ──────────────────────────────────
const GRILLA = {
  headerBgLight:      "#d9edf7",
  headerBgDark:       "#083b5c",
  headerTextLight:    "#0f172a",
  headerTextDark:     "#eaf4ff",
  rowHoverBgLight:    "#eef6fb",
  rowHoverBgDark:     "#0b2236",
  stripeLightEven:    "#ffffff",
  stripeLightOdd:     "#edf5fb",
  stripeDarkEven:     "#051422",
  stripeDarkOdd:      "#071e30",
  disabledCellBgLight:"#f4f5f6",
  disabledCellBgDark: "color-mix(in srgb, var(--card) 82%, rgb(15,23,42) 18%)",
  outerBorder:        "1px solid var(--stroke)",
  headerBottomBorder: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
  rowBottomBorder:    "1px solid color-mix(in srgb, var(--stroke) 85%, transparent)",
  radiusSecondary:    16,
};

const CEDULA_COL_W       = 150;
const ALUMNO_COL_W       = 260;
const STICKY_ALUMNO_LEFT = CEDULA_COL_W;

function isDarkThemeEnabled() {
  return (
    typeof document !== "undefined" &&
    (
      document.documentElement.classList.contains("dark") ||
      document.documentElement.dataset.theme === "dark" ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    )
  );
}
function getGrillaBaseRowBg(idx: number, dark: boolean) {
  return dark
    ? (idx % 2 === 0 ? GRILLA.stripeDarkEven : GRILLA.stripeDarkOdd)
    : (idx % 2 === 0 ? GRILLA.stripeLightEven : GRILLA.stripeLightOdd);
}
function getGrillaDisabledCellBg(dark: boolean) {
  return dark ? GRILLA.disabledCellBgDark : GRILLA.disabledCellBgLight;
}
function getGrillaTextColor(dark: boolean) {
  return dark ? "var(--text)" : "#0f172a";
}
function gradeCellKey(sid: string, eid: number) { return `${sid}__${eid}`; }

// ─── Componente ───────────────────────────────────────────────────────────────
export default function SecretariaPage() {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [me,          setMe]          = useState<any>(null);
  const [meLoading,   setMeLoading]   = useState(true);
  const [logoUrl,     setLogoUrl]     = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [msg,         setMsg]         = useState<string | null>(null);

  // Año lectivo
  const [anioLectivoItems, setAnioLectivoItems] = useState<AnioLectivo[]>([]);
  const [adminYear,        setAdminYear]        = useState<number | null>(null);

  // View
  const [view, setView] = useState<SecView>("");
  const [viewKey, setViewKey] = useState(0);

  // Catálogos
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [levels,  setLevels]  = useState<LevelItem[]>([]);

  // Filtros del grid
  const [upsertLevelFilter,  setUpsertLevelFilter]  = useState<number | "">("");
  const [upsertCourseFilter, setUpsertCourseFilter] = useState<number | "all">("all");
  const [upsertModuleFilter, setUpsertModuleFilter] = useState<number | "all">("all");
  const [upsertClassFilter,  setUpsertClassFilter]  = useState<number | "all">("all");

  // Filtros de búsqueda en la tabla
  const [gFilterCedula, setGFilterCedula] = useState("all");
  const [gFilterName,   setGFilterName]   = useState("all");

  // Grade grid
  const [gLoadingRoster, setGLoadingRoster] = useState(false);
  const [gEvaluations,   setGEvaluations]   = useState<EvalItem[]>([]);
  const [gRoster,        setGRoster]        = useState<StudentRow[]>([]);
  const [gGrades,        setGGrades]        = useState<GradeRow[]>([]);
  const [gradeDraft,     setGradeDraft]     = useState<Record<string, string>>({});
  const [gridClassInfo,  setGridClassInfo]  = useState<GridClassInfo>(null);

  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setMeLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");
        const info = await apiFetch("/api/auth/me");
        setMe(info);
        const active = getActiveRole(info);
        if (active !== "E") return router.replace(roleToRoute(active));
      } catch {
        router.replace("/login");
      } finally {
        setMeLoading(false);
      }
    })();
  }, [router]);

  // ── Catálogos ───────────────────────────────────────────────────────────────
  async function loadAll(year?: number | null) {
    setMsg(null);
    const ySuffix = year ? `?year=${year}` : "";
    try {
      const [c1, c2, m1, l1] = await Promise.all([
        apiFetch(`/api/admin/courses${ySuffix}`),
        apiFetch(`/api/admin/classes${ySuffix}`),
        apiFetch(`/api/admin/modules${ySuffix}`),
        apiFetch(`/api/admin/levels${ySuffix}`),
      ]);
      setCourses(c1?.items || []);
      setClasses(c2?.items || []);
      setModules(m1?.items || []);
      setLevels(l1?.items  || []);
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error cargando datos");
    }
  }

  useEffect(() => {
    if (meLoading) return;
    apiFetch("/api/admin/anio-lectivo")
      .then((res) => {
        const items: AnioLectivo[] = res?.items || [];
        setAnioLectivoItems(items);
        const activo = items.find(i => i.activo);
        if (activo) setAdminYear(activo.year);
        loadAll(activo?.year ?? null);
      })
      .catch(() => loadAll(null));
  }, [meLoading]);

  // ── Grade grid ──────────────────────────────────────────────────────────────
  async function loadGradeGridWith(
    level:        number | "",
    courseFilter: number | "all",
    moduleFilter: number | "all",
    classFilter:  number | "all"
  ) {
    setMsg(null);
    setGLoadingRoster(true);
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    try {
      let data;
      if (classFilter !== "all") {
        const courseParam = courseFilter !== "all" ? `&course_id=${Number(courseFilter)}` : "";
        data = await apiFetch(`/api/admin/class-grade-grid?class_id=${Number(classFilter)}${courseParam}`);
      } else {
        const params = new URLSearchParams();
        if (level !== "" && Number(level) > 0) params.set("level", String(level));
        if (courseFilter !== "all") params.set("course_id", String(courseFilter));
        if (moduleFilter !== "all") params.set("module_id", String(moduleFilter));
        data = await apiFetch(`/api/admin/grade-grid?${params.toString()}`);
      }

      const evals  = data?.evaluations || [];
      const roster = data?.students    || [];
      const grades = data?.grades      || [];

      setGridClassInfo(data?.class || null);
      setGEvaluations(evals);
      setGRoster(roster);
      setGGrades(grades);

      // Construir gradeDraft igual que admin
      const draft: Record<string, string> = {};
      for (const g of grades) {
        draft[gradeCellKey(g.id_student, g.id_exam)] =
          g.grade === null || g.grade === undefined ? "" : String(Number(g.grade));
      }
      setGradeDraft(draft);
      setGFilterCedula("all");
      setGFilterName("all");
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error cargando notas");
    } finally {
      setGLoadingRoster(false);
    }
  }

  useEffect(() => {
    if (view !== "NOTAS") return;
    if (upsertLevelFilter === "") return;
    loadGradeGridWith(upsertLevelFilter, upsertCourseFilter, upsertModuleFilter, upsertClassFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertLevelFilter, upsertCourseFilter, upsertModuleFilter, upsertClassFilter]);

  // ── Datos derivados ─────────────────────────────────────────────────────────
  const availableLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of classes) if (Number.isFinite(Number(c.level))) set.add(Number(c.level));
    return [...set].sort((a, b) => a - b);
  }, [classes]);

  const upsertCoursesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return courses;
    return courses.filter(c => Number(c.level) === Number(upsertLevelFilter));
  }, [courses, upsertLevelFilter]);

  const upsertModulesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return modules;
    const ids = new Set(
      classes
        .filter(c => Number(c.level) === Number(upsertLevelFilter))
        .map(c => c.id_module)
        .filter((x): x is number => x !== null && x !== undefined && x > 0)
    );
    return modules.filter(m => ids.has(m.id));
  }, [classes, modules, upsertLevelFilter]);

  const upsertClassesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return classes;
    let filtered = classes.filter(c => Number(c.level) === Number(upsertLevelFilter));
    if (upsertModuleFilter !== "all")
      filtered = filtered.filter(c => Number(c.id_module) === Number(upsertModuleFilter));
    return filtered;
  }, [classes, upsertLevelFilter, upsertModuleFilter]);

  const selectedUpsertClass = useMemo(() => {
    if (upsertClassFilter === "all") return null;
    return classes.find(c => c.id === Number(upsertClassFilter)) || null;
  }, [upsertClassFilter, classes]);

  const sortedRoster = useMemo(
    () => [...gRoster].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [gRoster]
  );

  const filteredRoster = useMemo(() => sortedRoster.filter(st => {
    if (gFilterCedula !== "all" && st.cedula !== gFilterCedula) return false;
    if (gFilterName   !== "all" && st.id    !== gFilterName)   return false;
    return true;
  }), [sortedRoster, gFilterCedula, gFilterName]);

  const evaluationTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of gEvaluations) {
      const k = (ev.evaluation_type?.type ?? ev.title).toLowerCase();
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [gEvaluations]);

  function _getEvaluationColumnLabel(ev: EvalItem) {
    const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
    const repeated  = (evaluationTypeCounts.get(typeLabel.toLowerCase()) || 0) > 1;
    return repeated
      ? `${typeLabel} · ${ev.title} (${Number(ev.percent).toFixed(0)}%)`
      : `${typeLabel} (${Number(ev.percent).toFixed(0)}%)`;
  }

  function isEvaluationApplicableToStudent(student: StudentRow, ev: EvalItem) {
    return Number(student.id_course) === Number(ev.id_course);
  }

  const upsertDynamicMinWidth = useMemo(() => {
    // Sin columna de acción (solo lectura)
    return CEDULA_COL_W + ALUMNO_COL_W + 90 + gEvaluations.length * 120;
  }, [gEvaluations.length]);

  const breadcrumb = useMemo(() => {
    const levelLabel  = typeof upsertLevelFilter === "number" && upsertLevelFilter !== 0
      ? (levels.find(l => l.id === upsertLevelFilter)?.name ?? `Nivel ${upsertLevelFilter}`)
      : upsertLevelFilter === 0 ? "Todos los años" : null;
    const courseLabel = upsertCourseFilter !== "all"
      ? (courses.find(c => c.id === Number(upsertCourseFilter))?.name ?? "—") : null;
    const moduleLabel = upsertModuleFilter !== "all"
      ? (modules.find(m => m.id === Number(upsertModuleFilter))?.name ?? "—") : null;
    const classLabel  = upsertClassFilter  !== "all"
      ? (gridClassInfo?.name ?? selectedUpsertClass?.name ?? "—") : null;
    return [
      levelLabel,
      courseLabel ?? (levelLabel ? "Todos los cursos"   : null),
      moduleLabel ?? (levelLabel ? "Todos los módulos"  : null),
      classLabel  ?? (levelLabel ? "Todas las materias" : null),
    ].filter(Boolean).join(" › ") || "Todas las notas";
  }, [upsertLevelFilter, upsertCourseFilter, upsertModuleFilter, upsertClassFilter,
      levels, courses, modules, gridClassInfo, selectedUpsertClass]);

  function downloadExcel() {
    const _materia = gridClassInfo?.name ?? selectedUpsertClass?.name ?? "Grilla";
    const rows = sortedRoster.map(st => {
      const row: Record<string, string | number> = {
        Cédula: st.cedula ?? "",
        Alumno: st.name,
      };
      for (const ev of gEvaluations) {
        const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
        const showTitle = ev.title && ev.title.trim() !== typeLabel;
        const label = showTitle ? `${typeLabel} · ${ev.title} (${Number(ev.percent).toFixed(0)}%)` : `${typeLabel} (${Number(ev.percent).toFixed(0)}%)`;
        if (!isEvaluationApplicableToStudent(st, ev)) {
          row[label] = "-";
          continue;
        }
        const gradeRecord = gGrades.find(g => g.id_student === st.id && g.id_exam === ev.id);
        const attempts = gradeRecord?.attempts ?? 0;
        const gradeVal = gradeRecord?.grade ?? 0;
        if (attempts === 0 && gradeVal === 0) {
          row[label] = "No Presentó";
        } else {
          const key = gradeCellKey(st.id, ev.id);
          const val = gradeDraft[key];
          row[label] = val === "" || val == null ? "" : Number(val);
        }
      }
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    XLSX.writeFile(wb, "consulta_de_notas.xlsx");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function resetFiltersAndGrid() {
    setUpsertLevelFilter("");
    setUpsertCourseFilter("all");
    setUpsertModuleFilter("all");
    setUpsertClassFilter("all");
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    setGridClassInfo(null);
    setGFilterCedula("all");
    setGFilterName("all");
  }

  if (meLoading) return <div className="container">Cargando...</div>;

  const isDark    = isDarkThemeEnabled();
  const SIDEBAR_W = 300;
  const HAM_PAD   = 14;
  const hamLeft   = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div style={{ fontFamily: '"Inter","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif' }}>

      {/* CSS variables de grilla — idénticas al <style jsx> del admin */}
      <style jsx>{`
        .teacher-solid-table {
          --table-head-bg: ${GRILLA.headerBgLight};
          --table-head-text: ${GRILLA.headerTextLight};
          --table-row-hover-bg: ${GRILLA.rowHoverBgLight};
        }

        :global(html.dark) .teacher-solid-table,
        :global(html[data-theme="dark"]) .teacher-solid-table {
          --table-head-bg: ${GRILLA.headerBgDark};
          --table-head-text: ${GRILLA.headerTextDark};
          --table-row-hover-bg: ${GRILLA.rowHoverBgDark};
        }

        @media (prefers-color-scheme: dark) {
          .teacher-solid-table {
            --table-head-bg: ${GRILLA.headerBgDark};
            --table-head-text: ${GRILLA.headerTextDark};
            --table-row-hover-bg: ${GRILLA.rowHoverBgDark};
          }
        }

        .teacher-solid-table thead,
        .teacher-solid-table thead tr,
        .teacher-solid-table thead th,
        .teacher-solid-table thead td {
          background-color: var(--table-head-bg) !important;
          background-image: none !important;
          color: var(--table-head-text) !important;
          opacity: 1 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        .teacher-solid-table tbody tr.table-row-hover > td {
          transition: background-color 120ms ease;
        }

        .teacher-solid-table tbody tr.table-row-hover[data-editing="false"]:hover > td {
          background-color: var(--table-row-hover-bg) !important;
        }
      `}</style>

      {/* ── Hamburger ── */}
      <div style={{ position: "fixed", top: 0, left: 0, zIndex: 70, width: sidebarOpen ? SIDEBAR_W + HAM_PAD + 44 : HAM_PAD + 44, height: 72 }}>
        <div
          onClick={() => setSidebarOpen(v => !v)}
          style={{
            position: "absolute", left: hamLeft, top: HAM_PAD, zIndex: 70,
            width: 44, height: 44, borderRadius: 14,
            background: "var(--card)", border: "1px solid var(--stroke)",
            boxShadow: "var(--shadow)", backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)", display: "grid",
            placeItems: "center", cursor: "pointer",
          }}
        >
          <div style={{ display: "grid", gap: 5 }}>
            {[85, 65, 45].map((op, i) => (
              <div key={i} style={{ width: 18, height: 2, borderRadius: 9, background: `color-mix(in srgb, var(--text) ${op}%, transparent)` }} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside style={{
        position: "fixed", left: 0, top: 0, bottom: 0, width: SIDEBAR_W,
        padding: 18, background: "var(--card)", borderRight: "1px solid var(--stroke)",
        boxShadow: "var(--shadow)", backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)", overflow: "auto", zIndex: 55,
        transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 180ms ease", color: "var(--text)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Secretaría</div>
        <div style={{ color: "var(--muted)", marginTop: 4, fontSize: 13 }}>Vista de solo lectura</div>

        <div style={{ marginTop: 14 }}>
          <div className="label" style={{ fontWeight: 500 }}>Nombre</div>
          <div style={{ fontWeight: 600 }}>{me?.profile?.name ?? me?.user?.user_metadata?.full_name ?? "—"}</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="label" style={{ fontWeight: 500 }}>Email</div>
          <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{me?.user?.email ?? "—"}</div>
        </div>
        <div style={{ marginTop: 10, marginBottom: 20 }}>
          <div className="label" style={{ fontWeight: 500 }}>Rol</div>
          <div style={{ fontWeight: 600 }}>Secretaría</div>
        </div>

        <ChangePasswordButton email={me?.user?.email} className="btn actionBtn" />
        <div style={{ marginTop: 12 }}>
          <button className="btn actionBtn" onClick={handleLogout} style={{ width: "100%" }}>Salir</button>
        </div>
        <AppVersionLabel
          style={{ display: "block", marginTop: 10, color: "var(--footer)", fontSize: 8, fontWeight: 700 }}
        />
      </aside>

      {/* ── Main ── */}
      <main style={{ marginLeft: sidebarOpen ? SIDEBAR_W : 0, transition: "margin-left 180ms ease" }}>
        <div className="container">

          {/* Topbar */}
          <div className="topbar dashboard-topbar" style={{ alignItems: "center" }}>
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
                  <div style={{ color: "var(--muted)" }}>Secretaría</div>
                </div>
              </div>
            </div>
            <div className="topbarUserText">
              Secretaría · {me?.profile?.name ?? me?.user?.user_metadata?.full_name ?? me?.user?.email ?? "—"}
            </div>
          </div>

          {/* ¿Qué quieres hacer? + Año lectivo */}
          <div style={{
            marginTop: 18, padding: 14, borderRadius: 18,
            border: "1px solid var(--stroke)",
            background: "rgba(14,165,233,.04)",
            display: "flex", gap: 12, alignItems: "flex-end",
          }}>
            <div style={{ flex: 4 }}>
              <div className="label">¿Qué quieres hacer?</div>
              <select
                className="select"
                style={{ width: "100%" }}
                value=""
                onChange={e => {
                  setView(e.target.value as SecView);
                  setViewKey((k) => k + 1);
                  resetFiltersAndGrid();
                  loadAll(adminYear);
                }}
              >
                <option value="" disabled>¿Qué quieres hacer?...</option>
                <option value="NOTAS">Reporte de notas</option>
                <option value="CONSULTAR">Reporte de asistencia</option>
              </select>
            </div>

            {anioLectivoItems.length > 0 && (
              <div style={{ flex: 1 }}>
                <div className="label">Año lectivo</div>
                <select
                  className="select"
                  style={{ width: "100%" }}
                  value={adminYear ?? ""}
                  onChange={e => {
                    const y = Number(e.target.value);
                    setAdminYear(y);
                    resetFiltersAndGrid();
                    loadAll(y);
                  }}
                >
                  {anioLectivoItems.map(a => (
                    <option key={a.year} value={a.year}>{a.year}{a.activo ? " ✓" : ""}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {msg && <div className="msgError" style={{ marginTop: 12 }}>{msg}</div>}

          {/* ── Vista: Consultar asistencia ── */}
          {view === "CONSULTAR" && <ConsultarAsistencia key={viewKey} />}

          {/* ── Vista: Consultar notas ── */}
          {view === "NOTAS" && (
            <div className="card" style={{ marginTop: 18, width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Reporte de Notas</h2>
              </div>

              {/* Filtros — mismos que admin UPSERT */}
              <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "flex-end", flexWrap: "wrap" }}>

                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={String(upsertLevelFilter)}
                    onChange={e => {
                      const v = e.target.value;
                      setUpsertLevelFilter(v === "" ? "" : Number(v));
                      setUpsertCourseFilter("all");
                      setUpsertModuleFilter("all");
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="" disabled>Seleccionar año...</option>
                    <option value="0" style={{ fontWeight: 700 }}>Todos</option>
                    {availableLevels.map(lvl => (
                      <option key={lvl} value={String(lvl)}>
                        {levels.find(l => l.id === lvl)?.name ?? `Nivel ${lvl}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={upsertCourseFilter === "all" ? "all" : String(upsertCourseFilter)}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === "all") {
                        setUpsertCourseFilter("all");
                      } else {
                        const id = Number(val);
                        setUpsertCourseFilter(id);
                        const c = courses.find(c => c.id === id);
                        if (c) setUpsertLevelFilter(c.level);
                      }
                      setUpsertModuleFilter("all");
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Todos</option>
                    {upsertCoursesFiltered.map(c => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={upsertModuleFilter === "all" ? "all" : String(upsertModuleFilter)}
                    onChange={e => {
                      setUpsertModuleFilter(e.target.value === "all" ? "all" : Number(e.target.value));
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Todos</option>
                    {upsertModulesFiltered.map(m => (
                      <option key={m.id} value={String(m.id)}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: "2 1 200px" }}>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={upsertClassFilter}
                    onChange={e => setUpsertClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                  >
                    <option value="all">Todas</option>
                    {upsertClassesFiltered.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Botón Descargar */}
                {gEvaluations.length > 0 && gRoster.length > 0 && (
                  <button
                    type="button"
                    className="btnLight"
                    onClick={downloadExcel}
                    style={{
                      background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                      border: "1px solid rgba(34,197,94,.8)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      whiteSpace: "nowrap",
                      boxShadow: "0 4px 12px rgba(34,197,94,.35)",
                    }}
                  >
                    ↓&nbsp;&nbsp;Descargar&nbsp;
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
                      <path d="M4 2h9l5 5v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#fff" stroke="#14532d" strokeWidth="1.2"/>
                      <path d="M13 2v5h5" fill="none" stroke="#14532d" strokeWidth="1.2"/>
                      <rect x="3" y="10" width="18" height="11" rx="1" fill="#16a34a" stroke="#14532d" strokeWidth="0.8"/>
                      <text x="6.5" y="19.5" fontSize="9" fontWeight="bold" fill="#ffffff" fontFamily="Arial, sans-serif">xls</text>
                    </svg>
                  </button>
                )}
              </div>

              {/* Grid de notas */}
              {upsertLevelFilter === "" ? (
                <div style={{ marginTop: 24, color: "var(--muted)", fontSize: 14 }}>
                  Seleccioná un año para ver las notas.
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ fontWeight: 900 }}>{breadcrumb}</div>
                  </div>

                  <div style={{
                    borderRadius: GRILLA.radiusSecondary, overflow: "hidden",
                    border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
                    background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                    boxShadow: "var(--shadow)",
                  }}>
                    <div style={{
                      overflowX: "auto", overflowY: "auto",
                      maxHeight: "68vh", minHeight: 200,
                      background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                    }}>
                      <table
                        className="teacher-solid-table"
                        style={{
                          width: "100%",
                          minWidth: `${upsertDynamicMinWidth}px`,
                          borderCollapse: "separate",
                          borderSpacing: 0,
                          tableLayout: "fixed",
                          fontSize: 14,
                          color: "var(--text)",
                        }}
                      >
                        <colgroup>
                          <col style={{ width: `${CEDULA_COL_W}px` }} />
                          <col style={{ width: `${ALUMNO_COL_W}px` }} />
                          <col style={{ width: "90px" }} />
                          {gEvaluations.map(ev => (
                            <col key={`${ev.id}-grade`} style={{ width: "120px" }} />
                          ))}
                        </colgroup>

                        <thead>
                          {/* Subheader de materias cuando hay múltiples */}
                          {upsertClassFilter === "all" && gEvaluations.length > 0 && (() => {
                            const groups: { classId: number; className: string; count: number }[] = [];
                            for (const ev of gEvaluations) {
                              const last = groups[groups.length - 1];
                              if (last && last.classId === ev.id_class) last.count++;
                              else groups.push({ classId: ev.id_class, className: ev.class?.name || `Clase ${ev.id_class}`, count: 1 });
                            }
                            return (
                              <tr>
                                <td colSpan={3} style={{ borderBottom: GRILLA.headerBottomBorder, background: GRILLA.headerBgLight, position: "sticky", top: 0, left: 0, zIndex: 7 }} />
                                {groups.map(g => (
                                  <td key={g.classId} colSpan={g.count} style={{
                                    padding: "4px 10px", borderBottom: GRILLA.headerBottomBorder,
                                    fontSize: 11, fontWeight: 700, textAlign: "center", background: GRILLA.headerBgLight,
                                    borderLeft: "1px solid var(--stroke)", position: "sticky", top: 0, zIndex: 5,
                                  }}>
                                    {g.className}
                                  </td>
                                ))}
                              </tr>
                            );
                          })()}

                          <tr>
                            {/* Cédula */}
                            <th style={{
                              textAlign: "left", padding: "8px 12px",
                              borderBottom: GRILLA.headerBottomBorder,
                              position: "sticky", top: upsertClassFilter === "all" ? 33 : 0,
                              left: 0, zIndex: 6, whiteSpace: "nowrap", boxShadow: "none",
                            }}>
                              <select
                                className="select"
                                value={gFilterCedula}
                                onChange={e => { setGFilterCedula(e.target.value); if (e.target.value !== "all") setGFilterName("all"); }}
                                disabled={gFilterName !== "all"}
                                style={{ fontSize: 13, padding: "4px 6px", fontWeight: gFilterCedula !== "all" ? 600 : 700, color: gFilterCedula !== "all" ? "var(--text)" : isDark ? "#fff" : "#000" }}
                              >
                                <option value="all" style={{ fontWeight: 700, color: "#000" }}>Cédula</option>
                                {sortedRoster.map(st => <option key={st.id} value={st.cedula ?? ""} style={{ color: "#000" }}>{st.cedula}</option>)}
                              </select>
                            </th>

                            {/* Alumno */}
                            <th style={{
                              textAlign: "left", padding: "8px 12px",
                              borderBottom: GRILLA.headerBottomBorder,
                              position: "sticky", top: upsertClassFilter === "all" ? 33 : 0,
                              left: STICKY_ALUMNO_LEFT, zIndex: 6, boxShadow: "none",
                            }}>
                              <select
                                className="select"
                                value={gFilterName}
                                onChange={e => { setGFilterName(e.target.value); if (e.target.value !== "all") setGFilterCedula("all"); }}
                                disabled={gFilterCedula !== "all"}
                                style={{ fontSize: 13, padding: "4px 6px", fontWeight: gFilterName !== "all" ? 600 : 700, color: gFilterName !== "all" ? "var(--text)" : isDark ? "#fff" : "#000" }}
                              >
                                <option value="all" style={{ fontWeight: 700, color: "#000" }}>Alumno</option>
                                {sortedRoster.map(st => <option key={st.id} value={st.id} style={{ color: "#000" }}>{st.name}</option>)}
                              </select>
                            </th>

                            {/* No Aprobadas */}
                            <th style={{
                              textAlign: "center", padding: "8px 10px",
                              borderBottom: GRILLA.headerBottomBorder,
                              position: "sticky", top: upsertClassFilter === "all" ? 33 : 0,
                              zIndex: 5, whiteSpace: "nowrap", color: "#64748b", fontWeight: 700,
                            }}>
                              <span style={{ color: "#64748b", fontSize: 12 }}>No Aprobadas</span>
                            </th>

                            {/* Columnas de evaluaciones */}
                            {gEvaluations.map(ev => {
                              const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
                              const showTitle = ev.title && ev.title.trim() !== typeLabel;
                              return (
                                <th key={`${ev.id}-grade`} style={{
                                  textAlign: "left", padding: "8px 10px",
                                  borderBottom: GRILLA.headerBottomBorder,
                                  position: "sticky", top: upsertClassFilter === "all" ? 33 : 0,
                                  zIndex: 5, lineHeight: 1.3,
                                  borderLeft: upsertClassFilter === "all" ? "1px solid var(--stroke)" : undefined,
                                }}>
                                  <div>{typeLabel} ({Number(ev.percent).toFixed(0)}%)</div>
                                  {showTitle && (
                                    <div style={{ fontSize: 11, opacity: 0.8 }}>{ev.title}</div>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>

                        <tbody>
                          {gLoadingRoster ? (
                            <tr>
                              <td colSpan={Math.max(4, gEvaluations.length + 3)} style={{
                                padding: 32, minHeight: 120, textAlign: "center",
                                fontSize: 14, color: "var(--muted)",
                                background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                              }}>
                                Cargando alumnos y notas...
                              </td>
                            </tr>
                          ) : gRoster.length === 0 ? (
                            <tr>
                              <td colSpan={Math.max(4, gEvaluations.length + 3)} style={{
                                padding: 16, color: "var(--muted)",
                                background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                              }}>
                                No se encontraron alumnos para esta materia.
                              </td>
                            </tr>
                          ) : gEvaluations.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{
                                padding: 16, color: "var(--muted)",
                                background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                              }}>
                                Esta materia aún no tiene evaluaciones creadas.
                              </td>
                            </tr>
                          ) : (
                            filteredRoster.map((st, rowIndex) => {
                              const baseRowBg    = getGrillaBaseRowBg(rowIndex, isDark);
                              const cellTextColor = getGrillaTextColor(isDark);
                              const disabledCellBg = getGrillaDisabledCellBg(isDark);

                              const perdidas = gEvaluations.filter(ev => {
                                if (!isEvaluationApplicableToStudent(st, ev)) return false;
                                const gr = gGrades.find(g => g.id_student === st.id && g.id_exam === ev.id);
                                return (gr?.grade ?? 0) < 70;
                              }).length;

                              return (
                                <tr key={st.id} className="table-row-hover" data-editing="false" style={{ background: baseRowBg }}>

                                  {/* Cédula */}
                                  <td style={{
                                    padding: "2px 10px", borderBottom: GRILLA.rowBottomBorder,
                                    background: baseRowBg, position: "sticky", left: 0, zIndex: 4,
                                    whiteSpace: "nowrap", lineHeight: 1.15, boxShadow: "none",
                                    color: cellTextColor,
                                  }}>
                                    {st.cedula}
                                  </td>

                                  {/* Alumno */}
                                  <td style={{
                                    padding: "2px 10px", borderBottom: GRILLA.rowBottomBorder,
                                    background: baseRowBg, position: "sticky", left: STICKY_ALUMNO_LEFT, zIndex: 4,
                                    boxShadow: "none", color: cellTextColor,
                                  }}>
                                    <div style={{ lineHeight: 1.15 }}>{st.name}</div>
                                  </td>

                                  {/* No Aprobadas */}
                                  <td style={{
                                    padding: "2px 10px", borderBottom: GRILLA.rowBottomBorder,
                                    background: baseRowBg, textAlign: "center",
                                    fontWeight: 400, fontSize: 13,
                                    color: perdidas > 0 ? "#f87171" : cellTextColor,
                                    whiteSpace: "nowrap",
                                  }}>
                                    {perdidas > 0 ? perdidas : ""}
                                  </td>

                                  {/* Celdas de nota — input readOnly, mismo estilo que admin */}
                                  {gEvaluations.map(ev => {
                                    const key              = gradeCellKey(st.id, ev.id);
                                    const enabledForCourse = isEvaluationApplicableToStudent(st, ev);
                                    const gradeRecord      = gGrades.find(g => g.id_student === st.id && g.id_exam === ev.id);
                                    const attempts         = gradeRecord?.attempts ?? 0;
                                    const gradeVal         = gradeRecord?.grade ?? 0;
                                    const noPresentó       = enabledForCourse && attempts === 0 && gradeVal === 0;
                                    const draftVal         = gradeDraft[key] ?? "";

                                    return (
                                      <td key={`${ev.id}-grade`} style={{
                                        padding: 0,
                                        borderBottom: GRILLA.rowBottomBorder,
                                        background: enabledForCourse ? "transparent" : disabledCellBg,
                                        position: "relative",
                                        borderLeft: upsertClassFilter === "all" ? "1px solid var(--stroke)" : undefined,
                                      }}>
                                        {noPresentó ? (
                                          <div style={{ display: "flex", alignItems: "center", justifyContent: "left", height: 26, padding: "0 6px" }}>
                                            <span style={{
                                              display: "inline-block", padding: "2px 4px", borderRadius: 4,
                                              fontSize: 8, fontWeight: 700, letterSpacing: 0.3,
                                              background: isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.1)",
                                              color: isDark ? "#fca5a5" : "#dc2626",
                                              border: isDark ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(239,68,68,0.25)",
                                              whiteSpace: "nowrap",
                                            }}>
                                              No Presentó
                                            </span>
                                          </div>
                                        ) : (
                                          <input
                                            className="input"
                                            readOnly
                                            value={draftVal}
                                            placeholder={enabledForCourse ? "—" : "-"}
                                            style={{
                                              width: "100%", minWidth: 0, height: 26,
                                              border: "none", borderRadius: 0, outline: "none",
                                              background: "transparent", boxShadow: "none",
                                              padding: "0 10px", fontSize: 13, lineHeight: 1,
                                              fontWeight: 500,
                                              color: enabledForCourse
                                                ? (draftVal !== "" && Number(draftVal) < 70 ? "#dc2626" : cellTextColor)
                                                : isDark ? "var(--muted)" : "#94a3b8",
                                              cursor: "default",
                                              opacity: enabledForCourse ? 1 : 0.6,
                                            }}
                                          />
                                        )}
                                      </td>
                                    );
                                  })}

                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      <Footer />
    </div>
  );
}
