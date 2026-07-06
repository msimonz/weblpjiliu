import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";

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
    const { rows } = await query(
      `SELECT id, name, year, level FROM course ORDER BY name ASC`
    );
    return res.json({ items: rows });
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

    const { rows: courseRows } = await query(
      `SELECT id, name, year, level FROM course WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    const course = courseRows[0];
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

    const { rows: classRows } = await query(
      `SELECT id_module FROM class WHERE level = $1 AND year = $2`,
      [course.level, course.year]
    );

    const moduleIds = [...new Set(classRows.map((r) => r.id_module))];
    if (!moduleIds.length) return res.json({ items: [] });

    const { rows } = await query(
      `SELECT id, name FROM module WHERE id = ANY($1::bigint[]) ORDER BY name ASC`,
      [moduleIds]
    );

    return res.json({ items: rows });
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

    const { rows: courseRows } = await query(
      `SELECT id, name, year, level FROM course WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    const course = courseRows[0];
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

    let sql = `SELECT id, name FROM class WHERE level = $1 AND year = $2`;
    const params = [course.level, course.year];

    if (moduleId !== "todos") {
      params.push(moduleId);
      sql += ` AND id_module = $${params.length} ORDER BY orden ASC`;
    } else {
      sql += ` ORDER BY name ASC`;
    }

    const { rows } = await query(sql, params);
    return res.json({ items: rows });
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

    let sql = `SELECT id, fecha_clase FROM asistencia_sesion WHERE id_course = $1`;
    const params = [courseId];

    if (moduleId !== "todos") { params.push(moduleId); sql += ` AND id_module = $${params.length}`; }
    if (classId  !== "todas") { params.push(classId);  sql += ` AND id_class = $${params.length}`; }
    sql += ` ORDER BY fecha_clase DESC`;

    const { rows: data } = await query(sql, params);

    // Deduplica fechas cuando hay múltiples materias
    const seen = new Set();
    const items = data.filter((r) => {
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

    const { rows: sesionRows } = await query(
      `SELECT id, id_teacher, profesor_asistio, profesor_reemplazo FROM asistencia_sesion
       WHERE id_course = $1 AND id_module = $2 AND id_class = $3 AND fecha_clase = $4
       LIMIT 1`,
      [courseId, moduleId, classId, fecha]
    );
    const sesion = sesionRows[0];
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    const { rows: teacherRows } = await query(`SELECT name FROM users WHERE id = $1 LIMIT 1`, [sesion.id_teacher]);
    const teacherRow = teacherRows[0];

    const { rows: detalleRows } = await query(
      `SELECT id_student, asistio, motivo FROM asistencia_detalle WHERE id_sesion = $1`,
      [sesion.id]
    );

    const studentIds = detalleRows.map((d) => d.id_student);
    let userMap = new Map();
    if (studentIds.length > 0) {
      const { rows: usersData } = await query(
        `SELECT id, name, cedula FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo'`,
        [studentIds]
      );
      userMap = new Map(usersData.map((u) => [u.id, u]));
    }

    const detalle = detalleRows
      .filter((d) => userMap.has(d.id_student))
      .map((d) => ({
        id_student: d.id_student,
        name:       userMap.get(d.id_student).name,
        cedula:     userMap.get(d.id_student).cedula,
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

    let sql = `SELECT s.id, s.fecha_clase, s.id_teacher, s.profesor_asistio, s.profesor_reemplazo, s.id_class,
                      c.id AS class_id, c.name AS class_name
               FROM asistencia_sesion s
               LEFT JOIN class c ON c.id = s.id_class
               WHERE s.id_course = $1`;
    const params = [courseId];

    if (moduleId   !== "todos") { params.push(moduleId);    sql += ` AND s.id_module = $${params.length}`; }
    if (classId    !== "todas") { params.push(classId);     sql += ` AND s.id_class = $${params.length}`; }
    if (fechaFiltro)            { params.push(fechaFiltro); sql += ` AND s.fecha_clase = $${params.length}`; }
    sql += ` ORDER BY s.fecha_clase ASC`;

    const { rows: sesiones } = await query(sql, params);
    if (!sesiones.length) return res.json({ fechas: [], detalle: [] });

    // Cargar nombres de profesores
    const teacherIds = [...new Set(sesiones.map((s) => s.id_teacher).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length > 0) {
      const { rows: teachersData } = await query(
        `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`,
        [teacherIds]
      );
      teacherMap = new Map(teachersData.map((u) => [u.id, u.name]));
    }

    const sesionIds = sesiones.map((s) => s.id);
    const fechasList = sesiones.map((s) => ({
      fecha:              s.fecha_clase,
      class_id:           s.id_class   ?? null,
      class_name:         s.class_name ?? null,
      teacher_name:       teacherMap.get(s.id_teacher) ?? null,
      profesor_asistio:   s.profesor_asistio,
      profesor_reemplazo: s.profesor_reemplazo ?? null,
    }));
    const sesionInfoMap = new Map(sesiones.map((s) => [s.id, { fecha: s.fecha_clase, class_id: s.id_class ?? null }]));

    const { rows: detalleRows } = await query(
      `SELECT id_sesion, id_student, asistio, motivo FROM asistencia_detalle WHERE id_sesion = ANY($1::bigint[])`,
      [sesionIds]
    );

    const studentIds = [...new Set(detalleRows.map((d) => d.id_student))];
    let userMap = new Map();
    if (studentIds.length > 0) {
      const { rows: usersData } = await query(
        `SELECT id, name, cedula FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo'`,
        [studentIds]
      );
      userMap = new Map(usersData.map((u) => [u.id, u]));
    }

    const studentMap = new Map();
    for (const d of detalleRows) {
      const info = sesionInfoMap.get(d.id_sesion);
      if (!info) continue;
      if (!userMap.has(d.id_student)) continue; // alumno retirado: no aparece ni en histórico
      if (!studentMap.has(d.id_student)) {
        studentMap.set(d.id_student, {
          id_student: d.id_student,
          name:   userMap.get(d.id_student).name,
          cedula: userMap.get(d.id_student).cedula,
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

    const { rows: courseRows } = await query(
      `SELECT id, name, year, level FROM course WHERE id = $1 LIMIT 1`,
      [courseId]
    );
    const course = courseRows[0];
    if (!course) return res.status(404).json({ error: "Curso no encontrado" });

    const { rows: sesiones } = await query(
      `SELECT s.id, s.id_class, c.id AS class_id, c.name AS class_name
       FROM asistencia_sesion s
       LEFT JOIN class c ON c.id = s.id_class
       WHERE s.id_course = $1`,
      [courseId]
    );
    if (!sesiones.length) return res.json({ students: [], classes: [], rows: [] });

    const sesionIds = sesiones.map((s) => s.id);

    const { rows: detalle } = await query(
      `SELECT id_sesion, id_student, asistio FROM asistencia_detalle
       WHERE id_sesion = ANY($1::bigint[]) AND asistio = false`,
      [sesionIds]
    );

    const { rows: typeRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
    const typeRow = typeRows[0];

    const { rows: users } = await query(
      `SELECT id, name, cedula FROM users WHERE id_course = $1 AND estado = 'Activo' ORDER BY name ASC`,
      [courseId]
    );

    const { rows: roleRows } = await query(
      `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
      [typeRow.id, users.map((u) => u.id)]
    );

    const studentSet = new Set(roleRows.map((r) => r.id_user));
    const students = users.filter((u) => studentSet.has(u.id));

    const classMap = new Map();
    for (const s of sesiones) {
      if (s.class_id && !classMap.has(s.class_id)) {
        classMap.set(s.class_id, s.class_name);
      }
    }
    const classes = [...classMap.entries()].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    const sesionClassMap = new Map(sesiones.map((s) => [s.id, s.id_class]));

    const pivot = new Map();
    for (const d of detalle) {
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
