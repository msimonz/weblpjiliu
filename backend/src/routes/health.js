import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "lapromesa-backend",
    ts: new Date().toISOString(),
  });
});
