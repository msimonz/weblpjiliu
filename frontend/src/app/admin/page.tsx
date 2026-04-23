"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { primaryRole, roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import * as XLSX from "xlsx";
import ChangePasswordButton from "@/components/ChangePasswordButton";
import CrearExamen, { type CrearExamenCtx, type ExamInitialData } from "./CrearExamen";
import HabilitarExamenes from "./HabilitarExamenes";

type Course = { id: number; name: string; level: number; year: string | null; user_count?: number; id_monitor?: string | null; monitor_name?: string | null };

type GroupMini = {
  id: number;
  name: string;
  id_module?: number | null;
};

type ModuleItem = {
  id: number;
  name: string;
};

type ClassItem = {
  id: number;
  name: string;
  level: number;
  id_module: number | null;
  module_name: string | null;
  groups: GroupMini[];
};

type EvalType = { id: number; type: string; eval_count?: number };
type LevelItem = { id: number; name: string };
type AnioLectivoItem = { year: number; nombre: string; activo: boolean };

type UserMini = {
  id: string;
  name: string;
  email: string;
  cedula: string | null;
  id_course?: number | null;
};

type EvalItem = {
  id: number;
  title: string;
  percent: number;
  created_at: string;
  course?: { id: number; name: string; level: number; year: string };
  class?: { id: number; name: string; level: number; id_module?: number | null };
  evaluation_type?: { id: number; type: string };
  teacher?: { id: string; name: string } | null;
  module?: { id: number; name: string } | null;
  group?: { id: number; name: string } | null;
  id_course: number;
  id_class: number;
  id_type: number;
  id_module?: number | null;
  id_group?: number | null;
};

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

type AssignRow = { id_class: number; class_name: string; id_teacher: string | null; id_course: number; course_name: string; id_module: number | null; module_name: string | null };

type GradeGridResponse = {
  class: { id: number; name: string; level: number } | null;
  classes?: { id: number; name: string; level: number }[];
  evaluations: EvalItem[];
  students: StudentRow[];
  grades: GridGradeRow[];
};

const OTHER_OPTION = "__OTHER__";

type AdminView =
  | ""
  | "COURSES"
  | "CLASSES"
  | "TYPES"
  | "ASSIGN_TEACHER"
  | "USERS"
  | "UPSERT"
  | "EVAL_CRUD"
  | "HABILITAR_EXAMENES"
  | "ANIO_LECTIVO";

type EvalCrudMode = "class" | "module" | "group";

const ROLE_OPTIONS = [
  { value: "S", label: "Estudiante" },
  { value: "M", label: "Monitor" },
  { value: "T", label: "Profesor" },
  { value: "A", label: "Admin" },
  { value: "E", label: "Secretaría" },
] as const;

const _TEMPLATE_PUBLIC_URL =
  process.env.NEXT_PUBLIC_USERS_TEMPLATE_URL ||
  "https://xujejxbzeexqagotdvdi.supabase.co/storage/v1/object/public/assets/utilities/CargaEstudiantesJILIU.xlsx";

const _TEMPLATE_BUCKET = process.env.NEXT_PUBLIC_TEMPLATES_BUCKET || "";
const _TEMPLATE_PATH = process.env.NEXT_PUBLIC_USERS_TEMPLATE_PATH || "";

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

export default function AdminPage() {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string>("");

  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<AdminView>("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [types, setTypes] = useState<EvalType[]>([]);
  const [teachers, setTeachers] = useState<UserMini[]>([]);
  const [_students, setStudents] = useState<UserMini[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [groups, setGroups] = useState<GroupMini[]>([]);
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [anioLectivoItems, setAnioLectivoItems] = useState<AnioLectivoItem[]>([]);
  const [adminYear, setAdminYear] = useState<number | null>(null);
  const adminYearActivo = useMemo(() => anioLectivoItems.find(a => a.activo)?.year ?? null, [anioLectivoItems]);
  const isHistoricalYear = adminYear !== null && adminYear !== adminYearActivo;

  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseLevel, setNewCourseLevel] = useState<number>(1);
  const [newCourseYear, setNewCourseYear] = useState<string>("");

  // Monitor assignment
  const [monitorEditCourseId, setMonitorEditCourseId] = useState<number | null>(null);
  const [monitorStudents, setMonitorStudents] = useState<UserMini[]>([]);
  const [monitorSelectedId, setMonitorSelectedId] = useState<string>("");
  const [monitorLoading, setMonitorLoading] = useState(false);

  const [newClassName, setNewClassName] = useState("");
  const [newClassLevel, setNewClassLevel] = useState<number>(0);
  const [newClassModuleId, setNewClassModuleId] = useState<string>("");
  const [newClassGroupId, setNewClassGroupId] = useState<string>("");
  const [newModuleName, setNewModuleName] = useState("");
  const [_newGroupName, setNewGroupName] = useState("");
  const [tblFilterLevel, setTblFilterLevel] = useState<string>("");
  const [tblFilterModule, setTblFilterModule] = useState<string>("");
  const [tblFilterGroup, setTblFilterGroup] = useState<string>("");
  const [tblFilterName, setTblFilterName] = useState<string>("");

  const [newType, setNewType] = useState("");

  const [selAssignLevel, setSelAssignLevel] = useState<string>("");
  const [selTeacher, setSelTeacher] = useState<string>("");
  const [selClass, setSelClass] = useState<string>("");
  const [selAssignCourse, setSelAssignCourse] = useState<string>("");
  const [assignGrid, setAssignGrid] = useState<AssignRow[]>([]);
  const [assignMatFilter, setAssignMatFilter] = useState<string>("ALL");
  const [assignProfFilter, setAssignProfFilter] = useState<string>("ALL");
  const [assignModFilter, setAssignModFilter] = useState<string>("ALL");
  const [assignEdits, setAssignEdits] = useState<Record<string, string>>({}); // key: `${id_class}_${id_course}`
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [uploadReport, setUploadReport] = useState<any>(null);
  const [uploadFileName, setUploadFileName] = useState<string>("");
  const [templateLoading, setTemplateLoading] = useState(false);

  const [uEmail, setUEmail] = useState("");
  const [uName, setUName] = useState("");
  const [uCedula, setUCedula] = useState("");
  const [uCodeJiliu, setUCodeJiliu] = useState("");
  const [uCourseId, setUCourseId] = useState<string>("");
  const [uLevelId, setULevelId] = useState<string>("");
  const [uRoles, setURoles] = useState<Record<"S" | "T" | "A" | "M" | "E", boolean>>({
    S: false, T: false, A: false, M: false, E: false,
  });
  const [uSearching, setUSearching] = useState(false);
  const [uFoundUser, setUFoundUser] = useState(false);
  const [_uNotFound, setUNotFound] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);


  // ===== UPSERT / CAMBIO DE NOTAS =====
  const [upsertLevelFilter, setUpsertLevelFilter] = useState<number | "">("");
  const [upsertCourseFilter, setUpsertCourseFilter] = useState<number | "all">("all");
  const [upsertModuleFilter, setUpsertModuleFilter] = useState<number | "all">("all");
  const [upsertClassFilter, setUpsertClassFilter] = useState<number | "all">("all");

  const [gridClassInfo, setGridClassInfo] = useState<{
    id: number;
    name: string;
    level: number;
  } | null>(null);
  const [gEvaluations, setGEvaluations] = useState<EvalItem[]>([]);
  const [gRoster, setGRoster] = useState<StudentRow[]>([]);
  const [gGrades, setGGrades] = useState<GridGradeRow[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);

  const [grillaSortKey, setGrillaSortKey] = useState<"cedula" | "name">("name");
  const [grillaSortDir, setGrillaSortDir] = useState<"asc" | "desc">("asc");
  const [gFilterCedula, setGFilterCedula] = useState<string>("all");
  const [gFilterName, setGFilterName] = useState<string>("all");

  const sortedRoster = useMemo(() => {
    const copy = [...gRoster];
    copy.sort((a, b) => {
      const valA = grillaSortKey === "cedula" ? a.cedula : a.name;
      const valB = grillaSortKey === "cedula" ? b.cedula : b.name;
      const cmp = valA.localeCompare(valB, "es", { sensitivity: "base" });
      return grillaSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [gRoster, grillaSortKey, grillaSortDir]);

  const filteredRoster = useMemo(() => {
    return sortedRoster.filter((st) => {
      if (gFilterCedula !== "all" && st.cedula !== gFilterCedula) return false;
      if (gFilterName !== "all" && st.id !== gFilterName) return false;
      return true;
    });
  }, [sortedRoster, gFilterCedula, gFilterName]);

  function _toggleGrillaSort(key: "cedula" | "name") {
    if (grillaSortKey === key) {
      setGrillaSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setGrillaSortKey(key);
      setGrillaSortDir("asc");
    }
  }

  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  const [editingRow, setEditingRow] = useState<Record<string, boolean>>({});
  const [rowSnapshot, setRowSnapshot] = useState<Record<string, Record<string, string>>>({});

  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // ===== EVAL_CRUD =====
  const [ecMode, setEcMode] = useState<EvalCrudMode>("class");
  const [ecLevel, setEcLevel] = useState<number>(0);
  const [ecModuleId, setEcModuleId] = useState<string>("");
  const [ecGroupId, setEcGroupId] = useState<string>("");
  const [ecClassId, setEcClassId] = useState<string>("");
  const [ecCourseId, setEcCourseId] = useState<string>("");
  const [ecTeacherId, setEcTeacherId] = useState<string>("");
  const [ecTeachers, setEcTeachers] = useState<UserMini[]>([]);
  const [ecRowTeachers, setEcRowTeachers] = useState<UserMini[]>([]);
  const [ecType, setEcType] = useState<string>("");
  const [ecTypeOther, setEcTypeOther] = useState<string>("");
  const [ecTitle, setEcTitle] = useState<string>("");
  const [ecPercent, setEcPercent] = useState<number>(30);
  const [ecExisting, setEcExisting] = useState<EvalItem[]>([]);
  const [ecLoadingExisting, setEcLoadingExisting] = useState(false);
  const [ecEditPercents, setEcEditPercents] = useState<Record<number, string>>({});
  const [ecEditTeachers, setEcEditTeachers] = useState<Record<number, string>>({});
  const [ecSavingPercent, setEcSavingPercent] = useState<Record<number, boolean>>({});
  const [ecDeleting,        setEcDeleting]        = useState<Record<number, boolean>>({});
  const [ecConfirmDeleteId, setEcConfirmDeleteId] = useState<number | null>(null);
  const [ecCreating, setEcCreating] = useState(false);
  const [showCrearExamen, setShowCrearExamen]         = useState(false);
  const [crearExamenCtx, setCrearExamenCtx]           = useState<CrearExamenCtx | null>(null);
  const [crearExamenInitialData, setCrearExamenInitialData] = useState<ExamInitialData | null>(null);
  const [crearExamenExamId, setCrearExamenExamId]     = useState<number | null>(null);

  // ===== AÑO LECTIVO =====
  const [alNewYear, setAlNewYear]     = useState<string>("");
  const [alNewNombre, setAlNewNombre] = useState<string>("");
  const [alCreating, setAlCreating]   = useState(false);
  const [alActivating, setAlActivating] = useState<number | null>(null);
  const [alConfirmActivate, setAlConfirmActivate] = useState<number | null>(null);

  const CEDULA_COL_W = 150;
  const ALUMNO_COL_W = 260;
  const _EVAL_COL_W = 170;
  const ACTION_COL_W = 160;
  const STICKY_ALUMNO_LEFT = CEDULA_COL_W;

  function showOk(text: string) {
    setMsg(null);
    setOkMsg(text);
    setTimeout(() => setOkMsg(null), 1500);
  }

  function showErr(text: string) {
    setOkMsg(null);
    setMsg(text);
  }

  function flash(text: string, kind: "ok" | "err" = "ok") {
    setToast({ text, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }

  useEffect(() => {
    const { data } = supabase.storage.from("assets").getPublicUrl("brand/logo.png");
    setLogoUrl(data.publicUrl);
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingMe(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return router.replace("/login");

        const info = await apiFetch("/api/auth/me");
        setMe(info);

        const activeRole = getActiveRole(info);
        if (activeRole !== "A") return router.replace(roleToRoute(activeRole));
      } catch {
        router.replace("/login");
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [router]);

  async function loadAll(year?: number | null) {
    setMsg(null);
    setOkMsg(null);
    setLoadingData(true);
    const ySuffix = year ? `?year=${year}` : "";
    try {
      const [c1, c2, c3, t1, s1, m1, g1, l1] = await Promise.all([
        apiFetch(`/api/admin/courses${ySuffix}`),
        apiFetch(`/api/admin/classes${ySuffix}`),
        apiFetch(`/api/admin/evaluation-types${ySuffix}`),
        apiFetch("/api/admin/teachers"),
        apiFetch("/api/admin/students"),
        apiFetch(`/api/admin/modules${ySuffix}`),
        apiFetch(`/api/admin/groups${ySuffix}`),
        apiFetch(`/api/admin/levels${ySuffix}`),
      ]);

      setCourses(c1?.items || []);
      setClasses(c2?.items || []);
      setTypes(c3?.items || []);
      setTeachers(t1?.items || []);
      setStudents(s1?.items || []);
      setModules(m1?.items || []);
      setGroups(g1?.items || []);
      setLevels(l1?.items || []);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error cargando datos del admin");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (loadingMe) return;
    apiFetch("/api/admin/anio-lectivo")
      .then((res) => {
        const items: AnioLectivoItem[] = res?.items || [];
        setAnioLectivoItems(items);
        const activo = items.find(i => i.activo);
        if (activo) setAdminYear(activo.year);
        loadAll(activo?.year ?? null);
      })
      .catch(() => loadAll(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

  const coursesForLevel = useMemo(() => {
    if (!selAssignLevel) return [];
    return courses.filter((c) => Number(c.level) === Number(selAssignLevel));
  }, [courses, selAssignLevel]);

  const coursesForULevel = useMemo(() => {
    if (!uLevelId) return [];
    return courses.filter((c) => Number(c.level) === Number(uLevelId));
  }, [courses, uLevelId]);

  const assignVisibleRows = useMemo(() => {
    let rows = assignGrid;
    if (assignModFilter !== "ALL") rows = rows.filter((r) => String(r.id_module) === assignModFilter);
    if (assignMatFilter === "WITH") rows = rows.filter((r) => r.id_teacher != null);
    else if (assignMatFilter === "WITHOUT") rows = rows.filter((r) => r.id_teacher == null);
    else if (assignMatFilter !== "ALL") rows = rows.filter((r) => String(r.id_class) === assignMatFilter);
    if (assignProfFilter === "WITH") rows = rows.filter((r) => r.id_teacher != null);
    else if (assignProfFilter === "WITHOUT") rows = [];
    else if (assignProfFilter !== "ALL") rows = rows.filter((r) => r.id_teacher === assignProfFilter);
    return rows;
  }, [assignGrid, assignModFilter, assignMatFilter, assignProfFilter]);

  const assignMultiCourse = useMemo(
    () => new Set(assignGrid.map((r) => r.id_course)).size > 1,
    [assignGrid]
  );

  const assignOrphanTeachers = useMemo(() => {
    const assignedIds = new Set(assignGrid.map((r) => r.id_teacher).filter(Boolean));
    const orphans = teachers.filter((t) => !assignedIds.has(t.id));
    const showOrphans =
      (assignProfFilter === "ALL" || assignProfFilter === "WITHOUT") &&
      assignMatFilter === "ALL" &&
      assignModFilter === "ALL";
    return showOrphans ? orphans : [];
  }, [assignGrid, assignProfFilter, assignMatFilter, assignModFilter, teachers]);

  const availableModulesForCreate = useMemo(() => {
    return [...modules].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [modules]);

  const _classesByLevelAndModule = useMemo(() => {
    return classes.filter((c) => {
      if (Number(c.level) !== Number(newClassLevel)) return false;
      if (newClassModuleId && newClassModuleId !== OTHER_OPTION && Number(c.id_module) !== Number(newClassModuleId)) return false;
      return true;
    });
  }, [classes, newClassLevel, newClassModuleId]);

  const availableGroupsForCreate = useMemo(() => {
    if (!newClassModuleId || newClassModuleId === OTHER_OPTION) return [];
    const filtered = groups
      .filter((g) => Number(g.id_module) === Number(newClassModuleId))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (filtered.length === 0) {
      // Module has no groups — use the module itself as the only option (id=0 sentinel)
      const mod = modules.find((m) => String(m.id) === newClassModuleId);
      if (mod) return [{ id: 0, name: mod.name }];
    }
    return filtered;
  }, [groups, newClassModuleId, modules]);

  // ── Tabla filtros en cascada ──
  const tblLevelOptions = useMemo(() => {
    const ids = [...new Set(classes.map((c) => Number(c.level)))].sort((a, b) => a - b);
    return ids.map((id) => ({ id: String(id), name: levels.find((l) => l.id === id)?.name ?? String(id) }));
  }, [classes, levels]);

  const tblModuleOptions = useMemo(() => {
    const base = tblFilterLevel ? classes.filter((c) => String(c.level) === tblFilterLevel) : classes;
    const names = [...new Set(base.map((c) => c.module_name ?? "—"))].sort((a, b) => a.localeCompare(b, "es"));
    return names;
  }, [classes, tblFilterLevel]);

  const tblGroupOptions = useMemo(() => {
    const base = classes.filter((c) => {
      if (tblFilterLevel && String(c.level) !== tblFilterLevel) return false;
      if (tblFilterModule && (c.module_name ?? "—") !== tblFilterModule) return false;
      return true;
    });
    const moduleIds = new Set(base.map((c) => Number(c.id_module)).filter(Boolean));
    const names = groups
      .filter((g) => g.id_module != null && moduleIds.has(Number(g.id_module)))
      .map((g) => g.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, "es"));
  }, [classes, groups, tblFilterLevel, tblFilterModule]);

  const tblNameOptions = useMemo(() => {
    const base = classes.filter((c) => {
      if (tblFilterLevel && String(c.level) !== tblFilterLevel) return false;
      if (tblFilterModule && (c.module_name ?? "—") !== tblFilterModule) return false;
      if (tblFilterGroup) {
        const grpNames = c.groups?.length ? c.groups.map((g) => g.name) : ["—"];
        if (!grpNames.includes(tblFilterGroup)) return false;
      }
      return true;
    });
    return [...new Set(base.map((c) => c.name))].sort((a, b) => a.localeCompare(b, "es"));
  }, [classes, tblFilterLevel, tblFilterModule, tblFilterGroup]);

  const classesFiltered = useMemo(() => {
    return classes.filter((c) => {
      if (tblFilterLevel && String(c.level) !== tblFilterLevel) return false;
      if (tblFilterModule && (c.module_name ?? "—") !== tblFilterModule) return false;
      if (tblFilterGroup) {
        const grpNames = c.groups?.length ? c.groups.map((g) => g.name) : ["—"];
        if (!grpNames.includes(tblFilterGroup)) return false;
      }
      if (tblFilterName && c.name !== tblFilterName) return false;
      return true;
    });
  }, [classes, tblFilterLevel, tblFilterModule, tblFilterGroup, tblFilterName]);

  const availableCourseOptions = useMemo(() => {
    if (!newCourseLevel) return [];
    const taken = new Set(
      courses
        .filter((c) => Number(c.level) === newCourseLevel && String(c.year) === newCourseYear)
        .map((c) => String(c.name).trim())
    );
    return [1, 2, 3, 4]
      .map((n) => String(newCourseLevel * 100 + n))
      .filter((opt) => !taken.has(opt));
  }, [courses, newCourseLevel, newCourseYear]);

  const availableLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of classes) {
      if (Number.isFinite(Number(c.level))) set.add(Number(c.level));
    }
    return [...set].sort((a, b) => a - b);
  }, [classes]);

  const upsertCoursesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return courses;
    return courses.filter((c) => Number(c.level) === Number(upsertLevelFilter));
  }, [courses, upsertLevelFilter]);

  const upsertModulesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return modules;
    const ids = new Set(
      classes
        .filter((c) => Number(c.level) === Number(upsertLevelFilter))
        .map((c) => c.id_module)
        .filter((x): x is number => x !== null && x !== undefined && x > 0)
    );
    return modules.filter((m) => ids.has(m.id));
  }, [classes, modules, upsertLevelFilter]);

  const upsertClassesFiltered = useMemo(() => {
    if (upsertLevelFilter === "" || upsertLevelFilter === 0) return classes;
    let filtered = classes.filter((c) => Number(c.level) === Number(upsertLevelFilter));
    if (upsertModuleFilter !== "all") {
      filtered = filtered.filter((c) => Number(c.id_module) === Number(upsertModuleFilter));
    }
    return filtered;
  }, [classes, upsertLevelFilter, upsertModuleFilter]);

  const selectedUpsertClass = useMemo(() => {
    if (upsertClassFilter === "all") return null;
    return classes.find((c) => c.id === Number(upsertClassFilter)) || null;
  }, [upsertClassFilter, classes]);

  const upsertDynamicMinWidth = useMemo(() => {
    const cedulaW = 170;
    const alumnoW = 320;
    const evalW = 120;
    const perdidasW = 90;
    const actionW = 180;
    return cedulaW + alumnoW + perdidasW + actionW + gEvaluations.length * evalW;
  }, [gEvaluations.length]);

  // ===== EVAL_CRUD memos =====
  // ecLevel: 0 = sin selección, -1 = Todos, >0 = año específico
  // ecEffectiveLevel: nivel real a usar en filtros — si hay curso seleccionado usa su nivel
  const ecEffectiveLevel = useMemo(() => {
    if (!ecLevel) return 0;
    if (ecCourseId) {
      const found = courses.find((c) => String(c.id) === ecCourseId);
      if (found) return Number(found.level);
    }
    return ecLevel;
  }, [ecLevel, ecCourseId, courses]);

  const ecModules = useMemo(() => {
    if (!ecEffectiveLevel) return [];
    if (ecEffectiveLevel === -1) return [...modules].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    const ids = new Set(
      classes
        .filter((c) => Number(c.level) === ecEffectiveLevel)
        .map((c) => c.id_module)
        .filter((x): x is number => x !== null && Number.isFinite(x) && x > 0)
    );
    return modules.filter((m) => ids.has(m.id));
  }, [classes, modules, ecEffectiveLevel]);

  const ecGroups = useMemo(() => {
    if (!ecEffectiveLevel) return [];
    const sortFn = (a: GroupMini, b: GroupMini) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
    if (ecModuleId) {
      const direct = groups.filter((g) => Number(g.id_module) === Number(ecModuleId));
      if (direct.length > 0) return direct.sort(sortFn);
      const map = new Map<number, GroupMini>();
      classes
        .filter((c) => Number(c.id_module) === Number(ecModuleId))
        .forEach((c) => (c.groups || []).forEach((g) => { if (!map.has(g.id)) map.set(g.id, g); }));
      return Array.from(map.values()).sort(sortFn);
    }
    if (ecEffectiveLevel === -1) return [...groups].sort(sortFn);
    const moduleIds = new Set(
      classes
        .filter((c) => Number(c.level) === ecEffectiveLevel)
        .map((c) => c.id_module)
        .filter((x): x is number => x !== null && Number.isFinite(x) && x > 0)
    );
    return groups
      .filter((g) => g.id_module != null && moduleIds.has(g.id_module))
      .sort(sortFn);
  }, [groups, classes, ecModuleId, ecEffectiveLevel]);

  const ecClasses = useMemo(() => {
    if (!ecEffectiveLevel) return [];
    let filtered = classes;
    if (ecEffectiveLevel > 0) filtered = filtered.filter((c) => Number(c.level) === ecEffectiveLevel);
    if (ecModuleId) {
      const groupIdsOfModule = new Set(
        groups.filter((g) => Number(g.id_module) === Number(ecModuleId)).map((g) => g.id)
      );
      filtered = filtered.filter((c) =>
        Number(c.id_module) === Number(ecModuleId) ||
        (c.groups || []).some((g) => groupIdsOfModule.has(Number(g.id)))
      );
    }
    if (ecGroupId) filtered = filtered.filter((c) => (c.groups || []).some((g) => Number(g.id) === Number(ecGroupId)));
    return filtered;
  }, [classes, groups, ecEffectiveLevel, ecModuleId, ecGroupId]);

  const ecCourses = useMemo(() => {
    if (!ecLevel) return [];
    if (ecLevel === -1) return [...courses].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    return courses.filter((c) => Number(c.level) === ecLevel);
  }, [courses, ecLevel]);

  const ecExistingFiltered = useMemo(() => {
    let items = ecExisting;
    if (ecModuleId) {
      items = items.filter((ev) =>
        String(ev.id_module) === ecModuleId ||
        String(ev.class?.id_module) === ecModuleId
      );
    }
    if (ecGroupId) {
      items = items.filter((ev) => String(ev.id_group) === ecGroupId);
    }
    if (ecClassId) {
      items = items.filter((ev) => String(ev.id_class) === ecClassId);
    }
    return items;
  }, [ecExisting, ecModuleId, ecGroupId, ecClassId]);

  const ecLevelLabel = useMemo(() => {
    return levels.find((l) => l.id === ecLevel)?.name ?? `Nivel ${ecLevel}`;
  }, [ecLevel, levels]);

  const _ecScopeBreadcrumb = useMemo(() => {
    const parts: string[] = [ecLevelLabel];
    if (ecModuleId) {
      const m = modules.find((x) => x.id === Number(ecModuleId));
      if (m) parts.push(m.name);
    }
    if (ecGroupId) {
      const g = groups.find((x) => x.id === Number(ecGroupId));
      if (g) parts.push(`Grupo: ${g.name}`);
    }
    if (ecMode === "class" && ecClassId) {
      const c = classes.find((x) => x.id === Number(ecClassId));
      if (c) parts.push(c.name);
    }
    return parts.join(" › ");
  }, [ecLevelLabel, ecModuleId, ecGroupId, ecMode, ecClassId, modules, groups, classes]);

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

  useEffect(() => {
    setSelClass("");
  }, [selAssignLevel]);

  useEffect(() => {
    setNewClassModuleId("");
    setNewClassGroupId("");
    setNewModuleName("");
    setNewGroupName("");
  }, [newClassLevel]);

  useEffect(() => {
    setNewClassGroupId("");
    setNewGroupName("");
  }, [newClassModuleId]);

  // Tabla materias: reset en cascada
  useEffect(() => { setTblFilterModule(""); setTblFilterGroup(""); setTblFilterName(""); }, [tblFilterLevel]);
  useEffect(() => { setTblFilterGroup(""); setTblFilterName(""); }, [tblFilterModule]);
  useEffect(() => { setTblFilterName(""); }, [tblFilterGroup]);


  // EVAL_CRUD: limpiar filtros de nivel inferior al cambiar nivel
  useEffect(() => {
    setEcModuleId("");
    setEcGroupId("");
    setEcClassId("");
    setEcCourseId("");
  }, [ecLevel]);

  // Helper: construir params de profesores según cascada
  function buildTeacherParams(_opts: { withMode?: boolean } = {}) {
    const params = new URLSearchParams();
    if (ecClassId)       params.set("class_id",  ecClassId);
    else if (ecGroupId)  params.set("group_id",  ecGroupId);
    else if (ecModuleId) params.set("module_id", ecModuleId);
    else if (ecCourseId) params.set("course_id", ecCourseId);
    else if (ecEffectiveLevel > 0) params.set("level", String(ecEffectiveLevel));
    return params;
  }

  // EVAL_CRUD: profesores para filas de evaluaciones existentes
  useEffect(() => {
    if (view !== "EVAL_CRUD" || !ecEffectiveLevel) { setEcRowTeachers([]); return; }
    const params = buildTeacherParams();
    apiFetch(`/api/admin/teachers?${params.toString()}`)
      .then((res) => setEcRowTeachers(res?.items || []))
      .catch(() => setEcRowTeachers([]));
  }, [view, ecEffectiveLevel, ecCourseId, ecModuleId, ecGroupId, ecClassId]); // eslint-disable-line react-hooks/exhaustive-deps

  // EVAL_CRUD: profesores para formulario de creación (solo módulo/grupo)
  useEffect(() => {
    if (view !== "EVAL_CRUD") return;
    if (ecMode === "class") { setEcTeachers([]); setEcTeacherId(""); return; }
    setEcTeacherId("");
    const params = buildTeacherParams();
    apiFetch(`/api/admin/teachers?${params.toString()}`)
      .then((res) => setEcTeachers(res?.items || []))
      .catch(() => setEcTeachers([]));
  }, [view, ecMode, ecEffectiveLevel, ecCourseId, ecModuleId, ecGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEcGroupId("");
    setEcClassId("");
  }, [ecModuleId]);

  useEffect(() => {
    setEcClassId("");
  }, [ecGroupId]);

  // EVAL_CRUD: limpiar mensajes al cambiar cualquier filtro o modo
  useEffect(() => { setMsg(null); setOkMsg(null); },
    [ecLevel, ecCourseId, ecModuleId, ecGroupId, ecClassId, ecType, ecMode]);

  // EVAL_CRUD: reset completo al cambiar modo
  useEffect(() => {
    setEcModuleId("");
    setEcGroupId("");
    setEcClassId("");
    setEcCourseId("");
    setEcTeacherId("");
    setEcType("");
    setEcTypeOther("");
    setEcTitle("");
    setEcPercent(30);
    setEcExisting([]);
    setEcEditPercents({});
  }, [ecMode]);

  // EVAL_CRUD: cargar evaluaciones existentes dinámicamente por nivel + filtros opcionales
  useEffect(() => {
    if (view !== "EVAL_CRUD") return;

    if (ecLevel === 0) {
      setEcExisting([]);
      setEcEditPercents({});
      setEcEditTeachers({});
      return;
    }

    const params = new URLSearchParams();
    if (ecLevel > 0) params.set("level", String(ecLevel)); // -1 = Todos → no filtrar por nivel
    if (ecCourseId) params.set("course_id", ecCourseId);

    let cancelled = false;
    setEcLoadingExisting(true);

    apiFetch(`/api/admin/evaluations?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const evs: EvalItem[] = res?.items || [];
        setEcExisting(evs);
        const initP: Record<number, string> = {};
        const initT: Record<number, string> = {};
        evs.forEach((e) => {
          initP[e.id] = String(e.percent);
          initT[e.id] = e.teacher?.id ?? "";
        });
        setEcEditPercents(initP);
        setEcEditTeachers(initT);
      })
      .catch((e) => { if (!cancelled) { setEcExisting([]); setMsg((e as { message?: string })?.message || "Error cargando evaluaciones"); } })
      .finally(() => { if (!cancelled) setEcLoadingExisting(false); });

    return () => { cancelled = true; };
  }, [view, ecLevel, ecCourseId]);

  useEffect(() => {
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});
    setGFilterCedula("all");
    setGFilterName("all");

    if (upsertLevelFilter === "") return;

    loadGradeGridWith(upsertLevelFilter, upsertCourseFilter, upsertModuleFilter, upsertClassFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsertLevelFilter, upsertCourseFilter, upsertModuleFilter, upsertClassFilter]);

  async function createCourse() {
    if (!newCourseLevel) return showErr("Selecciona un nivel.");
    const name = newCourseName.trim();
    if (!name) return showErr("Selecciona un curso.");

    try {
      await apiFetch("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          name,
          level: newCourseLevel,
          year: newCourseYear || null,
        }),
      });
      setNewCourseName("");
      showOk("✅ Curso creado");
      await loadAll(adminYear);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error creando curso");
    }
  }

  async function deleteCourse(id: number) {
    try {
      await apiFetch(`/api/admin/courses/${id}`, { method: "DELETE" });
      flash("✅ Curso eliminado", "ok");
      await loadAll(adminYear);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error eliminando curso", "err");
    }
  }

  async function openMonitorEdit(courseId: number) {
    setMonitorEditCourseId(courseId);
    setMonitorSelectedId("");
    setMonitorStudents([]);
    setMonitorLoading(true);
    try {
      const res = await apiFetch(`/api/admin/courses/${courseId}/students`);
      setMonitorStudents(res?.items || []);
      const current = courses.find((c) => c.id === courseId);
      setMonitorSelectedId(current?.id_monitor ?? "");
    } catch (e) {
      flash((e as { message?: string })?.message || "Error cargando estudiantes", "err");
      setMonitorEditCourseId(null);
    } finally {
      setMonitorLoading(false);
    }
  }

  async function saveMonitor(courseId: number) {
    try {
      await apiFetch(`/api/admin/courses/${courseId}/monitor`, {
        method: "PUT",
        body: JSON.stringify({ id_monitor: monitorSelectedId || null }),
      });
      flash("✅ Monitor actualizado", "ok");
      setMonitorEditCourseId(null);
      await loadAll(adminYear);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error asignando monitor", "err");
    }
  }

  async function createClass() {
    if (!newClassLevel) return flash("Selecciona un Nivel.", "err");

    const isOtherModule = newClassModuleId === OTHER_OPTION;
    if (!newClassModuleId) return flash("Selecciona un Módulo.", "err");
    if (isOtherModule && !newModuleName.trim()) return flash("Escribe el nombre del nuevo módulo.", "err");
    if (!newClassGroupId) return flash("Selecciona un Grupo.", "err");

    const name = newClassName.trim();
    if (!name) return flash("Escribe el nombre de la materia.", "err");

    const isModuleAsGroup = newClassGroupId === "0"; // sentinel: module has no groups
    const id_module = !isOtherModule ? Number(newClassModuleId || "0") : 0;
    const id_group = !isModuleAsGroup ? Number(newClassGroupId || "0") : 0;
    const new_module_name = isOtherModule ? newModuleName.trim() : "";
    const new_group_name = "";

    try {
      await apiFetch("/api/admin/classes", {
        method: "POST",
        body: JSON.stringify({
          name,
          level: newClassLevel,
          id_module: id_module || null,
          id_group: id_group || null,
          new_module_name,
          new_group_name,
        }),
      });

      setNewClassName("");
      setNewClassModuleId("");
      setNewClassGroupId("");
      setNewModuleName("");
      setNewGroupName("");

      flash("✅ Materia creada", "ok");
      await loadAll(adminYear);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error creando materia", "err");
    }
  }

  async function createEvalType() {
    const t = newType.trim();
    if (!t) return showErr("Tipo requerido.");

    try {
      await apiFetch("/api/admin/evaluation-types", {
        method: "POST",
        body: JSON.stringify({ type: t }),
      });
      setNewType("");
      showOk("✅ Tipo creado");
      await loadAll(adminYear);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error creando tipo");
    }
  }

  async function deleteEvalType(id: number) {
    try {
      await apiFetch(`/api/admin/evaluation-types/${id}`, { method: "DELETE" });
      flash("✅ Tipo eliminado", "ok");
      await loadAll(adminYear);
    } catch (e) {
      flash((e as { message?: string })?.message || "Error eliminando tipo", "err");
    }
  }

  async function _assignTeacher() {
    const id_teacher = selTeacher;
    const id_class = Number(selClass);

    if (!selAssignLevel) return showErr("Selecciona un level.");
    if (!id_teacher) return showErr("Selecciona un teacher.");
    if (!id_class) return showErr("Selecciona una materia.");

    try {
      await apiFetch("/api/admin/assign-teacher", {
        method: "POST",
        body: JSON.stringify({ id_teacher, id_class }),
      });
      showOk("✅ Materia Asignada al Profesor");
      setSelTeacher("");
      setSelClass("");
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error asignando teacher");
    }
  }

  async function loadAssignmentGrid(courseVal: string, levelVal: string) {
    const params = new URLSearchParams();
    if (courseVal !== "ALL") params.set("id_course", courseVal);
    else if (levelVal !== "ALL") params.set("id_level", levelVal);
    setAssignLoading(true);
    try {
      const data = await apiFetch(`/api/admin/assignment-grid?${params}`);
      setAssignGrid(data.rows || []);
      setAssignEdits({});
      setAssignMatFilter("ALL");
      setAssignProfFilter("ALL");
      setAssignModFilter("ALL");
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error cargando asignaciones");
    } finally {
      setAssignLoading(false);
    }
  }

  async function saveAssignmentGrid() {
    if (assignGrid.length === 0) return showErr("Carga el grid primero.");
    if (Object.keys(assignEdits).length === 0) return showOk("Sin cambios para guardar.");

    // Solo las filas que el usuario realmente editó
    const rows = Object.entries(assignEdits).map(([key, id_teacher]) => {
      const [id_class_s, id_course_s] = key.split("_");
      return {
        id_class:   Number(id_class_s),
        id_course:  Number(id_course_s),
        id_teacher: id_teacher || null,
      };
    });
    setAssignSaving(true);
    try {
      await apiFetch("/api/admin/save-assignment-grid", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      showOk("✅ Asignaciones guardadas");
      await loadAssignmentGrid(selAssignCourse, selAssignLevel);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error guardando asignaciones");
    } finally {
      setAssignSaving(false);
    }
  }

  function resetAssignView() {
    setSelAssignLevel("");
    setSelAssignCourse("ALL");
    setAssignGrid([]);
    setAssignEdits({});
    setAssignMatFilter("ALL");
    setAssignProfFilter("ALL");
    setAssignModFilter("ALL");
  }

  async function ecHandleSavePercent(evalId: number) {
    const val = Number(ecEditPercents[evalId]);
    if (!Number.isFinite(val) || val <= 0 || val > 100) {
      flash("Porcentaje inválido (1..100)", "err");
      return;
    }
    const newTeacherId = ecEditTeachers[evalId] ?? "";
    setEcSavingPercent((p) => ({ ...p, [evalId]: true }));
    try {
      const body: Record<string, unknown> = { percent: val };
      if (newTeacherId) body.id_teacher = newTeacherId;
      await apiFetch(`/api/admin/evaluations/${evalId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEcExisting((prev) =>
        prev.map((e) => {
          if (e.id !== evalId) return e;
          const updatedTeacher = newTeacherId
            ? (ecTeachers.find((t) => t.id === newTeacherId) ?? e.teacher)
            : e.teacher;
          return { ...e, percent: val, teacher: updatedTeacher ? { id: updatedTeacher.id, name: updatedTeacher.name } : e.teacher };
        })
      );
      showOk("✅ Evaluación actualizada");
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error al actualizar");
    } finally {
      setEcSavingPercent((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function ecHandleDelete(evalId: number) {
    setEcConfirmDeleteId(null);
    setEcDeleting((p) => ({ ...p, [evalId]: true }));
    try {
      await apiFetch(`/api/admin/evaluations/${evalId}`, { method: "DELETE" });
      setEcExisting((prev) => prev.filter((e) => e.id !== evalId));
      setEcEditPercents((p) => { const n = { ...p }; delete n[evalId]; return n; });
      showOk("✅ Evaluación eliminada");
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error al eliminar");
    } finally {
      setEcDeleting((p) => ({ ...p, [evalId]: false }));
    }
  }

  async function ecHandleEditExam(ev: EvalItem) {
    try {
      const data = await apiFetch(`/api/admin/exams/${ev.id}`);
      const course = courses.find(c => c.id === ev.id_course);
      const cls    = classes.find(c => c.id === ev.id_class);
      const mod    = cls?.id_module ? modules.find(m => m.id === cls.id_module) : null;
      const lev    = levels.find(l => l.id === ecLevel);
      setCrearExamenCtx({
        id_course:  ev.id_course,
        id_class:   ev.id_class,
        id_module:  ev.id_module ?? null,
        id_group:   ev.id_group  ?? null,
        title:      ev.title,
        percent:    Number(ev.percent),
        courseName: course ? String(course.name) : String(ev.id_course),
        className:  cls?.name ?? ev.class?.name ?? String(ev.id_class),
        moduleName: mod?.name ?? ev.module?.name ?? null,
        levelName:  lev?.name ?? null,
      });
      setCrearExamenInitialData(data.item);
      setCrearExamenExamId(ev.id);
      setShowCrearExamen(true);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error cargando examen");
    }
  }

  async function ecHandleCreate() {
    setMsg(null);
    setOkMsg(null);

    const id_course = Number(ecCourseId);
    if (!id_course) return showErr("Selecciona un curso.");

    const id_teacher = ecTeacherId;
    if (ecMode !== "class" && !id_teacher) return showErr("Selecciona un profesor.");

    const id_type = Number(ecType);
    const isOtherType = ecType === "__other__";
    const type_text = isOtherType ? ecTypeOther.trim() : "";

    if (!id_type && !isOtherType) return showErr("Selecciona un tipo de evaluación.");
    if (isOtherType && !type_text) return showErr("Escribe el tipo (Otro).");

    const title = ecTitle.trim();
    if (!title) return showErr("Escribe un título para la evaluación.");

    const percent = Number(ecPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return showErr("Porcentaje inválido (1..100).");
    }

    const relevantExisting = ecExisting.filter((ev) => {
      if (Number(ev.id_course) !== id_course) return false;
      if (ecMode === "class")  return Number(ev.id_class)  === Number(ecClassId);
      if (ecMode === "module") return String(ev.id_module) === ecModuleId;
      if (ecMode === "group")  return String(ev.id_group)  === ecGroupId;
      return false;
    });
    const totalExisting = relevantExisting.reduce((s, e) => s + Number(e.percent), 0);
    if (totalExisting + percent > 100) {
      return showErr(
        `El porcentaje total superaría 100% (existente: ${totalExisting}%, nuevo: ${percent}%). Ajusta los porcentajes existentes antes de continuar.`
      );
    }

    // ── Examen: abrir interfaz CrearExamen en lugar del flujo normal ──
    const selectedTypeName = (!isOtherType
      ? types.find(t => t.id === id_type)?.type
      : type_text) || "";
    if (selectedTypeName === "Examen") {
      if (ecMode !== "class") return showErr("Los exámenes se crean por Materia. Selecciona el modo 'Materia'.");
      const id_class = Number(ecClassId);
      if (!id_class) return showErr("Selecciona una materia.");
      const course = courses.find(c => c.id === id_course);
      const cls    = classes.find(c => c.id === id_class);
      const mod    = cls?.id_module ? modules.find(m => m.id === cls.id_module) : null;
      const lev    = levels.find(l => l.id === ecLevel);
      setCrearExamenCtx({
        id_course,
        id_class,
        id_module:  cls?.id_module  ?? null,
        id_group:   null,
        title,
        percent,
        courseName: course ? String(course.name) : String(id_course),
        className:  cls?.name ?? String(id_class),
        moduleName: mod?.name ?? cls?.module_name ?? null,
        levelName:  lev?.name ?? null,
      });
      setShowCrearExamen(true);
      return;
    }

    setEcCreating(true);
    try {
      if (ecMode === "class") {
        const id_class = Number(ecClassId);
        if (!id_class) { setEcCreating(false); return showErr("Selecciona una materia."); }

        await apiFetch("/api/admin/evaluations", {
          method: "POST",
          body: JSON.stringify({ id_course, id_class, id_teacher, percent, title,
            id_type: id_type || undefined, type_text: isOtherType ? type_text : undefined }),
        });
      } else {
        const scope = ecMode;
        const id_module = Number(ecModuleId) || undefined;
        const id_group = ecMode === "group" ? Number(ecGroupId) : undefined;

        if (scope === "module" && !id_module) {
          setEcCreating(false); return showErr("Selecciona un módulo.");
        }
        if (scope === "group" && !id_group) {
          setEcCreating(false); return showErr("Selecciona un grupo.");
        }

        await apiFetch("/api/admin/evaluations/bulk", {
          method: "POST",
          body: JSON.stringify({ scope, id_module, id_group, id_course, id_teacher, percent, title,
            id_type: id_type || undefined, type_text: isOtherType ? type_text : undefined }),
        });
      }

      setEcType("");
      setEcTypeOther("");
      setEcTitle("");
      setEcPercent(30);
      setTimeout(() => showOk("✅ Evaluación(es) creada(s)"), 100);

      // recargar listado completo (mismos params que la carga principal)
      const reloadParams = new URLSearchParams();
      if (ecLevel > 0) reloadParams.set("level", String(ecLevel));
      if (ecCourseId) reloadParams.set("course_id", ecCourseId);
      const res = await apiFetch(`/api/admin/evaluations?${reloadParams.toString()}`);
      const evs: EvalItem[] = res?.items || [];
      setEcExisting(evs);
      const initP: Record<number, string> = {};
      const initT: Record<number, string> = {};
      evs.forEach((e) => { initP[e.id] = String(e.percent); initT[e.id] = e.teacher?.id ?? ""; });
      setEcEditPercents(initP);
      setEcEditTeachers(initT);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error creando evaluación");
    } finally {
      setEcCreating(false);
    }
  }

  function ecHandleCancel() {
    setMsg(null);
    setOkMsg(null);
    setEcMode("class");
    setEcLevel(1);
    setEcModuleId("");
    setEcGroupId("");
    setEcClassId("");
    setEcCourseId("");
    setEcTeacherId("");
    setEcType("");
    setEcTypeOther("");
    setEcTitle("");
    setEcPercent(30);
    setEcExisting([]);
    setEcEditPercents({});
  }

  function rolesFromState(state: Record<string, boolean>) {
    return Object.entries(state).filter(([, v]) => v).map(([k]) => k);
  }

  function resetManualUserForm() {
    setUEmail("");
    setUName("");
    setUCedula("");
    setUCodeJiliu("");
    setUCourseId("");
    setULevelId("");
    setURoles({ S: false, T: false, A: false, M: false, E: false });
    setUFoundUser(false);
    setUNotFound(false);
    setUSearching(false);
  }

  async function deleteUser() {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar a "${uName}" (cédula ${uCedula})? Esta acción no se puede deshacer.`)) return;
    try {
      await apiFetch(`/api/admin/delete-user?cedula=${encodeURIComponent(uCedula)}`, { method: "DELETE" });
      showOk("✅ Persona eliminada");
      resetManualUserForm();
      await loadAll(adminYear);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error eliminando persona");
    }
  }

  async function searchUserByCedula() {
    const cedula = uCedula.trim();
    if (!cedula) return showErr("Ingresa una cédula para buscar.");
    setUSearching(true);
    setUFoundUser(false);
    setUNotFound(false);
    try {
      const data = await apiFetch(`/api/admin/user-by-cedula?cedula=${encodeURIComponent(cedula)}`);
      const u = data.user;
      setUName(u.name || "");
      setUEmail(u.email || "");
      setUCodeJiliu(u.code_jiliu || "");
      if (u.id_course) {
        const course = courses.find((c) => c.id === u.id_course);
        if (course) {
          setULevelId(String(course.level));
          setUCourseId(String(u.id_course));
        }
      } else {
        setULevelId("");
        setUCourseId("");
      }
      const roleMap: Record<string, boolean> = { S: false, T: false, A: false, M: false, E: false };
      (u.roles || []).forEach((r: string) => { if (r in roleMap) roleMap[r] = true; });
      setURoles(roleMap as Record<"S" | "T" | "A" | "M" | "E", boolean>);
      setUFoundUser(true);
    } catch (e) {
      if ((e as { message?: string })?.message?.includes("404") || (e as { message?: string })?.message?.includes("No encontrado")) {
        setUFoundUser(false);
        setUNotFound(true);
        setUName(""); setUEmail(""); setUCodeJiliu(""); setUCourseId(""); setULevelId("");
        setURoles({ S: false, T: false, A: false, M: false, E: false });
        showErr("Persona no encontrada");
      } else {
        showErr((e as { message?: string })?.message || "Error buscando persona");
      }
    } finally {
      setUSearching(false);
    }
  }

  async function createUserManual() {
    setUploadReport(null);
    const email     = uEmail.trim().toLowerCase();
    const name      = uName.trim();
    const cedula    = uCedula.trim();
    const roles     = rolesFromState(uRoles);
    const needsStudentFields = uRoles.S || uRoles.M;

    if (!name)                                        return showErr("Nombre requerido.");
    if (!cedula)                                      return showErr("Cédula requerida.");
    if (!email || !email.includes("@"))               return showErr("Email inválido.");
    if (roles.length === 0)                           return showErr("Selecciona al menos 1 rol.");
    if (needsStudentFields && !uCodeJiliu.trim())     return showErr("Código Jiliu requerido para Estudiante/Monitor.");
    if (needsStudentFields && !uCourseId)             return showErr("Curso requerido para Estudiante/Monitor.");

    const payload: Record<string, unknown> = { email, name, cedula, roles };
    if (needsStudentFields) {
      payload.code_jiliu = uCodeJiliu.trim();
      payload.id_course  = Number(uCourseId);
    }

    setCreatingUser(true);
    try {
      const endpoint = uFoundUser
        ? "/api/admin/update-user-by-cedula"
        : "/api/admin/create-user";
      await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showOk(uFoundUser ? "✅ Persona actualizada" : "✅ Persona creada");
      resetManualUserForm();
      await loadAll(adminYear);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error guardando persona");
    } finally {
      setCreatingUser(false);
    }
  }

  async function downloadTemplate() {
    setTemplateLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL || ""}/api/admin/download-template`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!resp.ok) throw new Error("Error generando plantilla");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantilla_personas.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error descargando plantilla");
    } finally {
      setTemplateLoading(false);
    }
  }

  async function uploadExcelUsers() {
    setUploadReport(null);

    const input = fileRef.current;
    if (!input?.files?.[0]) return showErr("Selecciona un archivo .xlsx");

    const file = input.files[0];
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL || ""}/api/admin/upload-users`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        }
      );

      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Error subiendo excel");

      setUploadReport(json?.results || null);
      showOk("✅ Excel procesado");
      if (fileRef.current) fileRef.current.value = "";
      await loadAll(adminYear);
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error procesando excel");
    } finally {
      setUploading(false);
    }
  }

  async function loadGradeGridWith(
    level: number | "",
    courseFilter: number | "all",
    moduleFilter: number | "all",
    classFilter: number | "all"
  ) {
    setMsg(null);
    setGLoadingRoster(true);
    try {
      const params = new URLSearchParams();
      if (level !== "" && Number(level) > 0) params.set("level", String(level));
      if (courseFilter !== "all") params.set("course_id", String(courseFilter));
      if (moduleFilter !== "all") params.set("module_id", String(moduleFilter));
      if (classFilter !== "all") params.set("class_id", String(classFilter));

      const res: GradeGridResponse = await apiFetch(`/api/admin/grade-grid?${params.toString()}`);

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
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error cargando notas");
    } finally {
      setGLoadingRoster(false);
    }
  }

  async function _loadGradeGrid() {
    setMsg(null);
    setGLoadingRoster(true);
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});

    try {
      if (upsertClassFilter === "all") return;

      const courseParam = upsertCourseFilter !== "all" ? `&course_id=${Number(upsertCourseFilter)}` : "";
      const res: GradeGridResponse = await apiFetch(
        `/api/admin/class-grade-grid?class_id=${Number(upsertClassFilter)}${courseParam}`
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
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error cargando alumnos/notas");
      setGridClassInfo(null);
      setGEvaluations([]);
      setGRoster([]);
      setGGrades([]);
      setGradeDraft({});
    } finally {
      setGLoadingRoster(false);
    }
  }

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
      showErr(`No hay evaluaciones aplicables para ${student.name}`);
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
      showErr(`No hay evaluaciones aplicables para ${student.name}`);
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
          return apiFetch("/api/admin/grades", {
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

      // Actualizar gGrades localmente para reflejar las notas guardadas
      setGGrades((prev) => {
        const updated = [...prev];
        for (const ev of applicableEvals) {
          const key = gradeCellKey(student.id, ev.id);
          const newGrade = Number(gradeDraft[key]);
          const idx = updated.findIndex((g) => g.id_student === student.id && g.id_exam === ev.id);
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], grade: newGrade, attempts: (updated[idx].attempts ?? 0) + 1 };
          } else {
            updated.push({ id_student: student.id, id_exam: ev.id, grade: newGrade, attempts: 1 });
          }
        }
        return updated;
      });

      showOk(`✅ Notas guardadas: ${student.name}`);
    } catch (e) {
      showErr((e as { message?: string })?.message || `Error guardando notas de ${student.name}`);
    } finally {
      setSavingOne((prev) => ({ ...prev, [student.id]: false }));
    }
  }

  function downloadExcel() {
    const _materia = gridClassInfo?.name ?? selectedUpsertClass?.name ?? "Grilla";
    const rows = sortedRoster.map((st) => {
      const row: Record<string, string | number> = {
        Cédula: st.cedula,
        Alumno: st.name,
      };
      for (const ev of gEvaluations) {
        const label = getEvaluationColumnLabel(ev);
        if (!isEvaluationApplicableToStudent(st, ev)) {
          row[label] = "-";
          continue;
        }
        const gradeRecord = gGrades.find(
          (g) => g.id_student === st.id && g.id_exam === ev.id
        );
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

  async function _saveAll() {
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
          apiFetch("/api/admin/grades", {
            method: "POST",
            body: JSON.stringify(p),
          })
        )
      );

      showOk("✅ Notas actualizadas para toda la materia");
    } catch (e) {
      showErr((e as { message?: string })?.message || "Error actualizando todas las notas");
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
        <div style={{ fontWeight: 900, fontSize: 18 }}>Perfil del administrador</div>
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
                  <img
                    src={logoUrl}
                    alt="logo"
                    style={{ width: 34, height: 34, objectFit: "contain", borderRadius: 999 }}
                  />
                )}
                <div>
                  <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
                  <div style={{ color: "var(--muted)" }}>Panel Admin</div>
                </div>
              </div>
            </div>

            {/* <div className="topbarUserText">Estudiante · {me?.user?.email}</div> */}
                <div className="topbarUserText">
                     Admin ·{" "}
                     {me?.profile?.name ??
                     me?.profile?.full_name ??
                     me?.user?.user_metadata?.full_name ??
                     me?.user?.email ??
                     "—"}
                </div>
          </div>          

          <div
            className="card"
            style={{
              marginTop: 14,
              padding: 14,
              gridColumn: "1 / span 2",
              display: "flex",
              gap: 12,
              alignItems: "flex-end",
            }}
          >
            <div style={{ flex: 4 }}>
              <div className="label">¿Qué quieres hacer?</div>
              <select
                className="select"
                style={{ width: "100%" }}
                value={view}
                onChange={(e) => { setView(e.target.value as AdminView); loadAll(adminYear); }}
              >
                <option value="" disabled>¿Qué quieres hacer?...</option>
                <option value="COURSES">Crear/Editar Curso</option>
                <option value="CLASSES">Crear una Materia</option>
                <option value="TYPES">Crear un tipo de Evaluación</option>
                <option value="ASSIGN_TEACHER">Asignar Materias a un Profesor</option>
                <option value="USERS">Crear/Actualizar Persona</option>
                <option value="UPSERT">Gestionar Notas</option>
                <option value="EVAL_CRUD">Gestionar Evaluaciones</option>
                <option value="HABILITAR_EXAMENES">Habilitar Exámenes</option>
                <option value="ANIO_LECTIVO">Gestionar Año Lectivo</option>
              </select>
            </div>
            {anioLectivoItems.length > 0 && (
              <div style={{ flex: 1 }}>
                <div className="label">Año lectivo</div>
                <select
                  className="select"
                  style={{ width: "100%" }}
                  value={adminYear ?? ""}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setAdminYear(y);
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

          {isHistoricalYear && (
            <div style={{ marginTop: 10, padding: "8px 14px", background: "color-mix(in srgb, orange 15%, var(--card) 85%)", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              Modo lectura — año {adminYear}. Las modificaciones solo están permitidas en el año lectivo vigente ({adminYearActivo}).
            </div>
          )}

          {view !== "EVAL_CRUD" && view !== "HABILITAR_EXAMENES" && view !== "UPSERT" && msg   && <div className="msgError" style={{ marginTop: 12 }}>{msg}</div>}
          {view !== "EVAL_CRUD" && view !== "HABILITAR_EXAMENES" && view !== "UPSERT" && okMsg && <div className="msgOk"    style={{ marginTop: 12 }}>{okMsg}</div>}

          {view === "COURSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear/Editar Curso</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto auto", gap: 12, alignItems: "flex-end" }}>
                <div>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={newCourseLevel}
                    onChange={(e) => {
                      setNewCourseLevel(Number(e.target.value));
                      setNewCourseYear("");
                      setNewCourseName("");
                    }}
                  >
                    <option value={0} disabled>Selecciona...</option>
                    {levels.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    value={newCourseYear}
                    onChange={(e) => {
                      setNewCourseYear(e.target.value);
                      setNewCourseName("");
                    }}
                    disabled={!newCourseLevel}
                  >
                    <option value="">Selecciona...</option>
                    {[0, 1, 2].map((offset) => {
                      const y = new Date().getFullYear() + offset;
                      return <option key={y} value={String(y)}>{y}</option>;
                    })}
                  </select>
                </div>

                <div>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                    disabled={!newCourseYear}
                  >
                    <option value="">Selecciona...</option>
                    {availableCourseOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn"
                  onClick={createCourse}
                  disabled={isHistoricalYear}
                  title={isHistoricalYear ? `Solo se puede modificar el año vigente (${adminYearActivo})` : undefined}
                  style={{ padding: "10px 16px", whiteSpace: "nowrap" }}
                >
                  Crear
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "10px 16px", whiteSpace: "nowrap", background: "#4b5563", borderColor: "#4b5563" }}
                  onClick={() => { setNewCourseLevel(0); setNewCourseYear(""); setNewCourseName(""); }}
                >
                  Cancelar
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    overflow: "hidden",
                    borderRadius: 18,
                    border: "1px solid var(--stroke)",
                    width: "100%",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(14,165,233,.08)" }}>
                        <th style={{ textAlign: "center", padding: 12 }}>Nivel</th>
                        <th style={{ textAlign: "center", padding: 12 }}>Año</th>
                        <th style={{ textAlign: "center", padding: 12 }}>Curso</th>
                        <th style={{ textAlign: "left",   padding: 12 }}>Monitor</th>
                        <th style={{ textAlign: "center", padding: 12 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!newCourseYear ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, color: "var(--muted)", textAlign: "center" }}>
                            Selecciona un año para ver los cursos existentes
                          </td>
                        </tr>
                      ) : courses.filter((c) => String(c.year) === newCourseYear).length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, color: "var(--muted)", textAlign: "center" }}>
                            No hay cursos para el año {newCourseYear}
                          </td>
                        </tr>
                      ) : (
                        courses
                          .filter((c) => String(c.year) === newCourseYear)
                          .map((c, idx) => {
                            const hasUsers      = (c.user_count ?? 0) > 0;
                            const isEditingMon  = monitorEditCourseId === c.id;
                            return (
                              <tr key={c.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)", background: getGrillaBaseRowBg(idx, isDarkThemeEnabled()) }}>
                                <td style={{ padding: 12, textAlign: "center" }}>{levels.find((l) => l.id === Number(c.level))?.name ?? c.level}</td>
                                <td style={{ padding: 12, textAlign: "center" }}>{c.year ?? "—"}</td>
                                <td style={{ padding: 12, textAlign: "center", fontWeight: 500 }}>{c.name}</td>

                                {/* Columna Monitor */}
                                <td style={{ padding: "8px 12px" }}>
                                  {isEditingMon ? (
                                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                      <select
                                        className="select"
                                        style={{ flex: 1, fontSize: 13, padding: "4px 8px" }}
                                        value={monitorSelectedId}
                                        onChange={(e) => setMonitorSelectedId(e.target.value)}
                                        disabled={monitorLoading}
                                      >
                                        <option value="">Sin monitor</option>
                                        {monitorStudents.map((s) => (
                                          <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => saveMonitor(c.id)}
                                        style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                                      >
                                        Guardar
                                      </button>
                                      <button
                                        onClick={() => setMonitorEditCourseId(null)}
                                        style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#6b7280", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <span style={{ fontSize: 13, color: c.monitor_name ? "var(--text)" : "var(--muted)" }}>
                                        {c.monitor_name ?? "—"}
                                      </span>
                                      {!isHistoricalYear && (
                                        <button
                                          onClick={() => openMonitorEdit(c.id)}
                                          title="Asignar monitor"
                                          style={{ padding: "2px 8px", borderRadius: 7, border: "1px solid var(--stroke)", background: "transparent", color: "var(--text)", fontSize: 12, cursor: "pointer" }}
                                        >
                                          ✎
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>

                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                  <button
                                    disabled={hasUsers || isHistoricalYear}
                                    title={isHistoricalYear ? `Solo se puede modificar el año vigente (${adminYearActivo})` : hasUsers ? "No se puede eliminar: tiene estudiantes asignados" : "Eliminar curso"}
                                    onClick={() => deleteCourse(c.id)}
                                    style={{
                                      padding: "4px 12px",
                                      borderRadius: 8,
                                      border: "none",
                                      background: (hasUsers || isHistoricalYear) ? "var(--muted)" : "#ef4444",
                                      color: "#fff",
                                      cursor: (hasUsers || isHistoricalYear) ? "not-allowed" : "pointer",
                                      opacity: (hasUsers || isHistoricalYear) ? 0.45 : 1,
                                      fontSize: 13,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Eliminar
                                  </button>
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

          {view === "CLASSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear una Materia</h2>

              {/* ── Fila principal: Nivel | Módulo | Grupo | Nombre | Guardar | Cancelar ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto auto", gap: 12, alignItems: "flex-end" }}>
                <div>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={newClassLevel}
                    onChange={(e) => setNewClassLevel(Number(e.target.value))}
                  >
                    <option value={0} disabled>Selecciona...</option>
                    {levels.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={newClassModuleId}
                    onChange={(e) => setNewClassModuleId(e.target.value)}
                    disabled={!newClassLevel}
                  >
                    <option value="">{!newClassLevel ? "Selecciona un nivel primero" : "Selecciona..."}</option>
                    {availableModulesForCreate.map((m) => (
                      <option key={m.id} value={String(m.id)}>{m.name}</option>
                    ))}
                    <option value={OTHER_OPTION}>Otro...</option>
                  </select>
                </div>

                <div>
                  <div className="label">Grupo</div>
                  <select
                    className="select"
                    value={newClassGroupId}
                    onChange={(e) => setNewClassGroupId(e.target.value)}
                    disabled={!newClassModuleId}
                  >
                    <option value="">{!newClassModuleId ? "Selecciona un módulo primero" : "Selecciona..."}</option>
                    {availableGroupsForCreate.map((g) => (
                      <option key={g.id} value={String(g.id)}>{g.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Nombre</div>
                  <input
                    className="input"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="Ej: La Oración"
                    disabled={!newClassGroupId}
                  />
                </div>

                <button
                  className="btn"
                  onClick={createClass}
                  disabled={isHistoricalYear}
                  title={isHistoricalYear ? `Solo se puede modificar el año vigente (${adminYearActivo})` : undefined}
                  style={{ padding: "10px 16px", whiteSpace: "nowrap" }}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "10px 16px", whiteSpace: "nowrap", background: "#4b5563", borderColor: "#4b5563" }}
                  onClick={() => {
                    setNewClassLevel(0);
                    setNewClassModuleId("");
                    setNewClassGroupId("");
                    setNewClassName("");
                    setNewModuleName("");
                    setNewGroupName("");
                    setTblFilterLevel("");
                    setTblFilterModule("");
                    setTblFilterGroup("");
                    setTblFilterName("");
                    loadAll(adminYear);
                  }}
                >
                  Cancelar
                </button>
              </div>

              {/* Input extra para nuevo módulo */}
              {newClassModuleId === OTHER_OPTION && (
                <div style={{ marginTop: 10 }}>
                  <div className="label">Nombre del nuevo módulo</div>
                  <input
                    className="input"
                    value={newModuleName}
                    onChange={(e) => setNewModuleName(e.target.value)}
                    placeholder="Nombre del nuevo módulo"
                  />
                </div>
              )}

              {/* ── Tabla de materias existentes ── */}
              <div
                style={{
                  marginTop: 16,
                  overflow: "hidden",
                  borderRadius: 18,
                  border: "1px solid var(--stroke)",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(14,165,233,.08)" }}>
                      {([
                        { value: tblFilterLevel,  onChange: (v: string) => setTblFilterLevel(v),  disabled: false,          label: "Nivel",   options: tblLevelOptions.map(o => ({ value: o.id, label: o.name })) },
                        { value: tblFilterModule, onChange: (v: string) => setTblFilterModule(v), disabled: !tblFilterLevel,  label: "Módulo",  options: tblModuleOptions.map(n => ({ value: n, label: n })) },
                        { value: tblFilterGroup,  onChange: (v: string) => setTblFilterGroup(v),  disabled: !tblFilterModule, label: "Grupo",   options: tblGroupOptions.map(n => ({ value: n, label: n })) },
                        { value: tblFilterName,   onChange: (v: string) => setTblFilterName(v),   disabled: !tblFilterGroup,  label: "Materia", options: tblNameOptions.map(n => ({ value: n, label: n })) },
                      ]).map((col) => (
                        <th key={col.label} style={{ padding: "8px 12px", textAlign: "left" }}>
                          <select
                            className="select"
                            value={col.value}
                            onChange={(e) => col.onChange(e.target.value)}
                            disabled={col.disabled}
                            style={{
                              fontSize: 13,
                              padding: "4px 6px",
                              fontWeight: col.value ? 600 : 400,
                              color: col.value ? "var(--text)" : "var(--muted)",
                            }}
                          >
                            <option value="">{col.label}</option>
                            {col.options.map((o) => (
                              <option key={o.value} value={o.value} style={{ color: "#000" }}>{o.label}</option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {classesFiltered.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingData ? "Cargando..." : "Sin materias"}
                        </td>
                      </tr>
                    ) : (
                      classesFiltered.map((c, idx) => (
                        <tr key={c.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)", background: getGrillaBaseRowBg(idx, isDarkThemeEnabled()) }}>
                          <td style={{ padding: 12 }}>{levels.find((l) => l.id === Number(c.level))?.name ?? c.level}</td>
                          <td style={{ padding: 12 }}>{c.module_name || "—"}</td>
                          <td style={{ padding: 12 }}>{c.groups?.length ? c.groups.map((g) => g.name).join(", ") : "—"}</td>
                          <td style={{ padding: 12, fontWeight: 500 }}>{c.name}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "EVAL_CRUD" && (
            <>
              {msg   && <div className="msgError" style={{ marginTop: 12 }}>{msg}</div>}
              {okMsg && <div className="msgOk"    style={{ marginTop: 12 }}>{okMsg}</div>}
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Gestionar Evaluaciones</h2>


              {/* ── Modo de creación (radio buttons) ── */}
              <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <div className="label" style={{ margin: 0, whiteSpace: "nowrap" }}>Crear evaluación por</div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {(["module", "group", "class"] as EvalCrudMode[]).map((m) => {
                    const labels: Record<EvalCrudMode, string> = {
                      module: "Módulo",
                      group: "Grupo",
                      class: "Materia",
                    };
                    return (
                      <label
                        key={m}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}
                      >
                        <input
                          type="radio"
                          name="ecMode"
                          value={m}
                          checked={ecMode === m}
                          onChange={() => setEcMode(m)}
                        />
                        {labels[m]}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ── Fila 1: Año, Curso, [Profesor], Crear, Cancelar ── */}
              {(() => {
                const scopeReady = ecMode === "class" ? !!ecClassId : ecMode === "module" ? !!ecModuleId : !!ecGroupId;
                const cols = ecMode === "class" ? "1fr 1fr auto auto" : "1fr 1fr 1fr auto auto";
                return (
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "end", marginBottom: 12 }}>
                    <div>
                      <div className="label">Nivel</div>
                      <select
                        className="select"
                        value={ecLevel}
                        onChange={(e) => setEcLevel(Number(e.target.value))}
                      >
                        <option value={0} disabled>Seleccionar nivel...</option>
                        <option value={-1} style={{ fontWeight: 700 }}>Todos</option>
                        {levels.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="label">Curso</div>
                      <select
                        className="select"
                        value={ecCourseId}
                        onChange={(e) => setEcCourseId(e.target.value)}
                      >
                        <option value="" style={{ fontWeight: 700 }}>Todos</option>
                        {ecCourses.map((c) => (
                          <option key={c.id} value={String(c.id)}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    {ecMode !== "class" && (
                      <div>
                        <div className="label">Profesor</div>
                        <select
                          className="select"
                          value={ecTeacherId}
                          onChange={(e) => setEcTeacherId(e.target.value)}
                        >
                          <option value="">Seleccionar profesor...</option>
                          {ecTeachers.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        style={{ marginTop: 0, padding: "12px 48px", opacity: scopeReady ? 1 : 0.35, whiteSpace: "nowrap" }}
                        disabled={ecCreating || !scopeReady || isHistoricalYear}
                        title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                        onClick={ecHandleCreate}
                      >
                        {ecCreating ? "..." : "Crear"}
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        style={{
                          padding: "12px 20px",
                          border: "none",
                          borderRadius: 16,
                          background: "#4b5563",
                          color: "#ffffff",
                          fontWeight: 800,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        onClick={ecHandleCancel}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* ── Fila 2: Módulo, Grupo, Materia, Tipo, Título, % ── */}
              {(() => {
                const grupoDisabled = !ecLevel;
                const materiaDisabled = !ecLevel;
                const scopeReady = ecMode === "class" ? !!ecClassId : ecMode === "module" ? !!ecModuleId : !!ecGroupId;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1.5fr 70px", gap: 12, alignItems: "end" }}>
                    <div>
                      <div className="label">Módulo</div>
                      <select
                        className="select"
                        value={ecModuleId}
                        onChange={(e) => setEcModuleId(e.target.value)}
                        disabled={!ecLevel}
                      >
                        <option value="" style={{ fontWeight: 700 }}>Todos</option>
                        {ecModules.map((m) => (
                          <option key={m.id} value={String(m.id)}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ opacity: grupoDisabled ? 0.4 : 1, pointerEvents: grupoDisabled ? "none" : "auto" }}>
                      <div className="label">Grupo</div>
                      <select
                        className="select"
                        value={ecGroupId}
                        onChange={(e) => setEcGroupId(e.target.value)}
                        disabled={grupoDisabled}
                      >
                        <option value="" style={{ fontWeight: 700 }}>Todos</option>
                        {ecGroups.map((g) => (
                          <option key={g.id} value={String(g.id)}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ opacity: materiaDisabled ? 0.4 : 1, pointerEvents: materiaDisabled ? "none" : "auto" }}>
                      <div className="label">Materia</div>
                      <select
                        className="select"
                        value={ecClassId}
                        onChange={(e) => {
                          setEcClassId(e.target.value);
                          if (types.find(t => String(t.id) === ecType)?.type === "Examen" && e.target.value) {
                            const cls = classes.find(c => String(c.id) === e.target.value);
                            if (cls) setEcTitle(cls.name);
                          }
                        }}
                        disabled={materiaDisabled}
                      >
                        <option value="" style={{ fontWeight: 700 }}>Todos</option>
                        {ecClasses.map((c) => (
                          <option key={c.id} value={String(c.id)}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ opacity: scopeReady ? 1 : 0.35, pointerEvents: scopeReady ? "auto" : "none" }}>
                      <div className="label">Tipo</div>
                      <select
                        className="select"
                        value={ecType}
                        onChange={(e) => {
                          setEcType(e.target.value);
                          if (e.target.value !== "__other__") setEcTypeOther("");
                          if (types.find(t => String(t.id) === e.target.value)?.type === "Examen" && ecClassId) {
                            const cls = classes.find(c => String(c.id) === ecClassId);
                            if (cls) setEcTitle(cls.name);
                          }
                        }}
                        disabled={!ecLevel}
                      >
                        <option value="" style={{ fontWeight: 700 }}>Todos</option>
                        {types.map((t) => (
                          <option key={t.id} value={String(t.id)}>{t.type}</option>
                        ))}
                        <option value="__other__">Otro...</option>
                      </select>
                      {ecType === "__other__" && (
                        <div style={{ marginTop: 6 }}>
                          <input
                            className="input"
                            value={ecTypeOther}
                            onChange={(e) => setEcTypeOther(e.target.value)}
                            placeholder="Ej: Taller, Quiz..."
                          />
                        </div>
                      )}
                    </div>
                    <div style={{ opacity: scopeReady ? 1 : 0.35, pointerEvents: scopeReady ? "auto" : "none" }}>
                      <div className="label">Título</div>
                      <input
                        className="input"
                        value={ecTitle}
                        onChange={(e) => setEcTitle(e.target.value)}
                        placeholder="Ej: Parcial 1..."
                        disabled={!scopeReady}
                      />
                    </div>
                    <div style={{ opacity: scopeReady ? 1 : 0.35, pointerEvents: scopeReady ? "auto" : "none" }}>
                      <div className="label">%</div>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="input"
                        style={{ textAlign: "center" }}
                        value={ecPercent}
                        onChange={(e) => setEcPercent(Number(e.target.value))}
                        disabled={!scopeReady}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Evaluaciones existentes (card separado) ── */}
            {ecLevel !== 0 && (
              <div className="card" style={{ marginTop: 18 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <h2 style={{ margin: 0 }}>Evaluaciones existentes</h2>
                </div>

                {ecLoadingExisting ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Cargando evaluaciones...</div>
                ) : ecExistingFiltered.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    No hay evaluaciones para la selección actual.
                  </div>
                ) : (
                  <div style={{ borderRadius: 14, border: "1px solid var(--stroke)", overflow: "hidden", overflowX: "auto" }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "0.25fr 1.2fr 1.05fr 1fr 0.9fr 1fr 1.4fr 76px 70px 70px",
                        padding: "10px 16px",
                        background: "rgba(14,165,233,.06)",
                        borderBottom: "1px solid var(--stroke)",
                        fontWeight: 700,
                        fontSize: 12,
                        gap: 8,
                        minWidth: 900,
                      }}
                    >
                      <div style={{ color: "var(--label)" }}>Curso</div>
                      <div style={{ color: "var(--label)" }}>Módulo</div>
                      <div style={{ color: "var(--label)" }}>Grupo</div>
                      <div style={{ color: "var(--label)" }}>Materia</div>
                      <div style={{ color: "var(--label)" }}>Tipo</div>
                      <div style={{ color: "var(--label)" }}>Evaluación</div>
                      <div style={{ color: "var(--label)" }}>Profesor</div>
                      <div style={{ textAlign: "center", color: "var(--label)" }}>%</div>
                      <div />
                      <div />
                    </div>

                    {ecExistingFiltered.map((ev) => (
                      <div
                        key={ev.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "0.25fr 1.2fr 1.05fr 1fr 0.9fr 1fr 1.4fr 76px 70px 70px",
                          padding: "10px 16px",
                          alignItems: "center",
                          borderBottom: "1px solid var(--stroke)",
                          fontSize: 12,
                          gap: 8,
                          minWidth: 900,
                        }}
                      >
                        <div style={{ color: "var(--muted)" }}>{ev.course?.name ?? "—"}</div>
                        <div style={{ color: "var(--muted)" }}>{ev.module?.name ?? "—"}</div>
                        <div style={{ color: "var(--muted)" }}>{ev.group?.name ?? "—"}</div>
                        <div style={{ color: "var(--muted)" }}>{ev.class?.name ?? "—"}</div>
                        <div style={{ color: "var(--muted)" }}>{ev.evaluation_type?.type ?? "—"}</div>
                        <div style={{ fontWeight: 500 }}>{ev.title}</div>
                        <div>
                          <select
                            className="select"
                            style={{ fontSize: 14, padding: "8px 6px" }}
                            value={ecEditTeachers[ev.id] ?? ev.teacher?.id ?? ""}
                            onChange={(e) =>
                              setEcEditTeachers((p) => ({ ...p, [ev.id]: e.target.value }))
                            }
                          >
                            <option value="">Sin profesor</option>
                            {(ecRowTeachers.length > 0 ? ecRowTeachers : teachers).map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            className="input"
                            style={{ textAlign: "center", padding: "4px 6px", fontSize: 13, opacity: ev.evaluation_type?.type === "Examen" ? 0.5 : 1 }}
                            value={ecEditPercents[ev.id] ?? String(ev.percent)}
                            disabled={ev.evaluation_type?.type === "Examen"}
                            onChange={(e) =>
                              setEcEditPercents((p) => ({ ...p, [ev.id]: e.target.value }))
                            }
                          />
                        </div>
                        <div style={{ textAlign: "center" }}>
                          {ev.evaluation_type?.type === "Examen" ? (
                            <button
                              type="button"
                              className="btnLight"
                              style={{ fontSize: 12, padding: "8px 14px", borderRadius: 8, width: "100%", background: "#1d4ed8", color: "#fff", borderColor: "#1d4ed8" }}
                              onClick={() => ecHandleEditExam(ev)}
                            >
                              Editar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btnLight"
                              style={{ fontSize: 12, padding: "8px 14px", borderRadius: 8, width: "100%" }}
                              disabled={ecSavingPercent[ev.id] || isHistoricalYear}
                              title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                              onClick={() => ecHandleSavePercent(ev.id)}
                            >
                              {ecSavingPercent[ev.id] ? "..." : "Guardar"}
                            </button>
                          )}
                        </div>
                        <div style={{ textAlign: "center", paddingLeft: 6 }}>
                          <button
                            type="button"
                            className="btnLight"
                            style={{
                              fontSize: 12,
                              padding: "8px 14px",
                              borderRadius: 8,
                              background: "#ef4444",
                              color: "#fff",
                              borderColor: "#ef4444",
                            }}
                            disabled={ecDeleting[ev.id] || isHistoricalYear}
                            title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                            onClick={() => setEcConfirmDeleteId(ev.id)}
                          >
                            {ecDeleting[ev.id] ? "..." : "Eliminar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </>
          )}

          {view === "TYPES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear un tipo de evaluación</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "flex-end" }}>
                <div>
                  <div className="label">Tipo</div>
                  <input
                    className="input"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="Ej: Quiz, Parcial, Final..."
                  />
                </div>
                <button className="btn" onClick={createEvalType} disabled={isHistoricalYear} title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined} style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                  Crear tipo
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "10px 16px", whiteSpace: "nowrap", background: "#4b5563", borderColor: "#4b5563" }}
                  onClick={() => { setNewType(""); loadAll(adminYear); }}
                >
                  Cancelar
                </button>
              </div>

              <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    overflow: "hidden",
                    borderRadius: 18,
                    border: "1px solid var(--stroke)",
                    width: "100%",
                    maxWidth: 400,
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(14,165,233,.08)" }}>
                        <th style={{ textAlign: "left", padding: "12px 12px 12px 20px" }}>Tipo</th>
                        <th style={{ textAlign: "center", padding: 12 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {types.length === 0 ? (
                        <tr>
                          <td colSpan={2} style={{ padding: 12, color: "var(--muted)", textAlign: "center" }}>
                            {loadingData ? "Cargando..." : "Sin tipos"}
                          </td>
                        </tr>
                      ) : (
                        types.map((t, idx) => {
                          const inUse = (t.eval_count ?? 0) > 0;
                          return (
                            <tr key={t.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)", background: getGrillaBaseRowBg(idx, isDarkThemeEnabled()) }}>
                              <td style={{ padding: "12px 12px 12px 20px", textAlign: "left", fontWeight: 500 }}>{t.type}</td>
                              <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                <button
                                  disabled={inUse || isHistoricalYear}
                                  title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : inUse ? "No se puede eliminar: tiene evaluaciones asociadas" : "Eliminar tipo"}
                                  onClick={() => deleteEvalType(t.id)}
                                  style={{
                                    padding: "4px 12px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: (inUse || isHistoricalYear) ? "var(--muted)" : "#ef4444",
                                    color: "#fff",
                                    cursor: (inUse || isHistoricalYear) ? "not-allowed" : "pointer",
                                    opacity: (inUse || isHistoricalYear) ? 0.45 : 1,
                                    fontSize: 13,
                                    fontWeight: 600,
                                  }}
                                >
                                  Eliminar
                                </button>
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

          {view === "ASSIGN_TEACHER" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Asignar Materias a un Profesor</h2>

              {/* Filtros + botones — distribuidos en todo el ancho */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    style={{ width: "100%" }}
                    value={selAssignLevel}
                    onChange={(e) => {
                      const lv = e.target.value;
                      setSelAssignLevel(lv);
                      setSelAssignCourse("ALL");
                      setAssignEdits({});
                      setAssignMatFilter("ALL");
                      setAssignProfFilter("ALL");
                      if (lv) loadAssignmentGrid("ALL", lv);
                      else setAssignGrid([]);
                    }}
                  >
                    <option value="">Selecciona un año...</option>
                    <option value="ALL" style={{ fontWeight: 700 }}>Todos</option>
                    {levels.map((lvl) => (
                      <option key={lvl.id} value={String(lvl.id)}>{lvl.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1, minWidth: 140 }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    style={{ width: "100%" }}
                    value={selAssignCourse}
                    onChange={(e) => {
                      const cv = e.target.value;
                      setSelAssignCourse(cv);
                      setAssignEdits({});
                      setAssignMatFilter("ALL");
                      setAssignProfFilter("ALL");
                      loadAssignmentGrid(cv, selAssignLevel);
                    }}
                  >
                    <option value="ALL" style={{ fontWeight: 700 }}>Todos</option>
                    {coursesForLevel.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  className="btn"
                  style={{ alignSelf: "flex-end" }}
                  onClick={saveAssignmentGrid}
                  disabled={assignSaving || assignGrid.length === 0 || isHistoricalYear}
                  title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                >
                  {assignSaving ? "Guardando..." : "Guardar"}
                </button>

                <button
                  className="btn"
                  style={{ alignSelf: "flex-end", background: "#4b5563", borderColor: "#4b5563" }}
                  onClick={resetAssignView}
                >
                  Cancelar
                </button>
              </div>

              {/* Tabla */}
              {assignLoading && (
                <div style={{ marginTop: 16, color: "var(--muted)" }}>Cargando...</div>
              )}

              {!assignLoading && assignGrid.length > 0 && (
                <div style={{ marginTop: 16, maxWidth: 900, marginLeft: "auto", marginRight: "auto" }}>
                <div style={{ borderRadius: GRILLA.radiusPrimary, overflow: "hidden", border: GRILLA.outerBorder }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: isDarkThemeEnabled() ? GRILLA.headerBgDark : GRILLA.headerBgLight }}>
                        <th style={{ padding: "6px 16px", textAlign: "left", fontWeight: 700, fontSize: 13, color: isDarkThemeEnabled() ? GRILLA.headerTextDark : GRILLA.headerTextLight, borderBottom: GRILLA.headerBottomBorder }}>
                          <select
                            className="select"
                            style={{ fontWeight: 700, fontSize: 13 }}
                            value={assignMatFilter}
                            onChange={(e) => { setAssignMatFilter(e.target.value); if (e.target.value === "WITHOUT") setAssignProfFilter("ALL"); }}
                          >
                            <option value="ALL" style={{ color: "#000", fontWeight: 700 }}>Todas</option>
                            <option value="WITH" style={{ color: "#000", fontWeight: 700 }}>Con Profesor</option>
                            <option value="WITHOUT" style={{ color: "#000", fontWeight: 700 }}>Sin Profesor</option>
                            {assignGrid
                              .filter((r, i, arr) => arr.findIndex((x) => x.id_class === r.id_class) === i)
                              .map((r) => (
                                <option key={r.id_class} value={String(r.id_class)}>{r.class_name}</option>
                              ))}
                          </select>
                        </th>
                        <th style={{ padding: "6px 16px", textAlign: "left", fontWeight: 700, fontSize: 13, color: isDarkThemeEnabled() ? GRILLA.headerTextDark : GRILLA.headerTextLight, borderBottom: GRILLA.headerBottomBorder }}>
                          <select
                            className="select"
                            style={{ fontWeight: 700, fontSize: 13 }}
                            value={assignProfFilter}
                            onChange={(e) => { setAssignProfFilter(e.target.value); setAssignMatFilter("ALL"); }}
                          >
                            <option value="ALL" style={{ color: "#000", fontWeight: 700 }}>Todos</option>
                            <option value="WITH" style={{ color: "#000", fontWeight: 700 }}>Con Materias asignadas</option>
                            <option value="WITHOUT" style={{ color: "#000", fontWeight: 700 }}>Sin Materias asignadas</option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </th>
                      </tr>
                    </thead>
                    <tbody style={{ fontSize: 13, lineHeight: 2.5 }}>
                      {assignVisibleRows.map((r, idx) => {
                        const key = `${r.id_class}_${r.id_course}`;
                        return (
                          <tr
                            key={key}
                            style={{ background: getGrillaBaseRowBg(idx, isDarkThemeEnabled()), borderBottom: GRILLA.rowBottomBorder }}
                          >
                            <td style={{ padding: "0 12px" }}>
                              {assignMultiCourse
                                ? <>{r.class_name} <span style={{ color: "var(--muted)", fontSize: 11 }}>· {r.course_name}</span></>
                                : r.class_name}
                            </td>
                            <td style={{ padding: "0 8px" }}>
                              <select
                                className="select"
                                style={{ fontSize: 13, padding: "3px 16px", lineHeight: 2.5, borderRadius: 999, border: "1px solid var(--stroke)", background: "var(--card)", boxShadow: "none" }}
                                value={
                                  Object.prototype.hasOwnProperty.call(assignEdits, key)
                                    ? assignEdits[key]
                                    : (r.id_teacher || "")
                                }
                                onChange={(e) =>
                                  setAssignEdits((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                              >
                                <option value="" style={{ color: "#000", fontWeight: 700 }}>- Sin profesor -</option>
                                {teachers.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                      {assignOrphanTeachers.map((t, idx) => (
                        <tr
                          key={`orphan-${t.id}`}
                          style={{ background: getGrillaBaseRowBg(assignVisibleRows.length + idx, isDarkThemeEnabled()), borderBottom: GRILLA.rowBottomBorder, opacity: 0.65 }}
                        >
                          <td style={{ padding: "0 12px", fontStyle: "italic" }}>--</td>
                          <td style={{ padding: "0 12px" }}>{t.name}</td>
                        </tr>
                      ))}
                      {assignVisibleRows.length === 0 && assignOrphanTeachers.length === 0 && (
                        <tr>
                          <td colSpan={2} style={{ padding: "14px 16px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
                            Sin resultados para el filtro seleccionado
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </div>
              )}
            </div>
          )}

          {view === "USERS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear / Actualizar persona</h2>

              {/* ── Fila 1: Crear/Actualizar persona ── */}
              <div style={{ marginTop: 10 }}>
                <div style={{ padding: 14, borderRadius: 18, border: "1px solid var(--stroke)", background: "rgba(14,165,233,.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Rol</div>
                    {ROLE_OPTIONS.map((r) => (
                      <label key={r.value} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={!!uRoles[r.value]}
                          onChange={(e) => setURoles((p) => ({ ...p, [r.value]: e.target.checked }))}
                        />
                        <span>{r.label}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>

                    {/* Cédula + Buscar */}
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="label">Cédula</div>
                      <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--stroke)", borderRadius: 12, overflow: "hidden", height: 42 }}>
                        <input
                          className="input"
                          style={{ flex: 1, border: "none", outline: "none", borderRadius: 0, height: "100%", padding: "0 10px" }}
                          inputMode="numeric"
                          value={uCedula}
                          onChange={(e) => { setUCedula(e.target.value.replace(/\D/g, "")); setUFoundUser(false); setUNotFound(false); }}
                          onKeyDown={(e) => { if (e.key === "Enter") searchUserByCedula(); }}
                        />
                        <button
                          type="button"
                          className="btn"
                          style={{ borderRadius: 0, margin: 0, height: "100%", background: "linear-gradient(to bottom, #6b7280, #4b5563)", borderColor: "#4b5563", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}
                          onClick={searchUserByCedula}
                          disabled={uSearching}
                        >
                          {uSearching ? "..." : "Buscar"}
                        </button>
                      </div>
                    </div>

                    <div style={{ flex: 2, minWidth: 130 }}>
                      <div className="label">Nombre</div>
                      <input className="input" style={{ width: "100%", height: 42 }} value={uName} onChange={(e) => setUName(e.target.value)} />
                    </div>

                    <div style={{ flex: 2, minWidth: 150 }}>
                      <div className="label">Email</div>
                      <input className="input" style={{ width: "100%", height: 42 }} value={uEmail} onChange={(e) => setUEmail(e.target.value)} />
                    </div>

                    {(uRoles.S || uRoles.M) && (
                      <div style={{ flex: 1, minWidth: 90 }}>
                        <div className="label">Código Jiliu</div>
                        <input
                          className="input"
                          style={{ width: "100%", height: 42 }}
                          inputMode="numeric"
                          value={uCodeJiliu}
                          onChange={(e) => setUCodeJiliu(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                    )}

                    {(uRoles.S || uRoles.M) && (
                      <div style={{ flex: 1, minWidth: 110 }}>
                        <div className="label">Año</div>
                        <select
                          className="select"
                          style={{ width: "100%", height: 42, paddingTop: 0, paddingBottom: 0, boxSizing: "border-box" }}
                          value={uLevelId}
                          onChange={(e) => { setULevelId(e.target.value); setUCourseId(""); }}
                        >
                          <option value="">Selecciona...</option>
                          {levels.map((l) => (
                            <option key={l.id} value={String(l.id)}>{l.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(uRoles.S || uRoles.M) && (
                      <div style={{ flex: 1, minWidth: 110 }}>
                        <div className="label">Curso</div>
                        <select
                          className="select"
                          style={{ width: "100%", height: 42, paddingTop: 0, paddingBottom: 0, boxSizing: "border-box" }}
                          value={uCourseId}
                          disabled={!uLevelId}
                          onChange={(e) => setUCourseId(e.target.value)}
                        >
                          <option value="">{!uLevelId ? "Selecciona un año" : "Selecciona..."}</option>
                          {coursesForULevel.map((c) => (
                            <option key={c.id} value={String(c.id)}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      className="btn"
                      onClick={createUserManual}
                      disabled={creatingUser || isHistoricalYear}
                      title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                      style={{ height: 42 }}
                    >
                      {creatingUser ? "Guardando..." : "Guardar"}
                    </button>
                    {uFoundUser && (
                      <button
                        type="button"
                        className="btn"
                        style={{ height: 42, background: "#dc2626", borderColor: "#b91c1c", opacity: isHistoricalYear ? 0.45 : 1, cursor: isHistoricalYear ? "not-allowed" : "pointer" }}
                        onClick={deleteUser}
                        disabled={isHistoricalYear}
                        title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                      >
                        Eliminar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      style={{ height: 42, background: "#4b5563", borderColor: "#4b5563" }}
                      onClick={() => { resetManualUserForm(); setMsg(null); setOkMsg(null); }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Fila 2: Cargue masivo ── */}
              <div style={{ padding: 14, borderRadius: 18, border: "1px solid var(--stroke)", background: "rgba(34,197,94,.08)", marginTop: 36 }}>
                <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 10 }}>
                  Cargue masivo
                </div>

                {<>
                {/* Input file oculto */}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={(e) => setUploadFileName(e.target.files?.[0]?.name ?? "")}
                />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

                  {/* Izquierda: Descargar Plantilla */}
                  <button
                    className="btn"
                    onClick={downloadTemplate}
                    disabled={templateLoading}
                    style={{ background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)", border: "1px solid rgba(34,197,94,.8)", color: "#fff", fontWeight: 700, height: 42, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(34,197,94,.35)" }}
                  >
                    {templateLoading ? "Generando..." : (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        ↓&nbsp;&nbsp;&nbsp;Plantilla&nbsp;&nbsp;
                        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">
                          {/* Página base */}
                          <path d="M4 2h9l5 5v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="#fff" stroke="#14532d" strokeWidth="1.2"/>
                          <path d="M13 2v5h5" fill="none" stroke="#14532d" strokeWidth="1.2"/>
                          {/* Banda verde con "X" estilo Excel */}
                          <rect x="3" y="10" width="18" height="11" rx="1" fill="#16a34a" stroke="#14532d" strokeWidth="0.8"/>
                          <text x="6.5" y="19.5" fontSize="9" fontWeight="bold" fill="#ffffff" fontFamily="Arial, sans-serif">xls</text>
                        </svg>
                      </span>
                    )}
                  </button>

                  {/* Derecha: Elegir archivo + Cargar Plantilla + Cancelar */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>

                    {/* Elegir archivo + nombre */}
                    <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--stroke)", borderRadius: 12, overflow: "hidden", height: 42 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ borderRadius: 0, margin: 0, height: "100%", background: "linear-gradient(to bottom, #6b7280, #4b5563)", borderColor: "#4b5563", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}
                        onClick={() => fileRef.current?.click()}
                      >
                        Elegir archivo
                      </button>
                      <input
                        type="text"
                        readOnly
                        value={uploadFileName || "Ningún archivo seleccionado"}
                        style={{ width: 400, padding: "0 10px", fontSize: 13, background: "#ffffff", border: "none", outline: "none", color: uploadFileName ? "var(--text)" : "var(--muted)" }}
                      />
                    </div>

                    {/* Cargar Plantilla */}
                    <button
                      className="btn"
                      onClick={uploadExcelUsers}
                      disabled={uploading || isHistoricalYear}
                      title={isHistoricalYear ? `Solo año vigente (${adminYearActivo})` : undefined}
                    >
                      {uploading ? "Subiendo..." : "↑ Cargar Archivo"}
                    </button>

                    {/* Cancelar */}
                    <button
                      type="button"
                      className="btn"
                      style={{ background: "#4b5563", borderColor: "#4b5563" }}
                      onClick={() => {
                        setUploadReport(null);
                        setUploadFileName("");
                        setMsg(null);
                        setOkMsg(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
                {uploadReport && (
                  <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 14, border: "1px solid var(--stroke)" }}>
                    <div style={{ padding: "8px 12px", fontWeight: 900, background: "rgba(14,165,233,.08)", fontSize: 13 }}>Resultado</div>
                    <div style={{ padding: "8px 12px", fontSize: 13 }}>
                      <div>Creados: <b>{uploadReport.created}</b></div>
                      <div>Actualizados: <b>{uploadReport.updated}</b></div>
                      <div>Saltados: <b>{uploadReport.skipped}</b></div>
                      {Array.isArray(uploadReport.errors) && uploadReport.errors.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 900, color: "#b91c1c" }}>Errores:</div>
                          <ul style={{ marginTop: 4 }}>
                            {uploadReport.errors.slice(0, 25).map((x: { row: number; error: string }, idx: number) => (
                              <li key={idx} style={{ color: "#b91c1c", fontWeight: 700 }}>Fila {x.row}: {x.error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </>}
              </div>

            </div>
          )}

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
                  <h2 style={{ margin: 0 }}>Gestionar Notas</h2>
                </div>

              </div>

              {msg   && <div className="msgError" style={{ marginTop: 12 }}>{msg}</div>}
              {okMsg && <div className="msgOk"    style={{ marginTop: 12 }}>{okMsg}</div>}

              <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                {/* Año */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    value={String(upsertLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUpsertLevelFilter(v === "" ? "" : Number(v));
                      setUpsertCourseFilter("all");
                      setUpsertModuleFilter("all");
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="" disabled>Seleccionar año...</option>
                    <option value="0" style={{ fontWeight: 700 }}>Todos</option>
                    {availableLevels.map((lvl) => (
                      <option key={lvl} value={String(lvl)}>
                        {levels.find((l) => l.id === lvl)?.name ?? `Nivel ${lvl}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Curso */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={upsertCourseFilter === "all" ? "all" : String(upsertCourseFilter)}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "all") {
                        setUpsertCourseFilter("all");
                      } else {
                        const courseId = Number(val);
                        setUpsertCourseFilter(courseId);
                        const selectedCourse = courses.find((c) => c.id === courseId);
                        if (selectedCourse) {
                          setUpsertLevelFilter(selectedCourse.level);
                        }
                      }
                      setUpsertModuleFilter("all");
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Todos</option>
                    {upsertCoursesFiltered.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Módulo */}
                <div style={{ flex: "1 1 140px" }}>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={upsertModuleFilter === "all" ? "all" : String(upsertModuleFilter)}
                    onChange={(e) => {
                      setUpsertModuleFilter(e.target.value === "all" ? "all" : Number(e.target.value));
                      setUpsertClassFilter("all");
                    }}
                  >
                    <option value="all" style={{ fontWeight: 700 }}>Todos</option>
                    {upsertModulesFiltered.map((m) => (
                      <option key={m.id} value={String(m.id)}>{m.name}</option>
                    ))}
                  </select>
                </div>

                {/* Materia + botones alineados */}
                <div style={{ flex: "2 1 200px", display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <div className="label">Materia</div>
                    <select
                      className="select"
                      value={upsertClassFilter}
                      onChange={(e) =>
                        setUpsertClassFilter(
                          e.target.value === "all" ? "all" : Number(e.target.value)
                        )
                      }
                    >
                      <option value="all">Todas</option>
                      {upsertClassesFiltered.map((c) => (
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
              </div>

              {upsertLevelFilter === "" ? null : (
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
                      {(() => {
                        const levelLabel = typeof upsertLevelFilter === "number" && upsertLevelFilter !== 0
                          ? (levels.find(l => l.id === upsertLevelFilter)?.name ?? `Nivel ${upsertLevelFilter}`)
                          : upsertLevelFilter === 0 ? "Todos los años" : null;
                        const courseLabel = upsertCourseFilter !== "all"
                          ? (courses.find(c => c.id === Number(upsertCourseFilter))?.name ?? "—")
                          : null;
                        const moduleLabel = upsertModuleFilter !== "all"
                          ? (modules.find(m => m.id === Number(upsertModuleFilter))?.name ?? "—")
                          : null;
                        const classLabel = upsertClassFilter !== "all"
                          ? (gridClassInfo?.name ?? selectedUpsertClass?.name ?? "—")
                          : null;
                        const parts = [
                          levelLabel,
                          courseLabel ?? (levelLabel ? "Todos los cursos" : null),
                          moduleLabel ?? (levelLabel ? "Todos los módulos" : null),
                          classLabel ?? (levelLabel ? "Todas las materias" : null),
                        ].filter(Boolean);
                        return parts.join(" › ") || "Todas las notas";
                      })()}
                    </div>

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
                        minHeight: 200,
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
                          <col style={{ width: `90px` }} />
                          {gEvaluations.map((ev) => (
                            <col key={`${ev.id}-grade`} style={{ width: `120px` }} />
                          ))}
                          <col style={{ width: `${ACTION_COL_W}px` }} />
                        </colgroup>

                        <thead>
                          {/* Subheader row: class names when showing multiple classes */}
                          {upsertClassFilter === "all" && gEvaluations.length > 0 && (() => {
                            const groups: { classId: number; className: string; count: number }[] = [];
                            for (const ev of gEvaluations) {
                              const cid = ev.id_class;
                              const last = groups[groups.length - 1];
                              if (last && last.classId === cid) { last.count++; }
                              else groups.push({ classId: cid, className: ev.class?.name || `Clase ${cid}`, count: 1 });
                            }
                            return (
                              <tr>
                                <td colSpan={3} style={{ borderBottom: GRILLA.headerBottomBorder, background: GRILLA.headerBgLight, position: "sticky", top: 0, left: 0, zIndex: 7 }} />
                                {groups.map((g) => (
                                  <td
                                    key={g.classId}
                                    colSpan={g.count}
                                    style={{
                                      padding: "4px 10px",
                                      borderBottom: GRILLA.headerBottomBorder,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      textAlign: "center",
                                      background: GRILLA.headerBgLight,
                                      borderLeft: "1px solid var(--stroke)",
                                      position: "sticky",
                                      top: 0,
                                      zIndex: 5,
                                    }}
                                  >
                                    {g.className}
                                  </td>
                                ))}
                                <td style={{ borderBottom: GRILLA.headerBottomBorder, background: GRILLA.headerBgLight, position: "sticky", top: 0, zIndex: 5 }} />
                              </tr>
                            );
                          })()}
                          <tr>
                            <th
                              style={{
                                textAlign: "left",
                                padding: "8px 12px",
                                borderBottom: GRILLA.headerBottomBorder,
                                position: "sticky",
                                top: upsertClassFilter === "all" ? 33 : 0,
                                left: 0,
                                zIndex: 6,
                                whiteSpace: "nowrap",
                                boxShadow: "none",
                              }}
                            >
                              <select
                                className="select"
                                value={gFilterCedula}
                                onChange={(e) => {
                                  setGFilterCedula(e.target.value);
                                  if (e.target.value !== "all") setGFilterName("all");
                                }}
                                disabled={gFilterName !== "all"}
                                style={{
                                  fontSize: 13,
                                  padding: "4px 6px",
                                  fontWeight: gFilterCedula !== "all" ? 600 : 700,
                                  color: gFilterCedula !== "all" ? "var(--text)" : isDarkTheme ? "#fff" : "#000",
                                }}
                              >
                                <option value="all" style={{ fontWeight: 700, color: "#000" }}>Cédula</option>
                                {sortedRoster.map((st) => (
                                  <option key={st.id} value={st.cedula} style={{ color: "#000" }}>{st.cedula}</option>
                                ))}
                              </select>
                            </th>

                            <th
                              style={{
                                textAlign: "left",
                                padding: "8px 12px",
                                borderBottom: GRILLA.headerBottomBorder,
                                position: "sticky",
                                top: upsertClassFilter === "all" ? 33 : 0,
                                left: STICKY_ALUMNO_LEFT,
                                zIndex: 6,
                                boxShadow: "none",
                              }}
                            >
                              <select
                                className="select"
                                value={gFilterName}
                                onChange={(e) => {
                                  setGFilterName(e.target.value);
                                  if (e.target.value !== "all") setGFilterCedula("all");
                                }}
                                disabled={gFilterCedula !== "all"}
                                style={{
                                  fontSize: 13,
                                  padding: "4px 6px",
                                  fontWeight: gFilterName !== "all" ? 600 : 700,
                                  color: gFilterName !== "all" ? "var(--text)" : isDarkTheme ? "#fff" : "#000",
                                }}
                              >
                                <option value="all" style={{ fontWeight: 700, color: "#000" }}>Alumno</option>
                                {sortedRoster.map((st) => (
                                  <option key={st.id} value={st.id} style={{ color: "#000" }}>{st.name}</option>
                                ))}
                              </select>
                            </th>

                            <th
                              style={{
                                textAlign: "center",
                                padding: "8px 10px",
                                borderBottom: GRILLA.headerBottomBorder,
                                position: "sticky",
                                top: upsertClassFilter === "all" ? 33 : 0,
                                zIndex: 5,
                                whiteSpace: "nowrap",
                                color: "#64748b",
                                fontWeight: 700,
                              }}
                            >
                              <span style={{ color: "#64748b", fontSize: 12 }}>No Aprobadas</span>
                            </th>

                            {gEvaluations.map((ev) => (
                              <th
                                key={`${ev.id}-grade`}
                                style={{
                                  textAlign: "left",
                                  padding: "8px 10px",
                                  borderBottom: GRILLA.headerBottomBorder,
                                  position: "sticky",
                                  top: upsertClassFilter === "all" ? 33 : 0,
                                  zIndex: 5,
                                  lineHeight: 1.2,
                                  borderLeft: upsertClassFilter === "all" ? "1px solid var(--stroke)" : undefined,
                                }}
                              >
                                {(() => {
                                  const typeLabel = String(ev.evaluation_type?.type || ev.title || "Evaluación").trim();
                                  const showTitle = ev.title && ev.title.trim() !== typeLabel;
                                  return (
                                    <div style={{ lineHeight: 1.3 }}>
                                      <div>{typeLabel} ({Number(ev.percent).toFixed(0)}%)</div>
                                      {showTitle && (
                                        <div style={{ fontSize: 11, opacity: 0.8 }}>{ev.title}</div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </th>
                            ))}

                            <th
                              style={{
                                textAlign: "center",
                                padding: "8px 10px",
                                borderBottom: GRILLA.headerBottomBorder,
                                position: "sticky",
                                top: upsertClassFilter === "all" ? 33 : 0,
                                zIndex: 5,
                              }}
                            />
                          </tr>
                        </thead>

                        <tbody>
                          {gLoadingRoster ? (
                            <tr>
                              <td
                                colSpan={Math.max(4, gEvaluations.length + 4)}
                                style={{
                                  padding: 32,
                                  minHeight: 120,
                                  textAlign: "center",
                                  fontSize: 14,
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
                                colSpan={Math.max(4, gEvaluations.length + 4)}
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
                                colSpan={4}
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
                            filteredRoster.map((st, rowIndex) => {
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
                                    <div style={{ lineHeight: 1.15 }}>
                                      {st.name}
                                    </div>
                                  </td>

                                  {(() => {
                                    const perdidas = gEvaluations.filter((ev) => {
                                      if (!isEvaluationApplicableToStudent(st, ev)) return false;
                                      const gradeRecord = gGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
                                      const gradeVal = gradeRecord?.grade ?? 0;
                                      return gradeVal < 70;
                                    }).length;
                                    return (
                                      <td
                                        style={{
                                          padding: "2px 10px",
                                          borderBottom: GRILLA.rowBottomBorder,
                                          background: isEditing ? activeRowBg : baseRowBg,
                                          textAlign: "center",
                                          fontWeight: 400,
                                          fontSize: 13,
                                          color: perdidas > 0 ? "#f87171" : cellTextColor,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {perdidas > 0 ? perdidas : ""}
                                      </td>
                                    );
                                  })()}

                                  {gEvaluations.map((ev) => {
                                    const key = gradeCellKey(st.id, ev.id);
                                    const enabledForCourse = isEvaluationApplicableToStudent(st, ev);
                                    const editable = enabledForCourse && isEditing && !isBusy;
                                    const gradeRecord = gGrades.find((g) => g.id_student === st.id && g.id_exam === ev.id);
                                    const attempts = gradeRecord?.attempts ?? 0;
                                    const gradeVal = gradeRecord?.grade ?? 0;
                                    const noPresentó = enabledForCourse && attempts === 0 && gradeVal === 0;

                                    return (
                                      <td
                                        key={`${ev.id}-grade`}
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
                                                padding: "2px 4px",
                                                borderRadius: 4,
                                                fontSize: 8,
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
                                            placeholder={enabledForCourse ? "—" : "-"}
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
                                                ? (gradeDraft[key] !== "" && gradeDraft[key] !== undefined && Number(gradeDraft[key]) < 70 ? "#dc2626" : cellTextColor)
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
                                        disabled={isBusy || (isEditing && isHistoricalYear)}
                                        title={(isEditing && isHistoricalYear) ? `Solo año vigente (${adminYearActivo})` : undefined}
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

                </div>
              )}
            </div>
          )}
          {view === "HABILITAR_EXAMENES" && (
            <HabilitarExamenes courses={courses} />
          )}

          {view === "ANIO_LECTIVO" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Años Lectivos</h2>

              {/* Lista de años */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 28 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 12px", borderBottom: "1px solid var(--stroke)" }}>Año</th>
                    <th style={{ textAlign: "left", padding: "6px 12px", borderBottom: "1px solid var(--stroke)" }}>Nombre</th>
                    <th style={{ textAlign: "center", padding: "6px 12px", borderBottom: "1px solid var(--stroke)" }}>Estado</th>
                    <th style={{ padding: "6px 12px", borderBottom: "1px solid var(--stroke)" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {anioLectivoItems.map((a) => (
                    <tr key={a.year}>
                      <td style={{ padding: "8px 12px", fontWeight: 700 }}>{a.year}</td>
                      <td style={{ padding: "8px 12px" }}>{a.nombre}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        {a.activo
                          ? <span style={{ color: "var(--ok, #16a34a)", fontWeight: 700 }}>Vigente</span>
                          : <span style={{ color: "var(--text-muted, #6b7280)" }}>Inactivo</span>
                        }
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        {!a.activo && (
                          alConfirmActivate === a.year ? (
                            <span style={{ display: "inline-flex", gap: 8 }}>
                              <button
                                className="btn"
                                style={{ padding: "4px 12px", fontSize: 12 }}
                                disabled={alActivating === a.year}
                                onClick={async () => {
                                  setAlActivating(a.year);
                                  try {
                                    await apiFetch("/api/admin/anio-lectivo/activo", { method: "PUT", body: JSON.stringify({ year: a.year }) });
                                    setAlConfirmActivate(null);
                                    const res = await apiFetch("/api/admin/anio-lectivo");
                                    const items: AnioLectivoItem[] = res?.items || [];
                                    setAnioLectivoItems(items);
                                    const activo = items.find(i => i.activo);
                                    if (activo) { setAdminYear(activo.year); loadAll(activo.year); }
                                    showOk(`✅ Año ${a.year} activado`);
                                  } catch (e) {
                                    showErr((e as { message?: string })?.message || "Error activando año");
                                  } finally {
                                    setAlActivating(null);
                                  }
                                }}
                              >
                                {alActivating === a.year ? "Activando…" : "Confirmar"}
                              </button>
                              <button className="btnSecondary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setAlConfirmActivate(null)}>Cancelar</button>
                            </span>
                          ) : (
                            <button
                              className="btnSecondary"
                              style={{ padding: "4px 12px", fontSize: 12 }}
                              onClick={() => setAlConfirmActivate(a.year)}
                            >
                              Activar
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Crear nuevo año */}
              <h3 style={{ marginTop: 0, marginBottom: 12 }}>Crear nuevo año lectivo</h3>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <div className="label">Año</div>
                  <input
                    className="input"
                    type="number"
                    min={2020}
                    max={2100}
                    placeholder="ej: 2027"
                    value={alNewYear}
                    onChange={(e) => setAlNewYear(e.target.value)}
                    style={{ width: 100 }}
                  />
                </div>
                <div>
                  <div className="label">Nombre</div>
                  <input
                    className="input"
                    type="text"
                    placeholder="ej: Año Lectivo 2027"
                    value={alNewNombre}
                    onChange={(e) => setAlNewNombre(e.target.value)}
                    style={{ width: 220 }}
                  />
                </div>
                <button
                  className="btn"
                  disabled={alCreating || !alNewYear || !alNewNombre}
                  onClick={async () => {
                    const y = Number(alNewYear);
                    if (!y || !alNewNombre.trim()) return;
                    setAlCreating(true);
                    try {
                      await apiFetch("/api/admin/anio-lectivo", { method: "POST", body: JSON.stringify({ year: y, nombre: alNewNombre.trim() }) });
                      setAlNewYear("");
                      setAlNewNombre("");
                      const res = await apiFetch("/api/admin/anio-lectivo");
                      setAnioLectivoItems(res?.items || []);
                      showOk(`✅ Año ${y} creado`);
                    } catch (e) {
                      showErr((e as { message?: string })?.message || "Error creando año");
                    } finally {
                      setAlCreating(false);
                    }
                  }}
                >
                  {alCreating ? "Creando…" : "Crear año"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Overlay Crear Examen */}
      {showCrearExamen && crearExamenCtx && (
        <CrearExamen
          ctx={crearExamenCtx}
          examId={crearExamenExamId ?? undefined}
          initialData={crearExamenInitialData ?? undefined}
          onSaved={() => {
            const wasEditing = crearExamenExamId !== null;
            setShowCrearExamen(false);
            setCrearExamenCtx(null);
            setCrearExamenInitialData(null);
            setCrearExamenExamId(null);
            if (!wasEditing) { setEcTitle(""); setEcPercent(30); setEcType(""); setEcTypeOther(""); }
            showOk(wasEditing ? "✅ Examen actualizado correctamente" : "✅ Examen creado correctamente");
            const reloadParams = new URLSearchParams();
            if (ecLevel > 0) reloadParams.set("level", String(ecLevel));
            if (ecCourseId)  reloadParams.set("course_id", ecCourseId);
            apiFetch(`/api/admin/evaluations?${reloadParams.toString()}`)
              .then((r) => {
                const evs: EvalItem[] = r?.items || [];
                setEcExisting(evs);
                const initP: Record<number, string> = {};
                const initT: Record<number, string> = {};
                evs.forEach((e) => { initP[e.id] = String(e.percent); initT[e.id] = e.teacher?.id ?? ""; });
                setEcEditPercents(initP);
                setEcEditTeachers(initT);
              })
              .catch(() => {});
          }}
          onCancel={() => {
            setShowCrearExamen(false);
            setCrearExamenCtx(null);
            setCrearExamenInitialData(null);
            setCrearExamenExamId(null);
          }}
        />
      )}

      {/* Modal confirmar eliminar evaluación */}
      {ecConfirmDeleteId !== null && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="card" style={{ maxWidth: 380, width: "90%", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>⚠️</div>
            <h3 style={{ margin: "0 0 10px" }}>¿Eliminar evaluación?</h3>
            <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24 }}>
              Se eliminarán también todas las programaciones, notas y respuestas de examen de los estudiantes. Esta acción no se puede deshacer.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn"
                style={{ background: "var(--card)", color: "var(--text)", border: "1px solid var(--stroke)", padding: "10px 24px" }}
                onClick={() => setEcConfirmDeleteId(null)}>
                Cancelar
              </button>
              <button className="btn"
                style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444", padding: "10px 24px" }}
                onClick={() => ecHandleDelete(ecConfirmDeleteId)}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer  />
    </div>
  );
}