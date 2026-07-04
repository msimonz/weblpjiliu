import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";
import { requireAnioVigenteForCourse, handleYearError } from "../lib/anioLectivo.js";
import { closeExpiredExams } from "../lib/examClosure.js";

export const studentRouter = Router();

const PASS_GRADE = 70;

// ✅ helper: curso real del estudiante (fijo)
async function getStudentCourse(req, res) {
  const courseId = Number(req.auth.profile?.id_course || 0);

  if (!courseId) {
    res.status(400).json({ error: "El usuario no tiene id_course en el profile" });
    return null;
  }

  const { rows } = await query(
    `SELECT id, year, level, name FROM course WHERE id = $1 LIMIT 1`,
    [courseId]
  );
  const course = rows[0];

  if (!course?.id) {
    res.status(404).json({ error: "El course del usuario no existe" });
    return null;
  }

  return course;
}

// ✅ helper: valida level solicitado vs level real del estudiante
function checkLevelAllowed(level, course) {
  return Number(level) === Number(course.level);
}

async function getHistoryCourse(userId, requestedCourseId) {
  const { rows } = await query(
    `SELECT uh.id_course, c.id, c.name, c.level, c.year
     FROM user_history uh
     JOIN course c ON c.id = uh.id_course
     WHERE uh.id_student = $1 AND uh.id_course = $2
     LIMIT 1`,
    [userId, requestedCourseId]
  );
  return rows[0] || null;
}

/**
 * Autocomplete de materias (tabla class)
 * GET /api/student/classes?level=1&q=mate
 *
 * ✅ Si el estudiante no ha cursado ese año => devuelve vacío.
 */
studentRouter.get("/classes", requireAuth, async (req, res) => {
  const level = Number(req.query.level || 1);
  const q = String(req.query.q || "").trim();

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!q) return res.json({ items: [] });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      items: [],
      course,
    });
  }

  const { rows } = await query(
    `SELECT id, name, level FROM class
     WHERE level = $1 AND year = $2 AND name ILIKE $3
     ORDER BY name ASC LIMIT 10`,
    [level, course.year, `%${q}%`]
  );

  return res.json({ blocked: false, items: rows, course });
});

/**
 * Lista de años lectivos registrados + año activo
 * GET /api/student/anio-lectivo
 */
studentRouter.get("/anio-lectivo", requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT year, nombre, activo FROM anio_lectivo ORDER BY year DESC`
    );
    return res.json({ items: rows });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo años lectivos" });
  }
});

/**
 * Niveles y cursos del estudiante (curso actual + historial)
 * GET /api/student/my-courses
 */
studentRouter.get("/my-courses", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const { rows: histRows } = await query(
    `SELECT c.id, c.name, c.level, c.year
     FROM user_history uh
     JOIN course c ON c.id = uh.id_course
     WHERE uh.id_student = $1`,
    [userId]
  );

  const coursesMap = new Map();
  coursesMap.set(course.id, course);
  for (const h of histRows) {
    if (h.id && !coursesMap.has(h.id)) {
      coursesMap.set(h.id, h);
    }
  }

  const items = Array.from(coursesMap.values())
    .sort((a, b) => Number(a.level) - Number(b.level));

  return res.json({ items, current_course_id: course.id });
});

/**
 * Resumen por materias del año
 * ✅ Debe devolver TODAS las materias del level, incluso si no tienen evaluaciones o notas.
 */
studentRouter.get("/subjects-summary", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const requestedCourseId = Number(req.query.course_id || 0);

  const studentCourse = await getStudentCourse(req, res);
  if (!studentCourse) return;

  // Resolver curso activo: actual o uno del historial del estudiante
  let activeCourse = studentCourse;
  if (requestedCourseId && requestedCourseId !== studentCourse.id) {
    const histEntry = await getHistoryCourse(userId, requestedCourseId);
    if (histEntry?.id) activeCourse = histEntry;
  }

  const level = Number(activeCourse.level);
  const activeCourseId = activeCourse.id;
  try {
    await closeExpiredExams({ studentId: userId, courseIds: [activeCourseId] });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cerrando exámenes vencidos" });
  }

  // 1) Traer TODAS las materias del nivel con módulo y grupo
  const { rows: classRows } = await query(
    `SELECT c.id, c.name, c.level, c.id_module, c.id_group, c.orden, m.id AS module_id, m.name AS module_name
     FROM class c
     LEFT JOIN module m ON m.id = c.id_module
     WHERE c.level = $1 AND c.year = $2
     ORDER BY c.name ASC`,
    [level, activeCourse.year]
  );

  const classes = classRows;

  if (classes.length === 0) {
    return res.json({
      blocked: false, course: activeCourse, items: [],
      stats: { passed: 0, failed: 0, pending: 0, avg_weighted: null, pass_grade: PASS_GRADE },
    });
  }

  // 1b) Obtener nombres de grupos
  const groupIds = [...new Set(classes.map(c => c.id_group).filter(Boolean))];
  let groupNameMap = new Map();
  if (groupIds.length > 0) {
    const { rows: grpData } = await query(
      `SELECT id, name FROM "group" WHERE id = ANY($1::bigint[])`,
      [groupIds]
    );
    for (const g of grpData) groupNameMap.set(Number(g.id), g.name);
  }

  // 2) Inicializar mapa con TODAS las materias
  const byClass = new Map();
  const byGroup = new Map();
  for (const cls of classes) {
    const classId = Number(cls.id);
    const groupId = cls.id_group ? Number(cls.id_group) : null;
    byClass.set(classId, {
      class_id: classId,
      name: String(cls.name ?? `Materia ${classId}`),
      module_name: cls.module_name ?? null,
      module_id: cls.id_module ? Number(cls.id_module) : null,
      group_id: groupId,
      group_name: groupId ? (groupNameMap.get(groupId) ?? null) : null,
      orden: cls.orden ?? null,
      sum: 0,
      sumPercent: 0,
      totalEvals: 0,
      closedEvals: 0,
    });

    if (groupId) {
      if (!byGroup.has(groupId)) {
        byGroup.set(groupId, {
          group_id: groupId,
          group_name: groupNameMap.get(groupId) ?? `Grupo ${groupId}`,
          module_name: cls.module_name ?? null,
          classes: [],
          sum: 0,
          sumPercent: 0,
          totalEvals: 0,
          closedEvals: 0,
        });
      }
      byGroup.get(groupId).classes.push({
        id: classId,
        name: String(cls.name ?? `Materia ${classId}`),
        orden: cls.orden ?? null,
      });
    }
  }

  // 3) Traer evaluaciones del curso activo (clase y grupo)
  const { rows: evaluations } = await query(
    `SELECT id, id_class, id_group, id_module, percent FROM evaluation WHERE id_course = $1`,
    [activeCourseId]
  );

  const evalIds = evaluations.map((e) => Number(e.id));

  // 4) Traer notas del estudiante
  let gradeRows = [];
  if (evalIds.length > 0) {
    const { rows: gradesData } = await query(
      `SELECT id_exam, grade, finished_at, attempts FROM grades WHERE id_student = $1 AND id_exam = ANY($2::bigint[])`,
      [userId, evalIds]
    );
    gradeRows = gradesData;
  }

  const gradeMap = new Map();
  for (const g of gradeRows) gradeMap.set(Number(g.id_exam), g);

  // 5) Acumular notas consolidadas por materia individual o por grupo.
  //    La nota final es SUM(nota * porcentaje / 100), sin normalizar por suma de porcentajes.
  for (const ev of evaluations) {
    const percent = Number(ev.percent ?? 0);
    const g = gradeMap.get(Number(ev.id)) ?? null;
    const grade = g?.finished_at && g?.grade != null ? Number(g.grade) : null;

    if (ev.id_group) {
      const groupId = Number(ev.id_group);
      if (byGroup.has(groupId)) {
        const groupAcc = byGroup.get(groupId);
        groupAcc.totalEvals += 1;
        if (grade !== null) {
          groupAcc.sum += grade * percent / 100;
          groupAcc.sumPercent += percent;
          groupAcc.closedEvals += 1;
        }
      }
    } else if (ev.id_class) {
      const classId = Number(ev.id_class);
      const classAcc = byClass.get(classId);
      if (classAcc && !classAcc.group_id) {
        classAcc.totalEvals += 1;
        if (grade !== null) {
          classAcc.sum += grade * percent / 100;
          classAcc.sumPercent += percent;
          classAcc.closedEvals += 1;
        }
      }
    }
  }

  // 6) Construir items: materias individuales y grupos como unidades consolidadas.
  const groupItems = [];
  const soloItems  = [];        // materias sin grupo

  for (const x of byClass.values()) {
    if (x.group_id) continue;
    const complete = x.totalEvals > 0 && x.closedEvals === x.totalEvals;
    const weighted = x.closedEvals > 0 ? Number(x.sum.toFixed(2)) : null;
    soloItems.push({
      class_id: x.class_id,
      group_id: null,
      group_name: null,
      module_name: x.module_name,
      name: x.name,
      classes: [],
      weighted,
      sumPercent: x.sumPercent,
      complete,
      totalEvals: x.totalEvals,
      closedEvals: x.closedEvals,
    });
  }

  for (const g of byGroup.values()) {
    const classesSorted = [...g.classes].sort((a, b) => {
      const ao = a.orden ?? 999999;
      const bo = b.orden ?? 999999;
      return ao - bo || String(a.name).localeCompare(String(b.name), "es", { sensitivity: "base" });
    });
    const complete = g.totalEvals > 0 && g.closedEvals === g.totalEvals;
    const weighted = g.closedEvals > 0 ? Number(g.sum.toFixed(2)) : null;
    groupItems.push({
      class_id: classesSorted[0]?.id ?? 0,
      group_id: g.group_id,
      group_name: g.group_name,
      module_name: g.module_name,
      name: g.group_name,
      classes: classesSorted,
      weighted,
      sumPercent: g.sumPercent,
      complete,
      totalEvals: g.totalEvals,
      closedEvals: g.closedEvals,
    });
  }

  const cmpStr = (a, b) => (a ?? "").localeCompare(b ?? "", "es", { sensitivity: "base" });
  const items = [...soloItems, ...groupItems]
    .map((x) => ({
      class_id:   x.class_id,
      group_id:   x.group_id   ?? null,
      group_name: x.group_name ?? null,
      classes:    x.classes    ?? [],
      name:       x.name,
      module_name: x.module_name ?? null,
      weighted:   x.weighted,
      complete:   x.complete,
      totalEvals: x.totalEvals,
      closedEvals: x.closedEvals,
    }))
    .sort((a, b) => {
      const ag = a.complete ? 0 : (a.weighted !== null ? 1 : 2);
      const bg = b.complete ? 0 : (b.weighted !== null ? 1 : 2);
      if (ag !== bg) return ag - bg;
      return cmpStr(a.module_name, b.module_name) || cmpStr(a.name, b.name);
    });

  // Stats: grupos y materias cuentan igual, uno cada uno
  let passed = 0, failed = 0, pending = 0, avgSum = 0, avgCount = 0;
  for (const it of items) {
    if (it.weighted === null) { pending += 1; continue; }
    const normalizedGrade = it.sumPercent > 0
      ? (it.weighted / it.sumPercent) * 100
      : it.weighted;
    const isFailed = normalizedGrade < PASS_GRADE;
    if (!it.complete) {
      pending += 1;
      continue;
    }
    avgSum += it.weighted; avgCount += 1;
    if (isFailed) failed += 1; else passed += 1;
  }
  const avg_weighted = avgCount > 0 ? Number((avgSum / avgCount).toFixed(2)) : null;

  // Count absences for this student in this course
  let absences = 0;
  try {
    const { rows: absSessions } = await query(
      `SELECT id FROM asistencia_sesion WHERE id_course = $1`,
      [activeCourseId]
    );
    const sesIds = absSessions.map(s => Number(s.id));
    if (sesIds.length > 0) {
      const { rows: countRows } = await query(
        `SELECT count(*) FROM asistencia_detalle WHERE id_student = $1 AND asistio = false AND id_sesion = ANY($2::bigint[])`,
        [userId, sesIds]
      );
      absences = Number(countRows[0]?.count ?? 0);
    }
  } catch { /* ignorar */ }

  return res.json({
    blocked: false,
    course: activeCourse,
    items,
    stats: {
      passed,
      failed,
      pending,
      avg_weighted,
      pass_grade: PASS_GRADE,
      absences,
    },
  });
});

studentRouter.get("/grades", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const classId = Number(req.query.class_id || 0);
  const groupId = Number(req.query.group_id || 0);
  const requestedCourseId = Number(req.query.course_id || 0);

  if (!classId && !groupId) return res.status(400).json({ error: "class_id o group_id requerido" });

  const studentCourse = await getStudentCourse(req, res);
  if (!studentCourse) return;

  // Resolver curso activo: actual o uno del historial del estudiante
  let activeCourse = studentCourse;
  if (requestedCourseId && requestedCourseId !== studentCourse.id) {
    const histEntry = await getHistoryCourse(userId, requestedCourseId);
    if (histEntry?.id) activeCourse = histEntry;
  }

  // evaluaciones de esa materia o grupo en el curso activo
  const scopeColumn = groupId ? "id_group" : "id_class";
  const scopeValue  = groupId ? groupId : classId;

  const { rows: evaluations } = await query(
    `SELECT ev.id, ev.title, ev.percent, ev.created_at, ev.id_type, ev.id_teacher, t.name AS teacher_name
     FROM evaluation ev
     LEFT JOIN users t ON t.id = ev.id_teacher
     WHERE ev.id_course = $1 AND ev.${scopeColumn} = $2
     ORDER BY ev.created_at ASC`,
    [activeCourse.id, scopeValue]
  );

  if (evaluations.length === 0) {
    return res.json({ blocked: false, items: [], weighted: null, course: activeCourse });
  }

  const evalIds = evaluations.map((e) => e.id);

  try {
    await closeExpiredExams({ studentId: userId, courseIds: [activeCourse.id], evaluationIds: evalIds });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cerrando exámenes vencidos" });
  }

  const typeIds = [
    ...new Set(
      evaluations
        .map((ev) => ev.id_type)
        .filter((v) => v !== null && v !== undefined)
    ),
  ];

  const typeMap = new Map();

  if (typeIds.length > 0) {
    const { rows: typeRows } = await query(
      `SELECT id, type FROM evaluation_type WHERE id = ANY($1::bigint[])`,
      [typeIds]
    );

    for (const t of typeRows) {
      typeMap.set(String(t.id), t.type);
    }
  }

  // Auto-cierre: cerrar exámenes en progreso cuyo tiempo ya expiró
  const { rows: rtaEnProgreso } = await query(
    `SELECT r.id, r.id_evaluation, r.iniciado_at, r.respuestas, ev.tiempo_minutos
     FROM rta_examen r
     JOIN evaluation ev ON ev.id = r.id_evaluation
     WHERE r.id_student = $1 AND r.id_evaluation = ANY($2::bigint[])
       AND r.finalizado_at IS NULL AND r.iniciado_at IS NOT NULL`,
    [userId, evalIds]
  );

  for (const r of rtaEnProgreso) {
    if (isTimeExpired(r.iniciado_at, r.tiempo_minutos)) {
      await autoCloseRta(r.id, userId, r.id_evaluation, r.respuestas || []);
    }
  }

  const { rows: gradeRows } = await query(
    `SELECT id_exam, grade, finished_at, attempts, created_at, updated_at FROM grades
     WHERE id_student = $1 AND id_exam = ANY($2::bigint[])`,
    [userId, evalIds]
  );

  const gradeMap = new Map();
  for (const g of gradeRows) gradeMap.set(g.id_exam, g);

  // Obtener fecha_fin y fecha_limite_ver por evaluación desde examen_programacion
  const { rows: schedRows } = await query(
    `SELECT id_evaluation, fecha_fin, fecha_limite_ver FROM examen_programacion
     WHERE id_course = $1 AND id_evaluation = ANY($2::bigint[])`,
    [activeCourse.id, evalIds]
  );

  const fechaFinMap = new Map();
  const fechaLimiteVerMap = new Map();
  for (const s of schedRows) {
    fechaFinMap.set(Number(s.id_evaluation), s.fecha_fin ?? null);
    fechaLimiteVerMap.set(Number(s.id_evaluation), s.fecha_limite_ver ?? null);
  }

  const items = evaluations.map((ev) => {
    const g = gradeMap.get(ev.id) || null;

    const resolvedType =
      ev.id_type !== null && ev.id_type !== undefined
        ? typeMap.get(String(ev.id_type)) || "no encontrado"
        : "no encontrado";

    return {
      exam_id: ev.id,
      type: resolvedType,
      title: ev.title,
      percent: Number(ev.percent ?? 0),
      grade: g?.finished_at ? Number(g.grade ?? 0) : null,
      finished_at: g?.finished_at ?? null,
      attempts: g?.attempts ?? null,
      fecha_fin: fechaFinMap.get(Number(ev.id)) ?? null,
      fecha_limite_ver: fechaLimiteVerMap.get(Number(ev.id)) ?? null,
      teacher_id: ev.id_teacher ?? null,
      teacher_name: ev.teacher_name ?? null,
    };
  });

  let sum = 0;
  let allClosed = items.length > 0;
  for (const it of items) {
    if (it.grade === null) {
      allClosed = false;
      continue;
    }
    const w = Number(it.percent ?? 0);
    sum += it.grade * w / 100;
  }

  const weighted = items.some((it) => it.grade !== null) ? Number(sum.toFixed(2)) : null;

  const teacherNames = [...new Set(items.map((it) => it.teacher_name).filter(Boolean))];
  const teacherName = teacherNames.length === 1 ? teacherNames[0] : teacherNames.join(", ");

  return res.json({ blocked: false, items, weighted, complete: allClosed, teacher_name: teacherName || null, course: activeCourse });
});

// ─── BLOQUE 3 — Exámenes Online (Estudiante) ────────────────────────────────

async function resolveExamenTypeId(year) {
  let sql = `SELECT id FROM evaluation_type WHERE type = $1`;
  const params = ["Examen"];
  if (year) { params.push(year); sql += ` AND year = $${params.length}`; }
  sql += ` LIMIT 1`;
  const { rows } = await query(sql, params);
  return rows[0]?.id ?? null;
}

async function getActiveSchedule(id_evaluation, id_course) {
  const now = new Date().toISOString();
  const { rows } = await query(
    `SELECT id FROM examen_programacion
     WHERE id_evaluation = $1 AND id_course = $2 AND habilitado = true
       AND (fecha_ini IS NULL OR fecha_ini <= $3)
       AND (fecha_fin IS NULL OR fecha_fin >= $3)
     LIMIT 1`,
    [id_evaluation, id_course, now]
  );
  return rows[0] || null;
}

function isTimeExpired(iniciado_at, tiempo_minutos) {
  if (!iniciado_at || !tiempo_minutos) return false;
  const elapsedMs = Date.now() - new Date(iniciado_at).getTime();
  const limiteMs  = (Number(tiempo_minutos) * 60 + 30) * 1000; // +30s margen
  return elapsedMs > limiteMs;
}

async function autoCloseRta(rtaId, userId, id_evaluation, respuestas) {
  const finalizadoAt = new Date().toISOString();

  const { rows: preguntas } = await query(
    `SELECT id, tipo, puntos, respuesta_correcta FROM examen_detalle WHERE id_evaluation = $1`,
    [id_evaluation]
  );

  const calificacion = gradeExam(preguntas, respuestas);

  await Promise.all([
    query(
      `UPDATE grades SET grade = $1, finished_at = $2, attempts = 1 WHERE id_exam = $3 AND id_student = $4`,
      [calificacion, finalizadoAt, id_evaluation, userId]
    ),
    query(
      `UPDATE rta_examen SET calificacion = $1, finalizado_at = $2 WHERE id = $3`,
      [calificacion, finalizadoAt, rtaId]
    ),
  ]);

  return { calificacion, finalizado_at: finalizadoAt };
}

function gradeExam(preguntas, respuestas) {
  const respMap = new Map(
    (Array.isArray(respuestas) ? respuestas : []).map((r) => [Number(r.id_pregunta), r.respuesta])
  );

  let calificacion = 0;

  for (const preg of preguntas) {
    const studentAns = respMap.get(Number(preg.id));
    const correct = preg.respuesta_correcta;
    let isCorrect = false;

    if (preg.tipo === "multiple_multi") {
      const sa = Array.isArray(studentAns) ? [...studentAns].sort() : [];
      const ca = Array.isArray(correct) ? [...correct].sort() : [];
      isCorrect = JSON.stringify(sa) === JSON.stringify(ca);
    } else if (preg.tipo === "multiple_single" || preg.tipo === "falso_verdadero") {
      const sa = Array.isArray(studentAns) ? studentAns[0] : studentAns;
      const ca = Array.isArray(correct) ? correct[0] : correct;
      isCorrect = String(sa ?? "") === String(ca ?? "");
    } else if (preg.tipo === "emparejamiento") {
      const keys = Object.keys(correct);
      if (keys.length > 0 && studentAns && typeof studentAns === "object" && !Array.isArray(studentAns)) {
        const aciertos = keys.filter((k) => String(studentAns[k] ?? "") === String(correct[k] ?? "")).length;
        calificacion += Number(((Number(preg.puntos) * aciertos) / keys.length).toFixed(2));
      }
      continue;
    }

    if (isCorrect) calificacion += Number(preg.puntos);
  }

  return Number(calificacion.toFixed(2));
}

// TAREA 12 — GET /api/student/exam-available
// Materias con examen habilitado para el curso del estudiante (fecha_ini <= now <= fecha_fin)
studentRouter.get("/exam-available", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const now = new Date().toISOString();

  const { rows: schedules } = await query(
    `SELECT ep.id, ep.fecha_ini, ep.fecha_fin, ep.fecha_limite_ver,
            ev.id AS ev_id, ev.title AS ev_title, ev.tiempo_minutos AS ev_tiempo_minutos,
            ev.id_class AS ev_id_class, ev.id_group AS ev_id_group,
            m.name AS module_name,
            c.name AS class_name_from_class,
            g.name AS group_name
     FROM examen_programacion ep
     JOIN evaluation ev ON ev.id = ep.id_evaluation
     LEFT JOIN class c ON c.id = ev.id_class
     LEFT JOIN module m ON m.id = c.id_module
     LEFT JOIN "group" g ON g.id = ev.id_group
     WHERE ep.id_course = $1 AND ep.habilitado = true
       AND (ep.fecha_ini IS NULL OR ep.fecha_ini <= $2)
       AND (ep.fecha_fin IS NULL OR ep.fecha_fin >= $2)`,
    [course.id, now]
  );

  if (schedules.length === 0) return res.json({ items: [], course });

  const evalIds = schedules.map((s) => s.ev_id);

  const { rows: rtaRows } = await query(
    `SELECT id_evaluation, finalizado_at FROM rta_examen WHERE id_student = $1 AND id_evaluation = ANY($2::bigint[])`,
    [userId, evalIds]
  );

  const rtaMap = new Map(rtaRows.map((r) => [Number(r.id_evaluation), r]));

  const items = schedules.map((s) => {
    const rta = rtaMap.get(Number(s.ev_id));
    return {
      id_programacion: s.id,
      id_evaluation: s.ev_id,
      title: s.ev_title,
      tiempo_minutos: s.ev_tiempo_minutos,
      class_id: s.ev_id_class ?? null,
      group_id: s.ev_id_group ?? null,
      class_name: s.class_name_from_class ?? s.group_name ?? null,
      module_name: s.module_name ?? null,
      fecha_ini: s.fecha_ini,
      fecha_fin: s.fecha_fin,
      fecha_limite_ver: s.fecha_limite_ver ?? null,
      ya_rendido: rta?.finalizado_at != null,
      finalizado_at: rta?.finalizado_at ?? null,
    };
  });

  return res.json({ items, course });
});

// TAREA 13 — GET /api/student/exam/:id_evaluation
// Carga el examen sin respuestas correctas; 403 si ya rendido
studentRouter.get("/exam/:id_evaluation", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const examenTypeId = await resolveExamenTypeId(course.year);
  if (!examenTypeId) return res.status(500).json({ error: "Tipo Examen no configurado" });

  const { rows: evRows } = await query(
    `SELECT id, title, tiempo_minutos, id_type FROM evaluation WHERE id = $1 LIMIT 1`,
    [id_evaluation]
  );
  const ev = evRows[0];
  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
  if (ev.id_type !== examenTypeId) return res.status(400).json({ error: "No es de tipo Examen" });

  const sched = await getActiveSchedule(id_evaluation, course.id);
  if (!sched?.id) return res.status(403).json({ error: "Examen no disponible para tu curso" });

  const { rows: rtaRows } = await query(
    `SELECT id, iniciado_at, finalizado_at, respuestas, pregunta_actual FROM rta_examen
     WHERE id_student = $1 AND id_evaluation = $2 LIMIT 1`,
    [userId, id_evaluation]
  );
  const rta = rtaRows[0];

  if (rta?.finalizado_at) return res.status(403).json({ error: "Ya has rendido este examen" });

  const { rows: preguntas } = await query(
    `SELECT id, orden, tipo, enunciado, puntos, opciones FROM examen_detalle
     WHERE id_evaluation = $1 ORDER BY orden ASC`,
    [id_evaluation]
  );

  const { rows: levelRows } = await query(`SELECT name FROM level WHERE id = $1 LIMIT 1`, [course.level]);
  const levelRow = levelRows[0];

  return res.json({
    id_evaluation: ev.id,
    title: ev.title,
    tiempo_minutos: ev.tiempo_minutos,
    id_programacion: sched.id,
    iniciado_at:          rta?.iniciado_at   ?? null,
    respuestas_guardadas: Array.isArray(rta?.respuestas) ? rta.respuestas : [],
    pregunta_actual:      rta?.pregunta_actual ?? 0,
    preguntas,
    level_name: levelRow?.name ?? null,
  });
});

// TAREA 14 — POST /api/student/exam/:id_evaluation/start
// Registra iniciado_at en rta_examen (idempotente: si ya inició devuelve el mismo iniciado_at)
studentRouter.post("/exam/:id_evaluation/start", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const examenTypeId = await resolveExamenTypeId(course.year);
  if (!examenTypeId) return res.status(500).json({ error: "Tipo Examen no configurado" });

  const { rows: evRows } = await query(
    `SELECT id, id_type, tiempo_minutos FROM evaluation WHERE id = $1 LIMIT 1`,
    [id_evaluation]
  );
  const ev = evRows[0];

  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
  if (ev.id_type !== examenTypeId) return res.status(400).json({ error: "No es de tipo Examen" });

  const sched = await getActiveSchedule(id_evaluation, course.id);
  if (!sched?.id) return res.status(403).json({ error: "Examen no disponible para tu curso" });

  const { rows: existingRtaRows } = await query(
    `SELECT id, iniciado_at, finalizado_at FROM rta_examen WHERE id_student = $1 AND id_evaluation = $2 LIMIT 1`,
    [userId, id_evaluation]
  );
  const existingRta = existingRtaRows[0];

  if (existingRta?.finalizado_at) return res.status(403).json({ error: "Ya has rendido este examen" });

  // Idempotente: si ya inició pero no finalizó, devolver el mismo iniciado_at
  if (existingRta?.iniciado_at) {
    return res.json({ iniciado_at: existingRta.iniciado_at, id_programacion: sched.id });
  }

  // Asegurar fila en grades (requerido por FK de rta_examen)
  await query(
    `INSERT INTO grades (id_exam, id_student, grade) VALUES ($1, $2, 0)
     ON CONFLICT (id_exam, id_student) DO NOTHING`,
    [id_evaluation, userId]
  );

  const iniciadoAt = new Date().toISOString();

  const { rows: rtaRows } = await query(
    `INSERT INTO rta_examen (id_student, id_evaluation, id_programacion, iniciado_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, iniciado_at`,
    [userId, id_evaluation, sched.id, iniciadoAt]
  );
  const rta = rtaRows[0];

  return res.json({ iniciado_at: rta.iniciado_at, id_programacion: sched.id });
});

// TAREA 14b — POST /api/student/exam/:id_evaluation/save-answer
// Guarda la respuesta de una pregunta y avanza el puntero pregunta_actual
studentRouter.post("/exam/:id_evaluation/save-answer", requireAuth, async (req, res) => {
  const userId       = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const { id_pregunta, respuesta, pregunta_idx } = req.body ?? {};
  if (id_pregunta == null)  return res.status(400).json({ error: "id_pregunta requerido" });
  if (pregunta_idx == null) return res.status(400).json({ error: "pregunta_idx requerido" });

  const [{ rows: rtaRows }, { rows: evRows }] = await Promise.all([
    query(
      `SELECT id, respuestas, finalizado_at, iniciado_at FROM rta_examen
       WHERE id_student = $1 AND id_evaluation = $2 LIMIT 1`,
      [userId, id_evaluation]
    ),
    query(`SELECT tiempo_minutos FROM evaluation WHERE id = $1 LIMIT 1`, [id_evaluation]),
  ]);
  const rta = rtaRows[0];
  const ev = evRows[0];

  if (!rta?.id)         return res.status(400).json({ error: "El examen no fue iniciado" });
  if (rta.finalizado_at) return res.status(403).json({ error: "El examen ya fue finalizado" });

  // Merge: reemplazar o agregar la respuesta de esta pregunta
  const prev    = Array.isArray(rta.respuestas) ? rta.respuestas : [];
  const sinEsta = prev.filter(r => Number(r.id_pregunta) !== Number(id_pregunta));
  const updated = [...sinEsta, { id_pregunta: Number(id_pregunta), respuesta }];

  await query(
    `UPDATE rta_examen SET respuestas = $1, pregunta_actual = $2 WHERE id = $3`,
    [JSON.stringify(updated), Number(pregunta_idx), rta.id]
  );

  // Calificación progresiva: calificar todo lo respondido hasta ahora
  const { rows: preguntas } = await query(
    `SELECT id, tipo, puntos, respuesta_correcta FROM examen_detalle WHERE id_evaluation = $1`,
    [id_evaluation]
  );

  const calificacion = gradeExam(preguntas, updated);

  // Auto-cierre si el tiempo expiró
  if (isTimeExpired(rta.iniciado_at, ev?.tiempo_minutos)) {
    const result = await autoCloseRta(rta.id, userId, id_evaluation, updated);
    return res.json({ ok: true, calificacion: result.calificacion, auto_finalizado: true });
  }

  // Actualizar nota progresiva sin cerrar el examen
  await query(
    `UPDATE grades SET grade = $1 WHERE id_exam = $2 AND id_student = $3`,
    [calificacion, id_evaluation, userId]
  );

  return res.json({ ok: true, calificacion });
});

// GET /api/student/exam/:id_evaluation/schedule
// Devuelve fecha_fin y fecha_limite_ver frescos desde examen_programacion para el curso del estudiante
studentRouter.get("/exam/:id_evaluation/schedule", requireAuth, async (req, res) => {
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const { rows } = await query(
    `SELECT fecha_fin, fecha_limite_ver FROM examen_programacion
     WHERE id_evaluation = $1 AND id_course = $2 LIMIT 1`,
    [id_evaluation, course.id]
  );
  const data = rows[0];
  if (!data) return res.status(404).json({ error: "Programación no encontrada" });

  return res.json({ fecha_fin: data.fecha_fin ?? null, fecha_limite_ver: data.fecha_limite_ver ?? null });
});

// TAREA 15 — POST /api/student/exam/:id_evaluation/submit
// Recibe respuestas, valida tiempo, califica, actualiza grades y rta_examen
studentRouter.post("/exam/:id_evaluation/submit", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const { respuestas } = req.body;
  if (!Array.isArray(respuestas)) return res.status(400).json({ error: "respuestas debe ser un array" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  try { await requireAnioVigenteForCourse(course.id); }
  catch (err) { return handleYearError(res, err); }

  const { rows: evRows } = await query(
    `SELECT id, tiempo_minutos FROM evaluation WHERE id = $1 LIMIT 1`,
    [id_evaluation]
  );
  const ev = evRows[0];

  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });

  const { rows: rtaRows } = await query(
    `SELECT id, iniciado_at, finalizado_at, respuestas FROM rta_examen
     WHERE id_student = $1 AND id_evaluation = $2 LIMIT 1`,
    [userId, id_evaluation]
  );
  const rta = rtaRows[0];

  if (!rta?.id) return res.status(400).json({ error: "El examen no fue iniciado" });
  if (rta.finalizado_at) return res.status(403).json({ error: "Ya has rendido este examen" });

  // Validar tiempo: (now - iniciado_at) <= tiempo_minutos * 60s + 30s de margen
  if (ev.tiempo_minutos != null) {
    const elapsedMs = Date.now() - new Date(rta.iniciado_at).getTime();
    const limiteMs = (Number(ev.tiempo_minutos) * 60 + 30) * 1000;
    if (elapsedMs > limiteMs) {
      return res.status(400).json({ error: "El tiempo del examen ha expirado" });
    }
  }

  // Merge: respuestas guardadas en BD + las enviadas ahora (las enviadas tienen prioridad)
  const savedMap = new Map((Array.isArray(rta.respuestas) ? rta.respuestas : []).map(r => [Number(r.id_pregunta), r]));
  for (const sr of respuestas) savedMap.set(Number(sr.id_pregunta), sr);
  const mergedRespuestas = [...savedMap.values()];

  // Traer preguntas con respuesta_correcta para calificar
  const { rows: preguntas } = await query(
    `SELECT id, tipo, puntos, respuesta_correcta FROM examen_detalle WHERE id_evaluation = $1`,
    [id_evaluation]
  );

  const calificacion = gradeExam(preguntas, mergedRespuestas);
  const finalizadoAt = new Date().toISOString();

  // Actualizar grades con la calificación final
  await query(
    `UPDATE grades SET grade = $1, finished_at = $2, attempts = 1 WHERE id_exam = $3 AND id_student = $4`,
    [calificacion, finalizadoAt, id_evaluation, userId]
  );

  // Actualizar rta_examen con respuestas finales y resultado
  await query(
    `UPDATE rta_examen SET respuestas = $1, calificacion = $2, finalizado_at = $3 WHERE id = $4`,
    [JSON.stringify(mergedRespuestas), calificacion, finalizadoAt, rta.id]
  );

  return res.json({ calificacion, finalizado_at: finalizadoAt });
});

// TAREA 16 — GET /api/student/exam/:id_evaluation/result
// Devuelve rta_examen + examen_detalle completo (con respuesta_correcta)
studentRouter.get("/exam/:id_evaluation/result", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const { rows: rtaRows } = await query(
    `SELECT id, respuestas, calificacion, iniciado_at, finalizado_at FROM rta_examen
     WHERE id_student = $1 AND id_evaluation = $2 LIMIT 1`,
    [userId, id_evaluation]
  );
  const rta = rtaRows[0];

  if (!rta?.id) return res.status(404).json({ error: "No se encontró resultado para este examen" });
  if (!rta.finalizado_at) return res.status(400).json({ error: "El examen aún no ha sido finalizado" });

  const { rows: preguntas } = await query(
    `SELECT id, orden, tipo, enunciado, puntos, opciones, respuesta_correcta FROM examen_detalle
     WHERE id_evaluation = $1 ORDER BY orden ASC`,
    [id_evaluation]
  );

  return res.json({
    id_evaluation,
    calificacion: rta.calificacion,
    iniciado_at: rta.iniciado_at,
    finalizado_at: rta.finalizado_at,
    respuestas: rta.respuestas,
    preguntas,
  });
});

// GET /api/student/absences?course_id=X
// Retorna lista de inasistencias del alumno autenticado para el curso dado
studentRouter.get("/absences", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const requestedCourseId = Number(req.query.course_id || 0);

  const studentCourse = await getStudentCourse(req, res);
  if (!studentCourse) return;

  let activeCourse = studentCourse;
  if (requestedCourseId && requestedCourseId !== studentCourse.id) {
    const histEntry = await getHistoryCourse(userId, requestedCourseId);
    if (histEntry?.id) activeCourse = histEntry;
  }

  try {
    const { rows: sessions } = await query(
      `SELECT s.id, s.fecha_clase, c.name AS class_name
       FROM asistencia_sesion s
       LEFT JOIN class c ON c.id = s.id_class
       WHERE s.id_course = $1
       ORDER BY s.fecha_clase DESC`,
      [activeCourse.id]
    );

    const sessionIds = sessions.map(s => Number(s.id));
    if (sessionIds.length === 0) return res.json({ items: [] });

    const { rows: abs } = await query(
      `SELECT id_sesion FROM asistencia_detalle WHERE id_student = $1 AND asistio = false AND id_sesion = ANY($2::bigint[])`,
      [userId, sessionIds]
    );

    const absentIds = new Set(abs.map(a => Number(a.id_sesion)));
    const sessionMap = new Map(sessions.map(s => [Number(s.id), s]));

    const items = [...absentIds]
      .map(id => {
        const s = sessionMap.get(id);
        if (!s) return null;
        return { fecha_clase: s.fecha_clase, class_name: s.class_name ?? "—" };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.fecha_clase).localeCompare(String(a.fecha_clase)));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error obteniendo inasistencias" });
  }
});
