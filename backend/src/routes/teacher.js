import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import {
  getAnioLectivoVigente,
  requireAnioVigenteForCourse,
  handleYearError,
} from "../lib/anioLectivo.js";

export const teacherRouter = Router();

function requireTeacher(req, res, next) {
  const roles = req.auth?.roles || [];
  if (!roles.includes("T") && !roles.includes("A")) {
    return res.status(403).json({ error: "Solo Teacher/Admin" });
  }
  return next();
}

async function getLevelMap(year) {
  let q = supabaseAdmin.from("level").select("id,name").order("id", { ascending: true });
  if (year) q = q.eq("year", year);
  const { data } = await q;
  const map = {};
  for (const l of data || []) map[l.id] = l.name;
  return map;
}

function levelLabel(level, levelMap = {}) {
  return levelMap[Number(level)] ?? `Año ${level ?? "—"}`;
}

async function getTeacherClasses(teacherId, year) {
  let q = supabaseAdmin
    .from("class_teacher")
    .select("id_class, id_course, class:class(id,name,level,id_module,id_group,module:module(id,name)), course:course(id,year)")
    .eq("id_teacher", teacherId)
    .order("id_class", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  // Filter by year if provided (via course.year)
  const filtered = year
    ? (data || []).filter((r) => Number(r.course?.year) === Number(year))
    : (data || []);

  const classes = filtered.map((r) => r.class).filter(Boolean);

  // id_group en class no tiene FK a group; resolvemos nombres por separado
  const groupIds = [...new Set(classes.map((c) => Number(c.id_group)).filter(Boolean))];
  if (groupIds.length > 0) {
    const { data: groups } = await supabaseAdmin
      .from("group")
      .select("id,name")
      .in("id", groupIds);

    const groupMap = new Map((groups || []).map((g) => [Number(g.id), g]));
    for (const cls of classes) {
      cls.group = groupMap.get(Number(cls.id_group)) ?? null;
    }
  }

  return classes;
}

async function teacherHasClass(teacherId, classId) {
  const { data, error } = await supabaseAdmin
    .from("class_teacher")
    .select("id_class")
    .eq("id_teacher", teacherId)
    .eq("id_class", classId)
    .maybeSingle();

  if (error) throw error;
  return !!data?.id_class;
}

// Cache the student type id — it never changes between requests
let _studentTypeId = null;
async function getStudentTypeId() {
  if (_studentTypeId) return _studentTypeId;
  const { data, error } = await supabaseAdmin
    .from("type")
    .select("id")
    .eq("code", "S")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("No existe type 'S'");
  _studentTypeId = data.id;
  return _studentTypeId;
}

async function getStudentsByCourseIds(courseIds) {
  if (!courseIds?.length) return [];

  const [{ data: users, error: uErr }, studentTypeId] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id,name,cedula,id_course")
      .in("id_course", courseIds)
      .order("name", { ascending: true }),
    getStudentTypeId(),
  ]);

  if (uErr) throw uErr;

  const ids = (users || []).map((u) => u.id);
  if (ids.length === 0) return [];

  const { data: utRows, error: utErr } = await supabaseAdmin
    .from("user_type")
    .select("id_user")
    .eq("id_type", studentTypeId)
    .in("id_user", ids);

  if (utErr) throw utErr;

  const isStudent = new Set((utRows || []).map((r) => r.id_user));

  return (users || []).filter((u) => isStudent.has(u.id));
}

/**
 * DASHBOARD DEL PROFESOR
 * GET /api/teacher/dashboard
 */
teacherRouter.get("/dashboard", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const vigente = await getAnioLectivoVigente();
    const year = req.query.year ? Number(req.query.year) : vigente;

    const [teacherClasses, levelMap, assignData] = await Promise.all([
      getTeacherClasses(teacherId, year),
      getLevelMap(year),
      supabaseAdmin
        .from("class_teacher")
        .select("id_class, id_course, course:course(id,name,year), class:class(id,name,level,id_module,module:module(id,name))")
        .eq("id_teacher", teacherId)
        .order("id_class", { ascending: true })
        .then(({ data }) => (data || []).filter((r) => Number(r.course?.year) === Number(year))),
    ]);
    const cleanClasses = (teacherClasses || []).filter(Boolean);

    const groupsMap = new Map();

    for (const cls of cleanClasses) {
      const lvl = Number(cls.level || 0);
      if (!groupsMap.has(lvl)) {
        groupsMap.set(lvl, {
          level: lvl,
          level_label: levelLabel(lvl, levelMap),
          items: [],
        });
      }
      groupsMap.get(lvl).items.push({
        id: cls.id,
        name: cls.name,
        level: cls.level,
      });
    }

    const groups = [...groupsMap.values()]
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) =>
          String(a.name).localeCompare(String(b.name), "es")
        ),
      }))
      .sort((a, b) => a.level - b.level);

    const levels = [...new Set(cleanClasses.map((c) => Number(c.level)).filter(Boolean))];

    let totalStudents = 0;
    const academicYear = year;

    if (levels.length > 0) {
      const { data: courses, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,year,level")
        .in("level", levels)
        .eq("year", year)
        .order("level", { ascending: true });

      if (cErr) return res.status(500).json({ error: cErr.message });

      const courseIds = (courses || []).map((c) => Number(c.id)).filter(Boolean);

      const students = await getStudentsByCourseIds(courseIds);
      const studentList = students || [];
      totalStudents = new Set(studentList.map((s) => s.id)).size;

      // Conteo de estudiantes por nivel
      // Usamos String() para evitar problemas de tipo con bigint de Supabase
      const courseIdToLevel = {};
      for (const c of courses || []) {
        courseIdToLevel[String(c.id)] = Number(c.level);
      }

      const studentSetByLevel = {};
      for (const s of studentList) {
        const lvl = courseIdToLevel[String(s.id_course)];
        if (lvl != null) {
          if (!studentSetByLevel[lvl]) studentSetByLevel[lvl] = new Set();
          studentSetByLevel[lvl].add(s.id);
        }
      }

      for (const group of groups) {
        group.student_count = studentSetByLevel[group.level]?.size ?? 0;
      }
    }

    const assignments = assignData
      .filter((r) => r.class?.id)
      .map((r) => ({
        class_id: r.id_class,
        class_name: r.class?.name || "",
        level: Number(r.class?.level || 0),
        level_label: levelLabel(Number(r.class?.level || 0), levelMap),
        course_id: r.id_course || null,
        course_name: r.course?.name || "",
        module_id: r.class?.id_module || null,
        module_name: r.class?.module?.name || "",
      }))
      .sort((a, b) => a.level - b.level || a.class_name.localeCompare(b.class_name, "es"));

    return res.json({
      summary: {
        assigned_classes: cleanClasses.length,
        total_students: totalStudents,
        academic_year: academicYear,
      },
      groups,
      assignments,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 0) Mis materias asignadas
 * GET /api/teacher/classes
 */
teacherRouter.get("/classes", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const year = req.query.year ? Number(req.query.year) : null;
    const items = await getTeacherClasses(teacherId, year);
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Cursos del profesor
 * GET /api/teacher/courses
 * GET /api/teacher/courses?class_id=1
 */
teacherRouter.get("/courses", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const classId = req.query.class_id ? Number(req.query.class_id) : null;

    if (classId) {
      const allowed = await teacherHasClass(teacherId, classId);
      if (!allowed) {
        return res.status(403).json({ error: "La materia no está asignada a este profesor" });
      }

      const { data: cls, error: clsErr } = await supabaseAdmin
        .from("class")
        .select("id,level,name")
        .eq("id", classId)
        .maybeSingle();

      if (clsErr) return res.status(500).json({ error: clsErr.message });
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

      const { data: courses, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,name,level,year")
        .eq("level", cls.level)
        .order("level", { ascending: true })
        .order("id", { ascending: true });

      if (cErr) return res.status(500).json({ error: cErr.message });

      return res.json({ items: courses || [] });
    }

    const year = req.query.year ? Number(req.query.year) : null;
    const teacherClasses = await getTeacherClasses(teacherId, year);
    const levels = [...new Set((teacherClasses || []).map((c) => Number(c.level)).filter(Boolean))];

    if (levels.length === 0) {
      return res.json({ items: [] });
    }

    let cq = supabaseAdmin
      .from("course")
      .select("id,name,level,year")
      .in("level", levels)
      .order("level", { ascending: true })
      .order("id", { ascending: true });

    if (year) cq = cq.eq("year", year);

    const { data: courses, error: cErr } = await cq;

    if (cErr) return res.status(500).json({ error: cErr.message });

    return res.json({ items: courses || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

teacherRouter.get("/levels", requireAuth, requireTeacher, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("level")
    .select("id,name")
    .order("id", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
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

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("evaluation_type")
    .select("id,type")
    .eq("type", raw)
    .maybeSingle();

  if (exErr) return res.status(500).json({ error: exErr.message });
  if (existing?.id) return res.json({ item: existing });

  const { data, error } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type: raw })
    .select("id,type")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ item: data });
});

/**
 * 1) Mis evaluaciones
 * GET /api/teacher/evaluations
 */
teacherRouter.get("/evaluations", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const classId = req.query.class_id ? Number(req.query.class_id) : null;
    const level = req.query.level ? Number(req.query.level) : null;
    const year = req.query.year ? Number(req.query.year) : null;

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
        id_module,
        id_group,
        course:course(id,name,level,year),
        class:class(id,name,level),
        evaluation_type:evaluation_type(id,type),
        module:module(id,name),
        group:group(id,name)
      `)
      .eq("id_teacher", teacherId)
      .order("created_at", { ascending: false });

    if (classId) q = q.eq("id_class", classId);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let items = data || [];

    if (level) {
      items = items.filter((it) => Number(it?.class?.level ?? 0) === level);
    }

    if (year) {
      items = items.filter((it) => Number(it?.course?.year ?? 0) === year);
    }

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Grid de notas por materia
 * GET /api/teacher/class-grade-grid?class_id=1
 */
teacherRouter.get("/class-grade-grid", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const classId = Number(req.query.class_id);

    if (!classId) return res.status(400).json({ error: "class_id requerido" });

    const allowed = await teacherHasClass(teacherId, classId);
    if (!allowed) {
      return res.status(403).json({ error: "La materia no está asignada a este profesor" });
    }

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,name,level")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { data: evaluations, error: evErr } = await supabaseAdmin
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
      .eq("id_class", classId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (evErr) return res.status(500).json({ error: evErr.message });

    const evals = evaluations || [];
    if (evals.length === 0) {
      return res.json({
        class: cls,
        evaluations: [],
        students: [],
        grades: [],
      });
    }

    const courseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = await getStudentsByCourseIds(courseIds);

    const { data: courses, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name")
      .in("id", courseIds);

    if (cErr) return res.status(500).json({ error: cErr.message });

    const courseNameMap = new Map((courses || []).map((c) => [Number(c.id), c.name]));

    const students = (studentsRaw || []).map((u) => ({
      id: u.id,
      name: u.name,
      cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);

    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,attempts")
        .in("id_exam", examIds)
        .in("id_student", studentIds);

      if (gErr) return res.status(500).json({ error: gErr.message });
      grades = gRows || [];
    }

    return res.json({
      class: cls,
      evaluations: evals,
      students,
      grades,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 5) Notas existentes de una evaluación
 * GET /api/teacher/exam-grades?exam_id=1
 */
teacherRouter.get("/exam-grades", requireAuth, requireTeacher, async (req, res) => {
  const teacherId = req.auth.user.id;
  const examId = Number(req.query.exam_id);
  if (!examId) return res.status(400).json({ error: "exam_id requerido" });

  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_teacher")
    .eq("id", examId)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) {
    return res.status(403).json({ error: "No es tu evaluación" });
  }

  const { data, error } = await supabaseAdmin
    .from("grades")
    .select("id_student,grade")
    .eq("id_exam", examId);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ items: data || [] });
});

/**
 * 2) Crear evaluación
 * POST /api/teacher/evaluations
 */
teacherRouter.post("/evaluations", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const { id_course, id_class, percent, title, id_type, type_text } = req.body || {};

    if (!id_course || !id_class) {
      return res.status(400).json({ error: "Faltan campos: id_course, id_class" });
    }

    const classIdNum = Number(id_class);
    const courseIdNum = Number(id_course);

    const allowed = await teacherHasClass(teacherId, classIdNum);
    if (!allowed) {
      return res.status(403).json({ error: "La materia no está asignada a este profesor" });
    }

    const p = Number(percent);
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return res.status(400).json({ error: "percent inválido (1..100)" });
    }

    const t = String(title || "").trim();
    if (!t) return res.status(400).json({ error: "title requerido" });

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,level,name,id_group,id_module")
      .eq("id", classIdNum)
      .maybeSingle();

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { data: course, error: courseErr } = await supabaseAdmin
      .from("course")
      .select("id,name,level,year")
      .eq("id", courseIdNum)
      .maybeSingle();

    if (courseErr) return res.status(500).json({ error: courseErr.message });
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });

    if (Number(course.level) !== Number(cls.level)) {
      return res.status(400).json({
        error: "El curso seleccionado no corresponde al mismo level de la materia",
      });
    }

    try { await requireAnioVigenteForCourse(courseIdNum); }
    catch (err) { return handleYearError(res, err); }

    let typeId = Number(id_type || 0);

    if (!typeId) {
      const raw = String(type_text || "").trim();
      if (!raw) return res.status(400).json({ error: "Selecciona un tipo o escribe type_text" });

      const { data: existing, error: exErr } = await supabaseAdmin
        .from("evaluation_type")
        .select("id,type")
        .eq("type", raw)
        .eq("year", course.year)
        .maybeSingle();

      if (exErr) return res.status(500).json({ error: exErr.message });

      if (existing?.id) {
        typeId = existing.id;
      } else {
        const { data: created, error: crErr } = await supabaseAdmin
          .from("evaluation_type")
          .insert({ type: raw, year: course.year })
          .select("id,type")
          .maybeSingle();

        if (crErr) return res.status(500).json({ error: crErr.message });
        typeId = created.id;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .insert({
        id_course: courseIdNum,
        id_class: classIdNum,
        id_teacher: teacherId,
        id_type: Number(typeId),
        percent: p,
        title: t,
        id_group: cls.id_group ?? null,
        id_module: cls.id_module ?? null,
      })
      .select("id,title,percent,created_at,id_course,id_class,id_type")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ item: data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * 3) Subir nota manual (upsert)
 * POST /api/teacher/grades
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

  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_teacher,id_course")
    .eq("id", examId)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) {
    return res.status(403).json({ error: "No es tu evaluación" });
  }

  const { data: st, error: stErr } = await supabaseAdmin
    .from("users")
    .select("id,cedula,name,email,id_course")
    .eq("cedula", ced)
    .maybeSingle();

  if (stErr) return res.status(500).json({ error: stErr.message });
  if (!st?.id) return res.status(404).json({ error: "No existe estudiante con esa cédula" });

  if (Number(st.id_course) !== Number(ev.id_course)) {
    return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
  }

  try { await requireAnioVigenteForCourse(ev.id_course); }
  catch (err) { return handleYearError(res, err); }

  const payload = {
    id_exam: examId,
    id_student: st.id,
    grade: g,
    finished_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("grades")
    .upsert(payload, { onConflict: "id_exam,id_student" })
    .select("id_exam,id_student,grade,finished_at")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    ok: true,
    student: { id: st.id, cedula: st.cedula, name: st.name },
    grade: data,
  });
});

/**
 * PATCH /api/teacher/evaluations/:id
 */
teacherRouter.patch("/evaluations/:id", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const id = Number(req.params.id);
    const percent = Number(req.body?.percent);

    if (!id) return res.status(400).json({ error: "ID inválido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return res.status(400).json({ error: "Percent inválido (1..100)" });
    }

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_teacher,id_course")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
    if (ev.id_teacher !== teacherId) {
      return res.status(403).json({ error: "No puedes editar esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { data, error } = await supabaseAdmin
      .from("evaluation")
      .update({ percent })
      .eq("id", id)
      .select("id,percent")
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando porcentaje" });
  }
});

/**
 * DELETE /api/teacher/evaluations/:id
 */
teacherRouter.delete("/evaluations/:id", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const id = Number(req.params.id);

    if (!id) return res.status(400).json({ error: "ID inválido" });

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_teacher,id_course")
      .eq("id", id)
      .maybeSingle();

    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
    if (ev.id_teacher !== teacherId) {
      return res.status(403).json({ error: "No puedes eliminar esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { error } = await supabaseAdmin.from("evaluation").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error eliminando evaluación" });
  }
});

/**
 * Batch grade grid — replaces N calls to /class-grade-grid
 * GET /api/teacher/grade-grids-batch?class_ids=1,2,3
 */
teacherRouter.get("/grade-grids-batch", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const raw = String(req.query.class_ids || "");
    const classIds = raw
      .split(",")
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);

    if (classIds.length === 0) return res.status(400).json({ error: "class_ids requerido" });

    // 1) Verify all requested classes belong to this teacher (one query)
    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("id_class")
      .eq("id_teacher", teacherId)
      .in("id_class", classIds);

    if (ctErr) return res.status(500).json({ error: ctErr.message });

    const allowedSet = new Set((ctRows || []).map((r) => Number(r.id_class)));
    const denied = classIds.filter((id) => !allowedSet.has(id));
    if (denied.length > 0) {
      return res.status(403).json({ error: `Materias no asignadas: ${denied.join(",")}` });
    }

    // 2) Fetch all class metadata + all evaluations in parallel
    const [{ data: classRows, error: clsErr }, { data: evalRows, error: evErr }] = await Promise.all([
      supabaseAdmin
        .from("class")
        .select("id,name,level")
        .in("id", classIds),
      supabaseAdmin
        .from("evaluation")
        .select(`
          id,title,percent,created_at,
          id_course,id_class,id_type,
          course:course(id,name,level,year),
          class:class(id,name,level),
          evaluation_type:evaluation_type(id,type)
        `)
        .in("id_class", classIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);

    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (evErr) return res.status(500).json({ error: evErr.message });

    const classMap = new Map((classRows || []).map((c) => [c.id, c]));
    const evals = evalRows || [];

    // 3) Fetch students for all unique course_ids (one call)
    const allCourseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = allCourseIds.length > 0 ? await getStudentsByCourseIds(allCourseIds) : [];

    // 4) Fetch course names
    let courseNameMap = new Map();
    if (allCourseIds.length > 0) {
      const { data: courseRows, error: cErr } = await supabaseAdmin
        .from("course")
        .select("id,name")
        .in("id", allCourseIds);
      if (cErr) return res.status(500).json({ error: cErr.message });
      courseNameMap = new Map((courseRows || []).map((c) => [Number(c.id), c.name]));
    }

    const students = studentsRaw.map((u) => ({
      id: u.id,
      name: u.name,
      cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    // 5) Fetch all grades in one query
    const allExamIds = evals.map((e) => e.id);
    const allStudentIds = students.map((s) => s.id);
    let allGrades = [];
    if (allExamIds.length > 0 && allStudentIds.length > 0) {
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,attempts")
        .in("id_exam", allExamIds)
        .in("id_student", allStudentIds);

      if (gErr) return res.status(500).json({ error: gErr.message });
      allGrades = gRows || [];
    }

    // Build per-class sections
    const sections = classIds.map((classId) => {
      const cls = classMap.get(classId) ?? null;
      const classEvals = evals.filter((e) => Number(e.id_class) === classId);
      const classCourseIds = new Set(classEvals.map((e) => Number(e.id_course)).filter(Boolean));
      const classStudents = students.filter((s) => classCourseIds.has(Number(s.id_course)));
      const classExamIds = new Set(classEvals.map((e) => e.id));
      const classStudentIds = new Set(classStudents.map((s) => s.id));
      const classGrades = allGrades.filter(
        (g) => classExamIds.has(g.id_exam) && classStudentIds.has(g.id_student)
      );
      return { class: cls, evaluations: classEvals, students: classStudents, grades: classGrades };
    });

    return res.json({ sections });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});