import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authMiddleware } from './src/middlewares/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { teacherRouter } from './src/routes/teacher.js';
import { studentRouter } from './src/routes/student.js';
import { authRouter } from './src/routes/auth.js';


import { startSchedulers } from './src/schedulers.js';

const app = express();
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => res.json({ ok: true }));

// auth: lee JWT del frontend (supabase) y adjunta user/role
app.use(authMiddleware);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/student', studentRouter);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Backend on :${port}`);
  startSchedulers(); // cron lunes
});
