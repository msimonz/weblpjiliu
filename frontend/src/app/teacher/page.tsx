"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import * as XLSX from "xlsx";

type TeacherClass = {
  id: number;
  name: string;
  level: number;
  id_module: number | null;
  id_group: number | null;
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
  attempts?: number | null;
};

type GradeGridResponse = {
  class: { id: number; name: string; level: number } | null;
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
  module_id: number | null;
  module_name: string;
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

type TeacherView = "" | "DASHBOARD" | "EVALS" | "CREATE" | "UPSERT";
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

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<TeacherView>("");

  const [items, setItems] = useState<EvalItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const levelMap = useMemo<Record<number, string>>(
    () => Object.fromEntries(levels.map((l) => [l.id, l.name])),
    [levels]
  );

  const [dashboard, setDashboard] = useState<TeacherDashboardResponse | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashLevelFilter, setDashLevelFilter] = useState<number | "all">("all");
  const [dashCourseFilter, setDashCourseFilter] = useState<number | "all">("all");

  // ===== FILTROS POR PANEL =====
  // EVALS
  const [evalLevelFilter, setEvalLevelFilter] = useState<LevelValue>("all");
  const [evalCourseFilter, setEvalCourseFilter] = useState<number | "all">("all");
  const [evalModuleFilter, setEvalModuleFilter] = useState<string>("");
  const [evalClassFilter, setEvalClassFilter] = useState<number | "all">("all");

  // CREATE
  const [createLevelFilter, setCreateLevelFilter] = useState<LevelValue>("");
  const [createModuleFilter, setCreateModuleFilter] = useState<string>("");
  const [createClassFilter, setCreateClassFilter] = useState<number | "all">("all");

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
  const [titlePick, setTitlePick] = useState<string>("");
  const [titleOther, setTitleOther] = useState<string>("");

  // crear evaluación
  const [cCourse, setCCourse] = useState<string>("");
  const [cType, setCType] = useState<string>("");
  const [cTypeOther, setCTypeOther] = useState<string>("");
  const [cPercent, setCPercent] = useState<number>(0);
  const [creating, setCreating] = useState(false);

  // evaluaciones existentes de la materia seleccionada en CREATE
  const [createClassEvals, setCreateClassEvals] = useState<EvalItem[]>([]);
  const [loadingCreateClassEvals, setLoadingCreateClassEvals] = useState(false);
  const [editPercents, setEditPercents] = useState<Record<number, string>>({});
  const [savingEvalPercent, setSavingEvalPercent] = useState<Record<number, boolean>>({});
  const [deletingEval, setDeletingEval] = useState<Record<number, boolean>>({});

  const [allSections, setAllSections] = useState<GradeGridResponse[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);
  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  const [percentDraft, setPercentDraft] = useState<Record<number, string>>({});
  const [savingPercents, setSavingPercents] = useState(false);
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

  function goToUpsertFromEvaluation(item: EvalItem) {
    const classId = Number(item.id_class);
    const level = Number(item.class?.level ?? 0);
    const className = item.class?.name ?? "";

    if (!classId || !level) return;

    setMsg(null);
    setView("UPSERT");

    if (Number(upsertLevelFilter) === level) {
      // Data already loaded for this level — just set the class filter
      setThFilterClass(className);
      return;
    }

    // Need to load new level — store the pending class filter to apply after load
    pendingThFilterClassRef.current = className;
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

  // auth guard
  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");

        const info = await apiFetch("/api/auth/me");
        setMe(info);
        const activeRole = getActiveRole(info);

        if (activeRole !== "T") return router.replace(roleToRoute(activeRole));
      } catch {
        router.replace("/login");
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [router]);

  async function loadMyClasses() {
    setLoadingClasses(true);
    try {
      const res = await apiFetch("/api/teacher/classes");
      setMyClasses(res?.items || []);
    } catch (e: any) {
      setMyClasses([]);
      setMsg(e?.message || "Error cargando materias del profesor");
    } finally {
      setLoadingClasses(false);
    }
  }

  async function loadDashboard() {
    setLoadingDashboard(true);
    try {
      const res = await apiFetch("/api/teacher/dashboard");
      setDashboard(res || null);
    } catch (e: any) {
      setDashboard(null);
      setMsg(e?.message || "Error cargando dashboard del profesor");
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function loadEvaluations() {
    setMsg(null);
    setLoadingList(true);
    try {
      const res = await apiFetch("/api/teacher/evaluations");
      setItems(res?.items || []);
    } catch (e: any) {
      setItems([]);
      setMsg(e?.message || "Error cargando evaluaciones");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadTeacherCourses() {
    setLoadingCourses(true);
    try {
      const res = await apiFetch("/api/teacher/courses");
      setCourses(res?.items || []);
    } catch (e: any) {
      setCourses([]);
      setMsg(e?.message || "Error cargando cursos del profesor");
    } finally {
      setLoadingCourses(false);
    }
  }

  async function loadTypes() {
    setLoadingTypes(true);
    setTypes([]);
    try {
      const res = await apiFetch("/api/teacher/evaluation-types");
      setTypes(res?.items || []);
    } catch (e: any) {
      setTypes([]);
      setMsg(e?.message || "Error cargando tipos de evaluación");
    } finally {
      setLoadingTypes(false);
    }
  }

  useEffect(() => {
    if (!loadingMe) {
      loadMyClasses();
      loadDashboard();
      loadTypes();
      loadEvaluations();
      loadTeacherCourses();
      apiFetch("/api/teacher/levels")
        .then((res) => setLevels(res?.items || []))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

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
    return dashAssignments.filter((a) => {
      if (dashLevelFilter !== "all" && a.level !== dashLevelFilter) return false;
      if (dashCourseFilter !== "all" && a.course_id !== dashCourseFilter) return false;
      return true;
    });
  }, [dashAssignments, dashLevelFilter, dashCourseFilter]);

  // =========================
  // HELPERS GENERALES
  // =========================
  const availableLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of myClasses) {
      if (Number.isFinite(Number(c.level))) set.add(Number(c.level));
    }
    return [...set].sort((a, b) => a - b);
  }, [myClasses]);

  // =========================
  // EVALS FILTERS
  // =========================
  const evalClassesFiltered = useMemo(() => {
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
    return myClasses
      .filter((c) => {
        if (levelNum !== null && Number(c.level) !== levelNum) return false;
        if (evalModuleFilter) {
          const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "");
          if (modName !== evalModuleFilter) return false;
        }
        return true;
      })
      .map((c) => ({ id: c.id, name: String(c.name ?? "") }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [myClasses, evalLevelFilter, evalModuleFilter]);

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
        const cls = myClassesMap.get(Number(e.id_class));
        const modName = (cls?.module?.name ?? (cls?.id_module ? `Módulo ${cls.id_module}` : ""))
          || (e.module?.name ?? (e.id_module ? `Módulo ${e.id_module}` : ""));
        return modName === evalModuleFilter;
      });
    }

    if (evalClassFilter !== "all") {
      list = list.filter((e) => Number(e.id_class) === Number(evalClassFilter));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalLevelFilter]);

  useEffect(() => {
    setEvalModuleFilter("");
    setEvalClassFilter("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalCourseFilter]);

  useEffect(() => {
    setEvalClassFilter("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalModuleFilter]);

  useEffect(() => {
    const next: Record<number, string> = {};
    for (const e of evalItemsFiltered) next[e.id] = String(Number(e.percent ?? 0));
    setPercentDraft(next);
  }, [evalItemsFiltered]);

  const percentDirty = useMemo(() => {
    if (evalClassFilter === "all") return false;
    for (const e of evalsInSelectedClass) {
      const draft = (percentDraft[e.id] ?? "").trim();
      const n = Number(draft);
      if (!Number.isFinite(n)) continue;
      if (Number(n) !== Number(e.percent)) return true;
    }
    return false;
  }, [evalClassFilter, evalsInSelectedClass, percentDraft]);

  async function updatePercents() {
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
      await loadEvaluations();
    } catch (e: any) {
      setMsg(e?.message || "Error actualizando porcentajes");
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
    } catch (e: any) {
      flash(e?.message || "Error al actualizar", "err");
    } finally {
      setSavingEvalRow((p) => ({ ...p, [evalId]: false }));
    }
  }

  // =========================
  // CREATE FILTERS
  // =========================
  const selectedCreateCourse = useMemo(() => {
    const id = Number(cCourse);
    if (!id) return null;
    return courses.find((c) => Number(c.id) === id) || null;
  }, [cCourse, courses]);

  const createClassesFiltered = useMemo(() => {
    const levelNum = createLevelFilter && createLevelFilter !== "all" ? Number(createLevelFilter) : null;
    if (levelNum === null) return [];
    return myClasses.filter((c) => {
      if (Number(c.level) !== levelNum) return false;
      if (createModuleFilter) {
        const modName = c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");
        if (modName !== createModuleFilter) return false;
      }
      return true;
    });
  }, [myClasses, createLevelFilter, createModuleFilter]);

  useEffect(() => {
    setCCourse("");
    setCreateModuleFilter("");
    setCreateClassFilter("all");
    setTitlePick("");
    setTitleOther("");
    setCPercent(0);
    setCreateClassEvals([]);
    setEditPercents({});
  }, [createLevelFilter]);

  useEffect(() => {
    setCreateClassFilter("all");
  }, [createModuleFilter]);

  useEffect(() => {
    setCreateClassFilter("all");
    setTitlePick("");
    setTitleOther("");
    setCPercent(0);
    setCreateClassEvals([]);
    setEditPercents({});
  }, [cCourse]);

  useEffect(() => {
    if (createClassFilter === "all") {
      setCreateClassEvals([]);
      setEditPercents({});
      return;
    }
    let cancelled = false;
    setLoadingCreateClassEvals(true);
    apiFetch(`/api/teacher/evaluations?class_id=${Number(createClassFilter)}`)
      .then((res) => {
        if (cancelled) return;
        const evs: EvalItem[] = res?.items || [];
        setCreateClassEvals(evs);
        const initPercents: Record<number, string> = {};
        evs.forEach((e) => { initPercents[e.id] = String(e.percent); });
        setEditPercents(initPercents);
      })
      .catch(() => { if (!cancelled) setCreateClassEvals([]); })
      .finally(() => { if (!cancelled) setLoadingCreateClassEvals(false); });
    return () => { cancelled = true; };
  }, [createClassFilter]);

  const createTitleOptions = useMemo(() => {
    if (createClassFilter === "all") return [];
    const list = items.filter((x) => x.id_class === Number(createClassFilter));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of list) {
      const t = String(it.title || "").trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [items, createClassFilter]);

  async function handleSaveCreateEvalPercent(evalId: number) {
    const val = Number(editPercents[evalId]);
    if (!Number.isFinite(val) || val <= 0 || val > 100) {
      flash("Porcentaje inválido (1..100)", "err");
      return;
    }
    setSavingEvalPercent((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/teacher/evaluations/${evalId}`, {
        method: "PATCH",
        body: JSON.stringify({ percent: val }),
      });
      setCreateClassEvals((prev) =>
        prev.map((e) => (e.id === evalId ? { ...e, percent: val } : e))
      );
      flash("Porcentaje actualizado", "ok");
    } catch (e: any) {
      flash(e?.message || "Error al guardar", "err");
    } finally {
      setSavingEvalPercent((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function handleDeleteCreateEval(evalId: number) {
    setDeletingEval((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/teacher/evaluations/${evalId}`, { method: "DELETE" });
      setCreateClassEvals((prev) => prev.filter((e) => e.id !== evalId));
      setItems((prev) => prev.filter((e) => e.id !== evalId));
      setEditPercents((p) => { const n = { ...p }; delete n[evalId]; return n; });
      flash("Evaluación eliminada", "ok");
    } catch (e: any) {
      flash(e?.message || "Error al eliminar", "err");
    } finally {
      setDeletingEval((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function handleCreate() {
    setMsg(null);

    const id_course = Number(cCourse);
    if (!id_course) return setMsg("Selecciona un curso.");

    if (createClassFilter === "all") {
      return setMsg("Selecciona una materia.");
    }

    const id_class = Number(createClassFilter);

    let id_type = Number(cType);
    const isOtherType = cType === "__other__";
    const type_text = isOtherType ? cTypeOther.trim() : "";

    if (!id_type && !isOtherType) return setMsg("Selecciona un tipo.");
    if (isOtherType && !type_text) return setMsg("Escribe el tipo (Otro).");

    const title = titlePick && titlePick !== "__other__" ? titlePick.trim() : titleOther.trim();
    if (!title) return setMsg("Selecciona o escribe un título.");

    const percent = Number(cPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return setMsg("Porcentaje inválido (1..100).");
    }

    const totalExisting = createClassEvals.reduce((s, e) => s + Number(e.percent), 0);
    if (totalExisting + percent > 100) {
      return setMsg(
        `El porcentaje total superaría 100% (existente: ${totalExisting}%, nuevo: ${percent}%). Ajusta los porcentajes antes de continuar.`
      );
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
      setTitlePick("");
      setTitleOther("");
      setCPercent(0);

      // Reload existing evals for this class (keeps dropdowns selected)
      const reloaded = await apiFetch(`/api/teacher/evaluations?class_id=${id_class}`);
      const evs: EvalItem[] = reloaded?.items || [];
      setCreateClassEvals(evs);
      const initP: Record<number, string> = {};
      evs.forEach((e) => { initP[e.id] = String(e.percent); });
      setEditPercents(initP);

      flash("Evaluación creada", "ok");
    } catch (e: any) {
      setMsg(e?.message || "Error creando evaluación");
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
    const ids = upsertLevelFilter === "all"
      ? myClasses.map((c) => c.id)
      : myClasses.filter((c) => Number(c.level) === Number(upsertLevelFilter)).map((c) => c.id);
    if (ids.length === 0) return;
    loadAllGradeGrids(ids);
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

  // Reload grid on Módulo or Materia change
  useEffect(() => {
    if (upsertLevelFilter === "") return;

    setThFilterCedula("");
    setThFilterName("");

    const levelNum = Number(upsertLevelFilter);

    const getModuleName = (c: TeacherClass) =>
      c.module?.name ?? (c.id_module ? `Módulo ${c.id_module}` : "—");

    if (thFilterClass) {
      const cls = myClasses.find(
        (c) => c.name === thFilterClass && Number(c.level) === levelNum
      );
      if (cls) { loadAllGradeGrids([cls.id]); return; }
    }

    if (thFilterModule) {
      const ids = myClasses
        .filter((c) => Number(c.level) === levelNum && getModuleName(c) === thFilterModule)
        .map((c) => c.id);
      if (ids.length > 0) { loadAllGradeGrids(ids); return; }
    }

    // Both cleared → reload all classes for the level
    const ids = myClasses
      .filter((c) => Number(c.level) === levelNum)
      .map((c) => c.id);
    if (ids.length > 0) loadAllGradeGrids(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thFilterModule, thFilterClass]);

  // =========================
  // FLAT ROWS (for UPSERT table)
  // =========================
  const flatRows = useMemo<FlatGradeRow[]>(() => {
    const studentMap = new Map<string, FlatGradeRow>();

    for (const section of allSections) {
      if (!section.class) continue;
      const classId = section.class.id;
      const classEntry = myClasses.find((c) => c.id === classId);
      const lvl = Number(section.class.level);
      const lvlName = levelMap[lvl] ?? `Año ${lvl}`;
      const moduleId = classEntry?.id_module ? Number(classEntry.id_module) : null;
      const moduleName = classEntry?.module?.name ?? (moduleId ? `Módulo ${moduleId}` : "—");
      const groupId = classEntry?.id_group ? Number(classEntry.id_group) : null;
      const groupName = classEntry?.group?.name ?? (groupId ? `Grupo ${groupId}` : "—");
      const className = section.class.name;
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
  const thLevelOptions = useMemo(() => {
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

  const thGroupOptions = useMemo(() => {
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
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    const levelNum = upsertLevelFilter && upsertLevelFilter !== "all" ? Number(upsertLevelFilter) : null;
    for (const c of myClasses) {
      if (levelNum !== null && Number(c.level) !== levelNum) continue;
      if (thFilterModule && classModuleName(c) !== thFilterModule) continue;
      if (!seen.has(c.name)) {
        seen.add(c.name);
        out.push({ value: c.name, label: c.name });
      }
    }
    return out;
  }, [myClasses, upsertLevelFilter, thFilterModule]);

  const ctxMatches = (r: FlatGradeRow) =>
    r.allSectionContexts.some(
      (ctx) =>
        (!thFilterModule || ctx.moduleName === thFilterModule) &&
        (!thFilterGroup || ctx.groupName === thFilterGroup) &&
        (!thFilterClass || ctx.className === thFilterClass)
    );

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
    for (const c of myClasses) {
      if (Number(c.level) !== levelNum) continue;
      const name = classModuleName(c);
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ value: name, label: name });
      }
    }
    return out;
  }, [myClasses, createLevelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    for (const r of flatRowsFiltered) {
      for (const ev of r.sectionEvals) {
        if (!seenEvalIds.has(ev.id)) {
          seenEvalIds.add(ev.id);
          out.push(ev);
        }
      }
    }
    return out.sort((a, b) => a.id - b.id);
  }, [flatRowsFiltered]);

  const upsertDynamicMinWidth = useMemo(() => {
    return 260 + 150 + visibleEvals.length * 170 + 160;
  }, [visibleEvals]);

  async function loadAllGradeGrids(classIds: number[]) {
    const myId = ++loadIdRef.current;
    setMsg(null);
    setGLoadingRoster(true);
    setAllSections([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});

    try {
      const batchRes = await apiFetch(
        `/api/teacher/grade-grids-batch?class_ids=${classIds.join(",")}`
      ) as { sections: GradeGridResponse[] };

      if (myId !== loadIdRef.current) return; // descartamos carga obsoleta

      const sections = (batchRes?.sections ?? []).filter((r) => r?.class);
      setAllSections(sections);

      const drafts: Record<string, string> = {};
      for (const section of sections) {
        for (const g of section.grades || []) {
          drafts[gradeCellKey(g.id_student, g.id_exam)] =
            g.grade === null || g.grade === undefined ? "" : String(Number(g.grade));
        }
      }
      setGradeDraft(drafts);
    } catch (e: any) {
      if (myId !== loadIdRef.current) return;
      setMsg(e?.message || "Error cargando alumnos/notas");
      setAllSections([]);
      setGradeDraft({});
    } finally {
      if (myId === loadIdRef.current) setGLoadingRoster(false);
    }
  }

  function loadGradeGrid() {
    if (upsertLevelFilter === "") return;
    const ids = upsertLevelFilter === "all"
      ? myClasses.map((c) => c.id)
      : myClasses.filter((c) => Number(c.level) === Number(upsertLevelFilter)).map((c) => c.id);
    if (ids.length === 0) return;
    loadAllGradeGrids(ids);
  }

  function getEvaluationColumnLabel(ev: EvalItem, countsMap: Map<string, number>) {
    const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
    const typeKey = typeLabel.toLowerCase();
    const repeated = (countsMap.get(typeKey) || 0) > 1;
    if (repeated) return `${typeLabel} · ${ev.title} (${Number(ev.percent).toFixed(0)}%)`;
    return `${typeLabel} (${Number(ev.percent).toFixed(0)}%)`;
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

    setSavingOne((prev) => ({ ...prev, [student.id]: true }));
    setMsg(null);

    try {
      for (const ev of applicableEvals) {
        const key = gradeCellKey(student.id, ev.id);
        const draft = (gradeDraft[key] ?? "").trim();
        const grade = draft === "" ? NaN : Number(draft);

        if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
          throw new Error(
            `Nota inválida para ${student.name} en "${getEvaluationColumnLabel(ev, new Map())}" (0..100)`
          );
        }
      }

      await Promise.all(
        applicableEvals.map((ev) => {
          const key = gradeCellKey(student.id, ev.id);
          return apiFetch("/api/teacher/grades", {
            method: "POST",
            body: JSON.stringify({
              exam_id: ev.id,
              student_cedula: student.cedula,
              grade: Number(gradeDraft[key]),
            }),
          });
        })
      );

      setEditingRow((prev) => ({ ...prev, [student.id]: false }));
      setRowSnapshot((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });

      flash(`✅ Notas guardadas: ${student.name}`, "ok");
    } catch (e: any) {
      setMsg(e?.message || `Error guardando notas de ${student.name}`);
      flash(`❌ Error guardando: ${student.name}`, "err");
    } finally {
      setSavingOne((prev) => ({ ...prev, [student.id]: false }));
    }
  }

  async function saveAll() {
    const hasSections = allSections.some(
      (s) => (s.students?.length ?? 0) > 0 && (s.evaluations?.length ?? 0) > 0
    );
    if (!hasSections) return;

    setSavingAll(true);
    setMsg(null);

    try {
      const payloads: Array<{ exam_id: number; student_cedula: string; grade: number }> = [];

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
    } catch (e: any) {
      setMsg(e?.message || "Error actualizando todas las notas");
      flash("❌ Error actualizando todas", "err");
    } finally {
      setSavingAll(false);
    }
  }

  function downloadExcel() {
    const label = thFilterClass || thFilterModule
      || (upsertCourseFilter !== "all" ? coursesForUpsert.find(c => c.id === Number(upsertCourseFilter))?.name : undefined)
      || (upsertLevelFilter !== "" ? (levels.find(l => l.id === Number(upsertLevelFilter))?.name ?? `Nivel ${upsertLevelFilter}`) : "Grilla");
    const countsMap = new Map<string, number>();
    for (const ev of visibleEvals) {
      const k = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim().toLowerCase();
      countsMap.set(k, (countsMap.get(k) || 0) + 1);
    }
    const rows = flatRowsFiltered.map((row) => {
      const st = row.student;
      const r: Record<string, string | number> = { Cédula: st.cedula, Alumno: st.name };
      for (const ev of visibleEvals) {
        const col = getEvaluationColumnLabel(ev, countsMap);
        if (Number(st.id_course) !== Number(ev.id_course)) { r[col] = "-"; continue; }
        const gradeRecord = row.sectionGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
        const attempts = gradeRecord?.attempts ?? 0;
        const gradeVal = gradeRecord?.grade ?? 0;
        if (attempts === 0 && gradeVal === 0) { r[col] = "No Presentó"; }
        else {
          const key = gradeCellKey(st.id, ev.id);
          const val = gradeDraft[key];
          r[col] = val === "" || val == null ? "" : Number(val);
        }
      }
      return r;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    XLSX.writeFile(wb, `${label}.xlsx`);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
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
              <div style={{ fontWeight: 900, fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Panel Profesor</div>
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

            <div
              style={{
                minWidth: 260,
                padding: 10,
              }}
            >
              <select
                className="select"
                value={view}
                onChange={(e) => {
                  const next = e.target.value as TeacherView;
                  setView(next);
                  setMsg(null);
                  if (next === "DASHBOARD") loadDashboard();
                  if (next === "EVALS") loadEvaluations();
                  if (next === "CREATE") {
                    loadTeacherCourses();
                    loadTypes();
                    setCCourse("");
                    setCreateClassFilter("all");
                    setCType("");
                    setCTypeOther("");
                    setTitlePick("");
                    setTitleOther("");
                    setCPercent(0);
                    setCreateClassEvals([]);
                    setEditPercents({});
                  }
                }}
              >
                <option value="" disabled>¿Qué quieres hacer?...</option>
                <option value="DASHBOARD">Ver Materias Asignadas</option>
                <option value="UPSERT">Gestionar notas de Estudiantes</option>
                <option value="CREATE">Crear/Eliminar Evaluaciones</option>
                <option value="EVALS">Ver/Actualizar Evaluaciones</option>
              </select>
            </div>
          </div>

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
                      {dashboard?.summary?.assigned_classes ?? 0}
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
                      {dashboard?.summary?.total_students ?? 0}
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
                      {dashboard?.summary?.academic_year ?? new Date().getFullYear()}
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
                            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 700 }}>
                              Materia
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashAssignmentsFiltered.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ padding: 16, color: "var(--muted)" }}>
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
                        {/* Materia */}
                        <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: GRILLA.headerBottomBorder, whiteSpace: "nowrap" }}>
                          <select
                            className="select"
                            value={evalClassFilter === "all" ? "all" : String(evalClassFilter)}
                            onChange={(e) => setEvalClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                            style={{ fontSize: 13, padding: "3px 6px", fontWeight: 700, color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight }}
                          >
                            <option value="all" style={{ fontWeight: 700 }}>Materia</option>
                            {evalClassOptions.map((c) => (
                              <option key={c.id} value={String(c.id)}>{c.name}</option>
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
                          const isReadOnly = isModuleLevel || isGroupLevel;
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
                                  />
                                )}
                              </td>
                              <td style={{ padding: "4px 12px", borderBottom: GRILLA.rowBottomBorder, background: bg, textAlign: "center" }}>
                                {isReadOnly ? (
                                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Solo lectura</span>
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
                <div><h2 style={{ margin: 0 }}>Crear evaluación</h2></div>
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

                {/* Materia */}
                <div style={{ flex: "2 1 180px" }}>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={createClassFilter === "all" ? "all" : String(createClassFilter)}
                    disabled={createLevelFilter === ""}
                    onChange={(e) =>
                      setCreateClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Materia</option>
                    {createClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
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
                      setTitlePick("");
                      setTitleOther("");
                      setCPercent(0);
                      setCreateClassEvals([]);
                      setEditPercents({});
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
                        <option value="__other__">Otro...</option>
                      </select>
                      {cType === "__other__" && (
                        <input
                          className="input"
                          style={{ marginTop: 8 }}
                          value={cTypeOther}
                          onChange={(e) => setCTypeOther(e.target.value)}
                          placeholder="Ej: Taller, Quiz..."
                        />
                      )}
                    </div>

                    {/* Título */}
                    <div style={{ flex: "2 1 180px" }}>
                      <div className="label">Título</div>
                      <select
                        className="select"
                        value={titlePick}
                        onChange={(e) => {
                          setTitlePick(e.target.value);
                          if (e.target.value !== "__other__") setTitleOther("");
                        }}
                        disabled={createClassFilter === "all"}
                      >
                        <option value="">
                          {createClassFilter === "all" ? "Selecciona una materia primero" : "Selecciona..."}
                        </option>
                        {createTitleOptions.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                        <option value="__other__">Otro...</option>
                      </select>
                      {titlePick === "__other__" && (
                        <input
                          className="input"
                          style={{ marginTop: 8 }}
                          value={titleOther}
                          onChange={(e) => setTitleOther(e.target.value)}
                          placeholder="Escribe el título..."
                        />
                      )}
                    </div>

                    {/* Porcentaje */}
                    <div style={{ flex: "0 0 120px" }}>
                      <div className="label">%</div>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="input"
                        style={{ textAlign: "center", width: "100%" }}
                        value={cPercent}
                        onChange={(e) => setCPercent(Number(e.target.value))}
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
                  <div className="label" style={{ width: "90%", marginBottom: 8 }}>Evaluaciones existentes</div>
                  {(true) && (
                    <div
                      style={{
                        borderRadius: 14,
                        border: "1px solid var(--stroke)",
                        overflow: "hidden",
                        width: "90%",
                      }}
                    >
                      {/* encabezado */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "200px 1fr 100px 130px 130px",
                          padding: "12px 16px",
                          background: isDarkTheme ? GRILLA.headerBgDark : GRILLA.headerBgLight,
                          borderBottom: "1px solid var(--stroke)",
                          fontWeight: 800,
                          fontSize: 13,
                          color: isDarkTheme ? GRILLA.headerTextDark : GRILLA.headerTextLight,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ textAlign: "center" }}>Tipo</div>
                        <div style={{ textAlign: "left", paddingLeft: 160 }}>Titulo</div>
                        <div style={{ textAlign: "left", marginLeft: -200 }}>%</div>
                        <div />
                        <div />
                      </div>
                      {/* filas */}
                      {createClassFilter === "all" ? (
                        <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>
                          Selecciona una materia para ver sus evaluaciones.
                        </div>
                      ) : loadingCreateClassEvals ? (
                        <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>Cargando evaluaciones...</div>
                      ) : createClassEvals.length === 0 ? (
                        <div style={{ padding: "14px 16px", color: "var(--muted)", fontSize: 13 }}>Esta materia no tiene evaluaciones aún.</div>
                      ) : (
                        createClassEvals.map((ev) => (
                          <div
                            key={ev.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "200px 1fr 100px 130px 130px",
                              padding: "12px 16px",
                              alignItems: "center",
                              borderBottom: "1px solid var(--stroke)",
                              fontSize: 14,
                            }}
                          >
                            <div style={{ fontSize: 13, textAlign: "center" }}>
                              {ev.evaluation_type?.type ?? "—"}
                            </div>
                            <div style={{ textAlign: "left", paddingLeft: 160 }}>{ev.title}</div>
                            <div style={{ display: "flex", justifyContent: "flex-start", marginLeft: -200 }}>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                className="input"
                                style={{ textAlign: "center", padding: "4px 8px", fontSize: 13, width: 72, borderRadius: 9999 }}
                                value={editPercents[ev.id] ?? String(ev.percent)}
                                onChange={(e) =>
                                  setEditPercents((p) => ({ ...p, [ev.id]: e.target.value }))
                                }
                              />
                            </div>
                            <div style={{ marginLeft: -80, paddingRight: 6, width: 130 }}>
                              <button
                                type="button"
                                style={{ fontSize: 13, padding: "6px 0", width: "100%", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 9999, fontWeight: 600, cursor: "pointer" }}
                                disabled={savingEvalPercent[ev.id]}
                                onClick={() => handleSaveCreateEvalPercent(ev.id)}
                              >
                                {savingEvalPercent[ev.id] ? "..." : "Guardar"}
                              </button>
                            </div>
                            <div style={{ marginLeft: -80, width: 130 }}>
                              <button
                                type="button"
                                style={{ fontSize: 13, padding: "6px 0", width: "100%", background: "#ef4444", color: "#fff", border: "none", borderRadius: 9999, fontWeight: 600, cursor: "pointer" }}
                                disabled={deletingEval[ev.id]}
                                onClick={() => handleDeleteCreateEval(ev.id)}
                              >
                                {deletingEval[ev.id] ? "..." : "Eliminar"}
                              </button>
                            </div>
                          </div>
                        ))
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
                  <h2 style={{ margin: 0 }}>Gestionar Notas Estudiantes</h2>
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

                {/* Materia */}
                <div style={{ flex: "2 1 180px" }}>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={thFilterClass}
                    disabled={upsertLevelFilter === ""}
                    onChange={(e) => { setThFilterClass(e.target.value); }}
                  >
                    <option value="" style={{ fontWeight: 700 }}>Materia</option>
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
                      setThFilterModule("");
                      setThFilterGroup("");
                      setThFilterClass("");
                      setThFilterCedula("");
                      setThFilterName("");
                      setAllSections([]);
                      setGradeDraft({});
                      setEditingRow({});
                      setRowSnapshot({});
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>

              {upsertLevelFilter === "" ? null : (
                <div style={{ marginTop: 16 }}>
                  {/* Fila 2: label selección (izq) + Descargar (der) */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ fontWeight: 900 }}>
                      {thFilterClass
                        ? `Materia: ${thFilterClass}`
                        : thFilterGroup
                          ? `Grupo: ${thFilterGroup}${thFilterModule ? ` · ${thFilterModule}` : ""} — Todas las materias`
                          : thFilterModule
                            ? `Módulo: ${thFilterModule} — Todos los grupos — Todas las materias`
                            : upsertCourseFilter !== "all"
                              ? `Curso: ${coursesForUpsert.find(c => c.id === Number(upsertCourseFilter))?.name ?? "—"} — Todos`
                              : `${levels.find(l => l.id === Number(upsertLevelFilter))?.name ?? `Nivel ${upsertLevelFilter}`} — Todos`}
                    </div>
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
                    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "68vh", minHeight: 200, background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)" }}>
                      {(() => {
                        const visibleEvalCountsMap = new Map<string, number>();
                        for (const ev of visibleEvals) {
                          const k = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim().toLowerCase();
                          visibleEvalCountsMap.set(k, (visibleEvalCountsMap.get(k) || 0) + 1);
                        }
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
                              {/* Subheader: nombres de materias cuando se muestran varias */}
                              {!thFilterClass && visibleEvals.length > 0 && (() => {
                                const groups: { classId: number; className: string; count: number }[] = [];
                                for (const ev of visibleEvals) {
                                  const cid = ev.id_class ?? 0;
                                  const last = groups[groups.length - 1];
                                  if (last && last.classId === cid) { last.count++; }
                                  else groups.push({ classId: cid, className: ev.class?.name || `Clase ${cid}`, count: 1 });
                                }
                                if (groups.length <= 1) return null;
                                return (
                                  <tr>
                                    <td colSpan={2} style={{ borderBottom: GRILLA.headerBottomBorder, background: GRILLA.headerBgLight, position: "sticky", top: 0, left: 0, zIndex: 7 }} />
                                    {groups.map((g) => (
                                      <td key={g.classId} colSpan={g.count} style={{ padding: "4px 10px", borderBottom: GRILLA.headerBottomBorder, fontSize: 11, textAlign: "center", background: GRILLA.headerBgLight, borderLeft: "1px solid var(--stroke)", position: "sticky", top: 0, zIndex: 5 }}>
                                        {g.className}
                                      </td>
                                    ))}
                                    <td style={{ borderBottom: GRILLA.headerBottomBorder, background: GRILLA.headerBgLight, position: "sticky", top: 0, zIndex: 5 }} />
                                  </tr>
                                );
                              })()}
                              <tr>
                                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, position: "sticky", top: 0, left: 0, zIndex: 6, whiteSpace: "nowrap", boxShadow: "none" }}>
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
                                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: GRILLA.headerBottomBorder, position: "sticky", top: 0, left: STICKY_ALUMNO_LEFT, zIndex: 6, boxShadow: "none" }}>
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
                                {visibleEvals.map((ev) => (
                                  <th key={ev.id} style={{ textAlign: "left", padding: "8px 10px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 800, position: "sticky", top: 0, zIndex: 5, lineHeight: 1.2 }}>
                                    {getEvaluationColumnLabel(ev, visibleEvalCountsMap)}
                                  </th>
                                ))}
                                <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: GRILLA.headerBottomBorder, fontWeight: 800, position: "sticky", top: 0, zIndex: 5 }} />
                              </tr>
                            </thead>

                            <tbody>
                              {gLoadingRoster ? (
                                <tr>
                                  <td colSpan={Math.max(3, visibleEvals.length + 3)} style={{ padding: 32, minHeight: 120, textAlign: "center", fontSize: 14, color: "var(--muted)", background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)" }}>
                                    Cargando alumnos y notas...
                                  </td>
                                </tr>
                              ) : flatRowsFiltered.length === 0 ? (
                                <tr>
                                  <td colSpan={Math.max(3, visibleEvals.length + 3)} style={{ padding: 16, color: "var(--muted)", background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)" }}>
                                    {allSections.length === 0
                                      ? "No se encontraron materias para los filtros seleccionados."
                                      : "No hay alumnos que coincidan con los filtros."}
                                  </td>
                                </tr>
                              ) : (
                                flatRowsFiltered.map((row, rowIndex) => {
                                  const st = row.student;
                                  const isEditing = !!editingRow[st.id];
                                  const isBusy = !!savingOne[st.id] || savingAll;
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
                                        const attempts = gradeRecord?.attempts ?? 0;
                                        const gradeVal = gradeRecord?.grade ?? 0;
                                        const noPresentó = enabledForCourse && attempts === 0 && gradeVal === 0;

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
                                                placeholder={enabledForCourse ? "—" : "-"}
                                                onFocus={(e) => { if (editable) { e.currentTarget.style.background = getGrillaFocusCellBg(isDarkTheme); e.currentTarget.style.boxShadow = "inset 0 0 0 1.5px #3b82f6"; } }}
                                                onBlur={(e) => { e.currentTarget.style.background = editable ? editableCellBg : "transparent"; e.currentTarget.style.boxShadow = "none"; }}
                                                style={{ width: "100%", minWidth: 0, height: 26, border: "none", borderRadius: 0, outline: "none", background: editable ? editableCellBg : "transparent", boxShadow: "none", padding: "0 10px", fontSize: 13, lineHeight: 1, fontWeight: editable ? 700 : 500, color: enabledForCourse ? cellTextColor : isDarkTheme ? "var(--muted)" : "#94a3b8", cursor: editable ? "text" : "default", opacity: enabledForCourse ? 1 : 0.6 }}
                                              />
                                            )}
                                          </td>
                                        );
                                      })}

                                      <td style={{ padding: "4px 8px", borderBottom: GRILLA.rowBottomBorder, background: isEditing ? activeRowBg : baseRowBg }}>
                                        <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                                          <button
                                            className="btn"
                                            onClick={() => handleRowAction(st, row.sectionEvals)}
                                            disabled={isBusy}
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
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer rightText="Hecho para la Iglesia La Promesa." />
    </div>
  );
}