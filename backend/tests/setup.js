import "dotenv/config";
import { vi } from "vitest";

// ── Mock del middleware de autenticación ──────────────────────────────────────
// Inyecta un usuario admin de prueba en req.auth para todos los tests,
// evitando la necesidad de tokens JWT reales.
vi.mock("../src/middlewares/auth.js", () => ({
  authMiddleware: (req, _res, next) => {
    req.auth = {
      user: { id: "test-admin-uuid", email: "admin@test.com" },
      roles: ["A"],
    };
    next();
  },
  requireAuth: (_req, _res, next) => next(),
  requireUser: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
