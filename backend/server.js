<<<<<<< HEAD
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authMiddleware } from './src/middlewares/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { teacherRouter } from './src/routes/teacher.js';
import { studentRouter } from './src/routes/student.js';
import { authRouter } from './src/routes/auth.js';
import { healthRouter } from './src/routes/health.js';
import { monitorRouter } from './src/routes/monitor.js';
import { secretariaRouter } from './src/routes/secretaria.js';

import { startSchedulers } from './src/schedulers.js';

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins,
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
app.use('/api/monitor', monitorRouter);
app.use('/api/secretaria', secretariaRouter);
app.use('/api/health', healthRouter);
const port = Number(process.env.PORT || 3001);

app.listen(port, () => {
  console.log(`Backend on :${port}`);
});
=======
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authMiddleware } from './src/middlewares/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { teacherRouter } from './src/routes/teacher.js';
import { studentRouter } from './src/routes/student.js';
import { authRouter } from './src/routes/auth.js';
import { healthRouter } from './src/routes/health.js';
import { monitorRouter } from './src/routes/monitor.js';
import { secretariaRouter } from './src/routes/secretaria.js';

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
console.log("CORS_ORIGINS raw:", process.env.CORS_ORIGINS);
console.log("corsOrigins parsed:", corsOrigins);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => res.json({ ok: true }));

// auth: lee JWT del frontend (supabase) y adjunta user/role
app.use(authMiddleware);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/student', studentRouter);
app.use('/api/monitor', monitorRouter);
app.use('/api/secretaria', secretariaRouter);
app.use('/api/health', healthRouter);
const port = Number(process.env.PORT || 3001);

app.listen(port, () => {
  console.log(`Backend on :${port}`);
});
>>>>>>> 0c35a1da603056d1a9902e83e791ca27a82e242c
