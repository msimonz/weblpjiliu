import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const teacherRouter = Router();

// ✅ middleware simple: solo teachers (o admin)
function requireTeacher(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("T") && !roles.includes("A")) {
    return res.status(403).json({ error: "Solo Teacher/Admin" });
  }
  return next();
}

/**
 * ✅ 0) Listar mis materias asignadas (para dropdown)
 * GET /api/teacher/classes
 */
teacherRouter.get("/classes", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;

  const { data, error } = await supabaseAdmin
    .from("class_teacher")
    .select("id_class, class:class(id,name,level)")
    .eq("id_teacher", teacherId)
    .order("id_class", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((r) => r.class).filter(Boolean);
  return res.json({ items });
});

teacherRouter.get("/courses", requireAuth, requireTeacher, async (req, res) => {
  const classId = Number(req.query.class_id);
  if (!classId) return res.status(400).json({ error: "class_id requerido" });

  // 1) Intento 1: cursos donde ya existen evaluaciones para esa materia (cualquier teacher)
  const { data: evCourses, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id_course, course:course(id,name,level,year)")
    .eq("id_class", classId);

  if (evErr) return res.status(500).json({ error: evErr.message });

  // distinct por id_course
  const seen = new Set();
  const items1 = (evCourses || [])
    .map((r) => r.course)
    .filter(Boolean)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  // 2) Fallback: si no hay nada aún, devolvemos cursos por nivel de la materia
  if (items1.length > 0) return res.json({ items: items1 });

  const { data: cls, error: clsErr } = await supabaseAdmin
    .from("class")
    .select("id,level")
    .eq("id", classId)
    .maybeSingle();

  if (clsErr) return res.status(500).json({ error: clsErr.message });

  const level = cls?.level;
  if (!level) return res.json({ items: [] });

  const { data: courses, error: cErr } = await supabaseAdmin
    .from("course")
    .select("id,name,level,year")
    .eq("level", level)
    .order("id", { ascending: true });

  if (cErr) return res.status(500).json({ error: cErr.message });
  return res.json({ items: courses || [] });
});

teacherRouter.get("/evaluation-types", requireAuth, requireTeacher, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type,created_at")
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

teacherRouter.post("/evaluation-types", requireAuth, requireTeacher, async (req, res) => {
  const raw = String(req.body?.type || "").trim();
  if (!raw) return res.status(400).json({ error: "type requerido" });

  // normaliza (opcional)
  const type = raw;

  // si ya existe, devolvemos el existente
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type")
    .eq("type", type)
    .maybeSingle();

  if (exErr) return res.status(500).json({ error: exErr.message });
  if (existing?.id) return res.json({ item: existing });

  // si no existe, lo insertamos
  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type })
    .select("id,type")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

/**
 * ✅ 1) Listar mis evaluaciones (opcional filtrar por materia)
 * GET /api/teacher/evaluations?class_id=1
 */
teacherRouter.get("/evaluations", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;
  const classId = req.query.class_id ? Number(req.query.class_id) : null;

  let q = supabaseAdmin
    .from("evaluation")
    .select(`
      id,
      title,
      percent,
      created_at,
      id_course,
      id_class,
      id_type,
      course:course(id,name,level,year),
      class:class(id,name,level),
      evaluation_type:evaluation_type(id,type)
    `)
    .eq("id_teacher", teacherId)
    .order("created_at", { ascending: false });

  if (classId) q = q.eq("id_class", classId);

  const { data, error } = await q;

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

/**
 * ✅ 4) Alumnos de un curso
 * GET /api/teacher/course-students?course_id=1
 * retorna: [{ id, name, cedula }]
 *
 * Nota: aquí asumimos que users.id_course = course.id
 */
teacherRouter.get("/course-students", requireAuth, requireTeacher, async (req, res) => {
  const courseId = Number(req.query.course_id);
  if (!courseId) return res.status(400).json({ error: "course_id requerido" });

  // 1) traer usuarios por course
  const { data: users, error: uErr } = await supabaseAdmin
    .from("users")
    .select("id,name,cedula,id_course")
    .eq("id_course", courseId)
    .order("name", { ascending: true });

  if (uErr) return res.status(500).json({ error: uErr.message });

  const ids = (users || []).map((u) => u.id);
  if (ids.length === 0) return res.json({ items: [] });

  // 2) traer id_type de 'S'
  const { data: tRow, error: tErr } = await supabaseAdmin
    .from("type")
    .select("id")
    .eq("code", "S")
    .maybeSingle();

  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!tRow?.id) return res.status(500).json({ error: "No existe type 'S'" });

  // 3) filtrar los que tengan rol S
  const { data: utRows, error: utErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .eq("id_type", tRow.id)
    .in("id_user", ids);

  if (utErr) return res.status(500).json({ error: utErr.message });

  const isStudent = new Set((utRows || []).map((r) => r.id_user));

  const items = (users || [])
    .filter((u) => isStudent.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, cedula: u.cedula }));

  return res.json({ items });
});


/**
 * ✅ 5) Notas existentes de una evaluación (para precargar tabla)
 * GET /api/teacher/exam-grades?exam_id=1
 * retorna: [{ id_student, grade }]
 */
teacherRouter.get("/exam-grades", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;
  const examId = Number(req.query.exam_id);
  if (!examId) return res.status(400).json({ error: "exam_id requerido" });

  // 1) validar que la evaluación pertenece al teacher
  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_teacher")
    .eq("id", examId)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu evaluación" });

  // 2) traer notas
  const { data, error } = await supabaseAdmin
    .from("grades")
    .select("id_student,grade")
    .eq("id_exam", examId);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ items: data || [] });
});


/**
 * ✅ 2) Crear evaluación
 * POST /api/teacher/evaluations
 * body: { id_course, id_class, id_type, percent, title }
 */
teacherRouter.post("/evaluations", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;

  const {
    id_course,
    id_class,
    percent,
    title,
    id_type,     // opcional si viene del dropdown
    type_text,   // opcional si viene "Otro"
  } = req.body || {};

  if (!id_course || !id_class) {
    return res.status(400).json({ error: "Faltan campos: id_course, id_class" });
  }

  const p = Number(percent);
  if (!Number.isFinite(p) || p <= 0 || p > 100) {
    return res.status(400).json({ error: "percent inválido (1..100)" });
  }

  const t = String(title || "").trim();
  if (!t) return res.status(400).json({ error: "title requerido" });

  // ✅ Resolver id_type:
  let typeId = Number(id_type || 0);

  if (!typeId) {
    const raw = String(type_text || "").trim();
    if (!raw) return res.status(400).json({ error: "Selecciona un tipo o escribe type_text" });

    // buscar si existe
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("evaluation_type")
      .select("id,type")
      .eq("type", raw)
      .maybeSingle();

    if (exErr) return res.status(500).json({ error: exErr.message });

    if (existing?.id) {
      typeId = existing.id;
    } else {
      // crear
      const { data: created, error: crErr } = await supabaseAdmin
        .from("evaluation_type")
        .insert({ type: raw })
        .select("id,type")
        .maybeSingle();

      if (crErr) return res.status(500).json({ error: crErr.message });
      typeId = created.id;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("evaluation")
    .insert({
      id_course: Number(id_course),
      id_class: Number(id_class),
      id_teacher: teacherId,
      id_type: Number(typeId),
      percent: p,
      title: t,
    })
    .select("id,title,percent,created_at,id_course,id_class,id_type")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

/**
 * ✅ 3) Subir nota manual (upsert)
 * POST /api/teacher/grades
 * body: { exam_id, student_cedula, grade }
 */
teacherRouter.post("/grades", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;
  const { exam_id, student_cedula, grade } = req.body || {};

  const examId = Number(exam_id);
  if (!examId) return res.status(400).json({ error: "exam_id requerido" });

  const ced = String(student_cedula || "").trim();
  if (!ced) return res.status(400).json({ error: "student_cedula requerida" });

  const g = Number(grade);
  if (!Number.isFinite(g) || g < 0 || g > 100) {
    return res.status(400).json({ error: "grade inválida (0..100)" });
  }

  // ✅ 1) verificar que la evaluación es del teacher
  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_teacher")
    .eq("id", examId)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu evaluación" });

  // ✅ 2) buscar estudiante por cédula (tabla users)
  const { data: st, error: stErr } = await supabaseAdmin
    .from("users")
    .select("id,cedula,name,email,id_course")
    .eq("cedula", ced)
    .maybeSingle();

  if (stErr) return res.status(500).json({ error: stErr.message });
  if (!st?.id) return res.status(404).json({ error: "No existe estudiante con esa cédula" });
    // ✅ 2.1) validar que el estudiante pertenece al curso de la evaluación
  const { data: ev2, error: ev2Err } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_course")
    .eq("id", examId)
    .maybeSingle();

  if (ev2Err) return res.status(500).json({ error: ev2Err.message });

  if (Number(st.id_course) !== Number(ev2.id_course)) {
    return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
  }


  // ✅ 3) upsert en grades (requiere UNIQUE(id_exam,id_student))
  const payload = {
    id_exam: examId,
    id_student: st.id,
    grade: g,
    source: "MANUAL",
    finished_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("grades")
    .upsert(payload, { onConflict: "id_exam,id_student" })
    .select("id_exam,id_student,grade,finished_at,source")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    ok: true,
    student: { id: st.id, cedula: st.cedula, name: st.name },
    grade: data,
  });
});

// PATCH /api/teacher/evaluations/:id
teacherRouter.patch("/evaluations/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const percent = Number(req.body?.percent);

    if (!id) return res.status(400).json({ message: "ID inválido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ message: "Percent inválido (1..100)" });
    }

    // (Recomendado) Validar que esa evaluación pertenece a una materia del prof
    // Si ya tienes esa validación en tus endpoints teacher, úsala aquí también.

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .update({ percent })
      .eq("id", id)
      .select("id, percent")
      .single();

    if (error) throw error;

    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ message: e?.message || "Error actualizando porcentaje" });
  }
});
