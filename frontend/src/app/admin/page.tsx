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
  | "USERS" // Crear (manual + excel) + descargar plantilla
  | "UPDATE_USER"; // Actualizar por cédula

const ROLE_OPTIONS = [
  { value: "S", label: "Student (S)" },
  { value: "T", label: "Teacher (T)" },
  { value: "A", label: "Admin (A)" },
] as const;

// ==============================
// ✅ Plantilla Excel en Storage
// ==============================
// Recomendación: bucket público y guardas la URL pública aquí (o en ENV):
// NEXT_PUBLIC_USERS_TEMPLATE_URL=https://xxxx.supabase.co/storage/v1/object/public/<bucket>/<path>
const TEMPLATE_PUBLIC_URL =
  process.env.NEXT_PUBLIC_USERS_TEMPLATE_URL ||
  "https://xujejxbzeexqagotdvdi.supabase.co/storage/v1/object/public/assets/utilities/CargaEstudiantesJILIU.xlsx";

// Si bucket es privado, configuras esto para signed URL:
const TEMPLATE_BUCKET = process.env.NEXT_PUBLIC_TEMPLATES_BUCKET || "";
const TEMPLATE_PATH = process.env.NEXT_PUBLIC_USERS_TEMPLATE_PATH || "";

export default function AdminPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // mensajes
  const [msg, setMsg] = useState<string | null>(null); // rojo
  const [okMsg, setOkMsg] = useState<string | null>(null); // verde

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<AdminView>("COURSES");

  // ===== data lists =====
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [types, setTypes] = useState<EvalType[]>([]);
  const [teachers, setTeachers] = useState<UserMini[]>([]);
  const [students, setStudents] = useState<UserMini[]>([]);
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

  // ===== USERS: upload excel =====
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadReport, setUploadReport] = useState<any>(null);

  // ===== USERS: crear manual =====
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

  // ===== UPDATE USER (por cédula) =====
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

  // ✅ upLoading = submit update
  const [upLoading, setUpLoading] = useState(false);
  // ✅ upSearching = buscando por cédula
  const [upSearching, setUpSearching] = useState(false);
  const lastCedulaFetchedRef = useRef<string>("");
  const searchSeqRef = useRef<number>(0);

  // plantilla download
  const [templateLoading, setTemplateLoading] = useState(false);

  // ===== helpers mensajes =====
  function showOk(text: string) {
    setMsg(null);
    setOkMsg(text);
    setTimeout(() => setOkMsg(null), 4500);
  }
  function showErr(text: string) {
    setOkMsg(null);
    setMsg(text);
  }

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
    setOkMsg(null);
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
      showErr(e?.message || "Error cargando datos del admin");
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (!loadingMe) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

  // =========================
  // ✅ AUTOCARGAR USER AL ESCRIBIR CÉDULA (UPDATE_USER)
  // =========================
  useEffect(() => {
    if (view !== "UPDATE_USER") return;

    const ced = upCedula.trim();

    // si está vacío, limpiar todo
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

    // evita consultar por muy pocos dígitos
    if (ced.length < 5) return;

    const seq = ++searchSeqRef.current;

    const t = setTimeout(async () => {
      // evita repetir exacto lo mismo
      if (lastCedulaFetchedRef.current === ced) return;

      setUpSearching(true);
      try {
        // ✅ backend: GET /api/admin/user-by-cedula?cedula=...
        const res = await apiFetch(
          `/api/admin/user-by-cedula?cedula=${encodeURIComponent(ced)}`
        );

        // si llegó otra consulta después, ignora esta respuesta
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

        // opcional: mensaje suave (sin “ensuciar” si prefieres)
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

        // si no existe, muéstralo pero sin bloquear
        setOkMsg(null);
        setMsg(e?.message || "No se pudo cargar el usuario");
      } finally {
        if (seq === searchSeqRef.current) setUpSearching(false);
      }
    }, 450);

    return () => clearTimeout(t);
  }, [upCedula, view]);

  // =========================
  // COURSES
  // =========================
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

  // =========================
  // CLASSES
  // =========================
  async function createClass() {
    const name = newClassName.trim();
    if (!name) return showErr("Nombre de la materia requerido.");

    try {
      await apiFetch("/api/admin/classes", {
        method: "POST",
        body: JSON.stringify({ name, level: newClassLevel }),
      });
      setNewClassName("");
      showOk("✅ Materia creada");
      await loadAll();
    } catch (e: any) {
      showErr(e?.message || "Error creando materia");
    }
  }

  // =========================
  // EVAL TYPES
  // =========================
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

  // =========================
  // ASSIGN TEACHER
  // =========================
  async function assignTeacher() {
    const id_teacher = selTeacher;
    const id_class = Number(selClass);

    if (!id_teacher) return showErr("Selecciona un teacher.");
    if (!id_class) return showErr("Selecciona una materia.");

    try {
      await apiFetch("/api/admin/assign-teacher", {
        method: "POST",
        body: JSON.stringify({ id_teacher, id_class }),
      });
      showOk("✅ Teacher asignado a la materia");
    } catch (e: any) {
      showErr(e?.message || "Error asignando teacher");
    }
  }

  // =========================
  // USERS: helpers
  // =========================
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
    searchSeqRef.current++; // cancela posibles respuestas viejas
    setUpCedula("");
    setUpEmail("");
    setUpName("");
    setUpCodeJiliu("");
    setUpCourseId("");
    setUpRoles({ S: true, T: false, A: false });
    setUpSearching(false);
  }

  // =========================
  // USERS: crear manual (NO opcionales)
  // =========================
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
    if (!code_jiliu) return showErr("code_jiliu requerido.");
    if (!id_course) return showErr("Debes seleccionar un course.");
    if (roles.length === 0) return showErr("Selecciona al menos 1 rol (S/T/A).");

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

  // =========================
  // USERS: upload excel (NO opcionales)
  // =========================
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

  // =========================
  // UPDATE USER BY CEDULA
  // =========================
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
    if (!code_jiliu) return showErr("code_jiliu requerido.");
    if (!id_course) return showErr("Debes seleccionar un course.");
    if (roles.length === 0) return showErr("Selecciona al menos 1 rol (S/T/A).");

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

      // ✅ si el backend manda warn, lo mostramos
      if (res?.warn) {
        showOk(`✅ Usuario actualizado (con advertencia)`);
        setMsg(`⚠️ ${res.warn}`);
      } else {
        showOk("✅ Usuario actualizado por cédula");
      }

      resetUpdateUserForm();
      await loadAll();
    } catch (e: any) {
      // por ejemplo 409: conflictos
      showErr(e?.message || "Error actualizando usuario");
    } finally {
      setUpLoading(false);
    }
  }

  // =========================
  // Descargar plantilla
  // =========================
  async function downloadTemplate() {
    setMsg(null);
    setOkMsg(null);

    const hasPublic = TEMPLATE_PUBLIC_URL && !TEMPLATE_PUBLIC_URL.includes("REEMPLAZA_AQUI");
    if (hasPublic) {
      window.open(TEMPLATE_PUBLIC_URL, "_blank", "noopener,noreferrer");
      return;
    }

    // si no hay URL pública, intentamos signed URL (requiere bucket/path)
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

      if (error || !data?.signedUrl) throw new Error(error?.message || "No se pudo generar signed URL");

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      showErr(e?.message || "Error descargando plantilla");
    } finally {
      setTemplateLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const roleLabel = useMemo(() => roleLabelFromRole(primaryRole(me)), [me]);

  if (loadingMe) return <div className="container">Cargando...</div>;

  // UI medidas
  const SIDEBAR_W = 320;
  const HAM_PAD = 14;
  const hamLeft = sidebarOpen ? SIDEBAR_W + HAM_PAD : HAM_PAD;

  return (
    <div>
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

      {/* MAIN */}
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

          {/* SELECTOR */}
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
              <select
                className="select"
                value={view}
                onChange={(e) => setView(e.target.value as AdminView)}
              >
                <option value="COURSES">Crear course</option>
                <option value="CLASSES">Crear materia</option>
                <option value="TYPES">Crear tipo de evaluación</option>
                <option value="ASSIGN_TEACHER">Asignar teacher a materia</option>
                <option value="USERS">Usuarios (crear + excel)</option>
                <option value="UPDATE_USER">Actualizar usuario (por cédula)</option>
              </select>
            </div>
          </div>

          {msg && (
            <div className="msgError" style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}

          {okMsg && (
            <div className="msgOk" style={{ marginTop: 12 }}>
              {okMsg}
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
                  <select
                    className="select"
                    value={selTeacher}
                    onChange={(e) => setSelTeacher(e.target.value)}
                  >
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
              PANEL: USERS (crear manual + excel + template)
              ========================= */}
          {view === "USERS" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Usuarios</h2>

              {/* ✅ Descargar plantilla siempre */}
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
                    Descárgala para cargar usuarios correctamente.
                  </div>
                </div>
                <button className="btn" onClick={downloadTemplate} disabled={templateLoading}>
                  {templateLoading ? "Generando..." : "⬇️ Descargar plantilla"}
                </button>
              </div>

              {/* ===== MANUAL (obligatorio todo) ===== */}
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

              {/* ===== EXCEL ===== */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Subir Excel: crear usuarios</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                  Columnas obligatorias: <b>email</b>, <b>name</b>, <b>cedula</b>, <b>code_jiliu</b>,{" "}
                  <b>id_course</b>, <b>type</b> (S/T/A o lista S,T).
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

          {/* =========================
              PANEL: UPDATE USER
              ========================= */}
          {view === "UPDATE_USER" && (
            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0 }}>Actualizar usuario por cédula</h2>

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
        </div>
      </main>

      <Footer rightText="Made for Iglesia La Promesa." />
    </div>
  );
}
