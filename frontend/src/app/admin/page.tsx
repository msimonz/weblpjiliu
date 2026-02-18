"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch } from "@/lib/api";
import { primaryRole, roleLabelFromRole } from "@/lib/roles";
import { getActiveRole, roleToRoute } from "@/lib/activeRole";
import Footer from "@/components/Footer";
import ChangePasswordButton from "@/components/ChangePasswordButton";


type Course = { id: number; name: string; level: number; year: string | null };
type ClassItem = { id: number; name: string; level: number };
type EvalType = { id: number; type: string };

type UserMini = {
  id: string;
  name: string;
  email: string;
  cedula: string | null;
  type?: "S" | "T" | "A";
  id_course?: number | null;
};

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
  | "ASSIGN_STUDENTS"
  | "UPLOAD_EXCEL";

export default function AdminPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);

  // ✅ sidebar + hamburguesa (igual que student)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ✅ selector de panel (arriba)
  const [view, setView] = useState<AdminView>("COURSES");

  // ===== data lists =====
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [types, setTypes] = useState<EvalType[]>([]);
  const [teachers, setTeachers] = useState<UserMini[]>([]);
  const [students, setStudents] = useState<UserMini[]>([]);
  const [courseStudents, setCourseStudents] = useState<UserMini[]>([]);

  const [loadingData, setLoadingData] = useState(false);

  // ===== create course =====
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseLevel, setNewCourseLevel] = useState<number>(1);
  const [newCourseYear, setNewCourseYear] = useState<string>("");

  // ===== create class =====
  const [newClassName, setNewClassName] = useState("");
  const [newClassLevel, setNewClassLevel] = useState<number>(1);

  // ===== create eval type =====
  const [newType, setNewType] = useState("");

  // ===== assign teacher -> class =====
  const [selTeacher, setSelTeacher] = useState<string>("");
  const [selClass, setSelClass] = useState<string>("");

  // ===== assign students -> course =====
  const [selCourse, setSelCourse] = useState<string>("");
  const [studentQuery, setStudentQuery] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<Record<string, boolean>>({});
  const selectedCount = useMemo(
    () => Object.values(selectedStudents).filter(Boolean).length,
    [selectedStudents]
  );

  // ===== upload excel =====
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState<any>(null);

  // ===== change password modal =====
  const [pwOpen, setPwOpen] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  // ===== auth guard =====
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
    setLoadingData(true);
    try {
      const [c1, c2, c3, t1, s1] = await Promise.all([
        apiFetch("/api/admin/courses"),
        apiFetch("/api/admin/classes"),
        apiFetch("/api/admin/evaluation-types"),
        apiFetch("/api/admin/teachers"),
        apiFetch("/api/admin/students"),
      ]);

      setCourses(c1?.items || []);
      setClasses(c2?.items || []);
      setTypes(c3?.items || []);
      setTeachers(t1?.items || []);
      setStudents(s1?.items || []);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando datos del admin");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (!loadingMe) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

  // ===== create handlers =====
  async function createCourse() {
    setMsg(null);
    const name = newCourseName.trim();
    if (!name) return setMsg("Nombre del course requerido.");

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
      setMsg("✅ Course creado");
      await loadAll();
    } catch (e: any) {
      setMsg(e?.message || "Error creando course");
    }
  }

  async function createClass() {
    setMsg(null);
    const name = newClassName.trim();
    if (!name) return setMsg("Nombre de la materia requerido.");

    try {
      await apiFetch("/api/admin/classes", {
        method: "POST",
        body: JSON.stringify({ name, level: newClassLevel }),
      });
      setNewClassName("");
      setMsg("✅ Materia creada");
      await loadAll();
    } catch (e: any) {
      setMsg(e?.message || "Error creando materia");
    }
  }

  async function createEvalType() {
    setMsg(null);
    const t = newType.trim();
    if (!t) return setMsg("Tipo requerido.");

    try {
      await apiFetch("/api/admin/evaluation-types", {
        method: "POST",
        body: JSON.stringify({ type: t }),
      });
      setNewType("");
      setMsg("✅ Tipo creado");
      await loadAll();
    } catch (e: any) {
      setMsg(e?.message || "Error creando tipo");
    }
  }

  async function assignTeacher() {
    setMsg(null);
    const id_teacher = selTeacher;
    const id_class = Number(selClass);

    if (!id_teacher) return setMsg("Selecciona un teacher.");
    if (!id_class) return setMsg("Selecciona una materia.");

    try {
      await apiFetch("/api/admin/assign-teacher", {
        method: "POST",
        body: JSON.stringify({ id_teacher, id_class }),
      });
      setMsg("✅ Teacher asignado a la materia");
    } catch (e: any) {
      setMsg(e?.message || "Error asignando teacher");
    }
  }

  async function loadCourseStudents(courseId: number) {
    try {
      const res = await apiFetch(`/api/admin/course-students?course_id=${courseId}`);
      setCourseStudents(res?.items || []);
    } catch {
      setCourseStudents([]);
    }
  }

  useEffect(() => {
    const id = Number(selCourse);
    if (!id) {
      setCourseStudents([]);
      return;
    }
    loadCourseStudents(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCourse]);

  async function assignStudents() {
    setMsg(null);
    const id_course = Number(selCourse);
    if (!id_course) return setMsg("Selecciona un course.");

    const ids = Object.entries(selectedStudents)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (ids.length === 0) return setMsg("Selecciona al menos 1 estudiante.");

    try {
      await apiFetch("/api/admin/assign-students", {
        method: "POST",
        body: JSON.stringify({ id_course, student_ids: ids }),
      });

      setMsg(`✅ Asignados ${ids.length} estudiantes al course`);
      setSelectedStudents({});
      await loadAll();
      await loadCourseStudents(id_course);
    } catch (e: any) {
      setMsg(e?.message || "Error asignando estudiantes");
    }
  }

  // ===== Upload excel =====
  async function uploadExcel() {
    setMsg(null);
    setUploadReport(null);

    const input = fileRef.current;
    if (!input?.files?.[0]) return setMsg("Selecciona un archivo .xlsx");

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
      setMsg("✅ Excel procesado");
      if (fileRef.current) fileRef.current.value = "";
      await loadAll();
    } catch (e: any) {
      setMsg(e?.message || "Error procesando excel");
    } finally {
      setUploading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }



  const roleLabel = useMemo(() => roleLabelFromRole(primaryRole(me)), [me]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const a = (s.name || "").toLowerCase();
      const b = (s.email || "").toLowerCase();
      const c = (s.cedula || "").toLowerCase();
      return a.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [students, studentQuery]);

  if (loadingMe) return <div className="container">Cargando...</div>;

  // ✅ medidas UI (igual que student)
  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div>
      {/* ✅ HAMBURGUESA (igual que student: franja + botón que se pega) */}
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

      {/* ✅ SIDEBAR (ajustado a tus tokens, como student) */}
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

      {/* ✅ MAIN */}
      <main
        style={{
          marginLeft: sidebarOpen ? SIDEBAR_W : 0,
          transition: "margin-left 180ms ease",
        }}
      >
        <div className="container">
          {/* TOPBAR */}
          <div className="topbar" style={{ alignItems: "center" }}>
            <div className="brand">
              <div style={{ fontWeight: 900, fontSize: 18 }}>JILIU · La Promesa</div>
              <div style={{ color: "var(--muted)" }}>Panel Admin</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="btnLight" style={{ padding: "8px 12px", borderRadius: 999 }}>
                {roleLabel} · {me?.user?.email}
              </div>
            </div>
          </div>

          {/* ✅ SELECTOR DE SECCIÓN */}
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

            <div style={{ minWidth: 320 }}>
              <select className="select" value={view} onChange={(e) => setView(e.target.value as AdminView)}>
                <option value="COURSES">Crear course</option>
                <option value="CLASSES">Crear materia</option>
                <option value="TYPES">Crear tipo de evaluación</option>
                <option value="ASSIGN_TEACHER">Asignar teacher a materia</option>
                <option value="ASSIGN_STUDENTS">Asignar alumnos a course</option>
                <option value="UPLOAD_EXCEL">Subir Excel (crear usuarios)</option>
              </select>
            </div>
          </div>

          {msg && (
            <div className="msgError" style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}

          {/* =========================
              PANEL: CREAR COURSE
              ========================= */}
          {view === "COURSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear course</h2>

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
                          <td style={{ padding: 12, fontWeight: 900 }}>{c.name}</td>
                          <td style={{ padding: 12 }}>{c.level}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =========================
              PANEL: CREAR MATERIA
              ========================= */}
          {view === "CLASSES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear materia</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 12 }}>
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
                      <th style={{ textAlign: "left", padding: 12, width: 110 }}>Nivel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: 12, color: "var(--muted)" }}>
                          {loadingData ? "Cargando..." : "Sin materias"}
                        </td>
                      </tr>
                    ) : (
                      classes.map((c) => (
                        <tr key={c.id} style={{ borderTop: "1px solid rgba(2,132,199,.10)" }}>
                          <td style={{ padding: 12, fontWeight: 900 }}>{c.name}</td>
                          <td style={{ padding: 12 }}>{c.level}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =========================
              PANEL: CREAR TIPOS
              ========================= */}
          {view === "TYPES" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Crear tipo de evaluación</h2>

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
                      <th style={{ textAlign: "left", padding: 12 }}>ID</th>
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
                          <td style={{ padding: 12, fontWeight: 900 }}>{t.id}</td>
                          <td style={{ padding: 12, fontWeight: 900 }}>{t.type}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* =========================
              PANEL: ASIGNAR TEACHER
              ========================= */}
          {view === "ASSIGN_TEACHER" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Asignar teacher a materia</h2>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="label">Teacher</div>
                  <select className="select" value={selTeacher} onChange={(e) => setSelTeacher(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Materia</div>
                  <select className="select" value={selClass} onChange={(e) => setSelClass(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {classes.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} (Nivel {c.level})
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

          {/* =========================
              PANEL: ASIGNAR ALUMNOS
              ========================= */}
          {view === "ASSIGN_STUDENTS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Asignar alumnos a course</h2>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "320px 1fr 220px",
                  gap: 12,
                  alignItems: "end",
                }}
              >
                <div>
                  <div className="label">Course</div>
                  <select className="select" value={selCourse} onChange={(e) => setSelCourse(e.target.value)}>
                    <option value="">Selecciona...</option>
                    {courses.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} (Nivel {c.level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="label">Buscar estudiante</div>
                  <input
                    className="input"
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="Nombre, email o cédula..."
                  />
                </div>

                <button
                  className="btn"
                  onClick={assignStudents}
                  disabled={!selCourse || selectedCount === 0}
                  style={{ width: "100%" }}
                >
                  Asignar ({selectedCount})
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {/* selector */}
                <div style={{ overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
                  <div style={{ padding: 12, fontWeight: 900, background: "rgba(14,165,233,.08)" }}>
                    Estudiantes (selecciona)
                  </div>
                  <div style={{ maxHeight: 320, overflow: "auto" }}>
                    {filteredStudents.length === 0 ? (
                      <div style={{ padding: 12, color: "var(--muted)" }}>Sin resultados</div>
                    ) : (
                      filteredStudents.map((s) => (
                        <label
                          key={s.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            padding: 12,
                            borderTop: "1px solid rgba(2,132,199,.10)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!selectedStudents[s.id]}
                            onChange={(e) =>
                              setSelectedStudents((p) => ({ ...p, [s.id]: e.target.checked }))
                            }
                          />
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <div style={{ fontWeight: 900 }}>{s.name}</div>
                            <div style={{ color: "var(--muted)", fontSize: 13 }}>
                              {s.email} {s.cedula ? `· ${s.cedula}` : ""}
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* alumnos actuales */}
                <div style={{ overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
                  <div style={{ padding: 12, fontWeight: 900, background: "rgba(14,165,233,.08)" }}>
                    Alumnos actuales del course
                  </div>

                  {!selCourse ? (
                    <div style={{ padding: 12, color: "var(--muted)" }}>
                      Selecciona un course para ver alumnos.
                    </div>
                  ) : (
                    <div style={{ maxHeight: 320, overflow: "auto" }}>
                      {courseStudents.length === 0 ? (
                        <div style={{ padding: 12, color: "var(--muted)" }}>
                          Este course no tiene alumnos aún.
                        </div>
                      ) : (
                        courseStudents.map((s) => (
                          <div key={s.id} style={{ padding: 12, borderTop: "1px solid rgba(2,132,199,.10)" }}>
                            <div style={{ fontWeight: 900 }}>{s.name}</div>
                            <div style={{ color: "var(--muted)", fontSize: 13 }}>
                              {s.email} {s.cedula ? `· ${s.cedula}` : ""}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =========================
              PANEL: SUBIR EXCEL
              ========================= */}
          {view === "UPLOAD_EXCEL" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Subir Excel: crear usuarios</h2>

              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                Columnas esperadas: <b>email</b>, <b>name</b>, <b>type</b> (S/T/A), <b>cedula</b> (opcional),{" "}
                <b>id_course</b> (opcional), <b>code_jiliu</b> (opcional).
                <br />
                Password por defecto: <b>password</b> (o <b>DEFAULT_PASSWORD</b> en el backend).
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
                <input ref={fileRef} type="file" accept=".xlsx" />
                <button className="btn" onClick={uploadExcel} disabled={uploading} style={{ width: 220 }}>
                  {uploading ? "Subiendo..." : "Procesar Excel"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadReport(null);
                    setMsg(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="btnLight"
                >
                  Limpiar
                </button>
              </div>

              {uploadReport && (
                <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 18, border: "1px solid var(--stroke)" }}>
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
          )}
        </div>
      </main>
      <Footer rightText="Made for Iglesia La Promesa." />
    </div>
  );
}
