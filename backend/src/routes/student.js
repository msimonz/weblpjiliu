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

  // 1) Resolver el course del level (elige el más reciente por year)
  const { data: course, error: courseErr } = await supabaseAdmin
    .from("course")
    .select("id,year,level,name")
    .eq("level", level)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (courseErr) return res.status(500).json({ error: courseErr.message });
  if (!course?.id) {
    return res.status(404).json({ error: "No hay course para ese level" });
  }

  // 2) Evaluaciones de esa materia en ese course
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

  // 3) Notas del estudiante para esos exámenes
  const { data: gradeRows, error: gradesErr } = await supabaseAdmin
    .from("grades")
    .select("id_exam,grade,finished_at,attempts,source,created_at,updated_at")
    .eq("id_student", userId)
    .in("id_exam", evalIds);

  if (gradesErr) return res.status(500).json({ error: gradesErr.message });

  const gradeMap = new Map();
  for (const g of gradeRows || []) gradeMap.set(g.id_exam, g);

  // 4) Unir evaluación + nota (aunque no exista nota aún)
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

  // 5) Ponderado: Σ(grade * percent) / Σ(percent) usando SOLO las que tienen grade
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
