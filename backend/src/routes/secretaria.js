import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const secretariaRouter = Router();

// ===== Middleware: solo Secretaria =====
function requireSecretaria(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("E")) return res.status(403).json({ error: "Solo Secretaría" });
  return next();
}

// ============================================================
// GET /api/secretaria/attendance/courses
// Todos los cursos (para el selector)
// ============================================================
secretariaRouter.get("/attendance/courses", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("course")
      .select("id,name,year,level")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// GET /api/secretaria/attendance/modules?course_id=X
// Módulos con materias para el nivel y año del curso
// ============================================================
secretariaRouter.get("/attendance/modules", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId = Number(req.query.course_id || 0);
    if (!courseId) return res.status(400).json({ error: "course_id requerido" });

    const { data: course, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name,year,level")
      .eq("id", courseId)
      .maybeSingle();

    if (cErr) return res.status(500).json({ error: cErr.message });
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

    const { data: classRows, error: crErr } = await supabaseAdmin
      .from("class")
      .select("id_module")
      .eq("level", course.level)
      .eq("year", course.year);

    if (crErr) return res.status(500).json({ error: crErr.message });

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
// GET /api/secretaria/attendance/classes?course_id=X&module_id=Y
// Materias del módulo para el nivel del curso
// ============================================================
secretariaRouter.get("/attendance/classes", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId  = Number(req.query.course_id || 0);
    const moduleRaw = String(req.query.module_id || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    if (!courseId)  return res.status(400).json({ error: "course_id requerido" });
    if (!moduleRaw) return res.status(400).json({ error: "module_id requerido" });

    const { data: course, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name,year,level")
      .eq("id", courseId)
      .maybeSingle();

    if (cErr) return res.status(500).json({ error: cErr.message });
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

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
// GET /api/secretaria/attendance/fechas?course_id=X&module_id=Y&class_id=Z
// Fechas con sesiones registradas
// ============================================================
secretariaRouter.get("/attendance/fechas", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId  = Number(req.query.course_id || 0);
    const moduleRaw = String(req.query.module_id || "");
    const classRaw  = String(req.query.class_id  || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId   = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!courseId || !moduleRaw || !classRaw) {
      return res.status(400).json({ error: "course_id, module_id y class_id requeridos" });
    }

    let query = supabaseAdmin
      .from("asistencia_sesion")
      .select("id,fecha_clase")
      .eq("id_course", courseId)
      .order("fecha_clase", { ascending: false });

    if (moduleId !== "todos") query = query.eq("id_module", moduleId);
    if (classId  !== "todas") query = query.eq("id_class",  classId);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Deduplica fechas cuando hay múltiples materias
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
// GET /api/secretaria/attendance/consulta?course_id=X&module_id=Y&class_id=Z&fecha=YYYY-MM-DD
// Sesión + detalle completo en modo lectura
// ============================================================
secretariaRouter.get("/attendance/consulta", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId = Number(req.query.course_id || 0);
    const moduleId = Number(req.query.module_id || 0);
    const classId  = Number(req.query.class_id  || 0);
    const fecha    = String(req.query.fecha || "").trim();

    if (!courseId || !moduleId || !classId || !fecha) {
      return res.status(400).json({ error: "course_id, module_id, class_id y fecha son requeridos" });
    }

    const { data: sesion, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_teacher,profesor_asistio,profesor_reemplazo")
      .eq("id_course", courseId)
      .eq("id_module", moduleId)
      .eq("id_class", classId)
      .eq("fecha_clase", fecha)
      .maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    const { data: teacherRow } = await supabaseAdmin
      .from("users")
      .select("name")
      .eq("id", sesion.id_teacher)
      .maybeSingle();

    const { data: detalleRows, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_student,asistio,motivo")
      .eq("id_sesion", sesion.id);

    if (dErr) return res.status(500).json({ error: dErr.message });

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
// GET /api/secretaria/attendance/consulta-todas?course_id=X&module_id=Y&class_id=Z
// Todas las sesiones + detalle para la materia (modo "Todas las fechas")
// ============================================================
secretariaRouter.get("/attendance/consulta-todas", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId  = Number(req.query.course_id || 0);
    const moduleRaw = String(req.query.module_id || "");
    const classRaw  = String(req.query.class_id  || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId   = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!courseId || !moduleRaw || !classRaw) {
      return res.status(400).json({ error: "course_id, module_id y class_id son requeridos" });
    }

    const fechaFiltro = String(req.query.fecha || "").trim();

    let query = supabaseAdmin
      .from("asistencia_sesion")
      .select("id,fecha_clase,id_teacher,profesor_asistio,profesor_reemplazo,id_class,class:id_class(id,name)")
      .eq("id_course", courseId)
      .order("fecha_clase", { ascending: true });

    if (moduleId   !== "todos") query = query.eq("id_module",   moduleId);
    if (classId    !== "todas") query = query.eq("id_class",    classId);
    if (fechaFiltro)            query = query.eq("fecha_clase", fechaFiltro);

    const { data: sesiones, error: sErr } = await query;

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesiones?.length) return res.json({ fechas: [], detalle: [] });

    // Cargar nombres de profesores
    const teacherIds = [...new Set(sesiones.map((s) => s.id_teacher).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length > 0) {
      const { data: teachersData } = await supabaseAdmin
        .from("users")
        .select("id,name")
        .in("id", teacherIds);
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
        .from("users")
        .select("id,name,cedula")
        .in("id", studentIds);
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
      studentMap.get(d.id_student).asistencia.push({ fecha: info.fecha, class_id: info.class_id, asistio: d.asistio, motivo: d.motivo ?? "" });
    }

    const detalle = [...studentMap.values()]
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

    return res.json({ fechas: fechasList, detalle });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// GET /api/secretaria/attendance/reporte?course_id=X
// Reporte consolidado: estudiantes × materias con total inasistencias
// ============================================================
secretariaRouter.get("/attendance/reporte", requireAuth, requireSecretaria, async (req, res) => {
  try {
    const courseId = Number(req.query.course_id || 0);
    if (!courseId) return res.status(400).json({ error: "course_id requerido" });

    const { data: course, error: courseErr } = await supabaseAdmin
      .from("course")
      .select("id,name,year,level")
      .eq("id", courseId)
      .maybeSingle();

    if (courseErr) return res.status(500).json({ error: courseErr.message });
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

    const { data: sesiones, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_class,class:class(id,name)")
      .eq("id_course", courseId);

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesiones?.length) return res.json({ students: [], classes: [], rows: [] });

    const sesionIds = sesiones.map((s) => s.id);

    const { data: detalle, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle")
      .select("id_sesion,id_student,asistio")
      .in("id_sesion", sesionIds)
      .eq("asistio", false);

    if (dErr) return res.status(500).json({ error: dErr.message });

    const { data: typeRow } = await supabaseAdmin
      .from("type").select("id").eq("code", "S").maybeSingle();

    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id,name,cedula")
      .eq("id_course", courseId)
      .order("name", { ascending: true });

    const { data: roleRows } = await supabaseAdmin
      .from("user_type")
      .select("id_user")
      .eq("id_type", typeRow.id)
      .in("id_user", (users || []).map((u) => u.id));

    const studentSet = new Set((roleRows || []).map((r) => r.id_user));
    const students = (users || []).filter((u) => studentSet.has(u.id));

    const classMap = new Map();
    for (const s of sesiones) {
      if (s.class?.id && !classMap.has(s.class.id)) {
        classMap.set(s.class.id, s.class.name);
      }
    }
    const classes = [...classMap.entries()].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    const sesionClassMap = new Map(sesiones.map((s) => [s.id, s.id_class]));

    const pivot = new Map();
    for (const d of (detalle || [])) {
      const cId = sesionClassMap.get(d.id_sesion);
      if (!cId) continue;
      if (!pivot.has(d.id_student)) pivot.set(d.id_student, new Map());
      const byClass = pivot.get(d.id_student);
      byClass.set(cId, (byClass.get(cId) || 0) + 1);
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
