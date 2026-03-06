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
};

type ExamGradeRow = {
  id_student: string;
  grade: number | null;
};

type TeacherView = "EVALS" | "CREATE" | "UPSERT";
type LevelValue = number | "all" | "";

export default function TeacherPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // panel
  const [view, setView] = useState<TeacherView>("EVALS");

  const [items, setItems] = useState<EvalItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // materias asignadas
  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  // ===== FILTROS POR PANEL =====
  // EVALS
  const [evalLevelFilter, setEvalLevelFilter] = useState<LevelValue>("all");
  const [evalClassFilter, setEvalClassFilter] = useState<number | "all">("all");

  // CREATE
  const [createLevelFilter, setCreateLevelFilter] = useState<LevelValue>("");
  const [createClassFilter, setCreateClassFilter] = useState<number | "all">("all");

  // UPSERT
  const [upsertLevelFilter, setUpsertLevelFilter] = useState<LevelValue>("");
  const [upsertClassFilter, setUpsertClassFilter] = useState<number | "all">("all");

  // cursos por materia (dropdown de CREATE)
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

  // subir notas
  const [gExamId, setGExamId] = useState<string>("");
  const [gRoster, setGRoster] = useState<StudentRow[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);

  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  // editar porcentajes en evaluaciones
  const [percentDraft, setPercentDraft] = useState<Record<number, string>>({});
  const [savingPercents, setSavingPercents] = useState(false);

  // toast
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);

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

  async function loadCoursesForClass(classId: number) {
    setLoadingCourses(true);
    setCourses([]);
    setCCourse("");
    try {
      const res = await apiFetch(`/api/teacher/courses?class_id=${classId}`);
      setCourses(res?.items || []);
    } catch (e: any) {
      setCourses([]);
      setMsg(e?.message || "Error cargando cursos para la materia");
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
      loadTypes();
      loadEvaluations();
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
  const createClassesFiltered = useMemo(() => {
    if (createLevelFilter === "") return [];
    if (createLevelFilter === "all") return myClasses;
    return myClasses.filter((c) => Number(c.level) === Number(createLevelFilter));
  }, [myClasses, createLevelFilter]);

  useEffect(() => {
    setCreateClassFilter("all");
    setCourses([]);
    setCCourse("");
    setTitlePick("");
    setTitleOther("");
    setCType("");
    setCTypeOther("");
    setCPercent(30);
  }, [createLevelFilter]);

  useEffect(() => {
    setCourses([]);
    setCCourse("");
    setTitlePick("");
    setTitleOther("");
    setCPercent(30);

    if (createClassFilter !== "all") {
      loadCoursesForClass(Number(createClassFilter));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleCreate() {
    setMsg(null);

    if (createLevelFilter === "" || createLevelFilter === "all") {
      setMsg("Selecciona un level primero.");
      return;
    }

    if (createClassFilter === "all") {
      setMsg("Selecciona una materia.");
      return;
    }

    const id_class = Number(createClassFilter);

    const id_course = Number(cCourse);
    if (!id_course) return setMsg("Selecciona un curso.");

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

      setCCourse("");
      setCType("");
      setCTypeOther("");
      setTitlePick("");
      setTitleOther("");
      setCPercent(30);

      flash("✅ Evaluación creada", "ok");
      await loadEvaluations();
      setView("EVALS");

      // opcional: dejar sincronizado el filtro del panel de evaluaciones
      setEvalLevelFilter(Number(createLevelFilter));
      setEvalClassFilter(Number(createClassFilter));
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
    setUpsertClassFilter("all");
    setGExamId("");
    setGRoster([]);
    setGradeDraft({});
  }, [upsertLevelFilter]);

  useEffect(() => {
    setGExamId("");
    setGRoster([]);
    setGradeDraft({});
  }, [upsertClassFilter]);

  const upsertEvalOptions = useMemo(() => {
    let list = [...items];

    if (upsertLevelFilter !== "" && upsertLevelFilter !== "all") {
      list = list.filter((e) => Number(e.class?.level ?? 0) === Number(upsertLevelFilter));
    }

    if (upsertClassFilter !== "all") {
      list = list.filter((e) => e.id_class === Number(upsertClassFilter));
    } else {
      list = [];
    }

    return list;
  }, [items, upsertLevelFilter, upsertClassFilter]);

  const selectedEval = useMemo(() => {
    const id = Number(gExamId);
    if (!id) return null;
    return items.find((x) => x.id === id) || null;
  }, [gExamId, items]);

  async function loadRosterAndGrades() {
    setMsg(null);
    setGLoadingRoster(true);
    setGRoster([]);
    setGradeDraft({});

    try {
      if (!selectedEval?.id_course) return;

      const rosterRes = await apiFetch(
        `/api/teacher/course-students?course_id=${selectedEval.id_course}`
      );
      const roster: StudentRow[] = rosterRes?.items || [];
      setGRoster(roster);

      const gradesRes = await apiFetch(`/api/teacher/exam-grades?exam_id=${selectedEval.id}`);
      const existing: ExamGradeRow[] = gradesRes?.items || [];

      const mapExisting = new Map<string, number>();
      for (const r of existing) {
        if (r?.id_student) {
          mapExisting.set(r.id_student, r.grade === null ? NaN : Number(r.grade));
        }
      }

      const drafts: Record<string, string> = {};
      for (const st of roster) {
        const g = mapExisting.get(st.id);
        drafts[st.id] = Number.isFinite(g as any) ? String(g) : "";
      }
      setGradeDraft(drafts);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando alumnos/notas");
      setGRoster([]);
      setGradeDraft({});
    } finally {
      setGLoadingRoster(false);
    }
  }

  useEffect(() => {
    if (!selectedEval) {
      setGRoster([]);
      setGradeDraft({});
      return;
    }
    loadRosterAndGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEval?.id]);

  async function saveOne(student: StudentRow) {
    if (!selectedEval?.id) return;

    const draft = (gradeDraft[student.id] ?? "").trim();
    const grade = draft === "" ? NaN : Number(draft);

    if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
      setMsg(`Nota inválida para ${student.name} (0..100)`);
      flash("❌ Nota inválida", "err");
      return;
    }

    setSavingOne((prev) => ({ ...prev, [student.id]: true }));
    setMsg(null);

    try {
      await apiFetch("/api/teacher/grades", {
        method: "POST",
        body: JSON.stringify({
          exam_id: selectedEval.id,
          student_cedula: student.cedula,
          grade,
        }),
      });

      flash(`✅ Nota guardada: ${student.name}`, "ok");
    } catch (e: any) {
      setMsg(e?.message || `Error guardando nota de ${student.name}`);
      flash(`❌ Error guardando: ${student.name}`, "err");
    } finally {
      setSavingOne((prev) => ({ ...prev, [student.id]: false }));
    }
  }

  async function saveAll() {
    if (!selectedEval?.id) return;
    setSavingAll(true);
    setMsg(null);

    try {
      for (const st of gRoster) {
        const v = (gradeDraft[st.id] ?? "").trim();
        const n = v === "" ? NaN : Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw new Error(`Nota inválida para ${st.name} (0..100)`);
        }
      }

      await Promise.all(
        gRoster.map((st) =>
          apiFetch("/api/teacher/grades", {
            method: "POST",
            body: JSON.stringify({
              exam_id: selectedEval.id,
              student_cedula: st.cedula,
              grade: Number(gradeDraft[st.id]),
            }),
          })
        )
      );

      flash("✅ Notas actualizadas para todo el curso", "ok");
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

      {/* HAMBURGUESA */}
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

        <div style={{ marginTop: 10 }}>
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
              <div style={{ fontWeight: 900, fontSize: 18 }}>JILIU · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Panel Teacher</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="btnLight" style={{ padding: "8px 12px", borderRadius: 999 }}>
                {roleLabel} · {me?.user?.email}
              </div>
            </div>
          </div>

          {/* SELECTOR DE SECCIÓN */}
          <div
            className="card"
            style={{
              marginTop: 14,
              padding: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Sección</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                Elige qué panel quieres ver.
              </div>
            </div>

            <div style={{ minWidth: 260 }}>
              <select
                className="select"
                value={view}
                onChange={(e) => setView(e.target.value as TeacherView)}
              >
                <option value="EVALS">Mis evaluaciones</option>
                <option value="CREATE">Crear evaluación</option>
                <option value="UPSERT">Subir nota manual</option>
              </select>
            </div>
          </div>

          {msg && (
            <div className="msgError" style={{ marginTop: 12 }}>
              {msg}
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
                    <option value="all">Todos mis levels</option>
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
                    value={evalClassFilter}
                    onChange={(e) =>
                      setEvalClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                  >
                    <option value="all">
                      {evalLevelFilter === "all"
                        ? "Todas mis materias"
                        : "Todas las materias del level"}
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
                      <th style={{ textAlign: "left", padding: 12 }}>Título</th>
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
                            <td style={{ padding: 12, fontWeight: 600 }}>{e.title}</td>

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
                {/* LEVEL */}
                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Año</div>
                  <select
                    className="select"
                    value={String(createLevelFilter)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCreateLevelFilter(v === "" ? "" : Number(v));
                    }}
                  >
                    <option value="">Selecciona un level</option>
                    {availableLevels.map((lvl) => (
                      <option key={lvl} value={String(lvl)}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>

                {/* MATERIA */}
                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Materia</div>
                  <select
                    className="select"
                    value={createClassFilter}
                    onChange={(e) =>
                      setCreateClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                    disabled={createLevelFilter === ""}
                  >
                    <option value="all">
                      {createLevelFilter === "" ? "Selecciona un level primero" : "Selecciona una materia"}
                    </option>
                    {createClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* CURSO */}
                <div style={{ gridColumn: "1 / span 2" }}>
                  <div className="label">Curso</div>
                  <select
                    className="select"
                    value={cCourse}
                    onChange={(e) => setCCourse(e.target.value)}
                    disabled={createClassFilter === "all" || loadingCourses}
                  >
                    <option value="">
                      {createClassFilter === "all"
                        ? "Selecciona una materia primero"
                        : loadingCourses
                        ? "Cargando cursos..."
                        : "Selecciona..."}
                    </option>
                    {courses.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* TIPO */}
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

                {/* TÍTULO */}
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

                {/* % */}
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
            <div className="card" style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Subir nota manual (upsert)</h2>

                <button
                  className="btn"
                  onClick={saveAll}
                  disabled={savingAll || !selectedEval || gRoster.length === 0}
                  style={{ width: 220 }}
                >
                  {savingAll ? "Actualizando..." : "Actualizar todos"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
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
                    <option value="">Selecciona un level</option>
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
                      setUpsertClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))
                    }
                    disabled={upsertLevelFilter === ""}
                  >
                    <option value="all">
                      {upsertLevelFilter === "" ? "Selecciona un level primero" : "Selecciona una materia"}
                    </option>
                    {upsertClassesFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Evaluación</div>
                  <select
                    className="select"
                    value={gExamId}
                    onChange={(e) => setGExamId(e.target.value)}
                    disabled={upsertClassFilter === "all"}
                  >
                    <option value="">
                      {upsertClassFilter === "all" ? "Selecciona una materia primero" : "Selecciona..."}
                    </option>
                    {upsertEvalOptions.map((e) => (
                      <option key={e.id} value={String(e.id)}>
                        #{e.id} · {e.title} ({Number(e.percent).toFixed(0)}%) ·{" "}
                        {e.course?.name ?? `Curso ${e.id_course}`}
                      </option>
                    ))}
                  </select>

                  <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
                    * Solo aparecen evaluaciones de la materia seleccionada.
                  </div>
                </div>
              </div>

              {!selectedEval ? (
                <div style={{ marginTop: 12, color: "var(--muted)" }}>
                  Selecciona una evaluación para cargar el curso y alumnos.
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 12,
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>
                      Curso: {selectedEval.course?.name ?? `ID ${selectedEval.id_course}`} · Materia:{" "}
                      {selectedEval.class?.name ?? `ID ${selectedEval.id_class}`}
                    </div>
                    <button type="button" onClick={loadRosterAndGrades} className="btnLight">
                      {gLoadingRoster ? "Cargando..." : "Refrescar lista"}
                    </button>
                  </div>

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
                          <th style={{ textAlign: "left", padding: 12, width: 130 }}>Cédula</th>
                          <th style={{ textAlign: "left", padding: 12 }}>Alumno</th>
                          <th style={{ textAlign: "left", padding: 12, width: 160 }}>Nota (0..100)</th>
                          <th style={{ textAlign: "left", padding: 12, width: 180 }}></th>
                        </tr>
                      </thead>

                      <tbody>
                        {gLoadingRoster ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                              Cargando alumnos y notas...
                            </td>
                          </tr>
                        ) : gRoster.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                              No se encontraron alumnos para este curso.
                            </td>
                          </tr>
                        ) : (
                          gRoster.map((st) => (
                            <tr key={st.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                              <td style={{ padding: 12, fontWeight: 500 }}>{st.cedula}</td>
                              <td style={{ padding: 12, fontWeight: 600 }}>{st.name}</td>
                              <td style={{ padding: 12 }}>
                                <input
                                  className="input"
                                  inputMode="numeric"
                                  value={gradeDraft[st.id] ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "") {
                                      return setGradeDraft((p) => ({ ...p, [st.id]: "" }));
                                    }
                                    if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) return;
                                    setGradeDraft((p) => ({ ...p, [st.id]: v }));
                                  }}
                                  placeholder="—"
                                />
                              </td>
                              <td style={{ padding: 12 }}>
                                <button
                                  className="btn"
                                  onClick={() => saveOne(st)}
                                  disabled={!!savingOne[st.id] || savingAll}
                                  style={{ width: "100%" }}
                                >
                                  {savingOne[st.id] ? "Actualizando..." : "Actualizar"}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
                    Tip: si un alumno ya tenía nota, el textbox aparece precargado. Puedes editar y guardar
                    uno por uno o “Actualizar todos”.
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