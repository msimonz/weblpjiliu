"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, signOut } from "@/lib/auth";
import { apiFetch, setImpersonateToken } from "@/lib/api";
import { roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import AppVersionLabel from "@/components/AppVersionLabel";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import * as XLSX from "xlsx";
import CrearExamen, { type CrearExamenCtx, type ExamInitialData } from "../admin/CrearExamen";
import ReporteAsistenciaProfesor from "./ReporteAsistenciaProfesor";

type TeacherClass = {
  id: number;
  name: string;
  level: number;
  id_module: number | null;
  id_group: number | null;
  id_course?: number | null;
  module?: { id: number; name: string } | null;
  group?: { id: number; name: string } | null;
};

type EvalItem = {
  id: number;
  title: string;
  percent: number;
  created_at: string;
  course?: { id: number; name: string; level: number; year: string };
  class?: { id: number; name: string; level: number } | null;
  evaluation_type?: { id: number; type: string };
  module?: { id: number; name: string } | null;
  group?: { id: number; name: string } | null;
  id_course: number | null;
  id_class: number | null;
  id_module?: number | null;
  id_group?: number | null;
  id_type: number;
};

type CourseItem = { id: number; name: string; level: number; year: string };
type EvalTypeItem = { id: number; type: string };
type AnioLectivoItem = { year: number; nombre: string; activo: boolean };

type StudentRow = {
  id: string;
  name: string;
  cedula: string;
  id_course?: number;
  course_name?: string | null;
};

type GridGradeRow = {
  id_student: string;
  id_exam: number;
  grade: number | null;
  finished_at?: string | null;
  attempts?: number | null;
};

type GradeGridResponse = {
  class: { id: number; name: string; level: number } | null;
  group?: { id: number; name: string; level?: number | null } | null;
  evaluations: EvalItem[];
  students: StudentRow[];
  grades: GridGradeRow[];
};

type SectionContext = {
  classId: number;
  className: string;
  moduleId: number | null;
  moduleName: string;
  groupId: number | null;
  groupName: string;
};

type FlatGradeRow = {
  // primary section (first encountered) — kept for legacy refs
  classId: number;
  className: string;
  level: number;
  levelName: string;
  moduleId: number | null;
  moduleName: string;
  groupId: number | null;
  groupName: string;
  // all sections this student appears in (for filtering)
  allSectionContexts: SectionContext[];
  student: StudentRow;
  sectionEvals: EvalItem[];   // merged across all sections
  sectionGrades: GridGradeRow[]; // merged across all sections
};

type DashboardGroup = {
  level: number;
  level_label: string;
  items: TeacherClass[];
  student_count?: number;
};

type DashboardAssignment = {
  class_id: number;
  class_name: string;
  level: number;
  level_label: string;
  course_id: number | null;
  course_name: string;
  course_student_count?: number;
  module_id: number | null;
  module_name: string;
  group_id: number | null;
  group_name: string;
};

type TeacherDashboardResponse = {
  summary: {
    assigned_classes: number;
    total_students: number;
    academic_year: number;
  };
  groups: DashboardGroup[];
  assignments: DashboardAssignment[];
};

type TeacherView = "" | "DASHBOARD" | "EVALS" | "CREATE" | "UPSERT" | "ATTEND_REPORT";
type LevelValue = number | "all" | "";
type LevelItem = { id: number; name: string };
const GRILLA = {
  headerBgLight: "#d9edf7",
  headerBgDark: "#083b5c",
  headerTextLight: "#0f172a",
  headerTextDark: "#eaf4ff",
  rowHoverBgLight: "#eef6fb",
  rowHoverBgDark: "#0b2236",

  stripeLightEven: "#ffffff",
  stripeLightOdd: "#edf5fb",

  stripeDarkEven: "#051422",
  stripeDarkOdd: "#071e30",

  activeRowBgLight: "color-mix(in srgb, rgb(22,163,74) 10%, #ffffff 90%)",
  activeRowBgDark: "color-mix(in srgb, rgb(22,163,74) 14%, var(--card) 86%)",

  editableCellBgLight: "#f5fff7",
 editableCellBgDark: "color-mix(in srgb, rgb(22,163,74) 9%, var(--card) 91%)",
 // editableCellBgLight: "#f5fff7",
 // editableCellBgDark: "color-mix(in srgb, rgb(247, 243, 244) 9%, var(--card) 91%)",

  disabledCellBgLight: "#f4f5f6",
  disabledCellBgDark: "color-mix(in srgb, var(--card) 82%, rgb(15,23,42) 18%)",

  focusCellBgLight: "#eaf2ff",
  focusCellBgDark: "color-mix(in srgb, rgb(59,130,246) 16%, var(--card) 84%)",

  outerBorder: "1px solid var(--stroke)",
  headerBottomBorder: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
  rowBottomBorder: "1px solid color-mix(in srgb, var(--stroke) 85%, transparent)",
  radiusPrimary: 18,
  radiusSecondary: 16,
};
function gradeCellKey(studentId: string, examId: number) {
  return `${studentId}__${examId}`;
}

function isExamEvaluation(ev: { evaluation_type?: { type?: string | null } | null }) {
  return String(ev.evaluation_type?.type || "").toLowerCase() === "examen";
}

function levelLabel(level: number | null | undefined, levelMap: Record<number, string> = {}) {
  const n = Number(level);
  return levelMap[n] ?? `Año ${level ?? "—"}`;
}

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

function getGrillaBaseRowBg(rowIndex: number, isDarkTheme: boolean) {
  if (isDarkTheme) {
    return rowIndex % 2 === 0 ? GRILLA.stripeDarkEven : GRILLA.stripeDarkOdd;
  }
  return rowIndex % 2 === 0 ? GRILLA.stripeLightEven : GRILLA.stripeLightOdd;
}

function getGrillaActiveRowBg(isDarkTheme: boolean) {
  return isDarkTheme ? GRILLA.activeRowBgDark : GRILLA.activeRowBgLight;
}

function getGrillaEditableCellBg(isDarkTheme: boolean) {
  return isDarkTheme ? GRILLA.editableCellBgDark : GRILLA.editableCellBgLight;
}

function getGrillaDisabledCellBg(isDarkTheme: boolean) {
  return isDarkTheme ? GRILLA.disabledCellBgDark : GRILLA.disabledCellBgLight;
}

function getGrillaFocusCellBg(isDarkTheme: boolean) {
  return isDarkTheme ? GRILLA.focusCellBgDark : GRILLA.focusCellBgLight;
}

function getGrillaTextColor(isDarkTheme: boolean) {
  return isDarkTheme ? "var(--text)" : "#0f172a";
}

export default function TeacherPage() {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string>("");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<TeacherView>("");

  const [items, setItems] = useState<EvalItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [_loadingClasses, setLoadingClasses] = useState(false);
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const levelMap = useMemo<Record<number, string>>(
    () => Object.fromEntries(levels.map((l) => [l.id, l.name])),
    [levels]
  );

  const [dashboard, setDashboard] = useState<TeacherDashboardResponse | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  const [anioLectivoItems, setAnioLectivoItems] = useState<AnioLectivoItem[]>([]);
  const [teacherYear, setTeacherYear] = useState<number | null>(null);
  const [dashLevelFilter, setDashLevelFilter] = useState<number | "all">("all");
  const [dashCourseFilter, setDashCourseFilter] = useState<number | "all">("all");

  // ===== FILTROS POR PANEL =====
  // EVALS
  const [evalLevelFilter, setEvalLevelFilter] = useState<LevelValue>("all");
  const [evalCourseFilter, setEvalCourseFilter] = useState<number | "all">("all");
  const [evalModuleFilter, setEvalModuleFilter] = useState<string>("");
  const [evalClassFilter, setEvalClassFilter] = useState<number | string>("all");

  // CREATE
  const [createLevelFilter, setCreateLevelFilter] = useState<LevelValue>("");
  const [createModuleFilter, setCreateModuleFilter] = useState<string>("");
  const [createClassFilter, setCreateClassFilter] = useState<string>("all");

  // CrearExamen overlay
  const [showCrearExamen, setShowCrearExamen]             = useState(false);
  const [crearExamenCtx, setCrearExamenCtx]               = useState<CrearExamenCtx | null>(null);
  const [crearExamenInitialData, setCrearExamenInitialData] = useState<ExamInitialData | null>(null);
  const [crearExamenExamId, setCrearExamenExamId]         = useState<number | null>(null);

  // UPSERT
  const [upsertLevelFilter, setUpsertLevelFilter] = useState<LevelValue>("");
  const [upsertCourseFilter, setUpsertCourseFilter] = useState<number | "all">("all");

  // table-header filters (client-side, computed from allSections)
  const [thFilterLevel, setThFilterLevel] = useState("");
  const [thFilterModule, setThFilterModule] = useState("");
  const [thFilterGroup, setThFilterGroup] = useState("");
  const [thFilterClass, setThFilterClass] = useState("");
  const [thFilterCedula, setThFilterCedula] = useState("");
  const [thFilterName, setThFilterName] = useState("");

  // cursos de creación
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);

  // tipos
  const [types, setTypes] = useState<EvalTypeItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // título
  const [titleOther, setTitleOther] = useState<string>("");

  // crear evaluación
  const [cCourse, setCCourse] = useState<string>("");
  const [cType, setCType] = useState<string>("");
  const [cTypeOther, setCTypeOther] = useState<string>("");
  const [cPercent, setCPercent] = useState<string>("0");
  const [creating, setCreating] = useState(false);

  const [editPercents, setEditPercents] = useState<Record<number, string>>({});
  const [editPercentFocused, setEditPercentFocused] = useState<Record<number, boolean>>({});
  const [cPercentFocused, setCPercentFocused] = useState(false);
  const [savingEvalPercent, setSavingEvalPercent] = useState<Record<number, boolean>>({});
  const [deletingEval, setDeletingEval] = useState<Record<number, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ evalId: number; title: string; gradeCount: number } | null>(null);

  const [allSections, setAllSections] = useState<GradeGridResponse[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);
  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  const [percentDraft, setPercentDraft] = useState<Record<number, string>>({});
  const [_savingPercents, setSavingPercents] = useState(false);
  const [savingEvalRow, setSavingEvalRow] = useState<Record<number, boolean>>({});

  const [editingRow, setEditingRow] = useState<Record<string, boolean>>({});
  const [rowSnapshot, setRowSnapshot] = useState<Record<string, Record<string, string>>>({});

  const [msgKind, setMsgKind] = useState<"ok" | "err">("err");
  const msgTimer = useRef<number | null>(null);

  const pendingThFilterClassRef = useRef<string | null>(null);
  const loadIdRef = useRef(0);
  const resetFiltersOnNextLoad = useRef(false);

  const CEDULA_COL_W = 150;
  const ALUMNO_COL_W = 260;
  const EVAL_COL_W = 170;
  const ACTION_COL_W = 160;
  const STICKY_ALUMNO_LEFT = CEDULA_COL_W;

  function resetView(v: TeacherView) {
    switch (v) {
      case "DASHBOARD":
        setDashLevelFilter("all");
        setDashCourseFilter("all");
        break;
      case "EVALS":
        setEvalLevelFilter("all");
        setEvalCourseFilter("all");
        setEvalModuleFilter("");
        setEvalClassFilter("all");
        break;
      case "CREATE":
        setCreateLevelFilter("");
        setCreateModuleFilter("");
        setCreateClassFilter("all");
        setCCourse("");
        setCType("");
        setCTypeOther("");
        setTitleOther("");
        setCPercent("0");
        setEditPercents({});
        break;
      case "UPSERT":
        setUpsertLevelFilter("");
        setUpsertCourseFilter("all");
        setThFilterLevel("");
        setThFilterModule("");
        setThFilterGroup("");
        setThFilterClass("");
        setThFilterCedula("");
        setThFilterName("");
        setAllSections([]);
        setGradeDraft({});
        setEditingRow({});
        setRowSnapshot({});
        break;
    }
  }

  function goToUpsertFromEvaluation(item: EvalItem) {
    const classId = Number(item.id_class);
    const level = Number(item.class?.level ?? 0);

    if (!classId || !level) return;

    setMsg(null);
    setView("UPSERT");

    if (Number(upsertLevelFilter) === level) {
      // Data already loaded for this level — just set the class filter by ID
      setThFilterClass(String(classId));
      return;
    }

    // Need to load new level — store the pending class ID to apply after load
    pendingThFilterClassRef.current = String(classId);
    setUpsertLevelFilter(level);
  }

  function getEvaluationListLabel(e: EvalItem) {
    const typeText = String(e.evaluation_type?.type || "").trim();
    const titleText = String(e.title || "").trim();

    if (typeText && titleText) return `${typeText} · ${titleText}`;
    if (titleText) return titleText;
    if (typeText) return typeText;
    return `Evaluación ${e.id}`;
  }

  function flash(text: string, kind: "ok" | "err" = "ok") {
    setMsg(text);
    setMsgKind(kind);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 3000);
  }

  useEffect(() => {
    setLogoUrl("/logo.png");
  }, []);

  // auth guard
  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const params = new URLSearchParams(window.location.search);
        const impToken = params.get("impersonate");

        if (impToken) {
          setImpersonateToken(impToken);
          const info = await apiFetch("/api/auth/me");
          setMe(info);
        } else {
          if (!getSession()) return router.replace("/login");

          const info = await apiFetch("/api/auth/me");
          setMe(info);
          const activeRole = getActiveRole(info);

          if (activeRole !== "T") return router.replace(roleToRoute(activeRole));
        }
      } catch {
        router.replace("/login");
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [router]);

  async function loadMyClasses(year?: number | null) {
    setLoadingClasses(true);
    try {
      const url = year ? `/api/teacher/classes?year=${year}` : "/api/teacher/classes";
      const res = await apiFetch(url);
      setMyClasses(res?.items || []);
    } catch (e) {
      setMyClasses([]);
      setMsg((e as { message?: string })?.message || "Error cargando materias del profesor");
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadDashboard(year?: number | null) {
    setLoadingDashboard(true);
    try {
      const url = year ? `/api/teacher/dashboard?year=${year}` : "/api/teacher/dashboard";
      const res = await apiFetch(url);
      setDashboard(res || null);
    } catch (e) {
      setDashboard(null);
      setMsg((e as { message?: string })?.message || "Error cargando dashboard del profesor");
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function loadEvaluations(year?: number | null) {
    setMsg(null);
    setLoadingList(true);
    try {
      const url = year ? `/api/teacher/evaluations?year=${year}` : "/api/teacher/evaluations";
      const res = await apiFetch(url);
      setItems(res?.items || []);
    } catch (e) {
      setItems([]);
      setMsg((e as { message?: string })?.message || "Error cargando evaluaciones");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadTeacherCourses(year?: number | null) {
    setLoadingCourses(true);
    try {
      const url = year ? `/api/teacher/courses?year=${year}` : "/api/teacher/courses";
      const res = await apiFetch(url);
      setCourses(res?.items || []);
    } catch (e) {
      setCourses([]);
      setMsg((e as { message?: string })?.message || "Error cargando cursos del profesor");
    } finally {
      setLoadingCourses(false);
    }
  }

  async function loadTeacherLevels(year?: number | null) {
    try {
      const url = year ? `/api/teacher/levels?year=${year}` : "/api/teacher/levels";
      const res = await apiFetch(url);
      setLevels(res?.items || []);
    } catch {
      setLevels([]);
    }
  }

  async function loadTypes() {
    setLoadingTypes(true);
    setTypes([]);
    try {
      const res = await apiFetch("/api/teacher/evaluation-types");
      setTypes(res?.items || []);
    } catch (e) {
      setTypes([]);
      setMsg((e as { message?: string })?.message || "Error cargando tipos de evaluación");
    } finally {
      setLoadingTypes(false);
    }
  }

  // Signals that the next teacherYear change was triggered by the mount effect (not the user)
  const initialYearSetRef = useRef(false);

  useEffect(() => {
    if (!loadingMe) {
      apiFetch("/api/student/anio-lectivo")
        .then((res) => {
          const items: AnioLectivoItem[] = res?.items || [];
          setAnioLectivoItems(items);
          const activo = items.find(i => i.activo);
          const year = activo?.year ?? null;
          initialYearSetRef.current = true; // mark before setting state
          setTeacherYear(year);
          loadMyClasses(year);
          loadDashboard(year);
          loadTypes();
          loadEvaluations(year);
          loadTeacherCourses(year);
          loadTeacherLevels(year);
        })
        .catch(() => {
          loadMyClasses(null);
          loadDashboard(null);
          loadTypes();
          loadEvaluations(null);
          loadTeacherCourses(null);
          loadTeacherLevels(null);
        });
    }
  }, [loadingMe]);

  useEffect(() => {
    // Skip the initial year set triggered by the mount effect (already loaded there)
    if (initialYearSetRef.current) {
      initialYearSetRef.current = false;
      return;
    }
    if (teacherYear === null) return;
    // User changed year — reload all data and clear the grade grid
    setAllSections([]);
    setUpsertLevelFilter("");
    // If on CREATE (write-only view), kick back to the selector
    setView((v) => (v === "CREATE" ? "" : v));
    loadMyClasses(teacherYear);
    loadDashboard(teacherYear);
    loadEvaluations(teacherYear);
    loadTeacherCourses(teacherYear);
    loadTeacherLevels(teacherYear);
  }, [teacherYear]);

  // =========================
  // DASHBOARD FILTERS
  // =========================
  const dashAssignments = useMemo(() => dashboard?.assignments || [], [dashboard]);

  const dashLevels = useMemo(() => {
    const set = new Set<number>();
    for (const a of dashAssignments) set.add(a.level);
    return [...set].sort((a, b) => a - b);
  }, [dashAssignments]);

  const dashCoursesForLevel = useMemo(() => {
    const seen = new Map<number, string>();
    for (const a of dashAssignments) {
      if (dashLevelFilter !== "all" && a.level !== dashLevelFilter) continue;
      if (a.course_id) seen.set(a.course_id, a.course_name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [dashAssignments, dashLevelFilter]);

  const dashAssignmentsFiltered = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });
    return dashAssignments
      .filter((a) => {
        if (dashLevelFilter !== "all" && a.level !== dashLevelFilter) return false;
        if (dashCourseFilter !== "all" && a.course_id !== dashCourseFilter) return false;
        return true;
      })
      .sort((a, b) =>
        a.level - b.level ||
        cmp(String(a.course_name ?? ""), String(b.course_name ?? "")) ||
        cmp(String(a.module_name ?? ""), String(b.module_name ?? "")) ||
        cmp(String(a.group_name ?? ""), String(b.group_name ?? "")) ||
        cmp(String(a.class_name ?? ""), String(b.class_name ?? ""))
      );
  }, [dashAssignments, dashLevelFilter, dashCourseFilter]);

  const dashSummary = useMemo(() => {
    const studentCountByCourse = new Map<number, number>();

    for (const assignment of dashAssignmentsFiltered) {
      if (!assignment.course_id) continue;
      studentCountByCourse.set(
        assignment.course_id,
        Math.max(
          studentCountByCourse.get(assignment.course_id) ?? 0,
          Number(assignment.course_student_count ?? 0)
        )
      );
    }

    return {
      assigned_classes: dashAssignmentsFiltered.length,
      total_students: [...studentCountByCourse.values()].reduce((sum, count) => sum + count, 0),
      academic_year: dashboard?.summary?.academic_year ?? teacherYear ?? new Date().getFullYear(),
    };
  }, [dashboard?.summary?.academic_year, dashAssignmentsFiltered, teacherYear]);

  // =========================
  // AÑO LECTIVO
  // =========================
  const activoYear = useMemo(() => anioLectivoItems.find(a => a.activo)?.year ?? null, [anioLectivoItems]);
  const isHistoricalYear = teacherYear !== null && teacherYear !== activoYear;

  // =========================
  // HELPERS GENERALES
  // =========================
  const _availableLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of myClasses) {
      if (Number.isFinite(Number(c.level))) set.add(Number(c.level));
    }
    return [...set].sort((a, b) => a - b);
  }, [myClasses]);

  // =========================
  // EVALS FILTERS
  // =========================
  const _evalClassesFiltered = useMemo(() => {
    if (evalLevelFilter === "all") return myClasses;
    if (evalLevelFilter === "") return [];
    return myClasses.filter((c) => Number(c.level) === Number(evalLevelFilter));
  }, [myClasses, evalLevelFilter]);

  // Cascade options for EVALS — derived directly from myClasses/courses (no cross-reference with items)
  const myClassesMap = useMemo(
    () => new Map(myClasses.map((c) => [c.id, c])),
    [myClasses]
  );

  const evalLevelOptions = useMemo(() => {
    const seen = new Set<number>();
    const out: { value: number; label: string }[] = [];
    for (const c of myClasses) {
      const lvl = Number(c.level);
      if (lvl && !seen.has(lvl)) {
        seen.add(lvl);
        out.push({ value: lvl, label: levelLabel(lvl, levelMap) });
      }
    }
    return out.sort((a, b) => a.value - b.value);
  }, [myClasses, levelMap]);

  const evalCourseOptions = useMemo(() => {
    const levelNum = evalLevelFilter !== "all" && evalLevelFilter !== "" ? Number(evalLevelFilter) : null;
    return courses
      .filter((c) => levelNum === null || Number(c.level) === levelNum)
      .map((c) => ({ id: c.id, name: String(c.name ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [courses, evalLevelFilter]);

  const evalModuleOptions = useMemo(() => {
    const levelNum = evalLevelFilter !== "all" && evalLevelFilter !== "" ? Number(evalLevelFilter) : null;
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const c of myClasses) {
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "");
      if (modName && !seen.has(modName)) {
        seen.add(modName);
        out.push({ value: modName, label: modName });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [myClasses, evalLevelFilter]);

  const evalClassOptions = useMemo(() => {
    const levelNum = evalLevelFilter !== "all" && evalLevelFilter !== "" ? Number(evalLevelFilter) : null;
    const out: { value: string; label: string }[] = [];

    // Materias sin grupo de evaluación
    for (const c of myClasses) {
      if (c.id_group) continue;
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      if (evalModuleFilter) {
        const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "");
        if (modName !== evalModuleFilter) continue;
      }
      out.push({ value: String(c.id), label: String(c.name ?? "") });
    }

    // Grupos asignados al profesor
    const seenGrpIds = new Set<number>();
    for (const ev of items) {
      if (!ev.id_group || !ev.group) continue;
      if (levelNum !== null && Number(ev.course?.level) !== levelNum) continue;
      if (evalModuleFilter && ev.module?.name !== evalModuleFilter) continue;
      if (seenGrpIds.has(ev.id_group)) continue;
      seenGrpIds.add(ev.id_group);
      out.push({ value: `grp:${ev.id_group}`, label: ev.group.name });
    }

    return out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [myClasses, items, evalLevelFilter, evalModuleFilter]);

  const evalItemsFiltered = useMemo(() => {
    let list = [...items];

    if (evalLevelFilter !== "all" && evalLevelFilter !== "") {
      const levelNum = Number(evalLevelFilter);
      list = list.filter((e) => {
        const cls = myClassesMap.get(Number(e.id_class));
        if (cls) return Number(cls.level) === levelNum;
        return Number(e.class?.level ?? e.course?.level ?? 0) === levelNum;
      });
    }

    if (evalCourseFilter !== "all") {
      list = list.filter((e) => Number(e.id_course) === Number(evalCourseFilter));
    }

    if (evalModuleFilter) {
      list = list.filter((e) => {
        const modName = e.module?.name ?? (e.id_module ? `Módulo ${e.id_module}` : "");
        return modName === evalModuleFilter;
      });
    }

    if (evalClassFilter !== "all") {
      const val = String(evalClassFilter);
      if (val.startsWith("grp:")) {
        const grpId = Number(val.slice(4));
        list = list.filter((e) => Number(e.id_group) === grpId);
      } else {
        list = list.filter((e) => Number(e.id_class) === Number(evalClassFilter));
      }
    }

    return list;
  }, [items, myClassesMap, evalLevelFilter, evalCourseFilter, evalModuleFilter, evalClassFilter]);

  const evalsInSelectedClass = useMemo(() => {
    if (evalClassFilter === "all") return [];
    return items.filter((e) => e.id_class === Number(evalClassFilter));
  }, [items, evalClassFilter]);

  useEffect(() => {
    setEvalCourseFilter("all");
    setEvalModuleFilter("");
    setEvalClassFilter("all");
  }, [evalLevelFilter]);

  useEffect(() => {
    setEvalModuleFilter("");
    setEvalClassFilter("all");
  }, [evalCourseFilter]);

  useEffect(() => {
    setEvalClassFilter("all");
  }, [evalModuleFilter]);

  useEffect(() => {
    const next: Record<number, string> = {};
    for (const e of evalItemsFiltered) next[e.id] = String(Number(e.percent ?? 0));
    setPercentDraft(next);
  }, [evalItemsFiltered]);

  const _percentDirty = useMemo(() => {
    if (evalClassFilter === "all") return false;
    for (const e of evalsInSelectedClass) {
      const draft = (percentDraft[e.id] ?? "").trim();
      const n = Number(draft);
      if (!Number.isFinite(n)) continue;
      if (Number(n) !== Number(e.percent)) return true;
    }
    return false;
  }, [evalClassFilter, evalsInSelectedClass, percentDraft]);

  async function _updatePercents() {
    if (evalClassFilter === "all") {
      setMsg("Selecciona una materia específica primero.");
      return;
    }
    setMsg(null);
    setSavingPercents(true);

    try {
      const changes: Array<{ id: number; percent: number }> = [];

      for (const e of evalsInSelectedClass) {
        const raw = (percentDraft[e.id] ?? "").trim();
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        if (n === Number(e.percent)) continue;

        if (n <= 0 || n > 100) {
          throw new Error(`Porcentaje inválido en "${e.title}" (1..100)`);
        }
        changes.push({ id: e.id, percent: n });
      }

      if (changes.length === 0) {
        flash("No hay cambios para guardar", "ok");
        return;
      }

      await Promise.all(
        changes.map((c) =>
          apiFetch(`/api/teacher/evaluations/${c.id}`, {
            method: "PATCH",
            body: JSON.stringify({ percent: c.percent }),
          })
        )
      );

      flash("✅ Porcentajes actualizados", "ok");
      await loadEvaluations(teacherYear);
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error actualizando porcentajes");
      flash("❌ No se pudo actualizar", "err");
    } finally {
      setSavingPercents(false);
    }
  }

  async function handleUpdateEvalRow(evalId: number) {
    const val = Number(percentDraft[evalId]);
    if (!Number.isFinite(val) || val <= 0 || val > 100) {
      flash("Porcentaje inválido (1..100)", "err");
      return;
    }
    setSavingEvalRow((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/teacher/evaluations/${evalId}`, {
        method: "PATCH",
        body: JSON.stringify({ percent: val }),
      });
      setItems((prev) =>
        prev.map((e) => (e.id === evalId ? { ...e, percent: val } : e))
      );
      flash("% Actualizado", "ok");
    } catch (e) {
      flash((e as { message?: string })?.message || "Error al actualizar", "err");
    } finally {
      setSavingEvalRow((p) => ({ ...p, [evalId]: false }));
    }
  }

  // =========================
  // CREATE FILTERS
  // =========================
  const _selectedCreateCourse = useMemo(() => {
    const id = Number(cCourse);
    if (!id) return null;
    return courses.find((c) => Number(c.id) === id) || null;
  }, [cCourse, courses]);

  const createClassesFiltered = useMemo(() => {
    const levelNum = createLevelFilter && createLevelFilter !== "all" ? Number(createLevelFilter) : null;
    if (levelNum === null) return [];
    const courseNum = cCourse ? Number(cCourse) : null;
    return myClasses.filter((c) => {
      if (c.id_group) return false;
      if (Number(c.level) !== levelNum) return false;
      if (courseNum !== null && Number(c.id_course) !== courseNum) return false;
      if (createModuleFilter) {
        const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");
        if (modName !== createModuleFilter) return false;
      }
      return true;
    });
  }, [myClasses, createLevelFilter, cCourse, createModuleFilter]);

  const createClassOptions = useMemo(() => {
    const levelNum = createLevelFilter && createLevelFilter !== "all" ? Number(createLevelFilter) : null;
    if (levelNum === null) return [];
    const courseNum = cCourse ? Number(cCourse) : null;
    const out: { value: string; label: string }[] = [];
    for (const c of myClasses) {
      if (c.id_group) continue;
      if (Number(c.level) !== levelNum) continue;
      if (courseNum !== null && Number(c.id_course) !== courseNum) continue;
      if (createModuleFilter) {
        const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");
        if (modName !== createModuleFilter) continue;
      }
      out.push({ value: String(c.id), label: String(c.name ?? "") });
    }
    const seenGrpIds = new Set<number>();
    for (const c of myClasses) {
      if (!c.id_group) continue;
      if (Number(c.level) !== levelNum) continue;
      if (courseNum !== null && Number(c.id_course) !== courseNum) continue;
      if (createModuleFilter) {
        const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");
        if (modName !== createModuleFilter) continue;
      }
      if (seenGrpIds.has(c.id_group)) continue;
      seenGrpIds.add(c.id_group);
      out.push({ value: `grp:${c.id_group}`, label: c.group?.name ?? `Grupo ${c.id_group}` });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [myClasses, createLevelFilter, cCourse, createModuleFilter]);

  useEffect(() => {
    setCCourse("");
    setCreateModuleFilter("");
    setCreateClassFilter("all");

    setTitleOther("");
    setCPercent("0");
    setEditPercents({});
  }, [createLevelFilter]);

  useEffect(() => {
    setCreateClassFilter("all");
  }, [createModuleFilter]);

  useEffect(() => {
    setCreateModuleFilter("");
    setCreateClassFilter("all");

    setTitleOther("");
    setCPercent("0");
    setEditPercents({});
  }, [cCourse]);

  // Derived eval list — no extra API call needed, filter from already-loaded items
  const createEvalsFiltered = useMemo(() => {
    if (createLevelFilter === "") return [];
    const levelNum = Number(createLevelFilter);
    let filtered = items.filter(it => Number(it.class?.level ?? it.course?.level) === levelNum);
    if (cCourse) filtered = filtered.filter(it => Number(it.id_course) === Number(cCourse));
    if (createModuleFilter) filtered = filtered.filter(it => (it.module?.name ?? "") === createModuleFilter);
    if (createClassFilter !== "all") {
      if (createClassFilter.startsWith("grp:")) {
        const grpId = Number(createClassFilter.slice(4));
        filtered = filtered.filter(it => Number(it.id_group) === grpId);
      } else {
        filtered = filtered.filter(it => Number(it.id_class) === Number(createClassFilter));
      }
    }
    return filtered;
  }, [items, createLevelFilter, cCourse, createModuleFilter, createClassFilter]);


  // Auto-rellena el título con el nombre de la materia cuando tipo = "Examen"
  const selectedTypeNameForCreate = useMemo(() => {
    if (cType === "__other__") return cTypeOther.trim();
    return types.find(t => String(t.id) === cType)?.type || "";
  }, [cType, cTypeOther, types]);

  useEffect(() => {
    if (selectedTypeNameForCreate === "Examen" && createClassFilter !== "all") {
      if (createClassFilter.startsWith("grp:")) {
        const opt = createClassOptions.find(o => o.value === createClassFilter);
        if (opt) setTitleOther(opt.label);
      } else {
        const cls = createClassesFiltered.find(c => c.id === Number(createClassFilter));
        if (cls) setTitleOther(cls.name);
      }
    } else if (selectedTypeNameForCreate !== "Examen") {
      setTitleOther("");
    }
  }, [selectedTypeNameForCreate, createClassFilter, createClassesFiltered, createClassOptions]);

  async function handleSaveCreateEvalPercent(evalId: number) {
    const val = Number(editPercents[evalId]);
    if (!Number.isFinite(val) || val <= 0 || val > 100) {
      flash("Porcentaje inválido (1..100)", "err");
      return;
    }

    // Validar que la sumatoria del mismo id_class no supere 100
    const ev = items.find(e => e.id === evalId);
    if (ev) {
      const totalOtros = items
        .filter(e => e.id !== evalId && Number(e.id_class) === Number(ev.id_class))
        .reduce((s, e) => s + Number(e.percent), 0);
      if (totalOtros + val > 100) {
        flash(`El porcentaje total superaría 100% (existente: ${totalOtros}%, nuevo: ${val}%)`, "err");
        return;
      }
    }

    setSavingEvalPercent((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/teacher/evaluations/${evalId}`, {
        method: "PATCH",
        body: JSON.stringify({ percent: val }),
      });
      setItems((prev) => prev.map((e) => (e.id === evalId ? { ...e, percent: val } : e)));
      flash("Porcentaje actualizado", "ok");
    } catch (e) {
      flash((e as { message?: string })?.message || "Error al guardar", "err");
    } finally {
      setSavingEvalPercent((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function handleDeleteCreateEval(evalId: number) {
    setDeletingEval((p) => ({ ...p, [evalId]: true }));
    try {
      const result = await apiFetch(`/api/teacher/exam-grades?exam_id=${evalId}`);
      const gradeCount: number = (result?.items ?? []).length;
      if (gradeCount > 0) {
        const ev = items.find((e) => e.id === evalId);
        setDeleteConfirm({ evalId, title: ev?.title ?? "esta evaluación", gradeCount });
        return;
      }
      await doDeleteEval(evalId);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error al eliminar", "err");
    } finally {
      setDeletingEval((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function doDeleteEval(evalId: number) {
    setDeletingEval((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/teacher/evaluations/${evalId}`, { method: "DELETE" });
      setItems((prev) => prev.filter((e) => e.id !== evalId));
      setEditPercents((p) => { const n = { ...p }; delete n[evalId]; return n; });
      flash("Evaluación eliminada", "ok");
    } catch (e) {
      flash((e as { message?: string })?.message || "Error al eliminar", "err");
    } finally {
      setDeletingEval((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function handleEditExam(ev: EvalItem) {
    try {
      const data = await apiFetch(`/api/teacher/exams/${ev.id}`);
      const course = coursesForCreate.find(c => c.id === ev.id_course);
      const cls    = createClassesFiltered.find(c => c.id === ev.id_class)
                  ?? myClasses.find(c => c.id === ev.id_class);
      const lev    = levels.find(l => l.id === Number(createLevelFilter));
      setCrearExamenCtx({
        id_course:  ev.id_course ?? 0,
        id_class:   ev.id_class  ?? 0,
        id_module:  ev.id_module ?? null,
        id_group:   ev.id_group  ?? null,
        id_teacher: me?.profile?.id ?? me?.user?.id ?? null,
        title:      ev.title,
        percent:    Number(ev.percent),
        courseName: course ? String(course.name) : String(ev.id_course),
        className:  cls?.name ?? ev.class?.name ?? String(ev.id_class),
        moduleName: cls?.module?.name ?? ev.module?.name ?? null,
        levelName:  lev?.name ?? null,
      });
      setCrearExamenInitialData(data.item);
      setCrearExamenExamId(ev.id);
      setShowCrearExamen(true);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error cargando examen", "err");
    }
  }

  async function handleCreate() {
    setMsg(null);
    setMsgKind("err");

    const id_course = Number(cCourse);
    if (!id_course) return setMsg("Selecciona un curso.");

    if (createClassFilter === "all") {
      return setMsg("Selecciona una materia.");
    }

    const isGroupSelection = createClassFilter.startsWith("grp:");
    const selectedGroupId = isGroupSelection ? Number(createClassFilter.slice(4)) : null;
    const groupClass = isGroupSelection ? myClasses.find(c => Number(c.id_group) === selectedGroupId) : null;
    if (isGroupSelection && !groupClass) return setMsg("No se encontró una materia para este grupo.");
    const id_class = isGroupSelection ? groupClass!.id : Number(createClassFilter);

    let id_type = Number(cType);
    const isOtherType = cType === "__other__";
    const type_text = isOtherType ? cTypeOther.trim() : "";

    if (!id_type && !isOtherType) return setMsg("Selecciona un tipo.");
    if (isOtherType && !type_text) return setMsg("Escribe el tipo (Otro).");

    const title = titleOther.trim();
    if (!title) return setMsg("Escribe un título.");

    const percent = Number(cPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return setMsg("Porcentaje inválido (1..100).");
    }

    const totalExisting = items
      .filter((it) => isGroupSelection ? Number(it.id_group) === selectedGroupId : Number(it.id_class) === id_class)
      .reduce((s, e) => s + Number(e.percent), 0);
    if (totalExisting + percent > 100) {
      return setMsg(
        `El porcentaje total superaría 100% (existente: ${totalExisting}%, nuevo: ${percent}%). Ajusta los porcentajes antes de continuar.`
      );
    }

    // ── Tipo Examen: abrir CrearExamen en lugar del flujo normal ──
    const selectedTypeName = (!isOtherType ? types.find(t => t.id === Number(cType))?.type : type_text) || "";
    if (selectedTypeName === "Examen") {
      const course = coursesForCreate.find(c => c.id === id_course);
      const cls    = myClasses.find(c => c.id === id_class);
      const lev    = levels.find(l => l.id === Number(createLevelFilter));
      const label  = isGroupSelection ? (createClassOptions.find(o => o.value === createClassFilter)?.label ?? String(id_class)) : (cls?.name ?? String(id_class));
      setCrearExamenCtx({
        id_course,
        id_class,
        id_module:  cls?.id_module  ?? null,
        id_group:   selectedGroupId,
        id_teacher: me?.profile?.id ?? me?.user?.id ?? null,
        title,
        percent,
        courseName: course ? String(course.name) : String(id_course),
        className:  label,
        moduleName: cls?.module?.name ?? null,
        levelName:  lev?.name ?? null,
      });
      setCrearExamenExamId(null);
      setCrearExamenInitialData(null);
      setShowCrearExamen(true);
      return;
    }

    setCreating(true);
    try {
      if (isOtherType) {
        const created = await apiFetch("/api/teacher/evaluation-types", {
          method: "POST",
          body: JSON.stringify({ type: type_text }),
        });
        const newId = created?.item?.id ? Number(created.item.id) : 0;
        if (newId) {
          id_type = newId;
          await loadTypes();
          setCType(String(newId));
          setCTypeOther("");
        }
      }

      await apiFetch("/api/teacher/evaluations", {
        method: "POST",
        body: JSON.stringify({
          id_course,
          id_class,
          percent,
          title,
          id_type: id_type || undefined,
          type_text: isOtherType ? type_text : undefined,
        }),
      });

      setCType("");
      setCTypeOther("");
  
      setTitleOther("");
      setCPercent("0");

      // Reload items so createEvalsFiltered auto-updates
      await loadEvaluations(teacherYear);

      flash("Evaluación creada", "ok");
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error creando evaluación");
    } finally {
      setCreating(false);
    }
  }

  // =========================
  // UPSERT LOAD TRIGGER — Año change
  // =========================
  useEffect(() => {
    resetFiltersOnNextLoad.current = true; // next allSections load must reset all filters
    setAllSections([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});
    setUpsertCourseFilter("all");
    setThFilterModule("");
    setThFilterGroup("");
    setThFilterClass("");
    setThFilterCedula("");
    setThFilterName("");
    if (upsertLevelFilter === "") return;
    const filteredClasses = upsertLevelFilter === "all"
      ? myClasses
      : myClasses.filter((c) => Number(c.level) === Number(upsertLevelFilter));
    const ids      = filteredClasses.map((c) => c.id);
    const groupIds = [...new Set(filteredClasses.map((c) => c.id_group).filter((id): id is number => !!id))];
    if (ids.length === 0 && groupIds.length === 0) return;
    loadAllGradeGrids(ids, groupIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertLevelFilter]);

  // Apply pending class filter after load; only reset filters when triggered by Año change
  useEffect(() => {
    if (resetFiltersOnNextLoad.current) {
      resetFiltersOnNextLoad.current = false;
      setThFilterLevel("");
      setThFilterCedula("");
      setThFilterName("");
      if (pendingThFilterClassRef.current !== null) {
        setThFilterClass(pendingThFilterClassRef.current);
        pendingThFilterClassRef.current = null;
      }
    }
  }, [allSections]);

  // Limpiar filtros de texto al cambiar Módulo o Materia (sin recargar API — datos ya cargados)
  useEffect(() => {
    setThFilterCedula("");
    setThFilterName("");
  }, [thFilterModule, thFilterClass]);

  // =========================
  // FLAT ROWS (for UPSERT table)
  // =========================
  const flatRows = useMemo<FlatGradeRow[]>(() => {
    const studentMap = new Map<string, FlatGradeRow>();

    for (const section of allSections) {
      const isGroupSection = !section.class && !!section.group;
      if (!section.class && !isGroupSection) continue;
      const classId = section.class?.id ?? -(section.group!.id); // negative ID for groups
      const classEntry = section.class ? myClasses.find((c) => c.id === classId) : null;
      const groupClassEntry = isGroupSection
        ? myClasses.find((c) => c.id_group != null && Number(c.id_group) === section.group!.id)
        : null;
      const moduleSource = classEntry ?? groupClassEntry;
      const lvl = Number(section.class?.level ?? section.group?.level ?? 0);
      const lvlName = levelMap[lvl] ?? `Año ${lvl}`;
      const moduleId = moduleSource?.id_module ? Number(moduleSource.id_module) : null;
      const moduleName = moduleSource?.module?.name ?? (moduleId ? `Módulo ${moduleId}` : "—");
      const groupId = isGroupSection ? section.group!.id : (classEntry?.id_group ? Number(classEntry.id_group) : null);
      const groupName = isGroupSection ? section.group!.name : (classEntry?.group?.name ?? (groupId ? `Grupo ${groupId}` : "—"));
      const className = isGroupSection ? section.group!.name : section.class!.name;
      const ctx: SectionContext = { classId, className, moduleId, moduleName, groupId, groupName };
      const sectionEvals = section.evaluations || [];
      const sectionGrades = section.grades || [];

      for (const student of section.students || []) {
        const existing = studentMap.get(student.id);
        if (existing) {
          if (!existing.allSectionContexts.some((c) => c.classId === classId)) {
            existing.allSectionContexts.push(ctx);
            const evalIds = new Set(existing.sectionEvals.map((e) => e.id));
            for (const ev of sectionEvals) {
              if (!evalIds.has(ev.id)) existing.sectionEvals.push(ev);
            }
            const gradeKeys = new Set(existing.sectionGrades.map((g) => `${g.id_student}_${g.id_exam}`));
            for (const g of sectionGrades) {
              if (!gradeKeys.has(`${g.id_student}_${g.id_exam}`)) existing.sectionGrades.push(g);
            }
          }
        } else {
          studentMap.set(student.id, {
            classId,
            className,
            level: lvl,
            levelName: lvlName,
            moduleId,
            moduleName,
            groupId,
            groupName,
            allSectionContexts: [ctx],
            student,
            sectionEvals: [...sectionEvals],
            sectionGrades: [...sectionGrades],
          });
        }
      }
    }

    return Array.from(studentMap.values());
  }, [allSections, myClasses, levelMap]);

  // TH filter option memos
  const _thLevelOptions = useMemo(() => {
    const seen = new Set<number>();
    const out: { value: string; label: string }[] = [];
    for (const r of flatRows) {
      if (!seen.has(r.level)) {
        seen.add(r.level);
        out.push({ value: String(r.level), label: r.levelName });
      }
    }
    return out.sort((a, b) => Number(a.value) - Number(b.value));
  }, [flatRows]);

  const classModuleName = (c: TeacherClass) =>
    c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");

  const thModuleOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    const levelNum = upsertLevelFilter && upsertLevelFilter !== "all" ? Number(upsertLevelFilter) : null;
    for (const c of myClasses) {
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      const name = classModuleName(c);
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ value: name, label: name });
      }
    }
    return out;
  }, [myClasses, upsertLevelFilter]);

  const _thGroupOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    const levelNum = upsertLevelFilter && upsertLevelFilter !== "all" ? Number(upsertLevelFilter) : null;
    for (const c of myClasses) {
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      if (thFilterModule && classModuleName(c) !== thFilterModule) continue;
      const gName = c.group?.name ?? (c.id_group ? `Grupo ${c.id_group}` : "—");
      if (!seen.has(gName)) {
        seen.add(gName);
        out.push({ value: gName, label: gName });
      }
    }
    return out;
  }, [myClasses, upsertLevelFilter, thFilterModule]);

  const thClassOptions = useMemo(() => {
    const seenIds = new Set<number>();
    const out: { value: string; label: string }[] = [];
    const levelNum = upsertLevelFilter && upsertLevelFilter !== "all" ? Number(upsertLevelFilter) : null;
    const nameCounts = new Map<string, number>();
    for (const c of myClasses) {
      if (c.id_group) continue;
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      if (thFilterModule && classModuleName(c) !== thFilterModule) continue;
      nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
    }
    for (const c of myClasses) {
      if (c.id_group) continue;
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      if (thFilterModule && classModuleName(c) !== thFilterModule) continue;
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const hasDupe = (nameCounts.get(c.name) ?? 0) > 1;
      const label = hasDupe ? `${c.name} (${classModuleName(c)})` : c.name;
      out.push({ value: String(c.id), label });
    }
    // Add teacher's group evaluations
    const seenGrpIds = new Set<number>();
    for (const ev of items) {
      if (!ev.id_group || !ev.group) continue;
      if (levelNum !== null && Number(ev.course?.level) !== levelNum) continue;
      if (thFilterModule && ev.module?.name !== thFilterModule) continue;
      if (seenGrpIds.has(ev.id_group)) continue;
      seenGrpIds.add(ev.id_group);
      out.push({ value: `grp:${ev.id_group}`, label: ev.group.name });
    }
    return out;
  }, [myClasses, upsertLevelFilter, thFilterModule, items]);

  const ctxMatches = (r: FlatGradeRow) => {
    const isGrpFilter = thFilterClass.startsWith("grp:");
    const grpFilterId = isGrpFilter ? Number(thFilterClass.slice(4)) : null;
    return r.allSectionContexts.some(
      (ctx) =>
        (!thFilterModule || ctx.moduleName === thFilterModule) &&
        (!thFilterGroup || ctx.groupName === thFilterGroup) &&
        (!thFilterClass || (isGrpFilter ? ctx.groupId === grpFilterId : ctx.classId === Number(thFilterClass)))
    );
  };

  const thCedulaOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of flatRows) {
      if (thFilterLevel && String(r.level) !== thFilterLevel) continue;
      if ((thFilterModule || thFilterGroup || thFilterClass) && !ctxMatches(r)) continue;
      if (!seen.has(r.student.cedula)) {
        seen.add(r.student.cedula);
        out.push({ value: r.student.cedula, label: r.student.cedula });
      }
    }
    return out;
  }, [flatRows, thFilterLevel, thFilterModule, thFilterGroup, thFilterClass]); // eslint-disable-line react-hooks/exhaustive-deps

  const thNameOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of flatRows) {
      if (thFilterLevel && String(r.level) !== thFilterLevel) continue;
      if ((thFilterModule || thFilterGroup || thFilterClass) && !ctxMatches(r)) continue;
      if (thFilterCedula && r.student.cedula !== thFilterCedula) continue;
      if (!seen.has(r.student.name)) {
        seen.add(r.student.name);
        out.push({ value: r.student.name, label: r.student.name });
      }
    }
    return out;
  }, [flatRows, thFilterLevel, thFilterModule, thFilterGroup, thFilterClass, thFilterCedula]); // eslint-disable-line react-hooks/exhaustive-deps

  const coursesForUpsert = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === "all") return courses;
    return courses.filter((c) => Number(c.level) === Number(upsertLevelFilter));
  }, [courses, upsertLevelFilter]);

  const coursesForCreate = useMemo(() => {
    if (createLevelFilter === "" || createLevelFilter === "all") return courses;
    return courses.filter((c) => Number(c.level) === Number(createLevelFilter));
  }, [courses, createLevelFilter]);

  const createModuleOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    const levelNum = createLevelFilter && createLevelFilter !== "all" ? Number(createLevelFilter) : null;
    if (levelNum === null) return out;
    const courseNum = cCourse ? Number(cCourse) : null;
    for (const c of myClasses) {
      if (Number(c.level) !== levelNum) continue;
      if (courseNum !== null && Number(c.id_course) !== courseNum) continue;
      const name = classModuleName(c);
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ value: name, label: name });
      }
    }
    return out;
  }, [myClasses, createLevelFilter, cCourse]);

  const flatRowsFiltered = useMemo<FlatGradeRow[]>(() => {
    return flatRows.filter((r) => {
      if (upsertCourseFilter !== "all" && Number(r.student.id_course) !== Number(upsertCourseFilter)) return false;
      if (thFilterLevel && String(r.level) !== thFilterLevel) return false;
      if (thFilterModule || thFilterGroup || thFilterClass) {
        if (!ctxMatches(r)) return false;
      }
      if (thFilterCedula && r.student.cedula !== thFilterCedula) return false;
      if (thFilterName && r.student.name !== thFilterName) return false;
      return true;
    });
  }, [flatRows, upsertCourseFilter, thFilterLevel, thFilterModule, thFilterGroup, thFilterClass, thFilterCedula, thFilterName]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEvals = useMemo<EvalItem[]>(() => {
    const seenEvalIds = new Set<number>();
    const out: EvalItem[] = [];

    // Build the set of class IDs in scope based on the active module/class filter
    const levelNum = upsertLevelFilter && upsertLevelFilter !== "all" ? Number(upsertLevelFilter) : null;
    let scopeClassIds: Set<number> | null = null;
    let scopeGroupId: number | null = null;

    if (thFilterClass && !thFilterClass.startsWith("grp:")) {
      scopeClassIds = new Set([Number(thFilterClass)]);
    } else if (thFilterClass && thFilterClass.startsWith("grp:")) {
      scopeGroupId = Number(thFilterClass.slice(4));
    } else if (thFilterModule) {
      scopeClassIds = new Set<number>();
      for (const c of myClasses) {
        if (levelNum !== null && Number(c.level) !== levelNum) continue;
        if (classModuleName(c) === thFilterModule) scopeClassIds.add(Number(c.id));
      }
    }

    for (const r of flatRowsFiltered) {
      for (const ev of r.sectionEvals) {
        if (scopeClassIds !== null) {
          if (ev.id_class !== null) {
            if (!scopeClassIds.has(Number(ev.id_class))) continue;
          } else if (ev.id_group != null) {
            const groupInModule = myClasses.some(
              c => c.id_group != null && Number(c.id_group) === Number(ev.id_group) && classModuleName(c) === thFilterModule
            );
            if (!groupInModule) continue;
          } else {
            continue;
          }
        } else if (scopeGroupId !== null) {
          if (ev.id_group != null) {
            if (Number(ev.id_group) !== scopeGroupId) continue;
          } else if (ev.id_class != null) {
            const classInGroup = myClasses.some(
              c => c.id === Number(ev.id_class) && c.id_group != null && Number(c.id_group) === scopeGroupId
            );
            if (!classInGroup) continue;
          } else {
            continue;
          }
        }
        if (!seenEvalIds.has(ev.id)) {
          seenEvalIds.add(ev.id);
          out.push(ev);
        }
      }
    }
    return out.sort((a, b) => {
      const ca = a.id_class ?? 0;
      const cb = b.id_class ?? 0;
      if (ca !== cb) return ca - cb;
      return a.id - b.id;
    });
  }, [flatRowsFiltered, myClasses, upsertLevelFilter, thFilterModule, thFilterClass]);

  const upsertDynamicMinWidth = useMemo(() => {
    return 260 + 150 + visibleEvals.length * 170 + 160;
  }, [visibleEvals]);

  async function loadAllGradeGrids(classIds: number[], groupIds: number[] = []) {
    const myId = ++loadIdRef.current;
    setMsg(null);
    setGLoadingRoster(true);
    setAllSections([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});

    try {
      const fetches: Promise<GradeGridResponse[]>[] = [];

      if (classIds.length > 0) {
        fetches.push(
          apiFetch(`/api/teacher/grade-grids-batch?class_ids=${classIds.join(",")}`)
            .then((r: { sections: GradeGridResponse[] }) => (r?.sections ?? []).filter((s) => s?.class))
        );
      }
      for (const gid of groupIds) {
        fetches.push(
          apiFetch(`/api/teacher/group-grade-grid?group_id=${gid}`)
            .then((r: GradeGridResponse) => (r?.group ? [r] : []))
            .catch(() => [])
        );
      }

      const results = await Promise.all(fetches);
      if (myId !== loadIdRef.current) return;

      const sections = results.flat();
      setAllSections(sections);

      const drafts: Record<string, string> = {};
      for (const section of sections) {
        for (const g of section.grades || []) {
          drafts[gradeCellKey(g.id_student, g.id_exam)] =
            !g.finished_at || g.grade === null || g.grade === undefined ? "" : String(Number(g.grade));
        }
      }
      setGradeDraft(drafts);
    } catch (e) {
      if (myId !== loadIdRef.current) return;
      setMsg((e as { message?: string })?.message || "Error cargando alumnos/notas");
      setAllSections([]);
      setGradeDraft({});
    } finally {
      if (myId === loadIdRef.current) setGLoadingRoster(false);
    }
  }

  function loadGradeGrid() {
    if (upsertLevelFilter === "") return;
    const filteredClasses = upsertLevelFilter === "all"
      ? myClasses
      : myClasses.filter((c) => Number(c.level) === Number(upsertLevelFilter));
    const ids      = filteredClasses.map((c) => c.id);
    const groupIds = [...new Set(filteredClasses.map((c) => c.id_group).filter((id): id is number => !!id))];
    loadAllGradeGrids(ids, groupIds);
  }

  function getEvaluationColumnLabel(ev: EvalItem, _countsMap: Map<string, number>) {
    const materia = String(ev.class?.name || "").trim();
    const tipo = String(ev.evaluation_type?.type || "").trim();
    const titulo = String(ev.title || "").trim();
    const pct = `${Number(ev.percent).toFixed(0)}%`;
    const parts = [materia, tipo, titulo, pct].filter(Boolean);
    return parts.join("-");
  }

  function isEvaluationApplicableToStudent(student: StudentRow, ev: EvalItem) {
    return Number(student.id_course) === Number(ev.id_course);
  }

  function getStudentApplicableEvaluations(student: StudentRow, evals: EvalItem[]) {
    return evals.filter((ev) => isEvaluationApplicableToStudent(student, ev));
  }

  function beginEdit(student: StudentRow, sectionEvals: EvalItem[]) {
    const applicableEvals = getStudentApplicableEvaluations(student, sectionEvals);
    if (applicableEvals.length === 0) {
      setMsg(`No hay evaluaciones aplicables para ${student.name}`);
      flash("❌ No hay evaluaciones para actualizar", "err");
      return;
    }

    const snapshot: Record<string, string> = {};
    for (const ev of applicableEvals) {
      const key = gradeCellKey(student.id, ev.id);
      snapshot[key] = gradeDraft[key] ?? "";
    }

    setRowSnapshot((prev) => ({ ...prev, [student.id]: snapshot }));
    setEditingRow((prev) => ({ ...prev, [student.id]: true }));
    setMsg(null);
  }

  function cancelEdit(student: StudentRow) {
    const snapshot = rowSnapshot[student.id] || {};
    setGradeDraft((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(snapshot)) {
        next[key] = value;
      }
      return next;
    });

    setEditingRow((prev) => ({ ...prev, [student.id]: false }));
  }

  async function handleRowAction(student: StudentRow, sectionEvals: EvalItem[]) {
    if (!editingRow[student.id]) {
      beginEdit(student, sectionEvals);
      return;
    }

    await saveOne(student, sectionEvals);
  }

  async function saveOne(student: StudentRow, sectionEvals: EvalItem[]) {
    const applicableEvals = getStudentApplicableEvaluations(student, sectionEvals);

    if (applicableEvals.length === 0) {
      setMsg(`No hay evaluaciones aplicables para ${student.name}`);
      flash("❌ No hay evaluaciones para actualizar", "err");
      return;
    }

    // Only save evaluations that have a value entered — skip empty cells
    const evalsToSave = applicableEvals.filter((ev) => {
      const key = gradeCellKey(student.id, ev.id);
      return (gradeDraft[key] ?? "").trim() !== "";
    });

    if (evalsToSave.length === 0) {
      setMsg(`No hay notas ingresadas para ${student.name}`);
      flash("❌ No hay notas para guardar", "err");
      return;
    }

    setSavingOne((prev) => ({ ...prev, [student.id]: true }));
    setMsg(null);

    try {
      for (const ev of evalsToSave) {
        const key = gradeCellKey(student.id, ev.id);
        const draft = (gradeDraft[key] ?? "").trim();
        const grade = Number(draft);

        if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
          throw new Error(
            `Nota inválida para ${student.name} en "${getEvaluationColumnLabel(ev, new Map())}" (0..100)`
          );
        }
      }

      await Promise.all(
        evalsToSave.map((ev) => {
          const key = gradeCellKey(student.id, ev.id);
          return apiFetch("/api/teacher/grades", {
            method: "POST",
            body: JSON.stringify({
              exam_id: ev.id,
              student_cedula: student.cedula,
              student_id: student.id,
              grade: Number(gradeDraft[key]),
            }),
          });
        })
      );

      // Patch allSections in-place so noPresentó updates immediately without a reload
      setAllSections((prev) => prev.map((section) => {
        const sectionEvalIds = new Set((section.evaluations || []).map((e) => e.id));
        const applicableHere = evalsToSave.filter((ev) => sectionEvalIds.has(ev.id));
        if (applicableHere.length === 0) return section;
        const patchedGrades = [...(section.grades || [])];
        const finishedAt = new Date().toISOString();
        for (const ev of applicableHere) {
          const key = gradeCellKey(student.id, ev.id);
          const savedGrade = Number(gradeDraft[key]);
          const idx = patchedGrades.findIndex((g) => g.id_student === student.id && g.id_exam === ev.id);
          if (idx >= 0) {
            patchedGrades[idx] = { ...patchedGrades[idx], grade: savedGrade, attempts: Math.max(1, Number(patchedGrades[idx].attempts ?? 0)), finished_at: finishedAt };
          } else {
            patchedGrades.push({ id_student: student.id, id_exam: ev.id, grade: savedGrade, attempts: 1, finished_at: finishedAt });
          }
        }
        return { ...section, grades: patchedGrades };
      }));

      setEditingRow((prev) => ({ ...prev, [student.id]: false }));
      setRowSnapshot((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });

      flash(`✅ Notas guardadas: ${student.name}`, "ok");
    } catch (e) {
      const errorMessage = (e as { message?: string })?.message || `Error guardando notas de ${student.name}`;
      setMsg(errorMessage);
      flash(`Error guardando: ${student.name}. ${errorMessage}`, "err");
    } finally {
      setSavingOne((prev) => ({ ...prev, [student.id]: false }));
    }
  }

  async function _saveAll() {
    const hasSections = allSections.some(
      (s) => (s.students?.length ?? 0) > 0 && (s.evaluations?.length ?? 0) > 0
    );
    if (!hasSections) return;

    setSavingAll(true);
    setMsg(null);

    try {
      const payloads: Array<{ exam_id: number; student_cedula: string | null; student_id: string; grade: number }> = [];

      for (const section of allSections) {
        for (const st of section.students || []) {
          const applicableEvals = getStudentApplicableEvaluations(st, section.evaluations || []);

          for (const ev of applicableEvals) {
            const key = gradeCellKey(st.id, ev.id);
            const raw = (gradeDraft[key] ?? "").trim();
            const n = raw === "" ? NaN : Number(raw);

            if (!Number.isFinite(n) || n < 0 || n > 100) {
              throw new Error(
                `Nota inválida para ${st.name} en "${getEvaluationColumnLabel(ev, new Map())}" (0..100)`
              );
            }

            payloads.push({
              exam_id: ev.id,
              student_cedula: st.cedula,
              student_id: st.id,
              grade: n,
            });
          }
        }
      }

      await Promise.all(
        payloads.map((p) =>
          apiFetch("/api/teacher/grades", {
            method: "POST",
            body: JSON.stringify(p),
          })
        )
      );

      setEditingRow({});
      setRowSnapshot({});
      loadGradeGrid();
      flash("✅ Notas actualizadas", "ok");
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error actualizando todas las notas");
      flash("❌ Error actualizando todas", "err");
    } finally {
      setSavingAll(false);
    }
  }

  function downloadExcel() {
    const label = (thFilterClass ? (myClasses.find(c => c.id === Number(thFilterClass))?.name ?? "") : "") || thFilterModule
      || (upsertCourseFilter !== "all" ? coursesForUpsert.find(c => c.id === Number(upsertCourseFilter))?.name : undefined)
      || (upsertLevelFilter !== "" ? (levels.find(l => l.id === Number(upsertLevelFilter))?.name ?? `Nivel ${upsertLevelFilter}`) : "Grilla");

    // Construir nombres de columna únicos por eval ID (dos pasadas para detectar duplicados)
    const baseLabelCounts = new Map<string, number>();
    for (const ev of visibleEvals) {
      const base = getEvaluationColumnLabel(ev, new Map());
      baseLabelCounts.set(base, (baseLabelCounts.get(base) || 0) + 1);
    }
    const baseLabelIdx = new Map<string, number>();
    const evalColName = new Map<number, string>();
    for (const ev of visibleEvals) {
      const base = getEvaluationColumnLabel(ev, new Map());
      if ((baseLabelCounts.get(base) || 1) === 1) {
        evalColName.set(ev.id, base);
      } else {
        const idx = (baseLabelIdx.get(base) || 0) + 1;
        baseLabelIdx.set(base, idx);
        evalColName.set(ev.id, `${base} #${idx}`);
      }
    }

    // Usar aoa_to_sheet para garantizar que todas las columnas aparezcan en el orden correcto
    const headers = ["Cédula", "Alumno", ...visibleEvals.map(ev => evalColName.get(ev.id)!)];
    const dataRows = flatRowsFiltered.map((row) => {
      const st = row.student;
      const cells: (string | number)[] = [st.cedula, st.name];
      for (const ev of visibleEvals) {
        if (Number(st.id_course) !== Number(ev.id_course)) { cells.push("-"); continue; }
        const gradeRecord = row.sectionGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
        const attempts = gradeRecord?.attempts ?? 0;
        const gradeVal = gradeRecord?.grade ?? null;
        const hasClosedGrade = !!gradeRecord?.finished_at;
        if (hasClosedGrade && attempts === 0 && gradeVal === 0) {
          cells.push("No Presentó");
        } else {
          const val = gradeDraft[gradeCellKey(st.id, ev.id)];
          cells.push(val === "" || val == null ? (hasClosedGrade && gradeVal !== null ? gradeVal : (isExamEvaluation(ev) ? "—" : "+")) : Number(val));
        }
      }
      return cells;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    XLSX.writeFile(wb, `${label}.xlsx`);
  }

  async function handleLogout() {
    signOut();
    router.replace("/login");
  }

  const roleLabel = useMemo(() => roleLabelFromRole(getActiveRole(me)), [me]);

  if (loadingMe) return <div className="container">Cargando...</div>;

  const isDarkTheme = isDarkThemeEnabled();

  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div>

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
          font-weight: 700 !important;
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

      <div
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

      {/* SIDEBAR */}
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
        <div style={{ fontWeight: 900, fontSize: 18 }}>Perfil del profesor</div>
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
          <div style={{ fontWeight: 900, wordBreak: "break-word" }}>
            {me?.user?.email ?? "—"}
          </div>
        </div>

        <div style={{ marginTop: 10, marginBottom: 20 }}>
          <div className="label">Rol</div>
          <div style={{ fontWeight: 900 }}>{roleLabel}</div>
        </div>

        <ChangePasswordButton email={me?.user?.email} className="btn" />

        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={handleLogout} style={{ width: "100%" }}>
            Salir
          </button>
        </div>
        <AppVersionLabel
          style={{ display: "block", marginTop: 10, color: "var(--footer)", fontSize: 8, fontWeight: 700 }}
        />
      </aside>

      {/* MAIN */}
      <main
        style={{
          marginLeft: sidebarOpen ? SIDEBAR_W : 0,
          transition: "margin-left 180ms ease",
        }}
      >
        <div className="container">
          <div className="topbar" style={{ alignItems: "center" }}>
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
                  <div style={{ fontWeight: 900, fontSize: 18 }}>SOFIA · La Promesa</div>
                  <div style={{ color: "var(--muted)" }}>Panel Profesor</div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="topbarUserText">
                Profesor ·{" "}{me?.profile?.name ??
                me?.profile?.full_name ??
                me?.user?.user_metadata?.full_name ??
                me?.user?.email ??
                "—"}
              </div>

            </div>
          </div>

          {/* SELECTOR DE SECCIÓN */}
          <div
            className="card"
            style={{
              marginTop: 14,
              padding: 14,
              alignItems: "center",
              justifyContent: "space-between",
              gridColumn: "1 / span 2",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>¿Qué quieres hacer?</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "4fr 1fr", gap: 10, alignItems: "flex-end", padding: 10 }}>
              <div>
                <select
                  className="select"
                  style={{ width: "100%" }}
                  value=""
                  onChange={(e) => {
                    const next = e.target.value as TeacherView;
                    resetView(next);
                    setView(next);
                    setMsg(null);
                    if (next === "DASHBOARD") loadDashboard(teacherYear);
                    if (next === "EVALS") loadEvaluations(teacherYear);
                    if (next === "CREATE") {
                      loadTeacherCourses(teacherYear);
                      loadTypes();
                    }
                  }}
                >
                  <option value="" disabled>¿Qué quieres hacer?...</option>
                  <option value="DASHBOARD">Ver materias asignadas</option>
                  <option value="UPSERT">Gestionar Notas</option>
                  <option value="CREATE" disabled={isHistoricalYear}>Gestionar Evaluaciones</option>
                  <option value="ATTEND_REPORT">Reporte de asistencia</option>
                </select>
              </div>
              <div>
                <div className="label" style={{ fontSize: 11, marginBottom: 2 }}>Año lectivo</div>
                <select
                  className="select"
                  style={{ width: "100%" }}
                  value={teacherYear ?? ""}
                  onChange={(e) => setTeacherYear(Number(e.target.value))}
                  disabled={anioLectivoItems.length === 0}
                >
                  {anioLectivoItems.length === 0
                    ? <option value="">—</option>
                    : anioLectivoItems.map(a => (
                        <option key={a.year} value={a.year}>{a.year}{a.activo ? " ✓" : ""}</option>
                      ))
                  }
                </select>
              </div>
            </div>
          </div>

          {isHistoricalYear && (
            <div style={{ margin: "10px 10px 0", padding: "8px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--accent) 12%, var(--card) 88%)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", color: "var(--text)", fontSize: 13 }}>
              Histórico — {teacherYear}. Solo lectura.
            </div>
          )}

          {msg && (
            <div className={msgKind === "ok" ? "msgOk" : "msgError"} style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}

          {/* =======================
              PANEL: DASHBOARD
              ======================= */}
          {view === "DASHBOARD" && (
            <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
              {/* RESUMEN HORIZONTAL */}
              <div className="card">
                <h2 style={{ margin: 0, marginBottom: 16 }}>Resumen</h2>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 18,
                      border: "1px solid var(--stroke)",
                      background:
                        "linear-gradient(135deg, rgba(0, 170, 255, 0.2), rgba(14,165,233,.06))",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>
                      Materias asignadas
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1, marginTop: 6 }}>
                      {dashSummary.assigned_classes}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      borderRadius: 18,
                      border: "1px solid var(--stroke)",
                      background: "rgba(14,165,233,.04)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>
                      Total estudiantes
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1, marginTop: 6 }}>
                      {dashSummary.total_students}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      borderRadius: 18,
                      border: "1px solid var(--stroke)",
                      background: "rgba(14,165,233,.04)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>
                      Año académico
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1, marginTop: 6 }}>
                      {dashSummary.academic_year}
                    </div>
                  </div>
                </div>
              </div>

              {/* TABLA MATERIAS ASIGNADAS */}
              <div className="card">
                <h2 style={{ margin: 0, marginBottom: 14 }}>Mis materias asignadas</h2>

                {loadingDashboard ? (
                  <div style={{ color: "var(--muted)" }}>Cargando...</div>
                ) : dashAssignments.length === 0 ? (
                  <div style={{ color: "var(--muted)" }}>No tienes materias asignadas actualmente.</div>
                ) : (
                  <div
                    style={{
                      borderRadius: GRILLA.radiusSecondary,
                      overflow: "hidden",
                      border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
                      background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                      boxShadow: "var(--shadow)",
                    }}
                  >
                    <div style={{ overflowX: "auto" }}>
                      <table
                        className="teacher-solid-table"
                        style={{
                          width: "100%",
                          minWidth: 500,
                          borderCollapse: "separate",
                          borderSpacing: 0,
                          fontSize: 14,
                          color: "var(--text)",
                        }}
                      >
                        <thead>
                          <tr>
                            {/* Nivel — dropdown en header */}
                            <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                              <select
                                className="select"
                                value={dashLevelFilter === "all" ? "all" : String(dashLevelFilter)}
                                onChange={(e) => {
                                  setDashLevelFilter(e.target.value === "all" ? "all" : Number(e.target.value));
                                  setDashCourseFilter("all");
                                }}
                                style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700 }}
                              >
                                <option value="all" style={{ fontWeight: 700 }}>Nivel</option>
                                {dashLevels.map((lvl) => (
                                  <option key={lvl} value={String(lvl)}>{levelLabel(lvl, levelMap)}</option>
                                ))}
                              </select>
                            </th>
                            {/* Curso — dropdown en header */}
                            <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                              <select
                                className="select"
                                value={dashCourseFilter === "all" ? "all" : String(dashCourseFilter)}
                                onChange={(e) => setDashCourseFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                                style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700 }}
                              >
                                <option value="all" style={{ fontWeight: 700 }}>Curso</option>
                                {dashCoursesForLevel.map((c) => (
                                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                                ))}
                              </select>
                            </th>
                            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap", fontWeight: 700 }}>
                              Módulo
                            </th>
                            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap", fontWeight: 700 }}>
                              Grupo
                            </th>
                            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 700 }}>
                              Materia
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashAssignmentsFiltered.length === 0 ? (
                            <tr>
                              <td colSpan={5} style={{ padding: 16, color: "var(--muted)" }}>
                                Sin resultados para el filtro seleccionado.
                              </td>
                            </tr>
                          ) : (
                            dashAssignmentsFiltered.map((a, rowIndex) => {
                              const bg = getGrillaBaseRowBg(rowIndex, isDarkTheme);
                              return (
                                <tr key={`${a.class_id}-${a.course_id}`} className="table-row-hover" data-editing="false" style={{ background: bg }}>
                                  <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, whiteSpace: "nowrap" }}>
                                    {a.level_label}
                                  </td>
                                  <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, whiteSpace: "nowrap" }}>
                                    {a.course_name || "—"}
                                  </td>
                                  <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                    {a.module_name || "—"}
                                  </td>
                                  <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, whiteSpace: "nowrap" }}>
                                    {a.group_name || "—"}
                                  </td>
                                  <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                    {a.class_name}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =======================
              PANEL: MIS EVALUACIONES
              ======================= */}
          {view === "EVALS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ margin: 0 }}>Mis evaluaciones</h2>

              <div
                style={{
                  marginTop: 14,
                  borderRadius: GRILLA.radiusSecondary,
                  overflow: "hidden",
                  border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
                  background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div style={{ overflowX: "auto" }}>
                  <table
                    className="teacher-solid-table"
                    style={{
                      width: "100%",
                      minWidth: 700,
                      borderCollapse: "separate",
                      borderSpacing: 0,
                      fontSize: 14,
                      color: "var(--text)",
                    }}
                  >
                    <thead>
                      <tr>
                        {/* Nivel */}
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                          <select
                            className="select"
                            value={evalLevelFilter === "all" ? "all" : String(evalLevelFilter)}
                            onChange={(e) => setEvalLevelFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                            style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                          >
                            <option value="all" style={{ fontWeight: 700 }}>Nivel</option>
                            {evalLevelOptions.map((o) => (
                              <option key={o.value} value={String(o.value)}>{o.label}</option>
                            ))}
                          </select>
                        </th>
                        {/* Curso */}
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                          <select
                            className="select"
                            value={evalCourseFilter === "all" ? "all" : String(evalCourseFilter)}
                            onChange={(e) => setEvalCourseFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                            style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                          >
                            <option value="all" style={{ fontWeight: 700 }}>Curso</option>
                            {evalCourseOptions.map((c) => (
                              <option key={c.id} value={String(c.id)}>{c.name}</option>
                            ))}
                          </select>
                        </th>
                        {/* Módulo */}
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                          <select
                            className="select"
                            value={evalModuleFilter}
                            onChange={(e) => setEvalModuleFilter(e.target.value)}
                            style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                          >
                            <option value="" style={{ fontWeight: 700 }}>Módulo</option>
                            {evalModuleOptions.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </th>
                        {/* Materia/Grupo */}
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                          <select
                            className="select"
                            value={evalClassFilter === "all" ? "all" : String(evalClassFilter)}
                            onChange={(e) => setEvalClassFilter(e.target.value === "all" ? "all" : e.target.value)}
                            style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                          >
                            <option value="all" style={{ fontWeight: 700 }}>Materia</option>
                            {evalClassOptions.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 700 }}>Evaluación</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 700, width: 100 }}>%</th>
                        <th style={{ width: 130, borderBottom: GRILLA.headerBottomBorder }} />
                      </tr>
                    </thead>
                    <tbody>
                      {evalItemsFiltered.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: 16, color: "var(--muted)", background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)" }}>
                            {loadingList ? "Cargando..." : "No tienes evaluaciones con ese filtro."}
                          </td>
                        </tr>
                      ) : (
                        evalItemsFiltered.map((e, rowIndex) => {
                          const isModuleLevel = e.id_class == null && e.id_module != null;
                          const isGroupLevel = e.id_class == null && e.id_group != null;
                          const isReadOnly = isModuleLevel || isGroupLevel || isHistoricalYear;
                          const bg = getGrillaBaseRowBg(rowIndex, isDarkTheme);

                          const levelNum = Number(e.class?.level ?? 0);
                          const levelName = levelNum ? (levelMap[levelNum] ?? `Año ${levelNum}`) : "—";
                          const courseName = e.course?.name ?? "—";
                          const modName = e.module?.name ?? (e.id_module ? `Módulo ${e.id_module}` : "—");
                          const className = e.class?.name ?? (isGroupLevel ? `Grupo ${e.id_group}` : "—");

                          return (
                            <tr key={e.id} className="table-row-hover" data-editing="false" style={{ background: bg, opacity: isReadOnly ? 0.85 : 1 }}>
                              <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, whiteSpace: "nowrap" }}>
                                {levelName}
                              </td>
                              <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, whiteSpace: "nowrap" }}>
                                {courseName}
                              </td>
                              <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                {modName}
                              </td>
                              <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                {isReadOnly ? (
                                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{className}</span>
                                ) : (
                                  className
                                )}
                              </td>
                              <td style={{ padding: "6px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                {isReadOnly ? (
                                  <span style={{ fontWeight: 500 }}>{getEvaluationListLabel(e)}</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => goToUpsertFromEvaluation(e)}
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      padding: 0,
                                      margin: 0,
                                      color: "var(--text)",
                                      font: "inherit",
                                      fontWeight: 500,
                                      cursor: "pointer",
                                      textAlign: "left",
                                      textDecoration: "underline",
                                      textUnderlineOffset: 3,
                                    }}
                                    title="Ir a cambiar nota de esta evaluación"
                                  >
                                    {getEvaluationListLabel(e)}
                                  </button>
                                )}
                              </td>
                              <td style={{ padding: "4px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg }}>
                                {isReadOnly ? (
                                  <span style={{ color: "var(--muted)" }}>{e.percent}%</span>
                                ) : (
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    className="input"
                                    style={{ textAlign: "center", width: 72 }}
                                    value={percentDraft[e.id] ?? String(e.percent)}
                                    onChange={(ev) =>
                                      setPercentDraft((p) => ({ ...p, [e.id]: ev.target.value }))
                                    }
                                    onWheel={(ev) => ev.currentTarget.blur()}
                                    onKeyDown={(ev) => { if (ev.key === "ArrowUp" || ev.key === "ArrowDown") ev.preventDefault(); }}
                                  />
                                )}
                              </td>
                              <td style={{ padding: "4px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, textAlign: "center" }}>
                                {isReadOnly ? (
                                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{isHistoricalYear ? "Histórico" : "Solo lectura"}</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btnLight"
                                    style={{ fontSize: 12, padding: "4px 10px" }}
                                    disabled={savingEvalRow[e.id]}
                                    onClick={() => handleUpdateEvalRow(e.id)}
                                  >
                                    {savingEvalRow[e.id] ? "..." : "Actualizar %"}
                                  </button>
                                )}
                              </td>
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

          {/* ==================
              PANEL: CREAR
              ================== */}
          {view === "CREATE" && (
            <div className="card" style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div><h2 style={{ margin: 0 }}>Gestionar evaluaciones</h2></div>
              </div>

              {/* Fila dropdowns */}
              <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                {/* Nivel */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={String(createLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCreateLevelFilter(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="" disabled style={{ fontWeight: 700 }}>Nivel</option>
                    {levels.map((lvl) => (
                      <option key={lvl.id} value={String(lvl.id)}>{lvl.name}</option>
                    ))}
                  </select>
                </div>

                {/* Curso */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={cCourse}
                    disabled={createLevelFilter === "" || loadingCourses}
                    onChange={(e) => setCCourse(e.target.value)}
                  >
                    <option value="" style={{ fontWeight: 700 }}>{loadingCourses ? "Cargando..." : "Curso"}</option>
                    {coursesForCreate.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Módulo */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={createModuleFilter}
                    disabled={createLevelFilter === ""}
                    onChange={(e) => setCreateModuleFilter(e.target.value)}
                  >
                    <option value="" style={{ fontWeight: 700 }}>Módulo</option>
                    {createModuleOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Materia / Grupo */}
                <div style={{ flex: "2 1 180px" }}>
                  <div className="label">{createClassOptions.some(o => o.value.startsWith("grp:")) ? "Materia/Grupo" : "Materia"}</div>
                  <select
                    className="select"
                    value={createClassFilter}
                    disabled={createLevelFilter === ""}
                    onChange={(e) => setCreateClassFilter(e.target.value)}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>{createClassOptions.some(o => o.value.startsWith("grp:")) ? "Materia/Grupo" : "Materia"}</option>
                    {createClassOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Cancelar */}
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ background: isDarkTheme ? "#1f2937" : "#000", color: "#fff", borderColor: isDarkTheme ? "#1f2937" : "#000", whiteSpace: "nowrap", width: 120 }}
                    onClick={() => {
                      setCreateLevelFilter("");
                      setCCourse("");
                      setCreateModuleFilter("");
                      setCreateClassFilter("all");
                      setCType("");
                      setCTypeOther("");
                      setTitleOther("");
                      setCPercent("0");
                      setEditPercents({});
                      setMsg(null);
                    }}
                  >
                    Cancelar
                  </button>

                </div>
              </div>

              {/* NUEVA EVALUACIÓN */}
              {createLevelFilter !== "" && (
              <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {/* Tipo */}
                    <div style={{ flex: "1 1 140px" }}>
                      <div className="label">Tipo</div>
                      <select
                        className="select"
                        value={cType}
                        onChange={(e) => {
                          setCType(e.target.value);
                          if (e.target.value !== "__other__") setCTypeOther("");
                        }}
                        disabled={loadingTypes}
                      >
                        <option value="">{loadingTypes ? "Cargando..." : "Selecciona..."}</option>
                        {types.map((t) => (
                          <option key={t.id} value={String(t.id)}>{t.type}</option>
                        ))}
                      </select>
                    </div>

                    {/* Título */}
                    <div style={{ flex: "2 1 180px" }}>
                      <div className="label">Título</div>
                      <input
                        className="input"
                        value={titleOther}
                        onChange={(e) => setTitleOther(e.target.value)}
                        placeholder="Escribe el título de la evaluación..."
                      />
                    </div>

                    {/* Porcentaje */}
                    <div style={{ flex: "0 0 120px" }}>
                      <div className="label">Porcentaje</div>
                      <input
                        type={cPercentFocused ? "number" : "text"}
                        min={1}
                        max={100}
                        className="input"
                        style={{ textAlign: "center", width: "100%" }}
                        value={cPercentFocused ? cPercent : `${cPercent} %`}
                        onFocus={() => setCPercentFocused(true)}
                        onBlur={() => setCPercentFocused(false)}
                        onChange={(e) => setCPercent(e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                      />
                    </div>

                    {/* Botón Crear */}
                    <div style={{ flex: "0 0 120px" }}>
                      <button
                        className="btn"
                        onClick={handleCreate}
                        disabled={creating}
                        style={{ width: "100%", padding: "12px 8px" }}
                      >
                        {creating ? "..." : "Crear"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* EVALUACIONES EXISTENTES DE LA MATERIA */}
              <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div className="label" style={{ width: "75%", marginBottom: 8 }}>Evaluaciones existentes</div>
                  {(true) && (
                    <div
                      style={{
                        borderRadius: 14,
                        border: "1px solid var(--stroke)",
                        overflow: "hidden",
                        width: "75%",
                      }}
                    >
                      {/* encabezado */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "130px 150px 150px 1fr 70px 110px 110px",
                          padding: "12px 16px",
                          background: isDarkTheme ? GRILLA.headerBgDark : GRILLA.headerBgLight,
                          borderBottom: "1px solid var(--stroke)",
                          fontWeight: 800,
                          fontSize: 13,
                          color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight,
                          alignItems: "center",
                        }}
                      >
                        <div>Tipo</div>
                        <div>Curso</div>
                        <div>Materia</div>
                        <div>Título</div>
                        <div style={{ textAlign: "center" }}>%</div>
                        <div />
                        <div />
                      </div>
                      {/* filas */}
                      {createLevelFilter === "" ? (
                        <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>
                          Selecciona un nivel para ver las evaluaciones existentes.
                        </div>
                      ) : createEvalsFiltered.length === 0 ? (
                        <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>No hay evaluaciones para la selección actual.</div>
                      ) : (
                        createEvalsFiltered.map((ev) => {
                          const isExamen = ev.evaluation_type?.type === "Examen";
                          return (
                          <div
                            key={ev.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "130px 150px 150px 1fr 70px 110px 110px",
                              padding: "12px 16px",
                              alignItems: "center",
                              borderBottom: "1px solid var(--stroke)",
                              fontSize: 13,
                            }}
                          >
                            <div>{ev.evaluation_type?.type ?? "—"}</div>
                            <div style={{ color: "var(--muted)" }}>{ev.course?.name ?? "—"}</div>
                            <div style={{ color: "var(--muted)" }}>{ev.class?.name ?? "—"}</div>
                            <div>{ev.title}</div>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <input
                                type={editPercentFocused[ev.id] ? "number" : "text"}
                                min={1}
                                max={100}
                                className="input"
                                style={{ textAlign: "center", padding: "4px 6px", fontSize: 13, width: 70, borderRadius: 9999, opacity: isExamen ? 0.5 : 1 }}
                                value={editPercentFocused[ev.id]
                                  ? (editPercents[ev.id] ?? String(ev.percent))
                                  : `${editPercents[ev.id] ?? ev.percent} %`}
                                disabled={isExamen}
                                onFocus={() => setEditPercentFocused((p) => ({ ...p, [ev.id]: true }))}
                                onBlur={() => setEditPercentFocused((p) => ({ ...p, [ev.id]: false }))}
                                onChange={(e) =>
                                  setEditPercents((p) => ({ ...p, [ev.id]: e.target.value }))
                                }
                                onWheel={(e) => e.currentTarget.blur()}
                                onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                              />
                            </div>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              {isExamen ? (
                                <button type="button" onClick={() => handleEditExam(ev)}
                                  style={{ fontSize: 12, padding: "5px 0", width: 80, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
                                  Editar
                                </button>
                              ) : (
                                <button type="button" onClick={() => handleSaveCreateEvalPercent(ev.id)}
                                  disabled={savingEvalPercent[ev.id]}
                                  style={{ fontSize: 12, padding: "5px 0", width: 80, background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", opacity: savingEvalPercent[ev.id] ? 0.5 : 1 }}>
                                  {savingEvalPercent[ev.id] ? "..." : "Guardar"}
                                </button>
                              )}
                            </div>
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <button type="button" onClick={() => handleDeleteCreateEval(ev.id)}
                                disabled={deletingEval[ev.id] || isExamen}
                                style={{ fontSize: 12, padding: "5px 0", width: 80, background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: isExamen ? "not-allowed" : "pointer", opacity: (deletingEval[ev.id] || isExamen) ? 0.4 : 1 }}>
                                {deletingEval[ev.id] ? "..." : "Eliminar"}
                              </button>
                            </div>
                          </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
            </div>
          )}

          {/* ==================
              PANEL: UPSERT
              ================== */}
          {view === "UPSERT" && (
            <div className="card" style={{ marginTop: 18, width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Gestionar Notas</h2>
                </div>
              </div>

              {/* Fila 1: dropdowns */}
              <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                {/* Nivel */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={String(upsertLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUpsertLevelFilter(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="" disabled style={{ fontWeight: 700 }}>Nivel</option>
                    {levels.map((lvl) => (
                      <option key={lvl.id} value={String(lvl.id)}>{lvl.name}</option>
                    ))}
                  </select>
                </div>

                {/* Curso */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={upsertCourseFilter === "all" ? "all" : String(upsertCourseFilter)}
                    disabled={upsertLevelFilter === ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUpsertCourseFilter(v === "all" ? "all" : Number(v));
                    }}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Curso</option>
                    {coursesForUpsert.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Módulo */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={thFilterModule}
                    disabled={upsertLevelFilter === ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setThFilterModule(v);
                      setThFilterGroup("");
                      setThFilterClass("");
                    }}
                  >
                    <option value="" style={{ fontWeight: 700 }}>Módulo</option>
                    {thModuleOptions.map((o) => (
                      <option key={o.value} value={o.value} style={{ color: "#000" }}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Materia/Grupo */}
                <div style={{ flex: "2 1 180px" }}>
                  <div className="label">{thClassOptions.some(o => o.value.startsWith("grp:")) ? "Materia/Grupo" : "Materia"}</div>
                  <select
                    className="select"
                    value={thFilterClass}
                    onChange={(e) => {
                      const v = e.target.value;
                      setThFilterClass(v);
                      // Si no hay nivel seleccionado, derivarlo de la materia y disparar carga
                      if (v && upsertLevelFilter === "" && !gLoadingRoster) {
                        let level: number | null = null;
                        if (v.startsWith("grp:")) {
                          const groupId = Number(v.slice(4));
                          const cls = myClasses.find((c) => c.id_group != null && Number(c.id_group) === groupId);
                          level = cls?.level ?? (items.find((i) => i.id_group != null && Number(i.id_group) === groupId)?.course?.level ?? null);
                        } else {
                          level = myClasses.find((c) => String(c.id) === v)?.level ?? null;
                        }
                        if (level) {
                          pendingThFilterClassRef.current = v;
                          setUpsertLevelFilter(Number(level));
                        }
                      }
                    }}
                  >
                    <option value="" style={{ fontWeight: 700 }}>{thClassOptions.some(o => o.value.startsWith("grp:")) ? "Materia/Grupo" : "Materia"}</option>
                    {thClassOptions.map((o) => (
                      <option key={o.value} value={o.value} style={{ color: "#000" }}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Cancelar */}
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ background: isDarkTheme ? "#1f2937" : "#000", color: "#fff", borderColor: isDarkTheme ? "#1f2937" : "#000", whiteSpace: "nowrap", width: 160 }}
                    onClick={() => {
                      setUpsertLevelFilter("");
                      setUpsertCourseFilter("all");
                      setThFilterLevel("");
                      setThFilterModule("");
                      setThFilterGroup("");
                      setThFilterClass("");
                      setThFilterCedula("");
                      setThFilterName("");
                      setAllSections([]);
                      setGradeDraft({});
                      setEditingRow({});
                      setRowSnapshot({});
                      setMsg(null);
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>

              {upsertLevelFilter === "" ? null : (
                <div style={{ marginTop: 16 }}>
                  {/* Fila 2: Descargar */}
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    {flatRowsFiltered.length > 0 && visibleEvals.length > 0 && (
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
                          width: 160,
                          justifyContent: "center",
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

                  <div style={{ borderRadius: GRILLA.radiusSecondary, overflow: "hidden", border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)", background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)", boxShadow: "var(--shadow)" }}>
                    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "68vh", minHeight: !gLoadingRoster && flatRowsFiltered.length === 0 ? 0 : 200, background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)" }}>
                      {(() => {
                        const _visibleEvalCountsMap = new Map<string, number>();
                        return (
                          <table
                            className="teacher-solid-table"
                            style={{ width: "100%", minWidth: `${upsertDynamicMinWidth}px`, borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontSize: 14, color: "var(--text)" }}
                          >
                            <colgroup>
                              <col style={{ width: `${CEDULA_COL_W}px` }} />
                              <col style={{ width: `${ALUMNO_COL_W}px` }} />
                              {visibleEvals.map((ev) => (
                                <col key={ev.id} style={{ width: `${EVAL_COL_W}px` }} />
                              ))}
                              <col style={{ width: `${ACTION_COL_W}px` }} />
                            </colgroup>

                            <thead>
                              {/* Fila de grupo: nombre de materia, siempre visible cuando no hay filtro de materia */}
                              {!thFilterClass && visibleEvals.length > 0 && (() => {
                                const groups: { classId: number; className: string; count: number }[] = [];
                                for (const ev of visibleEvals) {
                                  // Group evals have id_class=null; use negative group id as bucket key.
                                  const cid = ev.id_class ?? (ev.id_group != null ? -ev.id_group : 0);
                                  const className = ev.class?.name ?? ev.group?.name ?? `Clase ${Math.abs(cid)}`;
                                  const last = groups[groups.length - 1];
                                  if (last && last.classId === cid) { last.count++; }
                                  else groups.push({ classId: cid, className, count: 1 });
                                }
                                const subHeaderBg = isDarkTheme ? GRILLA.headerBgDark : GRILLA.headerBgLight;
                                const subHeaderText = isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight;
                                return (
                                  <tr>
                                    <td colSpan={2} style={{ borderBottom: GRILLA.headerBottomBorder, background: subHeaderBg, position: "sticky", top: 0, left: 0, zIndex: 7 }} />
                                    {groups.map((g, gi) => (
                                      <td key={`${g.classId}-${gi}`} colSpan={g.count} style={{ padding: "4px 10px", borderBottom: GRILLA.headerBottomBorder, fontSize: 11, fontWeight: 700, textAlign: "center", background: subHeaderBg, color: subHeaderText, borderLeft: "1px solid var(--stroke)", position: "sticky", top: 0, zIndex: 5 }}>
                                        {g.className}
                                      </td>
                                    ))}
                                    <td style={{ borderBottom: GRILLA.headerBottomBorder, background: subHeaderBg, position: "sticky", top: 0, zIndex: 5 }} />
                                  </tr>
                                );
                              })()}
                              <tr>
                                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, position: "sticky", top: !thFilterClass ? 33 : 0, left: 0, zIndex: 6, whiteSpace: "nowrap", boxShadow: "none" }}>
                                  <select
                                    className="select"
                                    value={thFilterCedula}
                                    onChange={(e) => {
                                      setThFilterCedula(e.target.value);
                                      if (e.target.value) setThFilterName("");
                                    }}
                                    disabled={!!thFilterName}
                                    style={{ fontSize: 13, padding: "4px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                                  >
                                    <option value="" style={{ fontWeight: 900, color: "#000" }}>Cédula</option>
                                    {thCedulaOptions.map((o) => (
                                      <option key={o.value} value={o.value} style={{ color: "#000" }}>{o.label}</option>
                                    ))}
                                  </select>
                                </th>
                                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, position: "sticky", top: !thFilterClass ? 33 : 0, left: STICKY_ALUMNO_LEFT, zIndex: 6, boxShadow: "none" }}>
                                  <select
                                    className="select"
                                    value={thFilterName}
                                    onChange={(e) => {
                                      setThFilterName(e.target.value);
                                      if (e.target.value) setThFilterCedula("");
                                    }}
                                    disabled={!!thFilterCedula}
                                    style={{ fontSize: 13, padding: "4px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                                  >
                                    <option value="" style={{ fontWeight: 900, color: "#000" }}>Alumno</option>
                                    {thNameOptions.map((o) => (
                                      <option key={o.value} value={o.value} style={{ color: "#000" }}>{o.label}</option>
                                    ))}
                                  </select>
                                </th>
                                {visibleEvals.map((ev) => {
                                  const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
                                  const showTitle = ev.title && ev.title.trim() !== typeLabel;
                                  const pct = Number(ev.percent).toFixed(0);
                                  return (
                                    <th key={ev.id} style={{ textAlign: "left", padding: "8px 10px", borderBottom: GRILLA.headerBottomBorder, position: "sticky", top: !thFilterClass ? 33 : 0, zIndex: 5, lineHeight: 1.3, borderLeft: !thFilterClass ? "1px solid var(--stroke)" : undefined }}>
                                      <div style={{ fontSize: 11, fontWeight: 700 }}>{typeLabel} ({pct}%)</div>
                                      {showTitle && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 1 }}>{ev.title}</div>}
                                    </th>
                                  );
                                })}
                                <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 800, position: "sticky", top: !thFilterClass ? 33 : 0, zIndex: 5 }} />
                              </tr>
                            </thead>

                            <tbody>
                              {gLoadingRoster ? (
                                <tr>
                                  <td colSpan={Math.max(3, visibleEvals.length + 3)} style={{ padding: 32, minHeight: 120, textAlign: "center", fontSize: 14, color: "var(--muted)", background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)" }}>
                                    Cargando alumnos y notas...
                                  </td>
                                </tr>
                              ) : (
                                flatRowsFiltered.map((row, rowIndex) => {
                                  const st = row.student;
                                  const isEditing = !!editingRow[st.id];
                                  const isBusy = !!savingOne[st.id] || savingAll;
                                  const rowEvalIds = new Set(row.sectionEvals.map((ev) => ev.id));
                                  const rowVisibleEvals = visibleEvals.filter((ev) => rowEvalIds.has(ev.id));
                                  const baseRowBg = getGrillaBaseRowBg(rowIndex, isDarkTheme);
                                  const activeRowBg = getGrillaActiveRowBg(isDarkTheme);
                                  const editableCellBg = getGrillaEditableCellBg(isDarkTheme);
                                  const disabledCellBg = getGrillaDisabledCellBg(isDarkTheme);
                                  const cellTextColor = getGrillaTextColor(isDarkTheme);

                                  return (
                                    <tr key={`${row.classId}__${st.id}`} className="table-row-hover" data-editing={isEditing ? "true" : "false"} style={{ background: isEditing ? activeRowBg : baseRowBg }}>
                                      <td style={{ padding: "2px 10px", borderBottom: GRILLA.rowBottomBorder, background: isEditing ? activeRowBg : baseRowBg, position: "sticky", left: 0, zIndex: 3, boxShadow: "none", color: cellTextColor, whiteSpace: "nowrap", fontSize: 13 }}>
                                        {st.cedula}
                                      </td>
                                      <td style={{ padding: "2px 10px", borderBottom: GRILLA.rowBottomBorder, background: isEditing ? activeRowBg : baseRowBg, position: "sticky", left: CEDULA_COL_W, zIndex: 4, boxShadow: "none", color: cellTextColor }}>
                                        <div style={{ lineHeight: 1.15 }}>{st.name}</div>
                                      </td>

                                      {visibleEvals.map((ev) => {
                                        const key = gradeCellKey(st.id, ev.id);
                                        const enabledForCourse = Number(st.id_course) === Number(ev.id_course);
                                        const editable = enabledForCourse && isEditing && !isBusy;
                                        const gradeRecord = row.sectionGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
                                        const attempts = Number(gradeRecord?.attempts ?? 0);
                                        const gradeVal = gradeRecord?.grade ?? null;
                                        const hasClosedGrade = !!gradeRecord?.finished_at;
                                        const noPresentó = enabledForCourse && hasClosedGrade && attempts === 0 && gradeVal === 0;
                                        const pendingPlaceholder = isExamEvaluation(ev) ? "—" : "+";

                                        return (
                                          <td key={ev.id} style={{ padding: 0, borderBottom: GRILLA.rowBottomBorder, background: enabledForCourse ? (isEditing ? editableCellBg : "transparent") : disabledCellBg, position: "relative" }}>
                                            {noPresentó && !isEditing ? (
                                              <div style={{ display: "flex", alignItems: "center", justifyContent: "left", height: 26, padding: "0 6px" }}>
                                                <span style={{ display: "inline-block", padding: "2px 4px", borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: 0.3, background: isDarkTheme ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.1)", color: isDarkTheme ? "#fca5a5" : "#dc2626", border: isDarkTheme ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(239,68,68,0.25)", whiteSpace: "nowrap" }}>
                                                  No Presentó
                                                </span>
                                              </div>
                                            ) : (
                                              <input
                                                className="input"
                                                inputMode="numeric"
                                                value={gradeDraft[key] ?? ""}
                                                readOnly={!editable}
                                                disabled={!enabledForCourse || isBusy}
                                                onChange={(e) => {
                                                  if (!editable) return;
                                                  const v = e.target.value;
                                                  if (v === "") return setGradeDraft((p) => ({ ...p, [key]: "" }));
                                                  if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) return;
                                                  setGradeDraft((p) => ({ ...p, [key]: v }));
                                                }}
                                                placeholder={enabledForCourse ? pendingPlaceholder : "-"}
                                                onFocus={(e) => { if (editable) { e.currentTarget.style.background = getGrillaFocusCellBg(isDarkTheme); e.currentTarget.style.boxShadow = "inset 0 0 0 1.5px #3b82f6"; } }}
                                                onBlur={(e) => { e.currentTarget.style.background = editable ? editableCellBg : "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                                                style={{ width: "100%", minWidth: 0, height: 26, border: "none", borderRadius: 0, outline: "none", background: editable ? editableCellBg : "transparent", boxShadow: "none", padding: "0 10px", fontSize: 13, lineHeight: 1, fontWeight: editable ? 700 : 500, color: enabledForCourse ? (hasClosedGrade && gradeDraft[key] !== "" && gradeDraft[key] !== undefined && Number(gradeDraft[key]) < 70 ? "#dc2626" : cellTextColor) : isDarkTheme ? "var(--muted)" : "#94a3b8", cursor: editable ? "text" : "default", opacity: enabledForCourse ? 1 : 0.6 }}
                                              />
                                            )}
                                          </td>
                                        );
                                      })}

                                      <td style={{ padding: "4px 8px", borderBottom: GRILLA.rowBottomBorder, background: isEditing ? activeRowBg : baseRowBg }}>
                                        <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                                          <button
                                            className="btn"
                                            onClick={() => handleRowAction(st, rowVisibleEvals)}
                                            disabled={isBusy || isHistoricalYear}
                                            style={{ minWidth: 104, padding: "5px 10px", background: isEditing ? "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)" : "linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)", border: isEditing ? "1px solid rgba(34,197,94,.8)" : "1px solid rgba(2,132,199,.8)", color: "#fff", boxShadow: isEditing ? "0 5px 14px rgba(34,197,94,.18)" : "0 5px 14px rgba(2,132,199,.16)", fontSize: 13 }}
                                          >
                                            {isBusy ? "Actualizando..." : isEditing ? "Guardar" : "Actualizar"}
                                          </button>
                                          {isEditing && (
                                            <button type="button" className="btnLight" onClick={() => cancelEdit(st)} disabled={isBusy} style={{ minWidth: 90, padding: "5px 10px", background: isDarkTheme ? "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)" : "#ffffff", border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)", color: isDarkTheme ? "var(--text)" : "#334155", fontSize: 13 }}>
                                              Cancelar
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                    {!gLoadingRoster && flatRowsFiltered.length === 0 && (
                      <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>
                        {allSections.length === 0
                          ? "No se encontraron materias para los filtros seleccionados."
                          : "No hay alumnos que coincidan con los filtros."}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {view === "ATTEND_REPORT" && (
            <ReporteAsistenciaProfesor courses={courses} />
          )}
        </div>
      </main>

      <Footer rightText="Hecho para la Iglesia La Promesa." />

      {/* Modal confirmación eliminar evaluación con notas */}
      {deleteConfirm && (
        <div
          onClick={() => setDeleteConfirm(null)}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 420, borderRadius: 18, padding: "22px 20px", boxSizing: "border-box" }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: 17, lineHeight: 1.2, letterSpacing: "-0.01em" }}>
              ⚠️ Confirmar eliminación
            </h2>
            <p style={{ margin: "0 0 6px", fontSize: 14, lineHeight: 1.55 }}>
              La evaluación <strong>&quot;{deleteConfirm.title}&quot;</strong> tiene{" "}
              <strong>
                {deleteConfirm.gradeCount}{" "}
                {deleteConfirm.gradeCount === 1 ? "alumno con nota asignada" : "alumnos con notas asignadas"}
              </strong>.
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "#ef4444", fontWeight: 600 }}>
              Si eliminas esta evaluación, esas notas se perderán permanentemente.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{ minHeight: 44, borderRadius: 12, border: "1px solid var(--btn-light-border)", background: "var(--btn-light-bg)", color: "var(--btn-light-text)", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = deleteConfirm.evalId;
                  setDeleteConfirm(null);
                  await doDeleteEval(id);
                }}
                style={{ minHeight: 44, borderRadius: 12, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700 }}
              >
                Eliminar de todos modos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay Crear / Editar Examen */}
      {showCrearExamen && crearExamenCtx && (
        <CrearExamen
          ctx={crearExamenCtx}
          examId={crearExamenExamId ?? undefined}
          initialData={crearExamenInitialData ?? undefined}
          teachers={[{ id: me?.profile?.id ?? me?.user?.id ?? "", name: me?.profile?.name ?? me?.profile?.full_name ?? me?.user?.email ?? "" }]}
          lockTeacher
          apiBase="/api/teacher"
          onSaved={() => {
            const wasEditing = crearExamenExamId !== null;
            setShowCrearExamen(false);
            setCrearExamenCtx(null);
            setCrearExamenInitialData(null);
            setCrearExamenExamId(null);
            setCType("");
            setTitleOther("");
            setCPercent("0");
            loadEvaluations(teacherYear);
            flash(wasEditing ? "✅ Examen actualizado correctamente" : "✅ Examen creado correctamente", "ok");
          }}
          onCancel={() => {
            setShowCrearExamen(false);
            setCrearExamenCtx(null);
            setCrearExamenInitialData(null);
            setCrearExamenExamId(null);
          }}
        />
      )}
    </div>
  );
}
