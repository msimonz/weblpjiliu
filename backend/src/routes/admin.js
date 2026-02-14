import { Router } from 'express';
import { requireRole } from '../middlewares/auth.js';
import { supabaseAdmin } from '../supabase.js';

export const adminRouter = Router();
adminRouter.use(requireRole('A'));

// create course
adminRouter.post('/courses', async (req, res) => {
  const { name, year, level } = req.body;
  const { data, error } = await supabaseAdmin.from('course').insert({ name, year, level }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// create class (materia)
adminRouter.post('/classes', async (req, res) => {
  const { name, level } = req.body;
  const { data, error } = await supabaseAdmin.from('class').insert({ name, level }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// create evaluation type
adminRouter.post('/evaluation-types', async (req, res) => {
  const { type } = req.body;
  const { data, error } = await supabaseAdmin.from('evaluation_type').insert({ type }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// assign teacher to class
adminRouter.post('/class-teacher', async (req, res) => {
  const { id_teacher, id_class } = req.body;
  const { data, error } = await supabaseAdmin.from('class_teacher').insert({ id_teacher, id_class }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
