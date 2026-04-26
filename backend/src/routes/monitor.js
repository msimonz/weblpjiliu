import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const monitorRouter = Router();

// ===== Middleware: solo Monitor =====
function requireMonitor(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("M")) return res.status(403).json({ error: "Solo Monitor" });
  return next();
}

// ===== Helper: curso del monitor =====
async function getMonitorCourse(req, res) {
  const courseId = Number(req.auth.profile?.id_course || 0);
  if (!courseId) {
    res.status(400).json({ error: "El monitor no tiene curso asignado" });
    return null;
  }

  const { data: course, error } = await supabaseAdmin
    .from("course")
    .select("id,name,year,level")
    .eq("id", courseId)
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!course?.id) { res.status(404).json({ error: "Curso no encontrado" }); return null; }

  return course;
}

// ===== Helper: validar que id_course del request == curso del monitor =====
function validateCourse(req, res, courseId) {
  const monitorCourseId = Number(req.auth.profile?.id_course || 0);
  if (!monitorCourseId || Number(courseId) !== monitorCourseId) {
    res.status(403).json({ error: "Solo puedes operar sobre tu curso asignado" });
    return false;
  }
  return true;
}

// ============================================================
// T16 — GET /api/monitor/me
// Perfil del monitor + info del curso asignado
// ============================================================
monitorRouter.get("/me", requireAuth, requireMonitor, async (req, res) => {
  try {
    const course = await getMonitorCourse(req, res);
    if (!course) return;

    return res.json({
      profile: req.auth.profile,
      course,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T17 — GET /api/monitor/students
// Estudiantes del curso del monitor
// ============================================================
monitorRouter.get("/students", requireAuth, requireMonitor, async (req, res) => {
  try {
    const course = await getMonitorCourse(req, res);
    if (!course) return;

    // Obtener id del tipo Estudiante
    const { data: typeRow } = await supabaseAdmin
      .from("type")
      .select("id")
      .eq("code", "S")
      .maybeSingle();

    if (!typeRow?.id) return res.status(500).json({ error: "Tipo S no encontrado" });

    // Usuarios del curso con rol S
    const { data: users, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,name,cedula")
      .eq("id_course", course.id)
      .order("name", { ascending: true });

    if (uErr) return res.status(500).json({ error: uErr.message });

    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_type")
      .select("id_user")
      .eq("id_type", typeRow.id)
      .in("id_user", (users || []).map((u) => u.id));

    if (rErr) return res.status(500).json({ error: rErr.message });

    const studentSet = new Set((roleRows || []).map((r) => r.id_user));
    const students = (users || []).filter((u) => studentSet.has(u.id));

    return res.json({ items: students });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T17b — GET /api/monitor/teachers
// Todos los profesores (rol T)
// ============================================================
monitorRouter.get("/teachers", requireAuth, requireMonitor, async (req, res) => {
  try {
    const { data: typeRow } = await supabaseAdmin
      .from("type")
      .select("id")
      .eq("code", "T")
      .maybeSingle();

    if (!typeRow?.id) return res.status(500).json({ error: "Tipo T no encontrado" });

    const { data: roleRows, error: rErr } = await supabaseAdmin
      .from("user_type")
      .select("id_user")
      .eq("id_type", typeRow.id);

    if (rErr) return res.status(500).json({ error: rErr.message });

    const teacherIds = (roleRows || []).map((r) => r.id_user);
    if (!teacherIds.length) return res.json({ items: [] });

    const { data: users, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id,name")
      .in("id", teacherIds)
      .order("name", { ascending: true });

    if (uErr) return res.status(500).json({ error: uErr.message });
    return res.json({ items: users || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T18 — GET /api/monitor/modules
// Módulos del año lectivo activo
// ============================================================
monitorRouter.get("/modules", requireAuth, requireMonitor, async (req, res) => {
  try {
    const course = await getMonitorCourse(req, res);
    if (!course) return;

    // Solo módulos que tienen al menos una materia para el nivel y año del curso del monitor
    const { data: classRows, error: cErr } = await supabaseAdmin
      .from("class")
      .select("id_module")
      .eq("level", course.level)
      .eq("year", course.year);

    if (cErr) return res.status(500).json({ error: cErr.message });

    const moduleIds = [...new Set((classRows || []).map((r) => r.id_module))];
    if (!moduleIds.length) return res.json({ items: [] });

    const { data, error } = await supabaseAdmin
      .from("module")
      .select("id,name")
      .in("id", moduleIds)
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T19 — GET /api/monitor/classes?module_id=X
// Materias del módulo filtradas por nivel del curso del monitor
// ============================================================
monitorRouter.get("/classes", requireAuth, requireMonitor, async (req, res) => {
  try {
    const moduleRaw = String(req.query.module_id || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    if (!moduleRaw) return res.status(400).json({ error: "module_id requerido" });

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    let query = supabaseAdmin
      .from("class")
      .select("id,name")
      .eq("level", course.level)
      .eq("year", course.year)
      .order("name", { ascending: true });

    if (moduleId !== "todos") query = query.eq("id_module", moduleId);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T20 — GET /api/monitor/teacher?class_id=X
// Profesor asignado a la materia en el curso del monitor
// ============================================================
monitorRouter.get("/teacher", requireAuth, requireMonitor, async (req, res) => {
  try {
    const classId = Number(req.query.class_id || 0);
    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    const { data: ct, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_teacher")
      .eq("id_class", classId)
      .eq("id_course", course.id)
      .maybeSingle();

    if (ctErr) return res.status(500).json({ error: ctErr.message });
    if (!ct) return res.json({ teacher: null });

    const { data: userRow } = await supabaseAdmin
      .from("users")
      .select("id,name")
      .eq("id", ct.id_teacher)
      .maybeSingle();

    return res.json({
      teacher: {
        id: ct.id_teacher,
        name: userRow?.name ?? null,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T21 — GET /api/monitor/attendance/session
// Carga sesión existente con su detalle de estudiantes
// Query params: module_id, class_id, fecha (YYYY-MM-DD)
// ============================================================
monitorRouter.get("/attendance/session", requireAuth, requireMonitor, async (req, res) => {
  try {
    const moduleId = Number(req.query.module_id || 0);
    const classId  = Number(req.query.class_id  || 0);
    const fecha    = String(req.query.fecha || "").trim();

    if (!moduleId || !classId || !fecha) {
      return res.status(400).json({ error: "module_id, class_id y fecha son requeridos" });
    }

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    // Buscar sesión existente
    const { data: sesion, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_teacher,profesor_asistio,profesor_reemplazo")
      .eq("id_course", course.id)
      .eq("id_module", moduleId)
      .eq("id_class", classId)
      .eq("fecha_clase", fecha)
      .maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesion) return res.json({ sesion: null, detalle: [] });

    // Cargar detalle
    const { data: detalle, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_student,asistio,motivo")
      .eq("id_sesion", sesion.id);

    if (dErr) return res.status(500).json({ error: dErr.message });

    return res.json({ sesion, detalle: detalle || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T22 — POST /api/monitor/attendance
// Crear o actualizar sesión + detalle completo (upsert)
// ============================================================
monitorRouter.post("/attendance", requireAuth, requireMonitor, async (req, res) => {
  try {
    const {
      id_course,
      id_module,
      id_class,
      fecha_clase,
      id_teacher,
      profesor_asistio,
      profesor_reemplazo,
      detalle,
    } = req.body;

    // Validar curso del monitor
    if (!validateCourse(req, res, id_course)) return;

    if (!id_module || !id_class || !fecha_clase || !id_teacher) {
      return res.status(400).json({ error: "module, class, fecha y teacher son requeridos" });
    }

    if (!Array.isArray(detalle) || detalle.length === 0) {
      return res.status(400).json({ error: "detalle de estudiantes requerido" });
    }

    // Validar que el año lectivo esté activo
    const { data: courseRow } = await supabaseAdmin
      .from("course")
      .select("year")
      .eq("id", id_course)
      .maybeSingle();

    if (!courseRow) return res.status(404).json({ error: "Curso no encontrado" });

    const { data: anioRow } = await supabaseAdmin
      .from("anio_lectivo")
      .select("activo")
      .eq("year", courseRow.year)
      .maybeSingle();

    if (!anioRow?.activo) {
      return res.status(403).json({ error: "Solo se puede registrar asistencia en el año lectivo activo" });
    }

    // Validar que la fecha no sea futura
    const today = new Date().toISOString().slice(0, 10);
    if (fecha_clase > today) {
      return res.status(400).json({ error: "La fecha de clase no puede ser futura" });
    }

    // Upsert sesión
    const { data: sesion, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .upsert(
        {
          id_course: Number(id_course),
          id_module: Number(id_module),
          id_class:  Number(id_class),
          fecha_clase,
          id_teacher,
          profesor_asistio: Boolean(profesor_asistio),
          profesor_reemplazo: profesor_asistio ? null : (profesor_reemplazo || null),
        },
        { onConflict: "id_course,id_module,id_class,fecha_clase" }
      )
      .select("id")
      .maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });

    // Upsert detalle por estudiante
    const detalleRows = detalle.map((d) => ({
      id_sesion:  sesion.id,
      id_student: d.id_student,
      asistio:    Boolean(d.asistio),
      motivo:     d.asistio ? "sin información" : (d.motivo || "sin información"),
    }));

    const { error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .upsert(detalleRows, { onConflict: "id_sesion,id_student" });

    if (dErr) return res.status(500).json({ error: dErr.message });

    return res.json({ ok: true, id_sesion: sesion.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T23 — GET /api/monitor/attendance/fechas
// Fechas con sesiones registradas para módulo+materia del curso
// Query params: module_id, class_id
// ============================================================
monitorRouter.get("/attendance/fechas", requireAuth, requireMonitor, async (req, res) => {
  try {
    const moduleRaw = String(req.query.module_id || "");
    const classRaw  = String(req.query.class_id  || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId   = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!moduleRaw || !classRaw) {
      return res.status(400).json({ error: "module_id y class_id requeridos" });
    }

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    let query = supabaseAdmin
      .from("asistencia_sesion")
      .select("id,fecha_clase")
      .eq("id_course", course.id)
      .order("fecha_clase", { ascending: false });

    if (moduleId !== "todos") query = query.eq("id_module", moduleId);
    if (classId  !== "todas") query = query.eq("id_class",  classId);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const seen = new Set();
    const items = (data || []).filter((r) => {
      if (seen.has(r.fecha_clase)) return false;
      seen.add(r.fecha_clase);
      return true;
    }).map((r) => ({ id: r.id, fecha_clase: r.fecha_clase }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T24 — GET /api/monitor/attendance/consulta
// Sesión + detalle completo en modo lectura
// Query params: module_id, class_id, fecha (YYYY-MM-DD)
// ============================================================
monitorRouter.get("/attendance/consulta", requireAuth, requireMonitor, async (req, res) => {
  try {
    const moduleId = Number(req.query.module_id || 0);
    const classId  = Number(req.query.class_id  || 0);
    const fecha    = String(req.query.fecha || "").trim();

    if (!moduleId || !classId || !fecha) {
      return res.status(400).json({ error: "module_id, class_id y fecha son requeridos" });
    }

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    const { data: sesion, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_teacher,profesor_asistio,profesor_reemplazo")
      .eq("id_course", course.id)
      .eq("id_module", moduleId)
      .eq("id_class", classId)
      .eq("fecha_clase", fecha)
      .maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    // Nombre del profesor
    const { data: teacherRow } = await supabaseAdmin
      .from("users")
      .select("name")
      .eq("id", sesion.id_teacher)
      .maybeSingle();

    // Detalle con nombre del estudiante
    const { data: detalleRows, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_student,asistio,motivo")
      .eq("id_sesion", sesion.id);

    if (dErr) return res.status(500).json({ error: dErr.message });

    // Cargar nombres de estudiantes
    const studentIds = (detalleRows || []).map((d) => d.id_student);
    let userMap = new Map();
    if (studentIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from("users")
        .select("id,name,cedula")
        .in("id", studentIds);
      userMap = new Map((usersData || []).map((u) => [u.id, u]));
    }

    const detalle = (detalleRows || [])
      .map((d) => ({
        id_student: d.id_student,
        name:       userMap.get(d.id_student)?.name   ?? null,
        cedula:     userMap.get(d.id_student)?.cedula ?? null,
        asistio:    d.asistio,
        motivo:     d.motivo,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

    return res.json({
      sesion: {
        ...sesion,
        teacher_name: teacherRow?.name ?? null,
      },
      detalle,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// GET /api/monitor/attendance/consulta-todas
// Todas las sesiones + detalle (modo "Todas las fechas" / "Todas las materias")
// Query params: module_id (o "todos"), class_id (o "todas"), fecha? (filtro opcional)
// ============================================================
monitorRouter.get("/attendance/consulta-todas", requireAuth, requireMonitor, async (req, res) => {
  try {
    const moduleRaw  = String(req.query.module_id || "");
    const classRaw   = String(req.query.class_id  || "");
    const fechaFiltro = String(req.query.fecha    || "").trim();
    const moduleId   = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId    = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!moduleRaw || !classRaw) {
      return res.status(400).json({ error: "module_id y class_id son requeridos" });
    }

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    let query = supabaseAdmin
      .from("asistencia_sesion")
      .select("id,fecha_clase,id_teacher,profesor_asistio,profesor_reemplazo,id_class,class:id_class(id,name)")
      .eq("id_course", course.id)
      .order("fecha_clase", { ascending: true });

    if (moduleId    !== "todos") query = query.eq("id_module",   moduleId);
    if (classId     !== "todas") query = query.eq("id_class",    classId);
    if (fechaFiltro)             query = query.eq("fecha_clase", fechaFiltro);

    const { data: sesiones, error: sErr } = await query;
    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesiones?.length) return res.json({ fechas: [], detalle: [] });

    const teacherIds = [...new Set(sesiones.map((s) => s.id_teacher).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length > 0) {
      const { data: teachersData } = await supabaseAdmin
        .from("users").select("id,name").in("id", teacherIds);
      teacherMap = new Map((teachersData || []).map((u) => [u.id, u.name]));
    }

    const sesionIds = sesiones.map((s) => s.id);
    const fechasList = sesiones.map((s) => ({
      fecha:              s.fecha_clase,
      class_id:           s.id_class   ?? null,
      class_name:         s.class?.name ?? null,
      teacher_name:       teacherMap.get(s.id_teacher) ?? null,
      profesor_asistio:   s.profesor_asistio,
      profesor_reemplazo: s.profesor_reemplazo ?? null,
    }));
    const sesionInfoMap = new Map(sesiones.map((s) => [s.id, { fecha: s.fecha_clase, class_id: s.id_class ?? null }]));

    const { data: detalleRows, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_sesion,id_student,asistio,motivo")
      .in("id_sesion", sesionIds);

    if (dErr) return res.status(500).json({ error: dErr.message });

    const studentIds = [...new Set((detalleRows || []).map((d) => d.id_student))];
    let userMap = new Map();
    if (studentIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from("users").select("id,name,cedula").in("id", studentIds);
      userMap = new Map((usersData || []).map((u) => [u.id, u]));
    }

    const studentMap = new Map();
    for (const d of (detalleRows || [])) {
      const info = sesionInfoMap.get(d.id_sesion);
      if (!info) continue;
      if (!studentMap.has(d.id_student)) {
        studentMap.set(d.id_student, {
          id_student: d.id_student,
          name:   userMap.get(d.id_student)?.name   ?? null,
          cedula: userMap.get(d.id_student)?.cedula ?? null,
          asistencia: [],
        });
      }
      studentMap.get(d.id_student).asistencia.push({
        fecha: info.fecha, class_id: info.class_id, asistio: d.asistio, motivo: d.motivo ?? "",
      });
    }

    const detalle = [...studentMap.values()]
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

    return res.json({ fechas: fechasList, detalle });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T26 — GET /api/monitor/attendance/reporte
// Reporte consolidado: estudiantes × materias con total inasistencias
// ============================================================
monitorRouter.get("/attendance/reporte", requireAuth, requireMonitor, async (req, res) => {
  try {
    const course = await getMonitorCourse(req, res);
    if (!course) return;

    // Todas las sesiones del curso
    const { data: sesiones, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_class,class:class(id,name)")
      .eq("id_course", course.id);

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesiones?.length) return res.json({ students: [], classes: [], rows: [] });

    const sesionIds = sesiones.map((s) => s.id);

    // Detalle de inasistencias (solo asistio = false)
    const { data: detalle, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_sesion,id_student,asistio")
      .in("id_sesion", sesionIds)
      .eq("asistio", false);

    if (dErr) return res.status(500).json({ error: dErr.message });

    // Estudiantes del curso
    const { data: typeRow } = await supabaseAdmin
      .from("type").select("id").eq("code", "S").maybeSingle();

    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id,name,cedula")
      .eq("id_course", course.id)
      .order("name", { ascending: true });

    const { data: roleRows } = await supabaseAdmin
      .from("user_type")
      .select("id_user")
      .eq("id_type", typeRow.id)
      .in("id_user", (users || []).map((u) => u.id));

    const studentSet = new Set((roleRows || []).map((r) => r.id_user));
    const students = (users || []).filter((u) => studentSet.has(u.id));

    // Materias únicas con sesiones
    const classMap = new Map();
    for (const s of sesiones) {
      if (s.class?.id && !classMap.has(s.class.id)) {
        classMap.set(s.class.id, s.class.name);
      }
    }
    const classes = [...classMap.entries()].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    // Mapa sesion → class_id
    const sesionClassMap = new Map(sesiones.map((s) => [s.id, s.id_class]));

    // Pivot: student_id → class_id → count
    const pivot = new Map();
    for (const d of (detalle || [])) {
      const classId = sesionClassMap.get(d.id_sesion);
      if (!classId) continue;
      if (!pivot.has(d.id_student)) pivot.set(d.id_student, new Map());
      const byClass = pivot.get(d.id_student);
      byClass.set(classId, (byClass.get(classId) || 0) + 1);
    }

    const rows = students.map((s) => {
      const byClass = pivot.get(s.id) || new Map();
      const counts  = classes.map((c) => byClass.get(c.id) || 0);
      const total   = counts.reduce((a, b) => a + b, 0);
      return { id: s.id, name: s.name, cedula: s.cedula, counts, total };
    });

    return res.json({ students, classes, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
