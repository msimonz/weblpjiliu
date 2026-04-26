import express from "express";
import cors from "cors";
import { authMiddleware } from "./middlewares/auth.js";
import { adminRouter }   from "./routes/admin.js";
import { teacherRouter } from "./routes/teacher.js";
import { studentRouter } from "./routes/student.js";
import { authRouter }    from "./routes/auth.js";
import { healthRouter }  from "./routes/health.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: "*", credentials: true, allowedHeaders: ["Content-Type", "Authorization"] }));
  app.use(express.json({ limit: "2mb" }));
  app.get("/health", (_, res) => res.json({ ok: true }));
  app.use(authMiddleware);
  app.use("/api/auth",    authRouter);
  app.use("/api/admin",   adminRouter);
  app.use("/api/teacher", teacherRouter);
  app.use("/api/student", studentRouter);
  app.use("/api/health",  healthRouter);
  return app;
}
