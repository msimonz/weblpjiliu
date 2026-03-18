import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

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
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ blocked: false, items: data || [], course });
});

/**
 * Resumen por materias del año
 * ✅ Debe devolver TODAS las materias del level, incluso si no tienen evaluaciones o notas.
 */
studentRouter.get("/subjects-summary", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const level = Number(req.query.level || 1);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }

  const course = await getStudentCourse(req, res);
  if (!course) return;

  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      course,
      items: [],
      stats: null,
    });
  }

  // 1) Traer TODAS las materias del nivel
  const { data: classRows, error: classErr } = await supabaseAdmin
    .from("class")
    .select("id,name,level")
    .eq("level", level)
    .order("name", { ascending: true });

  if (classErr) {
    return res.status(500).json({ error: classErr.message });
  }

  const classes = classRows || [];

  if (classes.length === 0) {
    return res.json({
      blocked: false,
      course,
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
      sumW: 0,
      sum: 0,
    });
  }

  // 3) Traer evaluaciones del course real del estudiante
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_class,percent,title")
    .eq("id_course", course.id);

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
      .select("id_exam,grade,id_student")
      .eq("id_student", userId)
      .in("id_exam", evalIds);

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
    course,
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
  const level = Number(req.query.level || 1);
  const classId = Number(req.query.class_id || 0);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!classId) return res.status(400).json({ error: "class_id requerido" });

  const course = await getStudentCourse(req, res);
  if (!course) return;

  if (!checkLevelAllowed(level, course)) {
    return res.json({
      blocked: true,
      message: "Aún no ha cursado este año.",
      course,
      items: [],
      weighted: null,
    });
  }

  // evaluaciones de esa materia en el course REAL del estudiante
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,title,percent,created_at,id_type")
    .eq("id_course", course.id)
    .eq("id_class", classId)
    .order("created_at", { ascending: true });

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({ blocked: false, items: [], weighted: null, course });
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

  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,finished_at,attempts,created_at,updated_at")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

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
      source: g?.source ?? null,
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

  return res.json({ blocked: false, items, weighted, course });
});