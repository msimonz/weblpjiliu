import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../supabase.js";

export const studentRouter = Router();

/**
 * Autocomplete de materias (tabla class)
 * GET /api/student/classes?level=1&q=mate
 */
studentRouter.get("/classes", requireAuth, async (req, res) => {
  const level = Number(req.query.level || 1);
  const q = String(req.query.q || "").trim();

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!q) return res.json({ items: [] });

  const { data, error } = await supabaseAdmin
    .from("class")
    .select("id,name,level")
    .eq("level", level)
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data || [] });
});

/**
 * Resumen por año: ponderado total por materia + stats
 * GET /api/student/subjects-summary?level=1
 */
studentRouter.get("/subjects-summary", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const level = Number(req.query.level || 1);
  const PASS_GRADE = 70;

  console.log("\n=== /subjects-summary ===");
  console.log("userId:", userId);
  console.log("email:", req.auth.user.email);
  console.log("profile.id_course:", req.auth.profile?.id_course);
  console.log("level query:", level);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }

  // 1) course del año (por level) más reciente
  const { data: course, error: courseErr } = await supabaseAdmin
    .from("course")
    .select("id,year,level,name")
    .eq("level", level)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("course picked:", course);

  if (courseErr) return res.status(500).json({ error: courseErr.message });
  if (!course?.id) return res.json({ course: null, items: [], stats: null });

  // 2) evaluaciones del course (traemos también class.name via join)
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,id_class,percent,title,class:class(id,name)")
    .eq("id_course", course.id);

  console.log("evaluations count:", (evals || []).length);
  if (evals?.[0]) {
    console.log("first eval sample:", {
      id: evals[0].id,
      id_class: evals[0].id_class,
      percent: evals[0].percent,
      title: evals[0].title,
      class_name: evals[0].class?.name,
    });
  }

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({
      course,
      items: [],
      stats: { passed: 0, failed: 0, pending: 0, avg_weighted: null, pass_grade: PASS_GRADE },
    });
  }

  const evalIds = evaluations.map((e) => e.id);
  console.log("evalIds:", evalIds);

  // 3) notas del estudiante SOLO para esas evaluaciones
  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,id_student")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  console.log("gradeRows count:", (gradeRows || []).length);
  if (gradeRows?.[0]) console.log("first grade sample:", gradeRows[0]);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  // map examId -> grade
  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  // 4) agrupar por materia (id_class) y calcular ponderado por materia
  const byClass = new Map(); // classId -> { class_id, name, sumW, sum }
  for (const ev of evaluations) {
    const classId = Number(ev.id_class);
    const className =
      (ev.class && ev.class.name) ? String(ev.class.name) : `Materia ${classId}`;

    const percent = Number(ev.percent ?? 0);
    const g = gradeMap.get(ev.id) || null;
    const grade = g ? Number(g.grade ?? 0) : null;

    if (!byClass.has(classId)) {
      byClass.set(classId, { class_id: classId, name: className, sumW: 0, sum: 0, hasAnyGrade: false });
    }

    // solo suma si hay nota
    if (grade !== null) {
      const obj = byClass.get(classId);
      obj.hasAnyGrade = true;
      obj.sumW += percent;
      obj.sum += grade * percent;
    }
  }

  // construir items finales
  const items = Array.from(byClass.values())
    .map((x) => {
      const weighted = x.sumW > 0 ? Number((x.sum / x.sumW).toFixed(2)) : null;
      return { class_id: x.class_id, name: x.name, weighted };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log("items computed:", items);

  // 5) stats
  let passed = 0, failed = 0, pending = 0;
  let avgSum = 0, avgCount = 0;

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

  const stats = { passed, failed, pending, avg_weighted, pass_grade: PASS_GRADE };
  console.log("stats computed:", stats);

  return res.json({ course, items, stats });
});

/**
 * Notas por materia + ponderado
 * GET /api/student/grades?level=1&class_id=123
 */
studentRouter.get("/grades", requireAuth, async (req, res) => {
  const userId = req.auth.user.id;
  const level = Number(req.query.level || 1);
  const classId = Number(req.query.class_id || 0);

  if (!level || level < 1 || level > 4) {
    return res.status(400).json({ error: "level inválido (1..4)" });
  }
  if (!classId) return res.status(400).json({ error: "class_id requerido" });

  // course del level (más reciente por year)
  const { data: course, error: courseErr } = await supabaseAdmin
    .from("course")
    .select("id,year,level,name")
    .eq("level", level)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (courseErr) return res.status(500).json({ error: courseErr.message });
  if (!course?.id) return res.status(404).json({ error: "No hay course para ese level" });

  // evaluaciones de esa materia en ese course
  const { data: evals, error: evalErr } = await supabaseAdmin
    .from("evaluation")
    .select("id,title,percent,created_at")
    .eq("id_course", course.id)
    .eq("id_class", classId)
    .order("created_at", { ascending: true });

  if (evalErr) return res.status(500).json({ error: evalErr.message });

  const evaluations = evals || [];
  if (evaluations.length === 0) {
    return res.json({ items: [], weighted: null, course });
  }

  const evalIds = evaluations.map((e) => e.id);

  // notas del estudiante para esos exámenes
  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,finished_at,attempts,source,created_at,updated_at")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  // unir evaluación + nota (aunque no exista nota aún)
  const items = evaluations.map((ev) => {
    const g = gradeMap.get(ev.id) || null;
    return {
      exam_id: ev.id,
      title: ev.title,
      percent: Number(ev.percent ?? 0),
      grade: g ? Number(g.grade ?? 0) : null,
      finished_at: g?.finished_at ?? null,
      attempts: g?.attempts ?? null,
      source: g?.source ?? null,
    };
  });

  // ponderado: Σ(grade * percent) / Σ(percent) usando solo las que tienen grade
  let sumW = 0;
  let sum = 0;
  for (const it of items) {
    if (it.grade === null) continue;
    const w = Number(it.percent ?? 0);
    sumW += w;
    sum += it.grade * w;
  }
  const weighted = sumW > 0 ? Number((sum / sumW).toFixed(2)) : null;

  return res.json({ items, weighted, course });
});
