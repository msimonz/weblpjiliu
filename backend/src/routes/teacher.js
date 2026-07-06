import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { query } from "../db.js";
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
  let sql = `SELECT id, name FROM level`;
  const params = [];
  if (year) { params.push(year); sql += ` WHERE year = $${params.length}`; }
  sql += ` ORDER BY id ASC`;
  const { rows } = await query(sql, params);
  const map = {};
  for (const l of rows) map[l.id] = l.name;
  return map;
}

function levelLabel(level, levelMap = {}) {
  return levelMap[Number(level)] ?? `Año ${level ?? "—"}`;
}

async function getTeacherClasses(teacherId, year) {
  let sql = `
    SELECT ct.id_class, ct.id_course, c.id, c.name, c.level, c.id_module, c.id_group,
           m.id AS module_id, m.name AS module_name, co.year AS course_year
    FROM class_teacher ct
    JOIN class c ON c.id = ct.id_class
    LEFT JOIN module m ON m.id = c.id_module
    JOIN course co ON co.id = ct.id_course
    WHERE ct.id_teacher = $1
  `;
  const params = [teacherId];
  if (year) { params.push(year); sql += ` AND co.year = $${params.length}`; }
  sql += ` ORDER BY ct.id_class ASC`;

  const { rows } = await query(sql, params);

  const classes = rows.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    id_module: r.id_module,
    id_group: r.id_group,
    module: r.module_id ? { id: r.module_id, name: r.module_name } : null,
    id_course: r.id_course ?? null,
  }));

  const groupIds = [...new Set(classes.map((c) => Number(c.id_group)).filter(Boolean))];
  if (groupIds.length > 0) {
    const { rows: groups } = await query(
      `SELECT id, name FROM "group" WHERE id = ANY($1::bigint[])`,
      [groupIds]
    );

    const groupMap = new Map(groups.map((g) => [Number(g.id), g]));
    for (const cls of classes) {
      cls.group = groupMap.get(Number(cls.id_group)) ?? null;
    }
  }

  return classes;
}

async function teacherHasClass(teacherId, classId) {
  const { rows } = await query(
    `SELECT id_class FROM class_teacher WHERE id_teacher = $1 AND id_class = $2 LIMIT 1`,
    [teacherId, classId]
  );
  return !!rows[0]?.id_class;
}

// Cache the student type id — it never changes between requests
let _studentTypeId = null;
async function getStudentTypeId() {
  if (_studentTypeId) return _studentTypeId;
  const { rows } = await query(`SELECT id FROM type WHERE code = $1 LIMIT 1`, ["S"]);
  if (!rows[0]?.id) throw new Error("No existe type 'S'");
  _studentTypeId = rows[0].id;
  return _studentTypeId;
}

async function getStudentsByCourseIds(courseIds) {
  if (!courseIds?.length) return [];

  const [{ rows: users }, studentTypeId] = await Promise.all([
    query(
      `SELECT id, name, cedula, id_course FROM users WHERE id_course = ANY($1::bigint[]) AND estado = 'Activo' ORDER BY name ASC`,
      [courseIds]
    ),
    getStudentTypeId(),
  ]);

  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];

  const { rows: utRows } = await query(
    `SELECT id_user FROM user_type WHERE id_type = $1 AND id_user = ANY($2::uuid[])`,
    [studentTypeId, ids]
  );

  const isStudent = new Set(utRows.map((r) => r.id_user));

  return users.filter((u) => isStudent.has(u.id));
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

    const [teacherClasses, levelMap, assignRows] = await Promise.all([
      getTeacherClasses(teacherId, year),
      getLevelMap(year),
      query(
        `SELECT ct.id_class, ct.id_course, co.id AS course_id, co.name AS course_name, co.year AS course_year,
                c.id AS class_id, c.name AS class_name, c.level, c.id_module, c.id_group,
                m.id AS module_id, m.name AS module_name
         FROM class_teacher ct
         JOIN course co ON co.id = ct.id_course
         JOIN class c ON c.id = ct.id_class
         LEFT JOIN module m ON m.id = c.id_module
         WHERE ct.id_teacher = $1
         ORDER BY ct.id_class ASC`,
        [teacherId]
      ).then(({ rows }) => rows.filter((r) => Number(r.course_year) === Number(year))),
    ]);
    const cleanClasses = teacherClasses.filter(Boolean);

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
    const studentCountByCourseId = {};

    if (levels.length > 0) {
      const { rows: courses } = await query(
        `SELECT id, year, level FROM course WHERE level = ANY($1::int[]) AND year = $2 ORDER BY level ASC`,
        [levels, year]
      );

      const courseIds = courses.map((c) => Number(c.id)).filter(Boolean);

      const students = await getStudentsByCourseIds(courseIds);
      const studentList = students || [];
      totalStudents = new Set(studentList.map((s) => s.id)).size;

      // Conteo de estudiantes por nivel
      const courseIdToLevel = {};
      for (const c of courses) {
        courseIdToLevel[String(c.id)] = Number(c.level);
      }

      const studentSetByLevel = {};
      const studentSetByCourse = {};
      for (const s of studentList) {
        const lvl = courseIdToLevel[String(s.id_course)];
        if (lvl != null) {
          if (!studentSetByLevel[lvl]) studentSetByLevel[lvl] = new Set();
          studentSetByLevel[lvl].add(s.id);
        }

        const courseId = String(s.id_course);
        if (courseId) {
          if (!studentSetByCourse[courseId]) studentSetByCourse[courseId] = new Set();
          studentSetByCourse[courseId].add(s.id);
        }
      }

      for (const group of groups) {
        group.student_count = studentSetByLevel[group.level]?.size ?? 0;
      }

      for (const [courseId, set] of Object.entries(studentSetByCourse)) {
        studentCountByCourseId[courseId] = set.size;
      }
    }

    const assignments = assignRows
      .filter((r) => r.class_id)
      .map((r) => {
        const group = classGroupMap.get(Number(r.class_id)) ?? null;
        return {
          class_id: r.id_class,
          class_name: r.class_name || "",
          level: Number(r.level || 0),
          level_label: levelLabel(Number(r.level || 0), levelMap),
          course_id: r.id_course || null,
          course_name: r.course_name || "",
          course_student_count: r.id_course ? studentCountByCourseId[String(r.id_course)] ?? 0 : 0,
          module_id: r.id_module || null,
          module_name: r.module_name || "",
          group_id: r.id_group || null,
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

      const { rows: clsRows } = await query(
        `SELECT id, level, name FROM class WHERE id = $1 LIMIT 1`,
        [classId]
      );
      const cls = clsRows[0];
      if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

      const { rows: courses } = await query(
        `SELECT id, name, level, year FROM course WHERE level = $1 ORDER BY level ASC, id ASC`,
        [cls.level]
      );

      return res.json({ items: courses });
    }

    const year = req.query.year ? Number(req.query.year) : null;
    const teacherClasses = await getTeacherClasses(teacherId, year);
    const levels = [...new Set(teacherClasses.map((c) => Number(c.level)).filter(Boolean))];

    if (levels.length === 0) {
      return res.json({ items: [] });
    }

    let sql = `SELECT id, name, level, year FROM course WHERE level = ANY($1::int[])`;
    const params = [levels];
    if (year) { params.push(year); sql += ` AND year = $${params.length}`; }
    sql += ` ORDER BY level ASC, id ASC`;

    const { rows: courses } = await query(sql, params);

    return res.json({ items: courses });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

teacherRouter.get("/levels", requireAuth, requireTeacher, async (req, res) => {
  try {
    const teacherId = req.auth.user.id;
    const vigente = await getAnioLectivoVigente();
    const year = req.query.year ? Number(req.query.year) : vigente;

    const teacherClasses = await getTeacherClasses(teacherId, year);
    const assignedLevelIds = [
      ...new Set(teacherClasses.map((c) => Number(c.level)).filter(Boolean)),
    ].sort((a, b) => a - b);

    if (assignedLevelIds.length === 0) return res.json({ items: [] });

    const { rows } = await query(
      `SELECT id, name FROM level WHERE id = ANY($1::int[]) AND year = $2 ORDER BY id ASC`,
      [assignedLevelIds, year]
    );

    const levelNameById = new Map(rows.map((l) => [Number(l.id), l.name]));
    const items = assignedLevelIds.map((id) => ({
      id,
      name: levelNameById.get(id) ?? `Año ${id}`,
    }));

    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

teacherRouter.get("/evaluation-types", requireAuth, requireTeacher, async (req, res) => {
  const { rows } = await query(`SELECT id, type, created_at FROM evaluation_type ORDER BY id ASC`);
  return res.json({ items: rows });
});

teacherRouter.post("/evaluation-types", requireAuth, requireTeacher, async (req, res) => {
  const raw = String(req.body?.type || "").trim();
  if (!raw) return res.status(400).json({ error: "type requerido" });

  const { rows: existingRows } = await query(
    `SELECT id, type FROM evaluation_type WHERE type = $1 LIMIT 1`,
    [raw]
  );
  if (existingRows[0]?.id) return res.json({ item: existingRows[0] });

  const { rows } = await query(
    `INSERT INTO evaluation_type (type) VALUES ($1) RETURNING id, type`,
    [raw]
  );
  return res.json({ item: rows[0] });
});

/**
 * 1) Mis evaluaciones
 * GET /api/teacher/evaluations
 */
const EVAL_SELECT = `
  ev.id, ev.title, ev.percent, ev.created_at, ev.id_course, ev.id_class, ev.id_type, ev.id_module, ev.id_group,
  co.id AS course_id, co.name AS course_name, co.level AS course_level, co.year AS course_year,
  cl.id AS class_id, cl.name AS class_name, cl.level AS class_level,
  et.id AS et_id, et.type AS et_type,
  m.id AS mod_id, m.name AS mod_name,
  g.id AS grp_id, g.name AS grp_name
  FROM evaluation ev
  LEFT JOIN course co ON co.id = ev.id_course
  LEFT JOIN class cl ON cl.id = ev.id_class
  LEFT JOIN evaluation_type et ON et.id = ev.id_type
  LEFT JOIN module m ON m.id = ev.id_module
  LEFT JOIN "group" g ON g.id = ev.id_group
`;

function mapEvalRow(r) {
  return {
    id: r.id,
    title: r.title,
    percent: r.percent,
    created_at: r.created_at,
    id_course: r.id_course,
    id_class: r.id_class,
    id_type: r.id_type,
    id_module: r.id_module,
    id_group: r.id_group,
    course: r.course_id ? { id: r.course_id, name: r.course_name, level: r.course_level, year: r.course_year } : null,
    class: r.class_id ? { id: r.class_id, name: r.class_name, level: r.class_level } : null,
    evaluation_type: r.et_id ? { id: r.et_id, type: r.et_type } : null,
    module: r.mod_id ? { id: r.mod_id, name: r.mod_name } : null,
    group: r.grp_id ? { id: r.grp_id, name: r.grp_name } : null,
  };
}

teacherRouter.get("/evaluations", requireAuth, requireTeacher, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const teacherId = req.auth.user.id;
    const classId = req.query.class_id ? Number(req.query.class_id) : null;
    const level = req.query.level ? Number(req.query.level) : null;
    const year = req.query.year ? Number(req.query.year) : null;

    let sql = `SELECT ${EVAL_SELECT} WHERE ev.id_teacher = $1`;
    const params = [teacherId];
    if (classId) { params.push(classId); sql += ` AND ev.id_class = $${params.length}`; }
    sql += ` ORDER BY ev.created_at DESC`;

    const { rows: ownRows } = await query(sql, params);
    const ownData = ownRows.map(mapEvalRow);

    // Also include group evaluations for groups the teacher is assigned to,
    // regardless of who created them. When a specific class is requested,
    // scope this to that class's own group (if any) instead of every group
    // the teacher teaches — otherwise unrelated classes' evaluations leak in.
    const teacherClasses = await getTeacherClasses(teacherId, year);
    const relevantClasses = classId
      ? teacherClasses.filter((c) => Number(c.id) === classId)
      : teacherClasses;
    const groupIds = [...new Set(relevantClasses.map((c) => c.id_group).filter(Boolean))];

    let groupData = [];
    if (groupIds.length > 0) {
      const { rows: gRows } = await query(
        `SELECT ${EVAL_SELECT} WHERE ev.id_group = ANY($1::bigint[]) ORDER BY ev.created_at DESC`,
        [groupIds]
      );
      groupData = gRows.map(mapEvalRow);
    }

    // Merge, keeping own evals first and deduplicating by id.
    const ownIds = new Set(ownData.map((e) => e.id));
    const merged = [...ownData];
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

    const { rows: clsRows } = await query(
      `SELECT id, name, level FROM class WHERE id = $1 LIMIT 1`,
      [classId]
    );
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { rows: evalRows } = await query(
      `SELECT ${EVAL_SELECT} WHERE ev.id_class = $1 ORDER BY ev.created_at ASC, ev.id ASC`,
      [classId]
    );
    const evals = evalRows.map(mapEvalRow);

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

    const { rows: courses } = await query(
      `SELECT id, name FROM course WHERE id = ANY($1::bigint[])`,
      [courseIds]
    );

    const courseNameMap = new Map(courses.map((c) => [Number(c.id), c.name]));

    const students = studentsRaw.map((u) => ({
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
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [examIds, studentIds]
      );
      grades = gRows;
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

  const { rows: evRows } = await query(
    `SELECT id, id_teacher FROM evaluation WHERE id = $1 LIMIT 1`,
    [examId]
  );
  const ev = evRows[0];
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) {
    return res.status(403).json({ error: "No es tu evaluación" });
  }

  await closeExpiredExams({ evaluationIds: [examId] });

  const { rows } = await query(
    `SELECT id_student, grade, finished_at, attempts FROM grades WHERE id_exam = $1`,
    [examId]
  );

  return res.json({ items: rows });
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

    const { rows: clsRows } = await query(
      `SELECT id, level, name, id_group, id_module FROM class WHERE id = $1 LIMIT 1`,
      [classIdNum]
    );
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { rows: courseRows } = await query(
      `SELECT id, name, level, year FROM course WHERE id = $1 LIMIT 1`,
      [courseIdNum]
    );
    const course = courseRows[0];
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

      const { rows: existingRows } = await query(
        `SELECT id, type FROM evaluation_type WHERE type = $1 AND year = $2 LIMIT 1`,
        [raw, course.year]
      );

      if (existingRows[0]?.id) {
        typeId = existingRows[0].id;
      } else {
        const { rows: createdRows } = await query(
          `INSERT INTO evaluation_type (type, year) VALUES ($1, $2) RETURNING id, type`,
          [raw, course.year]
        );
        typeId = createdRows[0].id;
      }
    }

    const idClassField = cls.id_group ? null : classIdNum;
    const idGroupField = cls.id_group ? cls.id_group : null;

    const { rows: insRows } = await query(
      `INSERT INTO evaluation (id_course, id_teacher, id_type, percent, title, id_module, id_group, id_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, percent, created_at, id_course, id_class, id_type`,
      [courseIdNum, teacherId, Number(typeId), p, t, cls.id_module ?? null, idGroupField, idClassField]
    );

    return res.json({ item: insRows[0] });
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

  const { rows: evRows } = await query(
    `SELECT ev.id, ev.id_teacher, ev.id_course, et.type AS evaluation_type
     FROM evaluation ev
     LEFT JOIN evaluation_type et ON et.id = ev.id_type
     WHERE ev.id = $1 LIMIT 1`,
    [examId]
  );
  const ev = evRows[0];
  if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
  if (ev.id_teacher !== teacherId) {
    return res.status(403).json({ error: "No es tu evaluación" });
  }

  const { rows: stRows } = await query(
    ced
      ? `SELECT id, cedula, name, email, id_course, estado FROM users WHERE cedula = $1 LIMIT 1`
      : `SELECT id, cedula, name, email, id_course, estado FROM users WHERE id = $1 LIMIT 1`,
    [ced || stId]
  );
  const st = stRows[0];

  if (!st?.id) return res.status(404).json({ error: ced ? "No existe estudiante con esa cédula" : "No existe estudiante con ese id" });
  if (st.estado !== "Activo") {
    return res.status(400).json({ error: "Este estudiante está retirado, no se le puede asignar una nota" });
  }

  if (Number(st.id_course) !== Number(ev.id_course)) {
    return res.status(400).json({ error: "El estudiante no pertenece al curso de esta evaluación" });
  }

  try { await requireAnioVigenteForCourse(ev.id_course); }
  catch (err) { return handleYearError(res, err); }

  const { rows: existingGradeRows } = await query(
    `SELECT attempts FROM grades WHERE id_exam = $1 AND id_student = $2 LIMIT 1`,
    [examId, st.id]
  );
  const existingGrade = existingGradeRows[0];

  const finishedAt = new Date().toISOString();
  const attempts = Number(existingGrade?.attempts ?? 0) + 1;

  const { rows: gradeRows } = await query(
    `INSERT INTO grades (id_exam, id_student, grade, finished_at, attempts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id_exam, id_student)
     DO UPDATE SET grade = EXCLUDED.grade, finished_at = EXCLUDED.finished_at, attempts = EXCLUDED.attempts
     RETURNING id_exam, id_student, grade, finished_at`,
    [examId, st.id, g, finishedAt, attempts]
  );

  if (ev.evaluation_type === "Examen") {
    await syncRtaExamenForManualGrade({
      studentId: st.id,
      evaluationId: examId,
      courseId: ev.id_course,
      grade: g,
    });
  }

  return res.json({
    ok: true,
    student: { id: st.id, cedula: st.cedula, name: st.name },
    grade: gradeRows[0],
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

    const { rows: evRows } = await query(
      `SELECT id, id_teacher, id_course FROM evaluation WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
    if (ev.id_teacher !== teacherId) {
      return res.status(403).json({ error: "No puedes editar esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { rows } = await query(
      `UPDATE evaluation SET percent = $1 WHERE id = $2 RETURNING id, percent`,
      [percent, id]
    );

    return res.json({ item: rows[0] });
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

    const { rows: evRows } = await query(
      `SELECT id, id_teacher, id_course FROM evaluation WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Evaluación no existe" });
    if (ev.id_teacher !== teacherId) {
      return res.status(403).json({ error: "No puedes eliminar esta evaluación" });
    }

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    await query(`DELETE FROM evaluation WHERE id = $1`, [id]);

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
    const { rows: evRows } = await query(
      `SELECT ${EVAL_SELECT} WHERE ev.id_group = $1 ORDER BY ev.created_at ASC, ev.id ASC`,
      [groupId]
    );
    const evals = evRows.map(mapEvalRow);

    // Resolve group metadata even when there are no evaluations yet.
    let groupMeta = evals[0]?.group ?? null;
    if (!groupMeta) {
      const { rows: gRows } = await query(`SELECT id, name FROM "group" WHERE id = $1 LIMIT 1`, [groupId]);
      groupMeta = gRows[0] ?? { id: groupId, name: `Grupo ${groupId}` };
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
      const { rows: cRows } = await query(`SELECT id, name FROM course WHERE id = ANY($1::bigint[])`, [courseIds]);
      courseNameMap = new Map(cRows.map((c) => [Number(c.id), c.name]));
    }

    const students = studentsRaw.map((u) => ({
      id: u.id, name: u.name, cedula: u.cedula,
      id_course: u.id_course,
      course_name: courseNameMap.get(Number(u.id_course)) || null,
    }));

    const examIds = evals.map((e) => e.id);
    const studentIds = students.map((s) => s.id);
    let grades = [];
    if (examIds.length > 0 && studentIds.length > 0) {
      await closeExpiredExams({ courseIds, evaluationIds: examIds });
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [examIds, studentIds]
      );
      grades = gRows;
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
    const { rows: ctRows } = await query(
      `SELECT id_class FROM class_teacher WHERE id_teacher = $1 AND id_class = ANY($2::bigint[])`,
      [teacherId, classIds]
    );

    const allowedSet = new Set(ctRows.map((r) => Number(r.id_class)));
    const denied = classIds.filter((id) => !allowedSet.has(id));
    if (denied.length > 0) {
      return res.status(403).json({ error: `Materias no asignadas: ${denied.join(",")}` });
    }

    // 2) Fetch all class metadata + all evaluations in parallel
    const [{ rows: classRows }, { rows: evalRows }] = await Promise.all([
      query(`SELECT id, name, level FROM class WHERE id = ANY($1::bigint[])`, [classIds]),
      query(`SELECT ${EVAL_SELECT} WHERE ev.id_class = ANY($1::bigint[]) ORDER BY ev.created_at ASC, ev.id ASC`, [classIds]),
    ]);

    const classMap = new Map(classRows.map((c) => [c.id, c]));
    const evals = evalRows.map(mapEvalRow);

    // 3) Fetch students for all unique course_ids (one call)
    const allCourseIds = [...new Set(evals.map((e) => Number(e.id_course)).filter(Boolean))];
    const studentsRaw = allCourseIds.length > 0 ? await getStudentsByCourseIds(allCourseIds) : [];

    // 4) Fetch course names
    let courseNameMap = new Map();
    if (allCourseIds.length > 0) {
      const { rows: courseRows } = await query(`SELECT id, name FROM course WHERE id = ANY($1::bigint[])`, [allCourseIds]);
      courseNameMap = new Map(courseRows.map((c) => [Number(c.id), c.name]));
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
      const { rows: gRows } = await query(
        `SELECT id_student, id_exam, grade, finished_at, attempts FROM grades
         WHERE id_exam = ANY($1::bigint[]) AND id_student = ANY($2::uuid[])`,
        [allExamIds, allStudentIds]
      );
      allGrades = gRows;
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
  const { rows: existingRows } = await query(
    `SELECT id FROM evaluation_type WHERE type = $1 AND year = $2 LIMIT 1`,
    ["Examen", year]
  );
  if (existingRows[0]?.id) return existingRows[0].id;

  const { rows: createdRows } = await query(
    `INSERT INTO evaluation_type (type, year) VALUES ($1, $2) RETURNING id`,
    ["Examen", year]
  );
  return createdRows[0].id;
}

async function getExamenTypeIds() {
  const { rows } = await query(`SELECT id FROM evaluation_type WHERE type = $1`, ["Examen"]);
  return rows.map((r) => r.id);
}

// Cuando se carga/edita una nota manual para una evaluación de tipo "Examen", refleja el
// cambio también en rta_examen (finalizado_at + calificacion). Sin esto, el botón "Tomar
// Examen" del alumno sigue apareciendo (depende solo de rta_examen.finalizado_at) y la
// vista de resultado del examen sigue mostrando la calificación vieja. Requiere que ya
// exista la fila en grades (FK compuesta id_student+id_evaluation -> grades).
async function syncRtaExamenForManualGrade({ studentId, evaluationId, courseId, grade }) {
  const { rows: progRows } = await query(
    `SELECT id FROM examen_programacion WHERE id_evaluation = $1 AND id_course = $2 LIMIT 1`,
    [evaluationId, courseId]
  );
  const idProgramacion = progRows[0]?.id ?? null;

  await query(
    `INSERT INTO rta_examen (id_student, id_evaluation, id_programacion, iniciado_at, finalizado_at, calificacion)
     VALUES ($1, $2, $3, now(), now(), $4)
     ON CONFLICT (id_student, id_evaluation) DO UPDATE SET
       finalizado_at = COALESCE(rta_examen.finalizado_at, EXCLUDED.finalizado_at),
       calificacion = EXCLUDED.calificacion`,
    [studentId, evaluationId, idProgramacion, grade]
  );
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

    const { rows: clsRows } = await query(
      `SELECT id, name, level, id_module, id_group FROM class WHERE id = $1 LIMIT 1`,
      [id_class]
    );
    const cls = clsRows[0];
    if (!cls?.id) return res.status(404).json({ error: "Materia no existe" });

    const { rows: courseRows } = await query(
      `SELECT id, name, level, year FROM course WHERE id = $1 LIMIT 1`,
      [id_course]
    );
    const course = courseRows[0];
    if (!course?.id) return res.status(404).json({ error: "Curso no existe" });
    if (Number(course.level) !== Number(cls.level))
      return res.status(400).json({ error: "El curso no corresponde al nivel de la materia" });

    try { await requireAnioVigenteForCourse(id_course); }
    catch (err) { return handleYearError(res, err); }

    const examenTypeId = await resolveExamenTypeId(course.year);

    const { rows: evalRows } = await query(
      `INSERT INTO evaluation (id_course, id_class, id_teacher, id_type, percent, title, id_module, id_group, tiempo_minutos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, percent, tiempo_minutos, created_at`,
      [id_course, id_class, teacherId, examenTypeId, percent, title, cls.id_module || null, cls.id_group || null, tiempo_minutos]
    );
    const evalData = evalRows[0];

    const values = [];
    const placeholders = preguntas.map((p, idx) => {
      const base = idx * 7;
      values.push(
        evalData.id,
        idx + 1,
        p.tipo,
        String(p.enunciado || "").trim(),
        Number(p.puntos),
        JSON.stringify(p.opciones),
        JSON.stringify(p.respuesta_correcta)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await query(
        `INSERT INTO examen_detalle (id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (detErr) {
      await query(`DELETE FROM evaluation WHERE id = $1`, [evalData.id]);
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

    const { rows: evRows } = await query(
      `SELECT id, title, percent, tiempo_minutos, id_course, id_class, id_module, id_group, id_teacher
       FROM evaluation WHERE id = $1 AND id_type = ANY($2::bigint[]) LIMIT 1`,
      [id, examenTypeIds]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu examen" });

    const { rows: preguntas } = await query(
      `SELECT id, orden, tipo, enunciado, puntos, opciones, respuesta_correcta
       FROM examen_detalle WHERE id_evaluation = $1 ORDER BY orden`,
      [id]
    );

    return res.json({ item: { ...ev, preguntas } });
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
    const { rows: evRows } = await query(
      `SELECT id, id_teacher, id_course, id_type FROM evaluation WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ev = evRows[0];
    if (!ev?.id) return res.status(404).json({ error: "Examen no existe" });
    if (!examenTypeIds.includes(ev.id_type))
      return res.status(400).json({ error: "Esta evaluación no es de tipo Examen" });
    if (ev.id_teacher !== teacherId) return res.status(403).json({ error: "No es tu examen" });

    try { await requireAnioVigenteForCourse(ev.id_course); }
    catch (err) { return handleYearError(res, err); }

    const { rows: countRows } = await query(
      `SELECT count(*) FROM rta_examen WHERE id_evaluation = $1 AND finalizado_at IS NOT NULL`,
      [id]
    );
    const intentosCount = Number(countRows[0]?.count ?? 0);
    if (intentosCount > 0)
      return res.status(409).json({
        error: `No se puede editar: ${intentosCount} alumno${intentosCount !== 1 ? "s" : ""} ya ${intentosCount !== 1 ? "rindieron" : "rindió"} este examen.`,
      });

    await query(`UPDATE evaluation SET tiempo_minutos = $1, percent = $2 WHERE id = $3`, [tiempo_minutos, percent, id]);

    await query(`DELETE FROM examen_detalle WHERE id_evaluation = $1`, [id]);

    const values = [];
    const placeholders = preguntas.map((p, idx) => {
      const base = idx * 7;
      values.push(
        id,
        idx + 1,
        p.tipo,
        String(p.enunciado || "").trim(),
        Number(p.puntos),
        JSON.stringify(p.opciones),
        JSON.stringify(p.respuesta_correcta)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    try {
      await query(
        `INSERT INTO examen_detalle (id_evaluation, orden, tipo, enunciado, puntos, opciones, respuesta_correcta)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (insErr) {
      return res.status(500).json({ error: `Error actualizando preguntas: ${insErr.message}` });
    }

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

    const { rows: ctRows } = await query(
      `SELECT c.id_module FROM class_teacher ct
       JOIN class c ON c.id = ct.id_class
       WHERE ct.id_teacher = $1 AND ct.id_course = $2`,
      [teacherId, courseId]
    );

    const moduleIds = [...new Set(ctRows.map((r) => r.id_module).filter(Boolean))];
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

    const { rows: ctRows } = await query(
      `SELECT c.id, c.name, c.id_module FROM class_teacher ct
       JOIN class c ON c.id = ct.id_class
       WHERE ct.id_teacher = $1 AND ct.id_course = $2`,
      [teacherId, courseId]
    );

    let classes = ctRows;
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

    const { rows: ctRows } = await query(
      `SELECT id_class FROM class_teacher WHERE id_teacher = $1 AND id_course = $2`,
      [teacherId, courseId]
    );

    const teacherClassIds = ctRows.map((r) => r.id_class);
    if (!teacherClassIds.length)
      return res.status(403).json({ error: "No tienes materias asignadas en este curso" });

    let sql = `SELECT id, fecha_clase FROM asistencia_sesion WHERE id_course = $1`;
    const params = [courseId];

    if (moduleId !== "todos") { params.push(moduleId); sql += ` AND id_module = $${params.length}`; }
    if (classId  !== "todas") { params.push(classId);  sql += ` AND id_class = $${params.length}`; }
    else                      { params.push(teacherClassIds); sql += ` AND id_class = ANY($${params.length}::bigint[])`; }
    sql += ` ORDER BY fecha_clase DESC`;

    const { rows: data } = await query(sql, params);

    const seen = new Set();
    const items = data
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

    const { rows: ctRows } = await query(
      `SELECT id_class FROM class_teacher WHERE id_teacher = $1 AND id_course = $2 AND id_class = $3 LIMIT 1`,
      [teacherId, courseId, classId]
    );
    if (!ctRows[0]) return res.status(403).json({ error: "No tienes esta materia asignada en este curso" });

    const { rows: sesionRows } = await query(
      `SELECT id, id_teacher, profesor_asistio, profesor_reemplazo FROM asistencia_sesion
       WHERE id_course = $1 AND id_module = $2 AND id_class = $3 AND fecha_clase = $4 LIMIT 1`,
      [courseId, moduleId, classId, fecha]
    );
    const sesion = sesionRows[0];
    if (!sesion) return res.status(404).json({ error: "No hay registro para esa sesión" });

    const { rows: teacherRows } = await query(`SELECT name FROM users WHERE id = $1 LIMIT 1`, [sesion.id_teacher]);

    const { rows: detalleRows } = await query(
      `SELECT id_student, asistio, motivo FROM asistencia_detalle WHERE id_sesion = $1`,
      [sesion.id]
    );

    const studentIds = detalleRows.map((d) => d.id_student);
    let userMap = new Map();
    if (studentIds.length) {
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
        name:   userMap.get(d.id_student).name,
        cedula: userMap.get(d.id_student).cedula,
        asistio: d.asistio,
        motivo:  d.motivo,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));

    return res.json({ sesion: { ...sesion, teacher_name: teacherRows[0]?.name ?? null }, detalle });
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

    const { rows: ctRows } = await query(
      `SELECT id_class FROM class_teacher WHERE id_teacher = $1 AND id_course = $2`,
      [teacherId, courseId]
    );

    const teacherClassIds = ctRows.map((r) => r.id_class);
    if (!teacherClassIds.length)
      return res.status(403).json({ error: "No tienes materias asignadas en este curso" });

    let sql = `SELECT s.id, s.fecha_clase, s.id_teacher, s.profesor_asistio, s.profesor_reemplazo, s.id_class,
                      c.id AS class_id, c.name AS class_name
               FROM asistencia_sesion s
               LEFT JOIN class c ON c.id = s.id_class
               WHERE s.id_course = $1`;
    const params = [courseId];

    if (moduleId    !== "todos") { params.push(moduleId);         sql += ` AND s.id_module = $${params.length}`; }
    if (classId     !== "todas") { params.push(classId);          sql += ` AND s.id_class = $${params.length}`; }
    else                         { params.push(teacherClassIds);  sql += ` AND s.id_class = ANY($${params.length}::bigint[])`; }
    if (fechaFiltro)             { params.push(fechaFiltro);      sql += ` AND s.fecha_clase = $${params.length}`; }
    sql += ` ORDER BY s.fecha_clase ASC`;

    const { rows: sesiones } = await query(sql, params);
    if (!sesiones.length) return res.json({ fechas: [], detalle: [] });

    const teacherIds = [...new Set(sesiones.map((s) => s.id_teacher).filter(Boolean))];
    let teacherMap = new Map();
    if (teacherIds.length) {
      const { rows: td } = await query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [teacherIds]);
      teacherMap = new Map(td.map((u) => [u.id, u.name]));
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
    if (studentIds.length) {
      const { rows: ud } = await query(`SELECT id, name, cedula FROM users WHERE id = ANY($1::uuid[]) AND estado = 'Activo'`, [studentIds]);
      userMap = new Map(ud.map((u) => [u.id, u]));
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
