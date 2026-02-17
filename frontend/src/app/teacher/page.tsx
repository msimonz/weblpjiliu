"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";

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
  id: string; // uuid en users
  name: string;
  cedula: string;
};

type ExamGradeRow = {
  id_student: string;
  grade: number | null;
};

export default function TeacherPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  const [items, setItems] = useState<EvalItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ materias asignadas + filtro
  const [myClasses, setMyClasses] = useState<TeacherClass[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [classFilter, setClassFilter] = useState<number | "all">("all");

  // ✅ cursos por materia (dropdown)
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);

  // ✅ tipos (dropdown + Otro)
  const [types, setTypes] = useState<EvalTypeItem[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // ✅ título (dropdown + Otro) basado en títulos ya usados en esa materia
  const [titlePick, setTitlePick] = useState<string>(""); // "" => Selecciona..., "__other__" => Otro
  const [titleOther, setTitleOther] = useState<string>("");

  // crear evaluación
  const [cCourse, setCCourse] = useState<string>(""); // id_course
  const [cType, setCType] = useState<string>(""); // id_type | "__other__"
  const [cTypeOther, setCTypeOther] = useState<string>("");
  const [cPercent, setCPercent] = useState<number>(30);
  const [creating, setCreating] = useState(false);

  // ✅ subir notas masivo
  const [gExamId, setGExamId] = useState<string>("");
  const [gRoster, setGRoster] = useState<StudentRow[]>([]);
  const [gLoadingRoster, setGLoadingRoster] = useState(false);

  // map: studentId -> grade string (para textbox controlado)
  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [savingOne, setSavingOne] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);

  // ✅ toast confirmación
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

        const role = info?.role;
        if (role !== "T" && role !== "A") return router.replace("/dashboard");
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
      const qs = classFilter === "all" ? "" : `?class_id=${classFilter}`;
      const res = await apiFetch(`/api/teacher/evaluations${qs}`);
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

  // ✅ recargar lista + cursos al cambiar materia
  useEffect(() => {
    if (loadingMe) return;

    // reset de crear evaluación (porque la materia cambia)
    setTitlePick("");
    setTitleOther("");
    setCType("");
    setCTypeOther("");
    setCPercent(30);

    if (classFilter === "all") {
      setCourses([]);
      setCCourse("");
    } else {
      loadCoursesForClass(Number(classFilter));
    }

    loadEvaluations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classFilter]);

  // ===== Helpers seleccionados =====
  const selectedEval = useMemo(() => {
    const id = Number(gExamId);
    if (!id) return null;
    return items.find((x) => x.id === id) || null;
  }, [gExamId, items]);

  // ✅ evaluaciones que se muestran en dropdown de “Subir nota”
  const evalOptions = useMemo(() => {
    if (classFilter === "all") return items;
    return items.filter((x) => x.id_class === Number(classFilter));
  }, [items, classFilter]);

  const selectedClassName = useMemo(() => {
    if (classFilter === "all") return "—";
    const c = myClasses.find((x) => x.id === classFilter);
    return c?.name ?? "—";
  }, [classFilter, myClasses]);

  // ✅ títulos existentes en esa materia (para dropdown)
  const titleOptions = useMemo(() => {
    const list = classFilter === "all" ? [] : items.filter((x) => x.id_class === Number(classFilter));
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
  }, [items, classFilter]);

  // ===== Cargar alumnos del curso + notas de esa evaluación =====
  async function loadRosterAndGrades() {
    setMsg(null);
    setGLoadingRoster(true);
    setGRoster([]);
    setGradeDraft({});

    try {
      if (!selectedEval?.id_course) return;

      // ✅ 1) alumnos del curso
      const rosterRes = await apiFetch(`/api/teacher/course-students?course_id=${selectedEval.id_course}`);
      const roster: StudentRow[] = rosterRes?.items || [];
      setGRoster(roster);

      // ✅ 2) notas existentes para esa evaluación
      const gradesRes = await apiFetch(`/api/teacher/exam-grades?exam_id=${selectedEval.id}`);
      const existing: ExamGradeRow[] = gradesRes?.items || [];

      const mapExisting = new Map<string, number>();
      for (const r of existing) {
        if (r?.id_student) mapExisting.set(r.id_student, r.grade === null ? NaN : Number(r.grade));
      }

      // ✅ 3) inicializar drafts con nota si existe
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

  // cuando cambia la evaluación seleccionada: cargar tabla
  useEffect(() => {
    if (!selectedEval) {
      setGRoster([]);
      setGradeDraft({});
      return;
    }
    loadRosterAndGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEval?.id]);

  // ===== Crear evaluación =====
  async function handleCreate() {
    setMsg(null);

    if (classFilter === "all") {
      setMsg("Selecciona una materia primero (en 'Mis evaluaciones').");
      return;
    }

    const id_class = Number(classFilter);

    // ✅ Curso desde dropdown
    const id_course = Number(cCourse);
    if (!id_course) return setMsg("Selecciona un curso.");

    // ✅ Tipo desde dropdown / Otro
    let id_type = Number(cType);
    const isOtherType = cType === "__other__";
    const type_text = isOtherType ? cTypeOther.trim() : "";

    if (!id_type && !isOtherType) return setMsg("Selecciona un tipo.");
    if (isOtherType && !type_text) return setMsg("Escribe el tipo (Otro).");

    // ✅ Título desde dropdown / Otro
    const isOtherTitle = titlePick === "__other__";
    const title = titlePick && titlePick !== "__other__" ? titlePick.trim() : titleOther.trim();
    if (!title) return setMsg("Selecciona o escribe un título.");

    const percent = Number(cPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return setMsg("Percent inválido (1..100)");

    setCreating(true);
    try {
      // Si es "Otro" tipo, lo creamos primero y seleccionamos el id
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

      // reset UI
      setCCourse("");
      setCType("");
      setCTypeOther("");
      setTitlePick("");
      setTitleOther("");
      setCPercent(30);

      flash("✅ Evaluación creada", "ok");
      await loadEvaluations();
    } catch (e: any) {
      setMsg(e?.message || "Error creando evaluación");
      flash("❌ No se pudo crear", "err");
    } finally {
      setCreating(false);
    }
  }

  // ===== Guardar 1 alumno =====
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

  // ===== Guardar todos =====
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

  // ✅ Cambiar contraseña (email de recuperación Supabase)
  async function handleChangePassword() {
    try {
      setMsg(null);
      const email = me?.user?.email;
      if (!email) {
        setMsg("No se encontró el email del usuario.");
        flash("❌ No hay email", "err");
        return;
      }

      // Importante: debe apuntar a una ruta de tu FRONT que maneje el recovery.
      // Si ya tienes /reset-password o /update-password, cambia esta URL:
      const redirectTo = `${window.location.origin}/update-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      flash("✅ Te envié un correo para cambiar la contraseña", "ok");
    } catch (e: any) {
      setMsg(e?.message || "Error enviando correo de cambio de contraseña");
      flash("❌ No se pudo enviar el correo", "err");
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const roleLabel = useMemo(() => {
    if (!me?.role) return "—";
    return me.role === "A" ? "Admin" : me.role === "T" ? "Teacher" : "Student";
  }, [me]);

  if (loadingMe) return <div className="container">Cargando...</div>;

  return (
    <div className="container">
      {/* ✅ Toast */}
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
            background: "rgba(255,255,255,.92)",
            border: "1px solid rgba(2,132,199,.18)",
            boxShadow: "0 18px 45px rgba(2,132,199,.12)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {toast.text}
        </div>
      )}

      <div className="topbar" style={{ alignItems: "center" }}>
        <div className="brand">
          <div style={{ fontWeight: 900, fontSize: 18 }}>JILIU · La Promesa</div>
          <div style={{ color: "var(--muted)" }}>Panel Teacher</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid var(--stroke)",
              background: "rgba(255,255,255,.75)",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            {roleLabel} · {me?.user?.email}
          </div>

          {/* ✅ Cambiar contraseña (a la izquierda de Salir) */}
          <button
            onClick={handleChangePassword}
            style={{
              border: 0,
              borderRadius: 14,
              padding: "10px 12px",
              cursor: "pointer",
              background: "rgba(255,255,255,.85)",
              borderColor: "var(--stroke)",
              borderStyle: "solid",
              borderWidth: 1,
              fontWeight: 900,
            }}
          >
            Cambiar contraseña
          </button>

          <button
            onClick={handleLogout}
            style={{
              border: 0,
              borderRadius: 14,
              padding: "10px 12px",
              cursor: "pointer",
              background: "rgba(255,255,255,.85)",
              borderColor: "var(--stroke)",
              borderStyle: "solid",
              borderWidth: 1,
              fontWeight: 900,
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {msg && <div className="msgError">{msg}</div>}

      {/* ✅ 2 columnas arriba */}
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "stretch" }}>
        {/* MIS EVALUACIONES */}
        <div className="card" style={{ minHeight: 420 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Mis evaluaciones</h2>
            <button
              onClick={loadEvaluations}
              style={{
                border: "1px solid var(--stroke2)",
                background: "rgba(255,255,255,.85)",
                borderRadius: 14,
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              {loadingList ? "Cargando..." : "Refrescar"}
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="label">Materia</div>
            <select
              className="select"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">Todas mis materias</option>
              {myClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {loadingClasses && <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>Cargando materias...</div>}
          </div>

          <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(14,165,233,.08)" }}>
                  <th style={{ textAlign: "left", padding: 12 }}>Título</th>
                  <th style={{ textAlign: "left", padding: 12, width: 70 }}>%</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Materia</th>
                  <th style={{ textAlign: "left", padding: 12 }}>Curso</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>
                      {loadingList ? "Cargando..." : "No tienes evaluaciones aún."}
                    </td>
                  </tr>
                ) : (
                  items.map((e) => (
                    <tr key={e.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                      <td style={{ padding: 12, fontWeight: 900 }}>{e.title}</td>
                      <td style={{ padding: 12 }}>{Number(e.percent).toFixed(0)}%</td>
                      <td style={{ padding: 12 }}>{e.class?.name ?? `ID ${e.id_class}`}</td>
                      <td style={{ padding: 12 }}>{e.course?.name ?? `ID ${e.id_course}`}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* CREAR EVALUACIÓN */}
        <div className="card" style={{ minHeight: 420 }}>
          <h2 style={{ marginTop: 0 }}>Crear evaluación</h2>

          <div style={{ marginTop: 8 }}>
            <div className="label">Materia</div>
            <div
              className="input"
              style={{
                display: "flex",
                alignItems: "center",
                fontWeight: 900,
                background: "rgba(255,255,255,.65)",
              }}
            >
              {selectedClassName}
            </div>
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
              * La materia se toma del selector de “Mis evaluaciones”.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            {/* ✅ CURSO dropdown */}
            <div style={{ gridColumn: "1 / span 2" }}>
              <div className="label">Curso</div>
              <select
                className="select"
                value={cCourse}
                onChange={(e) => setCCourse(e.target.value)}
                disabled={classFilter === "all" || loadingCourses}
              >
                <option value="">
                  {classFilter === "all" ? "Selecciona una materia primero" : loadingCourses ? "Cargando cursos..." : "Selecciona..."}
                </option>
                {courses.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* ✅ TIPO dropdown + Otro */}
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

            {/* ✅ TÍTULO dropdown + Otro */}
            <div style={{ gridColumn: "1 / span 2" }}>
              <div className="label">Título</div>
              <select
                className="select"
                value={titlePick}
                onChange={(e) => {
                  setTitlePick(e.target.value);
                  if (e.target.value !== "__other__") setTitleOther("");
                }}
                disabled={classFilter === "all"}
              >
                <option value="">{classFilter === "all" ? "Selecciona una materia primero" : "Selecciona..."}</option>
                {titleOptions.map((t) => (
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

            {/* ✅ slider porcentaje */}
            <div style={{ gridColumn: "1 / span 2", marginTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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

          <button className="btn" onClick={handleCreate} disabled={creating} style={{ marginTop: 12, width: "100%" }}>
            {creating ? "Creando..." : "Crear evaluación"}
          </button>
        </div>
      </div>

      {/* ✅ ABAJO: panel ancho completo */}
      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Subir nota manual (upsert)</h2>

          <button className="btn" onClick={saveAll} disabled={savingAll || !selectedEval || gRoster.length === 0} style={{ width: 220 }}>
            {savingAll ? "Actualizando..." : "Actualizar todos"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="label">Evaluación</div>
          <select className="select" value={gExamId} onChange={(e) => setGExamId(e.target.value)}>
            <option value="">Selecciona...</option>
            {evalOptions.map((e) => (
              <option key={e.id} value={String(e.id)}>
                #{e.id} · {e.title} ({Number(e.percent).toFixed(0)}%) · {e.course?.name ?? `Curso ${e.id_course}`}
              </option>
            ))}
          </select>

          <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
            * Solo aparecen evaluaciones de la materia seleccionada.
          </div>
        </div>

        {!selectedEval ? (
          <div style={{ marginTop: 12, color: "var(--muted)" }}>Selecciona una evaluación para cargar el curso y alumnos.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontWeight: 900 }}>
                Curso: {selectedEval.course?.name ?? `ID ${selectedEval.id_course}`} · Materia: {selectedEval.class?.name ?? `ID ${selectedEval.id_class}`}
              </div>
              <button
                type="button"
                onClick={loadRosterAndGrades}
                style={{
                  border: "1px solid var(--stroke2)",
                  background: "rgba(255,255,255,.85)",
                  borderRadius: 14,
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                {gLoadingRoster ? "Cargando..." : "Refrescar lista"}
              </button>
            </div>

            <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
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
                        No se encontraron alumnos para este curso (o tu endpoint no devolvió items).
                      </td>
                    </tr>
                  ) : (
                    gRoster.map((st) => (
                      <tr key={st.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                        <td style={{ padding: 12, fontWeight: 800 }}>{st.cedula}</td>
                        <td style={{ padding: 12, fontWeight: 900 }}>{st.name}</td>
                        <td style={{ padding: 12 }}>
                          <input
                            className="input"
                            inputMode="numeric"
                            value={gradeDraft[st.id] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") return setGradeDraft((p) => ({ ...p, [st.id]: "" }));
                              if (!/^\d{0,3}(\.\d{0,2})?$/.test(v)) return;
                              setGradeDraft((p) => ({ ...p, [st.id]: v }));
                            }}
                            placeholder="—"
                          />
                        </td>
                        <td style={{ padding: 12 }}>
                          <button className="btn" onClick={() => saveOne(st)} disabled={!!savingOne[st.id] || savingAll} style={{ width: "100%" }}>
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
              Tip: si un alumno ya tenía nota, el textbox aparece precargado. Puedes editar y guardar uno por uno o “Actualizar todos”.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
