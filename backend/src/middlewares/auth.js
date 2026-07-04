import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { verifyImpToken } from "../lib/impToken.js";

// ===============
// Helper: cargar profile + roles
// ===============
async function loadProfileAndRoles(user) {
  const { rows: profileRows } = await query(
    `SELECT u.id, u.name, u.email, u.cedula, u.code_jiliu, u.id_course, u.created_at,
            c.id AS course_id, c.name AS course_name, c.level AS course_level, c.year AS course_year
     FROM users u
     LEFT JOIN course c ON c.id = u.id_course
     WHERE u.id = $1
     LIMIT 1`,
    [user.id]
  );
  const row = profileRows[0];

  const course = row?.course_id
    ? { id: row.course_id, name: row.course_name, level: row.course_level, year: row.course_year }
    : null;

  const profile = row
    ? {
        id: row.id,
        name: row.name,
        email: row.email,
        cedula: row.cedula,
        code_jiliu: row.code_jiliu,
        id_course: row.id_course,
        created_at: row.created_at,
        course,
      }
    : null;

  const { rows: rolesRows } = await query(
    `SELECT t.code FROM user_type ut JOIN type t ON t.id = ut.id_type WHERE ut.id_user = $1`,
    [user.id]
  );

  const roles = rolesRows.map((r) => r.code).filter(Boolean);

  const role = roles.includes("A")
    ? "A"
    : roles.includes("T")
    ? "T"
    : roles.includes("M")
    ? "M"
    : roles.includes("S")
    ? "S"
    : roles.includes("E")
    ? "E"
    : null;

  return {
    profile: profile || null,
    course: profile?.course || null,
    roles,
    role,
  };
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

async function validateTokenAndLoadContext(token) {
  // Intentar token de impersonación primero
  const impSecret = process.env.IMPERSONATE_SECRET;
  if (impSecret) {
    const payload = verifyImpToken(token, impSecret);
    if (payload) {
      return {
        ok: true,
        auth: {
          user: { id: payload.sub, email: payload.profile?.email },
          profile: payload.profile || null,
          course: payload.course || null,
          roles: payload.roles || [],
          role: payload.role || null,
        },
      };
    }
  }

  // Token normal: JWT propio (emitido por POST /auth/login)
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { ok: false, error: "Token inválido o expirado" };
  }

  const user = { id: decoded.sub, email: decoded.email };
  const { profile, course, roles, role } = await loadProfileAndRoles(user);

  return {
    ok: true,
    auth: { user, profile, course, roles, role },
  };
}

// ===============
// Middleware opcional (no bloquea)
// ===============
export async function authMiddleware(req, res, next) {
  try {
    req.auth = null;

    const token = extractBearerToken(req);
    if (!token) return next();

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) return next();

    req.auth = result.auth;
    return next();
  } catch {
    req.auth = null;
    return next();
  }
}

// ✅ Solo exige token válido (sirve para /profile en registro)
export async function requireUser(req, res, next) {
  try {
    if (req.auth?.user) return next();

    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "No autorizado" });

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    req.auth = result.auth;
    return next();
  } catch (e) {
    return res.status(401).json({ error: e?.message || "No autorizado" });
  }
}

// ✅ Exige token válido + fila en public.users (para usar la app)
export async function requireAuth(req, res, next) {
  try {
    if (req.auth?.user) {
      if (!req.auth?.profile) {
        return res.status(401).json({ error: "Profile no existe" });
      }
      return next();
    }

    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "No token" });

    const result = await validateTokenAndLoadContext(token);
    if (!result.ok) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }

    if (!result.auth?.profile) {
      return res.status(401).json({ error: "Profile no existe" });
    }

    req.auth = result.auth;
    return next();
  } catch (e) {
    return res.status(401).json({ error: e?.message || "No autorizado" });
  }
}

// ✅ Requiere que tenga al menos uno de los roles pedidos
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth?.user) return res.status(401).json({ error: "Unauthorized" });

    const roles = req.auth.roles || [];
    const ok = allowedRoles.some((r) => roles.includes(r));

    if (!ok) return res.status(403).json({ error: "Forbidden" });
    return next();
  };
}
