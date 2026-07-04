import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";

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

  const { rows } = await query(
    `SELECT id, name, year, level FROM course WHERE id = $1 LIMIT 1`,
    [courseId]
  );
  const course = rows[0];

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
    const { rows: typeRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
    const typeRow = typeRows[0];
    if (!typeRow?.id) return res.status(500).json({ error: "Tipo S no encontrado" });

    // Usuarios del curso con rol S
    const { rows: users } = await query(
      `SELECT id, name, cedula FROM users WHERE id_course = $1 ORDER BY name ASC`,
      [course.id]
    );

    const { rows: roleRows } = await query(
      `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
      [typeRow.id, users.map((u) => u.id)]
    );

    const studentSet = new Set(roleRows.map((r) => r.id_user));
    const students = users.filter((u) => studentSet.has(u.id));

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
    const { rows: typeRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["T"]);
    const typeRow = typeRows[0];
    if (!typeRow?.id) return res.status(500).json({ error: "Tipo T no encontrado" });

    const { rows: roleRows } = await query(`SELECT id_user FROM user_type WHERE id_type = $1`, [typeRow.id]);

    const teacherIds = roleRows.map((r) => r.id_user);
    if (!teacherIds.length) return res.json({ items: [] });

    const { rows: users } = await query(
      `SELECT id, name FROM users WHERE id = ANY($1::uuid[]) ORDER BY name ASC`,
      [teacherIds]
    );

    return res.json({ items: users });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ============================================================
// T18 — GET /api/monitor/modules
// Módulos del año lectivo activo
// ============================================================
monitorRouter.get("/levels", requireAuth, requireMonitor, async (req, res) => {
  try {
    const { rows } = await query(`SELECT id, name FROM level ORDER BY id ASC`);
    return res.json({ items: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

monitorRouter.get("/modules", requireAuth, requireMonitor, async (req, res) => {
  try {
    const course = await getMonitorCourse(req, res);
    if (!course) return;

    // Solo módulos que tienen al menos una materia para el nivel y año del curso del monitor
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

    let sql = `SELECT id, name, id_module FROM class WHERE level = $1 AND year = $2`;
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
// T20 — GET /api/monitor/teacher?class_id=X
// Profesor asignado a la materia en el curso del monitor
// ============================================================
monitorRouter.get("/teacher", requireAuth, requireMonitor, async (req, res) => {
  try {
    const classId = Number(req.query.class_id || 0);
    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const course = await getMonitorCourse(req, res);
    if (!course) return;

    const { rows: ctRows } = await query(
      `SELECT id_teacher FROM class_teacher WHERE id_class = $1 AND id_course = $2 LIMIT 1`,
      [classId, course.id]
    );
    const ct = ctRows[0];
    if (!ct) return res.json({ teacher: null });

    const { rows: userRows } = await query(
      `SELECT id, name FROM users WHERE id = $1 LIMIT 1`,
      [ct.id_teacher]
    );

    return res.json({
      teacher: {
        id: ct.id_teacher,
        name: userRows[0]?.name ?? null,
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
    const { rows: sesionRows } = await query(
      `SELECT id, id_teacher, profesor_asistio, profesor_reemplazo FROM asistencia_sesion
       WHERE id_course = $1 AND id_module = $2 AND id_class = $3 AND fecha_clase = $4
       LIMIT 1`,
      [course.id, moduleId, classId, fecha]
    );
    const sesion = sesionRows[0];
    if (!sesion) return res.json({ sesion: null, detalle: [] });

    // Cargar detalle
    const { rows: detalle } = await query(
      `SELECT id_student, asistio, motivo FROM asistencia_detalle WHERE id_sesion = $1`,
      [sesion.id]
    );

    return res.json({ sesion, detalle });
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
    const { rows: courseRows } = await query(`SELECT year FROM course WHERE id = $1 LIMIT 1`, [id_course]);
    const courseRow = courseRows[0];
    if (!courseRow) return res.status(404).json({ error: "Curso no encontrado" });

    const { rows: anioRows } = await query(
      `SELECT activo FROM anio_lectivo WHERE year = $1 LIMIT 1`,
      [courseRow.year]
    );
    const anioRow = anioRows[0];

    if (!anioRow?.activo) {
      return res.status(403).json({ error: "Solo se puede registrar asistencia en el año lectivo activo" });
    }

    // Validar que la fecha no sea futura
    const today = new Date().toISOString().slice(0, 10);
    if (fecha_clase > today) {
      return res.status(400).json({ error: "La fecha de clase no puede ser futura" });
    }

    // Upsert sesión
    const { rows: sesionRows } = await query(
      `INSERT INTO asistencia_sesion (id_course, id_module, id_class, fecha_clase, id_teacher, profesor_asistio, profesor_reemplazo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id_course, id_module, id_class, fecha_clase)
       DO UPDATE SET id_teacher = EXCLUDED.id_teacher,
                     profesor_asistio = EXCLUDED.profesor_asistio,
                     profesor_reemplazo = EXCLUDED.profesor_reemplazo
       RETURNING id`,
      [
        Number(id_course),
        Number(id_module),
        Number(id_class),
        fecha_clase,
        id_teacher,
        Boolean(profesor_asistio),
        profesor_asistio ? null : (profesor_reemplazo || null),
      ]
    );
    const sesion = sesionRows[0];

    // Upsert detalle por estudiante
    const detalleRows = detalle.map((d) => ({
      id_sesion:  sesion.id,
      id_student: d.id_student,
      asistio:    Boolean(d.asistio),
      motivo:     d.asistio ? "sin información" : (d.motivo || "sin información"),
    }));

    const values = [];
    const placeholders = detalleRows.map((row, idx) => {
      const base = idx * 4;
      values.push(row.id_sesion, row.id_student, row.asistio, row.motivo);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    await query(
      `INSERT INTO asistencia_detalle (id_sesion, id_student, asistio, motivo)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id_sesion, id_student)
       DO UPDATE SET asistio = EXCLUDED.asistio, motivo = EXCLUDED.motivo`,
      values
    );

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

    let sql = `SELECT id, fecha_clase FROM asistencia_sesion WHERE id_course = $1`;
    const params = [course.id];

    if (moduleId !== "todos") { params.push(moduleId); sql += ` AND id_module = $${params.length}`; }
    if (classId  !== "todas") { params.push(classId);  sql += ` AND id_class = $${params.length}`; }
    sql += ` ORDER BY fecha_clase DESC`;

    const { rows: data } = await query(sql, params);

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

    const { rows: sesionRows } = await query(
      `SELECT id, id_teacher, profesor_asistio, profesor_reemplazo FROM asistencia_sesion
       WHERE id_course = $1 AND id_module = $2 AND id_class = $3 AND fecha_clase = $4
       LIMIT 1`,
      [course.id, moduleId, classId, fecha]
    );
    const sesion = sesionRows[0];
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    // Nombre del profesor
    const { rows: teacherRows } = await query(`SELECT name FROM users WHERE id = $1 LIMIT 1`, [sesion.id_teacher]);
    const teacherRow = teacherRows[0];

    // Detalle con nombre del estudiante
    const { rows: detalleRows } = await query(
      `SELECT id_student, asistio, motivo FROM asistencia_detalle WHERE id_sesion = $1`,
      [sesion.id]
    );

    // Cargar nombres de estudiantes
    const studentIds = detalleRows.map((d) => d.id_student);
    let userMap = new Map();
    if (studentIds.length > 0) {
      const { rows: usersData } = await query(
        `SELECT id, name, cedula FROM users WHERE id = ANY($1::uuid[])`,
        [studentIds]
      );
      userMap = new Map(usersData.map((u) => [u.id, u]));
    }

    const detalle = detalleRows
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

    let sql = `SELECT s.id, s.fecha_clase, s.id_teacher, s.profesor_asistio, s.profesor_reemplazo, s.id_class,
                      c.id AS class_id, c.name AS class_name
               FROM asistencia_sesion s
               LEFT JOIN class c ON c.id = s.id_class
               WHERE s.id_course = $1`;
    const params = [course.id];

    if (moduleId    !== "todos") { params.push(moduleId);    sql += ` AND s.id_module = $${params.length}`; }
    if (classId     !== "todas") { params.push(classId);     sql += ` AND s.id_class = $${params.length}`; }
    if (fechaFiltro)             { params.push(fechaFiltro); sql += ` AND s.fecha_clase = $${params.length}`; }
    sql += ` ORDER BY s.fecha_clase ASC`;

    const { rows: sesiones } = await query(sql, params);
    if (!sesiones.length) return res.json({ fechas: [], detalle: [] });

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
        `SELECT id, name, cedula FROM users WHERE id = ANY($1::uuid[])`,
        [studentIds]
      );
      userMap = new Map(usersData.map((u) => [u.id, u]));
    }

    const studentMap = new Map();
    for (const d of detalleRows) {
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
    const { rows: sesiones } = await query(
      `SELECT s.id, s.id_class, c.id AS class_id, c.name AS class_name
       FROM asistencia_sesion s
       LEFT JOIN class c ON c.id = s.id_class
       WHERE s.id_course = $1`,
      [course.id]
    );
    if (!sesiones.length) return res.json({ students: [], classes: [], rows: [] });

    const sesionIds = sesiones.map((s) => s.id);

    // Detalle de inasistencias (solo asistio = false)
    const { rows: detalle } = await query(
      `SELECT id_sesion, id_student, asistio FROM asistencia_detalle
       WHERE id_sesion = ANY($1::bigint[]) AND asistio = false`,
      [sesionIds]
    );

    // Estudiantes del curso
    const { rows: typeRows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
    const typeRow = typeRows[0];

    const { rows: users } = await query(
      `SELECT id, name, cedula FROM users WHERE id_course = $1 ORDER BY name ASC`,
      [course.id]
    );

    const { rows: roleRows } = await query(
      `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
      [typeRow.id, users.map((u) => u.id)]
    );

    const studentSet = new Set(roleRows.map((r) => r.id_user));
    const students = users.filter((u) => studentSet.has(u.id));

    // Materias únicas con sesiones
    const classMap = new Map();
    for (const s of sesiones) {
      if (s.class_id && !classMap.has(s.class_id)) {
        classMap.set(s.class_id, s.class_name);
      }
    }
    const classes = [...classMap.entries()].map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    // Mapa sesion → class_id
    const sesionClassMap = new Map(sesiones.map((s) => [s.id, s.id_class]));

    // Pivot: student_id → class_id → count
    const pivot = new Map();
    for (const d of detalle) {
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
