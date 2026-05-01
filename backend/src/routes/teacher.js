import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";
import {
  getAnioLectivoVigente,
  requireAnioVigenteForCourse,
  handleYearError,
} from "../lib/anioLectivo.js";
import { closeExpiredExams } from "../lib/examClosure.js";

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

  const classes = filtered
    .map((r) => r.class ? { ...r.class, id_course: r.id_course ?? null } : null)
    .filter(Boolean);

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
        .select("id_class, id_course, course:course(id,name,year), class:class(id,name,level,id_module,id_group,module:module(id,name))")
        .eq("id_teacher", teacherId)
        .order("id_class", { ascending: true })
        .then(({ data }) => (data || []).filter((r) => Number(r.course?.year) === Number(year))),
    ]);
    const cleanClasses = (teacherClasses || []).filter(Boolean);

    const classGroupMap = new Map(cleanClasses.map((cls) => [Number(cls.id), cls.group ?? null]));

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
      .map((r) => {
        const group = classGroupMap.get(Number(r.class?.id)) ?? r.class?.group ?? null;
        return {
          class_id: r.id_class,
          class_name: r.class?.name || "",
          level: Number(r.class?.level || 0),
          level_label: levelLabel(Number(r.class?.level || 0), levelMap),
          course_id: r.id_course || null,
          course_name: r.course?.name || "",
          module_id: r.class?.id_module || null,
          module_name: r.class?.module?.name || "",
          group_id: r.class?.id_group || null,
          group_name: group?.name || "",
        };
      })
      .sort((a, b) => {
        const cmp = (x, y) => String(x ?? "").localeCompare(String(y ?? ""), "es");
        return (
          a.level - b.level ||
          cmp(a.course_name, b.course_name) ||
          cmp(a.module_name, b.module_name) ||
          cmp(a.group_name, b.group_name) ||
          cmp(a.class_name, b.class_name)
        );
      });

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

    const evalSelect = `
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
    `;

    let q = supabaseAdmin
      .from("evaluation")
      .select(evalSelect)
      .eq("id_teacher", teacherId)
      .order("created_at", { ascending: false });

    if (classId) q = q.eq("id_class", classId);

    const { data: ownData, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Also include group evaluations for groups the teacher is assigned to,
    // regardless of who created them.
    const teacherClasses = await getTeacherClasses(teacherId, year);
    const groupIds = [...new Set(teacherClasses.map((c) => c.id_group).filter(Boolean))];

    let groupData = [];
    if (groupIds.length > 0) {
      const { data: gd, error: gErr } = await supabaseAdmin
        .from("evaluation")
        .select(evalSelect)
        .in("id_group", groupIds)
        .order("created_at", { ascending: false });
      if (gErr) return res.status(500).json({ error: gErr.message });
      groupData = gd || [];
    }

    // Merge, keeping own evals first and deduplicating by id.
    const ownIds = new Set((ownData || []).map((e) => e.id));
    const merged = [...(ownData || [])];
    for (const ge of groupData) {
      if (!ownIds.has(ge.id)) merged.push(ge);
    }

    let items = merged;

    if (level) {
      items = items.filter((it) => Number(it?.class?.level ?? it?.course?.level ?? 0) === level);
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
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts")
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

  await closeExpiredExams({ evaluationIds: [examId] });

  const { data, error } = await supabaseAdmin
    .from("grades")
    .select("id_student,grade,finished_at,attempts")
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
        id_teacher: teacherId,
        id_type: Number(typeId),
        percent: p,
        title: t,
        id_module: cls.id_module ?? null,
        ...(cls.id_group ? { id_group: cls.id_group } : { id_class: classIdNum }),
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
  const { exam_id, student_cedula, student_id, grade } = req.body || {};

  const examId = Number(exam_id);
  if (!examId) return res.status(400).json({ error: "exam_id requerido" });

  const ced = String(student_cedula || "").trim();
  const stId = String(student_id || "").trim();
  if (!ced && !stId) return res.status(400).json({ error: "student_cedula o student_id requerido" });

  const g = Number(grade);
  if (!Number.isFinite(g) || g < 0 || g > 100) {
    return res.status(400).json({ error: "grade inválida (0..100)" });
  }

  const { data: ev, error: evErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_teacher,id_course,evaluation_type:evaluation_type(type)")
    .eq("id", examId)
    .maybeSingle();

  if (evErr) return res.status(500).json({ error: evErr.message });
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) {
    return res.status(403).json({ error: "No es tu evaluación" });
  }

  if (String(ev.evaluation_type?.type || "").toLowerCase() === "examen") {
    return res.status(400).json({ error: "Las notas de examen se registran al presentar el examen o por cierre automático" });
  }

  let stQuery = supabaseAdmin.from("users").select("id,cedula,name,email,id_course");
  if (ced) {
    stQuery = stQuery.eq("cedula", ced);
  } else {
    stQuery = stQuery.eq("id", stId);
  }
  const { data: st, error: stErr } = await stQuery.maybeSingle();

  if (stErr) return res.status(500).json({ error: stErr.message });
  if (!st?.id) return res.status(404).json({ error: ced ? "No existe estudiante con esa cédula" : "No existe estudiante con ese id" });

  if (Number(st.id_course) !== Number(ev.id_course)) {
    return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
  }

  try { await requireAnioVigenteForCourse(ev.id_course); }
  catch (err) { return handleYearError(res, err); }

  const { data: existingGrade, error: existingGradeErr } = await supabaseAdmin
    .from("grades")
    .select("attempts")
    .eq("id_exam", examId)
    .eq("id_student", st.id)
    .maybeSingle();

  if (existingGradeErr) return res.status(500).json({ error: existingGradeErr.message });

  const payload = {
    id_exam: examId,
    id_student: st.id,
    grade: g,
    finished_at: new Date().toISOString(),
    attempts: Number(existingGrade?.attempts ?? 0) + 1,
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
 * Group grade grid — evaluaciones de grupo del profesor
 * GET /api/teacher/group-grade-grid?group_id=1
 */
teacherRouter.get("/group-grade-grid", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const groupId = Number(req.query.group_id);
    if (!groupId) return res.status(400).json({ error: "group_id requerido" });

    // Verify teacher is assigned to at least one class in this group.
    const teacherClasses = await getTeacherClasses(teacherId);
    const hasGroup = teacherClasses.some((c) => Number(c.id_group) === groupId);
    if (!hasGroup) return res.status(403).json({ error: "No tienes materias asignadas en este grupo" });

    // Fetch ALL evaluations for this group (any teacher).
    const { data: evRows, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select(`id,title,percent,created_at,id_course,id_class,id_group,id_type,
        course:course(id,name,level,year),
        class:class(id,name,level),
        evaluation_type:evaluation_type(id,type),
        group:group(id,name)`)
      .eq("id_group", groupId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (evErr) return res.status(500).json({ error: evErr.message });
    const evals = evRows || [];

    // Resolve group metadata even when there are no evaluations yet.
    let groupMeta = evals[0]?.group ?? null;
    if (!groupMeta) {
      const { data: gRow } = await supabaseAdmin.from("group").select("id,name").eq("id", groupId).maybeSingle();
      groupMeta = gRow ?? { id: groupId, name: `Grupo ${groupId}` };
    }

    if (evals.length === 0) {
      return res.json({ class: null, group: { ...groupMeta, level: null }, evaluations: [], students: [], grades: [] });
    }

    const group = groupMeta;
    const level = evals[0].course?.level ?? null;

    const courseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = courseIds.length > 0 ? await getStudentsByCourseIds(courseIds) : [];

    let courseNameMap = new Map();
    if (courseIds.length > 0) {
      const { data: cRows } = await supabaseAdmin.from("course").select("id,name").in("id", courseIds);
      courseNameMap = new Map((cRows || []).map((c) => [Number(c.id), c.name]));
    }

    const students = (studentsRaw || []).map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts")
        .in("id_exam", examIds)
        .in("id_student", studentIds);
      if (gErr) return res.status(500).json({ error: gErr.message });
      grades = gRows || [];
    }

    return res.json({ class: null, group: { ...group, level }, evaluations: evals, students, grades });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cargando grilla de grupo" });
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
      await closeExpiredExams({ courseIds: allCourseIds, evaluationIds: allExamIds });
      const { data: gRows, error: gErr } = await supabaseAdmin
        .from("grades")
        .select("id_student,id_exam,grade,finished_at,attempts")
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

// ============================================================================
// EXÁMENES ONLINE — endpoints para profesores
// ============================================================================

async function resolveExamenTypeId(year) {
  const { data: existing } = await supabaseAdmin
    .from("evaluation_type")
    .select("id")
    .eq("type", "Examen")
    .eq("year", year)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from("evaluation_type")
    .insert({ type: "Examen", year })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return created.id;
}

async function getExamenTypeIds() {
  const { data } = await supabaseAdmin
    .from("evaluation_type")
    .select("id")
    .eq("type", "Examen");
  return (data || []).map((r) => r.id);
}

const TIPOS_VALIDOS_EXAMEN = ["multiple_multi", "multiple_single", "falso_verdadero", "emparejamiento"];

function validatePreguntas(preguntas) {
  if (!Array.isArray(preguntas)) return "preguntas debe ser un array";
  if (preguntas.length < 1)
    return "El examen debe tener al menos 1 pregunta";
  for (let i = 0; i < preguntas.length; i++) {
    const p = preguntas[i]; const n = i + 1;
    if (!TIPOS_VALIDOS_EXAMEN.includes(p?.tipo))
      return `Pregunta ${n}: tipo inválido ('${p?.tipo}')`;
    if (!String(p?.enunciado || "").trim())
      return `Pregunta ${n}: enunciado requerido`;
    const pts = Number(p?.puntos);
    if (!Number.isFinite(pts) || pts <= 0)
      return `Pregunta ${n}: puntos inválidos`;
    if (!p?.opciones)
      return `Pregunta ${n}: opciones requeridas`;
    if (!p?.respuesta_correcta)
      return `Pregunta ${n}: respuesta_correcta requerida`;
    const rc = p.respuesta_correcta;
    const rcVacia =
      (Array.isArray(rc) && rc.length === 0) ||
      (typeof rc === "object" && !Array.isArray(rc) && Object.keys(rc).length === 0);
    if (rcVacia)
      return `Pregunta ${n}: debe tener al menos una respuesta correcta`;
  }
  const suma = preguntas.reduce((acc, p) => acc + Number(p.puntos), 0);
  if (Math.abs(suma - 100) > 0.01)
    return `La suma de puntos debe ser 100 (actual: ${suma})`;
  return null;
}

/**
 * POST /api/teacher/exams — Crear examen
 */
teacherRouter.post("/exams", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId      = req.auth.user.id;
    const id_course      = Number(req.body?.id_course);
    const id_class       = Number(req.body?.id_class);
    const title          = String(req.body?.title || "").trim();
    const percent        = Number(req.body?.percent);
    const tiempo_minutos = Number(req.body?.tiempo_minutos);
    const preguntas      = req.body?.preguntas;

    if (!id_course)       return res.status(400).json({ error: "id_course requerido" });
    if (!id_class)        return res.status(400).json({ error: "id_class requerido" });
    if (!title)           return res.status(400).json({ error: "title requerido" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
      return res.status(400).json({ error: "percent inválido (1..100)" });
    if (!tiempo_minutos || tiempo_minutos < 1)
      return res.status(400).json({ error: "tiempo_minutos requerido (mínimo 1)" });

    const pregErr = validatePreguntas(preguntas);
    if (pregErr) return res.status(400).json({ error: pregErr });

    const allowed = await teacherHasClass(teacherId, id_class);
    if (!allowed) return res.status(403).json({ error: "La materia no está asignada a este profesor" });

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from("class")
      .select("id,name,level,id_module,id_group")
      .eq("id", id_class)
      .maybeSingle();
    if (clsErr) return res.status(500).json({ error: clsErr.message });
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { data: course, error: cErr } = await supabaseAdmin
      .from("course")
      .select("id,name,level,year")
      .eq("id", id_course)
      .maybeSingle();
    if (cErr) return res.status(500).json({ error: cErr.message });
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });
    if (Number(course.level) !== Number(cls.level))
      return res.status(400).json({ error: "El curso no corresponde al nivel de la materia" });

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const examenTypeId = await resolveExamenTypeId(course.year);

    const { data: evalData, error: evalErr } = await supabaseAdmin
      .from("evaluation")
      .insert({
        id_course,
        id_class,
        id_teacher:     teacherId,
        id_type:        examenTypeId,
        percent,
        title,
        id_module:      cls.id_module || null,
        id_group:       cls.id_group  || null,
        tiempo_minutos,
      })
      .select("id,title,percent,tiempo_minutos,created_at")
      .maybeSingle();
    if (evalErr) return res.status(500).json({ error: evalErr.message });

    const detalleRows = preguntas.map((p, idx) => ({
      id_evaluation:      evalData.id,
      orden:              idx + 1,
      tipo:               p.tipo,
      enunciado:          String(p.enunciado || "").trim(),
      puntos:             Number(p.puntos),
      opciones:           p.opciones,
      respuesta_correcta: p.respuesta_correcta,
    }));

    const { error: detErr } = await supabaseAdmin.from("examen_detalle").insert(detalleRows);
    if (detErr) {
      await supabaseAdmin.from("evaluation").delete().eq("id", evalData.id);
      return res.status(500).json({ error: `Error guardando preguntas: ${detErr.message}` });
    }

    return res.status(201).json({ ok: true, item: evalData });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error creando examen" });
  }
});

/**
 * GET /api/teacher/exams/:id — Cargar examen para editar
 */
teacherRouter.get("/exams/:id", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    const examenTypeIds = await getExamenTypeIds();

    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,title,percent,tiempo_minutos,id_course,id_class,id_module,id_group,id_teacher")
      .eq("id", id)
      .in("id_type", examenTypeIds)
      .maybeSingle();
    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu examen" });

    const { data: preguntas, error: detErr } = await supabaseAdmin
      .from("examen_detalle")
      .select("id,orden,tipo,enunciado,puntos,opciones,respuesta_correcta")
      .eq("id_evaluation", id)
      .order("orden");
    if (detErr) return res.status(500).json({ error: detErr.message });

    return res.json({ item: { ...ev, preguntas: preguntas || [] } });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error cargando examen" });
  }
});

/**
 * PUT /api/teacher/exams/:id — Actualizar examen
 */
teacherRouter.put("/exams/:id", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId      = req.auth.user.id;
    const id             = Number(req.params.id);
    const tiempo_minutos = Number(req.body?.tiempo_minutos);
    const percent        = Number(req.body?.percent);
    const preguntas      = req.body?.preguntas;

    if (!id) return res.status(400).json({ error: "ID inválido" });
    if (!tiempo_minutos || tiempo_minutos < 1)
      return res.status(400).json({ error: "tiempo_minutos requerido (mínimo 1)" });
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
      return res.status(400).json({ error: "percent inválido (1..100)" });

    const pregErr = validatePreguntas(preguntas);
    if (pregErr) return res.status(400).json({ error: pregErr });

    const examenTypeIds = await getExamenTypeIds();
    const { data: ev, error: evErr } = await supabaseAdmin
      .from("evaluation")
      .select("id,id_teacher,id_course,id_type")
      .eq("id", id)
      .maybeSingle();
    if (evErr) return res.status(500).json({ error: evErr.message });
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });
    if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu examen" });

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { count: intentosCount, error: intentosErr } = await supabaseAdmin
      .from("rta_examen")
      .select("id", { count: "exact", head: true })
      .eq("id_evaluation", id)
      .not("finalizado_at", "is", null);

    if (intentosErr) return res.status(500).json({ error: intentosErr.message });
    if (intentosCount > 0)
      return res.status(409).json({
        error: `No se puede editar: ${intentosCount} alumno${intentosCount !== 1 ? "s" : ""} ya ${intentosCount !== 1 ? "rindieron" : "rindió"} este examen.`,
      });

    const { error: updErr } = await supabaseAdmin
      .from("evaluation")
      .update({ tiempo_minutos, percent })
      .eq("id", id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    const { error: delErr } = await supabaseAdmin
      .from("examen_detalle")
      .delete()
      .eq("id_evaluation", id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    const detalleRows = preguntas.map((p, idx) => ({
      id_evaluation:      id,
      orden:              idx + 1,
      tipo:               p.tipo,
      enunciado:          String(p.enunciado || "").trim(),
      puntos:             Number(p.puntos),
      opciones:           p.opciones,
      respuesta_correcta: p.respuesta_correcta,
    }));

    const { error: insErr } = await supabaseAdmin.from("examen_detalle").insert(detalleRows);
    if (insErr) return res.status(500).json({ error: `Error actualizando preguntas: ${insErr.message}` });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Error actualizando examen" });
  }
});

// ── Reporte de Asistencia (solo materias del profesor) ───────────────────────

/**
 * GET /api/teacher/attendance/modules?course_id=X
 * Módulos del profesor en el curso dado
 */
teacherRouter.get("/attendance/modules", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const courseId  = Number(req.query.course_id || 0);
    if (!courseId) return res.status(400).json({ error: "course_id requerido" });

    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("class:id_class(id_module)")
      .eq("id_teacher", teacherId)
      .eq("id_course", courseId);

    if (ctErr) return res.status(500).json({ error: ctErr.message });

    const moduleIds = [...new Set((ctRows || []).map((r) => r.class?.id_module).filter(Boolean))];
    if (!moduleIds.length) return res.json({ items: [] });

    const { data, error } = await supabaseAdmin
      .from("module").select("id,name").in("id", moduleIds).order("name", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/teacher/attendance/classes?module_id=X&course_id=X
 * Materias del profesor en el módulo y curso dados
 */
teacherRouter.get("/attendance/classes", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const courseId  = Number(req.query.course_id || 0);
    const moduleRaw = String(req.query.module_id || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);

    if (!courseId || !moduleRaw) return res.status(400).json({ error: "course_id y module_id requeridos" });

    const { data: ctRows, error: ctErr } = await supabaseAdmin
      .from("class_teacher")
      .select("class:id_class(id,name,id_module)")
      .eq("id_teacher", teacherId)
      .eq("id_course", courseId);

    if (ctErr) return res.status(500).json({ error: ctErr.message });

    let classes = (ctRows || []).map((r) => r.class).filter(Boolean);
    if (moduleId !== "todos") classes = classes.filter((c) => Number(c.id_module) === Number(moduleId));

    const seen = new Set();
    const items = classes
      .filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"))
      .map((c) => ({ id: c.id, name: c.name }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/teacher/attendance/fechas?course_id=X&module_id=X&class_id=X
 */
teacherRouter.get("/attendance/fechas", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const courseId  = Number(req.query.course_id || 0);
    const moduleRaw = String(req.query.module_id || "");
    const classRaw  = String(req.query.class_id  || "");
    const moduleId  = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId   = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!courseId || !moduleRaw || !classRaw)
      return res.status(400).json({ error: "course_id, module_id y class_id requeridos" });

    const { data: ctRows } = await supabaseAdmin
      .from("class_teacher").select("id_class")
      .eq("id_teacher", teacherId).eq("id_course", courseId);

    const teacherClassIds = (ctRows || []).map((r) => r.id_class);
    if (!teacherClassIds.length)
      return res.status(403).json({ error: "No tienes materias asignadas en este curso" });

    let query = supabaseAdmin
      .from("asistencia_sesion").select("id,fecha_clase")
      .eq("id_course", courseId).order("fecha_clase", { ascending: false });

    if (moduleId !== "todos") query = query.eq("id_module", moduleId);
    if (classId  !== "todas") query = query.eq("id_class", classId);
    else                      query = query.in("id_class", teacherClassIds);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const seen = new Set();
    const items = (data || [])
      .filter((r) => { if (seen.has(r.fecha_clase)) return false; seen.add(r.fecha_clase); return true; })
      .map((r) => ({ id: r.id, fecha_clase: r.fecha_clase }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/teacher/attendance/consulta?course_id=X&module_id=X&class_id=X&fecha=X
 */
teacherRouter.get("/attendance/consulta", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const courseId  = Number(req.query.course_id || 0);
    const moduleId  = Number(req.query.module_id || 0);
    const classId   = Number(req.query.class_id  || 0);
    const fecha     = String(req.query.fecha || "").trim();

    if (!courseId || !moduleId || !classId || !fecha)
      return res.status(400).json({ error: "course_id, module_id, class_id y fecha son requeridos" });

    const { data: ct } = await supabaseAdmin
      .from("class_teacher").select("id_class")
      .eq("id_teacher", teacherId).eq("id_course", courseId).eq("id_class", classId).maybeSingle();

    if (!ct) return res.status(403).json({ error: "No tienes esta materia asignada en este curso" });

    const { data: sesion, error: sErr } = await supabaseAdmin
      .from("asistencia_sesion")
      .select("id,id_teacher,profesor_asistio,profesor_reemplazo")
      .eq("id_course", courseId).eq("id_module", moduleId)
      .eq("id_class", classId).eq("fecha_clase", fecha).maybeSingle();

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    const { data: teacherRow } = await supabaseAdmin
      .from("users").select("name").eq("id", sesion.id_teacher).maybeSingle();

    const { data: detalleRows, error: dErr } = await supabaseAdmin
      .from("asistencia_detalle").select("id_student,asistio,motivo").eq("id_sesion", sesion.id);

    if (dErr) return res.status(500).json({ error: dErr.message });

    const studentIds = (detalleRows || []).map((d) => d.id_student);
    let userMap = new Map();
    if (studentIds.length) {
      const { data: usersData } = await supabaseAdmin
        .from("users").select("id,name,cedula").in("id", studentIds);
      userMap = new Map((usersData || []).map((u) => [u.id, u]));
    }

    const detalle = (detalleRows || [])
      .map((d) => ({
        id_student: d.id_student,
        name:   userMap.get(d.id_student)?.name   ?? null,
        cedula: userMap.get(d.id_student)?.cedula ?? null,
        asistio: d.asistio,
        motivo:  d.motivo,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

    return res.json({ sesion: { ...sesion, teacher_name: teacherRow?.name ?? null }, detalle });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/teacher/attendance/consulta-todas?course_id=X&module_id=X&class_id=X[&fecha=X]
 */
teacherRouter.get("/attendance/consulta-todas", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId   = req.auth.user.id;
    const courseId    = Number(req.query.course_id || 0);
    const moduleRaw   = String(req.query.module_id || "");
    const classRaw    = String(req.query.class_id  || "");
    const fechaFiltro = String(req.query.fecha     || "").trim();
    const moduleId    = moduleRaw === "todos" ? "todos" : Number(moduleRaw || 0);
    const classId     = classRaw  === "todas" ? "todas" : Number(classRaw  || 0);

    if (!courseId || !moduleRaw || !classRaw)
      return res.status(400).json({ error: "course_id, module_id y class_id son requeridos" });

    const { data: ctRows } = await supabaseAdmin
      .from("class_teacher").select("id_class")
      .eq("id_teacher", teacherId).eq("id_course", courseId);

    const teacherClassIds = (ctRows || []).map((r) => r.id_class);
    if (!teacherClassIds.length)
      return res.status(403).json({ error: "No tienes materias asignadas en este curso" });

    let query = supabaseAdmin
      .from("asistencia_sesion")
      .select("id,fecha_clase,id_teacher,profesor_asistio,profesor_reemplazo,id_class,class:id_class(id,name)")
      .eq("id_course", courseId).order("fecha_clase", { ascending: true });

    if (moduleId    !== "todos") query = query.eq("id_module",   moduleId);
    if (classId     !== "todas") query = query.eq("id_class",    classId);
    else                         query = query.in("id_class",    teacherClassIds);
    if (fechaFiltro)             query = query.eq("fecha_clase", fechaFiltro);

    const { data: sesiones, error: sErr } = await query;
    if (sErr) return res.status(500).json({ error: sErr.message });
    if (!sesiones?.length) return res.json({ fechas: [], detalle: [] });

    const teacherIds = [...new Set(sesiones.map((s) => s.id_teacher).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length) {
      const { data: td } = await supabaseAdmin.from("users").select("id,name").in("id", teacherIds);
      teacherMap = new Map((td || []).map((u) => [u.id, u.name]));
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
      .from("asistencia_detalle").select("id_sesion,id_student,asistio,motivo").in("id_sesion", sesionIds);

    if (dErr) return res.status(500).json({ error: dErr.message });

    const studentIds = [...new Set((detalleRows || []).map((d) => d.id_student))];
    let userMap = new Map();
    if (studentIds.length) {
      const { data: ud } = await supabaseAdmin.from("users").select("id,name,cedula").in("id", studentIds);
      userMap = new Map((ud || []).map((u) => [u.id, u]));
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
