"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { primaryRole, roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";

type TeacherClass = { id: number; name: string; level: number };

type EvalItem = {
  id: number;
  title: string;
  percent: number;
  created_at: string;
  course?: { id: number; name: string; level: number; year: string };
  class?: { id: number; name: string; level: number };
  evaluation_type?: { id: number; type: string };
  id_course: number;
  id_class: number;
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

type DashboardGroup = {
  level: number;
  level_label: string;
  items: TeacherClass[];
};

type TeacherDashboardResponse = {
  summary: {
    assigned_classes: number;
    total_students: number;
    academic_year: number;
  };
  groups: DashboardGroup[];
};

type TeacherView = "DASHBOARD" | "EVALS" | "CREATE" | "UPSERT";
type LevelValue = number | "all" | "";
const GRILLA = {
  headerBgLight: "#d9edf7",
  headerBgDark: "#083b5c",
  headerTextLight: "#0f172a",
  headerTextDark: "#eaf4ff",
  rowHoverBgLight: "#eef6fb",
  rowHoverBgDark: "#0b2236",

  stripeLightEven: "#ffffff",
  stripeLightOdd: "#f9fdfd",

  stripeDarkEven: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
  stripeDarkOdd: "#051422",

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

function levelLabel(level: number | null | undefined) {
  const n = Number(level);
  if (n === 1) return "Primer año";
  if (n === 2) return "Segundo año";
  if (n === 3) return "Tercer año";
  if (n === 4) return "Cuarto año";
  return `Año ${level ?? "—"}`;
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
  const [view, setView] = useState<TeacherView>("DASHBOARD");

  const [items, setItems] = useState<EvalItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  const [dashboard, setDashboard] = useState<TeacherDashboardResponse | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);

  // ===== FILTROS POR PANEL =====
  // EVALS
  const [evalLevelFilter, setEvalLevelFilter] = useState<LevelValue>("all");
  const [evalClassFilter, setEvalClassFilter] = useState<number | "all">("all");

  // CREATE
  const [createClassFilter, setCreateClassFilter] = useState<number | "all">("all");

  // UPSERT
  const [upsertLevelFilter, setUpsertLevelFilter] = useState<LevelValue>("");
  const [upsertClassFilter, setUpsertClassFilter] = useState<number | "all">("all");

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
  const [cPercent, setCPercent] = useState<number>(30);
  const [creating, setCreating] = useState(false);

  const [gridClassInfo, setGridClassInfo] = useState<{
    id: number;
    name: string;
    level: number;
  } | null>(null);
  const [gEvaluations, setGEvaluations] = useState<EvalItem[]>([]);
  const [gRoster, setGRoster] = useState<StudentRow[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);

  const [gGrades, setGGrades] = useState<GridGradeRow[]>([]);
  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  const [percentDraft, setPercentDraft] = useState<Record<number, string>>({});
  const [savingPercents, setSavingPercents] = useState(false);

  const [editingRow, setEditingRow] = useState<Record<string, boolean>>({});
  const [rowSnapshot, setRowSnapshot] = useState<Record<string, Record<string, string>>>({});

  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const pendingUpsertClassIdRef = useRef<number | null>(null);

  const CEDULA_COL_W = 150;
  const ALUMNO_COL_W = 260;
  const EVAL_COL_W = 170;
  const ACTION_COL_W = 160;
  const STICKY_ALUMNO_LEFT = CEDULA_COL_W;

  function goToUpsertFromEvaluation(item: EvalItem) {
    const classId = Number(item.id_class);
    const level = Number(item.class?.level ?? 0);

    if (!classId || !level) return;

    setMsg(null);
    setView("UPSERT");

    if (Number(upsertLevelFilter) === level) {
      setUpsertClassFilter(classId);
      return;
    }

    pendingUpsertClassIdRef.current = classId;
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
    setToast({ text, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

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

  const evalItemsFiltered = useMemo(() => {
    let list = [...items];

    if (evalLevelFilter !== "all" && evalLevelFilter !== "") {
      list = list.filter((e) => Number(e.class?.level ?? 0) === Number(evalLevelFilter));
    }

    if (evalClassFilter !== "all") {
      list = list.filter((e) => e.id_class === Number(evalClassFilter));
    }

    return list;
  }, [items, evalLevelFilter, evalClassFilter]);

  const evalsInSelectedClass = useMemo(() => {
    if (evalClassFilter === "all") return [];
    return items.filter((e) => e.id_class === Number(evalClassFilter));
  }, [items, evalClassFilter]);

  useEffect(() => {
    if (evalLevelFilter === "all") {
      setEvalClassFilter("all");
      return;
    }
    if (evalClassFilter === "all") return;

    const exists = evalClassesFiltered.some((c) => c.id === Number(evalClassFilter));
    if (!exists) setEvalClassFilter("all");
  }, [evalLevelFilter, evalClassFilter, evalClassesFiltered]);

  useEffect(() => {
    if (evalClassFilter === "all") {
      setPercentDraft({});
      return;
    }
    const next: Record<number, string> = {};
    for (const e of evalsInSelectedClass) next[e.id] = String(Number(e.percent ?? 0));
    setPercentDraft(next);
  }, [evalClassFilter, evalsInSelectedClass]);

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

  // =========================
  // CREATE FILTERS
  // =========================
  const selectedCreateCourse = useMemo(() => {
    const id = Number(cCourse);
    if (!id) return null;
    return courses.find((c) => Number(c.id) === id) || null;
  }, [cCourse, courses]);

  const createClassesFiltered = useMemo(() => {
    if (!selectedCreateCourse?.id) return [];
    return myClasses.filter((c) => Number(c.level) === Number(selectedCreateCourse.level));
  }, [myClasses, selectedCreateCourse]);

  useEffect(() => {
    setCreateClassFilter("all");
    setTitlePick("");
    setTitleOther("");
    setCPercent(30);
  }, [cCourse]);

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
      return setMsg("Percent inválido (1..100)");
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

      const newEvalLevel = Number(selectedCreateCourse?.level ?? 0);

      setCCourse("");
      setCreateClassFilter("all");
      setCType("");
      setCTypeOther("");
      setTitlePick("");
      setTitleOther("");
      setCPercent(30);

      flash("✅ Evaluación creada", "ok");
      await loadEvaluations();
      setView("EVALS");

      if (Number.isFinite(newEvalLevel) && newEvalLevel > 0) {
        setEvalLevelFilter(newEvalLevel);
      }
      setEvalClassFilter(id_class);
    } catch (e: any) {
      setMsg(e?.message || "Error creando evaluación");
      flash("❌ No se pudo crear", "err");
    } finally {
      setCreating(false);
    }
  }

  // =========================
  // UPSERT FILTERS
  // =========================
  const upsertClassesFiltered = useMemo(() => {
    if (upsertLevelFilter === "") return [];
    if (upsertLevelFilter === "all") return myClasses;
    return myClasses.filter((c) => Number(c.level) === Number(upsertLevelFilter));
  }, [myClasses, upsertLevelFilter]);

  useEffect(() => {
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});

    if (pendingUpsertClassIdRef.current !== null) {
      setUpsertClassFilter(pendingUpsertClassIdRef.current);
      pendingUpsertClassIdRef.current = null;
    } else {
      setUpsertClassFilter("all");
    }
  }, [upsertLevelFilter]);

  useEffect(() => {
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});
  }, [upsertClassFilter]);

  const selectedUpsertClass = useMemo(() => {
    if (upsertClassFilter === "all") return null;
    return myClasses.find((c) => c.id === Number(upsertClassFilter)) || null;
  }, [upsertClassFilter, myClasses]);

  const upsertDynamicMinWidth = useMemo(() => {
    const cedulaW = 170;
    const alumnoW = 320;
    const evalW = 220;
    const actionW = 180;

    return cedulaW + alumnoW + actionW + gEvaluations.length * evalW;
  }, [gEvaluations.length]);

  async function loadGradeGrid() {
    setMsg(null);
    setGLoadingRoster(true);
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});

    try {
      if (upsertClassFilter === "all") return;

      const res: GradeGridResponse = await apiFetch(
        `/api/teacher/class-grade-grid?class_id=${Number(upsertClassFilter)}`
      );

      const evals = res?.evaluations || [];
      const roster = res?.students || [];
      const grades = res?.grades || [];

      setGridClassInfo(res?.class || null);
      setGEvaluations(evals);
      setGRoster(roster);
      setGGrades(grades);

      const drafts: Record<string, string> = {};
      for (const g of grades) {
        drafts[gradeCellKey(g.id_student, g.id_exam)] =
          g.grade === null || g.grade === undefined ? "" : String(Number(g.grade));
      }
      setGradeDraft(drafts);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando alumnos/notas");
      setGridClassInfo(null);
      setGEvaluations([]);
      setGRoster([]);
      setGGrades([]);
      setGradeDraft({});
    } finally {
      setGLoadingRoster(false);
    }
  }

  useEffect(() => {
    if (upsertClassFilter === "all") return;
    loadGradeGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertClassFilter]);

  const evaluationTypeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of gEvaluations) {
      const key = String(ev.evaluation_type?.type || ev.title || "Evaluación")
        .trim()
        .toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [gEvaluations]);

  function getEvaluationColumnLabel(ev: EvalItem) {
    const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
    const typeKey = typeLabel.toLowerCase();
    const repeated = (evaluationTypeCounts.get(typeKey) || 0) > 1;

    if (repeated) {
      return `${typeLabel} · ${ev.title} (${Number(ev.percent).toFixed(0)}%)`;
    }
    return `${typeLabel} (${Number(ev.percent).toFixed(0)}%)`;
  }

  function isEvaluationApplicableToStudent(student: StudentRow, ev: EvalItem) {
    return Number(student.id_course) === Number(ev.id_course);
  }

  function getStudentApplicableEvaluations(student: StudentRow) {
    return gEvaluations.filter((ev) => isEvaluationApplicableToStudent(student, ev));
  }

  function beginEdit(student: StudentRow) {
    const applicableEvals = getStudentApplicableEvaluations(student);
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

  async function handleRowAction(student: StudentRow) {
    if (!editingRow[student.id]) {
      beginEdit(student);
      return;
    }

    await saveOne(student);
  }

  async function saveOne(student: StudentRow) {
    const applicableEvals = getStudentApplicableEvaluations(student);

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
            `Nota inválida para ${student.name} en "${getEvaluationColumnLabel(ev)}" (0..100)`
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
    if (gRoster.length === 0 || gEvaluations.length === 0) return;

    setSavingAll(true);
    setMsg(null);

    try {
      const payloads: Array<{ exam_id: number; student_cedula: string; grade: number }> = [];

      for (const st of gRoster) {
        const applicableEvals = getStudentApplicableEvaluations(st);

        for (const ev of applicableEvals) {
          const key = gradeCellKey(st.id, ev.id);
          const raw = (gradeDraft[key] ?? "").trim();
          const n = raw === "" ? NaN : Number(raw);

          if (!Number.isFinite(n) || n < 0 || n > 100) {
            throw new Error(
              `Nota inválida para ${st.name} en "${getEvaluationColumnLabel(ev)}" (0..100)`
            );
          }

          payloads.push({
            exam_id: ev.id,
            student_cedula: st.cedula,
            grade: n,
          });
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

      flash("✅ Notas actualizadas para toda la materia", "ok");
    } catch (e: any) {
      setMsg(e?.message || "Error actualizando todas las notas");
      flash("❌ Error actualizando todas", "err");
    } finally {
      setSavingAll(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const roleLabel = useMemo(() => roleLabelFromRole(primaryRole(me)), [me]);

  if (loadingMe) return <div className="container">Cargando...</div>;

  const isDarkTheme = isDarkThemeEnabled();

  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div>
      {toast && (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            padding: "12px 14px",
            borderRadius: 14,
            fontWeight: 900,
            color: toast.kind === "ok" ? "rgb(21,128,61)" : "rgb(185,28,28)",
            background: "var(--card)",
            border: "1px solid var(--stroke)",
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {toast.text}
        </div>
      )}

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
        }

        .teacher-solid-table tbody tr.table-row-hover[data-editing="false"]:hover > td {
          background-color: var(--table-row-hover-bg) !important;
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

      {/* SIDEBAR */}
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
                onChange={(e) => setView(e.target.value as TeacherView)}
              >
                <option value="DASHBOARD">Ver mis Materias</option>
                <option value="EVALS">Ver mis Evaluaciones</option>
                <option value="CREATE">Crear una Evaluación</option>
                <option value="UPSERT">Cambiar Nota a mis Estudiantes</option>
              </select>
            </div>
          </div>

          {msg && (
            <div className="msgError" style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}

          {/* =======================
              PANEL: DASHBOARD
              ======================= */}
          {view === "DASHBOARD" && (
            <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
              {/* TABLA / GRID DE MATERIAS POR AÑO */}
              <div className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <h2 style={{ margin: 0 }}>Mis materias por año</h2>

                  <button
                    type="button"
                    onClick={loadDashboard}
                    className="btnLight"
                    style={{ fontWeight: 900 }}
                  >
                    {loadingDashboard ? "Cargando..." : "Refrescar"}
                  </button>
                </div>

                {loadingDashboard ? (
                  <div style={{ color: "var(--muted)" }}>Cargando dashboard...</div>
                ) : !dashboard?.groups?.length ? (
                  <div style={{ color: "var(--muted)" }}>
                    No tienes materias asignadas actualmente.
                  </div>
                ) : (
                  <div
                    style={{
                      overflowX: "auto",
                      borderRadius: 18,
                      border: "1px solid var(--stroke)",
                    }}
                  >
                    <div
                      style={{
                        minWidth: 900,
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                      }}
                    >
                      {[1, 2, 3, 4].map((lvl, idx) => {
                        const group = dashboard.groups.find((g) => Number(g.level) === lvl);
                        const items = group?.items || [];

                        return (
                          <div
                            key={lvl}
                            style={{
                              borderRight: idx < 3 ? "1px solid var(--stroke)" : "none",
                              minHeight: 420,
                              display: "flex",
                              flexDirection: "column",
                            }}
                          >
                            {/* encabezado columna */}
                            <div
                              style={{
                                padding: "14px 16px",
                                borderBottom: "1px solid var(--stroke)",
                                background: "rgba(14,165,233,.06)",
                                fontWeight: 700,
                                letterSpacing: ".04em",
                                fontSize: 15,
                              }}
                            >
                              {levelLabel(lvl)}
                            </div>

                            {/* cuerpo columna */}
                            <div
                              style={{
                                padding: 12,
                                display: "grid",
                                gap: 10,
                                alignContent: "start",
                                flex: 1,
                              }}
                            >
                              {items.length === 0 ? (
                                <div
                                  style={{
                                    fontSize: 14,
                                    padding: "8px 4px",
                                  }}
                                >
                                  Sin materias asignadas
                                </div>
                              ) : (
                                items.map((item) => (
                                  <div
                                    key={item.id}
                                    style={{
                                      padding: "-2px",
                                      fontWeight: 500,
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    {item.name}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

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
            </div>
          )}

          {/* =======================
              PANEL: MIS EVALUACIONES
              ======================= */}
          {view === "EVALS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Mis evaluaciones</h2>
                <button onClick={loadEvaluations} className="btnLight" style={{ fontWeight: 900 }}>
                  {loadingList ? "Cargando..." : "Refrescar"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    value={String(evalLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEvalLevelFilter(v === "all" ? "all" : Number(v));
                    }}
                  >
                    <option value="all">Todos los años</option>
                    {availableLevels.map((lvl) => (
                      <option key={lvl} value={String(lvl)}>
                        {levelLabel(lvl)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={evalClassFilter}
                    onChange={(e) =>
                      setEvalClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                  >
                    <option value="all">
                      {evalLevelFilter === "all"
                        ? "Todas mis materias"
                        : "Todas mis materias del año"}
                    </option>
                    {evalClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {loadingClasses && (
                <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                  Cargando materias...
                </div>
              )}

              {evalClassFilter !== "all" && (
                <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                  Tip: puedes editar el <b>%</b> de esta materia y luego guardar al final.
                </div>
              )}

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
                      <th style={{ textAlign: "left", padding: 12, width: 120 }}>%</th>
                      <th style={{ textAlign: "left", padding: 12 }}>Materia</th>
                      <th style={{ textAlign: "left", padding: 12 }}>Curso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalItemsFiltered.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingList ? "Cargando..." : "No tienes evaluaciones con ese filtro."}
                        </td>
                      </tr>
                    ) : (
                      evalItemsFiltered.map((e) => {
                        const editable =
                          evalClassFilter !== "all" && e.id_class === Number(evalClassFilter);

                        return (
                          <tr key={e.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                            <td style={{ padding: 12 }}>
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
                            </td>

                            <td style={{ padding: 12 }}>
                              {editable ? (
                                <input
                                  className="input"
                                  inputMode="numeric"
                                  value={percentDraft[e.id] ?? String(e.percent)}
                                  onChange={(ev) => {
                                    const v = ev.target.value;
                                    if (v === "") {
                                      return setPercentDraft((p) => ({ ...p, [e.id]: "" }));
                                    }
                                    if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) return;
                                    setPercentDraft((p) => ({ ...p, [e.id]: v }));
                                  }}
                                  style={{ width: 90 }}
                                  placeholder="0"
                                />
                              ) : (
                                `${Number(e.percent).toFixed(0)}%`
                              )}
                            </td>

                            <td style={{ padding: 12 }}>{e.class?.name ?? `ID ${e.id_class}`}</td>
                            <td style={{ padding: 12 }}>{e.course?.name ?? `ID ${e.id_course}`}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {evalClassFilter !== "all" && (
                <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button
                    className="btn"
                    onClick={updatePercents}
                    disabled={savingPercents || !percentDirty}
                    style={{ width: 260 }}
                  >
                    {savingPercents ? "Actualizando..." : "Actualizar porcentajes"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ==================
              PANEL: CREAR
              ================== */}
          {view === "CREATE" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear evaluación</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={cCourse}
                    onChange={(e) => setCCourse(e.target.value)}
                    disabled={loadingCourses}
                  >
                    <option value="">{loadingCourses ? "Cargando cursos..." : "Selecciona un curso"}</option>
                    {courses.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {selectedCreateCourse?.id && (
                    <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13 }}>
                      Año detectado: <b>{levelLabel(selectedCreateCourse.level)}</b>
                    </div>
                  )}
                </div>

                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={createClassFilter}
                    onChange={(e) =>
                      setCreateClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                    disabled={!cCourse}
                  >
                    <option value="all">
                      {!cCourse ? "Selecciona un curso primero" : "Selecciona una materia"}
                    </option>
                    {createClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / span 2" }}>
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
                      <option key={t.id} value={String(t.id)}>
                        {t.type}
                      </option>
                    ))}
                    <option value="__other__">Otro...</option>
                  </select>

                  {cType === "__other__" && (
                    <div style={{ marginTop: 10 }}>
                      <div className="label">Escribe el tipo</div>
                      <input
                        className="input"
                        value={cTypeOther}
                        onChange={(e) => setCTypeOther(e.target.value)}
                        placeholder="Ej: Taller, Quiz, Exposición..."
                      />
                    </div>
                  )}
                </div>

                <div style={{ gridColumn: "1 / span 2" }}>
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
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value="__other__">Otro...</option>
                  </select>

                  {titlePick === "__other__" && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        className="input"
                        value={titleOther}
                        onChange={(e) => setTitleOther(e.target.value)}
                        placeholder="Escribe el título (ej: Evaluación final)"
                      />
                    </div>
                  )}
                </div>

                <div style={{ gridColumn: "1 / span 2", marginTop: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div className="label">Porcentaje</div>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>{cPercent}%</div>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={cPercent}
                    onChange={(e) => setCPercent(Number(e.target.value))}
                    style={{ width: "100%", marginTop: 8 }}
                  />
                </div>
              </div>

              <button
                className="btn"
                onClick={handleCreate}
                disabled={creating}
                style={{ marginTop: 12, width: "100%" }}
              >
                {creating ? "Creando..." : "Crear evaluación"}
              </button>
            </div>
          )}

          {/* ==================
              PANEL: UPSERT
              ================== */}
          {view === "UPSERT" && (
            <div className="card" style={{ marginTop: 18, width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Subir nota manual</h2>
                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                    Grilla de notas estilo hoja de cálculo.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={loadGradeGrid}
                  className="btnLight"
                  disabled={upsertClassFilter === "all" || gLoadingRoster}
                  style={{ width: 180, flexShrink: 0 }}
                >
                  {gLoadingRoster ? "Cargando..." : "Refrescar lista"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                <div>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    value={String(upsertLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUpsertLevelFilter(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="">Selecciona un Año</option>
                    {availableLevels.map((lvl) => (
                      <option key={lvl} value={String(lvl)}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={upsertClassFilter}
                    onChange={(e) =>
                      setUpsertClassFilter(
                        e.target.value === "all" ? "all" : Number(e.target.value)
                      )
                    }
                    disabled={upsertLevelFilter === ""}
                  >
                    <option value="all">
                      {upsertLevelFilter === "" ? "Selecciona un Año" : "Selecciona una materia"}
                    </option>
                    {upsertClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {upsertClassFilter === "all" ? (
                <div style={{ marginTop: 16, color: "var(--muted)" }}>
                  Selecciona una materia para cargar todas sus evaluaciones y notas.
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 12,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      Materia: {gridClassInfo?.name ?? selectedUpsertClass?.name ?? "—"}
                    </div>

                    {gEvaluations.length > 0 && (
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>
                        Haz clic en <b>Actualizar</b> para habilitar edición por fila.
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      borderRadius: GRILLA.radiusSecondary,
                      overflow: "hidden",
                      border: "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
                      background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                      boxShadow: "var(--shadow)",
                    }}
                  >
                    <div
                      style={{
                        overflowX: "auto",
                        overflowY: "auto",
                        maxHeight: "68vh",
                        background: "color-mix(in srgb, var(--card) 94%, rgb(2,6,23) 6%)",
                      }}
                    >
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
                          {gEvaluations.map((ev) => (
                            <col key={ev.id} style={{ width: `${EVAL_COL_W}px` }} />
                          ))}
                          <col style={{ width: `${ACTION_COL_W}px` }} />
                        </colgroup>

                        <thead>
                          <tr>
                            <th
                              style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderBottom: GRILLA.headerBottomBorder,
                                fontWeight: 800,
                                position: "sticky",
                                top: 0,
                                left: 0,
                                zIndex: 6,
                                whiteSpace: "nowrap",
                                boxShadow: "none",
                              }}
                            >
                              Cédula
                            </th>

                            <th
                              style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderBottom: GRILLA.headerBottomBorder,
                                fontWeight: 800,
                                position: "sticky",
                                top: 0,
                                left: STICKY_ALUMNO_LEFT,
                                zIndex: 6,
                                boxShadow: "none",
                              }}
                            >
                              Alumno
                            </th>

                            {gEvaluations.map((ev) => (
                              <th
                                key={ev.id}
                                style={{
                                  textAlign: "left",
                                  padding: "8px 10px",
                                  borderBottom: GRILLA.headerBottomBorder,
                                  fontWeight: 800,
                                  position: "sticky",
                                  top: 0,
                                  zIndex: 5,
                                  lineHeight: 1.2,
                                }}
                              >
                                {getEvaluationColumnLabel(ev)}
                              </th>
                            ))}

                            <th
                              style={{
                                textAlign: "center",
                                padding: "8px 10px",
                                borderBottom: GRILLA.headerBottomBorder,
                                fontWeight: 800,
                                position: "sticky",
                                top: 0,
                                zIndex: 5,
                              }}
                            >
                              Acción
                            </th>
                          </tr>
                        </thead>

                        <tbody>
                          {gLoadingRoster ? (
                            <tr>
                              <td
                                colSpan={Math.max(3, gEvaluations.length + 3)}
                                style={{
                                  padding: 16,
                                  color: "var(--muted)",
                                  background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                                }}
                              >
                                Cargando alumnos y notas...
                              </td>
                            </tr>
                          ) : gRoster.length === 0 ? (
                            <tr>
                              <td
                                colSpan={Math.max(3, gEvaluations.length + 3)}
                                style={{
                                  padding: 16,
                                  color: "var(--muted)",
                                  background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                                }}
                              >
                                No se encontraron alumnos para esta materia.
                              </td>
                            </tr>
                          ) : gEvaluations.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3}
                                style={{
                                  padding: 16,
                                  color: "var(--muted)",
                                  background: "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)",
                                }}
                              >
                                Esta materia aún no tiene evaluaciones creadas.
                              </td>
                            </tr>
                          ) : (
                            gRoster.map((st, rowIndex) => {
                              const isEditing = !!editingRow[st.id];
                              const isBusy = !!savingOne[st.id] || savingAll;

                              const baseRowBg = getGrillaBaseRowBg(rowIndex, isDarkTheme);
                              const activeRowBg = getGrillaActiveRowBg(isDarkTheme);
                              const editableCellBg = getGrillaEditableCellBg(isDarkTheme);
                              const disabledCellBg = getGrillaDisabledCellBg(isDarkTheme);
                              const cellTextColor = getGrillaTextColor(isDarkTheme);

                              return (
                                <tr
                                  key={st.id}
                                  className="table-row-hover"
                                  data-editing={isEditing ? "true" : "false"}
                                  style={{
                                    background: isEditing ? activeRowBg : baseRowBg,
                                  }}
                                >
                                  <td
                                    style={{
                                      padding: "2px 10px",
                                      borderBottom: GRILLA.rowBottomBorder,
                                      fontWeight: 700,
                                      background: isEditing ? activeRowBg : baseRowBg,
                                      position: "sticky",
                                      left: 0,
                                      zIndex: 4,
                                      whiteSpace: "nowrap",
                                      lineHeight: 1.15,
                                      boxShadow: "none",
                                      color: cellTextColor,
                                    }}
                                  >
                                    {st.cedula}
                                  </td>

                                  <td
                                    style={{
                                      padding: "2px 10px",
                                      borderBottom: GRILLA.rowBottomBorder,
                                      background: isEditing ? activeRowBg : baseRowBg,
                                      position: "sticky",
                                      left: STICKY_ALUMNO_LEFT,
                                      zIndex: 4,
                                      boxShadow: "none",
                                      color: cellTextColor,
                                    }}
                                  >
                                    <div style={{ fontWeight: 700, lineHeight: 1.15 }}>
                                      {st.name}
                                    </div>
                                  </td>

                                  {gEvaluations.map((ev) => {
                                    const key = gradeCellKey(st.id, ev.id);
                                    const enabledForCourse = isEvaluationApplicableToStudent(st, ev);
                                    const editable = enabledForCourse && isEditing && !isBusy;
                                    const gradeRecord = gGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
                                    const attempts = gradeRecord?.attempts ?? 0;
                                    const noPresentó = enabledForCourse && attempts === 0;

                                    return (
                                      <td
                                        key={ev.id}
                                        style={{
                                          padding: 0,
                                          borderBottom: GRILLA.rowBottomBorder,
                                          background: enabledForCourse
                                            ? isEditing
                                              ? editableCellBg
                                              : "transparent"
                                            : disabledCellBg,
                                          position: "relative",
                                        }}
                                      >
                                        {noPresentó && !isEditing ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "left",
                                              height: 26,
                                              padding: "0 6px",
                                            }}
                                          >
                                            <span
                                              style={{
                                                display: "inline-block",
                                                padding: "2px 10px",
                                                borderRadius: 4,
                                                fontSize: 11,
                                                fontWeight: 700,
                                                letterSpacing: 0.3,
                                                background: isDarkTheme
                                                  ? "rgba(239,68,68,0.15)"
                                                  : "rgba(239,68,68,0.1)",
                                                color: isDarkTheme ? "#fca5a5" : "#dc2626",
                                                border: isDarkTheme
                                                  ? "1px solid rgba(239,68,68,0.3)"
                                                  : "1px solid rgba(239,68,68,0.25)",
                                                whiteSpace: "nowrap",
                                              }}
                                            >
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
                                            if (v === "") {
                                              return setGradeDraft((p) => ({
                                                ...p,
                                                [key]: "",
                                              }));
                                            }
                                            if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) return;
                                            setGradeDraft((p) => ({ ...p, [key]: v }));
                                          }}
                                          placeholder={enabledForCourse ? "—" : "N/A"}
                                          onFocus={(e) => {
                                            if (editable) {
                                              e.currentTarget.style.background = getGrillaFocusCellBg(isDarkTheme);
                                              e.currentTarget.style.boxShadow =
                                                "inset 0 0 0 1.5px #3b82f6";
                                            }
                                          }}
                                          onBlur={(e) => {
                                            e.currentTarget.style.background = editable
                                              ? editableCellBg
                                              : "transparent";
                                            e.currentTarget.style.boxShadow = "none";
                                          }}
                                          style={{
                                            width: "100%",
                                            minWidth: 0,
                                            height: 26,
                                            border: "none",
                                            borderRadius: 0,
                                            outline: "none",
                                            background: editable ? editableCellBg : "transparent",
                                            boxShadow: "none",
                                            padding: "0 10px",
                                            fontSize: 13,
                                            lineHeight: 1,
                                            fontWeight: editable ? 700 : 500,
                                            color: enabledForCourse
                                              ? cellTextColor
                                              : isDarkTheme
                                                ? "var(--muted)"
                                                : "#94a3b8",
                                            cursor: editable ? "text" : "default",
                                            opacity: enabledForCourse ? 1 : 0.6,
                                          }}
                                        />
                                        )}
                                      </td>
                                    );
                                  })}

                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      borderBottom: GRILLA.rowBottomBorder,
                                      background: isEditing ? activeRowBg : baseRowBg,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        justifyContent: "center",
                                        alignItems: "center",
                                      }}
                                    >
                                      <button
                                        className="btn"
                                        onClick={() => handleRowAction(st)}
                                        disabled={isBusy}
                                        style={{
                                          minWidth: 104,
                                          padding: "5px 10px",
                                          background: isEditing
                                            ? "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)"
                                            : "linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)",
                                          border: isEditing
                                            ? "1px solid rgba(34,197,94,.8)"
                                            : "1px solid rgba(2,132,199,.8)",
                                          color: "#fff",
                                          boxShadow: isEditing
                                            ? "0 5px 14px rgba(34,197,94,.18)"
                                            : "0 5px 14px rgba(2,132,199,.16)",
                                          fontSize: 13,
                                        }}
                                      >
                                        {isBusy
                                          ? "Actualizando..."
                                          : isEditing
                                            ? "Guardar"
                                            : "Actualizar"}
                                      </button>

                                      {isEditing && (
                                        <button
                                          type="button"
                                          className="btnLight"
                                          onClick={() => cancelEdit(st)}
                                          disabled={isBusy}
                                          style={{
                                            minWidth: 90,
                                            padding: "5px 10px",
                                            background: isDarkTheme
                                              ? "color-mix(in srgb, var(--card) 96%, rgb(2,6,23) 4%)"
                                              : "#ffffff",
                                            border:
                                              "1px solid color-mix(in srgb, var(--stroke) 100%, transparent)",
                                            color: isDarkTheme ? "var(--text)" : "#334155",
                                            fontSize: 13,
                                          }}
                                        >
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
                    </div>
                  </div>

                  {gEvaluations.length > 0 && gRoster.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        marginTop: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>
                        Total estudiantes: <b>{gRoster.length}</b> · Total evaluaciones:{" "}
                        <b>{gEvaluations.length}</b>
                      </div>

                      <button
                        className="btn"
                        onClick={saveAll}
                        disabled={savingAll}
                        style={{
                          width: 220,
                          background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)",
                          color: "#fff",
                          border: "1px solid rgba(30,41,59,.85)",
                        }}
                      >
                        {savingAll ? "Guardando..." : "Guardar toda la grilla"}
                      </button>
                    </div>
                  )}
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