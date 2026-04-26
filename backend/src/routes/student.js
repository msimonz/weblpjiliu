import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import { requireAnioVigenteForCourse, handleYearError } from "../lib/anioLectivo.js";

export const studentRouter = Router();

const PASS_GRADE = 70;

// ✅ helper: curso real del estudiante (fijo)
async function getStudentCourse(req, res) {
  const courseId = Number(req.auth.profile?.id_course || 0);

  if (!courseId) {
    res.status(400).json({ error: "El usuario no tiene id_course en el profile" });
    return null;
  }

  const { data: course, error } = await supabaseAdmin
    .from("course")
    .select("id,year,level,name")
    .eq("id", courseId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
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

  const { data, error } = await supabaseAdmin
    .from("class")
    .select("id,name,level")
    .eq("level", level)
    .eq("year", course.year)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ blocked: false, items: data || [], course });
});

/**
 * Lista de años lectivos registrados + año activo
 * GET /api/student/anio-lectivo
 */
studentRouter.get("/anio-lectivo", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("anio_lectivo")
      .select("year, nombre, activo")
      .order("year", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
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

  const { data: histRows, error: histErr } = await supabaseAdmin
    .from("user_history")
    .select("id_course, course:course(id,name,level,year)")
    .eq("id_student", userId);

  if (histErr) return res.status(500).json({ error: histErr.message });

  const coursesMap = new Map();
  coursesMap.set(course.id, course);
  for (const h of histRows || []) {
    if (h.course?.id && !coursesMap.has(h.course.id)) {
      coursesMap.set(h.course.id, h.course);
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
    const { data: histEntry } = await supabaseAdmin
      .from("user_history")
      .select("id_course, course:course(id,name,level,year)")
      .eq("id_student", userId)
      .eq("id_course", requestedCourseId)
      .maybeSingle();
    if (histEntry?.course?.id) activeCourse = histEntry.course;
  }

  const level = Number(activeCourse.level);
  const activeCourseId = activeCourse.id;

  // 1) Traer TODAS las materias del nivel con nombre de módulo
  const { data: classRows, error: classErr } = await supabaseAdmin
    .from("class")
    .select("id,name,level,module:module(id,name)")
    .eq("level", level)
    .eq("year", activeCourse.year)
    .order("name", { ascending: true });

  if (classErr) {
    return res.status(500).json({ error: classErr.message });
  }

  const classes = classRows || [];

  if (classes.length === 0) {
    return res.json({
      blocked: false,
      course: activeCourse,
      items: [],
      stats: {
        passed: 0,
        failed: 0,
        pending: 0,
        avg_weighted: null,
        pass_grade: PASS_GRADE,
      },
    });
  }

  // 2) Inicializar mapa con TODAS las materias
  const byClass = new Map();
  for (const cls of classes) {
    const classId = Number(cls.id);
    byClass.set(classId, {
      class_id: classId,
      name: String(cls.name ?? `Materia ${classId}`),
      module_name: cls.module?.name ?? null,
      sumW: 0,
      sum: 0,
    });
  }

  // 3) Traer evaluaciones del curso activo
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_class,percent,title")
    .eq("id_course", activeCourseId);

  if (evalErr) {
    return res.status(500).json({ error: evalErr.message });
  }

  const evaluations = evals || [];
  const evalIds = evaluations.map((e) => Number(e.id));

  // 4) Traer notas del estudiante para esas evaluaciones
  let gradeRows = [];
  if (evalIds.length > 0) {
    const { data: gradesData, error: gradesErr } = await supabaseAdmin
      .from("grades")
      .select("id_exam,grade,id_student,finished_at")
      .eq("id_student", userId)
      .in("id_exam", evalIds)
      .not("finished_at", "is", null);  // ignorar placeholders de exámenes en progreso

    if (gradesErr) {
      return res.status(500).json({ error: gradesErr.message });
    }

    gradeRows = gradesData || [];
  }

  const gradeMap = new Map();
  for (const g of gradeRows) {
    gradeMap.set(Number(g.id_exam), g);
  }

  // 5) Acumular solo donde existan evaluaciones con nota
  for (const ev of evaluations) {
    const classId = Number(ev.id_class);
    const percent = Number(ev.percent ?? 0);

    if (!byClass.has(classId)) {
      byClass.set(classId, {
        class_id: classId,
        name: `Materia ${classId}`,
        module_name: null,
        sumW: 0,
        sum: 0,
      });
    }

    const g = gradeMap.get(Number(ev.id)) || null;
    const grade = g?.grade === null || g?.grade === undefined ? null : Number(g.grade);

    if (grade !== null) {
      const obj = byClass.get(classId);
      obj.sumW += percent;
      obj.sum += grade * percent;
    }
  }

  // 6) Construir salida final con TODAS las materias
const items = Array.from(byClass.values())
  .map((x) => {
    const weighted = x.sumW > 0 ? Number((x.sum / x.sumW).toFixed(2)) : null;
    return {
      class_id: x.class_id,
      name: x.name,
      module_name: x.module_name ?? null,
      weighted,
    };
  })
  .sort((a, b) => {
    const aHasGrade = a.weighted !== null;
    const bHasGrade = b.weighted !== null;

    if (aHasGrade && !bHasGrade) return -1;
    if (!aHasGrade && bHasGrade) return 1;

    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });

  // 7) Stats: solo cuentan materias con nota
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let avgSum = 0;
  let avgCount = 0;

  for (const it of items) {
    if (it.weighted === null) {
      pending += 1;
      continue;
    }

    avgSum += it.weighted;
    avgCount += 1;

    if (it.weighted >= PASS_GRADE) passed += 1;
    else failed += 1;
  }

  const avg_weighted = avgCount > 0 ? Number((avgSum / avgCount).toFixed(2)) : null;

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
    },
  });
});

studentRouter.get("/grades", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const classId = Number(req.query.class_id || 0);
  const requestedCourseId = Number(req.query.course_id || 0);

  if (!classId) return res.status(400).json({ error: "class_id requerido" });

  const studentCourse = await getStudentCourse(req, res);
  if (!studentCourse) return;

  // Resolver curso activo: actual o uno del historial del estudiante
  let activeCourse = studentCourse;
  if (requestedCourseId && requestedCourseId !== studentCourse.id) {
    const { data: histEntry } = await supabaseAdmin
      .from("user_history")
      .select("id_course, course:course(id,name,level,year)")
      .eq("id_student", userId)
      .eq("id_course", requestedCourseId)
      .maybeSingle();
    if (histEntry?.course?.id) activeCourse = histEntry.course;
  }

  // evaluaciones de esa materia en el curso activo
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,title,percent,created_at,id_type")
    .eq("id_course", activeCourse.id)
    .eq("id_class", classId)
    .order("created_at", { ascending: true });

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({ blocked: false, items: [], weighted: null, course: activeCourse });
  }

  const evalIds = evaluations.map((e) => e.id);

  const typeIds = [
    ...new Set(
      evaluations
        .map((ev) => ev.id_type)
        .filter((v) => v !== null && v !== undefined)
    ),
  ];

  const typeMap = new Map();

  if (typeIds.length > 0) {
    const { data: typeRows, error: typeErr } = await supabaseAdmin
      .from("evaluation_type")
      .select("id,type")
      .in("id", typeIds);

    if (typeErr) return res.status(500).json({ error: typeErr.message });

    for (const t of typeRows || []) {
      typeMap.set(String(t.id), t.type);
    }
  }

  // Auto-cierre: cerrar exámenes en progreso cuyo tiempo ya expiró
  const { data: rtaEnProgreso } = await supabaseAdmin
    .from("rta_examen")
    .select("id, id_evaluation, iniciado_at, respuestas, evaluation:evaluation(tiempo_minutos)")
    .eq("id_student", userId)
    .in("id_evaluation", evalIds)
    .is("finalizado_at", null)
    .not("iniciado_at", "is", null);

  for (const r of (rtaEnProgreso || [])) {
    if (isTimeExpired(r.iniciado_at, r.evaluation?.tiempo_minutos)) {
      await autoCloseRta(r.id, userId, r.id_evaluation, r.respuestas || []);
    }
  }

  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,finished_at,attempts,created_at,updated_at")
    .eq("id_student", userId)
    .in("id_exam", evalIds)
    .not("finished_at", "is", null);  // ignorar placeholders de exámenes en progreso

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  // Obtener fecha_fin y fecha_limite_ver por evaluación desde examen_programacion
  const { data: schedRows } = await supabaseAdmin
    .from("examen_programacion")
    .select("id_evaluation, fecha_fin, fecha_limite_ver")
    .eq("id_course", activeCourse.id)
    .in("id_evaluation", evalIds);

  const fechaFinMap = new Map();
  const fechaLimiteVerMap = new Map();
  for (const s of schedRows || []) {
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
      grade: g ? Number(g.grade ?? 0) : null,
      finished_at: g?.finished_at ?? null,
      attempts: g?.attempts ?? null,
      fecha_fin: fechaFinMap.get(Number(ev.id)) ?? null,
      fecha_limite_ver: fechaLimiteVerMap.get(Number(ev.id)) ?? null,
    };
  });

  let sumW = 0;
  let sum = 0;
  for (const it of items) {
    if (it.grade === null) continue;
    const w = Number(it.percent ?? 0);
    sumW += w;
    sum += it.grade * w;
  }

  const weighted = sumW > 0 ? Number((sum / sumW).toFixed(2)) : null;

  return res.json({ blocked: false, items, weighted, course: activeCourse });
});

// ─── BLOQUE 3 — Exámenes Online (Estudiante) ────────────────────────────────

async function resolveExamenTypeId(year) {
  let q = supabaseAdmin.from("evaluation_type").select("id").eq("type", "Examen");
  if (year) q = q.eq("year", year);
  const { data } = await q.maybeSingle();
  return data?.id ?? null;
}

async function getActiveSchedule(id_evaluation, id_course) {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("examen_programacion")
    .select("id")
    .eq("id_evaluation", id_evaluation)
    .eq("id_course", id_course)
    .eq("habilitado", true)
    .or(`fecha_ini.is.null,fecha_ini.lte.${now}`)
    .or(`fecha_fin.is.null,fecha_fin.gte.${now}`)
    .maybeSingle();
  return data;
}

function isTimeExpired(iniciado_at, tiempo_minutos) {
  if (!iniciado_at || !tiempo_minutos) return false;
  const elapsedMs = Date.now() - new Date(iniciado_at).getTime();
  const limiteMs  = (Number(tiempo_minutos) * 60 + 30) * 1000; // +30s margen
  return elapsedMs > limiteMs;
}

async function autoCloseRta(rtaId, userId, id_evaluation, respuestas) {
  const finalizadoAt = new Date().toISOString();

  const { data: preguntas } = await supabaseAdmin
    .from("examen_detalle")
    .select("id, tipo, puntos, respuesta_correcta")
    .eq("id_evaluation", id_evaluation);

  const calificacion = gradeExam(preguntas || [], respuestas);

  await Promise.all([
    supabaseAdmin
      .from("grades")
      .update({ grade: calificacion, finished_at: finalizadoAt })
      .eq("id_exam", id_evaluation)
      .eq("id_student", userId),
    supabaseAdmin
      .from("rta_examen")
      .update({ calificacion, finalizado_at: finalizadoAt })
      .eq("id", rtaId),
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

  const { data: schedules, error: schedErr } = await supabaseAdmin
    .from("examen_programacion")
    .select(`
      id, fecha_ini, fecha_fin, fecha_limite_ver,
      evaluation:evaluation(
        id, title, tiempo_minutos, id_class,
        class:class(id, name, module:module(id, name))
      )
    `)
    .eq("id_course", course.id)
    .eq("habilitado", true)
    .or(`fecha_ini.is.null,fecha_ini.lte.${now}`)
    .or(`fecha_fin.is.null,fecha_fin.gte.${now}`);

  if (schedErr) return res.status(500).json({ error: schedErr.message });

  const validSchedules = (schedules || []).filter((s) => s.evaluation?.id);
  if (validSchedules.length === 0) return res.json({ items: [], course });

  const evalIds = validSchedules.map((s) => s.evaluation.id);

  const { data: rtaRows } = await supabaseAdmin
    .from("rta_examen")
    .select("id_evaluation, finalizado_at")
    .eq("id_student", userId)
    .in("id_evaluation", evalIds);

  const rtaMap = new Map((rtaRows || []).map((r) => [Number(r.id_evaluation), r]));

  const items = validSchedules.map((s) => {
    const ev = s.evaluation;
    const rta = rtaMap.get(Number(ev.id));
    return {
      id_programacion: s.id,
      id_evaluation: ev.id,
      title: ev.title,
      tiempo_minutos: ev.tiempo_minutos,
      class_id: ev.id_class,
      class_name: ev.class?.name ?? null,
      module_name: ev.class?.module?.name ?? null,
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

  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id, title, tiempo_minutos, id_type")
    .eq("id", id_evaluation)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
  if (ev.id_type !== examenTypeId) return res.status(400).json({ error: "No es de tipo Examen" });

  const sched = await getActiveSchedule(id_evaluation, course.id);
  if (!sched?.id) return res.status(403).json({ error: "Examen no disponible para tu curso" });

  const { data: rta } = await supabaseAdmin
    .from("rta_examen")
    .select("id, iniciado_at, finalizado_at, respuestas, pregunta_actual")
    .eq("id_student", userId)
    .eq("id_evaluation", id_evaluation)
    .maybeSingle();

  if (rta?.finalizado_at) return res.status(403).json({ error: "Ya has rendido este examen" });

  const { data: preguntas, error: pregErr } = await supabaseAdmin
    .from("examen_detalle")
    .select("id, orden, tipo, enunciado, puntos, opciones")
    .eq("id_evaluation", id_evaluation)
    .order("orden", { ascending: true });

  if (pregErr) return res.status(500).json({ error: pregErr.message });

  return res.json({
    id_evaluation: ev.id,
    title: ev.title,
    tiempo_minutos: ev.tiempo_minutos,
    id_programacion: sched.id,
    iniciado_at:          rta?.iniciado_at   ?? null,
    respuestas_guardadas: Array.isArray(rta?.respuestas) ? rta.respuestas : [],
    pregunta_actual:      rta?.pregunta_actual ?? 0,
    preguntas: preguntas || [],
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

  const { data: ev } = await supabaseAdmin
    .from("evaluation")
    .select("id, id_type, tiempo_minutos")
    .eq("id", id_evaluation)
    .maybeSingle();

  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
  if (ev.id_type !== examenTypeId) return res.status(400).json({ error: "No es de tipo Examen" });

  const sched = await getActiveSchedule(id_evaluation, course.id);
  if (!sched?.id) return res.status(403).json({ error: "Examen no disponible para tu curso" });

  const { data: existingRta } = await supabaseAdmin
    .from("rta_examen")
    .select("id, iniciado_at, finalizado_at")
    .eq("id_student", userId)
    .eq("id_evaluation", id_evaluation)
    .maybeSingle();

  if (existingRta?.finalizado_at) return res.status(403).json({ error: "Ya has rendido este examen" });

  // Idempotente: si ya inició pero no finalizó, devolver el mismo iniciado_at
  if (existingRta?.iniciado_at) {
    return res.json({ iniciado_at: existingRta.iniciado_at, id_programacion: sched.id });
  }

  // Asegurar fila en grades (requerido por FK de rta_examen)
  const { error: gradesErr } = await supabaseAdmin
    .from("grades")
    .upsert(
      { id_exam: id_evaluation, id_student: userId, grade: 0 },
      { onConflict: "id_exam,id_student", ignoreDuplicates: true }
    );

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const iniciadoAt = new Date().toISOString();

  const { data: rta, error: rtaErr } = await supabaseAdmin
    .from("rta_examen")
    .insert({
      id_student: userId,
      id_evaluation,
      id_programacion: sched.id,
      iniciado_at: iniciadoAt,
    })
    .select("id, iniciado_at")
    .single();

  if (rtaErr) return res.status(500).json({ error: rtaErr.message });

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

  const [{ data: rta, error: rtaErr }, { data: ev }] = await Promise.all([
    supabaseAdmin
      .from("rta_examen")
      .select("id, respuestas, finalizado_at, iniciado_at")
      .eq("id_student", userId)
      .eq("id_evaluation", id_evaluation)
      .maybeSingle(),
    supabaseAdmin
      .from("evaluation")
      .select("tiempo_minutos")
      .eq("id", id_evaluation)
      .maybeSingle(),
  ]);

  if (rtaErr) return res.status(500).json({ error: rtaErr.message });
  if (!rta?.id)         return res.status(400).json({ error: "El examen no fue iniciado" });
  if (rta.finalizado_at) return res.status(403).json({ error: "El examen ya fue finalizado" });

  // Merge: reemplazar o agregar la respuesta de esta pregunta
  const prev    = Array.isArray(rta.respuestas) ? rta.respuestas : [];
  const sinEsta = prev.filter(r => Number(r.id_pregunta) !== Number(id_pregunta));
  const updated = [...sinEsta, { id_pregunta: Number(id_pregunta), respuesta }];

  const { error: updErr } = await supabaseAdmin
    .from("rta_examen")
    .update({ respuestas: updated, pregunta_actual: Number(pregunta_idx) })
    .eq("id", rta.id);

  if (updErr) return res.status(500).json({ error: updErr.message });

  // Calificación progresiva: calificar todo lo respondido hasta ahora
  const { data: preguntas } = await supabaseAdmin
    .from("examen_detalle")
    .select("id, tipo, puntos, respuesta_correcta")
    .eq("id_evaluation", id_evaluation);

  const calificacion = gradeExam(preguntas || [], updated);

  // Auto-cierre si el tiempo expiró
  if (isTimeExpired(rta.iniciado_at, ev?.tiempo_minutos)) {
    const result = await autoCloseRta(rta.id, userId, id_evaluation, updated);
    return res.json({ ok: true, calificacion: result.calificacion, auto_finalizado: true });
  }

  // Actualizar nota progresiva sin cerrar el examen
  await supabaseAdmin
    .from("grades")
    .update({ grade: calificacion })
    .eq("id_exam", id_evaluation)
    .eq("id_student", userId);

  return res.json({ ok: true, calificacion });
});

// GET /api/student/exam/:id_evaluation/schedule
// Devuelve fecha_fin y fecha_limite_ver frescos desde examen_programacion para el curso del estudiante
studentRouter.get("/exam/:id_evaluation/schedule", requireAuth, async (req, res) => {
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  const { data, error } = await supabaseAdmin
    .from("examen_programacion")
    .select("fecha_fin, fecha_limite_ver")
    .eq("id_evaluation", id_evaluation)
    .eq("id_course", course.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
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

  const { data: ev } = await supabaseAdmin
    .from("evaluation")
    .select("id, tiempo_minutos")
    .eq("id", id_evaluation)
    .maybeSingle();

  if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });

  const { data: rta } = await supabaseAdmin
    .from("rta_examen")
    .select("id, iniciado_at, finalizado_at, respuestas")
    .eq("id_student", userId)
    .eq("id_evaluation", id_evaluation)
    .maybeSingle();

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
  const { data: preguntas, error: pregErr } = await supabaseAdmin
    .from("examen_detalle")
    .select("id, tipo, puntos, respuesta_correcta")
    .eq("id_evaluation", id_evaluation);

  if (pregErr) return res.status(500).json({ error: pregErr.message });

  const calificacion = gradeExam(preguntas || [], mergedRespuestas);
  const finalizadoAt = new Date().toISOString();

  // Actualizar grades con la calificación final
  const { error: gradesUpdErr } = await supabaseAdmin
    .from("grades")
    .update({ grade: calificacion, finished_at: finalizadoAt })
    .eq("id_exam", id_evaluation)
    .eq("id_student", userId);

  if (gradesUpdErr) return res.status(500).json({ error: gradesUpdErr.message });

  // Actualizar rta_examen con respuestas finales y resultado
  const { error: rtaUpdErr } = await supabaseAdmin
    .from("rta_examen")
    .update({ respuestas: mergedRespuestas, calificacion, finalizado_at: finalizadoAt })
    .eq("id", rta.id);

  if (rtaUpdErr) return res.status(500).json({ error: rtaUpdErr.message });

  return res.json({ calificacion, finalizado_at: finalizadoAt });
});

// TAREA 16 — GET /api/student/exam/:id_evaluation/result
// Devuelve rta_examen + examen_detalle completo (con respuesta_correcta)
studentRouter.get("/exam/:id_evaluation/result", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const id_evaluation = Number(req.params.id_evaluation);
  if (!id_evaluation) return res.status(400).json({ error: "id_evaluation inválido" });

  const { data: rta, error: rtaErr } = await supabaseAdmin
    .from("rta_examen")
    .select("id, respuestas, calificacion, iniciado_at, finalizado_at")
    .eq("id_student", userId)
    .eq("id_evaluation", id_evaluation)
    .maybeSingle();

  if (rtaErr) return res.status(500).json({ error: rtaErr.message });
  if (!rta?.id) return res.status(404).json({ error: "No se encontró resultado para este examen" });
  if (!rta.finalizado_at) return res.status(400).json({ error: "El examen aún no ha sido finalizado" });

  const { data: preguntas, error: pregErr } = await supabaseAdmin
    .from("examen_detalle")
    .select("id, orden, tipo, enunciado, puntos, opciones, respuesta_correcta")
    .eq("id_evaluation", id_evaluation)
    .order("orden", { ascending: true });

  if (pregErr) return res.status(500).json({ error: pregErr.message });

  return res.json({
    id_evaluation,
    calificacion: rta.calificacion,
    iniciado_at: rta.iniciado_at,
    finalizado_at: rta.finalizado_at,
    respuestas: rta.respuestas,
    preguntas: preguntas || [],
  });
});