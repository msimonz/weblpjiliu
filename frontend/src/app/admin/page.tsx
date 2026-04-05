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

type Course = { id: number; name: string; level: number; year: string | null };

type GroupMini = {
  id: number;
  name: string;
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

type EvalType = { id: number; type: string };

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
  class?: { id: number; name: string; level: number };
  evaluation_type?: { id: number; type: string };
  id_course: number;
  id_class: number;
  id_type: number;
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

type GradeGridResponse = {
  class: { id: number; name: string; level: number } | null;
  evaluations: EvalItem[];
  students: StudentRow[];
  grades: GridGradeRow[];
};

const OTHER_OPTION = "__OTHER__";
const LEVELS = [
  { value: 1, label: "Primer año" },
  { value: 2, label: "Segundo año" },
  { value: 3, label: "Tercer año" },
  { value: 4, label: "Cuarto año" },
] as const;

type AdminView =
  | "COURSES"
  | "CLASSES"
  | "TYPES"
  | "ASSIGN_TEACHER"
  | "USERS"
  | "UPDATE_USER"
  | "UPSERT";

const ROLE_OPTIONS = [
  { value: "S", label: "Student (S)" },
  { value: "T", label: "Teacher (T)" },
  { value: "A", label: "Admin (A)" },
] as const;

const TEMPLATE_PUBLIC_URL =
  process.env.NEXT_PUBLIC_USERS_TEMPLATE_URL ||
  "https://xujejxbzeexqagotdvdi.supabase.co/storage/v1/object/public/assets/utilities/CargaEstudiantesJILIU.xlsx";

const TEMPLATE_BUCKET = process.env.NEXT_PUBLIC_TEMPLATES_BUCKET || "";
const TEMPLATE_PATH = process.env.NEXT_PUBLIC_USERS_TEMPLATE_PATH || "";

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

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<AdminView>("COURSES");

  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [types, setTypes] = useState<EvalType[]>([]);
  const [teachers, setTeachers] = useState<UserMini[]>([]);
  const [students, setStudents] = useState<UserMini[]>([]);
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [groups, setGroups] = useState<GroupMini[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseLevel, setNewCourseLevel] = useState<number>(1);
  const [newCourseYear, setNewCourseYear] = useState<string>("");

  const [newClassName, setNewClassName] = useState("");
  const [newClassLevel, setNewClassLevel] = useState<number>(1);
  const [newClassModuleId, setNewClassModuleId] = useState<string>("");
  const [newClassGroupId, setNewClassGroupId] = useState<string>("");
  const [newModuleName, setNewModuleName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  const [newType, setNewType] = useState("");

  const [selAssignLevel, setSelAssignLevel] = useState<string>("");
  const [selTeacher, setSelTeacher] = useState<string>("");
  const [selClass, setSelClass] = useState<string>("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState<any>(null);

  const [uEmail, setUEmail] = useState("");
  const [uName, setUName] = useState("");
  const [uCedula, setUCedula] = useState("");
  const [uCodeJiliu, setUCodeJiliu] = useState("");
  const [uCourseId, setUCourseId] = useState<string>("");
  const [uRoles, setURoles] = useState<Record<"S" | "T" | "A", boolean>>({
    S: true,
    T: false,
    A: false,
  });
  const [creatingUser, setCreatingUser] = useState(false);

  const [upCedula, setUpCedula] = useState("");
  const [upEmail, setUpEmail] = useState("");
  const [upName, setUpName] = useState("");
  const [upCodeJiliu, setUpCodeJiliu] = useState("");
  const [upCourseId, setUpCourseId] = useState<string>("");
  const [upRoles, setUpRoles] = useState<Record<"S" | "T" | "A", boolean>>({
    S: true,
    T: false,
    A: false,
  });

  const [upLoading, setUpLoading] = useState(false);
  const [upSearching, setUpSearching] = useState(false);
  const lastCedulaFetchedRef = useRef<string>("");
  const searchSeqRef = useRef<number>(0);

  const [templateLoading, setTemplateLoading] = useState(false);

  // ===== UPSERT / CAMBIO DE NOTAS =====
  const [upsertLevelFilter, setUpsertLevelFilter] = useState<number | "">("");
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

  function toggleGrillaSort(key: "cedula" | "name") {
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

  const CEDULA_COL_W = 150;
  const ALUMNO_COL_W = 260;
  const EVAL_COL_W = 170;
  const ACTION_COL_W = 160;
  const STICKY_ALUMNO_LEFT = CEDULA_COL_W;

  function showOk(text: string) {
    setMsg(null);
    setOkMsg(text);
    setTimeout(() => setOkMsg(null), 4500);
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

  async function loadAll() {
    setMsg(null);
    setOkMsg(null);
    setLoadingData(true);
    try {
      const [c1, c2, c3, t1, s1, m1, g1] = await Promise.all([
        apiFetch("/api/admin/courses"),
        apiFetch("/api/admin/classes"),
        apiFetch("/api/admin/evaluation-types"),
        apiFetch("/api/admin/teachers"),
        apiFetch("/api/admin/students"),
        apiFetch("/api/admin/modules"),
        apiFetch("/api/admin/groups"),
      ]);

      setCourses(c1?.items || []);
      setClasses(c2?.items || []);
      setTypes(c3?.items || []);
      setTeachers(t1?.items || []);
      setStudents(s1?.items || []);
      setModules(m1?.items || []);
      setGroups(g1?.items || []);
    } catch (e: any) {
      showErr(e?.message || "Error cargando datos del admin");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (!loadingMe) loadAll();
  }, [loadingMe]);

  const classesForAssign = useMemo(() => {
    if (!selAssignLevel) return [];
    return classes.filter((c) => Number(c.level) === Number(selAssignLevel));
  }, [classes, selAssignLevel]);

  const availableModulesForCreate = useMemo(() => {
    const ids = Array.from(
      new Set(
        classes
          .filter((c) => Number(c.level) === Number(newClassLevel))
          .map((c) => Number(c.id_module))
          .filter((x) => Number.isFinite(x) && x > 0)
      )
    );

    return modules.filter((m) => ids.includes(m.id));
  }, [classes, modules, newClassLevel]);

  const classesByLevelAndModule = useMemo(() => {
    return classes.filter((c) => {
      if (Number(c.level) !== Number(newClassLevel)) return false;
      if (newClassModuleId && Number(c.id_module) !== Number(newClassModuleId)) return false;
      return true;
    });
  }, [classes, newClassLevel, newClassModuleId]);

  const availableGroupsForCreate = useMemo(() => {
    const map = new Map<number, GroupMini>();

    for (const cls of classesByLevelAndModule) {
      for (const grp of cls.groups || []) {
        if (!map.has(grp.id)) {
          map.set(grp.id, grp);
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [classesByLevelAndModule]);

  const classesForCreate = useMemo(() => {
    return classes.filter((c) => {
      if (Number(c.level) !== Number(newClassLevel)) return false;
      if (newClassModuleId && Number(c.id_module) !== Number(newClassModuleId)) return false;
      if (newClassGroupId) {
        const hasGroup = (c.groups || []).some((g) => Number(g.id) === Number(newClassGroupId));
        if (!hasGroup) return false;
      }
      return true;
    });
  }, [classes, newClassLevel, newClassModuleId, newClassGroupId]);

  const availableLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of classes) {
      if (Number.isFinite(Number(c.level))) set.add(Number(c.level));
    }
    return [...set].sort((a, b) => a - b);
  }, [classes]);

  const upsertClassesFiltered = useMemo(() => {
    if (upsertLevelFilter === "") return [];
    return classes.filter((c) => Number(c.level) === Number(upsertLevelFilter));
  }, [classes, upsertLevelFilter]);

  const selectedUpsertClass = useMemo(() => {
    if (upsertClassFilter === "all") return null;
    return classes.find((c) => c.id === Number(upsertClassFilter)) || null;
  }, [upsertClassFilter, classes]);

  const upsertDynamicMinWidth = useMemo(() => {
    const cedulaW = 170;
    const alumnoW = 320;
    const evalW = 120;
    const actionW = 180;

    return cedulaW + alumnoW + actionW + gEvaluations.length * evalW;
  }, [gEvaluations.length]);

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

  useEffect(() => {
    if (view !== "UPDATE_USER") return;

    const ced = upCedula.trim();

    if (!ced) {
      lastCedulaFetchedRef.current = "";
      setUpSearching(false);
      setUpEmail("");
      setUpName("");
      setUpCodeJiliu("");
      setUpCourseId("");
      setUpRoles({ S: true, T: false, A: false });
      return;
    }

    if (ced.length < 5) return;

    const seq = ++searchSeqRef.current;

    const t = setTimeout(async () => {
      if (lastCedulaFetchedRef.current === ced) return;

      setUpSearching(true);
      try {
        const res = await apiFetch(
          `/api/admin/user-by-cedula?cedula=${encodeURIComponent(ced)}`
        );

        if (seq !== searchSeqRef.current) return;

        const item = res?.item;
        if (!item?.id) throw new Error("Usuario no encontrado");

        lastCedulaFetchedRef.current = ced;

        setUpEmail(item.email || "");
        setUpName(item.name || "");
        setUpCodeJiliu(item.code_jiliu || "");
        setUpCourseId(item.id_course ? String(item.id_course) : "");

        const roleSet = new Set(
          (item.roles || []).map((x: string) => String(x).toUpperCase())
        );
        setUpRoles({
          S: roleSet.has("S"),
          T: roleSet.has("T"),
          A: roleSet.has("A"),
        });

        setMsg(null);
        setOkMsg("✅ Usuario cargado. Ya puedes editar.");
        setTimeout(() => setOkMsg(null), 2500);
      } catch (e: any) {
        if (seq !== searchSeqRef.current) return;

        lastCedulaFetchedRef.current = "";
        setUpEmail("");
        setUpName("");
        setUpCodeJiliu("");
        setUpCourseId("");
        setUpRoles({ S: true, T: false, A: false });

        setOkMsg(null);
        setMsg(e?.message || "No se pudo cargar el usuario");
      } finally {
        if (seq === searchSeqRef.current) setUpSearching(false);
      }
    }, 450);

    return () => clearTimeout(t);
  }, [upCedula, view]);

  useEffect(() => {
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});
    setUpsertClassFilter("all");
  }, [upsertLevelFilter]);

  useEffect(() => {
    setGridClassInfo(null);
    setGEvaluations([]);
    setGRoster([]);
    setGGrades([]);
    setGradeDraft({});
    setEditingRow({});
    setRowSnapshot({});
  }, [upsertClassFilter]);

  async function createCourse() {
    const name = newCourseName.trim();
    if (!name) return showErr("Nombre del course requerido.");

    try {
      await apiFetch("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify({
          name,
          level: newCourseLevel,
          year: newCourseYear ? newCourseYear : null,
        }),
      });
      setNewCourseName("");
      setNewCourseYear("");
      showOk("✅ Course creado");
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error creando course");
    }
  }

  async function createClass() {
    const name = newClassName.trim();

    const isOtherModule = newClassModuleId === OTHER_OPTION;
    const isOtherGroup = newClassGroupId === OTHER_OPTION;

    const id_module = !isOtherModule ? Number(newClassModuleId || "0") : 0;
    const id_group = !isOtherGroup ? Number(newClassGroupId || "0") : 0;

    const new_module_name = isOtherModule ? newModuleName.trim() : "";
    const new_group_name = isOtherGroup ? newGroupName.trim() : "";

    if (!name) return showErr("Nombre de la materia requerido.");

    if (!newClassModuleId) {
      return showErr("Debes seleccionar un módulo.");
    }

    if (isOtherModule && !new_module_name) {
      return showErr("Debes escribir el nombre del nuevo módulo.");
    }

    if (isOtherGroup && !new_group_name) {
      return showErr("Debes escribir el nombre del nuevo grupo.");
    }

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

      showOk("✅ Materia creada");
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error creando materia");
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
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error creando tipo");
    }
  }

  async function assignTeacher() {
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
    } catch (e: any) {
      showErr(e?.message || "Error asignando teacher");
    }
  }

  function rolesFromState(state: Record<"S" | "T" | "A", boolean>) {
    return (Object.entries(state) as Array<[string, boolean]>)
      .filter(([, v]) => v)
      .map(([k]) => k) as Array<"S" | "T" | "A">;
  }

  function resetManualUserForm() {
    setUEmail("");
    setUName("");
    setUCedula("");
    setUCodeJiliu("");
    setUCourseId("");
    setURoles({ S: true, T: false, A: false });
  }

  function resetUpdateUserForm() {
    lastCedulaFetchedRef.current = "";
    searchSeqRef.current++;
    setUpCedula("");
    setUpEmail("");
    setUpName("");
    setUpCodeJiliu("");
    setUpCourseId("");
    setUpRoles({ S: true, T: false, A: false });
    setUpSearching(false);
  }

  async function createUserManual() {
    setUploadReport(null);
    const email = uEmail.trim().toLowerCase();
    const name = uName.trim();
    const cedula = uCedula.trim();
    const code_jiliu = uCodeJiliu.trim();
    const id_course = Number(uCourseId || "0");
    const roles = rolesFromState(uRoles);

    if (!email || !email.includes("@")) return showErr("Email inválido.");
    if (!name) return showErr("Nombre requerido.");
    if (!cedula) return showErr("Cédula requerida.");
    if (roles.length === 0) return showErr("Selecciona al menos 1 rol (S/T/A).");
    if (roles.includes("S") && !code_jiliu) {
      return showErr("Debes seleccionar un course.");
    } else if (roles.includes("S") && !id_course) {
      return showErr("code_jiliu requerido.");
    }

    setCreatingUser(true);
    try {
      await apiFetch("/api/admin/create-user", {
        method: "POST",
        body: JSON.stringify({
          email,
          name,
          roles,
          cedula,
          code_jiliu,
          id_course,
        }),
      });

      showOk("✅ Usuario creado/actualizado");
      resetManualUserForm();
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error creando usuario");
    } finally {
      setCreatingUser(false);
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
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error procesando excel");
    } finally {
      setUploading(false);
    }
  }

  async function updateUserByCedula() {
    const cedula = upCedula.trim();
    const email = upEmail.trim().toLowerCase();
    const name = upName.trim();
    const code_jiliu = upCodeJiliu.trim();
    const id_course = Number(upCourseId || "0");
    const roles = rolesFromState(upRoles);

    if (!cedula) return showErr("Cédula requerida para buscar el usuario.");
    if (!email || !email.includes("@")) return showErr("Email inválido.");
    if (!name) return showErr("Nombre requerido.");
    if (roles.length === 0) return showErr("Selecciona al menos 1 rol (S/T/A).");
    if (roles.includes("S") && !code_jiliu) {
      return showErr("Debes seleccionar un course.");
    } else if (roles.includes("S") && !id_course) {
      return showErr("code_jiliu requerido.");
    }

    setUpLoading(true);
    try {
      const res = await apiFetch("/api/admin/update-user-by-cedula", {
        method: "POST",
        body: JSON.stringify({
          cedula,
          email,
          name,
          code_jiliu,
          id_course,
          roles,
        }),
      });

      if (res?.warn) {
        showOk("✅ Usuario actualizado (con advertencia)");
        setMsg(`⚠️ ${res.warn}`);
      } else {
        showOk("✅ Usuario actualizado por cédula");
      }

      resetUpdateUserForm();
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error actualizando usuario");
    } finally {
      setUpLoading(false);
    }
  }

  async function downloadTemplate() {
    setMsg(null);
    setOkMsg(null);

    const hasPublic = TEMPLATE_PUBLIC_URL && !TEMPLATE_PUBLIC_URL.includes("REEMPLAZA_AQUI");
    if (hasPublic) {
      window.open(TEMPLATE_PUBLIC_URL, "_blank", "noopener,noreferrer");
      return;
    }

    if (!TEMPLATE_BUCKET || !TEMPLATE_PATH) {
      return showErr(
        "Falta configurar NEXT_PUBLIC_USERS_TEMPLATE_URL (pública) o bucket/path para signed URL."
      );
    }

    setTemplateLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from(TEMPLATE_BUCKET)
        .createSignedUrl(TEMPLATE_PATH, 120);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || "No se pudo generar signed URL");
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      showErr(e?.message || "Error descargando plantilla");
    } finally {
      setTemplateLoading(false);
    }
  }

  async function loadGradeGrid() {
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

      const res: GradeGridResponse = await apiFetch(
        `/api/admin/class-grade-grid?class_id=${Number(upsertClassFilter)}`
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

      flash(`✅ Notas guardadas: ${student.name}`, "ok");
    } catch (e: any) {
      setMsg(e?.message || `Error guardando notas de ${student.name}`);
      flash(`❌ Error guardando: ${student.name}`, "err");
    } finally {
      setSavingOne((prev) => ({ ...prev, [student.id]: false }));
    }
  }

  function downloadExcel() {
    const materia = gridClassInfo?.name ?? selectedUpsertClass?.name ?? "Grilla";
    const rows = sortedRoster.map((st) => {
      const row: Record<string, string | number> = {
        Cédula: st.cedula,
        Alumno: st.name,
      };
      for (const ev of gEvaluations) {
        const label = getEvaluationColumnLabel(ev);
        if (!isEvaluationApplicableToStudent(st, ev)) {
          row[label] = "N/A";
          continue;
        }
        const gradeRecord = gGrades.find(
          (g) => g.id_student === st.id && g.id_exam === ev.id
        );
        const attempts = gradeRecord?.attempts ?? 0;
        if (attempts === 0) {
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
    XLSX.writeFile(wb, `${materia}.xlsx`);
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
          apiFetch("/api/admin/grades", {
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
              <div style={{ fontSize: 18 }}>SOFIA · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Panel Admin</div>
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
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>¿Qué quieres hacer?</div>
            </div>

            <div
              style={{
                minWidth: 320,
                padding: 10,
              }}
            >
              <select
                className="select"
                value={view}
                onChange={(e) => setView(e.target.value as AdminView)}
              >
                <option value="COURSES">Crear un Curso</option>
                <option value="CLASSES">Crear una Materia</option>
                <option value="TYPES">Crear un tipo de Evaluación</option>
                <option value="ASSIGN_TEACHER">Asignar Materias a un Profesor</option>
                <option value="USERS">Crear Persona</option>
                <option value="UPDATE_USER">Actualizar Persona</option>
                <option value="UPSERT">Gestionar Notas de Estudiantes</option>
              </select>
            </div>
          </div>

          {msg && <div className="msgError" style={{ marginTop: 12 }}>{msg}</div>}
          {okMsg && <div className="msgOk" style={{ marginTop: 12 }}>{okMsg}</div>}

          {view === "COURSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear un Curso</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 12 }}>
                <div>
                  <div className="label">Nombre</div>
                  <input
                    className="input"
                    value={newCourseName}
                    onChange={(e) => setNewCourseName(e.target.value)}
                    placeholder="Ej: Primer año - Curso1"
                  />
                </div>

                <div>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={newCourseLevel}
                    onChange={(e) => setNewCourseLevel(Number(e.target.value))}
                  >
                    {LEVELS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Year (opcional)</div>
                  <input
                    className="input"
                    type="date"
                    value={newCourseYear}
                    onChange={(e) => setNewCourseYear(e.target.value)}
                  />
                </div>
              </div>

              <button className="btn" onClick={createCourse} style={{ marginTop: 12, width: "100%" }}>
                Crear course
              </button>

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
                      <th style={{ textAlign: "left", padding: 12 }}>Course</th>
                      <th style={{ textAlign: "left", padding: 12, width: 110 }}>Nivel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingData ? "Cargando..." : "Sin courses"}
                        </td>
                      </tr>
                    ) : (
                      courses.map((c) => (
                        <tr key={c.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: 12 }}>{c.level}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "CLASSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear una Materia</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="label">Nivel</div>
                  <select
                    className="select"
                    value={newClassLevel}
                    onChange={(e) => setNewClassLevel(Number(e.target.value))}
                  >
                    {LEVELS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Módulo</div>
                  <select
                    className="select"
                    value={newClassModuleId}
                    onChange={(e) => setNewClassModuleId(e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    {availableModulesForCreate.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.name}
                      </option>
                    ))}
                    <option value={OTHER_OPTION}>Otro...</option>
                  </select>

                  {newClassModuleId === OTHER_OPTION && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        value={newModuleName}
                        onChange={(e) => setNewModuleName(e.target.value)}
                        placeholder="Nombre del nuevo módulo"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <div className="label">Nombre</div>
                  <input
                    className="input"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="Ej: ETM - Nivel 1"
                  />
                </div>

                <div>
                  <div className="label">Grupo (opcional)</div>
                  <select
                    className="select"
                    value={newClassGroupId}
                    onChange={(e) => setNewClassGroupId(e.target.value)}
                    disabled={!newClassModuleId}
                  >
                    <option value="">
                      {!newClassModuleId ? "Selecciona un módulo primero" : "Sin grupo"}
                    </option>
                    {availableGroupsForCreate.map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name}
                      </option>
                    ))}
                    <option value={OTHER_OPTION}>Otro...</option>
                  </select>

                  {newClassGroupId === OTHER_OPTION && (
                    <div style={{ marginTop: 8 }}>
                      <input
                        className="input"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Nombre del nuevo grupo"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button className="btn" onClick={createClass} style={{ marginTop: 12, width: "100%" }}>
                Crear materia
              </button>

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
                      <th style={{ textAlign: "left", padding: 12 }}>Materia</th>
                      <th style={{ textAlign: "left", padding: 12, width: 90 }}>Nivel</th>
                      <th style={{ textAlign: "left", padding: 12 }}>Módulo</th>
                      <th style={{ textAlign: "left", padding: 12 }}>Grupos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classesForCreate.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingData ? "Cargando..." : "Sin materias"}
                        </td>
                      </tr>
                    ) : (
                      classesForCreate.map((c) => (
                        <tr key={c.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 500 }}>{c.name}</td>
                          <td style={{ padding: 12 }}>{c.level}</td>
                          <td style={{ padding: 12 }}>{c.module_name || "—"}</td>
                          <td style={{ padding: 12 }}>
                            {c.groups?.length
                              ? c.groups.map((g) => g.name).join(", ")
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "TYPES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear un tipo de evaluación</h2>

              <div>
                <div className="label">Tipo</div>
                <input
                  className="input"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="Ej: Quiz, Parcial, Final..."
                />
              </div>

              <button className="btn" onClick={createEvalType} style={{ marginTop: 12, width: "100%" }}>
                Crear tipo
              </button>

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
                      <th style={{ textAlign: "left", padding: 12 }}>Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingData ? "Cargando..." : "Sin tipos"}
                        </td>
                      </tr>
                    ) : (
                      types.map((t) => (
                        <tr key={t.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 500 }}>{t.type}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "ASSIGN_TEACHER" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Asignar Materias a un Profesor</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <div className="label">Level / Año</div>
                  <select
                    className="select"
                    value={selAssignLevel}
                    onChange={(e) => setSelAssignLevel(e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    {LEVELS.map((lvl) => (
                      <option key={lvl.value} value={String(lvl.value)}>
                        {lvl.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Teacher</div>
                  <select
                    className="select"
                    value={selTeacher}
                    onChange={(e) => setSelTeacher(e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={selClass}
                    onChange={(e) => setSelClass(e.target.value)}
                    disabled={!selAssignLevel}
                  >
                    <option value="">
                      {!selAssignLevel ? "Selecciona un level primero" : "Selecciona..."}
                    </option>
                    {classesForAssign.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button className="btn" onClick={assignTeacher} style={{ marginTop: 12, width: "100%" }}>
                Asignar
              </button>
            </div>
          )}

          {view === "USERS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear Persona</h2>

              <div
                style={{
                  marginTop: 10,
                  padding: 14,
                  borderRadius: 18,
                  border: "1px solid var(--stroke)",
                  background: "rgba(34,197,94,.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 900 }}>Plantilla Excel</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    Descárgala para cargar personas correctamente.
                  </div>
                </div>
                <button className="btn" onClick={downloadTemplate} disabled={templateLoading}>
                  {templateLoading ? "Generando..." : "⬇️ Descargar plantilla"}
                </button>
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 18,
                  border: "1px solid var(--stroke)",
                  background: "rgba(14,165,233,.06)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 16 }}>Crear usuario manual (1)</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  Todos los campos son obligatorios (incluye course).
                </div>

                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="label">Email</div>
                    <input className="input" value={uEmail} onChange={(e) => setUEmail(e.target.value)} />
                  </div>

                  <div>
                    <div className="label">Nombre</div>
                    <input className="input" value={uName} onChange={(e) => setUName(e.target.value)} />
                  </div>

                  <div>
                    <div className="label">Cédula</div>
                    <input className="input" value={uCedula} onChange={(e) => setUCedula(e.target.value)} />
                  </div>

                  <div>
                    <div className="label">code_jiliu</div>
                    <input
                      className="input"
                      value={uCodeJiliu}
                      onChange={(e) => setUCodeJiliu(e.target.value)}
                    />
                  </div>

                  <div style={{ gridColumn: "1 / span 2" }}>
                    <div className="label">Course</div>
                    <select className="select" value={uCourseId} onChange={(e) => setUCourseId(e.target.value)}>
                      <option value="">Selecciona...</option>
                      {courses.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name} (Nivel {c.level})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ gridColumn: "1 / span 2" }}>
                    <div className="label">Roles</div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {ROLE_OPTIONS.map((r) => (
                        <label
                          key={r.value}
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: "1px solid var(--stroke)",
                            background: "var(--card)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!uRoles[r.value]}
                            onChange={(e) => setURoles((p) => ({ ...p, [r.value]: e.target.checked }))}
                          />
                          <span style={{ fontWeight: 900 }}>{r.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                  <button className="btn" onClick={createUserManual} disabled={creatingUser} style={{ width: 240 }}>
                    {creatingUser ? "Creando..." : "Crear"}
                  </button>
                  <button type="button" className="btnLight" onClick={() => resetManualUserForm()}>
                    Limpiar
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Subir Excel: Crear Personas</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                  Columnas obligatorias: <b>email</b>, <b>name</b>, <b>cedula</b>, <b>code_jiliu</b>, <b>id_course</b>, <b>type</b> (S/T/A o lista S,T).
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
                  <input ref={fileRef} type="file" accept=".xlsx" />
                  <button className="btn" onClick={uploadExcelUsers} disabled={uploading} style={{ width: 220 }}>
                    {uploading ? "Subiendo..." : "Procesar Excel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadReport(null);
                      setMsg(null);
                      setOkMsg(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="btnLight"
                  >
                    Limpiar
                  </button>
                </div>

                {uploadReport && (
                  <div
                    style={{
                      marginTop: 12,
                      overflow: "hidden",
                      borderRadius: 18,
                      border: "1px solid var(--stroke)",
                    }}
                  >
                    <div style={{ padding: 12, fontWeight: 900, background: "rgba(14,165,233,.08)" }}>
                      Resultado
                    </div>
                    <div style={{ padding: 12 }}>
                      <div style={{ fontWeight: 900 }}>Creados: {uploadReport.created}</div>
                      <div style={{ fontWeight: 900 }}>Actualizados: {uploadReport.updated}</div>
                      <div style={{ fontWeight: 900 }}>Saltados: {uploadReport.skipped}</div>

                      {Array.isArray(uploadReport.errors) && uploadReport.errors.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 900, color: "#b91c1c" }}>Errores:</div>
                          <ul style={{ marginTop: 6 }}>
                            {uploadReport.errors.slice(0, 25).map((x: any, idx: number) => (
                              <li key={idx} style={{ color: "#b91c1c", fontWeight: 700 }}>
                                Fila {x.row}: {x.error}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "UPDATE_USER" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Actualizar Persona</h2>

              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                Digita la cédula y el sistema te carga los datos para modificarlos.
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Cédula a actualizar</div>
                  <input className="input" value={upCedula} onChange={(e) => setUpCedula(e.target.value)} />
                  {upSearching && (
                    <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                      Buscando usuario...
                    </div>
                  )}
                </div>

                <div>
                  <div className="label">Email</div>
                  <input className="input" value={upEmail} onChange={(e) => setUpEmail(e.target.value)} />
                </div>

                <div>
                  <div className="label">Nombre</div>
                  <input className="input" value={upName} onChange={(e) => setUpName(e.target.value)} />
                </div>

                <div>
                  <div className="label">code_jiliu</div>
                  <input className="input" value={upCodeJiliu} onChange={(e) => setUpCodeJiliu(e.target.value)} />
                </div>

                <div>
                  <div className="label">Course</div>
                  <select className="select" value={upCourseId} onChange={(e) => setUpCourseId(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {courses.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} (Nivel {c.level})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Roles</div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {ROLE_OPTIONS.map((r) => (
                      <label
                        key={r.value}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          padding: "10px 12px",
                          borderRadius: 14,
                          border: "1px solid var(--stroke)",
                          background: "var(--card)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!upRoles[r.value]}
                          onChange={(e) => setUpRoles((p) => ({ ...p, [r.value]: e.target.checked }))}
                        />
                        <span style={{ fontWeight: 900 }}>{r.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={updateUserByCedula}
                  disabled={upLoading || upSearching}
                  style={{ width: 260 }}
                >
                  {upLoading ? "Actualizando..." : "Actualizar"}
                </button>
                <button type="button" className="btnLight" onClick={() => resetUpdateUserForm()}>
                  Limpiar
                </button>
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
                  <h2 style={{ margin: 0 }}>Subir nota manual</h2>
                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                    Grilla de notas estilo hoja de cálculo para todas las materias.
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
                            <col key={`${ev.id}-grade`} style={{ width: `120px` }} />
                          ))}
                          <col style={{ width: `${ACTION_COL_W}px` }} />
                        </colgroup>

                        <thead>
                          <tr>
                            <th
                              onClick={() => toggleGrillaSort("cedula")}
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
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                            >
                              Cédula {grillaSortKey === "cedula" ? (grillaSortDir === "asc" ? "▲" : "▼") : ""}
                            </th>

                            <th
                              onClick={() => toggleGrillaSort("name")}
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
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                            >
                              Alumno {grillaSortKey === "name" ? (grillaSortDir === "asc" ? "▲" : "▼") : ""}
                            </th>

                            {gEvaluations.map((ev) => (
                              <th
                                key={`${ev.id}-grade`}
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
                            sortedRoster.map((st, rowIndex) => {
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

                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          className="btnLight"
                          onClick={downloadExcel}
                          style={{
                            background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
                            border: "1px solid rgba(34,197,94,.8)",
                          }}
                        >
                          Descargar en Excel
                        </button>
                        <button
                          type="button"
                          className="btnLight"
                          onClick={saveAll}
                          disabled={savingAll}
                        >
                          {savingAll ? "Guardando..." : "Guardar toda la grilla"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer  />
    </div>
  );
}