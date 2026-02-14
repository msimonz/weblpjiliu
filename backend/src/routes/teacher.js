import { Router } from 'express';
import { requireRole } from '../middlewares/auth.js';
import { supabaseAdmin } from '../supabase.js';

export const teacherRouter = Router();
teacherRouter.use(requireRole('T','A'));

// matricular estudiante a course + historial
teacherRouter.post('/enroll', async (req, res) => {
  const { student_id, course_id } = req.body;

  // 1) update users.id_course
  const upd = await supabaseAdmin.from('users').update({ id_course: course_id }).eq('id', student_id);
  if (upd.error) return res.status(400).json({ error: upd.error.message });

  // 2) ensure history row exists
  await supabaseAdmin.from('user_history').upsert({ id_student: student_id, id_course: course_id });

  res.json({ ok: true });
});

// crear evaluación (asignación)
teacherRouter.post('/evaluations', async (req, res) => {
  const { id_course, id_class, id_type, percent, title } = req.body;
  const id_teacher = req.auth.profile.id;

  const { data, error } = await supabaseAdmin
    .from('evaluation')
    .insert({ id_course, id_class, id_type, percent, title, id_teacher })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// listar mis evaluaciones
teacherRouter.get('/evaluations', async (req, res) => {
  const id_teacher = req.auth.profile.id;

  const { data, error } = await supabaseAdmin
    .from('evaluation')
    .select('id,title,percent,created_at, course:course(id,name,level), class:class(id,name), type:evaluation_type(id,type)')
    .eq('id_teacher', id_teacher)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// subir/actualizar nota (manual)
teacherRouter.post('/grades', async (req, res) => {
  const { id_student, id_exam, grade, finished_at, attempts = 1, source = 'manual' } = req.body;

  const { data, error } = await supabaseAdmin
    .from('grades')
    .upsert({ id_student, id_exam, grade, finished_at, attempts, source }, { onConflict: 'id_student,id_exam' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
